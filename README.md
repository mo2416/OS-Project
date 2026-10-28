# scx_compact — Load-Adaptive Core-Compaction Scheduling

BCSE303P Operating Systems Lab project.

`scx_compact` is a Linux CPU scheduler implemented using **`sched_ext`** and BPF. Under light workloads, it places runnable tasks on a smaller active set of CPUs so the remaining CPUs can stay idle. As CPU demand or queueing increases, it expands the active set. The project compares this policy with Linux's default EEVDF scheduler and records CPU-use and latency trade-offs.

> **Energy measurement note:** The experiments demonstrate changes in CPU placement and scheduling latency. Actual physical energy consumption was not measured because the WSL2/QEMU environment does not expose usable RAPL energy counters. Reduced CPU use is not, by itself, proof of reduced energy consumption.

## Features

- Load-aware CPU core compaction with an adaptive active CPU set.
- A controller that grows and shrinks the active set based on demand and queued work.
- An optional latency guard that can expand the active set when policy-caused queueing delay is too high.
- A userspace loader with scheduler options and telemetry.
- Synthetic workload and latency-probe programs.
- Functional tests, repeated benchmark scripts, and Python result analysis.
- A local web dashboard for launching supported tests and viewing live output alongside saved benchmark results.

## Repository layout

```text
scheduler/   BPF scheduling policy, userspace loader, headers and Makefile
vm/          Custom guest-kernel configuration, build script and QEMU runner
scripts/     Host/toolchain environment setup and helper scripts
tests/       Functional tests, workload programs, benchmark and analysis scripts
results/raw/ Original test logs, measurements and environment/build records
results/processed/ Summarised benchmark results and functional-test reports
docs/        Design notes, setup notes, result summaries and project documentation
reports/     Project reports and report-generation assets
dashboard/   Local HTML dashboard and Python backend (if included in this checkout)
```

## Requirements

The project was developed on Windows with WSL2 and runs the custom scheduler inside a QEMU/KVM Linux guest. The WSL2 host kernel used during development does not expose the required `sched_ext` interface, so the project uses a custom Linux 6.18.53 guest kernel configured with `sched_ext`.

You will need:

- WSL2 with an Ubuntu/Linux distribution.
- Python 3 for dashboard and analysis scripts.
- QEMU/KVM support and permission to access `/dev/kvm` for hardware-accelerated guest execution.
- The project build environment and required compiler, BPF/libbpf and QEMU dependencies.
- The built guest kernel and scheduler binaries. These are generated artifacts and are not necessarily included in a fresh clone.

## Start the local dashboard

From the WSL terminal, run:

```bash
cd "/mnt/d/OS Project"
python3 dashboard/server.py
```

Keep the terminal open, then open this address in your Windows browser:

```text
http://localhost:8765
```

The dashboard is a local interface, not a hosted website. Its backend launches the repository's predefined test scripts; it does not simulate scheduler behaviour. If the `dashboard/` directory is missing from your checkout, the dashboard files have not been added to that copy of the repository yet.

## Run tests from the terminal

From the repository root in WSL, the available VM runner can launch a job script inside the custom guest. For example, after the guest kernel, toolchain and binaries have been built:

```bash
vm/run_vm.sh tests/vm_smoke.sh 8 3G
```

Run the functional suite with:

```bash
vm/run_vm.sh tests/vm_functional.sh 8 3G
```

These commands use eight virtual CPUs and 3 GB RAM for the guest. Check the setup instructions and current environment notes in `docs/PROGRESS_LOG.md` and `docs/REVIEW2_EVIDENCE.md` before building or running on a new machine. The kernel image is generated outside the repository under `$HOME/osproj-build/kbuild/arch/x86/boot/bzImage` by default. If `/dev/kvm` is not accessible, the runner may fall back to software emulation; timing results from that mode should not be treated as valid performance comparisons.

## Recorded benchmark results

Saved results are available under `results/processed/`, with original logs and measurements under `results/raw/`. The repeated benchmark compares four conditions across 20%, 40%, 60%, and 99% offered workloads, with ten repetitions per condition and workload:

- **EEVDF baseline:** Linux's default scheduler.
- **Compaction off:** `scx_compact` with compaction disabled, used to isolate the overhead of the `sched_ext` path.
- **Compaction:** core compaction enabled, with the latency guard disabled.
- **Compaction + latency guard:** core compaction with the optional guard enabled.

At partial load, recorded results show fewer busy CPUs with compaction, while plain compaction increases the latency probe's tail latency. The latency guard reduces much of that latency increase at lower loads while retaining some CPU-use reduction. At full load, all tested `sched_ext` conditions had higher probe p99 latency than EEVDF.

## Important limitations

- Physical energy consumption and energy savings have not been measured.
- Current repeated results use synthetic workloads in a virtual machine; virtual CPU idleness does not directly establish physical core power savings.
- Compilation and mixed interactive application workloads remain additional evaluation work.
- Full-load tail latency remains a known limitation.

## Documentation

Project design decisions, current results, setup notes and implementation details are documented in the files under `docs/`. The `results/processed/` files summarise the recorded experiments, and the `reports/` directory contains project report materials.

