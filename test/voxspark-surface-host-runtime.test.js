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
  const insertions = [];
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
        .map(item => ({ ...item })),
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
      return { ok: true, queue: { ...entry } };
    }
    if (operation === "claim") {
      const entry = queueEntries.get(payload.queue_id);
      if (!entry) return { ok: false, code: "queue_not_found" };
      entry.status = "leased";
      if (options.claimBarrier) await options.claimBarrier();
      return {
        ok: true,
        lease_token: `lease-${entry.queue_id}`,
        client_submission_id: `voxspark-${entry.action_id}`,
        text: entry.text,
        queue: { ...entry },
      };
    }
    if (operation === "complete") {
      const entry = queueEntries.get(payload.queue_id);
      if (!entry) return { ok: false, code: "queue_not_found" };
      entry.status = payload.outcome === "succeeded" ? "submitted" : payload.outcome;
      if (payload.outcome === "succeeded") entry.text = "";
      return { ok: true, queue: { ...entry } };
    }
    return { ok: false, code: "unsupported_queue_operation" };
  });
  runtime = (options.runtimeApi || surfaceHost).createVoxSparkSurfaceHostRuntime({
    bridgeUrl: "ws://127.0.0.1:8790/host",
    relay,
    queueRequest,
    captureRequest: options.captureRequest,
    clientId: "surface-test",
    document,
    window,
    $: (id) => id === "messageInput" ? input : null,
    currentComposerThreadId: () => threadId,
    composerTargetThread: () => ({ ...thread, id: threadId }),
    composerTargetActiveTurnId: () => activeTurnId,
    composerText: () => composer,
    setComposerText: (value) => { composer = String(value || ""); },
    insertComposerText: (value) => {
      if (options.insertionError) throw options.insertionError;
      if (options.insertionBlocked) return null;
      const offset = options.caretOffset ?? composer.length;
      composer = composer.slice(0, offset) + value + composer.slice(offset);
      if (options.caretOffset == null) composer = surfaceHost.appendComposerText(composer.slice(0, -value.length), value);
      insertions.push(value);
      return { text: composer, atEnd: options.caretOffset == null };
    },
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
      if (options.sendDraftImplementation) return options.sendDraftImplementation(draft);
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
    insertions,
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
    beginSessionNavigation() { emitDocument("pointerdown", { target: navigationTarget }); },
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
    for (const field of ["requestStartedAt", "clientAt", "relayMs", "syncId", "errorKind", "reason", "acknowledgedCount"]) {
      assert.ok(reportBody.includes(`${field}:`), `${relativePath}: ${field}`);
    }
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

test("voice insertion preserves its editor position and duplicate or stale drafts do not insert again", () => {
  const fixture = createFixture({ composer: "First.\n\nLast.", caretOffset: 7 });
  const revision = fixture.runtime.readState().contextRevision;
  const draft = message("host.composer.replace", {
    context_revision: revision, draft_revision: 8, text: "Middle.",
  });
  fixture.socket.message(draft);
  assert.equal(fixture.composer, "First.\nMiddle.\nLast.");
  fixture.socket.message(draft);
  fixture.socket.message({ ...draft, context_revision: revision - 1, draft_revision: 9 });
  assert.deepEqual(fixture.insertions, ["Middle."]);
});

test("production native ESM uses the same final insertion boundary", async () => {
  const nativeHost = await import(pathToFileURL(path.join(root, "frontend/native/voxspark-surface-host-runtime.mjs")).href);
  const nativeComposer = await import(pathToFileURL(path.join(root, "frontend/native/composer-runtime.mjs")).href);
  assert.equal(typeof nativeComposer.createComposerRuntime({}).insertComposerText, "function");
  const fixture = createFixture({ runtimeApi: nativeHost, composer: "First.\n\nLast.", caretOffset: 7 });
  const draft = message("host.composer.replace", {
    context_revision: fixture.runtime.readState().contextRevision, draft_revision: 8, text: "Middle.",
  });
  fixture.socket.message(draft);
  assert.equal(fixture.composer, "First.\nMiddle.\nLast.");
  fixture.socket.message(draft);
  assert.deepEqual(fixture.insertions, ["Middle."]);
});

test("a composing or disabled editor retries without retaining an uninserted draft", async () => {
  const fixture = createFixture({ composer: "Keep this.", insertionBlocked: true });
  const revision = fixture.runtime.readState().contextRevision;
  const outcome = await fixture.runtime.handleMessage(message("host.composer.replace", {
    context_revision: revision, draft_revision: 8, text: "Voice.",
  }));
  assert.equal(outcome, "retry");
  assert.equal(fixture.composer, "Keep this.");
  assert.equal(fixture.runtime.readState().activeDraft, null);
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

test("Session switch supersedes a stuck HTTP relay and ignores its late response", async (t) => {
  const requests = [];
  const fixture = createFixture({ relay: (payload, options) => new Promise(resolve => {
    requests.push({ payload, signal: options.signal, resolve });
  }) });
  t.after(() => fixture.runtime.stop());
  fixture.switchSessionWhileComposerRetainsFocus("session-b");
  assert.equal(requests.length, 2, "new target must publish without waiting or ticking the poll");
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].payload.context.session.id, "session-b");
  requests[1].resolve({ ok: true, connected: true, service_epoch: "epoch-new", commands: [] });
  await nextTurn();
  requests[0].resolve({ ok: true, connected: false, service_epoch: "epoch-old", commands: [{
    sequence: 1, message: { contract: surfaceHost.CONTRACT, type: "host.composer.replace",
      context_revision: fixture.runtime.readState().contextRevision, draft_revision: 1, text: "late old response" },
  }] });
  await nextTurn();
  assert.equal(fixture.composer, "");
  assert.equal(fixture.runtime.readState().connected, true);
  fixture.runtime.syncContext();
  assert.equal(requests.at(-1).payload.service_epoch, "epoch-new");
});

test("rapid A-B-C navigation keeps only the newest relay authoritative", async (t) => {
  const requests = [];
  const fixture = createFixture({ relay: (payload, options) => new Promise((resolve, reject) => {
    requests.push({ payload, signal: options.signal, resolve, reject });
  }) });
  t.after(() => fixture.runtime.stop());
  fixture.switchSessionFromNavigation("session-b");
  fixture.switchSessionFromNavigation("session-c");
  assert.deepEqual(requests.map(item => item.payload.context.session.id), ["session-a", "session-b", "session-c"]);
  assert.deepEqual(requests.map(item => item.signal.aborted), [true, true, false]);
  requests[0].reject(new Error("aborted")); requests[1].reject(new Error("aborted"));
  await nextTurn();
  assert.equal(fixture.diagnostics.some(item => item.code === "bridge_relay_error"), false);
  requests[2].resolve({ ok: true, connected: true, commands: [] }); await nextTurn();
  assert.equal(fixture.runtime.readState().currentContext.sessionId, "session-c");
  assert.equal(fixture.runtime.readState().connected, true);
});

test("stopping a Host invalidates responses from its previous lifecycle", async () => {
  const requests = [];
  const fixture = createFixture({ relay: (payload, options) => new Promise(resolve => requests.push({ payload, options, resolve })) });
  fixture.runtime.stop();
  assert.equal(requests[0].options.signal.aborted, true);
  fixture.runtime.start();
  requests[1].resolve({ ok: true, connected: true, service_epoch: "current", commands: [] }); await nextTurn();
  requests[0].resolve({ ok: true, connected: false, service_epoch: "retired", commands: [] }); await nextTurn();
  assert.equal(fixture.runtime.readState().connected, true);
  fixture.runtime.stop();
});

test("restoring the committed Composer publishes its Session before rendering without a poll", async (t) => {
  const fixture = createFixture(); t.after(() => fixture.runtime.stop()); await nextTurn();
  fixture.beginSessionNavigation();
  fixture.threadId = "session-b";
  const sandbox = vm.createContext({ window: { voxsparkSurfaceHostRuntime: fixture.runtime }, URL, console });
  vm.runInContext(fs.readFileSync(path.join(root, "public/navigation-runtime.js"), "utf8"), sandbox);
  Object.assign(sandbox, {
    state: { draftRestoreSeq: 0 }, clearTimeout() {},
    currentDraftKey: () => "session-b", readDraftMap: () => ({ "session-b": { text: "draft for B" } }),
    setComposerText: text => { fixture.composer = text; }, applyDraftRuntimeSelection() {}, replacePendingAttachments() {},
    renderComposerSettings() {
      assert.equal(fixture.runtime.readState().currentContext.sessionId, "session-b");
      assert.equal(fixture.relayRequests.at(-1).context.session.id, "session-b");
      assert.equal(fixture.composer, "draft for B");
    }, updateComposerControls() {},
  });
  sandbox.restoreDraftForCurrentTarget();
});

test("real HTTP transport publishes new Session while old POST is held and fences its late arrival", async (t) => {
  const http = require('node:http');
  const { createApiClient } = require('../public/api-client');
  const { createVoxSparkSurfaceHostService } = require('../services/runtime/voxspark-surface-host-service');
  class Socket {
    static OPEN = 1;
    constructor() { this.readyState = 1; this.sent = []; Socket.instance = this; }
    addEventListener() {}
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; }
  }
  const service = createVoxSparkSurfaceHostService({ WebSocket: Socket,
    setTimeout: () => 1, clearTimeout() {}, logger: { info() {} } });
  let releaseOld, firstArrived, newPublished, oldPublished;
  const holdOld = new Promise(resolve => { releaseOld = resolve; });
  const first = new Promise(resolve => { firstArrived = resolve; });
  const updated = new Promise(resolve => { newPublished = resolve; });
  const late = new Promise(resolve => { oldPublished = resolve; });
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks));
    if (payload.context.session.id === 'session-a') { firstArrived(); await holdOld; }
    const result = service.publish(payload);
    if (payload.context.session.id === 'session-b') newPublished(result);
    else oldPublished(result);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = createApiClient();
  const fixture = createFixture({ relay: (payload, options) => client.request(`http://127.0.0.1:${server.address().port}/context`, {
    method: 'POST', body: JSON.stringify(payload), signal: options.signal,
  }) });
  t.after(async () => {
    releaseOld(); fixture.runtime.stop(); service.stop(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await first;
  fixture.switchSessionWhileComposerRetainsFocus('session-b');
  let deadline;
  const result = await Promise.race([updated, new Promise((_, reject) => {
    deadline = setTimeout(() => reject(new Error('new Session was blocked behind old POST')), 1000);
  })]).finally(() => clearTimeout(deadline));
  assert.equal(result.ok, true);
  assert.equal(Socket.instance.sent.at(-1).session.id, 'session-b');
  const revision = result.context_revision;
  releaseOld();
  assert.equal((await late).stale_context, true);
  assert.equal(service.status().context_revision, revision);
  assert.equal(Socket.instance.sent.at(-1).session.id, 'session-b');
});

test("delivery diagnostics correlate receive, apply and ACK without draft contents", async (t) => {
  const requests = [];
  const fixture = createFixture({ relay: payload => new Promise(resolve => requests.push({ payload, resolve })) });
  t.after(() => fixture.runtime.stop());
  fixture.advance(1200);
  requests[0].resolve({ ok: true, connected: true, commands: [{ sequence: 91,
    message: message("host.composer.replace", { context_revision: fixture.runtime.readState().contextRevision,
      draft_revision: 90, capture_id: "capture-observe", text: "PRIVATE DRAFT SENTINEL" }) }] });
  await nextTurn();
  const received = fixture.diagnostics.find(x => x.code === "command_received").detail;
  const applied = fixture.diagnostics.find(x => x.code === "composer_replace_confirmed").detail;
  assert.equal(received.syncId, requests[0].payload.sync_id);
  assert.equal(received.relayMs, 1200);
  assert.equal(received.clientAt - received.requestStartedAt, 1200);
  assert.equal(applied.syncId, received.syncId);
  assert.equal(applied.commandSequence, 91);
  assert.equal(applied.captureId, "capture-observe");
  assert.ok(applied.clientAt >= received.clientAt);
  fixture.runtime.syncContext(); await nextTurn();
  const ack = requests.find(x => x.payload.acknowledged_sequences.includes(91));
  assert.ok(ack);
  ack.resolve({ ok: true, connected: true, accepted_command_sequences: [91], commands: [] });
  await nextTurn();
  assert.ok(fixture.diagnostics.some(x => x.code === "context_relay_completed" &&
    x.detail.syncId === ack.payload.sync_id && x.detail.acknowledgedCount === 1));
  assert.equal(JSON.stringify(fixture.diagnostics).includes("PRIVATE DRAFT SENTINEL"), false);
});

test("relay errors distinguish timeout and other failure without logging error body", async (t) => {
  for (const [errorText, expected] of [["Request timed out: /api/voxspark/surface/context", "timeout"],
    ["PRIVATE ERROR SENTINEL", "request_failed"]]) {
    let rejectRequest;
    const fixture = createFixture({ relay: () => new Promise((resolve, reject) => { rejectRequest = reject; }) });
    t.after(() => fixture.runtime.stop());
    fixture.advance(4000); rejectRequest(new Error(errorText)); await nextTurn();
    const detail = fixture.diagnostics.find(x => x.code === "bridge_relay_error").detail;
    assert.equal(detail.errorKind, expected);
    assert.equal(detail.relayMs, 4000);
    assert.ok(detail.syncId);
    assert.equal(detail.clientAt - detail.requestStartedAt, 4000);
    assert.equal(JSON.stringify(fixture.diagnostics).includes("PRIVATE ERROR SENTINEL"), false);
  }
});

test("retry diagnostics distinguish context mismatch and blocked insertion", async (t) => {
  for (const blocked of [false, true]) {
    const fixture = createFixture({ insertionBlocked: blocked });
    t.after(() => fixture.runtime.stop()); await nextTurn();
    const outcome = await fixture.runtime.handleMessage(message("host.composer.replace", {
      context_revision: fixture.runtime.readState().contextRevision + (blocked ? 0 : 99),
      draft_revision: 1, capture_id: "capture-retry", text: "PRIVATE RETRY SENTINEL",
    }), { sequence: 55, syncId: "request.55" });
    assert.equal(outcome, "retry");
    const entry = fixture.diagnostics.find(x => x.code === (blocked ? "replace_insert_failed" : "replace_rejected_stale_context"));
    assert.equal(entry.detail.syncId, "request.55");
    assert.equal(entry.detail.commandSequence, 55);
    if (!blocked) assert.equal(entry.detail.reason, "context_mismatch");
    assert.equal(fixture.composer, "");
    assert.equal(JSON.stringify(fixture.diagnostics).includes("PRIVATE RETRY SENTINEL"), false);
  }
});

test("fast empty polling does not add per-request diagnostics", async (t) => {
  const fixture = createFixture(); t.after(() => fixture.runtime.stop()); await nextTurn();
  const before = fixture.diagnostics.length;
  for (let i = 0; i < 5; i++) { fixture.runtime.syncContext(); await nextTurn(); }
  assert.equal(fixture.diagnostics.length, before);
});

test("an apply exception is distinguishable from a transport failure", async (t) => {
  let resolveRequest;
  const fixture = createFixture({ insertionError: new Error("PRIVATE APPLY SENTINEL"),
    relay: () => new Promise(resolve => { resolveRequest = resolve; }) });
  t.after(() => fixture.runtime.stop());
  resolveRequest({ ok: true, connected: true, commands: [{ sequence: 88, message: message("host.composer.replace", {
    context_revision: fixture.runtime.readState().contextRevision, draft_revision: 1, text: "PRIVATE TEXT",
  }) }] });
  await nextTurn();
  const error = fixture.diagnostics.find(x => x.code === "bridge_relay_error");
  assert.equal(error.detail.errorKind, "processing_failed");
  assert.equal(JSON.stringify(fixture.diagnostics).includes("PRIVATE"), false);
});

test("voice view retains the capture owner across Session switches and shows actual stages", () => {
  const voice = { reason: "ready", snapshot: { target: { session_id: "session-b", title: "B" },
    captures: [{ capture_id: "a", session_id: "session-a", session_title: "A", state: "recording", duration_ms: 90234 }] } };
  const b = surfaceHost.voiceStatusView(voice, "session-b");
  assert.equal(b.stage, "recording"); assert.equal(b.status, "BOX 录音中");
  assert.equal(b.target, "语音发送到：A"); assert.equal(b.elsewhere, true);
  voice.snapshot.captures[0].state = "polishing";
  const a = surfaceHost.voiceStatusView(voice, "session-a");
  assert.equal(a.stage, "polishing"); assert.equal(a.duration, "1:30"); assert.equal(a.elsewhere, false);
  voice.snapshot.captures[0].state = "waitingComposer";
  assert.equal(surfaceHost.voiceStatusView(voice, "session-a").status, "等待写入输入框");
  voice.snapshot.captures[0].state = "ready";
  assert.equal(surfaceHost.voiceStatusView(voice, "session-a").status, "已写入输入框");
  assert.equal(surfaceHost.voiceStatusView(voice, "session-b").stage, "");
  const lost = surfaceHost.voiceStatusView(voice, "session-a", false);
  assert.equal(lost.stage, ""); assert.equal(lost.duration, ""); assert.equal(lost.status, "语音服务重连中");
});

test("a global recording takes priority while the current Session draft keeps its own status", () => {
  const voice = { reason: "ready", snapshot: { target: { session_id: "b", title: "B" }, captures: [
    { capture_id: "old-b", session_id: "b", session_title: "B", state: "polishing", duration_ms: 20000 },
    { capture_id: "new-a", session_id: "a", session_title: "A", state: "recording", duration_ms: 1200 },
  ] } };
  const view = surfaceHost.voiceStatusView(voice, "b");
  assert.equal(view.target, "语音发送到：A"); assert.equal(view.stage, "recording");
  assert.equal(view.duration, "0:01"); assert.equal(view.detail, "当前 Session：整理中");
  voice.snapshot.captures[0].state = "failed";
  assert.match(surfaceHost.voiceStatusView(voice, "b").detail, /当前 Session：识别失败/);
  delete voice.snapshot.captures[1].session_title;
  assert.equal(surfaceHost.voiceStatusView(voice, "b").target, "语音发送到：另一个 Session");
  voice.snapshot.target = { session_id: "a", title: "A" };
  assert.equal(surfaceHost.voiceStatusView(voice, "b").target, "语音发送到：A");
});

test("a late old Session response cannot replace the current voice snapshot", async () => {
  const requests = [];
  const f = createFixture({ relay: payload => new Promise(resolve => requests.push({ payload, resolve })) });
  f.switchSessionWhileComposerRetainsFocus("session-b");
  requests[1].resolve({ ok: true, connected: true, voice: { reason: "ready", snapshot: { sequence: 5 } }, commands: [] });
  await new Promise(resolve => setImmediate(resolve));
  requests[0].resolve({ ok: true, connected: true, voice: { reason: "ready", snapshot: { sequence: 1 } }, commands: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.runtime.readState().voice.snapshot.sequence, 5);
  f.runtime.stop();
});


test("a Queue claim arriving after navigation cannot submit using the new Session settings", async () => {
  let release;
  const fixture = createFixture({ activeTurnId: "running", claimBarrier: () => new Promise(resolve => { release = resolve; }) });
  const revision = fixture.runtime.readState().contextRevision;
  fixture.socket.message(message("host.composer.replace", { context_revision: revision, draft_revision: 80, text: "Original Session draft" }));
  fixture.socket.message(message("host.action", { action: "queue", action_id: "late-claim", context_revision: revision, draft_revision: 80 }));
  await nextTurn();
  fixture.activeTurnId = ""; fixture.runtime.syncContext(); await nextTurn();
  assert.equal(typeof release, "function");
  fixture.switchSessionWhileComposerRetainsFocus("session-b"); fixture.thread = { cwd: "/different-workspace", model: "different-model" };
  release(); await nextTurn();
  assert.equal(fixture.backgroundSends.length, 0);
  const completed = fixture.queueRequests.find(request => request.operation === "complete");
  assert.equal(completed.payload.session_id, "session-a"); assert.equal(completed.payload.outcome, "failed");
  assert.equal(fixture.runtime.readState().queuedDrafts.length, 0, "old failure must not enter the new Session list");
  fixture.switchSessionWhileComposerRetainsFocus("session-a"); await nextTurn();
  assert.equal(fixture.runtime.readState().queuedDrafts[0].status, "failed");
  fixture.runtime.stop();
});


async function queuedSteerFixture(options = {}) {
  const f = createFixture({ activeTurnId: "turn-a", ...options });
  const revision = f.runtime.readState().contextRevision;
  f.socket.message(message("host.composer.replace", { context_revision: revision, draft_revision: 90, text: "Guide the existing work" }));
  f.socket.message(message("host.action", { action: "queue", action_id: "steer-queue", context_revision: revision, draft_revision: 90 }));
  await nextTurn();
  return f;
}

test("queued steer uses one stable submission and completes before any idle auto-send", async () => {
  const f = await queuedSteerFixture();
  assert.equal(f.runtime.readState().queuedDrafts[0].text, "Guide the existing work");
  assert.equal(await f.runtime.manageQueue("steer", "steer-queue"), true);
  const sent = f.backgroundSends[0];
  assert.equal(sent.mode, "steer"); assert.equal(sent.activeTurnId, "turn-a");
  assert.equal(sent.clientSubmissionId, "voxspark-steer-queue");
  assert.equal(sent.strictSteer, true); assert.equal(sent.preserveComposerDraft, true);
  assert.equal(f.queueRequests.find(x => x.operation === "claim").payload.mode, "steer");
  f.runtime.syncContext(); await nextTurn();
  f.activeTurnId = ""; f.runtime.syncContext(); await nextTurn();
  await f.runtime.flushQueuedDrafts();
  assert.equal(f.backgroundSends.length, 1); f.runtime.stop();
});

for (const kind of ["Session", "turn"]) test(`queued steer rejects a late claim after ${kind} change and keeps the body`, async () => {
  let release;
  const f = await queuedSteerFixture({ claimBarrier: () => new Promise(resolve => { release = resolve; }) });
  const attempt = f.runtime.manageQueue("steer", "steer-queue"); await nextTurn();
  if (kind === "Session") f.switchSessionWhileComposerRetainsFocus("session-b");
  else { f.activeTurnId = "turn-new"; f.runtime.syncContext(); }
  release(); assert.equal(await attempt, false); await nextTurn();
  assert.equal(f.backgroundSends.length, 0);
  assert.equal(f.queueRequests.at(-1).payload.outcome, "failed");
  if (kind === "Session") { assert.equal(f.runtime.readState().queuedDrafts.length, 0); f.switchSessionWhileComposerRetainsFocus("session-a"); await nextTurn(); }
  assert.equal(f.runtime.readState().queuedDrafts[0].text, "Guide the existing work"); f.runtime.stop();
});

for (const [error, status] of [[Object.assign(Error("target ended"), { status: 409 }), "failed"],
  [Error("Request timed out"), "unknown"], [Object.assign(Error("unknown"), { code: "voxspark_submission_outcome_unknown", status: 409 }), "unknown"]]) {
  test(`queued steer ${error.message} retains body and cannot auto-replay`, async () => {
    const f = await queuedSteerFixture({ sendError: error });
    assert.equal(await f.runtime.manageQueue("steer", "steer-queue"), false);
    assert.equal(f.runtime.readState().queuedDrafts[0].status, status);
    assert.equal(f.runtime.readState().queuedDrafts[0].text, "Guide the existing work");
    f.activeTurnId = ""; f.runtime.syncContext(); await nextTurn();
    await f.runtime.flushQueuedDrafts(); assert.equal(f.backgroundSends.length, 1); f.runtime.stop();
  });
}


for (const sourceMode of ["classic", "native-esm"]) test(`${sourceMode}: an old Queue completion cannot release or erase a newer Composer draft`, async () => {
  const composerApi = sourceMode === "classic" ? require("../public/composer-runtime.js")
    : await import(pathToFileURL(path.join(root, "frontend/native/composer-runtime.mjs")).href);
  const hostApi = sourceMode === "classic" ? surfaceHost
    : await import(pathToFileURL(path.join(root, "frontend/native/voxspark-surface-host-runtime.mjs")).href);
  let resolveApi;
  const apiResult = new Promise(resolve => { resolveApi = resolve; });
  const apiRequests = [], cleared = [], notifications = [];
  let savedDraft = "";
  let fixture;
  const composer = composerApi.createComposerRuntime({
    state: { newThreadDraft: false, composerModel: "", composerEffort: "", composerPermissionMode: "",
      defaultModel: "test-model", defaultReasoningEffort: "medium", codexFastMode: false },
    effectiveComposerPermissionMode: value => value || "default", defaultNewThreadPermissionMode: () => "default",
    draftKeyForThread: threadId => `thread:${threadId}`,
    clearDraftForKey: key => { cleared.push(key); savedDraft = ""; },
    onComposerSubmitted: submission => { notifications.push(submission); fixture.runtime.handleComposerSubmission(submission); },
    api: async (url, options) => { apiRequests.push({ url, options }); return apiResult; },
    scheduleComposerTargetRefresh() {}, schedulePostCompletionThreadRefreshes() {}, scheduleLivePollIfNeeded() {},
    loadThreads: async () => {}, showError() {},
  });
  fixture = createFixture({ activeTurnId: "original-turn", runtimeApi: hostApi,
    sendDraftImplementation: draft => composer.sendVoxSparkDraft(draft) });
  const revision = fixture.runtime.readState().contextRevision;
  fixture.socket.message(message("host.composer.replace", { context_revision: revision, draft_revision: 101,
    capture_id: "old-capture", text: "First queued message" }));
  fixture.socket.message(message("host.action", { context_revision: revision, draft_revision: 101,
    capture_id: "old-capture", action: "queue", action_id: "old-queue" }));
  await nextTurn();
  fixture.activeTurnId = ""; fixture.runtime.syncContext(); await nextTurn();
  assert.equal(apiRequests.length, 1);
  // Match the live ordering: a second recording is delivered before the first request completes.
  fixture.composer = "New manual draft";
  fixture.runtime.syncContext();
  await fixture.runtime.handleMessage(message("host.composer.replace", {
    context_revision: fixture.runtime.readState().contextRevision, draft_revision: 102,
    capture_id: "new-capture", text: "Second recording" }));
  savedDraft = fixture.composer;
  assert.equal(fixture.runtime.readState().activeDraft.captureId, "new-capture");
  resolveApi({ turnId: "queue-turn" }); await nextTurn(); await nextTurn();
  assert.equal(fixture.runtime.readState().activeDraft?.captureId, "new-capture", "Queue does not own the new voice draft");
  assert.equal(savedDraft, "New manual draft Second recording", "Queue must not erase the next saved draft");
  assert.equal(fixture.composer, savedDraft);
  assert.deepEqual(cleared, []); assert.deepEqual(notifications, []);
  assert.equal(apiRequests[0].options.body.get("text"), "First queued message");
  assert.equal(apiRequests[0].options.body.get("clientSubmissionId"), "voxspark-old-queue");
  fixture.socket.message(message("host.action", {
    context_revision: fixture.runtime.readState().contextRevision, draft_revision: 102,
    capture_id: "new-capture", action: "submit", action_id: "new-submit" }));
  await nextTurn();
  assert.equal(fixture.sends.length, 1, "new BOX send still finds its own draft");
  assert.equal(fixture.sends[0].text, "New manual draft Second recording");
  assert.equal(fixture.runtime.readState().activeDraft, null);
  fixture.runtime.stop();
});

function recoveryRelayState() {
  return {ok:true,connected:true,service_epoch:'mobile-c2',commands:[],voice:{reason:'ready',snapshot:{bridge_epoch:'bridge-c2',sequence:1,
    target:{session_id:'session-a'},captures:[{capture_id:'c2-a',session_id:'session-a',state:'failed',duration_ms:2300,
      recovery:{revision:1,retryable:true,expires_at:901000}}]}}};
}

test('web recovery retries the same uncertain request and preserves typed draft without submitting', async () => {
  const state=recoveryRelayState();const requests=[];
  const f=createFixture({composer:'手工草稿',relay:async()=>state,captureRequest:async(action,payload)=>{requests.push({action,payload});throw Error('timeout');}});
  await nextTurn();assert.equal(await f.runtime.manageCapture('retry','c2-a'),false);await nextTurn();
  assert.equal(await f.runtime.manageCapture('retry','c2-a'),false);
  assert.equal(requests.length,2);assert.equal(requests[0].payload.request_id,requests[1].payload.request_id);
  state.voice.snapshot.captures[0].recovery.revision=2;f.runtime.syncContext({force:true});await nextTurn();
  await f.runtime.manageCapture('retry','c2-a');
  assert.notEqual(requests[2].payload.request_id,requests[0].payload.request_id);
  assert.equal(f.composer,'手工草稿');assert.equal(f.sends.length+f.backgroundSends.length,0);f.runtime.stop();
});

test('web recovery blocks stale state, expired retries, cross-Session actions and simultaneous clicks', async () => {
  const state=recoveryRelayState();let resolve;let calls=0;
  const f=createFixture({composer:'保留',relay:async()=>state,captureRequest:()=>{calls++;return new Promise(r=>resolve=r);}});await nextTurn();
  const pending=f.runtime.manageCapture('retry','c2-a');
  assert.equal(await f.runtime.manageCapture('discard','c2-a'),false);
  f.threadId='session-b';f.runtime.syncContext({force:true});await nextTurn();resolve({ok:true});
  assert.equal(await pending,false);assert.equal(await f.runtime.manageCapture('retry','c2-a'),false);
  f.threadId='session-a';f.runtime.syncContext({force:true});await nextTurn();
  state.voice.snapshot.captures[0].recovery.retryable=false;
  assert.equal(await f.runtime.manageCapture('retry','c2-a'),false);
  f.advance(4000);assert.equal(await f.runtime.manageCapture('discard','c2-a'),false);
  assert.equal(calls,1);assert.equal(f.composer,'保留');f.runtime.stop();
});
