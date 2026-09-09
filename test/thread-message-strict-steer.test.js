"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createThreadMessageRouteService } = require("../server-routes/thread-message-route-service");

function createHarness(overrides = {}) {
  const requests = [];
  let echoes = 0;
  const route = createThreadMessageRouteService(Object.assign({
    codex: {
      request: async (method, params) => {
        requests.push({ method, params });
        if (method === "turn/start") return { turnId: "replacement-turn" };
        return { turnId: "active-turn" };
      },
      notifyMuxUserMessage: () => {},
    },
    mutationRpcTimeoutMs: 1000,
    readMessageBody: async () => ({ fields: {}, uploads: [] }),
    buildTurnInput: (text) => [{ type: "text", text: String(text || "") }],
    persistExtendedHistoryForUploads: () => false,
    requestedCodexFastMode: () => false,
    messageSubmissionKeys: () => ["strict-key"],
    runMessageSubmissionOnce: async (_keys, _uploads, fn) => fn(),
    applyPermissionModeOverride: (settings) => settings,
    applyTurnRuntimeSettings: (params) => params,
    applyResumeRuntimeSettings: (params) => params,
    applyCodexFastServiceTier: (params) => params,
    notifyLocalTurnStarted: (_threadId, result) => result.turnId || "replacement-turn",
    rememberThreadIdForTurnId: () => {},
    resolveThreadRuntimeSettings: async () => ({}),
    isCodexAccountAuthError: () => false,
    codexAccountAuthErrorPayload: () => ({}),
    logMessageSubmit: () => {},
    staleActiveTurnPreflight: async () => ({ stale: false }),
    pendingSteerEchoStore: {
      remember: () => { echoes += 1; return "echo"; },
      forget: () => {},
    },
    isTurnSteerUnsupportedError: (err) => Boolean(err && err.code === "unsupported"),
    isStaleActiveTurnError: (err) => Boolean(err && err.code === "stale_active_turn"),
    autoRecoverThreadTurn: async () => ({}),
  }, overrides));
  return { route, requests, get echoes() { return echoes; } };
}

async function post(route, fields) {
  let response = null;
  const result = await route.handleRoute({
    url: new URL("http://127.0.0.1/api/threads/thread-1/messages"),
    method: "POST",
    readMessageBody: async () => ({ fields: Object.assign({ text: "queue this" }, fields), uploads: [] }),
    sendJson: (status, body) => { response = { status, body }; },
  });
  assert.equal(result.handled, true);
  return response;
}

test("strict steer waits for the real steer outcome and accepts non-VoxSpark client ids", async () => {
  let resolveSteer;
  let notified = 0;
  const steer = new Promise((resolve) => { resolveSteer = resolve; });
  const harness = createHarness({
    codex: {
      request: async (method, params) => {
        requests.push({ method, params });
        if (method === "turn/steer") return steer;
        return { turnId: "replacement-turn" };
      },
      notifyMuxUserMessage: () => { notified += 1; },
    },
  });
  const { route, requests } = harness;
  let response = null;
  const handling = route.handleRoute({
    url: new URL("http://127.0.0.1/api/threads/thread-1/messages"),
    method: "POST",
    readMessageBody: async () => ({ fields: {
      text: "queue this",
      activeTurnId: "active-turn",
      strictSteer: "1",
      clientSubmissionId: "ordinary-client-id",
    }, uploads: [] }),
    sendJson: (status, body) => { response = { status, body }; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(response, null);
  resolveSteer({ turnId: "active-turn" });
  await handling;
  assert.equal(response.status, 200);
  assert.equal(response.body.turnId, "active-turn");
  assert.deepEqual(requests.map((entry) => entry.method), ["turn/steer"]);
  assert.equal(requests[0].params.expectedTurnId, "active-turn");
  assert.equal(harness.echoes, 0);
  assert.equal(notified, 1);
});

test("strict stale preflight returns 409 before interrupt, start, or echo", async () => {
  const harness = createHarness({
    staleActiveTurnPreflight: async () => ({ stale: true, reason: "completed" }),
  });
  const { route, requests } = harness;
  const response = await post(route, { activeTurnId: "stale-turn", strictSteer: "1" });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "voxspark_strict_steer_stale");
  assert.deepEqual(requests, []);
  assert.equal(harness.echoes, 0);
});

test("strict unsupported steer returns 409 without fallback or echo", async () => {
  let notified = 0;
  const harness = createHarness({
    codex: {
      request: async (method, params) => {
        requests.push({ method, params });
        if (method === "turn/steer") {
          const err = new Error("turn/steer unsupported");
          err.code = "unsupported";
          throw err;
        }
        return { turnId: "replacement-turn" };
      },
      notifyMuxUserMessage: () => { notified += 1; },
    },
  });
  const { route, requests } = harness;
  const response = await post(route, { activeTurnId: "active-turn", strictSteer: "1" });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "voxspark_strict_steer_unsupported");
  assert.deepEqual(requests.map((entry) => entry.method), ["turn/steer"]);
  assert.equal(harness.echoes, 0);
  assert.equal(notified, 0);
});

test("strict stale steer response returns 409 without replacement turn", async () => {
  let notified = 0;
  const harness = createHarness({
    codex: {
      request: async (method, params) => {
        requests.push({ method, params });
        if (method === "turn/steer") {
          const err = new Error("expected active turn no longer active");
          err.code = "stale_active_turn";
          throw err;
        }
        return { turnId: "replacement-turn" };
      },
      notifyMuxUserMessage: () => { notified += 1; },
    },
  });
  const { route, requests } = harness;
  const response = await post(route, { activeTurnId: "active-turn", strictSteer: "1" });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "voxspark_strict_steer_stale");
  assert.deepEqual(requests.map((entry) => entry.method), ["turn/steer"]);
  assert.equal(harness.echoes, 0);
  assert.equal(notified, 0);
});

test("strict steer without activeTurnId returns 400", async () => {
  const harness = createHarness();
  const { route, requests } = harness;
  const response = await post(route, { strictSteer: "1" });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "strict_steer_active_turn_required");
  assert.deepEqual(requests, []);
});

test("ordinary stale steer keeps the existing replacement fallback", async () => {
  const { route, requests } = createHarness({
    isStaleActiveTurnError: (err) => Boolean(err && err.code === "stale_active_turn"),
    codex: {
      request: async (method, params) => {
        requests.push({ method, params });
        if (method === "turn/steer") {
          const err = new Error("expected active turn no longer active");
          err.code = "stale_active_turn";
          throw err;
        }
        return { turnId: "replacement-turn" };
      },
      notifyMuxUserMessage: () => {},
    },
  });
  const response = await post(route, { activeTurnId: "active-turn", clientSubmissionId: "ordinary-client-id" });
  assert.equal(response.status, 200);
  assert.equal(response.body.turnId, "replacement-turn");
  assert.deepEqual(requests.map((entry) => entry.method), ["turn/steer", "turn/start"]);
});
