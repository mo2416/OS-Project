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

<!-- SECTIONS 6-8 ARE WRITTEN AFTER THE REPEATED VALIDATION -->
