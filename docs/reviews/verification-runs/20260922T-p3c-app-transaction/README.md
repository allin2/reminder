# P3-C `app-transaction.js` implementation run

这是实施方自测，不构成独立验收。

## Scope and source identity

- Start baseline checked before edits: `main` / `3574824357dc7beb04cbd3e32aa413cd508e8484`; task-book P3-B identities matched (`app-core.js` `3aa0310e1e0f0610bf053384d385d1371ad9db819788464dd83f0cbc60f124dd`, `lib/app-persistence.js` `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50`, SW v25 `52e97c8553b75b3ccad7b400aadb39c3df3adda42874c108e7b004e2dcca8e9b`).
- Final P3-C identities are in `final-source-sha256.txt`. Key values:
  - `lib/app-transaction.js`: `e6df807a8330c618ce5d9e4b7a4087bfe7f07fbab1b32a8693a49908b71dea48`
  - `app-core.js`: `0a5ae42b518021a95a4a6d2c8dccd4cbf0f4c3feac00a2c2c7dea1d36c2a7c89`
  - `index.html`: `b03f64559f3815a8ea7b6879375daca1b57fa555220f0c5981cf6702b282ce48`
  - `sw.js`: `0fd2186d3e28e325e12d6c6959142905b2d35f8e30ad9b1d4a00667bcec23d49` (v26)
  - `lib/app-persistence.js`: `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50` (unchanged)
  - `lib/storage.js`: `b710ec23d819dfdc7eeeafa4688e44d69a11062a18c35b931c2240177721478a` (unchanged)
  - `lib/native-reminders.js`: `723f218c68866309f364e1e71968eb3efc6ae8b9b85aea7e211c878bee6e031b` (unchanged)
  - `debug APK`: `f410979f37f5c5ffab52a5f74f0879fc0a8a2d46c957d757a52049c098fb9e7d`
- Worktree preservation: under no circumstances was checkout/reset/stash/clean used. Historical evidence and releases remain intact. Uncommitted worktree state preserved.

## Ownership and assembly

| Holder | Responsibility |
| --- | --- |
| `lib/app-transaction.js` | Unique owner of D41 transaction coordinator state (`suppressInnerSave`, `inflightActionDepth`, `pendingUserOps`, `suppressUserFeedback`, `replayCreatedIds`, `activeActionScope`, `applyingActionDraft`, `inflightAlarmActions`, `recentAlarmActions`) and coordinator algorithms (`itemConflictsWithActiveAction`, `isItemActionPending`, `rejectPendingItemCommand`, `runUserOp`, `wrapUserOp`, `takeReplayCreatedId`, `replayUserOps`, `withDraftState`, `publishActionDraft`, `handleAlarmAction`, `alarmEventSeen`). |
| `lib/app-persistence.js` | Preserved as sole authority for persistence, recovery, write gate, write FIFO, pending replay, committed baseline. (No storage created or second queue in transaction). |
| `app-core.js` | Live state and AppModel normalization, native reminders bridge/reconcile, AppPersistence integration, and thin compatibility forwards to `appTransaction`. |
| `index.html` / `sw.js` | Production script order (`app-transaction` loaded between `app-persistence` and `app-core`) and v26 precache inclusion. Total 21 production scripts, 30 source web resources. |

`createAppTransaction(deps)` accepts named state getters/setters, `currentPayload`, `runCommit`, `writeSnapshot`, `isTerminal`, `hasKnownRev`, business callbacks (`ackItem`, `snoozeItem`, `completeItem`), native callbacks (`queueNativeReminderSync`), and UI callbacks (`render`, `toast`, `openDetail`, `hideAlert`, `fmtTime`). It performs zero IO, storage, DOM, native, timer, or state mutation during factory evaluation/creation.

The instance contract has 11 members:
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

`production-scripts.js` reports 100% two-way static closure (`missingInContract: []`, `unusedInContract: []`, `internalOnly: []`) in `transaction-closure.json`.

## Results and raw evidence

- Full `npm test`: exit 0. Waterlines:
  - unit: **642/0** (baseline 642)
  - native: **324/0** (baseline 324)
  - persistence: **6/6 mutations detected**
  - transaction: **9/9 mutations detected + healthy PASS**
  - boot combination: **587/0** (baseline 555, +32 tests)
  - smoke: **266/0** (baseline 266)
  - regressions: **730/0** (baseline 730)
  - parse single source: **160/0** (baseline 160)
  Raw logs: `npm-test-final.log`; exit: `npm-test-final.exit`.
- Unique-ownership scan: `unique-ownership.log` proves all D41 coordinator states and algorithm bodies exist solely in `lib/app-transaction.js` (0 occurrences in `app-core.js`).
- Baseline preservation: `baseline-byte-comparison.log` proves `lib/app-persistence.js`, `lib/storage.js`, and `lib/native-reminders.js` are byte-identical to baseline.
- Direct behavior & mutation harness: `p3c-transaction-tests.js` tests all 10 behavioral invariants without core. The 9 required mutations:
  1. draft reducer operating on live state;
  2. `writeSnapshot` no longer awaited;
  3. draft published before authoritative success;
  4. same-event in-flight Promise reuse removed;
  5. item/series conflict check removed;
  6. unrelated command replay removed or performed on the wrong state;
  7. stable created-ID consumption/fail-closed remainder removed;
  8. inner-save suppression removed;
  9. replay-failure compensation write removed.
  All 9 mutations failed the healthy harness. Before/after SHA-256 of `lib/app-transaction.js` matched byte-for-byte (`transaction-before-direct.sha256`, `transaction-after-direct.sha256`, `transaction-direct-integrity.log`).
- UI Parity: `ui-dom-parity.log` (590/590 matched), `ui-format-parity.log` (567/567 matched).
- Isolated Chrome checks: `browser-recovery.log` (12/12), `browser-import.log` (11/11), `browser-capture.log`, `browser-content.log`, `browser-diagnostics.log`, `browser-setup.log`, `browser-views.log`. All exit 0 (`browser-suite.exit`).
- Packaging & Android build: `cap-sync.log` records `npm run cap:sync`; `assemble-debug.log` records `:app:assembleDebug` success. `resource-30-way.log` and `resource-30-way-sha256.tsv` show **30/30** source web resources byte-identical across `www`, Android public assets, debug intermediate assets, and `app-debug.apk`.

## Not performed

- Android physical-device installation and real-device behavior were not performed.
- Physical offline service-worker v25 → v26 upgrade was not performed.
- This implementation evidence is an implementer self-test, and does not constitute independent acceptance.
