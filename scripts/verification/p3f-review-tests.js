/* P3-F direct review module behavior and source mutation checks.
 * Uses the loaded source in temporary context, never rewriting the product file.
 */
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const targetPath = path.join(ROOT, "lib/app-review.js");
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
    String: String,
    parseInt: parseInt
  };
  vm.runInNewContext(src, box, { filename: "lib/app-review.js" });
  return box.module.exports;
}

function fixture(api, options) {
  options = options || {};
  let items = options.items || [];
  let settings = options.settings || {
    review: {
      enabled: true,
      hour: 21,
      minute: 30,
      windowEndHour: 23,
      windowEndMinute: 0,
      followupCount: 0,
      snoozedUntil: 0,
      skippedUntil: 0,
      sessionStatus: "idle",
      lastSessionKey: "",
      maxFollowups: 2,
      followupMs: 3600000
    }
  };
  let state = {
    items: items,
    settings: settings,
    ui: { reviewActiveIndex: 0, activeReviewSessionId: null }
  };

  let saves = 0;
  let renders = 0;
  let renderMes = 0;
  let toasts = [];
  let openedSheets = [];
  let closedSheets = [];
  let deletedIds = [];
  let bumpedRevs = [];
  let queuedSyncs = [];
  let notifications = [];
  let domNodes = {};
  let wrapUserOpCalls = 0;
  let allowUserOp = options.allowUserOp !== undefined ? options.allowUserOp : true;

  function getNode(id) {
    if (!domNodes[id]) {
      domNodes[id] = {
        id: id,
        innerHTML: "",
        value: "",
        classList: {
          classes: new Set(),
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
          list.forEach(fn => fn({ currentTarget: this, target: this, preventDefault: () => {} }));
        }
      };
    }
    return domNodes[id];
  }

  const deps = {
    getState: () => state,
    getItems: () => state.items,
    getSettings: () => state.settings,
    save: (opts) => {
      saves++;
      const p = options.saveFn ? options.saveFn(opts) : true;
      if (p && typeof p.then === "function") {
        p.catch(() => {});
      }
      return p;
    },
    render: () => { renders++; },
    renderMe: () => { renderMes++; },
    toast: (msg) => { toasts.push(msg); },
    openSheet: (id) => { openedSheets.push(id); },
    closeSheet: (id) => { closedSheets.push(id); },
    fmtTime: (ts) => ts ? new Date(ts).toISOString().slice(11, 16) : "",
    fmtDate: (ts) => ts ? new Date(ts).toISOString().slice(0, 10) : "",
    toLocalInput: (ts) => ts ? new Date(ts).toISOString().slice(0, 16) : "",
    parseLocalInput: (val) => val ? new Date(val).getTime() : 0,
    escapeHtml: (str) => String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;"),
    deleteItem: (id) => { deletedIds.push(id); state.items = state.items.filter(it => it.id !== id); },
    bumpRev: (it) => { it.rev = (it.rev || 1) + 1; bumpedRevs.push(it.id); },
    wrapUserOp: (fn, opts) => {
      wrapUserOpCalls++;
      return function (...args) {
        if (!allowUserOp) return false;
        return fn.apply(null, args);
      };
    },
    queueNativeReminderSync: (reason) => { queuedSyncs.push(reason); },
    inQuietHours: (d) => {
      const h = d.getHours();
      return h >= 22 || h < 7;
    },
    quietEnd: (d) => {
      const next = new Date(d);
      next.setHours(7, 0, 0, 0);
      if (next.getTime() <= d.getTime()) next.setDate(next.getDate() + 1);
      return next.getTime();
    },
    addDays: (d, n) => {
      const next = new Date(d);
      next.setDate(next.getDate() + n);
      return next;
    },
    systemBridge: () => null,
    showSystemNotification: (opts) => { notifications.push(opts); return true; },
    isNativeAndroid: () => false,
    writeIfChanged: (el, html) => {
      if (!el) return false;
      if (el.innerHTML === html) return false;
      el.innerHTML = html;
      return true;
    },
    query: (sel) => {
      if (sel.startsWith("#")) return getNode(sel.slice(1));
      return getNode(sel);
    },
    queryAll: (sel) => {
      return [];
    },
    getInitialReviewSettings: () => (options.getInitialReviewSettingsFn ? options.getInitialReviewSettingsFn() : {
      enabled: true, hour: 21, minute: 30, windowEndHour: 23, windowEndMinute: 0,
      followupCount: 0, snoozedUntil: 0, skippedUntil: 0, sessionStatus: "idle",
      lastSessionKey: "", maxFollowups: 2, followupMs: 3600000
    })
  };

  const review = api.createAppReview(deps);

  return {
    review,
    deps,
    state,
    domNodes,
    spies: {
      get saves() { return saves; },
      get renders() { return renders; },
      get renderMes() { return renderMes; },
      get toasts() { return toasts; },
      get openedSheets() { return openedSheets; },
      get closedSheets() { return closedSheets; },
      get deletedIds() { return deletedIds; },
      get bumpedRevs() { return bumpedRevs; },
      get queuedSyncs() { return queuedSyncs; },
      get notifications() { return notifications; },
      get wrapUserOpCalls() { return wrapUserOpCalls; },
      set allowUserOp(v) { allowUserOp = v; }
    }
  };
}

