#!/bin/bash
# Initial (small) benchmark. VM job:  vm/run_vm.sh tests/vm_bench_initial.sh
# Fixed work per worker (stress-ng int64 cpu ops) for N = 1,2,4,8 workers, REPS repetitions,
# under three conditions: eevdf (no BPF scheduler), nocompact (scx_compact -n), compact.
# Per run it records wall time, CPUs used (/proc/stat) and context switches.
# Summarize on the host with: python3 tests/analyze_bench.py results/raw/bench_initial/<run>
set -u
source "$PROJECT/tests/lib.sh"
OUT="$PROJECT/results/raw/bench_initial/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
OPS="${OPS:-400}"; REPS="${REPS:-3}"; NS="${NS:-1 2 4 8}"
record_env
echo "accel: $(grep -qw hypervisor /proc/cpuinfo && echo guest) ops_per_worker=$OPS reps=$REPS" >> "$OUT/env.txt"
echo "cond,n,rep,wall_s,ctxt" > "$OUT/runs.csv"

run_set() {   # run_set <cond>
  local n rep t0 t1 c0 c1
  for n in $NS; do
    for ((rep = 1; rep <= REPS; rep++)); do
      snap "$1:n$n:r$rep:start"; t0=$(now); c0=$(awk '/^ctxt/{print $2}' /proc/stat)
      stress-ng --cpu "$n" --cpu-ops $((n * OPS)) --cpu-method int64 > /dev/null 2>&1
      t1=$(now); c1=$(awk '/^ctxt/{print $2}' /proc/stat); snap "$1:n$n:r$rep:end"
      echo "$1,$n,$rep,$(awk "BEGIN{printf \"%.3f\", $t1 - $t0}"),$((c1 - c0))" >> "$OUT/runs.csv"
      sleep 1
    done
  done
}

start_sched() {   # start_sched <name> [args...]
  local name=$1; shift
  "$BIN/scx_compact" "$@" -p 500 -c "$OUT/$name.csv" > "$OUT/$name.log" 2>&1 &
  SCHED_PID=$!
  wait_state enabled || echo "$name: scheduler did not enable" >> "$OUT/errors.txt"
  sleep 1
}
stop_sched() {
  kill -INT "$SCHED_PID"; wait "$SCHED_PID"; echo "$1_exit: $?" >> "$OUT/states.txt"
  wait_state disabled
}

run_set eevdf
start_sched nocompact -n; run_set nocompact; stop_sched nocompact
start_sched compact;      run_set compact;   stop_sched compact
dmesg | grep -i 'sched_ext' > "$OUT/dmesg_sched_ext.txt"
echo "benchmark run written to $OUT"
