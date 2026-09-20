/* 安心收件箱 — unit tests for lib modules (node) */
"use strict";

const path = require("path");
const parse = require(path.join(__dirname, "lib/parse-cn.js"));
const repeat = require(path.join(__dirname, "lib/repeat.js"));
const reminder = require(path.join(__dirname, "lib/reminder.js"));
const storageMod = require(path.join(__dirname, "lib/storage.js"));
const feedbackMod = require(path.join(__dirname, "lib/feedback.js"));
const evidenceMod = require(path.join(__dirname, "lib/delivery-evidence.js"));

let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else {
    failed++;
    failures.push(name + (extra ? " — " + extra : ""));
    console.log("  ✗ " + name + (extra ? " — " + extra : ""));
  }
}
function section(t) { console.log("\n== " + t + " =="); }

/* parse */
section("parse-cn");
{
  const now = new Date(2026, 8, 14, 10, 0, 0);
  const p1 = parse.parseChineseTime("周五提醒我看看 Horolog", now);
  ok("周五 trigger", !!p1.trigger && p1.trigger > now.getTime());
  ok("周五 confidence", p1.confidence === "high" || p1.confidence === "mid");

  const p2 = parse.parseChineseTime("过阵子再看看这个", now);
  ok("低置信度", p2.confidence === "low");

  const p3 = parse.parseChineseTime("9月30日截止，提前五天交材料", now);
  ok("截止", !!p3.deadline);
  ok("提前 trigger", !!p3.trigger);

  const p4 = parse.parseChineseTime("每两周看看一次", now);
  ok("biweek ack", p4.repeat && p4.repeat.every === "biweek" && p4.repeat.mode === "ack");

  const p5 = parse.parseChineseTime("每月底提醒我交房租", now);
  ok("monthEnd", p5.repeat && p5.repeat.every === "monthEnd");

  const p6 = parse.parseChineseTime("每月第2个周二开例会", now);
  ok("nthWeekday", p6.repeat && p6.repeat.every === "nthWeekday" && p6.repeat.nth === 2 && p6.repeat.dow === 2);
}

/* Relative reminders: fixed reference, including seconds and date rollover. */
section("relative Chinese time");
{
  const now = new Date(2026, 11, 31, 23, 59, 42, 321);
  const cases = [
    ["三分钟以后提醒我", 180000],
    ["三分钟后提醒我喝水", 180000],
    ["3分钟之后提醒我喝水", 180000],
    ["３ 分钟以后提醒我喝水", 180000],
    ["过三分钟提醒我喝水", 180000],
    ["再过 3 分钟提醒我喝水", 180000],
    ["提醒我三分钟后喝水", 180000],
    ["半小时后提醒我喝水", 1800000],
    ["半个小时以后提醒我喝水", 1800000],
    ["一个半小时之后提醒我喝水", 5400000],
    ["一个小时半后提醒我喝水", 5400000],
    ["一小时三十分钟后提醒我喝水", 5400000],
    ["一小时零五分钟后提醒我喝水", 3900000],
    ["四十五分钟后提醒我喝水", 2700000],
    ["一百二十分钟后提醒我喝水", 7200000],
    ["1.5小时后提醒我喝水", 5400000],
    ["三十秒后提醒我喝水", 30000],
    ["两分钟三十秒后提醒我喝水", 150000],
    ["半分钟后提醒我喝水", 30000],
    ["两个钟头后提醒我喝水", 7200000]
  ];
  for (const [text, elapsed] of cases) {
    const p = parse.parseChineseTime(text, now);
    ok(text + " 精确时长", p.trigger === now.getTime() + elapsed && p.confidence === "high");
    ok(text + " 具体时间判定", parse.hasSpecificTimeWord(text));
    ok(text + " 保留原文及标题", p.raw === text && p.title === (text.includes("喝水") ? "喝水" : text));
  }
  for (const text of ["零分钟后提醒我", "负三分钟后提醒我", "-3分钟后提醒我", "几分钟后提醒我", "三分钟后五分钟后提醒我", "三分钟后明天提醒我", "过三分钟前提醒我", "一小时半半后提醒我", "三分钟后9点提醒我", "以后提醒我喝水", "看三分钟视频", "每三分钟后提醒我"]) {
    ok(text + " 不冒充精确识别", parse.parseChineseTime(text, now).confidence === "low");
  }
  const day = parse.parseChineseTime("三天以后提醒我喝水", now);
  const expectedDay = new Date(now); expectedDay.setDate(expectedDay.getDate() + 3);
  ok("三天以后按日历天且保留时刻", day.trigger === expectedDay.getTime() && day.confidence === "high");
  const clock = parse.parseChineseTime("三天后下午三点提醒我喝水", now);
  expectedDay.setHours(15, 0, 0, 0);
  ok("天数可组合明确钟点", clock.trigger === expectedDay.getTime());
  const tag = parse.parseChineseTime("三分钟以后提醒我喝水 #健康", now);
  ok("清除时间但保留事项和标签", tag.title === "喝水" && tag.tags[0] === "健康");
  ok("正文含月报不误判为日期冲突", parse.parseChineseTime("三分钟后提醒我写月报", now).confidence === "high");
}

/* 解析层回归：H-01 / H-02 / H-03 / N-04（2026-09-18 修复） */
section("calendar anchors: 下周 / 下下周 / 每月N号 / 下个月N号 / X前");
{
  const now = new Date(2026, 8, 18, 14, 0, 0); // 2026-09-18 周五 14:00
  const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h || 0, mi || 0, 0, 0).getTime();
  const eod = (y, mo, d) => new Date(y, mo - 1, d, 23, 59, 59, 999).getTime();
  const show = ts => (ts ? new Date(ts).toLocaleString("zh-CN", { hour12: false }) : String(ts));

  // H-01：「下周X」被无条件 delta += 7，整体晚一周；「下周日」另有一套只加一次的实现
  const w = parse.parseChineseTime("提醒我下周三交房租", now);
  ok("H-01 下周三 = 09-23（不是 09-30）", w.trigger === at(2026, 9, 23, 10, 0), show(w.trigger));
  const ws = parse.parseChineseTime("下周日交房租", now);
  ok("H-01 下周日 = 09-27", ws.trigger === at(2026, 9, 27, 10, 0), show(ws.trigger));
  ok("H-01 两个分支统一为同一日历周",
    new Date(w.trigger).getDay() === 3 && new Date(ws.trigger).getDay() === 0 &&
    ws.trigger - w.trigger === 4 * 86400000, show(w.trigger) + " / " + show(ws.trigger));
  const w2 = parse.parseChineseTime("下下周一开会", now);
  ok("H-01 下下周一 = 09-28", w2.trigger === at(2026, 9, 28, 10, 0), show(w2.trigger));

  // H-02：「每月N号」的号数被丢弃，落 +30 天兜底，锚点永久漂移
  const m = parse.parseChineseTime("每月15号提醒我", now);
  ok("H-02 每月15号 = 10-15（不是 10-18）", m.trigger === at(2026, 10, 15, 10, 0), show(m.trigger));
  ok("H-02 每月15号 周期为 monthly", m.repeat && m.repeat.every === "month" && m.repeat.mode === "calendar");
  const mNext = repeat.nextRepeatTrigger({ repeat: m.repeat, triggerAt: m.trigger }, m.trigger);
  ok("H-02 次期仍锚 15 号（不再漂到 18）",
    new Date(mNext).getDate() === 15 && new Date(mNext).getMonth() === 10, show(mNext));
  ok("H-02 每月N号 判为具体时间（不再进延后澄清）", parse.hasSpecificTimeWord("每月15号提醒我") === true);

  // H-03：「下个月N号」号数被丢掉、硬编码成 1 号
  const n = parse.parseChineseTime("下个月5号交电费", now);
  ok("H-03 下个月5号 = 10-05（不是 10-01）", n.trigger === at(2026, 10, 5, 10, 0), show(n.trigger));
  ok("H-03 号数不留在标题里", n.title === "交电费", n.title);
  const n2 = parse.parseChineseTime("下个月交电费", now);
  ok("H-03 未给号数时仍为次月 1 号", n2.trigger === at(2026, 10, 1, 10, 0), show(n2.trigger));
  const ml = parse.parseChineseTime("下个月底结算", now);
  ok("H-03 下个月底 = 10-31（不是本月底 09-30）", ml.trigger === at(2026, 10, 31, 10, 0), show(ml.trigger));
  const cl = parse.parseChineseTime("月底结算", now);
  ok("H-03 月底 仍为当月末", cl.trigger === at(2026, 9, 30, 10, 0), show(cl.trigger));

  // N-04：标题残留 / 「半」不识别 / 「X 前·之前」丢截止
  const s = parse.parseChineseTime("每周一早上9点站会", now);
  ok("N-04 每周X 不留孤立星期字", s.title === "站会", s.title);
  ok("N-04 每周一 落在周一 09:00",
    new Date(s.trigger).getDay() === 1 && new Date(s.trigger).getHours() === 9, show(s.trigger));
  const t2 = parse.parseChineseTime("下下周一开会", now);
  ok("N-04 下下周X 不留孤立「下」", t2.title === "开会", t2.title);
  const t3 = parse.parseChineseTime("本周五前提交报告", now);
  ok("N-04 本周X 不留孤立「本」", t3.title === "提交报告", t3.title);
  const half = parse.parseChineseTime("明天上午10点半面试", now);
  ok("N-04 「半」= 30 分", half.trigger === at(2026, 9, 19, 10, 30), show(half.trigger));
  ok("N-04 「半」不留在标题", half.title === "面试", half.title);
  const b1 = parse.parseChineseTime("明天上午9点前提交", now);
  ok("N-04 「9点前」产出截止（精确到那一刻）", b1.deadline === at(2026, 9, 19, 9, 0), show(b1.deadline));
  ok("N-04 「9点前」标题干净", b1.title === "提交", b1.title);
  const b2 = parse.parseChineseTime("12月31日之前提交年报", now);
  ok("N-04 「之前」产出截止（当天末尾）", b2.deadline === eod(2026, 12, 31), show(b2.deadline));
  ok("N-04 「之前」标题干净", b2.title === "提交年报", b2.title);

  // 不能把既有口径改坏：硬关键词 + 「提前N天」的截止仍走原路径
  const b3 = parse.parseChineseTime("9月30日截止，提前五天交材料", now);
  ok("既有：截止 + 提前五天 仍按原口径", b3.deadline === eod(2026, 9, 30), show(b3.deadline));
  // 也不能因为硬关键词就顺手给周期事项加截止（会每期多一轮截止打扰）
  const mEnd = parse.parseChineseTime("每月最后一天交房租", now);
  ok("周期事项不因「最后一天」被加上截止", mEnd.deadline == null, String(mEnd.deadline));
  ok("周期事项仍是 monthEnd", mEnd.repeat && mEnd.repeat.every === "monthEnd");
  // 没有时间指向词时不得凭空造出截止
  ok("无截止语义时不产出截止", parse.parseChineseTime("记得买牛奶", now).deadline == null);
}

