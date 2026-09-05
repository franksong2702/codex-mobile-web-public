"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const surfaceHost = require(path.join(root, "public", "voxspark-surface-host-runtime.js"));

test("classic Host Adapter and runtime wiring share one browser lexical scope", () => {
  const context = vm.createContext({
    URL,
    URLSearchParams,
    api: () => ({ ok: true }),
    console,
    module: undefined,
    window: {},
  });
  context.globalThis = context;

  for (const relativePath of [
    "public/voxspark-surface-host-runtime.js",
    "public/runtime-wiring-runtime.js",
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    vm.runInContext(source, context, { filename: relativePath });
  }

  assert.equal(typeof context.CodexVoxSparkSurfaceHostRuntime, "object");
  assert.equal(typeof context.CodexRuntimeWiringRuntime, "object");
  vm.runInContext('if (typeof api !== "function") throw new Error("api shadowed")', context);
});

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createFixture(options = {}) {
  const input = { contains: () => false };
  const documentListeners = new Map();
  const windowListeners = new Map();
  let documentHasFocus = options.documentHasFocus !== false;
  function emitDocument(type, event = {}) {
    for (const listener of documentListeners.get(type) || []) listener(event);
  }
  const document = {
    activeElement: options.composerInitiallyFocused === false ? null : input,
    visibilityState: "visible",
    hasFocus: () => documentHasFocus,
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      documentListeners.set(type, (documentListeners.get(type) || []).filter((item) => item !== listener));
    },
  };
  const window = {
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      windowListeners.set(type, (windowListeners.get(type) || []).filter((item) => item !== listener));
    },
  };
  let threadId = "session-a";
  let thread = options.thread || {
    id: "session-a",
    name: "VoxSpark Test",
    cwd: "/tmp/VoxSpark",
    turns: [],
  };
  let activeTurnId = options.activeTurnId || "";
  let composer = String(options.composer || "");
  const sends = [];
  const sendEvents = [];
  const backgroundSends = [];
  const interrupts = [];
  const diagnostics = [];
  const relayedContexts = [];
  const relayRequests = [];
  const queueRequests = [];
  const queueEntries = new Map();
  let nowMs = 1000;
  let runtime;
  const navigationTarget = {
    closest(selector) {
      return selector.includes("[data-thread]") ? this : null;
    },
  };
  const relay = options.relay || (async (payload) => {
    relayRequests.push(payload);
    relayedContexts.push({ type: "host.context", ...payload.context });
    const sessionId = payload.context.session.id;
    const turnState = payload.context.turn.state;
    for (const [queueId, entry] of queueEntries) {
      if (entry.session_id !== sessionId) continue;
      if (turnState === "running" && entry.status === "submitted") entry.status = "processing";
      else if (turnState === "idle" && entry.status === "processing") queueEntries.delete(queueId);
    }
    return {
      ok: true,
      connected: true,
      commands: [],
      queue: [...queueEntries.values()]
        .filter((item) => item.session_id === sessionId)
        .map(({ text: _text, ...item }) => item),
    };
  });
  const queueRequest = options.queueRequest || (async (operation, payload) => {
    queueRequests.push({ operation, payload: { ...payload } });
    if (operation === "enqueue") {
      const entry = {
        queue_id: payload.queue_id,
        action_id: payload.action_id,
        session_id: payload.session_id,
        draft_revision: payload.draft_revision,
        status: "queued",
        text: payload.text,
      };
      queueEntries.set(entry.queue_id, entry);
      return { ok: true, queue: { ...entry, text: undefined } };
    }
    if (operation === "claim") {
      const entry = queueEntries.get(payload.queue_id);
      if (!entry) return { ok: false, code: "queue_not_found" };
      entry.status = "leased";
      return {
        ok: true,
        lease_token: `lease-${entry.queue_id}`,
        client_submission_id: `voxspark-${entry.action_id}`,
        text: entry.text,
        queue: { ...entry, text: undefined },
      };
    }
    if (operation === "complete") {
      const entry = queueEntries.get(payload.queue_id);
      if (!entry) return { ok: false, code: "queue_not_found" };
      entry.status = payload.outcome === "succeeded" ? "submitted" : payload.outcome;
      return { ok: true, queue: { ...entry, text: undefined } };
    }
    return { ok: false, code: "unsupported_queue_operation" };
  });
  runtime = surfaceHost.createVoxSparkSurfaceHostRuntime({
    bridgeUrl: "ws://127.0.0.1:8790/host",
    relay,
    queueRequest,
    clientId: "surface-test",
    document,
    window,
    $: (id) => id === "messageInput" ? input : null,
    currentComposerThreadId: () => threadId,
    composerTargetThread: () => ({ ...thread, id: threadId }),
    composerTargetActiveTurnId: () => activeTurnId,
    composerText: () => composer,
    setComposerText: (value) => { composer = String(value || ""); },
    sendMessage: async (event) => {
      sendEvents.push(event || {});
      sends.push({ threadId, text: composer, activeTurnId });
      if (typeof options.sendBarrier === "function") await options.sendBarrier();
      if (options.sendError) throw options.sendError;
      const sendSucceeds = typeof options.sendSucceeds === "function"
        ? options.sendSucceeds(sends.length)
        : options.sendSucceeds !== false;
      if (sendSucceeds) composer = "";
      if (options.blurAfterSend) {
        document.activeElement = null;
        emitDocument("focusout", { target: input, relatedTarget: null });
      }
    },
    sendDraft: async (draft) => {
      backgroundSends.push({ ...draft });
      if (options.sendError) throw options.sendError;
      if (options.sendSucceeds === false) throw new Error("queue_send_failed");
      return true;
    },
    interruptActiveTurn: async (...args) => { interrupts.push(args); },
    threadWorkspace: () => "VoxSpark",
    report: (code, detail) => diagnostics.push({ code, detail }),
    now: () => nowMs,
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    polishContextConsent: options.polishContextConsent,
  });
  assert.equal(runtime.start(), true);
  const socket = {
    sent: relayedContexts,
    message(payload) { runtime.handleMessage(payload); },
  };
  return {
    runtime,
    socket,
    sends,
    sendEvents,
    backgroundSends,
    interrupts,
    diagnostics,
    relayRequests,
    queueRequests,
    get composer() { return composer; },
    set composer(value) { composer = String(value || ""); },
    set activeTurnId(value) { activeTurnId = value; },
    set threadId(value) { threadId = value; },
    set thread(value) { thread = value || {}; },
    advance(ms) { nowMs += ms; },
    pointerAway() {
      const other = {};
      emitDocument("pointerdown", { target: other });
      document.activeElement = other;
      emitDocument("focusout", { target: input, relatedTarget: other });
    },
    switchSessionWhileComposerRetainsFocus(value) {
      emitDocument("pointerdown", { target: navigationTarget });
      threadId = value;
      runtime.syncContext();
    },
    switchSessionFromNavigation(value) {
      emitDocument("pointerdown", { target: navigationTarget });
      document.activeElement = navigationTarget;
      emitDocument("focusout", { target: input, relatedTarget: navigationTarget });
      threadId = value;
      runtime.syncContext();
    },
    reportPassiveSessionId(value) {
      threadId = value;
      runtime.syncContext();
    },
    setVisibility(value) {
      document.visibilityState = value;
      emitDocument("visibilitychange", { target: document });
    },
    setWindowFocus(value) {
      documentHasFocus = Boolean(value);
      for (const listener of windowListeners.get(value ? "focus" : "blur") || []) listener();
    },
    focusComposer() {
      document.activeElement = input;
      emitDocument("focusin", { target: input });
    },
  };
}

