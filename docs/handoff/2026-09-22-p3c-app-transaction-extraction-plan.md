# P3-C `app-transaction.js` extraction and acceptance plan

## 1. Objective and frozen baseline

Extract the D41 user-operation/native-alarm transaction coordinator from `app-core.js` into a single no-load-side-effect UMD module `lib/app-transaction.js`. Remove the transaction algorithm and its mutable coordinator state from core; core may retain compatibility forwards and named business/platform callbacks only.

Work starts from the independently accepted P3-B bytes:

- HEAD/origin main: `3574824357dc7beb04cbd3e32aa413cd508e8484`
- `app-core.js`: `3aa0310e1e0f0610bf053384d385d1371ad9db819788464dd83f0cbc60f124dd`
- `lib/app-persistence.js`: `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50`
- `sw.js`: v25 / `52e97c8553b75b3ccad7b400aadb39c3df3adda42874c108e7b004e2dcca8e9b`
- accepted test floor: unit 642, native 324, boot 555, smoke 266, regressions 730, parse 160; UI 567/590; 29 source web resources.

The dirty worktree and all historical evidence/APKs must be preserved. Never use checkout/reset/stash/clean, do not commit or push, and do not overwrite a prior run or APK.

## 2. Unique ownership

`lib/app-transaction.js` must uniquely own:

- coordinator state: inner-save suppression, feedback suppression, in-flight action depth, pending user-command log, replay-created IDs, active item/series scope, draft-application flag;
- item/series conflict checks and explicit user-facing rejection;
- `runUserOp`, `wrapUserOp`, value/reference argument recording and resolution, stable-created-ID replay, and fail-closed leftover-ID checks;
- state-part draft swap/restore, action-draft publish, and unrelated user-command replay;
- same-alarm-event in-flight Promise reuse and release-on-success/failure;
- persisted alarm-event idempotency log and short action dedup state if those are used only by this coordinator;
- the native alarm action transaction: validate item/revision, run reducer on an invisible draft, submit through P3-B, collect/replay unrelated commands, compensate on replay failure, then publish and trigger named post-commit callbacks.

`app-core.js` may keep thin forwards so current call sites and `__ATTENTION_INBOX__` remain compatible, but it must not retain a second copy of the coordinator state, draft algorithm, replay algorithm, event in-flight Map, or commit/publish sequence.

## 3. Boundaries that must not move

- **P3-B persistence stays intact.** `lib/app-persistence.js` remains the only authority/read/write/FIFO/pending-replay/committed-baseline implementation. Transaction receives narrow callbacks for `currentPayload`, `runCommit`, and `writeSnapshot`; it does not create storage, change authority, or own a second commit queue.
- **Native platform stays in core/native module.** Listener registration, drain, bridge calls, reconcile/buildDesired, native sync metrics/versioning, schedule/cancel, and delivery UI stay where they are. Transaction gets only named callbacks such as `queueNativeReminderSync`.
- **Business/model rules stay in core/P3-A.** `ackItem`, `snoozeItem`, `completeItem`, edit/new/delete/project/deadline/evidence reducers, `isTerminal`, `hasKnownRev`, repeat logic, `makeItem`, and normalization remain their existing implementations. Transaction invokes injected callbacks and must not copy their rules.
- **DOM/form/UI stay out.** Capture sessions, submit tokens, form fields, `$`/`$$`, `document`, sheets, and render implementations do not enter the module. Named result callbacks (`render`, `toast`, `openDetail`, `hideAlert`, `fmtTime`) are permitted.
- Do not change `lib/storage.js`, `lib/native-reminders.js`, import/export schema, reminder semantics, or Android Java/Kotlin code.

State access must be narrow and live. The module may receive named getters/setters for items/notes/projects/settings or equivalent state-part callbacks. It must not receive the whole core API, create a second long-lived live state, or retain a draft after the owning transaction settles.

## 4. Required instance contract and assembly

Add `AppTransaction.createAppTransaction(deps)` to the runtime dependency gate and create one checked-and-bound instance after the P3-B persistence instance is available. Factory evaluation/creation must do zero storage, DOM, native, timer, or state mutation.

The instance contract must cover every real core use in both directions. Minimum expected surface:

- `runUserOp`
- `wrapUserOp`
- `itemConflictsWithActiveAction`
- `isItemActionPending`
- `rejectPendingItemCommand`
- `takeReplayCreatedId`
- `handleAlarmAction`
- `alarmEventSeen`
- `inflightDepth`
- `isFeedbackSuppressed`
- `shouldSuppressInnerSave`

Names may be adjusted only if all call sites, public forwards, tests, and static closure reflect the final single contract. Private helpers such as draft swapping, publish, replay, argument recording/resolution, and `applyAlarmAction` should not be exported merely for tests.

