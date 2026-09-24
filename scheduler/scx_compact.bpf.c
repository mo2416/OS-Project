/* SPDX-License-Identifier: GPL-2.0 */
/*
 * scx_compact: a load-adaptive core-compaction scheduler for sched_ext.
 *
 * Tasks are only placed on an *active CPU set*: the first nr_active CPUs of a
 * preference order (cpu_order[], built by userspace from the CPU topology).
 * CPUs outside the set never pull work from the shared queue, so they stay
 * idle and can enter deep idle states.
 *
 * A periodic BPF timer (the "controller") resizes the set. Demand is the busy
 * time of the last interval summed over all CPUs, smoothed with an EWMA of
 * weight 1/2^ewma_shift (bursty loads would otherwise inflate the set on
 * single 20 ms samples):
 *
 *   expand  if smoothed demand > expand_pct % of the active set's capacity
 *           (grow to the size that brings it back under expand_pct), or if
 *           at least nr_active tasks have been waiting in the shared queue for
 *           queue_hold consecutive ticks; step = 1 + queued / 2
 *
 *   shrink  by one CPU if the smoothed demand would fit in nr_active - 1 CPUs
 *           at <= shrink_pct % utilization with an empty queue, for
 *           shrink_hold consecutive ticks  (hysteresis: slow to release)
 *
 * Scheduling order inside the set is weighted vtime (as in scx_simple).
 * Tasks whose affinity excludes every active CPU (e.g. per-CPU kthreads) are
 * dispatched directly to a CPU they may run on, so compaction never starves
 * them.
 *
 * With compact_enabled = false the same code runs with every CPU active and
 * the default idle-CPU selection. This is the control condition used to
 * separate the effect of the policy from the effect of sched_ext itself.
 *
 * Built on the structure of tools/sched_ext/scx_simple.bpf.c (Linux 6.18).
 */
#include <scx/common.bpf.h>
#include "scx_compact.h"

char _license[] SEC("license") = "GPL";

#define SHARED_DSQ	0
#define CPU_MASK	(CC_MAX_CPUS - 1)

/* Tunables, filled in by userspace before the program is loaded. */
const volatile u32 nr_cpus = 1;
const volatile u32 cpu_order[CC_MAX_CPUS];	/* preference order */
const volatile u32 cpu_rank[CC_MAX_CPUS];	/* inverse of cpu_order */
const volatile u32 min_active = 1;
const volatile u32 max_active = 1;
const volatile bool compact_enabled = true;
const volatile u64 interval_ns = 20ULL * 1000 * 1000;
const volatile u32 expand_pct = 80;
const volatile u32 shrink_pct = 50;
const volatile u32 shrink_hold = 5;
const volatile u32 ewma_shift = 3;		/* 0 = no smoothing */
const volatile u32 queue_hold = 2;		/* ticks of sustained queueing */
const volatile u64 slice_ns = 5ULL * 1000 * 1000;

/* Controller state; stats.nr_active is the authoritative active-set size. */
struct cc_global stats;
static u64 vtime_now;
static u64 last_tick_ns;
static u32 low_streak;
static u32 queue_streak;
static u64 demand;		/* smoothed demand, in CPUs x DEMAND_ONE */

#define DEMAND_ONE	1024

UEI_DEFINE(uei);

struct {
	__uint(type, BPF_MAP_TYPE_ARRAY);
	__uint(max_entries, CC_MAX_CPUS);
	__type(key, u32);
	__type(value, struct cc_cpu);
} cpu_stats SEC(".maps");

struct ctl_timer {
	struct bpf_timer timer;
};

struct {
	__uint(type, BPF_MAP_TYPE_ARRAY);
	__uint(max_entries, 1);
	__type(key, u32);
	__type(value, struct ctl_timer);
} ctl_timer SEC(".maps");

static __always_inline struct cc_cpu *cpu_ctx(s32 cpu)
{
	u32 key = cpu;

	return bpf_map_lookup_elem(&cpu_stats, &key);
}

static __always_inline bool cpu_is_active(s32 cpu)
{
	if (!compact_enabled)
		return true;
	if (cpu < 0 || cpu >= CC_MAX_CPUS)
		return false;
	return cpu_rank[cpu & CPU_MASK] < stats.nr_active;
}

/* Can @p run on at least one CPU of the active set? */
static bool task_fits_active(struct task_struct *p)
{
	u32 i, n = stats.nr_active;

	if (!compact_enabled || p->nr_cpus_allowed >= nr_cpus)
		return true;
	bpf_for(i, 0, n) {
		if (i >= CC_MAX_CPUS)
			break;
		if (bpf_cpumask_test_cpu(cpu_order[i], p->cpus_ptr))
			return true;
	}
	return false;
}

