"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  createVoxSparkSurfaceTransactionStore,
} = require("../services/runtime/voxspark-surface-transaction-store");

test("VoxSpark transaction store atomically preserves private restart state", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "voxspark-transactions-"));
  const filePath = path.join(directory, "surface-transactions.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = createVoxSparkSurfaceTransactionStore({ filePath });
  const state = {
    commandSequence: 7,
    pendingCommands: [{ sequence: 7, message: { type: "host.action", action_id: "action-7" } }],
  };

  assert.equal(first.save(state), true);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  const second = createVoxSparkSurfaceTransactionStore({ filePath });
  assert.deepEqual(second.load(), state);
  assert.equal(second.status().lastReadStatus, "ok");
});

test("VoxSpark transaction store rejects malformed or oversized state", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "voxspark-transactions-invalid-"));
  const filePath = path.join(directory, "surface-transactions.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(filePath, "{not-json", { encoding: "utf8", mode: 0o600 });
  const store = createVoxSparkSurfaceTransactionStore({ filePath, maxBytes: 64 * 1024 });

  assert.equal(store.load(), null);
  assert.equal(store.status().lastReadStatus, "invalid-json");
  assert.equal(store.save({ text: "x".repeat(70 * 1024) }), false);
  assert.equal(store.status().lastWriteStatus, "too-large");
});