Update the production chain:

- `index.html`: load `lib/app-transaction.js` after persistence and before `app-core.js`;
- `sw.js`: v25 → v26 and precache the new module;
- `test-smoke.js`, `test-regressions.js`, `test-boot-combination.js`: exact production order;
- `scripts/verification/production-scripts.js`: namespace path and `transactionInstanceCoverage()` using the shared factory-instance scanner;
- `scripts/sync-www.js`: no logic change is expected because it already copies all `lib/*.js`;
- `package.json`: add a direct P3-C harness after the P3-B harness.

After addition the production list is 21 scripts and the source resource chain is 30 files.

## 5. Behavioral invariants

1. **No early visibility.** The action reducer and event log run on a detached draft. Before authoritative save settles, live state and rendered business state remain the last committed state.
2. **Same event, same Promise.** Concurrent delivery of one `alarmEventId` shares the same commit Promise. Neither caller may report success before the single authoritative save succeeds. Failure releases the entry so retry is possible.
3. **Persistence ordering.** The entire action is one P3-B `runCommit` job; snapshot selection and `writeSnapshot(draft,{deferNativeSync:true})` remain inside that job and are awaited.
4. **Conflict domain.** User-facing commands on the same item or series return `false`, show the existing saving message, and do not change state. Unrelated commands are accepted in order and recorded.
5. **Replay fidelity.** Recorded object arguments are self-contained; item references resolve by ID; created IDs and repeat-parent identity remain stable; missing references, rejected reducers, or unused created IDs throw.
6. **Inner-save suppression.** Reducers reused inside a draft do not start nested ordinary saves. Suppression is synchronous and scoped; it must not swallow saves that occur while the authoritative commit Promise is pending.
7. **Failure behavior.** Authoritative write failure publishes no draft, clears no native event, retains no dedup success marker, and leaves retry possible. Replay failure performs the existing compensation write of visible state, attaches compensation failure if any, and still rejects.
8. **Publish behavior.** Only success publishes action-owned item fields and alarm event log, preserves unrelated live settings/notes/projects and object identity where required, then queues native sync, renders, and emits existing feedback.
9. **Terminal/revision semantics.** Old or unknown revisions, already-terminal items, snooze/ack/done/close behaviors, repeat derivation, and user text remain byte-for-byte compatible.
10. **Public compatibility.** Existing hooks and all native listener/drain call sites still receive the same Promise/boolean behavior.

## 6. Required tests and mutations

Add `scripts/verification/p3c-transaction-tests.js` with a direct factory harness using fake state parts, fake P3-B callbacks, reducers, UI callbacks, and controlled Promises. Healthy tests must cover every invariant above without loading core.

At minimum, mutate the real module source in temporary copies and prove the same healthy harness turns red for:

1. draft reducer operating on live state;
2. `writeSnapshot` no longer awaited;
3. draft published before authoritative success;
4. same-event in-flight Promise reuse removed;
5. item/series conflict check removed;
6. unrelated command replay removed or performed on the wrong state;
7. stable created-ID consumption/fail-closed remainder removed;
8. inner-save suppression removed;
9. replay-failure compensation write removed.

Mutation runs must never rewrite the product file; record before/after SHA-256 equality.

Boot tests must independently exercise missing `lib/app-transaction.js`, empty namespace, throwing factory, and every instance member missing one at a time. Each case must return `ready=false`, name the exact `AppTransaction` path, and show zero IDB put, zero native scheduling, and no 15s/2s business timers. Add static missing/unused contract counterexamples; a normal product checkout must have both arrays empty.

Preserve and rerun the existing D41 regressions, especially G1, H1, I1/J1, M1/N1/P1/Q1, T1, and U2’s 36-combination matrix. No historical assertion may be skipped or weakened to keep the suite green.

## 7. Verification and evidence

Implementation evidence must include:

- final source hashes, HEAD/origin, dirty status, syntax and `git diff --check`;
- unique-ownership scan proving D41 coordinator bodies/state exist only in `lib/app-transaction.js`;
- byte comparison showing P3-B persistence, storage, and native-reminders are unchanged;
- direct healthy/mutation logs and before/after module hash;
- full `npm test` with floors no lower than 642/324/555/266/730/160 plus new P3-C tests;
- static production/contract closure and UI parity 567/590;
- isolated Chrome recovery, import, capture, and affected behavior checks;
- `npm run cap:sync`, debug APK build, and 30/30 repository → www → Android assets → debug intermediate → APK byte comparison;
- a self-contained run README with exact NOT_PERFORMED boundaries.

Android physical-device behavior and physical offline SW v25 → v26 may remain NOT_PERFORMED in the implementation run, but must be stated explicitly. The implementer must not call its own run independent acceptance.
