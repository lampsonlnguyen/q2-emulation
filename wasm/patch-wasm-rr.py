#!/usr/bin/env python3
"""Mirror upstream MTTCG WASM initialization in its round-robin CPU thread."""
import pathlib
import sys

path = pathlib.Path(sys.argv[1]) / "accel/tcg/tcg-accel-ops-rr.c"
source = path.read_text()
if "init_wasm32();" not in source:
    anchor = "static void *rr_cpu_thread_fn(void *arg)"
    old = "    CPUState *cpu = arg;\n"
    guard = "#if defined(EMSCRIPTEN) && !defined(CONFIG_TCG_INTERPRETER)\n"
    if source.count(anchor) != 1:
        raise SystemExit("Unsupported upstream RR thread layout")
    before, after = source.split(anchor, 1)
    if after.count(old) != 1:
        raise SystemExit("Unsupported upstream RR CPU initialization")
    source = before + guard + '#include "../../tcg/wasm32.h"\n#endif\n' + anchor + after.replace(old, old + "\n" + guard + "    init_wasm32();\n#endif\n", 1)
    path.write_text(source)
print("Q2: RR WASM translation state initialization present")
