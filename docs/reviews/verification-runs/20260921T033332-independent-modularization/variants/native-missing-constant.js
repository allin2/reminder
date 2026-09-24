/* Quiet hours + limited re-alert policy — UMD */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else {
    root.AttentionLib = root.AttentionLib || {};
    Object.assign(root.AttentionLib, factory());
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function parseHHMM(s, fallbackH, fallbackM) {
    const m = String(s || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return { h: fallbackH, m: fallbackM };
    return { h: parseInt(m[1], 10), m: parseInt(m[2], 10) };
  }

  function inQuietHours(d, settings) {
    settings = settings || {};
    if (!settings.dnd) return false;
    const start = parseHHMM(settings.quietStart, 23, 0);
    const end = parseHHMM(settings.quietEnd, 7, 30);
    const mins = d.getHours() * 60 + d.getMinutes();
    const s = start.h * 60 + start.m;
    const e = end.h * 60 + end.m;
    if (s === e) return false;
    if (s < e) return mins >= s && mins < e;
    return mins >= s || mins < e;
  }

  function quietEnd(d, settings) {
    settings = settings || {};
    const end = parseHHMM(settings.quietEnd, 7, 30);
    const x = new Date(d);
    const mins = d.getHours() * 60 + d.getMinutes();
    const s = parseHHMM(settings.quietStart, 23, 0);
    const startM = s.h * 60 + s.m;
    const endM = end.h * 60 + end.m;
    const wrapped = startM >= endM;
    if (wrapped && mins >= startM) x.setDate(x.getDate() + 1);
    x.setHours(end.h, end.m, 0, 0);
    return x.getTime();
  }

  /** Flexible window: prefer 10:00 inside [windowStart, windowEnd] on start day. */
  function applyWindowTrigger(item, now) {
    now = now || Date.now();
    if (!item.windowStart && !item.windowEnd) return item.triggerAt;
    const start = item.windowStart || item.triggerAt;
    if (!start) return item.triggerAt;
    const d = new Date(start);
    d.setHours(10, 0, 0, 0);
    let ts = d.getTime();
    if (item.windowEnd && ts > item.windowEnd) ts = item.windowStart || item.windowEnd;
    if (ts < now && item.windowEnd && now < item.windowEnd) {
      // window still open — fire now
      return now;
    }
    return ts;
  }

  const REALERT = {
    normal: { max: 0, intervalMs: 0 },
    important: { max: 4, intervalMs: 30 * 60 * 1000 },
    critical: { max: 8, intervalMs: 15 * 60 * 1000 }
  };

  /* ---------- Deadline Protection：阶段与身份（L02 / INV-05） ---------- */

  const DEADLINE_FINAL_MS = 2 * 60 * 60 * 1000;        // 第二个保护点：截止前 2 小时
  const DEADLINE_LEAD_MS = 24 * 60 * 60 * 1000;        // 第一个保护点：截止前 24 小时
  const DEADLINE_GRACE_MS = 24 * 60 * 60 * 1000;       // 逾期后仍保留 24 小时风险提示

  /**
   * 此刻所处的截止保护阶段；null 表示不在任何保护阶段内。
   *
   * 截止保护独立于 ACK / 完成状态（INV-05）：只要未完成且临近截止就该唤醒。
   * 但它必须**分阶段**——否则「ACK 后下次 promote 又立刻拉回 due」会让确认按钮形同虚设。
   */
  function deadlineStage(deadlineAt, now) {
    const dl = Number(deadlineAt) || 0;
    if (!dl) return null;
    const left = dl - Number(now == null ? Date.now() : now);
    if (left > DEADLINE_LEAD_MS) return null;
    if (left <= -DEADLINE_GRACE_MS) return null;
    return left <= DEADLINE_FINAL_MS ? "p2" : "p24";
  }

  /**
   * 所有保护阶段的时刻（按时间升序）。
   *
   * V03：每个阶段都是**独立**的保护事件，必须各自预排 ——
   * 只排 deadline-24h 一个点，用户在 p24 阶段 ACK 后进入后台，
   * 截止前 2 小时的 p2 就没有任何独立排程了。
   */
  function deadlineStagePoints(deadlineAt) {
    const dl = Number(deadlineAt) || 0;
    if (!dl) return [];
    return [
      { id: "p24", at: dl - DEADLINE_LEAD_MS },
      { id: "p2", at: dl - DEADLINE_FINAL_MS }
    ];
  }

  /**
   * 阶段身份 = 阶段 + 截止时间。
   *
   * 同一阶段内身份稳定：反复刷新 / 反复对账都不会重复唤醒，已消费的阶段也不再排程。
   * 截止时间被改写 → 身份随之变化 → 新阶段重新计算。
   */
  function deadlineStageKey(deadlineAt, now) {
    const stage = deadlineStage(deadlineAt, now);
    return stage ? stage + "@" + Number(deadlineAt) : null;
  }

  /**
   * Whether a due item should re-alert.
   * @param {object} item
   * @param {number} now
   * @param {object} opts { importantRepeat: boolean, dismissedAt: number|null }
   */
  function shouldRealert(item, now, opts) {
    opts = opts || {};
    if (!item || item.status !== "due") return false;
    if (opts.dismissedAt && now - opts.dismissedAt < 30 * 60 * 1000) return false;
    const policy = REALERT[item.priority] || REALERT.normal;
    if (!policy.max) return false;
    if (item.priority === "important" && opts.importantRepeat === false) return false;
    const count = item.remindCount || 0;
    // first delivery already counted in promoteDue
    if (count >= policy.max) return false;
    const last = item.lastRemindAt || item.deliveredAt || 0;
    if (now - last < policy.intervalMs) return false;
    return true;
  }

  function markReminded(item, now) {
    item.remindCount = (item.remindCount || 0) + 1;
    item.lastRemindAt = now || Date.now();
    return item;
  }

  return {
    parseHHMM,
    inQuietHours,
    quietEnd,
    applyWindowTrigger,
    shouldRealert,
    markReminded,
    REALERT,
    deadlineStage,
    deadlineStageKey,
    deadlineStagePoints,
    DEADLINE_FINAL_MS,
    DEADLINE_LEAD_MS,
    DEADLINE_GRACE_MS
  };
});

delete AttentionLib.DEADLINE_GRACE_MS;
