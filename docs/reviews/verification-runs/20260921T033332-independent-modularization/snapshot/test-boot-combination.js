/* O1：**生产脚本组合**的启动测试。
 *
 * 与另外四套的关系（每套只回答一个问题，不重叠）：
 *   · `test-unit.js`       —— lib 里的纯逻辑（Node 直接 require）；
 *   · `test-native-reminders.js` —— 直接驱动 `lib/native-reminders.js` 的平台行为；
 *   · `test-smoke.js` / `test-regressions.js` —— app-core 在**受控外设**下的业务行为
 *     （它们按需注入模块，平台 mock 全在沙箱内）；
 *   · **本文件** —— 「`index.html` 里那批脚本（当前 9 支）、按那个顺序、真的能起来吗」。
 *
 * 为什么这一条必须单独存在：app-core 取模块用的是 `AttentionXxx || {}`。于是
 * 「脚本没加载」和「加载了但顺序错了」在这一层**都不报错**，只是所有原生能力
 * 静默变成 undefined，而四套断言照旧全绿。两个 harness 与生产组合的漂移（S-03）
 * 就是这么活下来的。所以这里做三件在别处做不到的事：
 *   1. **期望集合从 `index.html` 推导**，并在启动前先判它合法（未知脚本 / 缺文件 /
 *      顺序错 / app-core 不在最后 / 加载期依赖倒置），且用**坏清单**做反向对照；
 *   2. 在**隔离上下文里按同一顺序加载同一组合**，让模块真的执行一次
 *      （不像别的 harness 那样注入替身），并断言导出与应用 ready；
 *   3. 挂一个**可控 Android 桥**，从真实初始化/生命周期入口观察监听注册、一次排程、
 *      相同计划再对账不重排 —— 这是「原生链路真的被用到了」唯一的活证据。
 *
 * 计数（同步请求数 / 对账轮数 / 桥调用次数 / 首页容器重写次数）都在这里做，
 * 因为只有这里跑的是真实启动链。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;
const prod = require(path.join(ROOT, "scripts/verification/production-scripts.js"));

/**
 * 生产组合的**有序契约**（P1 起 9 支 → P2 起 11 支；新增/改名 `lib/*.js` 必须在这里显式过目）。
 *
 * 这里刻意**不**写成「从 index.html 推出来再和自己比」—— 那是恒真断言，拔掉生产链
 * 也不会变红。契约要独立写死，让「有人往 index.html 加了一支脚本却忘了改契约」
 * 变成一次可见失败。数量由本数组长度派生出，不再散落 8/9 这种魔术数字。
 */
const EXPECTED_INDEX_SCRIPTS = [
  "lib/date-utils.js",        // 日历原语唯一来源，必须最先
  "lib/ui-format.js",         // UI 纯格式化（依赖 date-utils，紧随其后）
  "lib/app-ui.js",            // 共用展示能力（无加载期依赖，见 index.html 注释）
  "lib/parse-cn.js",
  "lib/repeat.js",
  "lib/reminder.js",
  "lib/storage.js",
  "lib/feedback.js",
  "lib/delivery-evidence.js",
  "lib/native-reminders.js",
  "app-core.js"               // 装配入口，永远最后
];

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, condition, extra) {
  if (condition) {
    passed++;
    console.log("  ✓ " + name);
  } else {
    failed++;
    failures.push(name + (extra ? " — " + extra : ""));
    console.log("  ✗ " + name + (extra ? " — " + extra : ""));
  }
}

function section(name) {
  console.log("\n== " + name + " ==");
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ---------- 沙箱：DOM 带写入计数，平台 mock 与模块同处一个 global ---------- */

/**
 * 计数型 DOM 元素。
 *
 * `innerHTML` 用访问器而不是普通字段 —— 「无显示变化的一拍**不替换卡片节点**」这句话
 * 只能靠「这个容器被写了几次」来证明；只数渲染函数被调用几次，会把
 * 「函数跑了但没写 DOM」和「函数跑了也写了 DOM」混为一谈。
 */
function makeNode(id) {
  let html = "";
  const node = {
    id,
    hidden: false,
    disabled: false,
    textContent: "",
    value: "",
    className: "",
    style: {},
    dataset: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, on) {
        if (on === undefined) on = !this._s.has(c);
        if (on) this._s.add(c); else this._s.delete(c);
        return on;
      },
      contains(c) { return this._s.has(c); }
    },
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, focus() {}, click() {},
    appendChild(child) { INSERTIONS.push(id); if (child) child.parentNode = node; return child; },
    remove() { if (node.parentNode) node.parentNode = null; },
    insertBefore(child) { INSERTIONS.push(id); if (child) child.parentNode = node; return child; },
    scrollIntoView() {}
  };
  Object.defineProperty(node, "innerHTML", {
    get() { return html; },
    set(v) {
      html = String(v == null ? "" : v);
      WRITES.total++;
      WRITES.byId[id] = (WRITES.byId[id] || 0) + 1;
    },
    enumerable: true,
    configurable: true
  });
  return node;
}

const WRITES = { total: 0, byId: {} };
/**
 * 节点**插入**次数（`appendChild` / `insertBefore` 落在哪个容器上）。
 *
 * 「启动失败面板真的被插进首页容器了」这句话不能只看 `innerHTML` 计数 ——
 * 面板走的是 `createElement` + `insertBefore`，全程不碰 `innerHTML`。
 */
const INSERTIONS = [];
/** `document.createElement(tag)` 建过哪些标签（失败面板的「无控件」判据要用）。 */
const CREATED = [];
/** 写进 `createElement` 出来的节点的 `textContent`（失败面板的文案判据）。 */
const CREATED_TEXT = [];
function resetWrites() {
  WRITES.total = 0;
  WRITES.byId = {};
  INSERTIONS.length = 0;
  CREATED.length = 0;
  CREATED_TEXT.length = 0;
}

/**
 * 可控 Android 桥。
 *
 * `addListenerContract` 明确区分两种真机契约：
 *   · `"handle"`  —— Android JSExport + `native-bridge.js` 的 `cap.addListener` 同步 `return`
 *     一个普通 `{ remove }` 对象（**没有** `.then`/`.catch`）；
 *   · `"promise"` —— 官方 `@capacitor/core` 的 `capacitor.js` 契约，返回 Promise。
 * 两种都必须能起来：`lib/native-reminders.js` 的 `listenSafely` 与 `initialize` 都要
 * `Promise.resolve(handle)` 归一化，否则真机上会抛
 * `TypeError: addListener(...).catch is not a function`。
 */
function createAndroidEnv(options) {
  options = options || {};
  const contract = options.addListenerContract || "handle";
  const calls = {
    actionTypes: [], channels: [], appListeners: [], bridgeListeners: [],
    localListeners: [], schedule: [], scheduleAlarm: [], cancelAlarm: [],
    cancelNotification: [], getPending: 0, permissionChecks: 0,
    activeAlarms: [], stopAlarmDelivery: []
  };
  const listeners = { alarmAction: null, appStateChange: null, localAction: null, delivered: null };
  let pendingNotifications = [];

  function listenerHandle(slot, callback) {
    if (slot) listeners[slot] = callback;
    const handle = { remove: async () => { if (slot) listeners[slot] = null; } };
    return contract === "promise" ? Promise.resolve(handle) : handle;
  }

  const local = {
    async checkPermissions() { calls.permissionChecks++; return { display: "granted" }; },
    async requestPermissions() { return { display: "granted" }; },
    async checkExactNotificationSetting() { return { exact_alarm: "granted" }; },
    async changeExactNotificationSetting() { return { exact_alarm: "granted" }; },
    async createChannel(channel) { calls.channels.push(channel); },
    async registerActionTypes(value) { calls.actionTypes.push(value); },
    // 真机契约：同步返回句柄，不是 Promise
    addListener(name, callback) {
      calls.localListeners.push(name);
      if (name === "localNotificationActionPerformed") return listenerHandle("localAction", callback);
      if (name === "localNotificationReceived") return listenerHandle("delivered", callback);
      return listenerHandle(null, callback);
    },
    async getPending() { calls.getPending++; return { notifications: pendingNotifications.slice() }; },
    async schedule(value) {
      calls.schedule.push(value.notifications.slice());
      pendingNotifications = pendingNotifications.concat(value.notifications);
      return { notifications: value.notifications.map(n => ({ id: n.id })) };
    },
    async cancel(value) {
      const ids = new Set(value.notifications.map(n => n.id));
      pendingNotifications = pendingNotifications.filter(n => !ids.has(n.id));
    },
    async removeDeliveredNotifications() {}
  };

  const app = {
    addListener(name, callback) {
      calls.appListeners.push(name);
      return listenerHandle(name === "appStateChange" ? "appStateChange" : null, callback);
    }
  };

  const bridge = {
    async scheduleAlarm(value) {
      calls.scheduleAlarm.push(value);
      return { ok: true, id: value.id, mode: "alarmClock", triggerAt: Date.now() + (Number(value.delayMs) || 10000) };
    },
    async scheduleAt(value) {
      calls.scheduleAlarm.push(value);
      return { ok: true, id: value.id, mode: "alarmClock", triggerAt: Number(value.at) };
    },
    async cancelAlarm(value) { calls.cancelAlarm.push(value); return { ok: true }; },
    async cancelNotification(value) { calls.cancelNotification.push(value); return { ok: true }; },
    // 全屏未显示时的补救入口：`refreshActiveAlarmPanel` 用它取在途投递，
    // 「已提交快照」的语义就在这条链上可观察（见 C7）。
    async activeAlarmDeliveries() { return { alarms: calls.activeAlarms.slice() }; },
    async stopAlarmDelivery(value) { calls.stopAlarmDelivery.push(value); return { ok: true }; },
    async consumeAlarmAction() { return null; },
    async ackAlarmAction() { return { ok: true }; },
    async diagnose() {
      return {
        notificationsEnabled: true, postNotificationsGranted: true,
        canExactAlarm: true, ignoringBatteryOptimizations: true
      };
    }
  };

  return {
    contract: contract,
    calls: calls,
    listeners: listeners,
    capacitor: {
      getPlatform() { return "android"; },
      Plugins: { LocalNotifications: local, App: app, SystemBridge: bridge, AppSettings: {} }
    },
    fireResume() { if (listeners.appStateChange) listeners.appStateChange({ isActive: true }); }
  };
}

/**
 * 在隔离上下文里按给定清单加载生产组合。
 *
 * `options.scripts` 缺省 = 从 `index.html` 推导的清单（**默认就是生产组合**）；
 * 传坏清单就是反向对照，用来证明启动前的判定真的抓得住。
 */
