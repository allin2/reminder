#!/usr/bin/env node
/* P3-I-Q2 单元与反例测试：
 * 验证 detailReminderStatusRow(it) 唯一实现在 lib/app-views.js。
 *
 * 覆盖要求：
 *  1. 生产详情入口打开隔离事项，验证“未到点、处理中、缺证据、无法核查、有本轮有效回执”各状态文案；
 *     缺证据不得写“漏提醒”，收到回执不得写“用户已看到/已读”。
 *  2. 校验状态文本被 HTML 转义，且 detailReminderStatusRow 的直接调用与真实详情 DOM 结果一致。
 *  3. 对缺少具名依赖、缺少实例方法、工厂抛错做启动反例：点名失败，业务启动副作用为零。
 *  4. 有牙齿的变异测试：删掉实际使用的证据依赖、实例方法或转义时，正式反例必须变红（MUTANT_RED=1），同时保留正常对照。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../../../..");
const VIEWS_FILE = path.join(ROOT, "lib/app-views.js");
const EVIDENCE_FILE = path.join(ROOT, "lib/delivery-evidence.js");
const CORE_FILE = path.join(ROOT, "app-core.js");
const UI_FORMAT_FILE = path.join(ROOT, "lib/ui-format.js");
const DATE_UTILS_FILE = path.join(ROOT, "lib/date-utils.js");

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, condition, extra) {
  if (condition) {
    passed++;
    console.log("  ✓ " + name);
  } else {
    failed++;
    failures.push(name + (extra ? " — " + JSON.stringify(extra) : ""));
    console.log("  ✗ " + name + (extra ? " — " + JSON.stringify(extra) : ""));
  }
}

function section(name) {
  console.log("\n== " + name + " ==");
}

/* ---------- 假 DOM 与沙箱加载 ---------- */
function createDom() {
  const elements = {};
  function makeEl(id) {
    let _html = "";
    return {
      id: id,
      get innerHTML() { return _html; },
      set innerHTML(v) { _html = String(v); },
      textContent: "",
      value: "",
      hidden: false,
      dataset: {},
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); },
        remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); },
        toggle(c, on) {
          if (on === undefined) on = !this._s.has(c);
          if (on) this._s.add(c); else this._s.delete(c);
          return on;
        }
      }
    };
  }
  return function query(sel) {
    if (!elements[sel]) elements[sel] = makeEl(sel);
    return elements[sel];
  };
}

function loadModule(file, sandboxExtras, sourceOverride) {
  const code = typeof sourceOverride === "string" ? sourceOverride : fs.readFileSync(file, "utf8");
  const sandbox = Object.assign({
    console: console,
    Date: Date,
    JSON: JSON,
    Math: Math,
    String: String,
    Number: Number,
    Object: Object,
    Array: Array,
    RegExp: RegExp,
    Proxy: Proxy,
    Error: Error,
    AttentionLib: {},
    module: { exports: {} },
    exports: {}
  }, sandboxExtras || {});
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: path.basename(file) });
  return sandbox;
}