function message(type, fields = {}) {
  return { type, contract: surfaceHost.CONTRACT, ...fields };
}

test("VoxSpark Host Adapter is opt-in and accepts only credential-free /host WebSockets", () => {
  assert.equal(surfaceHost.safeBridgeUrl("http://127.0.0.1:8790/host"), "");
  assert.equal(surfaceHost.safeBridgeUrl("ws://user:secret@127.0.0.1:8790/host"), "");
  assert.equal(surfaceHost.safeBridgeUrl("ws://127.0.0.1:8790/box"), "");
  assert.equal(surfaceHost.safeBridgeUrl("ws://127.0.0.1:8790/host?token=secret"), "");
  assert.equal(surfaceHost.safeBridgeUrl("ws://127.0.0.1:8790/host"), "ws://127.0.0.1:8790/host");
  const disabled = surfaceHost.createVoxSparkSurfaceHostRuntime({ relay: async () => ({ ok: true }) });
  assert.equal(disabled.start(), false);
  assert.equal(disabled.configureBridgeUrl("ws://127.0.0.1:8790/host"), true);
  assert.equal(disabled.readState().enabled, true);
  disabled.stop();
});

test("VoxSpark Host Adapter is present in classic and native ESM shells", async () => {
  const indexHtml = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "public", "shell-asset-manifest.json"), "utf8"));
  assert.match(indexHtml, /<script src="\/voxspark-surface-host-runtime\.js"><\/script>/);
  assert.ok(manifest.scriptAssets.includes("/voxspark-surface-host-runtime.js"));
  assert.ok(manifest.hashAssets.includes("/voxspark-surface-host-runtime.js"));
  const nativeUrl = `${pathToFileURL(path.join(root, "frontend", "native", "voxspark-surface-host-runtime.mjs")).href}?test=${Date.now()}`;
  const native = await import(nativeUrl);
  assert.equal(typeof native.createVoxSparkSurfaceHostRuntime, "function");
  assert.equal(native.CONTRACT, surfaceHost.CONTRACT);
  assert.equal(native.POLISH_CONTEXT_CONSENT, "bounded-context-v1");
  assert.deepEqual(
    native.correctionCandidate("切回三省A", "切回Session A"),
    surfaceHost.correctionCandidate("切回三省A", "切回Session A"),
  );
  assert.equal(native.appendComposerText("Existing.", "Voice."), "Existing. Voice.");
  assert.equal(native.appendComposerText("Existing. ", "Voice."), "Existing. Voice.");
  assert.equal(native.appendComposerText("", "Voice."), surfaceHost.appendComposerText("", "Voice."));
});

