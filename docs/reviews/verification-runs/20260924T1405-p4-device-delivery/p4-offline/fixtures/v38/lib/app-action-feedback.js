/* P3-I: Save result & native schedule feedback controller.
 * UMD factory: evaluation performs no I/O, no DOM querying, and no state mutation.
 */
(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.AppActionFeedback = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";

  function createAppActionFeedback(input) {
    const deps = input || {};
    const REQUIRED_DEPS = [
      "getState",
      "getNativeReminderStatus",
      "isNativeReady",
      "isNativeAndroidRuntime",
      "toast",
      "undoNewItem",
      "openDetail",
      "openSheet",
      "openReviewSession",
      "refreshNotifyLab",
      "restoreItemForm",
      "queueNativeReminderSync"
    ];
    REQUIRED_DEPS.forEach(function(name) {
      if (typeof deps[name] !== "function") {
        throw new Error("createAppActionFeedback(deps) 缺少必要依赖：" + name);
      }
    });

    let feedbackWaiters = [];
    const FEEDBACK_WAIT_MS = 30 * 1000;

    function getFeedbackApi() {
      if (typeof deps.getFeedbackLib === "function") {
        const f = deps.getFeedbackLib();
        if (f) return f;
      }
      return (root.AttentionLib && root.AttentionLib.Feedback) || null;
    }

    function getEvidenceApi() {
      if (typeof deps.getEvidenceLib === "function") {
        const e = deps.getEvidenceLib();
        if (e) return e;
      }
      return (root.AttentionLib && root.AttentionLib.DeliveryEvidence) || null;
    }

    function getNativeRemindersApi() {
      if (typeof deps.getNativeReminders === "function") {
        const n = deps.getNativeReminders();
        if (n) return n;
      }
      return (typeof AttentionNativeReminders !== "undefined" && AttentionNativeReminders) ||
        (root.AttentionNativeReminders || null);
    }

    /**
     * 本条事项的排程证据 —— 只吃这一条的证据，不看全局。
     */
    function itemScheduleEvidence(it) {
      if (!it) return null;
      const events = it.reminderEvents && typeof it.reminderEvents === "object" ? it.reminderEvents : null;
      if (!events) return null;
      const base = Number(it.triggerAt) || 0;
      const EvidenceLib = getEvidenceApi();
      const keys = Object.keys(events).filter(function(k) {
        const at = Number(String(k).split("@")[1]);
        if (!Number.isFinite(at)) return false;
        if (!base) return true;
        if (at < base) return false;
        const round = EvidenceLib && typeof EvidenceLib.entryRoundBase === "function"
          ? EvidenceLib.entryRoundBase(it, events[k], k) : base;
        return Number(round) === base;
      });
      if (!keys.length) return null;
      let scheduled = false;
      let delivered = false;
      keys.forEach(function(k) {
        const s = events[k] && events[k].state;
        if (s === "delivered") delivered = true;
        else if (s === "scheduled") scheduled = true;
      });
      if (delivered) return "delivered";
      if (scheduled) return "scheduled";
      return null;
    }

    /** 喂给判定层的原生侧事实（只读，不改任何状态）。 */
    function feedbackNativeSnapshot() {
      const s = deps.getNativeReminderStatus() || {};
      const state = deps.getState() || {};
      return {
        isNative: !!deps.isNativeAndroidRuntime(),
        bridgeReady: !!deps.isNativeReady(),
        notifySwitch: !!(state.settings && state.settings.notify),
        notifications: s.notifications || "unknown",
        exactAlarm: s.exactAlarm || "unknown",
        reliability: s.reliability || "unknown",
        capabilities: s.capabilities || null,
        alarmCount: s.alarmCount || 0,
        alarmScheduled: s.alarmScheduled || 0
      };
    }

    function feedbackItemSnapshot(it) {
      if (!it) return null;
      return {
        id: it.id,
        hasTrigger: !!it.triggerAt,
        isFallbackTrigger: !!it.isFallbackTrigger,
        priority: it.priority,
        deliveryMode: it.delivery_mode,
        repeat: it.repeat || null,
        deadlineAt: it.deadlineAt || null,
        triggerAt: it.triggerAt || null
      };
    }

    /**
     * 保存/排程反馈的最终判定。
     */
    function feedbackVerdictFor(it, waiter) {
      const feedbackApi = getFeedbackApi();
      if (waiter && waiter.rev != null && it && it.rev != null && it.rev !== waiter.rev) {
        return {
          kind: "superseded",
          text: "已保存 · 这条之后又被改过，以最新设置为准",
          actionLabel: "查看",
          actionKind: "open-item",
          tone: "info"
        };
      }
      const evidence = itemScheduleEvidence(it);
      const ctx = {
        persistence: waiter && waiter.persistence ? waiter.persistence : "confirmed",
        item: feedbackItemSnapshot(it),
        native: feedbackNativeSnapshot(),
        itemScheduled: evidence === "scheduled" || evidence === "delivered" ? true : null
      };
      if (!feedbackApi || typeof feedbackApi.reminderFeedback !== "function") {
        return { kind: "unknown", text: "已保存，提醒安排尚未确认", actionLabel: "查看状态", actionKind: "open-status", tone: "info" };
      }
      return feedbackApi.reminderFeedback(ctx);
    }

    function runFeedbackAction(kind, it, waiter) {
      if (kind === "retry-save") {
        if (waiter && waiter.draft) {
          deps.restoreItemForm(waiter.draft);
          deps.openSheet("sheetItem");
        }
        return;
      }
      if (kind === "open-review") { deps.openReviewSession(); return; }
      if (kind === "open-settings") {
        deps.openSheet("sheetNotifyLab");
        deps.refreshNotifyLab();
        return;
      }
      if (kind === "open-status") {
        if (it) deps.openDetail(it.id);
        else { deps.openSheet("sheetNotifyLab"); deps.refreshNotifyLab(); }
        return;
      }
      if (kind === "explain-web") {
        if (it) deps.openDetail(it.id);
        return;
      }
      if (kind === "retry-schedule") { deps.queueNativeReminderSync("save-feedback-retry"); return; }
      if (kind === "open-item" && it) { deps.openDetail(it.id); return; }
      if (it) { deps.openDetail(it.id); return; }
    }

    /**
     * 保存结果的唯一反馈出口（F08）。
     */
    function announceSaveOutcome(itemId, waiter) {
      const state = deps.getState() || { items: [] };
      const it = (state.items || []).find(function(x) { return x.id === itemId; });
      waiter = waiter || {};
      waiter.itemId = itemId;
      waiter.rev = it && it.rev != null ? it.rev : null;
      waiter.at = Date.now();
      waiter.draft = waiter.draft || null;
      waiter.needs = !!waiter.needs;
      feedbackWaiters = feedbackWaiters.filter(function(w) { return Date.now() - w.at < FEEDBACK_WAIT_MS; });
      feedbackWaiters.push(waiter);

      const feedbackApi = getFeedbackApi();
      const pending = (feedbackApi && typeof feedbackApi.reminderFeedback === "function")
        ? feedbackApi.reminderFeedback({ persistence: "confirmed", item: feedbackItemSnapshot(it), native: feedbackNativeSnapshot(), itemScheduled: null })
        : { text: "已保存，提醒安排尚未确认" };

      const undoSecond = (!waiter.editing && waiter.allowUndo !== false && it)
        ? { label: "撤销", onClick: function() { return deps.undoNewItem(itemId, waiter.rev); } }
        : null;
      const undoCtx = undoSecond
        ? { durationMs: (feedbackApi && feedbackApi.UNDO_WINDOW_MS) || 8000 }
        : null;

      const decorate = function(v) {
        if (!waiter.needs) return v;
        const text = /待整理/.test(v.text) ? v.text : v.text + " · 待整理";
        return Object.assign({}, v, { text: text, actionLabel: "去整理", actionKind: "open-review" });
      };

      const first = decorate({ text: "已保存 · 正在安排提醒", actionLabel: "查看", actionKind: "open-item" });
      deps.toast(first.text, first.actionLabel, function() { if (it) deps.openDetail(itemId); }, undoSecond, undoCtx);

      const nativeReady = !!deps.isNativeReady();
      const nativeReminders = getNativeRemindersApi();

      if (!nativeReady || !nativeReminders || typeof nativeReminders.reconcile !== "function") {
        feedbackWaiters = feedbackWaiters.filter(function(w) { return w !== waiter; });
        const cur = (state.items || []).find(function(x) { return x.id === itemId; });
        const v = decorate(feedbackVerdictFor(cur, waiter));
        deps.toast(v.text, v.actionLabel, function() { return runFeedbackAction(v.actionKind, cur, waiter); }, undoSecond, undoCtx);
        return;
      }

      if (pending.kind === "no-time" || pending.kind === "web" || pending.kind === "switch-off") {
        feedbackWaiters = feedbackWaiters.filter(function(w) { return w !== waiter; });
        const cur = (state.items || []).find(function(x) { return x.id === itemId; });
        const v = decorate(pending);
        deps.toast(v.text, v.actionLabel, function() { return runFeedbackAction(v.actionKind, cur, waiter); }, undoSecond, undoCtx);
      }
    }

    /**
     * 一轮对账落定后，把等待中的保存反馈按本条目的结果更新。
     */
    function settleSaveFeedback() {
      if (!feedbackWaiters.length) return;
      const waiters = feedbackWaiters.splice(0, feedbackWaiters.length);
      const state = deps.getState() || { items: [] };
      const feedbackApi = getFeedbackApi();
      waiters.forEach(function(w) {
        const it = (state.items || []).find(function(x) { return x.id === w.itemId; });
        if (!it) return;
        const v = feedbackVerdictFor(it, w);
        const remaining = Math.max(0, ((feedbackApi && feedbackApi.UNDO_WINDOW_MS) || 8000) - (Date.now() - w.at));
        const undoSecond = (!w.editing && w.allowUndo !== false && remaining > 0)
          ? { label: "撤销", onClick: function() { return deps.undoNewItem(it.id, w.rev); } }
          : null;
        deps.toast(v.text, v.actionLabel, function() { return runFeedbackAction(v.actionKind, it, w); },
          undoSecond, undoSecond ? { durationMs: remaining } : null);
      });
    }

    function getFeedbackWaiters() {
      return feedbackWaiters.slice();
    }

    return {
      announceSaveOutcome: announceSaveOutcome,
      settleSaveFeedback: settleSaveFeedback,
      itemScheduleEvidence: itemScheduleEvidence,
      feedbackNativeSnapshot: feedbackNativeSnapshot,
      feedbackItemSnapshot: feedbackItemSnapshot,
      feedbackVerdictFor: feedbackVerdictFor,
      runFeedbackAction: runFeedbackAction,
      getFeedbackWaiters: getFeedbackWaiters
    };
  }

  return {
    createAppActionFeedback: createAppActionFeedback
  };
});
