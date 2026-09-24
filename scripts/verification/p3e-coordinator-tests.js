/* P3-E direct native reminder coordinator behavior and source mutation checks.
 * Uses the loaded source in temporary context, never rewriting the product file.
 */
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const targetPath = path.join(ROOT, "lib/app-native-coordinator.js");
const source = fs.readFileSync(targetPath, "utf8");
const hashBefore = crypto.createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");

function load(src) {
  const box = {
    module: { exports: {} },
    self: {},
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Date: Date,
    Map: Map,
    Set: Set,
    JSON: JSON,
    Array: Array,
    Object: Object,
    Promise: Promise,
    console: console,
    Number: Number,
    String: String
  };
  vm.runInNewContext(src, box, { filename: "lib/app-native-coordinator.js" });
  return box.module.exports;
}

function fixture(api, options) {
  options = options || {};
  let authoritativeWritesAllowed = options.authoritativeWritesAllowed !== undefined ? options.authoritativeWritesAllowed : true;
  let items = options.items || [];
  let settings = options.settings || { notify: true, dnd: false, scheduledAlarmIds: [], scheduledAlarmSignatures: {} };
  let saves = [];
  let statusChanges = [];
  let notificationActions = [];
  let reconcileCount = 0;
  let reconcileDelayMs = options.reconcileDelayMs || 0;
  let bridgeReady = options.bridgeReady !== undefined ? options.bridgeReady : true;
  let bridgeWaitCount = 0;
  let platform = options.platform || "android";
  let initializeCount = 0;
  let hooks = null;
  let alarmActions = [];

  const mockNativeReminders = {
    isNativeAndroid: () => bridgeReady,
    initialize: async (opts) => {
      initializeCount++;
      hooks = opts;
      return { native: true, notifications: "granted", exactAlarm: "granted", reliability: "exact" };
    },
    reconcile: async (snapshotItems, snapshotSettings, now, review, opts) => {
      reconcileCount++;
      if (reconcileDelayMs > 0) {
        await new Promise(r => setTimeout(r, reconcileDelayMs));
      }
      if (options.onReconcile) {
        options.onReconcile();
      }
      return options.reconcileResult || {
        reliability: "exact",
        scheduledAlarmIds: ["alarm-1"],
        scheduledAlarmSignatures: { "alarm-1": "sig-1" },
        deadlineEvents: [
          { itemId: "it-1", stageKey: "due@1000", at: 1000 }
        ],
        reminderEvents: [
          { itemId: "it-1", key: "rem@2000", at: 2000 }
        ]
      };
    },
    drainAlarmActions: async (handler) => {
      let count = 0;
      if (options.drainEvents) {
        for (const ev of options.drainEvents) {
          await handler(ev);
          count++;
        }
      }
      return count;
    },
    getDeliveryEvidence: async (opts) => {
      return options.deliveryEvidenceResult || {
        available: true,
        reason: "ok",
        retention: { days: 7 },
        rows: [
          { itemId: "it-1", reminderKey: "rem@2000", itemRev: 1, carrier: "notification", receivedAt: 2005 }
        ]
      };
    },
    migrateItem: (it) => false
  };

  const mockEvidenceLib = {
    normalizeEvidence: (rows, source) => {
      return (rows || []).map(r => ({
        valid: true,
        itemId: r.itemId,
        reminderKey: r.reminderKey,
        itemRev: r.itemRev,
        carrier: r.carrier || "notification",
        receivedAt: r.receivedAt || Date.now()
      }));
    },
    mergeEvidence: (targetItems, evidences, at) => {
      const it = targetItems[0];
      if (!it) return { changed: false };
      it.evidenceMerged = true;
      if (!it.reminderEvents) it.reminderEvents = {};
      evidences.forEach(ev => {
        if (ev.reminderKey) {
          const old = it.reminderEvents[ev.reminderKey] || {};
          it.reminderEvents[ev.reminderKey] = Object.assign({}, old, {
            state: "delivered",
            at: ev.receivedAt,
            roundBase: old.roundBase != null ? old.roundBase : 2000
          });
        }
      });
      return { changed: true };
    }
  };

  const deps = {
    getItems: () => items,
    getSettings: () => settings,
    authoritativeWritesAllowed: () => authoritativeWritesAllowed,
    save: (opts) => {
      saves.push(opts ? Object.assign({}, opts) : {});
      return Promise.resolve(true);
    },
    runUserOp: (fn, args, opts) => fn.apply(null, args || []),
    getNativeReminders: () => mockNativeReminders,
    getEvidenceLib: () => mockEvidenceLib,
    onStatusChange: (status, origin) => {
      statusChanges.push({ status: Object.assign({}, status), origin });
    },
    onNotificationAction: (action) => {
      notificationActions.push(action);
    },
    handleAlarmAction: (event) => {
      alarmActions.push(event);
      return options.onAlarmAction ? options.onAlarmAction(event) : Promise.resolve(true);
    },
    needsReviewCount: () => 0,
    ensureReviewSettings: () => ({}),
    promoteDue: () => false,
    refreshActiveAlarmPanel: async () => {},
    renderMe: () => {},
    isNativeAndroidRuntime: () => platform === "android",
    waitForNativeBridge: async () => bridgeReady,
    getCapacitor: () => ({
      platform: platform,
      getPlatform: () => platform
    })
  };

  const coordinator = api.createAppNativeCoordinator(deps);

  return {
    coordinator,
    deps,
    mockNativeReminders,
    mockEvidenceLib,
    setBridgeReady: (v) => { bridgeReady = v; },
    setAuthoritativeWritesAllowed: (v) => { authoritativeWritesAllowed = v; },
    getSaves: () => saves,
    getStatusChanges: () => statusChanges,
    getReconcileCount: () => reconcileCount,
    getInitializeCount: () => initializeCount,
    getItems: () => items,
    getSettings: () => settings,
    getAlarmActions: () => alarmActions,
    getNotificationActions: () => notificationActions,
    getHooks: () => hooks
  };
}

