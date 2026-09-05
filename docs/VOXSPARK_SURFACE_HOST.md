# VoxSpark Surface Host Adapter

Status: R3A/R3B source candidate; live listener remains on the earlier pre-R2 runtime

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

## Actions

- `host.composer.replace` writes one finalized draft into the currently focused
  Composer. Interim transcripts are not accepted by this adapter. The next
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

## Current Validation

- Browser and persistent Host tests prove that `local_context.terms` survives
  the Node relay. This closes an implementation gap where the browser generated
  terms but backend normalization discarded the field.
- Prompt V2 tests prove that rich context is absent by default, appears only
  with the exact consent value, excludes command output, and stays within the
  six-message/12-KiB/8-KiB/32-rule bounds.
- Successful submission of a manually edited VoxSpark draft can produce an
  in-memory correction candidate. Two identical bounded corrections are needed
  before a suggestion appears. `acceptCorrection()` is explicit; no candidate
  is silently persisted. An accepted preferred spelling is reused as both a
  high-weight ASR term and a deterministic polish rule for later captures in
  that page process. The visible confirmation UI and durable local store are
  not implemented in this checkpoint.

- Backend unit tests cover loopback-only URL validation, persistent Host socket
  ownership, context-revision translation, command delivery, lease expiry and
  recovery, plus the authenticated route boundary.
- Browser unit tests cover the relay transport and existing final-only draft,
  Send, Queue, Steer, Stop, blur, visibility, and Session-switch behavior.
- R3 Queue tests cover encrypted-at-rest bodies, missing/wrong-key failure,
  write-failure rollback, per-Session capacity and isolation, exact executor
  leases, browser-refresh takeover, Mobile restart recovery, stable submission
  ids, and stale-browser fencing. Plaintext Queue bodies are absent from the
  encrypted envelope, Bridge context, BOX state, and diagnostics.
- Correlation tests cover Composer confirmation, action confirmation/retry, and
  backend acknowledgement with the same content-free capture/action ids.
- Classic and native frontend runtimes now report the same content-free action
  correlation fields: `outcome`, `captureId`, `actionId`, and
  `commandSequence`. This lets operators distinguish accepted, retry, and
  rejected browser outcomes without recording Composer or transcript text.
- `voxspark_surface_host` client events bypass the generic same-event log
  interval, matching `frontend_diagnostic_log`. The exemption is limited to
  event-driven Composer/action diagnostics; it does not enable polling logs or
  include message content.
- The correlation checkpoint is loaded into live port 8789. The listener
  restarted from PID `91489` to `18502`, then reported configured, connected,
  target-active, and zero pending commands. Physical BOX correlation acceptance
  remains pending for the browser-outcome fields added after that checkpoint.

- Runtime unit tests cover opt-in URL validation, final-only Composer replace,
  stale context, Submit, Queue, Steer, Stop, multi-Queue pacing, and Session
  switch cleanup.
- The full frontend build includes the runtime in classic and native ESM
  artifacts.
- A temporary real VoxSpark Bridge test proved Host connection, compact context,
  final-only Composer replace, Submit, Queue, Steer, Stop, and no draft text in
  BOX state. The first harness version expected a nonexistent Bridge error; the
  corrected contract assertion passed on a random loopback port.
- The generic temporary browser rehearsal exposed a missing VoxSpark ESM compatibility
  sample, which is fixed and build-verified. Browser reruns stopped after two
  attempts; the rehearsal service also omits build identity fields required by
  its current browser gate. This generic rehearsal remains an infrastructure
  gap, while the scoped VoxSpark browser interaction is accepted below.
- A separate VoxSpark browser fixture then passed with the real Bridge and
  actual Host Adapter: first final draft, Send, programmatic-blur retention,
  second final draft without refocus, explicit pointer disarm, and old-Session
  write protection all read back true.
- Isolated real-browser acceptance used real Codex Session
  `01a05780-4686-7d82-82f6-94e0b711699b` and verified final-only Composer
  replace, Send, Queue, Steer, and confirmed Stop. Final readback contained six
  completed turns and one interrupted turn.
- The handwritten adapter files have been transplanted into the exact live
  dirty checkout and its frontend artifacts rebuilt in place. Because 8789
  serves static assets directly from this checkout, the rebuilt shell is
  already live even though listener PID `57065` was not restarted. The adapter
  remains inactive unless an explicit credential-free Bridge URL is configured.