function loadCombination(options) {
  options = options || {};
  const scripts = options.scripts || prod.readIndexScripts(ROOT);
  const env = createAndroidEnv(options);
  const nodes = new Map();
  // `failWrites`：让权威后端（IndexedDB）事务失败 —— 用来观察
  // 「提交失败时已提交快照没有被提前发布」这条契约（C7）。
  // `failWrites`：让权威后端（IndexedDB）事务失败 —— 用来观察
  // 「提交失败时已提交快照没有被提前发布」这条契约（C8）。
  // `holdWrites`：把事务**停在半路**（put 已发出、oncomplete 未回调）——
  // 用来观察「提交时刻取的独立快照」是否真的与内存解耦（C7 后半段）。
  const disk = {
    idbValue: null, puts: 0, failWrites: false, holdWrites: false, held: [],
    releaseWrites() {
      const pending = disk.held.splice(0, disk.held.length);
      pending.forEach(fn => fn());
      return pending.length;
    }
  };
  const ls = new Map();
  const intervals = [];

  function getNode(sel) {
    if (!nodes.has(sel)) nodes.set(sel, makeNode(sel));
    return nodes.get(sel);
  }

  const localStorage = {
    getItem(k) { return ls.has(k) ? ls.get(k) : null; },
    setItem(k, v) { ls.set(k, String(v)); },
    removeItem(k) { ls.delete(k); },
    clear() { ls.clear(); }
  };

  const fakeDb = {
    objectStoreNames: { contains: () => true },
    transaction() {
      const tx = { oncomplete: null, onerror: null, error: null };
      tx.objectStore = () => ({
        get() {
          const req = {};
          setTimeout(() => { req.result = disk.idbValue; if (req.onsuccess) req.onsuccess(); }, 0);
          return req;
        },
        put(value) {
          disk.puts++;
          const landed = JSON.parse(JSON.stringify(value));
          const finish = () => {
            disk.idbValue = landed;
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
          };
          if (disk.failWrites) {
            setTimeout(() => {
              tx.error = new Error("idb-commit-failed");
              if (tx.onerror) tx.onerror();
            }, 0);
            return;
          }
          if (disk.holdWrites) { disk.held.push(finish); return; }
          finish();
        }
      });
      return tx;
    }
  };
  const indexedDB = {
    open() {
      const req = {};
      setTimeout(() => { req.result = fakeDb; if (req.onsuccess) req.onsuccess(); }, 0);
      return req;
    }
  };

  const document = {
    readyState: "complete",
    visibilityState: "visible",
    addEventListener(name, fn) { (docListeners[name] = docListeners[name] || []).push(fn); },
    removeEventListener() {},
    // `getElementById("main")` 与 `querySelector("#main")` 必须落在**同一个**节点对象上，
    // 否则「面板插进了哪个容器」会被一个假的差异骗过去。
    getElementById(sel) { return getNode("#" + sel); },
    querySelector(sel) { return getNode(sel); },
    querySelectorAll() { return []; },
    createElement(tag) {
      // 「失败面板里没有可编辑控件」「面板上真的写了哪一支没起来」只能靠**建了哪些标签 +
      // 写了哪些文字**来证 —— 面板走 createElement + textContent，全程不碰 innerHTML，
      // 所以 innerHTML 计数看不到它。
      CREATED.push(String(tag == null ? "" : tag).toLowerCase());
      const node = makeNode("tmp");
      let text = "";
      Object.defineProperty(node, "textContent", {
        get() { return text; },
        set(v) { text = String(v == null ? "" : v); CREATED_TEXT.push(text); },
        enumerable: true,
        configurable: true
      });
      return node;
    },
    body: { appendChild() {} }
  };

  // O5：JSON.parse / stringify 的**调用次数**必须可数 ——
  // 「正常保存少一次全量 parse」这句话只能靠计数证明，耗时数字在 Node 上没有分辨力。
  const JSONCount = { parse: 0, stringify: 0 };
  const JSONWrap = Object.create(JSON);
  JSONWrap.parse = function () { JSONCount.parse++; return JSON.parse.apply(JSON, arguments); };
  JSONWrap.stringify = function () { JSONCount.stringify++; return JSON.stringify.apply(JSON, arguments); };
  const docListeners = {};

  // 收集沙箱内的 `console.error`：启动闸门失败时会打日志，那本身是**要断言的事实**
  // （「不是只 console.error」不等于「连 console.error 都没有」），但不该刷屏。
  const consoleErrors = [];
  const sandboxConsole = {
    log: (...a) => console.log(...a),
    warn: (...a) => console.warn(...a),
    info: (...a) => console.log(...a),
    debug: () => {},
    error: (...a) => { consoleErrors.push(a.map(x => (x && x.message) || String(x)).join(" ")); },
    trace: () => {}, table: () => {}, dir: () => {}
  };

  const sandbox = {
    console: sandboxConsole, Date, Math, JSON: JSONWrap, Object, Array, String, Number, Boolean, Set, Map,
    WeakMap, Promise, Error, RegExp, Symbol,
    parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, URLSearchParams,
    Blob: function () {}, File: function () {}, FileReader: function () {},
    URL: Object.assign(
      function URL(url) { return new (require("url").URL)(url); },
      { createObjectURL: () => "blob:test", revokeObjectURL: () => {} }
    ),
    setTimeout, clearTimeout, setInterval: (fn, ms) => { intervals.push(ms); return intervals.length; },
    clearInterval,
    history: { replaceState() {} },
    // `search` 必须在脚本求值**之前**就位：`init()` 里的 `applyShareParams()` /
    // `handleQueryActions()` 是在被求值那一刻读 `location.search` 的。
    location: {
      search: options.search || "",
      pathname: "/index.html",
      href: "http://localhost/index.html" + (options.search || "")
    },
    localStorage, indexedDB, document,
    navigator: {
      onLine: true, serviceWorker: undefined, vibrate() {},
      share: undefined, canShare: undefined, setAppBadge: undefined
    },
    Notification: undefined,
    fetch: async () => { throw new Error("no network in tests"); },
    globalThis: null
  };
  // `window` 就是全局对象本身，所以窗口级事件注册必须也挂在全局上
  // （app-core 的 `window.addEventListener("error", …)` 与 bindNetwork 的
  //   online/offline/blur/focus 都走这里）。
  sandbox.addEventListener = function () {};
  sandbox.removeEventListener = function () {};
  sandbox.dispatchEvent = function () { return true; };
  sandbox.globalThis = sandbox;
  // 浏览器里 `window` **就是**全局对象本身，不是一份拷贝。
  // 这一条在这里是有牙齿的：app-core 读 `window.Capacitor`，而原生模块读
  // `globalThis.Capacitor`。若把 window 做成快照拷贝，两边会看到不同的对象，
  // 「平台 mock 生效了没有」就变成不可判定的事。
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.Capacitor = env.capacitor;

  vm.createContext(sandbox);

  // O4：`Array.prototype.find` 的**谓词比较次数**必须可数。
  //
  // 这里必须拿到 **VM realm 自己的** `Array.prototype` —— 沙箱对象上的 `Array` 只是
  // 全局绑定（`vm.createContext` 之后它指向宿主 realm 的 Array），而 VM 里的数组字面量
  // `[]` 走的是 realm 内建的 `%Array.prototype%`。补宿主那份对 `state.items` 毫无影响，
  // 只会得到「0 次比较」这种恒真结论。
  vm.runInContext([
    "(function () {",
    "  if (globalThis.__FIND_METER__) return;",
    "  var proto = Object.getPrototypeOf([]);",
    "  var native = proto.find;",
    "  var stats = { calls: 0, preds: 0, bigCalls: 0, bigPreds: 0, bigMaxLen: 0, samples: [] };",
    "  proto.find = function (pred, thisArg) {",
    "    var len = this.length;",
    "    var n = 0;",
    "    var out = native.call(this, function (v, i, a) { n++; return pred.call(thisArg, v, i, a); }, thisArg);",
    "    stats.calls++; stats.preds += n;",
    "    if (len >= 64) {",
    "      stats.bigCalls++; stats.bigPreds += n;",
    "      if (len > stats.bigMaxLen) stats.bigMaxLen = len;",
    "      if (stats.samples.length < 6) stats.samples.push({ len: len, preds: n });",
    "    }",
    "    return out;",
    "  };",
    "  globalThis.__FIND_METER__ = stats;",
    "})();"
  ].join("\n"), sandbox, { filename: "find-meter.js" });
  const findMeter = sandbox.__FIND_METER__;

  // 「上一次运行留下的数据」必须在脚本求值**之前**就位 ——
  // app-core 是在被求值的那一刻自动 startApp() 的，之后再写 localStorage 就晚了。
  if (options.seedState) {
    ls.set("attention-inbox-v2", JSON.stringify(options.seedState));
  }

  const loaded = [];
  const loadErrors = [];
  scripts.forEach(src => {
    // `overrides`：把生产清单里的某个脚本名映射到另一个文件 ——
    // 「同一组合、同一 harness，只换 app-core.js」是优化前后复杂度对照的唯一诚实做法
    // （不许照抄一份旧实现重写进测试里自证）。
    const overridden = options.overrides && options.overrides[src];
    const file = overridden ? path.resolve(ROOT, overridden) : path.join(ROOT, src);
    if (!fs.existsSync(file)) {
      loadErrors.push("missing-file:" + src);
      return;
    }
    try {
      vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: src });
      loaded.push(src);
    } catch (error) {
      loadErrors.push("eval-failed:" + src + ":" + (error && error.message ? error.message : String(error)));
    }
  });

  return {
    sandbox: sandbox,
    env: env,
    disk: disk,
    localStorage: localStorage,
    /** localStorage 里到底有几个键、各占多少字节（§6「记录实际键数与写入量」）。 */
    localStorageKeys() {
      const out = {};
      ls.forEach((v, k) => { out[k] = String(v).length; });
      return out;
    },
    scripts: scripts,
    loaded: loaded,
    loadErrors: loadErrors,
    intervals: intervals,
    insertions: INSERTIONS,
    created: CREATED,
    createdText: CREATED_TEXT,
    consoleErrors: consoleErrors,
    jsonCount: JSONCount,
    /** O4：`Array.prototype.find` 的谓词比较计数（`big*` = 长度 ≥64 的数组）。 */
    findMeter: findMeter,
    resetFindMeter() {
      findMeter.calls = 0; findMeter.preds = 0;
      findMeter.bigCalls = 0; findMeter.bigPreds = 0;
      findMeter.bigMaxLen = 0; findMeter.samples.length = 0;
    },
    /** 触发真实的窗口/文档生命周期入口（`visibilitychange` 是所有前台补偿的入口）。 */
    fireDocumentEvent(name) {
      (docListeners[name] || []).forEach(fn => fn({ type: name }));
    },
    node(sel) { return getNode(sel); },
    /** 到目前为止各容器被重写的次数（用来证明「这一拍真的没写 DOM」）。 */
    writesNow() { return Object.assign({}, WRITES.byId); },
    exportOf(name) { return sandbox[name]; }
  };
}

/** 启动一次生产组合并等 `ready()`。返回启动期各容器被写入的次数。 */
async function bootCombination(options) {
  resetWrites();
  const h = loadCombination(options);
  const app = h.sandbox.__ATTENTION_INBOX__;
  const readyValue = app ? await app.ready() : false;
  await wait(30); // 让启动期的异步提交与桥调用落定
  return Object.assign(h, {
    app: app,
    ready: readyValue,
    bootWrites: Object.assign({}, WRITES.byId),
    bootWritesTotal: WRITES.total
  });
}

/* ------------------------------------------------------------------ */

