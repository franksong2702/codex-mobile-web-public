"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  CONTRACT,
  createVoxSparkSurfaceHostService,
  normalizeContext,
  safeLoopbackBridgeUrl,
} = require("../services/runtime/voxspark-surface-host-service");
const {
  createVoxSparkSurfaceTransactionStore,
} = require("../services/runtime/voxspark-surface-transaction-store");
const {
  createVoxSparkEncryptedQueueStore,
} = require("../services/runtime/voxspark-encrypted-queue-store");
const {
  createVoxSparkSurfaceHostRouteService,
} = require("../server-routes/voxspark-surface-host-route-service");

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.listeners = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  message(message) {
    this.emit("message", { data: JSON.stringify({ contract: CONTRACT, ...message }) });
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }
}

function context(sessionId = "session-a", focused = true, armedAt = 1000) {
  return {
    session: { id: sessionId, title: "VoxSpark", workspace: "Pilot" },
    composer: { focused, ownership: "none", draft_revision: 0, armed_at: armedAt },
    turn: { state: "idle", approval_pending: false },
  };
}

function publish(service, overrides = {}) {
  return service.publish({
    bridge_url: "ws://127.0.0.1:8790/host",
    client_id: "browser-a",
    surface_revision: 1,
    after_sequence: 0,
    context: context(),
    ...overrides,
  });
}

function transactionStoreFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "voxspark-service-ledger-"));
  const filePath = path.join(directory, "surface-transactions.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return () => createVoxSparkSurfaceTransactionStore({ filePath });
}

function persistentStoresFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "voxspark-service-persistent-"));
  const transactionFile = path.join(directory, "surface-transactions.json");
  const queueFile = path.join(directory, "queued-submissions.enc");
  const key = Buffer.alloc(32, 7);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    queueFile,
    createTransactionStore: () => createVoxSparkSurfaceTransactionStore({ filePath: transactionFile }),
    createQueueStore: () => createVoxSparkEncryptedQueueStore({ filePath: queueFile, keyProvider: () => key }),
  };
}

test("VoxSpark backend accepts only exact loopback Host URLs", () => {
  assert.equal(safeLoopbackBridgeUrl("ws://127.0.0.1:8790/host"), "ws://127.0.0.1:8790/host");
  assert.equal(safeLoopbackBridgeUrl("wss://127.0.0.1:8790/host"), "");
  assert.equal(safeLoopbackBridgeUrl("ws://192.168.1.2:8790/host"), "");
  assert.equal(safeLoopbackBridgeUrl("ws://127.0.0.1:8790/box"), "");
  assert.equal(safeLoopbackBridgeUrl("ws://127.0.0.1:8790/host?token=x"), "");
});

test("deployment default enables the Host relay without a browser URL", () => {
  FakeWebSocket.instances = [];
  const service = createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    defaultBridgeUrl: "ws://127.0.0.1:8790/host",
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });

  assert.deepEqual(service.publicConfig(), {
    enabled: true,
    bridgeUrl: "ws://127.0.0.1:8790/host",
    polishContextConsent: "",
  });
  const result = publish(service, { bridge_url: "" });
  assert.equal(result.ok, true);
  assert.equal(FakeWebSocket.instances[0].url, "ws://127.0.0.1:8790/host");
  service.stop();
});

test("missing or invalid deployment default keeps VoxSpark disabled", () => {
  for (const defaultBridgeUrl of ["", "ws://192.168.10.48:8790/host"]) {
    const service = createVoxSparkSurfaceHostService({ defaultBridgeUrl });
    assert.deepEqual(service.publicConfig(), { enabled: false, bridgeUrl: "", polishContextConsent: "" });
    assert.equal(publish(service, { bridge_url: "" }).code, "invalid_bridge_url");
    service.stop();
  }
});

test("persistent Host preserves bounded terms and only consented polish context", () => {
  const richContext = context();
  richContext.local_context = {
    terms: [{ text: "Session A", boost: 6, source: "session" }],
  };
  richContext.polish_context = {
    consent: "bounded-context-v1",
    reference_conversation: [{ role: "user", text: "切回 Session A" }],
    composer_draft: "已有草稿",
    correction_rules: [{ heard: "三省A", write: "Session A" }],
    session_profile: "coding-agent",
    language_policy: "zh-CN-mixed",
  };
  const defaultOnly = normalizeContext(richContext);
  assert.deepEqual(defaultOnly.local_context.terms, richContext.local_context.terms);
  assert.equal(Object.hasOwn(defaultOnly, "polish_context"), false);

  const consented = normalizeContext(richContext, { polishContextConsent: "bounded-context-v1" });
  assert.deepEqual(consented.polish_context, richContext.polish_context);
  assert.equal(normalizeContext({ ...richContext, local_context: { terms: [{ text: "x", boost: 9, source: "session" }] } }), null);
  assert.equal(normalizeContext({
    ...richContext,
    polish_context: { ...richContext.polish_context, language_policy: "unsupported" },
  }, { polishContextConsent: "bounded-context-v1" }), null);
});

