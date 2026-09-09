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
const POLISH_CONTEXT_CONSENT = "bounded-context-v1";
const POLISH_CONTEXT_BYTE_LIMIT = 12 * 1024;
const POLISH_COMPOSER_BYTE_LIMIT = 8 * 1024;
const CORRECTION_RULE_LIMIT = 32;
const CORRECTION_OCCURRENCES_REQUIRED = 2;
const COMMAND_ACKNOWLEDGEMENT_LIMIT = 64;
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

function visibleItemRole(item) {
  if (item && item.type === "userMessage") return "user";
  if (item && (item.type === "agentMessage" || item.type === "plan")) return "assistant";
  return "";
}

function utf8Bytes(value) {
  return new TextEncoder().encode(String(value || "")).length;
}

function truncateUtf8(value, limit) {
  let result = "";
  let bytes = 0;
  for (const character of String(value || "")) {
    const nextBytes = utf8Bytes(character);
    if (bytes + nextBytes > limit) break;
    result += character;
    bytes += nextBytes;
  }
  return result;
}

function referenceConversation(thread, composerDraft) {
  const visible = [];
  for (const turn of Array.isArray(thread && thread.turns) ? thread.turns : []) {
    for (const item of Array.isArray(turn && turn.items) ? turn.items : []) {
      const role = visibleItemRole(item);
      const value = visibleItemText(item);
      if (role && value) visible.push({ role, text: value });
    }
  }
  let budget = Math.max(0, POLISH_CONTEXT_BYTE_LIMIT - utf8Bytes(composerDraft));
  const selected = [];
  for (const item of visible.slice(-CONTEXT_MESSAGE_LIMIT).reverse()) {
    if (!budget) break;
    const value = truncateUtf8(item.text, budget).trim();
    if (!value) break;
    selected.unshift({ role: item.role, text: value });
    budget -= utf8Bytes(value);
  }
  return selected;
}

function inferSessionProfile(thread, title, workspace) {
  const value = `${title || ""} ${workspace || ""} ${thread && thread.cwd || ""}`.toLocaleLowerCase("en-US");
  if (/(日记|日志|日誌|journal|diary|daybook)/u.test(value)) return "journal";
  if (/(产品|產品|需求|设计|設計|product|design|ux|prototype)/u.test(value)) return "product-discussion";
  if (/(codex|代码|代碼|coding|developer|github|git|api|esp32|firmware|dsh)/u.test(value)) return "coding-agent";
  return "general";
}

function correctionSpan(before, after) {
  const left = Array.from(before);
  const right = Array.from(after);
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix
    && left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix += 1;
  const sharedSuffixStart = left.length - suffix;
  let sharedTokenLength = 0;
  while (sharedSuffixStart + sharedTokenLength < left.length
    && /^[A-Za-z0-9_.+/-]$/.test(left[sharedSuffixStart + sharedTokenLength])) sharedTokenLength += 1;
  suffix -= sharedTokenLength;
  return {
    heard: left.slice(prefix, left.length - suffix).join("").trim(),
    write: right.slice(prefix, right.length - suffix).join("").trim(),
  };
}