async function run() {
  const indexScripts = prod.readIndexScripts(ROOT);

  /* ---------- A. 生产组合清单本身：从 index.html 推导并逐条判定 ---------- */
  section("A. 生产组合清单从 index.html 推导（未知脚本 / 缺文件 / 顺序 / 加载期依赖）");
  {
    ok("index.html 的脚本集合与顺序与契约逐项相符（" + EXPECTED_INDEX_SCRIPTS.length + " 支）",
      JSON.stringify(indexScripts) === JSON.stringify(EXPECTED_INDEX_SCRIPTS),
      JSON.stringify(indexScripts));
    ok("全部脚本形状合法且文件存在", prod.inspectList(ROOT, indexScripts).length === 0,
      JSON.stringify(prod.inspectList(ROOT, indexScripts)));
    ok("app-core.js 是最后一支（它在 IIFE 开头就取全局模块）",
      indexScripts[indexScripts.length - 1] === "app-core.js");
    // 加载期依赖：每一条声明都必须在**真实生产顺序**里成立 —— 不是只看第 [0] 条。
    // 例：lib/parse-cn.js / lib/repeat.js 求值时就把 AttentionLib.DatePrimitives 抓进
    // 闭包常量（拿不到直接抛错，不再退回另一套日历算法）；lib/native-reminders.js 同理
    // 抓 lib/reminder.js 的 deadlineStageKey/Points。
    {
      const violations = (prod.LOAD_TIME_DEPENDENCIES || []).filter(dep =>
        indexScripts.indexOf(dep.script) < 0 ||
        dep.requires.some(req => indexScripts.indexOf(req) < 0 ||
          indexScripts.indexOf(req) > indexScripts.indexOf(dep.script)));
      ok("全部 " + (prod.LOAD_TIME_DEPENDENCIES || []).length +
        " 条加载期依赖在真实生产顺序里都成立（不只是第一条）",
        violations.length === 0, JSON.stringify(violations.map(v => v.script)));
    }

    section("A2. 反向对照：坏清单必须被明确判错（不是「长度对不上」）");
    const negSwap = prod.inspectList(ROOT, ["lib/native-reminders.js", "lib/reminder.js", "app-core.js"]);
    ok("顺序倒置 ⇒ 报 load-order（真实后果：截止保护只剩 p24 一个阶段）",
      negSwap.length === 1 && /^load-order:lib\/native-reminders\.js/.test(negSwap[0]),
      JSON.stringify(negSwap));
    // 负向夹具必须把**其它**依赖一并带上，否则报出来的是「夹具自己缺件」而不是被考察的那条。
    // 「未知脚本」用 `scripts/` 下的真实文件：它存在、但不是运行时脚本（形状不合法）。
    const negUnknown = prod.inspectList(ROOT,
      ["lib/date-utils.js", "lib/parse-cn.js", "scripts/verification/parse-single-source.js", "app-core.js"]);
    ok("未知脚本 ⇒ 报 unknown-script",
      negUnknown.length === 1 && /^unknown-script:/.test(negUnknown[0]), JSON.stringify(negUnknown));
    const negMissing = prod.inspectList(ROOT,
      ["lib/date-utils.js", "lib/parse-cn.js", "lib/does-not-exist.js", "app-core.js"]);
    ok("缺失文件 ⇒ 报 missing-file",
      negMissing.length === 1 && /^missing-file:lib\/does-not-exist\.js$/.test(negMissing[0]),
      JSON.stringify(negMissing));
    // P1 新增的加载期依赖也得**拔得掉、变得红** —— 光加声明不算数。
    const negPrimitiveLate = prod.inspectList(ROOT,
      ["lib/parse-cn.js", "lib/date-utils.js", "app-core.js"]);
    ok("日历原语被排到解析器之后 ⇒ 报 load-order:lib/parse-cn.js（新声明有牙齿）",
      negPrimitiveLate.length === 1 && /^load-order:lib\/parse-cn\.js/.test(negPrimitiveLate[0]),
      JSON.stringify(negPrimitiveLate));
    const negPrimitiveGone = prod.inspectList(ROOT, ["lib/parse-cn.js", "app-core.js"]);
    ok("日历原语整支缺席 ⇒ 报 missing-load-time-dependency:lib/parse-cn.js",
      negPrimitiveGone.some(p => /^missing-load-time-dependency:lib\/parse-cn\.js -> lib\/date-utils\.js$/.test(p)),
      JSON.stringify(negPrimitiveGone));
    const negFirst = prod.inspectList(ROOT, ["app-core.js", "lib/parse-cn.js"]);
    ok("app-core 不在最后 ⇒ 同时报 app-core-not-last 与 lib-after-app-core",
      negFirst.some(p => /^app-core-not-last:/.test(p)) && negFirst.some(p => /^lib-after-app-core:/.test(p)),
      JSON.stringify(negFirst));
    ok("整份清单里没有 app-core ⇒ 报 missing-app-core",
      prod.inspectList(ROOT, ["lib/parse-cn.js"]).indexOf("missing-app-core") >= 0);
    const negDup = prod.inspectList(ROOT, ["lib/parse-cn.js", "lib/parse-cn.js", "app-core.js"]);
    ok("重复加载同一支 ⇒ 报 duplicate-script",
      negDup.indexOf("duplicate-script:lib/parse-cn.js") >= 0, JSON.stringify(negDup));
  }

  /* ---------- A3. 四处清单收口：SW 预缓存 + 打包复制链 ---------- */
  section("A3. 预缓存与打包链必须覆盖同一份清单（四件套的收口断言）");
  {
    const pre = prod.precacheProblems(ROOT);
    ok("sw.js 的 ASSETS 覆盖 index.html 加载的每一支脚本", pre.length === 0, JSON.stringify(pre));
    ok("sw.js 的 ASSETS 里没有磁盘上不存在的条目",
      pre.filter(p => /^precache-missing-file:/.test(p)).length === 0, JSON.stringify(pre));
    const pack = prod.packagingProblems(ROOT);
    ok("scripts/sync-www.js 会把每支运行时脚本/目录复制进 www/", pack.length === 0, JSON.stringify(pack));
  }

  /* ---------- A4. 另外两套 harness 的组合覆盖：把「隐形缺口」变成被检查的声明 ---------- */
  section("A4. test-smoke.js / test-regressions.js 加载了哪些生产脚本（缺口必须是被声明的，不能是隐形的）");
  {
    const sets = prod.readHarnessLoadSets(ROOT);
    ok("两套 harness 的加载清单都可从源码推导出来（不是空数组）",
      sets["test-smoke.js"].length > 0 && sets["test-regressions.js"].length > 0,
      JSON.stringify(sets));

    Object.keys(sets).forEach(name => {
      const loaded = sets[name];
      // ① harness 不许「自创」生产脚本名 —— 加载的每一条都必须在 index.html 的清单里
      const invented = loaded.filter(s => indexScripts.indexOf(s) < 0);
      ok(name + " 加载的脚本都在生产清单里（没有自创/拼错的脚本名）",
        invented.length === 0, JSON.stringify(invented));
      // ② 缺口必须是**恰好这一个**。谁改了列表，这里就变红，必须重新交代。
      const missing = indexScripts.filter(s => loaded.indexOf(s) < 0);
      ok(name + " 相对生产组合的缺口恰好是 lib/native-reminders.js（有意的、已声明的缺席）",
        missing.length === 1 && missing[0] === "lib/native-reminders.js",
        JSON.stringify(missing));
      // ③ 覆盖判定必须真的把它报出来 —— 这就是「声明」有牙齿的证据
      const cov = prod.coverageProblems({ root: ROOT, loaded: loaded });
      ok(name + " 的缺口被 coverageProblems 如实报成 unaccounted-production-script",
        cov.problems.length === 1 &&
        cov.problems[0].indexOf("unaccounted-production-script:lib/native-reminders.js") === 0,
        JSON.stringify(cov.problems));
      // ④ 顺序：app-core 必须是最后一支（前面那些 harness 也是 vm 里加载的同一个 app-core）
      ok(name + " 里 app-core.js 排在最后",
        loaded[loaded.length - 1] === "app-core.js", JSON.stringify(loaded));
    });

    // 这个缺口的**补位**就在本文件：B 段用真实组合加载了 lib/native-reminders.js，
    // 并用「删掉它」的反向对照证明缺口是静默的。这一条把两件事绑在一起，
    // 免得有人看到上面「有缺口」就以为没人管。
    ok("缺口有明确补位：本 harness（B 段）加载完整生产清单，含 lib/native-reminders.js",
      prod.readIndexScripts(ROOT).indexOf("lib/native-reminders.js") >= 0 &&
      prod.readIndexScripts(ROOT).length === EXPECTED_INDEX_SCRIPTS.length);
    // 反向对照：假如某套 harness 少声明加载一支却不说明理由，覆盖判定必须报错 ——
    // 「声明了」不等于「声明有效」。这里用一个**没有 why** 的注入声明来证明。
    const bogus = prod.coverageProblems({
      root: ROOT,
      loaded: sets["test-smoke.js"],
      injections: { "lib/native-reminders.js": {} }   // 有对象、但没有 why
    });
    ok("反向对照：只放一个**没有理由**的注入声明不算交代，仍然报错",
      bogus.problems.length === 1 &&
      bogus.problems[0].indexOf("unaccounted-production-script") === 0,
      JSON.stringify(bogus.problems));
  }

  /* ---------- B. 生产组合真的能起来 ---------- */
  section("B. 生产组合在隔离上下文里加载同一顺序，导出与 ready 都要成立");
  let boot = null;
  {
    boot = await bootCombination();
    ok("生产清单的 " + EXPECTED_INDEX_SCRIPTS.length + " 支脚本全部加载成功",
      boot.loaded.length === EXPECTED_INDEX_SCRIPTS.length && boot.loadErrors.length === 0,
      JSON.stringify(boot.loadErrors));
    ok("应用 ready() === true（启动链跑到底）", boot.ready === true);
    ok("测试钩子导出存在", !!(boot.app && boot.app.state && boot.app.renderHome));
    // 「加载成功」不等于「模块真的在」。app-core 取的是 `AttentionNativeReminders || {}`，
    // 所以必须逐个点名断言导出对象里有那几支真正被用到的函数。
    const nat = boot.exportOf("AttentionNativeReminders");
    ok("AttentionNativeReminders 是**真实现**（不是 undefined / 不是空对象）",
      !!nat && typeof nat.reconcile === "function" && typeof nat.initialize === "function" &&
      typeof nat.buildDesired === "function" && typeof nat.onAlarmAction === "function" &&
      typeof nat.getDeliveryEvidence === "function");
    const lib = boot.exportOf("AttentionLib");
    ok("AttentionLib 带 Feedback 与 DeliveryEvidence 两套纯逻辑（app-core 的 FeedbackLib/EvidenceLib 来源）",
      !!lib && !!lib.Feedback && !!lib.DeliveryEvidence &&
      typeof lib.createStorage === "function" && typeof lib.deadlineStagePoints === "function");

    // P1 唯一来源：生产入口（app-core 的测试钩子）必须**就是** lib 里那一个函数对象。
    // 只断言「行为一致」不够 —— 两份副本各改一版也可能一致；这里断言同一性，
    // 谁在 app-core 里再抄一份规则，这条立刻变红。
    ok("解析器唯一来源：app-core.parseChineseTime === AttentionLib.parseChineseTime（同一函数对象，不是同名副本）",
      boot.app.parseChineseTime === lib.parseChineseTime);
    ok("周期推进唯一来源：app-core.nextRepeatTrigger === AttentionLib.nextRepeatTrigger",
      boot.app.nextRepeatTrigger === lib.nextRepeatTrigger);
    ok("周期标签唯一来源：app-core.repeatLabel === AttentionLib.repeatLabel",
      boot.app.repeatLabel === lib.repeatLabel);
    // 日历原语同理：lib/parse-cn.js 与 lib/repeat.js 在求值时就抓 AttentionLib.DatePrimitives，
    // 两处必须拿到**同一个**命名空间对象，否则又是「顺序决定跑哪套算法」的静默换规则。
    ok("日历原语唯一来源：AttentionLib.DatePrimitives 存在且带两种 nthWeekdayOfNextMonth 语义",
      !!lib.DatePrimitives &&
      typeof lib.DatePrimitives.nthWeekdayOfNextMonthByInstant === "function" &&
      typeof lib.DatePrimitives.nthWeekdayOfNextMonthByDay === "function");
    ok("app-core 暴露的两种 nthWeekdayOfNextMonth 直接来自该命名空间（没有中间副本）",
      boot.app.nthWeekdayOfNextMonthByInstant === lib.DatePrimitives.nthWeekdayOfNextMonthByInstant &&
      boot.app.nthWeekdayOfNextMonthByDay === lib.DatePrimitives.nthWeekdayOfNextMonthByDay);
    // 反向对照：把日期原语整支拿掉，`parse-cn` / `repeat` 求值时抓不到就必须**当场抛错**，
    // 而不是悄悄退回另一套日历算法。这是「静默替代已清除」的活证据。
    {
      const noPrimitives = indexScripts.filter(s => s !== "lib/date-utils.js");
      const bootNoPrim = await bootCombination({ scripts: noPrimitives });
      ok("反向对照：抽掉 lib/date-utils.js 后 parse-cn/repeat 求值即失败（不再静默换一套日历算法）",
        bootNoPrim.loadErrors.length >= 1 &&
        bootNoPrim.loadErrors.some(e => /date-utils|DatePrimitives|日历原语/.test(String(e))),
        JSON.stringify(bootNoPrim.loadErrors));
    }

    ok("隔离上下文里 window 就是全局对象本身（平台 mock 与模块看到同一个 Capacitor）",
      boot.sandbox.window === boot.sandbox && boot.sandbox.Capacitor === boot.env.capacitor);
    ok("IDB 后端真的被用上了（证明 app-core 抓到的 Lib 是加载进沙箱的那一份）",
      boot.disk.puts >= 1, "idb puts=" + boot.disk.puts);
    // 反向对照：同一份代码、把 attention-evidence 那一支拿掉（模拟「四件套漏一处」），
    // 应用**照样**能 ready —— 这正是缺口静默的原因，所以判定必须由组合清单来做。
    const dropped = indexScripts.filter(s => s !== "lib/native-reminders.js");
    const bootNoNative = await bootCombination({ scripts: dropped });
    ok("反向对照：去掉 lib/native-reminders.js 后应用仍然 ready（缺口是静默的，必须靠清单判定拦住）",
      bootNoNative.ready === true);
    ok("反向对照：去掉之后 AttentionNativeReminders 确实是 undefined（app-core 只能走 `|| {}` 降级）",
      bootNoNative.exportOf("AttentionNativeReminders") === undefined);
    const cov = prod.coverageProblems({ root: ROOT, loaded: dropped });
    ok("反向对照：覆盖判定把它报成 unaccounted-production-script（不是「数量对不上」）",
      cov.problems.length === 1 &&
      cov.problems[0].indexOf("unaccounted-production-script:lib/native-reminders.js") === 0,
      JSON.stringify(cov.problems));
    // 反向对照二：把 app-core 提到 lib 之前。它**不抛错**，只是把 AttentionLib 抓成 undefined。
    const appFirst = ["app-core.js"].concat(indexScripts.filter(s => s !== "app-core.js"));
    const bootAppFirst = await bootCombination({ scripts: appFirst });
    ok("反向对照：app-core 在 lib 之前时不抛错（所以只能靠清单顺序判定拦住）",
      bootAppFirst.loadErrors.length === 0, JSON.stringify(bootAppFirst.loadErrors));
    ok("反向对照：顺序倒置后 app-core 抓到的 Lib 是空的 ⇒ 存储后端没建起来（IDB 一次都没写）",
      bootAppFirst.disk.puts === 0, "idb puts=" + bootAppFirst.disk.puts);
    ok("反向对照：证据模块也就位不了 ⇒ 详情页「提醒结果」这一行直接消失",
      bootAppFirst.app.detailReminderStatusRow({ id: "x", reminderEvents: {} }) === "" &&
      boot.app.detailReminderStatusRow({ id: "x", reminderEvents: {} }) !== "");
    ok("反向对照：顺序判定同时报出 app-core-not-last",
      prod.inspectList(ROOT, appFirst).some(p => /^app-core-not-last:/.test(p)));
  }

  /* ---------- B2. P1：装配依赖矩阵闭合 + 启动闸门（缺模块必须可见地失败） ---------- */
  section("B2. P1 装配闸门：唯一来源矩阵闭合，缺模块时明确失败且不进入业务启动");
  {
    // ① 矩阵闭合：app-core 里**每一个** Lib.* / DatePrimitives.* 引用都必须在声明表里。
    //    这条比「启动正常」强 —— 闸门只保护它列出来的东西，漏声明的引用它根本看不见。
    const cov = prod.runtimeDependencyCoverage(ROOT);
    ok("app-core 引用的每个 Lib/DatePrimitives 符号都在必需导出声明表里（矩阵闭合）",
      cov.undeclared.length === 0, JSON.stringify(cov.undeclared));
    ok("声明表本身非空且至少覆盖日期原语与解析器（防止「把表删空」也能过）",
      cov.declared.length >= 25 &&
      cov.declared.indexOf("parseChineseTime") >= 0 &&
      cov.declared.indexOf("DatePrimitives.startOfDay") >= 0,
      "declared=" + cov.declared.length);

    // ② 反向对照：塞一个**未声明**的引用，闭合判定必须变红（否则①是恒真断言）。
    const baseSource = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");
    const injected = prod.runtimeDependencyCoverage(ROOT, {
      source: baseSource.replace("  function uid() {",
        "  function uid() {\n    if (Lib.brandNewThing) return Lib.brandNewThing();")
    });
    ok("反向对照：新增一个未声明的 Lib.brandNewThing 引用 ⇒ 闭合判定报出来",
      injected.undeclared.length === 1 && injected.undeclared[0].path === "brandNewThing",
      JSON.stringify(injected.undeclared));
    // ③ 反向对照二：注释里提到未声明符号**不该**误报（否则开发者会被逼着给注释里的例子进表）。
    const commented = prod.runtimeDependencyCoverage(ROOT, {
      source: baseSource.replace("  function uid() {",
        "  function uid() {\n    // 举例：Lib.commentOnlyThing 只是文档里的例子\n")
    });
    ok("反向对照：注释里的 Lib.commentOnlyThing 不被误报（剥注释真的生效）",
      commented.undeclared.length === 0, JSON.stringify(commented.undeclared));

    // ④ 正向：干净的生产组合下，闸门判定为「无问题」，ready 为 true。
    const clean = await bootCombination();
    ok("正向：完整生产组合下启动闸门无问题（startupFailure() === null）",
      clean.app.startupFailure() === null, JSON.stringify(clean.app.startupFailure()));
    ok("正向：完整生产组合下 ready() === true", clean.ready === true);
    ok("正向：闸门声明表通过测试钩子可读、且条目数与源码一致",
      Array.isArray(clean.app.REQUIRED_RUNTIME_EXPORTS) &&
      clean.app.REQUIRED_RUNTIME_EXPORTS.length >= 25,
      "n=" + (clean.app.REQUIRED_RUNTIME_EXPORTS || []).length);

    // ⑤ 关键反例：抽掉解析器。**不能只是「不 ready」** ——
    //    必须同时证明「没读库、没迁移、没排钟、没起业务定时器」，否则用户会看到
    //    一个能点、能输入、却永不落库的界面（这正是本项要消灭的形态）。
    const noParser = indexScripts.filter(s => s !== "lib/parse-cn.js");
    const bootNoParser = await bootCombination({ scripts: noParser });
    ok("反例：抽掉 lib/parse-cn.js ⇒ ready() 明确失败（false），不是挂起也不是假装成功",
      bootNoParser.ready === false);
    ok("反例：startupFailure() 点名是 parseChineseTime 缺失（且说明后果）",
      Array.isArray(bootNoParser.app.startupFailure()) &&
      bootNoParser.app.startupFailure().some(p => p.path === "parseChineseTime") &&
      /中文时间解析唯一来源/.test(bootNoParser.app.startupFailure().find(p => p.path === "parseChineseTime").why),
      JSON.stringify(bootNoParser.app.startupFailure() && bootNoParser.app.startupFailure().map(p => p.path)));
    ok("反例：未读库/未迁移 ⇒ IDB 一次都没写（不会出现「以为保存了」的界面）",
      bootNoParser.disk.puts === 0, "idb puts=" + bootNoParser.disk.puts);
    ok("反例：未启动业务定时器 ⇒ 既没有 15 秒心跳、也没有 2 秒闹钟轮询",
      bootNoParser.intervals.indexOf(15000) < 0 && bootNoParser.intervals.indexOf(2000) < 0,
      JSON.stringify(bootNoParser.intervals));
    ok("反例：失败面板真的被插进了首页容器（不是只 console.error）",
      bootNoParser.insertions.indexOf("#homeEmpty") >= 0 || bootNoParser.insertions.indexOf("#main") >= 0,
      JSON.stringify(bootNoParser.insertions));
    ok("反例：日志侧也有记录（「有可见面板」与「有可查日志」两件事都成立）",
      bootNoParser.consoleErrors.some(m => /Startup dependency check failed/.test(m)),
      JSON.stringify(bootNoParser.consoleErrors.slice(0, 2)));
    ok("反例：未做持久化状态恢复 ⇒ state.items 仍为空（没有半套数据被用起来）",
      Array.isArray(bootNoParser.app.state.items) && bootNoParser.app.state.items.length === 0,
      "items=" + (bootNoParser.app.state.items || []).length);

    // ⑥ 另一支依赖：反馈模块。证明闸门不是只对解析器特判。
    const noFeedback = indexScripts.filter(s => s !== "lib/feedback.js");
    const bootNoFeedback = await bootCombination({ scripts: noFeedback });
    ok("反例：抽掉 lib/feedback.js ⇒ ready 失败且点名 Feedback",
      bootNoFeedback.ready === false &&
      bootNoFeedback.app.startupFailure().some(p => p.path === "Feedback"),
      JSON.stringify(bootNoFeedback.app.startupFailure() && bootNoFeedback.app.startupFailure().map(p => p.path)));

    // ⑦ 存储模块：抽掉它必须同样被拦下（否则是「内存里跑得好好的、重启全丢」）。
    const noStorage = indexScripts.filter(s => s !== "lib/storage.js");
    const bootNoStorage = await bootCombination({ scripts: noStorage });
    ok("反例：抽掉 lib/storage.js ⇒ ready 失败且点名 createStorage",
      bootNoStorage.ready === false &&
      bootNoStorage.app.startupFailure().some(p => p.path === "createStorage"),
      JSON.stringify(bootNoStorage.app.startupFailure() && bootNoStorage.app.startupFailure().map(p => p.path)));

    // ⑦·2 **错误顺序**：把 lib/date-utils.js 挪到解析器之后。这不是「缺件」而是「顺序错」，
    //      真实后果是 parse-cn/repeat 求值即抛错。闸门必须同样给出可见失败，
    //      而不是让应用带着半套规则起来（脚本顺序错了在浏览器里**不会**有任何提示）。
    const latePrimitives = indexScripts.filter(s => s !== "lib/date-utils.js").concat(["lib/date-utils.js"]);
    const bootLatePrim = await bootCombination({ scripts: latePrimitives });
    ok("反例：日历原语被排到解析器之后 ⇒ 求值即报 eval-failed（顺序错的后果可见）",
      bootLatePrim.loadErrors.some(e => /^eval-failed:lib\/parse-cn\.js:/.test(String(e))),
      JSON.stringify(bootLatePrim.loadErrors));
    ok("反例：顺序错时闸门同样拦住启动（ready=false，且点名 DatePrimitives 缺失）",
      bootLatePrim.ready === false &&
      bootLatePrim.app.startupFailure().some(p => p.path === "DatePrimitives"),
      JSON.stringify(bootLatePrim.app.startupFailure() && bootLatePrim.app.startupFailure().map(p => p.path)));
    ok("反例：顺序错时不读库、不起业务定时器",
      bootLatePrim.disk.puts === 0 && bootLatePrim.intervals.indexOf(15000) < 0,
      "puts=" + bootLatePrim.disk.puts + " intervals=" + JSON.stringify(bootLatePrim.intervals));

    // ⑧ 边界：闸门**不得**越界去要求原生桥。纯 Web 环境没有 Capacitor 是正常状态，
    //    把它当装配错误会让整套 Web 版直接起不来（见前面的反向对照：去掉 native 仍 ready）。
    const noNative = await bootCombination({
      scripts: indexScripts.filter(s => s !== "lib/native-reminders.js")
    });
    ok("边界：没有原生桥时闸门**不**报错（纯 Web 是正常状态，不是缺 JS 模块）",
      noNative.app.startupFailure() === null && noNative.ready === true,
      JSON.stringify(noNative.app.startupFailure()));

    // ⑨ P2 新增模块 lib/ui-format.js：同样要有「缺件」与「顺序错」两条反例，
    //    否则新加的加载期依赖声明是句空话。
    const noUiFormat = indexScripts.filter(s => s !== "lib/ui-format.js");
    const bootNoUiFormat = await bootCombination({ scripts: noUiFormat });
    ok("反例：抽掉 lib/ui-format.js ⇒ ready 失败且点名 UiFormat",
      bootNoUiFormat.ready === false &&
      bootNoUiFormat.app.startupFailure().some(p => p.path === "UiFormat"),
      JSON.stringify(bootNoUiFormat.app.startupFailure() && bootNoUiFormat.app.startupFailure().map(p => p.path)));
    ok("反例：抽掉 lib/ui-format.js 后不读库、不起业务定时器",
      bootNoUiFormat.disk.puts === 0 && bootNoUiFormat.intervals.indexOf(15000) < 0,
      "puts=" + bootNoUiFormat.disk.puts + " intervals=" + JSON.stringify(bootNoUiFormat.intervals));

    const uiBeforePrimitives = ["lib/ui-format.js"]
      .concat(indexScripts.filter(s => s !== "lib/ui-format.js"));
    const bootUiEarly = await bootCombination({ scripts: uiBeforePrimitives });
    ok("反例：lib/ui-format.js 排到 lib/date-utils.js 之前 ⇒ 求值即报 eval-failed",
      bootUiEarly.loadErrors.some(e => /^eval-failed:lib\/ui-format\.js:/.test(String(e))),
      JSON.stringify(bootUiEarly.loadErrors));
    ok("反例：顺序错时闸门拦住启动并点名 UiFormat",
      bootUiEarly.ready === false &&
      bootUiEarly.app.startupFailure().some(p => p.path === "UiFormat"),
      JSON.stringify(bootUiEarly.app.startupFailure() && bootUiEarly.app.startupFailure().map(p => p.path)));

    // ⑩ P2-b 新增模块 lib/app-ui.js：展示能力是**界面能不能用**的前提，缺件必须被点名。
    //    这条比 ⑨ 更要紧 —— 缺 ui-format 只是文字显示退化，缺 app-ui 是「点不动、没反馈」。
    const noAppUi = indexScripts.filter(s => s !== "lib/app-ui.js");
    const bootNoAppUi = await bootCombination({ scripts: noAppUi });
    ok("反例：抽掉 lib/app-ui.js ⇒ ready 失败且点名 AppUi / AppUi.createUi",
      bootNoAppUi.ready === false &&
      bootNoAppUi.app.startupFailure().some(p => p.path === "AppUi") &&
      bootNoAppUi.app.startupFailure().some(p => p.path === "AppUi.createUi"),
      JSON.stringify(bootNoAppUi.app.startupFailure() && bootNoAppUi.app.startupFailure().map(p => p.path)));
    ok("反例：抽掉 lib/app-ui.js 后不读库、不起业务定时器、不落库",
      bootNoAppUi.disk.puts === 0 && bootNoAppUi.intervals.indexOf(15000) < 0,
      "puts=" + bootNoAppUi.disk.puts + " intervals=" + JSON.stringify(bootNoAppUi.intervals));
    ok("反例：抽掉 lib/app-ui.js 后仍然渲染出可见失败面板（缺的正是 DOM 能力，不能因此静默）",
      bootNoAppUi.insertions.length >= 1,
      JSON.stringify(bootNoAppUi.insertions));
    ok("反例：抽掉 lib/app-ui.js 后失败面板里没有可编辑控件",
      bootNoAppUi.created.indexOf("section") >= 0 &&
      bootNoAppUi.created.indexOf("button") >= 0 &&
      bootNoAppUi.created.every(t => ["section", "p", "div", "button"].indexOf(t) >= 0),
      JSON.stringify(bootNoAppUi.created));
    ok("反例：面板上真的写出了「哪一支没起来」（点名 AppUi），不是只 console.error",
      bootNoAppUi.createdText.some(t => /应用没能启动/.test(t)) &&
      bootNoAppUi.createdText.some(t => /AppUi/.test(t)),
      JSON.stringify(bootNoAppUi.createdText.map(t => t.slice(0, 60))));

    // 正常组合下 app-ui 必须真的接上生产链：这条防「契约里写了、index.html 里其实没有」。
    const uiOk = boot.app && typeof boot.app.uiSurface === "function" ? boot.app.uiSurface() : null;
    ok("正向：正常组合下展示能力实例真的可用（不是「绑定存在」而是「能调用」）",
      boot.loadErrors.length === 0 && !!uiOk &&
      uiOk.hasQuery === true && uiOk.hasQueryAll === true && uiOk.hasToast === true &&
      uiOk.hasConfirm === true && uiOk.hasSheet === true && uiOk.hasCloseAllSheets === true &&
      uiOk.hasSafeHref === true &&
      uiOk.hrefHttps === "https://example.com/x" && uiOk.hrefJs === null &&
      uiOk.hrefTab === null,
      JSON.stringify(uiOk));
  }

  /* ---------- C. 可控 Android 桥：监听注册 / 一次排程 / 相同计划不重排 + O2 计数 ---------- */
  section("C. 可控 Android 桥：真实初始化与生命周期入口");
  {
    // 先证明「桥确实被接上了」——否则下面所有计数都在空转。
    ok("原生初始化注册了本地通知动作类型（监听注册这一幕真的发生了）",
      boot.env.calls.actionTypes.length === 1 &&
      boot.env.calls.actionTypes[0].types.length === 2 &&
      boot.env.calls.actionTypes[0].types[0].id === "attention-actions");
    ok("通知渠道被建起来（ensureChannels 走到了）", boot.env.calls.channels.length >= 1);
    ok("本地通知监听注册了 `localNotificationActionPerformed` 与 `localNotificationReceived`",
      boot.env.calls.localListeners.indexOf("localNotificationActionPerformed") >= 0 &&
      boot.env.calls.localListeners.indexOf("localNotificationReceived") >= 0,
      JSON.stringify(boot.env.calls.localListeners));
    ok("App 的 appStateChange 监听注册成功（回前台补偿的入口）",
      boot.env.calls.appListeners.indexOf("appStateChange") >= 0);
    ok("启动时至少做过一轮原生对账（forceRebuild 那一次）",
      boot.app.nativeSyncStats().runs >= 1, JSON.stringify(boot.app.nativeSyncStats()));
    ok("15 秒心跳与 2 秒闹钟轮询都装上了", boot.intervals.indexOf(15000) >= 0 && boot.intervals.indexOf(2000) >= 0,
      JSON.stringify(boot.intervals));

    section("C2. O2：业务保存 → 恰好一轮对账；**内部记账不再自激下一轮**");
    {
      const app = boot.app;
      const env = boot.env;
      // 「本地通知」总开关默认是关的（`notify: false`），关着的时候对账**本就应该**
      // 清空计划、不排任何东西。要观察排程，必须先把业务开关打开 —— 否则下面的
      // 断言测的是「开关关着所以没排」，而不是我们要观察的链路。
      app.state.settings.notify = true;
      app.state.settings.dnd = false;
      app.resetNativeSyncStats();
      const baseAlarms = env.calls.scheduleAlarm.length;
      const baseNotify = env.calls.schedule.length;

      const soon = Date.now() + 30 * 60 * 1000;
      const it = app.makeItem({ title: "关键事项", status: "waiting", priority: "critical", triggerAt: soon });
      app.state.items.push(it);
      await app.saveAsync();
      await wait(300);

      const afterFirst = app.nativeSyncStats();
      ok("一次业务保存 = 恰好一轮对账（不是两轮）", afterFirst.runs === 1,
        JSON.stringify(afterFirst));
      ok("首次对账排下了全屏闹钟（关键档首投走闹钟通道）",
        env.calls.scheduleAlarm.length - baseAlarms === 1,
        "scheduleAlarm+" + (env.calls.scheduleAlarm.length - baseAlarms));
      ok("普通提醒通道也照常排程", env.calls.schedule.length - baseNotify >= 1);
      ok("排程台账被记进已提交快照（业务侧真的收到了结果）",
        Array.isArray(app.state.settings.scheduledAlarmIds) && app.state.settings.scheduledAlarmIds.length === 1);
      const keys = it.reminderEvents ? Object.keys(it.reminderEvents) : [];
      const bases = keys.map(k => Number(it.reminderEvents[k].roundBase));
      ok("提醒三态台账登记了这一轮的键，且都带有限值的 roundBase",
        keys.length >= 1 && bases.every(b => Number.isFinite(b) && b > 0),
        JSON.stringify(it.reminderEvents));
      ok("轮次身份是**同一个**（= 登记时事项的触发起点），不是每条各自的 at",
        bases.every(b => b === bases[0]) &&
        Math.abs(bases[0] - soon) < 1000,   // localTrigger 精确到秒，最多差 1s
        "roundBase=" + bases[0] + " soon=" + soon);
      ok("后续追提醒的 at 已经推后，但 roundBase 仍是那一轮的起点（R-F06 的判据）",
        keys.length >= 2 && Number(it.reminderEvents[keys[1]].at) !== bases[0] &&
        Number(it.reminderEvents[keys[1]].roundBase) === bases[0]);

      // 关键的一段：台账回写本身会 save。若那次 save 没有 deferNativeSync，
      // 它就会再请求一轮对账 —— 这就是「一次业务变更 = 两轮全量重排」的自激源。
      await wait(500);
      const afterIdle = app.nativeSyncStats();
      ok("静置 500ms 期间**没有**新增对账（内部记账不再自激下一轮）",
        afterIdle.runs === 1, JSON.stringify(afterIdle));
      ok("静置期间也没有新增桥调用",
        env.calls.scheduleAlarm.length - baseAlarms === 1, "scheduleAlarm=" + (env.calls.scheduleAlarm.length - baseAlarms));

      section("C3. 相同计划再对账：允许一轮对账，但不许重排");
      const alarmsBeforeSecond = env.calls.scheduleAlarm.length;
      const notifyBeforeSecond = env.calls.schedule.length;
      await app.saveAsync();
      await wait(300);
      const afterSecond = app.nativeSyncStats();
      ok("第二次保存（计划未变）确实又对账了一轮", afterSecond.runs === 2, JSON.stringify(afterSecond));
      ok("同一计划的第二轮**不重排全屏闹钟**（签名差量生效）",
        env.calls.scheduleAlarm.length === alarmsBeforeSecond,
        "scheduleAlarm+" + (env.calls.scheduleAlarm.length - alarmsBeforeSecond));
      ok("同一计划的第二轮也不重排普通提醒",
        env.calls.schedule.length === notifyBeforeSecond,
        "schedule+" + (env.calls.schedule.length - notifyBeforeSecond));
      ok("第二轮不误撤闹钟", env.calls.cancelAlarm.length === 0);

      section("C4. 改期：旧排程撤销 + 新排程落下");
      it.triggerAt = soon + 60 * 60 * 1000;
      it.localTrigger = null;
      await app.saveAsync();
      await wait(300);
      ok("改期后旧闹钟被撤销（不留下幽灵闹钟）",
        env.calls.cancelAlarm.length >= 1, "cancelAlarm=" + env.calls.cancelAlarm.length);
      ok("改期后按新时刻重新排下闹钟",
        env.calls.scheduleAlarm.length > alarmsBeforeSecond,
        "scheduleAlarm=" + env.calls.scheduleAlarm.length);
      const last = env.calls.scheduleAlarm[env.calls.scheduleAlarm.length - 1];
      ok("新排程用的是**新**时刻（业务改变后最终计划正确）",
        !!last && Math.abs(Number(last.delayMs) - (it.triggerAt - Date.now())) < 5000,
        "delayMs=" + (last && last.delayMs));

      section("C5. 失败保留重试：排程失败不入账，桥恢复后下一轮补排（不谎报已排）");
      const originalSchedule = boot.env.capacitor.Plugins.SystemBridge.scheduleAlarm;
      const idsBeforeFail = app.state.settings.scheduledAlarmIds.slice();
      const alarmCallsBeforeFail = env.calls.scheduleAlarm.length;
      const failItem = app.makeItem({
        title: "会排失败的", status: "waiting", priority: "critical",
        triggerAt: Date.now() + 45 * 60 * 1000
      });
      env.capacitor.Plugins.SystemBridge.scheduleAlarm = async () => { throw new Error("schedule-boom"); };
      app.state.items.push(failItem);
      await app.saveAsync();
      await wait(300);
      ok("排程失败的那一条**没有**被记进排程台账（不入账才可能重试）",
        !app.state.settings.scheduledAlarmIds.some(id => id !== idsBeforeFail[0]) &&
        app.state.settings.scheduledAlarmIds.length === idsBeforeFail.length,
        JSON.stringify(app.state.settings.scheduledAlarmIds));
      ok("失败时既有的那条闹钟仍被保留（不因另一次失败把它忘掉）",
        app.state.settings.scheduledAlarmIds.length === idsBeforeFail.length && idsBeforeFail.length >= 1);
      ok("失败没有让对账整体崩掉（异常被收进 status，没有逃逸出 API）",
        env.calls.scheduleAlarm.length === alarmCallsBeforeFail,
        "scheduleAlarm=" + env.calls.scheduleAlarm.length);
      env.capacitor.Plugins.SystemBridge.scheduleAlarm = originalSchedule;
      await app.saveAsync();
      await wait(300);
      ok("桥恢复后下一轮把那条补排上（失败保留重试闭环）",
        app.state.settings.scheduledAlarmIds.length === idsBeforeFail.length + 1,
        JSON.stringify(app.state.settings.scheduledAlarmIds));
      ok("补排真的调到了桥（不是只改台账）",
        env.calls.scheduleAlarm.length === alarmCallsBeforeFail + 1,
        "scheduleAlarm=" + env.calls.scheduleAlarm.length);
    }
  }

  /* ---------- C6. 监听返回契约：同步句柄 / Promise 两种都要能起来 ---------- */
  section("C6. addListener 两种返回契约（真机同步句柄 / 官方 Promise）都要能启动");
  {
    const withHandle = await bootCombination({ addListenerContract: "handle" });
    ok("同步句柄契约下 ready() === true（init 未被同步异常打断）", withHandle.ready === true);
    ok("同步句柄契约下监听确实注册过", withHandle.env.calls.appListeners.length >= 1);
    const withPromise = await bootCombination({ addListenerContract: "promise" });
    ok("Promise 契约下 ready() === true", withPromise.ready === true);
    ok("Promise 契约下监听确实注册过", withPromise.env.calls.appListeners.length >= 1);
    ok("两种契约下都真的排起了原生链路（不是「没抛错」这么弱的判据）",
      withHandle.env.calls.actionTypes.length === 1 && withPromise.env.calls.actionTypes.length === 1);
  }

  /* ---------- C7. O5：序列化计数与「已提交快照」的发布时机 ---------- */
  section("C7. O5：正常保存的序列化计数（同一份独立快照给两个消费者）");
  {
    const h = await bootCombination();
    const app = h.app;
    // 先把「保存 → 排队 → 对账」这一串全部走到静置，避免对账自己的
    // `JSON.parse(JSON.stringify(...))` 混进计数。
    await app.saveAsync();
    await wait(300);

    h.jsonCount.parse = 0;
    h.jsonCount.stringify = 0;
    await app.saveAsync();   // 这一刻只计量 writeSnapshot 这条路径
    const measured = { parse: h.jsonCount.parse, stringify: h.jsonCount.stringify };
    ok("一次保存只有 **1 次**全量 JSON.parse", measured.parse === 1, JSON.stringify(measured));
    ok("两次 stringify 各自都有出处：① 生成 json 载荷 ② localStorage 镜像序列化",
      measured.stringify === 2, JSON.stringify(measured));
    ok("镜像仍然照写（不能为了少一次 parse 把镜像去掉）",
      !!h.localStorage.getItem("attention-inbox-v2"));
    ok("权威后端（IDB）上确实落到了这次提交",
      !!h.disk.idbValue && Array.isArray(h.disk.idbValue.items));

    // 独立快照：提交在途时改内存，绝不能混进这次提交（H1 不能被「复用快照」优化破坏）。
    // 「少一次 parse」的前提是**仍然**解析出独立副本；把 `JSON.parse(json)` 直接
    // 换成活对象也能省一次 parse —— 那正是这条对照要抓的事。
    const hold = await bootCombination();
    const app2 = hold.app;
    await wait(80);
    const probe = app2.makeItem({
      id: "snap-hold", title: "提交时刻的标题", status: "waiting",
      priority: "normal", triggerAt: Date.now() + 60 * 60 * 1000
    });
    app2.state.items.push(probe);
    const putsBefore = hold.disk.puts;
    hold.disk.holdWrites = true;
    const inflight = app2.saveAsync();
    await wait(40);
    ok("（前置）提交确实停在半路（put 已发出，事务还没完成）",
      hold.disk.puts === putsBefore + 1 && hold.disk.held.length === 1,
      JSON.stringify({ puts: hold.disk.puts, held: hold.disk.held.length }));

    // 在途期间改内存 + 新增事项 —— 都不该混进这次提交。
    probe.title = "在途被改掉的标题";
    app2.state.items.push(app2.makeItem({
      id: "snap-late", title: "在途新增的事项", status: "waiting",
      priority: "normal", triggerAt: Date.now() + 60 * 60 * 1000
    }));
    hold.disk.releaseWrites();
    await inflight;
    await wait(40);
    const landed = hold.disk.idbValue &&
      hold.disk.idbValue.items.filter(it => it.id === "snap-hold")[0];
    ok("落库的是**提交时刻**的独立快照（在途改内存没混进去）",
      !!landed && landed.title === "提交时刻的标题",
      landed ? landed.title : "(未落库)");
    ok("在途新增的事项没有被塞进这次提交（不是把活数组直接交给后端）",
      !hold.disk.idbValue.items.some(it => it.id === "snap-late"),
      JSON.stringify((hold.disk.idbValue.items || []).map(it => it.id)));
  }

  section("C8. O5：提交失败不得提前发布已提交快照（旧投递不被误停）");
  {
    const h = await bootCombination();
    const app = h.app;
    const env = h.env;
    const x = app.makeItem({
      id: "snap-x", title: "在途投递事项", status: "waiting",
      priority: "normal", triggerAt: Date.now() + 10 * 60 * 1000
    });
    app.state.items.push(x);
    await app.saveAsync();
    await wait(60);

    env.calls.activeAlarms.length = 0;
    env.calls.activeAlarms.push({
      id: 7, token: "tk-7", itemId: "snap-x", itemRev: 1, title: "旧投递"
    });
    env.calls.stopAlarmDelivery.length = 0;

    // 把事项改成终态，但让这次权威提交**失败**。
    h.disk.failWrites = true;
    x.status = "archived";
    x.completedAt = Date.now();
    let rejected = false;
    try { await app.saveAsync(); } catch (error) { rejected = true; }
    await wait(30);
    ok("权威提交失败被如实上报（不是静默成功）", rejected === true);
    ok("失败时权威后端上没有写入这次内容",
      !!h.disk.idbValue && !h.disk.idbValue.items.some(it => it.id === "snap-x" && it.status === "archived"));

    // 走真实生命周期入口（回前台）触发全屏面板刷新。
    env.fireResume();
    await wait(80);
    ok("未提交的终态没有被当成已提交 ⇒ 旧投递**没有**被误停",
      env.calls.stopAlarmDelivery.length === 0,
      "stopAlarmDelivery=" + env.calls.stopAlarmDelivery.length);
    ok("面板把这条在途投递作为「待处理」展示出来",
      /旧投递|在途投递事项/.test(h.node("#activeAlarmPanel").innerHTML),
      h.node("#activeAlarmPanel").innerHTML.slice(0, 160));

    // 提交成功之后再走一次：这次已提交快照真的更新了，旧投递应当被停掉。
    h.disk.failWrites = false;
    await app.saveAsync();
    await wait(30);
    env.fireResume();
    await wait(80);
    ok("提交成功后已提交快照才更新 ⇒ 旧投递被停掉",
      env.calls.stopAlarmDelivery.length === 1,
      "stopAlarmDelivery=" + env.calls.stopAlarmDelivery.length);

    // 生命周期入口自身也要有牙齿：document 级 visibilitychange 是前台补偿的入口。
    const before = env.calls.stopAlarmDelivery.length;
    h.fireDocumentEvent("visibilitychange");
    await wait(80);
    ok("真实生命周期入口 visibilitychange 也被接上了（不是只有桥回调）",
      env.calls.stopAlarmDelivery.length >= before);
  }

  /* ---------- D. 启动渲染次数（O7）与折叠卡片数（O6） ---------- */
  section("D. O7：默认空首页一次启动只做**一次**必要的首页 DOM 构建");
  {
    const empty = await bootCombination();
    ok("空启动：#homeDue 只被重写 1 次", empty.bootWrites["#homeDue"] === 1,
      JSON.stringify(empty.bootWrites));
    ok("空启动：#homeActive / #homeEmpty / #homeStart 各只被重写 1 次",
      empty.bootWrites["#homeActive"] === 1 && empty.bootWrites["#homeEmpty"] === 1 &&
      empty.bootWrites["#homeStart"] === 1, JSON.stringify(empty.bootWrites));
    ok("空首页确实是安静态（空态文案 + 「记一件事」入口）",
      /把要记的事丢进来/.test(empty.node("#homeEmpty").innerHTML) &&
      /id="emptyCapture"/.test(empty.node("#homeStart").innerHTML));
    ok("末尾 tick 仍然执行（心跳与轮询都装上了）",
      empty.intervals.indexOf(15000) >= 0 && empty.intervals.indexOf(2000) >= 0,
      JSON.stringify(empty.intervals));

    // 持久数据启动：老数据要被恢复，而且**同样只构建一次**。
    // 到期事项用的是「启动前就已经过期」的时刻 —— 那正是「不能靠删掉首次 tick
    // 把渲染次数压到 1」的场景：它必须在这一次构建里就位。
    const dueAt = Date.now() - 60000;
    const dataBoot = await bootCombination({
      seedState: {
        schema: 5,
        items: [{
          id: "seed-2", title: "已恢复的事项", status: "waiting", triggerAt: dueAt,
          priority: "normal", tags: [], deadlineEvents: {}, reminderEvents: {},
          scheduleBasis: "wall-clock", localTrigger: null, dismissedUntil: null, rev: 1
        }],
        notes: [], projects: [], settings: { notify: false, dnd: false }
      }
    });
    ok("持久数据启动 ready() 为真，且老数据被恢复出来", dataBoot.ready === true &&
      dataBoot.app.state.items.length === 1 && dataBoot.app.state.items[0].title === "已恢复的事项");
    ok("到期事项在启动当期就被推进为 due（没有等到 15 秒后的那一拍）",
      dataBoot.app.state.items[0].status === "due", dataBoot.app.state.items[0].status);
    ok("持久数据启动：#homeDue 只被重写 1 次",
      dataBoot.bootWrites["#homeDue"] === 1, JSON.stringify(dataBoot.bootWrites));
    ok("持久数据启动：那张到期卡片就在这一次构建里渲染出来（data-id 已在 DOM 里）",
      /data-id="seed-2"/.test(dataBoot.node("#homeDue").innerHTML),
      dataBoot.node("#homeDue").innerHTML.slice(0, 200));
    ok("持久数据启动：#homeActive / #homeEmpty / #homeStart 也各只被重写 1 次",
      dataBoot.bootWrites["#homeActive"] === 1 && dataBoot.bootWrites["#homeEmpty"] === 1 &&
      dataBoot.bootWrites["#homeStart"] === 1, JSON.stringify(dataBoot.bootWrites));
  }

  /* ---------- D2. O6：折叠不生成隐藏卡片 ---------- */
  section("D2. O6：1000 条「已看到未完成」折叠时生成 0 张隐藏卡片");
  {
    const h = await bootCombination();
    const app = h.app;
    const now = Date.now();
    app.state.items.length = 0;
    for (let i = 0; i < 1000; i++) {
      app.state.items.push(app.makeItem({
        id: "acked-" + i, title: "已看到 " + i, status: "acknowledged",
        acknowledgedAt: now - i * 1000, triggerAt: now + 3600000, priority: "normal"
      }));
    }
    app.state.ui.activeExpanded = false;
    app.renderHome();
    const collapsedHtml = h.node("#homeActive").innerHTML;
    ok("折叠态 #homeActive 里一张 `<article>` 都没有",
      (collapsedHtml.match(/<article/g) || []).length === 0);
    ok("折叠态仍然给出数量入口（数量、文案、展开动作都在）",
      /已看到未完成 · 1000/.test(collapsedHtml) && /id="toggleActive"/.test(collapsedHtml) &&
      /展开/.test(collapsedHtml));
    ok("折叠态 HTML 体积与卡片数无关（148 字节量级，而不是 600KB 量级）",
      collapsedHtml.length < 400, collapsedHtml.length + " bytes");
    const collapsedCards = app.homeRenderStats().activeCards;
    ok("渲染计数佐证：折叠态生成的 active 卡片数 = 0", collapsedCards === 0, String(collapsedCards));

    app.state.ui.activeExpanded = true;
    app.renderHome();
    const expandedHtml = h.node("#homeActive").innerHTML;
    ok("展开后按当前状态生成全部 1000 张卡片",
      (expandedHtml.match(/<article/g) || []).length === 1000 &&
      app.homeRenderStats().activeCards === 1000);
    ok("展开后没有 hidden 属性（卡片真的可见）", !/ id="activeList" hidden/.test(expandedHtml));

    app.state.ui.activeExpanded = false;
    app.renderHome();
    ok("收起后这些卡片节点被释放（#homeActive 里重新变成 0 张）",
      (h.node("#homeActive").innerHTML.match(/<article/g) || []).length === 0);
  }

  /* ---------- E. O3：链接协议白名单 + 属性上下文转义 ---------- */
  section("E. O3：危险协议没有可点击入口；含引号 ID 不突破属性（走持久化 → normalizeItem → 渲染真实路径）");
  {
    const dueAt = Date.now() - 60000;
    // 这些事项是**从持久化快照里读回来的**，也就是「导入/旧数据」的同一条规范化入口
    // （loadSync → applyParsedState → normalizeItem），而不是测试里手搭的对象。
    const HOSTILE_ID = 'a" onmouseover="alert(1)" x="';
    const make = (id, url) => ({
      id: id, title: "链接 " + id, status: "waiting", triggerAt: dueAt,
      priority: "normal", url: url, tags: [], deadlineEvents: {}, reminderEvents: {},
      scheduleBasis: "wall-clock", localTrigger: null, dismissedUntil: null, rev: 1
    });
    const seedItems = [
      make("h-js", "javascript:alert(1)"),
      make("h-case", "JaVaScRiPt:alert(1)"),
      make("h-space", "   javascript:alert(1)"),
      make("h-nl", "java\nscript:alert(1)"),
      make("h-data", "data:text/html,<script>alert(1)</script>"),
      make("h-vb", "vbscript:msgbox(1)"),
      make("h-file", "file:///etc/passwd"),
      make("h-bad", "http://"),
      make("h-ipv6", "https://["),
      make("h-percent", "http://%zz"),
      make("h-port", "https://example.com:99999"),
      make("h-ok", "https://example.com/a?b=1&c=2"),
      make(HOSTILE_ID, "https://example.com/q?a=%22x%22&b=1")
    ];
    const h = await bootCombination({
      seedState: { schema: 5, items: seedItems, notes: [], projects: [], settings: { notify: false, dnd: false } }
    });
    const app = h.app;
    const html = h.node("#homeDue").innerHTML;
    ok("13 条带链接的事项都进入「需要注意」并渲染出来（对照有效）",
      app.state.items.length === 13 && (html.match(/<article/g) || []).length === 13,
      (html.match(/<article/g) || []).length + " 张卡片");

    // ① 危险协议：既不能是可点击链接，也不能出现在 href 里
    //    13 条里只有 h-ok 与那条含引号 ID 的正常 https 允许可点，其余 11 条全部降级为纯文本。
    const hrefs = (html.match(/href="[^"]*"/g) || []).map(s => s.slice(6, -1));
    const protocolLeak = html.match(/href="[^"]*(?:javascript|data|vbscript|file):/i);
    ok("危险协议一次都没进 href（大小写 / 前导空白 / 内嵌换行 / data / vbscript / file 全覆盖）",
      protocolLeak === null, protocolLeak ? protocolLeak[0] : "");
    ok("所有可点击 href 都是 https:（白名单以外一个都不放行）",
      hrefs.length === 2 && hrefs.every(u => /^https:\/\//.test(u)), JSON.stringify(hrefs));
    ok("危险或畸形链接没有生成可点击的 <a class=\"linkish\">（11 条都不行）",
      (html.match(/<a class="linkish"/g) || []).length === 2,
      (html.match(/<a class="linkish"/g) || []).length + " 个链接");
    ok("危险或畸形链接以纯文本节点呈现（linkish-plain 计 11 个）",
      (html.match(/class="linkish-plain"/g) || []).length === 11,
      (html.match(/class="linkish-plain"/g) || []).length + " 个纯文本");
    ok("解析器明确拒绝的畸形 IPv6 / percent encoding / 端口没有被兼容正则二次放行",
      !hrefs.some(u => u === "https://[" || u === "http://%zz" || u === "https://example.com:99999"),
      JSON.stringify(hrefs));
    ok("纯文本仍然是**转义后**的（data: 那一条的 <script> 变成了 &lt;script&gt;）",
      /&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(html) && !/<script>alert\(1\)<\/script>/.test(html));

    // ② 原始数据没被静默删除
    const jsItem = app.state.items.filter(it => it.id === "h-js")[0];
    const nlItem = app.state.items.filter(it => it.id === "h-nl")[0];
    ok("危险值仍然原样留在 it.url 里（降级呈现 ≠ 删用户内容）",
      jsItem.url === "javascript:alert(1)" && nlItem.url === "java\nscript:alert(1)",
      JSON.stringify([jsItem.url, nlItem.url]));

    // ③ 正常 HTTPS 照旧可点，且属性值按属性上下文转义（& → &amp;）
    ok("正常 HTTPS 仍然可点击，且 href 里的 & 被转义成 &amp;",
      html.indexOf('href="https://example.com/a?b=1&amp;c=2"') >= 0);

    // ④ 含引号的 ID：属性上下文转义
    ok("含引号的 ID 在 data-id 里被转义（裸引号不能出现，否则能闭合属性）",
      html.indexOf('data-id="a&quot; onmouseover=&quot;alert(1)&quot; x=&quot;"') >= 0);
    ok("含引号的 ID 没有在 HTML 里留下**裸**的 onmouseover=\" 属性",
      !/[\s"']onmouseover="/.test(html));
    ok("含引号的 ID 也没有以原始形态出现在任何位置",
      html.indexOf(HOSTILE_ID) < 0);
    ok("含引号的 ID 在动作按钮上也同样被转义",
      /<button[^>]*data-id="a&quot; onmouseover=&quot;alert\(1\)&quot; x=&quot;"/.test(html));
    const hostile = app.state.items.filter(it => it.id === HOSTILE_ID)[0];
    ok("含引号的 ID 本身没有被改写（不顺带重编号、不删除重复 ID）",
      !!hostile && hostile.id === HOSTILE_ID);
  }

  /* ---------- F. O4：台账 / 证据匹配改用调用内索引 ---------- */
  section("F. O4：100/500/2000 项 × 空台账 / 满台账，不再逐目标整表扫描（含优化前后对照）");
  {
    const PRE_EDIT = "docs/reviews/verification-runs/20260920T1706-code-optimization/pre-edit/app-core.js";

    // 规范化事项（makeItem → normalizeItem）**一定带** `deadlineEvents: {}` / `reminderEvents: {}`，
    // 所以「空台账」这一格恰恰是旧实现最容易变成 O(目标数 × n) 的形态 —— 这正是 E-04 的场景。
    async function measureApply(options, n, mode) {
      const h = await bootCombination(options);
      const app = h.app;
      const base = Date.now() + 3600000;
      app.state.items.length = 0;
      for (let i = 0; i < n; i++) {
        app.state.items.push(app.makeItem({
          id: "p" + i, title: "事项 " + i, status: "waiting",
          priority: "normal", triggerAt: base + i * 1000
        }));
      }
      const events = [];
      if (mode === "full") {
        for (let i = 0; i < n; i++) {
          // 键必须取自**事项上真实的 triggerAt**（规范化会把它对齐到整秒），
          // 而不是我喂进去的原始毫秒数 —— 否则测的是我自己算的键，不是台账语义。
          const item = app.state.items[i];
          events.push({ itemId: item.id, key: "1@" + item.triggerAt, at: item.triggerAt });
        }
      } else {
        // 「空」= 台账里一条事件都没有，但每个事项都带着空台账对象
        app.state.items.forEach(it => { it.reminderEvents = {}; it.deadlineEvents = {}; });
      }
      const now = Date.now();
      h.resetFindMeter();
      const changedReminders = app.applyReminderEvents(events, now, []);
      const reminders = { bigCalls: h.findMeter.bigCalls, bigPreds: h.findMeter.bigPreds, maxLen: h.findMeter.bigMaxLen };
      h.resetFindMeter();
      const changedDeadlines = app.applyDeadlineEvents([], now, []);
      const deadlines = { bigCalls: h.findMeter.bigCalls, bigPreds: h.findMeter.bigPreds, maxLen: h.findMeter.bigMaxLen };
      return { h: h, app: app, n: n, mode: mode, reminders: reminders, deadlines: deadlines,
        changedReminders: changedReminders, changedDeadlines: changedDeadlines };
    }

    for (const n of [100, 500, 2000]) {
      const empty = await measureApply({}, n, "empty");
      ok(`n=${n} 空台账：**0 次**对大数组（≥64）的 find（整表扫描已消除）`,
        empty.reminders.bigCalls === 0 && empty.deadlines.bigCalls === 0,
        JSON.stringify({ reminders: empty.reminders, deadlines: empty.deadlines }));
      ok(`n=${n} 空台账：也没有任何变化需要落库（没有借性能改动顺手改语义）`,
        empty.changedReminders === false && empty.changedDeadlines === false);

      const full = await measureApply({}, n, "full");
      ok(`n=${n} 满台账：同样 **0 次**大数组 find（索引建一次、查 n 次）`,
        full.reminders.bigCalls === 0 && full.deadlines.bigCalls === 0,
        JSON.stringify({ reminders: full.reminders, deadlines: full.deadlines }));
      const registered = full.app.state.items.filter(it => {
        const entry = it.reminderEvents && it.reminderEvents["1@" + it.triggerAt];
        return !!entry && entry.state === "scheduled" && entry.roundBase === it.triggerAt;
      }).length;
      ok(`n=${n} 满台账：业务结果正确（${n} 条都登记成当前轮的 scheduled）`,
        full.changedReminders === true && registered === n,
        registered + "/" + n);
    }

    // 优化前后对照：**同一 harness、同一组合**，只把 app-core.js 换成编辑前那一份。
    if (fs.existsSync(path.join(ROOT, PRE_EDIT))) {
      const before = await measureApply({ overrides: { "app-core.js": PRE_EDIT } }, 2000, "empty");
      ok("对照（编辑前 app-core.js，n=2000 空台账）：确实在做逐目标整表扫描",
        before.reminders.bigPreds > 1000000 || before.deadlines.bigPreds > 1000000,
        JSON.stringify({ reminders: before.reminders, deadlines: before.deadlines }));
      const after = await measureApply({}, 2000, "empty");
      ok("对照（本轮 app-core.js，n=2000 空台账）：比较次数降到 0",
        after.reminders.bigPreds === 0 && after.deadlines.bigPreds === 0,
        JSON.stringify({ reminders: after.reminders, deadlines: after.deadlines }));
      ok("对照结论可复算：编辑前 ≈ n²/2 量级，本轮为 0（同一数据、同一调用）",
        before.deadlines.bigPreds >= 1999000 && after.deadlines.bigPreds === 0,
        before.deadlines.bigPreds + " → " + after.deadlines.bigPreds);
      ok("对照两侧的业务结果一致（都判定为「无变化」）",
        before.changedDeadlines === false && after.changedDeadlines === false);
    } else {
      ok("对照用的编辑前 app-core.js 存在", false, PRE_EDIT);
    }

    /* ---------- F2. 重复 ID / 取消 / 终态 / 旧轮身份 ---------- */
    section("F2. O4：重复 ID 首项胜、cancelled / delivered / suppressed / roundBase 语义逐条保留");
    {
      const h = await bootCombination();
      const app = h.app;
      const now = Date.now();
      const t = now + 3600000;

      // ① 重复 ID：`Array.find` 是**首项**胜。`new Map(items.map(...))` 会变成末项覆盖 ——
      //    那是静默的行为改变，不是性能优化。
      app.state.items.length = 0;
      const firstDup = app.makeItem({ id: "dup", title: "首项", status: "waiting", priority: "normal", triggerAt: t });
      const secondDup = app.makeItem({ id: "dup", title: "末项", status: "waiting", priority: "normal", triggerAt: t });
      app.state.items.push(firstDup, secondDup);
      app.applyReminderEvents([{ itemId: "dup", key: "1@" + t, at: t }], now, []);
      ok("重复 ID：登记落在**首项**上（首项胜语义没被索引改成末项覆盖）",
        Object.keys(firstDup.reminderEvents || {}).length === 1 &&
        Object.keys(secondDup.reminderEvents || {}).length === 0,
        JSON.stringify([firstDup.reminderEvents, secondDup.reminderEvents]));

      // ② delivered / suppressed 是终态；cancelled 只认原生确认撤销
      app.state.items.length = 0;
      const delivered = app.makeItem({ id: "d1", title: "已送达", status: "waiting", priority: "normal", triggerAt: t });
      delivered.reminderEvents = { ["1@" + t]: { at: t, state: "delivered", roundBase: t } };
      const suppressed = app.makeItem({ id: "s1", title: "已抑制", status: "waiting", priority: "normal", triggerAt: t });
      suppressed.reminderEvents = { ["1@" + t]: { at: t, state: "suppressed", roundBase: t } };
      const pending = app.makeItem({ id: "w1", title: "待撤销", status: "waiting", priority: "normal", triggerAt: t });
      pending.reminderEvents = { ["1@" + t]: { at: t, state: "scheduled", roundBase: t } };
      app.state.items.push(delivered, suppressed, pending);
      app.applyReminderEvents([], now, [{ itemId: "w1", key: "1@" + t }]);
      ok("delivered 是终态：后续对账不抹掉真实送达证据",
        delivered.reminderEvents["1@" + t].state === "delivered");
      ok("suppressed 是终态：撤销完成时的抑制不会被对账抹掉",
        suppressed.reminderEvents["1@" + t].state === "suppressed");
      ok("cancelled：原生确认撤销（且撤销在投递时刻之前）被如实记账",
        pending.reminderEvents["1@" + t].state === "cancelled");

      // ③ roundBase：保留历史条目时必须连同它**原来的轮次身份**一起保留
      app.state.items.length = 0;
      const oldRound = app.makeItem({ id: "r1", title: "旧轮", status: "waiting", priority: "normal", triggerAt: t });
      const staleBase = t - 50000;
      oldRound.reminderEvents = { ["1@" + (t + 5000)]: { at: t + 5000, state: "scheduled", roundBase: staleBase } };
      app.state.items.push(oldRound);
      app.applyReminderEvents([], now, []);
      ok("roundBase：没有新登记时，旧条目的轮次身份原样保留（不能被改写成当前轮）",
        oldRound.reminderEvents["1@" + (t + 5000)].roundBase === staleBase,
        JSON.stringify(oldRound.reminderEvents));

      // ④ 截止台账：delivered / cancelled 三态同样保留
      app.state.items.length = 0;
      const dl = t + 86400000;
      const dlItem = app.makeItem({ id: "dl1", title: "截止", status: "waiting", priority: "normal", triggerAt: t, deadlineAt: dl });
      dlItem.deadlineEvents = { ["p24@" + dl]: { at: t, state: "delivered" } };
      const dlOld = app.makeItem({ id: "dl2", title: "截止待撤", status: "waiting", priority: "normal", triggerAt: t, deadlineAt: dl });
      dlOld.deadlineEvents = { ["p24@" + dl]: { at: now + 60000, state: "scheduled" } };
      app.state.items.push(dlItem, dlOld);
      app.applyDeadlineEvents([], now, [{ itemId: "dl2", stageKey: "p24@" + dl }]);
      ok("截止台账：delivered 终态保留", dlItem.deadlineEvents["p24@" + dl].state === "delivered");
      ok("截止台账：原生确认撤销 → cancelled（不谎报送达、也不补发）",
        dlOld.deadlineEvents["p24@" + dl].state === "cancelled");
      ok("截止台账：delivered / cancelled 两类记录都还在（没有借性能改动清除旧证据）",
        Object.keys(dlItem.deadlineEvents).length === 1 && Object.keys(dlOld.deadlineEvents).length === 1);
    }
  }

  /* ---------- G. O6：无变化不重建、该变就变 ---------- */
  section("G. O6：无显示变化的一拍不重写容器；时间 / 数量 / 展开状态变了必须重建");
  {
    const h = await bootCombination();
    const app = h.app;
    const now = Date.now();
    app.state.items.length = 0;
    app.state.items.push(app.makeItem({
      id: "g1", title: "一小时后的事", status: "due", priority: "normal", triggerAt: now + 3700000
    }));
    app.state.ui.activeExpanded = false;
    app.resetHomeRenderStats();
    app.renderHome();

    const html1 = h.node("#homeDue").innerHTML;
    const writes1 = h.writesNow()["#homeDue"] || 0;
    const builds1 = app.homeRenderStats().builds;
    ok("首拍：真的渲染出了卡片，且文案是「1 小时后」",
      /1 小时后/.test(html1) && builds1 === 1, html1.length + " bytes / builds=" + builds1);

    // ① 完全不变的一拍
    app.renderHome();
    ok("无显示变化的一拍：#homeDue **一次都没被重写**（不是「重写了相同内容」）",
      (h.writesNow()["#homeDue"] || 0) === writes1,
      JSON.stringify(h.writesNow()));
    ok("无显示变化的一拍：记为 skipped，builds 不增",
      app.homeRenderStats().skipped === 1 && app.homeRenderStats().builds === builds1,
      JSON.stringify(app.homeRenderStats()));
    ok("无显示变化的一拍：容器内容逐字节相同 ⇒ 卡片节点没有被替换（焦点/滚动/忙碌态因此不受影响）",
      h.node("#homeDue").innerHTML === html1);

    // ② 相对时间文案变了（跨分钟 / 跨日）也必须重建 —— 签名不能只依赖 rev
    app.state.items[0].triggerAt = now + 3 * 86400000;
    app.renderHome();
    ok("跨日文案变化：容器被重建（不是只有 rev 变了才更新）",
      (h.writesNow()["#homeDue"] || 0) === writes1 + 1,
      (h.writesNow()["#homeDue"] || 0) + " vs " + writes1);
    ok("重建后的文案确实换了（1 小时后 → 3 天后）",
      /3 天后/.test(h.node("#homeDue").innerHTML) && !/1 小时后/.test(h.node("#homeDue").innerHTML));

    // ③ 数量变化 → 重建
    app.state.items.push(app.makeItem({
      id: "g2", title: "另一件", status: "due", priority: "normal", triggerAt: now + 7200000
    }));
    app.renderHome();
    ok("新增一条到期事项 → 重建，并且卡片数是 2",
      (h.node("#homeDue").innerHTML.match(/<article/g) || []).length === 2,
      (h.node("#homeDue").innerHTML.match(/<article/g) || []).length + " 张");

    // ④ 展开状态变化（折叠入口在 #homeActive，不是 #homeDue）→ 必须重建
    app.state.items.length = 0;
    app.state.items.push(app.makeItem({
      id: "g3", title: "已看到但没完成", status: "acknowledged", priority: "normal",
      acknowledgedAt: now, triggerAt: now + 3600000
    }));
    app.renderHome();
    ok("折叠态：入口只有数量，没有卡片",
      (h.node("#homeActive").innerHTML.match(/<article/g) || []).length === 0 &&
      /已看到未完成 · 1/.test(h.node("#homeActive").innerHTML));
    app.state.ui.activeExpanded = true;
    app.renderHome();
    ok("展开状态变化 ⇒ 重建（展开后卡片出现）",
      (h.node("#homeActive").innerHTML.match(/<article/g) || []).length === 1);

    // #homeReview 在**每一拍** renderHome 都会被调一次（包括被签名短路的那一拍），
    // 但数量 / 高亮窗口没变时不该重建容器。
    const reviewWrites = h.writesNow()["#homeReview"] || 0;
    app.renderHome();
    app.renderHome();
    ok("#homeReview 连续两拍无变化 ⇒ 容器不重写（它本来每拍都会被调一次）",
      (h.writesNow()["#homeReview"] || 0) === reviewWrites,
      reviewWrites + " → " + h.writesNow()["#homeReview"]);
    app.state.items.push(app.makeItem({
      id: "g4", title: "需要整理的一条", status: "waiting", priority: "normal",
      triggerAt: null, review_status: "NEEDS_REVIEW"
    }));
    app.renderHome();
    ok("#homeReview 数量真的变了 ⇒ 立刻重建（不滞后）",
      (h.writesNow()["#homeReview"] || 0) === reviewWrites + 1 &&
      /id="openReview"/.test(h.node("#homeReview").innerHTML),
      JSON.stringify(h.writesNow()));

    /* ⑤ O6 局部容器：#homeNotice / #homeSetup 是**单一写入者**容器，
       原生状态漏斗（`setNativeReminderStatus`）每读一次权限就调一次；
       结论没变时不得反复重建容器。 */
    const n = await bootCombination();
    const appN = n.app;
    ok("启动期 #homeNotice 只被写 1 次（原先每读一次原生状态就重写一次同一段内容）",
      n.writesNow()["#homeNotice"] === 1, JSON.stringify(n.writesNow()));
    ok("启动期 #homeSetup 只被写 1 次", n.writesNow()["#homeSetup"] === 1,
      JSON.stringify(n.writesNow()));
    ok("总开关默认关闭 ⇒ 告知条给的是「后台提醒已关闭」，不是权限话术（Q6 的既有结论）",
      /后台提醒已关闭/.test(n.node("#homeNotice").innerHTML) &&
      /data-notice-kind="switch"/.test(n.node("#homeNotice").innerHTML));

    // 优先级本身也断言一遍（拿真函数，不看 DOM）：总开关关闭时不得把用户引去授权
    ok("优先级：总开关关闭 + 权限被拒 → 说的是「开关」，不是「去授权」",
      appN.homeNoticeVerdict({ notifications: "denied" }, { notify: false }, true).kind === "switch");
    ok("优先级：总开关打开 + 权限被拒 → 才是权限话术",
      appN.homeNoticeVerdict({ notifications: "denied" }, { notify: true }, true).kind === "permission");
    ok("链路正常（权限给了、对账没报错）→ 没有告知条",
      appN.homeNoticeVerdict({ notifications: "granted" }, { notify: true }, true) === null);

    const noticeWrites1 = n.writesNow()["#homeNotice"] || 0;
    appN.setNativeReminderStatus({ notifications: "denied" }, "permission");
    ok("结论**没变**（仍被总开关话术遮住）⇒ 容器不重写，也没被误升级成权限警告",
      (n.writesNow()["#homeNotice"] || 0) === noticeWrites1 &&
      /data-notice-kind="switch"/.test(n.node("#homeNotice").innerHTML),
      JSON.stringify(n.writesNow()));

    appN.state.settings.notify = true;
    appN.setNativeReminderStatus({ notifications: "denied" }, "permission");
    const noticeWrites2 = n.writesNow()["#homeNotice"] || 0;
    ok("结论真的变了 ⇒ 立刻更新（不滞后）",
      noticeWrites2 === noticeWrites1 + 1 &&
      /data-notice-kind="permission"/.test(n.node("#homeNotice").innerHTML) &&
      /系统通知权限未授予/.test(n.node("#homeNotice").innerHTML),
      noticeWrites2 + " / " + n.node("#homeNotice").innerHTML.slice(0, 80));

    // 同一结论重复到达 3 次 —— 这正是真机上 onResume 反复读权限的形态
    appN.setNativeReminderStatus({ notifications: "denied" }, "permission");
    appN.setNativeReminderStatus({ notifications: "denied" }, "permission");
    appN.setNativeReminderStatus({ notifications: "denied" }, "permission");
    ok("同一结论重复到达 3 次 ⇒ 容器一次都没被重写（内容相同就不重建）",
      (n.writesNow()["#homeNotice"] || 0) === noticeWrites2,
      JSON.stringify(n.writesNow()));

    // 断链消失时必须主动清空 —— 否则「权限恢复后警告还在」就是界面在撒谎
    appN.setNativeReminderStatus({ notifications: "granted" }, "permission");
    ok("断链消失 ⇒ 告知条被清空（权限恢复后警告不残留）",
      n.node("#homeNotice").innerHTML === "" &&
      (n.writesNow()["#homeNotice"] || 0) === noticeWrites2 + 1,
      n.writesNow()["#homeNotice"] + " / len=" + n.node("#homeNotice").innerHTML.length);
    appN.setNativeReminderStatus({ notifications: "granted" }, "permission");
    ok("清空之后再次到达同一结论 ⇒ 仍然不重写",
      (n.writesNow()["#homeNotice"] || 0) === noticeWrites2 + 1);
  }

  /* ---------- G2. O6：结构化签名没有分隔符碰撞 ---------- */
  section("G2. O6：首页签名保留数组与字段边界，用户内容不能制造碰撞");
  {
    const h = await bootCombination();
    const app = h.app;
    const now = Date.now();
    const item = app.makeItem({
      id: "signature-item", title: "标签边界", status: "acknowledged",
      acknowledgedAt: now, triggerAt: now + 3600000, tags: ["work,home"], projectId: "p1"
    });
    app.state.items.length = 0;
    app.state.items.push(item);
    app.state.projects.length = 0;
    app.state.projects.push({ id: "p1", name: "项目", color: "red\u0002p2" });
    app.state.projects.push({ id: "x", name: "备用", color: "blue" });
    app.state.ui.activeExpanded = true;
    app.renderHome();

    let writes = h.writesNow()["#homeActive"] || 0;
    item.tags = ["work", "home"];
    app.renderHome();
    let html = h.node("#homeActive").innerHTML;
    ok("[\"work,home\"] → [\"work\", \"home\"]：无需重载就重建为两个标签",
      (h.writesNow()["#homeActive"] || 0) === writes + 1 &&
      /#work<\/span>/.test(html) && /#home<\/span>/.test(html), html);

    writes = h.writesNow()["#homeActive"] || 0;
    item.title = "left\u0001right";
    item.note = "";
    app.renderHome();
    writes = h.writesNow()["#homeActive"] || 0;
    item.title = "left";
    item.note = "right";
    app.renderHome();
    html = h.node("#homeActive").innerHTML;
    ok("字段中出现旧 SEP 字符也不会把 title/note 边界混在一起",
      (h.writesNow()["#homeActive"] || 0) === writes + 1 &&
      /card-title">left<\/div>/.test(html) && />right<\/p>/.test(html), html);

    writes = h.writesNow()["#homeActive"] || 0;
    app.state.projects[0].color = "red";
    app.state.projects[1].id = "p2\u0002x";
    app.renderHome();
    html = h.node("#homeActive").innerHTML;
    ok("项目字段中出现旧 ROW 字符也不会把相邻项目边界混在一起",
      (h.writesNow()["#homeActive"] || 0) === writes + 1 && /color:red/.test(html), html);

    writes = h.writesNow()["#homeActive"] || 0;
    app.renderHome();
    ok("结构化签名在内容不变时仍保持短路，不牺牲原优化",
      (h.writesNow()["#homeActive"] || 0) === writes,
      JSON.stringify(h.writesNow()));
  }

  /* ---------- H. O7：特殊路由（深链 / 分享）先定路由再渲染 ---------- */
  section("H. O7：深链 / 分享入口不为满足「1 次」而丢功能，也不先渲染一次首页再切走");
  {
    // ① 深链到「未来」页：首页容器应当**一次都没被碰过**
    const deepLink = await bootCombination({ search: "?tab=future" });
    ok("深链 ?tab=future：ready 且路由生效",
      deepLink.ready === true && deepLink.app.state.ui.tab === "future",
      deepLink.app.state.ui.tab);
    ok("深链 ?tab=future：futureSeg 被落到 waiting（保留原语义）",
      deepLink.app.state.ui.futureSeg === "waiting");
    ok("深链 ?tab=future：首页三个卡片容器一次都没被渲染（不是「先渲染首页再切走」）",
      !deepLink.bootWrites["#homeDue"] && !deepLink.bootWrites["#homeActive"] &&
      !deepLink.bootWrites["#homeEmpty"],
      JSON.stringify(deepLink.bootWrites));
    ok("深链 ?tab=future：末尾 tick 仍然执行（心跳没被路由分支吞掉）",
      deepLink.intervals.indexOf(15000) >= 0 && deepLink.intervals.indexOf(2000) >= 0,
      JSON.stringify(deepLink.intervals));

    // ② 分享参数：必须在**渲染之前**被捕获（否则用户看到的是空首页 + 事后弹表单）
    const shared = await bootCombination({
      search: "?text=" + encodeURIComponent("来自分享的标题") + "&url=" + encodeURIComponent("https://example.com/s")
    });
    ok("分享参数：ready 且被路由回首页", shared.ready === true && shared.app.state.ui.tab === "home",
      shared.app.state.ui.tab);
    ok("分享参数：标题确实进了表单（捕获发生在初始化里，不是被渲染短路掉）",
      shared.node("#capText").value === "来自分享的标题" &&
      shared.node("#capUrl").value === "https://example.com/s",
      JSON.stringify([shared.node("#capText").value, shared.node("#capUrl").value]));
    ok("分享参数：首页容器各只写 1 次（捕获与渲染合并成一次）",
      shared.bootWrites["#homeDue"] === 1 && shared.bootWrites["#homeActive"] === 1 &&
      shared.bootWrites["#homeEmpty"] === 1 && shared.bootWrites["#homeStart"] === 1,
      JSON.stringify(shared.bootWrites));
  }
}

// 作为**库**被证据脚本复用时不能自动跑测试、更不能 `process.exit` ——
// 「同一 harness、同一组合」是 §6 对照成立的唯一前提，所以装载器必须能被复用，
// 而不是在证据脚本里再抄一份（抄一份就等于换了一把尺子）。
module.exports = {
  ROOT,
  prod,
  wait,
  makeNode,
  WRITES,
  resetWrites,
  createAndroidEnv,
  loadCombination,
  bootCombination
};

if (require.main === module) {
  run().then(() => {
    console.log("\n========== 生产组合启动测试结果 ==========");
    console.log("通过: " + passed + "  失败: " + failed);
    if (failed) {
      console.log("失败项:");
      failures.forEach(f => console.log("  - " + f));
      process.exit(1);
    }
    console.log("全部通过。");
    process.exit(0);
  }).catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
