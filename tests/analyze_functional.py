#!/usr/bin/env python3
"""Judge a raw functional run of scx_compact (see tests/vm_functional.sh).

Placement is checked from /proc/stat per-CPU counters (kernel accounting, independent
of the scheduler's own BPF counters); the active-set size comes from the loader CSV.
Prints a Markdown report and exits non-zero if any check fails.

Usage: analyze_functional.py <run-dir> [--out report.md]
"""
import csv, re, sys
from pathlib import Path

BUSY = 10.0  # a CPU counts as "used" in a window if >= 10% busy


def parse_procstat(path):
    snaps, cur = {}, None
    for line in path.read_text().splitlines():
        if line.startswith("== "):
            label, t = line[3:].rsplit(" ", 1)
            cur = snaps[label] = {"t": float(t), "cpu": {}, "ctxt": 0}
        elif line.startswith("ctxt "):
            cur["ctxt"] = int(line.split()[1])
        elif line.startswith("cpu"):
            f = line.split()
            v = list(map(int, f[1:]))
            idle = v[3] + v[4]
            cur["cpu"][int(f[0][3:])] = (sum(v[:8]) - idle, sum(v[:8]))
    return snaps


def window(snaps, name):
    """Per-CPU busy % and context switches/s between <name>:start and <name>:end."""
    a, b = snaps[f"{name}:start"], snaps[f"{name}:end"]
    pct = {}
    for c in a["cpu"]:
        db = b["cpu"][c][0] - a["cpu"][c][0]
        dt = b["cpu"][c][1] - a["cpu"][c][1]
        pct[c] = 100.0 * db / dt if dt else 0.0
    return pct, (b["ctxt"] - a["ctxt"]) / (b["t"] - a["t"]), (a["t"], b["t"])


def csv_rows(path):
    if not path.exists():
        return []
    with path.open() as f:
        return [{k: float(v) for k, v in r.items()} for r in csv.DictReader(f)]


def active_in(rows, t0, t1):
    return [int(r["nr_active"]) for r in rows if t0 <= r["mono_s"] <= t1]


