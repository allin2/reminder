/* Android native reminder projection tests (Node mocks) */
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const native = require(path.join(__dirname, "lib/native-reminders.js"));

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

function createEnvironment(options) {
  options = options || {};
  const calls = { schedule: [], cancel: [], deliveredRemoved: [], channels: [], actionTypes: [] };
  const alarmCalls = { scheduleAlarm: [], scheduleAt: [], cancelAlarm: [] };
  let pending = (options.pending || []).slice();
  let actionCallback = null;
  let resumeCallback = null;
  const display = options.display || "granted";
  const exact = options.exact || "granted";
  const local = {
    async checkPermissions() { return { display: options.display || "granted" }; },
    async requestPermissions() { return { display: options.requestDisplay || options.display || "granted" }; },
    async checkExactNotificationSetting() { return { exact_alarm: options.exact || "granted" }; },
    async changeExactNotificationSetting() { return { exact_alarm: options.changedExact || options.exact || "granted" }; },
    async createChannel(channel) { calls.channels.push(channel); },
    async registerActionTypes(value) { calls.actionTypes.push(value); },
    async addListener(name, callback) {
      if (name === "localNotificationActionPerformed") actionCallback = callback;
      return { async remove() { actionCallback = null; } };
    },
    async getPending() { return { notifications: pending.slice() }; },
    async schedule(value) {
      calls.schedule.push(value.notifications.slice());
      pending = pending.concat(value.notifications);
      return { notifications: value.notifications.map(n => ({ id: n.id })) };
    },
    async cancel(value) {
      calls.cancel.push(value.notifications.slice());
      const ids = new Set(value.notifications.map(n => n.id));
      pending = pending.filter(n => !ids.has(n.id));
    },
    async removeDeliveredNotifications(value) { calls.deliveredRemoved.push(value.notifications.slice()); }
  };
  const app = {
    async addListener(name, callback) {
      if (name === "appStateChange") resumeCallback = callback;
      return { async remove() { resumeCallback = null; } };
    }
  };
  // SystemBridge：全屏闹钟通道（D9 / D25 / P0-2 / P1-4）
  const bridge = {
    async scheduleAlarm(value) { alarmCalls.scheduleAlarm.push(value); return { ok: true, id: value.id, mode: "alarmClock" }; },
    async scheduleAt(value) { alarmCalls.scheduleAt.push(value); return { ok: true, id: value.id, mode: "alarmClock" }; },
    async cancelAlarm(value) { alarmCalls.cancelAlarm.push(value); return { ok: true }; },
    async diagnose() {
      return {
        notificationsEnabled: display !== "denied",
        postNotificationsGranted: display !== "denied",
        canExactAlarm: exact === "granted",
        ignoringBatteryOptimizations: true
      };
    }
  };
  global.Capacitor = {
    getPlatform() { return "android"; },
    Plugins: { LocalNotifications: local, App: app, SystemBridge: bridge }
  };
  return {
    calls,
    alarms: alarmCalls,
    get pending() { return pending; },
    fireAction(value) { if (actionCallback) actionCallback(value); },
    resume() { if (resumeCallback) resumeCallback({ isActive: true }); }
  };
}

function item(id, priority, triggerAt, extra) {
  return Object.assign({
    id,
    title: "事项 " + id,
    priority,
    status: "waiting",
    triggerAt,
    deadlineAt: null,
    dismissedUntil: null
  }, extra || {});
}

