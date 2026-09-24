#!/bin/bash
# Probe what idle/sched accounting the guest exposes. VM job: vm/run_vm.sh tests/vm_probe.sh
set -u
head -3 /proc/schedstat
ls /sys/devices/system/cpu/cpuidle/ 2>&1; cat /sys/devices/system/cpu/cpuidle/current_driver 2>&1
for s in /sys/devices/system/cpu/cpu0/cpuidle/state*; do echo "$s $(cat $s/name) usage=$(cat $s/usage) time=$(cat $s/time)"; done 2>&1
grep -c . /proc/interrupts; grep -E "LOC|RES|CAL" /proc/interrupts
