/* UX-T01 / UX-T02 / UX-A01 — 保存结果、排程结果与动作语义的纯逻辑层 — UMD
 *
 * 为什么单独成模块：这三个判断都要能被**行为级断言**（不许再用源码正则）。
 * app-core 只负责把真实状态喂进来、把结论渲染出去，判定本身全在这里。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.AttentionLib = root.AttentionLib || {};
    // 具名命名空间：顶层平铺会与其它 lib 模块（fmtClock 等）撞名
    root.AttentionLib.Feedback = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** UX-C03 / UX-A03：撤销窗口建议值（8 秒）。 */
  const UNDO_WINDOW_MS = 8000;

  /**
   * 保存结果 —— 与排程结果**分开**的两件事。
   *
   * 语义固定，文案可微调。`kind` 是给渲染/测试用的稳定标识。
   */
  const SAVE_KINDS = {
    PENDING: "saving",              // 保存中有反馈
    CONFIRMED: "saved",             // 权威持久化已确认
    DEGRADED: "degraded",           // 可恢复降级保存：按实际保障程度提示
    FAILED: "failed"                // 完全失败：不伪装成功，保留草稿
  };

  /**
   * 排程/提醒状态 —— 必须回答「当前这一条、当前这个版本、当前这个载体」落到了哪一步。
   *
   * 全局状态正常**不能**证明刚保存的这一条已排成功，所以判定只吃本条目的证据。
   */
  const REMINDER_KINDS = {
    SCHEDULED: "scheduled",
    UNKNOWN: "unknown",
    PERMISSION_DENIED: "permission-denied",
    ALARM_LIMITED: "alarm-limited",
    INEXACT: "inexact",
    SWITCH_OFF: "switch-off",
    ERROR: "error",
    NO_TIME: "no-time",
    WEB: "web"                        // Web/PWA：没有可靠后台能力
  };

  const SAVE_TEXT = {
    saving: { text: "正在保存…", actionLabel: "", actionKind: "" },
    failed: { text: "未能保存 · 内容还在，可重试", actionLabel: "重试", actionKind: "retry-save" },
    degraded: { text: "已保存（受限模式）· 本机存储不可用，已另存待恢复", actionLabel: "", actionKind: "" }
  };

  /**
   * 保存反馈。
   *
   * @param {"saving"|"confirmed"|"failed"|"degraded"} persistence
   * @returns {{kind:string,text:string,actionLabel:string,actionKind:string}}
   */
  function saveFeedback(persistence) {
    const base = SAVE_TEXT[persistence] || SAVE_TEXT.saving;
    return {
      kind: persistence || "saving",
      text: base.text,
      actionLabel: base.actionLabel,
      actionKind: base.actionKind
    };
  }

  function fmtClock(ts) {
    const d = new Date(Number(ts));
    if (!Number.isFinite(d.getTime())) return "";
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
    const sameDay = d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (sameDay) return "今天 " + hm;
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (d.getFullYear() === tomorrow.getFullYear() &&
      d.getMonth() === tomorrow.getMonth() && d.getDate() === tomorrow.getDate()) {
      return "明天 " + hm;
    }
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + hm;
  }

  /**
   * 保存之后，「提醒准备到了哪一步」。
   *
   * 关键纪律（D70 前置核验）：
   *  · 不得用「scheduled 且时间已过」推断漏提醒 — 本函数从不产出「漏提醒」这一结论；
   *  · 不得把「通知入栏」说成用户看到，也不得把「能力受限」说成「完全不响」；
   *  · 没有明确事项时间的记录，不许暴露兜底时间为事项承诺。
   *
   * @param {object} ctx
   *   ctx.persistence  "confirmed" | "degraded" | "failed"
   *   ctx.item         { hasTrigger, isFallbackTrigger, priority, deliveryMode, repeat, deadlineAt, triggerAt }
   *   ctx.native       { isNative, bridgeReady, notifySwitch, notifications, exactAlarm,
   *                      reliability, capabilities, alarmCount, alarmScheduled, scheduledIds }
   *   ctx.itemScheduled true / false / null(未知)
   */
  function reminderFeedback(ctx) {
    ctx = ctx || {};
    const persistence = ctx.persistence || "confirmed";
    const item = ctx.item || null;
    const native = ctx.native || null;

    // 1) 保存本身没落库：先说实话，谈不到排程
    if (persistence === "failed") {
      return verdict(REMINDER_KINDS.ERROR, "未保存成功 · 提醒未安排", "重试", "retry-save", "saved");
    }
    if (persistence === "degraded") {
      return verdict(REMINDER_KINDS.UNKNOWN, "已降级保存 · 提醒安排尚未确认", "查看状态", "open-status", "saved");
    }

    // 2) 没有明确事项时间：不许冒充已安排（UX-T01 第 8 行 / UX-C02）
    const hasTime = !!(item && item.hasTrigger) && !(item && item.isFallbackTrigger);
    if (item && !hasTime) {
      // F08：文案同时保留「待整理」与「本次可撤销」。此前保存路径在这条结论之后
      // 又补发一条不带撤销的提示，把刚生成的撤销入口顶掉了（无时间的记录永远没有撤销）。
      return verdict(REMINDER_KINDS.NO_TIME, "已收下 · 待整理", "去整理", "open-review", "saved");
    }

    const prefix = "已保存，";

    // 3) 非原生运行环境：不显示 Android 的就绪结论
    if (!native || !native.isNative) {
      return verdict(REMINDER_KINDS.WEB, prefix + "本页关闭后不会有提醒", "了解", "explain-web", "info");
    }

    // 4) 业务总开关关闭：不擅自替用户开启
    if (!native.notifySwitch) {
      return verdict(REMINDER_KINDS.SWITCH_OFF, prefix + "提醒已关闭", "查看设置", "open-settings", "warn");
    }

    // 5) 排程失败：有真实的失败证据
    if (native.reliability === "error") {
      return verdict(REMINDER_KINDS.ERROR, prefix + "提醒安排失败", "重试", "retry-schedule", "error");
    }

    // 6) 桥未就绪：结果未知（不是失败）
    if (!native.bridgeReady) {
      return verdict(REMINDER_KINDS.UNKNOWN, prefix + "提醒安排尚未确认", "查看状态", "open-status", "info");
    }

    const denied = native.notifications === "denied";
    const alarmChannel = ctx.itemScheduled === true &&
      native.alarmCount > 0 && native.alarmScheduled > 0;

    // 7) 通知权限被拒 + 这一条走通知通道 ⇒ 通知不会出现
    if (denied && !alarmChannel) {
      // 闹钟通道本来就不用通知权限（D59：声振由服务自播）—— 区分两种受限形态
      if (ctx.itemScheduled === true) {
        return verdict(REMINDER_KINDS.ALARM_LIMITED,
          "已安排提醒，但通知权限未开启 · 通知与屏幕会受限", "查看设置", "open-settings", "warn");
      }
      return verdict(REMINDER_KINDS.PERMISSION_DENIED,
        prefix + "通知权限未开启", "去设置", "open-settings", "warn");
    }

    // 8) 闹钟可排但通知/屏幕能力受限 —— 明确不误称「完全不响」
    const caps = native.capabilities || {};
    if (alarmChannel && (caps.notifications === false || caps.screen === false)) {
      return verdict(REMINDER_KINDS.ALARM_LIMITED,
        "已安排闹钟，通知显示受限", "查看设置", "open-settings", "warn");
    }

    // 9) 只能非精确排程 ⇒ 可能延迟
    if (native.exactAlarm === "denied" && !alarmChannel) {
      return verdict(REMINDER_KINDS.INEXACT, prefix + "提醒可能延迟", "查看设置", "open-settings", "warn");
    }

    // 10) 本条已获真实确认（只认本案证据，不认全局）
    if (ctx.itemScheduled === true) {
      const when = item && item.triggerAt ? fmtClock(item.triggerAt) : "";
      return verdict(REMINDER_KINDS.SCHEDULED,
        "已保存，计划" + (when ? when + " 提醒" : "按设定时间提醒"), "查看", "open-item", "ok");
    }

    // 11) 余下：正在排程 / 结果未知。宁可未知，也不编造已安排或已漏。
    return verdict(REMINDER_KINDS.UNKNOWN, prefix + "提醒安排尚未确认", "查看状态", "open-status", "info");
  }

  function verdict(kind, text, actionLabel, actionKind, tone) {
    return {
      kind: kind,
      text: text,
      actionLabel: actionLabel || "",
      actionKind: actionKind || "",
      tone: tone || "info"
    };
  }

  /* ---------- UX-A01：同一动作在不同入口含义一致 ---------- */

  /**
   * 四个动作的固定语义。
   *
   * `ack` 的说明**不得**承诺「以后不再提醒」（截止保护与 ACK 周期仍会回来）。
   */
  function actionSpec(name, opts) {
    opts = opts || {};
    switch (name) {
      case "ack":
        return {
          name: "ack",
          label: "我知道了",
          sub: "停止本轮催促 · 仍未完成",
          firstTimeText: "已停止本轮催促，这件事仍未完成",
          firstTimeAction: "稍后提醒"
        };
      case "snooze":
        return {
          name: "snooze",
          label: "稍后提醒",
          sub: opts.when ? "改到 " + fmtClock(opts.when) : "重新安排下一次提醒",
          nativeLabel: "稍后提醒",
          nativeSub: "2 小时后"
        };
      case "done":
        return {
          name: "done",
          label: "完成",
          sub: opts.hasRepeat ? "结束本件 · " + (opts.nextText || "并生成下一周期") : "结束本件并归档",
          undoLabel: "撤销",
          undoText: opts.hasRepeat ? "已完成 · 下一周期已生成" : "已完成并归档",
          undoWindowMs: UNDO_WINDOW_MS
        };
      case "stop":
        return {
          name: "stop",
          label: "关闭铃声",
          sub: "只停止当前声音与界面",
          notAck: true
        };
      default:
        return { name: name, label: name, sub: "" };
    }
  }

  /**
   * 用户可见术语 ⇒ 中文用途说明。
   *
   * **只改用户看得见的文案**，内部状态名与 API 一律不动（UX-A01 末条）。
   */
  const JARGON = [
    [/\bACK\b/g, "我知道了"],
    [/\bAcknowledge\b/g, "我知道了"],
    [/\bCapture\b/g, "记下"],
    [/\bNEEDS_REVIEW\b/g, "待整理"],
    [/\bReview Window\b/g, "待整理时间"],
    [/\bFuture\b/g, "未来"],
    [/\breconcile\b/g, "对账"],
    [/\btoken\b/g, "标识"]
  ];

  function humanize(text) {
    if (typeof text !== "string") return text;
    let out = text;
    JARGON.forEach(([re, to]) => { out = out.replace(re, to); });
    return out;
  }

  /* ---------- UX-C02：识别摘要 ---------- */

  /**
   * 识别摘要必须显示**有效提醒时间**，以及会影响行为的周期/截止。
   *
   * 解析出来的周期不许藏起来 —— 否则用户以为建了一条一次性的记录，
   * 实际上每两周都会回来一次。
   */
  function captureSummary(input) {
    input = input || {};
    const parts = [];
    if (input.triggerAt) parts.push("提醒 " + fmtClock(input.triggerAt));
    if (input.repeatText) parts.push(input.repeatText);
    if (input.deadlineAt) parts.push("截止 " + fmtClock(input.deadlineAt));
    if (input.priorityLabel) parts.push(input.priorityLabel);
    if (!parts.length) {
      return { empty: true, text: "还没有时间 · 会先记下，之后请你在待整理里补上" };
    }
    return { empty: false, text: parts.join(" · ") };
  }

  /** UX-T02：60 秒测试的用户反馈 —— 与系统事件证据分列，未回答既不是失败也不是成功。 */
  const TEST_FEEDBACK = [
    { value: "heard", label: "我听到了" },
    { value: "seen", label: "我看到了" },
    { value: "missed", label: "没收到" },
    { value: "unsure", label: "不确定" }
  ];

  function testFeedbackVerdict(value) {
    switch (value) {
      case "heard": return { ok: true, text: "这次听到了" };
      case "seen": return { ok: true, text: "这次看到了" };
      case "missed": return { ok: false, text: "这次没有收到 · 按下面步骤再看一次" };
      case "unsure": return { ok: null, text: "这次结果不确定 · 不算失败，可以再测一次" };
      default: return { ok: null, text: "还没有你的反馈（未回答不等于失败）" };
    }
  }

  /**
   * UX-T02：首用引导的下一步（渐进、一屏一个主要动作）。
   *
   * @param native 能力状态
   * @param ctx    {testRun, testFeedback}
   *   F07：测试步骤的完成状态**由本次运行决定**。此前这里恒为 `done: false`，
   *   于是「测试过没有」在界面上永远答不出来，也没有「重测」这个状态。
   *   判定只看本次运行自己的事实：你手动停过 / 系统侧看到了本次投递 / 你作答了。
   *   未作答既不算完成也不算失败 —— 它只是还没有结论。
   */
  function setupSteps(native, ctx) {
    native = native || {};
    ctx = ctx || {};
    const run = ctx.testRun && typeof ctx.testRun === "object" ? ctx.testRun : null;
    const feedback = ctx.testFeedback && typeof ctx.testFeedback === "object" ? ctx.testFeedback : null;
    const feedbackBelongsToRun = !!(run && feedback &&
      Number(feedback.at || 0) >= Number(run.startedAt || 0));
    const testDone = !!(run && (run.stoppedAt || run.seenAt || run.feedbackAt || feedbackBelongsToRun));
    const testVerified = !!(run && (run.seenAt || (feedbackBelongsToRun &&
      (feedback.value === "heard" || feedback.value === "seen"))));
    const backgroundVerified = native.ignoringBatteryOptimizations === true;
    const overlayVerified = native.overlay === "granted" && native.fullScreenIntent === "granted";
    const steps = [];
    steps.push({
      id: "notify",
      done: native.notifications === "granted",
      verified: native.notifications === "granted",
      title: "允许发通知",
      why: "没有通知权限，提醒不会出现在通知栏，屏幕也不会亮。",
      denyImpact: "拒绝后仍可以记录事项，但关掉应用后看不到提醒。",
      action: "去授权"
    });
    steps.push({
      id: "exact",
      done: native.exactAlarm === "granted",
      verified: native.exactAlarm === "granted",
      title: "允许精确提醒",
      why: "没有它，系统会把提醒推迟到它觉得合适的时候。",
      denyImpact: "拒绝后提醒可能晚几分钟到几十分钟。",
      action: "去授权"
    });
    steps.push({
      id: "background",
      // 厂商后台/自启动开关通常无法可靠回读。visited 只表示用户已经打开过
      // 设置入口，用于推进向导；verified 只接受系统能读到的能力状态。
      done: !!(ctx.backgroundVisited || backgroundVerified),
      verified: backgroundVerified,
      title: "允许完全后台运行 (防冻结)",
      why: "部分 Android 厂商可能限制长时间后台运行；实际效果取决于系统设置，并需通过锁屏测试确认。",
      denyImpact: "拒绝或跳过可能导致熄屏较长时间后提醒延迟；是否生效以本机测试为准。",
      action: "去设置"
    });
    steps.push({
      id: "overlay",
      done: !!(ctx.overlayVisited || overlayVerified),
      verified: overlayVerified,
      title: "允许锁屏弹窗与悬浮窗",
      why: "用于提高锁屏或使用其他应用时亮屏弹出全屏提醒界面的机会。",
      denyImpact: "拒绝后可能只显示通知、延迟显示或不弹全屏；以本机 60 秒测试为准。",
      action: "去开启"
    });
    steps.push({
      id: "test",
      done: testDone,
      verified: testVerified,
      title: testDone ? "60 秒测试已有结果" : "做一次 60 秒测试",
      why: "确认这台设备上声音、屏幕、通知各自落在哪里。",
      denyImpact: "跳过也能用，只是不知道实际效果。",
      action: testDone ? "再测一次" : "开始测试"
    });
    const next = steps.find(s => !s.done) || null;
    return { steps: steps, next: next, allDone: !next };
  }

  return {
    UNDO_WINDOW_MS,
    SAVE_KINDS,
    REMINDER_KINDS,
    TEST_FEEDBACK: [{ value: "heard", label: "我听到了" }, { value: "seen" }],
    saveFeedback,
    reminderFeedback,
    actionSpec,
    captureSummary,
    testFeedbackVerdict,
    setupSteps,
    humanize,
    fmtClock
  };
});
