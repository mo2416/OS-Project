# Next-Phase Results (commits `958b081`, `20012ec`)

Decision document: `docs/NEXT_PHASE_DECISION.md`. Main data:
`results/processed/bench_repeated_20260924T111310Z.md` (raw data:
`results/raw/bench_repeated/20260924T111310Z/`).

## 1. Complete before this phase (up to `43370e2`)
- Guest kernel 6.18.53 with sched_ext; scx_compact (active CPU set, shared vtime DSQ,
  pinned-task escape, EWMA controller with hysteresis) builds and runs under KVM.
- Functional suite F1–F6: 12/12 pass.
- Preliminary benchmarks (2–3 reps): partial-load CPU reduction, a 40 % tail-latency cost,
  a small parameter sweep, a context-switch check and a labelled energy proxy.

## 2. New work in this phase
| Item | What | Evidence |
|---|---|---|
| Diagnosis | 40 % tail latency caused by the utilization sizing rule (set at 4 CPUs for 3.1 CPUs of bursty demand) and by ramp-up from 2 CPUs | `docs/NEXT_PHASE_DECISION.md` §1, per-rep table from `results/raw/bench_partial/20260924T095946Z/compact.csv` |
| **Latency guard** (new controller mechanism) | Measures policy-induced queueing delay (shared-DSQ insert → `ops.running`) over all dispatches of unrestricted tasks. If more than P ‰ wait over L µs, it adds 1 CPU (cooldown 8 ticks) and blocks shrinking while above P/2. Options `-L`, `-P`; off by default | `scheduler/scx_compact.bpf.c` (`ctl_timerfn`, `compact_running`, `compact_enqueue`, `compact_quiescent`, `compact_init_task`); commit `958b081` |
| Guard metric validation | Five diagnostic iterations; see §5 for what they revealed | `results/raw/vm/guard_diag_1..6.log` |
| Regression | Functional suite still 12/12 with the new code | `results/processed/functional_20260924T111109Z.md` |
| Latency probe | `tests/latprobe.c`: 1 ms periodic SCHED_OTHER sleeper (cyclictest-style), run alongside every benchmark run | `tests/latprobe.c` |
| **Repeated validation** | 10 reps × 4 conditions × 4 loads = 160 runs, interleaved and rotated within each rep; paired bootstrap statistics | `tests/vm_bench_repeated.sh`, `tests/analyze_repeated.py`; commit `20012ec` |

## 3. Why this work
The two weakest points were statistical confidence (2–3 reps, p99 varying ~2× between runs)
and the unaddressed tail-latency cost, which is the "without unacceptable degradation" half
of the hypothesis. A scx_lavd comparison was infeasible (no Rust toolchain, disk risk on C:),
and RAPL is impossible in this environment. See the decision document.

## 4. Experimental evidence (MEASURED, n = 10 per cell)
Setup: 8 vCPUs (4 cores × 2 SMT), KVM guest on WSL2. 8 dutywork workers × duty % of 20 ms,
fixed work (ideal 5.0 s), plus latprobe. `guard` = `scx_compact -L 1000 -P 10`
(p99 target: 1 ms policy-induced queueing delay).

**Means** (95 % CI half-width in the report):

| duty | metric | EEVDF | `-n` control | compact | guard |
|---|---|---|---|---|---|
| 20 % | CPUs used | 6.0 | 7.3 | **3.0** | **4.0** |
| 20 % | CPUs parked (<1 % busy) | 1.3 | 0.0 | 5.0 | 3.3 |
| 20 % | probe p99 µs | 350 | 415 | 3224 | 489 |
| 20 % | dutywork wake p99 µs | 376 | 412 | 1542 | 535 |
| 40 % | CPUs used | 7.8 | 8.0 | **5.4** | **7.0** |
| 40 % | probe p99 µs | 389 | 426 | 1782 | 446 |
| 40 % | dutywork wake p99 µs | 369 | 414 | 814 | 602 |
| 60 % | CPUs used | 8.0 | 8.0 | **6.9** | 7.9 |
| 60 % | probe p99 µs | 1408 (median 509) | 432 | 1751 | 437 |
| 99 % | CPUs used | 8.0 | 8.0 | 8.0 | 8.0 |
| 99 % | probe p99 µs | 1046 | 3439 | 3354 | 3274 |

**Paired differences vs EEVDF** (same rep; [95 % bootstrap CI]; bold = CI excludes 0):

