/* P3-A direct model behavior and source mutation checks. Uses the loaded source, never string self-assertion. */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(ROOT, "lib/app-model.js"), "utf8");

function load(src) {
  const box = { module: { exports: {} }, self: {} };
  vm.runInNewContext(src, box, { filename: "lib/app-model.js" });
  return box.module.exports;
}
function make(factory) {
  let mode = "notification";
  const migrated = [];
  let sequence = 0;
  const model = factory.createAppModel({
    uid: () => "u" + (++sequence), now: () => 1700000000000,
    getDefaultDeliveryMode: () => mode,
    migrateNativeItem: item => { migrated.push(item); return item; }
  });
  return { model, migrated, setMode: x => { mode = x; } };
}
function healthy() {
  const api = load(source); const h = make(api); const m = h.model;
  const a = m.createInitialState(); const b = m.createInitialState();
  assert.notStrictEqual(a.settings, b.settings); assert.notStrictEqual(a.settings.review, b.settings.review);
  assert.notStrictEqual(a.settings.ai, b.settings.ai); assert.notStrictEqual(a.ui, b.ui);
  assert.notStrictEqual(a.ui.reviewQueue, b.ui.reviewQueue); a.settings.review.hour = 4;
  assert.strictEqual(b.settings.review.hour, 21);
  assert.strictEqual(m.SCHEMA, 5); assert.deepStrictEqual(m.PROJECT_COLORS.length, 6);
  const e1 = m.normalizeItem({ id: "a", title: "A" }); const e2 = m.normalizeItem({ id: "b", title: "B" });
  assert.notStrictEqual(e1.deadlineEvents, e2.deadlineEvents); assert.notStrictEqual(e1.reminderEvents, e2.reminderEvents);
  assert.strictEqual(e1.reminderEvents && typeof e1.reminderEvents, "object");
  h.setMode("alarm"); assert.strictEqual(m.resolveDeliveryMode("normal"), "alarm");
  const n = m.makeItem({ id: "n", title: "N", priority: "normal" }); assert.strictEqual(n.delivery_mode, "alarm");
  h.setMode(""); const emptyMode = m.makeItem({ id: "empty-mode", title: "空默认", priority: "normal" });
  assert.strictEqual(emptyMode.delivery_mode, "notification");
  const r = m.makeItem({ id: "r", title: "R", repeat: { every: "week" }, repeatParentId: "p" });
  assert.ok(r.seriesId && r.repeatParentId === "p"); assert.strictEqual(h.migrated.length, 5);
  assert.strictEqual(m.hasKnownRev(0), false); assert.strictEqual(m.hasKnownRev("2"), true);
  assert.strictEqual(m.isTerminal({ status: "completed" }), true); assert.strictEqual(m.isTerminal({ status: "waiting" }), false);
  const before = r.rev; m.bumpRev(r); assert.strictEqual(r.rev, before + 1);
  return "healthy direct behavior: PASS";
}
function mutant(name, mutate, check) {
  const mutated = mutate(source); const api = load(mutated); let failed = false;
  try { check(make(api)); } catch (_) { failed = true; }
  assert.strictEqual(failed, true, name + " did not fail the same behavior assertion");
  return name + ": mutation detected";
}
const out = [healthy()];
out.push(mutant("events fallback sharing", s => s.replace('"use strict";\n\n', '"use strict";\n  const sharedEvents = {};\n\n').replace(/: \{\},\n        reminderEvents:/, ': sharedEvents,\n        reminderEvents:').replace(/: \{\},\n        deadlinePaused:/, ': sharedEvents,\n        deadlinePaused:'), h => {
  const a = h.model.normalizeItem({ id: "a" }); const b = h.model.normalizeItem({ id: "b" }); assert.notStrictEqual(a.deadlineEvents, b.deadlineEvents);
}));
out.push(mutant("live default delivery", s => s.replace(/deps\.getDefaultDeliveryMode\(\)/g, '"notification"'), h => {
  h.setMode("alarm"); assert.strictEqual(h.model.resolveDeliveryMode("normal"), "alarm");
}));
out.push(mutant("empty default fallback", s => s.replace('(deps.getDefaultDeliveryMode() || "notification")', 'deps.getDefaultDeliveryMode()'), h => {
  h.setMode(""); assert.strictEqual(h.model.normalizeItem({ id: "empty-mode", priority: "normal" }).delivery_mode, "notification");
}));
out.push(mutant("repeat series identity", s => s.replace('"s_" + deps.uid()', 'null'), h => {
  assert.ok(h.model.makeItem({ id: "r", repeat: { every: "week" } }).seriesId);
}));
out.push(mutant("rev zero terminal gate", s => s.replace('Number.isFinite(n) && n > 0', 'Number.isFinite(n) && n >= 0'), h => {
  assert.strictEqual(h.model.hasKnownRev(0), false);
}));
console.log(out.join("\n"));
