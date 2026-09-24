# P3-B `app-persistence.js` implementation run

Implementation self-test only. This run is not independent acceptance.

## Scope and source identity

- Start baseline checked before edits: `main` / `3574824357dc7beb04cbd3e32aa413cd508e8484`; task-book P3-A identities matched (`app-core.js` `f8b1226ea1f65dcf0ae46b6ccedc0825e2651a89317835478b3e76db93a9557d`, `lib/app-model.js` `0219c576a82d4df6fefe4dca62561c491f1b36c97d59de426afff7ccad41f94e`, SW v24).
- Final P3-B identities are in `final-source-sha256.txt`. Key values: `lib/app-persistence.js` `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50`; `app-core.js` `3aa0310e1e0f0610bf053384d385d1371ad9db819788464dd83f0cbc60f124dd`; `sw.js` `52e97c8553b75b3ccad7b400aadb39c3df3adda42874c108e7b004e2dcca8e9b`.
- This run neither changed `lib/storage.js` nor moved D41 transaction reducers/commands or native reconcile. Existing unrelated dirty files and historical artifacts were preserved.

## Ownership and assembly

| Holder | Responsibility |
| --- | --- |
| `lib/app-persistence.js` | The only authority state, write FIFO, storage/mirror source choice, pending replay credentials, and committed-item snapshot holder. |
| `app-core.js` | Live state and AppModel normalization, D41 commands/drafts/compensation, and native sync/reconcile; compatibility forwards call the single persistence instance. |
| `index.html` / `sw.js` | Production script order (`app-persistence` before core) and v25 precache inclusion. |

`createAppPersistence(deps)` accepts only named state getters, `applyRecoveredState`, lazy storage, IDB/local operations, clock, commit callback and save-failure callback. It receives no DOM, native namespace, full core API, or transaction context. The installed instance contract has 14 members: `currentPayload`, `writeSnapshot`, `runCommit`, `saveAsync`, `save`, `loadAsync`, `loadSync`, `load`, `replayPendingSnapshot`, `authoritativeWritesAllowed`, `authoritySnapshot`, `reopen`, `committedItemById`, and `getStorage`.

`production-scripts.js` reports no missing or unused contract members in `persistenceInstanceCoverage`; `production-combination.log` also contains malformed-contract and removed-forwarding controls.

## Results and raw evidence

- Full `npm test`: exit 0. Its immutable waterlines are unit **642/0**, native **324/0**, direct P3-B mutation harness **6/6 detected**, boot **555/0** (P3-A floor 552), smoke **266/0**, regressions **730/0**, parse **160/0**. Raw output: `npm-test-final.log`; exit: `npm-test-final.exit`.
- The six direct behavior mutations were: removal of the write gate; snapshot changed to live; FIFO left locked after a failed job; degraded mirror promoted to loaded; replay cleared before failed writeback; committed baseline advanced before storage success. All made the same harness fail; the before/after product SHA is byte-identical (`persistence-before-direct.sha256`, `persistence-after-direct.sha256`).
- `node --check` succeeded on nine affected JavaScript files; `git diff --check` was clean. Static closure is recorded in `persistence-closure.json`.
- Isolated production Chrome checks use disposable profiles and local HTTP only: control write/reload and failure/retry (`browser-recovery.log`); import confirmation, persistence, legacy conversion and rejection paths (`browser-import.log`); capture, views, content, setup, and diagnostics (`browser-*.log` plus JSON under each output directory). All exit 0.
- `cap-sync.log` records `npm run cap:sync`; `assemble-debug.log` records current `:app:assembleDebug` success. `resource-29-way.log` and `resource-29-way-sha256.tsv` show **29/29** source web resources byte-identical across `www`, Android public assets, debug intermediate assets and `app-debug.apk`. Capacitor’s two generated Cordova entries remain excluded from the 29-source-resource count.

## Not performed

- Android device installation and real-device behavior were not performed.
- Physical offline service-worker v24 → v25 upgrade was not performed.
- This implementation evidence is not an independent P3-B acceptance result.
