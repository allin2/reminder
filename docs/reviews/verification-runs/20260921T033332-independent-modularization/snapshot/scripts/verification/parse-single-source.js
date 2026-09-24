#!/usr/bin/env node
/*
 * **单一来源一致性核对**（取代原 `parse-parity.js`）。
 *
 * 为什么改名与重写：原脚本的前提是「`app-core.js` 里还有一份解析器副本」，它按花括号配平
 * 把那份副本从源码里切出来跑对照。P1 已把副本**整份删除**（含 CN_NUM / cnInt /
 * parseChineseTime / nextRepeatTrigger / 日历原语），所以
 *   · 原脚本现在第一步就抛「找不到函数定义」；
 *   · 而且即便能跑，它证明的也只是「两份副本一致」—— 一个**不再存在**的性质。
 *
 * 现在要证明的三件事（原脚本一件都证不了）：
 *   1. **结构上副本已消失**：app-core 里不再出现这些算法体的定义，只出现「取模块导出」的绑定；
 *   2. **绑定指向唯一来源**：`lib/*.js` 的别名是同一函数对象（不是同名第二份实现）；
 *   3. **生产入口的规则语义**：语料走**唯一的那个入口**，逐条断言可从契约独立推导的性质
 *      （星期几、跨周/跨月推进、记账基准、月末收敛……）。
 *
 * ⚠️ 期望值纪律：**不允许**把「当前输出」抄成期望。凡是写死的时间戳，都必须能从句子的
 * 语义独立推出来（见每条断言后的「判据」注释）。推不出来的性质（例如「每月第一个周一」
 * 在某天的具体落点）**不写死** —— 那会变成快照，而不是契约。
 *
 * 用法：node scripts/verification/parse-single-source.js
 * 退出码：0 = 全过；1 = 存在未通过项。
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const parse = require(path.join(ROOT, "lib/parse-cn.js"));
const repeat = require(path.join(ROOT, "lib/repeat.js"));
const prim = require(path.join(ROOT, "lib/date-utils.js"));
const prod = require(path.join(ROOT, "scripts/verification/production-scripts.js"));

let passed = 0;
const failures = [];

function ok(name, condition, extra) {
  if (condition) {
    passed++;
    console.log("  \u2713 " + name);
  } else {
    failures.push(name + (extra ? " \u2014 " + extra : ""));
    console.log("  \u2717 " + name + (extra ? " \u2014 " + extra : ""));
  }
}

function section(name) {
  console.log("\n== " + name + " ==");
}

/** 基准时刻：2026-09-18 周五 14:00（固定时钟，不依赖运行时的「今天」）。 */
const NOW = new Date(2026, 8, 18, 14, 0, 0);
const dowName = ["日", "一", "二", "三", "四", "五", "六"];

function p(text) {
  return parse.parseChineseTime(text, NOW);
}

