# P2-F1 `app-content.js` extraction — implementation self-check

This is implementation self-check evidence for
`docs/handoff/2026-09-22-p2f1-app-content-extraction-plan.md`; it is not an
independent acceptance result.

## Scope and coverage

`lib/app-content.js` now owns notes, projects, search, the content-only static
handlers, and its one document click delegate. `app-core.js` owns state,
rendering, details/views, persistence, UI primitives, and the project-item
transaction adapter. `deleteProject()` calls the injected
`removeProjectFromItems(id)` command; the core adapter remains
`runUserOp(applyProjectRemovalToItems, [id])`.

- Direct module tests cover zero-evaluation side effects, live state access,
  idempotent static/delegate binding, note save/search escaping, project add,
  conflict refusal, and core-mediated project removal.
- Boot tests cover missing script, empty namespace, empty factory result,
  factory throw, and each missing content instance member. Each must leave
  IDB writes, scheduling, and 2/15-second business timers at zero.
- `mutations/p2f1-mutations.log` proves four in-memory mutations go red:
  binding idempotence, search escaping, bypassed item-removal command, and an
  empty instance contract. Source hashes before/after each mutation match.
- `final/browser-content.log` uses a disposable profile against the real
  production script order for ready, note create, item/note/project search,
  escaped output, project add, and core-mediated project removal.

## Validation

- `npm test`: exit 0; 2,571 passed / 0 failed in `final/npm-test.log`.
- P2-F1 browser check, P2-D diagnostics browser check, P2-E setup browser
  check, and import-format browser check: all exit 0 in `final/`.
- Syntax checks, Python compile, and `git diff --check` passed before the full
  suite. The complete source identity for this self-check is in
  `source-hashes-final.txt`; initial dirty state is retained in
  `repo-state-start.txt`.

## Boundary

No checkout, restore, reset, stash, clean, commit, push, release/APK overwrite,
package installation, device action, or production-data action was performed.
Historical evidence and candidates remain untouched.
