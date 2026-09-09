"use strict";

let voxsparkSurfaceHostRuntime = null;
let voxsparkLexiconRuntime = null;

const root = typeof globalThis !== "undefined" ? globalThis : window;

function initializeThreadDetailRuntimeWiring() {
  if (threadDetailRuntime) return threadDetailRuntime;
  threadDetailRuntime = threadDetailRuntimeApi.createThreadDetailRuntime({
    state,
    MAX_EXPANDED_VISIBLE_TURNS,
    MAX_RAW_THREAD_VISIBLE_ITEMS_PER_TURN,
    threadDetailStateApi,
    threadDetailMergeStateApi,
    threadDetailV4MergeStateApi,
    statusText,
    normalizeFsPath,
    imageUrlValue,
    isInputTextPart,
    inputTextValue,
    isInputImagePart,
    splitAttachmentSummaryText,
    canRenderImageAttachment,
    truncateMiddle,
    isLiveTurn,
    isLatestTurn,
    latestTurnForThread,
    isLiveTurnForThread,
    isActiveOperationalItem,
    isReasoningItem,
    isOperationalItem,
    isContextCompactionItem,
    contextCompactionNotice,
    operationCommandText,
    operationDetailText,
    imageViewPath,
    imageViewContentUrl,
    imageViewUrl,
    isTurnComplete,
    isRunningStatus,
    isIncompleteInterruptedTurn,
    turnHasActiveLiveItems,
    isRecentlySubmittedUserMessage,
    sortTurnsForDisplay,
    maxVisibleTurnsForThread,
    numericTimestampMs,
    renderContextThread,
  });
  exposeThreadDetailRuntimeHelpers(threadDetailRuntime);
  return threadDetailRuntime;
}

function exposeThreadDetailRuntimeHelpers(runtime) {
  if (!runtime || typeof runtime !== "object") return;
  [
    "userMessagesAreSameTurnDuplicateEvent",
    "mergeLikelySameUserMessage",
    "normalizeThreadVisibleUserMessages",
    "visibleTextItemsLikelySame",
    "isTurnUsageSummaryItem",
    "mergeItemPreservingVisibleFields",
  ].forEach((name) => {
    if (typeof runtime[name] === "function") root[name] = runtime[name];
  });
}

function initializeComposerRuntimeWiring() {
  if (composerRuntime) return composerRuntime;
  composerRuntime = composerRuntimeApi.createComposerRuntime({
    $,
    COMPOSER_INTENT_BODY_MAX_CHARS,
    MESSAGE_INPUT_MAX_HEIGHT_PX,
    MESSAGE_INPUT_MIN_HEIGHT_PX,
    STORAGE_CODEX_FAST_MODE,
    STORAGE_COMPOSER_INTENT_DRAFTS,
    THREAD_GOAL_MENTION_PATTERN,
    THREAD_TASK_CARD_AUTONOMOUS_MENTION_PATTERN,
    THREAD_TASK_CARD_MENTION_PATTERN,
    api,
    clearDraftForKey,
    clearSubmittedMessageBottomFollow,
    closeThreadGoalDialog,
    commitPluginVoiceInputSessionsAfterSend,
    composerTargetThread,
    composerTargetActiveTurnId,
    connectEvents,
    createSubmissionId,
    currentComposerThreadId,
    currentDraftKey,
    defaultNewThreadEffort,
    defaultNewThreadModel,
    defaultNewThreadPermissionMode,
    deleteDraftAttachments,
    diagnosticErrorCode,
    diagnosticErrorStatus,
    diagnosticTaskHash,
    diagnosticThreadHash,
    diagnosticTurnHash,
    document,
    draftKeyForThread,
    effectiveComposerPermissionMode,
    escapeHtml,
    followSubmittedMessageToBottom,
    homeAiDiagnosticReportingApi,
    imageCompressor,
    insertLocalSubmittedUserMessage,
    isAndroidBrowser,
    isChatGptProCommandText,
    isHermesEmbedMode,
    isKeyboardEditableElement,
    isThreadGoalCommandText,
    isThreadTaskCardCommandText,
    isThreadTileComposerContext,
    labelForEffort,
    labelForModel,
    labelForPermissionMode,
    loadJsonStorage,
    loadThread,
    loadThreads,
    localAttachmentPreviewUrl,
    localStorage,
    markActivity,
    markSubmittedUserMessageFailed,
    markThreadOptimisticallyActive,
    mergeItemsPreservingLocalVisible,
    newThreadSelectedEffort,
    newThreadSelectedModel,
    newThreadSelectedPermissionMode,
    normalizeOptionList,
    normalizeThreadGoal,
    onComposerSubmitted: (submission) => (
      voxsparkSurfaceHostRuntime
      && voxsparkSurfaceHostRuntime.handleComposerSubmission(submission)
    ),
    openThreadGoalDialog,
    postClientEvent,
    publishPluginVoiceInputCapability,
    reconcileSubmittedUserMessageTurn,
    recordHomeAiDiagnosticFailure,
    recordSubmittedEchoDiagnosticLog,
    renderCurrentThread,
    renderQuotaUsage,
    renderThreads,
    replacePendingAttachments,
    restoreThreadStatusSnapshot,
    saveCurrentDraftNow,
    saveDraftAttachmentFiles,
    scheduleComposerTargetRefresh,
    scheduleCurrentDraftSave,
    scheduleCurrentThreadRefresh,
    scheduleLivePollIfNeeded,
    schedulePostCompletionThreadRefreshes,
    scheduleScrollToBottomButtonUpdate,
    scheduleSubmittedMessageDomProbe,
    scheduleUsageBackfillRefresh,
    selectedQuotaModel,
    setComposerActionButtonLabel,
    setSteerFeedback,
    setThreadGoalDialogBusy,
    showComposerFastHint,
    showError,
    snapshotThreadStatus,
    startedTurnId,
    state,
    submitChatGptProRequest,
    submittedThreadGoal,
    threadDisplayName,
    threadTaskCardCommandText,
    threadTileStatePolicy,
    updateThreadGoalState,
    viewportMetrics,
    viewportState,
    window,
    writeCurrentDraftToKey,
  });
  return composerRuntime;
}

