//#region frontend/native/api-client-runtime.mjs
var root$1 = typeof globalThis !== "undefined" ? globalThis : window;
var FRONTEND_DIAGNOSTIC_LOG_VERSION = "20260706-v1";
var STORAGE_FRONTEND_DIAGNOSTIC_LOG_ENABLED = "codexMobileFrontendDiagnosticLogEnabled";
var STORAGE_FRONTEND_DIAGNOSTIC_LOG_UPLOAD = "codexMobileFrontendDiagnosticLogUpload";
var STORAGE_FRONTEND_DIAGNOSTIC_LOG_SCOPES = "codexMobileFrontendDiagnosticLogScopes";
var STORAGE_FRONTEND_DIAGNOSTIC_LOG_ENTRIES = "codexMobileFrontendDiagnosticLogEntries";
var STORAGE_FRONTEND_DIAGNOSTIC_LOG_MAX_ENTRIES = "codexMobileFrontendDiagnosticLogMaxEntries";
var STORAGE_FRONTEND_DIAGNOSTIC_LOG_SERVER_ENABLED = "codexMobileFrontendDiagnosticLogServerEnabled";
var THREAD_LIST_RUNTIME_RECENT_INPUT_MS = 1e4;
var frontendDiagnosticLogUrlParamsApplied = false;
async function api$6(path, options = {}) {
	return apiClient.request(path, options);
}
function postClientEvent(event, details = {}) {
	if (!state.key) return;
	const payload = JSON.stringify({
		event,
		threadId: state.currentThreadId || "",
		path: location.pathname || "/",
		details
	});
	const url = `/api/client-events?key=${encodeURIComponent(state.key)}`;
	fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: payload,
		keepalive: true
	}).catch(() => {
		try {
			if (navigator.sendBeacon) {
				const blob = new Blob([payload], { type: "application/json" });
				navigator.sendBeacon(url, blob);
			}
		} catch (_) {}
	});
}
function nowPerfMs() {
	return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}