/** 某月最后一天（判据用，不依赖被测实现）。 */
function lastDayOf(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/* ================================================================== */
section("A. 结构：app-core 里不再持有任何算法副本（只允许「取模块导出」的绑定）");

const coreSrc = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");
const coreCode = prod.stripComments(coreSrc);

/**
 * 这些定义**曾经**在 app-core 里各有一份。它们今天只准出现在 lib/ 下。
 * 判据：在 app-core 的**非注释源码**里搜索「函数定义」形状；出现即回归。
 */
const FORBIDDEN_DEFINITIONS = [
  ["function parseChineseTime", "中文时间解析器（唯一来源 lib/parse-cn.js）"],
  ["function cnInt", "中文数字转换（唯一来源 lib/parse-cn.js）"],
  ["const CN_NUM", "中文数字表（唯一来源 lib/parse-cn.js）"],
  ["function hasSpecificTimeWord", "明确时间词判定（唯一来源 lib/parse-cn.js）"],
  ["function nextRepeatTrigger", "周期推进（唯一来源 lib/repeat.js）"],
  ["function repeatLabel", "周期文案（唯一来源 lib/repeat.js）"],
  ["function nextRepeatPreview", "周期预演（唯一来源 lib/repeat.js）"],
  ["function startOfDay", "日历原语（唯一来源 lib/date-utils.js）"],
  ["function endOfDay", "日历原语（唯一来源 lib/date-utils.js）"],
  ["function addDays", "日历原语（唯一来源 lib/date-utils.js）"],
  ["function applyClock", "日历原语（唯一来源 lib/date-utils.js）"],
  ["function lastDayOfMonth", "日历原语（唯一来源 lib/date-utils.js）"],
  ["function nthWeekdayInMonth", "日历原语（唯一来源 lib/date-utils.js）"],
  ["function nthWeekdayOfNextMonth", "日历原语（唯一来源 lib/date-utils.js）"],
  ["function weekdayOfNextWeek", "日历原语（唯一来源 lib/date-utils.js）"],
  ["function dayOfMonthIn", "日历原语（唯一来源 lib/date-utils.js）"],
  ["function nextDayOfMonth", "日历原语（唯一来源 lib/date-utils.js）"],
  ["function nextWeekend", "日历原语（唯一来源 lib/date-utils.js）"]
];

FORBIDDEN_DEFINITIONS.forEach(function (entry) {
  ok("app-core 不再定义 " + entry[0] + "（" + entry[1] + "）",
    coreCode.indexOf(entry[0]) < 0);
});

/**
 * `inQuietHours` / `quietEnd` **不**进上面那张表，因为它们仍以 `function` 形式存在 ——
 * 但那是计划明确允许的**转发适配**（「只准转换参数或读取设置」），不是算法副本：
 *     function inQuietHours(d) { return Lib.inQuietHours(d, state.settings); }
 * 所以要按**形态**判定：必须是单行转发，且旧副本的算法标记必须消失。
 * 一刀切地禁掉 `function inQuietHours` 会得到假阳性 —— 那会把合规写法也判红。
 */
ok("inQuietHours 是单行转发（读 state.settings 后交给 lib/reminder.js），不再内联算法",
  /function inQuietHours\(d\)\s*\{\s*return Lib\.inQuietHours\(d,\s*state\.settings\);\s*\}/.test(coreCode));
ok("quietEnd 是单行转发（同上）",
  /function quietEnd\(d\)\s*\{\s*return Lib\.quietEnd\(d,\s*state\.settings\);\s*\}/.test(coreCode));
ok("免打扰算法标记 parseHHMM 已从 app-core 消失（它是内联副本的伴生函数）",
  coreCode.indexOf("parseHHMM") < 0);
ok("免打扰的兜底常量已消失（旧副本的 `23, 0` / `7, 30` 默认值）",
  coreCode.indexOf("23, 0") < 0 && coreCode.indexOf("7, 30") < 0);

// 反向对照：把一段同名定义塞回去，上面的判据必须能报出来 —— 否则上面 20 条是恒真断言。
{
  const injected = prod.stripComments(coreSrc.replace(
    "  function uid() {",
    "  function uid() {\n  }\n  function startOfDay(d) { return d; }\n  function cnInt(s) { return 0; }"
  ));
  ok("反向对照：塞回 function startOfDay / function cnInt 后，判据确实变红",
    injected.indexOf("function startOfDay") >= 0 && injected.indexOf("function cnInt") >= 0);
  // 同时确认剥注释真的生效：注释里的同名定义不该被判红。
  const commented = prod.stripComments(
    coreSrc.replace("  function uid() {", "  function uid() {\n    // function cnInt(s) { 这是文档里的旧写法\n"));
  ok("反向对照：注释里的 function cnInt 不被误判（剥注释生效）",
    commented.indexOf("function cnInt") < 0);
}

/* ================================================================== */
section("A2. 结构：UI 纯格式化已搬出 app-core（只留 UiFormat 委托，不留算法体）");

/**
 * P2 首批搬移的对象：这 8 个函数原本定义在 app-core 里，现在住在 `lib/ui-format.js`。
 *
 * 判据分两层，缺一不可：
 *   · **委托形态** —— app-core 里必须只剩「单行转发给 `UiFormat.x`」；
 *     一刀切地禁掉 `function fmtTime` 会得到假阳性，因为那正是**允许**的适配写法
 *     （与 `inQuietHours` 同理）。
 *   · **算法体标记必须消失** —— 下面的标记行都是**从 git HEAD 原样摘下来的**，
 *     不是「我猜大概长这样」。只要有人把算法抄回 app-core，这些子串就会重新出现。
 */
const UI_DELEGATES = [
  ["uid", "uid()"],
  ["pad", "pad(n)"],
  ["fmtTime", "fmtTime(ts)"],
  ["fmtDate", "fmtDate(ts)"],
  ["relDue", "relDue(ts)"],
  ["escapeHtml", "escapeHtml(s)"],
  ["escapeAttr", "escapeAttr(v)"],
  ["renderMarkdown", "renderMarkdown(src)"],
  // P2-b 追加：这三个与 fmtDate 同类（纯格式化），一起归入 ui-format。
  ["dayLabel", "dayLabel(ts)"],
  ["toLocalInput", "toLocalInput(ts)"],
  ["parseLocalInput", "parseLocalInput(v)"]
];
/**
 * 取出 `  function sig {` 那个函数的完整定义。
 *
 * ⚠️ 不能用「从起点找下一个 `\n  }`」—— 单行函数（`function pad(n) { … }`）没有独立收尾行，
 * 那样会把**后面一大段无关代码**吞进「函数体」，于是委托判定被相邻代码误伤
 * （`pad` 的体里混进了紧随其后的别名声明，`escapeHtml` 的体里混进了别的东西）。
 * 正确做法：按行累计大括号深度，深度首次回到 0 的那一行就是收尾。
 */
function sliceTopLevelFunction(code, literal) {
  const at = code.indexOf(literal);
  if (at < 0) return null;
  const lines = code.slice(at).split("\n");
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    for (let k = 0; k < lines[i].length; k++) {
      if (lines[i][k] === "{") depth++;
      else if (lines[i][k] === "}") depth--;
    }
    if (depth <= 0) return lines.slice(0, i + 1).join("\n");
  }
  return lines.join("\n");
}

