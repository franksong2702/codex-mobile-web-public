#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="${CODEX_MOBILE_LAUNCHD_LABEL:-com.xuefusong.codex-mobile-web.8789}"
PLIST_PATH="${CODEX_MOBILE_LAUNCHD_PLIST:-$HOME/Library/LaunchAgents/$LABEL.plist}"
CODEX_HOME_VALUE="${CODEX_HOME:-$HOME/.codex}"
APP_PATH="${CODEX_DESKTOP_APP_PATH:-/Applications/ChatGPT.app}"
DESKTOP_EXE="${CODEX_DESKTOP_EXE:-$APP_PATH/Contents/MacOS/ChatGPT}"
DESKTOP_BUNDLE_ID="${CODEX_DESKTOP_BUNDLE_ID:-}"
CODEX_EXE="${CODEX_MUX_CODEX_EXE:-$APP_PATH/Contents/Resources/codex}"
NODE_EXE="${CODEX_MUX_NODE_EXE:-$HOME/.local/bin/node}"
MUX_WRAPPER="$SCRIPT_DIR/codex-app-server-mux-macos.sh"
ENDPOINT_FILE="${CODEX_MUX_ENDPOINT_FILE:-$CODEX_HOME_VALUE/app-server-mux/endpoint.json}"
PORT="${CODEX_MOBILE_PORT:-8789}"
APPLY=0
TIMEOUT_SECONDS=45
BACKUP_PATH=""
LOG_PATH=""
PLIST_CHANGED=0
SERVICE_STOPPED=0
DESKTOP_STOPPED=0
SHARED_DESKTOP_STARTED=0

