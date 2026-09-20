/* 安心收件箱 — 复核修复回归测试（G1–G5）
 *
 * 目的：把「修好了」变成**可复现的证据**。
 *
 * 与 test-smoke.js 的区别：这里不跑产品主路径，而是针对第三轮复核报告里的
 * 五个缺陷各写一个**能区分修复前后**的案例（把修复回退掉，这些断言就会失败）。
 *
 * 原则：
 *  · 调用的是**真实**的业务 / 队列函数（app-core.js、lib/native-reminders.js）；
 *  · 只把浏览器外设（DOM / 存储 / 原生桥）换成可控 mock；
 *  · 提交时刻可控 → 能稳定复现「提交还没落地就被确认删除」「提交失败留下半个状态」。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;
const native = require(path.join(ROOT, "lib/native-reminders.js"));

const LIB_SOURCES = [
  "lib/parse-cn.js",
  "lib/repeat.js",
  "lib/reminder.js",
  "lib/storage.js",
  // UX-T01/T03：这两支必须和 index.html 同序加载 —— 少了它们，
  // app-core 里的 FeedbackLib / EvidenceLib 会静默退化成兜底分支，
  // 于是「反馈与证据」的全部断言都测在了没有实现的那条路上。
  "lib/feedback.js",
  "lib/delivery-evidence.js"
].map(f => ({ name: f, code: fs.readFileSync(path.join(ROOT, f), "utf8") }));
const APP_SOURCE = { name: "app-core.js", code: fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8") };

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

/** 让出到宏任务：跑完所有微任务，并放行 setTimeout(0) 的存储回调 */
function tick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** 翻几轮，确保异步链（loadAsync → applyParsedState）已经跑完 */
async function flush(rounds) {
  for (let i = 0; i < (rounds || 3); i++) await tick();
}

/* ---------- 应用沙箱：真实 app-core + 可控外设 ---------- */

/**
 * 「设备上的存储」—— 可以跨 createApp 复用，于是「重启后读到什么」变成可断言的事实。
 *
 * `puts` 记录每次写事务**提交那一刻**的深快照，模拟 IndexedDB 在 put 时克隆数据：
 * 这正是 H1 的关键 —— 「内存里改了」不等于「这次提交里有」。
 */
function createDisk(seedState) {
  const disk = {
    idbValue: null,                 // IndexedDB 的当前值（权威）
    ls: new Map(),                  // localStorage 的当前值（镜像 / 无 IDB 时的权威）
    puts: [],                       // 每次 put 的快照：{ value, committed }
    commits: [],                    // 待释放的写事务
    mode: "ok",                     // "ok" | "fail"
    hold: false,                    // true = 扣住写事务，等 flushDisk()
    lsFail: false                   // true = localStorage 写入抛错（配额）
  };
  if (seedState) disk.ls.set("attention-inbox-v2", JSON.stringify(seedState));
  return disk;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** 放行已排队的写事务（按当前 mode 决定成功或失败） */
function flushDisk(disk) {
  const pending = disk.commits.splice(0, disk.commits.length);
  pending.forEach(run => run());
}

/** 权威后端（IndexedDB）上最后一次**成功提交**的内容 */
function persistedOnDisk(disk) {
  for (let i = disk.puts.length - 1; i >= 0; i--) {
    if (disk.puts[i].committed) return disk.puts[i].value;
  }
  return null;
}

function createApp(options) {
  options = options || {};
  const disk = options.disk || createDisk(options.seedState);
  const nodes = new Map();

  const localStorage = {
    getItem(k) { return disk.ls.has(k) ? disk.ls.get(k) : null; },
    setItem(k, v) {
      if (disk.lsFail) throw new Error("quota exceeded");
      disk.ls.set(k, String(v));
    },
    removeItem(k) { disk.ls.delete(k); },
    clear() { disk.ls.clear(); }
  };

  const fakeDb = {
    objectStoreNames: { contains: () => true },
    transaction() {
      const tx = { oncomplete: null, onerror: null, error: null };
      const store = {
        get() {
          const req = {};
          setTimeout(() => { req.result = clone(disk.idbValue); if (req.onsuccess) req.onsuccess(); }, 0);
          return req;
        },
        put(value) {
          // IndexedDB 在 put 时**克隆**数据：之后内存再改也不会进这次提交
          const snapshot = clone(value);
          const entry = { value: snapshot, committed: false };
          disk.puts.push(entry);
          const run = () => {
            if (disk.mode === "fail") {
              tx.error = new Error("commit failed");
              if (tx.onerror) tx.onerror();
            } else {
              entry.committed = true;
              disk.idbValue = snapshot;
              if (tx.oncomplete) tx.oncomplete();
            }
          };
          if (disk.hold) disk.commits.push(run);
          else setTimeout(run, 0);
        }
      };
      tx.objectStore = () => store;
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

  function el(id) {
    return {
      id, hidden: false, disabled: false, textContent: "", innerHTML: "", value: "", className: "",
      style: {}, dataset: {},
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
      addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
      querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
      focus() {}, click() {}, appendChild() {}, remove() {}
    };
  }
  const document = {
    readyState: "complete",
    visibilityState: "visible",
    addEventListener() {},
    querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, el(sel)); return nodes.get(sel); },
    querySelectorAll() { return []; },
    createElement() { return el("tmp"); },
    body: { appendChild() {} }
  };

  // 沙箱内的定时器：**长延时一律不真正挂起**。
  // 例如全屏弹条的「10 分钟自动收起」、跨窗口的待整理补提醒 —— 在真机上是对的，
  // 但在测试里会让进程空等到它触发才能退出。短延时（<= 60s）照常保留，
  // 因为对账去抖、toast 收起这些行为本身也在断言范围内。
  const parkedTimers = [];
  const sandboxSetTimeout = (fn, ms) => {
    if (Number(ms) >= 60000) { parkedTimers.push({ fn, ms: Number(ms) }); return 0; }
    return setTimeout(fn, ms);
  };

  // Q1：`setInterval` 原先是个纯 stub（恒返回 0），于是「15 秒心跳有没有被装上」
  // 在测试里完全不可观测。记录调用参数即可断言 —— 心跳是 init() 最后几步之一，
  // 它存在就证明整条启动链跑到了底。
  const sandboxIntervals = [];
  const sandboxSetInterval = (fn, ms) => {
    sandboxIntervals.push({ fn, ms: Number(ms) });
    return sandboxIntervals.length;
  };

  const sandbox = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, Set, Map, Promise, Error, RegExp,
    parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, URLSearchParams,
    Blob: function () {}, File: function () {}, FileReader: function () {},
    setTimeout: sandboxSetTimeout, clearTimeout, setInterval: sandboxSetInterval, clearInterval,
    history: { replaceState() {} },
    location: { search: "", pathname: "/index.html", href: "http://localhost/index.html" },
    localStorage, indexedDB, document,
    navigator: {
      onLine: true, serviceWorker: undefined, vibrate() {},
      share: undefined, canShare: undefined, setAppBadge: undefined
    },
    window: { addEventListener() {}, Notification: undefined },
    Notification: undefined,
    fetch: async () => { throw new Error("no network in tests"); },
    globalThis: null
  };
  sandbox.globalThis = sandbox;
  sandbox.window = Object.assign(sandbox.window, sandbox);
  // 只把**真实**的原生实现挂上去；isNativeAndroid 归 false，
  // 免得 app-core 启动时自己去初始化原生链路（那属于 test-native-reminders 的范围）
  sandbox.AttentionNativeReminders = Object.assign({}, native, { isNativeAndroid: () => false });

  if (options.noIdb) delete sandbox.indexedDB; // 模拟没有 IndexedDB 的设备：localStorage 即权威

  vm.createContext(sandbox);
  LIB_SOURCES.forEach(f => vm.runInContext(f.code, sandbox, { filename: f.name }));
  vm.runInContext(APP_SOURCE.code, sandbox, { filename: APP_SOURCE.name });

  const app = sandbox.__ATTENTION_INBOX__;
  if (!app) {
    console.error("FAIL: test hook not exposed");
    process.exit(1);
  }

  return {
    app,
    disk,
    localStorage,
    /**
     * 启动并**等启动期的自动保存全部落定**。
     *
     * 提交闸门是 FIFO：启动期 `save()` 留下的写事务若还在排队，调用方的第一笔提交
     * 就会堵在它们后面 —— 测试若同时扣住提交，就会互相等死。
     * 真机上这些写事务会自己完成，所以这里显式排空，让场景从「空闲的闸门」开始。
     */
    async boot() {
      await app.ready();
      await flush(3);
      const stalled = disk.commits.splice(0, disk.commits.length);
      stalled.forEach(run => run());
      await flush(3);
      return app;
    },
    /** 被沙箱拦下的长延时定时器（仅供诊断，不参与断言） */
    get parkedTimers() { return parkedTimers; },
    /** 沙箱内被装上的周期定时器（Q1：用于断言 15 秒心跳确实装上了） */
    get intervals() { return sandboxIntervals; },
    setCommitFailure(on) { disk.mode = on ? "fail" : "ok"; },
    /** 扣住写事务（观察「提交尚未完成」的窗口）；默认自动放行 */
    holdCommits(on) { disk.hold = !!on; },
    /** localStorage 写入失败（配额） */
    setLocalStorageFailure(on) { disk.lsFail = !!on; },
    flushCommits() { flushDisk(disk); },
    /**
     * 按**创建顺序**放行前 n 笔写事务（不传则全部）。
     * 复核探针常是「先让第一笔失败，再让第二笔成功」，需要能逐笔释放，
     * 并且**逐笔指定成败**（mode 传 "ok" / "fail"，不传则沿用当前模式）。
     */
    releaseCommits(n, mode) {
      if (mode) disk.mode = mode;
      const count = n == null ? disk.commits.length : Math.min(n, disk.commits.length);
      disk.commits.splice(0, count).forEach(run => run());
    },
    /** 已提交到权威后端的内容 */
    persisted() { return persistedOnDisk(disk); },
    /** 用真实代码走一遍「ACK 周期 → 派生下一期」 */
    async ackRepeatItem(it) {
      await app.handleAlarmAction({ action: "ack", itemId: it.id, itemRev: it.rev });
    },
    /** 给表单元素设值（驱动编辑保存等读表单的路径） */
    setField(selector, value) {
      document.querySelector(selector).value = value;
    },
    /**
     * 替换沙箱里的 `fetch`（默认实现是「测试里没有网络」）。
     *
     * AI 路径必须能在**不发真实请求**的前提下被驱动：只有把 Promise 捏在手里，
     * 才能复现「响应迟到、期间用户继续输入」这类时序反例（R-F03）。
     */
    setFetch(fn) {
      sandbox.fetch = fn;
    },
    /** 读回表单元素（断言表单被写入的值） */
    fieldOf(selector) {
      return document.querySelector(selector).value;
    },
    textOf(selector) {
      return document.querySelector(selector).textContent;
    },
    /**
     * 元素当前是不是**隐藏**的。
     *
     * F08 的「上一条 toast 把撤销入口顶掉」在只读 textContent 时是看不见的：`toast()` 在
     * 无第二动作时只把 `#toastAction2` 置为 hidden，**不清空**它的文字。于是「按钮还在、
     * 只是不可见」这种状态必须用可见性来断言，否则断言会一直是绿的（反向自检实测）。
     */
    hiddenOf(selector) {
      const node = document.querySelector(selector);
      return !!(node && node.hidden);
    },
    /**
     * 元素是否带某个 class。
     *
     * 面板开关用的是**类**（`open` 在 `.sheet` 上、`show` 在 `#backdrop` 上），
     * 不是 `hidden` —— 所以「面板关掉了没有」只能靠类断言，用 `hiddenOf` 会永远是绿。
     */
    hasClassOf(selector, cls) {
      const node = document.querySelector(selector);
      return !!(node && node.classList && node.classList.contains(cls));
    },
    /** 磁盘上某项的状态（权威后端） */
    persistedStatusOf(itemId) {
      const snap = persistedOnDisk(disk);
      if (!snap) return null;
      const it = (snap.items || []).find(x => x.id === itemId);
      return it ? it.status : null;
    }
  };
}

/** 模拟「重启」：用同一个 disk 再启一个应用实例 */
async function restartApp(disk) {
  disk.hold = false; // 重启后的启动流程不该被测试的扣留影响
  const next = createApp({ disk });
  await next.boot();
  return next;
}

/** 重启后从权威后端读回的状态表：{ itemId: status } */
async function reloadStatusById(disk) {
  const next = await restartApp(disk);
  const map = {};
  next.app.state.items.forEach(x => { map[x.id] = x.status; });
  return map;
}

/** 造一个 ACK 周期事项（确认时派生下一期） */
function repeatAckItem(app, extra) {
  return app.makeItem(Object.assign({
    title: "每周复盘",
    status: "due",
    priority: "normal",
    triggerAt: Date.now() - 1000,
    repeat: { mode: "ack", every: "week" }
  }, extra || {}));
}

/* ---------- 原生桥 mock（给 drain / reconcile 用） ---------- */

function installCapacitor(options) {
  options = options || {};
  const calls = { acked: [], cancelled: [], scheduled: [], scheduleAlarm: [], cancelAlarm: [] };
  let pending = (options.pending || []).slice();
  let queue = (options.actions || []).slice();

  const local = {
    async checkPermissions() { return { display: "granted" }; },
    async requestPermissions() { return { display: "granted" }; },
    async checkExactNotificationSetting() { return { exact_alarm: "granted" }; },
    async changeExactNotificationSetting() { return { exact_alarm: "granted" }; },
    async createChannel(channel) { calls.channels = (calls.channels || []).concat(channel); },
    async registerActionTypes() {},
    // Q1：真机契约是**同步返回 `{ remove }` 句柄**（Android `JSExport.getPluginJS()`
    // 注入的 t.addListener 直接转发到 native-bridge 的 cap.addListener，后者 return 一个
    // 普通对象）。**绝不能写成 async** —— 那样会返回 Promise，比真机宽松，
    // 于是「.catch is not a function」这类只在真机复现的缺陷会被 mock 掩盖（V1 就是这么漏的）。
    addListener() { return { async remove() {} }; },
    async getPending() { return { notifications: pending.slice() }; },
    async schedule(value) {
      calls.scheduled.push(value.notifications.slice());
      pending = pending.concat(value.notifications);
      return { notifications: value.notifications.map(n => ({ id: n.id })) };
    },
    async cancel(value) {
      calls.cancelled.push(value.notifications.slice());
      const ids = new Set(value.notifications.map(n => n.id));
      pending = pending.filter(n => !ids.has(n.id));
    },
    async removeDeliveredNotifications() {}
  };

  const bridge = {
    async diagnose() {
      return {
        notificationsEnabled: true,
        postNotificationsGranted: true,
        canExactAlarm: true,
        ignoringBatteryOptimizations: true
      };
    },
    async scheduleAlarm(value) { calls.scheduleAlarm.push(value); return { ok: true, id: value.id }; },
    async scheduleAt(value) { calls.scheduleAlarm.push(value); return { ok: true, id: value.id }; },
    async cancelAlarm(value) { calls.cancelAlarm.push(value); return { ok: true }; },
    async consumeAlarmAction() { return queue.length ? queue[0] : null; },
    async ackAlarmAction(value) {
      calls.acked.push(value.id);
      queue = queue.filter(e => e.id !== value.id);
    }
  };

  global.Capacitor = {
    getPlatform() { return "android"; },
    Plugins: { LocalNotifications: local, SystemBridge: bridge, App: { addListener() { return { async remove() {} }; } } }
  };

  return {
    calls,
    get pending() { return pending; },
    get queue() { return queue; },
    setQueue(next) { queue = next.slice(); },
    cleanup() { delete global.Capacitor; }
  };
}

/* ================================================================= */

