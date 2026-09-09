#!/bin/bash
set -euo pipefail

MODE="${1:---check}"
SERVICE="com.xuefusong.codex-mobile.voxspark-queue"
ACCOUNT="${USER:-$(id -un)}"

case "$MODE" in
  --check)
    if /usr/bin/security find-generic-password -a "$ACCOUNT" -s "$SERVICE" -w >/dev/null 2>&1; then
      printf 'VoxSpark Queue encryption key is available in macOS Keychain.\n'
      exit 0
    fi
    printf 'VoxSpark Queue encryption key is missing from macOS Keychain.\n' >&2
    exit 1
    ;;
  --apply)
    if /usr/bin/security find-generic-password -a "$ACCOUNT" -s "$SERVICE" -w >/dev/null 2>&1; then
      printf 'VoxSpark Queue encryption key already exists; no change made.\n'
      exit 0
    fi
    KEY="$(/usr/bin/openssl rand -base64 32 | tr -d '\n')"
    /usr/bin/security add-generic-password -U -a "$ACCOUNT" -s "$SERVICE" -w "$KEY" >/dev/null
    unset KEY
    printf 'VoxSpark Queue encryption key created in macOS Keychain.\n'
    ;;
  *)
    printf 'Usage: %s [--check|--apply]\n' "$0" >&2
    exit 2
    ;;
esac
