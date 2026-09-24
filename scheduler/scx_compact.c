/* SPDX-License-Identifier: GPL-2.0 */
/*
 * scx_compact userspace loader: builds the CPU preference order from the
 * topology, configures the BPF policy, attaches it, and samples its state.
 *
 * Every sampling period one line is printed (and optionally appended to a
 * CSV file) with the active-set size, measured demand, queue depth, the
 * controller's expand/shrink counters, and per-CPU busy percentages.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <time.h>
#include <libgen.h>
#include <bpf/bpf.h>
#include <scx/common.h>
#include "scx_compact.h"
#include "scx_compact.bpf.skel.h"

const char help_fmt[] =
"scx_compact: load-adaptive core-compaction scheduler (sched_ext)\n"
"\n"
"Usage: %s [-m MIN] [-M MAX] [-e PCT] [-s PCT] [-H N] [-i MS] [-S US]\n"
"          [-o smt|core|linear] [-n] [-p MS] [-c FILE] [-t SEC] [-v]\n"
"\n"
"  -m MIN    minimum active CPUs (default 2)\n"
"  -M MAX    maximum active CPUs (default: all)\n"
"  -e PCT    expand when demand > PCT%% of active capacity (default 80)\n"
"  -s PCT    shrink when demand fits in n-1 CPUs at <= PCT%% (default 50)\n"
"  -H N      consecutive low ticks required before shrinking (default 5)\n"
"  -i MS     controller interval in ms (default 20)\n"
"  -S US     time slice in us (default 5000)\n"
"  -o ORDER  CPU preference order: smt = fill SMT siblings of a core first\n"
"            (default), core = one thread per physical core first, linear\n"
"  -n        no compaction: all CPUs active (control condition)\n"
"  -p MS     sampling/print period in ms (default 1000)\n"
"  -c FILE   append samples to CSV FILE\n"
"  -t SEC    exit after SEC seconds\n"
"  -v        verbose libbpf output\n";

static bool verbose;
static volatile int exit_req;

static int libbpf_print_fn(enum libbpf_print_level level, const char *format, va_list args)
{
	if (level == LIBBPF_DEBUG && !verbose)
		return 0;
	return vfprintf(stderr, format, args);
}

static void sigint_handler(int sig)
{
	exit_req = 1;
}

static int read_int(const char *fmt, int cpu)
{
	char path[128];
	FILE *f;
	int v = -1;

	snprintf(path, sizeof(path), fmt, cpu);
	f = fopen(path, "r");
	if (!f)
		return -1;
	if (fscanf(f, "%d", &v) != 1)
		v = -1;
	fclose(f);
	return v;
}

/*
 * Build the CPU preference order.
 *  smt:    core0.t0, core0.t1, core1.t0, core1.t1, ...  (pack onto few cores)
 *  core:   core0.t0, core1.t0, ..., core0.t1, core1.t1, ...  (spread over cores)
 *  linear: 0, 1, 2, ...
 */
static void build_order(int nr, const char *mode, __u32 *order)
{
	int core[CC_MAX_CPUS], pkg[CC_MAX_CPUS], thr[CC_MAX_CPUS];
	int i, j, n = 0;

	for (i = 0; i < nr; i++) {
		core[i] = read_int("/sys/devices/system/cpu/cpu%d/topology/core_id", i);
		pkg[i] = read_int("/sys/devices/system/cpu/cpu%d/topology/physical_package_id", i);
		thr[i] = 0;
		for (j = 0; j < i; j++)		/* thread index within its core */
			if (core[j] == core[i] && pkg[j] == pkg[i])
				thr[i]++;
	}

	if (!strcmp(mode, "linear")) {
		for (i = 0; i < nr; i++)
			order[i] = i;
		return;
	}
	if (!strcmp(mode, "core")) {
		for (int t = 0; n < nr && t < nr; t++)
			for (i = 0; i < nr; i++)
				if (thr[i] == t)
					order[n++] = i;
		return;
	}
	/* smt: walk CPUs; when a core is first seen, emit all of its threads */
	for (i = 0; i < nr; i++) {
		if (thr[i] != 0)
			continue;
		for (j = i; j < nr; j++)
			if (core[j] == core[i] && pkg[j] == pkg[i])
				order[n++] = j;
	}
	for (i = 0; i < nr && n < nr; i++) {	/* safety net: unknown topology */
		bool seen = false;

		for (j = 0; j < n; j++)
			seen |= order[j] == (__u32)i;
		if (!seen)
			order[n++] = i;
	}
}

static double now_s(void)
{
	struct timespec ts;

	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec + ts.tv_nsec / 1e9;
}