async function run() {
  section("N5 / D13 整理四条即时落盘，重启仅继续剩余六条");
  {
    const h = createApp();
    const app = await h.boot();
    app.state.items = Array.from({ length: 10 }, (_, i) => app.makeItem({
      id: "audit-review-" + i, title: "验收整理 " + i,
      status: "waiting", review_status: "NEEDS_REVIEW",
      triggerAt: Date.now() + 86400000, isFallbackTrigger: false,
      createdAt: Date.now() + i
    }));
    await app.saveAsync();
    app.openReviewSession();
    for (let i = 0; i < 4; i++) {
      app.reviewConfirm();
      // 不补调 saveAsync：必须证明 reviewConfirm 自己发起的保存已提交。
      await flush(6);
      ok("D13 第 " + (i + 1) + " 条确认后立即持久化",
        h.persisted().items.filter(it => it.review_status === "REVIEWED").length === i + 1);
    }
    const resumed = await restartApp(h.disk);
    resumed.app.openReviewSession();
    ok("D13 重启只剩六条待整理", resumed.app.needsReviewItems().length === 6);
    ok("D13 重启会话不包含已经确认的四条",
      resumed.app.state.ui.reviewQueue.join(",") ===
      Array.from({ length: 6 }, (_, i) => "audit-review-" + (i + 4)).join(","));
  }

  /* ---------- G1：并发消费 / 提交边界 ---------- */
  section("G1 同一事件的并发消费必须落到同一次提交上");
  {
    const h = createApp();
    const app = await h.boot();

    const it = app.makeItem({ title: "并发消费", status: "due", priority: "normal", triggerAt: Date.now() - 1000 });
    app.state.items = [it];
    const rev0 = it.rev;

    h.setCommitFailure(true);
    h.holdCommits(true); // 扣住提交，才能观察「提交尚未落地」的窗口
    const first = app.handleAlarmAction({ action: "ack", itemId: it.id, itemRev: rev0, alarmEventId: "evt-c1" });
    const second = app.handleAlarmAction({ action: "done", itemId: it.id, itemRev: rev0, alarmEventId: "evt-c1" });
    let secondOutcome = "pending";
    second.then(() => { secondOutcome = "resolved"; }, () => { secondOutcome = "rejected"; });

    await tick();
    ok("G1 第二次调用不得在首次提交完成前返回成功", secondOutcome === "pending", "second=" + secondOutcome);

    h.flushCommits();
    let firstErr = null;
    await first.catch(e => { firstErr = e; });
    await second.catch(() => {});
    ok("G1 提交失败时两次调用一起失败", !!firstErr && secondOutcome === "rejected",
      "err=" + (firstErr && firstErr.message) + " second=" + secondOutcome);
    ok("G1 提交失败后事件不得记入台账（否则重放会被误判为已处理）", app.alarmEventSeen("evt-c1") === false);
    ok("G1 提交失败后原事项完整回滚", it.status === "due" && it.rev === rev0,
      "status=" + it.status + " rev=" + it.rev);
    ok("G1 提交失败后不得残留派生实例", app.state.items.length === 1, "items=" + app.state.items.length);

    h.setCommitFailure(false);
    h.holdCommits(false);
    await app.handleAlarmAction({ action: "ack", itemId: it.id, itemRev: it.rev, alarmEventId: "evt-c1" });
    ok("G1 提交恢复后同一事件可正常重试", it.status === "acknowledged" && app.alarmEventSeen("evt-c1") === true,
      "status=" + it.status + " seen=" + app.alarmEventSeen("evt-c1"));
  }

  section("G1 提交失败时不得确认删除原生事件；两个消费入口不得重复处理");
  {
    const h = createApp();
    const app = await h.boot();
    const it = app.makeItem({ title: "原生事件", status: "due", priority: "normal", triggerAt: Date.now() - 1000 });
    app.state.items = [it];
    const rev0 = it.rev;

    // 提交失败：drain 不得确认删除原生事件
    const env = installCapacitor({ actions: [{ id: 7001, action: "ack", itemId: it.id, itemRev: rev0 }] });
    h.setCommitFailure(true);
    h.holdCommits(true);
    const drain1 = native.drainAlarmActions(app.handleAlarmAction);
    const drain2 = native.drainAlarmActions(app.handleAlarmAction); // 恢复前台 + appStateChange 两个入口
    await tick();
    h.flushCommits();
    await Promise.all([drain1, drain2]);
    ok("G1 提交失败时不得确认删除原生事件", env.calls.acked.length === 0, JSON.stringify(env.calls.acked));
    ok("G1 提交失败后事件仍在队列里可重试", env.queue.length === 1);

    // 提交恢复：重试成功且只确认一次
    h.setCommitFailure(false);
    h.holdCommits(false);
    await native.drainAlarmActions(app.handleAlarmAction);
    await flush(2);
    ok("G1 提交恢复后重试成功", it.status === "acknowledged", "status=" + it.status);
    ok("G1 事件只被确认删除一次", env.calls.acked.length === 1 && env.calls.acked[0] === 7001,
      JSON.stringify(env.calls.acked));
    env.cleanup();
  }

  section("G1 并发进入两个消费入口时，同一事件只处理一次");
  {
    const env = installCapacitor({ actions: [{ id: 7002, action: "ack", itemId: "x", itemRev: 1 }] });
    let handlerCalls = 0;
    const handler = async () => {
      handlerCalls++;
      await new Promise(resolve => setTimeout(resolve, 5));
    };
    await Promise.all([native.drainAlarmActions(handler), native.drainAlarmActions(handler)]);
    ok("G1 排空队列是串行的（handler 只被调用一次）", handlerCalls === 1, "calls=" + handlerCalls);
    env.cleanup();
  }

  /* ---------- G2：动作 + 派生的原子回滚 ---------- */
  section("G2 动作与周期派生必须是一次提交");
  {
    const h = createApp();
    const app = await h.boot();
    const it = repeatAckItem(app);
    app.state.items = [it];
    const rev0 = it.rev;

    h.setCommitFailure(true);
    h.holdCommits(true);
    const action = app.handleAlarmAction({ action: "ack", itemId: it.id, itemRev: rev0 });
    await tick();
    h.flushCommits();
    let err = null;
    await action.catch(e => { err = e; });

    ok("G2 提交失败向外上抛异常", !!err, err && err.message);
    ok("G2 提交失败后不得残留派生出来的下一期", app.state.items.length === 1,
      "items=" + app.state.items.length);
    ok("G2 提交失败后不得残留 ackAdvancedAt", !it.ackAdvancedAt);
    ok("G2 提交失败后原事项完整还原", it.status === "due" && it.rev === rev0,
      "status=" + it.status + " rev=" + it.rev);

    h.setCommitFailure(false);
    h.holdCommits(false);
    await app.handleAlarmAction({ action: "ack", itemId: it.id, itemRev: it.rev });
    const spawned = app.state.items.filter(x => x.id !== it.id);
    ok("G2 提交恢复后重试只派生一期（不是两期）", app.state.items.length === 2 && spawned.length === 1,
      "items=" + app.state.items.length);
    ok("G2 重试后原事项为已确认且记录了推进时刻",
      it.status === "acknowledged" && !!it.ackAdvancedAt);
  }

  section("H2 备用镜像（localStorage）写失败，不得把已提交的事务说成没提交");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "镜像失败" });
    app.state.items = [a];
    const rev0 = a.rev;

    h.setLocalStorageFailure(true); // localStorage 配额爆掉；IndexedDB（权威）正常
    let err = null;
    await app.handleAlarmAction({ action: "ack", itemId: a.id, itemRev: rev0, alarmEventId: "evt-quota" })
      .catch(e => { err = e; });
    h.setLocalStorageFailure(false);

    ok("H2 镜像写失败不影响权威提交（不上抛）", !err, err && err.message);
    ok("H2 内存保持已确认，不回滚用户看到的结果", a.status === "acknowledged", "status=" + a.status);
    ok("H2 已派生的下一期保留", app.state.items.length === 2, "items=" + app.state.items.length);
    ok("H2 事件台账已落库", app.alarmEventSeen("evt-quota") === true);

    const after = await reloadStatusById(h.disk);
    ok("H2 重启后与用户看到的一致（读回已确认 + 下一期）",
      after[a.id] === "acknowledged" &&
      Object.keys(after).filter(id => id !== a.id).length === 1,
      JSON.stringify(after));
  }

  section("H2 有 IndexedDB 时权威后端说了算；没有它时 localStorage 才是权威");
  {
    // 反向：权威（IndexedDB）失败 → 必须如实报告
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "权威失败" });
    app.state.items = [a];
    const rev0 = a.rev;
    await app.saveAsync(); // 先把「待处理」提交上盘，作为可对比基线

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "ack", itemId: a.id, itemRev: rev0, alarmEventId: "evt-auth" });
    await tick();
    h.flushCommits();
    let err = null;
    await action.catch(e => { err = e; });

    ok("H2 权威提交失败如实上抛", !!err, err && err.message);
    ok("H2 权威失败后内存完整回滚", a.status === "due" && a.rev === rev0 && app.state.items.length === 1,
      "status=" + a.status + " items=" + app.state.items.length);
    ok("H2 权威失败后事件不记入台账（原生事件保留待重试）", app.alarmEventSeen("evt-auth") === false);
    const after = await reloadStatusById(h.disk);
    ok("H2 权威失败后重启与回滚后的内存一致（不会反而显示已确认）",
      after[a.id] === "due", JSON.stringify(after));

    // 没有 IndexedDB 的设备：localStorage 就是权威，它的失败必须上抛
    const h2 = createApp({ noIdb: true });
    await h2.boot();
    const b = repeatAckItem(h2.app, { title: "无 IDB" });
    h2.app.state.items = [b];
    const rev1 = b.rev;
    h2.setLocalStorageFailure(true);
    let err2 = null;
    await h2.app.handleAlarmAction({ action: "ack", itemId: b.id, itemRev: rev1 }).catch(e => { err2 = e; });
    h2.setLocalStorageFailure(false);
    ok("H2 无 IndexedDB 时 localStorage 是权威，写失败必须上抛",
      !!err2 && /quota exceeded/.test(err2.message), err2 && err2.message);
    ok("H2 无 IndexedDB 时写失败同样完整回滚",
      b.status === "due" && b.rev === rev1 && h2.app.state.items.length === 1,
      "status=" + b.status + " items=" + h2.app.state.items.length);
  }

  section("H1 闹钟提交进行中，普通用户操作的保存不得被静默丢弃");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "闹钟操作的事项" });
    const b = app.makeItem({ title: "用户顺手完成", status: "due", priority: "normal", triggerAt: Date.now() - 1000 });
    app.state.items = [a, b];
    const putsBase = h.disk.puts.length;

    h.holdCommits(true);
    const action = app.handleAlarmAction({ action: "ack", itemId: a.id, itemRev: a.rev });
    await tick();
    ok("H1 前置：闹钟动作的写事务已进入队列（数据已克隆）但未提交",
      h.disk.commits.length === 1, "queued=" + h.disk.commits.length);

    // 提交还在路上，用户点了另一事项的「完成」—— 这次改动不在上面那笔提交里
    app.completeItem(b.id);
    await flush(3);
    ok("H1 普通保存不得被吞掉（已排队待提交）",
      h.disk.commits.length === 1 && h.disk.puts.length === putsBase + 1,
      "queued=" + h.disk.commits.length);
    ok("I1 但它的快照必须排在动作成败之后生成（此刻还没有取快照）",
      h.disk.puts.length === putsBase + 1, "puts=" + (h.disk.puts.length - putsBase));

    h.releaseCommits(1); // 放行动作提交（成功）
    await action;
    await flush(3);      // 排队中的普通保存这时才取快照并排进写事务
    h.releaseCommits(1); // 放行它
    await flush(3);

    ok("H1 内存里两件事都完成了",
      a.status === "acknowledged" && b.status === "archived",
      "a=" + a.status + " b=" + b.status);

    const snap = h.persisted();
    const persistedOf = id => (snap && (snap.items || []).find(x => x.id === id) || {}).status;
    ok("H1 提交期间用户完成的另一事项必须落库", persistedOf(b.id) === "archived",
      "persisted=" + persistedOf(b.id));
    ok("H1 闹钟动作本身也落库", persistedOf(a.id) === "acknowledged",
      "persisted=" + persistedOf(a.id));

    const after = await reloadStatusById(h.disk);
    ok("H1 重启后与用户看到的一致",
      after[a.id] === "acknowledged" && after[b.id] === "archived", JSON.stringify(after));
  }

  section("I1 前一笔记账失败、后一笔成功，也不得把失败的那笔重新写回去");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "周期 ACK" });
    const b = app.makeItem({ title: "顺手完成", status: "due", priority: "normal", triggerAt: Date.now() - 1000 });
    app.state.items = [a, b];
    await app.saveAsync(); // 基线：A=due / B=due 已落盘
    const rev0 = a.rev;

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "ack", itemId: a.id, itemRev: rev0, alarmEventId: "evt-i1" });
    await tick();
    app.completeItem(b.id); // 用户完成 B：它的快照必须等 A 的成败落定
    await flush(3);

    h.releaseCommits(1);    // 只放行第一笔（A）→ 失败并回滚
    let err = null;
    await action.catch(e => { err = e; });
    await flush(3);         // B 的快照必须在这之后才生成

    h.setCommitFailure(false);
    h.releaseCommits(1);    // 再放行第二笔（B）→ 成功
    h.holdCommits(false);
    await flush(3);

    ok("I1 前置：A 的提交确实失败", !!err, err && err.message);
    ok("I1 内存：A 回到待处理、派生实例撤回、事件未记台账",
      a.status === "due" && app.state.items.length === 2 && app.alarmEventSeen("evt-i1") === false,
      "a=" + a.status + " items=" + app.state.items.length + " seen=" + app.alarmEventSeen("evt-i1"));

    const snap = h.persisted();
    const diskItems = (snap && snap.items) || [];
    const diskOf = id => (diskItems.find(x => x.id === id) || {}).status;
    ok("I1 磁盘：A 不得被重新写成已确认", diskOf(a.id) === "due", "disk A=" + diskOf(a.id));
    ok("I1 磁盘：不得残留派生出来的下一期", diskItems.length === 2, "items=" + diskItems.length);
    ok("I1 磁盘：不得留下该事件的已处理标记",
      !(snap && snap.settings && snap.settings.alarmEventLog &&
        snap.settings.alarmEventLog["evt-i1"]),
      JSON.stringify(snap && snap.settings && snap.settings.alarmEventLog));
    ok("I1 磁盘：B 保持已归档", diskOf(b.id) === "archived", "disk B=" + diskOf(b.id));

    const after = await reloadStatusById(h.disk);
    ok("I1 重启后：A 仍是待处理且无派生残留",
      after[a.id] === "due" && Object.keys(after).length === 2, JSON.stringify(after));
    ok("I1 重启后：B 仍是已归档", after[b.id] === "archived");
    const reloaded = await restartApp(h.disk);
    ok("I1 重启后：事件台账没有该事件的已处理标记",
      reloaded.app.alarmEventSeen("evt-i1") === false);
  }

  section("H1 同一事项提交未决时，用户操作必须显式拒绝且不得伪装成功");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "同一条事项" });
    app.state.items = [a];

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "ack", itemId: a.id, itemRev: a.rev });
    await tick();
    const applied = app.completeItem(a.id); // 同一事项不得与未决原生事务竞写
    ok("H1 同事项操作返回 false", applied === false);
    ok("H1 拒绝时不修改最后确认状态", a.status === "due", "status=" + a.status);
    ok("H1 拒绝时给出明确反馈", /正在保存/.test(h.textOf("#toastText")), h.textOf("#toastText"));

    h.flushCommits();
    let err = null;
    await action.catch(e => { err = e; });
    ok("H1 前置：这笔提交确实失败了", !!err, err && err.message);
    ok("H1 原生提交失败后仍保持最后确认状态", a.status === "due", "status=" + a.status);
  }

  /* ---------- G3：撤销 ≠ 送达 ---------- */
  section("G3 截止阶段：撤销 / 待投递 / 已送达必须分开");
  {
    const h = createApp();
    const app = await h.boot();

    const it = app.makeItem({
      title: "截止记账", status: "acknowledged", priority: "normal",
      deadlineAt: Date.now() + 12 * 3600000
    });
    app.state.items = [it];
    const dl = it.deadlineAt;
    const p24Key = "p24@" + dl;
    const pastAt = Date.now() - 60 * 1000;

    // 空计划（例如通知被关掉 / 排程被撤销）+ 已越过计划时刻 → 不得推断为已送达
    it.deadlineEvents = { [p24Key]: { at: pastAt, state: "scheduled" } };
    app.applyDeadlineEvents([], Date.now());
    ok("G3 已越过计划时刻的待投递阶段不得被改写成已送达",
      it.deadlineEvents[p24Key].state === "scheduled", JSON.stringify(it.deadlineEvents));

    // 原生确认撤销（撤销发生在投递时刻之前）→ 记为已撤销
    const futureAt = Date.now() + 3600000;
    it.deadlineEvents[p24Key] = { at: futureAt, state: "scheduled" };
    app.applyDeadlineEvents([], Date.now(), [{ itemId: it.id, stageKey: p24Key, at: futureAt }]);
    ok("G3 原生确认撤销的排程记为 cancelled",
      it.deadlineEvents[p24Key].state === "cancelled", JSON.stringify(it.deadlineEvents));

    // 撤销报告不能覆盖已送达的终态
    it.deadlineEvents[p24Key] = { at: futureAt, state: "delivered" };
    app.applyDeadlineEvents([], Date.now(), [{ itemId: it.id, stageKey: p24Key, at: futureAt }]);
    ok("G3 撤销不得覆盖已送达的终态", it.deadlineEvents[p24Key].state === "delivered");

    // 越过投递时刻的撤销不确定是否送达 → 保持待定（保守，不补发）
    it.deadlineEvents[p24Key] = { at: pastAt, state: "scheduled" };
    app.applyDeadlineEvents([], Date.now(), [{ itemId: it.id, stageKey: p24Key, at: pastAt }]);
    ok("G3 已越过投递时刻才被撤销的阶段保持待定（不谎报送达、也不盲目补发）",
      it.deadlineEvents[p24Key].state === "scheduled", JSON.stringify(it.deadlineEvents));

    // 只有真实送达证据才写已送达
    it.deadlineEvents[p24Key] = { at: pastAt, state: "scheduled" };
    app.markDeadlineDelivered({ itemId: it.id, stageKey: p24Key });
    ok("G3 系统送达回调才落库为已送达", it.deadlineEvents[p24Key].state === "delivered");
  }

  section("G3 三种状态在原生排程上的行为必须不同");
  {
    const now = Date.now();
    const dl = now + 12 * 3600000;
    const p24Key = "p24@" + dl;
    const base = {
      id: "dl-1", title: "截止", status: "acknowledged", priority: "normal",
      triggerAt: null, rev: 3, deadlineAt: dl
    };
    const withRec = state => Object.assign({}, base, { deadlineEvents: { [p24Key]: state } });

    const cancelled = native.buildDesired(
      [withRec({ at: now - 12 * 3600000, state: "cancelled" })], { notify: true }, now);
    ok("G3 已撤销的阶段在保护点已过时补提醒（这就是被漏掉的那次提醒）",
      cancelled.some(n => n.extra.stageKey === p24Key && n.schedule.at.getTime() <= now + 3000),
      JSON.stringify(cancelled.map(n => [n.extra.stageKey, n.schedule.at.getTime() - now])));

    const delivered = native.buildDesired(
      [withRec({ at: now - 12 * 3600000, state: "delivered" })], { notify: true }, now);
    ok("G3 已送达的阶段不再补提醒",
      !delivered.some(n => n.extra.stageKey === p24Key));

    const scheduled = native.buildDesired(
      [withRec({ at: now - 12 * 3600000, state: "scheduled" })], { notify: true }, now);
    ok("G3 待投递且已过点的阶段不重复排、也不补发",
      !scheduled.some(n => n.extra.stageKey === p24Key));
  }

  section("G3 原生对账必须上报被撤销的截止排程");
  {
    const stageKey = "p24@" + (Date.now() + 12 * 3600000);
    const env = installCapacitor({
      pending: [{
        id: 501,
        extra: {
          managedKind: "attention-reminder",
          event: "deadline",
          stageKey,
          itemId: "dl-off",
          scheduleKey: "k"
        },
        schedule: { at: new Date(Date.now() + 3600000) }
      }]
    });
    const item = {
      id: "dl-off", title: "截止", status: "acknowledged", priority: "normal",
      triggerAt: null, rev: 1, deadlineAt: Date.now() + 12 * 3600000
    };
    const status = await native.reconcile([item], { notify: false }, Date.now());
    ok("G3 关闭通知后原生上报被撤销的截止排程",
      Array.isArray(status.cancelledDeadlineEvents) &&
      status.cancelledDeadlineEvents.some(e => e.itemId === "dl-off" && e.stageKey === stageKey),
      JSON.stringify(status.cancelledDeadlineEvents));
    ok("G3 撤销本身仍照常执行", status.cancelled === 1 && env.pending.length === 0);
    ok("G3 仍保留「本轮计划中的截止排程」回传通道",
      Array.isArray(status.deadlineEvents));
    env.cleanup();
  }

  /* ---------- G4：停止重复不得归档历史实例 ---------- */
  section("G4 停止重复 = 终止规则 + 只归档未开始的未来实例");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "每周复盘", status: "due", triggerAt: Date.now() - 1000 });
    app.state.items = [a];
    await h.ackRepeatItem(a);

    const b = app.state.items.find(x => x.id !== a.id);
    ok("G4 前置：ACK 派生出未开始的下一期", !!b && b.status === "waiting" && !b.acknowledgedAt);

    const ackAtA = a.acknowledgedAt;
    ok("G4 前置：当前实例仍是未完成的历史确认态", a.status === "acknowledged" && !!ackAtA);

    // 用户在「未来」页对下一期点「停止重复」
    app.stopRepeat(b.id);

    ok("G4 已确认但未完成的历史实例不得被归档", a.status === "acknowledged",
      "status=" + a.status);
    ok("G4 历史实例不得被写入 completedAt（不该混进「今天已完成 N 件」）", !a.completedAt,
      "completedAt=" + a.completedAt);
    ok("G4 历史实例的确认时间保持不变", a.acknowledgedAt === ackAtA);
    ok("G4 历史实例仍在待处理范围（未进入归档）",
      app.state.items.filter(x => x.status === "archived").length === 1,
      JSON.stringify(app.state.items.map(x => x.status)));
    ok("G4 整个系列的规则都已终止（历史实例不再派生）", !a.repeat && !b.repeat);
    ok("G4 只归档被操作的那一条，历史实例不受牵连",
      app.state.items.filter(x => x.status === "archived").length === 1 &&
      app.state.items.find(x => x.status === "archived").id === b.id,
      JSON.stringify(app.state.items.map(x => [x.id === a.id ? "A" : "B", x.status])));
    ok("G4 被操作的实例计入完成（用户明确归档它）", b.status === "archived" && !!b.completedAt);
  }

  section("G4 从历史入口停止重复：归档当前实例，但不牵连其他历史");
  {
    const h = createApp();
    const app = await h.boot();
    const first = repeatAckItem(app, { triggerAt: Date.now() - 3000 });
    app.state.items = [first];
    await h.ackRepeatItem(first);
    const second = app.state.items.find(x => x.id !== first.id);
    // 第二条也到期并被确认 → 生成第三条
    second.triggerAt = Date.now() - 1000;
    second.status = "due";
    await h.ackRepeatItem(second);
    const third = app.state.items.find(x => x.id !== first.id && x.id !== second.id);
    ok("G4 前置：系列里有两条历史 + 一条未来", !!second && !!third &&
      app.state.items.filter(x => x.status === "acknowledged").length === 2,
      JSON.stringify(app.state.items.map(x => x.status)));

    app.stopRepeat(first.id); // 用户从最早那条历史实例上停止重复

    ok("G4 被操作的那一条归档并记录完成时间",
      first.status === "archived" && !!first.completedAt);
    ok("G4 另一条历史实例保留原业务状态", second.status === "acknowledged" && !second.completedAt,
      "status=" + second.status);
    ok("G4 未来实例被归档但不计完成", third.status === "archived" && third.completedAt === null);
  }

  section("G4 停止重复后历史实例不再产生周期提醒排程");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { triggerAt: Date.now() - 1000 });
    app.state.items = [a];
    await h.ackRepeatItem(a);
    const b = app.state.items.find(x => x.id !== a.id);
    app.stopRepeat(b.id);

    const desired = native.buildDesired(app.state.items, { notify: true }, Date.now());
    ok("G4 终止后历史实例不再排出周期提醒",
      !desired.some(n => n.extra.itemId === a.id),
      JSON.stringify(desired.map(n => n.extra.itemId)));
  }

  section("J1 队列里已有的普通保存，不得把后到的 ACK 提前提交");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "周期 ACK" });
    const b = app.makeItem({ title: "顺手完成", status: "due", priority: "normal", triggerAt: Date.now() - 1000 });
    app.state.items = [a, b];
    await app.saveAsync(); // 基线
    const rev0 = a.rev;

    h.holdCommits(true);
    app.save();  // S0：一笔普通保存 —— 已出队取过快照，但写事务被扣住
    await flush(3);
    ok("J1 前置：S0 已取过快照、写事务排队中",
      h.disk.commits.length === 1, "queued=" + h.disk.commits.length);

    app.completeItem(b.id); // S1：排在 S0 之后（还没轮到它取快照）
    await flush(3);
    ok("J1 前置：B 的保存已排队但尚未取快照", h.disk.commits.length === 1);

    // A 收到 ACK：这一次动作排在 S1 之后，它的状态变更**必须等轮到它才生效**
    const action = app.handleAlarmAction({ action: "ack", itemId: a.id, itemRev: rev0, alarmEventId: "evt-j1" });
    await flush(3);
    ok("J1 动作的状态变更必须等轮到它才生效（此刻 A 仍是待处理）",
      a.status === "due", "a=" + a.status);
    ok("J1 动作不得抢先写内存事件台账", app.alarmEventSeen("evt-j1") === false);

    h.releaseCommits(1, "ok");   // S0 成功
    await flush(3);
    h.releaseCommits(1, "ok");   // S1 成功：它的快照里不能带 A 尚未提交的 ACK
    await flush(3);
    h.releaseCommits(1, "fail"); // S2（动作）失败
    let err = null;
    await action.catch(e => { err = e; });
    h.holdCommits(false);
    await flush(3);

    ok("J1 前置：A 的提交确实失败", !!err, err && err.message);
    ok("J1 内存：A 回到待处理、无派生残留、事件未记台账",
      a.status === "due" && app.state.items.length === 2 && app.alarmEventSeen("evt-j1") === false,
      "a=" + a.status + " items=" + app.state.items.length + " seen=" + app.alarmEventSeen("evt-j1"));

    const snap = h.persisted();
    const diskItems = (snap && snap.items) || [];
    const diskOf = id => (diskItems.find(x => x.id === id) || {}).status;
    ok("J1 磁盘：较早的普通保存不得把 A 的 ACK 提前写进去", diskOf(a.id) === "due",
      "disk A=" + diskOf(a.id));
    ok("J1 磁盘：不得残留派生出来的下一期", diskItems.length === 2, "items=" + diskItems.length);
    ok("J1 磁盘：不得留下该事件的已处理标记",
      !(snap && snap.settings && snap.settings.alarmEventLog && snap.settings.alarmEventLog["evt-j1"]),
      JSON.stringify(snap && snap.settings && snap.settings.alarmEventLog));
    ok("J1 磁盘：B 保持已归档", diskOf(b.id) === "archived", "disk B=" + diskOf(b.id));

    const after = await reloadStatusById(h.disk);
    ok("J1 重启后：A 仍是待处理且无派生残留",
      after[a.id] === "due" && Object.keys(after).length === 2, JSON.stringify(after));
    ok("J1 重启后：B 仍是已归档", after[b.id] === "archived");
    const reloaded = await restartApp(h.disk);
    ok("J1 重启后：事件台账没有该事件的已处理标记",
      reloaded.app.alarmEventSeen("evt-j1") === false);
  }

  section("K1 周期 ACK 提交中拒绝完成；失败落定后可安全重试");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "每周复盘" });
    app.state.items = [a];
    await app.saveAsync(); // 基线：A=due
    const rev0 = a.rev;
    const liveCount = () => app.state.items.filter(x => x.status !== "archived" && x.status !== "completed").length;

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "ack", itemId: a.id, itemRev: rev0, alarmEventId: "evt-k1" });
    await flush(3);
    ok("K1 前置：未提交 ACK 保持隔离，不提前显示派生下一期",
      a.status === "due" && !a.ackAdvancedAt && app.state.items.length === 1,
      "a=" + a.status + " adv=" + !!a.ackAdvancedAt + " items=" + app.state.items.length);

    const blocked = app.completeItem(a.id);
    ok("K1 前置：提交未决时完成被明确拒绝",
      blocked === false && a.status === "due" && app.state.items.length === 1,
      "a=" + a.status + " items=" + app.state.items.length);

    h.releaseCommits(1, "fail");  // ACK 那笔提交失败 → 回滚
    let err = null;
    await action.catch(e => { err = e; });
    const retried = app.completeItem(a.id);
    ok("K1 ACK 失败落定后允许重试完成", retried === true);
    await flush(3);               // 重试的「完成」保存这时取快照并排队
    h.releaseCommits(1, "ok");    // 让它成功
    h.holdCommits(false);
    await flush(3);

    ok("K1 ACK 提交失败如实上抛", !!err, err && err.message);
    ok("K1 用户完成的本期必须保持已完成（不得被回滚覆盖）",
      a.status === "archived" && !!a.completedAt, "a=" + a.status);
    ok("K1 恰好存在一个有效下一期（周期不得静默中断）",
      app.state.items.length === 2 && liveCount() === 1,
      "items=" + app.state.items.length + " live=" + liveCount());
    ok("K1 切掉失败 ACK 的痕迹（不残留 ackAdvancedAt）", !a.ackAdvancedAt,
      "adv=" + a.ackAdvancedAt);
    ok("K1 不残留已处理失败事件标记", app.alarmEventSeen("evt-k1") === false);

    const snap = h.persisted();
    const diskItems = (snap && snap.items) || [];
    const diskLive = diskItems.filter(x => x.status !== "archived" && x.status !== "completed").length;
    ok("K1 磁盘：本期已完成", (diskItems.find(x => x.id === a.id) || {}).status === "archived");
    ok("K1 磁盘：恰好一个有效下一期", diskItems.length === 2 && diskLive === 1,
      "items=" + diskItems.length + " live=" + diskLive);
    ok("K1 磁盘：不残留已处理失败事件标记",
      !(snap && snap.settings && snap.settings.alarmEventLog && snap.settings.alarmEventLog["evt-k1"]));

    const after = await reloadStatusById(h.disk);
    ok("K1 重载后：本期已完成且恰好一个有效下一期",
      after[a.id] === "archived" &&
      Object.keys(after).length === 2 &&
      Object.keys(after).filter(id => id !== a.id && after[id] !== "archived" && after[id] !== "completed").length === 1,
      JSON.stringify(after));
    const reloaded = await restartApp(h.disk);
    ok("K1 重载后：周期仍在（下一期带 repeat 规则）",
      reloaded.app.state.items.some(x => x.id !== a.id && x.repeat && x.repeat.every),
      JSON.stringify(reloaded.app.state.items.map(x => [x.status, !!(x.repeat && x.repeat.every)])));
    ok("K1 重载后：不残留已处理失败事件标记",
      reloaded.app.alarmEventSeen("evt-k1") === false);
  }

  section("K1 对照：ACK 提交成功时，完成本期不得重复派生");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "每周复盘" });
    app.state.items = [a];
    await app.saveAsync();

    await app.handleAlarmAction({ action: "ack", itemId: a.id, itemRev: a.rev });
    ok("K1 对照：ACK 成功派生出下一期", app.state.items.length === 2, "items=" + app.state.items.length);
    app.completeItem(a.id);
    ok("K1 对照：完成本期不重复派生", app.state.items.length === 2, "items=" + app.state.items.length);
    ok("K1 对照：本期已完成、下一期仍有效",
      a.status === "archived" &&
      app.state.items.filter(x => x.status !== "archived" && x.status !== "completed").length === 1);
  }

  /* ---------- M1：回滚必须「整体还原 + 重放」，不能猜字段归属 ---------- */

  const pad2 = n => String(n).padStart(2, "0");
  /** 仅用于断言失败时的可读输出（不影响判据） */
  const fmt = ts => (ts ? new Date(ts).toLocaleString("zh-CN", { hour12: false }) : String(ts));
  function localInputOf(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  section("M1 原生稍后未决时拒绝第二次稍后，失败落定后可重试");
  {
    const h = createApp();
    const app = await h.boot();
    const a = app.makeItem({
      title: "同值重复稍后", status: "due", priority: "normal", triggerAt: Date.now() - 1000
    });
    app.state.items = [a];
    await app.saveAsync(); // 基线：A=due 已落盘
    const rev0 = a.rev;

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "snooze", itemId: a.id, itemRev: rev0, alarmEventId: "evt-m1" });
    await flush(3);
    ok("M1 前置：未提交原生稍后保持隔离",
      a.status === "due" && a.scheduleBasis === "wall-clock" && a.snoozeDelayMs == null,
      "status=" + a.status + " basis=" + a.scheduleBasis + " delay=" + a.snoozeDelayMs);

    // 用户的第二次「稍后」：四小时后。status / scheduleBasis / localTrigger 与上一次**完全同值**
    const t4h = Date.now() + 4 * 3600000;
    const blocked = app.snoozeItem(a.id, t4h, "elapsed");
    ok("M1 前置：第二次稍后被明确拒绝",
      blocked === false && a.status === "due",
      "status=" + a.status + " trigger=" + a.triggerAt + " delay=" + a.snoozeDelayMs);

    h.releaseCommits(1, "fail"); // 第一笔（闹钟动作）失败
    let err = null;
    await action.catch(e => { err = e; });
    const retried = app.snoozeItem(a.id, t4h, "elapsed");
    ok("M1 失败落定后第二次稍后可重试", retried === true);
    await flush(3);
    h.releaseCommits(1, "ok");   // 第二笔（用户的稍后）成功
    h.holdCommits(false);
    await flush(3);

    ok("M1 闹钟动作提交失败如实上抛", !!err && /commit failed/.test(err.message), err && err.message);
    ok("M1 内存：第二次稍后完整保留（snoozed + elapsed + 四小时后 + 延迟）",
      a.status === "snoozed" && a.scheduleBasis === "elapsed" && a.localTrigger === null &&
      a.triggerAt === t4h && Math.abs(a.snoozeDelayMs - 4 * 3600000) <= 5,
      "status=" + a.status + " basis=" + a.scheduleBasis + " local=" + a.localTrigger +
      " trigger=" + a.triggerAt + " delay=" + a.snoozeDelayMs);
    ok("M1 内存：elapsed 三件套自洽（snoozedAt + snoozeDelayMs === triggerAt）",
      Number(a.snoozedAt) + Number(a.snoozeDelayMs) === a.triggerAt,
      "snoozedAt=" + a.snoozedAt + " delay=" + a.snoozeDelayMs + " trigger=" + a.triggerAt);
    ok("M1 内存：不残留失败动作的痕迹（事件未记台账、无确认时间）",
      app.alarmEventSeen("evt-m1") === false && !a.acknowledgedAt,
      "seen=" + app.alarmEventSeen("evt-m1") + " ackAt=" + a.acknowledgedAt);

    const snap = h.persisted();
    const diskA = (snap.items || []).find(x => x.id === a.id) || {};
    ok("M1 磁盘：第二次稍后完整保留",
      diskA.status === "snoozed" && diskA.scheduleBasis === "elapsed" &&
      Number(diskA.triggerAt) === t4h && Math.abs(Number(diskA.snoozeDelayMs) - 4 * 3600000) <= 5,
      JSON.stringify({ status: diskA.status, basis: diskA.scheduleBasis, trigger: diskA.triggerAt, delay: diskA.snoozeDelayMs }));

    const reloaded = await restartApp(h.disk);
    const rb = reloaded.app.state.items.find(x => x.id === a.id) || {};
    ok("M1 重载后：仍是 snoozed/elapsed，第二次选择的时间与延迟完整保留",
      rb.status === "snoozed" && rb.scheduleBasis === "elapsed" &&
      Number(rb.triggerAt) === t4h && Math.abs(Number(rb.snoozeDelayMs) - 4 * 3600000) <= 5,
      JSON.stringify({ status: rb.status, basis: rb.scheduleBasis, trigger: rb.triggerAt, delay: rb.snoozeDelayMs }));
    ok("M1 重载后：不残留失败动作的已处理标记",
      reloaded.app.alarmEventSeen("evt-m1") === false);
  }

  section("M1 原生稍后未决时拒绝 wall-clock 改期，失败后可重试");
  {
    const h = createApp();
    const app = await h.boot();
    const a = app.makeItem({
      title: "改按钟点稍后", status: "due", priority: "normal", triggerAt: Date.now() - 1000
    });
    app.state.items = [a];
    await app.saveAsync();
    const rev0 = a.rev;

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "snooze", itemId: a.id, itemRev: rev0, alarmEventId: "evt-m1b" });
    await flush(3);

    // 用户改用「按钟点」稍后：scheduleBasis 与第一次不同，且 triggerAt 被压到分钟精度
    const target = Date.now() + 4 * 3600000;
    const localStr = localInputOf(target);
    const expectedTs = new Date(localStr).getTime();
    const blocked = app.snoozeItem(a.id, expectedTs, "wall-clock");
    ok("M1b 前置：第二次稍后按钟点被明确拒绝",
      blocked === false && a.status === "due",
      "basis=" + a.scheduleBasis + " local=" + a.localTrigger + " delay=" + a.snoozeDelayMs);

    h.releaseCommits(1, "fail");
    let err = null;
    await action.catch(e => { err = e; });
    const retried = app.snoozeItem(a.id, expectedTs, "wall-clock");
    ok("M1b 失败落定后按钟点稍后可重试", retried === true);
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);

    ok("M1b 闹钟动作提交失败如实上抛", !!err, err && err.message);
    ok("M1b 内存：按钟点的稍后完整保留",
      a.status === "snoozed" && a.scheduleBasis === "wall-clock" &&
      a.localTrigger === localStr && a.snoozedAt === null &&
      a.snoozeDelayMs === null && a.triggerAt === expectedTs,
      JSON.stringify({ status: a.status, basis: a.scheduleBasis, local: a.localTrigger, trigger: a.triggerAt, delay: a.snoozeDelayMs }));
    ok("M1b 内存：不残留失败动作的痕迹", app.alarmEventSeen("evt-m1b") === false && !a.acknowledgedAt);

    const reloaded = await restartApp(h.disk);
    const rb = reloaded.app.state.items.find(x => x.id === a.id) || {};
    ok("M1b 重载后：仍是 snoozed/wall-clock 且按钟点重算得到同一个时刻",
      rb.status === "snoozed" && rb.scheduleBasis === "wall-clock" &&
      rb.localTrigger === localStr && Number(rb.triggerAt) === expectedTs,
      JSON.stringify({ status: rb.status, basis: rb.scheduleBasis, local: rb.localTrigger, trigger: rb.triggerAt }));
  }

  section("M1 提交在途期间拒绝同事项编辑，并保留表单供重试");
  {
    const h = createApp();
    const app = await h.boot();
    const a = app.makeItem({
      title: "原始标题", note: "", status: "due", priority: "normal", triggerAt: Date.now() - 1000
    });
    app.state.items = [a];
    await app.saveAsync();
    const rev0 = a.rev;

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "ack", itemId: a.id, itemRev: rev0, alarmEventId: "evt-m1c" });
    await flush(3);
    ok("M1c 前置：未提交 ACK 不提前进入可见状态", a.status === "due" && !a.acknowledgedAt,
      "status=" + a.status);

    // 用户在提交进行中编辑这条事项：改标题、改备注、改成按钟点的一个未来时刻
    const target = Date.now() + 5 * 3600000;
    const localStr = localInputOf(target);
    const expectedTs = new Date(localStr).getTime();
    app.markTriggerPicked(true);
    h.setField("#capText", "编辑后的标题");
    h.setField("#capNote", "编辑过");
    h.setField("#capTrigger", localStr);
    app.state.ui.editItemId = a.id;
    app.saveItemFromForm();

    ok("M1c 前置：编辑未写入事项且表单仍保留",
      a.title === "原始标题" && h.fieldOf("#capText") === "编辑后的标题" &&
      h.fieldOf("#capNote") === "编辑过" && h.fieldOf("#capTrigger") === localStr,
      JSON.stringify({ title: a.title, note: a.note, basis: a.scheduleBasis, trigger: a.triggerAt }));

    h.releaseCommits(1, "fail");
    let err = null;
    await action.catch(e => { err = e; });
    app.saveItemFromForm();
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);

    ok("M1c ACK 提交失败如实上抛", !!err, err && err.message);
    ok("M1c 编辑结果完整保留（标题 / 备注 / 钟点时间）",
      a.title === "编辑后的标题" && a.note === "编辑过" &&
      a.scheduleBasis === "wall-clock" && a.localTrigger === localStr && a.triggerAt === expectedTs,
      JSON.stringify({ title: a.title, note: a.note, basis: a.scheduleBasis, local: a.localTrigger, trigger: a.triggerAt }));
    ok("M1c 失败的 ACK 不得到处留痕（无确认时间、事件未记台账、状态按编辑结果走）",
      !a.acknowledgedAt && app.alarmEventSeen("evt-m1c") === false && a.status === "waiting",
      "ackAt=" + a.acknowledgedAt + " seen=" + app.alarmEventSeen("evt-m1c") + " status=" + a.status);

    const snap = h.persisted();
    const diskA = (snap.items || []).find(x => x.id === a.id) || {};
    ok("M1c 磁盘：编辑结果完整保留",
      diskA.title === "编辑后的标题" && diskA.scheduleBasis === "wall-clock" &&
      Number(diskA.triggerAt) === expectedTs,
      JSON.stringify({ title: diskA.title, basis: diskA.scheduleBasis, trigger: diskA.triggerAt }));

    const reloaded = await restartApp(h.disk);
    const rb = reloaded.app.state.items.find(x => x.id === a.id) || {};
    ok("M1c 重载后：编辑结果完整保留且不残留已处理失败事件标记",
      rb.title === "编辑后的标题" && rb.note === "编辑过" &&
      rb.scheduleBasis === "wall-clock" && Number(rb.triggerAt) === expectedTs &&
      reloaded.app.alarmEventSeen("evt-m1c") === false,
      JSON.stringify({ title: rb.title, basis: rb.scheduleBasis, trigger: rb.triggerAt }));
  }

  section("M1 无关事项的操作不得被重复施加（派生实例不能翻倍）");
  // 机制说明：回滚是「整体退回窗口基线 → 按原顺序重放全部用户操作」，
  // 所以无关事项的操作也会被重放一次 —— 它必须先被退回，才不会被做两遍。
  {
    const h = createApp();
    const app = await h.boot();
    const a = app.makeItem({
      title: "闹钟动作的事项", status: "due", priority: "normal", triggerAt: Date.now() - 1000
    });
    const b = repeatAckItem(app, { title: "另一条周期" });
    app.state.items = [a, b];
    await app.saveAsync();
    const rev0 = a.rev;

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "ack", itemId: a.id, itemRev: rev0, alarmEventId: "evt-m1d" });
    await flush(3);

    // 用户顺手确认了**另一条**周期事项（与这次回滚无关）
    app.ackItem(b.id);
    const bNextCount = () => app.state.items.filter(x => x.status !== "archived" && x.id !== b.id &&
      x.title === b.title).length;
    ok("M1d 前置：另一条周期事项已确认并派生一期",
      b.status === "acknowledged" && bNextCount() === 1,
      "b=" + b.status + " next=" + bNextCount());

    h.releaseCommits(1, "fail");
    let err = null;
    await action.catch(e => { err = e; });
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);

    ok("M1d 闹钟动作提交失败如实上抛", !!err, err && err.message);
    ok("M1d 无关事项的操作不得被重复施加（派生实例仍是 1 期）",
      bNextCount() === 1, "next=" + bNextCount());
    ok("M1d 被操作事项回滚到位", a.status === "due" && !a.acknowledgedAt && !app.alarmEventSeen("evt-m1d"),
      "a=" + a.status);

    const snap = h.persisted();
    const diskNext = ((snap && snap.items) || []).filter(x => x.id !== b.id && x.status !== "archived" && x.title === b.title);
    ok("M1d 磁盘：派生实例仍只有 1 期", diskNext.length === 1, "next=" + diskNext.length);
    const reloaded = await restartApp(h.disk);
    ok("M1d 重载后：派生实例仍只有 1 期",
      reloaded.app.state.items.filter(x => x.id !== b.id && x.status !== "archived" && x.title === b.title).length === 1);
  }

  /* ---------- N1：重放前必须撤销该操作首次执行的副作用 ---------- */

  section("N1 周期事项提交中拒绝 UI 确认，失败后重试只派生一期");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "周期 A" });
    app.state.items = [a];
    await app.saveAsync();
    const rev0 = a.rev;
    const baseTrigger = a.triggerAt;          // 动作前的有效时间：下一期的时刻基准
    const nexts = () => app.state.items.filter(x => x.id !== a.id);

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "snooze", itemId: a.id, itemRev: rev0, alarmEventId: "evt-n1" });
    await flush(3);
    ok("N1 前置：未提交原生稍后不污染可见状态", a.status === "due" && !a.snoozeDelayMs,
      "status=" + a.status);

    const blocked = app.ackItem(a.id);
    ok("N1 前置：UI 确认被明确拒绝", blocked === false && a.status === "due" && nexts().length === 0,
      "a=" + a.status + " next=" + nexts().length);

    h.releaseCommits(1, "fail");   // 原生稍后那笔失败
    let err = null;
    await action.catch(e => { err = e; });
    const retried = app.ackItem(a.id);
    const firstNextId = nexts()[0].id;
    const firstNextTrigger = nexts()[0].triggerAt;
    ok("N1 失败落定后 UI 确认可重试", retried === true && nexts().length === 1);
    await flush(3);
    h.releaseCommits(1, "ok");     // UI 确认的保存成功
    h.holdCommits(false);
    await flush(3);

    ok("N1 原生稍后提交失败如实上抛", !!err && /commit failed/.test(err.message), err && err.message);
    ok("N1 用户确认保留（已完成的操作不得被回滚吃掉）",
      a.status === "acknowledged" && !!a.acknowledgedAt,
      "status=" + a.status + " ackAt=" + a.acknowledgedAt);
    ok("N1 恰好一个下一期（首次执行的副作用必须已被撤销）",
      nexts().length === 1, "next=" + nexts().length + " items=" + app.state.items.length);
    ok("N1 下一期按**有效状态**计算（不得带上失败动作的时间影响）",
      nexts()[0] && new Date(nexts()[0].triggerAt).getHours() === new Date(baseTrigger).getHours() &&
      new Date(nexts()[0].triggerAt).getMinutes() === new Date(baseTrigger).getMinutes(),
      "next=" + (nexts()[0] && fmt(nexts()[0].triggerAt)) + " base=" + fmt(baseTrigger) +
      " 首次(脏)=" + fmt(firstNextTrigger));
    ok("N1 下一期沿用同一个 id（后续针对它的操作才不会失联）",
      nexts()[0] && nexts()[0].id === firstNextId, "id=" + (nexts()[0] && nexts()[0].id));
    ok("N1 失败动作不留已处理标记", app.alarmEventSeen("evt-n1") === false);
    ok("N1 失败动作的状态痕迹已清除（不再是被它改成的稍后）",
      a.snoozeDelayMs == null && a.snoozedAt == null, "delay=" + a.snoozeDelayMs);

    const reloaded = await restartApp(h.disk);
    const items = reloaded.app.state.items;
    const ra = items.find(x => x.id === a.id) || {};
    ok("N1 重载后：仍是「已确认 + 恰好一个下一期」",
      ra.status === "acknowledged" && items.filter(x => x.id !== a.id).length === 1,
      JSON.stringify({ a: ra.status, total: items.length }));
    ok("N1 重载后：下一期的时刻仍按有效状态",
      items.filter(x => x.id !== a.id).every(x =>
        new Date(x.triggerAt).getHours() === new Date(baseTrigger).getHours()),
      JSON.stringify(items.filter(x => x.id !== a.id).map(x => x.triggerAt)));
    ok("N1 重载后：不留失败动作的已处理标记",
      reloaded.app.alarmEventSeen("evt-n1") === false);
  }

  section("N1 相关事务未决时拒绝，落定后连续操作不得丢失");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "周期 A" });
    app.state.items = [a];
    await app.saveAsync();
    const rev0 = a.rev;
    const nexts = () => app.state.items.filter(x => x.id !== a.id);

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "snooze", itemId: a.id, itemRev: rev0, alarmEventId: "evt-n1b" });
    await flush(3);

    const blocked = app.ackItem(a.id);
    ok("N1b 未决时确认被拒绝且不暴露派生实例", blocked === false && nexts().length === 0);
    const target = Date.now() + 3 * 3600000;
    const localStr = localInputOf(target);
    const expectedTs = new Date(localStr).getTime();

    h.releaseCommits(1, "fail");
    let err = null;
    await action.catch(e => { err = e; });
    app.ackItem(a.id);
    const nextId = nexts()[0].id;
    app.snoozeItem(nextId, expectedTs, "wall-clock");
    ok("N1b 落定后派生实例已被连续改到 3 小时后",
      (() => { const n = app.state.items.find(x => x.id === nextId); return n && n.status === "snoozed" && n.triggerAt === expectedTs; })(),
      JSON.stringify(app.state.items.map(x => [x.id === a.id ? "A" : x.id === nextId ? "N" : "?", x.status])));
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);

    ok("N1b 提交失败如实上抛", !!err, err && err.message);
    ok("N1b 仍是恰好一个下一期", nexts().length === 1, "next=" + nexts().length);
    const n = app.state.items.find(x => x.id === nextId);
    ok("N1b 用户对派生实例的修改被保留（id 复用 + 重放命中同一个实例）",
      !!n && n.status === "snoozed" && n.scheduleBasis === "wall-clock" &&
      n.triggerAt === expectedTs && n.localTrigger === localStr,
      JSON.stringify(n && { id: n.id, status: n.status, basis: n.scheduleBasis, trigger: n.triggerAt, local: n.localTrigger }));
    ok("N1b 源事项仍是已确认", a.status === "acknowledged" && !!a.acknowledgedAt);

    const reloaded = await restartApp(h.disk);
    const rn = reloaded.app.state.items.find(x => x.id === nextId);
    ok("N1b 重载后：派生实例的修改仍在、且只有一个下一期",
      reloaded.app.state.items.filter(x => x.id !== a.id).length === 1 &&
      !!rn && rn.status === "snoozed" && Number(rn.triggerAt) === expectedTs,
      JSON.stringify(reloaded.app.state.items.map(x => [x.id === a.id ? "A" : x.id === nextId ? "N" : "?", x.status, x.triggerAt])));
  }

  section("N1 日历周期：提交中拒绝完成，落定后顺延仍锚定有效状态");
  {
    const h = createApp();
    const app = await h.boot();
    const baseTrigger = Date.now() - 1000;
    const a = app.makeItem({
      title: "每月复盘", status: "due", priority: "normal", triggerAt: baseTrigger,
      repeat: { mode: "calendar", every: "week" }
    });
    app.state.items = [a];
    await app.saveAsync();
    const rev0 = a.rev;
    const nexts = () => app.state.items.filter(x => x.id !== a.id);

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "ack", itemId: a.id, itemRev: rev0, alarmEventId: "evt-n1c" });
    await flush(3);
    ok("N1c 前置：未提交 ACK 保持隔离", a.status === "due");

    const blocked = app.completeItem(a.id);
    ok("N1c 前置：完成被明确拒绝且未派生", blocked === false && a.status === "due" && nexts().length === 0,
      "a=" + a.status + " next=" + nexts().length);

    h.releaseCommits(1, "fail");
    let err = null;
    await action.catch(e => { err = e; });
    const retried = app.completeItem(a.id);
    ok("N1c 失败落定后完成可重试", retried === true && nexts().length === 1);
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);

    ok("N1c 提交失败如实上抛", !!err, err && err.message);
    ok("N1c 完成结果保留且只派生一期",
      a.status === "archived" && !!a.completedAt && nexts().length === 1,
      "a=" + a.status + " next=" + nexts().length);
    ok("N1c 日历周期的顺延锚定原定日期（不是完成时刻，更不是失败动作改过的时间）",
      nexts()[0] && new Date(nexts()[0].triggerAt).getHours() === new Date(baseTrigger).getHours() &&
      new Date(nexts()[0].triggerAt).getMinutes() === new Date(baseTrigger).getMinutes(),
      "next=" + (nexts()[0] && fmt(nexts()[0].triggerAt)));
    ok("N1c 失败的 ACK 不留痕迹", !a.acknowledgedAt && app.alarmEventSeen("evt-n1c") === false,
      "ackAt=" + a.acknowledgedAt);

    const reloaded = await restartApp(h.disk);
    ok("N1c 重载后：本期已完成、恰好一个有效下一期",
      (() => {
        const items = reloaded.app.state.items;
        const ra = items.find(x => x.id === a.id);
        return !!ra && ra.status === "archived" && items.filter(x => x.id !== a.id).length === 1;
      })(),
      JSON.stringify(reloaded.app.state.items.map(x => [x.id === a.id ? "A" : "N", x.status])));
  }

  /* ---------- P1：全量回滚不得吃掉「未被告知」的用户写入 ---------- */

  /** 用真实新建表单入口造一条事项（与用户点「保存」同一条代码路径） */
  function createViaForm(app, h, title, triggerTs) {
    app.markTriggerPicked(true);
    h.setField("#capText", title);
    h.setField("#capTrigger", localInputOf(triggerTs));
    app.state.ui.editItemId = null;
    app.saveItemFromForm();
  }

  /** 用真实编辑表单入口改一条事项 */
  function editViaForm(app, h, itemId, fields) {
    app.markTriggerPicked(true);
    h.setField("#capText", fields.title);
    h.setField("#capNote", fields.note || "");
    h.setField("#capTrigger", localInputOf(fields.triggerAt));
    app.state.ui.editItemId = itemId;
    app.saveItemFromForm();
  }

  section("P1-A 保存期间用真实表单新建的事项，回滚不得删掉");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "周期 A" });
    app.state.items = [a];
    await app.saveAsync();
    const rev0 = a.rev;

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "snooze", itemId: a.id, itemRev: rev0, alarmEventId: "evt-p1a" });
    await flush(3);

    const target = Date.now() + 6 * 3600000;
    const localStr = localInputOf(target);
    const expectedTs = new Date(localStr).getTime();
    createViaForm(app, h, "提交材料", target);
    const created = app.state.items.find(x => x.title === "提交材料");
    ok("P1-A 前置：真实表单新建成功", !!created && created.status === "waiting" && created.triggerAt === expectedTs,
      JSON.stringify(created && { status: created.status, trigger: created.triggerAt }));
    const createdId = created && created.id;

    h.releaseCommits(1, "fail");
    let err = null;
    await action.catch(e => { err = e; });
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);

    ok("P1-A 失败动作如实上抛", !!err, err && err.message);
    ok("P1-A 新建的事项仍在（内存）",
      !!app.state.items.find(x => x.id === createdId && x.title === "提交材料" && x.triggerAt === expectedTs),
      JSON.stringify(app.state.items.map(x => [x.title, x.status])));
    ok("P1-A 失败动作自身被撤销（不残留稍后）", a.status === "due" && a.snoozeDelayMs == null,
      "a=" + a.status);

    const snap = h.persisted();
    ok("P1-A 新建的事项已落库",
      ((snap && snap.items) || []).some(x => x.id === createdId && x.title === "提交材料" && Number(x.triggerAt) === expectedTs),
      JSON.stringify(((snap && snap.items) || []).map(x => x.title)));

    const reloaded = await restartApp(h.disk);
    const r = reloaded.app.state.items.find(x => x.id === createdId);
    ok("P1-A 重载后：新建的事项完整保留（标题 / 时间）",
      !!r && r.title === "提交材料" && Number(r.triggerAt) === expectedTs,
      JSON.stringify(reloaded.app.state.items.map(x => [x.title, x.status, x.triggerAt])));
  }

  section("P1-A 期间连续新建两条，都不得丢");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "周期 A" });
    app.state.items = [a];
    await app.saveAsync();

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "snooze", itemId: a.id, itemRev: a.rev, alarmEventId: "evt-p1a2" });
    await flush(3);

    const t1 = Date.now() + 6 * 3600000;
    const t2 = Date.now() + 8 * 3600000;
    createViaForm(app, h, "第一条", t1);
    createViaForm(app, h, "第二条", t2);
    const id1 = (app.state.items.find(x => x.title === "第一条") || {}).id;
    const id2 = (app.state.items.find(x => x.title === "第二条") || {}).id;
    ok("P1-A2 前置：两条都已建立且 id 不同", !!id1 && !!id2 && id1 !== id2, "id1=" + id1 + " id2=" + id2);

    h.releaseCommits(1, "fail");
    await action.catch(() => {});
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);

    const kept = app.state.items.filter(x => x.id === id1 || x.id === id2);
    ok("P1-A2 两条新建都保留且各只有一条", kept.length === 2, "kept=" + kept.length);
    const k0 = kept[0] || {};
    const k1 = kept[1] || {};
    ok("P1-A2 顺序与时间都保持", k0.title === "第一条" && k1.title === "第二条" &&
      k0.triggerAt === new Date(localInputOf(t1)).getTime(),
      JSON.stringify(kept.map(x => [x.title, x.triggerAt])));

    const reloaded = await restartApp(h.disk);
    ok("P1-A2 重载后：两条都在",
      reloaded.app.state.items.filter(x => x.id === id1 || x.id === id2).length === 2,
      JSON.stringify(reloaded.app.state.items.map(x => x.title)));
  }

  section("P1-A 期间新建后再编辑 / 再删除，结果都要保住");
  {
    // 新建 → 编辑
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "周期 A" });
    app.state.items = [a];
    await app.saveAsync();
    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "snooze", itemId: a.id, itemRev: a.rev, alarmEventId: "evt-p1a3" });
    await flush(3);
    const t1 = Date.now() + 6 * 3600000;
    createViaForm(app, h, "待改标题", t1);
    const id1 = (app.state.items.find(x => x.title === "待改标题") || {}).id;
    const t2 = Date.now() + 7 * 3600000;
    const t2local = localInputOf(t2);
    editViaForm(app, h, id1, { title: "改过的标题", note: "改过的备注", triggerAt: t2 });
    ok("P1-A3 前置：编辑已生效",
      (() => { const x = app.state.items.find(y => y.id === id1); return x && x.title === "改过的标题" && x.note === "改过的备注"; })(),
      JSON.stringify(app.state.items.map(x => [x.title, x.note])));

    h.releaseCommits(1, "fail");
    await action.catch(() => {});
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);

    const after = app.state.items.filter(x => x.id === id1);
    const a0 = after[0] || {};
    ok("P1-A3 新建后编辑：不重复、且保留编辑结果",
      after.length === 1 && a0.title === "改过的标题" && a0.note === "改过的备注" &&
      a0.triggerAt === new Date(t2local).getTime(),
      JSON.stringify(after.map(x => [x.title, x.note, x.triggerAt])));
    const reloaded = await restartApp(h.disk);
    const r = reloaded.app.state.items.find(x => x.id === id1);
    ok("P1-A3 重载后：编辑结果仍在",
      !!r && r.title === "改过的标题" && r.note === "改过的备注",
      JSON.stringify(r && [r.title, r.note]));

    // 新建 → 删除
    const h2 = createApp();
    const app2 = await h2.boot();
    const b = repeatAckItem(app2, { title: "周期 B" });
    app2.state.items = [b];
    await app2.saveAsync();
    h2.holdCommits(true);
    h2.setCommitFailure(true);
    const action2 = app2.handleAlarmAction({ action: "snooze", itemId: b.id, itemRev: b.rev, alarmEventId: "evt-p1a4" });
    await flush(3);
    createViaForm(app2, h2, "建了就删", Date.now() + 6 * 3600000);
    const id2 = (app2.state.items.find(x => x.title === "建了就删") || {}).id;
    app2.deleteItem(id2);
    ok("P1-A4 前置：新建后删除已生效", !app2.state.items.some(x => x.id === id2));

    h2.releaseCommits(1, "fail");
    await action2.catch(() => {});
    await flush(3);
    h2.releaseCommits(1, "ok");
    h2.holdCommits(false);
    await flush(3);

    ok("P1-A4 用户的删除被保留（不得复活）",
      !app2.state.items.some(x => x.id === id2) && !app2.state.items.some(x => x.title === "建了就删"),
      JSON.stringify(app2.state.items.map(x => x.title)));
    const reloaded2 = await restartApp(h2.disk);
    ok("P1-A4 重载后：仍然没有那条",
      !reloaded2.app.state.items.some(x => x.id === id2 || x.title === "建了就删"),
      JSON.stringify(reloaded2.app.state.items.map(x => x.title)));
  }

  section("P1-B 未决时不暴露派生实例，失败落定后可派生并编辑");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "周期 A" });
    app.state.items = [a];
    await app.saveAsync();
    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "snooze", itemId: a.id, itemRev: a.rev, alarmEventId: "evt-p1b" });
    await flush(3);

    ok("P1-B 前置：同事项确认被拒绝且派生实例不可见",
      app.ackItem(a.id) === false && app.state.items.length === 1);

    h.releaseCommits(1, "fail");
    let err = null;
    await action.catch(e => { err = e; });
    app.ackItem(a.id);
    const n = app.state.items.find(x => x.id !== a.id);
    const nextId = n.id;
    const nextTrigger = n.triggerAt;
    editViaForm(app, h, nextId, { title: "下一期已修改标题", note: "编辑过的备注", triggerAt: nextTrigger });
    ok("P1-B 落定后派生实例的编辑已生效",
      (() => { const x = app.state.items.find(y => y.id === nextId); return x && x.title === "下一期已修改标题"; })(),
      JSON.stringify(app.state.items.map(x => [x.id === a.id ? "A" : "N", x.title])));
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);

    ok("P1-B 失败动作如实上抛", !!err, err && err.message);
    ok("P1-B 仍只有一个下一期且 id 不变",
      app.state.items.filter(x => x.id !== a.id).length === 1 && !!app.state.items.find(x => x.id === nextId),
      JSON.stringify(app.state.items.map(x => [x.id === a.id ? "A" : "N", x.status])));
    const kept = app.state.items.find(x => x.id === nextId);
    ok("P1-B 用户在派生实例上的编辑被保留（不得写到已被替换的旧对象上）",
      !!kept && kept.title === "下一期已修改标题" && kept.note === "编辑过的备注",
      JSON.stringify(kept && [kept.title, kept.note]));

    const reloaded = await restartApp(h.disk);
    const r = reloaded.app.state.items.find(x => x.id === nextId);
    ok("P1-B 重载后：编辑仍在",
      !!r && r.title === "下一期已修改标题" && r.note === "编辑过的备注",
      JSON.stringify(r && [r.title, r.note]));
  }

  section("P1-B 落定后派生 → 编辑 → 再稍后，三件事都要保住");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "周期 A" });
    app.state.items = [a];
    await app.saveAsync();
    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "snooze", itemId: a.id, itemRev: a.rev, alarmEventId: "evt-p1b2" });
    await flush(3);

    const later = Date.now() + 9 * 3600000;
    const laterLocal = localInputOf(later);
    ok("P1-B2 前置：同事项确认被拒绝", app.ackItem(a.id) === false);

    h.releaseCommits(1, "fail");
    await action.catch(() => {});
    app.ackItem(a.id);
    const nextId = app.state.items.find(x => x.id !== a.id).id;
    editViaForm(app, h, nextId, { title: "改过的下一期", note: "备注", triggerAt: Date.now() + 5 * 3600000 });
    app.snoozeItem(nextId, new Date(laterLocal).getTime(), "wall-clock");
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);

    const kept = app.state.items.filter(x => x.id !== a.id);
    const b0 = kept[0] || {};
    ok("P1-B2 只有一个下一期", kept.length === 1, "next=" + kept.length);
    ok("P1-B2 编辑与稍后都被保留（id 复用 + 按 id 重放）",
      b0.id === nextId && b0.title === "改过的下一期" && b0.note === "备注" &&
      b0.status === "snoozed" && b0.scheduleBasis === "wall-clock" &&
      Number(b0.triggerAt) === new Date(laterLocal).getTime(),
      JSON.stringify([b0.title, b0.note, b0.status, b0.triggerAt]));
    const reloaded = await restartApp(h.disk);
    const r = reloaded.app.state.items.find(x => x.id === nextId);
    ok("P1-B2 重载后：编辑与稍后都还在",
      !!r && r.title === "改过的下一期" && r.status === "snoozed" && Number(r.triggerAt) === new Date(laterLocal).getTime(),
      JSON.stringify(r && [r.title, r.status, r.triggerAt]));
  }

  section("P1 兜底：没有被记进日志的用户写入一律保留（fail-safe）");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "周期 A" });
    const c = app.makeItem({ title: "无关事项", status: "waiting", priority: "normal", triggerAt: Date.now() + 3600000 });
    app.state.items = [a, c];
    await app.saveAsync();

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "snooze", itemId: a.id, itemRev: a.rev, alarmEventId: "evt-p1c" });
    await flush(3);

    // 模拟「未纳入日志的写入」：直接新建 + 直接改字段（比如以后新加的入口、外部同步）
    const orphan = app.makeItem({ title: "外部写入的新建", status: "waiting", priority: "normal", triggerAt: Date.now() + 7200000 });
    app.state.items.push(orphan);
    c.note = "外部写入的修改";

    h.releaseCommits(1, "fail");
    await action.catch(() => {});
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);

    ok("P1 兜底：未记录的新建被保留（宁可留下也不能静默删掉）",
      app.state.items.some(x => x.id === orphan.id && x.title === "外部写入的新建"),
      JSON.stringify(app.state.items.map(x => x.title)));
    ok("P1 兜底：未被重放改写的既有事项保持原样（不拿旧快照覆盖）",
      c.note === "外部写入的修改", "note=" + c.note);
    ok("P1 兜底：动作自身仍被正确撤销", a.status === "due" && app.alarmEventSeen("evt-p1c") === false,
      "a=" + a.status);
  }

  /* ---------- Q1：删除是「操作顺序里的一步」，不能提前到更早的操作之前 ---------- */

  section("Q1 提交中拒绝 ACK/删除，落定后按顺序执行不得误删下一期");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "周期 A" });
    app.state.items = [a];
    await app.saveAsync();
    const aId = a.id;
    const baseTrigger = a.triggerAt;
    const nexts = () => app.state.items.filter(x => x.id !== aId);

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "snooze", itemId: aId, itemRev: a.rev, alarmEventId: "evt-q1" });
    await flush(3);

    const blockedAck = app.ackItem(aId);
    const blockedDelete = app.deleteItem(aId);
    ok("Q1 前置：同事项 ACK 与删除均被拒绝",
      blockedAck === false && blockedDelete === false && app.state.items.some(x => x.id === aId) && nexts().length === 0,
      JSON.stringify(app.state.items.map(x => [x.id === aId ? "A" : "N", x.status])));

    h.releaseCommits(1, "fail");
    let err = null;
    await action.catch(e => { err = e; });
    app.ackItem(aId);
    const nextId = nexts()[0].id;
    app.deleteItem(aId);
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);

    ok("Q1 失败动作如实上抛", !!err, err && err.message);
    ok("Q1 用户的删除仍然生效（本期不得复活）",
      !app.state.items.some(x => x.id === aId),
      JSON.stringify(app.state.items.map(x => [x.id === aId ? "A" : "N", x.status])));
    ok("Q1 恰好保留一条下一期（更早的 ACK 必须在删除之前被重放）",
      nexts().length === 1, "next=" + nexts().length + " items=" + app.state.items.length);
    ok("Q1 下一期按**有效状态**计算（不带失败动作的时间位移）",
      nexts()[0] && new Date(nexts()[0].triggerAt).getHours() === new Date(baseTrigger).getHours() &&
      new Date(nexts()[0].triggerAt).getMinutes() === new Date(baseTrigger).getMinutes(),
      "next=" + fmt(nexts()[0] && nexts()[0].triggerAt) + " base=" + fmt(baseTrigger));
    ok("Q1 失败动作不留已处理标记", app.alarmEventSeen("evt-q1") === false);

    const snap = h.persisted();
    const diskItems = (snap && snap.items) || [];
    ok("Q1 磁盘：本期已删、恰一条下一期",
      !diskItems.some(x => x.id === aId) && diskItems.length === 1,
      JSON.stringify(diskItems.map(x => [x.id === aId ? "A" : "N", x.status])));

    const reloaded = await restartApp(h.disk);
    const rItems = reloaded.app.state.items;
    ok("Q1 重载后：本期已删、恰一条下一期且时刻仍按有效状态",
      !rItems.some(x => x.id === aId) &&
      rItems.filter(x => x.id !== aId).length === 1 &&
      rItems.every(x => new Date(x.triggerAt).getHours() === new Date(baseTrigger).getHours()),
      JSON.stringify(rItems.map(x => [x.id === aId ? "A" : "N", x.status, x.triggerAt])));
    ok("Q1 重载后：不留失败动作的已处理标记", reloaded.app.alarmEventSeen("evt-q1") === false);
  }

  section("Q1 提交中拒绝完成/删除，落定后顺延仍要保住");
  {
    const h = createApp();
    const app = await h.boot();
    const baseTrigger = Date.now() - 1000;
    const a = app.makeItem({
      title: "每周复盘", status: "due", priority: "normal", triggerAt: baseTrigger,
      repeat: { mode: "calendar", every: "week" }
    });
    app.state.items = [a];
    await app.saveAsync();
    const aId = a.id;
    const nexts = () => app.state.items.filter(x => x.id !== aId);

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "ack", itemId: aId, itemRev: a.rev, alarmEventId: "evt-q1b" });
    await flush(3);

    const blockedComplete = app.completeItem(aId);
    const blockedDelete = app.deleteItem(aId);
    ok("Q1b 前置：完成与删除均被拒绝",
      blockedComplete === false && blockedDelete === false && app.state.items.some(x => x.id === aId) && nexts().length === 0,
      "items=" + app.state.items.length);

    h.releaseCommits(1, "fail");
    await action.catch(() => {});
    app.completeItem(aId);
    const derived = nexts().length;
    app.deleteItem(aId);
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);

    ok("Q1b 本期保持已删、恰一条下一期",
      !app.state.items.some(x => x.id === aId) && nexts().length === 1,
      JSON.stringify(app.state.items.map(x => [x.id === aId ? "A" : "N", x.status])));
    ok("Q1b 顺延仍锚定原定日期",
      nexts()[0] && new Date(nexts()[0].triggerAt).getHours() === new Date(baseTrigger).getHours() &&
      new Date(nexts()[0].triggerAt).getMinutes() === new Date(baseTrigger).getMinutes(),
      "next=" + fmt(nexts()[0] && nexts()[0].triggerAt));

    const reloaded = await restartApp(h.disk);
    ok("Q1b 重载后：本期已删、恰一条下一期",
      !reloaded.app.state.items.some(x => x.id === aId) &&
      reloaded.app.state.items.filter(x => x.id !== aId).length === 1,
      JSON.stringify(reloaded.app.state.items.map(x => [x.id === aId ? "A" : "N", x.status])));
  }

  section("Q1 提交中拒绝编辑/删除，落定后执行仍不留残影");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "周期 A" });
    app.state.items = [a];
    await app.saveAsync();
    const aId = a.id;

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "snooze", itemId: aId, itemRev: a.rev, alarmEventId: "evt-q1c" });
    await flush(3);

    editViaForm(app, h, aId, { title: "改过又删掉", note: "备注", triggerAt: Date.now() + 5 * 3600000 });
    const blockedDelete = app.deleteItem(aId);
    ok("Q1c 前置：编辑与删除均未改变事项", blockedDelete === false && app.state.items.some(x => x.id === aId));

    h.releaseCommits(1, "fail");
    await action.catch(() => {});
    editViaForm(app, h, aId, { title: "改过又删掉", note: "备注", triggerAt: Date.now() + 5 * 3600000 });
    app.deleteItem(aId);
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);

    ok("Q1c 最终仍是已删除（不得因「更早的编辑要重放」而复活）",
      !app.state.items.some(x => x.id === aId) && app.state.items.length === 0,
      JSON.stringify(app.state.items.map(x => [x.title, x.status])));

    const reloaded = await restartApp(h.disk);
    ok("Q1c 重载后：仍然没有它",
      !reloaded.app.state.items.some(x => x.id === aId) && reloaded.app.state.items.length === 0,
      JSON.stringify(reloaded.app.state.items.map(x => [x.title, x.status])));
  }

  section("Q1 未决时不暴露派生项，落定后删除派生项不得恢复");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "周期 A" });
    app.state.items = [a];
    await app.saveAsync();
    const aId = a.id;

    h.holdCommits(true);
    h.setCommitFailure(true);
    const action = app.handleAlarmAction({ action: "snooze", itemId: aId, itemRev: a.rev, alarmEventId: "evt-q1d" });
    await flush(3);

    ok("Q1d 前置：确认被拒绝且下一期不可见", app.ackItem(aId) === false && app.state.items.length === 1);

    h.releaseCommits(1, "fail");
    await action.catch(() => {});
    app.ackItem(aId);
    const nextId = app.state.items.find(x => x.id !== aId).id;
    app.deleteItem(nextId); // 用户删的是落定后派生出来的那一期
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);

    const live = app.state.items.find(x => x.id === aId);
    ok("Q1d 本期的确认保留", !!live && live.status === "acknowledged", JSON.stringify(live && live.status));
    ok("Q1d 用户删掉的下一期不得被恢复", !app.state.items.some(x => x.id === nextId),
      JSON.stringify(app.state.items.map(x => [x.id === aId ? "A" : "N", x.status])));

    const reloaded = await restartApp(h.disk);
    ok("Q1d 重载后：本期已确认、下一期仍是删除状态",
      reloaded.app.state.items.length === 1 &&
      reloaded.app.state.items[0].id === aId &&
      reloaded.app.state.items[0].status === "acknowledged",
      JSON.stringify(reloaded.app.state.items.map(x => [x.id === aId ? "A" : "N", x.status])));
  }

  section("隐藏闹钟：完成必须提交成功，旧提醒与截止保护不能误处理");
  {
    const h = createApp(); const app = await h.boot();
    const it = app.makeItem({ title: "隐藏闹钟完成", status: "due", triggerAt: Date.now()-1000, rev: 1 });
    app.state.items = [it]; await app.saveAsync();
    const env = installCapacitor(); const stopped = [];
    global.Capacitor.Plugins.SystemBridge.stopAlarmDelivery = async x => { stopped.push(x); return { stopped: true }; };
    const alarm = { id: 8123, token: "8123:save-test", itemId: it.id, itemRev: 1 };
    h.holdCommits(true);
    let failure = null;
    const action = app.completeActiveAlarm(alarm).catch(e => { failure = e; });
    await flush(3);
    ok("完成提交前仍保留原状态与停止入口", it.status === "due" && stopped.length === 0);
    h.releaseCommits(1, "fail"); await action; h.holdCommits(false);
    ok("完成落库失败不得止响或假归档", !!failure && stopped.length === 0 && it.status === "due");
    h.releaseCommits(0, "ok");
    await app.completeActiveAlarm(alarm);
    ok("重试提交成功后才停止对应投递", h.persistedStatusOf(it.id) === "archived" && stopped.length === 1 && stopped[0].token === alarm.token);
    env.cleanup();
  }
  {
    const h = createApp(); const app = await h.boot();
    const it = app.makeItem({ title: "已改期事项", status: "waiting", triggerAt: Date.now()+60000, rev: 2 });
    app.state.items = [it]; await app.saveAsync();
    const env = installCapacitor(); let stops = 0;
    global.Capacitor.Plugins.SystemBridge.stopAlarmDelivery = async () => { stops++; };
    let failure = null;
    await app.completeActiveAlarm({ id: 8124, token: "8124:stale", itemId: it.id, itemRev: 1 }).catch(e => { failure = e; });
    ok("旧投递不能完成新版事项", !!failure && it.status === "waiting" && stops === 0 && h.persistedStatusOf(it.id) === "waiting");
    ok("已确认事项的同版本截止保护保持可处理", !app.deliveryHandledByCommittedItem({ itemRev: 2 }, { status: "acknowledged", rev: 2 }));
    ok("稍后事项的同版本截止保护保持可处理", !app.deliveryHandledByCommittedItem({ itemRev: 2 }, { status: "snoozed", rev: 2 }));
    ok("已提交的新确认只清理旧版本投递", app.deliveryHandledByCommittedItem({ itemRev: 1 }, { status: "acknowledged", rev: 2 }));
    env.cleanup();
  }

  /* ---------- T1：隔离草稿与稳定依赖身份 ---------- */
  section("T1 原生 ACK 派生实例在创建提交确认前不可见、确认后可安全修改");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "T1 周期 A" });
    app.state.items = [a];
    await app.saveAsync();

    h.holdCommits(true);
    const action = app.handleAlarmAction({
      action: "ack", itemId: a.id, itemRev: a.rev, alarmEventId: "evt-t1-success"
    });
    await flush(3);
    ok("T1 创建提交确认前：源事项仍是最后确认状态", a.status === "due" && !a.ackAdvancedAt);
    ok("T1 创建提交确认前：下一期不暴露给 UI，不能接受依赖编辑", app.state.items.length === 1);

    h.releaseCommits(1, "ok");
    await action;
    const n = app.state.items.find(x => x.id !== a.id);
    ok("T1 创建提交确认后：下一期才发布", !!n && a.status === "acknowledged");
    ok("T1 下一期带稳定父实例身份", !!n && n.repeatParentId === a.id,
      JSON.stringify(n && { id: n.id, repeatParentId: n.repeatParentId }));

    const chosen = Date.now() + 3 * 3600000;
    app.snoozeItem(n.id, chosen, "elapsed");
    await flush(3);
    h.releaseCommits(1, "ok");
    h.holdCommits(false);
    await flush(3);
    const reloaded = await restartApp(h.disk);
    const rn = reloaded.app.state.items.find(x => x.id === n.id);
    ok("T1 确认后接受的稍后完整落库并可重载", !!rn && rn.status === "snoozed" &&
      rn.triggerAt === chosen && rn.repeatParentId === a.id,
      JSON.stringify(rn && [rn.status, rn.triggerAt, rn.repeatParentId]));
    ok("T1 全程只有一个下一期", reloaded.app.state.items.filter(x => x.repeatParentId === a.id).length === 1);
  }

  section("T1 对照：创建提交失败时不发布幽灵下一期");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "T1 失败对照" });
    app.state.items = [a];
    await app.saveAsync();
    h.holdCommits(true);
    const action = app.handleAlarmAction({
      action: "ack", itemId: a.id, itemRev: a.rev, alarmEventId: "evt-t1-fail"
    });
    await flush(3);
    h.releaseCommits(1, "fail");
    let failure = null;
    await action.catch(error => { failure = error; });
    h.holdCommits(false);
    ok("T1 失败如实返回 Promise 拒绝", !!failure);
    ok("T1 失败后内存没有下一期或假 ACK", app.state.items.length === 1 && a.status === "due");
    ok("T1 失败事件不进入已处理台账", app.alarmEventSeen("evt-t1-fail") === false);
    const reloaded = await restartApp(h.disk);
    ok("T1 失败后重载仍无幽灵下一期", reloaded.app.state.items.length === 1 &&
      reloaded.app.state.items[0].status === "due");
  }

  section("U2 同周期串行化与多步操作：相关项拒绝、无关项继续");
  {
    const h = createApp();
    const app = await h.boot();
    const a = repeatAckItem(app, { title: "周期源事项" });
    const child = app.makeItem({
      title: "同周期未来事项",
      status: "waiting",
      priority: "normal",
      triggerAt: Date.now() + 7 * 86400000,
      repeat: { mode: "ack", every: "week" },
      seriesId: a.seriesId,
      repeatParentId: a.id
    });
    const other = app.makeItem({
      title: "无关事项", status: "due", priority: "normal", triggerAt: Date.now() - 1000
    });
    app.state.items = [a, child, other];
    await app.saveAsync();
    const childBefore = JSON.stringify(child);

    h.holdCommits(true);
    const action = app.handleAlarmAction({
      action: "snooze", itemId: a.id, itemRev: a.rev, alarmEventId: "evt-u2-series"
    });
    await flush(3);

    const first = app.ackItem(a.id);
    const second = app.stopRepeat(child.id);
    const third = app.snoozeItem(child.id, Date.now() + 3 * 3600000, "elapsed");
    const unrelated = app.completeItem(other.id);
    ok("U2 连续三个同事项/同周期命令都被拒绝", first === false && second === false && third === false);
    ok("U2 同周期未来事项保持原样", JSON.stringify(child) === childBefore);
    ok("U2 无关事项命令继续执行", unrelated === true && other.status === "archived");

    h.releaseCommits(1, "ok");
    await action;
    await flush(3);
    h.releaseCommits(undefined, "ok");
    h.holdCommits(false);
    await flush(4);

    ok("U2 原生稍后成功且同周期项未被误改",
      a.status === "snoozed" && child.status === "waiting" && child.repeat && child.repeat.every === "week");
    const reloaded = await restartApp(h.disk);
    const byId = id => reloaded.app.state.items.find(x => x.id === id) || {};
    ok("U2 多步结果经权威存储与重启保持一致",
      byId(a.id).status === "snoozed" && byId(child.id).status === "waiting" && byId(other.id).status === "archived");
  }

  section("U2 36 组合矩阵：原生动作 × 同事项 UI 命令 × 原生成败");
  {
    const nativeActions = ["ack", "snooze", "done"];
    const uiCommands = ["ack", "complete", "snooze", "edit", "delete", "stopRepeat"];
    const cases = [];
    nativeActions.forEach(nativeAction => {
      uiCommands.forEach(uiCommand => {
        [false, true].forEach(fail => cases.push({ native: nativeAction, ui: uiCommand, fail }));
      });
    });
    ok("U2 矩阵恰好覆盖 36 种组合", cases.length === 36, "cases=" + cases.length);
    for (const tc of cases) {
      const h = createApp();
      const app = await h.boot();
      const a = app.makeItem({
        title: "矩阵-" + tc.native + "-" + tc.ui + "-" + (tc.fail ? "fail" : "ok"),
        status: "due",
        priority: "normal",
        triggerAt: 1790000000000,
        repeat: { mode: "ack", every: "week" }
      });
      app.state.items = [a];
      await app.saveAsync();
      const eventId = "evt-u1-" + tc.native + "-" + tc.ui + "-" + (tc.fail ? "fail" : "ok");
      const before = JSON.stringify(a);

      h.holdCommits(true);
      const action = app.handleAlarmAction({ action: tc.native, itemId: a.id, itemRev: a.rev, alarmEventId: eventId });
      await flush(3);
      let applied;
      if (tc.ui === "complete") applied = app.completeItem(a.id);
      else if (tc.ui === "ack") applied = app.ackItem(a.id);
      else if (tc.ui === "snooze") applied = app.snoozeItem(a.id, 1790003600000, "elapsed");
      else if (tc.ui === "delete") applied = app.deleteItem(a.id);
      else if (tc.ui === "stopRepeat") applied = app.stopRepeat(a.id);
      else if (tc.ui === "edit") {
        app.markTriggerPicked(true);
        h.setField("#capText", "矩阵编辑值");
        h.setField("#capNote", "矩阵编辑备注");
        h.setField("#capTrigger", localInputOf(1790007200000));
        app.state.ui.editItemId = a.id;
        applied = app.saveItemFromForm();
      }

      const label = tc.native + "×" + tc.ui + "×" + (tc.fail ? "失败" : "成功");
      ok("U2 " + label + "：UI 命令明确返回 false", applied === false);
      ok("U2 " + label + "：拒绝期间内存保持最后确认状态",
        JSON.stringify(a) === before && app.state.items.length === 1,
        JSON.stringify(app.state.items.map(x => [x.status, x.title])));
      ok("U2 " + label + "：拒绝反馈不是成功提示",
        /正在保存/.test(h.textOf("#toastText")) && !/已完成|已删除|已保存修改|已改到/.test(h.textOf("#toastText")),
        h.textOf("#toastText"));
      if (tc.ui === "edit") {
        ok("U2 " + label + "：编辑输入保留供重试",
          h.fieldOf("#capText") === "矩阵编辑值" && h.fieldOf("#capNote") === "矩阵编辑备注");
      }

      h.releaseCommits(1, tc.fail ? "fail" : "ok");
      let actionError = null;
      await action.catch(error => { actionError = error; });
      h.holdCommits(false);
      await flush(4);

      const expectedStatuses = tc.fail
        ? ["due"]
        : (tc.native === "ack"
          ? ["acknowledged", "waiting"]
          : tc.native === "snooze" ? ["snoozed"] : ["archived", "waiting"]);
      expectedStatuses.sort();
      const memoryStatuses = app.state.items.map(x => x.status).sort();
      const persisted = h.persisted() || { items: [], settings: {} };
      const diskStatuses = (persisted.items || []).map(x => x.status).sort();
      const reloaded = await restartApp(h.disk);
      const reloadStatuses = reloaded.app.state.items.map(x => x.status).sort();
      ok("U2 " + label + "：原生成败如实向外返回", tc.fail ? !!actionError : !actionError,
        actionError && actionError.message);
      ok("U2 " + label + "：内存只包含原生事务结果", JSON.stringify(memoryStatuses) === JSON.stringify(expectedStatuses),
        JSON.stringify(memoryStatuses));
      ok("U2 " + label + "：权威快照与内存一致", JSON.stringify(diskStatuses) === JSON.stringify(expectedStatuses),
        JSON.stringify(diskStatuses));
      ok("U2 " + label + "：重载与内存/权威快照一致", JSON.stringify(reloadStatuses) === JSON.stringify(expectedStatuses),
        JSON.stringify(reloadStatuses));
      ok("U2 " + label + "：事件台账只记录成功原生动作", reloaded.app.alarmEventSeen(eventId) === !tc.fail);
      const childIds = reloaded.app.state.items.filter(x => x.repeatParentId === a.id).map(x => x.id);
      ok("U2 " + label + "：同一父实例无重复派生", new Set(childIds).size === childIds.length && childIds.length <= 1,
        JSON.stringify(childIds));
    }
  }

  /* ---------- G5：初始化竞态 ---------- */
  section("G5 初始化完成信号必须真正代表「状态已恢复」");
  {
    // 先造一份已落库的数据，作为「上次运行」的现场
    const seed = {
      schema: 4,
      items: [{
        id: "persisted-1", title: "上次留下的事项", status: "waiting", priority: "normal",
        triggerAt: Date.now() + 3600000, rev: 1, scheduleBasis: "wall-clock",
        tags: [], repeat: null, dismissedUntil: null, review_status: "READY"
      }],
      notes: [],
      projects: [],
      settings: { notify: true, dnd: true, quietStart: "23:00", quietEnd: "07:30" }
    };

    const h = createApp({ seedState: seed });
    await h.app.ready();
    ok("G5 ready 之后持久化状态已完整恢复",
      h.app.state.items.length === 1 && h.app.state.items[0].id === "persisted-1",
      JSON.stringify(h.app.state.items.map(x => x.id)));

    // 就绪之后再准备状态，不得被初始化覆盖
    const mine = h.app.makeItem({ title: "测试准备", status: "due", triggerAt: Date.now() - 1000 });
    h.app.state.items = [mine];
    await flush(4);
    ok("G5 就绪后准备的状态不会被初始化恢复覆盖",
      h.app.state.items.length === 1 && h.app.state.items[0].id === mine.id,
      JSON.stringify(h.app.state.items.map(x => x.id)));

    // 反例（根因留证）：不等就绪直接改 state —— 会被 loadAsync → applyParsedState 冲掉
    const h2 = createApp({ seedState: seed });
    const orphan = h2.app.makeItem({ title: "抢跑写入", status: "due", triggerAt: Date.now() - 1000 });
    h2.app.state.items = [orphan];
    await flush(4);
    ok("G5 反例：不等就绪时准备的 state 会被初始化恢复覆盖（证明必须先等）",
      !!h2.app.state.items[0] && h2.app.state.items[0].id !== orphan.id,
      JSON.stringify(h2.app.state.items.map(x => x.id)));
  }

