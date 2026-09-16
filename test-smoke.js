/* 安心收件箱 — acceptance smoke tests (node) */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname);
const libParse = fs.readFileSync(path.join(ROOT, "lib/parse-cn.js"), "utf8");
const libRepeat = fs.readFileSync(path.join(ROOT, "lib/repeat.js"), "utf8");
const libReminder = fs.readFileSync(path.join(ROOT, "lib/reminder.js"), "utf8");
const libStorage = fs.readFileSync(path.join(ROOT, "lib/storage.js"), "utf8");
const src = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");

/* ---------- DOM / browser mocks ---------- */
function el(id) {
  const node = {
    id,
    hidden: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
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
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    click() {},
    appendChild() {},
    remove() {}
  };
  return node;
}

const nodes = new Map();
function getNode(sel) {
  if (!nodes.has(sel)) nodes.set(sel, el(sel));
  return nodes.get(sel);
}

const storage = new Map();
const localStorage = {
  getItem(k) { return storage.has(k) ? storage.get(k) : null; },
  setItem(k, v) { storage.set(k, String(v)); },
  removeItem(k) { storage.delete(k); },
  clear() { storage.clear(); }
};

const document = {
  readyState: "complete",
  visibilityState: "visible",
  addEventListener() {},
  querySelector(sel) { return getNode(sel); },
  querySelectorAll() { return []; },
  createElement() { return el("tmp"); },
  body: { appendChild() {} }
};

const sandbox = {
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Set,
  Map,
  Promise,
  Error,
  RegExp,
  parseInt,
  parseFloat,
  isNaN,
  encodeURIComponent,
  decodeURIComponent,
  URLSearchParams,
  Blob: function () {},
  File: function () {},
  FileReader: function () {},
  history: { replaceState() {} },
  location: { search: "", pathname: "/index.html", href: "http://localhost/index.html" },
  localStorage,
  document,
  navigator: {
    onLine: true,
    serviceWorker: undefined,
    vibrate() {},
    share: undefined,
    canShare: undefined,
    setAppBadge: undefined
  },
  window: {
    addEventListener() {},
    Notification: undefined
  },
  Notification: undefined,
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval,
  fetch: async () => { throw new Error("no network in tests"); },
  globalThis: null
};
sandbox.globalThis = sandbox;
sandbox.window = Object.assign(sandbox.window, sandbox);

vm.createContext(sandbox);
vm.runInContext(libParse, sandbox, { filename: "lib/parse-cn.js" });
vm.runInContext(libRepeat, sandbox, { filename: "lib/repeat.js" });
vm.runInContext(libReminder, sandbox, { filename: "lib/reminder.js" });
vm.runInContext(libStorage, sandbox, { filename: "lib/storage.js" });
vm.runInContext(src, sandbox, { filename: "app-core.js" });

const app = sandbox.__ATTENTION_INBOX__;
if (!app) {
  console.error("FAIL: test hook not exposed");
  process.exit(1);
}

/* ---------- assert helpers ---------- */
let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) {
    passed++;
    console.log("  ✓ " + name);
  } else {
    failed++;
    failures.push(name + (extra ? " — " + extra : ""));
    console.log("  ✗ " + name + (extra ? " — " + extra : ""));
  }
}
function section(title) {
  console.log("\n== " + title + " ==");
}

/* ---------- 1. Chinese NL parse ---------- */
section("1. 自然语言时间解析");
{
  const now = new Date(2026, 8, 14, 10, 0, 0); // Mon 2026-09-14
  const p1 = app.parseChineseTime("周五提醒我看看 Horolog", now);
  ok("周五解析出 trigger", !!p1.trigger && p1.trigger > now.getTime());
  ok("周五标题含 Horolog", /Horolog/.test(p1.title), p1.title);
  ok("周五 confidence high/mid", p1.confidence === "high" || p1.confidence === "mid", p1.confidence);

  const p2 = app.parseChineseTime("过阵子再看看这个", now);
  ok("低置信度", p2.confidence === "low", p2.confidence);
  ok("低置信度默认一周左右", Math.abs((p2.trigger - now.getTime()) - 7 * 86400000) < 3600000);

  const p3 = app.parseChineseTime("9月30日截止，提前五天交材料", now);
  ok("截止时间", !!p3.deadline, String(p3.deadline));
  ok("提前五天 trigger", !!p3.trigger);
  const dDeadline = p3.deadline ? new Date(p3.deadline) : null;
  ok("deadline 在 9/30", dDeadline && dDeadline.getMonth() === 8 && dDeadline.getDate() === 30);

  const p4 = app.parseChineseTime("每两周看看一次这个方向", now);
  ok("每两周 ACK 模式", p4.repeat && p4.repeat.every === "biweek" && p4.repeat.mode === "ack");

  const p5 = app.parseChineseTime("每月底提醒我交房租", now);
  ok("每月底 monthEnd", p5.repeat && p5.repeat.every === "monthEnd", JSON.stringify(p5.repeat));

  const p6 = app.parseChineseTime("每月第2个周二开例会", now);
  ok("每月第N个星期X", p6.repeat && p6.repeat.every === "nthWeekday" && p6.repeat.nth === 2 && p6.repeat.dow === 2, JSON.stringify(p6.repeat));

  const p7 = app.parseChineseTime("明天下午3点开会", now);
  const d7 = new Date(p7.trigger);
  ok("明天下午3点", d7.getDate() === 15 && d7.getHours() === 15, d7.toString());
}

