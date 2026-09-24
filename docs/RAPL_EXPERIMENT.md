# Bare-Metal RAPL Energy Experiment

Status: **BLOCKED — not run.** No energy has been measured. No model-based estimate
is substituted for it (the existing idle-time proxy stays labelled MODELED; see
`docs/RESULTS_SUMMARY.md` §3).

## 1. Planned protocol (as already documented)
Source: `docs/REVIEW2_FINAL.md` §8 item 1, `docs/NEXT_PHASE_RESULTS.md` §7 item 1,
`docs/RESEARCH_DECISION.md` §7.

- **Platform:** bare-metal Linux booted on the project laptop (USB live system or dual boot).
  Not WSL2, not a VM.
- **Energy source:** Intel RAPL, via `perf stat -e power/energy-pkg/` (optionally
  `power/energy-cores/`) or `/sys/class/powercap/intel-rapl:*/energy_uj`.
- **Conditions:** EEVDF (no BPF scheduler), scx_compact (defaults), guard
  (`scx_compact -L 1000 -P 10`). The `-n` control is included as in the frozen methodology.
- **Workload and method:** unchanged from the validated n = 10 run
  (`tests/vm_bench_repeated.sh`). 8 dutywork workers × {20, 40, 60, 99} % duty of 20 ms,
  250 iterations, plus latprobe; ≥ 10 reps; conditions interleaved and rotated per rep;
  paired bootstrap CIs (`tests/analyze_repeated.py`). Energy is read before and after each
  run window, in the same way as the existing `/proc/stat` snapshots.
- **Also on bare metal:** the SMT/CPU-order study (`-o smt` vs `-o core`), pending item 2.

## 2. Environment check (2026-09-24)
Raw output: `results/raw/env/rapl_probe_20260924T115624Z.txt`.

| Check | Result | Meaning |
|---|---|---|
| `systemd-detect-virt`, cpuinfo flag | `wsl`, `hypervisor` | Running inside the WSL2 VM (Hyper-V), not bare metal |
| Kernel | `6.18.33.2-microsoft-standard-WSL2` | Microsoft WSL2 kernel, no sched_ext (`CONFIG_SCHED_CLASS_EXT` not set) |
| `dmesg` | `RAPL PMU: ... 0 fixed counters` | The kernel found **no** RAPL energy counters |
| `/sys/bus/event_source/devices/power/events/` | empty | No `energy-pkg` / `energy-cores` perf events |
| `/sys/class/powercap/` | empty (even with `intel_rapl_msr` loaded) | No RAPL powercap zones |
| `/dev/cpu/0/msr` | absent | No direct MSR access |
| `perf` | not installed | (would not help: no events to read) |

Driver support is compiled in (`CONFIG_INTEL_RAPL`, `CONFIG_PERF_EVENTS_INTEL_RAPL`), but the
hypervisor does not expose the energy MSRs to the WSL2 VM. The sched_ext test VM (QEMU/KVM)
runs inside this VM, so it cannot see RAPL either. No software change inside WSL2 can
produce real RAPL readings.

## 3. Why the experiment cannot proceed here
Two things are needed together, and this environment provides neither:
1. **RAPL counters.** They exist only on bare metal (or with hypervisor RAPL passthrough,
   which WSL2 does not offer).
2. **A sched_ext-capable kernel on that same bare-metal boot.** The scheduler cannot run
   on the WSL2 kernel.

Booting the laptop into native Linux is a physical, user-performed step (boot media, and
possibly firmware or boot-order changes). It cannot be done from this session.

## 4. What is needed to run it
1. Boot Linux natively on the laptop (live USB or dual boot) with a kernel ≥ 6.12 that has
   `CONFIG_SCHED_CLASS_EXT=y` and BTF. Many current distribution kernels have both; check
   `/sys/kernel/sched_ext` and `/sys/class/powercap/intel-rapl:0`. Otherwise install the
   6.18.53 kernel built in this project.
2. Confirm RAPL: `cat /sys/class/powercap/intel-rapl:0/energy_uj` increases, or
   `perf list | grep energy` shows `power/energy-pkg/`. Reading `energy_uj` needs root on
   kernels ≥ 5.10.
3. Rebuild `scheduler/` against that kernel's BTF and run the frozen matrix with an
   energy snapshot added around each run window.
4. Record the environment (CPU governor, AC power, turbo state, background load), since
   these directly affect RAPL readings.

Until then, energy remains **PENDING**. All energy statements in the project stay limited
to the MODELED proxy.