function initializeVoxSparkSurfaceHostRuntimeWiring() {
  if (voxsparkSurfaceHostRuntime) return voxsparkSurfaceHostRuntime;
  const surfaceHostApi = window.CodexVoxSparkSurfaceHostRuntime;
  if (!surfaceHostApi || typeof surfaceHostApi.createVoxSparkSurfaceHostRuntime !== "function") return null;
  const composer = initializeComposerRuntimeWiring();
  voxsparkSurfaceHostRuntime = surfaceHostApi.createVoxSparkSurfaceHostRuntime({
    document,
    window,
    location: window.location,
    localStorage,
    relay: (payload, options = {}) => api("/api/voxspark/surface/context", {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
      timeoutMs: 4000,
    }),
    captureRequest: (operation, payload) => api(`/api/voxspark/surface/capture/${operation}`, {
      method: "POST", body: JSON.stringify(payload), timeoutMs: 5000,
    }).catch(error => {
      if (error?.responseBody?.ok === false) return error.responseBody;
      throw error;
    }),
    queueRequest: (operation, payload) => api(`/api/voxspark/surface/queue/${operation}`, {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: operation === "complete" ? 10000 : 4000,
    }),
    $,
    currentComposerThreadId,
    composerTargetThread,
    composerTargetActiveTurnId,
    composerText: composer.composerText,
    setComposerText: composer.setComposerText,
    insertComposerText: composer.insertComposerText,
    sendMessage: composer.sendMessage,
    sendDraft: composer.sendVoxSparkDraft,
    interruptActiveTurn: composer.interruptActiveTurn,
    scheduleCurrentDraftSave,
    threadTitle: (thread) => threadDisplayName(thread),
    threadWorkspace: (thread) => basenameForFsPath(thread && thread.cwd || ""),
    approvalPending: (threadId, turnId) => Boolean(
      threadId
      && turnId
      && approvalsForTurn(threadId, turnId).some((request) => isApprovalActive(request))
    ),
    report: (code, detail) => postClientEvent("voxspark_surface_host", {
      code: String(code || "unknown").slice(0, 80),
      syncId: String(detail && detail.syncId || "").slice(0, 96),
      surfaceRevision: Number.isInteger(detail && detail.surfaceRevision) ? detail.surfaceRevision : 0,
      bridgeContextRevision: Number.isInteger(detail && detail.bridgeContextRevision) ? detail.bridgeContextRevision : 0,
      clientAt: Number.isFinite(detail && detail.clientAt) ? detail.clientAt : 0,
      relayMs: Number.isFinite(detail && detail.relayMs) ? Math.max(0, detail.relayMs) : 0,
      requestStartedAt: Number.isFinite(detail && detail.requestStartedAt) ? detail.requestStartedAt : 0,
      acknowledgedCount: Number.isInteger(detail && detail.acknowledgedCount) ? detail.acknowledgedCount : 0,
      errorKind: ["timeout", "cancelled", "request_failed", "processing_failed"].includes(detail && detail.errorKind) ? detail.errorKind : "",
      reason: ["context_mismatch", "not_focused"].includes(detail && detail.reason) ? detail.reason : "",
      action: String(detail && detail.action || "").slice(0, 24),
      outcome: String(detail && detail.outcome || "").slice(0, 24),
      captureId: String(detail && detail.captureId || "").slice(0, 96),
      actionId: String(detail && detail.actionId || "").slice(0, 96),
      commandSequence: Number.isInteger(detail && detail.commandSequence)
        ? detail.commandSequence
        : 0,
    }),
  });
  voxsparkSurfaceHostRuntime.start();
  window.voxsparkSurfaceHostRuntime = voxsparkSurfaceHostRuntime;
  return voxsparkSurfaceHostRuntime;
}

