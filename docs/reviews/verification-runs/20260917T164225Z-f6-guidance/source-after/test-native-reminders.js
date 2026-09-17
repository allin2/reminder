/* Android native reminder projection tests (Node mocks) */
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const native = require(path.join(__dirname, "lib/native-reminders.js"));
const reminderLib = require(path.join(__dirname, "lib/reminder.js"));

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
    // Q1：真机契约 = **同步**返回 `{ remove }` 句柄（Android JSExport 注入 +
    // native-bridge 的 cap.addListener 直接 return 普通对象）。写成 async 会比真机宽松，
    // 掩盖只在实际设备上复现的契约类缺陷。
    addListener(name, callback) {
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
    // Q1：同 local.addListener —— 真机是同步返回句柄，不是 Promise
    addListener(name, callback) {
      if (name === "appStateChange") resumeCallback = callback;
      return { async remove() { resumeCallback = null; } };
    }
  };
  // SystemBridge：全屏闹钟通道（D9 / D25 / P0-2 / P1-4）
  //
  // Q2：真机的 `scheduleAlarm` **会回传 `triggerAt`**（SystemBridgePlugin 里
  // `r.put("triggerAt", triggerAt)`）。mock 只回 `{ok:true}` 会比真机宽松，
  // 「排下去 ≠ 排对了」这类契约漂移就永远测不出来。
  // `honorsDelayMs:false` 复刻 Q2 的真机行为：delayMs 被静默丢弃、固定落到 10 秒后。
  const honorsDelayMs = options.honorsDelayMs !== false;
  const bridge = {
    async scheduleAlarm(value) {
      alarmCalls.scheduleAlarm.push(value);
      const delay = honorsDelayMs ? (Number(value.delayMs) || 10000) : 10000;
      return {
        ok: true,
        id: value.id,
        mode: "alarmClock",
        triggerAt: Date.now() + delay
      };
    },
    async scheduleAt(value) {
      alarmCalls.scheduleAt.push(value);
      return {
        ok: true,
        id: value.id,
        mode: "alarmClock",
        triggerAt: honorsDelayMs ? Number(value.at) : Date.now() + 10000
      };
    },
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

  section("到点边界与通道故障隔离");
  {
    const env = createEnvironment();
    const soon = item("soon", "critical", now + 60000);
    const first = await native.reconcile([soon], { notify: true }, now);
    const second = await native.reconcile([soon], {
      notify: true, scheduledAlarmIds: first.scheduledAlarmIds
    }, now + 59500);
    ok("到点前 500ms 仍保留首次闹钟", second.alarmCount === 1);
    ok("到点前对账不撤销首次闹钟", env.alarms.cancelAlarm.length === 0);
    const normal = item("soon-normal", "normal", now + 500);
    ok("到点前 500ms 普通通知仍可排程",
      native.buildDesired([normal], { notify: true }, now).length === 1);
    await native.reconcile([], { notify: true, scheduledAlarmIds: second.scheduledAlarmIds }, now + 59600);
    ok("删除事项仍可撤销即将到期闹钟", env.alarms.cancelAlarm.length === 1);
  }
  {
    const env = createEnvironment();
    global.Capacitor.Plugins.LocalNotifications.schedule = async () => { throw new Error("notification failure"); };
    let result;
    try {
      result = await native.reconcile([item("independent", "critical", now + 60000)], { notify: true }, now);
    } catch (error) {}
    ok("普通通知排程失败不阻止首次闹钟", env.alarms.scheduleAlarm.length === 1);
    ok("通道失败返回闹钟台账", result && result.scheduledAlarmIds.length === 1);
    ok("通道失败明确报告错误", result && result.reliability === "error" &&
      result.errors.some(e => e.includes("notification failure")));
  }

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
  // V03：截止保护按阶段预排，p24 与 p2 各一条（此前只有 deadline-24h 一个点）
  ok("关键事项包含常规与 Deadline 排程",
    lifecycleInitial.length === 10 &&
    lifecycleInitial.filter(n => n.extra.event === "deadline").length === 2,
    String(lifecycleInitial.length));
  ok("V03 两个保护阶段各有独立身份",
    new Set(lifecycleInitial.filter(n => n.extra.event === "deadline").map(n => n.extra.stageKey)).size === 2);
  const acknowledged = native.buildDesired([
    Object.assign({}, lifecycle, { status: "acknowledged" })
  ], { notify: true }, now);
  ok("ACK 取消常规补充但保留独立 Deadline",
    acknowledged.length === 2 && acknowledged.every(n => n.extra.event === "deadline"),
    String(acknowledged.length));
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

  section("Q2 排程时刻回读校验");
  {
    // 真机曾出现（2026-09-17 模拟器实测）：`scheduleAlarm` 一路 resolve `{ok:true}`，
    // 但 `delayMs` 被平台静默丢弃 —— Capacitor 的 `PluginCall.getLong` 只认 `Long`，
    // 而 JSON 里的小整数被解析成 `Integer`，于是回退默认值 10 秒。
    // 结果：全屏闹钟永远排在「对账之后 10 秒」，关掉应用就再也等不到它。
    // 这条契约只能靠**回读原生落的时刻**兜住，光断言「调用成功」抓不到。
    const future = Date.now() + 5 * 60 * 1000;

    const healthy = createEnvironment();
    const sOk = await native.reconcile([item("q2-ok", "critical", future)], { notify: true }, Date.now(), null);
    ok("Q2 原生照单排程时不误报",
      sOk.errors.filter(e => e.indexOf("verify:") === 0).length === 0 && sOk.reliability !== "error",
      JSON.stringify(sOk.errors));
    ok("Q2 正常路径确实排下了全屏闹钟", healthy.alarms.scheduleAlarm.length === 1);

    const broken = createEnvironment({ honorsDelayMs: false });
    const sBad = await native.reconcile([item("q2-bad", "critical", future)], { notify: true }, Date.now(), null);
    const verifyErrors = sBad.errors.filter(e => e.indexOf("verify:") === 0);
    ok("Q2 原生忽略 delayMs 时必须报出回读偏差", verifyErrors.length === 1, JSON.stringify(sBad.errors));
    ok("Q2 偏差要带出可诊断的 drift 数值", /^verify:\d+:drift=-?\d+ms$/.test(verifyErrors[0] || ""), verifyErrors[0]);
    ok("Q2 契约漂移必须让 reliability 变成 error", sBad.reliability === "error", sBad.reliability);
    // 反面：参数被丢 ≠ 没排上。闹钟确实挂上了（只是时刻错），必须照常入账，否则事后撤销找不到它
    ok("Q2 漂移的闹钟仍要入账（否则事后撤不掉）",
      sBad.scheduledAlarmIds.length === 1 && broken.alarms.scheduleAlarm.length === 1);
    ok("Q2 漂移不影响 alarmScheduled 计数", sBad.alarmScheduled === 1);
  }

  // Q3：这一节是**源码级契约检查**（读文件、断言字符串），不是运行时行为测试。
  // 起因：Q3 缺陷的形态是「三个文件必须对同一件事达成一致」（权限声明 / 台账键名 /
  // 前端按钮接线），而这类不一致不会有任何运行时异常 —— 只会静默退化成「只弹通知」。
  section("Q3 全屏权限与投递台账契约");
  {
    const fs = require("fs");
    const readSrc = rel => fs.readFileSync(path.join(__dirname, rel), "utf8");
    const manifest = readSrc("android/app/src/main/AndroidManifest.xml");
    const receiver = readSrc("android/app/src/main/java/space/alliswell/inbox/AlarmTestReceiver.java");
    const activity = readSrc("android/app/src/main/java/space/alliswell/inbox/AlarmActivity.java");
    const plugin = readSrc("android/app/src/main/java/space/alliswell/inbox/SystemBridgePlugin.java");
    const appCoreSrc = readSrc("app-core.js");
    const html = readSrc("index.html");

    // 解锁亮屏弹全屏的唯一可行途径 = 后台启动 Activity 豁免（BAL）。
    // 第三方应用能主动申请的豁免只有 SYSTEM_ALERT_WINDOW 这一条。
    ok("Manifest 声明 SYSTEM_ALERT_WINDOW（解锁亮屏弹全屏的前提）",
      /android\.permission\.SYSTEM_ALERT_WINDOW/.test(manifest));
    ok("Manifest 仍声明 USE_FULL_SCREEN_INTENT（锁屏弹全屏的前提）",
      /android\.permission\.USE_FULL_SCREEN_INTENT/.test(manifest));

    // 「尝试投递」与「全屏真的起来了」必须由两侧分别写、共用同一套键名
    ok("台账键名由 receiver 定义、activity 与 plugin 复用同一常量",
      /KEY_DELIVERY_SHOWN_AT/.test(receiver) &&
      /AlarmTestReceiver\.KEY_DELIVERY_SHOWN_AT/.test(activity) &&
      /AlarmTestReceiver\.KEY_DELIVERY_SHOWN_AT/.test(plugin));
    ok("receiver 先落「尝试」台账再起全屏（顺序反了会覆盖 shownAt）",
      receiver.indexOf("recordAttempt(context, title") > -1 &&
      receiver.indexOf("recordAttempt(context, title") < receiver.indexOf("context.startActivity(activity)"));
    ok("activity 启动时记录「全屏真的起来了」",
      /KEY_DELIVERY_SHOWN_AT, System\.currentTimeMillis\(\)/.test(activity));
    ok("plugin 能回读投递结局 + 两项全屏权限",
      /public void lastAlarmDelivery/.test(plugin) &&
      /canDrawOverlays/.test(plugin) &&
      /canUseFullScreenIntent/.test(plugin));
    ok("plugin 暴露悬浮窗 / 全屏通知 / 自启动三个跳转",
      /ACTION_MANAGE_OVERLAY_PERMISSION/.test(plugin) &&
      /MANAGE_APP_USE_FULL_SCREEN_INTENT/.test(plugin) &&
      /public void openAutoStartSettings/.test(plugin));

    // 前端接线：按钮 id 必须同时存在于 HTML 与 app-core（漏一边就是死按钮）
    ["labOpenOverlay", "labOpenFsi", "labOpenAutoStart", "labFullScreen", "labDelivery"].forEach(id => {
      ok("自检面板 " + id + " 在 HTML 与 app-core 两侧都接线",
        html.indexOf('id="' + id + '"') > -1 && appCoreSrc.indexOf('"#' + id + '"') > -1);
    });
    ok("自检面板把投递结局翻成人话（缺这一段就只会说「还是弹通知」）",
      /lastAlarmDelivery/.test(appCoreSrc) && /describeAlarmDelivery/.test(appCoreSrc));

    // Q5：解锁时不得打断通话 —— 通话中只响铃、不抢屏；锁屏仍可抢屏（闹钟优先）
    ok("receiver 有通话闸门：只有「解锁 + 通话中」才不放行直起全屏",
      /KEY_DELIVERY_IN_CALL/.test(receiver) &&
      /boolean directPath = fullScreen && \(!inCall \|\| locked\)/.test(receiver));
    // V1 复测修正（推翻 V3 的「两路互斥」假设）：
    //   V3 曾让锁屏/息屏**完全不直起**、把投递全押在系统全屏意图上。
    //   vivo V2238A / OriginOS 16 实测三次：通知里 fullscreenIntent 存在、系统也已给出
    //   "+30s0ms NOTIFICATION_SERVICE" 的 BAL 豁免，AlarmActivity 却**始终没有 created**，
    //   其中两次连声音都没有（声音只在 AlarmActivity 里播放）——
    //   互斥设计在那类 ROM 上等于「不投递」，比竞态更糟。
    //   现在直起是主路径、全屏意图是系统级兜底，两者**并存**；
    //   重复拉起由 AlarmActivity 的同 token 幂等（duplicateIntent，不 replaced / 不重启声音）保证安全。
    ok("V1 直起与全屏意图并存：锁屏/息屏也直起界面（不再互斥）",
      /boolean backgroundDelivery = locked \|\| !screenOn/.test(receiver) &&
      /boolean fsiPath = fullScreen && backgroundDelivery/.test(receiver) &&
      /if \(directPath\) \{/.test(receiver) &&
      /context\.startActivity\(activity\)/.test(receiver) &&
      /if \(fsiPath\) \{[\s\S]{0,200}setFullScreenIntent/.test(receiver) &&
      !/if \(fullScreen\) builder\.setFullScreenIntent/.test(receiver) &&
      !/directAllowed/.test(receiver));
    ok("V1 只有通话让路才跳过直起，且投递路径标注 fsi+direct 双路",
      /directSkipped", "in-call yields, banner \+ sound only"/.test(receiver) &&
      /backgroundDelivery \? "fsi\+direct" : "direct"/.test(receiver) &&
      /alongside full-screen intent/.test(receiver));
    ok("V1 同一次投递被拉起两次时不打断声音（onNewIntent 按 token 幂等）",
      /oldToken\.equals\(newToken\)/.test(activity) &&
      /duplicateIntent", "same delivery; keep sound playing"/.test(activity) &&
      /trace\("replaced", "different delivery"\)/.test(activity));
    ok("receiver 用 AudioManager.getMode() 判通话（无需 READ_PHONE_STATE 权限）",
      /AudioManager\.MODE_IN_CALL/.test(receiver) &&
      /AudioManager\.MODE_IN_COMMUNICATION/.test(receiver) &&
      !/READ_PHONE_STATE/.test(manifest));
    ok("通话状态随台账落盘并回读",
      /KEY_DELIVERY_IN_CALL/.test(plugin) && /inCall/.test(appCoreSrc));
    ok("通话中被跳过时自检说「按设计」而不是报故障",
      /通话中 · 只响铃不抢屏/.test(appCoreSrc));

    // V1：界面「有没有真的显示出来」必须由窗口自己作证，而不是只看是否获得焦点
    ok("V1 原生按「窗口可见或获得焦点」判定显示，并落盘不可见时刻",
      /KEY_DELIVERY_VISIBLE/.test(receiver) &&
      /markVisible/.test(activity) &&
      /isShown\(\) && view\.getWindowVisibility\(\) == 0/.test(activity) &&
      /KEY_DELIVERY_HIDDEN_AT/.test(activity) &&
      /windowHidden/.test(activity));
    ok("V1 投递路径写进台账并回读（fsi+direct / direct / banner）",
      /KEY_DELIVERY_PATH/.test(receiver) &&
      /r\.put\("path"/.test(plugin) &&
      /r\.put\("visible"/.test(plugin));

    // V2：自检面板的归因必须靠证据，不能靠猜权限；排程落地也不等于「到点一定看得见」
    ok("V2 不再凭「锁屏」就断言缺「全屏通知」权限",
      !/if \(d\.locked\) reason = /.test(appCoreSrc) &&
      /缺「全屏通知」权限 · 锁屏\/息屏只能出横幅/.test(appCoreSrc));
    ok("V2 权限齐备却没弹出时如实说「系统没有展示」，不编原因",
      /权限齐备，但系统没有展示这次全屏/.test(appCoreSrc) &&
      /权限齐备，但界面没有被系统展示/.test(appCoreSrc));
    ok("V2 排程落地不再无条件承诺「关掉 App 后仍会按时响」",
      !/关掉 App 后仍会按时响/.test(appCoreSrc) &&
      /上一次到点没能把界面弹出来/.test(appCoreSrc));

    // F3：休眠态下进程被 vivo 的 fast_freezer 冻进 cgroup，而**广播投递不会解冻它**。
    // 真机取证（vivo V2238A / OriginOS 16，2026-09-17，events 缓冲）：
    //   22:35:30.956 am_app_frozen[from fast_freezer]
    //   22:35:31.809 device_idle_wake_from_idle[*walarm*:ACTION_TEST_ALARM] ← 系统侧分秒不差
    //   22:36:48.335 am_app_unfrozen[reason=resume top activity] ← 解冻者不是 broadcast
    //   22:36:48.664 deliveryAt ← 实际送达，晚 77 秒
    // 每一次解冻的原因只有两类：screen on / resume top activity。用户感知即
    // 「闹钟只有打开 App 才响」。
    //
    // 已实测排除的两条路（都写进了 AlarmRingService 的注释，别再重复踩）：
    //   ① 闹钟 PI 换成「拉起 AlarmActivity」→ 休眠态下 wm_create_activity 根本不出现
    //     （启动被系统直接丢弃），比广播更糟；只有亮屏解锁下正常。
    //   ② 加入电池优化白名单（cmd deviceidle whitelist +pkg）→ 6 秒后照样被冻结。
    //
    // F3b（2026-09-17 晚，两次独立实验后的修正）—— 首轮 F3 把解冻器排成 allow-while-idle，
    // 结果它自己在冻结态就被挂起了，从来没跑过：
    //   · 冻结期间 dumpsys alarm 给该 UID 全部闹钟打挂起标记（含 .AlarmRingService）：
    //       u0a190: #6: Reason=frozen ... tag=*walarm*:…/.AlarmRingService
    //   · 同一 dump 里，占「闹钟时钟」位的那条准点派发：
    //       last -2m31s595ms → 回推 23:00:08.338 = device_idle_wake_from_idle 同一毫秒
    //   · 对照实验（应用保持前台、不被冻结）：unfreezerStarted → received →
    //     deliveryAt=23:05:01.963（目标 23:05:01）、deliveryVisible=true
    //   ⇒ 机制本身没问题，冻结是唯一阻塞；**解冻器必须排在闹钟时钟位**，否则等于没排。
    const scheduler = readSrc("android/app/src/main/java/space/alliswell/inbox/AlarmScheduler.java");
    const ringService = readSrc("android/app/src/main/java/space/alliswell/inbox/AlarmRingService.java");
    ok("F3 投递载体仍是广播（冻结时被挂起、解冻后补投，不像界面启动那样被直接丢弃）",
      /PendingIntent\.getBroadcast\(context, id, delivery, flags\)/.test(scheduler) &&
      /PendingIntent\.getBroadcast\(getContext\(\), id, intent, flags\)/.test(plugin));
    ok("F3b 解冻器排在「闹钟时钟」位（allow-while-idle 会被 Reason=frozen 挂起）",
      /scheduleUnfreezer\(context, am, id, trace, delivery, triggerAt, flags, info\)/.test(scheduler) &&
      /AlarmScheduler\.scheduleUnfreezer\(getContext\(\), am, id, trace, intent, triggerAt, flags, clockInfo\)/.test(plugin) &&
      /PendingIntent\.getForegroundService\(context, id, service, flags\)/.test(scheduler) &&
      /am\.setAlarmClock\(info, unfreezePi\)/.test(scheduler));
    ok("F3b 拿不到闹钟时钟位时退回 allow-while-idle 并如实记 mode，不假装两条一样",
      /scheduleUnfreezer\(context, am, id, trace, delivery, triggerAt, flags, null\)/.test(scheduler) &&
      /mode = "allowWhileIdle"/.test(scheduler) &&
      /";mode=" \+ mode/.test(scheduler));
    ok("F3b 两处注释都保留 Reason=frozen 的取证（别再退回 allow-while-idle）",
      /Reason=frozen/.test(scheduler) && /Reason=frozen/.test(ringService));
    ok("F3 解冻器自己不投递任何东西（投递逻辑只有 Receiver 一条实现）",
      /class AlarmRingService extends Service/.test(ringService) &&
      /unfreezerStarted/.test(ringService) &&
      !/nm\.notify\(/.test(ringService));
    ok("F3 解冻器必须尽快 startForeground 并短暂留住进程",
      /startForeground\(FOREGROUND_ID, guardNotification\(\)\)/.test(ringService) &&
      /HOLD_MS/.test(ringService) &&
      /stopSelf\(\)/.test(ringService));
    ok("F3b 前台身份保留时长可由测试钩子指定（免冻验证需要长于 8 秒的窗口）",
      /static final String EXTRA_HOLD_MS/.test(ringService) &&
      /intent\.getLongExtra\(EXTRA_HOLD_MS, HOLD_MS\)/.test(ringService) &&
      /holdMs < 1000/.test(ringService));
    ok("F3 Manifest 声明 shortService 与配套权限（API 34 类型不匹配会抛异常）",
      /android:name="\.AlarmRingService"/.test(manifest) &&
      /android:foregroundServiceType="shortService"/.test(manifest) &&
      /FOREGROUND_SERVICE_SHORT_SERVICE/.test(manifest));
    ok("F3 取消时三种 PendingIntent 都撤（广播/前台服务/历史 Activity 直投）",
      /PendingIntent\.getBroadcast\(context, id, intent, flags\)/.test(scheduler) &&
      /PendingIntent\.getForegroundService\(context, id, service, flags\)/.test(scheduler) &&
      /PendingIntent\.getActivity\(context, id, ui, flags\)/.test(scheduler) &&
      /AlarmScheduler\.cancel\(getContext\(\), id\)/.test(plugin));

    // F2：声音的所有权交给系统 —— 界面被系统收掉时铃声必须还在。
    // 真机实测界面可能只活 367ms（created → resumed → 33ms → paused(finishing=true)），
    // 声音随 MediaPlayer 一起消失（audioStarted 后 186ms 就 effectsStopped），用户只听到半声。
    ok("F2 闹钟通知带 FLAG_INSISTENT（由系统循环播放，不随界面生死）",
      /notification\.flags \|= Notification\.FLAG_INSISTENT/.test(receiver) &&
      /import android\.app\.Notification;/.test(receiver));
    ok("F2 通知能发时界面不再自己播铃声（否则两路铃声重叠）",
      /private boolean notificationOwnsSound\(\)/.test(activity) &&
      /if \(!notificationOwnsSound\(\)\) startAlarmSound\(\)/.test(activity) &&
      /areNotificationsEnabled\(\)/.test(activity));
    ok("F2 INSISTENT 循环的就是渠道音（渠道没声音则 INSISTENT 无效）",
      /channel\.setSound\(alarmSound\(context\)/.test(receiver));

    // R-1：以下是放行前的历史失败；2026-09-18 已验证三个独立设置后恢复。
    //   ① 进程活着 → 被 fast_freezer 冻进 cgroup，冻结态下广播/前台服务/Activity 全进不来；
    //   ② 进程被杀掉 → 系统连重新拉起都不做（device_idle_wake_from_idle 照常，但无 am_proc_start）。
    // 而厂商白名单**没有可读状态位**，只能引导用户手动放行 —— 所以这个入口必须存在、且能兜底。
    ok("R-1 提供打开「后台运行」设置页的入口，且用**标准 Action**而非厂商显式组件",
      /public void openBackgroundSettings\(PluginCall call\)/.test(plugin) &&
      /Settings\.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS/.test(plugin) &&
      !/VENDOR_BACKGROUND_SETTINGS/.test(plugin));
    ok("R-1 打不开时兜底到本应用详情页，并把实际打开的页面回传",
      /Settings\.ACTION_APPLICATION_DETAILS_SETTINGS/.test(plugin) &&
      /opened = "appDetails"/.test(plugin) &&
      /r\.put\("opened", opened\)/.test(plugin));
    ok("R-1 注释记录「resolveActivity 通过 ≠ 能启动」的实测，防止后人改回显式组件",
      /exported=false/.test(plugin) && /不代表能启动/.test(plugin) &&
      /com\.iqoo\.powersaving\/\.BackgroundHighUsageActivity/.test(plugin));
    ok("R-1 注释保留「冻/杀两条都走不通」的取证，避免后人以为能自行绕过",
      /fast_freezer/.test(plugin) && /am_proc_start/.test(plugin) && /没有可读状态位/.test(plugin));
  }

  section("F6 后台设置引导运行时行为");
  {
    const fs = require("fs");
    const vm = require("vm");
    const source = fs.readFileSync(path.join(__dirname, "app-core.js"), "utf8");
    const start = source.indexOf("  async function openBackgroundGuide(kind)");
    const end = source.indexOf("  async function openSystemSetting(kind)", start);
    const nodes = new Map();
    const $ = id => {
      if (!nodes.has(id)) nodes.set(id, { disabled: false, textContent: "" });
      return nodes.get(id);
    };
    let bridge = null, fallback = null, calls = 0, release;
    const guide = vm.runInNewContext("(" + source.slice(start, end).trim() + ")", {
      $, systemBridge: () => bridge, appSettingsPlugin: () => fallback,
      labLog() {}, toast() {}
    });
    const feedback = () => $("#labSettingsFeedback").textContent;
    bridge = { openBackgroundSettings: () => { calls++; return new Promise(resolve => { release = resolve; }); } };
    const pending = guide("background");
    ok("F6 打开设置期间禁用两个入口并给即时反馈",
      $("#labOpenBackground").disabled && $("#labOpenAutoStart").disabled && /正在打开/.test(feedback()));
    await guide("background");
    ok("F6 连点不重复启动设置", calls === 1);
    release({ ok: true, opened: "batteryOptimization" });
    await pending;
    ok("F6 成功只表示已请求跳转，不冒充开关已开启", /已请求/.test(feedback()) && /不代表开关已开启/.test(feedback()));
    ok("F6 请求完成恢复入口", !$("#labOpenBackground").disabled && !$("#labOpenAutoStart").disabled);
    bridge = { openBackgroundSettings: async () => ({ ok: true, opened: "appDetails" }) };
    await guide("background");
    ok("F6 原生回退应用详情时给正确的手动路径", /应用信息/.test(feedback()) && /手动确认/.test(feedback()));
    bridge = { openBackgroundSettings: async () => { throw new Error("denied"); } };
    await guide("background");
    ok("F6 跳转异常显示失败及手动恢复路径", /未能打开/.test(feedback()) && /手机设置/.test(feedback()) && !$("#labOpenBackground").disabled);
    bridge = null;
    await guide("permissions");
    ok("F6 桥缺失不伪报成功", /未能打开/.test(feedback()));
    let details = 0;
    bridge = { openAppDetailsSettings: async () => { details++; } };
    await guide("permissions");
    ok("F6 权限入口直达应用信息并说明两个独立开关", details === 1 && /查看所有权限/.test(feedback()) && /自启动/.test(feedback()) && /锁屏显示/.test(feedback()));
    bridge = null;
    fallback = { openAppDetailsSettings: async () => { details++; } };
    await guide("background");
    ok("F6 旧桥可退应用详情且仍需手动确认", details === 2 && /后台耗电/.test(feedback()) && /手动确认/.test(feedback()));
  }

  // Q6：原生链路「静默失败」的可观测性。
  // 这一节全是源码级断言 —— 因为这类缺陷的共同点是**运行期完全看不见**：
  // 不抛错、不崩溃、界面照常可点，只在「关掉 App 后到底响不响」上体现出来。
  section("Q6 原生链路静默失败与可观测性");
  {
    const fs = require("fs");
    const readSrc = rel => fs.readFileSync(path.join(__dirname, rel), "utf8");
    const appCoreSrc = readSrc("app-core.js");
    const html = readSrc("index.html");
    // Q6-a：被调用的守卫函数必须真的有定义。
    // 现场缺陷：isNativeAndroidRuntime 被 3 处调用却从未定义，
    // 点「精确闹钟 / 通知设置 / 电池优化」三个入口直接 ReferenceError，
    // 用户侧只表现为「点了没反应」—— 此前没有任何测试覆盖。
    ok("isNativeAndroidRuntime 有定义（此前被 3 处调用却从未定义）",
      /function isNativeAndroidRuntime\s*\(/.test(appCoreSrc));
    ok("waitForNativeBridge 有定义",
      /function waitForNativeBridge\s*\(/.test(appCoreSrc));
    ok("renderBackgroundVerdict 有定义",
      /async function renderBackgroundVerdict\s*\(/.test(appCoreSrc));

    // Q6-b：init 不得再 await 原生初始化 —— 它会把 seed / render / 15 秒心跳一起拖住
    ok("init 不再阻塞等待原生初始化（V1 同类：静默中断启动链）",
      !/await initializeNativeReminders\(\);/.test(appCoreSrc) &&
      /ensureNativeReminders\(\);/.test(appCoreSrc));

    // Q6-c：桥未就绪时不得静默 return，必须留下可见记录
    ok("桥未就绪时改为等待 + 留下可见失败记录（不再静默 return）",
      /const bridged = await waitForNativeBridge\(10000\)/.test(appCoreSrc) &&
      /bridgeNotReady: true/.test(appCoreSrc));

    // Q6-d：安卓绝不走 Web 通知分支。
    // WebView 的 Notification.requestPermission() 会返回 granted，
    // 于是开关显示「已开启」而系统权限根本没授予 → reconcile 的 enabled 仍为 false → 零排程。
    ok("安卓运行时不走 Web 通知分支（否则造出「开关开着却没权限」的假象）",
      /else if \(isNativeAndroidRuntime\(\)\) \{/.test(appCoreSrc));

    // Q6-e：界面必须能回答「关掉 App 后会不会响」
    ['labVerdict', 'labBackground', 'labScheduled', 'labResync'].forEach(id => {
      ok("自检面板 " + id + " 在 HTML 与 app-core 两侧都接线",
        html.indexOf('id="' + id + '"') > -1 && appCoreSrc.indexOf('"#' + id + '"') > -1);
    });
    ok("结论区分「总开关未开」与「权限未授予」（此前共用一句「通知未授权」把人带偏）",
      /总开关未开/.test(appCoreSrc) && /系统通知权限未授予/.test(appCoreSrc));
    ok("能区分「原生对账从未执行」这种静默失败",
      /s\.enabled === undefined/.test(appCoreSrc) && /原生对账从未执行/.test(appCoreSrc));
    ok("结论用 getPending 的实数，而不是只报「打算排几条」",
      /getPending/.test(appCoreSrc) && /pending === 0 && desired > 0/.test(appCoreSrc));

    // Q6-f：通用检查 —— 所有「当成守卫函数调用」的标识符必须真的有定义。
    // 本次真凶 isNativeAndroidRuntime 正是这一类：被 if (!x()) 调用、却从未定义，
    // 只有点到那个按钮才暴露，且表现只是「没反应」。手工断言只能抓已发现的那一个，
    // 这个扫描抓的是**同一类里的下一个**。
    // 注意：必须先剥掉注释，否则注释里举的例子会被当成真调用（第一版就是这么误报的）。
    const codeOnly = appCoreSrc
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/[^\n]*$/gm, " ");
    const definedNames = new Set();
    const defRe = /(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/g;
    let dm;
    while ((dm = defRe.exec(codeOnly))) definedNames.add(dm[1] || dm[2]);
    // 白名单 = IIFE 之外的东西：浏览器内建 + 兄弟模块挂在 window 上的全局
    const externalNames = new Set([
      "window", "document", "console", "Date", "Math", "JSON", "Object", "Array", "String",
      "Number", "Boolean", "Promise", "Set", "Map", "WeakMap", "RegExp", "Error", "Symbol",
      "setTimeout", "clearTimeout", "setInterval", "clearInterval", "parseInt", "parseFloat",
      "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent", "requestAnimationFrame",
      "fetch", "URL", "URLSearchParams", "navigator", "location", "history", "localStorage",
      "indexedDB", "Blob", "FileReader", "AbortController", "globalThis", "queueMicrotask",
      "Lib", "NativeReminders", "AttentionLib", "alert", "confirm", "prompt"
    ]);
    const guardNames = new Set();
    const guardRe = /if\s*\(\s*!?\s*([A-Za-z_$][\w$]*)\s*\(/g;
    let gm;
    while ((gm = guardRe.exec(codeOnly))) guardNames.add(gm[1]);
    const missingGuards = [...guardNames]
      .filter(n => !definedNames.has(n) && !externalNames.has(n))
      .sort();
    ok("没有「当守卫调用却没定义」的函数（本次缺陷类别）：" +
      (missingGuards.length ? missingGuards.join(", ") : "无"),
      missingGuards.length === 0);

    // Q6-g：桥晚到时**不得丢弃**同步请求 —— 这是「关掉 App 就不响」的根治点。
    // 旧实现开头 `if (!nativeReady) return`：整场会话的每一次对账都被丢掉，
    // 而 nativeReady 再没有任何机会变 true（因为初始化也在同一个时间差上放弃了）。
    ok("queueNativeReminderSync 在桥未就绪时补做初始化，而不是丢弃请求",
      /if \(!nativeReady\) \{[\s\S]{0,240}?ensureNativeReminders\(\)\.then/.test(codeOnly));
    ok("原生初始化幂等且可重试（in-flight promise 跑完置回 null）",
      /function ensureNativeReminders\s*\(/.test(codeOnly) &&
      /if \(nativeInitPromise\) return nativeInitPromise;/.test(codeOnly) &&
      /nativeInitPromise = null;/.test(codeOnly));
    ok("init 改走 ensureNativeReminders（不阻塞、可重试）",
      /ensureNativeReminders\(\);/.test(codeOnly) &&
      !/const nativeInit = initializeNativeReminders\(\);/.test(codeOnly));
    ok("非安卓容器直接返回，不误报「桥未就绪」（保护 Web 版）",
      /async function initializeNativeReminders\(\) \{[\s\S]{0,240}?if \(!isNativeAndroidRuntime\(\)\) return;/
        .test(codeOnly));
    ok("切回前台会补做原生初始化",
      /if \(!nativeReady\) queueNativeReminderSync\(\);/.test(codeOnly));
  }

  section("review projection (P0-1 / P1-6 / D18 / D22)");
  {
    const rs = { enabled: true, hour: 21, minute: 30, followupMs: 60 * 60 * 1000, maxFollowups: 2 };
    const rd = native.buildReviewDesired(4, rs, now, { notify: true });
    ok("D22 待整理当天共 3 次", rd.length === 3, String(rd.length));
    ok("D22 补提醒间隔 60 分钟", rd[1].schedule.at.getTime() - rd[0].schedule.at.getTime() === 60 * 60 * 1000);
    ok("D22 窗口起点 21:30", rd[0].schedule.at.getHours() === 21 && rd[0].schedule.at.getMinutes() === 30);
    ok("P1-6 待整理走普通渠道", rd.every(n => n.channelId === native.CHANNELS.normal));
    // L06：待整理必须使用自己的动作集，不能复用事项的「我知道了 / 稍后 2 小时 / 完成」
    ok("L06 待整理使用独立动作类型",
      rd.every(n => n.actionTypeId === native.REVIEW_ACTION_TYPE_ID) &&
      native.REVIEW_ACTION_TYPE_ID !== native.ACTION_TYPE_ID);
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

  section("regressions: review / window / dnd / deadline / ledger");
  {
    // L01 / R5 / D17：只有「系统兜底时间」的待整理不发事项提醒
    const onSettings = { notify: true, review: { enabled: true } };
    const fallback = item("nr-fb", "normal", now + 3600000, {
      review_status: "NEEDS_REVIEW", isFallbackTrigger: true
    });
    const realTime = item("nr-real", "normal", now + 3600000, {
      review_status: "NEEDS_REVIEW", isFallbackTrigger: false
    });
    const dOn = native.buildDesired([fallback, realTime], onSettings, now);
    ok("L01 兜底待整理不发事项提醒", !dOn.some(n => n.extra.itemId === "nr-fb"));
    ok("L01 有真实时间的待整理照常提醒", dOn.some(n => n.extra.itemId === "nr-real"));
    const dOff = native.buildDesired([fallback], { notify: true, review: { enabled: false } }, now);
    ok("R5 关闭整理后待整理按普通事项排程", dOff.some(n => n.extra.itemId === "nr-fb"));
    const nrDeadline = item("nr-dl", "normal", now + 3600000, {
      review_status: "NEEDS_REVIEW", isFallbackTrigger: true, deadlineAt: now + 3 * 86400000
    });
    ok("L01 待整理不阻断截止保护（INV-05）",
      native.buildDesired([nrDeadline], onSettings, now)
        .some(n => n.extra.itemId === "nr-dl" && n.extra.event === "deadline"));

    // R4：窗口起点刚过，当晚剩余槽位不得被整体挪到明天
    const rs = {
      enabled: true, hour: 21, minute: 30, windowEndHour: 23, windowEndMinute: 0,
      followupMs: 60 * 60 * 1000, maxFollowups: 2
    };
    const t2125 = new Date(2026, 8, 16, 21, 25, 0).getTime();
    const t2135 = new Date(2026, 8, 16, 21, 35, 0).getTime();
    const at2125 = native.buildReviewDesired(2, rs, t2125, { notify: true });
    const at2135 = native.buildReviewDesired(2, rs, t2135, { notify: true });
    const tsOf = list => list.map(n => n.schedule.at.getTime());
    ok("R4 21:25 排出当晚三档", at2125.length === 3, String(at2125.length));
    ok("R4 21:35 仍保留当晚末两档",
      tsOf(at2135).join(",") === [
        new Date(2026, 8, 16, 22, 30, 0).getTime(),
        new Date(2026, 8, 16, 23, 30, 0).getTime()
      ].join(","),
      at2135.map(n => n.schedule.at.toLocaleString()).join(" | "));
    const keyOf = (list, ts) => (list.find(n => n.schedule.at.getTime() === ts) || {}).extra.scheduleKey;
    ok("R4 槽位身份稳定（不随前面槽位过去而改变）",
      !!keyOf(at2135, new Date(2026, 8, 16, 22, 30, 0).getTime()) &&
      keyOf(at2135, new Date(2026, 8, 16, 22, 30, 0).getTime()) ===
      keyOf(at2125, new Date(2026, 8, 16, 22, 30, 0).getTime()));

    // L07 / D18：补提醒不得穿透勿扰；越窗的档位滚入下一个窗口
    const withDnd = native.buildReviewDesired(2, rs, now, { dnd: true, quietStart: "23:00", quietEnd: "07:30" });
    ok("L07 补提醒不穿透勿扰",
      withDnd.every(n => n.schedule.at.getHours() < 23 && n.schedule.at.getHours() >= 7),
      withDnd.map(n => n.schedule.at.toLocaleString()).join(" | "));
    ok("L07 次数是上限而非必须发满", withDnd.length === 2, String(withDnd.length));

    // R6 / L02：截止保护的排程身份必须稳定，且已消费的阶段不再排
    const dlItem = item("dl", "normal", now + 30 * 86400000, { deadlineAt: now + 12 * 3600000 });
    const d1 = native.buildDesired([dlItem], { notify: true }, now).find(n => n.extra.event === "deadline");
    const d2 = native.buildDesired([dlItem], { notify: true }, now + 20000).find(n => n.extra.event === "deadline");
    ok("R6 进入保护窗口后排一条立即提醒", !!d1 && d1.schedule.at.getTime() - now <= 5000);
    ok("R6 反复对账身份稳定（不再生成新提醒）",
      !!d2 && d1.id === d2.id && d1.extra.scheduleKey === d2.extra.scheduleKey);
    const stageKey = reminderLib.deadlineStageKey(dlItem.deadlineAt, now);
    ok("R6 投影与 lib/reminder.js 使用同一阶段身份",
      !!stageKey && native.deadlineStageKey(dlItem.deadlineAt, now) === stageKey);
    const consumedItem = Object.assign({}, dlItem, { deadlineStageKey: stageKey });
    const consumedDesired = native.buildDesired([consumedItem], { notify: true }, now);
    ok("R6 已消费的阶段不再重复提醒",
      !consumedDesired.some(n => n.extra.stageKey === stageKey),
      consumedDesired.map(n => n.extra.stageKey).join("|"));
    ok("V03 消费 p24 后仍预排 p2",
      consumedDesired.some(n => n.extra.stageKey === "p2@" + dlItem.deadlineAt),
      consumedDesired.map(n => n.extra.stageKey).join("|"));
    // V03 / F1 / G3：已排期但投递时刻已过 → 保持待定（不重复排、也不补发）。
    // 「时刻已过」不是送达证据，所以这里不再假设上层会把它落库为 delivered。
    const scheduledAt = d1.schedule.at.getTime();
    const notified = Object.assign({}, dlItem, {
      deadlineEvents: (function () {
        const t = {};
        t[stageKey] = { at: scheduledAt, state: "scheduled" };
        return t;
      })()
    });
    ok("V03 已排期但未到投递时刻时身份与时刻保持原样",
      native.buildDesired([notified], { notify: true }, now)
        .some(n => n.extra.stageKey === stageKey && n.schedule.at.getTime() === scheduledAt));
    const delivered = Object.assign({}, dlItem, {
      deadlineEvents: (function () {
        const t = {};
        t[stageKey] = { at: scheduledAt, state: "delivered" };
        return t;
      })()
    });
    ok("F1 标记为已送达后不再重排",
      !native.buildDesired([delivered], { notify: true }, now + 15000)
        .some(n => n.extra.stageKey === stageKey),
      JSON.stringify(native.buildDesired([delivered], { notify: true }, now + 15000)
        .map(n => n.extra.stageKey)));
    // F1：两个阶段必须**同时**存在，不能互相覆盖（此前只有一组字段轮流写）
    ok("F1 两个阶段的记录互不覆盖",
      native.deadlineEventOf({ deadlineEvents: { a: { at: 1, state: "scheduled" }, b: { at: 2, state: "delivered" } } }, "a").state === "scheduled" &&
      native.deadlineEventOf({ deadlineEvents: { a: { at: 1, state: "scheduled" }, b: { at: 2, state: "delivered" } } }, "b").state === "delivered");
    const pausedItem = Object.assign({}, dlItem, { deadlinePaused: true });
    ok("D23 暂停截止保护后不排任何截止提醒",
      !native.buildDesired([pausedItem], { notify: true }, now).some(n => n.extra.event === "deadline"));

    // V06：整理确认后（REVIEWED）但兜底标记仍在的记录，原生不得排出正式提醒
    const confirmedFallback = item("cf", "normal", now + 3600000, {
      review_status: "REVIEWED", isFallbackTrigger: true
    });
    ok("V06 确认后的兜底记录原生仍不排正式提醒",
      !native.buildDesired([confirmedFallback], onSettings, now).some(n => n.extra.itemId === "cf"));
    const confirmedReal = item("cr2", "normal", now + 3600000, {
      review_status: "REVIEWED", isFallbackTrigger: false
    });
    ok("V06 确认且有真实时间的事项照常提醒",
      native.buildDesired([confirmedReal], onSettings, now).some(n => n.extra.itemId === "cr2"));

    // V07：「今天跳过」必须清空当晚排程
    const skippedRs = Object.assign({}, rs, { skippedUntil: new Date(2026, 8, 17, 21, 30, 0).getTime() });
    ok("V07 今天跳过 → 当晚不排任何待整理提醒",
      native.buildReviewDesired(2, skippedRs, new Date(2026, 8, 16, 21, 35, 0).getTime(), { notify: true }).length === 0,
      String(native.buildReviewDesired(2, skippedRs, new Date(2026, 8, 16, 21, 35, 0).getTime(), { notify: true }).length));

    // L08：稍后开启新一轮 → 原生从 attempt=0 重新排满
    const roundItem = Object.assign({}, item("round", "critical", now + 2 * 3600000),
      { status: "snoozed", remindCount: 8 });
    const roundDesired = native.buildDesired([roundItem], { notify: true }, now);
    ok("L08 稍后开启新一轮：原生从 attempt=0 重排",
      roundDesired.length === 8 && roundDesired[0].extra.attempt === 0 && roundDesired[0].extra.event === "primary",
      String(roundDesired.length));

    // R7：撤销失败必须保留台账，成功重试后才移除
    await native._resetForTests();
    const env = createEnvironment();
    const bridgeMock = global.Capacitor.Plugins.SystemBridge;
    const realCancel = bridgeMock.cancelAlarm;
    bridgeMock.cancelAlarm = async () => { throw new Error("cancel failed"); };
    const ghost = item("ghost", "critical", now + 3600000);
    const scheduled = await native.reconcile([ghost], { notify: true }, now, null);
    const failed = await native.reconcile([], { notify: true, scheduledAlarmIds: scheduled.scheduledAlarmIds }, now, null);
    ok("R7 撤销失败时保留台账 id",
      failed.alarmCancelled === 0 && failed.scheduledAlarmIds.length === 1,
      JSON.stringify(failed.scheduledAlarmIds));
    ok("R7 状态带出失败原因", (failed.errors || []).some(e => /^cancel:/.test(e)), JSON.stringify(failed.errors));
    bridgeMock.cancelAlarm = realCancel;
    const retried = await native.reconcile([], { notify: true, scheduledAlarmIds: failed.scheduledAlarmIds }, now, null);
    ok("R7 重试成功后才移除台账",
      retried.alarmCancelled === 1 && retried.scheduledAlarmIds.length === 0,
      JSON.stringify(retried.scheduledAlarmIds));

    // V03：对账必须把「已排的截止事件」回给上层落库，作为原生送达消费的依据
    await native._resetForTests();
    createEnvironment();
    const dlRec = item("dl-rec", "normal", now + 30 * 86400000, { deadlineAt: now + 12 * 3600000 });
    const dlStatus = await native.reconcile([dlRec], { notify: true }, now, null);
    ok("V03 对账回传已排的截止事件",
      (dlStatus.deadlineEvents || []).length === 2 &&
      (dlStatus.deadlineEvents || []).every(e => e.itemId === "dl-rec" && !!e.stageKey && e.at > now),
      JSON.stringify(dlStatus.deadlineEvents));

    // V08 / F4：排程或撤销失败必须改变用户可见状态，即使 notify 关闭也不能显示"精确就绪"或"应用内"
    await native._resetForTests();
    createEnvironment();
    const bridgeMock2 = global.Capacitor.Plugins.SystemBridge;
    const realSchedule = bridgeMock2.scheduleAlarm;
    bridgeMock2.scheduleAlarm = async () => { throw new Error("schedule failed"); };
    const alarmOnly = item("alarm-fail", "critical", now + 3600000);
    const failStatus = await native.reconcile([alarmOnly], { notify: true }, now, null);
    ok("V08 排程失败 → reliability=error",
      failStatus.reliability === "error" && (failStatus.errors || []).some(e => /^schedule:/.test(e)),
      failStatus.reliability + " " + JSON.stringify(failStatus.errors));
    bridgeMock2.scheduleAlarm = realSchedule;

    const origCancel = bridgeMock2.cancelAlarm;
    bridgeMock2.cancelAlarm = async () => { throw new Error("cancel failed"); };
    // 开启通知时撤销失败
    const cancelFailStatus = await native.reconcile([], { notify: true, scheduledAlarmIds: [999] }, now, null);
    ok("F4 开启通知时撤销失败 → reliability=error",
      cancelFailStatus.reliability === "error" && (cancelFailStatus.errors || []).some(e => /^cancel:/.test(e)),
      cancelFailStatus.reliability + " " + JSON.stringify(cancelFailStatus.errors));
    // 关闭通知时撤销失败（enabled=false，此前会被覆盖成 in-app）
    const cancelFailDisabledStatus = await native.reconcile([], { notify: false, scheduledAlarmIds: [999] }, now, null);
    ok("F4 关闭通知时撤销失败 → reliability=error（旧闹钟残留不可隐藏）",
      cancelFailDisabledStatus.reliability === "error" && (cancelFailDisabledStatus.errors || []).some(e => /^cancel:/.test(e)),
      cancelFailDisabledStatus.reliability + " " + JSON.stringify(cancelFailDisabledStatus.errors));
    bridgeMock2.cancelAlarm = origCancel;
    void env;
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
  // L06 / V0.2 §9.3：待整理动作必须与标签语义一致
  const reviewType = actionEnv.calls.actionTypes[0].types[1];
  const reviewActions = reviewType ? reviewType.actions : [];
  ok("L06 单独注册待整理动作集",
    !!reviewType && reviewType.id === native.REVIEW_ACTION_TYPE_ID && reviewActions.length === 3,
    JSON.stringify(reviewActions));
  ok("L06 待整理动作为 开始整理 / 稍后 30 分钟 / 今天跳过",
    reviewActions.some(a => a.id === "review_start" && a.title === "开始整理") &&
    reviewActions.some(a => a.id === "review_snooze" && a.title === "稍后 30 分钟") &&
    reviewActions.some(a => a.id === "review_skip" && a.title === "今天跳过"),
    JSON.stringify(reviewActions.map(a => a.title)));
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

  // U1：通知栏动作与业务提交使用同一个 Promise 边界；失败不能先移除系统通知。
  await native._resetForTests();
  let rejectAction;
  const failedAction = new Promise((_resolve, reject) => { rejectAction = reject; });
  const guardedEnv = createEnvironment();
  await native.initialize({ onAction: () => failedAction });
  guardedEnv.fireAction({ actionId: "ack", notification: { id: 202, extra: { itemId: "guarded" } } });
  await new Promise(resolve => setTimeout(resolve, 0));
  ok("U1 通知动作提交未完成前不得移除已送达通知", guardedEnv.calls.deliveredRemoved.length === 0);
  rejectAction(new Error("authoritative commit failed"));
  await new Promise(resolve => setTimeout(resolve, 0));
  ok("U1 通知动作提交失败后仍保留已送达通知供重试", guardedEnv.calls.deliveredRemoved.length === 0);

  // F2：排空动作队列 —— handler 抛错时不调用 ackAlarmAction，成功才确认
  const bridge = global.Capacitor.Plugins.SystemBridge;
  let queueItem = { id: 101, action: "ack", itemId: "item-f2", itemRev: 1 };
  let ackCalled = [];
  bridge.consumeAlarmAction = async () => {
    const item = queueItem;
    queueItem = null;
    return item;
  };
  bridge.ackAlarmAction = async (payload) => { ackCalled.push(payload.id); };
  // 1) 模拟存储失败 / 处理失败
  await native.drainAlarmActions(async () => { throw new Error("database disk full"); });
  ok("F2 处理抛错时不确认删除原生事件", ackCalled.length === 0);
  // 2) 重新放回并成功处理
  queueItem = { id: 101, action: "ack", itemId: "item-f2", itemRev: 1 };
  await native.drainAlarmActions(async () => { /* 成功落库 */ });
  ok("F2 处理成功后才调用 ackAlarmAction 确认删除", ackCalled.length === 1 && ackCalled[0] === 101);

  // Q1：`onAlarmAction` 的注册契约。
  //
  // 真机（Android）上插件方法由原生 `JSExport.getPluginJS()` 注入：
  //     t.addListener = (eventName, callback) => w.Capacitor.addListener(id, eventName, callback)
  // 而 `native-bridge.js` 的 `cap.addListener` **同步 return 一个 `{ remove }` 普通对象**，
  // 没有 `.then` / `.catch`。旧写法 `app.addListener(...).catch(...)` 因此抛
  // `TypeError: app.addListener(...).catch is not a function` —— 而 `onAlarmAction()` 是
  // 同步函数，异常会直接冒泡出 app-core 的 `init()`，让 seed / render / 15 秒心跳全部不执行。
  //
  // 此前**没有任何测试调用过 `onAlarmAction`**，这段注册代码在测试里是死代码 ——
  // 这是 854 项全绿却漏掉该缺陷的决定性原因。下面把这条路径真正跑起来。
  {
    await native._resetForTests();
    const env = createEnvironment();
    const bridge = global.Capacitor.Plugins.SystemBridge;
    const appMock = global.Capacitor.Plugins.App;

    const bridgeListeners = [];
    const appListeners = [];
    // 真机契约：同步返回句柄
    bridge.addListener = (name, callback) => {
      bridgeListeners.push(name);
      return { async remove() { callback = null; } };
    };
    const appOriginalAdd = appMock.addListener;
    appMock.addListener = function (name, callback) {
      appListeners.push(name);
      return appOriginalAdd.call(this, name, callback);
    };
    let consumed = 0;
    bridge.consumeAlarmAction = async () => { consumed++; return null; };

    await native.initialize({});

    let threw = null;
    try {
      native.onAlarmAction(() => {});
    } catch (error) { threw = error; }
    ok("Q1 真机契约（同步句柄）下 onAlarmAction 不得抛错",
      threw === null, threw && threw.message);
    ok("Q1 两个监听都注册上了：SystemBridge.alarmAction + App.appStateChange",
      bridgeListeners.indexOf("alarmAction") >= 0 && appListeners.indexOf("appStateChange") >= 0,
      "bridge=" + JSON.stringify(bridgeListeners) + " app=" + JSON.stringify(appListeners));

    // 该监听的作用：恢复前台时轮询排空闹钟动作
    const before = consumed;
    env.resume();
    await new Promise(resolve => setTimeout(resolve, 20));
    ok("Q1 恢复前台会触发一次闹钟动作排空（监听真的生效，不是空注册）",
      consumed > before, "before=" + before + " after=" + consumed);

    // 反例一：平台返回 Promise（官方 capacitor.js 契约）—— 归一化后同样不得抛错
    await native._resetForTests();
    createEnvironment();
    const bridge2 = global.Capacitor.Plugins.SystemBridge;
    bridge2.consumeAlarmAction = async () => null;
    bridge2.addListener = () => {
      const p = Promise.resolve({ remove: async () => {} });
      p.remove = async () => {};
      return p;
    };
    global.Capacitor.Plugins.App.addListener = () => {
      const p = Promise.resolve({ remove: async () => {} });
      p.remove = async () => {};
      return p;
    };
    let threw2 = null;
    try { native.onAlarmAction(() => {}); } catch (error) { threw2 = error; }
    ok("Q1 Promise 契约下 onAlarmAction 同样不得抛错", threw2 === null, threw2 && threw2.message);

    // 反例二：平台 addListener 同步抛错 —— 必须被隔离，不能冒泡出去中断启动链
    await native._resetForTests();
    createEnvironment();
    const bridge3 = global.Capacitor.Plugins.SystemBridge;
    bridge3.consumeAlarmAction = async () => null;
    bridge3.addListener = () => { throw new Error("plugin not registered"); };
    global.Capacitor.Plugins.App.addListener = () => { throw new Error("plugin not registered"); };
    let threw3 = null;
    try { native.onAlarmAction(() => {}); } catch (error) { threw3 = error; }
    ok("Q1 平台注册同步抛错时必须被隔离（否则会拖垮整个 init）",
      threw3 === null, threw3 && threw3.message);
  }

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
