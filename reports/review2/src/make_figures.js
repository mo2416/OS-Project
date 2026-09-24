// Generates the Review-2 report figures (SVG + PNG) into ../assets.
// Figures 1-4 describe the implemented system; Figure 5 plots values parsed from
// results/processed/bench_repeated_20260924T111310Z.md (no hand-typed numbers).
//
//   NODE_PATH=<dir with node_modules containing @resvg/resvg-js> node make_figures.js
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.resolve(__dirname, '../assets');
fs.mkdirSync(OUT, { recursive: true });

const NAVY = '#1F3864', BLUE = '#2E74B5', LIGHT = '#DCE6F2', PALE = '#F2F6FB',
  GREY = '#595959', GREEN = '#E2EFDA', GREENB = '#548235', ORANGE = '#FBE5D6', ORANGEB = '#C55A11',
  YEL = '#FFF2CC', YELB = '#BF8F00';
const FONT = 'Liberation Sans';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function text(x, y, s, o = {}) {
  const lines = Array.isArray(s) ? s : [s];
  const size = o.size || 22, lh = o.lh || size * 1.25;
  const y0 = y - ((lines.length - 1) * lh) / 2;
  return lines.map((l, i) => `<text x="${x}" y="${y0 + i * lh}" font-family="${FONT}" font-size="${size}" ` +
    `font-weight="${o.bold ? 'bold' : 'normal'}" fill="${o.fill || '#000'}" text-anchor="${o.anchor || 'middle'}" ` +
    `dominant-baseline="middle"${o.italic ? ' font-style="italic"' : ''}>${esc(l)}</text>`).join('');
}
function box(x, y, w, h, o = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 10}" fill="${o.fill || LIGHT}" ` +
    `stroke="${o.stroke || NAVY}" stroke-width="${o.sw || 2}"${o.dash ? ' stroke-dasharray="8 5"' : ''}/>` +
    (o.label ? text(x + w / 2, y + h / 2, o.label, { size: o.size, bold: o.bold, fill: o.tfill || NAVY }) : '');
}
function diamond(cx, cy, w, h, label, o = {}) {
  const p = `${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2} ${cx - w / 2},${cy}`;
  return `<polygon points="${p}" fill="${o.fill || YEL}" stroke="${o.stroke || YELB}" stroke-width="2.5"/>` +
    text(cx, cy, label, { size: o.size || 19, fill: '#000' });
}
function arrow(x1, y1, x2, y2, o = {}) {
  const pts = o.via ? [[x1, y1], ...o.via, [x2, y2]] : [[x1, y1], [x2, y2]];
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
  let s = `<path d="${d}" fill="none" stroke="${o.color || GREY}" stroke-width="${o.sw || 2.5}"` +
    `${o.dash ? ' stroke-dasharray="8 6"' : ''} marker-end="url(#ah)"/>`;
  if (o.label) {
    const [lx, ly] = o.lpos || [(pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2];
    s += text(lx, ly, o.label, { size: o.lsize || 18, fill: o.lcolor || GREY, anchor: o.lanchor || 'middle', italic: true });
  }
  return s;
}
function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M0,0 L10,5 L0,10 z" fill="${GREY}"/></marker></defs>` +
    `<rect width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`;
}
function render(s) {
  return new Resvg(s, { font: { loadSystemFonts: true, defaultFontFamily: FONT }, fitTo: { mode: 'zoom', value: 2 } }).render();
}
// crop: re-frame the drawing to its content bounding box plus an equal margin on all sides,
// so the diagram is centred inside its image. The drawing itself is unchanged.
function save(name, s, crop) {
  if (crop) {
    const r = render(s), px = r.pixels, W = r.width, H = r.height;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (px[i] < 245 || px[i + 1] < 245 || px[i + 2] < 245) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const pad = 8, vx = x0 / 2 - pad, vy = y0 / 2 - pad, vw = (x1 - x0) / 2 + 2 * pad, vh = (y1 - y0) / 2 + 2 * pad;
    s = s.replace(/width="[\d.]+" height="[\d.]+" viewBox="[^"]+"/, `width="${vw.toFixed(1)}" height="${vh.toFixed(1)}" viewBox="${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}"`)
      .replace(/<rect width="\d+" height="\d+" fill="#ffffff"\/>/, `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#ffffff"/>`);
  }
  fs.writeFileSync(path.join(OUT, name + '.svg'), s);
  const png = render(s);
  fs.writeFileSync(path.join(OUT, name + '.png'), png.asPng());
  console.log(name, png.width, 'x', png.height);
}

