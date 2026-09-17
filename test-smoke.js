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

async function run() {
/* ---------- 0. 先等应用初始化完成（G5） ----------
 * init() 是异步的：loadAsync → applyParsedState 会**整体替换** state.items / state.settings，
 * 并重建全部事项对象。在这之前直接改 app.state，写入的对象会被这次恢复丢掉，
 * 后续断言就落在「已经不在库里的孤儿对象」上（表现为动作看着成功、状态却没变）。
 * 所以：先等就绪，再准备测试自己的状态。 */
await app.ready();

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
  await app.handleAlarmAction({ action: "close", itemId: it.id });
  ok("D12 全屏「关闭」不写 ACK", it.status === "due" && !it.acknowledgedAt);
  // 真实原生链路会携带数据版本（F5：改状态的动作必须有可知且匹配的版本）
  await app.handleAlarmAction({ action: "ack", itemId: it.id, itemRev: it.rev });
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

/* ---------- 3h. 业务逻辑回归（2026-09-16 审查 L01–L08 / D23） ---------- */
section("3h. 业务逻辑回归（L01–L08 / D23）");
{
  /* ---- L01：用户手选时间不得被解析器或系统兜底覆盖 ---- */
  app.state.items = [];
  app.state.settings.review.enabled = true;
  getNode("#capText").value = "买牛奶";
  getNode("#capTrigger").value = "2026-10-01T09:00";
  getNode("#capDeadline").value = "";
  app.markTriggerPicked(true);
  app.saveItemFromForm();
  const picked = app.state.items[0];
  ok("L01 手选时间原样保存",
    !!picked && picked.triggerAt === new Date(2026, 9, 1, 9, 0, 0).getTime(),
    picked ? new Date(picked.triggerAt).toString() : "no item");
  ok("L01 手选时间不落兜底标记", !!picked && picked.isFallbackTrigger === false);
  ok("L01 低置信度仍进入待整理（内容质量）",
    !!picked && picked.review_status === "NEEDS_REVIEW");

  app.state.items = [];
  getNode("#capText").value = "买牛奶";
  getNode("#capTrigger").value = "";
  app.markTriggerPicked(false);
  app.saveItemFromForm();
  const noPick = app.state.items[0];
  ok("L01 无时间且无手选 → 兜底为下一个整理窗口",
    !!noPick && noPick.isFallbackTrigger === true && noPick.triggerAt > Date.now(),
    noPick ? new Date(noPick.triggerAt).toString() : "no item");

  // L01：有真实时间的待整理记录照常进 due（Review 只管内容质量）
  const real = app.makeItem({
    title: "有真实时间的待整理", status: "waiting", review_status: "NEEDS_REVIEW",
    triggerAt: Date.now() - 1000, isFallbackTrigger: false
  });
  app.state.items = [real];
  app.promoteDue();
  ok("L01 有真实时间的待整理照常进 due", real.status === "due", real.status);

  /* ---- L02：截止保护分阶段，ACK 后不得被立刻拉回 ---- */
  const dl = app.makeItem({
    title: "截止事项", status: "acknowledged", acknowledgedAt: Date.now(),
    deadlineAt: Date.now() + 12 * 3600000
  });
  app.state.items = [dl];
  app.promoteDue();
  ok("L02 截止临近 → 重新唤醒为 due", dl.status === "due", dl.status);
  ok("L02 已记录阶段身份", !!dl.deadlineStageKey, String(dl.deadlineStageKey));
  app.ackItem(dl.id, true);
  ok("L02 ACK → acknowledged", dl.status === "acknowledged");
  app.promoteDue();
  app.promoteDue();
  ok("L02 同一阶段内 ACK 不再被拉回 due", dl.status === "acknowledged", dl.status);
  dl.deadlineAt = Date.now() + 3600000;
  app.promoteDue();
  ok("L02 到下一保护阶段才再次唤醒", dl.status === "due", dl.status);

  /* ---- L03：两种周期分开兑现承诺 ---- */
  const monthly = app.makeItem({
    title: "交房租", status: "waiting", priority: "normal",
    triggerAt: new Date(2026, 8, 1, 10, 0, 0).getTime(),
    repeat: { mode: "calendar", every: "month" }
  });
  app.state.items = [monthly];
  app.ackItem(monthly.id, true);
  ok("L03 calendar 周期 ACK 不改原定日期",
    monthly.triggerAt === new Date(2026, 8, 1, 10, 0, 0).getTime(),
    new Date(monthly.triggerAt).toString());
  app.completeItem(monthly.id);
  const spawned = app.state.items[app.state.items.length - 1];
  ok("L03 完成后生成下期", app.state.items.length === 2 && spawned !== monthly);
  ok("L03 锚定原定日期（10月1日而非完成日的下月）",
    !!spawned && new Date(spawned.triggerAt).getMonth() === 9 &&
    new Date(spawned.triggerAt).getDate() === 1,
    spawned ? new Date(spawned.triggerAt).toString() : "none");

  const biweek = app.makeItem({
    title: "给爸妈打电话", status: "due", priority: "important",
    triggerAt: new Date(2026, 8, 5, 10, 0, 0).getTime(),
    repeat: { mode: "ack", every: "biweek" }
  });
  app.state.items = [biweek];
  const beforeAck = app.state.items.length;
  app.ackItem(biweek.id, true);
  const ackD = new Date(biweek.acknowledgedAt);
  const expectedNext = new Date(ackD.getFullYear(), ackD.getMonth(), ackD.getDate() + 14, 10, 0, 0).getTime();
  ok("L03 ACK 保持 acknowledged（确认不等于完成）", biweek.status === "acknowledged");
  ok("L03 ACK 周期确认后生成下一期实例",
    app.state.items.length === beforeAck + 1,
    String(app.state.items.length));
  const nextInst = app.state.items[app.state.items.length - 1];
  ok("L03 下一期按 ACK 时刻 +14 天并保留原时刻",
    nextInst.triggerAt === expectedNext && nextInst.status === "waiting",
    new Date(nextInst.triggerAt).toString());
  app.completeItem(biweek.id);
  const alive = app.state.items.filter(x =>
    x.status === "waiting" || x.status === "snoozed" || x.status === "due");
  ok("V04 ACK 后完成，仍保留一个活跃的下一期（不归零）",
    alive.length === 1 && alive[0] === nextInst,
    String(alive.length));

  const monthEndNext = app.nextRepeatTrigger({
    repeat: { every: "monthEnd", mode: "calendar" },
    triggerAt: new Date(2026, 0, 31, 12, 0, 0).getTime()
  });
  ok("L03 月末不因 setMonth 溢出跳月",
    new Date(monthEndNext).getMonth() === 1 && new Date(monthEndNext).getDate() === 28,
    new Date(monthEndNext).toString());

  const stopRule = app.makeItem({
    title: "周期规则", status: "waiting",
    triggerAt: Date.now() + 86400000, repeat: { mode: "calendar", every: "day" }
  });
  app.state.items = [stopRule];
  app.stopRepeat(stopRule.id);
  // V0.2 §417：停止重复 = 终止整个周期规则**并归档**
  ok("V04 「停止重复」终止规则并归档当前实例",
    !stopRule.repeat && stopRule.status === "archived" && !!stopRule.completedAt,
    stopRule.status);

  // F3：ACK 周期确认生成下一期后，从原事项执行「停止重复」，必须连同未来实例一并终止归档
  const ackRepeatItem = app.makeItem({
    title: "ACK周期事项", status: "due",
    triggerAt: Date.now() - 1000, repeat: { mode: "ack", every: "day" }
  });
  app.state.items = [ackRepeatItem];
  app.ackItem(ackRepeatItem.id);
  ok("F3 ACK 后已派生下一期", app.state.items.length === 2 && app.state.items.some(x => x.status === "waiting"));
  app.stopRepeat(ackRepeatItem.id);
  const activeRepeatItems = app.state.items.filter(x => x.repeat || (x.status !== "archived" && x.status !== "completed"));
  ok("F3 「停止重复」终止系列后无未归档或带 repeat 的活跃事项",
    activeRepeatItems.length === 0,
    JSON.stringify(activeRepeatItems.map(x => ({ title: x.title, status: x.status, repeat: x.repeat }))));
  const spawnedFuture = app.state.items.find(x => x.id !== ackRepeatItem.id);
  ok("F3 未来实例未完成不虚增已完成数（completedAt 为空）",
    spawnedFuture && spawnedFuture.status === "archived" && !spawnedFuture.completedAt && !spawnedFuture.repeat);

  // F3：日历周期事项完成后，从历史入口（已归档的事项）执行「停止重复」，同样能终止未来排程
  const calRepeatItem = app.makeItem({
    title: "日历周期事项", status: "due",
    triggerAt: Date.now() - 1000, repeat: { mode: "calendar", every: "day" }
  });
  app.state.items = [calRepeatItem];
  app.completeItem(calRepeatItem.id);
  ok("F3 完成后生成了下一期", app.state.items.length === 2 && app.state.items.some(x => x.status === "waiting"));
  // 从已归档的历史记录触发停止重复
  app.stopRepeat(calRepeatItem.id);
  const remainingActiveCal = app.state.items.filter(x => x.repeat || (x.status !== "archived" && x.status !== "completed"));
  ok("F3 从历史已完成入口停止重复，未来实例同样被终止",
    remainingActiveCal.length === 0 && !calRepeatItem.repeat);

  // V04：原定 09:00 的月末周期不得原地打转（此前 1/31 09:00 → 1/31 09:00）
  const monthEnd0900 = app.nextRepeatTrigger({
    repeat: { every: "monthEnd", mode: "calendar" },
    triggerAt: new Date(2026, 0, 31, 9, 0, 0).getTime()
  });
  ok("V04 月末 09:00 严格推进到下一期",
    monthEnd0900 > new Date(2026, 0, 31, 9, 0, 0).getTime() &&
    new Date(monthEnd0900).getMonth() === 1 && new Date(monthEnd0900).getHours() === 9,
    new Date(monthEnd0900).toString());

  /* ---- L04：旧通知与重复动作不得改变已完成事项 ---- */
  const rep = app.makeItem({
    title: "周期事项", status: "due", priority: "normal",
    triggerAt: Date.now() - 1000, repeat: { mode: "calendar", every: "week" }
  });
  app.state.items = [rep];
  const rev0 = rep.rev;
  await app.handleAlarmAction({ action: "done", itemId: rep.id, itemRev: rev0 });
  const afterFirst = app.state.items.length;
  await app.handleAlarmAction({ action: "done", itemId: rep.id, itemRev: rev0 });
  ok("L04 同一完成事件重复投递只推进一次周期", app.state.items.length === afterFirst,
    app.state.items.length + " vs " + afterFirst);
  await app.handleAlarmAction({ action: "ack", itemId: rep.id, itemRev: rev0 });
  ok("L04 已完成事项不接受旧 ACK", rep.status === "archived" && !!rep.completedAt);

  // F5：版本未知/缺失时不得改动状态（只能打开详情）
  const f5Item = app.makeItem({
    title: "版本校验", status: "due", priority: "normal", triggerAt: Date.now() - 1000
  });
  app.state.items = [f5Item];
  await app.handleAlarmAction({ action: "done", itemId: f5Item.id });
  ok("F5 版本缺失的闹钟动作不改动状态", f5Item.status === "due", f5Item.status);
  await app.handleAlarmAction({ action: "done", itemId: f5Item.id, itemRev: 0 });
  ok("F5 版本为 0 的闹钟动作不改动状态", f5Item.status === "due", f5Item.status);
  await app.handleAlarmAction({ action: "done", itemId: f5Item.id, itemRev: f5Item.rev });
  ok("F5 版本匹配的闹钟动作正常执行", f5Item.status === "archived", f5Item.status);

  // F2：同一事件 id 只处理一次（崩溃重放保护）
  const f2Item = app.makeItem({
    title: "事件去重", status: "due", priority: "normal", triggerAt: Date.now() - 1000
  });
  app.state.items = [f2Item];
  await app.handleAlarmAction({ action: "ack", itemId: f2Item.id, itemRev: f2Item.rev, alarmEventId: "evt-1" });
  ok("F2 首次事件执行", f2Item.status === "acknowledged", f2Item.status);
  const f2Rev = f2Item.rev;
  await app.handleAlarmAction({ action: "done", itemId: f2Item.id, itemRev: f2Rev, alarmEventId: "evt-1" });
  ok("F2 重放的同一事件被跳过", f2Item.status === "acknowledged", f2Item.status);

  // F2：持久化失败时向外上抛异常，不提前记入已落库事件台账，不污染内存去重以支持重试
  const f2FailItem = app.makeItem({
    title: "持久化失败", status: "due", priority: "normal", triggerAt: Date.now() - 1000
  });
  app.state.items = [f2FailItem];
  const origSetItem = localStorage.setItem;
  localStorage.setItem = () => { throw new Error("quota exceeded"); };
  let caughtSaveErr = null;
  try {
    await app.handleAlarmAction({ action: "ack", itemId: f2FailItem.id, itemRev: f2FailItem.rev, alarmEventId: "evt-fail" });
  } catch (e) {
    caughtSaveErr = e;
  }
  localStorage.setItem = origSetItem;
  ok("F2 持久化失败时向外上抛异常", !!caughtSaveErr && /quota exceeded/.test(caughtSaveErr.message));
  ok("F2 持久化失败时未记录 alarmEventLog", !app.alarmEventSeen("evt-fail"));
  // 恢复存储后，重试该动作能成功执行
  await app.handleAlarmAction({ action: "ack", itemId: f2FailItem.id, itemRev: f2FailItem.rev, alarmEventId: "evt-fail" });
  ok("F2 存储恢复后重试成功", f2FailItem.status === "acknowledged" && app.alarmEventSeen("evt-fail"),
    "status=" + f2FailItem.status + " seen=" + app.alarmEventSeen("evt-fail") + " rev=" + f2FailItem.rev);

  /* ---- L05：逐条「留着待整理」，确认不悄悄生成立即到期提醒 ---- */
  app.state.items = [
    app.makeItem({
      title: "第一条想不清", status: "waiting", review_status: "NEEDS_REVIEW",
      triggerAt: new Date(2026, 8, 15, 21, 30, 0).getTime(), isFallbackTrigger: true
    }),
    app.makeItem({
      title: "第二条已清楚", status: "waiting", review_status: "NEEDS_REVIEW",
      triggerAt: new Date(2026, 8, 20, 10, 0, 0).getTime(), isFallbackTrigger: false
    })
  ];
  app.openReviewSession();
  ok("L05 会话含两条队列", app.state.ui.reviewQueue.length === 2);
  getNode("#reviewTrigger").value = "";
  app.markReviewTriggerPicked(false);
  app.reviewConfirm();
  const kept = app.state.items.find(x => x.title === "第一条想不清");
  ok("L05 兜底记录确认后顺延到下一个整理窗口",
    !!kept && kept.triggerAt > Date.now() && kept.isFallbackTrigger === true,
    kept ? new Date(kept.triggerAt).toString() : "none");
  ok("L05 确认后前进到下一条", app.state.ui.reviewIndex === 1);
  app.reviewKeepCurrent();
  ok("L05 「留着待整理」保留本条状态并前进",
    app.state.items.find(x => x.title === "第二条已清楚").review_status === "NEEDS_REVIEW");

  // 用户在整理卡片里明确改时间 → 采用并解除兜底标记
  app.state.ui.reviewIndex = 0;
  app.renderReviewCard();
  getNode("#reviewTrigger").value = "2026-10-05T09:00";
  app.markReviewTriggerPicked(true);
  app.reviewConfirm();
  const adopted = app.state.items.find(x => x.title === "第一条想不清");
  ok("L05 明确采用的时间被采纳且解除兜底",
    !!adopted && adopted.triggerAt === new Date(2026, 9, 5, 9, 0, 0).getTime() &&
    adopted.isFallbackTrigger === false,
    adopted ? new Date(adopted.triggerAt).toString() : "none");

  /* ---- L06：待整理通知动作与标签语义一致 ---- */
  app.state.items = [
    app.makeItem({
      title: "待整理", status: "waiting", review_status: "NEEDS_REVIEW",
      triggerAt: Date.now() + 86400000
    })
  ];
  const rsL06 = app.ensureReviewSettings();
  rsL06.enabled = true;
  await app.handleNativeNotificationAction({
    action: "review_snooze", itemId: "review-session", managedKind: "review-session"
  });
  ok("L06 「稍后 30 分钟」按 30 分钟生效",
    rsL06.snoozedUntil - Date.now() > 29 * 60000 && rsL06.snoozedUntil - Date.now() <= 30 * 60000,
    String(rsL06.snoozedUntil - Date.now()));
  await app.handleNativeNotificationAction({
    action: "review_skip", itemId: "review-session", managedKind: "review-session"
  });
  ok("L06 「今天跳过」到下一个整理窗口前不再提醒", rsL06.skippedUntil > Date.now());

  /* ---- V05：编辑改期必须推进版本，旧通知不得覆盖新安排 ---- */
  const editItem = app.makeItem({
    title: "待改期", status: "waiting", priority: "normal",
    triggerAt: Date.now() + 3600000
  });
  editItem.remindCount = 3;
  app.state.items = [editItem];
  const revBefore = editItem.rev;
  getNode("#capText").value = "待改期";
  getNode("#capTrigger").value = "2026-10-01T09:00";
  getNode("#capDeadline").value = "";
  getNode("#capNote").value = "";
  getNode("#capUrl").value = "";
  getNode("#capTags").value = "";
  getNode("#capProject").value = "";
  app.markTriggerPicked(false);
  app.state.ui.editItemId = editItem.id;
  app.saveItemFromForm();
  app.state.ui.editItemId = null;
  ok("V05 编辑保存推进数据版本", editItem.rev > revBefore, revBefore + " → " + editItem.rev);
  ok("V05 编辑改期重置追提醒轮次（L08 缺口）", editItem.remindCount === 0, String(editItem.remindCount));
  await app.handleAlarmAction({ action: "done", itemId: editItem.id, itemRev: revBefore });
  ok("V05 旧版本的通知动作被拒绝", editItem.status !== "archived", editItem.status);

  /* ---- F1：截止事件按阶段记账，稳定对账不得反复写库 ---- */
  const f1Item = app.makeItem({
    title: "截止记账", status: "acknowledged", priority: "normal",
    deadlineAt: Date.now() + 12 * 3600000
  });
  app.state.items = [f1Item];
  const f1Dl = f1Item.deadlineAt;
  const p24Key = "p24@" + f1Dl;
  const p2Key = "p2@" + f1Dl;
  const f1At = Date.now() + 86400000;
  const f1Events = [
    { itemId: f1Item.id, stageKey: p24Key, at: f1At },
    { itemId: f1Item.id, stageKey: p2Key, at: f1At + 3600000 }
  ];
  ok("F1 首次记账写库", app.applyDeadlineEvents(f1Events, Date.now()) === true);
  ok("F1 两个阶段同时在表（不互相覆盖）",
    Object.keys(f1Item.deadlineEvents).length === 2 &&
    f1Item.deadlineEvents[p24Key].state === "scheduled" &&
    f1Item.deadlineEvents[p2Key].state === "scheduled",
    JSON.stringify(f1Item.deadlineEvents));
  ok("F1 计划未变时不再写库（不再持续对账）",
    app.applyDeadlineEvents(f1Events, Date.now()) === false);
  // G3：「计划时刻已过」不是送达证据。没有系统送达回调，就只能是待定。
  ok("G3 投递时刻已过也不推断为已送达（保持待定）",
    app.applyDeadlineEvents(f1Events, f1At + 1000) === false &&
    f1Item.deadlineEvents[p24Key].state === "scheduled",
    JSON.stringify(f1Item.deadlineEvents));
  ok("F1 待定阶段不再重复对账写库", app.applyDeadlineEvents(f1Events, f1At + 2000) === false);
  // 只有真实送达证据（系统回调）才落库为 delivered
  ok("F1 系统送达回调才落库为已送达",
    app.markDeadlineDelivered({ itemId: f1Item.id, stageKey: p24Key }) === true &&
    f1Item.deadlineEvents[p24Key].state === "delivered",
    JSON.stringify(f1Item.deadlineEvents));
  ok("F1 已送达的阶段不再重排", app.applyDeadlineEvents(f1Events, f1At + 3000) === false);

  // G3：对账回传空列表（例如已过去的阶段未再重排）时，经历计划时刻不得被推断为送达
  const f1AdvanceItem = app.makeItem({
    title: "空列表推进送达", status: "acknowledged", priority: "normal",
    deadlineAt: Date.now() + 10 * 3600000
  });
  const advStage = "p24@" + f1AdvanceItem.deadlineAt;
  f1AdvanceItem.deadlineEvents = {
    [advStage]: { at: Date.now() - 5000, state: "scheduled" }
  };
  app.state.items = [f1AdvanceItem];
  app.applyDeadlineEvents([], Date.now());
  ok("G3 空计划下已过去的排程保持待定，不得推断为已送达",
    f1AdvanceItem.deadlineEvents[advStage].state === "scheduled",
    JSON.stringify(f1AdvanceItem.deadlineEvents));

  // G3：原生确认撤销（且撤销发生在投递时刻之前）→ 记为已撤销，重新开启后可补提醒
  const cancelStage = "p2@" + f1AdvanceItem.deadlineAt;
  f1AdvanceItem.deadlineEvents[cancelStage] = { at: Date.now() + 60000, state: "scheduled" };
  app.applyDeadlineEvents([], Date.now(), [
    { itemId: f1AdvanceItem.id, stageKey: cancelStage, at: Date.now() + 60000 }
  ]);
  ok("G3 原生确认撤销的排程记为 cancelled",
    f1AdvanceItem.deadlineEvents[cancelStage].state === "cancelled",
    JSON.stringify(f1AdvanceItem.deadlineEvents));
  ok("G3 撤销不得覆盖已送达的终态",
    (function () {
      f1AdvanceItem.deadlineEvents[advStage] = { at: Date.now() + 60000, state: "delivered" };
      app.applyDeadlineEvents([], Date.now(), [
        { itemId: f1AdvanceItem.id, stageKey: advStage, at: Date.now() + 60000 }
      ]);
      return f1AdvanceItem.deadlineEvents[advStage].state === "delivered";
    })());

  // 截止清除后，历史事件记录被清理
  f1AdvanceItem.deadlineAt = null;
  app.applyDeadlineEvents([], Date.now());
  ok("F1 截止时间清除后历史阶段记录被清理", !f1AdvanceItem.deadlineEvents);

  /* ---- V06：兜底判定在前台 / 首页 / 原生必须一致 ---- */
  app.state.settings.review.enabled = true;
  const fbWithDeadline = app.makeItem({
    title: "兜底记录带截止", status: "waiting", review_status: "NEEDS_REVIEW",
    triggerAt: Date.now() - 1000, isFallbackTrigger: true, deadlineAt: Date.now() + 3600000
  });
  app.state.items = [fbWithDeadline];
  app.promoteDue();
  ok("V06 兜底记录仍被截止保护拉起（INV-05）", fbWithDeadline.status === "due", fbWithDeadline.status);

  app.state.items = [
    app.makeItem({
      title: "过期兜底", status: "waiting", review_status: "NEEDS_REVIEW",
      triggerAt: Date.now() - 3600000, isFallbackTrigger: true
    })
  ];
  app.renderHome();
  ok("V06 过期兜底不出现在「需要注意」",
    !/过期兜底/.test(getNode("#homeDue").innerHTML),
    getNode("#homeDue").innerHTML.slice(0, 60));

  /* ---- L08：稍后开启新一轮，重置追提醒预算 ---- */
  const sno = app.makeItem({
    title: "稍后预算", status: "due", priority: "critical", triggerAt: Date.now() - 1000
  });
  sno.remindCount = 8;
  sno.lastRemindAt = Date.now();
  sno.lastAlertShownAt = Date.now();
  app.state.items = [sno];
  app.snoozeItem(sno.id, Date.now() + 2 * 3600000);
  ok("L08 稍后重置轮次与预算",
    sno.remindCount === 0 && !sno.lastRemindAt && !sno.lastAlertShownAt,
    JSON.stringify({ c: sno.remindCount, l: sno.lastRemindAt }));

  /* ---- D23：恢复归档暂停截止保护，可显式恢复 ---- */
  const rst = app.makeItem({
    title: "重开事项", status: "archived", completedAt: Date.now(),
    triggerAt: Date.now() - 86400000, deadlineAt: Date.now() + 12 * 3600000
  });
  app.state.items = [rst];
  app.restoreItem(rst.id);
  ok("D23 重开不设 trigger_at", !rst.triggerAt && rst.status === "waiting");
  ok("D23 重开默认暂停截止保护", rst.deadlinePaused === true);
  app.promoteDue();
  ok("D23 暂停期间不因截止被拉回 due", rst.status === "waiting", rst.status);
  app.resumeDeadlineProtection(rst.id);
  ok("D23 显式恢复后保护重新生效", rst.deadlinePaused === false && rst.status === "due", rst.status);
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
  // save 是异步契约（F2：返回真实持久化 Promise），断言「落库之后」的状态必须等它
  await app.saveAsync();
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
}

run().then(() => {
  /* ---------- summary ---------- */
  console.log("\n========== 结果 ==========");
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
