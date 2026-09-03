"use strict";

const CONTRACT = "voxspark.surface.v1alpha1";
const STORAGE_BRIDGE_URL = "codex_mobile_voxspark_bridge_url";
const COMMAND_ACCEPTED = "accepted";
const COMMAND_RETRY = "retry";
const COMMAND_DISCARD = "discard";
const SESSION_SWITCH_INTENT_MS = 3000;
const CONTEXT_TERM_LIMIT = 32;
const CONTEXT_TERM_CODE_POINT_LIMIT = 64;
const CONTEXT_MESSAGE_LIMIT = 6;
const COMMON_ENGLISH_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "before", "but",
  "can", "could", "earlier", "for", "from", "have", "into", "just", "more",
  "not", "now", "only", "our", "should", "that", "the", "their", "then",
  "there", "these", "they", "this", "those", "use", "was", "we", "what",
  "when", "where", "which", "will", "with", "would", "you", "your",
]);

function text(value) {
  return String(value == null ? "" : value).trim();
}

function traceId(value) {
  const candidate = text(value).slice(0, 96);
  return /^[A-Za-z0-9._:-]+$/.test(candidate) ? candidate : "";
}

function traceDetails(message, sequence) {
  return {
    captureId: traceId(message && message.capture_id),
    actionId: traceId(message && message.action_id),
    commandSequence: Number.isInteger(sequence) ? sequence : 0,
  };
}

function appendComposerText(existingValue, newValue) {
  const existing = String(existingValue == null ? "" : existingValue);
  const addition = text(newValue);
  if (!existing) return addition;
  return /\s$/u.test(existing) ? `${existing}${addition}` : `${existing} ${addition}`;
}

function normalizeContextTerm(value) {
  const term = text(value).replace(/\s+/g, " ");
  const length = Array.from(term).length;
  if (length < 2 || length > CONTEXT_TERM_CODE_POINT_LIMIT || /^\p{Number}+$/u.test(term)) return "";
  if (/^[A-Za-z]+$/.test(term) && COMMON_ENGLISH_WORDS.has(term.toLowerCase())) return "";
  return term;
}

function visibleItemText(item) {
  if (!item || !["userMessage", "agentMessage", "plan"].includes(item.type)) return "";
  if (typeof item.text === "string") return text(item.text);
  const content = Array.isArray(item.content) ? item.content : [];
  return content
    .filter((part) => part && (part.type === "text" || part.type === "input_text") && typeof part.text === "string")
    .map((part) => text(part.text))
    .filter(Boolean)
    .join("\n");
}

function contextSources(thread, composerDraft) {
  const visible = [];
  for (const turn of Array.isArray(thread && thread.turns) ? thread.turns : []) {
    for (const item of Array.isArray(turn && turn.items) ? turn.items : []) {
      const value = visibleItemText(item);
      if (value) visible.push({ text: value, source: "session" });
    }
  }
  const sources = visible.slice(-CONTEXT_MESSAGE_LIMIT);
  const draft = text(composerDraft);
  if (draft) sources.push({ text: draft, source: "composer" });
  return sources;
}

