/* P3-B direct behavior and source-mutation checks for the persistence instance. */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(ROOT, "lib/app-persistence.js"), "utf8");

function load(text) { const box = { module: { exports: {} }, self: {} }; vm.runInNewContext(text, box); return box.module.exports; }
function fixture(api, options) {
  options = options || {};
  let state = { schema: 5, items: [], notes: [], projects: [], settings: {} };
  const local = new Map(); const commits = []; let failSave = false;
  const storage = { backend: options.backend || "idb", async load() { if (options.loadError) throw new Error("load"); return options.initial === undefined ? null : options.initial; },
    async save(v) { if (failSave) throw new Error("save"); commits.push(v); } };
  const app = api.createAppPersistence({ key: "state", getSchema: () => state.schema, getItems: () => state.items,
    getNotes: () => state.notes, getProjects: () => state.projects, getSettings: () => state.settings,
    applyRecoveredState: v => { if (options.applyError) throw new Error("apply"); state = { schema: v.schema, items: v.items || [], notes: v.notes || [], projects: v.projects || [], settings: v.settings || {} }; return state.items; },
    getStorage: () => storage, hasIdb: () => options.hasIdb !== false, readLocal: k => local.has(k) ? local.get(k) : null,
    writeLocal: (k, v) => { if (options.writeError) throw new Error("write"); local.set(k, v); }, removeLocal: k => local.delete(k), now: () => 7,
    onCommitted: o => commits.push({ committed: true, options: o }), onSaveFailure: () => {} });
  return { app, local, commits, storage, state: () => state, setState: v => { state = v; }, fail: v => { failSave = v; } };
}
async function healthy(api) {
  const f = fixture(api); assert.strictEqual((await f.app.loadAsync()).status, "empty");
  f.state().items.push({ id: "a", title: "before" }); const first = f.app.saveAsync({ deferNativeSync: true }); await Promise.resolve(); await Promise.resolve();
  f.state().items[0].title = "after"; await first; assert.strictEqual(f.commits[0].items[0].title, "before");
  assert.strictEqual(f.app.committedItemById("a").title, "before");
  const order = []; await f.app.runCommit(async () => { order.push("bad"); throw new Error("x"); }).catch(() => {});
  await f.app.runCommit(() => order.push("next")); assert.deepStrictEqual(order, ["bad", "next"]);
  const blocked = fixture(api, { loadError: true }); await blocked.app.loadAsync(); await assert.rejects(() => blocked.app.saveAsync(), e => e.code === "state-authority-blocked");
  assert.strictEqual(blocked.commits.length, 0); assert.strictEqual(blocked.local.size, 0);
  const degraded = fixture(api, { backend: "local", initial: { schema: 5, items: [{ id: "old" }], notes: [], projects: [], settings: {} } });
  assert.strictEqual((await degraded.app.loadAsync()).status, "failed");
  const noIdb = fixture(api, { hasIdb: false, backend: "local" }); await noIdb.app.loadAsync(); noIdb.state().items.push({ id: "local" }); await noIdb.app.saveAsync(); assert.strictEqual(noIdb.local.has("state-pending-replay"), false);
  const failed = fixture(api); await failed.app.loadAsync(); failed.state().items.push({ id: "old" }); await failed.app.saveAsync(); failed.state().items[0].id = "new"; failed.fail(true);
  await assert.rejects(() => failed.app.saveAsync()); assert.strictEqual(failed.app.committedItemById("old").id, "old");
  const replay = fixture(api, { initial: { schema: 5, items: [], notes: [], projects: [], settings: {} } }); replay.local.set("state-pending-replay", JSON.stringify({ at: 1, json: JSON.stringify({ schema: 5, items: [{ id: "p" }], notes: [], projects: [], settings: {} }) })); replay.fail(true); await replay.app.loadAsync(); assert.strictEqual(replay.local.has("state-pending-replay"), true);
  return "healthy direct behavior: PASS";
}
async function mutant(name, transform) {
  const api = load(transform(source)); let failed = false;
  try { await healthy(api); } catch (_) { failed = true; }
  assert.strictEqual(failed, true, name + " did not fail healthy behavior"); return name + ": mutation detected";
}
(async () => {
  const out = [await healthy(load(source))];
  out.push(await mutant("write gate removed", s => s.replace('if (!authoritativeWritesAllowed()) {', 'if (false) {')));
  out.push(await mutant("snapshot becomes live", s => s.replace('const snapshot = JSON.parse(json);', 'const snapshot = payload || currentPayload();')));
  out.push(await mutant("FIFO locks after failure", s => s.replace('const next = commitChain.then(invoke, invoke);', 'const next = commitChain.then(invoke);').replace('commitChain = next.then(function() {}, function() {});', 'commitChain = next;')));
  out.push(await mutant("degraded mirror becomes loaded", s => s.replace('return publishLoadReport(LOAD_FAILED, "degraded-mirror-unconfirmed-authority"', 'return publishLoadReport(LOAD_LOADED, "degraded-mirror-unconfirmed-authority"')));
  out.push(await mutant("replay clears before writeback", s => s.replace('try { await getStorage().save(payload); clearPendingReplay(); }', 'try { clearPendingReplay(); await getStorage().save(payload); }')));
  out.push(await mutant("baseline updates before save", s => s.replace('await storage.save(snapshot);', 'establishCommittedBaseline(snapshot.items, true); await storage.save(snapshot);')));
  console.log(out.join("\n"));
})().catch(error => { console.error(error.stack || error); process.exit(1); });
