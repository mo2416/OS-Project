# scx_compact — Load-Adaptive Core-Compaction Scheduling with sched_ext

BCSE303P Operating Systems Lab project.

A Linux CPU scheduler written as a BPF program for **sched_ext**. At low load it packs runnable
tasks onto a small, dynamically sized *active CPU set*, and it expands that set as utilization
or queueing grows. It is evaluated against the default Linux scheduler (EEVDF).

- Why this design: [docs/RESEARCH_DECISION.md](docs/RESEARCH_DECISION.md)
- Current results: [docs/RESULTS_SUMMARY.md](docs/RESULTS_SUMMARY.md)
- Review-2 evidence: [docs/REVIEW2_EVIDENCE.md](docs/REVIEW2_EVIDENCE.md)
- Progress: [docs/PROGRESS_LOG.md](docs/PROGRESS_LOG.md), [docs/PROGRESS_AUDIT.md](docs/PROGRESS_AUDIT.md), [CHANGELOG.md](CHANGELOG.md)

## Layout
```
scheduler/   scx_compact BPF + userspace loader (built against the guest kernel tree)
vm/          guest kernel config + build script + QEMU runner (sched_ext test VM)
scripts/     host setup, local toolchain env, benchmark drivers
tests/       functional tests run inside the VM
results/     raw/ (unmodified outputs) and processed/ (tables derived by scripts)
docs/        design notes, logs, Review-2 material
```
Build and run: "Current state" in [docs/PROGRESS_LOG.md](docs/PROGRESS_LOG.md) and the reproduce column in [docs/REVIEW2_EVIDENCE.md](docs/REVIEW2_EVIDENCE.md).
