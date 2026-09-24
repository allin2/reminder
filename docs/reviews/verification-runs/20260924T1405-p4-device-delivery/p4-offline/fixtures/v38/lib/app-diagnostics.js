/* 通知实验室 / 投递判读 / 闹钟 trace / 系统设置诊断 —— UMD（P2-D 搬移）
 *
 * 为什么单独成文件：这一段原先挤在 `app-core.js`（约 6006–6697 行），但它是
 * **四件互不等同的事**：
 *   · **投递判读** —— `describeAlarmDelivery` 把原生回读的台账翻成人话（纯函数语义）；
 *   · **诊断面板** —— 权限 pill、后台 verdict、trace 分组与刷新；
 *   · **测试闹钟动作** —— 立即通知 / 10s·60s 排程 / 取消（固定 ID）；
 *   · **系统设置导航** —— busy 防重入、如实反馈落点，不冒充「已授权」。
 * 它们因为写在 IIFE 里而顺手拿到了 `state` / `save()` / `$()` 的全部闭包权限。
 * 迁出之后，对外的权力只剩 `createAppDiagnostics(deps)` 那张清单上写明的几项。
 *
 * 边界（刻意**不**搬的部分）：
 *   · `systemBridge()` / `isNativeAndroidRuntime()` / `waitForNativeBridge()` /
 *     `appSettingsPlugin()` —— 被 setup、active alarm、启动与复核共用，本轮留在
 *     core，以函数依赖注入（后续归 `app-platform`）；
 *   · `bindNotifyLab()` 里的 setup/review 控件绑定 —— 由 core 侧独立绑定函数持有；
 *   · 状态所有权、`save()`、`renderMe()`、原生同步、排程算法与权限策略。
 *
 * 装配方式：导出 `createAppDiagnostics(deps)`，由**入口统一实例化**。
 * 本模块求值不注册监听、不启动计时器、不访问 state、不调用桥、不写存储 ——
 * `autoStartLanding` 与 `bound` 都是**实例内**可变状态，只在方法被调用后才变化。
 *
 * 依赖为什么一律是**函数**（不是值）：`state` / `nativeReminderStatus` 会被加载与
 * 对账替换内容，`systemBridge` / `$` 跟着重试重建的绑定走（F03）。按值传进来，
 * 就等于把「补载脚本后点重试」这条路在诊断链上再堵死一次。
 *
 * 依赖方向：本模块不反向导入 `app-core`，也不读 `AttentionLib`。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.AppDiagnostics = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  /** core 真正需要的实例成员（进 `APP_DIAGNOSTICS_INSTANCE_CONTRACT`）。 */
  const INSTANCE_CONTRACT = [
    "bind",
    "refreshNotifyLab",
    "labLog",
    "labCancelAlarms",
    "describeAlarmDelivery",
    "openSystemSetting",
    "openBackgroundGuide"
  ];

  /**
   * 装配一个诊断实例。
   *
   * @param {object} deps 活依赖：每一项都是函数或 getter，不得捕获装配时快照。
   */
  function createAppDiagnostics(deps) {
    if (!deps || typeof deps !== "object") {
      throw new Error("createAppDiagnostics(deps) 需要依赖对象");
    }
    const required = [
      "query", "queryAll", "openSheet", "toast", "fmtTime",
      "getState", "save", "renderMe",
      "systemBridge", "appSettingsPlugin",
      "getNativeReminderStatus", "setNativeReminderStatus",
      "requestNativeNotificationPermission", "openExactAlarmSettings",
      "buildDesired", "syncNativeRemindersNow",
      "getCapacitor", "getDocument"
    ];
    for (let i = 0; i < required.length; i++) {
      if (typeof deps[required[i]] !== "function") {
        throw new Error("createAppDiagnostics(deps) 缺少依赖：" + required[i]);
      }
    }

    /** 实例内：`bind()` 是否已绑定（幂等闸门；模块求值阶段不设置）。 */
    let bound = false;
    /** 最近一次「自启动/后台」跳转的实际落点（不推断、不美化）。 */
    let autoStartLanding = null;

    const query = sel => deps.query(sel);
    const queryAll = sel => deps.queryAll(sel);

    function setPill(el, text, ok, warn) {
      if (!el) return;
      el.textContent = text;
      el.className = "pill " + (ok ? "time" : warn ? "warn" : "crit");
    }

    function labLog(msg) {
      const el = query("#labLog");
      if (!el) return;
      el.textContent = "[" + deps.fmtTime(Date.now()) + "] " + msg;
    }

    async function diagnoseSystemBridge() {
      const bridge = deps.systemBridge();
      if (!bridge || !bridge.diagnose) {
        return { available: false, reason: "SystemBridge 插件未加载" };
      }
      try {
        const d = await bridge.diagnose();
        return Object.assign({ available: true }, d);
      } catch (error) {
        return { available: false, reason: error && error.message ? error.message : String(error) };
      }
    }

    /**
     * 把原生回读的那条记录翻成人话。
     *
     * 「尝试投递」是闹钟到点、广播收到了；「界面显示出来」是 AlarmActivity 真的到了
     * 用户眼前。只有前者没有后者 ⇒ 界面没能送到眼前 —— 而两者在手机上的表现一模一样，
     * 所以必须靠台账分辨。归因必须靠证据，不能靠猜权限。
     */
    function describeAlarmDelivery(d) {
      if (!d || !d.attempted) {
        return { text: "还没有投递记录", label: "—", ok: false, warn: true };
      }
      const when = d.at ? deps.fmtTime(d.at) : "—";
      const exactNote = d.exactAtDelivery === false
        ? " · 本次为「非精确」排程（缺「闹钟和提醒」权限），到达时刻可能被系统推迟"
        : "";
      const visible = !!d.visible || (!!d.shownAt && d.shownAt >= d.at);
      if (visible) {
        return { text: "闹钟界面已经显示出来 · " + when, label: "已显示", ok: true, warn: false };
      }
      if (d.notifyEnabledAtDelivery === false) {
        const carrierKnown = d.carrierSound === "native" || d.carrierSound === "activity";
        const carrierText =
          d.carrierSound === "native" ? "铃声与振动已由前台服务接管"
          : d.carrierSound === "activity" ? "铃声与振动由界面回落自播"
          : d.carrierSound === "none" ? "本次没有任何载体在响（前台服务与界面都没起来）"
          : "铃声与振动不依赖通知权限";
        return {
          text: "投递时系统通知是关闭的 · 全屏闹钟没有载体（系统不会展示界面）· "
            + carrierText + exactNote + " · " + when,
          label: carrierKnown ? "已响未亮" : "无通知权限",
          ok: false,
          warn: true
        };
      }
      if (d.inCall && !d.locked) {
        return { text: "通话中 · 不抢全屏；已请求系统横幅并继续声振 · " + when, label: "通话中", ok: false, warn: true };
      }
      const overlayAt = d.overlayAtDelivery !== undefined ? !!d.overlayAtDelivery : !!d.canDrawOverlays;
      const fsiAt = d.fsiAtDelivery !== undefined
        ? d.fsiAtDelivery !== false
        : d.canUseFullScreenIntent !== false;
      const background = !!d.locked || d.screenOn === false;
      let reason;
      if (background) {
        reason = fsiAt
          ? "权限齐备，但系统没有展示这次全屏 · 请检查「后台与锁屏设置」中的锁屏显示"
          : "缺「全屏通知」权限 · 锁屏/息屏只能出横幅";
      } else if (!overlayAt) {
        reason = "缺「显示在其他应用上层」· 解锁亮屏下后台启动界面被系统拦下";
      } else {
        reason = "权限齐备，但界面没有被系统展示 · 请检查后台运行及界面显示限制";
      }
      const notificationNote = d.notificationPosted
        ? " · 系统通知已经投递；若未看到顶部横幅，请在系统通知设置开启「悬浮通知/横幅」"
        : " · 未确认系统通知已经投递";
      return {
        text: "未确认显示全屏 · " + when + " · " + reason + notificationNote + exactNote,
        label: d.notificationPosted ? "系统通知已投递" : "仅通知", ok: false, warn: true
      };
    }

    /**
     * 把「关掉 App 后到底会不会响」算成一句人话。
     * 每次执行都读当前 settings、nativeReminderStatus 与 getPending 实数。
     */
    async function renderBackgroundVerdict(diag, delivery) {
      const subBg = query("#labBackground");
      const subSched = query("#labScheduled");
      const elVerdict = query("#labVerdict");
      const s = deps.getNativeReminderStatus() || {};
      const state = deps.getState();
      const notifyOn = !!(state && state.settings && state.settings.notify);
      const granted = !!(diag && diag.notificationsEnabled && diag.postNotificationsGranted);

      const d = delivery || null;
      const lastVisible = !!(d && d.attempted) &&
        (!!d.visible || (!!d.shownAt && d.shownAt >= d.at));
      const lastHidden = !!(d && d.attempted) && !lastVisible;

      let pending = null;
      try {
        const cap = deps.getCapacitor();
        const ln = cap && cap.Plugins ? cap.Plugins.LocalNotifications : null;
        if (ln && ln.getPending) {
          const r = await ln.getPending();
          if (r && Array.isArray(r.notifications)) pending = r.notifications.length;
        }
      } catch (error) {}

      const desired = Number(s.desired) || 0;
      const alarmCount = Number(s.alarmCount) || 0;
      let text, label, ok, warn;

      if (s.enabled === undefined) {
        text = "原生对账从未执行（启动时原生桥尚未就绪）· 关掉 App 后不会有任何提醒。请完全退出后重开应用。";
        label = "未执行"; ok = false; warn = false;
      } else if (!notifyOn) {
        text = "总开关未开 · 关掉 App 后不会有任何提醒。请打开「设置 → 本地通知」。";
        label = "未开启"; ok = false; warn = true;
      } else if (!granted) {
        text = "系统通知权限未授予 · 关掉 App 后不会有任何提醒。请点上面的「1. 申请通知权限」。";
        label = "权限缺失"; ok = false; warn = true;
      } else if (s.reliability === "error") {
        text = "原生对账失败 · 提醒可能不会按时到达：" +
          ((s.errors && s.errors[0]) || "未知原因");
        label = "对账异常"; ok = false; warn = false;
      } else if (pending == null) {
        text = "无法读取系统排程 · 请刷新诊断后重试，不能据此判断后台提醒已就绪。";
        label = "未知"; ok = false; warn = true;
      } else if (pending === 0 && desired > 0) {
        text = "对账要求排 " + desired + " 条，系统里却是 0 条 · 排程没有落地。请点「立即重排后台提醒」。";
        label = "零排程"; ok = false; warn = false;
      } else if (pending === 0) {
        text = "系统里当前没有待发的提醒（当前也没有需要提醒的事项）。";
        label = "待命中"; ok = true; warn = false;
      } else {
        text = "系统里已挂 " + pending + " 条提醒（全屏闹钟 " + alarmCount + " 条）· 排程已登记，仍需确认后台耗电、自启动和锁屏显示，并完成息屏测试。";
        label = "已排程"; ok = false; warn = true;
        if (lastHidden) {
          text = "排程已经落到系统里（" + pending + " 条），但上一次到点没能把界面弹出来 —— 见上面「投递」一行。";
          label = "有保留"; ok = false; warn = true;
        }
      }

      if (subBg) subBg.textContent = text;
      setPill(query("#labBackgroundPill"), label, ok, warn);
      if (subSched) {
        subSched.textContent = pending == null
          ? "无法读取（原生桥不可用）"
          : pending + " 条待发" + (desired > 0 ? " · 本轮计划 " + desired + " 条" : "");
      }
      setPill(query("#labScheduledPill"), pending == null ? "未知" : (pending ? pending + " 条" : "0 条"),
        pending != null && pending > 0, pending == null || pending === 0);
      if (elVerdict) {
        elVerdict.hidden = false;
        elVerdict.textContent = (ok ? "✅ " : "⚠️ ") + text;
        elVerdict.style.color = ok ? "#1b6b4a" : "#8f3a3a";
        elVerdict.style.background = ok ? "#e8f4ee" : "#f6e8e8";
      }
      return { text, label, ok, warn, pending, desired };
    }

    async function refreshNotifyLab() {
      if (!query("#sheetNotifyLab")) return;
      const cap = deps.getCapacitor();
      const platform = cap && cap.getPlatform ? cap.getPlatform() : (cap && cap.platform) || "unknown";
      const hasLN = !!(cap && cap.Plugins && cap.Plugins.LocalNotifications);
      const hasSB = !!(cap && cap.Plugins && cap.Plugins.SystemBridge);
      const bridgeSub = query("#labBridge");
      if (bridgeSub) {
        bridgeSub.textContent = "平台 " + platform +
          " · LocalNotifications " + (hasLN ? "有" : "无") +
          " · SystemBridge " + (hasSB ? "有" : "无");
      }
      setPill(query("#labBridgePill"), hasSB || hasLN ? "就绪" : "异常", hasSB || hasLN, false);

      const diag = await diagnoseSystemBridge();
      const bridge = deps.systemBridge();
      if (!diag.available) {
        query("#labNotifyPerm").textContent = diag.reason || "原生桥不可用";
        setPill(query("#labNotifyPill"), "异常", false, false);
        query("#labExact").textContent = "无法检测";
        setPill(query("#labExactPill"), "未知", false, true);
        query("#labBattery").textContent = "无法检测";
        setPill(query("#labBatteryPill"), "未知", false, true);
        if (query("#labFullScreen")) query("#labFullScreen").textContent = "无法检测";
        setPill(query("#labFullScreenPill"), "未知", false, true);
        if (query("#labDelivery")) query("#labDelivery").textContent = "无法检测";
        setPill(query("#labDeliveryPill"), "未知", false, true);
        if (query("#labBackground")) query("#labBackground").textContent = "原生桥不可用 · 关掉 App 后不会有任何提醒";
        setPill(query("#labBackgroundPill"), "不可用", false, false);
        if (query("#labScheduled")) query("#labScheduled").textContent = "无法读取";
        setPill(query("#labScheduledPill"), "未知", false, true);
        if (query("#labVerdict")) {
          query("#labVerdict").hidden = false;
          query("#labVerdict").textContent =
            "⚠️ 原生桥不可用（" + (diag.reason || "未知") + "）· 关掉 App 后不会有任何提醒。";
          query("#labVerdict").style.color = "#8f3a3a";
          query("#labVerdict").style.background = "#f6e8e8";
        }
        labLog("诊断失败：" + (diag.reason || "未知"));
        return diag;
      }

      const notifyOk = diag.notificationsEnabled && diag.postNotificationsGranted;
      query("#labNotifyPerm").textContent = notifyOk ? "已授权 · 系统级通知可用" : "未授权 · 请先申请并打开系统通知";
      setPill(query("#labNotifyPill"), notifyOk ? "已授权" : "未授权", notifyOk, !notifyOk);

      const exactOk = !!diag.canExactAlarm;
      query("#labExact").textContent = exactOk ? "可精确排程" : "未授权 · 仍可用非精确提醒";
      setPill(query("#labExactPill"), exactOk ? "精确" : "降级", exactOk, !exactOk);

      const batteryOk = !!diag.ignoringBatteryOptimizations;
      query("#labBattery").textContent = batteryOk
        ? "系统优化已放行 · 核心防冻结需在系统确认「允许完全后台行为」与「自启动」"
        : "未放行系统优化 · 务必去系统设置开启「允许完全后台行为」与「自启动」";
      setPill(query("#labBatteryPill"), batteryOk ? "需在系统确认" : "未放行", batteryOk, true);

      const overlayOk = !!diag.canDrawOverlays;
      const fsiOk = !!diag.canUseFullScreenIntent;
      const fullOk = overlayOk && fsiOk;
      const fullEl = query("#labFullScreen");
      if (fullEl) {
        if (fullOk) fullEl.textContent = "全屏及悬浮窗已允许 · 锁屏与使用其他应用均可弹出";
        else if (!overlayOk && !fsiOk) fullEl.textContent = "未配置 · 锁屏及使用其他应用时仅出横幅，不弹全屏";
        else if (!overlayOk) fullEl.textContent = "缺「悬浮窗 / 上层显示」· 使用其他应用时只出横幅";
        else fullEl.textContent = "缺「全屏通知 / 锁屏显示」· 锁屏熄屏时不弹全屏";
      }
      setPill(query("#labFullScreenPill"), fullOk ? "权限齐备" : "受限", fullOk, !fullOk);

      let delivery = null;
      if (bridge && bridge.lastAlarmDelivery) {
        try {
          delivery = await bridge.lastAlarmDelivery();
        } catch (error) {
          delivery = null;
        }
        const verdict = describeAlarmDelivery(delivery);
        if (query("#labDelivery")) query("#labDelivery").textContent = verdict.text;
        setPill(query("#labDeliveryPill"), verdict.label, verdict.ok, verdict.warn);
      }

      await renderBackgroundVerdict(diag, delivery);

      labLog("诊断完成 · SDK " + diag.sdkInt +
        " · 通知 " + (notifyOk ? "OK" : "NO") +
        " · 精确闹钟 " + (exactOk ? "OK" : "降级") +
        " · 全屏 " + (fullOk ? "OK" : "受限"));
      await refreshAlarmTrace();
      return diag;
    }

    async function refreshAlarmTrace() {
      const el = query("#labTraceResults");
      const bridge = deps.systemBridge();
      if (!el) return;
      if (!bridge || !bridge.alarmTrace) { el.textContent = "请安装诊断版本"; return; }
      try {
        const data = await bridge.alarmTrace();
        const groups = new Map();
        (data.events || []).forEach(e => {
          if (!groups.has(e.token)) groups.set(e.token, []);
          groups.get(e.token).push(e);
        });
        const entries = Array.from(groups.entries()).reverse();
        const state = deps.getState();
        const nrs = deps.getNativeReminderStatus() || {};
        const itemEl = query("#labItemTrace");
        if (itemEl) {
          const items = state.items.slice().sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).slice(0, 5);
          itemEl.textContent = "本地通知总开关：" + (state.settings.notify ? "开" : "关") +
            " · 本轮对账：" + (nrs.reliability || "未知") +
            ((nrs.errors || []).length ? "\n错误：" + nrs.errors.join("；") : "") + "\n\n" +
            items.map(item => {
              const primary = deps.buildDesired ? deps.buildDesired([item], state.settings,
                Number(item.triggerAt) - 2000).find(n => n.extra.event === "primary") : null;
              const matching = entries.filter(([token, events]) =>
                events.some(e => e.stage === "item" && e.detail === item.id) ||
                (primary && token.startsWith(primary.id + ":")));
              const latest = matching[0];
              const events = latest ? latest[1] : [];
              const at = stage => {
                const e = events.find(e => e.stage === stage);
                return e ? new Date(e.at).toLocaleString() : "未记录";
              };
              const scheduled = events.find(e => e.stage === "scheduled");
              const plan = scheduled && /triggerAt=(\d+)/.exec(scheduled.detail);
              const cancelled = events.find(e => e.stage === "cancelled");
              const error = events.find(e => e.stage === "scheduleFailed" || e.stage === "notifyFailed");
              return String(item.title || "未命名事项").slice(0, 60) + "\n" + item.id +
                " · " + item.priority + " · " + item.status + " · rev " + item.rev +
                "\n事项时间：" + (item.triggerAt ? new Date(item.triggerAt).toLocaleString() : "无") +
                "\n提醒方式：" + item.delivery_mode + " · 兜底时间：" + !!item.isFallbackTrigger +
                "\n原生计划：" + (plan ? new Date(Number(plan[1])).toLocaleString() : "无匹配记录（不代表从未排程）") +
                "\n广播：" + at("received") + "\n生命周期恢复：" + at("resumed") +
                "\n窗口/声音轨迹：\n" + events.filter(e => ["created", "focus", "windowSample", "windowVisible", "windowHidden", "audioState", "audioStarted", "audioFailed", "userAction", "autoClose", "paused", "stopped", "destroyed", "replaced", "effectsStopped", "duplicateIntent", "launchFailed", "launchLikelyBlocked", "directSkipped"].includes(e.stage))
                  .map(e => new Date(e.at).toLocaleTimeString() + " " + ({created:"窗口创建",focus:"窗口焦点",windowSample:"窗口采样",windowVisible:"界面已显示",windowHidden:"界面未显示",audioState:"音量状态",audioStarted:"播放 API 成功",audioFailed:"声音错误",userAction:"按钮动作",autoClose:"测试自动关闭",paused:"暂停",stopped:"不可见",destroyed:"销毁",replaced:"更换闹钟",effectsStopped:"停止声振",duplicateIntent:"同次重复送达",launchFailed:"启动错误",launchLikelyBlocked:"预计被系统拦下",directSkipped:"跳过直起界面"}[e.stage] || e.stage) + " " + e.detail).join("\n") +
                (cancelled ? "\n撤销/替换：" + new Date(cancelled.at).toLocaleString() + " · " + cancelled.detail : "") +
                (error ? "\n异常：" + error.detail : "");
            }).join("\n\n");
        }

        const tests = [-917010, -917060, -917120].map(id => entries.find(([token]) => token.startsWith(id + ":"))).filter(Boolean);
        const selected = tests.length ? tests : entries.slice(0, 6);
        const time = value => new Date(value).toLocaleTimeString();
        el.textContent = selected.map(([token, events]) => {
          const find = stage => events.find(e => e.stage === stage);
          const plan = find("scheduled");
          const match = plan && /triggerAt=(\d+)/.exec(plan.detail);
          const expected = match ? Number(match[1]) : null;
          const id = Number(token.split(":")[0]);
          const title = tests.length ? (Math.abs(id) - 917000) + " 秒测试" : "闹钟 " + id;
          const stageTime = stage => find(stage) ? time(find(stage).at) : "未记录";
          return title + " · 计划 " + (expected ? time(expected) : "未确认") +
            (find("cancelled") ? " · 已撤销/替换" : expected && expected < data.now && !find("received") ? " · 到点未收到" : "") +
            "\n广播：" + stageTime("received") + "\n通知调用：" + stageTime("notifyReturned") +
            "\n生命周期恢复：" + stageTime("resumed") +
            (find("environment") ? "\n" + find("environment").detail : "") +
            (find("scheduleFailed") || find("notifyFailed") ? "\n异常：" + (find("scheduleFailed") || find("notifyFailed")).detail : "");
        }).join("\n\n") || "暂无逐次记录";

      } catch (error) { el.textContent = "读取失败：" + String(error.message || error); }
    }

    async function labTraceTest() {
      const button = query("#labTraceTest");
      if (button) button.disabled = true;
      try {
        const bridge = deps.systemBridge();
        if (!bridge || !bridge.startAlarmTraceTest) throw new Error("请安装诊断版本");
        const result = await bridge.startAlarmTraceTest();
        const failures = (result.results || []).filter(r => !r.ok);
        labLog(failures.length ? "部分测试排程失败：" + JSON.stringify(failures) :
          "三次测试已登记。现在返回桌面并锁屏，3 分钟后回来刷新诊断。再次点击会替换未到点的测试。");
        await refreshAlarmTrace();
      } catch (error) { labLog("诊断启动失败：" + String(error.message || error)); }
      finally { if (button) button.disabled = false; }
    }

    async function labShowNow() {
      const bridge = deps.systemBridge();
      if (!bridge || !bridge.showNotification) {
        labLog("SystemBridge 不可用，无法直接发送");
        deps.toast("原生通知桥不可用");
        return;
      }
      try {
        await bridge.showNotification({
          title: "安心收件箱",
          body: "系统通知测试成功 · " + deps.fmtTime(Date.now())
        });
        labLog("已发送立即通知，请查看通知栏");
        deps.toast("已发送测试通知");
      } catch (error) {
        const msg = error && error.message ? error.message : String(error);
        labLog("立即通知失败：" + msg);
        deps.toast("通知失败：" + msg);
        await refreshNotifyLab();
      }
    }

    async function labScheduleAlarm(delayMs, label) {
      const bridge = deps.systemBridge();
      if (!bridge || !bridge.scheduleAlarm) {
        labLog("SystemBridge 不可用，无法设置闹钟");
        deps.toast("原生闹钟桥不可用");
        return;
      }
      try {
        const r = await bridge.scheduleAlarm({
          delayMs,
          id: delayMs >= 60000 ? 90003 : 90002,
          title: "安心收件箱闹钟测试",
          body: label + "闹钟触发成功 · 可锁屏验证"
        });
        labLog("已设置 " + label + " 闹钟 · " + (r.mode || (r.exact ? "精确" : "非精确")) +
          (r.alarmClock ? " · 全屏闹钟" : "") +
          " · 触发于 " + deps.fmtTime(r.triggerAt) +
          " · 到点后重开本面板可看投递结果");
        deps.toast("已设置 " + label + " 闹钟");
      } catch (error) {
        const msg = error && error.message ? error.message : String(error);
        labLog("闹钟设置失败：" + msg);
        deps.toast("闹钟失败：" + msg);
      }
    }

    /**
     * 撤销未触发的测试排程。
     * @param opts.quiet 不自己弹提示
     * @returns {{ok:boolean, error:string}}
     */
    async function labCancelAlarms(opts) {
      const quiet = !!(opts && opts.quiet === true);
      const bridge = deps.systemBridge();
      if (!bridge || !bridge.cancelAlarm) {
        if (!quiet) deps.toast("原生闹钟桥不可用");
        return { ok: false, error: "原生闹钟桥不可用" };
      }
      try {
        await bridge.cancelAlarm({ id: 90002 });
        await bridge.cancelAlarm({ id: 90003 });
        for (const id of [-917010, -917060, -917120]) await bridge.cancelAlarm({ id });
        labLog("已取消未触发测试闹钟");
        if (!quiet) deps.toast("已取消测试闹钟");
        return { ok: true, error: "" };
      } catch (error) {
        const msg = error && error.message ? error.message : String(error);
        labLog("取消测试闹钟失败：" + msg);
        if (!quiet) deps.toast("取消失败");
        return { ok: false, error: msg };
      }
    }

    async function labRequestNotify() {
      const bridge = deps.systemBridge();
      const state = deps.getState();
      try {
        if (bridge && bridge.requestNotificationPermission) {
          const r = await bridge.requestNotificationPermission();
          state.settings.notify = !!r.granted;
          state.settings.notifyPrompted = true;
          deps.save();
          labLog(r.granted ? "通知权限已授予" : "通知权限未授予");
          deps.toast(r.granted ? "通知权限已开启" : "仍未授权，请到系统设置开启");
        } else if (deps.requestNativeNotificationPermission) {
          const status = await deps.requestNativeNotificationPermission();
          deps.setNativeReminderStatus(status);
          state.settings.notify = status.notifications === "granted";
          deps.save();
          labLog("权限结果：" + status.notifications);
        }
        deps.renderMe();
        await refreshNotifyLab();
      } catch (error) {
        labLog("申请权限失败：" + (error && error.message ? error.message : error));
      }
    }

    async function openBackgroundGuide(kind) {
      const buttons = [query("#labOpenBackground"), query("#labOpenAutoStart")].filter(Boolean);
      if (buttons.some(button => button.disabled)) return false;
      const feedback = query("#labSettingsFeedback");
      const report = text => {
        if (feedback) feedback.textContent = text;
        labLog(text);
      };
      buttons.forEach(button => { button.disabled = true; });
      report("正在打开系统设置…");
      let opened = false;
      try {
        const bridge = deps.systemBridge();
        const appSet = deps.appSettingsPlugin();
        if (kind === "background" && bridge && bridge.openBackgroundSettings) {
          const result = await bridge.openBackgroundSettings();
          if (result && result.ok === false) throw new Error("设置请求失败");
          opened = true;
          if (result && result.opened === "batteryOptimization") {
            report("已请求打开后台耗电设置。请找到安心收件箱并允许后台耗电；返回不代表开关已开启。");
          } else {
            report("请在应用信息中查找电池或后台运行设置；若未到对应页面，可从手机设置手动进入。开关仍需手动确认。");
          }
        } else {
          if (bridge && bridge.openAppDetailsSettings) await bridge.openAppDetailsSettings();
          else if (appSet && appSet.openAppDetailsSettings) await appSet.openAppDetailsSettings();
          else throw new Error("设置入口不可用");
          opened = true;
          report(kind === "background"
            ? "已请求打开应用信息，请查找电池或后台运行设置，允许后台耗电。开关仍需手动确认。"
            : "已请求打开应用信息。vivo 请点「查看所有权限」，确认「自启动」和「锁屏显示」；其他手机请查找相近选项。返回不代表已授权。");
        }
      } catch (error) {
        report("未能打开设置。请手动进入手机设置 → 应用 → 安心收件箱，检查后台耗电、自启动、锁屏显示。");
        deps.toast("未能打开设置，请按面板说明手动检查");
      } finally {
        buttons.forEach(button => { button.disabled = false; });
      }
      return opened;
    }

    async function openAutoStartHonest() {
      const bridge = deps.systemBridge();
      const appSet = deps.appSettingsPlugin();
      const report = text => {
        const fb = query("#labSettingsFeedback");
        if (fb) fb.textContent = text;
        labLog(text);
      };
      if (!(bridge && bridge.openAutoStartSettings)) {
        autoStartLanding = { landed: "unsupported", at: Date.now() };
        if (bridge && bridge.openAppDetailsSettings) await bridge.openAppDetailsSettings();
        else if (appSet && appSet.openAppDetailsSettings) await appSet.openAppDetailsSettings();
        else {
          report("此系统暂未找到可验证的设置路径。可以先做一次 60 秒测试确认实际效果，再决定要不要手动翻设置。");
          return false;
        }
        report("此系统没有可验证的自启动入口，已改为打开「应用详情」页。请在详情里手动查找「自启动 / 后台启动 / 耗电管理」。厂商开关读不到，勾没勾需要你自己确认。");
        return true;
      }
      const r = await bridge.openAutoStartSettings();
      const landed = r && r.component ? String(r.component) : "";
      autoStartLanding = { landed: landed || "unknown", ok: !!(r && r.ok !== false), at: Date.now() };
      if (landed === "app-details") {
        report("已打开「应用详情」页 —— 这**不是**自启动授权页。"
          + "vivo/OPPO 在应用详情里找「自启动」或「耗电管理」；ColorOS 16 的自启动列表需要系统签名权限，第三方应用打不开。"
          + "厂商开关读不到：勾没勾由你自己确认，返回这里也不会自动变绿。");
        return !!(r && r.ok !== false);
      }
      if (landed) {
        report("已请求打开厂商设置页（" + landed + "）。是否真到位、开关有没有打开，都需要你回来手动确认 —— 导航成功不等于授权成功。");
        return !!(r && r.ok !== false);
      }
      report("没能确认跳到了哪一页。请手动在手机设置里查找「自启动 / 后台启动」。");
      return false;
    }

    async function openSystemSetting(kind) {
      const bridge = deps.systemBridge();
      const appSet = deps.appSettingsPlugin();
      try {
        let opened = false;
        if (kind === "notify") {
          if (bridge && bridge.openNotificationSettings) { await bridge.openNotificationSettings(); opened = true; }
          else if (appSet && appSet.openNotificationSettings) { await appSet.openNotificationSettings(); opened = true; }
        } else if (kind === "exact") {
          if (bridge && bridge.openExactAlarmSettings) { await bridge.openExactAlarmSettings(); opened = true; }
          else if (deps.openExactAlarmSettings) { await deps.openExactAlarmSettings(); opened = true; }
        } else if (kind === "battery") {
          if (bridge && bridge.openBatterySettings) { await bridge.openBatterySettings(); opened = true; }
          else if (appSet && appSet.openBatterySettings) { await appSet.openBatterySettings(); opened = true; }
        } else if (kind === "overlay") {
          if (bridge && bridge.openOverlaySettings) { await bridge.openOverlaySettings(); opened = true; }
          else opened = await openSystemSetting("autoStart");
        } else if (kind === "fsi") {
          if (bridge && bridge.openFullScreenIntentSettings) { await bridge.openFullScreenIntentSettings(); opened = true; }
          else opened = await openSystemSetting("autoStart");
        } else if (kind === "autoStart") {
          opened = await openAutoStartHonest();
        }
        if (opened) labLog("已请求系统设置（" + kind + "），返回后请点「刷新诊断」");
        return opened;
      } catch (error) {
        deps.toast("无法打开系统设置");
        return false;
      }
    }

    /**
     * 绑定诊断面板控件。实例内幂等：第二次调用不得重复绑按钮或 visibilitychange。
     * 模块求值阶段不调用、不设闸门。
     */
    function bind() {
      if (bound) return;
      bound = true;

      const labBtn = query("#btnNotifyLab");
      if (labBtn) {
        labBtn.addEventListener("click", () => {
          deps.openSheet("sheetNotifyLab");
          refreshNotifyLab();
        });
      }
      const req = query("#labReqNotify");
      if (req) req.addEventListener("click", labRequestNotify);
      const openNotify = query("#labOpenNotify");
      if (openNotify) openNotify.addEventListener("click", () => openSystemSetting("notify"));
      const openExact = query("#labOpenExact");
      if (openExact) openExact.addEventListener("click", () => openSystemSetting("exact"));
      const openBattery = query("#labOpenBattery");
      if (openBattery) openBattery.addEventListener("click", () => openSystemSetting("battery"));
      const openOverlay = query("#labOpenOverlay");
      if (openOverlay) openOverlay.addEventListener("click", () => openSystemSetting("overlay"));
      const openFsi = query("#labOpenFsi");
      if (openFsi) openFsi.addEventListener("click", () => openSystemSetting("fsi"));
      const openAutoStart = query("#labOpenAutoStart");
      if (openAutoStart) openAutoStart.addEventListener("click", () => openBackgroundGuide("permissions"));
      const openBackground = query("#labOpenBackground");
      if (openBackground) openBackground.addEventListener("click", () => openBackgroundGuide("background"));
      const traceTest = query("#labTraceTest");
      if (traceTest) traceTest.addEventListener("click", labTraceTest);
      const testNow = query("#labTestNow");
      if (testNow) testNow.addEventListener("click", labShowNow);
      const test10 = query("#labTest10s");
      if (test10) test10.addEventListener("click", () => labScheduleAlarm(10000, "10 秒"));
      const test60 = query("#labTest60s");
      if (test60) test60.addEventListener("click", () => labScheduleAlarm(60000, "1 分钟"));
      const cancel = query("#labCancelAlarm");
      if (cancel) cancel.addEventListener("click", labCancelAlarms);
      const refresh = query("#labRefresh");
      if (refresh) refresh.addEventListener("click", refreshNotifyLab);
      const resync = query("#labResync");
      if (resync) {
        resync.addEventListener("click", async () => {
          labLog("正在重新对账…");
          try {
            const status = await deps.syncNativeRemindersNow({ forceRebuild: true });
            const diag = await refreshNotifyLab();
            const v = await renderBackgroundVerdict(diag);
            labLog("重排完成 · " + v.label + " · " + v.text +
              "（本轮计划 " + (Number(status && status.desired) || 0) + " 条，" +
              "全屏闹钟 " + (Number(status && status.alarmCount) || 0) + " 条）");
          } catch (error) {
            labLog("重排失败：" + (error && error.message ? error.message : String(error)));
          }
        });
      }

      const doc = deps.getDocument();
      if (doc && typeof doc.addEventListener === "function") {
        doc.addEventListener("visibilitychange", () => {
          if (doc.visibilityState !== "visible") return;
          const sheet = query("#sheetNotifyLab");
          if (sheet && sheet.classList.contains("open")) refreshNotifyLab();
        });
      }
    }

    return {
      bind,
      refreshNotifyLab,
      refreshAlarmTrace,
      labLog,
      labCancelAlarms,
      describeAlarmDelivery,
      openSystemSetting,
      openBackgroundGuide,
      labRequestNotify,
      labScheduleAlarm,
      labShowNow,
      labTraceTest,
      renderBackgroundVerdict,
      getAutoStartLanding: () => autoStartLanding
    };
  }

  return {
    createAppDiagnostics,
    INSTANCE_CONTRACT
  };
});