test("classic and native runtime wiring publish the same content-free trace fields", () => {
  for (const relativePath of [
    "public/runtime-wiring-runtime.js",
    "frontend/native/runtime-wiring-runtime.mjs",
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    const reportStart = source.indexOf('postClientEvent("voxspark_surface_host"');
    assert.ok(reportStart >= 0, relativePath);
    const reportBody = source.slice(reportStart, source.indexOf("}),", reportStart) + 3);
    assert.match(reportBody, /outcome:/, relativePath);
    assert.match(reportBody, /captureId:/, relativePath);
    assert.match(reportBody, /actionId:/, relativePath);
    assert.match(reportBody, /commandSequence:/, relativePath);
  }
});

test("Composer success notifies the Surface Host through runtime wiring", () => {
  const composerSource = fs.readFileSync(path.join(root, "frontend", "native", "composer-runtime.mjs"), "utf8");
  const wiringSource = fs.readFileSync(path.join(root, "frontend", "native", "runtime-wiring-runtime.mjs"), "utf8");
  assert.match(composerSource, /function notifyComposerSubmitted[\s\S]*onComposerSubmitted\(details\)/);
  assert.match(composerSource, /notifyComposerSubmitted\(\{[\s\S]*threadId: targetThreadId/);
  assert.match(wiringSource, /onComposerSubmitted:[\s\S]*handleComposerSubmission/);
});

test("public config activates the deployment default after the Host runtime is wired", () => {
  for (const relativePath of [
    "public/app-shell-runtime.js",
    "frontend/native/app-shell-runtime.mjs",
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.match(
      source,
      /config\.voxspark[\s\S]*config\.voxspark\.enabled[\s\S]*!window\.voxsparkSurfaceHostRuntime\.readState\(\)\.enabled[\s\S]*voxsparkSurfaceHostRuntime\.configureBridgeUrl\(config\.voxspark\.bridgeUrl\)/,
    );
    assert.match(source, /configurePolishContextConsent\(config\.voxspark\.polishContextConsent\)/);
  }
});

test("final-only draft fills an empty focused Composer and idle Send submits once", async () => {
  const fixture = createFixture();
  const revision = fixture.runtime.readState().contextRevision;
  assert.equal(revision, 1);
  assert.ok(fixture.socket.sent.some((item) => item.type === "host.context" && item.session.id === "session-a"));

  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 7,
    capture_id: "capture-7",
    text: "Implement the focused Session change.",
  }));
  assert.equal(fixture.composer, "Implement the focused Session change.");

  fixture.socket.message(message("host.action", {
    action: "submit",
    context_revision: revision,
    draft_revision: 7,
    capture_id: "capture-7",
    action_id: "capture-7:7:submit",
  }));
  await nextTurn();
  assert.deepEqual(fixture.sends, [{
    threadId: "session-a",
    text: "Implement the focused Session change.",
    activeTurnId: "",
  }]);
  assert.equal(fixture.sendEvents[0].clientSubmissionId, "voxspark-capture-7:7:submit");
  assert.ok(fixture.diagnostics.some((item) => (
    item.code === "composer_replace_confirmed"
    && item.detail.captureId === "capture-7"
  )));
  assert.ok(fixture.diagnostics.some((item) => (
    item.code === "host_action_confirmed"
    && item.detail.actionId === "capture-7:7:submit"
  )));

  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision - 1,
    draft_revision: 8,
    text: "This stale draft must not appear.",
  }));
  assert.notEqual(fixture.composer, "This stale draft must not appear.");
});

test("voice drafts append after existing Composer text without overwriting it", () => {
  const fixture = createFixture({ composer: "Keep the typed text." });
  const revision = fixture.runtime.readState().contextRevision;

  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 8,
    text: "Append the first voice segment.",
  }));
  assert.equal(fixture.composer, "Keep the typed text. Append the first voice segment.");

  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 9,
    text: "Append the second voice segment.",
  }));
  assert.equal(
    fixture.composer,
    "Keep the typed text. Append the first voice segment. Append the second voice segment."
  );
});

test("hardware Send submits the current Composer after later manual edits", async () => {
  const fixture = createFixture({ composer: "Existing text." });
  const revision = fixture.runtime.readState().contextRevision;
  await fixture.runtime.handleMessage(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 10,
    capture_id: "capture-manual-edit",
    text: "Voice text.",
  }));
  fixture.composer = `${fixture.composer} Manual edit.`;

  const outcome = await fixture.runtime.handleMessage(message("host.action", {
    action: "submit",
    context_revision: revision,
    draft_revision: 10,
    capture_id: "capture-manual-edit",
    action_id: "capture-manual-edit:10:submit",
  }), { sequence: 12 });

  assert.equal(outcome, "accepted");
  assert.deepEqual(fixture.sends, [{
    threadId: "session-a",
    text: "Existing text. Voice text. Manual edit.",
    activeTurnId: "",
  }]);
  assert.equal(fixture.composer, "");
  const state = fixture.runtime.readState();
  assert.equal(state.activeDraft, null);
  assert.deepEqual(state.pendingCommandResults, [{
    action_id: "capture-manual-edit:10:submit",
    outcome: "succeeded",
    retryable: false,
    error_code: "",
  }]);
});

test("a successful browser Composer submit releases the matching BOX draft", async () => {
  const fixture = createFixture({ composer: "Existing text." });
  const revision = fixture.runtime.readState().contextRevision;
  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 13,
    capture_id: "capture-browser-submit",
    text: "Voice text.",
  }));
  fixture.composer = `${fixture.composer} Manual edit.`;

  const released = fixture.runtime.handleComposerSubmission({ threadId: "session-a" });
  await nextTurn();
  fixture.runtime.syncContext({ force: true });
  await nextTurn();

  assert.equal(released, true);
  assert.equal(fixture.runtime.readState().activeDraft, null);
  const context = fixture.relayRequests.at(-1).context;
  assert.equal(context.composer.ownership, "none");
  assert.equal(context.composer.draft_revision, 0);
  assert.equal(context.composer.released_draft_revision, 13);
  assert.ok(fixture.diagnostics.some((item) => (
    item.code === "composer_draft_released_after_submit"
    && item.detail.draftRevision === 13
  )));
});

