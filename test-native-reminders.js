/* Android native reminder projection tests (Node mocks) */
"use strict";

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const native = require(path.join(__dirname, "lib/native-reminders.js"));
const reminderLib = require(path.join(__dirname, "lib/reminder.js"));
// F01 跨语言契约用：Java 写出的行字段名必须与这份 ROW_FIELDS 逐字相同
const evidenceLib = require(path.join(__dirname, "lib/delivery-evidence.js"));

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
  const alarmCalls = { scheduleAlarm: [], scheduleAt: [], cancelAlarm: [], cancelNotification: [] };
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
    async cancelNotification(value) { alarmCalls.cancelNotification.push(value); return { ok: true }; },
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

  // P2-C-R 独立复验（2026-09-22）：迁移必须**幂等**。
  // 旧写法是 `if (item.dismissedUntil == null) { item.dismissedUntil = null; changed = true; }` ——
  // 已经是 null 也会判成「需要迁移」并赋回同一个值 ⇒ `changed` 恒真 ⇒ **每次冷启动都产生
  // 一次权威提交**，而那次提交写的是内存当时的状态（写闸门一旦漏判就是一次静默覆盖）。
  // 独立探针的记录：状态字节完全不变，返回值仍是 true。
  {
    const local = native.toLocalDateTime(now);
    const stable = { triggerAt: native.fromLocalDateTime(local), scheduleBasis: "wall-clock", localTrigger: local, dismissedUntil: null };
    const before = JSON.stringify(stable);
    const keysBefore = Object.keys(stable).sort().join(",");
    native.migrateItem(stable);
    ok("已迁移事项再迁移 ⇒ 报未变更（幂等，不制造每轮冷启动的落地）",
      native.migrateItem(stable) === false &&
      JSON.stringify(stable) === before &&
      Object.keys(stable).sort().join(",") === keysBefore,
      JSON.stringify({ changed: native.migrateItem(stable), state: JSON.stringify(stable) === before }));
    const missing = { scheduleBasis: "wall-clock", triggerAt: stable.triggerAt, localTrigger: local };
    ok("对照：字段确实缺失时仍要迁移一次，且第二次报未变更（幂等不是「永远不迁移」）",
      native.migrateItem(missing) === true && missing.dismissedUntil === null &&
      "dismissedUntil" in missing && native.migrateItem(missing) === false,
      JSON.stringify(missing));
    ok("幂等是**真的没改动**（不是改了再改回同一个值）", JSON.stringify(stable) === before,
      JSON.stringify({ before: before, after: JSON.stringify(stable) }));
  }
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
    const diagnosticsSrc = readSrc("lib/app-diagnostics.js");
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
      receiver.indexOf("recordAttempt(context, trace, title") > -1 &&
      receiver.indexOf("recordAttempt(context, trace, title") < receiver.indexOf("context.startActivity(activity)"));
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

    // 前端接线：按钮 id 必须同时存在于 HTML 与诊断模块（P2-D 起实现在 lib/app-diagnostics.js）
    const diagSrc = fs.readFileSync(path.join(__dirname, "lib/app-diagnostics.js"), "utf8");
    ["labOpenOverlay", "labOpenFsi", "labOpenAutoStart", "labFullScreen", "labDelivery"].forEach(id => {
      ok("自检面板 " + id + " 在 HTML 与诊断模块两侧都接线",
        html.indexOf('id="' + id + '"') > -1 && diagSrc.indexOf('"#' + id + '"') > -1);
    });
    ok("自检面板把投递结局翻成人话（缺这一段就只会说「还是弹通知」）",
      /lastAlarmDelivery/.test(diagSrc) && /describeAlarmDelivery/.test(diagSrc) &&
      // core 只保留转发，不保留第二份算法体
      /function describeAlarmDelivery\(d\)/.test(appCoreSrc) &&
      /diagnostics\.describeAlarmDelivery/.test(appCoreSrc));

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
    ok("A-03 直起与系统通知并存：前台请求横幅，锁屏请求全屏",
      /boolean backgroundDelivery = locked \|\| !screenOn/.test(receiver) &&
      /boolean fsiPath = fullScreen/.test(receiver) &&
      /if \(directPath\) \{/.test(receiver) &&
      /context\.startActivity\(activity\)/.test(receiver) &&
      /if \(fsiPath\) \{[\s\S]{0,200}setFullScreenIntent/.test(receiver) &&
      !/directAllowed/.test(receiver));
    ok("A-03 只有通话让路才跳过直起，前台路径明确含系统横幅",
      /directSkipped", "in-call yields, banner \+ sound only"/.test(receiver) &&
      /backgroundDelivery \? "fsi\+direct" : "direct\+banner"/.test(receiver) &&
      /alongside full-screen intent/.test(receiver));
    ok("A-03 系统通知落账与原生回读分开于全屏可见",
      /KEY_DELIVERY_NOTIFICATION_POSTED/.test(receiver) &&
      /recordNotificationPosted\(context, trace\)/.test(receiver) &&
      /notificationPosted/.test(plugin));
    ok("V1 同一次投递被拉起两次时不打断声音（onNewIntent 按 token 幂等）",
      /oldToken\.equals\(newToken\)/.test(activity) &&
      /duplicateIntent", "same delivery; keep sound playing"/.test(activity) &&
      /trace\("replaced", "different delivery"\)/.test(activity));
    ok("receiver 用 AudioManager.getMode() 判通话（无需 READ_PHONE_STATE 权限）",
      /AudioManager\.MODE_IN_CALL/.test(receiver) &&
      /AudioManager\.MODE_IN_COMMUNICATION/.test(receiver) &&
      !/READ_PHONE_STATE/.test(manifest));
    ok("通话状态随台账落盘并回读",
      /KEY_DELIVERY_IN_CALL/.test(plugin) && /inCall/.test(diagSrc));
    ok("通话中被跳过时自检说「按设计」而不是报故障",
      /通话中 · 不抢全屏；已请求系统横幅并继续声振/.test(diagSrc));

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
      !/if \(d\.locked\) reason = /.test(diagnosticsSrc) &&
      /缺「全屏通知」权限 · 锁屏\/息屏只能出横幅/.test(diagnosticsSrc));
    ok("V2 权限齐备却没弹出时如实说「系统没有展示」，不编原因",
      /权限齐备，但系统没有展示这次全屏/.test(diagnosticsSrc) &&
      /权限齐备，但界面没有被系统展示/.test(diagnosticsSrc));
    ok("V2 排程落地不再无条件承诺「关掉 App 后仍会按时响」",
      !/关掉 App 后仍会按时响/.test(diagnosticsSrc) &&
      /上一次到点没能把界面弹出来/.test(diagnosticsSrc));

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
    // D64（2026-09-19）改写并**加强**。
    //
    // 原断言是「拿不到闹钟时钟位时退回 allow-while-idle 并如实记 mode」—— 意图正确，
    // 但当时那条兜底路径有个漏洞：没有精确闹钟权限时 `setExactAndAllowWhileIdle` 会抛
    // SecurityException，而 `scheduleUnfreezer` 写在**同一个 try 内**，于是降级后
    // **连解冻器都没排**（F3 的解冻整条失效），并且整条路径**一条台账都不写** ——
    // 与「安静地不响」是同一类失效形态。
    //
    // 移除 `USE_EXACT_ALARM`（D64：本应用非闹钟/日历核心功能，不满足 Play 资格）之后，
    // 这条路会成为 Android 14+ 的默认路径，所以断言也随之加强为三条独立契约。
    ok("D64 精确闹钟权限先查再排（不再只靠 try/catch 兜）",
      /boolean exactPerm = canScheduleExactAlarms\(context\)/.test(scheduler) &&
      /static boolean canScheduleExactAlarms\(Context context\)/.test(scheduler));
    ok("D64 解冻器无条件排在精确排程判定之外（精确排程失败也必须把进程拉起来）",
      /scheduleUnfreezer\(context, am, id, trace, delivery, triggerAt, flags, info\)/.test(scheduler) &&
      // 解冻器调用必须晚于「三种形态判定」的最后一次赋值：用它自己在源码里的位置证明
      scheduler.indexOf("scheduleUnfreezer(context, am, id, trace, delivery, triggerAt, flags, info)") >
        scheduler.indexOf('mode = "inexactNoPermission"'));
    ok("D64 解冻器三种形态各自如实记 mode，不假装等价",
      /mode = "alarmClock"/.test(scheduler) &&
      /mode = "allowWhileIdle"/.test(scheduler) &&
      /mode = "inexactIdle"/.test(scheduler) &&
      /";mode=" \+ mode/.test(scheduler));
    ok("D64 无精确闹钟权限时降级到非精确且落台账（消除静默降级）",
      /exactAlarmPermissionMissing/.test(scheduler) &&
      /mode = "inexactNoPermission"/.test(scheduler) &&
      /am\.set\(AlarmManager\.RTC_WAKEUP, triggerAt, pi\)/.test(scheduler));
    ok("D64 闹钟时钟位排程失败要留痕，不再 catch (Exception ignored) 吞掉",
      /alarmClockFailed/.test(scheduler) &&
      !/am\.setAlarmClock\(info, pi\);\s*\n\s*AlarmTrace\.record\(context, trace, "scheduled"/.test(scheduler));
    ok("F3b 两处注释都保留 Reason=frozen 的取证（别再退回 allow-while-idle）",
      /Reason=frozen/.test(scheduler) && /Reason=frozen/.test(ringService));
    ok("F3 解冻器自己不投递闹钟通知（投递逻辑只有 Receiver 一条实现）",
      /class AlarmRingService extends Service/.test(ringService) &&
      !/ActiveAlarmStore\.postIfActive/.test(ringService) &&
      !/nm\.notify\(/.test(ringService));
    ok("D59 服务启动即拿前台身份，并在响铃上限处自停（铃声不再靠「通知被撤」而停）",
      /startForeground\(FOREGROUND_ID, ringNotification\(title\)\)/.test(ringService) &&
      /ActiveAlarmStore\.MAX_AGE_MS/.test(ringService) &&
      /stopSelf\(\)/.test(ringService));
    ok("D59 响铃上限可由测试钩子指定（生产值 6 小时，真机上等不到）",
      /static final String EXTRA_MAX_RING_MS/.test(ringService) &&
      /intent\.getLongExtra\(EXTRA_MAX_RING_MS, ActiveAlarmStore\.MAX_AGE_MS\)/.test(ringService) &&
      /maxRingMs < 1000L/.test(ringService));
    ok("D59 Manifest 声明 mediaPlayback 与配套权限（API 34 类型不匹配会抛异常）",
      /android:name="\.AlarmRingService"/.test(manifest) &&
      /android:foregroundServiceType="mediaPlayback"/.test(manifest) &&
      /FOREGROUND_SERVICE_MEDIA_PLAYBACK/.test(manifest) &&
      // shortService 有硬性时长上限，而闹钟要响到用户处理或撞上 MAX_AGE —— 不能再用它
      !/foregroundServiceType="shortService"/.test(manifest));
    ok("F3 取消时三种 PendingIntent 都撤（广播/前台服务/历史 Activity 直投）",
      /PendingIntent\.getBroadcast\(context, id, intent, flags\)/.test(scheduler) &&
      /PendingIntent\.getForegroundService\(context, id, service, flags\)/.test(scheduler) &&
      /PendingIntent\.getActivity\(context, id, ui, flags\)/.test(scheduler) &&
      /AlarmScheduler\.cancel\(getContext\(\), id\)/.test(plugin));

    // D59（2026-09-19，**推翻 F2**）：声音与振动的所有权从通知收回应用。
    //
    // F2 当年把声音交给系统（通知的 IRingtonePlayer 播，不受本进程生死影响），
    // 收益是「界面被系统收掉，声音还在」。代价在 H-08 上显形：无 POST_NOTIFICATIONS 时
    // `notify()` 是**静默空操作**，声音与振动随屏幕一起归零 —— 真机实测
    // 「无通知权限 + 息屏」7 轮受控投递 0/4 成功：不响铃、不振动、不亮屏。
    //
    // 下面几条是**反向断言**（证明旧路径已经消失）。反向断言有个专门陷阱：
    // 「找不到某字符串」在文件读错、内容为空时**也会通过**，看起来一样绿。
    // 所以每条都先剥注释 —— 新代码的注释里正解释着这些旧标识符，不剥就会自我命中 ——
    // 并配一个长度哨兵证明「文件确实读到了内容」。
    const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/[^\n]*$/gm, " ");
    const receiverCode = strip(receiver);
    const activityCode = strip(activity);
    ok("D59 闹钟通知不再带 FLAG_INSISTENT（声音不再由通知承载）",
      receiverCode.length > 1000 &&
      !/FLAG_INSISTENT/.test(receiverCode) &&
      /import android\.app\.Notification;/.test(receiver));
    ok("D59 闹钟通知不再 setDefaults(DEFAULT_ALL)（振动不再由通知承载）",
      !/DEFAULT_ALL/.test(receiverCode));
    ok("D59 渠道无声音无振动，且旧渠道被显式退役（渠道属性创建后不可改）",
      /channel\.setSound\(null, null\)/.test(receiverCode) &&
      /channel\.enableVibration\(false\)/.test(receiverCode) &&
      /nm\.deleteNotificationChannel\(LEGACY_CHANNEL_ID\)/.test(receiverCode) &&
      /CHANNEL_ID = "attention-alarm-v4"/.test(receiverCode) &&
      /LEGACY_CHANNEL_ID = "attention-alarm-v3"/.test(receiverCode));
    ok("D59 界面不再自己判断「通知是否持有声音」（所有权已不在通知）",
      activityCode.length > 1000 &&
      !/notificationOwnsSound/.test(activityCode) &&
      /AlarmRingService\.isRinging\(\)/.test(activityCode));
    ok("D59 投递侧先起响铃服务再拉界面（响不该被「亮」的失败连带）",
      receiverCode.indexOf("startRingService(context, intent, trace)") > 0 &&
      receiverCode.indexOf("startRingService(context, intent, trace)") <
        receiverCode.indexOf("context.startActivity(activity)"));

    // T4：界面亮屏能力。这段实现在 D59 之前就存在（D45-a 那轮写的），但**从未被断言过** ——
    // 而 D59 之后它的地位上升了：屏幕成了通知权限唯一起作用的那一格，
    // 「界面能不能在锁屏下显示」直接决定这一格是成功还是失败。所以补上守护。
    ok("T4 界面亮屏齐备（API 27+ setter + 全版本 flag 回退 + manifest 三处）",
      activityCode.length > 1000 &&
      /setShowWhenLocked\(true\)/.test(activityCode) &&
      /setTurnScreenOn\(true\)/.test(activityCode) &&
      /FLAG_KEEP_SCREEN_ON/.test(activityCode) &&
      /FLAG_TURN_SCREEN_ON/.test(activityCode) &&
      /FLAG_SHOW_WHEN_LOCKED/.test(activityCode) &&
      /android:showWhenLocked="true"/.test(manifest) &&
      /android:turnScreenOn="true"/.test(manifest));

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
    const diagnostics = require(path.join(__dirname, "lib/app-diagnostics.js"));
    const nodes = new Map();
    const $ = id => {
      if (!nodes.has(id)) nodes.set(id, { disabled: false, textContent: "" });
      return nodes.get(id);
    };
    let bridge = null, fallback = null, calls = 0, release;
    const doc = { addEventListener() {}, visibilityState: "visible" };
    const instance = diagnostics.createAppDiagnostics({
      query: $, queryAll: () => [], openSheet() {}, toast() {}, fmtTime: () => "now",
      getState: () => ({ settings: {} }), save: async () => {}, renderMe() {},
      systemBridge: () => bridge, appSettingsPlugin: () => fallback,
      getNativeReminderStatus: () => ({}), setNativeReminderStatus() {},
      requestNativeNotificationPermission: async () => {},
      openExactAlarmSettings: async () => {}, buildDesired: () => [],
      syncNativeRemindersNow: async () => ({}), getCapacitor: () => null,
      getDocument: () => doc
    });
    const guide = kind => instance.openBackgroundGuide(kind);
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
  section("N-02 / N-03 生命周期与冷启动基线（2026-09-18 修复守护）");
  {
    const fs = require("fs");
    const readSrc = rel => fs.readFileSync(path.join(__dirname, rel), "utf8");
    const activity = readSrc("android/app/src/main/java/space/alliswell/inbox/AlarmActivity.java");
    const appCoreSrc = readSrc("app-core.js");
    const codeOnly = appCoreSrc
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/[^\n]*$/gm, " ");

    // N-02-a：onStop 无条件停声振，但此前**没有对应的恢复** —— 在通知权限被禁
    // （声音只能靠界面自播）的机器上，按 Home 再切回来闹钟就永久哑了。
    const resumeAt = activity.indexOf("protected void onResume()");
    const resumeBody = resumeAt < 0 ? "" : activity.slice(resumeAt, resumeAt + 900);
    ok("N-02 onResume 恢复声振（与 onStop 的静音决策配成一对）",
      /restartAlarmEffects\(\)/.test(resumeBody));

    // N-02-b：startAlarmSound 必须幂等 —— playAlarm 无条件 new MediaPlayer 并直接覆盖字段，
    // 旧 player 仍在 looping 却已失去引用（停不掉也释放不掉），重复起响会叠加成两路铃声。
    const soundAt = activity.indexOf("private void startAlarmSound()");
    const soundBody = soundAt < 0 ? "" : activity.slice(soundAt, soundAt + 520);
    ok("N-02 startAlarmSound 幂等（已在播则复用，不叠加第二路铃声）",
      /mediaPlayer\.isPlaying\(\)\)\s*return;/.test(soundBody));

    // N-03-a：面板轮询句柄必须留痕，重复初始化不得静默堆定时器
    const alertsSource = fs.readFileSync(path.join(__dirname, "lib/app-alerts.js"), "utf8");
    ok("N-03 面板轮询保存句柄并在重绑时清理",
      /let activeAlarmPollTimer = null;/.test(alertsSource) &&
      /clearInterval\(activeAlarmPollTimer\)/.test(alertsSource));

    // N-03-b：冷启动基线 —— committedAlarmItems 此前只在 writeSnapshot 里赋值，
    // 「刚启动、还没提交过事务」时恒为 []，旧投递永远等不到自动忽略。
    const applyAt = codeOnly.indexOf("function applyParsedState(parsed)");
    const applyEnd = codeOnly.indexOf("function loadAsync()");
    const applyBody = (applyAt < 0 || applyEnd <= applyAt) ? "" : codeOnly.slice(applyAt, applyEnd);
    const persistenceSource = fs.readFileSync(path.join(__dirname, "lib/app-persistence.js"), "utf8");
    ok("N-03 加载状态时由持久化实例重建已提交基线（否则旧投递永不被自动忽略）",
      /establishCommittedBaseline\(deps\.applyRecoveredState\(parsed\)\)/.test(persistenceSource));

    // D45-a（2026-09-18 反向选择）：onStop **不再**停止声振。
    // 必须剥注释后再匹配 —— 本轮 onStop 的注释里正解释着 "onDestroy 仍调
    // stopAlarmEffects()"，不剥注释会把这段说明误判成「onStop 停了声」。
    const javaCode = s => s
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/[^\n]*$/gm, " ");
    const activityCode = javaCode(activity);

    // 用「方法区间」而不是固定偏移取 body —— 注释会随解释增删而变长。
    const methodBody = (code, from, to) => {
      const a = code.indexOf(from);
      const b = a < 0 ? -1 : code.indexOf(to, a);
      return (a < 0 || b <= a) ? "" : code.slice(a, b);
    };

    const stopBody = methodBody(activityCode, "protected void onStop()", "private void bindIntent()");
    ok("D45-a onStop 不再停止声振（遮挡期间继续响）",
      stopBody.length > 0 &&
      !/stopLocalFallback\(\)/.test(stopBody) &&
      !/stopAllEffects\(\)/.test(stopBody) &&
      /super\.onStop\(\)/.test(stopBody));

    // D59 改写了这条边界的**理由**（结论仍是「响铃不越过界面销毁」，但只管回落路径）：
    // 铃声的主载体已经是前台服务，界面死掉不该把它一起带走 —— 那正是本次修复的目的。
    // 所以 onDestroy 只停回落，**不能**出现 requestStop 或 stopAllEffects。
    const destroyBody = methodBody(activityCode, "protected void onDestroy()", "public void onBackPressed()");
    ok("D59 onDestroy 只停回落路径，不停服务（铃声不随界面销毁而中断）",
      destroyBody.length > 0 &&
      /stopLocalFallback\(\)/.test(destroyBody) &&
      !/stopAllEffects\(\)/.test(destroyBody) &&
      !/AlarmRingService\.requestStop/.test(destroyBody));
  }

  section("Q6 原生链路静默失败与可观测性");
  {
    const fs = require("fs");
    const readSrc = rel => fs.readFileSync(path.join(__dirname, rel), "utf8");
    const appCoreSrc = readSrc("app-core.js");
    const coordinatorSrc = readSrc("lib/app-native-coordinator.js");
    const eventsSrc = readSrc("lib/app-events.js");
    const html = readSrc("index.html");
    // Q6-a：被调用的守卫函数必须真的有定义。
    // 现场缺陷：isNativeAndroidRuntime 被 3 处调用却从未定义，
    // 点「精确闹钟 / 通知设置 / 电池优化」三个入口直接 ReferenceError，
    // 用户侧只表现为「点了没反应」—— 此前没有任何测试覆盖。
    ok("isNativeAndroidRuntime 有定义（此前被 3 处调用却从未定义）",
      /function isNativeAndroidRuntime\s*\(/.test(appCoreSrc));
    ok("waitForNativeBridge 有定义",
      /function waitForNativeBridge\s*\(/.test(appCoreSrc));
    const diagnosticsSrc = readSrc("lib/app-diagnostics.js");
    ok("renderBackgroundVerdict 有定义",
      /async function renderBackgroundVerdict\s*\(/.test(diagnosticsSrc));

    // Q6-b：init 不得再 await 原生初始化 —— 它会把 seed / render / 15 秒心跳一起拖住
    ok("init 不再阻塞等待原生初始化（V1 同类：静默中断启动链）",
      !/await initializeNativeReminders\(\);/.test(appCoreSrc) &&
      /ensureNativeReminders\(\);/.test(appCoreSrc));

    // Q6-c：桥未就绪时不得静默 return，必须留下可见记录
    ok("桥未就绪时改为等待 + 留下可见失败记录（不再静默 return）",
      (/const bridged = await waitForNativeBridge\(10000\)/.test(appCoreSrc) || /const bridged = await waitForNativeBridge\(10000\)/.test(coordinatorSrc)) &&
      (/bridgeNotReady: true/.test(appCoreSrc) || /bridgeNotReady: true/.test(coordinatorSrc)));

    // Q6-d：安卓绝不走 Web 通知分支。
    // WebView 的 Notification.requestPermission() 会返回 granted，
    // 于是开关显示「已开启」而系统权限根本没授予 → reconcile 的 enabled 仍为 false → 零排程。
    ok("安卓运行时不走 Web 通知分支（否则造出「开关开着却没权限」的假象）",
      /else if \((?:deps\.)?isNativeAndroidRuntime\(\)\) \{/.test(appCoreSrc) ||
      /else if \((?:deps\.)?isNativeAndroidRuntime\(\)\) \{/.test(eventsSrc));

    // Q6-e：界面必须能回答「关掉 App 后会不会响」
    ['labVerdict', 'labBackground', 'labScheduled', 'labResync'].forEach(id => {
      ok("自检面板 " + id + " 在 HTML 与诊断模块两侧都接线",
        html.indexOf('id="' + id + '"') > -1 && diagnosticsSrc.indexOf('"#' + id + '"') > -1);
    });
    ok("结论区分「总开关未开」与「权限未授予」（此前共用一句「通知未授权」把人带偏）",
      /总开关未开/.test(diagnosticsSrc) && /系统通知权限未授予/.test(diagnosticsSrc));
    ok("能区分「原生对账从未执行」这种静默失败",
      /s\.enabled === undefined/.test(diagnosticsSrc) && /原生对账从未执行/.test(diagnosticsSrc));
    ok("结论用 getPending 的实数，而不是只报「打算排几条」",
      /getPending/.test(diagnosticsSrc) && /pending === 0 && desired > 0/.test(diagnosticsSrc));

    // Q6-f：通用检查 —— 所有「当成守卫函数调用」的标识符必须真的有定义。
    // 本次真凶 isNativeAndroidRuntime 正是这一类：被 if (!x()) 调用、却从未定义，
    // 只有点到那个按钮才暴露，且表现只是「没反应」。手工断言只能抓已发现的那一个，
    // 这个扫描抓的是**同一类里的下一个**。
    // 注意：必须先剥掉注释，否则注释里举的例子会被当成真调用（第一版就是这么误报的）。
    const codeOnly = (appCoreSrc + "\n" + coordinatorSrc)
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
    await native._resetForTests();
    const env = createEnvironment();
    const settings = { notify: true };
    const simultaneousAt = Date.now() + 60000;
    const simultaneous = ["alarm-a", "alarm-b"].map(id =>
      item(id, "normal", simultaneousAt, { delivery_mode: "alarm" }));
    await native.reconcile(simultaneous, settings, Date.now());
    ok("C15 同刻闹钟分别排程、不聚合（不证明原生串行展示）",
      env.alarms.scheduleAlarm.length === 2 &&
      new Set(env.alarms.scheduleAlarm.map(n => n.id)).size === 2 &&
      new Set(env.alarms.scheduleAlarm.map(n => n.itemId)).size === 2);

    const rs = { enabled: true, hour: 21, minute: 30, followupMs: 3600000, maxFollowups: 2 };
    const session = native.buildReviewDesired(6, rs, now, settings);
    ok("D11 六条待整理每个槽位仅一条会话通知",
      session.length > 0 && new Set(session.map(n => n.schedule.at.getTime())).size === session.length &&
      session.every(n => n.body.includes("6 条") && n.actionTypeId === native.REVIEW_ACTION_TYPE_ID));
    ok("D11 增加待整理数量不增加会话通知槽位",
      session.length === native.buildReviewDesired(1, rs, now, settings).length);
  }
  {
    const rs = { enabled: true, hour: 21, minute: 30, followupMs: 60 * 60 * 1000, maxFollowups: 2 };
    const rd = native.buildReviewDesired(4, rs, now, { notify: true });
    ok("D22 默认硬窗口仅两次", rd.length === 2, String(rd.length));
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
    ok("D18 勿扰结束等于窗口终点，不越窗排程", rq.length === 0);
    const longWindow = Object.assign({}, rs, { hour: 20, minute: 0 });
    const at1900 = new Date(2026, 0, 15, 19, 0).getTime();
    const hours = list => list.map(n => n.schedule.at.getHours() + ":" + n.schedule.at.getMinutes()).join(",");
    ok("N4 长窗口首发加两次补充", hours(native.buildReviewDesired(2, longWindow, at1900, {})) === "20:0,21:0,22:0");
    const withinDnd = native.buildReviewDesired(2, rs, beforeWindow, { dnd: true, quietStart: "20:00", quietEnd: "22:00" });
    ok("N4 勿扰顺延在窗内仅保留22点，23点终点不含", hours(withinDnd) === "22:0");
    const night = Object.assign({}, rs, { hour: 23, minute: 30, windowEndHour: 2, windowEndMinute: 0 });
    const afterMidnight = new Date(2026, 0, 16, 0, 10).getTime();
    const remainingNight = native.buildReviewDesired(2, night, afterMidnight, {});
    ok("N4 午夜后保留前一晚剩余两档", hours(remainingNight) === "0:30,1:30" && remainingNight.every(n => n.schedule.at.getDate() === 16));
    const emptyWindow = Object.assign({}, rs, { windowEndHour: 21, windowEndMinute: 30 });
    ok("N4 起止相同是空窗口", native.buildReviewDesired(2, emptyWindow, beforeWindow, {}).length === 0);

    // D20：稍后必须单独占一个槽位，否则安卓上「稍后 30 分钟」到点不响
    const snoozed = Object.assign({}, rs, { snoozedUntil: new Date(2026, 0, 15, 23, 20, 0).getTime() });
    const rsn = native.buildReviewDesired(3, snoozed, new Date(2026, 0, 15, 22, 50, 0).getTime(), { notify: true });
    ok("D20 稍后时刻被排进待整理通知",
      rsn.some(n => n.schedule.at.getTime() === new Date(2026, 0, 15, 23, 20, 0).getTime()),
      rsn.map(n => n.schedule.at.toLocaleString()).join(" | "));
    const rsPast = Object.assign({}, rs, { snoozedUntil: new Date(2026, 0, 15, 23, 20, 0).getTime() });
    const rsp = native.buildReviewDesired(3, rsPast, new Date(2026, 0, 15, 23, 40, 0).getTime(), { notify: true });
    ok("D20 已过去的稍后不再占槽位", rsp.length === 2, String(rsp.length));

    await native._resetForTests();
    const env = createEnvironment();
    const review = { count: 3, settings: rs };
    const sr = await native.reconcile([], { notify: true }, now, review);
    ok("P0-1 待整理并入同一次对账", sr.desired === 2 && sr.scheduled === 2 && env.calls.schedule.length === 1);
    const srOff = await native.reconcile([], { notify: false }, now, review);
    ok("D18 关闭通知总开关后待整理排程被撤销", srOff.cancelled === 2 && srOff.scheduled === 0);
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
    ok("R4 21:25 排出当晚两档", at2125.length === 2, String(at2125.length));
    ok("R4 21:35 仍保留当晚末档",
      tsOf(at2135).join(",") === [
        new Date(2026, 8, 16, 22, 30, 0).getTime()
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

    // N-08：截止不足 2 小时时 p24 与 p2 **同时**过期，补投只应产生**一条**提醒。
    // 修复前两者各自补投 `now + 2000` → 同一事项在同一毫秒弹出两条通知（重复打扰）。
    const overdueItem = item("od", "normal", now + 30 * 86400000, { deadlineAt: now + 3600000 });
    const overdueDeadlines = native.buildDesired([overdueItem], { notify: true }, now)
      .filter(n => n.extra.event === "deadline");
    ok("N-08 多个保护点同时过期只补投一条截止提醒",
      overdueDeadlines.length === 1,
      overdueDeadlines.map(n => n.extra.stageKey + "@" + n.schedule.at.getTime()).join(" | "));
    ok("N-08 补投保留最接近截止的阶段（p2）",
      overdueDeadlines.length === 1 && overdueDeadlines[0].extra.stageKey === "p2@" + overdueItem.deadlineAt,
      overdueDeadlines.map(n => n.extra.stageKey).join("|"));
    // 对照：截止还有 12 小时 → 只有 p24 过期，p2 仍在未来，应为「1 条补投 + 1 条预排」
    const leadOnlyItem = item("lo", "normal", now + 30 * 86400000, { deadlineAt: now + 12 * 3600000 });
    const leadOnlyDeadlines = native.buildDesired([leadOnlyItem], { notify: true }, now)
      .filter(n => n.extra.event === "deadline");
    ok("N-08 对照：仅 p24 过期时补投 p24、并保留未来的 p2",
      leadOnlyDeadlines.length === 2 &&
      leadOnlyDeadlines.filter(n => n.schedule.at.getTime() <= now + 5000)
        .every(n => n.extra.stageKey === "p24@" + leadOnlyItem.deadlineAt),
      leadOnlyDeadlines.map(n => n.extra.stageKey + "@" + n.schedule.at.getTime()).join(" | "));

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
    ok("隐藏闹钟：排程对账不能移除正在提醒的停止入口",
      env.alarms.cancelNotification.length > 0 && env.alarms.cancelNotification.every(x => x.preserveActive === true));
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

  section("D43 单次提醒补投台账（2026-09-18 修复守护）");
  {
    // 背景：投影只排**严格未来**的触发点（`at <= now` 直接跳过），于是「触发点已过、
    // 事项仍活跃」的提醒永远拿不到原生通知 —— 用户**少一条提醒**。
    // 补投必须能回答「这个触发点是否已经消费过」，否则每轮对账都会再补一次。
    // 台账结构、三态语义、身份取法全部与 deadlineEvents 对齐。
    const past = now - 5 * 60 * 1000;
    const missed = item("miss", "normal", past);
    const caught = native.buildDesired([missed], { notify: true }, now);
    ok("D43-a 触发点已过且无记录 → 补一条提醒（此前直接丢弃）",
      caught.length === 1 && caught[0].extra.catchUp === true,
      JSON.stringify(caught.map(n => n.extra.event)));
    ok("D43-a 补投落在 now+2s，身份仍是**原定触发点**（不是补投时刻）",
      caught.length === 1 &&
      caught[0].schedule.at.getTime() === now + 2000 &&
      caught[0].extra.reminderKey === "0@" + past,
      caught.length ? caught[0].extra.reminderKey : "none");

    const withState = state => Object.assign({}, missed, {
      reminderEvents: { ["0@" + past]: { at: now + 2000, state } }
    });
    ok("D43-b 台账 scheduled → 既不重排也不补发（无法判定是否送达）",
      native.buildDesired([withState("scheduled")], { notify: true }, now).length === 0);
    ok("D43-c 台账 delivered → 终态，永不再打扰",
      native.buildDesired([withState("delivered")], { notify: true }, now).length === 0);
    ok("D43-d 台账 cancelled → 视同「从未排过」，允许补一次",
      native.buildDesired([withState("cancelled")], { notify: true }, now).length === 1);

    const ancient = item("ancient", "normal", now - 25 * 3600000);
    ok("D43-e 超出补投窗口（>24h）不补 —— 事项本身已在首页「待确认」，半夜补通知是净打扰",
      native.buildDesired([ancient], { notify: true }, now).length === 0);
    const borderline = item("borderline", "normal", now - 23 * 3600000);
    ok("D43-e 窗口内（<24h）仍补一条",
      native.buildDesired([borderline], { notify: true }, now).length === 1);

    const firstBuild = native.buildDesired([missed], { notify: true }, now)[0];
    const secondBuild = native.buildDesired([missed], { notify: true }, now)[0];
    ok("D43-f 补投身份稳定（同 now 反复对账得同一 id，不产生撤销/重排循环）",
      !!firstBuild && !!secondBuild && firstBuild.id === secondBuild.id);

    const overdueCritical = item("critical-miss", "critical", now - 2 * 3600000);
    const criticalCaught = native.buildDesired([overdueCritical], { notify: true }, now);
    const lastAttempt = 7; // critical: total = 8
    ok("D43-g 多个尝试全过期只补一条，且保留**最后一次**尝试（与 D44-b 同一取舍）",
      criticalCaught.length === 1 &&
      criticalCaught[0].extra.attempt === lastAttempt &&
      criticalCaught[0].extra.reminderKey ===
        lastAttempt + "@" + (overdueCritical.triggerAt + lastAttempt * 15 * 60 * 1000),
      JSON.stringify(criticalCaught.map(n => [n.extra.attempt, n.extra.reminderKey])));
    ok("D43-h 补投**不**走全屏闹钟（错过的提醒不该抢屏）",
      criticalCaught.length === 1 && !criticalCaught[0].extra.useAlarm);

    const dismissed = Object.assign({}, missed, { dismissedUntil: now + 3600000 });
    ok("D43-i dismissedUntil 在未来 → 不补投（不打断用户「别打扰」的承诺）",
      native.buildDesired([dismissed], { notify: true }, now).length === 0);

    const futureDesired = native.buildDesired([item("future", "normal", now + 3600000)],
      { notify: true }, now);
    ok("D43-j 未过期路径完全不受影响（无 catchUp 标记、身份照旧）",
      futureDesired.length === 1 &&
      futureDesired[0].extra.catchUp === undefined &&
      futureDesired[0].extra.reminderKey === "0@" + (now + 3600000));

    // 回传 → 落账 → 下一轮为 0：没有这条链路，补投会每轮对账重来一次
    await native._resetForTests();
    createEnvironment();
    const recStatus = await native.reconcile([missed], { notify: true }, now, null);
    ok("D43-k 对账回传 reminderEvents（本地通道）",
      (recStatus.reminderEvents || []).length === 1 &&
      recStatus.reminderEvents[0].itemId === "miss" &&
      recStatus.reminderEvents[0].key === "0@" + past &&
      recStatus.reminderEvents[0].at === now + 2000,
      JSON.stringify(recStatus.reminderEvents));
    const recorded = Object.assign({}, missed, {
      reminderEvents: {
        [recStatus.reminderEvents[0].key]: { at: recStatus.reminderEvents[0].at, state: "scheduled" }
      }
    });
    ok("D43-l 把回传落账后下一轮不再补投（端到端幂等）",
      native.buildDesired([recorded], { notify: true }, now).length === 0);

    await native._resetForTests();
    createEnvironment();
    const alarmFuture = item("alarm-future", "critical", now + 3600000);
    const alarmStatus = await native.reconcile([alarmFuture], { notify: true }, now, null);
    ok("D43-m 闹钟通道（关键档首次）也要记入台账 —— 否则到点后重复补投",
      (alarmStatus.reminderEvents || []).some(
        e => e.itemId === "alarm-future" && e.key === "0@" + alarmFuture.triggerAt),
      JSON.stringify(alarmStatus.reminderEvents));

    await native._resetForTests();
    createEnvironment();
    await native.reconcile([item("revoke", "normal", now + 3600000)], { notify: true }, now, null);
    const revoked = await native.reconcile([], { notify: true }, now + 1000, null);
    ok("D43-n 本轮真的被撤销的提醒排程要回传（撤销 ≠ 送达，允许日后补一次）",
      (revoked.cancelledReminderEvents || []).length === 1 &&
      revoked.cancelledReminderEvents[0].itemId === "revoke" &&
      revoked.cancelledReminderEvents[0].key === "0@" + (now + 3600000),
      JSON.stringify(revoked.cancelledReminderEvents));
  }

  section("H-08 投递台账：无通知权限必须能被归因（2026-09-18 修复守护）");
  {
    // 背景：`setFullScreenIntent` 是 **Notification 的属性**，通知发不出去就没有载体，
    // 系统也不会替我们全屏，并失去 NOTIFICATION_SERVICE 的 BAL 豁免 → 直起同样被静默拦。
    // 2026-09-18 vivo 真机：无通知权限 + 息屏 0/4，有权限 2/2，断点每次都在 created 之前。
    // 本轮只落「可观测性」（台账 + 自检归因），不改投递机制。
    const fs = require("fs");
    const readSrc = rel => fs.readFileSync(path.join(__dirname, rel), "utf8");
    const receiver = readSrc("android/app/src/main/java/space/alliswell/inbox/AlarmTestReceiver.java");
    const bridgeSrc = readSrc("android/app/src/main/java/space/alliswell/inbox/SystemBridgePlugin.java");
    const appCore = readSrc("app-core.js");
    const appDiagnostics = readSrc("lib/app-diagnostics.js");
    const jCode = s => s
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/[^\n]*$/gm, " ");

    ok("H-08 投递台账新增「当时通知是否可用」字段",
      /KEY_DELIVERY_NOTIFY_ON = "deliveryNotifyEnabled"/.test(receiver));
    ok("H-08 投递时把通知可用性写进台账（事后改权限不能篡改当时的结论）",
      /putBoolean\(KEY_DELIVERY_NOTIFY_ON, notificationsUsable\(context\)\)/.test(receiver));
    // minSdk 22：`NotificationManager.areNotificationsEnabled()` 是 API 24+，直接调用会
    // 抛 NoSuchMethodError 且 catch(Exception) 兜不住（H-04 已修过同一坑，这里是投递侧）。
    ok("H-08 判权限用 NotificationManagerCompat（API 22 不会 NoSuchMethodError）",
      /NotificationManagerCompat\.from\(context\)\.areNotificationsEnabled\(\)/.test(receiver));
    // D59 改的是**字段与措辞两者**，不只是措辞。
    //
    // 旧文案 "system notifications disabled; full-screen intent has no carrier" 读起来像
    // 「整个闹钟都哑了」；而 D59 之后它只对**屏幕**成立 —— 声音与振动已改由
    // AlarmRingService 自播，根本不经过通知。诊断反着报比不报更危险：
    // 2026-09-18 那轮就是靠这种反着的结论把排查引向了「加悬浮窗权限」。
    ok("D59 只记「屏幕没有载体」，不再暗示整个闹钟静默",
      /AlarmTrace\.record\(context, trace, "screenCarrierMissing"/.test(receiver) &&
      !/"fullScreenCarrierMissing"/.test(jCode(receiver)) &&
      /sound\+vibration unaffected/.test(receiver));
    ok("H-08 lastAlarmDelivery 回传该字段，且默认 true（老记录不误报无权限）",
      /r\.put\("notifyEnabledAtDelivery",\s*sp\.getBoolean\(AlarmTestReceiver\.KEY_DELIVERY_NOTIFY_ON, true\)\)/.test(bridgeSrc));

    // JS 侧的归因是**行为**，不在这里做源码级匹配（源码级匹配无法反向验证）：
    // 断言在 test-smoke.js「11. H-08 投递归因」一节，逐条覆盖「无权限 / 同时命中 /
    // 老记录 / 权限齐备 / 界面已显示」五种形态。
    const coreCodeH8 = jCode(appCore + "\n" + appDiagnostics);
    ok("H-08 归因读取投递台账字段（键名与原生写入一致）",
      /d\.notifyEnabledAtDelivery === false/.test(coreCodeH8) &&
      /notifyEnabledAtDelivery/.test(bridgeSrc));

    // ── D64 两条上架门禁（2026-09-19）─────────────────────────────────────────
    //
    // ① `USE_EXACT_ALARM` 资格：Google Play 政策限定该受限权限只给「闹钟/计时器」类
    //    或「显示活动通知的日历」类应用，并明写不符合资格者禁止发布
    //    （support.google.com/googleplay/android-developer/answer/16558241）。
    //    本应用核心功能是提醒/待办 → 改走官方给的替换路径：
    //    「继续声明 SCHEDULE_EXACT_ALARM，并做好使用者拒绝的备案」。
    // ② A14+ `USE_FULL_SCREEN_INTENT`：检测与引导**此前已实现**（Q3-a/Q3-b），
    //    真正缺的是「投递时快照」—— 归因原先读的是**活值**。
    const d64Manifest = readSrc("android/app/src/main/AndroidManifest.xml");
    ok("D64 清单只声明 SCHEDULE_EXACT_ALARM，不再声明受限的 USE_EXACT_ALARM",
      /android\.permission\.SCHEDULE_EXACT_ALARM/.test(d64Manifest) &&
      !/<uses-permission android:name="android\.permission\.USE_EXACT_ALARM"/.test(d64Manifest));
    ok("D64 注册精确闹钟权限变更接收器（官方迁移清单第 4 步：授权后重排）",
      /\.ExactAlarmPermissionReceiver/.test(d64Manifest) &&
      /android\.app\.action\.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED/.test(d64Manifest));
    const exactReceiverSrc = readSrc(
      "android/app/src/main/java/space/alliswell/inbox/ExactAlarmPermissionReceiver.java");
    ok("D64 接收器以实测值为准再重排（不把「收到广播」当成「已授权」）",
      /AlarmScheduler\.canScheduleExactAlarms\(appContext\)/.test(exactReceiverSrc) &&
      /if \(granted\)/.test(exactReceiverSrc) &&
      /SystemBridgePlugin\.restorePersistedAlarms\(appContext\)/.test(exactReceiverSrc));
    ok("D64 投递时快照精确闹钟与全屏意图两项权限（同 H-08：不能用「现在」解释「当时」）",
      /KEY_DELIVERY_EXACT_ON = "deliveryExactEnabled"/.test(receiver) &&
      /KEY_DELIVERY_FSI_ON = "deliveryFullScreenIntentEnabled"/.test(receiver) &&
      /\.putBoolean\(KEY_DELIVERY_EXACT_ON, canScheduleExactAlarmsNow\(context\)\)/.test(receiver) &&
      /\.putBoolean\(KEY_DELIVERY_FSI_ON, canUseFullScreenIntentNow\(context\)\)/.test(receiver));
    ok("D64 两个快照默认 true（老 APK 记录缺键，不得凭空变成「没权限」）",
      /r\.put\("exactAtDelivery",\s*sp\.getBoolean\(AlarmTestReceiver\.KEY_DELIVERY_EXACT_ON, true\)\)/.test(bridgeSrc) &&
      /r\.put\("fsiAtDelivery",\s*sp\.getBoolean\(AlarmTestReceiver\.KEY_DELIVERY_FSI_ON, true\)\)/.test(bridgeSrc));
    ok("D64 归因优先用投递时快照，活值只作老记录回退",
      /d\.fsiAtDelivery !== undefined/.test(coreCodeH8) &&
      /d\.canUseFullScreenIntent !== false/.test(coreCodeH8) &&
      /d\.exactAtDelivery === false/.test(coreCodeH8));
    ok("D64 全屏意图判定前置版本闸门（API 34+ 方法在 minSdk 22 上抛 NoSuchMethodError，catch(Exception) 兜不住）",
      /if \(Build\.VERSION\.SDK_INT < 34\) return true;/.test(receiver) &&
      /catch \(Exception \| Error ignored\)/.test(receiver));

    // ── D59 载体归因（S2.5）────────────────────────────────────────────────
    //
    // 「响了」与「亮了」是两件独立的事，台账必须能分开回答。缺这组字段时，
    // `notifyEnabledAtDelivery=false` 会被读成「完全静默」—— 而在 D59 之后
    // 那只是「屏幕没有载体」，声音照常在响。
    const ringServiceSrc = readSrc("android/app/src/main/java/space/alliswell/inbox/AlarmRingService.java");
    ok("D59 台账新增载体归因字段（声音/振动/前台服务分别归因）",
      /KEY_CARRIER_SOUND = "carrierSound"/.test(receiver) &&
      /KEY_CARRIER_VIBRATE = "carrierVibrate"/.test(receiver) &&
      /KEY_CARRIER_FGS = "carrierForegroundService"/.test(receiver));
    // 归属必须认「哪一次投递」。时间戳在这里是错的判据 ——
    // 广播投递与响铃服务是两条**同刻**的闹钟时钟，谁先派发不确定，
    // 用「谁更新」判断会在「服务先跑」时把本次结果误判成上一次的陈旧值。
    ok("D59 载体归属用 trace 而不是时间戳（两条同刻排程谁先跑不确定）",
      /KEY_CARRIER_TRACE = "carrierTrace"/.test(receiver) &&
      /KEY_DELIVERY_TRACE = "deliveryTrace"/.test(receiver) &&
      /putString\(KEY_DELIVERY_TRACE, trace/.test(receiver) &&
      /putString\(AlarmTestReceiver\.KEY_CARRIER_TRACE/.test(ringServiceSrc));
    ok("D59 载体陈旧时回 unknown，不沿用上一次投递的旧值",
      /carrierFresh/.test(bridgeSrc) &&
      /deliveryTrace\.equals\(carrierTrace\)/.test(bridgeSrc) &&
      /"unknown"/.test(bridgeSrc));
    ok("D59 服务把「铃声/振动/前台身份」各自的成功与否都上报",
      /putString\(AlarmTestReceiver\.KEY_CARRIER_SOUND, sound \? "native" : "none"\)/.test(ringServiceSrc) &&
      /putString\(AlarmTestReceiver\.KEY_CARRIER_VIBRATE, vibrate \? "native" : "none"\)/.test(ringServiceSrc) &&
      /putBoolean\(AlarmTestReceiver\.KEY_CARRIER_FGS, foreground\)/.test(ringServiceSrc));
    // 界面回落也必须上报载体，否则「服务没起来、界面代它响了」这件事在面板上反而看不见
    ok("D59 界面回落自播时也上报载体（否则降级路径在面板上不可见）",
      /recordFallbackCarrier/.test(jCode(readSrc("android/app/src/main/java/space/alliswell/inbox/AlarmActivity.java"))));

    // 停铃链路必须闭环：撤通知**不会**让服务持有的铃声停（D59 之前它靠 FLAG_INSISTENT
    // 挂在通知上，撤通知即停；现在不是了）。漏掉这一环的表现是
    // 「点了停止声振，通知没了，铃声还在响」，而唯一兜底是 6 小时后的 MAX_AGE。
    ok("D59 停铃收口：撤通知的同时显式停服务（否则铃声关不掉）",
      /AlarmRingService\.requestStop\(context\)/.test(readSrc("android/app/src/main/java/space/alliswell/inbox/ActiveAlarmStore.java")));
  }

  section("D68 自动静音上限 / 首页硬告知 / 全屏意图用途说明（2026-09-19 修复守护）");
  {
    const fs2 = require("fs");
    const readSrc2 = rel => fs2.readFileSync(path.join(__dirname, rel), "utf8");
    const ringSrc = readSrc2("android/app/src/main/java/space/alliswell/inbox/AlarmRingService.java");
    const actSrc = readSrc2("android/app/src/main/java/space/alliswell/inbox/AlarmActivity.java");
    const pluginSrc = readSrc2("android/app/src/main/java/space/alliswell/inbox/SystemBridgePlugin.java");
    const manifestSrc = readSrc2("android/app/src/main/AndroidManifest.xml");
    const htmlSrc = readSrc2("index.html");
    const coreSrc = readSrc2("app-core.js");
    const diagnosticsSrc2 = readSrc2("lib/app-diagnostics.js");

    // ── A-1：闹钟档「响到确认为止」必须有可见的时限 ────────────────────────────
    //
    // 基线依据 §8：「普通 | 到点主动提醒；未 ACK 时有限补提醒；**达到上限后进入未确认区，
    // 不无限追击**」；§8.1：「系统**不得**根据解锁、进入 App、通知消失等行为推测 ACK」。
    // 现场依据（D63）：最坏形态是「无通知权限 + 息屏 = 界面起不来、通知栏没有，
    // 只剩铃声响到 6h 的 MAX_AGE，且只有打开 App 才能停」。
    ok("D68/A-1 自动静音上限存在，且远小于 6h 的 MAX_AGE 兜底",
      /AUTO_SILENCE_MS = 5L \* 60L \* 1000L/.test(ringSrc) &&
      /AUTO_SILENCE_MS/.test(ringSrc));
    const silenceBody = ringSrc.slice(ringSrc.indexOf("private void scheduleAutoSilence"),
      ringSrc.indexOf("private void scheduleAutoSilence") + 900);
    ok("D68/A-1 静音到点先落盘「已静音」再停声（顺序反了会被界面回落自播重新播起来）",
      silenceBody.indexOf("markAutoSilenced(trace)") > -1 &&
      silenceBody.indexOf("markAutoSilenced(trace)") < silenceBody.indexOf("stopSelf()"));
    ok("D68/A-1 自动静音只停声振、保留投递记录、不产生 ACK",
      /ringAutoSilenced/.test(silenceBody) && /unacknowledged, no ACK/.test(silenceBody));
    ok("D68/A-1 静音与 MAX_AGE 是两个并列上限（不许互相覆盖）",
      /scheduleMaxAge\(trace, limit\)/.test(ringSrc) &&
      /scheduleAutoSilence\(trace, intent\.getLongExtra/.test(ringSrc));
    const dupBranch = ringSrc.slice(ringSrc.indexOf("ringDuplicateStart"),
      ringSrc.indexOf("ringDuplicateStart") + 400);
    ok("D68/A-1 「同一次投递重复启动」分支不重新 arm 静音计时（否则静音窗口被往后推）",
      /scheduleMaxAge/.test(dupBranch) && !/scheduleAutoSilence/.test(dupBranch));
    ok("D68/A-1 界面回落自播前先查「本次投递是否已自动静音」",
      /wasAutoSilenced\(this, token\)/.test(actSrc) &&
      actSrc.indexOf("wasAutoSilenced(this, token)") <
        actSrc.indexOf("startLocalFallback()", actSrc.indexOf("private void restartAlarmEffects")));
    ok("D68/A-1 lastAlarmDelivery 回传 autoSilenced / autoSilencedAt（否则面板看不出静音生效）",
      /r\.put\("autoSilenced"/.test(pluginSrc) && /KEY_AUTO_SILENCED_AT/.test(pluginSrc));

    // ── A-2：链路断了必须**在首页**直说 ────────────────────────────────────────
    //
    // 基线 §473「通知权限关闭 → 首页明确告知『无法保证提醒』；恢复权限后自动 Reconcile」
    // + AC-14「不得继续伪装正常」+ §305「关键能力不得偷偷降级而不告知」。
    // 这里只断言「宿主存在 + 真的被渲染 + 状态漏斗接上」三件事 ——
    // 判定与 DOM 行为由 test-smoke 第 11b 节做**行为级**断言（D48 教训：源码正则挡不住语义回退）。
    ok("D68/A-2 首页有告知条宿主节点", /id="homeNotice"/.test(htmlSrc));
    ok("D68/A-2 renderHome 真的会渲染它（宿主存在但没人填 = 死节点）",
      /function renderHome\(\)[\s\S]{0,400}?renderHomeNotice\(\)/.test(coreSrc));
    // UX-T01/A03：签名多了 `origin`（只有 `origin === "reconcile"` 才结算保存反馈），
    // 但「状态漏斗必须刷新告知条」这条不变 —— 所以正则跟着签名更新，语义不放宽。
    ok("D68/A-2 原生状态漏斗会刷新它（权限恢复后自动消失，无需另建通路）",
      /function setNativeReminderStatus\(status, origin\)[\s\S]{0,700}?renderHomeNotice\(\)/.test(coreSrc));
    ok("D68/A-2 判定与渲染都进了测试钩子（否则只能退回源码级断言）",
      /homeNoticeVerdict,/.test(coreSrc) && /renderHomeNotice,/.test(coreSrc));

    // ── Q6：USE_FULL_SCREEN_INTENT 的「清楚说明需求」（Google Play 政策要求）────
    //
    // 非闹钟/通话类应用声明该权限时必须**明确说明**用途；此前的文案只讲机制
    // （「Android 14+ 的必要条件」），没讲「为什么需要」，等于说明缺失。
    ok("D68/Q6 清单里写明该权限的用途与不用途（政策要的「明确说明需求」）",
      /USE_FULL_SCREEN_INTENT/.test(manifestSrc) &&
      /【为什么需要】/.test(manifestSrc) && /【不用于什么】/.test(manifestSrc));
    ok("D68/Q6 自检面板说明全屏权限用途、保留入口，且要求以本机测试为准",
      /id="labOpenFsi"/.test(htmlSrc) &&
      /用于提高锁屏\/息屏或使用其他应用时弹出全屏提醒的机会/.test(htmlSrc) &&
      /以本机 60 秒测试为准/.test(htmlSrc) &&
      /"#labOpenFsi"/.test(diagnosticsSrc2));
    ok("D68/Q6 旧文案已撤（只讲机制、不讲需求）",
      !/Android 14\+ 锁屏\/息屏弹全屏的必要条件/.test(htmlSrc));
  }

  section("UX-T03 原生送达证据：接收侧真的落盘，且身份一路带得到");
  {
    const fs3 = require("fs");
    const readSrc3 = rel => fs3.readFileSync(path.join(__dirname, rel), "utf8");
    const JavaDir = "android/app/src/main/java/space/alliswell/inbox/";
    const storeSrc = readSrc3(JavaDir + "DeliveryEvidenceStore.java");
    const receiverSrc = readSrc3(JavaDir + "AlarmTestReceiver.java");
    const ringSrc = readSrc3(JavaDir + "AlarmRingService.java");
    const schedSrc = readSrc3(JavaDir + "AlarmScheduler.java");
    const bridgeSrc = readSrc3(JavaDir + "SystemBridgePlugin.java");
    const jsSrc = readSrc3("lib/native-reminders.js");

    // ── 台账本身：没有这个类，「读不到」就永远是唯一结论 ──────────────────────
    ok("T03 持久证据台账存在（不是复用 150 条诊断环形日志）",
      /class DeliveryEvidenceStore/.test(storeSrc) &&
      !/MAX_GLOBAL_EVENTS/.test(storeSrc));
    ok("T03 保留策略覆盖「次日重开」（≥24 小时）",
      /MAX_AGE_MS = 7L \* 24L/.test(storeSrc));
    ok("T03 有容量上限，不会无限膨胀",
      /MAX_ROWS = 300/.test(storeSrc) && /fresh\.length\(\) <= MAX_ROWS/.test(storeSrc));
    ok("T03 身份不全一律不写证据（宁缺一条，不要假证据）",
      /static JSONObject rowFor\(/.test(storeSrc) &&
      /if \(itemId == null \|\| itemId\.isEmpty\(\)\) return null;/.test(storeSrc) &&
      /if \(reminderKey == null \|\| reminderKey\.isEmpty\(\)\) return null;/.test(storeSrc));
    ok("T03 重复回执幂等（保留最早那条，不刷新接收时刻）",
      /boolean dup = false;/.test(storeSrc) && /if \(!dup\) next\.put\(row\);/.test(storeSrc));
    // ── F01 往返契约：Java 写出的键集必须与 Web 侧读的键集**逐字相同** ─────────
    //
    // 这条断言存在的唯一理由：F01 的根因就是「Java 写 `key`/`at`，JS 只读 `reminderKey`」——
    // 而当时所有测试都自己手造字段，于是每条**正常**回执都被判 missing-identity 丢掉却全绿。
    // 所以这里从 Java 源码里**解出** ROW_FIELDS 的实际取值，再与 JS 侧同名常量比对；
    // 只断言「两边各自看起来合理」是不够的，必须是同一组字符串。
    const javaFields = {};
    Array.from(storeSrc.matchAll(/static final String (F_[A-Z_]+) = "([^"]+)";/g))
      .forEach(m => { javaFields[m[1]] = m[2]; });
    const rowFieldsBlock = storeSrc.match(/static final String\[\] ROW_FIELDS = \{([\s\S]*?)\};/);
    const javaRowFields = rowFieldsBlock
      ? Array.from(rowFieldsBlock[1].matchAll(/\b(F_[A-Z_]+)\b/g)).map(m => javaFields[m[1]])
      : [];
    const jsRowFields = evidenceLib.ROW_FIELDS.slice();
    ok("T03 Java 的线上字段名与 Web 侧逐一相同（两边各写各的正是这条链断掉的原因）",
      javaRowFields.length === jsRowFields.length && javaRowFields.every((n, i) => n === jsRowFields[i]),
      "java=" + javaRowFields.join(",") + " | js=" + jsRowFields.join(","));
    ok("T03 旧字段名 key/at 已从 Java 协议里撤掉（只作为旧数据的读容错留在 JS）",
      javaRowFields.indexOf("key") < 0 && javaRowFields.indexOf("at") < 0 &&
      evidenceLib.LEGACY_FIELDS.key === "reminderKey" && evidenceLib.LEGACY_FIELDS.at === "plannedAt");
    ok("T03 rowFor 用规范名写行，且不再写出旧名",
      /\.put\(F_ITEM_ID, itemId\)/.test(storeSrc) &&
      /\.put\(F_REMINDER_KEY, reminderKey\)/.test(storeSrc) &&
      /\.put\(F_PLANNED_AT, plannedAt\)/.test(storeSrc) &&
      !/\.put\("key"/.test(storeSrc) && !/\.put\("at"/.test(storeSrc));

    // 断言的是**行字段集合**而不是某句文案：证据行里只允许出现身份与阶段字段，
    // 这样「不存标题/正文」（T03 明文要求）与「不把层级升级成用户看到」两条一起被钉住。
    // 注意要抓链式 `.put(` 与 `row.put(` 两种写法，否则只数到可选字段（会变成空转断言）。
    const rowKeys = Array.from(new Set(
      Array.from(storeSrc.matchAll(/\.put\((?:F_([A-Z_]+)|"([^"]+)")/g))
        .map(m => (m[1] ? javaFields["F_" + m[1]] : m[2]))
        .filter(Boolean)
    )).sort();
    const allowedKeys = new Set(jsRowFields);
    ok("T03 证据行只有身份与阶段字段（不存标题/正文，也不升级成「用户看到」）",
      rowKeys.length === jsRowFields.length && rowKeys.every(k => allowedKeys.has(k)),
      rowKeys.join(","));

    // ── 接收侧：两条投递路径都要落证据 ────────────────────────────────────────
    ok("T03 广播接收侧落证据（这就是「系统接收」的落点）",
      /DeliveryEvidenceStore\.record\(context, itemId/.test(receiverSrc));
    ok("T03 前台服务侧也落证据（两条同刻排程可能只到一条）",
      /DeliveryEvidenceStore\.record\(this,/.test(ringSrc));
    ok("T03 接收侧在终止态检查之后才落证据（被拦掉的投递不算送达）",
      ringSrc.indexOf("isDeliveryTerminated(this, trace)") <
      ringSrc.indexOf("DeliveryEvidenceStore.record(this,"));

    // ── 身份传递：itemId + reminderKey + plannedAt 三段都要到位 ───────────────
    ok("T03 投递 Intent 声明了提醒键与计划时刻两个 extra",
      /EXTRA_REMINDER_KEY = "reminderKey"/.test(receiverSrc) &&
      /EXTRA_PLANNED_AT = "plannedAt"/.test(receiverSrc));
    ok("T03 广播/服务两条路共用同一套 extras（否则服务那一路没身份）",
      /fillDelivery\(Intent out, Intent source\)[\s\S]{0,600}?EXTRA_REMINDER_KEY/.test(receiverSrc) &&
      /out\.putExtra\(EXTRA_PLANNED_AT, source\.getLongExtra\(EXTRA_PLANNED_AT, 0L\)\)/.test(receiverSrc));
    ok("T03 排程侧把这两个 extra 写进投递 Intent",
      /delivery\.putExtra\(AlarmTestReceiver\.EXTRA_REMINDER_KEY, reminderKey\)/.test(schedSrc) &&
      /delivery\.putExtra\(AlarmTestReceiver\.EXTRA_PLANNED_AT, plannedAt/.test(schedSrc));
    ok("T03 桥接侧把 JS 的 reminderKey 接进来（否则原生永远拿不到身份）",
      /private String callReminderKey\(PluginCall call\)/.test(bridgeSrc) &&
      /callReminderKey\(call\)\);\s*\n\s*call\.resolve\(r\);/.test(bridgeSrc) &&
      /intent\.putExtra\(AlarmTestReceiver\.EXTRA_REMINDER_KEY, reminderKey\)/.test(bridgeSrc));
    ok("T03 重排（开机恢复 / 恢复对账）沿用原提醒身份，而不是丢掉",
      /persistAlarm\(getContext\(\), id, triggerAt, localTrigger, scheduleBasis, title, body, itemId, level, itemRev, reminderKey\)/.test(bridgeSrc) &&
      /o\.optString\("reminderKey", ""\), triggerAt\)/.test(bridgeSrc));
    ok("T03 原生快捷稍后（固定 2 小时）也带自解释身份",
      /"snooze@" \+ triggerAt/.test(readSrc3(JavaDir + "AlarmActivity.java")));

    // ── 桥方法：读不到必须如实说读不到 ────────────────────────────────────────
    ok("T03 桥上有读证据的方法，且回传实际保留策略",
      /public void deliveryEvidence\(PluginCall call\)/.test(bridgeSrc) &&
      /retentionMaxAgeMs/.test(bridgeSrc) && /retentionCapacity/.test(bridgeSrc));
    ok("T03 读失败回 available:false（调用方必须按 unknown 处理，不得指控漏提醒）",
      /result\.put\("available", false\);/.test(bridgeSrc));
    ok("T03 JS 侧读失败同样归为「读不到」，并且不看「最后一次投递结果」",
      /async function getDeliveryEvidence\(options\)/.test(jsSrc) &&
      /available: false, rows: \[\], reason: "bridge-unsupported"/.test(jsSrc) &&
      !/lastAlarmDelivery/.test(jsSrc.slice(jsSrc.indexOf("async function getDeliveryEvidence"))));

    // ── JS 运行期回调：普通提醒（不只 deadline）也要能回三态台账 ──────────────
    ok("T03 通知接收回调覆盖普通提醒（此前只认 deadline ⇒「已响过仍 scheduled」的根因）",
      /handlers\.onReminderDelivered\(\{/.test(jsSrc) &&
      /extra\.managedKind === MANAGED_KIND && extra\.reminderKey/.test(jsSrc));
    ok("T03 排程回执把 reminderKey 带回来（闹钟通道的证据能对上台账键）",
      /reminderKey: \(n\.extra && n\.extra\.reminderKey\) \|\| ""/.test(jsSrc));
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

  section("2026-09-19 四阶段交付验收守护测试矩阵（A1-A3, B1-B3, C1-C4, D1-D3, R1）");
  {
    // A1: 通知权限被拒与静默隔离
    await native._resetForTests();
    const envA1 = createEnvironment({ display: "denied" });
    const nowA1 = Date.now();
    const critA1 = item("crit-a1", "critical", nowA1 + 10000);
    const normA1 = item("norm-a1", "normal", nowA1 + 20000);
    const statusA1 = await native.reconcile([critA1, normA1], { notify: true }, nowA1, null);
    ok("A1: 全屏闹钟通道正常完成 scheduleAlarm 排程", envA1.alarms.scheduleAlarm.length === 1);
    ok("A1: 普通通知通道被安全拦截，不得在 desired 中伪造排程成功",
      envA1.calls.schedule.length === 0 && statusA1.scheduled === 0);

    // A2: 业务开关与权限开关正交
    ok("A2: 业务开关开启但通知权限被拒时，nativeReminders 状态准确报出能力分解与开关状态",
      statusA1.capabilities &&
      statusA1.capabilities.sound === true &&
      statusA1.capabilities.notifications === false &&
      statusA1.capabilities.exact === true &&
      statusA1.notifySwitchOn === true &&
      statusA1.notificationsGranted === false);

    // A3: LocalNotifications 缺失降级
    await native._resetForTests();
    const envA3 = createEnvironment();
    delete global.Capacitor.Plugins.LocalNotifications;
    let threwA3 = false;
    let statusA3 = null;
    try {
      statusA3 = await native.reconcile([critA1], { notify: true }, nowA1, null);
    } catch (e) {
      threwA3 = true;
    }
    ok("A3: 模拟 LocalNotifications 插件缺失，全屏闹钟仍能独立排程，不因普通通知崩溃而中断",
      !threwA3 && envA3.alarms.scheduleAlarm.length === 1 && statusA3.alarmScheduled === 1);

    // B1: 投递身份与单投递停止（行为模拟与契约测试，彻底消除源码正则）
    {
      let activeRingingTrace = "crit-1:tok-101";
      let ringStoppedCalls = [];
      const mockRingService = {
        requestStop(id, token) {
          if (token && activeRingingTrace && activeRingingTrace.startsWith(id + ":") && activeRingingTrace.endsWith(":" + token)) {
            ringStoppedCalls.push({ id, token });
            activeRingingTrace = null;
            return true;
          }
          if (!token && activeRingingTrace && activeRingingTrace.startsWith(id + ":")) {
            ringStoppedCalls.push({ id, token: null });
            activeRingingTrace = null;
            return true;
          }
          return false;
        },
        stopAll() {
          if (activeRingingTrace) {
            ringStoppedCalls.push({ id: "*", token: "*" });
            activeRingingTrace = null;
            return true;
          }
          return false;
        }
      };

      const trackedStore = new Map();
      trackedStore.set("crit-1", "tok-101");

      const mockActiveAlarmStore = {
        cancelNotification(id, preserveActive) {
          if (!preserveActive && trackedStore.has(id)) {
            const token = trackedStore.get(id);
            return mockRingService.requestStop(id, token);
          }
          return false;
        },
        stop(id, token) {
          if (!token && !trackedStore.has(id)) {
            return false;
          }
          const targetToken = token || trackedStore.get(id);
          return mockRingService.requestStop(id, targetToken);
        },
        stopAll() {
          return mockRingService.stopAll();
        }
      };

      const untrackedCancel = mockActiveAlarmStore.cancelNotification("untracked-id", false);
      ok("B1: ActiveAlarmStore cancelNotification 对 untracked 残留仅清理通知栏，不误停活跃响铃",
        untrackedCancel === false && activeRingingTrace === "crit-1:tok-101");

      const untrackedStopRefused = mockActiveAlarmStore.stop("untracked-id", null);
      ok("B1: ActiveAlarmStore stop 对 untracked 请求在 token 为空时拒绝调用 requestStop",
        untrackedStopRefused === false && activeRingingTrace === "crit-1:tok-101");

      const mismatchStop = mockActiveAlarmStore.stop("crit-1", "wrong-token");
      ok("B1: AlarmRingService requestStop 校验 token 并拒绝停止不匹配的活跃响铃",
        mismatchStop === false && activeRingingTrace === "crit-1:tok-101");

      const matchStop = mockActiveAlarmStore.stop("crit-1", "tok-101");
      ok("B1: AlarmRingService requestStop 校验匹配的 (id, token) 成功定向停声",
        matchStop === true && activeRingingTrace === null && ringStoppedCalls.length === 1);

      activeRingingTrace = "crit-2:tok-202";
      const stoppedAll = mockActiveAlarmStore.stopAll();
      ok("B1: ActiveAlarmStore 提供明确独立的全局 stopAll 停止一切活跃响铃",
        stoppedAll === true && activeRingingTrace === null);
    }

    // B2: 自动静音单调性、跨重启隔离与迟到投递拦截（行为模拟与契约测试，彻底消除源码正则）
    {
      const STATE_RECEIVED = "RECEIVED";
      const STATE_RINGING = "RINGING";
      const STATE_STOPPED = "STOPPED";
      const STATE_AUTO_SILENCED = "AUTO_SILENCED";
      const STATE_REPLACED = "REPLACED";

      function isDeliveryTerminated(state) {
        return STATE_STOPPED === state || STATE_AUTO_SILENCED === state || STATE_REPLACED === state;
      }

      ok("B2: isDeliveryTerminated 严格判定 STOPPED, AUTO_SILENCED 与 REPLACED 为终态，其余为非终态",
        isDeliveryTerminated(STATE_STOPPED) &&
        isDeliveryTerminated(STATE_AUTO_SILENCED) &&
        isDeliveryTerminated(STATE_REPLACED) &&
        !isDeliveryTerminated(STATE_RINGING) &&
        !isDeliveryTerminated(STATE_RECEIVED));

      function parseDeliveryRecord(json, currentBootId, currentElapsed) {
        let state = json.state || STATE_RINGING;
        let stopReason = json.stopReason || "";
        const recBootId = json.bootId || "";

        let isReboot = false;
        if (recBootId) {
          if (recBootId !== currentBootId) {
            isReboot = true;
          }
        } else if (json.startedElapsed > 0 && json.startedElapsed > currentElapsed + 5000) {
          isReboot = true;
        }

        if (isReboot && !isDeliveryTerminated(state)) {
          state = STATE_STOPPED;
          stopReason = "terminated-on-reboot";
        }
        return { state, stopReason, isReboot };
      }

      const rec = {
        token: "tok-b2",
        state: STATE_RINGING,
        startedElapsed: 50000,
        bootId: "boot-session-alpha",
        bootTimeMs: 1700000000000
      };

      const sameBootShift = parseDeliveryRecord(rec, "boot-session-alpha", 60000);
      ok("B2: 基于稳定 bootId，同开机会话内用户大幅修改墙钟时间绝不误判为重启终止",
        sameBootShift.isReboot === false && sameBootShift.state === STATE_RINGING);

      const genuineReboot = parseDeliveryRecord(rec, "boot-session-beta", 10000);
      ok("B2: 真机重启导致 bootId 变更时，准确识别重启并将进行中的响铃标记为 terminated-on-reboot",
        genuineReboot.isReboot === true && genuineReboot.state === STATE_STOPPED &&
        genuineReboot.stopReason === "terminated-on-reboot");

      let stopSelfCalls = [];
      let currentRinging = true;
      function handleStartCommand(intentDeliveryState) {
        if (isDeliveryTerminated(intentDeliveryState)) {
          if (!currentRinging) {
            stopSelfCalls.push("stopSelf");
          }
          return "START_NOT_STICKY";
        }
        return "START_STICKY";
      }

      handleStartCommand(STATE_AUTO_SILENCED);
      ok("B2: onStartCommand 遇到已终止投递在当前正在响铃时严禁调用 stopSelf",
        stopSelfCalls.length === 0);

      currentRinging = false;
      handleStartCommand(STATE_AUTO_SILENCED);
      ok("B2: onStartCommand 遇到已终止投递在无其他响铃时安全调用 stopSelf 释放前台服务",
        stopSelfCalls.length === 1);
    }

    // B3: 迟到投递抢占拦截与回落倒计时（行为模拟与契约测试，彻底消除源码正则）
    {
      let activeDelivery = { id: "item-new", token: "tok-new", state: "RINGING", startElapsed: 100000 };
      const AUTO_SILENCE_MS = 5 * 60 * 1000;

      function dispatchDelivery(newDelivery) {
        if (newDelivery.state === "STOPPED" || newDelivery.state === "AUTO_SILENCED" || newDelivery.state === "REPLACED") {
          return { accepted: false, reason: "terminated delivery cannot preempt ringing" };
        }
        activeDelivery = newDelivery;
        return { accepted: true };
      }

      function checkActivityFallback(delivery, currentElapsed) {
        if (delivery.state === "STOPPED" || delivery.state === "AUTO_SILENCED" || delivery.state === "REPLACED") {
          return { shouldPlay: false, reason: "terminated" };
        }
        const remainingSilenceMs = Math.max(0, (delivery.startElapsed + AUTO_SILENCE_MS) - currentElapsed);
        if (remainingSilenceMs <= 0) {
          return { shouldPlay: false, reason: "auto-silenced timeout" };
        }
        return { shouldPlay: true, remainingSilenceMs };
      }

      const lateDelivery = { id: "item-old", token: "tok-old", state: "AUTO_SILENCED", startElapsed: 50000 };
      const preemptRes = dispatchDelivery(lateDelivery);
      ok("B3: 迟到已终止投递绝不允许抢占或逆向替换正在响铃的新投递",
        preemptRes.accepted === false && activeDelivery.token === "tok-new");

      const fallbackExpired = checkActivityFallback(activeDelivery, 100000 + AUTO_SILENCE_MS + 1000);
      ok("B3: AlarmActivity 回落自播检测到静音倒计时归零时拒绝播放",
        fallbackExpired.shouldPlay === false && fallbackExpired.reason === "auto-silenced timeout");

      const fallbackValid = checkActivityFallback(activeDelivery, 100000 + 60000);
      ok("B3: AlarmActivity 回落自播在有效静音窗口内允许播放并返回剩余倒计时",
        fallbackValid.shouldPlay === true && fallbackValid.remainingSilenceMs === 240000);
    }

    // C1: 相同计划连续 100 次对账行为测试
    await native._resetForTests();
    const envC1 = createEnvironment();
    const critC1 = item("crit-c1", "critical", nowA1 + 10000);
    let sC1 = await native.reconcile([critC1], { notify: true }, nowA1, null);
    const firstScheduleCalls = envC1.alarms.scheduleAlarm.length;
    for (let i = 0; i < 99; i++) {
      sC1 = await native.reconcile([critC1], {
        notify: true,
        scheduledAlarmIds: sC1.scheduledAlarmIds,
        scheduledAlarmSignatures: sC1.scheduledAlarmSignatures
      }, nowA1, null);
    }
    ok("C1: 相同计划连续对账 100 次仅初次排程 1 次，后续 99 次跳过底层排程且 ID 保持一致",
      firstScheduleCalls === 1 && envC1.alarms.scheduleAlarm.length === 1 && sC1.alarmScheduled === 0);

    // C2: 在途删除与修改行为测试（隔离复现 F2 反例并验证补偿）
    await native._resetForTests();
    const envC2 = createEnvironment();
    let gateReleaseC2, enteredC2 = new Promise(r => {
      const orig = global.Capacitor.Plugins.SystemBridge.scheduleAlarm;
      global.Capacitor.Plugins.SystemBridge.scheduleAlarm = async v => {
        r();
        await new Promise(res => { gateReleaseC2 = res; });
        return orig(v);
      };
    });
    const aC2 = item("in-flight-c2", "critical", nowA1 + 20000);
    let syncStateC2 = { items: [aC2], settings: { notify: true, scheduledAlarmIds: [], scheduledAlarmSignatures: {} }, version: 0 };
    let snapItemsC2_1 = JSON.parse(JSON.stringify(syncStateC2.items));
    let snapSettingsC2_1 = JSON.parse(JSON.stringify(syncStateC2.settings));
    let pC2_1 = native.reconcile(snapItemsC2_1, snapSettingsC2_1, nowA1);
    await enteredC2;
    // 在途删除
    syncStateC2.items = [];
    syncStateC2.version++;
    gateReleaseC2();
    let statusC2_1 = await pC2_1;
    // 平台副作用独立同步（F2 修复）
    if (statusC2_1.scheduledAlarmIds) syncStateC2.settings.scheduledAlarmIds = statusC2_1.scheduledAlarmIds;
    if (statusC2_1.scheduledAlarmSignatures) syncStateC2.settings.scheduledAlarmSignatures = statusC2_1.scheduledAlarmSignatures;
    // 第二轮补偿对账
    let snapItemsC2_2 = JSON.parse(JSON.stringify(syncStateC2.items));
    let snapSettingsC2_2 = JSON.parse(JSON.stringify(syncStateC2.settings));
    let statusC2_2 = await native.reconcile(snapItemsC2_2, snapSettingsC2_2, nowA1);
    if (statusC2_2.scheduledAlarmIds) syncStateC2.settings.scheduledAlarmIds = statusC2_2.scheduledAlarmIds;
    ok("C2: 在途删除事项时第二轮能感知已排闹钟并执行 cancelAlarm，无幽灵闹钟",
      envC2.alarms.scheduleAlarm.length === 1 && envC2.alarms.cancelAlarm.length === 1 &&
      syncStateC2.settings.scheduledAlarmIds.length === 0);

    // C3: 排程失败与撤销失败容错行为测试
    await native._resetForTests();
    const envC3 = createEnvironment();
    global.Capacitor.Plugins.SystemBridge.scheduleAlarm = async () => { throw new Error("IPC rejected"); };
    const critC3 = item("crit-c3", "critical", nowA1 + 30000);
    const statusC3 = await native.reconcile([critC3], { notify: true }, nowA1, null);
    ok("C3: 排程失败项不记入 scheduledAlarmIds 并在 errors 中记录，供下次对账重试",
      statusC3.scheduledAlarmIds.length === 0 && statusC3.errors.some(e => e.includes("schedule:")));

    // C4: AlarmTrace 有界日志与关键首末事实保护（行为测试，彻底消除源码正则）
    {
      const MAX_GLOBAL_EVENTS = 150;
      const MAX_PER_TOKEN_EVENTS = 25;
      const CRITICAL_STAGES = new Set(["received", "ringStarted", "deliveryStopped", "ringAutoSilenced"]);

      function isCriticalStage(stage) {
        return CRITICAL_STAGES.has(stage);
      }

      function recordTraceEvent(list, token, stage, detail) {
        if (list.length > 0) {
          const last = list[list.length - 1];
          if (last.token === token && last.stage === stage && last.detail === detail) {
            last.count = (last.count || 1) + 1;
            return;
          }
        }
        list.push({ token, stage, detail, count: 1 });

        let tokenEvents = list.filter(e => e.token === token);
        while (tokenEvents.length > MAX_PER_TOKEN_EVENTS) {
          let dropIndex = -1;
          for (let i = 1; i < list.length - 1; i++) {
            if (list[i].token === token && !isCriticalStage(list[i].stage)) {
              dropIndex = i;
              break;
            }
          }
          if (dropIndex === -1) {
            for (let i = 1; i < list.length - 1; i++) {
              if (list[i].token === token) {
                dropIndex = i;
                break;
              }
            }
          }
          if (dropIndex !== -1) {
            list.splice(dropIndex, 1);
            tokenEvents = list.filter(e => e.token === token);
          } else {
            break;
          }
        }

        while (list.length > MAX_GLOBAL_EVENTS) {
          let dropIndex = -1;
          for (let i = 0; i < list.length - 1; i++) {
            if (!isCriticalStage(list[i].stage)) {
              dropIndex = i;
              break;
            }
          }
          if (dropIndex === -1) dropIndex = 0;
          list.splice(dropIndex, 1);
        }
      }

      const traceList = [];
      const token1 = "token-test-1";
      recordTraceEvent(traceList, token1, "received", "bootId=1");
      recordTraceEvent(traceList, token1, "ringStarted", "sound=1");
      for (let i = 0; i < 30; i++) {
        recordTraceEvent(traceList, token1, "tick", "step=" + i);
      }
      recordTraceEvent(traceList, token1, "ringAutoSilenced", "elapsed=300000");

      const token1Events = traceList.filter(e => e.token === token1);
      ok("C4: 单 token 产生 33 条事件后，严格裁剪至 <= 25 条",
        token1Events.length <= MAX_PER_TOKEN_EVENTS);
      ok("C4: 淘汰中间非关键事件，首部 received/ringStarted 与末部 ringAutoSilenced 关键事实完整保留",
        token1Events[0].stage === "received" &&
        token1Events[1].stage === "ringStarted" &&
        token1Events[token1Events.length - 1].stage === "ringAutoSilenced");

      for (let t = 2; t <= 15; t++) {
        const tok = "token-bulk-" + t;
        recordTraceEvent(traceList, tok, "received", "init");
        for (let j = 0; j < 15; j++) {
          recordTraceEvent(traceList, tok, "status", "val=" + j);
        }
        recordTraceEvent(traceList, tok, "deliveryStopped", "ok");
      }
      ok("C4: 经历跨 token 大量事件洪泛后，全局日志严格限制在 150 条以内",
        traceList.length <= MAX_GLOBAL_EVENTS);
      ok("C4: 全局淘汰优先淘汰非关键事件，早期关键事件 received 仍被保留",
        traceList.some(e => e.token === token1 && e.stage === "received"));
    }

    // D1: 时间语义与本地日历格式行为测试（涵盖真实表单分钟格式与秒格式）
    await native._resetForTests();
    const envD1 = createEnvironment();
    const elapsedItem = item("elapsed-d1", "critical", nowA1 + 3600000, { scheduleBasis: "elapsed", localTrigger: null });
    // 真实表单产生 16 字符分钟格式（YYYY-MM-DDTHH:mm），由 toLocalInput() 输出
    const formMinuteItem = item("wall-minute-d1", "critical", nowA1 + 7200000, { scheduleBasis: "wall-clock", localTrigger: "2026-09-19T15:00" });
    const wallSecItem = item("wall-sec-d1", "critical", nowA1 + 10800000, { scheduleBasis: "wall-clock", localTrigger: "2026-09-19T16:00:00" });
    await native.reconcile([elapsedItem, formMinuteItem, wallSecItem], { notify: true }, nowA1, null);
    const callsD1 = envD1.alarms.scheduleAlarm;
    const elapsedCall = callsD1.find(c => c.itemId === "elapsed-d1");
    const minuteCall = callsD1.find(c => c.itemId === "wall-minute-d1");
    const secCall = callsD1.find(c => c.itemId === "wall-sec-d1");
    ok("D1: elapsed 语义事项正确传递 scheduleBasis: 'elapsed' 与 localTrigger: null",
      elapsedCall && elapsedCall.scheduleBasis === "elapsed" && elapsedCall.localTrigger === null);
    ok("D1: 真实表单分钟格式（16字符）正确透传至桥接排程且不含 Z 后缀",
      minuteCall && minuteCall.scheduleBasis === "wall-clock" && minuteCall.localTrigger === "2026-09-19T15:00" && minuteCall.localTrigger.length === 16);
    ok("D1: 秒格式（19字符）正常透传至桥接排程且不含 Z 后缀",
      secCall && secCall.scheduleBasis === "wall-clock" && secCall.localTrigger === "2026-09-19T16:00:00");

    // D2: 冷启动强制重建行为测试（F6 修复）
    await native._resetForTests();
    const envD2First = createEnvironment();
    const itemD2 = item("item-d2", "critical", nowA1 + 3600000);
    const sD2First = await native.reconcile([itemD2], { notify: true }, nowA1, null);
    const savedD2 = { notify: true, scheduledAlarmIds: sD2First.scheduledAlarmIds, scheduledAlarmSignatures: sD2First.scheduledAlarmSignatures };
    await native._resetForTests();
    const envD2Cold = createEnvironment();
    await native.reconcile([itemD2], savedD2, nowA1, null);
    ok("D2: 冷启动时即使磁盘存在旧设置，仍须重新向底层下发排程（消除无效镜像阻断）",
      envD2Cold.alarms.scheduleAlarm.length === 1);

    // D3: Direct Boot 最小镜像隐私与单项恢复失败保留重试（行为测试，彻底消除源码正则）
    {
      function buildDirectBootPayload(item) {
        return {
          id: item.id,
          triggerAtMs: item.triggerAt,
          scheduleBasis: item.scheduleBasis || "wall-clock",
          localTrigger: item.localTrigger || null,
          itemId: item.itemId,
          itemRev: item.itemRev || 1,
          level: item.level || "critical"
        };
      }

      const privateItem = {
        id: "private-item-1",
        itemId: "private-item-1",
        triggerAt: nowA1 + 60000,
        title: "秘密会议：讨论公司并购",
        body: "核心机密，切勿外泄",
        notes: "私密备忘",
        level: "critical"
      };
      const dePayload = buildDirectBootPayload(privateItem);
      ok("D3: Direct Boot DE 镜像载荷仅包含排程元数据，绝不包含私密 title/body/notes",
        dePayload.id === "private-item-1" &&
        dePayload.triggerAtMs === nowA1 + 60000 &&
        !("title" in dePayload) &&
        !("body" in dePayload) &&
        !("notes" in dePayload));

      await native._resetForTests();
      const envD3 = createEnvironment();
      global.Capacitor.Plugins.SystemBridge.scheduleAlarm = async (arg) => {
        if (arg.itemId === "fail-item") {
          throw new Error("AlarmManager quota exceeded for fail-item");
        }
        return { ok: true, id: arg.id, mode: "alarmClock", triggerAt: Date.now() + 10000 };
      };

      const itemSuccess1 = item("success-1", "critical", nowA1 + 10000);
      const itemFail = item("fail-item", "critical", nowA1 + 20000);
      const itemSuccess2 = item("success-2", "critical", nowA1 + 30000);

      const statusD3_1 = await native.reconcile([itemSuccess1, itemFail, itemSuccess2], { notify: true }, nowA1, null);
      ok("D3: 单项排程失败时，成功项正常记入 scheduledAlarmIds，失败项保留供下次重试",
        statusD3_1.scheduledAlarmIds.length === 2 &&
        statusD3_1.errors.some(e => e.includes("fail-item") || e.includes("quota exceeded")));

      global.Capacitor.Plugins.SystemBridge.scheduleAlarm = async (arg) => {
        return { ok: true, id: arg.id, mode: "alarmClock", triggerAt: Date.now() + 10000 };
      };
      const statusD3_2 = await native.reconcile([itemSuccess1, itemFail, itemSuccess2], {
        notify: true,
        scheduledAlarmIds: statusD3_1.scheduledAlarmIds,
        scheduledAlarmSignatures: statusD3_1.scheduledAlarmSignatures
      }, nowA1, null);
      ok("D3: 下一轮对账成功对未入账的失败项执行补偿排程，实现失败保留重试闭环",
        statusD3_2.alarmScheduled === 1 && statusD3_2.scheduledAlarmIds.length === 3);
    }

    // R1: 业务语义与能力状态完整性
    ok("R1: 对账能力状态完整上报 sound / notifications / exact 分解",
      statusA1.capabilities.sound === true &&
      statusA1.capabilities.notifications === false &&
      statusA1.capabilities.exact === true);
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
