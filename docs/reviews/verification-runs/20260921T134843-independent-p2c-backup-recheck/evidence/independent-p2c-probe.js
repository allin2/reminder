"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../../../../..");
const prod = require(path.join(ROOT, "scripts/verification/production-scripts.js"));
const harness = require(path.join(ROOT, "test-boot-combination.js"));
const backupModule = require(path.join(ROOT, "lib/app-backup.js"));

const results = [];
const observations = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}
function observe(name, detail) {
  observations.push({ name, detail });
}

function makeBackupDeps(options) {
  options = options || {};
  const stateRef = options.stateRef || {
    current: {
      items: [{ id: "old" }], notes: [{ id: "n-old" }], projects: [{ id: "p-old" }],
      settings: {
        notify: true, dnd: false, importantRepeat: true,
        quietStart: "22:00", quietEnd: "07:00", dailySummary: true,
        privacyNotify: false, defaultDeliveryMode: "notification", userMode: "normal",
        ai: { enabled: true, baseUrl: "https://secret.example/v1", apiKey: "sk-secret", model: "m", autoOnSave: true }
      }
    }
  };
  const calls = { save: 0, render: 0, toast: [], confirm: 0, normalize: 0 };
  const nodes = {
    "#btnExport": { disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
    "#exportSub": { textContent: "" }
  };
  const deps = {
    getSchema: () => 7,
    getState: () => stateRef.current,
    normalizeItem: (item) => { calls.normalize++; return Object.assign({ normalized: true }, item); },
    save: () => { calls.save++; return options.saveResult ? options.saveResult() : undefined; },
    render: () => { calls.render++; },
    toast: (message) => { calls.toast.push(message); },
    confirmDialog: async () => { calls.confirm++; return options.confirm !== false; },
    query: (sel) => nodes[sel] || null,
    isNativeAndroidRuntime: () => !!options.native,
    systemBridge: () => options.bridge || null,
    getInflightActionDepth: () => options.inflight || 0
  };
  return { deps, stateRef, calls, nodes };
}

async function main() {
  const coreSource = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");
  const backupSource = fs.readFileSync(path.join(ROOT, "lib/app-backup.js"), "utf8");
  const scripts = prod.readIndexScripts(ROOT);
  const swAssets = prod.readSwAssets(ROOT);

  check(
    "生产脚本只加载一次 app-backup，且早于 app-core",
    scripts.filter(s => s === "lib/app-backup.js").length === 1 &&
      scripts.indexOf("lib/app-backup.js") < scripts.indexOf("app-core.js"),
    scripts
  );
  check(
    "Service Worker 只预缓存一次 app-backup",
    Array.isArray(swAssets) && swAssets.filter(s => s === "lib/app-backup.js").length === 1,
    swAssets
  );

  const movedFunctions = [
    "downloadFile", "buildLegacyBackupPayload", "setExportBusy", "clearPendingNativeExport",
    "noteExportAppVisibility", "isShareCancellation", "savedBackupMessage", "exportData", "importDataFile"
  ];
  const coreDefinitions = movedFunctions.filter(name =>
    new RegExp("\\b(?:async\\s+)?function\\s+" + name + "\\s*\\(").test(coreSource)
  );
  const moduleDefinitionCounts = Object.fromEntries(movedFunctions.map(name => [
    name,
    (backupSource.match(new RegExp("\\b(?:async\\s+)?function\\s+" + name + "\\s*\\(", "g")) || []).length
  ]));
  check(
    "备份行为在 app-core 无实现体、在 app-backup 各有唯一实现",
    coreDefinitions.length === 0 && Object.values(moduleDefinitionCounts).every(n => n === 1),
    { coreDefinitions, moduleDefinitionCounts }
  );

  const evalEffects = { timers: 0, listeners: 0, storage: 0, dom: 0, writes: [] };
  const namespace = new Proxy({ sentinel: true }, {
    set(target, key, value) { evalEffects.writes.push(String(key)); target[key] = value; return true; }
  });
  const moduleSandbox = {
    AttentionLib: namespace,
    setTimeout() { evalEffects.timers++; throw new Error("timer during evaluation"); },
    setInterval() { evalEffects.timers++; throw new Error("interval during evaluation"); },
    addEventListener() { evalEffects.listeners++; throw new Error("listener during evaluation"); },
    localStorage: { getItem() { evalEffects.storage++; }, setItem() { evalEffects.storage++; } },
    document: { createElement() { evalEffects.dom++; throw new Error("DOM during evaluation"); } }
  };
  moduleSandbox.self = moduleSandbox;
  moduleSandbox.globalThis = moduleSandbox;
  vm.createContext(moduleSandbox);
  let evalError = null;
  try {
    vm.runInContext(backupSource, moduleSandbox, { filename: "lib/app-backup.js" });
  } catch (error) {
    evalError = error && error.message ? error.message : String(error);
  }
  check(
    "app-backup 求值期只有命名空间导出，没有定时器、监听、存储或 DOM 副作用",
    evalError === null && evalEffects.timers === 0 && evalEffects.listeners === 0 &&
      evalEffects.storage === 0 && evalEffects.dom === 0 &&
      JSON.stringify(evalEffects.writes) === JSON.stringify(["AppBackup"]),
    { evalError, evalEffects, exports: Object.keys(namespace.AppBackup || {}).sort() }
  );

  const baselineCoverage = prod.backupInstanceCoverage(ROOT);
  const mutatedCoverage = prod.backupInstanceCoverage(ROOT, {
    source: coreSource + "\nvoid backup.independentMissing();\n"
  });
  check(
    "备份实例静态契约基线闭合",
    baselineCoverage.missingInContract.length === 0 && baselineCoverage.unusedInContract.length === 0,
    baselineCoverage
  );
  check(
    "新增未声明 backup 成员的变异会被静态契约点名",
    JSON.stringify(mutatedCoverage.missingInContract) === JSON.stringify(["independentMissing"]),
    mutatedCoverage
  );

  const withoutBackup = scripts.filter(s => s !== "lib/app-backup.js");
  const late = await harness.bootCombination({ scripts: withoutBackup });
  const initial = {
    ready: late.ready,
    failurePaths: (late.app.startupFailure() || []).map(p => p.path),
    puts: late.disk.puts,
    schedules: late.env.calls.schedule.length,
    alarms: late.env.calls.scheduleAlarm.length,
    intervals: late.intervals.slice()
  };
  check(
    "缺 app-backup 时启动 fail closed 且零持久化/排程/心跳副作用",
    initial.ready === false &&
      JSON.stringify(initial.failurePaths) === JSON.stringify(["AppBackup", "AppBackup.createAppBackup"]) &&
      initial.puts === 0 && initial.schedules === 0 && initial.alarms === 0 && initial.intervals.length === 0,
    initial
  );

  vm.runInContext(backupSource, late.sandbox, { filename: "late/lib/app-backup.js" });
  const recoveredReady = await late.app.startApp();
  await harness.wait(30);
  const recoveredExport = late.app.exportData;
  const recoveredIntervals = late.intervals.slice();
  const secondReady = await late.app.startApp();
  await harness.wait(10);
  check(
    "迟加载 app-backup 后同一页面可恢复，成功后再次启动不重复心跳",
    recoveredReady === true && secondReady === true && typeof recoveredExport === "function" &&
      late.app.startupFailure() === null &&
      JSON.stringify(late.intervals) === JSON.stringify(recoveredIntervals),
    { recoveredReady, secondReady, failure: late.app.startupFailure(), intervals: late.intervals.slice() }
  );

  const healthy = await harness.bootCombination();
  const previousExport = healthy.app.exportData;
  const originalFactory = healthy.sandbox.AttentionLib.AppBackup.createAppBackup;
  healthy.sandbox.AttentionLib.AppBackup.createAppBackup = function () { return {}; };
  const rebindProblems = healthy.app.bindRuntime();
  const afterFailedExport = healthy.app.exportData;
  healthy.sandbox.AttentionLib.AppBackup.createAppBackup = originalFactory;
  check(
    "备份工厂退化为空壳时逐项报错，失败重绑不覆盖健康实例",
    rebindProblems.length === baselineCoverage.declared.length &&
      rebindProblems.every(p => /^AppBackup\./.test(p.path)) && afterFailedExport === previousExport,
    {
      expectedCount: baselineCoverage.declared.length,
      actualCount: rebindProblems.length,
      paths: rebindProblems.map(p => p.path),
      preservedIdentity: afterFailedExport === previousExport
    }
  );

  const payloadEnv = makeBackupDeps();
  const payloadApi = backupModule.createAppBackup(payloadEnv.deps);
  const payload1 = payloadApi.buildLegacyBackupPayload();
  payloadEnv.stateRef.current = Object.assign({}, payloadEnv.stateRef.current, {
    items: [{ id: "new" }]
  });
  const payload2 = payloadApi.buildLegacyBackupPayload();
  check(
    "备份实例每次读取当前状态，并从快照排除 AI 密钥与地址",
    payload1.items[0].id === "old" && payload2.items[0].id === "new" &&
      payload2.settings.ai.baseUrl === "" && payload2.settings.ai.apiKey === "" &&
      payload2.settings.ai.model === "m",
    { firstItem: payload1.items[0], secondItem: payload2.items[0], ai: payload2.settings.ai }
  );

  const nativeEnv = makeBackupDeps({
    native: true,
    bridge: {
      async saveDocument(args) {
        nativeEnv.savedArgs = args;
        return { status: "saved", fileName: args.fileName, locationLabel: "测试位置" };
      }
    }
  });
  const nativeApi = backupModule.createAppBackup(nativeEnv.deps);
  const nativeResult = await nativeApi.exportData();
  const nativePayload = JSON.parse(nativeEnv.savedArgs.content);
  check(
    "原生导出把快照交给同一 saveDocument，并只在 saved 后宣告成功",
    nativeResult.status === "saved" && nativeEnv.savedArgs.mimeType === "application/json" &&
      nativePayload.items[0].id === "old" && nativePayload.settings.ai.apiKey === "" &&
      nativeEnv.calls.toast.some(t => /已保存/.test(t)) && nativeEnv.nodes["#btnExport"].disabled === false,
    { nativeResult, toasts: nativeEnv.calls.toast, button: nativeEnv.nodes["#btnExport"] }
  );

  const savedFileReader = global.FileReader;
  class SuccessfulReader {
    readAsText(file) {
      this.result = file.contents;
      Promise.resolve().then(() => this.onload());
    }
  }
  global.FileReader = SuccessfulReader;
  try {
    const validEnv = makeBackupDeps();
    const validApi = backupModule.createAppBackup(validEnv.deps);
    validApi.importDataFile({ contents: JSON.stringify({
      items: [{ id: "imported" }], notes: [{ id: "n" }], projects: [{ id: "p" }],
      settings: { notify: false }
    }) });
    await harness.wait(10);
    check(
      "有效导入经过确认和 normalizeItem，并走注入的 save/render",
      validEnv.calls.confirm === 1 && validEnv.calls.normalize === 1 &&
        validEnv.stateRef.current.items[0].id === "imported" &&
        validEnv.stateRef.current.items[0].normalized === true &&
        validEnv.calls.save === 1 && validEnv.calls.render === 1 &&
        validEnv.calls.toast.some(t => /导入成功/.test(t)),
      { calls: validEnv.calls, state: validEnv.stateRef.current }
    );

    const cancelledEnv = makeBackupDeps({ confirm: false });
    const cancelledBefore = JSON.stringify(cancelledEnv.stateRef.current);
    backupModule.createAppBackup(cancelledEnv.deps).importDataFile({
      contents: JSON.stringify({ items: [{ id: "must-not-land" }] })
    });
    await harness.wait(10);
    check(
      "用户取消导入时不改状态、不保存、不渲染",
      cancelledEnv.calls.confirm === 1 && JSON.stringify(cancelledEnv.stateRef.current) === cancelledBefore &&
        cancelledEnv.calls.save === 0 && cancelledEnv.calls.render === 0,
      cancelledEnv.calls
    );

    const inflightEnv = makeBackupDeps({ inflight: 1 });
    const inflightBefore = JSON.stringify(inflightEnv.stateRef.current);
    backupModule.createAppBackup(inflightEnv.deps).importDataFile({
      contents: JSON.stringify({ items: [{ id: "must-not-land" }] })
    });
    await harness.wait(10);
    check(
      "事务在途时导入被拒绝且不改状态",
      JSON.stringify(inflightEnv.stateRef.current) === inflightBefore && inflightEnv.calls.save === 0 &&
        inflightEnv.calls.toast.some(t => /正在保存/.test(t)),
      inflightEnv.calls
    );
  } finally {
    if (savedFileReader === undefined) delete global.FileReader;
    else global.FileReader = savedFileReader;
  }

  const readErrorEnv = makeBackupDeps();
  class ErrorReader {
    readAsText() {
      Promise.resolve().then(() => { if (typeof this.onerror === "function") this.onerror(new Error("read failed")); });
    }
  }
  global.FileReader = ErrorReader;
  try {
    backupModule.createAppBackup(readErrorEnv.deps).importDataFile({});
    await harness.wait(10);
  } finally {
    if (savedFileReader === undefined) delete global.FileReader;
    else global.FileReader = savedFileReader;
  }
  observe(
    "FileReader 读取失败没有用户反馈（迁移前已有，P2-C 未修）",
    { toasts: readErrorEnv.calls.toast, save: readErrorEnv.calls.save, render: readErrorEnv.calls.render }
  );

  let settleSave = null;
  const pendingSave = new Promise(resolve => { settleSave = resolve; });
  const pendingEnv = makeBackupDeps({ saveResult: () => pendingSave });
  global.FileReader = SuccessfulReader;
  try {
    backupModule.createAppBackup(pendingEnv.deps).importDataFile({
      contents: JSON.stringify({ items: [{ id: "pending-save" }] })
    });
    await harness.wait(10);
  } finally {
    settleSave();
    if (savedFileReader === undefined) delete global.FileReader;
    else global.FileReader = savedFileReader;
  }
  observe(
    "导入在持久化 Promise 兑现前即提示成功（迁移前已有，P2-C 未修）",
    {
      saveCalls: pendingEnv.calls.save,
      successToastBeforeCommit: pendingEnv.calls.toast.some(t => /导入成功/.test(t)),
      renderBeforeCommit: pendingEnv.calls.render
    }
  );

  const failed = results.filter(r => !r.pass);
  const report = {
    root: ROOT,
    generatedAt: new Date().toISOString(),
    passed: results.length - failed.length,
    failed: failed.length,
    results,
    observations
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (failed.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
