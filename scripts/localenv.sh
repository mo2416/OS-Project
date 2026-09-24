# Source this file to use the sudo-free local toolchain sysroot (see docs/ENVIRONMENT_REPORT.md).
# Packages were fetched with `apt-get download` and unpacked with `dpkg -x` into $SYSROOT.
export OSPROJ_BUILD="${OSPROJ_BUILD:-$HOME/osproj-build}"
export SYSROOT="$OSPROJ_BUILD/sysroot"
export PATH="$SYSROOT/usr/bin:$SYSROOT/usr/sbin:$PATH"
export LD_LIBRARY_PATH="$SYSROOT/usr/lib/x86_64-linux-gnu:$SYSROOT/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PKG_CONFIG_PATH="$SYSROOT/usr/lib/x86_64-linux-gnu/pkgconfig:$SYSROOT/usr/share/pkgconfig:/usr/lib/x86_64-linux-gnu/pkgconfig"
export PKG_CONFIG_SYSROOT_DIR=
export C_INCLUDE_PATH="$SYSROOT/usr/include:$SYSROOT/usr/include/x86_64-linux-gnu${C_INCLUDE_PATH:+:$C_INCLUDE_PATH}"
export CPLUS_INCLUDE_PATH="$C_INCLUDE_PATH"
export LIBRARY_PATH="$SYSROOT/usr/lib/x86_64-linux-gnu${LIBRARY_PATH:+:$LIBRARY_PATH}"
export QEMU_FW="$SYSROOT/usr/share/qemu"
# NOTE: -dev packages' lib*.so symlinks point at runtime libs that are installed on the
# host (not in the sysroot); vm/build_kernel.sh re-points dangling ones via fix_sysroot_links.
fix_sysroot_links() {
  local d="$SYSROOT/usr/lib/x86_64-linux-gnu" l t
  for l in $(find "$d" -maxdepth 1 -xtype l); do
    t=$(readlink "$l"); [ -e "/usr/lib/x86_64-linux-gnu/$t" ] && ln -sf "/usr/lib/x86_64-linux-gnu/$t" "$l"
  done; return 0
}
