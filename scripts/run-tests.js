#!/usr/bin/env node
/* 体检 P1-16：逐套件运行并汇总退出码。
 *
 * 原来的 `npm test` 用 `&&` 串起 15 个脚本 —— 第一环崩了后面全部不执行，
 * 交接同事看到的是「整个项目测试挂了」，而不是「哪一套挂了」。
 * 这里每套都跑完，最后列出失败清单；任一失败则整体退出码非 0。
 */
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const SUITES = [
  "test-unit.js",
  "test-secure-ai-key.js",
  "test-punctual-default.js",
  "test-native-reminders.js",
  "scripts/verification/p3a-model-tests.js",
  "scripts/verification/p3b-persistence-tests.js",
  "scripts/verification/p3c-transaction-tests.js",
  "scripts/verification/p3d-items-tests.js",
  "scripts/verification/p3e-coordinator-tests.js",
  "scripts/verification/p3f-review-tests.js",
  "scripts/verification/p3g-alerts-tests.js",
  "scripts/verification/p3h-platform-tests.js",
  "scripts/verification/p3i-modularization-tests.js",
  "test-boot-combination.js",
  "test-smoke.js",
  "test-regressions.js",
  "scripts/verification/parse-single-source.js"
];

const only = process.argv.slice(2);
const selected = only.length ? SUITES.filter(s => only.some(o => s.includes(o))) : SUITES;
const results = [];

selected.forEach(suite => {
  const started = Date.now();
  console.log("\n######## " + suite + " ########");
  const res = spawnSync(process.execPath, [path.join(root, suite)], { cwd: root, stdio: "inherit" });
  const code = res.status == null ? 1 : res.status;
  results.push({ suite, code, signal: res.signal, ms: Date.now() - started });
});

console.log("\n================ test summary ================");
results.forEach(r => {
  console.log((r.code === 0 ? "  ✓ " : "  ✗ ") + r.suite +
    (r.code === 0 ? "" : "  (exit " + r.code + (r.signal ? ", " + r.signal : "") + ")") +
    "  " + r.ms + "ms");
});
const failed = results.filter(r => r.code !== 0);
console.log("套件: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length ? 1 : 0);
