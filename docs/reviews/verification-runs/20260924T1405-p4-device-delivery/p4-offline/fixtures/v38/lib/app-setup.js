/* P2-E setup / first-reminder onboarding / 60s test. UMD factory; evaluation has no side effects. */
(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else { root.AttentionLib = root.AttentionLib || {}; root.AttentionLib.AppSetup = factory(root); }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";
  function createAppSetup(d) {
    const deps = d || {};
    const required = ['query','queryAll','openSheet','toast','escapeHtml','fmtTime','writeIfChanged','getState','save','renderMe','systemBridge','getNativeReminders','getNativeReminderStatus','setNativeReminderStatus','getFeedback','labLog','labCancelAlarms','describeAlarmDelivery','openBackgroundGuide','openSystemSetting','isNativeAndroidRuntime'];
    required.forEach(k => { if (typeof deps[k] !== 'function') throw new Error('createAppSetup(deps) 缺少依赖：' + k); });
    const $ = sel => deps.query(sel), $$ = sel => deps.queryAll(sel);
    const state = new Proxy({}, { get: (_, k) => deps.getState()[k], set: (_, k, v) => (deps.getState()[k] = v, true) });
    const nativeReminderStatus = new Proxy({}, { get: (_, k) => (deps.getNativeReminderStatus() || {})[k] });
    const NativeReminders = new Proxy({}, { get: (_, k) => (deps.getNativeReminders() || {})[k] });
    const FeedbackLib = new Proxy({}, { get: (_, k) => (deps.getFeedback() || {})[k] });
    const openSheet = id => deps.openSheet(id), toast = (...a) => deps.toast(...a), save = () => deps.save();
    const renderMe = () => deps.renderMe(), fmtTime = ts => deps.fmtTime(ts), escapeHtml = s => deps.escapeHtml(s);
    const writeIfChanged = (el, html) => deps.writeIfChanged(el, html), systemBridge = () => deps.systemBridge();
    const labLog = (...a) => deps.labLog(...a), setNativeReminderStatus = s => deps.setNativeReminderStatus(s);
    const openBackgroundGuide = k => deps.openBackgroundGuide(k), openSystemSetting = k => deps.openSystemSetting(k);
    const describeAlarmDelivery = d => deps.describeAlarmDelivery(d), labCancelAlarms = o => deps.labCancelAlarms(o);
    const isNativeAndroidRuntime = () => deps.isNativeAndroidRuntime();
    let bound = false;
  /*
   * 现在的分工：
   *  · 启动时**什么都不弹**（空首页先允许录入）；
   *  · 第一次真的保存了「需要提醒」的事项之后，首页出现一条**可跳过**的设置入口
   *    （见 `renderSetupEntry`），设置里始终可从「我的 → 提醒设置」重新进入；
   *  · 技术诊断、排程详情、环形日志移到「高级诊断」，不再挡在首用路径上。
   *
   * 升级兼容：不覆盖既有用户设置，也不重复强制引导。
   * 旧字段 `onboardDone` 只是**读**，不再当「已通过测试」用（它从来不代表测试通过）。
   */
  function maybePromptAndroidNotify() {
    if (!(NativeReminders.isNativeAndroid && NativeReminders.isNativeAndroid())) return;
    if (typeof state.settings.notifyPrompted !== "boolean") state.settings.notifyPrompted = false;
    if (typeof state.settings.setupDismissed !== "boolean") state.settings.setupDismissed = false;
    if (typeof state.settings.setupPromptStarted !== "boolean") state.settings.setupPromptStarted = false;
    const row = $("#btnSetup");
    if (row) row.hidden = false;
    renderSetupEntry();
  }

  /** 首次保存了「有真实提醒时间」的事项 —— 这才是设置入口出现的时机。 */
  function noteFirstRemindSaved(it) {
    if (!(NativeReminders.isNativeAndroid && NativeReminders.isNativeAndroid())) return;
    if (!it || !it.triggerAt || it.isFallbackTrigger) return;
    if (state.settings.setupPromptStarted) return;
    state.settings.setupPromptStarted = true;
    save();
    renderSetupEntry();
  }

  function renderSetupEntry() {
    const host = $("#homeSetup");
    if (!host) return;
    if (!isNativeAndroidRuntime()) { writeIfChanged(host, ""); return; }
    if (state.settings.setupDone || state.settings.setupDismissed) { writeIfChanged(host, ""); return; }
    if (!state.settings.setupPromptStarted) { writeIfChanged(host, ""); return; }
    const feedbackApi = FeedbackLib;
    const st = feedbackApi ? feedbackApi.setupSteps(nativeReminderStatus, setupStepsContext()) : null;
    if (!st || !st.next) { writeIfChanged(host, ""); return; }
    const missing = st.steps.filter(s => !s.done);
    const html = '<button class="soft-entry" id="setupEntry" style="margin-bottom:10px">' +
      "<span><strong>提醒还没准备好</strong><br>" +
      '<span style="font-size:0.78rem;color:var(--muted)">还差 ' + missing.length + " 步：" +
      escapeHtml(missing[0].title) + " · 可以跳过，跳过也能记录</span></span>" +
      '<span style="color:var(--muted)">›</span></button>';
    // O6：内容没变就不重建，也不重复挂监听（单写入者容器，见 writeIfChanged）。
    if (!writeIfChanged(host, html)) return;
    const btn = $("#setupEntry");
    if (btn) btn.addEventListener("click", () => openSetupSheet());
  }

  function openSetupSheet() {
    renderSetupSheetBody();
    openSheet("sheetSetup");
  }

  const SETUP_TEST_ID = 90003;
  /** 测试闹钟的标题。系统侧只回一条「最近一次投递」，靠它与运行时刻一起判定是否本次。 */
  const SETUP_TEST_TITLE = "安心收件箱闹钟测试";

  /** 本次运行记录（F07）：证据、用户反馈、停铃都以它为准，不再混用上一次的结果。 */
  function currentTestRun() {
    const run = state.settings.testRun;
    return run && typeof run === "object" ? run : null;
  }

  /** `lastAlarmDelivery` 那条记录是不是**本次测试**产生的（不是上一条业务闹钟、也不是上次测试）。 */
  function deliveryBelongsToRun(d, run) {
    if (!d || !run) return false;
    const at = Number(d.at || 0);
    if (!(at > 0) || at < Number(run.startedAt || 0)) return false;
    return String(d.title || "").indexOf("闹钟测试") >= 0;
  }

  /**
   * F07 / UX-T02：开始一次 60 秒测试。
   *
   * 先落一条**本次运行**记录再排程（失败则不留记录）：后面的停铃、
   * 「这次结果怎么样」的证据与反馈全靠它区分「本次」与「上一次」。
   * 上一版这两处都是空的 —— 面板会把上一条业务闹钟的结果当成本次测试结果展示。
   */
  async function startSetupTestRun() {
    const bridge = systemBridge();
    if (!bridge || !bridge.scheduleAlarm) {
      labLog("SystemBridge 不可用，无法设置闹钟");
      toast("原生闹钟桥不可用");
      return false;
    }
    const startedAt = Date.now();
    try {
      const r = await bridge.scheduleAlarm({
        delayMs: 60000,
        id: SETUP_TEST_ID,
        title: SETUP_TEST_TITLE,
        body: "60 秒闹钟触发成功 · 可锁屏验证"
      });
      state.settings.testRun = {
        id: SETUP_TEST_ID,
        startedAt: startedAt,
        triggerAt: r && r.triggerAt ? Number(r.triggerAt) : startedAt + 60000,
        stoppedAt: null,
        seenAt: null,
        feedbackAt: null
      };
      save();
      labLog("已排 60 秒测试闹钟 · " + ((r && (r.mode || (r.exact ? "精确" : "非精确"))) || "已登记") +
        " · 触发于 " + fmtTime(state.settings.testRun.triggerAt));
      toast("已排 60 秒测试 · 可以锁屏了");
      renderSetupSheetBody();
      return true;
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      labLog("测试闹钟没排上：" + msg);
      toast("测试闹钟没排上：" + msg);
      renderSetupSheetBody();
      return false;
    }
  }

  /**
   * F07：「停止铃声 / 取消未触发的测试」必须真的停住**本次测试**正在响的铃声。
   *
   * 之前这里只调 `labCancelAlarms()`（撤未来的 PendingIntent 与排程镜像），之后再条件调用
   * `NativeReminders.stopAllAlarms` —— 而那个 API **在本模块里根本不存在**，分支永不执行。
   * 于是「正在响的测试铃声」没有任何停止路径（源码级调用链确认，独立验收 F07）。
   *
   * 现在按**活跃投递台账**取本次测试那一条的 id + token，走已有的 token 限定停止链路
   * （`stopAlarmDelivery`）：它只停指定 id 且 token 相符的那一条，
   * 用户自己的闹钟（别的 id）一条都不会被误停。
   *
   * R-F07：三种结论必须分开 —— **真的停住了** / **确认没有活跃投递** / **读不到或停不住**。
   * 之前读取抛错只写了一条日志，然后照样 `stoppedAt = now` 并提示「没有正在响的测试铃声」：
   * 「读不到」被当成了「不存在」，而取消未来的 PendingIntent 根本证明不了正在响的铃声已停。
   * 没确认就不能宣称已停，也不能把 `stoppedAt` 当成成功证据（面板会据此显示「你已手动停止」）。
   */
  async function stopSetupTestRun() {
    const bridge = systemBridge();
    const run = currentTestRun();
    let stopped = 0;
    let seen = 0;
    let stopFailed = false;
    let readOk = false;
    let readError = "";
    const canRead = !!(bridge && bridge.activeAlarmDeliveries && bridge.stopAlarmDelivery);
    if (!canRead) {
      readError = "原生桥不可用";
    } else {
      try {
        const active = await bridge.activeAlarmDeliveries();
        const rows = Array.isArray(active && active.alarms) ? active.alarms : [];
        readOk = true;   // 读到「空的」与「读不到」是两件事：只有前者能说「没有在响」
        for (const row of rows) {
          if (!row || Number(row.id) !== SETUP_TEST_ID) continue;   // 只认本次测试的投递
          if (run && Number(row.receivedAt || 0) < Number(run.startedAt || 0)) continue; // 上一次的残留
          seen++;
          if (!row.token) continue;
          try {
            const res = await bridge.stopAlarmDelivery({ id: SETUP_TEST_ID, token: String(row.token) });
            if (res && res.stopped) stopped++;
            else stopFailed = true;
          } catch (error) {
            stopFailed = true;
            labLog("停止铃声失败：" + (error && error.message ? error.message : error));
          }
        }
      } catch (error) {
        readError = error && error.message ? error.message : String(error);
        labLog("读取活跃投递失败：" + readError);
      }
    }
    // 未来的测试排程一并撤掉（只撤测试用的那几个 id）；失败要能传上来
    const cancel = await labCancelAlarms({ quiet: true });

    // 只有**确认过**才落 stoppedAt：真的停住了，或读成功且确认没有活跃投递。
    // 读取失败 / 停不住 / 取消失败都不算 —— 那时我们并不知道铃声还在不在响。
    const confirmedGone = readOk && seen === 0;
    const confirmed = stopped > 0 || confirmedGone;
    if (run && confirmed) {
      run.stoppedAt = Date.now();
      save();
    }
    renderSetupSheetBody();
    // 如实说明停到了什么 ——「没找到正在响的」不等于「停不掉」，也绝不等于「读不到」
    const retry = () => { stopSetupTestRun(); };
    if (stopped > 0) {
      if (cancel.ok) toast("已停止本次测试的铃声");
      else toast("已停止本次测试的铃声 · 但未触发的测试没取消掉", "重试", retry);
    } else if (!readOk) {
      toast("读不到铃声状态 · 无法确认是否已停" + (cancel.ok ? "" : "，且未触发的测试没取消掉"), "重试", retry);
    } else if (seen === 0) {
      if (cancel.ok) toast("没有正在响的测试铃声 · 已取消未触发的测试");
      else toast("没有正在响的测试铃声 · 但未触发的测试没取消掉", "重试", retry);
    } else {
      // 台账里确实有本次测试的活跃投递，却一条都没停成功（stopFailed / 缺 token）：
      // 不能宣称已停，也不谎称「没有在响」
      toast("没能停住这次铃声 · 它可能还在响 · 请再试一次", "重试", retry);
      labLog("停止铃声未确认：活跃 " + seen + " 条 · 停住 " + stopped + " 条" +
        (stopFailed ? " · 有失败回执" : " · 有缺 token 的条目"));
    }
    return stopped;
  }

  function testFeedbackButtonsHtml() {
    const cur = state.settings.testFeedback || null;
    const run = currentTestRun();
    // F07：上一次测试的答案不许再亮着 —— 只有**本次运行**之后的反馈才算数
    const fresh = !!cur && (!run || Number(cur.at || 0) >= Number(run.startedAt || 0));
    const feedbackApi = FeedbackLib;
    const list = feedbackApi ? feedbackApi.TEST_FEEDBACK : [
      { value: "heard", label: "我听到了" }, { value: "seen", label: "我看到了" },
      { value: "missed", label: "没收到" }, { value: "unsure", label: "不确定" }
    ];
    return '<div class="setup-test-actions" id="setupTestFeedback">' +
      list.map(x => '<button type="button" class="chip' + (fresh && cur.value === x.value ? " on" : "") +
        '" data-testfb="' + x.value + '">' + escapeHtml(x.label) + "</button>").join("") +
      "</div>";
  }

  /**
   * F07：系统侧证据 + 用户反馈，**都绑定本次运行**。
   *
   * 上一版把 `lastAlarmDelivery` 无条件当「最近一次投递」展示 —— 用户点开测试面板时
   * 看到的可能是上一条业务闹钟、或上一次测试的结果，于是「这次到底行不行」永远答不出来。
   */
  async function setupEvidenceHtml() {
    const s = nativeReminderStatus || {};
    const run = currentTestRun();
    const alarms = Array.isArray(s.scheduledAlarmIds) ? s.scheduledAlarmIds.length : 0;
    const lines = [];
    lines.push("系统侧：已排 " + alarms + " 条闹钟 · " +
      (s.notificationsGranted ? "通知可用" : "通知未授权") +
      (s.exactAlarm === "granted" ? " · 精确排程可用" : " · 非精确排程"));
    if (!run) {
      lines.push("本次测试：还没有开始过。点上面的按钮排一次，再锁屏等一分钟。");
    } else {
      lines.push("本次测试：" + fmtTime(run.startedAt) + " 开始 · 计划 " + fmtTime(run.triggerAt) +
        (run.stoppedAt ? " · 你已手动停止" : ""));
    }
    const bridge = systemBridge();
    if (bridge && bridge.lastAlarmDelivery) {
      try {
        const d = await bridge.lastAlarmDelivery();
        if (deliveryBelongsToRun(d, run)) {
          lines.push("本次测试投递：" + String(describeAlarmDelivery(d)).replace(/<[^>]+>/g, " "));
          // 看到本次投递 ⇒ 本次测试有结果了（用于「测试完成 / 可重测」的判定）
          if (run && !run.seenAt) {
            run.seenAt = Date.now();
            save();
          }
        } else if (run) {
          lines.push("本次测试投递：还没有记录（没记录不等于没响；上一次的结果不计入本次）");
        } else {
          lines.push("最近一次投递：有历史记录，但它不属于任何一次测试（仅供参考）");
        }
      } catch (error) {
        lines.push("本次测试投递：读不到（" + (error && error.message ? error.message : "未知") + "）");
      }
    } else {
      lines.push("本次测试投递：当前环境读不到");
    }
    const fb = state.settings.testFeedback;
    const fresh = !!fb && (!run || Number(fb.at || 0) >= Number(run.startedAt || 0));
    const v = FeedbackLib ? FeedbackLib.testFeedbackVerdict(fresh ? fb.value : undefined) : null;
    if (v) lines.push("你的反馈：" + v.text + (fresh ? "" : "（这是上一次的回答，本次还没有）"));
    return '<p class="demo-note">' + lines.map(escapeHtml).join("<br>") + "</p>";
  }

  /** 传给 `FeedbackLib.setupSteps` 的上下文：测试步骤的完成/重测状态由本次运行决定。 */
  function setupStepsContext() {
    return {
      testRun: currentTestRun(),
      testFeedback: state.settings.testFeedback || null,
      // 旧的 *Done 字段来自尚未发布的向导实现，只能迁移成「入口打开过」，
      // 不能作为权限或后台可靠性已经验证的证据。
      backgroundVisited: !!(state.settings.backgroundVisited || state.settings.backgroundDone),
      overlayVisited: !!(state.settings.overlayVisited || state.settings.overlayDone)
    };
  }

  function renderSetupSheetBody() {
    const body = $("#setupBody");
    if (!body) return;
    const feedbackApi = FeedbackLib;
    const st = feedbackApi ? feedbackApi.setupSteps(nativeReminderStatus, setupStepsContext()) : { steps: [], next: null };
    const missing = st.steps.filter(s => !s.done);
    const cur = missing[0] || null;
    let html = "";
    if (cur) {
      html += '<div class="setup-step' + (cur.done ? " done" : "") + '"><h4>' + escapeHtml(cur.title) + "</h4>" +
        "<p>" + escapeHtml(cur.why) + "</p>" +
        '<p>拒绝之后会怎样：' + escapeHtml(cur.denyImpact) + "</p></div>" +
        '<p class="demo-note">还剩 ' + missing.length + " 步，一屏一个。任何一步都可以拒绝或跳过，" +
        "拒绝不影响记录功能，也不会再循环把你送回同一页。</p>";
    } else {
      html += '<div class="setup-step done"><h4>设置流程已走完</h4>' +
        '<p>是否真正生效仍取决于系统状态，并需通过本机 60 秒锁屏测试确认。</p></div>';
    }
    // 60 秒测试：由用户主动开始；证据与反馈分列
    const testStep = st.steps.filter(s => s.id === "test")[0] || null;
    const testDone = !!(testStep && testStep.done);
    html += '<div class="setup-step' + (testDone ? " done" : "") + '"><h4>60 秒测试' +
      (testDone ? " · 本次已出结果" : "") + "</h4>" +
      "<p>点开始后锁屏等一分钟。测试用独立的测试闹钟，不建事项、不开周期、不进统计。</p>" +
      '<div class="setup-test-actions">' +
      '<button type="button" class="chip" id="setupTestStart">' +
      (testDone ? "再测一次" : "开始 60 秒测试") + "</button>" +
      '<button type="button" class="chip" id="setupTestStop">停止铃声 / 取消未触发的测试</button>' +
      "</div></div>" +
      '<div class="setup-step"><h4>这次结果怎么样？</h4>' +
      "<p>你说了算 —— 系统事件证据和你的感受是两回事，未回答不代表失败或成功。</p>" +
      testFeedbackButtonsHtml() + "</div>" +
      '<div id="setupEvidence"></div>';
    body.innerHTML = html;
    const btn = $("#setupPrimary");
    if (btn) {
      btn.textContent = cur ? cur.action : "开始测试";
      btn.onclick = () => runSetupStep(cur ? cur.id : "test");
    }
    // 用户反馈
    $$("#setupTestFeedback .chip").forEach(ch => {
      ch.addEventListener("click", () => {
        const at = Date.now();
        state.settings.testFeedback = { value: ch.dataset.testfb, at: at };
        // F07：反馈挂在**本次运行**上，换一次测试就作废
        const run = currentTestRun();
        if (run) { run.feedbackAt = at; run.feedback = ch.dataset.testfb; }
        save();
        renderSetupSheetBody();
        const v = FeedbackLib ? FeedbackLib.testFeedbackVerdict(ch.dataset.testfb) : null;
        if (v) toast(v.text);
      });
    });
    const start = $("#setupTestStart");
    if (start) start.addEventListener("click", async () => { await startSetupTestRun(); });
    const stop = $("#setupTestStop");
    if (stop) stop.addEventListener("click", async () => { await stopSetupTestRun(); });
    // 证据异步补进 DOM
    const host = $("#setupEvidence");
    if (host) {
      setupEvidenceHtml().then(html2 => { if ($("#setupEvidence")) $("#setupEvidence").innerHTML = html2; })
        .catch(() => {});
    }
    updateSetupEntry();
  }

  function updateSetupEntry() {
    const row = $("#btnSetup");
    if (!row) return;
    const sub = $("#setupSub");
    if (!sub) return;
    const feedbackApi = FeedbackLib;
    const st = feedbackApi ? feedbackApi.setupSteps(nativeReminderStatus, setupStepsContext()) : { steps: [], next: null };
    const missing = st.steps.filter(s => !s.done);
    sub.textContent = missing.length
      ? "还差 " + missing.length + " 步 · 检查必要设置 · 60 秒测试"
      : "设置流程已完成 · 可再做一次 60 秒测试";
  }

  async function runSetupStep(stepId) {
    if (stepId === "notify") {
      if (NativeReminders.requestNotificationPermission) {
        try {
          const st = await NativeReminders.requestNotificationPermission();
          setNativeReminderStatus(st);
        } catch (error) {}
      }
      const granted = nativeReminderStatus && nativeReminderStatus.notifications === "granted";
      if (!granted) toast("没有授予也可以继续记录事项 · 只是关掉应用后看不到提醒");
      renderSetupSheetBody();
      return;
    }
    if (stepId === "exact") {
      if (NativeReminders.openExactAlarmSettings) {
        try { await NativeReminders.openExactAlarmSettings(); } catch (error) {}
      }
      toast("回到应用后这里会自动更新");
      return;
    }
    if (stepId === "background") {
      const opened = await openBackgroundGuide("background");
      if (opened) {
        state.settings.backgroundVisited = true;
        save();
        toast("已打开设置 · 是否生效以返回后的状态和 60 秒测试为准");
      }
      renderSetupSheetBody();
      return;
    }
    if (stepId === "overlay") {
      const opened = await openSystemSetting("overlay");
      if (opened) {
        state.settings.overlayVisited = true;
        save();
        toast("已打开设置 · 是否生效以返回后的状态和 60 秒测试为准");
      }
      renderSetupSheetBody();
      return;
    }
    // 默认：开始 60 秒测试（用户主动开始，不代跑）
    await startSetupTestRun();
  }


    function bind() { if (bound) return; bound = true; const row = $("#btnSetup"); if (row) row.addEventListener("click", openSetupSheet); }
    return { bind, maybePromptAndroidNotify, noteFirstRemindSaved, renderSetupEntry, updateSetupEntry, openSetupSheet, startSetupTestRun, stopSetupTestRun, setupEvidenceHtml, setupStepsContext, renderSetupSheetBody, runSetupStep, testFeedbackButtonsHtml, deliveryBelongsToRun, currentTestRun };
  }
  return { createAppSetup, INSTANCE_CONTRACT: ["bind","maybePromptAndroidNotify","noteFirstRemindSaved","renderSetupEntry","updateSetupEntry","openSetupSheet","startSetupTestRun","stopSetupTestRun","setupEvidenceHtml","setupStepsContext","renderSetupSheetBody","runSetupStep"] };
});
