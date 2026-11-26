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
builder="${Q2_WASM_BUILDER:-q2-wasm-builder:v1}"
docker image inspect "$builder" >/dev/null || { echo "Missing preserved WASM builder: $builder" >&2; exit 1; }
source_container=$(docker create "$builder")
docker cp "$source_container:/q2-source" "$work/qemu"
docker rm "$source_container" >/dev/null
if [[ -n "${QEMU_WASM_REF:-}" && "$QEMU_WASM_REF" != "$(git -C "$work/qemu" rev-parse HEAD)" ]]; then
    echo "Requested QEMU revision is not in this builder; publish a new builder version" >&2
    exit 1
fi
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
python3 "$root/wasm/patch-9p-errno.py" "$work/qemu"
# Upstream initializes WASM translation state only in MTTCG. Icount uses RR.
backend="${Q2_TCG_BACKEND:-wasm}"
case "$backend" in
  wasm)
    python3 "$root/wasm/patch-wasm-rr.py" "$work/qemu"
    # TCG i32 extracts must truncate to 32 bits before shifting. Using i64
    # shifts with a 32-bit shift distance leaks high bits and breaks sign
    # extraction (e.g. MIPS SEH/SEB used by kernel pointer arithmetic).
    python3 - "$work/qemu/tcg/wasm32/tcg-target.c.inc" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
source = path.read_text()
anchor = """    case TCG_TYPE_I32:
        rs = 32 - len;
        break;
    case TCG_TYPE_I64:
        rs = 64 - len;"""
replacement = """    case TCG_TYPE_I32:
        rs = 32 - len;
        tcg_wasm_out_op_global_get_r(s, arg1);
        tcg_wasm_out_op_i32_wrap_i64(s);
        if (rs > pos) {
            tcg_wasm_out_op_i32_const(s, rs - pos);
            tcg_wasm_out_op_i32_shl(s);
        }
        tcg_wasm_out_op_i32_const(s, rs);
        if (sign) {
            tcg_wasm_out_op_i32_shr_s(s);
            tcg_wasm_out_op_i64_extend_i32_s(s);
        } else {
            tcg_wasm_out_op_i32_shr_u(s);
            tcg_wasm_out_op_i64_extend_i32_u(s);
        }
        tcg_wasm_out_op_global_set_r(s, dest);
        return;
    case TCG_TYPE_I64:
        rs = 64 - len;"""
if source.count(anchor) != 1:
    raise SystemExit("Unsupported upstream WASM extract emitter layout")
path.write_text(source.replace(anchor, replacement, 1))
print("Q2: corrected WASM i32 bit-field extraction")
PY
    backend_flags=(--disable-tcg-interpreter)
    ;;
  tci) backend_flags=(--enable-tcg-interpreter) ;;
  *) echo "Unknown TCG backend: $backend" >&2; exit 1 ;;
esac
printf '%s\n' "$backend" > "$out/backend.txt"
# All dependencies and Meson downloads were retained in the builder.
container="$(docker run -d --rm --network none -v "$work/qemu:/qemu:rw" "$builder")"
# Emscripten 3.1.50 treats UTIME_NOW/UTIME_OMIT as ordinary nanoseconds.
# The seconds field is unspecified for these sentinels and can become NaN,
# poisoning MEMFS timestamps and crashing a subsequent fstat64 BigInt write.
docker exec -i "$container" python3 - <<'PY'
from pathlib import Path
p = Path("/emsdk/upstream/emscripten/src/library_syscall.js")
s = p.read_text()
old = """      atime = (seconds*1000) + (nanoseconds/(1000*1000));"""
new = """      atime = nanoseconds === 1073741823 ? Date.now() :
        nanoseconds === 1073741822 ? FS.stat(path).atime.getTime() :
        (seconds*1000) + (nanoseconds/(1000*1000));"""
old_m = """      mtime = (seconds*1000) + (nanoseconds/(1000*1000));"""
new_m = """      mtime = nanoseconds === 1073741823 ? Date.now() :
        nanoseconds === 1073741822 ? FS.stat(path).mtime.getTime() :
        (seconds*1000) + (nanoseconds/(1000*1000));"""
for a, b in ((old, new), (old_m, new_m)):
    if s.count(a) != 1:
        raise SystemExit("Unsupported Emscripten utimensat implementation")
    s = s.replace(a, b, 1)
anchor = "    FS.utime(path, atime, mtime);"
if s.count(anchor) != 1:
    raise SystemExit("Unsupported Emscripten timestamp write")
s = s.replace(anchor, "    if (!Number.isFinite(atime) || !Number.isFinite(mtime) || !Number.isFinite(new Date(atime).getTime()) || !Number.isFinite(new Date(mtime).getTime())) return -{{{ cDefs.EOVERFLOW }}};\n" + anchor, 1)
p.write_text(s)
print("Q2: Emscripten utimensat sentinel handling and timestamp validation")
PY
flags='-O3 -g -Wno-error=unused-command-line-argument -matomics -mbulk-memory -DNDEBUG -DG_DISABLE_ASSERT -D_GNU_SOURCE -sASYNCIFY=1 -pthread -sPROXY_TO_PTHREAD=1 -sFORCE_FILESYSTEM -sALLOW_TABLE_GROWTH -sTOTAL_MEMORY=2300MB -sWASM_BIGINT -sMALLOC=mimalloc --js-library=/build/node_modules/xterm-pty/emscripten-pty.js -sEXPORT_ES6=1 -sASYNCIFY_IMPORTS=ffi_call_js'
docker exec -w /build "$container" emconfigure /qemu/configure --static --target-list=mipsel-softmmu --cpu=wasm32 "${backend_flags[@]}" --cross-prefix= --without-default-features --enable-system --with-coroutine=fiber --enable-virtfs --extra-cflags="$flags" --extra-cxxflags="$flags" --extra-ldflags="-sEXPORTED_RUNTIME_METHODS=getTempRet0,setTempRet0,addFunction,removeFunction,TTY,FS"
docker exec "$container" emmake make -j "${JOBS:-2}" qemu-system-mipsel
docker cp "$container:/build/qemu-system-mipsel" "$out/out.js"
docker cp "$container:/build/qemu-system-mipsel.wasm" "$out/"
docker cp "$container:/build/qemu-system-mipsel.worker.js" "$out/"
cp "$work/qemu/COPYING" "$out/"
python3 "$root/wasm/check-artifacts.py" "$out"