test("persistent backend owns Host socket and relays commands to the matching browser revision", () => {
  FakeWebSocket.instances = [];
  const logs = [];
  const service = createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    setTimeout: () => 1,
    clearTimeout() {},
    logger: {
      info(event, details) {
        logs.push({ event, details: details ? JSON.parse(details) : {} });
      },
    },
  });

  const first = publish(service);
  assert.equal(first.ok, true);
  assert.equal(first.connected, false);
  assert.equal(FakeWebSocket.instances.length, 1);

  const socket = FakeWebSocket.instances[0];
  socket.open();
  assert.equal(socket.sent.at(-1).type, "host.context");
  assert.equal(socket.sent.at(-1).composer.focused, true);
  assert.equal(socket.sent.at(-1).context_revision, 1);

  socket.message({
    type: "host.composer.replace",
    context_revision: 1,
    draft_revision: 9,
    capture_id: "capture-9",
    text: "Final draft",
  });
  const delivered = publish(service);
  assert.equal(delivered.connected, true);
  assert.deepEqual(delivered.commands, [{
    sequence: 1,
    message: {
      contract: CONTRACT,
      type: "host.composer.replace",
      context_revision: 1,
      draft_revision: 9,
      capture_id: "capture-9",
      text: "Final draft",
    },
  }]);
  assert.deepEqual(publish(service, {
    after_sequence: 1,
    service_epoch: first.service_epoch,
  }).commands, []);
  assert.ok(logs.some((entry) => (
    entry.event.includes("acknowledged")
    && entry.details.capture_ids.includes("capture-9")
  )));
  service.stop();
});

test("persistent backend preserves the browser draft release receipt for Bridge", () => {
  FakeWebSocket.instances = [];
  const service = createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  const releasedContext = context();
  releasedContext.composer.draft_revision = 3;
  releasedContext.composer.released_draft_revision = 3;

  publish(service, { context: releasedContext });
  const socket = FakeWebSocket.instances[0];
  socket.open();

  assert.equal(socket.sent.at(-1).composer.draft_revision, 3);
  assert.equal(socket.sent.at(-1).composer.released_draft_revision, 3);
  service.stop();
});

test("a restarted backend does not acknowledge new commands with an old service epoch", () => {
  FakeWebSocket.instances = [];
  const service = createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    serviceEpoch: "service-new",
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });

  publish(service, { after_sequence: 130, service_epoch: "service-old" });
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message({
    type: "host.composer.replace",
    context_revision: 1,
    draft_revision: 1,
    capture_id: "capture-after-restart",
    text: "Fresh draft",
  });

  const delivered = publish(service, { after_sequence: 130, service_epoch: "service-old" });
  assert.equal(delivered.service_epoch, "service-new");
  assert.equal(delivered.commands.length, 1);
  assert.equal(delivered.commands[0].sequence, 1);
  service.stop();
});

test("same browser revision refresh preserves and rebinds a pending Steer command", () => {
  FakeWebSocket.instances = [];
  const service = createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  const runningContext = context();
  runningContext.turn.state = "running";
  publish(service, { context: runningContext });
  const socket = FakeWebSocket.instances[0];
  socket.open();

  socket.message({
    type: "host.action",
    action: "steer",
    context_revision: 1,
    draft_revision: 9,
    capture_id: "capture-9",
    action_id: "capture-9:9:steer",
  });
  const delivered = publish(service, {
    surface_revision: 2,
    context: runningContext,
  });

  assert.equal(delivered.commands.length, 1);
  assert.equal(delivered.commands[0].sequence, 1);
  assert.equal(delivered.commands[0].message.action, "steer");
  assert.equal(delivered.commands[0].message.capture_id, "capture-9");
  assert.equal(delivered.commands[0].message.action_id, "capture-9:9:steer");
  assert.equal(delivered.commands[0].message.context_revision, 2);
  service.stop();
});

test("Host action results are replayed until Bridge acknowledges them", () => {
  FakeWebSocket.instances = [];
  const service = createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    serviceEpoch: "service-results",
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  const first = publish(service);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message({
    type: "host.action",
    action: "submit",
    context_revision: 1,
    draft_revision: 4,
    action_id: "a:test:4",
  });
  const delivered = publish(service);
  assert.equal(delivered.commands[0].message.action_id, "a:test:4");

  const accepted = publish(service, {
    service_epoch: first.service_epoch,
    after_sequence: delivered.commands[0].sequence,
    command_results: [{
      action_id: "a:test:4",
      outcome: "succeeded",
      retryable: false,
      error_code: "",
    }],
  });
  assert.deepEqual(accepted.accepted_result_ids, ["a:test:4"]);
  assert.equal(service.status().pending_results, 1);
  assert.equal(socket.sent.at(-1).type, "host.action.result");

  socket.message({ type: "bridge.ready" });
  assert.equal(socket.sent.at(-1).type, "host.action.result");
  socket.message({ type: "bridge.action.ack", action_id: "a:test:4" });
  assert.equal(service.status().pending_results, 0);
  const duplicate = publish(service, {
    service_epoch: first.service_epoch,
    after_sequence: delivered.commands[0].sequence,
    command_results: [{
      action_id: "a:test:4",
      outcome: "succeeded",
      retryable: false,
      error_code: "",
    }],
  });
  assert.deepEqual(duplicate.accepted_result_ids, ["a:test:4"]);
  assert.equal(service.status().pending_results, 0);
  service.stop();
});

