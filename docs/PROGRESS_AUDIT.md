# Progress Audit

Each claim is listed with the artifact that supports it. "Verified" means the artifact
was produced by running the code (not only written). Status as of the commit that
last changed this file.

## Implementation claims

| # | Claim | Status | Evidence |
|---|---|---|---|
| A1 | Guest kernel 6.18.53 built with sched_ext and BTF | Verified | `results/raw/build/kernel_build_3.log` (`EXIT 0`); `vm/scx-guest.config`; build is in commit `182a48c` |
| A2 | Guest boots under KVM, and sched_ext is available | Verified | `results/raw/vm/functional_2.log`: `Hypervisor detected: KVM`, `sched_ext_state: disabled` before attach (F1a) |
| A3 | scx_compact (BPF + loader) and scx_qmap build | Verified | `results/raw/build/scheduler_build.log` (`EXIT 0`); `scheduler/Makefile` |
| A4 | scx_compact attaches, runs and detaches cleanly | Verified | `results/raw/vm/smoke_1.log`; F2 in both functional reports (`exit=0`, `state_after: disabled`) |
| A5 | Load is confined to the active set (compaction) | Verified | F3a/F3b: idle and 1 hog → `nr_active=2`, used CPUs ⊆ first 2 CPUs of the order (`results/processed/functional_20260924T094713Z.md`) |
| A6 | Set expands with load | Verified | F3c: 4 hogs → `nr_active=6`; F3d: 8 hogs → 8 CPUs, all used |
| A7 | Set shrinks after load is removed (hysteresis) | Verified | F3e: `nr_active` back to 2 in the release window |
| A8 | Pinned task outside the set is not starved | Verified | F5: CPU7 100 % busy while `nr_active=2` (CPU7 has rank 7) |
| A9 | No sched_ext errors or watchdog stalls | Verified | F6: 0 error lines in `dmesg_sched_ext.txt` (both runs) |
| A10 | Compaction off (`-n`) behaves like EEVDF placement (control) | Verified | F4b: 8 CPUs used for the 8×20 % load, same as EEVDF |
| A11 | EWMA controller reduces CPUs used under bursty partial load | Verified (1 run each) | F4a: 7 CPUs (run `…T094417Z`, original) → 5 CPUs (run `…T094713Z`, EWMA); EEVDF 8 |
| A12 | No throughput loss for CPU-saturating fixed work | Verified (3 reps) | `results/processed/bench_initial_20260924T094952Z.md`: wall within ~2 % of EEVDF for N=1..8 |
| A13 | Under partial load, fewer CPUs are used than with EEVDF | Verified (3 reps) | `results/processed/bench_partial_20260924T095946Z.md`: 6.0→3.0 (20 %), 7.7→5.3 (40 %), 8.0→7.0 (60 %) |
| A14 | Partial-load completion time is not degraded | Verified (3 reps) | same report: slowdown ratio vs EEVDF 0.993 / 1.009 / 0.994 |
| A15 | Tail-latency cost at 40 % load | Verified (3 reps) | same report: wake p99 377 → 2460 µs; runqueue wait/slice 7 → 247 µs |
| A16 | Sweep trends | Indicative (2 reps) | `results/processed/sweep_20260924T100355Z.md` |
| A17 | Steady-state ctxsw is not raised by compaction | Verified (2 reps) | `results/processed/ctxsw_20260924T100950Z.md` |

## Open or unverified items

| # | Item | Status |
|---|---|---|
| U1 | +25 % context switches at N=8 with stress-ng (row 18) | Partly explained: sched_ext start-up transient (A17); the rest is unexplained |
| U2 | Latency on a realistic latency-sensitive workload | Not measured (synthetic dutywork only) |
| U3 | Energy | **Not measured**: no RAPL or cpuidle in WSL2/QEMU. Only a coefficient-based proxy (0.64/0.86/0.94) is reported |
| U4 | Statistical confidence | 2–3 reps, min/max only; the 40 % p99 varies ~2× between runs |
| U5 | Retuned defaults | Not done on purpose; the sweep has too few reps |
