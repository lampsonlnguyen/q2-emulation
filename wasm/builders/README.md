# Preserved build dependencies

Publish the versioned GHCR builder images using the **Publish preserved Q2 builders** workflow. This is a bootstrap operation requiring upstream network access. Existing tags are skipped; change the version deliberately to refresh dependencies.

The guest images retain Linux and BusyBox source archives, observed SHA256 sums, installed package inventory, and compiled BusyBox. The WASM image retains pinned QEMU source (0ef7b4e2814b231705d8371dd7997f5b72e70baf), Meson subprojects, Emscripten toolchain, compiled libraries, and browser npm packages. Subsequent guest and QEMU compilation disables network access; missing dependencies fail explicitly rather than silently downloading replacements.

Pull the images (authenticate if package visibility requires it):

```sh
bash wasm/builders/pull.sh
docker save q2-guest-builder:6.6.100-v1 q2-wasm-builder:v1 | gzip > q2-builders-v1.tar.gz
# Restore from NAS backup:
gzip -dc q2-builders-v1.tar.gz | docker load
bash wasm/build-mips.sh
bash wasm/assemble-runtime.sh
```

For the older kernel use Q2_LINUX_VERSION=5.15.180 and preserve its guest image too. Record registry digests using docker image inspect. No proprietary Q2 firmware is included; the firmware test downloads its pinned input separately. Browser installation, native test packages, Docker hosting base images and GitHub Actions infrastructure still have external dependencies. Initial source checksums are recorded rather than independently authenticated. The bootstrap workflow must succeed before downstream builds can work. Registry packages may need access granted in package settings. 
