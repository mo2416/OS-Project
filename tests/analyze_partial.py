#!/usr/bin/env python3
"""Summarize a partial-load benchmark or sweep run (tests/vm_bench_partial.sh).

Per run window (kernel accounting unless noted):
  CPUs used      CPUs >= 10 % busy (/proc/stat)
  parked CPUs    CPUs < 1 % busy (/proc/stat)
  active set     mean / max nr_active from the scx_compact CSV (scheduler's own state)
  wall, slowdown completion time of the fixed work (dutywork), ideal = iters x period
  run p99        per-iteration duration of the work phase (dutywork)
  wake p50/p99   wakeup lateness after a timed sleep (dutywork)
  wait/slice     mean runqueue wait per timeslice = d(run_delay) / d(pcount)
                 (/proc/schedstat, sched_info; scheduler-class independent)
  ctxsw/s        /proc/stat ctxt
  wakeups/s      local-timer + rescheduling interrupts, all CPUs (/proc/interrupts;
                 NO_HZ_IDLE, so an idle CPU takes few timer interrupts)

ENERGY PROXY (not a measurement: WSL2/QEMU exposes no RAPL or cpuidle residency):
  E_proxy = sum over CPUs of  busy_s * 1.0
                            + idle_s * 0.30   if the CPU was used (>= 1 % busy)
                            + idle_s * 0.05   if the CPU was parked (< 1 % busy)
  in "active-CPU-second equivalents". The coefficients are assumptions that stand in
  for "idle between frequent wakeups (shallow C-state)" and "idle for the whole
  window (deep C-state possible)". Only relative comparisons between conditions are
  meaningful, and they depend on those assumed coefficients.

Usage: analyze_partial.py <run-dir> [--out report.md]
"""
import csv, statistics as st, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from analyze_functional import parse_procstat, BUSY  # noqa: E402

PARKED = 1.0
K_BUSY, K_IDLE_USED, K_IDLE_PARKED = 1.0, 0.30, 0.05


def parse_sched(path):
    snaps, cur = {}, None
    for line in path.read_text().splitlines():
        if line.startswith("== "):
            label, t = line[3:].rsplit(" ", 1)
            cur = snaps[label] = {"t": float(t), "delay": 0, "pcount": 0, "irq": 0}
        elif line.startswith("ss cpu"):
            f = line.split()
            # "ss cpuN yld 0 sched_count goidle ttwu ttwu_local rq_cpu_time run_delay pcount"
            cur["delay"] += int(f[9]); cur["pcount"] += int(f[10])
        elif line.strip().startswith(("LOC:", "RES:")):
            cur["irq"] += sum(int(x) for x in line.split()[1:] if x.isdigit())
    return snaps


def csv_rows(path):
    if not path.exists():
        return []
    with path.open() as f:
        return [{k: float(v) for k, v in r.items()} for r in csv.DictReader(f)]


