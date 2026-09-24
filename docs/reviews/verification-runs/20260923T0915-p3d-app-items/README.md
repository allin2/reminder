# P3-D `app-items.js` implementation run

这是实施方自测，不构成独立验收。

## Scope and source identity

- Start baseline checked before edits: `main` / `3574824357dc7beb04cbd3e32aa413cd508e8484`; P3-C-R recheck baseline (`docs/reviews/verification-runs/20260923T0803-p3cr-independent-recheck`).
- Final P3-D identities are in `final-source-sha256.txt`. Key values:
  - `lib/app-items.js`: `e807599395caa4f0a69e13ab957a43bd6d377d5dbab682c32c121c4a7a4be519`
  - `app-core.js`: `4ee18ef5c24ba4c0cbfdd251c44d7b42ffe396c3eb429e33e0bf7ed5cf731ebd`
  - `index.html`: `994837548fce7d992d46b393a64274dda6c061baa72d8e1cdfb2f1cdc74962a8`
  - `sw.js`: `acd6b79d712dcc7ba24c7f993029da48bbec42319d5b059580644d381bd46890` (v28)
  - `lib/app-transaction.js`: `e6df807a8330c618ce5d9e4b7a4087bfe7f07fbab1b32a8693a49908b71dea48` (unchanged)
  - `lib/app-persistence.js`: `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50` (unchanged)
  - `lib/app-model.js`: `0219c576a82d4df6fefe4dca62561c491f1b36c97d59de426afff7ccad41f94e` (unchanged)
  - `lib/storage.js`: `b710ec23d819dfdc7eeeafa4688e44d69a11062a18c35b931c2240177721478a` (unchanged)
  - `lib/native-reminders.js`: `723f218c68866309f364e1e71968eb3efc6ae8b9b85aea7e211c878bee6e031b` (unchanged)
  - `debug APK`: `23742f54b680724fbc14326f2fdac8db847e564f466f1cae5e2411a24bc8307f`
- Worktree preservation: under no circumstances was checkout/reset/stash/clean used. Historical evidence and releases remain intact. Uncommitted worktree state preserved.

## Ownership and assembly

| Holder | Responsibility |
| --- | --- |
| `lib/app-items.js` | Unique UMD module owner of item commands (`ackItem`, `completeItem`, `snoozeItem`, `deleteItem`, `reopenItem`, `restoreItem`, `resumeDeadlineProtection`, `stopRepeat`), series repeat derivation (`ensureSeriesId`, `seriesMembers`, `isUnstartedInstance`, `spawnNextInstance`, `advanceSeriesOnArchive`), due promotion (`promoteDue`), edit/new commands (`applyItemEdit`, `applyNewItem`, `applyProjectRemovalToItems`), and limited complete/new undo (`applyCompleteUndo`, `revertCompleteUndo`, `undoLastComplete`, `undoNewItem`, `lastCompleteUndo`). |
| `lib/app-transaction.js` | Preserved as sole owner of D41 transaction coordination, command decoration (`wrapUserOp`, `runUserOp`), conflict checking, and replay logging. (P3-C-R rebind cache invalidation intact). |
| `lib/app-persistence.js` | Preserved as sole authority for persistence, recovery, write gate, write FIFO, pending replay, committed baseline. |
| `app-core.js` | Live state owner, startup gate enforcement, thin forwards delegating to `appItems`, and rebind invalidation wiring. |
| `index.html` / `sw.js` | Production script order (`app-items.js` loaded immediately following `app-transaction.js`) and v28 precache inclusion. Total 22 production scripts, 31 source web resources. |

`createAppItems(deps)` receives explicit state accessors, storage callbacks, UI callbacks, and transaction primitives. It performs zero IO, storage, DOM, native, timer, or global state mutation during module evaluation/factory creation.

The instance contract has 22 members:
- `promoteDue`
- `ensureSeriesId`
- `seriesMembers`
- `isUnstartedInstance`
- `spawnNextInstance`
- `advanceSeriesOnArchive`
- `ackItem`
- `completeItem`
- `snoozeItem`
- `deleteItem`
- `reopenItem`
- `restoreItem`
- `resumeDeadlineProtection`
- `stopRepeat`
- `applyItemEdit`
- `applyNewItem`
- `applyProjectRemovalToItems`
- `applyCompleteUndo`
- `revertCompleteUndo`
- `undoLastComplete`
- `undoNewItem`
- `lastCompleteUndo`

`production-scripts.js` reports 100% two-way static closure (`itemInstanceCoverage`).

## Results and raw evidence

- Full `npm test`: exit 0. Waterlines:
  - unit: **642/0** (baseline 642)
  - native: **324/0** (baseline 324)
  - model: **5/5 mutations detected + healthy PASS**
  - persistence: **6/6 mutations detected + healthy PASS**
  - transaction: **9/9 mutations detected + healthy PASS**
  - items direct: **7/7 mutations detected + healthy PASS**
  - boot combination: **708/0** (baseline 687, +21 tests in B8 positive suite & 4 reverse mutants)
  - smoke: **266/0** (baseline 266)
  - regressions: **730/0** (baseline 730)
  - parse single source: **160/0** (baseline 160)
  Raw logs: `npm-test-final.log`; exit: `npm-test-final.exit`.
- Direct behavior & mutation harness: `scripts/verification/p3d-items-tests.js` tests healthy behavior and 7 surgical mutations:
  1. ACK repeat derivation bypassed;
  2. Calendar repeat derivation on complete bypassed;
  3. stopRepeat overwrites historical acknowledged status;
  4. promoteDue inflight check removed;
  5. undo complete failure rollback removed;
  6. wrapUserOp wrapper removed on completeItem;
  7. applyNewItem ignores replayCreatedId.
  All 7 mutations failed the healthy harness. Before/after SHA-256 of `lib/app-items.js` matched byte-for-byte (`items-direct.log`, `items-direct.exit`).
- UI Parity: `ui-dom-parity.log` (590/590 matched), `ui-format-parity.log` (567/567 matched).
- Isolated Chrome checks: `browser-recovery.log` (12/12), `browser-import.log` (11/11), `browser-capture.log`, `browser-content.log`, `browser-diagnostics.log`, `browser-setup.log`, `browser-views.log`. All exit 0 (`browser-suite.exit`).
- Packaging & Android build: `cap-sync.log` records `npm run cap:sync`; `assemble-debug.log` records `:app:assembleDebug` success. `resource-31-way.log` and `resource-31-way-sha256.tsv` show **31/31** source web resources byte-identical across `www`, Android public assets, and `app-debug.apk`.

## Not performed

- Android physical-device installation and real-device behavior were not performed.
- Physical offline service-worker v27 → v28 upgrade was not performed.
- This implementation evidence is an implementer self-test, and does not constitute independent acceptance.
