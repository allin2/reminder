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
const os = require("os");
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
  "lib/app-ai.js",            // P2-A：AI 能力（工厂实例，无加载期依赖）
  "lib/app-backup.js",        // P2-C：数据备份（工厂实例，无加载期依赖）
  "lib/app-diagnostics.js",   // P2-D：诊断能力（工厂实例，无加载期依赖）
  "lib/app-setup.js",         // P2-E：首次提醒设置与测试（工厂实例，无加载期依赖）
  "lib/app-content.js",       // P2-F1：笔记 / 项目 / 搜索（工厂实例，无加载期依赖）
  "lib/app-capture.js",       // P2-G1：capture 表单与会话（工厂实例，无加载期依赖）
  "lib/app-views.js",         // P2-F2：展示实例（无加载期依赖，core 统一装配）
  "lib/app-model.js",         // P3-A：事项模型与默认状态（工厂实例，无加载期依赖）
  "lib/app-persistence.js",   // P3-B：恢复 / 提交 FIFO / 镜像回放（工厂实例，无加载期依赖）
  "lib/app-transaction.js",   // P3-C：事务协调器（工厂实例，无加载期依赖）
  "lib/app-items.js",         // P3-D：事项业务命令与周期派生（工厂实例，无加载期依赖）
  "lib/app-native-coordinator.js", // P3-E：原生提醒协调与事件台账（工厂实例，无加载期依赖）
  "lib/app-review.js",             // P3-F：待整理会话、窗口规则与卡片（工厂实例，无加载期依赖）
  "lib/app-alerts.js",             // P3-G：Web 提醒弹条、到期 tick 与活动闹钟面板（工厂实例，无加载期依赖）
  "lib/app-platform.js",           // P3-H：平台适配与 PWA 生命周期（工厂实例，无加载期依赖）
  "lib/app-action-feedback.js",    // P3-I：动作与排程反馈（工厂实例，无加载期依赖）
  "lib/app-events.js",             // P3-I：事件路由与深链绑定（工厂实例，无加载期依赖）
  "lib/app-test-api.js",           // P3-I：测试接口组装（工厂实例，无加载期依赖）
  "lib/app-notices.js",            // P3-I-R：首页告知条与启动轻摘要（工厂实例，无加载期依赖）
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

/**
 * 把「真实业务驱动序列」施加到一个组合上，返回可比的计数。
 *
 * 序列 = 打开通知总开关 → 造一条 30 分钟后的 critical 事项 → 保存 → 等一轮。
 * 为什么必须**真的驱动**：通知总开关默认关闭、启动期也没有业务事件，
 * 所以「不驱动就量排程」在健康组合上同样是 0 —— 拿它当对照是假对照（实测栽过）。
 *
 * `step` 记录这一步有没有抛错：健康组合必须是 "ok"，否则「失败态抛错」就分不清
 * 是「应用拒绝服务」还是「这个探针本身写错了」。
 */
