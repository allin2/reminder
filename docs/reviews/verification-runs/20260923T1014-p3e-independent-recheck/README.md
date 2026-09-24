# P3-E independent recheck: FAIL / FIX_REQUIRED

This is an independent check of the implementer's P3-E delivery, not a restatement of its self-test. Repository `/Users/qlyf/Developer/reminder`, `main`; HEAD and `origin/main` remain `3574824357dc7beb04cbd3e32aa413cd508e8484`. Exact current source and APK hashes are in `source-hashes.txt`. Product source, existing candidate APKs, and the implementer's evidence were not changed by this run.

## Blocker 1: full-screen alarm action drain invokes the notification handler

The P3-D baseline `initializeNativeReminders()` supplied `handleAlarmAction` directly to `NativeReminders.drainAlarmActions`. The new `lib/app-native-coordinator.js` selects `deps.handleAlarmAction || (ev => deps.onNotificationAction(ev))`, but `app-core.js` does not supply `handleAlarmAction` to the factory. Thus every resume drain takes the fallback. A queued alarm event has `alarmEventId`; the actual `handleNativeNotificationAction()` route recreates the transaction payload from a notification ID, and a full-screen alarm event has no `notification.id`, so the transaction receives an empty event ID. This bypasses the transaction's persistent event-ID deduplication.

The divergence is user-visible for `close`: Android `AlarmActivity` sends `close` on dismiss/back. Direct transaction handling closes the alert without opening detail; the notification fallback opens the item's detail sheet. `verify-counterexamples.js` uses the real extracted module and shows `direct=0, notification=1` in the current factory wiring, while supplying the direct callback yields `direct=1, notification=0` with the original ID. `verify-close-route.js` loads the real production combination and shows `directDetail=null`, `notificationDetail=<item id>`. Both probes exit 2 for the current behavior; raw logs and exit files are preserved.

Required repair: pass a named `handleAlarmAction` dependency from `app-core.js`, require it in the factory, and call it directly during `drainAlarmActions`; do not silently fall back to the notification-action route. Keep notification actions on their existing separate callback. Test ACK/snooze/done/close and preservation of `alarmEventId`, plus rejected authoritative commit leaving the queued event available for retry.

## Blocker 2: version drift ends reconciliation before compensation

In the P3-D APK's `syncNativeRemindersNow`, `if (!nativeSyncPending) break` was inside `if (capturedVersion === nativeSyncVersion)`. In the extracted module it is outside. A version change during `reconcile` with no pending queue now skips stale ledger writes but returns after one run; it does not reconcile the new business snapshot to compensate platform side effects from the old run. `verify-counterexamples.js` applies a single version bump during `reconcile`: current module runs once; restoring the old branch placement in memory runs twice. The implementer's B9/direct tests assert only that stale ledger data was rejected, so they pass while omitting the required second run.

Required repair: retain the old completion condition or an equivalent explicit retry when version drift is observed, then prove the second run sees the new snapshot and cancels/updates stale platform schedules. Preserve `deferNativeSync` and no-self-trigger behavior on a stable run. Use a one-time drift in the counterexample so the test cannot hang on perpetual mutation.

## Checks that passed and boundary

- Fresh `npm test` exit 0: unit 642, native 324, boot 774, smoke 266, regressions 730, parse 160; the existing P3-E mutations all report detected. This green suite does not cover the two counterexamples above.
- Fresh `node --check` for the changed core/module and `git diff --check` exit 0.
- `verify-resources.py` independently compares all 32 Web resources across source, `www`, Android assets, **debug intermediate assets**, and actual Debug APK: mismatch count 0. The current APK hash is `ebc57bb6c8423334cd9f8b717130433ee6edcc8d0ac2ab80aa766a5e7c53754f`; frozen P3-D baseline APK remains `23742f54b680724fbc14326f2fdac8db847e564f466f1cae5e2411a24bc8307f`.
- Physical Android behavior and real offline Service Worker v28→v29 upgrade are **NOT_PERFORMED**. The package identity check does not turn the current P3-E candidate into an accepted candidate while these source blockers remain.

Return P3-E to the implementer for a minimal targeted repair. Do not begin the next modularization batch until an independent recheck passes. No checkout/reset/stash/clean, commit, or push was performed.
