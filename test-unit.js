/* 安心收件箱 — unit tests for lib modules (node) */
"use strict";

const path = require("path");
const parse = require(path.join(__dirname, "lib/parse-cn.js"));
const repeat = require(path.join(__dirname, "lib/repeat.js"));
const reminder = require(path.join(__dirname, "lib/reminder.js"));
const storageMod = require(path.join(__dirname, "lib/storage.js"));

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

function finish() {
  console.log("\n========== unit results ==========");
  console.log("通过: " + passed + "  失败: " + failed);
  if (failed) {
    failures.forEach(f => console.log("  - " + f));
    process.exit(1);
  }
  console.log("全部通过。");
}
