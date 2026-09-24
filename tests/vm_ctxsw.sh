#!/bin/bash
# Time-boxed check of the extra context switches seen at N=8 in bench_initial (row 18).
# 8 busy loops for 6 s under: eevdf, scx_compact -n, scx_compact (min 2), scx_compact -m 8
# (same compact placement code, set starts at all CPUs). /proc/stat ctxt sampled every
# 0.5 s, so the ramp-up phase can be separated from the steady state.
# VM job: vm/run_vm.sh tests/vm_ctxsw.sh
set -u
source "$PROJECT/tests/lib.sh"
OUT="$PROJECT/results/raw/ctxsw/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
record_env
echo "cond,t_s,ctxt" > "$OUT/ctxt.csv"
one() {   # one <name> [scx_compact args | eevdf]
  local name=$1 SPID="" t0 i; shift
  if [ "${1:-}" != eevdf ]; then
    "$BIN/scx_compact" "$@" -p 200 -c "$OUT/$name.csv" > "$OUT/$name.log" 2>&1 & SPID=$!
    wait_state enabled; sleep 2
  fi
  t0=$(now)
  echo "$name,0,$(awk '/^ctxt/{print $2}' /proc/stat)" >> "$OUT/ctxt.csv"
  hogs 8
  for ((i = 1; i <= 12; i++)); do
    sleep 0.5
    echo "$name,$(awk "BEGIN{print $(now) - $t0}"),$(awk '/^ctxt/{print $2}' /proc/stat)" >> "$OUT/ctxt.csv"
  done
  kill_hogs
  if [ -n "$SPID" ]; then kill -INT $SPID; wait $SPID; echo "${name}_exit: $?" >> "$OUT/states.txt"; wait_state disabled; fi
  sleep 1
}
for rep in 1 2; do
  one eevdf_r$rep eevdf
  one nocompact_r$rep -n
  one compact_r$rep
  one compact_m8_r$rep -m 8
done
echo "run written to $OUT"
