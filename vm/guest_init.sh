#!/bin/bash
# PID 1 inside the sched_ext test VM. Root fs = host / over 9p (read-only).
# Mounts scratch filesystems and the project share, runs the job named by
# the kernel parameter osproj.job=<path relative to project root>, then powers off.
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mountpoint -q /dev || mount -t devtmpfs devtmpfs /dev
mkdir -p /dev/pts && mount -t devpts devpts /dev/pts
for d in /tmp /run /var/tmp /mnt /root; do mount -t tmpfs tmpfs "$d"; done
mount -t bpf bpf /sys/fs/bpf 2>/dev/null
mount -t tracefs tracefs /sys/kernel/tracing 2>/dev/null
mount -t debugfs debugfs /sys/kernel/debug 2>/dev/null
mkdir -p /mnt/project
mount -t 9p -o trans=virtio,version=9p2000.L,msize=512000,cache=none project /mnt/project
export HOME=/root PROJECT=/mnt/project OSPROJ_BUILD=/home/asif/osproj-build
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
source "$PROJECT/scripts/localenv.sh"
hostname scxvm
JOB=$(sed -n 's/.*osproj\.job=\([^ ]*\).*/\1/p' /proc/cmdline)
echo "[guest_init] kernel $(uname -r), $(nproc) CPUs, job=$JOB"
if [ -n "$JOB" ] && [ -f "$PROJECT/$JOB" ]; then
  (cd "$PROJECT" && bash "$PROJECT/$JOB")
  echo "[guest_init] job exit status: $?"
else
  echo "[guest_init] no job; dropping to shell"; setsid bash -l </dev/ttyS0 >/dev/ttyS0 2>&1
fi
sync
echo o > /proc/sysrq-trigger
sleep 5
