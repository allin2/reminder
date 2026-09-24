#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../../../../..");
const SETUP = path.join(ROOT, "lib/app-setup.js");
const CORE = path.join(ROOT, "app-core.js");
const prod = require(path.join(ROOT, "scripts/verification/production-scripts.js"));
const hash = value => crypto.createHash("sha256").update(value).digest("hex");

function loadFactory(source) {
  const sandbox = { module: { exports: {} }, exports: {} };
  vm.runInNewContext(source, sandbox, { filename: "independent-app-setup.js" });
  return sandbox.module.exports.createAppSetup;
}

function fixture(factory, bridge) {
  const state = { settings: { setupPromptStarted: true }, items: [] };
  const nodes = {
    "#btnSetup": { listeners: [], addEventListener(name, fn) { this.listeners.push({ name, fn }); } },
    "#homeSetup": { innerHTML: "" },
    "#setupEntry": { listeners: [], addEventListener(name, fn) { this.listeners.push({ name, fn }); } }
  };
  const toasts = [];
  const deps = {
    query: selector => nodes[selector] || null,
    queryAll: () => [],
    openSheet: () => {},
    toast: (...args) => toasts.push(args),
    escapeHtml: value => String(value),
    fmtTime: value => String(value),
    writeIfChanged: (node, html) => {
      if (node.innerHTML === html) return false;
      node.innerHTML = html;
      return true;
    },
    getState: () => state,
    save: () => { state.saveCount = (state.saveCount || 0) + 1; },
    renderMe: () => {},
    systemBridge: () => bridge,
    getNativeReminders: () => ({ isNativeAndroid: () => true }),
    getNativeReminderStatus: () => ({
      notifications: "granted", notificationsGranted: true,
      exactAlarm: "granted", scheduledAlarmIds: []
    }),
    setNativeReminderStatus: () => {},
    getFeedback: () => ({
      TEST_FEEDBACK: [{ value: "heard", label: "我听到了" }],
      setupSteps: () => ({
        steps: [{ id: "test", title: "60 秒测试", why: "验证", denyImpact: "不影响记录", done: false }],
        next: { id: "test" }
      }),
      testFeedbackVerdict: () => null
    }),
    labLog: () => {},
    labCancelAlarms: async () => ({ ok: true }),
    describeAlarmDelivery: value => value && value.title,
    openBackgroundGuide: async () => false,
    openSystemSetting: async () => false,
    isNativeAndroidRuntime: () => true
  };
  return { app: factory(deps), state, nodes, toasts };
}

async function rejectsWrongTitle(factory) {
  const h = fixture(factory, {
    lastAlarmDelivery: async () => ({ at: 3000, title: "普通业务提醒" })
  });
  h.state.settings.testRun = { id: 90003, startedAt: 2000, triggerAt: 62000, seenAt: null };
  const html = await h.app.setupEvidenceHtml();
  return h.state.settings.testRun.seenAt == null && /还没有记录/.test(html);
}

async function preservesUnknownOnReadFailure(factory) {
  const h = fixture(factory, {
    activeAlarmDeliveries: async () => { throw new Error("independent read failure"); },
    stopAlarmDelivery: async () => ({ stopped: false })
  });
  h.state.settings.testRun = { id: 90003, startedAt: 2000, triggerAt: 62000, stoppedAt: null };
  await h.app.stopSetupTestRun();
  return h.state.settings.testRun.stoppedAt == null &&
    h.toasts.some(row => /读不到铃声状态/.test(row[0])) &&
    !h.toasts.some(row => /没有正在响/.test(row[0]));
}

function dynamicEntryIsIdempotent(factory) {
  const h = fixture(factory, {});
  h.app.renderSetupEntry();
  h.app.renderSetupEntry();
  return h.nodes["#setupEntry"].listeners.filter(row => row.name === "click").length === 1;
}

async function main() {
  const setupSource = fs.readFileSync(SETUP, "utf8");
  const coreSource = fs.readFileSync(CORE, "utf8");
  const before = { setup: hash(setupSource), core: hash(coreSource) };
  const results = [];

  const titleAnchor = 'return String(d.title || "").indexOf("闹钟测试") >= 0;';
  const titleMutant = setupSource.replace(titleAnchor, "return true;");
  results.push({
    id: "I1-title-membership",
    anchorFound: setupSource.includes(titleAnchor) && titleMutant !== setupSource,
    healthy: await rejectsWrongTitle(loadFactory(setupSource)),
    mutant: await rejectsWrongTitle(loadFactory(titleMutant))
  });

  const readAnchor = 'readError = error && error.message ? error.message : String(error);';
  const readMutant = setupSource.replace(readAnchor, readAnchor + "\n        readOk = true;");
  results.push({
    id: "I2-read-failure-not-empty",
    anchorFound: setupSource.includes(readAnchor) && readMutant !== setupSource,
    healthy: await preservesUnknownOnReadFailure(loadFactory(setupSource)),
    mutant: await preservesUnknownOnReadFailure(loadFactory(readMutant))
  });

  const dynamicAnchor = "if (!writeIfChanged(host, html)) return;";
  const dynamicMutant = setupSource.replace(dynamicAnchor, "writeIfChanged(host, html);");
  results.push({
    id: "I3-dynamic-entry-idempotency",
    anchorFound: setupSource.includes(dynamicAnchor) && dynamicMutant !== setupSource,
    healthy: dynamicEntryIsIdempotent(loadFactory(setupSource)),
    mutant: dynamicEntryIsIdempotent(loadFactory(dynamicMutant))
  });

  const production = prod.readIndexScripts(ROOT);
  const omitted = production.filter(name => name !== "lib/app-setup.js");
  const healthyLoad = prod.coverageProblems({ root: ROOT, loaded: production });
  const omittedLoad = prod.coverageProblems({ root: ROOT, loaded: omitted });
  results.push({
    id: "I4-production-load-omission",
    anchorFound: production.includes("lib/app-setup.js") && omitted.length + 1 === production.length,
    healthy: healthyLoad.problems.length === 0,
    mutant: omittedLoad.problems.length === 0,
    mutantProblems: omittedLoad.problems
  });

  results.forEach(row => { row.red = row.anchorFound && row.healthy === true && row.mutant === false; });
  const after = {
    setup: hash(fs.readFileSync(SETUP, "utf8")),
    core: hash(fs.readFileSync(CORE, "utf8"))
  };
  const report = { results, sourceIdentity: { before, after, unchanged: before.setup === after.setup && before.core === after.core } };
  console.log(JSON.stringify(report, null, 2));
  if (!report.sourceIdentity.unchanged || results.some(row => !row.red)) process.exit(1);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
