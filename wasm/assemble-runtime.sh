#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p build/guest web/runtime/vendor build/browser-tools
if [[ "${Q2_SKIP_GUEST_BUILD:-0}" != 1 ]]; then
  docker build --network none --build-arg "GUEST_BUILDER=q2-guest-builder:${Q2_LINUX_VERSION:-6.6.100}-v1" --build-arg "LINUX_VERSION=${Q2_LINUX_VERSION:-6.6.100}" --output type=local,dest=build/guest -f wasm/guest/Dockerfile .
fi
cp build/guest/{vmlinux,initramfs.cpio.gz} web/runtime/
cp build/wasm-mips/{out.js,qemu-system-mipsel.wasm,qemu-system-mipsel.worker.js,manifest.json,COPYING,backend.txt} web/runtime/
cid=$(docker create "${Q2_WASM_BUILDER:-q2-wasm-builder:v1}")
trap 'docker rm "$cid" >/dev/null 2>&1 || true' EXIT
docker cp "$cid:/q2-browser-tools/." build/browser-tools/
docker rm "$cid" >/dev/null
trap - EXIT
cp build/browser-tools/node_modules/xterm/lib/xterm.js web/runtime/vendor/
cp build/browser-tools/node_modules/xterm/css/xterm.css web/runtime/vendor/
cp build/browser-tools/node_modules/xterm-pty/index.js web/runtime/vendor/xterm-pty.js
cp build/browser-tools/node_modules/fflate/esm/browser.js web/runtime/vendor/fflate.mjs
cp wasm/browser-smoke.mjs build/browser-tools/
