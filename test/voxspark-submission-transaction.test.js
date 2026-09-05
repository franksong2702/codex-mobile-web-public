"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createMediaFileService } = require("../adapters/media-file-service");
const {
  createVoxSparkSurfaceTransactionStore,
} = require("../services/runtime/voxspark-surface-transaction-store");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "voxspark-submission-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storePath = path.join(directory, "submission-transactions.json");
  const createService = () => createMediaFileService({
    runtimeRoot: directory,
    messageSubmissionStore: createVoxSparkSurfaceTransactionStore({ filePath: storePath }),
  });
  return { createService, storePath };
}

test("successful VoxSpark submission is not executed again after process restart", async (t) => {
  const { createService } = fixture(t);
  const keys = ["client:session-a:voxspark-action-a"];
  let calls = 0;
  const first = await createService().runMessageSubmissionOnce(keys, [], async () => {
    calls += 1;
    return { ok: true, turnId: "turn-a", ignoredPayload: "not persisted" };
  });
  const second = await createService().runMessageSubmissionOnce(keys, [], async () => {
    calls += 1;
    return { ok: true, turnId: "turn-duplicate" };
  });

  assert.equal(first.turnId, "turn-a");
  assert.deepEqual(second, { ok: true, turnId: "turn-a" });
  assert.equal(calls, 1);
});

test("in-flight VoxSpark submission becomes unknown after process restart", async (t) => {
  const { createService, storePath } = fixture(t);
  const store = createVoxSparkSurfaceTransactionStore({ filePath: storePath });
  store.save({
    submissions: [{
      key: "client:session-a:voxspark-action-uncertain",
      phase: "executing",
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }],
  });
  let calls = 0;

  await assert.rejects(
    createService().runMessageSubmissionOnce(
      ["client:session-a:voxspark-action-uncertain"],
      [],
      async () => { calls += 1; },
    ),
    (err) => err && err.statusCode === 409 && err.code === "voxspark_submission_outcome_unknown",
  );
  assert.equal(calls, 0);
  assert.equal(store.load().submissions[0].phase, "unknown");
});

test("VoxSpark submission fails closed when the write-ahead ledger is unavailable", async () => {
  const service = createMediaFileService({
    messageSubmissionStore: { load: () => null, save: () => false },
  });
  let calls = 0;

  await assert.rejects(
    service.runMessageSubmissionOnce(
      ["client:session-a:voxspark-action-no-ledger"],
      [],
      async () => { calls += 1; },
    ),
    (err) => err && err.statusCode === 503 && err.code === "voxspark_submission_ledger_unavailable",
  );
  assert.equal(calls, 0);
});

test("VoxSpark submission becomes unknown when its success receipt cannot be persisted", async () => {
  let saves = 0;
  const savedStates = [];
  const service = createMediaFileService({
    messageSubmissionStore: {
      load: () => null,
      save: (state) => {
        saves += 1;
        savedStates.push(structuredClone(state));
        return saves === 1;
      },
    },
  });
  const keys = ["client:session-a:voxspark-action-receipt-failure"];
  let calls = 0;

  await assert.rejects(
    service.runMessageSubmissionOnce(keys, [], async () => {
      calls += 1;
      return { ok: true, turnId: "turn-receipt-failure" };
    }),
    (err) => err && err.statusCode === 409 && err.code === "voxspark_submission_outcome_unknown",
  );
  await assert.rejects(
    service.runMessageSubmissionOnce(keys, [], async () => {
      calls += 1;
      return { ok: true, turnId: "turn-duplicate" };
    }),
    (err) => err && err.statusCode === 409 && err.code === "voxspark_submission_outcome_unknown",
  );

  assert.equal(calls, 1);
  assert.equal(savedStates[0].submissions[0].phase, "executing");
  assert.equal(savedStates.at(-1).submissions[0].phase, "unknown");
});

test("failed Codex request stays unknown and cannot execute the same VoxSpark action twice", async (t) => {
  const { createService } = fixture(t);
  const service = createService();
  const keys = ["client:session-a:voxspark-action-request-failure"];
  let calls = 0;

  await assert.rejects(
    service.runMessageSubmissionOnce(keys, [], async () => {
      calls += 1;
      throw new Error("transport closed after request write");
    }),
    (err) => err && err.statusCode === 409 && err.code === "voxspark_submission_outcome_unknown",
  );
  await assert.rejects(
    service.runMessageSubmissionOnce(keys, [], async () => {
      calls += 1;
      return { ok: true, turnId: "turn-duplicate" };
    }),
    (err) => err && err.statusCode === 409 && err.code === "voxspark_submission_outcome_unknown",
  );

  assert.equal(calls, 1);
});
