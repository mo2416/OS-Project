# Review-2 Presentation (slide outline)

Source of every number: `docs/REVIEW2_FINAL.md` (and the result files cited there).

---
### Slide 1 — Title
**Energy-Aware CPU Scheduling in Linux using sched_ext: Core-Compaction Scheduling for Reduced Energy Consumption**
BCSE303P Operating Systems Lab · [Member 1] · [Member 2] · Guide: [Faculty Name]

---
### Slide 2 — Background & problem
- EEVDF (Linux default) spreads a light load over all CPUs, so every core wakes often.
- Energy-Aware Scheduling does not apply to symmetric x86 CPUs with SMT.
- **Core compaction:** pack a light load onto few CPUs and let the others stay idle.
  The idea exists (Windows core parking, scx_lavd); **we do not claim it is new**.
- Our contribution: a minimal, observable sched_ext implementation with an explicit controller,
  a control condition, and an honest, measured trade-off.

---
### Slide 3 — Objectives
1. BPF scheduler with a load-sized active CPU set (expand/shrink with hysteresis)
2. Correctness: no starvation, clean attach/detach
3. Measure CPUs freed vs completion time and latency, against EEVDF
4. Bound the latency cost with a simple controller mechanism
5. Energy: proxy now, RAPL measurement later (PENDING)

---
### Slide 4 — Design
- Active set = first `nr_active` CPUs of a topology order; only those CPUs pull work.
- Controller every 20 ms (BPF timer): EWMA demand → expand at > 80 %, shrink at ≤ 50 % over 5 ticks; queue-hold expansion.
- **Latency guard:** if > 1 % of dispatches wait > 1 ms in the shared queue, add a CPU and block shrinking.
- `-n` = same code with compaction off (isolates the sched_ext framework's own cost).
- *(Insert: architecture diagram from REVIEW2_FINAL §5.)*

---
### Slide 5 — Environment & implementation status
- WSL2 kernel lacks sched_ext, so we built a 6.18.53 guest kernel and run it under KVM.
- scx_compact: 473-line BPF policy + 294-line loader; builds and runs.
- Functional suite: **12/12 pass** (re-run after the latest change).
- *(Insert screenshot: `results/raw/vm/smoke_1.log` lines "BPF scheduler "compact" enabled" + telemetry.)*

---
### Slide 6 — Result 1: CPUs freed (MEASURED, n = 10)
| Load | EEVDF | compact | guard |
|---|---|---|---|
| 20 % | 6.0 | **3.0** | **4.0** |
| 40 % | 7.8 | **5.4** | **7.0** |
| 60 % | 8.0 | **6.9** | 7.9 |
CPUs ≥ 10 % busy. Completion time: no significant change (+1.6 % for compact at 20 %).
*(Insert per-CPU busy % table from `bench_repeated_20260924T111310Z.md`.)*

---
### Slide 7 — Result 2: the latency trade-off (MEASURED, n = 10)
| Load | Probe p99: EEVDF | compact | guard |
|---|---|---|---|
| 20 % | 350 µs | 3224 µs | 489 µs |
| 40 % | 389 µs | 1782 µs | 446 µs |
- Compaction alone: +2.9 / +1.4 ms p99 (clear).
- The guard removes most of that (+0.14 / +0.06 ms vs EEVDF) and still frees 2.0 / 0.8 CPUs.
- At full load, every sched_ext condition (even compaction off) is +2.3 ms: a base-policy cost.

---
### Slide 8 — Energy: what we can and cannot say
- **Not measured:** no RAPL or cpuidle in WSL2/QEMU.
- **Model proxy** (idle time weighted by parked vs used CPUs; assumed coefficients):
  compact 0.72, guard 0.82 of EEVDF at 20 % load.
- The real measurement needs bare-metal Linux: the first item of the remaining work.

---
### Slide 9 — Recent contributions (since Review-1)
- Kernel + VM environment; scheduler implemented and validated.
- Controller v2 (EWMA): 7 → 5 CPUs under bursty load.
- Latency guard: diagnosed the root cause (sizing rule), designed a policy-delay metric, validated at n = 10.
- Paired statistics revealed an earlier wrong claim ("no latency cost at 20 %"), now corrected.

---
### Slide 10 — Limitations & remaining work
- VM (nested virtualization); host drift → paired analysis; synthetic workloads.
- Remaining: RAPL on bare metal · SMT order · one realistic workload · guard/shrink settings · full-load latency · optional scx_lavd · final report/demo.
- Estimated core technical completion: **about 65 %**.
