#!/usr/bin/env node
/**
 * 生成本轮 run 目录的 `identity.json`：源码 / Java / 候选 APK 的身份与「相对上一轮失败候选」的变化。
 *
 * 用法：node identity.js            （在仓库根跑，或从本目录跑都可以）
 *
 * 为什么要有这个文件：报告里的「只改了这几个文件」必须是**逐字节比对**的结论，
 * 不是叙述。上一个 run 目录（被判 FAIL 的那一版）的 identity.json 就是 before 侧。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../../../..");
const RUN = __dirname;
const PREV = path.join(ROOT, "docs/reviews/verification-runs/20260919T235500-ux-rework/identity.json");
const CANDIDATE = path.join(ROOT, "releases/candidates/20260920T003000-ux-rework2");

const sha = rel => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : null;
};
const shas = rels => {
  const out = {};
  rels.slice().sort().forEach(r => { out[r] = sha(r); });
  return out;
};
const list = (dir, filter) => fs.readdirSync(path.join(ROOT, dir))
  .filter(filter).sort().map(f => path.posix.join(dir, f));

function git(cmd) {
  try { return execSync("git " + cmd, { cwd: ROOT, encoding: "utf8" }).trim(); }
  catch (_e) { return ""; }
}

const head = git("rev-parse HEAD");
const originMain = git("rev-parse origin/main");
const dirty = git("status --porcelain").split("\n").filter(Boolean);

const sourceFiles = ["index.html", "app-core.js", "sw.js", "manifest.json", "icon.svg"]
  .concat(list("lib", f => f.endsWith(".js")));
const srcNow = shas(sourceFiles);

// ---- 与上一轮（被判 FAIL 的那一版）逐字节比对 ----
let prev = null;
try { prev = JSON.parse(fs.readFileSync(PREV, "utf8")); } catch (_e) { prev = null; }
const changedVsFailedRound = {};
const notInPreviousIdentity = {};
if (prev && prev.sourceSha256) {
  Object.keys(srcNow).forEach(k => {
    const before = prev.sourceSha256[k];
    if (!before) {
      // 上一轮 identity 没收录这个文件 ⇒ **不能**说「它变了」，
      // 那会把「没比对过」冒充成「有变化」。单独列出。
      notInPreviousIdentity[k] = srcNow[k];
      return;
    }
    if (before !== srcNow[k]) changedVsFailedRound[k] = { before, after: srcNow[k] };
  });
}

const javaNow = shas(list("android/app/src/main/java/space/alliswell/inbox", f => f.endsWith(".java")));
const javaTestsNow = shas(list("android/app/src/test/java/space/alliswell/inbox", f => f.endsWith(".java")));

// Java 也要比：本轮原则上**未改 Java**，这个字段是给复验方核对的
const changedJavaVsFailedRound = {};
if (prev && prev.javaSha256) {
  Object.keys(javaNow).forEach(k => {
    const before = prev.javaSha256[k];
    if (before !== javaNow[k]) changedJavaVsFailedRound[k] = { before: before || null, after: javaNow[k] };
  });
}

// ---- 候选 APK ----
const apkFiles = fs.existsSync(CANDIDATE)
  ? fs.readdirSync(CANDIDATE).filter(f => f.endsWith(".apk")).sort()
  : [];
const webRel = sourceFiles.filter(f => f === "index.html" || f === "app-core.js" || f === "sw.js"
  || f.startsWith("lib/"));

// 逐字节比对靠 apk-web-assets.sh（需要 unzip）；这里只把它的输出解析成布尔值，
// 解析不出来就写 null —— 不允许「没比对过」被读成「比对通过」。
const assetLogPath = path.join(RUN, "apk-web-assets.txt");
const assetLog = fs.existsSync(assetLogPath) ? fs.readFileSync(assetLogPath, "utf8") : "";
const assetBlocks = assetLog.split("== APK: ").slice(1);

function webMatchesFor(apkPath, apkName) {
  const block = assetBlocks.find(b => b.split("\n")[0].trim() === apkPath)
    || assetBlocks.find(b => b.split("\n")[0].trim().endsWith(apkName));
  if (!block) {
    const out = {};
    webRel.forEach(w => { out[w] = null; });
    return out;
  }
  const out = {};
  webRel.forEach(w => {
    if (block.indexOf("IDENTICAL       " + w + "  (") >= 0) out[w] = true;
    else if (block.indexOf("DIFFERS         " + w) >= 0) out[w] = false;
    else if (block.indexOf("MISSING_IN_APK  " + w) >= 0) out[w] = false;
    else out[w] = null;
  });
  return out;
}

const apks = apkFiles.map(f => {
  const abs = path.join(CANDIDATE, f);
  const buf = fs.readFileSync(abs);
  return {
    name: f,
    path: abs,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    size: buf.length,
    webMatches: webMatchesFor(abs, f)
  };
});

const identity = {
  runId: "20260920T003000-ux-rework2",
  purpose: "二次返工：独立复验 R-F06 / R-F03 / R-F07 三个遗漏分支 + SW 缺口后的候选身份与源码身份",
  judgedFailedRound: "20260919T235500-ux-rework",
  HEAD: head,
  originMain: originMain,
  committed: head === originMain,
  committedMeaning: "HEAD == origin/main（即本地无待推送提交）；**不代表工作区干净**",
  workingTreeDirtyEntries: dirty.length,
  sourceSha256: srcNow,
  javaSha256: javaNow,
  javaTestSha256: javaTestsNow,
  changedVsFailedRound: changedVsFailedRound,
  notInPreviousIdentity: notInPreviousIdentity,
  notInPreviousIdentityNote: "上一轮 identity.json 未收录这些文件（它只收 index.html / app-core.js / sw.js / lib/*.js），因此「是否变化」无据；单独列出，不与 changedVsFailedRound 混在一起",
  changedJavaVsFailedRound: changedJavaVsFailedRound,
  javaChangedCount: Object.keys(changedJavaVsFailedRound).length,
  apks: apks
};

fs.writeFileSync(path.join(RUN, "identity.json"), JSON.stringify(identity, null, 2) + "\n");
console.log("changed vs failed round (source):");
console.log(Object.keys(changedVsFailedRound).map(k => "  " + k).join("\n") || "  (none)");
console.log("changed vs failed round (java): " + Object.keys(changedJavaVsFailedRound).length);
console.log("apks: " + apks.map(a => a.sha256.slice(0, 8)).join(", "));
