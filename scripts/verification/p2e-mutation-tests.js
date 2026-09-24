#!/usr/bin/env node
/* P2-E implementation mutations. All source edits stay in memory; exit 0 means each healthy control passed and its mutant went red. */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.resolve(__dirname, "../..");
const setupPath = path.join(ROOT, "lib/app-setup.js");
const corePath = path.join(ROOT, "app-core.js");
const prod = require("./production-scripts.js");
const sha = text => crypto.createHash("sha256").update(text).digest("hex");

function factoryFrom(source) {
  const sandbox = { module: { exports: {} }, exports: {} };
  vm.runInNewContext(source, sandbox, { filename: "lib/app-setup.js" });
  return sandbox.module.exports.createAppSetup;
}

function fixture(factory, bridge) {
  const state = { settings: {}, items: [] };
  const nodes = { "#btnSetup": { addEventListener(name, fn) { (this.listeners || (this.listeners = [])).push({ name, fn }); } } };
  const toasts = [];
  const app = factory({
    query: sel => nodes[sel] || null, queryAll: () => [], openSheet: () => {}, toast: (...x) => toasts.push(x),
    escapeHtml: x => String(x), fmtTime: x => String(x), writeIfChanged: (node, html) => { if (node.innerHTML === html) return false; node.innerHTML = html; return true; },
    getState: () => state, save: () => { state.saves = (state.saves || 0) + 1; }, renderMe: () => {},
    systemBridge: () => bridge, getNativeReminders: () => ({ isNativeAndroid: () => true }),
    getNativeReminderStatus: () => ({ notificationsGranted: true, notifications: "granted", scheduledAlarmIds: [], exactAlarm: "granted" }),
    setNativeReminderStatus: () => {}, getFeedback: () => ({ TEST_FEEDBACK: [], setupSteps: () => ({ steps: [], next: null }), testFeedbackVerdict: () => null }),
    labLog: () => {}, labCancelAlarms: async () => ({ ok: true }), describeAlarmDelivery: d => d.title || "delivery",
    openBackgroundGuide: async () => false, openSystemSetting: async () => false, isNativeAndroidRuntime: () => true
  });
  return { app, state, nodes, toasts };
}

async function oldDeliveryIsIgnored(factory) {
  const h = fixture(factory, { lastAlarmDelivery: async () => ({ at: 1000, title: "安心收件箱闹钟测试" }) });
  h.state.settings.testRun = { id: 90003, startedAt: 2000, triggerAt: 62000, seenAt: null };
  const html = await h.app.setupEvidenceHtml();
  return !h.state.settings.testRun.seenAt && /还没有记录/.test(html);
}

async function readFailureIsNotEmpty(factory) {
  const h = fixture(factory, {
    activeAlarmDeliveries: async () => { throw new Error("read failed"); }, stopAlarmDelivery: async () => ({ stopped: false })
  });
  h.state.settings.testRun = { id: 90003, startedAt: 1000, triggerAt: 61000, stoppedAt: null };
  await h.app.stopSetupTestRun();
  return !h.state.settings.testRun.stoppedAt && h.toasts.some(x => /读不到铃声状态/.test(x[0]));
}

function bindIsIdempotent(factory) {
  const h = fixture(factory, {});
  h.app.bind(); h.app.bind();
  return h.nodes["#btnSetup"].listeners.length === 1;
}

async function main() {
  const setupSource = fs.readFileSync(setupPath, "utf8");
  const coreSource = fs.readFileSync(corePath, "utf8");
  const before = { "lib/app-setup.js": sha(setupSource), "app-core.js": sha(coreSource) };
  const results = [];
  const add = (id, anchor, healthy, mutant) => results.push({ id, anchor, anchorFound: anchor.ok, healthy, mutant, red: healthy === true && mutant === false });

  const deliveryAnchor = "if (!(at > 0) || at < Number(run.startedAt || 0)) return false;";
  const deliveryMutant = setupSource.replace(deliveryAnchor, "if (!(at > 0)) return false;");
  add("M1-delivery-attribution", { text: deliveryAnchor, ok: setupSource.includes(deliveryAnchor) },
    await oldDeliveryIsIgnored(factoryFrom(setupSource)), await oldDeliveryIsIgnored(factoryFrom(deliveryMutant)));

  const readAnchor = "const confirmedGone = readOk && seen === 0;";
  const readMutant = setupSource.replace(readAnchor, "const confirmedGone = seen === 0;");
  add("M2-read-failure-is-empty", { text: readAnchor, ok: setupSource.includes(readAnchor) },
    await readFailureIsNotEmpty(factoryFrom(setupSource)), await readFailureIsNotEmpty(factoryFrom(readMutant)));

  // P3-I-R：绑定改为「事务式」——`bound` 在注册成功之后才置位，失败整体回滚。
  // 锚点随实现形状更新（旧锚点是 `bound = true;` 紧跟守卫的写法），
  // 变异仍必须让「二次 bind 不翻倍」变红。
  const bindAnchor = "function bind() {\n      if (bound) return;";
  const bindMutant = setupSource.replace(bindAnchor, "function bind() {");
  add("M3-bind-idempotency", { text: bindAnchor, ok: setupSource.includes(bindAnchor) },
    bindIsIdempotent(factoryFrom(setupSource)), bindIsIdempotent(factoryFrom(bindMutant)));

  const contractAnchor = 'instance: ["bind", "maybePromptAndroidNotify", "noteFirstRemindSaved", "renderSetupEntry",\n      "updateSetupEntry", "openSetupSheet", "startSetupTestRun", "stopSetupTestRun",\n      "setupEvidenceHtml", "setupStepsContext", "renderSetupSheetBody", "runSetupStep"],';
  const contractMutant = coreSource.replace(contractAnchor, "instance: [],");
  const healthyCoverage = prod.setupInstanceCoverage(ROOT, { source: coreSource });
  const mutantCoverage = prod.setupInstanceCoverage(ROOT, { source: contractMutant });
  add("M4-instance-contract", { text: contractAnchor, ok: coreSource.includes(contractAnchor) },
    healthyCoverage.missingInContract.length === 0 && healthyCoverage.unusedInContract.length === 0,
    mutantCoverage.missingInContract.length === 0 && mutantCoverage.unusedInContract.length === 0);

  const after = { "lib/app-setup.js": sha(fs.readFileSync(setupPath, "utf8")), "app-core.js": sha(fs.readFileSync(corePath, "utf8")) };
  const restored = before["lib/app-setup.js"] === after["lib/app-setup.js"] && before["app-core.js"] === after["app-core.js"];
  const report = { purpose: "P2-E in-memory mutation proof", results, workspaceRestore: { method: "all mutations are strings evaluated in isolated VM/static source input", before, after, restored } };
  console.log(JSON.stringify(report, null, 2));
  if (!restored || results.some(x => !x.anchorFound || !x.red)) process.exit(1);
}

main().catch(error => { console.error(error && error.stack ? error.stack : error); process.exit(1); });
