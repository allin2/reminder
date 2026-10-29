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
  let value = "", fail = false, reset = false, mutations = 0;
  const plugin = {
    async set(args) { mutations++; if (fail) throw Error("write failed"); value = args.value; },
    async get() { return { value, reset }; },
    async remove() { mutations++; if (fail) throw Error("remove failed"); value = ""; }
  };
  const ai = aiModule(plugin);
  const state = { schema: 5, items: [], notes: [], projects: [], settings: { ai: { apiKey: "sentinel-secret", model: "model" } } };
  const copy = () => JSON.parse(JSON.stringify(state));
  const snapshot = await ai.prepareSnapshot(state);
  assert.equal(mutations, 0, "snapshot only redacts");
  assert.equal(JSON.stringify(snapshot).includes("sentinel-secret"), false);
  assert.equal(state.settings.ai.apiKey, "sentinel-secret", "live key remains available");
  await ai.restoreApiKey(state.settings, () => {});
  await ai.prepareSnapshot(state);
  assert.equal(value, "sentinel-secret", "migration is idempotent");
  fail = true;
  await ai.prepareSnapshot(state);
  await assert.rejects(() => ai.restoreApiKey(state.settings));
  assert.equal(state.settings.ai.apiKey, "sentinel-secret", "failure preserves original");
  await aiModule(undefined).prepareSnapshot(state);
  await assert.rejects(() => aiModule(undefined).restoreApiKey(state.settings), /安全密钥/);
  assert.equal(await aiModule(undefined, "web").prepareSnapshot(state), state, "web fallback");
  fail = false;
  const restored = { ai: {} };
  await ai.restoreApiKey(restored, () => {});
  assert.equal(restored.ai.apiKey, "sentinel-secret");
  value = ""; reset = true;
  const messages = [];
  await ai.restoreApiKey({ ai: {} }, msg => messages.push(msg));
  assert.match(messages[0], /重新填写/);
  await ai.restoreApiKey({ ai: {} });
  await ai.restoreApiKey({ ai: {} }, {});
  reset = false;
  value = "sentinel-secret";
  await ai.prepareSnapshot({ settings: { ai: { apiKey: "" } } });
  assert.equal(value, "sentinel-secret", "redaction never removes secret");
  await ai.storeApiKey("");
  assert.equal(value, "", "explicit settings clear removes secret");
  await ai.storeApiKey(state.settings.ai.apiKey);

  const noop = () => {};
  let configured = null, settingsSaves = 0;
  const inputs = {
    "#swAi": { classList: { contains: () => true } },
    "#aiBaseUrl": { value: "https://example.invalid" },
    "#aiApiKey": { value: "new-secret" }, "#aiModel": { value: "model" }
  };
  const settingsDeps = Object.fromEntries([
    "pad", "toLocalInput", "fmtTime", "fmtDate", "repeatLabel", "parseChineseTime",
    "updateRepeatPreview", "toast", "openSheet", "closeSheet", "renderMe", "onMissingConfig"
  ].map(name => [name, noop]));
  const settingsUi = ai.createAppAi({ ...settingsDeps, getSettings: () => state.settings,
    setAiConfig: next => { configured = next; }, query: key => inputs[key], queryAll: () => [],
    save: () => { settingsSaves++; } });
  fail = true;
  await settingsUi.saveAiSettings();
  assert.equal(configured, null, "failed secure write does not replace live config");
  assert.equal(settingsSaves, 0);
  fail = false;
  await settingsUi.saveAiSettings();
  assert.equal(value, "new-secret");
  assert.equal(configured.apiKey, "new-secret");
  assert.equal(settingsSaves, 1);
  await ai.storeApiKey(state.settings.ai.apiKey);

  let disk = copy(), writes = [], mirror = new Map();
  const persistence = createAppPersistence({
    key: "state", getSchema: () => 5, getItems: () => state.items, getNotes: () => [], getProjects: () => [],
    getSettings: () => state.settings, applyRecoveredState: () => [],
    getStorage: () => ({ backend: "idb", async load() { return disk; }, async save(payload) { writes.push(payload); disk = payload; } }),
    beforeReplaySnapshot: payload => ai.restoreApiKey(payload.settings),
    prepareSnapshot: ai.prepareSnapshot, hasIdb: () => true,
    readLocal: key => mirror.get(key), writeLocal: (key, raw) => mirror.set(key, raw), removeLocal: key => mirror.delete(key),
    now: () => 1, onCommitted() {}, onSaveFailure() {}
  });
  await persistence.loadAsync();
  fail = true;
  const before = mutations;
  await persistence.saveAsync();
  assert.equal(mutations, before, "ordinary save never touches secure storage");
  fail = false;
  await persistence.saveAsync();
  assert.equal(JSON.stringify(disk).includes("sentinel-secret"), false);
  assert.equal(value, "sentinel-secret");
  mirror.set("state-pending-replay", JSON.stringify({ json: JSON.stringify(copy()) }));
  fail = true;
  const writesBeforeReplay = writes.length;
  assert.equal((await persistence.loadAsync()).status, "failed");
  assert.equal(writes.length, writesBeforeReplay, "failed replay migration cannot overwrite disk");
  assert.equal(mirror.get("state-pending-replay").includes("sentinel-secret"), true);
  fail = false;
  await persistence.loadAsync();
  assert.equal(mirror.has("state-pending-replay"), false);
  assert.equal(writes.every(p => !JSON.stringify(p).includes("sentinel-secret")), true, "replay also sanitizes");

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
      assert.equal((section.match(/<exclude\b/g) || []).length, 1, "only secure preferences excluded");
      assert.doesNotMatch(section, /<include\b|app_webview|path="\."/);
    });
  }
  console.log("Secure AI key: migration, failure retention, replay, Web fallback, reset notice, export and backup rules PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
