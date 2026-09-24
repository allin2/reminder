/* P3-D direct items behavior and source mutation checks.
 * Uses the loaded source in temporary context, never rewriting the product file.
 */
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const targetPath = path.join(ROOT, "lib/app-items.js");
const source = fs.readFileSync(targetPath, "utf8");
const hashBefore = crypto.createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");

function load(src) {
  const box = { module: { exports: {} }, self: {} };
  vm.runInNewContext(src, box, { filename: "lib/app-items.js" });
  return box.module.exports;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fixture(api, options) {
  options = options || {};
  let state = {
    schema: 5,
    items: [],
    settings: { ackExplained: true }
  };
  let failSave = !!options.failSave;
  let saveCount = 0;
  let renderCount = 0;
  let nativeSyncCount = 0;
  let undoNativeCheckPending = false;
  let idCounter = 100;
  let replayCreatedId = null;
  let inflight = options.inflight || 0;
  const toasts = [];

  const deps = {
    getItems: () => state.items,
    setItems: v => { state.items = v; },
    getSettings: () => state.settings,
    save: () => {
      saveCount++;
      if (failSave) {
        return Promise.reject(new Error("idb-write-fail"));
      }
      return Promise.resolve(true);
    },
    render: () => { renderCount++; },
    toast: (msg, actionText, actionFn) => { toasts.push({ msg, actionText, actionFn }); },
    fmtTime: ts => new Date(ts).toISOString(),
    toLocalInput: ts => "2026-09-23T10:00",
    uid: () => "uid-" + (++idCounter),
    bumpRev: it => { it.rev = (it.rev || 0) + 1; },
    isTerminal: it => (it && (it.status === "archived" || it.status === "deleted")),
    normalizeItem: it => Object.assign({
      rev: 1,
      title: "",
      status: "waiting",
      priority: "normal",
      delivery_mode: "scheduled_exact",
      tags: [],
      projectId: "",
      scheduleBasis: "wall-clock",
      localTrigger: null,
      triggerAt: null,
      deadlineAt: null,
      repeat: null,
      seriesId: null,
      repeatParentId: null,
      remindCount: 0,
      lastRemindAt: null,
      acknowledgedAt: null,
      deliveredAt: null,
      completedAt: null
    }, it),
    makeItem: fields => deps.normalizeItem(fields),
    resolveDeliveryMode: p => (p === "critical" ? "scheduled_exact" : "inexact"),
    nextRepeatTrigger: (it, fromTs) => (fromTs || Date.now()) + 86400000,
    takeReplayCreatedId: () => {
      const id = replayCreatedId;
      replayCreatedId = null;
      return id;
    },
    isFeedbackSuppressed: () => false,
    inflightDepth: () => inflight,
    runUserOp: (fn, args, opts) => {
      return fn.apply(null, args || []);
    },
    wrapUserOp: (fn, opts) => {
      const wrapped = function () {
        if (inflight > 0) return false;
        return fn.apply(null, arguments);
      };
      wrapped.__wrapped = true;
      wrapped.__opts = opts;
      return wrapped;
    },
    openSnoozeSheet: id => {},
    openRestoreSnooze: id => {},
    goToArchive: () => {},
    markUndoNativeCheckPending: () => { undoNativeCheckPending = true; },
    queueNativeReminderSync: reason => { nativeSyncCount++; },
    isFallbackSuppressed: it => false,
    inQuietHours: d => false,
    quietEnd: d => Date.now(),
    deadlineStageKeyOf: (dl, now) => (now >= dl ? "due" : null),
    applyWindowTrigger: (it, now) => null,
    actionSpec: (kind, opts) => ({ sub: "sub", firstTimeText: "first", firstTimeAction: "snooze" }),
    getUndoWindowMs: () => 8000,
    suppressPastReminderReplay: (it, now) => null
  };

  const appItems = api.createAppItems(deps);
  return {
    items: appItems,
    deps: deps,
    state: () => state,
    toasts: () => toasts,
    getSaveCount: () => saveCount,
    setInflight: d => { inflight = d; },
    setReplayCreatedId: id => { replayCreatedId = id; },
    setFailSave: v => { failSave = v; },
    getUndoNativeCheckPending: () => undoNativeCheckPending
  };
}

async function healthy(api) {
  // 1. ACK vs Calendar 周期推进时点 + 稳定 seriesId 继承
  {
    const f = fixture(api);
    const ackItem = f.deps.makeItem({
      id: "it-ack",
      title: "ACK Task",
      status: "waiting",
      triggerAt: Date.now() - 1000,
      repeat: { mode: "ack", every: "day" }
    });
    f.state().items.push(ackItem);

    const ackResult = f.items.ackItem(ackItem.id);
    assert.strictEqual(ackResult, true, "ackItem must succeed");
    assert.strictEqual(ackItem.status, "acknowledged", "ackItem must transition to acknowledged");
    assert.ok(ackItem.acknowledgedAt, "acknowledgedAt must be set");

    const ackDerived = f.state().items.filter(x => x.id !== ackItem.id);
    assert.strictEqual(ackDerived.length, 1, "ACK mode must derive 1 next instance on ACK");
    assert.strictEqual(ackDerived[0].seriesId, ackItem.seriesId, "derived instance must inherit seriesId");
    assert.strictEqual(ackDerived[0].repeatParentId, ackItem.id, "derived instance must set repeatParentId");
    assert.strictEqual(ackDerived[0].status, "waiting", "derived instance must start in waiting");

    // Calendar 模式：ACK 不推进，完成才推进
    const calItem = f.deps.makeItem({
      id: "it-cal",
      title: "Calendar Task",
      status: "waiting",
      triggerAt: Date.now() - 1000,
      repeat: { mode: "calendar", every: "day" }
    });
    f.state().items.push(calItem);

    const calAckResult = f.items.ackItem(calItem.id);
    assert.strictEqual(calAckResult, true, "Calendar ackItem must succeed");
    assert.strictEqual(calItem.status, "acknowledged", "Calendar item becomes acknowledged on ACK");

    const calDerivedOnAck = f.state().items.filter(x => x.seriesId === calItem.seriesId && x.id !== calItem.id);
    assert.strictEqual(calDerivedOnAck.length, 0, "Calendar mode must NOT derive next instance on ACK");

    const calCompleteResult = f.items.completeItem(calItem.id);
    assert.strictEqual(calCompleteResult, true, "Calendar completeItem must succeed");
    assert.strictEqual(calItem.status, "archived", "Calendar item becomes archived on complete");

    const calDerivedOnComplete = f.state().items.filter(x => x.seriesId === calItem.seriesId && x.id !== calItem.id);
    assert.strictEqual(calDerivedOnComplete.length, 1, "Calendar mode must derive 1 next instance on complete");
    assert.strictEqual(calDerivedOnComplete[0].repeatParentId, calItem.id, "derived instance must reference calItem");
    assert.strictEqual(calDerivedOnComplete[0].status, "waiting", "derived instance must start in waiting");
  }

  // 2. stopRepeat：归档当前项与未来未开始项，严格保留历史已确认/已投递项
  {
    const f = fixture(api);
    const histItem = f.deps.makeItem({
      id: "it-hist",
      title: "Hist",
      status: "acknowledged",
      acknowledgedAt: Date.now() - 50000,
      seriesId: "s-stop",
      repeat: { mode: "calendar", every: "day" }
    });
    const currItem = f.deps.makeItem({
      id: "it-curr",
      title: "Curr",
      status: "waiting",
      seriesId: "s-stop",
      repeat: { mode: "calendar", every: "day" }
    });
    const unstartedItem = f.deps.makeItem({
      id: "it-unstarted",
      title: "Future Unstarted",
      status: "waiting",
      seriesId: "s-stop",
      remindCount: 0,
      acknowledgedAt: null,
      deliveredAt: null,
      repeat: { mode: "calendar", every: "day" }
    });
    f.state().items.push(histItem, currItem, unstartedItem);

    const stopRes = f.items.stopRepeat(currItem.id);
    assert.strictEqual(stopRes, true, "stopRepeat must succeed");
    assert.strictEqual(currItem.status, "archived", "current item must be archived");
    assert.strictEqual(currItem.repeat, null, "current item repeat rule must be cleared");
    assert.strictEqual(unstartedItem.status, "archived", "unstarted item must be archived");
    assert.strictEqual(unstartedItem.completedAt, null, "unstarted item completedAt must be null");
    assert.strictEqual(histItem.status, "acknowledged", "historical acknowledged item status must be preserved");
    assert.ok(histItem.acknowledgedAt, "historical acknowledged item acknowledgedAt must be preserved");
  }

  // 3. promoteDue：在途深度 > 0 时直接短路抑制，正常时推进 overdue 项
  {
    const f = fixture(api);
    const overdue = f.deps.makeItem({
      id: "it-due",
      title: "Overdue",
      status: "waiting",
      triggerAt: Date.now() - 5000
    });
    f.state().items.push(overdue);

    f.setInflight(1);
    const suppressed = f.items.promoteDue(Date.now());
    assert.strictEqual(suppressed, false, "promoteDue must return false when inflight > 0");
    assert.strictEqual(overdue.status, "waiting", "overdue item must not transition to due while inflight > 0");

    f.setInflight(0);
    f.items.promoteDue(Date.now());
    assert.strictEqual(overdue.status, "due", "overdue item must transition to due when inflight == 0");
  }

  // 4. 有限撤销：持久化失败时回滚可见状态，保留重试入口
  {
    const f = fixture(api);
    const target = f.deps.makeItem({
      id: "it-undo",
      title: "Undo Target",
      status: "waiting",
      triggerAt: Date.now() + 3600000
    });
    f.state().items.push(target);

    // complete 成功建立 undo 入口
    const completed = f.items.completeItem(target.id);
    assert.strictEqual(completed, true, "completeItem must succeed");
    assert.strictEqual(target.status, "archived", "target must be archived");
    assert.ok(f.items.lastCompleteUndo(), "lastCompleteUndoState must be populated");

    // 尝试撤销，但 save 失败
    f.setFailSave(true);
    const undoRes = f.items.undoLastComplete();
    assert.strictEqual(undoRes, true, "undoLastComplete initiates operation");
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(target.status, "archived", "target status must roll back to archived on save failure");
    assert.ok(f.items.lastCompleteUndo(), "lastCompleteUndoState must be retained on save failure for retry");
  }

  // 5. wrapUserOp 包装与重放 ID 消费
  {
    const f = fixture(api);
    assert.strictEqual(f.items.ackItem.__wrapped, true, "ackItem must be wrapped with wrapUserOp");
    assert.strictEqual(f.items.completeItem.__wrapped, true, "completeItem must be wrapped with wrapUserOp");
    assert.strictEqual(f.items.snoozeItem.__wrapped, true, "snoozeItem must be wrapped with wrapUserOp");
    assert.strictEqual(f.items.deleteItem.__wrapped, true, "deleteItem must be wrapped with wrapUserOp");

    // takeReplayCreatedId 消费
    f.setReplayCreatedId("replay-new-id");
    const created = f.items.applyNewItem("ignored-id", { title: "Replayed New Item" });
    assert.strictEqual(created, true, "applyNewItem succeeds");
    const found = f.state().items.find(x => x.id === "replay-new-id");
    assert.ok(found, "applyNewItem must consume replayCreatedId");
  }

  return "healthy direct behavior: PASS";
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

  // 1. ACK 周期推进破坏
  out.push(await mutant("ACK repeat derivation bypassed", s => {
    return s.replace('if (it.repeat && it.repeat.every && it.repeat.mode === "ack") {',
      'if (false && it.repeat && it.repeat.every && it.repeat.mode === "ack") {');
  }));

  // 2. Calendar 周期推进破坏
  out.push(await mutant("Calendar repeat derivation on complete bypassed", s => {
    return s.replace("advanceSeriesOnArchive(it);", "// advanceSeriesOnArchive(it);");
  }));

  // 3. stopRepeat 破坏历史已确认事项
  out.push(await mutant("stopRepeat overwrites historical acknowledged status", s => {
    return s.replace("if (!isUnstartedInstance(m)) return;",
      "// if (!isUnstartedInstance(m)) return;");
  }));

  // 4. promoteDue 在途抑制移除
  out.push(await mutant("promoteDue inflight check removed", s => {
    return s.replace("if (deps.inflightDepth() > 0) return false;",
      "// if (deps.inflightDepth() > 0) return false;");
  }));

  // 5. 撤销失败回滚移除
  out.push(await mutant("undo complete failure rollback removed", s => {
    return s.replace("revertCompleteUndo(command);",
      "// revertCompleteUndo(command);");
  }));

  // 6. wrapUserOp 包装移除
  out.push(await mutant("wrapUserOp wrapper removed on completeItem", s => {
    return s.replace("completeItem: wrappedCompleteItem,",
      "completeItem: rawCompleteItem,");
  }));

  // 7. applyNewItem 忽略 replayCreatedId
  out.push(await mutant("applyNewItem ignores replayCreatedId", s => {
    return s.replace("if (replayId) id = replayId;",
      "// if (replayId) id = replayId;");
  }));

  const hashAfter = crypto.createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");
  assert.strictEqual(hashBefore, hashAfter, "lib/app-items.js must be byte-for-byte identical before and after mutations");

  out.push("lib/app-items.js before/after SHA-256 match: " + hashBefore);
  console.log(out.join("\n"));
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
