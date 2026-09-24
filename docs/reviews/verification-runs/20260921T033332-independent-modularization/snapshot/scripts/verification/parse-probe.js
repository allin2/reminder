const P = require("/Users/qlyf/Developer/reminder/lib/parse-cn.js");
const R = require("/Users/qlyf/Developer/reminder/lib/repeat.js");
const M = require("/Users/qlyf/Developer/reminder/lib/reminder.js");
const now = new Date(2026, 8, 18, 14, 0, 0); // 2026-09-18 周五 14:00
const fmt = t => (t ? new Date(t).toLocaleString("zh-CN", { hour12: false }) : String(t));
const cases = [
  "提醒我下周三交房租", "下周三下午3点开会", "3月15日报名截止", "每月最后一天交房租",
  "两小时后提醒我吃药", "一个半小时后提醒我", "1.5小时后提醒我", "半小时后看看",
  "大后天上午9点体检", "下个月5号交电费", "每周一早上9点站会", "每隔两周给爸妈打电话",
  "四十分钟后提醒我", "九十分钟后提醒我", "二十三分钟后提醒我", "今天晚上8点看直播",
  "收到快递后拆一下", "记得买牛奶", "3天后还信用卡", "周末看那个纪录片",
  "明天上午10点半面试", "12月31日之前提交年报", "截止到本周五", "提前2天提醒我报名",
  "每月第一个周一开会", "下下周一开会", "每月15号提醒我", "明天上午9点前提交"
];
for (const c of cases) {
  const r = P.parseChineseTime(c, now);
  console.log(
    JSON.stringify(c).padEnd(26), "|", String(r.confidence).padEnd(5), "|",
    fmt(r.trigger).padEnd(21), "| 截止:", fmt(r.deadline).padEnd(21),
    "| 标题:", r.title, r.repeat ? "| 周期:" + JSON.stringify(r.repeat) : ""
  );
}
console.log("\n--- cnInt ---");
["四十", "九十", "三十五", "一百", "二十三", "二百五"].forEach(s => console.log(s, "=", P.cnInt(s)));

console.log("\n--- every=month, anchor 1/31 09:00 ---");
let it = { repeat: { mode: "calendar", every: "month" }, triggerAt: new Date(2026, 0, 31, 9, 0).getTime() };
for (let i = 0; i < 5; i++) { const n = R.nextRepeatTrigger(it); console.log(fmt(n)); if (!n) break; it = { repeat: it.repeat, triggerAt: n }; }

console.log("\n--- every=monthEnd, anchor 1/31 09:00 ---");
let it2 = { repeat: { mode: "calendar", every: "monthEnd" }, triggerAt: new Date(2026, 0, 31, 9, 0).getTime() };
for (let i = 0; i < 4; i++) { const n = R.nextRepeatTrigger(it2); console.log(fmt(n)); if (!n) break; it2 = { repeat: it2.repeat, triggerAt: n }; }

console.log("\n--- nthWeekday 第1个周一, anchor 2026-09-07 ---");
let it3 = { repeat: { mode: "calendar", every: "nthWeekday", nth: 1, dow: 1 }, triggerAt: new Date(2026, 8, 7, 9, 0).getTime() };
for (let i = 0; i < 4; i++) { const n = R.nextRepeatTrigger(it3); console.log(fmt(n)); if (!n) break; it3 = { repeat: it3.repeat, triggerAt: n }; }

console.log("\n--- deadlineStagePoints ---");
console.log(M.deadlineStagePoints(new Date(2026, 8, 20, 12, 0).getTime()).map(p => p.id + ":" + fmt(p.at)).join(" | "));
console.log("deadlineStage(overdue 30h) =", M.deadlineStage(Date.now() - 30 * 3600000, Date.now()));
