# P3-C independent recheck: FAIL / FIX_REQUIRED

## Identity and scope

- Repository: `/Users/qlyf/Developer/reminder`, branch `main`, HEAD and `origin/main` both `3574824357dc7beb04cbd3e32aa413cd508e8484`.
- Tested workspace bytes: `app-core.js` `0a5ae42b518021a95a4a6d2c8dccd4cbf0f4c3feac00a2c2c7dea1d36c2a7c89`; `lib/app-transaction.js` `e6df807a8330c618ce5d9e4b7a4087bfe7f07fbab1b32a8693a49908b71dea48`; `lib/app-persistence.js` `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50`.
- The implementation report at `docs/reviews/verification-runs/20260922T-p3c-app-transaction/README.md` is self-test evidence. This run separately loaded the current production script combination and exercised a new A/B counterexample. Product source was not edited during this recheck.

## Blocking finding: stale wrapped commands after rebind

`app-core.js` `wrapUserOp()` (lines 1660-1668 at the tested bytes) caches the function returned by the *first* `appTransaction.wrapUserOp(fn, options)` call. `bindRuntime()` (line 1223) can bind a new transaction instance, including through `startApp()` on recovery retry, but cached command wrappers keep calling the old instance. The old instance has no knowledge of the new instance's active action scope or pending command log.

`repro-stale-transaction.js` loads the real production scripts using the repository's boot harness. Both A/B cases first use the ordinary `completeItem` wrapper and a separately wrapped unrelated command, then seed and save a target item. The B case rebinds through `bindRuntime()` and reloads authoritative state. Both cases then hold the IndexedDB commit for an `ack` alarm action, issue a same-item `completeItem`, issue the unrelated command, and release the commit. The script exits 0 only when the two outcomes below are reproduced:

| Observation while commit is held | A: no rebind | B: after rebind |
| --- | --- | --- |
| New transaction in flight | yes | yes |
| Same-item `completeItem` return | `false` | **`true`** |
| Target visible status before → during | `waiting` → `waiting` | **`waiting` → `archived`** |
| Unrelated command visible before commit | yes | yes |
| Unrelated item after successful commit | yes | **no** |

Raw output: `repro-stale-transaction.log`; exit code: `repro-stale-transaction.exit`. This violates the P3-C plan's conflict-domain, no-early-visibility, replay, and public-compatibility invariants. The production boot and direct factory suites do not cover rebind after a wrapper has already been used. The probe drives the exposed `bindRuntime()` and `loadAsync()` hooks, rather than a physical recovery-panel click; a user-visible recovery-retry reproduction on device remains unperformed.

Probe development note: the first draft of this new probe exited 1 at `transaction-replay-unused-created-id:unrelated` because its synthetic create command did not consume the replay ID. The probe was corrected to use the production `takeReplayCreatedId()` contract before the recorded A/B run. That first draft's console result exists in this task transcript but was not archived as a separate raw file.

## Other independent checks

- `npm test` exited 0: unit 642, native 324, boot 587, smoke 266, regressions 730, parse 160 = 2709 assertions; P3-B's six and P3-C's nine source mutations were reported detected. Raw log and exit are `npm-test.log` and `npm-test.exit`. Passing these checks does not negate the A/B counterexample.
- Current `transactionInstanceCoverage()` reports no missing or unused instance API. Static closure checks the member names, not the instance identity retained inside already-created wrappers.
- `git diff --check` passed. P3-B persistence, storage, and native-reminders SHA-256 values match the P3-C implementation's recorded baseline. No checkout, reset, stash, clean, commit, or push was performed.

## Required repair and acceptance

Make every core command wrapper dispatch through the **currently bound** transaction instance. An instance-keyed cache is acceptable if it invalidates on rebind; preserving a wrapper from a previous instance is not. Add a permanent production-combination regression with the A/B sequence above. Its fixed behavior must keep the same-item command at `false` and live state unchanged during the held commit, and must retain the unrelated item after the single authoritative action save. Restore the stale-cache line in a temporary mutant to prove the new assertion turns red; do not mutate product files for the test.

After editing `app-core.js`, advance the service-worker cache version according to the repository contract, rerun `npm test`, affected Chrome checks, source-to-debug-APK byte comparison, and record exact new hashes. Preserve the earlier evidence and APK. Independent acceptance must be repeated against the repaired bytes before P3-C can pass.

Android physical-device execution and physical offline service-worker v25→v26 upgrade were **NOT_PERFORMED** in this independent run. The implementation APK/resource evidence is not independently reissued here because the source-level acceptance is blocked.
