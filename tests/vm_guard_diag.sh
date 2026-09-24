#!/bin/bash
# Diagnose where >1 ms runqueue waits come from: late_pm with/without compaction,
# idle vs 8x40 % duty. VM job: vm/run_vm.sh tests/vm_guard_diag.sh
set -u
source "$PROJECT/tests/lib.sh"
export DUTYWORK_LOOPS_PER_MS=$("$BIN/dutywork" -c)
for args in "-n -L 1000" "-L 1000 -P 1000" "-L 1000"; do
  "$BIN/scx_compact" $args -p 1000 -c "/tmp/diag.csv" &
  P=$!
  wait_state enabled; echo "[diag] args='$args'"
  sleep 4
  "$BIN/dutywork" 8 40 20 250
  sleep 2
  kill -INT $P; wait $P; wait_state disabled
  awk -F, 'NR>1{print "[diag-csv] t="$2" active="$3" waits="$13" late="$14" late_pm="$15" lat_expand="$16}' /tmp/diag.csv; rm -f /tmp/diag.csv
done
