/* P3-G direct alerts module behavior and source mutation checks.
 * Uses the loaded source in temporary context, never rewriting the product file.
 */
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const targetPath = path.join(ROOT, "lib/app-alerts.js");
const source = fs.readFileSync(targetPath, "utf8");
const hashBefore = crypto.createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");

function load(src) {
  const box = {
    module: { exports: {} },
    self: {},
    setTimeout: (...args) => {
      if (box._setTimeout) return box._setTimeout(...args);
      const t = setTimeout(...args);
      if (t && typeof t.unref === "function") t.unref();
      return t;
    },
    clearTimeout: (...args) => (box._clearTimeout ? box._clearTimeout(...args) : clearTimeout(...args)),
    setInterval: (...args) => {
      if (box._setInterval) return box._setInterval(...args);
      const t = setInterval(...args);
      if (t && typeof t.unref === "function") t.unref();
      return t;
    },
    clearInterval: (...args) => (box._clearInterval ? box._clearInterval(...args) : clearInterval(...args)),
    Date: Date,
    Map: Map,
    Set: Set,
    JSON: JSON,
    Array: Array,
    Object: Object,
    Promise: Promise,
    console: console,
    Number: Number,
    String: String,
    parseInt: parseInt,
    Notification: function(title, options) {
      this.title = title;
      this.options = options;
      box._notifications = box._notifications || [];
      box._notifications.push({ title, options });
    },
    window: {},
    navigator: {
      vibrate: (pattern) => {
        box.navigator._vibrateCalls = box.navigator._vibrateCalls || [];
        box.navigator._vibrateCalls.push(pattern);
      }
    },
    document: {
      visibilityState: "visible"
    }
  };
  box.Notification.permission = "granted";
  box.window.Notification = box.Notification;
  vm.runInNewContext(src, box, { filename: "lib/app-alerts.js" });
  return { exports: box.module.exports, box };
}

