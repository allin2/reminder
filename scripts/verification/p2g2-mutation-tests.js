/* P2-G2: source mutations driven through the real AppCapture factory. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const ROOT = path.resolve(__dirname, "../..");
const capPath = path.join(ROOT, "lib/app-capture.js");
const corePath = path.join(ROOT, "app-core.js");
const cap = fs.readFileSync(capPath, "utf8");
const core = fs.readFileSync(corePath, "utf8");
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(source, mode) {
  const nodes = {};
  const node = id => nodes[id] || (nodes[id] = { value: "", textContent: "", innerHTML: "", hidden: false, disabled: false,
    dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, focus() {}, setAttribute() {} });
  const chips = ["normal", "important", "critical"].map(p => { const n = node("chip-" + p); n.dataset.p = p; return n; });
  const state = { items: [], ui: { editItemId: null, pendingLowConf: null }, settings: {} };
  const saveGate = deferred(), aiGate = deferred();
  const calls = { new: 0, close: 0, render: 0, toast: [], applyAi: 0 };
  const box = { module: { exports: {} }, exports: {} };
  vm.runInNewContext(source, box, { filename: "lib/app-capture.js" });
  const ai = mode === "ai" ? { ready: () => true, config: () => ({ autoOnSave: true }), parseCapture: () => aiGate.promise,
    mergedDraft: (draft, result) => Object.assign({}, draft, { text: result.title }),
    applyToForm: result => { calls.applyAi++; node("#capText").value = result.title; } } : null;
  const capture = box.module.exports.createAppCapture({
    query: sel => node(sel), queryAll: sel => sel === "#capPriority .chip" ? chips : [], getDocument: () => ({ addEventListener() {} }), getState: () => state,
    openSheet: () => {}, closeSheet: () => { calls.close++; }, refreshProjectSelects: () => {}, openDetail: () => {}, toLocalInput: ts => ts ? "2026-09-22T09:30" : "", parseLocalInput: value => value ? 123456 : null,
    parseChineseTime: text => ({ title: text, confidence: "high", trigger: 123456, deadline: null, repeat: null }), nextRepeatPreview: () => [], fmtDate: () => "date", fmtTime: () => "time", repeatLabel: () => "repeat",
    getFeedback: () => ({ captureSummary: () => ({ empty: false, text: "summary" }), saveFeedback: () => ({ text: "failed", actionLabel: "retry" }) }), escapeHtml: x => String(x), escapeAttr: x => String(x),
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id), fallbackTriggerAt: () => 123456, hasSpecificTimeWord: () => false,
    makeItem: fields => Object.assign({ id: "new-1" }, fields), resolveDeliveryMode: () => "notification", detectNeedsReview: () => false, runEditCommand: () => true,
    runNewCommand: item => { calls.new++; state.items.push(item); }, rollbackNewItem: id => { state.items = state.items.filter(x => x.id !== id); }, save: () => saveGate.promise,
    render: () => { calls.render++; }, announceSaveOutcome: () => {}, noteFirstRemindSaved: () => {}, queueNativeReminderSync: () => {}, toast: msg => calls.toast.push(msg), getAi: () => ai
  });
  capture.resetItemSheet();
  return { capture, node, state, saveGate, aiGate, calls };
}
async function settle() { await Promise.resolve(); await Promise.resolve(); }
async function duplicate(source) { const h = harness(source); h.node("#capText").value = "重复事项"; h.capture.saveItemFromForm(); h.capture.saveItemFromForm(); return h.calls.new === 1; }
async function lateSession(source) { const h = harness(source, "ai"); h.node("#capText").value = "第一份"; h.capture.saveItemFromForm(); h.capture.resetItemSheet(); h.node("#capText").value = "第二份"; h.aiGate.resolve({ title: "AI 第一份" }); await settle(); return h.node("#capText").value === "第二份"; }
async function pending(source) { const h = harness(source); h.node("#capText").value = "待保存"; h.capture.saveItemFromForm(); await settle(); return h.calls.close === 0; }
async function rollback(source) { const h = harness(source); h.node("#capText").value = "失败事项"; h.capture.saveItemFromForm(); h.saveGate.reject(new Error("persist-failed")); await settle(); return h.state.items.length === 0; }
async function run(name, mutant, behavior, anchor) { const healthy = await behavior(cap); const mutantBroken = !(await behavior(mutant)); return { name, anchor, healthy, mutantBroken, red: healthy && mutantBroken }; }
(async () => {
  const anchors = { token: "saveSubmitsInFlight.has(submitToken)", session: "session() === frozenSession && formDraftSignature(snapshotItemForm()) === frozenSig", pending: "const pendingNew = save();", rollback: "rollbackNewItem(newId);" };
  const results = [await run("M1-token-gate", cap.split(anchors.token).join("false"), duplicate, anchors.token), await run("M2-session-signature-gate", cap.replace(anchors.session, "true"), lateSession, anchors.session), await run("M3-authoritative-save-promise", cap.replace(anchors.pending, "const pendingNew = Promise.resolve();"), pending, anchors.pending), await run("M4-failure-rollback", cap.replace(anchors.rollback, "/* rollback removed */"), rollback, anchors.rollback)];
  const before = { capture: sha(cap), core: sha(core) }, after = { capture: sha(fs.readFileSync(capPath, "utf8")), core: sha(fs.readFileSync(corePath, "utf8")) };
  const report = { purpose: "P2-G2 behavioral mutation proof", results, sourceHashes: { before, after }, workspaceRestore: before.capture === after.capture && before.core === after.core };
  console.log(JSON.stringify(report, null, 2)); if (!report.workspaceRestore || results.some(x => !x.red)) process.exit(1);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
