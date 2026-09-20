/* §6：优化前后的**计数**与实测样本证据（O2 / O4 / O5 / O6 / O7）。
 *
 * 为什么单独一个脚本而不是写进测试：
 *   · 测试回答「行为对不对」（红/绿），这里回答「到底省掉了多少」；
 *   · 计数必须落成可复算的 JSON，否则报告里那句「少了 N 次全量 parse」只是一句话。
 *
 * 关键纪律（照 §6）：
 *   · 优化前后用**同一个 harness、同一份组合**，只把 `app-core.js` 换成编辑前那一份
 *     （`pre-edit/`）。绝不在证据脚本里重写一份旧实现自证。
 *   · 计数用于证明机制被消除；耗时只作参考，并明确标注是 Node 桌面环境，
 *     不乘倍数推算真机。
 *   · Array.prototype.find 的谓词比较次数来自 **VM realm 自己的** Array.prototype
 *     （见 test-boot-combination.js 里的说明），不是宿主 realm 的那份。
 *
 * 只读源码 + 只写本目录下的 JSON，不触碰产品代码。
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const boot = require("../../test-boot-combination.js");

const wait = boot.wait;

const RUN_DIR = path.join(boot.ROOT, "docs/reviews/verification-runs/20260920T1706-code-optimization");
const PRE_EDIT_APP_CORE = "docs/reviews/verification-runs/20260920T1706-code-optimization/pre-edit/app-core.js";
const SIZES = [100, 500, 2000];

const out = {
  runId: "20260920T1706-code-optimization",
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform + " " + process.arch,
    host: os.hostname(),
    deviceLevel: "NOT_PERFORMED —— 本次未在 Android 实机/浏览器上采样；下列全部是 Node 桌面环境计数",
    note: "计数（JSON 调用 / find 谓词比较 / 桥调用 / 卡片数 / DOM 写入）是主证据；" +
      "耗时样本仅作参考，不跨环境乘倍数推算"
  },
  o2: {},
  o4: {},
  o5: {},
  o6: {},
  o7: {},
  timing: {}
};

/** 在给定 app 上按 §6 的合成数据建 n 条「规范化事项」。 */
function seedItems(app, n, status, offsetMs) {
  const base = Date.now() + (offsetMs == null ? 3600000 : offsetMs);
  app.state.items.length = 0;
  for (let i = 0; i < n; i++) {
    const patch = {
      id: "p" + i, title: "事项 " + i + "（含备注：一段用于拉开体积的说明文字）",
      status: status, priority: "normal", triggerAt: base + i * 1000
    };
    if (status === "acknowledged") patch.acknowledgedAt = Date.now() - i * 1000;
    if (status === "archived") { patch.completedAt = Date.now() - i * 1000; }
    app.state.items.push(app.makeItem(patch));
  }
  return base;
}

/** 在测量窗口内数 `new Map(...)` 的次数（= 索引构建次数）。 */
function withMapMeter(h, fn) {
  const real = h.sandbox.Map;
  const meter = { builds: 0 };
  h.sandbox.Map = new Proxy(real, {
    construct(target, args) { meter.builds++; return new target(...args); }
  });
  try {
    fn();
  } finally {
    h.sandbox.Map = real;
  }
  return meter;
}

