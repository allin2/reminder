"use strict";
/* 第三轮（别名改制 + fail closed）取证探针。
 *
 * 三件事，全部只读、不落盘产品源码：
 *   1. 「修复前」的依赖矩阵 JSON —— 两个独立来源：
 *      (a) 复验方在同一份旧源码 + 旧扫描器上跑出的 baseline（引用其日志，不重跑）；
 *      (b) 用**当前**扫描器跑「旧形态源码」（把 feedbackApi/selectedFile 退回别名 f，
 *          并用 options.source 传入），证明旧形态今天会被判成**未闭合**。
 *   2. 「修复后」的依赖矩阵 JSON：直接跑工作区。
 *   3. 三组**静态反向变异**的原始输出（都用 options.source，不改工作区）：
 *      MUT-A 唯一别名路径 / MUT-B 直接命名空间路径 / MUT-C 同名歧义。
 *
 * 用法：node <本文件> <输出目录>
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.argv[3] || path.resolve(__dirname, "../../../../..");
const OUT = process.argv[2] || "/tmp/fc-evidence";
const prod = require(path.join(ROOT, "scripts/verification/production-scripts.js"));

fs.mkdirSync(OUT, { recursive: true });

const baseSource = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");
const uidAnchor = "  function uid() {";
const startAppAnchor = "  function startApp() {";
if (baseSource.indexOf(uidAnchor) < 0 || baseSource.indexOf(startAppAnchor) < 0) {
  throw new Error("锚点未找到（uid / startApp），夹具会静默失效");
}

const pick = c => ({
  undeclared: c.undeclared,
  ambiguousAliases: c.ambiguousAliases,
  ambiguousRefs: c.ambiguousRefs,
  problems: c.problems,
  aliases: c.aliases,
  declaredCount: c.declared.length,
  refsCount: c.refs.length
});

/* ---------- 1(a) 修复前：复验方的 baseline（旧扫描器口径）---------- */
const recheckLog = path.join(
  ROOT,
  "docs/reviews/verification-runs/20260921T042905-independent-f01f02f03-recheck/evidence/alias-coverage-probe.log"
);
let beforeIndependent = null;
if (fs.existsSync(recheckLog)) {
  beforeIndependent = JSON.parse(fs.readFileSync(recheckLog, "utf8"));
}

/* ---------- 1(b) 旧形态源码 × 当前扫描器 ---------- */
// 把别名改制整体退回：反馈模块别名 → `f`，上传文件变量 → `f`，返回值 → `f`。
// 这正是复验点名的形态（`const f = FeedbackLib` 与 `const f = e.target.files[0]` 共存）。
const legacySource = baseSource
  .replace(/feedbackApi/g, "f")
  .replace(/selectedFile/g, "f")
  .replace(/feedbackResult/g, "f");
const beforeReproduced = pick(prod.runtimeDependencyCoverage(ROOT, { source: legacySource }));

/* ---------- 2 修复后：工作区 ---------- */
const afterWorkspace = pick(prod.runtimeDependencyCoverage(ROOT));

/* ---------- 3 三组静态反向变异 ---------- */
const mutAlias = prod.runtimeDependencyCoverage(ROOT, {
  source: baseSource.replace(uidAnchor,
    uidAnchor + "\n    const feedbackApi = FeedbackLib;\n    feedbackApi.independentUndeclaredMember();")
});
const mutDirect = prod.runtimeDependencyCoverage(ROOT, {
  source: baseSource.replace(uidAnchor,
    uidAnchor + "\n    FeedbackLib.independentUndeclaredMember();")
});
const ambiguousSource = baseSource
  .replace(uidAnchor,
    uidAnchor + "\n    const auditAlias = FeedbackLib;\n    auditAlias.auditMember();")
  .replace(startAppAnchor,
    startAppAnchor + "\n    const auditAlias = nativeReminderStatus;");
const mutAmbiguous = prod.runtimeDependencyCoverage(ROOT, { source: ambiguousSource });

