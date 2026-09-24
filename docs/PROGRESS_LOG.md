# Progress Log

Times are local session times on 2026-09-24 (UTC clock of the WSL instance).

| # | Time (UTC) | Phase | Task | Status | Evidence | Commit | Result / limitation | Next step |
|---|---|---|---|---|---|---|---|---|
| 1 | ~07:40 | Env audit | Inspect repo, kernel, toolchain | DONE | `/proc/config.gz`: `# CONFIG_SCHED_CLASS_EXT is not set`; `/sys/kernel/sched_ext` absent; `/sys/class/powercap` empty | bd87660 | WSL2 kernel cannot run sched_ext; no RAPL visible | Build our own guest kernel |
| 2 | ~07:50 | Env setup | Tooling without sudo | DONE | `scripts/localenv.sh`; `apt-get download` + `dpkg -x` into `~/osproj-build/sysroot` (115 pkgs) | bd87660 | sudo needs a password; `scripts/setup_host.sh` is prepared but its effect was not observed in this distro | — |
| 3 | ~08:00 | Research | sched_ext landscape, overlap | DONE | `docs/RESEARCH_DECISION.md` | bd87660 | Direction locked: transparent load-adaptive compaction plus a control condition | — |
| 4 | ~08:05–08:40 | Kernel | Build 6.18.53 guest kernel with `CONFIG_SCHED_CLASS_EXT=y` | **BLOCKED** | `results/raw/build/kernel_build.log`; `.config` shows `CONFIG_SCHED_CLASS_EXT=y`, `CONFIG_DEBUG_INFO_BTF=y` | (next) | Fixed 3 build issues (merge_config path with space; dangling sysroot .so links; openssl multiarch include). The 4th attempt failed at `vmlinux.o` objtool `elf_update: cannot write data`: **C: drive reached 0 GB free**, the WSL `ext4.vhdx` on C: could not grow, and the WSL root fs went `emergency_ro` | User frees C: or moves the distro to D:, restarts WSL, then resume the kernel build |
| 5 | ~08:30 | Scheduler | Write scx_compact BPF policy and loader | WRITTEN, **NOT BUILT / NOT VERIFIED** | `scheduler/scx_compact.bpf.c`, `scx_compact.c`, `scx_compact.h`, `Makefile` | (next) | Nothing compiled yet (needs the guest kernel's vmlinux BTF) | Build after the kernel |

## Resume instructions (after the disk incident)

1. Free space on C: (≥ 20 GB), **or** move the distro off C: (PowerShell):
   `wsl --shutdown` then `wsl --manage Ubuntu --move D:\WSL\Ubuntu`
2. Restart WSL, then in PowerShell: `wsl -d Ubuntu -u root chmod 666 /dev/kvm`
3. Restart Claude Code in `/mnt/d/OS Project` and ask it to resume from this log.
4. Resume: `bash vm/build_kernel.sh` (the tree in `~/osproj-build` is reused), then
   `source scripts/localenv.sh && make -C scheduler`.
