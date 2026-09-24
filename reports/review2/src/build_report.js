// Builds reports/review2/BCSE303P_Project_Review2_Report.docx
// Structure: faculty "Mid-Progress Review — Up to 8 Sections" template
// (reports/Mid- progress review contents to be included- example format.pdf).
// Styling follows the Review-1 report (reports/BCSE303P_Project_Review1_...pdf).
//
//   NODE_PATH=<dir with node_modules containing docx> node build_report.js
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header, Footer,
  AlignmentType, HeadingLevel, WidthType, ShadingType, BorderStyle, PageNumber, PageBreak,
  LevelFormat, TabStopType, VerticalAlign,
} = require('docx');

const HERE = __dirname;
const ASSETS = path.resolve(HERE, '../assets');
const OUTFILE = path.resolve(HERE, '../BCSE303P_Project_Review2_Report.docx');

const BODY = 'Times New Roman', HEAD = 'Arial';
const NAVY = '1F3864', HBLUE = '4F81BD', TBLUE = '2E5E8E';
const PAGE_W = 11906, MARGIN = 1134, CONTENT_W = PAGE_W - 2 * MARGIN; // A4, 2 cm margins

// ---------- helpers ----------
// Inline markup: **bold**, `code`
function runs(str, o = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push(new TextRun({ text: str.slice(last, m.index), font: o.font || BODY, size: o.size || 23, bold: o.bold, italics: o.italics, color: o.color }));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), font: o.font || BODY, size: o.size || 23, bold: true, italics: o.italics, color: o.color }));
    else out.push(new TextRun({ text: t.slice(1, -1), font: 'Consolas', size: (o.size || 23) - 3, color: o.color }));
    last = m.index + t.length;
  }
  if (last < str.length) out.push(new TextRun({ text: str.slice(last), font: o.font || BODY, size: o.size || 23, bold: o.bold, italics: o.italics, color: o.color }));
  return out;
}
const P = (str, o = {}) => new Paragraph({
  children: runs(str, o), alignment: o.align || AlignmentType.JUSTIFIED,
  spacing: { after: o.after ?? 100, before: o.before ?? 0, line: o.line || 264 }, indent: o.indent,
  keepNext: o.keepNext,
});
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)], keepNext: true });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)], keepNext: true });
const bullet = (str, level = 0) => new Paragraph({ numbering: { reference: 'bul', level }, children: runs(str), spacing: { after: 50, line: 259 }, alignment: AlignmentType.LEFT });
const numbered = (str, ref = 'num') => new Paragraph({ numbering: { reference: ref, level: 0 }, children: runs(str), spacing: { after: 50, line: 259 }, alignment: AlignmentType.LEFT });

const border = { style: BorderStyle.SINGLE, size: 4, color: '7F7F7F' };
const borders = { top: border, bottom: border, left: border, right: border };
const BOTH = 'Konasani Vaibhav — 24BCE0419\nMohammed Asif A — 24BCE2076';
function table(header, rows, widthsPct, o = {}) {
  const total = CONTENT_W;
  const widths = widthsPct.map((p) => Math.round((p / 100) * total));
  widths[widths.length - 1] = total - widths.slice(0, -1).reduce((a, b) => a + b, 0);
  const size = o.size || 19;
  const cell = (txt, i, isHead) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders,
    shading: isHead ? { fill: NAVY, type: ShadingType.CLEAR, color: 'auto' } : (o.zebra && o._r % 2 ? { fill: 'F2F6FB', type: ShadingType.CLEAR, color: 'auto' } : undefined),
    margins: { top: 50, bottom: 50, left: 90, right: 90 }, verticalAlign: VerticalAlign.CENTER,
    children: String(txt).split('\n').map((line) => new Paragraph({
      children: runs(line, { size, bold: isHead || (o.boldFirst && i === 0), color: isHead ? 'FFFFFF' : undefined, font: isHead ? HEAD : BODY }),
      alignment: (o.center && o.center.includes(i) && !isHead) ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 0, line: 240 },
    })),
  });
  const trs = [new TableRow({ tableHeader: true, cantSplit: true, children: header.map((h, i) => cell(h, i, true)) })];
  rows.forEach((r, ri) => { o._r = ri; trs.push(new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) })); });
  return [new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: widths, rows: trs }),
    new Paragraph({ spacing: { after: 80 }, children: [] })];
}
function caption(t) {
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40, after: 160 }, children: runs(t, { size: 20, italics: true }) });
}
function tcaption(t) {
  return new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: 80, after: 60 }, keepNext: true, children: runs(t, { size: 20, bold: true }) });
}
function figure(file, widthIn, cap) {
  const png = fs.readFileSync(path.join(ASSETS, file));
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  const wpx = Math.round(widthIn * 96), hpx = Math.round(wpx * h / w);
  return [new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 60, after: 0 },
    children: [new ImageRun({ type: 'png', data: png, transformation: { width: wpx, height: hpx },
      altText: { title: cap, description: cap, name: file } })] }), caption(cap)];
}
function mono(lines) {
  return lines.map((l, i) => new Paragraph({
    spacing: { after: 0, line: 240 }, shading: { fill: 'F2F2F2', type: ShadingType.CLEAR, color: 'auto' },
    indent: { left: 200, right: 200 },
    children: [new TextRun({ text: l, font: 'Consolas', size: 16 })],
    ...(i === lines.length - 1 ? { spacing: { after: 120, line: 240 } } : {}),
  }));
}
const centerLine = (children, after = 40) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after }, children });