/* ----------------------------------------------------------------- *
 * Q1：启动链完整性 —— `addListener` 的返回契约
 *
 * 真机（Android）：插件方法由原生 `JSExport.getPluginJS()` 注入 ——
 *     t.addListener = function (eventName, callback) {
 *       return w.Capacitor.addListener('<pluginId>', eventName, callback);
 *     }
 * 而 `native-bridge.js` 的 `cap.addListener` **同步 return 一个 `{ remove }` 普通对象**，
 * 它没有 `.then` / `.catch`。（官方 `@capacitor/core` 的 `capacitor.js` 确实返回 Promise
 * 并把 `.remove` 挂在上面，但本仓库没有打包器，那条路径在真机上根本不存在。）
 *
 * 所以 `lib/native-reminders.js` 里的 `addListener(...).catch(...)` 在真机上抛
 * `TypeError: app.addListener(...).catch is not a function`；又因为 `onAlarmAction()`
 * 是同步函数，异常会直接冒泡出 `init()`，使第 5129 行之后的 seed / render / 15 秒心跳
 * 全部不执行 —— 而且不崩溃、不弹错，界面照常可点。
 *
 * 此前 854 项测试全绿却漏掉它，有两个叠加原因，本用例同时堵住：
 *   ① 没有任何测试调用过 `onAlarmAction()`（那段注册代码在测试里是死代码）；
 *   ② 平台 mock 的 `addListener` 写成 `async`，契约比真机宽松。
 * 下面的断言先证「注册真的被调用到了」，避免用例自己在空转。
 *
 * 平台用**宿主** `global.Capacitor` 复刻：`lib/native-reminders.js` 是在 createApp 里被
 * require 进来的，它的闭包 root 是宿主 globalThis，所以它读的平台就是宿主 global。
 * ----------------------------------------------------------------- */