/* repeat */
section("repeat");
{
  const base = new Date(2026, 0, 15, 10, 0, 0);
  const day = repeat.nextRepeatTrigger({ repeat: { every: "day", mode: "calendar" }, triggerAt: base.getTime() }, base.getTime());
  ok("day +1", new Date(day).getDate() === 16);

  const me = new Date(repeat.nextRepeatTrigger({
    repeat: { every: "monthEnd", mode: "calendar" },
    triggerAt: base.getTime()
  }, base.getTime()));
  ok("monthEnd last day", me.getDate() === 31 || me.getDate() === 30 || me.getDate() === 28 || me.getDate() === 29);
  ok("monthEnd is Jan 31 2026", me.getMonth() === 0 && me.getDate() === 31, me.toString());

  const nth = new Date(repeat.nextRepeatTrigger({
    repeat: { every: "nthWeekday", mode: "calendar", nth: 2, dow: 2 },
    triggerAt: base.getTime()
  }, base.getTime()));
  ok("nth weekday Tue", nth.getDay() === 2);
  ok("nth in 8-14", nth.getDate() >= 8 && nth.getDate() <= 14);

  const prev = repeat.nextRepeatPreview({ every: "week", mode: "calendar" }, base.getTime(), 5);
  ok("preview 5", prev.length === 5);
  ok("preview ascending", prev.every((t, i) => i === 0 || t > prev[i - 1]));
}

/* quiet + realert */
section("reminder");
{
  const settings = { dnd: true, quietStart: "23:00", quietEnd: "07:30" };
  ok("23:30 quiet", reminder.inQuietHours(new Date(2026, 5, 10, 23, 30), settings));
  ok("08:00 not quiet", !reminder.inQuietHours(new Date(2026, 5, 10, 8, 0), settings));
  const end = new Date(reminder.quietEnd(new Date(2026, 5, 10, 23, 30), settings));
  ok("quiet end next 07:30", end.getHours() === 7 && end.getMinutes() === 30 && end.getDate() === 11);

  const now = Date.now();
  const important = {
    status: "due",
    priority: "important",
    remindCount: 1,
    lastRemindAt: now - 31 * 60 * 1000,
    deliveredAt: now - 31 * 60 * 1000
  };
  ok("important realert after 30m", reminder.shouldRealert(important, now, { importantRepeat: true }));
  ok("important no realert if disabled", !reminder.shouldRealert(important, now, { importantRepeat: false }));
  ok("important blocked by dismiss", !reminder.shouldRealert(important, now, {
    importantRepeat: true,
    dismissedAt: now - 5 * 60 * 1000
  }));

  const critical = {
    status: "due",
    priority: "critical",
    remindCount: 2,
    lastRemindAt: now - 16 * 60 * 1000,
    deliveredAt: now - 16 * 60 * 1000
  };
  ok("critical realert after 15m", reminder.shouldRealert(critical, now, {}));

  const maxed = {
    status: "due",
    priority: "important",
    remindCount: 4,
    lastRemindAt: now - 60 * 60 * 1000
  };
  ok("important max 4", !reminder.shouldRealert(maxed, now, { importantRepeat: true }));

  const normal = {
    status: "due",
    priority: "normal",
    remindCount: 1,
    lastRemindAt: now - 60 * 60 * 1000
  };
  ok("normal no auto realert", !reminder.shouldRealert(normal, now, {}));

  const acked = { status: "acknowledged", priority: "critical", remindCount: 1 };
  ok("acked no realert", !reminder.shouldRealert(acked, now, {}));

  // window
  const sat = new Date(2026, 8, 19, 0, 0, 0); // assume Saturday
  const item = {
    triggerAt: sat.getTime(),
    windowStart: sat.getTime(),
    windowEnd: new Date(2026, 8, 20, 23, 59, 59).getTime()
  };
  const winTs = reminder.applyWindowTrigger(item, new Date(2026, 8, 15).getTime());
  const winD = new Date(winTs);
  ok("window pick 10:00", winD.getHours() === 10, winD.toString());

  const marked = reminder.markReminded({ remindCount: 1 }, now);
  ok("markReminded +1", marked.remindCount === 2 && marked.lastRemindAt === now);
}

/* ---------- 导入 / 导出（CP-002 · D46–D54） ---------- */

