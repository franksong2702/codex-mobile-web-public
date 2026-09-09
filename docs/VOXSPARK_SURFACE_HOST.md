# VoxSpark Surface Host Adapter

Status: implemented source contract. Current capability, deployment and acceptance limits: [baseline](VOXSPARK_BASELINE.md).

## Boundary

Codex Mobile's persistent Node listener owns the Bridge `/host` WebSocket. The
browser owns only the selected Session, Composer draft UI, and existing
Send/Steer/Stop implementations. It renews a bounded target lease through an
authenticated same-origin API and receives pending Bridge commands in the same
exchange. VoxSpark Bridge remains a separate process and repository.

The backend connects to `voxspark.surface.v1alpha1` at WebSocket `/host`. The
browser sends compact Session title/workspace metadata, selected Composer
target, turn state, and approval presence to the authenticated backend route.
It does not send Session bodies, repository content, credentials, or approval
decisions to BOX.

The default cloud-polish path remains transcript plus bounded terms. Rich
polish context is enabled only when the listener is started with
`CODEX_MOBILE_VOXSPARK_POLISH_CONTEXT=bounded-context-v1`. In that mode the
browser sends at most six recent visible user/assistant messages, a bounded
Composer draft, an inferred Session profile, the simplified-Chinese
mixed-language policy, and explicitly accepted correction rules. Command and
tool output items are excluded. The persistent Host validates the same bounds
before forwarding the envelope to Bridge.

The browser target lease expires after 30 seconds without renewal. Expiry sends
an unfocused context to Bridge and clears pending hardware commands, while the
backend keeps the Host connection alive. Rebinding requires the same browser to
publish a current Session and a new backend context revision. Bridge URLs are
restricted to an exact credential-free loopback `ws://.../host` endpoint.

A context or surface revision update from the same browser and Session preserves
pending hardware commands and rebinds them to the new surface revision. A real
browser ownership change does not transfer commands to that browser. A Session
switch retains commands under the original Session and delivers them again only
when that Session owns the Surface. This keeps normal active-turn refreshes and
navigation from racing the browser relay poll and silently dropping a newly
queued Send, Steer, or Queue command.

Composer replacement and Host action commands retain the originating bounded
`capture_id`. Actions additionally carry a deterministic `action_id`, while the
backend's monotonically increasing command sequence remains the delivery-order
coordinate. Backend and browser diagnostics log only these ids, action type,
outcome, and sequence; they never log transcript text or Composer contents.

## Activation

The adapter starts when a credential-free Host endpoint is provided by one of
these sources:

- deployment variable `CODEX_MOBILE_VOXSPARK_BRIDGE_URL`;
- query parameter `voxsparkBridge`;
- local storage key `codex_mobile_voxspark_bridge_url`.

The deployment variable is the normal installation path and lets users open a
clean Codex Mobile URL. Query and local-storage values remain diagnostic
overrides. The persistent backend validates the deployment value as an exact
loopback `ws://.../host` endpoint before publishing it to the browser. Missing
or invalid deployment configuration leaves the adapter disabled. Once
activated, the backend owns reconnects independently of browser WebSocket
lifecycle. An unavailable Bridge or BOX does not disable the normal Composer.
An individual Host connection attempt is bounded to five seconds. A socket
that remains stuck in `CONNECTING`, or emits an error without a close event, is
discarded before the normal reconnect loop continues.
Pairing and transport authentication remain outside this pilot.

`CODEX_MOBILE_VOXSPARK_POLISH_CONTEXT` is independent from Bridge activation.
An absent or incorrect value omits `polish_context`; it does not disable BOX
input or the existing bounded `local_context.terms` path.

R3 Queue durability also requires one 256-bit encryption key in the current
macOS user's Keychain. Check or create it with:

```bash
bash scripts/macos/provision-voxspark-queue-key.sh --check
bash scripts/macos/provision-voxspark-queue-key.sh --apply
```

The apply command is an operator action and is not run by a source build. If
the key is missing, wrong, or the encrypted file cannot be authenticated,
Queue fails closed before accepting new text. Send, Steer, Composer input, and
the ordinary Host relay remain available. Repair requires preserving the
unreadable file for diagnosis and restarting the Mobile listener only after a
separate deployment authorization.