section("Q1. 启动链完整性 / addListener 返回契约");
{
  const withPlatform = async (addListenerImpl) => {
    const calls = { appListener: 0, bridgeListener: 0 };
    const record = which => (...args) => { calls[which]++; return addListenerImpl(...args); };
    global.Capacitor = {
      // 刻意返回 "web"：本用例只关心 onAlarmAction 的注册路径，
      // 不希望任何 native-only 分支（isNativeAndroid）被激活。
      getPlatform: () => "web",
      Plugins: {
        App: { addListener: record("appListener") },
        SystemBridge: {
          addListener: record("bridgeListener"),
          consumeAlarmAction: async () => null,
          ackAlarmAction: async () => {}
        }
      }
    };
    try {
      const h = createApp();
      const app = await h.boot();
      return { h, app, calls, ready: await app.ready() };
    } finally {
      delete global.Capacitor;
    }
  };

  // ① 真机契约：同步返回 `{ remove }` 句柄（没有 .catch）—— 这正是崩溃的那条路径
  {
    const { h, app, calls, ready } = await withPlatform(() => ({ async remove() {} }));
    ok("Q1 真机契约：addListener 确实被调用到了（否则本用例在空转）",
      calls.appListener === 1 && calls.bridgeListener === 1,
      "app=" + calls.appListener + " bridge=" + calls.bridgeListener);
    ok("Q1 真机契约（同步句柄）：ready() === true，init 未被中断", ready === true);
    // UX-C01 之后首启**不再自动 seed**，所以旧的 `items.length > 0` 代理失效了。
    // 换成两条更强的断言：① 干净首启真的什么都不写入（旧代理的反面）；
    // ② 启动链末端那枚 15 秒心跳装上 —— 它才是「init 跑到底」的活证据。
    ok("Q1 真机契约：干净首启不自动写入演示数据（UX-C01）",
      app.state.items.length === 0, "items=" + app.state.items.length);
    ok("Q1 真机契约：15 秒心跳已装上（启动链跑到底的标志）",
      h.intervals.some(x => x.ms === 15000), JSON.stringify(h.intervals.map(x => x.ms)));
  }

  // ② 官方 capacitor.js 契约：返回 Promise（并把 .remove 挂在上面）—— 归一化后同样必须可用
  {
    const { h, app, calls, ready } = await withPlatform(() => {
      const p = Promise.resolve({ remove: async () => {} });
      p.remove = async () => {};
      return p;
    });
    ok("Q1 Promise 契约：同样能注册且不中断启动",
      calls.appListener === 1 && ready === true);
    ok("Q1 Promise 契约：启动链照常跑到底（首启无演示数据 + 15 秒心跳装上）",
      app.state.items.length === 0 && h.intervals.some(x => x.ms === 15000),
      "items=" + app.state.items.length + " intervals=" + JSON.stringify(h.intervals.map(x => x.ms)));
  }

  // ③ 平台同步抛错：注册失败必须被隔离，不能拖垮整条启动链
  {
    const { h, app, ready } = await withPlatform(() => { throw new Error("plugin not registered"); });
    ok("Q1 注册同步抛错：错误被隔离，ready() 仍为 true", ready === true);
    ok("Q1 注册同步抛错：其余启动动作照常完成（15 秒心跳装上）",
      h.intervals.some(x => x.ms === 15000),
      "intervals=" + JSON.stringify(h.intervals.map(x => x.ms)));
  }
}