section("export-format");
{
  const fs = require("fs");
  const ex = require(path.join(__dirname, "lib/export-format.js"));

  const ts = new Date(2026, 8, 21, 9, 0, 0).getTime();
  const iso = ex.isoWithOffset(ts);
  ok("iso 带偏移", /[+-]\d{2}:\d{2}$/.test(iso), iso);
  ok("iso 往返仍是同一时刻", new Date(iso).getTime() === ts, iso);
  ok("iso null 安全", ex.isoWithOffset(null) === null);
  ok("utcStamp 以 Z 结尾", /^\d{8}T\d{6}Z$/.test(ex.utcStamp(ts)), ex.utcStamp(ts));

  // 导出侧不得自己长出一套「提前多久算临近截止」的规则
  ok("DEADLINE_LEAD_MS 与 reminder 一致",
    ex.DEADLINE_LEAD_MS === reminder.DEADLINE_LEAD_MS,
    ex.DEADLINE_LEAD_MS + " vs " + reminder.DEADLINE_LEAD_MS);

  const EVERY = ["day", "week", "biweek", "month", "monthEnd", "nthWeekday"];
  ok("ack 周期一律不产出 rrule（硬红线）",
    EVERY.every(e => ex.rruleFor({ every: e, mode: "ack", nth: 2, dow: 2 }, ts) === null));
  ok("day → FREQ=DAILY", ex.rruleFor({ every: "day", mode: "calendar" }, ts) === "FREQ=DAILY");
  ok("monthEnd → BYMONTHDAY=-1",
    ex.rruleFor({ every: "monthEnd", mode: "calendar" }, ts) === "FREQ=MONTHLY;BYMONTHDAY=-1");
  ok("month → 锚在当日",
    ex.rruleFor({ every: "month", mode: "calendar" }, ts) === "FREQ=MONTHLY;BYMONTHDAY=21");
  ok("nthWeekday → BYDAY=2TU",
    ex.rruleFor({ every: "nthWeekday", mode: "calendar", nth: 2, dow: 2 }, ts) === "FREQ=MONTHLY;BYDAY=2TU");
  ok("nthWeekday 最后 → BYDAY=-1MO",
    ex.rruleFor({ every: "nthWeekday", mode: "calendar", nth: -1, dow: 1 }, ts) === "FREQ=MONTHLY;BYDAY=-1MO");
  ok("biweek 带 INTERVAL=2",
    ex.rruleFor({ every: "biweek", mode: "calendar" }, ts).indexOf("INTERVAL=2") > 0);
  ok("week 带 BYDAY", /;BYDAY=(SU|MO|TU|WE|TH|FR|SA)$/.test(ex.rruleFor({ every: "week", mode: "calendar" }, ts)));

  const now2 = new Date(2026, 8, 18, 12, 0, 0).getTime();
  ok("无截止 → NONE", ex.deriveDeadlineStatus({}, now2) === "NONE");
  ok("远期 → PENDING", ex.deriveDeadlineStatus({ deadlineAt: now2 + 72 * 3600e3 }, now2) === "PENDING");
  ok("24h 内 → PROTECTED", ex.deriveDeadlineStatus({ deadlineAt: now2 + 3 * 3600e3 }, now2) === "PROTECTED");
  ok("已过 → PASSED", ex.deriveDeadlineStatus({ deadlineAt: now2 - 1000 }, now2) === "PASSED");
  ok("暂停 → PENDING",
    ex.deriveDeadlineStatus({ deadlineAt: now2 + 3 * 3600e3, deadlinePaused: true }, now2) === "PENDING");

  ok("已完成且曾 ACK → ACKNOWLEDGED",
    ex.deriveAttentionStatus({ status: "completed", acknowledgedAt: now2 }) === "ACKNOWLEDGED");
  ok("已完成但无 ACK 记录 → 不假装 ACKNOWLEDGED",
    ex.deriveAttentionStatus({ status: "completed" }) === "WAITING");
  ok("due → DELIVERED", ex.deriveAttentionStatus({ status: "due" }) === "DELIVERED");

  ok("time_source 只产出 PARSED / FALLBACK（D54）",
    [{}, { triggerAt: now2 }, { triggerAt: now2, isFallbackTrigger: true }]
      .every(c => ["PARSED", "FALLBACK"].indexOf(ex.deriveTimeSource(c)) >= 0));
  ok("无触发时刻 → FALLBACK", ex.deriveTimeSource({}) === "FALLBACK");

  const mk = o => Object.assign({
    id: "x", title: "t", status: "waiting", priority: "normal",
    review_status: "READY", createdAt: now2 - 1000, tags: []
  }, o);
  const now3 = new Date(2026, 8, 18, 15, 0, 0).getTime();
  const fixture = [
    mk({ id: "a", title: "交房租", triggerAt: now3 + 3 * 24 * 3600e3, repeat: { every: "month", mode: "calendar" } }),
    mk({ id: "b", title: "报名截止", status: "acknowledged", priority: "important", triggerAt: null,
      acknowledgedAt: now3 - 3600e3, deadlineAt: now3 + 5 * 24 * 3600e3 }),
    mk({ id: "c", title: "待整理项", review_status: "NEEDS_REVIEW", isFallbackTrigger: true, triggerAt: now3 + 86400e3 }),
    mk({ id: "d", title: "已归档", status: "archived" }),
    mk({ id: "f", title: "给爸妈打电话", triggerAt: now3 + 2 * 24 * 3600e3, repeat: { every: "biweek", mode: "ack" } }),
    mk({ id: "g", title: "这是一条特别特别长的标题用来验证 ICS 折行是否真的生效".repeat(3), triggerAt: now3 + 4 * 24 * 3600e3 })
  ];
  const exp = ex.buildExport(fixture, {
    now: now3, appVersion: "test", internalSchema: 4, scope: { mode: "active" },
    extras: { settingsSubset: { defaultDeliveryMode: "alarm", quietStart: "23:00", ai: { apiKey: "sk-LEAK", baseUrl: "https://leak.example" } } }
  });
  ok("默认范围排除已归档", exp.items.every(i => i.id !== "d"));
  ok("默认范围包含待整理", exp.items.some(i => i.id === "c"));
  ok("counts 与条目数一致", exp.counts.items === exp.items.length, String(exp.counts.items));
  ok("绝不导出密钥", ex.scanSecrets(exp).length === 0, JSON.stringify(ex.scanSecrets(exp)));
  ok("设置子集保留非密钥项", exp.extensions.internal.settings_subset.quietStart === "23:00");
  ok("original_capture 如实为 null（不臆造）", exp.items.every(i => i.original_capture === null));
  ok("derived 标注派生字段", exp.items.find(i => i.id === "b").derived.indexOf("attention_status") >= 0);
  ok("importance 不算派生（它就是存储的 priority）",
    exp.items.find(i => i.id === "b").derived.indexOf("importance") < 0);
  ok("repeat.rrule 计入 derived", exp.items.find(i => i.id === "a").derived.indexOf("repeat.rrule") >= 0);
  ok("ack 周期条目的 rrule 为 null", exp.items.find(i => i.id === "f").repeat.rrule === null);
  ok("ack 周期也不进 derived", exp.items.find(i => i.id === "f").derived.indexOf("repeat.rrule") < 0);
  ok("ACK 未完成 → ACKNOWLEDGED + ACTIVE",
    exp.items.find(i => i.id === "b").attention_status === "ACKNOWLEDGED" &&
    exp.items.find(i => i.id === "b").completion_status === "ACTIVE");
  ok("时间双写指向同一时刻", exp.items.every(i =>
    (i.trigger_at_ms == null && i.trigger_at_iso == null) ||
    new Date(i.trigger_at_iso).getTime() === i.trigger_at_ms));

  // 代码与对外契约不得各自漂移：条目字段必须与 JSON Schema 完全一致
  const schema = JSON.parse(fs.readFileSync(
    path.join(__dirname, "docs/compose/spec/schemas/attention-inbox.export.v1.schema.json"), "utf8"));
  const allowedItem = Object.keys(schema.$defs.item.properties).sort();
  const actualItem = Object.keys(exp.items[0]).sort();
  ok("条目字段与 schema 完全一致（不多不少）",
    JSON.stringify(actualItem) === JSON.stringify(allowedItem),
    "多: " + actualItem.filter(k => allowedItem.indexOf(k) < 0) +
    " 少: " + allowedItem.filter(k => actualItem.indexOf(k) < 0));
  ok("schema 必填字段齐备",
    schema.$defs.item.required.every(k => exp.items[0][k] !== undefined));
  ok("顶层字段都在 schema 内",
    Object.keys(exp).every(k => schema.properties[k] !== undefined),
    JSON.stringify(Object.keys(exp).filter(k => schema.properties[k] === undefined)));
  ok("scope.mode 是合法枚举",
    ["all", "active", "future", "range"].indexOf(exp.scope.mode) >= 0);
  ok("导出范围过滤可关闭 NEEDS_REVIEW",
    ex.buildExport(fixture, { now: now3, scope: { mode: "active", include_needs_review: false } })
      .items.every(i => i.review_status !== "NEEDS_REVIEW"));

  const ics = ex.buildIcs(fixture, { now: now3, scope: { mode: "active" } });
  ok("ICS 用 CRLF 断行", ics.text.indexOf("\r\n") > 0);
  ok("兜底且无截止的条目不进日历", ics.dropped === 1, String(ics.dropped));
  ok("兜底但有真实截止的条目降级为 VTODO", ics.downgraded === 1 && ics.text.indexOf("BEGIN:VTODO") >= 0);
  ok("被丢弃的条目确实不在文件里", ics.text.indexOf("UID:c@attention-inbox") < 0);
  ok("普通的条目是 VEVENT", ics.text.indexOf("BEGIN:VEVENT") >= 0);
  const dtLines = ics.text.split("\r\n").filter(l => /^DT(START|END|STAMP|DUE):/.test(l));
  ok("所有 DT 行都是 UTC（D53）", dtLines.length > 0 && dtLines.every(l => /Z$/.test(l)),
    JSON.stringify(dtLines.slice(0, 3)));
  ok("写入对外语义契约（ACK != Complete）", ics.text.indexOf("ACK != Complete") >= 0);
  ok("写入 X-ATTENTION 语义标注", ics.text.indexOf("X-ATTENTION-ATTENTION-STATUS:") >= 0);
  const enc = new TextEncoder();
  const icsLines = ics.text.split("\r\n");
  ok("ICS 每行不超过 75 字节",
    icsLines.every(l => enc.encode(l).length <= 75),
    "最长 " + Math.max.apply(null, icsLines.map(l => enc.encode(l).length)));
  ok("ICS 折行真的发生过（存在续行）", icsLines.some(l => l.startsWith(" ")));
  const fBlock = ics.text.split("BEGIN:VEVENT").filter(b => b.indexOf("UID:f@attention-inbox") >= 0)[0] || "";
  ok("ack 周期在 ICS 里没有 RRULE 行", fBlock !== "" && fBlock.indexOf("RRULE:") < 0);
  const aBlock = ics.text.split("BEGIN:VEVENT").filter(b => b.indexOf("UID:a@attention-inbox") >= 0)[0] || "";
  ok("日历周期有 RRULE 行", aBlock.indexOf("RRULE:FREQ=MONTHLY;BYMONTHDAY=") >= 0);
}