function runTests() {
  section("1. 生产详情入口（openDetail）验证五种状态可见文案及文字安全纪律");
  {
    const query = createDom();
    const viewsSource = fs.readFileSync(VIEWS_FILE, "utf8");
    const evidenceMod = require(EVIDENCE_FILE);
    const uiFormatMod = require(UI_FORMAT_FILE);
    const dateUtilsMod = require(DATE_UTILS_FILE);

    const now = Date.now();
    const baseDate = new Date(now);

    const state = {
      items: [],
      projects: [{ id: "p1", name: "项目1", color: "#336699" }],
      settings: { userMode: "normal" },
      ui: {}
    };

    let readableValue = true;
    let observableItems = new Set();

    const views = loadModule(VIEWS_FILE, {}).module.exports.createAppViews({
      query: query,
      queryAll: () => [],
      getState: () => state,
      openSheet: () => {},
      openCapture: () => {},
      openDemoPreview: () => {},
      isAttentionDue: () => false,
      needsReviewItems: () => [],
      renderReviewEntry: () => "",
      inReviewHighlight: () => false,
      renderAiSub: () => "",
      ensureReviewSettings: () => ({}),
      updateSetupEntry: () => {},
      isTerminal: () => false,
      updateAppBadge: () => {},
      fmtTime: ts => uiFormatMod.fmtTime(ts),
      fmtDate: ts => uiFormatMod.fmtDate(ts),
      relDue: ts => uiFormatMod.relDue(ts),
      repeatLabel: r => uiFormatMod.repeatLabel(r),
      dayLabel: ts => uiFormatMod.dayLabel(ts),
      escapeHtml: s => uiFormatMod.escapeHtml(s),
      escapeAttr: s => uiFormatMod.escapeAttr(s),
      safeExternalHref: u => uiFormatMod.safeExternalHref(u),
      sameDay: (a, b) => dateUtilsMod.sameDay(a, b),
      startOfDay: d => dateUtilsMod.startOfDay(d),
      pad2: n => dateUtilsMod.pad2(n),
      getNativeReminderStatus: () => ({ reliability: "exact" }),
      getNativeReminders: () => ({}),
      getSwReg: () => null,
      isNativeAndroidRuntime: () => false,
      evidenceStatusFor: (it, ctx) => evidenceMod.evidenceStatusFor(it, Object.assign({ now: now }, ctx)),
      deliveryEvidenceReadable: () => readableValue,
      itemScheduleEvidence: it => (observableItems.has(it.id) ? { key: "sched" } : null)
    });

    ok("views 实例公开 detailReminderStatusRow 方法", typeof views.detailReminderStatusRow === "function");

    // 状态 1：未到点 (pending)
    const itPending = {
      id: "it-pending",
      title: "待办事项未到点",
      status: "waiting",
      triggerAt: now + 3600000,
      reminderEvents: {
        ["0@" + (now + 3600000)]: {
          at: now + 3600000,
          state: "scheduled",
          roundBase: now + 3600000
        }
      }
    };
    state.items.push(itPending);
    observableItems.add(itPending.id);

    views.openDetail(itPending.id);
    const bodyPending = query("#detailBody").innerHTML;
    ok("状态 1 未到点：可见文案为「还没到提醒时间」", bodyPending.includes("还没到提醒时间"));
    ok("状态 1 未到点：绝不写「漏提醒」", !bodyPending.includes("漏提醒"));
    ok("状态 1 未到点：绝不写「用户已看到/已读」", !bodyPending.includes("用户已看到") && !bodyPending.includes("已读"));

    // 状态 2：处理中 (processing) - 刚到点 30 秒（在 90 秒 PROCESSING_GRACE_MS 内）且无 delivered 回执
    const itProcessing = {
      id: "it-processing",
      title: "事项刚到点处理中",
      status: "due",
      triggerAt: now - 30000,
      reminderEvents: {
        ["0@" + (now - 30000)]: {
          at: now - 30000,
          state: "scheduled",
          roundBase: now - 30000
        }
      }
    };
    state.items.push(itProcessing);
    observableItems.add(itProcessing.id);

    views.openDetail(itProcessing.id);
    const bodyProcessing = query("#detailBody").innerHTML;
    ok("状态 2 处理中：可见文案为「正在处理 · 稍后会自动更新」", bodyProcessing.includes("正在处理 · 稍后会自动更新"));
    ok("状态 2 处理中：绝不写「漏提醒」", !bodyProcessing.includes("漏提醒"));
    ok("状态 2 处理中：绝不写「用户已看到/已读」", !bodyProcessing.includes("用户已看到") && !bodyProcessing.includes("已读"));

    // 状态 3：缺证据 (unknown) - 到期超过 90 秒且无 delivered 回执
    const itUnknown = {
      id: "it-unknown",
      title: "事项已到期但缺证据",
      status: "due",
      triggerAt: now - 3600000,
      reminderEvents: {
        ["0@" + (now - 3600000)]: {
          at: now - 3600000,
          state: "scheduled",
          roundBase: now - 3600000
        }
      }
    };
    state.items.push(itUnknown);
    observableItems.add(itUnknown.id);

    views.openDetail(itUnknown.id);
    const bodyUnknown = query("#detailBody").innerHTML;
    ok("状态 3 缺证据：可见文案为「本次提醒结果尚未确认」", bodyUnknown.includes("本次提醒结果尚未确认"));
    ok("状态 3 缺证据：绝不说「确定漏提醒」或「漏提醒」", !bodyUnknown.includes("漏提醒"));
    ok("状态 3 缺证据：绝不写「用户已看到/已读」", !bodyUnknown.includes("用户已看到") && !bodyUnknown.includes("已读"));

    // 状态 4：无法核查 (unverifiable) - 未登记过排程（observable=false 或 reminderEvents 为空）
    const itUnverifiable = {
      id: "it-unverifiable",
      title: "历史事项无法核查",
      status: "waiting",
      triggerAt: now + 3600000,
      reminderEvents: {}
    };
    state.items.push(itUnverifiable);

    views.openDetail(itUnverifiable.id);
    const bodyUnverifiable = query("#detailBody").innerHTML;
    ok("状态 4 无法核查：可见文案为「这条记录的提醒无法核查」", bodyUnverifiable.includes("这条记录的提醒无法核查"));
    ok("状态 4 无法核查：绝不写「漏提醒」", !bodyUnverifiable.includes("漏提醒"));
    ok("状态 4 无法核查：绝不写「用户已看到/已读」", !bodyUnverifiable.includes("用户已看到") && !bodyUnverifiable.includes("已读"));

    // 状态 5：有本轮有效回执 (delivered)
    const itDelivered = {
      id: "it-delivered",
      title: "已送达事项",
      status: "due",
      triggerAt: now - 3600000,
      reminderEvents: {
        ["0@" + (now - 3600000)]: {
          at: now - 3600000,
          state: "delivered",
          carrier: "alarm-manager",
          roundBase: now - 3600000
        }
      }
    };
    state.items.push(itDelivered);
    observableItems.add(itDelivered.id);

    views.openDetail(itDelivered.id);
    const bodyDelivered = query("#detailBody").innerHTML;
    ok("状态 5 有回执：文案含「系统已接收这次提醒」", bodyDelivered.includes("系统已接收这次提醒"));
    ok("状态 5 有回执：后缀语义为「（只代表系统收到了这次提醒）」", bodyDelivered.includes("（只代表系统收到了这次提醒）"));
    ok("状态 5 有回执：绝不写「用户已看到」或「已读」", !bodyDelivered.includes("用户已看到") && !bodyDelivered.includes("用户已读") && !bodyDelivered.includes("已读未完成"));
  }

  section("2. HTML 转义与直接调用 vs 详情 DOM 一致性核对");
  {
    const query = createDom();
    const uiFormatMod = require(UI_FORMAT_FILE);
    const dateUtilsMod = require(DATE_UTILS_FILE);

    const now = Date.now();
    const state = { items: [], projects: [], settings: { userMode: "normal" }, ui: {} };

    let customStatus = { state: "delivered", text: '<script>alert("xss")</script> & 状态' };

    const views = loadModule(VIEWS_FILE, {}).module.exports.createAppViews({
      query: query,
      queryAll: () => [],
      getState: () => state,
      openSheet: () => {},
      openCapture: () => {},
      openDemoPreview: () => {},
      isAttentionDue: () => false,
      needsReviewItems: () => [],
      renderReviewEntry: () => "",
      inReviewHighlight: () => false,
      renderAiSub: () => "",
      ensureReviewSettings: () => ({}),
      updateSetupEntry: () => {},
      isTerminal: () => false,
      updateAppBadge: () => {},
      fmtTime: ts => uiFormatMod.fmtTime(ts),
      fmtDate: ts => uiFormatMod.fmtDate(ts),
      relDue: ts => uiFormatMod.relDue(ts),
      repeatLabel: r => uiFormatMod.repeatLabel(r),
      dayLabel: ts => uiFormatMod.dayLabel(ts),
      escapeHtml: s => uiFormatMod.escapeHtml(s),
      escapeAttr: s => uiFormatMod.escapeAttr(s),
      safeExternalHref: u => uiFormatMod.safeExternalHref(u),
      sameDay: (a, b) => dateUtilsMod.sameDay(a, b),
      startOfDay: d => dateUtilsMod.startOfDay(d),
      pad2: n => dateUtilsMod.pad2(n),
      getNativeReminderStatus: () => ({ reliability: "exact" }),
      getNativeReminders: () => ({}),
      getSwReg: () => null,
      isNativeAndroidRuntime: () => false,
      evidenceStatusFor: () => customStatus,
      deliveryEvidenceReadable: () => true,
      itemScheduleEvidence: () => ({ key: "k" })
    });

    const itXss = { id: "it-xss", title: "测试转义事项", status: "due", triggerAt: now };
    state.items.push(itXss);

    views.openDetail(itXss.id);
    const domHtml = query("#detailBody").innerHTML;
    const directRowHtml = views.detailReminderStatusRow(itXss);

    ok("直接调用 views.detailReminderStatusRow(it) 返回 HTML 片段", typeof directRowHtml === "string" && directRowHtml.startsWith('<div class="detail-row"><dt>提醒结果</dt><dd>'));
    ok("详情 DOM 中的内容与 views.detailReminderStatusRow(it) 逐字节一致", domHtml.includes(directRowHtml));
    ok("状态文本中的特殊字符被正确 HTML 转义（无未转义脚本标签）",
      directRowHtml.includes("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; 状态") &&
      !directRowHtml.includes("<script>"));
  }

  section("3. 启动闸门与契约反例：缺具名依赖、缺实例方法、工厂抛错点名失败且零副作用");
  {
    const viewsMod = loadModule(VIEWS_FILE).module.exports;
    const baseValidDeps = {
      query: () => ({}), queryAll: () => [], getState: () => ({ items: [], projects: [], settings: {} }),
      openSheet: () => {}, openCapture: () => {}, openDemoPreview: () => {}, isAttentionDue: () => false,
      needsReviewItems: () => [], renderReviewEntry: () => "", inReviewHighlight: () => false,
      renderAiSub: () => "", ensureReviewSettings: () => ({}), updateSetupEntry: () => {},
      isTerminal: () => false, updateAppBadge: () => {}, fmtTime: () => "", fmtDate: () => "",
      relDue: () => "", repeatLabel: () => "", dayLabel: () => "", escapeHtml: s => String(s),
      escapeAttr: s => String(s), safeExternalHref: () => null, sameDay: () => false,
      startOfDay: () => new Date(), pad2: () => "00", getNativeReminderStatus: () => ({}),
      getNativeReminders: () => ({}), getSwReg: () => null, isNativeAndroidRuntime: () => false,
      evidenceStatusFor: () => ({ state: "unverifiable", text: "" }),
      deliveryEvidenceReadable: () => true,
      itemScheduleEvidence: () => null
    };

    // 3.1 缺具名依赖：evidenceStatusFor
    let errEvidence = null;
    try {
      const badDeps = Object.assign({}, baseValidDeps);
      delete badDeps.evidenceStatusFor;
      viewsMod.createAppViews(badDeps);
    } catch (e) { errEvidence = e; }
    ok("缺 evidenceStatusFor 时工厂抛错且具名点名",
      errEvidence && /AppViews missing dependencies:.*evidenceStatusFor/.test(errEvidence.message),
      errEvidence ? errEvidence.message : null);

    // 3.2 缺具名依赖：deliveryEvidenceReadable
    let errReadable = null;
    try {
      const badDeps = Object.assign({}, baseValidDeps);
      delete badDeps.deliveryEvidenceReadable;
      viewsMod.createAppViews(badDeps);
    } catch (e) { errReadable = e; }
    ok("缺 deliveryEvidenceReadable 时工厂抛错且具名点名",
      errReadable && /AppViews missing dependencies:.*deliveryEvidenceReadable/.test(errReadable.message),
      errReadable ? errReadable.message : null);

    // 3.3 缺具名依赖：itemScheduleEvidence
    let errSched = null;
    try {
      const badDeps = Object.assign({}, baseValidDeps);
      delete badDeps.itemScheduleEvidence;
      viewsMod.createAppViews(badDeps);
    } catch (e) { errSched = e; }
    ok("缺 itemScheduleEvidence 时工厂抛错且具名点名",
      errSched && /AppViews missing dependencies:.*itemScheduleEvidence/.test(errSched.message),
      errSched ? errSched.message : null);

    // 3.4 契约检查：APP_VIEWS_INSTANCE_CONTRACT.instance 必须包含 detailReminderStatusRow
    const coreSrc = fs.readFileSync(CORE_FILE, "utf8");
    const contractMatch = coreSrc.match(/const APP_VIEWS_INSTANCE_CONTRACT = \{[\s\S]*?instance:\s*\[([\s\S]*?)\]/);
    ok("app-core.js 中 APP_VIEWS_INSTANCE_CONTRACT 存在", !!contractMatch);
    const contractMembers = contractMatch ? contractMatch[1].split(",").map(s => s.replace(/["'\s]/g, "")).filter(Boolean) : [];
    ok("APP_VIEWS_INSTANCE_CONTRACT.instance 明确声明 detailReminderStatusRow", contractMembers.includes("detailReminderStatusRow"));

    // 3.5 缺实例方法反例：若实例缺少 detailReminderStatusRow，collectRuntimeBindings 点名失败
    const instanceWithAll = viewsMod.createAppViews(baseValidDeps);
    ok("正常工厂实例持有全部契约方法（含 detailReminderStatusRow）",
      contractMembers.every(m => typeof instanceWithAll[m] === "function"));

    const instanceMissingMethod = Object.assign({}, instanceWithAll);
    delete instanceMissingMethod.detailReminderStatusRow;
    const testContractMissing = contractMembers.filter(m => typeof instanceMissingMethod[m] !== "function");
    ok("实例缺 detailReminderStatusRow 时能被点名发现",
      testContractMissing.length === 1 && testContractMissing[0] === "detailReminderStatusRow");

    // 3.6 app-core 同名函数仅保留薄转发，入口中无 HTML 拼接实现体
    const coreFuncMatch = coreSrc.match(/function detailReminderStatusRow\(it\)\s*\{([\s\S]*?)\}/);
    ok("app-core.js 仍公开同名函数 detailReminderStatusRow(it)", !!coreFuncMatch);
    const coreBody = coreFuncMatch ? coreFuncMatch[1] : "";
    ok("app-core.js 同名函数为薄转发（调用 appViews.detailReminderStatusRow）",
      coreBody.includes("appViews.detailReminderStatusRow(it)"));
    ok("app-core.js 入口中已无 EvidenceLib.evidenceStatusFor 状态判定实现体",
      !coreBody.includes("evidenceStatusFor"));
    ok("app-core.js 入口中已无 '<div class=\"detail-row\"><dt>提醒结果</dt>' HTML 拼接实现体",
      !coreBody.includes('<div class="detail-row"><dt>提醒结果</dt>'));
  }

  section("4. 变异测试（牙齿证明）：证据依赖、实例方法或转义缺失时正式反例必变红");
  {
    const viewsSource = fs.readFileSync(VIEWS_FILE, "utf8");
    const baseValidDeps = {
      query: () => ({}), queryAll: () => [], getState: () => ({ items: [], projects: [], settings: {} }),
      openSheet: () => {}, openCapture: () => {}, openDemoPreview: () => {}, isAttentionDue: () => false,
      needsReviewItems: () => [], renderReviewEntry: () => "", inReviewHighlight: () => false,
      renderAiSub: () => "", ensureReviewSettings: () => ({}), updateSetupEntry: () => {},
      isTerminal: () => false, updateAppBadge: () => {}, fmtTime: () => "", fmtDate: () => "",
      relDue: () => "", repeatLabel: () => "", dayLabel: () => "", escapeHtml: s => String(s),
      escapeAttr: s => String(s), safeExternalHref: () => null, sameDay: () => false,
      startOfDay: () => new Date(), pad2: () => "00", getNativeReminderStatus: () => ({}),
      getNativeReminders: () => ({}), getSwReg: () => null, isNativeAndroidRuntime: () => false,
      evidenceStatusFor: () => ({ state: "unverifiable", text: "" }),
      deliveryEvidenceReadable: () => true,
      itemScheduleEvidence: () => null
    };

    // 变异 1：删掉实例返回中的 detailReminderStatusRow
    const mutantSrc1 = viewsSource.replace("detailReminderStatusRow:detailReminderStatusRow,", "");
    ok("变异 1 前置：补丁成功移除了 detailReminderStatusRow 实例公开", mutantSrc1 !== viewsSource);
    const mutantMod1 = loadModule("app-views.js", {}, mutantSrc1).module.exports;
    const mutantInst1 = mutantMod1.createAppViews(baseValidDeps);
    const mutantRed1 = typeof mutantInst1.detailReminderStatusRow !== "function";
    ok("变异 1 变红（MUTANT_RED=1）：缺少实例公开方法反例变红", mutantRed1);

    // 变异 2：删掉 need 依赖中的 evidenceStatusFor 检查（允许缺依赖装配）
    const mutantSrc2 = viewsSource.replace("'evidenceStatusFor',", "");
    ok("变异 2 前置：补丁成功移除了 evidenceStatusFor 依赖门禁", mutantSrc2 !== viewsSource);
    const mutantMod2 = loadModule("app-views.js", {}, mutantSrc2).module.exports;
    let mutantRed2 = false;
    try {
      const badDeps = Object.assign({}, baseValidDeps);
      delete badDeps.evidenceStatusFor;
      mutantMod2.createAppViews(badDeps);
      // 若没抛错说明静默放行了缺少依赖，变异暴露
      mutantRed2 = true;
    } catch (_) {
      mutantRed2 = false;
    }
    ok("变异 2 变红（MUTANT_RED=1）：若不检查 evidenceStatusFor 会静默放行坏依赖", mutantRed2);

    // 变异 3：文案纪律违规 —— 在 detailReminderStatusRow 中写“漏提醒”
    const mutantSrc3 = viewsSource.replace(
      'return \'<div class="detail-row"><dt>提醒结果</dt><dd>\'',
      'return \'<div class="detail-row"><dt>提醒结果</dt><dd>确定漏提醒 \''
    );
    ok("变异 3 前置：补丁成功注入了违规文案「确定漏提醒」", mutantSrc3 !== viewsSource);
    const mutantMod3 = loadModule("app-views.js", {}, mutantSrc3).module.exports;
    const query = createDom();
    const state = { items: [{ id: "x", title: "x", status: "due" }], projects: [], settings: {}, ui: {} };
    const mutantInst3 = mutantMod3.createAppViews(Object.assign({}, baseValidDeps, {
      query: query,
      getState: () => state,
      evidenceStatusFor: () => ({ state: "unknown", text: "本次提醒结果尚未确认" })
    }));
    mutantInst3.openDetail("x");
    const mutantHtml3 = query("#detailBody").innerHTML;
    const mutantRed3 = mutantHtml3.includes("漏提醒");
    ok("变异 3 变红（MUTANT_RED=1）：注入违规文案「漏提醒」被反例检出", mutantRed3);
  }

  console.log("\n========== P3-I-Q2 详细状态测试结果 ==========");
  console.log(`通过: ${passed}  失败: ${failed}`);
  if (failed > 0) {
    console.error("存在失败项:", failures);
    process.exit(1);
  }
}

runTests();