function fixture(api, options) {
  options = options || {};
  let nowVal = options.now || 1700000000000;
  let items = options.items || [];
  let settings = Object.assign({
    notify: true,
    privacyNotify: false,
    importantRepeat: true
  }, options.settings || {});
  let state = {
    items: items,
    settings: settings,
    ui: { tab: "home" }
  };

  let saves = 0;
  let homeRenders = 0;
  let statsRenders = 0;
  let toasts = [];
  let badgeUpdates = 0;
  let acknowledged = [];
  let completed = [];
  let snoozed = [];
  let openedDetail = [];
  let openedSnoozeSheets = [];
  let reviewSessionsOpened = 0;
  let stoppedDeliveries = [];
  let handledAlarmActions = [];
  let markedReminded = [];
  let promotedDueCalls = 0;
  let maybeReviewSessionCalls = 0;
  let domNodes = {};

  function getNode(id) {
    if (!domNodes[id]) {
      domNodes[id] = {
        id: id,
        textContent: "",
        innerHTML: "",
        hidden: false,
        disabled: false,
        attrs: {},
        classList: {
          classes: new Set(),
          add(cls) { this.classes.add(cls); },
          remove(cls) { this.classes.delete(cls); },
          toggle(cls, force) {
            if (force === undefined) {
              if (this.classes.has(cls)) this.classes.delete(cls);
              else this.classes.add(cls);
            } else if (force) {
              this.classes.add(cls);
            } else {
              this.classes.delete(cls);
            }
          },
          contains(cls) { return this.classes.has(cls); }
        },
        listeners: {},
        addEventListener(ev, fn) {
          if (!this.listeners[ev]) this.listeners[ev] = [];
          this.listeners[ev].push(fn);
        },
        dispatchEvent(ev) {
          const list = this.listeners[ev] || [];
          list.forEach(fn => fn({ currentTarget: this, target: this, stopPropagation: () => {} }));
        },
        hasAttribute(name) { return name in this.attrs; },
        getAttribute(name) { return this.attrs[name]; },
        setAttribute(name, val) { this.attrs[name] = String(val); },
        querySelectorAll(selector) {
          if (selector.indexOf("data-alarm") >= 0) {
            return (this._alarmButtons || []);
          }
          return [];
        }
      };
    }
    return domNodes[id];
  }

  const defaultBridge = {
    activeAlarmDeliveries: async () => ({ alarms: options.alarms || [] }),
    stopAlarmDelivery: async (alarm) => {
      stoppedDeliveries.push(alarm);
      return true;
    }
  };

  const deps = {
    now: () => nowVal,
    getState: () => state,
    save: (opts) => {
      saves++;
      if (options.saveFn) return options.saveFn(opts);
      return Promise.resolve(true);
    },
    shouldSuppressInnerSave: () => (options.shouldSuppressInnerSave ? options.shouldSuppressInnerSave() : false),
    bumpRev: (it) => { it.rev = (Number(it.rev) || 1) + 1; },
    runUserOp: (fn, args, opts) => {
      return fn.apply(null, args);
    },
    committedItemById: (id) => state.items.find(x => x.id === id) || null,
    systemBridge: () => (options.bridge !== undefined ? options.bridge : defaultBridge),
    handleAlarmAction: async (payload) => {
      handledAlarmActions.push(payload);
      if (options.alarmActionShouldFail) return false;
      return true;
    },
    alarmEventSeen: (eventId) => options.alarmEventSeen ? options.alarmEventSeen(eventId) : false,
    promoteDue: () => { promotedDueCalls++; },
    maybeReviewSession: () => { maybeReviewSessionCalls++; },
    priorityRank: (p) => (p === "critical" ? 0 : p === "important" ? 1 : 2),
    shouldRealert: (it, now, opts) => {
      return it.allowRealert !== false;
    },
    markReminded: (it, now) => {
      markedReminded.push({ id: it.id, now });
    },
    hasKnownRev: (rev) => rev !== null && rev !== undefined && rev !== "" && rev !== "untracked",
    isTerminal: (it) => it.status === "completed" || it.status === "archived" || it.status === "deleted",
    toast: (msg) => { toasts.push(msg); },
    escapeHtml: (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;"),
    updateAppBadge: () => { badgeUpdates++; },
    renderHome: () => { homeRenders++; },
    renderStats: () => { statsRenders++; },
    query: (sel) => getNode(sel.replace(/^#/, "")),
    queryAll: (sel) => [getNode(sel.replace(/^#/, ""))],
    ackItem: (id) => {
      acknowledged.push(id);
      const it = state.items.find(x => x.id === id);
      if (it) it.status = "acknowledged";
      return true;
    },
    completeItem: (id) => {
      completed.push(id);
      const it = state.items.find(x => x.id === id);
      if (it) it.status = "completed";
      return true;
    },
    openSnoozeSheet: (id) => {
      openedSnoozeSheets.push(id);
      return true;
    },
    snoozeItem: (id, until) => {
      snoozed.push({ id, until });
      const it = state.items.find(x => x.id === id);
      if (it) { it.status = "snoozed"; it.snoozeUntil = until; }
      return true;
    },
    openDetail: (id) => { openedDetail.push(id); },
    openReviewSession: () => { reviewSessionsOpened++; },
    isNativeAndroid: () => !!options.isNative
  };

  const alerts = api.createAppAlerts(deps);
  return {
    alerts,
    state,
    deps,
    getNode,
    spies: {
      get nowVal() { return nowVal; },
      setNowVal(v) { nowVal = v; },
      get saves() { return saves; },
      get homeRenders() { return homeRenders; },
      get statsRenders() { return statsRenders; },
      toasts,
      get badgeUpdates() { return badgeUpdates; },
      acknowledged,
      completed,
      snoozed,
      openedDetail,
      openedSnoozeSheets,
      get reviewSessionsOpened() { return reviewSessionsOpened; },
      stoppedDeliveries,
      handledAlarmActions,
      markedReminded,
      get promotedDueCalls() { return promotedDueCalls; },
      get maybeReviewSessionCalls() { return maybeReviewSessionCalls; }
    }
  };
}

async function healthy(loaded) {
  const api = loaded.exports;

  // 1. Dependency gate: missing required deps throws immediately
  assert.throws(() => {
    api.createAppAlerts({});
  }, /createAppAlerts\(deps\) 缺少依赖/);

  // 2. Due alert detection & priority sorting: critical (rank 0) beats important/normal
  {
    const f = fixture(api, {
      items: [
        { id: "item-normal", title: "Normal due", priority: "normal", status: "due", triggerAt: 100 },
        { id: "item-crit", title: "Critical due", priority: "critical", status: "due", triggerAt: 200 }
      ]
    });
    f.alerts.tick();
    assert.strictEqual(f.alerts.getAlertItem()?.id, "item-crit", "Critical priority item must be alerted first");
    assert.strictEqual(f.spies.saves, 1, "Alert shown must save lastAlertShownAt");
    assert.strictEqual(f.getNode("alertTitle").textContent, "🚨 关键提醒");
    assert.strictEqual(f.getNode("alertBody").textContent, "Critical due");
    assert.strictEqual(f.getNode("alertBanner").classList.contains("crit"), true);
    assert.strictEqual(f.getNode("alertBanner").classList.contains("show"), true);
    f.alerts.clearAlert();
  }

  // 3. Realert tracking: markReminded called if item already had lastAlertShownAt
  {
    const f = fixture(api, {
      items: [
        { id: "item-realert", title: "Realert item", priority: "important", status: "due", lastAlertShownAt: 1000 }
      ]
    });
    f.alerts.tick();
    assert.strictEqual(f.spies.markedReminded.length, 1, "markReminded must be called for realert");
    assert.strictEqual(f.spies.markedReminded[0].id, "item-realert");
    f.alerts.clearAlert();
  }

  // 4. "×" write 30m suppression without ACK/done
  {
    const f = fixture(api, {
      now: 1000000,
      items: [
        { id: "it-dismiss", title: "Dismiss me", priority: "normal", status: "due" }
      ]
    });
    f.alerts.showAlert(f.state.items[0]);
    assert.strictEqual(f.alerts.getAlertItem()?.id, "it-dismiss");

    // Click "×" dismiss
    const dismissRes = await f.alerts.dismissAlert();
    assert.strictEqual(dismissRes, true, "dismissAlert must resolve true on successful save");
    assert.strictEqual(f.alerts.getAlertItem(), null, "alertItem must be null after dismiss");
    assert.strictEqual(f.getNode("alertBanner").classList.contains("show"), false);
    // Item status must remain "due" (not ACK, not completed)
    assert.strictEqual(f.state.items[0].status, "due", "Item status must remain untouched on dismiss");
    assert.strictEqual(f.state.items[0].dismissedUntil, 1000000 + 30 * 60 * 1000, "dismissedUntil must be set to +30m");

    // Calling tick() within 30m must skip this item
    f.spies.setNowVal(1000000 + 10 * 60 * 1000); // 10 minutes later
    assert.strictEqual(f.alerts.shouldSkipAlert(f.state.items[0]), true, "Item must be skipped during 30m suppression");
    const memoryItem = { id: "it-dismiss", title: "Dismiss me", priority: "normal", status: "due", dismissedUntil: 0 };
    assert.strictEqual(f.alerts.shouldSkipAlert(memoryItem), true, "In-memory dismissedAlerts must skip within 30m");
    f.alerts.tick();
    assert.strictEqual(f.alerts.getAlertItem(), null, "Should not re-alert dismissed item within 30m");

    // After 30m, suppression expires
    f.spies.setNowVal(1000000 + 31 * 60 * 1000);
    f.state.items[0].dismissedUntil = 0;
    assert.strictEqual(f.alerts.shouldSkipAlert(f.state.items[0]), false, "Suppression must expire after 30m");
    f.alerts.clearAlert();
  }

  // 4b. dismissAlert on save failure: returns false, does not toast success
  {
    const fFail = fixture(api, {
      items: [{ id: "fail-save", title: "Fail save", priority: "normal", status: "due" }],
      saveFn: () => {
        const p = Promise.reject(new Error("Disk full"));
        p.catch(() => {});
        return p;
      }
    });
    fFail.alerts.showAlert(fFail.state.items[0]);
    const res = await fFail.alerts.dismissAlert();
    assert.strictEqual(res, false, "dismissAlert must return false when save rejects");
    assert.strictEqual(fFail.spies.toasts.includes("已关闭提醒 · 事项仍在首页"), false, "Must not toast success on save failure");
    fFail.alerts.clearAlert();
  }

  // 4c. dismissAlert when save returns falsy / is suppressed without commit receipt: returns false and no toast
  {
    const fSuppressed = fixture(api, {
      items: [{ id: "suppressed-save", title: "Suppressed save", priority: "normal", status: "due" }],
      saveFn: () => undefined
    });
    fSuppressed.alerts.showAlert(fSuppressed.state.items[0]);
    const res = await fSuppressed.alerts.dismissAlert();
    assert.strictEqual(res, false, "dismissAlert must return false when save returns no receipt");
    assert.strictEqual(fSuppressed.spies.toasts.includes("已关闭提醒 · 事项仍在首页"), false, "Must not toast success without save receipt");
    fSuppressed.alerts.clearAlert();
  }

  // 5. 10m auto-hide is visual-only: zero accounting
  {
    let timeoutFn = null;
    let timeoutMs = 0;
    loaded.box._setTimeout = function(fn, delay) {
      timeoutFn = fn;
      timeoutMs = delay;
      return 123;
    };
    try {
      const f = fixture(api, {
        now: 5000000,
        items: [
          { id: "it-autohide", title: "Autohide item", priority: "normal", status: "due" }
        ]
      });
      f.alerts.showAlert(f.state.items[0]);
      assert.strictEqual(timeoutMs, 10 * 60 * 1000, "Auto-hide timer must be 10 minutes");
      assert.strictEqual(typeof timeoutFn, "function");

      // Fire the 10m auto-hide
      timeoutFn();
      assert.strictEqual(f.alerts.getAlertItem(), null, "Banner must be hidden visually");
      assert.strictEqual(f.getNode("alertBanner").classList.contains("show"), false);

      // Visual-only verification: dismissedAlerts must NOT contain this item, item.dismissedUntil not set
      assert.strictEqual(f.alerts.shouldSkipAlert(f.state.items[0]), false, "10m auto-hide must NOT suppress item");
      assert.strictEqual(f.state.items[0].dismissedUntil || 0, 0, "No accounting on auto-hide");
      f.alerts.clearAlert();
    } finally {
      loaded.box._setTimeout = null;
    }
  }

  // 6. Alert controls: bindAlertControls() buttons
  {
    const f = fixture(api, {
      items: [
        { id: "it-controls", title: "Controls test", priority: "normal", status: "due" }
      ]
    });
    f.alerts.bindAlertControls();
    f.alerts.showAlert(f.state.items[0]);

    // Test ack button
    f.getNode("alertAck").dispatchEvent("click");
    assert.strictEqual(f.spies.acknowledged.indexOf("it-controls") >= 0, true, "Ack button must call ackItem");
    assert.strictEqual(f.alerts.getAlertItem(), null, "Ack button must hide alert");

    // Test done button
    f.alerts.showAlert(f.state.items[0]);
    f.getNode("alertDone").dispatchEvent("click");
    assert.strictEqual(f.spies.completed.indexOf("it-controls") >= 0, true, "Done button must call completeItem");
    assert.strictEqual(f.alerts.getAlertItem(), null, "Done button must hide alert");

    // Test snooze button
    f.alerts.showAlert(f.state.items[0]);
    f.getNode("alertSnooze").dispatchEvent("click");
    assert.strictEqual(f.spies.openedSnoozeSheets.indexOf("it-controls") >= 0, true, "Snooze button must open snooze sheet");
    assert.strictEqual(f.alerts.getAlertItem(), null, "Snooze button must hide alert");
    f.alerts.clearAlert();
  }

  // 6b. Idempotent alert controls binding: calling bindAlertControls() multiple times only binds once
  {
    const fRepeat = fixture(api);
    fRepeat.alerts.bindAlertControls();
    fRepeat.alerts.bindAlertControls();
    const closeBtn = fRepeat.getNode("alertClose");
    assert.strictEqual(closeBtn.listeners["click"]?.length, 1, "Duplicate bindAlertControls must not add second listener");
    closeBtn.dispatchEvent("click");
    assert.strictEqual(fRepeat.spies.toasts.length, 1, "Only one toast emitted on click after repeat bind");
    fRepeat.alerts.clearAlert();
  }

  // 7. SW notification actions: handleNotificationAction
  {
    const f = fixture(api, {
      now: 2000000,
      items: [
        { id: "it-action", title: "Action test", priority: "normal", status: "due" }
      ]
    });
    f.alerts.showAlert(f.state.items[0]);

    // ack action
    assert.strictEqual(f.alerts.handleNotificationAction({ itemId: "it-action", action: "ack" }), true);
    assert.strictEqual(f.spies.acknowledged.indexOf("it-action") >= 0, true);

    // done action
    assert.strictEqual(f.alerts.handleNotificationAction({ itemId: "it-action", action: "done" }), true);
    assert.strictEqual(f.spies.completed.indexOf("it-action") >= 0, true);

    // snooze action (fixed 2 hours)
    assert.strictEqual(f.alerts.handleNotificationAction({ itemId: "it-action", action: "snooze" }), true);
    assert.strictEqual(f.spies.snoozed[0].until, 2000000 + 2 * 3600000);

    // review-session action
    assert.strictEqual(f.alerts.handleNotificationAction({ itemId: "review-session" }), true);
    assert.strictEqual(f.spies.reviewSessionsOpened, 1);

    // default action -> openDetail
    assert.strictEqual(f.alerts.handleNotificationAction({ itemId: "it-action", action: "view" }), true);
    assert.strictEqual(f.spies.openedDetail.indexOf("it-action") >= 0, true);
    f.alerts.clearAlert();
  }

  // 8. Privacy notification masking & Native Android suppression
  {
    // Privacy masked
    const f1 = fixture(api, {
      settings: { notify: true, privacyNotify: true },
      items: [{ id: "priv", title: "Secret Medical Appointment", priority: "normal", status: "due" }]
    });
    loaded.box._notifications = [];
    f1.alerts.showAlert(f1.state.items[0]);
    assert.strictEqual(loaded.box._notifications.length, 1);
    assert.strictEqual(loaded.box._notifications[0].title, "安心收件箱提醒");
    assert.strictEqual(loaded.box._notifications[0].options.body, "有一条事项需要你确认");
    f1.alerts.clearAlert();

    // Native Android suppression (Web Notification must NOT be created)
    const f2 = fixture(api, {
      isNative: true,
      settings: { notify: true, privacyNotify: false },
      items: [{ id: "nat", title: "Native alarm item", priority: "normal", status: "due" }]
    });
    loaded.box._notifications = [];
    f2.alerts.showAlert(f2.state.items[0]);
    assert.strictEqual(loaded.box._notifications.length, 0, "Web notification must be suppressed on native Android");
    f2.alerts.clearAlert();
  }

  // 9. Active native alarm panel & save failure non-stopping of alarm
  {
    // Case A: Alarm done with successful save -> commits transaction and stops delivery
    const fSuccess = fixture(api, {
      alarms: [{ id: "alarm-1", token: "tok-1", itemId: "it-alarm", itemRev: 2 }],
      items: [{ id: "it-alarm", title: "Take Medicine", rev: 2, status: "due" }]
    });
    await fSuccess.alerts.refreshActiveAlarmPanel();
    assert.strictEqual(fSuccess.getNode("activeAlarmPanel").hidden, false);
    assert.strictEqual(fSuccess.getNode("activeAlarmPanel").innerHTML.indexOf("Take Medicine") >= 0, true);

    const doneResult = await fSuccess.alerts.completeActiveAlarm({ id: "alarm-1", token: "tok-1", itemId: "it-alarm", itemRev: 2 });
    assert.strictEqual(doneResult, true);
    assert.strictEqual(fSuccess.spies.handledAlarmActions.length, 1);
    assert.strictEqual(fSuccess.spies.stoppedDeliveries.length, 1);

    // Case B: Alarm done with failed save -> throws error and NEVER stops delivery
    const fFail = fixture(api, {
      alarmActionShouldFail: true,
      alarms: [{ id: "alarm-2", token: "tok-2", itemId: "it-fail", itemRev: 1 }],
      items: [{ id: "it-fail", title: "Failed Alarm", rev: 1, status: "due" }]
    });
    let throwError = null;
    try {
      await fFail.alerts.completeActiveAlarm({ id: "alarm-2", token: "tok-2", itemId: "it-fail", itemRev: 1 });
    } catch (e) {
      throwError = e;
    }
    assert.notStrictEqual(throwError, null, "Must throw when handleAlarmAction fails");
    assert.strictEqual(fFail.spies.stoppedDeliveries.length, 0, "Delivery MUST NOT be stopped when save fails");

    // Case C: deliveryHandledByCommittedItem: terminal item or newer ACK/snoozed item
    const itTerm = { id: "term", rev: 3, status: "completed" };
    assert.strictEqual(fSuccess.alerts.deliveryHandledByCommittedItem({ itemRev: 1 }, itTerm), true);
    const itStaleAck = { id: "stale", rev: 2, status: "acknowledged" };
    assert.strictEqual(fSuccess.alerts.deliveryHandledByCommittedItem({ itemRev: 1 }, itStaleAck), true);
    const itSameRevAck = { id: "same", rev: 1, status: "acknowledged" };
    assert.strictEqual(fSuccess.alerts.deliveryHandledByCommittedItem({ itemRev: 1 }, itSameRevAck), false);
  }

  // 10. Timer idempotency: startPolling cleans previous timers
  {
    let intervalsCreated = 0;
    let intervalsCleared = 0;
    loaded.box._setInterval = (fn, ms) => { intervalsCreated++; return intervalsCreated; };
    loaded.box._clearInterval = (id) => { intervalsCleared++; };
    try {
      const f = fixture(api);
      f.alerts.startPolling();
      const createdFirst = intervalsCreated;
      assert.strictEqual(createdFirst, 2, "startPolling should create 2 intervals (2s and 15s)");

      // Duplicate startPolling must clear previous intervals first
      f.alerts.startPolling();
      assert.strictEqual(intervalsCleared, 2, "Duplicate startPolling must clear previous intervals");
      assert.strictEqual(intervalsCreated, 4, "Total 4 intervals created (2 old cleared, 2 new)");

      // stopPolling must clear remaining
      f.alerts.stopPolling();
      assert.strictEqual(intervalsCleared, 4, "stopPolling must clear all active intervals");
    } finally {
      loaded.box._setInterval = null;
      loaded.box._clearInterval = null;
    }
  }

  return "healthy checks passed";
}

async function mutant(name, transform) {
  const mutatedSrc = transform(source);
  assert.notStrictEqual(mutatedSrc, source, name + " did not modify source");
  let failed = false;
  try {
    const loaded = load(mutatedSrc);
    await healthy(loaded);
  } catch (e) {
    failed = true;
  }
  assert.strictEqual(failed, true, name + " did not fail healthy behavior");
  return name + ": mutation detected";
}

(async () => {
  const out = [await healthy(load(source))];

  // 变异 1：30 分钟静音窗口被篡改或移除（导致 dismiss 不做 30m 抑制）
  out.push(await mutant("dismissSuppressionMutant: 30m suppression duration modified", s => {
    return s.replace(
      "now - at < 30 * 60 * 1000",
      "now - at < 0"
    );
  }));

  // 变异 2：10 分钟自动收起破坏「纯展示、零记账」原则，错误写进 dismissedAlerts
  out.push(await mutant("autohideAccountingMutant: auto-hide records to dismissedAlerts", s => {
    return s.replace(
      "if (alertItem && alertItem.id === it.id) {\n          hideAlert();\n        }",
      "if (alertItem && alertItem.id === it.id) {\n          dismissedAlerts[it.id] = getNow();\n          hideAlert();\n        }"
    );
  }));

  // 变异 3：活动闹钟完成动作在保存失败时依然停声，破坏原生事务安全性
  out.push(await mutant("activeAlarmDoneSaveFailMutant: stopAlarmDelivery called even when handleAlarmAction fails", s => {
    return s.replace(
      "if (!completed && !deps.alarmEventSeen(eventId)) {\n        throw new Error(\"提醒已变更，请在事项详情中确认；仍可停止声振\");\n      }",
      "/* bypassed throw on failure */"
    );
  }));

  // 变异 4：startPolling 遗漏 stopPolling 清理，重复调用造成定时器泄漏
  out.push(await mutant("timerLeakOnDuplicateStartMutant: startPolling does not call stopPolling", s => {
    return s.replace(
      "function startPolling() {\n      stopPolling();",
      "function startPolling() {"
    );
  }));

  const hashAfter = crypto.createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");
  assert.strictEqual(hashBefore, hashAfter, "lib/app-alerts.js must be byte-for-byte identical before and after mutations");

  out.push("lib/app-alerts.js before/after SHA-256 match: " + hashBefore);
  console.log(out.join("\n"));
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
