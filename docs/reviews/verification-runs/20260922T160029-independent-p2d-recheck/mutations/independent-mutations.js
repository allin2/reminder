"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../../../../..");
const diagPath = path.join(ROOT, "lib/app-diagnostics.js");
const corePath = path.join(ROOT, "app-core.js");
const prod = require(path.join(ROOT, "scripts/verification/production-scripts.js"));
const source = fs.readFileSync(diagPath, "utf8");
const coreSource = fs.readFileSync(corePath, "utf8");
const results = [];

function load(sourceText) {
  const ctx = { console, Date, Map, Promise, setTimeout, clearTimeout };
  ctx.self = ctx;
  vm.runInNewContext(sourceText, ctx, { filename: "app-diagnostics-mutation.js" });
  return ctx.AttentionLib.AppDiagnostics;
}

function deps(counter) {
  const node = () => ({
    textContent: "", className: "", style: {}, disabled: false, hidden: false,
    classList: { contains: () => false, add() {}, remove() {} },
    addEventListener() { counter.listeners++; }
  });
  return {
    query: node, queryAll: () => [], openSheet() {}, toast() {}, fmtTime: () => "",
    getState: () => ({ settings: { notify: true }, items: [] }),
    save() {}, renderMe() {}, systemBridge: () => null, appSettingsPlugin: () => null,
    getNativeReminderStatus: () => ({}), setNativeReminderStatus() {},
    requestNativeNotificationPermission: async () => ({}),
    openExactAlarmSettings: async () => {}, buildDesired: () => [],
    syncNativeRemindersNow: async () => ({}), getCapacitor: () => null,
    getDocument: () => ({
      visibilityState: "visible",
      addEventListener() { counter.listeners++; }
    })
  };
}

function instance(sourceText, counter) {
  return load(sourceText).createAppDiagnostics(deps(counter || { listeners: 0 }));
}

function record(name, anchorHit, baselinePass, mutantPass, observed) {
  const detected = !!anchorHit && !!baselinePass && !mutantPass;
  results.push({ name, anchorHit: !!anchorHit, baselinePass: !!baselinePass,
    mutantPass: !!mutantPass, detected, observed });
}

const baseDelivery = {
  attempted: true, at: 1, screenOn: false, locked: true,
  notifyEnabledAtDelivery: false, carrierSound: "native"
};
const carrierAnchor =
  'const carrierKnown = d.carrierSound === "native" || d.carrierSound === "activity";';
const carrierMutation = source.replace(carrierAnchor, "const carrierKnown = false;");
const carrierBaseline = instance(source).describeAlarmDelivery(baseDelivery);
const carrierMutant = instance(carrierMutation).describeAlarmDelivery(baseDelivery);
record("carrier-precedence", carrierMutation !== source,
  carrierBaseline.label === "已响未亮",
  carrierMutant.label === "已响未亮",
  { baseline: carrierBaseline, mutant: carrierMutant });

const snapshotAnchor =
  'const overlayAt = d.overlayAtDelivery !== undefined ? !!d.overlayAtDelivery : !!d.canDrawOverlays;';
const snapshotMutation = source.replace(snapshotAnchor, "const overlayAt = !!d.canDrawOverlays;");
const snapshotInput = {
  attempted: true, at: 1, screenOn: true, locked: false,
  notifyEnabledAtDelivery: true, overlayAtDelivery: false, canDrawOverlays: true,
  fsiAtDelivery: true, canUseFullScreenIntent: true, notificationPosted: false
};
const snapshotBaseline = instance(source).describeAlarmDelivery(snapshotInput);
const snapshotMutant = instance(snapshotMutation).describeAlarmDelivery(snapshotInput);
record("delivery-snapshot-precedence", snapshotMutation !== source,
  snapshotBaseline.text.includes("缺「显示在其他应用上层」"),
  snapshotMutant.text.includes("缺「显示在其他应用上层」"),
  { baseline: snapshotBaseline.text, mutant: snapshotMutant.text });

const bindAnchor = "      if (bound) return;\n";
const bindMutation = source.replace(bindAnchor, "");
const baseCounter = { listeners: 0 };
const baseInstance = instance(source, baseCounter);
baseInstance.bind();
const baseAfterFirst = baseCounter.listeners;
baseInstance.bind();
const baseAfterSecond = baseCounter.listeners;
const mutantCounter = { listeners: 0 };
const mutantInstance = instance(bindMutation, mutantCounter);
mutantInstance.bind();
const mutantAfterFirst = mutantCounter.listeners;
mutantInstance.bind();
const mutantAfterSecond = mutantCounter.listeners;
record("bind-idempotence", bindMutation !== source,
  baseAfterFirst > 0 && baseAfterSecond === baseAfterFirst,
  mutantAfterFirst > 0 && mutantAfterSecond === mutantAfterFirst,
  { baseline: [baseAfterFirst, baseAfterSecond], mutant: [mutantAfterFirst, mutantAfterSecond] });

const actualScripts = prod.readIndexScripts(ROOT);
const completeCoverage = prod.coverageProblems({ root: ROOT, loaded: actualScripts });
const omitted = actualScripts.filter(s => s !== "lib/app-diagnostics.js");
const omittedCoverage = prod.coverageProblems({ root: ROOT, loaded: omitted });
record("production-load-closure", actualScripts.includes("lib/app-diagnostics.js"),
  completeCoverage.problems.length === 0,
  omittedCoverage.problems.length === 0,
  { omittedProblems: omittedCoverage.problems });

const contractAnchor = '"bind", "refreshNotifyLab", "labLog", "labCancelAlarms",';
const contractMutation = coreSource.replace(contractAnchor,
  '"bind", "refreshNotifyLab", "labCancelAlarms",');
const baselineCoverage = prod.diagnosticsInstanceCoverage(ROOT, { source: coreSource });
const mutantCoverage = prod.diagnosticsInstanceCoverage(ROOT, { source: contractMutation });
record("instance-contract-member", contractMutation !== coreSource,
  baselineCoverage.missingInContract.length === 0,
  mutantCoverage.missingInContract.length === 0,
  { baseline: baselineCoverage.missingInContract, mutant: mutantCoverage.missingInContract });

const output = { allDetected: results.every(r => r.detected), results };
console.log(JSON.stringify(output, null, 2));
process.exit(output.allDetected ? 0 : 1);
