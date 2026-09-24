/* P3-A model layer. UMD factory; evaluation has no state, DOM, or timer side effects. */
(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else { root.AttentionLib = root.AttentionLib || {}; root.AttentionLib.AppModel = factory(root); }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";

  function createAppModel(input) {
    const deps = input || {};
    ["uid", "now", "getDefaultDeliveryMode", "migrateNativeItem"].forEach(k => {
      if (typeof deps[k] !== "function") throw new Error("createAppModel(deps) 缺少依赖：" + k);
    });
    const SCHEMA = 5;
    const PROJECT_COLORS = ["#1b6b4a", "#3d5a80", "#9a6b12", "#8f3a3a", "#5b4b8a", "#2f6f7a"];
    function createInitialState() {
      return {
        schema: SCHEMA, items: [], notes: [], projects: [],
        settings: {
          notify: false, notifyPrompted: false, userMode: "beginner", onboardDone: false,
          dnd: true, importantRepeat: true, quietStart: "23:00", quietEnd: "07:30",
          dailySummary: false, privacyNotify: false, lastSummaryAt: 0,
          defaultDeliveryMode: "notification",
          review: { enabled: true, hour: 21, minute: 30, windowEndHour: 23, windowEndMinute: 0,
            followupMs: 60 * 60 * 1000, maxFollowups: 2, lastNotifiedAt: 0,
            followupCount: 0, snoozedUntil: 0, skippedUntil: 0, sessionStatus: "idle", lastSessionKey: "" },
          ai: { enabled: false, baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini", autoOnSave: false }
        },
        ui: { tab: "home", futureSeg: "waiting", futureFilter: "all", notesFilter: "all",
          calMonth: null, calSelected: null, snoozeId: null, detailId: null, editItemId: null,
          editNoteId: null, notePin: false, projectColor: PROJECT_COLORS[0], reviewIndex: 0,
          reviewQueue: [], activeExpanded: false }
      };
    }
    function normalizeItem(it) {
      const item = {
        id: it.id || deps.uid(), title: it.title || "未命名", note: it.note || "",
        tags: Array.isArray(it.tags) ? it.tags : [], url: it.url || "", projectId: it.projectId || "",
        priority: it.priority || "normal", status: it.status || "waiting", triggerAt: it.triggerAt || null,
        windowStart: it.windowStart || null, windowEnd: it.windowEnd || null, deadlineAt: it.deadlineAt || null,
        repeat: it.repeat || null, createdAt: it.createdAt || deps.now(), acknowledgedAt: it.acknowledgedAt || null,
        completedAt: it.completedAt || null, snoozeCount: it.snoozeCount || 0, deliveredAt: it.deliveredAt || null,
        remindCount: it.remindCount || 0, lastRemindAt: it.lastRemindAt || null,
        lastAlertShownAt: it.lastAlertShownAt || null, scheduleBasis: it.scheduleBasis || null,
        localTrigger: it.localTrigger || null, snoozedAt: it.snoozedAt || null,
        snoozeDelayMs: it.snoozeDelayMs == null ? null : it.snoozeDelayMs,
        dismissedUntil: it.dismissedUntil || null, review_status: it.review_status || "READY",
        reviewed_at: it.reviewed_at || null, sourceTitle: it.sourceTitle || "", sourceApp: it.sourceApp || "",
        delivery_mode: it.delivery_mode || null, isFallbackTrigger: !!it.isFallbackTrigger,
        deadlineStageKey: it.deadlineStageKey || null,
        deadlineEvents: it.deadlineEvents && typeof it.deadlineEvents === "object" ? it.deadlineEvents : {},
        reminderEvents: it.reminderEvents && typeof it.reminderEvents === "object" ? it.reminderEvents : {},
        deadlinePaused: !!it.deadlinePaused, ackAdvancedAt: it.ackAdvancedAt || null,
        rev: it.rev == null ? 1 : Number(it.rev),
        seriesId: it.seriesId || (it.repeat && it.repeat.every ? "s_" + deps.uid() : null),
        repeatParentId: it.repeatParentId || null
      };
      if (!item.delivery_mode) item.delivery_mode = (item.priority === "important" || item.priority === "critical")
        ? "alarm" : (deps.getDefaultDeliveryMode() || "notification");
      deps.migrateNativeItem(item);
      return item;
    }
    function resolveDeliveryMode(priority) {
      return priority === "important" || priority === "critical" ? "alarm" :
        (deps.getDefaultDeliveryMode() === "alarm" ? "alarm" : "notification");
    }
    function makeItem(o) {
      if (o && o.delivery_mode == null && o.priority) o = Object.assign({}, o, { delivery_mode: resolveDeliveryMode(o.priority) });
      return normalizeItem(o);
    }
    function bumpRev(it) { if (it) it.rev = (Number(it.rev) || 0) + 1; }
    function isTerminal(it) { return !!it && (it.status === "archived" || it.status === "completed"); }
    function hasKnownRev(rev) { if (rev == null || rev === "") return false; const n = Number(rev); return Number.isFinite(n) && n > 0; }
    /**
     * 「这条事项现在算不算到期」——**纯谓词**，只依赖事项自身与一个时刻。
     *
     * 为什么它是模型层的：它回答的是「事项处于什么状态」，不是「界面怎么画」，
     * 也不是「谁来保存」。终态（completed / archived / acknowledged）一律不算到期，
     * 显式 `status === "due"` 直接算到期，否则按 `triggerAt <= now` 判定。
     * 缺 `triggerAt` 的（例如「先收下 · 待整理」）永远不算到期 —— 没有时间就没有承诺。
     */
    function isDue(item, now) {
      if (!item) return false;
      const at = now == null ? deps.now() : now;
      if (item.status === "completed" || item.status === "archived" || item.status === "acknowledged") return false;
      if (item.status === "due") return true;
      if (!item.triggerAt) return false;
      return item.triggerAt <= at;
    }
    return { SCHEMA, PROJECT_COLORS: PROJECT_COLORS.slice(), createInitialState, normalizeItem, makeItem,
      resolveDeliveryMode, bumpRev, isTerminal, hasKnownRev, isDue };
  }
  return { createAppModel };
});
