#!/bin/bash
# Parameter sweep (scx_compact configs only). VM job: vm/run_vm.sh tests/vm_sweep.sh
SUITE=sweep exec bash "$PROJECT/tests/vm_bench_partial.sh"