test("a Host socket stuck connecting is abandoned and retried", () => {
  FakeWebSocket.instances = [];
  const timers = [];
  const service = createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    connectTimeoutMs: 500,
    reconnectMs: 100,
    setTimeout: (callback) => {
      const timer = { callback, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => { timer.cleared = true; },
    logger: { info() {} },
  });

  publish(service);
  assert.equal(FakeWebSocket.instances.length, 1);
  timers[0].callback();
  const reconnectTimer = timers.findLast((timer) => !timer.cleared);
  reconnectTimer.callback();

  assert.equal(FakeWebSocket.instances[0].readyState, FakeWebSocket.CLOSED);
  assert.equal(FakeWebSocket.instances.length, 2);
  service.stop();
});

test("expired browser lease disarms capture without dropping the persistent Host socket", () => {
  FakeWebSocket.instances = [];
  let now = 1_000;
  const timers = [];
  const service = createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    now: () => now,
    leaseMs: 5_000,
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    clearTimeout() {},
    logger: { info() {} },
  });
  publish(service);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  now += 5_100;
  timers.at(-1)();
  assert.equal(socket.readyState, FakeWebSocket.OPEN);
  assert.equal(socket.sent.at(-1).composer.focused, false);
  assert.equal(service.status().target_active, false);
  const expiredRevision = service.status().context_revision;
  publish(service);
  assert.equal(socket.sent.at(-1).composer.focused, true);
  assert.equal(service.status().context_revision, expiredRevision + 1);
  service.stop();
});

test("an older browser tab cannot replace the most recently armed Composer or drop its command", () => {
  FakeWebSocket.instances = [];
  const service = createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  publish(service, {
    client_id: "browser-old",
    context: context("session-old", true, 1000),
  });
  const socket = FakeWebSocket.instances[0];
  socket.open();

  publish(service, {
    client_id: "browser-current",
    context: context("session-current", true, 2000),
  });
  assert.equal(socket.sent.at(-1).session.id, "session-current");

  publish(service, {
    client_id: "browser-old",
    context: context("session-old", true, 1000),
  });
  assert.equal(socket.sent.at(-1).session.id, "session-current");

  socket.message({
    type: "host.composer.replace",
    context_revision: 2,
    draft_revision: 10,
    text: "Route only to the latest Composer",
  });
  assert.deepEqual(publish(service, {
    client_id: "browser-old",
    context: context("session-old", true, 1000),
  }).commands, []);
  const delivered = publish(service, {
    client_id: "browser-current",
    context: context("session-current", true, 2000),
  });
  assert.equal(delivered.commands.length, 1);
  assert.equal(delivered.commands[0].message.text, "Route only to the latest Composer");
  service.stop();
});

test("a newer browser on the same Session recovers an undelivered command", () => {
  FakeWebSocket.instances = [];
  const service = createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  publish(service, {
    client_id: "browser-original",
    context: context("session-original", true, 1000),
  });
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message({
    type: "host.action",
    action: "steer",
    context_revision: 1,
    draft_revision: 10,
  });

  const competing = publish(service, {
    client_id: "browser-newer",
    context: context("session-original", true, 2000),
  });
  assert.equal(competing.commands.length, 1);
  assert.equal(competing.commands[0].message.action, "steer");
  assert.equal(competing.commands[0].message.context_revision, 1);
  service.stop();
});

test("switching to another Session preserves commands for the original Session", () => {
  FakeWebSocket.instances = [];
  const service = createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  publish(service, {
    client_id: "browser-original",
    context: context("session-original", true, 1000),
  });
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message({
    type: "host.composer.replace",
    context_revision: 1,
    draft_revision: 10,
    text: "Keep this for the original Session.",
  });

  const otherSession = publish(service, {
    client_id: "browser-other",
    context: context("session-other", true, 2000),
  });
  assert.deepEqual(otherSession.commands, []);
  assert.equal(service.status().pending_commands, 1);

  const recovered = publish(service, {
    client_id: "browser-original",
    surface_revision: 2,
    context: context("session-original", true, 3000),
  });
  assert.equal(recovered.commands.length, 1);
  assert.equal(recovered.commands[0].message.text, "Keep this for the original Session.");
  service.stop();
});

