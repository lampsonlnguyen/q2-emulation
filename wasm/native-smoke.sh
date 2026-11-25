#!/usr/bin/env bash
set -euo pipefail
log=native-boot.log
qemu-system-mipsel -M malta -cpu 24Kf -m 128M -smp 1 -nodefaults -display none -vga none -serial stdio -serial null -serial null -monitor none -nic none -no-reboot -kernel build/guest/vmlinux -initrd build/guest/initramfs.cpio.gz -append 'console=ttyS0,115200 rdinit=/init ieee754=relaxed panic=0 ignore_loglevel printk.time=1' > "$log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; cat "$log"' EXIT
for ((i=0;i<120;i++)); do
    if grep -q Q2_GUEST_READY "$log" && grep -q Q2_GUEST_IDLE "$log"; then
        echo "Native userspace verified"; exit 0
    fi
    if grep -q 'Kernel panic' "$log" || ! kill -0 "$pid" 2>/dev/null; then
        echo "Native guest failed"; exit 1
    fi
    sleep 1
done
echo "Native guest timed out"; exit 1
