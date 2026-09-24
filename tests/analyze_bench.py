#!/usr/bin/env python3
"""Summarize a raw initial-benchmark run (see tests/vm_bench_initial.sh).

Reports, per condition and worker count: mean/min/max wall time, mean CPUs used
(>=10% busy over the run, from /proc/stat) and mean context switches.
It only reports numbers; it draws no conclusions.

Usage: analyze_bench.py <run-dir> [--out report.md]
"""
import csv, statistics as st, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from analyze_functional import parse_procstat, window, BUSY  # noqa: E402


def main():
    run = Path(sys.argv[1])
    out = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else None
    snaps = parse_procstat(run / "procstat.txt")
    groups = defaultdict(list)
    with (run / "runs.csv").open() as f:
        for r in csv.DictReader(f):
            pct, _, _ = window(snaps, f"{r['cond']}:n{r['n']}:r{r['rep']}")
            used = sum(p >= BUSY for p in pct.values())
            groups[(r["cond"], int(r["n"]))].append((float(r["wall_s"]), used, int(r["ctxt"])))

    env = (run / "env.txt").read_text().splitlines()
    lines = [f"# Initial benchmark `{run.name}`", "", *[f"- {l}" for l in env if ":" in l and not l.startswith("cpu")], "",
             "| condition | workers | reps | wall s mean | min | max | CPUs used (mean) | ctx switches (mean) |",
             "|---|---|---|---|---|---|---|---|"]
    for cond in ["eevdf", "nocompact", "compact"]:
        for (c, n), v in sorted(groups.items(), key=lambda kv: kv[0][1]):
            if c != cond:
                continue
            w = [x[0] for x in v]
            lines.append(f"| {c} | {n} | {len(v)} | {st.mean(w):.2f} | {min(w):.2f} | {max(w):.2f} | "
                         f"{st.mean(x[1] for x in v):.1f} | {st.mean(x[2] for x in v):.0f} |")
    text = "\n".join(lines) + "\n"
    print(text)
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text)


if __name__ == "__main__":
    main()
