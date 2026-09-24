#!/bin/bash
# Smoke test: attach scx_compact for a few seconds with one busy loop, then detach.
# VM job:  vm/run_vm.sh tests/vm_smoke.sh
set -u
source "$PROJECT/tests/lib.sh"
echo "[smoke] state before: $(scx_state)"
"$BIN/scx_compact" -p 500 -t 6 &
P=$!
wait_state enabled && echo "[smoke] state during: $(scx_state) ops=$(scx_ops)"
sleep 2; hog; sleep 3; kill_hogs
wait $P; echo "[smoke] scx_compact exit: $?"
wait_state disabled; echo "[smoke] state after: $(scx_state)"
dmesg | grep -i sched_ext
