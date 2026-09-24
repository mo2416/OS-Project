# Changelog

All entries are backed by commits; evidence paths are relative to the repository root.

## [Unreleased]

## 2026-09-24 — `958b081`, `20012ec` latency guard and repeated validation
### Added
- Latency guard in the controller (`-L US`, `-P PM`, off by default): expands the active set
  when more than PM ‰ of dispatches wait over US µs in the shared queue, and blocks
  shrinking while above PM/2. Task storage via `ops.init_task`; stale stamps cleared in
  `ops.quiescent`. CSV gains `nr_waits,nr_late,late_pm,nr_lat_expand`.
- `tests/latprobe.c` latency probe; dutywork p95 fields; `tests/vm_bench_repeated.sh`
  (n = 10, interleaved) and `tests/analyze_repeated.py` (t CIs, paired bootstrap).
- `docs/NEXT_PHASE_DECISION.md`, `docs/NEXT_PHASE_RESULTS.md`.
### Changed
- `docs/RESULTS_SUMMARY.md` now leads with the n = 10 results; the earlier "no latency cost at
  20 %" is marked as revised.

## 2026-09-24 — partial-load validation checkpoint (feature freeze)
### Added
- `tests/dutywork.c`: fixed-work duty-cycle load with completion time and latency percentiles
  (built by `make -C scheduler`).
- Partial-load benchmark (`tests/vm_bench_partial.sh`), sweep (`tests/vm_sweep.sh`),
  ctxsw check (`tests/vm_ctxsw.sh`) and analyzers (`analyze_partial.py`, `analyze_ctxsw.py`),
  with a clearly labelled energy proxy.
- Results: `results/processed/{bench_partial,sweep,ctxsw}_*.md`;
  `docs/RESULTS_SUMMARY.md`, `docs/REVIEW2_EVIDENCE.md`.
### Changed
- README links point at documents that exist.
- No scheduler code changes in this checkpoint.

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
