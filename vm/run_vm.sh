#!/usr/bin/env bash
# Boot the sched_ext test VM and run one job script inside it.
# Usage: vm/run_vm.sh <job-script relative to project root> [vcpus] [mem]
# Topology: 1 socket, vcpus/2 cores x 2 threads (SMT) so the guest sees siblings.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; PROJECT="$(dirname "$HERE")"
source "$PROJECT/scripts/localenv.sh"
JOB="${1:-}"; VCPUS="${2:-8}"; MEM="${3:-4G}"
KERNEL="$OSPROJ_BUILD/kbuild/arch/x86/boot/bzImage"
INIT="$OSPROJ_BUILD/guest_init.sh"   # copied: kernel cmdline cannot contain the space in "OS Project"
install -m 755 "$HERE/guest_init.sh" "$INIT"
if [ -w /dev/kvm ]; then ACCEL=(-accel kvm -cpu host); else
  echo "run_vm.sh: WARNING /dev/kvm not accessible -> TCG emulation (timings not meaningful)" >&2
  ACCEL=(-accel tcg,thread=multi -cpu max); fi
exec qemu-system-x86_64 "${ACCEL[@]}" -L "$QEMU_FW" \
  -smp "$VCPUS",sockets=1,cores=$((VCPUS/2)),threads=2 -m "$MEM" \
  -kernel "$KERNEL" -nographic -no-reboot -nodefaults -serial mon:stdio \
  -virtfs local,path=/,mount_tag=/dev/root,security_model=none,readonly=on,multidevs=remap \
  -virtfs "local,path=$PROJECT,mount_tag=project,security_model=none,multidevs=remap" \
  -append "root=/dev/root rootfstype=9p rootflags=trans=virtio,version=9p2000.L,msize=512000,cache=loose ro console=ttyS0 panic=-1 init=$INIT osproj.job=$JOB"
