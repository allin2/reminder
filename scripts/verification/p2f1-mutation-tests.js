#!/usr/bin/env node
/* P2-F1 in-memory mutations: healthy controls must pass and each mutant must go red. */
"use strict";
const crypto = require("crypto"), fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.resolve(__dirname, "../..");
const contentPath = path.join(ROOT, "lib/app-content.js"), corePath = path.join(ROOT, "app-core.js");
const prod = require("./production-scripts.js");
const sha = text => crypto.createHash("sha256").update(text).digest("hex");
function factory(source) { const sandbox = { module: { exports: {} }, exports: {}, setTimeout: () => 0 }; vm.runInNewContext(source, sandbox); return sandbox.module.exports.createAppContent; }
function fixture(make) {
  const state = { items: [{ id: "i", projectId: "p", rev: 1, title: "ordinary" }], notes: [{ id: "n", body: "<img onerror=1>", title: "n", projectId: "p" }], projects: [{ id: "p", name: "p" }], ui: {} };
  const nodes = {}, listeners = [], calls = { remove: 0 };
  const node = id => nodes[id] || (nodes[id] = { value: "", innerHTML: "", hidden: true, textContent: "", classList: { toggle() {} }, addEventListener: (name, fn) => listeners.push({ id, name, fn }), focus() {} });
  const app = make({ query: node, queryAll: () => [], getDocument: () => ({ addEventListener: (name, fn) => listeners.push({ id: "document", name, fn }) }),
    openSheet() {}, closeSheet() {}, toast() {}, confirmDialog: async () => false, escapeHtml: x => String(x).replace(/</g, "&lt;"), escapeAttr: x => String(x), renderMarkdown: x => String(x).replace(/</g, "&lt;"),
    getState: () => state, save() {}, render() {}, renderItemCard: x => String(x.title).replace(/</g, "&lt;"), refreshProjectSelects() {}, uid: () => "u", getProjectColors: () => ["#1b6b4a"],
    itemConflictsWithActiveAction: () => false, rejectPendingItemCommand: () => false, removeProjectFromItems: id => { calls.remove++; state.items.forEach(i => { if (i.projectId === id) { i.projectId = ""; i.rev++; } }); } });
  return { app, state, nodes, listeners, calls };
}
function main() {
  const source = fs.readFileSync(contentPath, "utf8"), core = fs.readFileSync(corePath, "utf8"), before = { content: sha(source), core: sha(core) }, results = [];
  const add = (id, anchor, healthy, mutant) => results.push({ id, anchor: { text: anchor, found: source.includes(anchor) || core.includes(anchor) }, healthy, mutant, red: healthy && !mutant });
  const bindAnchor = "if (bound) return;";
  const healthyBind = fixture(factory(source)); healthyBind.app.bind(); healthyBind.app.bind();
  const mutantBind = fixture(factory(source.replace(bindAnchor, ""))); mutantBind.app.bind(); mutantBind.app.bind();
  add("M1-bind-idempotency", bindAnchor, healthyBind.listeners.filter(x => x.id === "#btnSaveNote").length === 1, mutantBind.listeners.filter(x => x.id === "#btnSaveNote").length === 1);
  const escapeAnchor = "escapeHtml(note.body)";
  const healthyEscape = fixture(factory(source)); healthyEscape.app.doSearch("onerror");
  const mutantEscape = fixture(factory(source.replace(escapeAnchor, "note.body"))); mutantEscape.app.doSearch("onerror");
  add("M2-search-output-escape", escapeAnchor, /&lt;img/.test(healthyEscape.nodes["#searchResults"].innerHTML), /&lt;img/.test(mutantEscape.nodes["#searchResults"].innerHTML));
  const removalAnchor = "deps.removeProjectFromItems(id);";
  const healthyRemove = fixture(factory(source)); healthyRemove.app.deleteProject("p");
  const mutantRemove = fixture(factory(source.replace(removalAnchor, "/* bypassed */"))); mutantRemove.app.deleteProject("p");
  add("M3-project-removal-transaction", removalAnchor, healthyRemove.calls.remove === 1 && healthyRemove.state.items[0].projectId === "", mutantRemove.calls.remove === 1 && mutantRemove.state.items[0].projectId === "");
  const contractAnchor = 'instance: ["bind", "openNote", "saveNote", "doSearch", "renderProjectsSheet", "addProject", "deleteProject"],';
  const healthyCoverage = prod.contentInstanceCoverage(ROOT, { source: core });
  const mutantCoverage = prod.contentInstanceCoverage(ROOT, { source: core.replace(contractAnchor, "instance: [],") });
  add("M4-instance-contract", contractAnchor, healthyCoverage.missingInContract.length === 0 && healthyCoverage.unusedInContract.length === 0, mutantCoverage.missingInContract.length === 0 && mutantCoverage.unusedInContract.length === 0);
  const after = { content: sha(fs.readFileSync(contentPath, "utf8")), core: sha(fs.readFileSync(corePath, "utf8")) };
  const report = { purpose: "P2-F1 in-memory mutation proof", results, workspaceRestore: { before, after, restored: before.content === after.content && before.core === after.core } };
  console.log(JSON.stringify(report, null, 2));
  if (!report.workspaceRestore.restored || results.some(x => !x.anchor.found || !x.red)) process.exit(1);
}
main();
