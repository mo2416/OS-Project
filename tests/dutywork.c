// SPDX-License-Identifier: GPL-2.0
/*
 * dutywork: fixed-work, duty-cycled CPU load for the partial-load benchmark.
 *
 *   dutywork WORKERS DUTY_PCT PERIOD_MS ITERS
 *
 * Each worker runs ITERS iterations of: a fixed amount of CPU work (calibrated
 * once, single-threaded, to take DUTY_PCT % of PERIOD_MS on an idle CPU), then
 * a relative sleep for the rest of the period. Workers start with evenly
 * spread phase offsets, like independent periodic tasks.
 *
 * Because the work is fixed and the sleep is relative, any time a worker spends
 * waiting for a CPU extends its completion time. The ideal completion time is
 * ITERS * PERIOD_MS.
 *
 * DUTYWORK_LOOPS_PER_MS=<n> in the environment skips calibration, so every run
 * of a benchmark does the same work; `dutywork -c` prints the calibrated value.
 *
 * Output, one key=value line:
 *   wall_s     time until the last worker finished
 *   ideal_s    ITERS * PERIOD_MS
 *   slowdown   wall_s / ideal_s
 *   work_ms    calibrated CPU time per iteration
 *   run_p50_ms/run_p99_ms  per-iteration duration of the work phase
 *              (= work_ms + time spent preempted / waiting for a CPU)
 *   wake_p50_us/wake_p99_us/wake_max_us  wakeup lateness: actual sleep minus
 *              the requested sleep
 */
#define _GNU_SOURCE
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <time.h>

static int workers, duty, period_ms, iters;
static uint64_t loops_per_iter, sleep_ns;
static uint64_t *run_ns, *wake_ns;	/* [worker * iters + i] */
static volatile uint64_t sink;

static uint64_t now_ns(void)
{
	struct timespec ts;

	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec * 1000000000ULL + ts.tv_nsec;
}

static void burn(uint64_t loops)
{
	uint64_t x = sink;

	for (uint64_t i = 0; i < loops; i++)
		x = x * 6364136223846793005ULL + 1442695040888963407ULL;
	sink = x;
}

static void sleep_rel(uint64_t ns)
{
	struct timespec ts = { ns / 1000000000ULL, ns % 1000000000ULL };

	clock_nanosleep(CLOCK_MONOTONIC, 0, &ts, NULL);
}

static void *worker(void *arg)
{
	long w = (long)arg;
	uint64_t *run = run_ns + w * iters, *wake = wake_ns + w * iters;

	sleep_rel((uint64_t)period_ms * 1000000ULL * w / workers);	/* phase offset */
	for (int i = 0; i < iters; i++) {
		uint64_t t0 = now_ns(), t1, t2;

		burn(loops_per_iter);
		t1 = now_ns();
		sleep_rel(sleep_ns);
		t2 = now_ns();
		run[i] = t1 - t0;
		wake[i] = t2 - t1 > sleep_ns ? t2 - t1 - sleep_ns : 0;
	}
	return NULL;
}

static int cmp_u64(const void *a, const void *b)
{
	uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b;

	return x < y ? -1 : x > y;
}

static double pct(uint64_t *v, size_t n, double p)
{
	return v[(size_t)(p * (n - 1))];
}

int main(int argc, char **argv)
{
	uint64_t work_ns, t0, t, cal = 1000000;
	pthread_t tid[256];
	const char *lpm;
	size_t n;

	static char *cal_argv[] = { "dutywork", "1", "50", "100", "1", NULL };

	if (argc == 2 && argv[1][0] == '-' && argv[1][1] == 'c') {
		argc = 5; argv = cal_argv;
		setenv("DUTYWORK_CALIBRATE_ONLY", "1", 1);
	}
	if (argc != 5) {
		fprintf(stderr, "usage: %s WORKERS DUTY_PCT PERIOD_MS ITERS\n", argv[0]);
		return 1;
	}
	workers = atoi(argv[1]); duty = atoi(argv[2]);
	period_ms = atoi(argv[3]); iters = atoi(argv[4]);
	if (workers < 1 || workers > 256 || duty < 1 || duty > 99 || period_ms < 1 || iters < 1)
		return 1;
	work_ns = (uint64_t)period_ms * 1000000ULL * duty / 100;
	sleep_ns = (uint64_t)period_ms * 1000000ULL - work_ns;

	lpm = getenv("DUTYWORK_LOOPS_PER_MS");
	if (lpm) {
		loops_per_iter = strtoull(lpm, NULL, 0) * work_ns / 1000000ULL;
	} else {
		/* Grow the loop count until one burn takes >= 50 ms, then scale. */
		for (;;) {
			t0 = now_ns();
			burn(cal);
			t = now_ns() - t0;
			if (t >= 50000000ULL)
				break;
			cal *= 2;
		}
		loops_per_iter = (uint64_t)((double)cal * work_ns / t);
		if (getenv("DUTYWORK_CALIBRATE_ONLY")) {
			printf("%llu\n", (unsigned long long)((double)cal * 1e6 / t));
			return 0;
		}
	}

	n = (size_t)workers * iters;
	run_ns = calloc(n, sizeof(*run_ns));
	wake_ns = calloc(n, sizeof(*wake_ns));
	t0 = now_ns();
	for (long w = 0; w < workers; w++)
		pthread_create(&tid[w], NULL, worker, (void *)w);
	for (int w = 0; w < workers; w++)
		pthread_join(tid[w], NULL);
	t = now_ns() - t0;

	qsort(run_ns, n, sizeof(*run_ns), cmp_u64);
	qsort(wake_ns, n, sizeof(*wake_ns), cmp_u64);
	printf("wall_s=%.3f ideal_s=%.3f slowdown=%.4f work_ms=%.3f run_p50_ms=%.3f run_p99_ms=%.3f "
	       "wake_p50_us=%.1f wake_p99_us=%.1f wake_max_us=%.1f\n",
	       t / 1e9, (double)iters * period_ms / 1e3,
	       t / 1e9 / ((double)iters * period_ms / 1e3), work_ns / 1e6,
	       pct(run_ns, n, 0.50) / 1e6, pct(run_ns, n, 0.99) / 1e6,
	       pct(wake_ns, n, 0.50) / 1e3, pct(wake_ns, n, 0.99) / 1e3,
	       wake_ns[n - 1] / 1e3);
	return 0;
}
