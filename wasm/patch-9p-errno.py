#!/usr/bin/env python3
"""Translate Emscripten/WASI errno values to the MIPS Linux guest ABI.

QEMU-WASM passes host errno through unchanged. See TryNix's related
9p errno fix (https://github.com/fzakaria/trynix) and Linux's
arch/mips/include/uapi/asm/errno.h. Unlike x86 Linux, MIPS has different
numbers above 34; this patch is only applied by the mipsel build.
"""
from pathlib import Path
import sys

path = Path(sys.argv[1]) / "hw/9pfs/9p-util.h"
source = path.read_text()
anchor = "#if defined(CONFIG_LINUX) || defined(EMSCRIPTEN)\n    /* nothing to translate (Linux -> Linux) */"
# POSIX names, not host numbers: the compiler resolves the WASI values.
mapping = {
    "EPERM": 1, "ENOENT": 2, "ESRCH": 3, "EINTR": 4, "EIO": 5,
    "ENXIO": 6, "E2BIG": 7, "ENOEXEC": 8, "EBADF": 9, "ECHILD": 10,
    "EAGAIN": 11, "ENOMEM": 12, "EACCES": 13, "EFAULT": 14,
    "EBUSY": 16, "EEXIST": 17, "EXDEV": 18, "ENODEV": 19,
    "ENOTDIR": 20, "EISDIR": 21, "EINVAL": 22, "ENFILE": 23,
    "EMFILE": 24, "ENOTTY": 25, "ETXTBSY": 26, "EFBIG": 27,
    "ENOSPC": 28, "ESPIPE": 29, "EROFS": 30, "EMLINK": 31,
    "EPIPE": 32, "EDOM": 33, "ERANGE": 34, "ENOMSG": 35,
    "EIDRM": 36, "EDEADLK": 45, "ENOLCK": 46, "ENODATA": 61,
    "ETIME": 62, "ENOLINK": 67, "EPROTO": 71, "EMULTIHOP": 74,
    "EBADMSG": 77, "ENAMETOOLONG": 78, "EOVERFLOW": 79,
    "EILSEQ": 88, "ENOSYS": 89, "ELOOP": 90, "ENOTEMPTY": 93,
    "ENOTSOCK": 95, "EDESTADDRREQ": 96, "EMSGSIZE": 97,
    "EPROTOTYPE": 98, "ENOPROTOOPT": 99, "EPROTONOSUPPORT": 120,
    "EOPNOTSUPP": 122, "EAFNOSUPPORT": 124, "EADDRINUSE": 125,
    "EADDRNOTAVAIL": 126, "ENETDOWN": 127, "ENETUNREACH": 128,
    "ENETRESET": 129, "ECONNABORTED": 130, "ECONNRESET": 131,
    "ENOBUFS": 132, "EISCONN": 133, "ENOTCONN": 134,
    "ETIMEDOUT": 145, "ECONNREFUSED": 146, "EHOSTUNREACH": 148,
    "EALREADY": 149, "EINPROGRESS": 150, "ESTALE": 151,
    "ECANCELED": 158, "EOWNERDEAD": 165, "ENOTRECOVERABLE": 166,
    "EDQUOT": 1133,
}
# Use if statements because some libc errno macros are aliases.
lines = ["#if defined(EMSCRIPTEN)", "    if (err == 0) return 0;"]
for name, value in mapping.items():
    lines += [f"#ifdef {name}", f"    if (err == {name}) return {value};", "#endif"]
lines += ["#ifdef ENOTSUP", "    if (err == ENOTSUP) return 122;", "#endif",
          "    return 5; /* unmapped host error: guest EIO */",
          "#elif defined(CONFIG_LINUX)", "    /* native Linux host */"]
if source.count(anchor) != 1:
    raise SystemExit("Unsupported upstream 9p errno translation layout")
path.write_text(source.replace(anchor, "\n".join(lines), 1))
print("Q2: translated Emscripten 9p errno values to MIPS Linux ABI")

# Emscripten exposes O_PATH in its headers but MEMFS does not implement the
# Linux O_PATH + /proc/self/fd chmod semantics. Use QEMU's portable fd-based
# fallback, retaining O_NOFOLLOW and the regular-file/directory checks.
source = path.read_text()
anchor = "#ifdef O_PATH\n#define O_PATH_9P_UTIL O_PATH"
replacement = "#if defined(O_PATH) && !defined(EMSCRIPTEN) && !defined(__EMSCRIPTEN__)\n#define O_PATH_9P_UTIL O_PATH"
if source.count(anchor) != 1:
    raise SystemExit("Unsupported upstream 9p O_PATH layout")
path.write_text(source.replace(anchor, replacement, 1))
print("Q2: use portable 9p file descriptor operations on Emscripten")
