#!/usr/bin/env node
/* U1 反例（单元层）：稍后面板入口 —— 选时状态由 app-events 实例持有，闸门具名注入。
 *
 * 覆盖（对应独立复验 20260924T0909 处置要求）：
 *   T1 点「稍后提醒」按钮能打开面板（走 bindListeners 注册的真实委托 click 处理器）
 *   T2 待办事务被闸门拒绝（isItemActionPending → rejectPendingItemCommand，面板不开）
 *   T3 选中 chip 后关闭再打开，不沿用旧值（旧缺陷：snoozePick 赋值 ReferenceError / 重置缺失）
 *   T4 正常确认调用 snoozeItem 恰好一次，且确认后选择被清空
 *   T5 变异对照：删掉「打开时重置」两行后，T3 必须变红
 *
 * 用法：node 01-unit-snooze-entry.js [--app-events <path>]
 * 退出码：0 = 全部通过；1 = 有失败（变异模式下「失败」恰是期望结果，由本脚本内部判定）。
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log("  ✓ " + name); }
  else { fail += 1; failures.push(name); console.log("  ✗ " + name + (detail !== undefined ? " — " + JSON.stringify(detail) : "")); }
}

/* ---------- DOM 替身 ---------- */
function makeEnv(opts) {
  const pendingGate = { on: false, id: null };
  const calls = {
    openSheet: [], closeSheet: [], snoozeItem: [], reject: [], toast: [], hideAlert: [],
    errors: []
  };
  function makeEl(idOrSel) {
    const classes = new Set();
    const handlers = {};
    return {
      __id: idOrSel,
      value: "",
      dataset: {},
      classList: {
        add(c) { classes.add(c); },
        remove(c) { classes.delete(c); },
        contains(c) { return classes.has(c); },
        toggle(c) { classes.has(c) ? classes.delete(c) : classes.add(c); }
      },
      addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
      removeEventListener(type, fn) {
        if (handlers[type]) handlers[type] = handlers[type].filter(h => h !== fn);
      },
      __handlers: handlers,
      __classes: classes
    };
  }
  const snoozeCustom = makeEl("#snoozeCustom");
  const btnApplySnooze = makeEl("#btnApplySnooze");
  const chips = ["10", "tonight", "tomorrow"].map(m => {
    const el = makeEl("chip-" + m);
    if (/^\d+$/.test(m)) el.dataset.min = m; else el.dataset.preset = m;
    return el;
  });
  const doc = makeEl("document");
  const win = makeEl("window");
  doc.querySelector = function (sel) {
    if (sel === "#snoozeCustom") return snoozeCustom;
    if (sel === "#btnApplySnooze") return btnApplySnooze;
    return null;
  };
  doc.querySelectorAll = function (sel) {
    if (sel === "#snoozeChips .chip") return chips.slice();
    return [];
  };
  const state = { items: [], projects: [], notes: [], settings: {}, ui: {} };
  const deps = {
    getState: () => state,
    render: () => {}, renderHome: () => {}, renderFuture: () => {}, renderMe: () => {},
    openCapture: () => {},
    closeSheet: (name) => calls.closeSheet.push(name),
    closeAllSheets: () => {},
    openSheet: (name) => calls.openSheet.push(name),
    openDetail: () => {}, openEditItem: () => {},
    save: () => {}, saveItemFromForm: () => {},
    setLowConfPick: () => {}, finishSaveAfterLowConf: () => {},
    confirmDialog: () => Promise.resolve(true),
    toast: (msg) => calls.toast.push(msg),
    inflightDepth: () => 0,
    ackItem: () => true,
    snoozeItem: (id, when, basis) => { calls.snoozeItem.push({ id, when, basis }); return true; },
    completeItem: () => true, deleteItem: () => true, reopenItem: () => true, restoreItem: () => true,
    stopRepeat: () => true, resumeDeadlineProtection: () => true,
    isItemActionPending: (id) => pendingGate.on && (pendingGate.id == null || pendingGate.id === id),
    rejectPendingItemCommand: () => { calls.reject.push(1); },
    setUserMode: () => {},
    setNativeReminderStatus: () => {}, queueNativeReminderSync: () => {},
    isNativeAndroidRuntime: () => false,
    waitForNativeBridge: () => Promise.resolve(true),
    openSystemSetting: () => Promise.resolve(true),
    openReviewSession: () => {},
    handleAlarmAction: () => Promise.resolve(),
    bindSetupReviewControls: () => {},
    toLocalInput: (ts) => "mock-local-input:" + ts, parseLocalInput: () => null,
    nextWeekend: () => new Date(), addDays: (d) => new Date(),
    applyClock: () => new Date(), endOfDay: () => new Date(),
    pad: (n) => String(n), uid: () => "test-uid", escapeHtml: (s) => String(s),
    hideAlert: () => { calls.hideAlert.push(1); },
    makeItem: (o) => Object.assign({ id: "item-id" }, o),
    getNativeReminders: () => ({})
  };
  return { doc, win, chips, snoozeCustom, btnApplySnooze, state, deps, calls, pendingGate };
}

