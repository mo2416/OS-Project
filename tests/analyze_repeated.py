#!/usr/bin/env python3
"""Statistics for the repeated partial-load validation (tests/vm_bench_repeated.sh).

Per run (one condition x duty x rep) the metrics are computed as in analyze_partial.py
(kernel accounting from /proc/stat, /proc/schedstat, /proc/interrupts; latency from
dutywork and latprobe; active set from the scx_compact CSV of that rep).

Across the REPS runs of each (condition, duty) it reports mean ± SD, a 95 % confidence
interval of the mean (Student t) and the median. For the key comparisons it reports the
mean of PAIRED differences (same rep, same duty; conditions are interleaved within a rep,
so pairing cancels host drift between reps) with a 95 % bootstrap CI (10 000 resamples,
fixed seed). A difference is called "clear" only when that CI excludes 0.

The energy proxy is the model defined in analyze_partial.py (NOT measured energy).

Usage: analyze_repeated.py <run-dir> [--out report.md]
"""
import csv, math, random, statistics as st, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from analyze_functional import parse_procstat, BUSY  # noqa: E402
from analyze_partial import parse_sched, csv_rows, PARKED, K_BUSY, K_IDLE_USED, K_IDLE_PARKED  # noqa: E402

# two-sided 95 % Student t critical values, df = 1..30
T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179,
       2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064,
       2.060, 2.056, 2.052, 2.048, 2.045, 2.042]
METRICS = [  # key, label, format
    ("used", "CPUs used (≥10 % busy)", "{:.2f}"),
    ("parked", "CPUs parked (<1 % busy)", "{:.2f}"),
    ("act", "active set (mean)", "{:.2f}"),
    ("slow", "slowdown (wall / ideal)", "{:.4f}"),
    ("wake95", "dutywork wake p95 µs", "{:.0f}"),
    ("wake99", "dutywork wake p99 µs", "{:.0f}"),
    ("run99", "work-phase p99 ms", "{:.2f}"),
    ("probe95", "probe p95 µs", "{:.0f}"),
    ("probe99", "probe p99 µs", "{:.0f}"),
    ("wait", "runqueue wait/slice µs", "{:.0f}"),
    ("cs", "ctxsw/s", "{:.0f}"),
    ("irq", "timer+resched irq/s", "{:.0f}"),
    ("idle", "idle CPU-s", "{:.2f}"),
    ("e", "E_proxy (model)", "{:.2f}"),
]


def ci95(v):
    n = len(v)
    if n < 2:
        return float("nan")
    return T95[min(n - 1, 30) - 1] * st.stdev(v) / math.sqrt(n)


def boot_diff(a, b, n=10000, seed=1):
    """95 % bootstrap CI of mean(a) - mean(b)."""
    rng = random.Random(seed)
    d = sorted(st.mean(rng.choices(a, k=len(a))) - st.mean(rng.choices(b, k=len(b))) for _ in range(n))
    return st.mean(a) - st.mean(b), d[int(0.025 * n)], d[int(0.975 * n) - 1]


def boot_paired(a, b, n=10000, seed=1):
    """95 % bootstrap CI of the mean paired difference a[rep] - b[rep]."""
    d0 = [a[r] - b[r] for r in sorted(a) if r in b]
    rng = random.Random(seed)
    d = sorted(st.mean(rng.choices(d0, k=len(d0))) for _ in range(n))
    return st.mean(d0), d[int(0.025 * n)], d[int(0.975 * n) - 1]


def collect(run):
    ps, ss = parse_procstat(run / "procstat.txt"), parse_sched(run / "sched.txt")
    tick = 100.0
    g = defaultdict(list)
    conds = []
    cache = {}
    with (run / "runs.csv").open() as f:
        for r in csv.DictReader(f):
            c, d, rep = r["cond"], int(r["duty"]), r["rep"]
            if c not in conds:
                conds.append(c)
            L = f"{c}:d{d}:r{rep}"
            a, b = ps[f"{L}:start"], ps[f"{L}:end"]
            dt = b["t"] - a["t"]
            pct, busy_s, idle_s = {}, {}, {}
            for cpu in a["cpu"]:
                db = b["cpu"][cpu][0] - a["cpu"][cpu][0]
                dtot = b["cpu"][cpu][1] - a["cpu"][cpu][1]
                pct[cpu] = 100.0 * db / dtot if dtot else 0.0
                busy_s[cpu], idle_s[cpu] = db / tick, (dtot - db) / tick
            parked = {cpu for cpu, p in pct.items() if p < PARKED}
            e = sum(K_BUSY * busy_s[x] + (K_IDLE_PARKED if x in parked else K_IDLE_USED) * idle_s[x]
                    for x in busy_s)
            sa, sb = ss[f"{L}:start"], ss[f"{L}:end"]
            dp = sb["pcount"] - sa["pcount"]
            key = (c, rep)
            if key not in cache:
                cache[key] = csv_rows(run / f"{c}.r{rep}.csv")
            act = [x["nr_active"] for x in cache[key] if a["t"] <= x["mono_s"] <= b["t"]]
            g[(c, d)].append(dict(
                used=sum(p >= BUSY for p in pct.values()), parked=len(parked),
                act=st.mean(act) if act else float(len(pct)),
                slow=float(r["slowdown"]), wake95=float(r["wake_p95_us"]), wake99=float(r["wake_p99_us"]),
                run99=float(r["run_p99_ms"]), probe95=float(r["probe_p95_us"]),
                probe99=float(r["probe_p99_us"]),
                wait=(sb["delay"] - sa["delay"]) / dp / 1e3 if dp else 0.0,
                cs=(b["ctxt"] - a["ctxt"]) / dt, irq=(sb["irq"] - sa["irq"]) / dt,
                idle=sum(idle_s.values()), e=e, pct=pct, rep=int(rep)))
    return conds, g