// Layout rule: canvas widths of 1000-1200 units with 17-20 unit text, so that labels
// print at about 7-8 pt when a figure is placed at 5.8-6.5 inches.
// ---------------- Figure 1: system architecture ----------------
{
  let b = '';
  b += box(8, 8, 1184, 744, { fill: '#FAFAFA', stroke: '#7F7F7F', dash: true, rx: 12 });
  b += text(22, 32, 'Windows laptop ▸ WSL2 (Microsoft kernel, no sched_ext)', { size: 19, anchor: 'start', bold: true, fill: GREY });
  b += box(22, 55, 300, 215, { fill: PALE, stroke: BLUE });
  b += text(172, 82, 'Build (WSL2)', { size: 20, bold: true, fill: NAVY });
  b += text(172, 180, ['guest kernel 6.18.53', '(sched_ext, BTF)', '', 'scx_compact:', 'clang · bpftool · libbpf'], { size: 18, fill: '#000' });
  b += box(22, 470, 300, 265, { fill: PALE, stroke: BLUE });
  b += text(172, 497, 'Analysis (WSL2)', { size: 20, bold: true, fill: NAVY });
  b += text(172, 615, ['results/raw (9p share)', '↓', 'analyze_*.py', '(paired statistics)', '↓', 'results/processed'], { size: 18, fill: '#000' });
  b += box(342, 55, 836, 680, { fill: '#FFFFFF', stroke: NAVY, sw: 2.5, rx: 12 });
  b += text(760, 82, 'KVM guest · Linux 6.18.53 + sched_ext · 8 vCPUs (4 cores × 2 SMT)', { size: 20, bold: true, fill: NAVY });
  b += text(358, 112, 'User space', { size: 17, bold: true, fill: GREY, anchor: 'start' });
  const ub = [[358, 'Loader', ['tunables, CPU order', 'attach / detach', 'CSV telemetry']],
    [632, 'Workloads', ['dutywork', 'latprobe', 'stress-ng']],
    [906, 'Test jobs', ['functional F1–F6', 'benchmarks', 'counter snapshots']]];
  ub.forEach(([x, t, l]) => {
    b += box(x, 125, 256, 140, { fill: GREEN, stroke: GREENB });
    b += text(x + 128, 150, t, { size: 19, bold: true, fill: '#000' });
    b += text(x + 128, 215, l, { size: 18, fill: '#000' });
  });
  b += `<line x1="352" y1="282" x2="1168" y2="282" stroke="#7F7F7F" stroke-width="1.5" stroke-dasharray="6 5"/>`;
  b += text(1162, 300, 'Kernel', { size: 17, bold: true, fill: GREY, anchor: 'end' });
  b += box(358, 312, 804, 50, { fill: LIGHT, stroke: NAVY, label: 'sched_ext core  ·  fallback / baseline: fair class (EEVDF)', size: 19, bold: true });
  b += box(358, 380, 524, 250, { fill: ORANGE, stroke: ORANGEB });
  b += text(620, 406, 'scx_compact BPF policy', { size: 20, bold: true, fill: '#000' });
  b += text(620, 520, ['select_cpu · enqueue · dispatch', 'running · stopping · quiescent', '', 'controller (BPF timer, 20 ms):', 'EWMA demand · hysteresis', 'queue hold · latency guard'], { size: 18, fill: '#000' });
  b += box(898, 380, 264, 118, { fill: PALE, stroke: BLUE });
  b += text(1030, 405, 'BPF maps', { size: 19, bold: true, fill: NAVY });
  b += text(1030, 455, ['busy time, wait stamps,', 'set size, counters'], { size: 17, fill: '#000' });
  b += box(898, 512, 264, 118, { fill: PALE, stroke: BLUE });
  b += text(1030, 537, 'Kernel accounting', { size: 19, bold: true, fill: NAVY });
  b += text(1030, 587, ['/proc/stat, /proc/schedstat,', '/proc/interrupts'], { size: 17, fill: '#000' });
  b += box(358, 648, 804, 72, { fill: '#FFFFFF', stroke: '#7F7F7F' });
  b += text(760, 684, ['CPU0 CPU1 │ CPU2 CPU3 │ CPU4 CPU5 │ CPU6 CPU7', 'active set = first nr_active CPUs of the order; the rest stay idle'], { size: 18, fill: '#000' });
  b += arrow(322, 160, 339, 160);
  b += arrow(385, 265, 385, 377, { label: 'attach, tunables', lpos: [398, 296], lsize: 16, lanchor: 'start' });
  b += arrow(1162, 195, 1164, 571, { via: [[1172, 195], [1172, 571]], dash: true });
  b += arrow(340, 600, 325, 600);
  save('fig1_architecture', svg(1200, 760, b));
}

