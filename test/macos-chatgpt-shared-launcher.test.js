const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const launcher = path.join(root, 'scripts/macos/chatgpt-shared-launcher.sh');
const installer = path.join(root, 'scripts/macos/install-chatgpt-shared-launcher.sh');
const agentTemplate = path.join(root, 'deploy/macos/com.xuefusong.chatgpt-shared-login.plist.template');
const infoTemplate = path.join(root, 'deploy/macos/chatgpt-shared-info.plist.template');

test('shared launcher scripts have valid shell syntax', () => {
  execFileSync('/bin/bash', ['-n', launcher]);
  execFileSync('/bin/bash', ['-n', installer]);
});

test('login job runs once in the Aqua session and is not a restart loop', () => {
  const source = fs.readFileSync(agentTemplate, 'utf8')
    .replaceAll('__LAUNCHER__', '/tmp/launcher.sh')
    .replaceAll('__LOG_DIR__', '/tmp/logs');
  assert.match(source, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(source, /<string>--login<\/string>/);
  assert.doesNotMatch(source, /<key>KeepAlive<\/key>/);
});

test('login plist passes the native macOS validator', {
  skip: process.platform !== 'darwin' ? 'plutil is a macOS system tool' : false,
}, () => {
  const source = fs.readFileSync(agentTemplate, 'utf8')
    .replaceAll('__LAUNCHER__', '/tmp/launcher.sh')
    .replaceAll('__LOG_DIR__', '/tmp/logs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-shared-'));
  try {
    const plist = path.join(dir, 'agent.plist');
    fs.writeFileSync(plist, source);
    execFileSync('/usr/bin/plutil', ['-lint', plist]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher app uses the ChatGPT icon and a distinct identity', () => {
  const source = fs.readFileSync(infoTemplate, 'utf8');
  assert.match(source, /<string>ChatGPT Shared<\/string>/);
  assert.match(source, /<key>CFBundleIconFile<\/key>\s*<string>ChatGPT<\/string>/);
  assert.match(source, /com\.xuefusong\.chatgpt-shared-launcher/);
  assert.match(fs.readFileSync(installer, 'utf8'), /icon-chatgpt\.icns/);
});

test('only an intentional or login launch may replace an unhealthy ChatGPT process', () => {
  const source = fs.readFileSync(launcher, 'utf8');
  assert.match(source, /--interactive\|--login/);
  assert.match(source, /args\+=\(--force-quit\)/);
  assert.match(source, /ps -axo args=/);
  assert.doesNotMatch(source, /pgrep/);
  assert.doesNotMatch(source, /killall|pkill|SIGKILL/);
});

test('launcher invokes Desktop with zero args when ChatGPT is not running', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-shared-empty-args-'));
  try {
    const repo = path.join(dir, 'repo');
    const support = path.join(dir, 'support');
    const capture = path.join(dir, 'args.txt');
    const fakeDesktop = path.join(repo, 'start-codex-desktop-shared-macos.sh');
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(fakeDesktop, '#!/bin/bash\nprintf "%s\\n" "$#" > "$CHATGPT_SHARED_TEST_CAPTURE"\nexit 1\n');
    fs.chmodSync(fakeDesktop, 0o755);

    const result = spawnSync('/bin/bash', [launcher, '--login'], {
      env: {
        ...process.env,
        CHATGPT_SHARED_APP_EXECUTABLE: path.join(dir, 'ChatGPT-not-running'),
        CHATGPT_SHARED_SUPPORT_DIR: support,
        CHATGPT_SHARED_TEST_CAPTURE: capture,
        CODEX_MOBILE_REPO_DIR: repo
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.equal(fs.readFileSync(capture, 'utf8').trim(), '0');
    const log = fs.readFileSync(path.join(support, 'launcher.log'), 'utf8');
    assert.match(log, /launch-request mode=--login force_quit=false/);
    assert.match(log, /launch-failed/);
    assert.doesNotMatch(log, /unbound variable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher supplies a Finder-safe PATH to the Desktop launcher', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-shared-path-'));
  try {
    const repo = path.join(dir, 'repo');
    const support = path.join(dir, 'support');
    const bin = path.join(dir, 'bin');
    const capture = path.join(dir, 'node-path.txt');
    const fakeDesktop = path.join(repo, 'start-codex-desktop-shared-macos.sh');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'node'), '#!/bin/bash\nexit 0\n');
    fs.chmodSync(path.join(bin, 'node'), 0o755);
    fs.writeFileSync(
      fakeDesktop,
      '#!/bin/bash\ncommand -v node > "$CHATGPT_SHARED_TEST_CAPTURE"\nexit 1\n'
    );
    fs.chmodSync(fakeDesktop, 0o755);

    const result = spawnSync('/bin/bash', [launcher, '--login'], {
      env: {
        ...process.env,
        PATH: '/usr/bin:/bin',
        CHATGPT_SHARED_PATH: `${bin}:/usr/bin:/bin`,
        CHATGPT_SHARED_APP_EXECUTABLE: path.join(dir, 'ChatGPT-not-running'),
        CHATGPT_SHARED_SUPPORT_DIR: support,
        CHATGPT_SHARED_TEST_CAPTURE: capture,
        CODEX_MOBILE_REPO_DIR: repo
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.equal(fs.readFileSync(capture, 'utf8').trim(), path.join(bin, 'node'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