test("browser accepts low command sequences after the persistent Host service restarts", async () => {
  const relayRequests = [];
  let call = 0;
  const fixture = createFixture({
    relay: async (payload) => {
      relayRequests.push(payload);
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          connected: true,
          service_epoch: "service-old",
          commands: [{
            sequence: 130,
            message: message("host.composer.replace", {
              context_revision: 1,
              draft_revision: 1,
              text: "First draft.",
            }),
          }],
        };
      }
      return {
        ok: true,
        connected: true,
        service_epoch: "service-new",
        commands: [{
          sequence: 1,
          message: message("host.composer.replace", {
            context_revision: 1,
            draft_revision: 2,
            text: "Draft after restart.",
          }),
        }],
      };
    },
  });

  await nextTurn();
  assert.equal(fixture.composer, "First draft.");
  fixture.runtime.syncContext({ force: true });
  await nextTurn();

  assert.equal(relayRequests[1].service_epoch, "service-old");
  assert.equal(fixture.composer, "First draft. Draft after restart.");
});

test("a browser submit from another Session cannot release the active BOX draft", () => {
  const fixture = createFixture();
  const revision = fixture.runtime.readState().contextRevision;
  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 14,
    text: "Keep this Session draft.",
  }));

  assert.equal(fixture.runtime.handleComposerSubmission({ threadId: "session-b" }), false);
  assert.equal(fixture.runtime.readState().activeDraft.draftRevision, 14);
});

test("running Session keeps Queue distinct from Steer and Stop", async () => {
  const fixture = createFixture({ activeTurnId: "turn-a" });
  let revision = fixture.runtime.readState().contextRevision;

  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 10,
    text: "Run this after the current turn.",
  }));
  fixture.socket.message(message("host.action", {
    action: "queue",
    action_id: "queue-10",
    context_revision: revision,
    draft_revision: 10,
  }));
  await nextTurn();
  assert.equal(fixture.sends.length, 0);
  assert.equal(fixture.composer, "");
  assert.equal(fixture.runtime.readState().queuedDrafts.length, 1);

  fixture.activeTurnId = "";
  fixture.runtime.syncContext();
  await nextTurn();
  assert.equal(fixture.backgroundSends.length, 1);
  assert.equal(fixture.backgroundSends[0].text, "Run this after the current turn.");
  assert.equal(fixture.runtime.readState().queuedDrafts[0].status, "submitted");

  fixture.activeTurnId = "turn-b";
  fixture.runtime.syncContext();
  revision = fixture.runtime.readState().contextRevision;
  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 11,
    text: "Steer the running turn.",
  }));
  fixture.socket.message(message("host.action", {
    action: "steer",
    context_revision: revision,
    draft_revision: 11,
  }));
  await nextTurn();
  assert.equal(fixture.sends.at(-1).activeTurnId, "turn-b");
  assert.equal(fixture.sends.at(-1).text, "Steer the running turn.");

  fixture.socket.message(message("host.action", {
    action: "stop",
    context_revision: revision,
  }));
  await nextTurn();
  assert.deepEqual(fixture.interrupts, [["session-a", "turn-b"]]);
});

test("multiple queued drafts require a complete running-to-idle observation between sends", async () => {
  const fixture = createFixture({ activeTurnId: "turn-a" });
  let revision = fixture.runtime.readState().contextRevision;
  for (const [draftRevision, draftText] of [[20, "First queued draft"], [21, "Second queued draft"]]) {
    fixture.socket.message(message("host.composer.replace", {
      context_revision: revision,
      draft_revision: draftRevision,
      text: draftText,
    }));
    fixture.socket.message(message("host.action", {
      action: "queue",
      action_id: `queue-${draftRevision}`,
      context_revision: revision,
      draft_revision: draftRevision,
    }));
    await nextTurn();
  }
  assert.equal(fixture.runtime.readState().queuedDrafts.length, 2);

  fixture.activeTurnId = "";
  fixture.runtime.syncContext();
  await nextTurn();
  assert.deepEqual(fixture.backgroundSends.map((item) => item.text), ["First queued draft"]);
  fixture.runtime.syncContext();
  await nextTurn();
  assert.deepEqual(fixture.backgroundSends.map((item) => item.text), ["First queued draft"]);

  fixture.advance(2000);
  fixture.runtime.syncContext();
  await nextTurn();
  assert.deepEqual(fixture.backgroundSends.map((item) => item.text), ["First queued draft"]);

  fixture.activeTurnId = "turn-b";
  fixture.runtime.syncContext();
  await nextTurn();
  assert.equal(fixture.runtime.readState().queueTurnGate, "awaiting_idle");
  fixture.activeTurnId = "";
  fixture.runtime.syncContext();
  await nextTurn();
  assert.deepEqual(fixture.backgroundSends.map((item) => item.text), ["First queued draft", "Second queued draft"]);
});

test("failed send keeps the owned draft and queued entry available", async () => {
  const fixture = createFixture({ activeTurnId: "turn-a", sendSucceeds: false });
  const revision = fixture.runtime.readState().contextRevision;
  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 30,
    text: "Keep this draft after failure.",
  }));
  fixture.socket.message(message("host.action", {
    action: "queue",
    action_id: "queue-30",
    context_revision: revision,
    draft_revision: 30,
  }));
  await nextTurn();

  fixture.activeTurnId = "";
  fixture.runtime.syncContext();
  await nextTurn();
  assert.equal(fixture.runtime.readState().queuedDrafts.length, 1);
  assert.equal(fixture.runtime.readState().queuedDrafts[0].status, "failed");
  assert.equal(fixture.composer, "");
});

