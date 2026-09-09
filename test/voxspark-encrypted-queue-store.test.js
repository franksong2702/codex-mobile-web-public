"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  ALGORITHM,
  createVoxSparkEncryptedQueueStore,
  createVoxSparkKeychainQueueKeyProvider,
  decodedKey,
} = require("../services/runtime/voxspark-encrypted-queue-store");

test("encrypted Queue store round-trips without plaintext metadata or body", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "voxspark-encrypted-queue-"));
  const filePath = path.join(directory, "queued-submissions.enc");
  const key = Buffer.alloc(32, 9);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createVoxSparkEncryptedQueueStore({ filePath, keyProvider: () => key });
  const entries = [{
    queueId: "queue-a",
    sessionId: "session-private",
    text: "Private Composer body",
  }];

  assert.equal(store.save(entries), true);
  const raw = fs.readFileSync(filePath, "utf8");
  const envelope = JSON.parse(raw);
  assert.equal(envelope.algorithm, ALGORITHM);
  assert.doesNotMatch(raw, /Private Composer body|session-private|queue-a/);
  assert.deepEqual(store.load(), entries);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});

test("encrypted Queue store fails closed for a wrong or missing key", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "voxspark-encrypted-queue-key-"));
  const filePath = path.join(directory, "queued-submissions.enc");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const writer = createVoxSparkEncryptedQueueStore({
    filePath,
    keyProvider: () => Buffer.alloc(32, 1),
  });
  assert.equal(writer.save([{ text: "secret" }]), true);

  const wrong = createVoxSparkEncryptedQueueStore({
    filePath,
    keyProvider: () => Buffer.alloc(32, 2),
  });
  assert.equal(wrong.load(), null);
  assert.equal(wrong.status().lastReadStatus, "decrypt-failed");
  const missing = createVoxSparkEncryptedQueueStore({ filePath, keyProvider: () => null });
  assert.equal(missing.load(), null);
  assert.equal(missing.save([]), false);
  assert.equal(missing.status().lastWriteStatus, "key-unavailable");
});

test("Keychain provider accepts only one valid base64 256-bit key", () => {
  const encoded = Buffer.alloc(32, 5).toString("base64");
  const calls = [];
  const provider = createVoxSparkKeychainQueueKeyProvider({
    platform: "darwin",
    account: "test-user",
    service: "test-service",
    spawnSync(command, args) {
      calls.push({ command, args });
      return { status: 0, stdout: `${encoded}\n` };
    },
  });
  assert.deepEqual(provider(), Buffer.alloc(32, 5));
  assert.deepEqual(provider(), Buffer.alloc(32, 5));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/usr/bin/security");
  assert.deepEqual(decodedKey("not-base64"), null);
  assert.equal(createVoxSparkKeychainQueueKeyProvider({ platform: "linux" })(), null);
});