async function healthy(api) {
  // 1. REQUIRED_DEPS validation
  assert.throws(() => {
    api.createAppReview({});
  }, /缺少依赖/, "createAppReview without deps must throw");

  // 2. Initial settings & migration
  {
    const f = fixture(api, {
      settings: {
        review: {
          enabled: true,
          hour: 20,
          minute: 0,
          followupMs: 45 * 60 * 1000,
          maxFollowups: 1,
          lastSessionKey: "2026-09-23-20-00" // legacy without prefix
        }
      }
    });
    const rs = f.review.ensureReviewSettings();
    assert.strictEqual(rs.followupMs, 3600000, "legacy followupMs must migrate to 60m");
    assert.strictEqual(rs.maxFollowups, 2, "legacy maxFollowups must migrate to 2");
    assert.strictEqual(rs.lastSessionKey, "", "legacy lastSessionKey without prefix must be cleared");
  }

  // 3. reviewSessionKey format
  {
    const f = fixture(api);
    const d = new Date(2026, 8, 23, 21, 30, 0); // 2026-09-23
    const rs = f.review.ensureReviewSettings();
    const key = f.review.reviewSessionKey(d, rs);
    assert.strictEqual(key, "W:2026-9-23T21:30", "reviewSessionKey must match W:YYYY-M-DTHH:mm");
  }

  // 4. inReviewWindow logic & midnight wrap
  {
    const f = fixture(api);
    // Normal window: 21:30 - 23:00
    const nowInside = new Date(2026, 8, 23, 22, 0, 0);
    const nowBefore = new Date(2026, 8, 23, 20, 0, 0);
    const nowAfter = new Date(2026, 8, 23, 23, 30, 0);
    assert.strictEqual(f.review.inReviewWindow(nowInside), true, "22:00 must be in 21:30-23:00 window");
    assert.strictEqual(f.review.inReviewWindow(nowBefore), false, "20:00 must not be in window");
    assert.strictEqual(f.review.inReviewWindow(nowAfter), false, "23:30 must not be in window");

    // Snoozed suppresses maybeReviewSession
    const f2 = fixture(api, { items: [{ id: "s1", title: "待办", needsReview: true }] });
    const rs2 = f2.review.ensureReviewSettings();
    rs2.snoozedUntil = nowInside.getTime() + 60000;
    assert.strictEqual(f2.review.maybeReviewSession(nowInside.getTime()), undefined, "snoozed must suppress session");
    rs2.snoozedUntil = 0;

    // Skipped suppresses maybeReviewSession
    rs2.skippedUntil = nowInside.getTime() + 60000;
    assert.strictEqual(f2.review.maybeReviewSession(nowInside.getTime()), undefined, "skipped must suppress session");
    rs2.skippedUntil = 0;

    // Midnight wrap: 23:00 - 01:00
    const rs = f.review.ensureReviewSettings();
    rs.hour = 23; rs.minute = 0; rs.windowEndHour = 1; rs.windowEndMinute = 0;
    const nowMidInside1 = new Date(2026, 8, 23, 23, 30, 0);
    const nowMidInside2 = new Date(2026, 8, 24, 0, 30, 0);
    const nowMidOutside = new Date(2026, 8, 24, 2, 0, 0);
    assert.strictEqual(f.review.inReviewWindow(nowMidInside1), true, "23:30 in wrap window");
    assert.strictEqual(f.review.inReviewWindow(nowMidInside2), true, "00:30 in wrap window");
    assert.strictEqual(f.review.inReviewWindow(nowMidOutside), false, "02:00 outside wrap window");
  }

  // 5. isVagueContent & detectNeedsReview
  {
    const f = fixture(api);
    assert.strictEqual(f.review.isVagueContent("回头看看"), true, "vague keyword match");
    assert.strictEqual(f.review.isVagueContent("明天开会讨论Q3预算"), false, "specific content is not vague");
    assert.strictEqual(f.review.detectNeedsReview({ title: "买东西", triggerAt: 0, confidence: "none" }), true);
    assert.strictEqual(f.review.detectNeedsReview({ title: "准备周报", triggerAt: 12345, confidence: "high" }), false);
  }

  // 6. needsReviewItems filtering
  {
    const items = [
      { id: "1", title: "买东西", review_status: "NEEDS_REVIEW", status: "waiting" },
      { id: "2", title: "具体的任务", review_status: "REVIEWED", status: "waiting" },
      { id: "3", title: "已完成的待整理", review_status: "NEEDS_REVIEW", status: "completed" },
      { id: "4", title: "被标记待整理", review_status: "NEEDS_REVIEW", status: "waiting" }
    ];
    const f = fixture(api, { items });
    const list = f.review.needsReviewItems();
    assert.strictEqual(list.length, 2, "only uncompleted unarchived NEEDS_REVIEW items");
    assert.strictEqual(list[0].id, "1");
    assert.strictEqual(list[1].id, "4");
  }

  // 7. markReviewDone wrapped in wrapUserOp
  {
    const item = { id: "test-1", title: "待办事项", review_status: "NEEDS_REVIEW", rev: 1 };
    const f = fixture(api, { items: [item] });
    assert.strictEqual(f.spies.wrapUserOpCalls, 1, "wrapUserOp must wrap markReviewDone on creation");

    // Success case
    const res = f.review.markReviewDone(item, { triggerAt: 123456 });
    assert.strictEqual(res, true, "markReviewDone succeeds");
    assert.strictEqual(item.review_status, "REVIEWED", "review_status marked REVIEWED");
    assert.strictEqual(item.triggerAt, 123456, "extra triggerAt applied");
    assert.strictEqual(f.spies.bumpedRevs.length, 1, "rev bumped");

    // Aborted by transaction gate case
    f.spies.allowUserOp = false;
    const res2 = f.review.markReviewDone(item, { triggerAt: 999999 });
    assert.strictEqual(res2, false, "wrapUserOp denial returns false");
    assert.strictEqual(item.triggerAt, 123456, "item must not be modified if user op denied");
  }

  // 8. reviewConfirm aborts if markReviewDone returns false
  {
    const item = { id: "item-confirm", title: "买书", review_status: "NEEDS_REVIEW", status: "waiting" };
    const f = fixture(api, { items: [item] });
    f.review.openReviewSession();
    f.spies.allowUserOp = false;
    f.review.reviewConfirm();
    assert.strictEqual(item.review_status, "NEEDS_REVIEW", "item review_status remains NEEDS_REVIEW");
  }

  // 9. renderReviewEntry uses writeIfChanged and binds #openReview only when changed
  {
    const items = [{ id: "r1", title: "买书", review_status: "NEEDS_REVIEW", status: "waiting" }];
    const f = fixture(api, { items });
    f.review.renderReviewEntry();
    const btn = f.deps.query("#openReview");
    assert.strictEqual(btn.listeners["click"].length, 1, "first renderReviewEntry attaches listener");
    f.review.renderReviewEntry();
    assert.strictEqual(btn.listeners["click"].length, 1, "unchanged renderReviewEntry does not attach duplicate listener");
  }

  // 10. Quota limit enforcement
  {
    const items = [{ id: "r1", title: "买书", review_status: "NEEDS_REVIEW", status: "waiting" }];
    const f = fixture(api, { items });
    const rs = f.review.ensureReviewSettings();
    const nowInside = new Date(2026, 8, 23, 21, 45, 0);
    const key = f.review.reviewSessionKey(nowInside, rs);
    rs.lastSessionKey = key;
    rs.followupCount = 3; // >= maxNotifications (1 + 2 = 3)
    rs.maxFollowups = 2;
    rs.lastNotifiedAt = nowInside.getTime() - 2 * 3600000; // elapsed >= followupMs
    const toastsBefore = f.spies.toasts.length;
    f.review.maybeReviewSession(nowInside.getTime());
    assert.strictEqual(f.spies.toasts.length, toastsBefore, "exceeded maxNotifications must not trigger notification");
  }

  // 11. isFallbackSuppressed logic
  {
    const f = fixture(api);
    assert.strictEqual(f.review.isFallbackSuppressed({ isFallbackTrigger: true }), true, "fallback trigger is suppressed");
    assert.strictEqual(f.review.isFallbackSuppressed({ isFallbackTrigger: false }), false, "non-fallback trigger is not suppressed");
    f.review.ensureReviewSettings().enabled = false;
    assert.strictEqual(f.review.isFallbackSuppressed({ isFallbackTrigger: true }), false, "disabled review does not suppress");
  }

  // 12. Completion screen button closes sheetReview
  {
    const item = { id: "item-final", title: "最后一项", review_status: "NEEDS_REVIEW", status: "waiting" };
    const f = fixture(api, { items: [item] });
    f.review.openReviewSession();
    await f.review.reviewConfirm();
    const foot = f.deps.query("#reviewFoot");
    assert.ok(foot.innerHTML.includes('data-close="sheetReview"'), "completion button has data-close=sheetReview");
    const doneBtn = f.deps.query("#btnReviewDone");
    assert.ok(doneBtn, "#btnReviewDone node exists");
    doneBtn.dispatchEvent("click");
    assert.ok(f.spies.closedSheets.includes("sheetReview"), "clicking completion button closes sheetReview");
  }

  // 13. Save failure keeps reviewIndex, prevents completion, card remains retryable, retry advances
  {
    const item = { id: "item-retry", title: "保存失败重试", review_status: "NEEDS_REVIEW", status: "waiting" };
    let shouldFail = false;
    const f = fixture(api, {
      items: [item],
      saveFn: () => {
        if (shouldFail) return Promise.reject(new Error("idb-fault"));
        return Promise.resolve(true);
      }
    });
    f.review.openReviewSession();
    assert.strictEqual(f.state.ui.reviewIndex, 0);

    // First attempt fails
    shouldFail = true;
    await f.review.reviewConfirm();
    assert.strictEqual(f.state.ui.reviewIndex, 0, "reviewIndex must NOT advance on save failure");
    const body = f.deps.query("#reviewBody");
    assert.strictEqual(body.innerHTML.includes("整理完成"), false, "completion screen must NOT be shown on failure");
    assert.strictEqual(f.spies.queuedSyncs.length, 0, "queueNativeReminderSync must NOT be called on failure");

    // Second attempt (retry) succeeds
    shouldFail = false;
    await f.review.reviewConfirm();
    assert.strictEqual(f.state.ui.reviewIndex, 1, "reviewIndex advances after save succeeds");
    assert.strictEqual(body.innerHTML.includes("整理完成"), true, "completion screen shown after success");
    assert.strictEqual(f.spies.queuedSyncs.length, 1, "queueNativeReminderSync called after success");
  }

  // 14. Inflight gating prevents double click
  {
    const item = { id: "item-double", title: "防止双击", review_status: "NEEDS_REVIEW", status: "waiting" };
    let resolveSave;
    const savePromise = new Promise(resolve => { resolveSave = resolve; });
    let saveCount = 0;
    const f = fixture(api, {
      items: [item],
      saveFn: () => {
        saveCount++;
        return savePromise;
      }
    });
    f.review.openReviewSession();
    saveCount = 0;
    const p1 = f.review.reviewConfirm();
    const p2 = f.review.reviewConfirm(); // in-flight click
    assert.strictEqual(saveCount, 1, "in-flight second click must be ignored");
    resolveSave(true);
    await p1;
    await p2;
    assert.strictEqual(f.state.ui.reviewIndex, 1);
  }

  // 15. Session token protects against stale completion
  {
    const item1 = { id: "item-session-1", title: "会话1", review_status: "NEEDS_REVIEW", status: "waiting" };
    const item2 = { id: "item-session-2", title: "会话2", review_status: "NEEDS_REVIEW", status: "waiting" };
    let resolveStaleSave;
    const stalePromise = new Promise(resolve => { resolveStaleSave = resolve; });
    const f = fixture(api, {
      items: [item1, item2],
      saveFn: () => stalePromise
    });
    f.review.openReviewSession();
    const staleAction = f.review.reviewConfirm();
    f.review.openReviewSession();
    assert.strictEqual(f.state.ui.reviewIndex, 0);
    resolveStaleSave(true);
    await staleAction;
    assert.strictEqual(f.state.ui.reviewIndex, 0, "stale session save must not advance new session index");
  }

  // 16. Single source of truth: ensureReviewSettings strictly uses deps.getInitialReviewSettings
  {
    let customDefaultsCalled = false;
    const f = fixture(api, {
      settings: {},
      getInitialReviewSettingsFn: () => {
        customDefaultsCalled = true;
        return {
          enabled: false, hour: 18, minute: 15, windowEndHour: 19, windowEndMinute: 30,
          followupCount: 9, snoozedUntil: 0, skippedUntil: 0, sessionStatus: "custom",
          lastSessionKey: "", maxFollowups: 5, followupMs: 12345
        };
      }
    });
    const rs = f.review.ensureReviewSettings();
    assert.strictEqual(customDefaultsCalled, true, "ensureReviewSettings must call deps.getInitialReviewSettings");
    assert.strictEqual(rs.hour, 18);
    assert.strictEqual(rs.followupMs, 12345);
    assert.strictEqual(rs.sessionStatus, "custom");
  }

  return "healthy checks passed";
}

