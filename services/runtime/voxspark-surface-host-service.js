"use strict";

const crypto = require("node:crypto");

const CONTRACT = "voxspark.surface.v1alpha1";
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RECONNECT_MS = 1_500;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const MAX_PENDING_COMMANDS = 16;

function boundedText(value, maxLength) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function traceId(value) {
  const candidate = boundedText(value, 96);
  return /^[A-Za-z0-9._:-]+$/.test(candidate) ? candidate : "";
}

function commandTrace(message) {
  return {
    capture_id: traceId(message && message.capture_id),
    action_id: traceId(message && message.action_id),
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

function normalizeContext(value) {
  const input = value && typeof value === "object" ? value : {};
  const session = input.session && typeof input.session === "object" ? input.session : {};
  const composer = input.composer && typeof input.composer === "object" ? input.composer : {};
  const turn = input.turn && typeof input.turn === "object" ? input.turn : {};
  const sessionId = boundedText(session.id, 128);
  if (!sessionId) return null;
  return {
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
  };
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
  const serviceEpoch = traceId(options.serviceEpoch) || crypto.randomUUID();

  let bridgeUrl = "";
  let socket = null;
  let reconnectTimer = null;
  let connectTimer = null;
  let leaseTimer = null;
  let stopped = false;
  let contextRevision = 0;
  let commandSequence = 0;
  let target = null;
  let pendingCommands = [];

  function logCommand(event, details = {}) {
    if (!logger || typeof logger.info !== "function") return;
    logger.info(`[voxspark] surface command ${event}`, JSON.stringify(details));
  }

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
    const message = parseBridgeMessage(event);
    if (!message || message.contract !== CONTRACT) return;
    if (message.type === "bridge.ready") {
      sendTargetContext();
      return;
    }
    if (message.type !== "host.composer.replace" && message.type !== "host.action") return;
    if (!target || message.context_revision !== target.contextRevision || target.expiresAt <= now()) return;
    commandSequence += 1;
    pendingCommands.push({
      sequence: commandSequence,
      clientId: target.clientId,
      sessionId: target.context.session.id,
      surfaceRevision: target.surfaceRevision,
      deliveredAt: 0,
      expiresAt: now() + (leaseMs * 2),
      message: { ...message, context_revision: target.surfaceRevision },
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
    const context = normalizeContext(input.context);
    if (!clientId || !Number.isInteger(surfaceRevision) || surfaceRevision < 1 || !context) {
      return { ok: false, code: "invalid_context" };
    }
    const afterSequence = Number.isInteger(input.after_sequence) && input.after_sequence >= 0
      ? input.after_sequence
      : 0;
    const acknowledgementMatchesService = traceId(input.service_epoch) === serviceEpoch;
    const effectiveAfterSequence = acknowledgementMatchesService ? afterSequence : 0;
    const pendingBeforeExpiry = pendingCommands.length;
    pendingCommands = pendingCommands.filter((item) => item.expiresAt > now());
    if (pendingCommands.length !== pendingBeforeExpiry) {
      logCommand("discarded", {
        count: pendingBeforeExpiry - pendingCommands.length,
        reason: "command_expired",
      });
    }
    if (effectiveAfterSequence > 0) {
      const acknowledged = pendingCommands.filter((item) => (
        item.clientId === clientId && item.sequence <= effectiveAfterSequence
      ));
      if (acknowledged.length) {
        logCommand("acknowledged", {
          sequences: acknowledged.map((item) => item.sequence),
          capture_ids: acknowledged.map((item) => commandTrace(item.message).capture_id).filter(Boolean),
          action_ids: acknowledged.map((item) => commandTrace(item.message).action_id).filter(Boolean),
        });
      }
      pendingCommands = pendingCommands.filter((item) => (
        item.clientId !== clientId || item.sequence > effectiveAfterSequence
      ));
    }
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
    scheduleLease();
    if (changed) sendTargetContext();
    const deliverable = context.composer.focused
      ? pendingCommands.filter((item) => (
        item.clientId === clientId
        && item.sessionId === context.session.id
        && item.sequence > effectiveAfterSequence
      ))
      : [];
    for (const item of deliverable) item.deliveredAt = item.deliveredAt || now();
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
    };
  }

  function status() {
    return {
      configured: Boolean(bridgeUrl),
      connected: socketIsOpen(),
      target_active: Boolean(target && target.expiresAt > now() && target.context.composer.focused),
      context_revision: target ? target.contextRevision : 0,
      pending_commands: pendingCommands.length,
    };
  }

  function publicConfig() {
    return {
      enabled: Boolean(defaultBridgeUrl),
      bridgeUrl: defaultBridgeUrl,
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
    pendingCommands = [];
    if (logger && typeof logger.info === "function") logger.info("[voxspark] surface host stopped");
  }

  return { publish, publicConfig, status, stop };
}

module.exports = {
  CONTRACT,
  createVoxSparkSurfaceHostService,
  normalizeContext,
  safeLoopbackBridgeUrl,
};