async function run() {
  const now = new Date(2026, 0, 15, 10, 0, 0).getTime();

  section("browser fallback");
  delete global.Capacitor;
  ok("非 Android 不启用原生适配", !native.isNativeAndroid());
  const webStatus = await native.reconcile([], {}, now);
  ok("Web 状态保持 web", webStatus.reliability === "web");

  section("schedule policies");
  createEnvironment();
  const desired = native.buildDesired([
    item("normal", "normal", now + 60 * 60 * 1000),
    item("important", "important", now + 2 * 60 * 60 * 1000),
    item("critical", "critical", now + 3 * 60 * 60 * 1000)
  ], { notify: true, importantRepeat: true }, now);
  ok("普通事项 1 次", desired.filter(n => n.extra.itemId === "normal").length === 1);
  ok("重要事项共 4 次", desired.filter(n => n.extra.itemId === "important").length === 4);
  ok("关键事项共 8 次", desired.filter(n => n.extra.itemId === "critical").length === 8);
  const importantTimes = desired.filter(n => n.extra.itemId === "important").map(n => n.schedule.at.getTime());
  ok("重要事项间隔 30 分钟", importantTimes[1] - importantTimes[0] === 30 * 60 * 1000);
  const criticalTimes = desired.filter(n => n.extra.itemId === "critical").map(n => n.schedule.at.getTime());
  ok("关键事项间隔 15 分钟", criticalTimes[1] - criticalTimes[0] === 15 * 60 * 1000);
  ok("渠道按优先级区分", new Set(desired.map(n => n.channelId)).size === 3);

  const noRepeat = native.buildDesired([
    item("important-off", "important", now + 60 * 60 * 1000)
  ], { notify: true, importantRepeat: false }, now);
  ok("关闭持续提醒后重要事项仅 1 次", noRepeat.length === 1);

  section("quiet hours, privacy, deadline");
  const quietAt = new Date(2026, 0, 15, 23, 30, 0).getTime();
  const quietDesired = native.buildDesired([
    item("quiet-normal", "normal", quietAt),
    item("quiet-important", "important", quietAt),
    item("deadline", "normal", now + 4 * 86400000, { deadlineAt: now + 3 * 86400000 })
  ], {
    notify: true,
    dnd: true,
    quietStart: "23:00",
    quietEnd: "07:30",
    privacyNotify: true,
    importantRepeat: true
  }, now);
  const quietNormal = quietDesired.find(n => n.extra.itemId === "quiet-normal");
  const quietImportant = quietDesired.find(n => n.extra.itemId === "quiet-important" && n.extra.attempt === 0);
  ok("勿扰时普通事项延后到次日 07:30", quietNormal.schedule.at.getHours() === 7 && quietNormal.schedule.at.getMinutes() === 30);
  ok("重要事项不被应用勿扰延后", quietImportant.schedule.at.getTime() === quietAt);
  ok("锁屏隐私隐藏正文", quietDesired.every(n => n.body === "有一条事项需要你确认"));
  ok("Deadline Protection 独立排程", quietDesired.some(n => n.extra.itemId === "deadline" && n.extra.event === "deadline"));

  section("dismiss and stable ids");
  const dismissed = native.buildDesired([
    item("dismissed", "critical", now + 5 * 60 * 1000, { dismissedUntil: now + 31 * 60 * 1000 })
  ], { notify: true }, now);
  ok("关闭弹条不取消首次提醒", dismissed.some(n => n.extra.attempt === 0));
  ok("30 分钟内补充提醒被屏蔽", dismissed.filter(n => n.extra.attempt > 0).every(n => n.schedule.at.getTime() >= now + 31 * 60 * 1000));
  ok("排程携带显式版本", dismissed.every(n => n.extra.scheduleVersion === native.SCHEDULE_VERSION));
  const firstIds = native.buildDesired([
    item("b", "normal", now + 100000), item("a", "normal", now + 200000)
  ], { notify: true }, now).map(n => n.id).sort();
  const secondIds = native.buildDesired([
    item("a", "normal", now + 200000), item("b", "normal", now + 100000)
  ], { notify: true }, now).map(n => n.id).sort();
  ok("通知 ID 与事项顺序无关", JSON.stringify(firstIds) === JSON.stringify(secondIds));

  section("mixed time semantics");
  const wall = { triggerAt: now, scheduleBasis: null, localTrigger: null };
  ok("旧事项迁移为墙钟时间", native.migrateItem(wall) && wall.scheduleBasis === "wall-clock" && !!wall.localTrigger);
  const elapsed = {
    triggerAt: 0,
    scheduleBasis: "elapsed",
    snoozedAt: now,
    snoozeDelayMs: 2 * 60 * 60 * 1000
  };
  native.migrateItem(elapsed);
  ok("相对 Snooze 保持实际时长", elapsed.triggerAt === now + 2 * 60 * 60 * 1000);
  const local = "2026-07-09T08:45:00";
  ok("墙钟时间可往返", native.toLocalDateTime(native.fromLocalDateTime(local)) === local);
  const zoneProbe = ["Asia/Shanghai", "America/New_York"].map(zone => {
    const code = [
      "const n=require(" + JSON.stringify(path.join(__dirname, "lib/native-reminders.js")) + ");",
      "const wall={triggerAt:0,scheduleBasis:'wall-clock',localTrigger:'2026-07-09T08:45:00'};",
      "const elapsed={triggerAt:0,scheduleBasis:'elapsed',snoozedAt:1700000000000,snoozeDelayMs:7200000};",
      "n.migrateItem(wall);n.migrateItem(elapsed);",
      "process.stdout.write(JSON.stringify({wallAt:wall.triggerAt,wallLocal:n.toLocalDateTime(wall.triggerAt),elapsedAt:elapsed.triggerAt}));"
    ].join("");
    const result = spawnSync(process.execPath, ["-e", code], {
      encoding: "utf8",
      env: Object.assign({}, process.env, { TZ: zone })
    });
    return result.status === 0 ? JSON.parse(result.stdout) : null;
  });
  ok("跨时区仍保持本地墙钟", zoneProbe.every(Boolean) && zoneProbe[0].wallLocal === local && zoneProbe[1].wallLocal === local && zoneProbe[0].wallAt !== zoneProbe[1].wallAt);
  ok("跨时区相对 Snooze 不改变等待时长", zoneProbe.every(Boolean) && zoneProbe[0].elapsedAt === zoneProbe[1].elapsedAt);

  section("lifecycle projection");
  const lifecycle = item("lifecycle", "critical", now + 60 * 60 * 1000, {
    deadlineAt: now + 3 * 86400000
  });
  const lifecycleInitial = native.buildDesired([lifecycle], { notify: true }, now);
  ok("关键事项包含常规与 Deadline 排程", lifecycleInitial.length === 9 && lifecycleInitial.some(n => n.extra.event === "deadline"));
  const acknowledged = native.buildDesired([
    Object.assign({}, lifecycle, { status: "acknowledged" })
  ], { notify: true }, now);
  ok("ACK 取消常规补充但保留独立 Deadline", acknowledged.length === 1 && acknowledged[0].extra.event === "deadline");
  const completed = native.buildDesired([
    Object.assign({}, lifecycle, { status: "archived" })
  ], { notify: true }, now);
  ok("完成取消全部剩余排程", completed.length === 0);
  ok("删除事项后没有投影", native.buildDesired([], { notify: true }, now).length === 0);
  const snoozed = native.buildDesired([
    Object.assign({}, lifecycle, { priority: "normal", status: "snoozed", triggerAt: now + 2 * 60 * 60 * 1000, deadlineAt: null })
  ], { notify: true }, now);
  ok("Snooze 重新排到新时间", snoozed.length === 1 && snoozed[0].schedule.at.getTime() === now + 2 * 60 * 60 * 1000);
  const restored = native.buildDesired([
    Object.assign({}, lifecycle, { priority: "normal", status: "waiting", triggerAt: now + 60 * 60 * 1000, deadlineAt: null })
  ], { notify: true }, now);
  ok("恢复事项重新生成排程", restored.length === 1);

  section("permission and reconciliation");
  await native._resetForTests();
  const granted = createEnvironment();
  const future = [item("reconcile", "normal", now + 60 * 60 * 1000)];
  const first = await native.reconcile(future, { notify: true }, now);
  ok("首次对账创建排程", first.scheduled === 1 && granted.calls.schedule.length === 1);
  const second = await native.reconcile(future, { notify: true }, now);
  ok("重复对账不重复排程", second.scheduled === 0 && granted.calls.schedule.length === 1);
  const cleared = await native.reconcile([], { notify: true }, now);
  ok("陈旧排程被取消", cleared.cancelled === 1 && granted.pending.length === 0);
  await native.reconcile(future, { notify: true }, now);
  const edited = [item("reconcile", "normal", now + 2 * 60 * 60 * 1000)];
  const editedStatus = await native.reconcile(edited, { notify: true }, now);
  ok("编辑时间会取消旧排程并创建新排程", editedStatus.cancelled === 1 && editedStatus.scheduled === 1 && granted.pending.length === 1);

  await native._resetForTests();
  const denied = createEnvironment({ display: "denied", exact: "denied" });
  const deniedStatus = await native.reconcile(future, { notify: true }, now);
  ok("通知拒绝时仅应用内提醒", deniedStatus.reliability === "in-app" && denied.calls.schedule.length === 0);

  await native._resetForTests();
  const inexact = createEnvironment({ display: "granted", exact: "denied" });
  const inexactStatus = await native.reconcile(future, { notify: true }, now);
  ok("精确权限拒绝时保留非精确排程", inexactStatus.reliability === "inexact" && inexact.calls.schedule.length === 1);

  section("alarm first delivery (D9 / D25 / A-01)");
  {
    const items = [
      item("n-plain", "normal", now + 3600000),
      item("im", "important", now + 3600000),
      item("cr", "critical", now + 3600000),
      item("n-alarm", "normal", now + 3600000, { delivery_mode: "alarm" })
    ];
    const d = native.buildDesired(items, { notify: true }, now);
    const first = id => d.find(n => n.extra.itemId === id && n.extra.attempt === 0);
    ok("D25 重要档首次走全屏闹钟", !!(first("im") && first("im").extra.useAlarm));
    ok("D25 关键档首次走全屏闹钟", !!(first("cr") && first("cr").extra.useAlarm));
    ok("A-01 默认通知的普通档首次不走闹钟", !(first("n-plain") && first("n-plain").extra.useAlarm));
    ok("A-01 delivery_mode=alarm 的普通档首次走闹钟", !!(first("n-alarm") && first("n-alarm").extra.useAlarm));
    ok("D25 重要档后续 3 次仍走通知", d.filter(n => n.extra.itemId === "im" && n.extra.attempt > 0).every(n => !n.extra.useAlarm));
    ok("D25 关键档后续 7 次仍走通知", d.filter(n => n.extra.itemId === "cr" && n.extra.attempt > 0).every(n => !n.extra.useAlarm));
  }

  section("alarm reconciliation (P0-2)");
  {
    await native._resetForTests();
    const env = createEnvironment();
    const alarmItem = item("alarmA", "critical", now + 3600000);

    const s1 = await native.reconcile([alarmItem], { notify: true }, now, null);
    ok("首次对账排下全屏闹钟", s1.alarmScheduled === 1 && env.alarms.scheduleAlarm.length === 1);
    ok("对账回报已排闹钟 id", s1.scheduledAlarmIds.length === 1 && s1.scheduledAlarmIds[0] === env.alarms.scheduleAlarm[0].id);

    const held = { notify: true, scheduledAlarmIds: s1.scheduledAlarmIds };
    const s2 = await native.reconcile([alarmItem], held, now, null);
    ok("重复对账不误撤闹钟", s2.alarmCancelled === 0 && env.alarms.cancelAlarm.length === 0);

    const s3 = await native.reconcile([], held, now, null);
    ok("删除事项撤销全屏闹钟", s3.alarmCancelled === 1 && env.alarms.cancelAlarm.length === 1);
    ok("撤销后不再持有 alarm id", s3.scheduledAlarmIds.length === 0);

    const s4 = await native.reconcile([alarmItem], held, now, null);
    const off = { notify: false, scheduledAlarmIds: s4.scheduledAlarmIds };
    const beforeOff = env.alarms.scheduleAlarm.length;
    const s5 = await native.reconcile([alarmItem], off, now, null);
    ok("关闭「本地通知」后撤销全屏闹钟", s5.alarmCancelled === 1 && s5.scheduledAlarmIds.length === 0);
    ok("关闭后不再新排闹钟", env.alarms.scheduleAlarm.length === beforeOff);
  }

  section("review projection (P0-1 / P1-6 / D18 / D22)");
  {
    const rs = { enabled: true, hour: 21, minute: 30, followupMs: 60 * 60 * 1000, maxFollowups: 2 };
    const rd = native.buildReviewDesired(4, rs, now, { notify: true });
    ok("D22 待整理当天共 3 次", rd.length === 3, String(rd.length));
    ok("D22 补提醒间隔 60 分钟", rd[1].schedule.at.getTime() - rd[0].schedule.at.getTime() === 60 * 60 * 1000);
    ok("D22 窗口起点 21:30", rd[0].schedule.at.getHours() === 21 && rd[0].schedule.at.getMinutes() === 30);
    ok("P1-6 待整理走普通渠道", rd.every(n => n.channelId === native.CHANNELS.normal));
    ok("D12 待整理通知带快捷动作类型", rd.every(n => n.actionTypeId === native.ACTION_TYPE_ID));
    ok("关闭整理功能则不排", native.buildReviewDesired(2, { enabled: false }, now, { notify: true }).length === 0);

    const beforeWindow = new Date(2026, 0, 15, 20, 0, 0).getTime();
    const rq = native.buildReviewDesired(2, rs, beforeWindow, { dnd: true, quietStart: "20:00", quietEnd: "23:00" });
    ok("D18 窗口起点落入勿扰 → 顺延到勿扰结束",
      rq.length === 3 && rq[0].schedule.at.getTime() === new Date(2026, 0, 15, 23, 0, 0).getTime());
    ok("D18 补提醒按顺延后锚点固定间隔，不被各自顺延压成一条",
      rq[1].schedule.at.getTime() === new Date(2026, 0, 16, 0, 0, 0).getTime() &&
      rq[2].schedule.at.getTime() === new Date(2026, 0, 16, 1, 0, 0).getTime());

    // D20：稍后必须单独占一个槽位，否则安卓上「稍后 30 分钟」到点不响
    const snoozed = Object.assign({}, rs, { snoozedUntil: new Date(2026, 0, 15, 23, 20, 0).getTime() });
    const rsn = native.buildReviewDesired(3, snoozed, new Date(2026, 0, 15, 22, 50, 0).getTime(), { notify: true });
    ok("D20 稍后时刻被排进待整理通知",
      rsn.some(n => n.schedule.at.getTime() === new Date(2026, 0, 15, 23, 20, 0).getTime()),
      rsn.map(n => n.schedule.at.toLocaleString()).join(" | "));
    const rsPast = Object.assign({}, rs, { snoozedUntil: new Date(2026, 0, 15, 23, 20, 0).getTime() });
    const rsp = native.buildReviewDesired(3, rsPast, new Date(2026, 0, 15, 23, 40, 0).getTime(), { notify: true });
    ok("D20 已过去的稍后不再占槽位", rsp.length === 3, String(rsp.length));

    await native._resetForTests();
    const env = createEnvironment();
    const review = { count: 3, settings: rs };
    const sr = await native.reconcile([], { notify: true }, now, review);
    ok("P0-1 待整理并入同一次对账", sr.desired === 3 && sr.scheduled === 3 && env.calls.schedule.length === 1);
    const srOff = await native.reconcile([], { notify: false }, now, review);
    ok("D18 关闭通知总开关后待整理排程被撤销", srOff.cancelled === 3 && srOff.scheduled === 0);
    const srDisabled = await native.reconcile([], { notify: true }, now, { count: 3, settings: { enabled: false } });
    ok("D18 关闭整理功能后不排待整理", srDisabled.desired === 0);
    const srNone = await native.reconcile([], { notify: true }, now, null);
    ok("P0-1 未传待整理上下文时不排", srNone.desired === 0);
  }

  section("actions and resume");
  await native._resetForTests();
  const events = [];
  let resumed = 0;
  const actionEnv = createEnvironment();
  await native.initialize({ onAction: e => events.push(e), onResume: () => resumed++ });
  const registeredActions = actionEnv.calls.actionTypes[0].types[0].actions;
  ok("注册三项通知操作", registeredActions.length === 3);
  ok("通知 Snooze 固定为 2 小时", registeredActions.some(a => a.id === "snooze" && (a.title === "稍后 2 小时" || a.title === "2 小时后")));
  ok("创建三个通知渠道", actionEnv.calls.channels.length === 3);
  ok("渠道显式开启声音和震动", actionEnv.calls.channels.every(c => c.sound === "attention_reminder" && c.vibration));
  actionEnv.fireAction({ actionId: "ack", notification: { id: 123, extra: { itemId: "x" } } });
  ok("通知 ACK 映射事项", events[0].action === "ack" && events[0].itemId === "x");
  await new Promise(resolve => setTimeout(resolve, 0));
  ok("操作按钮移除已送达通知", actionEnv.calls.deliveredRemoved[0][0].id === 123);
  actionEnv.fireAction({ actionId: "snooze", notification: { extra: { itemId: "x" } } });
  actionEnv.fireAction({ actionId: "done", notification: { extra: { itemId: "x" } } });
  actionEnv.fireAction({ actionId: "tap", notification: { extra: { itemId: "x" } } });
  ok("Snooze、完成与普通点击动作保持独立", events[1].action === "snooze" && events[2].action === "done" && events[3].action === "tap");
  actionEnv.resume();
  ok("恢复前台触发对账", resumed === 1);

  await native._resetForTests();
  delete global.Capacitor;

  console.log("\n========== native reminder results ==========");
  console.log("通过: " + passed + "  失败: " + failed);
  if (failures.length) {
    failures.forEach(name => console.log("- " + name));
    process.exit(1);
  }
  console.log("全部通过。");
}

run().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