/* -----------------------------------------------------------------
 * UX 三项优先项：新增事务 / 证据逻辑的行为级检查
 *
 * §9.1 写的是「新增事务/证据逻辑须有故障和重启测试」—— 不是「搜到某段源码」。
 * 这里挑的是三处**错了就会造成用户可见损害**的地方：
 *   · C01：演示预览若写入 state ⇒ 老缺陷「载入示例数据覆盖用户数据」换个名字回来；
 *   · C03/A03：撤销若不看版本 / 已处理 / 已投递 ⇒ 误删事项，或撤销后旧提醒照响（幽灵响铃）；
 *   · T03：证据回流若把「读不到」当成「没送达」⇒ D70 前置核验里那条近 100% 误报。
 * ----------------------------------------------------------------- */

section("UX-C01 演示是只读预览，不是「载入示例数据」");
{
  const h = createApp();
  const app = await h.boot();
  const real = app.makeItem({ title: "用户自己记的事", status: "waiting", triggerAt: Date.now() + 3600000 });
  app.state.items = [real];
  app.state.notes = [{ id: "n1", text: "用户自己的便签" }];
  const itemsBefore = JSON.stringify(app.state.items);
  const notesBefore = JSON.stringify(app.state.notes);
  const projectsBefore = JSON.stringify(app.state.projects);

  const rows = app.demoPreviewRows();
  ok("C01 演示有实际内容（空壳预览等于没做）",
    Array.isArray(rows) && rows.length >= 3, "rows=" + (rows && rows.length));
  app.openDemoPreview();
  await flush(2);

  ok("C01 打开演示不写事项", JSON.stringify(app.state.items) === itemsBefore);
  ok("C01 打开演示不写便签 / 项目（老入口正是从这两处覆盖用户状态）",
    JSON.stringify(app.state.notes) === notesBefore &&
    JSON.stringify(app.state.projects) === projectsBefore);
  ok("C01 用户那条还在原位（数量与 id 都没动）",
    app.state.items.length === 1 && app.state.items[0].id === real.id);

  // 反向对照：演示条目一条都不许出现在用户数据里 ——
  // 否则「只读预览」这句话就是假的，只是没覆盖到这条断言而已。
  const realTitles = new Set(app.state.items.map(x => x.title));
  ok("C01 演示条目一条都没进用户数据",
    rows.every(r => !realTitles.has(r.title)));
}