test("failed hardware Send reports failure without automatically sending twice", async () => {
  const relayRequests = [];
  const fixture = createFixture({
    sendSucceeds: (attempt) => attempt > 1,
    relay: async (payload) => {
      relayRequests.push(payload);
      return {
        ok: true,
        connected: true,
        accepted_result_ids: payload.command_results.map((item) => item.action_id),
        commands: payload.after_sequence === 0 ? [
          {
            sequence: 1,
            message: message("host.composer.replace", {
              context_revision: 1,
              draft_revision: 31,
              capture_id: "capture-31",
              text: "Keep this draft until Send succeeds.",
            }),
          },
          {
            sequence: 2,
            message: message("host.action", {
              action: "submit",
              context_revision: 1,
              draft_revision: 31,
              capture_id: "capture-31",
              action_id: "capture-31:31:submit",
            }),
          },
        ] : [],
      };
    },
  });

  await nextTurn();
  assert.equal(fixture.composer, "Keep this draft until Send succeeds.");
  fixture.runtime.syncContext();
  await nextTurn();

  assert.equal(relayRequests.at(-1).after_sequence, 0);
  assert.deepEqual(relayRequests.at(-1).acknowledged_sequences, [1, 2]);
  assert.equal(fixture.sends.length, 1);
  assert.equal(fixture.composer, "Keep this draft until Send succeeds.");
  assert.ok(fixture.diagnostics.some((item) => (
    item.code === "host_action_retry"
    && item.detail.commandSequence === 2
    && item.detail.actionId === "capture-31:31:submit"
  )));
  fixture.runtime.syncContext();
  await nextTurn();
  assert.equal(relayRequests.at(-1).after_sequence, 0);
  assert.deepEqual(relayRequests.at(-1).acknowledged_sequences, [1, 2]);
  const resultRequest = relayRequests.find((request) => request.command_results.length > 0);
  assert.deepEqual(resultRequest.command_results, [{
    action_id: "capture-31:31:submit",
    outcome: "failed",
    retryable: true,
    error_code: "action_failed",
  }]);
  assert.deepEqual(fixture.runtime.readState().pendingCommandResults, []);
});

test("recovered uncertain submission reports unknown without automatic retry", async () => {
  const relayRequests = [];
  const sendError = new Error("VoxSpark submission outcome is unknown after restart");
  sendError.code = "voxspark_submission_outcome_unknown";
  const fixture = createFixture({
    sendError,
    relay: async (payload) => {
      relayRequests.push(payload);
      return {
        ok: true,
        connected: true,
        accepted_result_ids: payload.command_results.map((item) => item.action_id),
        commands: payload.after_sequence === 0 ? [
          {
            sequence: 1,
            message: message("host.composer.replace", {
              context_revision: 1,
              draft_revision: 311,
              capture_id: "capture-uncertain",
              text: "Do not blindly submit this twice.",
            }),
          },
          {
            sequence: 2,
            message: message("host.action", {
              action: "submit",
              context_revision: 1,
              draft_revision: 311,
              capture_id: "capture-uncertain",
              action_id: "capture-uncertain:311:submit",
            }),
          },
        ] : [],
      };
    },
  });

  await nextTurn();
  fixture.runtime.syncContext();
  await nextTurn();

  assert.equal(fixture.sends.length, 1);
  assert.equal(fixture.composer, "Do not blindly submit this twice.");
  const resultRequest = relayRequests.find((request) => request.command_results.length > 0);
  assert.deepEqual(resultRequest.command_results, [{
    action_id: "capture-uncertain:311:submit",
    outcome: "unknown",
    retryable: false,
    error_code: "action_outcome_unknown",
  }]);
  fixture.runtime.syncContext();
  await nextTurn();
  assert.equal(fixture.sends.length, 1);
});

test("slow hardware Send does not block a Session switch context relay", async () => {
  let releaseSend;
  const sendBarrier = () => new Promise((resolve) => { releaseSend = resolve; });
  const relayRequests = [];
  const fixture = createFixture({
    sendBarrier,
    relay: async (payload) => {
      relayRequests.push(payload);
      return {
        ok: true,
        connected: true,
        accepted_result_ids: payload.command_results.map((item) => item.action_id),
        commands: payload.after_sequence === 0 ? [
          {
            sequence: 1,
            message: message("host.composer.replace", {
              context_revision: 1,
              draft_revision: 32,
              capture_id: "capture-32",
              text: "Send without blocking Session navigation.",
            }),
          },
          {
            sequence: 2,
            message: message("host.action", {
              action: "submit",
              context_revision: 1,
              draft_revision: 32,
              capture_id: "capture-32",
              action_id: "capture-32:32:submit",
            }),
          },
        ] : [],
      };
    },
  });

  await nextTurn();
  assert.equal(typeof releaseSend, "function");
  fixture.switchSessionFromNavigation("session-b");
  await nextTurn();
  assert.equal(relayRequests.at(-1).context.session.id, "session-b");
  assert.equal(relayRequests.at(-1).after_sequence, 0);
  assert.deepEqual(relayRequests.at(-1).acknowledged_sequences, [1]);
  assert.deepEqual(relayRequests.at(-1).command_results, []);
  assert.equal(fixture.sends.length, 1);

  releaseSend();
  await nextTurn();
  await nextTurn();
  const resultRequestIndex = relayRequests.findIndex((request) => request.command_results.some((result) => (
    result.action_id === "capture-32:32:submit" && result.outcome === "succeeded"
  )));
  assert.equal(relayRequests[resultRequestIndex].after_sequence, 0);
  assert.ok(relayRequests.slice(resultRequestIndex + 1).some((request) => (
    request.acknowledged_sequences.includes(2)
  )));
});

