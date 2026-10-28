# UI-only dashboard revision

- Replaced the blue/dark palette with a warm neutral, sage, forest-green, and terracotta visual system.
- Added small icons to the guest kernel, vCPU, CPU-footprint, latency-guard and live telemetry cards.
- Added readable two-sentence context for the guest kernel and a plain-language explanation for the latency-guard 20% workload KPI.
- Added small hover/focus tooltips to EEVDF baseline, Compaction, and Latency guard legend labels, plus guest kernel and vCPU labels.
- Improved the workload picker and labels for saved workload levels.
- Added bold labels and event markers to the plain-English run summary and bold section labels below the benchmark charts.
- Removed the result-file path and the separate latest functional-test report panel from the faculty-facing UI. Backend-side test/analyzer behaviour is unchanged.
- Kept the energy measurement limitation and guest shutdown warning visible and appropriately qualified.
- No scheduler, test-runner, or shutdown logic was changed in this revision.

Validation: JavaScript syntax check passed with Node.js; the HTML structure and element counts were inspected. This package update does not launch QEMU and does not verify the shutdown behaviour.
