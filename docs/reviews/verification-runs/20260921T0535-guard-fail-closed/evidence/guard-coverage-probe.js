"use strict";
/* 第四轮（根对象守卫 fail closed）取证探针。
 *
 * 背景：第三次独立复验（run 20260921T050350）判 FAIL / FIX_REQUIRED，阻断点是
 * `isGuardedRef` 把「模块对象存在」误当成「成员可选」：在真实调用
 * `feedbackApi ? feedbackApi.setupSteps(...)` 上只换成员名，结果仍是
 * `undeclared=[] problems=[]`（见该 run 的 independent-guard-probe.log）。
 *
 * 本探针四件事，全部只读、不落盘产品源码：
 *   1. 修复后的依赖矩阵 JSON（工作区，四出口必须为空）；
 *   2. **原样复现**独立方的反例（同一处真实调用、同一替换）⇒ 现在必须变红；
 *   3. 把「根对象守卫」加回扫描器（= 退回修复前）再跑同一个反例
 *      ⇒ 必须又变得看不见（证明变红是这次修复带来的，不是碰巧）；
 *   4. 从前被根守卫豁免的 6 个成员，现在的归属与声明状态。
 *
 * 用法：node <本文件> <输出目录> [仓库根]
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const OUT = process.argv[2] || "/tmp/g4-evidence";
const ROOT = process.argv[3] || path.resolve(__dirname, "../../../../..");
const prod = require(path.join(ROOT, "scripts/verification/production-scripts.js"));

fs.mkdirSync(OUT, { recursive: true });

const baseSource = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");
const pick = c => ({
  undeclared: c.undeclared,
  ambiguousAliases: c.ambiguousAliases,
  ambiguousRefs: c.ambiguousRefs,
  problems: c.problems,
  aliases: c.aliases,
  declaredCount: c.declared.length,
  refsCount: c.refs.length,
  guardedCount: c.guardedRefs.length
});

/* ---------- 1. 修复后：工作区 ---------- */
const after = pick(prod.runtimeDependencyCoverage(ROOT));

/* ---------- 2. 原样复现独立方反例（F02-R2） ---------- */
// 复验方的替换：真实调用位置上只把成员名换掉。
const GUARD_ALIAS_SRC = baseSource.replace(
  "const st = feedbackApi ? feedbackApi.setupSteps(nativeReminderStatus, setupStepsContext()) : null;",
  "const st = feedbackApi ? feedbackApi.independentGuardedMember(nativeReminderStatus, setupStepsContext()) : null;");
const GUARD_DIRECT_SRC = baseSource.replace(
  'const spec = FeedbackLib ? FeedbackLib.actionSpec("ack") : null;',
  'const spec = FeedbackLib ? FeedbackLib.independentGuardedMember("ack") : null;');
const counterexample = {
  fixtureApplied: GUARD_ALIAS_SRC !== baseSource && GUARD_DIRECT_SRC !== baseSource,
  guardedAlias: pick(prod.runtimeDependencyCoverage(ROOT, { source: GUARD_ALIAS_SRC })),
  guardedNamespace: pick(prod.runtimeDependencyCoverage(ROOT, { source: GUARD_DIRECT_SRC }))
};

/* ---------- 3. 旧扫描器（根对象守卫加回豁免） × 同一个反例 ---------- */
const scannerSrc = fs.readFileSync(
  path.join(ROOT, "scripts/verification/production-scripts.js"), "utf8");
const OLD_SCANNER_APPEND = [
  "// 旧行为（第四轮之前）：根对象守卫也算成员守卫。",
  "isGuardedRef = function (line, ref) {",
  "  const esc = ref.replace(/\\$/g, \"\\\\$\");",
  "  const root = ref.split(\".\")[0].replace(/\\$/g, \"\\\\$\");",
  "  if (!(new RegExp(\"\\\\b\" + esc + \"\\\\b\").test(line))) return false;",
  "  return new RegExp(\"if\\\\s*\\\\([^)]*\\\\b\" + esc + \"\\\\b\").test(line) ||",
  "    new RegExp(\"\\\\b\" + esc + \"\\\\b\\\\s*(&&|\\\\|\\\\||\\\\?)\").test(line) ||",
  "    new RegExp(\"!\\\\s*\" + esc + \"\\\\b\").test(line) ||",
  "    new RegExp(\"\\\\b\" + root + \"\\\\b\\\\s*(&&|\\\\|\\\\||\\\\?)\").test(line);",
  "};"
].join("\n");
const mutDir = fs.mkdtempSync(path.join(os.tmpdir(), "attention-g4-scanner-"));
let oldScanner = null;
try {
  fs.writeFileSync(path.join(mutDir, "production-scripts.js"),
    scannerSrc + "\n" + OLD_SCANNER_APPEND + "\n");
  oldScanner = require(path.join(mutDir, "production-scripts.js"));
} catch (error) {
  oldScanner = null;
}
const beforeOnSameFixture = oldScanner ? {
  guardedAlias: pick(oldScanner.runtimeDependencyCoverage(ROOT, { source: GUARD_ALIAS_SRC })),
  guardedNamespace: pick(oldScanner.runtimeDependencyCoverage(ROOT, { source: GUARD_DIRECT_SRC }))
} : null;
try { fs.rmSync(mutDir, { recursive: true, force: true }); } catch (error) { /* 临时目录 */ }

/* ---------- 4. 从前被根守卫豁免的成员，现在的归属 ---------- */
const movedMembers = [
  "Feedback.actionSpec", "Feedback.setupSteps", "Feedback.testFeedbackVerdict",
  "Feedback.TEST_FEEDBACK", "Feedback.UNDO_WINDOW_MS", "DeliveryEvidence.entryRoundBase"
];
const covNow = prod.runtimeDependencyCoverage(ROOT);
const moved = movedMembers.map(m => ({
  path: m,
  inRefs: covNow.refs.indexOf(m) >= 0,
  inGuarded: covNow.guardedRefs.indexOf(m) >= 0,
  declared: covNow.declared.indexOf(m) >= 0
}));

const out = {
  generatedAt: new Date().toISOString(),
  note: "修复后 = 当前工作区；beforeOnSameFixture = 同一份变异源码在「根守卫算豁免」的旧扫描器上的结果",
  after: after,
  counterexample: counterexample,
  beforeOnSameFixture: beforeOnSameFixture,
  movedMembers: moved,
  guardedRefsNow: covNow.guardedRefs,
  unusedDeclarations: covNow.unusedDeclarations
};
fs.writeFileSync(path.join(OUT, "guard-coverage.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
