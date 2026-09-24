# Changelog

All entries are backed by commits; evidence paths are relative to the repository root.

## [Unreleased]

## 2026-09-24 — `e927c43` scheduler built and validated on sched_ext
### Added
- scx_compact runs on the Linux 6.18.53 sched_ext guest under KVM
  (`results/raw/vm/smoke_1.log`).
- Controller: EWMA-smoothed demand (`-w SHIFT`, default 3) and sustained-queue expansion
  (`-Q N`, default 2); CSV column `demand_pct`.
- `tests/vm_smoke.sh`; functional runs `results/raw/functional/20260924T094417Z` (original
  controller) and `…T094713Z` (EWMA), both 12/12 PASS.
- Initial fixed-work benchmark `results/raw/bench_initial/20260924T094952Z`.
### Changed
- The reference scheduler is `scx_qmap`: the 6.18.53 in-tree `scx_simple` calls
  `scx_bpf_task_set_dsq_vtime()`, which 6.18 does not export.
- scx_compact writes `p->scx.dsq_vtime` directly instead of calling that kfunc.
### Fixed
- `scheduler/Makefile`: build via `cd` (the space in the path broke `-C`), and create `O=`.
- `vm/run_vm.sh`: explicit `-virtfs id=`, SeaBIOS search path.
- Loader `printf` format for `u64` rodata.

## 2026-09-24 — `182a48c` guest kernel built
- 6.18.53 guest kernel with `CONFIG_SCHED_CLASS_EXT=y` and BTF
  (`results/raw/build/kernel_build_3.log`, `EXIT 0`); disk guard in `vm/build_kernel.sh`;
  functional and benchmark harness written.

## 2026-09-24 — `4e02722` scheduler sources
- scx_compact BPF policy, loader, VM runner (not built at that point).

## 2026-09-24 — `bd87660` baseline
- Research decision, guest kernel config, sudo-free toolchain scripts.
