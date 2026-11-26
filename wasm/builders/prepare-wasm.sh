#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git clone https://github.com/ktock/qemu-wasm.git "$work/qemu"
git -C "$work/qemu" checkout --detach 0ef7b4e2814b231705d8371dd7997f5b72e70baf
sed 's|curl -Ls https://zlib.net/zlib-\$ZLIB_VERSION.tar.xz |curl -fLsS --retry 3 https://zlib.net/fossils/zlib-$ZLIB_VERSION.tar.gz |; s|tar xJC /zlib|tar xzC /zlib|' "$work/qemu/Dockerfile" > "$work/Dockerfile"
docker build -t q2-wasm-toolchain:v1 - < "$work/Dockerfile"
# Warm the exact target's configure dependencies and compiler cache.
container=$(docker run -d -v "$work/qemu:/qemu:rw" q2-wasm-toolchain:v1)
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
flags='-O3 -g -Wno-error=unused-command-line-argument -matomics -mbulk-memory -DNDEBUG -DG_DISABLE_ASSERT -D_GNU_SOURCE -sASYNCIFY=1 -pthread -sPROXY_TO_PTHREAD=1 -sFORCE_FILESYSTEM -sALLOW_TABLE_GROWTH -sTOTAL_MEMORY=2300MB -sWASM_BIGINT -sMALLOC=mimalloc --js-library=/build/node_modules/xterm-pty/emscripten-pty.js -sEXPORT_ES6=1 -sASYNCIFY_IMPORTS=ffi_call_js'
docker exec "$container" emconfigure /qemu/configure --static --target-list=mipsel-softmmu --cpu=wasm32 --disable-tcg-interpreter --cross-prefix= --without-default-features --enable-system --with-coroutine=fiber --enable-virtfs --extra-cflags="$flags" --extra-cxxflags="$flags" --extra-ldflags="-sEXPORTED_RUNTIME_METHODS=getTempRet0,setTempRet0,addFunction,removeFunction,TTY,FS"
docker exec "$container" emmake make -j "${JOBS:-2}" qemu-system-mipsel
# Copy warmed source including Meson subprojects and git submodules into image.
docker exec "$container" cp -a /qemu /q2-source
docker exec "$container" sh -c 'rm -rf /build/meson-private /build/meson-info /build/meson-logs /build/build.ninja /build/config-host.mak /build/config-host.h /build/Makefile; mkdir -p /q2-browser-tools; npm install --prefix /q2-browser-tools --no-audit --no-fund fflate@0.8.2 xterm@5.3.0 xterm-pty@0.10.1 playwright@1.51.1'
# Use a clean build directory with preserved toolchain and npm modules. Keep
# /build/target and /build/node_modules paths expected by QEMU.
docker commit "$container" q2-wasm-builder:v1