function correctionCandidate(before, after) {
  if (!before || !after || before === after) return null;
  const span = correctionSpan(before, after);
  const clean = (value) => value.replace(/^[\s.,!?;:"'“”‘’()[\]{}]+|[\s.,!?;:"'“”‘’()[\]{}]+$/gu, "").trim();
  const heard = clean(span.heard);
  const write = clean(span.write);
  const heardLength = Array.from(heard).length;
  const writeLength = Array.from(write).length;
  const valid = (value) => Array.from(value).length >= 2 && Array.from(value).length <= 40
    && /[\p{Letter}\p{Number}]/u.test(value) && value.split(/\s+/u).length <= 3;
  const ratio = Math.max(heardLength, writeLength) / Math.max(1, Math.min(heardLength, writeLength));
  if (!valid(heard) || !valid(write) || ratio > 3 || heardLength + writeLength > 70
    || heard.toLocaleLowerCase("en-US") === write.toLocaleLowerCase("en-US")) return null;
  return { heard, write };
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

function contextTermsWithCorrections(sources, rules) {
  const terms = extractContextTerms(sources);
  for (const rule of [...rules].reverse()) {
    const value = normalizeContextTerm(rule && rule.write);
    if (!value) continue;
    const key = value.toLocaleLowerCase("en-US");
    const existing = terms.find((term) => term.text.toLocaleLowerCase("en-US") === key);
    if (existing) {
      existing.boost = 6;
      existing.source = "composer";
      continue;
    }
    terms.unshift({ text: value, boost: 6, source: "composer" });
  }
  return terms.slice(0, CONTEXT_TERM_LIMIT);
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

// Presentation consumes Bridge metadata only; it never advances a provider stage.
function voiceStatusView(voice, sessionId, connected = true) {
  const reasons = {
    bridge_disconnected: "语音服务重连中", state_unavailable: "等待语音状态",
    no_active_composer: "请选中要接收语音的 Session", target_syncing: "正在同步语音目标",
    composer_unavailable: "当前输入框暂不可接收语音", box_disconnected: "BOX 未连接", ready: "BOX 已就绪",
  };
  const snapshot = connected && voice && voice.snapshot;
  const reason = connected ? (voice && voice.reason || "state_unavailable") : "bridge_disconnected";
  const target = snapshot && snapshot.target;
  const captures = snapshot && Array.isArray(snapshot.captures) ? snapshot.captures.slice(0, 64) : [];
  const own = captures.filter(item => item && item.session_id === sessionId);
  const active = item => item && ["recording", "transcribing", "polishing", "waitingComposer"].includes(item.state);
  // The physical BOX recording remains visible from every Session. Its owner is
  // captured at start and must not be inferred from the current browser target.
  const ownCapture = own.find(active) || own.find(item => item.state !== "ready") || own[0];
  const capture = captures.find(item => item && item.state === "recording")
    || own.find(active) || captures.find(active) || ownCapture;
  const targetId = capture ? capture.session_id : target && target.session_id;
  const targetTitle = text(capture && capture.session_title
    || (target && target.session_id === targetId ? target.title : "")).slice(0, 80);
  const labels = { recording: "BOX 录音中", transcribing: "识别中", polishing: "整理中",
    waitingComposer: "等待写入输入框", ready: "已写入输入框", failed: "识别失败，请在 BOX 重试或丢弃" };
  const stage = capture && labels[capture.state] ? capture.state : "";
  const milliseconds = capture && Number.isSafeInteger(capture.duration_ms)
    ? Math.min(540000, Math.max(0, capture.duration_ms)) : 0;
  const seconds = Math.floor(milliseconds / 1000);
  const details = [];
  if (ownCapture && ownCapture !== capture && labels[ownCapture.state]) {
    details.push(`当前 Session：${labels[ownCapture.state]}`);
  }
  if (stage && reason !== "ready") details.push(reasons[reason] || reasons.state_unavailable);
  return {
    reason,
    target: targetTitle ? `语音发送到：${targetTitle}` : capture
      ? `语音发送到：${targetId === sessionId ? "当前 Session" : "另一个 Session"}` : "语音输入",
    status: stage ? labels[stage] : reasons[reason] || reasons.state_unavailable,
    detail: details.join(" · "),
    stage,
    duration: stage && milliseconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "",
    elsewhere: Boolean(targetId && targetId !== sessionId),
  };
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
  const insertComposerText = deps.insertComposerText || (() => null);
  const sendMessage = deps.sendMessage || (async () => false);
  const sendDraft = deps.sendDraft || null;
  const interruptActiveTurn = deps.interruptActiveTurn || (async () => false);
  const scheduleCurrentDraftSave = deps.scheduleCurrentDraftSave || (() => {});
  const threadTitle = deps.threadTitle || ((thread) => text(thread && (thread.name || thread.title)) || "Current Session");
  const threadWorkspace = deps.threadWorkspace || ((thread) => text(thread && thread.workspace));
  const approvalPending = deps.approvalPending || (() => false);
  const report = deps.report || (() => {});
  const relay = deps.relay || null;
  const captureRequest = typeof deps.captureRequest === "function" ? deps.captureRequest : null;
  const queueRequest = typeof deps.queueRequest === "function" ? deps.queueRequest : null;
  const setIntervalFn = deps.setInterval || window.setInterval;
  const clearIntervalFn = deps.clearInterval || window.clearInterval;
  const setTimeoutFn = deps.setTimeout || window.setTimeout;
  const clearTimeoutFn = deps.clearTimeout || window.clearTimeout;
  const now = deps.now || Date.now;
  let polishContextConsent = deps.polishContextConsent === POLISH_CONTEXT_CONSENT
    ? POLISH_CONTEXT_CONSENT
    : "";

  let bridgeUrl = "";
  let clientId = text(deps.clientId);
  let relayConnected = false;
  let voice = null;
  let voiceReceivedAt = 0;
  let recoveryLastSnapshot = null;
  let captureOperation = null;
  let captureNotice = null;
  let captureRequestSequence = 0;
  const captureRows = new Map();
  const captureRequestIds = new Map();
  let relayInFlight = false;
  let activeRelay = null;
  let relaySequence = 0;
  let lastRelayTarget = "";
  let relayAgain = false;
  let relayServiceEpoch = "";
  const pendingCommandAcknowledgements = new Set();
  const inFlightCommandSequences = new Set();
  let pendingCommandResults = [];
  let contextRevision = 0;
  let contextFingerprint = "";
  let currentContext = null;
  let armedSessionId = "";
  let armedAt = 0;
  let sessionSwitchIntentAt = Number.NEGATIVE_INFINITY;
  let ignoredSessionId = "";
  let activeDraft = null;
  const retainedDrafts = new Map();
  let lastReleasedDraftRevision = 0;
  const releasedDraftRevisions = new Map();
  let queuedDrafts = [];
  let queueFlushing = false;
  let queueOperation = null;
  let queueRevision = 0;
  let queueReceivedAt = Number.NEGATIVE_INFINITY;
  let queueNotice = "";
  const queueRows = new Map();
  let queueTurnGate = "ready";
  let pollTimer = null;
  let stopped = true;
  const correctionObservations = new Map();
  const acceptedCorrections = new Map();
  let pendingCorrectionSuggestion = null;

  function renderVoiceStatus() {
    renderCaptureRecovery();
    const element = $("voxsparkVoiceStatus");
    if (!element) return;
    element.hidden = stopped || !bridgeUrl;
    if (element.hidden) return;
    const fresh = relayConnected && now() - voiceReceivedAt < 3000;
    const view = voiceStatusView(voice, currentComposerThreadId(), fresh);
    const values = { voxsparkVoiceTarget: view.target,
      voxsparkVoiceStage: [view.status, view.detail].filter(Boolean).join(" · "),
      voxsparkVoiceDuration: view.duration };
    for (const [id, value] of Object.entries(values)) {
      const node = $(id);
      if (node && node.textContent !== value) node.textContent = value;
    }
    element.dataset.state = view.stage || view.reason;
    element.dataset.elsewhere = String(view.elsewhere);
  }

  function recoveryAvailable() {
    return !stopped && relayConnected && now() - voiceReceivedAt < 3000 && surfaceCanArm()
      && currentContext?.sessionId === currentComposerThreadId()
      && voice?.snapshot?.target?.session_id === currentComposerThreadId()
      && !["bridge_disconnected", "target_syncing", "state_unavailable", "no_active_composer"].includes(voice?.reason);
  }

  function renderCaptureRecovery() {
    const panel = $("voxsparkRecovery");
    const list = $("voxsparkRecoveryItems");
    if (!panel || !list || !document.createElement) return;
    const sessionId = currentComposerThreadId();
    const items = (voice?.snapshot?.captures || recoveryLastSnapshot?.captures || []).filter(item => item.state === "failed" && item.session_id === sessionId);
    const notice = captureNotice?.sessionId === sessionId ? captureNotice.text : "";
    panel.hidden = stopped || !bridgeUrl || (!items.length && !notice);
    $("voxsparkRecoveryNotice").textContent = notice || "录音仅在 Bridge 内存中暂存，首次失败后最多保留 15 分钟；重启后无法恢复。";
    const ids = new Set(items.map(item => item.capture_id));
    for (const [id, row] of captureRows) if (!ids.has(id)) { row.element.remove(); captureRows.delete(id); }
    for (const item of items) {
      let row = captureRows.get(item.capture_id);
      if (!row) {
        const element = document.createElement("li"); element.className = "voxspark-recovery-item";
        const label = document.createElement("span");
        const actions = document.createElement("div"); actions.className = "voxspark-queue-actions";
        const buttons = {};
        for (const [operation, title] of Object.entries({ retry: "重试识别", discard: "丢弃录音" })) {
          const button = document.createElement("button"); button.type = "button"; button.textContent = title;
          button.dataset.captureAction = operation; button.dataset.captureId = item.capture_id;
          button.addEventListener("click", () => manageCapture(operation, item.capture_id));
          actions.appendChild(button); buttons[operation] = button;
        }
        element.appendChild(label); element.appendChild(actions); list.appendChild(element);
        row = { element, label, buttons }; captureRows.set(item.capture_id, row);
      }
      const recovery = item.recovery;
      const remaining = recovery?.retryable ? Math.max(0, (recovery.expires_at || 0) - now()) : 0;
      const duration = Math.ceil(item.duration_ms / 1000);
      row.label.textContent = `${duration} 秒录音 · ` + (!recovery ? "当前 Bridge 不支持网页恢复"
        : remaining > 0 ? `识别失败，可重试（剩余 ${Math.ceil(remaining / 60000)} 分钟）`
        : "录音已无法恢复，请丢弃后重新录音");
      for (const [operation, button] of Object.entries(row.buttons)) {
        button.disabled = !captureRequest || !recoveryAvailable() || !recovery || Boolean(captureOperation)
          || (operation === "retry" && remaining <= 0);
      }
    }
    if (items.length && !recoveryAvailable()) $("voxsparkRecoveryNotice").textContent = "恢复连接并选中当前 Session 的输入框后可操作。";
  }

  async function manageCapture(operation, captureId) {
    if (!captureRequest || captureOperation || !recoveryAvailable() || !["retry", "discard"].includes(operation)) return false;
    const snapshot = voice.snapshot;
    const sessionId = currentComposerThreadId();
    const capture = snapshot.captures.find(item => item.capture_id === captureId && item.session_id === sessionId && item.state === "failed");
    if (!capture?.recovery || (operation === "retry" && (!capture.recovery.retryable || capture.recovery.expires_at <= now()))) return false;
    const key = [snapshot.bridge_epoch, captureId, capture.recovery.revision, operation].join(":");
    if (!captureRequestIds.has(key)) {
      captureRequestIds.set(key, `cr:${clientId.slice(0, 70)}:${++captureRequestSequence}:${now()}`);
      while (captureRequestIds.size > 64) captureRequestIds.delete(captureRequestIds.keys().next().value);
    }
    const request = { sessionId, epoch: relayServiceEpoch };
    captureOperation = request; captureNotice = null; renderCaptureRecovery();
    try {
      const result = await captureRequest(operation, { client_id: clientId, service_epoch: relayServiceEpoch,
        request_id: captureRequestIds.get(key), bridge_epoch: snapshot.bridge_epoch, session_id: sessionId,
        capture_id: captureId, recovery_revision: capture.recovery.revision });
      if (stopped || currentComposerThreadId() !== sessionId || relayServiceEpoch !== request.epoch) return false;
      if (result?.ok === false && result.code !== "capture_outcome_unknown" && result.code !== "capture_action_pending") captureRequestIds.delete(key);
      captureNotice = { sessionId, text: result?.ok ? operation === "retry"
        ? "已开始重试，识别完成后写入此 Session 的草稿。" : "已丢弃录音。"
        : result?.code === "recovery_expired" ? "录音已过期，请丢弃后重新录音。"
        : "操作未确认，请查看更新后的录音状态；再次点击会核对同一请求。" };
      return result?.ok === true;
    } catch (_) {
      if (!stopped && currentComposerThreadId() === sessionId && relayServiceEpoch === request.epoch)
        captureNotice = { sessionId, text: "操作未确认，请查看更新后的录音状态；再次点击会核对同一请求。" };
      return false;
    } finally {
      if (captureOperation === request) { captureOperation = null; renderCaptureRecovery(); syncContext({ force: true }); }
    }
  }

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

  function normalizeQueueSnapshot(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 8).map((item) => ({
      queueId: traceId(item && item.queue_id),
      actionId: traceId(item && item.action_id),
      sessionId: text(item && item.session_id).slice(0, 128),
      draftRevision: Number.isInteger(item && item.draft_revision) ? item.draft_revision : 0,
      status: ["queued", "leased", "submitted", "processing", "failed", "unknown"].includes(item && item.status)
        ? item.status
        : "",
      text: text(item && item.text),
      errorCode: traceId(item && item.error_code),
      createdAt: Number(item && item.created_at) || 0,
    })).filter((item) => item.queueId && item.actionId && item.sessionId && item.draftRevision > 0 && item.status);
  }

  function rememberQueueSnapshot(value) {
    if (!Array.isArray(value)) return;
    const wasEmpty = !queuedDrafts.length;
    queuedDrafts = normalizeQueueSnapshot(value);
    if (wasEmpty && queuedDrafts.length && $("voxsparkQueue")) $("voxsparkQueue").open = true;
    if (!queuedDrafts.length) queueNotice = "";
    queueReceivedAt = now();
    renderQueue();
  }

  function mergeQueueEntry(value) {
    if (!value || !currentContext || value.session_id !== currentContext.sessionId) return;
    if (!queuedDrafts.length && $("voxsparkQueue")) $("voxsparkQueue").open = true;
    queuedDrafts = [...normalizeQueueSnapshot([value]), ...queuedDrafts.filter((item) => item.queueId !== value.queue_id)];
    renderQueue();
  }

  function renderQueue() {
    const panel = $("voxsparkQueue");
    const list = $("voxsparkQueueItems");
    if (!panel || !list || !document.createElement) return;
    const items = queuedDrafts.filter((item) => item.sessionId === currentComposerThreadId());
    panel.hidden = stopped || !bridgeUrl || (!items.length && !queueNotice);
    $("voxsparkQueueSummary").textContent = `语音队列（${items.length}）`;
    const available = now() - queueReceivedAt < 3000;
    $("voxsparkQueueNotice").textContent = !available && items.length
      ? "暂时无法连接队列，恢复连接后可操作。" : queueNotice || "仅当前 Session；空闲且输入框为空时依次提交。已提交不代表回复完成。";
    const ids = new Set(items.map((item) => item.queueId));
    for (const [id, row] of queueRows) if (!ids.has(id)) {
      row.element.remove(); queueRows.delete(id);
    }
    const labels = { queued: "等待提交", leased: "正在提交", submitted: "已提交", processing: "已提交 · Session 运行中",
      failed: "提交失败", unknown: "提交结果未知" };
    for (const item of items.sort((a, b) => a.createdAt - b.createdAt)) {
      let row = queueRows.get(item.queueId);
      if (!row) {
        const element = document.createElement("li"); element.className = "voxspark-queue-item";
        const title = document.createElement("span");
        const actions = document.createElement("div"); actions.className = "voxspark-queue-actions";
        const preview = document.createElement("p"); preview.className = "voxspark-queue-preview";
        const buttons = {};
        for (const [operation, label] of Object.entries({ steer: "转为引导", cancel: "取消排队", retry: "重试提交", reconcile: "核对提交结果" })) {
          const button = document.createElement("button"); button.type = "button"; button.textContent = label;
          button.dataset.queueAction = operation; button.dataset.queueId = item.queueId;
          button.addEventListener("click", () => manageQueue(operation, item.queueId));
          actions.appendChild(button); buttons[operation] = button;
        }
        element.appendChild(title); element.appendChild(preview); element.appendChild(actions); list.appendChild(element);
        row = { element, title, preview, buttons }; queueRows.set(item.queueId, row);
      }
      const time = item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
      row.title.textContent = [time, labels[item.status]].filter(Boolean).join(" · ");
      row.element.dataset.state = item.status;
      const allowed = { steer: item.status === "queued",
        cancel: ["queued", "failed"].includes(item.status), retry: item.status === "failed",
        reconcile: ["failed", "unknown"].includes(item.status) };
      for (const [operation, button] of Object.entries(row.buttons)) {
        button.hidden = !allowed[operation]; button.disabled = !available || Boolean(queueOperation) || queueFlushing
          || (operation === "steer" && (!text(composerTargetActiveTurnId()) || currentContext?.approvalPending));
      }
      row.preview.textContent = item.text;
      row.preview.hidden = !row.preview.textContent;
    }
  }

  async function manageQueue(operation, queueId) {
    if (stopped || queueOperation || queueFlushing || !queueRequest || !currentContext || now() - queueReceivedAt >= 3000) return false;
    const activeTurnId = text(composerTargetActiveTurnId());
    if (operation === "steer" && (!activeTurnId || currentContext.approvalPending
      || !queuedDrafts.some(item => item.queueId === queueId && item.status === "queued"))) return false;
    const request = { sessionId: currentContext.sessionId, revision: ++queueRevision,
      activeTurnId, thread: { ...(composerTargetThread() || {}) }, serviceEpoch: relayServiceEpoch };
    queueOperation = request; queueNotice = ""; renderQueue();
    try {
      if (operation === "steer") return await steerQueuedDraft(request, queueId);
      const result = await queueRequest(operation, { client_id: clientId, service_epoch: relayServiceEpoch,
        session_id: request.sessionId, queue_id: queueId });
      if (stopped || queueOperation !== request || currentComposerThreadId() !== request.sessionId) return false;
      if (!result || !result.ok) throw Error("queue_management_failed");
      mergeQueueEntry(result.queue);
      if (operation === "reconcile" || operation === "retry") {
        queueNotice = result.queue?.status === "unknown" ? "仍无法确认提交结果；请查看本 Session 的消息，系统不会自动重发。"
          : result.queue?.status === "submitted" ? "已核实提交成功，可在本 Session 查看回复。" : "已重新排队。";
      }
      return true;
    } catch (_) {
      if (!stopped && queueOperation === request && currentComposerThreadId() === request.sessionId) {
        queueNotice = "操作未确认，请按队列当前状态处理。";
      }
      return false;
    } finally {
      if (queueOperation === request) { queueRevision += 1; queueOperation = null; renderQueue(); syncContext(); }
    }
  }

  async function steerQueuedDraft(request, queueId) {
    const payload = { client_id: clientId, service_epoch: request.serviceEpoch,
      session_id: request.sessionId, queue_id: queueId };
    const claimed = await queueRequest("claim", { ...payload, mode: "steer" });
    if (!claimed?.ok || !text(claimed.text) || !traceId(claimed.lease_token)) throw Error("queue_claim_failed");
    mergeQueueEntry(claimed.queue);
    let outcome = "succeeded";
    let sendStarted = false;
    try {
      if (stopped || queueOperation !== request || currentComposerThreadId() !== request.sessionId
        || text(composerTargetActiveTurnId()) !== request.activeTurnId || currentContext?.approvalPending) {
        throw Error("queue_target_changed");
      }
      sendStarted = true;
      await sendDraft({ threadId: request.sessionId, thread: request.thread,
        activeTurnId: request.activeTurnId, text: claimed.text, mode: "steer", strictSteer: true,
        preserveComposerDraft: true, clientSubmissionId: traceId(claimed.client_submission_id) });
    } catch (error) {
      outcome = error?.code === "voxspark_submission_outcome_unknown"
        || (sendStarted && !Number(error?.status || error?.statusCode)) ? "unknown" : "failed";
    }
    // Complete the original lease even when navigation occurred while awaiting Codex.
    const completed = await queueRequest("complete", { ...payload, lease_token: claimed.lease_token,
      outcome, error_code: outcome === "unknown" ? "action_outcome_unknown" : outcome === "failed" ? "queue_steer_failed" : "" });
    if (!stopped && queueOperation === request && currentComposerThreadId() === request.sessionId) {
      mergeQueueEntry(completed?.queue);
      if (!completed?.ok || outcome === "unknown") {
        queueNotice = "引导结果尚未确认，系统不会自动重发；请核对提交结果。";
      } else if (outcome === "succeeded") {
        queueTurnGate = "awaiting_idle";
        queueNotice = "已转为引导，发送给当前正在执行的任务。";
      } else {
        queueNotice = "引导未成功，消息已保留；可重试排队后再转为引导。";
      }
    }
    return outcome === "succeeded" && Boolean(completed?.ok);
  }

  function resetQueueView() {
    queueRevision += 1; queueOperation = null; queuedDrafts = [];
    queueReceivedAt = Number.NEGATIVE_INFINITY; queueNotice = "";
    const panel = $("voxsparkQueue"); if (panel) panel.open = false;
    renderQueue();
  }

  function contextComposerDraft() {
    const current = text(composerText());
    if (activeDraft && current === activeDraft.text) return activeDraft.baseComposerText;
    return current;
  }

  function correctionRules() {
    return [...acceptedCorrections.values()].slice(-CORRECTION_RULE_LIMIT)
      .map((rule) => ({ heard: rule.heard, write: rule.write }));
  }

  function polishContext(thread, composerDraft, title, workspace) {
    if (polishContextConsent !== POLISH_CONTEXT_CONSENT) return null;
    const boundedDraft = truncateUtf8(text(composerDraft), POLISH_COMPOSER_BYTE_LIMIT);
    return {
      consent: POLISH_CONTEXT_CONSENT,
      reference_conversation: referenceConversation(thread, boundedDraft),
      composer_draft: boundedDraft,
      correction_rules: correctionRules(),
      session_profile: inferSessionProfile(thread, title, workspace),
      language_policy: "zh-CN-mixed",
    };
  }

  function retainCurrentDraftEdits() {
    if (!activeDraft || activeDraft.sessionId !== text(currentComposerThreadId())) return;
    activeDraft.text = text(composerText());
  }

  function acknowledgeCommand(sequence) {
    if (!Number.isInteger(sequence) || sequence <= 0) return;
    pendingCommandAcknowledgements.add(sequence);
    while (pendingCommandAcknowledgements.size > COMMAND_ACKNOWLEDGEMENT_LIMIT) {
      pendingCommandAcknowledgements.delete(pendingCommandAcknowledgements.values().next().value);
    }
  }

  function matchingDraft(message) {
    const captureId = traceId(message && message.capture_id);
    const revision = Number.isInteger(message && message.draft_revision) ? message.draft_revision : 0;
    const candidates = [activeDraft, ...retainedDrafts.values()].filter(Boolean);
    return candidates.find((draft) => (
      draft.draftRevision === revision
      && (!captureId || draft.captureId === captureId)
    )) || null;
  }

  function releaseDraft(draft) {
    if (!draft) return;
    if (activeDraft && activeDraft.sessionId === draft.sessionId &&
      activeDraft.draftRevision === draft.draftRevision) {
      activeDraft = null;
    }
    const retained = retainedDrafts.get(draft.sessionId);
    if (retained && retained.draftRevision === draft.draftRevision) {
      retainedDrafts.delete(draft.sessionId);
    }
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
    const title = threadTitle(thread);
    const workspace = threadWorkspace(thread);
    const composerDraft = contextComposerDraft();
    return {
      sessionId,
      title,
      workspace,
      focused,
      activeTurnId,
      turnState: activeTurnId ? "running" : "idle",
      approvalPending: Boolean(approvalPending(sessionId, activeTurnId)),
      contextTerms: contextTermsWithCorrections(
        contextSources(thread, composerDraft),
        correctionRules()
      ),
      polishContext: polishContext(thread, composerDraft, title, workspace),
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
    if (isSessionNavigationTarget(event && event.target)) {
      retainCurrentDraftEdits();
      sessionSwitchIntentAt = now();
    }
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
      polishContext: snapshot.polishContext,
      armedAt: snapshot.armedAt,
    });
  }

  function publicContext() {
    const context = {
      session: {
        id: currentContext.sessionId,
        title: currentContext.title,
        workspace: currentContext.workspace,
      },
      composer: {
        focused: currentContext.focused,
        ownership: activeDraft ? "voxspark" : "none",
        draft_revision: activeDraft ? activeDraft.draftRevision : 0,
        released_draft_revision: releasedDraftRevisions.get(currentContext.sessionId) || 0,
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
    if (currentContext.polishContext) context.polish_context = currentContext.polishContext;
    return context;
  }

  async function relayContext(options = {}) {
    if (stopped || !relay || !bridgeUrl || !currentContext) return false;
    if (activeRelay) {
      if (!options.supersede) { relayAgain = true; return false; }
      // A response for the previous target cannot gate publication of the new target.
      // Server-side surface revisions fence a POST that already left the browser.
      diagnostic("context_relay_superseded", { syncId: activeRelay.syncId,
        requestStartedAt: activeRelay.startedAt, clientAt: now(),
        relayMs: Math.max(0, now() - activeRelay.startedAt) });
      activeRelay.controller.abort();
    }
    const AbortControllerCtor = deps.AbortController || window.AbortController || globalThis.AbortController;
    const targetKey = JSON.stringify([currentContext.sessionId, currentContext.title]);
    const request = {
      controller: new AbortControllerCtor(),
      sessionId: currentContext.sessionId,
      title: currentContext.title,
      revision: currentContext.revision,
      queueRevision,
      syncId: `${traceId(clientId).slice(0, 64)}.${++relaySequence}`,
      startedAt: now(),
      acknowledgedSequences: [...pendingCommandAcknowledgements],
      observe: targetKey !== lastRelayTarget,
    };
    lastRelayTarget = targetKey;
    activeRelay = request;
    relayInFlight = true;
    relayAgain = false;
    if (request.observe) diagnostic("context_relay_started", {
      syncId: request.syncId, surfaceRevision: request.revision, clientAt: request.startedAt,
    });
    try {
      const result = await relay({
        sync_id: request.syncId,
        bridge_url: bridgeUrl,
        client_id: clientId,
        surface_revision: currentContext.revision,
        service_epoch: relayServiceEpoch,
        after_sequence: 0,
        acknowledged_sequences: request.acknowledgedSequences,
        command_results: pendingCommandResults.map((item) => Object.assign({}, item)),
        context: publicContext(),
      }, { signal: request.controller.signal });
      if (activeRelay !== request || stopped) return false;
      request.responseReceived = true;
      const responseAt = now();
      const relayDetail = { syncId: request.syncId, requestStartedAt: request.startedAt,
        clientAt: responseAt, relayMs: Math.max(0, responseAt - request.startedAt),
        surfaceRevision: request.revision };
      if (request.observe || relayDetail.relayMs >= 1000 ||
          (result && Array.isArray(result.commands) && result.commands.length) ||
          request.acknowledgedSequences.length) diagnostic("context_relay_completed", {
        ...relayDetail,
        acknowledgedCount: request.acknowledgedSequences.length,
        bridgeContextRevision: result && result.context_revision,
      });
      relayConnected = Boolean(result && result.connected);
      voice = result && result.voice || null;
      if (voice?.snapshot) {
        if (recoveryLastSnapshot && recoveryLastSnapshot.bridge_epoch !== voice.snapshot.bridge_epoch
          && recoveryLastSnapshot.captures.some(item => item.state === "failed" && item.session_id === currentComposerThreadId())) {
          captureNotice = { sessionId: currentComposerThreadId(), text: "Bridge 已重启，之前失败的录音已无法恢复，请重新录音。" };
        }
        recoveryLastSnapshot = voice.snapshot;
      }
      voiceReceivedAt = now();
      renderVoiceStatus();
      if (!queueOperation && request.queueRevision === queueRevision) rememberQueueSnapshot(result && result.queue);
      const nextServiceEpoch = traceId(result && result.service_epoch);
      if (nextServiceEpoch && nextServiceEpoch !== relayServiceEpoch) {
        const serviceRestarted = Boolean(relayServiceEpoch);
        relayServiceEpoch = nextServiceEpoch;
        pendingCommandAcknowledgements.clear();
        inFlightCommandSequences.clear();
        pendingCommandResults = [];
        if (serviceRestarted) diagnostic("surface_host_service_restarted");
      }
      const acceptedResultIds = new Set(Array.isArray(result && result.accepted_result_ids)
        ? result.accepted_result_ids.map(traceId).filter(Boolean)
        : []);
      if (acceptedResultIds.size) {
        pendingCommandResults = pendingCommandResults.filter((item) => !acceptedResultIds.has(item.action_id));
      }
      const acceptedCommandSequences = new Set(Array.isArray(result && result.accepted_command_sequences)
        ? result.accepted_command_sequences.filter((value) => Number.isInteger(value) && value > 0)
        : []);
      for (const sequence of acceptedCommandSequences) pendingCommandAcknowledgements.delete(sequence);
      const commands = Array.isArray(result && result.commands) ? result.commands : [];
      for (const command of commands) {
        if (!Number.isInteger(command.sequence) || command.sequence <= 0 ||
          pendingCommandAcknowledgements.has(command.sequence)) continue;
        if (command.message && command.message.type === "host.action" && traceId(command.message.action_id)) {
          if (inFlightCommandSequences.has(command.sequence)) break;
          inFlightCommandSequences.add(command.sequence);
          void handleMessage(command.message, { sequence: command.sequence }).then((outcome) => {
            if (outcome !== COMMAND_RETRY) acknowledgeCommand(command.sequence);
          }).finally(() => {
            inFlightCommandSequences.delete(command.sequence);
            relayAgain = true;
            if (!relayInFlight) {
              relayAgain = false;
              void relayContext();
            }
          });
          break;
        }
        diagnostic("command_received", { ...relayDetail, clientAt: now(),
          ...traceDetails(command.message, command.sequence) });
        const outcome = await handleMessage(command.message, { sequence: command.sequence,
          syncId: request.syncId });
        if (outcome === COMMAND_RETRY) break;
        acknowledgeCommand(command.sequence);
        if (activeRelay !== request || stopped) break;
      }
      if (queuedDrafts.length) Promise.resolve().then(() => flushQueuedDrafts());
      return Boolean(result && result.ok);
    } catch (error) {
      if (activeRelay !== request || stopped) return false;
      relayConnected = false;
      voice = null;
      renderVoiceStatus();
      diagnostic("bridge_relay_error", {
        syncId: request.syncId, requestStartedAt: request.startedAt,
        surfaceRevision: request.revision, clientAt: now(),
        relayMs: Math.max(0, now() - request.startedAt),
        errorKind: request.responseReceived ? "processing_failed" :
          String(error && error.message || "").startsWith("Request timed out:")
          ? "timeout" : request.controller.signal.aborted ? "cancelled" : "request_failed",
        acknowledgedCount: request.acknowledgedSequences.length,
      });
      return false;
    } finally {
      // Superseded responses must not clear or reschedule their successor.
      if (activeRelay === request) {
        activeRelay = null;
        relayInFlight = false;
        if (relayAgain && !stopped) {
          relayAgain = false;
          Promise.resolve().then(() => relayContext());
        }
      }
    }
  }

  function syncContext(options = {}) {
    const snapshot = snapshotContext();
    renderVoiceStatus();
    renderQueue();
    if (!snapshot) return false;
    const fingerprint = contextShape(snapshot);
    const changed = fingerprint !== contextFingerprint;
    if (changed) {
      const previousSessionId = currentContext && currentContext.sessionId;
      contextRevision += 1;
      contextFingerprint = fingerprint;
      currentContext = Object.assign({}, snapshot, { revision: contextRevision });
      if (previousSessionId && previousSessionId !== snapshot.sessionId) {
        resetQueueView();
        if (activeDraft) retainedDrafts.set(previousSessionId, activeDraft);
        activeDraft = retainedDrafts.get(snapshot.sessionId) || null;
        retainedDrafts.delete(snapshot.sessionId);
        if (activeDraft) activeDraft.contextRevision = contextRevision;
        queueTurnGate = "ready";
        diagnostic("session_changed_drafts_preserved");
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
    const supersede = Boolean(activeRelay && (
      activeRelay.sessionId !== currentContext.sessionId || activeRelay.title !== currentContext.title
    ));
    if (relayInFlight && !supersede) relayAgain = true;
    relayContext({ supersede }).catch(() => {});
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

  function replaceComposer(message, metadata = {}) {
    const detail = { ...traceDetails(message, metadata.sequence),
      syncId: traceId(metadata.syncId), clientAt: now() };
    if (!revisionsMatch(message, false) || !currentContext.focused) {
      diagnostic("replace_rejected_stale_context", { ...detail,
        reason: !revisionsMatch(message, false) ? "context_mismatch" : "not_focused" });
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
    const previousDraft = activeDraft;
    activeDraft = {
      sessionId: currentContext.sessionId,
      thread: composerTargetThread() || {},
      activeTurnId: currentContext.activeTurnId,
      contextRevision: currentContext.revision,
      draftRevision: message.draft_revision,
      captureId: traceId(message.capture_id),
      baseComposerText,
      voiceText: draftText,
      text: composerDraft,
      receivedAt: now(),
    };
    const inserted = insertComposerText(draftText);
    if (!inserted) {
      activeDraft = previousDraft;
      diagnostic("replace_insert_failed", { ...detail, clientAt: now() });
      return COMMAND_RETRY;
    }
    activeDraft.text = inserted.text;
    activeDraft.voiceInsertedAtEnd = inserted.atEnd;
    scheduleCurrentDraftSave();
    return COMMAND_ACCEPTED;
  }

  function clearComposerIfOwned(draft) {
    if (!currentContext || currentContext.sessionId !== draft.sessionId) return;
    if (text(composerText()) === draft.text) {
      setComposerText("");
      scheduleCurrentDraftSave();
    }
  }

  function handleComposerSubmission(submission = {}) {
    const submittedSessionId = text(submission.threadId);
    const draft = activeDraft && activeDraft.sessionId === submittedSessionId
      ? activeDraft
      : retainedDrafts.get(submittedSessionId);
    if (!draft || !submittedSessionId) return false;
    observeCorrection(draft, text(submission.text));
    const releasedDraftRevision = draft.draftRevision;
    releaseDraft(draft);
    lastReleasedDraftRevision = Math.max(lastReleasedDraftRevision, releasedDraftRevision);
    releasedDraftRevisions.set(submittedSessionId, Math.max(
      releasedDraftRevisions.get(submittedSessionId) || 0,
      releasedDraftRevision,
    ));
    diagnostic("composer_draft_released_after_submit", {
      draftRevision: releasedDraftRevision,
    });
    syncContext({ force: true });
    return true;
  }

  function observeCorrection(draft, submittedText) {
    if (!submittedText || !draft.voiceText || draft.voiceInsertedAtEnd === false) return null;
    const prefix = draft.baseComposerText ? `${draft.baseComposerText} ` : "";
    if (prefix && !submittedText.startsWith(prefix)) return null;
    const candidate = correctionCandidate(draft.voiceText, prefix ? submittedText.slice(prefix.length) : submittedText);
    if (!candidate) return null;
    const key = `${candidate.heard.toLocaleLowerCase("en-US")}\u0000${candidate.write.toLocaleLowerCase("en-US")}`;
    const count = (correctionObservations.get(key) || 0) + 1;
    correctionObservations.set(key, count);
    if (count >= CORRECTION_OCCURRENCES_REQUIRED && !acceptedCorrections.has(key)) {
      pendingCorrectionSuggestion = { ...candidate, occurrences: count };
    }
    return candidate;
  }

  function acceptCorrection(heard, write) {
    const candidate = correctionCandidate(String(heard || ""), String(write || ""));
    if (!candidate || !pendingCorrectionSuggestion
      || candidate.heard !== pendingCorrectionSuggestion.heard
      || candidate.write !== pendingCorrectionSuggestion.write) return false;
    const key = `${candidate.heard.toLocaleLowerCase("en-US")}\u0000${candidate.write.toLocaleLowerCase("en-US")}`;
    acceptedCorrections.set(key, candidate);
    pendingCorrectionSuggestion = null;
    contextFingerprint = "";
    syncContext({ force: true });
    return true;
  }

  async function submitDraft(draft, mode, options = {}) {
    if (!currentContext) return COMMAND_RETRY;
    if (!text(draft && draft.text)) return COMMAND_DISCARD;
    const actionId = traceId(options.actionId || draft.queuedActionId);
    const clientSubmissionId = actionId ? `voxspark-${actionId}` : "";
    if (draft.sessionId !== currentContext.sessionId) {
      if (typeof sendDraft !== "function") return COMMAND_RETRY;
      await sendDraft({
        threadId: draft.sessionId,
        thread: draft.thread || {},
        activeTurnId: draft.activeTurnId || "",
        text: draft.text,
        mode,
        clientSubmissionId,
      });
      releaseDraft(draft);
      return COMMAND_ACCEPTED;
    }
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
    await sendMessage({ preventDefault() {}, clientSubmissionId });
    if (text(composerText()) === draft.text) return COMMAND_RETRY;
    releaseDraft(draft);
    return COMMAND_ACCEPTED;
  }

  async function flushQueuedDrafts() {
    if (queueFlushing || queueOperation || !queuedDrafts.length || !currentContext || typeof queueRequest !== "function") return false;
    if (queueTurnGate !== "ready") return false;
    if (currentContext.approvalPending || text(composerTargetActiveTurnId())) return false;
    if (!currentContext.focused || text(composerText())) return false;
    const queued = queuedDrafts.find((item) => (
      item.sessionId === currentContext.sessionId && item.status === "queued"
    ));
    if (!queued || typeof sendDraft !== "function") return false;
    queueFlushing = true;
    try {
      const claimed = await queueRequest("claim", {
        client_id: clientId,
        service_epoch: relayServiceEpoch,
        session_id: queued.sessionId,
        queue_id: queued.queueId,
      });
      if (!claimed || !claimed.ok || !text(claimed.text) || !traceId(claimed.lease_token)) {
        return false;
      }
      mergeQueueEntry(claimed.queue);
      let outcome = "succeeded";
      let errorCode = "";
      try {
        // A lease response may arrive after navigation; never borrow the new
        // Session's model/workspace/permission settings for the old submission.
        if (stopped || currentComposerThreadId() !== queued.sessionId) throw Error("queue_target_changed");
        await sendDraft({
          threadId: queued.sessionId,
          thread: composerTargetThread() || {},
          activeTurnId: "",
          text: claimed.text,
          mode: "submit",
          // Queue owns its saved entry, not a draft created while this request is in flight.
          preserveComposerDraft: true,
          clientSubmissionId: traceId(claimed.client_submission_id),
        });
      } catch (err) {
        outcome = err && err.code === "voxspark_submission_outcome_unknown" ? "unknown" : "failed";
        errorCode = outcome === "unknown" ? "action_outcome_unknown" : "queue_submission_failed";
      }
      const completed = await queueRequest("complete", {
        client_id: clientId,
        service_epoch: relayServiceEpoch,
        session_id: queued.sessionId,
        queue_id: queued.queueId,
        lease_token: traceId(claimed.lease_token),
        outcome,
        error_code: errorCode,
      });
      if (completed && completed.queue) {
        mergeQueueEntry(completed.queue);
      }
      if (outcome === "succeeded" && completed && completed.ok && currentContext?.sessionId === queued.sessionId) {
        queueTurnGate = "awaiting_running";
        diagnostic("queue_submission_confirmed", { action: "queue", actionId: queued.actionId });
        return true;
      }
      diagnostic("queue_submission_failed", {
        action: "queue",
        actionId: queued.actionId,
        outcome,
      });
      return false;
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
    retainCurrentDraftEdits();
    const matchedDraft = matchingDraft(message);
    if (!matchedDraft) return COMMAND_RETRY;
    if (matchedDraft.sessionId === currentContext.sessionId && !revisionsMatch(message, true)) {
      return COMMAND_RETRY;
    }
    if (matchedDraft.sessionId === currentContext.sessionId && currentContext.approvalPending) {
      return COMMAND_DISCARD;
    }
    const draft = Object.assign({}, matchedDraft);
    if (action === "queue") {
      if (!text(composerTargetActiveTurnId())) return COMMAND_DISCARD;
      if (!text(draft.text)) return COMMAND_DISCARD;
      if (typeof queueRequest !== "function") return COMMAND_RETRY;
      const actionId = traceId(message.action_id);
      const queued = await queueRequest("enqueue", {
        client_id: clientId,
        service_epoch: relayServiceEpoch,
        session_id: draft.sessionId,
        queue_id: actionId,
        action_id: actionId,
        capture_id: draft.captureId,
        draft_revision: draft.draftRevision,
        text: draft.text,
      });
      if (!queued || !queued.ok || !queued.queue) return COMMAND_RETRY;
      mergeQueueEntry(queued.queue);
      releaseDraft(matchedDraft);
      clearComposerIfOwned(draft);
      return COMMAND_ACCEPTED;
    }
    if (action === "submit" || action === "steer") {
      return submitDraft(draft, action, { actionId: traceId(message.action_id) });
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
      const outcome = replaceComposer(message, metadata);
      diagnostic(outcome === COMMAND_ACCEPTED
        ? "composer_replace_confirmed"
        : outcome === COMMAND_RETRY
          ? "composer_replace_retry"
          : "composer_replace_rejected", {
        outcome,
        syncId: traceId(metadata.syncId), clientAt: now(),
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
      } catch (err) {
        const outcomeUnknown = Boolean(err && err.code === "voxspark_submission_outcome_unknown");
        diagnostic("host_action_failed", {
          action: text(message.action),
          outcome: outcomeUnknown ? "unknown" : COMMAND_RETRY,
          ...traceDetails(message, metadata.sequence),
        });
        const actionId = traceId(message.action_id);
        if (actionId) {
          pendingCommandResults = pendingCommandResults.filter((item) => item.action_id !== actionId);
          pendingCommandResults.push({
            action_id: actionId,
            outcome: outcomeUnknown ? "unknown" : "failed",
            retryable: !outcomeUnknown,
            error_code: outcomeUnknown ? "action_outcome_unknown" : "action_failed",
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

  function configurePolishContextConsent(value) {
    const next = value === POLISH_CONTEXT_CONSENT ? POLISH_CONTEXT_CONSENT : "";
    if (next === polishContextConsent) return Boolean(next);
    polishContextConsent = next;
    contextFingerprint = "";
    syncContext({ force: true });
    return Boolean(next);
  }

  function stop() {
    stopped = true;
    resetQueueView();
    captureOperation = null;
    captureNotice = null;
    recoveryLastSnapshot = null;
    activeRelay?.controller.abort();
    activeRelay = null;
    relayInFlight = false;
    relayAgain = false;
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
    voice = null;
    renderVoiceStatus();
  }

  function readState() {
    return {
      enabled: Boolean(bridgeUrl),
      connected: relayConnected,
      voice: voice ? JSON.parse(JSON.stringify(voice)) : null,
      armedSessionId,
      contextRevision,
      currentContext: currentContext ? Object.assign({}, currentContext) : null,
      activeDraft: activeDraft ? Object.assign({}, activeDraft) : null,
      retainedDrafts: [...retainedDrafts.values()].map((draft) => Object.assign({}, draft)),
      lastReleasedDraftRevision,
      queuedDrafts: queuedDrafts.map((draft) => Object.assign({}, draft)),
      queueTurnGate,
      pendingCommandResults: pendingCommandResults.map((item) => Object.assign({}, item)),
      pendingCommandAcknowledgements: [...pendingCommandAcknowledgements],
      polishContextConsent,
      pendingCorrectionSuggestion: pendingCorrectionSuggestion
        ? Object.assign({}, pendingCorrectionSuggestion)
        : null,
      correctionRules: correctionRules(),
    };
  }

  return {
    configureBridgeUrl,
    configurePolishContextConsent,
    start,
    stop,
    syncContext,
    handleComposerSubmission,
    acceptCorrection,
    handleMessage,
    flushQueuedDrafts,
    manageQueue,
    manageCapture,
    readState,
  };
}

const api = Object.freeze({
  CONTRACT,
  STORAGE_BRIDGE_URL,
  POLISH_CONTEXT_CONSENT,
  appendComposerText,
  correctionCandidate,
  safeBridgeUrl,
  bridgeUrlFromRuntime,
  voiceStatusView,
  createVoxSparkSurfaceHostRuntime,
});

const voxsparkSurfaceHostRoot = typeof globalThis !== "undefined" ? globalThis : window;
voxsparkSurfaceHostRoot.CodexVoxSparkSurfaceHostRuntime = api;

export {
  CONTRACT,
  STORAGE_BRIDGE_URL,
  POLISH_CONTEXT_CONSENT,
  appendComposerText,
  correctionCandidate,
  safeBridgeUrl,
  bridgeUrlFromRuntime,
  voiceStatusView,
  createVoxSparkSurfaceHostRuntime,
};

export default api;
