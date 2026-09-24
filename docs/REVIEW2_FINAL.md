# Review-2 Progress Report

## 1. Project Title & Team Details

| Item | Details |
|---|---|
| Project title | **Energy-Aware CPU Scheduling in Linux using sched_ext: Core-Compaction Scheduling for Reduced Energy Consumption** |
| Working subtitle | A transparent, load-adaptive core-compaction scheduler (`scx_compact`) |
| Course | BCSE303P – Operating Systems Lab |
| Department / School | [Department / School name] |
| Team members | [Member 1 name – Register number] · [Member 2 name – Register number] |
| Guide / Faculty | [Faculty Name] |
| Slot / Semester | [Slot] · [Semester, academic year] |
| Repository | Git history from `bd87660` (baseline) to the commit that adds this document |

## 2. Introduction & Background

**Background.** The Linux CPU scheduler decides which runnable task runs on which CPU and when.
The default scheduler since Linux 6.6 is EEVDF (Earliest Eligible Virtual Deadline First). On
symmetric multi-core machines it spreads runnable tasks over idle CPUs, which favours
throughput and latency. Linux's Energy Aware Scheduling (EAS) only works on asymmetric
(big.LITTLE-style) CPUs with an energy model, and it does not support SMT, so a typical x86
laptop or server has no energy-driven task packing in the mainline scheduler.

**Context.** A modern CPU saves most of its idle power when cores reach *deep* idle states
(C-states), and a core can only stay there if nothing wakes it. When a light load is spread
over all cores, every core wakes up frequently and none stays deeply idle. **Core compaction**
packs a light load onto as few CPUs as possible, lets the rest stay idle, and expands again
when load grows. Windows ("core parking") and the sched_ext scheduler scx_lavd already use it.

**sched_ext** (Linux ≥ 6.12) lets a scheduling policy be written as a BPF program that the
kernel loads at run time, through callbacks such as `select_cpu`, `enqueue`, `dispatch`,
`running` and `stopping`. The kernel falls back to EEVDF if the BPF scheduler misbehaves.
This makes it possible to build and evaluate a real kernel CPU scheduler in a student project.

**Relevance to Operating Systems.** The project deals directly with CPU scheduling: run queues
(dispatch queues), time slices, CPU selection, context switches, CPU affinity, load
measurement, and the trade-off between waiting time / turnaround time and resource usage.

## 3. Problem Statement

**Problem.** Under partial load, the default Linux scheduler on symmetric CPUs keeps many
CPUs lightly busy instead of a few CPUs well utilized. This limits how much time CPUs can
spend fully idle.

**Existing limitation.**
- EEVDF has no energy-driven packing on symmetric x86 CPUs, and EAS does not apply there.
- Existing compaction (scx_lavd) is combined with many other mechanisms (latency-criticality
  scoring, autopilot modes, a Rust control plane). The effect of compaction alone is hard to
  isolate, study or tune.
- Naive packing has a known cost: tasks queue behind each other on the few active CPUs,
  which increases scheduling latency.

**Scope.** A sched_ext BPF scheduler that sizes an active CPU set by load, with an explicit
hysteresis rule and (added in this phase) a latency guard. It is evaluated against EEVDF on
completion time, CPUs used, scheduling latency, context switches and CPU idle time.
Out of scope: DVFS/frequency control, ML policies, application-specific tuning, and
asymmetric (big.LITTLE) energy models. Energy is **not measured** in the current environment
(no RAPL or cpuidle in WSL2/QEMU); only a clearly labelled proxy is reported.

## 4. Objectives

**Main objective.** Design, implement and evaluate a transparent core-compaction CPU scheduler
for Linux using sched_ext that reduces the number of CPUs in use under partial load, without
unacceptable loss of performance or latency.

**Specific objectives.**
1. Implement an active-CPU-set scheduler in BPF (sched_ext) with load-driven expand/shrink and hysteresis.
2. Guarantee correctness: no starvation of affinity-restricted tasks, clean attach/detach, no watchdog errors.
3. Make the policy observable (per-interval CSV telemetry) and provide a built-in control condition (`-n`, compaction off).
4. Evaluate against EEVDF with reproducible fixed-work workloads and repeated, statistically summarized runs.
5. Measure the latency cost of compaction and bound it with a simple, explainable controller mechanism.
6. Energy: report an idle-time-based **proxy** now; direct RAPL measurement on bare metal is future work.

**Expected outcome.** A working scheduler plus evidence of *how many CPUs it frees* at 20–60 %
load, *what it costs* in completion time and tail latency, and whether the latency guard
reduces that cost. The claims are limited to what the measurements support.

## 5. Methodology / System Design