// ---------- title page ----------
const title = [
  new Paragraph({ spacing: { before: 900, after: 60 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'VIT', font: BODY, size: 64, bold: true, color: TBLUE })] }),
  centerLine([new TextRun({ text: 'VELLORE INSTITUTE OF TECHNOLOGY', font: BODY, size: 40, bold: true })], 60),
  centerLine([new TextRun({ text: 'Fall Semester 2026-27', font: BODY, size: 26 })], 700),
  centerLine([new TextRun({ text: 'BCSE303P - OPERATING SYSTEMS LAB', font: HEAD, size: 30, bold: true, color: TBLUE })], 40),
  centerLine([new TextRun({ text: 'PROJECT REVIEW-2 REPORT', font: BODY, size: 28, bold: true })], 60),
  centerLine([new TextRun({ text: '(Mid-Progress Review)', font: BODY, size: 22, italics: true })], 700),
  centerLine([new TextRun({ text: 'Energy-Aware CPU Scheduling in Linux using sched_ext:', font: BODY, size: 32, bold: true })], 20),
  centerLine([new TextRun({ text: 'Core-Compaction Scheduling for Reduced Energy Consumption', font: BODY, size: 32, bold: true })], 1300),
  ...[
    ['Team Member 1: ', 'Mohammed Asif A'], ['Register Number: ', '24BCE2076'],
    ['Team Member 2: ', 'Konasani Vaibhav'], ['Register Number: ', '24BCE0419'],
    ['Guide / Faculty: ', '[Faculty Name]'],
    ['Class Number: ', 'VL2026270103058'], ['Slot: ', 'L31 + L32'], ['Date: ', '24/09/2026'],
  ].map(([k, v]) => centerLine([new TextRun({ text: k, font: BODY, size: 23, bold: true }), new TextRun({ text: v, font: BODY, size: 23 })], 20)),
  new Paragraph({ children: [new PageBreak()] }),
];

// ---------- content ----------
const C = [];

// 1
C.push(H1('1. PROJECT TITLE & TEAM DETAILS'));
C.push(...table(['Item', 'Details'], [
  ['Project title', 'Energy-Aware CPU Scheduling in Linux using sched_ext: Core-Compaction Scheduling for Reduced Energy Consumption'],
  ['Team members', 'Mohammed Asif A — 24BCE2076\nKonasani Vaibhav — 24BCE0419'],
  ['Guide / Faculty', '[Faculty Name]'],
  ['Course', 'BCSE303P – Operating Systems Lab, Fall Semester 2026-27'],
  ['Class number / Slot', 'VL2026270103058 / L31 + L32'],
  ['School / Department', '[School / Department]'],
  ['Review', 'Project Review-2 (mid-progress review). Review-1 report dated 27/08/2026.'],
], [26, 74], { boldFirst: true }));
C.push(H2('1.1 Team Contribution'));
C.push(P('The project work completed so far was carried out jointly by both team members. The work packages and their evidence in the project repository are listed below.'));
C.push(...table(['Work package', 'Main artefacts', 'Member(s)'], [
  ['Environment: guest kernel with sched_ext, KVM test VM', '`vm/`, `scripts/`, build logs', BOTH],
  ['Scheduler: BPF policy, controller, loader', '`scheduler/scx_compact.bpf.c`, `scx_compact.c`', BOTH],
  ['Latency guard design and diagnostics', '`scheduler/scx_compact.bpf.c`, `results/raw/vm/guard_diag_*.log`', BOTH],
  ['Test suite and workloads', '`tests/vm_functional.sh`, `tests/dutywork.c`, `tests/latprobe.c`', BOTH],
  ['Experiments and statistical analysis', '`tests/vm_bench_*.sh`, `tests/analyze_*.py`, `results/`', BOTH],
  ['Documentation and reports', '`docs/`, `reports/`', BOTH],
], [30, 36, 34]));

