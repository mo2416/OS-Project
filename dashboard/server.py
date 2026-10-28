#!/usr/bin/env python3
"""Local-only dashboard backend for the scx_compact project.

Runs only two allow-listed project tests. It does not accept arbitrary shell commands.
Start from WSL with: python3 dashboard/server.py
"""
from __future__ import annotations
import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DASHBOARD = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = int(os.environ.get("SCX_DASHBOARD_PORT", "8765"))
LOG_DIR = ROOT / "results" / "raw" / "dashboard_runs"
PROCESSED_DIR = ROOT / "results" / "processed"

HISTORY = {
    "source": "results/processed/bench_repeated_20260924T111310Z.md",
    "runs_per_cell": 10,
    "kernel": "6.18.53",
    "vcpus": 8,
    "loads": {
        "20": {"eevdf": {"cpus": 6.0, "p99": 350}, "compact": {"cpus": 3.0, "p99": 3224}, "guard": {"cpus": 4.0, "p99": 489}},
        "40": {"eevdf": {"cpus": 7.8, "p99": 389}, "compact": {"cpus": 5.4, "p99": 1782}, "guard": {"cpus": 7.0, "p99": 446}},
        "60": {"eevdf": {"cpus": 8.0, "p99": 1408}, "compact": {"cpus": 6.9, "p99": 1751}, "guard": {"cpus": 7.9, "p99": 437}},
        "99": {"eevdf": {"cpus": 8.0, "p99": 1046}, "compact": {"cpus": 8.0, "p99": 3354}, "guard": {"cpus": 8.0, "p99": 3274}},
    },
    "energy_note": "No direct energy measurement was available. E_proxy in the research report is a model, not measured joules.",
}

LOCK = threading.Lock()
STATE = {
    "running": False, "test": None, "run_id": None, "started_at": None,
    "finished_at": None, "exit_code": None, "outcome": "idle", "message": "Ready",
    "log_path": None, "report_path": None, "report_text": "", "checks_passed": None,
    "checks_total": None, "shutdown_warning": False, "new_result_dir": None,
}
PROCESS: subprocess.Popen | None = None

LIVE_RE = re.compile(
    r"t=\s*([0-9.]+)s\s+active=\s*(\d+)\s+util=\s*([0-9.]+)%\s+"
    r"demand=\s*([0-9.]+)%\s+queued=\s*(\d+)\s+late=\s*([0-9.]+)%.*?"
    r"expand=(\d+)\s+lat_expand=(\d+)\s+shrink=(\d+)\s+busy_cpus\(>=5%\)=\s*(\d+)"
)


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_log_tail(path: str | None, max_chars: int = 35000) -> str:
    if not path:
        return ""
    try:
        with open(path, "r", errors="replace") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - max_chars), os.SEEK_SET)
            return f.read()
    except OSError:
        return ""


def find_live_metrics(log: str):
    found = None
    for line in log.splitlines():
        # Serial output can have kernel timestamps prepended to scheduler lines.
        match = LIVE_RE.search(line)
        if match:
            vals = match.groups()
            found = {
                "seconds": float(vals[0]), "active_cpus": int(vals[1]),
                "util_percent": float(vals[2]), "demand_percent": float(vals[3]),
                "queued": int(vals[4]), "late_percent": float(vals[5]),
                "expansions": int(vals[6]), "latency_expansions": int(vals[7]),
                "shrinks": int(vals[8]), "busy_cpus": int(vals[9]),
            }
    return found


def functional_report(started_epoch: float, old_dirs: set[str], run_id: str):
    base = ROOT / "results" / "raw" / "functional"
    if not base.exists():
        return None, None, None, None
    candidates = [p for p in base.iterdir() if p.is_dir() and p.name not in old_dirs]
    if not candidates:
        candidates = [p for p in base.iterdir() if p.is_dir() and p.stat().st_mtime >= started_epoch - 3]
    if not candidates:
        return None, None, None, None
    run_dir = max(candidates, key=lambda p: p.stat().st_mtime)
    report_path = PROCESSED_DIR / f"dashboard_functional_{run_dir.name}.md"
    analyzer = subprocess.run(
        [sys.executable, str(ROOT / "tests" / "analyze_functional.py"), str(run_dir), "--out", str(report_path)],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=20,
    )
    text = analyzer.stdout
    if report_path.exists():
        text = report_path.read_text(errors="replace")
    match = re.search(r"\*\*(\d+)/(\d+) checks passed\.\*\*", text)
    passed = int(match.group(1)) if match else None
    total = int(match.group(2)) if match else None
    return run_dir, report_path, text, (passed, total, analyzer.returncode)