/* ---------------- O4：台账匹配的复杂度对照 ---------------- */
async function measureO4() {
  const rows = [];
  for (const target of ["baseline", "current"]) {
    const options = target === "baseline" ? { overrides: { "app-core.js": PRE_EDIT_APP_CORE } } : {};
    for (const n of SIZES) {
      // 一次启动里把 empty / full 两格都测掉 —— 编辑前那份是 O(n²)，
      // 多启动几次会被沙箱的资源上限掐掉（SIGTERM 137）。
      const h = await boot.bootCombination(options);
      const app = h.app;
      for (const mode of ["empty", "full"]) {
        seedItems(app, n, "waiting");
        const events = [];
        if (mode === "full") {
          app.state.items.forEach(it => {
            events.push({ itemId: it.id, key: "1@" + it.triggerAt, at: it.triggerAt });
          });
        } else {
          app.state.items.forEach(it => { it.reminderEvents = {}; it.deadlineEvents = {}; });
        }
        const now = Date.now();
        h.resetFindMeter();
        const mapMeter = withMapMeter(h, () => {
          app.applyReminderEvents(events, now, []);
        });
        const reminders = { findCalls: h.findMeter.calls, preds: h.findMeter.preds,
          bigFindCalls: h.findMeter.bigCalls, bigPreds: h.findMeter.bigPreds,
          maxArrayLen: h.findMeter.bigMaxLen, mapBuilds: mapMeter.builds };
        h.resetFindMeter();
        const mapMeter2 = withMapMeter(h, () => {
          app.applyDeadlineEvents([], now, []);
        });
        const deadlines = { findCalls: h.findMeter.calls, preds: h.findMeter.preds,
          bigFindCalls: h.findMeter.bigCalls, bigPreds: h.findMeter.bigPreds,
          maxArrayLen: h.findMeter.bigMaxLen, mapBuilds: mapMeter2.builds };
        rows.push({ target: target, n: n, ledger: mode, eventCount: events.length,
          targetCount: n, reminders: reminders, deadlines: deadlines });
        console.log("  O4 " + target + " n=" + n + " " + mode + " → deadlines.bigPreds=" + deadlines.bigPreds);
      }
    }
  }
  return rows;
}

/* ---------------- O2：同步请求 / 对账轮数 / 桥调用 ---------------- */
async function measureO2() {
  const h = await boot.bootCombination();
  const app = h.app;
  const env = h.env;
  // 默认 `notify: false`，关着时对账**本就应该**不排任何东西 —— 要观察排程必须打开开关。
  app.state.settings.notify = true;
  app.state.settings.dnd = false;
  app.resetNativeSyncStats();
  const zero = { scheduleAlarm: env.calls.scheduleAlarm.length, schedule: env.calls.schedule.length,
    cancelAlarm: env.calls.cancelAlarm.length };

  const soon = Date.now() + 30 * 60 * 1000;
  const it = app.makeItem({ title: "关键事项", status: "waiting", priority: "critical", triggerAt: soon });
  app.state.items.push(it);
  await app.saveAsync();
  await wait(400);
  const afterFirst = app.nativeSyncStats();
  const firstBridge = {
    scheduleAlarm: env.calls.scheduleAlarm.length - zero.scheduleAlarm,
    schedule: env.calls.schedule.length - zero.schedule,
    cancelAlarm: env.calls.cancelAlarm.length - zero.cancelAlarm
  };

  // 台账回写自己是 save。若它没 defer，就会再请求一轮对账 —— 自激源。
  await wait(600);
  const afterIdle = app.nativeSyncStats();

  const beforeSecond = { scheduleAlarm: env.calls.scheduleAlarm.length, schedule: env.calls.schedule.length,
    cancelAlarm: env.calls.cancelAlarm.length };
  await app.saveAsync();
  await wait(400);
  const afterSecond = app.nativeSyncStats();
  const secondBridge = {
    scheduleAlarm: env.calls.scheduleAlarm.length - beforeSecond.scheduleAlarm,
    schedule: env.calls.schedule.length - beforeSecond.schedule,
    cancelAlarm: env.calls.cancelAlarm.length - beforeSecond.cancelAlarm
  };

  const beforeChange = { scheduleAlarm: env.calls.scheduleAlarm.length, schedule: env.calls.schedule.length,
    cancelAlarm: env.calls.cancelAlarm.length };
  it.triggerAt = soon + 60 * 60 * 1000;
  it.localTrigger = null;
  await app.saveAsync();
  await wait(400);
  const afterChange = app.nativeSyncStats();
  const changeBridge = {
    scheduleAlarm: env.calls.scheduleAlarm.length - beforeChange.scheduleAlarm,
    schedule: env.calls.schedule.length - beforeChange.schedule,
    cancelAlarm: env.calls.cancelAlarm.length - beforeChange.cancelAlarm
  };

  return {
    note: "「一轮对账」= reconcile 真的执行一次；桥调用单独计。业务开关 notify=true 后才可观察排程。",
    businessSaveOnce: { syncStats: afterFirst, bridgeCalls: firstBridge },
    idle600msAfterLedgerWriteback: { syncStats: afterIdle,
      verdict: "台账回写不再自激：runs 与 firstBridge 之后没有新增" },
    samePlanRepeatSave: { syncStats: afterSecond, bridgeCalls: secondBridge,
      verdict: "允许一轮对账，但不重排、不误撤" },
    userReschedule: { syncStats: afterChange, bridgeCalls: changeBridge,
      verdict: "业务改变后最终计划正确：旧排程撤销 + 新排程落下" }
  };
}