/* ---------- 2. Lifecycle ---------- */
section("2. Attention Lifecycle（ACK ≠ Complete）");
{
  // reset state
  const st = app.state;
  st.items = [];
  st.notes = [];
  st.projects = [];
  st.settings.dnd = false;
  st.settings.dailySummary = false;

  const item = app.makeItem({
    title: "测试事项",
    status: "waiting",
    triggerAt: Date.now() - 1000,
    priority: "normal"
  });
  st.items.push(item);
  app.promoteDue();
  ok("到期 promote 到 due", item.status === "due", item.status);
  ok("due 时 isDue=true", app.isDue(item));

  app.ackItem(item.id, true);
  ok("ACK 后 status=acknowledged", item.status === "acknowledged");
  ok("ACK 后不是 completed/archived", item.status !== "archived" && item.status !== "completed");
  ok("ACK 后 isDue=false（不再自动算到期）", !app.isDue(item));
  ok("acknowledgedAt 已写入", !!item.acknowledgedAt);

  app.completeItem(item.id);
  ok("Complete 后 archived", item.status === "archived");
  ok("completedAt 已写入", !!item.completedAt);
}

/* ---------- 3. Snooze / reopen / restore ---------- */
section("3. 稍后 / 再提醒 / 恢复");
{
  const item = app.makeItem({
    title: "稍后测试",
    status: "due",
    triggerAt: Date.now() - 5000
  });
  app.state.items.push(item);
  const when = Date.now() + 30 * 60000;
  app.snoozeItem(item.id, when);
  ok("snooze 后 snoozed", item.status === "snoozed");
  ok("snooze 时间正确", Math.abs(item.triggerAt - when) < 50);
  ok("snoozeCount+1", item.snoozeCount >= 1);

  app.ackItem(item.id, true);
  app.reopenItem(item.id);
  ok("reopen 回到 snoozed", item.status === "snoozed");

  app.completeItem(item.id);
  app.restoreItem(item.id);
  ok("restore 回到 waiting", item.status === "waiting");
  ok("restore 清除 completedAt", !item.completedAt);
  ok("restore 不设 trigger_at（D23）", !item.triggerAt);
}

