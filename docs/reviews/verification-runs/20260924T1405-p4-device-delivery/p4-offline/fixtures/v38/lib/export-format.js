/* 内容导出：对外契约 attention-inbox.export/v1 + ICS 互操作 — UMD */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else {
    root.AttentionLib = root.AttentionLib || {};
    Object.assign(root.AttentionLib, factory());
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FORMAT = "attention-inbox.export";
  const FORMAT_VERSION = "1.0";

  /**
   * 必须与 `lib/reminder.js` 的 `DEADLINE_LEAD_MS` 一致 —— 单元测试会断言两者相等，
   * 免得导出侧自己长出一套"提前多久算临近截止"的规则。
   */
  const DEADLINE_LEAD_MS = 24 * 60 * 60 * 1000;

  const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const IMPORTANCE = { normal: "NORMAL", important: "IMPORTANT", critical: "CRITICAL" };

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /**
   * 当地语义的 ISO 8601，**必须带偏移**。
   * 先按本地时间取字段，再附上本地偏移 —— 与 V0.2 §15「当地时间语义」一致：
   * 「每天晚上 9 点」跨时区后仍是当地晚上 9 点。
   */
  function isoWithOffset(ts) {
    if (ts == null || !Number.isFinite(Number(ts))) return null;
    const d = new Date(Number(ts));
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const abs = Math.abs(off);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) +
      sign + pad2(Math.floor(abs / 60)) + ":" + pad2(abs % 60);
  }

  /** ICS 用 UTC：不带 VTIMEZONE 却写 TZID 是不合规的（D53）。 */
  function utcStamp(ts) {
    if (ts == null || !Number.isFinite(Number(ts))) return null;
    const d = new Date(Number(ts));
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
      "T" + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + "Z";
  }

  function localTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch (e) { return "UTC"; }
  }

  /**
   * RRULE 派生。**`mode === "ack"` 一律返回 `null`** ——
   * ACK 周期从"确认时刻"重新计时，不存在等价的日历规则。
   * 用 FREQ=WEEKLY;INTERVAL=2 之类的近似值填充，会让消费方按固定日历重复建日程，
   * 正是 §22 要防的"错误智能"。这条同时是 JSON Schema 的 if/then 硬约束。
   */
  function rruleFor(repeat, anchorTs) {
    const rep = repeat || {};
    if (!rep.every) return null;
    if (rep.mode === "ack") return null;
    const byday = anchorTs ? ";BYDAY=" + DOW[new Date(Number(anchorTs)).getDay()] : "";
    switch (rep.every) {
      case "day": return "FREQ=DAILY";
      case "week": return "FREQ=WEEKLY" + byday;
      case "biweek": return "FREQ=WEEKLY;INTERVAL=2" + byday;
      case "month":
        return anchorTs
          ? "FREQ=MONTHLY;BYMONTHDAY=" + new Date(Number(anchorTs)).getDate()
          : null;
      case "monthEnd": return "FREQ=MONTHLY;BYMONTHDAY=-1";
      case "nthWeekday": {
        const nth = rep.nth === -1 ? -1 : (parseInt(rep.nth, 10) || 1);
        const dow = DOW[rep.dow != null ? (parseInt(rep.dow, 10) || 0) : 1];
        return "FREQ=MONTHLY;BYDAY=" + nth + dow;
      }
      default: return null;
    }
  }

  /* ---------- 四维状态的派生 ---------- */

  /**
   * 注意力交付状态。
   *
   * 已完成 / 已归档的条目在内部只剩一个 `status = completed|archived`，
   * **原始交付状态已经丢失** —— 此时按时间戳回推，并如实计入 `derived`。
   * 不复用 `status` 直接映射，正是为了不假装我们还知道。
   */
  function deriveAttentionStatus(it) {
    const s = it.status;
    if (s === "due") return "DELIVERED";
    if (s === "acknowledged") return "ACKNOWLEDGED";
    if (s === "completed" || s === "archived") {
      if (it.acknowledgedAt) return "ACKNOWLEDGED";
      if (it.deliveredAt) return "DELIVERED";
      return "WAITING";
    }
    return "WAITING"; // waiting / snoozed / 未知
  }

  /** 纯改名，存储事实 → 不计入 derived。 */
  function deriveCompletionStatus(it) {
    if (it.status === "completed") return "COMPLETED";
    if (it.status === "archived") return "ARCHIVED";
    return "ACTIVE";
  }

  /** 计算值（依赖 now）→ 计入 derived。 */
  function deriveDeadlineStatus(it, now, leadMs) {
    // 单独调用时也必须拿到提前量 —— 缺省成 undefined 会让 `left <= leadMs` 恒为 false，
    // PROTECTED 永远判不出来（单元测试抓到的真 bug）。
    leadMs = leadMs == null ? DEADLINE_LEAD_MS : Number(leadMs);
    const dl = Number(it.deadlineAt) || 0;
    if (!dl) return "NONE";
    if (it.deadlinePaused) return "PENDING";
    const left = dl - now;
    if (left <= 0) return "PASSED";
    if (left <= leadMs) return "PROTECTED";
    return "PENDING";
  }

  /**
   * 时间来源。**当前只会产出 PARSED / FALLBACK**（D54）：
   * 内部没有"用户显式设定过时间"的持久标记（`reviewTriggerUserPicked` 是局部变量），
   * 所以 `USER` 保留在枚举里但不产出 —— 少给一个取值比猜一个安全。
   */
  function deriveTimeSource(it) {
    if (!it.triggerAt) return "FALLBACK";
    return it.isFallbackTrigger ? "FALLBACK" : "PARSED";
  }

  /* ---------- 范围过滤 ---------- */

  function normalizeScope(scope) {
    const s = scope || {};
    return {
      mode: ["all", "active", "future", "range"].indexOf(s.mode) >= 0 ? s.mode : "active",
      include_archived: !!s.include_archived,
      include_completed: !!s.include_completed,
      include_needs_review: s.include_needs_review !== false,
      from: s.from == null ? null : Number(s.from),
      to: s.to == null ? null : Number(s.to)
    };
  }

  function inScope(it, scope, now) {
    if (!it) return false;
    const archived = it.status === "archived";
    const completed = it.status === "completed";
    if (archived && !scope.include_archived) return false;
    if (completed && !scope.include_completed) return false;
    if (it.review_status === "NEEDS_REVIEW" && !scope.include_needs_review) return false;
    if (scope.mode === "active" && (archived || completed)) return false;
    if (scope.mode === "future") {
      if (archived || completed) return false;
      if (!(it.triggerAt && it.triggerAt > now)) return false;
    }
    if (scope.mode === "range") {
      const t = Number(it.triggerAt || it.deadlineAt || it.createdAt || 0);
      if (scope.from != null && t < scope.from) return false;
      if (scope.to != null && t > scope.to) return false;
    }
    return true;
  }

  /* ---------- 逐条导出 ---------- */

  function deriveExportItem(it, now, opts) {
    opts = opts || {};
    const leadMs = opts.deadlineLeadMs == null ? DEADLINE_LEAD_MS : Number(opts.deadlineLeadMs);
    const derived = [];

    // 契约要求 created_at_iso 必须是**带偏移的非空时间**：缺失时退到 now，
    // 而不是产出 null 让下游解析失败。
    const createdAt = it.createdAt == null || !Number.isFinite(Number(it.createdAt))
      ? now : Number(it.createdAt);

    const attention = deriveAttentionStatus(it);
    derived.push("attention_status");
    const deadlineStatus = deriveDeadlineStatus(it, now, leadMs);
    derived.push("deadline_status");
    const timeSource = deriveTimeSource(it);
    derived.push("time_source");

    const repeatRaw = it.repeat && it.repeat.every ? it.repeat : null;
    let repeat = null;
    if (repeatRaw) {
      repeat = {
        every: repeatRaw.every,
        mode: repeatRaw.mode === "ack" ? "ack" : "calendar",
        rrule: rruleFor(repeatRaw, it.triggerAt || it.windowStart || null)
      };
      if (repeatRaw.every === "nthWeekday") {
        repeat.nth = repeatRaw.nth === -1 ? -1 : (parseInt(repeatRaw.nth, 10) || 1);
        repeat.dow = repeatRaw.dow != null ? (parseInt(repeatRaw.dow, 10) || 0) : 1;
      }
      if (repeat.rrule) derived.push("repeat.rrule");
    }

    const out = {
      id: String(it.id || ""),
      rev: Number(it.rev) || 1,
      title: String(it.title || "未命名事项"),
      content: it.note ? String(it.note) : null,
      // §5.1 定义了 original_capture，但代码未落地该字段 → 如实置 null，不臆造
      original_capture: it.originalCapture != null ? String(it.originalCapture) : null,
      url: it.url ? String(it.url) : null,
      tags: Array.isArray(it.tags) ? it.tags.slice() : [],

      attention_status: attention,
      review_status: it.review_status || "READY",
      completion_status: deriveCompletionStatus(it),
      deadline_status: deadlineStatus,
      // import:      改名，不算派生（它就是存储的 priority）
      importance: IMPORTANCE[it.priority] || "NORMAL",

      trigger_at_iso: isoWithOffset(it.triggerAt),
      trigger_at_ms: it.triggerAt == null ? null : Number(it.triggerAt),
      trigger_window_start_iso: isoWithOffset(it.windowStart),
      trigger_window_end_iso: isoWithOffset(it.windowEnd),
      time_source: timeSource,

      deadline_at_iso: isoWithOffset(it.deadlineAt),
      deadline_at_ms: it.deadlineAt == null ? null : Number(it.deadlineAt),
      deadline_paused: !!it.deadlinePaused,

      repeat: repeat,

      source_title: it.sourceTitle ? String(it.sourceTitle) : null,
      source_url: it.sourceUrl ? String(it.sourceUrl) : null,
      source_app: it.sourceApp ? String(it.sourceApp) : null,
      source_quote: it.sourceQuote ? String(it.sourceQuote) : null,

      created_at_iso: isoWithOffset(createdAt),
      created_at_ms: Number(createdAt),
      acknowledged_at_iso: isoWithOffset(it.acknowledgedAt),
      acknowledged_at_ms: it.acknowledgedAt == null ? null : Number(it.acknowledgedAt),
      reviewed_at_iso: isoWithOffset(it.reviewed_at),
      completed_at_iso: isoWithOffset(it.completedAt),
      completed_at_ms: it.completedAt == null ? null : Number(it.completedAt),
      archived_at_iso: isoWithOffset(it.archivedAt),

      derived: derived,
      extensions: {
        internal: internalOf(it)
      }
    };
    return out;
  }

  /** 回环用的内部字段。第三方消费方必须忽略这个区块。 */
  function internalOf(it) {
    const inner = {};
    const keys = [
      "status", "scheduleBasis", "delivery_mode", "isFallbackTrigger",
      "deadlineStageKey", "deadlineEvents", "snoozeCount", "remindCount",
      "ackAdvancedAt", "seriesId", "repeatParentId", "importBatchId",
      "localTrigger", "dismissedUntil"
    ];
    keys.forEach(k => {
      if (it[k] !== undefined && it[k] !== null) inner[k] = it[k];
    });
    return inner;
  }

  /* ---------- 顶层构建 ---------- */

  function scopeDescriptor(scope, raw) {
    const out = {
      mode: scope.mode,
      include_archived: scope.include_archived,
      include_completed: scope.include_completed,
      include_needs_review: scope.include_needs_review
    };
    if (scope.from != null) out.from = isoWithOffset(scope.from);
    if (scope.to != null) out.to = isoWithOffset(scope.to);
    return out;
  }

  function tally(items, key) {
    const out = {};
    items.forEach(x => {
      const k = x[key];
      if (k == null) return;
      out[k] = (out[k] || 0) + 1;
    });
    return out;
  }

  /**
   * 构建导出对象。
   * @param {Array} items 内部事项数组
   * @param {object} opts { now, appVersion, internalSchema, timezone, locale, scope, extras }
   */
  function buildExport(items, opts) {
    opts = opts || {};
    const now = opts.now == null ? Date.now() : Number(opts.now);
    const scope = normalizeScope(opts.scope);
    const picked = (Array.isArray(items) ? items : []).filter(it => inScope(it, scope, now));
    const exported = picked.map(it => deriveExportItem(it, now, opts));

    const extensions = {};
    const extras = opts.extras || {};
    const inner = { note: "本区块仅供本应用回环导入使用；第三方消费方必须忽略。" };
    if (extras.notes) inner.notes = extras.notes;
    if (extras.projects) inner.projects = extras.projects;
    if (extras.settingsSubset) inner.settings_subset = sanitizeSettings(extras.settingsSubset);
    if (opts.internalSchema != null) inner.app_internal_schema = Number(opts.internalSchema);
    extensions.internal = inner;

    return {
      format: FORMAT,
      format_version: FORMAT_VERSION,
      generator: {
        app: "attention-inbox",
        app_version: String(opts.appVersion || ""),
        internal_schema: Number(opts.internalSchema || 0)
      },
      exported_at: isoWithOffset(now),
      exported_at_ms: now,
      timezone: opts.timezone || localTimeZone(),
      locale: opts.locale || "zh-CN",
      scope: scopeDescriptor(scope, opts.scope),
      counts: {
        items: exported.length,
        by_attention_status: tally(exported, "attention_status"),
        by_completion_status: tally(exported, "completion_status"),
        by_review_status: tally(exported, "review_status"),
        by_deadline_status: tally(exported, "deadline_status")
      },
      items: exported,
      extensions: extensions
    };
  }

  const SECRET_KEY_RE = /(apikey|api_key|secret|token|password|passwd|credential|baseurl|base_url)/i;

  /** 导出的设置子集里绝不允许带密钥 —— 用白名单式过滤，而不是靠调用方自觉。 */
  function sanitizeSettings(s) {
    const out = {};
    if (!s || typeof s !== "object") return out;
    Object.keys(s).forEach(k => {
      if (SECRET_KEY_RE.test(k)) return;
      const v = s[k];
      if (v == null || typeof v === "object") return;
      out[k] = v;
    });
    return out;
  }

  /**
   * 扫描任意对象里疑似密钥的键路径。给测试与校验脚本用：
   * 「不导出密钥」这件事必须能被断言，而不是靠人记得。
   */
  function scanSecrets(obj, path, hits) {
    path = path || "";
    hits = hits || [];
    if (!obj || typeof obj !== "object") return hits;
    Object.keys(obj).forEach(k => {
      const p = path ? path + "." + k : k;
      if (SECRET_KEY_RE.test(k)) hits.push(p);
      const v = obj[k];
      if (v && typeof v === "object") scanSecrets(v, p, hits);
    });
    return hits;
  }

  /* ---------- ICS ---------- */

  function escIcs(s) {
    return String(s == null ? "" : s)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  /** RFC 5545 折行：75 个**八位组**，续行以单个空格开头。多字节字符不得被截断。 */
  function foldLine(line) {
    const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
    const byteLen = ch => (encoder ? encoder.encode(ch).length : 1);
    const out = [];
    let cur = "", curBytes = 0;
    for (const ch of String(line)) {
      const b = byteLen(ch);
      if (curBytes + b > 75) { out.push(cur); cur = " "; curBytes = 1; }
      cur += ch; curBytes += b;
    }
    out.push(cur);
    return out.join("\r\n");
  }

  /**
   * ICS 导出。
   *
   * 两条硬规定：
   *  1. 时刻用 UTC（D53）—— 不带 VTIMEZONE 却写 TZID 是不合规的 ICS；
   *  2. `time_source === "FALLBACK"` 的**触发时刻不得进日历** —— 我们自己在 [S3.3] 里
   *     要求消费方"不得据兜底时间建日程"，就不能自己把它塞进日历格式。
   *     这类条目若**另有真实截止时间**，仍以 VTODO(DUE) 导出（降级），计数回报。
   */
  function buildIcs(items, opts) {
    opts = opts || {};
    const now = opts.now == null ? Date.now() : Number(opts.now);
    const scope = normalizeScope(opts.scope);
    const picked = (Array.isArray(items) ? items : []).filter(it => inScope(it, scope, now));

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Attention Inbox//attention-inbox.export " + FORMAT_VERSION + "//CN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH"
    ];

    let included = 0, downgraded = 0, dropped = 0;

    picked.forEach(it => {
      const e = deriveExportItem(it, now, opts);
      const fallback = e.time_source === "FALLBACK";
      const useDeadline = !fallback ? !!e.deadline_at_ms : !!e.deadline_at_ms;
      const useEventAt = !fallback && !e.deadline_at_ms ? e.trigger_at_ms : null;

      if (!useDeadline && !useEventAt) { dropped++; return; }
      if (fallback) downgraded++;
      included++;

      const uid = e.id + "@attention-inbox";
      const stamp = utcStamp(now);
      const desc = [];
      if (e.content) desc.push(e.content);
      if (e.source_quote) desc.push("来源原文：" + e.source_quote);
      if (e.source_title) desc.push("来源：" + e.source_title);
      // 把对外语义契约直接写进文件：否则消费方一定会把"已看到"当成"已完成"
      if (e.attention_status === "ACKNOWLEDGED" && e.completion_status === "ACTIVE") {
        desc.push("状态：已看到，未完成（ACK != Complete）");
      }
      if (e.review_status === "NEEDS_REVIEW") desc.push("状态：信息待确认");
      if (fallback) desc.push("时间：系统兜底值，非用户本意");
      desc.push("id: " + e.id);

      if (useDeadline) {
        lines.push("BEGIN:VTODO");
        lines.push("UID:" + uid);
        lines.push("DTSTAMP:" + stamp);
        lines.push("SUMMARY:" + escIcs(e.title));
        lines.push("DESCRIPTION:" + escIcs(desc.join("\n")));
        lines.push("DUE:" + utcStamp(e.deadline_at_ms));
        lines.push("STATUS:" + (e.completion_status === "ACTIVE" ? "NEEDS-ACTION" : "COMPLETED"));
        lines.push("PRIORITY:" + (e.importance === "CRITICAL" ? 1 : (e.importance === "IMPORTANT" ? 5 : 9)));
        if (e.repeat && e.repeat.rrule) lines.push("RRULE:" + e.repeat.rrule);
        lines.push("X-ATTENTION-ID:" + escIcs(e.id));
        lines.push("X-ATTENTION-ATTENTION-STATUS:" + e.attention_status);
        lines.push("X-ATTENTION-COMPLETION-STATUS:" + e.completion_status);
        lines.push("X-ATTENTION-REVIEW-STATUS:" + e.review_status);
        lines.push("X-ATTENTION-IMPORTANCE:" + e.importance);
        if (e.repeat && e.repeat.rrule) lines.push("X-ATTENTION-REPEAT-MODE:" + e.repeat.mode);
        if (fallback) lines.push("X-ATTENTION-TIME-SOURCE:FALLBACK");
        lines.push("BEGIN:VALARM");
        lines.push("ACTION:DISPLAY");
        lines.push("DESCRIPTION:" + escIcs(e.title));
        lines.push("TRIGGER:-PT24H");
        lines.push("END:VALARM");
        lines.push("BEGIN:VALARM");
        lines.push("ACTION:DISPLAY");
        lines.push("DESCRIPTION:" + escIcs(e.title));
        lines.push("TRIGGER:PT0S");
        lines.push("END:VALARM");
        lines.push("END:VTODO");
      } else {
        const start = e.trigger_at_ms;
        lines.push("BEGIN:VEVENT");
        lines.push("UID:" + uid);
        lines.push("DTSTAMP:" + stamp);
        lines.push("SUMMARY:" + escIcs(e.title));
        lines.push("DESCRIPTION:" + escIcs(desc.join("\n")));
        lines.push("DTSTART:" + utcStamp(start));
        lines.push("DTEND:" + utcStamp(start + 30 * 60 * 1000));
        if (e.repeat && e.repeat.rrule) lines.push("RRULE:" + e.repeat.rrule);
        lines.push("X-ATTENTION-ID:" + escIcs(e.id));
        lines.push("X-ATTENTION-ATTENTION-STATUS:" + e.attention_status);
        lines.push("X-ATTENTION-COMPLETION-STATUS:" + e.completion_status);
        lines.push("X-ATTENTION-REVIEW-STATUS:" + e.review_status);
        lines.push("X-ATTENTION-IMPORTANCE:" + e.importance);
        if (e.repeat && e.repeat.rrule) lines.push("X-ATTENTION-REPEAT-MODE:" + e.repeat.mode);
        lines.push("BEGIN:VALARM");
        lines.push("ACTION:DISPLAY");
        lines.push("DESCRIPTION:" + escIcs(e.title));
        lines.push("TRIGGER:PT0S");
        lines.push("END:VALARM");
        lines.push("END:VEVENT");
      }
    });

    lines.push("END:VCALENDAR");
    return {
      text: lines.map(foldLine).join("\r\n") + "\r\n",
      included: included,
      downgraded: downgraded, // 有真实截止、但触发时刻是兜底值 → 只导出了截止
      dropped: dropped        // 既无真实截止、触发时刻又是兜底值 → 不进日历
    };
  }

  return {
    FORMAT,
    FORMAT_VERSION,
    DEADLINE_LEAD_MS,
    isoWithOffset,
    utcStamp,
    localTimeZone,
    rruleFor,
    deriveAttentionStatus,
    deriveCompletionStatus,
    deriveDeadlineStatus,
    deriveTimeSource,
    deriveExportItem,
    normalizeScope,
    inScope,
    sanitizeSettings,
    scanSecrets,
    foldLine,
    escIcs,
    buildExport,
    buildIcs
  };
});
