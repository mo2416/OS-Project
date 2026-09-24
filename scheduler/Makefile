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
# scx_simple is not built: in the 6.18.53 tree it calls a kfunc 6.18 lacks.
TARGETS      := scx_qmap scx_compact

all:
	@for f in $(SRCS); do ln -sf "$(HERE)/$$f" "$(KSRC)/tools/sched_ext/$$f"; done
	@mkdir -p $(SCXOUT)
	# cd instead of -C: tools/scripts/Makefile.include cd's to $$PWD, which breaks on the
	# space in "OS Project".
	cd $(KSRC)/tools/sched_ext && $(MAKE) O=$(SCXOUT) VMLINUX_BTF=$(KOUT)/vmlinux \
		c-sched-targets="$(TARGETS)" $(addprefix $(SCXOUT)/build/bin/,$(TARGETS))
	mkdir -p build && cp $(addprefix $(SCXOUT)/build/bin/,$(TARGETS)) build/
	$(CC) -O2 -Wall -Werror -pthread -o build/dutywork ../tests/dutywork.c
	@ls -l build/

clean:
	rm -rf build $(SCXOUT)

.PHONY: all clean
