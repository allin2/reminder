#!/usr/bin/env node
/*
 * 截止保护准入 + 勿扰区延后 的取证脚本。
 *
 * 目的：用**可复现**的方式判定两件事，而不是靠读代码下结论。
 *  A) 第 1 轮 H-05「截止块不校验 status → acknowledged 仍弹截止提醒」到底是不是缺陷。
 *     判据：项目权威（app-core.js:1551 `!isTerminal(it)`）与投影（native-reminders.js:313）
 *     是否对同一事项给出同样的准入。若一致，则 H-05 是**误报**。
 *  B) 第 1 轮 H-06「勿扰区内且 quietEnd 已过的普通事项被直接丢弃」的精确范围与后果。
 *
 * 用法：/usr/local/bin/node scripts/verification/deadline-quiet-probe.js
 */
"use strict";

const path = require("path");
const NR = require(path.resolve(__dirname, "../../lib/native-reminders.js"));

const T = (h, m) => new Date(2026, 8, 18, h, m || 0, 0, 0).getTime(); // 2026-09-18
const DND = { dnd: true, quietStart: "23:00", quietEnd: "07:30" };
const fmt = ts => new Date(ts).toLocaleString("zh-CN", { hour12: false });

function show(label, items, settings, now) {
  const desired = NR.buildDesired(items, settings, now);
  console.log("\n【" + label + "】 now=" + fmt(now));
  if (!desired.length) { console.log("   → 无任何排程"); return desired; }
  for (const n of desired) {
    console.log("   → " + String(n.extra.event).padEnd(9) +
      " at=" + fmt(n.schedule.at.getTime()) +
      (n.extra.stageKey ? "  stage=" + n.extra.stageKey : "") +
      "  id=" + n.id);
  }
  return desired;
}

const base = {
  id: "a1", title: "测试事项", rev: 1, priority: "normal",
  delivery_mode: "notify", triggerAt: T(20, 0)
};

console.log("============================================================");
console.log("A) 截止保护准入：acknowledged 是否也拿到截止排程？");
console.log("   权威门槛 app-core.js:1551 = deadlineAt && !deadlinePaused && !isTerminal");
console.log("   isTerminal = archived || completed（app-core.js:984）");
console.log("============================================================");
const now = T(14, 0);
for (const status of ["waiting", "due", "acknowledged", "completed", "archived"]) {
  const item = Object.assign({}, base, { status, deadlineAt: now + 3 * 3600000 });
  const d = show("status=" + status, [item], DND, now);
  const dl = d.filter(n => n.extra.event === "deadline").length;
  const pri = d.filter(n => n.extra.event !== "deadline").length;
  console.log("     小结：截止排程 " + dl + " 条，事项排程 " + pri + " 条" +
    (status === "completed" || status === "archived" ? "  ← 终态，应为 0/0" : ""));
}

console.log("\n============================================================");
console.log("B) 勿扰区延后：quietEnd 既已过去会发生什么？");
console.log("   设置 dnd=on，勿扰 23:00–07:30，事项 02:00（普通优先级）");
console.log("============================================================");
const quietItem = Object.assign({}, base, { id: "q1", status: "waiting", triggerAt: T(2, 0) });
console.log("   effectiveTriggerAt(02:00) = " + fmt(NR.effectiveTriggerAt(quietItem, DND)) +
  "   ← 02:00 → 当日 07:30");

show("对账时刻 02:30（仍在勿扰区内）", [quietItem], DND, T(2, 30));
show("对账时刻 07:00（仍在勿扰区内）", [quietItem], DND, T(7, 0));
show("对账时刻 09:00（quietEnd 已过）", [quietItem], DND, T(9, 0));
show("对账时刻 09:00（未开勿扰，对照）", [quietItem], { dnd: false }, T(9, 0));

const important = Object.assign({}, base, { id: "q2", status: "waiting", priority: "important", triggerAt: T(2, 0) });
show("重要事项 02:00（勿扰只延后普通优先级）", [important], DND, T(9, 0));

console.log("\n============================================================");
console.log("C) 对照：截止点已过时，截止块会补提醒（at = now + 2s）");
console.log("============================================================");
const pastDeadline = Object.assign({}, base, { id: "d1", status: "waiting", deadlineAt: T(12, 0) });
show("截止 12:00，对账 14:00（p24/p2 都已过且无台账）", [pastDeadline], DND, T(14, 0));
