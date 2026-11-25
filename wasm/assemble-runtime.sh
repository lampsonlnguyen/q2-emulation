#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p build/guest web/runtime/vendor build/browser-tools
if [[ "${Q2_SKIP_GUEST_BUILD:-0}" != 1 ]]; then
  docker build --build-arg "LINUX_VERSION=${Q2_LINUX_VERSION:-6.6.100}" --output type=local,dest=build/guest -f wasm/guest/Dockerfile .
fi
cp build/guest/{vmlinux,initramfs.cpio.gz} web/runtime/
cp build/wasm-mips/{out.js,qemu-system-mipsel.wasm,qemu-system-mipsel.worker.js,manifest.json,COPYING,backend.txt} web/runtime/
npm install --prefix build/browser-tools --no-audit --no-fund fflate@0.8.2 xterm@5.3.0 xterm-pty@0.10.1 playwright@1.51.1
cp build/browser-tools/node_modules/xterm/lib/xterm.js web/runtime/vendor/
cp build/browser-tools/node_modules/xterm/css/xterm.css web/runtime/vendor/
cp build/browser-tools/node_modules/xterm-pty/index.js web/runtime/vendor/xterm-pty.js
cp build/browser-tools/node_modules/fflate/esm/browser.js web/runtime/vendor/fflate.mjs
cp wasm/browser-smoke.mjs build/browser-tools/