## Dictation insertion position

The insertion position is the current valid Composer selection at final
writeback, not a capture-start position. Moving the caret while recognition is
running changes that position. Switching Session continues to hold the result
for its original Session. Interior insertions do not feed the append-only
correction-learning heuristic; they cannot propose a correction by comparing
the surrounding document against the voice segment.

## Actions

- `host.composer.replace` writes one finalized draft into the currently focused
  Composer at its valid selection when the final result arrives. A collapsed
  caret inserts there; a non-collapsed selection inserts after the selection
  without deleting it. With no editor selection, insertion goes to the end.
  The original surrounding paragraphs remain intact and the focused caret ends
  immediately after the inserted text. IME composition or a disabled editor
  retries delivery without acknowledging an insertion. Session/revision guards
  still run before editor mutation. Interim transcripts are not accepted by
  this adapter. The next
  Host context reports exact `composer.ownership` and `composer.draft_revision`
  as the Bridge-visible application receipt.
- `submit` reuses Codex Mobile `sendMessage` only when the Session is idle.
- `steer` reuses `sendMessage` only while the selected Session has an active
  turn, preserving the existing Codex steering path.
- `queue` transfers the complete authoritative Composer to the Mobile backend
  before the browser releases its local draft. The backend encrypts the body
  with AES-256-GCM, persists it atomically with mode `0600`, and returns only
  content-free Queue metadata to Bridge and BOX. A browser for the same active
  Session claims a 30-second lease after the turn becomes idle and submits the
  stored body with a stable `clientSubmissionId`. Browser refresh may replace
  the executor; it does not replace the Session owner or duplicate the Queue.
- Queue lifecycle is `queued -> leased -> submitted -> processing ->
  completed`. Failure and explicit uncertainty retain the encrypted body for
  diagnosis; successful Codex submission removes the body immediately. A
  restored `leased` or `submitted` entry becomes `unknown` instead of being
  replayed blindly. A following Queue waits until the previous entry reaches a
  terminal state.
- `stop` reuses `interruptActiveTurn`; the two-touch confirmation remains owned
  by VoxSpark Bridge/BOX.

A Session switch hides unsent VoxSpark drafts from the other Session. A
Composer command that loses a race with navigation remains pending instead of
being acknowledged as discarded; returning to its original Session rebinds it
to the new surface revision before Send can run. Approval state only blocks
hardware actions and tells BOX to hand control back to the computer.

Within the same Session, the currently visible non-empty Composer is the
authoritative text for BOX Send, Steer, and Queue. Keyboard edits made after a
voice draft arrives are retained rather than rejected as a changed Composer.
If the user clears the Composer, the empty value is authoritative and Queue is
rejected instead of resurrecting the older in-memory voice draft.
The original capture id, draft revision, Session ownership, approval, and turn
state gates still apply. Once an action is forwarded, BOX leaves draft actions
for processing. Host success clears the matching draft, explicit failure
restores its controls, and `unknown` retains the draft but blocks blind replay
until a terminal result or later reconciliation.

Host actions execute asynchronously from context publication. While a slow
Send is running, navigation immediately publishes the newly selected Session.
The browser explicitly acknowledges each processed command sequence instead of
advancing one global read cursor, so acknowledging Session B cannot remove a
pending Session A command. The persistent backend separately accepts and
replays action results until Bridge acknowledges each `action_id`.

After a successful Send, Codex Mobile normally blurs the Composer. The adapter
keeps the selected Composer target armed without restoring DOM focus or opening
the software keyboard, so a second hardware draft can still arrive. The
Composer target shown by Codex Mobile is authoritative; a Session switch
rebinds the hardware to the new target. If the browser stops renewing its
lease, hardware capture is disarmed until the page resumes.

The contract field `composer.focused` represents logical hardware-input
ownership, not literal DOM or macOS application focus. After a refresh, an
active foreground Codex Mobile page automatically binds its current Session.
Navigating to another Session on that same active page moves the binding
without requiring a second click inside the Composer. Switching from that
already-bound browser to ChatGPT keeps the target lease, while a page that was
never foreground cannot claim the BOX. A hidden tab still releases ownership;
when another Codex Mobile window enters the foreground its newer `armed_at`
wins the backend arbitration.

