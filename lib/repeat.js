/* Repeat rules — UMD */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else {
    root.AttentionLib = root.AttentionLib || {};
    Object.assign(root.AttentionLib, factory());
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function applyClock(day, likeTs) {
    const d = new Date(day);
    if (likeTs) {
      const s = new Date(likeTs);
      d.setHours(s.getHours(), s.getMinutes(), 0, 0);
    } else d.setHours(10, 0, 0, 0);
    return d.getTime();
  }
  function lastDayOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  }
  function nthWeekdayInMonth(year, month, nth, dow) {
    if (nth === -1) {
      const last = new Date(year, month + 1, 0);
      const delta = (last.getDay() - dow + 7) % 7;
      last.setDate(last.getDate() - delta);
      return last;
    }
    const first = new Date(year, month, 1);
    let delta = (dow - first.getDay() + 7) % 7;
    const d = new Date(year, month, 1 + delta + (nth - 1) * 7);
    if (d.getMonth() !== month) return new Date(year, month + 1, 0);
    return d;
  }
  function nthWeekdayOfNextMonth(from, nth, dow, hour, minute) {
    const base = from instanceof Date ? new Date(from.getTime()) : new Date(from);
    let y = base.getFullYear(), m = base.getMonth();
    let d = nthWeekdayInMonth(y, m, nth, dow);
    d.setHours(10, 0, 0, 0);
    if (d.getTime() <= base.getTime()) {
      m += 1;
      if (m > 11) { m = 0; y += 1; }
      d = nthWeekdayInMonth(y, m, nth, dow);
      d.setHours(10, 0, 0, 0);
    }
    if (hour != null) d.setHours(hour, minute || 0, 0, 0);
    return d.getTime();
  }

  function nextRepeatTrigger(it, fromTs) {
    const from = fromTs || it.acknowledgedAt || Date.now();
    const every = it.repeat && it.repeat.every;
    if (every === "day") return applyClock(addDays(new Date(from), 1), it.triggerAt);
    if (every === "week") return applyClock(addDays(new Date(from), 7), it.triggerAt);
    if (every === "biweek") return applyClock(addDays(new Date(from), 14), it.triggerAt);
    if (every === "month") {
      const d = new Date(from);
      d.setMonth(d.getMonth() + 1);
      return applyClock(d, it.triggerAt);
    }
    if (every === "monthEnd") {
      const base = new Date(from);
      let d = lastDayOfMonth(base);
      d.setHours(10, 0, 0, 0);
      if (d.getTime() <= from) {
        const n = new Date(base);
        n.setMonth(n.getMonth() + 1);
        d = lastDayOfMonth(n);
        d.setHours(10, 0, 0, 0);
      }
      return applyClock(d, it.triggerAt);
    }
    if (every === "nthWeekday") {
      const s = it.triggerAt ? new Date(it.triggerAt) : new Date();
      return nthWeekdayOfNextMonth(
        from,
        it.repeat.nth || 1,
        it.repeat.dow != null ? it.repeat.dow : 1,
        s.getHours(),
        s.getMinutes()
      );
    }
    return null;
  }

  function repeatLabel(rep) {
    if (!rep || !rep.every) return "";
    const map = {
      day: "每天", week: "每周", biweek: "每两周",
      month: "每月", monthEnd: "每月最后一天",
      nthWeekday: "每月第 " + (rep.nth === -1 ? "最后" : (rep.nth || 1)) + " 个周" +
        ["日", "一", "二", "三", "四", "五", "六"][rep.dow != null ? rep.dow : 1]
    };
    return map[rep.every] || rep.every;
  }

  function nextRepeatPreview(rep, from, count) {
    count = count || 5;
    const out = [];
    let cursor = from ? new Date(from) : new Date();
    for (let i = 0; i < count; i++) {
      const ts = nextRepeatTrigger({ repeat: rep, triggerAt: cursor.getTime() }, cursor.getTime());
      if (!ts) break;
      out.push(ts);
      cursor = new Date(ts + 60000);
    }
    return out;
  }

  return {
    applyClock,
    lastDayOfMonth,
    nthWeekdayInMonth,
    nthWeekdayOfNextMonth,
    nextRepeatTrigger,
    repeatLabel,
    nextRepeatPreview
  };
});
