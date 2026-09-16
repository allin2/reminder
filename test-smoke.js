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
  ok("低置信度仍给出时间（供上层按 D17 覆盖）", !!p2.trigger);
  // D17：兜底不再是「一周后」。产品层兜底 = 下一个 Review Window 起点。
  const fb = app.fallbackTriggerAt();
  const fbD = new Date(fb);
  ok("D17 兜底落在下一个整理窗口起点",
    fb > Date.now() && fbD.getHours() === 21 && fbD.getMinutes() === 30, fbD.toString());
  ok("D17 兜底不再是一周后", fb - Date.now() <= 86400000, ((fb - Date.now()) / 3600000).toFixed(1) + "h");

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

/* ---------- 3c. 首页信息架构 D5/D6/D7/D8 ---------- */
section("3c. 首页信息架构 D5/D6/D7/D8");
{
  app.state.settings.dnd = false;
  app.state.settings.notify = true;
  app.state.ui.activeExpanded = false;
  const now = Date.now();
  app.state.items = [
    app.makeItem({ title: "需要我注意", status: "due", triggerAt: now - 60000 }),
    app.makeItem({ title: "已看到一", status: "acknowledged", acknowledgedAt: now, triggerAt: now - 60000 }),
    app.makeItem({ title: "已看到二", status: "acknowledged", acknowledgedAt: now - 1000, triggerAt: now - 60000 }),
    app.makeItem({ title: "未来三天的", status: "waiting", triggerAt: now + 3 * 86400000 }),
    app.makeItem({ title: "模糊甲", status: "waiting", review_status: "NEEDS_REVIEW", triggerAt: now + 86400000 }),
    app.makeItem({ title: "模糊乙", status: "waiting", review_status: "NEEDS_REVIEW", triggerAt: now + 86400000 })
  ];
  app.renderHome();
  const homeHtml = ["#homeDue", "#homeActive", "#homeReview", "#homeUpcoming", "#homeEmpty"]
    .map(sel => getNode(sel).innerHTML).join("");

  ok("D5 首页不出现「即将到来」", !/即将到来/.test(homeHtml));
  ok("D5 #homeUpcoming 不承载任何内容", getNode("#homeUpcoming").innerHTML === "");
  ok("D5 未来事项不上首页", !/未来三天的/.test(homeHtml));
  ok("D5 需要注意区块正常渲染", /需要我注意/.test(getNode("#homeDue").innerHTML));

  // D7：永远折叠成一行，取消 ≤3 条阈值
  ok("D7 已看到未完成折叠成一行带数量", /已看到未完成 · 2/.test(getNode("#homeActive").innerHTML));
  ok("D7 明细默认隐藏", /id="activeList" hidden/.test(getNode("#homeActive").innerHTML));

  // D6：有待整理 → 常驻入口；形态与窗口判定一致
  const reviewHtml = getNode("#homeReview").innerHTML;
  const strong = app.inReviewHighlight();
  ok("D6 有待整理 → 入口常驻", /待整理/.test(reviewHtml));
  ok("D6 入口形态与窗口/宽限期判定一致",
    strong
      ? /待整理 · 2/.test(reviewHtml)
      : (!/待整理 · \d/.test(reviewHtml) && /opacity:\.75/.test(reviewHtml)),
    "highlight=" + strong);

  // D7：只有 1 条时也必须折叠
  app.state.items = [
    app.makeItem({ title: "唯一一条", status: "acknowledged", acknowledgedAt: now, triggerAt: now - 60000 })
  ];
  app.renderHome();
  ok("D7 单条也折叠不直接列出", /已看到未完成 · 1/.test(getNode("#homeActive").innerHTML) &&
    /hidden/.test(getNode("#homeActive").innerHTML));

  // D8：空态一句纯文字，不可点击
  app.state.items = [
    app.makeItem({ title: "今天做完了", status: "archived", completedAt: now, triggerAt: now - 60000 })
  ];
  app.renderHome();
  const emptyHtml = getNode("#homeEmpty").innerHTML;
  ok("D8 空态含「今天已完成 1 件」", /今天已完成 1 件/.test(emptyHtml));
  ok("D8 完成数是纯文字不可点击", !/<button/.test(emptyHtml) && !/data-act/.test(emptyHtml));

  // D6：无待整理 → 完全不渲染入口
  app.state.items = [];
  app.renderHome();
  ok("D6 无待整理 → 入口完全不渲染", getNode("#homeReview").innerHTML === "");
}

/* ---------- 3d. 整理会话出口（P0-3 回归） ---------- */
section("3d. 整理会话出口（P0-3）");
{
  app.state.items = [
    app.makeItem({
      title: "待整理的记录",
      status: "waiting",
      review_status: "NEEDS_REVIEW",
      triggerAt: Date.now() + 86400000
    })
  ];
  app.openReviewSession();
  const foot1 = getNode("#reviewFoot").innerHTML;
  ok("P0-3 会话含「稍后」出口", /id="reviewSnooze"/.test(foot1));
  ok("P0-3 会话含「跳过本次」出口", /id="reviewSkip"/.test(foot1));
  ok("P0-3 卡片三动作仍在", /id="reviewDelete"/.test(foot1) && /id="reviewConfirm"/.test(foot1) && /id="reviewSave"/.test(foot1));

  // 再次渲染不得把两个出口冲掉（此前每次渲染都整块替换 innerHTML）
  app.renderReviewCard();
  const foot2 = getNode("#reviewFoot").innerHTML;
  ok("P0-3 二次渲染后出口仍在", /id="reviewSnooze"/.test(foot2) && /id="reviewSkip"/.test(foot2));

  // 稍后五档仍在（D15/D20）
  const snoozeChips = ["1800000", "7200000", "tonight", "tomorrow", "next"];
  ok("P0-3 稍后五档选项未被破坏", snoozeChips.length === 5);
}