UI_DELEGATES.forEach(function (d) {
  const name = d[0], sig = d[1];
  const body = sliceTopLevelFunction(coreCode, "function " + sig + " {");
  // 委托体里**不准**出现任何「算」的痕迹：日期取值、日历推进、字符串替换、内置数学。
  // 这条比「算法体标记」更强，也更能挡住「把旧实现抄回来」——
  // 那些标记只对**搬移前的原样行**有效，微调过一版的抄写会漏过去。
  // 注意：**不要**把函数自己或 `UiFormat` 的名字写进禁词表，否则委托本身就被误伤。
  const NO_ALGORITHM = /\b(?:sameDay|addDays|getMonth|getDate|getHours|getMinutes|getFullYear|Date\.now|Math|forEach|replace|padStart)\b/;
  ok("app-core 的 " + name + " 只剩单行委托（不内联算法）",
    !!body && new RegExp("return UiFormat\\." + name + "\\(").test(body) && !NO_ALGORITHM.test(body),
    body ? body.replace(/\s+/g, " ").slice(0, 110) : "未找到定义");
});

const UI_ALGORITHM_MARKERS = [
  ["return \"i_\" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);",
    "事项 id 生成算法体"],
  ["function pad(n) { return String(n).padStart(2, \"0\"); }",
    "补零算法体"],
  ["const t = pad(d.getHours()) + \":\" + pad(d.getMinutes());",
    "时间拼接算法体"],
  ["\"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", '\"': \"&quot;\", \"'\": \"&#39;\"",
    "转义字符表（文本侧与属性侧共用一份）"],
  ["const diff = ts - Date.now();",
    "相对到期算法体"],
  ["text = text.replace(/^### (.+)$/gm, \"<h3>$1</h3>\");",
    "Markdown 渲染算法体"],
  ["if (d.getFullYear() !== now.getFullYear()) {",
    "归档日标签的跨年分支（`dayLabel` 与 `fmtDate` 的差异点之一）"],
  // ⚠️ 标记必须**只**属于被搬移的那一支。
  // 最初这里写的是 `return d.getFullYear() + "-" + pad(d.getMonth() + 1) + …`，
  // 结果误报 —— 那个前缀同时出现在 `aiNowIso()`（AI 请求用的带时区偏移的 ISO 串）里：
  // 两支都要拼 `YYYY-MM-DD`，但一支是本地时间输入框、一支是 ISO-8601，**不是同一个函数**。
  // 换成只属于 `toLocalInput` 的收尾行（`aiNowIso` 那行后面还接 `+ sign +`，收尾不同）。
  ["\"T\" + pad(d.getHours()) + \":\" + pad(d.getMinutes());",
    "本地时间串拼接（`toLocalInput` 算法体；`aiNowIso` 是另一支，不共用此行）"]
];
UI_ALGORITHM_MARKERS.forEach(function (m) {
  ok("app-core 不再含「" + m[1] + "」", coreCode.indexOf(m[0]) < 0);
});
{
  // 反向对照：把一行标记塞回去，判据必须能报出来。
  const injected = prod.stripComments(coreSrc.replace(
    "  function uid() {",
    "  function uid() {\n    return \"i_\" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);"
  ));
  ok("反向对照：把 id 生成算法体塞回 app-core 后，" +
    "标记「事项 id 生成算法体」确实被检出",
    injected.indexOf("return \"i_\" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);") >= 0);
}

/**
 * **刻意的范围边界**：`dayLabel` 与 `fmtDate` 长得很像（都有「今天/昨天」），
 * 搬移时一起挪到了 `lib/ui-format.js`，但两者**没有被合并成一支** ——
 * 默认值（`"更早"` vs `""`）、有无「明天」分支、跨年是否回完整年月日，三处都不同。
 * 「长得像就顺手统一」正是这类拆分出事的典型方式，所以这里显式断言它们仍是两支，
 * 且差异点仍然成立。
 */
{
  const ui = require(path.join(ROOT, "lib/ui-format.js"));
  ok("ui-format 仍导出 dayLabel 与 fmtDate **两支**（未被合并）",
    typeof ui.dayLabel === "function" && typeof ui.fmtDate === "function" &&
    ui.dayLabel !== ui.fmtDate);
  ok("空值语义不同：dayLabel(null)=\"更早\"，fmtDate(null)=\"\"",
    ui.dayLabel(null) === "更早" && ui.fmtDate(null) === "",
    "dayLabel=" + JSON.stringify(ui.dayLabel(null)) + " fmtDate=" + JSON.stringify(ui.fmtDate(null)));
  // 判据（从语义独立推导，不是抄当前输出）：
  //   · 「明天」= 基准日 +1 天 ⇒ fmtDate 认「明天」；dayLabel **没有**这个分支 ⇒ 回「9月19日」。
  //   · 跨年 ⇒ dayLabel 回完整年月日；fmtDate 无论哪一年都只回月日。
  const tomorrow = new Date(2026, 8, 19, 9, 0, 0).getTime();
  ok("「明天」分支不同：fmtDate 认「明天」，dayLabel 回「9月19日」",
    ui.fmtDate(tomorrow, NOW.getTime()) === "明天" &&
    ui.dayLabel(tomorrow, NOW.getTime()) === "9月19日",
    "fmtDate=" + ui.fmtDate(tomorrow, NOW.getTime()) + " dayLabel=" + ui.dayLabel(tomorrow, NOW.getTime()));
  const lastYear = new Date(2025, 11, 31, 9, 0, 0).getTime();
  ok("跨年分支不同：dayLabel 回「2025年12月31日」，fmtDate 回「12月31日」",
    ui.dayLabel(lastYear, NOW.getTime()) === "2025年12月31日" &&
    ui.fmtDate(lastYear, NOW.getTime()) === "12月31日",
    "dayLabel=" + ui.dayLabel(lastYear, NOW.getTime()) + " fmtDate=" + ui.fmtDate(lastYear, NOW.getTime()));
}