// 2
C.push(H1('2. INTRODUCTION & BACKGROUND'));
C.push(H2('2.1 Brief Project Background'));
C.push(P('The CPU scheduler decides which runnable task runs on which processor and when. The default fair scheduler in current Linux is EEVDF (Earliest Eligible Virtual Deadline First), which targets fairness and good latency [2]. **sched_ext** is a Linux scheduling class whose policy is written as a BPF program and loaded at run time through callbacks such as `select_cpu`, `enqueue`, `dispatch`, `running` and `stopping`. If the BPF scheduler fails, the kernel automatically falls back to the fair scheduler [1]. This makes it practical to implement and evaluate a real kernel CPU-scheduling policy without rebuilding the kernel for every change.'));
C.push(H2('2.2 Context of the Problem'));
C.push(P('A processor saves most of its idle power when cores stay idle long enough to reach deep idle states. On a symmetric multi-core machine, EEVDF spreads runnable tasks over idle CPUs for throughput and latency, so a light load keeps many cores briefly busy. Linux Energy Aware Scheduling uses an energy model only on asymmetric CPUs and does not support SMT [3], so typical x86 laptops get no energy-driven packing of work. **Core compaction** packs a light load onto a small, load-dependent set of CPUs and leaves the rest idle. The idea is not new (scx_lavd implements it together with many other mechanisms [4]). This project builds a small, transparent version of it and measures its trade-offs.'));
C.push(H2('2.3 Why the Project is Relevant to Operating Systems'));
C.push(P('The project implements and evaluates a CPU-scheduling policy inside the Linux kernel. It works directly with run queues (dispatch queues), time slices, CPU selection, CPU affinity, context switches, waiting time and completion time, and kernel CPU accounting. It maps to course outcome CO2, "design scheduling algorithms to compute and compare various scheduling criteria" [5].'));

// 3
C.push(H1('3. PROBLEM STATEMENT'));
C.push(H2('3.1 Problem Being Addressed'));
C.push(P('Under partial load, the default scheduler keeps more CPUs active than the load requires. This limits how long CPUs can remain fully idle, which is the precondition for idle-power savings.'));
C.push(H2('3.2 Existing Issue or Limitation'));
C.push(bullet('EEVDF has no energy-driven packing on symmetric CPUs, and Energy Aware Scheduling does not apply to them [2], [3].'));
C.push(bullet('Existing sched_ext compaction (scx_lavd) is combined with latency scoring, autopilot modes and a separate control plane, so the effect of compaction alone is hard to isolate [4].'));
C.push(bullet('Packing work onto fewer CPUs makes tasks wait for each other. This project measured that queueing-latency cost directly (Section 7.4).'));
C.push(H2('3.3 Scope of the Project'));
C.push(P('**In scope:** a sched_ext BPF scheduler with a load-sized active CPU set, expand/shrink hysteresis and an optional latency guard; correctness tests; and a repeated, paired comparison against EEVDF on CPUs used, completion time, latency and context switches. **Out of scope:** changes to EEVDF itself, DVFS/frequency control, application-specific policies and production deployment. **Energy:** measuring energy needs Intel RAPL counters on native (bare-metal) Linux. It is part of the scope but still pending (Section 8).'));

// 4
C.push(H1('4. OBJECTIVES'));
C.push(H2('4.1 Main Objective'));
C.push(P('To design, implement and evaluate a load-aware core-compaction CPU scheduler for Linux using sched_ext that reduces the number of CPUs in use under partial load, and to compare its CPU-usage, performance and latency behaviour (and, on supported hardware, its energy) with the default EEVDF scheduler.'));
C.push(H2('4.2 Specific Objectives and Status at Review-2'));
C.push(...table(['#', 'Specific objective', 'Status'], [
  ['1', 'Set up a reproducible environment with a sched_ext-enabled kernel and toolchain', 'Done'],
  ['2', 'Implement core compaction: place tasks only on a small active CPU set', 'Done'],
  ['3', 'Grow the set under contention and shrink it with hysteresis when load falls', 'Done'],
  ['4', 'Verify correctness: clean attach/detach, no starvation of pinned tasks, no watchdog errors', 'Done (12/12 checks)'],
  ['5', 'Compare with EEVDF: CPUs used, completion time, scheduling latency, context switches', 'Done for synthetic partial-load workloads (n = 10); compile and mixed workloads pending'],
  ['6', 'Limit the latency cost of compaction (added after it was measured)', 'Done: latency guard, validated (n = 10)'],
  ['7', 'Measure energy with Intel RAPL on bare metal', 'Pending: not possible in the current environment'],
], [6, 64, 30]));
C.push(H2('4.3 Expected Outcome'));
C.push(P('A working, observable sched_ext scheduler, plus measured evidence of how many CPUs it frees under partial load, what it costs in completion time and tail latency, whether the latency guard reduces that cost, and (after bare-metal runs) whether energy consumption falls. No specific improvement is assumed in advance.'));

