# Helpers shared by the in-VM test jobs (sourced; run as root inside the sched_ext VM).
# Timestamps are /proc/uptime seconds (= CLOCK_MONOTONIC in the VM, which never suspends),
# so they line up with the mono_s column of the scx_compact CSV.

BIN="${BIN:-$PROJECT/scheduler/build}"
SCX_STATE=/sys/kernel/sched_ext/state
HOG_PIDS=()

now() { cut -d' ' -f1 /proc/uptime; }

# mark <event...>: append a timestamped phase marker
mark() { echo "$(now) $*" >> "$OUT/phases.txt"; }

# snap <label>: dump per-CPU /proc/stat counters plus the context-switch total
snap() {
  { echo "== $1 $(now)"; grep -E '^(cpu[0-9]+|ctxt) ' /proc/stat; } >> "$OUT/procstat.txt"
}

scx_state() { cat "$SCX_STATE" 2>/dev/null || echo absent; }
scx_ops() { cat /sys/kernel/sched_ext/root/ops 2>/dev/null || echo none; }

# wait_state <enabled|disabled> [tries of 0.1 s]
wait_state() {
  local i
  for ((i = 0; i < ${2:-100}; i++)); do
    [ "$(scx_state)" = "$1" ] && return 0
    sleep 0.1
  done
  return 1
}

# hog [taskset-cpulist]: start a 100% CPU busy loop in the background
hog() {
  if [ -n "${1:-}" ]; then taskset -c "$1" bash -c 'while :; do :; done' &
  else bash -c 'while :; do :; done' & fi
  HOG_PIDS+=($!)
}
hogs() { local i; for ((i = 0; i < $1; i++)); do hog; done; }
kill_hogs() {
  [ ${#HOG_PIDS[@]} -gt 0 ] && kill "${HOG_PIDS[@]}" 2>/dev/null
  wait "${HOG_PIDS[@]}" 2>/dev/null
  HOG_PIDS=()
}

# window <label> <settle_s> <measure_s>: settle, then bracket a measurement window
window() {
  sleep "$2"; snap "$1:start"; mark "$1:start"
  sleep "$3"; snap "$1:end"; mark "$1:end"
}

record_env() {
  {
    echo "kernel: $(uname -r)"
    echo "nproc: $(nproc)"
    echo "sched_ext_state: $(scx_state)"
    echo "sched_ext_switch_all: $(cat /sys/kernel/sched_ext/switch_all 2>/dev/null)"
    for c in /sys/devices/system/cpu/cpu[0-9]*; do
      echo "$(basename "$c") core=$(cat "$c/topology/core_id") siblings=$(cat "$c/topology/thread_siblings_list")"
    done
  } > "$OUT/env.txt"
}