def main():
    run = Path(sys.argv[1])
    out = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else None
    ps, ss = parse_procstat(run / "procstat.txt"), parse_sched(run / "sched.txt")
    tick = 100.0  # USER_HZ: /proc/stat counts in 1/100 s
    groups, order = defaultdict(list), []
    sched_csv = {}
    with (run / "runs.csv").open() as f:
        runs = list(csv.DictReader(f))
    for r in runs:
        c, d = r["cond"], int(r["duty"])
        if c not in order:
            order.append(c)
        if c not in sched_csv:
            sched_csv[c] = csv_rows(run / f"{c}.csv")
        L = f"{c}:d{d}:r{r['rep']}"
        a, b = ps[f"{L}:start"], ps[f"{L}:end"]
        dt = b["t"] - a["t"]
        busy_pct, busy_s, idle_s = {}, {}, {}
        for cpu in a["cpu"]:
            db = b["cpu"][cpu][0] - a["cpu"][cpu][0]
            dtot = b["cpu"][cpu][1] - a["cpu"][cpu][1]
            busy_pct[cpu] = 100.0 * db / dtot if dtot else 0.0
            busy_s[cpu] = db / tick
            idle_s[cpu] = (dtot - db) / tick
        used = sum(p >= BUSY for p in busy_pct.values())
        parked = [cpu for cpu, p in busy_pct.items() if p < PARKED]
        e = sum(K_BUSY * busy_s[c_] + (K_IDLE_PARKED if c_ in parked else K_IDLE_USED) * idle_s[c_]
                for c_ in busy_s)
        sa, sb = ss[f"{L}:start"], ss[f"{L}:end"]
        dp = sb["pcount"] - sa["pcount"]
        rows = [x for x in sched_csv[c] if a["t"] <= x["mono_s"] <= b["t"]]
        act = [x["nr_active"] for x in rows]
        groups[(c, d)].append(dict(
            used=used, parked=len(parked), act_mean=st.mean(act) if act else None,
            act_max=max(act) if act else None, wall=float(r["wall_s"]),
            slow=float(r["slowdown"]), run99=float(r["run_p99_ms"]),
            wake50=float(r["wake_p50_us"]), wake99=float(r["wake_p99_us"]),
            wait=(sb["delay"] - sa["delay"]) / dp / 1e3 if dp else 0.0,
            cs=(b["ctxt"] - a["ctxt"]) / dt, irq=(sb["irq"] - sa["irq"]) / dt,
            busy=sum(busy_s.values()), idle_parked=sum(idle_s[x] for x in parked),
            e=e, pct=busy_pct))

    m = lambda v, k: st.mean(x[k] for x in v)  # noqa: E731
    env = [l for l in (run / "env.txt").read_text().splitlines() if not l.startswith("cpu")]
    lines = [f"# Partial-load run `{run.name}`", "", *[f"- {l}" for l in env], "",
             "Means over repetitions. Energy proxy: see the definition below the tables.", "",
             "| cond | duty | reps | CPUs used | parked | active set mean/max | wall s | slowdown | "
             "run p99 ms | wake p50/p99 µs | wait/slice µs | ctxsw/s | wakeups/s | busy CPU-s | "
             "parked idle CPU-s | E_proxy |",
             "|" + "---|" * 16]
    duties = sorted({d for _, d in groups})
    for d in duties:
        for c in order:
            v = groups.get((c, d))
            if not v:
                continue
            act = (f"{m(v, 'act_mean'):.1f}/{max(x['act_max'] for x in v):.0f}"
                   if v[0]["act_mean"] is not None else "–")
            lines.append(
                f"| {c} | {d}% | {len(v)} | {m(v, 'used'):.1f} | {m(v, 'parked'):.1f} | {act} | "
                f"{m(v, 'wall'):.3f} | {m(v, 'slow'):.4f} | {m(v, 'run99'):.2f} | "
                f"{m(v, 'wake50'):.0f}/{m(v, 'wake99'):.0f} | {m(v, 'wait'):.0f} | {m(v, 'cs'):.0f} | "
                f"{m(v, 'irq'):.0f} | {m(v, 'busy'):.2f} | {m(v, 'idle_parked'):.2f} | {m(v, 'e'):.2f} |")

    base = order[0]
    lines += ["", f"Relative to `{base}` (same duty):", "",
              "| cond | duty | Δ CPUs used | slowdown ratio | Δ wake p99 µs | E_proxy ratio | "
              "slowdown range over reps |", "|---|---|---|---|---|---|---|"]
    for d in duties:
        b = groups.get((base, d))
        for c in order[1:]:
            v = groups.get((c, d))
            if not v or not b:
                continue
            sl = [x["slow"] for x in v]
            lines.append(f"| {c} | {d}% | {m(v, 'used') - m(b, 'used'):+.1f} | "
                         f"{m(v, 'slow') / m(b, 'slow'):.3f} | {m(v, 'wake99') - m(b, 'wake99'):+.0f} | "
                         f"{m(v, 'e') / m(b, 'e'):.3f} | {min(sl):.4f}–{max(sl):.4f} |")

    lines += ["", "Mean per-CPU busy % (CPU 0..N-1; SMT pairs are (0,1), (2,3), ...):", "",
              "| cond | duty | per-CPU busy % |", "|---|---|---|"]
    for d in duties:
        for c in order:
            v = groups.get((c, d))
            if v:
                cpus = sorted(v[0]["pct"])
                lines.append(f"| {c} | {d}% | " + " ".join(
                    f"{st.mean(x['pct'][k] for x in v):.0f}" for k in cpus) + " |")

    lines += ["", "**Energy proxy definition (NOT measured energy):** E_proxy = Σ_cpu busy_s·"
              f"{K_BUSY} + idle_s·{K_IDLE_USED} (CPU used, ≥{PARKED:.0f}% busy) + idle_s·{K_IDLE_PARKED} "
              f"(CPU parked, <{PARKED:.0f}% busy). The coefficients are assumptions; WSL2/QEMU exposes no "
              "RAPL counters and no cpuidle residency. It only ranks conditions under this model."]
    st_file = run / "states.txt"
    if st_file.exists():
        lines += ["", "Scheduler exits: " + ", ".join(st_file.read_text().split("\n")).strip(", ")]
    dm = run / "dmesg_sched_ext.txt"
    if dm.exists():
        bad = [l for l in dm.read_text().splitlines() if "error" in l.lower() or "stall" in l.lower()]
        lines.append(f"sched_ext dmesg error/stall lines: {len(bad)}")
    text = "\n".join(lines) + "\n"
    print(text)
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text)


if __name__ == "__main__":
    main()
