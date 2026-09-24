#!/bin/bash
# Repeated, interleaved partial-load validation. VM job: vm/run_vm.sh tests/vm_bench_repeated.sh
#
# Conditions: eevdf (no BPF scheduler), nocompact (scx_compact -n), compact (defaults,
# guard off), guard (scx_compact -L 1000 -P 10: latency guard, p99 target 1 ms).
# Loads: 8 dutywork workers x {20, 40, 60, 99} % duty of a 20 ms period, 250 iterations
# (ideal 5 s). Each run also carries latprobe (1 ms periodic sleeper) for the same 5 s.
# REPS repetitions, rep-major; the condition order is rotated every rep so that no
# condition is always first or last. The scheduler is restarted for every (rep, cond).
# Summarize on the host: python3 tests/analyze_repeated.py results/raw/bench_repeated/<run>
set -u
source "$PROJECT/tests/lib.sh"
SUITE=bench_repeated
OUT="$PROJECT/results/raw/$SUITE/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
WORKERS=8; DUTIES="${DUTIES:-20 40 60 99}"; PERIOD_MS=20; ITERS=250; REPS="${REPS:-10}"
CONDS=(eevdf "nocompact:-n" "compact:" "guard:-L,1000,-P,10")
DW="$BIN/dutywork"; LP="$BIN/latprobe"

snapx() {
  { echo "== $1 $(now)"; grep '^cpu' /proc/schedstat | sed 's/^/ss /'; grep -E '^ *(LOC|RES):' /proc/interrupts; } >> "$OUT/sched.txt"
}

record_env
export DUTYWORK_LOOPS_PER_MS=$("$DW" -c)
{ echo "suite: $SUITE"; echo "workers: $WORKERS duties: $DUTIES period_ms: $PERIOD_MS iters: $ITERS reps: $REPS"
  echo "loops_per_ms: $DUTYWORK_LOOPS_PER_MS"; echo "conds: ${CONDS[*]}"; echo "probe: latprobe 1000us"; } >> "$OUT/env.txt"
echo "cond,duty,rep,order,wall_s,ideal_s,slowdown,work_ms,run_p50_ms,run_p99_ms,wake_p50_us,wake_p99_us,wake_max_us,run_p95_ms,wake_p95_us,probe_n,probe_p50_us,probe_p95_us,probe_p99_us,probe_max_us" > "$OUT/runs.csv"

nc=${#CONDS[@]}
for ((rep = 1; rep <= REPS; rep++)); do
  for ((k = 0; k < nc; k++)); do
    cfg=${CONDS[$(((k + rep) % nc))]}
    name=${cfg%%:*}; args=""
    [[ $cfg == *:* ]] && args=${cfg#*:}; args=${args//,/ }
    SPID=""
    if [ "$name" != eevdf ]; then
      "$BIN/scx_compact" $args -p 200 -c "$OUT/$name.r$rep.csv" > "$OUT/$name.r$rep.log" 2>&1 &
      SPID=$!
      wait_state enabled || echo "$name r$rep: scheduler did not enable" >> "$OUT/errors.txt"
      sleep 2
    fi
    for duty in $DUTIES; do
      L="$name:d$duty:r$rep"
      snap "$L:start"; snapx "$L:start"; mark "$L:start"
      "$LP" 1000 5 > "$OUT/probe.tmp" &
      LPID=$!
      r=$("$DW" "$WORKERS" "$duty" "$PERIOD_MS" "$ITERS")
      wait "$LPID"
      snap "$L:end"; snapx "$L:end"; mark "$L:end"
      echo "$name,$duty,$rep,$k,$(echo "$r $(cat "$OUT/probe.tmp")" | sed 's/[a-z0-9_]*=//g; s/ /,/g')" >> "$OUT/runs.csv"
      sleep 1
    done
    if [ -n "$SPID" ]; then
      kill -INT "$SPID"; wait "$SPID"; echo "${name}_r${rep}_exit: $?" >> "$OUT/states.txt"
      wait_state disabled
    fi
  done
done
rm -f "$OUT/probe.tmp"
dmesg | grep -i 'sched_ext' > "$OUT/dmesg_sched_ext.txt"
echo "run written to $OUT"
