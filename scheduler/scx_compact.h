/* SPDX-License-Identifier: GPL-2.0 */
/*
 * scx_compact: definitions shared between the BPF policy and the userspace loader.
 */
#ifndef __SCX_COMPACT_H
#define __SCX_COMPACT_H

#define CC_MAX_CPUS	256	/* power of two; bounds all per-CPU arrays */

/* Per-CPU accounting, one element per CPU in the cpu_stats array map. */
struct cc_cpu {
	__u64	busy_ns;	/* cumulative time spent running sched_ext tasks */
	__u64	run_start;	/* timestamp the current task started running (0 = idle) */
	__u64	busy_prev;	/* busy_ns at the previous controller tick */
	__u64	nr_started;	/* number of times a task started running on this CPU */
};

/* Global controller state and counters, exported through .bss. */
struct cc_global {
	__u64	nr_active;	/* current size of the active CPU set */
	__u64	util_pct;	/* demand at last tick, in % of the active set's capacity */
	__u64	demand_pct;	/* smoothed demand (EWMA), in % of one CPU */
	__u64	queued;		/* tasks waiting in the shared DSQ at last tick */
	__u64	nr_ticks;	/* controller ticks executed */
	__u64	nr_expand;	/* ticks that grew the active set */
	__u64	nr_shrink;	/* ticks that shrank the active set */
	__u64	nr_local;	/* wakeups placed directly on an idle active CPU */
	__u64	nr_shared;	/* tasks queued to the shared DSQ */
	__u64	nr_pinned;	/* tasks that could not run on the active set (sent LOCAL_ON) */
	__u64	nr_waits;	/* dispatches of unrestricted tasks (guard samples) */
	__u64	nr_late;	/* ... that waited in the shared queue longer than lat_ns */
	__u64	late_pm;	/* decayed late fraction, per mille (latency guard input) */
	__u64	nr_lat_expand;	/* ticks where the latency guard grew the set */
};

#endif /* __SCX_COMPACT_H */