async function healthy(api) {
  // 1. blockedByAuthority 计数递增且 0 次对账
  {
    const f = fixture(api, { authoritativeWritesAllowed: false });
    f.coordinator.queueNativeReminderSync("user-edit");
    const metrics = f.coordinator.getNativeSyncMetrics();
    assert.strictEqual(metrics.blockedByAuthority, 1, "blockedByAuthority must increment by 1");
    assert.strictEqual(metrics.runs, 0, "runs must be 0 when blocked by authority");
    assert.strictEqual(f.getReconcileCount(), 0, "reconcile must not be called when authority writes blocked");
  }

  // 2. scheduledAlarmIds / scheduledAlarmSignatures 回写 settings，单次漂移补偿排程（runs = 2）且稳定轮次不自激（runs = 1）
  {
    let shouldTriggerDrift = false;
    let coordRef;
    const item1 = { id: "it-1", deadlineAt: 1000, triggerAt: 2000 };
    const f = fixture(api, {
      items: [item1],
      reconcileDelayMs: 20,
      onReconcile: () => {
        if (shouldTriggerDrift && coordRef) {
          shouldTriggerDrift = false; // 单次漂移，防止无限循环
          coordRef.bumpNativeSyncVersion();
        }
      }
    });
    coordRef = f.coordinator;
    await f.coordinator.initializeNativeReminders();
    item1.deadlineEvents = undefined;
    item1.reminderEvents = undefined;
    f.getSettings().scheduledAlarmIds = [];
    f.getSettings().scheduledAlarmSignatures = {};
    shouldTriggerDrift = true;

    const beforeReconciles = f.getReconcileCount();
    await f.coordinator.syncNativeRemindersNow();
    const driftRuns = f.getReconcileCount() - beforeReconciles;

    // 单次漂移补偿排程：第 1 轮发现 drift 不 break，重跑第 2 轮对账完成补偿，总轮次恰好 2
    assert.strictEqual(driftRuns, 2, "single version drift must trigger compensatory 2nd reconcile run (got " + driftRuns + ")");

    // settings 应该更新
    assert.deepStrictEqual(f.getSettings().scheduledAlarmIds, ["alarm-1"],
      "scheduledAlarmIds must be updated in settings");
    assert.deepStrictEqual(f.getSettings().scheduledAlarmSignatures, { "alarm-1": "sig-1" },
      "scheduledAlarmSignatures must be updated in settings");
    // 第 2 轮对账未再漂移，业务台账应当成功回写补偿
    assert.ok(item1.deadlineEvents,
      "deadlineEvents must be written on compensatory second run");
    assert.ok(item1.reminderEvents,
      "reminderEvents must be written on compensatory second run");

    // 稳定轮次（无漂移）恰好 1 轮对账，不自激
    const stableBefore = f.getReconcileCount();
    await f.coordinator.syncNativeRemindersNow();
    const stableRuns = f.getReconcileCount() - stableBefore;
    assert.strictEqual(stableRuns, 1, "stable run without drift must run exactly 1 reconcile iteration (got " + stableRuns + ")");
  }

  // 3. applyDeadlineEvents / applyReminderEvents 写入时带 deferNativeSync: true，防止自激
  {
    const item1 = { id: "it-1", deadlineAt: 1000, triggerAt: 2000 };
    const f = fixture(api, { items: [item1] });
    await f.coordinator.initializeNativeReminders();
    f.getSaves().length = 0; // 清空初始化产生的 saves
    delete item1.deadlineEvents;
    delete item1.reminderEvents;
    f.getSettings().scheduledAlarmIds = [];

    await f.coordinator.syncNativeRemindersNow();
    const saves = f.getSaves();
    assert.ok(saves.length > 0, "save must be called during ledger sync");
    const allDeferred = saves.every(s => s.deferNativeSync === true);
    assert.strictEqual(allDeferred, true, "all ledger saves in syncNativeRemindersNow must have deferNativeSync: true");
  }

  // 4. Q6 桥晚到重试：排队未丢，桥到后排干 pending，重试注册不重复
  {
    const f = fixture(api, { bridgeReady: true });
    assert.strictEqual(f.coordinator.isNativeReady(), false, "initially nativeReady is false");
    f.coordinator.queueNativeReminderSync("late-bridge-call");
    assert.strictEqual(f.coordinator.getNativeSyncMetrics().totalRequests, 1,
      "totalRequests must count late-bridge queue calls");

    // 等待 ensureNativeReminders 与 80ms 延时定时器执行
    await new Promise(r => setTimeout(r, 160));
    assert.strictEqual(f.coordinator.isNativeReady(), true, "coordinator reports nativeReady = true");
    assert.ok(f.coordinator.getNativeSyncMetrics().runs >= 1, "reconcile runs must be >= 1 after late bridge retry");

    // 再次调用 ensureNativeReminders 不重复初始化
    const ok2 = await f.coordinator.ensureNativeReminders();
    assert.strictEqual(ok2, true);
    assert.strictEqual(f.getInitializeCount(), 1, "initialize must only be called once");
  }

  // 5. indexItemsById 重复 ID 首项胜出
  {
    const firstItem = { id: "dup-1", title: "first", deadlineAt: 1000 };
    const secondItem = { id: "dup-1", title: "second", deadlineAt: 1000 };
    const f = fixture(api, { items: [firstItem, secondItem] });

    f.coordinator.applyDeadlineEvents(
      [{ itemId: "dup-1", stageKey: "due@1000", at: 1000 }],
      Date.now()
    );

    assert.ok(firstItem.deadlineEvents, "first item must have deadlineEvents updated");
    assert.strictEqual(secondItem.deadlineEvents, undefined,
      "second item with duplicate ID must NOT be modified (first item wins)");
  }

  // 6. 并发 queueNativeReminderSync 在 in-flight 期间的重叠收敛指标
  {
    let insideReconcile = false;
    let coordRef;
    const f = fixture(api, {
      reconcileDelayMs: 40,
      onReconcile: () => {
        if (!insideReconcile && coordRef) {
          insideReconcile = true;
          // 在 in-flight 期间发出两次并发请求
          coordRef.queueNativeReminderSync("concurrent-1");
          coordRef.queueNativeReminderSync("concurrent-2");
        }
      }
    });
    coordRef = f.coordinator;
    await f.coordinator.initializeNativeReminders();

    // 触发第一轮 sync
    const syncPromise = f.coordinator.syncNativeRemindersNow();
    await syncPromise;
    // 等待可能触发的下一轮 pending 排干
    await new Promise(r => setTimeout(r, 60));

    const metrics = f.coordinator.getNativeSyncMetrics();
    assert.ok(metrics.deduped >= 2, "deduped metric must record in-flight concurrent requests (got " + metrics.deduped + ")");
  }

  // 7. 投递证据读取与合并：unknown / delivered / suppressed 与 roundBase 保留
  {
    const item1 = {
      id: "it-1",
      triggerAt: 2000,
      reminderEvents: {
        "rem@2000": { at: 2000, state: "scheduled", roundBase: 2000 }
      }
    };
    const f = fixture(api, {
      items: [item1],
      deliveryEvidenceResult: {
        available: true,
        reason: "ok",
        retention: { days: 7 },
        rows: [
          { itemId: "it-1", reminderKey: "rem@2000", itemRev: 1, carrier: "notification", receivedAt: 2005 }
        ]
      }
    });
    await f.coordinator.initializeNativeReminders();

    const readOk = await f.coordinator.readDeliveryEvidence("manual");
    assert.strictEqual(readOk, true, "readDeliveryEvidence must succeed");
    const evState = f.coordinator.getDeliveryEvidenceState();
    assert.strictEqual(evState.readable, true, "delivery evidence state readable must be true");
    assert.strictEqual(evState.rows, 1, "delivery evidence rows count must be 1");
    assert.ok(evState.lastReadAt > 0, "lastReadAt must be updated");

    // 检查证据合并与 roundBase 保留
    assert.strictEqual(item1.evidenceMerged, true, "mergeDeliveryEvidence was executed");
    assert.strictEqual(item1.reminderEvents["rem@2000"].state, "delivered",
      "reminder event state must transition to delivered");
    assert.strictEqual(item1.reminderEvents["rem@2000"].roundBase, 2000,
      "roundBase must be preserved as 2000");
  }

  // 8. applyReminderEvents 登记新提醒时注入 roundBase 轮次身份
  {
    const item1 = { id: "it-rb", triggerAt: 5000 };
    const f = fixture(api, { items: [item1] });
    f.coordinator.applyReminderEvents(
      [{ itemId: "it-rb", key: "rem@5000", at: 5000 }],
      Date.now()
    );
    assert.ok(item1.reminderEvents && item1.reminderEvents["rem@5000"], "reminder event must be created");
    assert.strictEqual(item1.reminderEvents["rem@5000"].roundBase, 5000,
      "applyReminderEvents must record roundBase = 5000");
  }

  // 9. 工厂依赖校验：缺少 handleAlarmAction 必须抛错
  {
    const f = fixture(api);
    let threw = false;
    try {
      const brokenDeps = Object.assign({}, f.deps);
      delete brokenDeps.handleAlarmAction;
      api.createAppNativeCoordinator(brokenDeps);
    } catch (e) {
      threw = e && e.message && e.message.includes("handleAlarmAction");
    }
    assert.strictEqual(threw, true, "createAppNativeCoordinator must throw when handleAlarmAction is missing");
  }

  // 10. 全屏闹钟动作排空直达 handleAlarmAction，保留 alarmEventId，不走通知栏动作入口
  {
    const f = fixture(api, {
      drainEvents: [
        { action: "ack", itemId: "it-1", itemRev: 1, alarmEventId: "evt-ack-100" },
        { action: "snooze", itemId: "it-1", itemRev: 1, alarmEventId: "evt-snz-101" },
        { action: "done", itemId: "it-1", itemRev: 1, alarmEventId: "evt-done-102" },
        { action: "close", itemId: "it-1", itemRev: 1, alarmEventId: "evt-close-103" }
      ]
    });
    await f.coordinator.initializeNativeReminders();
    await f.getHooks().onResume();

    const handled = f.getAlarmActions();
    assert.strictEqual(handled.length, 4, "all 4 alarm actions must be drained");
    assert.deepStrictEqual(handled.map(x => x.action), ["ack", "snooze", "done", "close"]);
    assert.deepStrictEqual(handled.map(x => x.alarmEventId), [
      "evt-ack-100", "evt-snz-101", "evt-done-102", "evt-close-103"
    ], "alarmEventId must be preserved exactly for all actions");
    assert.strictEqual(f.getNotificationActions().length, 0,
      "notification action handler must NOT be invoked for full-screen alarm drain");
  }

  // 11. 权威提交拒绝后队列可重试（drainAlarmActions 遇到 reject 不破坏生命周期）
  {
    let rejectOnce = true;
    const f = fixture(api, {
      drainEvents: [
        { action: "ack", itemId: "it-1", itemRev: 1, alarmEventId: "evt-fail-104" }
      ],
      onAlarmAction: async (ev) => {
        if (rejectOnce) {
          rejectOnce = false;
          throw new Error("Authoritative disk commit rejected");
        }
        return true;
      }
    });
    await f.coordinator.initializeNativeReminders();
    // onResume 捕获异常，不会炸崩应用生命周期
    await f.getHooks().onResume();
    assert.strictEqual(f.getAlarmActions().length, 1, "first attempt invoked handleAlarmAction");

    // 下次回前台重试时，可继续尝试消费
    await f.getHooks().onResume();
    assert.strictEqual(f.getAlarmActions().length, 2, "subsequent onResume retries queued action");
  }

  return "healthy coordinator behavior: PASS";
}

