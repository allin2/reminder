# Ownership and dirty-worktree boundary

This implementation owns the new content module and the connected P2-F1
surfaces: `lib/app-content.js`, its app-core runtime contract/adapter/forwarders,
production script lists and cache version, unit/boot harness loading and
coverage, P2-F1 mutation/browser scripts, and this evidence directory.

The worktree was already dirty. `repo-state-start.txt` records the complete
state at this self-check's evidence boundary. Existing modules, release APKs,
candidates, historical verification runs, and unrelated untracked paths are
not claimed or altered.