// 5
C.push(H1('5. METHODOLOGY / SYSTEM DESIGN'));
C.push(H2('5.1 Proposed Approach'));
C.push(P('The scheduler keeps an **active CPU set**: the first `nr_active` CPUs of a topology-derived preference order (SMT siblings of a core first). Woken tasks are placed only on idle CPUs inside the set. CPUs outside the set do not take work from the shared queue, so they stay idle. A controller, implemented as a BPF timer that runs every 20 ms, resizes the set from measured demand, queue length and (optionally) measured queueing delay. The same program with compaction disabled (`-n`) acts as a control condition that separates the effect of the policy from the cost of running under sched_ext.'));
C.push(H2('5.2 System Architecture / Design'));
C.push(...figure('fig1_architecture.png', 6.5, 'Figure 1. Implemented system architecture (build and analysis in WSL2; scheduler runs in a KVM guest with sched_ext).'));
C.push(P('The WSL2 kernel on the development laptop does not include sched_ext. The project therefore builds its own Linux 6.18.53 kernel with `CONFIG_SCHED_CLASS_EXT` and BTF, and runs every test in a QEMU/KVM guest with 8 vCPUs (4 cores × 2 SMT). The userspace loader attaches the BPF scheduler, passes the tunables and writes per-interval telemetry. Test jobs snapshot kernel accounting before and after each run, and the analysis scripts turn the raw data into the processed reports.'));
C.push(...figure('fig2_placement.png', 5.8, 'Figure 2. Task placement path in scx_compact (compaction enabled).'));
C.push(H2('5.3 Controller and Latency Guard'));
C.push(...figure('fig3_controller.png', 6.0, 'Figure 3. Controller decision per 20 ms tick; the latency-guard step is optional (-L).'));
C.push(bullet('**Demand:** busy time summed over all CPUs in each interval, smoothed by an exponentially weighted moving average (weight 1/8).'));
C.push(bullet('**Expand** when demand exceeds 80 % of the set’s capacity, or when at least `nr_active` tasks have been queued for 2 consecutive ticks. **Shrink** by one CPU only after demand has fitted into `nr_active − 1` CPUs at ≤ 50 % for 5 consecutive ticks (hysteresis).'));
C.push(bullet('**Latency guard** (`-L 1000 -P 10`; off by default): it measures the delay caused by the policy itself, i.e. the time a task spends in the shared queue because no active CPU was idle. Samples are all dispatches of tasks that may run on any CPU. A task placed directly on an idle CPU counts as not late. If more than 1 % of dispatches (decayed over about 8 ticks) waited over 1 ms, the guard adds one CPU and then pauses for 8 ticks. Shrinking is blocked until the late fraction falls below 0.5 %, after which the normal shrink hysteresis applies.'));
C.push(H2('5.4 Evaluation Methodology'));
C.push(...figure('fig4_pipeline.png', 6.5, 'Figure 4. Repeated, interleaved evaluation pipeline.'));
C.push(...table(['Condition', 'Meaning'], [
  ['EEVDF', 'No BPF scheduler loaded: default Linux scheduling (baseline)'],
  ['Compaction off (`-n`)', 'scx_compact with all CPUs active: cost of the sched_ext path without compaction'],
  ['Compact', 'scx_compact with default settings (latency guard off)'],
  ['Compact + guard', 'scx_compact `-L 1000 -P 10` (p99 target: 1 ms policy-induced queueing delay)'],
], [28, 72], { boldFirst: true }));
C.push(P('Workload: 8 `dutywork` workers, each running a fixed amount of CPU work for 20 / 40 / 60 / 99 % of every 20 ms period (250 periods, ideal completion 5.0 s), plus a `latprobe` task that wakes every 1 ms and records its lateness (a latency-sensitive task under background load). Each of the 10 repetitions runs all four conditions in a rotated order; the scheduler is restarted for every repetition and condition. Metrics: CPUs ≥ 10 % busy and CPUs parked (< 1 % busy) from `/proc/stat`; active-set size from the scheduler telemetry; completion time; wake-up and probe p95/p99 latency; run-queue wait per time slice from `/proc/schedstat`; context switches. Differences are computed **per repetition (paired)** and summarised with 95 % bootstrap confidence intervals; a difference is reported as clear only when its interval excludes zero.'));
C.push(H2('5.5 Technologies, Tools and OS Concepts Used'));
C.push(...table(['Category', 'Used in this project'], [
  ['Kernel / framework', 'Linux 6.18.53 with sched_ext and BTF; sched_ext `struct_ops` callbacks; BPF timers; array and task-storage maps'],
  ['Languages / build', 'C and BPF-C (clang `-target bpf`), libbpf, bpftool skeletons, Make; Python for analysis'],
  ['Environment', 'Windows laptop (Intel Core i7-13650HX) → WSL2 → QEMU/KVM guest'],
  ['Workloads / tools', 'dutywork and latprobe (developed in the project), stress-ng, `/proc/stat`, `/proc/schedstat`, `/proc/interrupts`'],
  ['OS concepts', 'scheduling classes, run queues / dispatch queues, virtual-time fairness, time slices, CPU affinity, idle-CPU selection, context switches, waiting vs completion time, NO_HZ idle, kernel CPU accounting'],
], [24, 76], { boldFirst: true }));
C.push(H2('5.6 Major Modules / Components'));
C.push(...table(['Module', 'Role', 'Location'], [
  ['BPF scheduling policy + controller', 'placement, shared queue, active-set control, latency guard', '`scheduler/scx_compact.bpf.c`, `scx_compact.h`'],
  ['Loader', 'CPU order, tunables, attach/detach, CSV telemetry', '`scheduler/scx_compact.c`'],
  ['Guest kernel and VM', 'sched_ext kernel build; KVM runner; guest init', '`vm/`'],
  ['Workloads', 'fixed-work duty cycle; 1 ms latency probe', '`tests/dutywork.c`, `tests/latprobe.c`'],
  ['Test and benchmark jobs', 'functional checks F1–F6; benchmark suites', '`tests/vm_*.sh`'],
  ['Analysis', 'per-run metrics, paired statistics, reports', '`tests/analyze_*.py` → `results/processed/`'],
], [28, 40, 32]));
C.push(H2('5.7 Justification of Design Choices'));
C.push(...table(['Choice', 'Reason'], [
  ['sched_ext', 'A real kernel scheduling policy that can be loaded and unloaded at run time, with automatic fallback to the fair scheduler on errors.'],
  ['EEVDF as baseline', 'It is the default Linux scheduler, so it is the policy compaction must be compared against.'],
  ['Compaction-off control (`-n`)', 'It separates the cost of the sched_ext path from the effect of compaction. This proved essential: the full-load latency penalty appears with `-n` too (Section 7.4).'],
  ['Active set + hysteresis', 'A simple, observable rule. Slow shrinking avoids oscillation between set sizes.'],
  ['Latency guard', 'Utilisation cannot see burstiness. The measured tail-latency cost came from the sizing rule keeping 4 CPUs for 3.1 CPUs of bursty demand.'],
  ['Guard measures only policy-caused queueing delay', 'Waits that more CPUs cannot shorten (wakeups of halted vCPUs, per-CPU kernel threads) would make the guard expand uselessly; the diagnostic runs showed exactly this.'],
  ['Paired, interleaved repetitions', 'Host speed drifted between repetitions (mean slowdown 0.95–1.34), so only differences within the same repetition are reliable.'],
  ['KVM guest instead of the host', 'The WSL2 host kernel has no sched_ext. The limitation this imposes on energy measurement is stated in Sections 6.5 and 8.'],
], [30, 70], { boldFirst: true }));