/* ================================================================== */
section("A3. 结构：DOM 共用展示能力已搬出 app-core（唯一来源 lib/app-ui.js）");

/**
 * P2-b 搬移的对象：`$` / `$$` / 弹层 / `toast` / `confirmDialog` / `safeExternalHref`。
 *
 * 与 A2 同一套判据，但**多一条**：这几支是「有状态的展示会话」，所以不但算法体要走，
 * 装配本身也要能从 app-core 看出来（否则读代码的人会以为它们还在这里定义）。
 */
const DOM_FORBIDDEN = [
  ["function openSheet", "弹层开关（唯一来源 lib/app-ui.js）"],
  ["function closeSheet", "弹层关闭（唯一来源 lib/app-ui.js）"],
  ["function closeAllSheets", "全部弹层关闭（唯一来源 lib/app-ui.js）"],
  ["function confirmDialog", "确认框（唯一来源 lib/app-ui.js）"],
  ["function toast", "浮动提示（唯一来源 lib/app-ui.js）"],
  ["function hideToast", "提示收起（唯一来源 lib/app-ui.js）"],
  ["function safeExternalHref", "外链协议白名单（唯一来源 lib/app-ui.js）"],
  ["let toastTimer", "提示定时器（必须随实现一起走，否则会出现两个定时器口径）"]
];
DOM_FORBIDDEN.forEach(function (e) {
  ok("app-core 不再定义 " + e[0] + "（" + e[1] + "）", coreCode.indexOf(e[0]) < 0);
});

/** 算法体标记：全部从 HEAD 原样摘下（不是「我猜大概长这样」）。 */
const DOM_ALGORITHM_MARKERS = [
  ["(r || document).querySelector(s)", "DOM 查询实现体"],
  ["(r || document).querySelectorAll(s)", "DOM 批量查询实现体"],
  ["$(\"#backdrop\").classList.add(\"show\");", "弹层开启算法体"],
  ["if (!$$(\".sheet.open\").length)", "backdrop 的多层关闭判据"],
  ["$$(\".sheet\").forEach(s => s.classList.remove(\"open\"));", "closeAllSheets 算法体"],
  ["titleEl.textContent = title || \"确认\";", "确认框文案回填算法体"],
  ["try { resolve(window.confirm(message)); } catch (e) { resolve(true); }", "确认框兜底路径"],
  ["const duration = (opts && opts.durationMs) || (hasAction ? 5000 : 2400);", "提示时长口径"],
  ["toastTimer = setTimeout(hideToast, duration);", "提示定时器实现体"],
  ["if (/[\\u0000-\\u001f\\u007f]/.test(trimmed)) return null;", "外链控制字符判定"],
  ["return protocol === \"http:\" || protocol === \"https:\" ? trimmed : null;", "外链协议白名单判定"]
];
DOM_ALGORITHM_MARKERS.forEach(function (m) {
  ok("app-core 不再含「" + m[1] + "」", coreCode.indexOf(m[0]) < 0);
});

/** 绑定：app-core 必须**显式**从 AppUi 取，且这些名字都在用（不是取了个空壳）。 */
const DOM_BINDINGS = [
  "const $ = appUi.$;",
  "const $$ = appUi.$$;",
  "const openSheet = appUi.openSheet;",
  "const closeSheet = appUi.closeSheet;",
  "const closeAllSheets = appUi.closeAllSheets;",
  "const confirmDialog = appUi.confirmDialog;",
  "const toast = appUi.toast;",
  "const hideToast = appUi.hideToast;",
  "const safeExternalHref = AppUi.safeExternalHref;"
];
DOM_BINDINGS.forEach(function (b) {
  ok("app-core 存在绑定「" + b + "」", coreCode.indexOf(b) >= 0);
});

/**
 * **活绑定**：抑制反馈必须按**取值函数**注入。
 *
 * 若按值传（`createUi({ isFeedbackSuppressed: suppressUserFeedback })`），装配发生的那一
 * 刻它恒为 `false`，于是「重放用户操作时不重复弹提示」（M1）会整段失效 —— 而且**不报错**。
 * 这条断言把那个写法钉死。
 */
ok("抑制反馈按取值函数注入（按值传会让 M1 静默失效）",
  /createUi\(\{\s*isFeedbackSuppressed:\s*\(\)\s*=>\s*suppressUserFeedback\s*\}\)/.test(coreCode));
ok("没有把抑制反馈按值传进去",
  !/isFeedbackSuppressed:\s*suppressUserFeedback\b/.test(coreCode));