**Proposed approach.** Keep an *active CPU set* made of the first `nr_active` CPUs of a
topology-derived preference order. Woken tasks go only to idle CPUs inside the set; CPUs
outside it do not pull work, so they stay idle. A periodic BPF timer (the controller, every
20 ms) resizes the set from measured demand, queue length and (optionally) queueing delay.

**System architecture.**
```
 user space                                  kernel (sched_ext, BPF)
 ┌────────────────────────┐   rodata     ┌──────────────────────────────────────────┐
 │ scx_compact loader     │─────────────▶│ select_cpu: idle CPU inside active set?  │
 │ - CPU order (topology) │  tunables    │   yes → local DSQ of that CPU            │
 │ - tunables (-e -s -w…) │              │   no  → enqueue → shared vtime DSQ       │
 │ - CSV telemetry  ◀─────┼── .bss/maps ─│ dispatch: only active CPUs pull shared   │
 └────────────────────────┘   stats      │ enqueue: affinity outside set → LOCAL_ON │
                                         │ running/stopping: busy time, queue wait  │
                                         │ BPF timer (20 ms): controller            │
                                         │   demand EWMA → expand / shrink          │
                                         │   queue hold  → expand                   │
                                         │   latency guard → expand, block shrink   │
                                         └──────────────────────────────────────────┘
```

**Controller rules** (`scheduler/scx_compact.bpf.c`, `ctl_timerfn`):
- *Demand:* busy time summed over CPUs per interval, smoothed by an EWMA (weight 1/8).
- *Expand:* if demand > 80 % of the set's capacity, grow to the smallest set under 80 %;
  if ≥ `nr_active` tasks have been queued for 2 consecutive ticks, grow by 1 + queued/2.
- *Shrink:* by one CPU when demand would fit in `nr_active − 1` CPUs at ≤ 50 %, the queue is
  empty, for 5 consecutive ticks (hysteresis).
- *Latency guard* (`-L`/`-P`, new in this phase): track the fraction of dispatches that waited
  more than L µs in the shared queue. If it exceeds P ‰, add a CPU (with a cooldown), and block
  shrinking while the fraction is above P/2.

**Technologies / tools / OS concepts.** Linux 6.18.53 with `CONFIG_SCHED_CLASS_EXT` and BTF;
BPF (clang, libbpf, bpftool skeletons, BPF timers, array and task-storage maps); QEMU/KVM guest
on WSL2; C for the loader and workloads; Python for analysis. OS concepts: scheduling classes,
run queues/dispatch queues, virtual-time fair ordering, time slices, CPU affinity, idle CPU
selection, context switching, waiting time, NO_HZ idle, `/proc/stat` and `/proc/schedstat`
accounting.

**Major modules.**

| Module | Files |
|---|---|
| BPF scheduling policy + controller | `scheduler/scx_compact.bpf.c`, `scx_compact.h` |
| Userspace loader + telemetry | `scheduler/scx_compact.c` |
| Guest kernel + test VM | `vm/scx-guest.config`, `vm/build_kernel.sh`, `vm/run_vm.sh`, `vm/guest_init.sh` |
| Workloads | `tests/dutywork.c` (fixed-work duty cycle), `tests/latprobe.c` (latency probe) |
| Test and benchmark jobs | `tests/vm_functional.sh`, `vm_bench_*.sh`, `vm_sweep.sh`, `vm_ctxsw.sh` |
| Analysis | `tests/analyze_*.py` |

## 6. Work Completed / Current Progress

Everything in this section has been built and run. The last column gives the evidence
(repository paths; commit IDs in `docs/PROGRESS_LOG.md`).
Result labels: **MEASURED** · **MODELED** (proxy) · **OBSERVED** (not statistically
established) · **PENDING**.

### 6.1 Environment / setup completed
| Item | Status | Evidence |
|---|---|---|
| Sudo-free toolchain sysroot (clang, pahole, QEMU, stress-ng) | done | `scripts/localenv.sh` |
| Linux 6.18.53 guest kernel with `CONFIG_SCHED_CLASS_EXT=y`, BTF | built | `results/raw/build/kernel_build_3.log` (`EXIT 0`) |
| KVM test VM booting the host root over 9p, job runner | working | `vm/run_vm.sh`, `results/raw/vm/smoke_1.log` (`Hypervisor detected: KVM`) |

The WSL2 host kernel itself has no sched_ext, so all scheduler runs happen in the guest.

