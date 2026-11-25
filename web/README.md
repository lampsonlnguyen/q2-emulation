# Q2 Emulator Web Edition

M1 is a static landing page, not a working browser emulator. No firmware is distributed.

## Local preview

From the repository root:

```sh
mkdir -p web/assets
for name in window home cover-flow folder; do cp "docs/$name.png" web/assets/; done
python3 -m http.server 8000 --directory web
```

Open http://localhost:8000. Generated assets need not be committed.

## GitHub Pages

In Settings → Pages → Build and deployment, select GitHub Actions. Merge the branch to main, then run the Deploy Q2 web workflow if needed. Expected URL: https://lampsonlnguyen.github.io/q2-emulation/.

M2 will investigate MIPS QEMU-Wasm support and browser isolation requirements. No service worker is installed in M1.