const mutations = {
  "MUT-A-unique-alias": {
    injected: "const feedbackApi = FeedbackLib;\nfeedbackApi.independentUndeclaredMember();",
    fixtureApplied: baseSource.indexOf("feedbackApi.independentUndeclaredMember") < 0,
    pass: mutAlias.undeclared.length === 1 &&
      mutAlias.undeclared[0].path === "Feedback.independentUndeclaredMember",
    result: pick(mutAlias)
  },
  "MUT-B-direct-namespace": {
    injected: "FeedbackLib.independentUndeclaredMember();",
    fixtureApplied: mutDirect.undeclared.length > 0,
    pass: mutDirect.undeclared.length === 1 &&
      mutDirect.undeclared[0].path === "Feedback.independentUndeclaredMember",
    result: pick(mutDirect)
  },
  "MUT-C-same-name-ambiguity": {
    injected: "const auditAlias = FeedbackLib; auditAlias.auditMember(); " +
      "+ 另一处 const auditAlias = nativeReminderStatus;",
    fixtureApplied: ambiguousSource !== baseSource &&
      ambiguousSource.indexOf("const auditAlias = nativeReminderStatus;") > 0,
    pass: mutAmbiguous.ambiguousAliases.indexOf("auditAlias") >= 0 &&
      mutAmbiguous.problems.some(p => p.indexOf("ambiguous-alias:auditAlias") === 0) &&
      mutAmbiguous.problems.some(p => p.indexOf("ambiguous-ref:auditAlias.") === 0),
    result: pick(mutAmbiguous)
  }
};

const coverage = {
  generatedAt: new Date().toISOString(),
  note: "修复前 (a) 是复验方在旧源码上跑出的原样日志（只读引用）；(b) 是把当前工作区源码退回旧别名形态后，用**当前**扫描器得到的输出。修复后 = 工作区。",
  before_independent_baseline: beforeIndependent,
  before_reproduced_current_scanner: beforeReproduced,
  after_workspace: afterWorkspace,
  after_all_four_empty:
    afterWorkspace.undeclared.length === 0 &&
    afterWorkspace.ambiguousAliases.length === 0 &&
    afterWorkspace.ambiguousRefs.length === 0 &&
    afterWorkspace.problems.length === 0
};

fs.writeFileSync(path.join(OUT, "coverage-before-after.json"),
  JSON.stringify(coverage, null, 2));
fs.writeFileSync(path.join(OUT, "static-mutations.json"),
  JSON.stringify(mutations, null, 2));

console.log("=== 修复后（工作区）===");
console.log(JSON.stringify({
  undeclared: afterWorkspace.undeclared,
  ambiguousAliases: afterWorkspace.ambiguousAliases,
  ambiguousRefs: afterWorkspace.ambiguousRefs,
  problems: afterWorkspace.problems,
  aliases: afterWorkspace.aliases
}, null, 2));
console.log("=== 修复前 (b) 旧形态源码 × 当前扫描器 ===");
console.log(JSON.stringify({
  undeclared: beforeReproduced.undeclared,
  ambiguousAliases: beforeReproduced.ambiguousAliases,
  ambiguousRefs: beforeReproduced.ambiguousRefs,
  problemsCount: beforeReproduced.problems.length
}, null, 2));
console.log("=== 三组静态变异 ===");
Object.keys(mutations).forEach(k => {
  console.log("  " + k + " pass=" + mutations[k].pass +
    " undeclared=" + JSON.stringify(mutations[k].result.undeclared.map(u => u.path)) +
    " ambiguousAliases=" + JSON.stringify(mutations[k].result.ambiguousAliases) +
    " ambiguousRefs=" + JSON.stringify(mutations[k].result.ambiguousRefs) +
    " problems=" + mutations[k].result.problems.length);
});
const allPass = coverage.after_all_four_empty && Object.keys(mutations).every(k => mutations[k].pass);
console.log(allPass ? "全部满足（修复后闭合 + 三组变异都报出来）" : "存在未满足项");
process.exitCode = allPass ? 0 : 1;