test("explicit command acknowledgements do not consume another Session's command", () => {
  FakeWebSocket.instances = [];
  const service = createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    serviceEpoch: "service-explicit-ack",
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  const first = publish(service, {
    surface_revision: 1,
    context: context("session-a", true, 1000),
  });
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message({
    type: "host.composer.replace",
    context_revision: 1,
    draft_revision: 10,
    capture_id: "capture-session-a",
    text: "Keep Session A pending.",
  });

  const sessionB = context("session-b", true, 2000);
  assert.deepEqual(publish(service, {
    surface_revision: 2,
    context: sessionB,
  }).commands, []);
  socket.message({
    type: "host.action",
    action: "stop",
    context_revision: 2,
    action_id: "action-session-b",
  });
  const deliveredB = publish(service, {
    surface_revision: 2,
    service_epoch: first.service_epoch,
    acknowledged_sequences: [],
    context: sessionB,
  });
  assert.deepEqual(deliveredB.commands.map((item) => item.sequence), [2]);

  const acknowledgedB = publish(service, {
    surface_revision: 2,
    service_epoch: first.service_epoch,
    after_sequence: 2,
    acknowledged_sequences: [2],
    context: sessionB,
  });
  assert.deepEqual(acknowledgedB.accepted_command_sequences, [2]);

  const replayedAcknowledgement = publish(service, {
    surface_revision: 2,
    service_epoch: first.service_epoch,
    acknowledged_sequences: [2],
    context: sessionB,
  });
  assert.deepEqual(replayedAcknowledgement.accepted_command_sequences, [2]);
  assert.deepEqual(replayedAcknowledgement.commands, []);

  const restoredA = publish(service, {
    surface_revision: 3,
    service_epoch: first.service_epoch,
    after_sequence: 2,
    acknowledged_sequences: [],
    context: context("session-a", true, 3000),
  });
  assert.deepEqual(restoredA.commands.map((item) => item.sequence), [1]);
  service.stop();
});

test("an applied Composer append is not replayed after the Host service restarts", (t) => {
  FakeWebSocket.instances = [];
  const createStore = transactionStoreFixture(t);
  const createService = () => createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    transactionStore: createStore(),
    now: () => 1000,
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  const firstService = createService();
  const firstContext = publish(firstService);
  const firstSocket = FakeWebSocket.instances.at(-1);
  firstSocket.open();
  firstSocket.message({
    type: "host.composer.replace",
    append_id: "append-restart-applied",
    context_revision: 1,
    draft_revision: 41,
    capture_id: "capture-restart-applied",
    text: "Append this once.",
  });
  const delivered = publish(firstService);
  assert.deepEqual(delivered.commands.map((item) => item.sequence), [1]);
  assert.deepEqual(publish(firstService, {
    service_epoch: firstContext.service_epoch,
    acknowledged_sequences: [1],
  }).accepted_command_sequences, [1]);
  firstService.stop();

  const secondService = createService();
  publish(secondService);
  const secondSocket = FakeWebSocket.instances.at(-1);
  secondSocket.open();
  secondSocket.message({
    type: "host.composer.replace",
    append_id: "append-restart-applied",
    context_revision: 1,
    draft_revision: 41,
    capture_id: "capture-restart-applied",
    text: "Append this once.",
  });
  assert.deepEqual(publish(secondService).commands, []);
  assert.equal(secondService.status().pending_commands, 0);
  secondService.stop();
});

test("an undelivered Composer append keeps text off disk and accepts Bridge replay after restart", (t) => {
  FakeWebSocket.instances = [];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "voxspark-private-ledger-"));
  const filePath = path.join(directory, "surface-transactions.json");
  const privateText = "Private final transcript must stay in memory.";
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const createService = () => createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    transactionStore: createVoxSparkSurfaceTransactionStore({ filePath }),
    now: () => 1500,
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });

  const firstService = createService();
  publish(firstService);
  const firstSocket = FakeWebSocket.instances.at(-1);
  firstSocket.open();
  firstSocket.message({
    type: "host.composer.replace",
    append_id: "append-private-replay",
    context_revision: 1,
    draft_revision: 45,
    capture_id: "capture-private-replay",
    text: privateText,
  });
  const persisted = fs.readFileSync(filePath, "utf8");
  assert.equal(persisted.includes(privateText), false);
  assert.equal(persisted.includes("append-private-replay"), true);
  firstService.stop();

  const secondService = createService();
  assert.deepEqual(publish(secondService).commands, []);
  const secondSocket = FakeWebSocket.instances.at(-1);
  secondSocket.open();
  secondSocket.message({
    type: "host.composer.replace",
    append_id: "append-private-replay",
    context_revision: 1,
    draft_revision: 45,
    capture_id: "capture-private-replay",
    text: privateText,
  });
  const replayed = publish(secondService);
  assert.equal(replayed.commands.length, 1);
  assert.equal(replayed.commands[0].message.text, privateText);
  secondService.stop();
});

