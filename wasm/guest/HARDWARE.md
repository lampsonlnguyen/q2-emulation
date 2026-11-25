# Experimental Q2 hardware bridge

This branch deliberately does not change the M2/M3 browser boot workflow. The desktop emulator uses a 320x375 BGRA double buffer, displayed after 90-degree counterclockwise rotation as 375x320. The JS codec matches that convention (not the physical shell orientation), and encodes 16-byte MIPS32 input events, including SYN_REPORT and wheel pressure samples.

The guest C bridge is intended to run inside a writable firmware chroot with an inherited raw bidirectional serial FD, separately from the Linux console. It listens on the same four Unix sockets as the existing shim. It sends changed frames only; the uncompressed 480000-byte frame is a correctness prototype, not a practical high-speed UART design. A faster transport or compression/deltas will be required.

Local codec check: node wasm/hardware-test.mjs
Guest compile check: mipsel-linux-gnu-gcc -Wall -Wextra -Werror -O2 -static wasm/guest/hardware-bridge.c -o hardware-bridge

Remaining integration: confirm QEMU-Wasm exposes a second bidirectional transport; wire browser frame parser and controls, enable writable firmware overlay, prepare device stand-ins and proc/sys mounts, build and preload the existing firmware-linked shim, validate framebuffer/input on real firmware. The current branch does not launch this bridge or claim the firmware UI works.