/* Claim an idle CPU of the active set that @p may run on, or return -1. */
static s32 claim_idle_active(struct task_struct *p, s32 prev_cpu)
{
	u32 i, n = stats.nr_active;

	/* Prefer the previous CPU for cache affinity. */
	if (cpu_is_active(prev_cpu) &&
	    bpf_cpumask_test_cpu(prev_cpu, p->cpus_ptr) &&
	    scx_bpf_test_and_clear_cpu_idle(prev_cpu))
		return prev_cpu;

	bpf_for(i, 0, n) {
		s32 cpu;

		if (i >= CC_MAX_CPUS)
			break;
		cpu = cpu_order[i];
		if (bpf_cpumask_test_cpu(cpu, p->cpus_ptr) &&
		    scx_bpf_test_and_clear_cpu_idle(cpu))
			return cpu;
	}
	return -1;
}

s32 BPF_STRUCT_OPS(compact_select_cpu, struct task_struct *p, s32 prev_cpu,
		   u64 wake_flags)
{
	bool is_idle = false;
	s32 cpu;

	if (!compact_enabled) {
		cpu = scx_bpf_select_cpu_dfl(p, prev_cpu, wake_flags, &is_idle);
		if (is_idle) {
			__sync_fetch_and_add(&stats.nr_local, 1);
			scx_bpf_dsq_insert(p, SCX_DSQ_LOCAL, slice_ns, 0);
		}
		return cpu;
	}

	cpu = claim_idle_active(p, prev_cpu);
	if (cpu >= 0) {
		__sync_fetch_and_add(&stats.nr_local, 1);
		scx_bpf_dsq_insert(p, SCX_DSQ_LOCAL, slice_ns, 0);
		return cpu;
	}
	/* No idle active CPU: ops.enqueue() will queue the task. */
	return prev_cpu;
}

void BPF_STRUCT_OPS(compact_enqueue, struct task_struct *p, u64 enq_flags)
{
	u64 vtime = p->scx.dsq_vtime;
	s32 cpu;

	if (!task_fits_active(p)) {
		/* Affinity excludes the whole active set: run it where it may run. */
		cpu = scx_bpf_task_cpu(p);
		if (!bpf_cpumask_test_cpu(cpu, p->cpus_ptr))
			cpu = scx_bpf_pick_any_cpu(p->cpus_ptr, 0);
		if (cpu >= 0) {
			__sync_fetch_and_add(&stats.nr_pinned, 1);
			scx_bpf_dsq_insert(p, SCX_DSQ_LOCAL_ON | cpu, slice_ns, enq_flags);
			scx_bpf_kick_cpu(cpu, SCX_KICK_IDLE);
			return;
		}
	}

	/* Limit the budget an idling task can accumulate to one slice. */
	if (time_before(vtime, vtime_now - slice_ns))
		vtime = vtime_now - slice_ns;

	__sync_fetch_and_add(&stats.nr_shared, 1);
	scx_bpf_dsq_insert_vtime(p, SHARED_DSQ, slice_ns, vtime, enq_flags);

	/* Wake an idle CPU that is allowed to pull from the shared queue. */
	if (compact_enabled)
		cpu = claim_idle_active(p, scx_bpf_task_cpu(p));
	else
		cpu = scx_bpf_pick_idle_cpu(p->cpus_ptr, 0);
	if (cpu >= 0)
		scx_bpf_kick_cpu(cpu, SCX_KICK_IDLE);
}

void BPF_STRUCT_OPS(compact_dispatch, s32 cpu, struct task_struct *prev)
{
	/* Inactive CPUs do not pull shared work, so they go (and stay) idle. */
	if (cpu_is_active(cpu))
		scx_bpf_dsq_move_to_local(SHARED_DSQ);
}

void BPF_STRUCT_OPS(compact_running, struct task_struct *p)
{
	struct cc_cpu *c = cpu_ctx(scx_bpf_task_cpu(p));

	if (c) {
		c->run_start = bpf_ktime_get_ns();
		c->nr_started++;
	}
	/* Global vtime progresses as tasks start (racy, as in scx_simple). */
	if (time_before(vtime_now, p->scx.dsq_vtime))
		vtime_now = p->scx.dsq_vtime;
}

void BPF_STRUCT_OPS(compact_stopping, struct task_struct *p, bool runnable)
{
	struct cc_cpu *c = cpu_ctx(scx_bpf_task_cpu(p));
	u64 now = bpf_ktime_get_ns();

	if (c && c->run_start) {
		if (now > c->run_start)
			c->busy_ns += now - c->run_start;
		c->run_start = 0;
	}
	/* Charge the used part of the slice, scaled by the inverse weight. */
	/*
	 * Linux 6.18 has no scx_bpf_task_set_dsq_vtime() kfunc (the 6.18.53 in-tree
	 * examples call it, but it arrived later); on 6.18 struct_ops programs may
	 * write p->scx.dsq_vtime directly (bpf_scx_btf_struct_access()).
	 */
	p->scx.dsq_vtime += scale_by_task_weight_inverse(p, slice_ns - p->scx.slice);
}

