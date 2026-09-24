/* P3-I direct modularization behavior and contract validation tests.
 * Validates lib/app-action-feedback.js, lib/app-events.js, and lib/app-test-api.js.
 */
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");

const filesToTest = [
  "lib/app-action-feedback.js",
  "lib/app-events.js",
  "lib/app-notices.js",
  "lib/app-test-api.js"
];

const fileHashesBefore = {};
filesToTest.forEach(rel => {
  const abs = path.join(ROOT, rel);
  fileHashesBefore[rel] = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
});

function loadModuleInVm(relPath, sandboxExtras, sourceOverride) {
  const abs = path.join(ROOT, relPath);
  const code = typeof sourceOverride === "string" ? sourceOverride : fs.readFileSync(abs, "utf8");
  const sandbox = Object.assign({
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    AttentionLib: {}
  }, sandboxExtras || {});
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: relPath });
  return sandbox;
}

let passed = 0;
function ok(desc, condition, extra) {
  if (!condition) {
    throw new Error("FAILED: " + desc + (extra ? " — " + extra : ""));
  }
  passed++;
  console.log("  ✓ " + desc);
}

console.log("== P3-I. AppActionFeedback, AppEvents, AppNotices & AppTestApi 模块自测 ==");

// 1. UMD 工厂纯净度（求值期无 I/O，无 DOM 查询，无状态突变）
{
  for (const rel of filesToTest) {
    let queryAttempted = false;
    const s = loadModuleInVm(rel, {
      document: {
        querySelector: () => { queryAttempted = true; return null; },
        querySelectorAll: () => { queryAttempted = true; return []; }
      }
    });
    ok(rel + "：求值期纯净且不主动查询 DOM", queryAttempted === false);
  }
}

// 2. AppActionFeedback 工厂与依赖守卫
{
  const sb = loadModuleInVm("lib/app-action-feedback.js");
  const factory = sb.AttentionLib.AppActionFeedback.createAppActionFeedback;
  ok("AppActionFeedback 挂载于 AttentionLib.AppActionFeedback.createAppActionFeedback", typeof factory === "function");

  // 依赖缺失抛错
  let threw = false;
  try {
    factory({});
  } catch (err) {
    threw = true;
    ok("AppActionFeedback 缺必要依赖时同步抛错（fail closed）", /缺少必要依赖/.test(err.message));
  }
  assert.strictEqual(threw, true);

  // 正常初始化与实例方法
  const fakeState = { items: [], settings: {} };
  const toastCalls = [];
  const instance = factory({
    getState: () => fakeState,
    getNativeReminderStatus: () => ({ native: true }),
    isNativeReady: () => true,
    isNativeAndroidRuntime: () => false,
    getFeedbackLib: () => ({
      saveFeedback: (kind) => ({ text: "feedback-" + kind, actionLabel: "undo", actionKind: "undo-new" }),
      reminderFeedback: () => ({ text: "reminder-fb", actionLabel: "view", actionKind: "open-item" }),
      actionSpec: (kind) => ({ name: kind, label: kind }),
      UNDO_WINDOW_MS: 8000
    }),
    getEvidenceLib: () => ({}),
    getNativeReminders: () => ({}),
    toast: (text, action, onAction, dur, undoCtx) => {
      toastCalls.push({ text, action, onAction, dur, undoCtx });
    },
    undoNewItem: () => true,
    openDetail: () => {},
    openSheet: () => {},
    openReviewSession: () => {},
    refreshNotifyLab: () => Promise.resolve(),
    restoreItemForm: () => {},
    queueNativeReminderSync: () => {}
  });

  const CONTRACT_METHODS = [
    "announceSaveOutcome", "settleSaveFeedback", "itemScheduleEvidence",
    "feedbackNativeSnapshot", "feedbackItemSnapshot", "feedbackVerdictFor",
    "runFeedbackAction"
  ];
  CONTRACT_METHODS.forEach(m => {
    ok("AppActionFeedback 包含合同成员 " + m, typeof instance[m] === "function");
  });

  // 测试 announceSaveOutcome 触发 toast
  const testItem = { id: "test-item-1", title: "测试事项", rev: 1, triggerAt: Date.now() + 10000 };
  fakeState.items.push(testItem);
  instance.announceSaveOutcome(testItem.id, { editing: false });
  ok("announceSaveOutcome 记录保存结果并派发 toast", toastCalls.length >= 1);
  ok("settleSaveFeedback 正常调用无异常", typeof instance.settleSaveFeedback === "function");
  instance.settleSaveFeedback();
}