section("import-extract");
{
  const ix = require(path.join(__dirname, "lib/import-extract.js"));

  ok("按扩展名识别类型",
    ix.detectKind("a.ICS", "") === "ics" && ix.detectKind("x.csv", "") === "csv" &&
    ix.detectKind("n.md", "") === "markdown" && ix.detectKind("b.JSON", "") === "json");
  ok("按 MIME 识别类型", ix.detectKind("noext", "text/calendar") === "ics");
  ok("不认识的后缀 → null", ix.detectKind("a.pdf", "application/pdf") === null);
  ok("hash32 稳定且能区分", ix.hash32("abc") === ix.hash32("abc") && ix.hash32("abc") !== ix.hash32("abd"));

  const t = ix.extract({ name: "a.txt", text: "-------\n交房租\n\n- 明天买牛奶\n   \n" });
  ok("txt 解析成功", t.ok === true && t.kind === "text");
  ok("txt 跳过分隔线与空行", t.drafts.length === 2, JSON.stringify(t.drafts.map(d => d.title)));
  ok("txt 剥掉列表符", t.drafts[1].title === "明天买牛奶");
  ok("txt 带行定位", t.drafts[0].source_locator.indexOf("行") > 0);

  const mdText = "---\ntitle: x\n---\n## 会议纪要\n- [ ] 下周三之前提交季度报销\n- 普通一项\n说明段落不该进来\n";
  const m = ix.extract({ name: "m.md", text: mdText });
  ok("md 只抽列表项", m.drafts.length === 2, JSON.stringify(m.drafts.map(d => d.title)));
  ok("md 标题成为标签", m.drafts[0].tags[0] === "会议纪要");
  ok("md 复选框标记被剥离", m.drafts[0].title === "下周三之前提交季度报销");
  ok("md 段落不混入列表结果", m.drafts.every(d => d.title.indexOf("说明段落") < 0));
  ok("md 跳过 front matter", m.drafts.every(d => d.title.indexOf("title: x") < 0));

  const m2 = ix.extract({ name: "m2.md", text: "第一件事是买牛奶\n第二件事是交房租\n" });
  ok("md 无列表时按段落兜底", m2.drafts.length === 2 && m2.warnings.length > 0, JSON.stringify(m2.warnings));

  const csvText = "标题,提醒时间,截止时间,备注,标签\n交房租,明天,本月最后一天,转账给房东,生活\n体检,\"下周三 9:00\",,需要空腹,\n";
  const c = ix.extract({ name: "a.csv", text: csvText });
  ok("csv 表头映射出两条", c.drafts.length === 2, JSON.stringify(c.drafts.map(d => d.title)));
  ok("csv 取到标题", c.drafts[0].title === "交房租");
  ok("csv 取到时间串", c.drafts[0].when_text === "明天");
  ok("csv 取到截止串", c.drafts[0].deadline_text === "本月最后一天");
  ok("csv 引号内的逗号不被拆列", c.drafts[1].when_text === "下周三 9:00", JSON.stringify(c.drafts[1].when_text));
  ok("csv 标签按顿号/逗号拆开", c.drafts[0].tags[0] === "生活");
  ok("csv 表头行本身不成为条目", c.drafts.every(d => d.title !== "标题"));

  const c2 = ix.extract({ name: "b.csv", text: "买牛奶,明天\n交房租,月底\n" });
  ok("csv 无表头时回退并告警",
    c2.drafts.length === 2 && c2.drafts[0].title === "买牛奶" && c2.warnings.length > 0);

  const icsText = [
    "BEGIN:VCALENDAR", "VERSION:2.0",
    "BEGIN:VEVENT", "UID:u1", "SUMMARY:季度评审", "DTSTART:20260923T010000Z",
    "RRULE:FREQ=WEEKLY;BYDAY=WE", "DESCRIPTION:会议室 A", "END:VEVENT",
    "BEGIN:VTODO", "UID:u2", "SUMMARY:提交报销", "DUE;VALUE=DATE:20260930", "END:VTODO",
    "END:VCALENDAR"
  ].join("\r\n");
  const i = ix.extract({ name: "a.ics", text: icsText });
  ok("ics 抽出两条", i.drafts.length === 2, JSON.stringify(i.drafts.map(d => d.title)));
  ok("ics 是结构化来源", i.drafts.every(d => d.source_kind === "structured"));
  ok("ics 的 UTC 时刻换算正确", i.drafts[0].at_ms === Date.UTC(2026, 8, 23, 1, 0, 0), String(i.drafts[0].at_ms));
  ok("ics 周期映射为 week", i.drafts[0].repeat && i.drafts[0].repeat.every === "week");
  ok("ics 全天截止落到当天 23:59", (function () {
    const d = new Date(i.drafts[1].deadline_at_ms);
    return d.getFullYear() === 2026 && d.getMonth() === 8 && d.getDate() === 30 &&
      d.getHours() === 23 && d.getMinutes() === 59;
  })());
  ok("ics 不带 when_text（不该绕自然语言解析）", i.drafts.every(d => d.when_text == null));

  const exMod = require(path.join(__dirname, "lib/export-format.js"));
  const rtNow = new Date(2026, 8, 18, 15, 0, 0).getTime();
  const own = exMod.buildExport([
    { id: "r1", title: "交房租", status: "waiting", priority: "normal", review_status: "READY",
      triggerAt: rtNow + 86400e3, createdAt: rtNow, tags: [], repeat: { every: "month", mode: "calendar" } },
    { id: "r2", title: "待整理", status: "waiting", review_status: "NEEDS_REVIEW",
      isFallbackTrigger: true, triggerAt: rtNow + 3600e3, createdAt: rtNow, tags: [] }
  ], { now: rtNow, scope: { mode: "all", include_needs_review: true } });
  const rt = ix.extract({ name: "export.json", text: JSON.stringify(own) });
  ok("自家导出件可被识别", rt.ok === true && rt.drafts.length === own.items.length, JSON.stringify(rt.warnings));
  ok("回环携带内部字段", rt.drafts[0].internal && rt.drafts[0].internal.status != null);
  ok("回环走结构化通道", rt.drafts.every(d => d.source_kind === "structured"));
  ok("回环保留原状态（不被打回 waiting）", rt.drafts[1].internal.status === "waiting");
  ok("回环保留周期", rt.drafts[0].repeat && rt.drafts[0].repeat.every === "month");

  const gen = ix.extract({
    name: "g.json",
    text: JSON.stringify([{ 标题: "交房租", 时间: "2026-09-21T09:00:00+08:00" }, { title: "买牛奶", time: "明天" }])
  });
  ok("通用 JSON 抽出两条", gen.drafts.length === 2, JSON.stringify(gen.drafts.map(d => d.title)));
  ok("ISO 时间走结构化通道", gen.drafts[0].at_ms === new Date("2026-09-21T09:00:00+08:00").getTime());
  ok("自然语言时间走文本通道", gen.drafts[1].when_text === "明天" && gen.drafts[1].at_ms === null);

  ok("坏 JSON 是真失败（不伪装成 0 条）",
    ix.extract({ name: "bad.json", text: "{ oops" }).ok === false);
  ok("不支持的类型被拒",
    ix.extract({ name: "a.pdf", mime: "application/pdf", text: "x" }).ok === false);
  ok("超过大小上限被拒",
    ix.extract({ name: "a.txt", text: "x", size: 6 * 1024 * 1024 }).ok === false);
  ok("空文件被拒", ix.extract({ name: "a.txt", text: "" }).ok === false);

  const many = ix.extract({ name: "many.txt", text: Array.from({ length: 260 }, (_, k) => "事项" + k).join("\n") });
  ok("超量截断且如实标记",
    many.drafts.length === 200 && many.truncated === true && many.skipped === 60,
    many.drafts.length + "/" + many.truncated + "/" + many.skipped);
  const exact = ix.extract({ name: "exact.txt", text: Array.from({ length: 200 }, (_, k) => "事项" + k).join("\n") });
  ok("正好 200 条不算截断", exact.drafts.length === 200 && exact.truncated === false);
}

