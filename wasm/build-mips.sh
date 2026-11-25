#!/usr/bin/env bash
set -euo pipefail
# Run from any directory; upstream ref may be overridden with a commit SHA.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
container=""
cleanup() { if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi; rm -rf "$work"; }
trap cleanup EXIT
out="${Q2_WASM_OUT:-$root/build/wasm-mips}"
mkdir -p "$out"
git clone https://github.com/ktock/qemu-wasm.git "$work/qemu"
git -C "$work/qemu" checkout --detach "${QEMU_WASM_REF:-origin/master}"
git -C "$work/qemu" submodule update --init --recursive
git -C "$work/qemu" rev-parse HEAD > "$out/upstream-commit.txt"
cp "$work/qemu/VERSION" "$out/qemu-version.txt"
docker build -t q2-wasm-build - < "$work/qemu/Dockerfile"
container="$(docker run -d --rm -v "$work/qemu:/qemu:ro" q2-wasm-build)"
flags='-O3 -g -Wno-error=unused-command-line-argument -matomics -mbulk-memory -DNDEBUG -DG_DISABLE_ASSERT -D_GNU_SOURCE -sASYNCIFY=1 -pthread -sPROXY_TO_PTHREAD=1 -sFORCE_FILESYSTEM -sALLOW_TABLE_GROWTH -sTOTAL_MEMORY=2300MB -sWASM_BIGINT -sMALLOC=mimalloc --js-library=/build/node_modules/xterm-pty/emscripten-pty.js -sEXPORT_ES6=1 -sASYNCIFY_IMPORTS=ffi_call_js'
docker exec "$container" emconfigure /qemu/configure --static --target-list=mipsel-softmmu --cpu=wasm32 --cross-prefix= --without-default-features --enable-system --with-coroutine=fiber --enable-virtfs --extra-cflags="$flags" --extra-cxxflags="$flags" --extra-ldflags="-sEXPORTED_RUNTIME_METHODS=getTempRet0,setTempRet0,addFunction,removeFunction,TTY,FS"
docker exec "$container" emmake make -j "${JOBS:-2}" qemu-system-mipsel
docker cp "$container:/build/qemu-system-mipsel" "$out/out.js"
docker cp "$container:/build/qemu-system-mipsel.wasm" "$out/"
docker cp "$container:/build/qemu-system-mipsel.worker.js" "$out/"
cp "$work/qemu/COPYING" "$out/"
python3 "$root/wasm/check-artifacts.py" "$out"