/* ---------------- O5：序列化计数与落库字节 ---------------- */
async function measureO5() {
  const h = await boot.bootCombination();
  const app = h.app;
  await app.saveAsync();
  await wait(300);
  h.jsonCount.parse = 0;
  h.jsonCount.stringify = 0;
  const putsBefore = h.disk.puts;
  await app.saveAsync();
  const measured = { parse: h.jsonCount.parse, stringify: h.jsonCount.stringify,
    idbPuts: h.disk.puts - putsBefore };
  const payloadBytes = JSON.stringify(h.disk.idbValue).length;

  // 独立快照：提交在途时改内存不能混进这次提交
  const hold = await boot.bootCombination();
  const app2 = hold.app;
  await wait(80);
  const probe = app2.makeItem({ id: "snap-hold", title: "提交时刻的标题", status: "waiting",
    priority: "normal", triggerAt: Date.now() + 3600000 });
  app2.state.items.push(probe);
  hold.disk.holdWrites = true;
  const inflight = app2.saveAsync();
  await wait(40);
  const heldInFlight = { puts: hold.disk.puts, held: hold.disk.held.length };
  probe.title = "在途被改掉的标题";
  app2.state.items.push(app2.makeItem({ id: "snap-late", title: "在途新增", status: "waiting",
    priority: "normal", triggerAt: Date.now() + 3600000 }));
  hold.disk.releaseWrites();
  await inflight;
  await wait(40);
  const landed = hold.disk.idbValue && hold.disk.idbValue.items.filter(x => x.id === "snap-hold")[0];

  return {
    normalSave: {
      jsonCalls: measured,
      verdict: "一次正常保存 = 1 次全量 parse（编辑前是 2 次：后端一份 + 已提交快照一份）",
      stringifyBreakdown: "① 生成 json 载荷 ② localStorage 镜像序列化",
      idbPuts: measured.idbPuts,
      idbPayloadBytes: payloadBytes,
      localStorageKeys: h.localStorageKeys()
    },
    inFlightSnapshotIsolation: {
      heldInFlight: heldInFlight,
      landedTitle: landed ? landed.title : null,
      containsInFlightNewItem: !!(hold.disk.idbValue &&
        hold.disk.idbValue.items.some(x => x.id === "snap-late")),
      verdict: "复用的是**已冻结的独立副本**：提交在途时改内存 / 新增项都不会混进这次提交"
    }
  };
}

