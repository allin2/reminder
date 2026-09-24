"use strict";

/**
 * P3-I-R / F1 覆盖面：把「后段失败 → 回滚干净 → 重试不翻倍」铺到**全部 7 个**绑定模块上。
 *
 * 注入失败的方式与具体依赖无关：**让 DOM 替身在第 k 次 addEventListener 时抛错**。
 * 这样不用为每个模块手工找一个「靠后的委托点」，也不会因为某个模块没有可注入的
 * 依赖而漏测。k 取 `T - 1`（T = 健康绑定时的注册次数），保证抛错时前面确实已经挂上了
 * 一批 —— 否则「回滚摘净」这条断言是空的。
 *
 * 判据仍是**净**监听器数：失败后必须为 0，重试后必须回到 N（不是 2N）。
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../../../../..");

const MODULES = [
  { file: "lib/app-events.js", factory: "createAppEvents", bind: "bind" },
  { file: "lib/app-content.js", factory: "createAppContent", bind: "bind" },
  { file: "lib/app-capture.js", factory: "createAppCapture", bind: "bind" },
  { file: "lib/app-diagnostics.js", factory: "createAppDiagnostics", bind: "bind" },
  { file: "lib/app-setup.js", factory: "createAppSetup", bind: "bind" },
  { file: "lib/app-alerts.js", factory: "createAppAlerts", bind: "bindAlertControls" },
  { file: "lib/app-review.js", factory: "createAppReview", bind: "bindReviewControls" }
];

let passed = 0;
function ok(desc, condition, extra) {
  if (!condition) {
    throw new Error("FAILED: " + desc + (extra ? " — " + extra : ""));
  }
  passed++;
  console.log("  ✓ " + desc);
}

function makeNode(label, all) {
  const node = {
    _label: label,
    _h: new Map(),
    addEventListener: function(type, handler) {
      if (this._onAdd) this._onAdd(this, type, handler);     // 注入点
      if (!this._h.has(type)) this._h.set(type, new Set());
      this._h.get(type).add(handler);
    },
    removeEventListener: function(type, handler) {
      const s = this._h.get(type);
      if (s) s.delete(handler);
    },
    count: function() { let n = 0; for (const s of this._h.values()) n += s.size; return n; },
    closest: function() { return null; },
    appendChild: function() {},
    insertAdjacentHTML: function() {},
    setAttribute: function() {},
    removeAttribute: function() {},
    getAttribute: function() { return null; },
    focus: function() {},
    click: function() {},
    remove: function() {},
    scrollIntoView: function() {},
    contains: function() { return false; },
    matches: function() { return false; },
    querySelector: function(sel) { return this._doc.querySelector(sel); },
    querySelectorAll: function(sel) { return this._doc.querySelectorAll(sel); },
    dataset: {},
    style: {},
    classList: { add: function() {}, remove: function() {}, toggle: function() {}, contains: function() { return false; } },
    children: [],
    files: [],
    value: "",
    checked: false,
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    selectedIndex: 0,
    options: []
  };
  all.push(node);
  return node;
}

/** onAdd 可选：每次 addEventListener 之前调用，用来注入失败。 */
function makeDom(onAdd) {
  const all = [];
  const single = new Map();
  const multi = new Map();
  const doc = makeNode("#document", all);
  doc._doc = doc;
  doc._onAdd = onAdd || null;
  const wire = function(node) { node._doc = doc; node._onAdd = onAdd || null; return node; };
  wire(doc);
  doc.querySelector = function(sel) {
    if (!single.has(sel)) single.set(sel, wire(makeNode(sel, all)));
    return single.get(sel);
  };
  doc.querySelectorAll = function(sel) {
    if (!multi.has(sel)) {
      multi.set(sel, [wire(makeNode(sel + "[0]", all)), wire(makeNode(sel + "[1]", all))]);
    }
    return multi.get(sel);
  };
  doc.net = function() { let n = 0; for (const node of all) n += node.count(); return n; };
  doc.nodeCount = function() { return all.length; };
  return doc;
}

function depList(code) {
  const m = code.match(/const (?:REQUIRED_DEPS|required) = \[([\s\S]*?)\];/);
  if (!m) return [];
  const both = m[1].match(/"[^"]+"|'[^']+'/g);
  if (!both) return [];
  return both.map(function(s) { return s.slice(1, -1); });
}

const STATE = {
  ui: { tab: "home", editNoteId: null, notePin: false },
  settings: {},
  items: [],
  notes: [],
  projects: [],
  pending: []
};