test("an uncertain Composer append reconciles from exact Host ownership after restart", (t) => {
  FakeWebSocket.instances = [];
  const createStore = transactionStoreFixture(t);
  const createService = () => createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    transactionStore: createStore(),
    now: () => 2000,
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  const firstService = createService();
  publish(firstService);
  const firstSocket = FakeWebSocket.instances.at(-1);
  firstSocket.open();
  firstSocket.message({
    type: "host.composer.replace",
    append_id: "append-restart-uncertain",
    context_revision: 1,
    draft_revision: 42,
    capture_id: "capture-restart-uncertain",
    text: "Reconcile this append.",
  });
  assert.deepEqual(publish(firstService).commands.map((item) => item.sequence), [1]);
  firstService.stop();

  const secondService = createService();
  const recoveredContext = context();
  recoveredContext.composer.ownership = "voxspark";
  recoveredContext.composer.draft_revision = 42;
  assert.deepEqual(publish(secondService, { context: recoveredContext }).commands, []);
  assert.equal(secondService.status().pending_commands, 0);
  assert.equal(secondService.status().uncertain_appends, 0);
  secondService.stop();
});

test("a delivered action becomes unknown after restart and a late success converges without replay", (t) => {
  FakeWebSocket.instances = [];
  const createStore = transactionStoreFixture(t);
  const createService = () => createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    transactionStore: createStore(),
    now: () => 3000,
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  const firstService = createService();
  publish(firstService);
  const firstSocket = FakeWebSocket.instances.at(-1);
  firstSocket.open();
  firstSocket.message({
    type: "host.action",
    action: "submit",
    action_id: "action-restart-uncertain",
    context_revision: 1,
    draft_revision: 43,
    capture_id: "capture-restart-uncertain",
  });
  assert.deepEqual(publish(firstService).commands.map((item) => item.sequence), [1]);
  firstService.stop();

  const secondService = createService();
  const recovered = publish(secondService);
  assert.deepEqual(recovered.commands, []);
  const secondSocket = FakeWebSocket.instances.at(-1);
  secondSocket.open();
  assert.ok(secondSocket.sent.some((item) => (
    item.type === "host.action.result" && item.action_id === "action-restart-uncertain"
      && item.outcome === "unknown"
  )));
  const late = publish(secondService, {
    service_epoch: recovered.service_epoch,
    command_results: [{
      action_id: "action-restart-uncertain",
      outcome: "succeeded",
      retryable: false,
      error_code: "",
    }],
  });
  assert.deepEqual(late.accepted_result_ids, ["action-restart-uncertain"]);
  assert.ok(secondSocket.sent.some((item) => (
    item.type === "host.action.result" && item.action_id === "action-restart-uncertain"
      && item.outcome === "succeeded"
  )));
  secondSocket.message({ type: "bridge.action.ack", action_id: "action-restart-uncertain" });
  secondService.stop();

  const thirdService = createService();
  publish(thirdService);
  const thirdSocket = FakeWebSocket.instances.at(-1);
  thirdSocket.open();
  thirdSocket.message({
    type: "host.action",
    action: "submit",
    action_id: "action-restart-uncertain",
    context_revision: 1,
    draft_revision: 43,
    capture_id: "capture-restart-uncertain",
  });
  assert.deepEqual(publish(thirdService).commands, []);
  assert.equal(thirdService.status().pending_commands, 0);
  thirdService.stop();
});

test("an acknowledged action without a result becomes unknown after restart", (t) => {
  FakeWebSocket.instances = [];
  const createStore = transactionStoreFixture(t);
  const createService = () => createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    transactionStore: createStore(),
    now: () => 3100,
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  const firstService = createService();
  const firstContext = publish(firstService);
  const firstSocket = FakeWebSocket.instances.at(-1);
  firstSocket.open();
  firstSocket.message({
    type: "host.action",
    action: "submit",
    action_id: "action-acked-before-result",
    context_revision: 1,
    draft_revision: 44,
    capture_id: "capture-acked-before-result",
  });
  assert.deepEqual(publish(firstService).commands.map((item) => item.sequence), [1]);
  assert.deepEqual(publish(firstService, {
    service_epoch: firstContext.service_epoch,
    acknowledged_sequences: [1],
  }).accepted_command_sequences, [1]);
  assert.equal(firstService.status().pending_commands, 0);
  firstService.stop();

  const secondService = createService();
  publish(secondService);
  const secondSocket = FakeWebSocket.instances.at(-1);
  secondSocket.open();
  assert.ok(secondSocket.sent.some((item) => (
    item.type === "host.action.result" && item.action_id === "action-acked-before-result"
      && item.outcome === "unknown"
  )));
  assert.equal(secondService.status().uncertain_actions, 1);
  secondService.stop();
});