// 6
C.push(H1('6. WORK COMPLETED / CURRENT PROGRESS'));
C.push(H2('6.1 Activities Completed So Far'));
C.push(...table(['Activity', 'Outcome', 'Evidence (repository / commit)'], [
  ['Built the Linux 6.18.53 guest kernel with sched_ext and BTF', 'Build completed', '`results/raw/build/kernel_build_3.log`; 182a48c'],
  ['Built scx_compact and the in-tree reference scheduler scx_qmap; first run under KVM', 'Attach and detach clean, exit 0', '`results/raw/vm/smoke_1.log`; e927c43'],
  ['Functional test suite F1–F6', '12/12 checks pass', '`results/processed/functional_*.md`; e927c43, 958b081'],
  ['Controller v2: smoothed demand + queue hold', 'CPUs used under bursty 8×20 % load: 7 → 5 (one run each)', 'functional F4a; e927c43'],
  ['Preliminary benchmarks (fixed CPU-bound work, partial load, parameter sweep, context switches)', '2–3 repetitions; superseded where the n = 10 run disagrees', '`results/processed/`; e927c43, 43370e2'],
  ['Latency guard and its diagnostics', 'Guard implemented; metric corrected over six diagnostic runs', '`results/raw/vm/guard_diag_1..6.log`; 958b081'],
  ['Repeated validation: 4 conditions × 4 loads × 10 repetitions', '160 runs, 0 errors', '`results/processed/bench_repeated_20260924T111310Z.md`; 20012ec'],
  ['Bare-metal RAPL energy experiment', 'Blocked: no RAPL counters in the environment', '`docs/RAPL_EXPERIMENT.md`; c9cbc3e'],
], [40, 30, 30]));
C.push(H2('6.2 Modules Implemented'));
C.push(...table(['Module', 'Implementation status', 'Size'], [
  ['BPF policy + controller + latency guard', 'Implemented and validated', '473 lines (`scx_compact.bpf.c`) + 36 (`scx_compact.h`)'],
  ['Loader with telemetry and 13 policy options (incl. `-n`, `-L`, `-P`)', 'Implemented', '294 lines (`scx_compact.c`)'],
  ['dutywork / latprobe workloads', 'Implemented', '161 / 64 lines'],
  ['Test, benchmark and analysis scripts', 'Implemented', '`tests/`'],
  ['Guest kernel, VM runner, toolchain scripts', 'Implemented', '`vm/`, `scripts/`'],
], [42, 26, 32]));
C.push(H2('6.3 Development / Testing Progress'));
C.push(tcaption('Table 6.3a  Functional suite (kernel accounting from /proc/stat; latest run after the latency-guard change)'));
C.push(...table(['Check', 'Result'], [
  ['F1: sched_ext present; reference scheduler scx_qmap attaches and detaches', 'PASS'],
  ['F2: scx_compact attaches, runs all phases, exits cleanly (exit 0)', 'PASS'],
  ['F3: idle and 1 busy task stay in a 2-CPU set; 4 / 8 busy tasks expand it to 6 / 8; set shrinks back to 2', 'PASS (5 checks)'],
  ['F4: under the 8×20 % duty load, compact uses fewer CPUs than EEVDF (5 vs 8); the `-n` control uses all 8', 'PASS (2 checks)'],
  ['F5: a task pinned to CPU 7, outside the 2-CPU set, still runs (CPU 7 100 % busy)', 'PASS'],
  ['F6: no sched_ext error or watchdog stall in dmesg', 'PASS'],
], [82, 18], { center: [1] }));
C.push(P('Evidence excerpt: first run of scx_compact on the sched_ext kernel (`results/raw/vm/smoke_1.log`). One busy task stays inside the 2-CPU active set:', { keepNext: true }));
C.push(...mono([
  '[    6.509431] sched_ext: BPF scheduler "compact" enabled',
  't=   2.7s active= 2 util= 50% queued=  0 expand=0 shrink=0 busy_cpus(>=5%)= 1 | 101   3   0   0   0   0   0   0',
  '[   13.324692] sched_ext: BPF scheduler "compact" disabled (unregistered from user space)',
  '[smoke] scx_compact exit: 0',
]));
C.push(H2('6.4 Problems Encountered and Adaptations'));
C.push(...table(['Problem', 'Effect', 'Adaptation', 'Verified result'], [
  ['WSL2 host kernel has no sched_ext', 'Scheduler cannot run on the host', 'Built a 6.18.53 guest kernel; KVM test VM', 'Guest boots under KVM with sched_ext'],
  ['C: drive filled during the kernel link', 'Build failed; WSL file system went read-only', 'Disk guard, compressed debug info, WSL memory cap', 'Kernel build completed'],
  ['In-tree scx_simple calls a kfunc missing in 6.18', 'Build failure', 'Write `dsq_vtime` directly; use scx_qmap as reference', 'Scheduler build succeeds'],
  ['Controller reacted to single 20 ms samples', 'Bursty load inflated the set (7 of 8 CPUs used)', 'EWMA demand + queue hold', '5 CPUs used (F4a)'],
  ['Compaction raised tail latency', 'Probe p99 +2.9 / +1.4 ms (20 / 40 %)', 'Latency guard', '+0.14 / +0.06 ms (Section 7.4)'],
  ['Guard metric counted all waits', 'Wakeups of halted vCPUs (> 1 ms) and per-CPU kernel threads gave ~10 % "late" even with `-n`', 'Count only shared-queue waits of tasks that may run on any CPU', '`-n` control: 0 late of ~2,500 dispatches'],
  ['Wrong denominator (queued dispatches only)', 'Too few samples; the guard could never act', 'Denominator = all dispatches of those tasks', '~400 samples per second'],
  ['Integer decay stuck at small counts', 'Late fraction stuck near 10 %', 'Fixed-point decay', 'Fraction returns to 0 in steady state'],
  ['Host speed drift between repetitions', 'Mean slowdown per repetition 0.95–1.34', 'Interleaved, rotated conditions; paired analysis', 'Narrow paired intervals'],
  ['Earlier 3-repetition result: “no latency cost at 20 %”', 'Wrong conclusion (underpowered, no probe)', 'n = 10 with latency probe', 'Revised: clear cost at 20 %'],
  ['Full-load latency of every sched_ext condition', '~2.3 ms higher p99 than EEVDF, also with `-n`', 'Documented as a base-policy limitation', 'Not addressed yet'],
  ['No RAPL under WSL2/Hyper-V', 'Energy cannot be measured', 'No substitute used; documented', 'Pending native Linux'],
], [24, 26, 26, 24], { size: 17 }));
C.push(H2('6.5 Current Project Status'));
C.push(P('The scheduler, controller and latency guard are implemented and validated in the VM, and feature development is frozen. Reduced CPU usage under partial load and the latency trade-off are **measured** (n = 10, paired). **Energy has not been measured.** The following limitations apply:'));
C.push(bullet('**No RAPL:** the environment is WSL2 on Hyper-V (`systemd-detect-virt`: wsl). The kernel reports 0 RAPL counters, there are no `energy-pkg`/`energy-cores` events, `/sys/class/powercap` is empty and no MSR device is available. The drivers are present, but the hypervisor does not pass the counters through. A VM inside WSL2 cannot solve this, and the scheduler cannot run natively on the WSL2 kernel.'));
C.push(bullet('**Virtual machine:** an idle vCPU is not a parked physical core, so CPU-usage results show the precondition for energy savings, not the savings themselves. Occasional 100–200 ms latency maxima appear in all conditions, so only p95/p99 are interpreted.'));
C.push(bullet('**Workloads are synthetic** (dutywork, latprobe, stress-ng). The compile and mixed workloads planned in Review-1 are pending.'));

