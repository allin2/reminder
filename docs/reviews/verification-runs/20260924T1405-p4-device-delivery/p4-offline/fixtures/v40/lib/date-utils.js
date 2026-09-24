/* 共享日历原语 —— UMD
 *
 * 为什么单独成文件：`startOfDay` / `addDays` / `applyClock` / `lastDayOfMonth` /
 * `nthWeekdayInMonth` 这一组函数此前在 `app-core.js`、`lib/parse-cn.js`、`lib/repeat.js`
 * 里**各有一份同算法副本**（`nthWeekdayInMonth` 三份），而 UMD 的
 * `Object.assign(root.AttentionLib, factory())` 是**扁平合并** —— 同名导出谁后加载谁生效。
 * 于是「哪一份在跑」由 `<script>` 顺序决定，而顺序错了不抛错、只静默换实现。
 *
 * 本文件改为**命名空间挂载**（`AttentionLib.DatePrimitives`），消费方显式声明依赖，
 * 不再依赖加载顺序覆盖。Node 下 `require("./date-utils.js")` 拿同一份工厂产物。
 *
 * 边界：**只放共同原语，不放任何「选择策略」**。
 * 首期候选与周期推进对「第 N 个星期几」的比较基准**故意不同**（见文末两个显式命名函数），
 * 把策略放进来就会迫使用户在两条正确语义里选一条错的。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.DatePrimitives = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  /** 下一个周六 10:00 */
  function nextWeekend(from) {
    const d = startOfDay(from || new Date());
    const day = d.getDay();
    let add = (6 - day + 7) % 7;
    if (day === 0) add = 6;
    const sat = addDays(d, add);
    sat.setHours(10, 0, 0, 0);
    return sat.getTime();
  }

  /** 把某一天的钟点对齐到 `likeTs`（无则 10:00），返回时间戳 */
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

  /** 某月第 N 个星期几；nth=-1 表示最后一个。返回 Date（未定钟点）。 */
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

  /**
   * H-01：「下周X」「下下周X」= 下一个 / 下下个**日历周**（以周一为首日）里的那个星期几。
   *
   * 原实现先算「最近的那个星期 X」，再无条件 `delta += 7`，等于整体推后一周：
   * 「下周三」（基准周五）算成 09-30 而不是 09-23。同文件的「下周日」分支只加一次 7 天，
   * 两者语义相同却实现不一致 —— 以本函数为准，两个分支合并。
   */
  function weekdayOfNextWeek(from, weekOffset, target) {
    const d = startOfDay(from);
    const day = d.getDay();                       // 0=周日 … 6=周六
    const toMonday = ((8 - day) % 7) || 7;        // 到下一个周一的天数，恒 > 0
    const monday = addDays(d, toMonday + (weekOffset - 1) * 7);
    return addDays(monday, (target + 6) % 7);     // 周一=1→0 … 周日=0→6
  }

  /**
   * 「N 号」在指定月份的那一天；该月没有这一天时收敛到月末（与 repeat.js 的 month 推进口径一致）。
   * 不收敛会让 9/31 溢出成 10/01（JS Date 的自然行为），标题与月份都对不上。
   */
  function dayOfMonthIn(year, month, day) {
    const last = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(day, last), 10, 0, 0, 0);
  }

  /** H-02：「每月 N 号」的下一次出现（跨月，含年界）。锚在 10:00，与其它无时刻分支一致。 */
  function nextDayOfMonth(from, day) {
    const base = startOfDay(from);
    const today = dayOfMonthIn(base.getFullYear(), base.getMonth(), day);
    if (today.getTime() > new Date(from).getTime()) return today.getTime();
    const y = base.getMonth() === 11 ? base.getFullYear() + 1 : base.getFullYear();
    return dayOfMonthIn(y, (base.getMonth() + 1) % 12, day).getTime();
  }

  function dayStart(ts) {
    const d = ts instanceof Date ? ts : new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  /* ------------------------------------------------------------------ *
   * 同名函数，两种**故意不同**的比较基准（禁止合并成一份）
   *
   * 唯一差别是比较基准：
   *   · ByInstant —— 拿拼好的 10:00 时间戳与锚点比「具体时刻」。
   *   · ByDay     —— 先各自抹掉钟点，只比「哪一天」。
   *
   * ByDay 存在的理由（V04）：周期推进若按具体时刻比，原期是 `1/31 09:00` 时，
   * 拼出来的 `1/31 10:00 > 1/31 09:00` 会被判成「仍是未来」，最后 `applyClock`
   * 又把钟点换回 `09:00` —— 返回与原期**完全相同**的时间，周期原地打转。
   *
   * 反过来，解析器的「首期候选」（ByInstant）必须保留原口径：
   * 锚点正好落在该周几、且时刻早于 10:00 时，当天就是合法候选。
   * ------------------------------------------------------------------ */

  /** 首期候选语义（原 lib/parse-cn.js 口径） */
  function nthWeekdayOfNextMonthByInstant(from, nth, dow, hour, minute) {
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

  /** 周期推进语义（原 lib/repeat.js 口径，V04：按「日」比较） */
  function nthWeekdayOfNextMonthByDay(from, nth, dow, hour, minute) {
    const base = from instanceof Date ? new Date(from.getTime()) : new Date(from);
    const baseDay = dayStart(base);
    let y = base.getFullYear(), m = base.getMonth();
    let d = nthWeekdayInMonth(y, m, nth, dow);
    d.setHours(10, 0, 0, 0);
    if (dayStart(d) <= baseDay) {
      m += 1;
      if (m > 11) { m = 0; y += 1; }
      d = nthWeekdayInMonth(y, m, nth, dow);
      d.setHours(10, 0, 0, 0);
    }
    if (hour != null) d.setHours(hour, minute || 0, 0, 0);
    return d.getTime();
  }

  return {
    startOfDay,
    endOfDay,
    addDays,
    sameDay,
    nextWeekend,
    applyClock,
    lastDayOfMonth,
    nthWeekdayInMonth,
    weekdayOfNextWeek,
    dayOfMonthIn,
    nextDayOfMonth,
    dayStart,
    nthWeekdayOfNextMonthByInstant,
    nthWeekdayOfNextMonthByDay
  };
});
