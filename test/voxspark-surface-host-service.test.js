"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  CONTRACT,
  createVoxSparkSurfaceHostService,
  safeLoopbackBridgeUrl,
} = require("../services/runtime/voxspark-surface-host-service");
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
  });
  const result = publish(service, { bridge_url: "" });
  assert.equal(result.ok, true);
  assert.equal(FakeWebSocket.instances[0].url, "ws://127.0.0.1:8790/host");
  service.stop();
});

test("missing or invalid deployment default keeps VoxSpark disabled", () => {
  for (const defaultBridgeUrl of ["", "ws://192.168.10.48:8790/host"]) {
    const service = createVoxSparkSurfaceHostService({ defaultBridgeUrl });
    assert.deepEqual(service.publicConfig(), { enabled: false, bridgeUrl: "" });
    assert.equal(publish(service, { bridge_url: "" }).code, "invalid_bridge_url");
    service.stop();
  }
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

test("authorized route exposes bounded context publish and status", async () => {
  const calls = [];
  const route = createVoxSparkSurfaceHostRouteService({
    service: {
      publish(body) { calls.push(["publish", body]); return { ok: true, connected: true }; },
      status() { calls.push(["status"]); return { connected: true }; },
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
    url: new URL("http://127.0.0.1/api/voxspark/surface/status"),
    method: "GET",
    sendJson: (status, body) => sent.push([status, body]),
  });
  assert.deepEqual(calls, [["publish", { client_id: "a" }], ["status"]]);
  assert.deepEqual(sent, [[200, { ok: true, connected: true }], [200, { connected: true }]]);
});
