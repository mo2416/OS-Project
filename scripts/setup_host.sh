#!/usr/bin/env bash
# One-time host (WSL2 Ubuntu) setup for the sched_ext core-compaction project.
# Run with: sudo bash scripts/setup_host.sh
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "run with sudo" >&2; exit 1; fi
TARGET_USER="${SUDO_USER:-$(logname)}"
apt-get update
apt-get install -y qemu-system-x86 dwarves libelf-dev libssl-dev libbpf-dev bpftool \
    stress-ng cpio busybox-static virtme-ng pkg-config acl libzstd-dev hyperfine \
    sysstat libcap-dev
# Allow the build user to use KVM for the test VM (non-persistent; reset on WSL restart).
setfacl -m "u:${TARGET_USER}:rw" /dev/kvm
echo "setup_host.sh: OK (kvm access granted to ${TARGET_USER})"
