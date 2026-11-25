# Q2 hardware integration (experimental)

Run the runtime laboratory with a locally selected update.tar or rootfs.squashfs and opt into firmware launch. The guest mounts the firmware read-only, adds a 32 MiB ephemeral OverlayFS upper layer, creates device stand-ins, installs the prebuilt firmware shim and starts the hardware bridge. The firmware image is not uploaded to a server.

Transport: QEMU virtfs local backend, virtio 9p guest mount tagged q2bridge. Atomic frame publication uses frame.tmp -> frame; input uses input.tmp -> input and guest unlink as acknowledgement. Frame header Q2F1, blank byte and 480000 BGRA bytes. Input header device byte and LE16 payload size followed by MIPS32 input_event records. Browser polls at 40 ms. This protocol is experimental; QEMU-Wasm 9p and cross-thread visibility must be tested. No hardware bridge readiness is inferred from a Linux boot marker.

Diagnostics: download q2-session.log from the runtime page. Include the Q2_FW mount/ABI/bridge/demo markers and QEMU errors when reporting failures. First framebuffer may be blank and does not prove demo has drawn. Frame/input counts are reported every five seconds.

Checks: node wasm/hardware-test.mjs; guest Docker build compiles bridge with -Wall -Wextra -Werror. Browser Linux smoke remains a separate gate. Firmware launch and actual frame/input round trip require further verification with real firmware. The existing desktop serial-number patch, backlight symbol setup, watchdog and additional peripheral stand-ins are not yet ported. Audio, SD, persistence and production deployment remain pending.