| duty | compact − EEVDF: CPUs | probe p99 µs | slowdown | guard − EEVDF: CPUs | probe p99 µs | slowdown |
|---|---|---|---|---|---|---|
| 20 % | **−3.0 [−3.6, −2.3]** | **+2874 [2155, 3565]** | **+0.016 [0.001, 0.039]** | **−2.0 [−2.8, −1.3]** | **+139 [66, 214]** | −0.002 [−0.039, 0.032] |
| 40 % | **−2.4 [−2.9, −1.9]** | **+1392 [704, 2120]** | +0.014 [−0.014, 0.058] | **−0.8 [−1.3, −0.4]** | **+56 [6, 117]** | −0.008 [−0.082, 0.058] |
| 60 % | **−1.1 [−1.5, −0.7]** | +343 [−422, 1085] | +0.009 [−0.075, 0.099] | −0.1 [−0.3, 0.0] | **−972 [−1716, −241]** | −0.012 [−0.126, 0.090] |
| 99 % | 0.0 | **+2307 [1699, 2929]** | −0.003 [−0.201, 0.180] | 0.0 | **+2227 [1575, 2892]** | −0.012 [−0.209, 0.168] |

**Findings.**
1. **Compaction frees CPUs** at every partial load (−3.0 / −2.4 / −1.1). Completion time is
   unchanged except a small +1.6 % at 20 % load.
2. **Compaction has a clear latency cost** at 20 % and 40 % load (probe p99 +2.9 ms / +1.4 ms).
   This **revises** the earlier 3-rep claim that 20 % load had no latency cost; that earlier
   run was underpowered and did not include the probe.
3. **The latency guard removes most of that cost**: probe p99 falls by 2.7 ms (20 %) and
   1.3 ms (40 %) versus compact, to within +0.14 / +0.06 ms of EEVDF. It keeps 2.0 (20 %) and
   0.8 (40 %) CPUs fewer than EEVDF. The price is about one CPU less compaction than without
   the guard (guard − compact: +1.0 / +1.6 / +1.0 CPUs).
4. **At 60 % the guard gives up almost all compaction** (−0.1 CPUs, not significant).
5. **At ~100 % load all sched_ext conditions**, including the `-n` control, have probe p99
   about 2.2–2.4 ms higher than EEVDF. Runqueue wait is 425–496 µs/slice vs 16 µs. This is a
   cost of the base policy under full load (a woken task waits for a 5 ms slice to end; there
   is no wakeup preemption as in EEVDF), not of compaction.
6. **Energy proxy (MODELED, not measured)**, compact / guard relative to EEVDF: 20 % 0.72 / 0.82
   (both CIs exclude 0); 40 % 0.87 / 0.91 (compact clear, guard not); 60 %: neither clear.

## 5. New limitations discovered
- **Host drift:** mean slowdown per rep ranged 0.95–1.34 (host frequency and load changes
  under WSL2). Unpaired comparisons of completion time are unreliable; only paired
  comparisons are reported as clear or not clear.
- **Nested-virtualization wakeups:** wakeups to halted vCPUs often take > 1 ms (guard diag
  runs 1–3, all conditions), and every run has an occasional 100–200 ms maximum lateness,
  including under `-n`. p95/p99 are therefore used, and max values are not interpreted.
- **Metric design lessons (from the guard diagnostics):** counting all dispatch waits
  mis-measures policy delay, because halted-vCPU wakeups and per-CPU kthreads dominate it;
  the decay needed fixed-point arithmetic; the denominator must be all dispatches, not
  only queued ones.
- **The guard's thresholds (1 ms, 1 %) are one configuration**, not a tuned optimum. It is not
  enabled by default, so the functional suite validates the default (guard-off) behaviour.
- **Full-load latency penalty** of the base policy (finding 5) is not addressed.
- Still no measured energy, no bare metal, no realistic application workload, no scx_lavd comparison.

## 6. Completion estimate (technical components, not documents)
| Component | Status |
|---|---|
| Kernel + VM + toolchain | done |
| Scheduler core (active set, placement, escape, controller) | done, verified |
| Latency guard | done, validated (n = 10) |
| Functional validation | done (12/12, regression-tested) |
| Partial-load performance/latency evaluation with statistics | done (n = 10, paired CIs) |
| Parameter study | preliminary only (2 reps, not repeated) |
| SMT/CPU-order study | not run |
| Realistic workload | not run |
| Existing-scheduler comparison (scx_lavd) | not feasible yet |
| Measured energy (RAPL, bare metal) | not possible in current environment |
| Final report/demo | not started |

**Estimate: about 65 % of the core technical work** (up from about 45–50 %). The evaluated
scheduler with a latency-aware controller is complete. The remaining ~35 % is mostly
validation that needs a different environment (bare-metal RAPL, SMT) plus the realistic
workload and final packaging.

## 7. Remaining for final completion
1. Bare-metal Linux run with RAPL (package/core energy) for EEVDF vs compact vs guard; SMT-order study there.
2. One realistic workload (e.g. a kernel/compile build at a limited `-j`, or a request/response server) with the latency probe.
3. Repeated (n ≥ 10) check of 2–3 guard and shrink settings to choose a recommended default.
4. Investigate or document the full-load base-policy latency (wakeup preemption is out of scope unless cheap).
5. scx_lavd comparison if a Rust toolchain can be installed off C:.
6. Final report, demo script, and slides.