section("import-map");
{
  const im = require(path.join(__dirname, "lib/import-map.js"));
  const now4 = new Date(2026, 8, 18, 15, 0, 0).getTime();
  const FALLBACK_TS = new Date(2026, 8, 19, 21, 30, 0).getTime();
  let seq = 0;
  const deps = {
    parse: parse.parseChineseTime,
    now: now4,
    uid: () => "it" + (++seq),
    fallbackTriggerAt: () => FALLBACK_TS,
    defaultDeliveryMode: "notification",
    batchId: "b1"
  };
  const r1 = im.mapDrafts([
    { title: "下周三之前提交季度报销", when_text: "下周三", source_quote: "下周三之前提交季度报销", source_locator: "第 3 行", source_kind: "text" },
    { title: "看看 Horolog 的调度设计", when_text: null, source_quote: "看看 Horolog 的调度设计", source_locator: "第 5 行", source_kind: "text" },
    { title: "体检", at_ms: new Date(2026, 9, 10, 9, 0, 0).getTime(), when_text: "明早八点", source_kind: "structured", source_locator: "UID u9" }
  ], deps);

  ok("映射出三条", r1.items.length === 3);
  ok("一律 waiting（绝不直接落 due）", r1.items.every(x => x.status === "waiting"));
  ok("一律 NEEDS_REVIEW", r1.items.every(x => x.review_status === "NEEDS_REVIEW"));
  ok("一律 priority=normal（AI 不判优先级）", r1.items.every(x => x.priority === "normal"));
  ok("保留来源引用", r1.items[0].sourceQuote === "下周三之前提交季度报销");
  ok("保留来源标题", r1.items[0].sourceTitle === "第 3 行");
  ok("打上批次号", r1.items.every(x => x.importBatchId === "b1"));
  ok("原生投递方式取全局默认快照", r1.items.every(x => x.delivery_mode === "notification"));
  ok("自然语言时间由注入的解析器换算",
    r1.items[0].triggerAt === parse.parseChineseTime("下周三", now4).trigger,
    String(r1.items[0].triggerAt));
  ok("无法识别时间 → 兜底时刻 + isFallbackTrigger",
    r1.items[1].isFallbackTrigger === true && r1.items[1].triggerAt === FALLBACK_TS);
  ok("结构化来源直接采信时间戳",
    r1.items[2].triggerAt === new Date(2026, 9, 10, 9, 0, 0).getTime());
  ok("结构化来源忽略 when_text（两条通道不互相污染）", r1.items[2].isFallbackTrigger === false);
  ok("预览带置信度与时间来源说明", r1.preview.length === 3 && r1.preview[1].timeNote.length > 0);
  ok("摘要统计可用", im.summarize(r1.preview).fallback === 1, JSON.stringify(im.summarize(r1.preview)));

  const r2 = im.mapDrafts([{
    title: "回环项", source_kind: "structured", at_ms: now4 + 1000,
    internal: { evil: 1, status: "hacked", rev: 5, unknownKey: "x" }
  }], deps);
  ok("白名单拒绝非法状态", r2.items[0].status === "waiting", r2.items[0].status);
  ok("白名单不引入未知字段", r2.items[0].evil === undefined && r2.items[0].unknownKey === undefined);
  ok("白名单恢复合法字段", r2.items[0].rev === 5);
  const r2b = im.mapDrafts([{ title: "回环项2", source_kind: "structured", at_ms: now4 + 1000, internal: { status: "acknowledged" } }], deps);
  ok("白名单允许合法状态回环", r2b.items[0].status === "acknowledged");

  const r3 = im.mapDrafts([{ title: "买牛奶", source_kind: "text" }],
    Object.assign({}, deps, { existingItems: [{ id: "old1", title: " 买牛奶 " }] }));
  ok("疑似重复只标记、绝不自动合并",
    r3.items.length === 1 && r3.preview[0].duplicateOf === "old1");
  ok("摘要统计疑似重复", im.summarize(r3.preview).possibleDuplicates === 1);

  const r4 = im.mapDrafts([{ title: "x", source_kind: "text" }], { now: now4, uid: () => "z" });
  ok("未注入解析器时明确告警", r4.warnings.some(w => w.indexOf("时间解析器") >= 0), JSON.stringify(r4.warnings));
  ok("未注入兜底函数时明确告警", r4.warnings.some(w => w.indexOf("fallbackTriggerAt") >= 0));
}

/* storage memory backend */
section("storage");
{
  // force memory by temporarily removing indexedDB
  const store = storageMod.createStorage({ lsKey: "attention-inbox-v2" });
  store._useMemory();
  // load empty
  store.load().then(v => {
    ok("memory empty load", v == null);
    return store.save({ items: [{ id: "a" }], notes: [] });
  }).then(() => store.load()).then(v => {
    ok("memory save/load", v && v.items && v.items[0].id === "a");
    finish();
  }).catch(e => {
    ok("storage async", false, e && e.message);
    finish();
  });
}