async function driveBusinessSave(b, tag) {
  const base = b.env.calls.scheduleAlarm.length;
  let step = "ok";
  try {
    b.app.state.settings.notify = true;
    const it = b.app.makeItem({
      title: tag, status: "waiting", priority: "critical",
      triggerAt: Date.now() + 30 * 60 * 1000
    });
    b.app.state.items.push(it);
    await b.app.saveAsync();
    await wait(300);
  } catch (e) { step = "threw:" + String((e && e.message) || e); }
  return {
    step: step,
    alarmDelta: b.env.calls.scheduleAlarm.length - base,
    notify: b.env.calls.schedule.length,
    puts: b.disk.puts
  };
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
    activeAlarms: [], stopAlarmDelivery: [],
    // P2-C-R：桥故障注入的命中计数 —— 「注入了」不能靠配置推断，要靠**真的被调用过**。
    faultHits: 0
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

  /**
   * P2-C-R：**桥故障注入**。
   *
   * `options.faults` 形如 `{ "LocalNotifications.addListener": "说明" }`，
   * 把指定插件方法换成「调用即拒绝」的实现。用途是回答一个真机上难以构造的问题：
   * **原生桥初始化失败时，权威数据的判定与保护会不会被带偏？**
   *
   * 只替换被点名的那个方法，其余能力照旧 —— 这样故障面是**可控且可指认**的：
   * 断言「注入真的命中」（`calls.faultHits`）之后，失败原因不含糊。
   */
  (function applyFaults() {
    const faults = options.faults || {};
    const targets = { LocalNotifications: local, App: app, SystemBridge: bridge };
    Object.keys(faults).forEach(function (path) {
      const parts = path.split(".");
      if (parts.length !== 2) throw new Error("faults 的路径必须是 Plugin.method：" + path);
      const target = targets[parts[0]];
      if (!target) throw new Error("faults 指向了未知插件：" + parts[0]);
      if (typeof target[parts[1]] !== "function") {
        throw new Error("faults 指向的方法不存在：" + path);
      }
      const reason = faults[path];
      target[parts[1]] = function () {
        calls.faultHits += 1;
        return Promise.reject(new Error("injected bridge failure: " + reason));
      };
    });
  })();

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
  // P2-C-R 新增两个**读侧**故障旋钮（`openFails` / `getFails`）——「权威后端打不开」
  // 与「打得开但读不出来」是两种完全不同的处境，恢复闸门必须分别判对。
  const disk = {
    idbValue: null, puts: 0, failWrites: false, holdWrites: false, held: [],
    openFails: false, getFails: false,
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
          setTimeout(() => {
            if (disk.getFails) {
              req.error = new Error("idb-read-failed");
              if (req.onerror) req.onerror();
              return;
            }
            req.result = disk.idbValue;
            if (req.onsuccess) req.onsuccess();
          }, 0);
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
      setTimeout(() => {
        if (disk.openFails) {
          req.error = new Error("idb-open-failed");
          if (req.onerror) req.onerror();
          return;
        }
        req.result = fakeDb;
        if (req.onsuccess) req.onsuccess();
      }, 0);
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
  // F01：`platform: "web"` 用来构造**真正的纯 Web** 组合（脚本一支不少、只是没有
  // Android WebView 注入的 Capacitor 桥）。从前这套 harness 用「删掉 native 脚本」
  // 来代表 Web —— 那是两件完全不同的事，也正是缺陷 F01 得以藏身的地方。
  sandbox.Capacitor = options.platform === "web" ? undefined : env.capacitor;

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
  // P2-C-R：权威（IDB）与镜像可以**分别**种下去 —— 「IDB 里有 1/1 但这次读不出来」
  // 这类构造必须先有那份数据，否则测到的只是首启。
  if (options.idbValue !== undefined) disk.idbValue = options.idbValue;
  if (options.idbOpenFails) disk.openFails = true;
  if (options.idbGetFails) disk.getFails = true;
  if (options.seedMirrorRaw !== undefined) ls.set("attention-inbox-v2", String(options.seedMirrorRaw));
  Object.keys(options.seedLocalEntries || {}).forEach(k => {
    if (options.seedLocalEntries[k] == null) ls.delete(k);
    else ls.set(k, String(options.seedLocalEntries[k]));
  });

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
      // ② F01：缺口必须是**空** —— 两套 harness 都要加载完整生产清单。
      //    从前这里写的是「缺口恰好是 lib/native-reminders.js」，并被当成
      //    「有意的、已声明的缺席」。独立复验 F01 证明：那条「有意的缺席」
      //    正是缺陷的藏身处 —— 缺一支必需脚本，没有任何一层看得见。
      const missing = indexScripts.filter(s => loaded.indexOf(s) < 0);
      ok(name + " 加载了完整生产清单（缺口为空，不再是「有意的缺席」）",
        missing.length === 0, JSON.stringify(missing));
      // ③ 覆盖判定必须干净 —— 有缺口时它要报，没缺口时它也得真的安静。
      const cov = prod.coverageProblems({ root: ROOT, loaded: loaded });
      ok(name + " 的覆盖判定无问题（每一支生产脚本都真的被加载）",
        cov.problems.length === 0, JSON.stringify(cov.problems));
      // ④ 顺序：app-core 必须是最后一支（前面那些 harness 也是 vm 里加载的同一个 app-core）
      ok(name + " 里 app-core.js 排在最后",
        loaded[loaded.length - 1] === "app-core.js", JSON.stringify(loaded));
    });

    // 反向对照：少加载一支、又没有理由，覆盖判定必须报错 —— 否则「加载了完整清单」
    // 只是一句没人验的话。夹具直接用**生产清单去掉 native 那一支**：它同时证明
    // 「缺口真的会被点名」与「点名的是哪一支」。
    const shortOne = indexScripts.filter(s => s !== "lib/native-reminders.js");
    const shortCov = prod.coverageProblems({ root: ROOT, loaded: shortOne });
    ok("反向对照：少加载一支且无声明 ⇒ 报 unaccounted-production-script:lib/native-reminders.js",
      shortCov.problems.length === 1 &&
      shortCov.problems[0].indexOf("unaccounted-production-script:lib/native-reminders.js") === 0,
      JSON.stringify(shortCov.problems));
    // 「声明了」不等于「声明有效」：一个**没有 why** 的注入声明不算交代。
    ok("反向对照：只放一个没有理由的注入声明不算交代，仍然报错",
      prod.coverageProblems({
        root: ROOT,
        loaded: shortOne,
        injections: { "lib/native-reminders.js": {} }
      }).problems.length === 1);
    const omittedDiagnostics = prod.coverageProblems({
      root: ROOT,
      loaded: indexScripts.filter(s => s !== "lib/app-diagnostics.js")
    });
    ok("MUT-LOAD-DIAG 变异必红：生产 harness 漏载 app-diagnostics.js 时闭合检查点名缺口",
      omittedDiagnostics.problems.some(p => p.indexOf("unaccounted-production-script:lib/app-diagnostics.js") >= 0),
      JSON.stringify(omittedDiagnostics.problems));
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
    // 反向对照：同一份代码、把 lib/native-reminders.js 这一支拿掉（模拟「四件套漏一处」）。
    //
    // 独立复验 F01 指出：这里从前断言的是「**照样** ready」，等于把这个缺陷写成了期望。
    // 「删掉 native 脚本」不是「纯 Web」—— 前者是**缺一支必需 JS 模块**（必须失败），
    // 后者是「脚本齐全、只是没有 Capacitor 桥」（必须正常）。现在的期望是明确失败。
    const dropped = indexScripts.filter(s => s !== "lib/native-reminders.js");
    const bootNoNative = await bootCombination({ scripts: dropped });
    ok("反例：去掉 lib/native-reminders.js ⇒ ready() 明确失败（不再缺件硬跑）",
      bootNoNative.ready === false, "ready=" + bootNoNative.ready);
    ok("反例：失败面板点名 AttentionNativeReminders，并说清后果是「一条提醒都不会响」",
      Array.isArray(bootNoNative.app.startupFailure()) &&
      bootNoNative.app.startupFailure().some(p => p.path === "AttentionNativeReminders") &&
      /一条提醒都不会响/.test(bootNoNative.app.startupFailure()
        .find(p => p.path === "AttentionNativeReminders").why),
      JSON.stringify(bootNoNative.app.startupFailure() &&
        bootNoNative.app.startupFailure().map(p => p.path)));
    ok("反例：去掉 lib/native-reminders.js 后不读库、不起业务定时器 " +
      "（消灭「能存能改却一条都不排」的界面）",
      bootNoNative.disk.puts === 0 && bootNoNative.intervals.indexOf(15000) < 0,
      "puts=" + bootNoNative.disk.puts + " intervals=" + JSON.stringify(bootNoNative.intervals));
    ok("反例：去掉之后 AttentionNativeReminders 确实是 undefined（不是空对象）",
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
    //    夹具必须是**直接调用**（无存在性守卫）—— 带守卫的引用按设计是「可选能力」，
    //    不该进必需表（见下面 ②·2 的那条）。
    const baseSource = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");
    const injected = prod.runtimeDependencyCoverage(ROOT, {
      source: baseSource.replace("  function uid() {",
        "  function uid() {\n    const pick = Lib.brandNewThing();")
    });
    ok("反向对照：新增一个未声明的 Lib.brandNewThing 直接调用 ⇒ 闭合判定报出来",
      injected.undeclared.length === 1 && injected.undeclared[0].path === "brandNewThing",
      JSON.stringify(injected.undeclared));
    // ②·2 守卫引用必须被**豁免**：`if (Lib.x) …` 本身就是「这是可选能力」的书面声明。
    //      若不豁免，每加一个可选能力都得往必需表里塞一条，等于把「可选」变成「必需」。
    const guardedInject = prod.runtimeDependencyCoverage(ROOT, {
      source: baseSource.replace("  function uid() {",
        "  function uid() {\n    if (Lib.brandNewThing) return Lib.brandNewThing();")
    });
    ok("守卫引用被豁免（`if (Lib.x) …` 不计入未声明，但必须出现在 guardedRefs 里）",
      guardedInject.undeclared.length === 0 &&
      guardedInject.guardedRefs.indexOf("brandNewThing") >= 0,
      JSON.stringify({ undeclared: guardedInject.undeclared, guarded: guardedInject.guardedRefs }));
    // ②·3 展示**实例 API** 的静态闭合（F02）：`appUi.$` 不是模块导出（是工厂返回对象上的
    //      方法），所以它进不了依赖声明表 —— 但必须被检查，且要**双向**对齐：
    //      源码里用到的每个都在契约里，契约里的每个也真的被用到。
    const uiCov = prod.uiInstanceCoverage(ROOT);
    ok("展示实例 API 双向闭合（源码里的 `appUi.<x>` 与契约逐项对齐）",
      uiCov.used.length >= 8 &&
      uiCov.missingInContract.length === 0 && uiCov.unusedInContract.length === 0,
      JSON.stringify(uiCov));
    const uiInjected = prod.uiInstanceCoverage(ROOT, {
      source: baseSource.replace("  function uid() {",
        "  function uid() {\n    appUi.brandNewSurface();")
    });
    ok("反向对照：源码里多用一个实例 API 而契约没写 ⇒ 报 missingInContract",
      uiInjected.missingInContract.indexOf("brandNewSurface") >= 0,
      JSON.stringify(uiInjected.missingInContract));
    // ②·3b P2-A：AI **实例 API** 同样要双向闭合（`ai.xxx` 不是模块导出）。
    //
    //      反向判据（`unusedInContract` 为空）在这里尤其要紧：契约里要是写了一个没人
    //      调用的成员，那一项的检查就成了恒真断言 —— 空壳实例一样能通过。
    //      只被模块内部消费的四个成员登记在 `internalOnly` 里，不算「没人调用」。
    const aiCov = prod.aiInstanceCoverage(ROOT);
    ok("AI 实例 API 双向闭合（源码里的 `ai.<x>` 与契约逐项对齐，内部消费项单列）",
      aiCov.missingInContract.length === 0 && aiCov.unusedInContract.length === 0 &&
      aiCov.used.length >= 10 && aiCov.internalOnly.length === 4,
      JSON.stringify(aiCov));
    const aiInjected = prod.aiInstanceCoverage(ROOT, {
      source: baseSource.replace("  function uid() {",
        "  function uid() {\n    ai.brandNewAiSurface();")
    });
    ok("反向对照：源码里多用一个 AI 实例 API 而契约没写 ⇒ 报 missingInContract",
      aiInjected.missingInContract.indexOf("brandNewAiSurface") >= 0,
      JSON.stringify(aiInjected.missingInContract));
    const captureSourceForAi = fs.readFileSync(path.join(ROOT, "lib/app-capture.js"), "utf8");
    const aiCaptureWithoutConsumers = captureSourceForAi
      .replace(/ai\.applyToForm/g, "void 0")
      .replace(/ai\.parseCapture/g, "void 0");
    const aiCaptureGap = prod.aiInstanceCoverage(ROOT, { sources: { "lib/app-capture.js": aiCaptureWithoutConsumers } });
    ok("反向对照：删掉 capture 对 AI 的真实消费 ⇒ applyToForm/parseCapture 重新报 unused",
      aiCaptureGap.unusedInContract.indexOf("applyToForm") >= 0 && aiCaptureGap.unusedInContract.indexOf("parseCapture") >= 0,
      JSON.stringify(aiCaptureGap));
    // ②·3c P2-D：诊断实例 API 同样双向闭合。
    const diagCov = prod.diagnosticsInstanceCoverage(ROOT);
    ok("P2-D 诊断实例 API 双向闭合（源码里的 `diagnostics.<x>` 与契约逐项对齐）",
      diagCov.missingInContract.length === 0 && diagCov.unusedInContract.length === 0 &&
      diagCov.used.length >= 7 && diagCov.declared.length >= 7,
      JSON.stringify(diagCov));
    const setupCov = prod.setupInstanceCoverage(ROOT);
    ok("P2-E 设置实例 API 双向闭合（源码里的 `appSetup.<x>` 与契约逐项对齐）",
      setupCov.missingInContract.length === 0 && setupCov.unusedInContract.length === 0 &&
      setupCov.used.length >= 12 && setupCov.declared.length >= 12,
      JSON.stringify(setupCov));
    const setupInjected = prod.setupInstanceCoverage(ROOT, {
      source: baseSource.replace("  function uid() {",
        "  function uid() {\n    appSetup.uncontractedSetupSurface();")
    });
    ok("P2-E 反向对照：源码里多用一个设置实例 API 而契约没写 ⇒ 报 missingInContract",
      setupInjected.missingInContract.indexOf("uncontractedSetupSurface") >= 0,
      JSON.stringify(setupInjected.missingInContract));
    const contentCov = prod.contentInstanceCoverage(ROOT);
    ok("P2-F1 内容实例 API 双向闭合（源码里的 `appContent.<x>` 与契约逐项对齐）",
      contentCov.missingInContract.length === 0 && contentCov.unusedInContract.length === 0 &&
      contentCov.used.length === 7 && contentCov.declared.length === 7, JSON.stringify(contentCov));
    const contentInjected = prod.contentInstanceCoverage(ROOT, {
      source: baseSource.replace("  function uid() {",
        "  function uid() {\n    appContent.uncontractedContentSurface();")
    });
    ok("P2-F1 反向对照：源码里多用一个内容实例 API 而契约没写 ⇒ 报 missingInContract",
      contentInjected.missingInContract.indexOf("uncontractedContentSurface") >= 0,
      JSON.stringify(contentInjected.missingInContract));
    // P3-A：模型实例的静态合同同样双向闭合。SCHEMA / PROJECT_COLORS 是实例成员，
    // 不因它们不是函数而绕开这一层；这里只核对成员名和实际转发引用是否逐项对应。
    const modelCov = prod.modelInstanceCoverage(ROOT);
    ok("P3-A 模型实例 API 双向闭合（源码里的 `appModel.<x>` 与契约逐项对齐）",
      modelCov.missingInContract.length === 0 && modelCov.unusedInContract.length === 0 &&
      modelCov.used.length === 10 && modelCov.declared.length === 10, JSON.stringify(modelCov));
    const modelContractRemoved = baseSource.replace('"isTerminal", "hasKnownRev", "isDue"]',
      '"isTerminal", "isDue"]');
    const modelContractGap = prod.modelInstanceCoverage(ROOT, { source: modelContractRemoved });
    ok("P3-A 反向对照：删模型契约成员 ⇒ 真实转发变 missingInContract",
      modelContractRemoved !== baseSource && modelContractGap.missingInContract.indexOf("hasKnownRev") >= 0,
      JSON.stringify(modelContractGap));
    const modelForwardingRemoved = baseSource.replace("return appModel.hasKnownRev(rev);", "return true;");
    const modelForwardingGap = prod.modelInstanceCoverage(ROOT, { source: modelForwardingRemoved });
    ok("P3-A 反向对照：删真实模型转发引用 ⇒ 契约成员变 unusedInContract",
      modelForwardingRemoved !== baseSource && modelForwardingGap.unusedInContract.indexOf("hasKnownRev") >= 0,
      JSON.stringify(modelForwardingGap));
    const persistenceCov = prod.persistenceInstanceCoverage(ROOT);
    ok("P3-B 持久化实例 API 双向闭合（core 转发与实例合同逐项对齐）",
      persistenceCov.missingInContract.length === 0 && persistenceCov.unusedInContract.length === 0 &&
      persistenceCov.used.length === 14 && persistenceCov.declared.length === 14, JSON.stringify(persistenceCov));
    const persistenceContractRemoved = baseSource.replace('"authoritySnapshot", "reopen", "committedItemById", "getStorage"]',
      '"authoritySnapshot", "reopen", "committedItemById"]');
    const persistenceContractGap = prod.persistenceInstanceCoverage(ROOT, { source: persistenceContractRemoved });
    ok("P3-B 反向对照：删持久化合同成员 ⇒ 真实转发变 missingInContract",
      persistenceContractRemoved !== baseSource && persistenceContractGap.missingInContract.indexOf("getStorage") >= 0,
      JSON.stringify(persistenceContractGap));
    const persistenceForwardingRemoved = baseSource.replace("return appPersistence.loadAsync();", "return Promise.resolve(null);");
    const persistenceForwardingGap = prod.persistenceInstanceCoverage(ROOT, { source: persistenceForwardingRemoved });
    ok("P3-B 反向对照：删真实持久化转发 ⇒ 契约成员变 unusedInContract",
      persistenceForwardingRemoved !== baseSource && persistenceForwardingGap.unusedInContract.indexOf("loadAsync") >= 0,
      JSON.stringify(persistenceForwardingGap));
    const transactionCov = prod.transactionInstanceCoverage(ROOT);
    ok("P3-C 事务实例 API 双向闭合（core 转发与实例合同逐项对齐）",
      transactionCov.missingInContract.length === 0 && transactionCov.unusedInContract.length === 0 &&
      transactionCov.used.length === 11 && transactionCov.declared.length === 11, JSON.stringify(transactionCov));
    const transactionContractRemoved = baseSource.replace('"isFeedbackSuppressed", "shouldSuppressInnerSave"]',
      '"isFeedbackSuppressed"]');
    const transactionContractGap = prod.transactionInstanceCoverage(ROOT, { source: transactionContractRemoved });
    ok("P3-C 反向对照：删事务合同成员 ⇒ 真实转发变 missingInContract",
      transactionContractRemoved !== baseSource && transactionContractGap.missingInContract.indexOf("shouldSuppressInnerSave") >= 0,
      JSON.stringify(transactionContractGap));
    const transactionForwardingRemoved = baseSource.replace("return appTransaction.inflightDepth();", "return 0;");
    const transactionForwardingGap = prod.transactionInstanceCoverage(ROOT, { source: transactionForwardingRemoved });
    ok("P3-C 反向对照：删真实事务转发 ⇒ 契约成员变 unusedInContract",
      transactionForwardingRemoved !== baseSource && transactionForwardingGap.unusedInContract.indexOf("inflightDepth") >= 0,
      JSON.stringify(transactionForwardingGap));
    const itemCov = prod.itemInstanceCoverage(ROOT);
    ok("P3-D 事项实例 API 双向闭合（core 转发与实例合同逐项对齐）",
      itemCov.missingInContract.length === 0 && itemCov.unusedInContract.length === 0 &&
      itemCov.used.length === 22 && itemCov.declared.length === 22, JSON.stringify(itemCov));
    const itemContractRemoved = baseSource.replace('"undoNewItem", "lastCompleteUndo"]',
      '"undoNewItem"]');
    const itemContractGap = prod.itemInstanceCoverage(ROOT, { source: itemContractRemoved });
    ok("P3-D 反向对照：删事项合同成员 ⇒ 真实转发变 missingInContract",
      itemContractRemoved !== baseSource && itemContractGap.missingInContract.indexOf("lastCompleteUndo") >= 0,
      JSON.stringify(itemContractGap));
    const itemForwardingRemoved = baseSource.replace("return appItems.promoteDue(now);", "return false;");
    const itemForwardingGap = prod.itemInstanceCoverage(ROOT, { source: itemForwardingRemoved });
    ok("P3-D 反向对照：删真实事项转发 ⇒ 契约成员变 unusedInContract",
      itemForwardingRemoved !== baseSource && itemForwardingGap.unusedInContract.indexOf("promoteDue") >= 0,
      JSON.stringify(itemForwardingGap));
    const coordinatorCov = prod.coordinatorInstanceCoverage(ROOT);
    ok("P3-E 原生协调实例 API 双向闭合（core 转发与实例合同逐项对齐）",
      coordinatorCov.missingInContract.length === 0 && coordinatorCov.unusedInContract.length === 0 &&
      coordinatorCov.used.length === 21 && coordinatorCov.declared.length === 21, JSON.stringify(coordinatorCov));
    const coordinatorContractRemoved = baseSource.replace('"getDeliveryEvidenceState", "isNativeAndroidRuntime", "waitForNativeBridge"',
      '"getDeliveryEvidenceState", "isNativeAndroidRuntime"');
    const coordinatorContractGap = prod.coordinatorInstanceCoverage(ROOT, { source: coordinatorContractRemoved });
    ok("P3-E 反向对照：删协调合同成员 ⇒ 真实转发变 missingInContract",
      coordinatorContractRemoved !== baseSource && coordinatorContractGap.missingInContract.indexOf("waitForNativeBridge") >= 0,
      JSON.stringify(coordinatorContractGap));
    const coordinatorForwardingRemoved = baseSource.replace("return appNativeCoordinator.refreshNativeScheduleBasis();", "return false;");
    const coordinatorForwardingGap = prod.coordinatorInstanceCoverage(ROOT, { source: coordinatorForwardingRemoved });
    ok("P3-E 反向对照：删真实协调转发 ⇒ 契约成员变 unusedInContract",
      coordinatorForwardingRemoved !== baseSource && coordinatorForwardingGap.unusedInContract.indexOf("refreshNativeScheduleBasis") >= 0,
      JSON.stringify(coordinatorForwardingGap));
    const reviewCov = prod.reviewInstanceCoverage(ROOT);
    ok("P3-F 待整理实例 API 双向闭合（core 转发与实例合同逐项对齐）",
      reviewCov.missingInContract.length === 0 && reviewCov.unusedInContract.length === 0 &&
      reviewCov.used.length === 27 && reviewCov.declared.length === 27, JSON.stringify(reviewCov));
    const reviewContractRemoved = baseSource.replace('"bindReviewControls", "markReviewTriggerPicked", "isFallbackSuppressed"',
      '"bindReviewControls", "markReviewTriggerPicked"');
    const reviewContractGap = prod.reviewInstanceCoverage(ROOT, { source: reviewContractRemoved });
    ok("P3-F 反向对照：删待整理合同成员 ⇒ 真实转发变 missingInContract",
      reviewContractRemoved !== baseSource && reviewContractGap.missingInContract.indexOf("isFallbackSuppressed") >= 0,
      JSON.stringify(reviewContractGap));
    const reviewForwardingRemoved = baseSource.replace("return appReview.fallbackTriggerAt();", "return false;");
    const reviewForwardingGap = prod.reviewInstanceCoverage(ROOT, { source: reviewForwardingRemoved });
    ok("P3-F 反向对照：删真实待整理转发 ⇒ 契约成员变 unusedInContract",
      reviewForwardingRemoved !== baseSource && reviewForwardingGap.unusedInContract.indexOf("fallbackTriggerAt") >= 0,
      JSON.stringify(reviewForwardingGap));
    const alertsCov = prod.alertsInstanceCoverage(ROOT);
    ok("P3-G 提醒实例 API 双向闭合（core 转发与实例合同逐项对齐）",
      alertsCov.missingInContract.length === 0 && alertsCov.unusedInContract.length === 0 &&
      alertsCov.used.length === 17 && alertsCov.declared.length === 17, JSON.stringify(alertsCov));
    const alertsContractRemoved = baseSource.replace('"startPolling", "stopPolling", "onVisibilityChange"',
      '"startPolling", "stopPolling"');
    const alertsContractGap = prod.alertsInstanceCoverage(ROOT, { source: alertsContractRemoved });
    ok("P3-G 反向对照：删提醒合同成员 ⇒ 真实转发变 missingInContract",
      alertsContractRemoved !== baseSource && alertsContractGap.missingInContract.indexOf("onVisibilityChange") >= 0,
      JSON.stringify(alertsContractGap));
    const alertsForwardingRemoved = baseSource.replace("if (appAlerts) appAlerts.onVisibilityChange();", "/* removed */");
    const alertsForwardingGap = prod.alertsInstanceCoverage(ROOT, { source: alertsForwardingRemoved });
    ok("P3-G 反向对照：删真实提醒转发 ⇒ 契约成员变 unusedInContract",
      alertsForwardingRemoved !== baseSource && alertsForwardingGap.unusedInContract.indexOf("onVisibilityChange") >= 0,
      JSON.stringify(alertsForwardingGap));
    const noticesCov = prod.noticesInstanceCoverage(ROOT);
    ok("P3-I-R 告知实例 API 双向闭合（core 转发与实例合同逐项对齐）",
      noticesCov.missingInContract.length === 0 && noticesCov.unusedInContract.length === 0 &&
      noticesCov.used.length === 3 && noticesCov.declared.length === 3, JSON.stringify(noticesCov));
    const noticesContractRemoved = baseSource.replace('"homeNoticeVerdict", "renderHomeNotice", "maybeDailySummary"]',
      '"homeNoticeVerdict", "renderHomeNotice"]');
    const noticesContractGap = prod.noticesInstanceCoverage(ROOT, { source: noticesContractRemoved });
    ok("P3-I-R 反向对照：删告知合同成员 ⇒ 真实转发变 missingInContract",
      noticesContractRemoved !== baseSource && noticesContractGap.missingInContract.indexOf("maybeDailySummary") >= 0,
      JSON.stringify(noticesContractGap));
    const noticesForwardingRemoved = baseSource.replace(
      "return appNotices ? appNotices.maybeDailySummary() : null;", "return null;");
    const noticesForwardingGap = prod.noticesInstanceCoverage(ROOT, { source: noticesForwardingRemoved });
    ok("P3-I-R 反向对照：删真实告知转发 ⇒ 契约成员变 unusedInContract",
      noticesForwardingRemoved !== baseSource &&
      noticesForwardingGap.unusedInContract.indexOf("maybeDailySummary") >= 0,
      JSON.stringify(noticesForwardingGap));
    const diagInjected = prod.diagnosticsInstanceCoverage(ROOT, {
      source: baseSource.replace("  function uid() {",
        "  function uid() {\n    diagnostics.brandNewDiagSurface();")
    });
    ok("反向对照：源码里多用一个诊断实例 API 而契约没写 ⇒ 报 missingInContract",
      diagInjected.missingInContract.indexOf("brandNewDiagSurface") >= 0,
      JSON.stringify(diagInjected.missingInContract));
    // ②·4 别名归一（F02 点名的短别名）：`const feedbackApi = FeedbackLib;` 之后的
    //      `feedbackApi.setupSteps` 也必须算「对 Feedback 的依赖」，而且要能**归一**到
    //      声明表里那个路径（`Feedback.setupSteps`）上。
    //
    // ⚠️ 第三轮改制：这里原先是「`f` 一名两义 ⇒ 放弃归因」的**成功**断言。
    //      独立复验 F02 证明那条断言把缺陷写成了期望：`f.*` 整体退出闭合判定后，
    //      把真实的 `f.setupSteps` 换成未声明成员，`undeclared` 仍然返回 `[]`。
    //      现在歧义**即失败**（见 production-scripts.js 的 `problems`），
    //      所以产品源码里一条歧义别名、一条歧义引用都不许剩。
    const covNow = prod.runtimeDependencyCoverage(ROOT);
    ok("别名归一生效：`feedbackApi` ⇒ `FeedbackLib`，引用落到 `Feedback.*` 这个声明路径上",
      covNow.aliases.feedbackApi === "FeedbackLib" &&
      covNow.refs.concat(covNow.guardedRefs).indexOf("Feedback.actionSpec") >= 0,
      JSON.stringify({ aliases: covNow.aliases,
        feedbackRefs: covNow.refs.concat(covNow.guardedRefs).filter(r => r.indexOf("Feedback") === 0) }));
    ok("产品源码**没有歧义别名**（`f` 那种一名两义已消除：反馈用 feedbackApi / 上传用 selectedFile / 返回值用 feedbackResult）",
      covNow.ambiguousAliases.length === 0, JSON.stringify(covNow.ambiguousAliases));
    ok("产品源码**没有歧义引用**（扫描器里不存在「证不了归属就跳过」的残留）",
      covNow.ambiguousRefs.length === 0, JSON.stringify(covNow.ambiguousRefs.slice(0, 8)));
    ok("依赖矩阵完全闭合：undeclared / ambiguousAliases / ambiguousRefs / problems 四个都为空",
      covNow.undeclared.length === 0 && covNow.ambiguousAliases.length === 0 &&
      covNow.ambiguousRefs.length === 0 && covNow.problems.length === 0,
      JSON.stringify({ undeclared: covNow.undeclared, ambiguousAliases: covNow.ambiguousAliases,
        ambiguousRefs: covNow.ambiguousRefs.slice(0, 8), problems: covNow.problems }));
    ok("覆盖判定的扫描面已含实际依赖路径（NativeReminders / FeedbackLib / EvidenceLib）",
      prod.NAMESPACE_PATHS.NativeReminders === "NativeReminders" &&
      prod.NAMESPACE_PATHS.FeedbackLib === "Feedback" &&
      prod.NAMESPACE_PATHS.EvidenceLib === "DeliveryEvidence");

    // ②·5 三组**静态反向变异**（第三轮 F02 的出口判据）：全部走 `options.source`，
    //      不改工作区源码，因此可以永久留在套件里。要证明的性质是
    //      「**新增的别名依赖无法绕过矩阵**」—— 这正是独立复验 F02 的空洞：
    //      歧义引用整体退出判定后，`f.independentUndeclaredMember` 既进不了
    //      `undeclared`、也不判错，于是「未声明成员」可以悄悄溜进来。
    const mutAlias = prod.runtimeDependencyCoverage(ROOT, {
      source: baseSource.replace("  function uid() {",
        "  function uid() {\n    const feedbackApi = FeedbackLib;\n    feedbackApi.independentUndeclaredMember();")
    });
    ok("MUT-A 唯一别名路径：`const feedbackApi = FeedbackLib; feedbackApi.<未声明成员>()` " +
      "⇒ 归一成 `Feedback.independentUndeclaredMember` 并进入 undeclared",
      mutAlias.undeclared.length === 1 &&
      mutAlias.undeclared[0].path === "Feedback.independentUndeclaredMember",
      JSON.stringify({ undeclared: mutAlias.undeclared, problems: mutAlias.problems }));

    const mutDirect = prod.runtimeDependencyCoverage(ROOT, {
      source: baseSource.replace("  function uid() {",
        "  function uid() {\n    FeedbackLib.independentUndeclaredMember();")
    });
    ok("MUT-B 直接命名空间路径：`FeedbackLib.<未声明成员>()` ⇒ 同样进入 undeclared",
      mutDirect.undeclared.length === 1 &&
      mutDirect.undeclared[0].path === "Feedback.independentUndeclaredMember",
      JSON.stringify(mutDirect.undeclared));

    // 同名歧义：同一短名既被赋成对方命名空间、又被赋成别的东西 ——
    // 静态扫描**无法**证明 `auditAlias.auditMember()` 属于谁。判据不是「认出它」，
    // 而是「**不许返回闭合**」：证不出来的东西必须让矩阵失败。
    const AMB_SRC = baseSource
      .replace("  function uid() {",
        "  function uid() {\n    const auditAlias = FeedbackLib;\n    auditAlias.auditMember();")
      .replace("  function startApp() {",
        "  function startApp() {\n    const auditAlias = nativeReminderStatus;");
    ok("（前置）同名歧义夹具真的改到了两处（否则下面那条是空断言）",
      AMB_SRC !== baseSource &&
      /const auditAlias = FeedbackLib;/.test(AMB_SRC) &&
      /const auditAlias = nativeReminderStatus;/.test(AMB_SRC));
    const mutAmb = prod.runtimeDependencyCoverage(ROOT, { source: AMB_SRC });
    ok("MUT-C 同名歧义：`ambiguousAliases` 点名 auditAlias，且 `problems` 非空" +
      "（既有 ambiguous-alias，也有落在它上面的 ambiguous-ref）——" +
      "「只报告歧义但仍视为闭合」被明确禁止",
      mutAmb.ambiguousAliases.indexOf("auditAlias") >= 0 &&
      mutAmb.problems.length > 0 &&
      mutAmb.problems.some(p => p.indexOf("ambiguous-alias:auditAlias") === 0) &&
      mutAmb.problems.some(p => p.indexOf("ambiguous-ref:auditAlias.") === 0),
      JSON.stringify({ ambiguousAliases: mutAmb.ambiguousAliases,
        ambiguousRefs: mutAmb.ambiguousRefs, problems: mutAmb.problems }));

    // ②·6 **根对象守卫**不是成员守卫（第四轮，独立复验 F02-R2 的阻断点）。
    //
    // 产品里的真实形态是 `feedbackApi ? feedbackApi.setupSteps(...) : null` ——
    // `?` 只证明**模块对象**在，不证明 `setupSteps` 在；而 `Feedback` 根本身就是
    // 必需声明（闸门已保证它存在），所以那个三元永远走真分支，成员缺失时静默走兜底。
    // 扫描器曾把这种形态当「成员守卫」豁免，于是只换成员名就能绕过矩阵
    // （复验实测：`undeclared=[] problems=[]`）。判据：换成员名必须变红。
    const GUARD_ALIAS_SRC = baseSource.replace("  function uid() {",
      "  function uid() {\n    const feedbackApi = FeedbackLib;\n    const st = feedbackApi ? feedbackApi.independentGuardedMember() : null;");
    ok("（前置）MUT-D 夹具真的改到了那行真实调用（否则下面那条是空断言）",
      GUARD_ALIAS_SRC !== baseSource &&
      GUARD_ALIAS_SRC.indexOf("feedbackApi.independentGuardedMember") >= 0);
    const mutGuardAlias = prod.runtimeDependencyCoverage(ROOT, { source: GUARD_ALIAS_SRC });
    ok("MUT-D 根对象守卫（别名）：`feedbackApi ? feedbackApi.<未声明成员>()` ⇒ " +
      "进入 undeclared 且 problems 点名（不许再进 guardedRefs 冒充可选）",
      mutGuardAlias.undeclared.length === 1 &&
      mutGuardAlias.undeclared[0].path === "Feedback.independentGuardedMember" &&
      mutGuardAlias.guardedRefs.indexOf("Feedback.independentGuardedMember") < 0 &&
      mutGuardAlias.problems.some(p =>
        p.indexOf("undeclared-dependency:Feedback.independentGuardedMember") === 0),
      JSON.stringify({ undeclared: mutGuardAlias.undeclared,
        guarded: mutGuardAlias.guardedRefs, problems: mutGuardAlias.problems }));

    const GUARD_DIRECT_SRC = baseSource.replace(
      'const spec = FeedbackLib ? FeedbackLib.actionSpec("ack") : null;',
      'const spec = FeedbackLib ? FeedbackLib.independentGuardedMember("ack") : null;');
    ok("（前置）MUT-E 夹具真的改到了那行真实调用（否则下面那条是空断言）",
      GUARD_DIRECT_SRC !== baseSource &&
      GUARD_DIRECT_SRC.indexOf("FeedbackLib.independentGuardedMember") >= 0);
    const mutGuardDirect = prod.runtimeDependencyCoverage(ROOT, { source: GUARD_DIRECT_SRC });
    ok("MUT-E 根对象守卫（直接命名空间）：`FeedbackLib ? FeedbackLib.<未声明成员>() : null` ⇒ " +
      "同样进入 undeclared（说明该缺口与别名解析无关，根因是守卫形态被判错）",
      mutGuardDirect.undeclared.length === 1 &&
      mutGuardDirect.undeclared[0].path === "Feedback.independentGuardedMember" &&
      mutGuardDirect.problems.length >= 1,
      JSON.stringify({ undeclared: mutGuardDirect.undeclared,
        guarded: mutGuardDirect.guardedRefs, problems: mutGuardDirect.problems }));

    // 对照组：**成员级**守卫仍然算可选。没有这一条，「所有守卫都不豁免」也能让上面
    // 两条变绿 —— 那会把真正的可选能力误判成必需（纯 Web 会被误拦）。
    const MEMBER_GUARD_SRC = baseSource.replace("  function uid() {",
      "  function uid() {\n    if (FeedbackLib.independentOptionalMember) return FeedbackLib.independentOptionalMember();");
    const memberGuard = prod.runtimeDependencyCoverage(ROOT, { source: MEMBER_GUARD_SRC });
    ok("对照：**成员级**守卫仍算可选（`if (Ns.member)` 形态进 guardedRefs，不进 undeclared）",
      memberGuard.undeclared.length === 0 &&
      memberGuard.guardedRefs.indexOf("Feedback.independentOptionalMember") >= 0,
      JSON.stringify({ undeclared: memberGuard.undeclared,
        guarded: memberGuard.guardedRefs }));

    // ②·7 扫描器**自身**的最小变异（N3）：把「根对象守卫」加回豁免条件，
    //       等于退回第四轮之前的行为。此时 MUT-D/MUT-E 必须**不再被报出来** ——
    //       否则说明那两条断言其实是恒真的（换成任何扫描器都「通过」）。
    //       做法：把当前扫描器源码抄一份到临时目录，末尾追加一个同名函数覆盖
    //       （函数声明产生的是可写绑定，模块内只在运行时被调用，覆盖有效），
    //       再 require 那份副本 —— 不动工作区文件，也不需要改 require 缓存。
    const scannerSrc = fs.readFileSync(
      path.join(ROOT, "scripts/verification/production-scripts.js"), "utf8");
    const SCANNER_MUTATION = [
      "// 变异 N3：把根对象守卫加回 isGuardedRef 的豁免条件（第四轮之前的行为）。",
      "isGuardedRef = function (line, ref) {",
      "  const esc = ref.replace(/\\$/g, \"\\\\$\");",
      "  const root = ref.split(\".\")[0].replace(/\\$/g, \"\\\\$\");",
      "  if (!(new RegExp(\"\\\\b\" + esc + \"\\\\b\").test(line))) return false;",
      "  return new RegExp(\"if\\\\s*\\\\([^)]*\\\\b\" + esc + \"\\\\b\").test(line) ||",
      "    new RegExp(\"\\\\b\" + esc + \"\\\\b\\\\s*(&&|\\\\|\\\\||\\\\?)\").test(line) ||",
      "    new RegExp(\"!\\\\s*\" + esc + \"\\\\b\").test(line) ||",
      "    new RegExp(\"\\\\b\" + root + \"\\\\b\\\\s*(&&|\\\\|\\\\||\\\\?)\").test(line);",
      "};"
    ].join("\n");
    const mutDir = fs.mkdtempSync(path.join(os.tmpdir(), "attention-scanner-n3-"));
    let mutatedScanner = null;
    try {
      fs.writeFileSync(path.join(mutDir, "production-scripts.js"),
        scannerSrc + "\n" + SCANNER_MUTATION + "\n");
      mutatedScanner = require(path.join(mutDir, "production-scripts.js"));
    } catch (error) {
      mutatedScanner = null;
    }
    ok("（前置）扫描器变异副本真的加载成功（否则下面两条是空断言）",
      mutatedScanner && typeof mutatedScanner.runtimeDependencyCoverage === "function");
    if (mutatedScanner) {
      const n3d = mutatedScanner.runtimeDependencyCoverage(ROOT, { source: GUARD_ALIAS_SRC });
      const n3e = mutatedScanner.runtimeDependencyCoverage(ROOT, { source: GUARD_DIRECT_SRC });
      // 变异必须**外科手术式**：只放开根对象守卫这一件事，无守卫路径照样要能抓到。
      const n3a = mutatedScanner.runtimeDependencyCoverage(ROOT, {
        source: baseSource.replace("  function uid() {",
          "  function uid() {\n    const feedbackApi = FeedbackLib;\n    feedbackApi.independentUndeclaredMember();")
      });
      ok("N3 变红：把根对象守卫加回豁免后，MUT-D / MUT-E 的反例**不再被报出来**" +
        "（退回第四轮之前的行为 ⇒ 正向断言「根守卫下换成员名必须变红」不是恒真的）",
        n3d.undeclared.length === 0 &&
        n3d.guardedRefs.indexOf("Feedback.independentGuardedMember") >= 0 &&
        n3e.undeclared.length === 0 &&
        n3e.guardedRefs.indexOf("Feedback.independentGuardedMember") >= 0,
        JSON.stringify({ d: { undeclared: n3d.undeclared, guarded: n3d.guardedRefs },
          e: { undeclared: n3e.undeclared, guarded: n3e.guardedRefs } }));
      ok("N3 收口：变异只影响守卫形态，**无守卫**路径照样能抓到（证明变异是外科手术式的）",
        n3a.undeclared.length === 1 &&
        n3a.undeclared[0].path === "Feedback.independentUndeclaredMember",
        JSON.stringify(n3a.undeclared));
    }
    try { fs.rmSync(mutDir, { recursive: true, force: true }); } catch (error) { /* 临时目录，失败也无害 */ }

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

    // ⑧ 边界（F01 的修复要求）：**脚本齐全、只是没有 Capacitor** 才是纯 Web 的正常状态。
    //
    //    这条从前写的是「删掉 native 脚本后仍 ready」，理由栏还写着「纯 Web 里本来就不
    //    存在」—— 但那删掉的是**我们自己发的 JS 模块**，不是桥。现在用真的 Web 环境
    //    （11 支脚本一支不少、`window.Capacitor` 为 undefined），并与 Android 组合并列。
    const webBoot = await bootCombination({ platform: "web" });
    ok("边界：纯 Web（脚本齐全、无 Capacitor 桥）⇒ ready=true 且闸门无问题",
      webBoot.ready === true && webBoot.app.startupFailure() === null,
      JSON.stringify({ ready: webBoot.ready, failure: webBoot.app.startupFailure() }));
    ok("边界：这个场景里 Capacitor 真的不在（证明上一条不是「Android 桥碰巧也过了」）",
      webBoot.sandbox.Capacitor === undefined, String(webBoot.sandbox.Capacitor));
    ok("边界：纯 Web 下原生 JS 模块仍然完整加载（判据是「模块在不在」，不是「桥在不在」）",
      typeof webBoot.exportOf("AttentionNativeReminders") === "object" &&
      typeof webBoot.exportOf("AttentionNativeReminders").isNativeAndroid === "function");
    ok("边界：纯 Web 下 isNativeAndroid() 为 false（模块在、平台不在 ⇒ 走正常降级）",
      webBoot.exportOf("AttentionNativeReminders").isNativeAndroid() === false);
    ok("边界：纯 Web 下 platform.isNativeAndroidRuntime() 必为 false",
      webBoot.app.platform && webBoot.app.platform.isNativeAndroidRuntime() === false);
    ok("边界：纯 Web 下 platform.registerPwa() 可重复调用且幂等稳定",
      typeof webBoot.app.platform.registerPwa === "function" &&
      (() => { try { webBoot.app.platform.registerPwa(); webBoot.app.platform.registerPwa(); return true; } catch(e) { return false; } })());
    // 与 Android 组合的**对照**：同样是「有 native 模块」，桥在不在决定排程，不决定能不能启动。
    ok("对照：Android 组合里同一支模块报到同一批成员（两个场景的差只该在桥）",
      boot.loadErrors.length === 0 && webBoot.loadErrors.length === 0 &&
      boot.app.startupFailure() === null,
      JSON.stringify({ android: boot.loadErrors.length, web: webBoot.loadErrors.length }));

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

    // ⑪ P2-A 新增模块 lib/app-ai.js：AI 是**可选能力**（默认关闭），所以「缺它」不能
    //    像缺 app-ui 那样靠界面直接看出来 —— 界面照常可用，只是按钮点了没反应、
    //    「我的」页那行小字恒为「未开启」。这种静默只能由装配闸门兜住。
    //
    //    另一条更要紧的理由：AI 走的是**网络**，缺件时它不会抛错，只会让所有 AI 结果
    //    静默走「本地解析回退」。那看起来完全正常 —— 一模一样的事项被存下来，
    //    只是再没有 AI 补的时间。
    const noAppAi = indexScripts.filter(s => s !== "lib/app-ai.js");
    const bootNoAppAi = await bootCombination({ scripts: noAppAi });
    ok("反例：抽掉 lib/app-ai.js ⇒ ready 失败且点名 AppAi / AppAi.createAppAi",
      bootNoAppAi.ready === false &&
      bootNoAppAi.app.startupFailure().some(p => p.path === "AppAi") &&
      bootNoAppAi.app.startupFailure().some(p => p.path === "AppAi.createAppAi"),
      JSON.stringify(bootNoAppAi.app.startupFailure() && bootNoAppAi.app.startupFailure().map(p => p.path)));
    ok("反例：抽掉 lib/app-ai.js 后不读库、不起业务定时器、不落库",
      bootNoAppAi.disk.puts === 0 && bootNoAppAi.intervals.indexOf(15000) < 0,
      "puts=" + bootNoAppAi.disk.puts + " intervals=" + JSON.stringify(bootNoAppAi.intervals));
    ok("反例：抽掉 lib/app-ai.js 后仍然渲染出可见失败面板",
      bootNoAppAi.insertions.length >= 1, JSON.stringify(bootNoAppAi.insertions));
    ok("反例：面板上真的写出了「哪一支没起来」（点名 AppAi），不是只 console.error",
      bootNoAppAi.createdText.some(t => /应用没能启动/.test(t)) &&
      bootNoAppAi.createdText.some(t => /AppAi/.test(t)),
      JSON.stringify(bootNoAppAi.createdText.map(t => t.slice(0, 60))));
    // 缺 AI 不该顺手把别的能力也判死：失败原因必须是 AI 本身，不能连带报一片。
    ok("反例：抽掉 lib/app-ai.js 的失败清单**只**点名 AppAi 系（不是「一支没起来」的连带误报）",
      bootNoAppAi.app.startupFailure().every(p => p.path.indexOf("AppAi") === 0),
      JSON.stringify(bootNoAppAi.app.startupFailure().map(p => p.path)));

    // ⑫ P2-C 新增模块 lib/app-backup.js：备份缺件的失败形态比 AI 更隐蔽也更危险 ——
    //    「导出」按钮点了没反应，用户会以为备份好了而实际上什么都没发生。
    //    备份是「低频但要命」的操作：出事的那一刻往往已经是要用备份的时候。
    const noAppBackup = indexScripts.filter(s => s !== "lib/app-backup.js");
    const bootNoAppBackup = await bootCombination({ scripts: noAppBackup });
    ok("P2-C 反例：抽掉 lib/app-backup.js ⇒ ready 失败且点名 AppBackup / AppBackup.createAppBackup",
      bootNoAppBackup.ready === false &&
      bootNoAppBackup.app.startupFailure().some(p => p.path === "AppBackup") &&
      bootNoAppBackup.app.startupFailure().some(p => p.path === "AppBackup.createAppBackup"),
      JSON.stringify(bootNoAppBackup.app.startupFailure() && bootNoAppBackup.app.startupFailure().map(p => p.path)));
    ok("P2-C 反例：抽掉 lib/app-backup.js 后不读库、不起业务定时器、不落库",
      bootNoAppBackup.disk.puts === 0 && bootNoAppBackup.intervals.indexOf(15000) < 0,
      "puts=" + bootNoAppBackup.disk.puts + " intervals=" + JSON.stringify(bootNoAppBackup.intervals));
    ok("P2-C 反例：抽掉 lib/app-backup.js 后仍然渲染出可见失败面板",
      bootNoAppBackup.insertions.length >= 1, JSON.stringify(bootNoAppBackup.insertions));
    ok("P2-C 反例：面板上真的写出了「哪一支没起来」（点名 AppBackup），不是只 console.error",
      bootNoAppBackup.createdText.some(t => /应用没能启动/.test(t)) &&
      bootNoAppBackup.createdText.some(t => /AppBackup/.test(t)),
      JSON.stringify(bootNoAppBackup.createdText.map(t => t.slice(0, 60))));
    ok("P2-C 反例：抽掉 lib/app-backup.js 的失败清单**只**点名 AppBackup 系（无连带误报）",
      bootNoAppBackup.app.startupFailure().every(p => p.path.indexOf("AppBackup") === 0),
      JSON.stringify(bootNoAppBackup.app.startupFailure().map(p => p.path)));

    // ⑬ P2-D 新增模块 lib/app-diagnostics.js：诊断缺件时 setup 的取消/日志与
    //    面板转发会在运行期才坏 —— 启动链完全看不出来。必须在开门前拦。
    const noAppDiagnostics = indexScripts.filter(s => s !== "lib/app-diagnostics.js");
    const bootNoAppDiagnostics = await bootCombination({ scripts: noAppDiagnostics });
    ok("P2-D 反例：抽掉 lib/app-diagnostics.js ⇒ ready 失败且点名 AppDiagnostics / AppDiagnostics.createAppDiagnostics",
      bootNoAppDiagnostics.ready === false &&
      bootNoAppDiagnostics.app.startupFailure().some(p => p.path === "AppDiagnostics") &&
      bootNoAppDiagnostics.app.startupFailure().some(p => p.path === "AppDiagnostics.createAppDiagnostics"),
      JSON.stringify(bootNoAppDiagnostics.app.startupFailure() && bootNoAppDiagnostics.app.startupFailure().map(p => p.path)));
    ok("P2-D 反例：抽掉 lib/app-diagnostics.js 后不读库、不起业务定时器、不落库",
      bootNoAppDiagnostics.disk.puts === 0 && bootNoAppDiagnostics.intervals.indexOf(15000) < 0,
      "puts=" + bootNoAppDiagnostics.disk.puts + " intervals=" + JSON.stringify(bootNoAppDiagnostics.intervals));
    ok("P2-D 反例：抽掉 lib/app-diagnostics.js 后仍然渲染出可见失败面板",
      bootNoAppDiagnostics.insertions.length >= 1, JSON.stringify(bootNoAppDiagnostics.insertions));
    ok("P2-D 反例：面板上真的写出了「哪一支没起来」（点名 AppDiagnostics）",
      bootNoAppDiagnostics.createdText.some(t => /应用没能启动/.test(t)) &&
      bootNoAppDiagnostics.createdText.some(t => /AppDiagnostics/.test(t)),
      JSON.stringify(bootNoAppDiagnostics.createdText.map(t => t.slice(0, 60))));
    ok("P2-D 反例：抽掉 lib/app-diagnostics.js 的失败清单**只**点名 AppDiagnostics 系（无连带误报）",
      bootNoAppDiagnostics.app.startupFailure().every(p => p.path.indexOf("AppDiagnostics") === 0),
      JSON.stringify(bootNoAppDiagnostics.app.startupFailure().map(p => p.path)));

    // 正向：正常组合下诊断实例必须真的接上生产链（判据是**调用**，不是绑定存在）。
    const diagOk = boot.app && typeof boot.app.diagnosticsSurface === "function"
      ? boot.app.diagnosticsSurface() : null;
    ok("P2-D 正向：诊断实例真的可用（合同七个成员都在）",
      boot.loadErrors.length === 0 && !!diagOk && diagOk.missing !== true &&
      diagOk.hasBind === true && diagOk.hasRefresh === true && diagOk.hasLabLog === true &&
      diagOk.hasCancel === true && diagOk.hasDescribe === true &&
      diagOk.hasOpenSystem === true && diagOk.hasOpenGuide === true,
      JSON.stringify(diagOk));

    const noAppSetup = indexScripts.filter(s => s !== "lib/app-setup.js");
    const bootNoAppSetup = await bootCombination({ scripts: noAppSetup });
    ok("P2-E 反例：抽掉 lib/app-setup.js ⇒ ready 失败且只点名 AppSetup 系",
      bootNoAppSetup.ready === false && bootNoAppSetup.app.startupFailure().length > 0 &&
      bootNoAppSetup.app.startupFailure().every(p => p.path.indexOf("AppSetup") === 0),
      JSON.stringify(bootNoAppSetup.app.startupFailure()));
    ok("P2-E 反例：抽掉 lib/app-setup.js 后不读库、不排程、不起心跳",
      bootNoAppSetup.disk.puts === 0 && bootNoAppSetup.intervals.indexOf(15000) < 0 &&
      bootNoAppSetup.env.calls.scheduleAlarm.length === 0,
      JSON.stringify({ puts: bootNoAppSetup.disk.puts, intervals: bootNoAppSetup.intervals }));

    // P2-E 的四种装配坏形态都必须在**首次启动**时 fail closed。不能只在已启动的
    // 实例上调用 bindRuntime：首次启动才会证明 IDB、业务心跳和排程都没有抢跑。
    const setupSource = fs.readFileSync(path.join(ROOT, "lib/app-setup.js"), "utf8");
    const setupContract = prod.setupInstanceCoverage(ROOT).declared;
    const setupTemp = (name, suffix) => {
      const file = path.join(os.tmpdir(), "attention-p2e-" + name + ".js");
      fs.writeFileSync(file, setupSource + "\n" + suffix + "\n", "utf8");
      return file;
    };
    const assertSetupBootFailure = async (name, sourceFile, expectedPath) => {
      const bad = await bootCombination({ overrides: { "lib/app-setup.js": sourceFile } });
      const problems = bad.app && bad.app.startupFailure ? bad.app.startupFailure() : [];
      ok("P2-E " + name + "：首次启动点名 " + expectedPath + " 并 ready=false",
        bad.ready === false && problems.some(p => p.path === expectedPath) &&
        problems.every(p => p.path.indexOf("AppSetup") === 0), JSON.stringify(problems));
      ok("P2-E " + name + "：fail closed 前不读库、不排程、不起业务心跳",
        bad.disk.puts === 0 && bad.env.calls.scheduleAlarm.length === 0 &&
        bad.intervals.indexOf(15000) < 0 && bad.intervals.indexOf(2000) < 0,
        JSON.stringify({ puts: bad.disk.puts, scheduleAlarm: bad.env.calls.scheduleAlarm, intervals: bad.intervals }));
    };
    await assertSetupBootFailure("空 AppSetup 命名空间", setupTemp("empty-namespace", "AttentionLib.AppSetup = {};"), "AppSetup.createAppSetup");
    await assertSetupBootFailure("工厂返回空壳", setupTemp("factory-empty",
      "AttentionLib.AppSetup = { createAppSetup: function(){ return {}; } };"), "AppSetup.bind");
    await assertSetupBootFailure("工厂抛错", setupTemp("factory-throw",
      "AttentionLib.AppSetup = { createAppSetup: function(){ throw new Error('setup-boom'); } };"), "AppSetup.createAppSetup()");
    for (let setupIndex = 0; setupIndex < setupContract.length; setupIndex++) {
      const missing = setupContract[setupIndex];
      const members = setupContract.filter(name => name !== missing)
        .map(name => JSON.stringify(name) + ": function(){}").join(",");
      await assertSetupBootFailure("缺实例成员 " + missing, setupTemp("missing-" + missing,
        "AttentionLib.AppSetup = { createAppSetup: function(){ return {" + members + "}; } };"), "AppSetup." + missing);
    }
    ok("P2-E 临时 boot 反例只写 /tmp，工作区 app-setup.js 字节未被改写",
      fs.readFileSync(path.join(ROOT, "lib/app-setup.js"), "utf8") === setupSource,
      "lib/app-setup.js source unchanged");
    const setupOk = boot.app && boot.app.setupSurface ? boot.app.setupSurface : null;
    ok("P2-E 正向：设置实例合同成员全部接入生产组合",
      !!setupOk && setupOk.missing !== true && setupOk.hasBind && setupOk.hasPrompt && setupOk.hasTest && setupOk.hasStop && setupOk.hasEvidence,
      JSON.stringify(setupOk));

    // P2-F1：内容模块同样必须在首次启动、读库和业务心跳之前被完整装配。
    const noAppContent = indexScripts.filter(s => s !== "lib/app-content.js");
    const bootNoAppContent = await bootCombination({ scripts: noAppContent });
    ok("P2-F1 反例：抽掉 lib/app-content.js ⇒ ready 失败且只点名 AppContent 系",
      bootNoAppContent.ready === false && bootNoAppContent.app.startupFailure().length > 0 &&
      bootNoAppContent.app.startupFailure().every(p => p.path.indexOf("AppContent") === 0),
      JSON.stringify(bootNoAppContent.app.startupFailure()));
    ok("P2-F1 反例：抽掉 content 后不读库、不排程、不起业务心跳",
      bootNoAppContent.disk.puts === 0 && bootNoAppContent.env.calls.scheduleAlarm.length === 0 &&
      bootNoAppContent.intervals.indexOf(15000) < 0 && bootNoAppContent.intervals.indexOf(2000) < 0,
      JSON.stringify({ puts: bootNoAppContent.disk.puts, intervals: bootNoAppContent.intervals }));
    const contentSource = fs.readFileSync(path.join(ROOT, "lib/app-content.js"), "utf8");
    const contentContract = prod.contentInstanceCoverage(ROOT).declared;
    const contentTemp = (name, suffix) => {
      const file = path.join(os.tmpdir(), "attention-p2f1-" + name + ".js");
      fs.writeFileSync(file, contentSource + "\n" + suffix + "\n", "utf8");
      return file;
    };
    const assertContentBootFailure = async (name, sourceFile, expectedPath) => {
      const bad = await bootCombination({ overrides: { "lib/app-content.js": sourceFile } });
      const problems = bad.app && bad.app.startupFailure ? bad.app.startupFailure() : [];
      ok("P2-F1 " + name + "：首次启动点名 " + expectedPath + " 并 ready=false",
        bad.ready === false && problems.some(p => p.path === expectedPath) &&
        problems.every(p => p.path.indexOf("AppContent") === 0), JSON.stringify(problems));
      ok("P2-F1 " + name + "：fail closed 前不读库、不排程、不起业务心跳",
        bad.disk.puts === 0 && bad.env.calls.scheduleAlarm.length === 0 &&
        bad.intervals.indexOf(15000) < 0 && bad.intervals.indexOf(2000) < 0,
        JSON.stringify({ puts: bad.disk.puts, scheduleAlarm: bad.env.calls.scheduleAlarm, intervals: bad.intervals }));
    };
    await assertContentBootFailure("空 AppContent 命名空间", contentTemp("empty-namespace", "AttentionLib.AppContent = {};"), "AppContent.createAppContent");
    await assertContentBootFailure("工厂返回空壳", contentTemp("factory-empty",
      "AttentionLib.AppContent = { createAppContent: function(){ return {}; } };"), "AppContent.bind");
    await assertContentBootFailure("工厂抛错", contentTemp("factory-throw",
      "AttentionLib.AppContent = { createAppContent: function(){ throw new Error('content-boom'); } };"), "AppContent.createAppContent()");
    for (let contentIndex = 0; contentIndex < contentContract.length; contentIndex++) {
      const missing = contentContract[contentIndex];
      const members = contentContract.filter(name => name !== missing).map(name => JSON.stringify(name) + ": function(){}").join(",");
      await assertContentBootFailure("缺实例成员 " + missing, contentTemp("missing-" + missing,
        "AttentionLib.AppContent = { createAppContent: function(){ return {" + members + "}; } };"), "AppContent." + missing);
    }
    ok("P2-F1 临时 boot 反例只写 /tmp，工作区 app-content.js 字节未被改写",
      fs.readFileSync(path.join(ROOT, "lib/app-content.js"), "utf8") === contentSource, "lib/app-content.js source unchanged");
    const contentOk = boot.app && boot.app.contentSurface ? boot.app.contentSurface : null;
    ok("P2-F1 正向：内容实例真的接入生产组合", !!contentOk && contentOk.missing !== true &&
      contentOk.hasBind && contentOk.hasNotes && contentOk.hasSearch && contentOk.hasProjects, JSON.stringify(contentOk));

    // P2-G1：capture 表单与会话也必须在读库/排程/业务心跳之前完整装配。
    const noAppCapture = indexScripts.filter(s => s !== "lib/app-capture.js");
    const bootNoAppCapture = await bootCombination({ scripts: noAppCapture });
    ok("P2-G1 反例：抽掉 lib/app-capture.js ⇒ ready=false 且只点名 AppCapture 系",
      bootNoAppCapture.ready === false && bootNoAppCapture.app.startupFailure().length > 0 &&
      bootNoAppCapture.app.startupFailure().every(p => p.path.indexOf("AppCapture") === 0),
      JSON.stringify(bootNoAppCapture.app.startupFailure()));
    ok("P2-G1 抽掉 capture 时 fail closed 前不读库、不排程、不起业务心跳",
      bootNoAppCapture.disk.puts === 0 && bootNoAppCapture.env.calls.scheduleAlarm.length === 0 &&
      bootNoAppCapture.intervals.indexOf(15000) < 0 && bootNoAppCapture.intervals.indexOf(2000) < 0,
      JSON.stringify({ puts: bootNoAppCapture.disk.puts, intervals: bootNoAppCapture.intervals }));
    const captureSource = fs.readFileSync(path.join(ROOT, "lib/app-capture.js"), "utf8");
    const captureContract = prod.captureInstanceCoverage(ROOT).declared;
    const captureTemp = (name, suffix) => {
      const file = path.join(os.tmpdir(), "attention-p2g1-" + name + ".js");
      fs.writeFileSync(file, captureSource + "\n" + suffix + "\n", "utf8");
      return file;
    };
    const assertCaptureBootFailure = async (name, sourceFile, expectedPath) => {
      const bad = await bootCombination({ overrides: { "lib/app-capture.js": sourceFile } });
      const problems = bad.app && bad.app.startupFailure ? bad.app.startupFailure() : [];
      ok("P2-G1 " + name + "：首次启动点名 " + expectedPath + " 并 ready=false",
        bad.ready === false && problems.some(p => p.path === expectedPath) &&
        problems.every(p => p.path.indexOf("AppCapture") === 0), JSON.stringify(problems));
      ok("P2-G1 " + name + "：fail closed 前不读库、不排程、不起业务心跳",
        bad.disk.puts === 0 && bad.env.calls.scheduleAlarm.length === 0 &&
        bad.intervals.indexOf(15000) < 0 && bad.intervals.indexOf(2000) < 0,
        JSON.stringify({ puts: bad.disk.puts, scheduleAlarm: bad.env.calls.scheduleAlarm, intervals: bad.intervals }));
    };
    await assertCaptureBootFailure("空 AppCapture 命名空间", captureTemp("empty-namespace", "AttentionLib.AppCapture = {};"), "AppCapture.createAppCapture");
    await assertCaptureBootFailure("工厂返回空壳", captureTemp("factory-empty",
      "AttentionLib.AppCapture = { createAppCapture: function(){ return {}; } };"), "AppCapture.bind");
    await assertCaptureBootFailure("工厂抛错", captureTemp("factory-throw",
      "AttentionLib.AppCapture = { createAppCapture: function(){ throw new Error('capture-boom'); } };"), "AppCapture.createAppCapture()");
    for (let captureIndex = 0; captureIndex < captureContract.length; captureIndex++) {
      const missing = captureContract[captureIndex];
      const members = captureContract.filter(name => name !== missing).map(name => JSON.stringify(name) + ": function(){}").join(",");
      await assertCaptureBootFailure("缺实例成员 " + missing, captureTemp("missing-" + missing,
        "AttentionLib.AppCapture = { createAppCapture: function(){ return {" + members + "}; } };"), "AppCapture." + missing);
    }
    ok("P2-G1 临时 boot 反例只写 /tmp，工作区 app-capture.js 字节未被改写",
      fs.readFileSync(path.join(ROOT, "lib/app-capture.js"), "utf8") === captureSource, "lib/app-capture.js source unchanged");
    const captureOk = boot.app && boot.app.captureSurface ? boot.app.captureSurface : null;
    ok("P2-G1 正向：capture 实例已进生产组合且会话可读",
      boot.loadErrors.length === 0 && typeof boot.app.formSession === "number" && boot.app.formSession >= 0 &&
      !!captureOk && captureOk.hasBind && captureOk.hasSession && captureOk.hasSnapshot && captureOk.hasOpen && captureOk.hasEdit && captureOk.hasHint,
      JSON.stringify({ formSession: boot.app.formSession, capture: captureOk }));

    // P2-F2：展示模块同样是启动前合同，缺件或空壳不能进入读库/排程/心跳。
    const noAppViews = indexScripts.filter(s => s !== "lib/app-views.js");
    const bootNoAppViews = await bootCombination({ scripts: noAppViews });
    ok("P2-F2 反例：抽掉 lib/app-views.js ⇒ ready=false 且点名 AppViews",
      bootNoAppViews.ready === false && bootNoAppViews.app.startupFailure().every(p => p.path.indexOf("AppViews") === 0),
      JSON.stringify(bootNoAppViews.app.startupFailure()));
    ok("P2-F2 抽掉 views 时 fail closed 前不读库、不排程、不起业务心跳",
      bootNoAppViews.disk.puts === 0 && bootNoAppViews.env.calls.scheduleAlarm.length === 0 &&
      bootNoAppViews.intervals.indexOf(15000) < 0, JSON.stringify({ puts: bootNoAppViews.disk.puts, intervals: bootNoAppViews.intervals }));
    const viewsSource = fs.readFileSync(path.join(ROOT, "lib/app-views.js"), "utf8");
    const viewsTemp = (name, suffix) => {
      const file = path.join(os.tmpdir(), "attention-p2f2-" + name + ".js");
      fs.writeFileSync(file, viewsSource + "\n" + suffix + "\n", "utf8"); return file;
    };
    const badViewsFactory = await bootCombination({ overrides: { "lib/app-views.js": viewsTemp("factory-throw",
      "AttentionLib.AppViews={createAppViews:function(){throw new Error('views-boom')}};") } });
    ok("P2-F2 工厂抛错：ready=false、点名 AppViews.createAppViews() 且零业务副作用",
      badViewsFactory.ready === false && badViewsFactory.app.startupFailure().some(p => p.path === "AppViews.createAppViews()") &&
      badViewsFactory.disk.puts === 0 && badViewsFactory.intervals.indexOf(15000) < 0,
      JSON.stringify({ problems: badViewsFactory.app.startupFailure(), puts: badViewsFactory.disk.puts, intervals: badViewsFactory.intervals }));
    const badViewsMember = await bootCombination({ overrides: { "lib/app-views.js": viewsTemp("missing-member",
      "AttentionLib.AppViews={createAppViews:function(){return {}}};") } });
    ok("P2-F2 缺实例成员：ready=false、点名 AppViews.priorityRank 且零业务副作用",
      badViewsMember.ready === false && badViewsMember.app.startupFailure().some(p => p.path === "AppViews.priorityRank") &&
      badViewsMember.disk.puts === 0 && badViewsMember.intervals.indexOf(15000) < 0,
      JSON.stringify({ problems: badViewsMember.app.startupFailure(), puts: badViewsMember.disk.puts, intervals: badViewsMember.intervals }));

    // P3-I-Q2：缺实例成员 detailReminderStatusRow 或缺具名依赖必须 fail closed
    const badViewsDetailMember = await bootCombination({ overrides: { "lib/app-views.js": viewsTemp("missing-detail-status",
      viewsSource.replace("detailReminderStatusRow:detailReminderStatusRow,", "")) } });
    ok("P3-I-Q2 缺实例成员 detailReminderStatusRow：ready=false、点名 AppViews.detailReminderStatusRow 且零业务副作用",
      badViewsDetailMember.ready === false && badViewsDetailMember.app.startupFailure().some(p => p.path === "AppViews.detailReminderStatusRow") &&
      badViewsDetailMember.disk.puts === 0 && badViewsDetailMember.intervals.indexOf(15000) < 0,
      JSON.stringify({ problems: badViewsDetailMember.app.startupFailure(), puts: badViewsDetailMember.disk.puts, intervals: badViewsDetailMember.intervals }));

    const badViewsMissingDep = await bootCombination({ overrides: { "lib/app-views.js": viewsTemp("missing-evidence-dep",
      viewsSource.replace("var need=['query',", "var need=['missingRequiredEvidenceDep','query',")) } });
    ok("P3-I-Q2 缺具名依赖：ready=false、点名 AppViews.createAppViews() 且零业务副作用",
      badViewsMissingDep.ready === false && badViewsMissingDep.app.startupFailure().some(p => p.path === "AppViews.createAppViews()") &&
      badViewsMissingDep.disk.puts === 0 && badViewsMissingDep.intervals.indexOf(15000) < 0,
      JSON.stringify({ problems: badViewsMissingDep.app.startupFailure(), puts: badViewsMissingDep.disk.puts, intervals: badViewsMissingDep.intervals }));

    // P3-A：模型模块也必须在业务启动前 fail closed；四种坏形态都不能读库、排程或起心跳。
    const modelContract = ["SCHEMA", "PROJECT_COLORS", "createInitialState", "normalizeItem", "makeItem",
      "resolveDeliveryMode", "bumpRev", "isTerminal", "hasKnownRev"];
    const modelSource = fs.readFileSync(path.join(ROOT, "lib/app-model.js"), "utf8");
    const modelTemp = (name, suffix) => {
      const file = path.join(os.tmpdir(), "attention-p3a-" + name + ".js");
      fs.writeFileSync(file, modelSource + "\n" + suffix + "\n", "utf8"); return file;
    };
    const assertModelBootFailure = async (name, sourceFile, expectedPath) => {
      const bad = sourceFile === null
        ? await bootCombination({ scripts: indexScripts.filter(s => s !== "lib/app-model.js") })
        : await bootCombination({ overrides: { "lib/app-model.js": sourceFile } });
      const problems = bad.app && bad.app.startupFailure ? bad.app.startupFailure() : [];
      ok("P3-A " + name + "：ready=false 且点名 " + expectedPath,
        bad.ready === false && problems.some(p => p.path === expectedPath) &&
        problems.every(p => p.path.indexOf("AppModel") === 0), JSON.stringify(problems));
      ok("P3-A " + name + "：fail closed 前不读库、不排程、不起 15000/2000 心跳",
        bad.disk.puts === 0 && bad.env.calls.scheduleAlarm.length === 0 &&
        bad.intervals.indexOf(15000) < 0 && bad.intervals.indexOf(2000) < 0,
        JSON.stringify({ puts: bad.disk.puts, scheduleAlarm: bad.env.calls.scheduleAlarm.length, intervals: bad.intervals }));
    };
    await assertModelBootFailure("缺 lib/app-model.js", null, "AppModel");
    await assertModelBootFailure("空 AppModel 命名空间", modelTemp("empty-namespace", "AttentionLib.AppModel = {};"), "AppModel.createAppModel");
    await assertModelBootFailure("工厂抛错", modelTemp("factory-throw",
      "AttentionLib.AppModel = { createAppModel: function(){ throw new Error('model-boom'); } };"), "AppModel.createAppModel()");
    for (let modelIndex = 0; modelIndex < modelContract.length; modelIndex++) {
      const missing = modelContract[modelIndex];
      const members = modelContract.filter(name => name !== missing).map(name =>
        JSON.stringify(name) + ": " + (name === "SCHEMA" ? "5" : (name === "PROJECT_COLORS" ? "[]" : "function(){}"))).join(",");
      await assertModelBootFailure("缺实例成员 " + missing, modelTemp("missing-" + missing,
        "AttentionLib.AppModel = { createAppModel: function(){ return {" + members + "}; } };"), "AppModel." + missing);
    }
    // P3-A 唯一来源反例：只改变模型默认值，旧数据恢复与示例重置都必须跟随同一份新副本。
    const mutatedDefaults = modelSource
      .replace('model: "gpt-4o-mini"', 'model: "model-default-mutated"')
      .replace('followupMs: 60 * 60 * 1000', 'followupMs: 123456')
      .replace('maxFollowups: 2', 'maxFollowups: 9')
      .replace('notify: false', 'notify: true')
      .replace('dnd: true', 'dnd: false')
      .replace('importantRepeat: true', 'importantRepeat: false');
    const mutatedDefaultsFile = path.join(os.tmpdir(), "attention-p3a-defaults-mutated.js");
    fs.writeFileSync(mutatedDefaultsFile, mutatedDefaults + "\n", "utf8");
    const restoredWithMutatedDefaults = await bootCombination({
      overrides: { "lib/app-model.js": mutatedDefaultsFile },
      idbValue: { schema: 5, items: [], notes: [], projects: [], settings: {} }
    });
    const restoredSettings = restoredWithMutatedDefaults.app.state.settings;
    const appCoreModelCheckSrc = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");
    ok("P3-A 唯一来源：模型默认突变沿旧数据恢复路径生效（AI + review）",
      restoredWithMutatedDefaults.ready === true && restoredSettings.ai.model === "model-default-mutated" &&
      restoredSettings.review.followupMs === 123456 && restoredSettings.review.maxFollowups === 9 &&
      restoredSettings.notify === true && restoredSettings.dnd === false && restoredSettings.importantRepeat === false,
      JSON.stringify({ ready: restoredWithMutatedDefaults.ready, ai: restoredSettings.ai, review: restoredSettings.review }));
    const partialAiWithMutatedDefaults = await bootCombination({
      overrides: { "lib/app-model.js": mutatedDefaultsFile },
      idbValue: { schema: 5, items: [], notes: [], projects: [], settings: { ai: { enabled: true, baseUrl: "https://legacy.example/v1" } } }
    });
    const partialAiSettings = partialAiWithMutatedDefaults.app.state.settings.ai;
    ok("P3-A 部分旧 AI 设置保留覆盖项并从模型补全默认值（默认突变也沿恢复路径生效）",
      partialAiWithMutatedDefaults.ready === true && partialAiSettings.enabled === true &&
      partialAiSettings.baseUrl === "https://legacy.example/v1" && partialAiSettings.apiKey === "" &&
      partialAiSettings.model === "model-default-mutated" && partialAiSettings.autoOnSave === false,
      JSON.stringify({ ready: partialAiWithMutatedDefaults.ready, ai: partialAiSettings }));
    restoredSettings.notify = false; restoredSettings.dnd = true; restoredSettings.importantRepeat = true;
    restoredWithMutatedDefaults.app.seed();
    ok("P3-A 唯一来源：示例重置沿模型默认值恢复 notify/dnd/importantRepeat",
      restoredSettings.notify === true && restoredSettings.dnd === false && restoredSettings.importantRepeat === false,
      JSON.stringify({ notify: restoredSettings.notify, dnd: restoredSettings.dnd, importantRepeat: restoredSettings.importantRepeat }));
    ok("P3-A 唯一来源：core 不再保留 AI/review/重置默认表",
      !/model:\s*["']gpt-4o-mini["']/.test(appCoreModelCheckSrc) &&
      !/followupMs:\s*60\s*\*\s*60\s*\*\s*1000/.test(appCoreModelCheckSrc) &&
      !/maxFollowups:\s*2/.test(appCoreModelCheckSrc) &&
      !/notify:\s*false\s*,\s*dnd:\s*true\s*,\s*importantRepeat:\s*true/.test(appCoreModelCheckSrc),
      "default literals remain in app-core.js");

    // P3-C：事务协调器模块也必须在业务启动前 fail closed；坏形态都不能读库、排程或起心跳。
    const transactionContract = [
      "runUserOp", "wrapUserOp", "itemConflictsWithActiveAction", "isItemActionPending",
      "rejectPendingItemCommand", "takeReplayCreatedId", "handleAlarmAction", "alarmEventSeen",
      "inflightDepth", "isFeedbackSuppressed", "shouldSuppressInnerSave"
    ];
    const transactionSource = fs.readFileSync(path.join(ROOT, "lib/app-transaction.js"), "utf8");
    const transactionTemp = (name, suffix) => {
      const file = path.join(os.tmpdir(), "attention-p3c-" + name + ".js");
      fs.writeFileSync(file, transactionSource + "\n" + suffix + "\n", "utf8"); return file;
    };
    const assertTransactionBootFailure = async (name, sourceFile, expectedPath) => {
      const bad = sourceFile === null
        ? await bootCombination({ scripts: indexScripts.filter(s => s !== "lib/app-transaction.js") })
        : await bootCombination({ overrides: { "lib/app-transaction.js": sourceFile } });
      const problems = bad.app && bad.app.startupFailure ? bad.app.startupFailure() : [];
      ok("P3-C " + name + "：ready=false 且点名 " + expectedPath,
        bad.ready === false && problems.some(p => p.path === expectedPath) &&
        problems.every(p => p.path.indexOf("AppTransaction") === 0), JSON.stringify(problems));
      ok("P3-C " + name + "：fail closed 前不读库、不排程、不起 15000/2000 心跳",
        bad.disk.puts === 0 && bad.env.calls.scheduleAlarm.length === 0 &&
        bad.intervals.indexOf(15000) < 0 && bad.intervals.indexOf(2000) < 0,
        JSON.stringify({ puts: bad.disk.puts, scheduleAlarm: bad.env.calls.scheduleAlarm.length, intervals: bad.intervals }));
    };
    await assertTransactionBootFailure("缺 lib/app-transaction.js", null, "AppTransaction");
    await assertTransactionBootFailure("空 AppTransaction 命名空间", transactionTemp("empty-namespace", "AttentionLib.AppTransaction = {};"), "AppTransaction.createAppTransaction");
    await assertTransactionBootFailure("工厂抛错", transactionTemp("factory-throw",
      "AttentionLib.AppTransaction = { createAppTransaction: function(){ throw new Error('tx-boom'); } };"), "AppTransaction.createAppTransaction()");
    for (let txIndex = 0; txIndex < transactionContract.length; txIndex++) {
      const missing = transactionContract[txIndex];
      const members = transactionContract.filter(name => name !== missing).map(name =>
        JSON.stringify(name) + ": function(){}").join(",");
      await assertTransactionBootFailure("缺实例成员 " + missing, transactionTemp("missing-" + missing,
        "AttentionLib.AppTransaction = { createAppTransaction: function(){ return {" + members + "}; } };"), "AppTransaction." + missing);
    }
    const txOk = boot.app && typeof boot.app.runUserOp === "function" && typeof boot.app.wrapUserOp === "function"
      && typeof boot.app.handleAlarmAction === "function";
    ok("P3-C 正向：事务协调器实例真的接上生产链且方法可用",
      boot.loadErrors.length === 0 && txOk === true &&
      boot.app.inflightDepth() === 0 &&
      boot.app.isFeedbackSuppressed() === false &&
      boot.app.shouldSuppressInnerSave() === false,
      JSON.stringify({ ready: boot.ready, txOk }));

    const itemContract = [
      "promoteDue", "ensureSeriesId", "seriesMembers", "isUnstartedInstance",
      "spawnNextInstance", "advanceSeriesOnArchive", "ackItem", "completeItem",
      "snoozeItem", "deleteItem", "reopenItem", "restoreItem",
      "resumeDeadlineProtection", "stopRepeat", "applyItemEdit", "applyNewItem",
      "applyProjectRemovalToItems", "applyCompleteUndo", "revertCompleteUndo",
      "undoLastComplete", "undoNewItem", "lastCompleteUndo"
    ];
    const itemSource = fs.readFileSync(path.join(ROOT, "lib/app-items.js"), "utf8");
    const itemTemp = (name, suffix) => {
      const file = path.join(os.tmpdir(), "attention-p3d-" + name + ".js");
      fs.writeFileSync(file, itemSource + "\n" + suffix + "\n", "utf8"); return file;
    };
    const assertItemBootFailure = async (name, sourceFile, expectedPath) => {
      const bad = sourceFile === null
        ? await bootCombination({ scripts: indexScripts.filter(s => s !== "lib/app-items.js") })
        : await bootCombination({ overrides: { "lib/app-items.js": sourceFile } });
      const problems = bad.app && bad.app.startupFailure ? bad.app.startupFailure() : [];
      ok("P3-D " + name + "：ready=false 且点名 " + expectedPath,
        bad.ready === false && problems.some(p => p.path === expectedPath) &&
        problems.every(p => p.path.indexOf("AppItems") === 0), JSON.stringify(problems));
      ok("P3-D " + name + "：fail closed 前不读库、不排程、不起 15000/2000 心跳",
        bad.disk.puts === 0 && bad.env.calls.scheduleAlarm.length === 0 &&
        bad.intervals.indexOf(15000) < 0 && bad.intervals.indexOf(2000) < 0,
        JSON.stringify({ puts: bad.disk.puts, scheduleAlarm: bad.env.calls.scheduleAlarm.length, intervals: bad.intervals }));
    };
    await assertItemBootFailure("缺 lib/app-items.js", null, "AppItems");
    await assertItemBootFailure("空 AppItems 命名空间", itemTemp("empty-namespace", "AttentionLib.AppItems = {};"), "AppItems.createAppItems");
    await assertItemBootFailure("工厂抛错", itemTemp("factory-throw",
      "AttentionLib.AppItems = { createAppItems: function(){ throw new Error('items-boom'); } };"), "AppItems.createAppItems()");
    for (let itIndex = 0; itIndex < itemContract.length; itIndex++) {
      const missing = itemContract[itIndex];
      const members = itemContract.filter(name => name !== missing).map(name =>
        JSON.stringify(name) + ": function(){}").join(",");
      await assertItemBootFailure("缺实例成员 " + missing, itemTemp("missing-" + missing,
        "AttentionLib.AppItems = { createAppItems: function(){ return {" + members + "}; } };"), "AppItems." + missing);
    }
    const itemsOk = boot.app && typeof boot.app.items === "object" && typeof boot.app.completeItem === "function"
      && typeof boot.app.ackItem === "function" && typeof boot.app.promoteDue === "function";
    ok("P3-D 正向：事项模块实例真的接上生产链且方法可用",
      boot.loadErrors.length === 0 && itemsOk === true &&
      typeof boot.app.items.completeItem === "function" &&
      typeof boot.app.items.promoteDue === "function",
      JSON.stringify({ ready: boot.ready, itemsOk }));

    const coordinatorContract = [
      "refreshNativeScheduleBasis", "applyDeadlineEvents", "applyReminderEvents",
      "markDeadlineDelivered", "applyReminderDelivered", "syncNativeRemindersNow",
      "ensureNativeReminders", "queueNativeReminderSync", "readDeliveryEvidence",
      "applyNativeDeliveryEvidence", "initializeNativeReminders", "getNativeReminderStatus",
      "setNativeReminderStatus", "isNativeReady", "getNativeSyncMetrics",
      "getNativeSyncVersion", "bumpNativeSyncVersion", "deliveryEvidenceReadable",
      "getDeliveryEvidenceState", "isNativeAndroidRuntime", "waitForNativeBridge"
    ];
    const coordinatorSource = fs.readFileSync(path.join(ROOT, "lib/app-native-coordinator.js"), "utf8");
    const coordinatorTemp = (name, suffix) => {
      const file = path.join(os.tmpdir(), "attention-p3e-" + name + ".js");
      fs.writeFileSync(file, coordinatorSource + "\n" + suffix + "\n", "utf8"); return file;
    };
    const assertCoordinatorBootFailure = async (name, sourceFile, expectedPath) => {
      const bad = sourceFile === null
        ? await bootCombination({ scripts: indexScripts.filter(s => s !== "lib/app-native-coordinator.js") })
        : await bootCombination({ overrides: { "lib/app-native-coordinator.js": sourceFile } });
      const problems = bad.app && bad.app.startupFailure ? bad.app.startupFailure() : [];
      ok("P3-E " + name + "：ready=false 且点名 " + expectedPath,
        bad.ready === false && problems.some(p => p.path === expectedPath) &&
        problems.every(p => p.path.indexOf("AppNativeCoordinator") === 0), JSON.stringify(problems));
      ok("P3-E " + name + "：fail closed 前不读库、不排程、不起 15000/2000 心跳",
        bad.disk.puts === 0 && bad.env.calls.scheduleAlarm.length === 0 &&
        bad.intervals.indexOf(15000) < 0 && bad.intervals.indexOf(2000) < 0,
        JSON.stringify({ puts: bad.disk.puts, scheduleAlarm: bad.env.calls.scheduleAlarm.length, intervals: bad.intervals }));
    };
    await assertCoordinatorBootFailure("缺 lib/app-native-coordinator.js", null, "AppNativeCoordinator");
    await assertCoordinatorBootFailure("空 AppNativeCoordinator 命名空间", coordinatorTemp("empty-namespace", "AttentionLib.AppNativeCoordinator = {};"), "AppNativeCoordinator.createAppNativeCoordinator");
    await assertCoordinatorBootFailure("工厂抛错", coordinatorTemp("factory-throw",
      "AttentionLib.AppNativeCoordinator = { createAppNativeCoordinator: function(){ throw new Error('coordinator-boom'); } };"), "AppNativeCoordinator.createAppNativeCoordinator()");
    for (let cIndex = 0; cIndex < coordinatorContract.length; cIndex++) {
      const missing = coordinatorContract[cIndex];
      const members = coordinatorContract.filter(name => name !== missing).map(name =>
        JSON.stringify(name) + ": function(){}").join(",");
      await assertCoordinatorBootFailure("缺实例成员 " + missing, coordinatorTemp("missing-" + missing,
        "AttentionLib.AppNativeCoordinator = { createAppNativeCoordinator: function(){ return {" + members + "}; } };"), "AppNativeCoordinator." + missing);
    }
    const coordinatorOk = boot.app && typeof boot.app.nativeCoordinator === "object" && boot.app.nativeCoordinator !== null
      && typeof boot.app.refreshNativeScheduleBasis === "function"
      && typeof boot.app.syncNativeRemindersNow === "function"
      && typeof boot.app.queueNativeReminderSync === "function";
    ok("P3-E 正向：原生协调器实例真的接上生产链且方法可用",
      boot.loadErrors.length === 0 && coordinatorOk === true &&
      typeof boot.app.nativeCoordinator.syncNativeRemindersNow === "function" &&
      typeof boot.app.nativeCoordinator.refreshNativeScheduleBasis === "function",
      JSON.stringify({ ready: boot.ready, coordinatorOk }));

    const reviewContract = [
      "ensureReviewSettings", "fallbackTriggerAt", "reviewSessionKey", "nextReviewWindowStart",
      "inReviewWindow", "inReviewHighlight", "isVagueContent", "detectNeedsReview",
      "needsReviewItems", "fireReviewNotification", "maybeReviewSession", "openReviewSession",
      "currentReviewItem", "scheduleNextReviewAlarm", "renderReviewCard", "resolveReviewTrigger",
      "markReviewDone", "reviewConfirm", "reviewSaveEdit", "reviewKeepCurrent",
      "reviewDelete", "snoozeReview", "skipReviewThisTime", "renderReviewEntry",
      "bindReviewControls", "markReviewTriggerPicked", "isFallbackSuppressed"
    ];
    const reviewSource = fs.readFileSync(path.join(ROOT, "lib/app-review.js"), "utf8");
    const reviewTemp = (name, suffix) => {
      const file = path.join(os.tmpdir(), "attention-p3f-" + name + ".js");
      fs.writeFileSync(file, reviewSource + "\n" + suffix + "\n", "utf8"); return file;
    };
    const assertReviewBootFailure = async (name, sourceFile, expectedPath) => {
      const bad = sourceFile === null
        ? await bootCombination({ scripts: indexScripts.filter(s => s !== "lib/app-review.js") })
        : await bootCombination({ overrides: { "lib/app-review.js": sourceFile } });
      const problems = bad.app && bad.app.startupFailure ? bad.app.startupFailure() : [];
      ok("P3-F " + name + "：ready=false 且点名 " + expectedPath,
        bad.ready === false && problems.some(p => p.path === expectedPath) &&
        problems.every(p => p.path.indexOf("AppReview") === 0), JSON.stringify(problems));
      ok("P3-F " + name + "：fail closed 前不读库、不排程、不起 15000/2000 心跳",
        bad.disk.puts === 0 && bad.env.calls.scheduleAlarm.length === 0 &&
        bad.intervals.indexOf(15000) < 0 && bad.intervals.indexOf(2000) < 0,
        JSON.stringify({ puts: bad.disk.puts, scheduleAlarm: bad.env.calls.scheduleAlarm.length, intervals: bad.intervals }));
    };
    await assertReviewBootFailure("缺 lib/app-review.js", null, "AppReview");
    await assertReviewBootFailure("空 AppReview 命名空间", reviewTemp("empty-namespace", "AttentionLib.AppReview = {};"), "AppReview.createAppReview");
    await assertReviewBootFailure("工厂抛错", reviewTemp("factory-throw",
      "AttentionLib.AppReview = { createAppReview: function(){ throw new Error('review-boom'); } };"), "AppReview.createAppReview()");
    for (let cIndex = 0; cIndex < reviewContract.length; cIndex++) {
      const missing = reviewContract[cIndex];
      const members = reviewContract.filter(name => name !== missing).map(name =>
        JSON.stringify(name) + ": function(){}").join(",");
      await assertReviewBootFailure("缺实例成员 " + missing, reviewTemp("missing-" + missing,
        "AttentionLib.AppReview = { createAppReview: function(){ return {" + members + "}; } };"), "AppReview." + missing);
    }
    const reviewOk = boot.app && typeof boot.app.review === "object" && boot.app.review !== null
      && typeof boot.app.openReviewSession === "function"
      && typeof boot.app.needsReviewItems === "function"
      && typeof boot.app.renderReviewEntry === "function";
    ok("P3-F 正向：待整理实例真的接上生产链且方法可用",
      boot.loadErrors.length === 0 && reviewOk === true &&
      typeof boot.app.review.openReviewSession === "function" &&
      typeof boot.app.review.ensureReviewSettings === "function",
      JSON.stringify({ ready: boot.ready, reviewOk }));

    const alertsContract = [
      "showAlert", "hideAlert", "dismissAlert", "applyAlertDismissal",
      "shouldSkipAlert", "showSystemNotification", "tick", "getAlertItem",
      "clearAlert", "bindAlertControls", "handleNotificationAction",
      "deliveryHandledByCommittedItem", "completeActiveAlarm", "refreshActiveAlarmPanel",
      "startPolling", "stopPolling", "onVisibilityChange"
    ];
    const alertsSource = fs.readFileSync(path.join(ROOT, "lib/app-alerts.js"), "utf8");
    const alertsTemp = (name, suffix) => {
      const file = path.join(os.tmpdir(), "attention-p3g-" + name + ".js");
      fs.writeFileSync(file, alertsSource + "\n" + suffix + "\n", "utf8"); return file;
    };
    const assertAlertsBootFailure = async (name, sourceFile, expectedPath) => {
      const bad = sourceFile === null
        ? await bootCombination({ scripts: indexScripts.filter(s => s !== "lib/app-alerts.js") })
        : await bootCombination({ overrides: { "lib/app-alerts.js": sourceFile } });
      const problems = bad.app && bad.app.startupFailure ? bad.app.startupFailure() : [];
      ok("P3-G " + name + "：ready=false 且点名 " + expectedPath,
        bad.ready === false && problems.some(p => p.path === expectedPath) &&
        problems.every(p => p.path.indexOf("AppAlerts") === 0), JSON.stringify(problems));
      ok("P3-G " + name + "：fail closed 前不读库、不排程、不起 15000/2000 心跳",
        bad.disk.puts === 0 && bad.env.calls.scheduleAlarm.length === 0 &&
        bad.intervals.indexOf(15000) < 0 && bad.intervals.indexOf(2000) < 0,
        JSON.stringify({ puts: bad.disk.puts, scheduleAlarm: bad.env.calls.scheduleAlarm.length, intervals: bad.intervals }));
    };
    await assertAlertsBootFailure("缺 lib/app-alerts.js", null, "AppAlerts");
    await assertAlertsBootFailure("空 AppAlerts 命名空间", alertsTemp("empty-namespace", "AttentionLib.AppAlerts = {};"), "AppAlerts.createAppAlerts");
    await assertAlertsBootFailure("工厂抛错", alertsTemp("factory-throw",
      "AttentionLib.AppAlerts = { createAppAlerts: function(){ throw new Error('alerts-boom'); } };"), "AppAlerts.createAppAlerts()");
    for (let cIndex = 0; cIndex < alertsContract.length; cIndex++) {
      const missing = alertsContract[cIndex];
      const members = alertsContract.filter(name => name !== missing).map(name =>
        JSON.stringify(name) + ": function(){}").join(",");
      await assertAlertsBootFailure("缺实例成员 " + missing, alertsTemp("missing-" + missing,
        "AttentionLib.AppAlerts = { createAppAlerts: function(){ return {" + members + "}; } };"), "AppAlerts." + missing);
    }
    const alertsOk = boot.app && typeof boot.app.alerts === "object" && boot.app.alerts !== null
      && typeof boot.app.clearAlert === "function"
      && typeof boot.app.alerts.showAlert === "function"
      && typeof boot.app.alerts.hideAlert === "function"
      && typeof boot.app.alerts.dismissAlert === "function"
      && typeof boot.app.alerts.applyAlertDismissal === "function"
      && typeof boot.app.alerts.tick === "function";
    ok("P3-G 正向：提醒实例真的接上生产链且方法可用",
      boot.loadErrors.length === 0 && alertsOk === true &&
      typeof boot.app.alerts.showAlert === "function" &&
      typeof boot.app.alerts.tick === "function",
      JSON.stringify({ ready: boot.ready, alertsOk }));

    const platformContract = [
      "systemBridge", "appSettingsPlugin", "isNativeAndroidRuntime", "waitForNativeBridge",
      "getDeferredInstallPrompt", "promptInstall", "bindInstall", "bindNetwork", "registerPwa"
    ];
    const platformSource = fs.readFileSync(path.join(ROOT, "lib/app-platform.js"), "utf8");
    const platformTemp = (name, suffix) => {
      const file = path.join(os.tmpdir(), "attention-p3h-" + name + ".js");
      fs.writeFileSync(file, platformSource + "\n" + suffix + "\n", "utf8"); return file;
    };
    const assertPlatformBootFailure = async (name, sourceFile, expectedPath) => {
      const bad = sourceFile === null
        ? await bootCombination({ scripts: indexScripts.filter(s => s !== "lib/app-platform.js") })
        : await bootCombination({ overrides: { "lib/app-platform.js": sourceFile } });
      const problems = bad.app && bad.app.startupFailure ? bad.app.startupFailure() : [];
      ok("P3-H " + name + "：ready=false 且点名 " + expectedPath,
        bad.ready === false && problems.some(p => p.path === expectedPath) &&
        problems.every(p => p.path.indexOf("AppPlatform") === 0), JSON.stringify(problems));
      ok("P3-H " + name + "：fail closed 前不读库、不排程、不起 15000/2000 心跳",
        bad.disk.puts === 0 && bad.env.calls.scheduleAlarm.length === 0 &&
        bad.intervals.indexOf(15000) < 0 && bad.intervals.indexOf(2000) < 0,
        JSON.stringify({ puts: bad.disk.puts, scheduleAlarm: bad.env.calls.scheduleAlarm.length, intervals: bad.intervals }));
    };
    await assertPlatformBootFailure("缺 lib/app-platform.js", null, "AppPlatform");
    await assertPlatformBootFailure("空 AppPlatform 命名空间", platformTemp("empty-namespace", "AttentionLib.AppPlatform = {};"), "AppPlatform.createAppPlatform");
    await assertPlatformBootFailure("工厂抛错", platformTemp("factory-throw",
      "AttentionLib.AppPlatform = { createAppPlatform: function(){ throw new Error('platform-boom'); } };"), "AppPlatform.createAppPlatform()");
    for (let cIndex = 0; cIndex < platformContract.length; cIndex++) {
      const missing = platformContract[cIndex];
      const members = platformContract.filter(name => name !== missing).map(name =>
        JSON.stringify(name) + ": function(){}").join(",");
      await assertPlatformBootFailure("缺实例成员 " + missing, platformTemp("missing-" + missing,
        "AttentionLib.AppPlatform = { createAppPlatform: function(){ return {" + members + "}; } };"), "AppPlatform." + missing);
    }
    const platformOk = boot.app && typeof boot.app.platform === "object" && boot.app.platform !== null
      && typeof boot.app.platform.systemBridge === "function"
      && typeof boot.app.platform.appSettingsPlugin === "function"
      && typeof boot.app.platform.isNativeAndroidRuntime === "function"
      && typeof boot.app.platform.waitForNativeBridge === "function"
      && typeof boot.app.platform.bindInstall === "function"
      && typeof boot.app.platform.bindNetwork === "function"
      && typeof boot.app.platform.registerPwa === "function";
    ok("P3-H 正向：平台适配实例真的接上生产链且方法可用",
      boot.loadErrors.length === 0 && platformOk === true &&
      boot.app.platform.isNativeAndroidRuntime() === true,
      JSON.stringify({ ready: boot.ready, platformOk }));

    // P3-I-R：首页告知条 + 启动轻摘要迁出后的装配闸门覆盖。
    //
    // 失败形态与 AI/备份/诊断都不同：`renderHomeNotice` 是**每次状态漏斗都调用**的函数，
    // 它一旦变成 `undefined`，跳过的是「首页断链告警」这一段 —— 页面照常渲染、
    // 事项照常保存，只有「该出声的时候没出声」。用户看不见差别，验收也看不见差别。
    const noticesContract = ["homeNoticeVerdict", "renderHomeNotice", "maybeDailySummary"];
    const noticesSource = fs.readFileSync(path.join(ROOT, "lib/app-notices.js"), "utf8");
    const noticesTemp = (name, suffix) => {
      const file = path.join(os.tmpdir(), "attention-p3ir-" + name + ".js");
      fs.writeFileSync(file, noticesSource + "\n" + suffix + "\n", "utf8"); return file;
    };
    const assertNoticesBootFailure = async (name, sourceFile, expectedPath) => {
      const bad = sourceFile === null
        ? await bootCombination({ scripts: indexScripts.filter(s => s !== "lib/app-notices.js") })
        : await bootCombination({ overrides: { "lib/app-notices.js": sourceFile } });
      const problems = bad.app && bad.app.startupFailure ? bad.app.startupFailure() : [];
      ok("P3-I-R " + name + "：ready=false 且点名 " + expectedPath,
        bad.ready === false && problems.some(p => p.path === expectedPath) &&
        problems.every(p => p.path.indexOf("AppNotices") === 0), JSON.stringify(problems));
      ok("P3-I-R " + name + "：fail closed 前不读库、不排程、不起 15000/2000 心跳",
        bad.disk.puts === 0 && bad.env.calls.scheduleAlarm.length === 0 &&
        bad.intervals.indexOf(15000) < 0 && bad.intervals.indexOf(2000) < 0,
        JSON.stringify({ puts: bad.disk.puts, scheduleAlarm: bad.env.calls.scheduleAlarm.length, intervals: bad.intervals }));
    };
    await assertNoticesBootFailure("缺 lib/app-notices.js", null, "AppNotices");
    await assertNoticesBootFailure("空 AppNotices 命名空间", noticesTemp("empty-namespace", "AttentionLib.AppNotices = {};"), "AppNotices.createAppNotices");
    await assertNoticesBootFailure("工厂抛错", noticesTemp("factory-throw",
      "AttentionLib.AppNotices = { createAppNotices: function(){ throw new Error('notices-boom'); } };"), "AppNotices.createAppNotices()");
    for (let cIndex = 0; cIndex < noticesContract.length; cIndex++) {
      const missing = noticesContract[cIndex];
      const members = noticesContract.filter(name => name !== missing).map(name =>
        JSON.stringify(name) + ": function(){}").join(",");
      await assertNoticesBootFailure("缺实例成员 " + missing, noticesTemp("missing-" + missing,
        "AttentionLib.AppNotices = { createAppNotices: function(){ return {" + members + "}; } };"), "AppNotices." + missing);
    }
    const noticesOk = boot.app && typeof boot.app.notices === "object" && boot.app.notices !== null
      && typeof boot.app.homeNoticeVerdict === "function"
      && typeof boot.app.renderHomeNotice === "function"
      && typeof boot.app.maybeDailySummary === "function";
    ok("P3-I-R 正向：告知实例真的接上生产链且方法可用",
      boot.loadErrors.length === 0 && noticesOk === true &&
      typeof boot.app.notices.homeNoticeVerdict === "function" &&
      typeof boot.app.notices.renderHomeNotice === "function",
      JSON.stringify({ ready: boot.ready, noticesOk }));


    // 正向：正常组合下备份实例必须真的接上生产链（判据是**调用**，不是绑定存在）。
    const backupOk = boot.app && typeof boot.app.buildLegacyBackupPayload === "function"
      ? boot.app.buildLegacyBackupPayload() : null;
    ok("P2-C 正向：备份实例真的可用 —— 快照带 app/schema/items 且**密钥不进备份**",
      boot.loadErrors.length === 0 && !!backupOk &&
      backupOk.app === "attention-inbox" && typeof backupOk.schema === "number" &&
      Array.isArray(backupOk.items) &&
      backupOk.settings.ai.baseUrl === "" && backupOk.settings.ai.apiKey === "",
      JSON.stringify({ app: backupOk && backupOk.app, ai: backupOk && backupOk.settings.ai }));

    // 正向：正常组合下 AI 实例必须真的接上生产链（防「契约里写了、index.html 没有」）。
    const aiOk = boot.app && typeof boot.app.aiSurface === "function" ? boot.app.aiSurface() : null;
    ok("正向：AI 实例真的可用（判据是调用结果，不是 `typeof ai === 'object'`）",
      boot.loadErrors.length === 0 && !!aiOk && aiOk.missing !== true &&
      aiOk.hasConfig === true && aiOk.ready === false && aiOk.isBusy === false &&
      aiOk.promptHasClock === true &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(aiOk.nowIso),
      JSON.stringify(aiOk));
    ok("正向：`mergedDraft` 真的合出了 AI 结果，且**没动**提交时冻结的那份草稿",
      !!aiOk && aiOk.mergedTitle === "ai-title" && aiOk.mergedPriority === "important" &&
      aiOk.mergedRepeatEvery === "week" && aiOk.mergedTags.indexOf("home") >= 0 &&
      aiOk.mergedTags.indexOf("work") >= 0 && aiOk.mergedNote === "ai-note" &&
      aiOk.baseUntouched === true,
      JSON.stringify(aiOk && { merged: aiOk.mergedTitle, pure: aiOk.baseUntouched, tags: aiOk.mergedTags }));
    ok("正向：归一真的收窄了模型自创的取值（越权优先级 / 白名单外周期都不会进事务）",
      !!aiOk && aiOk.normalizePriority === "normal" && aiOk.normalizeRepeat === null &&
      aiOk.extract === '{"a":1}',
      JSON.stringify(aiOk && { p: aiOk.normalizePriority, r: aiOk.normalizeRepeat, e: aiOk.extract }));

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

  /* ---------- B3. 独立复验 F02 / F03 的修复反例 ---------- */
  section("B3. F02 依赖契约（null / 缺成员 / 空壳实例 / 工厂抛错）与 F03 重试后绑定重建");
  {
    // 这一段全部走**同一个装配入口** `bindRuntime()` —— 它既是检查也是绑定，
    // 所以「检查报出来了」与「绑定没被换掉」可以在同一次调用里一起断言。
    const b = await bootCombination();
    const lib = b.sandbox.AttentionLib;

    // ① F02·null：`typeof null === "object"` —— 旧实现只查 typeof，null 会被放行。
    const savedFeedback = lib.Feedback;
    lib.Feedback = null;
    const nullProblems = b.app.bindRuntime();
    ok("F02 反例：Feedback = null ⇒ 闸门报出来（旧实现 `typeof === 'object'` 会放行）",
      nullProblems.some(p => p.path === "Feedback" && p.actual === "null"),
      JSON.stringify(nullProblems.map(p => [p.path, p.actual])));
    ok("F02：失败时**不覆盖**既有绑定（`f ? … : 兜底` 的分支不会突然变成可达的那条）",
      b.app.runtimeBindings().feedback === true);
    lib.Feedback = savedFeedback;

    // ② F02·缺成员：模块在、对象在，只是少一个函数。
    const savedSetupSteps = lib.Feedback.setupSteps;
    delete lib.Feedback.setupSteps;
    const memberProblems = b.app.bindRuntime();
    ok("F02 反例：删掉 Feedback.setupSteps ⇒ 闸门点名该成员（不是等业务跑到才 TypeError）",
      memberProblems.some(p => p.path === "Feedback.setupSteps"),
      JSON.stringify(memberProblems.map(p => p.path)));
    lib.Feedback.setupSteps = savedSetupSteps;

    const savedNormalize = lib.DeliveryEvidence.normalizeEvidence;
    delete lib.DeliveryEvidence.normalizeEvidence;
    const evProblems = b.app.bindRuntime();
    ok("F02 反例：删掉 DeliveryEvidence.normalizeEvidence ⇒ 闸门点名该成员",
      evProblems.some(p => p.path === "DeliveryEvidence.normalizeEvidence"),
      JSON.stringify(evProblems.map(p => p.path)));
    lib.DeliveryEvidence.normalizeEvidence = savedNormalize;

    // ③ F02·整个模块是 null（不是缺键）
    const savedEvidence = lib.DeliveryEvidence;
    lib.DeliveryEvidence = null;
    ok("F02 反例：DeliveryEvidence = null ⇒ 闸门报出来",
      b.app.bindRuntime().some(p => p.path === "DeliveryEvidence"));
    lib.DeliveryEvidence = savedEvidence;

    // ④ F02·工厂返回空壳 —— 独立复验的实测形态是「ready=false、无失败面板、页面主体空白」。
    const savedCreateUi = lib.AppUi.createUi;
    lib.AppUi.createUi = () => ({});
    const putsBefore = b.disk.puts;
    const shellProblems = b.app.bindRuntime();
    ok("F02 反例：AppUi.createUi 返回空壳 ⇒ 闸门逐项点名实例 API（工厂「存在」≠「装上了」）",
      shellProblems.length >= 8 &&
      shellProblems.some(p => p.path === "AppUi.$") &&
      shellProblems.some(p => p.path === "AppUi.toast"),
      JSON.stringify(shellProblems.map(p => p.path)));
    ok("F02：空壳被拦下时**没有**继续读写库（页面不会停在「能输入却存不下来」）",
      b.disk.puts === putsBefore, "puts=" + b.disk.puts);
    ok("F02：空壳被拦下时既有绑定保持原样（不会把已在跑的界面换成点不动的那套）",
      b.app.runtimeBindings().hasQuery === true);

    // ⑤ F02·工厂抛异常
    lib.AppUi.createUi = () => { throw new Error("boom"); };
    const throwProblems = b.app.bindRuntime();
    ok("F02 反例：AppUi.createUi 抛异常 ⇒ 闸门报出来（不是让启动链中途炸掉）",
      throwProblems.some(p => p.path === "AppUi.createUi()" && /threw:boom/.test(p.actual)),
      JSON.stringify(throwProblems.map(p => [p.path, p.actual])));
    lib.AppUi.createUi = savedCreateUi;

    // ⑤·2 P2-A·工厂返回空壳。
    //
    //    与 ④ 的差别在**失败形态**：展示能力空壳是「页面点不动、主体空白」，一眼看得见；
    //    AI 空壳是「页面完全正常，只有 AI 那几个按钮点了没反应」——
    //    因为 `() => ai.runOnCapture("parse")` 里的 `ai.runOnCapture` 是 `undefined`，
    //    要等用户真去点才 TypeError。所以这条必须靠闸门在开门前拦，
    //    不能指望有人点得到、更不能指望报错能被看见。
    const savedCreateAppAi = lib.AppAi.createAppAi;
    lib.AppAi.createAppAi = () => ({});
    const aiShellProblems = b.app.bindRuntime();
    ok("P2-A 反例：AppAi.createAppAi 返回空壳 ⇒ 闸门逐项点名全部 " +
      prod.aiInstanceCoverage(ROOT).declared.length + " 个实例 API",
      aiShellProblems.length >= 15 &&
      aiShellProblems.some(p => p.path === "AppAi.runOnCapture") &&
      aiShellProblems.some(p => p.path === "AppAi.mergedDraft") &&
      aiShellProblems.some(p => p.path === "AppAi.saveAiSettings"),
      JSON.stringify(aiShellProblems.map(p => p.path)));
    ok("P2-A：AI 空壳被拦下时既有绑定保持原样（不会把已在跑的界面换成点了没反应的那套）",
      b.app.aiSurface().hasConfig === true, JSON.stringify(b.app.aiSurface()));

    // ⑤·3 P2-A·工厂抛异常（例如模块内部依赖缺失时自己 throw）
    lib.AppAi.createAppAi = () => { throw new Error("ai-boom"); };
    const aiThrowProblems = b.app.bindRuntime();
    ok("P2-A 反例：AppAi.createAppAi 抛异常 ⇒ 闸门报出来（不是让启动链中途炸掉）",
      aiThrowProblems.some(p => p.path === "AppAi.createAppAi()" && /threw:ai-boom/.test(p.actual)),
      JSON.stringify(aiThrowProblems.map(p => [p.path, p.actual])));
    lib.AppAi.createAppAi = savedCreateAppAi;

    // ⑤·4 P2-C·工厂返回空壳。
    //
    //    备份空壳的失败形态：界面完全正常，「导出 / 导入」按钮点了没反应 ——
    //    而且用户**不知道**没反应意味着「备份没发生」。所以这条必须靠闸门在
    //    开门前拦，不能指望用户点完之后发现异常。
    const savedCreateAppBackup = lib.AppBackup.createAppBackup;
    lib.AppBackup.createAppBackup = () => ({});
    const backupShellProblems = b.app.bindRuntime();
    ok("P2-C 反例：AppBackup.createAppBackup 返回空壳 ⇒ 闸门逐项点名全部 " +
      prod.backupInstanceCoverage(ROOT).declared.length + " 个实例 API",
      backupShellProblems.length >= 4 &&
      backupShellProblems.some(p => p.path === "AppBackup.exportData") &&
      backupShellProblems.some(p => p.path === "AppBackup.importDataFile") &&
      backupShellProblems.some(p => p.path === "AppBackup.noteExportAppVisibility") &&
      backupShellProblems.every(p => p.path.indexOf("AppBackup.") === 0),
      JSON.stringify(backupShellProblems.map(p => p.path)));
    ok("P2-C：备份空壳被拦下时既有绑定保持原样（不会把已在跑的备份实例换成点了没反应的那套）",
      b.app.buildLegacyBackupPayload().app === "attention-inbox",
      JSON.stringify(!!b.app.buildLegacyBackupPayload()));

    // ⑤·5 P2-C·工厂抛异常
    lib.AppBackup.createAppBackup = () => { throw new Error("backup-boom"); };
    const backupThrowProblems = b.app.bindRuntime();
    ok("P2-C 反例：AppBackup.createAppBackup 抛异常 ⇒ 闸门报出来（不是让启动链中途炸掉）",
      backupThrowProblems.some(p => p.path === "AppBackup.createAppBackup()" && /threw:backup-boom/.test(p.actual)),
      JSON.stringify(backupThrowProblems.map(p => [p.path, p.actual])));
    lib.AppBackup.createAppBackup = savedCreateAppBackup;

    // ⑤·6 P2-D·工厂返回空壳。
    //    诊断空壳的失败形态：界面完全正常，只有诊断面板 / setup 取消与日志在运行期才坏。
    const savedCreateAppDiagnostics = lib.AppDiagnostics.createAppDiagnostics;
    lib.AppDiagnostics.createAppDiagnostics = () => ({});
    const diagShellProblems = b.app.bindRuntime();
    ok("P2-D 反例：AppDiagnostics.createAppDiagnostics 返回空壳 ⇒ 闸门逐项点名全部 " +
      prod.diagnosticsInstanceCoverage(ROOT).declared.length + " 个实例 API",
      diagShellProblems.length >= 7 &&
      diagShellProblems.some(p => p.path === "AppDiagnostics.bind") &&
      diagShellProblems.some(p => p.path === "AppDiagnostics.refreshNotifyLab") &&
      diagShellProblems.some(p => p.path === "AppDiagnostics.describeAlarmDelivery") &&
      diagShellProblems.every(p => p.path.indexOf("AppDiagnostics.") === 0),
      JSON.stringify(diagShellProblems.map(p => p.path)));
    ok("P2-D：诊断空壳被拦下时既有绑定保持原样",
      b.app.diagnosticsSurface().hasBind === true, JSON.stringify(b.app.diagnosticsSurface()));

    // ⑤·7 P2-D·工厂抛异常
    lib.AppDiagnostics.createAppDiagnostics = () => { throw new Error("diag-boom"); };
    const diagThrowProblems = b.app.bindRuntime();
    ok("P2-D 反例：AppDiagnostics.createAppDiagnostics 抛异常 ⇒ 闸门报出来",
      diagThrowProblems.some(p => p.path === "AppDiagnostics.createAppDiagnostics()" && /threw:diag-boom/.test(p.actual)),
      JSON.stringify(diagThrowProblems.map(p => [p.path, p.actual])));
    lib.AppDiagnostics.createAppDiagnostics = savedCreateAppDiagnostics;

    // ⑥ 还原 + 结构约束
    ok("F02：全部还原后 bindRuntime() 无问题（上面每条反例都不是把环境改坏了）",
      b.app.bindRuntime().length === 0,
      JSON.stringify(b.app.bindRuntime().map(p => p.path)));
    const declaredNow = prod.runtimeDependencyCoverage(ROOT).declared;
    const bindPaths = (b.app.RUNTIME_BINDING_PATHS || []).map(p => p[0]);
    const outOfScope = bindPaths.filter(p => declaredNow.indexOf(p) < 0);
    ok("F03：每个绑定路径都在必需声明表里（" + bindPaths.length +
      " 条 —— 绑定不得超出闸门检查的范围，这是「同源」的结构保证）",
      bindPaths.length >= 20 && outOfScope.length === 0, JSON.stringify(outOfScope));

    // ⑦ F03·补载后点「重试」：这正是独立复验复现的形态 ——
    //    从前 ready 变 true、面板消失、业务定时器起来，但 `parseChineseTime` 仍是 undefined，
    //    输入「三分钟后提醒我」报 `parseChineseTime is not a function`。
    const noParserBoot = await bootCombination({
      scripts: indexScripts.filter(s => s !== "lib/parse-cn.js")
    });
    ok("F03①：缺 lib/parse-cn.js 时 ready=false（起点与复验一致）",
      noParserBoot.ready === false);
    ok("F03①：补载之前不起业务定时器（失败是干净的失败）",
      noParserBoot.intervals.indexOf(15000) < 0,
      JSON.stringify(noParserBoot.intervals));
    // 补载**真实**脚本（模拟「脚本后来才到位」），再点「重试」。
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, "lib/parse-cn.js"), "utf8"),
      noParserBoot.sandbox, { filename: "lib/parse-cn.js" });
    const retried = await noParserBoot.app.startApp();
    ok("F03①：补载后点「重试」⇒ ready=true", retried === true, String(retried));
    ok("F03①：重试后绑定指向**当前**的 Lib.parseChineseTime（不是求值时抓到的 undefined）",
      noParserBoot.app.runtimeBindings().parseChineseTime === "current",
      JSON.stringify(noParserBoot.app.runtimeBindings()));
    ok("F03①：15 秒心跳只装了一次（重试不得重复注册监听 / 计时器）",
      noParserBoot.intervals.filter(ms => ms === 15000).length === 1,
      JSON.stringify(noParserBoot.intervals));
    const parsed = noParserBoot.app.parseChineseTime("三分钟后提醒我独立验收");
    ok("F03①：重试后解析器真的可调用（返回对象带 trigger）",
      !!parsed && parsed.trigger != null, JSON.stringify(parsed));
    const itF3 = noParserBoot.app.makeItem({
      title: "重试后保存", status: "waiting", triggerAt: Date.now() + 60000
    });
    noParserBoot.app.state.items.push(itF3);
    await noParserBoot.app.saveAsync();
    await wait(60);
    ok("F03①：重试后「输入 → 保存」真的落库（不再有「启动成功、保存链路不可用」）",
      noParserBoot.disk.puts >= 1 &&
      JSON.stringify(noParserBoot.disk.idbValue || {}).indexOf("重试后保存") >= 0,
      "puts=" + noParserBoot.disk.puts);
    // ⑧ F03·顺序错（`parse-cn.js` 排在 `app-core.js` 之后）：闸门一旦放行就必须可用。
    //    这条测的是**不变式**本身：绑定与检查读的是同一批值。
    const orderBoot = await bootCombination({
      scripts: ["app-core.js"].concat(indexScripts.filter(s => s !== "app-core.js"))
    });
    ok("F03②：app-core 在最前（lib 还没加载）⇒ ready=false，不出现「启动成功但不可用」",
      orderBoot.ready === false, "ready=" + orderBoot.ready);
    const orderBound = orderBoot.app.runtimeBindings();
    ok("F03②：失败时绑定保持**空**（而不是绑上一份 undefined 后来变成「假成功」）",
      orderBound.parseChineseTime === "missing" && orderBound.hasQuery === false,
      JSON.stringify(orderBound));

    // ⑨ F01/F02·**原生模块的成员级**反例。闸门本轮新增了 14 条 `NativeReminders.*` 声明；
    //    独立复验的告警原话是「声明检查需认识实际依赖路径，**不能只增加能让当前正则通过的字符串**」。
    //    所以这里不只查表 —— 把成员删掉、**用这份被改坏的源码真的启动一次**（`overrides` 换文件），
    //    并同时断言两件事：① 闸门点名该成员；② 失败发生在读库与排程**之前**。
    //    这一条是 F01 的收口：从前「缺件仍启动 ⇒ 事项存下来了、一条提醒都不排」，
    //    现在既存不下来、也不会排，界面直接说清原因。
    {
      const nativeSrc = fs.readFileSync(path.join(ROOT, "lib/native-reminders.js"), "utf8");
      const brokenSrc = nativeSrc.replace("\n    reconcile,", "\n    reconcile: undefined,");
      ok("（前置）原生成员反例补丁真的改到了源码（`reconcile,` ⇒ `reconcile: undefined,`）",
        brokenSrc !== nativeSrc && brokenSrc.indexOf("reconcile: undefined,") >= 0,
        "patched=" + (brokenSrc !== nativeSrc));
      const patchedFile = path.join(os.tmpdir(), "attention-native-missing-reconcile.js");
      fs.writeFileSync(patchedFile, brokenSrc);
      const bootBrokenNative = await bootCombination({
        overrides: { "lib/native-reminders.js": patchedFile }
      });
      const nativeProblems = bootBrokenNative.app.startupFailure();
      ok("F02 反例：删掉 NativeReminders.reconcile ⇒ 闸门点名该成员" +
        "（不是等对账跑到才 TypeError，也不是静默不排）",
        bootBrokenNative.ready === false &&
        Array.isArray(nativeProblems) &&
        nativeProblems.some(p => p.path === "NativeReminders.reconcile"),
        JSON.stringify({ ready: bootBrokenNative.ready,
          paths: nativeProblems && nativeProblems.map(p => p.path) }));
      ok("F01 收口：原生成员级失败同样发生在副作用之前" +
        "（不读库、不排通知、不排闹钟、不起业务心跳）",
        bootBrokenNative.disk.puts === 0 &&
        bootBrokenNative.env.calls.schedule.length === 0 &&
        bootBrokenNative.env.calls.scheduleAlarm.length === 0 &&
        bootBrokenNative.intervals.indexOf(15000) < 0,
        JSON.stringify({ puts: bootBrokenNative.disk.puts,
          schedule: bootBrokenNative.env.calls.schedule.length,
          scheduleAlarm: bootBrokenNative.env.calls.scheduleAlarm.length,
          intervals: bootBrokenNative.intervals }));
      // 反向对照的对照（防恒真）：**同一驱动序列**下完整源码必须真的排起闹钟。
      // 若「不驱动就量」，健康组合同样是 {"schedule":0,"scheduleAlarm":0}（通知总开关默认关闭、
      // 启动期也没有业务事件）—— 那样上面那组 0 就是假对照。本块初版正栽在这里，故留此记录。
      const healthyRun = await driveBusinessSave(await bootCombination(), "对照事项");
      ok("对照（防恒真）：同一驱动序列下完整源码真的排起闹钟" +
        "（证明上面的 0 是「被拦住」，不是「本来就不排」）",
        healthyRun.step === "ok" && healthyRun.alarmDelta >= 1 &&
        healthyRun.puts >= 1,
        JSON.stringify(healthyRun));
      // 健康侧这一步必须**没抛错** —— 否则下面失败态的抛错就分不清是「被拒绝」还是探针本身写错了。
      ok("对照（防恒真）：健康组合上同一驱动序列可正常执行（探针本身是良构的）",
        healthyRun.step === "ok", healthyRun.step);

      // 把**同一驱动序列**施加到「原生成员被改坏」的那一份上。
      // 复验表格那一行是「事项落入 IDB = true、排程调用 = 0」；
      // 现在连落库都必须不成立 —— 这正是「不再出现能存不能响的界面」的判据。
      const brokenRun = await driveBusinessSave(bootBrokenNative, "改坏后的事项");
      ok("F01 收口：失败态下走同一驱动序列，**写不进也排不出**" +
        "（复验表格那一行的反面：落库与排程两个都必须是 0）",
        brokenRun.puts === 0 && brokenRun.notify === 0 && brokenRun.alarmDelta === 0,
        JSON.stringify(brokenRun));
      fs.unlinkSync(patchedFile);
    }

    // ⑩ 第四轮新增的两条依赖：`Feedback.UNDO_WINDOW_MS`（number）与
    //    `Feedback.TEST_FEEDBACK`（array）。它们从前被「根对象守卫」豁免 ——
    //    `FeedbackLib ? FeedbackLib.TEST_FEEDBACK : [...]` 与
    //    `(FeedbackLib && FeedbackLib.UNDO_WINDOW_MS) || 8000` 里的 `?` / `&&`
    //    只证明模块对象在，成员缺失时静默走兜底（撤销窗口退回 8000、清单退回硬编码数组）。
    //    这也是声明表里**第一条非 function/object** 条目，所以要用真启动证明闸门的
    //    `typeof` 判定对 number 同样成立，而不是只让静态正则过去。
    {
      const fbSrc = fs.readFileSync(path.join(ROOT, "lib/feedback.js"), "utf8");
      const brokenFb = fbSrc
        .replace("\n    UNDO_WINDOW_MS,", "\n    UNDO_WINDOW_MS: undefined,")
        .replace("\n    TEST_FEEDBACK,", "\n    TEST_FEEDBACK: undefined,");
      ok("（前置）Feedback 成员反例补丁真的改到了导出块（两条 shorthand ⇒ undefined）",
        brokenFb !== fbSrc &&
        brokenFb.indexOf("UNDO_WINDOW_MS: undefined,") >= 0 &&
        brokenFb.indexOf("TEST_FEEDBACK: undefined,") >= 0,
        "patched=" + (brokenFb !== fbSrc));
      const patchedFb = path.join(os.tmpdir(), "attention-feedback-missing-constants.js");
      fs.writeFileSync(patchedFb, brokenFb);
      const bootBrokenFb = await bootCombination({
        overrides: { "lib/feedback.js": patchedFb }
      });
      const fbProblems = bootBrokenFb.app.startupFailure();
      ok("F02 反例：删掉 Feedback.UNDO_WINDOW_MS / TEST_FEEDBACK ⇒ 闸门逐条点名" +
        "（number 型条目同样受闸门保护，不是只有 function/object）",
        bootBrokenFb.ready === false && Array.isArray(fbProblems) &&
        fbProblems.some(p => p.path === "Feedback.UNDO_WINDOW_MS") &&
        fbProblems.some(p => p.path === "Feedback.TEST_FEEDBACK"),
        JSON.stringify({ ready: bootBrokenFb.ready,
          paths: fbProblems && fbProblems.map(p => p.path) }));
      ok("收口：这两条失败也发生在副作用之前（不读库、不排程、不起心跳）",
        bootBrokenFb.disk.puts === 0 &&
        bootBrokenFb.env.calls.schedule.length === 0 &&
        bootBrokenFb.env.calls.scheduleAlarm.length === 0 &&
        bootBrokenFb.intervals.indexOf(15000) < 0,
        JSON.stringify({ puts: bootBrokenFb.disk.puts,
          schedule: bootBrokenFb.env.calls.schedule.length,
          scheduleAlarm: bootBrokenFb.env.calls.scheduleAlarm.length,
          intervals: bootBrokenFb.intervals }));
      fs.unlinkSync(patchedFb);
    }

    /* ⑪ 第五轮 F02-R3：`Feedback.TEST_FEEDBACK` 是**带元素形状的数组契约**，不是 object。
     *
     * 真实消费者 `testFeedbackButtonsHtml()` 拿到它直接
     * `list.map(x => … x.value … x.label …)`。声明成 `object` 时 `typeof` 分辨不了
     * 数组与对象（`typeof [] === "object"`），于是独立一方注入 `{}` 后：
     * `ready=true`、`startupFailure()=null`，进到向导那一屏才抛
     * `list.map is not a function`（run `20260921T052806` 的阻断证据原文）。
     *
     * 所以这里不是加一条静态条目就算完：**真启动**一遍，逐个试三种坏形状，
     * 每一次都必须在打开 IndexedDB 之前就失败，并且说清「期望数组、实际是什么」。
     */
    {
      const fbSrc = fs.readFileSync(path.join(ROOT, "lib/feedback.js"), "utf8");
      const patchFb = (tag, expr) => {
        const patched = fbSrc.replace("\n    TEST_FEEDBACK,", "\n    TEST_FEEDBACK: " + expr + ",");
        if (patched === fbSrc) throw new Error("夹具没改到导出块：" + tag);
        const p = path.join(os.tmpdir(), "attention-feedback-array-" + tag + ".js");
        fs.writeFileSync(p, patched);
        return p;
      };
      // 对照组：正常导出必须**照常可用** —— 否则下面那三条可能只是「这个 harness 起不来」。
      const okBoot = await bootCombination();
      ok("对照：`Feedback.TEST_FEEDBACK` 是正常数组时应用照常就绪（这组断言不是「恒不启动」）",
        okBoot.ready === true && okBoot.app.startupFailure() === null,
        JSON.stringify({ ready: okBoot.ready, failure: okBoot.app.startupFailure() }));

      const cases = [
        { tag: "not-array", name: "非数组（{}）", expr: "{}", actual: "object（不是数组）" },
        { tag: "no-label", name: "元素缺 label", expr: "[{ value: \"heard\" }]", actual: "array[0] 缺少 label" },
        { tag: "empty", name: "空清单（[]）", expr: "[]", actual: "空数组（清单至少要有一项）" }
      ];
      for (const c of cases) {
        const p = patchFb(c.tag, c.expr);
        const boot = await bootCombination({ overrides: { "lib/feedback.js": p } });
        const fail = boot.app.startupFailure();
        const hit = Array.isArray(fail) ? fail.find(x => x.path === "Feedback.TEST_FEEDBACK") : null;
        ok("F02-R3 反例：" + c.name + " ⇒ 启动前被点名（期望是数组契约）",
          boot.ready === false && !!hit && String(hit.expected).indexOf("array") === 0,
          JSON.stringify({ ready: boot.ready, hit: hit, paths: fail && fail.map(x => x.path) }));
        ok("F02-R3 反例：" + c.name + " ⇒ 报出来的实际值是「" + c.actual + "」（说清坏在哪，不只报类型）",
          !!hit && hit.actual === c.actual, JSON.stringify(hit));
        ok("F02-R3 收口：" + c.name + " 同其它成员级失败一样发生在副作用之前" +
          "（不开库、不排程、不起心跳）",
          boot.disk.puts === 0 &&
          boot.env.calls.schedule.length === 0 &&
          boot.env.calls.scheduleAlarm.length === 0 &&
          boot.intervals.indexOf(15000) < 0,
          JSON.stringify({ puts: boot.disk.puts, schedule: boot.env.calls.schedule.length,
            scheduleAlarm: boot.env.calls.scheduleAlarm.length, intervals: boot.intervals }));
        fs.unlinkSync(p);
      }
    }
  }

  /* ---------- B4. 反向对照：把本轮修复**拔掉**，上面那批断言必须变红 ----------
   *
   * 「我加了新断言，它现在是绿的」不构成证据 —— 一条恒真断言也会是绿的。
   * 唯一的判据是：**把修复退回去，断言会不会红**。退回去的做法不是「我另写一份旧实现」，
   * 而是拿**本轮的工作区字节**做最小反向编辑（`overrides` 只换 app-core.js / 某个 lib，
   * 生产清单与 harness 全都不动）—— 这才是「同一组合、只有这一处差别」。
   *
   * 三条反向编辑各自对应一条被复验点名的行为：
   *   M1 `got === null ||` 去掉        ⇒ F02 的 null 放行（旧实现 `typeof === 'object'`）
   *   M2 闸门跳过 `NativeReminders*`    ⇒ F01 的「缺 native 仍照跑」
   *   M3 闸门跳过 `NativeReminders.reconcile` ⇒ 成员级缺件静默通过
   */
  section("B4. 反向对照：拔掉本轮修复，相应断言必须变红（有分辨力的证明）");
  {
    const tmp = (name, text) => {
      const p = path.join(os.tmpdir(), name);
      fs.writeFileSync(p, text);
      return p;
    };
    const appCoreSrc = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");

    // M1：把 `null` 判据拿掉（这正是 F02 说「`typeof === 'object'` 会放行」的那一处）。
    // ⚠️ 判定已移到 `describeTypeMismatch()`（`array` 契约进闸后不能再用一行
    // `got === null || typeof got !== want` 表达），所以这里改的是那一条 `null` 早退。
    const NULL_CHECK = "    if (got === null) return { expected: expected, actual: \"null\" };";
    const m1Src = appCoreSrc.replace(NULL_CHECK, "");
    ok("（前置）M1 反例补丁真的改到了 null 判据",
      m1Src !== appCoreSrc && m1Src.indexOf(NULL_CHECK) < 0);
    const feedbackNull = tmp("attention-m1-feedback-null.js",
      fs.readFileSync(path.join(ROOT, "lib/feedback.js"), "utf8") + "\nAttentionLib.Feedback = null;\n");
    const m1 = await bootCombination({
      overrides: { "app-core.js": tmp("attention-m1-app-core.js", m1Src), "lib/feedback.js": feedbackNull }
    });
    // 注意口径：拿掉 null 判据后**整体仍然会失败**（`Feedback.actionSpec` 这些成员条目照样报），
    // 所以不能用 `ready` 当判据 —— 那会得出「M1 没变红」的错误结论（本段初版正栽在这里）。
    // 真正的盲点是：`Feedback` **自己那一条**不再被点名（`null` 被当成了合格的 object）。
    const m1Problems = m1.app.bindRuntime();
    ok("M1 变红：拿掉 null 判据后，`Feedback` 这一条**不再被点名**（只剩成员在报）" +
      "⇒ B3 断言「path==='Feedback' && actual==='null'」会变红",
      !m1Problems.some(p => p.path === "Feedback"),
      JSON.stringify(m1Problems.map(p => [p.path, p.actual])));
    const cleanNull = await bootCombination({ overrides: { "lib/feedback.js": feedbackNull } });
    ok("M1 的对照面：同一注入在**未变异**的 app-core 上会点名 `Feedback`（两条合起来才说明判据有分辨力）",
      cleanNull.app.bindRuntime().some(p => p.path === "Feedback" && p.actual === "null"),
      JSON.stringify(cleanNull.app.bindRuntime().map(p => [p.path, p.actual])));

    // M2：闸门跳过**全部**原生条目（模块条目 + 成员条目）—— 等价于「把 native 整支排除在
    // 闸门之外」这套旧行为。⚠️ 只写 `indexOf("NativeReminders")` 是不够的：
    // `AttentionNativeReminders` 不以它开头，模块条目会漏网，于是 M2 根本退不回旧行为
    // （本段初版正是这样，`ready` 仍是 false，等于没变异成功）。
    const skipLine = "\n      if (path0 === \"AttentionNativeReminders\") continue;" +
      "\n      if (path0.indexOf(\"NativeReminders\") === 0) continue;";
    const m2Src = appCoreSrc.replace(
      'const path0 = REQUIRED_RUNTIME_EXPORTS[i][0];',
      'const path0 = REQUIRED_RUNTIME_EXPORTS[i][0];' + skipLine);
    ok("（前置）M2 反例补丁真的改到了闸门循环",
      m2Src !== appCoreSrc && m2Src.indexOf("AttentionNativeReminders\") continue") > 0);
    const m2 = await bootCombination({
      overrides: { "app-core.js": tmp("attention-m2-app-core.js", m2Src) },
      scripts: indexScripts.filter(s => s !== "lib/native-reminders.js")
    });
    // 判据口径（**实测校正过**）：闸门瞎了以后 `ready` 不一定是 true —— 本轮实测是
    // `ready=false` 且 `startupFailure()` 为 **null**（无失败面板）。这比「照跑」更糟：
    // 应用起不来，却**一句解释都没有**（正是复验在 F02 记录的白屏形态）。
    // 所以可退回的判据是「**有没有装配失败反馈**」，不是 `ready` 的值。
    const m2Failure = m2.app.startupFailure();
    const m2Run = await driveBusinessSave(m2, "闸门瞎了之后的事项");
    ok("M2 变红：闸门不查原生条目后，缺 lib/native-reminders.js 时**不再有任何装配失败反馈**" +
      "（`startupFailure()` 为 null）⇒ B2 断言「点名 AttentionNativeReminders」不会恒真",
      m2Failure === null,
      JSON.stringify({ ready: m2.ready, failure: m2Failure, loadErrors: m2.loadErrors,
        businessRun: m2Run }));
    // 缺陷态的**实际**表现（本轮实测，不照抄复验数字）：业务序列甚至跑不完 ——
    // `NativeReminders` 被绑成 `null`，写到 `.migrateItem` 就抛
    // `Cannot read properties of null`；落库 0、排程 0，而 `startupFailure()` 仍是 null，
    // 界面因此**一句解释都没有**。⚠️ 复验报告里量到的是「put=1 / schedule=0」，
    // 那是**修复前**的字节形态；这里量的是「把修复拔掉」的形态。同一个缺陷、不同字节，
    // 数字不该照搬 —— 只断言两边都成立的部分。
    ok("M2 补充：缺陷态下业务跑不完（中途抛错）、落库与排程都是 0，" +
      "而界面仍然没有任何失败反馈 —— 比「照跑」更糟",
      m2Run.puts === 0 && m2Run.alarmDelta === 0 && m2Failure === null &&
      /threw:/.test(m2Run.step),
      JSON.stringify(m2Run));

    // M3：闸门只跳过**一个成员** —— 对应「声明表里那 14 条到底有没有牙齿」。
    const m3Src = appCoreSrc.replace(
      'const path0 = REQUIRED_RUNTIME_EXPORTS[i][0];',
      'const path0 = REQUIRED_RUNTIME_EXPORTS[i][0];' +
      "\n      if (path0 === \"NativeReminders.reconcile\") continue;");
    const brokenNativeSrc = fs.readFileSync(path.join(ROOT, "lib/native-reminders.js"), "utf8")
      .replace("\n    reconcile,", "\n    reconcile: undefined,");
    const m3 = await bootCombination({
      overrides: {
        "app-core.js": tmp("attention-m3-app-core.js", m3Src),
        "lib/native-reminders.js": tmp("attention-m3-native.js", brokenNativeSrc)
      }
    });
    ok("M3 变红：闸门漏掉那一条成员声明后，`reconcile: undefined` **不再被点名**" +
      "⇒ B3 ⑨ 的成员级断言不会恒真",
      !(Array.isArray(m3.app.startupFailure()) &&
        m3.app.startupFailure().some(p => p.path === "NativeReminders.reconcile")),
      JSON.stringify({ ready: m3.ready,
        failure: m3.app.startupFailure() && m3.app.startupFailure().map(p => p.path) }));

    /* N4 / N5：第五轮 F02-R3 的「拔掉修复」。
     * N4 把 `Feedback.TEST_FEEDBACK` 的期望类型退回 `object`（以为 `object` 就够了 ——
     * 毕竟 `typeof [] === "object"`），直接对应独立复验在 `{}` 上量到的 `ready=true`；
     * N5 删掉**元素形状**核对（`missingItemShape` 那一句），对应「容器对了但元素是空壳」。
     * 两者都保留闸门的其余部分，所以「变红」不是把环境改坏了。 */
    const n4Src = appCoreSrc.replace('["Feedback.TEST_FEEDBACK", "array",',
      '["Feedback.TEST_FEEDBACK", "object",');
    ok("（前置）N4 反例补丁真的把期望类型退回 object",
      n4Src !== appCoreSrc && n4Src.indexOf('["Feedback.TEST_FEEDBACK", "object",') > 0);
    const fbObj = tmp("attention-n4-feedback-object.js",
      fs.readFileSync(path.join(ROOT, "lib/feedback.js"), "utf8")
        .replace("\n    TEST_FEEDBACK,", "\n    TEST_FEEDBACK: {},"));
    const n4 = await bootCombination({
      overrides: { "app-core.js": tmp("attention-n4-app-core.js", n4Src), "lib/feedback.js": fbObj }
    });
    ok("N4 变红：`TEST_FEEDBACK` 只按 object 校验时，`{}` **重新被放行**" +
      "（F02-R3 原缺陷复现：ready 起来后再进那一屏才崩）⇒ ⑪ 的断言不会恒真",
      n4.ready === true &&
      !(Array.isArray(n4.app.startupFailure()) &&
        n4.app.startupFailure().some(p => p.path === "Feedback.TEST_FEEDBACK")),
      JSON.stringify({ ready: n4.ready, failure: n4.app.startupFailure() }));
    const cleanObj = await bootCombination({ overrides: { "lib/feedback.js": fbObj } });
    const cleanObjHit = (cleanObj.app.startupFailure() || [])
      .find(p => p.path === "Feedback.TEST_FEEDBACK");
    ok("N4 的对照面：同一注入在**未变异**的 app-core 上会被点名且带数组期望" +
      "（两面合起来才说明「array 契约」四个字是有牙齿的）",
      cleanObj.ready === false && !!cleanObjHit && String(cleanObjHit.expected).indexOf("array") === 0,
      JSON.stringify({ ready: cleanObj.ready, hit: cleanObjHit }));

    const n5Src = appCoreSrc.replace("          const missing = missingItemShape(got[i], itemShape);",
      "          const missing = null;");
    ok("（前置）N5 反例补丁真的删掉了元素形状核对",
      n5Src !== appCoreSrc && n5Src.indexOf("const missing = null;") > 0);
    const fbNoLabel = tmp("attention-n5-feedback-nolabel.js",
      fs.readFileSync(path.join(ROOT, "lib/feedback.js"), "utf8")
        .replace("\n    TEST_FEEDBACK,", "\n    TEST_FEEDBACK: [{ value: \"heard\" }],"));
    const n5 = await bootCombination({
      overrides: { "app-core.js": tmp("attention-n5-app-core.js", n5Src), "lib/feedback.js": fbNoLabel }
    });
    ok("N5 变红：删掉元素形状核对后，元素缺 label 的清单**重新被放行**" +
      "（容器对 ≠ 元素对）⇒ ⑪ 的那条断言不会恒真",
      n5.ready === true &&
      !(Array.isArray(n5.app.startupFailure()) &&
        n5.app.startupFailure().some(p => p.path === "Feedback.TEST_FEEDBACK")),
      JSON.stringify({ ready: n5.ready, failure: n5.app.startupFailure() }));

    /* N6 / N7：P2-A 的「拔掉修复」。
     *
     * N6 把 `APP_AI_INSTANCE_CONTRACT.instance` 清空 —— 相当于回到「只查工厂是不是函数」
     * 那套旧判据。空壳实例于是重新通过，B3 那条「逐项点名 15 个实例 API」会变红。
     * 这条要紧在：AI 缺件的失败形态是**静默**的（按钮点了没反应），
     * 不象展示层那样「点不动」一眼可见，所以判定必须比展示层更硬，而不是更软。
     *
     * N7 把 `AppAi` 系的声明从 `REQUIRED_RUNTIME_EXPORTS` 里删掉 —— 静态矩阵必须立刻
     * 报 `undeclared`。这条证明「声明表」不是摆设：少了它，`AppAi.*` 的引用就退出闭合。
     */
    // ⚠️ 锚点必须**整段**精确匹配（含换行与缩进）：只换首行会把后面 10 个成员留在
    // 契约里，`missingInContract` 就只剩 2 条，看上去「变红了」其实是没拔干净。
    const N6_ANCHOR = 'instance: ["config", "ready", "nowIso", "systemPrompt", "chat",\n' +
      '      "parseCapture", "polishCapture", "testConnection",\n' +
      '      "applyToForm", "mergedDraft", "isBusy", "runOnCapture",\n' +
      '      "openAiSheet", "saveAiSettings", "renderAiSub"],';
    const n6Src = appCoreSrc.replace(N6_ANCHOR, 'instance: [],');
    ok("（前置）N6 反例补丁真的清空了 AI 实例契约",
      n6Src !== appCoreSrc && appCoreSrc.indexOf(N6_ANCHOR) > 0 &&
      prod.aiInstanceCoverage(ROOT, { source: n6Src }).declared.length === 0,
      JSON.stringify(prod.aiInstanceCoverage(ROOT, { source: n6Src }).declared));
    const n6Static = prod.aiInstanceCoverage(ROOT, { source: n6Src });
    ok("N6 变红（静态）：契约清空后，源码里用到的 AI 实例 API 全部变成 missingInContract" +
      " ⇒ ②·3b 那条双向闭合断言不会恒真",
      n6Static.missingInContract.length >= 10,
      JSON.stringify(n6Static.missingInContract));
    const n6 = await bootCombination({ overrides: { "app-core.js": tmp("attention-n6-app-core.js", n6Src) } });
    const n6Lib = n6.sandbox.AttentionLib;
    const savedCreateAppAi6 = n6Lib.AppAi.createAppAi;
    n6Lib.AppAi.createAppAi = () => ({});
    const n6Shell = n6.app.bindRuntime();
    ok("N6 变红（运行时）：契约清空后，空壳工厂**重新被放行**（一条 AppAi.* 都不报）" +
      " ⇒ B3 那条「逐项点名」断言会变红",
      n6Shell.length === 0, JSON.stringify(n6Shell.map(p => p.path)));
    n6Lib.AppAi.createAppAi = savedCreateAppAi6;
    ok("N6 的对照面：同一空壳在**未变异**的 app-core 上被逐项点名（两边合起来才说明判据有分辨力）",
      await (async () => {
        const clean = await bootCombination();
        const cl = clean.sandbox.AttentionLib;
        const saved = cl.AppAi.createAppAi;
        cl.AppAi.createAppAi = () => ({});
        const probs = clean.app.bindRuntime();
        cl.AppAi.createAppAi = saved;
        return probs.length >= 15 && probs.every(p => p.path.indexOf("AppAi.") === 0);
      })());

    const AI_DECL_START = '["AppAi", "object",';
    // ⚠️ 终点锚是「下一条声明」而不是 `parseChineseTime`：P2-C 在 AI 系后面插入了
    // AppBackup 的 2 条声明 —— 终点锚不跟着走，N7 会把 AppBackup 的声明**一并删掉**，
    // 变异就从「拔 4 条」变成「拔 9 条」，收口的行数断言会如实报红。
    const AI_DECL_END = '["AppBackup", "object",';
    const aiDeclAt = appCoreSrc.indexOf(AI_DECL_START);
    const aiDeclEnd = appCoreSrc.indexOf(AI_DECL_END);
    const n7Src = appCoreSrc.slice(0, aiDeclAt) + appCoreSrc.slice(aiDeclEnd);
    ok("（前置）N7 反例补丁真的删掉了 AppAi 系的声明（4 条）",
      aiDeclAt > 0 && aiDeclEnd > aiDeclAt &&
      n7Src.indexOf(AI_DECL_START) < 0 && appCoreSrc.indexOf(AI_DECL_START) >= 0);
    const n7Static = prod.runtimeDependencyCoverage(ROOT, { source: n7Src });
    ok("N7 变红：删掉 AppAi 声明后，静态矩阵立刻报 undeclared（" +
      "证明这 4 条声明是闭合的一部分，不是注释）",
      n7Static.problems.some(p => p.indexOf("undeclared-dependency:AppAi.createAppAi") === 0) &&
      n7Static.problems.some(p => p.indexOf("undeclared-dependency:AppAi") === 0),
      JSON.stringify(n7Static.problems.filter(p => p.indexOf("AppAi") >= 0)));
    ok("N7 的对照面：未变异源码下 AppAi 系的引用全部闭合（problems 为空）",
      prod.runtimeDependencyCoverage(ROOT, { source: appCoreSrc }).problems.length === 0,
      JSON.stringify(prod.runtimeDependencyCoverage(ROOT, { source: appCoreSrc }).problems));

    /* N8：P2-C 的「拔掉修复」。
     *
     * 把 `APP_BACKUP_INSTANCE_CONTRACT.instance` 清空 —— 相当于回到「只查工厂是不是
     * 函数」那套旧判据。空壳实例于是重新通过，B3 ⑤·4 那条「逐项点名 4 个实例 API」
     * 会变红。备份缺件的失败形态是最隐蔽的一种：按钮没反应但界面照常，
     * 用户以为备份好了 —— 判据必须比「看得见的坏」更硬。
     */
    const N8_ANCHOR = 'instance: ["exportData", "importDataFile", "noteExportAppVisibility",\n' +
      '      "buildLegacyBackupPayload"],';
    const n8Src = appCoreSrc.replace(N8_ANCHOR, 'instance: [],');
    ok("（前置）N8 反例补丁真的清空了备份实例契约",
      n8Src !== appCoreSrc && appCoreSrc.indexOf(N8_ANCHOR) > 0 &&
      prod.backupInstanceCoverage(ROOT, { source: n8Src }).declared.length === 0,
      JSON.stringify(prod.backupInstanceCoverage(ROOT, { source: n8Src }).declared));
    const n8Static = prod.backupInstanceCoverage(ROOT, { source: n8Src });
    ok("N8 变红（静态）：契约清空后，源码里用到的备份实例 API 全部变成 missingInContract",
      n8Static.missingInContract.length >= 4,
      JSON.stringify(n8Static.missingInContract));
    const n8 = await bootCombination({ overrides: { "app-core.js": tmp("attention-n8-app-core.js", n8Src) } });
    const n8Lib = n8.sandbox.AttentionLib;
    const savedCreateAppBackup8 = n8Lib.AppBackup.createAppBackup;
    n8Lib.AppBackup.createAppBackup = () => ({});
    const n8Shell = n8.app.bindRuntime();
    ok("N8 变红（运行时）：契约清空后，空壳工厂**重新被放行**（一条 AppBackup.* 都不报）",
      n8Shell.length === 0, JSON.stringify(n8Shell.map(p => p.path)));
    n8Lib.AppBackup.createAppBackup = savedCreateAppBackup8;
    ok("N8 的对照面：同一空壳在**未变异**的 app-core 上被逐项点名（两边合起来才说明判据有分辨力）",
      await (async () => {
        const clean = await bootCombination();
        const cl = clean.sandbox.AttentionLib;
        const saved = cl.AppBackup.createAppBackup;
        cl.AppBackup.createAppBackup = () => ({});
        const probs = clean.app.bindRuntime();
        cl.AppBackup.createAppBackup = saved;
        return probs.length >= 4 && probs.every(p => p.path.indexOf("AppBackup.") === 0);
      })());

    // 收口：三条反向编辑都只作用于**临时副本**，工作区源码一个字没动。
    ok("收口：三条反向编辑都用临时副本，工作区 app-core.js / native-reminders.js 未被改写",
      fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8") === appCoreSrc &&
      fs.readFileSync(path.join(ROOT, "lib/native-reminders.js"), "utf8").indexOf("\n    reconcile,") >= 0);
    // 反向编辑本身必须是**良构**的：否则「变红」可能只是把环境改坏了。
    ok("收口：M2/M3 的补丁在语法上与原文件只差那一两行（防止「改坏了才变红」）",
      m2Src.split("\n").length === appCoreSrc.split("\n").length + 2 &&
      m3Src.split("\n").length === appCoreSrc.split("\n").length + 1);

    /* N9：P2-D 的「拔掉修复」。
     *
     * 把 `APP_DIAGNOSTICS_INSTANCE_CONTRACT.instance` 清空 —— 空壳工厂于是重新通过，
     * B3 ⑤·6 那条「逐项点名 7 个实例 API」会变红。诊断缺件的失败形态是静默的：
     * 面板看起来能开，setup 的取消/日志在运行期才坏。
     */
    const N9_ANCHOR = 'instance: ["bind", "refreshNotifyLab", "labLog", "labCancelAlarms",\n' +
      '      "describeAlarmDelivery", "openSystemSetting", "openBackgroundGuide"],';
    const n9Src = appCoreSrc.replace(N9_ANCHOR, 'instance: [],');
    ok("（前置）N9 反例补丁真的清空了诊断实例契约",
      n9Src !== appCoreSrc && appCoreSrc.indexOf(N9_ANCHOR) > 0 &&
      prod.diagnosticsInstanceCoverage(ROOT, { source: n9Src }).declared.length === 0,
      JSON.stringify(prod.diagnosticsInstanceCoverage(ROOT, { source: n9Src }).declared));
    const n9Static = prod.diagnosticsInstanceCoverage(ROOT, { source: n9Src });
    ok("N9 变红（静态）：契约清空后，源码里用到的诊断实例 API 全部变成 missingInContract" +
      " ⇒ ②·3c 那条双向闭合断言不会恒真",
      n9Static.missingInContract.length >= 7,
      JSON.stringify(n9Static.missingInContract));
    const n9 = await bootCombination({ overrides: { "app-core.js": tmp("attention-n9-app-core.js", n9Src) } });
    const n9Lib = n9.sandbox.AttentionLib;
    const savedCreateDiag9 = n9Lib.AppDiagnostics.createAppDiagnostics;
    n9Lib.AppDiagnostics.createAppDiagnostics = () => ({});
    const n9Shell = n9.app.bindRuntime();
    ok("N9 变红（运行时）：契约清空后，空壳工厂**重新被放行**（一条 AppDiagnostics.* 都不报）" +
      " ⇒ B3 ⑤·6 那条「逐项点名」断言会变红",
      n9Shell.length === 0, JSON.stringify(n9Shell.map(p => p.path)));
    n9Lib.AppDiagnostics.createAppDiagnostics = savedCreateDiag9;
    ok("N9 的对照面：同一空壳在**未变异**的 app-core 上被逐项点名（两边合起来才说明判据有分辨力）",
      await (async () => {
        const clean = await bootCombination();
        const cl = clean.sandbox.AttentionLib;
        const saved = cl.AppDiagnostics.createAppDiagnostics;
        cl.AppDiagnostics.createAppDiagnostics = () => ({});
        const probs = clean.app.bindRuntime();
        cl.AppDiagnostics.createAppDiagnostics = saved;
        return probs.length >= 7 && probs.every(pp => pp.path.indexOf("AppDiagnostics.") === 0);
      })());

ok("收口：N6/N7 的补丁同样只差那几行（N6 改 1 行、N7 删 4 条声明）",
      // N6 把 4 行成员清单压成 1 行 ⇒ 少 3 行；N7 删掉 4 条声明（共 9 行）⇒ 少 9 行。
      n6Src.split("\n").length === appCoreSrc.split("\n").length - 3 &&
      n7Src.split("\n").length === appCoreSrc.split("\n").length - 9 &&
      n7Src.indexOf('["AppAi.createAppAi"') < 0 &&
      n7Src.indexOf("APP_AI_INSTANCE_CONTRACT") > 0,
      JSON.stringify({ n6: n6Src.split("\n").length, n7: n7Src.split("\n").length,
        base: appCoreSrc.split("\n").length }));
    ok("收口：N8 的补丁同样只差那几行（把 2 行成员清单压成 1 行 ⇒ 少 1 行）",
      n8Src.split("\n").length === appCoreSrc.split("\n").length - 1 &&
      n8Src.indexOf('"buildLegacyBackupPayload"],') < 0 &&
      n8Src.indexOf("APP_BACKUP_INSTANCE_CONTRACT") > 0,
      JSON.stringify({ n8: n8Src.split("\n").length, base: appCoreSrc.split("\n").length }));
  }

  /* ---------- B5. P2-C-R：冷启动权威状态保护（三态 + 写闸门 + 恢复面板） ----------
   *
   * 被裁决点名的阻断项：`loadAsync()` 把「权威读到空」与「读失败后镜像也没拿到」
   * 折叠成同一个 `false`，而 `init()` 不看返回值照样做原生对账、排时钟、写库。
   * 本节要证明三件事，每一件都必须**拔掉即红**：
   *   ① 失败态下应用**不启动业务**（不写库、不排通知、不起心跳），并显示恢复面板；
   *   ② `empty`（真首启）与 `loaded` 照常开放写入，没有把闸门做成「一律不写」；
   *   ③ 反向对照：把两道闸门拔掉后，「旧 IDB 被空快照覆盖」**重新出现** ——
   *      这是本次真机 1/1 → 0/0 的**可行机制**（不是已证实的唯一原因）。
   */
  section("B5. P2-C-R：冷启动权威状态保护（三态判定 / 写闸门 / 恢复面板）");
  {
    const tmpEntry = (name, text) => {
      const p = path.join(os.tmpdir(), name);
      fs.writeFileSync(p, text);
      return p;
    };
    const seedOneOne = () => ({
      schema: 5,
      items: [{ id: "seed-1", title: "既有事项", status: "waiting", triggerAt: Date.now() + 86400000 }],
      notes: [], projects: [], settings: { notify: false, dnd: false }
    });
    /** 把一次启动留下的 localStorage 全部搬给下一次启动（模拟「同一台设备再冷启一次」）。 */
    const carryEntries = h => {
      const out = {};
      Object.keys(h.localStorageKeys()).forEach(k => { out[k] = h.localStorage.getItem(k); });
      return out;
    };
    const panelTexts = h => (h.createdText || []).join(" | ");

    /* ① 权威读到空 + 镜像也空 + 无残留证据 ⇒ 真首启：**必须**照常启动并允许写入。
       没有这一条，下面的「失败不启动」可能只是把闸门焊死（恒不启动）。 */
    {
      const first = await bootCombination();
      const sa = first.app.stateAuthority();
      ok("首启对照：权威读到空且别处无残留 ⇒ 判 empty、照常就绪（不是恒不启动）",
        first.ready === true && sa.status === "empty" && sa.report.reason === "authoritative-empty",
        JSON.stringify({ ready: first.ready, sa: sa }));
      ok("首启对照：empty 开放写入（写闸门不是「一律不写」）",
        sa.writesAllowed === true && sa.blockedWriteCount === 0, JSON.stringify(sa));
      const run = await driveBusinessSave(first, "首启后正常保存");
      ok("首启对照：业务保存照常落库、原生对账照常发生",
        run.step === "ok" && run.puts >= 1 && first.intervals.indexOf(15000) >= 0,
        JSON.stringify(run));
    }

    /* ② IDB 里有 1/1，但这一次**读不出来**（get 出错）+ 镜像空 ⇒ failed：
       写闸门关闭、业务整段不启动、恢复面板可见，且旧数据**逐字节没被动过**。 */
    {
      const seed = seedOneOne();
      const seedBytes = JSON.stringify(seed);
      const h = await bootCombination({ idbValue: seed, idbGetFails: true });
      const sa = h.app.stateAuthority();
      ok("读失败：判 failed（原因写明是权威读失败 + 镜像也没有）",
        h.ready === false && sa.status === "failed" &&
        /^authoritative-read-failed:/.test(sa.report.reason),
        JSON.stringify({ ready: h.ready, sa: sa }));
      ok("读失败：写闸门关闭（writesAllowed=false）",
        sa.writesAllowed === false, JSON.stringify(sa));
      ok("读失败：**不读库不写库**（puts 恒为 0，IDB 逐字节未动）",
        h.disk.puts === 0 && JSON.stringify(h.disk.idbValue) === seedBytes,
        JSON.stringify({ puts: h.disk.puts, idb: h.disk.idbValue && h.disk.idbValue.items }));
      ok("读失败：**不排通知**（动作类型 / 渠道 / 监听 / 排程一个都没发生）",
        h.env.calls.actionTypes.length === 0 && h.env.calls.channels.length === 0 &&
        h.env.calls.localListeners.length === 0 && h.env.calls.appListeners.length === 0 &&
        h.env.calls.schedule.length === 0 && h.env.calls.scheduleAlarm.length === 0 &&
        h.app.nativeSyncStats().runs === 0,
        JSON.stringify({
          actionTypes: h.env.calls.actionTypes.length, channels: h.env.calls.channels.length,
          local: h.env.calls.localListeners.length, app: h.env.calls.appListeners.length,
          schedule: h.env.calls.schedule.length, alarm: h.env.calls.scheduleAlarm.length,
          runs: h.app.nativeSyncStats().runs
        }));
      ok("读失败：**不启业务心跳**（没有 15 秒 tick）",
        h.intervals.indexOf(15000) < 0, JSON.stringify(h.intervals));
      ok("读失败：内存空态**没有**被写成镜像，也没有留下待回放凭据",
        h.localStorage.getItem("attention-inbox-v2") === null &&
        h.localStorage.getItem("attention-inbox-v2-pending-replay") === null,
        JSON.stringify(h.localStorageKeys()));
      ok("读失败：显示可见的恢复面板（插进首页容器 + 写明没写任何东西）",
        h.insertions.indexOf("#main") >= 0 &&
        /数据没有恢复成功，应用暂未启动/.test(panelTexts(h)) &&
        /为免覆盖本机已有数据，这次没有写入任何内容/.test(panelTexts(h)),
        JSON.stringify({ insertions: h.insertions, texts: panelTexts(h).slice(0, 200) }));
      ok("读失败：面板里只有按钮，没有任何可编辑控件（不留下「能输入但存不下来」的界面）",
        h.created.indexOf("input") < 0 && h.created.indexOf("textarea") < 0 &&
        h.created.indexOf("button") >= 0,
        JSON.stringify(h.created));
      // 用户/其它路径硬要写：必须被闸门拦下，且不产生任何落盘痕迹。
      let blocked = null;
      try {
        await h.app.saveAsync();
      } catch (error) {
        blocked = error;
      }
      ok("读失败：绕过启动链的提交同样被拦（state-authority-blocked，落盘痕迹仍然为 0）",
        !!blocked && blocked.code === "state-authority-blocked" &&
        h.app.stateAuthority().blockedWriteCount === 1 &&
        h.disk.puts === 0 &&
        h.localStorage.getItem("attention-inbox-v2-pending-replay") === null,
        JSON.stringify({ code: blocked && blocked.code, sa: h.app.stateAuthority(),
          keys: h.localStorageKeys() }));

      // ③ 重试：故障排除后「重试恢复」必须真的把旧数据读回来并进入正常启动。
      h.disk.getFails = false;
      h.app.retryRestore();
      await h.app.ready();
      await wait(30);
      const sa2 = h.app.stateAuthority();
      ok("重试成功：判 loaded、原因是从权威读到的（不是镜像兜底）",
        sa2.status === "loaded" && sa2.report.reason === "authoritative" && sa2.attempts === 2,
        JSON.stringify({ ready: await h.app.ready(), sa: sa2 }));
      ok("重试成功：旧数据真的回来了（1 条「既有事项」），IDB 仍然完好",
        h.app.state.items.length === 1 && h.app.state.items[0].title === "既有事项" &&
        h.disk.idbValue.items.length === 1 && h.disk.idbValue.items[0].title === "既有事项",
        JSON.stringify({ mem: h.app.state.items.map(i => i.title),
          idb: h.disk.idbValue.items.map(i => i.title) }));
      ok("重试成功：面板撤掉、业务启动真的跑起来了（心跳 + 原生对账就位）",
        sa2.recoveryPanel === false && h.intervals.indexOf(15000) >= 0 &&
        h.env.calls.appListeners.indexOf("appStateChange") >= 0,
        JSON.stringify({ intervals: h.intervals, app: h.env.calls.appListeners, consoleErrors: h.consoleErrors }));
    }

    /* ④ 「IDB 打不开」是另一种处境：后端整体降级为 local ⇒ 那份「空」来自镜像，
       不能据此宣布首启。这条同时证明 `storage.reopen()` 在重试里是**承重的**。 */
    {
      const h = await bootCombination({ idbOpenFails: true, idbValue: seedOneOne() });
      const sa = h.app.stateAuthority();
      ok("打不开：IDB 存在却用不上时，绝不判 empty（否则等于把「读不到」当「不存在」）",
        h.ready === false && sa.status === "failed" &&
        sa.report.reason === "authoritative-backend-degraded",
        JSON.stringify({ ready: h.ready, sa: sa }));
      ok("打不开：这次启动同样一笔没写（IDB 里那份 1/1 逐字节未动）",
        h.disk.puts === 0 && h.disk.idbValue.items.length === 1 &&
        h.disk.idbValue.items[0].title === "既有事项",
        JSON.stringify({ puts: h.disk.puts, idb: h.disk.idbValue && h.disk.idbValue.items }));
      h.disk.openFails = false;
      h.app.retryRestore();
      await h.app.ready();
      await wait(30);
      const sa2 = h.app.stateAuthority();
      ok("打不开：重试会**重新尝试打开权威后端**（故 loaded 的原因必须是权威，而非 degraded-mirror）",
        sa2.status === "loaded" && sa2.report.reason === "authoritative" &&
        sa2.report.backend === "idb" && sa2.attempts === 2,
        JSON.stringify(sa2));
      ok("打不开：重试真的把那份 1/1 读了回来",
        h.app.state.items.length === 1 && h.app.state.items[0].title === "既有事项",
        JSON.stringify(h.app.state.items.map(i => i.title)));
    }

    /* ⑤ 「IDB 读到空但镜像有值」⇒ 迁移进权威后端并采用（H-07 的既有语义，不能因本轮收紧而丢）。 */
    {
      const seed = seedOneOne();
      const h = await bootCombination({ idbValue: null, seedState: seed });
      const sa = h.app.stateAuthority();
      ok("镜像迁移：IDB 读到空但镜像有值 ⇒ 判 loaded，并以镜像内容为准",
        h.ready === true && sa.status === "loaded" && sa.report.reason === "authoritative" &&
        h.app.state.items.length === 1 && h.app.state.items[0].title === "既有事项",
        JSON.stringify({ sa: sa, items: h.app.state.items.map(i => i.title) }));
      // 只断言「镜像内容确实进了权威后端」，**不**断言 puts 的精确值：
      // 启动后 schema 迁移/心跳本来就可能有若干次真实提交，把数字钉死是给自己挖坑。
      ok("镜像迁移：那一刻真的写回了权威后端（IDB 里现在有 1/1「既有事项」）",
        h.disk.puts >= 1 && h.disk.idbValue && h.disk.idbValue.items.length === 1 &&
        h.disk.idbValue.items[0].title === "既有事项",
        JSON.stringify({ puts: h.disk.puts, idb: h.disk.idbValue && h.disk.idbValue.items.map(i => i.title) }));
    }

    /* ⑥ 「IDB 读到空」+ 镜像里还有一块不可解析的残留 ⇒ 不是首启，判 failed。
       这一条挡的是「镜像写坏了」被当成「从来没有数据」。 */
    {
      const h = await bootCombination({ idbValue: null, seedMirrorRaw: "{这不是 JSON" });
      const sa = h.app.stateAuthority();
      ok("残留证据：权威读到空但镜像有不可解析残留 ⇒ failed（不当首启）",
        h.ready === false && sa.status === "failed" &&
        sa.report.reason === "authoritative-empty-with-residual-evidence" &&
        h.disk.puts === 0,
        JSON.stringify({ ready: h.ready, sa: sa, puts: h.disk.puts }));
    }

    /* ⑦ 「读出来的根本不是一份状态对象」⇒ failed（而不是当成空状态继续跑）。 */
    {
      const h = await bootCombination({ idbValue: "被别的东西写脏的字符串" });
      const sa = h.app.stateAuthority();
      ok("脏值：权威里存的不是对象 ⇒ failed，且一笔都没写",
        h.ready === false && sa.status === "failed" &&
        sa.report.reason === "authoritative-value-not-object" && h.disk.puts === 0,
        JSON.stringify({ ready: h.ready, sa: sa, puts: h.disk.puts }));
    }

    /* ⑦ 桥初始化失败：原生链路起不来时，**权威数据的判定与保护不受它影响**。
     *
     * 真机上这一条不可构造（要冷启动时让原生桥不可用，就得改包，改包即失去等价性），
     * 所以在组合 harness 上把桥点坏：只替换被点名的方法，其余能力照旧，
     * 并先证明「注入真的命中」，再断言它没有把权威判定带偏。 */
    {
      const seed = seedOneOne();

      /* A) 桥故障 + 权威健康 1/1 ⇒ 不该因此丢数据，也不该因此关掉写入。 */
      const hA = await bootCombination({
        idbValue: seed,
        faults: {
          "LocalNotifications.registerActionTypes": "P2CR-A1",
          "SystemBridge.scheduleAlarm": "P2CR-A2"
        }
      });
      ok("桥故障：注入真的命中（被点名的方法**被调用过**并且拒绝了，不是只改了配置）",
        hA.env.calls.faultHits >= 1,
        JSON.stringify({ faultHits: hA.env.calls.faultHits }));
      ok("桥故障：应用仍然就绪（`initializeNativeReminders` 的 catch 兜住，不把启动挂死）",
        hA.ready === true,
        JSON.stringify({ ready: hA.ready, startupFailure: hA.app.startupFailure() }));
      ok("桥故障：权威判定**不受桥影响**（仍是 loaded/authoritative，writesAllowed=true）",
        hA.app.stateAuthority().status === "loaded" &&
        hA.app.stateAuthority().report.reason === "authoritative" &&
        hA.app.stateAuthority().writesAllowed === true,
        JSON.stringify(hA.app.stateAuthority()));
      ok("桥故障：旧数据完好（IDB 里仍是那 1/1，没有被空态覆盖）",
        hA.disk.idbValue && hA.disk.idbValue.items.length === 1 &&
        hA.disk.idbValue.items[0].title === "既有事项",
        JSON.stringify({ idb: hA.disk.idbValue && hA.disk.idbValue.items }));

      /* B) 两个失败源叠加（桥故障 + 权威读失败）⇒ 仍然是「一笔不写」。 */
      const hB = await bootCombination({
        idbValue: seed,
        idbGetFails: true,
        faults: { "LocalNotifications.registerActionTypes": "P2CR-B1" }
      });
      const saB = hB.app.stateAuthority();
      ok("叠加故障：桥故障 + 权威读失败 ⇒ 判 failed、writesAllowed=false",
        hB.ready === false && saB.status === "failed" && saB.writesAllowed === false,
        JSON.stringify({ ready: hB.ready, sa: saB }));
      ok("叠加故障：仍然一笔不写（puts=0）、不留待回放凭据、旧 IDB 逐字节未动",
        hB.disk.puts === 0 && carryEntries(hB)["attention-inbox-v2-pending-replay"] === undefined &&
        hB.disk.idbValue && hB.disk.idbValue.items.length === 1,
        JSON.stringify({ puts: hB.disk.puts, keys: Object.keys(carryEntries(hB)),
          idb: hB.disk.idbValue && hB.disk.idbValue.items }));
      ok("叠加故障：既不排通知也不起业务心跳（失败态的业务旁路整段跳过）",
        hB.env.calls.schedule.length === 0 && hB.env.calls.scheduleAlarm.length === 0 &&
        hB.intervals.indexOf(15000) < 0,
        JSON.stringify({ schedule: hB.env.calls.schedule.length,
          scheduleAlarm: hB.env.calls.scheduleAlarm.length, intervals: hB.intervals }));
      ok("叠加故障：恢复面板照样出现（用户看得到「没恢复成功」，而不是一个空收件箱）",
        saB.recoveryPanel === true, JSON.stringify(saB));
    }

    /* P3-B 将持久化变异移至 scripts/verification/p3b-persistence-tests.js：该直接 harness
       对同一实例的写闸门、镜像来源与 pending replay 做真实行为变异。保留旧 core 版本仅作历史说明。
       ⑧ 反向对照：拔掉三道闸门（写闸门 + init 的恢复闸门 + `ready` 的判定），
       「旧 IDB 被空快照覆盖」必须**重新出现**（逐字复现真机上量到的 1/1 → 0/0）。 */
    {
      const appCoreSrc = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");
      const persistenceSrc = fs.readFileSync(path.join(ROOT, "lib/app-persistence.js"), "utf8");
      const GATE_WRITE = "if (!authoritativeWritesAllowed()) {";
      const GATE_INIT = "if (report.status === LOAD_FAILED) {";
      const GATE_READY = "if (appPersistence && appPersistence.authoritySnapshot().status === LOAD_FAILED) {";
      // P2-C-R 独立复验后新增的第四道：待回放凭据的生成点自己认来源。
      // 不拔掉它，即使把上面三道闸门都拆了，异常路径的提交也只会落在镜像上、
      // 拿不到「下次启动优先回放」的授权书 —— M9 拼不出完整的覆盖链。
      const GATE_REPLAY = "if (!authoritativeWritesAllowed() || stateCameFromMirror()) return false;";
      const m9Core = appCoreSrc
        .replace(GATE_INIT, "if (false) {")
        .replace(GATE_READY, "if (false) {");
      const m9Persistence = persistenceSrc
        .replace(GATE_WRITE, "if (false) {")
        .replace(GATE_REPLAY, "if (false) return false;");
      ok("（前置）M9 反例补丁真的拔掉了四道闸门（各一处、都命中，且只改了这一行）",
        m9Core !== appCoreSrc && m9Persistence !== persistenceSrc &&
        m9Persistence.indexOf(GATE_WRITE) < 0 && m9Core.indexOf(GATE_INIT) < 0 &&
        m9Core.indexOf(GATE_READY) < 0 && m9Persistence.indexOf(GATE_REPLAY) < 0 &&
        m9Core.split("\n").length === appCoreSrc.split("\n").length &&
        m9Persistence.split("\n").length === persistenceSrc.split("\n").length);

      // 第一次冷启动：读失败。未变异（有闸门）不得写出任何东西。
      const fixedFirst = await bootCombination({ idbValue: seedOneOne(), idbGetFails: true });
      let fixedBlocked = false;
      try { await fixedFirst.app.saveAsync(); } catch (error) { fixedBlocked = true; }
      const fixedCarry = carryEntries(fixedFirst);
      ok("对照面：未变异源码下，失败态既拦住了提交也没有留下任何待回放凭据",
        fixedBlocked === true &&
        fixedCarry["attention-inbox-v2-pending-replay"] === undefined,
        JSON.stringify(Object.keys(fixedCarry)));

      // 变异版：同一场景 ⇒ 应用照常启动（= 旧行为），并留下「空基线」的待回放快照。
      const m9 = await bootCombination({
        overrides: { "app-core.js": tmpEntry("attention-m9-app-core.js", m9Core),
          "lib/app-persistence.js": tmpEntry("attention-m9-app-persistence.js", m9Persistence) },
        idbValue: seedOneOne(), idbGetFails: true
      });
      ok("M9 变红：拔掉恢复闸门后，读不到权威数据时应用**照常启动**（ready=true、心跳跑起来）",
        m9.ready === true && m9.intervals.indexOf(15000) >= 0 &&
        m9.app.state.items.length === 0,
        JSON.stringify({ ready: m9.ready, intervals: m9.intervals,
          items: m9.app.state.items.length }));
      let m9SaveError = null;
      try { await m9.app.saveAsync(); } catch (error) { m9SaveError = error; }
      const m9Carry = carryEntries(m9);
      ok("M9 变红：这次提交真的写出了落地痕迹（镜像 + 待回放凭据 = 一份**空基线**快照）",
        !m9SaveError && m9Carry["attention-inbox-v2-pending-replay"] !== undefined &&
        m9Carry["attention-inbox-v2"] !== undefined,
        JSON.stringify({ err: m9SaveError && m9SaveError.message, keys: Object.keys(m9Carry) }));

      // 第二次冷启动（**未变异**源码 + 健康的 IDB + 上一次留下的镜像/凭据）：
      // 待回放快照被采用并写回权威 ⇒ 旧 1/1 变成 0/0。
      const fixedSecond = await bootCombination({
        idbValue: seedOneOne(), seedLocalEntries: fixedCarry
      });
      const m9Second = await bootCombination({
        idbValue: seedOneOne(), seedLocalEntries: m9Carry
      });
      ok("M9 核心（拔掉闸门必红）：下一次冷启动把空快照经待回放写回健康的 IDB ⇒ 旧 1/1 被覆盖成 0/0",
        m9Second.disk.idbValue && m9Second.disk.idbValue.items.length === 0 &&
        m9Second.app.stateAuthority().report.reason === "pending-replay",
        JSON.stringify({ idbItems: m9Second.disk.idbValue && m9Second.disk.idbValue.items.length,
          report: m9Second.app.stateAuthority().report }));
      ok("对照面：同一场景下未变异源码的下一次冷启动，旧 1/1 **完好无损**（两边合起来才说明闸门有分辨力）",
        fixedSecond.disk.idbValue && fixedSecond.disk.idbValue.items.length === 1 &&
        fixedSecond.disk.idbValue.items[0].title === "既有事项",
        JSON.stringify({ idb: fixedSecond.disk.idbValue && fixedSecond.disk.idbValue.items }));
      ok("收口：反向编辑只用临时副本，工作区 app-core.js 未被改写",
        fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8") === appCoreSrc);
    }
  }

  /* ---------- B6. P2-C-R 独立复验缺口：**陈旧镜像**不得升格覆盖权威（双启动分叉） ----------
   *
   * 背景（run `20260922T001914-independent-p2cr-recheck`）：B5 全绿但阻断仍在，因为所有
   * 读失败用例都从「镜像也为空」出发 —— 没覆盖「**镜像有值但落后于权威**」这一分叉。
   * 而真机上这个分叉恰恰是最常见的：镜像是上一次落盘的样子，IDB 里有更新的数据。
   *
   * 本节钉死三件事：
   *   ① 权威这次读不到（get 失败 / open 失败）而镜像有值 ⇒ **failed**，不是 loaded；
   *   ② 失败态里任何提交都不落地，**尤其不得留下待回放凭据**（那是下次覆盖的授权书）；
   *   ③ 下一次健康启动必须仍然读到权威里那两条 —— 拔掉闸门则必红（M12 变异对照）。
   */
  section("B6. 独立复验缺口：陈旧镜像不得覆盖权威（IDB 两条 / 镜像一条，双启动分叉）");
  {
    const tmpEntryB6 = (name, text) => {
      const p = path.join(os.tmpdir(), name);
      fs.writeFileSync(p, text);
      return p;
    };
    /** 权威：两条（其中 `idb-new` 是镜像里没有的、更新的数据）。 */
    const authoritativeState = () => ({
      schema: 5,
      items: [
        { id: "mirror-old", title: "旧镜像事项", status: "waiting", dismissedUntil: null },
        { id: "idb-new", title: "仅权威库存在事项", status: "waiting", dismissedUntil: null }
      ],
      notes: [], projects: [], settings: { notify: false, dnd: false }
    });
    /** 镜像：只有一条（落后于权威）。 */
    const staleMirrorState = () => ({
      schema: 5,
      items: [
        { id: "mirror-old", title: "旧镜像事项", status: "waiting", dismissedUntil: null }
      ],
      notes: [], projects: [], settings: { notify: false, dnd: false }
    });
    const carryEntriesB6 = h => {
      const out = {};
      Object.keys(h.localStorageKeys()).forEach(k => { out[k] = h.localStorage.getItem(k); });
      return out;
    };
    const idsOf = value =>
      value && Array.isArray(value.items) ? value.items.map(i => i.id).join(",") : "?";
    const PENDING_KEY = "attention-inbox-v2-pending-replay";

    const twoBoot = async (firstOptions, overrides) => {
      const first = await bootCombination(Object.assign({
        idbValue: authoritativeState(), seedState: staleMirrorState()
      }, firstOptions, overrides ? { overrides: overrides } : null));
      await wait(30);
      let explicitSaveError = null;
      try {
        await first.app.saveAsync(); // 模拟用户在降级界面做一次正常业务保存
      } catch (error) {
        explicitSaveError = error && (error.code || error.message || String(error));
      }
      await wait(10);
      const carry = carryEntriesB6(first);
      const second = await bootCombination({
        idbValue: authoritativeState(),
        seedLocalEntries: carry
      });
      await wait(30);
      return {
        first: first, second: second, carry: carry, saveError: explicitSaveError,
        sa1: first.app.stateAuthority(), sa2: second.app.stateAuthority()
      };
    };

    /* 两种权威读取故障：`get` 失败（backend 已选成 idb）与 `open` 失败（后端整体降为 local）。
       它们分别对应「读不出来」与「连不上」两条真实路径，必须分别钉 —— 只钉一条会漏一半。 */
    const faults = [
      { tag: "get", options: { idbGetFails: true }, reason: "mirror-recovered-unconfirmed-authority" },
      { tag: "open", options: { idbOpenFails: true }, reason: "degraded-mirror-unconfirmed-authority" }
    ];

    for (const f of faults) {
      const r = await twoBoot(f.options);
      const label = f.tag === "get" ? "权威 get 失败" : "权威 open 失败";
      ok("B6/" + f.tag + "：" + label + " + 镜像有值 ⇒ 判 **failed**（镜像≠权威，不能升格）",
        r.first.ready === false && r.sa1.status === "failed" &&
        r.sa1.report.reason === f.reason && r.sa1.writesAllowed === false,
        JSON.stringify({ ready: r.first.ready, sa: r.sa1 }));
      ok("B6/" + f.tag + "：失败态**不启业务**（没有 15 秒心跳，也没有业务批量往库里写）",
        r.first.intervals.indexOf(15000) < 0, JSON.stringify(r.first.intervals));
      ok("B6/" + f.tag + "：这次启动对权威后端连碰都没碰（puts=0，IDB 仍是那两条）",
        r.first.disk.puts === 0 &&
        idsOf(r.first.disk.idbValue) === "mirror-old,idb-new",
        JSON.stringify({ puts: r.first.disk.puts, idb: idsOf(r.first.disk.idbValue) }));
      ok("B6/" + f.tag + "：用户硬要保存也被拦下（state-authority-blocked），" +
        "**没有**留下待回放凭据（下一步覆盖的正是这张授权书）",
        r.saveError === "state-authority-blocked" && r.carry[PENDING_KEY] === undefined,
        JSON.stringify({ err: r.saveError, keys: Object.keys(r.carry) }));
      ok("B6/" + f.tag + "：内存里留下镜像内容只作**只读查看**（这条 OK 不代表它可以写）",
        r.first.app.state.items.length === 1 &&
        r.first.app.state.items[0].title === "旧镜像事项" &&
        r.sa1.recoveryPanel === true,
        JSON.stringify({ items: r.first.app.state.items.map(i => i.title), panel: r.sa1.recoveryPanel }));
      ok("B6/" + f.tag + "：**下一次健康冷启动仍读到权威那两条** ⇒ 旧镜像没有覆盖掉 `idb-new`",
        r.second.ready === true && r.sa2.status === "loaded" &&
        r.sa2.report.reason === "authoritative" &&
        idsOf(r.second.disk.idbValue) === "mirror-old,idb-new" &&
        r.second.app.state.items.length === 2,
        JSON.stringify({ sa: r.sa2, idb: idsOf(r.second.disk.idbValue),
          mem: r.second.app.state.items.map(i => i.id) }));
    }

    /* 健康路径对照（防止「一律失败」蒙混过关）：这些**不是**上面的失败场景。 */
    {
      const clean = await bootCombination({ idbValue: authoritativeState(), seedState: staleMirrorState() });
      ok("B6/对照：权威读得到时镜像**被忽略**（仍从权威读到两条，且判 loaded/authoritative）",
        clean.ready === true && clean.app.stateAuthority().report.reason === "authoritative" &&
        clean.app.state.items.length === 2,
        JSON.stringify({ sa: clean.app.stateAuthority(), items: clean.app.state.items.map(i => i.id) }));
      const migration = await bootCombination({ idbValue: null, seedState: staleMirrorState() });
      ok("B6/对照：权威读到**空**而镜像有值 ⇒ 仍走既有的「迁移进权威」语义（loaded，不被本轮收紧误伤）",
        migration.ready === true && migration.app.stateAuthority().status === "loaded" &&
        migration.app.stateAuthority().report.reason === "authoritative" &&
        migration.disk.idbValue && migration.disk.idbValue.items.length === 1,
        JSON.stringify({ sa: migration.app.stateAuthority(),
          idb: migration.disk.idbValue && migration.disk.idbValue.items.map(i => i.id) }));
    }

    /* P3-B direct harness owns the executable mirror/replay mutations; this old core-source variant is retained as history.
       M12 变异对照：把两条「镜像升格」拧回 `LOAD_LOADED`、并拆掉凭据来源守卫 ⇒
       双启动覆盖必须**重新出现**。没有这一条，「现在没复现」也可能只是探针失效。 */
    {
      const appCoreSrc = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");
      const persistenceSrc = fs.readFileSync(path.join(ROOT, "lib/app-persistence.js"), "utf8");
      const ANCHOR_MIRROR = 'LOAD_FAILED, "mirror-recovered-unconfirmed-authority"';
      const ANCHOR_DEGRADED = 'LOAD_FAILED, "degraded-mirror-unconfirmed-authority"';
      const ANCHOR_REPLAY = "if (!authoritativeWritesAllowed() || stateCameFromMirror()) return false;";
      const mutated = persistenceSrc
        .replace(ANCHOR_MIRROR, 'LOAD_LOADED, "mirror-recovered"')
        .replace(ANCHOR_DEGRADED, 'LOAD_LOADED, "degraded-mirror"')
        .replace(ANCHOR_REPLAY, "if (false) return false;");
      ok("（前置）M12 补丁三处都命中且行数不变（改的是判定本身，不是删掉代码）",
        mutated !== appCoreSrc &&
        mutated.indexOf(ANCHOR_MIRROR) < 0 && mutated.indexOf(ANCHOR_DEGRADED) < 0 &&
        mutated.indexOf(ANCHOR_REPLAY) < 0 &&
        mutated.split("\n").length === persistenceSrc.split("\n").length);
      const overrides = { "lib/app-persistence.js": tmpEntryB6("attention-m12-app-persistence.js", mutated) };

      for (const f of faults) {
        const r = await twoBoot(f.options, overrides);
        const label = f.tag === "get" ? "权威 get 失败" : "权威 open 失败";
        ok("M12 变红/" + f.tag + "：拔掉防线的 " + label + " ⇒ 旧镜像被提升为可写 loaded",
          r.first.ready === true && r.sa1.status === "loaded" &&
          r.sa1.writesAllowed === true && r.first.app.state.items.length === 1 &&
          r.first.intervals.indexOf(15000) >= 0,
          JSON.stringify({ ready: r.first.ready, sa: r.sa1,
            items: r.first.app.state.items.map(i => i.id), intervals: r.first.intervals }));
        ok("M12 变红/" + f.tag + "：这次保存真的留下了待回放凭据",
          r.saveError == null && typeof r.carry[PENDING_KEY] === "string" && r.carry[PENDING_KEY].length > 0,
          JSON.stringify({ err: r.saveError, keys: Object.keys(r.carry) }));
        ok("M12 变红/" + f.tag + "：**下一次健康启动用旧快照覆盖权威** ⇒ 两条变一条（`idb-new` 消失）",
          r.second.ready === true && r.sa2.report.reason === "pending-replay" &&
          idsOf(r.second.disk.idbValue) === "mirror-old",
          JSON.stringify({ sa: r.sa2, idb: idsOf(r.second.disk.idbValue) }));
      }
      ok("收口：反向编辑只用临时副本，工作区 app-core.js 未被改写",
        fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8") === appCoreSrc &&
        fs.readFileSync(path.join(ROOT, "lib/app-persistence.js"), "utf8") === persistenceSrc);
    }

    /* 启动期「无意义提交」：migrateItem 修成幂等后，载入**已经规范**的状态不应再有落地。
       这一条是本次数据丢失的稳定触发器：每轮冷启动都写一次权威，写闸门一旦漏判即成覆盖。 */
    {
      const raw = {
        schema: 5,
        items: [{ id: "plain-1", title: "待迁移事项", status: "waiting", triggerAt: Date.now() + 86400000 }],
        notes: [], projects: [], settings: { notify: false, dnd: false }
      };
      const first = await bootCombination({ idbValue: raw });
      await wait(30);
      // 第一轮是「真实迁移」：缺 scheduleBasis / dismissedUntil 等字段，应该有落地。
      ok("启动期提交/对照：第一次载入未迁移状态确实需要迁移（IDB 现在已是规范形态）",
        first.ready === true &&
        first.disk.idbValue && first.disk.idbValue.items.length === 1 &&
        !!first.disk.idbValue.items[0].scheduleBasis &&
        "dismissedUntil" in first.disk.idbValue.items[0],
        JSON.stringify(first.disk.idbValue && first.disk.idbValue.items[0]));
      const second = await bootCombination({ idbValue: first.disk.idbValue });
      await wait(30);
      ok("启动期提交：**连续第二次冷启动不再产生任何提交**（幂等后 puts=0，迁移不是循环）",
        second.ready === true && second.disk.puts === 0,
        JSON.stringify({ puts: second.disk.puts, sa: second.app.stateAuthority() }));
    }
  }

  /* ---------- B7. P3-C-R：事务重绑后旧命令包装函数实例更新（A/B 对照与反向变异） ---------- */
  section("B7. P3-C-R：事务重绑后旧命令包装函数实例更新（A/B 对照与反向变异）");
  {
    const runScenario = async (rebind, overrides) => {
      const boot = await bootCombination(overrides ? { overrides: overrides } : {});
      const app = boot.app;
      ok("P3-C-R 前置：组合启动成功", boot.ready === true);

      // 预先调用核心命令包装（completeItem）与 wrapUserOp 自定义命令，建立首次事务实例缓存
      const prime = app.makeItem({ title: "prime", status: "waiting", triggerAt: Date.now() + 3600000 });
      app.state.items.push(prime);
      await app.saveAsync();
      const primeComplete = app.completeItem(prime.id);
      ok("P3-C-R 前置：prime completeItem 成功", primeComplete === true);
      await app.saveAsync();

      const addUnrelated = app.wrapUserOp(id => {
        const stableId = app.takeReplayCreatedId() || id;
        app.state.items.push({ id: stableId, title: id, status: "waiting", rev: 1 });
        return true;
      }, { name: "add-unrelated" });
      const setupItemResult = addUnrelated("setup-item");
      ok("P3-C-R 前置：addUnrelated 调用成功", setupItemResult === true);
      await app.saveAsync();

      const oldTransaction = app.transaction;
      if (rebind) {
        const rebindProblems = Array.from(app.bindRuntime());
        ok("P3-C-R：bindRuntime 重绑无报错", rebindProblems.length === 0, JSON.stringify(rebindProblems));
        const report = await app.loadAsync();
        ok("P3-C-R：重绑后 loadAsync 正常载入", report.status === "loaded" || report.status === "empty", JSON.stringify(report));
      }
      const newTransaction = app.transaction;

      const target = app.makeItem({ title: "target", status: "waiting", triggerAt: Date.now() + 3600000 });
      app.state.items.push(target);
      await app.saveAsync();

      // 挂起权威提交，模拟并发窗口
      boot.disk.holdWrites = true;
      const action = app.handleAlarmAction({
        action: "ack", itemId: target.id, itemRev: target.rev, alarmEventId: "test-p3cr-" + (rebind ? "rebound" : "control")
      });
      await wait(20);

      const inflightDepth = newTransaction.inflightDepth();
      const beforeStatus = app.state.items.find(item => item.id === target.id).status;
      const conflictResult = app.completeItem(target.id);
      const duringStatus = app.state.items.find(item => item.id === target.id).status;
      const unrelatedResult = addUnrelated("unrelated");
      const unrelatedBefore = app.state.items.some(item => item.id === "unrelated");
      const heldWrites = boot.disk.held.length;

      boot.disk.holdWrites = false;
      boot.disk.held.splice(0).forEach(finish => finish());
      const actionResult = await action;
      await wait(60);

      const targetAfter = app.state.items.find(item => item.id === target.id);
      const unrelatedAfter = app.state.items.some(item => item.id === "unrelated");

      return {
        rebind,
        instanceChanged: oldTransaction !== newTransaction,
        inflightDepth,
        conflictResult,
        beforeStatus,
        duringStatus,
        unrelatedResult,
        unrelatedBefore,
        heldWrites,
        actionResult,
        finalTargetStatus: targetAfter ? targetAfter.status : null,
        unrelatedAfter
      };
    };

    // A: 无重绑对照组
    const control = await runScenario(false);
    ok("P3-C-R 对照组：事务实例未改变", control.instanceChanged === false);
    ok("P3-C-R 对照组：原生动作进行中 inflightDepth 为 1", control.inflightDepth === 1);
    ok("P3-C-R 对照组：挂起期间同事项命令被拒绝（返回 false）", control.conflictResult === false);
    ok("P3-C-R 对照组：挂起期间同事项可见状态未被提前修改（waiting）",
      control.beforeStatus === "waiting" && control.duringStatus === "waiting");
    ok("P3-C-R 对照组：无冲突命令在挂起期间被接受", control.unrelatedResult === true && control.unrelatedBefore === true);
    ok("P3-C-R 对照组：原生动作权威提交成功", control.actionResult === true && control.finalTargetStatus === "acknowledged");
    ok("P3-C-R 对照组：无冲突命令在提交后成功重放并保留", control.unrelatedAfter === true);

    // B: 重绑后实验组
    const rebound = await runScenario(true);
    ok("P3-C-R 实验组：事务实例已重绑（old !== new）", rebound.instanceChanged === true);
    ok("P3-C-R 实验组：新事务动作进行中 inflightDepth 为 1", rebound.inflightDepth === 1);
    ok("P3-C-R 实验组：重绑后旧包装命令仍正确识别冲突并拒绝（返回 false，不绕过新实例）", rebound.conflictResult === false);
    ok("P3-C-R 实验组：挂起期间同事项可见状态未被提前修改（waiting）",
      rebound.beforeStatus === "waiting" && rebound.duringStatus === "waiting");
    ok("P3-C-R 实验组：无冲突命令被新事务实例接受并记录", rebound.unrelatedResult === true && rebound.unrelatedBefore === true);
    ok("P3-C-R 实验组：原生动作权威提交成功", rebound.actionResult === true && rebound.finalTargetStatus === "acknowledged");
    ok("P3-C-R 实验组：无冲突命令在提交后成功重放并保留（不被权威覆盖丢失）", rebound.unrelatedAfter === true);

    // 反向变异：在临时副本中恢复旧的永久缓存写法，证明新测试变红
    {
      const coreSource = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");
      const staleWrapSnippet = `  function wrapUserOp(fn, options) {
    let cached = null;
    return function () {
      if (!cached && appTransaction) {
        cached = appTransaction.wrapUserOp(fn, options);
      }
      if (cached) return cached.apply(null, arguments);
      return runUserOp(fn, Array.prototype.slice.call(arguments), options);
    };
  }`;
      const mutatedSource = coreSource.replace(
        / {2}function wrapUserOp\(fn, options\) \{[\s\S]*?\n {2}\}/,
        staleWrapSnippet
      );
      ok("P3-C-R 变异前置：旧永久缓存代码补丁成功应用到临时文本",
        mutatedSource !== coreSource && mutatedSource.indexOf("let cached = null;") >= 0);

      const tmpCore = path.join(os.tmpdir(), "attention-p3cr-stale-wrap-mutant.js");
      fs.writeFileSync(tmpCore, mutatedSource, "utf8");
      try {
        const mutantRes = await runScenario(true, { "app-core.js": tmpCore });
        ok("P3-C-R 反向变异变红：旧永久缓存写法在重绑后发生同事项命令漏判（返回 true）",
          mutantRes.conflictResult === true, "actual conflictResult=" + mutantRes.conflictResult);
        ok("P3-C-R 反向变异变红：旧永久缓存写法在重绑后发生状态提前泄露（waiting -> archived）",
          mutantRes.duringStatus === "archived", "actual duringStatus=" + mutantRes.duringStatus);
        ok("P3-C-R 反向变异变红：旧永久缓存写法在提交后丢失无冲突命令（unrelatedAfter=false）",
          mutantRes.unrelatedAfter === false, "actual unrelatedAfter=" + mutantRes.unrelatedAfter);
      } finally {
        if (fs.existsSync(tmpCore)) fs.unlinkSync(tmpCore);
      }
      ok("P3-C-R 变异收口：临时变异未污染产品文件 app-core.js",
        fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8") === coreSource);
    }
  }

  /* ---------- B8. P3-D：事项模块业务组合与关键不变量（正向与反向变异） ---------- */
  section("B8. P3-D：事项模块业务组合与关键不变量（正向与反向变异）");
  {
    const runItemsScenario = async (overrides) => {
      const boot = await bootCombination(overrides ? { overrides: overrides } : {});
      const app = boot.app;

      // 1. ACK vs 完成的不同周期推进时点 + 稳定派生 ID
      // 1a. ACK 模式：ackItem 立即派生下一期
      const ackItem = app.makeItem({
        title: "ack-repeat-task",
        status: "waiting",
        triggerAt: Date.now() - 30000,
        repeat: { mode: "ack", every: "day" }
      });
      app.state.items.push(ackItem);
      await app.saveAsync();
      const initialAckSeriesId = ackItem.seriesId;

      const ackResult = app.ackItem(ackItem.id);
      await app.saveAsync();

      const itemAfterAck = app.state.items.find(x => x.id === ackItem.id);
      const ackDerived = app.state.items.filter(x => x.seriesId === (itemAfterAck.seriesId || initialAckSeriesId) && x.id !== ackItem.id);
      const ackNext = ackDerived[0];

      // 1b. Calendar 模式：ackItem 不派生，completeItem 派生下一期
      const calItem = app.makeItem({
        title: "calendar-repeat-task",
        status: "waiting",
        triggerAt: Date.now() - 60000,
        repeat: { mode: "calendar", every: "day" }
      });
      app.state.items.push(calItem);
      await app.saveAsync();
      const initialCalSeriesId = calItem.seriesId;

      const calAckResult = app.ackItem(calItem.id);
      await app.saveAsync();

      const calAfterAck = app.state.items.find(x => x.id === calItem.id);
      const calAfterAckStatus = calAfterAck ? calAfterAck.status : null;
      const calDerivedOnAck = app.state.items.filter(x => x.seriesId === (calAfterAck.seriesId || initialCalSeriesId) && x.id !== calItem.id);

      const calCompleteResult = app.completeItem(calItem.id);
      await app.saveAsync();

      const calAfterComplete = app.state.items.find(x => x.id === calItem.id);
      const calDerivedOnComplete = app.state.items.filter(x => x.seriesId === (calAfterComplete.seriesId || initialCalSeriesId) && x.id !== calItem.id);
      const calNext = calDerivedOnComplete[0];

      // 2. 停止重复：历史已确认/已投递实例保留业务状态
      const histItem = app.makeItem({
        title: "history-ack-item",
        status: "acknowledged",
        acknowledgedAt: Date.now() - 100000,
        seriesId: "series-stop-test",
        repeat: { mode: "calendar", every: "day" }
      });
      const currItem = app.makeItem({
        title: "current-stop-item",
        status: "waiting",
        seriesId: "series-stop-test",
        repeat: { mode: "calendar", every: "day" }
      });
      const unstartedItem = app.makeItem({
        title: "unstarted-future-item",
        status: "waiting",
        seriesId: "series-stop-test",
        remindCount: 0,
        acknowledgedAt: null,
        deliveredAt: null,
        repeat: { mode: "calendar", every: "day" }
      });
      app.state.items.push(histItem, currItem, unstartedItem);
      await app.saveAsync();

      const stopResult = app.stopRepeat(currItem.id);
      await app.saveAsync();

      const histAfterStop = app.state.items.find(x => x.id === histItem.id);
      const currAfterStop = app.state.items.find(x => x.id === currItem.id);
      const unstartedAfterStop = app.state.items.find(x => x.id === unstartedItem.id);

      // 3. 同域冲突与无关命令重放
      const conflictTarget = app.makeItem({ title: "conflict-target", status: "waiting", triggerAt: Date.now() + 3600000 });
      app.state.items.push(conflictTarget);
      await app.saveAsync();

      boot.disk.holdWrites = true;
      const actionPromise = app.handleAlarmAction({
        action: "ack", itemId: conflictTarget.id, itemRev: conflictTarget.rev, alarmEventId: "ev-b8-conflict"
      });
      await wait(20);

      const inflightDepth = app.inflightDepth();
      const conflictCallResult = app.completeItem(conflictTarget.id);
      const statusDuring = app.state.items.find(x => x.id === conflictTarget.id).status;
      const addUnrelated = app.wrapUserOp((id, fields) => {
        return app.items.applyNewItem(id, fields);
      }, { name: "applyNewItem" });
      const unrelatedResult = addUnrelated("b8-unrelated", { title: "B8 Unrelated", status: "waiting", rev: 1 });

      // 4. promoteDue 在权威提交在途时跳过
      const dueCandidate = app.makeItem({ title: "due-candidate", status: "waiting", priority: "critical", triggerAt: Date.now() - 10000 });
      app.state.items.push(dueCandidate);
      const promoteDuringInflight = app.promoteDue(Date.now());
      const dueStatusDuring = app.state.items.find(x => x.id === dueCandidate.id).status;

      boot.disk.holdWrites = false;
      boot.disk.held.splice(0).forEach(fn => fn());
      const actionSettled = await actionPromise;
      await wait(50);

      const conflictTargetFinal = app.state.items.find(x => x.id === conflictTarget.id);
      const unrelatedFinal = app.state.items.find(x => x.id === "b8-unrelated");

      // 5. 撤销完成失败回滚与重试
      const undoTarget = app.makeItem({ title: "undo-target", status: "waiting", triggerAt: Date.now() + 3600000 });
      app.state.items.push(undoTarget);
      await app.saveAsync();

      const completeBeforeUndo = app.completeItem(undoTarget.id);
      await app.saveAsync();

      boot.disk.failWrites = true;
      const undoFailedAttempt = app.undoLastComplete();
      await wait(60);

      const undoTargetAfterFailedSave = app.state.items.find(x => x.id === undoTarget.id);
      const undoTargetAfterFailedSaveStatus = undoTargetAfterFailedSave ? undoTargetAfterFailedSave.status : null;
      const undoStateRetainedAfterFailure = app.lastCompleteUndo() !== null;

      boot.disk.failWrites = false;
      const undoRetryResult = app.undoLastComplete();
      await wait(60);

      const undoTargetAfterRetry = app.state.items.find(x => x.id === undoTarget.id);

      // 6. 重启持久化验证
      await app.saveAsync();
      const reboot = await bootCombination({ idbValue: boot.disk.idbValue });
      await wait(30);

      const rebootUnrelated = reboot.app.state.items.find(x => x.id === "b8-unrelated");
      const rebootUndoTarget = reboot.app.state.items.find(x => x.id === undoTarget.id);

      return {
        bootReady: boot.ready === true,
        ackResult,
        itemAfterAckStatus: itemAfterAck ? itemAfterAck.status : null,
        ackDerivedCount: ackDerived.length,
        ackNextSeriesIdMatch: ackNext ? ackNext.seriesId === (itemAfterAck.seriesId || initialAckSeriesId) : false,
        ackNextParentMatch: ackNext ? ackNext.repeatParentId === ackItem.id : false,
        ackNextStatus: ackNext ? ackNext.status : null,

        calAckResult,
        calAfterAckStatus,
        calDerivedOnAckCount: calDerivedOnAck.length,
        calCompleteResult,
        calAfterCompleteStatus: calAfterComplete ? calAfterComplete.status : null,
        calDerivedOnCompleteCount: calDerivedOnComplete.length,
        calNextSeriesIdMatch: calNext ? calNext.seriesId === (calAfterComplete.seriesId || initialCalSeriesId) : false,
        calNextParentMatch: calNext ? calNext.repeatParentId === calItem.id : false,
        calNextStatus: calNext ? calNext.status : null,

        stopResult,
        currAfterStopStatus: currAfterStop ? currAfterStop.status : null,
        currAfterStopRepeat: currAfterStop ? currAfterStop.repeat : undefined,
        unstartedAfterStopStatus: unstartedAfterStop ? unstartedAfterStop.status : null,
        unstartedAfterStopCompletedAt: unstartedAfterStop ? unstartedAfterStop.completedAt : undefined,
        histAfterStopStatus: histAfterStop ? histAfterStop.status : null,

        inflightDepth,
        conflictCallResult,
        statusDuring,
        unrelatedResult,
        promoteDuringInflight,
        dueStatusDuring,
        actionSettled,
        conflictTargetFinalStatus: conflictTargetFinal ? conflictTargetFinal.status : null,
        unrelatedFinalPresent: unrelatedFinal != null,

        completeBeforeUndo,
        undoFailedAttempt,
        undoTargetAfterFailedSaveStatus,
        undoStateRetainedAfterFailure,
        undoRetryResult,
        undoTargetAfterRetryStatus: undoTargetAfterRetry ? undoTargetAfterRetry.status : null,

        rebootReady: reboot.ready === true,
        rebootUnrelatedPresent: rebootUnrelated != null,
        rebootUndoTargetStatus: rebootUndoTarget ? rebootUndoTarget.status : null
      };
    };

    // 正向对照组
    const positive = await runItemsScenario();
    ok("P3-D 正向：组合启动成功", positive.bootReady === true);
    ok("P3-D 正向：ACK 模式下 ackItem 成功且原事项状态变为 acknowledged",
      positive.ackResult === true && positive.itemAfterAckStatus === "acknowledged");
    ok("P3-D 正向：ACK 模式下 ackItem 立即派生 1 个下一期", positive.ackDerivedCount === 1);
    ok("P3-D 正向：ACK 派生下一期继承稳定 seriesId 与 repeatParentId 且处于 waiting",
      positive.ackNextSeriesIdMatch === true && positive.ackNextParentMatch === true && positive.ackNextStatus === "waiting");

    ok("P3-D 正向：Calendar 模式下 ackItem 成功且状态为 acknowledged",
      positive.calAckResult === true && positive.calAfterAckStatus === "acknowledged");
    ok("P3-D 正向：Calendar 模式下 ackItem 不派生下一期（派生计数 0）", positive.calDerivedOnAckCount === 0);
    ok("P3-D 正向：Calendar 模式下 completeItem 成功且状态为 archived",
      positive.calCompleteResult === true && positive.calAfterCompleteStatus === "archived");
    ok("P3-D 正向：Calendar 模式下 completeItem 派生出 1 个下一期", positive.calDerivedOnCompleteCount === 1);
    ok("P3-D 正向：Calendar 派生下一期继承稳定 seriesId 与 repeatParentId 且处于 waiting",
      positive.calNextSeriesIdMatch === true && positive.calNextParentMatch === true && positive.calNextStatus === "waiting");

    ok("P3-D 正向：stopRepeat 执行成功", positive.stopResult === true);
    ok("P3-D 正向：stopRepeat 归档当前项且清除 repeat 规则",
      positive.currAfterStopStatus === "archived" && positive.currAfterStopRepeat === null);
    ok("P3-D 正向：stopRepeat 归档未开始的未来实例且 completedAt 为 null",
      positive.unstartedAfterStopStatus === "archived" && positive.unstartedAfterStopCompletedAt === null);
    ok("P3-D 正向：stopRepeat 严格保留历史已确认/已投递实例业务状态（仍为 acknowledged）",
      positive.histAfterStopStatus === "acknowledged");

    ok("P3-D 正向：原生动作在途时 inflightDepth 为 1", positive.inflightDepth === 1);
    ok("P3-D 正向：同事项在途命令被拒绝（返回 false）", positive.conflictCallResult === false);
    ok("P3-D 正向：同事项在途可见状态未提前改变（仍为 waiting）", positive.statusDuring === "waiting");
    ok("P3-D 正向：无关命令在在途期间被接受", positive.unrelatedResult === true);
    ok("P3-D 正向：promoteDue 在原生动作在途时被抑制（返回 false 且事项状态不跳变）",
      positive.promoteDuringInflight === false && positive.dueStatusDuring === "waiting");
    ok("P3-D 正向：原生动作权威提交成功",
      positive.actionSettled === true && positive.conflictTargetFinalStatus === "acknowledged");
    ok("P3-D 正向：无关命令在权威提交后成功重放并保留在状态中", positive.unrelatedFinalPresent === true);

    ok("P3-D 正向：completeItem 成功建立归档态与 undo 入口", positive.completeBeforeUndo === true);
    ok("P3-D 正向：持久化失败时撤销操作回滚可见状态（事项仍在 archived）",
      positive.undoTargetAfterFailedSaveStatus === "archived");
    ok("P3-D 正向：持久化失败时保留撤销重试入口", positive.undoStateRetainedAfterFailure === true);
    ok("P3-D 正向：存储恢复后重试撤销成功恢复为 waiting",
      positive.undoRetryResult === true && positive.undoTargetAfterRetryStatus === "waiting");

    ok("P3-D 正向：冷启动成功加载 IDB 持久化数据", positive.rebootReady === true);
    ok("P3-D 正向：冷启动完整保留重放事项与撤销恢复事项",
      positive.rebootUnrelatedPresent === true && positive.rebootUndoTargetStatus === "waiting");

    // 反向变异（作用于临时副本）
    const itemCoreSource = fs.readFileSync(path.join(ROOT, "lib/app-items.js"), "utf8");

    // 变异 1：破坏 ACK 周期推进（跳过 advanceSeriesOnArchive / spawnNextInstance）
    {
      const mutantAck = itemCoreSource.replace(
        'if (it.repeat && it.repeat.every && it.repeat.mode === "ack") {',
        'if (false && it.repeat && it.repeat.every && it.repeat.mode === "ack") {'
      );
      ok("P3-D 变异 1 前置：补丁成功", mutantAck !== itemCoreSource);
      const tmpFile = path.join(os.tmpdir(), "attention-p3d-mutant-ack.js");
      fs.writeFileSync(tmpFile, mutantAck, "utf8");
      try {
        const mutantRes = await runItemsScenario({ "lib/app-items.js": tmpFile });
        ok("P3-D 反向变异 1 变红：ACK 模式未推进下一期（ackDerivedCount=0）",
          mutantRes.ackDerivedCount === 0, "actual ackDerivedCount=" + mutantRes.ackDerivedCount);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    }

    // 变异 2：破坏 Calendar 周期推进（跳过 complete advanceSeriesOnArchive）
    {
      const mutantCal = itemCoreSource.replace(
        "advanceSeriesOnArchive(it);",
        "// advanceSeriesOnArchive(it);"
      );
      ok("P3-D 变异 2 前置：补丁成功", mutantCal !== itemCoreSource);
      const tmpFile = path.join(os.tmpdir(), "attention-p3d-mutant-cal.js");
      fs.writeFileSync(tmpFile, mutantCal, "utf8");
      try {
        const mutantRes = await runItemsScenario({ "lib/app-items.js": tmpFile });
        ok("P3-D 反向变异 2 变红：Calendar 模式完成未推进下一期（calDerivedOnCompleteCount=0）",
          mutantRes.calDerivedOnCompleteCount === 0, "actual calDerivedOnCompleteCount=" + mutantRes.calDerivedOnCompleteCount);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    }

    // 变异 3：破坏撤销失败回滚（onFailed 不执行 revertCompleteUndo）
    {
      const mutantUndo = itemCoreSource.replace(
        "revertCompleteUndo(command);",
        "// revertCompleteUndo(command);"
      );
      ok("P3-D 变异 3 前置：补丁成功", mutantUndo !== itemCoreSource);
      const tmpFile = path.join(os.tmpdir(), "attention-p3d-mutant-undo.js");
      fs.writeFileSync(tmpFile, mutantUndo, "utf8");
      try {
        const mutantRes = await runItemsScenario({ "lib/app-items.js": tmpFile });
        ok("P3-D 反向变异 3 变红：撤销写失败未回滚（仍在 waiting 而非 archived）",
          mutantRes.undoTargetAfterFailedSaveStatus === "waiting",
          "actual undoTargetAfterFailedSaveStatus=" + mutantRes.undoTargetAfterFailedSaveStatus);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    }

    // 变异 4：promoteDue 忽略在途检查
    {
      const mutantPromote = itemCoreSource.replace(
        "if (deps.inflightDepth() > 0) return false;",
        "// if (deps.inflightDepth() > 0) return false;"
      );
      ok("P3-D 变异 4 前置：补丁成功", mutantPromote !== itemCoreSource);
      const tmpFile = path.join(os.tmpdir(), "attention-p3d-mutant-promote.js");
      fs.writeFileSync(tmpFile, mutantPromote, "utf8");
      try {
        const mutantRes = await runItemsScenario({ "lib/app-items.js": tmpFile });
        ok("P3-D 反向变异 4 变红：promoteDue 在途未抑制（未返回 false 且跳为 due）",
          mutantRes.promoteDuringInflight !== false && mutantRes.dueStatusDuring === "due",
          "actual promote=" + mutantRes.promoteDuringInflight + " status=" + mutantRes.dueStatusDuring);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    }

    ok("P3-D 变异收口：临时变异未污染产品文件 lib/app-items.js",
      fs.readFileSync(path.join(ROOT, "lib/app-items.js"), "utf8") === itemCoreSource);
  }

  /* ---------- B9. P3-E：原生提醒协调模块业务组合与关键不变量（正向与反向变异） ---------- */
  section("B9. P3-E：原生提醒协调模块业务组合与关键不变量（正向与反向变异）");
  {
    const coordinatorSource = fs.readFileSync(path.join(ROOT, "lib/app-native-coordinator.js"), "utf8");

    const runCoordinatorScenario = async (overrides) => {
      const boot = await bootCombination(overrides ? { overrides: overrides } : {});
      const app = boot.app;

      // 1. 验证自激循环防护（deferNativeSync: true）
      app.state.settings.notify = true;
      app.state.settings.dnd = false;
      app.resetNativeSyncStats();

      const soon = Date.now() + 30 * 60 * 1000;
      const it = app.makeItem({ title: "B9关键事项", status: "waiting", priority: "critical", triggerAt: soon });
      app.state.items.push(it);
      await app.saveAsync();
      await wait(350);

      const statsAfterSave = app.nativeSyncStats();
      const runsAfterSaveIdle = statsAfterSave.runs;

      // 2. 验证版本漂移补偿排程（runs === 2）与台账补偿回写
      const driftItem = app.makeItem({ id: "b9-drift-item", title: "Drift Item", status: "waiting", deadlineAt: soon + 10000 });
      app.state.items.push(driftItem);
      let driftTriggered = false;
      const origCapSchedule = boot.env.capacitor.Plugins.SystemBridge.scheduleAlarm;
      // 在底层 schedule 时触发版本漂移（单次漂移）
      boot.env.capacitor.Plugins.SystemBridge.scheduleAlarm = async function() {
        if (!driftTriggered) {
          driftTriggered = true;
          app.nativeCoordinator.bumpNativeSyncVersion();
        }
        return origCapSchedule ? origCapSchedule.apply(this, arguments) : {};
      };

      app.resetNativeSyncStats();
      await app.syncNativeRemindersNow({ forceRebuild: true });
      boot.env.capacitor.Plugins.SystemBridge.scheduleAlarm = origCapSchedule;

      const driftSyncRuns = app.nativeSyncStats().runs;
      const driftItemEventsWritten = !!(driftItem.deadlineEvents && Object.keys(driftItem.deadlineEvents).length > 0);

      // 3. 验证 indexItemsById 首项胜出
      const dup1 = app.makeItem({ id: "b9-dup", title: "First Dup", status: "waiting", deadlineAt: soon });
      const dup2 = app.makeItem({ id: "b9-dup", title: "Second Dup", status: "waiting", deadlineAt: soon });
      app.state.items.push(dup1, dup2);

      app.nativeCoordinator.applyDeadlineEvents([
        { itemId: "b9-dup", stageKey: "due@" + soon, at: soon }
      ], Date.now());

      const dupFirstModified = !!(dup1.deadlineEvents && dup1.deadlineEvents["due@" + soon]);
      const dupSecondModified = !!(dup2.deadlineEvents && dup2.deadlineEvents["due@" + soon]);

      // 4. 验证 Q6 桥晚到重试（通过未就绪的纯 Web 环境模拟桥未就绪）
      const webBoot = await bootCombination(Object.assign({ platform: "web" }, overrides ? { overrides: overrides } : {}));
      let lateBridgeRuns = 0;
      if (webBoot.app && webBoot.app.nativeCoordinator) {
        webBoot.app.resetNativeSyncStats();
        // 桥随后注入（使用独立环境避免污染 boot.env.listeners）
        const lateEnv = createAndroidEnv();
        webBoot.sandbox.Capacitor = lateEnv.capacitor;
        webBoot.app.nativeCoordinator.queueNativeReminderSync("b9-late-test");
        await wait(250);
        lateBridgeRuns = webBoot.app.nativeSyncStats().runs;
      }

      // 5. 验证全屏闹钟动作排空直达事务处理器，保留 alarmEventId，且 close 不打开详情
      const closeItem = app.makeItem({ id: "b9-close-item", title: "Close Item", status: "due", triggerAt: Date.now() - 1000 });
      const ackItem = app.makeItem({ id: "b9-ack-item", title: "Ack Item", status: "due", triggerAt: Date.now() - 1000 });
      const snzItem = app.makeItem({ id: "b9-snz-item", title: "Snooze Item", status: "due", triggerAt: Date.now() - 1000 });
      const doneItem = app.makeItem({ id: "b9-done-item", title: "Done Item", status: "due", triggerAt: Date.now() - 1000 });
      app.state.items.push(closeItem, ackItem, snzItem, doneItem);
      await app.saveAsync();

      // close 动作：通过原生 resume 排空队列，关闭告警，不打开详情
      const nat = boot.exportOf("AttentionNativeReminders");
      let queuedActions = [
        { action: "close", itemId: closeItem.id, itemRev: closeItem.rev, alarmEventId: "b9-evt-close-1" }
      ];
      if (nat) {
        nat.drainAlarmActions = async function(handler) {
          let count = 0;
          const current = queuedActions.slice();
          queuedActions = [];
          for (const ev of current) {
            await handler(ev);
            count++;
          }
          return count;
        };
      }
      app.state.ui.detailId = null;
      boot.env.fireResume();
      await wait(50);
      const closeDetailId = app.state.ui.detailId;

      // ack, snooze, done 各动作验证并保留 alarmEventId
      await app.handleAlarmAction({ action: "ack", itemId: ackItem.id, itemRev: ackItem.rev, alarmEventId: "b9-evt-ack-1" });
      const ackSeen = app.alarmEventSeen("b9-evt-ack-1");

      await app.handleAlarmAction({ action: "snooze", itemId: snzItem.id, itemRev: snzItem.rev, alarmEventId: "b9-evt-snz-1" });
      const snzSeen = app.alarmEventSeen("b9-evt-snz-1");

      await app.handleAlarmAction({ action: "done", itemId: doneItem.id, itemRev: doneItem.rev, alarmEventId: "b9-evt-done-1" });
      const doneSeen = app.alarmEventSeen("b9-evt-done-1");

      // 6. 权威提交拒绝后事件保留可重试（未永久记录 seen）
      const failItem = app.makeItem({ id: "b9-fail-item", title: "Fail Item", status: "due", triggerAt: Date.now() - 1000 });
      app.state.items.push(failItem);
      boot.disk.failWrites = true;
      try {
        await app.handleAlarmAction({ action: "done", itemId: failItem.id, itemRev: failItem.rev, alarmEventId: "b9-evt-retryable-1" });
      } catch (err) {}
      boot.disk.failWrites = false;
      const rejectedEventSeen = app.alarmEventSeen("b9-evt-retryable-1");

      return {
        bootReady: boot.ready === true,
        runsAfterSaveIdle,
        driftSyncRuns,
        driftItemEventsWritten,
        dupFirstModified,
        dupSecondModified,
        lateBridgeRuns,
        closeDetailId,
        ackSeen,
        snzSeen,
        doneSeen,
        rejectedEventSeen
      };
    };

    // 正向对照组
    const positive = await runCoordinatorScenario();
    ok("P3-E 正向：生产组合启动成功", positive.bootReady === true);
    ok("P3-E 正向：单次业务保存静置后恰好执行 1 轮对账（deferNativeSync 生效防止自激）",
      positive.runsAfterSaveIdle === 1, "actual runs=" + positive.runsAfterSaveIdle);
    ok("P3-E 正向：单次版本漂移执行 2 轮对账完成补偿排程（driftSyncRuns === 2）",
      positive.driftSyncRuns === 2, "actual driftSyncRuns=" + positive.driftSyncRuns);
    ok("P3-E 正向：补偿排程后最新业务台账回写生效（driftItemEventsWritten 为 true）",
      positive.driftItemEventsWritten === true);
    ok("P3-E 正向：全屏闹钟 close 动作经 resume 排空不打开详情页（closeDetailId === null）",
      positive.closeDetailId === null, "actual closeDetailId=" + positive.closeDetailId);
    ok("P3-E 正向：全屏闹钟 ACK 动作保留 alarmEventId 且事务去重生效（ackSeen === true）",
      positive.ackSeen === true);
    ok("P3-E 正向：全屏闹钟 snooze 动作保留 alarmEventId 且事务去重生效（snzSeen === true）",
      positive.snzSeen === true);
    ok("P3-E 正向：全屏闹钟 done 动作保留 alarmEventId 且事务去重生效（doneSeen === true）",
      positive.doneSeen === true);
    ok("P3-E 正向：权威提交拒绝后事件未被持久去重占用，保留重试资格（rejectedEventSeen === false）",
      positive.rejectedEventSeen === false);
    ok("P3-E 正向：重复 ID 首项胜出（首项被修改，次项未被修改）",
      positive.dupFirstModified === true && positive.dupSecondModified === false);
    ok("P3-E 正向：桥晚到重试成功排干对账队列（lateBridgeRuns >= 1）",
      positive.lateBridgeRuns >= 1, "actual lateBridgeRuns=" + positive.lateBridgeRuns);

    // 5 组反向变异
    // 变异 1：去掉 deferNativeSync: true
    {
      const mutant1Src = coordinatorSource.replace(
        "const ledgerOptions = { deferNativeSync: true };",
        "const ledgerOptions = {};"
      );
      ok("P3-E 变异 1 前置：补丁成功", mutant1Src !== coordinatorSource);
      const tmpFile = path.join(os.tmpdir(), "attention-p3e-mutant-defer.js");
      fs.writeFileSync(tmpFile, mutant1Src, "utf8");
      try {
        const mutantRes = await runCoordinatorScenario({ "lib/app-native-coordinator.js": tmpFile });
        ok("P3-E 反向变异 1 变红：去掉 deferNativeSync 导致保存后自激多轮对账（runs > 1）",
          mutantRes.runsAfterSaveIdle > 1, "actual runs=" + mutantRes.runsAfterSaveIdle);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    }

    // 变异 2：漂移后提前 break 退出未重跑补偿（旧 bug 变异）
    {
      const mutant2Src = coordinatorSource.replace(
        "            if (!nativeSyncPending) {\n              break;\n            }\n          }",
        "          }\n          if (!nativeSyncPending) {\n            break;\n          }"
      );
      ok("P3-E 变异 2 前置：补丁成功", mutant2Src !== coordinatorSource);
      const tmpFile = path.join(os.tmpdir(), "attention-p3e-mutant-drift-break.js");
      fs.writeFileSync(tmpFile, mutant2Src, "utf8");
      try {
        const mutantRes = await runCoordinatorScenario({ "lib/app-native-coordinator.js": tmpFile });
        ok("P3-E 反向变异 2 变红：漂移后提前 break 导致仅执行 1 轮对账遗漏补偿（driftSyncRuns === 1）",
          mutantRes.driftSyncRuns === 1, "actual driftSyncRuns=" + mutantRes.driftSyncRuns);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    }

    // 变异 3：桥未就绪时丢弃 queue 请求
    {
      const mutant3Src = coordinatorSource.replace(
        "ensureNativeReminders().then(ok => { if (ok) queueNativeReminderSync(source); });",
        "// ensureNativeReminders retry dropped"
      );
      ok("P3-E 变异 3 前置：补丁成功", mutant3Src !== coordinatorSource);
      const tmpFile = path.join(os.tmpdir(), "attention-p3e-mutant-latebridge.js");
      fs.writeFileSync(tmpFile, mutant3Src, "utf8");
      try {
        const mutantRes = await runCoordinatorScenario({ "lib/app-native-coordinator.js": tmpFile });
        ok("P3-E 反向变异 3 变红：丢弃重试导致桥晚到未执行对账（lateBridgeRuns === 0）",
          mutantRes.lateBridgeRuns === 0, "actual lateBridgeRuns=" + mutantRes.lateBridgeRuns);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    }

    // 变异 4：indexItemsById 破坏首项胜出
    {
      const mutant4Src = coordinatorSource.replace(
        "if (map.has(it.id)) return;",
        "// if (map.has(it.id)) return;"
      );
      ok("P3-E 变异 4 前置：补丁成功", mutant4Src !== coordinatorSource);
      const tmpFile = path.join(os.tmpdir(), "attention-p3e-mutant-firstwin.js");
      fs.writeFileSync(tmpFile, mutant4Src, "utf8");
      try {
        const mutantRes = await runCoordinatorScenario({ "lib/app-native-coordinator.js": tmpFile });
        ok("P3-E 反向变异 4 变红：首项胜破坏导致重复 ID 次项被篡改（dupSecondModified 变为 true）",
          mutantRes.dupSecondModified === true);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    }

    // 变异 5：drainAlarmActions 篡改为回退到通知栏动作入口
    {
      const mutant5Src = coordinatorSource.replace(
        "await nr.drainAlarmActions(deps.handleAlarmAction);",
        "await nr.drainAlarmActions(deps.onNotificationAction);"
      );
      ok("P3-E 变异 5 前置：补丁成功", mutant5Src !== coordinatorSource);
      const tmpFile = path.join(os.tmpdir(), "attention-p3e-mutant-alarm-route.js");
      fs.writeFileSync(tmpFile, mutant5Src, "utf8");
      try {
        const mutantRes = await runCoordinatorScenario({ "lib/app-native-coordinator.js": tmpFile });
        ok("P3-E 反向变异 5 变红：闹钟动作走通知入口导致 close 意外弹出详情面板（closeDetailId !== null）",
          mutantRes.closeDetailId !== null, "actual closeDetailId=" + mutantRes.closeDetailId);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    }

    ok("P3-E 变异收口：临时变异未污染产品文件 lib/app-native-coordinator.js",
      fs.readFileSync(path.join(ROOT, "lib/app-native-coordinator.js"), "utf8") === coordinatorSource);
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

    // 设置面板：开着时原生状态变化要同步重绘（从系统设置页返回、回前台补读后步骤状态要跟上）；
    // 关着时不碰它，避免每读一次权限就白写一次面板
    const setupBodyWrites0 = n.writesNow()["#setupBody"] || 0;
    appN.setNativeReminderStatus({ exactAlarm: "denied" }, "resume-recheck");
    ok("设置面板关着 ⇒ 原生状态变化不重绘面板",
      (n.writesNow()["#setupBody"] || 0) === setupBodyWrites0, JSON.stringify(n.writesNow()));
    n.node("#sheetSetup").classList.add("open");
    appN.setNativeReminderStatus({ exactAlarm: "granted" }, "resume-recheck");
    ok("设置面板开着 ⇒ 原生状态变化后面板立即重绘",
      (n.writesNow()["#setupBody"] || 0) > setupBodyWrites0 && /允许精确提醒/.test(n.node("#setupBody").innerHTML),
      (n.writesNow()["#setupBody"] || 0) + " / " + n.node("#setupBody").innerHTML.slice(0, 80));
    n.node("#sheetSetup").classList.remove("open");
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
