#!/bin/bash
set -euo pipefail

mode="${1:---apply}"
case "$mode" in
  --apply|--remove) ;;
  *) echo "usage: $0 [--apply|--remove]" >&2; exit 2 ;;
esac

repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
support_dir="$HOME/Library/Application Support/ChatGPT Shared"
bin_dir="$support_dir/bin"
log_dir="$support_dir/logs"
app_dir="$HOME/Applications/ChatGPT Shared.app"
contents_dir="$app_dir/Contents"
macos_dir="$contents_dir/MacOS"
resources_dir="$contents_dir/Resources"
label="com.xuefusong.chatgpt-shared-login"
agent="$HOME/Library/LaunchAgents/$label.plist"
uid="$(id -u)"

if [[ "$mode" == "--remove" ]]; then
  /bin/launchctl bootout "gui/$uid/$label" >/dev/null 2>&1 || true
  rm -rf "$app_dir"
  rm -f "$agent" "$bin_dir/chatgpt-shared-launcher.sh"
  echo "ChatGPT Shared launcher removed. ChatGPT and Codex Mobile were not stopped."
  exit 0
fi

test -x "$repo_dir/start-codex-desktop-shared-macos.sh"
test -r /Applications/ChatGPT.app/Contents/Resources/icon-chatgpt.icns
mkdir -p "$bin_dir" "$log_dir" "$macos_dir" "$resources_dir" "$HOME/Library/LaunchAgents"
chmod 700 "$support_dir" "$bin_dir" "$log_dir"
install -m 755 "$repo_dir/scripts/macos/chatgpt-shared-launcher.sh" "$bin_dir/chatgpt-shared-launcher.sh"
install -m 644 "$repo_dir/deploy/macos/chatgpt-shared-info.plist.template" "$contents_dir/Info.plist"
install -m 644 /Applications/ChatGPT.app/Contents/Resources/icon-chatgpt.icns "$resources_dir/ChatGPT.icns"

cat > "$macos_dir/ChatGPT Shared" <<EOF
#!/bin/bash
export CODEX_MOBILE_REPO_DIR="$repo_dir"
exec "$bin_dir/chatgpt-shared-launcher.sh" --interactive
EOF
chmod 755 "$macos_dir/ChatGPT Shared"

tmp_agent="$(mktemp)"
trap 'rm -f "$tmp_agent"' EXIT
sed \
  -e "s|__LAUNCHER__|$bin_dir/chatgpt-shared-launcher.sh|g" \
  -e "s|__LOG_DIR__|$log_dir|g" \
  "$repo_dir/deploy/macos/com.xuefusong.chatgpt-shared-login.plist.template" > "$tmp_agent"
plutil -lint "$contents_dir/Info.plist" "$tmp_agent"

/bin/launchctl bootout "gui/$uid/$label" >/dev/null 2>&1 || true
install -m 644 "$tmp_agent" "$agent"
/bin/launchctl bootstrap "gui/$uid" "$agent"
/bin/launchctl enable "gui/$uid/$label"
/usr/bin/touch "$app_dir"

echo "Installed: $app_dir"
echo "Login launcher loaded: $label"
echo "The current ChatGPT process was not restarted when its shared endpoint was healthy."
