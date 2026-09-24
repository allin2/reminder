#!/usr/bin/env node
/**
 * 第五轮 F02-R3 的取证探针（静态侧）。
 *
 * 要回答三个问题：
 *   1. 修复后四个出口是不是都空（矩阵闭合）；
 *   2. `Feedback.TEST_FEEDBACK` 在声明表里到底写成了什么类型；
 *   3. **静态侧能不能自己发现形状问题** —— 答案是不能，所以运行时闸门才是唯一防线
 *      （这一点必须被记录，否则后来者会误以为「静态判过了就安全」）。
 *
 * 运行时部分（三种坏形状真启动、N4/N5 拔掉修复必须变红）在 `npm test` 里常驻，
 * 见 `runtime-contract-tests.log`；真实 Chrome 部分见 `browser-recovery.json`。
 *
 * 用法：node <证据目录>/array-contract-probe.js <证据目录>
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const OUT_DIR = process.argv[2] || process.cwd();
const prod = require(path.join(ROOT, "scripts", "verification", "production-scripts.js"));
const coreSrc = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");

const fourExits = (c) => ({
  undeclared: c.undeclared.map(u => u.path),
  ambiguousAliases: c.ambiguousAliases,
  ambiguousRefs: c.ambiguousRefs,
  problems: c.problems
});

const out = { generatedAt: new Date().toISOString() };

// ① 修复后的基线
const now = prod.runtimeDependencyCoverage(ROOT);
out.after = {
  exits: fourExits(now),
  declaredTypeOf: now.declaredTypeOf,
  declaredTypes: now.declaredTypes,
  counts: { declared: now.declared.length, refs: now.refs.length, guarded: now.guardedRefs.length }
};

// ② 把期望类型退回 `object`（第四轮修复前的字节形态）
const asObject = coreSrc.replace('["Feedback.TEST_FEEDBACK", "array",',
  '["Feedback.TEST_FEEDBACK", "object",');
const beforeShapeFix = prod.runtimeDependencyCoverage(ROOT, { source: asObject });
out.beforeShapeFix = {
  applied: asObject !== coreSrc,
  typeOfTestFeedback: beforeShapeFix.declaredTypeOf["Feedback.TEST_FEEDBACK"],
  exits: fourExits(beforeShapeFix),
  // 结论记录：静态四个出口**仍然全空** —— 也就是说「写 object 还是 array」这件事
  // 静态完全看不出来。第四轮独立复验正是用运行时 `{}` 注入才炸出来的。
  staticStillClosed: beforeShapeFix.problems.length === 0 && beforeShapeFix.undeclared.length === 0
};

// ③ 写成白名单外的类型：静态必须失败（少认一种类型 ⇒ 声明消失 ⇒ 引用变未声明）
const bogus = coreSrc.replace('["Feedback.TEST_FEEDBACK", "array",',
  '["Feedback.TEST_FEEDBACK", "arrray",');
const bogusCov = prod.runtimeDependencyCoverage(ROOT, { source: bogus });
out.bogusTypeIsCaught = {
  applied: bogus !== coreSrc,
  declaredTypeOf: bogusCov.declaredTypeOf["Feedback.TEST_FEEDBACK"] || null,
  undeclared: bogusCov.undeclared.map(u => u.path),
  problems: bogusCov.problems
};

fs.writeFileSync(path.join(OUT_DIR, "array-contract-probe.json"), JSON.stringify(out, null, 2));

const checks = [
  ["修复后四出口全空", JSON.stringify(out.after.exits) === JSON.stringify(
    { undeclared: [], ambiguousAliases: [], ambiguousRefs: [], problems: [] })],
  ["TEST_FEEDBACK 声明为 array", out.after.declaredTypeOf["Feedback.TEST_FEEDBACK"] === "array"],
  ["UNDO_WINDOW_MS 仍为 number", out.after.declaredTypeOf["Feedback.UNDO_WINDOW_MS"] === "number"],
  ["类型白名单闭合", out.after.declaredTypes.every(t => prod.CONTRACT_TYPES.indexOf(t) >= 0)],
  ["退回 object 时静态**看不出问题**（运行时闸门是唯一防线）",
    out.beforeShapeFix.applied && out.beforeShapeFix.staticStillClosed],
  ["写成白名单外的类型 ⇒ 静态变红",
    out.bogusTypeIsCaught.applied &&
    out.bogusTypeIsCaught.undeclared.indexOf("Feedback.TEST_FEEDBACK") >= 0 &&
    out.bogusTypeIsCaught.problems.length >= 1]
];
let bad = 0;
console.log("=== 第五轮 F02-R3 静态取证 ===");
checks.forEach(([name, good]) => {
  if (!good) bad++;
  console.log((good ? "  ✓ " : "  ✗ ") + name);
});
console.log("\n出口：%s", bad === 0 ? "全部成立" : (bad + " 条不成立"));
console.log("修复后类型表：%s", JSON.stringify(out.after.declaredTypeOf["Feedback.TEST_FEEDBACK"]));
console.log("声明类型取值：%s", JSON.stringify(out.after.declaredTypes));
console.log("JSON 已写入：%s/array-contract-probe.json", OUT_DIR);
process.exit(bad === 0 ? 0 : 1);