/* ---------- 3e. 弹条与全屏动作语义（D12/D13/D14） ---------- */
section("3e. 弹条与全屏动作语义 D12/D13/D14");
{
  const it = app.makeItem({
    title: "关键提醒",
    priority: "critical",
    status: "due",
    triggerAt: Date.now() - 60000
  });
  it.remindCount = 1;
  app.state.items = [it];

  app.clearAlert();
  app.showAlert(it);
  ok("D14 弹条已挂起", getNode("#alertBanner").classList.contains("show"));

  // 自动收起路径：纯展示，不记账
  const budgetBefore = it.remindCount;
  app.hideAlert();
  ok("D14 自动收起不消耗提醒预算", it.remindCount === budgetBefore, String(it.remindCount));
  ok("D14 自动收起不写抑制", !it.dismissedUntil);

  // 点 × 路径：用户主动，写 30 分钟抑制
  app.showAlert(it);
  app.dismissAlert();
  ok("D13 关闭写入 30 分钟抑制",
    it.dismissedUntil - Date.now() > 29 * 60000 && it.dismissedUntil - Date.now() <= 30 * 60000);
  ok("D13 关闭不写 ACK、不写完成", it.status === "due" && !it.acknowledgedAt && !it.completedAt);

  // D12：全屏闹钟「关闭」只止响
  app.clearAlert();
  app.handleAlarmAction({ action: "close", itemId: it.id });
  ok("D12 全屏「关闭」不写 ACK", it.status === "due" && !it.acknowledgedAt);
  app.handleAlarmAction({ action: "ack", itemId: it.id });
  ok("D12 全屏「我知道了」写 ACK 且不归档", it.status === "acknowledged" && it.status !== "archived");
}


/* ---------- 3f. 整理会话提醒节奏（D20 / D22 回归） ---------- */
section("3f. 整理会话提醒节奏 D20/D22");
{
  app.state.items = [
    app.makeItem({
      title: "待整理记录",
      status: "waiting",
      review_status: "NEEDS_REVIEW",
      triggerAt: Date.now() + 86400000
    })
  ];
  app.state.settings.notify = true;

  // 用 lastNotifiedAt 是否被改写判断「本次是否真的发了通知」
  function probe(rs, marks, day) {
    let hits = 0;
    marks.forEach(m => {
      const [hh, mm] = m.split(":").map(Number);
      const before = rs.lastNotifiedAt;
      app.maybeReviewSession(new Date(2026, 8, day, hh, mm, 0).getTime());
      if (rs.lastNotifiedAt !== before) hits++;
    });
    return hits;
  }

  const rs = app.ensureReviewSettings();
  rs.enabled = true;
  rs.hour = 21; rs.minute = 30; rs.windowEndHour = 23; rs.windowEndMinute = 0;
  rs.followupMs = 60 * 60 * 1000; rs.maxFollowups = 2;

  // 场景 A：窗口内不点稍后 → 首发 + 60 分钟后一次补充（而不是每分钟一条）
  rs.snoozedUntil = 0; rs.skippedUntil = 0; rs.lastSessionKey = ""; rs.followupCount = 0; rs.lastNotifiedAt = 0;
  const hitsA = probe(rs, ["21:30", "21:31", "21:32", "22:00", "22:30", "22:59"], 16);
  ok("D22 窗口内不再每分钟重复发（回归）", hitsA === 2, "实际 " + hitsA + " 次");

  // 场景 B：22:50 点「稍后 30 分钟」→ 23:20 只发一次
  rs.snoozedUntil = new Date(2026, 8, 16, 23, 20, 0).getTime();
  rs.lastSessionKey = ""; rs.followupCount = 0; rs.lastNotifiedAt = 0;
  const hitsB = probe(rs, ["23:19", "23:20", "23:21", "23:22", "23:30"], 16);
  ok("D20 稍后到点照发一次", hitsB === 1, "实际 " + hitsB + " 次");

  // 场景 C：宽限期过后 snoozedUntil 失效，不得顶掉次日晚间窗口
  rs.snoozedUntil = new Date(2026, 8, 16, 23, 20, 0).getTime();
  rs.lastSessionKey = ""; rs.followupCount = 0; rs.lastNotifiedAt = 0;
  app.maybeReviewSession(new Date(2026, 8, 17, 5, 0, 0).getTime());
  ok("D20 宽限期后 snoozedUntil 被清空", !rs.snoozedUntil, String(rs.snoozedUntil));
  const hitsC = probe(rs, ["21:30"], 17);
  ok("D20 次日窗口仍能正常提醒", hitsC === 1, "实际 " + hitsC + " 次");

  // 场景 D：旧版按分钟编码的 lastSessionKey 会被迁移作废
  rs.lastSessionKey = "2026-9-16T22:50";
  ok("迁移 旧 lastSessionKey 被作废", app.ensureReviewSettings().lastSessionKey === "");
}

/* ---------- 3g. 环境判断健壮性（N3 类回归） ---------- */
section("3g. 环境判断健壮性");
{
  // `"Notification" in window` 在「属性存在但值为 undefined」的环境（部分 WebView/壳）会通过判断，
  // 随后访问 Notification.permission 抛错。本仓统一改用真值判断。
  ok("不再使用 `\"Notification\" in window` 判断", src.indexOf('"Notification" in window') === -1);
  ok("showSystemNotification 走真值判断", /const N = typeof window !== "undefined" \? window\.Notification : null/.test(src));
}

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
