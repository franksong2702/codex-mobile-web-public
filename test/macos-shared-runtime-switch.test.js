"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "switch-codex-mobile-desktop-shared-macos.sh");
const script = fs.readFileSync(scriptPath, "utf8");

test("shared runtime switch is read-only unless --apply is explicit", () => {
  assert.match(script, /APPLY=0/);
  assert.match(script, /--apply\) APPLY=1/);
  assert.match(script, /if \[\[ "\$APPLY" -eq 0 \]\]; then[\s\S]*exit 0/);
});

test("shared runtime switch never creates a submitted launchctl helper", () => {
  assert.doesNotMatch(script, /launchctl\s+submit/);
  assert.match(script, /launchctl bootout "gui\/\$\(id -u\)\/\$LABEL"/);
  assert.match(script, /launchctl bootstrap "gui\/\$\(id -u\)" "\$PLIST_PATH"/);
});

test("shared runtime switch waits for a Desktop-owned mux before bootstrapping Mobile", () => {
  const endpointWait = script.indexOf('wait_until "Desktop-owned mux endpoint" endpoint_is_ready');
  const ownershipWait = script.indexOf('wait_until "Desktop to own the mux process" desktop_uses_mux');
  const bootstrap = script.lastIndexOf('launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"');
  assert.ok(endpointWait > 0);
  assert.ok(ownershipWait > endpointWait);
  assert.ok(bootstrap > ownershipWait);
});

test("shared runtime switch requires the existing JSONL TCP mux transport", () => {
  assert.match(script, /status\.transport === "external-jsonl-tcp"/);
  assert.match(script, /status\.sharedRequired === true/);
  assert.match(script, /CODEX_MOBILE_MUX_ENDPOINT_FILE/);
  assert.match(script, /CODEX_MOBILE_REQUIRE_SHARED_APP_SERVER "1"/);
  assert.match(script, /CODEX_MOBILE_DISABLE_OWNED_MUX "1"/);
  assert.doesNotMatch(script, /external-ws-unix/);
  assert.doesNotMatch(script, /app-server daemon start/);
});

test("shared runtime switch validates endpoint processes, TCP reachability, and Desktop ownership", () => {
  assert.match(script, /endpoint_field pid/);
  assert.match(script, /endpoint_field childPid/);
  assert.match(script, /\[\[ "\$host" == "127\.0\.0\.1" \]\]/);
  assert.match(script, /net\.createConnection/);
  assert.match(script, /mux_ppid=.*ps -p "\$mux_pid" -o ppid=/);
  assert.match(script, /\[\[ "\$mux_ppid" == "\$main_pid" \]\]/);
});

test("shared runtime switch restores the original plist and normal runtime on failure", () => {
  assert.match(script, /trap restore_original_runtime EXIT/);
  assert.match(script, /cp "\$BACKUP_PATH" "\$PLIST_PATH"/);
  assert.match(script, /\/usr\/bin\/open -n "\$APP_PATH"/);
  const changed = script.indexOf("PLIST_CHANGED=1");
  const firstMutation = script.indexOf("plist_delete_env CODEX_MOBILE_APP_SERVER_UNIX_SOCKET");
  assert.ok(changed > 0);
  assert.ok(firstMutation > changed);
});

test("shared runtime switch authenticates status probes without printing the access key", () => {
  assert.match(script, /x-codex-mobile-key: \$key/);
  assert.doesNotMatch(script, /echo .*access.key/i);
  assert.doesNotMatch(script, /cat .*access_key.*echo/i);
});

test("shared runtime switch fails closed when the process table is unavailable", () => {
  assert.match(script, /PROCESS_OUTPUT="\$\(ps -axo pid=,command=/);
  assert.match(script, /\[\[ "\$PS_STATUS" -eq 0 \]\] \|\| fail "cannot read the process table/);
  assert.match(script, /desktop_pid\(\)/);
});

test("shared runtime switch identifies only the exact Desktop executable", () => {
  assert.match(script, /while read -r pid command_line/);
  assert.match(script, /"\$command_line" == "\$DESKTOP_EXE"/);
  assert.match(script, /"\$command_line" == "\$DESKTOP_EXE "\*/);
  assert.doesNotMatch(script, /awk -v exe="\$DESKTOP_EXE"/);
});

test("shared runtime switch quits the exact Desktop bundle identifier", () => {
  assert.match(script, /Print :CFBundleIdentifier/);
  assert.match(script, /Desktop bundle identifier unavailable or invalid/);
  assert.match(script, /osascript - "\$DESKTOP_BUNDLE_ID"/);
  assert.match(script, /tell application id targetBundleId to quit/);
  assert.doesNotMatch(script, /osascript - "\$APP_PATH"/);
});

test("shared runtime switch writes an apply transcript but not during read-only preflight", () => {
  const readOnlyExit = script.indexOf("Preflight passed:");
  const logAssignment = script.indexOf('LOG_PATH="$HOME/.codex-mobile-web/logs/shared-switch-');
  assert.ok(readOnlyExit > 0);
  assert.ok(logAssignment > readOnlyExit);
  assert.match(script, /exec > >\(tee -a "\$LOG_PATH"\) 2>&1/);
});
