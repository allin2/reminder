"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const root = process.cwd();
const source = fs.readFileSync(path.join(root, "lib/app-persistence.js"), "utf8");
function load(src) {
  const box = { module: { exports: {} }, self: {} };
  vm.runInNewContext(src, box, { filename: "app-persistence-under-test.js" });
  return box.module.exports;
}
function tick() { return new Promise(resolve => setImmediate(resolve)); }
function fixture(api, opts = {}) {
  let state = opts.state || { schema: 5, items: [], notes: [], projects: [], settings: {} };
  const local = new Map(opts.local || []);
  const saves = [];
  const commits = [];
  const failures = [];
  let storageGets = 0;
  let saveMode = opts.saveMode || "resolve";
  const waiters = [];
  const storage = {
    backend: opts.backend || "idb",
    async load() {
      if (opts.loadError) throw new Error("authority-read-failed");
      return opts.initial === undefined ? null : opts.initial;
    },
    async save(value) {
      saves.push(value);
      if (saveMode === "reject") throw new Error("authority-save-failed");
      if (saveMode === "hold") await new Promise((resolve, reject) => waiters.push({resolve, reject}));
      return true;
    },
    reopen() { commits.push({ reopen: true }); return true; }
  };
  const deps = {
    key: "independent-state",
    getSchema: () => state.schema,
    getItems: () => state.items,
    getNotes: () => state.notes,
    getProjects: () => state.projects,
    getSettings: () => state.settings,
    applyRecoveredState: value => {
      if (opts.applyError) throw new Error("apply-failed");
      state = { schema: value.schema, items: value.items || [], notes: value.notes || [], projects: value.projects || [], settings: value.settings || {} };
      return state.items;
    },
    getStorage: () => { storageGets += 1; return storage; },
    hasIdb: () => opts.hasIdb !== false,
    readLocal: key => local.has(key) ? local.get(key) : null,
    writeLocal: (key, value) => local.set(key, value),
    removeLocal: key => local.delete(key),
    now: () => 123456,
    onCommitted: options => commits.push({ committed: true, options }),
    onSaveFailure: error => failures.push(error)
  };
  const app = api.createAppPersistence(deps);
  return { app, local, saves, commits, failures, storage, storageGets: () => storageGets,
    state: () => state, setState: value => { state = value; }, setSaveMode: value => { saveMode = value; }, waiters };
}
async function scenarios(api) {
  assert.strictEqual(typeof api.createAppPersistence, "function");
  assert.throws(() => api.createAppPersistence({}), /缺少依赖/);

  const lazy = fixture(api);
  assert.strictEqual(lazy.storageGets(), 0, "factory must not open storage");
  assert.strictEqual(lazy.app.authoritySnapshot().status, "unconfirmed");
  await assert.rejects(lazy.app.saveAsync(), e => e && e.code === "state-authority-blocked");
  assert.strictEqual(lazy.storageGets(), 0, "blocked write must not touch storage");
  assert.strictEqual(lazy.app.authoritySnapshot().blockedWriteCount, 1);
  assert.strictEqual(lazy.local.size, 0);

  const loaded = fixture(api, { initial: { schema: 5, items: [{ id: "base", title: "base" }], notes: [], projects: [], settings: {} } });
  const report = await loaded.app.loadAsync();
  assert.strictEqual(report.status, "loaded");
  assert.strictEqual(report.reason, "authoritative");
  loaded.state().items[0].title = "live-change";
  assert.strictEqual(loaded.app.committedItemById("base").title, "base", "baseline must be deep and committed");

  loaded.setSaveMode("hold");
  loaded.state().items = [{ id: "one", title: "one" }];
  const first = loaded.app.saveAsync({ deferNativeSync: true });
  while (loaded.saves.length < 1) await tick();
  loaded.state().items[0].title = "after-first-snapshot";
  loaded.state().items.push({ id: "two", title: "two" });
  const second = loaded.app.saveAsync({ marker: "second" });
  await tick();
  assert.strictEqual(loaded.saves.length, 1, "FIFO must keep second save queued");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(loaded.saves[0].items)), [{ id: "one", title: "one" }]);
  loaded.waiters.shift().resolve();
  await first;
  while (loaded.saves.length < 2) await tick();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(loaded.saves[1].items)), [{ id: "one", title: "after-first-snapshot" }, { id: "two", title: "two" }]);
  loaded.waiters.shift().resolve();
  await second;
  assert.strictEqual(loaded.commits[0].options.deferNativeSync, true);
  assert.strictEqual(loaded.commits[1].options.marker, "second");

  const release = fixture(api);
  await release.app.loadAsync();
  release.state().items.push({ id: "committed-old" });
  await release.app.saveAsync();
  assert.strictEqual(release.app.committedItemById("committed-old").id, "committed-old");
  release.state().items[0].id = "uncommitted-new";
  release.setSaveMode("reject");
  await assert.rejects(release.app.saveAsync());
  assert.strictEqual(release.app.committedItemById("committed-old").id, "committed-old", "failed save must not advance baseline");
  assert.strictEqual(release.app.committedItemById("uncommitted-new"), null);
  release.setSaveMode("resolve");
  release.state().items.push({ id: "survives" });
  await release.app.saveAsync();
  assert.strictEqual(release.saves.length, 3, "failure must not lock FIFO");

  const degraded = fixture(api, { backend: "local", initial: { schema: 5, items: [{ id: "mirror" }], notes: [], projects: [], settings: {} }, local: [["independent-state", "mirror-bytes"]] });
  assert.strictEqual((await degraded.app.loadAsync()).status, "failed");
  await assert.rejects(degraded.app.saveAsync(), e => e && e.code === "state-authority-blocked");
  assert.strictEqual(degraded.local.has("independent-state-pending-replay"), false);

  const localOnly = fixture(api, { hasIdb: false, backend: "local", initial: { schema: 5, items: [], notes: [], projects: [], settings: {} } });
  assert.strictEqual((await localOnly.app.loadAsync()).status, "loaded");
  localOnly.state().items.push({ id: "local" });
  await localOnly.app.saveAsync();
  assert.strictEqual(localOnly.local.has("independent-state-pending-replay"), false);

  const pendingPayload = { schema: 5, items: [{ id: "pending" }], notes: [], projects: [], settings: {} };
  const replay = fixture(api, { initial: { schema: 5, items: [{ id: "older" }], notes: [], projects: [], settings: {} }, local: [["independent-state-pending-replay", JSON.stringify({ at: 1, json: JSON.stringify(pendingPayload) })]], saveMode: "reject" });
  const replayReport = await replay.app.loadAsync();
  assert.strictEqual(replayReport.status, "loaded");
  assert.strictEqual(replayReport.reason, "pending-replay");
  assert.strictEqual(replay.local.has("independent-state-pending-replay"), true, "failed replay writeback must retain credential");
  assert.strictEqual(replay.app.committedItemById("pending").id, "pending");
  replay.setSaveMode("resolve");
  assert.strictEqual((await replay.app.loadAsync()).status, "loaded");
  assert.strictEqual(replay.local.has("independent-state-pending-replay"), false);

  const applyBad = fixture(api, { initial: { schema: 5, items: [], notes: [], projects: [], settings: {} }, applyError: true,
    local: [["independent-state-pending-replay", JSON.stringify({ at: 1, json: JSON.stringify(pendingPayload) })]] });
  const badReport = await applyBad.app.loadAsync();
  assert.strictEqual(badReport.status, "failed");
  assert.strictEqual(badReport.reason, "pending-replay-failed");
  await assert.rejects(applyBad.app.saveAsync(), e => e && e.code === "state-authority-blocked");
  assert.strictEqual(applyBad.local.has("independent-state-pending-replay"), true);

  assert.strictEqual(loaded.app.reopen(), true);
  return true;
}
async function mutated(label, transform) {
  let red = false;
  try { await scenarios(load(transform(source))); } catch (_) { red = true; }
  assert.strictEqual(red, true, label + " mutation escaped");
  return label;
}
(async () => {
  await scenarios(load(source));
  const detected = [];
  detected.push(await mutated("gate", s => s.replace("if (!authoritativeWritesAllowed()) {", "if (false) {")));
  detected.push(await mutated("live-snapshot", s => s.replace("const snapshot = JSON.parse(json);", "const snapshot = payload || currentPayload();")));
  detected.push(await mutated("fifo-lock", s => s.replace("const next = commitChain.then(invoke, invoke);", "const next = commitChain.then(invoke);").replace("commitChain = next.then(function() {}, function() {});", "commitChain = next;")));
  detected.push(await mutated("degraded-promoted", s => s.replace('return publishLoadReport(LOAD_FAILED, "degraded-mirror-unconfirmed-authority"', 'return publishLoadReport(LOAD_LOADED, "degraded-mirror-unconfirmed-authority"')));
  detected.push(await mutated("early-replay-clear", s => s.replace("try { await getStorage().save(payload); clearPendingReplay(); }", "try { clearPendingReplay(); await getStorage().save(payload); }")));
  detected.push(await mutated("early-baseline", s => s.replace("await storage.save(snapshot);", "establishCommittedBaseline(snapshot.items); await storage.save(snapshot);")));
  console.log(JSON.stringify({ healthy: true, mutationsDetected: detected, sourceSha256: require("crypto").createHash("sha256").update(source).digest("hex") }, null, 2));
})().catch(error => { console.error(error.stack || error); process.exit(1); });
