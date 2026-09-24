"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../../../../..");
const prod = require(path.join(ROOT, "scripts/verification/production-scripts.js"));
const harness = require(path.join(ROOT, "test-boot-combination.js"));

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}

async function main() {
  const coreSource = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");
  const aiSource = fs.readFileSync(path.join(ROOT, "lib/app-ai.js"), "utf8");
  const scripts = prod.readIndexScripts(ROOT);
  const swAssets = prod.readSwAssets(ROOT);

  check(
    "生产脚本只加载一次 app-ai，且早于 app-core",
    scripts.filter(s => s === "lib/app-ai.js").length === 1 &&
      scripts.indexOf("lib/app-ai.js") < scripts.indexOf("app-core.js"),
    scripts
  );
  check(
    "Service Worker 只预缓存一次 app-ai",
    Array.isArray(swAssets) && swAssets.filter(s => s === "lib/app-ai.js").length === 1,
    swAssets
  );

  const movedPureFunctions = ["extractJsonObject", "normalizeAiResult", "localIsoWithOffset"];
  const coreDefinitions = movedPureFunctions.filter(name =>
    new RegExp("\\bfunction\\s+" + name + "\\s*\\(").test(coreSource)
  );
  const moduleDefinitionCounts = Object.fromEntries(movedPureFunctions.map(name => [
    name,
    (aiSource.match(new RegExp("\\bfunction\\s+" + name + "\\s*\\(", "g")) || []).length
  ]));
  check(
    "迁移的纯函数在 app-core 无实现体、在 app-ai 各有唯一实现",
    coreDefinitions.length === 0 && Object.values(moduleDefinitionCounts).every(n => n === 1),
    { coreDefinitions, moduleDefinitionCounts }
  );
  const movedInstanceFunctions = [
    "chat", "parseCapture", "polishCapture", "testConnection", "applyToForm",
    "mergedDraft", "runOnCapture", "openAiSheet", "saveAiSettings", "renderAiSub"
  ];
  const coreInstanceDefinitions = movedInstanceFunctions.filter(name =>
    new RegExp("\\b(?:async\\s+)?function\\s+" + name + "\\s*\\(").test(coreSource)
  );
  const moduleInstanceDefinitionCounts = Object.fromEntries(movedInstanceFunctions.map(name => [
    name,
    (aiSource.match(new RegExp("\\b(?:async\\s+)?function\\s+" + name + "\\s*\\(", "g")) || []).length
  ]));
  check(
    "迁移的 AI 实例行为在 app-core 无实现体、在 app-ai 各有唯一实现",
    coreInstanceDefinitions.length === 0 &&
      Object.values(moduleInstanceDefinitionCounts).every(n => n === 1),
    { coreInstanceDefinitions, moduleInstanceDefinitionCounts }
  );

  const evalEffects = { fetch: 0, timers: 0, listeners: 0, storage: 0, writes: [] };
  const namespace = new Proxy({ sentinel: true }, {
    set(target, key, value) {
      evalEffects.writes.push(String(key));
      target[key] = value;
      return true;
    }
  });
  const moduleSandbox = {
    AttentionLib: namespace,
    fetch() { evalEffects.fetch++; throw new Error("fetch during evaluation"); },
    setTimeout() { evalEffects.timers++; throw new Error("timer during evaluation"); },
    setInterval() { evalEffects.timers++; throw new Error("interval during evaluation"); },
    addEventListener() { evalEffects.listeners++; throw new Error("listener during evaluation"); },
    localStorage: {
      getItem() { evalEffects.storage++; throw new Error("storage read during evaluation"); },
      setItem() { evalEffects.storage++; throw new Error("storage write during evaluation"); }
    }
  };
  moduleSandbox.self = moduleSandbox;
  moduleSandbox.globalThis = moduleSandbox;
  vm.createContext(moduleSandbox);
  let evalError = null;
  try {
    vm.runInContext(aiSource, moduleSandbox, { filename: "lib/app-ai.js" });
  } catch (error) {
    evalError = error && error.message ? error.message : String(error);
  }
  check(
    "app-ai 求值期只有命名空间导出，没有请求、定时器、监听或存储副作用",
    evalError === null && evalEffects.fetch === 0 && evalEffects.timers === 0 &&
      evalEffects.listeners === 0 && evalEffects.storage === 0 &&
      JSON.stringify(evalEffects.writes) === JSON.stringify(["AppAi"]),
    { evalError, evalEffects, exports: Object.keys(namespace.AppAi || {}).sort() }
  );

  const baselineCoverage = prod.aiInstanceCoverage(ROOT);
  const mutatedCoverage = prod.aiInstanceCoverage(ROOT, {
    source: coreSource + "\nvoid ai.independentMissing();\n"
  });
  check(
    "AI 实例静态契约基线闭合",
    baselineCoverage.missingInContract.length === 0 && baselineCoverage.unusedInContract.length === 0,
    baselineCoverage
  );
  check(
    "新增未声明 ai 成员的变异会被静态契约点名",
    mutatedCoverage.missingInContract.length === 1 &&
      mutatedCoverage.missingInContract[0] === "independentMissing",
    mutatedCoverage
  );

  const withoutAi = scripts.filter(s => s !== "lib/app-ai.js");
  const late = await harness.bootCombination({ scripts: withoutAi });
  const initial = {
    ready: late.ready,
    failurePaths: (late.app.startupFailure() || []).map(p => p.path),
    puts: late.disk.puts,
    schedules: late.env.calls.schedule.length,
    alarms: late.env.calls.scheduleAlarm.length,
    intervals: late.intervals.slice()
  };
  check(
    "缺 app-ai 时启动 fail closed 且零持久化/排程/心跳副作用",
    initial.ready === false && initial.failurePaths.length === 4 &&
      initial.failurePaths.every(p => /^AppAi(?:\.|$)/.test(p)) &&
      initial.puts === 0 && initial.schedules === 0 && initial.alarms === 0 && initial.intervals.length === 0,
    initial
  );

  vm.runInContext(aiSource, late.sandbox, { filename: "late/lib/app-ai.js" });
  const recoveredReady = await late.app.startApp();
  await harness.wait(30);
  const recoveredAi = late.app.ai;
  const recoveredIntervals = late.intervals.slice();
  const secondReady = await late.app.startApp();
  await harness.wait(10);
  check(
    "迟加载 app-ai 后同一页面可重试成功，并绑定当前模块实例",
    recoveredReady === true && secondReady === true && recoveredAi &&
      typeof recoveredAi.runOnCapture === "function" && late.app.startupFailure() === null,
    {
      recoveredReady,
      secondReady,
      failure: late.app.startupFailure(),
      intervals: late.intervals.slice(),
      puts: late.disk.puts
    }
  );
  check(
    "成功后的再次 startApp 不重复注册心跳",
    JSON.stringify(late.intervals) === JSON.stringify(recoveredIntervals),
    { recoveredIntervals, afterSecondStart: late.intervals.slice() }
  );

  const healthy = await harness.bootCombination();
  const previousAi = healthy.app.ai;
  const originalFactory = healthy.sandbox.AttentionLib.AppAi.createAppAi;
  healthy.sandbox.AttentionLib.AppAi.createAppAi = function () { return {}; };
  const rebindProblems = healthy.app.bindRuntime();
  const afterFailedRebind = healthy.app.ai;
  healthy.sandbox.AttentionLib.AppAi.createAppAi = originalFactory;
  const expectedAiMembers = baselineCoverage.declared.length;
  check(
    "AI 工厂退化为空壳时逐项报错，失败重绑不覆盖健康实例",
    rebindProblems.length === expectedAiMembers &&
      rebindProblems.every(p => /^AppAi\./.test(p.path)) && afterFailedRebind === previousAi,
    {
      expectedCount: expectedAiMembers,
      actualCount: rebindProblems.length,
      paths: rebindProblems.map(p => p.path),
      preservedIdentity: afterFailedRebind === previousAi
    }
  );

  const failed = results.filter(r => !r.pass);
  const report = {
    root: ROOT,
    generatedAt: new Date().toISOString(),
    passed: results.length - failed.length,
    failed: failed.length,
    results
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (failed.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