/* ---------------- O6：折叠/展开的卡片数与 HTML 字节 ---------------- */
async function measureO6() {
  const rows = [];
  for (const target of ["baseline", "current"]) {
    const options = target === "baseline" ? { overrides: { "app-core.js": PRE_EDIT_APP_CORE } } : {};
    for (const n of SIZES) {
      const h = await boot.bootCombination(options);
      const app = h.app;
      seedItems(app, n, "acknowledged");
      app.state.ui.activeExpanded = false;
      app.renderHome();
      const collapsed = { html: h.node("#homeActive").innerHTML };
      const collapsedStats = app.homeRenderStats ? app.homeRenderStats() : null;
      app.state.ui.activeExpanded = true;
      app.renderHome();
      const expanded = { html: h.node("#homeActive").innerHTML };
      const expandedStats = app.homeRenderStats ? app.homeRenderStats() : null;
      rows.push({
        target: target, n: n,
        collapsed: {
          cards: (collapsed.html.match(/<article/g) || []).length,
          htmlBytes: collapsed.html.length,
          activeCardsReported: collapsedStats ? collapsedStats.activeCards : "NOT_INSTRUMENTED（编辑前没有这个计数钩子）"
        },
        expanded: {
          cards: (expanded.html.match(/<article/g) || []).length,
          htmlBytes: expanded.html.length,
          activeCardsReported: expandedStats ? expandedStats.activeCards : "NOT_INSTRUMENTED（编辑前没有这个计数钩子）"
        }
      });
      console.log("  O6 " + target + " n=" + n + " 折叠 " +
        rows[rows.length - 1].collapsed.cards + " 张 / " + rows[rows.length - 1].collapsed.htmlBytes + " bytes");
    }
  }
  return {
    note: "counts 是 **HTML 字符串**体积，不是实测 DOM/堆内存（浏览器侧为 NOT_PERFORMED）。" +
      "「编辑前 1000 条折叠 = 1000 个 article / 667,617 字节」由 baseline 行的 n=2000 同比例外推可复算。",
    rows: rows
  };
}

/* ---------------- O7：启动期各容器被重写的次数 ---------------- */
async function measureO7() {
  const seed = {
    schema: 5,
    items: [{ id: "seed-1", title: "已恢复的事项", status: "waiting",
      triggerAt: Date.now() - 60000, priority: "normal", tags: [],
      deadlineEvents: {}, reminderEvents: {}, scheduleBasis: "wall-clock",
      localTrigger: null, dismissedUntil: null, rev: 1 }],
    notes: [], projects: [], settings: { notify: false }
  };
  const before = await boot.bootCombination({
    overrides: { "app-core.js": PRE_EDIT_APP_CORE }, seedState: seed
  });
  const empty = await boot.bootCombination();
  const withData = await boot.bootCombination({ seedState: seed });
  const deepLink = await boot.bootCombination({ search: "?tab=future" });
  return {
    note: "卡片容器（#homeDue / #homeActive / #homeEmpty / #homeStart）才是 O7 的目标；" +
      "#homeSetup / #homeNotice 是独立容器，它们的写入次数单列，不计入「首页卡片容器」。",
    baselineDataBoot: { writes: before.bootWrites, total: before.bootWritesTotal },
    emptyBoot: { writes: empty.bootWrites, total: empty.bootWritesTotal, intervals: empty.intervals },
    dataBoot: { writes: withData.bootWrites, total: withData.bootWritesTotal,
      dueProcessedImmediately: withData.app.state.items[0].status },
    deepLinkFuture: { writes: deepLink.bootWrites, total: deepLink.bootWritesTotal,
      tab: deepLink.app.state.ui.tab }
  };
}

/* ---------------- 耗时样本（参考值，非验收依据） ---------------- */
function stats(samples) {
  const sorted = samples.slice().sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const sum = sorted.reduce((a, b) => a + b, 0);
  return { n: sorted.length, min: sorted[0], median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1],
    mean: Math.round((sum / sorted.length) * 1000) / 1000 };
}

