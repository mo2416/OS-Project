# Next-Phase Decision (after `43370e2`)

Date: 2026-09-24. Scope unchanged: *Energy-Aware CPU Scheduling in Linux using sched_ext:
Core-Compaction Scheduling for Reduced Energy Consumption* (scx_compact vs EEVDF).

## 1. Gap analysis: what is weakest now

| Candidate weakness | Evidence | Severity |
|---|---|---|
| **Statistical confidence** | All benchmarks have 2–3 reps with min/max only; the 40 % base p99 was 1113 µs in one run and 2460 µs in another (`sweep_…100355Z` vs `bench_partial_…095946Z`) | **High**: no comparison is defensible yet |
| **Tail latency at 40 % load** | p99 wake 377 → 2460 µs vs EEVDF; per rep 3265 / 3421 / 693 µs, max 14–17 ms (`results/raw/bench_partial/20260924T095946Z/runs.csv`) | **High**: this is the "unacceptable degradation" part of the hypothesis |
| Realistic latency workload | Only dutywork's own wakeup lateness is measured | Medium |
| Parameter stability | Sweep has 2 reps, and the trends sit inside the noise | Medium |
| SMT/CPU order (`-o core`) | Implemented, never run | Low–medium (a VM does not model SMT power anyway) |
| Comparison with scx_lavd | No Rust toolchain; the scx tree needs `cargo` plus a multi-GB build on the C:-backed WSL disk, which already filled twice (PROGRESS_LOG rows 4, 8, 12) | Valuable but **infeasible this phase** |
| Real energy (RAPL) | No bare-metal Linux available; WSL2/QEMU has no powercap/cpuidle | **Cannot be done**; stays pending |

### Root cause of the 40 % tail latency (from existing data)
Per-rep controller state during `compact:d40` (`compact.csv` in the run above):

| rep | mean / min active set | mean demand | wake p99 | explanation |
|---|---|---|---|---|
| 1 | 4.85 / 4 | 3.11 CPUs | 3265 µs | the set sits at **4** (ρ ≈ 0.78) |
| 2 | 5.77 / 2 | 3.10 CPUs | 3421 µs | starts at 2 after the idle gap, then ramps up |
| 3 | 5.00 / 5 | 3.12 CPUs | 693 µs | one extra CPU → p99 close to EEVDF |

The expand rule sizes the set as `floor(demand / 0.80) + 1 = 4` for 3.1 CPUs of demand, and
it stays there because demand never exceeds 80 % × 4. Utilization cannot see burstiness: with
8 bursty workers on a shared queue, a mean utilization of 0.78 already gives multi-millisecond
queueing delays. This is **over-compaction by the sizing rule**, not a sched_ext framework
cost: the `-n` control has p99 337–591 µs.

## 2. Selected work (two items)

**1. Latency guard in the controller (small extension, option C).**
Measure what the policy harms, directly: the time from enqueue to running, for every
dispatch. The controller keeps a decayed fraction of waits longer than `-L` µs. If that
fraction exceeds `-P` ‰ (i.e. the estimated p(1-P) queueing delay exceeds L), it adds one
CPU and pauses further latency-driven expansion for a short cooldown. While the fraction is
above half the target, shrinking is blocked. Recovery uses the existing slow shrink
hysteresis. The rule is general (a queueing-delay target, like an SLO), configurable, and
off with `-L 0`. It uses no workload knowledge.

**2. Repeated, interleaved validation (options A + B).**
10 reps per condition, with conditions interleaved inside each rep (to avoid drift bias).
Loads: 20 / 40 / 60 % duty and ~100 % (99 % duty). Conditions: EEVDF, `-n` control,
scx_compact base, scx_compact + guard. Each run also carries an independent **latency probe**
(1 ms periodic SCHED_OTHER sleeper, cyclictest-style) as a latency-sensitive task under
background load. Reported: mean ± SD, 95 % CI, median; p50/p95/p99 latency.

Why these two: they address the two high-severity gaps with the least new code, and they
turn the main trade-off into a measured result with a tested mitigation. The hypothesis
("fewer CPUs without unacceptable degradation") is tested directly.

## 3. Explicitly not doing this phase
scx_lavd build (infeasible, see above); RAPL (no hardware); SMT-order study (a VM cannot show
its energy effect; kept as pending bare-metal work); a new sweep beyond the guard's own
on/off comparison; DVFS or any other new mechanism.