// 3. AppEvents 工厂、依赖守卫与绑定幂等
{
  const sb = loadModuleInVm("lib/app-events.js");
  const factory = sb.AttentionLib.AppEvents.createAppEvents;
  ok("AppEvents 挂载于 AttentionLib.AppEvents.createAppEvents", typeof factory === "function");

  let threw = false;
  try {
    factory({});
  } catch (err) {
    threw = true;
    ok("AppEvents 缺必要依赖时同步抛错（fail closed）", /缺少必要依赖/.test(err.message));
  }
  assert.strictEqual(threw, true);

  // 模拟 DOM 环境
  const eventListeners = new Map();
  function addListener(target, type, fn) {
    if (!eventListeners.has(target)) eventListeners.set(target, []);
    eventListeners.get(target).push({ type, fn });
  }

  const fakeElement = (id) => ({
    id: id,
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    addEventListener(type, fn) { addListener(id, type, fn); },
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; }
  });

  const fakeDoc = {
    addEventListener(type, fn) { addListener("document", type, fn); },
    querySelector(sel) { return fakeElement(sel); },
    querySelectorAll() { return [fakeElement("item-1")]; }
  };
  const fakeWin = {
    addEventListener(type, fn) { addListener("window", type, fn); }
  };

  const fakeState = { items: [], projects: [], notes: [], settings: {}, ui: {} };
  const instance = factory({
    getState: () => fakeState,
    render: () => {},
    renderHome: () => {},
    renderFuture: () => {},
    renderMe: () => {},
    openCapture: () => {},
    closeSheet: () => {},
    closeAllSheets: () => {},
    openSheet: () => {},
    openDetail: () => {},
    openEditItem: () => {},
    save: () => {},
    saveItemFromForm: () => {},
    setLowConfPick: () => {},
    finishSaveAfterLowConf: () => {},
    confirmDialog: () => Promise.resolve(true),
    toast: () => {},
    inflightDepth: () => 0,
    ackItem: () => true,
    snoozeItem: () => true,
    completeItem: () => true,
    deleteItem: () => true,
    reopenItem: () => true,
    restoreItem: () => true,
    stopRepeat: () => true,
    resumeDeadlineProtection: () => true,
    isItemActionPending: () => false,
    rejectPendingItemCommand: () => {},
    setUserMode: () => {},
    setNativeReminderStatus: () => {},
    queueNativeReminderSync: () => {},
    isNativeAndroidRuntime: () => false,
    waitForNativeBridge: () => Promise.resolve(true),
    openSystemSetting: () => Promise.resolve(true),
    openReviewSession: () => {},
    handleAlarmAction: () => Promise.resolve(),
    getDiagnostics: () => null,
    getAppContent: () => null,
    getAppCapture: () => null,
    getAppAlerts: () => null,
    getAi: () => null,
    getBackup: () => null,
    getAppModel: () => null,
    bindSetupReviewControls: () => {},
    toLocalInput: () => "",
    parseLocalInput: () => null,
    nextWeekend: () => new Date(),
    addDays: (d, n) => new Date(),
    applyClock: (d, t) => new Date(),
    endOfDay: (d) => new Date(),
    pad: (n) => String(n),
    uid: () => "test-uid",
    escapeHtml: (s) => String(s),
    hideAlert: () => {},
    makeItem: (opts) => Object.assign({ id: "item-id" }, opts),
    getNativeReminders: () => ({})
  });

  const CONTRACT_METHODS = [
    "bind", "isBound", "openSnoozeSheet", "applyShareParams", "handleQueryActions",
    "demoPreviewRows", "openDemoPreview", "seed"
  ];
  CONTRACT_METHODS.forEach(m => {
    ok("AppEvents 包含合同成员 " + m, typeof instance[m] === "function");
  });

  // demoPreviewRows 返回只读条目
  const rows = instance.demoPreviewRows();
  ok("demoPreviewRows 返回只读示例行（长度为 5）", Array.isArray(rows) && rows.length === 5);

  // 绑定幂等性测试
  sb.document = fakeDoc;
  sb.window = fakeWin;

  ok("初始未绑定", instance.isBound() === false);
  instance.bind();
  ok("初次 bind() 后 isBound() 为 true", instance.isBound() === true);
  const listenerCount1 = Array.from(eventListeners.values()).reduce((acc, l) => acc + l.length, 0);

  // 二次 bind() 必须短路，不得重复注册监听
  instance.bind();
  const listenerCount2 = Array.from(eventListeners.values()).reduce((acc, l) => acc + l.length, 0);
  ok("重复调用 bind() 不累加事件监听（幂等）", listenerCount1 === listenerCount2 && listenerCount1 > 0);
}