### 6.2 Implemented modules
| Module | Status | Evidence |
|---|---|---|
| scx_compact BPF policy: active CPU set, idle-CPU placement inside the set, shared vtime queue, dispatch only on active CPUs, escape path for affinity-restricted tasks | implemented, verified | `scheduler/scx_compact.bpf.c` (473 lines) |
| Controller (BPF timer, 20 ms): EWMA demand, expand/shrink with hysteresis, queue-hold expansion | implemented, verified | `ctl_timerfn` |
| Latency guard (`-L`, `-P`) | implemented, verified (n = 10) | `ctl_timerfn`, `compact_running`, `compact_quiescent` |
| Loader: topology-based CPU order, 13 policy options (incl. control mode `-n`), CSV telemetry | implemented | `scheduler/scx_compact.c` |
| Workloads: fixed-work duty cycle, 1 ms latency probe | implemented | `tests/dutywork.c`, `tests/latprobe.c` |
| Test / benchmark / analysis harness | implemented | `tests/vm_*.sh`, `tests/analyze_*.py` |

### 6.3 Tests completed (MEASURED)
Functional suite F1–F6: **12/12 pass**, re-run after the latest scheduler change
(`results/processed/functional_20260924T111109Z.md`). CPU placement is checked from kernel
accounting (`/proc/stat`), not from the scheduler's own counters.

| Check | Result |
|---|---|
| sched_ext present; reference scheduler `scx_qmap` attaches/detaches | pass |
| scx_compact attaches, runs all phases, exits cleanly (exit 0) | pass |
| Idle and 1 busy task: set stays at 2 CPUs, all load inside it | pass |
| 4 / 8 busy tasks: set expands (6 / 8 CPUs) | pass |
| Load removed: set shrinks back to 2 | pass |
| Duty load: compact uses fewer CPUs than EEVDF; the `-n` control does not | pass |
| Task pinned outside the set is not starved (CPU 7 busy 100 %) | pass |
| No sched_ext error/stall in dmesg | pass |

### 6.4 Benchmarking completed and results
**Main experiment (MEASURED, n = 10 per cell,
`results/processed/bench_repeated_20260924T111310Z.md`).** 8 fixed-work workers × duty % of a
20 ms period (ideal 5 s) plus a 1 ms latency probe; 4 conditions interleaved in each rep;
paired bootstrap 95 % CIs. `guard` = `scx_compact -L 1000 -P 10`.

| Load | CPUs used EEVDF / compact / guard | Probe p99 µs EEVDF / compact / guard |
|---|---|---|
| 20 % | 6.0 / 3.0 / 4.0 | 350 / 3224 / 489 |
| 40 % | 7.8 / 5.4 / 7.0 | 389 / 1782 / 446 |
| 60 % | 8.0 / 6.9 / 7.9 | 1408 (median 509) / 1751 / 437 |
| 99 % | 8.0 / 8.0 / 8.0 | 1046 / 3354 / 3274 |

Paired differences vs EEVDF (bold = 95 % CI excludes 0):

| Load | compact: CPUs | compact: probe p99 | guard: CPUs | guard: probe p99 | completion time (compact / guard) |
|---|---|---|---|---|---|
| 20 % | **−3.0** | **+2.87 ms** | **−2.0** | **+0.14 ms** | **+1.6 %** / n.s. |
| 40 % | **−2.4** | **+1.39 ms** | **−0.8** | **+0.06 ms** | n.s. / n.s. |
| 60 % | **−1.1** | n.s. | −0.1 (n.s.) | **−0.97 ms** | n.s. / n.s. |
| 99 % | 0 | **+2.31 ms** | 0 | **+2.23 ms** | n.s. / n.s. |

Earlier preliminary runs (2–3 reps): a fixed-work CPU-bound benchmark (wall time within ~2 % of
EEVDF), a parameter sweep (OBSERVED trends only), and a context-switch check (no steady-state
increase from compaction) — `results/processed/`.

**Energy (MODELED, not measured).** Idle-time proxy relative to EEVDF: compact 0.72 / 0.87 /
0.92 and guard 0.82 / 0.91 / 0.94 at 20 / 40 / 60 %. The coefficients are assumptions
(`tests/analyze_partial.py`). **No energy consumption has been measured.**

### 6.5 Current limitations
1. **No real energy measurement:** WSL2/QEMU exposes no RAPL or cpuidle data (PENDING: bare metal).
2. **Virtual machine:** vCPUs are host threads (nested virtualization). An idle guest CPU is
   not a parked physical core; wakeups to halted vCPUs can take > 1 ms; occasional 100–200 ms
   maxima occur in every condition, so only p95/p99 are interpreted.
3. **Host drift:** per-rep mean slowdown ranged 0.95–1.34, so only paired comparisons are used.
4. **Synthetic workloads only** (dutywork, latprobe, busy loops, stress-ng).
5. **Full-load latency:** every sched_ext condition (including compaction off) has about 2.3 ms
   higher probe p99 than EEVDF at ~100 % load. The base policy has no wakeup preemption.
6. The guard thresholds (1 ms, 1 %) are one configuration; the parameter sweep is preliminary (2 reps).
7. No comparison with an existing sched_ext scheduler yet (scx_lavd needs a Rust toolchain).