function loadFactory(appEventsPath) {
  const abs = path.resolve(appEventsPath);
  delete require.cache[abs];
  const mod = require(abs);
  return mod.createAppEvents || (mod.default && mod.default.createAppEvents);
}

function bind(env, factory) {
  /* 注意：app-events 内部 $/$$ 运行时读全局 document，场景期间必须保持存活 */
  global.document = env.doc;
  global.window = env.win;
  const instance = factory(env.deps);
  instance.bind();
  return instance;
}

/* 派发文档级委托 click（data-act 路径）——真实处理器，不走 instance.openSnoozeSheet 直调 */
async function dispatchDocClick(env, act, id) {
  const fakeEvent = {
    target: { closest: (sel) => (sel === "[data-act]" ? { dataset: { act, id } } : null) },
    preventDefault: () => {}, stopPropagation: () => {}
  };
  const handlers = (env.doc.__handlers.click || []).slice();
  for (const h of handlers) {
    try {
      const r = h(fakeEvent);
      if (r && typeof r.then === "function") await r;
    } catch (err) {
      env.calls.errors.push(String(err && err.message || err));
    }
  }
}

/* ---------- 场景 ---------- */
/* T1：点按钮能打开 */
async function scenarioOpen(env) {
  await dispatchDocClick(env, "snooze", "it-1");
  return {
    opened: env.calls.openSheet.indexOf("sheetSnooze") >= 0,
    detailClosed: env.calls.closeSheet.indexOf("sheetDetail") >= 0,
    snoozeId: env.state.ui.snoozeId,
    errors: env.calls.errors.slice()
  };
}

/* T3：选中 chip → 关闭 → 重开，不沿用旧值（再确认必须「请选择时间」且 snoozeItem 零调用） */
async function scenarioReopenClears(env) {
  await dispatchDocClick(env, "snooze", "it-1");
  env.chips[1].__handlers.click[0]();            // tonight
  const pickedCustom = env.snoozeCustom.value;
  env.instance.openSnoozeSheet("it-1");          // 重开（= 关闭后再次打开）
  const chipStillOn = env.chips.some(c => c.__classes.has("on"));
  env.btnApplySnooze.__handlers.click[0]();      // 不重选直接确认
  return {
    pickedCustomNonEmpty: pickedCustom !== "",
    chipStillOn,
    snoozeItemCount: env.calls.snoozeItem.length,
    toastAsked: env.calls.toast.indexOf("请选择时间") >= 0
  };
}

/* T4：正常确认恰好一次 */
async function scenarioConfirmOnce(env) {
  await dispatchDocClick(env, "snooze", "it-1");
  env.chips[0].__handlers.click[0]();            // data-min=10
  const before = Date.now();
  env.btnApplySnooze.__handlers.click[0]();
  const after = Date.now();
  const calls = env.calls.snoozeItem;
  const okArgs = calls.length === 1 && calls[0].id === "it-1" &&
    calls[0].basis === "elapsed" && calls[0].when >= before + 9 * 60000 && calls[0].when <= after + 11 * 60000;
  env.btnApplySnooze.__handlers.click[0]();      // 第二次确认：无选择，不得再 snooze
  return {
    exactlyOnce: calls.length === 1,
    okArgs,
    sheetClosed: env.calls.closeSheet.indexOf("sheetSnooze") >= 0,
    alertHidden: env.calls.hideAlert.length >= 1,
    secondConfirmNoop: env.calls.snoozeItem.length === 1 && env.calls.toast.indexOf("请选择时间") >= 0,
    before, after
  };
}

/* ---------- 装载 ---------- */
const args = process.argv.slice(2);
let appEventsPath = path.join(__dirname, "..", "..", "..", "..", "..", "lib", "app-events.js");
const idx = args.indexOf("--app-events");
if (idx >= 0) appEventsPath = args[idx + 1];

const factory = loadFactory(appEventsPath);
const source = fs.readFileSync(appEventsPath, "utf8");
const isMutant = source.indexOf("state.ui.snoozeId = id;\n      snoozePick = null;") < 0;

