/* Independent read-only P3-E counterexamples against the real extracted module. */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "../../../..");
const source = fs.readFileSync(path.join(root, "lib/app-native-coordinator.js"), "utf8");

function moduleFrom(src) {
  const box = { module: { exports: {} }, self: {}, setTimeout, clearTimeout, console };
  vm.runInNewContext(src, box, { filename: "lib/app-native-coordinator.js" });
  return box.module.exports;
}

function fixture(api, withDirectHandler) {
  const seen = { notification: [], direct: [], drains: 0, reconcile: 0, bumpNext: false };
  let hooks;
  let coordinator;
  const native = {
    isNativeAndroid: () => true,
    initialize: async opts => { hooks = opts; return { native: true, reliability: "ok" }; },
    reconcile: async () => {
      seen.reconcile++;
      if (seen.bumpNext) {
        seen.bumpNext = false;
        coordinator.bumpNativeSyncVersion();
      }
      return { native: true, reliability: "ok", scheduledAlarmIds: [] };
    },
    drainAlarmActions: async handler => {
      seen.drains++;
      await handler({ action: "ack", itemId: "i", itemRev: 1, alarmEventId: "evt-123" });
      return 1;
    },
    migrateItem: () => false
  };
  const deps = {
    getItems: () => [], getSettings: () => ({scheduledAlarmIds: []}),
    authoritativeWritesAllowed: () => true, save: () => Promise.resolve(true),
    runUserOp: (fn,args) => fn(...args), getNativeReminders: () => native,
    getEvidenceLib: () => null, onStatusChange: () => {},
    onNotificationAction: event => { seen.notification.push(event); },
    needsReviewCount: () => 0, ensureReviewSettings: () => ({}),
    promoteDue: () => false, refreshActiveAlarmPanel: async () => {}, renderMe: () => {},
    getCapacitor: () => ({ platform: "android" })
  };
  if (withDirectHandler) deps.handleAlarmAction = event => { seen.direct.push(event); };
  coordinator = api.createAppNativeCoordinator(deps);
  return { coordinator, seen, getHooks: () => hooks };
}

async function run() {
  const api = moduleFrom(source);
  const current = fixture(api, false);
  await current.coordinator.initializeNativeReminders();
  await current.getHooks().onResume();
  const action = { direct: current.seen.direct.length,
    notification: current.seen.notification.length,
    forwardedId: current.seen.notification[0] && current.seen.notification[0].alarmEventId };

  const wiredControl = fixture(api, true);
  await wiredControl.coordinator.initializeNativeReminders();
  await wiredControl.getHooks().onResume();
  const actionControl = { direct: wiredControl.seen.direct.length,
    notification: wiredControl.seen.notification.length,
    forwardedId: wiredControl.seen.direct[0] && wiredControl.seen.direct[0].alarmEventId };

  const drift = fixture(api, false);
  await drift.coordinator.initializeNativeReminders();
  const before = drift.seen.reconcile;
  drift.seen.bumpNext = true;
  await drift.coordinator.syncNativeRemindersNow();
  const driftRuns = drift.seen.reconcile - before;

  const oldBranchSource = source.replace(
    "          }\n          if (!nativeSyncPending) {\n            break;\n          }",
    "            if (!nativeSyncPending) {\n              break;\n            }\n          }");
  if (oldBranchSource === source) throw new Error("old-branch control patch missed");
  const oldBranch = fixture(moduleFrom(oldBranchSource), false);
  await oldBranch.coordinator.initializeNativeReminders();
  const oldBefore = oldBranch.seen.reconcile;
  oldBranch.seen.bumpNext = true;
  await oldBranch.coordinator.syncNativeRemindersNow();
  const oldBranchRuns = oldBranch.seen.reconcile - oldBefore;

  const result = { action, actionControl, driftRuns, oldBranchRuns,
    directRoutePass: action.direct === 1 && action.notification === 0 && actionControl.direct === 1,
    driftCompensationPass: driftRuns === 2 && oldBranchRuns === 2 };
  console.log(JSON.stringify(result, null, 2));
  if (!result.directRoutePass || !result.driftCompensationPass) process.exitCode = 2;
}
run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