section("UX-C03 新建的有限撤销（幽灵排程 / 误删的红线）");
{
  const h = createApp();
  const app = await h.boot();

  // ① 版本未变 → 允许撤销，且真的删掉
  const a = app.makeItem({ title: "刚记下的事", status: "waiting", triggerAt: Date.now() + 3600000 });
  app.state.items = [a];
  ok("C03 新建后版本未变可撤销", app.undoNewItem(a.id, a.rev) === true);
  ok("C03 撤销真的撤掉了这条", !app.state.items.some(x => x.id === a.id));

  // ② 版本已变（之后又被改过）→ 拒绝，且不得误删
  const b = app.makeItem({ title: "后来又被改过的事", status: "waiting", triggerAt: Date.now() + 3600000 });
  app.state.items = [b];
  const staleRev = b.rev;
  b.rev = Number(b.rev) + 1;
  ok("C03 版本已变 → 拒绝撤销", app.undoNewItem(b.id, staleRev) === false);
  ok("C03 拒绝后事项仍在（没有误删）", app.state.items.some(x => x.id === b.id));

  // ③ 已经 ACK 过 → 属于「已开始处理」
  const c = app.makeItem({ title: "已经看过的事", status: "acknowledged", triggerAt: Date.now() - 1000 });
  c.acknowledgedAt = Date.now();
  app.state.items = [c];
  ok("C03 已开始处理（ACK）→ 拒绝撤销", app.undoNewItem(c.id, c.rev) === false);
  ok("C03 拒绝后这条仍在", app.state.items.some(x => x.id === c.id));

  // ④ 已经拿到送达证据 → 撤销会留下「幽灵响铃」，必须拒绝
  const d = app.makeItem({ title: "已经响过的事", status: "waiting", triggerAt: Date.now() - 60000 });
  d.reminderEvents = {};
  d.reminderEvents["1@" + d.triggerAt] = { at: d.triggerAt, state: "delivered", receivedAt: Date.now() };
  app.state.items = [d];
  ok("C03 已开始投递 → 拒绝撤销（否则旧提醒照响）", app.undoNewItem(d.id, d.rev) === false);
  ok("C03 被拒的这条没被删", app.state.items.some(x => x.id === d.id));
}

section("UX-A03 完成的有限撤销（周期成组还原 / 不误删下一期）");
{
  const h = createApp();
  const app = await h.boot();

  // ① 普通事项：完成 → 有撤销入口 → 8 秒内可还原
  const it = app.makeItem({ title: "普通完成", status: "due", triggerAt: Date.now() - 1000 });
  app.state.items = [it];
  app.completeItem(it.id);
  ok("A03 完成后提供撤销入口", h.textOf("#toastAction2") === "撤销", h.textOf("#toastAction2"));
  ok("A03 完成即归档（主动作不因撤销倒计时延迟）", it.status === "archived" && !!it.completedAt);
  ok("A03 撤销后回到未完成",
    app.undoLastComplete() === true && it.status !== "archived" && !it.completedAt);

  // ② 周期事项：完成派生的下一期必须被成组回收
  const r = app.makeItem({
    title: "每月交房租", status: "due", triggerAt: Date.now() - 1000,
    repeat: { mode: "calendar", every: "month" }
  });
  app.state.items = [r];
  app.completeItem(r.id);
  const spawned = app.state.items.filter(x => x.repeatParentId === r.id);
  ok("A03 周期完成确实派生了下一期（否则下面两条在空转）",
    spawned.length === 1, "spawned=" + spawned.length);
  ok("A03 撤销成组还原并回收未被处理的下一期",
    app.undoLastComplete() === true &&
    !app.state.items.some(x => x.repeatParentId === r.id));

  // ③ 下一期已经被处理过 → 拒绝不安全撤销，且绝不误删
  const r2 = app.makeItem({
    title: "每周复盘", status: "due", triggerAt: Date.now() - 1000,
    repeat: { mode: "calendar", every: "week" }
  });
  app.state.items = [r2];
  app.completeItem(r2.id);
  const next = app.state.items.find(x => x.repeatParentId === r2.id);
  ok("A03 周期完成派生了下一期（③ 的前置）", !!next);
  next.acknowledgedAt = Date.now();
  ok("A03 下一期已处理 → 拒绝撤销", app.undoLastComplete() === false);
  ok("A03 拒绝后下一期不被误删", app.state.items.some(x => x.repeatParentId === r2.id));

  // ④ 完成后到来的投递证据 → 撤销会制造幽灵响铃
  const it4 = app.makeItem({ title: "完成后才收到回执", status: "due", triggerAt: Date.now() - 1000 });
  app.state.items = [it4];
  app.completeItem(it4.id);
  it4.reminderEvents = it4.reminderEvents || {};
  it4.reminderEvents["1@" + it4.triggerAt] = { at: it4.triggerAt, state: "delivered", receivedAt: Date.now() };
  ok("A03 已进入投递 → 拒绝撤销（不回放旧铃）", app.undoLastComplete() === false);
  ok("A03 被拒后仍保持完成状态", it4.status === "archived");
}

section("UX-T03 送达证据回流：只有拿到证据才下结论，缺证据绝不指控");
{
  const h = createApp();
  const app = await h.boot();
  const now = Date.now();
  const at = now - 5 * 60000; // 已过点，按旧逻辑正是「看起来漏了」的形态
  const key = "1@" + at;
  const it = app.makeItem({ title: "提醒过的事", status: "waiting", triggerAt: at });
  it.reminderEvents = {};
  it.reminderEvents[key] = { at: at, state: "scheduled", roundBase: it.triggerAt };
  app.state.items = [it];

  // ① 证据通道读不到 → 只能说「尚未确认」，一个字都不许出现「漏」
  app.deliveryEvidenceState.readable = false;
  let row = app.detailReminderStatusRow(it);
  ok("T03 读不到证据时不指控漏提醒", /尚未确认/.test(row) && !/漏/.test(row), row);

  // ② 真实回执到达 → 只说到「系统已接收」这一层
  // 独立验收 F01：回执必须带齐**规范字段名**（itemId/reminderKey/carrier/receivedAt/itemRev），
  // 这正是原生 `DeliveryEvidenceStore.rowFor` 写出来的那一组；旧名 key/at 不再被写出。
  const changed = app.applyNativeDeliveryEvidence([
    { itemId: it.id, reminderKey: key, carrier: "alarm", itemRev: String(it.rev), receivedAt: now }
  ]);
  ok("T03 新回执确实写进台账（对照不是空转）",
    changed === true && it.reminderEvents[key].state === "delivered");
  ok("T03 层级只声明「系统已接收」，不写用户看到", it.reminderEvents[key].level === "received");
  ok("T03 证据回流绝不改 status（完成事项不能被回执复活）", it.status === "waiting");
  row = app.detailReminderStatusRow(it);
  ok("T03 有证据时说「系统已接收」，不说已看到/已读",
    /系统已接收/.test(row) && !/看到|已读/.test(row), row);

  // ③ 重复回执 → 幂等，不产生第二次变化
  ok("T03 重复回执是幂等的",
    app.applyNativeDeliveryEvidence([
      { itemId: it.id, reminderKey: key, carrier: "alarm", itemRev: String(it.rev), receivedAt: now }
    ]) === false);

  // ④ 身份缺失的回执 → 计 unknown，不反推失败
  ok("T03 缺身份（无提醒键）的回执不动任何事项",
    app.applyNativeDeliveryEvidence([{ itemId: it.id, receivedAt: now }]) === false);
  ok("T03 缺身份后状态仍是 delivered（没有把它降级成失败）",
    it.reminderEvents[key].state === "delivered");

  // ⑤ 旧轮次回执：这条事项的当前触发起点已经换过，旧键不再作数
  const it2 = app.makeItem({ title: "换过时间的事", status: "waiting", triggerAt: now + 3600000 });
  it2.reminderEvents = {};
  app.state.items = [it2];
  ok("T03 旧轮次回执不写入（新轮次不被污染）",
    app.applyNativeDeliveryEvidence([
      { itemId: it2.id, reminderKey: key, carrier: "alarm", itemRev: String(it2.rev), receivedAt: now }
    ]) === false &&
    Object.keys(it2.reminderEvents).length === 0);

  // ⑥ 独立验收 F06 / 反例 R4：原定时刻**落在本轮内**，但这一轮我们从没登记过排程。
  // 旧实现只比 `ev.at >= item.triggerAt`，会在这种回执上写出一条**假的**「系统已接收」。
  const it3 = app.makeItem({ title: "本轮之外的轮次", status: "waiting", triggerAt: now - 600000 });
  it3.reminderEvents = {};
  app.state.items = [it3];
  ok("T03 本轮内但未登记的轮次不写入（宁可尚未确认，不谎报已接收）",
    app.applyNativeDeliveryEvidence([
      { itemId: it3.id, reminderKey: "7@" + (now - 300000), carrier: "alarm", itemRev: String(it3.rev), receivedAt: now }
    ]) === false && Object.keys(it3.reminderEvents).length === 0);

  // ⑦ 独立验收 F01：缺规范字段（旧名 key/at 之外的半套写法）→ 不计入、也不许补默认值
  const it4 = app.makeItem({ title: "半套字段", status: "waiting", triggerAt: now - 600000 });
  const unwrittenKey = "0@" + (now - 600000);
  it4.reminderEvents = { [unwrittenKey]: { at: now - 600000, state: "scheduled", roundBase: it4.triggerAt } };
  app.state.items = [it4];
  ok("T03 缺 receivedAt/carrier/itemRev 的回执不作数（不接受「用当前时间补上」）",
    app.applyNativeDeliveryEvidence([{ itemId: it4.id, reminderKey: unwrittenKey }]) === false &&
    it4.reminderEvents[unwrittenKey].state === "scheduled");
  // 同一事项补全字段后必须能写入 —— 证明上面的 false 不是通路坏掉
  ok("T03 同一条补全规范字段后即可写入（上面的拒绝不是通路故障）",
    app.applyNativeDeliveryEvidence([
      { itemId: it4.id, reminderKey: unwrittenKey, carrier: "notification", itemRev: String(it4.rev), receivedAt: now }
    ]) === true && it4.reminderEvents[unwrittenKey].state === "delivered");
}

/* =================================================================
 * 独立验收返工：R1–R7b 反例 → 有断言的回归
 *
 * 来源：`docs/reviews/user-experience-three-priorities-independent-acceptance-20260919.md`
 * 与它的可复现脚本 `docs/reviews/verification-runs/20260919T234129-ux-independent/probes.cjs`。
 * 那批反例当时全部被判「不符合要求」；本节把它们逐条变成**会变红的断言**。
 * 纪律：每条断言都要能在**拔掉对应修复**时变红（成对差分／对照组写在断言旁边）。
 * ================================================================= */

section("返工 R1（F02）：同一份表单连续提交只落一条");
{
  const h = createApp();
  const app = await h.boot();
  h.holdCommits(true);
  h.setField("#capText", "明天下午3点提醒我取快递");
  // 输入框的 Enter 监听会再次调用保存 —— 按钮 disabled 拦不住它
  const first = app.saveItemFromForm();
  const second = app.saveItemFromForm();
  h.holdCommits(false);
  h.releaseCommits();
  await flush(8);
  await app.saveAsync();
  ok("R1 第一次提交被接受", first === true, String(first));
  ok("R1 第二次提交被同一份提交身份拒绝（旧实现：两次都返回 true）", second === false, String(second));
  ok("R1 内存里只有一条", app.state.items.length === 1, app.state.items.length);
  ok("R1 权威存储里也只有一条", ((h.persisted() || {}).items || []).length === 1,
    JSON.stringify(((h.persisted() || {}).items || []).map(x => x.title)));

  // 对照组：提交真正结束之后，**合法的下一条**仍必须能保存
  // （否则「去重」会退化成「这个入口从此废掉」）
  h.setField("#capText", "第二条完全不同的记录");
  const third = app.saveItemFromForm();
  await flush(8);
  await app.saveAsync();
  ok("R1 对照组：提交结束后新的一条照常保存", third === true && app.state.items.length === 2,
    JSON.stringify({ third, count: app.state.items.length }));
}

section("返工 R2（F03）：上一笔保存的结果不碰用户新写的草稿");
{
  const h = createApp();
  const app = await h.boot();
  h.holdCommits(true);
  h.setField("#capText", "明天下午3点提醒我取快递");
  app.saveItemFromForm();
  await flush(2);
  h.setField("#capText", "第二条尚未保存的输入");
  h.holdCommits(false);
  h.releaseCommits();
  await flush(8);
  await app.saveAsync();
  ok("R2 旧保存成功不清掉新输入（旧实现：输入被清成空字符串）",
    h.fieldOf("#capText") === "第二条尚未保存的输入", JSON.stringify(h.fieldOf("#capText")));

  // 失败路径同样：不许把旧草稿恢复上来盖掉正在写的内容
  const h2 = createApp();
  const app2 = await h2.boot();
  h2.holdCommits(true);            // 先扣住写事务，才有「失败回调晚于用户继续输入」的窗口
  h2.setCommitFailure(true);
  h2.setField("#capText", "这一笔会写失败");
  app2.saveItemFromForm();
  await flush(2);
  h2.setField("#capText", "失败期间写下的新内容");
  h2.holdCommits(false);
  h2.releaseCommits();
  await flush(8);
  ok("R2 旧保存失败不覆盖新输入（改成给一个显式的找回入口）",
    h2.fieldOf("#capText") === "失败期间写下的新内容", JSON.stringify(h2.fieldOf("#capText")));
  ok("R2 失败时明确说明「你正在写的内容没被动过」", /没被动过/.test(h2.textOf("#toastText")),
    h2.textOf("#toastText"));
}

section("返工 R3（F04）：原生提交在途时撤销完成，不被权威草稿覆盖");
{
  const h = createApp();
  const app = await h.boot();
  const x = app.makeItem({ title: "原生在途 A", status: "due", triggerAt: Date.now() - 1000 });
  const y = app.makeItem({ title: "要撤销的 B", status: "due", triggerAt: Date.now() - 1000 });
  app.state.items = [x, y];
  await app.saveAsync();
  app.completeItem(y.id);
  await app.saveAsync();
  h.holdCommits(true);
  const pending = app.handleAlarmAction({ action: "ack", itemId: x.id, itemRev: x.rev });
  await flush(3);
  const accepted = app.undoLastComplete();
  const immediate = app.state.items.find(i => i.id === y.id).status;
  h.holdCommits(false);
  h.releaseCommits();
  await flush(8);
  await pending;
  await app.saveAsync();
  const after = app.state.items.find(i => i.id === y.id).status;
  const restarted = await restartApp(h.disk);
  const durable = (restarted.app.state.items.find(i => i.id === y.id) || {}).status;
  ok("R3 撤销被接受", accepted === true, String(accepted));
  ok("R3 撤销后立刻回到未完成", immediate === "waiting" || immediate === "due", String(immediate));
  ok("R3 原生提交发布后仍未被覆盖（旧实现：又变回 archived）", after === immediate, String(after));
  ok("R3 重启后仍是撤销后的状态（旧实现：restart 后又归档）", durable === immediate, String(durable));
}

section("返工 R5（F05）：跨过原定时刻的撤销完成不立即补投");
{
  const h = createApp();
  const app = await h.boot();
  const nativeLib = require(path.join(ROOT, "lib/native-reminders.js"));
  const at = Date.now() + 1500;
  const x = app.makeItem({ title: "撤销后不补响", status: "waiting", priority: "normal", triggerAt: at });
  x.triggerAt = at;
  x.reminderEvents = { ["0@" + at]: { state: "scheduled", at: at } };
  app.state.items = [x];
  app.state.settings.notify = true;
  app.state.settings.dnd = false;
  await app.saveAsync();
  app.completeItem(x.id);
  await app.saveAsync();
  // 到点前完成 → 走生产取消记账函数写 cancelled → 原定时刻跨过 → 8 秒内撤销
  app.applyReminderEvents([], Date.now(), [{ itemId: x.id, key: "0@" + at, at: at }]);
  await app.saveAsync();
  await new Promise(resolve => setTimeout(resolve, Math.max(0, at - Date.now() + 80)));
  const accepted = app.undoLastComplete();
  await app.saveAsync();
  const desired = nativeLib.buildDesired(app.state.items, app.state.settings, Date.now());
  const replays = desired.filter(n => n.extra && n.extra.catchUp === true);
  ok("R5 撤销被接受", accepted === true, String(accepted));
  ok("R5 不因撤销立刻补响已经过去的那一次（旧实现：now+2s 的 catchUp 通知）",
    replays.length === 0, JSON.stringify(replays.map(n => n.extra && n.extra.reminderKey)));
  ok("R5 该轮次在台账里被标成 suppressed（抑制落在这一条键上，不动全局规则）",
    (x.reminderEvents["0@" + at] || {}).state === nativeLib.REMINDER_STATE_SUPPRESSED,
    JSON.stringify(x.reminderEvents["0@" + at]));

  // 对照组：同样是 `cancelled`、同样已过点，但**不是**因「完成」而取消的轮次照旧要补投。
  // 这条证明上面的「空」不是 buildDesired 恒不产生 catchUp 造成的空转。
  const controlAt = Date.now() - 60000;
  const control = [{
    id: "ctrl", status: "waiting", priority: "normal", triggerAt: controlAt,
    reminderEvents: { ["0@" + controlAt]: { state: "cancelled", at: controlAt } }
  }];
  const controlDesired = nativeLib.buildDesired(control, app.state.settings, Date.now());
  ok("R5 对照组：未被抑制的 cancelled 轮次仍然补投（上面的空不是空转）",
    controlDesired.some(n => n.extra && n.extra.catchUp === true),
    JSON.stringify(controlDesired.map(n => n.extra && n.extra.catchUp)));
}

section("返工 R6（F04）：撤销的「已撤销」只在落库之后说");
{
  const h = createApp();
  const app = await h.boot();
  const x = app.makeItem({ title: "撤销写不下去", status: "due", triggerAt: Date.now() - 1000 });
  app.state.items = [x];
  await app.saveAsync();
  app.completeItem(x.id);
  await app.saveAsync();
  h.setCommitFailure(true);
  h.setLocalStorageFailure(true);
  const accepted = app.undoLastComplete();
  const announcedEarly = h.textOf("#toastText");
  await flush(8);
  const durable = h.persistedStatusOf(x.id);
  h.setCommitFailure(false);
  h.setLocalStorageFailure(false);
  const restarted = await restartApp(h.disk);
  const afterRestart = (restarted.app.state.items.find(i => i.id === x.id) || {}).status;
  ok("R6 撤销命令被接受", accepted === true, String(accepted));
  ok("R6 落库之前绝不说「已撤销」（旧实现：写完就提示）",
    !/已撤销/.test(announcedEarly), announcedEarly);
  ok("R6 可见状态退回撤销之前（不留下「界面说撤销了、磁盘没有」）",
    app.state.items.find(i => i.id === x.id).status === "archived",
    app.state.items.find(i => i.id === x.id).status);
  ok("R6 权威存储里没有假的撤销结果", durable === "archived", String(durable));
  ok("R6 重启后与磁盘一致", afterRestart === "archived", String(afterRestart));
  ok("R6 如实说明没写进去并给出重试入口",
    /重试/.test(h.textOf("#toastAction")) && /撤销还没写进本机存储/.test(h.textOf("#toastText")),
    h.textOf("#toastText") + " / " + h.textOf("#toastAction"));
}

section("返工 R7 / R7b（F01）：Java 真实行穿过桥与归一化，读不到不伪装成读到了");
{
  const evidenceLib2 = require(path.join(ROOT, "lib/delivery-evidence.js"));
  const cap = installCapacitor();
  const sb = global.Capacitor.Plugins.SystemBridge;
  const now = Date.now();
  const key = "0@" + (now - 1000);
  // 字段名与 `DeliveryEvidenceStore.rowFor` 写出的**逐字相同**（R7 当时就是这一对名字不一致）
  const javaRow = {
    itemId: "java-row", reminderKey: key, plannedAt: now - 1000,
    carrier: "alarm", receivedAt: now, itemRev: "2", token: "token-2"
  };
  sb.deliveryEvidence = async () => ({
    available: true, evidence: [javaRow], retentionMaxAgeMs: 604800000, retentionCapacity: 300
  });
  const got = await native.getDeliveryEvidence({});
  const norm = evidenceLib2.normalizeEvidence(got.rows, "native");
  ok("R7 Java 真实行穿过桥后身份完整（旧实现：valid=false / missing-identity）",
    got.available === true && norm.length === 1 && norm[0].valid === true && norm[0].key === key,
    JSON.stringify({ available: got.available, norm: norm }));
  const item = {
    id: "java-row", rev: 2, triggerAt: now - 1000,
    reminderEvents: { [key]: { at: now - 1000, state: "scheduled", roundBase: now - 1000 } }
  };
  ok("R7 并进事项台账后写成 delivered（证据回流真的通了）",
    evidenceLib2.mergeEvidence([item], norm, now).applied === 1);

  sb.deliveryEvidence = async () => ({ available: false, evidence: [], error: "storage-unavailable" });
  const off = await native.getDeliveryEvidence({});
  ok("R7b 桥说读不到时如实转述 available:false（旧实现：恒 available:true）",
    off.available === false && (off.rows || []).length === 0, JSON.stringify(off));
  cap.cleanup();
}

section("返工 F07：停止测试铃声走 token 限定的停铃链路");
{
  const cap = installCapacitor();
  const sb = global.Capacitor.Plugins.SystemBridge;
  const stops = [];
  const startedAt = Date.now();
  sb.activeAlarmDeliveries = async () => ({
    alarms: [
      { id: 90003, token: "tok-this-run", receivedAt: startedAt + 1000 },
      { id: 90003, token: "tok-last-run", receivedAt: startedAt - 60000 },
      { id: 7777, token: "tok-user-alarm", receivedAt: startedAt + 1000 }
    ]
  });
  sb.stopAlarmDelivery = async (v) => { stops.push(v); return { stopped: true }; };
  const h = createApp();
  const app = await h.boot();
  app.state.settings.testRun = {
    id: 90003, startedAt: startedAt, triggerAt: startedAt + 60000, stoppedAt: null
  };
  const stopped = await app.stopSetupTestRun();
  ok("F07 停铃返回本次真正停掉的条数（旧实现：走不到停铃分支，恒 0）", stopped === 1, String(stopped));
  ok("F07 只停本次测试那一条（id + token 双重限定）",
    stops.length === 1 && stops[0].id === 90003 && stops[0].token === "tok-this-run",
    JSON.stringify(stops));
  ok("F07 绝不误停用户自己的闹钟",
    stops.every(s => s.token !== "tok-user-alarm"), JSON.stringify(stops));
  ok("F07 上一次测试的残留投递不被当成本次",
    stops.every(s => s.token !== "tok-last-run"), JSON.stringify(stops));
  ok("F07 本次运行记录被标成已停止", app.state.settings.testRun.stoppedAt > 0);
  cap.cleanup();
}

