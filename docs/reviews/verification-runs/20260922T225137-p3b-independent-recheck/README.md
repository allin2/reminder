# P3-B `app-persistence.js` independent acceptance

## Verdict

**PASS for P3-B source, production assembly, browser behavior, and debug-APK resource closure.** This is an independent rerun against the final workspace bytes, not a restatement of the implementation run.

Android device installation/behavior and a physical offline service-worker v24 → v25 upgrade remain **NOT_PERFORMED** and are not implied by this PASS.

## Frozen identity

- Repository: `/Users/qlyf/Developer/reminder`
- HEAD = origin/main = `3574824357dc7beb04cbd3e32aa413cd508e8484`
- Workspace remained intentionally dirty; no checkout, reset, stash, clean, commit, or push was performed.
- `app-core.js`: `3aa0310e1e0f0610bf053384d385d1371ad9db819788464dd83f0cbc60f124dd`
- `lib/app-persistence.js`: `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50`
- `index.html`: `9df63bd1d067ce9458733ee2662c36b9ea338a7c21adf7a809b8042c05452649`
- `sw.js` v25: `52e97c8553b75b3ccad7b400aadb39c3df3adda42874c108e7b004e2dcca8e9b`
- Independent debug APK: `apk/p3b-app-debug.apk`, SHA-256 `997a291b1258cdebef5f4c2356ee86f85029b5f917e4d73e40224fa03a6fbff8`
- Pre/post acceptance hashes are identical (`preflight/source-hash-diff.log` is empty).

## Ownership and boundary result

`lib/app-persistence.js` is the only implementation holder for authority state/reporting, write gating, FIFO commit order, authoritative/mirror choice, pending replay credentials, and committed-item baseline. `app-core.js` retains only compatibility forwards and the named integration callbacks.

The P3-A accepted `app-core.js` was extracted from its frozen APK and compared to the current source. The D41 transaction block is semantically byte-identical; its only diff is one ownership comment immediately before `applyParsedState`. `lib/storage.js` and `lib/native-reminders.js` are byte-identical to the P3-A accepted APK. The persistence module contains no DOM, render, native namespace, transaction context, or second live-state object.

The core shrank from 315,791 to 295,649 bytes; the new persistence module is 10,454 bytes. Source inspection and `production-scripts.js` report the same 14 used/declared instance APIs with empty `missingInContract` and `unusedInContract`. Production order contains 20 scripts, with `app-persistence.js` before `app-core.js`; index, precache, harness, and packaging checks are empty.

## Independent counterexamples

`tests/independent-persistence-behavior.js` was written for this acceptance run and exercises the module directly. It proves:

- factory evaluation/creation performs no storage IO;
- unconfirmed/failed authority rejects writes and increments the blocked count without storage or pending-replay side effects;
- loaded and local-only paths preserve their different authority semantics;
- snapshots detach from live state and are taken only when a FIFO job starts;
- a failed commit does not lock later jobs;
- `deferNativeSync` and subsequent options reach the commit callback;
- degraded mirror state cannot become writable or mint replay credentials;
- replay writeback failure retains the credential; a later successful replay clears it;
- recovery-apply failure is reported as failed and remains write-blocked;
- committed baseline changes only after a successful authoritative save.

The same harness turns red for all six source mutations: removed write gate, live snapshot, FIFO failure lock, degraded mirror promotion, early replay clear, and early committed-baseline update. It records the tested product hash.

`tests/independent-persistence-failclosed.js` adds 17 bad production combinations: missing script, empty namespace, throwing factory, and each of the 14 instance APIs removed one at a time. Every case returns `ready=false`, names the exact `AppPersistence` path, performs zero IDB puts, schedules zero alarms, and starts neither business heartbeat. The complete augmented boot run is **589/0**.

During implementation monitoring, boot temporarily fell from the accepted P3-A floor 552 to 540 because 12 historical M9/M12 counterexamples had been skipped. This was rejected. The final product suite restores those counterexamples against `lib/app-persistence.js` and finishes at 555; the independent 589 run adds the fail-closed cases above.

## Regression and runtime evidence

- `npm test`: exit 0, **2677 passed / 0 failed** = unit 642, native 324, boot 555, smoke 266, regressions 730, parse 160. The P3-B mutation harness also reports all six mutations detected.
- UI parity: DOM **590 PASS** and formatting **567 PASS**, including their negative controls.
- Chrome recovery: **12/12 PASS**. Control performs one real IndexedDB open/write and survives reload; all injected dependency failures remain at zero opens/writes.
- Chrome import: **11/11 PASS**. Valid and historical payloads persist, cancellation is zero-write, and seven invalid payload groups remain pre-confirmation and zero-write.
- Chrome capture: production instance is ready; bind/session/snapshot/open/edit/hint surfaces and the exercised form flow pass.
- `npm run cap:sync` and `:app:assembleDebug`: exit 0.
- Independent resource verifier: **29/29** files are byte-identical across repository source → `www` → Android public assets → debug intermediate → the frozen debug APK. Key hashes for core, persistence, index, and SW are shown in `apk/resource-29-way-sha256.tsv`.

## Evidence map

- Preflight/source comparison: `preflight/`
- Independent behavior and mutation harness: `tests/independent-persistence-behavior.*`
- Independent namespace/factory/member fail-closed run: `tests/independent-persistence-failclosed.*`
- Full tests/static/UI: `tests/`
- Chrome outputs: `browser/`
- Build/APK/resource hashes: `apk/`

## Not performed

- Android physical-device install, cold-start persistence, native scheduling, and delivery behavior for this exact P3-B APK.
- Physical offline installed-PWA upgrade from service-worker v24 to v25.
- Release signing or production-package installation.
- Commit and push.
