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
    REALERT
  };
});