// 7
C.push(H1('7. LAST CONTRIBUTIONS / RECENT PROGRESS'));
C.push(H2('7.1 Most Recent Work Completed'));
C.push(bullet('**Latency guard (commit 958b081):** diagnosed the tail-latency cost and implemented and corrected the guard metric over six diagnostic runs. The functional suite still passes 12/12.'));
C.push(bullet('**Repeated validation (commit 20012ec):** 160 runs (4 conditions × 4 loads × 10 repetitions), 0 scheduler, kernel or harness errors, with paired per-repetition analysis.'));
C.push(bullet('**Energy experiment attempt (commit c9cbc3e):** environment check for RAPL; the experiment is blocked and documented, and no estimate was substituted.'));
C.push(H2('7.2 New Functionality or Improvements Added'));
C.push(bullet('**Controller v2:** EWMA-smoothed demand and sustained-queue expansion replaced reaction to single 20 ms samples. CPUs used under the bursty 8×20 % load fell from 7 to 5 (one run each).'));
C.push(bullet('**Latency guard:** an explainable, configurable safety mechanism (`-L`, `-P`) that expands the set only when the scheduler’s own queueing delay exceeds a target, and recovers through the normal hysteresis.'));
C.push(bullet('**Measurement tools:** the dutywork fixed-work workload, the latprobe latency probe, and paired bootstrap statistics.'));
C.push(H2('7.3 Contributions Made Since the Previous Review'));
C.push(P('Review-1 proposed the design and plan. Since then the team has built the sched_ext environment, implemented scx_compact, validated it functionally, and improved the controller twice (smoothing, then the latency guard). The team also replaced 2–3-repetition measurements with a 10-repetition paired experiment, which overturned one earlier conclusion, and checked the feasibility of RAPL measurement.'));
C.push(H2('7.4 Current Achievements / Results'));
C.push(...figure('fig5_results.png', 6.5, 'Figure 5. CPUs used and latency-probe p99 per load (n = 10 per bar, mean ± 95 % CI).'));
C.push(tcaption('Table 7.4a  Means over 10 repetitions (MEASURED; results/processed/bench_repeated_20260924T111310Z.md)'));
C.push(...table(['Load', 'CPUs used: EEVDF / -n / compact / guard', 'CPUs parked (< 1 % busy): EEVDF / compact / guard', 'Probe p99 (µs): EEVDF / -n / compact / guard'], [
  ['20 %', '6.0 / 7.3 / 3.0 / 4.0', '1.3 / 5.0 / 3.3', '350 / 415 / 3224 / 489'],
  ['40 %', '7.8 / 8.0 / 5.4 / 7.0', '0.1 / 2.1 / 0.7', '389 / 426 / 1782 / 446'],
  ['60 %', '8.0 / 8.0 / 6.9 / 7.9', '0.0 / 1.1 / 0.0', '1408 (median 509) / 432 / 1751 / 437'],
  ['99 %', '8.0 / 8.0 / 8.0 / 8.0', '0.0 / 0.0 / 0.0', '1046 / 3439 / 3354 / 3274'],
], [10, 30, 30, 30], { center: [0, 1, 2, 3] }));
C.push(tcaption('Table 7.4b  Paired differences vs EEVDF, mean [95 % bootstrap CI]; bold = interval excludes 0'));
C.push(...table(['Load', 'Compact: CPUs', 'Compact: probe p99', 'Guard: CPUs', 'Guard: probe p99'], [
  ['20 %', '**−3.0** [−3.6, −2.3]', '**+2.9 ms** [2.2, 3.6]', '**−2.0** [−2.8, −1.3]', '**+0.14 ms** [0.07, 0.21]'],
  ['40 %', '**−2.4** [−2.9, −1.9]', '**+1.4 ms** [0.7, 2.1]', '**−0.8** [−1.3, −0.4]', '**+0.06 ms** [0.01, 0.12]'],
  ['60 %', '**−1.1** [−1.5, −0.7]', '+0.3 ms [−0.4, 1.1]', '−0.1 [−0.3, 0.0]', '**−1.0 ms** [−1.7, −0.2]'],
  ['99 %', '0.0', '**+2.3 ms** [1.7, 2.9]', '0.0', '**+2.2 ms** [1.6, 2.9]'],
], [10, 22, 23, 22, 23], { center: [0, 1, 2, 3, 4] }));
C.push(bullet('**Compaction frees CPUs** at every partial load: 3.0 / 2.4 / 1.1 fewer CPUs at 20 / 40 / 60 %. Completion time shows no significant change, except **+1.6 %** for compact at 20 % [0.1 %, 3.9 %].'));
C.push(bullet('**Compaction has a clear latency cost** at 20 % and 40 % load (probe p99 +2.9 / +1.4 ms). This **revises** the earlier 3-repetition statement that there was no latency cost at 20 %; that statement is withdrawn.'));
C.push(bullet('**The latency guard removes most of that cost:** probe p99 is within +0.14 / +0.06 ms of EEVDF at 20 / 40 %, while 2.0 / 0.8 CPUs stay unused. At 60 % almost no compaction remains (−0.1 CPUs, not significant).'));
C.push(bullet('**At ~100 % load** all sched_ext conditions, **including the compaction-off control**, show about 2.3 ms higher p99 than EEVDF (run-queue wait 425–496 µs vs 16 µs per slice). This is a limitation of the base policy: a woken task can wait for the current 5 ms time slice to end instead of preempting it. It is not caused by compaction.'));
C.push(bullet('**Energy: NOT measured.** A model-based idle-time estimate exists in the repository (`tests/analyze_partial.py`). It rests on assumed coefficients, is labelled as a model estimate only, and is not reported as an energy result.'));