section("返工 F08：无时间记录的保存反馈只出一条，撤销入口不被顶掉");
{
  const h = createApp();
  const app = await h.boot();
  h.setField("#capText", "有空看看这个项目");
  const accepted = app.saveItemFromForm();
  await flush(8);
  await app.saveAsync();
  ok("F08 无时间记录被收下", accepted === true && app.state.items.length === 1,
    JSON.stringify({ accepted, count: app.state.items.length }));
  ok("F08 反馈里保留「待整理」语义", /待整理/.test(h.textOf("#toastText")), h.textOf("#toastText"));
  ok("F08 同一条反馈里给出去整理的入口", h.textOf("#toastAction") === "去整理", h.textOf("#toastAction"));
  // 只读文字不够：第二条 toast 只把 `#toastAction2` 置为 hidden、**不清空**它的文字，
  // 所以必须同时断言「可见」——否则这条断言在注回旧行为后依然是绿的。
  ok("F08 撤销入口没有被第二条提示顶掉（旧实现：只看到「已收下 · 待整理 / 去整理」）",
    h.textOf("#toastAction2") === "撤销" && h.hiddenOf("#toastAction2") === false,
    JSON.stringify({ text: h.textOf("#toastAction2"), hidden: h.hiddenOf("#toastAction2") }));
}

/* =================================================================
 * 二次返工：独立复验 X1 / X2 / X4 与 SW 缺口 → 有断言的回归
 *
 * 来源：`docs/reviews/user-experience-three-priorities-independent-recheck-20260920.md`
 * 与它的可复现证据目录 `docs/reviews/verification-runs/20260920-ux-independent-recheck/`。
 * 那一轮判：X1（旧轮回执仍污染新轮）、X2（AI 迟到结果覆盖新草稿）、
 * X4（停铃读取失败被当成无铃）不符要求，X3 通过；另裁「SW 预缓存缺项应修」。
 *
 * 纪律：每条断言都要能在**拔掉对应修复**时变红；对照组写在断言旁边，
 * 用来证明「拒绝」不是「通路坏掉」。提示文字只是表象，凡能断言状态/DOM 属性的一律断言它们。
 * ================================================================= */

section("返工2 R-F06：旧轮回执不得抬高当前轮的核查状态（复验 X1）");
{
  const h = createApp();
  const app = await h.boot();
  app.deliveryEvidenceState.readable = true;
  // 默认勿扰（23:00–07:30）会把落在静默时段的触发点顺延到 07:30，
  // 那会让「稍后提醒」的目标时刻随跑测试的钟点漂移。本节测的是**轮次身份**，
  // 所以显式关掉勿扰，保证断言与墙上时钟无关。
  app.state.settings.dnd = false;
  const now = Date.now();
  // 旧轮：10 分钟前开始，它的追提醒排在 20 分钟后（**将来**）
  const oldBase = now - 10 * 60000;
  const oldAt = now + 20 * 60000;
  // 新轮：3 分钟前「稍后提醒」到的新起点 —— **早于**旧轮追提醒，这正是漏判的成因
  const newAt = now - 3 * 60000;

  const x = app.makeItem({ title: "旧轮回执", status: "due", triggerAt: oldBase });
  x.triggerAt = oldBase;
  app.state.items = [x];
  app.applyReminderEvents([
    { itemId: x.id, key: "0@" + oldBase, at: oldBase },
    { itemId: x.id, key: "1@" + oldAt, at: oldAt }
  ], oldBase - 1000, []);
  ok("R-F06 前置：旧轮的键都带上了轮次身份",
    x.reminderEvents["0@" + oldBase].roundBase === oldBase &&
    x.reminderEvents["1@" + oldAt].roundBase === oldBase,
    JSON.stringify(x.reminderEvents));

  const oldRev = x.rev;
  app.snoozeItem(x.id, newAt, "elapsed");
  ok("R-F06 前置：稍后提醒换了起点并推进版本",
    x.triggerAt === newAt && Number(x.rev) === Number(oldRev) + 1,
    JSON.stringify({ triggerAt: x.triggerAt, rev: x.rev, oldRev }));
  await flush(4);
  app.applyReminderEvents([{ itemId: x.id, key: "0@" + newAt, at: newAt }], now,
    [{ itemId: x.id, key: "1@" + oldAt, at: oldAt }]);

  ok("R-F06 前置：旧轮追提醒被原生撤销后仍作为历史保留",
    !!x.reminderEvents["1@" + oldAt] && x.reminderEvents["1@" + oldAt].state === "cancelled",
    JSON.stringify(x.reminderEvents));
  ok("R-F06 前置：保留旧键时必须**带着它自己的轮次身份**（丢掉它 = 把旧键当新轮）",
    x.reminderEvents["1@" + oldAt].roundBase === oldBase &&
    x.reminderEvents["0@" + newAt].roundBase === newAt,
    JSON.stringify(x.reminderEvents));
  ok("R-F06 前置：旧轮的键在时间上确实「落进」当前范围（否则这个反例是假的）",
    oldAt >= newAt, JSON.stringify({ oldAt: oldAt, newAt: newAt }));

  // X1：旧轮追提醒的回执回来 —— 键登记过、时刻也在范围内，但它是**上一轮**的。
  // （`receivedAt` 取旧追提醒那一刻：这一条模拟的是「到旧追提醒时刻回读旧版本回执」，
  //   轮次判据与 `receivedAt` 无关，所以这个取值不影响结论。）
  const appliedOld = app.applyNativeDeliveryEvidence([
    { itemId: x.id, reminderKey: "1@" + oldAt, carrier: "alarm",
      itemRev: String(oldRev), token: "old-round", receivedAt: oldAt }
  ]);
  ok("R-F06 旧轮回执不写入台账（旧实现：applied=1）",
    appliedOld === false && x.reminderEvents["1@" + oldAt].state === "cancelled",
    JSON.stringify({ appliedOld: appliedOld, entry: x.reminderEvents["1@" + oldAt] }));
  ok("R-F06 当前轮如实停在「尚未确认」（旧实现：显示「系统已接收这次提醒」）",
    /尚未确认/.test(app.detailReminderStatusRow(x)) &&
    !/系统已接收/.test(app.detailReminderStatusRow(x)),
    app.detailReminderStatusRow(x));

  // 对照组：当前轮的键送达**必须**被接受 —— 否则上面的拒绝可能只是通路坏掉
  const appliedNew = app.applyNativeDeliveryEvidence([
    { itemId: x.id, reminderKey: "0@" + newAt, carrier: "alarm",
      itemRev: String(x.rev), receivedAt: newAt }
  ]);
  ok("R-F06 对照组：当前轮的键送达照常写入",
    appliedNew === true && x.reminderEvents["0@" + newAt].state === "delivered",
    JSON.stringify(x.reminderEvents));
  ok("R-F06 对照组：这时才说「系统已接收」",
    /系统已接收/.test(app.detailReminderStatusRow(x)), app.detailReminderStatusRow(x));
}

section("返工2 R-F06b：旧轮 delivered 只是历史；同刻重排 / 重复 / 乱序 / 非排程编辑都不误伤");
{
  const h = createApp();
  const app = await h.boot();
  app.deliveryEvidenceState.readable = true;
  // 同上一节：关掉勿扰，别让默认静默时段把触发点顺延掉（那会让断言随钟点漂移）
  app.state.settings.dnd = false;
  const now = Date.now();
  const oldBase = now - 120 * 60000;
  const oldAt = now - 10 * 60000;   // 旧轮的追提醒（**晚于**新起点，所以会被保留下来）
  const newAt = now - 30 * 60000;

  // ① 旧轮已经 delivered（真实历史），「稍后提醒」换轮后不得再代表「这一次」
  const a = app.makeItem({ title: "旧轮已送达", status: "waiting", triggerAt: oldBase });
  a.triggerAt = oldBase;
  a.reminderEvents = {};
  a.reminderEvents["1@" + oldAt] = {
    at: oldAt, state: "delivered", receivedAt: oldAt, carrier: "alarm", level: "received", roundBase: oldBase
  };
  app.state.items = [a];
  app.snoozeItem(a.id, newAt, "elapsed");
  await flush(4);
  app.applyReminderEvents([{ itemId: a.id, key: "0@" + newAt, at: newAt }], now, []);
  ok("R-F06b 旧轮的 delivered 仍在台账里（保留历史，不删）",
    !!a.reminderEvents["1@" + oldAt] && a.reminderEvents["1@" + oldAt].state === "delivered",
    JSON.stringify(a.reminderEvents));
  ok("R-F06b 但它不算当前轮的证据（旧实现：直接显示「系统已接收」）",
    !/系统已接收/.test(app.detailReminderStatusRow(a)), app.detailReminderStatusRow(a));
  ok("R-F06b 保存反馈用的「本条排程证据」也不认旧轮（旧实现：返回 delivered，等于说「已安排好」）",
    app.itemScheduleEvidence(a) !== "delivered", String(app.itemScheduleEvidence(a)));

  // ② 同一时刻重排（承诺没变）⇒ 轮次不换、合法回执照样接受
  const b = app.makeItem({ title: "同刻重排", status: "waiting", triggerAt: newAt });
  b.triggerAt = newAt;   // `normalizeItem` 会把触发点对齐到分钟，这里用精确值以免轮次被悄悄改写
  b.reminderEvents = {};
  app.state.items = [b];
  app.applyReminderEvents([{ itemId: b.id, key: "0@" + newAt, at: newAt }], now, []);
  await flush(4);
  app.applyReminderEvents([{ itemId: b.id, key: "0@" + newAt, at: newAt }], now, []);
  ok("R-F06b 同一时刻重排不换轮",
    b.reminderEvents["0@" + newAt].roundBase === newAt && b.triggerAt === newAt,
    JSON.stringify(b.reminderEvents));
  ok("R-F06b 同刻重排后的回执照样写入（不因为「重排过」就判旧轮）",
    app.applyNativeDeliveryEvidence([
      { itemId: b.id, reminderKey: "0@" + newAt, carrier: "alarm", itemRev: String(b.rev), receivedAt: now }
    ]) === true, JSON.stringify(b.reminderEvents));

  // ③ 重复与乱序：第二次同一键幂等；第二个键晚到也照样各自记账
  ok("R-F06b 重复回执是幂等的",
    app.applyNativeDeliveryEvidence([
      { itemId: b.id, reminderKey: "0@" + newAt, carrier: "alarm", itemRev: String(b.rev), receivedAt: now }
    ]) === false);
  await flush(4);
  app.applyReminderEvents([
    { itemId: b.id, key: "0@" + newAt, at: newAt },
    { itemId: b.id, key: "1@" + (newAt + 60000), at: newAt + 60000 }
  ], now, []);
  ok("R-F06b 乱序到达的第二个键照样记账",
    app.applyNativeDeliveryEvidence([
      { itemId: b.id, reminderKey: "1@" + (newAt + 60000), carrier: "notification",
        itemRev: String(b.rev), receivedAt: now }
    ]) === true && b.reminderEvents["1@" + (newAt + 60000)].state === "delivered",
    JSON.stringify(b.reminderEvents));

  // ④ 非排程字段编辑：只改备注（标题与时间框都没动）⇒ 时间不变、版本推进
  const t2 = Math.floor((now + 60 * 60000) / 60000) * 60000;   // 对齐到分钟，编辑往返不失真
  const c = app.makeItem({ title: "只改备注", status: "waiting", triggerAt: t2 });
  c.reminderEvents = {};
  app.state.items = [c];
  app.applyReminderEvents([{ itemId: c.id, key: "0@" + t2, at: t2 }], now, []);
  await flush(4);
  const revBefore = c.rev;
  h.setField("#capText", "只改备注");
  h.setField("#capNote", "只改备注不改时间");
  h.setField("#capTrigger", localInputOf(t2));
  app.state.ui.editItemId = c.id;
  app.saveItemFromForm();
  await flush(10);
  await app.saveAsync();
  app.state.ui.editItemId = null;
  ok("R-F06b 非排程字段编辑：版本推进了，时间与轮次都没变",
    Number(c.rev) > Number(revBefore) && c.triggerAt === t2 && c.note === "只改备注不改时间",
    JSON.stringify({ rev: c.rev, revBefore: revBefore, triggerAt: c.triggerAt, note: c.note }));
  ok("R-F06b 编排时那个旧版本号回来的回执仍然有效（不能机械要求 rev 相等）",
    app.applyNativeDeliveryEvidence([
      { itemId: c.id, reminderKey: "0@" + t2, carrier: "alarm",
        itemRev: String(revBefore), receivedAt: now }
    ]) === true && c.reminderEvents["0@" + t2].state === "delivered",
    JSON.stringify(c.reminderEvents));
}

section("返工3 Y1：正常接收保留轮次身份，编辑换轮与重启后旧历史不证明新轮");
{
  const evidence = require(path.join(ROOT, "lib/delivery-evidence.js"));
  const h = createApp();
  const app = await h.boot();
  app.state.settings.dnd = false;
  const now = Date.now();
  const oldBase = now - 31 * 60000;
  const oldAt = now - 60000;
  const newBase = Math.floor((now - 2 * 60000) / 60000) * 60000;
  const x = app.makeItem({ title: "接收后再改期", status: "due", triggerAt: oldBase });
  x.triggerAt = oldBase;
  app.state.items = [x];

  // 必须从真实排程登记与真实接收入口构造，不手造 delivered fixture。
  app.applyReminderEvents([{ itemId: x.id, key: "1@" + oldAt, at: oldAt }], oldBase, []);
  const received = app.applyNativeDeliveryEvidence([{
    itemId: x.id, reminderKey: "1@" + oldAt, itemRev: String(x.rev),
    token: "y1-received", carrier: "alarm", receivedAt: oldAt
  }]);
  ok("Y1 正常 scheduled → delivered 入口保留 roundBase",
    received === true && x.reminderEvents["1@" + oldAt].state === "delivered" &&
    x.reminderEvents["1@" + oldAt].roundBase === oldBase,
    JSON.stringify(x.reminderEvents));

  // 通过生产编辑保存入口换到另一轮，再由生产对账登记新轮。
  app.openEditItem(x.id);
  h.setField("#capTrigger", localInputOf(newBase));
  app.markTriggerPicked(true);
  app.saveItemFromForm();
  await flush(10);
  await app.saveAsync();
  const edited = app.state.items.find(it => it.id === x.id);
  app.applyReminderEvents([{ itemId: edited.id, key: "0@" + edited.triggerAt, at: edited.triggerAt }], now, []);
  await app.saveAsync();
  ok("Y1 编辑换轮后旧 delivered 保留为历史但不冒充当前轮",
    edited.reminderEvents["1@" + oldAt].roundBase === oldBase &&
    evidence.evidenceStatusFor(edited, { now, evidenceReadable: true, observable: true }).state !== evidence.STATUS.DELIVERED,
    JSON.stringify(edited.reminderEvents));

  const restarted = await restartApp(h.disk);
  const restored = restarted.app.state.items.find(it => it.id === x.id);
  ok("Y1 重启回读后轮次身份仍在，旧历史仍不能证明新轮已接收",
    restored.reminderEvents["1@" + oldAt].roundBase === oldBase &&
    evidence.evidenceStatusFor(restored, { now, evidenceReadable: true, observable: true }).state !== evidence.STATUS.DELIVERED,
    JSON.stringify(restored.reminderEvents));
}

section("返工3 Y2：升级前缺身份的三态保持不可验证；可证明的当前对账才补身份");
{
  const evidence = require(path.join(ROOT, "lib/delivery-evidence.js"));
  const now = Date.now();
  const oldBase = now - 60000;
  const oldAt = now + 29 * 60000;
  const newBase = now + 5 * 60000;
  const legacyStates = ["scheduled", "cancelled", "delivered"];
  const legacyItems = legacyStates.map((state, index) => ({
    id: "legacy-round-" + state,
    title: "旧台账 " + state,
    status: "due",
    triggerAt: oldBase,
    rev: index + 1,
    reminderEvents: {
      ["1@" + oldAt]: { at: oldAt, state: state, receivedAt: state === "delivered" ? oldAt : undefined }
    }
  }));
  const seed = {
    schema: 5,
    items: legacyItems,
    notes: [], projects: [],
    settings: { dnd: false, notifyEnabled: true }
  };
  const h = createApp({ seedState: seed });
  const app = await h.boot();

  app.state.items.forEach(it => {
    app.snoozeItem(it.id, newBase, "elapsed");
    app.applyReminderEvents([{ itemId: it.id, key: "0@" + newBase, at: newBase }], now,
      [{ itemId: it.id, key: "1@" + oldAt, at: oldAt }]);
  });
  await flush(8);

  app.state.items.forEach(it => {
    const first = app.applyNativeDeliveryEvidence([{
      itemId: it.id, reminderKey: "1@" + oldAt, itemRev: String(it.rev),
      token: "legacy-first", carrier: "alarm", receivedAt: oldAt
    }]);
    const duplicate = app.applyNativeDeliveryEvidence([{
      itemId: it.id, reminderKey: "1@" + oldAt, itemRev: String(it.rev),
      token: "legacy-duplicate", carrier: "alarm", receivedAt: oldAt + 1
    }]);
    ok("Y2 旧 " + it.title.split(" ")[1] + " 缺 roundBase 的乱序/重复回执均不提升当前轮",
      first === false && duplicate === false &&
      evidence.entryRoundBase(it, it.reminderEvents["1@" + oldAt]) === null &&
      evidence.evidenceStatusFor(it, { now: oldAt + 1000, evidenceReadable: true, observable: true }).state !== evidence.STATUS.DELIVERED,
      JSON.stringify(it.reminderEvents));
  });

  // 对照：旧终态缺身份，但当前原生对账明确再次登记了**同一个当前轮键**，归属可证明。
  const provenBase = now + 60 * 60000;
  const proven = app.makeItem({ title: "可证明迁移", status: "waiting", triggerAt: provenBase });
  proven.triggerAt = provenBase;
  proven.reminderEvents = {
    ["0@" + provenBase]: { at: provenBase, state: "delivered", receivedAt: provenBase }
  };
  app.state.items.push(proven);
  app.applyReminderEvents([{ itemId: proven.id, key: "0@" + provenBase, at: provenBase }], now, []);
  ok("Y2 可证明的当前轮对账补齐身份，同时保留 delivered 历史",
    proven.reminderEvents["0@" + provenBase].roundBase === provenBase &&
    proven.reminderEvents["0@" + provenBase].state === "delivered",
    JSON.stringify(proven.reminderEvents));

  await app.saveAsync();
  const restarted = await restartApp(h.disk);
  legacyStates.forEach(state => {
    const restored = restarted.app.state.items.find(it => it.id === "legacy-round-" + state);
    ok("Y2 重启后旧 " + state + " 仍是历史且身份未知",
      !!restored && evidence.entryRoundBase(restored, restored.reminderEvents["1@" + oldAt]) === null &&
      evidence.evidenceStatusFor(restored, { now: oldAt + 1000, evidenceReadable: true, observable: true }).state !== evidence.STATUS.DELIVERED,
      restored && JSON.stringify(restored.reminderEvents));
  });
  const restoredProven = restarted.app.state.items.find(it => it.id === proven.id);
  ok("Y2 可证明迁移的 roundBase 也能跨重启保留",
    restoredProven.reminderEvents["0@" + provenBase].roundBase === provenBase);
}

section("返工2 R-F03：AI 迟到结果不得覆盖新草稿（复验 X2）");
{
  const aiReply = (title, iso) => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            title: title, note: "", tags: [], priority: "normal", trigger_at: iso
          })
        }
      }]
    })
  });
  const iso = new Date(Date.now() + 86400000).toISOString();
  const aiSettings = { enabled: true, autoOnSave: true, apiKey: "fixture-only", baseUrl: "https://fixture.invalid", model: "fixture" };

  // ① 慢响应期间用户继续写第二条草稿 → 落库与界面都不许串
  const h = createApp();
  const app = await h.boot();
  app.state.settings.ai = Object.assign({}, aiSettings);
  let release = null;
  h.setFetch(() => new Promise(resolve => { release = resolve; }));
  h.setField("#capText", "明天下午3点提醒我取快递");
  app.saveItemFromForm();
  // AI 还没回来 —— 用户接着写第二条
  h.setField("#capText", "第二条尚未保存的草稿");
  h.setField("#capNote", "第二条的备注");
  release(aiReply("取快递", iso));
  await flush(12);
  await app.saveAsync();
  const saved = app.state.items.map(x => ({ title: x.title, note: x.note }));
  ok("R-F03 迟到结果不清空新草稿（旧实现：#capText 被清成空）",
    h.fieldOf("#capText") === "第二条尚未保存的草稿", JSON.stringify(h.fieldOf("#capText")));
  ok("R-F03 第二条的备注仍在表单上",
    h.fieldOf("#capNote") === "第二条的备注", JSON.stringify(h.fieldOf("#capNote")));
  ok("R-F03 第一条**没有**串进第二条的备注（旧实现：标题「取快递」+ 备注「第二条的备注」）",
    saved.length === 1 && !saved.some(x => x.note === "第二条的备注"), JSON.stringify(saved));
  ok("R-F03 第一条落库的仍是它自己草稿的内容（AI 归一化标题照常生效）",
    saved.length === 1 && saved[0].title === "取快递" && saved[0].note === "", JSON.stringify(saved));

  // ② 对照组：表单没被继续改动 ⇒ 照常走完正常路径（AI 标题生效、面板关闭、表单复位），
  //    用来证明①里的「保护」没有把正常路径一起挡掉
  const h2 = createApp();
  const app2 = await h2.boot();
  app2.state.settings.ai = Object.assign({}, aiSettings);
  h2.setFetch(async () => aiReply("取快递", iso));
  h2.setField("#capText", "明天下午3点提醒我取快递");
  app2.saveItemFromForm();
  await flush(12);
  await app2.saveAsync();
  ok("R-F03 对照组：正常路径照常落库（AI 归一化标题生效）",
    app2.state.items.length === 1 && app2.state.items[0].title === "取快递",
    JSON.stringify(app2.state.items.map(x => x.title)));
  ok("R-F03 对照组：正常路径照常关闭并复位表单（面板用 open 类，不是 hidden）",
    h2.hasClassOf("#sheetItem", "open") === false && h2.fieldOf("#capText") === "",
    JSON.stringify({ open: h2.hasClassOf("#sheetItem", "open"), text: h2.fieldOf("#capText") }));

  // ③ AI 拒绝响应：落库用冻结草稿，新草稿一个字都不动
  const h3 = createApp();
  const app3 = await h3.boot();
  app3.state.settings.ai = Object.assign({}, aiSettings);
  let rejectAi = null;
  h3.setFetch(() => new Promise((_resolve, reject) => { rejectAi = reject; }));
  h3.setField("#capText", "明天下午3点提醒我寄快递");
  h3.setField("#capNote", "第一条的备注");
  app3.saveItemFromForm();
  h3.setField("#capText", "第三条草稿");
  h3.setField("#capNote", "第三条的备注");
  rejectAi(new Error("HTTP 500"));
  await flush(12);
  await app3.saveAsync();
  const saved3 = app3.state.items.map(x => ({ title: x.title, note: x.note }));
  ok("R-F03 AI 失败时不吞掉新写的内容",
    h3.fieldOf("#capText") === "第三条草稿" && h3.fieldOf("#capNote") === "第三条的备注",
    JSON.stringify({ text: h3.fieldOf("#capText"), note: h3.fieldOf("#capNote") }));
  ok("R-F03 AI 失败时落库的是**提交时冻结的**那份草稿，不是后来写的那份",
    saved3.length === 1 && saved3[0].note === "第一条的备注" && /寄快递/.test(saved3[0].title),
    JSON.stringify(saved3));

  // ④ 关闭重开：内容碰巧一模一样，但那是**另一张表单**，旧结果无权回填
  const h4 = createApp();
  const app4 = await h4.boot();
  app4.state.settings.ai = Object.assign({}, aiSettings);
  let release4 = null;
  h4.setFetch(() => new Promise(resolve => { release4 = resolve; }));
  h4.setField("#capText", "明天的会");
  app4.saveItemFromForm();
  const sessionBefore = app4.formSession;
  app4.openCapture();                      // 关掉重开 = 新会话
  h4.setField("#capText", "明天的会");      // 用户又写下一模一样的内容
  ok("R-F03 前置：重开表单确实换了会话身份",
    app4.formSession !== sessionBefore, JSON.stringify({ before: sessionBefore, after: app4.formSession }));
  release4(aiReply("开会", iso));
  await flush(12);
  await app4.saveAsync();
  ok("R-F03 换表单之后迟到的 AI 结果不碰新表单（内容相同也不行）",
    h4.fieldOf("#capText") === "明天的会", JSON.stringify(h4.fieldOf("#capText")));

  // ⑤ 连续两次不同内容的提交：各自的 AI 结果只落到自己那条
  const h5 = createApp();
  const app5 = await h5.boot();
  app5.state.settings.ai = Object.assign({}, aiSettings);
  const resolvers = [];
  h5.setFetch(() => new Promise(resolve => { resolvers.push(resolve); }));
  h5.setField("#capText", "明天下午3点提醒我取快递");
  app5.saveItemFromForm();
  h5.setField("#capText", "后天上午10点提醒我交材料");
  app5.saveItemFromForm();
  ok("R-F03 前置：两次不同内容的提交各自都在途", resolvers.length === 2, String(resolvers.length));
  resolvers[1](aiReply("交材料", iso));   // 后发的先回
  await flush(10);
  resolvers[0](aiReply("取快递", iso));
  await flush(12);
  await app5.saveAsync();
  const titles5 = app5.state.items.map(x => x.title).sort();
  ok("R-F03 两次提交各落一条、内容不串写",
    titles5.length === 2 && titles5[0] === "交材料" && titles5[1] === "取快递",
    JSON.stringify(titles5));
}