// ---------------- Figure 2: task placement path ----------------
{
  let b = '';
  const cx = 230;
  b += box(cx - 140, 10, 280, 46, { fill: GREEN, stroke: GREENB, label: 'Task becomes runnable', size: 19, bold: true, tfill: '#000' });
  b += arrow(cx, 56, cx, 73);
  const q = [[125, ['select_cpu: previous CPU', 'active and idle?'], ['dispatch to that', 'CPU’s local queue']],
    [255, ['an idle CPU inside', 'the active set?'], ['dispatch to that', 'CPU’s local queue']],
    [385, ['affinity excludes', 'every active CPU?'], ['LOCAL_ON an allowed', 'CPU + kick']]];
  q.forEach(([y, d, a], i) => {
    b += diamond(cx, y, 340, 104, d, { size: 18 });
    b += arrow(cx + 170, y, 578, y, { label: 'yes', lpos: [470, y - 14], lsize: 17 });
    b += box(580, y - 36, 320, 72, { fill: LIGHT, stroke: NAVY, label: a, size: 18, tfill: '#000' });
    b += arrow(cx, y + 52, cx, y + 76, { label: 'no', lpos: [cx + 22, y + 64], lsize: 17 });
  });
  b += box(cx - 160, 461, 320, 92, { fill: ORANGE, stroke: ORANGEB });
  b += text(cx, 507, ['insert into shared vtime queue', '(guard: stamp wait start)', 'kick an idle active CPU'], { size: 17, fill: '#000' });
  b += arrow(cx, 553, cx, 578);
  b += box(cx - 160, 580, 320, 70, { fill: LIGHT, stroke: NAVY, label: ['dispatch: only ACTIVE CPUs', 'pull from the shared queue'], size: 17, tfill: '#000' });
  b += box(580, 480, 320, 170, { fill: PALE, stroke: BLUE });
  b += text(740, 565, ['ops.running on that CPU:', 'busy-time start;', 'guard sample — "late" if', 'queued longer than L µs'], { size: 18, fill: '#000' });
  b += arrow(cx + 160, 615, 577, 615);
  b += `<path d="M900,125 L930,125 M900,255 L930,255 M900,385 L930,385 M930,125 L930,540" fill="none" stroke="${GREY}" stroke-width="2" stroke-dasharray="7 5"/>`;
  b += arrow(930, 540, 903, 540, { dash: true });
  b += text(500, 685, 'CPUs outside the active set never pull shared work, so they stay idle.', { size: 17, italic: true, fill: GREY });
  save('fig2_placement', svg(1000, 705, b), true);
}

