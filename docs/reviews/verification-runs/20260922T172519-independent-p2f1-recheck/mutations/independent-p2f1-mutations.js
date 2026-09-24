#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const root = path.resolve(__dirname, "../../../../..");
const sourcePath = path.join(root, "lib/app-content.js");
const prod = require(path.join(root, "scripts/verification/production-scripts.js"));
const source = fs.readFileSync(sourcePath, "utf8");
const hash = s => crypto.createHash("sha256").update(s).digest("hex");
const before = hash(source);

function fixture(src, conflict = false) {
  const box = { module: { exports: {} }, setTimeout() {} };
  vm.runInNewContext(src, box, { filename: "lib/app-content.js" });
  const state = { ui: {}, notes: [{ id: 'n" onmouseover="evil', title: "needle", body: "text", projectId: "p" }],
    projects: [{ id: "p", name: "project", color: "#1b6b4a" }], items: [{ id: "i", projectId: "p", rev: 1 }] };
  const nodes = new Map(), doc = { listeners: [], addEventListener(type, fn) { this.listeners.push({ type, fn }); } };
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: "", innerHTML: "", textContent: "", hidden: true,
      classList: { toggle() {} }, listeners: [], addEventListener(type, fn) { this.listeners.push({ type, fn }); }, focus() {} });
    return nodes.get(selector);
  };
  const calls = { saves: 0, removals: 0, rejects: 0 };
  const app = box.module.exports.createAppContent({
    query: node, queryAll: () => [], getDocument: () => doc, openSheet() {}, closeSheet() {}, toast() {},
    confirmDialog: async () => false,
    escapeHtml: x => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    escapeAttr: x => String(x).replace(/&/g, "&amp;").replace(/"/g, "&quot;"), renderMarkdown: x => String(x),
    getState: () => state, save: () => { calls.saves++; }, render() {}, renderItemCard: () => "", refreshProjectSelects() {},
    uid: () => "id", getProjectColors: () => ["#1b6b4a"], itemConflictsWithActiveAction: () => conflict,
    rejectPendingItemCommand: () => { calls.rejects++; return false; },
    removeProjectFromItems: id => { calls.removals++; for (const item of state.items) if (item.projectId === id) { item.projectId = ""; item.rev++; } }
  });
  return { app, state, node, doc, calls };
}

const cases = [];
function check(id, anchor, healthy, mutant) {
  const found = source.includes(anchor);
  cases.push({ id, anchorFound: found, healthy, mutant, red: found && healthy && !mutant });
}

const bindAnchor = "if (bound) return;";
function pinOnce(src) {
  const f = fixture(src); f.app.bind(); f.app.bind();
  for (const l of f.node("#swNotePin").listeners) if (l.type === "click") l.fn();
  return f.state.ui.notePin === true;
}
check("duplicate-bind-real-click", bindAnchor, pinOnce(source), pinOnce(source.replace(bindAnchor, "")));

const attrAnchor = "escapeAttr(note.id)";
function escapedNoteId(src) {
  const f = fixture(src); f.app.doSearch("needle");
  return f.node("#searchResults").innerHTML.includes('data-note="n&quot; onmouseover=&quot;evil"') &&
    !f.node("#searchResults").innerHTML.includes('data-note="n" onmouseover="evil"');
}
check("note-id-attribute-escape", attrAnchor, escapedNoteId(source), escapedNoteId(source.replace(attrAnchor, "note.id")));

const conflictAnchor = "if (affected.some(item => deps.itemConflictsWithActiveAction(item))) return deps.rejectPendingItemCommand();";
function conflictClosed(src) {
  const f = fixture(src, true); const result = f.app.deleteProject("p");
  return result === false && f.calls.rejects === 1 && f.calls.removals === 0 && f.calls.saves === 0 &&
    f.state.projects.length === 1 && f.state.notes[0].projectId === "p" && f.state.items[0].projectId === "p";
}
check("delete-active-item-conflict", conflictAnchor, conflictClosed(source), conflictClosed(source.replace(conflictAnchor, "")));

const loaded = prod.readIndexScripts(root);
const healthyCoverage = prod.coverageProblems({ root, loaded });
const mutantCoverage = prod.coverageProblems({ root, loaded: loaded.filter(x => x !== "lib/app-content.js") });
check("production-script-omission", "return { createAppContent: createAppContent };",
  healthyCoverage.problems.length === 0 && healthyCoverage.problemsOfList.length === 0,
  mutantCoverage.problems.length === 0);

const after = hash(fs.readFileSync(sourcePath, "utf8"));
const result = { cases, productHashBefore: before, productHashAfter: after, productUnchanged: before === after };
console.log(JSON.stringify(result, null, 2));
if (!result.productUnchanged || cases.some(x => !x.red)) process.exitCode = 1;
