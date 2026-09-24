#!/bin/bash
# Partial-load benchmark. VM job:  vm/run_vm.sh tests/vm_bench_partial.sh
# Also used for the parameter sweep:  SUITE=sweep (see CONFIGS below).
#
# Workload: tests/dutywork.c, 8 workers x DUTY % of a 20 ms period, fixed work per
# iteration (calibrated once under EEVDF at the start and reused for every run), ITERS
# iterations (ideal completion = ITERS x 20 ms). Per run it snapshots /proc/stat,
# /proc/schedstat (run_delay, pcount) and the LOC/RES rows of /proc/interrupts.
# Summarize on the host:  python3 tests/analyze_partial.py results/raw/<suite>/<run>
set -u
source "$PROJECT/tests/lib.sh"
SUITE="${SUITE:-bench_partial}"
REPS_DEFAULT=3; [ "$SUITE" = sweep ] && REPS_DEFAULT=2
OUT="$PROJECT/results/raw/$SUITE/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
WORKERS="${WORKERS:-8}"; DUTIES="${DUTIES:-20 40 60}"; PERIOD_MS=20
ITERS="${ITERS:-250}"; REPS="${REPS:-$REPS_DEFAULT}"
# name:scx_compact-args ("eevdf" = no BPF scheduler). Commas stand for spaces.
if [ "$SUITE" = sweep ]; then
  CONFIGS="${CONFIGS:-base: s35:-s,35 s65:-s,65 w0:-w,0 w5:-w,5 q1:-Q,1 q4:-Q,4}"
else
  CONFIGS="${CONFIGS:-eevdf nocompact:-n compact:}"
fi
DW="$BIN/dutywork"

snapx() {   # schedstat + interrupt rows, for latency and wakeup accounting
  { echo "== $1 $(now)"; grep '^cpu' /proc/schedstat | sed 's/^/ss /'; grep -E '^ *(LOC|RES):' /proc/interrupts; } >> "$OUT/sched.txt"
}

record_env
export DUTYWORK_LOOPS_PER_MS=$("$DW" -c)
{ echo "suite: $SUITE"; echo "workers: $WORKERS duties: $DUTIES period_ms: $PERIOD_MS iters: $ITERS reps: $REPS"
  echo "loops_per_ms: $DUTYWORK_LOOPS_PER_MS"; echo "configs: $CONFIGS"; } >> "$OUT/env.txt"
echo "cond,duty,rep,wall_s,ideal_s,slowdown,work_ms,run_p50_ms,run_p99_ms,wake_p50_us,wake_p99_us,wake_max_us" > "$OUT/runs.csv"

for cfg in $CONFIGS; do
  name=${cfg%%:*}; args=""
  [[ $cfg == *:* ]] && args=${cfg#*:}; args=${args//,/ }
  SPID=""
  if [ "$name" != eevdf ]; then
    "$BIN/scx_compact" $args -p 200 -c "$OUT/$name.csv" > "$OUT/$name.log" 2>&1 &
    SPID=$!
    wait_state enabled || echo "$name: scheduler did not enable" >> "$OUT/errors.txt"
    sleep 2
  fi
  for duty in $DUTIES; do
    for ((rep = 1; rep <= REPS; rep++)); do
      L="$name:d$duty:r$rep"
      snap "$L:start"; snapx "$L:start"; mark "$L:start"
      r=$("$DW" "$WORKERS" "$duty" "$PERIOD_MS" "$ITERS")
      snap "$L:end"; snapx "$L:end"; mark "$L:end"
      echo "$name,$duty,$rep,$(echo "$r" | sed 's/[a-z0-9_]*=//g; s/ /,/g')" >> "$OUT/runs.csv"
      sleep 1
    done
  done
  if [ -n "$SPID" ]; then
    kill -INT "$SPID"; wait "$SPID"; echo "${name}_exit: $?" >> "$OUT/states.txt"
    wait_state disabled
  fi
done
dmesg | grep -i 'sched_ext' > "$OUT/dmesg_sched_ext.txt"
echo "run written to $OUT"