// ---------------- Figure 3: controller decision per tick ----------------
{
  let b = '';
  const cx = 290, W = 420;
  b += box(cx - 250, 10, 500, 76, { fill: GREEN, stroke: GREENB });
  b += text(cx, 48, ['BPF timer tick every 20 ms:', 'demand EWMA (1/8) · decayed late fraction'], { size: 18, fill: '#000' });
  b += arrow(cx, 86, cx, 98);
  const rows = [
    [150, ['demand > 80 % of', 'active capacity?'], ['grow to smallest set', 'with demand ≤ 80 %'], LIGHT, NAVY],
    [270, ['≥ nr_active tasks queued', 'for 2 ticks?'], ['grow by', '1 + queued / 2'], LIGHT, NAVY],
    [390, ['guard on, late > P ‰', 'and no cooldown?'], ['grow by 1;', 'cooldown 8 ticks'], ORANGE, ORANGEB],
    [510, ['fits n−1 CPUs at ≤ 50 %,', 'queue empty, late ≤ P/2 ‰?'], ['after 5 such ticks:', 'shrink by 1'], '#EDEDED', '#7F7F7F'],
  ];
  rows.forEach(([y, qq, a, f, st], i) => {
    b += diamond(cx, y, W, 104, qq, { size: 18 });
    b += arrow(cx + W / 2, y, 588, y, { label: 'yes', lpos: [548, y - 14], lsize: 17 });
    b += box(590, y - 36, 250, 72, { fill: f, stroke: st, label: a, size: 18, tfill: '#000' });
    b += arrow(840, y, 877, y);
    b += arrow(cx, y + 52, cx, y + 66, { label: 'no', lpos: [cx + 22, y + 60], lsize: 17 });
  });
  b += box(cx - 130, 578, 260, 48, { fill: '#EDEDED', stroke: '#7F7F7F', label: 'keep size', size: 18, tfill: '#000' });
  b += arrow(cx + 130, 602, 877, 602);
  b += `<line x1="880" y1="150" x2="880" y2="602" stroke="${GREY}" stroke-width="2"/>`;
  b += box(905, 320, 180, 110, { fill: GREEN, stroke: GREENB });
  b += text(995, 375, ['apply size;', 'kick new CPUs;', 're-arm timer'], { size: 18, fill: '#000' });
  b += arrow(880, 375, 902, 375);
  save('fig3_controller', svg(1100, 640, b), true);
}

// ---------------- Figure 4: evaluation pipeline ----------------
{
  let b = '';
  const steps = [['vm/run_vm.sh:', 'boot KVM guest'], ['10 repetitions,', 'rotated order'], ['condition: EEVDF,', '-n, compact, guard'],
    ['loads 20–99 %:', 'dutywork +', 'latprobe (5 s)'], ['raw data +', 'counter snapshots'], ['analyze_repeated.py:', 'paired 95 % CI']];
  const w = 178, g = 20;
  steps.forEach((st, i) => {
    const x = 6 + i * (w + g);
    b += box(x, 10, w, 104, { fill: i === 5 ? GREEN : (i === 4 ? PALE : LIGHT), stroke: i === 5 ? GREENB : NAVY });
    b += text(x + w / 2, 62, st, { size: 17, fill: '#000' });
    if (i < steps.length - 1) b += arrow(x + w, 62, x + w + g - 1, 62);
  });
  save('fig4_pipeline', svg(1200, 124, b));
}

