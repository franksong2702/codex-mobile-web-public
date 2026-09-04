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
  const sendDraft = deps.sendDraft || null;
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
  let polishContextConsent = deps.polishContextConsent === POLISH_CONTEXT_CONSENT
    ? POLISH_CONTEXT_CONSENT
    : "";

  let bridgeUrl = "";
  let clientId = text(deps.clientId);
  let relayConnected = false;
  let relayInFlight = false;
  let relayAgain = false;
  let relayServiceEpoch = "";
  let lastCommandSequence = 0;
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
  let queueTurnGate = "ready";
  let pollTimer = null;
  let stopped = true;
  const correctionObservations = new Map();
  const acceptedCorrections = new Map();
  let pendingCorrectionSuggestion = null;

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
    const current = text(composerText());
    if (current) activeDraft.text = current;
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
        if (command.message && command.message.type === "host.action" && traceId(command.message.action_id)) {
          if (inFlightCommandSequences.has(command.sequence)) break;
          inFlightCommandSequences.add(command.sequence);
          void handleMessage(command.message, { sequence: command.sequence }).finally(() => {
            inFlightCommandSequences.delete(command.sequence);
            lastCommandSequence = Math.max(lastCommandSequence, command.sequence);
            relayAgain = true;
            if (!relayInFlight) {
              relayAgain = false;
              void relayContext();
            }
          });
          break;
        }
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
      if (relayAgain && !stopped) {
        relayAgain = false;
        Promise.resolve().then(() => relayContext());
      }
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
    if (relayInFlight) relayAgain = true;
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
    setComposerText(composerDraft);
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
    if (!submittedText || !draft.voiceText) return null;
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
    if (draft.sessionId !== currentContext.sessionId) {
      if (typeof sendDraft !== "function") return COMMAND_RETRY;
      await sendDraft({
        threadId: draft.sessionId,
        thread: draft.thread || {},
        activeTurnId: draft.activeTurnId || "",
        text: draft.text,
        mode,
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
    await sendMessage({ preventDefault() {} });
    if (text(composerText()) === draft.text) return COMMAND_RETRY;
    releaseDraft(draft);
    return COMMAND_ACCEPTED;
  }

  async function flushQueuedDrafts() {
    if (queueFlushing || !queuedDrafts.length || !currentContext) return false;
    if (queueTurnGate !== "ready") return false;
    if (currentContext.approvalPending || text(composerTargetActiveTurnId())) return false;
    if (!currentContext.focused || text(composerText())) return false;
    const draftIndex = queuedDrafts.findIndex((draft) => draft.sessionId === currentContext.sessionId);
    if (draftIndex < 0) return false;
    const draft = queuedDrafts[draftIndex];
    queueFlushing = true;
    try {
      const outcome = await submitDraft(draft, "submit", { restoreWhenEmpty: true });
      if (outcome === COMMAND_ACCEPTED) {
        queuedDrafts.splice(draftIndex, 1);
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
      queuedDrafts.push(draft);
      releaseDraft(matchedDraft);
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
      retainedDrafts: [...retainedDrafts.values()].map((draft) => Object.assign({}, draft)),
      lastReleasedDraftRevision,
      queuedDrafts: queuedDrafts.map((draft) => Object.assign({}, draft)),
      queueTurnGate,
      pendingCommandResults: pendingCommandResults.map((item) => Object.assign({}, item)),
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
  createVoxSparkSurfaceHostRuntime,
};

export default api;