test("selected Composer target stays armed across blur and conversation navigation", async () => {
  const fixture = createFixture({ blurAfterSend: true });
  let revision = fixture.runtime.readState().contextRevision;
  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 40,
    text: "First hardware instruction.",
  }));
  fixture.socket.message(message("host.action", {
    action: "submit",
    context_revision: revision,
    draft_revision: 40,
  }));
  await nextTurn();
  assert.equal(fixture.runtime.readState().armedSessionId, "session-a");
  assert.equal(fixture.runtime.readState().currentContext.focused, true);
  assert.equal(fixture.runtime.readState().currentContext.armedAt, 1000);

  revision = fixture.runtime.readState().contextRevision;
  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 41,
    text: "Second hardware instruction.",
  }));
  assert.equal(fixture.composer, "Second hardware instruction.");

  fixture.pointerAway();
  const state = fixture.runtime.readState();
  assert.equal(state.armedSessionId, "session-a");
  assert.equal(state.currentContext.focused, true);
  fixture.socket.message(message("host.composer.replace", {
    context_revision: state.contextRevision,
    draft_revision: 42,
    text: "Continue targeting the selected Composer.",
  }));
  assert.equal(
    fixture.composer,
    "Second hardware instruction. Continue targeting the selected Composer."
  );
});

test("a hidden page keeps its selection but gives up active hardware input ownership", () => {
  const fixture = createFixture();
  assert.equal(fixture.runtime.readState().armedSessionId, "session-a");
  fixture.setVisibility("hidden");
  assert.equal(fixture.runtime.readState().armedSessionId, "session-a");
  assert.equal(fixture.runtime.readState().currentContext.focused, false);
  assert.equal(fixture.runtime.readState().currentContext.armedAt, 1000);

  fixture.setVisibility("visible");
  assert.equal(fixture.runtime.readState().armedSessionId, "session-a");
  assert.equal(fixture.runtime.readState().currentContext.focused, true);
});

test("an armed browser keeps hardware ownership while another desktop app is focused", () => {
  const fixture = createFixture();
  fixture.setWindowFocus(false);
  assert.equal(fixture.runtime.readState().armedSessionId, "session-a");
  assert.equal(fixture.runtime.readState().currentContext.focused, true);

  fixture.advance(500);
  fixture.setWindowFocus(true);
  assert.equal(fixture.runtime.readState().currentContext.focused, true);
  assert.equal(fixture.runtime.readState().currentContext.armedAt, 1500);
});

test("a background page that was never armed cannot claim hardware ownership", () => {
  const fixture = createFixture({ documentHasFocus: false });
  assert.equal(fixture.runtime.readState().armedSessionId, "");
  assert.equal(fixture.runtime.readState().currentContext.focused, false);

  fixture.advance(500);
  fixture.setWindowFocus(true);
  assert.equal(fixture.runtime.readState().armedSessionId, "session-a");
  assert.equal(fixture.runtime.readState().currentContext.focused, true);
  assert.equal(fixture.runtime.readState().currentContext.armedAt, 1500);
});

test("Session switch re-arms a retained Composer without a second focus event", () => {
  const fixture = createFixture();
  fixture.switchSessionWhileComposerRetainsFocus("session-b");
  const state = fixture.runtime.readState();
  assert.equal(state.currentContext.sessionId, "session-b");
  assert.equal(state.armedSessionId, "session-b");
  assert.equal(state.currentContext.focused, true);
});

test("Host context sends bounded terms from the current Session and Composer", async () => {
  const fixture = createFixture({
    composer: "继续处理 VoxSpark Composer 的输入。",
    thread: {
      id: "session-a",
      name: "VoxSpark Test",
      cwd: "/tmp/VoxSpark",
      turns: [{
        items: [
          { type: "userMessage", text: "在 Session A 里验证 VoxSpark。" },
          { type: "agentMessage", text: "继续检查 Composer。" },
          { type: "commandExecution", text: "private tool output" },
        ],
      }],
    },
  });
  await nextTurn();

  const terms = fixture.relayRequests.at(-1).context.local_context.terms;
  assert.ok(terms.some((term) => term.text === "Session A"));
  assert.ok(terms.some((term) => term.text === "VoxSpark"));
  assert.ok(terms.some((term) => term.text === "Composer" && term.source === "composer"));
  assert.equal(terms.some((term) => term.text.includes("private tool output")), false);
  assert.ok(terms.length <= 32);
});

test("rich polish context is absent by default and bounded when explicitly enabled", async () => {
  const thread = {
    id: "session-a",
    name: "VoxSpark coding",
    cwd: "/tmp/VoxSpark",
    turns: [{
      items: [
        { type: "userMessage", text: "请切回 Session A。" },
        { type: "agentMessage", text: "正在检查 VoxSpark。" },
        { type: "commandExecution", text: "private tool output" },
      ],
    }],
  };
  const defaultFixture = createFixture({ thread, composer: "已有草稿" });
  await nextTurn();
  assert.equal(Object.hasOwn(defaultFixture.relayRequests.at(-1).context, "polish_context"), false);

  const consentedFixture = createFixture({
    thread,
    composer: "已有草稿",
    polishContextConsent: "bounded-context-v1",
  });
  await nextTurn();
  const polish = consentedFixture.relayRequests.at(-1).context.polish_context;
  assert.equal(polish.consent, "bounded-context-v1");
  assert.equal(polish.composer_draft, "已有草稿");
  assert.deepEqual(polish.reference_conversation, [
    { role: "user", text: "请切回 Session A。" },
    { role: "assistant", text: "正在检查 VoxSpark。" },
  ]);
  assert.equal(JSON.stringify(polish).includes("private tool output"), false);
  assert.equal(polish.session_profile, "coding-agent");
  assert.equal(polish.language_policy, "zh-CN-mixed");
});

