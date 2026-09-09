"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

// Set CHROMIUM_EXECUTABLE to a Chromium headless-shell binary to exercise native
// contenteditable/Selection behavior without live sessions or network access.
for (const mode of ["classic", "native-esm"]) test(`${mode}: BOX final insertion preserves paragraphs and leaves the native caret after inserted text`, {
  skip: !process.env.CHROMIUM_EXECUTABLE,
}, () => {
  const root = path.resolve(__dirname, "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voxspark-selection-"));
  try {
    const sources = mode === "classic" ? ["composer-runtime.js", "voxspark-surface-host-runtime.js"]
      .map((name) => `<script>${fs.readFileSync(path.join(root, "public", name), "utf8")}</script>`).join("") : "";
    const nativeImports = mode === "native-esm" ? ["composer-runtime.mjs", "voxspark-surface-host-runtime.mjs"]
      .map(name => `await import("data:text/javascript;base64,${fs.readFileSync(path.join(root, "frontend/native", name)).toString("base64")}");`).join("\n") : "";
    const wiringSource = fs.readFileSync(path.join(root, mode === "classic"
      ? "public/runtime-wiring-runtime.js" : "frontend/native/runtime-wiring-runtime.mjs"), "utf8");
    const page = `<!doctype html><meta charset="utf-8"><div id="messageInput" contenteditable="true" style="white-space:pre-wrap"></div><pre id="result">PENDING</pre>${sources}
<script type="module">
${nativeImports}
(async () => {
  try {
    const input = document.getElementById("messageInput");
    const $ = id => id === "messageInput" ? input : null;
    const state = {};
    const composer = CodexComposerRuntime.createComposerRuntime({
      $, document, window, state, viewportMetrics: { cssPixel: Number },
      MESSAGE_INPUT_MIN_HEIGHT_PX: 40, MESSAGE_INPUT_MAX_HEIGHT_PX: 240,
    });
    // Only the headless activation gate is overridden. Native DOM selection and
    // the real production runtime-wiring initializer are exercised unchanged.
    Object.defineProperty(document, "hasFocus", { value: () => true });
    Object.assign(window, {
      $, composerRuntime: composer, threadDetailRuntime: {}, threadListRuntime: {}, threadTileRuntime: {},
      currentComposerThreadId: () => "test-session",
      composerTargetThread: () => ({ id: "test-session", turns: [] }),
      composerTargetActiveTurnId: () => "", scheduleCurrentDraftSave() {},
      threadDisplayName: () => "Test", basenameForFsPath: () => "test",
      approvalsForTurn: () => [], isApprovalActive: () => false, postClientEvent() {},
      api: async () => ({ ok: true, commands: [] }),
    });
    localStorage.setItem(CodexVoxSparkSurfaceHostRuntime.STORAGE_BRIDGE_URL, "ws://127.0.0.1:8790/host");
    const wiringSource = ${JSON.stringify(wiringSource)};
    const results = [];
    async function check(name, setup, expected, afterCaret) {
      composer.setComposerText("");
      input.focus();
      setup();
      if (${JSON.stringify(mode)} === "native-esm") {
        const wiring = await import("data:text/javascript;base64," + btoa(unescape(encodeURIComponent(wiringSource))) + "#" + name);
        wiring.createRuntimeWiringRuntime().initialize();
      } else {
        new Function(wiringSource + "; return createRuntimeWiringRuntime;")()().initialize();
      }
      const runtime = window.voxsparkSurfaceHostRuntime;
      const command = {
        type: "host.composer.replace", contract: CodexVoxSparkSurfaceHostRuntime.CONTRACT,
        context_revision: runtime.readState().contextRevision, draft_revision: 1, text: "Middle.",
      };
      await runtime.handleMessage(command);
      const selection = window.getSelection();
      const remaining = selection.getRangeAt(0).cloneRange();
      remaining.setEnd(input, input.childNodes.length);
      const actual = composer.composerText();
      const active = runtime.readState().activeDraft;
      if (actual !== expected || remaining.toString() !== afterCaret
        || !selection.isCollapsed || document.activeElement !== input || active.text !== actual) {
        throw new Error(name + " " + JSON.stringify({ actual, afterCaret: remaining.toString() }));
      }
      await runtime.handleMessage(command);
      if (composer.composerText() !== expected) throw new Error(name + " duplicated insertion");
      runtime.stop();
      results.push(name);
    }
    function select(node, start, end = start) {
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }
    await check("end", () => {
      composer.setComposerText("First."); select(input.firstChild, 6);
    }, "First. Middle.", "");
    await check("text-paragraph-middle", () => {
      composer.setComposerText("First.\\n\\nLast."); select(input.firstChild, 7);
    }, "First.\\nMiddle.\\nLast.", "\\nLast.");
    await check("html-paragraph-middle", () => {
      input.innerHTML = "<div>First.</div><div><br></div><div>Last.</div>";
      select(input.children[1], 0);
    }, "First.\\nMiddle.\\nLast.", "Last.");
    await check("selected-text-preserved", () => {
      composer.setComposerText("First.\\n\\nLast."); select(input.firstChild, 0, 7);
    }, "First.\\nMiddle.\\nLast.", "\\nLast.");
    await check("beginning", () => {
      composer.setComposerText("\\nLast."); select(input.firstChild, 0);
    }, "Middle.\\nLast.", "\\nLast.");
    document.getElementById("result").textContent = "PASS " + results.join(",");
  } catch (error) {
    document.getElementById("result").textContent = "FAIL " + error.message;
  }
})();
</script>`;
    const file = path.join(dir, "selection.html");
    fs.writeFileSync(file, page);
    const output = execFileSync(process.env.CHROMIUM_EXECUTABLE, [
      "--no-sandbox", "--disable-gpu", "--dump-dom", "--timeout=5000", "--virtual-time-budget=5000", pathToFileURL(file).href,
    ], { encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    const result = output.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];
    assert.ok(result?.startsWith("PASS "), result || "missing browser result");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