async function mutant(name, transform) {
  const mutated = transform(source);
  assert.notStrictEqual(mutated, source, "mutation transformation must modify the code: " + name);
  const api = load(mutated);
  let failed = false;
  try {
    await healthy(api);
  } catch (_) {
    failed = true;
  }
  assert.strictEqual(failed, true, name + " did not fail healthy behavior");
  return name + ": mutation detected";
}

(async () => {
  const out = [await healthy(load(source))];

  // 变异 1：移除权威判定拦截
  out.push(await mutant("authority write gate check bypassed", s => {
    return s.replace("if (!deps.authoritativeWritesAllowed()) {",
      "if (false && !deps.authoritativeWritesAllowed()) {");
  }));

  // 变异 2：放行版本漂移台账写入
  out.push(await mutant("version drift protection bypassed", s => {
    return s.replace("if (capturedVersion === nativeSyncVersion) {",
      "if (true || capturedVersion === nativeSyncVersion) {");
  }));

  // 变异 3：移除 deferNativeSync: true 防止自激
  out.push(await mutant("deferNativeSync option removed in syncNativeRemindersNow", s => {
    return s.replace("const ledgerOptions = { deferNativeSync: true };",
      "const ledgerOptions = {};");
  }));

  // 变异 4：桥未就绪时丢弃重试队列
  out.push(await mutant("ensureNativeReminders retry bypassed on late bridge", s => {
    return s.replace("ensureNativeReminders().then(ok => { if (ok) queueNativeReminderSync(source); });",
      "// ensureNativeReminders().then");
  }));

  // 变异 5：indexItemsById 破坏首项胜出（变为末项胜出）
  out.push(await mutant("indexItemsById first-item-wins check removed", s => {
    return s.replace("if (map.has(it.id)) return;",
      "// if (map.has(it.id)) return;");
  }));

  // 变异 6：并发 queue 请求去重指标被绕过
  out.push(await mutant("inflight dedup counter bypassed", s => {
    return s.replaceAll("nativeSyncMetrics.deduped++;",
      "// nativeSyncMetrics.deduped++;");
  }));

  // 变异 7：投递证据 readable 状态篡改
  out.push(await mutant("deliveryEvidenceState readable forced false", s => {
    return s.replace("deliveryEvidenceState.readable = !!(res && res.available);",
      "deliveryEvidenceState.readable = false;");
  }));

  // 变异 8：roundBase 属性被丢弃
  out.push(await mutant("roundBase dropped in applyReminderEvents", s => {
    return s.replace("keep(key, { at: at, state: \"scheduled\", roundBase: base });",
      "keep(key, { at: at, state: \"scheduled\" });");
  }));

  // 变异 9：移除 handleAlarmAction 必需依赖
  out.push(await mutant("handleAlarmAction removed from REQUIRED_DEPS", s => {
    return s.replace('"handleAlarmAction", ', "");
  }));

  // 变异 10：drainAlarmActions 篡改为回退到通知栏动作入口
  out.push(await mutant("drainAlarmActions incorrectly routes to onNotificationAction", s => {
    return s.replace("await nr.drainAlarmActions(deps.handleAlarmAction);",
      "await nr.drainAlarmActions(deps.onNotificationAction);");
  }));

  // 变异 11：版本漂移后提前退出（未重跑对账补偿）
  out.push(await mutant("version drift loop exits early without compensatory second run", s => {
    return s.replace(
      "            if (!nativeSyncPending) {\n              break;\n            }\n          }",
      "          }\n          if (!nativeSyncPending) {\n            break;\n          }"
    );
  }));

  const hashAfter = crypto.createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");
  assert.strictEqual(hashBefore, hashAfter, "lib/app-native-coordinator.js must be byte-for-byte identical before and after mutations");

  out.push("lib/app-native-coordinator.js before/after SHA-256 match: " + hashBefore);
  console.log(out.join("\n"));
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