function initializeThreadListRuntimeWiring() {
  if (threadListRuntime) return threadListRuntime;
  threadListRuntime = window.CodexThreadListRuntime.createThreadListRuntime({
    state,
    $,
    api,
    document,
    window,
    localStorage,
    setTimeout,
    clearTimeout,
    THREAD_LIST_PAGE_LIMIT,
    THREAD_LIST_DEFERRED_FALLBACK_DELAY_MS,
    THREAD_LIST_DEFERRED_FALLBACK_RETRY_MS,
    THREAD_LIST_SLOW_PATH_MS,
    STORAGE_THREAD_ID,
    normalizeFsPath,
    escapeHtml,
    shortPath,
    isMobileViewport,
    tokenCountValue,
    formatTokenMillion,
    displayInputTokensExcludingCached,
    saveCurrentDraftNow,
    flushSideChatDraftNow,
    resetComposerRuntimeSelection,
    abortCurrentThreadRefresh,
    clearRecentCompletedReplyAnchor,
    clearConversationAutoScrollHold,
    setComposerText,
    replacePendingAttachments,
    syncActiveTurnFromThread,
    connectEvents,
    threadListLoadPolicy,
    nowPerfMs,
    roundedDurationMs,
    threadListSummaryFromDetailThread,
    threadListStableOrderPolicy,
    reconcileThreadStatusHints,
    renderCurrentThread,
    threadTileLayout,
    isThreadTileKeyboardFocusActive,
    threadTileCandidateIds,
    threadTileIdsEqual,
    restoreConnectionState,
    scheduleVisiblePageRefreshCheck,
    threadPerformanceMetrics,
    postPerformanceEvent,
    diagnosticDurationBucket,
    recordHomeAiDiagnosticFailure,
    recordHomeAiDiagnosticSuccess,
    threadDiagnosticEventsApi,
    renderThreadLoadError,
    diagnosticErrorCode,
    diagnosticErrorStatus,
    showError,
    visibleWorkspaceKeys,
    codexWorktreeRepoName,
    basenameForFsPath,
    visibleWorkspaceNames,
    statusText,
    threadUpdatedAtMs,
    scheduleRenderCurrentThread,
    threadTilePaneIsVisible,
    scheduleRenderThreadTilePane,
    updateThreadStatusHints,
    normalizeThreadGoal,
    updateThreadGoalDialogState,
    draftStore,
    readDraftMap,
    draftHasContent,
    restoreDraftForCurrentTarget,
    updateComposerControls,
    showHermesPluginPrimaryPage,
    isHermesEmbedMode,
    loadThread,
    isRunningStatus,
    rolloutSizeText,
    isRolloutOverThreshold,
    formatAbsoluteTime,
    formatTime,
    statusIconHtml,
    statusIconInfo,
    threadGoalForThread,
    renderThreadGoalBadge,
    handleThreadCardClick,
    threadGoalSignature,
    rolloutSizeBytes,
  });
  return threadListRuntime;
}

