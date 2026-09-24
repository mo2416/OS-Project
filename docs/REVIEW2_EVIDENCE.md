# Review-2 Evidence: scx_compact (BCSE303P)

Each item gives the claim, the artifact and how to reproduce it. Numbers: `docs/RESULTS_SUMMARY.md`.

## What was built (original work)
| Component | File | Size |
|---|---|---|
| BPF sched_ext policy: active CPU set, shared vtime DSQ, pinned-task escape, EWMA controller with expand/shrink hysteresis | `scheduler/scx_compact.bpf.c` | 368 lines |
| Userspace loader: topology-based CPU order, tunables, CSV telemetry | `scheduler/scx_compact.c`, `scx_compact.h` | 286 + 32 lines |
| Guest kernel config and build with a disk guard | `vm/scx-guest.config`, `vm/build_kernel.sh` | |
| KVM test VM (host root over 9p, job runner) | `vm/run_vm.sh`, `vm/guest_init.sh` | |
| Functional suite F1–F6 with independent `/proc/stat` checking | `tests/vm_functional.sh`, `tests/analyze_functional.py` | |
| Fixed-work duty-cycle workload with latency percentiles | `tests/dutywork.c` | 160 lines |
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

## Limitations to state at the review
1. **No energy measurement.** WSL2/QEMU exposes no RAPL or cpuidle, so only a coefficient-based proxy is reported.
2. **VM, not bare metal.** vCPUs are host threads, and "parked" guest CPUs do not map to host C-states.
3. **Small samples.** 2–3 reps with min/max only. p99 varies about 2× between runs.
4. **Synthetic workloads only** (busy loops, stress-ng, dutywork).
5. The +25 % context switches at N=8 with stress-ng are not fully explained.
6. `scx_simple` could not be built on 6.18.53 (kfunc mismatch), so `scx_qmap` is the reference scheduler.

## Remaining work for the final project
1. More repetitions (≥ 10) with confidence intervals for the partial-load matrix.
2. A realistic latency-sensitive workload (e.g. `schbench`, or a request/response server) alongside dutywork.
3. Decide the defaults from a repeated sweep (candidates: shrink 65 %, queue hold 1).
4. Compare against an existing sched_ext scheduler with a power-saving mode (e.g. scx_lavd,
   see `docs/RESEARCH_DECISION.md`), if it builds for 6.18.
5. If bare-metal Linux with RAPL is available, measure energy directly; otherwise keep the proxy clearly labelled.
6. `-o smt` vs `-o core` ordering comparison (implemented, not yet evaluated).
7. Final report and demo script.
