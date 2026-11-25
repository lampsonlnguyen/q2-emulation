# M2: experimental MIPS WebAssembly runtime

This is a build experiment, not a working Q2 browser emulator. The upstream [QEMU-Wasm README](https://github.com/ktock/qemu-wasm) documents x86_64, aarch64 and riscv64 system builds. This experiment substitutes mipsel-softmmu, preserving upstream compiler flags and Docker toolchain (Emscripten 3.1.50). The desktop emulator uses QEMU 11.1.3 linux-user; this fork is not assumed to match that version.

## Run

On Linux with Docker, Git and Python 3:

    bash wasm/build-mips.sh

Set QEMU_WASM_REF to a known upstream commit to reproduce the source revision, JOBS to control parallelism, and Q2_WASM_OUT to override the output directory. The default follows upstream master and records the resolved SHA; external dependency availability is not guaranteed. CI uploads an experimental runtime artifact, separate from the Pages artifact.

## Acceptance gates

- Configure and compile mipsel-softmmu using the upstream Wasm TCG backend.
- Validate the generated WASM header and expected JS/worker files; record hashes and source revision.
- Instantiate the runtime in a cross-origin-isolated browser and verify machine startup.
- Execute known little-endian MIPS guest instructions and verify serial output.
- Validate Q2 ABI requirements (MIPS32r2, floating-point ABI and NaN mode) before attempting firmware boot.

Only the first two gates are automated here, and neither has been demonstrated successful until CI completes. Static checks are not a CPU execution smoke test. M3 will build a minimal Linux guest and connect serial output. The upstream 2300 MB WASM memory setting is host runtime memory, not Q2 guest RAM; a lower tested host allocation and a 128 MB guest are eventual targets. GitHub Pages cross-origin isolation and browser compatibility remain unresolved. No binaries are published to Pages in M2. Before public redistribution, provide corresponding source and satisfy upstream license obligations.
