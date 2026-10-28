# SCX Compact local demo dashboard

This local dashboard provides a browser-based front end for the project's existing WSL/QEMU demo. The Python standard-library backend remains unchanged in this UI-only revision and launches only two allow-listed project scripts:

- `tests/vm_smoke.sh`: a short guest-boot and scheduler attach/detach check.
- `tests/vm_functional.sh`: the fuller functional sequence; it writes raw measurements and runs `tests/analyze_functional.py` afterward.

The page separates live guest telemetry from historical benchmark measurements. Its run summary explains scheduler events in plain English, while the benchmark panel compares the recorded CPU footprint and p99 wake-up latency for EEVDF, compaction, and the latency guard.

## UI revision

- Replaced the dark navy/blue styling with a warmer paper, sage, forest-green, and terracotta palette.
- Added small line icons to the top metric cards, run buttons, and live telemetry cards.
- Added concise descriptions and keyboard-accessible hover/focus tooltips for the guest kernel, virtual CPUs, EEVDF baseline, compaction, and latency guard.
- Improved the workload selector and labelled the recorded levels by intensity.
- Added bold leading labels and visual markers to the plain-English "What happened in this run?" list.
- Added bold lead-ins to the explanation beneath the benchmark charts.
- Removed the raw source-file path and the separate latest-functional-report panel from the faculty-facing page. The backend still runs the functional analyzer and keeps its artifacts in the project's results folders; only the extra report panel was removed from this interface.
- Kept an understated energy-measurement limitation note. Actual energy consumption has not been directly measured in this project.
- Kept the guest shutdown warning visible; this update does not modify shutdown logic.

The saved benchmark contains workload levels **20%, 40%, 60%, and 99%**. The final entry is near saturation; it is intentionally not relabelled as 80%, because there is no 80% result in the currently recorded comparison data.

## Install into the project

Extract the supplied ZIP into the root of `D:\OS Project` (not inside a second nested `OS Project` folder). Merge the `dashboard` folder and replace files when prompted. The package contains:

```text
D:\OS Project\dashboard\server.py
D:\OS Project\dashboard\index.html
D:\OS Project\dashboard\README.md
D:\OS Project\dashboard\CHANGES.md
```

## Start it from WSL

```bash
cd "/mnt/d/OS Project"
python3 dashboard/server.py
```

Open Windows Chrome/Edge at:

```text
http://localhost:8765
```

Keep the WSL terminal hosting the server open. Stop it with `Ctrl+C` in that terminal. If port 8765 is already in use, run:

```bash
SCX_DASHBOARD_PORT=8766 python3 dashboard/server.py
```

Then open `http://localhost:8766`.

## Demo recommendation

1. Click **Run smoke test** first to verify guest boot and scheduler attach/detach.
2. Click **Run functional suite** for the main demonstration of idle, increasing workload, load release, a CPU-pinned task, and control behaviour.
3. Use the saved benchmark comparison to explain the CPU-count and latency trade-offs from 10 repeated runs per condition.

## Important interpretation notes

- A browser cannot run shell commands by itself. The local Python server bridges the browser to predefined project scripts and streams their serial output back to the page.
- The server binds to `127.0.0.1` and is intended for local demo use, not exposure to a LAN or the public internet.
- Past smoke-test output shows successful scheduler attach/detach and a successful smoke marker, followed by a guest power-off teardown symptom (`Kernel panic - not syncing: Attempted to kill init` and/or `/usr/bin/sleep: Input/output error`, depending on the run). The dashboard distinguishes test outcome from that shutdown warning. Investigate the warning in a later logic pass.
- The smoke test is an environment check, not a demonstration of controller expansion/shrink behaviour. Use the functional suite to show the adaptive response.
- The project has not measured actual energy. `E_proxy` is a model based on assumed coefficients, not a direct joule measurement.
