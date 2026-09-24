# Review-2 Evidence: scx_compact (BCSE303P)

> The authoritative Review-2 report is `docs/REVIEW2_FINAL.md`. This file maps claims to
> artifacts. E10–E14 are preliminary (2–3 reps); E15–E19 (n = 10) supersede them where they conflict.

Each item gives the claim, the artifact and how to reproduce it. Numbers: `docs/RESULTS_SUMMARY.md`.

## What was built (original work)
| Component | File | Size |
|---|---|---|
| BPF sched_ext policy: active CPU set, shared vtime DSQ, pinned-task escape, EWMA controller with expand/shrink hysteresis, latency guard | `scheduler/scx_compact.bpf.c` | 473 lines |
| Userspace loader: topology-based CPU order, tunables, CSV telemetry | `scheduler/scx_compact.c`, `scx_compact.h` | 294 + 36 lines |
| Guest kernel config and build with a disk guard | `vm/scx-guest.config`, `vm/build_kernel.sh` | |
| KVM test VM (host root over 9p, job runner) | `vm/run_vm.sh`, `vm/guest_init.sh` | |
| Functional suite F1–F6 with independent `/proc/stat` checking | `tests/vm_functional.sh`, `tests/analyze_functional.py` | |
| Fixed-work duty-cycle workload with latency percentiles | `tests/dutywork.c` | 161 lines |
| Latency probe (1 ms periodic sleeper) | `tests/latprobe.c` | 64 lines |
| Repeated interleaved validation + paired-bootstrap analysis | `tests/vm_bench_repeated.sh`, `tests/analyze_repeated.py` | |
| Partial-load benchmark, sweep, ctxsw check and analyzers | `tests/vm_bench_partial.sh`, `vm_sweep.sh`, `vm_ctxsw.sh`, `analyze_partial.py`, `analyze_ctxsw.py` | |

Built on: the in-tree `tools/sched_ext` build system and headers (Linux 6.18.53). The policy
structure follows `scx_simple` (vtime ordering). The compaction, controller and escape logic are ours.

## Evidence checklist
| # | Claim | Artifact | Reproduce |
|---|---|---|---|
| E1 | Kernel built with sched_ext and BTF | `results/raw/build/kernel_build_3.log` (`EXIT 0`) | `vm/build_kernel.sh` |
| E2 | Scheduler builds | `results/raw/build/scheduler_build.log` | `source scripts/localenv.sh && make -C scheduler` |
| E3 | Runs on sched_ext under KVM | `results/raw/vm/smoke_1.log` (`BPF scheduler "compact" enabled`) | `vm/run_vm.sh tests/vm_smoke.sh` |
| E4 | 12/12 functional checks | `results/processed/functional_20260924T094713Z.md` | `vm/run_vm.sh tests/vm_functional.sh 8 3G` then `analyze_functional.py` |
| E5 | Compaction and expansion visible | same report, per-window table; `compact.csv` `nr_active` column | as E4 |
| E6 | Pinned task is not starved | F5 row | as E4 |
| E7 | Clean dmesg | F6 row; `dmesg_sched_ext.txt` in each run | as E4 |
| E8 | EWMA controller: 7 → 5 CPUs under the bursty 8×20 % load | F4a in `functional_20260924T094417Z.md` vs `…094713Z.md` | git `e927c43` |
| E9 | Fixed CPU-bound work: no throughput loss | `results/processed/bench_initial_20260924T094952Z.md` | `vm/run_vm.sh tests/vm_bench_initial.sh 8 3G` |
| E10 | Partial load: −3.0/−2.3/−1.0 CPUs, completion within ~1 % | `results/processed/bench_partial_20260924T095946Z.md` | `vm/run_vm.sh tests/vm_bench_partial.sh 8 3G` then `analyze_partial.py` |
| E11 | Latency trade-off at 40 % (p99 +2.1 ms) | same report | as E10 |
| E12 | Sweep trends (shrink threshold, averaging, queue hold) | `results/processed/sweep_20260924T100355Z.md` | `vm/run_vm.sh tests/vm_sweep.sh 8 3G` |
| E13 | Extra ctxsw is sched_ext start-up, not steady-state compaction | `results/processed/ctxsw_20260924T100950Z.md` | `vm/run_vm.sh tests/vm_ctxsw.sh 8 3G` |
| E14 | Energy **proxy** ratio 0.64/0.86/0.94 (model, not measurement) | E10 report footer; definition in `tests/analyze_partial.py` | as E10 |
| E15 | Root cause of the 40 % tail latency: sizing rule leaves 4 CPUs for 3.1 CPUs of bursty demand | `docs/NEXT_PHASE_DECISION.md` §1 | per-rep windows of `results/raw/bench_partial/20260924T095946Z/compact.csv` |
| E16 | Latency guard implemented; functional suite still 12/12 | `scheduler/scx_compact.bpf.c`; `results/processed/functional_20260924T111109Z.md`; commit `958b081` | `vm/run_vm.sh tests/vm_functional.sh 8 3G` |
| E17 | n = 10: compaction −3.0/−2.4/−1.1 CPUs; probe p99 +2.9/+1.4 ms at 20/40 % | `results/processed/bench_repeated_20260924T111310Z.md` (paired table) | `vm/run_vm.sh tests/vm_bench_repeated.sh 8 3G` then `analyze_repeated.py` |
| E18 | n = 10: guard −2.0/−0.8 CPUs with probe p99 +0.14/+0.06 ms vs EEVDF at 20/40 % | same | same |
| E19 | Full-load latency penalty is shared by the `-n` control (base-policy cost) | same, duty 99 % | same |

## Limitations to state at the review
1. **No energy measurement.** WSL2/QEMU exposes no RAPL or cpuidle, so only a coefficient-based proxy is reported.
2. **VM, not bare metal.** vCPUs are host threads, and "parked" guest CPUs do not map to host C-states.
3. **Host drift.** Per-rep mean slowdown ranged 0.95–1.34 in the n = 10 run; only paired comparisons are reliable. The E10–E14 preliminary results have 2–3 reps.
4. **Synthetic workloads only** (busy loops, stress-ng, dutywork).
5. The +25 % context switches at N=8 with stress-ng are not fully explained.
6. `scx_simple` could not be built on 6.18.53 (kfunc mismatch), so `scx_qmap` is the reference scheduler.

## Remaining work for the final project
See `docs/NEXT_PHASE_RESULTS.md` §7 and `docs/REVIEW2_FINAL.md` §8.