### 6.6 Current status
The scheduler, controller and latency guard are implemented and validated in the VM. The
core hypothesis (fewer CPUs used under partial load) is **supported by measurement**. The
latency trade-off is **measured**, and a mitigation is **validated**. **Energy savings are not
yet demonstrated.** Estimated core technical completion: **about 65 %**
(`docs/NEXT_PHASE_RESULTS.md` §6).

## 7. Last Contributions / Recent Progress

Review-1 presented the idea: core-compaction scheduling with sched_ext, compared against
EEVDF. Since Review-1 (repository history from `bd87660`):

1. **Made sched_ext usable in this environment.** The WSL2 kernel lacks sched_ext, so we built a
   6.18.53 guest kernel and a KVM test VM. Build blockers were resolved: the C: disk filled
   during linking, a paths-with-spaces bug in the tools build, a kfunc missing on 6.18
   (`scx_bpf_task_set_dsq_vtime`), and QEMU firmware paths (`docs/PROGRESS_LOG.md` rows 4–15).
2. **Implemented scx_compact** (BPF policy + loader) and brought it up on sched_ext; it passes
   all 12 functional checks.
3. **Controller improvement 1, demand smoothing.** The first controller reacted to 20 ms
   samples and inflated the set under bursty load. With EWMA smoothing and sustained-queue
   expansion, CPUs used under the 8×20 % duty load fell from 7 to 5 (functional F4a, one run each).
4. **Controller improvement 2, latency guard (newest contribution).** The latency cost was
   diagnosed from the controller's own telemetry: the utilization rule left 4 CPUs for
   3.1 CPUs of bursty demand. A guard was added that measures *policy-induced* queueing delay
   and expands the set when its p99 estimate exceeds a target. Diagnostic runs showed that a
   naive "all waits" metric measures hypervisor wake-up cost and per-CPU kthreads instead of
   policy delay, so the metric counts only shared-queue waits of unrestricted tasks.
5. **New tests and workloads:** fixed-work duty-cycle workload, cyclictest-style latency probe,
   repeated interleaved benchmark with paired bootstrap statistics.
6. **Measured results (n = 10):**
   - compaction frees 3.0 / 2.4 / 1.1 CPUs at 20 / 40 / 60 % load;
   - it costs +2.9 / +1.4 ms probe p99 at 20 / 40 % load;
   - the guard cuts that to +0.14 / +0.06 ms while keeping 2.0 / 0.8 CPUs parked.
7. **Parameter validation (preliminary, 2 reps):** a higher shrink threshold compacts more; a
   longer averaging window worsens tail latency; queue hold 1 looked best at 40 %.
8. **New observations:**
   - an earlier 3-rep result ("no latency cost at 20 %") was **overturned** by the n = 10 run
     with the probe;
   - the full-load latency penalty belongs to the sched_ext base policy, not to compaction;
   - context switches are not increased by compaction in steady state.

## 8. Remaining Work & Future Plan

| # | Remaining item | Type | Plan |
|---|---|---|---|
| 1 | **Energy measurement with RAPL** (package/core joules) for EEVDF vs compact vs guard | validation, PENDING | Bare-metal Linux boot (USB or dual boot) on the project laptop; `perf stat -e power/energy-pkg/` or powercap sysfs; same dutywork matrix, n ≥ 10 |
| 2 | SMT / CPU-order study (`-o smt` vs `-o core`) | validation, PENDING | On bare metal only (a VM cannot show SMT power effects) |
| 3 | Realistic workload | validation, PENDING | One application workload (e.g. a limited-parallelism kernel/compile build, or a request/response server) with the latency probe |
| 4 | Guard and shrink settings | experiment, PENDING | n = 10 check of 2–3 settings; decide whether the guard becomes the default |
| 5 | Full-load base-policy latency | investigation, PENDING | Document it, or try a small wakeup-preemption change if it is cheap |
| 6 | Comparison with scx_lavd (powersave) | comparison, optional | Only if a Rust toolchain can be installed off C:; used as a reference, with no superiority claims |
| 7 | Final report, demo script, slides | documentation | Demo: live `scx_compact` telemetry under changing load |

**Timeline (relative to Review-2; fill in the dates):**

| Period | Work |
|---|---|
| Week 1 after Review-2 | Bare-metal Linux setup; RAPL access; repeat the n = 10 matrix with energy (items 1–2) |
| Week 2 | Realistic workload; guard/shrink settings check (items 3–4) |
| Week 3 | Full-load latency note; optional scx_lavd (items 5–6) |
| Week 4 | Final report, demo, slides (item 7) |

If bare metal is not available, items 1–2 remain future work, and the final report keeps the
energy result as a clearly labelled proxy.

