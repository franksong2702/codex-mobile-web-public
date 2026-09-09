//#region frontend/native/task-card-runtime.mjs
function taskCardActionThread(threadId) {
	const id = String(threadId || "").trim();
	if (id && state.currentThread && String(state.currentThread.id || "") === id) return state.currentThread;
	if (id && state.threadTileDetails.has(id)) return state.threadTileDetails.get(id);
	if (!id) return state.currentThread || null;
	return null;
}
function findThreadTaskCard(cardId, threadId = "") {
	const thread = taskCardActionThread(threadId);
	return threadTaskCardsForThread(thread || {}).find((card) => card.id === String(cardId || "")) || null;
}
function summarizeTaskCardText(value) {
	return truncateSingleLine(String(value || "").replace(/\s+/g, " ").trim(), 280);
}
function truncateThreadTaskCardBody(value, maxChars = THREAD_TASK_CARD_BODY_MAX_CHARS) {
	const text = String(value || "").trim();
	const limit = Math.max(0, Number(maxChars) || 0);
	if (!limit || text.length <= limit) return text;
	const marker = `\n\n[Task card body truncated: ${text.length} chars total]\n\n`;
	const available = Math.max(0, limit - marker.length);
	if (available <= 0) return text.slice(0, limit);
	const head = Math.ceil(available * .6);
	const tail = Math.max(0, available - head);
	return `${text.slice(0, head).trimEnd()}${marker}${text.slice(-tail).trimStart()}`.slice(0, limit);
}
function isThreadTaskCardCommandText(value) {
	const text = String(value || "").trim();
	return (text.startsWith(THREAD_TASK_CARD_COMMAND_PREFIX) || THREAD_TASK_CARD_MENTION_PATTERN.test(text) || THREAD_TASK_CARD_AUTONOMOUS_MENTION_PATTERN.test(text)) && threadTaskCardCommandText(text).length > 0;
}
function isThreadGoalCommandText(value) {
	const text = String(value || "").trim();
	return text.toLowerCase() === THREAD_GOAL_COMMAND_PREFIX || THREAD_GOAL_MENTION_PATTERN.test(text);
}
function isChatGptProCommandText(value) {
	return /(?:^|\s)@(?:ChatGPT\s+Pro|ChatGPTPro|GPT\s+Pro)\b/i.test(String(value || ""));
}
async function submitChatGptProRequest(text, options = {}) {
	if (!String(text || "").trim()) return false;
	if (state.pendingAttachments.length) {
		showError(/* @__PURE__ */ new Error("@ChatGPT Pro does not support attachments in this entry point"));
		return true;
	}
	const sourceThreadId = currentComposerThreadId() || state.currentThreadId || "";
	const sourceThread = composerTargetThread() || state.currentThread || null;
	const cwd = state.newThreadDraft ? state.selectedCwd || "" : sourceThread && sourceThread.cwd || "";
	state.composerBusy = true;
	state.sendButtonHint = "";
	$("connectionState").classList.remove("error");
	$("connectionState").textContent = "正在提交 ChatGPT Pro 分析";
	markActivity("Pro 分析");
	updateComposerControls();
	try {
		const result = await api("/api/chatgpt-pro/generate", {
			method: "POST",
			body: JSON.stringify({
				prompt: text,
				sourceThreadId,
				sourceThreadTitle: sourceThread ? threadDisplayName(sourceThread) : "",
				cwd,
				language: "zh-CN",
				outputFormat: "markdown",
				bridgeMode: isHermesEmbedMode() ? "embedded" : "standalone"
			}),
			timeoutMs: 18e4
		});
		setComposerText("");
		clearPendingAttachments();
		scheduleCurrentDraftSave();
		const proThreadId = String(result && result.proThreadId || "");
		$("connectionState").textContent = proThreadId ? `ChatGPT Pro 分析已提交：${proThreadId.slice(0, 8)}` : "ChatGPT Pro 分析已提交";
		markActivity("Pro 已提交");
		await loadThreads({ silent: true }).catch(showError);
		if (state.newThreadDraft && proThreadId) {
			state.newThreadDraft = false;
			await loadThread(proThreadId, { source: "chatgpt-pro" }).catch(showError);
		}
		return true;
	} catch (err) {
		$("connectionState").classList.add("error");
		$("connectionState").textContent = normalizeClientErrorMessage(err && err.message ? err.message : String(err), err) || "ChatGPT Pro 提交失败";
		showError(err);
		if (options.rethrow) throw err;
		return true;
	} finally {
		state.composerBusy = false;
		updateComposerControls();
	}
}
function threadTaskCardCommandText(value) {
	const text = String(value || "").trim();
	if (text.startsWith(THREAD_TASK_CARD_LEGACY_COMMAND_PREFIX)) return text.slice(THREAD_TASK_CARD_LEGACY_COMMAND_PREFIX.length).trim();
	if (THREAD_TASK_CARD_AUTONOMOUS_MENTION_PATTERN.test(text)) return text.replace(THREAD_TASK_CARD_AUTONOMOUS_MENTION_PATTERN, "").trim();
	if (THREAD_TASK_CARD_MENTION_PATTERN.test(text)) return text.replace(THREAD_TASK_CARD_MENTION_PATTERN, "").trim();
	return text.startsWith(THREAD_TASK_CARD_COMMAND_PREFIX) ? text.slice(THREAD_TASK_CARD_COMMAND_PREFIX.length).trim() : "";
}
function threadTaskCardVisibleTargets() {
	const sourceThreadId = currentComposerThreadId() || state.currentThreadId;
	return (state.threads || []).filter((thread) => thread && thread.id && thread.id !== sourceThreadId).slice(0, 40).map((thread) => ({
		threadId: String(thread.id || ""),
		title: threadTitleForDisplay(thread) || String(thread.id || ""),
		cwd: String(thread.cwd || "")
	}));
}
function buildThreadTaskCardDraftRequestText(commandText, sourceThread = composerTargetThread()) {
	const original = String(commandText || "").trim();
	if (!threadTaskCardCommandText(original)) throw new Error("Task-card command is empty");
	const legacyAutonomousCommand = original.startsWith(THREAD_TASK_CARD_LEGACY_COMMAND_PREFIX) || THREAD_TASK_CARD_AUTONOMOUS_MENTION_PATTERN.test(original);
	const source = sourceThread || {};
	const sourceThreadId = currentComposerThreadId() || state.currentThreadId || "";
	const envelope = {
		version: 1,
		sourceThreadId: String(sourceThreadId),
		sourceThreadTitle: threadTitleForDisplay(source) || String(sourceThreadId),
		availableTargets: threadTaskCardVisibleTargets()
	};
	return [
		original,
		"",
		`<${THREAD_TASK_CARD_REQUEST_TAG}>`,
		JSON.stringify(envelope, null, 2),
		`</${THREAD_TASK_CARD_REQUEST_TAG}>`,
		"",
		"Interpret the command above as a cross-thread pending task card request.",
		"Return only one XML block in exactly this format:",
		`<${THREAD_TASK_CARD_DRAFT_TAG}>`,
		"{\"targetThreadIds\":[\"one or more exact threadId values from availableTargets\"],\"workflowMode\":\"manual|autonomous\",\"workflowId\":\"optional existing workflow id\",\"title\":\"short title\",\"summary\":\"one-line summary\",\"body\":\"full markdown body\",\"error\":\"\"}",
		`</${THREAD_TASK_CARD_DRAFT_TAG}>`,
		"Rules:",
		"- Choose one or more targetThreadIds only from availableTargets.threadId.",
		"- Do not invent a thread id; when the request names multiple clear targets, include all of them.",
		"- Default workflowMode to manual for plain # or @任务卡片 single-card commands.",
		"- Use autonomous only when the command uses #自由协作, @自由协作, or explicitly asks for autonomous/free collaboration/auto-return workflow.",
		legacyAutonomousCommand ? "- This command used #自由协作 or @自由协作, so default workflowMode to autonomous unless it explicitly asks for manual." : "- This command used a manual task-card entry, so default workflowMode to manual unless it explicitly asks for autonomous/free collaboration.",
		"- Autonomous workflow means the target approves the first card once; after the target turn completes, Mobile Web sends the return card back automatically without another approval.",
		"- For a new autonomous workflow, leave workflowId empty. Reuse workflowId only when the command or visible context provides an existing id.",
		"- If the command is unclear or no target fits, set targetThreadIds to an empty array and explain the problem in error.",
		"- Keep title under 120 chars and summary under 280 chars.",
		"- Keep body under 7600 chars and put the actual requested work there.",
		"- Do not add any explanation outside the XML block."
	].join("\n");
}
function threadTaskCardRequestMarkerMatch(value) {
	const text = String(value || "");
	return new RegExp(`\\n\\s*<${THREAD_TASK_CARD_REQUEST_TAG}>[\\s\\S]*?<\\/${THREAD_TASK_CARD_REQUEST_TAG}>[\\s\\S]*$`, "i").exec(text);
}
function uniqueThreadTaskCardTargetIds(values, fallbackValue = "") {
	const raw = Array.isArray(values) && values.length ? values : [fallbackValue];
	const seen = /* @__PURE__ */ new Set();
	const ids = [];
	for (const value of raw) {
		const id = String(value || "").trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
		if (ids.length >= 12) break;
	}
	return ids;
}
function normalizeThreadTaskCardWorkflowMode(value) {
	const mode = String(value || "manual").trim().toLowerCase();
	if (mode === "autonomous" || mode === "auto" || mode === "automatic") return "autonomous";
	return "manual";
}
function visibleThreadTaskCardCommandText$1(value) {
	const text = String(value || "");
	const match = threadTaskCardRequestMarkerMatch(text);
	return match ? text.slice(0, match.index).trimEnd() : text;
}
function parseThreadTaskCardDraftText(value) {
	const text = String(value || "");
	const match = new RegExp(`<${THREAD_TASK_CARD_DRAFT_TAG}>\\s*([\\s\\S]*?)\\s*<\\/${THREAD_TASK_CARD_DRAFT_TAG}>`, "i").exec(text);
	if (!match) return null;
	let parsed;
	try {
		parsed = JSON.parse(match[1]);
	} catch (_) {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const targetThreadIds = uniqueThreadTaskCardTargetIds(parsed.targetThreadIds, parsed.targetThreadId);
	return {
		rawText: text,
		targetThreadId: targetThreadIds[0] || "",
		targetThreadIds,
		workflowMode: normalizeThreadTaskCardWorkflowMode(parsed.workflowMode),
		workflowId: truncateSingleLine(String(parsed.workflowId || "").trim(), 220),
		title: truncateSingleLine(String(parsed.title || "").trim(), 120),
		summary: truncateSingleLine(String(parsed.summary || "").trim(), 280),
		body: String(parsed.body || "").trim(),
		error: truncateSingleLine(String(parsed.error || "").trim(), 280)
	};
}
function hasThreadTaskCardDraftTag(value) {
	return String(value || "").includes(`<${THREAD_TASK_CARD_DRAFT_TAG}>`);
}
function turnHasThreadTaskCardRequest$1(turn) {
	return (Array.isArray(turn && turn.items) ? turn.items : []).some((item) => {
		if (!item || item.type !== "userMessage") return false;
		return (Array.isArray(item.content) ? item.content : []).some((part) => isInputTextPart(part) && Boolean(threadTaskCardRequestMarkerMatch(inputTextValue(part))));
	});
}
function turnHasThreadTaskCardDraftResponse$1(turn) {
	return (Array.isArray(turn && turn.items) ? turn.items : []).some((item) => item && (item.type === "agentMessage" || item.type === "plan") && hasThreadTaskCardDraftTag(item.text || ""));
}
function renderTurnThreadTaskCardDraft$1(turn, previousKeys = /* @__PURE__ */ new Set(), thread = renderContextThread()) {
	const contextThread = renderContextThread(thread);
	const items = Array.isArray(turn && turn.items) ? turn.items : [];
	for (const item of items) {
		if (!item || item.type !== "agentMessage" && item.type !== "plan") continue;
		const text = String(item.text || "");
		const draft = parseThreadTaskCardDraftText(text);
		if (draft) {
			const draftKey = threadTaskCardDraftKeyForDraft(turn, draft, item);
			let draftState = threadTaskCardDraftState(draftKey);
			if (draftState.status === "pending") {
				const existing = matchingThreadTaskCardsForDraft(draft, turn, contextThread);
				if (existing.length) {
					setThreadTaskCardDraftState(draftKey, {
						status: "created",
						error: "",
						cardId: String(existing[0] && existing[0].id || ""),
						cardIds: existing.map((card) => String(card && card.id || "")).filter(Boolean)
					}, { render: false });
					draftState = threadTaskCardDraftState(draftKey);
				}
			}
			if (canRecoverFailedThreadTaskCardDraft(draft, draftState)) {
				setThreadTaskCardDraftState(draftKey, {
					status: "pending",
					error: ""
				}, { render: false });
				queueThreadTaskCardDraftCreation(draftKey, contextThread);
				draftState = Object.assign({}, draftState, { status: "creating" });
			}
			if (draftState.status === "created" || draftState.status === "dismissed") return "";
			if (draftState.status === "creating" && isThreadTaskCardDraftCreationStale(draftKey, draftState)) {
				const attempts = Math.max(1, Number(draftState.attempts || 1));
				if (attempts < THREAD_TASK_CARD_DRAFT_CREATE_MAX_ATTEMPTS) {
					setThreadTaskCardDraftState(draftKey, {
						status: "pending",
						error: "",
						attempts
					}, { render: false });
					queueThreadTaskCardDraftCreation(draftKey, contextThread);
					draftState = Object.assign({}, draftState, {
						status: "creating",
						attempts: attempts + 1
					});
				} else {
					setThreadTaskCardDraftState(draftKey, {
						status: "failed",
						error: "Task card creation timed out before the server stored a card"
					}, { render: false });
					draftState = threadTaskCardDraftState(draftKey);
				}
			}
			if (draftState.status === "pending") {
				queueThreadTaskCardDraftCreation(draftKey, contextThread);
				draftState = Object.assign({}, draftState, { status: "creating" });
			}
			if (draftState.status === "creating") return "";
			return renderThreadTaskCardDraft(draft, item, turn, previousKeys, draftKey, draftState, contextThread);
		}
		if (hasThreadTaskCardDraftTag(text)) return renderPendingThreadTaskCardDraft$1("Generating cross-thread task card draft...", "Generating");
	}
	return "";
}
function renderPendingThreadTaskCardDraft$1(message, status = "Generating") {
	const detail = escapeHtml(String(message || "Generating cross-thread task card draft..."));
	return `<section class="approval-card thread-task-card-draft pending synthetic">
    <div class="approval-head">
      <div>
        <div class="approval-title">Cross-thread task card draft</div>
        <div class="approval-method">Pending</div>
      </div>
      <span class="approval-status">${escapeHtml(String(status || "Generating"))}</span>
    </div>
    <div class="approval-summary-line">${detail}</div>
  </section>`;
}
function threadTaskCardDraftKey(turnId, itemId) {
	return `task-card-draft|${String(turnId || "")}|${String(itemId || "")}`;
}
function isThreadTaskCardDraftCreationStale(draftKey, draftState) {
	if (!draftKey || !draftState || draftState.status !== "creating") return false;
	const updatedAtMs = Number(draftState.updatedAtMs || 0);
	if (!updatedAtMs) return false;
	if (Date.now() - updatedAtMs < THREAD_TASK_CARD_DRAFT_CREATE_STALE_MS) return false;
	state.scheduledThreadTaskCardDraftCreations.delete(String(draftKey));
	state.activeThreadTaskCardDraftCreations.delete(String(draftKey));
	return true;
}
function threadTaskCardDraftPayloadKey(draft) {
	const targetThreadIds = threadTaskCardDraftTargetIds(draft).sort();
	return stableTextHash(JSON.stringify({
		targetThreadIds,
		workflowMode: normalizeThreadTaskCardWorkflowMode(draft && draft.workflowMode),
		workflowId: String(draft && draft.workflowId || "").trim(),
		title: String(draft && draft.title || "").trim(),
		summary: String(draft && draft.summary || "").trim(),
		body: String(draft && draft.body || "").trim()
	}));
}
function threadTaskCardDraftKeyForDraft(turn, draft, item = null) {
	const turnId = String(turn && turn.id || "");
	const payloadKey = threadTaskCardDraftPayloadKey(draft);
	if (turnId && payloadKey) return threadTaskCardDraftKey(turnId, `draft-${payloadKey}`);
	return threadTaskCardDraftKey(turnId, item && item.id || "");
}
function findThreadById(threadId) {
	const id = String(threadId || "").trim();
	return (state.threads || []).find((thread) => String(thread && thread.id || "") === id) || null;
}
function threadTaskCardDraftTargetIds(draft) {
	return uniqueThreadTaskCardTargetIds(draft && draft.targetThreadIds, draft && draft.targetThreadId);
}
function commonPrefixLength(a, b) {
	const left = String(a || "");
	const right = String(b || "");
	const max = Math.min(left.length, right.length);
	let index = 0;
	while (index < max && left[index] === right[index]) index += 1;
	return index;
}
function recoverVisibleThreadForDraftTargetId(threadId) {
	const id = String(threadId || "").trim();
	if (!id || id.length < 12) return null;
	if (findThreadById(id)) return null;
	const candidates = (state.threads || []).filter((thread) => thread && thread.id && thread.id !== state.currentThreadId).map((thread) => ({
		thread,
		prefix: commonPrefixLength(id, thread.id)
	})).filter((entry) => entry.prefix >= 14).sort((a, b) => b.prefix - a.prefix);
	if (!candidates.length) return null;
	const bestPrefix = candidates[0].prefix;
	const best = candidates.filter((entry) => entry.prefix === bestPrefix);
	return best.length === 1 ? best[0].thread : null;
}
function threadTaskCardDraftTargetThreads(draft) {
	return threadTaskCardDraftTargetIds(draft).map((threadId) => ({
		threadId,
		thread: findThreadById(threadId) || recoverVisibleThreadForDraftTargetId(threadId)
	}));
}
function canRecoverFailedThreadTaskCardDraft(draft, draftState) {
	if (!draft || !draftState || draftState.status !== "failed") return false;
	const error = String(draftState.error || "");
	if (!/Target thread is missing from the visible thread list/i.test(error)) return false;
	return threadTaskCardDraftTargetIds(draft).length > 0;
}
function matchingThreadTaskCardsForDraft(draft, turn, thread = renderContextThread()) {
	const contextThread = renderContextThread(thread);
	const sourceThread = contextThread || state.currentThread;
	const cards = Array.isArray(sourceThread && sourceThread.threadTaskCards) ? sourceThread.threadTaskCards : [];
	const targetIds = new Set(threadTaskCardDraftTargetIds(draft));
	const sourceThreadId = String(sourceThread && sourceThread.id || renderContextThreadId(contextThread) || "");
	const sourceTurnId = String(turn && turn.id || "");
	const title = String(draft && draft.title || "").trim();
	const body = String(draft && draft.body || "").trim();
	return cards.filter((card) => {
		if (!card) return false;
		if (sourceThreadId && String(card.source && card.source.threadId || "") !== sourceThreadId) return false;
		if (sourceTurnId && String(card.source && card.source.turnId || "") !== sourceTurnId) return false;
		if (targetIds.size && !targetIds.has(String(card.target && card.target.threadId || ""))) return false;
		if (title && String(card.message && card.message.title || "").trim() !== title) return false;
		if (body && String(card.message && card.message.body || "").trim() !== body) return false;
		return true;
	});
}
function upsertThreadTaskCardOnThread(thread, card) {
	if (!thread || !card) return;
	thread.threadTaskCards = [card, ...(Array.isArray(thread.threadTaskCards) ? thread.threadTaskCards : []).filter((entry) => String(entry && entry.id || "") !== String(card.id || ""))];
}
function replaceTaskCardBodyPlaceholder(details, card) {
	if (!details || !card || !card.message || typeof card.message.body !== "string") return false;
	const placeholder = details.querySelector("[data-task-card-body-placeholder]");
	if (!placeholder) return false;
	const pre = document.createElement("pre");
	pre.className = "approval-detail";
	pre.textContent = card.message.body;
	placeholder.replaceWith(pre);
	return true;
}
async function loadThreadTaskCardBody(cardId, threadId = "", details = null) {
	const id = String(cardId || "").trim();
	const ownerThreadId = String(threadId || state.currentThreadId || "").trim();
	if (!id || !ownerThreadId) return null;
	const loadKey = `${ownerThreadId}:${id}`;
	if (state.threadTaskCardBodyLoads.has(loadKey)) return null;
	const currentCard = findThreadTaskCard(id, ownerThreadId);
	if (currentCard && currentCard.message && typeof currentCard.message.body === "string") {
		replaceTaskCardBodyPlaceholder(details, currentCard);
		return currentCard;
	}
	state.threadTaskCardBodyLoads.add(loadKey);
	const placeholder = details && details.querySelector("[data-task-card-body-placeholder]");
	if (placeholder) placeholder.textContent = "Loading task card body...";
	try {
		const result = await api(`/api/thread-task-cards/${encodeURIComponent(id)}?threadId=${encodeURIComponent(ownerThreadId)}`, { timeoutMs: 15e3 });
		const card = result && result.card;
		if (!card) throw new Error("task_card_body_missing");
		const thread = taskCardActionThread(ownerThreadId);
		if (thread) upsertThreadTaskCardOnThread(thread, card);
		if (!replaceTaskCardBodyPlaceholder(details, card) && thread) {
			if (ownerThreadId === String(state.currentThreadId || "")) renderCurrentThread();
			else if (!scheduleRenderThreadTilePane(ownerThreadId, { preserveScroll: true })) renderCurrentThread();
		}
		return card;
	} catch (err) {
		if (placeholder) placeholder.textContent = "Failed to load task card body.";
		throw err;
	} finally {
		state.threadTaskCardBodyLoads.delete(loadKey);
	}
}
function handleThreadTaskCardDetailsToggle(event) {
	const details = event && event.target && event.target.closest ? event.target.closest("[data-task-card-details]") : null;
	if (!details || !details.open) return;
	const cardId = details.dataset.taskCardId || "";
	const threadId = details.dataset.taskCardThreadId || "";
	if (!details.querySelector("[data-task-card-body-placeholder]")) return;
	loadThreadTaskCardBody(cardId, threadId, details).catch(showError);
}
function taskCardCountThreadsForId(threadId) {
	const id = String(threadId || "").trim();
	if (!id) return [];
	const threads = [];
	const add = (thread) => {
		if (!thread || String(thread.id || "") !== id || threads.includes(thread)) return;
		threads.push(thread);
	};
	add(state.currentThread);
	add(state.threadTileDetails && state.threadTileDetails.get(id));
	add(findThreadById(id));
	return threads;
}
function incrementPendingIncomingTaskCardCount(threadId, delta = 1) {
	const threads = taskCardCountThreadsForId(threadId);
	const base = threads[0] || null;
	if (!base) return;
	const current = Math.max(0, Number(base.pendingIncomingTaskCardCount) || 0);
	const next = Math.max(0, current + Number(delta || 0));
	const outgoing = Math.max(0, Number(base.pendingOutgoingTaskCardCount) || 0);
	for (const thread of threads) {
		thread.pendingIncomingTaskCardCount = next;
		thread.pendingOutgoingTaskCardCount = outgoing;
		thread.pendingTaskCardCount = next + outgoing;
	}
}
function incrementPendingOutgoingTaskCardCount(threadId, delta = 1) {
	const threads = taskCardCountThreadsForId(threadId);
	const base = threads[0] || null;
	if (!base) return;
	const current = Math.max(0, Number(base.pendingOutgoingTaskCardCount) || 0);
	const next = Math.max(0, current + Number(delta || 0));
	const incoming = Math.max(0, Number(base.pendingIncomingTaskCardCount) || 0);
	for (const thread of threads) {
		thread.pendingIncomingTaskCardCount = incoming;
		thread.pendingOutgoingTaskCardCount = next;
		thread.pendingTaskCardCount = incoming + next;
	}
}
function settleThreadTaskCardForThread(threadId, cardId, nextStatus, nextCard = null) {
	const thread = taskCardActionThread(String(threadId || "").trim() || String(state.currentThreadId || "").trim());
	if (!thread || !Array.isArray(thread.threadTaskCards)) return;
	const id = String(cardId || "").trim();
	if (!id) return;
	let settledCard = null;
	thread.threadTaskCards = thread.threadTaskCards.map((entry) => {
		if (String(entry && entry.id || "") !== id) return entry;
		settledCard = Object.assign({}, entry || {}, nextCard || {}, { status: nextStatus || nextCard && nextCard.status || entry.status });
		return settledCard;
	});
	if (!settledCard) return;
	if (settledCard.threadRole === "target") incrementPendingIncomingTaskCardCount(thread.id, -1);
	if (settledCard.threadRole === "source") incrementPendingOutgoingTaskCardCount(thread.id, -1);
	if (state.threadTileDetails.has(String(thread.id || ""))) state.threadTileDetails.set(String(thread.id || ""), thread);
	renderThreads();
	if (String(thread.id || "") === String(state.currentThreadId || "")) renderCurrentThread();
	else if (state.threadTileMode && threadTilePaneIsVisible(thread.id) && !scheduleRenderThreadTilePane(thread.id, { preserveScroll: true })) scheduleRenderCurrentThread();
}
function settleCurrentThreadTaskCard(cardId, nextStatus, nextCard = null) {
	settleThreadTaskCardForThread(state.currentThreadId, cardId, nextStatus, nextCard);
}
function resolveTargetThreadReference(input) {
	const raw = String(input || "").trim();
	if (!raw) return null;
	const lowered = raw.toLowerCase();
	return state.threads.find((thread) => thread && thread.id !== state.currentThreadId && (String(thread.id || "").toLowerCase() === lowered || String(threadTitleForDisplay(thread) || "").trim().toLowerCase() === lowered)) || null;
}
function resolveTargetThreadReferences(input) {
	const parts = String(input || "").split(/[\n,;，；]+/u).map((part) => part.trim()).filter(Boolean);
	const seen = /* @__PURE__ */ new Set();
	const targets = [];
	for (const part of parts) {
		const thread = resolveTargetThreadReference(part);
		const id = String(thread && thread.id || part || "").trim();
		if (!id || id === state.currentThreadId || seen.has(id)) continue;
		seen.add(id);
		targets.push({
			threadId: id,
			thread
		});
		if (targets.length >= 12) break;
	}
	return targets;
}
async function refreshThreadAfterTaskCard(threadId = "") {
	const id = String(threadId || state.currentThreadId || "").trim();
	if (!id) return;
	if (id === String(state.currentThreadId || "")) await refreshCurrentThread({ source: "task-card" });
	else if (state.threadTileMode && threadTilePaneIsVisible(id)) await loadThreadTileDetail(id, {
		force: true,
		background: true,
		source: "task-card"
	});
	loadThreads({ silent: true }).catch(showError);
}
async function refreshCurrentThreadAfterTaskCard() {
	await refreshThreadAfterTaskCard(state.currentThreadId);
}
function currentThreadHasTurn(turnId) {
	const targetTurnId = String(turnId || "").trim();
	if (!targetTurnId || !state.currentThread) return false;
	return (Array.isArray(state.currentThread.turns) ? state.currentThread.turns : []).some((turn) => String(turn && turn.id || "") === targetTurnId);
}
async function waitForCurrentThreadTurn(turnId, options = {}) {
	const targetTurnId = String(turnId || "").trim();
	if (!targetTurnId || !state.currentThreadId) return false;
	const timeoutMs = Math.max(500, Number(options.timeoutMs) || 1e4);
	const intervalMs = Math.max(150, Number(options.intervalMs) || 500);
	const deadline = Date.now() + timeoutMs;
	while (state.currentThreadId && Date.now() <= deadline) {
		await refreshCurrentThread({ source: "wait-turn" });
		if (!state.currentThreadId) return false;
		if (currentThreadHasTurn(targetTurnId)) {
			state.pendingPluginRouteHint = normalizePluginRouteHint({
				pluginId: "codex-mobile",
				route: "thread-turn",
				threadId: state.currentThreadId,
				itemId: targetTurnId
			});
			renderCurrentThread();
			return true;
		}
		await sleep(intervalMs);
	}
	return currentThreadHasTurn(targetTurnId);
}
async function createThreadTaskCardFromThread(sourceThread, event) {
	if (event) {
		event.preventDefault();
		event.stopPropagation();
	}
	const thread = sourceThread || state.currentThread;
	if (!thread || !thread.id) return;
	const targetInput = await requestAppTextInput("输入目标 thread id 或精确标题；多个目标用英文逗号分隔。", "", {
		title: "任务卡片目标",
		confirmLabel: "下一步",
		placeholder: "thread id 或标题",
		rows: 3
	});
	if (targetInput == null) return;
	const targets = resolveTargetThreadReferences(targetInput);
	if (!targets.length) {
		showError(/* @__PURE__ */ new Error("At least one different target thread is required"));
		return;
	}
	const title = await requestAppTextInput("输入任务卡片标题。", `Need response from ${threadTitleForDisplay(thread) || thread.id}`, {
		title: "任务卡片标题",
		confirmLabel: "下一步",
		rows: 2
	}) || "";
	if (!String(title).trim()) return;
	const body = await requestAppTextInput("输入任务卡片正文。", "", {
		title: "任务卡片正文",
		confirmLabel: "创建",
		rows: 7
	}) || "";
	if (!String(body).trim()) return;
	$("connectionState").classList.remove("error");
	$("connectionState").textContent = "Creating task card";
	try {
		const targetWorkspaceIds = {};
		for (const target of targets) if (target.thread) targetWorkspaceIds[target.threadId] = String(target.thread.cwd || "");
		await api("/api/thread-task-cards", {
			method: "POST",
			body: JSON.stringify({
				sourceWorkspaceId: thread.cwd || state.selectedCwd || "",
				sourceThreadId: thread.id,
				sourceTurnId: activeTurnIdForThread(thread),
				sourceThreadTitle: threadTitleForDisplay(thread) || thread.id,
				targetThreadIds: targets.map((target) => target.threadId),
				targetWorkspaceIds,
				idempotencyKey: `task-card:${thread.id}:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`,
				format: "markdown",
				title: String(title).trim(),
				summary: summarizeTaskCardText(body),
				body: String(body).trim()
			}),
			timeoutMs: 3e4
		});
		$("connectionState").textContent = "Task card created";
		recordHomeAiDiagnosticSuccess({
			category: "task_card_workflow_failed",
			diagnostic_type: "task_card_creation_failed",
			error_code: "task_card_create_failed",
			context: {
				surface: "task-card",
				action: "manual-create",
				thread_hash: diagnosticThreadHash(thread.id)
			}
		});
		await refreshThreadAfterTaskCard(thread.id);
	} catch (err) {
		recordHomeAiDiagnosticFailure({
			category: "task_card_workflow_failed",
			diagnostic_type: "task_card_creation_failed",
			severity_hint: "H2",
			evidence_confidence: .78,
			error_code: diagnosticErrorCode(err, "task_card_create_failed"),
			context: {
				surface: "task-card",
				action: "manual-create",
				thread_hash: diagnosticThreadHash(thread.id)
			},
			counts: {
				target_count: targets.length,
				status_code: diagnosticErrorStatus(err)
			},
			breadcrumbs: [{
				kind: "task-card",
				code: "manual-create",
				status: "failed",
				fields: {
					status_code: diagnosticErrorStatus(err),
					thread_hash: diagnosticThreadHash(thread.id)
				}
			}]
		});
		showError(err);
	}
}
async function createThreadTaskCardFromCurrent(event) {
	await createThreadTaskCardFromThread(state.currentThread, event);
}
function startThreadRequestBody(sourceThread = null, options = {}) {
	const thread = sourceThread || state.currentThread || {};
	const pluginMode = isHermesEmbedMode() ? "hermes" : "";
	return {
		cwd: thread.cwd || state.selectedCwd || "",
		sourceThreadId: thread.id || "",
		sourceThreadTitle: threadTitleForDisplay(thread) || thread.id || "",
		archiveSourceThread: Boolean(options.archiveSourceThread && thread.id),
		pluginMode,
		hermesPluginMode: Boolean(pluginMode),
		pluginId: pluginMode ? "codex-mobile" : ""
	};
}
function threadActionTargetRow(target) {
	if (!target || !target.closest) return null;
	return target.closest("[data-thread-row]");
}
function primaryTouch$1(event) {
	return event.touches && event.touches[0] || event.changedTouches && event.changedTouches[0] || null;
}
function startedThreadId(result) {
	return String(result && result.threadId || result && result.thread && result.thread.id || result && result.result && result.result.thread && result.result.thread.id || result && result.result && result.result.threadId || "");
}
function startedTurnId(result) {
	return String(result && result.turnId || result && result.turn && result.turn.id || result && result.result && result.result.turnId || result && result.result && result.result.turn && result.result.turn.id || "");
}
function continuationJobStatusText(job) {
	const status = String(job && job.status || "");
	const message = String(job && job.message || "").trim();
	if (message) return message;
	return {
		queued: "续接任务已排队",
		running: "正在生成交接并续接",
		done: "续接线程已就绪",
		failed: "续接任务失败"
	}[status] || "正在生成交接并续接";
}
function rememberContinuationJob(jobId) {
	const id = String(jobId || "").trim();
	if (!id) return;
	state.continuationJobId = id;
	localStorage.setItem(STORAGE_CONTINUATION_JOB, id);
}
function clearRememberedContinuationJob(jobId = "") {
	const id = String(jobId || "").trim();
	if (!id || localStorage.getItem(STORAGE_CONTINUATION_JOB) === id) localStorage.removeItem(STORAGE_CONTINUATION_JOB);
	if (!id || state.continuationJobId === id) state.continuationJobId = "";
}
async function openContinuationResult(result) {
	const threadId = startedThreadId(result);
	if (!threadId) throw new Error("Continuation thread was created without a thread id");
	state.continuationNewThreadId = threadId;
	const archivedSourceThreadId = result.sourceArchive && result.sourceArchive.archived ? result.sourceArchive.threadId : "";
	if (archivedSourceThreadId) state.threads = state.threads.filter((entry) => entry.id !== archivedSourceThreadId);
	if (result.thread) {
		state.threads = [result.thread, ...state.threads.filter((thread) => thread.id !== result.thread.id)];
		renderThreads();
	}
	$("connectionState").classList.remove("error");
	if (result.sourceArchive && result.sourceArchive.error && !result.sourceArchive.archived) {
		$("connectionState").classList.add("error");
		$("connectionState").textContent = `续接线程已就绪；归档失败：${result.sourceArchive.error}`;
	} else if (result.sourceArchive && result.sourceArchive.error) $("connectionState").textContent = "交接已生成；旧线程已在 Mobile 隐藏";
	else $("connectionState").textContent = "交接已生成；正在打开续接线程";
	await loadThread(threadId, { source: "continuation" });
	loadThreads().catch(showError);
}
async function waitForContinuationJob(jobId) {
	const id = String(jobId || "").trim();
	if (!id) throw new Error("Continuation job was created without a job id");
	rememberContinuationJob(id);
	let delayMs = 800;
	while (state.continuationJobId === id) {
		const job = await api(`/api/thread-continuations/${encodeURIComponent(id)}`, { timeoutMs: 3e4 });
		$("connectionState").classList.toggle("error", job.status === "failed");
		$("connectionState").textContent = continuationJobStatusText(job);
		setContinuationDialogStatus(continuationJobStatusText(job), { error: job.status === "failed" });
		postClientEvent("continuation_job_poll", {
			jobId: id,
			status: String(job.status || ""),
			step: String(job.step || "")
		});
		markActivity(job.step || "续接任务");
		if (job.status === "done") {
			clearRememberedContinuationJob(id);
			postClientEvent("continuation_job_done", { jobId: id });
			return job.result || job;
		}
		if (job.status === "failed") {
			clearRememberedContinuationJob(id);
			postClientEvent("continuation_job_failed", {
				jobId: id,
				message: String(job.error || job.message || "Continuation job failed")
			});
			throw new Error(job.error || job.message || "Continuation job failed");
		}
		await sleep(delayMs);
		delayMs = Math.min(1800, Math.round(delayMs * 1.25));
	}
	throw new Error("Continuation job was cancelled");
}
async function resumeRememberedContinuationJob() {
	const jobId = String(localStorage.getItem(STORAGE_CONTINUATION_JOB) || "").trim();
	if (!jobId || state.continuationBusy) return;
	state.continuationBusy = true;
	state.continuationJobId = jobId;
	$("connectionState").classList.remove("error");
	$("connectionState").textContent = "正在恢复续接任务";
	try {
		await openContinuationResult(await waitForContinuationJob(jobId));
	} catch (err) {
		clearRememberedContinuationJob(jobId);
		if (!/Continuation job not found/i.test(err.message || "")) showError(err);
	} finally {
		state.continuationBusy = false;
	}
}
async function startNewThreadFromThread(sourceThread, event) {
	if (event) event.preventDefault();
	if (event) event.stopPropagation();
	if (state.continuationBusy) {
		setContinuationDialogStatus("续接任务已经在运行，请稍等。");
		$("connectionState").textContent = "续接任务已经在运行";
		postClientEvent("continuation_start_ignored_busy", {
			jobId: state.continuationJobId || "",
			sourceThreadId: state.continuationSourceThreadId || ""
		});
		return;
	}
	const thread = sourceThread || state.currentThread || {};
	if (!continuationDialogOpen()) {
		openContinuationDialog(thread);
		return;
	}
	const button = event && event.currentTarget;
	const cwd = thread.cwd ? String(thread.cwd).trim() : String(state.selectedCwd || "").trim();
	const sourceThreadId = thread.id || state.currentThreadId || "";
	const body = {
		cwd,
		sourceThreadId: thread.id || "",
		sourceThreadTitle: threadTitleForDisplay(thread) || thread.id || "",
		archiveSourceThread: Boolean(thread.id),
		pluginMode: isHermesEmbedMode() ? "hermes" : "",
		hermesPluginMode: isHermesEmbedMode(),
		pluginId: isHermesEmbedMode() ? "codex-mobile" : ""
	};
	if (!body.cwd) {
		showError(/* @__PURE__ */ new Error("Thread has no workspace path"));
		return;
	}
	if (sourceThreadId) {
		state.continuationSourceThreadId = sourceThreadId;
		state.continuationNewThreadId = "";
		clearRememberedContinuationJob();
	}
	state.continuationBusy = true;
	if (button) button.disabled = true;
	setContinuationDialogBusy(true, "正在创建续接任务。");
	$("connectionState").classList.remove("error");
	$("connectionState").textContent = "正在创建续接任务";
	markActivity("创建续接任务");
	let completed = false;
	let failed = false;
	postClientEvent("continuation_start_requested", {
		sourceThreadId,
		hasWorkspace: Boolean(body.cwd),
		hermesPluginMode: Boolean(body.hermesPluginMode)
	});
	try {
		const job = await api("/api/thread-continuations", {
			method: "POST",
			body: JSON.stringify(body),
			timeoutMs: 3e4
		});
		$("connectionState").textContent = continuationJobStatusText(job);
		setContinuationDialogStatus(continuationJobStatusText(job));
		postClientEvent("continuation_job_created", {
			jobId: String(job.jobId || ""),
			status: String(job.status || ""),
			pluginMode: String(job.pluginMode || "")
		});
		const result = await waitForContinuationJob(job.jobId);
		closeContinuationDialog({ force: true });
		completed = true;
		await openContinuationResult(result);
	} catch (err) {
		failed = true;
		setContinuationDialogBusy(false, err && err.message ? err.message : String(err), { error: true });
		postClientEvent("continuation_start_failed", {
			sourceThreadId,
			message: err && err.message ? err.message : String(err)
		});
		showError(err);
	} finally {
		clearRememberedContinuationJob();
		state.continuationBusy = false;
		if (!failed) setContinuationDialogBusy(false, completed || !continuationDialogOpen() ? "" : "续接任务未完成，可以重试。");
		if (button) button.disabled = false;
	}
}
async function startNewThreadFromCurrent(event) {
	await startNewThreadFromThread(state.currentThread, event);
}
function renderThreadArchiveDialog() {
	const dialog = $("threadArchiveConfirmDialog");
	const subtitle = $("threadArchiveConfirmSubtitle");
	if (!dialog || !subtitle) return;
	dialog.classList.toggle("hidden", !state.threadArchiveConfirmOpen);
	subtitle.textContent = state.threadArchiveConfirmOpen ? `目标会话：${state.threadArchiveConfirmTitle || state.threadArchiveConfirmTargetId || "--"}` : "";
}
function closeThreadArchiveDialog(confirmed = false) {
	const resolve = state.threadArchiveConfirmResolve;
	state.threadArchiveConfirmOpen = false;
	state.threadArchiveConfirmTargetId = "";
	state.threadArchiveConfirmTitle = "";
	state.threadArchiveConfirmResolve = null;
	renderThreadArchiveDialog();
	if (resolve) resolve(Boolean(confirmed));
}
function requestThreadArchiveConfirmation(threadId, title) {
	const label = String(title || "会话");
	if (state.threadArchiveConfirmResolve) closeThreadArchiveDialog(false);
	state.threadArchiveConfirmOpen = true;
	state.threadArchiveConfirmTargetId = String(threadId || "");
	state.threadArchiveConfirmTitle = label;
	renderThreadArchiveDialog();
	return new Promise((resolve) => {
		state.threadArchiveConfirmResolve = resolve;
	});
}
async function archiveThread(threadId, button = null) {
	const id = String(threadId || "");
	const thread = state.threads.find((entry) => entry.id === id);
	if (!thread) {
		showError(/* @__PURE__ */ new Error("Thread is no longer in the current list"));
		return;
	}
	const title = threadTitleForDisplay(thread) || "会话";
	if (!await requestThreadArchiveConfirmation(thread.id, title)) return;
	if (button) button.disabled = true;
	$("connectionState").classList.remove("error");
	$("connectionState").textContent = "正在归档会话";
	markActivity("归档会话");
	try {
		await api(`/api/threads/${encodeURIComponent(thread.id)}/archive`, {
			method: "POST",
			timeoutMs: 3e4
		});
		state.threads = state.threads.filter((entry) => entry.id !== thread.id);
		if (state.currentThreadId === thread.id) {
			clearCurrentThreadSelection();
			renderCurrentThread();
		}
		renderThreads();
		loadThreads().catch(showError);
	} catch (err) {
		showError(err);
	} finally {
		if (button) button.disabled = false;
	}
}
function taskCardStatusLabel(status) {
	const text = String(status || "pending");
	return {
		pending: "Pending",
		approving: "Approving",
		approved: "Approved",
		deleted: "Deleted",
		revoked: "Revoked",
		replied: "Replied"
	}[text] || text;
}
function taskCardReturnStatusLabel(card) {
	const text = String(card && card.delivery && card.delivery.returnStatus || card && card.audit && card.audit.returnStatus || card && card.returnStatus || "returned").trim().toLowerCase();
	return {
		completed: "Completed",
		partially_completed: "Partial",
		blocked: "Blocked",
		redirected: "Redirected",
		rejected: "Rejected",
		returned: "Returned"
	}[text] || (text ? text.replace(/_/g, " ") : "Returned");
}
function taskCardDirectionLabel(card) {
	if (!card) return "Task card";
	if (card.threadRole === "target") return `Task card from ${card.source && (card.source.title || card.source.threadId || card.source.workspaceId || "source thread")}`;
	if (card.threadRole === "source") return `Task card to ${card.target && (card.target.threadId || card.target.workspaceId || "target thread")}`;
	return "Task card";
}
function taskCardDetailLines(card) {
	if (!card) return [];
	const workflow = card.workflow && card.workflow.mode === "autonomous" ? card.workflow : null;
	return [
		card.target && card.threadRole === "source" ? `Target thread: ${card.target.threadId}` : "",
		card.source && card.threadRole === "target" ? `Source workspace: ${card.source.workspaceId}` : "",
		workflow ? `Workflow: autonomous${workflow.authorized ? " (authorized)" : " (first approval required)"}` : "",
		workflow && workflow.id ? `Workflow id: ${workflow.id}` : "",
		card.injectedTurnId ? `Injected turn: ${card.injectedTurnId}` : ""
	].filter(Boolean);
}
function threadTaskCardSummaryLine(text) {
	return truncateSingleLine(String(text || "").trim(), 220);
}
function renderThreadTaskCardExpandable(preview, sections, attributes = "") {
	const blocks = (Array.isArray(sections) ? sections : []).filter(Boolean);
	if (!blocks.length) return "";
	const attr = String(attributes || "").trim();
	return `<details class="approval-details"${attr ? ` ${attr}` : ""}>
    <summary><span>${escapeHtml(threadTaskCardSummaryLine(preview) || "Show details")}</span></summary>
    ${blocks.join("")}
  </details>`;
}
function renderThreadTaskCardActions(card, threadId = "") {
	if (!card) return "";
	const ownerThreadId = String(threadId || "").trim();
	const ownerAttribute = ownerThreadId ? ` data-task-card-thread-id="${escapeHtml(ownerThreadId)}"` : "";
	if (card.canApprove || card.canDelete || card.canReply || card.canRevoke) {
		const buttons = [];
		const approveLabel = card.workflow && card.workflow.mode === "autonomous" ? "Approve workflow" : "Approve";
		if (card.canApprove) buttons.push(`<button class="approval-button allow" type="button" data-task-card-action="approve" data-task-card-id="${escapeHtml(card.id)}"${ownerAttribute}>${escapeHtml(approveLabel)}</button>`);
		if (card.canReply) buttons.push(`<button class="approval-button allow" type="button" data-task-card-action="reply" data-task-card-id="${escapeHtml(card.id)}"${ownerAttribute}>Reply</button>`);
		if (card.canDelete) buttons.push(`<button class="approval-button deny" type="button" data-task-card-action="delete" data-task-card-id="${escapeHtml(card.id)}"${ownerAttribute}>Delete</button>`);
		if (card.canRevoke) buttons.push(`<button class="approval-button deny" type="button" data-task-card-action="revoke" data-task-card-id="${escapeHtml(card.id)}"${ownerAttribute}>Revoke</button>`);
		return `<div class="approval-actions">${buttons.join("")}</div>`;
	}
	return "";
}
function renderThreadTaskCard(card, previousKeys = /* @__PURE__ */ new Set(), threadId = "") {
	const key = `task-card|${card.id}`;
	const status = String(card.status || "pending");
	const detail = taskCardDetailLines(card).join("\n");
	const summary = threadTaskCardSummaryLine(card.message && card.message.summary ? card.message.summary : "");
	const body = card.message && card.message.body ? `<pre class="approval-detail">${escapeHtml(card.message.body)}</pre>` : card.message && card.message.bodyOmitted ? `<div class="approval-detail" data-task-card-body-placeholder data-task-card-id="${escapeHtml(card.id)}" data-task-card-thread-id="${escapeHtml(threadId)}">Task card body loads when opened.</div>` : "";
	const compact = status !== "pending" ? " compact" : "";
	const detailBlocks = [detail ? `<pre class="approval-detail">${escapeHtml(detail)}</pre>` : "", body];
	return `<section class="approval-card thread-task-card${compact}${entryAnimationClass(key, previousKeys)} ${escapeHtml(status)}" data-render-key="${escapeHtml(key)}" data-task-card="${escapeHtml(card.id)}">
    <div class="approval-head">
      <div>
        <div class="approval-title">${escapeHtml(taskCardDirectionLabel(card))}</div>
        <div class="approval-method">${escapeHtml(card.message && card.message.title || "Task card")}</div>
      </div>
      <span class="approval-status">${escapeHtml(taskCardStatusLabel(status))}</span>
    </div>
    ${summary ? `<div class="approval-summary-line">${escapeHtml(summary)}</div>` : ""}
    ${renderThreadTaskCardExpandable(summary || detail || card.message && card.message.title || "Task card details", detailBlocks, `data-task-card-details data-task-card-id="${escapeHtml(card.id)}" data-task-card-thread-id="${escapeHtml(threadId)}"`)}
    ${renderThreadTaskCardActions(card, threadId)}
  </section>`;
}
function renderThreadTaskCardReturnReceipt(card, previousKeys = /* @__PURE__ */ new Set(), threadId = "") {
	const key = `task-card-return-receipt|${card.id}`;
	const status = String(card.status || "approved");
	const detail = taskCardDetailLines(card).join("\n");
	const summary = threadTaskCardSummaryLine(card.message && card.message.summary ? card.message.summary : "");
	const body = card.message && card.message.body ? `<pre class="approval-detail">${escapeHtml(card.message.body)}</pre>` : card.message && card.message.bodyOmitted ? `<div class="approval-detail" data-task-card-body-placeholder data-task-card-id="${escapeHtml(card.id)}" data-task-card-thread-id="${escapeHtml(threadId)}">Task card body loads when opened.</div>` : "";
	const title = card.message && card.message.title || "Return receipt";
	const detailBlocks = [detail ? `<pre class="approval-detail">${escapeHtml(detail)}</pre>` : "", body];
	return `<section class="item thread-task-card-return-receipt${entryAnimationClass(key, previousKeys)} ${escapeHtml(status)}" data-render-key="${escapeHtml(key)}" data-task-card-return-receipt="${escapeHtml(card.id)}">
    <div class="item-head thread-task-card-return-head">
      <span class="thread-task-card-return-heading">
        <span class="thread-task-card-return-kicker">Return card</span>
        <span class="thread-task-card-return-title">${escapeHtml(title)}</span>
      </span>
      <span class="approval-status thread-task-card-return-status">${escapeHtml(taskCardReturnStatusLabel(card))}</span>
    </div>
    ${summary ? `<div class="approval-summary-line">${escapeHtml(summary)}</div>` : ""}
    ${renderThreadTaskCardExpandable(summary || detail || title, detailBlocks, `data-task-card-details data-task-card-id="${escapeHtml(card.id)}" data-task-card-thread-id="${escapeHtml(threadId)}"`)}
  </section>`;
}
function taskCardReturnReceiptTurnId(card) {
	const cardId = String(card && card.id || "").trim();
	return cardId ? `task-card-return-receipt|${cardId}` : "";
}
function taskCardReturnReceiptTimestampMs(value) {
	if (value == null || value === "") return 0;
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value <= 0) return 0;
		return value < 1e10 ? value * 1e3 : value;
	}
	const text = String(value || "").trim();
	if (!text) return 0;
	if (/^\d+$/.test(text)) return taskCardReturnReceiptTimestampMs(Number(text));
	const parsed = Date.parse(text);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
