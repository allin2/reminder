/* Chinese NL time parser — UMD */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else {
    root.AttentionLib = root.AttentionLib || {};
    Object.assign(root.AttentionLib, factory());
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function nextWeekend(from) {
    const d = startOfDay(from || new Date());
    const day = d.getDay();
    let add = (6 - day + 7) % 7;
    if (day === 0) add = 6;
    const sat = addDays(d, add);
    sat.setHours(10, 0, 0, 0);
    return sat.getTime();
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

  const CN_NUM = {
    "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6,
    "七": 7, "八": 8, "九": 9, "十": 10, "十一": 11, "十二": 12, "十三": 13, "十四": 14,
    "十五": 15, "十六": 16, "十七": 17, "十八": 18, "十九": 19, "二十": 20, "二十一": 21,
    "二十二": 22, "二十三": 23, "三十": 30, "三十一": 31
  };
  function cnInt(str) {
    if (str == null || str === "") return null;
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    if (CN_NUM[str] != null) return CN_NUM[str];
    if (str.startsWith("三十")) return 30 + (str.length > 2 ? (CN_NUM[str.slice(2)] || 0) : 0);
    if (str.startsWith("二十")) return 20 + (str.length > 2 ? (CN_NUM[str.slice(2)] || 0) : 0);
    if (str.startsWith("十")) return 10 + (str.length > 1 ? (CN_NUM[str.slice(1)] || 0) : 0);
    return null;
  }

  function parseChineseTime(input, now) {
    now = now || new Date();
    let text = String(input || "").trim();
    let confidence = "none";
    let trigger = null;
    let deadline = null;
    let win = null;
    let repeat = null;
    let cleaned = text;
    const base = startOfDay(now);

    if (/每两周|隔周|每两星期/.test(text)) {
      repeat = { mode: "ack", every: "biweek" };
      cleaned = cleaned.replace(/每两周|隔周|每两星期/g, "");
    } else if (/每月.{0,4}(最后一天|月底|月末)|每月底|每月末/.test(text)) {
      repeat = { mode: "calendar", every: "monthEnd" };
      cleaned = cleaned.replace(/每月.{0,4}(最后一天|月底|月末)|每月底|每月末/g, "");
    } else if (/每月第\s*([一二三四五六日天]|\d)\s*个\s*(星期|周)?\s*([一二三四五六日天])/.test(text)) {
      const m = text.match(/每月第\s*([一二三四五六日天]|\d)\s*个\s*(?:星期|周)?\s*([一二三四五六日天])/);
      const nthMap = { "一": 1, "二": 2, "三": 3, "四": 4, "1": 1, "2": 2, "3": 3, "4": 4 };
      const dowMap = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 };
      const nth = nthMap[m[1]] || 1;
      const dow = dowMap[m[2]];
      repeat = { mode: "calendar", every: "nthWeekday", nth, dow };
      cleaned = cleaned.replace(m[0], "");
    } else if (/每周|每星期/.test(text)) {
      repeat = { mode: "calendar", every: "week" };
      cleaned = cleaned.replace(/每周|每星期/g, "");
    } else if (/每天|每日/.test(text)) {
      repeat = { mode: "calendar", every: "day" };
      cleaned = cleaned.replace(/每天|每日/g, "");
    } else if (/每月|每个月/.test(text)) {
      repeat = { mode: "calendar", every: "month" };
      cleaned = cleaned.replace(/每月|每个月/g, "");
    }

    const hasDeadlineKw = /截止|最后一天|到期|报名结束|提交截止|deadline/i.test(text);
    let advanceDays = null;
    const adv = text.match(/提前\s*([0-9一二两三四五六七八九十]+)\s*天/);
    if (adv) {
      advanceDays = cnInt(adv[1]);
      cleaned = cleaned.replace(adv[0], "");
    }

    let deadlineAnchor = null;
    const absDate = text.match(/(\d{1,2}|[一二三四五六七八九十]+)\s*月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[日号]/);
    if (absDate) {
      const m = cnInt(absDate[1]);
      const d = cnInt(absDate[2]);
      if (m && d) {
        const y = now.getFullYear();
        let dt = new Date(y, m - 1, d, 10, 0, 0, 0);
        if (dt < startOfDay(now)) dt = new Date(y + 1, m - 1, d, 10, 0, 0, 0);
        deadlineAnchor = dt.getTime();
        cleaned = cleaned.replace(absDate[0], "");
        if (hasDeadlineKw) deadline = endOfDay(dt).getTime();
      }
    }

    let hour = null, minute = 0;
    const clock = text.match(/(上午|中午|下午|晚上|早上)?\s*(\d{1,2})[:：](\d{2})/);
    if (clock) {
      hour = parseInt(clock[2], 10);
      minute = parseInt(clock[3], 10);
      const mer = clock[1];
      if ((mer === "下午" || mer === "晚上") && hour < 12) hour += 12;
      if (mer === "中午") hour = 12;
      cleaned = cleaned.replace(clock[0], "");
    } else {
      const clock2 = text.match(/(上午|中午|下午|晚上|早上)?\s*([0-9一二两三四五六七八九十]+)\s*[点時时](\s*([0-9一二两三四五六七八九十]+)\s*分?)?/);
      if (clock2) {
        hour = cnInt(clock2[2]);
        minute = clock2[4] ? (cnInt(clock2[4]) || 0) : 0;
        const mer = clock2[1];
        if ((mer === "下午" || mer === "晚上") && hour != null && hour < 12) hour += 12;
        if (mer === "中午" && hour != null) hour = 12;
        cleaned = cleaned.replace(clock2[0], "");
      }
    }

    function applyTime(ts, h, m) {
      const d = new Date(ts);
      if (h != null) d.setHours(h, m || 0, 0, 0);
      else d.setHours(10, 0, 0, 0);
      return d.getTime();
    }

    if (/大后天/.test(text)) {
      trigger = applyTime(addDays(base, 3).getTime(), hour, minute);
      confidence = "high";
      cleaned = cleaned.replace(/大后天/g, "");
    } else if (/后天/.test(text)) {
      trigger = applyTime(addDays(base, 2).getTime(), hour, minute);
      confidence = "high";
      cleaned = cleaned.replace(/后天/g, "");
    } else if (/明天/.test(text)) {
      trigger = applyTime(addDays(base, 1).getTime(), hour, minute);
      confidence = "high";
      cleaned = cleaned.replace(/明天/g, "");
    } else if (/今天|今晚|今早/.test(text)) {
      let h = hour;
      if (h == null) h = /今晚/.test(text) ? 20 : (/今早/.test(text) ? 9 : now.getHours() + 1);
      trigger = applyTime(base.getTime(), h, minute);
      if (trigger < now.getTime() && !/今晚|今早/.test(text)) trigger = now.getTime() + 5 * 60000;
      confidence = "high";
      cleaned = cleaned.replace(/今天|今晚|今早/g, "");
    } else if (/周末/.test(text)) {
      const t = nextWeekend(now);
      trigger = hour != null ? applyTime(t, hour, minute) : t;
      win = { start: t, end: endOfDay(addDays(t, 1)).getTime() };
      confidence = "mid";
      cleaned = cleaned.replace(/周末/g, "");
    } else if (/下周日|下星期日/.test(text)) {
      const d = startOfDay(now);
      const day = d.getDay();
      const toNextSun = ((7 - day) % 7) + 7;
      trigger = applyTime(addDays(d, toNextSun).getTime(), hour, minute);
      confidence = "high";
      cleaned = cleaned.replace(/下周日|下星期日/g, "");
    } else if (/下周([一二三四五六日天])|下星期([一二三四五六日天])/.test(text)) {
      const m = text.match(/下周([一二三四五六日天])|下星期([一二三四五六日天])/);
      const ch = m[1] || m[2];
      const map = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 };
      const target = map[ch];
      const d = startOfDay(now);
      const day = d.getDay();
      let delta = ((target - day + 7) % 7) || 7;
      delta += 7;
      trigger = applyTime(addDays(d, delta).getTime(), hour, minute);
      confidence = "high";
      cleaned = cleaned.replace(m[0], "");
    } else if (/这?周([一二三四五六日天])|本?星期([一二三四五六日天])/.test(text)) {
      const m = text.match(/这?周([一二三四五六日天])|本?星期([一二三四五六日天])/);
      const ch = m[1] || m[2];
      const map = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 };
      const target = map[ch];
      const d = startOfDay(now);
      const day = d.getDay();
      const delta = (target - day + 7) % 7;
      let ts = applyTime(addDays(d, delta).getTime(), hour, minute);
      if (ts <= now.getTime() && hour == null) ts = now.getTime() + 60 * 60000;
      trigger = ts;
      confidence = "high";
      cleaned = cleaned.replace(m[0], "");
    } else if (/月底|月末/.test(text)) {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 0, 10, 0, 0, 0);
      trigger = d.getTime();
      confidence = "mid";
      cleaned = cleaned.replace(/月底|月末/g, "");
    } else if (/下个月|下月/.test(text)) {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 1, 10, 0, 0, 0);
      trigger = hour != null ? applyTime(d.getTime(), hour, minute) : d.getTime();
      confidence = "mid";
      cleaned = cleaned.replace(/下个月|下月/g, "");
    } else if (/过两天/.test(text)) {
      trigger = applyTime(addDays(base, 2).getTime(), hour, minute);
      confidence = "mid";
      cleaned = cleaned.replace(/过两天/g, "");
    } else if (/过阵子|以后|回头|改天|之后/.test(text)) {
      trigger = applyTime(addDays(base, 7).getTime(), hour, minute);
      confidence = "low";
      cleaned = cleaned.replace(/过阵子|以后|回头|改天|之后/g, "");
    } else if (/([0-9一二两三四五六七八九十]+)\s*[天日]\s*后/.test(text)) {
      const m = text.match(/([0-9一二两三四五六七八九十]+)\s*[天日]\s*后/);
      const n = cnInt(m[1]) || 1;
      trigger = applyTime(addDays(base, n).getTime(), hour, minute);
      confidence = "high";
      cleaned = cleaned.replace(m[0], "");
    } else if (absDate && deadlineAnchor) {
      if (hasDeadlineKw) {
        const off = advanceDays != null ? advanceDays : 3;
        trigger = applyTime(addDays(new Date(deadlineAnchor), -off).getTime(), hour, minute);
        deadline = endOfDay(new Date(deadlineAnchor)).getTime();
        confidence = "high";
      } else {
        trigger = deadlineAnchor;
        confidence = "mid";
      }
    } else if (hour != null) {
      let ts = applyTime(base.getTime(), hour, minute);
      if (ts <= now.getTime()) ts = applyTime(addDays(base, 1).getTime(), hour, minute);
      trigger = ts;
      confidence = "mid";
    } else if (repeat) {
      if (repeat.every === "day") trigger = applyTime(addDays(base, 1).getTime(), 10, 0);
      else if (repeat.every === "week") trigger = applyTime(addDays(base, 7).getTime(), 10, 0);
      else if (repeat.every === "biweek") trigger = applyTime(addDays(base, 14).getTime(), 10, 0);
      else if (repeat.every === "monthEnd") trigger = applyTime(new Date(now.getFullYear(), now.getMonth() + 1, 0, 10, 0, 0, 0).getTime(), 10, 0);
      else if (repeat.every === "nthWeekday") trigger = nthWeekdayOfNextMonth(now, repeat.nth || 1, repeat.dow != null ? repeat.dow : 1, hour, minute);
      else trigger = applyTime(addDays(base, 30).getTime(), 10, 0);
      confidence = "mid";
    }

    if (!trigger) {
      trigger = applyTime(addDays(base, 7).getTime(), 10, 0);
      confidence = "low";
    }

    let title = cleaned
      .replace(/提醒我|提醒一下|提醒|记得|别忘了|需要|帮我|请/g, " ")
      .replace(/看一眼|看一下|看看|瞧瞧/g, "看看")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) title = text.trim() || "未命名事项";

    const tags = [];
    const hashTags = title.match(/#([^\s#]+)/g) || [];
    hashTags.forEach(t => tags.push(t.slice(1)));
    title = title.replace(/#[^\s#]+/g, "").replace(/\s+/g, " ").trim();

    return { title, trigger, deadline, window: win, repeat, confidence, raw: text, tags };
  }

  /** 含具体时间指向词（D15「必要」判定：与模糊词相对） */
  function hasSpecificTimeWord(text) {
    const t = String(text || "");
    if (!t) return false;
    return /大后天|后天|明天|今天|今晚|今早|周末|下周[一二三四五六日天]|下星期[一二三四五六日天]|这?周[一二三四五六日天]|本?星期[一二三四五六日天]|月底|月末|下个月|下月|过两天|([0-9一二两三四五六七八九十]+)\s*[天日]\s*后|([一二三四五六七八九十]+)\s*月\s*([0-9一二两三四五六七八九十]+)\s*[日号]|\d{1,2}:\d{2}/.test(t);
  }

  return {
    parseChineseTime,
    hasSpecificTimeWord,
    cnInt,
    nextWeekend,
    startOfDay,
    endOfDay,
    addDays,
    lastDayOfMonth,
    nthWeekdayInMonth,
    nthWeekdayOfNextMonth
  };
});