(async function main() {
  console.log("== U1 反例：稍后面板入口（单元层）==");
  console.log("  被测: " + appEventsPath + (isMutant ? "  [变异体]" : "  [原版]"));

  if (isMutant) {
    /* 变异模式：只跑 T3，期望它变红（旧值被沿用） */
    const env = makeEnv();
    env.instance = bind(env, factory);
    const r = await scenarioReopenClears(env);
    ok("[变异体] 选中后重开，旧选择**被沿用**（snoozeItem 被调用）", r.snoozeItemCount === 1, r.snoozeItemCount);
    const red = failures.length > 0 || r.snoozeItemCount === 1;
    console.log((red && r.snoozeItemCount === 1) ? "\nMUTANT_RED=1（变异被反例点名）" : "\nMUTANT_RED=0（变异未被点名！）");
    process.exit(r.snoozeItemCount === 1 ? 10 : 1);
  }

  /* T1 */
  {
    const env = makeEnv();
    env.instance = bind(env, factory);
    const r = await scenarioOpen(env);
    ok("T1 点「稍后提醒」按钮打开面板", r.opened === true, r);
    ok("T1 打开前先关详情弹层", r.detailClosed === true);
    ok("T1 state.ui.snoozeId 指向目标事项", r.snoozeId === "it-1", r.snoozeId);
    ok("T1 无 ReferenceError（旧缺陷：snoozePick is not defined）", r.errors.length === 0, r.errors);
  }

  /* T2 */
  {
    const env = makeEnv();
    env.instance = bind(env, factory);
    env.pendingGate.on = true; env.pendingGate.id = "it-2";
    const before = env.calls.openSheet.length;
    const ret = env.instance.openSnoozeSheet("it-2");
    ok("T2 闸门拒绝：openSnoozeSheet 返回 false", ret === false, ret);
    ok("T2 rejectPendingItemCommand 被调用一次", env.calls.reject.length === 1, env.calls.reject.length);
    ok("T2 面板未打开", env.calls.openSheet.length === before);
    ok("T2 snoozeId 未被改写", env.state.ui.snoozeId !== "it-2", env.state.ui.snoozeId);
  }

  /* T3 */
  {
    const env = makeEnv();
    env.instance = bind(env, factory);
    const r = await scenarioReopenClears(env);
    ok("T3 前置：chip 选中确实写入过自定义输入", r.pickedCustomNonEmpty === true);
    ok("T3 重开时 chip 高亮被清", r.chipStillOn === false);
    ok("T3 重开不沿用旧值（未重选即确认 → 请选择时间，snoozeItem 零调用）",
      r.snoozeItemCount === 0 && r.toastAsked === true, r);
  }

  /* T4 */
  {
    const env = makeEnv();
    env.instance = bind(env, factory);
    const r = await scenarioConfirmOnce(env);
    ok("T4 确认调用 snoozeItem 恰好一次且参数正确", r.exactlyOnce && r.okArgs, r);
    ok("T4 确认后关闭稍后面板并隐藏弹条", r.sheetClosed && r.alertHidden);
    ok("T4 第二次确认不再触发（确认后选择已清空）", r.secondConfirmNoop === true, r);
  }

  /* T5 变异对照：在本脚本内现场构造变异体 */
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "u1-mutant-"));
    const mutated = source.replace(
      'state.ui.snoozeId = id;\n      snoozePick = null;\n      snoozeBasis = "elapsed";',
      'state.ui.snoozeId = id;'
    );
    ok("T5 前置：变异真的删到了「打开时重置」两行", mutated !== source);
    const mutantPath = path.join(tmp, "app-events.mutant.js");
    fs.writeFileSync(mutantPath, mutated, "utf8");
    const { execFileSync } = require("child_process");
    let out = "";
    let code = 0;
    try {
      execFileSync(process.execPath, [__filename, "--app-events", mutantPath], { encoding: "utf8" });
    } catch (e) {
      code = e.status; out = e.stdout || "";
    }
    ok("T5 变异对照：删掉重置后反例变红（MUTANT_RED=1）", code === 10 && /MUTANT_RED=1/.test(out),
      { exit: code, tail: out.trim().split("\n").slice(-2) });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }

  console.log("\n通过: " + pass + "  失败: " + fail);
  if (fail === 0) { console.log("全部通过。"); process.exit(0); }
  console.log("失败项: " + JSON.stringify(failures));
  process.exit(1);
})();
