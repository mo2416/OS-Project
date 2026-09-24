// SPDX-License-Identifier: GPL-2.0
/*
 * latprobe: latency-sensitive probe task (cyclictest-style, SCHED_OTHER).
 *
 *   latprobe PERIOD_US DURATION_S
 *
 * Sleeps PERIOD_US (relative clock_nanosleep) in a loop for DURATION_S and
 * records each wakeup's lateness (actual sleep - requested sleep). It does
 * almost no work, so its lateness is the scheduling delay that an interactive
 * task sees while the background load runs. It runs under the normal policy
 * (SCHED_OTHER), so under sched_ext it is scheduled by the BPF scheduler.
 *
 * Output, one key=value line: n, p50/p95/p99/max lateness in microseconds.
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <time.h>

static uint64_t now_ns(void)
{
	struct timespec ts;

	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec * 1000000000ULL + ts.tv_nsec;
}

static int cmp_u64(const void *a, const void *b)
{
	uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b;

	return x < y ? -1 : x > y;
}

int main(int argc, char **argv)
{
	uint64_t period_ns, end, *lat, t0, t1;
	size_t n = 0, cap;
	struct timespec ts;

	if (argc != 3) {
		fprintf(stderr, "usage: %s PERIOD_US DURATION_S\n", argv[0]);
		return 1;
	}
	period_ns = strtoull(argv[1], NULL, 0) * 1000ULL;
	if (!period_ns)
		return 1;
	cap = (size_t)(atof(argv[2]) * 1e9 / period_ns) + 16;
	lat = calloc(cap, sizeof(*lat));
	ts.tv_sec = period_ns / 1000000000ULL;
	ts.tv_nsec = period_ns % 1000000000ULL;
	end = now_ns() + (uint64_t)(atof(argv[2]) * 1e9);
	while (n < cap && (t0 = now_ns()) < end) {
		clock_nanosleep(CLOCK_MONOTONIC, 0, &ts, NULL);
		t1 = now_ns();
		lat[n++] = t1 - t0 > period_ns ? t1 - t0 - period_ns : 0;
	}
	qsort(lat, n, sizeof(*lat), cmp_u64);
	printf("probe_n=%zu probe_p50_us=%.1f probe_p95_us=%.1f probe_p99_us=%.1f probe_max_us=%.1f\n",
	       n, lat[n / 2] / 1e3, lat[(size_t)(0.95 * (n - 1))] / 1e3,
	       lat[(size_t)(0.99 * (n - 1))] / 1e3, lat[n - 1] / 1e3);
	return 0;
}