test("manual voice-draft edits need two observations and explicit acceptance before reuse", async () => {
  const fixture = createFixture({ polishContextConsent: "bounded-context-v1" });
  let revision = fixture.runtime.readState().contextRevision;
  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 20,
    text: "我一直是在三省A进行录音",
  }));
  fixture.runtime.handleComposerSubmission({
    threadId: "session-a",
    text: "我一直是在Session A进行录音",
  });
  assert.equal(fixture.runtime.readState().pendingCorrectionSuggestion, null);
  assert.deepEqual(fixture.runtime.readState().correctionRules, []);
  fixture.composer = "";
  fixture.runtime.syncContext();

  revision = fixture.runtime.readState().contextRevision;
  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 21,
    text: "切回三省A",
  }));
  fixture.runtime.handleComposerSubmission({ threadId: "session-a", text: "切回Session A" });
  assert.deepEqual(fixture.runtime.readState().pendingCorrectionSuggestion, {
    heard: "三省A",
    write: "Session A",
    occurrences: 2,
  });
  assert.deepEqual(fixture.runtime.readState().correctionRules, []);
  assert.equal(fixture.runtime.acceptCorrection("其他词", "Other"), false);
  assert.equal(fixture.runtime.acceptCorrection("三省A", "Session A"), true);
  await nextTurn();
  assert.deepEqual(fixture.runtime.readState().correctionRules, [
    { heard: "三省A", write: "Session A" },
  ]);
  assert.deepEqual(fixture.relayRequests.at(-1).context.polish_context.correction_rules, [
    { heard: "三省A", write: "Session A" },
  ]);
  assert.ok(fixture.relayRequests.at(-1).context.local_context.terms.some((term) => (
    term.text === "Session A" && term.boost === 6 && term.source === "composer"
  )));
});

test("a passive target mismatch cannot rebind an armed Session", () => {
  const fixture = createFixture();
  fixture.reportPassiveSessionId("session-b");

  const state = fixture.runtime.readState();
  assert.equal(state.armedSessionId, "session-a");
  assert.equal(state.currentContext.sessionId, "session-a");
  assert.ok(fixture.diagnostics.some((item) => item.code === "session_change_ignored_without_intent"));
});

test("an unrelated page click cannot authorize a passive Session mismatch", () => {
  const fixture = createFixture();
  fixture.pointerAway();
  fixture.reportPassiveSessionId("session-b");

  const state = fixture.runtime.readState();
  assert.equal(state.armedSessionId, "session-a");
  assert.equal(state.currentContext.sessionId, "session-a");
});

test("a Composer replace raced by Session navigation retries and succeeds after returning", async () => {
  const fixture = createFixture();
  const originalRevision = fixture.runtime.readState().contextRevision;
  const draft = message("host.composer.replace", {
    context_revision: originalRevision,
    draft_revision: 12,
    capture_id: "capture-session-race",
    text: "Keep this voice draft through Session navigation.",
  });

  fixture.switchSessionFromNavigation("session-b");
  const retryOutcome = await fixture.runtime.handleMessage(draft, { sequence: 90 });
  assert.equal(retryOutcome, "retry");
  assert.equal(fixture.composer, "");
  assert.ok(fixture.diagnostics.some((item) => (
    item.code === "composer_replace_retry"
    && item.detail.captureId === "capture-session-race"
  )));

  fixture.switchSessionFromNavigation("session-a");
  const reboundRevision = fixture.runtime.readState().contextRevision;
  const acceptedOutcome = await fixture.runtime.handleMessage({
    ...draft,
    context_revision: reboundRevision,
  }, { sequence: 90 });
  assert.equal(acceptedOutcome, "accepted");
  assert.equal(fixture.composer, "Keep this voice draft through Session navigation.");

  const sendOutcome = await fixture.runtime.handleMessage(message("host.action", {
    action: "submit",
    context_revision: reboundRevision,
    draft_revision: 12,
    capture_id: "capture-session-race",
    action_id: "capture-session-race:12:submit",
  }), { sequence: 91 });
  assert.equal(sendOutcome, "accepted");
  assert.deepEqual(fixture.sends.map((item) => item.threadId), ["session-a"]);
});

test("an active page stays bound after refresh and Session navigation without Composer focus", () => {
  const fixture = createFixture({ composerInitiallyFocused: false });
  assert.equal(fixture.runtime.readState().currentContext.focused, true);
  assert.equal(fixture.runtime.readState().armedSessionId, "session-a");

  fixture.switchSessionFromNavigation("session-b");
  const state = fixture.runtime.readState();
  assert.equal(state.currentContext.sessionId, "session-b");
  assert.equal(state.armedSessionId, "session-b");
  assert.equal(state.currentContext.focused, true);
});

test("Session switch preserves queued VoxSpark drafts without exposing them in the new Session", async () => {
  const fixture = createFixture({ activeTurnId: "turn-a" });
  const revision = fixture.runtime.readState().contextRevision;
  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 12,
    text: "Do not cross the Session boundary.",
  }));
  fixture.socket.message(message("host.action", {
    action: "queue",
    action_id: "queue-12",
    context_revision: revision,
    draft_revision: 12,
  }));
  await nextTurn();
  assert.equal(fixture.runtime.readState().queuedDrafts.length, 1);

  fixture.switchSessionFromNavigation("session-b");
  await nextTurn();
  const state = fixture.runtime.readState();
  assert.equal(state.currentContext.sessionId, "session-b");
  assert.equal(state.queuedDrafts.length, 0);
  assert.equal(state.activeDraft, null);
  assert.ok(fixture.diagnostics.some((item) => item.code === "session_changed_drafts_preserved"));
  fixture.activeTurnId = "turn-a";
  fixture.switchSessionFromNavigation("session-a");
  await nextTurn();
  assert.equal(fixture.runtime.readState().queuedDrafts[0].sessionId, "session-a");
});

