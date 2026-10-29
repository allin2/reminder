"use strict";
const assert = require("assert/strict");
const fs = require("fs");
const vm = require("vm");
const { createAppPersistence } = require("./lib/app-persistence");
const { createAppBackup } = require("./lib/app-backup");
const { buildExport } = require("./lib/export-format");

function aiModule(plugin, platform = "android") {
  const context = { Capacitor: { getPlatform: () => platform, Plugins: { SecureKey: plugin } } };
  context.self = context;
  vm.runInNewContext(fs.readFileSync("lib/app-ai.js", "utf8"), context);
  return context.AttentionLib.AppAi;
}
(async () => {
  let value = "", fail = false, reset = false;
  const plugin = {
    async set(args) { if (fail) throw Error("write failed"); value = args.value; },
    async get() { return { value, reset }; },
    async remove() { if (fail) throw Error("remove failed"); value = ""; }
  };
  const ai = aiModule(plugin);
  const state = { schema: 5, items: [], notes: [], projects: [], settings: { ai: { apiKey: "sentinel-secret", model: "model" } } };
  const copy = () => JSON.parse(JSON.stringify(state));
  const snapshot = await ai.prepareSnapshot(state);
  assert.equal(value, "sentinel-secret");
  assert.equal(JSON.stringify(snapshot).includes("sentinel-secret"), false);
  assert.equal(state.settings.ai.apiKey, "sentinel-secret", "live key remains available");
  await ai.restoreApiKey(state.settings, () => {});
  await ai.prepareSnapshot(state);
  assert.equal(value, "sentinel-secret", "migration is idempotent");
  fail = true;
  await assert.rejects(() => ai.prepareSnapshot(state));
  assert.equal(state.settings.ai.apiKey, "sentinel-secret", "failure preserves original");
  await assert.rejects(() => aiModule(undefined).prepareSnapshot(state), /安全密钥/);
  assert.equal(await aiModule(undefined, "web").prepareSnapshot(state), state, "web fallback");
  fail = false;
  const restored = { ai: {} };
  await ai.restoreApiKey(restored, () => {});
  assert.equal(restored.ai.apiKey, "sentinel-secret");
  value = ""; reset = true;
  const messages = [];
  await ai.restoreApiKey({ ai: {} }, msg => messages.push(msg));
  assert.match(messages[0], /重新填写/);
  reset = false;
  await ai.prepareSnapshot({ settings: { ai: { apiKey: "" } } });
  assert.equal(value, "", "explicit empty key removes secret");

  let disk = copy(), writes = [], mirror = new Map();
  const persistence = createAppPersistence({
    key: "state", getSchema: () => 5, getItems: () => state.items, getNotes: () => [], getProjects: () => [],
    getSettings: () => state.settings, applyRecoveredState: () => [],
    getStorage: () => ({ backend: "idb", async load() { return disk; }, async save(payload) { writes.push(payload); disk = payload; } }),
    prepareSnapshot: ai.prepareSnapshot, hasIdb: () => true,
    readLocal: key => mirror.get(key), writeLocal: (key, raw) => mirror.set(key, raw), removeLocal: key => mirror.delete(key),
    now: () => 1, onCommitted() {}, onSaveFailure() {}
  });
  await persistence.loadAsync();
  fail = true;
  await assert.rejects(() => persistence.saveAsync());
  assert.equal(writes.length, 0, "secure write failure cannot erase old disk key");
  assert.equal(disk.settings.ai.apiKey, "sentinel-secret");
  fail = false;
  await persistence.saveAsync();
  assert.equal(JSON.stringify(disk).includes("sentinel-secret"), false);
  assert.equal(value, "sentinel-secret");
  mirror.set("state-pending-replay", JSON.stringify({ json: JSON.stringify(copy()) }));
  await persistence.loadAsync();
  assert.equal(mirror.has("state-pending-replay"), false);
  assert.equal(writes.every(p => !JSON.stringify(p).includes("sentinel-secret")), true, "replay also sanitizes");

  const noop = () => {};
  const backup = createAppBackup({ getSchema: () => 5, getState: () => state, normalizeItem: x => x,
    save: noop, render: noop, toast: noop, confirmDialog: noop, query: noop,
    isNativeAndroidRuntime: () => false, systemBridge: noop, getInflightActionDepth: () => 0 });
  const legacy = backup.buildLegacyBackupPayload();
  assert.equal(legacy.settings.ai.apiKey, "");
  assert.equal(JSON.stringify(legacy).includes("sentinel-secret"), false);
  const exported = buildExport([], { extras: { settingsSubset: { ...state.settings, apiKey: "sentinel-secret", token: "sentinel-secret" } } });
  assert.equal(JSON.stringify(exported).includes("sentinel-secret"), false);
  assert.equal(state.settings.ai.apiKey, "sentinel-secret", "exports do not mutate live credentials");

  const manifest = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  assert.match(manifest, /android:allowBackup="true"/);
  assert.match(manifest, /android:fullBackupContent="@xml\/backup_rules"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  for (const file of ["backup_rules", "data_extraction_rules"]) {
    const xml = fs.readFileSync(`android/app/src/main/res/xml/${file}.xml`, "utf8");
    const sections = file === "backup_rules" ? [xml] : [xml.match(/<cloud-backup>([\s\S]*?)<\/cloud-backup>/)[1], xml.match(/<device-transfer>([\s\S]*?)<\/device-transfer>/)[1]];
    sections.forEach(section => {
      assert.match(section, /domain="sharedpref" path="secure_ai_key.xml"/);
      assert.match(section, /domain="sharedpref" path="\."/);
      assert.match(section, /domain="root" path="app_webview\/"/);
    });
  }
  console.log("Secure AI key: migration, failure retention, replay, Web fallback, reset notice, export and backup rules PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
