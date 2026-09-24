#!/usr/bin/env node
"use strict";
const crypto = require("crypto"), fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.resolve(__dirname, "../..");
const viewPath = path.join(ROOT, "lib/app-views.js"), corePath = path.join(ROOT, "app-core.js");
const sha = text => crypto.createHash("sha256").update(text).digest("hex");
const METHODS = ["priorityRank","actionButton","renderItemCard","openDetail","setBadge","renderHome","renderCalendar","renderArchiveList","renderFuture","renderNotes","renderStats","syncUserMode","renderMe","renderPwaStatus","render","refreshProjectSelects","projectById","detailReminderStatusRow","homeRenderStats","resetHomeRenderStats"];
function load(source) {
  const sandbox = { module: { exports: {} }, exports: {}, AttentionLib: {}, globalThis: null };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: "app-views.js" });
  return sandbox.module.exports.createAppViews || sandbox.AttentionLib.AppViews.createAppViews;
}
function main() {
  const views = fs.readFileSync(viewPath, "utf8"), core = fs.readFileSync(corePath, "utf8");
  const before = { views: sha(views), core: sha(core) }, results = [];
  const factory = load(views);
  const required = Array.from(views.matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)).map(m => m[1])
    .filter(name => ["query","queryAll","getState","openSheet","openCapture","openDemoPreview","isAttentionDue","needsReviewItems","renderReviewEntry","inReviewHighlight","renderAiSub","ensureReviewSettings","updateSetupEntry","isTerminal","updateAppBadge","fmtTime","fmtDate","relDue","repeatLabel","dayLabel","escapeHtml","escapeAttr","safeExternalHref","sameDay","startOfDay","pad2","getNativeReminderStatus","getNativeReminders","getSwReg","isNativeAndroidRuntime","evidenceStatusFor","deliveryEvidenceReadable","itemScheduleEvidence","renderHomePre","renderFuturePre"].includes(name));
  const deps = Object.fromEntries(required.map(name => [name, () => ({ items: [], notes: [], projects: [], settings: {}, ui: {} })]));
  const instance = factory(deps);
  const healthy = METHODS.every(name => typeof instance[name] === "function");
  const mutantInstance = load(views.replace("return {priorityRank:priorityRank", "return {priorityRank:undefined"))(deps);
  const mutant = METHODS.every(name => typeof mutantInstance[name] === "function");
  results.push({ id: "M1-instance-surface", healthy, mutant, red: healthy && !mutant });
  let missingThrows = false, mutantMissingThrows = false;
  try { factory(Object.assign({}, deps, { query: undefined })); } catch (e) { missingThrows = /query/.test(String(e)); }
  try { load(views.replace("if(missing.length)throw new Error", "if(false)throw new Error"))(Object.assign({}, deps, { query: undefined })); } catch (e) { mutantMissingThrows = true; }
  results.push({ id: "M2-factory-missing-member-fail-closed", healthy: missingThrows, mutant: mutantMissingThrows, red: missingThrows && !mutantMissingThrows });
  const after = { views: sha(fs.readFileSync(viewPath, "utf8")), core: sha(fs.readFileSync(corePath, "utf8")) };
  const report = { purpose: "P2-F2 in-memory mutation proof", results, workspaceRestore: { before, after, restored: before.views === after.views && before.core === after.core } };
  console.log(JSON.stringify(report, null, 2));
  if (!report.workspaceRestore.restored || results.some(r => !r.red || (r.anchor && !r.anchor.found))) process.exit(1);
}
main();
