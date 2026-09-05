"use strict";

const crypto = require("node:crypto");

const CONTRACT = "voxspark.surface.v1alpha1";
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RECONNECT_MS = 1_500;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const MAX_PENDING_COMMANDS = 16;
const MAX_CONTEXT_OWNERS = 32;
const MAX_CONTEXT_TERMS = 32;
const MAX_REFERENCE_MESSAGES = 6;
const MAX_REFERENCE_BYTES = 12 * 1024;
const MAX_COMPOSER_BYTES = 8 * 1024;
const MAX_CORRECTION_RULES = 32;
const MAX_TRANSACTION_RECEIPTS = 64;
const TRANSACTION_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const POLISH_CONTEXT_CONSENT = "bounded-context-v1";
const SESSION_PROFILES = new Set(["general", "coding-agent", "journal", "product-discussion"]);
const LANGUAGE_POLICIES = new Set(["auto", "zh-CN-mixed"]);

function boundedText(value, maxLength) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function traceId(value) {
  const candidate = boundedText(value, 96);
  return /^[A-Za-z0-9._:-]+$/.test(candidate) ? candidate : "";
}

function utf8Bytes(value) {
  return Buffer.byteLength(String(value || ""), "utf8");
}

function normalizeContextTerms(value) {
  if (!Array.isArray(value) || value.length > MAX_CONTEXT_TERMS) return null;
  const terms = [];
  for (const item of value) {
    const term = boundedText(item && item.text, 64);
    const boost = Number(item && item.boost);
    const source = item && item.source;
    if (!term || Array.from(term).length > 64 || !Number.isInteger(boost)
      || boost < 2 || boost > 6 || (source !== "session" && source !== "composer")) return null;
    terms.push({ text: term, boost, source });
  }
  return terms;
}

function normalizePolishContext(value, expectedConsent) {
  if (!expectedConsent) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.consent !== expectedConsent || value.consent !== POLISH_CONTEXT_CONSENT) return null;
  const conversation = value.reference_conversation;
  const composerDraft = typeof value.composer_draft === "string" ? value.composer_draft.trim() : "";
  const correctionRules = value.correction_rules;
  if (!Array.isArray(conversation) || conversation.length > MAX_REFERENCE_MESSAGES
    || !Array.isArray(correctionRules) || correctionRules.length > MAX_CORRECTION_RULES
    || utf8Bytes(composerDraft) > MAX_COMPOSER_BYTES) return null;
  const referenceConversation = [];
  let referenceBytes = utf8Bytes(composerDraft);
  for (const item of conversation) {
    const role = item && item.role;
    const messageText = typeof item?.text === "string" ? item.text.trim() : "";
    if ((role !== "user" && role !== "assistant") || !messageText) return null;
    referenceBytes += utf8Bytes(messageText);
    if (referenceBytes > MAX_REFERENCE_BYTES) return null;
    referenceConversation.push({ role, text: messageText });
  }
  const normalizedRules = [];
  for (const item of correctionRules) {
    const heard = boundedText(item && item.heard, 64);
    const write = boundedText(item && item.write, 64);
    if (!heard || !write || heard === write
      || Array.from(heard).length > 64 || Array.from(write).length > 64) return null;
    normalizedRules.push({ heard, write });
  }
  const sessionProfile = String(value.session_profile || "");
  const languagePolicy = String(value.language_policy || "");
  if (!SESSION_PROFILES.has(sessionProfile) || !LANGUAGE_POLICIES.has(languagePolicy)) return null;
  return {
    consent: POLISH_CONTEXT_CONSENT,
    reference_conversation: referenceConversation,
    composer_draft: composerDraft,
    correction_rules: normalizedRules,
    session_profile: sessionProfile,
    language_policy: languagePolicy,
  };
}

function commandTrace(message) {
  return {
    capture_id: traceId(message && message.capture_id),
    action_id: traceId(message && message.action_id),
  };
}

function normalizeCommandResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const actionId = traceId(value.action_id);
  const outcome = ["succeeded", "failed", "unknown"].includes(value.outcome) ? value.outcome : "";
  const errorCode = value.error_code == null ? "" : traceId(value.error_code);
  if (!actionId || !outcome || (boundedText(value.error_code, 96) && !errorCode)) return null;
  return {
    action_id: actionId,
    outcome,
    retryable: value.retryable === true,
    error_code: errorCode,
  };
}