/* ---------- 3b. 决策落地：首页 / 兜底 / 投递方式 ---------- */
section("3b. 决策落地 D5/D7/D17/D23/D25");
{
  // D17：NEEDS_REVIEW + Review 开启 → promoteDue 跳过
  const nr = app.makeItem({
    title: "模糊记录",
    status: "waiting",
    review_status: "NEEDS_REVIEW",
    triggerAt: Date.now() - 1000,
    isFallbackTrigger: true
  });
  app.state.items.push(nr);
  app.promoteDue();
  ok("D17 NEEDS_REVIEW 不进 due", nr.status === "waiting", nr.status);

  // D17：Review 关闭 → 正常晋升
  const wasEnabled = app.state.settings.review.enabled;
  app.state.settings.review.enabled = false;
  nr.status = "waiting";
  nr.triggerAt = Date.now() - 1000;
  app.promoteDue();
  ok("D17 Review 关闭后正常 due", nr.status === "due", nr.status);
  app.state.settings.review.enabled = wasEnabled;

  // D25：有标记 → delivery_mode=alarm
  const crit = app.makeItem({ title: "关键", priority: "critical", triggerAt: Date.now() + 3600000 });
  ok("D25 关键档 delivery_mode=alarm", crit.delivery_mode === "alarm", crit.delivery_mode);

  // D25：未标记取全局默认
  app.state.settings.defaultDeliveryMode = "notification";
  const normal = app.makeItem({ title: "普通", priority: "normal", triggerAt: Date.now() + 3600000 });
  ok("D25 未标记取默认 notification", normal.delivery_mode === "notification", normal.delivery_mode);

  app.state.settings.defaultDeliveryMode = "alarm";
  const normalAlarm = app.makeItem({ title: "普通闹钟", priority: "normal", triggerAt: Date.now() + 3600000 });
  ok("D25 默认 alarm 时未标记为 alarm", normalAlarm.delivery_mode === "alarm", normalAlarm.delivery_mode);
  app.state.settings.defaultDeliveryMode = "notification";

  // D22：补提醒参数 60min × 2
  const rs = app.state.settings.review;
  ok("D22 followupMs=60min", rs.followupMs === 60 * 60 * 1000, rs.followupMs);
  ok("D22 maxFollowups=2", rs.maxFollowups === 2, rs.maxFollowups);

  // hasSpecificTimeWord（D15）
  if (app.hasSpecificTimeWord) {
    ok("D15 识别具体时间词", app.hasSpecificTimeWord("下周三给王工回电") === true);
    ok("D15 模糊词不算具体时间", app.hasSpecificTimeWord("过阵子看看那个") === false);
  }
}

/* ---------- 4. Deadline protection ---------- */
section("4. Deadline Protection");
{
  const item = app.makeItem({
    title: "报名截止",
    status: "acknowledged",
    acknowledgedAt: Date.now() - 3600000,
    deadlineAt: Date.now() + 12 * 3600000, // within 1 day
    triggerAt: Date.now() - 86400000
  });
  app.state.items.push(item);
  app.promoteDue();
  ok("ACK 但截止临近 → 再次 due", item.status === "due", item.status);

  const far = app.makeItem({
    title: "远期截止",
    status: "acknowledged",
    acknowledgedAt: Date.now(),
    deadlineAt: Date.now() + 10 * 86400000
  });
  app.state.items.push(far);
  app.promoteDue();
  ok("远期截止不强制拉回", far.status === "acknowledged", far.status);
}

/* ---------- 5. Repeat next trigger ---------- */
section("5. 周期下一跳");
{
  const base = new Date(2026, 0, 15, 10, 0, 0); // Jan 15
  const day = app.nextRepeatTrigger({ repeat: { every: "day", mode: "calendar" }, triggerAt: base.getTime() }, base.getTime());
  ok("每天 +1 天", app.sameDay(new Date(day), new Date(2026, 0, 16)), new Date(day).toString());

  const monthEnd = app.nextRepeatTrigger({
    repeat: { every: "monthEnd", mode: "calendar" },
    triggerAt: base.getTime()
  }, base.getTime());
  const me = new Date(monthEnd);
  ok("monthEnd 是月末", me.getDate() === new Date(2026, 1, 0).getDate(), me.toString());

  // nth weekday: 2nd Tuesday of next occurrence from Jan 15 2026 (Thu)
  const nth = app.nextRepeatTrigger({
    repeat: { every: "nthWeekday", mode: "calendar", nth: 2, dow: 2 },
    triggerAt: base.getTime()
  }, base.getTime());
  const nd = new Date(nth);
  ok("nthWeekday 是周二", nd.getDay() === 2, nd.toString());
  ok("nthWeekday 在月内第2个周二区间", nd.getDate() >= 8 && nd.getDate() <= 14, nd.toString());

  ok("repeatLabel monthEnd", app.repeatLabel({ every: "monthEnd" }) === "每月最后一天");
  ok("repeatLabel nth", /第 2 个周二/.test(app.repeatLabel({ every: "nthWeekday", nth: 2, dow: 2 })));
}

