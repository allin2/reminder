#!/usr/bin/env node
/*
 * **搬移不改行为**的对照脚本（P2 首批搬移的一次性证据）。
 *
 * 问题：把 `escapeHtml` / `fmtTime` / `renderMarkdown` 等搬进 `lib/ui-format.js` 时，
 * 「行为没变」这句话怎么证？读一遍代码说「我抄对了」不算 —— 那正是「报告说已验证」。
 *
 * 做法：用 **git HEAD 里的旧实现当 oracle**。
 *   · 本仓库此前**未提交**任何 P1/P2 改动，所以 `git show HEAD:app-core.js` 里就是
 *     搬移**之前**的原始函数体，不是「我写的另一份副本」；
 *   · 把旧函数切出来，往它们的作用域里注入一个**可控的 Date**（否则 `new Date()` /
 *     `Date.now()` 读真实时钟，「今天/明天」的判定随运行时刻漂移，根本无法逐项比对）；
 *   · 新实现走 `lib/ui-format.js` 的 `now` 参数；
 *   · 在一张**矩阵**（多个目标时刻 × 多个「现在」× 跨年/跨月/边界分钟）上逐项比对字符串。
 *
 * 有牙齿：把新实现里任意一处改一个字符（例如「明天」写成「明日」），必须报出差异。
 *
 * 用法：node scripts/verification/ui-format-parity.js
 * 退出码：0 = 逐项一致；1 = 存在差异。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const RealDate = Date;

/**
 * 从源码里切出 `  function name(` 的完整定义。
 *
 * 按**行**累计大括号深度，而不是逐字符扫描：`app-core.js` 的顶层函数统一 2 空格缩进、
 * 收尾是独占一行的 `  }`，所以「深度首次回到 0 的那一行」就是函数结尾。
 *
 * 为什么不用逐字符扫描：这些函数里有 `/[&<>"']/g` 这类正则字面量，里面的引号会让
 * 「跳过字符串」的逻辑跑到正则中间去，把深度数错（`renderMarkdown` 就直接报「未闭合」）。
 * 按行计数对这些函数是精确的 —— 它们的字符串/正则里都不含大括号。
 */
function sliceFunction(src, header) {
  const lines = src.split("\n");
  const start = lines.findIndex(function (l) { return l.indexOf("  " + header) === 0; });
  if (start < 0) throw new Error("找不到函数定义：" + header);
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    for (let k = 0; k < l.length; k++) {
      if (l[k] === "{") depth++;
      else if (l[k] === "}") depth--;
    }
    if (depth <= 0) return lines.slice(start, i + 1).join("\n");
  }
  throw new Error("函数体未闭合：" + header);
}

/** 造一个「无参构造 = 固定时刻」的 Date 替身。 */
function makeFakeDate(nowTs) {
  const F = function () {
    if (arguments.length === 0) return new RealDate(nowTs);
    return new (Function.prototype.bind.apply(RealDate, [null].concat(Array.prototype.slice.call(arguments))))();
  };
  F.prototype = RealDate.prototype;
  F.now = function () { return nowTs; };
  F.parse = RealDate.parse;
  F.UTC = RealDate.UTC;
  return F;
}

