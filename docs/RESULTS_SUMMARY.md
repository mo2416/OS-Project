# Current Results Summary (updated after `20012ec`)

Setup: Linux 6.18.53 guest with sched_ext under KVM (QEMU) on WSL2; 8 vCPUs
(4 cores × 2 SMT), 3 GB RAM. Labels: **MEASURED** (from an experiment),
**MODELED** (energy proxy), **OBSERVED** (seen, not statistically established),
**PENDING**.

## Hypothesis
Core compaction reduces the number of CPUs in use under partial load without
unacceptable performance degradation.

## 1. Correctness (MEASURED)
Functional suite F1–F6: 12/12 pass, most recently with the latency-guard code in place
(`results/processed/functional_20260924T111109Z.md`):
- attach/detach is clean;
- idle and 1-hog load stay inside a 2-CPU set;
- the set expands (4 hogs → 6, 8 hogs → 8) and shrinks back to 2;
- a task pinned outside the set runs at 100 %;
- no sched_ext errors.

## 2. Main result: repeated validation (MEASURED, n = 10 per cell)
`results/processed/bench_repeated_20260924T111310Z.md`. 8 fixed-work workers × duty % of a
20 ms period, plus a 1 ms latency probe; conditions interleaved per rep; paired bootstrap CIs.
`guard` = `scx_compact -L 1000 -P 10`.

| duty | CPUs used: EEVDF / compact / guard | probe p99 µs: EEVDF / compact / guard | slowdown compact − EEVDF (paired) |
|---|---|---|---|
| 20 % | 6.0 / **3.0** / **4.0** | 350 / 3224 / 489 | +0.016 [0.001, 0.039] |
| 40 % | 7.8 / **5.4** / **7.0** | 389 / 1782 / 446 | +0.014 [−0.014, 0.058] (n.s.) |
| 60 % | 8.0 / **6.9** / 7.9 | 1408 (median 509) / 1751 / 437 | +0.009 [−0.075, 0.099] (n.s.) |
| 99 % | 8.0 / 8.0 / 8.0 | 1046 / 3354 / 3274 | −0.003 (n.s.) |

- Compaction frees 3.0 / 2.4 / 1.1 CPUs at 20 / 40 / 60 % load (all clear). Completion time is
  unchanged except +1.6 % at 20 %.
- **Latency cost:** compaction raises probe p99 by 2.9 ms (20 %) and 1.4 ms (40 %), both clear.
- **Latency guard:** it brings probe p99 back to within +0.14 ms (20 %) and +0.06 ms (40 %) of
  EEVDF while still using 2.0 and 0.8 fewer CPUs. At 60 % it keeps almost no compaction (−0.1, n.s.).
- **Full load:** all sched_ext conditions, including the `-n` control, have about 2.2–2.4 ms
  higher probe p99 than EEVDF (runqueue wait 425–496 vs 16 µs/slice). This is a base-policy
  cost (no wakeup preemption), not a compaction cost.

## 3. Energy proxy (MODELED, not measured)
E = Σ busy_s·1.0 + idle_s·0.3 (CPU used) + idle_s·0.05 (CPU parked); the coefficients are
assumptions (definition: `tests/analyze_partial.py`). Relative to EEVDF (n = 10):
compact 0.72 / 0.87 / 0.92 and guard 0.82 / 0.91 / 0.94 at 20 / 40 / 60 %. Only compact at 20 %
and 40 % and guard at 20 % have paired CIs that exclude 0. Real energy is **PENDING**
(needs bare-metal RAPL).

## 4. Preliminary results (2–3 reps; superseded where they conflict with §2)
- Partial load (`bench_partial_20260924T095946Z.md`, 3 reps): CPUs used 6.0→3.0, 7.7→5.3,
  8.0→7.0. That run showed *no* latency cost at 20 %; the n = 10 run with the probe
  **revises** this (§2).
- Sweep (`sweep_20260924T100355Z.md`, 2 reps, OBSERVED): a higher shrink threshold compacts
  more; longer averaging worsens the tail; `-Q 1` looked best at 40 %. Not repeated at n = 10.
- EWMA controller (functional F4a, 1 run each): 7 → 5 CPUs under the bursty 8×20 % load.
- Fixed CPU-bound work (`bench_initial_20260924T094952Z.md`, 3 reps): wall time within ~2 % of EEVDF.
- Context switches (`ctxsw_20260924T100950Z.md`, 2 reps): no steady-state increase from
  compaction; the start-up transient is shared by all sched_ext variants.

## Verdict (this environment)
- **CPU reduction under partial load: supported.**
- **"Without unacceptable degradation":** throughput is supported; latency is **not** for
  plain compaction (+1.4 to +2.9 ms p99). With the latency guard, latency is within about
  0.1 ms of EEVDF at 20–40 % load, while keeping part of the CPU reduction.
- Energy savings are not demonstrated: only a model proxy exists.
