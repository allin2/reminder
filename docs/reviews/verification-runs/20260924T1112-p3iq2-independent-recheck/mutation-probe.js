#!/usr/bin/env node
"use strict";
const fs = require("fs");
const vm = require("vm");
const crypto = require("crypto");
const sourcePath = "lib/app-views.js";
const source = fs.readFileSync(sourcePath, "utf8");
const originalHash = crypto.createHash("sha256").update(source).digest("hex");

function factory(code) {
  const box = { module: { exports: {} }, exports: {}, AttentionLib: {} };
  box.globalThis = box;
  vm.runInNewContext(code, box, { filename: sourcePath });
  return box.module.exports.createAppViews;
}
const names = [...source.match(/var need=\[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
const deps = Object.fromEntries(names.map(name => [name, () => null]));
deps.evidenceStatusFor = () => ({ state: "delivered", text: "<script>&" });
deps.escapeHtml = x => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
deps.deliveryEvidenceReadable = () => true;
deps.itemScheduleEvidence = () => ({ key: "k" });
const item = { id: "i", triggerAt: Date.now() - 1000 };
const expected = '<div class="detail-row"><dt>提醒结果</dt><dd>&lt;script&gt;&amp;（只代表系统收到了这次提醒）</dd></div>';

function checkOutput(code) {
  try {
    const instance = factory(code)(deps);
    return { pass: instance.detailReminderStatusRow(item) === expected };
  } catch (e) { return { pass: false, error: String(e) }; }
}
function checkMissingDep(code) {
  try {
    const broken = Object.assign({}, deps);
    delete broken.evidenceStatusFor;
    factory(code)(broken);
    return { pass: false, error: "missing dependency was accepted" };
  } catch (e) { return { pass: /evidenceStatusFor/.test(String(e)), error: String(e) }; }
}
function mutate(label, before, after, check) {
  if (!source.includes(before)) throw new Error("mutation anchor missing: " + label);
  const mutant = source.replace(before, after);
  if (mutant === source) throw new Error("mutation ineffective: " + label);
  const clean = check(source), changed = check(mutant);
  console.log(JSON.stringify({ label, controlPass: clean.pass, mutantPass: changed.pass, mutantError: changed.error || null }));
  if (!clean.pass || changed.pass) throw new Error("mutation did not turn formal assertion red: " + label);
}

mutate("remove-instance-method", "detailReminderStatusRow:detailReminderStatusRow,", "", checkOutput);
mutate("remove-required-dependency", "'evidenceStatusFor',", "", checkMissingDep);
mutate("remove-escaping", "escapeHtml(st.text) + escapeHtml(suffix)", "st.text + escapeHtml(suffix)", checkOutput);
const finalHash = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
if (finalHash !== originalHash) throw new Error("product source changed");
console.log("MUTATION_PROBE_PASS source=" + finalHash);
