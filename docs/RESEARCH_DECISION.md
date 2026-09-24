# Research Decision (Checkpoint A)

Date: 2026-09-24. Status: **LOCKED**.

Labels used below:
- **[FACT]** verified in documentation or source code (URL/path given)
- **[JUDGMENT]** engineering judgment / inference
- **[DECISION]** project decision

---

## 1. Original idea (Review-1)

"Energy-Aware CPU Scheduling in Linux using sched_ext: Core-Compaction Scheduling for Reduced
Energy Consumption" — a BPF scheduler that packs runnable work onto fewer cores at low load,
expands as contention grows, and is compared against Linux's default EEVDF scheduler.

## 2. What exists today

### sched_ext
- [FACT] sched_ext (`CONFIG_SCHED_CLASS_EXT`, Linux ≥ 6.12) lets a BPF program implement a
  scheduling class through `struct sched_ext_ops` callbacks (`select_cpu`, `enqueue`, `dispatch`,
  `running`, `stopping`, `init`, `exit`, ...). Tasks flow through dispatch queues (DSQs):
  `SCX_DSQ_GLOBAL`, per-CPU `SCX_DSQ_LOCAL` / `SCX_DSQ_LOCAL_ON|cpu`, and custom DSQs created
  with `scx_bpf_create_dsq()`. <https://docs.kernel.org/scheduler/sched-ext.html>
- [FACT] On any error, a stalled runnable task (watchdog), or SysRq-S, the kernel unloads the
  BPF scheduler and all tasks fall back to the fair class (EEVDF). Same doc.
- [FACT] In Linux 6.18 the helper names are `scx_bpf_dsq_insert[_vtime]` and
  `scx_bpf_dsq_move_to_local`; the old `scx_bpf_dispatch`/`scx_bpf_consume` names were removed
  after 6.15 (commit cc26abb1a19a). Verified in `kernel/sched/ext.c` of 6.18.
- [FACT] Minimal in-tree examples live in `tools/sched_ext/` (scx_simple, scx_qmap, scx_central,
  scx_flatcg, ...). Verified in the linux-6.18.53 tarball used for this project.

### EEVDF and EAS
- [FACT] EEVDF replaced CFS in 6.6: among tasks with non-negative lag, it runs the one with the
  earliest virtual deadline. <https://docs.kernel.org/scheduler/sched-eevdf.html>
- [FACT] Energy Aware Scheduling (EAS) is "only supported on platforms with asymmetric CPU
  topologies", needs an Energy Model, and "EAS on SMT is not supported".
  <https://docs.kernel.org/scheduler/sched-energy.html>
- [JUDGMENT] So on symmetric x86 SMP (our i7-13650HX exposes 20 identical logical CPUs to
  Linux under WSL2), the mainline scheduler has **no** energy-driven packing. It spreads work
  across idle CPUs for throughput and latency.

### Existing compaction / power-aware schedulers
- [FACT] **scx_lavd** (sched-ext/scx, Rust userspace plus BPF) already does *core compaction*:
  every ~10 ms it sizes an active CPU set from system utilization plus 25% headroom, walking
  CPUs in a preference order, with an overflow set for pinned/queued work. It has
  `--performance/--balanced/--powersave` and `--autopilot` modes. Source:
  `scheds/rust/scx_lavd/src/bpf/power.bpf.c`, `lavd.bpf.h`, `cpu_order.rs`.
- [FACT] scx_bpfland, scx_flash, scx_cosmos and scx_beerland offer a static
  `--primary-domain` (powersave/performance/mask) with spill-over. This is a fixed preferred
  set, not a dynamically sized one.
- [FACT] Windows core parking has had increase/decrease thresholds, hysteresis times and an
  SMT unpark policy for years (`CPMinCores`, `CPIncreaseTime`, `CPDecreaseTime`,
  `SmtUnparkPolicy`).
  <https://learn.microsoft.com/en-us/windows-hardware/customize/power-settings/configure-processor-power-management-options>
- [FACT] Linux removed `sched_mc_power_savings` in 3.5 because it was broken and its knob
  space was untunable (P. Zijlstra, LKML 2012). The "packing small tasks" patchset (V. Guittot,
  LWN 520857) was never merged and evolved into EAS.
- [FACT] Le Sueur & Heiser (USENIX ATC 2011): whether slowing down or racing to idle saves
  energy "is not clear-cut". On modern x86, energy savings mostly come from reaching deep
  core/package C-states.

