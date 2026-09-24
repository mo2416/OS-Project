#!/usr/bin/env python3
"""In-place edit of reports/review2/BCSE303P_Project_Review2_Report.docx.

Changes only: Section 1.1 member column and intro sentence; selected paragraphs and table
cells reworded in plainer language (facts unchanged) with added citations; five appended
references; Figures 2, 3 and 5 replaced (re-framed / restyled PNGs from ../assets) with
width 6.5 in and aspect ratio preserved; spacing before figure paragraphs. Every other
part of the document is copied unchanged.
"""
import re, struct, sys, zipfile, shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOCX = HERE.parent / 'BCSE303P_Project_Review2_Report.docx'
ASSETS = HERE.parent / 'assets'

z = zipfile.ZipFile(DOCX)
parts = {n: z.read(n) for n in z.namelist()}
infos = {n: z.getinfo(n) for n in z.namelist()}
z.close()
x = parts['word/document.xml'].decode('utf8')

esc = lambda s: s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
unesc = lambda s: s.replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&amp;', '&')
PARA = re.compile(r'<w:p>.*?</w:p>|<w:p [^>]*>.*?</w:p>', re.S)
plain = lambda p: unesc(''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', p)))


def base_rpr(p):
    """rPr of the paragraph's first plain (non-bold, non-Consolas) run, without the tags."""
    for r in re.findall(r'<w:r>.*?</w:r>', p, re.S):
        m = re.search(r'<w:rPr>(.*?)</w:rPr>', r, re.S)
        inner = m.group(1) if m else ''
        if '<w:b/>' in inner or 'Consolas' in inner:
            continue
        return inner
    return ''


def rpr(inner, bold=False, code=False):
    fonts = re.search(r'<w:rFonts[^>]*/>', inner)
    color = re.search(r'<w:color[^>]*/>', inner)
    sz = re.search(r'<w:sz w:val="(\d+)"/>', inner)
    ital = '<w:i/><w:iCs/>' if '<w:i/>' in inner else ''
    size = int(sz.group(1)) if sz else 23
    if code:
        fonts_x = '<w:rFonts w:ascii="Consolas" w:eastAsia="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>'
        size -= 3
    else:
        fonts_x = fonts.group(0) if fonts else ''
    b = '<w:b/><w:bCs/>' if bold else ''
    body = fonts_x + b + ital + (color.group(0) if color else '') + (f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>' if (sz or code) else '')
    return f'<w:rPr>{body}</w:rPr>' if body else ''


def runs(markup, inner):
    out = []
    for tok in re.split(r'(\*\*[^*]+\*\*|`[^`]+`)', markup):
        if not tok:
            continue
        if tok.startswith('**'):
            t, pr = tok[2:-2], rpr(inner, bold=True)
        elif tok.startswith('`'):
            t, pr = tok[1:-1], rpr(inner, code=True)
        else:
            t, pr = tok, rpr(inner)
        out.append(f'<w:r>{pr}<w:t xml:space="preserve">{esc(t)}</w:t></w:r>')
    return ''.join(out)


def set_para(p, markup):
    head = re.match(r'(<w:p(?: [^>]*)?>(?:<w:pPr>.*?</w:pPr>)?)', p, re.S).group(1)
    return head + runs(markup, base_rpr(p)) + '</w:p>'


def edit_para(old_start, markup, count=1):
    """Replace the runs of the paragraph(s) whose plain text starts with old_start."""
    global x
    hits = [m for m in PARA.finditer(x) if plain(m.group(0)).startswith(old_start)]
    if len(hits) != count:
        sys.exit(f'expected {count} paragraph(s) starting with {old_start!r}, found {len(hits)}')
    for m in reversed(hits):
        x = x[:m.start()] + set_para(m.group(0), markup) + x[m.end():]


# ---------- 1. Section 1.1 team contribution ----------
edit_para('The project work completed so far was carried out jointly',
          'The six work packages completed so far were divided between the two team members as listed below, together with their evidence in the project repository.')
KV, MA = 'Konasani Vaibhav — 24BCE0419', 'Mohammed Asif A — 24BCE2076'
owner = {'Environment:': KV, 'Scheduler:': MA, 'Latency guard design and diagnostics': KV,
         'Test suite and workloads': MA, 'Experiments and statistical analysis': KV, 'Documentation and reports': MA}
done = 0
for m in list(re.finditer(r'<w:tr>.*?</w:tr>|<w:tr [^>]*>.*?</w:tr>', x, re.S))[::-1]:
    row = m.group(0)
    cells = re.findall(r'<w:tc>.*?</w:tc>', row, re.S)
    if len(cells) != 3:
        continue
    first = plain(cells[0])
    key = next((k for k in owner if first.startswith(k)), None)
    if not key or KV not in plain(cells[2]):
        continue
    c = cells[2]
    ps = PARA.findall(c)
    newc = c.replace(''.join(ps), set_para(ps[0], owner[key])) if ''.join(ps) in c else None
    if newc is None:  # paragraphs not contiguous: rebuild content after tcPr
        tcpr = re.search(r'<w:tcPr>.*?</w:tcPr>', c, re.S).group(0)
        newc = '<w:tc>' + tcpr + set_para(ps[0], owner[key]) + '</w:tc>'
    row2 = row.replace(c, newc)
    x = x[:m.start()] + row2 + x[m.end():]
    done += 1
assert done == 6, done

# ---------- 3./5. plainer wording + citations (facts unchanged) ----------
E = [
 ('The CPU scheduler decides which runnable task runs',
  'The CPU scheduler is the part of the operating system that decides which ready task runs on which processor and when. The default fair scheduler in current Linux is EEVDF (Earliest Eligible Virtual Deadline First) [2], [6], which aims to share CPU time fairly while keeping response times low. **sched_ext** is a Linux feature that lets a scheduling policy be written as a small BPF program and loaded while the system is running. If the BPF scheduler misbehaves, the kernel automatically switches back to the default scheduler [1]. This makes it practical to build and test a real kernel scheduling policy without rebuilding the kernel for every change.'),
 ('A processor saves most of its idle power when cores stay idle',
  'A processor saves most of its idle power when a core stays idle long enough to enter a deep sleep (idle) state [7]. On a machine with identical cores, EEVDF spreads ready tasks over idle CPUs to favour throughput and response time, so even a light load keeps many cores briefly busy. Linux Energy Aware Scheduling applies only to processors with different core types and an energy model, and it does not support SMT (two hardware threads per core) [3], so typical x86 laptops get no energy-driven packing of work. **Core compaction** packs a light load onto a small, load-dependent set of CPUs and leaves the others idle. The idea is not new: scx_lavd already implements it together with many other mechanisms [4]. This project builds a small, transparent version of it and measures its trade-offs.'),
 ('Existing sched_ext compaction (scx_lavd) is combined',
  'Existing sched_ext compaction (scx_lavd) is combined with many other mechanisms, so the effect of compaction alone is hard to isolate [4].'),
 ('In scope: a sched_ext BPF scheduler',
  '**In scope:** a sched_ext scheduler that uses a load-sized set of active CPUs, grows and shrinks that set gradually, and has an optional latency guard; correctness tests; and a repeated comparison with EEVDF on CPUs used, completion time, latency and context switches. **Out of scope:** changes to EEVDF itself, CPU frequency control, application-specific policies and production deployment. **Energy:** measuring energy requires Intel RAPL energy counters on Linux running directly on the hardware (bare metal) [8], [9]. It is part of the scope but still pending (Section 8).'),
 ('The scheduler keeps an active CPU set',
  'The scheduler keeps an **active CPU set**: the first `nr_active` CPUs in a fixed order that fills both hardware threads of one core before moving to the next core. A woken task is placed only on an idle CPU inside this set. CPUs outside the set take no work, so they stay idle. A controller runs every 20 ms and resizes the set from the measured CPU demand, the number of waiting tasks and (optionally) the measured waiting time. The same program with compaction switched off (`-n`) is used as a control condition, to separate the effect of compaction from the cost of running under sched_ext at all.'),
 ('The WSL2 kernel on the development laptop does not include sched_ext',
  'The WSL2 kernel on the development laptop does not include sched_ext, so the project builds its own Linux 6.18.53 kernel with sched_ext enabled and runs every test in a virtual machine (QEMU/KVM) with 8 virtual CPUs (4 cores × 2 hardware threads). A small user program, the loader, starts the BPF scheduler, passes its settings and records its state every 200 ms. The test scripts record the kernel’s CPU statistics before and after each run, and analysis scripts turn the raw data into the result tables.'),
 ('Demand: busy time summed over all CPUs',
  '**Demand:** the total CPU busy time in each 20 ms interval, smoothed with a moving average (weight 1/8) so that short bursts do not resize the set.'),
 ('Expand when demand exceeds 80 %',
  '**Expand** when demand exceeds 80 % of the set’s capacity, or when at least as many tasks as there are active CPUs have been waiting for 2 consecutive ticks. **Shrink** by one CPU only after the load has fitted into one CPU fewer at ≤ 50 % utilisation for 5 consecutive ticks; this slow release (hysteresis) stops the set size from oscillating.'),
 ('Latency guard (-L 1000 -P 10; off by default)',
  '**Latency guard** (`-L 1000 -P 10`, off by default): compaction can make a task wait because every active CPU is busy. The guard measures exactly this delay, i.e. the time a task spends in the shared queue before it runs; only tasks that are allowed to run on any CPU are counted, and a task placed directly on an idle CPU counts as not delayed. If more than 1 % of recent dispatches waited longer than 1 ms, the guard adds one CPU and then pauses for 8 ticks. The set may not shrink again until fewer than 0.5 % of dispatches are late; after that, the normal slow shrinking applies.'),
 ('Workload: 8 dutywork workers',
  'Workload: 8 `dutywork` workers, each doing a fixed amount of CPU work for 20, 40, 60 or 99 % of every 20 ms period (250 periods; ideal completion time 5.0 s). Alongside them, a `latprobe` task wakes up every 1 ms and records how late each wake-up is; it represents an interactive task under background load. Each of the 10 repetitions runs all four conditions in a rotated order, and the scheduler is restarted every time. Measured values: CPUs used (≥ 10 % busy) and CPUs parked (< 1 % busy), active-set size, completion time, wake-up and probe latency (p95/p99), average run-queue waiting time and context switches. Each condition is compared with EEVDF **within the same repetition (paired)**, with a 95 % bootstrap confidence interval; a difference is called clear only when this interval excludes zero.'),
 ('Linux 6.18.53 with sched_ext and BTF; sched_ext struct_ops',
  'Linux 6.18.53 with sched_ext; the policy is a BPF program attached through sched_ext callbacks, with a BPF timer and BPF maps (shared kernel data tables)'),
 ('C and BPF-C (clang -target bpf)',
  'C for the scheduler, loader and workloads (BPF code compiled with clang and loaded with libbpf); Python for analysis'),
 ('scheduling classes, run queues / dispatch queues, virtual-time fairness',
  'scheduling classes, run queues / dispatch queues, fair (virtual-time) ordering, time slices, CPU affinity, idle-CPU selection, context switches, waiting vs completion time, tickless idle, kernel CPU-time accounting'),
 ('Waits that more CPUs cannot shorten',
  'Some waits cannot be shortened by adding CPUs (slow wake-ups of idle virtual CPUs, per-CPU kernel threads); counting them would make the guard add CPUs uselessly. The diagnostic runs showed exactly this.'),
 ('Disk guard, compressed debug info, WSL memory cap',
  'Free-space check during the build, smaller debug information, WSL memory limit'),
 ('Write dsq_vtime directly; use scx_qmap as reference',
  'Set the task’s virtual time directly instead; use scx_qmap as the reference scheduler'),
 ('EWMA demand + queue hold', 'Smoothed demand + queue hold'),
 ('Wakeups of halted vCPUs (> 1 ms) and per-CPU kernel threads',
  'Slow wake-ups of idle virtual CPUs (> 1 ms) and per-CPU kernel threads gave ~10 % "late" even with `-n`'),
 ('Count only shared-queue waits of tasks that may run on any CPU',
  'Count only shared-queue waits of tasks allowed on any CPU'),
 ('Integer decay stuck at small counts', 'Rounding in the decay (averaging) step'),
 ('Fixed-point decay', 'Scaled-integer (fixed-point) arithmetic'),
 ('No RAPL: the environment is WSL2 on Hyper-V',
  '**No RAPL:** the project runs in WSL2 on Hyper-V (detected as `wsl`). The kernel reports 0 RAPL energy counters, no energy-pkg / energy-cores events are available, the power-capping interface `/sys/class/powercap` [10] is empty and no MSR device is available. The drivers are present, but the hypervisor does not pass the counters through. A VM inside WSL2 cannot solve this, and the scheduler cannot run natively on the WSL2 kernel.'),
 ('Controller v2: EWMA-smoothed demand',
  '**Controller v2:** smoothed demand and a sustained-queue rule replaced reacting to single 20 ms samples. CPUs used under the bursty 8×20 % load fell from 7 to 5 (one run each).'),
 ('Bare-metal energy experiment: boot native Linux',
  '**Bare-metal energy experiment:** boot Linux directly on the laptop (live USB or dual boot) with a sched_ext-capable kernel and readable RAPL counters, then repeat the same n = 10 experiment and record processor energy before and after each run [9] (`docs/RAPL_EXPERIMENT.md`).'),
 ('Full-load latency: document the base-policy limitation',
  '**Full-load latency:** document the base-policy limitation in the final report, or test a small change that lets a woken task preempt the running one, if this is simple.'),
]
for old, new in E:
    edit_para(old, new)

# ---------- 5. references [6]-[10], appended after [5] ----------
NEW_REFS = [
 '[6] I. Stoica and H. Abdel-Wahab, “Earliest Eligible Virtual Deadline First: A Flexible and Accurate Mechanism for Proportional Share Resource Allocation,” Technical Report TR-95-22, Department of Computer Science, Old Dominion University, 1995.',
 '[7] E. Le Sueur and G. Heiser, “Dynamic Voltage and Frequency Scaling: The Laws of Diminishing Returns,” in Proc. Workshop on Power Aware Computing and Systems (HotPower ’10), USENIX, 2010.',
 '[8] H. David, E. Gorbatov, U. R. Hanebutte, R. Khanna, and C. Le, “RAPL: Memory Power Estimation and Capping,” in Proc. ACM/IEEE Int. Symp. on Low Power Electronics and Design (ISLPED ’10), 2010, pp. 189–194. doi:10.1145/1840845.1840883.',
 '[9] K. N. Khan, M. Hirki, T. Niemi, J. K. Nurminen, and Z. Ou, “RAPL in Action: Experiences in Using RAPL for Power Measurements,” ACM Trans. Modeling and Performance Evaluation of Computing Systems, vol. 3, no. 2, Art. 9, 2018. doi:10.1145/3177754.',
 '[10] Linux Kernel Documentation, “Power Capping Framework” (Documentation/power/powercap/powercap.rst).',
]
m = next(m for m in PARA.finditer(x) if plain(m.group(0)).startswith('[5] Vellore Institute of Technology'))
ref5 = m.group(0)
x = x[:m.end()] + ''.join(set_para(ref5, r) for r in NEW_REFS) + x[m.end():]

# ---------- 2./4. figures 2, 3, 5: new images, width 6.5 in, aspect preserved ----------
EMU_W = int(6.5 * 914400)
def png_size(b):
    return struct.unpack('>II', b[16:24])
for name, media in [('fig2_placement.png', 'word/media/image2.png'), ('fig3_controller.png', 'word/media/image3.png'),
                    ('fig5_results.png', 'word/media/image5.png')]:
    data = (ASSETS / name).read_bytes()
    w, h = png_size(data)
    emu_h = round(EMU_W * h / w)
    parts[media] = data
    dm = re.search(r'<w:drawing>(?:(?!</w:drawing>).)*?name="' + re.escape(name) + r'".*?</w:drawing>', x, re.S)
    d = dm.group(0)
    d2 = re.sub(r'<wp:extent cx="\d+" cy="\d+"/>', f'<wp:extent cx="{EMU_W}" cy="{emu_h}"/>', d)
    d2 = re.sub(r'<a:ext cx="\d+" cy="\d+"/>', f'<a:ext cx="{EMU_W}" cy="{emu_h}"/>', d2)
    x = x[:dm.start()] + d2 + x[dm.end():]
# spacing before every figure paragraph (image paragraphs are the only ones with a drawing)
def more_space(mm):
    p = mm.group(0)
    return p.replace('<w:spacing w:before="60"/>', '<w:spacing w:before="140" w:after="20"/>', 1) if '<w:drawing>' in p else p
x = PARA.sub(more_space, x)

parts['word/document.xml'] = x.encode('utf8')
tmp = DOCX.with_suffix('.tmp.docx')
with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as out:
    for n, data in parts.items():
        zi = infos[n]
        zi.compress_type = zipfile.ZIP_DEFLATED
        out.writestr(zi, data)
shutil.move(tmp, DOCX)
print('edited', DOCX)