def monitor_run(proc: subprocess.Popen, test: str, run_id: str, log_path: Path,
                started_epoch: float, old_dirs: set[str]):
    rc = proc.wait()
    log = read_log_tail(str(log_path), 250000)
    report_path = None
    report_text = ""
    checks = None
    result_dir = None
    if test == "functional":
        try:
            result_dir, report_path, report_text, checks = functional_report(started_epoch, old_dirs, run_id)
        except Exception as exc:  # keep completed output visible even if analysis fails
            report_text = f"Could not run the functional analyzer: {exc}"
    shutdown_warning = (
        "Attempted to kill init" in log
        or ("sysrq: Power Off" in log and "Input/output" in log)
        or "/usr/bin/sleep: Input/output error" in log
    )
    if test == "smoke":
        succeeded = ("[smoke] scx_compact exit: 0" in log and "[smoke] state after: disabled" in log)
        outcome = "pass_with_shutdown_warning" if succeeded and shutdown_warning else ("passed" if succeeded else "failed")
        message = (
            "Scheduler attached and detached successfully; guest shutdown emitted a teardown warning."
            if succeeded and shutdown_warning else
            ("Scheduler attached and detached successfully." if succeeded else "Smoke-test success markers were not found; inspect the log.")
        )
    else:
        passed = checks[0] if checks else None
        total = checks[1] if checks else None
        succeeded = passed is not None and total is not None and passed == total
        outcome = "pass_with_shutdown_warning" if succeeded and shutdown_warning else ("passed" if succeeded else "needs_review")
        message = (
            f"Functional checks: {passed}/{total}; guest shutdown emitted a teardown warning."
            if passed is not None and shutdown_warning else
            (f"Functional checks: {passed}/{total}." if passed is not None else "Functional test ended; check the generated report and log.")
        )
    with LOCK:
        STATE.update({
            "running": False, "finished_at": now_utc(), "exit_code": rc,
            "outcome": outcome, "message": message, "shutdown_warning": shutdown_warning,
            "report_path": str(report_path.relative_to(ROOT)) if report_path else None,
            "report_text": report_text, "checks_passed": checks[0] if checks else None,
            "checks_total": checks[1] if checks else None,
            "new_result_dir": str(result_dir.relative_to(ROOT)) if result_dir else None,
        })


def start_test(test: str):
    global PROCESS
    jobs = {
        "smoke": "tests/vm_smoke.sh",
        "functional": "tests/vm_functional.sh",
    }
    if test not in jobs:
        raise ValueError("Allowed tests are: smoke or functional")
    if not (ROOT / "vm" / "run_vm.sh").exists():
        raise RuntimeError("Cannot find vm/run_vm.sh. Put dashboard/ inside the OS Project root folder.")
    if not (ROOT / jobs[test]).exists():
        raise RuntimeError(f"Cannot find {jobs[test]}")
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + f"_{test}"
    log_path = LOG_DIR / f"{run_id}.log"
    base = ROOT / "results" / "raw" / "functional"
    old_dirs = {p.name for p in base.iterdir() if p.is_dir()} if base.exists() else set()
    started_epoch = time.time()
    cmd = ["bash", "vm/run_vm.sh", jobs[test], "8", "3G"]
    with LOCK:
        if STATE["running"]:
            raise RuntimeError("A demo run is already active.")
        with open(log_path, "w", encoding="utf-8") as out:
            proc = subprocess.Popen(cmd, cwd=ROOT, stdout=out, stderr=subprocess.STDOUT,
                                   start_new_session=True, env=os.environ.copy())
        STATE.update({
            "running": True, "test": test, "run_id": run_id, "started_at": now_utc(),
            "finished_at": None, "exit_code": None, "outcome": "running",
            "message": "Starting the 8-vCPU QEMU guest…", "log_path": str(log_path),
            "report_path": None, "report_text": "", "checks_passed": None,
            "checks_total": None, "shutdown_warning": False, "new_result_dir": None,
        })
        PROCESS = proc
    threading.Thread(target=monitor_run, args=(proc, test, run_id, log_path, started_epoch, old_dirs), daemon=True).start()
    return {"ok": True, "run_id": run_id}


class Handler(BaseHTTPRequestHandler):
    server_version = "SCXDemoDashboard/1.0"

    def log_message(self, fmt, *args):
        print("[dashboard] " + fmt % args)

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            try:
                body = (DASHBOARD / "index.html").read_bytes()
            except OSError:
                self.send_error(500, "dashboard/index.html is missing")
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/history":
            return self.send_json(HISTORY)
        if path == "/api/status":
            with LOCK:
                data = dict(STATE)
            log = read_log_tail(data.get("log_path"), 26000)
            data["log_tail"] = log
            data["live_metrics"] = find_live_metrics(log)
            return self.send_json(data)
        self.send_error(404, "Not found")

    def do_POST(self):
        if urlparse(self.path).path != "/api/run":
            self.send_error(404, "Not found")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 2048:
                return self.send_json({"ok": False, "error": "Request too large"}, 413)
            payload = json.loads(self.rfile.read(length) or b"{}")
            result = start_test(str(payload.get("test", "")))
            return self.send_json(result)
        except (ValueError, RuntimeError, json.JSONDecodeError) as exc:
            return self.send_json({"ok": False, "error": str(exc)}, 400)


def main():
    if not (ROOT / "vm" / "run_vm.sh").exists():
        print(f"ERROR: {ROOT} does not look like the project root (vm/run_vm.sh not found).", file=sys.stderr)
        print("Extract dashboard/ into D:\\OS Project, then run it from WSL.", file=sys.stderr)
        raise SystemExit(2)
    try:
        httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as exc:
        print(f"Could not bind to {HOST}:{PORT}: {exc}", file=sys.stderr)
        raise SystemExit(2)
    print(f"SCX dashboard serving project: {ROOT}")
    print(f"Open from Windows browser: http://localhost:{PORT}")
    print("Only smoke and functional test scripts can be launched. Press Ctrl+C to stop the dashboard server.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping dashboard server…")
    finally:
        httpd.server_close()

if __name__ == "__main__":
    main()