// 8
C.push(H1('8. REMAINING WORK & FUTURE PLAN'));
C.push(H2('8.1 Pending Tasks'));
C.push(numbered('**Bare-metal energy experiment:** boot native Linux on the laptop (live USB or dual boot) with a sched_ext-capable kernel and readable RAPL counters. Re-run the frozen n = 10 matrix with package/core energy read before and after each run (`docs/RAPL_EXPERIMENT.md`).', 'num'));
C.push(numbered('**Workloads from the Review-1 plan:** a compilation workload and a mixed interactive workload, both with the latency probe.', 'num'));
C.push(numbered('**Guard and shrink settings:** repeat 2–3 settings with n = 10 and decide whether the guard should be enabled by default.', 'num'));
C.push(numbered('**Full-load latency:** document the base-policy limitation in the final report, or evaluate a small wake-up-preemption change if it is cheap.', 'num'));
C.push(numbered('**Optional:** SMT/CPU-order study on bare metal; reference comparison with scx_lavd if its Rust toolchain can be installed.', 'num'));
C.push(H2('8.2 Testing / Validation Still Required'));
C.push(P('Energy (RAPL) validation on bare metal; validation on real application workloads; a confirmatory run of the chosen guard setting; and re-running the functional suite on the bare-metal kernel.'));
C.push(H2('8.3 Updated Feasibility'));
C.push(...table(['Aspect', 'Assessment'], [
  ['Technical', 'Demonstrated: the scheduler runs on sched_ext, passes 12/12 checks and completed 160 runs without errors. The only blocked item is energy measurement, which needs native Linux with accessible RAPL counters.'],
  ['Economic', 'No additional cost: open-source kernel and tools on the existing laptop. The bare-metal run needs only a bootable Linux USB drive.'],
  ['Social / environmental', 'Keeping idle CPUs fully idle is the precondition for lower energy use on everyday partially loaded machines. The project has measured that precondition (fewer CPUs used), but **not** an energy reduction, and makes no energy-saving claim until RAPL data exists.'],
], [20, 80], { boldFirst: true }));
C.push(H2('8.4 Expected Final Outcome'));
C.push(P('A documented, reproducible sched_ext core-compaction scheduler with a latency guard, together with a measured comparison against EEVDF on CPUs used, completion time and latency. If bare-metal access is obtained, it will also include measured RAPL energy per run; otherwise energy stays explicitly pending. The final report and demonstration will show live telemetry of the active set under changing load.'));
C.push(H2('8.5 Timeline / Plan for Completion'));
C.push(...table(['Period', 'Planned work'], [
  ['Week 1 after Review-2', 'Bare-metal Linux boot; verify sched_ext and RAPL access; run the energy matrix'],
  ['Week 2', 'Compilation and mixed workloads; guard/shrink settings (n = 10)'],
  ['Week 3', 'Full-load latency note; optional SMT-order / scx_lavd comparison'],
  ['Week 4', 'Final report, README, demonstration and presentation'],
], [26, 74], { boldFirst: true }));

