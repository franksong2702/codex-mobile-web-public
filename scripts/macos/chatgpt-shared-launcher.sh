#!/bin/bash
set -euo pipefail

mode="${1:---interactive}"
case "$mode" in
  --interactive|--login) ;;
  *) echo "usage: $0 [--interactive|--login]" >&2; exit 2 ;;
esac

# Finder launches GUI apps with a minimal PATH. Include the known local Node
# locations before delegating to the shared Desktop launcher.
export PATH="${CHATGPT_SHARED_PATH:-$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"

support_dir="${CHATGPT_SHARED_SUPPORT_DIR:-$HOME/Library/Application Support/ChatGPT Shared}"
repo_dir="${CODEX_MOBILE_REPO_DIR:-/Users/xuefusong/Developer/maintenance/codex-mobile-web-public}"
desktop_launcher="$repo_dir/start-codex-desktop-shared-macos.sh"
endpoint_file="${CODEX_MUX_ENDPOINT_FILE:-$HOME/.codex/app-server-mux/endpoint.json}"
log_file="$support_dir/launcher.log"
app_executable="${CHATGPT_SHARED_APP_EXECUTABLE:-/Applications/ChatGPT.app/Contents/MacOS/ChatGPT}"

mkdir -p "$support_dir"
chmod 700 "$support_dir"
exec >>"$log_file" 2>&1
chmod 600 "$log_file"

timestamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { printf '%s %s\n' "$(timestamp)" "$*"; }

chatgpt_running() {
  /bin/ps -axo args= | /usr/bin/awk -v target="$app_executable" '
    $0 == target { found = 1 }
    END { exit found ? 0 : 1 }
  '
}

endpoint_ready() {
  [[ -r "$endpoint_file" ]] || return 1
  local port
  port="$(/usr/bin/python3 - "$endpoint_file" <<'PY' 2>/dev/null
import json, sys
try:
    value = json.load(open(sys.argv[1], encoding="utf-8"))
    port = int(value.get("port", 0))
    print(port if 0 < port < 65536 else "")
except Exception:
    print("")
PY
)"
  [[ "$port" =~ ^[0-9]+$ ]] && /usr/bin/nc -z -w 2 127.0.0.1 "$port" >/dev/null 2>&1
}

notify_failure() {
  [[ "$mode" == "--interactive" ]] || return 0
  /usr/bin/osascript -e 'display notification "共享 Server 未能启动，请查看 ChatGPT Shared 日志" with title "ChatGPT Shared"' >/dev/null 2>&1 || true
}

if chatgpt_running && endpoint_ready; then
  log "already-ready"
  exit 0
fi

if [[ "$mode" == "--login" ]] && chatgpt_running; then
  for _ in 1 2 3 4 5; do
    sleep 2
    if endpoint_ready; then
      log "login-existing-became-ready"
      exit 0
    fi
  done
fi

args=()
if chatgpt_running; then
  args+=(--force-quit)
fi

log "launch-request mode=$mode force_quit=$([[ ${#args[@]} -gt 0 ]] && echo true || echo false)"
launch_desktop() {
  # macOS Bash 3.2 treats an empty array expansion as unbound under set -u.
  if [[ ${#args[@]} -gt 0 ]]; then
    "$desktop_launcher" "${args[@]}"
  else
    "$desktop_launcher"
  fi
}

if ! launch_desktop; then
  log "launch-failed"
  notify_failure
  exit 1
fi

for _ in $(seq 1 30); do
  if endpoint_ready; then
    log "shared-ready"
    exit 0
  fi
  sleep 1
done

log "endpoint-timeout"
notify_failure
exit 1
