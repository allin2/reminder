/* 内容导入：ImportDraft[] → AttentionItem 草稿（S2.5 映射表） — UMD */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else {
    root.AttentionLib = root.AttentionLib || {};
    Object.assign(root.AttentionLib, factory());
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * 回环白名单：只有本应用自己的导出件才会带 `draft.internal`，
   * 这里逐字段决定「是否原样恢复」。**不整对象 Object.assign** ——
   * 否则外部文件里伪造一个 `status: "completed"` 就能改写条目生命周期。
   */
  const INTERNAL_PASSTHROUGH = [
    "rev", "status", "scheduleBasis", "delivery_mode", "isFallbackTrigger",
    "deadlineStageKey", "deadlineEvents", "deadlinePaused", "ackAdvancedAt",
    "seriesId", "repeatParentId", "snoozeCount", "remindCount", "snoozedAt",
    "snoozeDelayMs", "dismissedUntil", "lastRemindAt", "lastAlertShownAt",
    "acknowledgedAt", "completedAt", "createdAt", "reviewed_at", "review_status",
    "sourceQuote", "sourceTitle", "localTrigger", "importBatchId"
  ];
  const STATUS_WHITELIST = ["waiting", "snoozed", "due", "acknowledged", "completed", "archived"];

  function defaultUid() {
    return "i_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normalizeForCompare(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/[\s\u3000]+/g, "")
      .replace(/[，。！？、；：""''（）【】,.!?;:()[\]{}]/g, "");
  }

  function clampTitle(s) {
    const t = String(s == null ? "" : s).trim();
    if (!t) return "未命名事项";
    return t.length <= 60 ? t : t.slice(0, 57) + "…";
  }

  /**
   * 把一批 draft 映射成事项草稿。
   *
   * @param {Array} drafts
   * @param {object} deps 必传注入项（不自己造轮子，也不自己猜）
   *   · parse             —— `lib/parse-cn.js` 的 `parseChineseTime`（时间换算的**唯一**权威）
   *   · now               —— 基准时刻
   *   · fallbackTriggerAt —— 兜底触发时刻（app-core 的 `fallbackTriggerAt()`）
   *   · uid               —— id 生成器
   *   · existingItems     —— 既有事项，仅用于「疑似重复」提示（**绝不自动合并**）
   *   · defaultDeliveryMode / batchId
   * @returns {{ items, preview, warnings }}
   */
  function mapDrafts(drafts, deps) {
    deps = deps || {};
    const parse = deps.parse;
    const now = deps.now == null ? Date.now() : Number(deps.now);
    const uid = deps.uid || defaultUid;
    const warnings = [];
    const items = [];
    const preview = [];

    if (typeof parse !== "function") {
      warnings.push("未注入时间解析器，所有条目的时间都只能走兜底值");
    }

    const fallbackAt = (function () {
      if (typeof deps.fallbackTriggerAt === "function") {
        const v = deps.fallbackTriggerAt();
        if (Number.isFinite(Number(v))) return Number(v);
      }
      // 内置默认值 = 次日 21:30（与「下一个整理窗口」同量级）。
      // 与 app-core 的真实兜底语义**不保证一致**，所以必须显式告警。
      const d = new Date(now + 24 * 60 * 60 * 1000);
      d.setHours(21, 30, 0, 0);
      warnings.push("未注入兜底时间函数 fallbackTriggerAt()，已使用内置默认值（次日 21:30）");
      return d.getTime();
    })();

    const existing = Array.isArray(deps.existingItems) ? deps.existingItems : [];
    const existingTitles = existing.map(it => ({ id: it.id, key: normalizeForCompare(it.title) }));
    const existingUrls = existing.filter(it => it.url).map(it => ({ id: it.id, url: String(it.url) }));

    (drafts || []).forEach((d, idx) => {
      if (!d) return;
      const hasStructuredTime = d.at_ms != null;
      // 结构化草稿若已给出时间戳，`when_text` 一律忽略（两条通道不互相污染，D52）
      const parsed = (typeof parse === "function" && d.when_text && !hasStructuredTime)
        ? parse(String(d.when_text), now) : null;
      if (hasStructuredTime && d.when_text) {
        warnings.push("第 " + (idx + 1) + " 条同时含结构化时间与时间描述，已采用结构化时间");
      }
      const conf = hasStructuredTime ? "high" : (parsed ? parsed.confidence : "none");

      // ---- 时间：结构化来源直接采信；自然语言来源必须由本地解析器换算 ----
      let triggerAt = null, windowStart = null, windowEnd = null, isFallback = false;
      let timeNote = "";
      if (hasStructuredTime) {
        triggerAt = Number(d.at_ms);
      } else if (parsed && parsed.trigger != null && (conf === "high" || conf === "mid")) {
        triggerAt = Number(parsed.trigger);
        if (parsed.window) {
          windowStart = parsed.window.start != null ? Number(parsed.window.start) : null;
          windowEnd = parsed.window.end != null ? Number(parsed.window.end) : null;
        }
      } else {
        triggerAt = fallbackAt;
        isFallback = true;
        timeNote = d.when_text ? "含时间词但未解析出，已用兜底" : "原文无时间，已用兜底";
      }

      // ---- 截止：结构化给时间戳，否则看自然语言里有没有明确的截止表达 ----
      let deadlineAt = null;
      if (d.deadline_at_ms != null) deadlineAt = Number(d.deadline_at_ms);
      else if (parsed && parsed.deadline != null) deadlineAt = Number(parsed.deadline);

      // ---- 周期 ----
      let repeat = null;
      if (d.repeat && d.repeat.every) {
        repeat = { every: d.repeat.every, mode: d.repeat.mode === "ack" ? "ack" : "calendar" };
        if (repeat.every === "nthWeekday") {
          repeat.nth = d.repeat.nth === -1 ? -1 : (parseInt(d.repeat.nth, 10) || 1);
          repeat.dow = d.repeat.dow != null ? (parseInt(d.repeat.dow, 10) || 0) : 1;
        }
      } else if (parsed && parsed.repeat && parsed.repeat.every) {
        repeat = {
          every: parsed.repeat.every,
          mode: parsed.repeat.mode === "ack" ? "ack" : "calendar"
        };
        if (parsed.repeat.every === "nthWeekday") {
          repeat.nth = parsed.repeat.nth === -1 ? -1 : (parseInt(parsed.repeat.nth, 10) || 1);
          repeat.dow = parsed.repeat.dow != null ? (parseInt(parsed.repeat.dow, 10) || 0) : 1;
        }
      }

      const item = {
        id: uid(),
        title: clampTitle(d.title || (parsed && parsed.title) || d.source_quote),
        note: d.note || "",
        tags: Array.isArray(d.tags) ? d.tags.slice(0, 8) : [],
        url: d.url || "",

        // S2.5 第 9 条：一律 waiting —— 直接落 due 会立刻进首页（违反 §12 / INV-07）
        status: "waiting",
        // S2.5 第 11 条：AI 不判优先级（§1.2 + 既有 prompt 禁令）
        priority: "normal",
        // S2.5 第 10 条：一律 NEEDS_REVIEW
        review_status: "NEEDS_REVIEW",
        reviewed_at: null,

        triggerAt: triggerAt,
        windowStart: windowStart,
        windowEnd: windowEnd,
        deadlineAt: deadlineAt,
        repeat: repeat,
        isFallbackTrigger: isFallback,
        scheduleBasis: (parsed && parsed.scheduleBasis) || "wall-clock",

        createdAt: now,
        acknowledgedAt: null,
        completedAt: null,
        snoozeCount: 0,
        deliveredAt: null,
        remindCount: 0,
        lastRemindAt: null,
        lastAlertShownAt: null,
        localTrigger: null,
        snoozedAt: null,
        snoozeDelayMs: null,
        dismissedUntil: null,
        deadlineStageKey: null,
        deadlineEvents: {},
        deadlinePaused: false,
        ackAdvancedAt: null,
        rev: 1,
        seriesId: repeat ? "s_" + uid() : null,
        repeatParentId: null,

        delivery_mode: deps.defaultDeliveryMode === "alarm" ? "alarm" : "notification",

        sourceTitle: d.source_locator || "",
        sourceApp: "import",
        sourceQuote: d.source_quote || null,
        importBatchId: deps.batchId || null
      };

      // ---- 回环：只有带 internal 的草稿才恢复内部字段 ----
      if (d.internal && typeof d.internal === "object") {
        INTERNAL_PASSTHROUGH.forEach(k => {
          if (d.internal[k] === undefined || d.internal[k] === null) return;
          if (k === "status" && STATUS_WHITELIST.indexOf(d.internal[k]) < 0) return;
          item[k] = d.internal[k];
        });
        if (d.internal.review_status) item.review_status = d.internal.review_status;
      }

      // ---- 疑似重复：只提示，**绝不自动合并**（§13）----
      const key = normalizeForCompare(item.title);
      let duplicateOf = null;
      const hitT = existingTitles.find(x => x.key && x.key === key);
      if (hitT) duplicateOf = hitT.id;
      if (!duplicateOf && item.url) {
        const hitU = existingUrls.find(x => x.url === item.url);
        if (hitU) duplicateOf = hitU.id;
      }

      items.push(item);
      preview.push({
        index: idx,
        title: item.title,
        triggerAt: item.triggerAt,
        isFallbackTrigger: item.isFallbackTrigger,
        deadlineAt: item.deadlineAt,
        repeat: item.repeat,
        confidence: conf,
        timeNote: timeNote,
        sourceQuote: item.sourceQuote,
        sourceLocator: item.sourceTitle,
        review_status: item.review_status,
        duplicateOf: duplicateOf
      });
    });

    return { items: items, preview: preview, warnings: warnings };
  }

  /** 预览摘要 —— 给 UI 直接渲染用：把"系统解析成了什么"讲清楚，而不是只报总数。 */
  function summarize(preview) {
    const list = Array.isArray(preview) ? preview : [];
    return {
      total: list.length,
      fallback: list.filter(p => p.isFallbackTrigger).length,
      lowConfidence: list.filter(p => p.confidence === "low" || p.confidence === "none").length,
      withDeadline: list.filter(p => !!p.deadlineAt).length,
      repeating: list.filter(p => !!p.repeat).length,
      possibleDuplicates: list.filter(p => !!p.duplicateOf).length
    };
  }

  return {
    INTERNAL_PASSTHROUGH,
    normalizeForCompare,
    clampTitle,
    mapDrafts,
    summarize
  };
});
