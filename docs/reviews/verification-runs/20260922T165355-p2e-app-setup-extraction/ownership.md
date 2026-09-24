# Ownership and dirty-worktree boundary

The repository had extensive existing modifications and untracked files before this evidence run. They remain preserved in `repo-state-start.txt` and `repo-state-end.txt`.

This P2-E self-check adds or extends only these verification surfaces:

- `test-unit.js`: direct, real `lib/app-setup.js` factory tests.
- `test-boot-combination.js`: AppSetup static-contract mutation and first-boot fail-closed cases.
- `scripts/verification/browser-setup-check.py`: real production-page plus fake-Android setup behavior harness.
- `scripts/verification/p2e-mutation-tests.js`: in-memory P2-E mutation runner.
- this new verification-run directory.

The implementation module, app-core loading chain, service worker, index, Android assets, APKs, historical runs, and any source edits outside the named verification sections are not claimed as modifications by this self-check. No existing file was restored or overwritten.
