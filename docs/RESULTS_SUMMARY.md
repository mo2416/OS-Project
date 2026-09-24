# Current Results Summary (2026-09-24)

Setup: Linux 6.18.53 guest with sched_ext, under KVM (QEMU) on WSL2. 8 vCPUs as
4 cores × 2 SMT threads, 3 GB RAM. All numbers come from the files cited. Repetition
counts are small (2–3), so treat the differences as indicative, not statistically tested.

## Hypothesis
Core compaction reduces the number of CPUs in use under partial load without
unacceptable performance degradation.

## 1. Functional correctness: 12/12 checks pass
`results/processed/functional_20260924T094713Z.md` (placement from `/proc/stat`)
- Idle or 1 hog: active set = 2 CPUs, and all load stays inside it.
- 4 hogs: the set grows to 6; 8 hogs: all 8 CPUs are used.
- When load is removed, the set shrinks back to 2.
- A task pinned to CPU 7 (outside the set) runs at 100 %.
- No sched_ext errors or stalls in dmesg. Attach and detach are clean (exit 0).

## 2. Partial load: main result
`results/processed/bench_partial_20260924T095946Z.md`. Workload: 8 workers × duty %
of a 20 ms period, fixed work, 250 iterations (ideal 5.0 s), 3 reps.

| duty | CPUs used EEVDF → compact | active set (mean) | slowdown EEVDF / compact | wake p99 µs EEVDF / compact | runqueue wait/slice µs EEVDF / ctl / compact |
|---|---|---|---|---|---|
| 20 % | 6.0 → **3.0** | 2.8 | 1.022 / 1.014 | 574 / 430 | 9 / 31 / 31 |
| 40 % | 7.7 → **5.3** | 5.1 | 1.034 / 1.044 | 377 / **2460** | 7 / 42 / **247** |
| 60 % | 8.0 → **7.0** | 6.9 | 1.062 / 1.055 | 430 / 389 | 6 / 54 / 124 |

("ctl" = `scx_compact -n`, the same sched_ext code with compaction off.)

- **CPUs used fall at every duty tested** (by 3.0, 2.3 and 1.0 CPUs). The CPUs left idle are
  fully parked (< 1 % busy): 5.0, 2.3 and 1.0 of 8 on average.
- **Completion time is unchanged within about 1 %** (slowdown ratio to EEVDF 0.993 / 1.009 / 0.994).
- **Cost: tail latency at 40 %.** Wakeup p99 rises by about 2.1 ms and runqueue wait per slice
  from 7 µs to 247 µs, because 3.2 CPUs of demand run on about 5 CPUs. At 20 % and 60 % the
  p99 is not worse than EEVDF.
- **sched_ext overhead is separate from compaction:** the `-n` control already raises
  wait/slice from 6–9 µs to 31–54 µs, while its completion time matches EEVDF.

## 3. Parameter sweep (2 reps, indicative)
`results/processed/sweep_20260924T100355Z.md`, 40 % duty unless noted:

| config | CPUs used | slowdown | wake p99 µs | wait/slice µs |
|---|---|---|---|---|
| base (shrink 50 %, EWMA 1/8, queue hold 2) | 5.5 | 1.041 | 1113 | 171 |
| shrink 35 % | 6.5 | 1.046 | 1488 | 169 |
| shrink 65 % | 5.0 | 1.039 | 1186 | 144 |
| no averaging (`-w 0`) | 5.5 | 1.047 | 1285 | 151 |
| longer averaging (`-w 5`) | 5.0 | 1.050 | 2450 | 317 |
| queue hold 1 (`-Q 1`) | 5.0 | 1.043 | **582** | **51** |
| queue hold 4 (`-Q 4`) | 5.0 | 1.059 | 1278 | 183 |

- A higher shrink threshold compacts more (35 → 50 → 65 %: 6.5 → 5.5 → 5.0 CPUs) at no extra slowdown.
- Longer averaging is the worst trade: the smallest set but the worst tail. At 60 % it gives a slowdown of 1.091.
- `-Q 1` gave the best 40 % tail latency. At 60 %, `-Q 1` and `-Q 4` both had higher slowdown
  (1.085/1.087 vs 1.062). The base p99 at 40 % differs between the two runs (1113 vs 2460 µs),
  so tail-latency differences below about 2× are within run-to-run noise.
- The defaults were **not** changed. More reps are needed before retuning.

## 4. Context switches (time-boxed)
`results/processed/ctxsw_20260924T100950Z.md`, 8 busy loops, 2 reps:
steady-state ctxsw/s is 933 (compact), 925 (ctl), 899 (compact with the set starting full)
and 1158 (EEVDF). The first second after the loops start is higher for all sched_ext variants
(2448–2579 vs 1814). The extra switches come from the sched_ext path during task start-up,
not from compaction in steady state. The +25 % seen at N=8 in the initial stress-ng benchmark
was not reproduced with plain busy loops. That remainder is **unexplained** and recorded as an
observed overhead.

## 5. Energy PROXY (not measured energy)
WSL2/QEMU exposes no RAPL counters and no cpuidle residency, so energy is **not measured**.
Proxy: E = Σ busy_s·1.0 + idle_s·0.3 (CPU used) + idle_s·0.05 (CPU parked), assumed coefficients.
Compact/EEVDF proxy ratio: **0.64 / 0.86 / 0.94** at 20 / 40 / 60 %. With other coefficient sets
((0.5, 0.10) and (0.2, 0.0)) the ratios are 0.58–0.65 / 0.81–0.87 / 0.92–0.94: the ranking holds,
but the magnitude depends on the assumptions.

## Verdict on the hypothesis (for this setup)
Supported for CPU count at 20–60 % load, with completion time unchanged within about 1 %.
"Without unacceptable degradation" holds for throughput. At 40 % load the tail latency is
clearly worse (p99 about 2 ms higher), and that is the main trade-off to report.
