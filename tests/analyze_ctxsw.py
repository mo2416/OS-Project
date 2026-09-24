#!/usr/bin/env python3
"""Summarize tests/vm_ctxsw.sh: context-switch rate with 8 busy loops, split into the
ramp-up phase (0-1 s after the loops start) and the steady state (2-6 s).

Usage: analyze_ctxsw.py <run-dir> [--out report.md]
"""
import csv, re, statistics as st, sys
from collections import defaultdict
from pathlib import Path


def rate(rows, t0, t1):
    a = min(rows, key=lambda r: abs(r[0] - t0))
    b = min(rows, key=lambda r: abs(r[0] - t1))
    return (b[1] - a[1]) / (b[0] - a[0])


def main():
    run = Path(sys.argv[1])
    out = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else None
    per = defaultdict(list)
    with (run / "ctxt.csv").open() as f:
        for r in csv.DictReader(f):
            per[r["cond"]].append((float(r["t_s"]), int(r["ctxt"])))
    agg = defaultdict(lambda: defaultdict(list))
    for cond, rows in per.items():
        base = re.sub(r"_r\d+$", "", cond)
        agg[base]["ramp"].append(rate(rows, 0, 1.0))
        agg[base]["steady"].append(rate(rows, 2.0, 6.0))
        agg[base]["total"].append(rate(rows, 0, 6.0))
        log = run / f"{cond}.log"
        if log.exists():
            act = [int(m) for m in re.findall(r"active=\s*(\d+)", log.read_text())]
            agg[base]["act_first"].append(act[0] if act else None)
    lines = [f"# Context-switch check `{run.name}` (8 busy loops, 6 s, ctxt/s from /proc/stat)", "",
             "| cond | reps | ramp 0–1 s | steady 2–6 s | whole 0–6 s |", "|---|---|---|---|---|"]
    for c in ["eevdf", "nocompact", "compact", "compact_m8"]:
        if c in agg:
            a = agg[c]
            lines.append(f"| {c} | {len(a['steady'])} | {st.mean(a['ramp']):.0f} | "
                         f"{st.mean(a['steady']):.0f} | {st.mean(a['total']):.0f} |")
    text = "\n".join(lines) + "\n"
    print(text)
    if out:
        out.write_text(text)


if __name__ == "__main__":
    main()
