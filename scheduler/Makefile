# Build scx_compact (plus the in-tree scx_simple/scx_qmap references) with the
# kernel's own tools/sched_ext build system, against the guest kernel's BTF.
#
#   source scripts/localenv.sh && make -C scheduler
#
# Our sources are symlinked into $(KSRC)/tools/sched_ext so they are built with
# exactly the same flags, libbpf, bpftool and vmlinux.h as the reference schedulers.

OSPROJ_BUILD ?= $(HOME)/osproj-build
KVER         ?= 6.18.53
KSRC         ?= $(OSPROJ_BUILD)/linux-$(KVER)
KOUT         ?= $(OSPROJ_BUILD)/kbuild
SCXOUT       ?= $(OSPROJ_BUILD)/scxbuild
HERE         := $(shell pwd)
SRCS         := scx_compact.bpf.c scx_compact.c scx_compact.h
TARGETS      := scx_simple scx_qmap scx_compact

all:
	@for f in $(SRCS); do ln -sf "$(HERE)/$$f" "$(KSRC)/tools/sched_ext/$$f"; done
	$(MAKE) -C $(KSRC)/tools/sched_ext O=$(SCXOUT) VMLINUX_BTF=$(KOUT)/vmlinux \
		c-sched-targets="$(TARGETS)" $(addprefix $(SCXOUT)/build/bin/,$(TARGETS))
	mkdir -p build && cp $(addprefix $(SCXOUT)/build/bin/,$(TARGETS)) build/
	@ls -l build/

clean:
	rm -rf build $(SCXOUT)

.PHONY: all clean