test("Queue body is encrypted, survives backend restart, and transfers only with its Session", (t) => {
  FakeWebSocket.instances = [];
  const stores = persistentStoresFixture(t);
  const createService = () => createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    transactionStore: stores.createTransactionStore(),
    queueStore: stores.createQueueStore(),
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  const runningContext = context("session-a", true, 1000);
  runningContext.turn.state = "running";
  const firstService = createService();
  publish(firstService, { context: runningContext });
  const firstSocket = FakeWebSocket.instances.at(-1);
  firstSocket.open();
  firstSocket.message({
    type: "host.action",
    action: "queue",
    action_id: "queue-action-a",
    context_revision: 1,
    draft_revision: 8,
    capture_id: "capture-a",
  });
  publish(firstService, { context: runningContext });

  const queued = firstService.enqueueQueue({
    client_id: "browser-a",
    session_id: "session-a",
    queue_id: "queue-action-a",
    action_id: "queue-action-a",
    draft_revision: 8,
    capture_id: "capture-a",
    text: "Sensitive queued Composer body.",
  });
  assert.equal(queued.ok, true);
  assert.equal(queued.queue.status, "queued");
  const duplicate = firstService.enqueueQueue({
    client_id: "browser-a",
    session_id: "session-a",
    queue_id: "queue-action-a",
    action_id: "queue-action-a",
    draft_revision: 8,
    capture_id: "capture-a",
    text: "Sensitive queued Composer body.",
  });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.deduplicated, true);
  const encrypted = fs.readFileSync(stores.queueFile, "utf8");
  assert.doesNotMatch(encrypted, /Sensitive queued Composer body/);
  assert.doesNotMatch(encrypted, /session-a/);
  firstService.stop();

  const secondService = createService();
  const sessionB = publish(secondService, {
    client_id: "browser-after-refresh",
    surface_revision: 2,
    context: context("session-b", true, 2000),
  });
  assert.deepEqual(sessionB.queue, []);
  const recovered = publish(secondService, {
    client_id: "browser-after-refresh",
    surface_revision: 3,
    context: context("session-a", true, 3000),
  });
  assert.equal(recovered.queue.length, 1);
  assert.equal(recovered.queue[0].queue_id, "queue-action-a");
  assert.equal(recovered.queue[0].status, "queued");

  const claimed = secondService.claimQueue({
    client_id: "browser-after-refresh",
    session_id: "session-a",
    queue_id: "queue-action-a",
  });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.text, "Sensitive queued Composer body.");
  const completed = secondService.completeQueue({
    client_id: "browser-after-refresh",
    session_id: "session-a",
    queue_id: "queue-action-a",
    lease_token: claimed.lease_token,
    outcome: "succeeded",
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.queue.status, "submitted");

  const runningAfterSubmit = context("session-a", true, 3000);
  runningAfterSubmit.turn.state = "running";
  assert.equal(publish(secondService, {
    client_id: "browser-after-refresh",
    surface_revision: 4,
    context: runningAfterSubmit,
  }).queue[0].status, "processing");
  assert.deepEqual(publish(secondService, {
    client_id: "browser-after-refresh",
    surface_revision: 5,
    context: context("session-a", true, 3000),
  }).queue, []);
  secondService.stop();
});

test("a Queue lease becomes unknown after backend restart and is never reclaimed", (t) => {
  FakeWebSocket.instances = [];
  const stores = persistentStoresFixture(t);
  const createService = () => createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    transactionStore: stores.createTransactionStore(),
    queueStore: stores.createQueueStore(),
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  const runningContext = context("session-a", true, 1000);
  runningContext.turn.state = "running";
  const firstService = createService();
  publish(firstService, { context: runningContext });
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  socket.message({
    type: "host.action",
    action: "queue",
    action_id: "queue-uncertain",
    context_revision: 1,
    draft_revision: 9,
  });
  publish(firstService, { context: runningContext });
  assert.equal(firstService.enqueueQueue({
    client_id: "browser-a",
    session_id: "session-a",
    queue_id: "queue-uncertain",
    action_id: "queue-uncertain",
    draft_revision: 9,
    text: "Do not replay me after a crash.",
  }).ok, true);
  publish(firstService, { context: context("session-a", true, 1000) });
  const claimed = firstService.claimQueue({
    client_id: "browser-a",
    session_id: "session-a",
    queue_id: "queue-uncertain",
  });
  assert.equal(claimed.ok, true);
  firstService.stop();

  const secondService = createService();
  const restored = publish(secondService, {
    client_id: "browser-new",
    surface_revision: 2,
    context: context("session-a", true, 2000),
  });
  assert.equal(restored.queue[0].status, "unknown");
  assert.equal(secondService.claimQueue({
    client_id: "browser-new",
    session_id: "session-a",
    queue_id: "queue-uncertain",
  }).code, "queue_unknown");
  secondService.stop();
});

