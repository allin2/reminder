#!/usr/bin/env node
/*
 * 解析器双副本一致性核对（M-10 的守护）。
 *
 * 背景：`lib/parse-cn.js` 与 `app-core.js` 里各有一份 parseChineseTime。
 * app-core 的副本只在 `lib/*.js` 未加载时兜底，平时由 `Lib.parseChineseTime` 覆盖
 * （app-core.js 的覆盖块）。两份副本已经分叉过一次（内置 cnInt 不认「四十」），
 * 而且分叉是**静默**的 —— 线上跑 lib、兜底跑另一套规则。
 *
 * 本脚本把 app-core 的副本从源码里切出来（该区段是纯函数，无 DOM 依赖），
 * 与 lib 跑同一组用例并逐项比对。任何差异都必须是有意为之，否则视为回归。
 *
 * 用法：/usr/local/bin/node scripts/verification/parse-parity.js
 * 退出码：0 = 一致（或差异全部已被 allowedDiffs 显式登记）；1 = 存在未登记差异。
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const lib = require(path.join(ROOT, "lib/parse-cn.js"));
const coreSrc = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");

/** 从源码里按花括号配平切出 `function name(` 的完整定义。 */
function sliceFunction(src, header) {
  const start = src.indexOf(header);
  if (start < 0) throw new Error("找不到函数定义：" + header);
  let i = src.indexOf("{", start);
  if (i < 0) throw new Error("找不到函数体：" + header);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    } else if (c === '"' || c === "'" || c === "`") {
      // 跳过字符串/模板字面量，避免其中的花括号影响配平
      for (j++; j < src.length; j++) {
        if (src[j] === "\\") { j++; continue; }
        if (src[j] === c) break;
      }
    }
  }
  throw new Error("函数体未闭合：" + header);
}

/** 组装 app-core 兜底副本：解析器只依赖这几个纯函数。 */
function loadCoreFallback() {
  const pieces = [
    sliceFunction(coreSrc, "function startOfDay(d)"),
    sliceFunction(coreSrc, "function endOfDay(d)"),
    sliceFunction(coreSrc, "function addDays(d, n)"),
    sliceFunction(coreSrc, "function nextWeekend(from)"),
    sliceFunction(coreSrc, "function lastDayOfMonth(d)"),
    sliceFunction(coreSrc, "function nthWeekdayInMonth(year, month, nth, dow)"),
    sliceFunction(coreSrc, "function nthWeekdayOfNextMonth(from, nth, dow, hour, minute)"),
    sliceFunction(coreSrc, "function weekdayOfNextWeek(from, weekOffset, target)"),
    sliceFunction(coreSrc, "function dayOfMonthIn(year, month, day)"),
    sliceFunction(coreSrc, "function nextDayOfMonth(from, day)"),
    sliceFunction(coreSrc, "const CN_NUM"),
    sliceFunction(coreSrc, "function cnInt(str)"),
    sliceFunction(coreSrc, "function parseChineseTime(input, now)")
  ];
  // const CN_NUM 是对象字面量赋值，配平的是 `=` 右侧的花括号，同样适用
  const body = pieces.join("\n") + "\nreturn { parseChineseTime, cnInt };\n";
  return new Function(body)();
}

/**
 * 已知且有意为之的能力差：兜底副本没有 extractDuration / normalizeTimeText，
 * 因此**时长类**表达（「两小时后」「3天后」）它认不出来 —— lib 会走时长路径
 * （保留当前时刻、high），兜底只能落到日期分支（10:00、mid）。
 * 显式列出，避免把「已知能力差」误报成「新分叉」。
 */
const KNOWN_CAPABILITY_GAPS = [
  { text: "3天后还信用卡", reason: "时长路径：兜底无 extractDuration" },
  { text: "过两天再说", reason: "时长路径：兜底无 extractDuration" }
].map(g => g.text);

// 基准时刻：2026-09-18 周五 14:00
const NOW = new Date(2026, 8, 18, 14, 0, 0);
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

const core = loadCoreFallback();

function shape(p) {
  return {
    confidence: p.confidence,
    trigger: p.trigger,
    deadline: p.deadline || null,
    repeat: p.repeat ? JSON.stringify(p.repeat) : null,
    title: p.title
  };
}

function fmt(ts) {
  return ts ? new Date(ts).toLocaleString("zh-CN", { hour12: false }) : String(ts);
}

let checked = 0, diffs = [], gaps = 0;
for (const text of CORPUS) {
  const a = shape(lib.parseChineseTime(text, NOW));
  const b = shape(core.parseChineseTime(text, NOW));
  if (KNOWN_CAPABILITY_GAPS.indexOf(text) >= 0) { gaps++; continue; }
  checked++;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    diffs.push({ text, lib: a, core: b });
  }
}

console.log("语料 " + CORPUS.length + " 条：已比对 " + checked + " 条，跳过已知能力差 " + gaps + " 条");
console.log("");
if (!diffs.length) {
  console.log("两份副本在上述语料上表现一致。");
} else {
  console.log("发现 " + diffs.length + " 处未登记的差异：");
  for (const d of diffs) {
    console.log("\n  「" + d.text + "」");
    for (const k of Object.keys(d.lib)) {
      const same = d.lib[k] === d.core[k];
      const shown = k === "trigger" || k === "deadline" ? fmt : (v => v);
      console.log("    " + (same ? " " : "!") + " " + k.padEnd(11) +
        " lib=" + (shown === fmt ? fmt(d.lib[k]) : d.lib[k]) +
        (same ? "" : "   兜底=" + (shown === fmt ? fmt(d.core[k]) : d.core[k])));
    }
  }
}

// 额外断言：lib 不该退化成兜底的那套能力（例如 cnInt 不认「四十」）
const cnNumCases = [["四十", 40], ["九十", 90], ["一百", 100], ["三十五", 35], ["二十三", 23]];
console.log("");
for (const [s, want] of cnNumCases) {
  const got = lib.cnInt(s);
  if (got !== want) { diffs.push({ text: "cnInt(" + s + ")", lib: want, core: got }); console.log("  ✗ cnInt(" + s + ") = " + got + "，应为 " + want); }
  else console.log("  ✓ cnInt(" + s + ") = " + got);
}

process.exitCode = diffs.length ? 1 : 0;
console.log("\n" + (process.exitCode ? "结果：不一致（FAIL）" : "结果：一致（PASS）"));
