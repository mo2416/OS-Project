# scx_compact — Load-Adaptive Core-Compaction Scheduling

BCSE303P Operating Systems Lab project.

`scx_compact` is a Linux CPU scheduler implemented using **`sched_ext`** and BPF. Under light workloads, it places runnable tasks on a smaller active set of CPUs so the remaining CPUs can stay idle. As CPU demand or queueing increases, it expands the active set. The project compares this policy with Linux's default EEVDF scheduler and records CPU-use and latency trade-offs.

**Energy measurement note:** The experiments demonstrate changes in CPU placement and scheduling latency. Actual physical energy consumption was not measured because the WSL2/QEMU environment does not expose usable RAPL energy counters. Reduced CPU use is not, by itself, proof of reduced energy consumption.

## Features

- Load-aware CPU core compaction with an adaptive active CPU set.
- A controller that grows and shrinks the active set based on demand and queued work.
- An optional latency guard that can expand the active set when policy-caused queueing delay is too high.
- A userspace loader with scheduler options and telemetry.
- Synthetic workload and latency-probe programs.
- Functional tests, repeated benchmark scripts, and Python result analysis.
- A local browser dashboard for launching supported tests and viewing live output alongside saved benchmark results, when the dashboard source folder is available.

## Repository layout

```text
scheduler/         BPF scheduling policy, userspace loader, headers and Makefile
vm/                Custom guest-kernel configuration, build script and QEMU runner
scripts/           Host/toolchain environment setup and helper scripts
tests/             Functional tests, workload programs, benchmarks and analysis scripts
results/raw/       Original test logs, measurements and environment/build records
results/processed/ Summarised benchmark results and functional-test reports
docs/              Design notes, setup notes, result summaries and project documentation
reports/           Project report files and report-generation assets
dashboard/         Optional local HTML dashboard and Python backend, when included