/* ---------- 6. Quiet hours ---------- */
section("6. 勿扰时段");
{
  app.state.settings.dnd = true;
  app.state.settings.quietStart = "23:00";
  app.state.settings.quietEnd = "07:30";
  const night = new Date(2026, 5, 10, 23, 30, 0);
  const morning = new Date(2026, 5, 10, 8, 0, 0);
  ok("23:30 在勿扰内", app.inQuietHours(night));
  ok("08:00 不在勿扰内", !app.inQuietHours(morning));
  const end = app.quietEnd(night);
  const endD = new Date(end);
  ok("勿扰结束到次日 07:30", endD.getHours() === 7 && endD.getMinutes() === 30, endD.toString());

  // normal item delayed, important not
  app.state.items = [];
  const normal = app.makeItem({
    title: "普通",
    priority: "normal",
    status: "waiting",
    triggerAt: night.getTime() - 1000
  });
  const important = app.makeItem({
    title: "重要",
    priority: "important",
    status: "waiting",
    triggerAt: night.getTime() - 1000
  });
  app.state.items.push(normal, important);
  // promoteDue uses Date.now() internally for quiet check — mock by calling with now = night
  // promoteDue signature uses now param for trigger compare but quiet uses new Date(now)
  app.promoteDue(night.getTime());
  ok("勿扰中普通事项不立刻 due", normal.status === "waiting" || normal.status === "snoozed", normal.status);
  ok("勿扰中重要事项仍 due", important.status === "due", important.status);
}

/* ---------- 7. Similar items ---------- */
section("7. 相似事项提示（不合并）");
{
  app.state.items = [
    app.makeItem({ title: "续费域名", status: "waiting", triggerAt: Date.now() + 86400000 })
  ];
  const sim = app.findSimilarItems("续费域名啊");
  ok("找到相似", sim.length >= 1, String(sim.length));
  const sim2 = app.findSimilarItems("买牛奶");
  ok("不相似不提示", sim2.length === 0, String(sim2.length));
  ok("不自动删除/合并", app.state.items.length === 1);
}

/* ---------- 8. Offline persistence ---------- */
section("8. 本地持久化（模拟离线）");
{
  app.state.items = [
    app.makeItem({ title: "离线事项", status: "waiting", triggerAt: Date.now() + 100000 })
  ];
  app.save();
  const raw = localStorage.getItem("attention-inbox-v2");
  ok("已写入 localStorage", !!raw);
  app.state.items = [];
  const okLoad = app.load();
  ok("load 成功", okLoad === true);
  ok("load 恢复事项", app.state.items.length === 1 && app.state.items[0].title === "离线事项");
}

/* ---------- 9. Home bucket rules ---------- */
section("9. 首页分桶规则");
{
  app.state.settings.dnd = false;
  app.state.items = [
    app.makeItem({ title: "未来A", status: "waiting", triggerAt: Date.now() + 5 * 86400000 }),
    app.makeItem({ title: "已看到B", status: "acknowledged", acknowledgedAt: Date.now(), triggerAt: Date.now() - 1000 }),
    app.makeItem({ title: "到期C", status: "due", triggerAt: Date.now() - 1000 })
  ];
  const waiting = app.state.items.filter(i => i.status === "waiting");
  const acked = app.state.items.filter(i => i.status === "acknowledged");
  const due = app.state.items.filter(i => i.status === "due");
  ok("Future 不算 due", waiting.every(i => !app.isDue(i)));
  ok("ACK 不算 due", acked.every(i => !app.isDue(i)));
  ok("due 计入首页", due.length === 1);
}

/* ---------- 10. PRD acceptance path ---------- */
section("10. PRD 验收主路径");
{
  app.state.settings.dnd = false;
  app.state.items = [];
  const now = new Date();
  const parsed = app.parseChineseTime("周五提醒我看看 Horolog", now);
  const item = app.makeItem({
    title: parsed.title,
    status: "waiting",
    triggerAt: parsed.trigger,
    tags: parsed.tags || []
  });
  app.state.items.push(item);
  ok("① 解析并保存 waiting", item.status === "waiting");

  // force due
  item.triggerAt = Date.now() - 1;
  app.promoteDue();
  ok("② 到期 delivered/due", item.status === "due");

  app.ackItem(item.id, true);
  ok("③ 我知道了 → acknowledged", item.status === "acknowledged");

  app.snoozeItem(item.id, Date.now() + 3600000);
  ok("④ 稍后 → snoozed/回 Future", item.status === "snoozed");

  item.triggerAt = Date.now() - 1;
  app.promoteDue();
  ok("⑤ 再次到期", item.status === "due");

  app.completeItem(item.id);
  ok("⑥ 完成 → archived", item.status === "archived");
  ok("⑦ ACK 过程中从未自动变成 complete", item.completedAt && item.acknowledgedAt);
}

/* ---------- summary ---------- */
console.log("\n========== 结果 ==========");
console.log("通过: " + passed + "  失败: " + failed);
if (failed) {
  console.log("失败项:");
  failures.forEach(f => console.log("  - " + f));
  process.exit(1);
}
console.log("全部通过。");