function initializeThreadTileRuntimeWiring() {
  if (threadTileRuntime) return threadTileRuntime;
  threadTileRuntime = threadTileRuntimeApi.createThreadTileRuntime({
    state,
    $,
    api,
    document,
    window,
    localStorage,
    setTimeout,
    clearTimeout,
    AbortController,
    THREAD_TILE_USER_MAX_PANES,
    THREAD_TILE_DETAIL_LOAD_QUEUE_DRAIN_MS,
    THREAD_TILE_REFRESH_INTERVAL_MS,
    THREAD_TILE_REFRESH_MIN_INTERVAL_MS,
    THREAD_TILE_SETTINGS_SAVE_DEBOUNCE_MS,
    STORAGE_THREAD_DISPLAY_MODE,
    STORAGE_LEGACY_THREAD_TILE_MODE,
    LIVE_OPERATION_BUBBLE_MIN_VISIBLE_MS,
    threadTileActionsApi,
    threadTileStatePolicy,
    threadTileLayoutPolicy,
    threadDetailPatchPlanApi,
    isKeyboardEditableElement,
    splitPaneSidebarVisible,
    isMenuOverlayMode,
    visibleThreads,
    isRunningStatus,
    saveCurrentDraftNow,
    restoreDraftForCurrentTarget,
    renderComposerSettings,
    updateComposerControls,
    scheduleRenderCurrentThread,
    renderCurrentThread,
    showError,
    threadById,
    threadDisplayName,
    shortPath,
    formatTime,
    statusIconHtml,
    threadDetailApiPath,
    mergeThreadPreservingVisibleItems,
    mergeThreadIntoThreadList,
    withRenderContextThread,
    visibleItemsForTurn,
    renderVisibleItemPatchHtml,
    renderTurnVisibleItemBudgetNotice,
    approvalsForTurn,
    renderApprovalRequest,
    approvalTurnId,
    isApprovalActive,
    currentLiveOperationEntry,
    latestLiveTurnForThread,
    renderMobileOperationStack,
    visibleItemSignature,
    threadTitleForDisplay,
    turnTimerStateHtml,
    threadTilePaneTimerState,
    threadHasVisibleConversationTurns,
    threadReadWarningMessage,
    visibleTurnsForConversation,
    renderThreadHistoryNote,
    renderPendingApprovals,
    effectiveThreadTileSelectedThreadId,
    conversationRenderSignature,
    existingConversationRenderKeys,
    patchNode,
    hydrateThreadDetailSurface,
    clearGlobalLiveOperationDockForThreadTiles,
    updateConversationHtml,
    threadTileVisibleShape,
    threadTileDomTurnCount,
    conversationDomShape,
    diagnosticHash,
    publishPluginNavigationState,
    escapeHtml,
  });
  return threadTileRuntime;
}

function initializeVoxSparkLexiconRuntimeWiring() {
  if (voxsparkLexiconRuntime) return voxsparkLexiconRuntime;
  const factory = window.CodexVoxSparkLexiconRuntime?.createVoxSparkLexiconRuntime;
  if (!factory) return null;
  voxsparkLexiconRuntime = factory({ document, $,
    request: (action, payload) => api("/api/voxspark/lexicon", action === "list"
      ? { method: "GET", timeoutMs: 6000 }
      : { method: "POST", body: JSON.stringify({ ...payload, action }), timeoutMs: 6000 })
      .catch(error => {
        if (error?.responseBody?.ok === false) return error.responseBody;
        throw error;
      }),
  });
  voxsparkLexiconRuntime?.initialize();
  return voxsparkLexiconRuntime;
}

function initializeCodexMobileRuntimeWiring() {
  initializeThreadDetailRuntimeWiring();
  initializeComposerRuntimeWiring();
  initializeVoxSparkSurfaceHostRuntimeWiring();
  initializeVoxSparkLexiconRuntimeWiring();
  initializeThreadListRuntimeWiring();
  initializeThreadTileRuntimeWiring();
}

function createRuntimeWiringRuntime() {
  return { initialize: initializeCodexMobileRuntimeWiring };
}

const runtimeWiringApi = { createRuntimeWiringRuntime };
root.CodexRuntimeWiringRuntime = runtimeWiringApi;

export {
  createRuntimeWiringRuntime,
};

export default runtimeWiringApi;