/**
 * 3b. AppEvents 绑定失败必须可回滚、可重试，且重试不得翻倍。
 *
 * 为什么单独立一节：独立复验 F1（run `20260923T2243-p3i-independent-recheck`）证明，
 * 只测「成功后的重复绑定」会让「失败后重试」这条路径完全裸奔 —— 那时 `bound` 已经是
 * `true`，重试直接短路，界面看着正常、监听器却是 0。这里按抛出点位置分成早段/后段，
 * 并补上「被委托模块已成功绑定」与「摘掉回滚必须变红」两条对照。
 *
 * 独立复验方的原始反例脚本保留在
 * `docs/reviews/verification-runs/20260923T2243-p3i-independent-recheck/repro-events-bind-retry.js`，
 * 本节是它的扩展版（多出后段、被委托模块与变异对照）。
 */
{
  const eventsSource = fs.readFileSync(path.join(ROOT, "lib/app-events.js"), "utf8");
  const requiredDeps = eventsSource.match(/const REQUIRED_DEPS = \[([\s\S]*?)\];/)[1]
    .match(/"[^"]+"/g).map(JSON.parse);

  /** 全部依赖先填成空实现；需要的那些用 overrides 覆盖（与独立复验反例同一手法）。 */
  function eventDeps(overrides) {
    const built = {};
    requiredDeps.forEach(name => { built[name] = function() {}; });
    return Object.assign(built, overrides || {});
  }

  /**
   * 极简 DOM 桩：只记录「哪个节点在哪个事件上挂了哪个函数」，**支持 removeEventListener**。
   * 支持解绑是本节的要害 —— 回滚有没有真的发生，只能靠「计数回到 0」来证明。
   */
  function makeDom() {
    const records = [];
    function node(name) {
      return {
        name: name,
        dataset: {}, hidden: false,
        classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
        setAttribute() {}, getAttribute() { return null; },
        addEventListener(type, fn) { records.push({ node: name, type: type, fn: fn }); },
        removeEventListener(type, fn) {
          const i = records.findIndex(r => r.node === name && r.type === type && r.fn === fn);
          if (i >= 0) records.splice(i, 1);
        }
      };
    }
    const doc = node("document");
    doc.querySelector = function() { return null; };
    doc.querySelectorAll = function() { return []; };
    return { doc: doc, node: node, count: name => records.filter(r => r.node === name).length };
  }

  function fresh(sandboxExtras, sourceOverride) {
    const sb = loadModuleInVm("lib/app-events.js", sandboxExtras, sourceOverride);
    return sb.AttentionLib.AppEvents.createAppEvents;
  }

  // 对照：健康首次绑定挂上 1 个 document 监听器（下面每一处计数都以它为基准）
  const controlDom = makeDom();
  const control = fresh({ document: controlDom.doc })(eventDeps());
  control.bind();
  const CONTROL = controlDom.count("document");
  ok("AppEvents 对照：健康绑定挂上 document 监听器且宣布已绑定",
    control.isBound() === true && CONTROL === 1);

  // 早段抛错：任何注册动作之前就失败
  {
    const dom = makeDom();
    let setupCalls = 0;
    const instance = fresh({ document: dom.doc })(eventDeps({
      bindSetupReviewControls: function() {
        setupCalls++;
        if (setupCalls === 1) throw new Error("early bind failure");
      }
    }));
    let threw = false;
    try { instance.bind(); } catch (error) { threw = true; }
    ok("AppEvents 早段绑定抛错：原样上抛且不宣布已绑定", threw === true && instance.isBound() === false);
    ok("AppEvents 早段绑定抛错：不留半套监听器", dom.count("document") === 0);
    instance.bind();
    ok("AppEvents 早段抛错后重试真的重进绑定（不短路）",
      setupCalls === 2 && instance.isBound() === true && dom.count("document") === CONTROL,
      JSON.stringify({ setupCalls: setupCalls, bound: instance.isBound(), listeners: dom.count("document") }));
  }

  // 后段抛错：注册动作全部完成之后才失败（只把 bound 挪到末尾救不了这种）
  {
    const dom = makeDom();
    let lastCalls = 0;
    const instance = fresh({ document: dom.doc })(eventDeps({
      bindAppContent: function() {
        lastCalls++;
        if (lastCalls === 1) throw new Error("late bind failure");
      }
    }));
    let threw = false;
    try { instance.bind(); } catch (error) { threw = true; }
    ok("AppEvents 后段绑定抛错：原样上抛且不宣布已绑定", threw === true && instance.isBound() === false);
    ok("AppEvents 后段绑定抛错：已登记的监听器被整体回滚", dom.count("document") === 0,
      JSON.stringify({ listeners: dom.count("document") }));
    instance.bind();
    ok("AppEvents 后段抛错后重试不翻倍（等于对照计数）",
      instance.isBound() === true && dom.count("document") === CONTROL,
      JSON.stringify({ listeners: dom.count("document"), control: CONTROL }));
  }

  // 部分监听器已注册：被委托模块成功绑定之后本模块才抛错
  {
    const dom = makeDom();
    const captureNode = dom.node("capText");
    let captureBound = false;
    let captureRegistrations = 0;
    const fakeCapture = {
      bind: function() {
        if (captureBound) return;
        captureBound = true;
        captureRegistrations++;
        captureNode.addEventListener("input", function() {});
      }
    };
    let lastCalls = 0;
    const instance = fresh({ document: dom.doc })(eventDeps({
      getAppCapture: function() { return fakeCapture; },
      bindAppContent: function() {
        lastCalls++;
        if (lastCalls === 1) throw new Error("late bind failure");
      }
    }));
    try { instance.bind(); } catch (error) {}
    ok("AppEvents 被委托模块已绑定时本模块失败：本模块监听器整体回滚、被委托监听器保留",
      dom.count("document") === 0 && dom.count("capText") === 1,
      JSON.stringify({ doc: dom.count("document"), capture: dom.count("capText") }));
    instance.bind();
    ok("AppEvents 重试不得让已绑定的被委托监听器翻倍",
      dom.count("document") === CONTROL && dom.count("capText") === 1 && captureRegistrations === 1,
      JSON.stringify({ doc: dom.count("document"), capture: dom.count("capText"), registrations: captureRegistrations }));
  }

  // 对照必须有牙齿：摘掉回滚之后，后段抛错的重试必须翻倍变红
  {
    const mutated = eventsSource.replace("        rollbackListeners();\n", "");
    ok("（前置）变异真的改到了 catch 里的回滚调用（否则下面那条是空断言）", mutated !== eventsSource);
    const dom = makeDom();
    let lastCalls = 0;
    const instance = fresh({ document: dom.doc }, mutated)(eventDeps({
      bindAppContent: function() {
        lastCalls++;
        if (lastCalls === 1) throw new Error("late bind failure");
      }
    }));
    try { instance.bind(); } catch (error) {}
    instance.bind();
    ok("对照：摘掉回滚后，后段抛错的重试会翻倍（证明上面的回滚断言有牙齿）",
      dom.count("document") === CONTROL * 2,
      JSON.stringify({ listeners: dom.count("document"), expected: CONTROL * 2 }));
  }
}