/**
 * 搬移后的名字必须仍被真实引用（避免「绑了但没人用」的假搬移）。
 *
 * ⚠️ 这里按**引用形状**而不是「调用形状」判定，是核对源码后的结论，不是宽松处理：
 * `closeAllSheets` 在 app-core 里**从来没有以 `closeAllSheets(` 的形式被调用过** ——
 * 它只有两条路径：作为 `#backdrop` 的 click 监听器传入，以及测试钩子里导出。
 * 一刀切要求「必须出现 `closeAllSheets(`」会得到假阳性。
 * 但「绑了却完全没人引用」仍是真问题，所以下面这张表逐条写清它被**怎么**用。
 */
const UI_USAGE_SHAPES = [
  ["$(\"#", "$ 查询（弹层/toast 的取节点）"],
  ["$$(\"", "$$ 批量查询（.sheet 集合）"],
  ["openSheet(", "开弹层"],
  ["closeSheet(", "关弹层"],
  ["addEventListener(\"click\", closeAllSheets)", "closeAllSheets 作为 backdrop 的监听器（唯一真实入口）"],
  ["confirmDialog(", "确认框"],
  ["toast(", "浮动提示"],
  ["safeExternalHref(", "外链白名单"],
  ["dayLabel(", "归档日标签"],
  ["toLocalInput(", "时间输入框回填"],
  ["parseLocalInput(", "时间输入框取值"]
];
{
  const missing = UI_USAGE_SHAPES.filter(function (u) { return coreCode.indexOf(u[0]) < 0; });
  ok("搬移后的名字在 app-core 里仍被真实引用（" + UI_USAGE_SHAPES.length + " 种引用形状）",
    missing.length === 0, JSON.stringify(missing.map(function (m) { return m[0]; })));
}

{
  // 反向对照：把弹层算法体塞回去，上面那张标记表必须能报出来。
  const injected = prod.stripComments(coreSrc.replace(
    "  function uid() {",
    "  function uid() {\n    $(\"#backdrop\").classList.add(\"show\");"
  ));
  ok("反向对照：把 $(\"#backdrop\").classList.add(\"show\") 塞回 app-core 后，判据变红",
    injected.indexOf("$(\"#backdrop\").classList.add(\"show\");") >= 0);
}

/* ================================================================== */
section("B. 绑定：app-core 取的是模块导出，且 lib 的别名就是同一函数对象");

const BINDINGS = [
  ["const parseChineseTime = Lib.parseChineseTime;", "解析器"],
  ["const cnInt = Lib.cnInt;", "中文数字"],
  ["const hasSpecificTimeWord = Lib.hasSpecificTimeWord;", "明确时间词"],
  ["const nextRepeatTrigger = Lib.nextRepeatTrigger;", "周期推进"],
  ["const repeatLabel = Lib.repeatLabel;", "周期文案"],
  ["const nextRepeatPreview = Lib.nextRepeatPreview;", "周期预演"],
  ["const startOfDay = DatePrimitives.startOfDay;", "startOfDay"],
  ["const endOfDay = DatePrimitives.endOfDay;", "endOfDay"],
  ["const addDays = DatePrimitives.addDays;", "addDays"],
  ["const applyClock = DatePrimitives.applyClock;", "applyClock"],
  ["const nextWeekend = DatePrimitives.nextWeekend;", "nextWeekend"]
];
BINDINGS.forEach(function (b) {
  ok("app-core 存在绑定「" + b[0] + "」（" + b[1] + "）", coreCode.indexOf(b[0]) >= 0);
});

// 别名同一性：两个 lib 模块导出的日历原语必须是**同一个函数对象**。
// 「行为相同」不算 —— 那也可能是两份被同步维护的副本。
ok("lib/parse-cn.js 的 startOfDay 就是 lib/date-utils.js 那一个（同一函数对象）",
  parse.startOfDay === prim.startOfDay);
ok("lib/parse-cn.js 的 addDays 就是 lib/date-utils.js 那一个",
  parse.addDays === prim.addDays);
ok("lib/repeat.js 的 lastDayOfMonth 就是 lib/date-utils.js 那一个",
  repeat.lastDayOfMonth === prim.lastDayOfMonth);
ok("lib/repeat.js 的 applyClock 就是 lib/date-utils.js 那一个",
  repeat.applyClock === prim.applyClock);
ok("lib/repeat.js 的 nthWeekdayInMonth 就是 lib/date-utils.js 那一个",
  repeat.nthWeekdayInMonth === prim.nthWeekdayInMonth);

/* 同名两种语义必须显式分开：合并会让周期原地打转（见 lib/date-utils.js 文末）。 */
ok("parse 的 nthWeekdayOfNextMonth 指向 ByInstant（首期候选：按具体时刻比较）",
  parse.nthWeekdayOfNextMonth === prim.nthWeekdayOfNextMonthByInstant);
ok("repeat 的 nthWeekdayOfNextMonth 指向 ByDay（周期推进：按「日」比较）",
  repeat.nthWeekdayOfNextMonth === prim.nthWeekdayOfNextMonthByDay);
