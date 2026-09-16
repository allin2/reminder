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
  let pending = (options.pending || []).slice();
  let actionCallback = null;
  let resumeCallback = null;
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
  global.Capacitor = {
    getPlatform() { return "android"; },
    Plugins: { LocalNotifications: local, App: app }
  };
  return {
    calls,
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

  section("actions and resume");
  await native._resetForTests();
  const events = [];
  let resumed = 0;
  const actionEnv = createEnvironment();
  await native.initialize({ onAction: e => events.push(e), onResume: () => resumed++ });
  const registeredActions = actionEnv.calls.actionTypes[0].types[0].actions;
  ok("注册三项通知操作", registeredActions.length === 3);
  ok("通知 Snooze 固定为 2 小时", registeredActions.some(a => a.id === "snooze" && a.title === "2 小时后"));
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