usage() {
  cat <<'EOF'
Usage: ./switch-codex-mobile-desktop-shared-macos.sh [--apply] [options]

Without --apply this command performs read-only preflight and prints the plan.

Options:
  --apply                 Perform the shared-mux switch
  --label <launchd-label> Codex Mobile LaunchAgent label
  --plist <path>          LaunchAgent plist path
  --app <path>            ChatGPT/Codex Desktop app bundle
  --desktop-exe <path>    Exact Desktop executable path
  --codex <path>          Bundled Codex executable
  --node <path>           Node executable used by the mux
  --codex-home <path>     Codex state directory
  --port <port>           Codex Mobile listener port
  --timeout <seconds>     Wait timeout, default 45
  -h, --help              Show this help
EOF
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

wait_until() {
  local description="$1"
  shift
  local deadline=$((SECONDS + TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    if "$@"; then return 0; fi
    sleep 1
  done
  fail "timed out waiting for $description"
}

desktop_pid() {
  local pid command_line
  while read -r pid command_line; do
    [[ -n "$pid" ]] || continue
    if [[ "$command_line" == "$DESKTOP_EXE" || "$command_line" == "$DESKTOP_EXE "* ]]; then
      printf '%s\n' "$pid"
      return 0
    fi
  done < <(ps -axo pid=,command= 2>/dev/null)
}

endpoint_field() {
  local field="$1"
  [[ -f "$ENDPOINT_FILE" ]] || return 1
  "$NODE_EXE" -e '
    const fs = require("fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[process.argv[2]];
    if (value === undefined || value === null || value === "") process.exit(1);
    process.stdout.write(String(value));
  ' "$ENDPOINT_FILE" "$field" 2>/dev/null
}

endpoint_is_ready() {
  local mux_pid child_pid host port
  mux_pid="$(endpoint_field pid 2>/dev/null || true)"
  child_pid="$(endpoint_field childPid 2>/dev/null || true)"
  host="$(endpoint_field host 2>/dev/null || true)"
  port="$(endpoint_field port 2>/dev/null || true)"
  [[ "$mux_pid" =~ ^[0-9]+$ && "$child_pid" =~ ^[0-9]+$ && "$port" =~ ^[0-9]+$ ]] || return 1
  [[ "$host" == "127.0.0.1" ]] || return 1
  kill -0 "$mux_pid" 2>/dev/null || return 1
  kill -0 "$child_pid" 2>/dev/null || return 1
  "$NODE_EXE" -e '
    const net = require("net");
    const socket = net.createConnection({ host: process.argv[1], port: Number(process.argv[2]) });
    const timer = setTimeout(() => { socket.destroy(); process.exit(1); }, 1000);
    socket.once("connect", () => { clearTimeout(timer); socket.destroy(); process.exit(0); });
    socket.once("error", () => { clearTimeout(timer); process.exit(1); });
  ' "$host" "$port" >/dev/null 2>&1
}

desktop_uses_mux() {
  local main_pid mux_pid mux_ppid
  main_pid="$(desktop_pid)"
  mux_pid="$(endpoint_field pid 2>/dev/null || true)"
  [[ -n "$main_pid" && "$mux_pid" =~ ^[0-9]+$ ]] || return 1
  mux_ppid="$(ps -p "$mux_pid" -o ppid= 2>/dev/null | tr -d '[:space:]')"
  [[ "$mux_ppid" == "$main_pid" ]]
}

listener_is_ready() {
  [[ -f "$HOME/.codex-mobile-web/access_key" ]] || return 1
  local key
  key="$(cat "$HOME/.codex-mobile-web/access_key")"
  curl -fsS --max-time 2 -H "x-codex-mobile-key: $key" \
    "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1
}

shared_status_is_ready() {
  [[ -f "$HOME/.codex-mobile-web/access_key" ]] || return 1
  local key
  key="$(cat "$HOME/.codex-mobile-web/access_key")"
  curl -fsS --max-time 3 -H "x-codex-mobile-key: $key" "http://127.0.0.1:$PORT/api/status" \
    | "$NODE_EXE" -e '
      let data="";
      process.stdin.on("data", chunk => data += chunk);
      process.stdin.on("end", () => {
        const status = JSON.parse(data);
        process.exit(status.ready === true
          && status.transport === "external-jsonl-tcp"
          && status.sharedRequired === true ? 0 : 1);
      });
    ' >/dev/null 2>&1
}

plist_set_env() {
  local key="$1"
  local value="$2"
  if /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:$key" "$PLIST_PATH" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:$key $value" "$PLIST_PATH"
  else
    /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:$key string $value" "$PLIST_PATH"
  fi
}

plist_delete_env() {
  /usr/libexec/PlistBuddy -c "Delete :EnvironmentVariables:$1" "$PLIST_PATH" >/dev/null 2>&1 || true
}

quit_desktop() {
  osascript - "$DESKTOP_BUNDLE_ID" <<'APPLESCRIPT'
on run argv
  set targetBundleId to item 1 of argv
  tell application id targetBundleId to quit
end run
APPLESCRIPT
}

remove_stale_endpoint() {
  [[ -f "$ENDPOINT_FILE" ]] || return 0
  if endpoint_is_ready; then
    fail "a live mux endpoint remains after Desktop exit: $ENDPOINT_FILE"
  fi
  rm -f "$ENDPOINT_FILE"
}

restore_original_runtime() {
  local exit_code=$?
  trap - EXIT
  if [[ "$APPLY" -eq 1 && "$exit_code" -ne 0 ]]; then
    echo "Switch failed; restoring the original 8789 LaunchAgent and normal ChatGPT launch." >&2
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    if [[ "$PLIST_CHANGED" -eq 1 && -n "$BACKUP_PATH" && -f "$BACKUP_PATH" ]]; then
      cp "$BACKUP_PATH" "$PLIST_PATH"
    fi
    if [[ "$SHARED_DESKTOP_STARTED" -eq 1 ]]; then
      quit_desktop >/dev/null 2>&1 || true
      sleep 2
    fi
    if [[ "$SERVICE_STOPPED" -eq 1 ]]; then
      launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
    fi
    if [[ "$DESKTOP_STOPPED" -eq 1 && -z "$(desktop_pid)" ]]; then
      /usr/bin/open -n "$APP_PATH" >/dev/null 2>&1 || true
    fi
  fi
  [[ -z "$LOG_PATH" ]] || echo "Switch transcript: $LOG_PATH"
  exit "$exit_code"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --label) LABEL="${2:?--label requires a value}"; shift 2 ;;
    --plist) PLIST_PATH="${2:?--plist requires a value}"; shift 2 ;;
    --app) APP_PATH="${2:?--app requires a value}"; shift 2 ;;
    --desktop-exe) DESKTOP_EXE="${2:?--desktop-exe requires a value}"; shift 2 ;;
    --codex) CODEX_EXE="${2:?--codex requires a value}"; shift 2 ;;
    --node) NODE_EXE="${2:?--node requires a value}"; shift 2 ;;
    --codex-home) CODEX_HOME_VALUE="${2:?--codex-home requires a value}"; ENDPOINT_FILE="$CODEX_HOME_VALUE/app-server-mux/endpoint.json"; shift 2 ;;
    --port) PORT="${2:?--port requires a value}"; shift 2 ;;
    --timeout) TIMEOUT_SECONDS="${2:?--timeout requires a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -f "$PLIST_PATH" ]] || fail "LaunchAgent plist not found: $PLIST_PATH"
