FROM ubuntu:24.04 AS guest
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gcc-mipsel-linux-gnu libc6-dev-mipsel-cross build-essential bc bison flex libssl-dev libelf-dev cpio curl xz-utils bzip2 ca-certificates kmod
ARG LINUX_VERSION=6.6.100
ARG BUSYBOX_VERSION=1.36.1
WORKDIR /work
RUN curl -fL --retry 3 https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-${LINUX_VERSION}.tar.xz | tar -xJ
RUN curl -fL --retry 3 https://busybox.net/downloads/busybox-${BUSYBOX_VERSION}.tar.bz2 | tar -xj
RUN mkdir -p /rootfs/{bin,dev,proc,sys,tmp,mnt,run,etc} /out
WORKDIR /work/busybox-${BUSYBOX_VERSION}
RUN make defconfig && sed -i 's/# CONFIG_STATIC is not set/CONFIG_STATIC=y/; s/CONFIG_TC=y/# CONFIG_TC is not set/' .config && make ARCH=mips CROSS_COMPILE=mipsel-linux-gnu- -j2 && make CONFIG_PREFIX=/rootfs install
COPY wasm/guest/init /rootfs/init
COPY wasm/guest/launch-firmware /rootfs/bin/launch-firmware
COPY wasm/guest/hardware-bridge.c /work/hardware-bridge.c
COPY wasm/guest/firmware-patch.c /work/firmware-patch.c
COPY emulator/libq2emu.so emulator/libq2emu.so.sha256 emulator/shim.c /work/shim/
RUN cd /work/shim && echo "$(cat libq2emu.so.sha256)  shim.c" | sha256sum -c - && mkdir -p /rootfs/q2 && cp libq2emu.so /rootfs/q2/ && mipsel-linux-gnu-gcc -Wall -Wextra -Werror -O2 -static /work/hardware-bridge.c -o /rootfs/q2/hardware-bridge && mipsel-linux-gnu-gcc -Wall -Wextra -Werror -O2 -static /work/firmware-patch.c -o /rootfs/bin/firmware-patch && chmod 755 /rootfs/bin/launch-firmware
RUN chmod 755 /rootfs/init && mkdir -p /rootfs/dev /rootfs/proc /rootfs/sys /rootfs/tmp /rootfs/mnt /rootfs/run /rootfs/etc && mknod /rootfs/dev/console c 5 1 && mknod /rootfs/dev/null c 1 3 && cd /rootfs && find . -print0 | cpio --null -o -H newc | gzip -9 > /out/initramfs.cpio.gz
WORKDIR /work/linux-${LINUX_VERSION}
RUN make ARCH=mips CROSS_COMPILE=mipsel-linux-gnu- malta_defconfig && scripts/config --enable CPU_LITTLE_ENDIAN --disable CPU_BIG_ENDIAN --enable BLK_DEV_INITRD --enable RD_GZIP --enable DEVTMPFS --enable DEVTMPFS_MOUNT --enable SQUASHFS --enable SQUASHFS_XZ --enable SQUASHFS_ZLIB --enable BLK_DEV_LOOP --enable NET_9P --enable NET_9P_VIRTIO --enable 9P_FS --enable VIRTIO --enable VIRTIO_PCI --enable OVERLAY_FS --enable TMPFS --enable SCSI --enable BLK_DEV_SD --enable ATA --enable ATA_PIIX --enable PATA_MPIIX --enable SERIAL_8250 --enable SERIAL_8250_CONSOLE --disable DEBUG_INFO && make ARCH=mips CROSS_COMPILE=mipsel-linux-gnu- olddefconfig && make ARCH=mips CROSS_COMPILE=mipsel-linux-gnu- -j2 vmlinux && mipsel-linux-gnu-strip -g vmlinux -o /out/vmlinux
FROM scratch
COPY --from=guest /out/ /