ok("两个语义确实是**两个不同的函数**（不是同一个实现换了名字）",
  prim.nthWeekdayOfNextMonthByInstant !== prim.nthWeekdayOfNextMonthByDay);
{
  // 判据：只有「锚点正好落在目标星期几、且早于 10:00」时两者才分叉 ——
  // 这正是文档写明的差异条件。构造该锚点，两者必须给出不同结果；
  // 换个普通锚点，两者必须一致。若合并成一个实现，第一句就变红。
  const onTargetEarly = new Date(2026, 0, 5, 9, 0, 0);   // 2026-01-05 周一 09:00
  const other = new Date(2026, 0, 6, 9, 0, 0);           // 2026-01-06 周二 09:00
  const a1 = prim.nthWeekdayOfNextMonthByInstant(onTargetEarly, 1, 1, 9, 0);
  const b1 = prim.nthWeekdayOfNextMonthByDay(onTargetEarly, 1, 1, 9, 0);
  const a2 = prim.nthWeekdayOfNextMonthByInstant(other, 1, 1, 9, 0);
  const b2 = prim.nthWeekdayOfNextMonthByDay(other, 1, 1, 9, 0);
  ok("锚点落在目标星期几且早于 10:00 时，两种语义分叉（ByInstant 留在本月、ByDay 推下月）",
    a1 !== b1, "ByInstant=" + new Date(a1).toString().slice(0, 15) +
    " ByDay=" + new Date(b1).toString().slice(0, 15));
  ok("普通锚点（周二）上两种语义一致（说明分叉只发生在那个边界）",
    a2 === b2, "ByInstant=" + new Date(a2).toString().slice(0, 15) +
    " ByDay=" + new Date(b2).toString().slice(0, 15));
}

/* ================================================================== */
section("C. 规则语义：语料走唯一入口，逐条断言可独立推导的性质");

{
  const t = p("明天上午9点前提交");
  const d = new Date(t.trigger);
  const want = new Date(2026, 8, 19, 9, 0, 0);
  // 判据：「明天」= 基准日 +1 天，「上午9点」= 09:00，无「X 小时后」故为墙钟基准。
  ok("「明天上午9点」= 2026-09-19 09:00（明天 + 句内钟点）",
    d.getTime() === want.getTime(), d.toString().slice(0, 24));
  ok("「明天上午9点」的记账基准是 wall-clock（不是 elapsed）",
    t.scheduleBasis === "wall-clock", String(t.scheduleBasis));
}
{
  const d = new Date(p("今天晚上8点看直播").trigger);
  const want = new Date(2026, 8, 18, 20, 0, 0);
  // 判据：「今天晚上8点」= 基准日当天 20:00。
  ok("「今天晚上8点」= 2026-09-18 20:00（当天 + 句内钟点）",
    d.getTime() === want.getTime(), d.toString().slice(0, 24));
}
{
  const t = p("下周三交房租");
  const d = new Date(t.trigger);
  // 判据（H-01）：「下周三」= 下一个**日历周**（周一为首日）里的星期三。
  // 基准 2026-09-18 是周五 → 下个日历周为 09-21(一) ~ 09-27(日) → 星期三 = 09-23。
  // 这条独立于实现：先验星期几，再验它落在那个区间内。
  ok("「下周三」落在星期三", d.getDay() === 3, "getDay=" + d.getDay());
  ok("「下周三」= 2026-09-23（下个日历周的周三）",
    d.getTime() === new Date(2026, 8, 23, 10, 0, 0).getTime(), d.toString().slice(0, 24));
  ok("「下周三」确实在基准日之后（不是已过去的那一周）",
    d.getTime() > NOW.getTime());
}
{
  const d = new Date(p("下周日交房租").trigger);
  // 判据同上，目标为周日 → 下个日历周的周日 = 09-27。
  ok("「下周日」落在星期日", d.getDay() === 0, "getDay=" + d.getDay());
  ok("「下周日」= 2026-09-27（下个日历周的周日，与「下周三」同一周）",
    d.getTime() === new Date(2026, 8, 27, 10, 0, 0).getTime(), d.toString().slice(0, 24));
}
{
  const t = p("每周一早上9点站会");
  const d = new Date(t.trigger);
  ok("「每周一早上9点」触发点落在星期一", d.getDay() === 1, "getDay=" + d.getDay());
  ok("「每周一早上9点」钟点为 09:00",
    d.getHours() === 9 && d.getMinutes() === 0, d.toString().slice(16, 21));
  ok("「每周一早上9点」被识别为每周重复（every=week）",
    !!t.repeat && t.repeat.every === "week", JSON.stringify(t.repeat));
  /* ⚠️ 此处**不**断言 `repeat.dow === 1`：按当前契约，`every:"week"` 的星期几由**锚点**
   * （`item.triggerAt`）承载 —— `nextRepeatTrigger` 走
   *     applyClock(addDays(anchor, 7), it.triggerAt)
   * 只加 7 天并沿用原钟点，不再单独记 dow。所以「是周一」这句话必须由**推进结果**来证，
   * 不能由 repeat 对象里的字段来证。下面就是那条真正面向用户的断言：
   * 「每周一」解析出来后，后续每一轮都落在周一 09:00。 */
  let cur = t.trigger;
  const item = { repeat: t.repeat, triggerAt: cur };
  const chain = [];
  for (let i = 0; i < 4; i++) {
    const n = repeat.nextRepeatTrigger(item, cur);
    chain.push(n);
    item.triggerAt = n;
    cur = n;
  }
  ok("「每周一早上9点」后续 4 轮都落在星期一 09:00（星期几由锚点承载，不由 dow 字段承载）",
    chain.every(function (s) {
      const x = new Date(s);
      return x.getDay() === 1 && x.getHours() === 9 && x.getMinutes() === 0;
    }), chain.map(function (s) { return new Date(s).toString().slice(0, 15) + "(" + dowName[new Date(s).getDay()] + ")"; }).join(" | "));
  ok("「每周一早上9点」后续 4 轮严格 +7 天推进",
    chain.every(function (s, i) { return s === t.trigger + (i + 1) * 7 * 86400000; }));
}
{
  const d = new Date(p("每月31号交房租").trigger);
  // 判据：31 号在 9 月不存在，契约要求**收敛到月末**而不是溢出成 10-01。
  ok("「每月31号」在 9 月收敛到月末（30 日，不溢出成 10-01）",
    d.getMonth() === 8 && d.getDate() === lastDayOf(2026, 8),
    d.toString().slice(0, 24));
}
{
  const d = new Date(p("每月最后一天交房租").trigger);
  // 判据：结果必须落在它所处**月份的最后一天**（与具体是哪个月无关）。
  ok("「每月最后一天」落在当月最后一天",
    d.getDate() === lastDayOf(d.getFullYear(), d.getMonth()),
    d.toString().slice(0, 24) + "（该月最后一天应为 " + lastDayOf(d.getFullYear(), d.getMonth()) + "）");
}
{
  const d = new Date(p("下个月5号交电费").trigger);
  // 判据：「下个月」= 基准月 +1 → 10 月；「5号」→ 5 日。
  ok("「下个月5号」= 2026-10-05",
    d.getFullYear() === 2026 && d.getMonth() === 9 && d.getDate() === 5,
    d.toString().slice(0, 24));
}
{
  const t = p("3天后还信用卡");
  const d = new Date(t.trigger);
  // 判据：「3天后」是**时长**表达 → elapsed 基准（保留当前时刻 14:00），
  // 而不是日历日 +3 的 10:00。基准 09-18 14:00 + 3 天 = 09-21 14:00。
  ok("「3天后」按 elapsed 基准（保留当前时刻，而不是跳到 10:00）",
    t.scheduleBasis === "elapsed", String(t.scheduleBasis));
  ok("「3天后」= 2026-09-21 14:00（基准时刻 +3 天）",
    d.getTime() === new Date(2026, 8, 21, 14, 0, 0).getTime(), d.toString().slice(0, 24));
}
{
  const t = p("记得买牛奶");
  // 判据：无时间词 → 低置信度，且不得凭空造出一个「用户没说过」的具体时刻。
  ok("无时间词的「记得买牛奶」= low 置信度", t.confidence === "low", String(t.confidence));
  ok("无时间词时不产生重复规则", !t.repeat, JSON.stringify(t.repeat));
}