// 3c. AppNotices（P3-I-R 迁出）：告知判定 / 单写入者渲染 / 每日轻摘要
//
// 迁出之后只剩这一份实现，所以这里必须**行为级**验证 —— 尤其「只在能确证断链时出声」
// 这条纪律：它坏掉时界面完全正常，只有「该出声时没出声」，覆盖率矩阵看不出来。
{
  const factory = loadModuleInVm("lib/app-notices.js").AttentionLib.AppNotices.createAppNotices;
  ok("AppNotices 挂载于 AttentionLib.AppNotices.createAppNotices", typeof factory === "function");

  let threw = false;
  try {
    factory({});
  } catch (err) {
    threw = true;
    ok("AppNotices 缺必要依赖时同步抛错（fail closed）", /缺少必要依赖/.test(err.message));
  }
  assert.strictEqual(threw, true);

  const noticesSource = fs.readFileSync(path.join(ROOT, "lib/app-notices.js"), "utf8");
  const requiredDeps = noticesSource.match(/const REQUIRED_DEPS = \[([\s\S]*?)\];/)[1]
    .match(/"[^"]+"/g).map(JSON.parse);
  function noticeDeps(overrides) {
    const built = {};
    requiredDeps.forEach(name => { built[name] = function() {}; });
    return Object.assign(built, overrides || {});
  }

  // (1) 四档断链判定 + 「未定一律不出声」红线
  {
    const n = factory(noticeDeps({}));
    const on = { notify: true };
    ok("AppNotices 判定①：总开关关闭优先于权限 —— 说「开关」不说「去授权」",
      n.homeNoticeVerdict({ notifications: "denied" }, { notify: false }, true).kind === "switch");
    ok("AppNotices 判定②：系统通知权限被拒 ⇒ permission",
      n.homeNoticeVerdict({ notifications: "denied" }, on, true).kind === "permission");
    ok("AppNotices 判定③：原生桥未就绪 ⇒ bridge",
      n.homeNoticeVerdict({ bridgeNotReady: true }, on, true).kind === "bridge");
    ok("AppNotices 判定④：对账失败 ⇒ error",
      n.homeNoticeVerdict({ reliability: "error" }, on, true).kind === "error");
    ok("AppNotices 判定：链路正常 ⇒ null（不出声）",
      n.homeNoticeVerdict({ notifications: "granted" }, on, true) === null);
    ok("AppNotices 红线：notifications=unknown 是「还没问过」⇒ null",
      n.homeNoticeVerdict({ notifications: "unknown" }, on, true) === null);
    ok("AppNotices 红线：未知桥状态（未定）⇒ null",
      n.homeNoticeVerdict({}, on, true) === null);
    ok("AppNotices 红线：非原生运行时 ⇒ null（Web 上没有「关掉 App 就不响」这件事）",
      n.homeNoticeVerdict({ notifications: "denied" }, on, false) === null);
    ok("AppNotices 范围边界：exactAlarm=denied 不进首页（只影响到达时刻）",
      n.homeNoticeVerdict({ notifications: "granted", exactAlarm: "denied" }, on, true) === null);
  }

  // (2) renderHomeNotice：#homeNotice 单写入者 + 断链消失时主动清空
  {
    const writes = [];
    let status = { notifications: "granted" };
    const host = { innerHTML: "", addEventListener() {} };
    const btn = { addEventListener() {} };
    const n = factory(noticeDeps({
      getStatus: () => status,
      getState: () => ({ settings: { notify: true }, ui: { tab: "home" } }),
      isNativeAndroidRuntime: () => true,
      query: sel => (sel === "#homeNotice" ? host : sel === "#homeNoticeBtn" ? btn : null),
      escapeHtml: s => String(s),
      writeIfChanged: (node, html) => {
        if (node.innerHTML === html) return false;
        node.innerHTML = html; writes.push(html); return true;
      }
    }));
    ok("AppNotices 渲染：链路正常 ⇒ 返回 null 且容器保持空",
      n.renderHomeNotice() === null && host.innerHTML === "" && writes.length === 0);
    status = { notifications: "denied" };
    const v = n.renderHomeNotice();
    ok("AppNotices 渲染：断链 ⇒ 返回同一判定并写入告警",
      v && v.kind === "permission" && writes.length === 1 && /permission/.test(host.innerHTML));
    n.renderHomeNotice();
    ok("AppNotices 渲染：结论未变 ⇒ 不重复写同一容器（单写入者短路）",
      writes.length === 1, JSON.stringify({ writes: writes.length }));
    status = { notifications: "granted" };
    ok("AppNotices 渲染：断链消失 ⇒ 主动清空（警告不残留）",
      n.renderHomeNotice() === null && host.innerHTML === "" && writes.length === 2);
    ok("AppNotices 渲染：无容器时安静返回 null（不抛）",
      factory(noticeDeps({ getState: () => ({ settings: {} }), query: () => null })).renderHomeNotice() === null);
  }

  // (3) maybeDailySummary：计数阈值 + 20 小时节流 + 一处保存
  {
    const NOW = Date.UTC(2026, 8, 23, 3, 0, 0);
    const build = (items, settingsOverride) => {
      const state = {
        settings: Object.assign({ dailySummary: true, lastSummaryAt: 0 }, settingsOverride || {}),
        items: items
      };
      const log = { saved: 0, toasts: [], notifs: [] };
      const n = factory(noticeDeps({
        now: () => NOW,
        getState: () => state,
        startOfDay: d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; },
        save: () => { log.saved++; },
        toast: m => { log.toasts.push(m); },
        showSystemNotification: o => { log.notifs.push(o); }
      }));
      return { n, state, log };
    };
    const three = build([{ id: "a", createdAt: NOW, priority: "normal" },
      { id: "b", createdAt: NOW, priority: "normal" },
      { id: "c", createdAt: NOW, priority: "normal" }]);
    const first = three.n.maybeDailySummary();
    ok("AppNotices 摘要：今天新增 3 条 ⇒ 出摘要（toast + 系统通知各一次、只保存一次）",
      typeof first === "string" && three.log.toasts.length === 1 &&
      three.log.notifs.length === 1 && three.log.saved === 1);
    ok("AppNotices 摘要：20 小时内再调 ⇒ 直接 null（不重复打扰）",
      three.n.maybeDailySummary() === null && three.log.toasts.length === 1);

    const one = build([{ id: "d", createdAt: NOW, priority: "important" }]);
    ok("AppNotices 摘要：不足 3 条但有重要项 ⇒ 仍然出声",
      typeof one.n.maybeDailySummary() === "string" && one.log.toasts.length === 1);

    const off = build([{ id: "e", createdAt: NOW, priority: "normal" }], { dailySummary: false });
    ok("AppNotices 摘要：总开关关闭 ⇒ null 且不保存、不打扰",
      off.n.maybeDailySummary() === null && off.log.saved === 0 && off.log.toasts.length === 0);
  }

  // (4) 时钟一致性：摘要里所有时间必须走**同一个**注入时间源。
  //
  // 背景（2026-09-24 实测）：`maybeDailySummary` 原本写 `deps.startOfDay(new Date())`，
  // 同一函数里的节流与 `lastSummaryAt` 却走 `deps.now()` —— 函数挂在两个时钟上。
  // 后果不只是不可测：**跨过本地午夜后这组断言会整体翻转**，而上一版"全绿"只是跑在午夜前。
  //
  // 判据要有牙齿：取两个相隔很远、且**分别落在不同本地日期**的固定时刻，都要求出摘要。
  // 真实今天是唯一的某一天，所以「两个都成立」在读真实墙钟时**不可能**为真。
  {
    const atFixedNow = ms => {
      const state = {
        settings: { dailySummary: true, lastSummaryAt: 0 },
        items: [{ id: "x", createdAt: ms, priority: "normal" },
          { id: "y", createdAt: ms, priority: "normal" },
          { id: "z", createdAt: ms, priority: "normal" }]
      };
      const log = { saved: 0, toasts: [], notifs: [] };
      const notices = factory(noticeDeps({
        now: () => ms,
        getState: () => state,
        startOfDay: d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; },
        save: () => { log.saved++; },
        toast: m => { log.toasts.push(m); },
        showSystemNotification: o => { log.notifs.push(o); }
      }));
      return { out: notices.maybeDailySummary(), log: log };
    };
    const A = Date.UTC(2026, 2, 5, 7, 0, 0);    // 2026-03-05
    const B = Date.UTC(2026, 10, 15, 20, 0, 0); // 2026-11-15
    const ra = atFixedNow(A);
    const rb = atFixedNow(B);
    ok("AppNotices 摘要：不读真实墙钟 —— 两个相隔很远的固定时刻都出摘要",
      typeof ra.out === "string" && typeof rb.out === "string",
      JSON.stringify({ A: ra.out, B: rb.out, realNow: new Date().toISOString() }));
    ok("AppNotices 摘要：两个时刻各自保存一次、打扰各一次",
      ra.log.saved === 1 && ra.log.toasts.length === 1 && ra.log.notifs.length === 1 &&
      rb.log.saved === 1 && rb.log.toasts.length === 1 && rb.log.notifs.length === 1,
      JSON.stringify({ A: ra.log, B: rb.log }));

    // 变异对照：把 `new Date(getNow())` 改回 `new Date()`，上面那条必须变红。
    const noticesSource = fs.readFileSync(path.join(ROOT, "lib/app-notices.js"), "utf8");
    const anchor = "deps.startOfDay(new Date(getNow()))";
    if (noticesSource.indexOf(anchor) === -1) {
      throw new Error("变异锚点未命中：lib/app-notices.js 里找不到 " + anchor);
    }
    const wallClockSource = noticesSource.replace(anchor, "deps.startOfDay(new Date())");
    const wallClockFactory = loadModuleInVm("lib/app-notices.js", null, wallClockSource)
      .AttentionLib.AppNotices.createAppNotices;
    const stillGreen = [A, B].every(ms => {
      const state = {
        settings: { dailySummary: true, lastSummaryAt: 0 },
        items: [{ id: "x", createdAt: ms, priority: "normal" },
          { id: "y", createdAt: ms, priority: "normal" },
          { id: "z", createdAt: ms, priority: "normal" }]
      };
      return typeof wallClockFactory(noticeDeps({
        now: () => ms,
        getState: () => state,
        startOfDay: d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; },
        save: () => {}, toast: () => {}, showSystemNotification: () => {}
      })).maybeDailySummary() === "string";
    });
    ok("AppNotices 摘要：改回 new Date() 后时钟断言变红（对照组有牙齿）",
      stillGreen === false,
      "现实日期=" + new Date().toLocaleDateString() + "，两个固定日期仍全绿说明断言恒真");
  }
}

