# P3-C-R independent acceptance: PASS for source, browser, and debug APK

## Verdict and identity

The stale `wrapUserOp` instance defect from `20260923T0735-p3c-independent-recheck` is resolved in the current workspace bytes. The P3-C source acceptance blocker is closed. This is an independent rerun, not the implementer's self-test.

- Repository `/Users/qlyf/Developer/reminder`, `main`; HEAD and `origin/main` remain `3574824357dc7beb04cbd3e32aa413cd508e8484`.
- `app-core.js` SHA-256: `e7459c98b082c1ef03e8ecc1298b286bb9952cebe4cd90889d516c0221f17d05`.
- `lib/app-transaction.js`: `e6df807a8330c618ce5d9e4b7a4087bfe7f07fbab1b32a8693a49908b71dea48` (unchanged).
- `lib/app-persistence.js`: `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50` (unchanged).
- `sw.js`: `ed487b5489b01c5aa179e43da497f010013dea8c03725e7f93c03b28315c431f` (v27).
- Debug APK: `c3a5cc52891400cad35210d7211ea5703fd5225f5c7ca2ddd28272126886a785`.

## Independent counterexample

`verify-rebind.js` derives from the earlier independent defect probe, changing its outcome assertions to the required healthy behavior. It loads the real production script combination, primes both the core `completeItem` wrapper and an unrelated wrapped command, then holds a native `ack` action's authoritative IndexedDB write. A no-rebind control and a rebind-plus-authoritative-reload case both pass:

| Held-write observation | No rebind | Rebound |
| --- | --- | --- |
| Transaction instance changed | no | yes |
| Same-item `completeItem` | `false` | `false` |
| Live status before/during | `waiting` / `waiting` | `waiting` / `waiting` |
| Unrelated command after success | retained | retained |
| Action result / final status | `true` / `acknowledged` | `true` / `acknowledged` |

Raw `verify-rebind.log` exits 0. The original independent defect probe now exits 1 specifically at its former `rebound.conflictResult === true` assertion (`old-defect-probe.log`), not from a boot or fixture error. `verify-source-delta.js` reconstructs the previous failing `app-core.js` entirely in memory by restoring the old wrapper; its SHA-256 is exactly the prior failing `0a5ae42b...`. This confirms that the core source delta is the instance-keyed cache repair. The implementation's B7 test also turns red when that old wrapper is restored in a temporary production-combination mutant; the independently rerun suite includes those assertions.

## Independent checks

- `npm test`: exit 0, **2741 passed / 0 failed** = unit 642, native 324, boot 619, smoke 266, regressions 730, parse 160. Existing six persistence and nine transaction mutations are detected. See `npm-test.log` and `.exit`.
- Chrome recovery: **12/12 PASS**, control `opens=1 puts=1`; injected failures have zero opens and puts. See `browser-recovery.log` and `.exit`.
- UI comparison: DOM **590/590** and formatting **567/567** PASS, including their negative controls.
- `transactionInstanceCoverage()` remains 11 used / 11 declared with empty missing and unused lists (`transaction-closure.json`). `node --check` for the changed JS files and `git diff --check` pass.
- `verify-resources.py` independently compares **30/30** source Web files byte-for-byte across source, `www`, Android public assets, debug intermediate assets, and the actual debug APK. The APK hash matches the implementation handoff. See `resource-hashes.tsv` and `verify-resources.log`.
- P3-B persistence, storage, and native-reminders bytes remain at their previously accepted hashes (`source-hashes.txt`). This acceptance added evidence only; product source and APK were not rebuilt or edited.

## Boundary

The A/B counterexample drives the exposed `bindRuntime()` and `loadAsync()` hooks in an isolated production-script boot. An actual recovery-panel click after a user-visible failure on a physical Android device was **NOT_PERFORMED**. Physical-device installation/native alarm behavior and a physical offline Service Worker v26→v27 upgrade are **NOT_PERFORMED**. This PASS covers the tested source, browser, and debug-APK resource identity; it does not claim target-device or offline-upgrade acceptance. No checkout/reset/stash/clean, commit, or push was performed.