// ---------------- Figure 5: results chart from the processed n=10 report ----------------
{
  const md = fs.readFileSync(path.join(ROOT, 'results/processed/bench_repeated_20260924T111310Z.md'), 'utf8');
  const data = {};
  for (const m of md.matchAll(/## Duty (\d+) %\n\n\| metric \| (.*?) \|\n\|.*?\n([\s\S]*?)\n\n/g)) {
    const conds = m[2].split(' | ').map((c) => c.split(' (')[0]);
    const rows = {};
    for (const line of m[3].split('\n')) {
      const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      rows[cells[0]] = Object.fromEntries(conds.map((c, i) => {
        const mm = cells[i + 1].match(/^([-\d.]+) ± ([-\d.]+)/);
        return [c, { mean: +mm[1], ci: +mm[2] }];
      }));
    }
    data[+m[1]] = rows;
  }
  fs.writeFileSync(path.join(OUT, 'fig5_values.json'), JSON.stringify(data, null, 1));
  const duties = [20, 40, 60, 99];
  const conds = [['eevdf', 'EEVDF', '#7F7F7F'], ['nocompact', 'Compaction off (-n)', '#BDD7EE'], ['compact', 'Compact', '#2E75B6'], ['guard', 'Compact + guard', '#C55A11']];
  const AX = '#262626';
  // One panel: y axis with ticks and rotated title, x baseline, grouped bars with capped
  // 95 % CI whiskers. ymax is chosen so that no whisker is clipped.
  function panel(ox, tag, ytitle, metric, scale, ymax, ticks) {
    let s = '';
    const top = 62, H = 262, x0 = ox + 78, PW = 480, y0 = top + H;
    const Y = (v) => y0 - (v / ymax) * H;
    s += text(x0, top - 22, tag, { size: 18, bold: true, anchor: 'start', fill: AX });
    ticks.forEach((t) => {
      s += `<line x1="${x0}" y1="${Y(t)}" x2="${x0 + PW}" y2="${Y(t)}" stroke="#E6E6E6" stroke-width="1"/>`;
      s += `<line x1="${x0 - 6}" y1="${Y(t)}" x2="${x0}" y2="${Y(t)}" stroke="${AX}" stroke-width="1.4"/>`;
      s += text(x0 - 10, Y(t), String(t), { size: 16, anchor: 'end', fill: AX });
    });
    s += `<line x1="${x0}" y1="${top}" x2="${x0}" y2="${y0}" stroke="${AX}" stroke-width="1.6"/>`;
    s += `<line x1="${x0}" y1="${y0}" x2="${x0 + PW}" y2="${y0}" stroke="${AX}" stroke-width="1.6"/>`;
    s += `<text x="0" y="0" transform="translate(${ox + 22},${top + H / 2}) rotate(-90)" font-family="${FONT}" font-size="17" fill="${AX}" text-anchor="middle" dominant-baseline="middle">${esc(ytitle)}</text>`;
    const gw = PW / duties.length, bw = 22, gap = 2;
    duties.forEach((d, i) => {
      const gx = x0 + i * gw + gw / 2;
      conds.forEach(([k, , col], j) => {
        const v = data[d][metric][k];
        const mean = v.mean * scale, ci = v.ci * scale;
        const bx = gx - 2 * (bw + gap) + j * (bw + gap) + gap / 2;
        s += `<rect x="${bx}" y="${Y(mean)}" width="${bw}" height="${y0 - Y(mean)}" fill="${col}" stroke="${AX}" stroke-width="0.8"/>`;
        const cx = bx + bw / 2, hi = Y(mean + ci), lo = Y(Math.max(mean - ci, 0));
        s += `<line x1="${cx}" y1="${hi}" x2="${cx}" y2="${lo}" stroke="#000" stroke-width="1.3"/>`;
        s += `<line x1="${cx - 5}" y1="${hi}" x2="${cx + 5}" y2="${hi}" stroke="#000" stroke-width="1.3"/>`;
        s += `<line x1="${cx - 5}" y1="${lo}" x2="${cx + 5}" y2="${lo}" stroke="#000" stroke-width="1.3"/>`;
      });
      s += `<line x1="${gx}" y1="${y0}" x2="${gx}" y2="${y0 + 5}" stroke="${AX}" stroke-width="1.4"/>`;
      s += text(gx, y0 + 20, `${d} % load`, { size: 16, fill: AX });
    });
    return s;
  }
  let b = '';
  b += panel(0, '(a) CPUs used', 'CPUs used (≥ 10 % busy)', 'CPUs used (≥10 % busy)', 1, 8.5, [0, 2, 4, 6, 8]);
  b += panel(600, '(b) Latency-probe p99', 'Probe p99 latency (ms)', 'probe p99 µs', 0.001, 4.5, [0, 1, 2, 3, 4]);
  // even legend spacing: item width = swatch + gap + label (about 7.9 units per character at 16 px)
  const iw = conds.map(([, lab]) => 16 + 7 + lab.length * 7.9), sp = 40;
  const lx = []; let cxl = 600 - (iw.reduce((q, w) => q + w, 0) + sp * (iw.length - 1)) / 2;
  iw.forEach((w) => { lx.push(cxl); cxl += w + sp; });
  conds.forEach(([, lab, col], j) => {
    b += `<rect x="${lx[j]}" y="10" width="16" height="16" fill="${col}" stroke="${AX}" stroke-width="0.8"/>`;
    b += text(lx[j] + 23, 18, lab, { size: 16, anchor: 'start', fill: AX });
  });
  b += text(600, 382, 'Bar height = mean of 10 runs; error bars = 95 % confidence interval of the mean.', { size: 15, italic: true, fill: '#595959' });
  save('fig5_results', svg(1170, 398, b));
}