def main():
    run = Path(sys.argv[1])
    out = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else None
    conds, g = collect(run)
    duties = sorted({d for _, d in g})
    env = [l for l in (run / "env.txt").read_text().splitlines() if not l.startswith("cpu")]
    L = [f"# Repeated partial-load validation `{run.name}`", "", *[f"- {l}" for l in env], "",
         "Cells: mean ± 95 % CI (median). n = runs per cell.", ""]
    for d in duties:
        L += [f"## Duty {d} %", "", "| metric | " + " | ".join(f"{c} (n={len(g[(c, d)])})" for c in conds) + " |",
              "|---|" + "---|" * len(conds)]
        for k, lab, fmt in METRICS:
            cells = []
            for c in conds:
                v = [x[k] for x in g[(c, d)]]
                cells.append(f"{fmt.format(st.mean(v))} ± {fmt.format(ci95(v))} ({fmt.format(st.median(v))})")
            L.append(f"| {lab} | " + " | ".join(cells) + " |")
        L.append("")

    pairs = [("compact", "eevdf"), ("guard", "eevdf"), ("guard", "compact"), ("nocompact", "eevdf")]
    keys = ["used", "slow", "wake99", "probe99", "wait", "e"]
    L += ["## Paired differences (same rep and duty) with 95 % bootstrap CI", "",
          "Mean of per-rep differences A − B [95 % CI]. **Bold** = CI excludes 0 (clear difference).", "",
          "| duty | A − B | " + " | ".join(dict((k, l) for k, l, _ in METRICS)[k] for k in keys) + " |",
          "|---|---|" + "---|" * len(keys)]
    for d in duties:
        for a, b in pairs:
            if (a, d) not in g or (b, d) not in g:
                continue
            cells = []
            for k in keys:
                m, lo, hi = boot_paired({x["rep"]: x[k] for x in g[(a, d)]},
                                        {x["rep"]: x[k] for x in g[(b, d)]})
                fmt = dict((kk, f) for kk, _, f in METRICS)[k]
                clear = "**" if lo > 0 or hi < 0 else ""
                cells.append(f"{clear}{fmt.format(m)} [{fmt.format(lo)}, {fmt.format(hi)}]{clear}")
            L.append(f"| {d} % | {a} − {b} | " + " | ".join(cells) + " |")

    L += ["", "## Mean per-CPU busy % (CPU 0..N-1; SMT pairs (0,1), (2,3), ...)", "",
          "| cond | duty | per-CPU busy % |", "|---|---|---|"]
    for d in duties:
        for c in conds:
            v = g[(c, d)]
            cpus = sorted(v[0]["pct"])
            L.append(f"| {c} | {d} % | " + " ".join(f"{st.mean(x['pct'][k] for x in v):.0f}" for k in cpus) + " |")

    L += ["", f"**Energy proxy (model, NOT measured):** E = Σ busy_s·{K_BUSY} + idle_s·{K_IDLE_USED} "
          f"(CPU ≥{PARKED:.0f} % busy) + idle_s·{K_IDLE_PARKED} (CPU parked). Coefficients are assumptions."]
    sf = run / "states.txt"
    if sf.exists():
        ex = [l.split(": ")[1] for l in sf.read_text().splitlines() if ": " in l]
        L.append(f"Scheduler exits: {len(ex)} runs, non-zero: {sum(e != '0' for e in ex)}")
    dm = run / "dmesg_sched_ext.txt"
    if dm.exists():
        bad = [l for l in dm.read_text().splitlines() if "error" in l.lower() or "stall" in l.lower()]
        L.append(f"sched_ext dmesg error/stall lines: {len(bad)}")
    ef = run / "errors.txt"
    L.append(f"Harness errors: {ef.read_text().strip() if ef.exists() else 'none'}")
    text = "\n".join(L) + "\n"
    print(text)
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text)


if __name__ == "__main__":
    main()