// references
C.push(H1('REFERENCES'));
[
  '[1] T. Heo et al., “sched_ext: Implement BPF extensible scheduler class,” Linux kernel patch series and kernel documentation (Documentation/scheduler/sched-ext.rst).',
  '[2] Linux Kernel Documentation, “EEVDF Scheduler,” kernel scheduler documentation.',
  '[3] Linux Kernel Documentation, “Energy Aware Scheduling,” kernel scheduler documentation.',
  '[4] sched-ext/scx contributors, “scx_lavd,” sched_ext scheduler documentation and source tree, 2025-2026.',
  '[5] Vellore Institute of Technology, “BCSE303L Operating Systems,” Course Outcomes: CO2 – Design scheduling algorithms to compute and compare various scheduling criteria; syllabus version 1.0.',
].forEach((r) => C.push(P(r, { size: 19, align: AlignmentType.LEFT, after: 20, line: 240 })));

// ---------- document ----------
const doc = new Document({
  creator: 'Mohammed Asif A; Konasani Vaibhav',
  lastModifiedBy: 'Mohammed Asif A',
  title: 'BCSE303P Project Review-2 Report',
  description: 'Energy-Aware CPU Scheduling in Linux using sched_ext: Core-Compaction Scheduling for Reduced Energy Consumption',
  styles: {
    default: { document: { run: { font: BODY, size: 23 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: HEAD, size: 28, bold: true, color: HBLUE }, paragraph: { spacing: { before: 200, after: 90 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: HEAD, size: 22, bold: true, color: NAVY }, paragraph: { spacing: { before: 140, after: 60 }, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [
    { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '●', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 540, hanging: 300 } }, run: { size: 16 } } }] },
    { reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: 1134, bottom: 1134, left: MARGIN, right: MARGIN, header: 560, footer: 560 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: 'BCSE303P-OperatingSystemsLab|ProjectReview-2', font: BODY, size: 17, color: '7F7F7F' })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: ['Page ', PageNumber.CURRENT], font: BODY, size: 18 })] })] }) },
    children: [...title, ...C],
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(OUTFILE, buf); console.log('wrote', OUTFILE, buf.length, 'bytes'); });