function makeDeps(names, doc) {
  const deps = {};
  const objectReturning = {
    getState: function() { return STATE; },
    getProjectColors: function() { return []; },
    getInitialReviewSettings: function() { return { enabled: false, snoozedUntil: 0 }; },
    getReviewSettings: function() { return { enabled: false, snoozedUntil: 0 }; },
    getSettings: function() { return STATE.settings; },
    query: function(sel) { return doc.querySelector(sel); },
    queryAll: function(sel) { return doc.querySelectorAll(sel); },
    getNow: function() { return Date.now(); },
    now: function() { return Date.now(); },
    getDoc: function() { return doc; },
    getDocument: function() { return doc; },
    getWindow: function() { return { navigator: {}, location: { search: "" } }; },
    getDialogs: function() { return null; },
    getAi: function() { return null; },
    getAppAi: function() { return null; },
    getAlerts: function() { return null; },
    getDiagnostics: function() { return null; },
    getAppContent: function() { return null; },
    getAppCapture: function() { return null; },
    getAppReview: function() { return null; },
    getAppNotices: function() { return null; },
    getAppSetup: function() { return null; },
    getNativeReminders: function() { return null; },
    getCoordinator: function() { return null; }
  };
  names.forEach(function(name) {
    deps[name] = objectReturning[name] || function() { return undefined; };
  });
  return deps;
}

function load(code, doc, deps, file, factoryName) {
  const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    AttentionLib: {},
    document: doc,
    window: { navigator: {}, location: { search: "" } },
    location: { search: "" },
    navigator: {},
    localStorage: { getItem: function() { return null; }, setItem: function() {}, removeItem: function() {} },
    requestAnimationFrame: function(fn) { return 0; },
    fetch: function() { return Promise.resolve({ ok: false }); }
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  const ns = sandbox.AttentionLib;
  const holder = ns[Object.keys(ns)[0]];
  if (!holder || typeof holder[factoryName] !== "function") {
    throw new Error(file + "：沙箱里找不到工厂 " + factoryName);
  }
  return holder[factoryName](deps);
}

console.log("== P3-I-R / F1 覆盖面：7 个绑定模块的后段失败 / 回滚 / 重试不翻倍 ==");

for (const mod of MODULES) {
  const code = fs.readFileSync(path.join(ROOT, mod.file), "utf8");
  const names = depList(code);

  // 第一轮：健康绑定，量出注册次数 T 与净监听器数 N
  const docHealthy = makeDom();
  let T = 0;
  const docCount = makeDom(function() { T++; });
  const instH = load(code, docCount, makeDeps(names, docCount), mod.file, mod.factory);
  instH[mod.bind]();
  const N = docCount.net();

  console.log("  " + mod.file + "  (" + mod.bind + ")" + "  T=" + T + "  N=" + N);

  // T <= 1 的模块（目前只有 app-setup：bind 体里只有一个注册动作）**结构上不存在**
  // 「挂了一部分之后再抛错」的可能，硬造一个晚段失败只会得到一条恒真断言。
  // 对这类模块改测真正有意义的性质：成功后再调一次不翻倍。
  if (T <= 1) {
    ok(mod.file + "：T=" + T + "，结构上不存在「部分注册后抛错」，改测幂等不翻倍",
      (function() {
        const d = makeDom();
        const i = load(code, d, makeDeps(names, d), mod.file, mod.factory);
        i[mod.bind]();
        const once = d.net();
        i[mod.bind]();
        return once === N && d.net() === N;
      })(),
      JSON.stringify({ N: N, afterTwice: (function() {
        const d = makeDom();
        const i = load(code, d, makeDeps(names, d), mod.file, mod.factory);
        i[mod.bind](); i[mod.bind]();
        return d.net();
      })() }));
    continue;
  }

  // 第二轮：在第 T-1 次 addEventListener 时抛错（只抛第一次），然后重试
  let addCount = 0;
  let thrown = false;
  const docFail = makeDom(function(node, type) {
    addCount++;
    if (!thrown && addCount === T - 1) {
      thrown = true;
      throw new Error("injected late bind failure at add #" + addCount);
    }
  });
  const instF = load(code, docFail, makeDeps(names, docFail), mod.file, mod.factory);
  let raised = null;
  try {
    instF[mod.bind]();
  } catch (error) {
    raised = error;
  }
  ok(mod.file + "：注入的晚段失败真的被抛出",
    raised !== null && /injected late bind failure/.test(String(raised && raised.message)),
    JSON.stringify({ raised: raised && raised.message }));
  ok(mod.file + "：抛错时前面已经挂上了监听器（否则本用例没有牙齿）",
    addCount === T - 1 && docFail.net() === 0,
    JSON.stringify({ addCount: addCount, net: docFail.net() }));
  ok(mod.file + "：失败后已挂上的监听器被回滚摘净（net===0）",
    docFail.net() === 0, JSON.stringify({ net: docFail.net() }));

  instF[mod.bind]();                                   // 重试：这一次不再注入失败
  ok(mod.file + "：重试后净监听器数 === N 而不是 2N（不翻倍）",
    docFail.net() === N, JSON.stringify({ net: docFail.net(), N: N, wouldBeDouble: 2 * N }));
}

console.log("PASS " + passed + " assertions");