function commandAppendId(message) {
  const explicit = traceId(message && message.append_id);
  if (explicit) return explicit;
  const captureId = traceId(message && message.capture_id);
  const contextRevision = Number(message && message.context_revision);
  const draftRevision = Number(message && message.draft_revision);
  if (!Number.isInteger(draftRevision) || draftRevision < 1) return "";
  const owner = captureId || (Number.isInteger(contextRevision) && contextRevision > 0
    ? `context-${contextRevision}` : "");
  return owner ? traceId(`draft:${owner.slice(0, 64)}:${draftRevision}`) : "";
}

function persistentCommandMessage(message) {
  const source = message && typeof message === "object" ? message : {};
  if (source.type === "host.composer.replace") {
    return {
      type: "host.composer.replace",
      contract: source.contract,
      append_id: commandAppendId(source),
      context_revision: source.context_revision,
      draft_revision: source.draft_revision,
      capture_id: source.capture_id,
    };
  }
  return {
    type: "host.action",
    contract: source.contract,
    action: source.action,
    action_id: source.action_id,
    context_revision: source.context_revision,
    draft_revision: source.draft_revision,
    capture_id: source.capture_id,
    suggestion_id: source.suggestion_id,
  };
}

function normalizeStoredLedger(value, nowMs) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const cutoff = nowMs - TRANSACTION_RECEIPT_TTL_MS;
  const pendingCommands = (Array.isArray(input.pendingCommands) ? input.pendingCommands : [])
    .slice(-MAX_PENDING_COMMANDS)
    .filter((item) => item && Number.isInteger(item.sequence) && item.sequence > 0
      && traceId(item.clientId) && traceId(item.sessionId)
      && Number.isFinite(item.expiresAt) && item.expiresAt > nowMs
      && item.message && ["host.composer.replace", "host.action"].includes(item.message.type))
    .map((item) => ({
      sequence: item.sequence,
      clientId: traceId(item.clientId),
      sessionId: traceId(item.sessionId),
      surfaceRevision: Number.isInteger(item.surfaceRevision) ? item.surfaceRevision : 0,
      deliveredAt: Number.isFinite(item.deliveredAt) ? item.deliveredAt : 0,
      expiresAt: item.expiresAt,
      recoveryUncertain: item.recoveryUncertain === true,
      message: { ...item.message },
    }));
  const pendingResults = (Array.isArray(input.pendingResults) ? input.pendingResults : [])
    .map(normalizeCommandResult)
    .filter(Boolean)
    .slice(-MAX_PENDING_COMMANDS);
  const commandAckReceipts = (Array.isArray(input.commandAckReceipts) ? input.commandAckReceipts : [])
    .filter((item) => item && traceId(item.clientId) && Number.isInteger(item.sequence)
      && item.sequence > 0 && Number(item.updatedAt || 0) >= cutoff)
    .slice(-MAX_TRANSACTION_RECEIPTS)
    .map((item) => ({ clientId: traceId(item.clientId), sequence: item.sequence, updatedAt: Number(item.updatedAt) }));
  const appendReceipts = (Array.isArray(input.appendReceipts) ? input.appendReceipts : [])
    .filter((item) => item && traceId(item.appendId) && traceId(item.sessionId)
      && Number.isInteger(item.draftRevision) && item.draftRevision > 0
      && Number(item.updatedAt || 0) >= cutoff)
    .slice(-MAX_TRANSACTION_RECEIPTS)
    .map((item) => ({
      appendId: traceId(item.appendId),
      sessionId: traceId(item.sessionId),
      draftRevision: item.draftRevision,
      phase: item.phase === "applied" ? "applied" : item.phase === "uncertain" ? "uncertain" : "queued",
      updatedAt: Number(item.updatedAt),
    }));
  const actionReceipts = (Array.isArray(input.actionReceipts) ? input.actionReceipts : [])
    .filter((item) => item && traceId(item.actionId) && traceId(item.clientId)
      && traceId(item.sessionId) && Number(item.updatedAt || 0) >= cutoff)
    .slice(-MAX_TRANSACTION_RECEIPTS)
    .map((item) => ({
      actionId: traceId(item.actionId),
      clientId: traceId(item.clientId),
      sessionId: traceId(item.sessionId),
      phase: ["queued", "executing", "unknown", "succeeded", "failed"].includes(item.phase)
        ? item.phase : "queued",
      updatedAt: Number(item.updatedAt),
    }));
  const highestSequence = pendingCommands.reduce((highest, item) => Math.max(highest, item.sequence), 0);
  return {
    commandSequence: Math.max(Number.isInteger(input.commandSequence) ? input.commandSequence : 0, highestSequence),
    pendingCommands,
    pendingResults,
    commandAckReceipts,
    appendReceipts,
    actionReceipts,
  };
}

function safeLoopbackBridgeUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "ws:") return "";
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost" && parsed.hostname !== "[::1]") return "";
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return "";
    if (parsed.pathname !== "/host") return "";
    return parsed.toString();
  } catch (_) {
    return "";
  }
}

function normalizeContext(value, options = {}) {
  const input = value && typeof value === "object" ? value : {};
  const session = input.session && typeof input.session === "object" ? input.session : {};
  const composer = input.composer && typeof input.composer === "object" ? input.composer : {};
  const turn = input.turn && typeof input.turn === "object" ? input.turn : {};
  const sessionId = boundedText(session.id, 128);
  if (!sessionId) return null;
  const localContext = input.local_context && typeof input.local_context === "object"
    ? normalizeContextTerms(input.local_context.terms)
    : [];
  if (localContext === null) return null;
  const normalized = {
    session: {
      id: sessionId,
      title: boundedText(session.title, 160) || "Current Session",
      workspace: boundedText(session.workspace, 160),
    },
    composer: {
      focused: composer.focused === true,
      ownership: composer.ownership === "voxspark" ? "voxspark" : "none",
      draft_revision: Number.isInteger(composer.draft_revision) && composer.draft_revision >= 0
        ? composer.draft_revision
        : 0,
      released_draft_revision: Number.isInteger(composer.released_draft_revision)
        && composer.released_draft_revision >= 0
        ? composer.released_draft_revision
        : 0,
      armed_at: Number.isFinite(composer.armed_at) && composer.armed_at >= 0
        ? Math.floor(composer.armed_at)
        : 0,
    },
    turn: {
      state: turn.state === "running" ? "running" : "idle",
      approval_pending: turn.approval_pending === true,
    },
    local_context: { terms: localContext },
  };
  const polishContext = normalizePolishContext(input.polish_context, options.polishContextConsent);
  if (options.polishContextConsent && input.polish_context != null && !polishContext) return null;
  if (polishContext) normalized.polish_context = polishContext;
  return normalized;
}