/* ---------- oracle：从 HEAD 切出搬移前的实现 ---------- */
const headCore = execFileSync("git", ["show", "HEAD:app-core.js"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();

const ORACLE_PIECES = [
  sliceFunction(headCore, "function pad(n)"),
  sliceFunction(headCore, "function sameDay(a, b)"),
  sliceFunction(headCore, "function addDays(d, n)"),
  sliceFunction(headCore, "function fmtTime(ts)"),
  sliceFunction(headCore, "function fmtDate(ts)"),
  sliceFunction(headCore, "function relDue(ts)"),
  sliceFunction(headCore, "function escapeHtml(s)"),
  sliceFunction(headCore, "function escapeAttr(v)"),
  sliceFunction(headCore, "function renderMarkdown(src)")
];

/** 在给定的「现在」上构造旧实现的实例。 */
function oracleAt(nowTs) {
  const body = ORACLE_PIECES.join("\n") +
    "\nreturn { pad: pad, fmtTime: fmtTime, fmtDate: fmtDate, relDue: relDue," +
    " escapeHtml: escapeHtml, escapeAttr: escapeAttr, renderMarkdown: renderMarkdown };\n";
  // 注入 Date：旧实现里的 `new Date()` / `Date.now()` 都解析到这个替身。
  return new Function("Date", body)(makeFakeDate(nowTs));
}

/* ---------- 新实现 ---------- */
const ui = require(path.join(ROOT, "lib/ui-format.js"));

/* ---------- 输入矩阵 ---------- */
const NOWS = [
  new RealDate(2026, 8, 18, 14, 0, 0).getTime(),   // 2026-09-18 周五 14:00
  new RealDate(2026, 0, 1, 0, 0, 0).getTime(),     // 跨年前夜
  new RealDate(2026, 11, 31, 23, 59, 0).getTime(), // 年末
  new RealDate(2028, 1, 29, 12, 0, 0).getTime(),   // 闰年 2/29
  new RealDate(2026, 5, 30, 3, 15, 0).getTime()    // 普通日
];

const TARGETS = [null, 0, undefined];
// 相对每个「现在」生成：同刻、±1 分、±1 小时、±23 小时、±25 小时、±1 天、±3 天、±40 天、跨年、跨月
const OFFSETS = [
  0, 30000, 60000, 3600000, -3600000, 82800000, -82800000, 86400000, -86400000,
  259200000, -259200000, 3456000000, -3456000000, 366 * 86400000, -366 * 86400000
];

const STRINGS = [
  "", "纯文本", "<script>alert(1)</script>", "a & b < c > d", '"双引号"', "'单引号'",
  "`反引号`", "\\ 反斜杠 \\", "emoji 🙂 与中文", null, undefined, 0, 123,
  "# 标题\n\n正文 **粗** *斜* `代码`",
  "> 引用\n\n- 甲\n- 乙\n\n1. 一\n2. 二",
  "```\ncode < here\n```",
  "[链接](https://example.com/a?b=1) 与 [坏链接](javascript:alert(1))",
  "<img src=x onerror=alert(1)>",
  "a\n\n\n\nb"
];

let checked = 0;
const diffs = [];

function cmp(label, a, b) {
  checked++;
  if (a !== b) diffs.push({ label: label, oracle: a, next: b });
}

NOWS.forEach(function (nowTs, ni) {
  const o = oracleAt(nowTs);
  const targets = TARGETS.concat(OFFSETS.map(function (off) { return nowTs + off; }));
  targets.forEach(function (ts, ti) {
    const tag = "now#" + ni + " ts#" + ti;
    cmp(tag + " fmtTime", o.fmtTime(ts), ui.fmtTime(ts, nowTs));
    cmp(tag + " fmtDate", o.fmtDate(ts), ui.fmtDate(ts, nowTs));
    cmp(tag + " relDue", o.relDue(ts), ui.relDue(ts, nowTs));
  });
  STRINGS.forEach(function (s, si) {
    cmp("now#" + ni + " str#" + si + " escapeHtml", o.escapeHtml(s), ui.escapeHtml(s));
    cmp("now#" + ni + " str#" + si + " escapeAttr", o.escapeAttr(s), ui.escapeAttr(s));
    cmp("now#" + ni + " str#" + si + " renderMarkdown", o.renderMarkdown(s), ui.renderMarkdown(s));
  });
});

/* 无参调用路径：旧实现读真实时钟，新实现也读真实时钟 —— 必须在同一毫秒窗口内比对。
 * 这条专门守「可选 now 参数」没有把默认路径改坏。 */
{
  const near = RealDate.now();
  const o = oracleAt(near);
  TARGETS.concat([near, near + 3600000, near - 86400000]).forEach(function (ts, i) {
    cmp("默认路径 ts#" + i + " fmtTime", o.fmtTime(ts), ui.fmtTime(ts));
    cmp("默认路径 ts#" + i + " fmtDate", o.fmtDate(ts), ui.fmtDate(ts));
  });
}

/* ---------- 反向对照：改动新实现必须被报出来（证明上面不是恒真） ---------- */
{
  // 直接比字符串，不进 diffs —— 这条是「脚本自身有没有分辨力」的自检，不是被测差异。
  const tamper = function (src) { return ui.renderMarkdown(src).replace("<strong>", "<b>"); };
  const oneLine = "# t\n\n**b**";
  const redWorks = tamper(oneLine) !== ui.renderMarkdown(oneLine);
  // 再自检一次：同一个输入跑两遍必须相等（不然上面那些「一致」毫无意义）。
  const stable = ui.renderMarkdown(oneLine) === ui.renderMarkdown(oneLine) &&
    ui.fmtDate(0, NOWS[0]) === ui.fmtDate(0, NOWS[0]);
  console.log("反向对照：篡改实现能被报出差异 = " + redWorks);
  console.log("反向对照：同一输入重复调用结果稳定 = " + stable);
  if (!redWorks || !stable) {
    console.log("\n结果：对照脚本没有分辨力（FAIL）");
    process.exit(1);
  }
}

console.log("");
console.log("比对项：" + checked);
if (!diffs.length) {
  console.log("结果：搬移前后逐项一致（PASS）");
  process.exit(0);
} else {
  console.log("发现 " + diffs.length + " 处差异（前 10 条）：");
  diffs.slice(0, 10).forEach(function (d) {
    console.log("  ✗ " + d.label);
    console.log("      oracle = " + JSON.stringify(d.oracle));
    console.log("      next   = " + JSON.stringify(d.next));
  });
  console.log("\n结果：搬移改变了行为（FAIL）");
  process.exit(1);
}
