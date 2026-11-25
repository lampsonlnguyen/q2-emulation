#!/usr/bin/env bash
set -euo pipefail
# Run from any directory; upstream ref may be overridden with a commit SHA.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
container=""
cleanup() {
    local status=$?
    trap - EXIT
    if [[ -n "$container" ]]; then
        # Restore ownership before removing the container that created the files.
        docker exec "$container" chown -R "$(id -u):$(id -g)" /qemu || echo "Warning: could not restore temporary source ownership" >&2
        docker rm -f "$container" >/dev/null 2>&1 || true
    fi
    # Cleanup must not overwrite the actual build/validation exit status.
    rm -rf -- "$work" || echo "Warning: temporary source cleanup incomplete: $work" >&2
    exit "$status"
}
trap cleanup EXIT
out="${Q2_WASM_OUT:-$root/build/wasm-mips}"
mkdir -p "$out"
git clone https://github.com/ktock/qemu-wasm.git "$work/qemu"
git -C "$work/qemu" checkout --detach "${QEMU_WASM_REF:-origin/master}"
# Do not recursively fetch unrelated firmware ROM trees (EDK2, etc.).
# QEMU configure/Meson handles dependencies required by the selected target.
git -C "$work/qemu" rev-parse HEAD > "$out/upstream-commit.txt"
cp "$work/qemu/VERSION" "$out/qemu-version.txt"
# Malta creates an FPGA LCD virtual console unconditionally, even with
# -nodefaults and -display none. The headless WASM build has no vc backend.
# Keep the device and UART intact; discard only its diagnostic LCD output.
python3 - "$work/qemu/hw/mips/malta.c" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
source = path.read_text()
old = 'qemu_chr_new("fpga", "vc:320x200", NULL)'
new = 'qemu_chr_new("fpga", "null", NULL)'
if source.count(old) == 1:
    path.write_text(source.replace(old, new, 1))
elif source.count(new) != 1:
    raise SystemExit("Unsupported upstream Malta FPGA console layout")
print("Q2: Malta FPGA diagnostic console uses null backend")
PY
# Upstream initializes WASM translation state only in MTTCG. Icount uses RR.
backend="${Q2_TCG_BACKEND:-wasm}"
case "$backend" in
  wasm) python3 "$root/wasm/patch-wasm-rr.py" "$work/qemu"; backend_flags=(--disable-tcg-interpreter) ;;
  tci) backend_flags=(--enable-tcg-interpreter) ;;
  *) echo "Unknown TCG backend: $backend" >&2; exit 1 ;;
esac
printf '%s\n' "$backend" > "$out/backend.txt"
# Older zlib releases move to the official fossils archive.
# Use the gzip archive and fail explicitly on HTTP errors.
sed 's|curl -Ls https://zlib.net/zlib-\$ZLIB_VERSION.tar.xz |curl -fLsS --retry 3 https://zlib.net/fossils/zlib-$ZLIB_VERSION.tar.gz |; s|tar xJC /zlib|tar xzC /zlib|' "$work/qemu/Dockerfile" > "$work/Dockerfile"
docker build -t q2-wasm-build - < "$work/Dockerfile"
# Meson fetches required wrap dependencies into the disposable source tree.
container="$(docker run -d --rm -v "$work/qemu:/qemu:rw" q2-wasm-build)"
flags='-O3 -g -Wno-error=unused-command-line-argument -matomics -mbulk-memory -DNDEBUG -DG_DISABLE_ASSERT -D_GNU_SOURCE -sASYNCIFY=1 -pthread -sPROXY_TO_PTHREAD=1 -sFORCE_FILESYSTEM -sALLOW_TABLE_GROWTH -sTOTAL_MEMORY=2300MB -sWASM_BIGINT -sMALLOC=mimalloc --js-library=/build/node_modules/xterm-pty/emscripten-pty.js -sEXPORT_ES6=1 -sASYNCIFY_IMPORTS=ffi_call_js'
docker exec "$container" emconfigure /qemu/configure --static --target-list=mipsel-softmmu --cpu=wasm32 "${backend_flags[@]}" --cross-prefix= --without-default-features --enable-system --with-coroutine=fiber --enable-virtfs --extra-cflags="$flags" --extra-cxxflags="$flags" --extra-ldflags="-sEXPORTED_RUNTIME_METHODS=getTempRet0,setTempRet0,addFunction,removeFunction,TTY,FS"
docker exec "$container" emmake make -j "${JOBS:-2}" qemu-system-mipsel
docker cp "$container:/build/qemu-system-mipsel" "$out/out.js"
docker cp "$container:/build/qemu-system-mipsel.wasm" "$out/"
docker cp "$container:/build/qemu-system-mipsel.worker.js" "$out/"
cp "$work/qemu/COPYING" "$out/"
python3 "$root/wasm/check-artifacts.py" "$out"