[[ -x "$DESKTOP_EXE" ]] || fail "Desktop executable not found: $DESKTOP_EXE"
[[ -x "$CODEX_EXE" ]] || fail "Codex executable not found: $CODEX_EXE"
[[ -x "$NODE_EXE" ]] || fail "Node executable not found: $NODE_EXE"
[[ -x "$MUX_WRAPPER" ]] || fail "Mux wrapper is not executable: $MUX_WRAPPER"
[[ -x "$SCRIPT_DIR/start-codex-desktop-shared-macos.sh" ]] || fail "Desktop shared launcher is not executable"
if [[ -z "$DESKTOP_BUNDLE_ID" ]]; then
  DESKTOP_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Contents/Info.plist" 2>/dev/null || true)"
fi
[[ "$DESKTOP_BUNDLE_ID" =~ ^[A-Za-z0-9.-]+$ ]] || fail "Desktop bundle identifier unavailable or invalid"

set +e
PROCESS_OUTPUT="$(ps -axo pid=,command= 2>/dev/null)"
PS_STATUS=$?
set -e
[[ "$PS_STATUS" -eq 0 ]] || fail "cannot read the process table for Desktop PID preflight"
CURRENT_DESKTOP_PID="$(desktop_pid)"

echo "Shared-runtime switch preflight:"
echo "  mode: $([[ "$APPLY" -eq 1 ]] && echo apply || echo read-only)"
echo "  launchd label: $LABEL"
echo "  listener port: $PORT"
echo "  Desktop PID: ${CURRENT_DESKTOP_PID:-not-running}"
echo "  mux wrapper command: $(basename "$MUX_WRAPPER")"
echo "  mux endpoint: $ENDPOINT_FILE"
echo "  current endpoint: $(endpoint_is_ready && echo live || echo absent-or-stale)"
echo "  target transport: external-jsonl-tcp"

if [[ "$APPLY" -eq 0 ]]; then
  "$SCRIPT_DIR/start-codex-desktop-shared-macos.sh" \
    --print-only \
    --app "$APP_PATH" \
    --desktop-exe "$DESKTOP_EXE" \
    --codex "$CODEX_EXE" \
    --node "$NODE_EXE" \
    --codex-home "$CODEX_HOME_VALUE" >/dev/null
  echo "Preflight passed: launcher resolves the mux as a PATH command; no process or configuration was changed."
  exit 0
fi

mkdir -p "$HOME/.codex-mobile-web/logs"
LOG_PATH="$HOME/.codex-mobile-web/logs/shared-switch-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_PATH") 2>&1

trap restore_original_runtime EXIT
BACKUP_PATH="${PLIST_PATH}.backup-$(date +%Y%m%d-%H%M%S)"
cp "$PLIST_PATH" "$BACKUP_PATH"

launchctl bootout "gui/$(id -u)/$LABEL"
SERVICE_STOPPED=1

if [[ -n "$CURRENT_DESKTOP_PID" ]]; then
  quit_desktop
  wait_until "Desktop to quit" bash -c "! kill -0 $CURRENT_DESKTOP_PID 2>/dev/null"
  DESKTOP_STOPPED=1
fi

remove_stale_endpoint

"$SCRIPT_DIR/start-codex-desktop-shared-macos.sh" \
  --app "$APP_PATH" \
  --desktop-exe "$DESKTOP_EXE" \
  --codex "$CODEX_EXE" \
  --node "$NODE_EXE" \
  --codex-home "$CODEX_HOME_VALUE"
SHARED_DESKTOP_STARTED=1

wait_until "Desktop-owned mux endpoint" endpoint_is_ready
wait_until "Desktop to own the mux process" desktop_uses_mux

PLIST_CHANGED=1
plist_delete_env CODEX_MOBILE_APP_SERVER_UNIX_SOCKET
plist_delete_env CODEX_MOBILE_APP_SERVER_WS
plist_delete_env CODEX_MOBILE_APP_SERVER_TCP
plist_set_env CODEX_HOME "$CODEX_HOME_VALUE"
plist_set_env CODEX_MOBILE_MUX_ENDPOINT_FILE "$ENDPOINT_FILE"
plist_set_env CODEX_MOBILE_REQUIRE_SHARED_APP_SERVER "1"
plist_set_env CODEX_MOBILE_DISABLE_OWNED_MUX "1"

launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
wait_until "8789 listener" listener_is_ready
wait_until "8789 shared mux transport" shared_status_is_ready

trap - EXIT
echo "Shared-runtime switch complete: transport=external-jsonl-tcp, sharedRequired=true"
echo "LaunchAgent backup: $BACKUP_PATH"
echo "Switch transcript: $LOG_PATH"