test("a stale browser cannot complete the active browser Queue lifecycle", (t) => {
  FakeWebSocket.instances = [];
  const stores = persistentStoresFixture(t);
  const service = createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    transactionStore: stores.createTransactionStore(),
    queueStore: stores.createQueueStore(),
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  const running = context("session-a", true, 1000);
  running.turn.state = "running";
  publish(service, { context: running });
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  socket.message({
    type: "host.action",
    action: "queue",
    action_id: "queue-owner-fence",
    context_revision: 1,
    draft_revision: 12,
  });
  publish(service, { context: running });
  assert.equal(service.enqueueQueue({
    client_id: "browser-a",
    session_id: "session-a",
    queue_id: "queue-owner-fence",
    action_id: "queue-owner-fence",
    draft_revision: 12,
    text: "Owner fencing test.",
  }).ok, true);
  publish(service, { context: context("session-a", true, 1000) });
  const claimed = service.claimQueue({
    client_id: "browser-a",
    session_id: "session-a",
    queue_id: "queue-owner-fence",
  });
  assert.equal(service.completeQueue({
    client_id: "browser-a",
    session_id: "session-a",
    queue_id: "queue-owner-fence",
    lease_token: claimed.lease_token,
    outcome: "succeeded",
  }).queue.status, "submitted");

  const ownerRunning = context("session-a", true, 2000);
  ownerRunning.turn.state = "running";
  assert.equal(publish(service, {
    client_id: "browser-b",
    surface_revision: 2,
    context: ownerRunning,
  }).queue[0].status, "processing");
  const stale = publish(service, {
    client_id: "browser-a",
    surface_revision: 3,
    context: context("session-a", true, 1000),
  });
  assert.deepEqual(stale.commands, []);
  assert.equal(publish(service, {
    client_id: "browser-b",
    surface_revision: 3,
    context: ownerRunning,
  }).queue[0].status, "processing");
  service.stop();
});

test("a submitted Queue becomes unknown after backend restart", (t) => {
  FakeWebSocket.instances = [];
  const stores = persistentStoresFixture(t);
  const createService = () => createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    transactionStore: stores.createTransactionStore(),
    queueStore: stores.createQueueStore(),
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  const running = context("session-a", true, 1000);
  running.turn.state = "running";
  const firstService = createService();
  publish(firstService, { context: running });
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  socket.message({
    type: "host.action",
    action: "queue",
    action_id: "queue-submitted-restart",
    context_revision: 1,
    draft_revision: 14,
  });
  publish(firstService, { context: running });
  assert.equal(firstService.enqueueQueue({
    client_id: "browser-a",
    session_id: "session-a",
    queue_id: "queue-submitted-restart",
    action_id: "queue-submitted-restart",
    draft_revision: 14,
    text: "Submitted before restart.",
  }).ok, true);
  publish(firstService, { context: context("session-a", true, 1000) });
  const claimed = firstService.claimQueue({
    client_id: "browser-a",
    session_id: "session-a",
    queue_id: "queue-submitted-restart",
  });
  assert.equal(firstService.completeQueue({
    client_id: "browser-a",
    session_id: "session-a",
    queue_id: "queue-submitted-restart",
    lease_token: claimed.lease_token,
    outcome: "succeeded",
  }).queue.status, "submitted");
  firstService.stop();

  const secondService = createService();
  const restored = publish(secondService, {
    client_id: "browser-b",
    surface_revision: 2,
    context: context("session-a", true, 2000),
  });
  assert.equal(restored.queue[0].status, "unknown");
  assert.equal(restored.queue[0].error_code, "queue_outcome_unknown_after_restart");
  secondService.stop();

  const thirdService = createService();
  const restoredAgain = publish(thirdService, {
    client_id: "browser-c",
    surface_revision: 3,
    context: context("session-a", true, 3000),
  });
  assert.equal(restoredAgain.queue[0].status, "unknown");
  assert.equal(restoredAgain.queue[0].error_code, "queue_outcome_unknown_after_restart");
  thirdService.stop();
});

test("Queue mutations roll back in memory when encrypted persistence fails", () => {
  FakeWebSocket.instances = [];
  let stored = null;
  let writable = true;
  const queueStore = {
    load: () => stored,
    save(entries) {
      if (!writable) return false;
      stored = structuredClone(entries);
      return true;
    },
    status: () => ({ lastWriteStatus: writable ? "ok" : "write-failed" }),
  };
  const service = createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    queueStore,
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  const running = context("session-a", true, 1000);
  running.turn.state = "running";
  publish(service, { context: running });
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  socket.message({
    type: "host.action",
    action: "queue",
    action_id: "queue-persist-failure",
    context_revision: 1,
    draft_revision: 15,
  });
  publish(service, { context: running });
  assert.equal(service.enqueueQueue({
    client_id: "browser-a",
    session_id: "session-a",
    queue_id: "queue-persist-failure",
    action_id: "queue-persist-failure",
    draft_revision: 15,
    text: "Persistence failure body.",
  }).ok, true);
  publish(service, { context: context("session-a", true, 1000) });

  writable = false;
  assert.equal(service.claimQueue({
    client_id: "browser-a",
    session_id: "session-a",
    queue_id: "queue-persist-failure",
  }).code, "queue_store_unavailable");
  const snapshot = service.queueSnapshot({ client_id: "browser-a", session_id: "session-a" });
  assert.equal(snapshot.items[0].status, "queued");
  service.stop();
});

