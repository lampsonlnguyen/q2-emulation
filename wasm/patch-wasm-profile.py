#!/usr/bin/env python3
"""Instrument the pinned WASM engine without changing translation policy."""
from pathlib import Path
import sys

p = Path(sys.argv[1]) / "tcg/wasm32.c"
s = p.read_text()

def replace(old, new):
    global s
    if s.count(old) != 1:
        raise SystemExit("Unexpected WASM profiling anchor: " + old[:100])
    s = s.replace(old, new, 1)

replace("__thread int instance_running_local = 0;",
"""__thread int instance_running_local = 0;
/* Per-vCPU counters; no atomic operations in the dispatch hot path. */
static __thread uint64_t q2_jit_hits, q2_interp_calls, q2_promotions;
static __thread uint64_t q2_pressure, q2_evicted, q2_gc, q2_stale;
static __thread uint64_t q2_dispatch;
""")
replace("    int to_remove = instance_running_local / 2;",
"""    int to_remove = instance_running_local / 2;
    q2_evicted += to_remove;""")
replace("        qatomic_sub(&instance_alive_global, instance_garbage_collected_local);",
"""        q2_gc += instance_garbage_collected_local;
        qatomic_sub(&instance_alive_global, instance_garbage_collected_local);""")
replace("    if (elm->tb != tb_ptr) {",
"""    if (elm->tb != tb_ptr) {
        q2_stale++;""")
replace("        trysleep();\n        int tb_counter_ptr",
"""        trysleep();
        /* Log only once per 2^20 dispatches; counts are dispatches, not
         * guest instructions (the interpreter can chain multiple TBs). */
        if ((++q2_dispatch & 0xfffff) == 0) {
            fprintf(stderr, "Q2_JIT dispatch=%llu hit=%llu interp=%llu promote=%llu pressure=%llu evicted=%llu gc=%llu stale=%llu live=%d running=%d\\n",
                    (unsigned long long)q2_dispatch,
                    (unsigned long long)q2_jit_hits,
                    (unsigned long long)q2_interp_calls,
                    (unsigned long long)q2_promotions,
                    (unsigned long long)q2_pressure,
                    (unsigned long long)q2_evicted,
                    (unsigned long long)q2_gc,
                    (unsigned long long)q2_stale,
                    qatomic_read(&instance_alive_global), instance_running_local);
            fflush(stderr);
        }
        int tb_counter_ptr""")
replace("        if (fidx > 0) {\n            res = ((wasm_func_ptr)(fidx))(&ctx);",
"""        if (fidx > 0) {
            q2_jit_hits++;
            res = ((wasm_func_ptr)(fidx))(&ctx);""")
replace("            *(int32_t*)tb_counter_ptr += 1;\n            res = tcg_qemu_tb_exec_tci(env);",
"""            *(int32_t*)tb_counter_ptr += 1;
            q2_interp_calls++;
            res = tcg_qemu_tb_exec_tci(env);""")
replace("        } else if (!can_add_instance()) {\n            remove_instance_running_local();",
"""        } else if (!can_add_instance()) {
            q2_pressure++;
            q2_interp_calls++;
            remove_instance_running_local();""")
replace("            int fidx = instantiate_wasm();",
"""            q2_promotions++;
            int fidx = instantiate_wasm();""")
p.write_text(s)
print("Q2: installed low-frequency WASM JIT dispatch/cache profiling")
