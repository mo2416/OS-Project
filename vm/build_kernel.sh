#!/usr/bin/env bash
# Build the sched_ext-enabled guest kernel used by vm/run_vm.sh.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../scripts/localenv.sh"
KVER="${KVER:-6.18.53}"
KSRC="$OSPROJ_BUILD/linux-$KVER"
KOUT="$OSPROJ_BUILD/kbuild"
if [ ! -d "$KSRC" ]; then
  (cd "$OSPROJ_BUILD" && curl -sSLO "https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-$KVER.tar.xz" && tar xf "linux-$KVER.tar.xz")
fi
fix_sysroot_links
mkdir -p "$KOUT"
make -C "$KSRC" O="$KOUT" x86_64_defconfig
# merge_config.sh cannot handle spaces in paths ("OS Project"), so copy the fragment.
cp "$HERE/scx-guest.config" "$KOUT/scx-guest.config"
"$KSRC/scripts/kconfig/merge_config.sh" -m -O "$KOUT" "$KOUT/.config" \
    "$KSRC/kernel/configs/kvm_guest.config" "$KOUT/scx-guest.config"
make -C "$KSRC" O="$KOUT" olddefconfig
for opt in SCHED_CLASS_EXT DEBUG_INFO_BTF BPF_JIT 9P_FS SCHEDSTATS; do
  grep -q "^CONFIG_${opt}=y" "$KOUT/.config" || { echo "missing CONFIG_$opt" >&2; exit 1; }
done
make -C "$KSRC" O="$KOUT" -j"$(nproc)" bzImage
echo "kernel: $KOUT/arch/x86/boot/bzImage"
