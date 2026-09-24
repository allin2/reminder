"use strict";

/**
 * F1 反例共用的 DOM 替身与模块装载器。
 *
 * 要点：
 *   · 模块用 `typeof document !== "undefined"` 拿 DOM，所以 document 必须**进 vm 沙箱**，
 *     只在宿主的 global 上挂是不够的（宿主 global 与 vm context 不是同一个全局对象）。
 *   · 记的是**净**监听器数（add 减 remove），只看 add 次数会把「挂了两遍没摘」判成绿。
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../../../../..");
const REL = "lib/app-events.js";

function readSource() {
  return fs.readFileSync(path.join(ROOT, REL), "utf8");
}

function depNames(code) {
  return code.match(/const REQUIRED_DEPS = \[([\s\S]*?)\];/)[1]
    .match(/"[^"]+"/g).map(JSON.parse);
}

function makeNode(label, all) {
  const node = {
    _label: label,
    _h: new Map(),
    addEventListener: function(type, handler) {
      if (!this._h.has(type)) this._h.set(type, new Set());
      this._h.get(type).add(handler);
    },
    removeEventListener: function(type, handler) {
      const s = this._h.get(type);
      if (s) s.delete(handler);
    },
    count: function() {
      let n = 0;
      for (const s of this._h.values()) n += s.size;
      return n;
    },
    countType: function(type) {
      const s = this._h.get(type);
      return s ? s.size : 0;
    },
    dataset: {},
    style: {},
    classList: {
      add: function() {}, remove: function() {}, toggle: function() {},
      contains: function() { return false; }
    },
    children: [],
    value: "",
    checked: false,
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false
  };
  all.push(node);
  return node;
}

function makeDom() {
  const all = [];
  const single = new Map();
  const multi = new Map();
  const doc = makeNode("#document", all);
  doc.querySelector = function(sel) {
    if (!single.has(sel)) single.set(sel, makeNode(sel, all));
    return single.get(sel);
  };
  doc.querySelectorAll = function(sel) {
    if (!multi.has(sel)) {
      multi.set(sel, [makeNode(sel + "[0]", all), makeNode(sel + "[1]", all)]);
    }
    return multi.get(sel);
  };
  doc.net = function() {
    let n = 0;
    for (const node of all) n += node.count();
    return n;
  };
  return doc;
}

/** 把 app-events.js（或变异版）装进沙箱，并把 document 注入进去。 */
function loadEvents(code, doc, extras) {
  const sandbox = Object.assign({
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    AttentionLib: {},
    document: doc
  }, extras || {});
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: REL });
  return sandbox.AttentionLib.AppEvents.createAppEvents;
}

function dependencies(names, overrides) {
  const deps = {};
  names.forEach(function(name) { deps[name] = function() {}; });
  deps.getState = function() {
    return { ui: { tab: "home" }, settings: {}, items: [], projects: [] };
  };
  return Object.assign(deps, overrides || {});
}

module.exports = { ROOT: ROOT, REL: REL, readSource: readSource, depNames: depNames, makeDom: makeDom, loadEvents: loadEvents, dependencies: dependencies };