test("an unreadable encrypted Queue store is not overwritten", (t) => {
  FakeWebSocket.instances = [];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "voxspark-service-unreadable-"));
  const filePath = path.join(directory, "queued-submissions.enc");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const originalStore = createVoxSparkEncryptedQueueStore({
    filePath,
    keyProvider: () => Buffer.alloc(32, 1),
  });
  assert.equal(originalStore.save([{ sentinel: "encrypted-state" }]), true);
  const originalEnvelope = fs.readFileSync(filePath, "utf8");
  const unreadableStore = createVoxSparkEncryptedQueueStore({
    filePath,
    keyProvider: () => Buffer.alloc(32, 2),
  });
  const service = createVoxSparkSurfaceHostService({
    WebSocket: FakeWebSocket,
    queueStore: unreadableStore,
    setTimeout: () => 1,
    clearTimeout() {},
    logger: { info() {} },
  });
  const running = context("session-a", true, 1000);
  running.turn.state = "running";
  publish(service, { context: running });
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  socket.message({
    type: "host.action",
    action: "queue",
    action_id: "queue-unreadable-store",
    context_revision: 1,
    draft_revision: 16,
  });
  publish(service, { context: running });
  assert.equal(service.enqueueQueue({
    client_id: "browser-a",
    session_id: "session-a",
    queue_id: "queue-unreadable-store",
    action_id: "queue-unreadable-store",
    draft_revision: 16,
    text: "Must not overwrite unreadable state.",
  }).code, "queue_store_unavailable");
  assert.equal(fs.readFileSync(filePath, "utf8"), originalEnvelope);
  assert.equal(service.status().queue_store, "decrypt-failed");
  service.stop();
});

test("authorized route exposes bounded context publish and status", async () => {
  const calls = [];
  const route = createVoxSparkSurfaceHostRouteService({
    service: {
      publish(body) { calls.push(["publish", body]); return { ok: true, connected: true }; },
      status() { calls.push(["status"]); return { connected: true }; },
      enqueueQueue(body) { calls.push(["enqueue", body]); return { ok: true, queue: { status: "queued" } }; },
      claimQueue(body) { calls.push(["claim", body]); return { ok: true, queue: { status: "leased" } }; },
      completeQueue(body) { calls.push(["complete", body]); return { ok: true, queue: { status: "submitted" } }; },
      cancelQueue(body) { calls.push(["cancel", body]); return { ok: true, queue: { status: "cancelled" } }; },
      queueSnapshot(body) { calls.push(["snapshot", body]); return { ok: true, items: [] }; },
    },
  });
  const sent = [];
  await route.handleRoute({
    url: new URL("http://127.0.0.1/api/voxspark/surface/context"),
    method: "POST",
    readBody: async () => ({ client_id: "a" }),
    sendJson: (status, body) => sent.push([status, body]),
  });
  await route.handleRoute({
    url: new URL("http://127.0.0.1/api/voxspark/surface/queue/enqueue"),
    method: "POST",
    readBody: async () => ({ queue_id: "queue-a" }),
    sendJson: (status, body) => sent.push([status, body]),
  });
  for (const operation of ["claim", "complete", "cancel", "snapshot"]) {
    await route.handleRoute({
      url: new URL(`http://127.0.0.1/api/voxspark/surface/queue/${operation}`),
      method: "POST",
      readBody: async () => ({ queue_id: `queue-${operation}` }),
      sendJson: (status, body) => sent.push([status, body]),
    });
  }
  await route.handleRoute({
    url: new URL("http://127.0.0.1/api/voxspark/surface/status"),
    method: "GET",
    sendJson: (status, body) => sent.push([status, body]),
  });
  assert.deepEqual(calls, [
    ["publish", { client_id: "a" }],
    ["enqueue", { queue_id: "queue-a" }],
    ["claim", { queue_id: "queue-claim" }],
    ["complete", { queue_id: "queue-complete" }],
    ["cancel", { queue_id: "queue-cancel" }],
    ["snapshot", { queue_id: "queue-snapshot" }],
    ["status"],
  ]);
  assert.deepEqual(sent, [
    [200, { ok: true, connected: true }],
    [200, { ok: true, queue: { status: "queued" } }],
    [200, { ok: true, queue: { status: "leased" } }],
    [200, { ok: true, queue: { status: "submitted" } }],
    [200, { ok: true, queue: { status: "cancelled" } }],
    [200, { ok: true, items: [] }],
    [200, { connected: true }],
  ]);
});
