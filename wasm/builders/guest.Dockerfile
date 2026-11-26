FROM ubuntu:24.04 AS dependencies
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gcc-mipsel-linux-gnu libc6-dev-mipsel-cross build-essential bc bison flex libssl-dev libelf-dev cpio curl xz-utils bzip2 ca-certificates kmod python3
ARG LINUX_VERSION=6.6.100
ARG BUSYBOX_VERSION=1.36.1
WORKDIR /work
RUN mkdir -p /sources && curl -fsSL --retry 3 -o /sources/linux-${LINUX_VERSION}.tar.xz https://cdn.kernel.org/pub/linux/kernel/v${LINUX_VERSION%%.*}.x/linux-${LINUX_VERSION}.tar.xz && tar -xJf /sources/linux-${LINUX_VERSION}.tar.xz
RUN set -e; \
    archive="/sources/busybox-${BUSYBOX_VERSION}.tar.bz2"; \
    (curl -fsSL --connect-timeout 15 --max-time 90 --retry 2 -o "$archive" "https://busybox.net/downloads/busybox-${BUSYBOX_VERSION}.tar.bz2" || \
     curl -fsSL --connect-timeout 15 --max-time 90 --retry 2 -o "$archive" "https://sources.buildroot.net/busybox/busybox-${BUSYBOX_VERSION}.tar.bz2"); \
    tar -xjf "$archive" && sha256sum /sources/* > /sources/SHA256SUMS
RUN mkdir -p /rootfs/{bin,dev,proc,sys,tmp,mnt,run,etc} /out
WORKDIR /work/busybox-${BUSYBOX_VERSION}
RUN make ARCH=mips CROSS_COMPILE=mipsel-linux-gnu- defconfig && sed -i 's/# CONFIG_STATIC is not set/CONFIG_STATIC=y/; s/CONFIG_TC=y/# CONFIG_TC is not set/' .config && make ARCH=mips CROSS_COMPILE=mipsel-linux-gnu- CC=mipsel-linux-gnu-gcc -j2 && make ARCH=mips CROSS_COMPILE=mipsel-linux-gnu- CC=mipsel-linux-gnu-gcc CONFIG_PREFIX=/rootfs install && LC_ALL=C mipsel-linux-gnu-readelf -h /rootfs/bin/busybox > /tmp/busybox-elf && cat /tmp/busybox-elf && grep -Eq 'Class:[[:space:]]+ELF32' /tmp/busybox-elf && grep -Eq 'Machine:[[:space:]]+MIPS' /tmp/busybox-elf && grep -q 'little endian' /tmp/busybox-elf && mipsel-linux-gnu-readelf -A /rootfs/bin/busybox && mipsel-linux-gnu-readelf -l /rootfs/bin/busybox > /tmp/busybox-phdr && ! grep -q INTERP /tmp/busybox-phdr

RUN dpkg-query -W > /sources/packages.txt
