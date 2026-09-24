const path = require("path");
const mod = require(path.resolve("lib/app-backup.js"));

function clone(x) { return JSON.parse(JSON.stringify(x)); }

class FakeFileReader {
  constructor() { this.onload = null; this.onerror = null; this.onabort = null; FakeFileReader.last = this; }
  readAsText() {}
}
global.FileReader = FakeFileReader;

const base = {
  items: [{ id: "old-item", title: "保留事项", status: "waiting" }],
  notes: [{ id: "old-note", text: "保留备注", createdAt: 1 }],
  projects: [{ id: "old-project", name: "保留项目", color: "#000" }],
  settings: {
    notify: true, dnd: false, importantRepeat: true, quietStart: "22:00",
    quietEnd: "07:00", dailySummary: false, privacyNotify: true,
    defaultDeliveryMode: "notification", userMode: "beginner",
    ai: { enabled: false, baseUrl: "", apiKey: "", model: "", autoOnSave: false }
  }
};

const valid = {
  app: "attention-inbox",
  schema: 5,
  exportedAt: "2026-09-22T12:00:00.000Z",
  items: [{ id: "new-item", title: "新事项", status: "waiting" }],
  notes: [{ id: "new-note", text: "新备注", createdAt: 2 }],
  projects: [{ id: "new-project", name: "新项目", color: "#fff" }],
  settings: {
    notify: false, dnd: true, importantRepeat: false, quietStart: "23:00",
    quietEnd: "06:00", dailySummary: true, privacyNotify: false,
    defaultDeliveryMode: "alarm", userMode: "normal",
    ai: { enabled: false, baseUrl: "", apiKey: "", model: "m", autoOnSave: false }
  }
};

async function runCase(name, mutate) {
  const state = clone(base);
  const calls = { confirm: 0, save: 0, render: 0, toast: [] };
  const deps = {
    getSchema: () => 5,
    getState: () => state,
    normalizeItem: (it) => ({
      id: it.id || "generated-id",
      title: it.title || "未命名",
      status: it.status || "waiting"
    }),
    save: async () => { calls.save++; },
    render: () => { calls.render++; },
    toast: (m) => { calls.toast.push(m); },
    confirmDialog: async () => { calls.confirm++; return true; },
    query: () => null,
    isNativeAndroidRuntime: () => false,
    systemBridge: () => null,
    getInflightActionDepth: () => 0
  };
  const payload = clone(valid);
  mutate(payload);
  const before = JSON.stringify(state);
  const backup = mod.createAppBackup(deps);
  backup.importDataFile({ name: name + ".json" });
  FakeFileReader.last.result = JSON.stringify(payload);
  await FakeFileReader.last.onload();
  const after = JSON.stringify(state);
  return {
    name,
    accepted: calls.save === 1 && calls.render === 1,
    stateChanged: before !== after,
    calls,
    final: state
  };
}

(async () => {
  const cases = [
    ["valid-schema5", () => {}],
    ["valid-schema2", p => { p.schema = 2; }],
    ["foreign-app", p => { p.app = "other-app"; }],
    ["missing-app", p => { delete p.app; }],
    ["future-schema", p => { p.schema = 999; }],
    ["schema-string", p => { p.schema = "5"; }],
    ["too-old-schema", p => { p.schema = 1; }],
    ["missing-notes", p => { delete p.notes; }],
    ["notes-object", p => { p.notes = { id: "x" }; }],
    ["projects-object", p => { p.projects = { id: "x" }; }],
    ["settings-array", p => { p.settings = ["x"]; }],
    ["settings-unknown", p => { p.settings.injected = "persist-me"; }],
    ["top-level-unknown", p => { p.injected = "ignored-but-accepted"; }],
    ["empty-item", p => { p.items = [{}]; }],
    ["number-item", p => { p.items = [7]; }],
    ["null-item", p => { p.items = [null]; }],
    ["duplicate-item-id", p => { p.items = [{id:"dup",title:"A"},{id:"dup",title:"B"}]; }],
    ["ai-secret-and-endpoint", p => { p.settings.ai.apiKey = "secret"; p.settings.ai.baseUrl = "http://evil.invalid"; }]
  ];
  const out = [];
  for (const [name, mutate] of cases) out.push(await runCase(name, mutate));
  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