- Production browser checks passed classic, Vite preview, app-preview, root,
  embed, and launch-session paths. The aggregate gate remains blocked by the
  pre-existing default-root rehearsal errors
  `app_update_current_build_identity_empty` and
  `client_version_switch_not_confirmed`.
- The stale workspace-history assertion in `test/mobile-viewport.test.js` was
  aligned with the existing runtime implementation. The targeted file now
  passes `14/14`, and the complete repository suite passes `2646/2646`.
- For this pilot, the default-root rehearsal build-identity gap is an explicit
  exception rather than a VoxSpark acceptance blocker. This exception does not
  claim that the owning rehearsal fixture is repaired.
- An authorized loopback-only production readback connected the live 8789 Host
  Adapter to `127.0.0.1:8790`. Bridge health reported `host_connected=true`,
  and a read-only simulated BOX received compact Session context with no draft
  text. The named Phase 1D test Session now returns HTTP 404 from 8789, so its
  Composer was not writable and no Send, Queue, Steer, Stop, or Session
  mutation was attempted in this readback.
- No LAN binding, audio path, firmware change, or physical BOX validation has
  been performed.

## 2026-09-06 Checkpoint R3A/R3B Queue durability candidate

- R3A moves accepted Queue text out of browser memory into the Mobile backend.
  The encrypted store lives under the existing runtime root at
  `voxspark/queued-submissions.enc`; its key is retrieved from macOS Keychain
  service `com.xuefusong.codex-mobile.voxspark-queue` and is never written to
  the store, repository, logs, or API responses.
- R3B gives each Queue a stable `queue_id == action_id`, Session ownership,
  draft revision, stable `clientSubmissionId`, and a short executor lease. The
  browser remains the Codex executor, but refresh no longer owns Queue truth.
  Only the current Surface lease holder may claim or advance lifecycle state.
- Mobile sends only content-free Queue status to Bridge. VoxSpark projects it
  through the existing Session-scoped action surface, so this checkpoint does
  not require a BOX firmware change.
- Automated evidence: focused Mobile Queue/Host tests `65/65`, complete Mobile
  tests `2702/2702`, complete VoxSpark tests Node `150/150` and Python `6/6`.
  Frontend build/manifest, syntax, project, macOS script, and both repositories'
  diff checks returned exit 0.
- Source only: no Keychain key was provisioned, no runtime file was created,
  and no listener, Bridge, ChatGPT, or BOX was restarted, deployed, flashed, or
  pushed. Real browser refresh, listener restart, and physical BOX acceptance
  remain the next deployment gate.
- A later live Bridge restart exposed a backend reconnect stall: the persisted
  service was configured, while both a direct WebSocket and a fresh service
  instance could connect. The Host service now bounds `CONNECTING` to five
  seconds and retries errors that do not emit `close`; the complete repository
  suite passes `2667/2667`. Live connectivity was restored through an
  authenticated in-memory reconfiguration, while loading the source repair is
  pending a future explicit 8789 listener restart.
- Physical BOX testing on 2026-09-03 reproduced an intermittent Steer loss after
  final ASR/polish text had reached the Composer but before Codex Mobile logged a
  message submission. A focused regression test proved that the backend cleared
  a pending command whenever the same browser published a newer surface
  revision. The backend now preserves and rebinds same-browser, same-Session
  commands, while retaining the existing cross-browser/session discard rule.
  Command queue, rebind, discard, and delivery logs contain only sequence/action
  metadata and never Composer text.
- A later physical BOX test reproduced a second boundary failure: refreshing
  Codex Mobile and navigating through Sessions left `armedSessionId` empty or
  bound to the previous Session because the navigation click moved DOM focus
  away from the Composer. Host then published `composer.focused=false`, Bridge
  emitted no `allowed_actions`, and the BOX action bar correctly hid every
  button. This was not primarily an energy-saving transition; low power could
  become eligible only after the usable context had already been withdrawn.
  The Host runtime now binds the current Session whenever its page is visible
  and foreground, migrates that binding on Session navigation, and still gives
  up ownership when hidden or backgrounded. The focused Host runtime/service
  suite passes `27/27`, including the new refresh/navigation regression.

## 2026-09-05 Live Closure

- The live listener publishes VoxSpark enabled with loopback `/host` and exact
  Prompt V2 consent `bounded-context-v1`. Chrome loaded shell
  `0.1.11|codex-mobile-shell-v625-245c32485560`.