/* ---------- UX-T01 / T02 / A01：反馈与动作语义（lib/feedback.js） ---------- */
section("feedback — 保存结果与排程结果分开");
{
  const fb = feedbackMod;

  ok("保存中不得出现「已保存」", !/已保存/.test(fb.saveFeedback("saving").text));
  const failedSave = fb.saveFeedback("failed");
  ok("保存失败不伪装成功", !/已保存/.test(failedSave.text) && failedSave.actionKind === "retry-save");
  const degraded = fb.saveFeedback("degraded");
  ok("降级保存按实际保障程度提示", /受限/.test(degraded.text));

  const nativeOK = {
    isNative: true, bridgeReady: true, notifySwitch: true, notifications: "granted",
    exactAlarm: "granted", reliability: "exact", alarmCount: 0, alarmScheduled: 0,
    capabilities: { notifications: true, screen: true, exact: true }
  };
  const timed = { hasTrigger: true, isFallbackTrigger: false, triggerAt: Date.now() + 3600000 };

  const vOK = fb.reminderFeedback({ persistence: "confirmed", item: timed, native: nativeOK, itemScheduled: true });
  ok("本条已获真实确认 → scheduled", vOK.kind === fb.REMINDER_KINDS.SCHEDULED, vOK.kind);
  ok("已确认的文案给出具体时间", /明天|今天|\d{1,2}月\d{1,2}日/.test(vOK.text), vOK.text);

  // 关键反例：全局一切正常，但**本条**的排程结果未知 —— 不许冒充已安排
  const vUnknown = fb.reminderFeedback({ persistence: "confirmed", item: timed, native: nativeOK, itemScheduled: null });
  ok("全局正常不能证明刚保存的这一条已排成功", vUnknown.kind === fb.REMINDER_KINDS.UNKNOWN, vUnknown.kind);

  const noTime = fb.reminderFeedback({
    persistence: "confirmed",
    item: { hasTrigger: false, isFallbackTrigger: false },
    native: nativeOK, itemScheduled: null
  });
  ok("没有明确时间 → 待补提醒时间", noTime.kind === fb.REMINDER_KINDS.NO_TIME, noTime.kind);
  ok("待整理文案不得暴露兜底时间为事项承诺", !/\d{1,2}:\d{2}/.test(noTime.text), noTime.text);

  const fbItem = fb.reminderFeedback({
    persistence: "confirmed",
    item: { hasTrigger: true, isFallbackTrigger: true, triggerAt: Date.now() + 7200000 },
    native: nativeOK, itemScheduled: true
  });
  ok("兜底时间不冒充已定的提醒时间", fbItem.kind === fb.REMINDER_KINDS.NO_TIME, fbItem.kind);

  const vOff = fb.reminderFeedback({
    persistence: "confirmed", item: timed, itemScheduled: null,
    native: Object.assign({}, nativeOK, { notifySwitch: false })
  });
  ok("总开关关闭 → 提醒已关闭", vOff.kind === fb.REMINDER_KINDS.SWITCH_OFF, vOff.kind);
  ok("不擅自替用户宣布已开启", !/已开启|已打开/.test(vOff.text), vOff.text);

  const vDenied = fb.reminderFeedback({
    persistence: "confirmed", item: timed, itemScheduled: null,
    native: Object.assign({}, nativeOK, { notifications: "denied", reliability: "in-app" })
  });
  ok("通知权限被拒 → permission-denied", vDenied.kind === fb.REMINDER_KINDS.PERMISSION_DENIED, vDenied.kind);
  ok("权限被拒文案不得说「完全不响」", !/完全|静默|不响/.test(vDenied.text), vDenied.text);

  const vAlarmLimited = fb.reminderFeedback({
    persistence: "confirmed", item: timed, itemScheduled: true,
    native: Object.assign({}, nativeOK, {
      notifications: "denied", reliability: "in-app", alarmCount: 1, alarmScheduled: 1,
      capabilities: { notifications: false, screen: false, exact: true }
    })
  });
  ok("闹钟可排但通知受限 → alarm-limited", vAlarmLimited.kind === fb.REMINDER_KINDS.ALARM_LIMITED, vAlarmLimited.kind);
  ok("受限文案明确「已安排闹钟」而不是「没安排」", /已安排闹钟/.test(vAlarmLimited.text), vAlarmLimited.text);
  ok("受限文案不误称完全不响", !/完全|静默/.test(vAlarmLimited.text), vAlarmLimited.text);

  const vInexact = fb.reminderFeedback({
    persistence: "confirmed", item: timed, itemScheduled: null,
    native: Object.assign({}, nativeOK, { exactAlarm: "denied", reliability: "inexact" })
  });
  ok("只能非精确 → 提醒可能延迟", vInexact.kind === fb.REMINDER_KINDS.INEXACT, vInexact.kind);

  const vErr = fb.reminderFeedback({
    persistence: "confirmed", item: timed, itemScheduled: null,
    native: Object.assign({}, nativeOK, { reliability: "error" })
  });
  ok("对账失败 → 排程失败 + 重试", vErr.kind === fb.REMINDER_KINDS.ERROR && vErr.actionKind === "retry-schedule");

  const vWeb = fb.reminderFeedback({ persistence: "confirmed", item: timed, native: { isNative: false }, itemScheduled: null });
  ok("Web/PWA 不显示 Android 就绪结论", vWeb.kind === fb.REMINDER_KINDS.WEB, vWeb.kind);

  // 反例（有牙齿）：任何输入组合都不许产出「漏提醒」这一结论
  const combos = [];
  ["confirmed", "degraded", "failed"].forEach(p => {
    [true, false].forEach(sc => {
      [null, nativeOK,
        Object.assign({}, nativeOK, { notifySwitch: false }),
        Object.assign({}, nativeOK, { notifications: "denied" }),
        Object.assign({}, nativeOK, { bridgeReady: false }),
        Object.assign({}, nativeOK, { reliability: "error" }),
        { isNative: false }].forEach(n => {
        [timed, { hasTrigger: false }, { hasTrigger: true, isFallbackTrigger: true }].forEach(it => {
          combos.push({ persistence: p, item: it, native: n, itemScheduled: sc });
        });
      });
    });
  });
  const wrong = combos.map(c => fb.reminderFeedback(c))
    .filter(v => /漏提醒|漏了提醒|确定漏/.test(v.text));
  ok("穷举 " + combos.length + " 种组合：不产出「漏提醒」结论", wrong.length === 0,
    wrong.length ? JSON.stringify(wrong[0]) : "");
}

section("feedback — 动作语义与术语");
{
  const fb = feedbackMod;
  const ack = fb.actionSpec("ack");
  ok("ACK 语义：停止本轮、仍未完成", /仍未完成/.test(ack.sub));
  ok("ACK 文案不承诺「以后不再提醒」", !/不再提醒|不会再提醒/.test(ack.firstTimeText + ack.sub));
  ok("ACK 首次反馈提供「稍后提醒」入口", ack.firstTimeAction === "稍后提醒");

  const snooze = fb.actionSpec("snooze", { when: Date.now() + 7200000 });
  ok("稍后提醒展示具体时间", /今天|明天|\d{1,2}月\d{1,2}日/.test(snooze.sub), snooze.sub);
  ok("原生快捷稍后明确标注 2 小时", /2 小时/.test(snooze.nativeSub));

  const done = fb.actionSpec("done", { hasRepeat: false });
  ok("完成：结束当前实例并归档", /归档/.test(done.sub));
  ok("完成后撤销窗口为 8 秒", done.undoWindowMs === 8000);
  const doneRep = fb.actionSpec("done", { hasRepeat: true });
  ok("周期完成的反馈说明是否存在下一周期", /下一周期/.test(doneRep.sub));

  const stop = fb.actionSpec("stop");
  ok("关闭声振不冒充 ACK/完成/稍后", stop.notAck === true && !/已确认|已完成|稍后/.test(stop.sub));

  ok("术语替换 ACK", fb.humanize("点击 ACK 按钮") === "点击 我知道了 按钮", fb.humanize("点击 ACK 按钮"));
  ok("术语替换 NEEDS_REVIEW", fb.humanize("NEEDS_REVIEW 记录") === "待整理 记录");
  ok("术语替换 Capture", fb.humanize("Capture 一条") === "记下 一条");

  const s1 = fb.captureSummary({});
  ok("无时间摘要明确说明会被先记下", s1.empty === true && /待整理/.test(s1.text));
  const s2 = fb.captureSummary({ triggerAt: Date.now() + 3600000, repeatText: "每两周", deadlineAt: Date.now() + 86400000 });
  ok("摘要展示有效提醒时间", /提醒/.test(s2.text));
  ok("摘要不隐藏已识别的周期", /每两周/.test(s2.text), s2.text);
  ok("摘要展示截止", /截止/.test(s2.text));

  const st = fb.setupSteps({ notifications: "granted", exactAlarm: "denied" });
  ok("已满足的能力不重复申请", st.next && st.next.id === "exact", st.next && st.next.id);
  ok("每个步骤都解释「为何需要」与「拒绝后的影响」",
    st.steps.every(s => s.why && s.denyImpact));
  const stAll = fb.setupSteps({ notifications: "granted", exactAlarm: "granted" });
  ok("测试步骤仍可达（未测试前不算全通过）", !stAll.allDone || stAll.steps.some(s => s.id === "test"));
  const background = stAll.steps.find(s => s.id === "background");
  ok("未打开后台设置且系统未确认时不算完成", background.done === false && background.verified === false);
  ok("后台说明不再声称所有国产系统锁屏 20 秒必然冻结",
    !/国产系统锁屏超过\s*20\s*秒/.test(background.why), background.why);
  const visited = fb.setupSteps(
    { notifications: "granted", exactAlarm: "granted", overlay: "denied", fullScreenIntent: "denied" },
    { backgroundVisited: true, overlayVisited: true }
  );
  const visitedBackground = visited.steps.find(s => s.id === "background");
  const visitedOverlay = visited.steps.find(s => s.id === "overlay");
  ok("打开过后台设置只推进向导，不冒充系统能力已验证",
    visitedBackground.done === true && visitedBackground.verified === false);
  ok("打开过悬浮窗设置只推进向导，不承诺一定只显示横幅",
    visitedOverlay.done === true && visitedOverlay.verified === false && /可能/.test(visitedOverlay.denyImpact));
  const verified = fb.setupSteps({
    notifications: "granted", exactAlarm: "granted", ignoringBatteryOptimizations: true,
    overlay: "granted", fullScreenIntent: "granted"
  });
  ok("系统可回读的后台与全屏能力仍可标记为已验证",
    verified.steps.find(s => s.id === "background").verified === true &&
    verified.steps.find(s => s.id === "overlay").verified === true);
  const missedRun = fb.setupSteps({}, {
    testRun: { startedAt: 1000, feedbackAt: 1100 },
    testFeedback: { value: "missed", at: 1100 }
  }).steps.find(s => s.id === "test");
  ok("60 秒测试有结果不等于验证通过", missedRun.done === true && missedRun.verified === false);
  const heardRun = fb.setupSteps({}, {
    testRun: { startedAt: 1000, feedbackAt: 1100 },
    testFeedback: { value: "heard", at: 1100 }
  }).steps.find(s => s.id === "test");
  ok("本次测试明确听到后才可标记为验证通过", heardRun.done === true && heardRun.verified === true);
  ok("未回答测试反馈不等于失败或成功", fb.testFeedbackVerdict(undefined).ok === null);
  ok("不确定既不算失败也不算成功", fb.testFeedbackVerdict("unsure").ok === null);
  ok("区分「没收到」与「不确定」", fb.testFeedbackVerdict("missed").ok === false);
}