void BPF_STRUCT_OPS(compact_enable, struct task_struct *p)
{
	p->scx.dsq_vtime = vtime_now;
}

/*
 * Controller: measure the demand of the last interval (busy time summed over
 * all CPUs, including still-running tasks) and resize the active set.
 */
static int ctl_timerfn(void *map, int *key, struct bpf_timer *timer)
{
	u64 now = bpf_ktime_get_ns(), busy = 0, elapsed, cap, queued, inst, need;
	u32 cpu, n = stats.nr_active, old_n = n, step;

	bpf_for(cpu, 0, nr_cpus) {
		struct cc_cpu *c = cpu_ctx(cpu);
		u64 start;

		if (!c)
			continue;
		start = c->run_start;
		if (start && now > start) {
			/* Close the in-flight run so it counts in this interval. */
			c->busy_ns += now - start;
			c->run_start = now;
		}
		busy += c->busy_ns - c->busy_prev;
		c->busy_prev = c->busy_ns;
	}

	elapsed = now - last_tick_ns;
	last_tick_ns = now;
	queued = scx_bpf_dsq_nr_queued(SHARED_DSQ);
	cap = elapsed * (n ? n : 1);

	stats.nr_ticks++;
	stats.queued = queued;
	stats.util_pct = cap ? busy * 100 / cap : 0;

	if (!elapsed)
		goto out;
	inst = busy * DEMAND_ONE / elapsed;
	if (ewma_shift && ewma_shift < 16)
		demand = (demand * ((1U << ewma_shift) - 1) + inst) >> ewma_shift;
	else
		demand = inst;
	stats.demand_pct = demand * 100 / DEMAND_ONE;
	queue_streak = queued >= n ? queue_streak + 1 : 0;

	if (compact_enabled) {
		if (demand * 100 > (u64)expand_pct * DEMAND_ONE * n) {
			/* Smallest set that keeps demand under expand_pct. */
			need = demand * 100 / ((u64)expand_pct * DEMAND_ONE) + 1;
			n = need > max_active ? max_active : need;
			low_streak = 0;
		} else if (queue_streak >= queue_hold) {
			step = 1 + queued / 2;
			n = n + step > max_active ? max_active : n + step;
			queue_streak = 0;
			low_streak = 0;
		} else if (n > min_active && queued == 0 &&
			   demand * 100 <= (u64)shrink_pct * DEMAND_ONE * (n - 1)) {
			if (++low_streak >= shrink_hold) {
				n--;
				low_streak = 0;
			}
		} else {
			low_streak = 0;
		}

		if (n > old_n) {
			u32 i;

			stats.nr_expand++;
			stats.nr_active = n;
			/* Newly active CPUs are idle: kick them to pull queued work. */
			bpf_for(i, old_n, n) {
				if (i >= CC_MAX_CPUS)
					break;
				scx_bpf_kick_cpu(cpu_order[i], SCX_KICK_IDLE);
			}
		} else if (n < old_n) {
			stats.nr_shrink++;
			stats.nr_active = n;
		}
	}
out:
	bpf_timer_start(timer, interval_ns, 0);
	return 0;
}

s32 BPF_STRUCT_OPS_SLEEPABLE(compact_init)
{
	struct bpf_timer *timer;
	u32 key = 0;
	s32 ret;

	stats.nr_active = compact_enabled ? min_active : nr_cpus;
	last_tick_ns = bpf_ktime_get_ns();

	ret = scx_bpf_create_dsq(SHARED_DSQ, -1);
	if (ret)
		return ret;

	timer = bpf_map_lookup_elem(&ctl_timer, &key);
	if (!timer)
		return -ESRCH;
	bpf_timer_init(timer, &ctl_timer, CLOCK_MONOTONIC);
	bpf_timer_set_callback(timer, ctl_timerfn);
	return bpf_timer_start(timer, interval_ns, 0);
}

void BPF_STRUCT_OPS(compact_exit, struct scx_exit_info *ei)
{
	UEI_RECORD(uei, ei);
}

SCX_OPS_DEFINE(compact_ops,
	       .select_cpu		= (void *)compact_select_cpu,
	       .enqueue			= (void *)compact_enqueue,
	       .dispatch		= (void *)compact_dispatch,
	       .running			= (void *)compact_running,
	       .stopping		= (void *)compact_stopping,
	       .enable			= (void *)compact_enable,
	       .init			= (void *)compact_init,
	       .exit			= (void *)compact_exit,
	       .name			= "compact");
