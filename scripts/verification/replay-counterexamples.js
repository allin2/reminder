/* Replay of P3-E independent reviewer counterexamples to green.
 * Tests:
 * 1. Counterexample 1: Direct alarm routing vs notification fallback, required handleAlarmAction dep, and version drift compensation.
 * 2. Counterexample 2: Production close action dismisses alert without opening detail page.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(ROOT, "lib/app-native-coordinator.js"), "utf8");
const { bootCombination } = require(path.join(ROOT, "test-boot-combination.js"));

function moduleFrom(src) {
  const box = { module: { exports: {} }, self: {}, setTimeout, clearTimeout, console };
  vm.runInNewContext(src, box, { filename: "lib/app-native-coordinator.js" });
  return box.module.exports;
}

function fixture(api) {
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
      await handler({ action: "close", itemId: "i", itemRev: 1, alarmEventId: "evt-124" });
      return 2;
    },
    migrateItem: () => false
  };
  const deps = {
    getItems: () => [], getSettings: () => ({ scheduledAlarmIds: [] }),
    authoritativeWritesAllowed: () => true, save: () => Promise.resolve(true),
    runUserOp: (fn, args) => fn(...args), getNativeReminders: () => native,
    getEvidenceLib: () => null, onStatusChange: () => {},
    onNotificationAction: event => { seen.notification.push(event); },
    handleAlarmAction: event => { seen.direct.push(event); },
    needsReviewCount: () => 0, ensureReviewSettings: () => ({}),
    promoteDue: () => false, refreshActiveAlarmPanel: async () => {}, renderMe: () => {},
    getCapacitor: () => ({ platform: "android" })
  };
  coordinator = api.createAppNativeCoordinator(deps);
  return { coordinator, seen, getHooks: () => hooks };
}

async function replayCounterexample1() {
  const api = moduleFrom(source);

  // 1. handleAlarmAction is required in REQUIRED_DEPS
  let threwMissingDep = false;
  try {
    api.createAppNativeCoordinator({
      getItems: () => [], getSettings: () => ({}), authoritativeWritesAllowed: () => true,
      save: () => Promise.resolve(true), runUserOp: fn => fn(), getNativeReminders: () => null,
      getEvidenceLib: () => null, onStatusChange: () => {}, onNotificationAction: () => {},
      needsReviewCount: () => 0, ensureReviewSettings: () => ({}), promoteDue: () => {},
      refreshActiveAlarmPanel: async () => {}, renderMe: () => {}, getCapacitor: () => null
      // missing handleAlarmAction
    });
  } catch (err) {
    if (String(err).includes("缺少依赖：handleAlarmAction")) {
      threwMissingDep = true;
    }
  }

  // 2. Direct alarm routing preserves alarmEventId and routes to handleAlarmAction, not onNotificationAction
  const wired = fixture(api);
  await wired.coordinator.initializeNativeReminders();
  await wired.getHooks().onResume();
  const directRoutePass = wired.seen.direct.length === 2 &&
    wired.seen.notification.length === 0 &&
    wired.seen.direct[0].alarmEventId === "evt-123" &&
    wired.seen.direct[1].alarmEventId === "evt-124";

  // 3. Version drift compensation: drift triggers exactly 2 runs, stable run triggers exactly 1 run
  const drift = fixture(api);
  await drift.coordinator.initializeNativeReminders();
  const beforeDrift = drift.seen.reconcile;
  drift.seen.bumpNext = true;
  await drift.coordinator.syncNativeRemindersNow();
  const driftRuns = drift.seen.reconcile - beforeDrift;

  const stable = fixture(api);
  await stable.coordinator.initializeNativeReminders();
  const beforeStable = stable.seen.reconcile;
  await stable.coordinator.syncNativeRemindersNow();
  const stableRuns = stable.seen.reconcile - beforeStable;

  const driftCompensationPass = driftRuns === 2 && stableRuns === 1;

  return {
    threwMissingDep,
    directRoutePass,
    driftCompensationPass,
    driftRuns,
    stableRuns,
    directCount: wired.seen.direct.length,
    notifCount: wired.seen.notification.length
  };
}

async function replayCounterexample2() {
  const boot = await bootCombination();
  const app = boot.app;
  if (boot.ready !== true) throw new Error("production combination not ready");

  const item = app.makeItem({ title: "close-route", status: "due", triggerAt: Date.now() - 1000 });
  app.state.items.push(item);
  await app.saveAsync();

  const event = { action: "close", itemId: item.id, itemRev: item.rev, alarmEventId: "native-close-123" };

  // Direct alarm transaction handles close cleanly without opening detail
  app.state.ui.detailId = null;
  await app.handleAlarmAction(event);
  const directDetail = app.state.ui.detailId;

  // Draining alarm actions in production coordinator routes directly to handleAlarmAction
  let drainedCount = 0;
  const nat = boot.exportOf("AttentionNativeReminders");
  if (nat) {
    nat.drainAlarmActions = async handler => {
      drainedCount++;
      await handler(event);
      return 1;
    };
  }
  app.state.ui.detailId = null;
  boot.env.fireResume();
  await new Promise(r => setTimeout(r, 50));
  const drainDetail = app.state.ui.detailId;

  // Verification: both direct invocation and resume-drain close without detail
  const directClosesWithoutDetail = directDetail === null;
  const drainClosesWithoutDetail = drainDetail === null && drainedCount === 1;

  return {
    directDetail,
    drainDetail,
    drainedCount,
    directClosesWithoutDetail,
    drainClosesWithoutDetail
  };
}

async function main() {
  console.log("=== Replaying Independent Review Counterexamples ===");
  const c1 = await replayCounterexample1();
  console.log("Counterexample 1 (Coordinator Routing & Drift Compensation):", JSON.stringify(c1, null, 2));

  const c2 = await replayCounterexample2();
  console.log("Counterexample 2 (Production Close Route & Drain Isolation):", JSON.stringify(c2, null, 2));

  const pass = c1.threwMissingDep && c1.directRoutePass && c1.driftCompensationPass &&
    c2.directClosesWithoutDetail && c2.drainClosesWithoutDetail;

  if (!pass) {
    console.error("FAIL: Replay did not pass completely");
    process.exitCode = 1;
  } else {
    console.log("PASS: Both counterexamples replayed to green successfully!");
  }
}

main().catch(err => {
  console.error("Error running replay:", err.stack || err);
  process.exitCode = 1;
});
