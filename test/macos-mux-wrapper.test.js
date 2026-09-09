"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const wrapperPath = path.join(root, "codex-app-server-mux-macos.sh");

function makeRecorder(tempRoot, name) {
  const executable = path.join(tempRoot, name);
  fs.writeFileSync(executable, `#!/bin/bash\nprintf '%s\\n' "$@"\n`, "utf8");
  fs.chmodSync(executable, 0o755);
  return executable;
}

function runWrapper(args) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mux-wrapper-"));
  try {
    const nodeRecorder = makeRecorder(tempRoot, "node-recorder");
    const codexRecorder = makeRecorder(tempRoot, "codex-recorder");
    const muxScript = path.join(tempRoot, "mux.js");
    fs.writeFileSync(muxScript, "", "utf8");
    return execFileSync("bash", [wrapperPath, ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_MUX_NODE_EXE: nodeRecorder,
        CODEX_MUX_CODEX_EXE: codexRecorder,
        CODEX_MUX_SCRIPT_PATH: muxScript,
      },
    }).trim().split("\n");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("macOS mux wrapper intercepts app-server after Desktop config overrides", () => {
  const output = runWrapper([
    "-c", "features.code_mode_host=true",
    "-c", "mcp_servers.codex_app={enabled=true}",
    "app-server", "--analytics-default-enabled",
  ]);
  assert.match(output[0], /mux\.js$/);
  assert.deepEqual(output.slice(1), [
    "-c", "features.code_mode_host=true",
    "-c", "mcp_servers.codex_app={enabled=true}",
    "app-server", "--analytics-default-enabled",
  ]);
});

test("macOS mux wrapper passes sandbox invocations to the real Codex executable", () => {
  const output = runWrapper([
    "sandbox", "-c", "shell_environment_policy.inherit=all", "--", "/bin/echo", "ok",
  ]);
  assert.deepEqual(output, [
    "sandbox", "-c", "shell_environment_policy.inherit=all", "--", "/bin/echo", "ok",
  ]);
});