## Session publication latency

The navigation owner publishes after the selected Session and its Composer draft
are committed together, before conversation rendering. The 500ms heartbeat still
renews the lease and fetches commands; it is no longer the only notification
when the Composer target changes. The 3000ms navigation-intent guard remains a
safety window, not an intentional delay. Passive Session changes do not acquire
hardware ownership.

A newer target (Session or title) aborts the previous browser HTTP wait and
starts its own relay immediately. Each response belongs to its request object:
late results from an aborted request or previous lifecycle cannot update the
service epoch, connection state, queue snapshot or Composer. Same-target polling
continues to coalesce behind its current request.

Aborting HTTP does not undo a POST already sent. The persistent Host therefore
keeps a bounded per-browser surface-revision high-water mark and rejects older
revisions before updating the target, Bridge URL, or command/draft receipts.
Using an equal revision for another Session is rejected. Same-revision Composer
receipts remain valid for the same Session. Server restart begins a new service
epoch; browser identity/revision renewal and command receipts retain their
existing contract.

Content-free diagnostics correlate `sync_id`, surface revision and backend
context revision with browser request start/completion and relay duration. These
measure HTTP publication, not physical BOX screen painting. Network/connection
queueing and browser long tasks remain possible sources of additional latency.

Validation: 2754 tests passed, including classic/native-ESM Chromium fixtures.
A real loopback HTTP test holds an old request before publication, observes the
new Session arriving first, then releases the old request and confirms rejection.
The tests also cover response reordering, lifecycle stop/start, current-command
receipt protection, and committed-draft notification before render. This is not
a claim of measured physical-device switch latency.

## Phase B — Bridge-owned voice status (2026-09-09)

The Host accepts the independent `bridge.voice.state` / schema 1 snapshot from
Bridge. The protocol owner is VoxSpark `docs/03-interface-contract.md`; existing
BOX `bridge.state`, final-only Composer commands and action receipts remain their
own contracts. Snapshots contain epoch/sequence, BOX connection count, target
Session/revision and bounded per-Session capture metadata. They contain no audio,
transcript, Composer body, context terms or provider payload.

`services/runtime/voxspark-voice-state.js` allowlists fields and validates the
entire snapshot (maximum 64 captures). The service caches only current in-memory
metadata. Sequence must increase within the connected Bridge epoch; reconnect
clears the cache and accepts the new connection's full snapshot. A replaced
socket cannot publish late messages. This state is never persisted in Queue or
the transaction ledger.

The existing browser context response includes `voice: { reason, snapshot }`.
Readiness requires a connected Bridge, known snapshot, a live Composer lease,
a matching Bridge target Session/context revision, available Composer and at
least one connected BOX. Unknown status is explicitly unavailable rather than
reported as disconnected hardware. The authenticated status endpoint exposes the
same metadata. This is transport readiness, not microphone/firmware acceptance.

The existing 500 ms Host poll drives a compact row in the Composer's normal
layout. It shows the active recording's owning Session, actual stage and
Bridge-measured duration across Session switches. Other Sessions' active work
is explicitly labelled with its destination; an independent current Session
draft has a separate status detail. Without active work it shows current draft
status or BOX readiness/unavailable reason. `recording`, `transcribing`, `polishing`,
`waitingComposer`, `ready`, and `failed` are factual stages. Short captures that
bypass Luna never display a guessed polishing stage. Missing successful relay
responses for 3 seconds replace progress with a reconnect label; the browser
does not extrapolate provider progress or completion. The row has no controls,
never focuses the input and does not change the draft or Selection.

### Global BOX awareness after Session switches (2026-09-09)

An active BOX recording is visible in every Session and takes priority over older
processing/drafts. The displayed destination uses capture `session_title` (max 80,
nullable, additive schema 1), captured at recording start, rather than the current
Host target. Transcribing, polishing and waiting for Composer remain visible
for their owning Session while viewing another Session. An independent current
Session draft keeps a separate status detail; a ready draft from another Session
is not shown as delivered to the current one. Older Bridge snapshots without a
capture title use the target title only for matching Session ids; otherwise the
UI identifies another Session without guessing its name. Focus, caret, draft
commands and capture routing are unchanged.


