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
scheduler/        BPF scheduling policy, userspace loader, headers and Makefile
vm/               Custom guest-kernel configuration, build script and QEMU runner
scripts/          Host/toolchain environment setup and helper scripts
tests/            Functional tests, workload programs, benchmarks and analysis scripts
results/raw/      Original test logs, measurements and environment/build records
results/processed/ Summarised benchmark results and functional-test reports
docs/             Design notes, setup notes, result summaries and project documentation
reports/          Project report files and report-generation assets
dashboard/        Optional local HTML dashboard and Python backend, when included
```

## Environment and requirements

The project was developed on Windows with WSL2 and runs the custom scheduler inside a QEMU/KVM Linux guest. The WSL2 host kernel used during development does not expose the required `sched_ext` interface, so the project uses a custom Linux 6.18.53 guest kernel configured with `sched_ext`.

Requirements:

- WSL2 with an Ubuntu/Linux distribution.
- Python 3 for analysis scripts and the dashboard backend.
- QEMU/KVM and permission to access `/dev/kvm` for hardware-accelerated guest execution.
- The required compiler, BPF/libbpf tooling, and QEMU dependencies.
- A built guest kernel and scheduler binaries. These are generated artefacts and are not necessarily included in a fresh clone.

## Start the dashboard

The dashboard is a local interface, not a hosted website. It launches predefined project test scripts; it does not simulate scheduler behaviour. If the `dashboard/` folder is present in your checkout, start the backend from WSL:

```bash
cd "/mnt/d/OS Project"
python3 dashboard/server.py
```

Keep the terminal open and open `http://localhost:8765` in your Windows browser. If you cloned the repository and the `dashboard/` directory is missing, the dashboard source files need to be added to that checkout before this command will work.

## Run the project from the terminal

From the repository root in WSL, the VM runner launches a test script inside the custom guest. After the guest kernel, toolchain and scheduler binaries have been built, run the smoke test:

```bash
vm/run_vm.sh tests/vm_smoke.sh 8 3G
```

Run the functional suite with:

```bash
vm/run_vm.sh tests/vm_functional.sh 8 3G
```

Both examples configure eight virtual CPUs and 3 GB of guest memory. The kernel image is generated outside the repository under `$HOME/osproj-build/kbuild/arch/x86/boot/bzImage` by default. Check the setup notes in `docs/PROGRESS_LOG.md` before building on a new machine.

If `/dev/kvm` is not accessible, the VM runner may fall back to software emulation. That mode can be useful for basic functional testing, but its timing results should not be treated as reliable performance comparisons.

## Benchmark methodology and results

Saved summaries are under `results/processed/`; original logs and measurements are under `results/raw/`. The repeated benchmark compares four scheduling conditions at 20%, 40%, 60%, and 99% offered workload, with ten repetitions per condition and workload:

- **EEVDF baseline:** Linux's default scheduler.
- **Compaction off:** `scx_compact` with compaction disabled, to isolate the overhead of the `sched_ext` path.
- **Compaction:** core compaction enabled, with the latency guard disabled.
- **Compaction + latency guard:** core compaction with the optional guard enabled.

Recorded results show fewer busy CPUs with compaction at partial loads, but plain compaction increases the latency probe's tail latency. The latency guard reduces much of that increase at lower loads while retaining some reduction in CPU use. At full load, all tested `sched_ext` conditions had higher probe p99 latency than EEVDF.

## Limitations

- Physical energy consumption and energy savings have not been measured.
- The benchmark workloads are synthetic and run inside a virtual machine. An idle virtual CPU does not prove that a physical CPU core entered a low-power state.
- Compilation and mixed interactive application workloads remain additional evaluation work.
- Full-load tail latency remains a known limitation.

## Documentation

Design decisions, setup details, implementation notes and current results are documented under `docs/`. The `results/processed/` directory contains the summaries derived from recorded measurements, and `reports/` contains project report files.