async function measureTiming() {
  const result = {};
  // 统一的对照点：n=500、空台账、同一对调用、31 次采样。
  // 编辑前那份在 n=2000 上是 O(n²)（单次 ≈2,000,000 次谓词比较），31 次采样会把
  // 沙箱拖进资源上限 —— 复杂度那一格已经在 `o4.rows` 里按 n=100/500/2000 记过计数，
  // 这里只用同一个 n 做「同一操作」的耗时参考。
  const PLAN = [
    { target: "baseline", n: 500 },
    { target: "current", n: 500 },
    { target: "current", n: 2000 }
  ];
  for (const step of PLAN) {
    const options = step.target === "baseline" ? { overrides: { "app-core.js": PRE_EDIT_APP_CORE } } : {};
    const h = await boot.bootCombination(options);
    const app = h.app;
    seedItems(app, step.n, "waiting");
    app.state.items.forEach(it => { it.reminderEvents = {}; it.deadlineEvents = {}; });
    const now = Date.now();
    for (let i = 0; i < 5; i++) { app.applyReminderEvents([], now, []); app.applyDeadlineEvents([], now, []); }
    const samples = [];
    for (let i = 0; i < 31; i++) {
      const t0 = process.hrtime.bigint();
      app.applyReminderEvents([], now, []);
      app.applyDeadlineEvents([], now, []);
      samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    result[step.target + "_n" + step.n] = {
      target: step.target, n: step.n,
      operation: "applyReminderEvents([]) + applyDeadlineEvents([])，空台账",
      warmup: 5, samplesMs: samples, stats: stats(samples)
    };
    console.log("  timing " + step.target + " n=" + step.n + " median=" +
      result[step.target + "_n" + step.n].stats.median + "ms");
  }
  return result;
}

(async () => {
  console.log("O4 复杂度对照…");
  out.o4.rows = await measureO4();
  console.log("O2 同步/对账计数…");
  out.o2 = await measureO2();
  console.log("O5 序列化计数…");
  out.o5 = await measureO5();
  console.log("O6 折叠/展开卡片…");
  out.o6 = await measureO6();
  console.log("O7 启动渲染…");
  out.o7 = await measureO7();
  console.log("耗时样本…");
  out.timing = await measureTiming();
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const file = path.join(RUN_DIR, "perf-counts.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("wrote " + file);

  // 控制台摘要（给人一眼看结论，不替代 JSON）
  const q = (t, n, m) => out.o4.rows.filter(r => r.target === t && r.n === n && r.ledger === m)[0];
  console.log("\nO4 deadline 台账 find 谓词比较（空台账）:");
  [100, 500, 2000].forEach(n => {
    console.log("  n=" + n + "  编辑前 " + q("baseline", n, "empty").deadlines.bigPreds +
      "  →  本轮 " + q("current", n, "empty").deadlines.bigPreds);
  });
  console.log("\nO4 reminder 台账 find 谓词比较（满台账）:");
  [100, 500, 2000].forEach(n => {
    console.log("  n=" + n + "  编辑前 " + q("baseline", n, "full").reminders.bigPreds +
      "  →  本轮 " + q("current", n, "full").reminders.bigPreds);
  });
  console.log("\nO2 一次业务保存: " + JSON.stringify(out.o2.businessSaveOnce.syncStats));
  console.log("O2 静置 600ms 后: " + JSON.stringify(out.o2.idle600msAfterLedgerWriteback.syncStats));
  console.log("O5 一次正常保存 JSON: " + JSON.stringify(out.o5.normalSave.jsonCalls));
  console.log("O6 折叠卡片数: " + out.o6.rows.filter(r => r.target === "baseline").map(r =>
    "编辑前 n=" + r.n + "=" + r.collapsed.cards).join(" | ") + "  ⇒  " +
    out.o6.rows.filter(r => r.target === "current").map(r => "本轮 n=" + r.n + "=" + r.collapsed.cards).join(" | "));
  console.log("O7 启动卡片容器写入: 编辑前 " + JSON.stringify(out.o7.baselineDataBoot.writes) +
    "\n                    本轮 " + JSON.stringify(out.o7.dataBoot.writes));
  console.log("计时（参考）: " + Object.keys(out.timing).map(k =>
    k + " median=" + out.timing[k].stats.median + "ms").join(" | "));
})().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
