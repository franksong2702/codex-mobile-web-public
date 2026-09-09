"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  createThreadDetailFirstPaintPrewarmService,
  summaryLooksActive,
  summaryRolloutSizeBytes,
  threadDetailFirstPaintPrewarmJobPolicy,
} = require("../services/thread-detail/thread-detail-first-paint-prewarm-service");

const EXPECTED_PREWARM_JOB = {
  name: "thread-detail-first-paint-prewarm",
  periodicAllowed: false,
  maxConcurrency: 1,
  timeoutMs: 30000,
  timeBudgetMs: 30000,
  cpuBudgetClass: "medium",
  realBrowserAllowed: false,
  usesBrowser: false,
  userRequestPreemptible: true,
  preemptibleByForeground: true,
};

function withExpectedJob(value) {
  return Object.assign({}, value, {
    job: EXPECTED_PREWARM_JOB,
  });
}

function createHarness(overrides = {}) {
  const calls = [];
  let nowMs = 1_000;
  const summary = overrides.summary || {
    id: "thread-1",
    status: { type: "active" },
    activeTurnId: "active-turn",
    rolloutSizeBytes: 32 * 1024 * 1024,
  };
  const service = createThreadDetailFirstPaintPrewarmService(Object.assign({
    now: () => {
      nowMs += 10;
      return nowMs;
    },
    setTimeout: (fn, delayMs) => {
      calls.push(`timer:${delayMs}`);
      fn();
      return { unref() {} };
    },
    delayMs: 0,
    minIntervalMs: 0,
    minRolloutBytes: 8 * 1024 * 1024,
    resolveSummary: async (codex, threadId) => {
      calls.push(`summary:${threadId}`);
      return { summary };
    },
    readThreadDetail: async ({ threadId, responseBudgetEvidence }) => {
      calls.push(`detail:${threadId}:${responseBudgetEvidence}`);
      return {
        status: 200,
        mode: "projection-active-overlay",
        body: {
          thread: {
            id: threadId,
            mobileReadMode: "projection-active-overlay",
            mobileDiagnostics: {
              threadDetailTimings: {
                totalMs: 42,
                prepareResponseMs: 17,
                prepareResponseBudgetMs: 3,
              },
            },
          },
        },
      };
    },
    log: (event) => calls.push(`log:${event}`),
  }, overrides.service || {}));
  return { calls, service, summary };
}

test("first-paint prewarm declares scheduler budget policy", () => {
  assert.deepEqual(threadDetailFirstPaintPrewarmJobPolicy(), EXPECTED_PREWARM_JOB);
});

test("summary helpers detect active state and bounded rollout size", () => {
  assert.equal(summaryLooksActive({ status: { type: "active" } }), true);
  assert.equal(summaryLooksActive({ mobileLocalActiveStatus: { turnId: "turn-1" } }), true);
  assert.equal(summaryLooksActive({ status: { type: "idle" } }), false);
  assert.equal(summaryLooksActive(null, true), true);
  assert.equal(summaryRolloutSizeBytes({ rolloutSizeBytes: "1234" }), 1234);
});

test("prewarmNow warms active large-thread first paint through detail orchestration", async () => {
  const { calls, service, summary } = createHarness();

  const result = await service.prewarmNow({ threadId: "thread-1", summary });

  assert.equal(result.status, "warmed");
  assert.equal(result.reason, "first-paint-detail");
  assert.equal(result.mode, "projection-active-overlay");
  assert.equal(result.totalMs, 42);
  assert.equal(result.prepareResponseMs, 17);
  assert.deepEqual(calls.filter((call) => call.startsWith("detail:")), [
    "detail:thread-1:compact",
  ]);
});

test("prewarmNow skips idle and small summaries before detail reads", async () => {
  const idle = createHarness({
    summary: { id: "thread-1", status: { type: "idle" }, rolloutSizeBytes: 64 * 1024 * 1024 },
  });
  assert.equal((await idle.service.prewarmNow({ threadId: "thread-1", summary: idle.summary })).reason, "not-active");
  assert.equal(idle.calls.some((call) => call.startsWith("detail:")), false);

  const small = createHarness({
    summary: { id: "thread-1", status: { type: "active" }, activeTurnId: "turn-1", rolloutSizeBytes: 1024 },
  });
  assert.equal((await small.service.prewarmNow({ threadId: "thread-1", summary: small.summary })).reason, "below-rollout-threshold");
  assert.equal(small.calls.some((call) => call.startsWith("detail:")), false);
});

test("prewarmNow resolves summary before active-hint large-thread prewarm", async () => {
  const { calls, service } = createHarness();

  const result = await service.prewarmNow({
    threadId: "thread-1",
    summary: { id: "thread-1", status: { type: "active" }, activeTurnId: "turn-1" },
    activeHint: true,
  });

  assert.equal(result.status, "warmed");
  assert.equal(result.rolloutSizeBytes, 32 * 1024 * 1024);
  assert.deepEqual(calls.filter((call) => call.startsWith("summary:")), ["summary:thread-1"]);
  assert.deepEqual(calls.filter((call) => call.startsWith("detail:")), ["detail:thread-1:compact"]);
});

