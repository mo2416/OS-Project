# Likely Faculty Questions (based on the current implementation and results)

Answers cite repository evidence. Numbers are from
`results/processed/bench_repeated_20260924T111310Z.md` unless stated otherwise.

**1. Is core compaction your invention?**
No. Windows core parking and scx_lavd already compact cores (`docs/RESEARCH_DECISION.md` §2–3).
Our contribution is a minimal, observable sched_ext implementation with an explicit
controller, a control condition (`-n`), a latency guard, and a measured trade-off.

**2. Where is the "energy" in energy-aware if you did not measure energy?**
The mechanism targets energy: it keeps CPUs fully idle so they can reach deep C-states. We
**measured** the precondition (5.0 of 8 CPUs parked at 20 % load vs 1.3 with EEVDF), but not
energy itself: WSL2/QEMU exposes no RAPL. The 0.72 figure is a **model proxy** with assumed
coefficients. Measuring energy on bare metal is the first item of the remaining work.

**3. How does the scheduler decide how many CPUs to use?**
A BPF timer every 20 ms computes busy time over all CPUs, smooths it (EWMA 1/8), and grows the
set when demand exceeds 80 % of its capacity or when tasks keep queueing. It shrinks by one
CPU only after demand fits in n−1 CPUs at ≤ 50 % for 5 consecutive ticks (`ctl_timerfn` in
`scheduler/scx_compact.bpf.c`).

**4. Why did plain compaction have bad tail latency?**
With 3.1 CPUs of bursty demand, the sizing rule chose 4 CPUs (utilization ~0.78). Bursts then
queue behind 5 ms slices. Utilization cannot see burstiness (`docs/NEXT_PHASE_DECISION.md` §1).

**5. What exactly does the latency guard measure, and why not just all run-queue waits?**
It measures the time a task (with unrestricted affinity) spends in the shared queue because
no active CPU was idle, counted over all such dispatches. Our diagnostics
(`results/raw/vm/guard_diag_*.log`) showed that "all waits" mostly measured halted-vCPU
wake-ups and per-CPU kthreads. More CPUs cannot fix those, so the guard would have
expanded to all CPUs uselessly.

**6. Isn't the guard just tuned to your benchmark?**
Its rule is generic: a 1 ms / 1 % queueing-delay target, like a latency objective, with no
workload knowledge. The values are configurable (`-L`, `-P`) and were not tuned. We report
where it helps (20/40 %) and where it removes compaction (60 %: −0.1 CPUs, not significant).

**7. Does compaction slow programs down?**
Completion time of the fixed work showed no significant paired difference at 40/60/99 %. At
20 % there is a small +1.6 % [0.1 %, 3.9 %] for compact, and none for guard.

**8. Why is latency bad at full load even with compaction off?**
All sched_ext conditions have about 2.3 ms higher probe p99 at ~100 % load. The base policy
has no wakeup preemption: a woken task waits for a running task's 5 ms slice to end, while
EEVDF preempts. It is a limitation of our base policy, measured via the `-n` control.

**9. How do you know the results are not noise?**
10 reps per cell. Conditions are interleaved and rotated within each rep, and comparisons are
paired per rep with bootstrap 95 % CIs; only CIs excluding 0 are called differences. Pairing
matters: host drift moved the mean slowdown between 0.95 and 1.34 across reps.

**10. Why a VM? Are the results valid for real hardware?**
The WSL2 kernel has no sched_ext, so the guest kernel runs under KVM. Scheduling behaviour
(placement, queueing, latency) is real kernel behaviour. Power behaviour and SMT effects are
not representative: an idle vCPU is not a parked core. That is why energy and SMT studies are
planned on bare metal.

**11. How do you guarantee compaction never starves a task?**
If a task's affinity excludes every active CPU (e.g. a per-CPU kthread), `ops.enqueue` sends
it directly to an allowed CPU (`SCX_DSQ_LOCAL_ON`) and kicks that CPU. Functional check F5: a
task pinned to CPU 7 ran at 100 % while the set was 2 CPUs. sched_ext's watchdog would also
unload a stalling scheduler; F6 shows no such events.

**12. What happens if your BPF scheduler crashes?**
sched_ext unloads it and all tasks fall back to EEVDF (kernel documentation, cited in
`docs/RESEARCH_DECISION.md`). None of our 30 scheduler sessions in the main run exited abnormally.

**13. Why scx_qmap and not scx_simple as the reference scheduler?**
In the 6.18.53 tree, scx_simple calls `scx_bpf_task_set_dsq_vtime()`, which 6.18 does not
export, so it does not build (`docs/PROGRESS_LOG.md` row 14).

**14. Why not compare against scx_lavd?**
It needs a Rust toolchain and a multi-GB build on a C: drive that already filled up twice
during this project. It is planned as an optional reference comparison, without superiority claims.

**15. Which OS concepts does the project exercise?**
Scheduling classes, run queues (dispatch queues), vtime fairness, time slices, CPU affinity,
idle CPU selection, context switches, waiting time vs turnaround time, NO_HZ idle,
kernel accounting (`/proc/stat`, `/proc/schedstat`).

**16. What would you change in the controller if you had more time?**
Evidence-based candidates only: decide whether the guard should be on by default (n = 10 check
of 2–3 settings), and address the full-load wakeup latency of the base policy.