test("a refreshed browser restores and submits a backend-owned Queue without a local draft", async () => {
  let queueStatus = "queued";
  const queueOperations = [];
  const fixture = createFixture({
    relay: async (payload) => ({
      ok: true,
      connected: true,
      commands: [],
      queue: queueStatus ? [{
        queue_id: "queue-after-refresh",
        action_id: "queue-after-refresh",
        session_id: payload.context.session.id,
        draft_revision: 17,
        status: queueStatus,
      }] : [],
    }),
    queueRequest: async (operation, payload) => {
      queueOperations.push({ operation, payload: { ...payload } });
      if (operation === "claim") {
        queueStatus = "leased";
        return {
          ok: true,
          lease_token: "lease-after-refresh",
          client_submission_id: "voxspark-queue-after-refresh",
          text: "Recovered encrypted Queue body.",
          queue: {
            queue_id: "queue-after-refresh",
            action_id: "queue-after-refresh",
            session_id: "session-a",
            draft_revision: 17,
            status: "leased",
          },
        };
      }
      if (operation === "complete") {
        queueStatus = "submitted";
        return {
          ok: true,
          queue: {
            queue_id: "queue-after-refresh",
            action_id: "queue-after-refresh",
            session_id: "session-a",
            draft_revision: 17,
            status: "submitted",
          },
        };
      }
      return { ok: false };
    },
  });

  await nextTurn();
  await nextTurn();
  assert.equal(fixture.runtime.readState().activeDraft, null);
  assert.equal(fixture.backgroundSends.length, 1);
  assert.equal(fixture.backgroundSends[0].text, "Recovered encrypted Queue body.");
  assert.equal(fixture.backgroundSends[0].clientSubmissionId, "voxspark-queue-after-refresh");
  assert.deepEqual(queueOperations.map((item) => item.operation), ["claim", "complete"]);
});

test("a Session switch preserves the original draft and routes its action back to that Session", async () => {
  const fixture = createFixture({ activeTurnId: "turn-a" });
  const revision = fixture.runtime.readState().contextRevision;
  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 13,
    capture_id: "capture-session-action-race",
    text: "Keep this guidance bound to Session A.",
  }));

  fixture.switchSessionFromNavigation("session-b");
  const accepted = await fixture.runtime.handleMessage(message("host.action", {
    action: "steer",
    context_revision: revision,
    draft_revision: 13,
    capture_id: "capture-session-action-race",
    action_id: "capture-session-action-race:13:steer",
  }), { sequence: 92 });

  assert.equal(accepted, "accepted");
  assert.equal(fixture.sends.length, 0);
  assert.deepEqual(fixture.backgroundSends.map((item) => ({
    threadId: item.threadId,
    activeTurnId: item.activeTurnId,
    mode: item.mode,
    text: item.text,
  })), [{
    threadId: "session-a",
    activeTurnId: "turn-a",
    mode: "steer",
    text: "Keep this guidance bound to Session A.",
  }]);
  assert.equal(
    fixture.backgroundSends[0].clientSubmissionId,
    "voxspark-capture-session-action-race:13:steer",
  );
  assert.equal(fixture.runtime.readState().retainedDrafts.length, 0);
});

test("queueing a retained Session A draft never clears Session B Composer text", async () => {
  const fixture = createFixture({ activeTurnId: "turn-a" });
  const revision = fixture.runtime.readState().contextRevision;
  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 14,
    capture_id: "capture-session-a-queue",
    text: "Shared visible text.",
  }));

  fixture.switchSessionFromNavigation("session-b");
  fixture.composer = "Shared visible text.";
  await fixture.runtime.handleMessage(message("host.action", {
    action: "queue",
    context_revision: revision,
    draft_revision: 14,
    capture_id: "capture-session-a-queue",
    action_id: "capture-session-a-queue:14:queue",
  }), { sequence: 93 });

  assert.equal(fixture.composer, "Shared visible text.");
  assert.equal(fixture.runtime.readState().queuedDrafts.length, 0);
  fixture.activeTurnId = "turn-a";
  fixture.switchSessionFromNavigation("session-a");
  await nextTurn();
  assert.equal(fixture.runtime.readState().queuedDrafts.length, 1);
  assert.equal(fixture.runtime.readState().queuedDrafts[0].sessionId, "session-a");
});

test("clearing the Composer before Queue rejects the stale voice draft", async () => {
  const fixture = createFixture({ activeTurnId: "turn-a" });
  const revision = fixture.runtime.readState().contextRevision;
  fixture.socket.message(message("host.composer.replace", {
    context_revision: revision,
    draft_revision: 15,
    capture_id: "capture-cleared-before-queue",
    text: "Do not queue this after it is cleared.",
  }));
  fixture.composer = "";

  const outcome = await fixture.runtime.handleMessage(message("host.action", {
    action: "queue",
    context_revision: revision,
    draft_revision: 15,
    capture_id: "capture-cleared-before-queue",
    action_id: "capture-cleared-before-queue:15:queue",
  }), { sequence: 94 });

  assert.equal(outcome, "accepted");
  assert.equal(fixture.runtime.readState().queuedDrafts.length, 0);
  assert.deepEqual(fixture.runtime.readState().pendingCommandResults, [{
    action_id: "capture-cleared-before-queue:15:queue",
    outcome: "failed",
    retryable: false,
    error_code: "action_rejected",
  }]);
});