## C1 Queue 管理与转为引导（2026-09-09）

当前有效client/session的浏览器轮询返回队列完整text，
页面默认展开安全正文；Session切换/停止立即清除旧内容。Bridge queueContext仍只含
元数据。inspect兼容端点保留500字预览，页面不再依赖它。

同源认证POST `/api/voxspark/surface/queue/{claim,complete,cancel,retry,reconcile}`
沿用现有加密Queue与执行账本。claim默认submit要求idle；mode=steer要求running、
无approval且无其他leased项，允许引导当前processing项。两者共用稳定clientSubmissionId。
浏览器在领取后再次校验原Session/turn，使用messages的strictSteer=1及activeTurnId，
后台以Codex expectedTurnId执行。严格模式stale/unsupported返回明确失败，不interrupt/
turn/start，不伪造pending echo；普通请求兼容逻辑不变。成功后submitted并清除队列正文，
失败保留；transport timeout标为unknown且不重发。Queue自动提交和转引导均不清除当前持久草稿或释放另一份
语音草稿。retry仅failed且账本missing时重新排队，未知项只核对。

旧 Queue 请求未返回时，新语音和手写草稿仍属于当前 Composer；旧请求完成不得清除它们。
“已提交”不等于指定消息回复完成；精确回复关联仍是独立未完成项，不属于个人词库 C3。

### 网页失败录音恢复（C2）

当前 Session 的失败录音显示时长、可重试窗口和重试识别/丢弃录音按钮。首次失败后的
15分钟内复用Bridge原始内存录音，重复失败不延长；过期后仍可丢弃。连接失效禁用
按钮，重新连接以完整metadata快照恢复。Bridge epoch改变时提示录音无法恢复。
识别完成沿既有Composer追加路径写入原Session，不自动提交或清空手工草稿。

新增POST `/api/voxspark/surface/capture/{retry,discard}`，包含client_id、service_epoch、
request_id、bridge_epoch、session_id、capture_id、recovery_revision。后端核对当前
Surface租约、Session及快照revision，再通过现有Host WebSocket转发独立
`host.capture.action`，附当前context_revision。Bridge回报
`bridge.capture.action.result`（accepted/rejected）；accepted仅表示操作受理。
请求超时或断连返回capture_outcome_unknown，网页保留同一请求id供显式核对；
真正处理进度和失败批次以bridge.voice.state为准。明确拒绝可重新取得请求id，
新失败revision与Bridge epoch始终隔离旧操作。未升级Bridge可继续投影旧schema1，
但没有recovery元数据时网页恢复按钮禁用。

failed capture增量字段 `recovery:{revision,retryable,expires_at}` 经后端白名单重建；
没有录音、转写、provider错误正文进入该通道或持久事务账本。

## 个人词库管理（C3）

设置 → VoxSpark → 个人词库通过同源认证 API 和专用 Host 请求管理 Bridge 词库。
添加、搜索、启停、移除错写、确认删除不使用 BOX 或 voice 广播；词库内容不进入动作账本。
文件锁内检查 revision，Bridge epoch 和 request id 隔离旧请求及重复写入。
保存结果未知时重新读取，不自动重试写入；修改仅影响下一次录音。
自动候选学习、浏览器旧 acceptedCorrections Map 的持久同步尚未接入。

## Host 交接与恢复

Bridge 接替 CLOSING 的 Host 时先完成旧 owner 的离线转换，再应用新连接上下文；
旧 socket 的迟到消息不能覆盖新 owner。OPEN Host 仍互斥。
`test/host-replacement.integration.test.js`（Bridge）固定该关闭时序；
Bridge 的 `scripts/validate-host-recovery.cjs` 使用真实本地 WebSocket 和隔离数据检查重连、
跨 Session 延迟交付及加密 Queue 在双方重启后只提交一次。
Mobile 的 `scripts/validate-voxspark-page-reload.cjs` 检查真实 Chromium reload 后本地草稿及目标恢复。
这些检查使用合成音频/provider/发送出口；实体验收边界见当前基线。
