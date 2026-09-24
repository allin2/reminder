#!/usr/bin/env node
"use strict";
/**
 * P3-I-R · `app-core.js` 入口构成复算器
 *
 * 用途：`responsibility-table.md` §2 / §3 / §4 的数字来源。
 * 本脚本是补交的 —— 上一轮交付报告 §5「复算方式」只留了一个占位符，
 * 指向一份并不存在的脚本，导致「所有数字均可由本 run 的脚本复算」这句不成立。
 * 本脚本把口径钉成可执行代码，并把分类结果落盘为 `compose-partition.json`，
 * 使任何一方都能逐行复核（而不是只能相信报告里的表格）。
 *
 * 口径（与 `responsibility-table.md` §5 一字对应）：
 *  1. 顶层函数 = IIFE 内、缩进恰好两空格、以 `function` / `async function` 开头的声明。
 *  2. 函数体边界有两套，都输出：
 *     · naive —— 到「下一个同类声明的前一行」（上一轮报告用的口径）。
 *       代价：夹在函数之间的顶层语句（如 `let state = null;`）会被并进上一个函数体内。
 *     · precise —— 花括号深度回到声明处深度的那一行收口。本脚本认为这套才是真实体量。
 *  3. 码行 = 去掉空行与注释行后的行数；字符串字面量与注释内容一律不参与计数。
 *  4. 类别互斥，取用顺序固定：A（显式名单）→ B（显式名单）→ D（显式名单）→ C（规则）→ E（其余）。
 *  5. C 判据：码行 ≤ 4 且正文匹配 C_PATTERN。
 *     该正则把「带守卫的转发」也算薄转发（`return appX ? appX.y() : null`、
 *     `return !!(appX && appX.y())`）——它们同样不持有行为，只是多了一层空值兜底。
 *     但**不**把 `if (!ns) return fallback; return ns.y();` 形态算进来：那类用的是
 *     非 `app` 前缀/非 `*Instance` 的实例名（如 `diagnostics`），本轮按 E 类登记。
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../../..");
const CORE = path.join(ROOT, "app-core.js");
const OUT_FILE = path.join(__dirname, "compose-partition.json");

/** A 装配与依赖注入（22） */
const CLASS_A = [
  "runtimeRoots",
  "readRuntimePath",
  "describeGot",
  "describeTypeMismatch",
  "missingItemShape",
  "aiRuntimeDeps",
  "backupRuntimeDeps",
  "diagnosticsRuntimeDeps",
  "setupRuntimeDeps",
  "contentRuntimeDeps",
  "captureRuntimeDeps",
  "viewsRuntimeDeps",
  "reviewRuntimeDeps",
  "alertsRuntimeDeps",
  "platformRuntimeDeps",
  "noticesRuntimeDeps",
  "actionFeedbackRuntimeDeps",
  "eventsRuntimeDeps",
  "testApiRuntimeDeps",
  "collectRuntimeBindings",
  "assertRuntimeDependencies",
  "bindRuntime",
];

/** B 启动闸门与失败呈现（9） */
const CLASS_B = [
  "renderStartupFailure",
  "describeLoadFailure",
  "renderStateRecovery",
  "removeStateRecoveryPanel",
  "retryRestore",
  "installGlobalErrorHandler",
  "init",
  "startBusinessStartup",
  "startApp",
];

/** D 纯函数模块转发（11，唯一来源都是 `lib/ui-format.js`） */
const CLASS_D = [
  "uid",
  "pad",
  "fmtTime",
  "fmtDate",
  "relDue",
  "escapeHtml",
  "escapeAttr",
  "toLocalInput",
  "parseLocalInput",
  "dayLabel",
  "renderMarkdown",
];

const C_MAX_LINES = 4;
const C_PATTERN = /return\s+(?:!!\(?\s*)?(?:app[A-Za-z0-9_$]*\s*[.?&]|[A-Za-z0-9_$]*Instance\s*\.)/;

/** 本轮（P3-I-Q2 detailReminderStatusRow 迁出 run）报告公布的数字，用于对账。
 * 相对 U1 修复 run 的变化：detailReminderStatusRow 由 E（11 行实现体）
 * 变为 C（3 行薄转发，其中 1 行为 return 委托），E 36→35 / 220→209（naive），
 * C 176→177 / 432→435；viewsRuntimeDeps 增加 3 行具名依赖注入，A 1390→1393。
 * 合计 naive 2370→2365（-5 行），收口 2284→2279（-5 行）。 */
const PUBLISHED = {
  total: { funcs: 254, lines: 2365 },
  A: { funcs: 22, lines: 1393 },
  B: { funcs: 9, lines: 295 },
  C: { funcs: 177, lines: 435 },
  D: { funcs: 11, lines: 33 },
  E: { funcs: 35, lines: 209 },
};

// ── 词法：把字符串字面量与注释内容清成空格，只留可执行骨架 ────────────────────
function blankNonCode(lines) {
  const out = [];
  let state = "code"; // code | sq | dq | tmpl | line | block
  for (const line of lines) {
    let buf = "";
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const nx = line[i + 1];
      if (state === "code") {
        if (ch === "/" && nx === "/") { state = "line"; buf += "  "; i += 1; }
        else if (ch === "/" && nx === "*") { state = "block"; buf += "  "; i += 1; }
        else if (ch === "'") { state = "sq"; buf += " "; }
        else if (ch === '"') { state = "dq"; buf += " "; }
        else if (ch === "`") { state = "tmpl"; buf += " "; }
        else buf += ch;
      } else if (state === "sq" || state === "dq" || state === "tmpl") {
        const closer = state === "sq" ? "'" : state === "dq" ? '"' : "`";
        if (ch === "\\") { buf += "  "; i += 1; }
        else { buf += " "; if (ch === closer) state = "code"; }
      } else if (state === "line") {
        buf += " ";
      } else { // block
        buf += " ";
        if (ch === "*" && nx === "/") { buf += " "; i += 1; state = "code"; }
      }
    }
    if (state === "line") state = "code";
    out.push(buf);
  }
  return out;
}

