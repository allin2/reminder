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

const LIB_SOURCES = ["lib/parse-cn.js", "lib/repeat.js", "lib/reminder.js", "lib/storage.js"]
  .map(f => ({ name: f, code: fs.readFileSync(path.join(ROOT, f), "utf8") }));
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
    /** 读回表单元素（断言表单被写入的值） */
    fieldOf(selector) {
      return document.querySelector(selector).value;
    },
    textOf(selector) {
      return document.querySelector(selector).textContent;
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
    ok("Q1 真机契约：seed 生效 —— 证明 init 第 5129 行之后的代码真的跑了",
      app.state.items.length > 0, "items=" + app.state.items.length);
    ok("Q1 真机契约：15 秒心跳已装上（启动链跑到底的标志）",
      h.intervals.some(x => x.ms === 15000), JSON.stringify(h.intervals.map(x => x.ms)));
  }

  // ② 官方 capacitor.js 契约：返回 Promise（并把 .remove 挂在上面）—— 归一化后同样必须可用
  {
    const { app, calls, ready } = await withPlatform(() => {
      const p = Promise.resolve({ remove: async () => {} });
      p.remove = async () => {};
      return p;
    });
    ok("Q1 Promise 契约：同样能注册且不中断启动",
      calls.appListener === 1 && ready === true);
    ok("Q1 Promise 契约：seed 与心跳照常", app.state.items.length > 0);
  }

  // ③ 平台同步抛错：注册失败必须被隔离，不能拖垮整条启动链
  {
    const { app, ready } = await withPlatform(() => { throw new Error("plugin not registered"); });
    ok("Q1 注册同步抛错：错误被隔离，ready() 仍为 true", ready === true);
    ok("Q1 注册同步抛错：其余启动动作照常完成（seed 生效）",
      app.state.items.length > 0, "items=" + app.state.items.length);
  }
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