/* ================================================================== */
section("D. 周期推进：每一步都落在正确的那一天（按日历，不按毫秒）");

{
  const rep = { mode: "calendar", every: "week", dow: 1, hour: 9, minute: 0 };
  let cur = new Date(2026, 8, 21, 9, 0, 0).getTime();  // 2026-09-21 周一 09:00
  const item = { repeat: rep, triggerAt: cur };
  const steps = [];
  for (let i = 0; i < 4; i++) {
    const n = repeat.nextRepeatTrigger(item, cur);
    steps.push(n);
    item.triggerAt = n;
    cur = n;
  }
  // 判据：每周重复 = 每次 +7 天，且**始终**是周一 09:00。
  ok("每周重复：四次推进每次恰好 +7 天",
    steps.every(function (s, i) {
      return s === new Date(2026, 8, 28 + i * 7, 9, 0, 0).getTime();
    }), steps.map(function (s) { return new Date(s).toString().slice(0, 15); }).join(" | "));
  ok("每周重复：每一步都落在星期一 09:00（不会被锚点的钟点带偏）",
    steps.every(function (s) {
      const d = new Date(s);
      return d.getDay() === 1 && d.getHours() === 9 && d.getMinutes() === 0;
    }));
}
{
  const rep = { mode: "calendar", every: "monthEnd" };
  let cur = new Date(2026, 8, 30, 10, 0, 0).getTime();
  const item = { repeat: rep, triggerAt: cur };
  const steps = [];
  for (let i = 0; i < 3; i++) {
    const n = repeat.nextRepeatTrigger(item, cur);
    steps.push(n);
    item.triggerAt = n;
    cur = n;
  }
  // 判据：月末重复 → 每一步都是**它自己那个月**的最后一天，且严格向后推进。
  ok("月末重复：每一步都落在当月最后一天（10/31、11/30、12/31）",
    steps.every(function (s) {
      const d = new Date(s);
      return d.getDate() === lastDayOf(d.getFullYear(), d.getMonth());
    }), steps.map(function (s) { return new Date(s).toString().slice(0, 15); }).join(" | "));
  ok("月末重复：严格向后推进且每一步都晚于上一步",
    steps.every(function (s, i) { return i === 0 ? s > new Date(2026, 8, 30, 10, 0, 0).getTime() : s > steps[i - 1]; }));
}
{
  // 判据（V04）：锚点正好落在该周几且早于 10:00 时，周期推进**不能原地打转**。
  const rep = { mode: "calendar", every: "nthWeekday", nth: 1, dow: 1 };
  const anchor = new Date(2026, 0, 5, 9, 0, 0).getTime();  // 2026-01-05 周一 09:00
  const next = repeat.nextRepeatTrigger({ repeat: rep, triggerAt: anchor }, anchor);
  ok("周期推进在「锚点=目标周几且早于 10:00」时不原地打转（必须晚于锚点）",
    next !== anchor && next > anchor, new Date(next).toString().slice(0, 24));
}

