#!/usr/bin/env bash
set -euo pipefail
prefix="${Q2_BUILDER_REGISTRY:-ghcr.io/lampsonlnguyen/q2-emulation}"
kernel="${Q2_LINUX_VERSION:-6.6.100}"
for spec in "guest-builder:$kernel-v1" "wasm-builder:v1"; do
  local="q2-$spec"
  if ! docker image inspect "$local" >/dev/null 2>&1; then
    if ! docker pull "$prefix/$spec"; then
      echo "Required builder not yet published: $prefix/$spec" >&2
      exit 1
    fi
    docker tag "$prefix/$spec" "$local"
  fi
done
