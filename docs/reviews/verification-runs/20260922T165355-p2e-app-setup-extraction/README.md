# P2-E `app-setup.js` extraction — implementation self-check

This run closes the executable-test and evidence gap for the P2-E plan at
`docs/handoff/2026-09-22-p2e-app-setup-extraction-plan.md`. It is an
implementation self-check only, not independent acceptance.

## Source identity and worktree boundary

- Start HEAD: `3574824357dc7beb04cbd3e32aa413cd508e8484`; branch state and all pre-existing dirty paths are captured in `repo-state-start.txt`.
- End state is captured in `repo-state-end.txt`; no checkout, restore, reset, stash, clean, commit, push, APK overwrite, package install, or device action was performed.
- Exact hashes for the P2-E surfaces are in `source-hashes-start.txt` and `source-hashes-final.txt`.
- `p2e-path-diff.patch` is a review aid only. This repository was already dirty, so it is not used to claim ownership of unrelated hunks.

## Requirement coverage

| ID | Implemented executable evidence | Result |
| --- | --- | --- |
| E-UNIT | Direct real `createAppSetup(deps)` tests: zero evaluation side effects, live getters, static/dynamic binding idempotence, real-save entry, 60-second test, delivery attribution, retry feedback isolation, and stop-read boundaries | PASS |
| E-BOOT | Missing script, empty namespace, throwing factory, and each of 12 missing instance members fail before IDB writes, scheduling, or business timers | PASS |
| E-BROWSER | Production-page Web ready/hidden state plus full fake-Android instance flow: entry/sheet, setup step, 90003/60000 schedule, failed retry, attribution, feedback, stop controls, duplicate binding | PASS |
| E-MUT | Four in-memory mutations have anchor, healthy control, expected red result, and before/after source hashes | PASS |
| E-REGRESSION | Complete test suite, P2-D diagnostics browser check, and import browser check | PASS |

## Validation

- `npm test`: exit 0; raw output in `final/npm-test.log`.
- Direct `node test-unit.js`: 622 passed / 0 failed in `final/unit-test.log`.
- Direct `node test-boot-combination.js`: 434 passed / 0 failed in `final/boot-test.log`.
- `python3 scripts/verification/browser-setup-check.py`: 2 top-level cases, all required setup subchecks true; `final/browser-setup.json` and `.log`.
- P2-D diagnostics browser harness: 4/4; `final/browser-diagnostics.log`.
- Import browser harness: 11/11; `final/browser-import-format.log`.
- `node --check` for all P2-E JavaScript surfaces and `git diff --check`: exit 0; logs in `final/`.
- `node scripts/verification/p2e-mutation-tests.js`: M1 attribution, M2 read failure, M3 binding, M4 instance contract each passed healthy and failed after the isolated mutation; see `mutations/p2e-mutations.log`.

## Evidence layout

- `ownership.md` — boundary and file responsibility.
- `mutations/` — executable mutation result and exit status.
- `final/` — raw full-suite, targeted-test, browser, syntax, diff, and review-patch evidence.

## NOT_PERFORMED

See `NOT_PERFORMED.md`. Build/APK byte comparison and all device-visible notification, permission, system-settings, and test-alarm actions remain for the independent acceptance owner.
