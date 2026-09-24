#!/bin/bash
# Functional test of scx_compact. VM job:  vm/run_vm.sh tests/vm_functional.sh
# Writes raw data to results/raw/functional/<UTC timestamp>/; judge it on the host with
#   python3 tests/analyze_functional.py results/raw/functional/<run>
set -u
source "$PROJECT/tests/lib.sh"
OUT="$PROJECT/results/raw/functional/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
DUTY="stress-ng --cpu 8 --cpu-load 20 --timeout"   # 8 workers, each busy 20% of the time
record_env
mark "run:start"

# --- F1: sched_ext baseline with the in-tree reference scheduler -----------------------
"$BIN/scx_simple" > "$OUT/simple.log" 2>&1 &
SPID=$!
wait_state enabled && echo "simple_state_during: $(scx_state) ops=$(scx_ops)" >> "$OUT/states.txt"
sleep 2; kill -INT $SPID; wait $SPID; echo "simple_exit: $?" >> "$OUT/states.txt"
wait_state disabled; echo "simple_state_after: $(scx_state)" >> "$OUT/states.txt"

# --- F4 reference: duty-cycle load under the default scheduler (EEVDF) -----------------
$DUTY 9s > /dev/null 2>&1 & W=$!
window duty:eevdf 2 5; wait $W

# --- F2/F3: scx_compact, phased load ---------------------------------------------------
"$BIN/scx_compact" -p 200 -c "$OUT/compact.csv" > "$OUT/compact.log" 2>&1 &
CPID=$!
wait_state enabled && echo "compact_state_during: $(scx_state) ops=$(scx_ops)" >> "$OUT/states.txt"
window idle 1 3
hogs 1; window hog1 2 4; kill_hogs
hogs 4; window hog4 2 4; kill_hogs
hogs 8; window hog8 2 4; kill_hogs
window release 3 2                                   # load removed: the set should shrink
$DUTY 9s > /dev/null 2>&1 & W=$!
window duty:compact 2 5; wait $W
# F5: a task whose affinity excludes the whole active set must still run
LAST=$(( $(nproc) - 1 ))
sleep 2; hog "$LAST"; window pinned 1 4; kill_hogs
kill -INT $CPID; wait $CPID; echo "compact_exit: $?" >> "$OUT/states.txt"
wait_state disabled; echo "compact_state_after: $(scx_state)" >> "$OUT/states.txt"

# --- F4 control: same binary, compaction disabled (all CPUs active) --------------------
"$BIN/scx_compact" -n -p 200 -c "$OUT/nocompact.csv" > "$OUT/nocompact.log" 2>&1 &
CPID=$!
wait_state enabled && echo "nocompact_state_during: $(scx_state) ops=$(scx_ops)" >> "$OUT/states.txt"
$DUTY 9s > /dev/null 2>&1 & W=$!
window duty:nocompact 2 5; wait $W
kill -INT $CPID; wait $CPID; echo "nocompact_exit: $?" >> "$OUT/states.txt"
wait_state disabled; echo "nocompact_state_after: $(scx_state)" >> "$OUT/states.txt"

mark "run:end"
dmesg | grep -i 'sched_ext' > "$OUT/dmesg_sched_ext.txt"
echo "functional run written to $OUT"