## 3. Overlap assessment

- [JUDGMENT] A utilization-driven, dynamically sized active CPU set **substantially overlaps
  scx_lavd's core compaction**. Claiming the *idea* as novel would be false.
- [JUDGMENT] scx_lavd's compaction is entangled with latency-criticality scoring, a
  performance-vs-CPU-order table, autopilot and a Rust control plane. It cannot easily be
  studied or tuned in isolation, and it is not a minimal, readable teaching artifact.

## 4. Final direction [DECISION]

**Final title:**
*Energy-Aware CPU Scheduling in Linux using sched_ext: A Transparent, Load-Adaptive
Core-Compaction Scheduler*

We keep the Review-1 idea and refine the contribution into **a minimal, fully observable,
C/BPF core-compaction scheduler (`scx_compact`) with an explicit hysteresis rule**, plus an
**honest, measured comparison against EEVDF**. It is designed so that the effect of compaction
can be isolated from the effect of "just running under sched_ext".

## 5. Exact student contribution [DECISION]

1. `scx_compact`: an original BPF sched_ext scheduler (C, built on the in-tree scx_simple
   skeleton and helper headers) that:
   - keeps an **active CPU set** = the first `nr_active` CPUs of a preference order;
   - places woken tasks only on idle CPUs **inside** the active set; inactive CPUs do not pull
     from the shared queue, so they stay idle;
   - resizes `nr_active` from a periodic BPF timer using an **explicit, tunable two-threshold
     rule**: fast expansion on high utilization or queue build-up, and slow shrinking only
     after the load has fit in `nr_active−1` CPUs for N consecutive periods (hysteresis);
   - handles CPU-affinity-restricted tasks (per-CPU kthreads) safely, so compaction never
     starves them.
2. **Observability:** a per-interval trace of active-set size, utilization, queue depth,
   expand/shrink events and per-CPU busy time, written to CSV by the userspace loader.
3. **A built-in control condition:** the same binary with compaction disabled
   (`--no-compact`, all CPUs active). This separates *policy* effects from *sched_ext
   framework* effects in the evaluation.
4. **A configurable CPU preference order** (SMT-sibling-first vs physical-core-first), as a
   documented knob. Its energy effect is meaningful only on bare metal (see §7).
5. A reproducible evaluation: EEVDF vs `scx_compact --no-compact` vs `scx_compact` on a
   CPU-bound sweep, a compile workload and a mixed interactive-style workload, reporting
   completion time, CPU spread and context switches honestly, whichever way they go.

## 6. Why this is legitimate and fits Operating Systems

- [JUDGMENT] It is real kernel-level CPU scheduling. The policy decides which CPU each
  runnable task runs on and which CPUs stay idle, running inside the Linux scheduler core via
  sched_ext. That is CPU allocation, run queues (DSQs), dispatch, time slices and
  load-dependent policy. It maps directly to the course outcome on designing and comparing
  scheduling algorithms and criteria (turnaround/completion time, utilization, waiting,
  context switches).
- [JUDGMENT] The contribution is honestly scoped: we do not claim novelty of compaction
  itself. We claim a minimal, transparent implementation and its measured trade-off, which
  is appropriate for a 2-person OS lab project.

## 7. Deliberately excluded / constrained

- Excluded: DVFS/cpufreq control, ML-based policies, application-specific tuning,
  big.LITTLE/EAS energy models, cgroup scheduling, production hardening.
- Excluded: any networking/security scope, and anything related to the unrelated
  `application-aware-qos` repository.
- **Environment constraint** [FACT, see ENVIRONMENT_REPORT.md]: the WSL2 host kernel has
  `CONFIG_SCHED_CLASS_EXT` disabled, and `/sys/class/powercap` is empty (no RAPL under
  Hyper-V). Development and functional/performance testing therefore run in a QEMU guest with
  our own 6.18.53 kernel.
  - [JUDGMENT] Inside a VM, *energy cannot be measured*, and SMT topology is emulated
    (vCPUs do not map to fixed physical hyperthreads).
  - [DECISION] Energy evaluation (RAPL) and the SMT-order study are **pending**, to be run on
    a bare-metal Linux boot for the final review. They are not claimed in Review-2.
- Optional (only if time permits): comparison with scx_lavd `--powersave`.
