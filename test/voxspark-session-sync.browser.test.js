"use strict";
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
for (const mode of ['classic', 'native-esm']) test(`${mode}: native navigation events supersede old relay through production wiring`, {
  skip: !process.env.CHROMIUM_EXECUTABLE,
}, () => {
  const root = path.resolve(__dirname, '..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voxspark-session-browser-'));
  try {
    const files = ['voxspark-surface-host-runtime', 'runtime-wiring-runtime'];
    const classic = mode === 'classic' ? files.map(name => `<script>${fs.readFileSync(path.join(root, 'public', `${name}.js`), 'utf8')}</script>`).join('') : '';
    const imports = mode === 'native-esm' ? files.map(name => `await import('data:text/javascript;base64,${fs.readFileSync(path.join(root, 'frontend/native', `${name}.mjs`)).toString('base64')}');`).join('\n') : '';
    const page = `<!doctype html><meta charset="utf-8"><div id="messageInput" contenteditable></div><button data-thread="session-b">B</button><pre id="result">PENDING</pre>${classic}
<script type="module">
${imports}
try {
  const input = document.getElementById('messageInput');
  let session = 'session-a'; const requests = [];
  Object.defineProperty(document, 'hasFocus', { value: () => true });
  input.focus();
  Object.assign(window, {
    $: id => id === 'messageInput' ? input : null,
    composerRuntime: { composerText: () => input.textContent, setComposerText: text => { input.textContent = text; } },
    threadDetailRuntime: {}, threadListRuntime: {}, threadTileRuntime: {},
    currentComposerThreadId: () => session,
    composerTargetThread: () => ({ id: session, turns: [], name: session }),
    composerTargetActiveTurnId: () => '', scheduleCurrentDraftSave() {},
    threadDisplayName: thread => thread.name, basenameForFsPath: () => 'fixture',
    approvalsForTurn: () => [], isApprovalActive: () => false, postClientEvent() {},
    api: (url, options) => new Promise(resolve => requests.push({ payload: JSON.parse(options.body), signal: options.signal, resolve })),
  });
  localStorage.setItem(CodexVoxSparkSurfaceHostRuntime.STORAGE_BRIDGE_URL, 'ws://127.0.0.1:8790/host');
  CodexRuntimeWiringRuntime.createRuntimeWiringRuntime().initialize();
  const runtime = window.voxsparkSurfaceHostRuntime;
  const button = document.querySelector('button');
  button.addEventListener('click', () => { session = 'session-b'; input.textContent = 'draft B'; runtime.syncContext(); });
  button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); button.click();
  if (requests.length !== 2) throw new Error('new target queued behind old response');
  if (!requests[0].signal.aborted || requests[1].signal.aborted) throw new Error('abort signal lost in wiring');
  if (requests[1].payload.context.session.id !== 'session-b') throw new Error('wrong Session sent');
  requests[1].resolve({ ok: true, connected: true, service_epoch: 'current', commands: [] });
  await Promise.resolve(); await Promise.resolve();
  requests[0].resolve({ ok: true, connected: false, service_epoch: 'old', commands: [] });
  await Promise.resolve(); await Promise.resolve();
  if (!runtime.readState().connected || runtime.readState().currentContext.sessionId !== 'session-b') throw new Error('old response rolled back state');
  runtime.stop();
  document.getElementById('result').textContent = 'PASS immediate target, abort propagated, stale response ignored';
} catch (error) { document.getElementById('result').textContent = 'FAIL ' + error.message; }
</script>`;
    const file = path.join(directory, 'fixture.html'); fs.writeFileSync(file, page);
    const output = execFileSync(process.env.CHROMIUM_EXECUTABLE, ['--no-sandbox', '--disable-gpu',
      `--user-data-dir=${path.join(directory, 'profile')}`, '--dump-dom', '--timeout=5000', '--virtual-time-budget=2000', pathToFileURL(file).href],
    { encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = output.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];
    assert.ok(result?.startsWith('PASS '), result || 'missing browser result');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