- A regression now proves that BOX Send submits the current complete Composer
  after a same-Session keyboard edit, clears the Composer, releases the active
  draft, and reports Host success. Focused Host tests pass `32/32`; the prior
  full repository run passed `2698/2698`.
- Bridge state tests prove the forwarded action immediately projects
  `processing` with no draft actions, then clears the draft on Host success and
  follows the live Session state. Failure and unknown keep a retryable draft.
- The user physically repeated the manual-edit flow and confirmed the edited
  message reached the intended Session. The latest content-free log result was
  `host_action_confirmed`, action `submit`, outcome `accepted`.
- Prompt V2 model quality is evaluated and governed in the separate private
  VoxSpark repository. Codex Mobile only owns bounded context extraction,
  consent, relay validation, Composer authority, and action execution.
- No 8789, Bridge, ChatGPT, or firmware restart was required for this closure.

## 2026-09-05 Checkpoint R1 transaction integrity candidate

- Branch `voxspark/r1-transaction-integrity` is isolated from the dirty
  maintenance checkout and starts at public integration commit
  `711fe5ee9351f94ebb166a2e61e0fe65e8a26237`.
- Surface Host now sends `acknowledged_sequences` and the backend removes only
  those exact commands. The legacy `after_sequence` compatibility path also
  confirms only the exact sequence rather than a cross-Session high-water
  range.
- Clearing a VoxSpark-owned Composer updates the retained draft to empty.
  Send, Steer, and Queue reject that empty draft and report a bounded failed
  action result instead of executing stale text.
- This candidate pairs with VoxSpark's Composer-application receipt and late
  action-result convergence changes. Focused Host runtime/service tests pass
  49/49 and the full suite passes 2678/2678 after rebuilding the frontend
  artifact. Relevant `node --check` commands and `git diff --check` pass.
- Published local candidate coordinate is
  `0.1.11|codex-mobile-shell-v625-b64ee806f629`; its Vite readback records
  classic build base `codex-mobile-shell-v625-38eb4eac006d`.
- Not deployed or pushed. Listener 8789, Bridge 8790, ChatGPT, and BOX were not
  restarted. Full browser and physical BOX acceptance remain open.

## 2026-09-05 Checkpoint R2 persistent transaction ledger candidate

- The Mobile backend is the transaction authority for Host command delivery,
  Composer append receipts, and BOX action receipts. Its bounded state is
  atomically stored with mode `0600` under the runtime `voxspark` directory.
- Persisted Surface commands keep only transaction ids, Session ownership, and
  revisions. Final transcript and Composer text stay in memory; an undelivered
  append is recovered from Bridge replay of the same `append_id`.
- `surface-transactions.json` preserves exact acknowledgements and receipts.
  Confirmed appends do not replay after restart. A delivered-but-unconfirmed
  append becomes uncertain and waits for exact Host ownership plus
  `draft_revision`; it is not blindly appended again.
- BOX `action_id` maps to a stable `voxspark-*` `clientSubmissionId`.
  `submission-transactions.json` writes that id before the Codex message
  boundary. Completed work deduplicates after restart; restored in-flight work
  becomes `unknown` and is not executed again.
- Ledger write failure returns `voxspark_submission_ledger_unavailable` before
  Codex is called. Restored uncertainty returns
  `voxspark_submission_outcome_unknown` and reaches Bridge as non-retryable
  `unknown`.
- The submission ledger keeps bounded metadata and minimal turn ids, not
  transcripts, Composer text, prompts, credentials, or Codex response bodies.
- Verification: full suite `2692/2692`; focused transaction tests `28/28`,
  browser Host tests `34/34`, frontend build/manifest, syntax, and diff checks
  pass.
- This does not claim strict downstream exactly-once execution. Without a
  durable Codex query receipt, the remote-acceptance/local-crash window stays
  `unknown` and requires reconciliation instead of automatic replay.
- VoxSpark Steer waits for a terminal Codex route result instead of using the
  normal browser fast-accept background path. Browser-local Queue payloads are
  not yet durable across browser restart; Queue backend ownership remains the
  next reliability gap.
- If Bridge and Mobile both crash before Composer confirmation, an in-memory
  final draft is not recoverable. Cross-process draft recovery would require a
  separately reviewed encrypted short-lived spool, not plaintext ledger data.
- Not deployed or pushed. Listener 8789, Bridge 8790, ChatGPT, and BOX were not
  restarted. Browser and physical BOX restart acceptance remain open.
