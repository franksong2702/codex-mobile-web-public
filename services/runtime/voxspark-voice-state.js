"use strict";

const STATES = new Set(["recording", "transcribing", "polishing", "waitingComposer", "ready", "failed"]);
function string(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}
function integer(value, max) { return Number.isSafeInteger(value) && value >= 0 && value <= max; }

// Reconstruct an allowlisted metadata snapshot; never forward provider payloads.
function normalizeVoiceState(value) {
  if (!value || value.type !== "bridge.voice.state" || value.schema_version !== 1
    || !string(value.bridge_epoch, 64) || !integer(value.sequence, Number.MAX_SAFE_INTEGER) || value.sequence < 1
    || !integer(value.box_connections, 1024) || !Array.isArray(value.captures) || value.captures.length > 64) return null;
  let target = null;
  if (value.target != null) {
    const item = value.target;
    if (!string(item.session_id, 128) || !string(item.title, 80)
      || !integer(item.context_revision, Number.MAX_SAFE_INTEGER)
      || typeof item.composer?.focused !== "boolean" || typeof item.composer?.ready !== "boolean") return null;
    target = { session_id: item.session_id, title: item.title, context_revision: item.context_revision,
      composer: { focused: item.composer.focused, ready: item.composer.ready } };
  }
  const captures = [];
  const ids = new Set();
  for (const item of value.captures) {
    if (!item || !string(item.capture_id, 64) || !string(item.session_id, 128)
      || ids.has(item.capture_id) || !STATES.has(item.state) || !integer(item.duration_ms, 540000)
      || (item.session_title != null && !string(item.session_title, 80))
      || (item.error_code != null && !string(item.error_code, 64))) return null;
    let recovery;
    if (item.recovery != null) {
      const r = item.recovery;
      if (item.state !== "failed" || !integer(r.revision, Number.MAX_SAFE_INTEGER) || r.revision < 1
        || typeof r.retryable !== "boolean" || (r.expires_at !== null && !integer(r.expires_at, Number.MAX_SAFE_INTEGER))) return null;
      recovery = { revision: r.revision, retryable: r.retryable, expires_at: r.expires_at };
    }
    ids.add(item.capture_id);
    captures.push({ capture_id: item.capture_id, session_id: item.session_id, state: item.state,
      session_title: item.session_title || null,
      duration_ms: item.duration_ms, error_code: item.error_code || null, ...(recovery ? { recovery } : {}) });
  }
  return { schema_version: 1, bridge_epoch: value.bridge_epoch, sequence: value.sequence,
    box_connections: value.box_connections, target, captures };
}

module.exports = { normalizeVoiceState };