def main():
    run = Path(sys.argv[1])
    out = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else None
    snaps = parse_procstat(run / "procstat.txt")
    states = dict(l.split(": ", 1) for l in (run / "states.txt").read_text().splitlines())
    rows = csv_rows(run / "compact.csv")
    log = (run / "compact.log").read_text()
    m = re.search(r"order=\w+:([\d ]+)", log)
    order = [int(x) for x in m.group(1).split()] if m else []
    nproc = len(order)
    minmax = re.search(r"min=(\d+) max=(\d+)", log)
    min_a, max_a = (int(minmax.group(1)), int(minmax.group(2))) if minmax else (0, 0)
    checks, lines = [], []

    def check(cid, desc, ok, evidence):
        checks.append(ok)
        lines.append(f"| {cid} | {desc} | {'PASS' if ok else '**FAIL**'} | {evidence} |")

    env = (run / "env.txt").read_text()
    check("F1a", "sched_ext present in guest kernel",
          "sched_ext_state: absent" not in env, env.splitlines()[0] + ", " + env.splitlines()[2])
    check("F1b", "reference scheduler scx_qmap attaches and detaches cleanly",
          states.get("qmap_state_during", "").startswith("enabled ops=qmap")
          and states.get("qmap_exit") == "0" and states.get("qmap_state_after") == "disabled",
          f"during=`{states.get('qmap_state_during')}` exit={states.get('qmap_exit')}")
    check("F2", "scx_compact attaches, runs all phases, exits cleanly",
          states.get("compact_state_during", "").startswith("enabled ops=compact")
          and states.get("compact_exit") == "0" and states.get("compact_state_after") == "disabled",
          f"during=`{states.get('compact_state_during')}` exit={states.get('compact_exit')}, "
          f"{len(rows)} samples")

    lines_tbl = ["| window | nr_active (min–max in window) | CPUs ≥10% busy | busy CPUs | total busy (CPUs) | ctxsw/s |",
                 "|---|---|---|---|---|---|"]
    res = {}
    for name in ["duty:eevdf", "idle", "hog1", "hog4", "hog8", "release", "duty:compact",
                 "pinned", "duty:nocompact"]:
        if f"{name}:start" not in snaps:
            continue
        pct, cs, (t0, t1) = window(snaps, name)
        used = sorted(c for c, p in pct.items() if p >= BUSY)
        act = active_in(rows, t0, t1) if not name.endswith(("eevdf", "nocompact")) else []
        res[name] = dict(pct=pct, used=used, act=act, cs=cs)
        arange = f"{min(act)}–{max(act)}" if act else "n/a (all CPUs)"
        lines_tbl.append(f"| {name} | {arange} | {len(used)} | {used} | "
                         f"{sum(pct.values())/100:.2f} | {cs:.0f} |")

    def inside(name):
        r = res[name]
        allowed = set(order[:max(r["act"])]) if r["act"] else set()
        return set(r["used"]) <= allowed, sorted(allowed)

    if "idle" in res:
        a = res["idle"]["act"]
        check("F3a", f"idle: active set stays at the minimum ({min_a})",
              bool(a) and max(a) == min_a, f"nr_active={sorted(set(a))}")
    if "hog1" in res:
        ok, allowed = inside("hog1")
        a = res["hog1"]["act"]
        check("F3b", "1 hog: set stays small and every used CPU is inside it",
              ok and bool(a) and max(a) <= min_a + 1,
              f"nr_active={sorted(set(a))}, used={res['hog1']['used']}, allowed={allowed}")
    if "hog4" in res:
        ok, allowed = inside("hog4")
        a = res["hog4"]["act"]
        check("F3c", "4 hogs: set expands to fit the load, used CPUs inside it",
              ok and bool(a) and max(a) >= 4 and len(res["hog4"]["used"]) >= 4,
              f"nr_active={sorted(set(a))}, used={res['hog4']['used']}")
    if "hog8" in res:
        a = res["hog8"]["act"]
        check("F3d", f"8 hogs: set expands to all {max_a} CPUs and all are used",
              bool(a) and max(a) == max_a and len(res["hog8"]["used"]) >= nproc - 1,
              f"nr_active={sorted(set(a))}, used={len(res['hog8']['used'])} CPUs")
    if "release" in res:
        a = res["release"]["act"]
        check("F3e", "load removed: set shrinks back to the minimum (hysteresis)",
              bool(a) and a[-1] == min_a, f"nr_active in window={sorted(set(a))}, last={a[-1] if a else None}")
    if "duty:compact" in res and "duty:eevdf" in res:
        c, e = res["duty:compact"], res["duty:eevdf"]
        ok, allowed = inside("duty:compact")
        check("F4a", "8×20% duty load: compact uses fewer CPUs than EEVDF, all inside the set",
              ok and len(c["used"]) < len(e["used"]),
              f"compact used {len(c['used'])} CPUs {c['used']} (set {sorted(set(c['act']))}); "
              f"EEVDF used {len(e['used'])}")
    if "duty:nocompact" in res and "duty:compact" in res:
        n = res["duty:nocompact"]
        check("F4b", "control (-n): same load spreads like EEVDF when compaction is off",
              len(n["used"]) > len(res["duty:compact"]["used"]),
              f"nocompact used {len(n['used'])} CPUs {n['used']}")
    if "pinned" in res:
        r = res["pinned"]
        last = nproc - 1
        outside = bool(r["act"]) and order.index(last) >= max(r["act"])
        check("F5", f"task pinned to CPU {last} (outside the active set) is not starved",
              outside and r["pct"].get(last, 0) >= 80,
              f"CPU{last} busy {r['pct'].get(last, 0):.0f}%, nr_active={sorted(set(r['act']))}, "
              f"rank of CPU{last}={order.index(last) if order else '?'}")
    dm = (run / "dmesg_sched_ext.txt").read_text() if (run / "dmesg_sched_ext.txt").exists() else ""
    bad = [l for l in dm.splitlines() if re.search(r"error|stall|watchdog|runnable task stall", l, re.I)]
    check("F6", "no sched_ext error / watchdog event in dmesg", not bad,
          f"{len(dm.splitlines())} sched_ext dmesg lines, {len(bad)} error lines")

    report = [f"# Functional run `{run.name}`", "",
              f"CPU preference order: {order}; min={min_a} max={max_a}", "",
              "| id | check | result | evidence |", "|---|---|---|---|", *lines, "",
              "Per-window measurements (/proc/stat, kernel accounting):", "", *lines_tbl, "",
              f"**{sum(checks)}/{len(checks)} checks passed.**"]
    text = "\n".join(report) + "\n"
    print(text)
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text)
    sys.exit(0 if all(checks) else 1)


if __name__ == "__main__":
    main()
