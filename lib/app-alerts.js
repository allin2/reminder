/* P3-G Web alerts, due tick, active alarm panel and polling.
 * UMD factory; evaluation and factory creation perform no IO, state mutation, global listeners, or native bridge calls.
 */
(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.AppAlerts = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";

  function createAppAlerts(input) {
    const deps = input || {};
    const REQUIRED_DEPS = [
      "getState", "save", "bumpRev", "runUserOp", "committedItemById",
      "systemBridge", "handleAlarmAction", "alarmEventSeen",
      "promoteDue", "maybeReviewSession", "priorityRank", "shouldRealert", "markReminded",
      "hasKnownRev", "isTerminal", "toast", "escapeHtml", "updateAppBadge",
      "renderHome", "renderStats", "query", "queryAll",
      "ackItem", "reviewItem", "completeItem", "openSnoozeSheet", "snoozeItem", "openDetail", "openReviewSession",
      "isNativeAndroid"
    ];
    REQUIRED_DEPS.forEach(function(name) {
      if (typeof deps[name] !== "function") {
        throw new Error("createAppAlerts(deps) 缺少依赖：" + name);
      }
    });

    let alertItem = null;
    let alertReturnFocus = null;
    const dismissedAlerts = Object.create(null);
    let alertAutoHideTimer = null;
    let activeAlarmRefreshBusy = false;
    let activeAlarmPanelSignature = "";
    let activeAlarmPollTimer = null;
    let tickTimer = null;
    let alertControlsBound = false;
    /**
     * 本次绑定登记过的监听器（回滚用）。
     *
     * 绑定是**一个事务**：中途抛错时先把已挂上的监听器全部摘掉再上抛，重试才是一次
     * 干净的起点；只把标志位挪到末尾只能救「第一行就抛」，救不了「绑到一半才抛」。
     */
    let registered = [];

    function listen(target, type, handler, options) {
      if (!target || typeof target.addEventListener !== "function") return;
      target.addEventListener(type, handler, options);
      registered.push({ target: target, type: type, handler: handler, options: options });
    }

    function rollbackListeners() {
      while (registered.length) {
        const record = registered.pop();
        try {
          record.target.removeEventListener(record.type, record.handler, record.options);
        } catch (error) {}
      }
    }

    function getNow() {
      return typeof deps.now === "function" ? deps.now() : Date.now();
    }

    function getAlertItem() {
      return alertItem;
    }

    function getDismissedAlerts() {
      return dismissedAlerts;
    }

    function clearAlert() {
      hideAlert();
    }

    function shouldSkipAlert(it) {
      if (!it) return true;
      const now = getNow();
      const until = it.dismissedUntil || 0;
      if (until > now) return true;
      const at = dismissedAlerts[it.id];
      if (!at) return false;
      return now - at < 30 * 60 * 1000;
    }

    function showSystemNotification(opts) {
      opts = opts || {};
      const state = deps.getState() || {};
      const settings = state.settings || {};
      if (!settings.notify) return;
      if (deps.isNativeAndroid && deps.isNativeAndroid()) return;
      const N = typeof window !== "undefined" ? window.Notification : null;
      if (!N || N.permission !== "granted") return;
      const privacy = !!settings.privacyNotify;
      const payload = {
        title: privacy ? "安心收件箱提醒" : (opts.title || "安心收件箱提醒"),
        body: privacy ? "有一条事项需要你确认" : (opts.body || ""),
        tag: opts.tag || "attention",
        requireInteraction: !!opts.requireInteraction,
        data: opts.data || {},
        actions: opts.actions || []
      };
      if (typeof navigator !== "undefined" && navigator.serviceWorker && navigator.serviceWorker.controller) {
        try {
          navigator.serviceWorker.controller.postMessage({
            type: "SHOW_NOTIFICATION",
            notification: payload
          });
          return;
        } catch (e) {}
      }
      try {
        new Notification(payload.title, {
          body: payload.body,
          tag: payload.tag,
          requireInteraction: payload.requireInteraction,
          data: payload.data
        });
      } catch (e) {}
    }

    function showAlert(it) {
      if (!it) return;
      if (!alertItem && typeof document !== "undefined") alertReturnFocus = document.activeElement;
      alertItem = it;
      const b = deps.query("#alertBanner");
      if (b) {
        b.inert = false;
        b.setAttribute("aria-hidden", "false");
        b.classList.toggle("crit", it.priority === "critical");
        b.classList.add("show");
      }
      const titleEl = deps.query("#alertTitle");
      if (titleEl) {
        titleEl.textContent =
          it.priority === "critical" ? "🚨 关键提醒" :
          it.priority === "important" ? "☆ 重要提醒" : "提醒";
      }
      const bodyEl = deps.query("#alertBody");
      if (bodyEl) {
        bodyEl.textContent = it.title + (it.note ? " · " + it.note : "");
      }
      // D14：挂 10 分钟自动收起（纯展示，不记账、不消耗提醒预算）
      if (alertAutoHideTimer) clearTimeout(alertAutoHideTimer);
      alertAutoHideTimer = setTimeout(() => {
        if (alertItem && alertItem.id === it.id) {
          hideAlert();
        }
      }, 10 * 60 * 1000);

      showSystemNotification({
        title: it.priority === "critical" ? "🚨 关键事项" :
               it.priority === "important" ? "☆ 重要事项" : "安心收件箱提醒",
        body: it.title,
        tag: "item-" + it.id,
        requireInteraction: it.priority !== "normal",
        data: { itemId: it.id },
        actions: [
          { action: "ack", title: "已知晓" },
          { action: "review", title: "待整理" },
          { action: "snooze", title: "稍后 2 小时" },
          { action: "done", title: "完成" }
        ]
      });

      if (typeof navigator !== "undefined" && navigator.vibrate && it.priority !== "normal") {
        try {
          navigator.vibrate(it.priority === "critical" ? [80, 40, 80, 40, 120] : [60, 40, 60]);
        } catch (e) {}
      }
      deps.updateAppBadge();
    }

    function hideAlert() {
      if (alertAutoHideTimer) {
        clearTimeout(alertAutoHideTimer);
        alertAutoHideTimer = null;
      }
      const b = deps.query("#alertBanner");
      if (b) {
        // 提醒出现时不抢输入焦点；收起时不能把焦点留在屏幕外的按钮上。
        if (typeof document !== "undefined" && b.contains && b.contains(document.activeElement)) {
          if (alertReturnFocus && alertReturnFocus.isConnected && typeof alertReturnFocus.focus === "function") {
            alertReturnFocus.focus();
          } else if (document.activeElement && typeof document.activeElement.blur === "function") {
            document.activeElement.blur();
          }
        }
        b.classList.remove("show");
        b.inert = true;
        b.setAttribute("aria-hidden", "true");
      }
      alertItem = null;
      alertReturnFocus = null;
    }

    function applyAlertDismissal(itemId, until) {
      const state = deps.getState() || {};
      const items = state.items || [];
      const item = items.find(x => x.id === itemId);
      if (!item) return false;
      item.dismissedUntil = until;
      deps.bumpRev(item);
      return true;
    }

    async function dismissAlert() {
      if (alertItem) {
        const itemToDismiss = alertItem;
        const now = getNow();
        const applied = deps.runUserOp(
          applyAlertDismissal,
          [itemToDismiss.id, now + 30 * 60 * 1000],
          { userFacing: true, itemArg: 0, name: "dismissAlert" }
        );
        if (applied === false) return false;
        try {
          const p = deps.save();
          if (p && typeof p.then === "function") {
            await p;
          } else if (!p) {
            // 没有权威提交回执（例如底层保存未发生或被抑制）
            return false;
          }
        } catch (err) {
          return false;
        }
        dismissedAlerts[itemToDismiss.id] = now;
      }
      hideAlert();
      deps.toast("已关闭提醒 · 事项仍在首页");
      return true;
    }

    function tick() {
      deps.promoteDue();
      deps.maybeReviewSession();
      const now = getNow();
      const state = deps.getState() || {};
      const items = state.items || [];
      const settings = state.settings || {};
      const candidates = items.filter(it => {
        if (it.status !== "due") return false;
        if (shouldSkipAlert(it)) return false;
        if (!it.lastAlertShownAt) return true;
        return deps.shouldRealert(it, now, {
          importantRepeat: settings.importantRepeat !== false,
          dismissedAt: dismissedAlerts[it.id] || null
        });
      });
      if (!alertItem && candidates.length) {
        candidates.sort((a, b) => {
          const pr = deps.priorityRank(a.priority) - deps.priorityRank(b.priority);
          if (pr !== 0) return pr;
          return (a.triggerAt || 0) - (b.triggerAt || 0);
        });
        const next = candidates[0];
        if (next.lastAlertShownAt) deps.markReminded(next, now);
        next.lastAlertShownAt = now;
        deps.save();
        showAlert(next);
      }
      const ui = state.ui || {};
      if (ui.tab === "home") deps.renderHome();
      else if (ui.tab === "me") deps.renderStats();
    }

    function bindAlertControls() {
      if (alertControlsBound) return;
      registered = [];
      try {
        bindAlertControlNodes();
        alertControlsBound = true;
      } catch (error) {
        rollbackListeners();
        throw error;
      } finally {
        registered = [];
      }
    }

    /**
     * AC-05：弹条「待整理」按钮本体。
     *
     * 其余弹条按钮是 index.html 的静态标记；这个按钮运行期补挂 —— 静态标记属于
     * UI 层资产，运行期创建让已有 DOM 不改一行也能拿到完整动作集。必须**先
     * query 后 create**：测试夹具的 query 会自动建节点（绑定照常、插入无意义），
     * 真实 DOM 则 query 落空再真创建并插进 .alert-actions（放在「完成」前，
     * 与「我知道了/稍后」并列）。
     */
    function ensureAlertReviewButton() {
      const existing = deps.query("#alertReview");
      if (existing) return existing;
      const doc = (typeof document !== "undefined") && document;
      if (!doc || typeof doc.createElement !== "function") return null;
      const btn = doc.createElement("button");
      if (!btn) return null;
      btn.id = "alertReview";
      btn.innerHTML = "待整理<span class=\"act-sub\">先收下，稍后整理</span>";
      let container = null;
      const banner = deps.query("#alertBanner");
      if (banner && typeof banner.querySelector === "function") container = banner.querySelector(".alert-actions");
      if (!container && typeof doc.querySelector === "function") container = doc.querySelector("#alertBanner .alert-actions");
      if (container && typeof container.appendChild === "function") {
        let anchor = null;
        if (typeof container.querySelector === "function") anchor = container.querySelector("#alertDone");
        if (anchor && typeof container.insertBefore === "function") container.insertBefore(btn, anchor);
        else container.appendChild(btn);
      }
      return btn;
    }

    /**
     * AC-07：弹条动作被业务层拒绝时的唯一出口。
     *
     * ackItem/completeItem/reviewItem 返回 false（事项已终态、已被删除、或正被
     * 别的动作占用）时**绝不能静默 return** —— 弹条还挂在屏幕上，用户再点多少次
     * 都没有任何反馈，感知就是「点了没反应」。这里先收起这条已经过时的弹条，
     * 再按事项当前状态给出一句明确的话。
     */
    function failAlert() {
      const id = alertItem ? alertItem.id : null;
      hideAlert();
      const item = id && deps.committedItemById ? deps.committedItemById(id) : null;
      if (!item || deps.isTerminal(item)) deps.toast("这条事项已处理 · 提醒已收起");
      else deps.toast("操作没有生效 · 请重试");
    }

    /** 绑定的**事务体**：全部注册动作都在这里。 */
    function bindAlertControlNodes() {
      const btnClose = deps.query("#alertClose");
      if (btnClose) {
        listen(btnClose, "click", async e => {
          if (e && typeof e.stopPropagation === "function") e.stopPropagation();
          await dismissAlert();
        });
      }
      const btnAck = deps.query("#alertAck");
      if (btnAck) {
        listen(btnAck, "click", () => {
          if (!alertItem) { hideAlert(); return; }
          if (deps.ackItem(alertItem.id, true) === false) { failAlert(); return; }
          deps.toast("已确认看到");
          hideAlert();
        });
      }
      const btnDone = deps.query("#alertDone");
      if (btnDone) {
        listen(btnDone, "click", () => {
          if (!alertItem) { hideAlert(); return; }
          if (deps.completeItem(alertItem.id) === false) { failAlert(); return; }
          hideAlert();
        });
      }
      const btnSnooze = deps.query("#alertSnooze");
      if (btnSnooze) {
        listen(btnSnooze, "click", () => {
          if (!alertItem) { hideAlert(); return; }
          const id = alertItem.id;
          if (deps.openSnoozeSheet(id) !== false) {
            hideAlert();
          } else {
            failAlert();
          }
        });
      }
      // AC-05：弹条「待整理」—— 收下并进整理箱（基线 §7：从提醒直达待整理，
      // 一次操作同时落 ACK + NEEDS_REVIEW，不新建条目、不留下「已看到未完成」的卡死态）。
      const btnReview = ensureAlertReviewButton();
      if (btnReview) {
        listen(btnReview, "click", () => {
          if (!alertItem) { hideAlert(); return; }
          if (deps.reviewItem(alertItem.id, true) === false) { failAlert(); return; }
          deps.toast("已收下 · 已加入待整理");
          hideAlert();
        });
      }
    }

    function handleNotificationAction(data) {
      if (!data) return false;
      const id = data.itemId;
      if (id === "review-session" || data.tag === "review-session") {
        deps.openReviewSession();
        return true;
      }
      if (!id) return false;
      if (data.action === "review") {
        // AC-05：通知侧同款「待整理」—— ACK + NEEDS_REVIEW 一个事务，与弹条按钮同语义。
        if (deps.reviewItem(id, true) === false) return false;
        deps.toast("已收下 · 已加入待整理");
        hideAlert();
        return true;
      }
      if (data.action === "ack") {
        if (deps.ackItem(id, true) === false) return false;
        deps.toast("已从通知确认看到");
        hideAlert();
        return true;
      } else if (data.action === "done") {
        if (deps.completeItem(id) === false) return false;
        hideAlert();
        return true;
      } else if (data.action === "snooze") {
        // D11：快捷稍后固定 2 小时
        const now = getNow();
        if (deps.snoozeItem(id, now + 2 * 3600000) === false) return false;
        hideAlert();
        return true;
      } else {
        deps.openDetail(id);
        return true;
      }
    }

    // Native deliveries can outlive their window, or have no item (diagnostic/removed item).
    function deliveryHandledByCommittedItem(alarm, item) {
      if (!item) return false;
      if (deps.isTerminal(item)) return true;
      // ACK/snooze only ends an older delivery; a new deadline alert with the current
      // revision is independent and must remain actionable.
      return (item.status === "acknowledged" || item.status === "snoozed") &&
        deps.hasKnownRev(alarm.itemRev) && Number(item.rev) > Number(alarm.itemRev);
    }

    async function completeActiveAlarm(alarm) {
      const bridge = deps.systemBridge();
      if (!bridge) throw new Error("原生桥不可用");
      const eventId = "active:" + alarm.token + ":done";
      const completed = await deps.handleAlarmAction({
        action: "done",
        itemId: alarm.itemId,
        itemRev: alarm.itemRev,
        alarmEventId: eventId
      });
      if (!completed && !deps.alarmEventSeen(eventId)) {
        throw new Error("提醒已变更，请在事项详情中确认；仍可停止声振");
      }
      await bridge.stopAlarmDelivery({ id: alarm.id, token: alarm.token });
      return true;
    }

    async function refreshActiveAlarmPanel(reveal) {
      const host = deps.query("#activeAlarmPanel");
      const bridge = deps.systemBridge();
      if (!host || !bridge || !bridge.activeAlarmDeliveries || activeAlarmRefreshBusy) return;
      activeAlarmRefreshBusy = true;
      try {
        const result = await bridge.activeAlarmDeliveries();
        const state = deps.getState() || {};
        const items = state.items || [];
        const rows = [];
        for (const alarm of (result && result.alarms) || []) {
          const item = items.find(it => it.id === alarm.itemId);
          // Current committed item state wins over an old delivery; never change it from a stale alarm.
          const committedItem = deps.committedItemById ? deps.committedItemById(alarm.itemId) : null;
          if (deliveryHandledByCommittedItem(alarm, committedItem)) {
            await bridge.stopAlarmDelivery({ id: alarm.id, token: alarm.token });
            continue;
          }
          const canComplete = item && deps.hasKnownRev(alarm.itemRev) && Number(item.rev) === Number(alarm.itemRev);
          rows.push({ alarm, item, canComplete });
        }
        const signature = JSON.stringify(rows.map(({alarm, item}) => [alarm, item && item.title, item && item.rev]));
        if (signature === activeAlarmPanelSignature) {
          if (reveal && rows.length && typeof host.scrollIntoView === "function") {
            host.scrollIntoView({ block: "start" });
          }
          return;
        }
        activeAlarmPanelSignature = signature;
        host.hidden = rows.length === 0;
        host.innerHTML = rows.map(({alarm, item, canComplete}, index) =>
          '<div class="card" style="margin-bottom:12px;padding:16px;border:2px solid var(--accent)">' +
          '<strong>闹钟待处理</strong><p>' + deps.escapeHtml(item ? item.title : alarm.title || "闹钟提醒") + '</p>' +
          '<p style="color:var(--muted)">' + deps.escapeHtml(item ? "全屏未显示时，也可以在这里处理。" :
            "测试提醒或原事项已不存在，仍可停止声振。") + '</p>' +
          '<button class="btn" data-alarm-stop="' + index + '">停止声振</button> ' +
          (canComplete ? '<button class="btn" data-alarm-done="' + index + '">完成事项</button>' : '') + '</div>'
        ).join("");
        if (reveal && rows.length && typeof host.scrollIntoView === "function") {
          host.scrollIntoView({ block: "start" });
        }
        const buttons = host.querySelectorAll ? host.querySelectorAll("[data-alarm-stop], [data-alarm-done]") : [];
        buttons.forEach(button => {
          button.addEventListener("click", async () => {
            button.disabled = true;
            const done = button.hasAttribute("data-alarm-done");
            const row = rows[Number(button.getAttribute(done ? "data-alarm-done" : "data-alarm-stop"))];
            try {
              if (done) {
                // Persist completion first; a failed save must remain visible and retryable.
                await completeActiveAlarm(row.alarm);
              } else {
                await bridge.stopAlarmDelivery({ id: row.alarm.id, token: row.alarm.token });
              }
              activeAlarmPanelSignature = "";
              deps.toast(done ? "已完成并停止声振" : "已停止本次声振，事项状态未改变");
              await refreshActiveAlarmPanel();
            } catch (error) {
              deps.toast(error.message || "操作失败，请重试");
            } finally {
              button.disabled = false;
            }
          });
        });
      } catch (error) {
        // Keep existing stop controls on a transient bridge failure.
      } finally {
        activeAlarmRefreshBusy = false;
      }
    }

    function startPolling() {
      stopPolling();
      activeAlarmPollTimer = setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") {
          refreshActiveAlarmPanel();
        }
      }, 2000);
      tickTimer = setInterval(() => {
        tick();
      }, 15000);
    }

    function stopPolling() {
      if (activeAlarmPollTimer != null) {
        clearInterval(activeAlarmPollTimer);
        activeAlarmPollTimer = null;
      }
      if (tickTimer != null) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
    }

    function onVisibilityChange() {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        refreshActiveAlarmPanel(true);
        tick();
      }
    }

    return {
      showAlert: showAlert,
      hideAlert: hideAlert,
      dismissAlert: dismissAlert,
      applyAlertDismissal: applyAlertDismissal,
      shouldSkipAlert: shouldSkipAlert,
      showSystemNotification: showSystemNotification,
      tick: tick,
      getAlertItem: getAlertItem,
      clearAlert: clearAlert,
      bindAlertControls: bindAlertControls,
      handleNotificationAction: handleNotificationAction,
      deliveryHandledByCommittedItem: deliveryHandledByCommittedItem,
      completeActiveAlarm: completeActiveAlarm,
      refreshActiveAlarmPanel: refreshActiveAlarmPanel,
      startPolling: startPolling,
      stopPolling: stopPolling,
      onVisibilityChange: onVisibilityChange
    };
  }

  return {
    createAppAlerts: createAppAlerts
  };
});
