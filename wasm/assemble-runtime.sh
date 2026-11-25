#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p build/guest web/runtime/vendor build/browser-tools
docker build --output type=local,dest=build/guest wasm/guest
cp build/guest/{vmlinux,initramfs.cpio.gz} web/runtime/
cp build/wasm-mips/{out.js,qemu-system-mipsel.wasm,qemu-system-mipsel.worker.js,manifest.json,COPYING} web/runtime/
npm install --prefix build/browser-tools --no-audit --no-fund xterm@5.3.0 xterm-pty@0.10.1 playwright@1.51.1
cp build/browser-tools/node_modules/xterm/lib/xterm.js web/runtime/vendor/
cp build/browser-tools/node_modules/xterm/css/xterm.css web/runtime/vendor/
cp build/browser-tools/node_modules/xterm-pty/index.js web/runtime/vendor/xterm-pty.js
cp wasm/browser-smoke.mjs build/browser-tools/
