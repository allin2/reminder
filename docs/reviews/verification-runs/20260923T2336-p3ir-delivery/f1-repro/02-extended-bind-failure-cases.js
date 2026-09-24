"use strict";

/**
 * P3-I-R / F1 扩展反例：绑定失败必须「可回滚 + 可重试 + 重试不翻倍」。
 *
 * 独立复验方只给了一个早段反例（bindSetupReviewControls 抛错）。这里补齐五个场景：
 *
 *   A 对照    健康绑定：得到基线监听器数 N（> 1，证明 DOM 里真的挂上了东西）
 *   B 早段    第一个委托点就抛错（此时还没挂任何监听器）→ 失败后可重试，重试后 net === N
 *   C 后段    最后一个委托点抛错（此时前面那批监听器已经挂上）→ 失败后 net 必须为 0
 *             （回滚真的摘掉了已挂上的那一批），重试后 net === N 而不是 2N
 *   D 跨模块  委托子模块自己已经绑定成功，入口再抛错 → 重试时子模块靠自身幂等标志短路，
 *             它那一份监听器仍是 1 而不是 2
 *   E 幂等    已经 bind() 成功后再调一次，net 不变
 *
 * 「成功」判据是**净**监听器数（add 减 remove），不是 add 的次数 —— 只看 add 次数会把
 * 「挂了两遍却没摘」判成绿。
 */

const assert = require("assert");
const crypto = require("crypto");
const stub = require("./dom-stub.js");

const source = stub.readSource();
const names = stub.depNames(source);

let passed = 0;
function ok(desc, condition, extra) {
  if (!condition) {
    throw new Error("FAILED: " + desc + (extra ? " — " + extra : ""));
  }
  passed++;
  console.log("  ✓ " + desc);
}

console.log("== P3-I-R / F1 扩展反例：绑定失败可回滚、可重试、重试不翻倍 ==");
console.log("source=" + stub.REL + " sha256=" + crypto.createHash("sha256").update(source).digest("hex").slice(0, 16));

// A 对照：健康绑定，量出基线 N
const docA = stub.makeDom();
const createA = stub.loadEvents(source, docA);
const instA = createA(stub.dependencies(names));
instA.bind();
const N = docA.net();
ok("A 对照：健康绑定成功且真的挂上了监听器（N>1）",
  instA.isBound() === true && N > 1, JSON.stringify({ bound: instA.isBound(), N: N }));
console.log("    基线监听器数 N=" + N);

// B 早段失败：bindSetupReviewControls 第一次抛错（此时一个监听器都还没挂）
{
  const doc = stub.makeDom();
  const create = stub.loadEvents(source, doc);
  let setupCalls = 0;
  let netWhenEarlyThrew = -1;
  const inst = create(stub.dependencies(names, {
    bindSetupReviewControls: function() {
      setupCalls++;
      if (setupCalls === 1) {
        netWhenEarlyThrew = doc.net();          // 抛错那一刻采样：证明这确实是「早段」
        throw new Error("early bind failure");
      }
    }
  }));
  assert.throws(function() { inst.bind(); }, /early bind failure/);
  ok("B 早段：抛错确实发生在挂任何监听器之前（否则本用例没有牙齿）",
    netWhenEarlyThrew === 0, JSON.stringify({ netWhenEarlyThrew: netWhenEarlyThrew }));
  ok("B 早段：失败后 isBound() 仍是 false（不能被当成已绑好）",
    inst.isBound() === false, JSON.stringify({ bound: inst.isBound() }));
  ok("B 早段：失败后净监听器数为 0",
    doc.net() === 0, JSON.stringify({ net: doc.net() }));
  inst.bind();
  ok("B 早段：重试真的重新进入绑定流程（setupCalls===2）",
    setupCalls === 2, JSON.stringify({ setupCalls: setupCalls }));
  ok("B 早段：重试后 isBound() 为 true 且净监听器数 === N（不翻倍）",
    inst.isBound() === true && doc.net() === N,
    JSON.stringify({ bound: inst.isBound(), net: doc.net(), N: N }));
}

// C 后段失败：bindAppContent 是最后一个委托点，抛错时前面那批监听器已经挂上
{
  const doc = stub.makeDom();
  const create = stub.loadEvents(source, doc);
  let contentCalls = 0;
  let netWhenLateThrew = -1;
  const inst = create(stub.dependencies(names, {
    bindAppContent: function() {
      contentCalls++;
      if (contentCalls === 1) {
        netWhenLateThrew = doc.net();          // 抛错那一刻采样：证明这确实是「后段」
        throw new Error("late bind failure");
      }
    }
  }));
  assert.throws(function() { inst.bind(); }, /late bind failure/);
  const netAfterFail = doc.net();
  ok("C 后段：抛错确实发生在「已经挂上监听器」之后（否则本用例没有牙齿）",
    netWhenLateThrew > 1, JSON.stringify({ netWhenLateThrew: netWhenLateThrew }));
  ok("C 后段：失败后 isBound() 仍是 false",
    inst.isBound() === false, JSON.stringify({ bound: inst.isBound() }));
  ok("C 后段：失败后已挂上的监听器被回滚摘净（net===0）",
    doc.net() === 0, JSON.stringify({ net: doc.net(), netAfterFail: netAfterFail }));
  inst.bind();
  ok("C 后段：重试后净监听器数 === N 而不是 2N（重试不翻倍）",
    inst.isBound() === true && doc.net() === N,
    JSON.stringify({ bound: inst.isBound(), net: doc.net(), N: N, wouldBeDouble: 2 * N }));
}

// D 跨模块：委托子模块已绑定成功，入口后段再抛错；重试时子模块靠自身幂等标志短路
{
  const doc = stub.makeDom();
  const create = stub.loadEvents(source, doc);
  let diagBindCalls = 0;
  let diagBound = false;
  const handler = function() {};
  const diagnostics = {
    bind: function() {
      diagBindCalls++;
      if (diagBound) return;               // 子模块自身的幂等标志
      diagBound = true;
      doc.addEventListener("diag-owned", handler);
    }
  };
  let contentCalls = 0;
  const inst = create(stub.dependencies(names, {
    getDiagnostics: function() { return diagnostics; },
    bindAppContent: function() {
      contentCalls++;
      if (contentCalls === 1) throw new Error("late bind failure after delegated success");
    }
  }));
  assert.throws(function() { inst.bind(); }, /late bind failure after delegated success/);
  inst.bind();
  ok("D 跨模块：委托子模块的 bind 被调用了两次（重试确实重走了委托链）",
    diagBindCalls === 2, JSON.stringify({ diagBindCalls: diagBindCalls }));
  ok("D 跨模块：子模块自己那份监听器仍是 1 而不是 2（靠自身幂等短路）",
    doc.countType("diag-owned") === 1,
    JSON.stringify({ diagOwned: doc.countType("diag-owned") }));
}

// E 幂等：已成功后再 bind() 一次不应再挂
{
  const doc = stub.makeDom();
  const create = stub.loadEvents(source, doc);
  const inst = create(stub.dependencies(names));
  inst.bind();
  const after1 = doc.net();
  inst.bind();
  ok("E 幂等：已绑定后再调 bind() 不新增监听器",
    doc.net() === after1, JSON.stringify({ after1: after1, after2: doc.net() }));
}

console.log("PASS " + passed + " assertions");