function roundedDurationMs(startedAt) {
	return Math.max(0, Math.round(nowPerfMs() - Number(startedAt || 0)));
}
function postPerformanceEvent(event, details = {}, options = {}) {
	const now = Date.now();
	const key = String(options.key || event || "");
	const minIntervalMs = Math.max(0, Number(options.minIntervalMs || 0));
	if (key && minIntervalMs > 0) {
		const last = Number(state.perfEventLastReportedAt[key] || 0);
		if (!options.force && last && now - last < minIntervalMs) return false;
		state.perfEventLastReportedAt[key] = now;
	}
	postClientEvent(event, Object.assign({
		pwa: isPwaMode(),
		embedded: isHermesEmbedMode(),
		visibility: document.visibilityState || "",
		clientBuildId: CLIENT_BUILD_ID
	}, details || {}));
	return true;
}
function diagnosticHash(value) {
	return homeAiDiagnosticReportingApi.hashIdentifier(String(value || ""), "h");
}
function diagnosticThreadHash(threadId = state.currentThreadId) {
	const id = String(threadId || "").trim();
	return id ? diagnosticHash(`thread:${id}`) : "";
}
function diagnosticTurnHash(turnId) {
	const id = String(turnId || "").trim();
	return id ? diagnosticHash(`turn:${id}`) : "";
}
function diagnosticTaskHash(taskId) {
	const id = String(taskId || "").trim();
	return id ? diagnosticHash(`task:${id}`) : "";
}
function diagnosticItemHash(itemId) {
	const id = String(itemId || "").trim();
	return id ? diagnosticHash(`item:${id}`) : "";
}
function clientSubmissionDiagnosticHash(clientSubmissionId) {
	const id = String(clientSubmissionId || "").trim();
	return id ? diagnosticHash(`submission:${id}`) : "";
}
function clientSubmissionDataAttr(item) {
	const hash = clientSubmissionDiagnosticHash(item && item.clientSubmissionId);
	return hash ? ` data-client-submission-hash="${escapeHtml(hash)}"` : "";
}
function frontendDiagnosticLogStorageGet(key) {
	try {
		return localStorage.getItem(key);
	} catch (_) {
		return "";
	}
}
function frontendDiagnosticLogStorageSet(key, value) {
	try {
		localStorage.setItem(key, value);
		return true;
	} catch (_) {
		return false;
	}
}
function frontendDiagnosticLogStorageRemove(key) {
	try {
		localStorage.removeItem(key);
		return true;
	} catch (_) {
		return false;
	}
}
function truthyFrontendDiagnosticLogValue(value) {
	return /^(1|true|yes|on|enable|enabled)$/i.test(String(value || "").trim());
}
function falseyFrontendDiagnosticLogValue(value) {
	return /^(0|false|no|off|disable|disabled)$/i.test(String(value || "").trim());
}
function normalizeFrontendDiagnosticLogScopes(value) {
	const scopes = (Array.isArray(value) ? value.join(",") : String(value || "")).split(/[,\s]+/g).map((item) => item.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_")).filter(Boolean).slice(0, 24);
	return scopes.length ? Array.from(new Set(scopes)) : ["submitted_echo"];
}
function boundedFrontendDiagnosticLogMaxEntries(value) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) return 400;
	return Math.max(25, Math.min(2e3, Math.trunc(number)));
}
function applyFrontendDiagnosticLogUrlParams() {
	if (frontendDiagnosticLogUrlParamsApplied) return;
	frontendDiagnosticLogUrlParamsApplied = true;
	let params = null;
	try {
		params = new URL(window.location.href).searchParams;
	} catch (_) {
		return;
	}
	const enabledValue = params.get("codexFrontendLog") || params.get("codexMobileFrontendLog") || params.get("clientLog");
	if (truthyFrontendDiagnosticLogValue(enabledValue)) frontendDiagnosticLogStorageSet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_ENABLED, "1");
	else if (falseyFrontendDiagnosticLogValue(enabledValue)) frontendDiagnosticLogStorageRemove(STORAGE_FRONTEND_DIAGNOSTIC_LOG_ENABLED);
	const uploadValue = params.get("codexFrontendLogUpload") || params.get("clientLogUpload");
	if (truthyFrontendDiagnosticLogValue(uploadValue)) frontendDiagnosticLogStorageSet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_UPLOAD, "1");
	else if (falseyFrontendDiagnosticLogValue(uploadValue)) frontendDiagnosticLogStorageSet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_UPLOAD, "0");
	const scopesValue = params.get("codexFrontendLogScopes") || params.get("clientLogScopes");
	if (String(scopesValue || "").trim()) frontendDiagnosticLogStorageSet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_SCOPES, normalizeFrontendDiagnosticLogScopes(scopesValue).join(","));
}
function frontendDiagnosticLogSettings() {
	applyFrontendDiagnosticLogUrlParams();
	return {
		enabled: truthyFrontendDiagnosticLogValue(frontendDiagnosticLogStorageGet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_ENABLED)),
		upload: !falseyFrontendDiagnosticLogValue(frontendDiagnosticLogStorageGet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_UPLOAD)),
		scopes: normalizeFrontendDiagnosticLogScopes(frontendDiagnosticLogStorageGet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_SCOPES) || "submitted_echo"),
		maxEntries: boundedFrontendDiagnosticLogMaxEntries(frontendDiagnosticLogStorageGet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_MAX_ENTRIES)),
		version: FRONTEND_DIAGNOSTIC_LOG_VERSION
	};
}
function frontendDiagnosticLogScopeEnabled(scope, settings = frontendDiagnosticLogSettings()) {
	if (!settings.enabled) return false;
	const normalized = normalizeFrontendDiagnosticLogScopes(scope || "general")[0] || "general";
	return settings.scopes.includes("all") || settings.scopes.includes(normalized);
}
function readFrontendDiagnosticLog() {
	try {
		const entries = JSON.parse(frontendDiagnosticLogStorageGet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_ENTRIES) || "[]");
		return Array.isArray(entries) ? entries : [];
	} catch (_) {
		return [];
	}
}
function writeFrontendDiagnosticLog(entries, maxEntries = 400) {
	const boundedEntries = (Array.isArray(entries) ? entries : []).slice(-boundedFrontendDiagnosticLogMaxEntries(maxEntries));
	return frontendDiagnosticLogStorageSet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_ENTRIES, JSON.stringify(boundedEntries));
}
function clearFrontendDiagnosticLog() {
	return frontendDiagnosticLogStorageSet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_ENTRIES, "[]");
}
function frontendDiagnosticLogStatus() {
	const settings = frontendDiagnosticLogSettings();
	return Object.assign({}, settings, {
		count: readFrontendDiagnosticLog().length,
		storageKey: STORAGE_FRONTEND_DIAGNOSTIC_LOG_ENTRIES
	});
}
function setFrontendDiagnosticLogEnabled(enabled, options = {}) {
	if (enabled) frontendDiagnosticLogStorageSet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_ENABLED, "1");
	else frontendDiagnosticLogStorageRemove(STORAGE_FRONTEND_DIAGNOSTIC_LOG_ENABLED);
	if (Object.prototype.hasOwnProperty.call(options, "upload")) frontendDiagnosticLogStorageSet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_UPLOAD, options.upload === false ? "0" : "1");
	if (options.scopes) frontendDiagnosticLogStorageSet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_SCOPES, normalizeFrontendDiagnosticLogScopes(options.scopes).join(","));
	if (options.maxEntries) frontendDiagnosticLogStorageSet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_MAX_ENTRIES, String(boundedFrontendDiagnosticLogMaxEntries(options.maxEntries)));
	return frontendDiagnosticLogStatus();
}
function configureFrontendDiagnosticLog(options = {}) {
	if (Object.prototype.hasOwnProperty.call(options, "enabled")) return setFrontendDiagnosticLogEnabled(Boolean(options.enabled), options);
	if (Object.prototype.hasOwnProperty.call(options, "upload")) frontendDiagnosticLogStorageSet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_UPLOAD, options.upload === false ? "0" : "1");
	if (options.scopes) frontendDiagnosticLogStorageSet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_SCOPES, normalizeFrontendDiagnosticLogScopes(options.scopes).join(","));
	if (options.maxEntries) frontendDiagnosticLogStorageSet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_MAX_ENTRIES, String(boundedFrontendDiagnosticLogMaxEntries(options.maxEntries)));
	return frontendDiagnosticLogStatus();
}
function applyFrontendDiagnosticLogPublicConfig(config = {}) {
	const raw = config && config.frontendDiagnosticLog && typeof config.frontendDiagnosticLog === "object" ? config.frontendDiagnosticLog : null;
	if (!raw || typeof raw.enabled !== "boolean") return frontendDiagnosticLogStatus();
	if (raw.enabled) {
		frontendDiagnosticLogStorageSet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_SERVER_ENABLED, "1");
		return setFrontendDiagnosticLogEnabled(true, {
			upload: raw.upload !== false,
			scopes: raw.scopes || "submitted_echo",
			maxEntries: raw.maxEntries || 400
		});
	}
	if (truthyFrontendDiagnosticLogValue(frontendDiagnosticLogStorageGet(STORAGE_FRONTEND_DIAGNOSTIC_LOG_SERVER_ENABLED))) {
		frontendDiagnosticLogStorageRemove(STORAGE_FRONTEND_DIAGNOSTIC_LOG_SERVER_ENABLED);
		return setFrontendDiagnosticLogEnabled(false);
	}
	return frontendDiagnosticLogStatus();
}
function exportFrontendDiagnosticLog() {
	return JSON.stringify({
		exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
		status: frontendDiagnosticLogStatus(),
		entries: readFrontendDiagnosticLog()
	});
}
function frontendDiagnosticLogSensitiveKey(key) {
	return /(text|content|body|message|prompt|html|markdown|secret|token|cookie|authorization|password|access|launchkey|path|url|filename|file)/i.test(String(key || ""));
}
function sanitizeFrontendDiagnosticLogValue(value, key = "", depth = 0) {
	if (value == null) return value;
	if (typeof value === "boolean" || typeof value === "number") return value;
	if (typeof value === "string") {
		const raw = String(value || "");
		if (frontendDiagnosticLogSensitiveKey(key)) return raw ? {
			hash: diagnosticHash(`${key}:${raw}`),
			length: raw.length
		} : "";
		return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw;
	}
	if (Array.isArray(value)) {
		if (depth >= 3) return { arrayLength: value.length };
		return value.slice(0, 20).map((item) => sanitizeFrontendDiagnosticLogValue(item, key, depth + 1));
	}
	if (typeof value === "object") {
		if (depth >= 3) return { objectKeys: Object.keys(value).slice(0, 20) };
		const out = {};
		for (const [entryKey, entryValue] of Object.entries(value).slice(0, 50)) out[entryKey] = sanitizeFrontendDiagnosticLogValue(entryValue, entryKey, depth + 1);
		return out;
	}
	return String(value).slice(0, 120);
}
function frontendDiagnosticLogThreadForId(threadId) {
	const id = String(threadId || "").trim();
	if (!id) return null;
	if (state.currentThread && String(state.currentThread.id || "") === id) return state.currentThread;
	if (state.threadTileDetails && typeof state.threadTileDetails.get === "function") return state.threadTileDetails.get(id) || null;
	return null;
}
function submittedEchoItemSource(item) {
	if (!item || item.type !== "userMessage") return "";
	if (typeof isOptimisticUserMessage === "function" && isOptimisticUserMessage(item)) return "optimistic";
	if (item.mobilePendingSubmission) return "pending";
	if (item.clientSubmissionId) return "client-submission";
	if (item.id) return "durable";
	return "unknown";
}
function submittedEchoItemTextHash(item) {
	const text = typeof itemTextValue === "function" ? itemTextValue(item && (item.text || item.message || item.content || item.summary || item.input)) : "";
	return text ? stableTextHash(text) : "";
}
function submittedEchoThreadSnapshot(thread, clientSubmissionId = "") {
	const submissionId = String(clientSubmissionId || "").trim();
	const submissionHash = clientSubmissionDiagnosticHash(submissionId);
	const entries = [];
	let userMessageCount = 0;
	let matchingSubmissionCount = 0;
	let optimisticCount = 0;
	let durableCount = 0;
	let localTurnCount = 0;
	const turns = Array.isArray(thread && thread.turns) ? thread.turns : [];
	turns.forEach((turn, turnIndex) => {
		const turnId = String(turn && turn.id || "");
		if (/^local-turn-/.test(turnId)) localTurnCount += 1;
		(Array.isArray(turn && turn.items) ? turn.items : []).forEach((item, itemIndex) => {
			if (!item || item.type !== "userMessage") return;
			userMessageCount += 1;
			const source = submittedEchoItemSource(item);
			if (source === "optimistic" || source === "pending") optimisticCount += 1;
			else durableCount += 1;
			const matchesSubmission = Boolean(submissionId && String(item.clientSubmissionId || "") === submissionId);
			if (matchesSubmission) matchingSubmissionCount += 1;
			if (matchesSubmission || entries.length < 8) entries.push({
				turnIndex,
				itemIndex,
				turnHash: diagnosticTurnHash(turnId),
				itemHash: diagnosticItemHash(item.id || `${turnId}:${itemIndex}`),
				renderKeyHash: diagnosticItemHash(item.mobileRenderKey || item.id || `${turnId}:${itemIndex}`),
				source,
				matchesSubmission,
				clientSubmissionHash: clientSubmissionDiagnosticHash(item.clientSubmissionId || ""),
				textHash: submittedEchoItemTextHash(item),
				turnStatus: statusText(turn && turn.status)
			});
		});
	});
	return {
		threadHash: diagnosticThreadHash(thread && thread.id || ""),
		submissionHash,
		status: statusText(thread && thread.status),
		turnCount: turns.length,
		localTurnCount,
		userMessageCount,
		matchingSubmissionCount,
		optimisticCount,
		durableCount,
		entries: entries.slice(0, 12)
	};
}
function submittedEchoDomSnapshot(clientSubmissionId = "") {
	const submissionHash = clientSubmissionDiagnosticHash(clientSubmissionId);
	const conversation = $("conversation");
	if (!conversation) return {
		submissionHash,
		available: false,
		itemCount: 0,
		userMessageCount: 0,
		matchingSubmissionCount: 0,
		duplicateUserMessageCount: 0,
		duplicateRenderKeyCount: 0,
		entries: []
	};
	const shape = conversationDomShape();
	const userNodes = Array.from(conversation.querySelectorAll(".item.userMessage"));
	const entries = [];
	let matchingSubmissionCount = 0;
	userNodes.forEach((node, index) => {
		const nodeSubmissionHash = String(node.getAttribute("data-client-submission-hash") || "");
		const matchesSubmission = Boolean(submissionHash && nodeSubmissionHash === submissionHash);
		if (matchesSubmission) matchingSubmissionCount += 1;
		if (matchesSubmission || entries.length < 8) {
			const turnNode = node.closest("article.turn[data-turn], article.thread-tile-turn[data-thread-tile-turn]");
			entries.push({
				index,
				fromTail: userNodes.length - index - 1,
				matchesSubmission,
				clientSubmissionHash: nodeSubmissionHash,
				turnHash: diagnosticTurnHash(turnNode && (turnNode.getAttribute("data-turn") || turnNode.getAttribute("data-thread-tile-turn")) || ""),
				itemHash: diagnosticItemHash(node.getAttribute("data-item") || ""),
				renderKeyHash: diagnosticItemHash(node.getAttribute("data-render-key") || ""),
				textHash: stableTextHash(String(node.textContent || ""))
			});
		}
	});
	return {
		submissionHash,
		available: true,
		itemCount: shape.itemCount,
		turnCount: shape.turnCount,
		userMessageCount: userNodes.length,
		matchingSubmissionCount,
		duplicateUserMessageCount: shape.duplicateUserMessageCount,
		duplicateRenderKeyCount: shape.duplicateRenderKeyCount,
		entries: entries.slice(0, 12)
	};
}
function submittedEchoDiagnosticSnapshot(input = {}) {
	const threadId = String(input.threadId || state.currentThreadId || "").trim();
	const clientSubmissionId = String(input.clientSubmissionId || "").trim();
	const thread = input.thread || frontendDiagnosticLogThreadForId(threadId);
	return {
		threadId,
		threadHash: diagnosticThreadHash(threadId),
		submissionHash: clientSubmissionDiagnosticHash(clientSubmissionId),
		routeKind: diagnosticRouteKind(),
		currentThreadMatch: Boolean(threadId && String(state.currentThreadId || "") === threadId),
		thread: submittedEchoThreadSnapshot(thread, clientSubmissionId),
		dom: submittedEchoDomSnapshot(clientSubmissionId)
	};
}
function recordFrontendDiagnosticLog(event, details = {}, options = {}) {
	const scope = normalizeFrontendDiagnosticLogScopes(options.scope || details.scope || event || "general")[0] || "general";
	const settings = frontendDiagnosticLogSettings();
	if (!options.force && !frontendDiagnosticLogScopeEnabled(scope, settings)) return false;
	const threadId = String(details.threadId || state.currentThreadId || "").trim();
	state.frontendDiagnosticLogSeq = Number(state.frontendDiagnosticLogSeq || 0) + 1;
	const entry = {
		version: FRONTEND_DIAGNOSTIC_LOG_VERSION,
		seq: state.frontendDiagnosticLogSeq,
		at: (/* @__PURE__ */ new Date()).toISOString(),
		event: String(event || "frontend_diagnostic").slice(0, 100),
		scope,
		threadId,
		threadHash: diagnosticThreadHash(threadId),
		routeKind: diagnosticRouteKind(),
		visibility: document.visibilityState || "",
		clientBuildId: CLIENT_BUILD_ID,
		details: sanitizeFrontendDiagnosticLogValue(details || {})
	};
	const entries = readFrontendDiagnosticLog();
	entries.push(entry);
	writeFrontendDiagnosticLog(entries, settings.maxEntries);
	if (settings.upload && state.key) postClientEvent("frontend_diagnostic_log", entry);
	return entry;
}
function recordSubmittedEchoDiagnosticLog(stage, details = {}, options = {}) {
	const payload = Object.assign({ stage: String(stage || "unknown").slice(0, 80) }, details || {});
	const snapshot = submittedEchoDiagnosticSnapshot(payload);
	payload.threadHash = snapshot.threadHash;
	payload.submissionHash = snapshot.submissionHash;
	payload.snapshot = snapshot;
	return recordFrontendDiagnosticLog("submitted_echo_lifecycle", payload, Object.assign({ scope: "submitted_echo" }, options || {}));
}
function recordRecentSubmittedEchoDiagnosticLogs(stage, details = {}, options = {}) {
	const records = state.recentSubmittedUserMessages;
	if (!records || typeof records.entries !== "function") return 0;
	const threadId = String(details.threadId || state.currentThreadId || "").trim();
	let count = 0;
	for (const [clientSubmissionId, record] of Array.from(records.entries()).slice(-20)) {
		if (threadId && String(record && record.threadId || "") !== threadId) continue;
		if (recordSubmittedEchoDiagnosticLog(stage, Object.assign({}, details, {
			clientSubmissionId,
			threadId: String(record && record.threadId || threadId || "")
		}), options)) count += 1;
	}
	return count;
}
var frontendDiagnosticLogApi = Object.freeze({
	enable: (options = {}) => setFrontendDiagnosticLogEnabled(true, options),
	disable: () => setFrontendDiagnosticLogEnabled(false),
	configure: configureFrontendDiagnosticLog,
	applyPublicConfig: applyFrontendDiagnosticLogPublicConfig,
	status: frontendDiagnosticLogStatus,
	read: readFrontendDiagnosticLog,
	export: exportFrontendDiagnosticLog,
	clear: clearFrontendDiagnosticLog,
	record: recordFrontendDiagnosticLog,
	recordSubmittedEcho: recordSubmittedEchoDiagnosticLog,
	snapshotSubmittedEcho: submittedEchoDiagnosticSnapshot
});
function diagnosticRouteKind() {
	if (state.newThreadDraft) return "new-thread";
	if (isHermesEmbedMode() && isHermesPluginPrimaryPage()) return "embedded-primary";
	if (state.threadTileMode) return "thread-tile";
	if (state.currentThreadId) return "thread-detail";
	return isHermesEmbedMode() ? "embedded-root" : "standalone-root";
}
function diagnosticErrorStatus(err) {
	let status = Number(err && (err.status || err.statusCode) || 0);
	if ((!Number.isFinite(status) || status <= 0) && err && /^\d+$/.test(String(err.code || ""))) status = Number(err.code);
	return Number.isFinite(status) && status > 0 ? status : 0;
}
function diagnosticErrorCode(err, fallback = "runtime_failed") {
	const explicit = String(err && err.code || "").trim();
	if (explicit && !/^\d+$/.test(explicit)) return homeAiDiagnosticReportingApi.boundedToken(explicit, fallback, 100);
	const status = diagnosticErrorStatus(err);
	if (status) return `http_${status}`;
	const message = String(err && err.message || err || "").toLowerCase();
	if (message.includes("request timed out")) return "request_timeout";
	if (message.includes("request cancelled")) return "request_cancelled";
	if (message.includes("failed to fetch")) return "network_fetch_failed";
	if (message.includes("not visible")) return "target_thread_not_visible";
	if (message.includes("terminal") && message.includes("return")) return "terminal_card_no_return_required";
	return fallback;
}
function diagnosticDurationBucket(ms) {
	return homeAiDiagnosticReportingApi.durationBucket(ms);
}
function currentHomeAiDiagnosticContext(extra = {}) {
	const context = Object.assign({
		surface: "runtime",
		action: "unknown",
		route_kind: diagnosticRouteKind(),
		build_id: CLIENT_BUILD_ID,
		shell_cache: CLIENT_BUILD_ID.split("|").pop() || "",
		thread_hash: diagnosticThreadHash(),
		embedded: isHermesEmbedMode(),
		pwa: isPwaMode(),
		client_visibility: document.visibilityState || ""
	}, extra || {});
	if (!context.thread_hash) delete context.thread_hash;
	return context;
}
function postHomeAiDiagnosticReport(report, meta = {}) {
	const targetOrigin = normalizePluginParentOrigin(state.pluginParentOrigin);
	if (targetOrigin) state.pluginParentOrigin = targetOrigin;
	const result = homeAiDiagnosticReportingApi.postReportToHomeAi({
		report,
		embedded: isHermesEmbedMode(),
		parentWindow: window.parent,
		selfWindow: window,
		targetOrigin: targetOrigin || "*"
	});
	postClientEvent("home_ai_diagnostic_report_post", {
		ok: Boolean(result.ok),
		reason: result.reason || "",
		category: report && report.category || "",
		diagnostic_type: report && report.diagnostic_type || "",
		error_code: report && report.error_code || "",
		signature: meta.signature || "",
		repeatedFailures: Number(meta.repeatedFailures || 0)
	});
	return result;
}
function recordHomeAiDiagnosticFailure(input = {}) {
	const result = state.homeAiDiagnosticReporter.recordFailure(Object.assign({}, input, { context: currentHomeAiDiagnosticContext(input.context || {}) }));
	postClientEvent("home_ai_diagnostic_failure_recorded", {
		category: input.category || "",
		diagnostic_type: input.diagnostic_type || input.diagnosticType || "",
		error_code: input.error_code || input.errorCode || "",
		eligible: Boolean(result.eligible),
		repeatedFailures: Number(result.repeatedFailures || 0),
		threshold: Number(result.threshold || 0),
		signature: result.signature || "",
		observeOnly: Boolean(result.observeOnly),
		reason: result.reason || ""
	});
	if (result.report) postHomeAiDiagnosticReport(result.report, result);
	return result;
}
function recordHomeAiDiagnosticSuccess(input = {}) {
	return state.homeAiDiagnosticReporter.recordSuccess(Object.assign({}, input, { context: currentHomeAiDiagnosticContext(input.context || {}) }));
}
function applyFrontendRuntimeHealthEffect(effect) {
	const item = effect && typeof effect === "object" ? effect : {};
	if (!item.type) return;
	if (item.type === "diagnostic-failure") {
		recordHomeAiDiagnosticFailure(item.diagnostic || {});
		return;
	}
	if (item.type === "diagnostic-success") {
		recordHomeAiDiagnosticSuccess(item.diagnostic || {});
		return;
	}
	if (item.type === "render-current-thread") {
		const renderer = typeof root$1.renderCurrentThread === "function" ? root$1.renderCurrentThread : null;
		if (renderer) renderer({
			stickToBottom: item.stickToBottom !== false,
			source: item.reason || "frontend-runtime-health"
		});
		return;
	}
	throw new Error(`Unknown frontend runtime health effect: ${item.type}`);
}
function applyFrontendRuntimeHealthEffectsPlan(plan) {
	const effects = Array.isArray(plan && plan.effects) ? plan.effects : [];
	for (const effect of effects) applyFrontendRuntimeHealthEffect(effect);
}
function threadListRuntimeMetrics() {
	const list = $("threadList");
	if (!list || typeof list.getBoundingClientRect !== "function") return {
		present: false,
		visible: false,
		threadListCount: 0,
		scrollTop: 0,
		scrollHeight: 0
	};
	const rect = list.getBoundingClientRect();
	const viewportWidth = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
	const viewportHeight = Math.max(0, window.innerHeight || document.documentElement.clientHeight || 0);
	return {
		present: true,
		visible: document.visibilityState !== "hidden" && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth,
		threadListCount: list.querySelectorAll("[data-thread]").length,
		scrollTop: Math.max(0, Math.round(Number(list.scrollTop || 0))),
		scrollHeight: Math.max(0, Math.round(Number(list.scrollHeight || 0)))
	};
}
function recordThreadListRuntimeStall(input = {}) {
	const now = Date.now();
	if (now - Number(state.threadListRuntimeLastReportAt || 0) < THREAD_LIST_RUNTIME_STALL_REPORT_INTERVAL_MS) return false;
	const metrics = threadListRuntimeMetrics();
	const routeKind = diagnosticRouteKind();
	const threadListMonitorable = metrics.visible || metrics.present && document.visibilityState !== "hidden" && (routeKind === "embedded-primary" || routeKind === "standalone-root");
	const lastInputAt = Number(state.threadListRuntimeLastInputAt || 0);
	const recentInputAgeMs = lastInputAt > 0 ? Math.max(0, now - lastInputAt) : 0;
	const recentThreadListInput = lastInputAt > 0 && recentInputAgeMs <= THREAD_LIST_RUNTIME_RECENT_INPUT_MS;
	const plan = frontendRuntimeHealthApi.threadListInteractionStallEffects(Object.assign({
		threadListVisible: metrics.visible,
		threadListMonitorable,
		routeKind,
		minDelayMs: THREAD_LIST_RUNTIME_STALL_MIN_MS,
		h2ThresholdMs: THREAD_LIST_RUNTIME_STALL_H2_MS,
		recentThreadListInput,
		recentInputAgeMs,
		threadListCount: metrics.threadListCount,
		scrollTop: metrics.scrollTop,
		scrollHeight: metrics.scrollHeight
	}, input || {}));
	if (!plan.effects || !plan.effects.length) return false;
	state.threadListRuntimeLastReportAt = now;
	applyFrontendRuntimeHealthEffectsPlan(plan);
	postPerformanceEvent("thread_list_runtime_stall", {
		action: input.action || "thread-list-runtime",
		routeKind,
		maxRafDelayMs: Math.max(0, Math.round(Number(input.maxRafDelayMs || 0))),
		maxScrollApplyMs: Math.max(0, Math.round(Number(input.maxScrollApplyMs || 0))),
		maxLongTaskMs: Math.max(0, Math.round(Number(input.maxLongTaskMs || 0))),
		longTaskCount: Math.max(0, Math.round(Number(input.longTaskCount || 0))),
		recentThreadListInput,
		recentInputAgeMs,
		threadListCount: metrics.threadListCount,
		threadListVisible: Boolean(metrics.visible),
		threadListMonitorable: Boolean(threadListMonitorable)
	}, {
		key: "thread-list-runtime-stall",
		minIntervalMs: THREAD_LIST_RUNTIME_STALL_REPORT_INTERVAL_MS
	});
	return true;
}
function sampleThreadListInputDelay(action = "thread-list-input") {
	if (!threadListRuntimeMetrics().visible) return;
	state.threadListRuntimeLastInputAt = Date.now();
	const list = $("threadList");
	const startedAt = nowPerfMs();
	const startScrollTop = list ? Number(list.scrollTop || 0) : 0;
	requestAnimationFrame(() => {
		const rafDelayMs = roundedDurationMs(startedAt);
		requestAnimationFrame(() => {
			const elapsedMs = roundedDurationMs(startedAt);
			const scrollApplyMs = (list ? Number(list.scrollTop || 0) : startScrollTop) !== startScrollTop ? elapsedMs : rafDelayMs;
			recordThreadListRuntimeStall({
				action,
				maxRafDelayMs: rafDelayMs,
				maxScrollApplyMs: scrollApplyMs,
				elapsedMs
			});
		});
	});
}
function startThreadListRuntimeHeartbeat() {
	if (state.threadListRuntimeHeartbeatFrame) return;
	const tick = (timestamp) => {
		const previous = Number(state.threadListRuntimeLastFrameAt || 0);
		if (previous > 0) {
			const delayMs = Math.max(0, Math.round(Number(timestamp || 0) - previous));
			if (delayMs >= THREAD_LIST_RUNTIME_STALL_MIN_MS) recordThreadListRuntimeStall({
				action: "thread-list-heartbeat",
				maxRafDelayMs: delayMs,
				elapsedMs: delayMs
			});
		}
		state.threadListRuntimeLastFrameAt = Number(timestamp || nowPerfMs());
		state.threadListRuntimeHeartbeatFrame = requestAnimationFrame(tick);
	};
	state.threadListRuntimeHeartbeatFrame = requestAnimationFrame(tick);
}
function startThreadListRuntimeLongTaskObserver() {
	if (state.threadListRuntimeLongTaskObserver || typeof PerformanceObserver !== "function") return;
	try {
		const observer = new PerformanceObserver((list) => {
			let maxLongTaskMs = 0;
			let longTaskCount = 0;
			for (const entry of list.getEntries()) {
				const duration = Math.max(0, Math.round(Number(entry && entry.duration || 0)));
				if (duration < THREAD_LIST_RUNTIME_STALL_MIN_MS) continue;
				maxLongTaskMs = Math.max(maxLongTaskMs, duration);
				longTaskCount += 1;
			}
			if (maxLongTaskMs > 0) recordThreadListRuntimeStall({
				action: "thread-list-longtask",
				maxLongTaskMs,
				longTaskCount,
				elapsedMs: maxLongTaskMs
			});
		});
		observer.observe({
			type: "longtask",
			buffered: true
		});
		state.threadListRuntimeLongTaskObserver = observer;
	} catch (_) {
		state.threadListRuntimeLongTaskObserver = null;
	}
}
function startThreadListRuntimeStallMonitoring() {
	const list = $("threadList");
	if (list) [
		"pointerdown",
		"touchstart",
		"wheel",
		"scroll"
	].forEach((eventName) => {
		list.addEventListener(eventName, () => sampleThreadListInputDelay(`thread-list-${eventName}`), { passive: true });
	});
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") state.threadListRuntimeLastFrameAt = 0;
	});
	startThreadListRuntimeHeartbeat();
	startThreadListRuntimeLongTaskObserver();
}
function conversationHasClientSubmissionHash(submissionHash) {
	const hash = String(submissionHash || "").trim();
	const conversation = $("conversation");
	if (!hash || !conversation) return false;
	return Array.from(conversation.querySelectorAll("[data-client-submission-hash]")).some((node) => String(node && node.getAttribute && node.getAttribute("data-client-submission-hash") || "") === hash);
}
function frontendHealthThreadForSubmission(threadId) {
	const id = String(threadId || "").trim();
	if (!id) return null;
	if (state.currentThread && String(state.currentThread.id || "") === id) return state.currentThread;
	return state.threadTileDetails && state.threadTileDetails.get(id) || null;
}
function probeSubmittedMessageDom(threadId, clientSubmissionId, action = "message-submit", startedAtMs = Date.now()) {
	const id = String(threadId || "").trim();
	const submissionId = String(clientSubmissionId || "").trim();
	const submissionHash = clientSubmissionDiagnosticHash(submissionId);
	if (!id || !submissionId || !submissionHash) return;
	const elapsedMs = Date.now() - Number(startedAtMs || Date.now());
	const thread = frontendHealthThreadForSubmission(id);
	const domShape = conversationDomShape();
	const visibleShape = thread ? visibleConversationShape(thread) : { visibleItemCount: 0 };
	recordSubmittedEchoDiagnosticLog("dom-probe", {
		threadId: id,
		clientSubmissionId: submissionId,
		action,
		elapsedMs,
		domHasSubmission: conversationHasClientSubmissionHash(submissionHash),
		hasThreadSubmission: threadHasClientSubmission(thread, submissionId),
		visibleCount: visibleShape.visibleItemCount,
		domCount: domShape.itemCount,
		duplicateUserMessageCount: domShape.duplicateUserMessageCount,
		expectedDuplicateUserMessageCount: visibleShape.duplicateUserMessageCount || 0,
		composerBusy: state.composerBusy
	});
	applyFrontendRuntimeHealthEffectsPlan(frontendRuntimeHealthApi.submittedMessageDomProbeEffects({
		elapsedMs,
		action,
		routeKind: diagnosticRouteKind(),
		threadHash: diagnosticThreadHash(id),
		itemHash: submissionHash,
		currentThreadMatch: !state.threadTileMode && String(state.currentThreadId || "") === id,
		hasThreadSubmission: threadHasClientSubmission(thread, submissionId),
		domHasSubmission: conversationHasClientSubmissionHash(submissionHash),
		visibleCount: visibleShape.visibleItemCount,
		domCount: domShape.itemCount,
		duplicateUserMessageCount: domShape.duplicateUserMessageCount,
		expectedDuplicateUserMessageCount: visibleShape.duplicateUserMessageCount || 0,
		composerBusy: state.composerBusy
	}));
}
function scheduleSubmittedMessageDomProbe(threadId, clientSubmissionId, action = "message-submit") {
	const id = String(threadId || "").trim();
	const submissionId = String(clientSubmissionId || "").trim();
	if (!id || !submissionId) return;
	const startedAtMs = Date.now();
	[
		350,
		1200,
		2800
	].forEach((delayMs) => {
		setTimeout(() => probeSubmittedMessageDom(id, submissionId, action, startedAtMs), delayMs);
	});
}
function applyThreadDetailResponseDiagnosticEffect(effect) {
	const item = effect && typeof effect === "object" ? effect : {};
	if (!item.type) return;
	if (item.type === "diagnostic-failure") {
		recordHomeAiDiagnosticFailure(item.diagnostic || {});
		return;
	}
	if (item.type === "diagnostic-success") {
		recordHomeAiDiagnosticSuccess(item.diagnostic || {});
		return;
	}
	throw new Error(`Unknown thread detail response diagnostic effect: ${item.type}`);
}
function applyThreadDetailResponseDiagnosticEffectsPlan(plan) {
	const effects = Array.isArray(plan && plan.effects) ? plan.effects : [];
	for (const effect of effects) applyThreadDetailResponseDiagnosticEffect(effect);
}
function recordThreadDetailResponseDiagnostics(performanceEvent = {}, input = {}) {
	const source = input && typeof input === "object" ? input : {};
	const threadHash = diagnosticThreadHash(String(source.threadId || state.currentThreadId || ""));
	const action = String(source.action || "thread-detail").slice(0, 80);
	const durationBucket = source.durationBucket || diagnosticDurationBucket(Number(performanceEvent && performanceEvent.elapsedMs || 0));
	const slowPlan = threadPerformanceMetrics.planThreadDetailSlowPathDiagnostic(performanceEvent, {
		action,
		threadHash,
		durationBucket
	});
	const contractPlan = threadPerformanceMetrics.planThreadDetailResponseContractDiagnostic(performanceEvent, {
		action,
		threadHash,
		durationBucket,
		thread: source.thread,
		expectedActiveFullRead: source.expectedActiveFullRead,
		fullBackfillPlanned: source.fullBackfillPlanned === true || performanceEvent.fullBackfillPlanned === true
	});
	applyThreadDetailResponseDiagnosticEffectsPlan(threadDiagnosticEventsApi.threadDetailResponseDiagnosticEffects({
		slowPlan,
		slowSuccessInput: {
			action,
			threadHash,
			readMode: performanceEvent && performanceEvent.readMode || "",
			renderMode: performanceEvent && performanceEvent.clientTimings && performanceEvent.clientTimings.detailRenderMode || ""
		},
		contractPlan
	}));
}
function conversationDomShape() {
	const conversation = $("conversation");
	if (!conversation) return {
		renderKeyCount: 0,
		duplicateRenderKeyCount: 0,
		duplicateUserMessageCount: 0,
		turnCount: 0,
		itemCount: 0
	};
	const seen = /* @__PURE__ */ new Set();
	let duplicateRenderKeyCount = 0;
	for (const node of Array.from(conversation.querySelectorAll("[data-render-key]"))) {
		const key = String(node && node.getAttribute && node.getAttribute("data-render-key") || "");
		if (!key) continue;
		if (seen.has(key)) duplicateRenderKeyCount += 1;
		else seen.add(key);
	}
	let duplicateUserMessageCount = 0;
	const userMessageNodes = [];
	for (const turnNode of Array.from(conversation.querySelectorAll("article.turn[data-turn], article.thread-tile-turn[data-thread-tile-turn]"))) for (const node of Array.from(turnNode.querySelectorAll(".item.userMessage"))) userMessageNodes.push({
		turnNode,
		node
	});
	const eventDuplicateUserMessageCount = duplicateUserMessageSignatureCount(userMessageNodes, (entry) => domUserMessageEventDuplicateSignature(entry.turnNode, entry.node));
	const turnDuplicateUserMessageCount = duplicateUserMessageSignatureCount(userMessageNodes, (entry) => domUserMessageDuplicateSignature(entry.turnNode, entry.node));
	duplicateUserMessageCount = Math.max(eventDuplicateUserMessageCount, turnDuplicateUserMessageCount);
	return {
		renderKeyCount: seen.size,
		duplicateRenderKeyCount,
		duplicateUserMessageCount,
		turnCount: conversation.querySelectorAll("article.turn[data-turn], article.thread-tile-turn[data-thread-tile-turn]").length,
		itemCount: conversation.querySelectorAll("[data-item]").length
	};
}
function duplicateUserMessageSignatureCount(entries, signatureForEntry) {
	const seen = /* @__PURE__ */ new Set();
	let duplicates = 0;
	for (const entry of Array.isArray(entries) ? entries : []) {
		const signature = String(signatureForEntry(entry) || "").trim();
		if (!signature) continue;
		if (seen.has(signature)) duplicates += 1;
		else seen.add(signature);
	}
	return duplicates;
}
function domUserMessageDuplicateSignature(turnNode, node) {
	if (!node || !node.getAttribute) return "";
	const turnId = String(turnNode && turnNode.getAttribute && (turnNode.getAttribute("data-turn") || turnNode.getAttribute("data-thread-tile-turn")) || "").trim();
	const submissionHash = String(node.getAttribute("data-client-submission-hash") || "").trim();
	const body = node.querySelector && node.querySelector(".item-body");
	const text = String((body || node).textContent || "").replace(/\s+/g, " ").trim();
	if (submissionHash && text) return `submission-text:${turnId}:${submissionHash}:${stableTextHash(text)}`;
	if (submissionHash) return `submission:${turnId}:${submissionHash}`;
	return text ? `text:${turnId}:${stableTextHash(text)}` : "";
}
function domUserMessageEventDuplicateSignature(turnNode, node) {
	if (!node || !node.getAttribute) return "";
	const submissionHash = String(node.getAttribute("data-client-submission-hash") || "").trim();
	const body = node.querySelector && node.querySelector(".item-body");
	const text = String((body || node).textContent || "").replace(/\s+/g, " ").trim();
	const textHash = text ? stableTextHash(text) : "";
	if (submissionHash && textHash) return `submission-text:${submissionHash}:${textHash}`;
	if (submissionHash) return `submission:${submissionHash}`;
	if (!text) return "";
	const timestamp = node.querySelector && node.querySelector(".item-timestamp");
	const datetime = String(timestamp && timestamp.getAttribute && timestamp.getAttribute("datetime") || "").trim();
	const timestampMs = datetime ? Date.parse(datetime) : 0;
	if (Number.isFinite(timestampMs) && timestampMs > 0) return `text-time:${Math.floor(timestampMs / 5e3)}:${stableTextHash(text)}`;
	return domUserMessageDuplicateSignature(turnNode, node);
}
function visibleUserMessageDuplicateSignature(turn, item) {
	if (!item || item.type !== "userMessage") return "";
	const turnId = String(turn && turn.id || turn && turn.mobileVisibleKey || "").trim();
	const submissionHash = clientSubmissionDiagnosticHash(item && item.clientSubmissionId);
	const comparable = userMessageComparableParts(item);
	const text = String(comparable.text || itemTextValue(item && item.text) || itemTextValue(item && item.message) || itemTextValue(item && item.content) || "").replace(/\s+/g, " ").trim();
	if (submissionHash && text) return `submission-text:${turnId}:${submissionHash}:${stableTextHash(text)}`;
	if (submissionHash) return `submission:${turnId}:${submissionHash}`;
	return text ? `text:${turnId}:${stableTextHash(text)}` : "";
}
function visibleUserMessageEventDuplicateSignature(turn, item) {
	if (!item || item.type !== "userMessage") return "";
	const submissionHash = clientSubmissionDiagnosticHash(item && item.clientSubmissionId);
	const comparable = userMessageComparableParts(item);
	const text = String(comparable.text || itemTextValue(item && item.text) || itemTextValue(item && item.message) || itemTextValue(item && item.content) || "").replace(/\s+/g, " ").trim();
	const textHash = text ? stableTextHash(text) : "";
	if (submissionHash && textHash) return `submission-text:${submissionHash}:${textHash}`;
	if (submissionHash) return `submission:${submissionHash}`;
	if (!text) return "";
	const timestampMs = userMessageTimestampMs(item) || turnStartedAtMs(turn);
	if (timestampMs) return `text-time:${Math.floor(timestampMs / 5e3)}:${stableTextHash(text)}`;
	return visibleUserMessageDuplicateSignature(turn, item);
}
function turnRendersConversationArticle(turn, thread) {
	if (!turn || !turn.id) return false;
	if (visibleItemsForTurn(turn, thread).length > 0) return true;
	if (typeof visibleItemBudgetSignature === "function" && visibleItemBudgetSignature(turn)) return true;
	const threadId = typeof renderContextThreadId === "function" ? renderContextThreadId(thread) : String(thread && thread.id || state.currentThreadId || "");
	if (typeof approvalsForTurn === "function" && approvalsForTurn(threadId, turn.id).length > 0) return true;
	if (typeof turnHasThreadTaskCardDraftResponse === "function" && turnHasThreadTaskCardDraftResponse(turn)) return true;
	return Boolean(typeof turnHasThreadTaskCardRequest === "function" && typeof isLatestTurn === "function" && typeof isLiveTurn === "function" && isLatestTurn(turn, thread) && isLiveTurn(turn, thread) && turnHasThreadTaskCardRequest(turn));
}
function visibleRenderableTurnsForConversation(thread) {
	return visibleTurnsForConversation(thread).filter((turn) => turnRendersConversationArticle(turn, thread));
}
function returnReceiptTurnIdsForConversation(thread, turns = null) {
	const renderableTurns = Array.isArray(turns) ? turns : visibleRenderableTurnsForConversation(thread);
	if (typeof threadTaskCardReturnReceiptFlowTurnIds === "function") return threadTaskCardReturnReceiptFlowTurnIds(thread, renderableTurns).map(String).filter(Boolean);
	if (typeof threadTaskCardReturnReceiptTurnIds !== "function") return [];
	return renderableTurns.map((turn) => String(turn && turn.id || "").trim()).filter(Boolean).concat(threadTaskCardReturnReceiptTurnIds(thread).map(String).filter(Boolean));
}
function visibleConversationShape(thread) {
	const turns = visibleRenderableTurnsForConversation(thread);
	const returnReceiptTurnIds = typeof returnReceiptTurnIdsForConversation === "function" ? returnReceiptTurnIdsForConversation(thread, turns).filter((id) => !turns.some((turn) => String(turn && turn.id || "") === id)) : [];
	let visibleItemCount = 0;
	const userMessages = [];
	for (const turn of turns) {
		const visibleItems = visibleItemsForTurn(turn, thread);
		visibleItemCount += visibleItems.length;
		for (const entry of visibleItems) {
			const item = entry && entry.item;
			if (item && item.type === "userMessage") userMessages.push({
				turn,
				item
			});
		}
	}
	const eventDuplicateUserMessageCount = duplicateUserMessageSignatureCount(userMessages, (entry) => visibleUserMessageEventDuplicateSignature(entry.turn, entry.item));
	const turnDuplicateUserMessageCount = duplicateUserMessageSignatureCount(userMessages, (entry) => visibleUserMessageDuplicateSignature(entry.turn, entry.item));
	const duplicateUserMessageCount = Math.max(eventDuplicateUserMessageCount, turnDuplicateUserMessageCount);
	return {
		visibleTurnCount: turns.length + returnReceiptTurnIds.length,
		visibleItemCount,
		duplicateUserMessageCount
	};
}
function rememberThreadDetailRenderEvidence(thread, source = "unknown") {
	if (!thread || thread.mobileLoading || thread.mobileLoadError) return null;
	const threadId = String(thread.id || state.currentThreadId || "").trim();
	if (!threadId) return null;
	const shape = visibleConversationShape(thread);
	if (!shape.visibleTurnCount && !shape.visibleItemCount) return null;
	const itemCount = (Array.isArray(thread.turns) ? thread.turns : []).reduce((total, turn) => total + (Array.isArray(turn && turn.items) ? turn.items.length : 0), 0);
	const evidence = threadDetailStateApi.buildThreadDetailRenderEvidence({
		atMs: Date.now(),
		threadId,
		threadHash: diagnosticThreadHash(threadId),
		readMode: thread.mobileReadMode || "",
		sourceKind: homeAiDiagnosticReportingApi.boundedToken(source, "unknown", 80),
		turnCount: shape.visibleTurnCount,
		visibleItemCount: shape.visibleItemCount,
		itemCount
	});
	if (!evidence) return null;
	state.lastThreadDetailRenderEvidence = evidence;
	return evidence;
}
function clearThreadDetailRenderEvidence(reason = "") {
	if (!state.lastThreadDetailRenderEvidence) return;
	state.lastThreadDetailRenderEvidence = null;
	postClientEvent("thread_detail_render_evidence_cleared", { reason: String(reason || "").slice(0, 80) });
}
function recentThreadDetailRenderEvidence() {
	return threadDetailStateApi.recentThreadDetailRenderEvidence({
		evidence: state.lastThreadDetailRenderEvidence,
		nowMs: Date.now(),
		maxAgeMs: PRIMARY_SHELL_CONFLICT_EVIDENCE_MS
	});
}
function primaryShellSelectionConflictInput(reason, details = {}) {
	const evidence = recentThreadDetailRenderEvidence() || {};
	const thread = state.currentThread || null;
	const shape = thread ? visibleConversationShape(thread) : null;
	return {
		reason,
		action: "primary-shell-selection",
		routeKind: "embedded-primary",
		sourceKind: details.source || evidence.sourceKind || "",
		threadHash: evidence.threadHash || diagnosticThreadHash(state.currentThreadId || thread && thread.id || ""),
		readMode: evidence.readMode || thread && thread.mobileReadMode || "",
		renderMode: details.renderMode || "",
		turns: evidence.turnCount || shape && shape.visibleTurnCount || 0,
		visibleItems: evidence.visibleItemCount || shape && shape.visibleItemCount || 0,
		items: evidence.itemCount || 0,
		domCount: details.domCount,
		previousCount: details.previousCount,
		recentDetailAgeMs: evidence.ageMs || 0,
		hasCurrentThread: Boolean(state.currentThread),
		hasCurrentThreadId: Boolean(state.currentThreadId),
		hasThreadLoadController: Boolean(state.threadLoadController),
		startupThreadOpenPending: Boolean(state.startupThreadOpenPending),
		mobileLoading: Boolean(state.currentThread && state.currentThread.mobileLoading)
	};
}
function recordPrimaryShellSelectionConflict(reason, details = {}) {
	return recordHomeAiDiagnosticFailure(threadDiagnosticEventsApi.primaryShellSelectionConflictDiagnosticEvent(primaryShellSelectionConflictInput(reason, details)));
}
function recordPrimaryShellSelectionHealthy(source, thread = state.currentThread) {
	const evidence = rememberThreadDetailRenderEvidence(thread, source);
	if (!evidence) return null;
	return recordHomeAiDiagnosticSuccess(threadDiagnosticEventsApi.primaryShellSelectionConflictDiagnosticSuccess({
		action: "primary-shell-selection",
		routeKind: "embedded-primary",
		sourceKind: source,
		threadHash: evidence.threadHash,
		readMode: evidence.readMode
	}));
}
function emptyVisibleDetailMismatchInput(reason, thread = state.currentThread, details = {}) {
	const threadId = String(thread && thread.id || state.currentThreadId || "").trim();
	const evidence = recentThreadDetailRenderEvidence();
	const sameThreadEvidence = threadDetailStateApi.sameThreadDetailRenderEvidence({
		evidence,
		threadId
	});
	const shape = thread ? visibleConversationShape(thread) : {
		visibleTurnCount: 0,
		visibleItemCount: 0
	};
	return {
		reason,
		action: details.action || "single-thread-empty-state",
		routeKind: details.routeKind || "single-thread",
		sourceKind: details.source || sameThreadEvidence && sameThreadEvidence.sourceKind || "",
		threadHash: details.threadHash || sameThreadEvidence && sameThreadEvidence.threadHash || diagnosticThreadHash(threadId),
		readMode: sameThreadEvidence && sameThreadEvidence.readMode || thread && thread.mobileReadMode || "",
		renderMode: details.renderMode || "",
		turns: Object.prototype.hasOwnProperty.call(details, "turns") ? details.turns : sameThreadEvidence && sameThreadEvidence.turnCount || 0,
		visibleItems: Object.prototype.hasOwnProperty.call(details, "visibleItems") ? details.visibleItems : sameThreadEvidence && sameThreadEvidence.visibleItemCount || 0,
		items: Object.prototype.hasOwnProperty.call(details, "items") ? details.items : sameThreadEvidence && sameThreadEvidence.itemCount || 0,
		currentTurns: Object.prototype.hasOwnProperty.call(details, "currentTurns") ? details.currentTurns : shape.visibleTurnCount,
		currentVisibleItems: Object.prototype.hasOwnProperty.call(details, "currentVisibleItems") ? details.currentVisibleItems : shape.visibleItemCount,
		domCount: details.domCount,
		previousCount: details.previousCount,
		detailLoaded: Boolean(thread && thread.mobileDetailLoaded),
		mobileLoading: Boolean(thread && thread.mobileLoading),
		recentDetailAgeMs: sameThreadEvidence && sameThreadEvidence.ageMs || 0
	};
}
function recordEmptyVisibleDetailMismatch(reason, thread = state.currentThread, details = {}) {
	return recordHomeAiDiagnosticFailure(threadDiagnosticEventsApi.emptyVisibleDetailMismatchDiagnosticEvent(emptyVisibleDetailMismatchInput(reason, thread, details)));
}
function recordEmptyVisibleDetailHealthy(source, thread = state.currentThread, details = {}) {
	if (!thread || thread.mobileLoading || thread.mobileLoadError) return null;
	const threadId = String(thread.id || state.currentThreadId || "").trim();
	if (!threadId) return null;
	const shape = visibleConversationShape(thread);
	if (!shape.visibleTurnCount && !shape.visibleItemCount) return null;
	return recordHomeAiDiagnosticSuccess(threadDiagnosticEventsApi.emptyVisibleDetailMismatchDiagnosticSuccess({
		action: details.action || "single-thread-empty-state",
		routeKind: details.routeKind || "single-thread",
		sourceKind: source,
		threadHash: details.threadHash || diagnosticThreadHash(threadId),
		readMode: thread.mobileReadMode || "",
		renderMode: details.renderMode || ""
	}));
}
function maybeRecoverEmptyDetailWithHistoryEvidence(thread, details = {}) {
	const now = Date.now();
	const basePlan = threadDetailStateApi.planEmptyDetailHistoryRecovery({
		thread,
		currentThreadId: state.currentThreadId,
		details,
		nowMs: now,
		cooldownMs: 0
	});
	if (!basePlan.shouldRecover || !basePlan.recoveryKey) return false;
	const plan = threadDetailStateApi.planEmptyDetailHistoryRecovery({
		thread,
		currentThreadId: state.currentThreadId,
		details,
		nowMs: now,
		lastRecoveredAtMs: state.emptyDetailHistoryRecoveryAtByKey.get(basePlan.recoveryKey),
		cooldownMs: EMPTY_DETAIL_HISTORY_RECOVERY_COOLDOWN_MS
	});
	if (!plan.shouldRecover || !plan.recoveryKey) return false;
	state.emptyDetailHistoryRecoveryAtByKey.set(plan.recoveryKey, plan.nowMs || now);
	recordEmptyVisibleDetailMismatch(plan.diagnosticReason || "empty_render_with_history_evidence", thread, details);
	if (!hasThreadDetailRequestInFlight()) scheduleCurrentThreadRefresh(0, "empty-detail-history-evidence");
	postClientEvent("empty_detail_history_recovery", plan.event || {});
	return true;
}
function emptyCachedDetailReuseInput(reason, thread = state.currentThread, details = {}) {
	const threadId = String(thread && thread.id || state.currentThreadId || "").trim();
	const shape = thread ? visibleConversationShape(thread) : {
		visibleTurnCount: 0,
		visibleItemCount: 0
	};
	const itemCount = (Array.isArray(thread && thread.turns) ? thread.turns : []).reduce((total, turn) => total + (Array.isArray(turn && turn.items) ? turn.items.length : 0), 0);
	return {
		reason,
		action: "thread-open-cache-reuse",
		routeKind: "single-thread",
		sourceKind: details.source || "",
		threadHash: diagnosticThreadHash(threadId),
		readMode: thread && thread.mobileReadMode || "",
		currentTurns: shape.visibleTurnCount,
		currentVisibleItems: shape.visibleItemCount,
		items: itemCount,
		detailLoaded: Boolean(thread && thread.mobileDetailLoaded),
		reusableDetail: Boolean(details.reusableDetail),
		mobileLoading: Boolean(thread && thread.mobileLoading),
		threadTaskCardCount: Array.isArray(thread && thread.threadTaskCards) ? thread.threadTaskCards.length : 0
	};
}
function recordEmptyCachedDetailReuseBlocked(reason, thread = state.currentThread, details = {}) {
	return recordHomeAiDiagnosticFailure(threadDiagnosticEventsApi.emptyCachedDetailReuseBlockedDiagnosticEvent(emptyCachedDetailReuseInput(reason, thread, details)));
}
function recordEmptyCachedDetailReuseHealthy(source, thread = state.currentThread) {
	const threadId = String(thread && thread.id || state.currentThreadId || "").trim();
	if (!threadId) return null;
	return recordHomeAiDiagnosticSuccess(threadDiagnosticEventsApi.emptyCachedDetailReuseDiagnosticSuccess({
		action: "thread-open-cache-reuse",
		routeKind: "single-thread",
		sourceKind: source,
		threadHash: diagnosticThreadHash(threadId),
		readMode: thread && thread.mobileReadMode || ""
	}));
}
function checkEmptyVisibleDetailMismatchAfterRender(thread, shellPlan = {}, metrics = {}) {
	if (!thread || thread.mobileLoading || thread.mobileLoadError) return;
	if (shellPlan.hasPrimaryContent || shellPlan.emptyMessage !== "No visible turns.") return;
	const threadId = String(thread.id || state.currentThreadId || "").trim();
	const evidence = recentThreadDetailRenderEvidence();
	const details = {
		source: metrics.source || "single-thread-render",
		renderMode: metrics.renderMode || "full-render",
		domCount: metrics.domCount,
		previousCount: metrics.previousCount
	};
	if (threadDetailStateApi.hasNonemptyThreadDetailRenderEvidence(threadDetailStateApi.sameThreadDetailRenderEvidence({
		evidence,
		threadId
	}))) {
		recordEmptyVisibleDetailMismatch("empty_render_after_nonempty_detail", thread, details);
		return;
	}
	maybeRecoverEmptyDetailWithHistoryEvidence(thread, details);
}
function visibleRenderableTurnIds(thread) {
	const turns = visibleRenderableTurnsForConversation(thread);
	if (typeof returnReceiptTurnIdsForConversation === "function") return returnReceiptTurnIdsForConversation(thread, turns);
	return turns.map((turn) => String(turn.id));
}
function conversationDomTurnIds(conversation = $("conversation")) {
	if (!conversation) return [];
	return Array.from(conversation.querySelectorAll("article.turn[data-turn]")).map((node) => String(node && node.getAttribute && node.getAttribute("data-turn") || "")).filter(Boolean);
}
function threadTileVisibleShape(ids = state.threadTileActiveIds) {
	return (Array.isArray(ids) ? ids : []).reduce((shape, id) => {
		const thread = threadTileDisplayThread(id);
		visibleTurnsForConversation(thread).forEach((turn) => {
			const visibleItems = visibleItemsForTurn(turn, thread);
			const itemCount = visibleItems.length;
			if (itemCount > 0) {
				shape.turnCount += 1;
				shape.visibleItemCount += itemCount;
				const userMessages = visibleItems.map((entry) => entry && entry.item).filter((item) => item && item.type === "userMessage");
				shape.duplicateUserMessageCount += duplicateUserMessageSignatureCount(userMessages, (item) => visibleUserMessageDuplicateSignature(turn, item));
			}
		});
		return shape;
	}, {
		turnCount: 0,
		visibleItemCount: 0,
		duplicateUserMessageCount: 0
	});
}
function threadTileVisibleTurnCount(ids = state.threadTileActiveIds) {
	return threadTileVisibleShape(ids).turnCount;
}
function threadTileDomTurnCount(conversation = $("conversation")) {
	if (!conversation) return 0;
	return conversation.querySelectorAll("article.thread-tile-turn[data-thread-tile-turn]").length;
}
function conversationTurnOrderDiagnosticSnapshot(source, extra = {}, deps = {}) {
	const conversation = deps.conversation || $("conversation");
	const thread = deps.thread || state.currentThread;
	if (!conversation || !thread) return null;
	const tileMode = Object.prototype.hasOwnProperty.call(deps, "threadTileMode") ? deps.threadTileMode === true : state.threadTileMode === true;
	const tileDomActive = Object.prototype.hasOwnProperty.call(deps, "tileDomActive") ? deps.tileDomActive === true : Boolean(conversation.classList && conversation.classList.contains("thread-tile-mode"));
	if (tileMode || tileDomActive) return null;
	const expectedIds = Array.isArray(deps.expectedTurnIds) ? deps.expectedTurnIds.map(String).filter(Boolean) : visibleRenderableTurnIds(thread);
	const domIds = Array.isArray(deps.domTurnIds) ? deps.domTurnIds.map(String).filter(Boolean) : conversationDomTurnIds(conversation);
	const expectedLatestId = expectedIds[expectedIds.length - 1] || "";
	return threadDiagnosticEventsApi.turnOrderDiagnosticSnapshot({
		source,
		readMode: thread.mobileReadMode || "",
		renderMode: extra.renderMode || "",
		threadHash: diagnosticThreadHash(thread.id || state.currentThreadId),
		turnHash: diagnosticTurnHash(expectedLatestId),
		expectedTurnIds: expectedIds,
		domTurnIds: domIds
	});
}
function conversationProjectionDiagnosticSnapshot(source, extra = {}, deps = {}) {
	const conversation = deps.conversation || $("conversation");
	if (!conversation) return null;
	const renderedSignature = Object.prototype.hasOwnProperty.call(deps, "renderedConversationSignature") ? String(deps.renderedConversationSignature || "") : String(state.renderedConversationSignature || "");
	const domShape = deps.domShape || conversationDomShape();
	const tileMode = Object.prototype.hasOwnProperty.call(deps, "threadTileMode") ? deps.threadTileMode === true : state.threadTileMode === true;
	const tileDomActive = Object.prototype.hasOwnProperty.call(deps, "tileDomActive") ? deps.tileDomActive === true : Boolean(conversation.classList && conversation.classList.contains("thread-tile-mode"));
	return threadDiagnosticEventsApi.conversationProjectionDiagnosticSnapshot({
		source,
		renderMode: extra.renderMode,
		renderedSignature,
		domShape,
		threadTileMode: tileMode,
		tileDomActive,
		tileLayout: deps.tileLayout,
		tileIds: deps.tileIds,
		tileDisplayLayout: deps.tileDisplayLayout,
		tileSignature: deps.tileSignature,
		currentSignature: deps.currentSignature,
		thread: deps.thread || state.currentThread
	}, {
		singleSignature: conversationRenderSignature,
		tileLayout: threadTileLayout,
		tileCandidateIds: threadTileCandidateIds,
		tileDisplayLayout: threadTileDisplayLayout,
		tileRenderSignature: threadTileRenderSignature,
		tileThreadForId: typeof deps.tileThreadForId === "function" ? deps.tileThreadForId : threadTileDisplayThread,
		visibleShape: visibleConversationShape
	});
}
function applyConversationProjectionConsistencyEffect(effect) {
	const item = effect && typeof effect === "object" ? effect : {};
	if (!item.type) return;
	if (item.type === "diagnostic-failure") {
		recordHomeAiDiagnosticFailure(item.diagnostic || {});
		return;
	}
	if (item.type === "diagnostic-success") {
		recordHomeAiDiagnosticSuccess(item.diagnostic || {});
		return;
	}
	throw new Error(`Unknown conversation projection consistency effect: ${item.type}`);
}
function applyConversationProjectionConsistencyEffectsPlan(plan) {
	const effects = Array.isArray(plan && plan.effects) ? plan.effects : [];
	for (const effect of effects) applyConversationProjectionConsistencyEffect(effect);
}
function checkConversationProjectionConsistency(source, extra = {}) {
	if (!state.currentThread || state.currentThread.mobileLoading || state.currentThread.mobileLoadError) return;
	recordPrimaryShellSelectionHealthy(source, state.currentThread);
	recordEmptyVisibleDetailHealthy(source, state.currentThread, extra);
	const snapshot = conversationProjectionDiagnosticSnapshot(source, extra);
	if (!snapshot) return;
	const orderSnapshot = conversationTurnOrderDiagnosticSnapshot(source, extra);
	applyConversationProjectionConsistencyEffectsPlan(threadDiagnosticEventsApi.conversationProjectionConsistencyEffects({
		snapshot,
		orderSnapshot
	}));
}
function startUiWatchdog() {
	if (state.uiWatchdogTimer) return;
	state.lastUiWatchdogTickAt = Date.now();
	state.uiWatchdogTimer = setInterval(() => {
		const now = Date.now();
		const lagMs = now - state.lastUiWatchdogTickAt - 1e3;
		state.lastUiWatchdogTickAt = now;
		if (document.visibilityState === "hidden" || lagMs < 2500) return;
		if (now - state.lastUiStallReportedAt < 15e3) return;
		state.lastUiStallReportedAt = now;
		postClientEvent("ui_stall", {
			lagMs: Math.round(lagMs),
			composerBusy: state.composerBusy,
			activeTurnId: state.activeTurnId || "",
			hasContent: composerHasContent()
		});
	}, 1e3);
}
function updatePushButton() {
	const button = $("pushNotifications");
	if (!button) return;
	button.classList.remove("hidden", "ready", "error");
	const hideButton = () => {
		button.textContent = "";
		button.disabled = true;
		button.classList.add("hidden");
	};
	if (state.pushBusy) {
		button.textContent = "Working...";
		button.disabled = true;
		return;
	}
	if (!state.pushServerSupported) {
		hideButton();
		return;
	}
	if (!window.isSecureContext) {
		hideButton();
		return;
	}
	if (!pushBrowserAvailable()) {
		hideButton();
		return;
	}
	if (Notification.permission === "denied") {
		button.textContent = "Notifications blocked";
		button.disabled = true;
		button.classList.add("error");
		return;
	}
	if (state.pushSubscribed) {
		button.textContent = "Send test notification";
		button.disabled = false;
		button.classList.add("ready");
		return;
	}
	button.textContent = "Enable notifications";
	button.disabled = false;
	if (state.pushError) button.classList.add("error");
}
async function registerPushServiceWorker() {
	if (state.serviceWorkerRegistration) return state.serviceWorkerRegistration;
	state.serviceWorkerRegistration = await navigator.serviceWorker.register("/sw.js");
	if (state.serviceWorkerRegistration && state.serviceWorkerRegistration.update) state.serviceWorkerRegistration.update().catch(() => {});
	return state.serviceWorkerRegistration;
}
async function syncExistingPushSubscription() {
	if (!state.key || !pushBrowserAvailable()) return;
	const subscription = await (await registerPushServiceWorker()).pushManager.getSubscription();
	state.pushSubscribed = Boolean(subscription);
	if (subscription) await api$6("/api/push/subscribe", {
		method: "POST",
		body: JSON.stringify({ subscription: pushSubscriptionToJson(subscription) })
	});
}
async function initializePushControls() {
	state.pushError = "";
	updatePushButton();
	if (!pushBrowserAvailable() || !state.key) return;
	try {
		await syncExistingPushSubscription();
	} catch (err) {
		state.pushError = err.message || String(err);
	} finally {
		updatePushButton();
	}
}
async function enablePushNotifications() {
	if (!pushBrowserAvailable()) return;
	const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
	if (permission !== "granted") {
		state.pushSubscribed = false;
		state.pushError = permission === "denied" ? "Notifications blocked" : "Notification permission not granted";
		updatePushButton();
		return;
	}
	const registration = await registerPushServiceWorker();
	let subscription = await registration.pushManager.getSubscription();
	if (!subscription) {
		const key = await api$6("/api/push/vapid-public-key");
		subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: base64UrlToUint8Array(key.publicKey)
		});
	}
	await api$6("/api/push/subscribe", {
		method: "POST",
		body: JSON.stringify({ subscription: pushSubscriptionToJson(subscription) })
	});
	state.pushSubscribed = true;
	state.pushError = "";
	$("connectionState").classList.remove("error");
	$("connectionState").textContent = "Notifications enabled";
}
async function sendTestPushNotification() {
	const result = await api$6("/api/push/test", {
		method: "POST",
		body: "{}"
	});
	$("connectionState").classList.remove("error");
	if (result.sent) {
		$("connectionState").textContent = "Test notification sent";
		return;
	}
	if (result.failed) {
		const detail = result.lastError && (result.lastError.reason || result.lastError.statusCode) ? `${result.lastError.statusCode || ""} ${result.lastError.reason || ""}`.trim() : "delivery failed";
		throw new Error(`Test notification failed: ${detail}`);
	}
	$("connectionState").textContent = "No push subscription";
}
async function handlePushButtonClick() {
	if (state.pushBusy) return;
	state.pushBusy = true;
	updatePushButton();
	try {
		if (state.pushSubscribed) await sendTestPushNotification();
		else await enablePushNotifications();
	} catch (err) {
		state.pushError = err.message || String(err);
		showError(err);
	} finally {
		state.pushBusy = false;
		updatePushButton();
	}
}
var legacyGlobals = {
	api: api$6,
	postClientEvent,
	nowPerfMs,
	roundedDurationMs,
	postPerformanceEvent,
	diagnosticHash,
	diagnosticThreadHash,
	diagnosticTurnHash,
	diagnosticTaskHash,
	diagnosticItemHash,
	clientSubmissionDiagnosticHash,
	clientSubmissionDataAttr,
	frontendDiagnosticLogSettings,
	frontendDiagnosticLogStatus,
	applyFrontendDiagnosticLogPublicConfig,
	setFrontendDiagnosticLogEnabled,
	configureFrontendDiagnosticLog,
	readFrontendDiagnosticLog,
	clearFrontendDiagnosticLog,
	exportFrontendDiagnosticLog,
	recordFrontendDiagnosticLog,
	submittedEchoDiagnosticSnapshot,
	recordSubmittedEchoDiagnosticLog,
	recordRecentSubmittedEchoDiagnosticLogs,
	diagnosticRouteKind,
	diagnosticErrorStatus,
	diagnosticErrorCode,
	diagnosticDurationBucket,
	currentHomeAiDiagnosticContext,
	postHomeAiDiagnosticReport,
	recordHomeAiDiagnosticFailure,
	recordHomeAiDiagnosticSuccess,
	applyFrontendRuntimeHealthEffect,
	applyFrontendRuntimeHealthEffectsPlan,
	threadListRuntimeMetrics,
	recordThreadListRuntimeStall,
	sampleThreadListInputDelay,
	startThreadListRuntimeHeartbeat,
	startThreadListRuntimeLongTaskObserver,
	startThreadListRuntimeStallMonitoring,
	conversationHasClientSubmissionHash,
	frontendHealthThreadForSubmission,
	probeSubmittedMessageDom,
	scheduleSubmittedMessageDomProbe,
	applyThreadDetailResponseDiagnosticEffect,
	applyThreadDetailResponseDiagnosticEffectsPlan,
	recordThreadDetailResponseDiagnostics,
	conversationDomShape,
	duplicateUserMessageSignatureCount,
	domUserMessageDuplicateSignature,
	domUserMessageEventDuplicateSignature,
	visibleUserMessageDuplicateSignature,
	visibleUserMessageEventDuplicateSignature,
	turnRendersConversationArticle,
	visibleRenderableTurnsForConversation,
	visibleConversationShape,
	rememberThreadDetailRenderEvidence,
	clearThreadDetailRenderEvidence,
	recentThreadDetailRenderEvidence,
	primaryShellSelectionConflictInput,
	recordPrimaryShellSelectionConflict,
	recordPrimaryShellSelectionHealthy,
	emptyVisibleDetailMismatchInput,
	recordEmptyVisibleDetailMismatch,
	recordEmptyVisibleDetailHealthy,
	maybeRecoverEmptyDetailWithHistoryEvidence,
	emptyCachedDetailReuseInput,
	recordEmptyCachedDetailReuseBlocked,
	recordEmptyCachedDetailReuseHealthy,
	checkEmptyVisibleDetailMismatchAfterRender,
	visibleRenderableTurnIds,
	conversationDomTurnIds,
	threadTileVisibleShape,
	threadTileVisibleTurnCount,
	threadTileDomTurnCount,
	conversationTurnOrderDiagnosticSnapshot,
	conversationProjectionDiagnosticSnapshot,
	applyConversationProjectionConsistencyEffect,
	applyConversationProjectionConsistencyEffectsPlan,
	checkConversationProjectionConsistency,
	startUiWatchdog,
	updatePushButton,
	registerPushServiceWorker,
	syncExistingPushSubscription,
	initializePushControls,
	enablePushNotifications,
	sendTestPushNotification,
	handlePushButtonClick
};
root$1.CodexFrontendLog = frontendDiagnosticLogApi;
function createApiClientRuntime() {
	return Object.assign({}, legacyGlobals);
}
var apiClientRuntimeApi = Object.freeze({ createApiClientRuntime });
for (const [name, value] of Object.entries(legacyGlobals)) if (typeof value === "function") root$1[name] = value;
root$1.CodexApiClientRuntime = apiClientRuntimeApi;
//#endregion
//#region frontend/native/thread-list-load-policy.mjs
function bool(value) {
	return value === true;
}
function text$1(value) {
	return String(value || "").trim();
}
function planThreadListLoadRequest(input = {}) {
	const silent = bool(input.silent);
	const selectedCwd = text$1(input.selectedCwd);
	const search = text$1(input.search);
	const threadDetailOpening = bool(input.threadDetailOpening);
	const documentHidden = bool(input.documentHidden);
	const allowDuringDetail = bool(input.allowDuringDetail);
	const allowHidden = bool(input.allowHidden);
	const hasLoadedList = Number(input.threadListLoadedAtMs || 0) > 0;
	const deferFallback = input.deferFallback;
	const suppressHiddenSilent = silent && documentHidden && !allowHidden;
	const suppressDetailSilent = silent && threadDetailOpening && !allowDuringDetail;
	const allowWarmFallbackInitial = deferFallback !== false && !selectedCwd && !search;
	const shouldDeferFallback = deferFallback === true || silent && deferFallback !== false && threadDetailOpening && !selectedCwd && !search;
	const shouldUseWarmFallbackInitial = allowWarmFallbackInitial && (shouldDeferFallback || !hasLoadedList);
	return {
		action: "thread-list-load-request",
		selectedCwd,
		search,
		silent,
		threadDetailOpening,
		documentHidden,
		shouldLoad: !suppressHiddenSilent && !suppressDetailSilent,
		skipReason: suppressHiddenSilent ? "hidden-silent" : suppressDetailSilent ? "detail-in-flight" : "",
		retryDelayMs: suppressDetailSilent ? 700 : 0,
		shouldDeferFallback,
		shouldUseWarmFallbackInitial,
		params: {
			fallback: shouldDeferFallback ? "defer" : "",
			initial: shouldUseWarmFallbackInitial ? "warm-fallback" : ""
		}
	};
}
var thread_list_load_policy_default = { planThreadListLoadRequest };
//#endregion
//#region frontend/native/thread-list-stable-order.mjs
var DEFAULT_HOLD_MS = 45e3;
function text(value) {
	return String(value || "").trim();
}
function boundedHoldMs(value) {
	const number = Math.trunc(Number(value) || 0);
	if (number <= 0) return DEFAULT_HOLD_MS;
	return Math.min(3e5, Math.max(5e3, number));
}
function threadId(thread) {
	return text(thread && thread.id);
}
function timestampMs$1(value) {
	if (!value) return 0;
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) {
		if (typeof value !== "string") return 0;
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
	}
	return number > 1e11 ? number : number * 1e3;
}
function threadUpdatedAtMs$1(thread) {
	return timestampMs$1(thread && (thread.mobileListUpdatedAtMs || thread.mobile_list_updated_at_ms || thread.listActivityAtMs || thread.list_activity_at_ms || thread.updatedAtMs || thread.updated_at_ms || thread.updatedAt || thread.updated_at || thread.lastActivityAtMs || thread.last_activity_at_ms || thread.lastActivityAt || thread.last_activity_at));
}
function threadUpdatedAtById(threads) {
	const byId = {};
	for (const thread of threads || []) {
		const id = threadId(thread);
		if (!id) continue;
		const updatedAtMs = threadUpdatedAtMs$1(thread);
		if (updatedAtMs > 0) byId[id] = updatedAtMs;
	}
	return byId;
}
function threadListOrderScopeKey(input = {}) {
	const cwd = text(input.selectedCwd);
	const search = text(input.search).toLowerCase();
	return JSON.stringify({
		cwd,
		search
	});
}
function orderedThreadsById(threads, ids) {
	const byId = /* @__PURE__ */ new Map();
	for (const thread of threads || []) {
		const id = threadId(thread);
		if (id && !byId.has(id)) byId.set(id, thread);
	}
	return (ids || []).map((id) => byId.get(id)).filter(Boolean);
}
function mergeHeldOrder(previousOrder, incomingIds) {
	const incomingSet = new Set(incomingIds);
	const rank = new Map(incomingIds.map((id, index) => [id, index]));
	const ordered = (previousOrder || []).filter((id) => incomingSet.has(id));
	const orderedSet = new Set(ordered);
	const additions = incomingIds.filter((id) => !orderedSet.has(id));
	for (const id of additions) {
		const idRank = rank.get(id);
		let insertAt = ordered.length;
		for (let index = 0; index < ordered.length; index += 1) if ((rank.get(ordered[index]) ?? Number.MAX_SAFE_INTEGER) > idRank) {
			insertAt = index;
			break;
		}
		ordered.splice(insertAt, 0, id);
		orderedSet.add(id);
	}
	return ordered;
}
function planThreadListStableOrder(input = {}) {
	const threads = Array.isArray(input.threads) ? input.threads : [];
	const incomingIds = threads.map(threadId).filter(Boolean);
	const incomingUpdatedAtById = threadUpdatedAtById(threads);
	const previous = input.previousState && typeof input.previousState === "object" ? input.previousState : {};
	const previousOrder = Array.isArray(previous.order) ? previous.order.map(text).filter(Boolean) : [];
	const previousUpdatedAtById = previous.updatedAtById && typeof previous.updatedAtById === "object" ? previous.updatedAtById : {};
	const scopeKey = text(input.scopeKey) || threadListOrderScopeKey(input);
	const nowMs = Math.max(0, Math.trunc(Number(input.nowMs) || Date.now()));
	const holdMs = boundedHoldMs(input.holdMs);
	const previousHoldUntilMs = Math.max(0, Math.trunc(Number(previous.holdUntilMs) || 0));
	const sameScope = text(previous.scopeKey) === scopeKey;
	const hasNewerActivity = sameScope && incomingIds.some((id) => {
		const previousUpdatedAtMs = Math.max(0, Math.trunc(Number(previousUpdatedAtById[id]) || 0));
		const incomingUpdatedAtMs = Math.max(0, Math.trunc(Number(incomingUpdatedAtById[id]) || 0));
		return previousUpdatedAtMs > 0 && incomingUpdatedAtMs > previousUpdatedAtMs;
	});
	const canHold = !input.forceServerOrder && sameScope && !hasNewerActivity && previousOrder.length > 0 && previousHoldUntilMs > nowMs;
	const order = canHold ? mergeHeldOrder(previousOrder, incomingIds) : incomingIds;
	const holdUntilMs = canHold ? previousHoldUntilMs : nowMs + holdMs;
	return {
		action: "thread-list-stable-order",
		held: canHold,
		scopeKey,
		holdUntilMs,
		order,
		threads: orderedThreadsById(threads, order),
		state: {
			scopeKey,
			holdUntilMs,
			order,
			updatedAtById: incomingUpdatedAtById
		}
	};
}
var api$5 = {
	DEFAULT_HOLD_MS,
	threadListOrderScopeKey,
	planThreadListStableOrder
};
//#endregion
//#region frontend/native/thread-status-hints.mjs
var DEFAULT_RUNNING_HINT_STALE_MS = 1200 * 1e3;
var DEFAULT_SUBMITTED_PROCESSING_HINT_STALE_MS = 60 * 1e3;
var DEFAULT_STATUS_EVENT_FRESHNESS_TOLERANCE_MS = 1e3;
function timestampMs(value) {
	if (value === null || value === void 0 || value === "") return 0;
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value <= 0) return 0;
		return value > 0xe8d4a51000 ? Math.trunc(value) : Math.trunc(value * 1e3);
	}
	if (/^\d+(?:\.\d+)?$/.test(String(value))) {
		const numeric = Number(value);
		if (Number.isFinite(numeric) && numeric > 0) return numeric > 0xe8d4a51000 ? Math.trunc(numeric) : Math.trunc(numeric * 1e3);
	}
	const parsed = Date.parse(String(value));
	return Number.isFinite(parsed) ? parsed : 0;
}
function statusText$2(status) {
	if (!status) return "";
	if (typeof status === "string") return status;
	if (status && typeof status === "object" && status.type) return String(status.type);
	try {
		return JSON.stringify(status);
	} catch (_) {
		return String(status);
	}
}
function isStaleActiveStatus(status, thread) {
	return Boolean(status && typeof status === "object" && (status.mobileStaleActiveTurn || status.staleActiveTurn || status.reason === "context-only-active-turn") || thread && thread.mobileStaleActiveTurn);
}
function isRunningStatus(status) {
	return /active|running|queued|processing|inprogress|in_progress|in-progress|pending|started/.test(statusText$2(status).toLowerCase());
}
function isSettledStatus(status) {
	return /^(idle|notloaded|not_loaded|not-loaded|completed|complete|done|failed|failure|cancelled|canceled|cancel|error|interrupted|stopped|stop)$/.test(statusText$2(status).toLowerCase());
}
function isIdleStatus(status) {
	return /^(idle|notloaded|not_loaded|not-loaded)$/.test(statusText$2(status).toLowerCase());
}
function isDeployLaneSettledIdle(thread, status) {
	return Boolean(thread && thread.mobileDeployLane && isIdleStatus(status || thread.status));
}
function isTerminalStatus(status) {
	return /^(completed|complete|done|failed|failure|cancelled|canceled|cancel|error|interrupted|stopped|stop)$/.test(statusText$2(status).toLowerCase());
}
function threadUpdatedAtMs(thread) {
	return timestampMs(thread && (thread.mobileListUpdatedAtMs || thread.mobile_list_updated_at_ms || thread.listActivityAtMs || thread.list_activity_at_ms || thread.updatedAtMs || thread.updatedAt || thread.updated_at_ms || thread.updated_at || thread.lastActivityAtMs || thread.lastActivityAt || thread.last_activity_at_ms || thread.last_activity_at));
}
function terminalTurnAtMs(turn) {
	return timestampMs(turn && turn.completedAtMs) || timestampMs(turn && turn.completedAt) || timestampMs(turn && turn.completed_at_ms) || timestampMs(turn && turn.completed_at) || timestampMs(turn && turn.finishedAt) || timestampMs(turn && turn.finished_at) || timestampMs(turn && turn.updatedAtMs) || timestampMs(turn && turn.updatedAt) || timestampMs(turn && turn.updated_at_ms) || timestampMs(turn && turn.updated_at) || timestampMs(turn && turn.startedAtMs) || timestampMs(turn && turn.startedAt) || timestampMs(turn && turn.started_at_ms) || timestampMs(turn && turn.started_at) || timestampMs(turn && turn.createdAtMs) || timestampMs(turn && turn.createdAt) || timestampMs(turn && turn.created_at_ms) || timestampMs(turn && turn.created_at);
}
function notificationDurableEventAtMs(params = {}) {
	return timestampMs(params.eventAtMs) || timestampMs(params.eventAt) || terminalTurnAtMs(params.turn) || timestampMs(params.receivedAtMs) || timestampMs(params.timestampMs) || timestampMs(params.timestamp);
}
function notificationEventAtMs(params = {}, fallbackMs = 0, options = {}) {
	const durableAt = notificationDurableEventAtMs(params);
	if (durableAt) return durableAt;
	if (options.allowReplayReceivedAt !== false) {
		const replayAt = timestampMs(params.mobileReplayReceivedAtMs);
		if (replayAt) return replayAt;
	}
	return timestampMs(params.receivedAtMs) || timestampMs(params.timestampMs) || timestampMs(params.timestamp) || timestampMs(fallbackMs);
}
function latestTerminalTurn(thread) {
	const turns = Array.isArray(thread && thread.turns) ? thread.turns : [];
	const latest = turns.length ? turns[turns.length - 1] : null;
	if (!latest) return null;
	return isTerminalStatus(latest.status) ? latest : null;
}
function latestTerminalTurnAtMs(thread) {
	const turn = latestTerminalTurn(thread);
	return turn ? terminalTurnAtMs(turn) : 0;
}
function hasFreshSubmittedProcessingHint(submittedProcessingHintedAtMs, nowMs, staleMs = DEFAULT_SUBMITTED_PROCESSING_HINT_STALE_MS) {
	const hintedAt = timestampMs(submittedProcessingHintedAtMs);
	const now = timestampMs(nowMs) || Date.now();
	return Boolean(hintedAt > 0 && now - hintedAt <= Math.max(0, Number(staleMs) || 6e4));
}
function statusFreshnessAtMs(thread, eventAtMs) {
	return Math.max(threadUpdatedAtMs(thread) || 0, timestampMs(eventAtMs) || 0);
}
function settledStatusFreshEnoughForRunningHint(input = {}) {
	const hintedAt = timestampMs(input.runningHintedAtMs);
	if (!hintedAt) return true;
	const statusAt = statusFreshnessAtMs(input.thread, input.eventAtMs);
	if (!statusAt) return false;
	if (input.mobileReplay) return statusAt >= hintedAt;
	return statusAt + Math.max(0, Number(input.freshnessToleranceMs) || 1e3) >= hintedAt;
}
function shouldKeepRunningHintForSettledStatus(input = {}) {
	const threadId = String(input.threadId || "");
	if (!threadId || !input.isRunningHinted) return false;
	const status = input.status || input.thread && input.thread.status;
	if (isStaleActiveStatus(status, input.thread)) return false;
	if (!isSettledStatus(status)) return false;
	if (input.currentThreadRefreshing) return true;
	if (isDeployLaneSettledIdle(input.thread, status)) return false;
	const idleWithoutTerminalEvidence = isIdleStatus(status) && !latestTerminalTurn(input.thread) && !input.eventIsTerminal;
	if (input.allowLocalProcessing !== false && idleWithoutTerminalEvidence && hasFreshSubmittedProcessingHint(input.submittedProcessingHintedAtMs, input.nowMs, input.submittedProcessingHintStaleMs)) return true;
	if (idleWithoutTerminalEvidence) return false;
	if (input.currentThreadId && threadId === String(input.currentThreadId) && input.currentThreadSettled) return false;
	if (input.currentThreadHasLiveTurn) return true;
	if (!input.mobileReplay && (isTerminalStatus(status) || latestTerminalTurn(input.thread) || input.eventIsTerminal)) return false;
	return !settledStatusFreshEnoughForRunningHint(input);
}
function threadUnreadTerminalAtMs(thread, eventAtMs = 0, options = {}) {
	const eventAt = options.eventIsTerminal ? timestampMs(eventAtMs) : 0;
	return Math.max(latestTerminalTurnAtMs(thread) || 0, eventAt || 0);
}
function shouldMarkThreadUnread(input = {}) {
	const threadId = String(input.threadId || "");
	if (!threadId || threadId === String(input.currentThreadId || "")) return false;
	const status = input.status || input.thread && input.thread.status;
	if (isStaleActiveStatus(status, input.thread)) return false;
	if (!isSettledStatus(status)) return false;
	if (isIdleStatus(status) && !latestTerminalTurn(input.thread) && !input.eventIsTerminal) return false;
	const terminalAt = threadUnreadTerminalAtMs(input.thread, input.eventAtMs, { eventIsTerminal: Boolean(input.eventIsTerminal) });
	const viewedAt = timestampMs(input.viewedAtMs);
	if (viewedAt > 0) return terminalAt > viewedAt;
	const updateAt = terminalAt || (input.wasRunning ? statusFreshnessAtMs(input.thread, input.eventAtMs) : 0);
	if (input.mobileReplay && !updateAt) return false;
	const hintedAt = timestampMs(input.runningHintedAtMs);
	if (!input.wasRunning || hintedAt <= 0) return false;
	if (!updateAt) return !input.mobileReplay;
	return updateAt + (input.mobileReplay ? 0 : Math.max(0, Number(input.freshnessToleranceMs) || 1e3)) >= hintedAt;
}
function runningHintAgeMs(input = {}) {
	const hintedAt = timestampMs(input.runningHintedAtMs);
	const now = timestampMs(input.nowMs) || Date.now();
	if (hintedAt > 0) return now - hintedAt;
	const updatedAt = threadUpdatedAtMs(input.thread);
	if (updatedAt > 0) return now - updatedAt;
	return (Number(input.runningHintStaleMs) || 12e5) + 1;
}
function shouldExpireRunningThreadHint(input = {}) {
	if (!input.threadId || !input.isRunningHinted) return false;
	const status = input.status || input.thread && input.thread.status;
	if (isStaleActiveStatus(status, input.thread)) return true;
	if (isRunningStatus(status)) return false;
	if (input.currentThreadRefreshing) return false;
	if (isDeployLaneSettledIdle(input.thread, status)) return false;
	if (isSettledStatus(status) && !shouldKeepRunningHintForSettledStatus(input)) return false;
	if (input.currentThreadHasLiveTurn) return false;
	return runningHintAgeMs(input) > (Number(input.runningHintStaleMs) || 12e5);
}
var api$4 = {
	DEFAULT_RUNNING_HINT_STALE_MS,
	DEFAULT_SUBMITTED_PROCESSING_HINT_STALE_MS,
	DEFAULT_STATUS_EVENT_FRESHNESS_TOLERANCE_MS,
	hasFreshSubmittedProcessingHint,
	isDeployLaneSettledIdle,
	isIdleStatus,
	isRunningStatus,
	isSettledStatus,
	isStaleActiveStatus,
	isTerminalStatus,
	latestTerminalTurnAtMs,
	notificationDurableEventAtMs,
	notificationEventAtMs,
	runningHintAgeMs,
	shouldExpireRunningThreadHint,
	shouldKeepRunningHintForSettledStatus,
	shouldMarkThreadUnread,
	statusFreshnessAtMs,
	statusText: statusText$2,
	terminalTurnAtMs,
	threadUpdatedAtMs,
	timestampMs
};
//#endregion
//#region frontend/native/thread-detail-patch-plan.mjs
function normalizePatchEntry(entry) {
	if (!entry || typeof entry !== "object") return null;
	const key = String(entry.key || "");
	if (!key) return null;
	return Object.assign({}, entry, { key });
}
function normalizeRefreshTurnPatchEntry(entry) {
	if (!entry || typeof entry !== "object") return null;
	const key = String(entry.key || "");
	if (!key) return null;
	return {
		key,
		hasPreviousTurn: Boolean(entry.hasPreviousTurn),
		itemPatchable: Boolean(entry.itemPatchable),
		articlePresent: Boolean(entry.articlePresent)
	};
}
function normalizedStringList(value) {
	return Array.isArray(value) ? value.map((entry) => String(entry || "")).filter(Boolean) : [];
}
function signatureText(signature) {
	if (signature == null) return "";
	if (typeof signature === "string") return signature;
	try {
		return JSON.stringify(signature);
	} catch (_) {
		return "";
	}
}
function planThreadDetailDomPatchSurface(input = {}) {
	const threadId = String(input.threadId || "").trim();
	const threadTileMode = Boolean(input.threadTileMode);
	const threadTileSurface = Boolean(input.threadTileSurface);
	const tilePaneVisible = Boolean(input.tilePaneVisible);
	const conversationPresent = Boolean(input.conversationPresent);
	if (threadTileSurface) {
		if (!threadTileMode) return {
			canPatch: false,
			surface: "blocked",
			reason: "tile-surface-without-tile-mode",
			threadId
		};
		if (!threadId) return {
			canPatch: false,
			surface: "thread-tile-pane",
			reason: "missing-thread-id",
			threadId: ""
		};
		if (!tilePaneVisible) return {
			canPatch: false,
			surface: "thread-tile-pane",
			reason: "tile-pane-not-visible",
			threadId
		};
		return {
			canPatch: true,
			surface: "thread-tile-pane",
			reason: "tile-pane-visible",
			threadId
		};
	}
	if (!conversationPresent) return {
		canPatch: false,
		surface: "single-thread",
		reason: "missing-conversation",
		threadId
	};
	return {
		canPatch: true,
		surface: "single-thread",
		reason: "single-thread-surface",
		threadId
	};
}
function planThreadDetailRefreshLocalPatchPreflight(input = {}) {
	const conversationPresent = Boolean(input.conversationPresent);
	const previousThreadPresent = Boolean(input.previousThreadPresent);
	const nextThreadPresent = Boolean(input.nextThreadPresent);
	if (!conversationPresent) return {
		canPatch: false,
		terminal: false,
		reason: "missing-conversation-root"
	};
	if (!previousThreadPresent || !nextThreadPresent) return {
		canPatch: false,
		terminal: false,
		reason: "missing-thread"
	};
	if (String(input.stage || "complete") === "root") return {
		canPatch: true,
		terminal: false,
		reason: "root-ready"
	};
	if (input.tilePanePatched) return {
		canPatch: true,
		terminal: true,
		reason: "tile-pane-patched"
	};
	if (!input.singleThreadSurfaceAvailable) return {
		canPatch: false,
		terminal: false,
		reason: "single-thread-surface-unavailable"
	};
	if (input.previousLoadingOrError || input.nextLoadingOrError) return {
		canPatch: false,
		terminal: false,
		reason: "loading-or-error-state"
	};
	const renderedConversationSignature = signatureText(input.renderedConversationSignature);
	const previousConversationSignature = signatureText(input.previousConversationSignature);
	const renderedPatchShellSignature = signatureText(input.renderedPatchShellSignature);
	const previousPatchShellSignature = signatureText(input.previousPatchShellSignature);
	const nextPatchShellSignature = signatureText(input.nextPatchShellSignature);
	if (renderedConversationSignature !== previousConversationSignature && (!renderedPatchShellSignature || renderedPatchShellSignature !== previousPatchShellSignature)) return {
		canPatch: false,
		terminal: false,
		reason: "rendered-dom-stale"
	};
	if (previousPatchShellSignature !== nextPatchShellSignature) return {
		canPatch: false,
		terminal: false,
		reason: "patch-shell-changed"
	};
	return {
		canPatch: true,
		terminal: false,
		reason: "preflight-passed"
	};
}
function visibleItemPatchShapePreservesExisting(previousEntries, nextEntries) {
	if (!Array.isArray(previousEntries) || !Array.isArray(nextEntries)) return false;
	const previous = previousEntries.map(normalizePatchEntry).filter(Boolean);
	const next = nextEntries.map(normalizePatchEntry).filter(Boolean);
	if (previous.length !== previousEntries.length || next.length !== nextEntries.length) return false;
	if (previous.length > next.length) return false;
	let previousIndex = 0;
	for (const nextEntry of next) {
		const previousEntry = previous[previousIndex];
		if (previousEntry && previousEntry.key === nextEntry.key) previousIndex += 1;
	}
	return previousIndex === previous.length;
}
function patchEntryKind(entry) {
	if (!entry || typeof entry !== "object") return "";
	const signature = entry.signature && typeof entry.signature === "object" ? entry.signature : null;
	const item = entry.item && typeof entry.item === "object" ? entry.item : null;
	return String(signature && signature.type || item && item.type || entry.type || "");
}
function visibleUserMessagePatchKeysPreserved(previousEntries, nextEntries) {
	if (!Array.isArray(previousEntries) || !Array.isArray(nextEntries)) return false;
	const previous = previousEntries.map(normalizePatchEntry).filter(Boolean);
	const next = nextEntries.map(normalizePatchEntry).filter(Boolean);
	if (previous.length !== previousEntries.length || next.length !== nextEntries.length) return false;
	const previousKeys = previous.filter((entry) => patchEntryKind(entry) === "userMessage").map((entry) => entry.key);
	const nextKeys = next.filter((entry) => patchEntryKind(entry) === "userMessage").map((entry) => entry.key);
	if (previousKeys.length !== nextKeys.length) return false;
	return previousKeys.every((key, index) => key === nextKeys[index]);
}
function planVisibleItemRefreshPatch(previousEntries, nextEntries) {
	if (!visibleItemPatchShapePreservesExisting(previousEntries, nextEntries)) return {
		canPatch: false,
		reason: "shape-changed",
		operations: []
	};
	if (!visibleUserMessagePatchKeysPreserved(previousEntries, nextEntries)) return {
		canPatch: false,
		reason: "user-message-shape-changed",
		operations: []
	};
	const previousByKey = new Map(previousEntries.map(normalizePatchEntry).filter(Boolean).map((entry) => [entry.key, entry]));
	const operations = [];
	for (const rawNextEntry of nextEntries) {
		const nextEntry = normalizePatchEntry(rawNextEntry);
		if (!nextEntry) return {
			canPatch: false,
			reason: "invalid-entry",
			operations: []
		};
		const previousEntry = previousByKey.get(nextEntry.key);
		if (!previousEntry) {
			operations.push({
				type: "insert",
				key: nextEntry.key,
				nextEntry
			});
			continue;
		}
		const previousSignature = signatureText(previousEntry.signature);
		const nextSignature = signatureText(nextEntry.signature);
		operations.push({
			type: previousSignature === nextSignature ? "reuse" : "patch",
			key: nextEntry.key,
			previousEntry,
			nextEntry
		});
	}
	return {
		canPatch: true,
		reason: "shape-preserved",
		operations
	};
}
function planThreadDetailRefreshDomPatch(entries, options = {}) {
	if (!Array.isArray(entries)) return {
		canPatch: false,
		reason: "invalid-turn-entries",
		operations: []
	};
	const operations = [];
	const nextKeys = /* @__PURE__ */ new Set();
	for (const rawEntry of entries) {
		const entry = normalizeRefreshTurnPatchEntry(rawEntry);
		if (!entry) return {
			canPatch: false,
			reason: "invalid-turn-entry",
			operations: []
		};
		nextKeys.add(entry.key);
		if (entry.hasPreviousTurn && entry.itemPatchable && entry.articlePresent) {
			operations.push({
				type: "item-patch",
				key: entry.key,
				entry
			});
			continue;
		}
		operations.push({
			type: entry.articlePresent ? "replace-turn" : "insert-turn",
			key: entry.key,
			entry
		});
	}
	const previousTurnKeys = normalizedStringList(options.previousTurnKeys || options.previousKeys);
	for (const previousKey of previousTurnKeys) {
		if (nextKeys.has(previousKey)) continue;
		operations.push({
			type: "remove-turn",
			key: previousKey,
			entry: {
				key: previousKey,
				stale: true
			}
		});
	}
	return {
		canPatch: true,
		reason: "planned",
		operations
	};
}
var api$3 = {
	normalizePatchEntry,
	normalizeRefreshTurnPatchEntry,
	planThreadDetailRefreshDomPatch,
	planThreadDetailRefreshLocalPatchPreflight,
	planVisibleItemRefreshPatch,
	planThreadDetailDomPatchSurface,
	visibleItemPatchShapePreservesExisting,
	visibleUserMessagePatchKeysPreserved
};
//#endregion
//#region frontend/native/thread-detail-actions.mjs
function withinRoot(root, node) {
	if (!root || !node || typeof root.contains !== "function") return true;
	return root.contains(node);
}
function closestWithin(target, selector, root = null) {
	if (!target || typeof target.closest !== "function") return null;
	const node = target.closest(selector);
	if (!node || !withinRoot(root, node)) return null;
	return node;
}
function action(type, target, fields = {}) {
	return Object.assign({
		action: String(type || "none"),
		target: target || null,
		preventDefault: false,
		stopPropagation: false
	}, fields);
}
function dataValue(node, key) {
	return String(node && node.dataset && node.dataset[key] || "");
}
function contextThreadIdFromNode(node, explicitDatasetKey = "") {
	if (!node) return "";
	const explicit = explicitDatasetKey ? dataValue(node, explicitDatasetKey) : "";
	if (explicit) return explicit;
	if (typeof node.closest !== "function") return "";
	return dataValue(node.closest("[data-thread-tile-pane]"), "threadTilePane");
}
function previewableImageFromTarget(target, root = null) {
	const image = closestWithin(target, ".input-image img, .image-view img, .markdown-image img, .file-preview-image, .attachment-thumb", root);
	if (!image) return null;
	if (image.closest && image.closest(".github-link-card")) return null;
	return image;
}
function resolveRichContentClickAction(input = {}) {
	const target = input.target || null;
	const root = input.root || null;
	let node = closestWithin(target, "[data-copy-key]", root);
	if (node) return action("copy", node, {
		button: node,
		preventDefault: true,
		stopPropagation: true
	});
	node = closestWithin(target, "[data-local-file-path]", root);
	if (node) return action("local-file-preview", node, {
		link: node,
		threadId: contextThreadIdFromNode(node, "localFileThreadId"),
		preventDefault: true,
		stopPropagation: true
	});
	node = closestWithin(target, "[data-mermaid-action]", root);
	if (node) return action("mermaid", node, {
		button: node,
		preventDefault: true,
		stopPropagation: true
	});
	node = closestWithin(target, "[data-github-link-preview-expand]", root);
	if (node) return action("github-preview-toggle", node, {
		button: node,
		preventDefault: true,
		stopPropagation: true
	});
	return action("none", null, { reason: "no-match" });
}
function resolveThreadDetailClickAction(input = {}) {
	const target = input.target || null;
	const root = input.root || null;
	const rich = resolveRichContentClickAction({
		target,
		root
	});
	if (rich.action !== "none") return rich;
	let node = closestWithin(target, "[data-approval-action]", root);
	if (node) return action("approval-answer", node, {
		button: node,
		approvalId: dataValue(node, "approvalId"),
		approvalAction: dataValue(node, "approvalAction"),
		threadId: dataValue(node, "approvalThreadId")
	});
	node = closestWithin(target, "[data-task-card-action]", root);
	if (node) {
		const taskCardAction = dataValue(node, "taskCardAction");
		const cardId = dataValue(node, "taskCardId");
		const threadId = dataValue(node, "taskCardThreadId");
		if (taskCardAction === "reply") return action("task-card-reply", node, {
			button: node,
			cardId,
			taskCardAction,
			threadId
		});
		if (taskCardAction === "approve" || taskCardAction === "delete" || taskCardAction === "revoke") return action("task-card-mutate", node, {
			button: node,
			cardId,
			taskCardAction,
			threadId
		});
		return action("task-card-unknown", node, {
			button: node,
			cardId,
			taskCardAction,
			threadId
		});
	}
	node = closestWithin(target, "[data-task-card-draft-action]", root);
	if (node) return action("task-card-draft", node, {
		button: node,
		draftAction: dataValue(node, "taskCardDraftAction"),
		draftKey: dataValue(node, "taskCardDraftKey"),
		threadId: dataValue(node, "taskCardDraftThreadId")
	});
	node = closestWithin(target, "[data-server-response-text]", root);
	if (node) return action("server-response", node, {
		option: node,
		requestId: dataValue(node, "serverRequestId"),
		threadId: dataValue(node, "serverRequestThreadId"),
		responseText: dataValue(node, "serverResponseText"),
		questionId: dataValue(node, "serverQuestionId") || "answer"
	});
	node = closestWithin(target, "[data-server-request-decline]", root);
	if (node) return action("server-request-decline", node, {
		button: node,
		requestId: dataValue(node, "serverRequestId"),
		threadId: dataValue(node, "serverRequestThreadId")
	});
	return action("none", null, { reason: "no-match" });
}
var api$2 = {
	closestWithin,
	previewableImageFromTarget,
	resolveRichContentClickAction,
	resolveThreadDetailClickAction,
	contextThreadIdFromNode
};
//#endregion
//#region frontend/native/thread-detail-merge-state.mjs
function defaultNormalizeThread$1(thread) {
	return thread;
}
function defaultSortTurns$1(turns) {
	return Array.isArray(turns) ? turns.slice() : [];
}
function createThreadDetailMergePolicy(options = {}) {
	const isV4ProjectionThread = typeof options.isV4ProjectionThread === "function" ? options.isV4ProjectionThread : () => false;
	const mergeV4ProjectionThread = typeof options.mergeV4ProjectionThread === "function" ? options.mergeV4ProjectionThread : (existingThread, incomingThread) => incomingThread || existingThread || null;
	const normalizeThreadVisibleUserMessages = typeof options.normalizeThreadVisibleUserMessages === "function" ? options.normalizeThreadVisibleUserMessages : defaultNormalizeThread$1;
	const turnVisibleWeight = typeof options.turnVisibleWeight === "function" ? options.turnVisibleWeight : () => 0;
	const shouldPreserveExistingTurnVisibleItems = typeof options.shouldPreserveExistingTurnVisibleItems === "function" ? options.shouldPreserveExistingTurnVisibleItems : () => false;
	const mergeItemsPreservingLocalVisible = typeof options.mergeItemsPreservingLocalVisible === "function" ? options.mergeItemsPreservingLocalVisible : (existingItems, incomingItems) => Array.isArray(incomingItems) ? incomingItems : existingItems;
	const shouldDropInitialSubmissionEchoTurn = typeof options.shouldDropInitialSubmissionEchoTurn === "function" ? options.shouldDropInitialSubmissionEchoTurn : () => false;
	const turnIsSupersededBy = typeof options.turnIsSupersededBy === "function" ? options.turnIsSupersededBy : () => false;
	const isTurnComplete = typeof options.isTurnComplete === "function" ? options.isTurnComplete : () => false;
	const shouldPreserveMissingExistingTurn = typeof options.shouldPreserveMissingExistingTurn === "function" ? options.shouldPreserveMissingExistingTurn : () => false;
	const sortTurnsForDisplay = typeof options.sortTurnsForDisplay === "function" ? options.sortTurnsForDisplay : defaultSortTurns$1;
	const threadHasInitialSubmissionEcho = typeof options.threadHasInitialSubmissionEcho === "function" ? options.threadHasInitialSubmissionEcho : () => false;
	const maxExpandedVisibleTurns = Math.max(1, Number(options.maxExpandedVisibleTurns || 200) || 200);
	function normalizeMergedThread(thread, limit = 0) {
		const normalized = normalizeThreadVisibleUserMessages(thread);
		if (normalized && Array.isArray(normalized.turns)) {
			const sorted = sortTurnsForDisplay(normalized.turns);
			normalized.turns = limit > 0 ? sorted.slice(-limit) : sorted;
		}
		return normalized;
	}
	function shouldPreserveLiveTurnLocalVisibleItems(existingTurn, incomingTurn, existingWeight = null) {
		return shouldPreserveExistingTurnVisibleItems(existingTurn, incomingTurn, existingWeight);
	}
	function mergeTurnPreservingVisibleItems(existingTurn, incomingTurn) {
		if (!existingTurn) return incomingTurn;
		if (!incomingTurn) return existingTurn;
		const existingItems = Array.isArray(existingTurn.items) ? existingTurn.items : [];
		const incomingHasItems = Array.isArray(incomingTurn.items);
		const merged = Object.assign({}, existingTurn, incomingTurn);
		if (!incomingHasItems) {
			merged.items = existingItems;
			return merged;
		}
		const incomingWeight = turnVisibleWeight(Object.assign({}, incomingTurn, { items: incomingTurn.items || [] }));
		const existingWeight = turnVisibleWeight(existingTurn);
		const preserveLocalVisible = incomingWeight < existingWeight || shouldPreserveLiveTurnLocalVisibleItems(existingTurn, incomingTurn, existingWeight);
		merged.items = mergeItemsPreservingLocalVisible(existingItems, incomingTurn.items || [], preserveLocalVisible, incomingTurn);
		return merged;
	}
	function mergeThreadPreservingVisibleItems(existingThread, incomingThread, runtime = {}) {
		if (isV4ProjectionThread(incomingThread)) return mergeV4ProjectionThread(existingThread, incomingThread);
		if (!existingThread || !incomingThread || existingThread.id !== incomingThread.id) return normalizeMergedThread(incomingThread);
		const existingTurns = Array.isArray(existingThread.turns) ? existingThread.turns : [];
		const incomingTurns = Array.isArray(incomingThread.turns) ? incomingThread.turns : null;
		const existingById = new Map(existingTurns.map((turn) => [turn && turn.id, turn]).filter(([id]) => id));
		const initialSubmissionId = String(existingThread.mobileInitialSubmissionId || "");
		const merged = Object.assign({}, existingThread, incomingThread);
		if (!Object.prototype.hasOwnProperty.call(incomingThread, "mobileLoading")) delete merged.mobileLoading;
		if (!Object.prototype.hasOwnProperty.call(incomingThread, "mobileLoadError")) delete merged.mobileLoadError;
		if (!Object.prototype.hasOwnProperty.call(incomingThread, "mobileReadWarning")) delete merged.mobileReadWarning;
		if (!incomingTurns) return normalizeMergedThread(merged);
		const existingVisibleWeight = existingTurns.reduce((total, turn) => total + turnVisibleWeight(turn), 0);
		const incomingVisibleWeight = incomingTurns.reduce((total, turn) => total + turnVisibleWeight(turn), 0);
		const incomingHasAuthoritativeVisibleWindow = incomingTurns.length > 0 && incomingVisibleWeight > 0;
		if (!incomingTurns.length && existingTurns.length && existingVisibleWeight > 0 && incomingVisibleWeight === 0) {
			merged.turns = existingTurns;
			return normalizeMergedThread(merged);
		}
		merged.turns = incomingTurns.map((incomingTurn) => {
			const existingTurn = existingById.get(incomingTurn && incomingTurn.id);
			return existingTurn ? mergeTurnPreservingVisibleItems(existingTurn, incomingTurn) : incomingTurn;
		});
		merged.turns = sortTurnsForDisplay(merged.turns);
		const incomingIds = new Set(merged.turns.map((turn) => turn && turn.id).filter(Boolean));
		const latestIncoming = merged.turns.length ? merged.turns[merged.turns.length - 1] : null;
		const preserveExpandedHistory = Boolean(existingThread.mobileHistoryExpanded) && (/turns-list/i.test(String(incomingThread.mobileReadMode || "")) || Boolean(incomingThread.mobileOlderTurnsCursor) || Number(incomingThread.mobileOmittedTurnCount || 0) > 0);
		let preservedExpandedTurnCount = 0;
		const activeTurnId = String(runtime.activeTurnId || "");
		for (const existingTurn of existingTurns) {
			if (!existingTurn || incomingIds.has(existingTurn.id)) continue;
			if (shouldDropInitialSubmissionEchoTurn(existingTurn, merged.turns, initialSubmissionId)) continue;
			if (preserveExpandedHistory) {
				merged.turns.push(existingTurn);
				preservedExpandedTurnCount += 1;
				continue;
			}
			if (incomingHasAuthoritativeVisibleWindow && !shouldPreserveMissingExistingTurn(existingTurn, merged, runtime)) continue;
			if (turnIsSupersededBy(existingTurn, latestIncoming)) continue;
			if (String(existingTurn.id || "") === activeTurnId || !isTurnComplete(existingTurn) && turnVisibleWeight(existingTurn) > 0) merged.turns.push(existingTurn);
		}
		if (preserveExpandedHistory) {
			merged.mobileHistoryExpanded = true;
			if (preservedExpandedTurnCount > 0) merged.mobileOmittedTurnCount = Math.max(0, Number(merged.mobileOmittedTurnCount || 0) - preservedExpandedTurnCount);
		}
		const normalized = normalizeMergedThread(merged, preserveExpandedHistory ? maxExpandedVisibleTurns : 0);
		if (!threadHasInitialSubmissionEcho(normalized, initialSubmissionId)) delete normalized.mobileInitialSubmissionId;
		return normalized;
	}
	return {
		mergeThreadPreservingVisibleItems,
		mergeTurnPreservingVisibleItems,
		shouldPreserveLiveTurnLocalVisibleItems
	};
}
var api$1 = { createThreadDetailMergePolicy };
//#endregion
//#region frontend/native/thread-detail-v4-merge-state.mjs
function defaultNormalizeThread(thread) {
	return thread;
}
function defaultTurnVisibleWeight(turn) {
	return Array.isArray(turn && turn.items) ? turn.items.length : 0;
}
function defaultSortTurns(turns) {
	return Array.isArray(turns) ? turns.slice() : [];
}
function statusText$1(status) {
	if (!status) return "";
	if (typeof status === "object" && status.type) return String(status.type || "");
	return String(status || "");
}
function createThreadDetailV4MergePolicy(options = {}) {
	const normalizeThreadVisibleUserMessages = typeof options.normalizeThreadVisibleUserMessages === "function" ? options.normalizeThreadVisibleUserMessages : defaultNormalizeThread;
	const turnVisibleWeight = typeof options.turnVisibleWeight === "function" ? options.turnVisibleWeight : defaultTurnVisibleWeight;
	const isOptimisticUserMessage = typeof options.isOptimisticUserMessage === "function" ? options.isOptimisticUserMessage : () => false;
	const isRecentlySubmittedUserMessage = typeof options.isRecentlySubmittedUserMessage === "function" ? options.isRecentlySubmittedUserMessage : () => false;
	const isReasoningItem = typeof options.isReasoningItem === "function" ? options.isReasoningItem : () => false;
	const userMessageHasSubmissionId = typeof options.userMessageHasSubmissionId === "function" ? options.userMessageHasSubmissionId : (item, submissionId) => Boolean(item && submissionId && String(item.clientSubmissionId || "") === String(submissionId || ""));
	const userMessagesCanShadow = typeof options.userMessagesCanShadow === "function" ? options.userMessagesCanShadow : () => false;
	const durableUserMessageSettlesPendingEcho = typeof options.durableUserMessageSettlesPendingEcho === "function" ? options.durableUserMessageSettlesPendingEcho : () => false;
	const isTurnComplete = typeof options.isTurnComplete === "function" ? options.isTurnComplete : (turn) => /completed|failed|cancel|error|interrupted/i.test(statusText$1(turn && turn.status));
	const isRunningStatus = typeof options.isRunningStatus === "function" ? options.isRunningStatus : (status) => /active|running|queued|processing|inprogress|in_progress|in-progress|pending|started/i.test(statusText$1(status));
	const isIncompleteInterruptedTurn = typeof options.isIncompleteInterruptedTurn === "function" ? options.isIncompleteInterruptedTurn : () => false;
	const turnHasActiveLiveItems = typeof options.turnHasActiveLiveItems === "function" ? options.turnHasActiveLiveItems : () => false;
	const turnOrderMs = typeof options.turnOrderMs === "function" ? options.turnOrderMs : () => 0;
	const mergeTurnPreservingVisibleItems = typeof options.mergeTurnPreservingVisibleItems === "function" ? options.mergeTurnPreservingVisibleItems : (existingTurn, incomingTurn) => incomingTurn || existingTurn;
	const sortTurnsForDisplay = typeof options.sortTurnsForDisplay === "function" ? options.sortTurnsForDisplay : defaultSortTurns;
	const maxVisibleTurnsForThread = typeof options.maxVisibleTurnsForThread === "function" ? options.maxVisibleTurnsForThread : () => 10;
	function isV4ProjectionThread(thread) {
		return Boolean(thread && (thread.mobileProjectionVersion === "v4" || thread.mobileProjection && thread.mobileProjection.version === "v4"));
	}
	function shouldPreserveV4PendingOverlayItem(item) {
		return Boolean(item && item.type === "userMessage" && isOptimisticUserMessage(item) && (isRecentlySubmittedUserMessage(item) || item.mobileSendError));
	}
	function v4ThreadHasPendingMatch(thread, pendingItem) {
		if (!pendingItem || pendingItem.type !== "userMessage") return false;
		const submissionId = String(pendingItem.clientSubmissionId || "").trim();
		for (const turn of Array.isArray(thread && thread.turns) ? thread.turns : []) for (const item of Array.isArray(turn && turn.items) ? turn.items : []) {
			if (!item || item.type !== "userMessage") continue;
			if (submissionId && userMessageHasSubmissionId(item, submissionId)) return true;
			if (!isOptimisticUserMessage(item) && durableUserMessageSettlesPendingEcho(item, pendingItem, turn)) return true;
		}
		return false;
	}
	function v4ThreadHasDurableSubmissionMatch(thread, pendingItem) {
		if (!pendingItem || pendingItem.type !== "userMessage") return false;
		const submissionId = String(pendingItem.clientSubmissionId || "").trim();
		for (const turn of Array.isArray(thread && thread.turns) ? thread.turns : []) for (const item of Array.isArray(turn && turn.items) ? turn.items : []) {
			if (!item || item.type !== "userMessage") continue;
			if (isOptimisticUserMessage(item)) continue;
			if (submissionId && userMessageHasSubmissionId(item, submissionId)) return true;
			if (durableUserMessageSettlesPendingEcho(item, pendingItem, turn)) return true;
		}
		return false;
	}
	function dropSyntheticSubmissionEchoes(thread, pendingItem) {
		if (!thread || !pendingItem || !Array.isArray(thread.turns)) return false;
		const submissionId = String(pendingItem.clientSubmissionId || "").trim();
		if (!submissionId) return false;
		let changed = false;
		for (const turn of thread.turns) {
			if (!turn || !Array.isArray(turn.items)) continue;
			const nextItems = turn.items.filter((item) => !(item && item.type === "userMessage" && isOptimisticUserMessage(item) && userMessageHasSubmissionId(item, submissionId)));
			if (nextItems.length !== turn.items.length) {
				turn.items = nextItems;
				changed = true;
			}
		}
		return changed;
	}
	function timestampMsFromValue(value) {
		if (value === void 0 || value === null || value === "") return 0;
		const number = Number(value);
		if (Number.isFinite(number) && number > 0) return number > 1e9 && number < 0xe8d4a51000 ? Math.trunc(number * 1e3) : Math.trunc(number);
		const parsed = Date.parse(String(value || ""));
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
	}
	function itemOrderMs(item) {
		if (!item || typeof item !== "object") return 0;
		for (const field of [
			"mobileDisplayTimestampMs",
			"startedAtMs",
			"createdAtMs",
			"updatedAtMs",
			"timestampMs",
			"mobileDisplayTimestamp",
			"startedAt",
			"createdAt",
			"updatedAt",
			"timestamp"
		]) {
			const value = timestampMsFromValue(item[field]);
			if (value > 0) return value;
		}
		return 0;
	}
	function appendV4PendingOverlayItem(turn, item) {
		if (!turn || !item) return;
		turn.items = Array.isArray(turn.items) ? turn.items : [];
		const submissionId = String(item.clientSubmissionId || "").trim();
		if (turn.items.some((existing) => existing && (submissionId && userMessageHasSubmissionId(existing, submissionId) || existing.id === item.id || userMessagesCanShadow(existing, item)))) return;
		const pendingOrder = itemOrderMs(item);
		const insertAt = pendingOrder > 0 ? turn.items.findIndex((existing) => {
			const existingOrder = itemOrderMs(existing);
			return existingOrder > 0 && existingOrder > pendingOrder;
		}) : -1;
		if (insertAt < 0) turn.items.push(item);
		else turn.items.splice(insertAt, 0, item);
	}
	function copyTurnWithOnlyItems(turn, items) {
		return Object.assign({}, turn || {}, { items: (items || []).slice() });
	}
	function visibleNonReasoningItems(turn) {
		return (Array.isArray(turn && turn.items) ? turn.items : []).filter((item) => item && turnVisibleWeight({ items: [item] }) > 0 && !isReasoningItem(item));
	}
	function existingV4TurnHasOnlyPendingOverlayItems(existingTurn) {
		const visibleItems = visibleNonReasoningItems(existingTurn);
		return Boolean(visibleItems.length && visibleItems.every(shouldPreserveV4PendingOverlayItem));
	}
	function turnHasNonUserAuthority(turn) {
		return visibleNonReasoningItems(turn).some((item) => item && item.type !== "userMessage");
	}
	function incomingTurnsHaveNewerNonUserAuthority(existingTurn, incomingTurns = []) {
		const existingOrder = turnOrderMs(existingTurn);
		if (!existingOrder) return false;
		return (incomingTurns || []).some((incomingTurn) => {
			if (!incomingTurn || String(incomingTurn.id || "") === String(existingTurn && existingTurn.id || "")) return false;
			if (!turnHasNonUserAuthority(incomingTurn)) return false;
			const incomingOrder = turnOrderMs(incomingTurn);
			return Boolean(incomingOrder && incomingOrder > existingOrder);
		});
	}
	function applyV4PendingOverlay(existingThread, mergedThread) {
		if (!existingThread || !mergedThread || !Array.isArray(existingThread.turns)) return mergedThread;
		mergedThread.turns = Array.isArray(mergedThread.turns) ? mergedThread.turns : [];
		const turnsById = new Map(mergedThread.turns.map((turn) => [String(turn && turn.id || ""), turn]));
		for (const existingTurn of existingThread.turns) {
			const pendingItems = (Array.isArray(existingTurn && existingTurn.items) ? existingTurn.items : []).filter((item) => shouldPreserveV4PendingOverlayItem(item) && !v4ThreadHasPendingMatch(mergedThread, item));
			if (!pendingItems.length) continue;
			const unresolvedPendingItems = pendingItems.filter((item) => {
				if (!v4ThreadHasDurableSubmissionMatch(mergedThread, item)) return true;
				dropSyntheticSubmissionEchoes(mergedThread, item);
				return false;
			});
			if (!unresolvedPendingItems.length) continue;
			const targetTurn = turnsById.get(String(existingTurn.id || ""));
			if (targetTurn) {
				unresolvedPendingItems.forEach((item) => appendV4PendingOverlayItem(targetTurn, item));
				continue;
			}
			if (existingV4TurnHasOnlyPendingOverlayItems(existingTurn) && incomingTurnsHaveNewerNonUserAuthority(existingTurn, mergedThread.turns)) continue;
			const overlayTurn = copyTurnWithOnlyItems(existingTurn, unresolvedPendingItems);
			overlayTurn.mobilePendingOverlay = true;
			mergedThread.turns.push(overlayTurn);
			if (overlayTurn.id) turnsById.set(String(overlayTurn.id), overlayTurn);
		}
		return mergedThread;
	}
	function v4ProjectionRevisionValue(thread) {
		const direct = Number(thread && thread.mobileProjectionRevision);
		if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);
		const nested = Number(thread && thread.mobileProjection && thread.mobileProjection.revision);
		return Number.isFinite(nested) && nested > 0 ? Math.trunc(nested) : 0;
	}
	function isV4ProjectionRefreshRegressive(existingThread, incomingThread) {
		const existingRevision = v4ProjectionRevisionValue(existingThread);
		const incomingRevision = v4ProjectionRevisionValue(incomingThread);
		return Boolean(existingRevision && incomingRevision && incomingRevision < existingRevision);
	}
	function threadVisibleWeight(turns = []) {
		return (Array.isArray(turns) ? turns : []).reduce((total, turn) => total + turnVisibleWeight(turn), 0);
	}
	function incomingTurnsHaveNewerVisibleEvidence(existingTurns = [], incomingTurns = []) {
		const existingIds = new Set((existingTurns || []).map((turn) => String(turn && turn.id || "")).filter(Boolean));
		const existingMaxOrder = (existingTurns || []).reduce((max, turn) => Math.max(max, turnOrderMs(turn) || 0), 0);
		return (incomingTurns || []).some((turn) => {
			const id = String(turn && turn.id || "");
			if (id && existingIds.has(id)) return false;
			if (turnVisibleWeight(turn) <= 0) return false;
			const order = turnOrderMs(turn);
			return Boolean(order && existingMaxOrder && order > existingMaxOrder);
		});
	}
	function isV4ProjectionVisibleWindowRegressive(existingThread, incomingThread) {
		const existingTurns = Array.isArray(existingThread && existingThread.turns) ? existingThread.turns : [];
		const incomingTurns = Array.isArray(incomingThread && incomingThread.turns) ? incomingThread.turns : [];
		if (!existingTurns.length || !incomingTurns.length) return false;
		if (Math.min(existingTurns.length, incomingTurns.length) < 3) return false;
		if (existingTurns.some(isActiveLikeProjectionTurn) || incomingTurns.some(isActiveLikeProjectionTurn)) return false;
		if (incomingTurnsHaveNewerVisibleEvidence(existingTurns, incomingTurns)) return false;
		const existingWeight = threadVisibleWeight(existingTurns);
		const incomingWeight = threadVisibleWeight(incomingTurns);
		if (existingWeight <= 0 || incomingWeight <= 0 || incomingWeight >= existingWeight) return false;
		return incomingWeight < Math.max(1, Math.floor(existingWeight * .55));
	}
	function isActiveLikeProjectionTurn(turn) {
		return Boolean(turn && !isTurnComplete(turn) && (isRunningStatus(turn.status) || isIncompleteInterruptedTurn(turn) || turnHasActiveLiveItems(turn)));
	}
	function incomingTurnsClearlySupersedeExistingTurn(existingTurn, incomingTurns) {
		const existingOrder = turnOrderMs(existingTurn);
		if (!existingOrder) return false;
		return (incomingTurns || []).some((incomingTurn) => {
			if (!incomingTurn || String(incomingTurn.id || "") === String(existingTurn && existingTurn.id || "")) return false;
			const incomingOrder = turnOrderMs(incomingTurn);
			return Boolean(incomingOrder && incomingOrder > existingOrder);
		});
	}
	function incomingThreadIsPartialActiveRefresh(incomingThread, incomingTurns = []) {
		if (!incomingThread) return false;
		const readMode = String(incomingThread.mobileReadMode || "");
		const projection = incomingThread.mobileProjection && typeof incomingThread.mobileProjection === "object" ? incomingThread.mobileProjection : {};
		const partialLike = /projection-v4-partial/i.test(readMode) || projection.partial === true || /partial/i.test(String(projection.source || ""));
		return Boolean(partialLike && (incomingTurns || []).some(isActiveLikeProjectionTurn));
	}
	function incomingTurnsHaveNewerCompletedVisibleTurn(existingTurn, incomingTurns = []) {
		const existingOrder = turnOrderMs(existingTurn);
		if (!existingOrder) return false;
		return (incomingTurns || []).some((incomingTurn) => {
			if (!incomingTurn || String(incomingTurn.id || "") === String(existingTurn && existingTurn.id || "")) return false;
			if (!isTurnComplete(incomingTurn) || turnVisibleWeight(incomingTurn) <= 0) return false;
			const incomingOrder = turnOrderMs(incomingTurn);
			return Boolean(incomingOrder && incomingOrder > existingOrder);
		});
	}
	function existingV4TurnHasOnlyMatchedPendingItems(existingTurn, incomingTurns) {
		const visibleItems = (Array.isArray(existingTurn && existingTurn.items) ? existingTurn.items : []).filter((item) => item && turnVisibleWeight({ items: [item] }) > 0 && !isReasoningItem(item));
		return Boolean(visibleItems.length && visibleItems.every((item) => shouldPreserveV4PendingOverlayItem(item) && v4ThreadHasPendingMatch({ turns: incomingTurns || [] }, item)));
	}
	function shouldPreserveExistingV4ProjectionTurn(existingThread, incomingThread, existingTurn, incomingTurns) {
		if (!existingTurn || turnVisibleWeight(existingTurn) <= 0) return false;
		const id = String(existingTurn.id || "");
		if (id && (incomingTurns || []).some((turn) => String(turn && turn.id || "") === id)) return false;
		if (existingV4TurnHasOnlyMatchedPendingItems(existingTurn, incomingTurns)) return false;
		const activeLike = isActiveLikeProjectionTurn(existingTurn);
		const regressiveRefresh = isV4ProjectionRefreshRegressive(existingThread, incomingThread);
		if (!activeLike && !regressiveRefresh && isTurnComplete(existingTurn) && incomingThreadIsPartialActiveRefresh(incomingThread, incomingTurns) && !incomingTurnsHaveNewerCompletedVisibleTurn(existingTurn, incomingTurns)) return true;
		if (!activeLike && !regressiveRefresh) return false;
		return !incomingTurnsClearlySupersedeExistingTurn(existingTurn, incomingTurns);
	}
	function mergeV4ProjectionThread(existingThread, incomingThread) {
		if (!existingThread || !incomingThread || existingThread.id !== incomingThread.id) return normalizeThreadVisibleUserMessages(incomingThread);
		const merged = Object.assign({}, existingThread, incomingThread);
		if (!Object.prototype.hasOwnProperty.call(incomingThread, "mobileLoading")) delete merged.mobileLoading;
		if (!Object.prototype.hasOwnProperty.call(incomingThread, "mobileLoadError")) delete merged.mobileLoadError;
		if (!Object.prototype.hasOwnProperty.call(incomingThread, "mobileReadWarning")) delete merged.mobileReadWarning;
		if (Array.isArray(incomingThread.turns)) {
			const existingTurns = Array.isArray(existingThread.turns) ? existingThread.turns : [];
			const incomingTurns = incomingThread.turns.slice();
			const existingVisibleWeight = existingTurns.reduce((total, turn) => total + turnVisibleWeight(turn), 0);
			const incomingVisibleWeight = incomingTurns.reduce((total, turn) => total + turnVisibleWeight(turn), 0);
			if (!incomingTurns.length && existingTurns.length && existingVisibleWeight > 0 && incomingVisibleWeight === 0) {
				merged.turns = existingTurns;
				return normalizeThreadVisibleUserMessages(merged);
			}
			if (isV4ProjectionVisibleWindowRegressive(existingThread, incomingThread)) {
				merged.turns = existingTurns;
				return normalizeThreadVisibleUserMessages(merged);
			}
			const existingById = new Map(existingTurns.map((turn) => [String(turn && turn.id || ""), turn]));
			merged.turns = incomingTurns.map((incomingTurn) => {
				const existingTurn = existingById.get(String(incomingTurn && incomingTurn.id || ""));
				return existingTurn ? mergeTurnPreservingVisibleItems(existingTurn, incomingTurn) : incomingTurn;
			});
			for (const existingTurn of existingTurns) if (shouldPreserveExistingV4ProjectionTurn(existingThread, incomingThread, existingTurn, merged.turns)) merged.turns.push(existingTurn);
			applyV4PendingOverlay(existingThread, merged);
			merged.turns = sortTurnsForDisplay(merged.turns).slice(-maxVisibleTurnsForThread(merged));
		}
		if (isV4ProjectionRefreshRegressive(existingThread, incomingThread)) {
			const existingRevision = v4ProjectionRevisionValue(existingThread);
			if (existingRevision) {
				merged.mobileProjectionRevision = existingRevision;
				if (merged.mobileProjection && typeof merged.mobileProjection === "object") merged.mobileProjection = Object.assign({}, merged.mobileProjection, { revision: existingRevision });
			}
		}
		return normalizeThreadVisibleUserMessages(merged);
	}
	return {
		applyV4PendingOverlay,
		isV4ProjectionRefreshRegressive,
		isV4ProjectionVisibleWindowRegressive,
		isV4ProjectionThread,
		mergeV4ProjectionThread,
		shouldPreserveExistingV4ProjectionTurn,
		threadVisibleWeight,
		v4ProjectionRevisionValue
	};
}
var api = { createThreadDetailV4MergePolicy };
//#endregion
//#region frontend/native/thread-detail-runtime.mjs
function noopString() {
	return "";
}
function noopFalse() {
	return false;
}
function identityArray(value) {
	return Array.isArray(value) ? value : [];
}
function createThreadDetailRuntime(deps = {}) {
	const { state = {}, MAX_EXPANDED_VISIBLE_TURNS = 200, MAX_RAW_THREAD_VISIBLE_ITEMS_PER_TURN = 24, threadDetailStateApi = root.CodexThreadDetailState, threadDetailMergeStateApi = root.CodexThreadDetailMergeState, threadDetailV4MergeStateApi = root.CodexThreadDetailV4MergeState, statusText = noopString, normalizeFsPath = (value) => String(value || ""), imageUrlValue = noopString, isInputTextPart = noopFalse, inputTextValue = noopString, isInputImagePart = noopFalse, splitAttachmentSummaryText = (value) => ({
		text: String(value || ""),
		attachments: []
	}), canRenderImageAttachment = noopFalse, truncateMiddle = (value) => String(value || ""), isLiveTurn = noopFalse, isLatestTurn = noopFalse, latestTurnForThread = (thread) => {
		const turns = Array.isArray(thread && thread.turns) ? thread.turns : [];
		return turns.length ? turns[turns.length - 1] : null;
	}, isLiveTurnForThread = (thread, turn) => isLiveTurn(turn, thread), isActiveOperationalItem = noopFalse, isReasoningItem = noopFalse, isOperationalItem = noopFalse, isContextCompactionItem = noopFalse, contextCompactionNotice = () => null, operationCommandText = noopString, operationDetailText = noopString, imageViewPath = noopString, imageViewContentUrl = noopString, imageViewUrl = noopString, isTurnComplete = noopFalse, isRunningStatus = noopFalse, isIncompleteInterruptedTurn = noopFalse, turnHasActiveLiveItems = noopFalse, isRecentlySubmittedUserMessage = noopFalse, sortTurnsForDisplay = identityArray, maxVisibleTurnsForThread = () => 10, numericTimestampMs = (value) => {
		const numberValue = Number(value);
		return Number.isFinite(numberValue) ? numberValue : 0;
	}, renderContextThread = (thread = null) => thread || state.currentThread || null } = deps;
	if (!threadDetailStateApi || typeof threadDetailStateApi.createThreadDetailStatePolicy !== "function") throw new Error("CodexThreadDetailState policy script failed to load");
	if (!threadDetailMergeStateApi || typeof threadDetailMergeStateApi.createThreadDetailMergePolicy !== "function") throw new Error("CodexThreadDetailMergeState script failed to load");
	if (!threadDetailV4MergeStateApi || typeof threadDetailV4MergeStateApi.createThreadDetailV4MergePolicy !== "function") throw new Error("CodexThreadDetailV4MergeState script failed to load");
	function liveTurnHasNonUserProgress(turn, thread = null) {
		if (!turn || !isLiveTurn(turn, thread)) return false;
		return (turn.items || []).some((item) => item && item.type !== "userMessage" && (isReasoningItem(item) || isOperationalItem(item) || isContextCompactionItem(item) || item.type === "agentMessage" || item.type === "plan" || item.type === "turnDiagnostic" || item.type === "turnUsageSummary"));
	}
	function isVisibleNonUserProgressItem(item) {
		return Boolean(item && item.type !== "userMessage" && (isReasoningItem(item) || isOperationalItem(item) || isContextCompactionItem(item) || item.type === "agentMessage" || item.type === "plan" || item.type === "turnDiagnostic" || item.type === "turnUsageSummary"));
	}
	function liveTurnHasNonUserProgressBefore(turn, index, thread = null) {
		if (!turn || !isLiveTurn(turn, thread)) return false;
		const items = Array.isArray(turn.items) ? turn.items : [];
		for (let pos = 0; pos < Math.min(index, items.length); pos += 1) if (isVisibleNonUserProgressItem(items[pos])) return true;
		return false;
	}
	function liveTurnHasNonUserProgressAfter(turn, index, thread = null) {
		if (!turn || !isLiveTurn(turn, thread)) return false;
		const items = Array.isArray(turn.items) ? turn.items : [];
		for (let pos = Math.max(0, index + 1); pos < items.length; pos += 1) if (isVisibleNonUserProgressItem(items[pos])) return true;
		return false;
	}
	function isUserVisibleTextReplyItem(item) {
		return Boolean(item && item.type !== "userMessage" && (item.type === "agentMessage" || item.type === "plan" || item.type === "turnUsageSummary"));
	}
	function liveTurnHasUserVisibleTextReplyAfter(turn, index, thread = null) {
		if (!turn || !isLiveTurn(turn, thread)) return false;
		const items = Array.isArray(turn.items) ? turn.items : [];
		for (let pos = Math.max(0, index + 1); pos < items.length; pos += 1) if (isUserVisibleTextReplyItem(items[pos])) return true;
		return false;
	}
	function userMessageHasVisualAttachment(item) {
		if (!item || item.type !== "userMessage") return false;
		const textValues = [];
		if (typeof item.text === "string") textValues.push(item.text);
		if (typeof item.message === "string") textValues.push(item.message);
		const content = Array.isArray(item.content) ? item.content : [];
		for (const part of content) {
			if (!part || typeof part !== "object") continue;
			if (isInputImagePart(part)) return true;
			if (isInputTextPart(part)) textValues.push(inputTextValue(part));
			if (part.path && /\.(?:png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(String(part.path))) return true;
			const url = imageUrlValue(part);
			if (url && /\.(?:png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(String(url))) return true;
		}
		return textValues.some((text) => splitAttachmentSummaryText(text).attachments.some((attachment) => attachment.isImage && canRenderImageAttachment(attachment)));
	}
	function shouldHideDurableLiveUserMessage(turn, item, index = 0, thread = null) {
		return false;
	}
	function durableUserMessageMatchesOptimisticEcho(durableItem, optimisticItem) {
		if (!durableItem || !optimisticItem) return false;
		if (durableItem.type !== "userMessage" || optimisticItem.type !== "userMessage") return false;
		if (isOptimisticUserMessage(durableItem) || !isOptimisticUserMessage(optimisticItem)) return false;
		return userMessagesShareSubmissionId(durableItem, optimisticItem) || userMessagesLikelySame(durableItem, optimisticItem);
	}
	function threadHasDurableUserMessageWithSubmissionId(thread, optimisticItem) {
		const submissionIds = userMessageSubmissionIdCandidates(optimisticItem);
		if (!submissionIds.length || !thread || !Array.isArray(thread.turns)) return false;
		return thread.turns.some((candidateTurn) => (Array.isArray(candidateTurn && candidateTurn.items) ? candidateTurn.items : []).some((candidate) => candidate && candidate.type === "userMessage" && !isOptimisticUserMessage(candidate) && submissionIds.some((submissionId) => userMessageHasSubmissionId(candidate, submissionId))));
	}
	function threadHasDurableUserMessageMatchingOptimisticEcho(thread, optimisticItem) {
		if (!thread || !Array.isArray(thread.turns) || !isOptimisticUserMessage(optimisticItem)) return false;
		return thread.turns.some((candidateTurn) => (Array.isArray(candidateTurn && candidateTurn.items) ? candidateTurn.items : []).some((candidate) => candidate && candidate.type === "userMessage" && !isOptimisticUserMessage(candidate) && optimisticEchoCanMatchEarlierDurable(candidate, optimisticItem)));
	}
	function shouldHideOptimisticUserMessageEcho(turn, item, index = 0, thread = null) {
		if (!item || item.type !== "userMessage" || !isOptimisticUserMessage(item)) return false;
		if ((Array.isArray(turn && turn.items) ? turn.items : []).some((candidate, candidateIndex) => candidateIndex !== index && durableUserMessageMatchesOptimisticEcho(candidate, item))) return true;
		const contextThread = renderContextThread(thread);
		return threadHasDurableUserMessageWithSubmissionId(contextThread, item) || threadHasDurableUserMessageMatchingOptimisticEcho(contextThread, item);
	}
	function isSupersededLiveTurn(turn) {
		return Boolean(turn && (turn.mobileSupersededLive || turn.status && turn.status.mobileSupersededLive));
	}
	function shouldHideSupersededLiveUserMessage(turn, item) {
		return Boolean(isSupersededLiveTurn(turn) && item && item.type === "userMessage" && !userMessageHasVisualAttachment(item));
	}
	function isRawThreadReadMode(thread) {
		return Boolean(thread && (thread.mobileRawThreadRead || String(thread.mobileReadMode || "") === "thread-read-raw"));
	}
	function shouldPreserveRawThreadVisibleEntry(entry) {
		const item = entry && entry.item;
		if (!item) return false;
		return item.type === "userMessage" || item.type === "imageView" || item.type === "imageGeneration" || item.type === "turnUsageSummary" || isContextCompactionItem(item);
	}
	function itemTextValue(value) {
		if (typeof value === "string") return value;
		if (Array.isArray(value)) return value.map(itemTextValue).join("");
		return "";
	}
	function reasoningItemHasVisibleText(item) {
		return Boolean(itemTextValue(item && item.text).trim() || itemTextValue(item && item.content).trim() || itemTextValue(item && item.summary).trim());
	}
	function isLatestCompletedProcessTurn(turn, thread = null) {
		if (!turn || !isTurnComplete(turn)) return false;
		const contextThread = renderContextThread(thread);
		const turns = Array.isArray(contextThread && contextThread.turns) ? contextThread.turns : [];
		for (let index = turns.length - 1; index >= 0; index -= 1) {
			const candidate = turns[index];
			if (!candidate || isLiveTurn(candidate, contextThread)) continue;
			if (!isTurnComplete(candidate)) continue;
			return candidate === turn;
		}
		return isLatestTurn(turn, contextThread);
	}
	function limitRawThreadVisibleEntries(entries, thread = null) {
		if (!isRawThreadReadMode(renderContextThread(thread))) return entries;
		if (!Array.isArray(entries) || entries.length <= MAX_RAW_THREAD_VISIBLE_ITEMS_PER_TURN) return entries;
		const keep = /* @__PURE__ */ new Set();
		entries.forEach((entry, index) => {
			if (shouldPreserveRawThreadVisibleEntry(entry)) keep.add(index);
		});
		for (let index = Math.max(0, entries.length - MAX_RAW_THREAD_VISIBLE_ITEMS_PER_TURN); index < entries.length; index += 1) keep.add(index);
		return entries.filter((_, index) => keep.has(index));
	}
	function visibleItemsForTurn(turn, thread = null) {
		const visible = [];
		const contextEntryByKey = /* @__PURE__ */ new Map();
		const contextThread = renderContextThread(thread);
		(turn.items || []).forEach((item, index) => {
			if (!item) return;
			if (isReasoningItem(item)) return;
			if (shouldHideSupersededLiveUserMessage(turn, item)) return;
			if (shouldHideOptimisticUserMessageEcho(turn, item, index, contextThread)) return;
			if (shouldHideDurableLiveUserMessage(turn, item, index, contextThread)) return;
			if (isContextCompactionItem(item)) {
				if (!contextCompactionNotice(item, turn, contextThread)) return;
				const groupKey = "context-compaction";
				const existing = contextEntryByKey.get(groupKey);
				if (existing) visible[existing.visibleIndex] = null;
				contextEntryByKey.set(groupKey, { visibleIndex: visible.length });
				visible.push({
					item,
					sourceIndex: index
				});
				return;
			}
			if (isOperationalItem(item)) return;
			visible.push({
				item,
				sourceIndex: index
			});
		});
		const filtered = [];
		for (const entry of visible.filter(Boolean)) {
			const item = entry && entry.item;
			if (item && item.type === "userMessage") {
				const existingIndex = filtered.findIndex((candidate) => candidate && candidate.item && candidate.item.type === "userMessage" && userMessagesAreSameTurnDuplicateEvent(candidate.item, item));
				if (existingIndex >= 0) {
					const existingEntry = filtered[existingIndex];
					const existingPriority = userMessageShadowPriority(existingEntry && existingEntry.item);
					const preferredEntry = userMessageShadowPriority(item) >= existingPriority ? entry : existingEntry;
					const sourceIndex = Number.isInteger(preferredEntry && preferredEntry.sourceIndex) ? preferredEntry.sourceIndex : Number.isInteger(existingEntry && existingEntry.sourceIndex) ? existingEntry.sourceIndex : entry.sourceIndex;
					filtered[existingIndex] = {
						item: mergeLikelySameUserMessage(existingEntry && existingEntry.item, item),
						sourceIndex
					};
					continue;
				}
			}
			filtered.push(entry);
		}
		if (isSupersededLiveTurn(turn) && filtered.length && filtered.every((entry) => isTurnUsageSummaryItem(entry.item))) return [];
		return limitRawThreadVisibleEntries(filtered, thread);
	}
	function currentLiveOperationEntry(thread) {
		if (!thread || !Array.isArray(thread.turns) || !thread.turns.length) return null;
		let turn = null;
		for (let index = thread.turns.length - 1; index >= 0; index -= 1) {
			const candidate = thread.turns[index];
			if (isSupersededLiveTurn(candidate)) continue;
			if (isLiveTurnForThread(thread, candidate)) {
				turn = candidate;
				break;
			}
		}
		if (!turn) return null;
		const items = Array.isArray(turn.items) ? turn.items : [];
		for (let index = items.length - 1; index >= 0; index -= 1) {
			const item = items[index];
			if (isActiveOperationalItem(item)) return {
				turn,
				item,
				sourceIndex: index
			};
		}
		return {
			turn,
			item: liveTurnStatusDockItem(turn),
			sourceIndex: -1
		};
	}
	function liveTurnStatusDockItem(turn) {
		return {
			id: `live-turn-status-${turn && (turn.id || turn.startedAt || "active")}`,
			type: "liveTurnStatus",
			status: "",
			title: "Command"
		};
	}
	function visibleItemSignature(item, turn = null, thread = null) {
		if (!item || isReasoningItem(item)) return null;
		const projection = {
			mobileVisibleKey: item.mobileVisibleKey || "",
			mobileVisibleKind: item.mobileVisibleKind || ""
		};
		if (isContextCompactionItem(item)) {
			const notice = contextCompactionNotice(item, turn, thread);
			if (!notice) return null;
			return {
				...projection,
				id: item.id || "",
				type: item.type || "",
				status: statusText(item.status),
				mobileCompactionStatus: item.mobileCompactionStatus || "",
				mobileNotice: item.mobileNotice || "",
				notice
			};
		}
		if (isOperationalItem(item)) return {
			...projection,
			id: item.id || "",
			type: item.type || "",
			status: statusText(item.status),
			startedAtMs: item.startedAtMs || item.startedAt || item.started_at_ms || item.started_at || "",
			completedAtMs: item.completedAtMs || item.completedAt || item.completed_at_ms || item.completed_at || "",
			durationMs: item.durationMs || item.duration_ms || item.elapsedMs || item.elapsed_ms || "",
			command: operationCommandText(item),
			fileNames: Array.isArray(item.fileNames) ? item.fileNames : [],
			tool: item.tool || "",
			server: item.server || "",
			namespace: item.namespace || "",
			detail: operationDetailText(item)
		};
		if (item.type === "turnUsageSummary") return {
			...projection,
			id: item.id || "",
			type: item.type || "",
			status: statusText(item.status),
			mobileUsageSummary: item.mobileUsageSummary || {}
		};
		if (item.type === "turnDiagnostic") return {
			...projection,
			id: item.id || "",
			type: item.type || "",
			status: statusText(item.status),
			code: item.code || "",
			severity: item.severity || "",
			title: item.title || "",
			message: item.message || "",
			source: item.source || "",
			mobileRuntimeDiagnostic: Boolean(item.mobileRuntimeDiagnostic)
		};
		if (item.type === "imageView") return {
			...projection,
			id: item.id || "",
			type: item.type || "",
			status: statusText(item.status),
			path: imageViewPath(item),
			contentUrl: imageSourceSignature(imageViewContentUrl(item)),
			url: imageSourceSignature(imageViewUrl(item))
		};
		return {
			...projection,
			id: item.id || "",
			type: item.type || "",
			status: statusText(item.status),
			text: item.text || "",
			content: Array.isArray(item.content) ? inputContentSignature(item.content) : [],
			summary: Array.isArray(item.summary) ? item.summary : [],
			mobileNotice: item.mobileNotice || ""
		};
	}
	function visibleItemBudgetForTurn(turn) {
		if (!turn || typeof turn !== "object") return null;
		const budget = turn.mobileVisibleItemBudget && typeof turn.mobileVisibleItemBudget === "object" ? turn.mobileVisibleItemBudget : {};
		const omitted = Math.max(0, Math.trunc(Number(turn.mobileOmittedVisibleItemCount || budget.omitted || 0)));
		if (!omitted) return null;
		return {
			omitted,
			retained: Math.max(0, Math.trunc(Number(budget.retained || 0))),
			original: Math.max(0, Math.trunc(Number(budget.original || 0))),
			ceiling: Math.max(0, Math.trunc(Number(budget.ceiling || 0))),
			reason: String(budget.reason || "response-budget")
		};
	}
	function visibleItemBudgetSignature(turn) {
		const budget = visibleItemBudgetForTurn(turn);
		if (!budget) return null;
		return budget;
	}
	function inputContentSignature(content) {
		return (content || []).map((part) => {
			if (!part || typeof part !== "object") return String(part || "");
			if (isInputTextPart(part)) return {
				type: "text",
				text: inputTextValue(part)
			};
			if (isInputImagePart(part)) return {
				type: part.type || "image",
				path: part.path || "",
				url: imageSourceSignature(imageUrlValue(part))
			};
			return compactStructuredForSignature(part);
		});
	}
	function imageSourceSignature(value) {
		const text = String(value || "");
		if (/^data:image\//i.test(text)) return `${text.slice(0, 48)}...${text.length}`;
		return text;
	}
	function compactStructuredForSignature(value) {
		try {
			return truncateMiddle(JSON.stringify(value), 600, "payload");
		} catch (_) {
			return String(value || "");
		}
	}
	function itemVisibleWeight(item) {
		const signature = visibleItemSignature(item);
		return signature ? JSON.stringify(signature).length : 0;
	}
	function turnVisibleWeight(turn) {
		return (turn && Array.isArray(turn.items) ? turn.items : []).reduce((total, item) => total + itemVisibleWeight(item), 0);
	}
	function isAssistantReceiptLikeItem(item) {
		return Boolean(item && (item.type === "agentMessage" || item.type === "plan"));
	}
	function completedIncomingTurnHasAuthoritativeReceipt(incomingTurn) {
		return threadDetailStatePolicy.completedIncomingTurnHasAuthoritativeReceipt(incomingTurn);
	}
	function shouldDropLocalOnlyReceiptForIncomingTurn(item, incomingTurn = null) {
		return threadDetailStatePolicy.shouldDropLocalOnlyReceiptForIncomingTurn(item, incomingTurn);
	}
	function shouldPreserveLocalOnlyItem(item, preserveLocalVisible = false, suppressedVisualReceiptKeys = null, incomingTurn = null) {
		return threadDetailStatePolicy.shouldPreserveLocalOnlyItem(item, preserveLocalVisible, suppressedVisualReceiptKeys, incomingTurn);
	}
	function isMuxUserMessage(item) {
		return Boolean(item && item.type === "userMessage" && /^mux-user-/.test(String(item.id || "")));
	}
	function isOptimisticUserMessage(item) {
		return Boolean(item && item.type === "userMessage" && (item.mobilePendingSubmission || /^local-user-/.test(String(item.id || "")) || isMuxUserMessage(item)));
	}
	function userMessageSubmissionIdCandidates(item) {
		if (!item || item.type !== "userMessage") return [];
		const values = [];
		const pushCandidate = (value) => {
			const text = String(value || "").trim();
			if (text) values.push(text);
		};
		pushCandidate(item.clientSubmissionId);
		pushCandidate(item.clientId);
		pushCandidate(item.client_id);
		pushCandidate(item.submissionId);
		pushCandidate(item.submission_id);
		pushCandidate(item.mobileSubmissionId);
		pushCandidate(item.mobile_submission_id);
		const local = String(item.id || "").match(/^local-user-(.+)$/);
		if (local && local[1]) pushCandidate(local[1]);
		return [...new Set(values)];
	}
	function userMessageHasSubmissionId(item, submissionId) {
		const value = String(submissionId || "").trim();
		if (!value || !item || item.type !== "userMessage") return false;
		if (userMessageSubmissionIdCandidates(item).includes(value)) return true;
		const id = String(item.id || "");
		return Boolean(id && id.endsWith(`-${value}`));
	}
	function userMessagesShareSubmissionId(left, right) {
		const leftValues = userMessageSubmissionIdCandidates(left);
		const rightValues = userMessageSubmissionIdCandidates(right);
		return leftValues.some((value) => userMessageHasSubmissionId(right, value)) || rightValues.some((value) => userMessageHasSubmissionId(left, value));
	}
	function isTurnUsageSummaryItem(item) {
		return Boolean(item && item.type === "turnUsageSummary");
	}
	function isTurnDiagnosticItem(item) {
		return Boolean(item && item.type === "turnDiagnostic");
	}
	function dedupeTurnUsageSummaryItems(items) {
		if (!Array.isArray(items)) return [];
		let lastSummaryIndex = -1;
		items.forEach((item, index) => {
			if (isTurnUsageSummaryItem(item)) lastSummaryIndex = index;
		});
		if (lastSummaryIndex < 0) return items;
		return items.filter((item, index) => !isTurnUsageSummaryItem(item) || index === lastSummaryIndex);
	}
	function normalizeComparableText(value) {
		return String(value || "").replace(/\s+/g, " ").trim();
	}
	function userMessageComparableParts(item) {
		const result = {
			text: "",
			paths: []
		};
		if (!item || item.type !== "userMessage") return result;
		const textParts = [];
		const paths = [];
		if (typeof item.text === "string") textParts.push(item.text);
		if (typeof item.message === "string") textParts.push(item.message);
		const contentParts = Array.isArray(item.content) ? item.content : typeof item.content === "string" ? [{
			type: "text",
			text: item.content
		}] : [];
		for (const part of contentParts) {
			if (!part || typeof part !== "object") continue;
			if (isInputTextPart(part)) {
				const split = splitAttachmentSummaryText(inputTextValue(part));
				if (split.text) textParts.push(split.text);
				for (const attachment of split.attachments) if (attachment.path) paths.push(normalizeFsPath(attachment.path));
				continue;
			}
			if (part.path) paths.push(normalizeFsPath(part.path));
			else if (isInputImagePart(part)) {
				const url = imageUrlValue(part);
				if (url && !/^data:image\//i.test(url)) paths.push(normalizeFsPath(url));
			}
		}
		result.text = normalizeComparableText(textParts.join("\n"));
		result.paths = [...new Set(paths.filter(Boolean))].sort();
		return result;
	}
	function userMessagePathOverlap(left, right) {
		return left.paths.length > 0 && right.paths.length > 0 && left.paths.some((pathValue) => right.paths.includes(pathValue));
	}
	function comparablePathName(pathValue) {
		const text = String(pathValue || "").split(/[?#]/)[0];
		const parts = normalizeFsPath(text).split("\\").filter(Boolean);
		return parts[parts.length - 1] || "";
	}
	function userMessagePathNameOverlap(left, right) {
		if (!left.paths.length || !right.paths.length) return false;
		const leftNames = new Set(left.paths.map(comparablePathName).filter(Boolean));
		if (!leftNames.size) return false;
		return right.paths.some((pathValue) => {
			const rightName = comparablePathName(pathValue);
			return rightName && Array.from(leftNames).some((leftName) => comparablePathNamesLikelySame(leftName, rightName));
		});
	}
	function comparablePathNamesLikelySame(leftName, rightName) {
		const left = String(leftName || "");
		const right = String(rightName || "");
		if (!left || !right) return false;
		if (left === right) return true;
		return left.endsWith(`-${right}`) || right.endsWith(`-${left}`);
	}
	function isVisualReceiptItem(item) {
		return Boolean(item && (item.type === "imageView" || item.type === "imageGeneration"));
	}
	function visualReceiptComparableNames(item) {
		if (!isVisualReceiptItem(item)) return [];
		const values = [
			imageViewPath(item),
			imageViewContentUrl(item),
			imageViewUrl(item),
			item.fileName,
			item.file_name,
			item.label,
			item.caption,
			item.name
		];
		return [...new Set(values.map(comparablePathName).filter(Boolean))];
	}
	function visualReceiptCallId(item) {
		return String(item && (item.callId || item.call_id || item.toolCallId || item.tool_call_id || item.arguments && (item.arguments.callId || item.arguments.call_id || item.arguments.toolCallId || item.arguments.tool_call_id) || item.result && (item.result.callId || item.result.call_id || item.result.toolCallId || item.result.tool_call_id)) || "").trim();
	}
	function visualReceiptSuppressionKeys(item) {
		if (!isVisualReceiptItem(item)) return [];
		const keys = /* @__PURE__ */ new Set();
		const id = String(item && item.id || "").trim();
		const callId = visualReceiptCallId(item);
		if (id) keys.add(`id:${id}`);
		if (callId) keys.add(`call:${callId}`);
		for (const name of visualReceiptComparableNames(item)) keys.add(`name:${name}`);
		return [...keys];
	}
	function suppressedVisualReceiptKeySet(turn) {
		const values = Array.isArray(turn && turn.mobileSuppressedVisualReceiptKeys) ? turn.mobileSuppressedVisualReceiptKeys : [];
		return new Set(values.map((entry) => String(entry || "").trim()).filter(Boolean));
	}
	function visualReceiptMatchesSuppressionKeys(item, suppressedVisualReceiptKeys) {
		if (!isVisualReceiptItem(item) || !suppressedVisualReceiptKeys || !suppressedVisualReceiptKeys.size) return false;
		return visualReceiptSuppressionKeys(item).some((key) => suppressedVisualReceiptKeys.has(key));
	}
	function userMessageSpecificity(item) {
		const parts = userMessageComparableParts(item);
		return parts.text.length + parts.paths.length * 240;
	}
	function userMessagesLikelySame(left, right) {
		if (!left || !right || left.type !== "userMessage" || right.type !== "userMessage") return false;
		const a = userMessageComparableParts(left);
		const b = userMessageComparableParts(right);
		if (a.text && b.text && a.text === b.text) {
			if (isOptimisticUserMessage(left) || isOptimisticUserMessage(right)) return true;
			if (!a.paths.length && !b.paths.length) return true;
			return userMessagePathOverlap(a, b);
		}
		if ((isOptimisticUserMessage(left) || isOptimisticUserMessage(right)) && userMessagePathNameOverlap(a, b) && (!a.text || !b.text || a.text === b.text)) return true;
		return userMessagePathOverlap(a, b) && (!a.text || !b.text || a.text === b.text);
	}
	function userMessagesCanShadow(left, right) {
		if (left && right && left.type === "userMessage" && right.type === "userMessage" && userMessagesShareSubmissionId(left, right)) return true;
		const leftSubmittedEcho = Boolean(String(left && left.clientSubmissionId || "").trim() && !(left && left.mobileSendError));
		const rightSubmittedEcho = Boolean(String(right && right.clientSubmissionId || "").trim() && !(right && right.mobileSendError));
		const projectionIndexId = (item) => String(item && (item.id || item.itemId || item.item_id) || "").trim().match(/^item-(\d+)$/i);
		const leftProjectionIndex = Boolean(projectionIndexId(left));
		const rightProjectionIndex = Boolean(projectionIndexId(right));
		const itemTimeMs = (item) => {
			const value = item && (item.startedAtMs || item.startedAt || item.createdAtMs || item.createdAt || item.timestampMs || item.timestamp || item.updatedAtMs || item.updatedAt);
			if (value === null || value === void 0 || value === "") return 0;
			const numberValue = Number(value);
			if (Number.isFinite(numberValue) && numberValue > 0) return numberValue > 0xe8d4a51000 ? Math.trunc(numberValue) : Math.trunc(numberValue * 1e3);
			const parsed = Date.parse(String(value));
			return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
		};
		const leftProjectionTime = itemTimeMs(left);
		const rightProjectionTime = itemTimeMs(right);
		const projectionIndexEcho = Boolean(leftProjectionIndex && rightProjectionIndex && leftProjectionTime && rightProjectionTime && Math.abs(leftProjectionTime - rightProjectionTime) <= 5e3);
		return Boolean(left && right && left.type === "userMessage" && right.type === "userMessage" && (isOptimisticUserMessage(left) || isOptimisticUserMessage(right) || leftSubmittedEcho || rightSubmittedEcho || projectionIndexEcho) && userMessagesLikelySame(left, right));
	}
	function userMessagesAreSameTurnDuplicateEvent(left, right) {
		if (!left || !right || left.type !== "userMessage" || right.type !== "userMessage") return false;
		if (userMessagesCanShadow(left, right)) return true;
		if (!userMessagesLikelySame(left, right)) return false;
		const leftTime = userMessageTimestampMs(left);
		const rightTime = userMessageTimestampMs(right);
		if (!leftTime || !rightTime || Math.abs(leftTime - rightTime) > 5e3) return false;
		return true;
	}
	function userMessageTimestampMs(item) {
		const value = item && (item.startedAtMs || item.startedAt || item.createdAtMs || item.createdAt || item.timestampMs || item.timestamp || item.updatedAtMs || item.updatedAt || item.mobileDisplayTimestampMs);
		if (value === null || value === void 0 || value === "") return 0;
		const numberValue = Number(value);
		if (Number.isFinite(numberValue) && numberValue > 0) return numberValue > 0xe8d4a51000 ? Math.trunc(numberValue) : Math.trunc(numberValue * 1e3);
		const parsed = Date.parse(String(value));
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
	}
	function userMessagesHaveNearbyTimestamps(left, right, windowMs = 600 * 1e3) {
		const leftMs = userMessageTimestampMs(left);
		const rightMs = userMessageTimestampMs(right);
		return Boolean(leftMs && rightMs && Math.abs(leftMs - rightMs) <= windowMs);
	}
	function isProjectionIndexUserMessage(item) {
		return Boolean(String(item && (item.id || item.itemId || item.item_id) || "").trim().match(/^item-\d+$/i));
	}
	function userMessagesAreSameEventAcrossTurns(left, right) {
		if (!left || !right || left.type !== "userMessage" || right.type !== "userMessage") return false;
		if (!userMessagesLikelySame(left, right)) return false;
		if (userMessagesShareSubmissionId(left, right)) return true;
		if (userMessagesCanShadow(left, right)) return true;
		const leftTime = userMessageTimestampMs(left);
		const rightTime = userMessageTimestampMs(right);
		if (!leftTime || !rightTime || Math.abs(leftTime - rightTime) > 5e3) return false;
		return Boolean(isOptimisticUserMessage(left) || isOptimisticUserMessage(right) || isProjectionIndexUserMessage(left) || isProjectionIndexUserMessage(right));
	}
	function durableTurnCanReceivePendingEcho(turn) {
		if (!turn) return false;
		const status = turn.status;
		const statusType = status && typeof status === "object" ? String(status.type || status.status || status.state || "") : String(status || "");
		if (/completed|failed|cancel|error|interrupted/i.test(statusType)) return false;
		if (/running|active|queued|processing|inprogress|in_progress|in-progress|pending|started/i.test(statusType)) return true;
		return Boolean(turn.live || turn.mobileLive || turn.mobileActiveLiveTurn || turn.mobilePendingOverlay);
	}
	function isLocalPendingSubmissionEcho(item) {
		return Boolean(item && item.type === "userMessage" && item.mobilePendingSubmission && String(item.clientSubmissionId || "").trim() && /^local-user-/.test(String(item.id || "")));
	}
	function completedDurableTurnSettlesOptimisticEcho(durableItem, optimisticItem, durableTurn = null) {
		if (!durableTurn) return false;
		const status = durableTurn.status;
		const statusType = status && typeof status === "object" ? String(status.type || status.status || status.state || "") : String(status || "");
		const timestampMs = (value) => {
			if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
			if (typeof value === "string" && value.trim()) {
				const numeric = Number(value);
				if (Number.isFinite(numeric) && numeric > 0) return numeric;
				const parsed = Date.parse(value);
				if (Number.isFinite(parsed) && parsed > 0) return parsed;
			}
			return 0;
		};
		const durableCompletedMs = [
			"completedAtMs",
			"completedAt",
			"completed_at_ms",
			"completed_at",
			"updatedAtMs",
			"updatedAt",
			"updated_at_ms",
			"updated_at"
		].reduce((value, field) => value || timestampMs(durableTurn[field]), 0);
		if (!durableCompletedMs && !/completed|failed|cancel|error|interrupted/i.test(statusType)) return false;
		if (!isLocalPendingSubmissionEcho(optimisticItem)) return false;
		if (!userMessagesLikelySame(durableItem, optimisticItem)) return false;
		const optimisticMs = userMessageTimestampMs(optimisticItem);
		if (!optimisticMs) return Boolean(durableCompletedMs);
		return Boolean(durableCompletedMs && optimisticMs <= durableCompletedMs);
	}
	function optimisticEchoCanMatchEarlierDurable(durableItem, optimisticItem, durableTurn = null) {
		if (!durableItem || !optimisticItem) return false;
		if (durableItem.type !== "userMessage" || optimisticItem.type !== "userMessage") return false;
		if (isOptimisticUserMessage(durableItem) || !isOptimisticUserMessage(optimisticItem)) return false;
		if (userMessagesShareSubmissionId(durableItem, optimisticItem)) return true;
		const durableTurnSubmissionKey = String(durableTurn && durableTurn.mobileLocalSubmissionRenderKey || "").trim();
		if (durableTurnSubmissionKey) {
			const localSubmissionRenderKey = (clientSubmissionId) => {
				const text = String(clientSubmissionId || "").trim();
				if (!text) return "";
				let hash = 2166136261;
				for (let index = 0; index < text.length; index += 1) {
					hash ^= text.charCodeAt(index);
					hash = Math.imul(hash, 16777619);
				}
				return `submitted:${(hash >>> 0).toString(36)}`;
			};
			if (userMessageSubmissionIdCandidates(optimisticItem).some((submissionId) => durableTurnSubmissionKey === localSubmissionRenderKey(submissionId))) return userMessagesLikelySame(durableItem, optimisticItem);
		}
		if (completedDurableTurnSettlesOptimisticEcho(durableItem, optimisticItem, durableTurn)) return true;
		const likelySameNearby = userMessagesLikelySame(durableItem, optimisticItem) && userMessagesHaveNearbyTimestamps(durableItem, optimisticItem);
		if (optimisticItem.mobileSendError) return likelySameNearby;
		if (!isLocalPendingSubmissionEcho(optimisticItem) || !durableTurnCanReceivePendingEcho(durableTurn)) return false;
		return likelySameNearby;
	}
	function hasMatchingIncomingUserMessage(existingItem, incomingItems) {
		if (!existingItem || existingItem.type !== "userMessage") return false;
		return (incomingItems || []).some((incomingItem) => incomingItem && incomingItem.id !== existingItem.id && incomingItem.type === "userMessage" && userMessagesCanShadow(existingItem, incomingItem));
	}
	function hasMatchingRealUserMessage(item, items) {
		if (!isMuxUserMessage(item)) return false;
		return (items || []).some((candidate) => candidate && candidate.id !== item.id && candidate.type === "userMessage" && !isMuxUserMessage(candidate) && userMessagesCanShadow(candidate, item));
	}
	function removeShadowedMuxUserMessages(items) {
		return (items || []).filter((item) => !hasMatchingRealUserMessage(item, items));
	}
	function userMessageShadowPriority(item) {
		if (!item || item.type !== "userMessage") return 0;
		if (/^local-user-/.test(String(item.id || ""))) return 1;
		if (isMuxUserMessage(item) || item.mobilePendingSubmission || String(item.clientSubmissionId || "").trim()) return 2;
		const projectionMatch = String(item.id || item.itemId || item.item_id || "").trim().match(/^item-(\d+)$/i);
		if (projectionMatch) return 2 + Math.max(0, Math.min(999999, Number(projectionMatch[1]) || 0)) / 1e6;
		return 3;
	}
	function mergeLikelySameUserMessage(existingItem, incomingItem) {
		const existingPriority = userMessageShadowPriority(existingItem);
		const incomingPriority = userMessageShadowPriority(incomingItem);
		const merged = mergeItemPreservingVisibleFields(existingItem, incomingItem);
		const preferred = incomingPriority >= existingPriority ? incomingItem : existingItem;
		if (preferred && preferred.id) merged.id = preferred.id;
		if (preferred && preferred.clientSubmissionId) merged.clientSubmissionId = preferred.clientSubmissionId;
		else if (existingItem && existingItem.clientSubmissionId) merged.clientSubmissionId = existingItem.clientSubmissionId;
		else if (incomingItem && incomingItem.clientSubmissionId) merged.clientSubmissionId = incomingItem.clientSubmissionId;
		if (preferred && preferred.startedAtMs && !merged.startedAtMs) merged.startedAtMs = preferred.startedAtMs;
		if (preferred && !isOptimisticUserMessage(preferred)) {
			delete merged.mobilePendingSubmission;
			delete merged.mobileSendError;
		}
		if (incomingItem && !isOptimisticUserMessage(incomingItem) && isOptimisticUserMessage(existingItem) || incomingPriority > existingPriority && incomingPriority >= 3) {
			if (Array.isArray(incomingItem.content)) merged.content = incomingItem.content;
			if (typeof incomingItem.text === "string") merged.text = incomingItem.text;
			if (typeof incomingItem.message === "string") merged.message = incomingItem.message;
		}
		return merged;
	}
	function dedupeLikelySameUserMessages(items) {
		const out = [];
		for (const item of items || []) {
			if (item && item.type === "userMessage") {
				const existingIndex = out.findIndex((candidate) => userMessagesAreSameTurnDuplicateEvent(candidate, item));
				if (existingIndex >= 0) {
					out[existingIndex] = mergeLikelySameUserMessage(out[existingIndex], item);
					continue;
				}
			}
			out.push(item);
		}
		return out;
	}
	function normalizeThreadVisibleUserMessages(thread) {
		if (!thread || !Array.isArray(thread.turns)) return thread;
		for (const turn of thread.turns) {
			if (!turn || !Array.isArray(turn.items)) continue;
			turn.items = removeShadowedMuxUserMessages(dedupeLikelySameUserMessages(turn.items));
		}
		const userMessages = threadUserMessageEntries(thread.turns);
		const durableUserMessages = [];
		for (const entry of userMessages) if (entry && entry.item && !isOptimisticUserMessage(entry.item)) durableUserMessages.push(entry);
		if (!durableUserMessages.length && userMessages.length < 2) return thread;
		for (let turnIndex = 0; turnIndex < thread.turns.length; turnIndex += 1) {
			const turn = thread.turns[turnIndex];
			if (!turn || !Array.isArray(turn.items)) continue;
			turn.items = turn.items.filter((item, itemIndex) => !shouldDropOptimisticUserMessageForDurable(item, turnIndex, durableUserMessages) && !shouldDropOptimisticUserMessageForHigherPriorityEcho(item, turnIndex, itemIndex, userMessages) && !shouldDropDuplicateUserMessageEvent(item, turnIndex, itemIndex, userMessages));
		}
		return thread;
	}
	function threadUserMessageEntries(turns) {
		const entries = [];
		for (let turnIndex = 0; turnIndex < (turns || []).length; turnIndex += 1) {
			const turn = turns[turnIndex];
			const items = Array.isArray(turn && turn.items) ? turn.items : [];
			for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
				const item = items[itemIndex];
				if (item && item.type === "userMessage") entries.push({
					item,
					turn,
					turnIndex,
					itemIndex
				});
			}
		}
		return entries;
	}
	function shouldDropOptimisticUserMessageForDurable(item, turnIndex, durableUserMessages) {
		if (!isOptimisticUserMessage(item) || !Array.isArray(durableUserMessages)) return false;
		return durableUserMessages.some((real) => {
			if (!real || !real.item || real.item.id === item.id) return false;
			if (userMessagesShareSubmissionId(real.item, item)) return true;
			if (!userMessagesCanShadow(real.item, item)) return false;
			if (real.turnIndex >= turnIndex) return true;
			if (optimisticEchoCanMatchEarlierDurable(real.item, item, real.turn)) return true;
			return userMessageHasVisualAttachment(real.item) && userMessageHasVisualAttachment(item);
		});
	}
	function shouldDropOptimisticUserMessageForHigherPriorityEcho(item, turnIndex, itemIndex, userMessages) {
		if (!isOptimisticUserMessage(item) || item.mobileSendError || !Array.isArray(userMessages)) return false;
		const itemPriority = userMessageShadowPriority(item);
		if (itemPriority <= 0 || itemPriority >= 3) return false;
		return userMessages.some((candidate) => {
			if (!candidate || !candidate.item || candidate.item === item || candidate.item.id === item.id) return false;
			if (userMessageShadowPriority(candidate.item) <= itemPriority) return false;
			if (!userMessagesShareSubmissionId(candidate.item, item)) {
				if (candidate.turnIndex < turnIndex) return false;
				if (candidate.turnIndex === turnIndex && candidate.itemIndex <= itemIndex) return false;
			}
			return userMessagesCanShadow(candidate.item, item);
		});
	}
	function shouldDropDuplicateUserMessageEvent(item, turnIndex, itemIndex, userMessages) {
		if (!item || item.type !== "userMessage" || !Array.isArray(userMessages)) return false;
		const itemHasVisualAttachment = userMessageHasVisualAttachment(item);
		const itemPriority = userMessageShadowPriority(item);
		return userMessages.some((candidate) => {
			if (!candidate || !candidate.item || candidate.item === item || candidate.item.id === item.id) return false;
			if (candidate.turnIndex < turnIndex) return false;
			if (candidate.turnIndex === turnIndex && candidate.itemIndex <= itemIndex) return false;
			const sameSubmission = userMessagesShareSubmissionId(candidate.item, item);
			if ((itemHasVisualAttachment || userMessageHasVisualAttachment(candidate.item)) && !sameSubmission) return false;
			if (!userMessagesAreSameEventAcrossTurns(candidate.item, item)) return false;
			const candidatePriority = userMessageShadowPriority(candidate.item);
			if (candidatePriority > itemPriority) return true;
			if (candidatePriority === itemPriority) return true;
			return false;
		});
	}
	function threadDurableUserMessages(turns) {
		const messages = [];
		for (const turn of turns || []) {
			const items = Array.isArray(turn && turn.items) ? turn.items : [];
			for (const item of items) if (item && item.type === "userMessage" && !isOptimisticUserMessage(item)) messages.push(item);
		}
		return messages;
	}
	function shouldDropInitialSubmissionEchoTurn(existingTurn, incomingTurns, initialSubmissionId) {
		const submissionId = String(initialSubmissionId || "").trim();
		if (!submissionId || !existingTurn || !Array.isArray(existingTurn.items)) return false;
		const visibleItems = existingTurn.items.filter((item) => item && itemVisibleWeight(item) > 0 && !isReasoningItem(item));
		const submittedEchoes = visibleItems.filter((item) => item && item.type === "userMessage" && isOptimisticUserMessage(item) && String(item.clientSubmissionId || "") === submissionId);
		if (!submittedEchoes.length || submittedEchoes.length !== visibleItems.length) return false;
		const durableMessages = threadDurableUserMessages(incomingTurns);
		return submittedEchoes.every((echo) => durableMessages.some((real) => userMessagesCanShadow(real, echo)));
	}
	function threadHasInitialSubmissionEcho(thread, initialSubmissionId) {
		const submissionId = String(initialSubmissionId || "").trim();
		if (!submissionId || !thread || !Array.isArray(thread.turns)) return false;
		return thread.turns.some((turn) => {
			return (Array.isArray(turn && turn.items) ? turn.items : []).some((item) => item && item.type === "userMessage" && isOptimisticUserMessage(item) && String(item.clientSubmissionId || "") === submissionId);
		});
	}
	function shouldPreserveMissingExistingTurn(existingTurn) {
		if (!existingTurn || isTurnComplete(existingTurn)) return false;
		const visibleItems = (Array.isArray(existingTurn.items) ? existingTurn.items : []).filter((item) => item && itemVisibleWeight(item) > 0 && !isReasoningItem(item));
		return Boolean(visibleItems.length && visibleItems.every((item) => item.type === "userMessage" && isOptimisticUserMessage(item)));
	}
	function comparableVisibleTextItem(item) {
		return Boolean(item && (item.type === "agentMessage" || item.type === "plan"));
	}
	function comparableVisibleText(item) {
		if (!comparableVisibleTextItem(item)) return "";
		return normalizeComparableText(item.text || "");
	}
	function visibleTextItemsLikelySame(existingItem, incomingItem) {
		if (!comparableVisibleTextItem(existingItem) || !comparableVisibleTextItem(incomingItem)) return false;
		if (existingItem.type !== incomingItem.type) return false;
		const existingText = comparableVisibleText(existingItem);
		const incomingText = comparableVisibleText(incomingItem);
		if (!existingText || !incomingText) return false;
		return incomingText === existingText || incomingText.length >= existingText.length && incomingText.startsWith(existingText);
	}
	function visibleTextItemsHaveStableSharedPrefix(existingItem, incomingItem) {
		if (!comparableVisibleTextItem(existingItem) || !comparableVisibleTextItem(incomingItem)) return false;
		if (existingItem.type !== incomingItem.type) return false;
		const existingText = comparableVisibleText(existingItem);
		const incomingText = comparableVisibleText(incomingItem);
		if (!existingText || !incomingText) return false;
		if (existingText === incomingText) return true;
		const shorterText = existingText.length <= incomingText.length ? existingText : incomingText;
		const longerText = existingText.length <= incomingText.length ? incomingText : existingText;
		if (shorterText.length < 16) return false;
		if (!longerText.startsWith(shorterText)) return false;
		return shorterText.length / Math.max(1, longerText.length) >= .5;
	}
	function completedReceiptItemsLikelySame(existingItem, incomingItem, incomingTurn = null) {
		if (!completedIncomingTurnHasAuthoritativeReceipt(incomingTurn)) return false;
		if (!isAssistantReceiptLikeItem(existingItem) || !isAssistantReceiptLikeItem(incomingItem)) return false;
		return visibleTextItemsLikelySame(existingItem, incomingItem) || visibleTextItemsHaveStableSharedPrefix(existingItem, incomingItem);
	}
	function visibleTextItemsCanShareRenderIdentity(existingItem, incomingItem, incomingTurn = null) {
		return threadDetailStatePolicy.visibleTextItemsCanShareRenderIdentity(existingItem, incomingItem, incomingTurn);
	}
	function findUnusedExistingItemIndexForIncoming(incomingItem, existingItems, usedExistingIndexes, incomingTurn = null) {
		if (!incomingItem) return -1;
		const used = usedExistingIndexes || /* @__PURE__ */ new Set();
		if (incomingItem.id) {
			const index = (existingItems || []).findIndex((existingItem, candidateIndex) => existingItem && !used.has(candidateIndex) && existingItem.id === incomingItem.id);
			if (index >= 0) return index;
		}
		if (incomingItem.type === "userMessage") {
			const index = (existingItems || []).findIndex((existingItem, candidateIndex) => existingItem && !used.has(candidateIndex) && existingItem.type === "userMessage" && userMessagesCanShadow(existingItem, incomingItem));
			if (index >= 0) return index;
		}
		if (comparableVisibleTextItem(incomingItem)) {
			const index = (existingItems || []).findIndex((existingItem, candidateIndex) => existingItem && !used.has(candidateIndex) && visibleTextItemsCanShareRenderIdentity(existingItem, incomingItem, incomingTurn));
			if (index >= 0) return index;
		}
		return -1;
	}
	function mergeIncomingOrderedItem(existingItem, incomingItem, incomingTurn = null) {
		if (!existingItem) return incomingItem;
		if (!incomingItem) return existingItem;
		if (incomingItem.type === "userMessage" && existingItem.type === "userMessage") return mergeLikelySameUserMessage(existingItem, incomingItem);
		if (visibleTextItemsCanShareRenderIdentity(existingItem, incomingItem, incomingTurn)) return mergeVisibleTextItemPreservingRenderIdentity(existingItem, incomingItem, incomingTurn);
		return mergeItemPreservingVisibleFields(existingItem, incomingItem);
	}
	function insertLocalOnlyItemByExistingOrder(merged, item, existingIndex, existingIndexToMergedIndex) {
		if (!item) return;
		let insertAt = -1;
		if (isLocalPendingSubmissionEcho(item)) {
			const itemTime = userMessageTimestampMs(item);
			if (itemTime) for (let index = 0; index < merged.length; index += 1) {
				const candidateTime = userMessageTimestampMs(merged[index]);
				if (!candidateTime) continue;
				if (candidateTime > itemTime) {
					insertAt = index;
					break;
				}
				insertAt = index + 1;
			}
		}
		for (let index = existingIndex - 1; index >= 0; index -= 1) {
			if (insertAt >= 0) break;
			if (existingIndexToMergedIndex.has(index)) {
				insertAt = existingIndexToMergedIndex.get(index) + 1;
				break;
			}
		}
		if (insertAt < 0) {
			for (const [index, mergedIndex] of existingIndexToMergedIndex.entries()) if (index > existingIndex && (insertAt < 0 || mergedIndex < insertAt)) insertAt = mergedIndex;
		}
		if (insertAt < 0 || insertAt > merged.length) insertAt = merged.length;
		merged.splice(insertAt, 0, item);
		for (const [index, mergedIndex] of existingIndexToMergedIndex.entries()) if (mergedIndex >= insertAt) existingIndexToMergedIndex.set(index, mergedIndex + 1);
		existingIndexToMergedIndex.set(existingIndex, insertAt);
	}
	function mergeItemPreservingVisibleFields(existingItem, incomingItem) {
		return threadDetailStatePolicy.mergeItemPreservingVisibleFields(existingItem, incomingItem);
	}
	function mergeVisibleTextItemPreservingRenderIdentity(existingItem, incomingItem, incomingTurn = null) {
		return threadDetailStatePolicy.mergeVisibleTextItemPreservingRenderIdentity(existingItem, incomingItem, incomingTurn);
	}
	function mergeItemsPreservingLocalVisible(existingItems, incomingItems, preserveLocalVisible = false, incomingTurn = null) {
		const added = /* @__PURE__ */ new Set();
		const usedExistingIndexes = /* @__PURE__ */ new Set();
		const existingIndexToMergedIndex = /* @__PURE__ */ new Map();
		const merged = [];
		const suppressedVisualReceiptKeys = suppressedVisualReceiptKeySet(incomingTurn);
		for (const incomingItem of incomingItems || []) {
			if (!incomingItem) continue;
			if (incomingItem.id && added.has(incomingItem.id)) continue;
			if (hasMatchingRealUserMessage(incomingItem, merged) || hasMatchingRealUserMessage(incomingItem, incomingItems)) continue;
			const existingIndex = findUnusedExistingItemIndexForIncoming(incomingItem, existingItems || [], usedExistingIndexes, incomingTurn);
			const existingItem = existingIndex >= 0 ? existingItems[existingIndex] : null;
			const mergedItem = mergeIncomingOrderedItem(existingItem, incomingItem, incomingTurn);
			merged.push(mergedItem);
			if (incomingItem.id) added.add(incomingItem.id);
			if (mergedItem && mergedItem.id) added.add(mergedItem.id);
			if (existingItem && existingItem.id) added.add(existingItem.id);
			if (existingIndex >= 0) {
				usedExistingIndexes.add(existingIndex);
				existingIndexToMergedIndex.set(existingIndex, merged.length - 1);
			}
		}
		(existingItems || []).forEach((existingItem, existingIndex) => {
			if (!existingItem || usedExistingIndexes.has(existingIndex)) return;
			if (!shouldPreserveLocalOnlyItem(existingItem, preserveLocalVisible, suppressedVisualReceiptKeys, incomingTurn)) return;
			if (existingItem.id && added.has(existingItem.id)) return;
			insertLocalOnlyItemByExistingOrder(merged, existingItem, existingIndex, existingIndexToMergedIndex);
			if (existingItem.id) added.add(existingItem.id);
		});
		return dedupeTurnUsageSummaryItems(removeShadowedMuxUserMessages(dedupeLikelySameUserMessages(merged)));
	}
	function mergeTurnPreservingVisibleItems(existingTurn, incomingTurn) {
		return threadDetailMergePolicy.mergeTurnPreservingVisibleItems(existingTurn, incomingTurn);
	}
	function shouldPreserveLiveTurnLocalVisibleItems(existingTurn, incomingTurn, existingWeight = null) {
		return threadDetailMergePolicy.shouldPreserveLiveTurnLocalVisibleItems(existingTurn, incomingTurn, existingWeight);
	}
	function mergeThreadPreservingVisibleItems(existingThread, incomingThread) {
		return threadDetailMergePolicy.mergeThreadPreservingVisibleItems(existingThread, incomingThread, { activeTurnId: state.activeTurnId });
	}
	function firstTurnTimestampMs(turn, fields = []) {
		for (const field of fields) {
			const timestamp = numericTimestampMs(turn && turn[field]);
			if (timestamp) return timestamp;
		}
		return 0;
	}
	function turnOrderMs(turn) {
		if (!turn) return 0;
		if (isTurnComplete(turn)) return firstTurnTimestampMs(turn, [
			"completedAtMs",
			"completedAt",
			"completed_at_ms",
			"completed_at",
			"updatedAtMs",
			"updatedAt",
			"updated_at_ms",
			"updated_at",
			"startedAtMs",
			"startedAt",
			"started_at_ms",
			"started_at",
			"createdAtMs",
			"createdAt",
			"created_at_ms",
			"created_at"
		]);
		return firstTurnTimestampMs(turn, [
			"startedAtMs",
			"startedAt",
			"started_at_ms",
			"started_at",
			"createdAtMs",
			"createdAt",
			"created_at_ms",
			"created_at",
			"updatedAtMs",
			"updatedAt",
			"updated_at_ms",
			"updated_at",
			"completedAtMs",
			"completedAt",
			"completed_at_ms",
			"completed_at"
		]);
	}
	function turnIsSupersededBy(turn, newerTurn) {
		if (!turn || !newerTurn || turn.id === newerTurn.id) return false;
		const left = turnOrderMs(turn);
		const right = turnOrderMs(newerTurn);
		if (left && right) return right > left;
		return isTurnComplete(newerTurn) && !isTurnComplete(turn);
	}
	const threadDetailStatePolicy = threadDetailStateApi.createThreadDetailStatePolicy({
		itemVisibleWeight,
		isContextCompactionItem,
		isOperationalItem,
		isAssistantReceiptLikeItem,
		isTurnComplete,
		isReasoningItem,
		visualReceiptMatchesSuppressionKeys,
		comparableVisibleText,
		visibleTextItemsLikelySame,
		completedReceiptItemsLikelySame
	});
	const threadListSummaryFromDetailThread = threadDetailStateApi.threadListSummaryFromDetailThread;
	const planThreadOpenCacheReuse = threadDetailStateApi.planThreadOpenCacheReuse;
	const threadHasReusableLoadedDetailState = threadDetailStateApi.threadHasReusableLoadedDetailState;
	const threadDetailV4MergePolicy = threadDetailV4MergeStateApi.createThreadDetailV4MergePolicy({
		normalizeThreadVisibleUserMessages,
		turnVisibleWeight,
		isOptimisticUserMessage,
		isRecentlySubmittedUserMessage,
		isReasoningItem,
		userMessageHasSubmissionId,
		userMessagesCanShadow,
		durableUserMessageSettlesPendingEcho: (durableItem, pendingItem, durableTurn) => Boolean(durableItem && pendingItem && durableItem.type === "userMessage" && pendingItem.type === "userMessage" && !isOptimisticUserMessage(durableItem) && optimisticEchoCanMatchEarlierDurable(durableItem, pendingItem, durableTurn)),
		isTurnComplete,
		isRunningStatus,
		isIncompleteInterruptedTurn,
		turnHasActiveLiveItems,
		turnOrderMs,
		mergeTurnPreservingVisibleItems,
		sortTurnsForDisplay,
		maxVisibleTurnsForThread
	});
	const threadDetailMergePolicy = threadDetailMergeStateApi.createThreadDetailMergePolicy({
		isV4ProjectionThread: threadDetailV4MergePolicy.isV4ProjectionThread,
		mergeV4ProjectionThread: threadDetailV4MergePolicy.mergeV4ProjectionThread,
		normalizeThreadVisibleUserMessages,
		turnVisibleWeight,
		shouldPreserveExistingTurnVisibleItems: (existingTurn, incomingTurn, existingWeight) => threadDetailStatePolicy.shouldPreserveExistingTurnVisibleItems(existingTurn, incomingTurn, existingWeight),
		mergeItemsPreservingLocalVisible,
		shouldDropInitialSubmissionEchoTurn,
		shouldPreserveMissingExistingTurn,
		turnIsSupersededBy,
		isTurnComplete,
		sortTurnsForDisplay,
		threadHasInitialSubmissionEcho,
		maxExpandedVisibleTurns: MAX_EXPANDED_VISIBLE_TURNS
	});
	return {
		threadDetailStatePolicy,
		threadDetailV4MergePolicy,
		threadDetailMergePolicy,
		threadListSummaryFromDetailThread,
		planThreadOpenCacheReuse,
		threadHasReusableLoadedDetailState,
		liveTurnHasNonUserProgress,
		isVisibleNonUserProgressItem,
		liveTurnHasNonUserProgressBefore,
		liveTurnHasNonUserProgressAfter,
		isUserVisibleTextReplyItem,
		liveTurnHasUserVisibleTextReplyAfter,
		userMessageHasVisualAttachment,
		shouldHideDurableLiveUserMessage,
		durableUserMessageMatchesOptimisticEcho,
		threadHasDurableUserMessageWithSubmissionId,
		threadHasDurableUserMessageMatchingOptimisticEcho,
		shouldHideOptimisticUserMessageEcho,
		isSupersededLiveTurn,
		shouldHideSupersededLiveUserMessage,
		isRawThreadReadMode,
		shouldPreserveRawThreadVisibleEntry,
		itemTextValue,
		reasoningItemHasVisibleText,
		isLatestCompletedProcessTurn,
		limitRawThreadVisibleEntries,
		visibleItemsForTurn,
		currentLiveOperationEntry,
		liveTurnStatusDockItem,
		visibleItemSignature,
		visibleItemBudgetForTurn,
		visibleItemBudgetSignature,
		inputContentSignature,
		imageSourceSignature,
		compactStructuredForSignature,
		itemVisibleWeight,
		turnVisibleWeight,
		isAssistantReceiptLikeItem,
		completedIncomingTurnHasAuthoritativeReceipt,
		shouldDropLocalOnlyReceiptForIncomingTurn,
		shouldPreserveLocalOnlyItem,
		isMuxUserMessage,
		isOptimisticUserMessage,
		userMessageSubmissionIdCandidates,
		userMessageHasSubmissionId,
		userMessagesShareSubmissionId,
		isTurnUsageSummaryItem,
		isTurnDiagnosticItem,
		dedupeTurnUsageSummaryItems,
		normalizeComparableText,
		userMessageComparableParts,
		userMessagePathOverlap,
		comparablePathName,
		userMessagePathNameOverlap,
		comparablePathNamesLikelySame,
		isVisualReceiptItem,
		visualReceiptComparableNames,
		visualReceiptCallId,
		visualReceiptSuppressionKeys,
		suppressedVisualReceiptKeySet,
		visualReceiptMatchesSuppressionKeys,
		userMessageSpecificity,
		userMessagesLikelySame,
		userMessagesCanShadow,
		userMessagesAreSameTurnDuplicateEvent,
		userMessageTimestampMs,
		userMessagesHaveNearbyTimestamps,
		isProjectionIndexUserMessage,
		userMessagesAreSameEventAcrossTurns,
		durableTurnCanReceivePendingEcho,
		optimisticEchoCanMatchEarlierDurable,
		hasMatchingIncomingUserMessage,
		hasMatchingRealUserMessage,
		removeShadowedMuxUserMessages,
		userMessageShadowPriority,
		mergeLikelySameUserMessage,
		dedupeLikelySameUserMessages,
		normalizeThreadVisibleUserMessages,
		threadUserMessageEntries,
		shouldDropOptimisticUserMessageForDurable,
		shouldDropOptimisticUserMessageForHigherPriorityEcho,
		shouldDropDuplicateUserMessageEvent,
		threadDurableUserMessages,
		shouldDropInitialSubmissionEchoTurn,
		threadHasInitialSubmissionEcho,
		comparableVisibleTextItem,
		comparableVisibleText,
		visibleTextItemsLikelySame,
		visibleTextItemsHaveStableSharedPrefix,
		completedReceiptItemsLikelySame,
		visibleTextItemsCanShareRenderIdentity,
		findUnusedExistingItemIndexForIncoming,
		mergeIncomingOrderedItem,
		insertLocalOnlyItemByExistingOrder,
		mergeItemPreservingVisibleFields,
		mergeVisibleTextItemPreservingRenderIdentity,
		mergeItemsPreservingLocalVisible,
		mergeTurnPreservingVisibleItems,
		shouldPreserveLiveTurnLocalVisibleItems,
		mergeThreadPreservingVisibleItems,
		turnOrderMs,
		turnIsSupersededBy
	};
}
var threadDetailRuntimeApi = Object.freeze({ createThreadDetailRuntime });
var threadDetailRuntimeRoot = typeof globalThis !== "undefined" ? globalThis : window;
threadDetailRuntimeRoot.CodexThreadDetailRuntime = threadDetailRuntimeApi;
//#endregion
//#region \0virtual:codex-mobile-esm-compatibility/shard/shard-09
var moduleDefinitions = [
	{
		"id": "api-client-runtime",
		"source": "public/api-client-runtime.js",
		"nativeSource": "frontend/native/api-client-runtime.mjs",
		"globalName": "CodexApiClientRuntime",
		"expectedFunctions": ["createApiClientRuntime"],
		"assetPath": "/api-client-runtime.js",
		"importSource": "frontend/native/api-client-runtime.mjs",
		"compatibilityMode": "native-esm",
		"classicLoaderExcluded": true,
		"bytes": 71592
	},
	{
		"id": "thread-list-load-policy",
		"source": "public/thread-list-load-policy.js",
		"nativeSource": "frontend/native/thread-list-load-policy.mjs",
		"globalName": "CodexThreadListLoadPolicy",
		"expectedFunctions": ["planThreadListLoadRequest"],
		"assetPath": "/thread-list-load-policy.js",
		"importSource": "frontend/native/thread-list-load-policy.mjs",
		"compatibilityMode": "native-esm",
		"classicLoaderExcluded": true,
		"bytes": 2160
	},
	{
		"id": "thread-list-stable-order",
		"source": "public/thread-list-stable-order.js",
		"nativeSource": "frontend/native/thread-list-stable-order.mjs",
		"globalName": "CodexThreadListStableOrder",
		"expectedFunctions": ["threadListOrderScopeKey", "planThreadListStableOrder"],
		"assetPath": "/thread-list-stable-order.js",
		"importSource": "frontend/native/thread-list-stable-order.mjs",
		"compatibilityMode": "native-esm",
		"classicLoaderExcluded": true,
		"bytes": 5110
	},
	{
		"id": "thread-status-hints",
		"source": "public/thread-status-hints.js",
		"nativeSource": "frontend/native/thread-status-hints.mjs",
		"globalName": "CodexThreadStatusHints",
		"expectedFunctions": [
			"isRunningStatus",
			"shouldExpireRunningThreadHint",
			"shouldMarkThreadUnread"
		],
		"assetPath": "/thread-status-hints.js",
		"importSource": "frontend/native/thread-status-hints.mjs",
		"compatibilityMode": "native-esm",
		"classicLoaderExcluded": true,
		"bytes": 10655
	},
	{
		"id": "thread-detail-patch-plan",
		"source": "public/thread-detail-patch-plan.js",
		"nativeSource": "frontend/native/thread-detail-patch-plan.mjs",
		"globalName": "CodexThreadDetailPatchPlan",
		"expectedFunctions": [
			"planThreadDetailDomPatchSurface",
			"planThreadDetailRefreshDomPatch",
			"planVisibleItemRefreshPatch"
		],
		"assetPath": "/thread-detail-patch-plan.js",
		"importSource": "frontend/native/thread-detail-patch-plan.mjs",
		"compatibilityMode": "native-esm",
		"classicLoaderExcluded": true,
		"bytes": 9589
	},
	{
		"id": "thread-detail-actions",
		"source": "public/thread-detail-actions.js",
		"nativeSource": "frontend/native/thread-detail-actions.mjs",
		"globalName": "CodexThreadDetailActions",
		"expectedFunctions": [
			"closestWithin",
			"contextThreadIdFromNode",
			"previewableImageFromTarget",
			"resolveRichContentClickAction",
			"resolveThreadDetailClickAction"
		],
		"assetPath": "/thread-detail-actions.js",
		"importSource": "frontend/native/thread-detail-actions.mjs",
		"compatibilityMode": "native-esm",
		"classicLoaderExcluded": true,
		"bytes": 5362
	},
	{
		"id": "thread-detail-merge-state",
		"source": "public/thread-detail-merge-state.js",
		"nativeSource": "frontend/native/thread-detail-merge-state.mjs",
		"globalName": "CodexThreadDetailMergeState",
		"expectedFunctions": ["createThreadDetailMergePolicy"],
		"assetPath": "/thread-detail-merge-state.js",
		"importSource": "frontend/native/thread-detail-merge-state.mjs",
		"compatibilityMode": "native-esm",
		"classicLoaderExcluded": true,
		"bytes": 8461
	},
	{
		"id": "thread-detail-v4-merge-state",
		"source": "public/thread-detail-v4-merge-state.js",
		"nativeSource": "frontend/native/thread-detail-v4-merge-state.mjs",
		"globalName": "CodexThreadDetailV4MergeState",
		"expectedFunctions": ["createThreadDetailV4MergePolicy"],
		"assetPath": "/thread-detail-v4-merge-state.js",
		"importSource": "frontend/native/thread-detail-v4-merge-state.mjs",
		"compatibilityMode": "native-esm",
		"classicLoaderExcluded": true,
		"bytes": 20491
	},
	{
		"id": "thread-detail-runtime",
		"source": "public/thread-detail-runtime.js",
		"nativeSource": "frontend/native/thread-detail-runtime.mjs",
		"globalName": "CodexThreadDetailRuntime",
		"expectedFunctions": ["createThreadDetailRuntime"],
		"assetPath": "/thread-detail-runtime.js",
		"importSource": "frontend/native/thread-detail-runtime.mjs",
		"compatibilityMode": "native-esm",
		"classicLoaderExcluded": true,
		"bytes": 63252
	}
];
var moduleApis = {
	"api-client-runtime": apiClientRuntimeApi,
	"thread-list-load-policy": thread_list_load_policy_default,
	"thread-list-stable-order": api$5,
	"thread-status-hints": api$4,
	"thread-detail-patch-plan": api$3,
	"thread-detail-actions": api$2,
	"thread-detail-merge-state": api$1,
	"thread-detail-v4-merge-state": api,
	"thread-detail-runtime": threadDetailRuntimeApi
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
