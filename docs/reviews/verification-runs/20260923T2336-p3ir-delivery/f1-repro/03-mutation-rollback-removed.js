"use strict";

/**
 * P3-I-R / F1 变异对照：**拔掉修复必须变红**。
 *
 * 只把 `bind()` 里的 `rollbackListeners();` 摘掉（其余一字不动），重跑「后段失败」：
 *   修复在   → 失败后净监听器数为 0、重试后 === N；
 *   修复被摘 → 失败后那一批监听器留在 DOM 上（net > 0），重试后 > N（翻倍）。
 *
 * 本脚本的**成功判据是「变红」**：如果摘掉回滚之后用例依然是绿的，说明这条断言是恒真的、
 * 没有牙齿，脚本会以 `✗` 开头并 exit 1。
 */

const stub = require("./dom-stub.js");

const source = stub.readSource();
const names = stub.depNames(source);

const ANCHOR = "        rollbackListeners();\n";
if (source.indexOf(ANCHOR) === -1) {
  console.log("✗ 变异锚点未命中：lib/app-events.js 里找不到 `        rollbackListeners();`");
  process.exit(1);
}
const mutated = source.replace(ANCHOR, "");
if (mutated === source) {
  console.log("✗ 变异未生效：替换后源码与原码相同");
  process.exit(1);
}

/** 跑一次「后段失败 → 重试」，返回净监听器数与基线 N。 */
function probe(code) {
  const doc = stub.makeDom();
  const create = stub.loadEvents(code, doc);
  let contentCalls = 0;
  const inst = create(stub.dependencies(names, {
    bindAppContent: function() {
      contentCalls++;
      if (contentCalls === 1) throw new Error("late bind failure");
    }
  }));
  let threw = false;
  try {
    inst.bind();
  } catch (error) {
    if (!/late bind failure/.test(error && error.message)) throw error;
    threw = true;
  }
  const netAfterFail = doc.net();
  inst.bind();
  const netAfterRetry = doc.net();

  const docN = stub.makeDom();
  const instN = stub.loadEvents(code, docN)(stub.dependencies(names));
  instN.bind();
  return { threw: threw, netAfterFail: netAfterFail, netAfterRetry: netAfterRetry, N: docN.net() };
}

console.log("== P3-I-R / F1 变异对照：摘掉 rollbackListeners() 必须变红 ==");

const before = probe(source);
console.log("  修复在   " + JSON.stringify(before));
const after = probe(mutated);
console.log("  修复被摘 " + JSON.stringify(after));

const failures = [];

// 1. 修复在的时候：失败后必须回滚干净，重试不翻倍。
if (before.threw !== true) failures.push("修复在：后段抛错未按预期上抛");
if (before.netAfterFail !== 0) failures.push("修复在：失败后净监听器数应为 0，实测 " + before.netAfterFail);
if (before.netAfterRetry !== before.N) failures.push("修复在：重试后应为 N=" + before.N + "，实测 " + before.netAfterRetry);

// 2. 修复被摘的时候：必须真的坏掉 —— 这就是「对照组有牙齿」的判据。
if (!(after.netAfterFail > 0)) {
  failures.push("对照组无牙齿：摘掉回滚后失败时净监听器数仍为 " + after.netAfterFail + "，说明断言恒真");
}
if (!(after.netAfterRetry > before.N)) {
  failures.push("对照组无牙齿：摘掉回滚后重试未翻倍（N=" + before.N + "，实测 " + after.netAfterRetry + "）");
}

if (failures.length) {
  failures.forEach(function(f) { console.log("✗ " + f); });
  process.exit(1);
}

console.log("  ✓ 摘掉 rollbackListeners() 后：失败残留 " + after.netAfterFail +
  " 个监听器、重试后 " + after.netAfterRetry + " 个（N=" + before.N + "）—— 对照组变红，断言有牙齿");
process.exit(0);