int main(int argc, char **argv)
{
	struct scx_compact *skel;
	struct bpf_link *link;
	const char *order_mode = "smt", *csv_path = NULL;
	__u64 prev_busy[CC_MAX_CPUS] = {}, ecode;
	int nr_cpus, opt, period_ms = 1000, map_fd, i;
	double t0, t_prev, run_limit = 0;
	FILE *csv = NULL;

	libbpf_set_print(libbpf_print_fn);
	signal(SIGINT, sigint_handler);
	signal(SIGTERM, sigint_handler);

	nr_cpus = libbpf_num_possible_cpus();
	if (nr_cpus <= 0 || nr_cpus > CC_MAX_CPUS) {
		fprintf(stderr, "unsupported CPU count %d\n", nr_cpus);
		return 1;
	}

	skel = SCX_OPS_OPEN(compact_ops, scx_compact);
	skel->rodata->nr_cpus = nr_cpus;
	skel->rodata->min_active = nr_cpus < 2 ? nr_cpus : 2;
	skel->rodata->max_active = nr_cpus;

	while ((opt = getopt(argc, argv, "m:M:e:s:H:i:S:o:np:c:t:vh")) != -1) {
		switch (opt) {
		case 'm': skel->rodata->min_active = atoi(optarg); break;
		case 'M': skel->rodata->max_active = atoi(optarg); break;
		case 'e': skel->rodata->expand_pct = atoi(optarg); break;
		case 's': skel->rodata->shrink_pct = atoi(optarg); break;
		case 'H': skel->rodata->shrink_hold = atoi(optarg); break;
		case 'i': skel->rodata->interval_ns = strtoull(optarg, NULL, 0) * 1000000ULL; break;
		case 'S': skel->rodata->slice_ns = strtoull(optarg, NULL, 0) * 1000ULL; break;
		case 'o': order_mode = optarg; break;
		case 'n': skel->rodata->compact_enabled = false; break;
		case 'p': period_ms = atoi(optarg); break;
		case 'c': csv_path = optarg; break;
		case 't': run_limit = atof(optarg); break;
		case 'v': verbose = true; break;
		default:
			fprintf(stderr, help_fmt, basename(argv[0]));
			return opt != 'h';
		}
	}

	/* Sanitize the configuration. */
	if (skel->rodata->max_active < 1 || skel->rodata->max_active > (__u32)nr_cpus)
		skel->rodata->max_active = nr_cpus;
	if (skel->rodata->min_active < 1)
		skel->rodata->min_active = 1;
	if (skel->rodata->min_active > skel->rodata->max_active)
		skel->rodata->min_active = skel->rodata->max_active;
	if (skel->rodata->shrink_pct >= skel->rodata->expand_pct) {
		fprintf(stderr, "shrink threshold must be below expand threshold\n");
		return 1;
	}

	build_order(nr_cpus, order_mode, (__u32 *)skel->rodata->cpu_order);
	for (i = 0; i < nr_cpus; i++)
		((__u32 *)skel->rodata->cpu_rank)[skel->rodata->cpu_order[i]] = i;

	printf("scx_compact: cpus=%d compact=%d min=%u max=%u expand=%u%% shrink=%u%% "
	       "hold=%u interval=%llums slice=%lluus order=%s:",
	       nr_cpus, skel->rodata->compact_enabled, skel->rodata->min_active,
	       skel->rodata->max_active, skel->rodata->expand_pct,
	       skel->rodata->shrink_pct, skel->rodata->shrink_hold,
	       skel->rodata->interval_ns / 1000000, skel->rodata->slice_ns / 1000,
	       order_mode);
	for (i = 0; i < nr_cpus; i++)
		printf(" %u", skel->rodata->cpu_order[i]);
	printf("\n");

	SCX_OPS_LOAD(skel, compact_ops, scx_compact, uei);
	link = SCX_OPS_ATTACH(skel, compact_ops, scx_compact);
	map_fd = bpf_map__fd(skel->maps.cpu_stats);

	if (csv_path) {
		csv = fopen(csv_path, "a");
		if (!csv) {
			perror("csv");
			exit_req = 1;
		} else {
			fprintf(csv, "t_s,nr_active,util_pct,queued,nr_ticks,nr_expand,nr_shrink,"
				"nr_local,nr_shared,nr_pinned,cpus_busy");
			for (i = 0; i < nr_cpus; i++)
				fprintf(csv, ",cpu%d_pct", i);
			fprintf(csv, "\n");
		}
	}

	t0 = t_prev = now_s();
	while (!exit_req && !UEI_EXITED(skel, uei)) {
		struct cc_global *g = &skel->bss->stats;
		double t, dt, pct[CC_MAX_CPUS];
		int busy_cpus = 0;

		usleep(period_ms * 1000);
		t = now_s();
		dt = t - t_prev;
		t_prev = t;

		for (i = 0; i < nr_cpus; i++) {
			struct cc_cpu c = {};
			__u32 key = i;

			bpf_map_lookup_elem(map_fd, &key, &c);
			pct[i] = dt > 0 ? (c.busy_ns - prev_busy[i]) / (dt * 1e7) : 0;
			prev_busy[i] = c.busy_ns;
			if (pct[i] >= 5.0)
				busy_cpus++;
		}

		printf("t=%6.1fs active=%2llu util=%3llu%% queued=%3llu expand=%llu shrink=%llu "
		       "busy_cpus(>=5%%)=%2d |", t - t0, g->nr_active, g->util_pct, g->queued,
		       g->nr_expand, g->nr_shrink, busy_cpus);
		for (i = 0; i < nr_cpus; i++)
			printf(" %3.0f", pct[i]);
		printf("\n");
		fflush(stdout);

		if (csv) {
			fprintf(csv, "%.3f,%llu,%llu,%llu,%llu,%llu,%llu,%llu,%llu,%llu,%d",
				t - t0, g->nr_active, g->util_pct, g->queued, g->nr_ticks,
				g->nr_expand, g->nr_shrink, g->nr_local, g->nr_shared,
				g->nr_pinned, busy_cpus);
			for (i = 0; i < nr_cpus; i++)
				fprintf(csv, ",%.1f", pct[i]);
			fprintf(csv, "\n");
			fflush(csv);
		}
		if (run_limit > 0 && t - t0 >= run_limit)
			break;
	}

	printf("scx_compact: final ticks=%llu expand=%llu shrink=%llu local=%llu shared=%llu "
	       "pinned=%llu\n", skel->bss->stats.nr_ticks, skel->bss->stats.nr_expand,
	       skel->bss->stats.nr_shrink, skel->bss->stats.nr_local,
	       skel->bss->stats.nr_shared, skel->bss->stats.nr_pinned);
	if (csv)
		fclose(csv);
	bpf_link__destroy(link);
	ecode = UEI_REPORT(skel, uei);
	scx_compact__destroy(skel);
	return ecode ? 1 : 0;
}