async function mutant(name, transform) {
  const mutatedSrc = transform(source);
  assert.notStrictEqual(mutatedSrc, source, name + " did not modify source");
  let failed = false;
  try {
    const api = load(mutatedSrc);
    await healthy(api);
  } catch (e) {
    failed = true;
  }
  assert.strictEqual(failed, true, name + " did not fail healthy behavior");
  return name + ": mutation detected";
}

(async () => {
  const out = [await healthy(load(source))];

  // 变异 1：窗口键前缀 "W:" 被移除（导致 lsk 校验与格式识别失效）
  out.push(await mutant("windowKeyPrefixMutant: prefix W: removed from reviewSessionKey", s => {
    return s.replace(
      'return "W:" + start.getFullYear()',
      'return start.getFullYear()'
    );
  }));

  // 变异 2：移除 followup 额度上限检查
  out.push(await mutant("quotaLimitBypassMutant: maxNotifications check removed", s => {
    return s.replace(
      "if (rs.lastSessionKey === key && rs.followupCount >= maxNotifications) {",
      "if (false && rs.lastSessionKey === key && rs.followupCount >= maxNotifications) {"
    ).replace(
      "rs.followupCount < maxNotifications &&",
      ""
    );
  }));

  // 变异 3：markReviewDone 绕过 wrapUserOp 包装
  out.push(await mutant("markReviewDoneUnwrappedMutant: wrapUserOp bypassed", s => {
    return s.replace(
      "const wrappedMarkReviewDone = deps.wrapUserOp(",
      "const wrappedMarkReviewDone = (rawMarkReviewDone); const _unused = deps.wrapUserOp("
    );
  }));

  // 变异 4：writeIfChanged 绕过短路，导致事件监听重复挂载
  out.push(await mutant("writeIfChangedBypassMutant: writeIfChanged short-circuit bypassed", s => {
    return s.replace(
      "if (!deps.writeIfChanged(host, html)) return;",
      "deps.writeIfChanged(host, html);"
    );
  }));

  // 变异 5：强制 isFallbackSuppressed 返回 false
  out.push(await mutant("fallbackSuppressedBypassMutant: isFallbackSuppressed forced false", s => {
    return s.replace(
      "function isFallbackSuppressed(it) {",
      "function isFallbackSuppressed(it) { return false;"
    );
  }));

  // 变异 6：完成按钮缺少关闭监听绑定
  out.push(await mutant("completionButtonListenerOmittedMutant: click listener not added to done button", s => {
    return s.replace(
      'doneBtn.addEventListener("click", () => {',
      '// doneBtn.addEventListener("click", () => {'
    );
  }));

  // 变异 7：保存失败依然推进 reviewIndex
  out.push(await mutant("saveFailureAdvanceMutant: reviewIndex advanced on save error", s => {
    return s.replace(
      "// Authoritative save rejected: do not advance reviewIndex or declare completion.",
      "const curState = deps.getState(); curState.ui.reviewIndex += 1;"
    );
  }));

  // 变异 8：使用硬编码默认值绕过 AppModel getInitialReviewSettings
  out.push(await mutant("appModelDefaultsBypassMutant: hardcoded defaults used instead of getInitialReviewSettings", s => {
    return s.replace(
      "const reviewDefaults = deps.getInitialReviewSettings();",
      "const reviewDefaults = { enabled: true, hour: 21, minute: 30, windowEndHour: 23, windowEndMinute: 0, followupCount: 0, snoozedUntil: 0, skippedUntil: 0, sessionStatus: 'idle', lastSessionKey: '', maxFollowups: 2, followupMs: 3600000 };"
    );
  }));

  const hashAfter = crypto.createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");
  assert.strictEqual(hashBefore, hashAfter, "lib/app-review.js must be byte-for-byte identical before and after mutations");

  out.push("lib/app-review.js before/after SHA-256 match: " + hashBefore);
  console.log(out.join("\n"));
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
