/*
 * H-07 存储降级探测器 —— 「IDB 打不开 → 后端整体降级为 localStorage 镜像」这条路径
 * 会不会把降级期间的改动静默丢掉。
 *
 *   node scripts/verification/storage-degrade-probe.js
 *
 * 复现的是真机上最常见的那一种形态：IndexedDB **打不开**（配额/私有模式/数据库损坏），
 * 于是 lib/storage.js 的 ensure() 整体切到 backend="local"，此后所有写入都只落镜像 ——
 * 注意这条路上 `storageReady` 仍然是 true，所以它**不走** app-core 的降级分支。
 * 下一次启动 IDB 恢复正常时，loadAsync 从 IDB 读到**旧值**，镜像里的新改动就没有了。
 *
 * 三段取证：
 *   ① 降级期写入必须留下待回放凭据；
 *   ② IDB 恢复后必须采用该凭据作为权威状态，并写回 IDB、清掉凭据；
 *   ③ **对照**：手动删掉凭据 → 新改动丢失（这就是缺陷本身，用来证明 ② 不是巧合）。
 *
 * 反向验证：把 app-core 的 authoritativeBackendMissing() 改成恒假（等于只覆盖「读抛错」
 * 那一条路径），① ② 必须变红、③ 仍然复现 —— 见 docs/decisions 的 D47。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");
const BOOK = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");
const LIBS = ["lib/parse-cn.js", "lib/repeat.js", "lib/reminder.js", "lib/storage.js"]
  .map(rel => [rel, fs.readFileSync(path.join(ROOT, rel), "utf8")]);

let passed = 0;
let failed = 0;
function ok(name, condition, extra) {
  if (condition) { passed++; console.log("  ✓ " + name); }
  else { failed++; console.log("  ✗ " + name + (extra ? " — " + extra : "")); }
}

/* ---------- 假 IndexedDB：支持「打不开」与「能开」两种形态 ---------- */
function createIdb(options) {
  options = options || {};
  const data = new Map(options.seed || []);
  const stores = new Set(["kv"]);
  let broken = !!options.broken;
  const fake = {
    open() {
      const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      setTimeout(() => {
        if (broken) {
          req.error = new Error("idb-open-failed");
          if (req.onerror) req.onerror();
          return;
        }
        req.result = {
          objectStoreNames: { contains: name => stores.has(name) },
          createObjectStore(name) { stores.add(name); return {}; },
          transaction(store, mode) {
            const tx = { error: null, oncomplete: null, onerror: null };
            tx.objectStore = () => ({
              get(key) {
                const r = { result: undefined, error: null, onsuccess: null, onerror: null };
                setTimeout(() => {
                  r.result = data.has(key) ? data.get(key) : undefined;
                  if (r.onsuccess) r.onsuccess();
                }, 0);
                return r;
              },
              put(value, key) {
                setTimeout(() => {
                  data.set(key, value);
                  if (tx.oncomplete) tx.oncomplete();
                }, 0);
                return { onsuccess: null, onerror: null };
              }
            });
            return tx;
          }
        };
        if (req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    }
  };
  return { fake, data, heal() { broken = false; } };
}

/* ---------- 每个阶段一个全新的应用实例（模块级 storageReady 不跨实例） ---------- */
function createApp(options) {
  const store = options.localStorage;
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear()
  };
  const nodes = new Map();
  const el = id => ({
    id, hidden: false, disabled: false, textContent: "", innerHTML: "", value: "", className: "",
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    focus() {}, click() {}, appendChild() {}, remove() {}, insertBefore() {}
  });
  const document = {
    readyState: "complete",
    visibilityState: "visible",
    addEventListener() {},
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, el(sel)); return nodes.get(sel); },
    querySelectorAll() { return []; },
    createElement() { return el("tmp"); },
    body: { appendChild() {}, insertBefore() {} }
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Date, Math, JSON, Object, Array, String, Number, Boolean, Set, Map, Promise, Error, RegExp,
    parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, URLSearchParams,
    Blob: function () {}, File: function () {}, FileReader: function () {},
    history: { replaceState() {} },
    location: { search: "", pathname: "/index.html", href: "http://localhost/index.html" },
    localStorage,
    indexedDB: options.indexedDB || undefined,
    document,
    navigator: { onLine: true, serviceWorker: undefined, vibrate() {}, share: undefined, canShare: undefined, setAppBadge: undefined },
    window: { addEventListener() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    fetch: async () => { throw new Error("no network in probe"); }
  };
  sandbox.globalThis = sandbox;
  sandbox.window = Object.assign(sandbox.window, sandbox);
  vm.createContext(sandbox);
  LIBS.forEach(([rel, code]) => vm.runInContext(code, sandbox, { filename: rel }));
  vm.runInContext(BOOK, sandbox, { filename: "app-core.js" });
  const app = sandbox.__ATTENTION_INBOX__;
  if (!app) throw new Error("app-core 未暴露测试钩子");
  return app;
}

const KEY = "attention-inbox-v2";
const PENDING = "attention-inbox-v2-pending-replay";
const OLD_ITEM = { id: "i_old", title: "旧事项（IDB 里的那份）", status: "waiting", triggerAt: 1790000000000, rev: 1 };
const oldPayload = () => ({
  schema: 5, items: [Object.assign({}, OLD_ITEM)], notes: [], projects: [], settings: {}
});

async function run() {
  console.log("\n== H-07 存储降级探测 ==");

  /* ① 降级阶段：IDB 打不开，用户照常改东西 */
  const localStore = new Map();
  localStore.set(KEY, JSON.stringify(oldPayload()));
  const downIdb = createIdb({ broken: true });
  const appDown = createApp({ localStorage: localStore, indexedDB: downIdb.fake });
  await appDown.loadAsync();
  ok("降级期读取走镜像（读到既有事项）", appDown.state.items.length === 1);

  appDown.state.items.push(appDown.makeItem({ title: "降级期新增", status: "waiting", triggerAt: Date.now() + 60000 }));
  await appDown.saveAsync();

  const mirrorAfter = JSON.parse(localStore.get(KEY));
  ok("降级期写入仍然成功（用户可见行为不变）",
    mirrorAfter.items.some(i => i.title === "降级期新增"), JSON.stringify(mirrorAfter.items.map(i => i.title)));
  ok("① 降级期写入留下待回放凭据（H-07 的修复点）",
    localStore.has(PENDING) &&
    JSON.parse(localStore.get(PENDING)).json.indexOf("降级期新增") >= 0,
    localStore.has(PENDING) ? "凭据已写" : "凭据缺失");

  /* ② 恢复阶段：IDB 能开了，但里面还是**旧值** */
  const upIdb = createIdb({ seed: [[ "state", oldPayload() ]] });
  const appUp = createApp({ localStorage: localStore, indexedDB: upIdb.fake });
  await appUp.loadAsync();
  ok("② IDB 恢复后采用待回放快照（降级期改动没丢）",
    appUp.state.items.some(i => i.title === "降级期新增"),
    JSON.stringify(appUp.state.items.map(i => i.title)));
  const idbAfter = upIdb.data.get("state");
  ok("② 新状态已写回权威后端（IDB）",
    !!idbAfter && idbAfter.items.some(i => i.title === "降级期新增"),
    JSON.stringify((idbAfter || {}).items ? idbAfter.items.map(i => i.title) : null));
  ok("② 重放成功后凭据被清除", !localStore.has(PENDING));

  /* ③ 对照：把凭据删掉 —— 正是修复前的那条路径，改动必然静默消失 */
  const controlStore = new Map();
  controlStore.set(KEY, JSON.stringify(mirrorAfter)); // 镜像里有新事项
  const controlIdb = createIdb({ seed: [["state", oldPayload()]] });
  const appControl = createApp({ localStorage: controlStore, indexedDB: controlIdb.fake });
  await appControl.loadAsync();
  ok("③ 对照（无凭据）：IDB 旧值覆盖镜像 → 降级期改动静默丢失（缺陷复现）",
    !appControl.state.items.some(i => i.title === "降级期新增"),
    JSON.stringify(appControl.state.items.map(i => i.title)));
  ok("③ 对照证明 ② 不是巧合：差别只在待回放凭据",
    controlStore.get(KEY).indexOf("降级期新增") >= 0 && !controlStore.has(PENDING));

  console.log("\n========== 结果 ==========");
  console.log("通过: " + passed + "  失败: " + failed);
  if (failed) {
    console.log("失败项:" + failed);
    process.exit(1);
  }
  console.log("全部通过。");
}

run().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