/* ---------- UX-T03：原生送达证据（lib/delivery-evidence.js） ---------- */
section("delivery-evidence — 证据合并与事后核查");
{
  const ev = evidenceMod;
  ok("展示状态里没有 missed 这一档", !Object.prototype.hasOwnProperty.call(ev.STATUS, "MISSED"));
  const allStates = Object.keys(ev.STATUS).map(k => ev.STATUS[k]);
  ok("没有代表「漏提醒」的状态值", allStates.indexOf("missed") < 0 && allStates.indexOf("fail") < 0);

  const now = 1789000000000;
  // 独立验收 F06 / R4：回执必须锚到**我们登记过的那一轮**，所以事项先得有一份排程登记。
  // 没有登记的轮次一律 unknown —— 宁可「尚未确认」，也不谎报「系统已接收」。
  const scheduledAt = (at, roundBase) => ({ at: at, state: "scheduled", roundBase: roundBase });
  const baseItem = () => ({
    id: "i1", status: "waiting", triggerAt: now - 3600000, rev: 3,
    reminderEvents: {
      ["0@" + (now - 3600000)]: scheduledAt(now - 3600000, now - 3600000),
      ["1@" + (now - 1800000)]: scheduledAt(now - 1800000, now - 3600000)
    }
  });

  const rawGood = [{ id: 5, token: "t1", itemId: "i1", itemRev: "3", reminderKey: "0@" + (now - 3600000), receivedAt: now - 3599000, carrier: "alarm" }];
  const norm = ev.normalizeEvidence(rawGood, "bridge");
  ok("身份完整的事件被接受", norm.length === 1 && norm[0].valid === true);
  ok("最小身份含事项 ID + 提醒键 + 计划时刻 + 载体", norm[0].itemId === "i1" && norm[0].key && norm[0].at && norm[0].carrier === "alarm");
  ok("只声明「系统已接收」，不写成用户看到", norm[0].level === "received");

  const items = [baseItem()];
  const r1 = ev.mergeEvidence(items, norm, now);
  ok("首次合并写入 delivered", r1.changed === true && r1.applied === 1);
  ok("送达证据落在三态台账上", items[0].reminderEvents[norm[0].key].state === "delivered");

  const r2 = ev.mergeEvidence(items, ev.normalizeEvidence(rawGood, "bridge"), now);
  ok("重复回执幂等：第二次不产生变化", r2.changed === false && r2.applied === 0 && r2.deduped === 1);
  // 差分对照：不同 key 的证据**确实**会改变 —— 证明上面的 false 不是因为函数恒空转
  const r2b = ev.mergeEvidence(items, ev.normalizeEvidence(
    [{ itemId: "i1", reminderKey: "1@" + (now - 1800000), receivedAt: now - 1799000, itemRev: "3", carrier: "alarm" }], "bridge"), now);
  ok("对照组：换一个提醒键会正常写入（上面的幂等不是空转）", r2b.changed === true && r2b.applied === 1);

  // 旧轮次守卫：键的原定时刻早于当前触发起点
  const item2 = [{ id: "i2", status: "waiting", triggerAt: now, rev: 9 }];
  const stale = ev.normalizeEvidence(
    [{ itemId: "i2", reminderKey: "0@" + (now - 7200000), receivedAt: now - 7199000, itemRev: "9", carrier: "alarm" }], "bridge");
  const rs = ev.mergeEvidence(item2, stale, now);
  ok("旧轮次回执不写入（不污染新轮次）", rs.applied === 0 && item2[0].reminderEvents === undefined);
  ok("旧轮次回执的判据是 stale-round，不是被身份检查顺带挡掉",
    rs.reasons.indexOf("stale-round") >= 0, JSON.stringify(rs));
  // 成对差分：两条事项只差「本轮有没有登记过这个键」
  const freshKey = "0@" + (now + 60000);
  const item2b = [{
    id: "i2b", status: "waiting", triggerAt: now, rev: 9,
    reminderEvents: { [freshKey]: scheduledAt(now + 60000, now) }
  }];
  const fresh = ev.normalizeEvidence(
    [{ itemId: "i2b", reminderKey: freshKey, receivedAt: now + 61000, itemRev: "9", carrier: "alarm" }], "bridge");
  const rf = ev.mergeEvidence(item2b, fresh, now);
  ok("成对差分：仅把原定时刻挪进本轮就必须写入", rf.applied === 1, JSON.stringify(rf));

  // R4 反例（独立验收报告 F06）：原定时刻**落在本轮内**，但这一轮我们从来没登记过。
  // 旧实现只比 `ev.at >= item.triggerAt`，在这里会写出「系统已接收」—— 那是假的。
  const item2c = [{ id: "i2c", status: "waiting", triggerAt: now, rev: 9, reminderEvents: {} }];
  const unreg = ev.normalizeEvidence(
    [{ itemId: "i2c", reminderKey: "0@" + (now + 90000), receivedAt: now + 91000, itemRev: "9", carrier: "alarm" }], "bridge");
  const ru = ev.mergeEvidence(item2c, unreg, now);
  ok("R4 未登记的轮次不写入（宁可尚未确认，不谎报已接收）",
    ru.applied === 0 && ru.unknown === 1 && ru.reasons[0] === "unregistered-round" &&
    Object.keys(item2c[0].reminderEvents).length === 0, JSON.stringify(ru));

  // 独立复验 R-F06 / X1：键**登记过**、原定时刻也落在本轮范围内，但它属于**上一轮**。
  // 「稍后提醒」把触发起点往后挪之后，旧轮的追提醒键照样落在新范围内 ——
  // 只判「登记过」就会让旧回执把新轮抬成「系统已接收」。
  const roundItem = (id) => ({
    id: id, status: "waiting", triggerAt: now, rev: 9,
    reminderEvents: {
      // 当前轮：真的登记过，还没收到证据
      ["0@" + (now + 60000)]: { at: now + 60000, state: "scheduled", roundBase: now },
      // 上一轮留下的历史：原定时刻晚于当前起点，所以范围判据拦不住它
      ["1@" + (now + 1800000)]: { at: now + 1800000, state: "cancelled", roundBase: now - 3600000 }
    }
  });
  ok("R-F06 条目自带轮次身份时以它为准",
    ev.entryRoundBase({ triggerAt: now }, { at: now + 1000, state: "delivered", roundBase: now - 5000 }) === now - 5000);
  ok("Y2 旧版写入的条目没有轮次身份时保持不可验证（不冒充当前轮）",
    ev.entryRoundBase({ triggerAt: now }, { at: now + 1000, state: "delivered" }) === null);
  ok("Y2 对照：旧版 0@triggerAt 首期键可证明属于当前轮",
    ev.entryRoundBase({ triggerAt: now }, { at: now, state: "delivered" }, "0@" + now) === now);
  ok("Y2 旧版追提醒即使落在当前范围也不可从时刻猜成当前轮",
    ev.entryRoundBase({ triggerAt: now }, { at: now + 1800000, state: "delivered" }, "1@" + (now + 1800000)) === null);

  const item2d = [roundItem("i2d")];
  const oldRoundEv = ev.normalizeEvidence(
    [{ itemId: "i2d", reminderKey: "1@" + (now + 1800000), receivedAt: now + 1800000, itemRev: "8", carrier: "alarm" }], "bridge");
  const rd = ev.mergeEvidence(item2d, oldRoundEv, now);
  ok("R-F06 登记过但属于上一轮的键不写入（判据 superseded-round，不是被范围判据顺带挡掉）",
    rd.applied === 0 && rd.unknown === 1 && rd.reasons[0] === "superseded-round", JSON.stringify(rd));
  ok("R-F06 旧轮的键保留为历史（cancelled 不被改写成 delivered）",
    item2d[0].reminderEvents["1@" + (now + 1800000)].state === "cancelled",
    JSON.stringify(item2d[0].reminderEvents));

  // 对照组：同一事项、同一批形状，只把回执换成**当前轮**登记的那条 ⇒ 必须写入
  const item2e = [roundItem("i2e")];
  const newRoundEv = ev.normalizeEvidence(
    [{ itemId: "i2e", reminderKey: "0@" + (now + 60000), receivedAt: now + 61000, itemRev: "9", carrier: "alarm" }], "bridge");
  const re = ev.mergeEvidence(item2e, newRoundEv, now);
  ok("R-F06 对照组：属于当前轮的回执照常写入（上面的拒绝不是通路故障）",
    re.applied === 1 && item2e[0].reminderEvents["0@" + (now + 60000)].state === "delivered", JSON.stringify(re));

  // 展示面：旧轮的 delivered 不能让当前轮显示「系统已接收」
  const statusFixture = (deliveredRound) => ({
    id: "i2f", status: "waiting", triggerAt: now, rev: 9,
    reminderEvents: {
      ["0@" + (now + 60000)]: { at: now + 60000, state: "scheduled", roundBase: now },
      ["1@" + (now + 1800000)]: { at: now + 1800000, state: "delivered", receivedAt: now + 1810000, roundBase: deliveredRound }
    }
  });
  const oldDelivered = ev.evidenceStatusFor(statusFixture(now - 3600000),
    { now: now + 1810000, evidenceReadable: true });
  ok("R-F06 旧轮的 delivered 不抬高当前轮的状态（旧实现：直接显示「系统已接收」）",
    oldDelivered.state !== ev.STATUS.DELIVERED && oldDelivered.text !== ev.STATUS_TEXT.delivered,
    JSON.stringify(oldDelivered));
  const curDelivered = ev.evidenceStatusFor(statusFixture(now),
    { now: now + 1810000, evidenceReadable: true });
  ok("R-F06 对照组：属于当前轮的 delivered 仍然算数",
    curDelivered.state === ev.STATUS.DELIVERED, JSON.stringify(curDelivered));

  // 完成事项不被复活
  const item3 = [{
    id: "i3", status: "archived", completedAt: now - 1000, triggerAt: now - 3600000, rev: 4,
    reminderEvents: { ["0@" + (now - 3600000)]: scheduledAt(now - 3600000, now - 3600000) }
  }];
  ev.mergeEvidence(item3, ev.normalizeEvidence(
    [{ itemId: "i3", reminderKey: "0@" + (now - 3600000), receivedAt: now - 3599000, itemRev: "4", carrier: "alarm" }], "bridge"), now);
  ok("迟到回执不复活已完成事项", item3[0].status === "archived" && item3[0].completedAt === now - 1000);

  // 身份缺失/事项不存在 → unknown，不反推失败
  const bad = ev.normalizeEvidence([{ id: 7, itemId: "i1", receivedAt: now }, { title: "只有标题" }], "bridge");
  const rr = ev.mergeEvidence([baseItem()], bad, now);
  ok("缺身份的证据计入 unknown", rr.unknown === 2 && rr.applied === 0, JSON.stringify(rr));
  ok("unknown 不等于失败（不产生任何失败标记）", rr.reasons.every(x => x === "missing-identity"));
  const orphan = ev.mergeEvidence([baseItem()], ev.normalizeEvidence(
    [{ itemId: "nope", reminderKey: "0@" + now, receivedAt: now, itemRev: "1", carrier: "alarm" }], "bridge"), now);
  ok("事项已不存在 → unknown 而不是指控", orphan.unknown === 1 && orphan.reasons[0] === "item-missing");

  // 展示判定
  const noReg = ev.evidenceStatusFor({ id: "x", triggerAt: now }, { now: now });
  ok("没有登记过排程 → 无法核查（不是漏）", noReg.state === ev.STATUS.UNVERIFIABLE, noReg.state);
  ok("无法核查/未知的文案都不含「漏」", !/漏/.test(noReg.text), noReg.text);

  const pendingItem = { id: "p", triggerAt: now + 600000, reminderEvents: { ["0@" + (now + 600000)]: { at: now + 600000, state: "scheduled", roundBase: now + 600000 } } };
  ok("未到点 → pending", ev.evidenceStatusFor(pendingItem, { now: now }).state === ev.STATUS.PENDING);

  const dueNoEvidence = { id: "d", triggerAt: now - 3600000, reminderEvents: { ["0@" + (now - 3600000)]: { at: now - 3600000, state: "scheduled", roundBase: now - 3600000 } } };
  const st1 = ev.evidenceStatusFor(dueNoEvidence, { now: now });
  ok("到点但缺证据 → unknown", st1.state === ev.STATUS.UNKNOWN, st1.state);
  ok("缺证据的文案只说「尚未确认」", /尚未确认/.test(st1.text), st1.text);
  ok("缺证据绝不判成失败", st1.isMissed === false && !/失败|漏/.test(st1.text));

  const st2 = ev.evidenceStatusFor(dueNoEvidence, { now: now - 3600000 + 30000 });
  ok("刚到点 → processing（不立刻断言结果）", st2.state === ev.STATUS.PROCESSING, st2.state);
  const st3 = ev.evidenceStatusFor(dueNoEvidence, { now: now, evidenceReadable: false });
  ok("证据通道读不到 → unknown（不指控）", st3.state === ev.STATUS.UNKNOWN);
  const st4 = ev.evidenceStatusFor(dueNoEvidence, { now: now, readbackInFlight: true });
  ok("回读进行中 → processing", st4.state === ev.STATUS.PROCESSING);

  const delivered = { id: "z", triggerAt: now - 3600000, reminderEvents: { ["0@" + (now - 3600000)]: { at: now - 3600000, state: "delivered", level: "received", roundBase: now - 3600000 } } };
  const st5 = ev.evidenceStatusFor(delivered, { now: now });
  ok("有证据 → delivered", st5.state === ev.STATUS.DELIVERED);
  ok("有证据也只说「系统已接收」", /系统已接收/.test(st5.text) && !/已读|用户看到/.test(st5.text), st5.text);

  // 乱序：先收到晚轮次、再收到早轮次
  const item4 = [{
    id: "i4", status: "waiting", triggerAt: now - 7200000, rev: 1,
    reminderEvents: {
      ["0@" + (now - 7200000)]: scheduledAt(now - 7200000, now - 7200000),
      ["3@" + (now - 1800000)]: scheduledAt(now - 1800000, now - 7200000)
    }
  }];
  ev.mergeEvidence(item4, ev.normalizeEvidence(
    [{ itemId: "i4", reminderKey: "3@" + (now - 1800000), receivedAt: now - 1799000, itemRev: "1", carrier: "alarm" }], "bridge"), now);
  ev.mergeEvidence(item4, ev.normalizeEvidence(
    [{ itemId: "i4", reminderKey: "0@" + (now - 7200000), receivedAt: now - 7199000, itemRev: "1", carrier: "alarm" }], "bridge"), now);
  ok("乱序到达的两轮证据都能各自关联", Object.keys(item4[0].reminderEvents).length === 2);
  ok("乱序下展示取最新已送达轮次",
    ev.evidenceStatusFor(item4[0], { now: now }).at === now - 1800000);
}

function finish() {
  console.log("\n========== unit results ==========");
  console.log("通过: " + passed + "  失败: " + failed);
  if (failed) {
    failures.forEach(f => console.log("  - " + f));
    process.exit(1);
  }
  console.log("全部通过。");
}