section("返工3 Y3：新建/编辑的持久化收尾必须绑定表单会话");
{
  const text = "明天下午3点提醒我取快递";

  // ① 新建成功：旧会话完成时，新会话即使内容相同也不能被清空；且新会话仍可正常再提交。
  const h1 = createApp();
  const app1 = await h1.boot();
  app1.openCapture();
  h1.holdCommits(true);
  h1.setField("#capText", text);
  const firstSession = app1.formSession;
  app1.saveItemFromForm();
  await flush(2);
  app1.openCapture();
  h1.setField("#capText", text);
  const secondSession = app1.formSession;
  h1.holdCommits(false);
  h1.releaseCommits();
  await flush(10);
  ok("Y3 新建成功回调不清空另一会话的同内容表单",
    secondSession !== firstSession && h1.fieldOf("#capText") === text && h1.hasClassOf("#sheetItem", "open"),
    JSON.stringify({ firstSession, secondSession, text: h1.fieldOf("#capText") }));
  ok("Y3 新会话同内容不是重复点击，仍可独立提交",
    app1.saveItemFromForm() !== false);
  await flush(10);
  await app1.saveAsync();
  ok("Y3 两个独立会话各自落库一次",
    app1.state.items.filter(it => /取快递/.test(it.title)).length === 2,
    JSON.stringify(app1.state.items.map(it => it.title)));

  // ② 新建失败：旧会话失败恢复不能覆盖另一会话；同会话失败仍保留正常恢复。
  const h2 = createApp();
  const app2 = await h2.boot();
  app2.openCapture();
  h2.holdCommits(true);
  h2.setField("#capText", text);
  app2.saveItemFromForm();
  await flush(2);
  app2.openCapture();
  h2.setField("#capText", text);
  h2.setCommitFailure(true);
  h2.holdCommits(false);
  h2.releaseCommits();
  await flush(10);
  ok("Y3 新建失败回调不把旧草稿恢复到另一会话",
    h2.fieldOf("#capText") === text && h2.hasClassOf("#sheetItem", "open"));

  const h3 = createApp();
  const app3 = await h3.boot();
  app3.openCapture();
  h3.holdCommits(true);
  h3.setField("#capText", "同会话失败要保留");
  app3.saveItemFromForm();
  await flush(2);
  h3.setCommitFailure(true);
  h3.holdCommits(false);
  h3.releaseCommits();
  await flush(10);
  ok("Y3 对照组：同会话保存失败仍保留草稿并打开表单",
    h3.fieldOf("#capText") === "同会话失败要保留" && h3.hasClassOf("#sheetItem", "open"));

  // ③ 编辑成功/失败同样受会话约束，不能只修新建路径。
  for (const shouldFail of [false, true]) {
    const h = createApp();
    const app = await h.boot();
    const item = app.makeItem({ title: "编辑前", status: "waiting", triggerAt: Date.now() + 3600000 });
    app.state.items = [item];
    app.openEditItem(item.id);
    h.holdCommits(true);
    h.setField("#capText", "编辑后");
    app.saveItemFromForm();
    await flush(2);
    app.openCapture();
    h.setField("#capText", "编辑后");
    if (shouldFail) h.setCommitFailure(true);
    h.holdCommits(false);
    h.releaseCommits();
    await flush(10);
    ok("Y3 编辑" + (shouldFail ? "失败" : "成功") + "回调不碰另一会话的同内容表单",
      h.fieldOf("#capText") === "编辑后" && h.hasClassOf("#sheetItem", "open"));
  }
}

section("返工2 R-F07：停铃读取失败不冒充「没有正在响」（复验 X4）");
{
  const runAt = Date.now() - 1000;
  const seedRun = (app) => {
    app.state.settings.testRun = {
      id: 90003, startedAt: runAt, triggerAt: runAt + 60000, stoppedAt: null
    };
  };

  // ① 读取失败：只能说「读不到」，不许宣称已停/没有在响，也不许把 stoppedAt 当成功证据
  {
    const cap = installCapacitor();
    const sb = global.Capacitor.Plugins.SystemBridge;
    sb.activeAlarmDeliveries = async () => { throw new Error("bridge read failed"); };
    sb.stopAlarmDelivery = async () => ({ stopped: false });
    const h = createApp();
    const app = await h.boot();
    seedRun(app);
    const stopped = await app.stopSetupTestRun();
    const text = h.textOf("#toastText");
    ok("R-F07 读取失败时不报「停掉了几条」", stopped === 0, String(stopped));
    ok("R-F07 读取失败不说「没有正在响」（旧实现：读异常被吞，照报「没有正在响的测试铃声」）",
      !/没有正在响/.test(text), text);
    ok("R-F07 读取失败也不宣称已经停住",
      !/已停止|已经停了/.test(text), text);
    ok("R-F07 未确认就不把 stoppedAt 当成功证据（旧实现：无条件写 stoppedAt）",
      !app.state.settings.testRun.stoppedAt, String(app.state.settings.testRun.stoppedAt));
    ok("R-F07 未确认时给出重试入口",
      h.textOf("#toastAction") === "重试" && h.hiddenOf("#toastAction") === false,
      JSON.stringify({ text: h.textOf("#toastAction"), hidden: h.hiddenOf("#toastAction") }));
    cap.cleanup();
  }

  // ② 对照组：读成功且确认没有活跃投递 ⇒ 这就是「确认无铃」，可以记 stoppedAt
  {
    const cap = installCapacitor();
    const sb = global.Capacitor.Plugins.SystemBridge;
    sb.activeAlarmDeliveries = async () => ({ alarms: [] });
    sb.stopAlarmDelivery = async () => ({ stopped: true });
    const h = createApp();
    const app = await h.boot();
    seedRun(app);
    const stopped = await app.stopSetupTestRun();
    ok("R-F07 对照组：确认无活跃投递时如实说「没有正在响的测试铃声」",
      stopped === 0 && /没有正在响的测试铃声/.test(h.textOf("#toastText")), h.textOf("#toastText"));
    ok("R-F07 对照组：确认无铃才算确认，可以记 stoppedAt",
      app.state.settings.testRun.stoppedAt > 0, String(app.state.settings.testRun.stoppedAt));
    cap.cleanup();
  }

  // ③ 对照组：确实停住了 ⇒ 说停住了，并记 stoppedAt
  {
    const cap = installCapacitor();
    const sb = global.Capacitor.Plugins.SystemBridge;
    sb.activeAlarmDeliveries = async () => ({ alarms: [{ id: 90003, token: "tok-x", receivedAt: runAt + 1000 }] });
    sb.stopAlarmDelivery = async () => ({ stopped: true });
    const h = createApp();
    const app = await h.boot();
    seedRun(app);
    const stopped = await app.stopSetupTestRun();
    ok("R-F07 对照组：真的停住了就报停住", stopped === 1 && /已停止本次测试的铃声/.test(h.textOf("#toastText")),
      JSON.stringify({ stopped: stopped, text: h.textOf("#toastText") }));
    ok("R-F07 对照组：停住后记 stoppedAt",
      app.state.settings.testRun.stoppedAt > 0, String(app.state.settings.testRun.stoppedAt));
    cap.cleanup();
  }

  // ④ 有活跃投递但**没停成功** ⇒ 不许宣称已停、也不许说「没有在响」
  {
    const cap = installCapacitor();
    const sb = global.Capacitor.Plugins.SystemBridge;
    sb.activeAlarmDeliveries = async () => ({ alarms: [{ id: 90003, token: "tok-x", receivedAt: runAt + 1000 }] });
    sb.stopAlarmDelivery = async () => ({ stopped: false });
    const h = createApp();
    const app = await h.boot();
    seedRun(app);
    const stopped = await app.stopSetupTestRun();
    const text = h.textOf("#toastText");
    ok("R-F07 停不住时不宣称已停", stopped === 0 && !/已停止|已经停了/.test(text), text);
    ok("R-F07 停不住时也不谎称「没有在响」", !/没有正在响/.test(text), text);
    ok("R-F07 停不住时同样不记 stoppedAt（那是成功证据，不是尝试记录）",
      !app.state.settings.testRun.stoppedAt, String(app.state.settings.testRun.stoppedAt));
    cap.cleanup();
  }
}

section("返工2 SW：预缓存必须覆盖 index.html 真正加载的每个脚本，且脚本不得回落成 HTML");
{
  const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const htmlSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  // 期望集合**从 index.html 推出来**，不是抄一份清单 ——
  // 抄一份只是把同一个遗漏复制进测试里（这个缺口当初正是这么活下来的）。
  const wanted = [];
  htmlSource.replace(/<script[^>]+src="([^"]+)"/g, (_m, src) => {
    wanted.push("./" + src.replace(/^\.\//, ""));
    return _m;
  });
  ok("SW 前置：index.html 确实加载了脚本", wanted.length >= 6, JSON.stringify(wanted));
  ok("SW 前置：原生桥脚本在 index.html 的加载清单里（否则这条回归测不到那个缺口）",
    wanted.indexOf("./lib/native-reminders.js") >= 0, JSON.stringify(wanted));

  // 真跑生产 install / fetch 处理函数：内存缓存 + 离线网络
  const handlers = {};
  const cache = new Map();
  const base = "https://fixture.invalid/";
  const key = x => new URL(typeof x === "string" ? x : x.url, base).href;
  const sandbox = {
    URL,
    self: {
      location: { origin: new URL(base).origin },
      addEventListener: (n, f) => { handlers[n] = f; },
      skipWaiting: async () => {},
      clients: { matchAll: async () => [] }
    },
    fetch: async () => { throw new Error("offline"); },
    caches: {
      open: async () => ({
        addAll: async paths => paths.forEach(p => {
          cache.set(key(p), fs.readFileSync(path.join(ROOT, p === "./" ? "index.html" : p), "utf8"));
        })
      }),
      match: async req => cache.get(key(req)),
      keys: async () => [], delete: async () => {}
    }
  };
  vm.runInNewContext(swSource, sandbox);
  let installing;
  handlers.install({ waitUntil: p => { installing = p; } });
  await installing;

  const missing = wanted.filter(u => !cache.has(base + u.replace(/^\.\//, "")));
  ok("SW 新装预缓存覆盖 index.html 加载的**全部**脚本（旧实现：漏 lib/native-reminders.js）",
    missing.length === 0, JSON.stringify(missing));

  const bridgeSrc = fs.readFileSync(path.join(ROOT, "lib/native-reminders.js"), "utf8");
  let response;
  handlers.fetch({
    request: { method: "GET", url: base + "lib/native-reminders.js" },
    respondWith: p => { response = p; }
  });
  const body = await response;
  ok("SW 离线时原生桥脚本拿回的是**脚本本身**，不是 index.html",
    body === bridgeSrc && body !== htmlSource,
    typeof body === "string" ? body.slice(0, 48) : String(body));

  // 预缓存完整**不等于**回落规则正确：上面那条只能证明「清单补全了」。
  // 缓存未命中的**脚本**（运行时才加载的新模块、被清掉的条目）也必须如实失败，
  // 而不是回落成 HTML —— 旧实现 `hit || caches.match("./index.html")` 会让它拿到
  // 一段 HTML，浏览器把它当 JS 执行 → 原生桥无声消失。两条缺一不可。
  let uncached;
  handlers.fetch({
    request: { method: "GET", url: base + "lib/runtime-only.js" },
    respondWith: p => { uncached = p; }
  });
  const uncachedBody = await uncached;
  ok("SW 缓存未命中的脚本**不回落** index.html（旧实现：`.then(hit => hit || caches.match(\"./index.html\"))`）",
    uncachedBody !== htmlSource,
    typeof uncachedBody === "string" ? uncachedBody.slice(0, 48) : String(uncachedBody));

  // 对照：页面导航仍然要有 HTML 兜底，否则离线打开就是白屏
  let nav;
  handlers.fetch({
    request: { method: "GET", url: base + "deep/route", mode: "navigate" },
    respondWith: p => { nav = p; }
  });
  ok("SW 对照组：离线导航仍然回落 index.html",
    (await nav) === htmlSource);
}

section("返工4：编辑表单保留未修改时间、区分改期/清空/稍后、验证重载持久化（修复方案 第一阶段）");
{
  const h = createApp();
  const app = await h.boot();
  app.state.settings.dnd = false;
  const now = Date.now();
  const origTrigger = Math.floor((now + 24 * 3600000) / 60000) * 60000;

  // ① DV-03 真实编辑入口修改标题不丢失原提醒时间
  const it1 = app.makeItem({
    title: "明天15点实机验证编辑反例",
    status: "waiting",
    priority: "normal",
    triggerAt: origTrigger,
    scheduleBasis: "wall-clock",
    localTrigger: localInputOf(origTrigger)
  });
  app.state.items = [it1];
  await app.saveAsync();
  await flush(10);

  // 模拟真实界面操作：打开编辑页，仅修改标题为不带时间词的文本，未碰时间框
  app.openEditItem(it1.id);
  h.setField("#capText", "实机验证改标题反例");
  app.saveItemFromForm();
  await flush(10);
  await app.saveAsync();

  const it1After = app.state.items.find(x => x.id === it1.id);
  ok("P1-01 编辑标题不丢失原时间：triggerAt 保持原值",
    it1After.triggerAt === origTrigger,
    String(it1After.triggerAt) + " vs " + origTrigger);
  ok("P1-01 编辑标题不丢失原时间：localTrigger 保持原值",
    it1After.localTrigger === localInputOf(origTrigger),
    String(it1After.localTrigger));
  ok("P1-01 编辑标题成功更新标题文本",
    it1After.title === "实机验证改标题反例",
    it1After.title);

  // 重启验证：持久化在重启后保持
  const restarted1 = await restartApp(h.disk);
  const restored1 = restarted1.app.state.items.find(x => x.id === it1.id);
  ok("P1-01 重启后验证：triggerAt 与 localTrigger 完整保持",
    restored1 && restored1.triggerAt === origTrigger && restored1.localTrigger === localInputOf(origTrigger),
    restored1 ? JSON.stringify({ triggerAt: restored1.triggerAt, localTrigger: restored1.localTrigger }) : "missing");

  // ② 编辑标题含新时间词：默认保留编辑页已有时间，不被重新解析覆盖
  app.openEditItem(it1.id);
  h.setField("#capText", "明天下午3点改标题带时间词");
  app.saveItemFromForm();
  await flush(10);
  await app.saveAsync();
  const it1WithTimeWords = app.state.items.find(x => x.id === it1.id);
  ok("P1-02 编辑标题含时间词不覆盖表单已有时间",
    it1WithTimeWords.triggerAt === origTrigger && it1WithTimeWords.title === "明天下午3点改标题带时间词",
    String(it1WithTimeWords.triggerAt));

  // ③ 仅编辑非时间字段（备注、标签、优先级、项目）
  app.openEditItem(it1.id);
  h.setField("#capNote", "新增备注内容");
  h.setField("#capTags", "工作 紧急");
  app.saveItemFromForm();
  await flush(10);
  await app.saveAsync();
  const it1Fields = app.state.items.find(x => x.id === it1.id);
  ok("P1-03 编辑非时间字段保持原提醒时间与基准",
    it1Fields.triggerAt === origTrigger && it1Fields.note === "新增备注内容" && it1Fields.tags.includes("工作"),
    JSON.stringify({ triggerAt: it1Fields.triggerAt, note: it1Fields.note, tags: it1Fields.tags }));

  // ④ 显式手动改期：采用用户选择，重置轮次并建立新调度
  const newTrigger = origTrigger + 3 * 3600000;
  app.openEditItem(it1.id);
  h.setField("#capTrigger", localInputOf(newTrigger));
  app.markTriggerPicked(true);
  it1.remindCount = 2; // 模拟已有催促计数
  app.saveItemFromForm();
  await flush(10);
  await app.saveAsync();
  const it1Rescheduled = app.state.items.find(x => x.id === it1.id);
  ok("P1-04 手动选择新时间：triggerAt 更新为新时间",
    it1Rescheduled.triggerAt === newTrigger,
    String(it1Rescheduled.triggerAt));
  ok("P1-04 手动选择新时间：轮次重置 remindCount=0",
    it1Rescheduled.remindCount === 0,
    String(it1Rescheduled.remindCount));

  // ⑤ 显式清空时间：保存为无提醒，不得用兜底时间补回
  app.openEditItem(it1.id);
  h.setField("#capTrigger", "");
  app.markTriggerPicked(true);
  app.saveItemFromForm();
  await flush(10);
  await app.saveAsync();
  const it1Cleared = app.state.items.find(x => x.id === it1.id);
  ok("P1-05 显式清空时间：triggerAt 为 null",
    it1Cleared.triggerAt === null,
    String(it1Cleared.triggerAt));
  ok("P1-05 显式清空时间：localTrigger 为 null 或空",
    !it1Cleared.localTrigger,
    String(it1Cleared.localTrigger));

  // ⑥ 稍后提醒（elapsed）事项仅修改标题：保留 scheduleBasis、snoozedAt、snoozeDelayMs 等语义
  const snoozedItem = app.makeItem({
    title: "稍后提醒事项",
    status: "waiting",
    priority: "normal",
    triggerAt: now + 3600000
  });
  app.state.items.push(snoozedItem);
  await app.saveAsync();
  const snoozeWhen = now + 7200000;
  app.snoozeItem(snoozedItem.id, snoozeWhen, "elapsed");
  await app.saveAsync();
  await flush(10);

  const snoozedBefore = app.state.items.find(x => x.id === snoozedItem.id);
  const snoozedAtBefore = snoozedBefore.snoozedAt;
  const snoozeDelayBefore = snoozedBefore.snoozeDelayMs;
  const statusBefore = snoozedBefore.status;

  // 打开编辑表单，仅改标题
  app.openEditItem(snoozedItem.id);
  h.setField("#capText", "稍后事项改标题");
  app.saveItemFromForm();
  await flush(10);
  await app.saveAsync();

  const snoozedAfter = app.state.items.find(x => x.id === snoozedItem.id);
  ok("P1-06 稍后事项改标题：scheduleBasis 保持 elapsed",
    snoozedAfter.scheduleBasis === "elapsed",
    snoozedAfter.scheduleBasis);
  ok("P1-06 稍后事项改标题：snoozedAt 保持不变",
    snoozedAfter.snoozedAt === snoozedAtBefore,
    String(snoozedAfter.snoozedAt));
  ok("P1-06 稍后事项改标题：snoozeDelayMs 保持不变",
    snoozedAfter.snoozeDelayMs === snoozeDelayBefore,
    String(snoozedAfter.snoozeDelayMs));
  ok("P1-06 稍后事项改标题：status 保持 snoozed",
    snoozedAfter.status === statusBefore,
    snoozedAfter.status);

  // ⑦ 重启验证稍后事项持久化
  const restarted2 = await restartApp(h.disk);
  const snoozedRestored = restarted2.app.state.items.find(x => x.id === snoozedItem.id);
  ok("P1-07 重启后稍后事项元数据完整恢复",
    snoozedRestored && snoozedRestored.scheduleBasis === "elapsed" &&
    snoozedRestored.snoozedAt === snoozedAtBefore &&
    snoozedRestored.snoozeDelayMs === snoozeDelayBefore,
    snoozedRestored ? JSON.stringify({ basis: snoozedRestored.scheduleBasis, snoozedAt: snoozedRestored.snoozedAt }) : "missing");
}
}

run().then(() => {
  console.log("\n========== 回归结果 ==========");
  console.log("通过: " + passed + "  失败: " + failed);
  if (failed) {
    console.log("失败项:");
    failures.forEach(f => console.log("  - " + f));
    process.exit(1);
  }
  console.log("全部通过。");
}).catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