function main() {
  const raw = fs.readFileSync(CORE, "utf8").split("\n");
  const code = blankNonCode(raw);

  // 花括号深度（行首深度）
  const depthBefore = [];
  let depth = 0;
  for (let i = 0; i < code.length; i += 1) {
    depthBefore.push(depth);
    for (const ch of code[i]) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
  }

  // 顶层声明
  const declRe = /^ {2}(async )?function ([A-Za-z0-9_$]+)\s*\(/;
  const decls = [];
  for (let i = 0; i < code.length; i += 1) {
    const m = declRe.exec(code[i]);
    if (m) {
      if (depthBefore[i] !== 1) {
        console.error(`✗ 断言失败：${i + 1} 行的声明不在 IIFE 顶层（depth=${depthBefore[i]}）`);
        process.exit(1);
      }
      decls.push({ line: i, name: m[2] });
    }
  }

  // 两套边界
  const spans = decls.map((decl, k) => {
    const naiveEnd = k + 1 < decls.length ? decls[k + 1].line - 1 : code.length - 1;
    const base = depthBefore[decl.line];
    let preciseEnd = naiveEnd;
    let d = base;
    for (let i = decl.line; i <= naiveEnd; i += 1) {
      for (const ch of code[i]) {
        if (ch === "{") d += 1;
        else if (ch === "}") d -= 1;
      }
      if (d === base) { preciseEnd = i; break; }
    }
    return { line: decl.line, name: decl.name, naiveEnd, preciseEnd };
  });

  const inA = new Set(CLASS_A);
  const inB = new Set(CLASS_B);
  const inD = new Set(CLASS_D);

  function classify(name, bodyLines) {
    if (inA.has(name)) return "A";
    if (inB.has(name)) return "B";
    if (inD.has(name)) return "D";
    if (bodyLines.length <= C_MAX_LINES && C_PATTERN.test(bodyLines.join("\n"))) return "C";
    return "E";
  }

  // ── 牙齿自检：合成的「纯转发」必须落 C，合成的「实现体」必须落 E ─────────────
  const fixtureFwd = [
    "function probeForward(id) {",
    "  return appModel.probe(id);",
    "}",
  ];
  const fixtureImpl = [
    "function probeImpl(id) {",
    "  state.ui.probeId = id;",
    "  closeSheet(\"sheetDetail\");",
    "  openSheet(\"sheetProbe\");",
    "  return true;",
    "}",
  ];
  const selfCheck = [
    ["合成纯转发 → C", classify("__probe_forward__", fixtureFwd) === "C"],
    ["合成实现体 → E", classify("__probe_impl__", fixtureImpl) === "E"],
    ["A 名单全部存在", CLASS_A.every((n) => decls.some((d) => d.name === n))],
    ["B 名单全部存在", CLASS_B.every((n) => decls.some((d) => d.name === n))],
    ["D 名单全部存在", CLASS_D.every((n) => decls.some((d) => d.name === n))],
    ["三类名单互不重叠", CLASS_A.every((n) => !inB.has(n) && !inD.has(n)) && CLASS_B.every((n) => !inD.has(n))],
  ];
  let selfCheckOk = true;
  for (const [label, ok] of selfCheck) {
    if (!ok) selfCheckOk = false;
    console.log(`${ok ? "✓" : "✗"} ${label}`);
  }

  // ── 分类 ──────────────────────────────────────────────────────────────────
  function build(whichEnd) {
    const rows = spans.map((s) => {
      const end = whichEnd === "naive" ? s.naiveEnd : s.preciseEnd;
      const body = [];
      for (let i = s.line; i <= end; i += 1) if (code[i].trim() !== "") body.push(code[i].trim());
      return { name: s.name, line: s.line + 1, lines: body.length, cls: classify(s.name, body) };
    });
    const buckets = { A: [], B: [], C: [], D: [], E: [] };
    for (const r of rows) buckets[r.cls].push(r);
    const sum = (a) => a.reduce((t, r) => t + r.lines, 0);
    const summary = {};
    for (const k of ["A", "B", "C", "D", "E"]) summary[k] = { funcs: buckets[k].length, lines: sum(buckets[k]) };
    return { rows, buckets, summary, total: { funcs: rows.length, lines: sum(rows) } };
  }
  const naive = build("naive");
  const precise = build("precise");

  // ── 边界假象：被 naive 口径误并进上一个函数体内的顶层语句 ───────────────────
  // 只统计「夹在两个函数之间」的那些（文件头部在第一个函数之前的顶层声明不算假象）。
  const artifacts = [];
  for (const s of spans) {
    const stolen = [];
    for (let i = s.preciseEnd + 1; i <= s.naiveEnd; i += 1) {
      if (code[i].trim() === "") continue;
      stolen.push({ line: i + 1, text: raw[i].trim() });
    }
    if (stolen.length) artifacts.push({ name: s.name, line: s.line + 1, stolen });
  }
  const artifactLines = artifacts.reduce((t, a) => t + a.stolen.length, 0);

  // ── 输出 ──────────────────────────────────────────────────────────────────
  const pad2 = (s, n) => String(s).padEnd(n, " ");
  console.log("");
  console.log("== 上一轮报告口径（naive 边界）==");
  console.log(pad2("类", 4) + pad2("个数", 8) + pad2("行数", 8) + pad2("报告个数", 10) + pad2("报告行数", 10) + "对账");
  for (const k of ["A", "B", "C", "D", "E"]) {
    const g = naive.summary[k];
    const p = PUBLISHED[k];
    const ok = g.funcs === p.funcs && g.lines === p.lines;
    console.log(pad2(k, 4) + pad2(g.funcs, 8) + pad2(g.lines, 8) + pad2(p.funcs, 10) + pad2(p.lines, 10) + (ok ? "MATCH" : "DIFF"));
  }
  const t = naive.total;
  const tok = t.funcs === PUBLISHED.total.funcs && t.lines === PUBLISHED.total.lines;
  console.log(pad2("合计", 4) + pad2(t.funcs, 8) + pad2(t.lines, 8) + pad2(PUBLISHED.total.funcs, 10) + pad2(PUBLISHED.total.lines, 10) + (tok ? "MATCH" : "DIFF"));

  console.log("");
  console.log("== 花括号收口口径（precise 边界，本脚本主张的真实体量）==");
  console.log(pad2("类", 4) + pad2("个数", 8) + pad2("行数", 8) + pad2("naive 行数", 12) + "差");
  for (const k of ["A", "B", "C", "D", "E"]) {
    const g = precise.summary[k];
    const n = naive.summary[k];
    console.log(pad2(k, 4) + pad2(g.funcs, 8) + pad2(g.lines, 8) + pad2(n.lines, 12) + (n.lines - g.lines));
  }
  console.log(pad2("合计", 4) + pad2(precise.total.funcs, 8) + pad2(precise.total.lines, 8) + pad2(naive.total.lines, 12) + (naive.total.lines - precise.total.lines));

  console.log("");
  console.log(`== 边界假象：被 naive 口径误并进上一个函数体内的顶层语句（${artifacts.length} 处，共 ${artifactLines} 行）==`);
  console.log("   这 ${artifactLines} 行不是任何函数的代码，却被算进了上一行函数的体量。".replace("${artifactLines}", artifactLines));
  for (const a of artifacts) {
    console.log(`  ${a.name}（L${a.line}，被并进 ${a.stolen.length} 行）`);
    for (const o of a.stolen) console.log(`      L${o.line}  ${o.text}`);
  }

  console.log("");
  console.log(`== E 类逐项（precise 边界，共 ${precise.summary.E.funcs} 个 / ${precise.summary.E.lines} 行）==`);
  const longE = [];
  for (const r of precise.buckets.E) {
    console.log(`  ${pad2(r.lines, 4)}行  L${pad2(r.line, 5)}  ${r.name}`);
    if (r.lines >= 7) longE.push(r);
  }
  console.log("");
  console.log(`== E 类中「长实现体」（≥7 行，共 ${longE.length} 个）—— §4 必须逐项给出所有权理由 ==`);
  for (const r of longE) console.log(`  ${pad2(r.lines, 4)}行  ${r.name}`);

  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify({ source: CORE, published: PUBLISHED, naive, precise, artifacts, artifactLines }, null, 2) + "\n",
    "utf8"
  );
  console.log("");
  console.log(`落盘：${OUT_FILE}`);

  if (!selfCheckOk) {
    console.error("✗ 自检未通过（上面有 ✗ 项），判为脚本失效");
    process.exit(1);
  }
  console.log("复算完成：自检全绿。");
}

main();