function taskCardReturnReceiptFlowTimeMs(card) {
	const delivery = card && card.delivery && typeof card.delivery === "object" ? card.delivery : {};
	const audit = card && card.audit && typeof card.audit === "object" ? card.audit : {};
	const message = card && card.message && typeof card.message === "object" ? card.message : {};
	return taskCardReturnReceiptTimestampMs(delivery.returnedAtMs) || taskCardReturnReceiptTimestampMs(delivery.returnedAt) || taskCardReturnReceiptTimestampMs(delivery.deliveredAtMs) || taskCardReturnReceiptTimestampMs(delivery.deliveredAt) || taskCardReturnReceiptTimestampMs(audit.returnedAtMs) || taskCardReturnReceiptTimestampMs(audit.returnedAt) || taskCardReturnReceiptTimestampMs(card && card.returnedAtMs) || taskCardReturnReceiptTimestampMs(card && card.returnedAt) || taskCardReturnReceiptTimestampMs(message.createdAtMs) || taskCardReturnReceiptTimestampMs(message.createdAt) || taskCardReturnReceiptTimestampMs(card && card.createdAtMs) || taskCardReturnReceiptTimestampMs(card && card.createdAt) || taskCardReturnReceiptTimestampMs(card && card.updatedAtMs) || taskCardReturnReceiptTimestampMs(card && card.updatedAt);
}
function taskCardTurnFlowTimeMs(turn) {
	const direct = taskCardReturnReceiptTimestampMs(turn && turn.completedAtMs) || taskCardReturnReceiptTimestampMs(turn && turn.completedAt) || taskCardReturnReceiptTimestampMs(turn && turn.finishedAtMs) || taskCardReturnReceiptTimestampMs(turn && turn.finishedAt) || taskCardReturnReceiptTimestampMs(turn && turn.updatedAtMs) || taskCardReturnReceiptTimestampMs(turn && turn.updatedAt) || taskCardReturnReceiptTimestampMs(turn && turn.startedAtMs) || taskCardReturnReceiptTimestampMs(turn && turn.startedAt) || taskCardReturnReceiptTimestampMs(turn && turn.createdAtMs) || taskCardReturnReceiptTimestampMs(turn && turn.createdAt);
	const itemMax = (Array.isArray(turn && turn.items) ? turn.items : []).reduce((max, item) => Math.max(max, taskCardReturnReceiptTimestampMs(item && item.completedAtMs) || taskCardReturnReceiptTimestampMs(item && item.completedAt) || taskCardReturnReceiptTimestampMs(item && item.updatedAtMs) || taskCardReturnReceiptTimestampMs(item && item.updatedAt) || taskCardReturnReceiptTimestampMs(item && item.startedAtMs) || taskCardReturnReceiptTimestampMs(item && item.startedAt) || taskCardReturnReceiptTimestampMs(item && item.createdAtMs) || taskCardReturnReceiptTimestampMs(item && item.createdAt) || taskCardReturnReceiptTimestampMs(item && item.timestampMs) || taskCardReturnReceiptTimestampMs(item && item.timestamp) || 0), 0);
	return Math.max(direct || 0, itemMax || 0);
}
function threadTaskCardReturnReceiptFlowEntries(thread, turns = []) {
	const turnEntries = (Array.isArray(turns) ? turns : []).map((turn, index) => ({
		kind: "turn",
		turn,
		flowMs: taskCardTurnFlowTimeMs(turn),
		order: index * 2,
		index
	}));
	const receiptEntries = (typeof threadTaskCardReturnReceiptsForThread === "function" ? threadTaskCardReturnReceiptsForThread(thread) : []).map((card, index) => {
		const flowMs = taskCardReturnReceiptFlowTimeMs(card);
		let afterIndex = -1;
		if (flowMs > 0) {
			for (const entry of turnEntries) if (entry.flowMs > 0 && entry.flowMs <= flowMs) afterIndex = entry.index;
		} else if (turnEntries.length) afterIndex = turnEntries[turnEntries.length - 1].index;
		return {
			kind: "return-receipt",
			card,
			flowMs,
			order: (afterIndex >= 0 ? turnEntries[afterIndex].order + 1 : turnEntries.length ? turnEntries[0].order - 1 : 0) + index / 1e3,
			index
		};
	});
	return turnEntries.concat(receiptEntries).sort((a, b) => {
		if (a.order !== b.order) return a.order - b.order;
		if (a.flowMs !== b.flowMs) return a.flowMs - b.flowMs;
		return a.index - b.index;
	});
}
function threadTaskCardReturnReceiptTurnIds(thread) {
	return (typeof threadTaskCardReturnReceiptsForThread === "function" ? threadTaskCardReturnReceiptsForThread(thread) : []).map(taskCardReturnReceiptTurnId).filter(Boolean);
}
function threadTaskCardReturnReceiptFlowTurnIds(thread, turns = []) {
	return threadTaskCardReturnReceiptFlowEntries(thread, turns).map((entry) => {
		if (entry.kind === "turn") return String(entry.turn && entry.turn.id || "").trim();
		return taskCardReturnReceiptTurnId(entry.card);
	}).filter(Boolean);
}
function renderThreadTaskCardReturnReceiptTurn(card, previousKeys = /* @__PURE__ */ new Set(), threadId = "") {
	const turnId = taskCardReturnReceiptTurnId(card);
	if (!turnId) return "";
	const key = `task-card-return-turn|${card.id}`;
	return `<article class="turn thread-task-card-return-turn${entryAnimationClass(key, previousKeys)}" data-turn="${escapeHtml(turnId)}" data-render-key="${escapeHtml(key)}" data-task-card-return-turn="${escapeHtml(card.id)}">
    ${renderThreadTaskCardReturnReceipt(card, previousKeys, threadId)}
  </article>`;
}
function renderThreadTaskCardReturnReceipts(thread, previousKeys = /* @__PURE__ */ new Set()) {
	const receipts = typeof threadTaskCardReturnReceiptsForThread === "function" ? threadTaskCardReturnReceiptsForThread(thread) : [];
	if (!receipts.length) return "";
	const threadId = String(thread && thread.id || "").trim();
	return `<div class="thread-task-card-return-receipt-stack">
    ${receipts.map((card) => renderThreadTaskCardReturnReceiptTurn(card, previousKeys, threadId)).join("")}
  </div>`;
}
function renderThreadConversationFlowWithReturnReceipts(thread, turns = [], previousKeys = /* @__PURE__ */ new Set(), renderTurnHtml = null) {
	const renderTurnEntry = typeof renderTurnHtml === "function" ? renderTurnHtml : () => "";
	const threadId = String(thread && thread.id || "").trim();
	return threadTaskCardReturnReceiptFlowEntries(thread, turns).map((entry) => entry.kind === "turn" ? renderTurnEntry(entry.turn, previousKeys) : renderThreadTaskCardReturnReceiptTurn(entry.card, previousKeys, threadId)).join("");
}
function renderThreadTaskCards(thread, previousKeys = /* @__PURE__ */ new Set()) {
	const cards = threadTaskCardsForThread(thread);
	if (!cards.length) return "";
	const threadId = String(thread && thread.id || "").trim();
	return `<div class="approval-stack thread-task-card-stack">
    ${cards.map((card) => renderThreadTaskCard(card, previousKeys, threadId)).join("")}
  </div>`;
}
function threadTaskCardDraftState(key) {
	return state.threadTaskCardDraftStates.get(String(key || "")) || {
		status: "pending",
		error: "",
		cardId: ""
	};
}
function threadTaskCardDraftStatusLabel(status) {
	return {
		pending: "Draft",
		creating: "Creating",
		created: "Created",
		dismissed: "Dismissed",
		failed: "Failed"
	}[status] || "Draft";
}
function threadTaskCardDraftDetailLines(draft, targetRefs, draftState) {
	const refs = Array.isArray(targetRefs) ? targetRefs : [];
	const targetLine = refs.length ? `Target threads: ${refs.map((entry) => {
		const thread = entry && entry.thread;
		return thread ? thread.title || thread.id || entry.threadId : entry && entry.threadId || "";
	}).filter(Boolean).join(", ")}` : "";
	const missing = refs.filter((entry) => entry && !entry.thread).map((entry) => entry.threadId).filter(Boolean);
	return [
		targetLine,
		draft && draft.workflowMode === "autonomous" ? `Workflow: autonomous${draft.workflowId ? ` (${draft.workflowId})` : " (new)"}` : "",
		missing.length ? `Missing targets: ${missing.join(", ")}` : "",
		draft.error ? `Model note: ${draft.error}` : "",
		draftState.error ? `Last error: ${draftState.error}` : ""
	].filter(Boolean);
}
function renderThreadTaskCardDraftActions(draftKey, draft, draftState, thread = renderContextThread()) {
	if (!draft || draftState.status === "pending" || draftState.status === "creating" || draftState.status === "created" || draftState.status === "dismissed") return "";
	const threadId = renderContextThreadId(thread);
	const threadAttr = threadId ? ` data-task-card-draft-thread-id="${escapeHtml(threadId)}"` : "";
	if (draftState.status === "failed") return `<div class="approval-actions">
      <button class="approval-button deny" type="button" data-task-card-draft-action="dismiss" data-task-card-draft-key="${escapeHtml(draftKey)}"${threadAttr}>Dismiss</button>
    </div>`;
	return `<div class="approval-actions">
    <button class="approval-button deny" type="button" data-task-card-draft-action="dismiss" data-task-card-draft-key="${escapeHtml(draftKey)}"${threadAttr}>Dismiss</button>
  </div>`;
}
function renderThreadTaskCardDraft(draft, item, turn, previousKeys = /* @__PURE__ */ new Set(), draftKey = "", draftState = null, thread = renderContextThread()) {
	if (!draft || !item || !turn) return "";
	const contextThread = renderContextThread(thread);
	const resolvedDraftKey = draftKey || threadTaskCardDraftKeyForDraft(turn, draft, item);
	const resolvedDraftState = draftState || threadTaskCardDraftState(resolvedDraftKey);
	const targetRefs = threadTaskCardDraftTargetThreads(draft);
	const compact = resolvedDraftState.status === "created" || resolvedDraftState.status === "dismissed" ? " compact" : "";
	const detail = threadTaskCardDraftDetailLines(draft, targetRefs, resolvedDraftState).join("\n");
	const summary = threadTaskCardSummaryLine(draft.summary || draft.error || "");
	const detailBlocks = [detail ? `<pre class="approval-detail">${escapeHtml(detail)}</pre>` : "", draft.body ? `<pre class="approval-detail">${escapeHtml(draft.body)}</pre>` : ""];
	return `<section class="approval-card thread-task-card-draft${compact}${entryAnimationClass(draftKey, previousKeys)} ${escapeHtml(draftState.status)}" data-render-key="${escapeHtml(draftKey)}" data-task-card-draft="${escapeHtml(draftKey)}">
    <div class="approval-head">
      <div>
        <div class="approval-title">Cross-thread task card draft</div>
        <div class="approval-method">${escapeHtml(draft.title || "Task card draft")}</div>
      </div>
      <span class="approval-status">${escapeHtml(threadTaskCardDraftStatusLabel(resolvedDraftState.status))}</span>
    </div>
    ${summary ? `<div class="approval-summary-line">${escapeHtml(summary)}</div>` : ""}
    ${renderThreadTaskCardExpandable(summary || detail || draft.title || "Task card draft details", detailBlocks)}
    ${renderThreadTaskCardDraftActions(resolvedDraftKey, draft, resolvedDraftState, contextThread)}
  </section>`;
}
function approvalTitle(method) {
	return {
		"item/commandExecution/requestApproval": "命令需要批准",
		"execCommandApproval": "命令需要批准",
		"item/fileChange/requestApproval": "文件改动需要批准",
		"applyPatchApproval": "文件改动需要批准",
		"item/permissions/requestApproval": "权限需要批准",
		"item/tool/requestUserInput": "需要你补充信息",
		"mcpServer/elicitation/request": "MCP 需要输入",
		"item/tool/call": "工具请求",
		"account/chatgptAuthTokens/refresh": "账号授权"
	}[method] || "待处理请求";
}
function approvalStatusLabel(status) {
	const text = String(status || "waiting");
	if (text === "waiting") return "等待中";
	if (text === "responding") return "发送中";
	if (text === "responded" || text === "resolved") return "已处理";
	if (text === "connectionClosed") return "已关闭";
	return text.charAt(0).toUpperCase() + text.slice(1);
}
function permissionSummary(permissions) {
	if (!permissions || typeof permissions !== "object") return "";
	const parts = [];
	if (permissions.network) parts.push(`Network: ${JSON.stringify(permissions.network)}`);
	if (permissions.fileSystem) parts.push(`File system: ${JSON.stringify(permissions.fileSystem)}`);
	return parts.join("\n");
}
function approvalDetailLines(request) {
	const params = request.params || {};
	const questions = Array.isArray(params.questions) ? params.questions : [];
	return [
		params.reason ? `原因: ${params.reason}` : "",
		params.command ? `命令:\n${params.command}` : "",
		params.cwd ? `工作目录:\n${params.cwd}` : "",
		params.grantRoot ? `授权目录:\n${params.grantRoot}` : "",
		Array.isArray(params.fileNames) && params.fileNames.length ? `文件:\n${params.fileNames.join("\n")}` : "",
		params.permissions ? `权限:\n${permissionSummary(params.permissions) || JSON.stringify(params.permissions, null, 2)}` : "",
		params.networkApprovalContext ? `网络:\n${JSON.stringify(params.networkApprovalContext, null, 2)}` : "",
		questions.length ? questions.map((question, index) => {
			return [
				question.header ? `${question.header}` : `问题 ${index + 1}`,
				question.question || "",
				Array.isArray(question.options) && question.options.length ? question.options.map((option) => `- ${option.label}${option.description ? `: ${option.description}` : ""}`).join("\n") : ""
			].filter(Boolean).join("\n");
		}).join("\n\n") : "",
		params.title ? `标题:\n${params.title}` : "",
		params.message ? `说明:\n${params.message}` : "",
		params.schema ? `结构:\n${JSON.stringify(params.schema, null, 2)}` : "",
		params.elicitation ? `请求:\n${JSON.stringify(params.elicitation, null, 2)}` : ""
	].filter(Boolean);
}
function isUserInputRequest(request) {
	return USER_INPUT_REQUEST_METHODS.has(request && request.method);
}
function renderUserInputOptions(request, fallbackThreadId = "") {
	const params = request.params || {};
	const questions = Array.isArray(params.questions) ? params.questions : [];
	const question = questions.find((entry) => Array.isArray(entry.options) && entry.options.length) || questions[0] || null;
	if (!question || !Array.isArray(question.options) || !question.options.length) return "";
	const threadId = approvalActionThreadId(request, fallbackThreadId);
	return `<div class="approval-option-grid">
    ${question.options.map((option) => `<button class="approval-option" type="button" data-server-request-id="${escapeHtml(request.id)}" data-server-request-thread-id="${escapeHtml(threadId)}" data-server-question-id="${escapeHtml(question.id || "answer")}" data-server-response-text="${escapeHtml(option.label || "")}">
      <span>${escapeHtml(option.label || "选项")}</span>
      ${option.description ? `<small>${escapeHtml(option.description)}</small>` : ""}
    </button>`).join("")}
  </div>`;
}
function renderUserInputActions(request, fallbackThreadId = "") {
	const params = request.params || {};
	const question = (Array.isArray(params.questions) ? params.questions : [])[0] || {};
	const threadId = approvalActionThreadId(request, fallbackThreadId);
	return `<form class="approval-response-form" data-server-request-form data-server-request-id="${escapeHtml(request.id)}" data-server-request-thread-id="${escapeHtml(threadId)}" data-server-question-id="${escapeHtml(question.id || "answer")}">
    ${renderUserInputOptions(request, threadId)}
    <textarea class="approval-response-input" name="responseText" rows="3" placeholder="输入回复内容"></textarea>
    <div class="approval-actions request-actions">
      <button class="approval-button allow" type="submit">提交</button>
      <button class="approval-button deny" type="button" data-server-request-id="${escapeHtml(request.id)}" data-server-request-thread-id="${escapeHtml(threadId)}" data-server-request-decline>取消</button>
    </div>
  </form>`;
}
function renderApprovalActions(request, fallbackThreadId = "") {
	const waiting = request.status === "waiting";
	if (!request.actionable || !waiting) return "";
	if (isUserInputRequest(request)) return renderUserInputActions(request, fallbackThreadId);
	const threadId = approvalActionThreadId(request, fallbackThreadId);
	return `<div class="approval-actions">
    <button class="approval-button allow" type="button" data-approval-id="${escapeHtml(request.id)}" data-approval-thread-id="${escapeHtml(threadId)}" data-approval-action="allow_once">允许一次</button>
    <button class="approval-button allow" type="button" data-approval-id="${escapeHtml(request.id)}" data-approval-thread-id="${escapeHtml(threadId)}" data-approval-action="allow_session">本会话允许</button>
    <button class="approval-button deny" type="button" data-approval-id="${escapeHtml(request.id)}" data-approval-thread-id="${escapeHtml(threadId)}" data-approval-action="deny">拒绝</button>
  </div>`;
}
function renderApprovalRequest$1(request, previousKeys = /* @__PURE__ */ new Set(), fallbackThreadId = "") {
	const key = `approval|${request.id}`;
	const status = String(request.status || "waiting");
	if (isApprovalSettled(request)) return `<section class="approval-card compact${entryAnimationClass(key, previousKeys)} ${escapeHtml(status)}" data-render-key="${escapeHtml(key)}" data-approval-card="${escapeHtml(request.id)}">
      <div class="approval-line">
        <span>${escapeHtml(approvalTitle(request.method))}</span>
        <span>${escapeHtml(approvalStatusLabel(request.status))}</span>
      </div>
    </section>`;
	const detail = approvalDetailLines(request).join("\n");
	return `<section class="approval-card${entryAnimationClass(key, previousKeys)} ${escapeHtml(status)}" data-render-key="${escapeHtml(key)}" data-approval-card="${escapeHtml(request.id)}">
    <div class="approval-head">
      <div>
        <div class="approval-title">${escapeHtml(approvalTitle(request.method))}</div>
        <div class="approval-method">${escapeHtml(request.method)}</div>
      </div>
      <span class="approval-status">${escapeHtml(approvalStatusLabel(request.status))}</span>
    </div>
    ${detail ? `<pre class="approval-detail">${escapeHtml(detail)}</pre>` : ""}
    ${renderApprovalActions(request, fallbackThreadId)}
  </section>`;
}
function renderPendingApprovals(thread, previousKeys = /* @__PURE__ */ new Set(), filter = null) {
	const threadId = String(thread && (thread.id || state.currentThreadId) || "").trim();
	const requests = pendingApprovalsForThread(threadId).filter((request) => !filter || filter(request));
	if (!requests.length) return "";
	return `<div class="approval-stack">
    ${requests.map((request) => renderApprovalRequest$1(request, previousKeys, threadId)).join("")}
  </div>`;
}
function createTaskCardRuntime() {
	return {
		renderThreadTaskCard: typeof renderThreadTaskCard === "function" ? renderThreadTaskCard : null,
		renderThreadTaskCards: typeof renderThreadTaskCards === "function" ? renderThreadTaskCards : null,
		renderThreadTaskCardReturnReceipt: typeof renderThreadTaskCardReturnReceipt === "function" ? renderThreadTaskCardReturnReceipt : null,
		renderThreadTaskCardReturnReceiptTurn: typeof renderThreadTaskCardReturnReceiptTurn === "function" ? renderThreadTaskCardReturnReceiptTurn : null,
		renderThreadTaskCardReturnReceipts: typeof renderThreadTaskCardReturnReceipts === "function" ? renderThreadTaskCardReturnReceipts : null,
		renderThreadConversationFlowWithReturnReceipts: typeof renderThreadConversationFlowWithReturnReceipts === "function" ? renderThreadConversationFlowWithReturnReceipts : null,
		taskCardReturnReceiptTurnId: typeof taskCardReturnReceiptTurnId === "function" ? taskCardReturnReceiptTurnId : null,
		threadTaskCardReturnReceiptFlowEntries: typeof threadTaskCardReturnReceiptFlowEntries === "function" ? threadTaskCardReturnReceiptFlowEntries : null,
		threadTaskCardReturnReceiptFlowTurnIds: typeof threadTaskCardReturnReceiptFlowTurnIds === "function" ? threadTaskCardReturnReceiptFlowTurnIds : null,
		threadTaskCardReturnReceiptTurnIds: typeof threadTaskCardReturnReceiptTurnIds === "function" ? threadTaskCardReturnReceiptTurnIds : null,
		createThreadTaskCardFromCurrent: typeof createThreadTaskCardFromCurrent === "function" ? createThreadTaskCardFromCurrent : null,
		mutateThreadTaskCard: typeof mutateThreadTaskCard === "function" ? mutateThreadTaskCard : null,
		replyTaskCard: typeof replyTaskCard === "function" ? replyTaskCard : null,
		renderApprovalRequest: typeof renderApprovalRequest$1 === "function" ? renderApprovalRequest$1 : null
	};
}
var taskCardRuntimeApi = Object.freeze({ createTaskCardRuntime });
var taskCardRuntimeRoot = typeof globalThis !== "undefined" ? globalThis : window;
Object.assign(taskCardRuntimeRoot, {
	approvalDetailLines,
	approvalStatusLabel,
	approvalTitle,
	archiveThread,
	buildThreadTaskCardDraftRequestText,
	canRecoverFailedThreadTaskCardDraft,
	clearRememberedContinuationJob,
	closeThreadArchiveDialog,
	commonPrefixLength,
	continuationJobStatusText,
	createThreadTaskCardFromCurrent,
	createThreadTaskCardFromThread,
	currentThreadHasTurn,
	findThreadById,
	findThreadTaskCard,
	handleThreadTaskCardDetailsToggle,
	hasThreadTaskCardDraftTag,
	incrementPendingIncomingTaskCardCount,
	incrementPendingOutgoingTaskCardCount,
	isChatGptProCommandText,
	isThreadGoalCommandText,
	isThreadTaskCardCommandText,
	isThreadTaskCardDraftCreationStale,
	isUserInputRequest,
	loadThreadTaskCardBody,
	matchingThreadTaskCardsForDraft,
	normalizeThreadTaskCardWorkflowMode,
	openContinuationResult,
	parseThreadTaskCardDraftText,
	permissionSummary,
	primaryTouch: primaryTouch$1,
	recoverVisibleThreadForDraftTargetId,
	rememberContinuationJob,
	renderApprovalActions,
	renderApprovalRequest: renderApprovalRequest$1,
	renderPendingApprovals,
	renderPendingThreadTaskCardDraft: renderPendingThreadTaskCardDraft$1,
	renderThreadArchiveDialog,
	renderThreadTaskCard,
	renderThreadTaskCardActions,
	renderThreadConversationFlowWithReturnReceipts,
	renderThreadTaskCardReturnReceipt,
	renderThreadTaskCardReturnReceiptTurn,
	renderThreadTaskCardReturnReceipts,
	taskCardReturnReceiptTurnId,
	threadTaskCardReturnReceiptFlowEntries,
	threadTaskCardReturnReceiptFlowTurnIds,
	threadTaskCardReturnReceiptTurnIds,
	renderThreadTaskCardDraft,
	renderThreadTaskCardDraftActions,
	renderThreadTaskCardExpandable,
	renderThreadTaskCards,
	renderTurnThreadTaskCardDraft: renderTurnThreadTaskCardDraft$1,
	renderUserInputActions,
	renderUserInputOptions,
	replaceTaskCardBodyPlaceholder,
	requestThreadArchiveConfirmation,
	resolveTargetThreadReference,
	resolveTargetThreadReferences,
	resumeRememberedContinuationJob,
	refreshCurrentThreadAfterTaskCard,
	refreshThreadAfterTaskCard,
	settleCurrentThreadTaskCard,
	settleThreadTaskCardForThread,
	startNewThreadFromCurrent,
	startNewThreadFromThread,
	startThreadRequestBody,
	startedThreadId,
	startedTurnId,
	submitChatGptProRequest,
	summarizeTaskCardText,
	taskCardActionThread,
	taskCardCountThreadsForId,
	taskCardDetailLines,
	taskCardDirectionLabel,
	taskCardStatusLabel,
	threadActionTargetRow,
	threadTaskCardCommandText,
	threadTaskCardDraftDetailLines,
	threadTaskCardDraftKey,
	threadTaskCardDraftKeyForDraft,
	threadTaskCardDraftPayloadKey,
	threadTaskCardDraftState,
	threadTaskCardDraftStatusLabel,
	threadTaskCardDraftTargetIds,
	threadTaskCardDraftTargetThreads,
	threadTaskCardRequestMarkerMatch,
	threadTaskCardSummaryLine,
	threadTaskCardVisibleTargets,
	truncateThreadTaskCardBody,
	turnHasThreadTaskCardDraftResponse: turnHasThreadTaskCardDraftResponse$1,
	turnHasThreadTaskCardRequest: turnHasThreadTaskCardRequest$1,
	uniqueThreadTaskCardTargetIds,
	upsertThreadTaskCardOnThread,
	visibleThreadTaskCardCommandText: visibleThreadTaskCardCommandText$1,
	waitForContinuationJob,
	waitForCurrentThreadTurn
});
taskCardRuntimeRoot.CodexTaskCardRuntime = taskCardRuntimeApi;
//#endregion
//#region frontend/native/notification-ui-runtime.mjs
var root = typeof globalThis !== "undefined" ? globalThis : window;
function isHermesEmbedMode$1() {
	return Boolean(state.pluginEmbed && state.pluginEmbed.embedded);
}
function currentPluginParentWindowOrigin() {
	try {
		if (!window.parent || window.parent === window || !window.parent.location) return "";
		const origin = String(window.parent.location.origin || "").trim();
		return origin && origin !== "null" ? origin : "";
	} catch (_) {
		return "";
	}
}
function normalizePluginParentOrigin(value) {
	const liveParentOrigin = currentPluginParentWindowOrigin();
	if (liveParentOrigin) return liveParentOrigin;
	const origin = String(value || "").trim();
	if (origin && origin !== "*") return origin;
	const referrerOrigin = pluginEmbedApi.parentOriginFromReferrer ? pluginEmbedApi.parentOriginFromReferrer(document.referrer) : "";
	return String(referrerOrigin || "").trim();
}
function pluginVoiceInputParentOriginAllowed(event) {
	if (!isHermesEmbedMode$1()) return false;
	if (event && event.source && event.source !== window.parent) return false;
	const origin = String(event && event.origin || "").trim();
	const expected = normalizePluginParentOrigin(state.pluginParentOrigin);
	if (expected && origin && origin !== expected) return false;
	if (!expected && origin && origin !== "null" && (!state.pluginParentOrigin || state.pluginParentOrigin === "*")) state.pluginParentOrigin = origin;
	return true;
}
function pluginVoiceInputSafeDraftId() {
	if (state.newThreadDraft) return "new-thread";
	return state.currentThreadId ? `thread:${String(state.currentThreadId).slice(0, 160)}` : "";
}
function pluginVoiceInputComposerId() {
	return state.newThreadDraft ? "new-thread-composer" : "thread-composer";
}
function pluginVoiceInputComposerWritable() {
	if (!isHermesEmbedMode$1()) return false;
	if (state.composerBusy || state.attachmentProcessingCount > 0) return false;
	const input = $("messageInput");
	if (!input || input.contentEditable === "false" || input.getAttribute("aria-disabled") === "true") return false;
	if (state.newThreadDraft) return Boolean(state.selectedCwd);
	return Boolean(state.currentThreadId && state.currentThread && !state.currentThread.mobileLoading && !state.currentThread.mobileLoadError);
}
function pluginVoiceInputActiveTurnHoldAvailable() {
	if (!isHermesEmbedMode$1()) return false;
	if (!state.activeTurnId || state.attachmentProcessingCount > 0) return false;
	return Boolean(state.currentThreadId && state.currentThread && !state.currentThread.mobileLoading && !state.currentThread.mobileLoadError);
}
function pluginVoiceInputCanReceiveText() {
	if (pluginVoiceInputComposerWritable()) return true;
	return pluginVoiceInputActiveTurnHoldAvailable();
}
function pluginVoiceInputEnsureComposerWritableForDraft() {
	if (!isHermesEmbedMode$1()) return false;
	const input = $("messageInput");
	if (!input) return false;
	if (input.contentEditable === "false" || input.getAttribute("aria-disabled") === "true") setMessageInputDisabled(false);
	if (input.contentEditable === "false" || input.getAttribute("aria-disabled") === "true") return false;
	focusMessageInput({
		moveCaretToEnd: true,
		retry: true
	});
	return true;
}
function persistPluginVoiceInputDraft(draftKey = currentPluginVoiceInputDraftKey()) {
	const key = String(draftKey || "");
	if (!key) return false;
	writeCurrentDraftToKey(key);
	return true;
}
function pluginVoiceInputCapabilityPayload(extra = {}) {
	return Object.assign({
		pluginId: "codex-mobile",
		writable: pluginVoiceInputCanReceiveText(),
		composerId: pluginVoiceInputComposerId(),
		threadId: String(state.currentThreadId || "").slice(0, 160),
		draftId: pluginVoiceInputSafeDraftId(),
		maxChars: Math.max(1, Number(pluginVoiceInputApi.MAX_TEXT_CHARS || 12e3) || 12e3),
		actions: [
			"append_text",
			"replace_draft",
			"insert_text",
			"provisional_text"
		]
	}, extra || {});
}
function pluginVoiceInputGestureAvailable() {
	return false;
}
function postPluginVoiceInputMessage(message) {
	if (!isHermesEmbedMode$1() || !message) return false;
	const targetOrigin = normalizePluginParentOrigin(state.pluginParentOrigin);
	if (targetOrigin) state.pluginParentOrigin = targetOrigin;
	return pluginVoiceInputApi.postToParent ? pluginVoiceInputApi.postToParent(window.parent, message, targetOrigin || "*") : false;
}
function publishPluginVoiceInputCapability(options = {}) {
	if (!isHermesEmbedMode$1()) return false;
	const payload = pluginVoiceInputCapabilityPayload({ requestId: options.requestId || "" });
	const signature = JSON.stringify({
		writable: payload.writable,
		composerId: payload.composerId,
		threadId: payload.threadId,
		draftId: payload.draftId,
		maxChars: payload.maxChars,
		actions: payload.actions
	});
	if (!options.force && !options.requestId && state.pluginVoiceInputCapabilitySignature === signature) return false;
	state.pluginVoiceInputCapabilitySignature = signature;
	return postPluginVoiceInputMessage(pluginVoiceInputApi.capabilityStateMessage(payload));
}
function currentPluginVoiceInputDraftKey() {
	return currentDraftKey() || "";
}
function rememberPluginVoiceInputSession(payload = {}, insertedText = "") {
	const voiceSessionId = pluginVoiceInputApi.voiceSessionIdFrom ? pluginVoiceInputApi.voiceSessionIdFrom(payload) : String(payload.voiceSessionId || payload.voice_session_id || "").trim();
	if (!voiceSessionId) return;
	const draftKey = currentPluginVoiceInputDraftKey();
	if (!draftKey) return;
	const sessions = state.pluginVoiceInputSessionsByDraftKey[draftKey] || [];
	const existing = sessions.find((entry) => entry.voiceSessionId === voiceSessionId);
	const next = {
		voiceSessionId,
		composerId: pluginVoiceInputComposerId(),
		threadId: String(state.currentThreadId || "").slice(0, 160),
		insertedText: String(insertedText || "").slice(0, Number(pluginVoiceInputApi.MAX_TEXT_CHARS || 12e3) || 12e3),
		insertedAtMs: Date.now()
	};
	if (existing) Object.assign(existing, next);
	else sessions.push(next);
	state.pluginVoiceInputSessionsByDraftKey[draftKey] = sessions.slice(-8);
}
function takePluginVoiceInputSessionsForDraft(draftKey) {
	const key = String(draftKey || "");
	if (!key) return [];
	const sessions = Array.isArray(state.pluginVoiceInputSessionsByDraftKey[key]) ? state.pluginVoiceInputSessionsByDraftKey[key].slice() : [];
	delete state.pluginVoiceInputSessionsByDraftKey[key];
	return sessions;
}
function commitPluginVoiceInputSessionsAfterSend(draftKey, finalText, options = {}) {
	if (!isHermesEmbedMode$1()) return;
	const sessions = takePluginVoiceInputSessionsForDraft(draftKey);
	const submittedText = String(finalText || "").trim();
	if (!sessions.length || !submittedText) return;
	for (const session of sessions) postPluginVoiceInputMessage(pluginVoiceInputApi.commitResultMessage({
		voiceSessionId: session.voiceSessionId,
		composerId: options.composerId || session.composerId || pluginVoiceInputComposerId(),
		threadId: options.threadId || state.currentThreadId || session.threadId || "",
		messageId: options.messageId || "",
		finalText: submittedText,
		action: "submitted"
	}));
}
function pluginVoiceInputAppendText(currentText, insertedText) {
	const current = String(currentText || "").trim();
	const next = String(insertedText || "").trim();
	if (!current) return next;
	if (!next) return current;
	return `${current}\n${next}`;
}
function pluginVoiceInputSessionIdFromPayload(payload = {}) {
	return pluginVoiceInputApi.voiceSessionIdFrom ? pluginVoiceInputApi.voiceSessionIdFrom(payload) : String(payload.voiceSessionId || payload.voice_session_id || "").trim();
}
function clearPluginVoiceInputProvisionalSession() {
	state.pluginVoiceInputProvisional = null;
}
function restorePluginVoiceInputProvisionalBase(payload = {}) {
	const session = state.pluginVoiceInputProvisional;
	const voiceSessionId = pluginVoiceInputSessionIdFromPayload(payload);
	if (!session || !voiceSessionId || session.voiceSessionId !== voiceSessionId) return false;
	if (session.draftKey && session.draftKey !== currentPluginVoiceInputDraftKey()) return false;
	if (composerText() !== session.currentText) {
		clearPluginVoiceInputProvisionalSession();
		return false;
	}
	setComposerText(session.baseText || "");
	clearPluginVoiceInputProvisionalSession();
	return true;
}
function applyPluginVoiceInputProvisionalText(payload = {}, text = "") {
	const voiceSessionId = pluginVoiceInputSessionIdFromPayload(payload);
	if (!voiceSessionId) return false;
	const draftKey = currentPluginVoiceInputDraftKey();
	if (!draftKey) return false;
	if (!pluginVoiceInputEnsureComposerWritableForDraft()) return false;
	const currentText = composerText();
	let session = state.pluginVoiceInputProvisional;
	if (!session || session.voiceSessionId !== voiceSessionId || session.draftKey !== draftKey) session = {
		voiceSessionId,
		draftKey,
		baseText: currentText,
		currentText
	};
	else if (currentText !== session.currentText) {
		clearPluginVoiceInputProvisionalSession();
		return false;
	}
	const nextText = pluginVoiceInputAppendText(session.baseText, text);
	setComposerText(nextText);
	persistPluginVoiceInputDraft(draftKey);
	updateComposerControls();
	focusMessageInput({
		moveCaretToEnd: true,
		retry: true
	});
	state.pluginVoiceInputProvisional = Object.assign({}, session, {
		currentText: nextText,
		text: String(text || "").slice(0, Number(pluginVoiceInputApi.MAX_TEXT_CHARS || 12e3) || 12e3),
		updatedAtMs: Date.now()
	});
	return true;
}
function rejectPluginVoiceInputInsert(payload, code, message) {
	const action = pluginVoiceInputApi.actionFromMessageType ? pluginVoiceInputApi.actionFromMessageType(payload.type) : "";
	postPluginVoiceInputMessage(pluginVoiceInputApi.insertResultMessage({
		requestId: pluginVoiceInputApi.requestIdFrom ? pluginVoiceInputApi.requestIdFrom(payload) : payload.requestId,
		voiceSessionId: pluginVoiceInputApi.voiceSessionIdFrom ? pluginVoiceInputApi.voiceSessionIdFrom(payload) : payload.voiceSessionId,
		composerId: payload.composerId || payload.composer_id || pluginVoiceInputComposerId(),
		draftId: pluginVoiceInputSafeDraftId(),
		action,
		ok: false,
		error: message || code || "composer_not_writable"
	}));
	postClientEvent("plugin_voice_input_insert_rejected", {
		code: String(code || "insert_rejected").slice(0, 80),
		writable: pluginVoiceInputCanReceiveText(),
		threadId: state.currentThreadId || ""
	});
}
function applyPluginVoiceInputTextMessage(payload = {}) {
	const action = pluginVoiceInputApi.actionFromMessageType ? pluginVoiceInputApi.actionFromMessageType(payload.type) : "";
	if (!action || action === "submit") {
		postPluginVoiceInputMessage(pluginVoiceInputApi.errorMessage({
			requestId: payload.requestId,
			voiceSessionId: payload.voiceSessionId,
			composerId: payload.composerId || pluginVoiceInputComposerId(),
			code: "unsupported_voice_input_action",
			error: "Unsupported voice input action."
		}));
		return true;
	}
	const capability = pluginVoiceInputCapabilityPayload();
	if (!capability.writable) {
		rejectPluginVoiceInputInsert(payload, "composer_not_writable", "Composer is not writable.");
		return true;
	}
	if (!pluginVoiceInputEnsureComposerWritableForDraft()) {
		rejectPluginVoiceInputInsert(payload, "composer_dom_unavailable", "Composer is not available.");
		return true;
	}
	const text = pluginVoiceInputApi.textFromMessage ? pluginVoiceInputApi.textFromMessage(payload, capability.maxChars) : String(payload.text || "").trim().slice(0, capability.maxChars);
	if (!text) {
		rejectPluginVoiceInputInsert(payload, "empty_voice_input_text", "Voice input text is empty.");
		return true;
	}
	if (action === "provisional_text") {
		if (!applyPluginVoiceInputProvisionalText(payload, text)) {
			rejectPluginVoiceInputInsert(payload, "provisional_voice_input_rejected", "Voice input draft changed.");
			return true;
		}
		postPluginVoiceInputMessage(pluginVoiceInputApi.insertResultMessage({
			requestId: pluginVoiceInputApi.requestIdFrom ? pluginVoiceInputApi.requestIdFrom(payload) : payload.requestId,
			voiceSessionId: pluginVoiceInputSessionIdFromPayload(payload),
			composerId: capability.composerId,
			draftId: capability.draftId,
			action,
			ok: true
		}));
		publishPluginVoiceInputCapability({ force: true });
		return true;
	}
	restorePluginVoiceInputProvisionalBase(payload);
	const nextText = action === "replace_draft" ? text : pluginVoiceInputAppendText(composerText(), text);
	setComposerText(nextText);
	persistPluginVoiceInputDraft();
	updateComposerControls();
	focusMessageInput({
		moveCaretToEnd: true,
		retry: true
	});
	rememberPluginVoiceInputSession(payload, text);
	postPluginVoiceInputMessage(pluginVoiceInputApi.insertResultMessage({
		requestId: pluginVoiceInputApi.requestIdFrom ? pluginVoiceInputApi.requestIdFrom(payload) : payload.requestId,
		voiceSessionId: pluginVoiceInputApi.voiceSessionIdFrom ? pluginVoiceInputApi.voiceSessionIdFrom(payload) : payload.voiceSessionId,
		composerId: capability.composerId,
		draftId: capability.draftId,
		action,
		ok: true
	}));
	publishPluginVoiceInputCapability({ force: true });
	return true;
}
function handlePluginVoiceInputMessage(event) {
	const payload = event && event.data;
	if (!pluginVoiceInputApi.isVoiceInputMessage || !pluginVoiceInputApi.isVoiceInputMessage(payload)) return false;
	if (!pluginVoiceInputParentOriginAllowed(event)) return true;
	if (payload.pluginId && String(payload.pluginId) !== "codex-mobile") return true;
	if (payload.version && Number(payload.version) !== 1) return true;
	if (payload.type === pluginVoiceInputApi.TYPES.CAPABILITY_QUERY || payload.type === "voice_input.capability_query") {
		publishPluginVoiceInputCapability({
			force: true,
			requestId: pluginVoiceInputApi.requestIdFrom ? pluginVoiceInputApi.requestIdFrom(payload) : payload.requestId
		});
		return true;
	}
	if (payload.type === pluginVoiceInputApi.TYPES.APPEND_TEXT || payload.type === pluginVoiceInputApi.TYPES.INSERT_TEXT || payload.type === pluginVoiceInputApi.TYPES.REPLACE_DRAFT || payload.type === pluginVoiceInputApi.TYPES.PROVISIONAL_TEXT || payload.type === pluginVoiceInputApi.TYPES.SUBMIT) return applyPluginVoiceInputTextMessage(payload);
	return false;
}
function clearPluginVoiceInputPress(options = {}) {
	const press = state.pluginVoiceInputPress;
	if (press && press.timer) clearTimeout(press.timer);
	const button = $("sendMessage");
	if (button) button.classList.remove("plugin-voice-input-recording");
	state.pluginVoiceInputPress = options.keepSuppress && press ? Object.assign({}, press, {
		timer: 0,
		started: false
	}) : null;
}
function handlePluginVoiceInputSendPointerDown(event) {
	if (!pluginVoiceInputGestureAvailable()) return;
	if (event.pointerType === "mouse" && event.button !== 0) return;
	event.preventDefault();
	event.stopPropagation();
	const button = event.currentTarget;
	clearPluginVoiceInputPress();
	const press = {
		pointerId: event.pointerId,
		started: false,
		suppressClick: false,
		timer: 0
	};
	state.pluginVoiceInputPress = press;
	try {
		button.setPointerCapture?.(event.pointerId);
	} catch (_) {}
	press.timer = setTimeout(() => {
		press.timer = 0;
		press.started = true;
		press.suppressClick = true;
		clearTextSelection();
		if (button) button.classList.add("plugin-voice-input-recording");
		const capability = pluginVoiceInputCapabilityPayload({ writable: true });
		if (!postPluginVoiceInputMessage(pluginVoiceInputApi.startRequestMessage(capability))) postClientEvent("plugin_voice_input_start_failed", { reason: "post_to_parent_failed" });
	}, PLUGIN_VOICE_INPUT_LONG_PRESS_MS);
}
function handlePluginVoiceInputSendPointerUp(event) {
	const press = state.pluginVoiceInputPress;
	if (!press) return;
	if (press.pointerId && event.pointerId !== press.pointerId) return;
	if (press.timer) {
		clearPluginVoiceInputPress();
		return;
	}
	try {
		event.currentTarget?.releasePointerCapture?.(event.pointerId);
	} catch (_) {}
	if (!press.started) {
		clearPluginVoiceInputPress();
		return;
	}
	event.preventDefault();
	event.stopImmediatePropagation();
	postPluginVoiceInputMessage(pluginVoiceInputApi.stopRequestMessage(pluginVoiceInputCapabilityPayload()));
	clearPluginVoiceInputPress({ keepSuppress: true });
	window.setTimeout(() => {
		if (state.pluginVoiceInputPress && state.pluginVoiceInputPress.suppressClick) state.pluginVoiceInputPress = null;
	}, 1200);
}
function handlePluginVoiceInputSendPointerCancel(event) {
	const press = state.pluginVoiceInputPress;
	if (!press) return;
	if (press.started) postPluginVoiceInputMessage(pluginVoiceInputApi.cancelRequestMessage(pluginVoiceInputCapabilityPayload()));
	if (event && typeof event.preventDefault === "function") event.preventDefault();
	clearPluginVoiceInputPress();
}
function handlePluginVoiceInputSendClick(event) {
	const press = state.pluginVoiceInputPress;
	if (!press || !press.suppressClick) return;
	event.preventDefault();
	event.stopImmediatePropagation();
	state.pluginVoiceInputPress = null;
}
function setComposerActionButtonLabel(button, label, options = {}) {
	if (!button) return;
	const text = String(label || "");
	const useProxy = Boolean(options.proxy);
	button.classList.toggle("plugin-voice-input-label-proxy", useProxy);
	if (useProxy) {
		button.textContent = "";
		button.dataset.visualLabel = text;
		button.setAttribute("aria-label", text);
	} else {
		button.textContent = text;
		delete button.dataset.visualLabel;
	}
}
function boundedPluginRefreshValue(value, maxLength) {
	const text = String(value || "").trim();
	return text ? text.slice(0, Math.max(0, Number(maxLength) || 0)) : "";
}
function pluginRefreshReasonForApiError(details = {}) {
	const status = Number(details && details.status || 0);
	const path = String(details && details.path || "").trim();
	const message = String(details && details.message || "").trim().toLowerCase();
	if (!(status === 401 || status === 403)) return "";
	if (path === "/api/v1/hermes/plugin/session") return "plugin_launch_invalid";
	if (message.includes("plugin_launch_invalid_or_expired")) return "plugin_launch_invalid";
	if (message.includes("invalid launch") || message.includes("invalid session")) return "plugin_session_invalid";
	if (message.includes("session is unauthorized") || message.includes("session expired")) return "plugin_session_invalid";
	if (message.includes("unauthorized") || message.includes("forbidden")) return "auth_state_changed";
	return "";
}
function currentHermesRefreshRoute(options = {}) {
	const explicit = options && typeof options.route === "object" ? options.route : null;
	const hinted = normalizePluginRouteHint$1(state.pendingPluginRouteHint) || normalizePluginRouteHint$1(state.queuedPluginRouteHint);
	const route = {};
	const name = boundedPluginRefreshValue(explicit && explicit.name ? explicit.name : state.currentThreadId || hinted && hinted.threadId ? "thread" : "root", 48);
	const threadId = boundedPluginRefreshValue(explicit && explicit.threadId ? explicit.threadId : state.currentThreadId || hinted && hinted.threadId || state.pluginLaunchTarget && state.pluginLaunchTarget.threadId || "", 160);
	const itemId = boundedPluginRefreshValue(explicit && explicit.itemId ? explicit.itemId : hinted && (hinted.itemId || hinted.taskId) || "", 160);
	const pluginRoute = boundedPluginRefreshValue(explicit && explicit.pluginRoute ? explicit.pluginRoute : hinted && hinted.route || "", 80);
	const pluginThreadId = boundedPluginRefreshValue(explicit && explicit.pluginThreadId ? explicit.pluginThreadId : threadId, 160);
	const pluginTaskId = boundedPluginRefreshValue(explicit && explicit.pluginTaskId ? explicit.pluginTaskId : hinted && hinted.taskId || "", 160);
	const pluginItemId = boundedPluginRefreshValue(explicit && explicit.pluginItemId ? explicit.pluginItemId : itemId, 160);
	if (name) route.name = name;
	if (threadId) route.threadId = threadId;
	if (itemId) route.itemId = itemId;
	if (pluginRoute) route.pluginRoute = pluginRoute;
	if (pluginThreadId) route.pluginThreadId = pluginThreadId;
	if (pluginTaskId) route.pluginTaskId = pluginTaskId;
	if (pluginItemId) route.pluginItemId = pluginItemId;
	return route;
}
function requestHermesPluginRefresh$1(reason, options = {}) {
	if (!isHermesEmbedMode$1() || !pluginEmbedApi.postRefreshRequired) return false;
	const normalizedReason = boundedPluginRefreshValue(reason || "refresh_required", 80) || "refresh_required";
	const route = currentHermesRefreshRoute(options);
	const targetOrigin = normalizePluginParentOrigin(state.pluginParentOrigin);
	const signature = JSON.stringify({
		reason: normalizedReason,
		targetOrigin: targetOrigin || "*",
		route,
		appearance: currentPluginAppearanceForHost()
	});
	if (!options.force && signature === state.pluginRefreshRequestSignature) return false;
	state.pluginRefreshRequestSignature = signature;
	state.pluginRefreshRequestReason = normalizedReason;
	if (targetOrigin) state.pluginParentOrigin = targetOrigin;
	if (state.pluginRefreshPendingTimer) {
		clearTimeout(state.pluginRefreshPendingTimer);
		state.pluginRefreshPendingTimer = null;
	}
	state.pluginRefreshPendingReason = normalizedReason;
	state.pluginRefreshPendingNotice = pluginRefreshPendingMessage(normalizedReason);
	state.pluginRefreshPendingTimer = window.setTimeout(() => {
		state.pluginRefreshPendingTimer = null;
		clearPluginRefreshPendingNotice();
	}, 1e4);
	if (state.currentThreadId || state.currentThread) renderCurrentThread();
	else if (state.newThreadDraft) renderNewThreadDraft();
	if ($("connectionState")) $("connectionState").textContent = state.pluginRefreshPendingNotice || "Requesting plugin refresh...";
	pluginEmbedApi.postRefreshRequired(window.parent, {
		reason: normalizedReason,
		route,
		appearance: currentPluginAppearanceForHost()
	}, { targetOrigin: targetOrigin || "*" });
	postClientEvent("plugin_refresh_required", {
		reason: normalizedReason,
		targetOrigin: targetOrigin || "*",
		hasThreadId: Boolean(route.threadId),
		hasItemId: Boolean(route.itemId),
		usedWildcardFallback: !targetOrigin
	});
	return true;
}
function pluginRefreshPendingMessage(reason) {
	const normalized = boundedPluginRefreshValue(reason || "refresh_required", 80) || "refresh_required";
	if (normalized === "server_build_changed") return "Refreshing plugin page for a new Mobile Web build...";
	if (normalized === "plugin_session_missing" || normalized === "plugin_launch_invalid") return "Refreshing plugin page because the Hermes launch session is no longer valid...";
	if (normalized === "auth_state_changed") return "Refreshing plugin page because the Codex auth/session state changed...";
	return "Refreshing plugin page from Hermes Mobile...";
}
function clearPluginRefreshPendingNotice(reason = "") {
	const normalizedReason = boundedPluginRefreshValue(reason || "", 80);
	const pendingReason = boundedPluginRefreshValue(state.pluginRefreshPendingReason || "", 80);
	if (normalizedReason && pendingReason && normalizedReason !== pendingReason) return false;
	if (state.pluginRefreshPendingTimer) {
		clearTimeout(state.pluginRefreshPendingTimer);
		state.pluginRefreshPendingTimer = null;
	}
	if (!state.pluginRefreshPendingNotice && !pendingReason) return false;
	const previousNotice = state.pluginRefreshPendingNotice;
	state.pluginRefreshPendingNotice = "";
	state.pluginRefreshPendingReason = "";
	if (normalizedReason && state.pluginRefreshRequestReason === normalizedReason) {
		state.pluginRefreshRequestSignature = "";
		state.pluginRefreshRequestReason = "";
	}
	const connection = $("connectionState");
	if (connection && previousNotice && connection.textContent === previousNotice) connection.textContent = "";
	if (state.currentThreadId || state.currentThread) renderCurrentThread();
	else if (state.newThreadDraft) renderNewThreadDraft();
	return true;
}
function boundedViewportNumber(value, max = 4096) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return 0;
	return Math.max(0, Math.min(Math.round(numeric), Math.max(0, Number(max) || 0)));
}
function normalizeHermesPluginViewportRect(rect) {
	if (!rect || typeof rect !== "object") return null;
	return {
		top: boundedViewportNumber(rect.top),
		right: boundedViewportNumber(rect.right),
		bottom: boundedViewportNumber(rect.bottom),
		left: boundedViewportNumber(rect.left),
		width: boundedViewportNumber(rect.width),
		height: boundedViewportNumber(rect.height)
	};
}
function normalizeHermesPluginViewportMessage(data) {
	if (!data || data.type !== "hermes.plugin.viewport" || data.version !== 1) return null;
	const pluginId = String(data.pluginId || "").trim();
	if (pluginId && pluginId !== "codex-mobile") return null;
	const viewport = data.viewport && typeof data.viewport === "object" ? data.viewport : {};
	const keyboard = data.keyboard && typeof data.keyboard === "object" ? data.keyboard : {};
	const host = data.host && typeof data.host === "object" ? data.host : {};
	const footer = data.footer && typeof data.footer === "object" ? data.footer : {};
	const topSafeArea = viewport.safeAreaTop || viewport.hostTopSafeArea || host.safeAreaTop || host.topSafeArea || host.hostTopSafeArea || footer.safeAreaTop || footer.topSafeArea || footer.hostTopSafeArea;
	const footerSafeArea = footer.safeAreaBottom || footer.bottomSafeArea || footer.hostBottomSafeArea || footer.safeAreaInsetBottom;
	return {
		receivedAtMs: Date.now(),
		reason: String(data.reason || "").trim().slice(0, 60),
		hostTopSafeArea: boundedViewportNumber(topSafeArea, 512),
		viewport: {
			width: boundedViewportNumber(viewport.width),
			height: boundedViewportNumber(viewport.height),
			offsetTop: boundedViewportNumber(viewport.offsetTop),
			offsetLeft: boundedViewportNumber(viewport.offsetLeft),
			layoutWidth: boundedViewportNumber(viewport.layoutWidth),
			layoutHeight: boundedViewportNumber(viewport.layoutHeight)
		},
		keyboard: {
			visible: Boolean(keyboard.visible),
			bottomInset: boundedViewportNumber(keyboard.bottomInset || keyboard.height, 1024),
			offsetTop: boundedViewportNumber(keyboard.offsetTop),
			height: boundedViewportNumber(keyboard.height || keyboard.bottomInset, 1024)
		},
		footer: { safeAreaBottom: boundedViewportNumber(footerSafeArea, 512) },
		iframe: normalizeHermesPluginViewportRect(data.iframe),
		host: normalizeHermesPluginViewportRect(data.host)
	};
}
function handleHermesPluginViewportMessage(data) {
	const normalized = normalizeHermesPluginViewportMessage(data);
	if (!normalized) return false;
	state.pluginHostViewport = normalized;
	syncThreadDetailLayoutState();
	updateViewportVars();
	updateComposerHeightVar();
	requestAnimationFrame(ensureSideChatDraftVisible);
	if (!isHermesKeyboardInputActive()) scheduleVisualRecovery("hermes-plugin-viewport", 40, {
		render: false,
		heavy: false,
		delays: [40, 180]
	});
	return true;
}
function renderPluginRefreshPendingNotice(previousKeys = /* @__PURE__ */ new Set()) {
	if (!isHermesEmbedMode$1()) return "";
	const message = String(state.pluginRefreshPendingNotice || "").trim();
	if (!message) return "";
	const key = `plugin-refresh-pending|${message}`;
	return `<div class="history-note plugin-refresh-pending${entryAnimationClass(key, previousKeys)}" data-render-key="${escapeHtml(key)}">${escapeHtml(message)}</div>`;
}
function scrubPluginLaunchUrl() {
	if (!isHermesEmbedMode$1()) return;
	try {
		const scrubbed = pluginEmbedApi.scrubRouteHintPath(window.location.href, {
			workspaceId: state.pluginEmbed.workspaceId,
			appearance: currentPluginAppearanceForHost()
		});
		if (scrubbed) window.history.replaceState({}, "", scrubbed);
	} catch (_) {}
}
function pluginRootPath() {
	if (!isHermesEmbedMode$1()) return window.location.pathname || "/";
	return pluginEmbedApi.scrubRouteHintPath("/", { workspaceId: state.pluginEmbed && state.pluginEmbed.workspaceId }) || "/?embed=hermes";
}
function showPluginEmbedAuthError(message = "") {
	hidePluginStartupLoading();
	const app = $("app");
	const login = $("login");
	const panel = document.querySelector("#login .login-panel");
	if (app) app.classList.add("hidden");
	if (login) login.classList.remove("hidden");
	if (panel) panel.classList.add("plugin-embed-login-panel");
	const brand = document.querySelector("#login .brand");
	if (brand) brand.textContent = "Codex Mobile";
	const input = $("loginKey");
	const submit = document.querySelector("#loginForm button[type='submit']");
	if (input) input.classList.add("hidden");
	if (submit) submit.classList.add("hidden");
	$("loginError").textContent = message || "Codex Mobile plugin launch is invalid or expired.";
	publishPluginNavigationState();
}
function showPluginEmbedRecovering(message = "") {
	showApp();
	hidePluginStartupLoading();
	clearPluginRefreshPendingNotice();
	state.newThreadDraft = false;
	state.startupThreadOpenPending = false;
	state.currentThread = null;
	state.currentThreadId = "";
	state.activeTurnId = "";
	clearInterval(state.tickTimer);
	state.tickTimer = null;
	updateSubagentPanelUi();
	updateTurnTimer();
	$("threadTitle").textContent = "Refreshing plugin";
	$("threadMeta").textContent = "Waiting for Hermes Mobile to relaunch Codex";
	$("conversation").innerHTML = `<div class="empty-state entry-animate">${escapeHtml(message || "Refreshing Codex Mobile plugin session...")}</div>`;
	state.renderedConversationSignature = `plugin-recovering|${String(message || "").slice(0, 120)}`;
	state.renderedConversationPatchShellSignature = "";
	$("connectionState").classList.remove("error");
	$("connectionState").textContent = message || "Refreshing Codex Mobile plugin session...";
	publishPluginNavigationState({ force: true });
}
function showLogin(message = "") {
	if (isHermesEmbedMode$1()) {
		showPluginEmbedAuthError(message);
		return;
	}
	$("app").classList.add("hidden");
	$("login").classList.remove("hidden");
	$("loginError").textContent = message;
}
function turnDisplaySortPhase(turn) {
	if (isRunningStatus(turn && turn.status) && !isTurnComplete(turn)) return 2;
	if (isTurnComplete(turn)) return 1;
	return 0;
}
function turnDisplaySortTimestampMs(value) {
	if (value === null || value === void 0 || value === "") return 0;
	const numberValue = Number(value);
	if (Number.isFinite(numberValue) && numberValue > 0) return numberValue > 0xe8d4a51000 ? Math.trunc(numberValue) : Math.trunc(numberValue * 1e3);
	const parsed = Date.parse(String(value));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
function turnDisplayItemTimestampMs(item) {
	if (!item || typeof item !== "object") return 0;
	for (const field of [
		"createdAtMs",
		"createdAt",
		"created_at_ms",
		"created_at",
		"startedAtMs",
		"startedAt",
		"started_at_ms",
		"started_at",
		"updatedAtMs",
		"updatedAt",
		"updated_at_ms",
		"updated_at",
		"timestampMs",
		"timestamp",
		"mobileDisplayTimestampMs",
		"mobileDisplayTimestamp",
		"completedAtMs",
		"completedAt",
		"completed_at_ms",
		"completed_at"
	]) {
		const timestamp = turnDisplaySortTimestampMs(item[field]);
		if (timestamp) return timestamp;
	}
	return 0;
}
function turnDisplayItemTimestampRange(turn) {
	const timestamps = (Array.isArray(turn && turn.items) ? turn.items : []).map(turnDisplayItemTimestampMs).filter((timestamp) => timestamp > 0);
	return {
		first: timestamps.length ? Math.min(...timestamps) : 0,
		last: timestamps.length ? Math.max(...timestamps) : 0
	};
}
function turnDisplayStartMs(turn) {
	if (!turn || typeof turn !== "object") return 0;
	for (const field of [
		"startedAtMs",
		"startedAt",
		"started_at_ms",
		"started_at",
		"createdAtMs",
		"createdAt",
		"created_at_ms",
		"created_at",
		"mobileDisplayTimestampMs",
		"mobileDisplayTimestamp",
		"updatedAtMs",
		"updatedAt",
		"updated_at_ms",
		"updated_at",
		"completedAtMs",
		"completedAt",
		"completed_at_ms",
		"completed_at"
	]) {
		const timestamp = turnDisplaySortTimestampMs(turn[field]);
		if (timestamp) return timestamp;
	}
	return 0;
}
function turnDisplayActivityMs(turn) {
	const orderMs = turnDisplayStartMs(turn) || turnOrderMs(turn);
	const range = turnDisplayItemTimestampRange(turn);
	if (isTurnComplete(turn)) return orderMs || range.first || range.last;
	return Math.max(orderMs, range.last, range.first);
}
function sortTurnsForDisplay(turns) {
	return (turns || []).slice().sort((leftTurn, rightTurn) => {
		const leftActivity = turnDisplayActivityMs(leftTurn);
		const rightActivity = turnDisplayActivityMs(rightTurn);
		if (leftActivity !== rightActivity) return leftActivity - rightActivity;
		const leftPhase = turnDisplaySortPhase(leftTurn);
		const rightPhase = turnDisplaySortPhase(rightTurn);
		if (leftPhase !== rightPhase) return leftPhase - rightPhase;
		const left = turnOrderMs(leftTurn);
		const right = turnOrderMs(rightTurn);
		if (left !== right) return left - right;
		const leftRange = turnDisplayItemTimestampRange(leftTurn);
		const rightRange = turnDisplayItemTimestampRange(rightTurn);
		if (leftRange.first !== rightRange.first) return leftRange.first - rightRange.first;
		if (leftRange.last !== rightRange.last) return leftRange.last - rightRange.last;
		return String(leftTurn && leftTurn.id || "").localeCompare(String(rightTurn && rightTurn.id || ""));
	});
}
function maxVisibleTurnsForThread(thread) {
	if (isRawThreadReadMode(thread) && !thread.mobileHistoryExpanded) return MAX_RAW_THREAD_VISIBLE_TURNS;
	return thread && thread.mobileHistoryExpanded ? MAX_EXPANDED_VISIBLE_TURNS : MAX_VISIBLE_TURNS;
}
function threadTurnsCursorSignature(cursor) {
	if (!cursor) return "";
	try {
		return JSON.stringify(cursor);
	} catch (_) {
		return String(cursor || "");
	}
}
function pluginStartupLoadingText(message = "") {
	return String(message || "").trim() || "正在加载 Codex...";
}
function showPluginStartupLoading(message = "") {
	if (!isHermesEmbedMode$1()) return;
	state.pluginStartupLoading = true;
	state.pluginStartupMessage = pluginStartupLoadingText(message);
	document.documentElement.classList.add("plugin-startup-loading");
	const loading = $("pluginStartupLoading");
	if (loading) {
		loading.classList.remove("hidden");
		const title = loading.querySelector("[data-plugin-startup-title]");
		if (title) title.textContent = state.pluginStartupMessage;
	}
}
function hidePluginStartupLoading() {
	if (!isHermesEmbedMode$1()) return;
	state.pluginStartupLoading = false;
	state.pluginStartupMessage = "";
	document.documentElement.classList.remove("plugin-startup-loading");
	const loading = $("pluginStartupLoading");
	if (loading) loading.classList.add("hidden");
}
function showApp() {
	updateViewportVars();
	if (isHermesEmbedMode$1()) {
		document.documentElement.classList.add("embed-hermes");
		if (state.pluginStartupLoading) showPluginStartupLoading();
	}
	$("login").classList.add("hidden");
	$("app").classList.remove("hidden");
	updateComposerHeightVar();
	ensureAndroidBackToSidebarSentinel();
	publishPluginNavigationState();
}
async function login(key) {
	await fetch("/api/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ key })
	}).then(async (res) => {
		if (!res.ok) throw new Error("Access key is not valid");
	});
	setAuthKey(key);
	state.pluginLaunchSession = false;
	state.pluginSessionActive = false;
	localStorage.setItem("codexMobileKey", key);
	showApp();
	await bootstrap();
}
async function exchangePluginLaunchSession() {
	if (!isHermesEmbedMode$1() || !state.pluginLaunchSession || !state.key) return;
	const launchKey = String(state.key || "").trim();
	if (!launchKey) return;
	if (state.pluginLaunchExchangeCompletedKey === launchKey && state.pluginSessionActive) {
		state.pluginLaunchSession = false;
		scrubPluginLaunchUrl();
		return;
	}
	if (state.pluginLaunchExchangeKey === launchKey && state.pluginLaunchExchangePromise) return state.pluginLaunchExchangePromise;
	const exchangePromise = (async () => {
		const result = await api("/api/v1/hermes/plugin/session", {
			method: "POST",
			body: JSON.stringify({ codexPluginLaunch: launchKey }),
			timeoutMs: 12e3
		});
		if (!result || !result.session_key) throw new Error("Plugin session exchange failed");
		setAuthKey(result.session_key);
		const hermesOrigin = normalizePluginParentOrigin(result && result.hermes_origin);
		if (hermesOrigin) state.pluginParentOrigin = hermesOrigin;
		state.pluginLaunchTarget = result && result.target && typeof result.target === "object" ? result.target : null;
		applyPluginAppearancePreference(result && result.appearance);
		if (state.pluginLaunchTarget && state.pluginLaunchTarget.cwd && !state.currentThreadId) state.selectedCwd = String(state.pluginLaunchTarget.cwd || "").trim();
		state.pluginLaunchSession = false;
		state.pluginSessionActive = true;
		state.pluginLaunchExchangeCompletedKey = launchKey;
		scrubPluginLaunchUrl();
	})();
	state.pluginLaunchExchangeKey = launchKey;
	state.pluginLaunchExchangePromise = exchangePromise;
	try {
		await exchangePromise;
	} finally {
		if (state.pluginLaunchExchangePromise === exchangePromise) state.pluginLaunchExchangePromise = null;
	}
}
async function applyPluginLaunchTarget() {
	const target = state.pluginLaunchTarget && typeof state.pluginLaunchTarget === "object" ? state.pluginLaunchTarget : null;
	if (!target) return false;
	state.pluginLaunchTarget = null;
	const threadId = String(target.threadId || "").trim();
	if (threadId) {
		localStorage.setItem(STORAGE_THREAD_ID, threadId);
		clearThreadUrl();
		await loadThread(threadId, { source: "plugin-launch" });
		return true;
	}
	const cwd = String(target.cwd || "").trim();
	if (!cwd) return false;
	const workspace = state.workspaces.find((ws) => normalizeFsPath(ws.cwd) === normalizeFsPath(cwd));
	saveCurrentDraftNow();
	state.selectedCwd = workspace ? workspace.cwd : cwd;
	clearCurrentThreadSelection({ saveDraft: false });
	state.newThreadDraft = true;
	state.startupThreadOpenPending = false;
	restoreDraftForCurrentTarget();
	syncSidebarWorkspaceSelect();
	updateWorkspacePath();
	renderThreads();
	renderCurrentThread();
	updateComposerControls();
	return true;
}
async function bootstrap() {
	const bootstrapStartedAt = nowPerfMs();
	if (isHermesEmbedMode$1()) showPluginStartupLoading();
	const startupThreadId = applyUrlThreadSelection();
	const startupPluginRouteHint = applyUrlPluginRouteHint();
	const savedThreadId = isHermesEmbedMode$1() ? "" : localStorage.getItem(STORAGE_THREAD_ID) || "";
	const deferStartupRestoreForTileMode = Boolean(savedThreadId && !startupThreadId && typeof localThreadDisplayMode === "function" && localThreadDisplayMode() === "tile");
	state.startupThreadOpenPending = Boolean(startupThreadId || savedThreadId && !deferStartupRestoreForTileMode || startupPluginRouteHint && startupPluginRouteHint.threadId);
	const startupThreadOpenPending = state.startupThreadOpenPending;
	postStartupStage("bootstrap_start", bootstrapStartedAt, {
		hasStartupThreadId: Boolean(startupThreadId),
		hasSavedThreadId: Boolean(savedThreadId),
		hasPluginRouteThreadId: Boolean(startupPluginRouteHint && startupPluginRouteHint.threadId),
		deferStartupRestoreForTileMode
	});
	const earlyRestorePromise = savedThreadId && !startupThreadId && !deferStartupRestoreForTileMode ? loadThread(savedThreadId, {
		source: "restore-startup",
		suppressLoadFailureDiagnostic: true
	}).catch((err) => {
		localStorage.removeItem(STORAGE_THREAD_ID);
		showError(err);
		renderCurrentThread();
		return null;
	}) : null;
	if (earlyRestorePromise) postStartupStage("restore_start", bootstrapStartedAt, { threadId: savedThreadId });
	else if (deferStartupRestoreForTileMode) postStartupStage("restore_deferred", bootstrapStartedAt, {
		threadId: savedThreadId,
		reason: "tile-startup"
	});
	const statusStartedAt = nowPerfMs();
	const status = await api("/api/status").catch((err) => {
		$("connectionState").textContent = err.message;
		$("connectionState").classList.add("error");
		return null;
	});
	postStartupStage("status_done", bootstrapStartedAt, {
		durationMs: roundedDurationMs(statusStartedAt),
		ok: Boolean(status)
	});
	if (status) updateConnectionState(status);
	if (status) rememberRateLimitsFromConfig(status);
	if (status && status.codexProfiles) rememberCodexProfiles(status.codexProfiles);
	const workspacesStartedAt = nowPerfMs();
	await loadWorkspaces();
	postStartupStage("workspaces_done", bootstrapStartedAt, {
		durationMs: roundedDurationMs(workspacesStartedAt),
		workspaceCount: Array.isArray(state.workspaces) ? state.workspaces.length : 0
	});
	const threadDisplayStartedAt = nowPerfMs();
	await loadThreadDisplaySettings({ render: false }).catch(showError);
	postStartupStage("thread_display_done", bootstrapStartedAt, {
		durationMs: roundedDurationMs(threadDisplayStartedAt),
		mode: state.threadTileMode ? "tile" : "single",
		paneCount: normalizeThreadTilePaneCount(state.threadTilePaneCount, 0),
		paneSlotCount: normalizeThreadTilePinnedIds(state.threadTilePinnedIds).length
	});
	const threadsStartedAt = nowPerfMs();
	await loadThreads({
		silent: startupThreadOpenPending,
		deferFallback: true
	});
	postStartupStage("threads_done", bootstrapStartedAt, {
		durationMs: roundedDurationMs(threadsStartedAt),
		threadCount: Array.isArray(state.threads) ? state.threads.length : 0
	});
	let appliedPluginLaunchTarget = false;
	let appliedPluginRouteHint = false;
	try {
		appliedPluginLaunchTarget = await applyPluginLaunchTarget();
		if (!appliedPluginLaunchTarget) appliedPluginRouteHint = await openHermesPluginRouteHint(state.queuedPluginRouteHint);
	} catch (err) {
		showError(err);
	}
	if (!appliedPluginLaunchTarget && !appliedPluginRouteHint && startupThreadId) try {
		await openExternalThreadSelection(startupThreadId, { statusMessage: "Opening linked thread" });
	} catch (err) {
		showError(err);
	} finally {
		state.startupThreadOpenPending = false;
	}
	else if (!appliedPluginLaunchTarget && !appliedPluginRouteHint) if (earlyRestorePromise) await earlyRestorePromise;
	else await restoreThreadSelection();
	else state.startupThreadOpenPending = false;
	connectEvents();
	postStartupStage("bootstrap_done", bootstrapStartedAt, { hasCurrentThread: Boolean(state.currentThread) });
	scheduleStartupUpdateCheck();
	scheduleStartupPublicPrCheck();
	initializePushControls().catch((err) => {
		state.pushError = err.message || String(err);
		updatePushButton();
	});
	hidePluginStartupLoading();
}
function threadIdFromUrlValue(value) {
	try {
		const url = new URL(value || window.location.href, window.location.origin);
		return String(url.searchParams.get("thread") || "").trim();
	} catch (_) {
		return "";
	}
}
function normalizePluginRouteHint$1(value) {
	return pluginEmbedApi.normalizeRouteHint(value);
}
function pluginRouteHintFromUrl(value) {
	try {
		return pluginEmbedApi.routeHintFromUrl(value || window.location.href);
	} catch (_) {
		return null;
	}
}
function pluginRouteHintTargetId(hint) {
	return pluginEmbedApi.routeHintTargetId(hint);
}
function setPluginRouteDiagnostic(message, options = {}) {
	const text = String(message || "").trim().slice(0, 240);
	if (!text) return;
	$("connectionState").textContent = text;
	$("connectionState").classList.toggle("error", options.error !== false);
}
function clearThreadUrl() {
	try {
		window.history.replaceState({}, "", isHermesEmbedMode$1() ? pluginRootPath() : window.location.pathname || "/");
	} catch (_) {}
}
function findPluginRouteTargetNode(hint) {
	const conversation = $("conversation");
	if (!conversation) return null;
	return pluginEmbedApi.findRouteHintTargetNode(conversation, hint, { escapeSelector: escapeSelectorAttr });
}
function focusPluginRouteTargetNode(hint) {
	const node = findPluginRouteTargetNode(hint);
	if (!node) return false;
	markProgrammaticConversationScroll();
	if (typeof node.scrollIntoView === "function") node.scrollIntoView({
		block: "center",
		inline: "nearest"
	});
	scheduleScrollToBottomButtonUpdate();
	return true;
}
function applyPendingPluginRouteHintFocus() {
	const hint = normalizePluginRouteHint$1(state.pendingPluginRouteHint);
	if (!hint) return false;
	const node = findPluginRouteTargetNode(hint);
	const plan = pluginEmbedApi.routeHintFocusPlan(hint, {
		currentThreadId: state.currentThreadId,
		targetFound: Boolean(node)
	});
	if (!plan || plan.action === "ignore" || plan.action === "wait") return false;
	if (plan.action === "clear") {
		state.pendingPluginRouteHint = null;
		return false;
	}
	if (plan.action === "focused") {
		focusPluginRouteTargetNode(hint);
		state.pendingPluginRouteHint = null;
		if (plan.diagnostic) setPluginRouteDiagnostic(plan.diagnostic.message, { error: plan.diagnostic.error });
		recordHomeAiDiagnosticSuccess({
			category: "thread_session_load_failed",
			diagnostic_type: "route_hint_target_missing",
			error_code: "route_hint_target_missing",
			context: {
				surface: "thread-session",
				action: "route-hint-focus",
				route_kind: "plugin-route",
				thread_hash: diagnosticThreadHash(hint.threadId || hint.pluginThreadId || state.currentThreadId),
				task_hash: diagnosticTaskHash(hint.taskId || hint.pluginTaskId || ""),
				item_hash: diagnosticItemHash(hint.itemId || hint.pluginItemId || "")
			}
		});
		return true;
	}
	state.pendingPluginRouteHint = null;
	showHermesPluginPrimaryPage({
		force: true,
		source: "route-hint-target-missing"
	});
	if (plan.diagnostic) setPluginRouteDiagnostic(plan.diagnostic.message, { error: plan.diagnostic.error });
	recordHomeAiDiagnosticFailure({
		category: "thread_session_load_failed",
		diagnostic_type: "route_hint_target_missing",
		severity_hint: "H2",
		evidence_confidence: .78,
		error_code: "route_hint_target_missing",
		context: {
			surface: "thread-session",
			action: "route-hint-focus",
			route_kind: "plugin-route",
			thread_hash: diagnosticThreadHash(hint.threadId || hint.pluginThreadId || state.currentThreadId),
			task_hash: diagnosticTaskHash(hint.taskId || hint.pluginTaskId || ""),
			item_hash: diagnosticItemHash(hint.itemId || hint.pluginItemId || "")
		},
		counts: { missing_count: 1 },
		breadcrumbs: [{
			kind: "thread-session",
			code: "route-hint-focus",
			status: "failed",
			fields: {
				route_kind: "plugin-route",
				thread_hash: diagnosticThreadHash(hint.threadId || hint.pluginThreadId || state.currentThreadId),
				task_hash: diagnosticTaskHash(hint.taskId || hint.pluginTaskId || ""),
				item_hash: diagnosticItemHash(hint.itemId || hint.pluginItemId || "")
			}
		}]
	});
	return false;
}
async function openExternalThreadSelection(threadId, options = {}) {
	const id = String(threadId || "").trim();
	if (!id) return;
	localStorage.setItem(STORAGE_THREAD_ID, id);
	clearThreadUrl();
	if (!state.key) return;
	$("connectionState").classList.remove("error");
	$("connectionState").textContent = String(options.statusMessage || "Opening notification thread");
	if (!state.workspaces.length) try {
		await loadWorkspaces();
	} catch (_) {}
	await loadThread(id, {
		source: String(options.source || "external").slice(0, 40),
		suppressLoadFailureDiagnostic: options.suppressLoadFailureDiagnostic === true
	});
}
async function openHermesPluginRouteHint(hint) {
	const plan = pluginEmbedApi.routeHintOpenPlan(hint);
	if (!plan || plan.action === "ignore") return false;
	state.queuedPluginRouteHint = null;
	clearThreadUrl();
	if (plan.action === "primary") {
		if (plan.diagnostic) setPluginRouteDiagnostic(plan.diagnostic.message, { error: plan.diagnostic.error });
		showHermesPluginPrimaryPage({
			force: true,
			source: "route-hint-primary"
		});
		return true;
	}
	try {
		state.pendingPluginRouteHint = plan.pendingHint || null;
		await openExternalThreadSelection(plan.threadId, {
			statusMessage: plan.statusMessage,
			source: "route-hint",
			suppressLoadFailureDiagnostic: true
		});
		if (!plan.targetId) setPluginRouteDiagnostic("Opened notification thread", { error: false });
		else applyPendingPluginRouteHintFocus();
		recordHomeAiDiagnosticSuccess({
			category: "thread_session_load_failed",
			diagnostic_type: "route_hint_thread_unavailable",
			error_code: "route_hint_thread_unavailable",
			context: {
				surface: "thread-session",
				action: "route-hint-open",
				route_kind: "plugin-route",
				thread_hash: diagnosticThreadHash(plan.threadId || hint.threadId || hint.pluginThreadId || "")
			}
		});
		return true;
	} catch (error) {
		state.pendingPluginRouteHint = null;
		showHermesPluginPrimaryPage({
			force: true,
			source: "route-hint-open-failed"
		});
		setPluginRouteDiagnostic(plan.targetId ? "Notification target is unavailable" : "Notification thread is unavailable", { error: true });
		recordHomeAiDiagnosticFailure({
			category: "thread_session_load_failed",
			diagnostic_type: plan.targetId ? "route_hint_target_unavailable" : "route_hint_thread_unavailable",
			severity_hint: "H2",
			evidence_confidence: .78,
			error_code: diagnosticErrorCode(error, plan.targetId ? "route_hint_target_unavailable" : "route_hint_thread_unavailable"),
			context: {
				surface: "thread-session",
				action: "route-hint-open",
				route_kind: "plugin-route",
				thread_hash: diagnosticThreadHash(plan.threadId || hint.threadId || hint.pluginThreadId || ""),
				task_hash: diagnosticTaskHash(hint.taskId || hint.pluginTaskId || ""),
				item_hash: diagnosticItemHash(hint.itemId || hint.pluginItemId || "")
			},
			counts: { status_code: diagnosticErrorStatus(error) },
			breadcrumbs: [{
				kind: "thread-session",
				code: "route-hint-open",
				status: "failed",
				fields: {
					status_code: diagnosticErrorStatus(error),
					route_kind: "plugin-route",
					thread_hash: diagnosticThreadHash(plan.threadId || hint.threadId || hint.pluginThreadId || "")
				}
			}]
		});
		return true;
	}
}
function applyUrlPluginRouteHint(options = {}) {
	if (!isHermesEmbedMode$1()) return null;
	try {
		const hint = pluginRouteHintFromUrl(window.location.href);
		if (!hint || hint.pluginId !== "codex-mobile") return null;
		state.queuedPluginRouteHint = hint;
		clearThreadUrl();
		if (options.load) openHermesPluginRouteHint(hint).catch(showError);
		return hint;
	} catch (_) {
		return null;
	}
}
function applyUrlThreadSelection(options = {}) {
	try {
		const threadId = threadIdFromUrlValue(window.location.href);
		if (!threadId) return "";
		localStorage.setItem(STORAGE_THREAD_ID, threadId);
		clearThreadUrl();
		if (options.load) if (threadId === state.currentThreadId && state.currentThread && !state.currentThread.mobileLoadError) scheduleCurrentThreadRefresh(250);
		else openExternalThreadSelection(threadId).catch(showError);
		return threadId;
	} catch (_) {}
	return "";
}
function handleServiceWorkerMessage(event) {
	const data = event && event.data ? event.data : {};
	if (!data || data.type !== "codex-open-thread") return;
	openExternalThreadSelection(data.threadId || threadIdFromUrlValue(data.url)).catch(showError);
}
function createNotificationUiRuntime() {
	return {
		handlePluginVoiceInputMessage: typeof handlePluginVoiceInputMessage === "function" ? handlePluginVoiceInputMessage : null,
		requestHermesPluginRefresh: typeof requestHermesPluginRefresh$1 === "function" ? requestHermesPluginRefresh$1 : null,
		showPluginEmbedRecovering: typeof showPluginEmbedRecovering === "function" ? showPluginEmbedRecovering : null,
		showLogin: typeof showLogin === "function" ? showLogin : null,
		showApp: typeof showApp === "function" ? showApp : null,
		bootstrap: typeof bootstrap === "function" ? bootstrap : null
	};
}
var notificationUiRuntimeApi = { createNotificationUiRuntime };
Object.assign(root, {
	applyPendingPluginRouteHintFocus,
	applyPluginLaunchTarget,
	applyPluginVoiceInputProvisionalText,
	applyPluginVoiceInputTextMessage,
	applyUrlPluginRouteHint,
	applyUrlThreadSelection,
	bootstrap,
	boundedPluginRefreshValue,
	boundedViewportNumber,
	clearPluginRefreshPendingNotice,
	clearPluginVoiceInputPress,
	clearPluginVoiceInputProvisionalSession,
	clearThreadUrl,
	commitPluginVoiceInputSessionsAfterSend,
	currentHermesRefreshRoute,
	currentPluginParentWindowOrigin,
	currentPluginVoiceInputDraftKey,
	exchangePluginLaunchSession,
	findPluginRouteTargetNode,
	focusPluginRouteTargetNode,
	handleHermesPluginViewportMessage,
	handlePluginVoiceInputMessage,
	handlePluginVoiceInputSendClick,
	handlePluginVoiceInputSendPointerCancel,
	handlePluginVoiceInputSendPointerDown,
	handlePluginVoiceInputSendPointerUp,
	handleServiceWorkerMessage,
	hidePluginStartupLoading,
	isHermesEmbedMode: isHermesEmbedMode$1,
	login,
	maxVisibleTurnsForThread,
	normalizeHermesPluginViewportMessage,
	normalizeHermesPluginViewportRect,
	normalizePluginParentOrigin,
	normalizePluginRouteHint: normalizePluginRouteHint$1,
	openExternalThreadSelection,
	openHermesPluginRouteHint,
	persistPluginVoiceInputDraft,
	pluginRefreshPendingMessage,
	pluginRefreshReasonForApiError,
	pluginRootPath,
	pluginRouteHintFromUrl,
	pluginRouteHintTargetId,
	pluginStartupLoadingText,
	pluginVoiceInputActiveTurnHoldAvailable,
	pluginVoiceInputAppendText,
	pluginVoiceInputCanReceiveText,
	pluginVoiceInputCapabilityPayload,
	pluginVoiceInputComposerId,
	pluginVoiceInputComposerWritable,
	pluginVoiceInputEnsureComposerWritableForDraft,
	pluginVoiceInputGestureAvailable,
	pluginVoiceInputParentOriginAllowed,
	pluginVoiceInputSafeDraftId,
	pluginVoiceInputSessionIdFromPayload,
	postPluginVoiceInputMessage,
	publishPluginVoiceInputCapability,
	rejectPluginVoiceInputInsert,
	rememberPluginVoiceInputSession,
	renderPluginRefreshPendingNotice,
	requestHermesPluginRefresh: requestHermesPluginRefresh$1,
	restorePluginVoiceInputProvisionalBase,
	scrubPluginLaunchUrl,
	setComposerActionButtonLabel,
	setPluginRouteDiagnostic,
	showApp,
	showLogin,
	showPluginEmbedAuthError,
	showPluginEmbedRecovering,
	showPluginStartupLoading,
	sortTurnsForDisplay,
	takePluginVoiceInputSessionsForDraft,
	threadIdFromUrlValue,
	threadTurnsCursorSignature,
	turnDisplayActivityMs,
	turnDisplayItemTimestampMs,
	turnDisplayItemTimestampRange,
	turnDisplaySortPhase,
	turnDisplaySortTimestampMs
});
root.CodexNotificationUiRuntime = notificationUiRuntimeApi;
//#endregion
//#region frontend/native/conversation-render-runtime.mjs
function renderLiveOperationDock(thread, previousKeys = /* @__PURE__ */ new Set()) {
	const entry = currentLiveOperationEntry(thread);
	if (!entry) return "";
	const expanded = normalizeLiveOperationDockMode(state.liveOperationDockMode) === "expanded";
	return `<div class="live-operation-dock-inner">
    ${entry.item && entry.item.type !== "liveTurnStatus" ? renderMobileOperationStack(entry.item, entry.turn, previousKeys, entry.sourceIndex, expanded) : ""}
    <div class="live-operation-dock-desktop">
      <div class="live-operation-dock-controls">
        <button type="button" data-live-operation-dock-toggle aria-expanded="${String(expanded)}" title="${expanded ? "收起 Command 框" : "展开 Command 框"}" aria-label="${expanded ? "收起 Command 框" : "展开 Command 框"}">${expanded ? "↓" : "↑"}</button>
      </div>
      ${renderLiveOperation(entry.item, entry.turn, previousKeys, entry.sourceIndex)}
    </div>
  </div>`;
}
function renderTurnVisibleItemBudgetNotice(turn, previousKeys = /* @__PURE__ */ new Set()) {
	const budget = visibleItemBudgetForTurn(turn);
	if (!budget) return "";
	const key = stableTurnKey(turn, "visible-budget");
	const label = budget.omitted === 1 ? "已折叠 1 条首屏操作细节" : `已折叠 ${budget.omitted} 条首屏操作细节`;
	const detailParts = [];
	if (budget.retained) detailParts.push(`保留 ${budget.retained}`);
	if (budget.original) detailParts.push(`原始 ${budget.original}`);
	if (budget.ceiling) detailParts.push(`上限 ${budget.ceiling}`);
	const detail = detailParts.join(" / ");
	return `<div class="turn-visible-budget-note${entryAnimationClass(key, previousKeys)}" data-render-key="${escapeHtml(key)}" data-visible-item-budget="${escapeHtml(String(budget.omitted))}">
    <span>${escapeHtml(label)}</span>
    ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
  </div>`;
}
function renderTurn(turn, previousKeys = /* @__PURE__ */ new Set()) {
	const thread = renderContextThread();
	const renderedItems = visibleItemsForTurn(turn, thread).map((entry, index) => {
		const item = entry.item;
		const sourceIndex = Number.isInteger(entry.sourceIndex) && entry.sourceIndex >= 0 ? entry.sourceIndex : index;
		let html = "";
		html = renderVisibleItemPatchHtml(turn, item, previousKeys, sourceIndex, thread);
		return {
			html,
			sourceIndex,
			order: 1
		};
	}).filter((entry) => entry && entry.html);
	const budgetNoticeHtml = renderTurnVisibleItemBudgetNotice(turn, previousKeys);
	const items = renderedItems.sort((a, b) => a.sourceIndex - b.sourceIndex || a.order - b.order).map((entry) => entry.html).join("");
	const threadId = renderContextThreadId();
	const turnApprovals = approvalsForTurn(threadId, turn.id);
	const approvalsHtml = turnApprovals.length ? `<div class="approval-stack in-turn">${turnApprovals.map((request) => renderApprovalRequest(request, previousKeys, threadId)).join("")}</div>` : "";
	const draftHtml = renderTurnThreadTaskCardDraft(turn, previousKeys, thread);
	const pendingDraftHtml = !draftHtml && !turnHasThreadTaskCardDraftResponse(turn) && isLatestTurn(turn, thread) && isLiveTurn(turn, thread) && turnHasThreadTaskCardRequest(turn) ? renderPendingThreadTaskCardDraft("Generating cross-thread task card draft...", "Generating") : "";
	if (!budgetNoticeHtml.trim() && !items.trim() && !approvalsHtml.trim() && !draftHtml.trim() && !pendingDraftHtml.trim()) return "";
	const turnKey = stableTurnKey(turn);
	const statusKey = stableTurnKey(turn, "status");
	const duration = turn.durationMs ? ` | ${formatElapsedTime(Math.round(turn.durationMs / 1e3))}` : "";
	const showStatusLine = !(isLatestTurn(turn, thread) && (isLiveTurn(turn, thread) || turnFinalSeconds(turn) != null));
	return `<article class="turn" data-turn="${escapeHtml(turn.id)}" data-render-key="${escapeHtml(turnKey)}">
    ${budgetNoticeHtml}${items}${approvalsHtml}
    ${showStatusLine ? `<div class="turn-status${entryAnimationClass(statusKey, previousKeys)}" data-render-key="${escapeHtml(statusKey)}">${escapeHtml(displayTurnStatus(turn))}${duration}</div>` : ""}
    ${draftHtml}${pendingDraftHtml}
  </article>`;
}
function renderLiveOperation(item, turn, previousKeys = /* @__PURE__ */ new Set(), index = 0) {
	const status = item && item.type === "liveTurnStatus" ? "" : statusText(item.status) || (item.completedAtMs ? "completed" : "running");
	return renderOperationCard(item, stableOperationRenderKey(turn, item, index), { status });
}
function renderOperationCard(item, key, options = {}) {
	const status = options.status || statusText(item.status) || (item.completedAtMs ? "completed" : "running");
	const type = options.type || item.type || "item";
	const title = operationTitle(item);
	const detail = operationDetailText(item);
	const durationData = operationDurationData(item, status);
	return liveOperationDockPolicy.operationCardHtml({
		itemId: item && item.id || "",
		type,
		status,
		title,
		detail,
		durationText: durationData && durationData.text || "",
		durationAttrs: durationData ? operationDurationAttrs(durationData) : "",
		extraClass: options.extraClass || "",
		renderKey: key,
		escapeHtml
	});
}
function operationDurationHtml(item, status = "", className = "operation-duration") {
	const durationData = operationDurationData(item, status);
	return durationData ? `<time class="${escapeHtml(className)}" ${operationDurationAttrs(durationData)} title="${escapeHtml(`Elapsed ${durationData.text}`)}">${escapeHtml(durationData.text)}</time>` : "";
}
function operationBubbleSummary(item) {
	return truncateSingleLine$1(operationSummaryLines(item).filter(Boolean).join(" | "), 52);
}
function renderMobileOperationStack(item, turn, previousKeys = /* @__PURE__ */ new Set(), index = 0, expanded = false, options = {}) {
	const status = statusText(item.status) || (item.completedAtMs ? "completed" : "running");
	const key = stableOperationRenderKey(turn, item, index);
	const title = operationTitle(item);
	const summary = operationBubbleSummary(item);
	const duration = operationDurationHtml(item, status, "operation-duration mobile-operation-bubble-duration");
	const toggleName = String(options.toggleAttribute || "data-live-operation-dock-toggle").trim();
	const toggleValue = String(options.toggleValue || "");
	const toggleAttr = toggleName ? `${escapeHtml(toggleName)}${toggleValue ? `="${escapeHtml(toggleValue)}"` : ""}` : "data-live-operation-dock-toggle";
	return `<div class="mobile-operation-stack">
    <div class="mobile-operation-sheet" role="region" aria-label="Command 详情">
      ${renderOperationCard(item, key, {
		status,
		extraClass: "mobile-operation-sheet-card"
	})}
    </div>
    <button class="mobile-operation-bubble" type="button" ${toggleAttr} aria-expanded="${String(expanded)}" title="${expanded ? "收起 Command 框" : "展开 Command 框"}" aria-label="${expanded ? "收起 Command 框" : "展开 Command 框"}">
      <span class="mobile-operation-bubble-title">${escapeHtml(title)}</span>
      ${summary ? `<span class="mobile-operation-bubble-summary">${escapeHtml(summary)}</span>` : ""}
      ${duration}
    </button>
  </div>`;
}
function operationTitle(item) {
	if (item && item.title) return item.title;
	return labelForItem(item);
}
function operationDetailText(item) {
	return operationSummaryLines(item).filter(Boolean).join(" | ");
}
function truncateSingleLine$1(value, maxChars = 96) {
	const text = String(value || "").replace(/\s+/g, " ").trim();
	if (text.length <= maxChars) return text;
	return `${text.slice(0, Math.max(0, maxChars - 1))}...`;
}
function normalizeOperationIdentityValue(value) {
	return String(value || "").replace(/\\/g, "/").replace(/\s+/g, " ").trim().toLowerCase();
}
function stripMatchingOuterQuotes(value) {
	const text = String(value || "").trim();
	if (text.length >= 2) {
		const first = text[0];
		const last = text[text.length - 1];
		if (first === "\"" && last === "\"" || first === "'" && last === "'") return text.slice(1, -1).trim();
	}
	return text;
}
function operationArgumentsObject(item) {
	const value = item && item.arguments;
	if (!value) return null;
	if (typeof value === "object" && !Array.isArray(value)) return value;
	if (typeof value !== "string") return null;
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
function operationCommandText(item) {
	const direct = Array.isArray(item && item.command) ? item.command.join(" ") : String(item && item.command || "");
	if (direct.trim()) return direct;
	const args = operationArgumentsObject(item);
	return String(args && (args.command || args.cmd || args.shellCommand || args.shell_command) || "");
}
function operationCommandSummary(item) {
	const raw = operationCommandText(item).replace(/\s+/g, " ").trim();
	if (!raw) return "";
	const commandMatch = raw.match(/(?:^|\s)-(?:Command|c)\s+([\s\S]+)$/i);
	if (commandMatch && /(?:powershell|pwsh)(?:\.exe)?/i.test(raw.slice(0, commandMatch.index + commandMatch[0].length))) {
		const script = stripMatchingOuterQuotes(commandMatch[1]);
		if (script) return truncateSingleLine$1(script, 180);
	}
	if (/(?:^|\s)-(?:EncodedCommand|enc|e)\b/i.test(raw) && /(?:powershell|pwsh)(?:\.exe)?/i.test(raw)) return "PowerShell -EncodedCommand";
	return truncateSingleLine$1(raw, 180);
}
function operationCommandName(item) {
	const raw = operationCommandText(item).trim();
	if (!raw) return "";
	const quoted = raw.match(/^["']([^"']+)["']/);
	const token = quoted ? quoted[1] : raw.split(/\s+/, 1)[0];
	return shortPath(stripMatchingOuterQuotes(token)) || stripMatchingOuterQuotes(token);
}
function operationCommandGroupText(item) {
	return operationCommandName(item);
}
function operationRawFileNames(item) {
	const values = Array.isArray(item.fileNames) && item.fileNames.length ? item.fileNames : collectFileNames(item.changes || item.arguments || item.result || item.contentItems);
	return [...new Set(values.map((name) => String(name || "").trim()).filter(Boolean))].slice(0, 5);
}
function operationFileNames(item) {
	return operationRawFileNames(item).map((name) => truncateSingleLine$1(shortPath(name), 72)).filter(Boolean);
}
function operationGroupKey(item) {
	if (!item || !isOperationalItem(item)) return "";
	const type = isWebSearchLikeItem(item) ? "webSearch" : item.type || "item";
	const fileNames = operationRawFileNames(item).map(normalizeOperationIdentityValue).filter(Boolean).sort();
	if (fileNames.length) return `${type}:files:${stableTextHash(fileNames.join("|"))}`;
	if (operationCommandText(item)) return `${type}:command:${stableTextHash(normalizeOperationIdentityValue(operationCommandGroupText(item)))}`;
	const searchSummary = isWebSearchLikeItem(item) ? operationSearchSummary(item) : "";
	if (searchSummary) return `${type}:search:${stableTextHash(normalizeOperationIdentityValue(searchSummary))}`;
	const toolParts = [
		item.server,
		item.namespace,
		item.tool
	].map(normalizeOperationIdentityValue).filter(Boolean);
	if (toolParts.length) return `${type}:tool:${stableTextHash(toolParts.join("|"))}`;
	const detail = operationDetailText(item);
	if (detail) return `${type}:detail:${stableTextHash(normalizeOperationIdentityValue(detail))}`;
	return item.id ? `${type}:item:${item.id}` : "";
}
function collectSearchSummaries(value, out = [], keyHint = "") {
	if (out.length >= 3 || value == null) return out;
	const keyLooksSearch = /^(q|query|searchQuery|url|pattern)$/i.test(keyHint);
	const keyLooksQueryList = /^queries$/i.test(keyHint);
	if (typeof value === "string") {
		const text = value.replace(/\s+/g, " ").trim();
		if ((keyLooksSearch || keyLooksQueryList) && text) out.push(text);
		return out;
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			collectSearchSummaries(entry, out, keyLooksQueryList ? "query" : keyHint);
			if (out.length >= 3) return out;
		}
		return out;
	}
	if (typeof value === "object") for (const [key, entry] of Object.entries(value)) {
		collectSearchSummaries(entry, out, key);
		if (out.length >= 3) return out;
	}
	return out;
}
function operationSearchSummary(item) {
	return [...new Set(collectSearchSummaries(item && (item.action || item.arguments || item.result || item.contentItems || item)))].slice(0, 3).join(" | ");
}
function operationSummaryLines(item) {
	if (item.type === "liveTurnStatus") return item.detail ? [item.detail] : [];
	if (item.type === "fileChange") {
		const names = operationFileNames(item);
		return names.length ? [names.join(", ")] : [];
	}
	if (operationCommandText(item)) return [operationCommandSummary(item)];
	const searchSummary = isWebSearchLikeItem(item) ? operationSearchSummary(item) : "";
	if (searchSummary) return [truncateMiddle(searchSummary, 180, "search")];
	const names = operationFileNames(item);
	if (names.length) return [names.join(", ")];
	if (item.tool) return [item.tool];
	return [];
}
function displayTurnStatus(turn) {
	if (isIncompleteInterruptedTurn(turn)) return "syncing";
	return statusText(turn.status);
}
function renderContextCompaction(item, turn = null, previousKeys = /* @__PURE__ */ new Set(), index = 0, thread = null) {
	const notice = contextCompactionNotice(item, turn, thread);
	if (!notice) return "";
	const key = stableItemKey(turn, item, index, "context");
	return `<div class="context-compaction-note${entryAnimationClass(key, previousKeys)}" data-item="${escapeHtml(item.id || "")}" data-render-key="${escapeHtml(key)}">${escapeHtml(notice)}</div>`;
}
function renderItem(item, turn = null, previousKeys = /* @__PURE__ */ new Set(), index = 0, thread = null) {
	const contextThread = renderContextThread(thread);
	if (isContextCompactionItem(item)) return renderContextCompaction(item, turn, previousKeys, index, contextThread);
	if (isLiveReasoning(item, turn, contextThread)) return "";
	const type = item.type || "item";
	const key = stableItemKey(turn, item, index);
	if (item.type === "turnUsageSummary") return `<section class="item${entryAnimationClass(key, previousKeys)} turnUsageSummary" data-item="${escapeHtml(item.id || "")}" data-render-key="${escapeHtml(key)}"${clientSubmissionDataAttr(item)}>
      <div class="item-body">${renderTurnUsageSummary(item)}</div>
    </section>`;
	const injectedTaskCardText = injectedThreadTaskCardTextForItem(item);
	if (injectedTaskCardText) return renderInjectedThreadTaskCardItem(item, turn, previousKeys, index, injectedTaskCardText, contextThread);
	const itemCopyKey = rememberCopyText(copyTextForItem(item));
	const itemCopyButton = copyButtonHtml(itemCopyKey, "复制全文", "item-copy-button", fullCopyAttrsForItem(item, turn, contextThread));
	const timestampHtml = renderItemTimestampHtml(item, turn, contextThread);
	return `<section class="item${entryAnimationClass(key, previousKeys)} ${escapeHtml(type)}" data-item="${escapeHtml(item.id || "")}" data-render-key="${escapeHtml(key)}"${clientSubmissionDataAttr(item)}>
    <div class="item-head">
      <span>${escapeHtml(labelForItem(item))}</span>
      <span class="item-head-actions">${timestampHtml}<span>${escapeHtml(item.status ? statusText(item.status) : "")}</span>${itemCopyButton}</span>
    </div>
    <div class="item-body">${renderItemBody(item, turn)}</div>
  </section>`;
}
function renderInjectedThreadTaskCardItem(item, turn = null, previousKeys = /* @__PURE__ */ new Set(), index = 0, text = "", thread = null) {
	const key = stableItemKey(turn, item, index);
	const metadata = injectedThreadTaskCardMetadata(text);
	const itemCopyKey = rememberCopyText(copyTextForItem(item));
	const itemCopyButton = copyButtonHtml(itemCopyKey, "复制全文", "item-copy-button", fullCopyAttrsForItem(item, turn, thread));
	const timestampHtml = renderItemTimestampHtml(item, turn, thread);
	return `<section class="item${entryAnimationClass(key, previousKeys)} thread-task-card-injected" data-item="${escapeHtml(item.id || "")}" data-render-key="${escapeHtml(key)}" data-thread-task-card-item>
    <div class="item-head thread-task-card-message-head">
      <span class="thread-task-card-message-heading">
        <span class="thread-task-card-message-source">来源：${escapeHtml(metadata.source)}</span>
        <span class="thread-task-card-message-purpose">目的：${escapeHtml(metadata.purpose)}</span>
      </span>
      <span class="item-head-actions">${timestampHtml}${itemCopyButton}</span>
    </div>
    <div class="item-body">${renderInjectedThreadTaskCardBody(text, metadata)}</div>
  </section>`;
}
function renderItemTimestampHtml(item, turn = null, thread = null) {
	const timestampMs = itemTimestampMs(item, turn, thread);
	if (!timestampMs) return "";
	const label = formatCardTimestamp(timestampMs, state.nowMs);
	if (!label) return "";
	const title = new Date(timestampMs).toLocaleString([], {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit"
	});
	return `<time class="item-timestamp" datetime="${escapeHtml(new Date(timestampMs).toISOString())}" title="${escapeHtml(title)}">${escapeHtml(label)}</time>`;
}
function itemTimestampMs(item, turn = null, thread = null) {
	if (!item) return 0;
	const contextThread = renderContextThread(thread);
	const itemStarted = numericTimestampMs(item.createdAtMs) || numericTimestampMs(item.createdAt) || numericTimestampMs(item.created_at_ms) || numericTimestampMs(item.created_at) || numericTimestampMs(item.startedAtMs) || numericTimestampMs(item.startedAt) || numericTimestampMs(item.started_at_ms) || numericTimestampMs(item.started_at) || numericTimestampMs(item.updatedAtMs) || numericTimestampMs(item.updatedAt) || numericTimestampMs(item.updated_at_ms) || numericTimestampMs(item.updated_at) || numericTimestampMs(item.timestampMs) || numericTimestampMs(item.timestamp) || numericTimestampMs(item.mobileDisplayTimestampMs) || numericTimestampMs(item.mobileDisplayTimestamp);
	if (itemStarted) return itemStarted;
	if (item.type === "agentMessage" || item.type === "plan") return numericTimestampMs(item.completedAtMs) || numericTimestampMs(item.completedAt) || numericTimestampMs(item.completed_at_ms) || numericTimestampMs(item.completed_at) || turnCompletedAtMs(turn, contextThread) || (isLiveTurn(turn, contextThread) ? 0 : turnStartedAtMs(turn)) || 0;
	if (isLiveTurn(turn, contextThread) && isOperationalItem(item)) return turnStartedAtMs(turn) || 0;
	return turnStartedAtMs(turn) || turnCompletedAtMs(turn, contextThread);
}
function turnStartedAtMs(turn) {
	if (!turn) return 0;
	return numericTimestampMs(turn.startedAtMs) || numericTimestampMs(turn.startedAt) || numericTimestampMs(turn.started_at_ms) || numericTimestampMs(turn.started_at) || numericTimestampMs(turn.createdAtMs) || numericTimestampMs(turn.createdAt) || numericTimestampMs(turn.created_at_ms) || numericTimestampMs(turn.created_at) || turnIdentityTimestampMs(turn);
}
function renderLiveReasoning(item, turn) {
	const elapsed = liveReasoningElapsed(item, turn);
	return `<section class="item live-reasoning reasoning" data-item="${escapeHtml(item.id || "")}">
    <div class="item-head"><span>Reasoning</span><span>${elapsed}s</span></div>
  </section>`;
}
function labelForItem(item) {
	if (isWebSearchLikeItem(item)) return "Web Search";
	return {
		userMessage: "You",
		agentMessage: "Codex",
		reasoning: "Reasoning",
		commandExecution: "Command",
		fileChange: "File Change",
		collabAgentToolCall: "协作 Agent",
		turnDiagnostic: "Diagnostic",
		imageView: "Image",
		imageGeneration: "Image",
		mcpToolCall: `MCP ${item.server || ""}.${item.tool || ""}`,
		dynamicToolCall: `${item.namespace ? item.namespace + "." : ""}${item.tool || "Tool"}`,
		plan: "Plan",
		contextCompaction: "Context",
		turnUsageSummary: "Usage"
	}[item.type] || item.type || "Item";
}
function copyTextForItem(item) {
	if (!item) return "";
	if (item.type === "userMessage") return copyTextForUserMessage(item);
	if (item.type === "agentMessage") return item.text || "";
	if (item.type === "turnDiagnostic") return [item.title, item.message].filter(Boolean).join("\n");
	return "";
}
function itemHasFullCopyTruncation(item) {
	if (!item || typeof item !== "object") return false;
	if (item.mobileTextTruncated === true) return Boolean(item.mobileFirstPaintTextBudget || item.mobileActiveTextBudget);
	return Boolean(item.mobileFirstPaintUserInputBudget);
}
function copyTextForUserMessage(item) {
	const values = [];
	const add = (value) => {
		const text = String(value || "").trim();
		if (text && !values.includes(text)) values.push(text);
	};
	add(item && item.text);
	add(item && item.message);
	add(item && item.input);
	add(item && item.input_text);
	const content = item && item.content;
	if (typeof content === "string") add(content);
	for (const part of Array.isArray(content) ? content : []) if (typeof part === "string") add(part);
	else if (isInputTextPart$1(part)) add(inputTextValue$1(part));
	return values.join("\n\n");
}
function fullCopyAttrsForItem(item, turn = null, thread = null) {
	const threadId = String(thread && thread.id || state.currentThreadId || "").trim();
	const turnId = String(turn && (turn.id || turn.turnId || turn.turn_id) || "").trim();
	const itemId = String(item && (item.id || item.itemId || item.item_id) || "").trim();
	if (!threadId || !itemId || !itemHasFullCopyTruncation(item)) return {};
	return {
		"data-full-copy-text": "true",
		"data-full-copy-thread-id": threadId,
		"data-full-copy-turn-id": turnId,
		"data-full-copy-item-id": itemId
	};
}
var mediaPreviewRuntime = null;
function requireMediaPreviewRuntime() {
	if (!mediaPreviewRuntime) mediaPreviewRuntime = mediaPreviewRuntimeApi.createMediaPreviewRuntime({
		state,
		$,
		document,
		window,
		fetch: window.fetch ? window.fetch.bind(window) : fetch,
		FileReader: window.FileReader,
		requestAnimationFrame: typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame.bind(window) : (callback) => window.setTimeout(callback, 16),
		CLIENT_BUILD_ID,
		FILE_PREVIEW_SWIPE_CLOSE_MIN_PX,
		GITHUB_LINK_PREVIEW_TIMEOUT_MS,
		IMAGE_DIAGNOSTICS_ENABLED,
		IMAGE_PREVIEW_MAX_SCALE,
		IMAGE_PREVIEW_MIN_SCALE,
		IMAGE_PREVIEW_ZOOM_STEP,
		MERMAID_MAX_SCALE,
		MERMAID_MIN_SCALE,
		MERMAID_SCRIPT_URL,
		MERMAID_ZOOM_STEP,
		PERF_EVENT_THROTTLE_MS,
		PROTECTED_IMAGE_PLACEHOLDER_SRC,
		api,
		compactStructuredForSignature,
		copyButtonHtml,
		diagnosticItemHash,
		escapeHtml,
		isHermesEmbedMode,
		isIosWebKitBrowser,
		normalizeFsPath,
		nowPerfMs,
		postPerformanceEvent,
		primaryTouch,
		publishPluginNavigationState,
		recordHomeAiDiagnosticFailure,
		recordHomeAiDiagnosticSuccess,
		rememberCopyText,
		renderContextThreadId,
		requestHermesPluginRefresh,
		roundedDurationMs,
		shortPath,
		stableTextHash,
		truncateSingleLine: truncateSingleLine$1,
		visibleThreadTaskCardCommandText
	});
	return mediaPreviewRuntime;
}
function imageUrlValue(...args) {
	return requireMediaPreviewRuntime().imageUrlValue(...args);
}
function isInputTextPart$1(...args) {
	return requireMediaPreviewRuntime().isInputTextPart(...args);
}
function inputTextValue$1(...args) {
	return requireMediaPreviewRuntime().inputTextValue(...args);
}
function isInputImagePart(...args) {
	return requireMediaPreviewRuntime().isInputImagePart(...args);
}
function isTruncatedImagePayloadPart(...args) {
	return requireMediaPreviewRuntime().isTruncatedImagePayloadPart(...args);
}
function attachmentSummaryMarkerMatch(...args) {
	return requireMediaPreviewRuntime().attachmentSummaryMarkerMatch(...args);
}
function stripAttachmentSummaryLinePrefix(...args) {
	return requireMediaPreviewRuntime().stripAttachmentSummaryLinePrefix(...args);
}
function splitAttachmentSummaryText(...args) {
	return requireMediaPreviewRuntime().splitAttachmentSummaryText(...args);
}
function parseAttachmentLine(...args) {
	return requireMediaPreviewRuntime().parseAttachmentLine(...args);
}
function codexMobileUploadIdForPath(...args) {
	return requireMediaPreviewRuntime().codexMobileUploadIdForPath(...args);
}
function uploadFileUrl(...args) {
	return requireMediaPreviewRuntime().uploadFileUrl(...args);
}
function isCodexMobileUploadPath(...args) {
	return requireMediaPreviewRuntime().isCodexMobileUploadPath(...args);
}
function imageContentUrlForPath(...args) {
	return requireMediaPreviewRuntime().imageContentUrlForPath(...args);
}
function localAttachmentPreviewUrl(...args) {
	return requireMediaPreviewRuntime().localAttachmentPreviewUrl(...args);
}
function imageSourceForPart(...args) {
	return requireMediaPreviewRuntime().imageSourceForPart(...args);
}
function isLikelyAbsoluteLocalPath(...args) {
	return requireMediaPreviewRuntime().isLikelyAbsoluteLocalPath(...args);
}
function canRenderImageAttachment(...args) {
	return requireMediaPreviewRuntime().canRenderImageAttachment(...args);
}
function isInjectedThreadTaskCardMessage(...args) {
	return requireMediaPreviewRuntime().isInjectedThreadTaskCardMessage(...args);
}
function injectedThreadTaskCardLineValue(...args) {
	return requireMediaPreviewRuntime().injectedThreadTaskCardLineValue(...args);
}
function injectedThreadTaskCardPurpose(...args) {
	return requireMediaPreviewRuntime().injectedThreadTaskCardPurpose(...args);
}
function injectedThreadTaskCardMetadata(...args) {
	return requireMediaPreviewRuntime().injectedThreadTaskCardMetadata(...args);
}
function injectedThreadTaskCardSummary(...args) {
	return requireMediaPreviewRuntime().injectedThreadTaskCardSummary(...args);
}
function injectedThreadTaskCardTextForItem(...args) {
	return requireMediaPreviewRuntime().injectedThreadTaskCardTextForItem(...args);
}
function renderInjectedThreadTaskCardBody(...args) {
	return requireMediaPreviewRuntime().renderInjectedThreadTaskCardBody(...args);
}
function renderInjectedThreadTaskCardMessage(...args) {
	return requireMediaPreviewRuntime().renderInjectedThreadTaskCardMessage(...args);
}
function renderInputText(...args) {
	return requireMediaPreviewRuntime().renderInputText(...args);
}
function renderInputImage(...args) {
	return requireMediaPreviewRuntime().renderInputImage(...args);
}
function renderInputAttachment(...args) {
	return requireMediaPreviewRuntime().renderInputAttachment(...args);
}
function renderAttachmentSummary(...args) {
	return requireMediaPreviewRuntime().renderAttachmentSummary(...args);
}
function renderInputContent(...args) {
	return requireMediaPreviewRuntime().renderInputContent(...args);
}
function renderMarkdown(...args) {
	return requireMediaPreviewRuntime().renderMarkdown(...args);
}
function renderMarkdownWithAttachmentSummary(...args) {
	return requireMediaPreviewRuntime().renderMarkdownWithAttachmentSummary(...args);
}
function commandOutputBody(...args) {
	return requireMediaPreviewRuntime().commandOutputBody(...args);
}
function stripCommandOutputLineNumbers(...args) {
	return requireMediaPreviewRuntime().stripCommandOutputLineNumbers(...args);
}
function isMarkdownTableSeparatorLine(...args) {
	return requireMediaPreviewRuntime().isMarkdownTableSeparatorLine(...args);
}
function containsMarkdownTable(...args) {
	return requireMediaPreviewRuntime().containsMarkdownTable(...args);
}
function commandOutputMarkdownPreview(...args) {
	return requireMediaPreviewRuntime().commandOutputMarkdownPreview(...args);
}
function normalizeGitHubLinkPreview(...args) {
	return requireMediaPreviewRuntime().normalizeGitHubLinkPreview(...args);
}
function normalizeGithubPreviewUrl(...args) {
	return requireMediaPreviewRuntime().normalizeGithubPreviewUrl(...args);
}
function gitHubLinkPreviewAccentClass(...args) {
	return requireMediaPreviewRuntime().gitHubLinkPreviewAccentClass(...args);
}
function renderGitHubLinkPreviewCard(...args) {
	return requireMediaPreviewRuntime().renderGitHubLinkPreviewCard(...args);
}
function githubLinkPreviewHosts(...args) {
	return requireMediaPreviewRuntime().githubLinkPreviewHosts(...args);
}
function gitHubLinkPreviewSummary(...args) {
	return requireMediaPreviewRuntime().gitHubLinkPreviewSummary(...args);
}
function gitHubLinkPreviewInlineHost(...args) {
	return requireMediaPreviewRuntime().gitHubLinkPreviewInlineHost(...args);
}
function gitHubLinkPreviewInsertContainer(...args) {
	return requireMediaPreviewRuntime().gitHubLinkPreviewInsertContainer(...args);
}
function renderCollapsedGitHubLinkPreview(...args) {
	return requireMediaPreviewRuntime().renderCollapsedGitHubLinkPreview(...args);
}
function ensureInlineGitHubLinkPreviews(...args) {
	return requireMediaPreviewRuntime().ensureInlineGitHubLinkPreviews(...args);
}
function renderGitHubLinkPreviewUnavailable(...args) {
	return requireMediaPreviewRuntime().renderGitHubLinkPreviewUnavailable(...args);
}
function setGitHubPreviewCompactExpanded(...args) {
	return requireMediaPreviewRuntime().setGitHubPreviewCompactExpanded(...args);
}
function updateGitHubPreviewCompactTitle(...args) {
	return requireMediaPreviewRuntime().updateGitHubPreviewCompactTitle(...args);
}
function toggleGitHubLinkPreview(...args) {
	return requireMediaPreviewRuntime().toggleGitHubLinkPreview(...args);
}
function hydrateGitHubLinkCards(...args) {
	return requireMediaPreviewRuntime().hydrateGitHubLinkCards(...args);
}
function mermaidEffectiveTheme(...args) {
	return requireMediaPreviewRuntime().mermaidEffectiveTheme(...args);
}
function mermaidThemeName(...args) {
	return requireMediaPreviewRuntime().mermaidThemeName(...args);
}
function mermaidConfig(...args) {
	return requireMediaPreviewRuntime().mermaidConfig(...args);
}
function mermaidPreviewOpen(...args) {
	return requireMediaPreviewRuntime().mermaidPreviewOpen(...args);
}
function loadRuntimeScript(...args) {
	return requireMediaPreviewRuntime().loadRuntimeScript(...args);
}
function configureMermaidApi(...args) {
	return requireMediaPreviewRuntime().configureMermaidApi(...args);
}
function mermaidCanvas(...args) {
	return requireMediaPreviewRuntime().mermaidCanvas(...args);
}
function mermaidViewer(...args) {
	return requireMediaPreviewRuntime().mermaidViewer(...args);
}
function mermaidSourceFromContainer(...args) {
	return requireMediaPreviewRuntime().mermaidSourceFromContainer(...args);
}
function mermaidResetButton(...args) {
	return requireMediaPreviewRuntime().mermaidResetButton(...args);
}
function updateMermaidResetLabel(...args) {
	return requireMediaPreviewRuntime().updateMermaidResetLabel(...args);
}
function clampMermaidScale(...args) {
	return requireMediaPreviewRuntime().clampMermaidScale(...args);
}
function mermaidCurrentScale(...args) {
	return requireMediaPreviewRuntime().mermaidCurrentScale(...args);
}
function mermaidSvgSize(...args) {
	return requireMediaPreviewRuntime().mermaidSvgSize(...args);
}
function mermaidInitialScale(...args) {
	return requireMediaPreviewRuntime().mermaidInitialScale(...args);
}
function applyMermaidScale(...args) {
	return requireMediaPreviewRuntime().applyMermaidScale(...args);
}
function showMermaidLoading(...args) {
	return requireMediaPreviewRuntime().showMermaidLoading(...args);
}
function showMermaidError(...args) {
	return requireMediaPreviewRuntime().showMermaidError(...args);
}
function isMermaidErrorSvgMarkup(...args) {
	return requireMediaPreviewRuntime().isMermaidErrorSvgMarkup(...args);
}
function mermaidRenderArtifactIds(...args) {
	return requireMediaPreviewRuntime().mermaidRenderArtifactIds(...args);
}
function isOwnedMermaidRenderNode(...args) {
	return requireMediaPreviewRuntime().isOwnedMermaidRenderNode(...args);
}
function removeNodeIfExternalMermaidArtifact(...args) {
	return requireMediaPreviewRuntime().removeNodeIfExternalMermaidArtifact(...args);
}
function cleanupMermaidRenderArtifacts(...args) {
	return requireMediaPreviewRuntime().cleanupMermaidRenderArtifacts(...args);
}
function cleanupExternalMermaidErrorArtifacts(...args) {
	return requireMediaPreviewRuntime().cleanupExternalMermaidErrorArtifacts(...args);
}
function renderMermaidSvg(...args) {
	return requireMediaPreviewRuntime().renderMermaidSvg(...args);
}
function mermaidRenderCandidates(...args) {
	return requireMediaPreviewRuntime().mermaidRenderCandidates(...args);
}
function hydrateMermaidBlock(...args) {
	return requireMediaPreviewRuntime().hydrateMermaidBlock(...args);
}
function hydrateMermaidDiagrams(...args) {
	return requireMediaPreviewRuntime().hydrateMermaidDiagrams(...args);
}
function rerenderVisibleMermaidDiagrams(...args) {
	return requireMediaPreviewRuntime().rerenderVisibleMermaidDiagrams(...args);
}
function installMermaidThemeObserver(...args) {
	return requireMediaPreviewRuntime().installMermaidThemeObserver(...args);
}
function mermaidActionContainer(...args) {
	return requireMediaPreviewRuntime().mermaidActionContainer(...args);
}
function mermaidContainerFromViewer(...args) {
	return requireMediaPreviewRuntime().mermaidContainerFromViewer(...args);
}
function resetMermaidScale(...args) {
	return requireMediaPreviewRuntime().resetMermaidScale(...args);
}
function openMermaidPreview(...args) {
	return requireMediaPreviewRuntime().openMermaidPreview(...args);
}
function closeMermaidPreview(...args) {
	return requireMediaPreviewRuntime().closeMermaidPreview(...args);
}
function handleMermaidAction(...args) {
	return requireMediaPreviewRuntime().handleMermaidAction(...args);
}
function imagePreviewOpen(...args) {
	return requireMediaPreviewRuntime().imagePreviewOpen(...args);
}
function imagePreviewScaleLabel(...args) {
	return requireMediaPreviewRuntime().imagePreviewScaleLabel(...args);
}
function applyImagePreviewScale(...args) {
	return requireMediaPreviewRuntime().applyImagePreviewScale(...args);
}
function imagePreviewTitleForImage(...args) {
	return requireMediaPreviewRuntime().imagePreviewTitleForImage(...args);
}
function openImagePreviewFromImage(...args) {
	return requireMediaPreviewRuntime().openImagePreviewFromImage(...args);
}
function closeImagePreview(...args) {
	return requireMediaPreviewRuntime().closeImagePreview(...args);
}
function handleImagePreviewAction(...args) {
	return requireMediaPreviewRuntime().handleImagePreviewAction(...args);
}
function previewableImageFromEvent(...args) {
	return requireMediaPreviewRuntime().previewableImageFromEvent(...args);
}
function touchDistance(...args) {
	return requireMediaPreviewRuntime().touchDistance(...args);
}
function touchCenter(...args) {
	return requireMediaPreviewRuntime().touchCenter(...args);
}
function pinchStateFromTouches(...args) {
	return requireMediaPreviewRuntime().pinchStateFromTouches(...args);
}
function anchorOptionsFromTouches(...args) {
	return requireMediaPreviewRuntime().anchorOptionsFromTouches(...args);
}
function beginImagePreviewPinch(...args) {
	return requireMediaPreviewRuntime().beginImagePreviewPinch(...args);
}
function moveImagePreviewPinch(...args) {
	return requireMediaPreviewRuntime().moveImagePreviewPinch(...args);
}
function finishImagePreviewPinch(...args) {
	return requireMediaPreviewRuntime().finishImagePreviewPinch(...args);
}
function beginMermaidPinch(...args) {
	return requireMediaPreviewRuntime().beginMermaidPinch(...args);
}
function moveMermaidPinch(...args) {
	return requireMediaPreviewRuntime().moveMermaidPinch(...args);
}
function finishMermaidPinch(...args) {
	return requireMediaPreviewRuntime().finishMermaidPinch(...args);
}
function renderThreadTaskCardDraftMessage(...args) {
	return requireMediaPreviewRuntime().renderThreadTaskCardDraftMessage(...args);
}
function closeFilePreview(...args) {
	return requireMediaPreviewRuntime().closeFilePreview(...args);
}
function filePreviewOpen(...args) {
	return requireMediaPreviewRuntime().filePreviewOpen(...args);
}
function beginFilePreviewSwipe(...args) {
	return requireMediaPreviewRuntime().beginFilePreviewSwipe(...args);
}
function moveFilePreviewSwipe(...args) {
	return requireMediaPreviewRuntime().moveFilePreviewSwipe(...args);
}
function finishFilePreviewSwipe(...args) {
	return requireMediaPreviewRuntime().finishFilePreviewSwipe(...args);
}
function cancelFilePreviewSwipe(...args) {
	return requireMediaPreviewRuntime().cancelFilePreviewSwipe(...args);
}
function filePreviewMetaText(...args) {
	return requireMediaPreviewRuntime().filePreviewMetaText(...args);
}
function filePreviewContentUrl(...args) {
	return requireMediaPreviewRuntime().filePreviewContentUrl(...args);
}
function hermesPluginProxyPrefixFromPathname(...args) {
	return requireMediaPreviewRuntime().hermesPluginProxyPrefixFromPathname(...args);
}
function hermesPluginProxyPrefix(...args) {
	return requireMediaPreviewRuntime().hermesPluginProxyPrefix(...args);
}
function protectedImageUpstreamPathname(...args) {
	return requireMediaPreviewRuntime().protectedImageUpstreamPathname(...args);
}
function browserApiContentUrl(...args) {
	return requireMediaPreviewRuntime().browserApiContentUrl(...args);
}
function authenticatedApiContentUrl(...args) {
	return requireMediaPreviewRuntime().authenticatedApiContentUrl(...args);
}
function localFilePreviewContentUrl(...args) {
	return requireMediaPreviewRuntime().localFilePreviewContentUrl(...args);
}
function renderJsonPreview(...args) {
	return requireMediaPreviewRuntime().renderJsonPreview(...args);
}
function parseCsvPreviewRows(...args) {
	return requireMediaPreviewRuntime().parseCsvPreviewRows(...args);
}
function renderCsvPreview(...args) {
	return requireMediaPreviewRuntime().renderCsvPreview(...args);
}
function renderFilePreviewContent(...args) {
	return requireMediaPreviewRuntime().renderFilePreviewContent(...args);
}
function imageViewPath(...args) {
	return requireMediaPreviewRuntime().imageViewPath(...args);
}
function imageViewUrl(...args) {
	return requireMediaPreviewRuntime().imageViewUrl(...args);
}
function imageViewContentUrl(...args) {
	return requireMediaPreviewRuntime().imageViewContentUrl(...args);
}
function safeImageViewApiUrl(...args) {
	return requireMediaPreviewRuntime().safeImageViewApiUrl(...args);
}
function safeImageViewFallbackUrl(...args) {
	return requireMediaPreviewRuntime().safeImageViewFallbackUrl(...args);
}
function isImageViewUnavailable(...args) {
	return requireMediaPreviewRuntime().isImageViewUnavailable(...args);
}
function renderImageView(...args) {
	return requireMediaPreviewRuntime().renderImageView(...args);
}
function handleConversationImageError(...args) {
	return requireMediaPreviewRuntime().handleConversationImageError(...args);
}
function handleConversationImageLoad(...args) {
	return requireMediaPreviewRuntime().handleConversationImageLoad(...args);
}
function failedAppImageContainer(...args) {
	return requireMediaPreviewRuntime().failedAppImageContainer(...args);
}
function setRetryingAppImage(...args) {
	return requireMediaPreviewRuntime().setRetryingAppImage(...args);
}
function markFailedAppImage(...args) {
	return requireMediaPreviewRuntime().markFailedAppImage(...args);
}
function clearFailedAppImage(...args) {
	return requireMediaPreviewRuntime().clearFailedAppImage(...args);
}
function imageHadExplicitLoadError(...args) {
	return requireMediaPreviewRuntime().imageHadExplicitLoadError(...args);
}
function isLazyAppImage(...args) {
	return requireMediaPreviewRuntime().isLazyAppImage(...args);
}
function shouldProactivelyMarkFailedImage(...args) {
	return requireMediaPreviewRuntime().shouldProactivelyMarkFailedImage(...args);
}
function protectedGeneratedImageSrc(...args) {
	return requireMediaPreviewRuntime().protectedGeneratedImageSrc(...args);
}
function imageLoadingModeForSource(...args) {
	return requireMediaPreviewRuntime().imageLoadingModeForSource(...args);
}
function shouldRenderProtectedImageDirectly(...args) {
	return requireMediaPreviewRuntime().shouldRenderProtectedImageDirectly(...args);
}
function protectedImageDisplaySrc(...args) {
	return requireMediaPreviewRuntime().protectedImageDisplaySrc(...args);
}
function protectedImageSourceAttribute(...args) {
	return requireMediaPreviewRuntime().protectedImageSourceAttribute(...args);
}
function protectedAppImageElementSrc(...args) {
	return requireMediaPreviewRuntime().protectedAppImageElementSrc(...args);
}
function imageDiagnosticSourceKind(...args) {
	return requireMediaPreviewRuntime().imageDiagnosticSourceKind(...args);
}
function imageDiagnosticSourceHash(...args) {
	return requireMediaPreviewRuntime().imageDiagnosticSourceHash(...args);
}
function imageDiagnosticDetails(...args) {
	return requireMediaPreviewRuntime().imageDiagnosticDetails(...args);
}
function postImageDiagnosticEvent(...args) {
	return requireMediaPreviewRuntime().postImageDiagnosticEvent(...args);
}
function imageStillConnected(...args) {
	return requireMediaPreviewRuntime().imageStillConnected(...args);
}
function protectedAppImageUrlApi(...args) {
	return requireMediaPreviewRuntime().protectedAppImageUrlApi(...args);
}
function revokeProtectedAppImageObjectUrl(...args) {
	return requireMediaPreviewRuntime().revokeProtectedAppImageObjectUrl(...args);
}
function retryProtectedAppImageSource(...args) {
	return requireMediaPreviewRuntime().retryProtectedAppImageSource(...args);
}
function cacheBustedProtectedImageSrc(...args) {
	return requireMediaPreviewRuntime().cacheBustedProtectedImageSrc(...args);
}
function shouldRecoverProtectedImageAsDirectUrl(...args) {
	return requireMediaPreviewRuntime().shouldRecoverProtectedImageAsDirectUrl(...args);
}
function blobToDataUrl(...args) {
	return requireMediaPreviewRuntime().blobToDataUrl(...args);
}
function applyProtectedAppImageRecoveredUrl(...args) {
	return requireMediaPreviewRuntime().applyProtectedAppImageRecoveredUrl(...args);
}
function shouldHydrateProtectedAppImage(...args) {
	return requireMediaPreviewRuntime().shouldHydrateProtectedAppImage(...args);
}
function hydrateProtectedAppImage(...args) {
	return requireMediaPreviewRuntime().hydrateProtectedAppImage(...args);
}
function hydrateProtectedAppImages(...args) {
	return requireMediaPreviewRuntime().hydrateProtectedAppImages(...args);
}
function handleProtectedAppImageError(...args) {
	return requireMediaPreviewRuntime().handleProtectedAppImageError(...args);
}
function probeFailedAuthenticatedImage(...args) {
	return requireMediaPreviewRuntime().probeFailedAuthenticatedImage(...args);
}
function scanFailedAppImages(...args) {
	return requireMediaPreviewRuntime().scanFailedAppImages(...args);
}
function scheduleFailedAppImageScan(...args) {
	return requireMediaPreviewRuntime().scheduleFailedAppImageScan(...args);
}
function scheduleVisibleImageFailureScan(...args) {
	return requireMediaPreviewRuntime().scheduleVisibleImageFailureScan(...args);
}
function showFilePreviewLoading(...args) {
	return requireMediaPreviewRuntime().showFilePreviewLoading(...args);
}
function localFilePreviewThreadIdFromLink(...args) {
	return requireMediaPreviewRuntime().localFilePreviewThreadIdFromLink(...args);
}
function handleFilePreviewHtmlViewClick(...args) {
	return requireMediaPreviewRuntime().handleFilePreviewHtmlViewClick(...args);
}
function handleFilePreviewHtmlFullscreenClick(...args) {
	return requireMediaPreviewRuntime().handleFilePreviewHtmlFullscreenClick(...args);
}
function closeFilePreviewHtmlFullscreen(...args) {
	return requireMediaPreviewRuntime().closeFilePreviewHtmlFullscreen(...args);
}
function nestedStringValue(value, keys, depth = 0, seen = /* @__PURE__ */ new Set()) {
	if (!value || typeof value !== "object" || depth > 3 || seen.has(value)) return "";
	seen.add(value);
	const wanted = new Set(keys.map((key) => String(key).toLowerCase()));
	for (const [key, entry] of Object.entries(value)) if (wanted.has(String(key).toLowerCase()) && typeof entry === "string" && entry.trim()) return entry;
	for (const entry of Object.values(value)) {
		const found = nestedStringValue(entry, keys, depth + 1, seen);
		if (found) return found;
	}
	return "";
}
function collabAgentTaskText(item) {
	return nestedStringValue(item, [
		"task",
		"message",
		"prompt",
		"description",
		"instructions"
	]);
}
function collabAgentThreadText(item) {
	return nestedStringValue(item, [
		"targetThread",
		"targetThreadId",
		"threadId",
		"agentThreadId",
		"modelThread"
	]);
}
function collabAgentNameText(item) {
	return nestedStringValue(item, [
		"name",
		"agentName",
		"nickname",
		"role",
		"agentType",
		"agent_type"
	]);
}
function collabAgentMetaPill(label, value) {
	if (!value) return "";
	return `<span class="collab-agent-pill"><span>${escapeHtml(label)}</span>${escapeHtml(value)}</span>`;
}
function renderCollabAgentToolCall(item) {
	const tool = item.tool || item.name || "collabAgentToolCall";
	const status = statusText(item.status);
	const thread = collabAgentThreadText(item);
	const agentName = collabAgentNameText(item);
	const task = collabAgentTaskText(item);
	const raw = JSON.stringify(item, null, 2);
	const rawCopyButton = copyButtonHtml(rememberCopyText(raw), "复制", "output-copy-button");
	const pills = [
		collabAgentMetaPill("工具", tool),
		collabAgentMetaPill("状态", status),
		collabAgentMetaPill("Agent", agentName),
		collabAgentMetaPill("线程", thread)
	].filter(Boolean).join("");
	return `<div class="collab-agent-card">
    <div class="collab-agent-title">${escapeHtml(tool === "spawnAgent" ? "协作 Agent 已启动" : "协作 Agent 调用")}</div>
    ${pills ? `<div class="collab-agent-meta">${pills}</div>` : ""}
    ${task ? `<div class="collab-agent-task">${escapeHtml(truncateMiddle(task, 260, "task"))}</div>` : ""}
    <details class="output-details collab-agent-raw">
      <summary><span>${escapeHtml(`原始 JSON: ${raw.length.toLocaleString()} chars`)}</span>${rawCopyButton}</summary>
      <pre>${escapeHtml(raw)}</pre>
    </details>
  </div>`;
}
function formatTokenCount(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number.toLocaleString() : "--";
}
function formatCompactTokenCount(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) return "--";
	const absolute = Math.abs(number);
	if (absolute >= 1e6) {
		const value = number / 1e6;
		return `${absolute / 1e6 >= 10 ? value.toFixed(1) : value.toFixed(2)}M`;
	}
	if (absolute >= 1e3) {
		const value = number / 1e3;
		return `${absolute / 1e3 >= 100 ? Math.round(value) : value.toFixed(1)}K`;
	}
	return `${Math.round(number)}`;
}
function displayInputTokensExcludingCached(usage) {
	const input = Number(usage && usage.inputTokens);
	if (!Number.isFinite(input)) return usage && usage.inputTokens;
	const cached = Number(usage && usage.cachedInputTokens);
	if (!Number.isFinite(cached)) return input;
	return Math.max(0, input - cached);
}
function formatUsagePercent(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) return "--";
	if (number < 10) return `${number.toFixed(1)}%`;
	return `${Math.round(number)}%`;
}
function tokenUsageSummaryText(usage) {
	const value = usage && typeof usage === "object" ? usage : {};
	return [
		`in ${formatCompactTokenCount(value.inputTokens)}`,
		`out ${formatCompactTokenCount(value.outputTokens)}`,
		`total ${formatCompactTokenCount(value.totalTokens)}`,
		value.cachedInputTokens !== void 0 ? `cached ${formatCompactTokenCount(value.cachedInputTokens)} in input` : "",
		value.reasoningOutputTokens !== void 0 ? `reasoning ${formatCompactTokenCount(value.reasoningOutputTokens)} in output` : ""
	].filter(Boolean).join(" / ");
}
function tokenUsageAdditiveDetail(usage) {
	const value = usage && typeof usage === "object" ? usage : {};
	return [`input ${formatCompactTokenCount(value.inputTokens)}`, `output ${formatCompactTokenCount(value.outputTokens)}`].filter((part) => !part.endsWith(" --")).join(" + ");
}
function tokenUsageIncludedDetail(usage) {
	const value = usage && typeof usage === "object" ? usage : {};
	return [value.cachedInputTokens !== void 0 ? `cached ${formatCompactTokenCount(value.cachedInputTokens)} in input` : "", value.reasoningOutputTokens !== void 0 ? `reasoning ${formatCompactTokenCount(value.reasoningOutputTokens)} in output` : ""].filter(Boolean).join(" / ");
}
function contextRiskLabel(level) {
	return {
		normal: "normal",
		warn: "watch",
		high: "high",
		critical: "critical",
		unknown: "unknown"
	}[level] || "unknown";
}
function renderUsageMetric(label, value, detail = "") {
	return `<div class="turn-usage-metric">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
  </div>`;
}
function renderUsageBarPill(kind, label, value) {
	return `<span class="turn-usage-pill ${escapeHtml(kind)}">
    <span class="turn-usage-pill-dot"></span>
    <span>${escapeHtml([value, label].filter(Boolean).join(" "))}</span>
  </span>`;
}
function renderUsageTokenCell(kind, label, value, detail = "") {
	return `<div class="turn-usage-token-cell">
    <span><span class="turn-usage-token-dot ${escapeHtml(kind)}"></span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
  </div>`;
}
function renderUsageProgress(percent, label) {
	return `<div class="turn-usage-progress" style="--usage-progress:${clampPercent(percent).toFixed(2)}%">
    <div class="turn-usage-progress-track"><span></span></div>
    <small>${escapeHtml(label)}</small>
  </div>`;
}
function renderUsageCompactMetric(label, value, detail = "", extraClass = "") {
	const className = ["turn-usage-compact-metric", extraClass].filter(Boolean).join(" ");
	return `<div class="${escapeHtml(className)}">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
  </div>`;
}
function renderTurnUsageSummary(item) {
	const summary = item && item.mobileUsageSummary && typeof item.mobileUsageSummary === "object" ? item.mobileUsageSummary : {};
	const contextTokens = Number(summary.contextWindowUsedTokens);
	const contextWindow = Number(summary.modelContextWindow);
	const contextDetail = Number.isFinite(contextTokens) && Number.isFinite(contextWindow) && contextWindow > 0 ? `${formatCompactTokenCount(contextTokens)} / ${formatCompactTokenCount(contextWindow)}` : "";
	const totalTokenUsage = summary.totalTokenUsage || {};
	const totalUsageDetail = [tokenUsageAdditiveDetail(totalTokenUsage), tokenUsageIncludedDetail(totalTokenUsage)].filter(Boolean).join(" / ");
	const rolloutSize = Number(summary.rolloutSizeBytes);
	const rolloutThreshold = Number(summary.rolloutWarningThresholdBytes);
	const projectContextSize = Number(summary.projectContextSizeBytes);
	const handoffSize = Number(summary.handoffSizeBytes);
	const pairSize = Number(summary.workspaceContextPairSizeBytes);
	const fileThreshold = Number(summary.workspaceContextFileThresholdBytes);
	const handoffThreshold = Number(summary.workspaceHandoffPromptThresholdBytes || summary.workspaceContextFileThresholdBytes);
	const pairThreshold = Number(summary.workspaceContextPairThresholdBytes);
	const contextRisk = Number.isFinite(pairSize) && Number.isFinite(pairThreshold) && pairThreshold > 0 && pairSize >= pairThreshold || Number.isFinite(projectContextSize) && Number.isFinite(fileThreshold) && fileThreshold > 0 && projectContextSize >= fileThreshold || Number.isFinite(handoffSize) && Number.isFinite(handoffThreshold) && handoffThreshold > 0 && handoffSize >= handoffThreshold;
	const rolloutRisk = Boolean(summary.rolloutOverWarningThreshold) || Number.isFinite(rolloutSize) && Number.isFinite(rolloutThreshold) && rolloutThreshold > 0 && rolloutSize >= rolloutThreshold;
	const contextDetailFiles = [];
	if (Number.isFinite(pairSize) && pairSize > 0) contextDetailFiles.push(`pair ${formatFileSize(pairSize)}`);
	if (Number.isFinite(fileThreshold) && fileThreshold > 0) contextDetailFiles.push(`warn ${formatFileSize(fileThreshold)}`);
	const handoffDetail = Number.isFinite(handoffThreshold) && handoffThreshold > 0 ? `warn ${formatFileSize(handoffThreshold)}` : "";
	const compactButton = contextRisk || rolloutRisk ? `<button class="turn-usage-new-thread" type="button" data-new-thread-from-current>压缩续接</button>` : "";
	const risk = contextRiskLabel(summary.contextRiskLevel || "unknown");
	const ringOffset = (100 - clampPercent(summary.contextWindowUsedPercent)).toFixed(2);
	const lastTurnUsage = summary.lastTokenUsage || {};
	const lastInputDetail = lastTurnUsage.cachedInputTokens !== void 0 ? `cached ${formatCompactTokenCount(lastTurnUsage.cachedInputTokens)} included` : "";
	const lastOutputDetail = lastTurnUsage.reasoningOutputTokens !== void 0 ? `reasoning ${formatCompactTokenCount(lastTurnUsage.reasoningOutputTokens)} included` : "";
	const projectContextMetric = renderUsageCompactMetric("project ctx file", Number.isFinite(projectContextSize) && projectContextSize > 0 ? formatFileSize(projectContextSize) : "--", contextDetailFiles.join(" | "));
	const handoffMetric = renderUsageCompactMetric("handoff file", Number.isFinite(handoffSize) && handoffSize > 0 ? formatFileSize(handoffSize) : "--", handoffDetail);
	const rolloutPercent = Number.isFinite(rolloutSize) && Number.isFinite(rolloutThreshold) && rolloutThreshold > 0 ? clampPercent(rolloutSize / rolloutThreshold * 100) : 0;
	return `<details class="turn-usage-summary risk-${escapeHtml(risk)}">
    <summary class="turn-usage-bar">
      <span class="turn-usage-pills">
        ${renderUsageBarPill(risk === "normal" || risk === "unknown" ? "context" : "warn", "ctx", formatUsagePercent(summary.contextWindowUsedPercent))}
        ${renderUsageBarPill("thread", "thr", formatCompactTokenCount(totalTokenUsage.totalTokens))}
        ${renderUsageBarPill("rollout", "", Number.isFinite(rolloutSize) ? formatFileSize(rolloutSize) : "--")}
        ${renderUsageBarPill(`status status-${risk}`, "", risk)}
      </span>
    </summary>
    <div class="turn-usage-expanded">
      <div class="turn-usage-top-grid">
        <div class="turn-usage-context-card">
          <div class="turn-usage-ring" style="--usage-ring-offset:${ringOffset}">
            <svg viewBox="0 0 72 72" aria-hidden="true">
              <circle class="turn-usage-ring-bg" cx="36" cy="36" r="28" pathLength="100"></circle>
              <circle class="turn-usage-ring-fill" cx="36" cy="36" r="28" pathLength="100"></circle>
            </svg>
            <div>
              <strong>${escapeHtml(formatUsagePercent(summary.contextWindowUsedPercent))}</strong>
            </div>
          </div>
          <div>
            <span>Context Window</span>
            <strong>${escapeHtml(formatCompactTokenCount(contextTokens))}</strong>
            <small>${contextDetail ? escapeHtml(contextDetail) : "window usage unavailable"}</small>
          </div>
        </div>
        <div class="turn-usage-rollout-card">
          <div>
            <span>Rollout</span>
            <strong>${escapeHtml(Number.isFinite(rolloutSize) ? formatFileSize(rolloutSize) : "--")}</strong>
          </div>
          ${renderUsageProgress(rolloutPercent, Number.isFinite(rolloutThreshold) && rolloutThreshold > 0 ? `of ${formatFileSize(rolloutThreshold)}` : "threshold unavailable")}
        </div>
      </div>
      <div class="turn-usage-token-grid">
        ${renderUsageTokenCell("input", "Input", formatCompactTokenCount(lastTurnUsage.inputTokens), lastInputDetail)}
        ${renderUsageTokenCell("output", "Output", formatCompactTokenCount(lastTurnUsage.outputTokens), lastOutputDetail)}
      </div>
      <div class="turn-usage-grid">
        ${renderUsageCompactMetric("thread total", formatCompactTokenCount(totalTokenUsage.totalTokens), totalUsageDetail, "is-thread-total")}
        ${projectContextMetric}
        ${handoffMetric}
      </div>
      ${compactButton ? `<div class="turn-usage-actions">${compactButton}</div>` : ""}
    </div>
  </details>`;
}
function renderItemBody(item, turn = null) {
	if (isContextCompactionItem(item)) return escapeHtml(contextCompactionNotice(item, turn));
	if (item.type === "turnUsageSummary") return renderTurnUsageSummary(item);
	if (item.type === "userMessage") return renderUserMessageBody(item);
	if (item.type === "agentMessage") return renderThreadTaskCardDraftMessage(item.text || "", item, turn) || renderMarkdownWithAttachmentSummary(item.text || "");
	if (isTurnDiagnosticItem(item)) return renderTurnDiagnostic(item);
	if (item.type === "reasoning") {
		const summary = (item.summary || []).join("\n");
		const content = (item.content || []).join("\n");
		return escapeHtml([summary, content].filter(Boolean).join("\n\n"));
	}
	if (item.type === "plan") return renderThreadTaskCardDraftMessage(item.text || "", item, turn) || renderMarkdownWithAttachmentSummary(item.text || "");
	if (item.type === "imageView") return renderImageView(item);
	if (item.type === "imageGeneration") return renderImageView(item);
	if (item.type === "commandExecution") return `<div class="mono">${escapeHtml(item.command || "")}</div>${renderOutputBlock(item.aggregatedOutput, item)}`;
	if (item.type === "fileChange") return renderStructuredBlock(item.changes || [], `${Array.isArray(item.changes) ? item.changes.length : 0} change(s)`);
	if (item.type === "collabAgentToolCall") return renderCollabAgentToolCall(item);
	if (item.type === "dynamicToolCall" || item.type === "mcpToolCall") return `<div class="mono">${escapeHtml(JSON.stringify(item.arguments || {}, null, 2))}</div>${renderStructuredBlock(item.result || item.contentItems, "Tool result")}`;
	return escapeHtml(JSON.stringify(item, null, 2));
}
function userMessageRenderableContent(item) {
	if (!item || typeof item !== "object") return [];
	if (Array.isArray(item.content) && item.content.length) return item.content;
	if (typeof item.content === "string" && item.content.trim()) return [{
		type: "text",
		text: item.content
	}];
	const text = typeof item.text === "string" && item.text.trim() ? item.text : typeof item.message === "string" && item.message.trim() ? item.message : "";
	return text ? [{
		type: "text",
		text
	}] : [];
}
function renderUserMessageBody(item) {
	const body = renderInputContent(userMessageRenderableContent(item));
	const errorMessage = String(item && item.mobileSendError && item.mobileSendError.message || "").trim();
	if (!errorMessage) return body;
	return `${body}<div class="send-error-receipt" role="status">${escapeHtml(`发送失败：${errorMessage}`)}</div>`;
}
function renderTurnDiagnostic(item) {
	const title = String(item && item.title || "Codex runtime diagnostic");
	const message = String(item && item.message || "Codex runtime ended this turn without visible response content.");
	const code = String(item && item.code || "");
	const severity = String(item && item.severity || "warning");
	return `<div class="turn-diagnostic-body ${escapeHtml(severity)}">
    <div class="turn-diagnostic-title">${escapeHtml(title)}</div>
    <div class="turn-diagnostic-message">${escapeHtml(message)}</div>
    ${code ? `<div class="turn-diagnostic-code">${escapeHtml(code)}</div>` : ""}
  </div>`;
}
function renderOutputBlock(output, item = {}) {
	if (!output && item.outputOmitted) {
		const total = item.outputTotalChars || 0;
		const omittedText = "This command output is still in the Codex session history. It is omitted here to keep the mobile client responsive.";
		return `<details class="output-details">
      <summary><span>${escapeHtml(`Output omitted from mobile view: ${Number(total).toLocaleString()} chars`)}</span>${copyButtonHtml(rememberCopyText(omittedText), "复制", "output-copy-button")}</summary>
      <pre>${escapeHtml(omittedText)}</pre>
    </details>`;
	}
	if (!output) return "";
	const outputText = String(output);
	const markdownPreview = commandOutputMarkdownPreview(outputText, item);
	const total = item.outputTotalChars || String(output).length;
	const summary = item.outputTruncated || total > outputText.length ? `Output preview: ${total.toLocaleString()} chars total, showing latest ${outputText.length.toLocaleString()}` : `Output: ${outputText.length.toLocaleString()} chars`;
	return `${markdownPreview ? `<div class="command-output-markdown-preview">${renderMarkdown(markdownPreview, { orderedListMode: "source" })}</div>` : ""}<details class="output-details">
    <summary><span>${escapeHtml(summary)}</span>${copyButtonHtml(rememberCopyText(outputText), "复制", "output-copy-button")}</summary>
    <pre>${escapeHtml(outputText)}</pre>
  </details>`;
}
function renderStructuredBlock(value, label) {
	if (!value) return "";
	if (value.truncated && value.preview) {
		const preview = String(value.preview || "");
		return `<details class="output-details">
      <summary><span>${escapeHtml(`${label}: ${Number(value.totalChars || 0).toLocaleString()} chars total, preview`)}</span>${copyButtonHtml(rememberCopyText(preview), "复制", "output-copy-button")}</summary>
      <pre>${escapeHtml(preview)}</pre>
    </details>`;
	}
	const raw = JSON.stringify(value, null, 2);
	if (!raw || raw === "null") return "";
	return `<details class="output-details">
    <summary><span>${escapeHtml(`${label}: ${raw.length.toLocaleString()} chars`)}</span>${copyButtonHtml(rememberCopyText(raw), "复制", "output-copy-button")}</summary>
    <pre>${escapeHtml(raw)}</pre>
  </details>`;
}
function ensureTurn(turnId) {
	const thread = state.currentThread;
	if (!thread) return null;
	thread.turns = thread.turns || [];
	let turn = thread.turns.find((x) => x.id === turnId);
	if (!turn) {
		turn = {
			id: turnId,
			items: [],
			status: { type: "running" },
			error: null,
			startedAt: Math.floor(Date.now() / 1e3),
			completedAt: null,
			durationMs: null
		};
		thread.turns.push(turn);
	}
	return turn;
}
function shouldDeferLiveFinalReceipt(turn, itemType) {
	return false;
}
function createConversationRenderRuntime() {
	return {
		renderLiveOperationDock: typeof renderLiveOperationDock === "function" ? renderLiveOperationDock : null,
		renderTurnVisibleItemBudgetNotice: typeof renderTurnVisibleItemBudgetNotice === "function" ? renderTurnVisibleItemBudgetNotice : null,
		renderTurn: typeof renderTurn === "function" ? renderTurn : null,
		renderMobileOperationStack: typeof renderMobileOperationStack === "function" ? renderMobileOperationStack : null,
		renderItem: typeof renderItem === "function" ? renderItem : null,
		renderItemBody: typeof renderItemBody === "function" ? renderItemBody : null,
		renderUserMessageBody: typeof renderUserMessageBody === "function" ? renderUserMessageBody : null,
		renderTurnUsageSummary: typeof renderTurnUsageSummary === "function" ? renderTurnUsageSummary : null,
		ensureTurn: typeof ensureTurn === "function" ? ensureTurn : null,
		shouldDeferLiveFinalReceipt: typeof shouldDeferLiveFinalReceipt === "function" ? shouldDeferLiveFinalReceipt : null
	};
}
var conversationRenderRuntimeApi = Object.freeze({ createConversationRenderRuntime });
var conversationRenderRoot = typeof globalThis !== "undefined" ? globalThis : window;
Object.assign(conversationRenderRoot, {
	renderLiveOperationDock,
	renderTurnVisibleItemBudgetNotice,
	renderTurn,
	renderLiveOperation,
	renderOperationCard,
	operationDurationHtml,
	operationBubbleSummary,
	renderMobileOperationStack,
	operationTitle,
	operationDetailText,
	truncateSingleLine: truncateSingleLine$1,
	normalizeOperationIdentityValue,
	stripMatchingOuterQuotes,
	operationArgumentsObject,
	operationCommandText,
	operationCommandSummary,
	operationCommandName,
	operationCommandGroupText,
	operationRawFileNames,
	operationFileNames,
	operationGroupKey,
	collectSearchSummaries,
	operationSearchSummary,
	operationSummaryLines,
	displayTurnStatus,
	renderContextCompaction,
	renderItem,
	renderInjectedThreadTaskCardItem,
	renderItemTimestampHtml,
	itemTimestampMs,
	turnStartedAtMs,
	renderLiveReasoning,
	labelForItem,
	copyTextForItem,
	requireMediaPreviewRuntime,
	imageUrlValue,
	isInputTextPart: isInputTextPart$1,
	inputTextValue: inputTextValue$1,
	isInputImagePart,
	isTruncatedImagePayloadPart,
	attachmentSummaryMarkerMatch,
	stripAttachmentSummaryLinePrefix,
	splitAttachmentSummaryText,
	parseAttachmentLine,
	codexMobileUploadIdForPath,
	uploadFileUrl,
	isCodexMobileUploadPath,
	imageContentUrlForPath,
	localAttachmentPreviewUrl,
	imageSourceForPart,
	isLikelyAbsoluteLocalPath,
	canRenderImageAttachment,
	isInjectedThreadTaskCardMessage,
	injectedThreadTaskCardLineValue,
	injectedThreadTaskCardPurpose,
	injectedThreadTaskCardMetadata,
	injectedThreadTaskCardSummary,
	injectedThreadTaskCardTextForItem,
	renderInjectedThreadTaskCardBody,
	renderInjectedThreadTaskCardMessage,
	renderInputText,
	renderInputImage,
	renderInputAttachment,
	renderAttachmentSummary,
	renderInputContent,
	renderMarkdown,
	renderMarkdownWithAttachmentSummary,
	commandOutputBody,
	stripCommandOutputLineNumbers,
	isMarkdownTableSeparatorLine,
	containsMarkdownTable,
	commandOutputMarkdownPreview,
	normalizeGitHubLinkPreview,
	normalizeGithubPreviewUrl,
	gitHubLinkPreviewAccentClass,
	renderGitHubLinkPreviewCard,
	githubLinkPreviewHosts,
	gitHubLinkPreviewSummary,
	gitHubLinkPreviewInlineHost,
	gitHubLinkPreviewInsertContainer,
	renderCollapsedGitHubLinkPreview,
	ensureInlineGitHubLinkPreviews,
	renderGitHubLinkPreviewUnavailable,
	setGitHubPreviewCompactExpanded,
	updateGitHubPreviewCompactTitle,
	toggleGitHubLinkPreview,
	hydrateGitHubLinkCards,
	mermaidEffectiveTheme,
	mermaidThemeName,
	mermaidConfig,
	mermaidPreviewOpen,
	loadRuntimeScript,
	configureMermaidApi,
	mermaidCanvas,
	mermaidViewer,
	mermaidSourceFromContainer,
	mermaidResetButton,
	updateMermaidResetLabel,
	clampMermaidScale,
	mermaidCurrentScale,
	mermaidSvgSize,
	mermaidInitialScale,
	applyMermaidScale,
	showMermaidLoading,
	showMermaidError,
	isMermaidErrorSvgMarkup,
	mermaidRenderArtifactIds,
	isOwnedMermaidRenderNode,
	removeNodeIfExternalMermaidArtifact,
	cleanupMermaidRenderArtifacts,
	cleanupExternalMermaidErrorArtifacts,
	renderMermaidSvg,
	mermaidRenderCandidates,
	hydrateMermaidBlock,
	hydrateMermaidDiagrams,
	rerenderVisibleMermaidDiagrams,
	installMermaidThemeObserver,
	mermaidActionContainer,
	mermaidContainerFromViewer,
	resetMermaidScale,
	openMermaidPreview,
	closeMermaidPreview,
	handleMermaidAction,
	imagePreviewOpen,
	imagePreviewScaleLabel,
	applyImagePreviewScale,
	imagePreviewTitleForImage,
	openImagePreviewFromImage,
	closeImagePreview,
	handleImagePreviewAction,
	previewableImageFromEvent,
	touchDistance,
	touchCenter,
	pinchStateFromTouches,
	anchorOptionsFromTouches,
	beginImagePreviewPinch,
	moveImagePreviewPinch,
	finishImagePreviewPinch,
	beginMermaidPinch,
	moveMermaidPinch,
	finishMermaidPinch,
	renderThreadTaskCardDraftMessage,
	closeFilePreview,
	filePreviewOpen,
	beginFilePreviewSwipe,
	moveFilePreviewSwipe,
	finishFilePreviewSwipe,
	cancelFilePreviewSwipe,
	filePreviewMetaText,
	filePreviewContentUrl,
	hermesPluginProxyPrefixFromPathname,
	hermesPluginProxyPrefix,
	protectedImageUpstreamPathname,
	browserApiContentUrl,
	authenticatedApiContentUrl,
	localFilePreviewContentUrl,
	renderJsonPreview,
	parseCsvPreviewRows,
	renderCsvPreview,
	renderFilePreviewContent,
	imageViewPath,
	imageViewUrl,
	imageViewContentUrl,
	safeImageViewApiUrl,
	safeImageViewFallbackUrl,
	isImageViewUnavailable,
	renderImageView,
	handleConversationImageError,
	handleConversationImageLoad,
	failedAppImageContainer,
	setRetryingAppImage,
	markFailedAppImage,
	clearFailedAppImage,
	imageHadExplicitLoadError,
	isLazyAppImage,
	shouldProactivelyMarkFailedImage,
	protectedGeneratedImageSrc,
	imageLoadingModeForSource,
	shouldRenderProtectedImageDirectly,
	protectedImageDisplaySrc,
	protectedImageSourceAttribute,
	protectedAppImageElementSrc,
	imageDiagnosticSourceKind,
	imageDiagnosticSourceHash,
	imageDiagnosticDetails,
	postImageDiagnosticEvent,
	imageStillConnected,
	protectedAppImageUrlApi,
	revokeProtectedAppImageObjectUrl,
	retryProtectedAppImageSource,
	cacheBustedProtectedImageSrc,
	shouldRecoverProtectedImageAsDirectUrl,
	blobToDataUrl,
	applyProtectedAppImageRecoveredUrl,
	shouldHydrateProtectedAppImage,
	hydrateProtectedAppImage,
	hydrateProtectedAppImages,
	handleProtectedAppImageError,
	probeFailedAuthenticatedImage,
	scanFailedAppImages,
	scheduleFailedAppImageScan,
	scheduleVisibleImageFailureScan,
	showFilePreviewLoading,
	localFilePreviewThreadIdFromLink,
	handleFilePreviewHtmlViewClick,
	handleFilePreviewHtmlFullscreenClick,
	closeFilePreviewHtmlFullscreen,
	nestedStringValue,
	collabAgentTaskText,
	collabAgentThreadText,
	collabAgentNameText,
	collabAgentMetaPill,
	renderCollabAgentToolCall,
	formatTokenCount,
	formatCompactTokenCount,
	displayInputTokensExcludingCached,
	formatUsagePercent,
	tokenUsageSummaryText,
	tokenUsageAdditiveDetail,
	tokenUsageIncludedDetail,
	contextRiskLabel,
	renderUsageMetric,
	renderUsageBarPill,
	renderUsageTokenCell,
	renderUsageProgress,
	renderUsageCompactMetric,
	renderTurnUsageSummary,
	renderItemBody,
	renderUserMessageBody,
	renderTurnDiagnostic,
	renderOutputBlock,
	renderStructuredBlock,
	ensureTurn,
	shouldDeferLiveFinalReceipt,
	createConversationRenderRuntime
});
conversationRenderRoot.CodexConversationRenderRuntime = conversationRenderRuntimeApi;
//#endregion
//#region \0virtual:codex-mobile-esm-compatibility/shard/shard-10
var moduleDefinitions = [
	{
		"id": "task-card-runtime",
		"source": "public/task-card-runtime.js",
		"nativeSource": "frontend/native/task-card-runtime.mjs",
		"globalName": "CodexTaskCardRuntime",
		"expectedFunctions": ["createTaskCardRuntime"],
		"assetPath": "/task-card-runtime.js",
		"importSource": "frontend/native/task-card-runtime.mjs",
		"compatibilityMode": "native-esm",
		"classicLoaderExcluded": true,
		"bytes": 74977
	},
	{
		"id": "notification-ui-runtime",
		"source": "public/notification-ui-runtime.js",
		"nativeSource": "frontend/native/notification-ui-runtime.mjs",
		"globalName": "CodexNotificationUiRuntime",
		"expectedFunctions": ["createNotificationUiRuntime"],
		"assetPath": "/notification-ui-runtime.js",
		"importSource": "frontend/native/notification-ui-runtime.mjs",
		"compatibilityMode": "native-esm",
		"classicLoaderExcluded": true,
		"bytes": 57015
	},
	{
		"id": "conversation-render-runtime",
		"source": "public/conversation-render-runtime.js",
		"nativeSource": "frontend/native/conversation-render-runtime.mjs",
		"globalName": "CodexConversationRenderRuntime",
		"expectedFunctions": ["createConversationRenderRuntime"],
		"assetPath": "/conversation-render-runtime.js",
		"importSource": "frontend/native/conversation-render-runtime.mjs",
		"compatibilityMode": "native-esm",
		"classicLoaderExcluded": true,
		"bytes": 72369
	}
];
var moduleApis = {
	"task-card-runtime": taskCardRuntimeApi,
	"notification-ui-runtime": notificationUiRuntimeApi,
	"conversation-render-runtime": conversationRenderRuntimeApi
};
function functionReady(api, name) {
	return Boolean(api && typeof api[name] === "function");
}
function publishClassicGlobal(definition, api) {
	const globalName = String(definition && definition.globalName || "");
	if (!globalName || !api || typeof api !== "object" || typeof globalThis === "undefined") return false;
	globalThis[globalName] = api;
	return globalThis[globalName] === api;
}
function sampleModule(id, api) {
	if (id === "build-refresh-policy") {
		const classification = functionReady(api, "classifyServerBuildChange") ? api.classifyServerBuildChange("0.1.11|codex-mobile-shell-v626", "0.1.11|codex-mobile-shell-v625") : "";
		const prompt = functionReady(api, "shouldPromptForServerBuildChange") ? api.shouldPromptForServerBuildChange("0.1.11|codex-mobile-shell-v626", "0.1.11|codex-mobile-shell-v625") : false;
		return {
			ok: classification === "server-newer" && prompt === true,
			classification,
			prompt
		};
	}
	if (id === "runtime-settings") {
		const normalizedOptions = functionReady(api, "normalizeOptionList") ? api.normalizeOptionList([
			"",
			"gpt-5.5",
			" gpt-5.5 ",
			"gpt-5.4"
		]) : [];
		const modelLabel = functionReady(api, "labelForModel") ? api.labelForModel("gpt-5.3-codex-spark") : "";
		const compactModelLabel = functionReady(api, "compactLabelForModel") ? api.compactLabelForModel("gpt-5.3-codex-spark") : "";
		const effortLabel = functionReady(api, "labelForEffort") ? api.labelForEffort("xhigh") : "";
		const permissionLabel = functionReady(api, "labelForPermissionMode") ? api.labelForPermissionMode("full") : "";
		const permissionTitle = functionReady(api, "titleForPermissionMode") ? api.titleForPermissionMode("custom") : "";
		const permissionAlias = functionReady(api, "normalizePermissionModeValue") ? api.normalizePermissionModeValue("full-access") : "";
		const selectedModel = functionReady(api, "selectedNewThreadModel") ? api.selectedNewThreadModel({
			selected: "",
			defaultValue: "gpt-5.5",
			options: ["gpt-5.4"]
		}) : "";
		const selectedEffort = functionReady(api, "selectedNewThreadEffort") ? api.selectedNewThreadEffort({
			selected: " high ",
			defaultValue: "medium",
			options: ["low"]
		}) : "";
		const selectedPermission = functionReady(api, "selectedNewThreadPermission") ? api.selectedNewThreadPermission({
			selected: "workspace-write",
			defaultValue: "full",
			options: ["auto"]
		}) : "";
		return {
			ok: Array.isArray(normalizedOptions) && normalizedOptions.join(",") === "gpt-5.5,gpt-5.4" && modelLabel === "GPT-5.3 Codex Spark" && compactModelLabel === "5.3 Spark" && effortLabel === "XHigh" && permissionLabel === "完全访问权限" && permissionTitle === "自定义 (config.toml)" && permissionAlias === "full" && selectedModel === "gpt-5.5" && selectedEffort === "high" && selectedPermission === "auto",
			normalizedOptions,
			modelLabel,
			compactModelLabel,
			effortLabel,
			permissionLabel,
			permissionTitle,
			permissionAlias,
			selectedModel,
			selectedEffort,
			selectedPermission
		};
	}
	if (id === "viewport-metrics") {
		const editable = functionReady(api, "isKeyboardEditable") ? api.isKeyboardEditable({
			tagName: "INPUT",
			type: "text"
		}) : false;
		const checkboxEditable = functionReady(api, "isKeyboardEditable") ? api.isKeyboardEditable({
			tagName: "INPUT",
			type: "checkbox"
		}) : true;
		const measurement = functionReady(api, "measureViewport") ? api.measureViewport({
			visualHeight: 520,
			visualOffsetTop: 16,
			innerHeight: 1024,
			clientHeight: 1024,
			activeElement: { tagName: "TEXTAREA" }
		}) : {};
		const stableChanged = functionReady(api, "stablePixelChanged") ? api.stablePixelChanged(92, 94) : false;
		const stableNoise = functionReady(api, "stablePixelChanged") ? api.stablePixelChanged(92, 93) : true;
		const cssPixel = functionReady(api, "cssPixel") ? api.cssPixel(92.6) : 0;
		return {
			ok: editable === true && checkboxEditable === false && measurement.keyboardShrunk === true && measurement.height === 520 && measurement.top === 16 && stableChanged === true && stableNoise === false && cssPixel === 93,
			editable,
			checkboxEditable,
			keyboardShrunk: Boolean(measurement.keyboardShrunk),
			height: Number(measurement.height) || 0,
			top: Number(measurement.top) || 0,
			stableChanged,
			stableNoise,
			cssPixel
		};
	}
	if (id === "conversation-scroll") {
		const nearBottom = functionReady(api, "isNearBottom") ? api.isNearBottom({
			scrollHeight: 1800,
			scrollTop: 725,
			clientHeight: 980
		}) : false;
		const notNearBottom = functionReady(api, "isNearBottom") ? api.isNearBottom({
			scrollHeight: 1800,
			scrollTop: 640,
			clientHeight: 980
		}) : true;
		const submittedFollow = functionReady(api, "createSubmittedMessageFollow") ? api.createSubmittedMessageFollow("thread-a", {
			clientSubmissionId: "submit-1",
			nowMs: 1e3,
			ttlMs: 5e3
		}) : null;
		const submittedActive = functionReady(api, "shouldFollowSubmittedMessage") ? api.shouldFollowSubmittedMessage(submittedFollow, {
			threadId: "thread-a",
			nowMs: 5999
		}) : false;
		const submittedWrongThread = functionReady(api, "shouldFollowSubmittedMessage") ? api.shouldFollowSubmittedMessage(submittedFollow, {
			threadId: "thread-b",
			nowMs: 2e3
		}) : true;
		const viewportFollow = functionReady(api, "createViewportFollow") ? api.createViewportFollow("thread-a", {
			reason: "orientation",
			nowMs: 1e3,
			ttlMs: 3e3
		}) : null;
		const viewportActive = functionReady(api, "shouldFollowViewport") ? api.shouldFollowViewport(viewportFollow, {
			threadId: "thread-a",
			nowMs: 3999
		}) : false;
		const lease = functionReady(api, "planBottomFollowLeaseEvaluation") ? api.planBottomFollowLeaseEvaluation({
			leaseActive: true,
			hasLease: true
		}) : {};
		const schedule = functionReady(api, "planBottomFollowScrollSchedule") ? api.planBottomFollowScrollSchedule() : {};
		const refresh = functionReady(api, "planAutomaticConversationRefresh") ? api.planAutomaticConversationRefresh({
			hasThread: true,
			nearBottom: false,
			userReadingCurrentTurn: true
		}) : {};
		const fullRender = functionReady(api, "planFullRenderScroll") ? api.planFullRenderScroll({ submittedMessageFollow: true }) : {};
		return {
			ok: nearBottom === true && notNearBottom === false && submittedFollow && submittedFollow.untilMs === 6e3 && submittedActive === true && submittedWrongThread === false && viewportFollow && viewportFollow.untilMs === 4e3 && viewportActive === true && lease.reason === "lease-active" && Array.isArray(schedule.delaysMs) && schedule.delaysMs.join(",") === "0,80,240,600,1200" && refresh.allowRefresh === false && refresh.reason === "user-reading-current-turn" && fullRender.stickToBottom === true && fullRender.reason === "submitted-message-follow",
			nearBottom,
			submittedActive,
			viewportActive,
			leaseReason: String(lease.reason || ""),
			scheduleDelays: Array.isArray(schedule.delaysMs) ? schedule.delaysMs : [],
			refreshReason: String(refresh.reason || ""),
			fullRenderReason: String(fullRender.reason || "")
		};
	}
	if (id === "thread-performance-metrics") {
		const listPhase = functionReady(api, "classifyThreadListPhase") ? api.classifyThreadListPhase({
			fallbackCacheDecision: "expired-rebuild",
			fallbackMs: 25
		}) : "";
		const detailPhase = functionReady(api, "classifyThreadDetailPhase") ? api.classifyThreadDetailPhase({
			readDecision: "projection-hit",
			projectionSource: "dynamic"
		}) : "";
		const clientTimings = functionReady(api, "threadDetailClientTimings") ? api.threadDetailClientTimings({
			elapsedMs: 26.4,
			renderElapsedMs: 7.2,
			detailRenderMode: "patch"
		}) : {};
		const detailFields = functionReady(api, "threadDetailEventFields") ? api.threadDetailEventFields({
			mobileDiagnostics: { threadDetailTimings: {
				phase: "warm-projection-cache",
				totalMs: 8
			} },
			turns: [{
				status: "completed",
				items: [{
					type: "userMessage",
					text: "prompt"
				}]
			}]
		}) : {};
		const shape = functionReady(api, "threadDetailShape") ? api.threadDetailShape({
			mobileOmittedTurnCount: 2,
			turns: [{
				status: "completed",
				items: [{
					type: "userMessage",
					text: "prompt"
				}]
			}, {
				status: "running",
				items: [{
					type: "agentMessage",
					text: "reply"
				}]
			}]
		}) : {};
		const slow = functionReady(api, "planThreadDetailSlowPathDiagnostic") ? api.planThreadDetailSlowPathDiagnostic({
			elapsedMs: 1600,
			apiElapsedMs: 1550,
			renderElapsedMs: 20,
			performancePhase: "cold-turns-list-initial"
		}, {
			action: "thread-detail-load",
			threadHash: "thread_hash",
			durationBucket: "1_3s"
		}) : {};
		return {
			ok: listPhase === "cold-fallback-expired-rebuild" && detailPhase === "warm-projection-dynamic" && clientTimings.elapsedMs === 26 && clientTimings.renderElapsedMs === 7 && clientTimings.detailRenderMode === "patch" && detailFields.performancePhase === "warm-projection-cache" && shape.turns === 2 && shape.visibleItems === 2 && shape.omittedTurns === 2 && shape.completedTurns === 1 && shape.activeTurns === 1 && slow.shouldReport === true && slow.reason === "api-slow",
			listPhase,
			detailPhase,
			elapsedMs: Number(clientTimings.elapsedMs) || 0,
			detailPerformancePhase: String(detailFields.performancePhase || ""),
			visibleItems: Number(shape.visibleItems) || 0,
			slowReason: String(slow.reason || "")
		};
	}
	if (id === "thread-detail-state") {
		const loadedThread = {
			id: "thread-a",
			title: "Thread A",
			status: "completed",
			mobileDetailLoaded: true,
			mobileLoading: false,
			turns: [{
				id: "turn-a",
				status: "completed",
				items: [{
					type: "userMessage",
					text: "hello"
				}]
			}],
			mobileProjection: { source: "sample" }
		};
		const summary = functionReady(api, "threadListSummaryFromDetailThread") ? api.threadListSummaryFromDetailThread(loadedThread) : {};
		const loaded = functionReady(api, "threadHasLoadedDetailState") ? api.threadHasLoadedDetailState(loadedThread) : false;
		const reusable = functionReady(api, "threadHasReusableLoadedDetailState") ? api.threadHasReusableLoadedDetailState(loadedThread) : false;
		const visualBaseline = functionReady(api, "threadHasVisualBaselineLoadedDetailState") ? api.threadHasVisualBaselineLoadedDetailState(Object.assign({}, loadedThread, { status: "active" })) : false;
		const cacheReuse = functionReady(api, "planThreadOpenCacheReuse") ? api.planThreadOpenCacheReuse({
			currentThread: loadedThread,
			threadId: "thread-a"
		}) : {};
		return {
			ok: summary && summary.id === "thread-a" && !Object.prototype.hasOwnProperty.call(summary, "turns") && !Object.prototype.hasOwnProperty.call(summary, "mobileProjection") && loaded === true && reusable === true && visualBaseline === true && cacheReuse && typeof cacheReuse === "object",
			summaryId: String(summary && summary.id || ""),
			summaryHasTurns: Object.prototype.hasOwnProperty.call(summary || {}, "turns"),
			loaded,
			reusable,
			visualBaseline,
			cacheReuseReason: String(cacheReuse.reason || "")
		};
	}
	if (id === "thread-detail-render-plan") {
		const backfill = functionReady(api, "planThreadDetailHistoryAutoBackfill") ? api.planThreadDetailHistoryAutoBackfill({
			hasOlder: true,
			thread: {
				mobileOlderTurnsCursor: "cursor-a",
				turns: [{ items: [{
					type: "assistantMessage",
					text: "[Cross-thread task card sent by source thread]"
				}] }]
			}
		}) : {};
		const request = functionReady(api, "planThreadDetailRefreshRequest") ? api.planThreadDetailRefreshRequest({
			threadId: "thread-a",
			threadLoadSeq: 7,
			options: { source: "auto-refresh" }
		}) : {};
		const postUpdate = functionReady(api, "planSingleThreadShellPostUpdateEffects") ? api.planSingleThreadShellPostUpdateEffects({
			bindCurrentThreadActions: true,
			updateTickTimer: true,
			publishPluginNavigationState: true,
			reason: "sample"
		}) : {};
		const normalizedSignature = functionReady(api, "normalizeSignature") ? api.normalizeSignature(42) : "";
		const effects = Array.isArray(postUpdate.effects) ? postUpdate.effects : [];
		return {
			ok: normalizedSignature === "42" && backfill.shouldLoad === true && backfill.reason === "sparse-conversation-context" && request.shouldRefresh === true && request.threadId === "thread-a" && request.requestedMode === "recent" && request.query && request.query.mode === "recent" && effects.map((entry) => String(entry && entry.type || "")).join(",") === "bind-current-thread-actions,update-tick-timer,publish-plugin-navigation-state",
			normalizedSignature,
			backfillReason: String(backfill.reason || ""),
			refreshReason: String(request.reason || ""),
			effectTypes: effects.map((entry) => String(entry && entry.type || ""))
		};
	}
	if (id === "thread-detail-dom-patch") {
		const patch = functionReady(api, "threadDetailPatchResult") ? api.threadDetailPatchResult(true, "patched", { patched: 2 }) : {};
		const mismatch = functionReady(api, "visibleTurnOrderMismatch") ? api.visibleTurnOrderMismatch({
			expectedTurnIds: ["a", "b"],
			renderedDomTurnIds: ["a", "c"]
		}) : false;
		const match = functionReady(api, "visibleTurnOrderMismatch") ? api.visibleTurnOrderMismatch({
			expectedTurnIds: ["a", "b"],
			renderedDomTurnIds: ["a", "b"]
		}) : true;
		const operation = functionReady(api, "normalizeOperation") ? api.normalizeOperation({
			type: "insert",
			key: "turn-a",
			nextEntry: {
				key: "turn-a",
				html: "<article></article>"
			}
		}) : null;
		const htmlUpdate = functionReady(api, "planConversationHtmlUpdate") ? api.planConversationHtmlUpdate({
			html: "<article data-turn-id=\"a\"></article>",
			previousHtml: "<article data-turn-id=\"a\"></article>",
			conversationSignature: "sig-a",
			previousConversationSignature: "sig-a"
		}) : {};
		return {
			ok: patch.ok === true && patch.reason === "patched" && patch.patched === 2 && mismatch === true && match === false && operation && operation.key === "turn-a" && htmlUpdate.action === "hydrate-existing" && htmlUpdate.reason === "signature-stable",
			patchReason: String(patch.reason || ""),
			patched: Number(patch.patched) || 0,
			mismatch,
			match,
			operationKey: String(operation && operation.key || ""),
			htmlAction: String(htmlUpdate.action || "")
		};
	}
	if (id === "draft-store") {
		const memory = /* @__PURE__ */ new Map();
		const store = functionReady(api, "createDraftStore") ? api.createDraftStore({
			storage: {
				getItem(key) {
					return memory.has(key) ? memory.get(key) : null;
				},
				setItem(key, value) {
					memory.set(key, String(value));
				},
				removeItem(key) {
					memory.delete(key);
				}
			},
			maxDrafts: 2
		}) : null;
		if (store && typeof store.writeMap === "function") {
			store.writeMap({
				old: {
					text: "old",
					updatedAt: 1
				},
				newest: {
					text: "newest",
					updatedAt: 3
				},
				middle: {
					text: "middle",
					updatedAt: 2
				}
			});
			store.setTargetKey("new:/repo");
		}
		const draftKeys = store && typeof store.readMap === "function" ? Object.keys(store.readMap()) : [];
		const threadKey = store && typeof store.keyForThread === "function" ? store.keyForThread(" abc ") : "";
		const newThreadKey = store && typeof store.keyForNewThread === "function" ? store.keyForNewThread("C:/Users/xuefu/project/") : "";
		const targetKey = store && typeof store.getTargetKey === "function" ? store.getTargetKey() : "";
		const parsed = functionReady(api, "parseDraftMap") ? api.parseDraftMap("{\"a\":{\"text\":\"draft\"}}") : {};
		const hasContent = functionReady(api, "draftHasContent") ? api.draftHasContent({ permissionMode: "full" }) : false;
		const meta = functionReady(api, "normalizeAttachmentMeta") ? api.normalizeAttachmentMeta({
			id: 7,
			file: {
				name: "screenshot.png",
				type: "image/png",
				size: 42,
				lastModified: 123
			}
		}) : null;
		const attachmentKey = functionReady(api, "attachmentStorageKey") ? api.attachmentStorageKey("new:/a b", "x/y") : "";
		const normalizedPath = functionReady(api, "defaultNormalizeFsPath") ? api.defaultNormalizeFsPath("C:/Users/xuefu/project/") : "";
		return {
			ok: threadKey === "thread:abc" && newThreadKey === "new:c:\\users\\xuefu\\project" && targetKey === "new:/repo" && draftKeys.join(",") === "newest,middle" && parsed && parsed.a && parsed.a.text === "draft" && hasContent === true && meta && meta.id === "7" && meta.size === 42 && attachmentKey === "new%3A%2Fa%20b|x%2Fy" && normalizedPath === "c:\\users\\xuefu\\project",
			threadKey,
			newThreadKey,
			targetKey,
			draftKeys,
			hasContent,
			attachmentKey,
			normalizedPath
		};
	}
	if (id === "image-compressor") {
		const compressible = functionReady(api, "isCompressibleImageFile") ? api.isCompressibleImageFile({
			type: "image/png",
			size: 300 * 1024
		}) : false;
		const smallImage = functionReady(api, "isCompressibleImageFile") ? api.isCompressibleImageFile({
			type: "image/png",
			size: 12 * 1024
		}) : true;
		const dims = functionReady(api, "targetDimensions") ? api.targetDimensions(3e3, 1500, 1200) : {};
		const name = functionReady(api, "compressedImageName") ? api.compressedImageName("folder/screen.png", "image/webp") : "";
		const useful = functionReady(api, "shouldUseCompressedBlob") ? api.shouldUseCompressedBlob({ size: 1e3 }, { size: 800 }) : false;
		const marginal = functionReady(api, "shouldUseCompressedBlob") ? api.shouldUseCompressedBlob({ size: 1e3 }, { size: 930 }) : true;
		return {
			ok: compressible === true && smallImage === false && dims.width === 1200 && dims.height === 600 && dims.scaled === true && name === "folder_screen.webp" && useful === true && marginal === false,
			compressible,
			smallImage,
			width: Number(dims.width) || 0,
			height: Number(dims.height) || 0,
			scaled: Boolean(dims.scaled),
			name,
			useful,
			marginal
		};
	}
	if (id === "plugin-voice-input") {
		const capability = functionReady(api, "capabilityStateMessage") ? api.capabilityStateMessage({
			writable: true,
			threadId: "thread-a",
			draftId: "draft-a",
			actions: [
				"append",
				"replace",
				"submit"
			],
			maxChars: 100
		}) : {};
		const start = functionReady(api, "startRequestMessage") ? api.startRequestMessage({
			requestId: "req-1",
			voiceSessionId: "voice-1",
			capability
		}) : {};
		const insert = functionReady(api, "insertResultMessage") ? api.insertResultMessage({
			ok: false,
			action: "append_text",
			code: "composer_not_writable",
			composerId: "thread-composer"
		}) : {};
		const error = functionReady(api, "errorMessage") ? api.errorMessage({
			code: "voice_error",
			error: "Voice failed"
		}) : {};
		const action = functionReady(api, "normalizeAction") ? api.normalizeAction("append") : "";
		const actionFromType = functionReady(api, "actionFromMessageType") ? api.actionFromMessageType("voice_input.replace_draft") : "";
		const text = functionReady(api, "textFromMessage") ? api.textFromMessage({ text: "  hello\xA0world  " }, 20) : "";
		const voiceMessage = functionReady(api, "isVoiceInputMessage") ? api.isVoiceInputMessage({ type: "voice_input.append_text" }) : false;
		return {
			ok: capability.type === "voice_input.capability_state" && capability.writable === true && Array.isArray(capability.actions) && capability.actions.join(",") === "append_text,replace_draft" && start.type === "voice_input.start_request" && start.requestId === "req-1" && insert.ok === false && insert.code === "composer_not_writable" && error.code === "voice_error" && action === "append_text" && actionFromType === "replace_draft" && text === "hello world" && voiceMessage === true,
			capabilityType: String(capability.type || ""),
			actions: Array.isArray(capability.actions) ? capability.actions : [],
			startType: String(start.type || ""),
			insertCode: String(insert.code || ""),
			errorCode: String(error.code || ""),
			action,
			actionFromType,
			text,
			voiceMessage
		};
	}
	if (id === "api-client") {
		function FakeFormData() {}
		const formData = new FakeFormData();
		const isFormData = functionReady(api, "isFormDataBody") ? api.isFormDataBody(formData, FakeFormData) : false;
		const jsonBody = functionReady(api, "isFormDataBody") ? api.isFormDataBody({ ok: true }, FakeFormData) : true;
		const client = functionReady(api, "createApiClient") ? api.createApiClient({
			fetch: () => Promise.resolve({
				ok: true,
				status: 204
			}),
			AbortControllerCtor: AbortController,
			FormDataCtor: FakeFormData,
			getKey: () => ""
		}) : null;
		return {
			ok: isFormData === true && jsonBody === false && client && typeof client.request === "function",
			isFormData,
			jsonBody,
			requestReady: Boolean(client && typeof client.request === "function")
		};
	}
	if (id === "markdown-renderer") {
		const escaped = functionReady(api, "escapeHtml") ? api.escapeHtml("<tag>&\"") : "";
		const safeUrl = functionReady(api, "safeMarkdownUrl") ? api.safeMarkdownUrl("https://example.com") : "";
		const unsafeUrl = functionReady(api, "safeMarkdownUrl") ? api.safeMarkdownUrl("javascript:alert(1)") : "unsafe";
		const inline = functionReady(api, "renderInlineMarkdown") ? api.renderInlineMarkdown("**bold** <https://example.com>, `code`") : "";
		const block = functionReady(api, "renderMarkdown") ? api.renderMarkdown("# Title\n\n- item\n- **bold**") : "";
		const tableSeparator = functionReady(api, "isMarkdownTableSeparator") ? api.isMarkdownTableSeparator("|---|:---:|") : false;
		const row = functionReady(api, "splitMarkdownTableRow") ? api.splitMarkdownTableRow("| A | B |") : [];
		const list = functionReady(api, "renderMarkdownList") ? api.renderMarkdownList(["1. one", "2. two"], true) : "";
		const table = functionReady(api, "renderMarkdownTable") ? api.renderMarkdownTable([
			"A | B",
			"---|---",
			"1 | 2"
		]) : "";
		return {
			ok: escaped === "&lt;tag&gt;&amp;&quot;" && safeUrl === "https://example.com" && unsafeUrl === "" && inline.includes("<strong>bold</strong>") && inline.includes("<code>code</code>") && block.includes("<h2>Title</h2>") && tableSeparator === true && Array.isArray(row) && row.join(",") === "A,B" && list.includes("<ol>") && table.includes("<table>"),
			escaped,
			safeUrl,
			unsafeUrl,
			row,
			inlineHasStrong: inline.includes("<strong>bold</strong>"),
			blockHasHeading: block.includes("<h2>Title</h2>"),
			listHasOl: list.includes("<ol>"),
			tableHasTable: table.includes("<table>")
		};
	}
	if (id === "plugin-embed") {
		const detected = functionReady(api, "detect") ? api.detect("http://127.0.0.1/?embed=hermes&pluginId=codex-mobile&pluginRoute=thread&pluginThreadId=t1&pluginTheme=dark&pluginFontSize=large") : {};
		const navigation = functionReady(api, "navigationMessage") ? api.navigationMessage({ currentThreadId: "t1" }, {}) : {};
		const openPlan = functionReady(api, "routeHintOpenPlan") ? api.routeHintOpenPlan({
			pluginId: "codex-mobile",
			threadId: "t1",
			itemId: "i1"
		}) : {};
		const selectors = functionReady(api, "routeHintTargetSelectors") ? api.routeHintTargetSelectors({ itemId: "i1" }) : [];
		const scrubbed = functionReady(api, "scrubRouteHintPath") ? api.scrubRouteHintPath("http://127.0.0.1/thread?pluginId=codex-mobile&pluginThreadId=t1", {
			workspaceId: "ws1",
			appearance: { theme: "dark" }
		}) : "";
		const external = functionReady(api, "externalLinkMessage") ? api.externalLinkMessage({ href: "https://example.com/a" }) : {};
		const refresh = functionReady(api, "refreshRequiredMessage") ? api.refreshRequiredMessage({
			reason: "version_changed",
			route: {
				kind: "thread",
				threadId: "t1"
			},
			appearance: { theme: "light" }
		}) : {};
		return {
			ok: detected.embedded === true && detected.routeHint && detected.routeHint.threadId === "t1" && detected.appearance && detected.appearance.theme === "dark" && navigation.type === "codex-mobile.plugin.navigation" && navigation.canGoBack === true && openPlan.action === "openThread" && Array.isArray(selectors) && selectors[0] === "[data-approval-card=\"i1\"]" && scrubbed === "/thread?embed=hermes&workspaceId=ws1&pluginTheme=dark" && external.type === "codex-mobile.plugin.external_link" && refresh.type === "codex-mobile.plugin.refresh_required",
			embedded: Boolean(detected.embedded),
			routeThreadId: String(detected.routeHint && detected.routeHint.threadId || ""),
			navigationType: String(navigation.type || ""),
			canGoBack: Boolean(navigation.canGoBack),
			openAction: String(openPlan.action || ""),
			firstSelector: String(selectors[0] || ""),
			scrubbed,
			externalType: String(external.type || ""),
			refreshType: String(refresh.type || "")
		};
	}
	if (id === "frontend-runtime-health") {
		const token = functionReady(api, "compactToken") ? api.compactToken(" Home AI / Thread Detail ", "fallback", 20) : "";
		const missingEffects = functionReady(api, "submittedMessageDomProbeEffects") ? api.submittedMessageDomProbeEffects({
			elapsedMs: 300,
			currentThreadMatch: true,
			hasThreadSubmission: true,
			domHasSubmission: false,
			threadHash: "abc"
		}) : {};
		const stallEffects = functionReady(api, "threadListInteractionStallEffects") ? api.threadListInteractionStallEffects({
			threadListVisible: true,
			threadListMonitorable: true,
			maxRafDelayMs: 640,
			minDelayMs: 500
		}) : {};
		const monitor = functionReady(api, "createMonitor") ? api.createMonitor({ now: () => 1e3 }) : null;
		const monitorResult = monitor && typeof monitor.recordRender === "function" ? monitor.recordRender({
			fullRender: false,
			fallbackApplied: false,
			previousCount: 2,
			domCount: 2,
			visibleCount: 2,
			duplicateCount: 0
		}) : {};
		const dropEvent = functionReady(api, "domDropEvent") ? api.domDropEvent({
			previousCount: 3,
			domCount: 1,
			visibleCount: 3
		}) : {};
		const success = functionReady(api, "runtimeSuccess") ? api.runtimeSuccess({
			diagnosticType: "render_dom_drop",
			errorCode: "render_dom_drop"
		}) : {};
		return {
			ok: token === "Home_AI_Thread_Detai" && missingEffects.reason === "submitted-message-dom-missing" && Array.isArray(missingEffects.effects) && missingEffects.effects[0] && missingEffects.effects[0].type === "diagnostic-failure" && stallEffects.reason === "thread-list-interaction-stall" && monitorResult.renderCount === 1 && Array.isArray(monitorResult.effects) && monitorResult.effects.length === 2 && dropEvent.diagnostic_type === "render_dom_drop" && success.error_code === "render_dom_drop",
			token,
			missingReason: String(missingEffects.reason || ""),
			stallReason: String(stallEffects.reason || ""),
			monitorRenderCount: Number(monitorResult.renderCount) || 0,
			dropDiagnosticType: String(dropEvent.diagnostic_type || ""),
			successErrorCode: String(success.error_code || "")
		};
	}
	if (id === "home-ai-diagnostic-reporting") {
		const token = functionReady(api, "boundedToken") ? api.boundedToken(" Home AI / Codex Mobile ", "fallback", 16) : "";
		const duration = functionReady(api, "durationBucket") ? api.durationBucket(4200) : "";
		const hash = functionReady(api, "hashIdentifier") ? api.hashIdentifier("thread-title", "t") : "";
		const sanitized = functionReady(api, "sanitizeInput") ? api.sanitizeInput({
			diagnostic_type: "render_lag",
			error_code: "lag",
			counts: {
				ok_count: 3,
				raw_body: 4
			},
			context: {
				thread_hash: "abc",
				title: "unsafe"
			}
		}) : {};
		const reporter = functionReady(api, "createDiagnosticReporter") ? api.createDiagnosticReporter({
			threshold: 2,
			throttleMs: 0,
			now: () => 1e3
		}) : null;
		const first = reporter && typeof reporter.recordFailure === "function" ? reporter.recordFailure({
			diagnostic_type: "render_lag",
			error_code: "lag"
		}) : {};
		const second = reporter && typeof reporter.recordFailure === "function" ? reporter.recordFailure({
			diagnostic_type: "render_lag",
			error_code: "lag"
		}) : {};
		const post = functionReady(api, "postReportToHomeAi") ? api.postReportToHomeAi({
			embedded: false,
			report: second.report
		}) : {};
		const textHash = functionReady(api, "stableTextHash") ? api.stableTextHash("diagnostic") : "";
		return {
			ok: token === "Home_AI_Codex_Mo" && duration === "3_10s" && /^t_/.test(hash) && sanitized.category === "codex_runtime_failure" && sanitized.counts && sanitized.counts.ok_count === 3 && !Object.prototype.hasOwnProperty.call(sanitized.counts || {}, "raw_body") && first.eligible === false && second.eligible === true && post.reason === "not_embedded" && textHash.length > 0,
			token,
			duration,
			hashPrefix: String(hash || "").slice(0, 2),
			sanitizedCategory: String(sanitized.category || ""),
			secondEligible: Boolean(second.eligible),
			postReason: String(post.reason || ""),
			textHash
		};
	}
	if (id === "thread-diagnostic-events") {
		const snapshot = functionReady(api, "conversationProjectionDiagnosticSnapshot") ? api.conversationProjectionDiagnosticSnapshot({
			renderedConversationSignature: "old",
			currentSignature: "new",
			domShape: {
				renderKeyCount: 1,
				duplicateRenderKeyCount: 1
			},
			thread: { mobileReadMode: "thread-read" }
		}, { visibleShape: () => ({
			visibleTurnCount: 2,
			visibleItemCount: 3
		}) }) : {};
		const order = functionReady(api, "turnOrderDiagnosticSnapshot") ? api.turnOrderDiagnosticSnapshot({
			expectedTurnIds: ["a", "b"],
			domTurnIds: ["a"],
			threadHash: "thread"
		}) : {};
		const effects = functionReady(api, "conversationProjectionConsistencyEffects") ? api.conversationProjectionConsistencyEffects({
			snapshot,
			orderSnapshot: order
		}) : {};
		const renderEvent = functionReady(api, "renderSignatureMismatchDiagnosticEvent") ? api.renderSignatureMismatchDiagnosticEvent(snapshot) : {};
		const responseEffects = functionReady(api, "threadDetailResponseDiagnosticEffects") ? api.threadDetailResponseDiagnosticEffects({ contractPlan: {
			shouldReport: true,
			reason: "contract",
			turns: 2,
			items: 3,
			visibleItems: 3,
			readMode: "thread-read"
		} }) : {};
		const normalized = functionReady(api, "projectionDiagnosticSnapshot") ? api.projectionDiagnosticSnapshot(snapshot) : {};
		const count = functionReady(api, "boundedCount") ? api.boundedCount(100001) : 0;
		const token = functionReady(api, "compactToken") ? api.compactToken(" Detail / Render ", "fallback", 20) : "";
		return {
			ok: snapshot.renderedSignature === "old" && normalized.counts && normalized.counts.visible_count === 3 && order.counts && order.counts.latest_mismatch_count === 1 && Array.isArray(effects.effects) && effects.effects.length === 3 && renderEvent.diagnostic_type === "render_signature_mismatch" && Array.isArray(responseEffects.effects) && responseEffects.effects[0] && responseEffects.effects[0].type === "diagnostic-failure" && count === 1e5 && token === "Detail_Render",
			renderedSignature: String(snapshot.renderedSignature || ""),
			visibleCount: Number(normalized.counts && normalized.counts.visible_count) || 0,
			latestMismatch: Number(order.counts && order.counts.latest_mismatch_count) || 0,
			effectCount: Array.isArray(effects.effects) ? effects.effects.length : 0,
			renderDiagnosticType: String(renderEvent.diagnostic_type || ""),
			responseEffectCount: Array.isArray(responseEffects.effects) ? responseEffects.effects.length : 0,
			count,
			token
		};
	}
	if (id === "thread-tile-layout") {
		const layout = functionReady(api, "layoutForViewport") ? api.layoutForViewport({
			enabled: true,
			viewportWidth: 1500,
			viewportHeight: 900,
			sidebarWidth: 0,
			coarsePointer: true,
			orientation: "landscape",
			menuOverlay: true
		}) : null;
		const ids = functionReady(api, "selectThreadTileIds") ? api.selectThreadTileIds({
			currentThreadId: "thread-2",
			pinnedThreadIds: ["thread-3", "thread-2"],
			threadIds: [
				"thread-1",
				"thread-3",
				"thread-4"
			],
			maxPanes: 3
		}) : [];
		const pinnedIds = functionReady(api, "selectPinnedThreadTileIds") ? api.selectPinnedThreadTileIds({
			currentThreadId: "thread-current",
			pinnedThreadIds: [
				"thread-1",
				"thread-2",
				"thread-3"
			],
			threadIds: ["thread-current", "thread-4"],
			maxPanes: 3
		}) : [];
		const pairs = functionReady(api, "normalizeSplitPairs") ? api.normalizeSplitPairs([{
			anchorId: "b",
			childId: "e"
		}, {
			anchorId: "b",
			childId: "c"
		}], [
			"a",
			"b",
			"c",
			"d",
			"e"
		]) : [];
		const groups = functionReady(api, "threadTileColumnGroups") ? api.threadTileColumnGroups({
			ids: [
				"a",
				"b",
				"c",
				"d",
				"e"
			],
			columns: 4,
			splitPairs: [{
				anchorId: "b",
				childId: "e"
			}]
		}) : [];
		return {
			ok: !!layout && layout.enabled === true && layout.columns === 4 && ids.join(",") === "thread-2,thread-3,thread-1" && pinnedIds.join(",") === "thread-1,thread-2,thread-current" && pairs.length === 1 && pairs[0].anchorId === "b" && pairs[0].childId === "e" && JSON.stringify(groups) === JSON.stringify([
				["a"],
				["b", "e"],
				["c"],
				["d"]
			]),
			layout,
			ids,
			pinnedIds,
			pairs,
			groups
		};
	}
	if (id === "thread-tile-actions") {
		const paneA = {
			disabled: false,
			getAttribute(name) {
				return name === "data-thread-tile-pane" ? "thread-a" : "";
			},
			closest() {
				return null;
			}
		};
		const paneB = {
			disabled: false,
			getAttribute(name) {
				return name === "data-thread-tile-pane" ? "thread-b" : "";
			},
			closest() {
				return null;
			}
		};
		const title = {
			disabled: false,
			getAttribute(name) {
				return name === "data-thread-tile-title" ? "thread-a" : "";
			},
			closest(selector) {
				return selector === "[data-thread-tile-pane]" ? paneA : null;
			}
		};
		const handle = {
			disabled: false,
			getAttribute(name) {
				return name === "data-thread-tile-drag-handle" ? "thread-a" : "";
			},
			closest(selector) {
				return selector === "[data-thread-tile-pane]" ? paneA : null;
			}
		};
		const bottom = {
			disabled: false,
			getAttribute(name) {
				return name === "data-thread-tile-bottom" ? "thread-a" : "";
			},
			closest() {
				return null;
			}
		};
		const root = { contains(node) {
			return node === paneA || node === paneB || node === title || node === handle || node === bottom;
		} };
		const titleTarget = { closest(selector) {
			return selector === "[data-thread-tile-title]" ? title : selector === "[data-thread-tile-pane]" ? paneA : null;
		} };
		const bottomTarget = { closest(selector) {
			return selector === "[data-thread-tile-bottom]" ? bottom : null;
		} };
		const handleTarget = { closest(selector) {
			return selector === "[data-thread-tile-drag-handle]" ? handle : null;
		} };
		const paneBTarget = { closest(selector) {
			return selector === "[data-thread-tile-pane]" ? paneB : null;
		} };
		const pointer = functionReady(api, "resolveThreadTilePointerAction") ? api.resolveThreadTilePointerAction({
			root,
			target: titleTarget
		}) : {};
		const click = functionReady(api, "resolveThreadTileClickAction") ? api.resolveThreadTileClickAction({
			root,
			target: bottomTarget
		}) : {};
		const dragStart = functionReady(api, "resolveThreadTileDragStartAction") ? api.resolveThreadTileDragStartAction({
			root,
			target: handleTarget
		}) : {};
		const drop = functionReady(api, "resolveThreadTileDropAction") ? api.resolveThreadTileDropAction({
			root,
			target: paneBTarget,
			draggingId: "thread-a"
		}) : {};
		return {
			ok: pointer.action === "select-pane" && pointer.paneId === "thread-a" && click.action === "scroll-pane-bottom" && click.preventDefault === true && dragStart.action === "drag-start" && dragStart.paneId === "thread-a" && drop.action === "drop-pane" && drop.draggingId === "thread-a" && drop.targetId === "thread-b",
			pointerAction: String(pointer.action || ""),
			clickAction: String(click.action || ""),
			dragStartAction: String(dragStart.action || ""),
			dropAction: String(drop.action || "")
		};
	}
	if (id === "thread-tile-state") {
		const candidate = functionReady(api, "candidatePaneIdsPlan") ? api.candidatePaneIdsPlan({
			defaultIds: ["thread-a", "thread-b"],
			visibleIds: ["thread-a", "thread-b"],
			pinnedIds: ["thread-b"],
			currentThreadId: "thread-a",
			maxPanes: 2
		}) : {};
		const paneCount = functionReady(api, "normalizePaneCount") ? api.normalizePaneCount("3", { maxPanes: 12 }) : 0;
		const refreshDelay = functionReady(api, "refreshDelayMs") ? api.refreshDelayMs({
			visible: true,
			active: true
		}) : 0;
		const loadSuccess = functionReady(api, "detailLoadSuccessEffectsPlan") ? api.detailLoadSuccessEffectsPlan({
			threadId: "thread-a",
			hasThread: true,
			nowMs: 1234
		}) : {};
		const selected = functionReady(api, "effectiveSelectedThreadId") ? api.effectiveSelectedThreadId({
			ids: ["thread-a", "thread-b"],
			selectedThreadId: "thread-a",
			currentThreadId: "thread-b"
		}) : "";
		return {
			ok: candidate.action === "candidate-pane-ids" && candidate.ids && candidate.ids.join(",") === "thread-b,thread-a" && paneCount === 3 && refreshDelay === 500 && loadSuccess.reason === "thread-loaded" && loadSuccess.loadedAtMs === 1234 && selected === "thread-a",
			candidateIds: Array.isArray(candidate.ids) ? candidate.ids : [],
			paneCount,
			refreshDelay,
			loadSuccessReason: String(loadSuccess.reason || ""),
			selected
		};
	}
	if (id === "thread-tile-runtime") {
		const statePolicy = globalThis.CodexThreadTileState || {};
		const layoutPolicy = globalThis.CodexThreadTileLayout || {};
		const actionsApi = globalThis.CodexThreadTileActions || {};
		const runtime = functionReady(api, "createThreadTileRuntime") ? api.createThreadTileRuntime({
			state: {
				threadTileMode: true,
				threadTilePaneCount: "3",
				threadTilePinnedThreadIds: [
					"thread-b",
					"thread-a",
					"thread-b"
				],
				threadTileSplitPairs: [{
					anchorId: "thread-a",
					childId: "thread-c"
				}],
				threads: [
					{
						id: "thread-a",
						status: "running"
					},
					{
						id: "thread-b",
						status: "idle"
					},
					{
						id: "thread-c",
						status: "idle"
					}
				],
				currentThreadId: "thread-b",
				threadDisplaySettingsLoaded: true,
				threadTileViewportBaseline: null,
				threadTileComposerHeightBaselinePx: 0,
				composerHeightPx: 0
			},
			document: {
				documentElement: {
					clientWidth: 1400,
					clientHeight: 900
				},
				activeElement: null
			},
			window: {
				innerWidth: 1400,
				innerHeight: 900,
				visualViewport: {
					width: 1320,
					height: 820
				},
				matchMedia: () => ({ matches: false })
			},
			threadTileStatePolicy: statePolicy,
			threadTileLayoutPolicy: layoutPolicy,
			threadTileActionsApi: actionsApi,
			THREAD_TILE_USER_MAX_PANES: 6,
			THREAD_TILE_REFRESH_INTERVAL_MS: 5e3,
			THREAD_TILE_REFRESH_MIN_INTERVAL_MS: 500,
			STORAGE_THREAD_DISPLAY_MODE: "codex.threadDisplayMode",
			STORAGE_LEGACY_THREAD_TILE_MODE: "codex.legacyThreadTileMode",
			$: () => null,
			isKeyboardEditableElement: () => false,
			splitPaneSidebarVisible: () => false,
			isMenuOverlayMode: () => false,
			visibleThreads: (threads) => Array.isArray(threads) ? threads : [],
			isRunningStatus: (status) => status === "running" || status === "in_progress"
		}) : {};
		const viewport = runtime && typeof runtime.viewportPixelSize === "function" ? runtime.viewportPixelSize({ preferLayoutViewport: true }) : {};
		const paneCount = runtime && typeof runtime.normalizeThreadTilePaneCount === "function" ? runtime.normalizeThreadTilePaneCount("3", 1) : 0;
		const pinnedIds = runtime && typeof runtime.normalizeThreadTilePinnedIds === "function" ? runtime.normalizeThreadTilePinnedIds([
			"thread-b",
			"thread-a",
			"thread-b"
		]) : [];
		const idsEqual = runtime && typeof runtime.threadTileIdsEqual === "function" ? runtime.threadTileIdsEqual(["thread-a", "thread-b"], ["thread-a", "thread-b"]) : false;
		const payload = runtime && typeof runtime.threadDisplaySettingsPayload === "function" ? runtime.threadDisplaySettingsPayload() : {};
		const layout = runtime && typeof runtime.threadTileLayout === "function" ? runtime.threadTileLayout({ enabled: true }) : {};
		const status = runtime && typeof runtime.threadTileLayoutStatusText === "function" ? runtime.threadTileLayoutStatusText(layout) : "";
		return {
			ok: runtime && typeof runtime === "object" && viewport.width === 1400 && viewport.height === 900 && paneCount === 3 && pinnedIds.join(",") === "thread-b,thread-a" && idsEqual === true && payload.displayMode === "tile" && payload.paneCount === 3 && layout.enabled === true && status === "当前视口：平铺 3/3 窗",
			factoryType: typeof api.createThreadTileRuntime,
			viewportWidth: Number(viewport.width) || 0,
			viewportHeight: Number(viewport.height) || 0,
			paneCount,
			pinnedIds,
			idsEqual,
			displayMode: String(payload.displayMode || ""),
			layoutColumns: Number(layout.columns) || 0,
			status
		};
	}
	if (id === "app-update-runtime") {
		const runtime = functionReady(api, "createAppUpdateRuntime") ? api.createAppUpdateRuntime({
			CLIENT_BUILD_ID: "0.1.11|codex-mobile-shell-v625-a5a3d596240d",
			state: {
				appVersion: "0.1.11",
				publicReleaseEnabled: true
			},
			PAGE_SHELL_ASSETS: ["/app.js", "/sw.js"],
			escapeHtml: (value) => String(value == null ? "" : value),
			buildRefreshPolicy: { shouldPromptForServerBuildChange: () => true }
		}) : null;
		const client = runtime && typeof runtime.clientBuildVersionText === "function" ? runtime.clientBuildVersionText() : "";
		const version = runtime && typeof runtime.appVersionText === "function" ? runtime.appVersionText({ version: "0.1.11" }) : "";
		const fullVersion = runtime && typeof runtime.fullClientBuildVersionText === "function" ? runtime.fullClientBuildVersionText({
			clientBuildId: "0.1.11|codex-mobile-shell-v625-a5a3d596240d",
			shellCacheName: "codex-mobile-shell-v625-a5a3d596240d"
		}) : "";
		const updateLine = runtime && typeof runtime.updateStatusLine === "function" ? runtime.updateStatusLine({
			updateAvailable: true,
			canFastForward: true,
			remoteShort: "abc123"
		}) : "";
		const publicLine = runtime && typeof runtime.publicReleaseStatusLine === "function" ? runtime.publicReleaseStatusLine({
			updateAvailable: true,
			publicShort: "def456"
		}) : "";
		const serverBuild = runtime && typeof runtime.serverBuildIdFromConfig === "function" ? runtime.serverBuildIdFromConfig({
			clientBuildId: "client-a",
			shellCacheName: "cache-a"
		}) : "";
		return {
			ok: runtime && typeof runtime.refreshPageForNewBuild === "function" && client === "客户端 v625" && version === "v0.1.11 · 客户端 v625" && fullVersion === "clientBuildId 0.1.11|codex-mobile-shell-v625-a5a3d596240d · shellCacheName codex-mobile-shell-v625-a5a3d596240d" && updateLine === "Update available: abc123" && publicLine === "Public latest: def456" && serverBuild === "client-a",
			client,
			version,
			fullVersion,
			updateLine,
			publicLine,
			serverBuild,
			refreshReady: Boolean(runtime && typeof runtime.refreshPageForNewBuild === "function")
		};
	}
	if (id === "modal-runtime") {
		const runtime = functionReady(api, "createModalRuntime") ? api.createModalRuntime() : {};
		return {
			ok: runtime && typeof runtime === "object" && typeof runtime.requestAppNativeDialog === "function" && typeof runtime.requestAppAlert === "function" && typeof runtime.requestAppConfirmation === "function" && typeof runtime.requestAppTextInput === "function" && typeof runtime.requestCodexProfileSwitchConfirmation === "function" && typeof globalThis.handleAppNativeDialogKeydown === "function" && typeof globalThis.closeAppNativeDialog === "function" && typeof globalThis.performCodexProfileSwitch === "function",
			factoryType: typeof api.createModalRuntime,
			nativeDialogType: typeof (runtime && runtime.requestAppNativeDialog),
			alertType: typeof (runtime && runtime.requestAppAlert),
			confirmationType: typeof (runtime && runtime.requestAppConfirmation),
			textInputType: typeof (runtime && runtime.requestAppTextInput),
			profileSwitchType: typeof (runtime && runtime.requestCodexProfileSwitchConfirmation),
			keydownType: typeof globalThis.handleAppNativeDialogKeydown,
			closeType: typeof globalThis.closeAppNativeDialog,
			switchType: typeof globalThis.performCodexProfileSwitch
		};
	}
	if (id === "navigation-runtime") {
		const runtime = functionReady(api, "createNavigationRuntime") ? api.createNavigationRuntime() : {};
		return {
			ok: runtime && typeof runtime === "object" && typeof runtime.updateConnectionState === "function" && typeof runtime.restoreConnectionState === "function" && typeof runtime.markActivity === "function" && typeof runtime.composerTargetPlan === "function" && typeof runtime.visibleTurnsForConversation === "function" && typeof runtime.conversationRenderSignature === "function" && typeof runtime.updateTurnTimer === "function" && typeof globalThis.updateConnectionState === "function" && typeof globalThis.composerTargetPlan === "function" && typeof globalThis.visibleTurnsForConversation === "function",
			factoryType: typeof api.createNavigationRuntime,
			updateType: typeof (runtime && runtime.updateConnectionState),
			restoreType: typeof (runtime && runtime.restoreConnectionState),
			activityType: typeof (runtime && runtime.markActivity),
			composerPlanType: typeof (runtime && runtime.composerTargetPlan),
			visibleTurnsType: typeof (runtime && runtime.visibleTurnsForConversation),
			signatureType: typeof (runtime && runtime.conversationRenderSignature),
			timerType: typeof (runtime && runtime.updateTurnTimer),
			globalUpdateType: typeof globalThis.updateConnectionState,
			globalComposerPlanType: typeof globalThis.composerTargetPlan,
			globalVisibleTurnsType: typeof globalThis.visibleTurnsForConversation
		};
	}
	if (id === "runtime-wiring-runtime") {
		const runtime = functionReady(api, "createRuntimeWiringRuntime") ? api.createRuntimeWiringRuntime() : {};
		return {
			ok: runtime && typeof runtime === "object" && typeof runtime.initialize === "function",
			factoryType: typeof api.createRuntimeWiringRuntime,
			initializeType: typeof (runtime && runtime.initialize),
			globalType: typeof globalThis.CodexRuntimeWiringRuntime
		};
	}
	if (id === "app-shell-runtime") {
		const runtime = functionReady(api, "createAppShellRuntime") ? api.createAppShellRuntime() : {};
		return {
			ok: runtime && typeof runtime === "object" && typeof runtime.wireUi === "function" && typeof runtime.start === "function" && typeof runtime.startCodexMobileAppWithRecovery === "function",
			factoryType: typeof api.createAppShellRuntime,
			wireUiType: typeof (runtime && runtime.wireUi),
			startType: typeof (runtime && runtime.start),
			recoveryType: typeof (runtime && runtime.startCodexMobileAppWithRecovery),
			globalType: typeof globalThis.CodexAppShellRuntime
		};
	}
	if (id === "pane-layout-runtime") {
		const runtime = functionReady(api, "createPaneLayoutRuntime") ? api.createPaneLayoutRuntime() : {};
		return {
			ok: runtime && typeof runtime === "object" && typeof runtime.renderCurrentThread === "function" && typeof runtime.updateConversationHtml === "function" && typeof runtime.patchCurrentThreadDetailFromRefresh === "function" && typeof runtime.syncThreadTileToggle === "function" && typeof runtime.setThreadTileMode === "function" && typeof runtime.renderHome === "function" && typeof runtime.loadThread === "function" && typeof runtime.loadThreads === "function" && typeof runtime.enterNewThreadDraft === "function" && typeof runtime.handleThreadCardClick === "function" && typeof runtime.showHermesPluginPrimaryPage === "function" && typeof runtime.returnToThreadListFromDetail === "function" && typeof globalThis.loadThread === "function" && typeof globalThis.loadThreads === "function" && typeof globalThis.renderCurrentThread === "function",
			factoryType: typeof api.createPaneLayoutRuntime,
			renderType: typeof (runtime && runtime.renderCurrentThread),
			updateHtmlType: typeof (runtime && runtime.updateConversationHtml),
			patchType: typeof (runtime && runtime.patchCurrentThreadDetailFromRefresh),
			tileToggleType: typeof (runtime && runtime.syncThreadTileToggle),
			tileModeType: typeof (runtime && runtime.setThreadTileMode),
			homeType: typeof (runtime && runtime.renderHome),
			loadThreadType: typeof (runtime && runtime.loadThread),
			loadThreadsType: typeof (runtime && runtime.loadThreads),
			newThreadType: typeof (runtime && runtime.enterNewThreadDraft),
			cardClickType: typeof (runtime && runtime.handleThreadCardClick),
			pluginPrimaryType: typeof (runtime && runtime.showHermesPluginPrimaryPage),
			returnType: typeof (runtime && runtime.returnToThreadListFromDetail),
			globalLoadThreadType: typeof globalThis.loadThread,
			globalLoadThreadsType: typeof globalThis.loadThreads,
			globalRenderType: typeof globalThis.renderCurrentThread
		};
	}
	if (id === "thread-list-runtime") {
		const runtime = functionReady(api, "createThreadListRuntime") ? api.createThreadListRuntime({}) : {};
		return {
			ok: runtime && typeof runtime === "object" && typeof runtime.renderThreads === "function" && typeof runtime.loadThreads === "function",
			factoryType: typeof api.createThreadListRuntime,
			renderThreadsType: typeof (runtime && runtime.renderThreads),
			loadThreadsType: typeof (runtime && runtime.loadThreads)
		};
	}
	if (id === "side-chat-runtime") {
		const state = {
			currentThreadId: "thread-a",
			currentThread: { id: "thread-a" },
			threadSideChats: /* @__PURE__ */ new Map(),
			nowMs: Date.parse("2026-07-02T00:00:00Z")
		};
		const runtime = functionReady(api, "createSideChatRuntime") ? api.createSideChatRuntime({
			state,
			api: async () => ({ sideChat: null }),
			escapeHtml: (value) => String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
			statusText: (status) => String(status || ""),
			formatTime: () => "now",
			truncateMiddle: (value) => String(value || "")
		}) : {};
		const normalized = runtime && typeof runtime.normalizeSideChatState === "function" ? runtime.normalizeSideChatState({
			messages: [{
				role: "assistant",
				text: "hi"
			}],
			sidecar: { status: "pending" }
		}, "thread-a") : {};
		if (runtime && typeof runtime.setSideChatState === "function") runtime.setSideChatState("thread-a", normalized);
		const path = runtime && typeof runtime.sideChatApiPath === "function" ? runtime.sideChatApiPath("thread-a", "/draft") : "";
		const status = runtime && typeof runtime.sideChatStatusLabel === "function" ? runtime.sideChatStatusLabel("queued") : "";
		const queue = runtime && typeof runtime.sideChatQueueSummary === "function" ? runtime.sideChatQueueSummary({
			status: "queued",
			mode: "autoSendWhenIdle"
		}) : "";
		const pending = runtime && typeof runtime.sideChatReplyPending === "function" ? runtime.sideChatReplyPending("thread-a") : false;
		const subagentKind = runtime && typeof runtime.subagentStatusKind === "function" ? runtime.subagentStatusKind("running") : "";
		const subagentLabel = runtime && typeof runtime.subagentStatusLabel === "function" ? runtime.subagentStatusLabel("running") : "";
		const panel = runtime && typeof runtime.renderSideChatPanel === "function" ? runtime.renderSideChatPanel() : "";
		return {
			ok: runtime && typeof runtime === "object" && normalized.threadId === "thread-a" && Array.isArray(normalized.messages) && normalized.messages.length === 1 && path === "/api/threads/thread-a/side-chat/draft" && status === "已排队" && queue === "已排队 · 完成后自动发送" && pending === true && subagentKind === "running" && subagentLabel === "运行中" && String(panel || "").includes("side-chat-section"),
			factoryType: typeof api.createSideChatRuntime,
			normalizedThreadId: String(normalized.threadId || ""),
			messageCount: Array.isArray(normalized.messages) ? normalized.messages.length : 0,
			path,
			status,
			queue,
			pending,
			subagentKind,
			subagentLabel,
			panelReady: String(panel || "").includes("side-chat-section")
		};
	}
	if (id === "media-preview-runtime") {
		const element = {
			classList: {
				contains: () => false,
				add: () => {},
				remove: () => {},
				toggle: () => {}
			},
			dataset: {},
			style: {
				setProperty: () => {},
				removeProperty: () => {}
			},
			querySelector: () => null,
			querySelectorAll: () => [],
			closest: () => null,
			addEventListener: () => {},
			removeEventListener: () => {},
			appendChild: () => {},
			setAttribute: () => {},
			getAttribute: () => "",
			removeAttribute: () => {},
			textContent: "",
			innerText: id === "messageInput" ? "hello" : "",
			innerHTML: ""
		};
		const document = {
			documentElement: {
				getAttribute: () => "light",
				setAttribute: () => {}
			},
			head: element,
			createElement: () => Object.assign({}, element),
			getElementById: () => Object.assign({}, element),
			querySelector: () => null,
			querySelectorAll: () => []
		};
		const runtime = functionReady(api, "createMediaPreviewRuntime") ? api.createMediaPreviewRuntime({
			state: {
				key: "sample-key",
				currentThreadId: "thread-a",
				currentThread: { id: "thread-a" }
			},
			document,
			window: {
				location: {
					origin: "http://127.0.0.1:8787",
					pathname: "/"
				},
				CodexMarkdownRenderer: {
					renderMarkdown: (value) => `<p>${String(value == null ? "" : value)}</p>`,
					normalizeMermaidSourceForRender: (value) => String(value || "")
				},
				matchMedia: () => ({ matches: true }),
				setTimeout: (callback) => {
					if (typeof callback === "function") callback();
					return 1;
				},
				clearTimeout: () => {}
			},
			$: () => Object.assign({}, element),
			api: async () => ({}),
			escapeHtml: (value) => String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
			normalizeFsPath: (value) => String(value || ""),
			shortPath: (value) => String(value || "").split("/").pop() || "",
			compactStructuredForSignature: (value) => JSON.stringify(value),
			visibleThreadTaskCardCommandText: (value) => String(value || ""),
			rememberCopyText: (value) => String(value || ""),
			copyButtonHtml: () => "<button></button>",
			stableTextHash: (value) => `hash:${String(value || "").length}`,
			renderContextThreadId: () => "thread-a",
			publishPluginNavigationState: () => {},
			postPerformanceEvent: () => {},
			roundedDurationMs: () => 1,
			nowPerfMs: () => 1,
			isHermesEmbedMode: () => false,
			isIosWebKitBrowser: () => false,
			requestHermesPluginRefresh: () => {},
			primaryTouch: (event) => event && event.touches && event.touches[0] || null
		}) : {};
		const githubUrl = runtime && typeof runtime.normalizeGithubPreviewUrl === "function" ? runtime.normalizeGithubPreviewUrl("https://github.com/openai/codex/pull/7") : "";
		const jsonPreview = runtime && typeof runtime.renderFilePreviewContent === "function" ? runtime.renderFilePreviewContent({
			kind: "json",
			content: "{\"ok\":true}"
		}) : "";
		return {
			ok: runtime && typeof runtime === "object" && githubUrl === "https://github.com/openai/codex/pull/7" && String(jsonPreview || "").includes("file-preview-text") && typeof runtime.renderMarkdownWithAttachmentSummary === "function" && typeof runtime.openImagePreviewFromImage === "function" && typeof runtime.renderImageView === "function" && typeof runtime.scheduleVisibleImageFailureScan === "function",
			factoryType: typeof api.createMediaPreviewRuntime,
			githubUrl,
			jsonPreviewReady: String(jsonPreview || "").includes("file-preview-text"),
			markdownType: typeof (runtime && runtime.renderMarkdownWithAttachmentSummary),
			imagePreviewType: typeof (runtime && runtime.openImagePreviewFromImage),
			imageViewType: typeof (runtime && runtime.renderImageView),
			scanType: typeof (runtime && runtime.scheduleVisibleImageFailureScan)
		};
	}
	if (id === "composer-runtime") {
		const elements = /* @__PURE__ */ new Map();
		const element = (id = "") => ({
			id,
			value: id === "messageInput" ? "hello" : "",
			files: [],
			classList: {
				contains: () => false,
				add: () => {},
				remove: () => {},
				toggle: () => {}
			},
			dataset: {},
			style: {
				setProperty: () => {},
				removeProperty: () => {}
			},
			getBoundingClientRect: () => ({
				width: 120,
				height: 32,
				left: 0,
				top: 0,
				right: 120,
				bottom: 32
			}),
			focus: () => {},
			blur: () => {},
			select: () => {},
			setSelectionRange: () => {},
			querySelector: () => null,
			querySelectorAll: () => [],
			closest: () => null,
			addEventListener: () => {},
			removeEventListener: () => {},
			appendChild: () => {},
			setAttribute: () => {},
			getAttribute: () => "",
			removeAttribute: () => {},
			textContent: "",
			innerHTML: ""
		});
		function getElement(id) {
			if (!elements.has(id)) elements.set(id, element(id));
			return elements.get(id);
		}
		const runtime = functionReady(api, "createComposerRuntime") ? api.createComposerRuntime({
			state: {
				threads: [],
				pendingAttachments: [],
				composerRuntimeSelection: {},
				codexProfiles: [],
				currentThreadId: "thread-a",
				currentThread: { id: "thread-a" },
				newThreadDraft: false
			},
			document: {
				documentElement: { style: {
					setProperty: () => {},
					removeProperty: () => {}
				} },
				activeElement: null,
				addEventListener: () => {},
				removeEventListener: () => {},
				createElement: () => element(),
				getElementById: getElement,
				querySelector: () => null,
				querySelectorAll: () => []
			},
			window: {
				setTimeout: (callback) => {
					if (typeof callback === "function") callback();
					return 1;
				},
				clearTimeout: () => {},
				requestAnimationFrame: (callback) => {
					if (typeof callback === "function") callback();
					return 1;
				},
				crypto: { randomUUID: () => "sample-uuid" },
				visualViewport: {
					width: 390,
					height: 700
				},
				innerWidth: 390,
				innerHeight: 700
			},
			$: getElement,
			api: async () => ({}),
			escapeHtml: (value) => String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
			viewportMetrics: {
				cssPixel: (value) => Math.round(Number(value) || 0),
				stablePixelChanged: (left, right) => Math.abs((Number(left) || 0) - (Number(right) || 0)) >= 2
			},
			normalizeOptionList: (values) => Array.isArray(values) ? values.filter(Boolean).map((value) => String(value).trim()) : [],
			labelForModel: (value) => `Model ${String(value || "")}`.trim(),
			labelForEffort: (value) => `Effort ${String(value || "")}`.trim(),
			labelForPermissionMode: (value) => `Permission ${String(value || "")}`.trim(),
			defaultNewThreadModel: () => "gpt-5.5",
			defaultNewThreadEffort: () => "medium",
			defaultNewThreadPermissionMode: () => "auto",
			effectiveComposerPermissionMode: (value) => String(value || "").trim() || "auto",
			newThreadSelectedModel: () => "",
			newThreadSelectedEffort: () => "",
			newThreadSelectedPermissionMode: () => "",
			currentComposerThreadId: () => "thread-a",
			composerTargetThread: () => ({
				id: "thread-a",
				model: "gpt-5.5",
				effort: "medium",
				runtimeSettings: { permissionMode: "auto" }
			}),
			selectedQuotaModel: () => "gpt-5.5",
			threadDisplayName: () => "Thread A",
			isThreadTileComposerContext: () => false,
			isAndroidBrowser: () => false,
			isHermesEmbedMode: () => false,
			isKeyboardEditableElement: () => false,
			threadTileStatePolicy: { composerTargetPlaceholderPlan: () => ({ text: "Send to Thread A" }) },
			imageCompressor: {},
			homeAiDiagnosticReportingApi: {}
		}) : {};
		const model = runtime && typeof runtime.effectiveDefaultModel === "function" ? runtime.effectiveDefaultModel() : "";
		const effort = runtime && typeof runtime.effectiveDefaultEffort === "function" ? runtime.effectiveDefaultEffort() : "";
		const permission = runtime && typeof runtime.effectiveDefaultPermissionMode === "function" ? runtime.effectiveDefaultPermissionMode() : "";
		const label = runtime && typeof runtime.runtimeOptionLabel === "function" ? runtime.runtimeOptionLabel("model", "gpt-5.5") : "";
		const placeholder = runtime && typeof runtime.composerPlaceholderText === "function" ? runtime.composerPlaceholderText() : "";
		return {
			ok: runtime && typeof runtime === "object" && model === "gpt-5.5" && effort === "medium" && permission === "auto" && label === "Model gpt-5.5" && placeholder === "Send to Thread A" && typeof runtime.sendMessage === "function" && typeof runtime.sendNewThreadMessage === "function" && typeof runtime.interruptActiveTurn === "function",
			factoryType: typeof api.createComposerRuntime,
			model,
			effort,
			permission,
			label,
			placeholder,
			sendType: typeof (runtime && runtime.sendMessage),
			newThreadType: typeof (runtime && runtime.sendNewThreadMessage),
			interruptType: typeof (runtime && runtime.interruptActiveTurn)
		};
	}
	if (id === "composer-bridge-runtime") {
		const runtime = functionReady(api, "createComposerBridgeRuntime") ? api.createComposerBridgeRuntime() : {};
		return {
			ok: runtime && typeof runtime === "object" && typeof runtime.sendMessage === "function" && typeof runtime.sendNewThreadMessage === "function" && typeof runtime.answerServerRequest === "function" && typeof runtime.answerApproval === "function" && typeof runtime.declineServerRequest === "function" && typeof runtime.mutateThreadTaskCard === "function" && typeof runtime.replyTaskCard === "function" && typeof runtime.queueThreadTaskCardDraftCreation === "function" && typeof runtime.createThreadTaskCardDraft === "function" && typeof runtime.closeQuotaDetails === "function" && typeof runtime.toggleQuotaDetails === "function" && typeof globalThis.sendMessage === "function" && typeof globalThis.answerApproval === "function" && typeof globalThis.mutateThreadTaskCard === "function" && typeof globalThis.queueThreadTaskCardDraftCreation === "function",
			factoryType: typeof api.createComposerBridgeRuntime,
			sendType: typeof (runtime && runtime.sendMessage),
			answerType: typeof (runtime && runtime.answerServerRequest),
			approvalType: typeof (runtime && runtime.answerApproval),
			mutateType: typeof (runtime && runtime.mutateThreadTaskCard),
			replyType: typeof (runtime && runtime.replyTaskCard),
			draftType: typeof (runtime && runtime.createThreadTaskCardDraft),
			closeQuotaType: typeof (runtime && runtime.closeQuotaDetails),
			toggleQuotaType: typeof (runtime && runtime.toggleQuotaDetails),
			globalSendType: typeof globalThis.sendMessage,
			globalApprovalType: typeof globalThis.answerApproval,
			globalMutateType: typeof globalThis.mutateThreadTaskCard,
			globalDraftQueueType: typeof globalThis.queueThreadTaskCardDraftCreation
		};
	}
	if (id === "api-client-runtime") {
		const runtime = functionReady(api, "createApiClientRuntime") ? api.createApiClientRuntime() : {};
		return {
			ok: runtime && typeof runtime === "object" && typeof runtime.api === "function" && typeof runtime.postClientEvent === "function" && typeof runtime.postPerformanceEvent === "function" && typeof runtime.recordHomeAiDiagnosticFailure === "function" && typeof runtime.recordHomeAiDiagnosticSuccess === "function" && typeof runtime.scheduleSubmittedMessageDomProbe === "function" && typeof runtime.checkConversationProjectionConsistency === "function" && typeof runtime.handlePushButtonClick === "function" && typeof globalThis.api === "function" && typeof globalThis.postClientEvent === "function" && typeof globalThis.diagnosticThreadHash === "function" && typeof globalThis.recordHomeAiDiagnosticFailure === "function" && typeof globalThis.scheduleSubmittedMessageDomProbe === "function" && typeof globalThis.checkConversationProjectionConsistency === "function" && typeof globalThis.handlePushButtonClick === "function",
			factoryType: typeof api.createApiClientRuntime,
			apiType: typeof (runtime && runtime.api),
			clientEventType: typeof (runtime && runtime.postClientEvent),
			performanceType: typeof (runtime && runtime.postPerformanceEvent),
			diagnosticFailureType: typeof (runtime && runtime.recordHomeAiDiagnosticFailure),
			diagnosticSuccessType: typeof (runtime && runtime.recordHomeAiDiagnosticSuccess),
			submittedProbeType: typeof (runtime && runtime.scheduleSubmittedMessageDomProbe),
			projectionCheckType: typeof (runtime && runtime.checkConversationProjectionConsistency),
			pushType: typeof (runtime && runtime.handlePushButtonClick),
			globalApiType: typeof globalThis.api,
			globalClientEventType: typeof globalThis.postClientEvent,
			globalThreadHashType: typeof globalThis.diagnosticThreadHash,
			globalSubmittedProbeType: typeof globalThis.scheduleSubmittedMessageDomProbe,
			globalProjectionCheckType: typeof globalThis.checkConversationProjectionConsistency,
			globalPushType: typeof globalThis.handlePushButtonClick
		};
	}
	if (id === "thread-list-load-policy") {
		const plan = functionReady(api, "planThreadListLoadRequest") ? api.planThreadListLoadRequest({
			silent: true,
			threadDetailOpening: true,
			deferFallback: true
		}) : {};
		return {
			ok: plan && plan.action === "thread-list-load-request" && plan.shouldLoad === false && plan.skipReason === "detail-in-flight" && plan.retryDelayMs === 700,
			action: String(plan && plan.action || ""),
			shouldLoad: Boolean(plan && plan.shouldLoad),
			skipReason: String(plan && plan.skipReason || ""),
			retryDelayMs: Number(plan && plan.retryDelayMs) || 0
		};
	}
	if (id === "thread-list-stable-order") {
		const scopeKey = functionReady(api, "threadListOrderScopeKey") ? api.threadListOrderScopeKey({
			selectedCwd: "/tmp/project",
			search: "Home"
		}) : "";
		const plan = functionReady(api, "planThreadListStableOrder") ? api.planThreadListStableOrder({
			threads: [
				{ id: "b" },
				{ id: "a" },
				{ id: "c" }
			],
			previousState: {
				scopeKey,
				holdUntilMs: 2e3,
				order: ["a", "b"]
			},
			scopeKey,
			nowMs: 1e3,
			holdMs: 5e3
		}) : {};
		const order = Array.isArray(plan.order) ? plan.order : [];
		return {
			ok: scopeKey === JSON.stringify({
				cwd: "/tmp/project",
				search: "home"
			}) && plan.held === true && order.join(",") === "a,b,c",
			scopeKey,
			held: Boolean(plan.held),
			order
		};
	}
	if (id === "thread-status-hints") {
		const running = functionReady(api, "isRunningStatus") ? api.isRunningStatus("in_progress") : false;
		const unread = functionReady(api, "shouldMarkThreadUnread") ? api.shouldMarkThreadUnread({
			threadId: "target-thread",
			currentThreadId: "other-thread",
			status: "completed",
			thread: { turns: [{
				status: "completed",
				completedAtMs: 2e3
			}] },
			viewedAtMs: 1e3
		}) : false;
		const expire = functionReady(api, "shouldExpireRunningThreadHint") ? api.shouldExpireRunningThreadHint({
			threadId: "target-thread",
			isRunningHinted: true,
			status: {
				type: "completed",
				mobileStaleActiveTurn: true
			},
			runningHintedAtMs: 0,
			runningHintStaleMs: 1e3,
			nowMs: 5e3,
			thread: { mobileStaleActiveTurn: true }
		}) : false;
		return {
			ok: running === true && unread === true && expire === true,
			running,
			unread,
			expire
		};
	}
	if (id === "thread-detail-patch-plan") {
		const surface = functionReady(api, "planThreadDetailDomPatchSurface") ? api.planThreadDetailDomPatchSurface({
			threadId: "thread-a",
			conversationPresent: true
		}) : {};
		const visiblePatch = functionReady(api, "planVisibleItemRefreshPatch") ? api.planVisibleItemRefreshPatch([{
			key: "a",
			signature: "1"
		}], [{
			key: "a",
			signature: "1"
		}, {
			key: "b",
			signature: "2"
		}]) : {};
		const turnPatch = functionReady(api, "planThreadDetailRefreshDomPatch") ? api.planThreadDetailRefreshDomPatch([{
			key: "turn-a",
			hasPreviousTurn: true,
			itemPatchable: true,
			articlePresent: true
		}]) : {};
		const visibleOperations = Array.isArray(visiblePatch.operations) ? visiblePatch.operations : [];
		const turnOperations = Array.isArray(turnPatch.operations) ? turnPatch.operations : [];
		return {
			ok: surface.canPatch === true && surface.reason === "single-thread-surface" && visiblePatch.canPatch === true && visibleOperations.map((entry) => entry.type).join(",") === "reuse,insert" && turnPatch.canPatch === true && turnOperations.length === 1 && turnOperations[0].type === "item-patch",
			surfaceReason: String(surface.reason || ""),
			visibleOperationCount: visibleOperations.length,
			turnOperationType: String(turnOperations[0] && turnOperations[0].type || "")
		};
	}
	if (id === "thread-detail-actions") {
		const node = (dataset) => ({
			dataset,
			closest(selector) {
				if (selector === "[data-thread-tile-pane]") return { dataset: { threadTilePane: "thread-pane" } };
				return null;
			}
		});
		const copyNode = node({ copyKey: "copy-1" });
		const approvalNode = node({
			approvalId: "ap-1",
			approvalThreadId: "thread-ap",
			approvalAction: "allow_once"
		});
		const responseNode = node({
			serverRequestId: "req-1",
			serverRequestThreadId: "thread-req",
			serverResponseText: "yes",
			serverQuestionId: "answer"
		});
		const rich = functionReady(api, "resolveRichContentClickAction") ? api.resolveRichContentClickAction({ target: { closest(selector) {
			return selector === "[data-copy-key]" ? copyNode : null;
		} } }) : {};
		const approval = functionReady(api, "resolveThreadDetailClickAction") ? api.resolveThreadDetailClickAction({ target: { closest(selector) {
			return selector === "[data-approval-action]" ? approvalNode : null;
		} } }) : {};
		const response = functionReady(api, "resolveThreadDetailClickAction") ? api.resolveThreadDetailClickAction({ target: { closest(selector) {
			return selector === "[data-server-response-text]" ? responseNode : null;
		} } }) : {};
		const contextThreadId = functionReady(api, "contextThreadIdFromNode") ? api.contextThreadIdFromNode(copyNode) : "";
		return {
			ok: rich.action === "copy" && rich.preventDefault === true && rich.stopPropagation === true && approval.action === "approval-answer" && approval.approvalAction === "allow_once" && approval.threadId === "thread-ap" && response.action === "server-response" && response.responseText === "yes" && contextThreadId === "thread-pane",
			richAction: String(rich.action || ""),
			approvalAction: String(approval.action || ""),
			approvalValue: String(approval.approvalAction || ""),
			responseAction: String(response.action || ""),
			contextThreadId
		};
	}
	if (id === "thread-detail-merge-state") {
		const policy = functionReady(api, "createThreadDetailMergePolicy") ? api.createThreadDetailMergePolicy({
			sortTurnsForDisplay: (turns) => Array.isArray(turns) ? turns.slice().sort((left, right) => String(left && left.id || "").localeCompare(String(right && right.id || ""))) : [],
			turnVisibleWeight: (turn) => JSON.stringify(turn && turn.items || []).length,
			mergeItemsPreservingLocalVisible: (existingItems, incomingItems, preserveLocalVisible) => preserveLocalVisible ? existingItems : incomingItems
		}) : {};
		const merged = policy && typeof policy.mergeThreadPreservingVisibleItems === "function" ? policy.mergeThreadPreservingVisibleItems({
			id: "thread-a",
			turns: [{
				id: "b",
				items: [{
					type: "assistantMessage",
					text: "full receipt"
				}]
			}]
		}, {
			id: "thread-a",
			turns: [{
				id: "b",
				items: []
			}, {
				id: "a",
				items: [{
					type: "userMessage",
					text: "hello"
				}]
			}]
		}) : {};
		const turns = Array.isArray(merged && merged.turns) ? merged.turns : [];
		const preserved = turns.find((turn) => turn && turn.id === "b");
		return {
			ok: turns.map((turn) => String(turn && turn.id || "")).join(",") === "a,b" && Array.isArray(preserved && preserved.items) && preserved.items.length === 1 && preserved.items[0].text === "full receipt",
			turnOrder: turns.map((turn) => String(turn && turn.id || "")),
			preservedItemCount: Array.isArray(preserved && preserved.items) ? preserved.items.length : 0
		};
	}
	if (id === "thread-detail-v4-merge-state") {
		const policy = functionReady(api, "createThreadDetailV4MergePolicy") ? api.createThreadDetailV4MergePolicy({
			normalizeThreadVisibleUserMessages: (thread) => thread,
			turnVisibleWeight: (turn) => Array.isArray(turn && turn.items) ? turn.items.length : 0,
			isOptimisticUserMessage: (item) => Boolean(item && item.mobilePendingSubmission),
			isRecentlySubmittedUserMessage: (item) => Boolean(item && item.mobilePendingSubmission),
			isReasoningItem: (item) => String(item && item.type || "") === "reasoning",
			userMessagesCanShadow: () => false,
			isTurnComplete: (turn) => /completed|failed|cancel|interrupted/i.test(String(turn && (turn.status && turn.status.type || turn.status) || "")),
			isRunningStatus: (status) => /running|active|inprogress|in_progress/i.test(String(status && status.type || status || "")),
			isIncompleteInterruptedTurn: () => false,
			turnHasActiveLiveItems: () => false,
			turnOrderMs: (turn) => Number(turn && turn.startedAtMs) || 0,
			sortTurnsForDisplay: (turns) => Array.isArray(turns) ? turns.slice().sort((left, right) => (Number(left && left.startedAtMs) || 0) - (Number(right && right.startedAtMs) || 0)) : [],
			maxVisibleTurnsForThread: () => 5
		}) : {};
		const merged = policy && typeof policy.mergeV4ProjectionThread === "function" ? policy.mergeV4ProjectionThread({
			id: "thread-a",
			mobileProjectionRevision: 3,
			turns: [{
				id: "active",
				startedAtMs: 100,
				status: "running",
				items: [{
					type: "agentMessage",
					text: "streaming"
				}]
			}]
		}, {
			id: "thread-a",
			mobileProjectionRevision: 2,
			turns: [{
				id: "new",
				startedAtMs: 50,
				status: "completed",
				items: [{
					type: "userMessage",
					text: "prompt"
				}]
			}]
		}) : {};
		const turns = Array.isArray(merged && merged.turns) ? merged.turns : [];
		return {
			ok: typeof policy.mergeV4ProjectionThread === "function" && typeof policy.v4ProjectionRevisionValue === "function" && policy.v4ProjectionRevisionValue(merged) === 3 && turns.map((turn) => String(turn && turn.id || "")).join(",") === "new,active",
			revision: policy && typeof policy.v4ProjectionRevisionValue === "function" ? policy.v4ProjectionRevisionValue(merged) : 0,
			turnOrder: turns.map((turn) => String(turn && turn.id || ""))
		};
	}
	if (id === "thread-detail-runtime") {
		const statePolicy = {
			completedIncomingTurnHasAuthoritativeReceipt: () => false,
			shouldDropLocalOnlyReceiptForIncomingTurn: () => false,
			shouldPreserveLocalOnlyItem: () => false,
			shouldPreserveExistingTurnVisibleItems: () => false
		};
		const runtime = functionReady(api, "createThreadDetailRuntime") ? api.createThreadDetailRuntime({
			threadDetailStateApi: {
				createThreadDetailStatePolicy: () => statePolicy,
				threadListSummaryFromDetailThread: () => ({}),
				planThreadOpenCacheReuse: () => ({ action: "skip" }),
				threadHasReusableLoadedDetailState: () => false
			},
			threadDetailMergeStateApi: { createThreadDetailMergePolicy: () => ({ mergeThreadPreservingVisibleItems: (existingThread, incomingThread) => incomingThread || existingThread }) },
			threadDetailV4MergeStateApi: { createThreadDetailV4MergePolicy: () => ({
				isV4ProjectionThread: () => false,
				mergeV4ProjectionThread: (existingThread, incomingThread) => incomingThread || existingThread
			}) },
			statusText: (status) => String(status && status.type || status || ""),
			isLiveTurn: (turn) => /active|running/i.test(String(turn && (turn.status && turn.status.type || turn.status) || "")),
			isLatestTurn: (turn, thread) => Array.isArray(thread && thread.turns) && thread.turns.at(-1) === turn,
			isReasoningItem: (item) => String(item && item.type || "") === "reasoning",
			isOperationalItem: (item) => String(item && item.type || "") === "commandExecution",
			isContextCompactionItem: () => false,
			isTurnComplete: (turn) => /completed|failed|cancel|interrupted/i.test(String(turn && (turn.status && turn.status.type || turn.status) || "")),
			isRunningStatus: (status) => /active|running|queued|processing/i.test(String(status && status.type || status || "")),
			sortTurnsForDisplay: (turns) => Array.isArray(turns) ? turns : []
		}) : {};
		return {
			ok: runtime && typeof runtime === "object" && typeof runtime.visibleItemsForTurn === "function" && typeof runtime.mergeThreadPreservingVisibleItems === "function" && typeof runtime.normalizeThreadVisibleUserMessages === "function" && typeof runtime.threadUserMessageEntries === "function" && typeof runtime.turnOrderMs === "function" && typeof runtime.turnIsSupersededBy === "function" && typeof globalThis.CodexThreadDetailRuntime === "object" && typeof globalThis.CodexThreadDetailRuntime.createThreadDetailRuntime === "function",
			factoryType: typeof api.createThreadDetailRuntime,
			visibleItemsType: typeof (runtime && runtime.visibleItemsForTurn),
			mergeType: typeof (runtime && runtime.mergeThreadPreservingVisibleItems),
			normalizeType: typeof (runtime && runtime.normalizeThreadVisibleUserMessages),
			turnOrderType: typeof (runtime && runtime.turnOrderMs),
			globalFactoryType: typeof (globalThis.CodexThreadDetailRuntime && globalThis.CodexThreadDetailRuntime.createThreadDetailRuntime)
		};
	}
	if (id === "task-card-runtime") {
		const runtime = functionReady(api, "createTaskCardRuntime") ? api.createTaskCardRuntime() : {};
		return {
			ok: runtime && typeof runtime === "object" && typeof runtime.renderThreadTaskCard === "function" && typeof runtime.renderThreadTaskCards === "function" && typeof runtime.createThreadTaskCardFromCurrent === "function" && typeof runtime.renderApprovalRequest === "function" && typeof globalThis.CodexTaskCardRuntime === "object" && typeof globalThis.CodexTaskCardRuntime.createTaskCardRuntime === "function" && typeof globalThis.threadTaskCardCommandText === "function" && typeof globalThis.renderThreadTaskCards === "function" && typeof globalThis.renderApprovalRequest === "function",
			factoryType: typeof api.createTaskCardRuntime,
			renderType: typeof (runtime && runtime.renderThreadTaskCard),
			renderListType: typeof (runtime && runtime.renderThreadTaskCards),
			createType: typeof (runtime && runtime.createThreadTaskCardFromCurrent),
			approvalType: typeof (runtime && runtime.renderApprovalRequest),
			globalCommandType: typeof globalThis.threadTaskCardCommandText,
			globalRenderType: typeof globalThis.renderThreadTaskCards
		};
	}
	if (id === "settings-runtime") {
		const runtime = functionReady(api, "createSettingsRuntime") ? api.createSettingsRuntime() : {};
		return {
			ok: runtime && typeof runtime === "object" && typeof runtime.renderFontSizeControl === "function" && typeof runtime.renderQuotaUsage === "function" && typeof runtime.renderCodexProfileSettings === "function" && typeof runtime.renderWorkspaceDelegationSettings === "function" && typeof runtime.rememberRateLimitsFromConfig === "function" && typeof runtime.rememberCodexProfiles === "function" && typeof globalThis.CodexSettingsRuntime === "object" && typeof globalThis.CodexSettingsRuntime.createSettingsRuntime === "function",
			factoryType: typeof api.createSettingsRuntime,
			fontSizeType: typeof (runtime && runtime.renderFontSizeControl),
			quotaType: typeof (runtime && runtime.renderQuotaUsage),
			profileType: typeof (runtime && runtime.renderCodexProfileSettings),
			workspaceDelegationType: typeof (runtime && runtime.renderWorkspaceDelegationSettings),
			rateLimitsType: typeof (runtime && runtime.rememberRateLimitsFromConfig),
			profilesType: typeof (runtime && runtime.rememberCodexProfiles),
			globalFactoryType: typeof (globalThis.CodexSettingsRuntime && globalThis.CodexSettingsRuntime.createSettingsRuntime)
		};
	}
	if (id === "app-entry") {
		const runtime = functionReady(api, "createCodexMobileAppEntry") ? api.createCodexMobileAppEntry() : {};
		return {
			ok: runtime && typeof runtime === "object" && typeof runtime.startCodexMobileApp === "function" && typeof api.startCodexMobileApp === "function" && typeof globalThis.CodexMobileAppEntry === "object" && typeof globalThis.CodexMobileAppEntry.createCodexMobileAppEntry === "function" && typeof globalThis.CodexMobileAppEntry.startCodexMobileApp === "function",
			factoryType: typeof api.createCodexMobileAppEntry,
			startType: typeof api.startCodexMobileApp,
			runtimeStartType: typeof (runtime && runtime.startCodexMobileApp),
			globalFactoryType: typeof (globalThis.CodexMobileAppEntry && globalThis.CodexMobileAppEntry.createCodexMobileAppEntry),
			globalStartType: typeof (globalThis.CodexMobileAppEntry && globalThis.CodexMobileAppEntry.startCodexMobileApp)
		};
	}
	if (id === "notification-ui-runtime") {
		const runtime = functionReady(api, "createNotificationUiRuntime") ? api.createNotificationUiRuntime() : {};
		return {
			ok: runtime && typeof runtime === "object" && typeof runtime.showApp === "function" && typeof runtime.showLogin === "function" && typeof runtime.bootstrap === "function" && typeof runtime.requestHermesPluginRefresh === "function" && typeof runtime.handlePluginVoiceInputMessage === "function" && typeof globalThis.CodexNotificationUiRuntime === "object" && typeof globalThis.CodexNotificationUiRuntime.createNotificationUiRuntime === "function" && typeof globalThis.showApp === "function" && typeof globalThis.showLogin === "function" && typeof globalThis.bootstrap === "function" && typeof globalThis.sortTurnsForDisplay === "function",
			factoryType: typeof api.createNotificationUiRuntime,
			showAppType: typeof (runtime && runtime.showApp),
			showLoginType: typeof (runtime && runtime.showLogin),
			bootstrapType: typeof (runtime && runtime.bootstrap),
			refreshType: typeof (runtime && runtime.requestHermesPluginRefresh),
			globalBootstrapType: typeof globalThis.bootstrap,
			globalSortType: typeof globalThis.sortTurnsForDisplay
		};
	}
	if (id === "conversation-render-runtime") {
		const runtime = functionReady(api, "createConversationRenderRuntime") ? api.createConversationRenderRuntime() : {};
		return {
			ok: runtime && typeof runtime === "object" && typeof runtime.renderTurn === "function" && typeof runtime.renderItem === "function" && typeof runtime.renderItemBody === "function" && typeof runtime.renderUserMessageBody === "function" && typeof runtime.renderLiveOperationDock === "function" && typeof runtime.ensureTurn === "function" && typeof runtime.shouldDeferLiveFinalReceipt === "function" && typeof globalThis.CodexConversationRenderRuntime === "object" && typeof globalThis.CodexConversationRenderRuntime.createConversationRenderRuntime === "function" && typeof globalThis.renderTurn === "function" && typeof globalThis.renderItem === "function" && typeof globalThis.renderLiveOperationDock === "function" && typeof globalThis.ensureTurn === "function" && typeof globalThis.shouldDeferLiveFinalReceipt === "function" && typeof globalThis.imageUrlValue === "function" && typeof globalThis.renderMarkdownWithAttachmentSummary === "function" && typeof globalThis.renderFilePreviewContent === "function" && typeof globalThis.closeImagePreview === "function",
			factoryType: typeof api.createConversationRenderRuntime,
			renderTurnType: typeof (runtime && runtime.renderTurn),
			renderItemType: typeof (runtime && runtime.renderItem),
			liveDockType: typeof (runtime && runtime.renderLiveOperationDock),
			ensureTurnType: typeof (runtime && runtime.ensureTurn),
			globalRenderType: typeof globalThis.renderTurn,
			globalEnsureTurnType: typeof globalThis.ensureTurn,
			globalImageUrlType: typeof globalThis.imageUrlValue
		};
	}
	if (id === "event-stream-runtime") {
		const runtime = functionReady(api, "createEventStreamRuntime") ? api.createEventStreamRuntime() : {};
		return {
			ok: runtime && typeof runtime === "object" && typeof runtime.connectEvents === "function" && typeof runtime.applyNotification === "function" && typeof runtime.resumeMobileSession === "function" && typeof runtime.scrollConversationToBottom === "function" && typeof runtime.updateScrollToBottomButton === "function" && typeof globalThis.CodexEventStreamRuntime === "object" && typeof globalThis.CodexEventStreamRuntime.createEventStreamRuntime === "function" && typeof globalThis.upsertItem === "function" && typeof globalThis.connectEvents === "function" && typeof globalThis.ensureEventConnection === "function" && typeof globalThis.resumeMobileSession === "function" && typeof globalThis.followThreadOpenToBottom === "function" && typeof globalThis.scheduleBottomFollowScroll === "function" && typeof globalThis.updateScrollToBottomButton === "function",
			factoryType: typeof api.createEventStreamRuntime,
			connectType: typeof (runtime && runtime.connectEvents),
			notificationType: typeof (runtime && runtime.applyNotification),
			resumeType: typeof (runtime && runtime.resumeMobileSession),
			scrollType: typeof (runtime && runtime.scrollConversationToBottom),
			globalConnectType: typeof globalThis.connectEvents,
			globalFollowType: typeof globalThis.followThreadOpenToBottom
		};
	}
	if (id === "client-render-stability-guard") {
		const sourceTurn = {
			id: "local-turn-secret",
			items: [{
				type: "userMessage",
				clientSubmissionId: "submission-secret",
				mobilePendingSubmission: true
			}]
		};
		const targetTurn = {
			id: "server-turn-a",
			items: [{
				type: "userMessage",
				clientSubmissionId: "submission-secret"
			}]
		};
		const sourceKey = functionReady(api, "markSubmittedTurn") ? api.markSubmittedTurn(sourceTurn, "submission-secret") : "";
		const transferredKey = functionReady(api, "transferSubmittedTurnIdentity") ? api.transferSubmittedTurnIdentity(sourceTurn, targetTurn, "submission-secret") : "";
		const sourceIdentity = functionReady(api, "stableTurnIdentity") ? api.stableTurnIdentity(sourceTurn) : "";
		const targetIdentity = functionReady(api, "stableTurnIdentity") ? api.stableTurnIdentity(targetTurn) : "";
		return {
			ok: Boolean(sourceKey) && sourceKey === transferredKey && sourceIdentity === sourceKey && targetIdentity === sourceKey && !String(sourceKey).includes("submission-secret"),
			sourceKey: String(sourceKey || ""),
			transferredKey: String(transferredKey || ""),
			sourceIdentity: String(sourceIdentity || ""),
			targetIdentity: String(targetIdentity || "")
		};
	}
	if (id === "live-operation-dock-state") {
		const card = functionReady(api, "operationCardContentPlan") ? api.operationCardContentPlan({
			itemId: "op-a",
			type: "tool",
			status: "running",
			title: "Run",
			detail: "working",
			durationText: "1s"
		}) : {};
		const preserve = functionReady(api, "compactBubblePreservation") ? api.compactBubblePreservation({
			nextHtml: "",
			liveTurnActive: true,
			visibleUntilMs: 2e3,
			nowMs: 1e3,
			savedThreadId: "thread-a",
			currentThreadId: "thread-a",
			savedHtml: "<div class=\"mobile-operation-bubble\"></div>",
			dockHasBubble: false
		}) : {};
		const recall = functionReady(api, "shouldShowRecall") ? api.shouldShowRecall({
			isMobile: true,
			hasCurrentThread: true,
			newThreadDraft: false,
			liveTurnActive: true,
			recallThreadId: "thread-a",
			currentThreadId: "thread-a",
			recallHtml: "<div class=\"mobile-operation-sheet\"></div>"
		}) : false;
		const classTokens = Array.isArray(card.classTokens) ? card.classTokens : [];
		return {
			ok: card.detail === "working" && classTokens.includes("live-operation") && preserve.preserve === true && preserve.patchSavedHtml === true && recall === true,
			detail: String(card.detail || ""),
			preserve: Boolean(preserve.preserve),
			recall
		};
	}
	if (id === "voxspark-surface-host-runtime") {
		const accepted = functionReady(api, "safeBridgeUrl") ? api.safeBridgeUrl("ws://127.0.0.1:8790/host") : "";
		const rejectedQuery = functionReady(api, "safeBridgeUrl") ? api.safeBridgeUrl("ws://127.0.0.1:8790/host?token=secret") : "invalid";
		return {
			ok: accepted === "ws://127.0.0.1:8790/host" && rejectedQuery === "" && functionReady(api, "createVoxSparkSurfaceHostRuntime"),
			accepted,
			rejectedQuery
		};
	}
	return { ok: false };
}
function codexMobileViteEsmCompatibility() {
	const modules = moduleDefinitions.map((definition) => {
		const api = moduleApis[definition.id] && typeof moduleApis[definition.id] === "object" ? moduleApis[definition.id] : {};
		const expectedFunctions = Array.isArray(definition.expectedFunctions) ? definition.expectedFunctions : [];
		const exportedFunctions = expectedFunctions.filter((name) => functionReady(api, name));
		const sample = sampleModule(definition.id, api);
		const globalPublished = publishClassicGlobal(definition, api);
		return {
			id: definition.id,
			source: definition.source,
			assetPath: definition.assetPath,
			nativeSource: definition.nativeSource || "",
			importSource: definition.importSource || definition.source,
			compatibilityMode: definition.compatibilityMode || "classic-global-compat",
			globalName: definition.globalName,
			classicLoaderExcluded: definition.classicLoaderExcluded === true,
			expectedFunctions: expectedFunctions.slice(),
			exportedFunctions,
			sample,
			globalPublished,
			ready: exportedFunctions.length === expectedFunctions.length && sample.ok === true && (definition.classicLoaderExcluded !== true || globalPublished === true)
		};
	});
	return {
		schemaVersion: 1,
		owner: "vite-shell-entry",
		moduleCount: modules.length,
		nativeEsmModuleCount: modules.filter((entry) => entry.compatibilityMode === "native-esm").length,
		classicGlobalCompatibilityModuleCount: modules.filter((entry) => entry.compatibilityMode !== "native-esm").length,
		readyCount: modules.filter((entry) => entry.ready === true).length,
		modules
	};
}
var codexMobileViteEsmCompatibilityModules = moduleDefinitions;
//#endregion
export { codexMobileViteEsmCompatibility, codexMobileViteEsmCompatibility as default, codexMobileViteEsmCompatibilityModules };
