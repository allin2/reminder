# P2-G2 app-capture submit implementation run

- Date: 2026-09-22 Asia/Shanghai
- Scope: `lib/app-capture.js` submit orchestration; `app-core.js` narrow transaction injection and forwarding; contract/load/SW/test evidence.
- HEAD at start: `3574824357dc7beb04cbd3e32aa413cd508e8484`
- No commit, push, checkout, reset, stash, clean, production data or independent evidence directory was touched.

## Source hashes at close

```text
app-core.js       5dd1f515ab7b0202eacfde7543e0ae1111a285ede92435660d4d55da47ec6fab
lib/app-capture.js cbf3285f427c8aec7394b8305255a545e84c4ec8152faf0d1d8c6ce35da57a4b
sw.js             ff9dc3b400d53b0e13c5d92214fcdc7e8da1eb84f77fa877ebbf30fed76a4bfa
index.html        2a1de8f70de8ecf9010432e5dcda67f47a6712438b8519263031712ac41490b7
www/lib/app-capture.js and android/.../public/lib/app-capture.js
                  cbf3285f427c8aec7394b8305255a545e84c4ec8152faf0d1d8c6ce35da57a4b
```

## Checks

- `node test-unit.js`: PASS, 642/642.
- `node test-native-reminders.js`: PASS, 324/324.
- `node test-smoke.js`: PASS, 266/266.
- `node test-regressions.js`: PASS, 730/730.
- `node test-boot-combination.js`: PASS, 521/521; AI instance coverage now scans the real capture consumer and includes a negative proof that removing those consumers reports `applyToForm`/`parseCapture` as unused.
- `node --check app-core.js`, `node --check lib/app-capture.js`, `git diff --check`: PASS.
- `node scripts/verification/p2g2-mutation-tests.js`: PASS; four mutations were loaded through the real `AppCapture` factory and driven through duplicate submit, late AI/new-session, pending persistence, and reject rollback behavior. All healthy controls passed, all mutants failed the same behavior assertion, and source hashes restored. Raw JSON: `p2g2-mutation-results.json`.
- `npm run cap:sync`: PASS; `www` has 27 files and the APK public asset copy matches `www` byte-for-byte for `lib/app-capture.js`.
- `npm test`: PASS, exit 0; raw log: `npm-test.log`.

## NOT_PERFORMED

- Production Chrome real click/reload/reopen capture flows: NOT_PERFORMED in this implementation run.
- Isolated APK self-test and Android real-device save/reject/late-result verification: NOT_PERFORMED.
- Independent PASS judgment: NOT_PERFORMED; this run is implementation self-test only. The independent verifier must use the frozen source bytes and create its own run.
