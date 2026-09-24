#!/bin/bash
# Quick check of the latency guard: load, 8x40 % duty for 5 s with the guard on, then off.
# VM job: vm/run_vm.sh tests/vm_guard_smoke.sh
set -u
source "$PROJECT/tests/lib.sh"
export DUTYWORK_LOOPS_PER_MS=$("$BIN/dutywork" -c)
for args in "-L 1000" ""; do
  "$BIN/scx_compact" $args -p 500 &
  P=$!
  wait_state enabled && echo "[guard-smoke] args='$args' state=$(scx_state)"
  sleep 1
  "$BIN/dutywork" 8 40 20 250
  kill -INT $P; wait $P; echo "[guard-smoke] exit: $?"
  wait_state disabled
done
dmesg | grep -i sched_ext
