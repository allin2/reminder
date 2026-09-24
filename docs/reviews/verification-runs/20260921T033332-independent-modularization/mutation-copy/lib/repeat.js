/* Repeat rules — UMD */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else {
    root.AttentionLib = root.AttentionLib || {};
    const api = factory(root);
    Object.keys(api).forEach(function (k) {
      // 与 lib/parse-cn.js 同理：`nthWeekdayOfNextMonth` 语义故意不同（这里是按「日」比较），
      // 不并入扁平命名空间，避免「谁后加载谁生效」。
      if (k === "nthWeekdayOfNextMonth") return;
      root.AttentionLib[k] = api[k];
    });
    root.AttentionLib.nthWeekdayOfNextMonthByDay = api.nthWeekdayOfNextMonth;
  }
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  /**
   * 日历原语来自 `lib/date-utils.js` 的**命名空间**导出（显式依赖，不靠加载顺序覆盖）。
   * 拿不到就是装配错误 —— 不再自带一份同算法副本兜底。
   */
  const P = (function () {
    if (root && root.AttentionLib && root.AttentionLib.DatePrimitives) return root.AttentionLib.DatePrimitives;
    try {
      if (typeof require === "function") return require("./date-utils.js");
    } catch (error) {}
    return null;
  })();

  if (!P) {
    throw new Error("repeat.js: 缺少 lib/date-utils.js（日历原语唯一来源）。请检查 index.html 的脚本顺序。");
  }

  const addDays = P.addDays;
  const applyClock = P.applyClock;
  const lastDayOfMonth = P.lastDayOfMonth;
  const nthWeekdayInMonth = P.nthWeekdayInMonth;
  /**
   * 周期推进语义（V04）：按**日**比较，不能拿拼好的 10:00 时间戳去比锚点。
   * 原期是 1/31 09:00 时，1/31 10:00 > 1/31 09:00 会被判定为「仍是未来」，
   * 最后 `applyClock` 又换回 09:00 → 返回与原期完全相同的时间（死循环）。
   * 解析器的「首期候选」用的是另一个函数（`parse-cn.js` → `ByInstant`），两者故意不同。
   */
  const nthWeekdayOfNextMonth = P.nthWeekdayOfNextMonthByDay;

  /**
   * 下一周期时刻（L03）。
   *
   * 两种周期必须分开兑现承诺：
   *  · calendar（日历规则）：锚点是「原定时刻」，与用户何时 ACK / 完成无关。
   *    否则「每月 1 日」会因为在 5 日才确认、6 日才完成而漂到次月 5 日。
   *  · ack（ACK 后计时）：锚点是「有效的 ACK 时刻」。
   *
   * `fromTs` 仍可作为显式锚点（用于预览与单元测试）；不传时按上面的规则回退。
   * 月份推进一律从「目标月份的首日」定位，不再对 29/30/31 日直接 `setMonth(+1)`
   * （那会让 1 月 31 日溢出成 3 月 3 日）。
   */
  function nextRepeatTrigger(it, fromTs) {
    const rep = (it && it.repeat) || {};
    const every = rep.every;
    if (!every) return null;
    const ackBased = rep.mode === "ack";
    const anchor = fromTs != null
      ? Number(fromTs)
      : (ackBased
        ? (it.acknowledgedAt || Date.now())
        : (it.triggerAt || it.acknowledgedAt || Date.now()));
    if (!Number.isFinite(anchor)) return null;

    if (every === "day") return applyClock(addDays(new Date(anchor), 1), it.triggerAt);
    if (every === "week") return applyClock(addDays(new Date(anchor), 7), it.triggerAt);
    if (every === "biweek") return applyClock(addDays(new Date(anchor), 14), it.triggerAt);
    if (every === "month") {
      const base = new Date(anchor);
      const y = base.getFullYear();
      const m = base.getMonth() + 1;
      const ny = y + Math.floor(m / 12);
      const nm = ((m % 12) + 12) % 12;
      // 目标月份未必有这一天（1/31 → 2 月）：收敛到该月最后一天
      const day = Math.min(base.getDate(), new Date(ny, nm + 1, 0).getDate());
      return applyClock(new Date(ny, nm, day), it.triggerAt);
    }
    if (every === "monthEnd") {
      // V04：必须按「日」比较，不能拿拼好的 10:00 时间戳去比锚点。
      // 原期是 1/31 09:00 时，1/31 10:00 > 1/31 09:00 会被判定为"仍是未来"，
      // 最后 applyClock 又换回 09:00 → 返回与原期完全相同的时间（死循环）。
      const base = new Date(anchor);
      const baseDay = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime();
      let d = new Date(lastDayOfMonth(base).getFullYear(), lastDayOfMonth(base).getMonth(), lastDayOfMonth(base).getDate());
      if (d.getTime() <= baseDay) {
        // 从下一个月的首日定位，避免 29/30/31 日直接 +1 月造成的日期溢出
        d = lastDayOfMonth(new Date(base.getFullYear(), base.getMonth() + 1, 1));
      }
      return applyClock(d, it.triggerAt);
    }
    if (every === "nthWeekday") {
      const s = new Date(it.triggerAt || anchor);
      return nthWeekdayOfNextMonth(
        anchor,
        rep.nth || 1,
        rep.dow != null ? rep.dow : 1,
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