function createVoxSparkSurfaceHostService(options = {}) {
  const WebSocketImpl = options.WebSocket || globalThis.WebSocket;
  const now = options.now || Date.now;
  const setTimeoutFn = options.setTimeout || setTimeout;
  const clearTimeoutFn = options.clearTimeout || clearTimeout;
  const leaseMs = Math.max(5_000, Number(options.leaseMs || DEFAULT_LEASE_MS));
  const reconnectMs = Math.max(100, Number(options.reconnectMs || DEFAULT_RECONNECT_MS));
  const connectTimeoutMs = Math.max(500, Number(options.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS));
  const logger = options.logger || console;
  const defaultBridgeUrl = safeLoopbackBridgeUrl(options.defaultBridgeUrl);
  const polishContextConsent = options.polishContextConsent === POLISH_CONTEXT_CONSENT
    ? POLISH_CONTEXT_CONSENT
    : "";
  const serviceEpoch = traceId(options.serviceEpoch) || crypto.randomUUID();
  const transactionStore = options.transactionStore
    && typeof options.transactionStore.load === "function"
    && typeof options.transactionStore.save === "function"
    ? options.transactionStore
    : null;
  const restoredLedger = normalizeStoredLedger(transactionStore ? transactionStore.load() : null, now());

  let bridgeUrl = "";
  let socket = null;
  let reconnectTimer = null;
  let connectTimer = null;
  let leaseTimer = null;
  let stopped = false;
  let contextRevision = 0;
  let commandSequence = restoredLedger.commandSequence;
  let target = null;
  let contextOwners = new Map();
  let pendingCommands = restoredLedger.pendingCommands;
  let pendingResults = restoredLedger.pendingResults;
  let commandAckReceipts = restoredLedger.commandAckReceipts;
  let appendReceipts = restoredLedger.appendReceipts;
  let actionReceipts = restoredLedger.actionReceipts;

  function logCommand(event, details = {}) {
    if (!logger || typeof logger.info !== "function") return;
    logger.info(`[voxspark] surface command ${event}`, JSON.stringify(details));
  }

  function persistTransactions() {
    if (!transactionStore) return false;
    const saved = transactionStore.save({
      commandSequence,
      pendingCommands: pendingCommands.map((item) => ({
        ...item,
        message: persistentCommandMessage(item.message),
      })),
      pendingResults,
      commandAckReceipts,
      appendReceipts,
      actionReceipts,
    });
    if (!saved) logCommand("ledger_write_failed");
    return saved;
  }

  function trimReceipts() {
    const cutoff = now() - TRANSACTION_RECEIPT_TTL_MS;
    commandAckReceipts = commandAckReceipts.filter((item) => item.updatedAt >= cutoff).slice(-MAX_TRANSACTION_RECEIPTS);
    appendReceipts = appendReceipts.filter((item) => item.updatedAt >= cutoff).slice(-MAX_TRANSACTION_RECEIPTS);
    actionReceipts = actionReceipts.filter((item) => item.updatedAt >= cutoff).slice(-MAX_TRANSACTION_RECEIPTS);
  }

  function rememberCommandAck(clientId, sequence) {
    commandAckReceipts = commandAckReceipts.filter((item) => (
      item.clientId !== clientId || item.sequence !== sequence
    ));
    commandAckReceipts.push({ clientId, sequence, updatedAt: now() });
  }

  function commandAckWasRecorded(clientId, sequence) {
    return commandAckReceipts.some((item) => item.clientId === clientId && item.sequence === sequence);
  }

  function setAppendReceipt(appendId, sessionId, draftRevision, phase) {
    if (!appendId) return;
    appendReceipts = appendReceipts.filter((item) => item.appendId !== appendId);
    appendReceipts.push({ appendId, sessionId, draftRevision, phase, updatedAt: now() });
  }

  function appendReceipt(appendId) {
    return appendReceipts.find((item) => item.appendId === appendId) || null;
  }

  function setActionReceipt(actionId, clientId, sessionId, phase) {
    if (!actionId) return;
    actionReceipts = actionReceipts.filter((item) => item.actionId !== actionId);
    actionReceipts.push({ actionId, clientId, sessionId, phase, updatedAt: now() });
  }

  function actionReceipt(actionId) {
    return actionReceipts.find((item) => item.actionId === actionId) || null;
  }

  function setPendingResult(result) {
    pendingResults = pendingResults.filter((item) => item.action_id !== result.action_id);
    pendingResults.push(result);
    if (pendingResults.length > MAX_PENDING_COMMANDS) pendingResults.shift();
  }

  function markRestoredTransactionsUncertain() {
    let changed = false;
    pendingCommands = pendingCommands.flatMap((item) => {
      if (item.message.type === "host.composer.replace" && !item.deliveredAt) {
        changed = true;
        return [];
      }
      if (!item.deliveredAt || item.recoveryUncertain) return item;
      changed = true;
      const next = { ...item, recoveryUncertain: true };
      if (item.message.type === "host.composer.replace") {
        setAppendReceipt(commandAppendId(item.message), item.sessionId, item.message.draft_revision, "uncertain");
      } else {
        const actionId = traceId(item.message.action_id);
        const receipt = actionReceipt(actionId);
        if (!receipt || !["succeeded", "failed"].includes(receipt.phase)) {
          setActionReceipt(actionId, item.clientId, item.sessionId, "unknown");
          setPendingResult({ action_id: actionId, outcome: "unknown", retryable: false, error_code: "action_outcome_unknown" });
        }
      }
      return [next];
    });
    for (const receipt of [...actionReceipts]) {
      if (receipt.phase !== "executing") continue;
      setActionReceipt(receipt.actionId, receipt.clientId, receipt.sessionId, "unknown");
      setPendingResult({
        action_id: receipt.actionId,
        outcome: "unknown",
        retryable: false,
        error_code: "action_outcome_unknown",
      });
      changed = true;
    }
    trimReceipts();
    if (transactionStore) persistTransactions();
  }

  markRestoredTransactionsUncertain();

  function socketIsOpen() {
    return Boolean(socket && WebSocketImpl && socket.readyState === WebSocketImpl.OPEN);
  }

  function send(message) {
    if (!socketIsOpen()) return false;
    socket.send(JSON.stringify({ contract: CONTRACT, ...message }));
    return true;
  }

  function sendTargetContext() {
    if (!target) return false;
    return send({
      type: "host.context",
      context_revision: target.contextRevision,
      ...target.context,
    });
  }

  function sendPendingResults() {
    for (const result of pendingResults) send({ type: "host.action.result", ...result });
  }

  function clearReconnectTimer() {
    if (reconnectTimer) clearTimeoutFn(reconnectTimer);
    reconnectTimer = null;
  }

  function clearConnectTimer() {
    if (connectTimer) clearTimeoutFn(connectTimer);
    connectTimer = null;
  }

  function scheduleReconnect() {
    if (stopped || !bridgeUrl || reconnectTimer) return;
    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = null;
      connect();
    }, reconnectMs);
  }

  function parseBridgeMessage(event) {
    try {
      return JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    } catch (_) {
      return null;
    }
  }

  function handleBridgeMessage(event) {
    let message = parseBridgeMessage(event);
    if (!message || message.contract !== CONTRACT) return;
    if (message.type === "bridge.ready") {
      sendTargetContext();
      sendPendingResults();
      return;
    }
    if (message.type === "bridge.action.ack") {
      const actionId = traceId(message.action_id);
      if (!actionId) return;
      const before = pendingResults.length;
      pendingResults = pendingResults.filter((item) => item.action_id !== actionId);
      if (pendingResults.length !== before) {
        logCommand("result_acknowledged", { action_id: actionId });
        persistTransactions();
      }
      return;
    }
    if (message.type !== "host.composer.replace" && message.type !== "host.action") return;
    if (!target || target.expiresAt <= now()) return;
    const messageOwner = contextOwners.get(message.context_revision);
    if (!messageOwner || messageOwner.expiresAt <= now()) return;
    const targetStillOwnsMessage = target.clientId === messageOwner.clientId
      && target.context.session.id === messageOwner.sessionId;
    const deliverySurfaceRevision = targetStillOwnsMessage
      ? target.surfaceRevision
      : messageOwner.surfaceRevision;
    if (message.type === "host.composer.replace") {
      const appendId = commandAppendId(message);
      const receipt = appendReceipt(appendId);
      const alreadyPending = pendingCommands.some((item) => (
        item.message.type === "host.composer.replace" && commandAppendId(item.message) === appendId
      ));
      if (!appendId || receipt?.phase === "applied" || alreadyPending) {
        logCommand("deduplicated", { type: message.type, append_id: appendId });
        return;
      }
      if (traceId(message.append_id)) message = { ...message, append_id: appendId };
      setAppendReceipt(appendId, messageOwner.sessionId, message.draft_revision, "queued");
    } else {
      const actionId = traceId(message.action_id);
      const receipt = actionReceipt(actionId);
      const alreadyPending = pendingCommands.some((item) => (
        item.message.type === "host.action" && item.message.action_id === actionId
      ));
      if (actionId && (receipt || alreadyPending)) {
        logCommand("deduplicated", { type: message.type, action_id: actionId, phase: receipt?.phase || "queued" });
        sendPendingResults();
        return;
      }
      if (actionId) setActionReceipt(actionId, messageOwner.clientId, messageOwner.sessionId, "queued");
    }
    commandSequence += 1;
    pendingCommands.push({
      sequence: commandSequence,
      clientId: messageOwner.clientId,
      sessionId: messageOwner.sessionId,
      surfaceRevision: deliverySurfaceRevision,
      deliveredAt: 0,
      expiresAt: now() + (leaseMs * 2),
      message: { ...message, context_revision: deliverySurfaceRevision },
    });
    logCommand("queued", {
      sequence: commandSequence,
      type: message.type,
      action: boundedText(message.action, 32),
      surface_revision: target.surfaceRevision,
      ...commandTrace(message),
    });
    if (pendingCommands.length > MAX_PENDING_COMMANDS) {
      pendingCommands = pendingCommands.slice(-MAX_PENDING_COMMANDS);
    }
    trimReceipts();
    persistTransactions();
  }

  function connect() {
    if (stopped || !bridgeUrl || !WebSocketImpl) return false;
    if (socket && (socket.readyState === WebSocketImpl.OPEN || socket.readyState === WebSocketImpl.CONNECTING)) return true;
    clearReconnectTimer();
    const nextSocket = new WebSocketImpl(bridgeUrl);
    socket = nextSocket;
    clearConnectTimer();
    connectTimer = setTimeoutFn(() => {
      if (socket !== nextSocket || nextSocket.readyState !== WebSocketImpl.CONNECTING) return;
      socket = null;
      try {
        nextSocket.close(1000, "connect timeout");
      } catch (_) {}
      scheduleReconnect();
    }, connectTimeoutMs);
    nextSocket.addEventListener("open", () => {
      if (socket !== nextSocket) return;
      clearConnectTimer();
      sendTargetContext();
      sendPendingResults();
    });
    nextSocket.addEventListener("message", handleBridgeMessage);
    nextSocket.addEventListener("close", () => {
      if (socket !== nextSocket) return;
      clearConnectTimer();
      socket = null;
      scheduleReconnect();
    });
    nextSocket.addEventListener("error", () => {
      if (socket !== nextSocket) return;
      clearConnectTimer();
      socket = null;
      try {
        nextSocket.close(1000, "connect error");
      } catch (_) {}
      scheduleReconnect();
    });
    return true;
  }

  function configure(value) {
    const nextUrl = safeLoopbackBridgeUrl(value);
    if (!nextUrl) return false;
    if (nextUrl === bridgeUrl) {
      connect();
      return true;
    }
    bridgeUrl = nextUrl;
    clearReconnectTimer();
    clearConnectTimer();
    if (socket && typeof socket.close === "function") socket.close(1000, "bridge changed");
    socket = null;
    connect();
    return true;
  }

  function expireTarget(expectedRevision) {
    if (!target || target.contextRevision !== expectedRevision || target.expiresAt > now()) return;
    contextRevision += 1;
    target = {
      ...target,
      contextRevision,
      expiresAt: 0,
      context: {
        ...target.context,
        composer: { ...target.context.composer, focused: false, ownership: "none" },
      },
    };
    sendTargetContext();
  }

  function scheduleLease() {
    if (leaseTimer) clearTimeoutFn(leaseTimer);
    if (!target) return;
    const expectedRevision = target.contextRevision;
    leaseTimer = setTimeoutFn(() => expireTarget(expectedRevision), leaseMs + 10);
  }

  function publish(input = {}) {
    const urlAccepted = configure(input.bridge_url || defaultBridgeUrl);
    if (!urlAccepted) return { ok: false, code: "invalid_bridge_url" };
    const clientId = boundedText(input.client_id, 128);
    const surfaceRevision = Number(input.surface_revision);
    const context = normalizeContext(input.context, { polishContextConsent });
    if (!clientId || !Number.isInteger(surfaceRevision) || surfaceRevision < 1 || !context) {
      return { ok: false, code: "invalid_context" };
    }
    const afterSequence = Number.isInteger(input.after_sequence) && input.after_sequence >= 0
      ? input.after_sequence
      : 0;
    const acknowledgementMatchesService = traceId(input.service_epoch) === serviceEpoch;
    const effectiveAfterSequence = acknowledgementMatchesService ? afterSequence : 0;
    const acknowledgedSequences = Array.isArray(input.acknowledged_sequences)
      ? [...new Set(input.acknowledged_sequences.slice(0, MAX_PENDING_COMMANDS)
        .filter((value) => Number.isInteger(value) && value > 0))]
      : null;
    const acceptedCommandSequences = [];
    const acceptedResultIds = [];
    let ledgerChanged = false;
    if (Array.isArray(input.command_results)) {
      for (const rawResult of input.command_results.slice(0, MAX_PENDING_COMMANDS)) {
        const result = normalizeCommandResult(rawResult);
        if (!result) continue;
        const receipt = actionReceipt(result.action_id);
        if (!receipt || receipt.clientId !== clientId) continue;
        if (["succeeded", "failed"].includes(receipt.phase)) {
          acceptedResultIds.push(result.action_id);
          continue;
        }
        setPendingResult(result);
        setActionReceipt(result.action_id, receipt.clientId, receipt.sessionId, result.outcome);
        if (["succeeded", "failed"].includes(result.outcome)) {
          const completedCommands = pendingCommands.filter((item) => (
            item.message.type === "host.action" && item.message.action_id === result.action_id
          ));
          for (const item of completedCommands) rememberCommandAck(item.clientId, item.sequence);
          pendingCommands = pendingCommands.filter((item) => (
            item.message.type !== "host.action" || item.message.action_id !== result.action_id
          ));
        }
        send({ type: "host.action.result", ...result });
        logCommand("result_queued", {
          action_id: result.action_id,
          outcome: result.outcome,
          retryable: result.retryable,
          error_code: result.error_code || null,
        });
        acceptedResultIds.push(result.action_id);
        ledgerChanged = true;
      }
    }
    if (context.composer.ownership === "voxspark" && context.composer.draft_revision > 0) {
      const reconciled = pendingCommands.filter((item) => (
        item.recoveryUncertain && item.message.type === "host.composer.replace"
        && item.sessionId === context.session.id
        && item.message.draft_revision === context.composer.draft_revision
      ));
      if (reconciled.length) {
        for (const item of reconciled) {
          rememberCommandAck(item.clientId, item.sequence);
          setAppendReceipt(commandAppendId(item.message), item.sessionId, item.message.draft_revision, "applied");
        }
        const reconciledSequences = new Set(reconciled.map((item) => item.sequence));
        pendingCommands = pendingCommands.filter((item) => !reconciledSequences.has(item.sequence));
        ledgerChanged = true;
        logCommand("append_reconciled", {
          sequences: [...reconciledSequences],
          draft_revision: context.composer.draft_revision,
        });
      }
    }
    const pendingBeforeExpiry = pendingCommands.length;
    const expiredCommands = pendingCommands.filter((item) => item.expiresAt <= now());
    pendingCommands = pendingCommands.filter((item) => item.expiresAt > now());
    if (pendingCommands.length !== pendingBeforeExpiry) {
      for (const item of expiredCommands) {
        if (item.message.type === "host.composer.replace") {
          setAppendReceipt(commandAppendId(item.message), item.sessionId, item.message.draft_revision, "uncertain");
        } else {
          const actionId = traceId(item.message.action_id);
          const receipt = actionReceipt(actionId);
          if (receipt && !["succeeded", "failed"].includes(receipt.phase)) {
            setActionReceipt(actionId, item.clientId, item.sessionId, "unknown");
            setPendingResult({ action_id: actionId, outcome: "unknown", retryable: false, error_code: "action_outcome_unknown" });
          }
        }
      }
      ledgerChanged = true;
      logCommand("discarded", {
        count: pendingBeforeExpiry - pendingCommands.length,
        reason: "command_expired",
      });
    }
    if (acknowledgedSequences) {
      const acknowledgedSet = new Set(acknowledgedSequences);
      const acknowledged = pendingCommands.filter((item) => (
        item.clientId === clientId && acknowledgedSet.has(item.sequence)
      ));
      for (const sequence of acknowledgedSequences) {
        if (acknowledged.some((item) => item.sequence === sequence) || commandAckWasRecorded(clientId, sequence)) {
          acceptedCommandSequences.push(sequence);
        }
      }
      if (acknowledged.length) {
        logCommand("acknowledged", {
          sequences: acknowledged.map((item) => item.sequence),
          capture_ids: acknowledged.map((item) => commandTrace(item.message).capture_id).filter(Boolean),
          action_ids: acknowledged.map((item) => commandTrace(item.message).action_id).filter(Boolean),
        });
      }
      for (const item of acknowledged) {
        rememberCommandAck(clientId, item.sequence);
        if (item.message.type === "host.composer.replace") {
          setAppendReceipt(commandAppendId(item.message), item.sessionId, item.message.draft_revision, "applied");
        } else {
          const receipt = actionReceipt(item.message.action_id);
          if (receipt && receipt.phase === "queued") {
            setActionReceipt(receipt.actionId, receipt.clientId, receipt.sessionId, "executing");
          }
        }
      }
      pendingCommands = pendingCommands.filter((item) => (
        item.clientId !== clientId || !acknowledgedSet.has(item.sequence)
      ));
      if (acknowledged.length) ledgerChanged = true;
    } else if (effectiveAfterSequence > 0) {
      const acknowledged = pendingCommands.filter((item) => (
        item.clientId === clientId && item.sequence === effectiveAfterSequence
      ));
      if (acknowledged.length) {
        logCommand("acknowledged", {
          sequences: acknowledged.map((item) => item.sequence),
          capture_ids: acknowledged.map((item) => commandTrace(item.message).capture_id).filter(Boolean),
          action_ids: acknowledged.map((item) => commandTrace(item.message).action_id).filter(Boolean),
        });
      }
      for (const item of acknowledged) {
        rememberCommandAck(clientId, item.sequence);
        if (item.message.type === "host.composer.replace") {
          setAppendReceipt(commandAppendId(item.message), item.sessionId, item.message.draft_revision, "applied");
        }
      }
      pendingCommands = pendingCommands.filter((item) => (
        item.clientId !== clientId || item.sequence !== effectiveAfterSequence
      ));
      if (acknowledged.length) ledgerChanged = true;
    }
    trimReceipts();
    if (ledgerChanged) persistTransactions();
    const targetIsLive = Boolean(target && target.expiresAt > now());
    const targetArmedAt = targetIsLive && target.context.composer.focused
      ? target.context.composer.armed_at
      : -1;
    const incomingArmedAt = context.composer.focused ? context.composer.armed_at : -1;
    if (targetIsLive && target.clientId !== clientId && targetArmedAt >= incomingArmedAt) {
      return {
        ok: true,
        connected: socketIsOpen(),
        service_epoch: serviceEpoch,
        context_revision: target.contextRevision,
        lease_ms: leaseMs,
        commands: [],
        accepted_command_sequences: acceptedCommandSequences,
        accepted_result_ids: acceptedResultIds,
      };
    }
    const fingerprint = JSON.stringify(context);
    const sameSurfaceOwner = Boolean(target
      && target.clientId === clientId
      && target.context.session.id === context.session.id);
    const changed = !target
      || target.clientId !== clientId
      || target.surfaceRevision !== surfaceRevision
      || target.fingerprint !== fingerprint
      || target.expiresAt <= now();
    if (changed) {
      contextRevision += 1;
      if (sameSurfaceOwner) {
        let reboundCount = 0;
        pendingCommands = pendingCommands.map((item) => {
          if (item.clientId !== clientId || item.sessionId !== context.session.id) return item;
          reboundCount += 1;
          return {
            ...item,
            surfaceRevision,
            message: { ...item.message, context_revision: surfaceRevision },
          };
        });
        if (reboundCount) {
          logCommand("rebound", {
            count: reboundCount,
            surface_revision: surfaceRevision,
          });
        }
      } else {
        let transferredCount = 0;
        pendingCommands = pendingCommands.map((item) => {
          if (!context.composer.focused || item.sessionId !== context.session.id || item.deliveredAt) {
            return item;
          }
          transferredCount += 1;
          return {
            ...item,
            clientId,
            surfaceRevision,
            message: { ...item.message, context_revision: surfaceRevision },
          };
        });
        if (transferredCount) {
          logCommand("transferred", {
            count: transferredCount,
            surface_revision: surfaceRevision,
          });
        }
      }
    }
    target = {
      clientId,
      surfaceRevision,
      contextRevision: changed ? contextRevision : target.contextRevision,
      context,
      fingerprint,
      expiresAt: now() + leaseMs,
    };
    contextOwners.set(target.contextRevision, {
      clientId: target.clientId,
      sessionId: target.context.session.id,
      surfaceRevision: target.surfaceRevision,
      expiresAt: now() + (leaseMs * 2),
    });
    while (contextOwners.size > MAX_CONTEXT_OWNERS) {
      contextOwners.delete(contextOwners.keys().next().value);
    }
    scheduleLease();
    if (changed) sendTargetContext();
    const deliverable = context.composer.focused
      ? pendingCommands.filter((item) => (
        item.clientId === clientId
        && item.sessionId === context.session.id
        && item.recoveryUncertain !== true
      ))
      : [];
    let deliveryChanged = false;
    for (const item of deliverable) {
      if (!item.deliveredAt) {
        item.deliveredAt = now();
        deliveryChanged = true;
      }
      if (item.message.type === "host.action") {
        const receipt = actionReceipt(item.message.action_id);
        if (receipt && receipt.phase === "queued") {
          setActionReceipt(receipt.actionId, receipt.clientId, receipt.sessionId, "executing");
          deliveryChanged = true;
        }
      }
    }
    if (deliveryChanged) persistTransactions();
    const commands = deliverable.map((item) => ({ sequence: item.sequence, message: item.message }));
    if (commands.length) {
      logCommand("delivered", {
        sequences: commands.map((item) => item.sequence),
        surface_revision: surfaceRevision,
        capture_ids: deliverable.map((item) => commandTrace(item.message).capture_id).filter(Boolean),
        action_ids: deliverable.map((item) => commandTrace(item.message).action_id).filter(Boolean),
      });
    }
    return {
      ok: true,
      connected: socketIsOpen(),
      service_epoch: serviceEpoch,
      context_revision: target.contextRevision,
      lease_ms: leaseMs,
      commands,
      accepted_command_sequences: acceptedCommandSequences,
      accepted_result_ids: acceptedResultIds,
    };
  }

  function status() {
    return {
      configured: Boolean(bridgeUrl),
      connected: socketIsOpen(),
      target_active: Boolean(target && target.expiresAt > now() && target.context.composer.focused),
      context_revision: target ? target.contextRevision : 0,
      pending_commands: pendingCommands.length,
      pending_results: pendingResults.length,
      uncertain_appends: appendReceipts.filter((item) => item.phase === "uncertain").length,
      uncertain_actions: actionReceipts.filter((item) => item.phase === "unknown").length,
      transaction_store: transactionStore && typeof transactionStore.status === "function"
        ? transactionStore.status().lastWriteStatus || transactionStore.status().lastReadStatus || "enabled"
        : "disabled",
    };
  }

  function publicConfig() {
    return {
      enabled: Boolean(defaultBridgeUrl),
      bridgeUrl: defaultBridgeUrl,
      polishContextConsent,
    };
  }

  function stop() {
    stopped = true;
    clearReconnectTimer();
    clearConnectTimer();
    if (leaseTimer) clearTimeoutFn(leaseTimer);
    leaseTimer = null;
    if (socket && typeof socket.close === "function") socket.close(1000, "surface host stopped");
    socket = null;
    target = null;
    contextOwners = new Map();
    pendingCommands = [];
    pendingResults = [];
    if (logger && typeof logger.info === "function") logger.info("[voxspark] surface host stopped");
  }

  return { publish, publicConfig, status, stop };
}

module.exports = {
  CONTRACT,
  createVoxSparkSurfaceHostService,
  normalizeContext,
  normalizePolishContext,
  safeLoopbackBridgeUrl,
};
