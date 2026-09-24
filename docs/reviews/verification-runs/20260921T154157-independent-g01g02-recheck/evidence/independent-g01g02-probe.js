"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../../../..");
const source = fs.readFileSync(path.join(ROOT, "lib/app-backup.js"), "utf8");

function loadModule(code) {
  const module = { exports: {} };
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

function makeReader() {
  function FakeReader() {
    this.onload = null;
    this.onerror = null;
    this.onabort = null;
    FakeReader.last = this;
  }
  FakeReader.last = null;
  FakeReader.prototype.readAsText = function () {};
  return FakeReader;
}

function makeEnv(saveImpl) {
  const state = { items: [], notes: [], projects: [], settings: {} };
  const calls = { toast: [], render: 0, confirm: 0, save: 0 };
  return {
    state,
    calls,
    deps: {
      getSchema: () => 7,
      getState: () => state,
      normalizeItem: x => Object.assign({ normalized: true }, x),
      save: () => { calls.save++; return saveImpl(); },
      render: () => { calls.render++; },
      toast: message => { calls.toast.push(message); },
      confirmDialog: async () => { calls.confirm++; return true; },
      query: () => null,
      isNativeAndroidRuntime: () => false,
      systemBridge: () => null,
      getInflightActionDepth: () => 0
    }
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function exercise(mod) {
  const savedReader = global.FileReader;
  const Reader = makeReader();
  global.FileReader = Reader;
  const out = {};
  try {
    let resolveSave;
    const pending = new Promise(resolve => { resolveSave = resolve; });
    const env = makeEnv(() => pending);
    const api = mod.createAppBackup(env.deps);
    api.importDataFile({ name: "pending.json" });
    Reader.last.result = JSON.stringify({ items: [{ id: "pending" }] });
    Reader.last.onload();
    await flush();
    out.pending = {
      successBeforeCommit: env.calls.toast.some(x => /导入成功/.test(x)),
      renderBeforeCommit: env.calls.render,
      stateIds: env.state.items.map(x => x.id)
    };
    resolveSave();
    await flush();
    out.resolved = {
      lastToast: env.calls.toast[env.calls.toast.length - 1] || "",
      render: env.calls.render
    };

    const rejected = makeEnv(() => {
      const pending = Promise.reject(new Error("independent-save-failure"));
      // 变异体去掉 await 后会遗失这条拒绝；预挂一个观测处理器，避免 Node 把
      // 「变异确实漏接拒绝」转成进程级未处理异常，掩盖下面更精确的行为差异。
      pending.catch(() => {});
      return pending;
    });
    const rejectedApi = mod.createAppBackup(rejected.deps);
    rejectedApi.importDataFile({ name: "reject.json" });
    Reader.last.result = JSON.stringify({ items: [{ id: "rejected" }, { id: "kept" }] });
    Reader.last.onload();
    await flush();
    out.rejected = {
      lastToast: rejected.calls.toast[rejected.calls.toast.length - 1] || "",
      allToasts: rejected.calls.toast.slice(),
      stateIds: rejected.state.items.map(x => x.id),
      render: rejected.calls.render
    };

    const readEnv = makeEnv(async () => {});
    const readApi = mod.createAppBackup(readEnv.deps);
    readApi.importDataFile({ name: "error.json" });
    out.readerHandlers = {
      onerror: typeof Reader.last.onerror,
      onabort: typeof Reader.last.onabort
    };
    if (typeof Reader.last.onerror === "function") Reader.last.onerror();
    readApi.importDataFile({ name: "abort.json" });
    if (typeof Reader.last.onabort === "function") Reader.last.onabort();
    out.readerResult = {
      toasts: readEnv.calls.toast.slice(),
      confirm: readEnv.calls.confirm,
      save: readEnv.calls.save,
      render: readEnv.calls.render
    };
  } finally {
    if (savedReader === undefined) delete global.FileReader;
    else global.FileReader = savedReader;
  }
  return out;
}

function verdict(out) {
  return {
    pendingNoSuccess: out.pending.successBeforeCommit === false,
    pendingNoRender: out.pending.renderBeforeCommit === 0,
    memoryChangedBeforeCommit: JSON.stringify(out.pending.stateIds) === JSON.stringify(["pending"]),
    successAfterResolve: out.resolved.lastToast === "导入成功 · 1 条事项" && out.resolved.render === 1,
    rejectSpecific: out.rejected.lastToast === "导入失败 · 数据未能保存，请重新导入",
    rejectNoWrongMessages: !out.rejected.allToasts.some(x => /导入成功|文件格式不正确/.test(x)),
    rejectKeepsMemory: JSON.stringify(out.rejected.stateIds) === JSON.stringify(["rejected", "kept"]),
    rejectNoRender: out.rejected.render === 0,
    readerHandlersPresent: out.readerHandlers.onerror === "function" && out.readerHandlers.onabort === "function",
    readerMessages: JSON.stringify(out.readerResult.toasts) === JSON.stringify([
      "导入失败：文件读取失败，请重试", "导入失败 · 文件读取已取消"
    ]),
    readerStopsBeforeConfirmAndSave: out.readerResult.confirm === 0 && out.readerResult.save === 0 && out.readerResult.render === 0
  };
}

(async function () {
  const current = await exercise(loadModule(source));
  const currentVerdict = verdict(current);

  const mutantSource = source
    .replace("await deps.save();", "deps.save();")
    .replace(/^\s*reader\.onerror\s*=.*$/m, "")
    .replace(/^\s*reader\.onabort\s*=.*$/m, "");
  const mutationApplied = mutantSource !== source &&
    mutantSource.indexOf("await deps.save();") < 0 &&
    mutantSource.indexOf("reader.onerror =") < 0 && mutantSource.indexOf("reader.onabort =") < 0;
  const mutant = await exercise(loadModule(mutantSource));
  const mutantVerdict = verdict(mutant);

  const currentFailures = Object.keys(currentVerdict).filter(k => !currentVerdict[k]);
  const mutantFailures = Object.keys(mutantVerdict).filter(k => !mutantVerdict[k]);
  const report = {
    mutationApplied,
    current: { behavior: current, verdict: currentVerdict, failures: currentFailures },
    mutant: { behavior: mutant, verdict: mutantVerdict, failures: mutantFailures },
    passed: mutationApplied && currentFailures.length === 0 &&
      mutantFailures.includes("pendingNoSuccess") &&
      mutantFailures.includes("pendingNoRender") &&
      mutantFailures.includes("readerHandlersPresent") &&
      mutantFailures.includes("readerMessages")
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (!report.passed) process.exitCode = 1;
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