// 4. AppTestApi 工厂、依赖守卫与动态 getter 验证
{
  const sb = loadModuleInVm("lib/app-test-api.js");
  const factory = sb.AttentionLib.AppTestApi.createAppTestApi;
  ok("AppTestApi 挂载于 AttentionLib.AppTestApi.createAppTestApi", typeof factory === "function");

  let threw = false;
  try {
    factory({});
  } catch (err) {
    threw = true;
    ok("AppTestApi 缺必要依赖时同步抛错（fail closed）", /缺少必要依赖/.test(err.message));
  }
  assert.strictEqual(threw, true);

  let currentLiveState = { items: [{ id: "i1", title: "Live 1" }] };
  const mockCoordinator = {
    getDeliveryEvidenceState: () => ({ count: 1 }),
    getNativeSyncMetrics: () => ({ runs: 3 })
  };
  const mockReview = {
    picked: false,
    markReviewTriggerPicked: function(v) { this.picked = v; }
  };
  const mockAlerts = {
    cleared: false,
    clearAlert: function() { this.cleared = true; }
  };
  const mockNotices = {
    summarized: 0,
    homeNoticeVerdict: () => ({ kind: "none" }),
    renderHomeNotice: () => true,
    maybeDailySummary: function() { this.summarized += 1; return true; }
  };

  let deadlineArgs = null;
  let reminderArgs = null;

  const instance = factory({
    getState: () => currentLiveState,
    getAppItems: () => ({}),
    getAppTransaction: () => ({}),
    getAppNativeCoordinator: () => mockCoordinator,
    getAppPlatform: () => ({}),
    getAppAlerts: () => mockAlerts,
    getAppViews: () => ({}),
    getAppReview: () => mockReview,
    getAppContent: () => ({}),
    getAppCapture: () => ({}),
    getAppSetup: () => ({}),
    getDiagnostics: () => ({}),
    getAppActionFeedback: () => ({}),
    getAppEvents: () => ({}),
    getAppNotices: () => mockNotices,
    getAppPersistence: () => ({ getStorage: () => ({ key: "val" }) }),
    getAi: () => ({ isBusy: () => false }),
    getBackup: () => ({ buildLegacyBackupPayload: () => ({ app: "attention-inbox", schema: 1, items: [] }) }),
    applyDeadlineEvents: function() { deadlineArgs = Array.from(arguments); return true; },
    applyReminderEvents: function() { reminderArgs = Array.from(arguments); return true; }
  });

  ok("AppTestApi 包含合同成员 assembleTestApi", typeof instance.assembleTestApi === "function");
  ok("AppTestApi 包含合同成员 getTestApi", typeof instance.getTestApi === "function");

  const assembled = instance.assembleTestApi(sb);
  ok("assembleTestApi 返回测试接口对象", typeof assembled === "object" && assembled !== null);
  const api = instance.getTestApi();
  ok("getTestApi 返回测试接口对象", typeof api === "object" && api !== null);
  ok("assembleTestApi 挂载到宿主全局 __ATTENTION_INBOX__", sb.__ATTENTION_INBOX__ === api);

  // 动态引用测试：state 更新后 getter 必须动态返回最新引用
  ok("api.state 动态读取初始状态", api.state.items.length === 1 && api.state.items[0].id === "i1");
  currentLiveState = { items: [{ id: "i2", title: "Live 2" }, { id: "i3", title: "Live 3" }] };
  ok("api.state 动态反映运行时状态变更（无陈旧闭包）", api.state.items.length === 2 && api.state.items[0].id === "i2");

  // buildLegacyBackupPayload 作为方法可直接调用
  ok("api.buildLegacyBackupPayload 是可调用的函数", typeof api.buildLegacyBackupPayload === "function");
  const payload = api.buildLegacyBackupPayload();
  ok("api.buildLegacyBackupPayload() 返回规范备份快照", payload && payload.app === "attention-inbox");

  // applyDeadlineEvents / applyReminderEvents 全参数透传
  api.applyReminderEvents(["ev1"], 12345, [{ itemId: "cancel-1" }]);
  ok("applyReminderEvents 透传全部 3 个参数（含 cancelledEvents）",
    deadlineArgs === null &&
    reminderArgs !== null &&
    reminderArgs.length === 3 &&
    reminderArgs[2][0].itemId === "cancel-1");

  api.applyDeadlineEvents(["dl1"], 67890, [{ itemId: "cancel-2" }]);
  ok("applyDeadlineEvents 透传全部 3 个参数（含 cancelledStages）",
    deadlineArgs !== null &&
    deadlineArgs.length === 3 &&
    deadlineArgs[2][0].itemId === "cancel-2");

  // P3-I-R：告知实例在测试接口上的访问器与轻摘要桥接
  ok("api.notices 返回告知实例（动态 getter）", api.notices === mockNotices);
  ok("api.maybeDailySummary 桥接到告知实例（不是空返回）",
    api.maybeDailySummary() === true && mockNotices.summarized === 1,
    JSON.stringify({ summarized: mockNotices.summarized }));
  ok("api.homeNoticeVerdict / renderHomeNotice 均已挂载",
    typeof api.homeNoticeVerdict === "function" && typeof api.renderHomeNotice === "function");

  // assembleTestApi 挂载全局
  instance.assembleTestApi();
  ok("assembleTestApi 成功将接口挂载至 globalThis.__ATTENTION_INBOX__",
    sb.globalThis.__ATTENTION_INBOX__ !== undefined &&
    sb.globalThis.__ATTENTION_INBOX__.state.items.length === 2);
}

// 5. 源码无污染收口验证
{
  for (const rel of filesToTest) {
    const abs = path.join(ROOT, rel);
    const hashAfter = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    ok(rel + "：测试运行未篡改源文件内容", hashAfter === fileHashesBefore[rel]);
  }
}

console.log("全部通过：共 " + passed + " 项断言。");