test("prewarmNow skips active-hint work when resolved rollout size is unavailable", async () => {
  const { calls, service } = createHarness({
    service: {
      resolveSummary: async (codex, threadId) => {
        calls.push(`summary:${threadId}`);
        return { summary: { id: threadId, status: { type: "active" }, activeTurnId: "turn-1" } };
      },
    },
  });

  const result = await service.prewarmNow({
    threadId: "thread-1",
    summary: { id: "thread-1", status: { type: "active" }, activeTurnId: "turn-1" },
    activeHint: true,
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "rollout-size-unavailable");
  assert.deepEqual(calls.filter((call) => call.startsWith("summary:")), ["summary:thread-1"]);
  assert.equal(calls.some((call) => call.startsWith("detail:")), false);
});

test("schedule deduplicates and reuses fresh first-paint warm results", async () => {
  const { calls, service, summary } = createHarness({
    service: {
      minIntervalMs: 0,
      readyResultTtlMs: 10_000,
    },
  });

  assert.deepEqual(service.schedule({ threadId: "thread-1", summary }), withExpectedJob({
    scheduled: true,
    reason: "scheduled",
  }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(service.status().lastResult.status, "warmed");
  assert.equal(service.status("thread-1").lastResult.status, "warmed");
  assert.deepEqual(service.schedule({ threadId: "thread-1", summary }), withExpectedJob({
    scheduled: false,
    reason: "recently-ready",
  }));
  assert.deepEqual(calls.filter((call) => call.startsWith("timer:")), ["timer:0"]);
  assert.deepEqual(calls.filter((call) => call.startsWith("detail:")), ["detail:thread-1:compact"]);
});

function controlledHarness() {
  const timers = [];
  const reads = [];
  const service = createThreadDetailFirstPaintPrewarmService({
    minIntervalMs: 0,
    readyResultTtlMs: 0,
    setTimeout(fn) { timers.push(fn); return { unref() {} }; },
    readThreadDetail({ threadId }) {
      return new Promise((resolve, reject) => reads.push({ threadId, resolve, reject }));
    },
  });
  const input = (threadId) => ({
    threadId,
    summary: { id: threadId, status: "active", rolloutSizeBytes: 32 * 1024 * 1024 },
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { timers, reads, service, input, settle };
}

test("first-paint prewarm skips huge rollouts before any detail read", async () => {
  const { calls, service } = createHarness();
  const result = await service.prewarmNow({
    threadId: "huge-thread",
    summary: { status: "active", rolloutSizeBytes: 234 * 1024 * 1024 },
  });
  assert.equal(result.reason, "rollout-too-large");
  assert.equal(result.maxRolloutBytes, 50 * 1024 * 1024);
  assert.equal(calls.some((call) => call.startsWith("detail:")), false);
});

test("first-paint prewarm applies the byte ceiling to resolved summaries", async () => {
  const { calls, service } = createHarness({
    summary: { status: "active", rolloutSizeBytes: 234 * 1024 * 1024 },
  });
  const result = await service.prewarmNow({ threadId: "huge-thread", activeHint: true });
  assert.equal(result.reason, "rollout-too-large");
  assert.equal(calls.some((call) => call.startsWith("detail:")), false);
});

test("first-paint prewarm still reads at the byte ceiling and skips one byte above", async () => {
  const { calls, service } = createHarness();
  const input = { threadId: "boundary", summary: { status: "active", rolloutSizeBytes: 50 * 1024 * 1024 } };
  assert.equal((await service.prewarmNow(input)).status, "warmed");
  input.summary.rolloutSizeBytes++;
  assert.equal((await service.prewarmNow(input)).reason, "rollout-too-large");
  assert.equal(calls.filter((call) => call.startsWith("detail:")).length, 1);
});

test("preempted delayed first-paint jobs never start expensive reads", async () => {
  const { timers, reads, service, input, settle } = controlledHarness();
  service.schedule(input("a"));
  service.schedule({ ...input("a"), preemptPending: true, bypassMinInterval: true });
  timers[1]();
  reads[0].resolve({ thread: { id: "a" } });
  await settle();
  timers[0]();
  await settle();
  assert.equal(reads.length, 1);
  assert.equal(service.status().pendingCount, 0);
});

test("first-paint prewarm serializes reads across Sessions and retains pending capacity", async () => {
  const { timers, reads, service, input, settle } = controlledHarness();
  service.schedule(input("a"));
  service.schedule(input("b"));
  timers[0]();
  timers[1]();
  assert.deepEqual(reads.map((read) => read.threadId), ["a"]);
  assert.equal(service.status().pendingCount, 2);
  assert.equal(service.schedule(input("c")).reason, "pending-limit");
  reads[0].resolve({ thread: { id: "a" } });
  await settle();
  assert.deepEqual(reads.map((read) => read.threadId), ["a", "b"]);
  reads[1].resolve({ thread: { id: "b" } });
  await settle();
  assert.equal(service.status().pendingCount, 0);
});

test("preemption cannot overlap an already running first-paint read", async () => {
  const { timers, reads, service, input, settle } = controlledHarness();
  service.schedule(input("a"));
  timers[0]();
  const replacement = service.schedule({ ...input("a"), preemptPending: true, bypassMinInterval: true });
  assert.equal(replacement.scheduled, false);
  assert.equal(replacement.reason, "already-running");
  assert.equal(timers.length, 1);
  reads[0].resolve({ thread: { id: "a" } });
  await settle();
  assert.equal(service.status().pendingCount, 0);
});

test("failed first-paint read releases its slot for the next Session", async () => {
  const { timers, reads, service, input, settle } = controlledHarness();
  service.schedule(input("a"));
  service.schedule(input("b"));
  timers[0]();
  timers[1]();
  assert.equal(reads.length, 1);
  reads[0].reject(new Error("synthetic_read_failure"));
  await settle();
  assert.equal(service.status("a").lastResult.status, "failed");
  assert.deepEqual(reads.map((read) => read.threadId), ["a", "b"]);
  reads[1].resolve({ thread: { id: "b" } });
  await settle();
  assert.equal(service.status().pendingCount, 0);
});
