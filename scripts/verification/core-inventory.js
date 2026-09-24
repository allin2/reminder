#!/usr/bin/env node
/**
 * core-inventory.js —— app-core.js 顶层符号清单（P0 搬移表 / P4 收口核对）
 *
 * 用途：把 app-core.js 里**顶层**（IIFE 体内第一层缩进）的函数声明与可变状态列出来，
 * 并给出每个符号在文件内被引用的次数与出现行号。它是「搬移表」的可复算来源：
 * 拆分前后各跑一次，用「符号还在不在 core」「引用次数有没有掉」判断搬移是否真的发生，
 * 而不是靠叙述。
 *
 * 用法：
 *   node scripts/verification/core-inventory.js [--root <repo>] [--out <json>] [--file <path>]
 *
 * 退出码：0 = 生成成功；1 = 目标文件不存在。
 */
"use strict";

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") out.root = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--file") out.file = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv);
const root = path.resolve(args.root || path.join(__dirname, "..", ".."));
const target = path.resolve(root, args.file || "app-core.js");

if (!fs.existsSync(target)) {
  process.stderr.write("核心文件不存在: " + target + "\n");
  process.exit(1);
}

const src = fs.readFileSync(target, "utf8");
const lines = src.split("\n");

/**
 * 扫出 IIFE 体内第一层（缩进 2 空格）的语句起始行。
 * 只按行首形态判断，不解析语法树——目标文件是手写顺序脚本，形态稳定。
 */
const DECL = [
  { kind: "function", re: /^ {2}(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/ },
  // 函数表达式形式的顶层定义（const f = function / const f = (…) => / const f = async (…)）
  { kind: "function", re: /^ {2}(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/ },
  { kind: "state", re: /^ {2}(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?!=)/ },
];

const symbols = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  let hit = null;
  for (const d of DECL) {
    const m = line.match(d.re);
    if (m) {
      // 函数声明组 m[2] 是名字；其余组 m[1]
      const name = m.length > 2 && m[2] ? m[2] : m[1];
      if (name) hit = { kind: d.kind, name, line: i + 1 };
      break;
    }
  }
  if (hit) symbols.push(hit);
}

/** 统计符号在全文的出现次数与行号（词边界，排除自身声明行） */
function refs(name, declLine) {
  const re = new RegExp("(?:^|[^\\w$.])" + name.replace(/\$/g, "\\$") + "(?![\\w$])");
  const at = [];
  for (let i = 0; i < lines.length; i++) {
    if (i + 1 === declLine) continue;
    if (re.test(lines[i])) at.push(i + 1);
  }
  return at;
}

const out = symbols.map((s) => {
  const at = refs(s.name, s.line);
  return { name: s.name, kind: s.kind, line: s.line, refCount: at.length, refLines: at };
});

const report = {
  generatedFor: path.relative(root, target),
  bytes: Buffer.byteLength(src, "utf8"),
  totalLines: lines.length,
  topLevelSymbolCount: out.length,
  functionCount: out.filter((s) => s.kind === "function").length,
  stateCount: out.filter((s) => s.kind === "state").length,
  symbols: out,
};

const text = JSON.stringify(report, null, 2);
if (args.out) {
  fs.mkdirSync(path.dirname(path.resolve(root, args.out)), { recursive: true });
  fs.writeFileSync(path.resolve(root, args.out), text + "\n");
  process.stdout.write(
    "core-inventory: " + report.totalLines + " 行, " +
    report.functionCount + " 个函数, " + report.stateCount + " 个状态, " +
    "-> " + args.out + "\n"
  );
} else {
  process.stdout.write(text + "\n");
}
