# Progress Log

Times are local session times on 2026-09-24 (UTC clock of the WSL instance).

| # | Time (UTC) | Phase | Task | Status | Evidence | Commit | Result / limitation | Next step |
|---|---|---|---|---|---|---|---|---|
| 1 | ~07:40 | Env audit | Inspect repo, kernel, toolchain | DONE | `/proc/config.gz`: `# CONFIG_SCHED_CLASS_EXT is not set`; `/sys/kernel/sched_ext` absent; `/sys/class/powercap` empty | bd87660 | WSL2 kernel cannot run sched_ext; no RAPL visible | Build our own guest kernel |
| 2 | ~07:50 | Env setup | Tooling without sudo | DONE | `scripts/localenv.sh`; `apt-get download` + `dpkg -x` into `~/osproj-build/sysroot` (115 pkgs) | bd87660 | sudo needs a password; `scripts/setup_host.sh` is prepared but its effect was not observed in this distro | — |
| 3 | ~08:00 | Research | sched_ext landscape, overlap | DONE | `docs/RESEARCH_DECISION.md` | bd87660 | Direction locked: transparent load-adaptive compaction plus a control condition | — |
| 4 | ~08:05–08:40 | Kernel | Build 6.18.53 guest kernel with `CONFIG_SCHED_CLASS_EXT=y` | **BLOCKED** | `results/raw/build/kernel_build.log`; `.config` shows `CONFIG_SCHED_CLASS_EXT=y`, `CONFIG_DEBUG_INFO_BTF=y` | (next) | Fixed 3 build issues (merge_config path with space; dangling sysroot .so links; openssl multiarch include). The 4th attempt failed at `vmlinux.o` objtool `elf_update: cannot write data`: **C: drive reached 0 GB free**, the WSL `ext4.vhdx` on C: could not grow, and the WSL root fs went `emergency_ro` | User frees C: or moves the distro to D:, restarts WSL, then resume the kernel build |
| 5 | ~08:30 | Scheduler | Write scx_compact BPF policy and loader | WRITTEN, **NOT BUILT / NOT VERIFIED** | `scheduler/scx_compact.bpf.c`, `scx_compact.c`, `scx_compact.h`, `Makefile` | 4e02722 | Nothing compiled yet (needs the guest kernel's vmlinux BTF) | Build after the kernel |
| 6 | ~08:55 | Env audit (session 2) | Re-check after the WSL restart | DONE | `df`: WSL root rw again; **distro NOT moved**: `ext4.vhdx` still at `C:\Users\asif2\AppData\Local\wsl\{b064e58d-…}\ext4.vhdx` (12.6 GB), C: 3.2 GB free; `/dev/kvm` is `root:kvm 0660` and user `asif` is not in `kvm` → no KVM (TCG only); `sudo -n` needs a password | — | Neither resume precondition (C: space, KVM access) was met | — |
| 7 | ~08:57 | Kernel | Shrink the link stage, guard the disk | DONE (code) | `vm/scx-guest.config`: `CONFIG_DEBUG_INFO_COMPRESSED_ZLIB=y`; `vm/build_kernel.sh`: aborts `make` if C: < 1200 MB free (checked every 5 s); deleted regenerable `~/osproj-build/{linux-6.18.53.tar.xz,debs,kbuild/vmlinux.o}` (~560 MB) | (pending) | Compressed DWARF made the new `vmlinux.o` ~30 MB instead of the >352 MB partial file from attempt 4 | — |
| 8 | ~08:57–09:05 | Kernel | Build attempt 5 | **FAILED (disk / WSL fs)** | `results/raw/build/kernel_build_2.log` (lines 2788–2802) | (pending) | All objects compiled; `vmlinux.o`, MODPOST, kallsyms and `.tmp_vmlinux1` linked. It failed in `BTF .tmp_vmlinux1.btf.o` (pahole): `Segmentation fault`, then `cannot create .tmp_vmlinux1.syms: Read-only file system`, `Bus error`. The WSL root fs went read-only again. Afterwards every binary in the WSL shell (bash builtins aside) died with SIGBUS/SIGSEGV, so the agent could not run commands, commit or collect `dmesg`. The last reading before the failure was C: 2642 MB free, and the 1200 MB guard never fired. **Root cause not verified:** most likely host-side storage exhaustion (the ext4.vhdx and the WSL swap.vhdx both live on C:, and pahole's memory spike on a 7 GB VM can push swap), but it was not observed directly | Move the distro to D: before any further kernel work (see below) |
| 9 | ~09:00 | Tests | Functional + initial benchmark harness | WRITTEN, **NOT RUN** | `tests/lib.sh`, `tests/vm_functional.sh`, `tests/analyze_functional.py`, `tests/vm_bench_initial.sh`, `tests/analyze_bench.py`; loader CSV gains a `mono_s` column (`scheduler/scx_compact.c`) | (pending) | Placement is judged from `/proc/stat` (kernel accounting), not from the scheduler's own counters. Checks F1–F6 are defined in `analyze_functional.py`. No results exist yet | Run once the kernel and scheduler build |
| 10 | ~09:15–09:22 | Env (session 3) | Free C: and check artifacts before resuming | DONE | Windows-side cleanup of user TEMP (5.05 GB), npm/pip caches and CrashDumps: C: went from 5.12 → 11.65 GB free. Integrity scan of `~/osproj-build/kbuild`: 3,249/3,250 objects valid; **`vmlinux.o` corrupt** (size 611,642,720 B, but the last 28 MB are zeros and `nm` reports `corrupt string table index`, i.e. data lost when the fs went read-only). A config dry-run in a scratch dir gave a `.config` identical to the tree's → incremental build | — | Deleted only `kbuild/vmlinux.o`. Row 7's "~30 MB vmlinux.o" was a mid-write reading; the finished file is 611 MB | Resume the build |
| 11 | ~09:23–09:26 | Kernel | Build attempt 6 (incremental) | **DONE** | `results/raw/build/kernel_build_3.log` ends `EXIT 0`; `kbuild/arch/x86/boot/bzImage` (14.4 MB); `kbuild/vmlinux` (206 MB) has `.BTF` sections | (pending) | Only the link stage re-ran (about 3 min). The kernel was not booted yet | Build scheduler once C: is safe |
| 12 | ~09:25–09:27 | Env | C: collapse during the BTF/link step | **STOPPED (host disk)** | C: free went 11.65 → 8.3 GB (before the link) → 2.46 GB (after BTF). In WSL: RAM ~1.2 GB used, swap 0 MB. On Windows: `pagefile.sys` 7,063 → **11,185 MB**; `ext4.vhdx` 12,834 → 13,570 MB; `vmmemWSL` 5.3 GB private; host RAM free 1.4 GB of 16 GB; Volsnap event 35 at 14:41 local (shadow storage growing again) | — | **Likely root cause of the disk incidents (revises row 8):** *Windows* page-file growth on C: under host memory pressure from the WSL VM (build page cache), not guest swap. The 1.2 GB in-guest guard cannot catch this, because the page file grows GBs within seconds. Scheduler build and VM tests were **not** started | See resume instructions |

## Resume instructions (updated after attempt 6, session 3)

The kernel is built (`~/osproj-build/kbuild/arch/x86/boot/bzImage`, `vmlinux` with BTF).
Uncommitted work in the tree: rows 7–12 (build_kernel.sh guard, scx-guest.config,
scx_compact.c CSV column, tests/, this log, kernel_build_2/3 logs).

Before any more heavy work (scheduler build, QEMU tests), restore host headroom:

1. DONE (session 3, ~09:29): created `C:\Users\asif2\.wslconfig` with `memory=6GB`
   (room for the default 4G QEMU guest), `swap=2GB`, `swapFile=D:\\WSL\\swap.vhdx`
   (folder `D:\WSL` created), `[experimental] autoMemoryReclaim=dropCache`.
   It takes effect only after `wsl --shutdown` or a reboot.
2. Reboot Windows. A system-managed page file only shrinks at boot (expect about +4 GB back on C:).
3. Optional but recommended: move the page file or the distro to D:
   (`wsl --manage Ubuntu --move D:\WSL\Ubuntu`).
4. Then: `source scripts/localenv.sh && make -C scheduler`, then `tests/vm_functional.sh`.
   Note `/dev/kvm` is still `root:kvm 0660` and user `asif` is not in `kvm`, so QEMU runs
   under TCG unless `wsl -d Ubuntu -u root chmod 666 /dev/kvm` is run after each WSL start.
