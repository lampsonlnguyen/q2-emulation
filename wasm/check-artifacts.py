"""Static build-output check; does not execute guest instructions."""
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
names = ["out.js", "qemu-system-mipsel.wasm", "qemu-system-mipsel.worker.js",
         "upstream-commit.txt", "qemu-version.txt", "COPYING"]
manifest = {}
for name in names:
    path = root / name
    data = path.read_bytes()
    if not data:
        raise SystemExit(f"Empty artifact: {name}")
    if name.endswith(".wasm") and data[:8] != b"\x00asm\x01\x00\x00\x00":
        raise SystemExit("Invalid WASM magic/version")
    manifest[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
(root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print("Static artifact checks passed; guest execution not tested.")
