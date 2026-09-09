#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${CODEX_MUX_SCRIPT_PATH:-$SCRIPT_DIR/codex-app-server-mux.js}"
NODE_BIN="${CODEX_MUX_NODE_EXE:-node}"
REAL_CODEX_BIN="${CODEX_MUX_CODEX_EXE:-codex}"

is_app_server_invocation() {
  local args=("$@")
  local index=0
  while (( index < ${#args[@]} )); do
    case "${args[$index]}" in
      -c|--config|--enable|--disable)
        (( index + 1 < ${#args[@]} )) || return 1
        (( index += 2 ))
        ;;
      -c=*|--config=*|--enable=*|--disable=*)
        (( index += 1 ))
        ;;
      app-server)
        return 0
        ;;
      *)
        return 1
        ;;
    esac
  done
  return 1
}

if is_app_server_invocation "$@"; then
  exec "$NODE_BIN" "$SCRIPT" "$@"
fi

unset CODEX_CLI_PATH
unset CODEX_MUX_SCRIPT_PATH
unset CODEX_MUX_CODEX_EXE
unset CODEX_MUX_NODE_EXE
unset CODEX_MUX_CODEX_ARGS
unset CODEX_MUX_ENDPOINT_FILE
unset CODEX_MUX_RUNTIME_DIR
unset CODEX_MUX_LOG_FILE
unset CODEX_MUX_STANDALONE
unset CODEX_MUX_KEEP_ALIVE
unset CODEX_MUX_PUBLISH_ENDPOINT

exec "$REAL_CODEX_BIN" "$@"