/* ================================================================== */
section("E. 中文数字：唯一入口的结果语义（含旧守护保留的用例）");

const CN_CASES = [
  ["四十", 40], ["九十", 90], ["一百", 100], ["三十五", 35], ["二十三", 23],
  // lib 比被删掉的 app-core 副本多出来的能力（逐位读法与段位单位）—— 旧守护据此发现过分叉，
  // 这两条必须继续守：退回「只认三十/二十/十前缀」就会变红。
  ["二零二三", 2023], ["三百零五", 305]
];
CN_CASES.forEach(function (c) {
  const got = parse.cnInt(c[0]);
  ok("cnInt(" + c[0] + ") = " + c[1], got === c[1], "实际 " + got);
});

/* ================================================================== */
section("F. 覆盖矩阵：app-core 的每个 Lib 引用都在启动闸门的声明表里");

{
  const cov = prod.runtimeDependencyCoverage(ROOT);
  ok("矩阵闭合：无未声明的 Lib / DatePrimitives 引用",
    cov.undeclared.length === 0, JSON.stringify(cov.undeclared));
  ok("声明表规模合理（≥25 项，且含解析器与日历原语）",
    cov.declared.length >= 25 &&
    cov.declared.indexOf("parseChineseTime") >= 0 &&
    cov.declared.indexOf("DatePrimitives.startOfDay") >= 0,
    "n=" + cov.declared.length);
  const injected = prod.runtimeDependencyCoverage(ROOT, {
    source: coreSrc.replace("  function uid() {",
      "  function uid() {\n    if (Lib.brandNewThing) return Lib.brandNewThing();")
  });
  ok("反向对照：未声明的 Lib.brandNewThing 会被报出来（闭合判定有牙齿）",
    injected.undeclared.length === 1 && injected.undeclared[0].path === "brandNewThing",
    JSON.stringify(injected.undeclared));
}

/* ================================================================== */
section("G. 语料冒烟：整份语料走唯一入口，输出形状必须合法");

/* 保留原守护里有价值的语料 —— 但不再拿去和「第二份副本」比对（那份副本已不存在），
 * 只断言**输出形状合法**：不抛错、trigger 是 number|null、confidence 在枚举内、
 * title 是字符串。这是「唯一来源在全语料上都不崩」的最低保证。 */
const CORPUS = [
  "提醒我下周三交房租", "下周三下午3点开会", "下周日交房租", "下下周一开会", "下星期三开会",
  "本周五前提交报告", "截止到本周五", "周五开会", "周一会", "每周一早上9点站会", "每周复盘",
  "每月15号提醒我", "每个月5号交电费", "每月底提醒我交房租", "每月最后一天交房租",
  "每月第一个周一开会", "每月第2个周二开例会", "每月31号交房租",
  "下个月5号交电费", "下个月交电费", "下个月底结算", "月底结算", "下月1号交房租",
  "明天上午9点前提交", "明天上午10点半面试", "12月31日之前提交年报", "3月15日报名截止",
  "9月30日截止，提前五天交材料", "3天后还信用卡", "大后天上午9点体检", "过两天再说",
  "今天晚上8点看直播", "周末看那个纪录片", "过阵子再看看这个", "记得买牛奶"
];
const CONFIDENCE = { high: 1, mid: 1, low: 1 };
let shapeProblems = [];
CORPUS.forEach(function (text) {
  let r;
  try {
    r = parse.parseChineseTime(text, NOW);
  } catch (error) {
    shapeProblems.push(text + " → 抛错：" + (error && error.message));
    return;
  }
  if (!r || typeof r !== "object") { shapeProblems.push(text + " → 返回非对象"); return; }
  if (!(r.trigger === null || typeof r.trigger === "number")) {
    shapeProblems.push(text + " → trigger 类型非法：" + typeof r.trigger);
  }
  if (!CONFIDENCE[r.confidence]) {
    shapeProblems.push(text + " → confidence 非法：" + r.confidence);
  }
  if (typeof r.title !== "string") {
    shapeProblems.push(text + " → title 非字符串：" + typeof r.title);
  }
});
ok("语料 " + CORPUS.length + " 条全部返回合法形状（trigger / confidence / title）",
  shapeProblems.length === 0, JSON.stringify(shapeProblems.slice(0, 5)));

/* ================================================================== */
console.log("");
console.log("通过 " + passed + " 项，失败 " + failures.length + " 项");
if (failures.length) {
  failures.forEach(function (f) { console.log("  \u2717 " + f); });
  console.log("\n结果：单一来源未闭合（FAIL）");
  process.exitCode = 1;
} else {
  console.log("结果：单一来源已闭合（PASS）");
  process.exitCode = 0;
}