function extractContextTerms(sources) {
  const candidates = new Map();
  function add(value, sourceIndex, explicit, phraseLength) {
    const term = normalizeContextTerm(value);
    const input = sources[sourceIndex];
    if (!term || !input) return;
    const key = term.toLocaleLowerCase("en-US");
    const recency = input.source === "composer" ? 4 : Math.max(0, 3 - (sources.length - 1 - sourceIndex));
    const base = explicit ? 10 : phraseLength > 1 ? 6 + phraseLength : 3;
    const existing = candidates.get(key);
    if (!existing) {
      candidates.set(key, {
        text: term,
        score: base + recency,
        occurrences: 1,
        explicit,
        source: input.source,
        newestIndex: sourceIndex,
      });
      return;
    }
    existing.score = Math.max(existing.score, base + recency);
    existing.occurrences += 1;
    existing.explicit ||= explicit;
    if (input.source === "composer") existing.source = "composer";
    existing.newestIndex = Math.max(existing.newestIndex, sourceIndex);
  }

  for (let sourceIndex = sources.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
    const source = sources[sourceIndex] && sources[sourceIndex].text || "";
    for (const match of source.matchAll(/`([^`\n]+)`|“([^”\n]+)”|「([^」\n]+)」|『([^』\n]+)』|"([^"\n]+)"/gu)) {
      add(match.slice(1).find((value) => value !== undefined) || "", sourceIndex, true, 1);
    }
    const matches = [...source.matchAll(/[A-Za-z][A-Za-z0-9]*(?:[._+#/-][A-Za-z0-9]+)*/g)];
    for (let index = 0; index < matches.length; index += 1) {
      const current = matches[index];
      if (!current) continue;
      const sequence = [current[0]];
      for (let nextIndex = index + 1; nextIndex < Math.min(index + 3, matches.length); nextIndex += 1) {
        const previous = matches[nextIndex - 1];
        const next = matches[nextIndex];
        if (!previous || !next || previous.index === undefined || next.index === undefined) break;
        const gap = source.slice(previous.index + previous[0].length, next.index);
        if (!/^\s+$/.test(gap)) break;
        sequence.push(next[0]);
        if (sequence.every((token) => /[A-Z0-9._+#/-]/.test(token))) {
          add(sequence.join(" "), sourceIndex, false, sequence.length);
        }
      }
      if (/[A-Z0-9._+#/-]/.test(current[0])) add(current[0], sourceIndex, false, 1);
    }
  }

  const ranked = [...candidates.values()].sort((left, right) =>
    (right.score + Math.min(right.occurrences - 1, 2)) -
      (left.score + Math.min(left.occurrences - 1, 2)) ||
    right.text.split(/\s+/).length - left.text.split(/\s+/).length ||
    right.newestIndex - left.newestIndex);
  const selected = [];
  for (const candidate of ranked) {
    const key = candidate.text.toLocaleLowerCase("en-US");
    const redundant = !candidate.explicit && candidate.occurrences === 1 && selected.some((parent) => {
      const parentKey = parent.text.toLocaleLowerCase("en-US");
      return parentKey !== key && parentKey.split(/\s+/).length > 1 && (` ${parentKey} `).includes(` ${key} `);
    });
    if (!redundant) selected.push(candidate);
    if (selected.length >= CONTEXT_TERM_LIMIT) break;
  }
  return selected.map((candidate) => ({
    text: candidate.text,
    boost: Math.max(2, Math.min(6, Math.round(
      (candidate.score + Math.min(candidate.occurrences - 1, 2)) / 3
    ))),
    source: candidate.source,
  }));
}

function isSessionNavigationTarget(target) {
  if (!target || typeof target.closest !== "function") return false;
  return Boolean(target.closest(
    "[data-thread], [data-thread-tile-pane], [data-thread-tile-switch-target]"
  ));
}

function safeBridgeUrl(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return "";
    if (parsed.username || parsed.password) return "";
    if (parsed.pathname !== "/host") return "";
    if (parsed.search) return "";
    parsed.hash = "";
    return parsed.toString();
  } catch (_) {
    return "";
  }
}

function bridgeUrlFromRuntime(deps = {}) {
  const direct = safeBridgeUrl(deps.bridgeUrl);
  if (direct) return direct;
  const location = deps.location || {};
  try {
    const query = new URLSearchParams(String(location.search || ""));
    const fromQuery = safeBridgeUrl(query.get("voxsparkBridge"));
    if (fromQuery) return fromQuery;
  } catch (_) {}
  try {
    return safeBridgeUrl(deps.localStorage && deps.localStorage.getItem(STORAGE_BRIDGE_URL));
  } catch (_) {
    return "";
  }
}

function createVoxSparkSurfaceHostRuntime(deps = {}) {
  const document = deps.document || {};
  const window = deps.window || globalThis;
  const $ = typeof deps.$ === "function" ? deps.$ : () => null;
  const currentComposerThreadId = deps.currentComposerThreadId || (() => "");
  const composerTargetThread = deps.composerTargetThread || (() => null);
  const composerTargetActiveTurnId = deps.composerTargetActiveTurnId || (() => "");
  const composerText = deps.composerText || (() => "");
  const setComposerText = deps.setComposerText || (() => {});
  const sendMessage = deps.sendMessage || (async () => false);
  const interruptActiveTurn = deps.interruptActiveTurn || (async () => false);
  const scheduleCurrentDraftSave = deps.scheduleCurrentDraftSave || (() => {});
  const threadTitle = deps.threadTitle || ((thread) => text(thread && (thread.name || thread.title)) || "Current Session");
  const threadWorkspace = deps.threadWorkspace || ((thread) => text(thread && thread.workspace));
  const approvalPending = deps.approvalPending || (() => false);
  const report = deps.report || (() => {});
  const relay = deps.relay || null;
  const setIntervalFn = deps.setInterval || window.setInterval;
  const clearIntervalFn = deps.clearInterval || window.clearInterval;
  const setTimeoutFn = deps.setTimeout || window.setTimeout;
  const clearTimeoutFn = deps.clearTimeout || window.clearTimeout;
  const now = deps.now || Date.now;

  let bridgeUrl = "";
  let clientId = text(deps.clientId);
  let relayConnected = false;
  let relayInFlight = false;
  let relayServiceEpoch = "";
  let lastCommandSequence = 0;
  let pendingCommandResults = [];
  let contextRevision = 0;
  let contextFingerprint = "";
  let currentContext = null;
  let armedSessionId = "";
  let armedAt = 0;
  let sessionSwitchIntentAt = Number.NEGATIVE_INFINITY;
  let ignoredSessionId = "";
  let activeDraft = null;
  let lastReleasedDraftRevision = 0;
  let queuedDrafts = [];
  let queueFlushing = false;
  let queueTurnGate = "ready";
  let pollTimer = null;
  let stopped = true;

  function surfaceCanArm() {
    const visible = document.visibilityState !== "hidden";
    const focused = typeof document.hasFocus !== "function" || document.hasFocus();
    return visible && focused;
  }

  function surfaceKeepsOwnership(sessionId) {
    const visible = document.visibilityState !== "hidden";
    return Boolean(visible && sessionId && armedSessionId === sessionId);
  }

  function diagnostic(code, detail = {}) {
    report(code, Object.assign({ source: "voxspark-surface-host" }, detail));
  }

  function contextComposerDraft() {
    const current = text(composerText());
    if (activeDraft && current === activeDraft.text) return activeDraft.baseComposerText;
    return current;
  }

  function snapshotContext() {
    const sessionId = text(currentComposerThreadId());
    if (!sessionId) return null;
    const switchHasIntent = now() - sessionSwitchIntentAt <= SESSION_SWITCH_INTENT_MS;
    if (armedSessionId && armedSessionId !== sessionId && !switchHasIntent && currentContext) {
      if (ignoredSessionId !== sessionId) {
        ignoredSessionId = sessionId;
        diagnostic("session_change_ignored_without_intent");
      }
      return Object.assign({}, currentContext);
    }
    ignoredSessionId = "";
    const thread = composerTargetThread() || {};
    const canArm = surfaceCanArm();
    if (canArm && armedSessionId !== sessionId) {
      armedSessionId = sessionId;
      armedAt = now();
      sessionSwitchIntentAt = Number.NEGATIVE_INFINITY;
    }
    const focused = surfaceKeepsOwnership(sessionId);
    const activeTurnId = text(composerTargetActiveTurnId());
    return {
      sessionId,
      title: threadTitle(thread),
      workspace: threadWorkspace(thread),
      focused,
      activeTurnId,
      turnState: activeTurnId ? "running" : "idle",
      approvalPending: Boolean(approvalPending(sessionId, activeTurnId)),
      contextTerms: extractContextTerms(contextSources(thread, contextComposerDraft())),
      armedAt,
    };
  }

  function handleComposerFocusIn(event) {
    const input = $("messageInput");
    if (input && event && event.target === input) {
      armedSessionId = text(currentComposerThreadId());
      armedAt = now();
      sessionSwitchIntentAt = Number.NEGATIVE_INFINITY;
    }
    syncContext();
  }

  function handleComposerFocusOut(event) {
    syncContext();
  }

  function handleDocumentPointerDown(event) {
    if (isSessionNavigationTarget(event && event.target)) sessionSwitchIntentAt = now();
    syncContext();
  }

  function handleVisibilityChange() {
    syncContext();
  }

  function handleWindowFocus() {
    if (armedSessionId) armedAt = now();
    syncContext();
  }

  function handleWindowBlur() {
    syncContext();
  }

  function contextShape(snapshot) {
    return JSON.stringify({
      sessionId: snapshot.sessionId,
      title: snapshot.title,
      workspace: snapshot.workspace,
      focused: snapshot.focused,
      activeTurnId: snapshot.activeTurnId,
      approvalPending: snapshot.approvalPending,
      contextTerms: snapshot.contextTerms,
      armedAt: snapshot.armedAt,
    });
  }

  function publicContext() {
    return {
      session: {
        id: currentContext.sessionId,
        title: currentContext.title,
        workspace: currentContext.workspace,
      },
      composer: {
        focused: currentContext.focused,
        ownership: activeDraft ? "voxspark" : "none",
        draft_revision: activeDraft ? activeDraft.draftRevision : 0,
        released_draft_revision: lastReleasedDraftRevision,
        armed_at: currentContext.armedAt,
      },
      turn: {
        state: currentContext.turnState,
        approval_pending: currentContext.approvalPending,
      },
      local_context: {
        terms: currentContext.contextTerms,
      },
    };
  }

  async function relayContext() {
    if (relayInFlight || stopped || !relay || !bridgeUrl || !currentContext) return false;
    relayInFlight = true;
    try {
      const result = await relay({
        bridge_url: bridgeUrl,
        client_id: clientId,
        surface_revision: currentContext.revision,
        service_epoch: relayServiceEpoch,
        after_sequence: lastCommandSequence,
        command_results: pendingCommandResults.map((item) => Object.assign({}, item)),
        context: publicContext(),
      });
      relayConnected = Boolean(result && result.connected);
      const nextServiceEpoch = traceId(result && result.service_epoch);
      if (nextServiceEpoch && nextServiceEpoch !== relayServiceEpoch) {
        const serviceRestarted = Boolean(relayServiceEpoch);
        relayServiceEpoch = nextServiceEpoch;
        lastCommandSequence = 0;
        pendingCommandResults = [];
        if (serviceRestarted) diagnostic("surface_host_service_restarted");
      }
      const acceptedResultIds = new Set(Array.isArray(result && result.accepted_result_ids)
        ? result.accepted_result_ids.map(traceId).filter(Boolean)
        : []);
      if (acceptedResultIds.size) {
        pendingCommandResults = pendingCommandResults.filter((item) => !acceptedResultIds.has(item.action_id));
      }
      const commands = Array.isArray(result && result.commands) ? result.commands : [];
      for (const command of commands) {
        if (!Number.isInteger(command.sequence) || command.sequence <= lastCommandSequence) continue;
        const outcome = await handleMessage(command.message, { sequence: command.sequence });
        if (outcome === COMMAND_RETRY) break;
        lastCommandSequence = command.sequence;
      }
      return Boolean(result && result.ok);
    } catch (_) {
      relayConnected = false;
      diagnostic("bridge_relay_error");
      return false;
    } finally {
      relayInFlight = false;
    }
  }

  function syncContext(options = {}) {
    const snapshot = snapshotContext();
    if (!snapshot) return false;
    const fingerprint = contextShape(snapshot);
    const changed = fingerprint !== contextFingerprint;
    if (changed) {
      const previousSessionId = currentContext && currentContext.sessionId;
      contextRevision += 1;
      contextFingerprint = fingerprint;
      currentContext = Object.assign({}, snapshot, { revision: contextRevision });
      if (previousSessionId && previousSessionId !== snapshot.sessionId) {
        activeDraft = null;
        queuedDrafts = [];
        queueTurnGate = "ready";
        diagnostic("session_changed_drafts_cleared");
      } else if (activeDraft) {
        activeDraft.contextRevision = contextRevision;
      }
    }
    if (queueTurnGate === "awaiting_running" && snapshot.activeTurnId) {
      queueTurnGate = "awaiting_idle";
    } else if (queueTurnGate === "awaiting_idle" && !snapshot.activeTurnId) {
      queueTurnGate = "ready";
    }
    if (!currentContext) {
      flushQueuedDrafts().catch(() => {});
      return changed;
    }
    relayContext().catch(() => {});
    flushQueuedDrafts().catch(() => {});
    return true;
  }

  function revisionsMatch(message, requireDraft = true) {
    if (!currentContext || message.context_revision !== currentContext.revision) return false;
    if (!requireDraft) return true;
    return Boolean(
      activeDraft
      && message.draft_revision === activeDraft.draftRevision
      && activeDraft.contextRevision === currentContext.revision
      && activeDraft.sessionId === currentContext.sessionId
    );
  }

  function replaceComposer(message) {
    if (!revisionsMatch(message, false) || !currentContext.focused) {
      diagnostic("replace_rejected_stale_context");
      return COMMAND_RETRY;
    }
    const draftText = text(message.text);
    if (!draftText || !Number.isInteger(message.draft_revision)) {
      diagnostic("replace_rejected_invalid_draft");
      return COMMAND_DISCARD;
    }
    if (activeDraft && message.draft_revision <= activeDraft.draftRevision) {
      diagnostic("replace_rejected_duplicate_draft");
      return COMMAND_DISCARD;
    }
    const baseComposerText = text(composerText());
    const composerDraft = appendComposerText(baseComposerText, draftText);
    activeDraft = {
      sessionId: currentContext.sessionId,
      contextRevision: currentContext.revision,
      draftRevision: message.draft_revision,
      captureId: traceId(message.capture_id),
      baseComposerText,
      text: composerDraft,
      receivedAt: now(),
    };
    setComposerText(composerDraft);
    scheduleCurrentDraftSave();
    return COMMAND_ACCEPTED;
  }

  function clearComposerIfOwned(draft) {
    if (text(composerText()) === draft.text) {
      setComposerText("");
      scheduleCurrentDraftSave();
    }
  }

  function handleComposerSubmission(submission = {}) {
    const submittedSessionId = text(submission.threadId);
    if (!activeDraft || !submittedSessionId || activeDraft.sessionId !== submittedSessionId) return false;
    const releasedDraftRevision = activeDraft.draftRevision;
    activeDraft = null;
    lastReleasedDraftRevision = Math.max(lastReleasedDraftRevision, releasedDraftRevision);
    diagnostic("composer_draft_released_after_submit", {
      draftRevision: releasedDraftRevision,
    });
    syncContext({ force: true });
    return true;
  }

  async function submitDraft(draft, mode, options = {}) {
    if (!currentContext || draft.sessionId !== currentContext.sessionId) return COMMAND_DISCARD;
    if (currentContext.approvalPending) return COMMAND_DISCARD;
    const running = Boolean(text(composerTargetActiveTurnId()));
    if (mode === "submit" && running) return COMMAND_DISCARD;
    if (mode === "steer" && !running) return COMMAND_DISCARD;
    if (text(composerText()) !== draft.text) {
      if (options.restoreWhenEmpty && !text(composerText())) {
        setComposerText(draft.text);
      } else {
        diagnostic("submit_rejected_composer_changed", { action: mode });
        return COMMAND_DISCARD;
      }
    }
    await sendMessage({ preventDefault() {} });
    if (text(composerText()) === draft.text) return COMMAND_RETRY;
    if (activeDraft && activeDraft.draftRevision === draft.draftRevision) activeDraft = null;
    return COMMAND_ACCEPTED;
  }

  async function flushQueuedDrafts() {
    if (queueFlushing || !queuedDrafts.length || !currentContext) return false;
    if (queueTurnGate !== "ready") return false;
    if (currentContext.approvalPending || text(composerTargetActiveTurnId())) return false;
    if (!currentContext.focused || text(composerText())) return false;
    const draft = queuedDrafts[0];
    if (draft.sessionId !== currentContext.sessionId) {
      queuedDrafts.shift();
      diagnostic("queued_draft_discarded_session_changed");
      return false;
    }
    queueFlushing = true;
    try {
      const outcome = await submitDraft(draft, "submit", { restoreWhenEmpty: true });
      if (outcome === COMMAND_ACCEPTED) {
        queuedDrafts.shift();
        queueTurnGate = "awaiting_running";
      }
      return outcome === COMMAND_ACCEPTED;
    } finally {
      queueFlushing = false;
    }
  }

  async function handleAction(message) {
    const action = text(message.action);
    if (action === "stop") {
      if (!revisionsMatch(message, false)) return COMMAND_RETRY;
      if (!text(composerTargetActiveTurnId())) return COMMAND_DISCARD;
      await interruptActiveTurn(currentContext.sessionId, text(composerTargetActiveTurnId()));
      return COMMAND_ACCEPTED;
    }
    if (!revisionsMatch(message, true)) return COMMAND_RETRY;
    if (currentContext.approvalPending) return COMMAND_DISCARD;
    const draft = Object.assign({}, activeDraft);
    if (action === "queue") {
      if (!text(composerTargetActiveTurnId())) return COMMAND_DISCARD;
      queuedDrafts.push(draft);
      activeDraft = null;
      clearComposerIfOwned(draft);
      return COMMAND_ACCEPTED;
    }
    if (action === "submit" || action === "steer") {
      return submitDraft(draft, action);
    }
    return COMMAND_DISCARD;
  }

  async function handleMessage(event, metadata = {}) {
    let message;
    try {
      message = typeof event.data === "string" ? JSON.parse(event.data) : event;
    } catch (_) {
      diagnostic("invalid_bridge_message");
      return COMMAND_DISCARD;
    }
    if (!message || message.contract !== CONTRACT) return COMMAND_DISCARD;
    if (message.type === "bridge.ready") {
      syncContext({ force: true });
      return COMMAND_ACCEPTED;
    }
    if (message.type === "host.composer.replace") {
      const outcome = replaceComposer(message);
      diagnostic(outcome === COMMAND_ACCEPTED
        ? "composer_replace_confirmed"
        : outcome === COMMAND_RETRY
          ? "composer_replace_retry"
          : "composer_replace_rejected", {
        outcome,
        ...traceDetails(message, metadata.sequence),
        draftRevision: Number.isInteger(message.draft_revision) ? message.draft_revision : 0,
      });
      return outcome;
    }
    if (message.type === "host.action") {
      try {
        const outcome = await handleAction(message);
        const diagnosticCode = outcome === COMMAND_ACCEPTED
          ? "host_action_confirmed"
          : outcome === COMMAND_RETRY
            ? "host_action_retry"
            : "host_action_rejected";
        diagnostic(diagnosticCode, {
          action: text(message.action),
          outcome,
          ...traceDetails(message, metadata.sequence),
        });
        const actionId = traceId(message.action_id);
        if (actionId) {
          pendingCommandResults = pendingCommandResults.filter((item) => item.action_id !== actionId);
          pendingCommandResults.push({
            action_id: actionId,
            outcome: outcome === COMMAND_ACCEPTED ? "succeeded" : "failed",
            retryable: outcome === COMMAND_RETRY,
            error_code: outcome === COMMAND_ACCEPTED ? "" : outcome === COMMAND_RETRY
              ? "action_failed" : "action_rejected",
          });
        }
        syncContext({ force: true });
        return actionId ? COMMAND_ACCEPTED : outcome;
      } catch (_) {
        diagnostic("host_action_failed", {
          action: text(message.action),
          outcome: COMMAND_RETRY,
          ...traceDetails(message, metadata.sequence),
        });
        const actionId = traceId(message.action_id);
        if (actionId) {
          pendingCommandResults = pendingCommandResults.filter((item) => item.action_id !== actionId);
          pendingCommandResults.push({
            action_id: actionId,
            outcome: "failed",
            retryable: true,
            error_code: "action_failed",
          });
          return COMMAND_ACCEPTED;
        }
        return COMMAND_RETRY;
      }
    }
    return COMMAND_DISCARD;
  }

  function start() {
    if (!stopped) return Boolean(bridgeUrl);
    bridgeUrl = bridgeUrlFromRuntime(deps);
    if (!bridgeUrl || typeof relay !== "function") return false;
    if (!clientId) {
      const cryptoApi = deps.crypto || window.crypto;
      clientId = cryptoApi && typeof cryptoApi.randomUUID === "function"
        ? cryptoApi.randomUUID()
        : `surface-${now()}-${Math.random().toString(16).slice(2)}`;
    }
    stopped = false;
    if (document.addEventListener) {
      document.addEventListener("focusin", handleComposerFocusIn);
      document.addEventListener("focusout", handleComposerFocusOut);
      document.addEventListener("pointerdown", handleDocumentPointerDown, true);
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    if (window.addEventListener) {
      window.addEventListener("focus", handleWindowFocus);
      window.addEventListener("blur", handleWindowBlur);
    }
    pollTimer = setIntervalFn(() => syncContext(), 500);
    syncContext({ force: true });
    return true;
  }

  function configureBridgeUrl(value) {
    const nextUrl = safeBridgeUrl(value);
    if (!nextUrl) return false;
    if (nextUrl === bridgeUrl && !stopped) return true;
    if (!stopped) stop();
    bridgeUrl = nextUrl;
    deps.bridgeUrl = nextUrl;
    return start();
  }

  function stop() {
    stopped = true;
    if (pollTimer) clearIntervalFn(pollTimer);
    pollTimer = null;
    if (document.removeEventListener) {
      document.removeEventListener("focusin", handleComposerFocusIn);
      document.removeEventListener("focusout", handleComposerFocusOut);
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
    if (window.removeEventListener) {
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("blur", handleWindowBlur);
    }
    relayConnected = false;
  }

  function readState() {
    return {
      enabled: Boolean(bridgeUrl),
      connected: relayConnected,
      armedSessionId,
      contextRevision,
      currentContext: currentContext ? Object.assign({}, currentContext) : null,
      activeDraft: activeDraft ? Object.assign({}, activeDraft) : null,
      lastReleasedDraftRevision,
      queuedDrafts: queuedDrafts.map((draft) => Object.assign({}, draft)),
      queueTurnGate,
      pendingCommandResults: pendingCommandResults.map((item) => Object.assign({}, item)),
    };
  }

  return {
    configureBridgeUrl,
    start,
    stop,
    syncContext,
    handleComposerSubmission,
    handleMessage,
    flushQueuedDrafts,
    readState,
  };
}

const api = Object.freeze({
  CONTRACT,
  STORAGE_BRIDGE_URL,
  appendComposerText,
  safeBridgeUrl,
  bridgeUrlFromRuntime,
  createVoxSparkSurfaceHostRuntime,
});

const voxsparkSurfaceHostRoot = typeof globalThis !== "undefined" ? globalThis : window;
voxsparkSurfaceHostRoot.CodexVoxSparkSurfaceHostRuntime = api;

export {
  CONTRACT,
  STORAGE_BRIDGE_URL,
  appendComposerText,
  safeBridgeUrl,
  bridgeUrlFromRuntime,
  createVoxSparkSurfaceHostRuntime,
};

export default api;
