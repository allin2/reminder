/* 安心收件箱 — Local-first attention hub
 * 原则：Attention ≠ Task · Acknowledged ≠ Completed · Future 默认不可见
 */
(function () {
  "use strict";

  const KEY = "attention-inbox-v2";
  // D43：schema 5 = 事项新增 `reminderEvents`（单次提醒台账，与 deadlineEvents 同构）。
  // 旧记录缺这个字段时由 normalizeItem 补 `{}`；`schemaMigrationNeeded` 触发一次重写落库。
  const SCHEMA = 5;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const Lib = (typeof AttentionLib !== "undefined" && AttentionLib) || {};
  const NativeReminders = (typeof AttentionNativeReminders !== "undefined" && AttentionNativeReminders) || {};
  const storage = Lib.createStorage
    ? Lib.createStorage({ lsKey: KEY })
    : null;
  let storageReady = false;
  let schemaMigrationNeeded = false;
  let nativeReady = false;
  let nativeSyncTimer = null;
  // Q6：原生初始化的 in-flight promise。
  // 保证「同一时刻只有一次初始化在跑」，同时**允许失败后重试**
  // （跑完置回 null，下一次请求会再试一遍）。
  let nativeInitPromise = null;
  // L01 / L05：时间来源必须可区分 —— 「用户手选」不能被解析器或系统兜底悄悄覆盖
  let triggerUserPicked = false;
  let reviewTriggerUserPicked = false;
  let nativeReminderStatus = {
    native: false,
    notifications: "unknown",
    exactAlarm: "unknown",
    reliability: "web"
  };

  /* ---------- utils ---------- */
  function uid() {
    return "i_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts), now = new Date();
    const t = pad(d.getHours()) + ":" + pad(d.getMinutes());
    if (sameDay(d, now)) return "今天 " + t;
    if (sameDay(d, addDays(now, 1))) return "明天 " + t;
    if (sameDay(d, addDays(now, -1))) return "昨天 " + t;
    const md = (d.getMonth() + 1) + "月" + d.getDate() + "日";
    if (d.getFullYear() !== now.getFullYear()) return d.getFullYear() + "年" + md + " " + t;
    return md + " " + t;
  }
  function fmtDate(ts) {
    if (!ts) return "";
    const d = new Date(ts), now = new Date();
    if (sameDay(d, now)) return "今天";
    if (sameDay(d, addDays(now, 1))) return "明天";
    if (sameDay(d, addDays(now, -1))) return "昨天";
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }
  function relDue(ts) {
    const diff = ts - Date.now();
    const abs = Math.abs(diff);
    const h = Math.round(abs / 3600000);
    if (diff < 0) {
      if (abs < 3600000) return "已过 " + Math.max(1, Math.round(abs / 60000)) + " 分钟";
      if (h < 24) return "已过 " + h + " 小时";
      return "已过 " + Math.round(abs / 86400000) + " 天";
    }
    if (abs < 60000) return "现在";
    if (abs < 3600000) return Math.round(abs / 60000) + " 分钟后";
    if (abs < 86400000) return h + " 小时后";
    return Math.round(abs / 86400000) + " 天后";
  }
  function nextWeekend(from) {
    const d = startOfDay(from || new Date());
    const day = d.getDay();
    let add = (6 - day + 7) % 7;
    if (day === 0) add = 6;
    const sat = addDays(d, add);
    sat.setHours(10, 0, 0, 0);
    return sat.getTime();
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function toLocalInput(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function parseLocalInput(v) {
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }
  function dayLabel(ts) {
    if (!ts) return "更早";
    const d = new Date(ts), now = new Date();
    if (sameDay(d, now)) return "今天";
    if (sameDay(d, addDays(now, -1))) return "昨天";
    if (d.getFullYear() !== now.getFullYear()) {
      return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
    }
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }
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

  /** nth weekday of month. nth=-1 means last. */
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
    // V04：按「日」比较（与 lib/repeat.js 同一实现）
    const baseDay = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime();
    let y = base.getFullYear(), m = base.getMonth();
    let d = nthWeekdayInMonth(y, m, nth, dow);
    d.setHours(10, 0, 0, 0);
    if (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() <= baseDay) {
      m += 1;
      if (m > 11) { m = 0; y += 1; }
      d = nthWeekdayInMonth(y, m, nth, dow);
      d.setHours(10, 0, 0, 0);
    }
    if (hour != null) d.setHours(hour, minute || 0, 0, 0);
    return d.getTime();
  }

  /**
   * 与 lib/parse-cn.js 同名函数保持一致（H-01）。
   *
   * 本文件自带一份解析器副本，只在 lib/*.js 未加载时兜底；`Lib.parseChineseTime`
   * 一旦可用就会覆盖本副本（见文件末尾的覆盖块）。两副本必须同步，否则线上跑的是
   * lib、兜底跑的是另一套规则。M-10 记录了「整份重复已分叉」这件事。
   */
  function weekdayOfNextWeek(from, weekOffset, target) {
    const d = startOfDay(from);
    const day = d.getDay();
    const toMonday = ((8 - day) % 7) || 7;
    const monday = addDays(d, toMonday + (weekOffset - 1) * 7);
    return addDays(monday, (target + 6) % 7);
  }

  function dayOfMonthIn(year, month, day) {
    const last = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(day, last), 10, 0, 0, 0);
  }

  function nextDayOfMonth(from, day) {
    const base = startOfDay(from);
    const today = dayOfMonthIn(base.getFullYear(), base.getMonth(), day);
    if (today.getTime() > new Date(from).getTime()) return today.getTime();
    const y = base.getMonth() === 11 ? base.getFullYear() + 1 : base.getFullYear();
    return dayOfMonthIn(y, (base.getMonth() + 1) % 12, day).getTime();
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
  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type: type || "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* Minimal markdown renderer */
  function renderMarkdown(src) {
    let text = escapeHtml(src || "");
    // fenced code
    text = text.replace(/```([\s\S]*?)```/g, (_, code) => "<pre><code>" + code.trim() + "</code></pre>");
    // headings
    text = text.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    text = text.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    text = text.replace(/^# (.+)$/gm, "<h1>$1</h1>");
    // blockquote
    text = text.replace(/^&gt; (.+)$/gm, "<blockquote><p>$1</p></blockquote>");
    // bold / italic / code
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    // links
    text = text.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // lists
    text = text.replace(/(?:^|\n)((?:- .+(?:\n|$))+)/g, (m, block) => {
      const items = block.trim().split(/\n/).map(l => "<li>" + l.replace(/^- /, "") + "</li>").join("");
      return "\n<ul>" + items + "</ul>";
    });
    text = text.replace(/(?:^|\n)((?:\d+\. .+(?:\n|$))+)/g, (m, block) => {
      const items = block.trim().split(/\n/).map(l => "<li>" + l.replace(/^\d+\. /, "") + "</li>").join("");
      return "\n<ol>" + items + "</ol>";
    });
    // paragraphs
    text = text.split(/\n{2,}/).map(chunk => {
      const t = chunk.trim();
      if (!t) return "";
      if (/^<(h\d|ul|ol|pre|blockquote)/.test(t)) return t;
      return "<p>" + t.replace(/\n/g, "<br/>") + "</p>";
    }).join("\n");
    return text;
  }

  /* ---------- Chinese NL parser ---------- */
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
    /** H-02：「每月 N 号」里的 N；为 null 表示只说「每月」没说号数 */
    let monthDay = null;
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
      // N-04：星期几必须跟着「每周」一起剥掉，否则标题会留下孤立的「一」（「一站会」）。
      const wm = text.match(/每(?:周|星期)\s*[一二三四五六日天]?/);
      cleaned = cleaned.replace(wm ? wm[0] : /每周|每星期/g, "");
    } else if (/每天|每日/.test(text)) {
      repeat = { mode: "calendar", every: "day" };
      cleaned = cleaned.replace(/每天|每日/g, "");
    } else if (/每月|每个月/.test(text)) {
      repeat = { mode: "calendar", every: "month" };
      // H-02：「每月15号」必须留下 15，否则落「+30 天」兜底并永久漂移到 18 号。
      const md = text.match(/每(?:个)?月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[日号]/);
      if (md) monthDay = cnInt(md[1]);
      cleaned = cleaned.replace(md ? md[0] : /每月|每个月/g, "");
    }

    /**
     * N-04 / M-03：截止语义不能只认「截止/到期」等硬词，否则「9点前」「之前」既丢截止又污染标题。
     * 刻意不用 lookbehind —— 老 Android WebView 会直接抛语法错误，让整个文件加载失败。
     */
    const beforeAlt = text.match(/之前|以前/);
    let beforeToken = null;
    if (beforeAlt) beforeToken = beforeAlt[0];
    else if (/[点時时]\s*\d*\s*分?\s*前|半\s*前|[:：]\s*\d{2}\s*前|\d{1,2}\s*[日号]\s*前|(?:周|星期)[一二三四五六日天末]\s*前|(?:今天|明天|后天|大后天|今晚|今早|月底|月末|下个月|下月)\s*前/.test(text)) beforeToken = "前";

    const hasDeadlineKw = /截止|最后一天|到期|报名结束|提交截止|deadline/i.test(text) || beforeToken != null;
    if (beforeToken) cleaned = cleaned.replace(beforeToken, "");
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
      const clock2 = text.match(/(上午|中午|下午|晚上|早上)?\s*([0-9一二两三四五六七八九十]+)\s*[点時时](\s*(半|[0-9一二三四五六七八九十]+)\s*分?)?/);
      if (clock2) {
        hour = cnInt(clock2[2]);
        minute = clock2[4] === "半" ? 30 : (clock2[4] ? (cnInt(clock2[4]) || 0) : 0);
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
    } else if (/(下+)周([一二三四五六日天])|(下+)星期([一二三四五六日天])/.test(text)) {
      // H-01：合并原「下周日」「下周X」两分支（语义相同、实现不一致 → 「下周三」晚一周）。
      // 「下+」同时覆盖「下下周X」，不再留下孤立的「下」（「下开会」）。
      const m = text.match(/(下+)周([一二三四五六日天])|(下+)星期([一二三四五六日天])/);
      const weekOffset = (m[1] || m[3] || "下").length;
      const ch = m[2] || m[4];
      const map = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 };
      trigger = applyTime(weekdayOfNextWeek(now, weekOffset, map[ch]).getTime(), hour, minute);
      confidence = "high";
      cleaned = cleaned.replace(m[0], "");
    } else if (/(这|本)?周([一二三四五六日天])|(这|本)?星期([一二三四五六日天])/.test(text)) {
      // N-04：「本周五」的「本」要一起剥掉，否则标题留下孤立的「本」
      const m = text.match(/(这|本)?周([一二三四五六日天])|(这|本)?星期([一二三四五六日天])/);
      const ch = m[2] || m[4];
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
      // 「下个月底」此前落到「本月底」（先匹配到「月底」），日期整整早一个月
      const nextMonth = /下个月|下月/.test(text);
      const y = nextMonth && now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
      const m2 = nextMonth ? (now.getMonth() + 1) % 12 : now.getMonth();
      trigger = new Date(y, m2 + 1, 0, 10, 0, 0, 0).getTime();
      confidence = "mid";
      cleaned = cleaned.replace(nextMonth ? /下个月底|下个月末|下月底|下月末/g : /月底|月末/g, "");
    } else if (/下个月|下月/.test(text)) {
      // H-03：号数此前被丢掉、硬编码成 1 号（「下个月5号」→ 10-01，应 10-05）
      const nm = text.match(/(?:下个月|下月)\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[日号]/);
      const day = nm ? cnInt(nm[1]) : 1;
      const y = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
      const d = dayOfMonthIn(y, (now.getMonth() + 1) % 12, day);
      trigger = hour != null ? applyTime(d.getTime(), hour, minute) : d.getTime();
      confidence = "mid";
      cleaned = cleaned.replace(nm ? nm[0] : /下个月|下月/g, "");
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
      // H-02：「每月N号」锚到 N 号的下一次出现
      else if (monthDay != null) trigger = applyTime(nextDayOfMonth(now, monthDay), hour, minute);
      else trigger = applyTime(addDays(base, 30).getTime(), 10, 0);
      confidence = "mid";
    }

    if (!trigger) {
      trigger = applyTime(addDays(base, 7).getTime(), 10, 0);
      confidence = "low";
    }

    // N-04 / M-03：带截止语义的表达，其时间点即截止（有明确时刻精确到那一刻，否则取当天末尾）。
    // 只对「X 前 / 之前」生效 —— 按 hasDeadlineKw 放宽会把「每月最后一天交房租」这类
    // **周期**表达也变成截止事项，每个周期多一轮截止提醒，净增打扰。
    if (beforeToken != null && deadline == null && trigger != null) {
      deadline = hour != null ? trigger : endOfDay(new Date(trigger)).getTime();
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

  /* ---------- state ---------- */
  const PROJECT_COLORS = ["#1b6b4a", "#3d5a80", "#9a6b12", "#8f3a3a", "#5b4b8a", "#2f6f7a"];

  let state = {
    schema: SCHEMA,
    items: [],
    notes: [],
    projects: [],
    settings: {
      notify: false,
      notifyPrompted: false,
      onboardDone: false,
      dnd: true,
      importantRepeat: true,
      quietStart: "23:00",
      quietEnd: "07:30",
      dailySummary: false,
      privacyNotify: false,
      lastSummaryAt: 0,
      // D25 / A-01：未标记事项的默认投递方式（录入时快照）
      defaultDeliveryMode: "notification",
      review: {
        enabled: true,
        hour: 21,
        minute: 30,
        windowEndHour: 23,
        windowEndMinute: 0,
        // D22：60 分钟 × 2 次
        followupMs: 60 * 60 * 1000,
        maxFollowups: 2,
        lastNotifiedAt: 0,
        followupCount: 0,
        snoozedUntil: 0,
        skippedUntil: 0,
        sessionStatus: "idle",
        lastSessionKey: ""
      },
      ai: {
        enabled: false,
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o-mini",
        autoOnSave: false
      }
    },
    ui: {
      tab: "home",
      futureSeg: "waiting",
      futureFilter: "all",
      notesFilter: "all",
      calMonth: null,
      calSelected: null,
      snoozeId: null,
      detailId: null,
      editItemId: null,
      editNoteId: null,
      notePin: false,
      projectColor: PROJECT_COLORS[0],
      reviewIndex: 0,
      reviewQueue: [],
      activeExpanded: false
    }
  };

  function currentPayload() {
    return {
      schema: SCHEMA,
      items: state.items,
      notes: state.notes,
      projects: state.projects,
      settings: state.settings
    };
  }

  /**
   * 把整个状态写一份快照到权威后端。**不加闸门**，只做「取快照 + 写」这一件事。
   *
   *  · **H2 权威后端**：能用 IndexedDB 就以它为准（storage.save 内部把 localStorage 当镜像
   *    尽力写），没有可用后端时才由 localStorage 拍板。判定只看**权威后端**的提交结果 ——
   *    镜像写失败不能把已经提交的事务说成没提交，否则内存回滚、磁盘却留着新数据。
   *  · **H1 独立快照**：一次提交只序列化一次，再解析出**独立副本**交给后端。
   *    IndexedDB 的 `put` 发生在 microtask 之后，直接传活对象会让期间的内存改动混进
   *    这次提交的内容，让「这笔到底写了什么」不可预测。
   */
  async function writeSnapshot(payload, options) {
    const json = JSON.stringify(payload || currentPayload());
    if (storage && storageReady) {
      await storage.save(JSON.parse(json)); // 权威提交：失败即本次提交失败
      // H-07：这次写入**没有落进权威后端** —— IDB 本来可用（hasIdb 为真），
      // 但本次会话只降级落在 localStorage 镜像上。必须留待回放凭据，否则下次
      // IDB 恢复正常时 loadAsync 会读到 IDB 里的旧值，这段改动静默消失。
      //
      // 只在「本该用 IDB 却只落了镜像」时留凭据：设备**根本没有** IndexedDB 时
      // backend 恒为 local，IDB 不可能是权威，留凭据只会让每次启动都做一次无效重放。
      if (authoritativeBackendMissing()) markPendingReplay(json);
      committedAlarmItems = JSON.parse(json).items || [];
      if (!(options && options.deferNativeSync)) queueNativeReminderSync();
      return true;
    }
    // 没有可用存储后端：localStorage 就是权威
    localStorage.setItem(KEY, json);
    // H-07：降级期的写入**必须留一份待回放凭据**。否则 IDB 一旦恢复，
    // loadAsync 会从 IDB 的旧值加载，这期间用户改的东西静默消失。
    markPendingReplay(json);
    committedAlarmItems = JSON.parse(json).items || [];
    if (!(options && options.deferNativeSync)) queueNativeReminderSync();
    return true;
  }

  /**
   * H-07：IndexedDB 可用、但**这一次没有用它**（本会话降级到了 localStorage 镜像）。
   *
   * `lib/storage.js` 的 `ensure()` 在 `openDb()` 失败时会整体切到 `backend = "local"`，
   * 此后所有写入都只落镜像 —— `storageReady` 仍然是 true，这条路径**不会**走上面的
   * 降级分支，所以必须单独识别，否则「IDB 打不开」这一最常见形态恰好漏掉。
   */
  function authoritativeBackendMissing() {
    try {
      return typeof Lib.hasIdb === "function" && Lib.hasIdb() && storage.backend !== "idb";
    } catch (error) {
      return false;
    }
  }

  /**
   * H-07 / D47：降级期写入的「待回放快照」。
   *
   * 降到 localStorage 之后**照旧立即落盘**（用户可见行为不变：写入仍然成功），
   * 但同时把这一份完整状态留在独立键里 —— IDB 恢复时由 `replayPendingSnapshot`
   * 写回权威后端，降级期间的改动不再丢失。
   */
  const PENDING_REPLAY_KEY = KEY + "-pending-replay";

  function markPendingReplay(json) {
    try {
      localStorage.setItem(PENDING_REPLAY_KEY, JSON.stringify({ at: Date.now(), json: json }));
    } catch (error) {
      // 配额不足时**不能**影响主写入路径（localStorage 此刻就是权威，已经写成功了），
      // 但必须留下可见痕迹：这一份改动将无法自动回放到 IDB。
      console.error(
        "pending replay snapshot failed (degraded write will not be replayed):",
        error && error.message ? error.message : error
      );
    }
  }

  function readPendingReplay() {
    try {
      const raw = localStorage.getItem(PENDING_REPLAY_KEY);
      if (!raw) return null;
      const pending = JSON.parse(raw);
      return pending && typeof pending.json === "string" ? pending : null;
    } catch (error) {
      return null;
    }
  }

  function clearPendingReplay() {
    try { localStorage.removeItem(PENDING_REPLAY_KEY); } catch (error) {}
  }

  /**
   * **提交闸门**：同一时刻只有一笔权威提交在跑，轮到谁谁才取快照。
   * 原生动作的校验、草稿变更、提交与发布整体在闸门内；普通保存排在它的结果之后，
   * 失败不会锁死后续提交，成功前也不会把未确认动作混入其它快照。
   */
  let commitChain = Promise.resolve();

  function runCommit(job) {
    // 前一笔不论成败都要放行下一笔，否则一次失败会永久卡住后续所有保存
    const next = commitChain.then(job, job);
    commitChain = next.then(() => {}, () => {});
    return next;
  }

  /**
   * F2 / I1：返回**真实的持久化 Promise**（过闸门）。
   *
   * 原生动作队列必须在数据真正落库之后才确认删除，所以不能再「发起了 save 就当已保存」——
   * 那样 handler 一返回原生就把事件删了，此时 IndexedDB 事务可能还没提交，崩溃即丢操作。
   */
  async function saveAsync() {
    return runCommit(writeSnapshot);
  }

  /**
   * H1：**只**抑制「动作同步变更体内部」的重复保存。
   *
   * `ackItem` / `completeItem` / `snoozeItem` 内部各自会 `save()`。当草稿 reducer 复用它们时，
   * 必须抑制内部保存，由事务出口一次提交完整草稿。
   *
   * 这个标记**只在同步变更体内为真**，所以丢弃是安全的：那个窗口是同步的，
   * 期间任何改动都在内存里，会被事务出口的快照一并提交。
   * 而提交期间的其它保存（用户点了完成 / 稍后 / 新建）**绝不能吞掉** ——
   * 它们会各自排进闸门，在前一笔定成败之后按当时的状态取快照。
   * （此前的计数器跨越 await 持续为正，会把这类保存静默丢弃。）
   */
  let suppressInnerSave = false;

  function save() {
    if (suppressInnerSave) return;
    const pending = saveAsync();
    pending.catch(error => {
      toast("保存失败 · 修改仍保留在本机内存，下一次保存会重试");
      console.error("State save failed:", error && error.message ? error.message : error);
    });
    return pending;
  }

  /* ---------- 统一事务：提交在途期的「后续状态命令」日志 ---------- */

  /**
   * 原生动作在不可见草稿上执行；提交尚未定成败时，UI 继续显示最后确认状态。
   * 同一事项或同一周期的用户命令在这个窗口内明确拒绝，避免它在旧状态上显示成功、
   * 却因新状态的业务前置条件变化而在重放时失效。无关事项的状态命令仍按顺序记录：
   * 提交成功后重放到草稿再发布，提交失败则可见状态本来就只含这些无关命令。
   */
  let inflightActionDepth = 0; // > 0 表示有动作的提交尚未定成败
  let pendingUserOps = [];     // 窗口期内接受的状态命令（按发生顺序）
  let suppressUserFeedback = false; // 重放期间不再重复弹提示
  let replayCreatedIds = null; // 当前命令重放时可复用的稳定业务 id
  let activeActionScope = null; // 尚未定成败的原生动作事务域（事项或整个周期）
  let applyingActionDraft = false;

  function itemConflictsWithActiveAction(item) {
    if (!item || !activeActionScope) return false;
    if (item.id === activeActionScope.itemId) return true;
    if (activeActionScope.seriesId && item.seriesId === activeActionScope.seriesId) return true;
    return item.repeatParentId === activeActionScope.itemId;
  }

  function isItemActionPending(id) {
    const item = state.items.find(x => x.id === id);
    return itemConflictsWithActiveAction(item);
  }

  function rejectPendingItemCommand() {
    toast("这条事项正在保存 · 请稍后重试");
    return false;
  }

  function commandConflicts(args, options) {
    if (!activeActionScope || !options || !options.userFacing) return false;
    if (options.globalConflict) return true;
    const index = options.itemArg == null ? 0 : options.itemArg;
    const arg = args[index];
    const id = arg && typeof arg === "object" ? (arg.id || arg.__itemRef) : arg;
    const item = state.items.find(x => x.id === id);
    return itemConflictsWithActiveAction(item);
  }

  /**
   * 执行一次状态命令并（若原生草稿正在提交）记进日志。
   *
   * 不在窗口期时零额外开销：直接调用，不做任何扫描。
   * 记录时保存的 `fn` 是**原始函数**：重放不会再次经过这里，也就不会被重复记录。
   *
   * 记录自足化参数，以及这次命令新建实例的稳定 id / 父实例身份。
   */
  function runUserOp(fn, args, options) {
    if (!applyingActionDraft && commandConflicts(args, options)) return rejectPendingItemCommand();
    if (inflightActionDepth <= 0) return fn.apply(null, args);
    const beforeIds = new Set(state.items.map(x => x.id));
    // 参数在**调用之前**自足化：此刻「参数是否指向现有事项」的判断才准
    // （新建时传入的字段包还没进 state.items，必须按值快照存，不能记成引用）
    const recorded = args.map(recordArg);
    const result = fn.apply(null, args);
    // false 是业务拒绝（缺对象、终态保护、幂等无效果），不是已接受命令。
    if (result === false) return false;
    const createdItems = state.items.filter(x => !beforeIds.has(x.id));
    const created = createdItems.map(x => x.id);
    const createdRecords = createdItems.map(x => ({
      id: x.id,
      repeatParentId: x.repeatParentId || null
    }));
    pendingUserOps.push({
      fn: fn,
      name: (options && options.name) || fn.name || "command",
      args: recorded,
      created: created,
      createdRecords: createdRecords
    });
    return result;
  }

  function takeReplayCreatedId() {
    if (!replayCreatedIds || !replayCreatedIds.length) return null;
    return replayCreatedIds.shift();
  }

  /**
   * 日志里的参数必须是**自足的值**，不能留发布草稿后可能被替换掉的对象引用。
   *
   * 发布草稿时事项对象可能重建（id 不变，对象引用变化）。
   * 若日志里存的是当初那个对象的引用，后续编辑就会写到已经离开 `state.items` 的旧对象上，
   * 用户保存的内容静默丢失。
   *  · 指向**现有事项**的参数 → 记成 id 引用，重放时按 id 重新解析；
   *  · 其它对象参数 → 存一份值快照（深拷贝），不受后续改动影响。
   */
  function recordArg(a) {
    if (!a || typeof a !== "object") return a;
    if (state.items.indexOf(a) >= 0) return { __itemRef: a.id };
    try {
      return JSON.parse(JSON.stringify(a));
    } catch (error) {
      return a;
    }
  }

  function resolveArg(a) {
    if (a && typeof a === "object" && a.__itemRef) {
      return state.items.find(x => x.id === a.__itemRef) || null;
    }
    return a;
  }

  function wrapUserOp(fn, options) {
    return function () {
      return runUserOp(fn, Array.prototype.slice.call(arguments), options);
    };
  }

  /**
   * 按原顺序把窗口期命令施加到已提交草稿。
   * 参数按 id 重新解析；任何无法解析、执行抛错或未消费的创建 id 都是事务错误，必须上抛，
   * 不能吞掉后继续并伪装成成功。派生 id 在创建时直接注入，不再靠「按数组顺序事后改 id」。
   */
  function replayUserOps(ops) {
    if (!ops || !ops.length) return 0;
    const prevSave = suppressInnerSave;
    const prevFeedback = suppressUserFeedback;
    suppressInnerSave = true;
    suppressUserFeedback = true;
    try {
      ops.forEach(op => {
        const specs = op.args || [];
        const args = [];
        for (let i = 0; i < specs.length; i++) {
          const value = resolveArg(specs[i]);
          if (value === null && specs[i] && specs[i].__itemRef) {
            throw new Error("transaction-replay-missing-item:" + specs[i].__itemRef);
          }
          args.push(value);
        }
        replayCreatedIds = (op.created || []).slice();
        // 若动作草稿已经建立了同一父实例的周期投影，采用用户命令首次执行时的稳定 id。
        // 这是按明确 parent identity 合并，不按数组顺序或触发时间猜测。
        (op.createdRecords || []).forEach(record => {
          if (!record || !record.repeatParentId) return;
          const existing = state.items.find(x => x.repeatParentId === record.repeatParentId);
          if (!existing || existing.id === record.id || state.items.some(x => x.id === record.id)) return;
          existing.id = record.id;
          const index = replayCreatedIds.indexOf(record.id);
          if (index >= 0) replayCreatedIds.splice(index, 1);
        });
        const applied = op.fn.apply(null, args);
        if (applied === false) {
          throw new Error("transaction-replay-business-rejected:" + (op.name || op.fn.name || "command"));
        }
        if (replayCreatedIds.length) {
          throw new Error("transaction-replay-unused-created-id:" + replayCreatedIds[0]);
        }
        replayCreatedIds = null;
      });
    } finally {
      replayCreatedIds = null;
      suppressUserFeedback = prevFeedback;
      suppressInnerSave = prevSave;
    }
    return ops.length;
  }

  function applyParsedState(parsed) {
    schemaMigrationNeeded = parsed.schema !== SCHEMA || (Array.isArray(parsed.items) && parsed.items.some(it =>
      !it || !it.scheduleBasis || it.dismissedUntil === undefined || it.reminderEvents === undefined
    ));
    state.items = Array.isArray(parsed.items) ? parsed.items.map(normalizeItem) : [];
    state.notes = Array.isArray(parsed.notes) ? parsed.notes : [];
    state.projects = Array.isArray(parsed.projects) ? parsed.projects : [];
    state.settings = Object.assign(state.settings, parsed.settings || {});
    if (!state.settings.ai || typeof state.settings.ai !== "object") {
      state.settings.ai = {
        enabled: false,
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o-mini",
        autoOnSave: false
      };
    } else {
      state.settings.ai = Object.assign({
        enabled: false,
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o-mini",
        autoOnSave: false
      }, state.settings.ai);
    }
    ensureReviewSettings();
    state.items.forEach(it => {
      if (!it.review_status) it.review_status = "READY";
    });
    // N-03：冷启动基线。`committedAlarmItems` 此前**只在 `writeSnapshot` 里赋值**，
    // 于是「刚启动、还没提交过任何事务」时它恒为 `[]`；原生投递面板拿它当对照，
    // 找不到任何项 → 本该被自动忽略的旧投递会一直挂在面板上等用户手动处理。
    // 加载完成时，「最后一次已提交的快照」就等于刚读到的权威状态，这里补齐基线。
    // 用深拷贝与 `writeSnapshot` 口径一致：快照必须是独立副本，不被后续内存改动污染。
    committedAlarmItems = JSON.parse(JSON.stringify(state.items));
  }

  /**
   * H-07 / D47：IDB 恢复后把降级期的改动**重放**回权威后端。
   *
   * 返回 true = 已用待回放快照作为权威状态（调用方不要再拿可能更旧的 IDB 值覆盖）。
   *
   * **为什么「重放最后一份」就等于「按序重放」**：整个状态是一份**完整快照**、
   * 写入语义是 last-write-wins（既有契约），而降级期间本机唯一的写入方就是这条路径，
   * 所以中间态没有任何独立价值 —— 保留全部中间快照只会先撞爆 localStorage 配额。
   * 与 D39/D40 的「回滚 + 按序重放」不冲突：那里重放的是**用户命令**，这里重放的是**终态**。
   */
  async function replayPendingSnapshot() {
    const pending = readPendingReplay();
    if (!pending) return false;
    let payload = null;
    try {
      payload = JSON.parse(pending.json);
    } catch (error) {
      clearPendingReplay();
      return false;
    }
    if (!payload || typeof payload !== "object") {
      clearPendingReplay();
      return false;
    }
    applyParsedState(payload);
    try {
      await storage.save(payload);
      clearPendingReplay();
    } catch (error) {
      // 写回失败：内存已经是较新的状态，**保留**待回放快照留给下次启动再试 —— 绝不丢。
      console.error(
        "pending replay writeback failed (kept for next launch):",
        error && error.message ? error.message : error
      );
    }
    return true;
  }

  async function loadAsync() {
    if (storage) {
      try {
        const parsed = await storage.load();
        storageReady = true;
        // H-07：先把降级期攒下的改动重放回权威后端，并以它作为权威状态；
        // 否则「降级期间改过的东西」会被这里读到的旧值静默覆盖。
        //
        // 只有**真的换回了 IDB** 才重放：仍跑在镜像上时重放会白白清掉凭据，
        // 下一次 IDB 恢复就再也拿不回这段改动（这一条是本轮真机/探测器实测暴露的盲区）。
        if (storage.backend === "idb" && await replayPendingSnapshot()) return true;
        if (!parsed) return false;
        applyParsedState(parsed);
        return true;
      } catch (e) {
        storageReady = false;
      }
    }
    return loadSync();
  }

  function loadSync() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      applyParsedState(JSON.parse(raw));
      return true;
    } catch (e) {
      return false;
    }
  }

  function load() {
    return loadSync();
  }

  function normalizeItem(it) {
    const item = {
      id: it.id || uid(),
      title: it.title || "未命名",
      note: it.note || "",
      tags: Array.isArray(it.tags) ? it.tags : [],
      url: it.url || "",
      projectId: it.projectId || "",
      priority: it.priority || "normal",
      status: it.status || "waiting",
      triggerAt: it.triggerAt || null,
      windowStart: it.windowStart || null,
      windowEnd: it.windowEnd || null,
      deadlineAt: it.deadlineAt || null,
      repeat: it.repeat || null,
      createdAt: it.createdAt || Date.now(),
      acknowledgedAt: it.acknowledgedAt || null,
      completedAt: it.completedAt || null,
      snoozeCount: it.snoozeCount || 0,
      deliveredAt: it.deliveredAt || null,
      remindCount: it.remindCount || 0,
      lastRemindAt: it.lastRemindAt || null,
      lastAlertShownAt: it.lastAlertShownAt || null,
      scheduleBasis: it.scheduleBasis || null,
      localTrigger: it.localTrigger || null,
      snoozedAt: it.snoozedAt || null,
      snoozeDelayMs: it.snoozeDelayMs == null ? null : it.snoozeDelayMs,
      dismissedUntil: it.dismissedUntil || null,
      review_status: it.review_status || "READY",
      reviewed_at: it.reviewed_at || null,
      sourceTitle: it.sourceTitle || "",
      sourceApp: it.sourceApp || "",
      delivery_mode: it.delivery_mode || null,
      isFallbackTrigger: !!it.isFallbackTrigger,
      // L02：截止保护的阶段消费状态（key = 阶段 + 截止时间）
      deadlineStageKey: it.deadlineStageKey || null,
      // F1：按阶段记账的截止事件表 { "p24@<deadline>": { at, state } }
      // state: "scheduled" 已排期 / "delivered" 已送达（不再重排）
      deadlineEvents: it.deadlineEvents && typeof it.deadlineEvents === "object"
        ? it.deadlineEvents : {},
      // D43：按触发点记账的单次提醒台账 { "<attempt>@<原定触发点>": { at, state } }
      // state: "scheduled" 已排期 / "delivered" 已送达 / "cancelled" 排程被撤销
      // 与 deadlineEvents 同构；补投的准入全靠它，缺了就会每次对账重复补一条。
      reminderEvents: it.reminderEvents && typeof it.reminderEvents === "object"
        ? it.reminderEvents : {},
      // D23：归档重开暂停截止保护时置位，需用户显式恢复
      deadlinePaused: !!it.deadlinePaused,
      // L03：ACK 周期已推进过的标记，避免完成时再生成一条下期
      ackAdvancedAt: it.ackAdvancedAt || null,
      // L04：数据版本 —— 通知事件据此识别「已被改写的旧通知」
      rev: it.rev == null ? 1 : Number(it.rev),
      // F3：周期系列身份 —— 「停止重复」要能找到同系列的未来实例
      seriesId: it.seriesId || (it.repeat && it.repeat.every ? "s_" + uid() : null),
      // 稳定的周期依赖身份：同一父实例至多派生一个下一期，不能靠时刻或数组位置猜。
      repeatParentId: it.repeatParentId || null
    };
    if (!item.delivery_mode) {
      item.delivery_mode = (item.priority === "important" || item.priority === "critical")
        ? "alarm"
        : (state.settings.defaultDeliveryMode || "notification");
    }
    if (NativeReminders.migrateItem) NativeReminders.migrateItem(item);
    return item;
  }

  /** D25 赋值快照：有标记→alarm；未标记→当前全局默认 */
  function resolveDeliveryMode(priority) {
    if (priority === "important" || priority === "critical") return "alarm";
    return state.settings.defaultDeliveryMode === "alarm" ? "alarm" : "notification";
  }

  function makeItem(o) {
    if (o && o.delivery_mode == null && o.priority) {
      o = Object.assign({}, o, { delivery_mode: resolveDeliveryMode(o.priority) });
    }
    return normalizeItem(o);
  }

  function projectById(id) {
    return state.projects.find(p => p.id === id) || null;
  }

  /**
   * L04：任何会改变「时间 / 状态」的写入都推进版本号。
   * 通知事件携带投递时的版本，回来时对不上就说明它是「已经过期的旧通知」，
   * 不得再覆盖新状态、也不得再推进一次周期。
   */
  function bumpRev(it) {
    if (!it) return;
    it.rev = (Number(it.rev) || 0) + 1;
  }

  /**
   * 截止保护的阶段身份（L02 / INV-05）。
   * 规范实现在 lib/reminder.js；这里只做转发 + 兜底，避免两份规则各自漂移。
   */
  function deadlineStageKeyOf(deadlineAt, now) {
    if (Lib.deadlineStageKey) return Lib.deadlineStageKey(deadlineAt, now);
    const dl = Number(deadlineAt) || 0;
    if (!dl) return null;
    const left = dl - Number(now == null ? Date.now() : now);
    if (left > 24 * 3600000 || left <= -24 * 3600000) return null;
    return (left <= 2 * 3600000 ? "p2" : "p24") + "@" + dl;
  }

  /** 已完成 / 已归档是终态：只允许通过明确的恢复动作重开（L04） */
  function isTerminal(it) {
    return !!it && (it.status === "archived" || it.status === "completed");
  }

  /**
   * L04：事件里的数据版本是否「可知」。
   * 缺失 / 0 / 非数字都当作未知 —— 这时不做版本校验，
   * 避免整条原生链路丢版本后所有通知按钮集体失效（V02）。
   */
  function hasKnownRev(rev) {
    if (rev == null || rev === "") return false;
    const n = Number(rev);
    return Number.isFinite(n) && n > 0;
  }

  /**
   * L01 / R5 / D17：只有「系统兜底时间」的记录不发事项提醒。
   *  · 用户手选或解析出的真实时间照常生效（Review 只管内容质量）；
   *  · Review 关闭后一律按普通事项正常提醒（V0.2 §9.2）。
   */
  function isFallbackSuppressed(it) {
    return !!it && !!it.isFallbackTrigger && ensureReviewSettings().enabled;
  }

  /**
   * V06：首页「需要注意」的判定，与原生投影共用同一套兜底语义。
   *
   * 三处判断此前各不相同（前台一律抑制、首页只看 isDue、原生只看 NEEDS_REVIEW），
   * 于是出现「已过期的兜底记录出现在需要注意」而「确认后的兜底记录原生又排正式提醒」。
   * 兜底记录只有一种方式进入需要注意：**被截止保护拉起**（那时 status 才会变成 due）。
   */
  function isAttentionDue(it, now) {
    if (!it || isTerminal(it)) return false;
    if (isFallbackSuppressed(it)) return it.status === "due";
    return isDue(it, now) || it.status === "due";
  }

  /* ---------- Deferred Clarification / 延迟澄清 ---------- */
  function ensureReviewSettings() {
    if (!state.settings.review) {
      state.settings.review = {
        enabled: true,
        hour: 21,
        minute: 30,
        windowEndHour: 23,
        windowEndMinute: 0,
        // D22：60 分钟 × 2 次补提醒（当天最多 3 次）
        followupMs: 60 * 60 * 1000,
        maxFollowups: 2,
        lastNotifiedAt: 0,
        followupCount: 0,
        snoozedUntil: 0,
        skippedUntil: 0,
        sessionStatus: "idle",
        lastSessionKey: ""
      };
    } else {
      // 升级旧参数：45min×1 → 60min×2
      if (state.settings.review.followupMs == null || state.settings.review.followupMs === 45 * 60 * 1000) {
        state.settings.review.followupMs = 60 * 60 * 1000;
      }
      if (state.settings.review.maxFollowups == null || state.settings.review.maxFollowups === 1) {
        state.settings.review.maxFollowups = 2;
      }
      // 迁移：旧的 lastSessionKey 按分钟编码（无 "W:" / "S:" 前缀），会绕过 maxFollowups，直接作废
      const lsk = state.settings.review.lastSessionKey;
      if (lsk && lsk.indexOf("W:") !== 0 && lsk.indexOf("S:") !== 0) {
        state.settings.review.lastSessionKey = "";
        state.settings.review.followupCount = 0;
      }
    }
    return state.settings.review;
  }

  /** D17：兜底 = 下一个 Review Window；Review 关闭时退次日晚间 20:00 */
  function fallbackTriggerAt() {
    const rs = ensureReviewSettings();
    if (rs.enabled) return nextReviewWindowStart();
    const d = addDays(new Date(), 1);
    d.setHours(20, 0, 0, 0);
    return d.getTime();
  }

  function hasSpecificTimeWord(text) {
    if (Lib.hasSpecificTimeWord) return Lib.hasSpecificTimeWord(text);
    return /明天|后天|下周|下周|月底|今晚/.test(String(text || ""));
  }

  const VAGUE_RE = /^(这个|那个|它|something)?\s*(以后|后面|之后|过阵子|回头|有空|有时间)?\s*(看看|看一下|关注|处理|研究|了解)?\s*$/;

  function isVagueContent(title, note, url) {
    const t = String(title || "").trim();
    const n = String(note || "").trim();
    if (!t && !n && !url) return true;
    if (url && t.length < 3 && !n) return true;
    if (t.length <= 6 && VAGUE_RE.test(t)) return true;
    if (/^(这个|那个)?(以后|后面|过阵子|回头).{0,6}(看看|看一下)?$/.test(t)) return true;
    if (/^(看看这个|看一下|研究一下|了解一下)$/.test(t)) return true;
    return false;
  }

  function detectNeedsReview(opts) {
    const title = opts.title || "";
    const note = opts.note || "";
    const url = opts.url || "";
    const triggerAt = opts.triggerAt || null;
    const confidence = opts.confidence || "none";
    const userKeep = !!opts.userKeep;

    if (userKeep) return true;
    if (!triggerAt) return true;
    if (confidence === "low" || confidence === "none") return true;
    if (isVagueContent(title, note, url)) return true;
    if (url && !title && !note) return true;
    return false;
  }

  function needsReviewItems() {
    return state.items.filter(it =>
      it &&
      it.review_status === "NEEDS_REVIEW" &&
      it.status !== "archived" &&
      it.status !== "completed"
    );
  }

  /**
   * 整理会话的「本次」标识。**必须按窗口取，不能按分钟取**。
   *
   * 按分钟取会让 key 每分钟都变，配合 maybeReviewSession 里
   * `lastSessionKey !== key → followupCount = 0` 的重置逻辑，
   * followupCount 永远回不到上限 → maxFollowups 失效 → 窗口内每分钟发一条（D22 被绕过）。
   */
  function reviewSessionKey(d, rs) {
    const st = rs || ensureReviewSettings();
    const start = new Date(d);
    start.setHours(st.hour != null ? st.hour : 21, st.minute != null ? st.minute : 30, 0, 0);
    // now 早于今天的窗口起点 → 归属上一个已开始的窗口
    if (start.getTime() > d.getTime()) start.setDate(start.getDate() - 1);
    return "W:" + start.getFullYear() + "-" + (start.getMonth() + 1) + "-" + start.getDate() +
      "T" + pad(start.getHours()) + ":" + pad(start.getMinutes());
  }

  function nextReviewWindowStart(from) {
    const rs = ensureReviewSettings();
    const base = from || new Date();
    const start = new Date(base);
    start.setHours(rs.hour || 21, rs.minute || 30, 0, 0);
    if (start.getTime() <= base.getTime()) start.setDate(start.getDate() + 1);
    return start.getTime();
  }

  function inReviewWindow(now) {
    const rs = ensureReviewSettings();
    if (!rs.enabled) return false;
    const d = new Date(now || Date.now());
    const cur = d.getHours() * 60 + d.getMinutes();
    const start = (rs.hour || 21) * 60 + (rs.minute || 30);
    const end = (rs.windowEndHour != null ? rs.windowEndHour : 23) * 60 +
      (rs.windowEndMinute != null ? rs.windowEndMinute : 0);
    if (start === end) return cur === start;
    if (start < end) return cur >= start && cur < end;
    return cur >= start || cur < end;
  }

  async function fireReviewNotification(count) {
    if (!state.settings.notify) return;
    const title = "待整理";
    const body = "有 " + count + " 条随手记录待整理 · 预计只需几分钟";
    // D19：走 LocalNotifications / Web 通知，不再用全屏闹钟
    const bridge = systemBridge();
    if (NativeReminders.isNativeAndroid && NativeReminders.isNativeAndroid()) {
      // 原生侧由 reconcile/buildReviewDesired 排程；此处仅在应用内 toast
      return;
    }
    if (bridge && bridge.showNotification) {
      try {
        await bridge.showNotification({ title, body, id: 91001 });
        return;
      } catch (e) {}
    }
    showSystemNotification({
      title,
      body,
      tag: "review-session",
      requireInteraction: true,
      data: { itemId: "review-session" }
    });
  }

  function maybeReviewSession(now) {
    now = now || Date.now();
    const rs = ensureReviewSettings();
    if (!rs.enabled) return;
    const queue = needsReviewItems();
    if (!queue.length) {
      rs.sessionStatus = "idle";
      return;
    }
    if (rs.snoozedUntil && now < rs.snoozedUntil) return;
    if (rs.skippedUntil && now < rs.skippedUntil) return;
    // D20：宽限期（snoozedUntil 后 1 小时）一过即失效。
    // 否则 snoozeDue 永远为真，会一直顶掉后续窗口的提醒额度。
    if (rs.snoozedUntil && now >= rs.snoozedUntil + 3600000) rs.snoozedUntil = 0;
    if (!inReviewWindow(now) && !(rs.snoozedUntil && now >= rs.snoozedUntil)) {
      // allow snoozed follow-up outside window briefly handled above
      if (!rs.snoozedUntil) return;
    }

    const windowOpen = inReviewWindow(now);
    const snoozeDue = rs.snoozedUntil && now >= rs.snoozedUntil;
    if (!windowOpen && !snoozeDue) return;

    // 一次「稍后」拥有独立额度（用户主动要求到点再提一次）；
    // 窗口内其余提醒共享同一个窗口额度，由 maxFollowups + followupMs 共同约束。
    // 注：稍后额度的后续补充会撞上 1 小时宽限期上界，因此一次「稍后」实际只提一次。
    const key = snoozeDue ? "S:" + Number(rs.snoozedUntil) : reviewSessionKey(new Date(now), rs);

    const maxFollowups = rs.maxFollowups != null ? rs.maxFollowups : 2;
    if (rs.lastSessionKey === key && rs.followupCount >= maxFollowups) {
      // already fully notified for this window
      return;
    }

    let shouldNotify = false;
    if (rs.lastSessionKey !== key) {
      rs.lastSessionKey = key;
      rs.followupCount = 0;
      rs.sessionStatus = "due";
      shouldNotify = true;
    } else if (rs.followupCount < maxFollowups &&
      now - (rs.lastNotifiedAt || 0) >= (rs.followupMs || 60 * 60 * 1000)) {
      shouldNotify = true;
    }

    if (shouldNotify) {
      rs.followupCount += 1;
      rs.lastNotifiedAt = now;
      rs.sessionStatus = "delivered";
      save();
      fireReviewNotification(queue.length);
      toast("有 " + queue.length + " 条随手记录待整理", "开始整理", () => openReviewSession());
    }
  }

  function openReviewSession() {
    const queue = needsReviewItems().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (!queue.length) {
      toast("没有待整理事项");
      return;
    }
    state.ui.reviewQueue = queue.map(it => it.id);
    state.ui.reviewIndex = 0;
    ensureReviewSettings().sessionStatus = "started";
    save();
    openSheet("sheetReview");
    renderReviewCard();
  }

  function currentReviewItem() {
    const id = state.ui.reviewQueue[state.ui.reviewIndex];
    return state.items.find(x => x.id === id) || null;
  }

  function renderReviewCard() {
    const total = state.ui.reviewQueue.length;
    const idx = state.ui.reviewIndex;
    const progress = $("#reviewProgress");
    const body = $("#reviewBody");
    // 每张卡片是独立的一次「采用/不采用时间」判断，不能继承上一条的选择
    reviewTriggerUserPicked = false;
    if (!body) return;
    if (idx >= total) {
      if (progress) progress.textContent = "全部处理完成";
      body.innerHTML = '<div class="empty"><div class="empty-mark">✓</div><h3>整理完成</h3><p>已确认的记录已进入正常提醒流程。</p></div>';
      const foot = $("#reviewFoot");
      if (foot) foot.innerHTML = '<button class="btn primary" data-close="sheetReview">完成</button>';
      return;
    }
    const it = currentReviewItem();
    if (!it) {
      state.ui.reviewIndex += 1;
      renderReviewCard();
      return;
    }
    if (progress) progress.textContent = (idx + 1) + " / " + total;
    // D16：显式展示系统解析结果；无时间时必须写「未设定时间」
    // L05：兜底值本身不是「已定时间」，说清楚确认后会顺延到下一个整理窗口
    const parsedHint = it.isFallbackTrigger
      ? "未设定时间 · 确认后顺延到下一个整理窗口（" + fmtTime(fallbackTriggerAt()) + "）"
      : (!it.triggerAt
        ? "未设定时间"
        : fmtTime(it.triggerAt) + (it.deadlineAt ? " · 截止 " + fmtDate(it.deadlineAt) : ""));
    const sourceBits = [];
    if (it.sourceTitle) sourceBits.push(escapeHtml(it.sourceTitle));
    if (it.url) sourceBits.push(escapeHtml(it.url));
    if (it.sourceApp) sourceBits.push(escapeHtml(it.sourceApp));
    sourceBits.push("记录于 " + fmtTime(it.createdAt));

    body.innerHTML =
      '<div class="detail-title">' + escapeHtml(it.title || "未命名") + "</div>" +
      (it.note ? '<p style="color:var(--muted);font-size:0.9rem;margin-bottom:10px;white-space:pre-wrap">' + escapeHtml(it.note) + "</p>" : "") +
      '<dl class="detail-rows">' +
      '<div class="detail-row"><dt>原始记录</dt><dd>' + escapeHtml(it.title || "") + "</dd></div>" +
      '<div class="detail-row"><dt>系统解析</dt><dd>' + escapeHtml(parsedHint) + "</dd></div>" +
      (sourceBits.length ? '<div class="detail-row"><dt>来源</dt><dd>' + sourceBits.join("<br>") + "</dd></div>" : "") +
      "</dl>" +
      '<div class="field"><label for="reviewTitle">标题</label><input id="reviewTitle" type="text" value="' + escapeHtml(it.title || "") + '" /></div>' +
      // L05：兜底记录不再把兜底值预填进输入框 —— 预填会让「确认」看起来像采用了那个时间
      '<div class="field"><label for="reviewTrigger">提醒时间</label><input id="reviewTrigger" type="datetime-local" value="' +
      (it.isFallbackTrigger ? "" : toLocalInput(it.triggerAt)) + '"' +
      (it.isFallbackTrigger ? ' placeholder="未设定 · 不选则顺延到下一个整理窗口"' : "") + " /></div>" +
      '<div class="field"><label for="reviewNote">备注（可选）</label><input id="reviewNote" type="text" value="' + escapeHtml(it.note || "") + '" placeholder="例如：主要想看它的调度机制" /></div>';

    // L05：只有用户真的手动改过提醒时间，才算「明确采用这个时间」
    const trigInput = $("#reviewTrigger");
    if (trigInput && trigInput.addEventListener) {
      trigInput.addEventListener("change", () => { reviewTriggerUserPicked = true; });
    }

    // P0-3：「稍后 / 跳过本次」必须随每次渲染重建 —— 整块替换 innerHTML 会把静态节点连监听器一起丢掉
    const foot = $("#reviewFoot");
    if (foot) {
      foot.innerHTML =
        '<button class="btn secondary" id="reviewSnooze">稍后</button>' +
        '<button class="btn secondary" id="reviewSkip">跳过本次</button>' +
        '<button class="btn secondary" id="reviewKeep">留着待整理</button>' +
        '<button class="btn secondary" id="reviewDelete">删除</button>' +
        '<button class="btn secondary" id="reviewConfirm">确认</button>' +
        '<button class="btn primary" id="reviewSave">保存修改</button>';
      $("#reviewSnooze").onclick = () => openSheet("sheetReviewSnooze");
      $("#reviewSkip").onclick = skipReviewThisTime;
      // L05：逐条保留并前进 —— 「稍后 / 跳过本次」管的是整场会话，不是单条
      $("#reviewKeep").onclick = reviewKeepCurrent;
      $("#reviewDelete").onclick = reviewDelete;
      $("#reviewConfirm").onclick = reviewConfirm;
      $("#reviewSave").onclick = reviewSaveEdit;
    }
  }

  /**
   * L05：确认 ≠ 采用系统兜底时间。三种来源分开处理 ——
   *  · 用户在卡片里明确改过时间 → 采用，并解除兜底标记；
   *  · 记录本来就有真实时间 → 保留；
   *  · 只有兜底值（或时间已过期）→ 顺延到下一个整理窗口，**不生成立即到期提醒**。
   */
  function resolveReviewTrigger(it) {
    const input = $("#reviewTrigger");
    const typed = input ? parseLocalInput(input.value) : null;
    if (reviewTriggerUserPicked && typed) return { triggerAt: typed, keepFallback: false };
    if (it.isFallbackTrigger) return { triggerAt: fallbackTriggerAt(), keepFallback: true };
    if (it.triggerAt) return { triggerAt: it.triggerAt, keepFallback: false };
    return { triggerAt: fallbackTriggerAt(), keepFallback: true };
  }

  function markReviewDone(item, extra) {
    if (!item) return false;
    item.review_status = "REVIEWED";
    item.reviewed_at = Date.now();
    if (extra && extra.triggerAt != null) {
      item.triggerAt = extra.triggerAt;
      item.scheduleBasis = "wall-clock";
      item.localTrigger = toLocalInput(extra.triggerAt);
      if (item.triggerAt > Date.now() && (item.status === "due" || item.status === "acknowledged")) {
        item.status = "waiting";
      }
    }
    // 只有「用户明确采用了一个时间」才解除兜底标记（L01）
    if (!(extra && extra.keepFallback)) item.isFallbackTrigger = false;
    if (extra && extra.title != null) item.title = extra.title;
    if (extra && extra.note != null) item.note = extra.note;
    bumpRev(item);
    return true;
  }

  function reviewConfirm() {
    const it = currentReviewItem();
    if (!it) return;
    const resolved = resolveReviewTrigger(it);
    if (markReviewDone(it, { triggerAt: resolved.triggerAt, keepFallback: resolved.keepFallback }) === false) return;
    save();
    state.ui.reviewIndex += 1;
    queueNativeReminderSync();
    renderReviewCard();
    render();
  }

  function reviewSaveEdit() {
    const it = currentReviewItem();
    if (!it) return;
    const title = ($("#reviewTitle") && $("#reviewTitle").value.trim()) || it.title;
    const resolved = resolveReviewTrigger(it);
    const note = $("#reviewNote") ? $("#reviewNote").value.trim() : it.note;
    if (markReviewDone(it, {
      title,
      triggerAt: resolved.triggerAt,
      keepFallback: resolved.keepFallback,
      note
    }) === false) return;
    save();
    state.ui.reviewIndex += 1;
    queueNativeReminderSync();
    renderReviewCard();
    render();
  }

  /**
   * L05 / V0.2 §9.4「中途退出：逐条即时持久化，下次只继续剩余项」。
   * 「稍后 / 跳过本次」管的是整场会话，不能拿来处理「这一条我还想不清」——
   * 于是需要一个逐条的「留着待整理」出口：本条留在队列里，先处理下一条。
   */
  function reviewKeepCurrent() {
    const it = currentReviewItem();
    if (!it) return;
    state.ui.reviewIndex += 1;
    renderReviewCard();
    toast("已保留这条 · 下次整理再处理");
  }

  function reviewDelete() {
    const it = currentReviewItem();
    if (!it) return;
    if (deleteItem(it.id) === false) return;
    state.ui.reviewIndex += 1;
    renderReviewCard();
  }

  function snoozeReview(ms, label) {
    const rs = ensureReviewSettings();
    rs.snoozedUntil = Date.now() + ms;
    rs.sessionStatus = "snoozed";
    save();
    closeSheet("sheetReview");
    toast("待整理稍后提醒 · " + label);
    // D19：普通通知，不走全屏闹钟
    fireReviewNotification(needsReviewItems().length);
    queueNativeReminderSync();
  }

  function skipReviewThisTime() {
    const rs = ensureReviewSettings();
    rs.skippedUntil = nextReviewWindowStart();
    rs.sessionStatus = "skipped";
    save();
    closeSheet("sheetReview");
    toast("已跳过本次 · 下个整理时间再见");
  }

  /** D6/D20：窗口 ∪ 宽限期内显著，平时弱形态；无待整理时不渲染 */
  function inReviewHighlight(now) {
    now = now || Date.now();
    const rs = ensureReviewSettings();
    if (inReviewWindow(now)) return true;
    if (rs.snoozedUntil && now >= rs.snoozedUntil && now < rs.snoozedUntil + 3600000) return true;
    return false;
  }

  /**
   * A-2 / D68（2026-09-19）：后台提醒链路断了，**首页**必须直说。
   *
   * 依据（基线既有条款，非新增需求）：
   *   · §473「通知权限关闭 → 首页明确告知『无法保证提醒』；恢复权限后自动 Reconcile」
   *   · AC-14「不得继续伪装正常」
   *   · §305「关键能力不得偷偷降级而不告知」
   *
   * 此前这条只落在「我的」页（renderPwaStatus）与自检面板（renderBackgroundVerdict），
   * 而用户天天看的是**首页** —— 于是「关掉 App 就不响」在首页一个字都看不出来，
   * 界面照常平静。这正是 H-08 能长期存活的原因：缺陷是静默的，界面在撒谎。
   *
   * 纯函数：只吃 (status, settings, native)，输出 null 或一条文案，便于行为级断言。
   *
   * 红线：**只在能确证断链时出声**。`notifications === "unknown"` 是「还没问过」，
   * 不是「没有」；冷启动时桥晚到几秒，此时弹警告就是拿新误报换旧误报。
   * 故一切「未定」状态一律返回 null。
   *
   * 范围边界（刻意）：`exactAlarm === "denied"` 不进首页 —— 它只让**到达时刻**可能被推迟，
   * 不产生「关掉 App 就没有提醒」这类硬断链，且已在「我的」页如实标注「时间可能延迟」。
   * 首页只在「你会有提醒」这个承诺被打破时开口。
   */
  function homeNoticeVerdict(status, settings, native) {
    if (!native) return null;
    const s = status || {};
    // ① 用户自己关了总开关 —— 与「系统权限没给」是两件事，必须分开说（Q6 既有结论）。
    //    放最前：此时把他引去授权，他授完权仍然不响（开关还是关的），是反复授权却始终不响的老路。
    if (!(settings && settings.notify)) {
      return {
        kind: "switch",
        title: "后台提醒已关闭",
        text: "关掉 App 后不会有任何提醒。到「我的 → 本地通知」把它打开。"
      };
    }
    // ② 系统通知权限没给 —— H-08 的根因落点，也是唯一「用户能自己修好」的断链
    //
    // 文案纪律（D59 的直接教训）：**不得把「响了但没亮屏」反着报成「完全静默」**。
    // D59 之后声音与振动归 AlarmRingService（mediaPlayback 前台服务，不需要通知权限），
    // 所以「闹钟不响」是错的；真正丢的是**通知**与**屏幕**（setFullScreenIntent 是
    // Notification 的属性，通知发不出去系统就不会替我们全屏）。
    // 也刻意不说成「只剩铃声」——深冻结态的 ROM 连服务都起不来，那时什么都没有。
    if (s.notifications === "denied") {
      return {
        kind: "permission",
        title: "无法保证提醒",
        text: "系统通知权限未授予：关掉 App 后不会有通知，屏幕也不会亮 —— 可能只剩铃声与振动。点这里去授权。"
      };
    }
    // ③ 原生桥始终没就绪（等满 10s 仍不可用）—— 整条原生链路静默消失
    if (s.notifications === "unavailable" || s.bridgeNotReady) {
      return {
        kind: "bridge",
        title: "无法保证提醒",
        text: "提醒能力未就绪：请完全退出后重开应用，再做一次提醒自检。"
      };
    }
    // ④ 对账失败 —— 排程没落进系统
    if (s.reliability === "error") {
      return {
        kind: "error",
        title: "无法保证提醒",
        text: "提醒同步失败，排程可能没落进系统。请打开提醒自检重新排程。"
      };
    }
    return null;
  }

  /**
   * A-2：把 verdict 渲染到首页顶部。断链消失时**主动清空** ——
   * 否则权限恢复后这句警告会一直挂着，变成新的「界面在撒谎」。
   */
  function renderHomeNotice() {
    const host = $("#homeNotice");
    if (!host) return;
    const v = homeNoticeVerdict(nativeReminderStatus, state.settings, isNativeAndroidRuntime());
    if (!v) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML =
      '<button class="soft-entry notice-entry" id="homeNoticeBtn" data-notice-kind="' + v.kind + '">' +
      '<span><span class="notice-title">' + escapeHtml(v.title) + "</span><br>" +
      '<span style="font-size:0.78rem;color:var(--muted)">' + escapeHtml(v.text) + "</span></span>" +
      '<span style="color:var(--muted)">›</span></button>';
    const btn = $("#homeNoticeBtn");
    if (btn) {
      btn.addEventListener("click", () => {
        // 总开关的修法在「我的」页；权限/桥/对账的修法在自检面板（那里有「1. 申请通知权限」）
        if (v.kind === "switch") {
          state.ui.tab = "me";
          render();
          return;
        }
        openSheet("sheetNotifyLab");
        refreshNotifyLab();
      });
    }
  }

  function renderReviewEntry() {
    const host = $("#homeReview");
    if (!host) return;
    const n = needsReviewItems().length;
    if (!n) {
      host.innerHTML = "";
      return;
    }
    const strong = inReviewHighlight();
    if (strong) {
      // 显著：提到最前，带数字
      host.innerHTML = '<button class="soft-entry strong-entry" id="openReview" style="margin-bottom:10px;border-color:var(--attention);background:var(--attention-bg)">' +
        '<span><strong style="color:#7a540e">待整理 · ' + n + "</strong><br><span style=\"font-size:0.78rem;color:#8a6a17\">信息尚未二次确认，不是逾期任务</span></span>" +
        "<span>整理 ›</span></button>";
    } else {
      // 弱形态：无数字、无强调色
      host.innerHTML = '<button class="soft-entry" id="openReview" style="margin-bottom:10px;opacity:.75">' +
        '<span><strong style="font-weight:500;color:var(--muted)">待整理</strong><br>' +
        '<span style="font-size:0.78rem;color:var(--muted)">信息尚未二次确认，不是逾期任务</span></span>' +
        "<span style=\"color:var(--muted)\">›</span></button>";
    }
    const btn = $("#openReview");
    if (btn) btn.addEventListener("click", () => openReviewSession());
  }

  function scheduleNextReviewAlarm() {
    const rs = ensureReviewSettings();
    if (!rs.enabled) return;
    const count = needsReviewItems().length;
    if (!count) return;
    if (!state.settings.notify) return;
    // D19：原生侧由 reconcile 预排 LocalNotifications；Web 侧依赖 tick
    queueNativeReminderSync();
  }

  /* ---------- lifecycle ---------- */
  function isDue(item, now) {
    now = now || Date.now();
    if (item.status === "completed" || item.status === "archived" || item.status === "acknowledged") return false;
    if (item.status === "due") return true;
    if (!item.triggerAt) return false;
    return item.triggerAt <= now;
  }

  function parseHHMM(s, fallbackH, fallbackM) {
    const m = String(s || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return { h: fallbackH, m: fallbackM };
    return { h: parseInt(m[1], 10), m: parseInt(m[2], 10) };
  }

  function inQuietHours(d) {
    if (Lib.inQuietHours) return Lib.inQuietHours(d, state.settings);
    if (!state.settings.dnd) return false;
    const start = parseHHMM(state.settings.quietStart, 23, 0);
    const end = parseHHMM(state.settings.quietEnd, 7, 30);
    const mins = d.getHours() * 60 + d.getMinutes();
    const s = start.h * 60 + start.m;
    const e = end.h * 60 + end.m;
    if (s === e) return false;
    if (s < e) return mins >= s && mins < e;
    return mins >= s || mins < e;
  }

  function quietEnd(d) {
    if (Lib.quietEnd) return Lib.quietEnd(d, state.settings);
    const end = parseHHMM(state.settings.quietEnd, 7, 30);
    const x = new Date(d);
    const mins = d.getHours() * 60 + d.getMinutes();
    const s = parseHHMM(state.settings.quietStart, 23, 0);
    const startM = s.h * 60 + s.m;
    const endM = end.h * 60 + end.m;
    const wrapped = startM >= endM;
    if (wrapped && mins >= startM) x.setDate(x.getDate() + 1);
    x.setHours(end.h, end.m, 0, 0);
    return x.getTime();
  }

  function promoteDue(now) {
    // 隔离草稿尚未提交时，可见 state 仍是最后确认状态；自动推进下一拍即可重算。
    if (inflightActionDepth > 0) return false;
    now = now || Date.now();
    let changed = false;
    state.items.forEach(it => {
      // D17：Review 开启时，只有「系统兜底时间」的记录不因其兜底时间进 due；
      // 有真实时间的待整理记录照常提醒，Review 关闭时兜底记录也退为普通事项。
      // V06：抑制只作用于**普通提醒**，绝不能连截止保护一起跳过（INV-05）。
      const fallbackSuppressed = isFallbackSuppressed(it);
      if (!fallbackSuppressed && (it.status === "waiting" || it.status === "snoozed")) {
        // 柔性窗口：仅对 waiting 生效，避免覆盖用户 snooze
        if (it.status === "waiting" && Lib.applyWindowTrigger && (it.windowStart || it.windowEnd)) {
          const winTs = Lib.applyWindowTrigger(it, now);
          if (winTs && winTs !== it.triggerAt) { it.triggerAt = winTs; changed = true; }
        }
        if (it.triggerAt && it.triggerAt <= now) {
          if (it.priority === "normal" && inQuietHours(new Date(now))) {
            const end = quietEnd(new Date(now));
            if (it.triggerAt < end) { it.triggerAt = end; changed = true; }
            return;
          }
          it.status = "due";
          it.deliveredAt = now;
          it.remindCount = Math.max(1, it.remindCount || 0);
          it.lastRemindAt = now;
          it.lastAlertShownAt = null;
          changed = true;
        }
      }
      // L02 / INV-05：截止保护**分阶段**，每个阶段有稳定身份与消费状态。
      // ACK 结束当前阶段的事件，只有到下一个保护点才会再次唤醒 ——
      // 否则「临近截止时点我知道了」会在下一次 render 里立刻变回 due，确认按钮形同虚设。
      if (it.deadlineAt && !it.deadlinePaused && !isTerminal(it)) {
        const stageKey = deadlineStageKeyOf(it.deadlineAt, now);
        if (stageKey && it.deadlineStageKey !== stageKey) {
          it.deadlineStageKey = stageKey;
          it.status = "due";
          it.deliveredAt = now;
          it.remindCount = 0;
          it.lastRemindAt = now;
          it.lastAlertShownAt = null;
          it.dismissedUntil = null;
          bumpRev(it);
          changed = true;
        }
      }
    });
    if (changed) save();
  }

  /* L03：与 lib/repeat.js 保持同一实现（本文件内的副本仅作 Lib 缺失时的兜底） */
  function nextRepeatTrigger(it, fromTs) {
    const rep = (it && it.repeat) || {};
    const every = rep.every;
    if (!every) return null;
    const ackBased = rep.mode === "ack";
    const from = fromTs != null
      ? Number(fromTs)
      : (ackBased
        ? (it.acknowledgedAt || Date.now())
        : (it.triggerAt || it.acknowledgedAt || Date.now()));
    if (!Number.isFinite(from)) return null;
    if (every === "day") return applyClock(addDays(new Date(from), 1), it.triggerAt);
    if (every === "week") return applyClock(addDays(new Date(from), 7), it.triggerAt);
    if (every === "biweek") return applyClock(addDays(new Date(from), 14), it.triggerAt);
    if (every === "month") {
      const base = new Date(from);
      const m = base.getMonth() + 1;
      const ny = base.getFullYear() + Math.floor(m / 12);
      const nm = ((m % 12) + 12) % 12;
      const day = Math.min(base.getDate(), new Date(ny, nm + 1, 0).getDate());
      return applyClock(new Date(ny, nm, day), it.triggerAt);
    }
    if (every === "monthEnd") {
      // V04：按「日」比较（与 lib/repeat.js 同一实现）
      const base = new Date(from);
      const baseDay = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime();
      let d = lastDayOfMonth(base);
      if (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() <= baseDay) {
        d = lastDayOfMonth(new Date(base.getFullYear(), base.getMonth() + 1, 1));
      }
      return applyClock(d, it.triggerAt);
    }
    if (every === "nthWeekday") {
      const s = new Date(it.triggerAt || from);
      return nthWeekdayOfNextMonth(
        from,
        rep.nth || 1,
        rep.dow != null ? rep.dow : 1,
        s.getHours(),
        s.getMinutes()
      );
    }
    return null;
  }

  /**
   * F3：保证周期事项有稳定的系列身份。
   * 「停止重复」必须能找到 ACK 生成的未来实例 —— 否则它会带着 repeat 继续提醒、
   * 继续派生周期，界面却提示「周期已终止并归档」。
   */
  function ensureSeriesId(it) {
    if (!it) return null;
    if (!it.repeat || !it.repeat.every) return it.seriesId || null;
    if (!it.seriesId) it.seriesId = "s_" + uid();
    return it.seriesId;
  }

  function seriesMembers(seriesId, exceptId, sourceItem) {
    if (seriesId) {
      return state.items.filter(x =>
        x && x.id !== exceptId && x.seriesId === seriesId && !isTerminal(x));
    }
    if (sourceItem && sourceItem.repeat && sourceItem.repeat.every) {
      return state.items.filter(x =>
        x && x.id !== exceptId && !isTerminal(x) &&
        x.title === sourceItem.title &&
        x.projectId === sourceItem.projectId &&
        x.repeat && x.repeat.every === sourceItem.repeat.every);
    }
    return [];
  }

  /**
   * G4：该实例是否「尚未开始」—— 规则派生出来、用户还**从未接触过**。
   *
   * 停止重复时要区分两类同系列事项：
   *  · 未开始的未来实例：只是规则的投影，随规则一起归档（不写 completedAt）；
   *  · 已经交付/确认过的历史实例：用户真的处理过，必须原样保留业务状态。
   * 判据用生命周期证据（确认时间 / 送达时间 / 稍后时间）而不是时钟 ——
   * 「时刻已过」不代表用户已经看过（红线：通知送达 ≠ 用户看到）。
   */
  function isUnstartedInstance(it) {
    if (!it || isTerminal(it)) return false;
    if (it.acknowledgedAt || it.deliveredAt || it.snoozedAt) return false;
    return it.status === "waiting";
  }

  /**
   * L03：生成周期的下一条实例 —— 「完成本次实例」，原记录不被改写。
   * 返回新事项，未生成时返回 null。
   */
  function spawnNextInstance(it, fromTs) {
    const nextTrigger = nextRepeatTrigger(it, fromTs);
    if (!nextTrigger) return null;
    const preferredId = takeReplayCreatedId();
    const existing = state.items.find(x => x.repeatParentId === it.id);
    if (existing) {
      if (preferredId && existing.id !== preferredId && !state.items.some(x => x.id === preferredId)) {
        existing.id = preferredId;
      }
      return existing;
    }
    const next = makeItem({
      id: preferredId || uid(),
      title: it.title,
      note: it.note,
      tags: it.tags.slice(),
      url: it.url,
      projectId: it.projectId,
      priority: it.priority,
      status: "waiting",
      repeat: it.repeat,
      seriesId: ensureSeriesId(it),
      repeatParentId: it.id,
      triggerAt: nextTrigger,
      scheduleBasis: "wall-clock",
      localTrigger: toLocalInput(nextTrigger),
      deadlineAt: null,
      // 下一周期继承投递方式快照（有标记仍为 alarm）
      delivery_mode: resolveDeliveryMode(it.priority)
    });
    state.items.push(next);
    return next;
  }

  /**
   * 我知道了 —— 只表示「看到了」，不等于完成（红线：Acknowledged ≠ Completed）。
   *
   * L03：周期分两种语义，必须分开兑现承诺
   *  · `mode: "ack"`   「ACK 后计时」→ 由**确认**推进到下一周期
   *  · `mode: "calendar"`「日历规则」→ 由**完成**推进，ACK 不改变原定日期
   * V04：ACK 推进必须**新建实例**。就地把 triggerAt 改到下一期会把「本次实例」与
   *      「下一期」混成同一条记录 —— 随后完成本次实例时，下一期会被一起归档（活跃实例归零）。
   * L04：终态保护 —— 已完成 / 已归档的事项不接受旧通知的 ACK。
   */
  function ackItem(id, silent) {
    const it = state.items.find(x => x.id === id);
    if (!it) return false;
    if (isTerminal(it)) return false;
    const now = Date.now();
    it.status = "acknowledged";
    it.acknowledgedAt = now;
    it.lastRemindAt = null;
    it.dismissedUntil = null;
    if (it.repeat && it.repeat.every && it.repeat.mode === "ack") {
      if (spawnNextInstance(it, now)) it.ackAdvancedAt = now;
    }
    bumpRev(it);
    save();
    if (!silent) toast("已确认看到 · 仍保持未完成");
    render();
    return true;
  }

  // Prefer lib implementations when loaded (single source of truth)
  if (Lib.parseChineseTime) parseChineseTime = Lib.parseChineseTime;
  if (Lib.nextRepeatTrigger) nextRepeatTrigger = Lib.nextRepeatTrigger;
  if (Lib.repeatLabel) repeatLabel = Lib.repeatLabel;
  if (Lib.nextRepeatPreview) nextRepeatPreview = Lib.nextRepeatPreview;

  /**
   * 完成 —— 归档当前实例。
   *
   * L03：`calendar` 周期从这里推进，且锚定**原定日期**而不是完成时刻
   *      （否则「每月 1 日」会因为晚几天完成而漂成每月 5 日）。
   *      `ack` 周期已经由 ACK 推进过，不再重复生成下期。
   * L04：终态保护 —— 同一条完成事件重复投递时只能推进一次周期。
   */
  /**
   * 归档一条事项时，周期是否需要顺延到下一期。
   *
   * `calendar` 由**完成**推进；`ack` 由**确认**推进 —— 已经由 ACK 推进过（`ackAdvancedAt`）
   * 就不再重复推进（V04：否则活跃实例归零）。
   *
   * K1：这条规则有两个调用方 —— 用户点「完成」，以及原生草稿提交成功后重放该命令。
   * 必须共用一处实现，否则两边的判断会各自漂移。
   */
  function advanceSeriesOnArchive(it) {
    if (!it || !it.repeat || !it.repeat.every) return null;
    const ackBased = it.repeat.mode === "ack";
    if (ackBased && it.ackAdvancedAt) return null;
    return spawnNextInstance(it, ackBased ? (it.acknowledgedAt || Date.now()) : null);
  }

  function completeItem(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return false;
    if (isTerminal(it)) return false;
    it.status = "archived";
    it.completedAt = Date.now();
    it.dismissedUntil = null;
    advanceSeriesOnArchive(it);
    bumpRev(it);
    save();
    toast(it.repeat ? "已完成 · 下一周期已生成" : "已完成并归档");
    render();
    return true;
  }

  /**
   * 稍后 —— 进入新一轮。
   *
   * L04：终态保护；已完成的事项不接受旧通知的「稍后」。
   * L08：稍后开启新一轮时重置追提醒预算与轮次状态，让前台与应用后台使用同一份轮次。
   *      否则旧计数会跟着新时间走，用户点完稍后反而更早静音
   *      （原生投影从 attempt=0 重排，前台却按旧上限判断）。
   */
  function snoozeItem(id, when, basis) {
    const it = state.items.find(x => x.id === id);
    if (!it) return false;
    if (isTerminal(it)) return false;
    const snoozedAt = Date.now();
    it.status = "snoozed";
    it.triggerAt = when;
    it.scheduleBasis = basis === "wall-clock" ? "wall-clock" : "elapsed";
    it.localTrigger = it.scheduleBasis === "wall-clock" ? toLocalInput(when) : null;
    it.snoozedAt = it.scheduleBasis === "elapsed" ? snoozedAt : null;
    it.snoozeDelayMs = it.scheduleBasis === "elapsed" ? Math.max(0, when - snoozedAt) : null;
    it.dismissedUntil = null;
    it.snoozeCount = (it.snoozeCount || 0) + 1;
    it.remindCount = 0;
    it.lastRemindAt = null;
    it.lastAlertShownAt = null;
    it.deliveredAt = null;
    bumpRev(it);
    save();
    toast("已改到 " + fmtTime(when));
    render();
    return true;
  }

  function deleteItem(id) {
    if (!state.items.some(x => x.id === id)) return false;
    state.items = state.items.filter(x => x.id !== id);
    save();
    toast("已删除");
    render();
    return true;
  }

  function reopenItem(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return false;
    const snoozedAt = Date.now();
    it.status = "snoozed";
    it.triggerAt = snoozedAt + 2 * 3600000;
    it.scheduleBasis = "elapsed";
    it.localTrigger = null;
    it.snoozedAt = snoozedAt;
    it.snoozeDelayMs = 2 * 3600000;
    it.dismissedUntil = null;
    // 「再提醒」同样开启新一轮，与 snoozeItem 保持同一份轮次语义
    it.remindCount = 0;
    it.lastRemindAt = null;
    it.lastAlertShownAt = null;
    it.deliveredAt = null;
    bumpRev(it);
    save();
    toast("将在 2 小时后再次提醒");
    render();
    return true;
  }

  /**
   * D23：归档重开不设 trigger_at（不自动提醒），可选给一次极简时间选择。
   *
   * 承诺一致性：重开时同时**暂停截止保护**。截止保护同样是「自动提醒」，
   * 而原实现会让原生投影在恢复后立刻补一条截止提醒，与「不会自动提醒」直接冲突。
   * 暂停是显式可见的，用户可以在卡片/详情里一键恢复。
   */
  function restoreItem(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return false;
    it.status = "waiting";
    it.completedAt = null;
    it.triggerAt = null;
    it.scheduleBasis = null;
    it.localTrigger = null;
    it.snoozedAt = null;
    it.snoozeDelayMs = null;
    it.dismissedUntil = null;
    it.remindCount = 0;
    it.lastRemindAt = null;
    it.lastAlertShownAt = null;
    it.deliveredAt = null;
    it.deadlinePaused = true;
    bumpRev(it);
    save();
    toast("已恢复 · 不会自动提醒", "设置时间", () => {
      state.ui.snoozeId = it.id;
      openSheet("sheetSnooze");
    });
    render();
    return true;
  }

  /** D23 例外必须由用户显式解除：恢复归档时被暂停的截止保护 */
  function resumeDeadlineProtection(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return false;
    it.deadlinePaused = false;
    it.deadlineStageKey = null;
    // 一并清掉暂停前的原生排期记录，否则恢复后会被判成「已送达」而不再排程
    it.deadlineEvents = {};
    bumpRev(it);
    save();
    toast(it.deadlineAt ? "截止保护已恢复 · 截止 " + fmtTime(it.deadlineAt) : "截止保护已恢复");
    render();
    return true;
  }

  /**
   * L03 / V0.2 §417：停止重复 = **终止整个周期规则并归档当前实例**。
   *
   * F3：终止的是**整个系列**。
   * G4：但「终止规则」与「归档实例」是两件事，必须分开 ——
   *  1. 整个系列（含历史实例）一律摘掉 `repeat`，从此不再派生、不再按周期提醒；
   *  2. 用户明确操作的那一条归档（这是「归档当前实例」的语义）；
   *  3. 同系列里**尚未开始**的未来实例随规则一起归档，不写 `completedAt`
   *     （它们从未被用户处理过，不应计入「今天已完成 N 件」）；
   *  4. 已经确认/交付过的历史实例**保留业务状态** —— 之前把 `acknowledged` 的
   *     上一条也一并归档且 `completedAt=null`，它会从待处理列表里凭空消失。
   */
  function stopRepeat(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return false;
    const seriesId = it.seriesId || null;
    const members = seriesMembers(seriesId, id, it);
    // 1) 先终止规则：历史与未来实例都不再属于这个周期
    const all = [it].concat(members);
    all.forEach(m => {
      m.repeat = null;
      m.ackAdvancedAt = null;
      m.dismissedUntil = null;
    });
    // 2) 归档当前实例
    if (!isTerminal(it)) {
      it.status = "archived";
      it.completedAt = Date.now();
    }
    // 3) 只归档「尚未开始」的未来实例；4) 已确认/已交付的历史保留业务状态
    const archived = [];
    members.forEach(m => {
      if (!isUnstartedInstance(m)) return;
      m.status = "archived";
      m.completedAt = null; // 未真正完成，只随规则终止
      archived.push(m);
    });
    all.forEach(m => bumpRev(m));
    save();
    queueNativeReminderSync();
    toast(archived.length
      ? "已停止重复 · 周期已终止并归档（含 " + archived.length + " 个未开始的未来实例）"
      : "已停止重复 · 周期已终止并归档");
    render();
    return true;
  }

  /* ---------- item card ---------- */
  function priorityRank(p) {
    return { critical: 0, important: 1, normal: 2 }[p] != null ? { critical: 0, important: 1, normal: 2 }[p] : 3;
  }

  function renderItemCard(it, mode) {
    const pills = [];
    if (it.priority === "important") pills.push('<span class="pill warn">☆ 重要</span>');
    if (it.priority === "critical") pills.push('<span class="pill crit">🚨 关键</span>');

    const proj = projectById(it.projectId);
    if (proj) {
      pills.push('<span class="pill proj" style="color:' + escapeHtml(proj.color) + ';background:color-mix(in srgb, ' + escapeHtml(proj.color) + ' 12%, white)">' + escapeHtml(proj.name) + "</span>");
    }

    if (mode === "archived") {
      if (it.completedAt) pills.push('<span class="pill">完成于 ' + fmtTime(it.completedAt) + "</span>");
    } else if (it.triggerAt) {
      const label = mode === "future" ? fmtTime(it.triggerAt) : relDue(it.triggerAt);
      pills.push('<span class="pill ' + (mode === "future" ? "future" : "time") + '">' + escapeHtml(label) + "</span>");
    } else {
      pills.push('<span class="pill">未设定时间</span>');
    }
    if (it.deadlineAt) pills.push('<span class="pill warn">截止 ' + fmtDate(it.deadlineAt) + "</span>");
    // D23：恢复归档后截止保护被暂停 —— 风险必须明确展示，不能默默替用户决定
    if (it.deadlineAt && it.deadlinePaused) pills.push('<span class="pill">截止保护已暂停</span>');
    if (it.repeat && it.repeat.every) {
      pills.push('<span class="pill future">' + escapeHtml(repeatLabel(it.repeat)) +
        (it.repeat.mode === "ack" ? " · ACK后" : "") + "</span>");
    }
    (it.tags || []).forEach(t => pills.push('<span class="pill tag">#' + escapeHtml(t) + "</span>"));

    let actions = "";
    if (mode === "due") {
      actions = '<div class="card-actions">' +
        '<button class="ghost" data-act="snooze" data-id="' + it.id + '">稍后</button>' +
        '<button class="primary" data-act="ack" data-id="' + it.id + '">我知道了</button>' +
        '<button class="ghost" data-act="done" data-id="' + it.id + '">完成</button>' +
        "</div>";
    } else if (mode === "active") {
      actions = '<div class="card-actions">' +
        '<button class="ghost" data-act="reopen" data-id="' + it.id + '">再提醒</button>' +
        '<button class="ghost" data-act="edit" data-id="' + it.id + '">编辑</button>' +
        '<button class="primary" data-act="done" data-id="' + it.id + '">完成</button>' +
        "</div>";
    } else if (mode === "future") {
      actions = '<div class="card-actions">' +
        '<button class="ghost" data-act="open" data-id="' + it.id + '">详情</button>' +
        '<button class="primary" data-act="edit" data-id="' + it.id + '">编辑</button>' +
        "</div>";
    } else if (mode === "archived") {
      actions = '<div class="card-actions">' +
        '<button class="ghost" data-act="open" data-id="' + it.id + '">详情</button>' +
        '<button class="primary" data-act="restore" data-id="' + it.id + '">恢复</button>' +
        "</div>";
    }

    const link = it.url
      ? '<a class="linkish" href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener">' + escapeHtml(it.url) + "</a>"
      : "";

    return '<article class="card ' +
      (it.priority === "critical" ? "urgent " : it.priority === "important" ? "important " : "") +
      (mode === "active" ? "acked " : "") +
      (mode === "archived" ? "done" : "") +
      '" data-id="' + it.id + '">' +
      '<div class="card-title">' + escapeHtml(it.title) + "</div>" +
      '<div class="card-meta">' + pills.join("") + "</div>" +
      (it.note ? '<p style="font-size:0.86rem;color:var(--muted);margin:-4px 0 8px;white-space:pre-wrap">' + escapeHtml(it.note) + "</p>" : "") +
      link + actions +
      "</article>";
  }

  /* ---------- views ---------- */
  function setBadge(n) {
    const el = $("#navBadge");
    if (n > 0) { el.hidden = false; el.textContent = n > 9 ? "9+" : String(n); }
    else el.hidden = true;
    updateAppBadge(n);
  }

  function updateAppBadge(forced) {
    const n = forced != null
      ? forced
      : state.items.filter(it => it.status === "due").length;
    if (navigator.setAppBadge) {
      if (n > 0) navigator.setAppBadge(n).catch(() => {});
      else navigator.clearAppBadge().catch(() => {});
    }
  }

  function renderHome() {
    promoteDue();
    // A-2 / D68：先摆「后台到底会不会响」这句话 —— 它是对整页的限定，
    // 必须排在「现在需要注意」之前，否则用户读到的是一件件的待办，读不到前提。
    renderHomeNotice();
    const now = Date.now();
    const dueMap = new Map();
    state.items.forEach(it => {
      // L01 / D17 / V06：与原生投影同一套判定 —— 兜底记录不因其兜底时间进「需要注意」，
      // 但被截止保护拉起的兜底记录必须能看到。
      if (isAttentionDue(it, now)) dueMap.set(it.id, it);
    });
    const dueList = Array.from(dueMap.values()).sort((a, b) => {
      const pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) return pr;
      return (a.triggerAt || 0) - (b.triggerAt || 0);
    });

    const active = state.items
      .filter(it => it.status === "acknowledged" && it.review_status !== "NEEDS_REVIEW")
      .sort((a, b) => (b.acknowledgedAt || 0) - (a.acknowledgedAt || 0));

    const doneToday = state.items.filter(it => {
      if (it.status !== "archived") return false;
      if (!it.completedAt) return false;
      return sameDay(new Date(it.completedAt), new Date());
    });

    // D5：首页不再出现「即将到来」；顺序 = 需要注意 → 已看到（折叠） → 待整理弱入口 → 空态
    const homeUpcoming = $("#homeUpcoming");
    if (homeUpcoming) homeUpcoming.innerHTML = "";

    $("#homeDue").innerHTML = dueList.length
      ? '<div class="sec"><div class="sec-head"><div class="sec-title">现在需要注意</div><div class="sec-count">' +
        dueList.length + "</div></div>" +
        dueList.map(it => renderItemCard(it, "due")).join("") + "</div>"
      : "";

    // D7：「已看到未完成」永远折叠成一行（带数量）
    const expanded = state.ui.activeExpanded;
    $("#homeActive").innerHTML = active.length
      ? '<button class="soft-entry" id="toggleActive"><span><strong>已看到未完成 · ' + active.length +
        "</strong></span><span>" + (expanded ? "收起" : "展开") + " ›</span></button>" +
        '<div id="activeList"' + (expanded ? "" : " hidden") + ">" +
        active.map(it => renderItemCard(it, "active")).join("") + "</div>"
      : "";

    // D8：空态里一句纯文字完成数 —— 纯文字、不可点击、无徽标、无强调色、不新增区块
    // （当天完成明细走「未来 → 已归档」，不在首页开入口）
    const quiet = !dueList.length && !active.length;
    $("#homeEmpty").innerHTML = quiet
      ? '<div class="empty"><div class="empty-mark">✓</div><h3>此刻很安静</h3>' +
        "<p>没有需要你注意的事项。已交给系统的未来，会自己在合适的时候回来。</p>" +
        (doneToday.length
          ? '<p style="margin-top:12px;font-size:0.92rem;color:var(--ink-2)">今天已完成 ' + doneToday.length + " 件</p>"
          : "") +
        "</div>"
      : "";

    setBadge(dueList.length);
    // D6/D20：待整理入口 —— 显著时提到最前，弱形态时排在「需要注意」之后
    renderReviewEntry();
    try {
      const homeEl = $("#view-home");
      const reviewHost = $("#homeReview");
      const dueHost = $("#homeDue");
      const activeHost = $("#homeActive");
      if (homeEl && reviewHost && typeof homeEl.insertBefore === "function" && reviewHost.parentNode) {
        if (inReviewHighlight()) {
          homeEl.insertBefore(reviewHost, homeEl.firstChild);
        } else if (activeHost && activeHost.parentNode === homeEl) {
          homeEl.insertBefore(reviewHost, activeHost.nextSibling);
        } else if (dueHost && dueHost.parentNode === homeEl) {
          homeEl.insertBefore(reviewHost, dueHost.nextSibling);
        }
      }
    } catch (e) { /* 测试 mock DOM 可能不支持 insertBefore */ }
    $("#pageTitle").textContent = "安心收件箱";
    $("#pageSub").textContent = dueList.length
      ? "现在有 " + dueList.length + " 件需要你注意"
      : "现在很安静 · 可以放心忘记";
  }

  function renderCalendar() {
    const mount = $("#calMount");
    if (state.ui.futureSeg !== "waiting") {
      mount.innerHTML = "";
      return;
    }
    const month = state.ui.calMonth ? new Date(state.ui.calMonth) : new Date();
    const y = month.getFullYear(), m = month.getMonth();
    const first = new Date(y, m, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const now = new Date();

    const counts = {};
    const dueFlags = {};
    state.items.forEach(it => {
      if (it.status !== "waiting" && it.status !== "snoozed" && it.status !== "due") return;
      if (!it.triggerAt) return;
      const d = new Date(it.triggerAt);
      if (d.getFullYear() !== y || d.getMonth() !== m) return;
      const k = d.getDate();
      counts[k] = (counts[k] || 0) + 1;
      if (it.triggerAt <= Date.now() || it.status === "due") dueFlags[k] = true;
    });

    let cells = "";
    for (let i = 0; i < startPad; i++) cells += '<div class="cal-day muted"></div>';
    for (let day = 1; day <= daysInMonth; day++) {
      const isToday = now.getFullYear() === y && now.getMonth() === m && now.getDate() === day;
      const sel = state.ui.calSelected === day;
      const cls = ["cal-day"];
      if (isToday) cls.push("today");
      if (counts[day]) cls.push("has");
      if (dueFlags[day]) cls.push("due-dot");
      if (sel) cls.push("sel");
      cells += '<button type="button" class="' + cls.join(" ") + '" data-cal-day="' + day + '">' + day + "</button>";
    }

    mount.innerHTML =
      '<div class="cal"><div class="cal-head"><div class="cal-title">' + y + " 年 " + (m + 1) + ' 月</div>' +
      '<div class="cal-nav"><button type="button" data-cal="prev" aria-label="上个月">‹</button>' +
      '<button type="button" data-cal="today" aria-label="今天">今</button>' +
      '<button type="button" data-cal="next" aria-label="下个月">›</button></div></div>' +
      '<div class="cal-grid">' +
      ["日", "一", "二", "三", "四", "五", "六"].map(d => '<div class="cal-dow">' + d + "</div>").join("") +
      cells + "</div></div>";
  }

  function renderArchiveList() {
    const archived = state.items
      .filter(it => it.status === "archived" || it.status === "completed")
      .sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt));
    if (!archived.length) {
      return '<div class="empty"><div class="empty-mark">✓</div><h3>还没有归档</h3>' +
        "<p>完成后的内容会收进这里，可随时回看，但不会主动打扰你。</p></div>";
    }
    const groups = [];
    let curKey = null, curLabel = null, curItems = [];
    archived.forEach(it => {
      const ts = it.completedAt || it.createdAt;
      const key = startOfDay(ts).getTime();
      if (key !== curKey) {
        if (curItems.length) groups.push({ label: curLabel, items: curItems });
        curKey = key; curLabel = dayLabel(ts); curItems = [];
      }
      curItems.push(it);
    });
    if (curItems.length) groups.push({ label: curLabel, items: curItems });

    return '<div class="sec"><div class="sec-head"><div class="sec-title">归档 · 可回看</div><div class="sec-count">' +
      archived.length + "</div></div>" +
      groups.map(g =>
        '<div class="day-head">' + escapeHtml(g.label) + "</div>" +
        g.items.map(it => renderItemCard(it, "archived")).join("")
      ).join("") +
      '<p style="color:var(--muted);font-size:0.8rem;text-align:center;padding:8px 12px 20px;line-height:1.5">归档默认不主动浮现，需要时来这里或搜索。</p></div>';
  }

  function renderFuture() {
    promoteDue();
    const seg = state.ui.futureSeg || "waiting";
    const filter = state.ui.futureFilter || "all";

    $$("#futureSeg .seg-item").forEach(b => {
      b.classList.toggle("on", b.dataset.seg === seg);
    });
    $("#futureFiltersWrap").hidden = seg !== "waiting";

    if (seg === "archive") {
      $("#calMount").innerHTML = "";
      $("#futureList").innerHTML = renderArchiveList();
      $("#pageTitle").textContent = "已归档";
      $("#pageSub").textContent = "完成过的事项，需要时可回看";
      return;
    }

    renderCalendar();

    let list = state.items.filter(it => it.status === "waiting" || it.status === "snoozed");
    if (filter === "important") list = list.filter(it => it.priority === "important" || it.priority === "critical");
    if (filter === "deadline") list = list.filter(it => !!it.deadlineAt);
    if (filter === "repeat") list = list.filter(it => !!(it.repeat && it.repeat.every));
    if (filter === "project") list = list.filter(it => !!it.projectId);

    if (state.ui.calSelected) {
      const y = new Date(state.ui.calMonth || Date.now()).getFullYear();
      const m = new Date(state.ui.calMonth || Date.now()).getMonth();
      list = list.filter(it => {
        if (!it.triggerAt) return false;
        const d = new Date(it.triggerAt);
        return d.getFullYear() === y && d.getMonth() === m && d.getDate() === state.ui.calSelected;
      });
    }

    list.sort((a, b) => (a.triggerAt || 0) - (b.triggerAt || 0));
    $$("#futureFilters .chip").forEach(c => c.classList.toggle("on", c.dataset.filter === filter));

    const filterNote = state.ui.calSelected
      ? '<div class="hint-bar">已筛选：' + (new Date(state.ui.calMonth || Date.now()).getMonth() + 1) + " 月 " +
        state.ui.calSelected + ' 日 · <button type="button" id="clearCalSel" style="color:inherit;font-weight:700;text-decoration:underline">清除</button></div>'
      : "";

    $("#futureList").innerHTML = filterNote + (list.length
      ? '<div class="sec"><div class="sec-head"><div class="sec-title">托管中的未来</div><div class="sec-count">' +
        list.length + "</div></div>" + list.map(it => renderItemCard(it, "future")).join("") +
        '<p style="color:var(--muted);font-size:0.8rem;text-align:center;padding:8px 12px 20px;line-height:1.5">Future 默认不占据首页。默认隐藏 ≠ 不允许查看。</p></div>'
      : '<div class="empty"><div class="empty-mark">⏱</div><h3>没有托管中的未来</h3>' +
        "<p>在首页点 +，一句话把未来事项交出去，现在就可以少记挂。</p></div>");

    $("#pageTitle").textContent = "未来";
    $("#pageSub").textContent = "已保存，尚未进入注意力";
  }

  function renderNotes() {
    const filter = state.ui.notesFilter || "all";
    $$("#notesFilters .chip").forEach(c => c.classList.toggle("on", c.dataset.nfilter === filter));
    let notes = state.notes.slice().sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    if (filter === "pinned") notes = notes.filter(n => n.pinned);

    $("#notesList").innerHTML =
      '<div class="sec"><div class="sec-head"><div class="sec-title">笔记</div>' +
      '<button class="chip on" id="btnNewNote" style="padding:6px 12px">+ 新建</button></div>' +
      (notes.length
        ? notes.map(n => {
            const proj = projectById(n.projectId);
            return '<article class="note-card" data-note="' + n.id + '">' +
              "<h3>" + (n.pinned ? "📌 " : "") + escapeHtml(n.title || "无标题") + "</h3>" +
              "<p>" + escapeHtml(n.body || "") + "</p>" +
              '<div class="note-date">' + fmtTime(n.updatedAt) +
              (proj ? " · " + escapeHtml(proj.name) : "") + " · 点按编辑</div></article>";
          }).join("")
        : '<div class="empty"><div class="empty-mark">📝</div><h3>还没有笔记</h3>' +
          "<p>记下上下文、灵感或 README，唤醒时更好恢复记忆。</p></div>") +
      "</div>";

    $("#pageTitle").textContent = "笔记";
    $("#pageSub").textContent = "上下文与想法，本地保存";
  }

  function renderStats() {
    const now = Date.now();
    const due = state.items.filter(it => it.status === "due").length;
    const waiting = state.items.filter(it => it.status === "waiting" || it.status === "snoozed").length;
    const acked = state.items.filter(it => it.status === "acknowledged").length;
    $("#statsRow").innerHTML =
      '<div class="stat"><b>' + due + "</b><span>待确认</span></div>" +
      '<div class="stat"><b>' + acked + "</b><span>已看到</span></div>" +
      '<div class="stat"><b>' + waiting + "</b><span>托管中</span></div>";
    $("#projSub").textContent = state.projects.length + " 个项目";
    const qs = state.settings.quietStart || "23:00";
    const qe = state.settings.quietEnd || "07:30";
    $("#quietSub").textContent = qs + " – " + qe;
    $("#dndSub").textContent = qs + "–" + qe + " 普通事项延后";
    const rs = ensureReviewSettings();
    const reviewSub = $("#reviewScheduleSub");
    if (reviewSub) {
      const n = needsReviewItems().length;
      reviewSub.textContent = (rs.enabled ? "每天 " + pad2(rs.hour || 21) + ":" + pad2(rs.minute || 30) : "已关闭") +
        (n ? " · 待整理 " + n : "");
    }
  }

  function renderMe() {
    $("#swNotify").classList.toggle("on", !!state.settings.notify);
    $("#swDnd").classList.toggle("on", !!state.settings.dnd);
    $("#swImp").classList.toggle("on", !!state.settings.importantRepeat);
    $("#swSummary").classList.toggle("on", !!state.settings.dailySummary);
    $("#swPrivacy").classList.toggle("on", !!state.settings.privacyNotify);
    // D25：默认提醒方式
    const modeSeg = $("#deliveryModeSeg");
    if (modeSeg) {
      const mode = state.settings.defaultDeliveryMode === "alarm" ? "alarm" : "notification";
      $$("#deliveryModeSeg .seg-item").forEach(b => {
        b.classList.toggle("on", b.dataset.mode === mode);
      });
    }
    const sum = $("#summarySub");
    if (sum) sum.textContent = state.settings.dailySummary ? "已开启 · 新增较多时轻量提示" : "默认关闭 · 仅增强可信感";
    renderAiSub();
    renderStats();
    renderPwaStatus();
    $("#pageTitle").textContent = "我的";
    $("#pageSub").textContent = "偏好、项目与数据";
  }

  function renderPwaStatus() {
    const pill = $("#pwaPill");
    const sub = $("#pwaSub");
    if (!pill || !sub) return;
    const native = !!(NativeReminders.isNativeAndroid && NativeReminders.isNativeAndroid());
    const exactRow = $("#btnExactAlarm");
    const exactSub = $("#exactAlarmSub");
    const exactPill = $("#exactAlarmPill");
    const notifySettingsRow = $("#btnNotifySettings");
    const batteryRow = $("#btnBatterySettings");
    const labRow = $("#btnNotifyLab");
    if (exactRow) exactRow.hidden = !native;
    if (notifySettingsRow) notifySettingsRow.hidden = !native;
    if (batteryRow) batteryRow.hidden = !native;
    if (labRow) labRow.hidden = !native;
    if (native) {
      const notificationGranted = nativeReminderStatus.notifications === "granted";
      const exactGranted = nativeReminderStatus.exactAlarm === "granted";
      const alarmErrors = nativeReminderStatus.errors || [];
      const hasErrors = alarmErrors.length > 0 || nativeReminderStatus.reliability === "error";
      const reliability = hasErrors ? "error" : (state.settings.notify ? nativeReminderStatus.reliability : "in-app");
      if (exactRow) exactRow.disabled = !notificationGranted;
      if (exactSub) {
        exactSub.textContent = !notificationGranted ? "先开启通知权限" :
          exactGranted ? "已允许按设定时间精确提醒" : "未授权时仍提醒，但时间可能延迟";
      }
      if (exactPill) {
        exactPill.textContent = exactGranted ? "已授权" : "需设置";
        exactPill.className = "pill " + (exactGranted ? "time" : "warn");
      }
      pill.textContent = reliability === "exact" ? "精确" :
        reliability === "inexact" ? "降级" :
        reliability === "error" ? "异常" : "应用内";
      pill.className = "pill " + (reliability === "exact" ? "time" : "warn");
      // F4：撤销失败意味着「旧闹钟可能仍在」，这句话必须让用户看得见
      const cancelFailed = alarmErrors.some(e => /^cancel:/.test(String(e)));
      // Q6：把「你自己关了总开关」与「系统权限没给」分开说。
      // 此前两者共用一句「通知未授权 · 仅应用内提醒」，把用户往授权那条路上引，
      // 而他真正该做的是打开自己的开关 —— 于是反复授权、始终不响。
      if (reliability === "exact") {
        sub.textContent = "原生精确提醒已就绪 · 关掉 App 也会按时响";
      } else if (reliability === "inexact") {
        sub.textContent = "原生提醒已开 · 时间可能延迟";
      } else if (reliability === "error") {
        sub.textContent = nativeReminderStatus.bridgeNotReady
          ? "原生桥未就绪 · 关掉 App 不会有提醒，请完全退出后重开"
          : (cancelFailed
              ? "原生提醒同步失败 · 部分旧闹钟可能仍在，请重开应用重试"
              : "原生提醒同步失败 · 请重新打开设置");
      } else {
        sub.textContent = state.settings.notify
          ? "系统通知权限未授予 · 关掉 App 不会有提醒"
          : "总开关未开 · 关掉 App 不会有提醒";
      }
      return;
    }
    const online = navigator.onLine;
    const swReady = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    // 同 showSystemNotification：属性存在但为 undefined 时 `in` 判断会抛错
    const N = typeof window !== "undefined" ? window.Notification : null;
    const notify = !!state.settings.notify && !!N && N.permission === "granted";
    pill.textContent = online ? "在线" : "离线可用";
    pill.className = "pill " + (online ? "time" : "future");
    sub.textContent = (swReady ? "PWA 已就绪" : "PWA 未注册") +
      " · 通知" + (notify ? "已开" : "未开") +
      " · 数据本地保存";
  }

  function render() {
    $$(".view").forEach(v => v.classList.remove("active"));
    const map = { home: "#view-home", future: "#view-future", notes: "#view-notes", me: "#view-me" };
    $(map[state.ui.tab] || "#view-home").classList.add("active");
    $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.tab === state.ui.tab));
    if (state.ui.tab === "home") renderHome();
    else if (state.ui.tab === "future") renderFuture();
    else if (state.ui.tab === "notes") renderNotes();
    else renderMe();
    refreshProjectSelects();
  }

  function refreshProjectSelects() {
    const opts = ['<option value="">无项目</option>'].concat(
      state.projects.map(p => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) + "</option>")
    ).join("");
    ["#capProject", "#noteProject"].forEach(sel => {
      const el = $(sel);
      if (!el) return;
      const prev = el.value;
      el.innerHTML = opts;
      el.value = prev;
    });
  }

  /* ---------- AI (optional BYOK, OpenAI-compatible) ---------- */
  function aiConfig() {
    return state.settings.ai || {
      enabled: false, baseUrl: "", apiKey: "", model: "", autoOnSave: false
    };
  }

  function aiReady() {
    const c = aiConfig();
    return !!(c.enabled && c.baseUrl && c.apiKey && c.model);
  }

  function aiNowIso() {
    const d = new Date();
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const abs = Math.abs(off);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + sign +
      pad(Math.floor(abs / 60)) + ":" + pad(abs % 60);
  }

  function aiSystemPrompt() {
    return [
      "你是「安心收件箱」的隐形解析引擎。用户会输入一句中文待办/提醒。",
      "你的职责仅限：提炼标题、提取提醒时间与截止时间、提取标签、必要时补一句上下文。",
      "禁止：评价优先级重要性、展开对话、给出建议、编造未提及的事项。",
      "当前本地时间 ISO：" + aiNowIso(),
      "只返回一个 JSON 对象，不要 markdown 代码块，字段：",
      "{",
      '  "title": string,',
      '  "trigger_at": string|null,  // ISO 本地时间，无则 null',
      '  "deadline": string|null,',
      '  "tags": string[],',
      '  "note": string,',
      '  "priority": "normal"|"important"|"critical",',
      '  "repeat": null|{"every":"day"|"week"|"biweek"|"month"|"monthEnd"|"nthWeekday","mode":"calendar"|"ack","nth"?:1|2|3|4|-1,"dow"?:0|1|2|3|4|5|6}',
      "}"
    ].join("\n");
  }

  async function aiChat(userText, systemExtra) {
    const c = aiConfig();
    if (!c.baseUrl || !c.apiKey || !c.model) {
      throw new Error("请先配置 AI API");
    }
    const base = c.baseUrl.replace(/\/+$/, "");
    const url = base + "/chat/completions";
    const body = {
      model: c.model,
      temperature: 0.1,
      messages: [
        { role: "system", content: aiSystemPrompt() + (systemExtra ? "\n" + systemExtra : "") },
        { role: "user", content: userText }
      ]
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + c.apiKey
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("HTTP " + res.status + (t ? " · " + t.slice(0, 120) : ""));
    }
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";
    if (!content) throw new Error("AI 返回为空");
    return content;
  }

  function extractJson(text) {
    let s = String(text || "").trim();
    s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    return JSON.parse(s);
  }

  function parseIsoSafe(v) {
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }

  function normalizeAiResult(obj, fallbackText) {
    const title = (obj.title && String(obj.title).trim()) || fallbackText || "未命名事项";
    const triggerAt = parseIsoSafe(obj.trigger_at);
    const deadlineAt = parseIsoSafe(obj.deadline);
    const tags = Array.isArray(obj.tags)
      ? obj.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 8)
      : [];
    const note = obj.note ? String(obj.note).trim() : "";
    let priority = obj.priority;
    if (priority !== "important" && priority !== "critical") priority = "normal";
    let repeat = null;
    if (obj.repeat && obj.repeat.every) {
      const every = ["day", "week", "biweek", "month", "monthEnd", "nthWeekday"].includes(obj.repeat.every)
        ? obj.repeat.every : null;
      if (every) {
        repeat = {
          every,
          mode: obj.repeat.mode === "ack" ? "ack" : "calendar"
        };
        if (every === "nthWeekday") {
          repeat.nth = obj.repeat.nth === -1 ? -1 : (parseInt(obj.repeat.nth, 10) || 1);
          repeat.dow = obj.repeat.dow != null ? (parseInt(obj.repeat.dow, 10) || 0) : 1;
        }
      }
    }
    return { title, triggerAt, deadlineAt, tags, note, priority, repeat, confidence: triggerAt ? "high" : "low" };
  }

  async function aiParseCapture(text) {
    const content = await aiChat(text, "任务类型：capture_parse。把用户原话解析成结构化提醒。");
    const obj = extractJson(content);
    return normalizeAiResult(obj, text);
  }

  async function aiPolishCapture(text) {
    const content = await aiChat(
      text,
      "任务类型：polish。只润色 title 与 note，尽量保留原意；时间字段若原文没有则给 null。"
    );
    const obj = extractJson(content);
    return normalizeAiResult(obj, text);
  }

  async function aiTestConnection() {
    const c = aiConfig();
    if (!c.baseUrl || !c.apiKey || !c.model) throw new Error("请先填写 API 配置");
    const base = c.baseUrl.replace(/\/+$/, "");
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + c.apiKey
      },
      body: JSON.stringify({
        model: c.model,
        max_tokens: 8,
        messages: [{ role: "user", content: "ping" }]
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("HTTP " + res.status + (t ? " · " + t.slice(0, 100) : ""));
    }
    return true;
  }

  function applyAiToForm(r, sourceLabel) {
    if (r.title) $("#capText").value = r.title;
    if (r.triggerAt) $("#capTrigger").value = toLocalInput(r.triggerAt);
    if (r.deadlineAt) $("#capDeadline").value = toLocalInput(r.deadlineAt);
    if (r.note && !$("#capNote").value.trim()) $("#capNote").value = r.note;
    if (r.tags && r.tags.length) {
      const existing = $("#capTags").value.trim().split(/\s+/).filter(Boolean);
      const merged = Array.from(new Set(existing.concat(r.tags)));
      $("#capTags").value = merged.join(" ");
    }
    if (r.priority) {
      $$("#capPriority .chip").forEach(c => c.classList.toggle("on", c.dataset.p === r.priority));
    }
    if (r.repeat) {
      $("#capRepeat").value = r.repeat.every;
      $("#capRepeatMode").value = r.repeat.mode;
      if (r.repeat.every === "nthWeekday") {
        $("#capNth").value = String(r.repeat.nth || 1);
        $("#capWeekday").value = String(r.repeat.dow != null ? r.repeat.dow : 1);
      }
      updateRepeatPreview();
    }
    let msg = (sourceLabel || "AI") + "：" + (r.triggerAt ? fmtTime(r.triggerAt) : "未识别时间");
    if (r.deadlineAt) msg += " · 截止 " + fmtDate(r.deadlineAt);
    if (r.repeat) msg += " · " + repeatLabel(r.repeat);
    msg += " · 可修改";
    $("#capHint").textContent = msg;
    $("#capHint").classList.remove("muted");
  }

  let aiBusy = false;
  async function runAiOnCapture(mode) {
    if (aiBusy) return;
    if (!aiReady()) {
      toast("请先在「我的 → AI 智能理解」开启并配置");
      state.ui.tab = "me";
      renderMe();
      openAiSheet();
      return;
    }
    const text = $("#capText").value.trim();
    if (!text) { toast("先写一句话吧"); return; }

    // local parse first so UI never blocks empty
    const local = parseChineseTime(text);
    if (mode === "parse") {
      $("#capTrigger").value = toLocalInput(local.trigger);
      $("#capDeadline").value = toLocalInput(local.deadline);
    }

    aiBusy = true;
    const btn = mode === "polish" ? $("#btnAiPolish") : $("#btnAiParse");
    const prev = btn.textContent;
    btn.textContent = "✦ 思考中…";
    btn.disabled = true;
    try {
      const r = mode === "polish" ? await aiPolishCapture(text) : await aiParseCapture(text);
      applyAiToForm(r, mode === "polish" ? "AI 润色" : "AI 理解");
      toast("AI 已更新字段");
    } catch (e) {
      $("#capHint").textContent = "AI 暂不可用，已用本地解析 · " + (e && e.message ? e.message : "失败");
      $("#capHint").classList.remove("muted");
      toast("AI 失败，已回退本地解析");
    } finally {
      aiBusy = false;
      btn.textContent = prev;
      btn.disabled = false;
    }
  }

  function openAiSheet() {
    const c = aiConfig();
    $("#swAi").classList.toggle("on", !!c.enabled);
    $("#aiBaseUrl").value = c.baseUrl || "";
    $("#aiApiKey").value = c.apiKey || "";
    $("#aiModel").value = c.model || "";
    $$("#aiAutoChips .chip").forEach(ch => {
      ch.classList.toggle("on", (ch.dataset.auto === "on") === !!c.autoOnSave);
    });
    openSheet("sheetAi");
  }

  function saveAiSettings() {
    state.settings.ai = {
      enabled: $("#swAi").classList.contains("on"),
      baseUrl: ($("#aiBaseUrl").value || "").trim().replace(/\/+$/, ""),
      apiKey: ($("#aiApiKey").value || "").trim(),
      model: ($("#aiModel").value || "").trim(),
      autoOnSave: ($$("#aiAutoChips .chip.on")[0] || {}).dataset?.auto === "on"
    };
    save();
    closeSheet("sheetAi");
    renderMe();
    toast(state.settings.ai.enabled ? "AI 已启用" : "AI 已关闭");
  }

  function renderAiSub() {
    const c = aiConfig();
    const el = $("#aiSub");
    if (!el) return;
    if (!c.enabled) el.textContent = "未开启 · 解析时间与提炼标题";
    else if (!c.apiKey || !c.baseUrl || !c.model) el.textContent = "已开启 · 请完善 API 配置";
    else el.textContent = "已开启 · " + (c.model || "模型") + (c.autoOnSave ? " · 保存时自动" : " · 仅手动");
  }

  /* ---------- sheets ---------- */
  function openSheet(id) {
    $("#backdrop").classList.add("show");
    $("#" + id).classList.add("open");
  }
  function closeSheet(id) {
    $("#" + id).classList.remove("open");
    if (!$$(".sheet.open").length) $("#backdrop").classList.remove("show");
  }
  function closeAllSheets() {
    $$(".sheet").forEach(s => s.classList.remove("open"));
    $("#backdrop").classList.remove("show");
  }

  /* In-app confirm (preview may block native confirm) */
  function confirmDialog(message, title) {
    return new Promise((resolve) => {
      const sheet = $("#sheetConfirm");
      const body = $("#confirmBody");
      const titleEl = $("#confirmTitle");
      if (!sheet || !body) {
        // last resort
        try { resolve(window.confirm(message)); } catch (e) { resolve(true); }
        return;
      }
      titleEl.textContent = title || "确认";
      body.textContent = message || "确定继续？";
      openSheet("sheetConfirm");

      const cleanup = (val) => {
        $("#confirmOk").onclick = null;
        $("#confirmCancel").onclick = null;
        $("#confirmClose").onclick = null;
        closeSheet("sheetConfirm");
        resolve(val);
      };
      $("#confirmOk").onclick = () => cleanup(true);
      $("#confirmCancel").onclick = () => cleanup(false);
      $("#confirmClose").onclick = () => cleanup(false);
    });
  }

  let toastTimer = null;
  function toast(msg, actionLabel, onAction) {
    // M1：重放用户操作时不重复弹提示 —— 那一次提示在用户操作时已经弹过了
    if (suppressUserFeedback) return;
    const t = $("#toast"), a = $("#toastAction");
    $("#toastText").textContent = msg;
    if (actionLabel) {
      a.hidden = false;
      a.textContent = actionLabel;
      a.onclick = () => { hideToast(); if (onAction) onAction(); };
    } else {
      a.hidden = true;
      a.onclick = null;
    }
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actionLabel ? 5000 : 2400);
  }
  function hideToast() { $("#toast").classList.remove("show"); }

  /* ---------- item sheet (capture / edit) ---------- */
  function resetItemSheet() {
    state.ui.editItemId = null;
    state.ui.pendingLowConf = null;
    // L01：换一张表单就是新的一次判断，不能继承上一条的手选状态
    triggerUserPicked = false;
    lowConfUserPicked = false;
    $("#sheetItemTitle").textContent = "安心记下";
    $("#capText").value = "";
    $("#capNote").value = "";
    $("#capTags").value = "";
    $("#capUrl").value = "";
    $("#capTrigger").value = "";
    $("#capDeadline").value = "";
    $("#capProject").value = "";
    $("#capRepeat").value = "";
    $("#capRepeatMode").value = "calendar";
    $("#capNth").value = "1";
    $("#capWeekday").value = "1";
    $("#nthWeekdayRow").hidden = true;
    $("#similarHint").hidden = true;
    $("#similarHint").innerHTML = "";
    $("#repeatPreview").textContent = "";
    $("#repeatPreview").classList.add("muted");
    $$("#capPriority .chip").forEach(c => c.classList.toggle("on", c.dataset.p === "normal"));
    $("#capHint").textContent = "输入内容后自动解析时间";
    $("#capHint").classList.add("muted");
    $("#btnSaveItem").textContent = "安心交给系统";
  }

  function openCapture(prefill) {
    resetItemSheet();
    refreshProjectSelects();
    if (prefill) {
      if (prefill.title) $("#capText").value = prefill.title;
      if (prefill.url) $("#capUrl").value = prefill.url;
      if (prefill.note) $("#capNote").value = prefill.note;
      updateParseHint();
    }
    openSheet("sheetItem");
    setTimeout(() => $("#capText").focus(), 280);
  }

  function openEditItem(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return;
    resetItemSheet();
    refreshProjectSelects();
    state.ui.editItemId = id;
    $("#sheetItemTitle").textContent = "编辑事项";
    $("#btnSaveItem").textContent = "保存修改";
    $("#capText").value = it.title;
    $("#capNote").value = it.note || "";
    $("#capTags").value = (it.tags || []).join(" ");
    $("#capUrl").value = it.url || "";
    $("#capTrigger").value = toLocalInput(it.triggerAt);
    $("#capDeadline").value = toLocalInput(it.deadlineAt);
    $("#capProject").value = it.projectId || "";
    const every = it.repeat && it.repeat.every ? it.repeat.every : "";
    $("#capRepeat").value = every;
    $("#capRepeatMode").value = it.repeat && it.repeat.mode ? it.repeat.mode : "calendar";
    $("#nthWeekdayRow").hidden = every !== "nthWeekday";
    if (every === "nthWeekday") {
      $("#capNth").value = String(it.repeat.nth || 1);
      $("#capWeekday").value = String(it.repeat.dow != null ? it.repeat.dow : 1);
    }
    updateRepeatPreview();
    $$("#capPriority .chip").forEach(c => c.classList.toggle("on", c.dataset.p === it.priority));
    $("#capHint").textContent = "可直接修改时间与字段，不必重新解析";
    $("#capHint").classList.remove("muted");
    openSheet("sheetItem");
  }

  function formRepeat() {
    const every = $("#capRepeat").value;
    if (!every) return null;
    const mode = $("#capRepeatMode").value || "calendar";
    if (every === "nthWeekday") {
      return {
        every,
        mode,
        nth: parseInt($("#capNth").value, 10) || 1,
        dow: parseInt($("#capWeekday").value, 10)
      };
    }
    return { every, mode };
  }

  function updateRepeatPreview() {
    const every = $("#capRepeat").value;
    $("#nthWeekdayRow").hidden = every !== "nthWeekday";
    const box = $("#repeatPreview");
    if (!every) {
      box.textContent = "";
      box.classList.add("muted");
      return;
    }
    const rep = formRepeat();
    const from = parseLocalInput($("#capTrigger").value) || Date.now();
    const list = nextRepeatPreview(rep, from, 5);
    box.textContent = "下次 5 次：" + list.map(t => fmtDate(t)).join("、");
    box.classList.remove("muted");
  }

  function normalizeText(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]/gu, "");
  }

  function findSimilarItems(title) {
    const key = normalizeText(title);
    if (key.length < 2) return [];
    return state.items.filter(it => {
      if (it.status === "archived" || it.status === "completed") return false;
      const t = normalizeText(it.title);
      if (!t) return false;
      if (t === key || t.includes(key) || key.includes(t)) return true;
      // token overlap
      const a = new Set(key.split(""));
      const b = new Set(t.split(""));
      let hit = 0;
      a.forEach(ch => { if (b.has(ch)) hit++; });
      return key.length >= 4 && hit / Math.min(a.size, b.size) > 0.72;
    }).slice(0, 3);
  }

  function renderSimilarHint(title) {
    const box = $("#similarHint");
    if (!box) return;
    const list = findSimilarItems(title);
    if (!list.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML = '<div class="similar-box">可能已有类似提醒（不会自动合并）' +
      list.map(it => '<button type="button" data-open-similar="' + it.id + '">· ' +
        escapeHtml(it.title) + "</button>").join("") +
      "</div>";
  }

  /* low-confidence confirm — D15 保留能力，按「必要」条件触发 */
  function openLowConfSheet(defaultTs, rawText) {
    state.ui.pendingLowConf = defaultTs || fallbackTriggerAt();
    state.ui.pendingLowConfRaw = rawText || "";
    const custom = $("#lowConfCustom");
    if (custom) custom.value = toLocalInput(state.ui.pendingLowConf);
    const hint = $("#lowConfHint");
    if (hint) hint.textContent = "当前：" + fmtTime(state.ui.pendingLowConf);
    $$("#lowConfChips .chip").forEach(c => c.classList.remove("on"));
    openSheet("sheetLowConf");
  }

  let similarTimer = null;
  let pendingFinishSave = null;
  let lowConfUserPicked = false;

  function finishSaveAfterLowConf(ts) {
    if (ts) $("#capTrigger").value = toLocalInput(ts);
    lowConfUserPicked = true;
    if (pendingFinishSave) {
      const fn = pendingFinishSave;
      pendingFinishSave = null;
      fn(null);
    }
  }

  function setLowConfPick(ts, chipEl) {
    state.ui.pendingLowConf = ts;
    $("#lowConfCustom").value = toLocalInput(ts);
    $("#lowConfHint").textContent = "当前：" + fmtTime(ts);
    $$("#lowConfChips .chip").forEach(c => c.classList.remove("on"));
    if (chipEl) chipEl.classList.add("on");
  }

  /* daily summary */
  function maybeDailySummary() {
    if (!state.settings.dailySummary) return;
    const last = state.settings.lastSummaryAt || 0;
    if (Date.now() - last < 20 * 3600000) return;
    const today = startOfDay(new Date()).getTime();
    const added = state.items.filter(it => it.createdAt >= today).length;
    const important = state.items.filter(it =>
      it.createdAt >= today && (it.priority === "important" || it.priority === "critical")
    ).length;
    if (added >= 3 || important > 0) {
      state.settings.lastSummaryAt = Date.now();
      save();
      const msg = "今天新增 " + added + " 条未来关注" + (important ? "，其中 " + important + " 条重要" : "");
      toast(msg);
      showSystemNotification({
        title: "安心收件箱 · 今日摘要",
        body: msg,
        tag: "daily-summary",
        requireInteraction: false
      });
    } else {
      state.settings.lastSummaryAt = Date.now();
      save();
    }
  }

  function updateParseHint() {
    const text = $("#capText").value.trim();
    if (state.ui.editItemId) return;
    if (!text) {
      $("#capHint").textContent = "输入内容后自动解析时间";
      $("#capHint").classList.add("muted");
      if (!triggerUserPicked) {
        $("#capTrigger").value = "";
      }
      $("#capDeadline").value = "";
      return;
    }
    const p = parseChineseTime(text);
    // L01：用户手选的时间优先 —— 继续输入正文不得把它覆盖掉
    const picked = triggerUserPicked ? parseLocalInput($("#capTrigger").value) : null;
    if (!picked) $("#capTrigger").value = toLocalInput(p.trigger);
    $("#capDeadline").value = toLocalInput(p.deadline);
    if (p.repeat) {
      $("#capRepeat").value = p.repeat.every;
      $("#capRepeatMode").value = p.repeat.mode;
      if (p.repeat.every === "nthWeekday") {
        $("#capNth").value = String(p.repeat.nth || 1);
        $("#capWeekday").value = String(p.repeat.dow != null ? p.repeat.dow : 1);
      }
    }
    let msg;
    if (picked) {
      msg = "已保留你选择的时间：" + fmtTime(picked) + " · 可修改";
    } else if (p.confidence === "high" || p.confidence === "mid") {
      msg = "已设置：" + fmtTime(p.trigger);
      if (p.deadline) msg += " · 截止 " + fmtDate(p.deadline);
      if (p.repeat) msg += " · " + repeatLabel(p.repeat);
      msg += " · 可修改";
    } else {
      // D17/D15：低置信度不再拍一个「一周后」，而是静默收下并在当晚整理时澄清
      msg = "未识别精确时间 · 先收下，稍后整理时再确认";
    }
    $("#capHint").textContent = msg;
    $("#capHint").classList.remove("muted");
  }

  /**
   * M1：编辑保存对事项造成的字段改动。
   *
   * 抽成独立函数是为了让「动作提交在途期间发生的编辑」也能进日志、被重放 ——
   * `saveItemFromForm` 本身要读表单，而重放时表单早已关闭，不能直接重放它。
   * 这里接收的是**取值完成的字段快照**，所以重放结果与当时完全一致。
   */
  function applyItemEdit(it, values) {
    if (!it) return false;
    const prevTrigger = it.triggerAt;
    it.title = values.title;
    it.note = values.note;
    it.tags = values.tags;
    it.url = values.url;
    it.projectId = values.projectId;
    it.priority = values.priority;
    // D25 编辑重算快照
    it.delivery_mode = resolveDeliveryMode(values.priority);
    it.triggerAt = values.triggerAt;
    it.scheduleBasis = values.scheduleBasis === "elapsed" ? "elapsed" : "wall-clock";
    it.localTrigger = it.scheduleBasis === "wall-clock" ? toLocalInput(values.triggerAt) : null;
    it.snoozedAt = null;
    it.snoozeDelayMs = null;
    it.dismissedUntil = null;
    it.deadlineAt = values.deadlineAt;
    it.repeat = values.repeat;
    if (values.triggerAt && values.triggerAt !== prevTrigger) {
      // L08：改期等于开启新一轮 —— 轮次与预算一并重置（与 snoozeItem 同一语义）
      it.remindCount = 0;
      it.lastRemindAt = null;
      it.lastAlertShownAt = null;
      it.deliveredAt = null;
    }
    if (values.triggerAt && values.triggerAt > Date.now() && (it.status === "due" || it.status === "acknowledged")) {
      it.status = "waiting";
    }
    // V05：编辑保存必须推进版本，否则旧通知的事件版本与当前一致，仍会覆盖新安排
    bumpRev(it);
    return true;
  }

  /**
   * P1-A：**新建**一条事项的实际写入。
   *
   * 抽成参数自足的纯写入（稳定 id + 已解析字段快照），它才能进入命令日志并可靠重放。
   * id 由调用方给定 —— 重放沿用同一个 id，后续针对它的编辑/删除/稍后都能命中。
   * 幂等：同 id 已存在时直接返回，不会插入第二条。
   */
  function applyNewItem(id, fields) {
    const replayId = takeReplayCreatedId();
    if (replayId) id = replayId;
    if (!id) return false;
    if (state.items.some(x => x.id === id)) return false;
    state.items.push(normalizeItem(Object.assign({}, fields, { id: id })));
    return true;
  }

  function saveItemFromForm() {
    const raw = $("#capText").value.trim();
    if (!raw && !state.ui.editItemId) {
      $("#capText").focus();
      toast("先写一句话吧");
      return;
    }

    const editing = state.ui.editItemId
      ? state.items.find(x => x.id === state.ui.editItemId)
      : null;

    const finishSave = (parsed) => {
      let title = raw;
      if (parsed) {
        title = parsed.title || raw || (editing ? editing.title : "未命名事项");
      } else if (!editing) {
        const local = parseChineseTime(raw);
        parsed = local;
        title = local.title || raw;
      } else if (raw !== editing.title) {
        const local = parseChineseTime(raw);
        parsed = local;
        title = local.title || raw;
      }

      const extraTags = $("#capTags").value.trim().split(/\s+/).filter(Boolean);
      const parsedTags = parsed ? (parsed.tags || []) : [];
      const tags = Array.from(new Set(parsedTags.concat(extraTags)));
      const priority = ($$("#capPriority .chip.on")[0] || { dataset: { p: "normal" } }).dataset.p || "normal";
      // L01：时间来源优先级固定为「用户明确选择 > 有效解析 > 兜底」
      //  · explicitTime  = 用户手选（时间输入框 / 低置信度极简选择）
      //  · parsedTrigger = 解析器给出的真实时间（低置信度时不算「真实时间」）
      //  · formTrigger   = 表单当前值，可能是解析器写进去的，因此排在解析结果之后
      const formTrigger = parseLocalInput($("#capTrigger").value);
      const parsedTrigger = parsed ? (parsed.trigger || parsed.triggerAt) : null;
      const userPicked = triggerUserPicked || lowConfUserPicked;
      const explicitTime = userPicked ? formTrigger : null;
      const parsedLow = !!(parsed && (parsed.confidence === "low" || parsed.confidence === "none"));
      const triggerAt = explicitTime || (parsedLow ? null : (parsedTrigger || formTrigger)) || null;
      const scheduleBasis = !userPicked && !parsedLow && parsed && parsed.scheduleBasis === "elapsed"
        ? "elapsed" : "wall-clock";
      const deadlineAt = parseLocalInput($("#capDeadline").value) || (parsed ? parsed.deadline || parsed.deadlineAt : null);
      const repeat = formRepeat() || (parsed && parsed.repeat
        ? (parsed.repeat.every === "nthWeekday"
            ? { every: "nthWeekday", mode: parsed.repeat.mode || "calendar", nth: parsed.repeat.nth || 1, dow: parsed.repeat.dow != null ? parsed.repeat.dow : 1 }
            : parsed.repeat)
        : null);

      if (editing) {
        // 编辑保存记录在案：原生草稿提交成功后按原值重放。
        const applied = runUserOp(applyItemEdit, [editing, {
          title: title,
          note: $("#capNote").value.trim(),
          tags: tags,
          url: $("#capUrl").value.trim(),
          projectId: $("#capProject").value || "",
          priority: priority,
          triggerAt: triggerAt,
          scheduleBasis: scheduleBasis,
          deadlineAt: deadlineAt,
          repeat: repeat
        }], { userFacing: true, itemArg: 0, name: "editItem" });
        if (applied === false) return false;
        save();
        closeSheet("sheetItem");
        closeSheet("sheetDetail");
        render();
        toast("已保存修改");
        queueNativeReminderSync();
        return true;
      }

      const item = makeItem({
        title,
        note: $("#capNote").value.trim(),
        tags,
        url: $("#capUrl").value.trim(),
        projectId: $("#capProject").value || "",
        priority,
        status: "waiting",
        triggerAt,
        scheduleBasis,
        localTrigger: scheduleBasis === "wall-clock" ? toLocalInput(triggerAt) : null,
        deadlineAt,
        windowStart: parsed && parsed.window ? parsed.window.start : null,
        windowEnd: parsed && parsed.window ? parsed.window.end : null,
        repeat,
        review_status: "READY",
        delivery_mode: resolveDeliveryMode(priority)
      });
      const needs = detectNeedsReview({
        title: item.title,
        note: item.note,
        url: item.url,
        triggerAt: item.triggerAt,
        confidence: parsed ? parsed.confidence : "none"
      });
      if (needs) {
        item.review_status = "NEEDS_REVIEW";
        // D17 / L01：**只有**「用户明确时间、解析真实时间都没有」时才落到兜底值。
        // 用户手选的时间被解析器或兜底覆盖，是这一轮最典型的「动作已明确、系统却按另一种含义执行」。
        if (!item.triggerAt) {
          item.triggerAt = fallbackTriggerAt();
          item.scheduleBasis = "wall-clock";
          item.localTrigger = toLocalInput(item.triggerAt);
          item.isFallbackTrigger = true;
        }
      }
      // 新建也走命令日志（稳定 id + 已解析字段快照），草稿发布后沿用同一业务身份。
      runUserOp(applyNewItem, [item.id, item]);
      save();
      closeSheet("sheetItem");
      resetItemSheet();
      state.ui.tab = "home";
      render();
      queueNativeReminderSync();
      if (needs) {
        toast("已收下 · 待整理", "去整理", () => openReviewSession());
      } else {
        toast("已交给系统 · " + fmtTime(item.triggerAt), "查看未来", () => {
          state.ui.tab = "future";
          state.ui.futureSeg = "waiting";
          render();
        });
      }
      return true;
    };

    // Capture always succeeds — low confidence becomes NEEDS_REVIEW, not a blocker
    // D15：仅当「含具体时间词却落到兜底」时才打断（极简选择）；其余静默收下
    if (!editing) {
      lowConfUserPicked = false;
      const localP = parseChineseTime(raw);
      const low = localP.confidence === "low" || localP.confidence === "none";
      if (low && hasSpecificTimeWord(raw)) {
        pendingFinishSave = finishSave;
        openLowConfSheet(fallbackTriggerAt(), raw);
        return;
      }
      if (low) {
        // 不把解析器拍的 +7 天写回表单——兜底由 D17 统一处理
        return finishSave(localP);
      }
    }

    // AI auto-enhance on save (optional)
    if (!editing && aiReady() && aiConfig().autoOnSave && raw) {
      const btn = $("#btnSaveItem");
      const prevLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = "AI 理解中…";
      aiParseCapture(raw)
        .then(r => {
          applyAiToForm(r, "AI 理解");
          finishSave({
            title: $("#capText").value.trim() || r.title,
            trigger: parseLocalInput($("#capTrigger").value) || r.triggerAt,
            deadline: parseLocalInput($("#capDeadline").value) || r.deadlineAt,
            tags: ($("#capTags").value.trim().split(/\s+/).filter(Boolean)),
            window: null,
            repeat: formRepeat()
          });
        })
        .catch(() => {
          finishSave(null);
        })
        .finally(() => {
          btn.disabled = false;
          btn.textContent = prevLabel;
        });
      return;
    }

    return finishSave(null);
  }

  /* ---------- detail ---------- */
  function openDetail(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return;
    state.ui.detailId = id;
    const statusMap = {
      waiting: "等待唤醒", due: "需要注意", acknowledged: "已看到未完成",
      snoozed: "已稍后", completed: "已完成", archived: "已归档"
    };
    const proj = projectById(it.projectId);
    $("#detailBody").innerHTML =
      '<div class="detail-title">' + escapeHtml(it.title) + "</div>" +
      '<div class="card-meta" style="margin-bottom:8px">' +
      (it.priority === "important" ? '<span class="pill warn">☆ 重要</span>' : "") +
      (it.priority === "critical" ? '<span class="pill crit">🚨 关键</span>' : "") +
      '<span class="pill">' + (statusMap[it.status] || it.status) + "</span>" +
      (proj ? '<span class="pill" style="color:' + escapeHtml(proj.color) + '">' + escapeHtml(proj.name) + "</span>" : "") +
      (it.tags || []).map(t => '<span class="pill tag">#' + escapeHtml(t) + "</span>").join("") +
      "</div>" +
      (it.note ? '<p style="font-size:0.92rem;color:var(--ink-2);margin-bottom:12px;white-space:pre-wrap">' + escapeHtml(it.note) + "</p>" : "") +
      '<dl class="detail-rows">' +
      '<div class="detail-row"><dt>提醒时间</dt><dd>' + (it.triggerAt ? fmtTime(it.triggerAt) : "未设定") + "</dd></div>" +
      (it.deadlineAt ? '<div class="detail-row"><dt>截止</dt><dd>' + fmtTime(it.deadlineAt) + "</dd></div>" : "") +
      // D23：暂停状态必须明确展示，否则「不自动提醒」会变成看不见的风险
      (it.deadlineAt && it.deadlinePaused
        ? '<div class="detail-row"><dt>截止保护</dt><dd>已暂停 · 归档重开默认不自动提醒，可随时恢复</dd></div>'
        : "") +
      (it.repeat && it.repeat.every
        ? '<div class="detail-row"><dt>周期</dt><dd>' +
          escapeHtml(repeatLabel(it.repeat)) +
          (it.repeat.mode === "ack" ? "（ACK 后计时）" : "") + "</dd></div>"
        : "") +
      '<div class="detail-row"><dt>创建</dt><dd>' + fmtTime(it.createdAt) + "</dd></div>" +
      (it.acknowledgedAt ? '<div class="detail-row"><dt>确认看到</dt><dd>' + fmtTime(it.acknowledgedAt) + "</dd></div>" : "") +
      (it.completedAt ? '<div class="detail-row"><dt>完成</dt><dd>' + fmtTime(it.completedAt) + "</dd></div>" : "") +
      "</dl>" +
      (it.url ? '<a class="linkish" href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener">' + escapeHtml(it.url) + "</a>" : "") +
      '<p style="margin-top:16px;font-size:0.78rem;color:var(--muted);line-height:1.5">「我知道了」只表示你真正注意到了，不会自动变成「完成」。</p>';

    let foot = "";
    if (it.status === "due") {
      foot = '<button class="btn secondary" data-act="snooze" data-id="' + it.id + '">稍后</button>' +
        '<button class="btn primary" data-act="ack" data-id="' + it.id + '">我知道了</button>' +
        '<button class="btn secondary" data-act="done" data-id="' + it.id + '" style="flex:0 0 auto">完成</button>';
    } else if (it.status === "acknowledged") {
      foot = '<button class="btn secondary" data-act="reopen" data-id="' + it.id + '">再提醒</button>' +
        '<button class="btn primary" data-act="done" data-id="' + it.id + '">完成</button>';
    } else if (it.status === "waiting" || it.status === "snoozed") {
      foot = '<button class="btn secondary" data-act="delete" data-id="' + it.id + '">删除</button>' +
        '<button class="btn primary" data-act="edit" data-id="' + it.id + '">编辑</button>';
    } else {
      foot = '<button class="btn secondary" data-act="restore" data-id="' + it.id + '">恢复</button>' +
        '<button class="btn danger" data-act="delete" data-id="' + it.id + '">删除</button>';
    }
    // L03 / D23：规则级的二级操作与「恢复截止保护」——
    // 不能用「删除当前记录」冒充整条重复规则的终止，也不能让暂停状态没有回去的路。
    const extras = [];
    if (it.repeat && it.repeat.every) {
      extras.push('<button class="btn secondary" data-act="stopRepeat" data-id="' + it.id + '">停止重复</button>');
    }
    if (it.deadlineAt && it.deadlinePaused && !isTerminal(it)) {
      extras.push('<button class="btn secondary" data-act="resumeDeadline" data-id="' + it.id + '">恢复截止保护</button>');
    }
    $("#detailFoot").innerHTML = extras.join("") + foot;
    openSheet("sheetDetail");
  }

  /* ---------- notes ---------- */
  function openNote(id) {
    state.ui.editNoteId = id || null;
    refreshProjectSelects();
    if (id) {
      const n = state.notes.find(x => x.id === id);
      $("#sheetNoteTitle").textContent = "编辑笔记";
      $("#noteTitle").value = n.title || "";
      $("#noteBody").value = n.body || "";
      $("#noteProject").value = n.projectId || "";
      state.ui.notePin = !!n.pinned;
    } else {
      $("#sheetNoteTitle").textContent = "新建笔记";
      $("#noteTitle").value = "";
      $("#noteBody").value = "";
      $("#noteProject").value = "";
      state.ui.notePin = false;
    }
    $("#swNotePin").classList.toggle("on", state.ui.notePin);
    $("#notePreviewWrap").hidden = true;
    $("#btnNotePreview").textContent = "预览";
    openSheet("sheetNote");
  }

  function saveNote() {
    const title = $("#noteTitle").value.trim() || "无标题";
    const body = $("#noteBody").value.trim();
    const projectId = $("#noteProject").value || "";
    if (state.ui.editNoteId) {
      const n = state.notes.find(x => x.id === state.ui.editNoteId);
      if (n) {
        n.title = title; n.body = body; n.projectId = projectId;
        n.pinned = state.ui.notePin;
        n.updatedAt = Date.now();
      }
    } else {
      state.notes.push({
        id: uid(), title, body, projectId,
        pinned: state.ui.notePin,
        createdAt: Date.now(), updatedAt: Date.now()
      });
    }
    save();
    closeSheet("sheetNote");
    render();
    toast("笔记已保存");
  }

  /* ---------- search ---------- */
  function doSearch(q) {
    q = (q || "").trim().toLowerCase();
    const box = $("#searchResults");
    if (!q) {
      box.innerHTML = '<p style="color:var(--muted);font-size:0.88rem">输入关键词，覆盖 Future、已看到未完成、归档、项目与笔记。</p>';
      return;
    }
    const items = state.items.filter(it =>
      (it.title || "").toLowerCase().includes(q) ||
      (it.note || "").toLowerCase().includes(q) ||
      (it.tags || []).some(t => t.toLowerCase().includes(q)) ||
      (it.url || "").toLowerCase().includes(q)
    );
    const notes = state.notes.filter(n =>
      (n.title || "").toLowerCase().includes(q) || (n.body || "").toLowerCase().includes(q)
    );
    const projects = state.projects.filter(p => (p.name || "").toLowerCase().includes(q));

    box.innerHTML = (items.length || notes.length || projects.length)
      ? (projects.length
          ? '<div class="sec-head"><div class="sec-title">项目</div></div>' +
            projects.map(p => '<div class="note-card"><h3>' + escapeHtml(p.name) + "</h3><p>项目</p></div>").join("")
          : "") +
        items.map(it => renderItemCard(it,
          it.status === "archived" ? "archived" :
          it.status === "acknowledged" ? "active" : "future"
        )).join("") +
        notes.map(n =>
          '<article class="note-card" data-note="' + n.id + '"><h3>' + escapeHtml(n.title) +
          "</h3><p>" + escapeHtml(n.body) + "</p></article>"
        ).join("")
      : '<div class="empty" style="padding:28px 12px"><p>没有找到「' + escapeHtml(q) + "」</p></div>";
  }

  /* ---------- projects ---------- */
  let selectedColor = PROJECT_COLORS[0];
  function renderProjectsSheet() {
    $("#projectsList").innerHTML = state.projects.length
      ? state.projects.map(p => {
          const count = state.items.filter(it => it.projectId === p.id).length;
          return '<div class="note-card" style="display:flex;align-items:center;gap:10px">' +
            '<span style="width:12px;height:12px;border-radius:50%;background:' + escapeHtml(p.color) + ';flex-shrink:0"></span>' +
            '<div style="flex:1"><h3>' + escapeHtml(p.name) + "</h3><p>" + count + " 个事项</p></div>" +
            '<button class="chip" data-del-proj="' + escapeHtml(p.id) + '">删除</button></div>';
        }).join("")
      : '<p style="color:var(--muted);font-size:0.88rem">还没有项目。项目用于轻量归类，不是完整任务管理。</p>';

    $("#projColors").innerHTML = PROJECT_COLORS.map(c =>
      '<button type="button" class="chip' + (c === selectedColor ? " on" : "") + '" data-color="' + c + '" ' +
      'style="min-width:36px;background:' + c + ';border-color:transparent;color:transparent">' + c + "</button>"
    ).join("");
  }

  function addProject() {
    const name = $("#projName").value.trim();
    if (!name) { toast("请输入项目名称"); return; }
    state.projects.push({ id: "p_" + uid(), name, color: selectedColor });
    $("#projName").value = "";
    save();
    renderProjectsSheet();
    refreshProjectSelects();
    toast("已添加项目");
  }

  function deleteProject(id) {
    const affected = state.items.filter(it => it.projectId === id);
    if (affected.some(itemConflictsWithActiveAction)) return rejectPendingItemCommand();
    state.projects = state.projects.filter(p => p.id !== id);
    runUserOp(applyProjectRemovalToItems, [id]);
    state.notes.forEach(n => { if (n.projectId === id) n.projectId = ""; });
    save();
    renderProjectsSheet();
    toast("已删除项目");
    return true;
  }

  function applyProjectRemovalToItems(id) {
    state.items.forEach(it => {
      if (it.projectId !== id) return;
      it.projectId = "";
      bumpRev(it);
    });
    return true;
  }

  /* ---------- notifications ---------- */
  let alertItem = null;
  const dismissedAlerts = Object.create(null);

  function setNativeReminderStatus(status) {
    nativeReminderStatus = Object.assign({}, nativeReminderStatus, status || {});
    if (state.ui.tab === "me") renderPwaStatus();
    // A-2 / D68：首页告知条吃同一份状态，且**不看当前在哪个 tab** ——
    // #homeNotice 始终在 DOM 里，提前写好比等用户切回首页时再算更稳。
    // onResume（从系统设置切回）经 getPermissionState → 这里，
    // 于是「恢复权限后警告自动消失 / 撤销后自动出现」都无需另建通路（基线 §473 后半句）。
    renderHomeNotice();
  }

  function refreshNativeScheduleBasis() {
    if (!NativeReminders.migrateItem) return false;
    let changed = false;
    state.items.forEach(it => {
      if (NativeReminders.migrateItem(it)) changed = true;
    });
    if (changed) save();
    return changed;
  }

  function sameIdSet(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /**
   * F1 / G3：把对账回传的截止事件按**阶段**写回事项的事件表。
   *
   * 关键约束：只有状态真的变化时才 save。此前两个阶段共用一个槽位，
   * 每轮都在 p24 / p2 之间来回覆盖 → changed 永远为真 → 持续写库并触发下一轮对账。
   *
   * 三种状态，语义必须分开（G3）：
   *  · `scheduled` 已请求系统投递、还没有证据 → 保持待定，**不因为时刻过了就算送达**；
   *  · `delivered` 有**真实送达证据**（`markDeadlineDelivered`，来自系统回调）；
   *  · `cancelled` 排程被成功撤销（`cancelledEvents`，来自原生本轮真正取消的排程）
   *    → 重新开启通知后允许补提醒。
   *
   * 之前「当前计划不含某阶段」时仅凭 `at <= now` 就改写为 `delivered`：
   * 排程后关掉通知、或撤销成功，越过原计划时刻再开启，这条**已被取消**的记录会被
   * 当成已送达，`buildDesired` 随后直接排除该阶段 —— 用户永远收不到这次保护提醒。
   *
   * @param {Array} events 本轮计划中的截止事件（已排程）
   * @param {number} now
   * @param {Array} cancelledEvents 本轮被原生确认撤销的截止排程（可选）
   */
  function applyDeadlineEvents(events, now, cancelledEvents) {
    const planned = new Map();
    (events || []).forEach(ev => {
      if (!ev || !ev.itemId || !ev.stageKey) return;
      if (!planned.has(ev.itemId)) planned.set(ev.itemId, new Map());
      planned.get(ev.itemId).set(ev.stageKey, Number(ev.at));
    });
    // G3：本轮原生**确认撤销**的排程，按事项分组
    const cancelledKeys = new Map();
    (cancelledEvents || []).forEach(ev => {
      if (!ev || !ev.itemId || !ev.stageKey) return;
      if (!cancelledKeys.has(ev.itemId)) cancelledKeys.set(ev.itemId, new Set());
      cancelledKeys.get(ev.itemId).add(ev.stageKey);
    });
    let changed = false;
    const targetItemIds = new Set(planned.keys());
    cancelledKeys.forEach((_v, itemId) => targetItemIds.add(itemId));
    state.items.forEach(it => {
      if (it && it.deadlineEvents && typeof it.deadlineEvents === "object") {
        targetItemIds.add(it.id);
      }
    });
    targetItemIds.forEach(itemId => {
      const it = state.items.find(x => x.id === itemId);
      if (!it) return;
      const stages = planned.get(itemId) || new Map();
      const cancelled = cancelledKeys.get(itemId) || null;
      const dl = Number(it.deadlineAt) || 0;
      const prev = it.deadlineEvents && typeof it.deadlineEvents === "object" ? it.deadlineEvents : {};
      const next = {};
      const keep = (key, value) => { next[key] = value; };
      // 1) 本轮计划中的阶段：以原生回传的**实际排程时刻**为准
      stages.forEach((at, stageKey) => {
        if (!dl || String(stageKey).indexOf("@" + dl) < 0) return; // 只保留属于当前截止时间的阶段
        const old = prev[stageKey];
        // 已送达是终态：真实送达证据不能被后续对账抹掉
        if (old && typeof old === "object" && old.state === "delivered") { keep(stageKey, old); return; }
        keep(stageKey, { at: at, state: "scheduled" });
      });
      // 2) 保留当前截止时间下已有的历史记录
      Object.keys(prev).forEach(stageKey => {
        if (next[stageKey]) return;
        if (!dl || String(stageKey).indexOf("@" + dl) < 0) return;
        const old = prev[stageKey];
        if (!old || typeof old !== "object") return;
        if (old.state === "delivered" || old.state === "cancelled") { keep(stageKey, old); return; }
        const at = Number(old.at) || 0;
        // 只有「原生确认撤销」且撤销发生在**投递时刻之前**才算撤销：
        // 若已越过投递时刻，无法判定是否已经送达，保持待定（不补发、也不谎报送达）
        if (at > now && cancelled && cancelled.has(stageKey)) {
          keep(stageKey, { at: at, state: "cancelled" });
          return;
        }
        keep(stageKey, old);
      });
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        if (Object.keys(next).length > 0) {
          it.deadlineEvents = next;
        } else {
          delete it.deadlineEvents;
        }
        changed = true;
      }
    });
    if (changed) save();
    return changed;
  }

  /**
   * D43：单次提醒台账 —— 与 `applyDeadlineEvents` **同构**，只是键从「阶段@截止时刻」
   * 换成「尝试序号@原定触发点」。
   *
   * 为什么要这一层：投影只排**严格未来**的触发点，于是「触发点已过、事项仍活跃」的提醒
   * 拿不到原生通知（用户少一条提醒）；而补投必须能回答「这个触发点是否已经消费过」，
   * 否则每次对账都会再补一次。三态语义与截止台账逐字对齐（见 applyDeadlineEvents 注释）。
   *
   * 键里带的是**原定触发点**而不是补投时刻：身份必须跨对账稳定，否则每轮都换一个身份
   * → 撤销/重排循环（这正是 R6 注释警告过的形态）。
   */
  function applyReminderEvents(events, now, cancelledEvents) {
    const planned = new Map();
    (events || []).forEach(ev => {
      if (!ev || !ev.itemId || !ev.key) return;
      if (!planned.has(ev.itemId)) planned.set(ev.itemId, new Map());
      planned.get(ev.itemId).set(ev.key, Number(ev.at));
    });
    const cancelledKeys = new Map();
    (cancelledEvents || []).forEach(ev => {
      if (!ev || !ev.itemId || !ev.key) return;
      if (!cancelledKeys.has(ev.itemId)) cancelledKeys.set(ev.itemId, new Set());
      cancelledKeys.get(ev.itemId).add(ev.key);
    });
    let changed = false;
    const targetItemIds = new Set(planned.keys());
    cancelledKeys.forEach((_value, itemId) => targetItemIds.add(itemId));
    state.items.forEach(it => {
      if (it && it.reminderEvents && typeof it.reminderEvents === "object" &&
        Object.keys(it.reminderEvents).length > 0) targetItemIds.add(it.id);
    });
    targetItemIds.forEach(itemId => {
      const it = state.items.find(x => x.id === itemId);
      if (!it) return;
      const keys = planned.get(itemId) || new Map();
      const cancelled = cancelledKeys.get(itemId) || null;
      const base = Number(it.triggerAt) || 0;
      const prev = it.reminderEvents && typeof it.reminderEvents === "object" ? it.reminderEvents : {};
      const next = {};
      const keep = (key, value) => { next[key] = value; };
      // 1) 本轮计划中的触发点：以原生回传的**实际排程时刻**为准（补投时那是 now+2s）
      keys.forEach((at, key) => {
        if (!base || !reminderKeyInTriggerRange(key, base)) return;
        const old = prev[key];
        // 已送达是终态：真实送达证据不能被后续对账抹掉
        if (old && typeof old === "object" && old.state === "delivered") { keep(key, old); return; }
        keep(key, { at: at, state: "scheduled" });
      });
      // 2) 保留当前触发起点下的已有记录
      Object.keys(prev).forEach(key => {
        if (next[key]) return;
        if (!base || !reminderKeyInTriggerRange(key, base)) return;
        const old = prev[key];
        if (!old || typeof old !== "object") return;
        if (old.state === "delivered" || old.state === "cancelled") { keep(key, old); return; }
        const at = Number(old.at) || 0;
        // 只有「原生确认撤销」且撤销发生在**投递时刻之前**才算撤销：
        // 越过投递时刻后无法判定是否已经送达，保持待定（不补发、也不谎报送达）
        if (at > now && cancelled && cancelled.has(key)) {
          keep(key, { at: at, state: "cancelled" });
          return;
        }
        keep(key, old);
      });
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        if (Object.keys(next).length > 0) {
          it.reminderEvents = next;
        } else {
          delete it.reminderEvents;
        }
        changed = true;
      }
    });
    if (changed) save();
    return changed;
  }

  /**
   * D43：只保留属于**当前触发起点**的记录（`>= triggerAt`）。
   *
   * 与截止台账按 `@<deadlineAt>` 过滤同一思路：用户把触发时间往后改了，旧承诺的消费记录
   * 就该作废；保留它们只会让台账无限增长并让「已排期」永久钉住新触发点。
   * 用 `>=` 而不是 `===`：勿扰顺延会让首期触发点晚于 `triggerAt`（见 effectiveTriggerAt）。
   */
  function reminderKeyInTriggerRange(key, triggerAt) {
    const at = Number(String(key).split("@")[1]);
    return Number.isFinite(at) && at >= triggerAt;
  }

  /** F1：系统送达回调 —— 真实的送达证据，直接标记 delivered */
  function markDeadlineDelivered(event) {
    if (!event || !event.itemId || !event.stageKey) return false;
    const it = state.items.find(x => x.id === event.itemId);
    if (!it) return false;
    if (!it.deadlineEvents || typeof it.deadlineEvents !== "object") it.deadlineEvents = {};
    const old = it.deadlineEvents[event.stageKey];
    if (old && old.state === "delivered") return false;
    it.deadlineEvents[event.stageKey] = {
      at: old && Number(old.at) ? Number(old.at) : Date.now(),
      state: "delivered"
    };
    save();
    return true;
  }

  async function syncNativeRemindersNow() {
    if (!nativeReady || !NativeReminders.reconcile) return nativeReminderStatus;
    try {
      // P0-1：把待整理队列并进同一次对账（原生侧据此预排 LocalNotifications）
      const review = {
        count: needsReviewItems().length,
        settings: ensureReviewSettings()
      };
      const status = await NativeReminders.reconcile(state.items, state.settings, Date.now(), review);
      setNativeReminderStatus(status);
      // V03 / F1 / G3：把本轮已排的截止事件按阶段记账；
      // 同时把本轮**被撤销**的排程记成 cancelled（撤销 ≠ 送达）
      if (status && Array.isArray(status.deadlineEvents)) {
        applyDeadlineEvents(status.deadlineEvents, Date.now(), status.cancelledDeadlineEvents);
      }
      // D43：单次提醒台账（与截止台账同构）—— 没有它，触发点已过的事项每轮对账都会重复补投
      if (status && Array.isArray(status.reminderEvents)) {
        applyReminderEvents(status.reminderEvents, Date.now(), status.cancelledReminderEvents);
      }
      // P0-2：记住本轮排下的全屏闹钟 id，供下一轮撤销不再需要的闹钟。
      // 仅在集合真变化时 save()，否则 save → queue → reconcile 会自激成死循环。
      if (status && Array.isArray(status.scheduledAlarmIds) &&
        !sameIdSet(state.settings.scheduledAlarmIds, status.scheduledAlarmIds)) {
        state.settings.scheduledAlarmIds = status.scheduledAlarmIds;
        save();
      }
      return status;
    } catch (error) {
      const status = { reliability: "error", error: error && error.message ? error.message : String(error) };
      setNativeReminderStatus(status);
      return status;
    }
  }

  /**
   * Q6：确保原生提醒链路就绪 —— 幂等、可重试、不阻塞。
   *
   * **这是「关掉 App 就不响」的根治点。**
   *
   * Capacitor 的 `window.Capacitor` 由原生 WebView 注入，而 index.html **不加载
   * capacitor.js**；`init()` 又在 DOMContentLoaded 就跑。二者之间存在稳定的时间差：
   * 实测本机模拟器上，init() 执行时 window.Capacitor 还是 undefined，
   * 六秒后才 7 个插件齐全。
   *
   * 旧实现在这个时间差上**永久放弃**（开头一句 `if (!isNativeAndroid()) return`，
   * 且 nativeReady 再也没机会变 true）。由于 queueNativeReminderSync 的首行守卫是
   * `if (!nativeReady) return`，整场会话的**每一次对账都被丢掉** —— 一条排程都不落。
   * 而 tick() 的应用内提醒不依赖原生，于是现象精确地表现为：
   * 「打开 App 有提醒，关掉 App 什么都不响」。
   *
   * 现在：桥晚到就等，等不到就留可见记录，之后任何一次同步请求都会**再试一遍**。
   */
  function ensureNativeReminders() {
    if (nativeReady) return Promise.resolve(true);
    if (nativeInitPromise) return nativeInitPromise;
    nativeInitPromise = initializeNativeReminders()
      .then(() => !!nativeReady)
      .catch(error => {
        console.error("Native reminders init failed:",
          error && error.message ? error.message : error);
        return false;
      })
      .then(ok => {
        nativeInitPromise = null; // 允许下一次重试
        return ok;
      });
    return nativeInitPromise;
  }

  function queueNativeReminderSync() {
    if (!NativeReminders.reconcile) return;
    if (!nativeReady) {
      // Q6：桥可能只是晚到 —— 不要丢弃这次请求。
      // 补做初始化；成功后自己会再同步一次（下面的递归调用）。
      ensureNativeReminders().then(ok => { if (ok) queueNativeReminderSync(); });
      return;
    }
    if (nativeSyncTimer) clearTimeout(nativeSyncTimer);
    nativeSyncTimer = setTimeout(() => {
      nativeSyncTimer = null;
      syncNativeRemindersNow();
    }, 80);
  }

  async function handleNativeNotificationAction(event) {
    if (!event) return;
    // D20：待整理通知点击直达整理会话
    if (event.itemId === "review-session" || event.managedKind === "review-session") {
      // L06 / V0.2 §9.3：动作语义 = 开始整理 / 稍后 30 分钟 / 今天跳过，
      // 通知上的标签与这里执行的效果必须一一对应。
      if (event.action === "review_snooze") {
        snoozeReview(30 * 60 * 1000, "30 分钟");
        return;
      }
      if (event.action === "review_skip") {
        skipReviewThisTime();
        return;
      }
      // review_start / tap / 旧版本动作（ack、done）一律进入会话
      openReviewSession();
      return;
    }
    if (!event.itemId) return;
    const id = event.itemId;
    const it = state.items.find(x => x.id === id);
    if (!it) return;
    // L04 / F5：改状态的动作必须有**可知且匹配**的版本。
    // 版本未知时只允许打开详情 —— 把「未知」当有效匹配会让旧通知覆盖改期后的当前状态。
    if (event.action !== "tap") {
      if (!hasKnownRev(event.itemRev) || Number(it.rev || 0) !== Number(event.itemRev)) {
        toast(event.itemRev == null || event.itemRev === ""
          ? "无法确认这条提醒是否为最新 · 请在应用内处理"
          : "这条提醒已过期 · 未作改动");
        return;
      }
    }
    if (event.action === "ack") {
      hideAlert();
    } else if (event.action === "snooze") {
      hideAlert();
    } else if (event.action === "done") {
      hideAlert();
    } else {
      openDetail(id);
      return;
    }
    const notificationId = event.notification && event.notification.id != null
      ? String(event.notification.id) : "unknown";
    // 通知栏与全屏闹钟共用同一隔离/持久化/事件幂等边界。
    return handleAlarmAction({
      action: event.action,
      itemId: id,
      itemRev: event.itemRev,
      alarmEventId: notificationId === "unknown"
        ? ""
        : "notification:" + notificationId + ":" + event.action + ":" + event.itemRev
    });
  }

  /** L04：同一事件重复投递的短窗口去重（系统重发 / 冷启动重复消费） */
  const recentAlarmActions = Object.create(null);
  const ALARM_ACTION_DEDUP_MS = 5000;

  /**
   * F2：已处理过的原生事件 id（持久化）。
   * 崩溃重放时靠它跳过**已经落库**的操作；与 5 秒内存去重互补 ——
   * 内存去重只防系统重发，事件 id 才防「已提交却被重放」。
   */
  const ALARM_EVENT_LOG_LIMIT = 50;
  /**
   * 单调递增的记账时刻。
   *
   * 事件 id 可能来自原生（数字型字符串），而 JS 对象对「整数型键」会按数值升序排列，
   * 不再保持插入顺序；同时整套动作可能在**同一毫秒**内完成。
   * 若直接按 `Date.now()` 排序裁剪，刚写入的那条可能被排进「最旧」的一批而被立刻删掉 ——
   * 于是崩溃重放保护失效，同一个事件会被处理两次（重复 ACK / 重复派生下一期）。
   */
  let alarmEventClock = 0;
  function alarmEventSeen(id) {
    if (!id) return false;
    const log = state.settings.alarmEventLog;
    return !!(log && typeof log === "object" && log[id]);
  }
  function rememberAlarmEvent(id) {
    if (!id) return;
    if (!state.settings.alarmEventLog || typeof state.settings.alarmEventLog !== "object") {
      state.settings.alarmEventLog = {};
    }
    const log = state.settings.alarmEventLog;
    const stamp = Math.max(Date.now(), alarmEventClock + 1);
    alarmEventClock = stamp;
    log[id] = stamp;
    const keys = Object.keys(log);
    if (keys.length > ALARM_EVENT_LOG_LIMIT) {
      keys.sort((a, b) => log[a] - log[b]);
      keys.slice(0, keys.length - ALARM_EVENT_LOG_LIMIT).forEach(k => { delete log[k]; });
    }
  }

  /* ---------- 原生动作的隔离草稿事务 ---------- */

  function clonePayload(payload) {
    return JSON.parse(JSON.stringify(payload || currentPayload()));
  }

  /** 在一个不可见草稿上同步执行 reducer；JS 单线程保证引用切换不会被其它事件打断。 */
  function withDraftState(draft, job) {
    const live = {
      items: state.items,
      notes: state.notes,
      projects: state.projects,
      settings: state.settings
    };
    state.items = draft.items;
    state.notes = draft.notes;
    state.projects = draft.projects;
    state.settings = draft.settings;
    try {
      return job();
    } finally {
      // reducer 可能用 filter/导入等方式替换数组引用，必须把新引用收回草稿。
      draft.items = state.items;
      draft.notes = state.notes;
      draft.projects = state.projects;
      draft.settings = state.settings;
      state.items = live.items;
      state.notes = live.notes;
      state.projects = live.projects;
      state.settings = live.settings;
    }
  }

  /**
   * 事务成功后才发布草稿。动作只拥有 items 与 alarmEventLog；其它 settings/notes/projects
   * 继续使用可见状态，避免覆盖提交等待期间的无关设置写入。
   */
  function publishActionDraft(draft) {
    const liveById = new Map(state.items.map(item => [item.id, item]));
    state.items = draft.items.map(committed => {
      const live = liveById.get(committed.id);
      if (!live) return committed;
      Object.keys(live).forEach(key => {
        if (!(key in committed)) delete live[key];
      });
      Object.keys(committed).forEach(key => { live[key] = committed[key]; });
      return live;
    });
    state.settings.alarmEventLog = JSON.parse(JSON.stringify(draft.settings.alarmEventLog || {}));
  }

  /**
   * G1：**提交中**的闹钟事件（事件 id → 提交 Promise）。
   *
   * 之前同一个事件被并发消费时，第二个调用看到内存里的「已见过」标记就立刻返回成功，
   * 调用方（原生队列 drain）据此确认删除原生事件 —— 而此时第一次提交还在路上。
   * 提交一旦失败，这条动作就永久丢了。现在改为复用同一个提交 Promise：
   * 只有**真的落库完成**才算处理过，失败则两个调用一起失败、原生事件保留待重试。
   */
  const inflightAlarmActions = new Map();

  /**
   * 全屏闹钟四动作（D11/D12）：ack / snooze / done / close（close 不写 ACK）。
   * L04：终态保护（已完成事项不接受旧动作）+ 版本校验 + 事件去重，
   *      同一条完成事件最多推进一次周期。
   * G1：同一事件并发消费必须落到**同一次提交**上。
   * 返回持久化 Promise：调用方（原生队列的 drain）**必须**等它完成再确认删除事件。
   */
  async function handleAlarmAction(data) {
    const action = data && (data.action || data.actionId);
    const itemId = data && (data.itemId || data.item_id);
    if (!action) return;
    if (action === "close") {
      hideAlert();
      return;
    }
    if (!itemId) return;
    const eventId = data && data.alarmEventId ? String(data.alarmEventId) : "";
    if (eventId) {
      // 顺序有意为之：**先看提交中，再看已落库**。
      // 台账条目是与状态变更同一次写入的，所以在提交落地之前它已经在内存里了；
      // 若先查台账，并发到达的第二个调用会被这个内存标记骗成「已处理过」而立刻返回成功。
      const inflight = inflightAlarmActions.get(eventId);
      if (inflight) return inflight;      // 提交中：复用同一次提交
      if (alarmEventSeen(eventId)) return; // 已落库：幂等重放，直接跳过
    }
    const running = performAlarmAction(data, action, itemId, eventId);
    if (eventId) {
      inflightAlarmActions.set(eventId, running);
      const release = () => {
        if (inflightAlarmActions.get(eventId) === running) inflightAlarmActions.delete(eventId);
      };
      running.then(release, release); // 失败也要释放，否则该事件永远无法重试
    }
    return running;
  }

  /** 整笔原生动作是一个闸门任务；权威提交成功前，草稿不发布到可见 state。 */
  async function performAlarmAction(data, action, itemId, eventId) {
    // 注意：这里**没有**任何先于队列的状态变更 —— 全部在闸门任务内完成
    return runCommit(() => applyAlarmAction(data, action, itemId, eventId));
  }

  async function applyAlarmAction(data, action, itemId, eventId) {
    const it = state.items.find(x => x.id === itemId);
    if (!it) return;
    const terminal = isTerminal(it);
    if (!terminal && (!hasKnownRev(data.itemRev) || Number(it.rev || 0) !== Number(data.itemRev))) {
      toast(data.itemRev == null || data.itemRev === ""
        ? "无法确认这条提醒是否为最新 · 请在应用内处理"
        : "这条提醒已过期 · 未作改动");
      openDetail(itemId);
      return;
    }
    const now = Date.now();
    Object.keys(recentAlarmActions).forEach(k => {
      if (now - recentAlarmActions[k] > ALARM_ACTION_DEDUP_MS) delete recentAlarmActions[k];
    });
    const key = itemId + "|" + action;
    if (recentAlarmActions[key] && now - recentAlarmActions[key] < ALARM_ACTION_DEDUP_MS) {
      return;
    }

    const previousScope = activeActionScope;
    activeActionScope = { itemId: it.id, seriesId: it.seriesId || null };
    try {
    // 草稿从「轮到本动作时的已确认可见状态」复制；动作 reducer 不碰共享 state。
    const draft = clonePayload(currentPayload());
    const prevSave = suppressInnerSave;
    const prevFeedback = suppressUserFeedback;
    const prevApplyingDraft = applyingActionDraft;
    suppressInnerSave = true;
    suppressUserFeedback = true;
    applyingActionDraft = true;
    try {
      withDraftState(draft, () => {
        if (eventId) rememberAlarmEvent(eventId);
        if (terminal) return;
        if (action === "ack") ackItem(itemId, true);
        else if (action === "snooze") snoozeItem(itemId, Date.now() + 2 * 3600000);
        else if (action === "done") completeItem(itemId);
      });
    } finally {
      applyingActionDraft = prevApplyingDraft;
      suppressUserFeedback = prevFeedback;
      suppressInnerSave = prevSave;
      // reducer 内部可能调用 render；在让出事件循环前恢复最后确认状态的 DOM。
      render();
    }

    let userOps = [];
    pendingUserOps = [];
    inflightActionDepth++;
    try {
      // IndexedDB 是唯一权威；提交前不发布草稿，也不按未提交草稿对账原生排程。
      await writeSnapshot(draft, { deferNativeSync: true });
    } catch (error) {
      delete recentAlarmActions[key];
      throw error;
    } finally {
      inflightActionDepth--;
      userOps = pendingUserOps;
      pendingUserOps = [];
    }

    // 提交等待期间的命令原先作用在最后确认状态上；现在按原顺序重放到已提交草稿。
    // 重放失败不是可忽略分支：用可见状态做补偿写并向外报错，原生事件不提前确认。
    try {
      withDraftState(draft, () => replayUserOps(userOps));
    } catch (replayError) {
      try {
        await writeSnapshot(currentPayload(), { deferNativeSync: true });
      } catch (compensationError) {
        replayError.compensationError = compensationError;
      }
      delete recentAlarmActions[key];
      throw replayError;
    }

    publishActionDraft(draft);
    recentAlarmActions[key] = now;
    queueNativeReminderSync();
    render();
    if (terminal) toast("该事项已完成 · 本次提醒已忽略");
    else if (action === "ack") toast("已确认看到 · 仍保持未完成");
    else if (action === "snooze") {
      const committed = state.items.find(x => x.id === itemId);
      toast(committed ? "已改到 " + fmtTime(committed.triggerAt) : "提醒操作已保存 · 后续删除也已保留");
    }
    else if (action === "done") toast(it.repeat ? "已完成 · 下一周期已生成" : "已完成并归档");
    return true;
    } finally {
      activeActionScope = previousScope;
    }
  }

  function systemBridge() {
    if (NativeReminders.systemBridge) return NativeReminders.systemBridge();
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SystemBridge
      ? window.Capacitor.Plugins.SystemBridge
      : null;
  }

  /**
   * Q6：当前跑在安卓原生容器里（**不看插件是否已注册**）。
   *
   * 修的是既有缺陷：本函数此前被 3 处调用（精确闹钟 / 通知设置 / 电池优化三个跳转入口）
   * 却**从未定义** —— 点下去直接 ReferenceError，而被点到的只是设置跳转，
   * 现场看起来就是「点了没反应」。判断只看平台，恰好就是那三处需要的语义。
   */
  function isNativeAndroidRuntime() {
    const cap = window.Capacitor;
    if (!cap) return false;
    const platform = typeof cap.getPlatform === "function" ? cap.getPlatform() : cap.platform;
    return platform === "android";
  }

  /**
   * Q6：等原生桥就绪，最多等 timeoutMs。
   *
   * index.html **不加载 capacitor.js** —— window.Capacitor 完全由原生 WebView 注入，
   * 注入完成的时刻不由我们控制。init() 若跑在注入之前，isNativeAndroid() 会返回 false，
   * 而 initializeNativeReminders 开头那句 `if (!isNativeAndroid()) return` 是**静默**的：
   * nativeReady 永远为 false，queueNativeReminderSync 的守卫随即让整场会话一次对账都不跑。
   * 表现就是「打开 App 有应用内提醒（tick 不依赖原生），关掉后一条排程都没有」。
   */
  function waitForNativeBridge(timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 3000);
    return new Promise(resolve => {
      (function check() {
        if (NativeReminders.isNativeAndroid && NativeReminders.isNativeAndroid()) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(check, 50);
      })();
    });
  }

  function appSettingsPlugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AppSettings
      ? window.Capacitor.Plugins.AppSettings
      : null;
  }

  async function diagnoseSystemBridge() {
    const bridge = systemBridge();
    if (!bridge || !bridge.diagnose) {
      return { available: false, reason: "SystemBridge 插件未加载" };
    }
    try {
      const d = await bridge.diagnose();
      return Object.assign({ available: true }, d);
    } catch (error) {
      return { available: false, reason: error && error.message ? error.message : String(error) };
    }
  }

  function setPill(el, text, ok, warn) {
    if (!el) return;
    el.textContent = text;
    el.className = "pill " + (ok ? "time" : warn ? "warn" : "crit");
  }

  function labLog(msg) {
    const el = $("#labLog");
    if (!el) return;
    el.textContent = "[" + fmtTime(Date.now()) + "] " + msg;
  }

  /**
   * Q3 / V2：把原生回读的那条记录翻成人话。
   *
   * 「尝试投递」是闹钟到点、广播收到了；「界面显示出来」是 AlarmActivity 真的到了用户眼前。
   * 只有前者没有后者 ⇒ 界面没能送到眼前 —— 而两者在手机上的表现一模一样（都只是响一声），
   * 所以必须靠台账分辨。
   *
   * ⚠️ V2 教训：归因**必须靠证据，不能靠猜权限**。
   * 此前这里是 `if (d.locked) → "缺「全屏通知」权限"`，而真机上该权限明明是 granted、
   * 同一面板上一行还写着「全屏 OK」。结果把用户引去反复授权一个已经给了的权限 ——
   * 这正是「反复报障却总也修不好」的直接来源。现在按「这次投递走的哪条路 + 缺哪项能力」
   * 逐步归因；权限齐备却仍没弹出时，如实说「系统没有展示」，不编原因。
   */
  function describeAlarmDelivery(d) {
    if (!d || !d.attempted) {
      return { text: "还没有投递记录", label: "—", ok: false, warn: true };
    }
    const when = d.at ? fmtTime(d.at) : "—";
    // D64：精确闹钟降级是**排程层**的事实，与「屏幕有没有载体」正交。
    // 它会让「到达时刻」本身就不准，而用户很容易把这理解成界面/通知的问题，
    // 于是去反复授权无关的权限 —— 所以只要这次投递不是精确排程，就在归因里说出来。
    // 放在函数前部是因为「无通知权限」那条早返回分支同样需要它。
    // 缺键（老 APK 记录）按「精确」处理，不凭空指控。
    const exactNote = d.exactAtDelivery === false
      ? " · 本次为「非精确」排程（缺「闹钟和提醒」权限），到达时刻可能被系统推迟"
      : "";
    // V1：可见判据与原生一致 —— 窗口可见（visible）或获得焦点（shownAt ≥ 本次投递时刻）
    const visible = !!d.visible || (!!d.shownAt && d.shownAt >= d.at);
    if (visible) {
      return { text: "闹钟界面已经显示出来 · " + when, label: "已显示", ok: true, warn: false };
    }
    // D59（2026-09-19）：这一格解释的是「**屏幕**没有载体」，不再是「整个闹钟哑了」。
    //
    // `setFullScreenIntent` 是 Notification 的属性（AlarmTestReceiver），通知发不出去
    // （Android 13+ 未授予 POST_NOTIFICATIONS 时 `notify()` 是静默空操作）系统就不会替我们
    // 全屏，直起也常被 BAL 静默拦下。2026-09-18 vivo 真机：无权限 + 息屏 **0/4**，有权限 **2/2**。
    //
    // 但 D59 把声音与振动的所有权收回 AlarmRingService（前台服务自播）之后，
    // **通知权限只影响屏幕这一格** —— 铃声与振动照常。旧文案没有这层限定，
    // 读起来像「整个闹钟都哑了」，于是把「响了但没亮屏」反着报成「完全静默」，
    // 而那恰恰就是本轮要修的那个误诊。所以文案必须跟着载体台账一起说。
    //
    // 严格的 `=== false`：老版本 APK 写下的记录没有这个键（读回默认 true），
    // 不能让它在升级后凭空变成「无通知权限」。
    if (d.notifyEnabledAtDelivery === false) {
      // 载体台账（D59）：把「到底响没响」与「亮没亮」分开回答。
      // 老 APK 的读回里没有这些键 → 一律按「未上报」处理，不编造结论。
      const carrierKnown = d.carrierSound === "native" || d.carrierSound === "activity";
      const carrierText =
        d.carrierSound === "native" ? "铃声与振动已由前台服务接管"
        : d.carrierSound === "activity" ? "铃声与振动由界面回落自播"
        : d.carrierSound === "none" ? "本次没有任何载体在响（前台服务与界面都没起来）"
        : "铃声与振动不依赖通知权限";
      return {
        text: "投递时系统通知是关闭的 · 全屏闹钟没有载体（系统不会展示界面）· "
          + carrierText + exactNote + " · " + when,
        label: carrierKnown ? "已响未亮" : "无通知权限",
        ok: false,
        warn: true
      };
    }
    // Q5：解锁时正在通话/响铃 → 只响铃不抢屏，这是设计如此，不是故障
    if (d.inCall && !d.locked) {
      return { text: "通话中 · 只响铃不抢屏（按设计）· " + when, label: "通话中", ok: false, warn: true };
    }
    // 投递当时的现场值优先（now 的权限可能后来被改过，不能用来解释当时的结果）
    //
    // D64：这三项都必须优先用**投递当时**的快照。
    //   · `overlayAtDelivery` / `fsiAtDelivery` 是原生在投递瞬间落盘的
    //     （`AlarmTestReceiver.recordAttempt`），只有它具备解释力；
    //   · 回退到 `d.canDrawOverlays` / `d.canUseFullScreenIntent` 仅为兼容老 APK 写下的记录 ——
    //     那两个是**活值**，表达的是「现在」。用现在解释当时，会在用户事后改过权限时
    //     把结论整个反转（H-08 就是被同类的「用现在解释当时」误诊过）。
    const overlayAt = d.overlayAtDelivery !== undefined ? !!d.overlayAtDelivery : !!d.canDrawOverlays;
    const fsiAt = d.fsiAtDelivery !== undefined
      ? d.fsiAtDelivery !== false
      : d.canUseFullScreenIntent !== false;
    // V3：锁屏/息屏走系统全屏意图（系统会真的全屏）；解锁亮屏只能直起界面（需 BAL 豁免）
    const background = !!d.locked || d.screenOn === false;
    let reason;
    if (background) {
      reason = fsiAt
        ? "权限齐备，但系统没有展示这次全屏 · 请检查「后台与锁屏设置」中的锁屏显示"
        : "缺「全屏通知」权限 · 锁屏/息屏只能出横幅";
    } else if (!overlayAt) {
      reason = "缺「显示在其他应用上层」· 解锁亮屏下后台启动界面被系统拦下";
    } else {
      reason = "权限齐备，但界面没有被系统展示 · 请检查后台运行及界面显示限制";
    }
    return {
      text: "未确认显示全屏 · " + when + " · " + reason + exactNote,
      label: "仅通知", ok: false, warn: false
    };
  }

  /**
   * Q6：把「关掉 App 后到底会不会响」算成一句人话。
   *
   * 此前「排程是否真的落在系统里」只存在于 nativeReminderStatus，界面上一个字都不显示，
   * 于是「不响」永远是黑盒：用户只能反复试，排查只能靠猜。
   * 这里把链路三段逐个验一遍，**第一个断掉的环节直接说出来**：
   *   ① 原生对账有没有跑过（nativeReady 为 false 时整条链静默跳过）
   *   ② 总开关 + 系统通知权限（两者缺一，reconcile 不只不排，还会撤销已排的）
   *   ③ 系统里实际挂着几条（getPending 的实数，而不是「打算排几条」）
   */
  async function renderBackgroundVerdict(diag, delivery) {
    const subBg = $("#labBackground");
    const subSched = $("#labScheduled");
    const elVerdict = $("#labVerdict");
    const s = nativeReminderStatus || {};
    const notifyOn = !!state.settings.notify;
    const granted = !!(diag && diag.notificationsEnabled && diag.postNotificationsGranted);

    // V2：「排了」不等于「会响」，更不等于「会可见」。上一次投递的真实结局必须参与结论，
    // 否则「系统里挂了 10 条」会被读成「一切正常」—— 这正是过度承诺的来源。
    const d = delivery || null;
    const lastVisible = !!(d && d.attempted) &&
      (!!d.visible || (!!d.shownAt && d.shownAt >= d.at));
    const lastHidden = !!(d && d.attempted) && !lastVisible;

    // 系统里**实际挂着**的条数。这是唯一能证明排程真的落进了系统的证据：
    // nativeReminderStatus.desired 只是「我打算排几条」，排程失败时它照样是个正数。
    let pending = null;
    try {
      const ln = window.Capacitor && window.Capacitor.Plugins
        ? window.Capacitor.Plugins.LocalNotifications : null;
      if (ln && ln.getPending) {
        const r = await ln.getPending();
        if (r && Array.isArray(r.notifications)) pending = r.notifications.length;
      }
    } catch (error) {}

    const desired = Number(s.desired) || 0;
    const alarmCount = Number(s.alarmCount) || 0;
    let text, label, ok, warn;

    if (s.enabled === undefined) {
      // 最隐蔽的一种：initializeNativeReminders 在启动时就 return 了，
      // 于是 queueNativeReminderSync 的 nativeReady 守卫永远为 false —— 一次对账都没跑过。
      text = "原生对账从未执行（启动时原生桥尚未就绪）· 关掉 App 后不会有任何提醒。请完全退出后重开应用。";
      label = "未执行"; ok = false; warn = false;
    } else if (!notifyOn) {
      text = "总开关未开 · 关掉 App 后不会有任何提醒。请打开「设置 → 本地通知」。";
      label = "未开启"; ok = false; warn = true;
    } else if (!granted) {
      text = "系统通知权限未授予 · 关掉 App 后不会有任何提醒。请点上面的「1. 申请通知权限」。";
      label = "权限缺失"; ok = false; warn = true;
    } else if (s.reliability === "error") {
      text = "原生对账失败 · 提醒可能不会按时到达：" +
        ((s.errors && s.errors[0]) || "未知原因");
      label = "对账异常"; ok = false; warn = false;
    } else if (pending == null) {
      text = "无法读取系统排程 · 请刷新诊断后重试，不能据此判断后台提醒已就绪。";
      label = "未知"; ok = false; warn = true;
    } else if (pending === 0 && desired > 0) {
      text = "对账要求排 " + desired + " 条，系统里却是 0 条 · 排程没有落地。请点「立即重排后台提醒」。";
      label = "零排程"; ok = false; warn = false;
    } else if (pending === 0) {
      text = "系统里当前没有待发的提醒（当前也没有需要提醒的事项）。";
      label = "待命中"; ok = true; warn = false;
    } else {
      text = "系统里已挂 " + pending + " 条提醒（全屏闹钟 " + alarmCount + " 条）· 排程已登记，仍需确认后台耗电、自启动和锁屏显示，并完成息屏测试。";
      label = "已排程"; ok = false; warn = true;
      // V2：排程落地只证明登记成功，不证明会投递或可见。上一次投递若没能把界面送到眼前，
      // 这里的结论必须降级，不能继续写「关掉也不影响」这种无条件承诺。
      if (lastHidden) {
        text = "排程已经落到系统里（" + pending + " 条），但上一次到点没能把界面弹出来 —— 见上面「投递」一行。";
        label = "有保留"; ok = false; warn = true;
      }
    }

    if (subBg) subBg.textContent = text;
    setPill($("#labBackgroundPill"), label, ok, warn);
    if (subSched) {
      subSched.textContent = pending == null
        ? "无法读取（原生桥不可用）"
        : pending + " 条待发" + (desired > 0 ? " · 本轮计划 " + desired + " 条" : "");
    }
    setPill($("#labScheduledPill"), pending == null ? "未知" : (pending ? pending + " 条" : "0 条"),
      pending != null && pending > 0, pending == null || pending === 0);
    if (elVerdict) {
      elVerdict.hidden = false;
      elVerdict.textContent = (ok ? "✅ " : "⚠️ ") + text;
      elVerdict.style.color = ok ? "#1b6b4a" : "#8f3a3a";
      elVerdict.style.background = ok ? "#e8f4ee" : "#f6e8e8";
    }
    return { text, label, ok, warn, pending, desired };
  }

  async function refreshNotifyLab() {
    if (!$("#sheetNotifyLab")) return;
    const cap = window.Capacitor;
    const platform = cap && cap.getPlatform ? cap.getPlatform() : (cap && cap.platform) || "unknown";
    const hasLN = !!(cap && cap.Plugins && cap.Plugins.LocalNotifications);
    const hasSB = !!(cap && cap.Plugins && cap.Plugins.SystemBridge);
    const bridgeSub = $("#labBridge");
    if (bridgeSub) {
      bridgeSub.textContent = "平台 " + platform +
        " · LocalNotifications " + (hasLN ? "有" : "无") +
        " · SystemBridge " + (hasSB ? "有" : "无");
    }
    setPill($("#labBridgePill"), hasSB || hasLN ? "就绪" : "异常", hasSB || hasLN, false);

    const diag = await diagnoseSystemBridge();
    const bridge = systemBridge();
    if (!diag.available) {
      $("#labNotifyPerm").textContent = diag.reason || "原生桥不可用";
      setPill($("#labNotifyPill"), "异常", false, false);
      $("#labExact").textContent = "无法检测";
      setPill($("#labExactPill"), "未知", false, true);
      $("#labBattery").textContent = "无法检测";
      setPill($("#labBatteryPill"), "未知", false, true);
      if ($("#labFullScreen")) $("#labFullScreen").textContent = "无法检测";
      setPill($("#labFullScreenPill"), "未知", false, true);
      if ($("#labDelivery")) $("#labDelivery").textContent = "无法检测";
      setPill($("#labDeliveryPill"), "未知", false, true);
      // Q6：桥不可用是最彻底的「关掉就不响」，必须直说
      if ($("#labBackground")) $("#labBackground").textContent = "原生桥不可用 · 关掉 App 后不会有任何提醒";
      setPill($("#labBackgroundPill"), "不可用", false, false);
      if ($("#labScheduled")) $("#labScheduled").textContent = "无法读取";
      setPill($("#labScheduledPill"), "未知", false, true);
      if ($("#labVerdict")) {
        $("#labVerdict").hidden = false;
        $("#labVerdict").textContent =
          "⚠️ 原生桥不可用（" + (diag.reason || "未知") + "）· 关掉 App 后不会有任何提醒。";
        $("#labVerdict").style.color = "#8f3a3a";
        $("#labVerdict").style.background = "#f6e8e8";
      }
      labLog("诊断失败：" + (diag.reason || "未知"));
      return diag;
    }

    const notifyOk = diag.notificationsEnabled && diag.postNotificationsGranted;
    $("#labNotifyPerm").textContent = notifyOk ? "已授权 · 系统级通知可用" : "未授权 · 请先申请并打开系统通知";
    setPill($("#labNotifyPill"), notifyOk ? "已授权" : "未授权", notifyOk, !notifyOk);

    const exactOk = !!diag.canExactAlarm;
    $("#labExact").textContent = exactOk ? "可精确排程" : "未授权 · 仍可用非精确提醒";
    setPill($("#labExactPill"), exactOk ? "精确" : "降级", exactOk, !exactOk);

    const batteryOk = !!diag.ignoringBatteryOptimizations;
    $("#labBattery").textContent = batteryOk ? "已忽略系统电池优化 · 厂商开关仍需手动确认" : "未加入系统白名单 · 请同时检查厂商后台设置";
    setPill($("#labBatteryPill"), batteryOk ? "正常" : "建议开启", batteryOk, !batteryOk);

    // Q3：全屏闹钟的两道门 —— 解锁亮屏靠「显示在其他应用上层」，锁屏靠「全屏通知」
    const overlayOk = !!diag.canDrawOverlays;
    const fsiOk = !!diag.canUseFullScreenIntent;
    const fullOk = overlayOk && fsiOk;
    const fullEl = $("#labFullScreen");
    if (fullEl) {
      // V2：这一行只陈述「两项能力齐备」这个事实。此前写「解锁亮屏与锁屏都能弹全屏」，
      // 与下一行「投递：锁屏也没弹出」并存时会自相矛盾 —— 权限齐备不等于系统一定会展示。
      if (fullOk) fullEl.textContent = "权限齐备 · 能否弹出以「投递」一行为准";
      else if (!overlayOk && !fsiOk) fullEl.textContent = "两项都缺 · 只会出通知横幅";
      else if (!overlayOk) fullEl.textContent = "缺「显示在其他应用上层」· 解锁亮屏只出横幅";
      else fullEl.textContent = "缺「全屏通知」· 锁屏也只出横幅";
    }
    setPill($("#labFullScreenPill"), fullOk ? "权限齐备" : "受限", fullOk, !fullOk);

    // Q3 / V2：上一次投递到底送到用户眼前了没有（结论要参与下面「关掉 App 会怎样」的判断）
    let delivery = null;
    if (bridge && bridge.lastAlarmDelivery) {
      try {
        delivery = await bridge.lastAlarmDelivery();
      } catch (error) {
        delivery = null;
      }
      const verdict = describeAlarmDelivery(delivery);
      if ($("#labDelivery")) $("#labDelivery").textContent = verdict.text;
      setPill($("#labDeliveryPill"), verdict.label, verdict.ok, verdict.warn);
    }

    // Q6：先算「关掉 App 后会不会响」，这是用户真正要的答案
    await renderBackgroundVerdict(diag, delivery);

    // R1：系统权限已授予 ≠ 用户想开通知。
    // 只有用户主动「申请权限 / 打开开关」（labRequestNotify / swNotify）才写 settings.notify。
    labLog("诊断完成 · SDK " + diag.sdkInt +
      " · 通知 " + (notifyOk ? "OK" : "NO") +
      " · 精确闹钟 " + (exactOk ? "OK" : "降级") +
      " · 全屏 " + (fullOk ? "OK" : "受限"));
    await refreshAlarmTrace();
    return diag;
  }

  async function refreshAlarmTrace() {
    const el = $("#labTraceResults");
    const bridge = systemBridge();
    if (!el) return;
    if (!bridge || !bridge.alarmTrace) { el.textContent = "请安装诊断版本"; return; }
    try {
      const data = await bridge.alarmTrace();
      const groups = new Map();
      (data.events || []).forEach(e => {
        if (!groups.has(e.token)) groups.set(e.token, []);
        groups.get(e.token).push(e);
      });
      const entries = Array.from(groups.entries()).reverse();
      const itemEl = $("#labItemTrace");
      if (itemEl) {
        const items = state.items.slice().sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).slice(0, 5);
        itemEl.textContent = "本地通知总开关：" + (state.settings.notify ? "开" : "关") +
          " · 本轮对账：" + (nativeReminderStatus.reliability || "未知") +
          ((nativeReminderStatus.errors || []).length ? "\n错误：" + nativeReminderStatus.errors.join("；") : "") + "\n\n" +
          items.map(item => {
            // Old diagnostic packages lack item metadata. Reconstruct the primary ID only
            // from the current revision; report unmatched historical records as unknown.
            const primary = NativeReminders.buildDesired ? NativeReminders.buildDesired([item], state.settings,
              Number(item.triggerAt) - 2000).find(n => n.extra.event === "primary") : null;
            const matching = entries.filter(([token, events]) =>
              events.some(e => e.stage === "item" && e.detail === item.id) ||
              (primary && token.startsWith(primary.id + ":")));
            const latest = matching[0];
            const events = latest ? latest[1] : [];
            const at = stage => {
              const e = events.find(e => e.stage === stage);
              return e ? new Date(e.at).toLocaleString() : "未记录";
            };
            const scheduled = events.find(e => e.stage === "scheduled");
            const plan = scheduled && /triggerAt=(\d+)/.exec(scheduled.detail);
            const cancelled = events.find(e => e.stage === "cancelled");
            const error = events.find(e => e.stage === "scheduleFailed" || e.stage === "notifyFailed");
            return String(item.title || "未命名事项").slice(0, 60) + "\n" + item.id +
              " · " + item.priority + " · " + item.status + " · rev " + item.rev +
              "\n事项时间：" + (item.triggerAt ? new Date(item.triggerAt).toLocaleString() : "无") +
              "\n提醒方式：" + item.delivery_mode + " · 兜底时间：" + !!item.isFallbackTrigger +
              "\n原生计划：" + (plan ? new Date(Number(plan[1])).toLocaleString() : "无匹配记录（不代表从未排程）") +
              "\n广播：" + at("received") + "\n生命周期恢复：" + at("resumed") +
              "\n窗口/声音轨迹：\n" + events.filter(e => ["created", "focus", "windowSample", "windowVisible", "windowHidden", "audioState", "audioStarted", "audioFailed", "userAction", "autoClose", "paused", "stopped", "destroyed", "replaced", "effectsStopped", "duplicateIntent", "launchFailed", "launchLikelyBlocked", "directSkipped"].includes(e.stage))
                .map(e => new Date(e.at).toLocaleTimeString() + " " + ({created:"窗口创建",focus:"窗口焦点",windowSample:"窗口采样",windowVisible:"界面已显示",windowHidden:"界面未显示",audioState:"音量状态",audioStarted:"播放 API 成功",audioFailed:"声音错误",userAction:"按钮动作",autoClose:"测试自动关闭",paused:"暂停",stopped:"不可见",destroyed:"销毁",replaced:"更换闹钟",effectsStopped:"停止声振",duplicateIntent:"同次重复送达",launchFailed:"启动错误",launchLikelyBlocked:"预计被系统拦下",directSkipped:"跳过直起界面"}[e.stage] || e.stage) + " " + e.detail).join("\n") +
              (cancelled ? "\n撤销/替换：" + new Date(cancelled.at).toLocaleString() + " · " + cancelled.detail : "") +
              (error ? "\n异常：" + error.detail : "");
          }).join("\n\n");
      }

      const tests = [-917010, -917060, -917120].map(id => entries.find(([token]) => token.startsWith(id + ":"))).filter(Boolean);
      const selected = tests.length ? tests : entries.slice(0, 6);
      const time = value => new Date(value).toLocaleTimeString();
      el.textContent = selected.map(([token, events]) => {
        const find = stage => events.find(e => e.stage === stage);
        const plan = find("scheduled");
        const match = plan && /triggerAt=(\d+)/.exec(plan.detail);
        const expected = match ? Number(match[1]) : null;
        const id = Number(token.split(":")[0]);
        const title = tests.length ? (Math.abs(id) - 917000) + " 秒测试" : "闹钟 " + id;
        const stageTime = stage => find(stage) ? time(find(stage).at) : "未记录";
        return title + " · 计划 " + (expected ? time(expected) : "未确认") +
          (find("cancelled") ? " · 已撤销/替换" : expected && expected < data.now && !find("received") ? " · 到点未收到" : "") +
          "\n广播：" + stageTime("received") + "\n通知调用：" + stageTime("notifyReturned") +
          "\n生命周期恢复：" + stageTime("resumed") +
          (find("environment") ? "\n" + find("environment").detail : "") +
          (find("scheduleFailed") || find("notifyFailed") ? "\n异常：" + (find("scheduleFailed") || find("notifyFailed")).detail : "");
      }).join("\n\n") || "暂无逐次记录";

    } catch (error) { el.textContent = "读取失败：" + String(error.message || error); }
  }

  async function labTraceTest() {
    const button = $("#labTraceTest");
    if (button) button.disabled = true;
    try {
      const bridge = systemBridge();
      if (!bridge || !bridge.startAlarmTraceTest) throw new Error("请安装诊断版本");
      const result = await bridge.startAlarmTraceTest();
      const failures = (result.results || []).filter(r => !r.ok);
      labLog(failures.length ? "部分测试排程失败：" + JSON.stringify(failures) :
        "三次测试已登记。现在返回桌面并锁屏，3 分钟后回来刷新诊断。再次点击会替换未到点的测试。");
      await refreshAlarmTrace();
    } catch (error) { labLog("诊断启动失败：" + String(error.message || error)); }
    finally { if (button) button.disabled = false; }
  }

  async function labShowNow() {
    const bridge = systemBridge();
    if (!bridge || !bridge.showNotification) {
      labLog("SystemBridge 不可用，无法直接发送");
      toast("原生通知桥不可用");
      return;
    }
    try {
      await bridge.showNotification({
        title: "安心收件箱",
        body: "系统通知测试成功 · " + fmtTime(Date.now())
      });
      labLog("已发送立即通知，请查看通知栏");
      toast("已发送测试通知");
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      labLog("立即通知失败：" + msg);
      toast("通知失败：" + msg);
      await refreshNotifyLab();
    }
  }

  async function labScheduleAlarm(delayMs, label) {
    const bridge = systemBridge();
    if (!bridge || !bridge.scheduleAlarm) {
      labLog("SystemBridge 不可用，无法设置闹钟");
      toast("原生闹钟桥不可用");
      return;
    }
    try {
      const r = await bridge.scheduleAlarm({
        delayMs,
        id: delayMs >= 60000 ? 90003 : 90002,
        title: "安心收件箱闹钟测试",
        body: label + "闹钟触发成功 · 可锁屏验证"
      });
      labLog("已设置 " + label + " 闹钟 · " + (r.mode || (r.exact ? "精确" : "非精确")) +
        (r.alarmClock ? " · 全屏闹钟" : "") +
        " · 触发于 " + fmtTime(r.triggerAt) +
        " · 到点后重开本面板可看投递结果");
      toast("已设置 " + label + " 闹钟");
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      labLog("闹钟设置失败：" + msg);
      toast("闹钟失败：" + msg);
    }
  }

  async function labCancelAlarms() {
    const bridge = systemBridge();
    if (!bridge || !bridge.cancelAlarm) {
      toast("原生闹钟桥不可用");
      return;
    }
    try {
      await bridge.cancelAlarm({ id: 90002 });
      await bridge.cancelAlarm({ id: 90003 });
      for (const id of [-917010, -917060, -917120]) await bridge.cancelAlarm({ id });
      labLog("已取消未触发测试闹钟");
      toast("已取消测试闹钟");
    } catch (error) {
      toast("取消失败");
    }
  }

  async function labRequestNotify() {
    const bridge = systemBridge();
    try {
      if (bridge && bridge.requestNotificationPermission) {
        const r = await bridge.requestNotificationPermission();
        state.settings.notify = !!r.granted;
        state.settings.notifyPrompted = true;
        save();
        labLog(r.granted ? "通知权限已授予" : "通知权限未授予");
        toast(r.granted ? "通知权限已开启" : "仍未授权，请到系统设置开启");
      } else if (NativeReminders.requestNotificationPermission) {
        const status = await NativeReminders.requestNotificationPermission();
        setNativeReminderStatus(status);
        state.settings.notify = status.notifications === "granted";
        save();
        labLog("权限结果：" + status.notifications);
      }
      renderMe();
      await refreshNotifyLab();
    } catch (error) {
      labLog("申请权限失败：" + (error && error.message ? error.message : error));
    }
  }

  // 厂商开关不可读；导航成功只说明设置请求被接受，不代表权限已开启。
  async function openBackgroundGuide(kind) {
    const buttons = [$("#labOpenBackground"), $("#labOpenAutoStart")].filter(Boolean);
    if (buttons.some(button => button.disabled)) return;
    const feedback = $("#labSettingsFeedback");
    const report = text => {
      if (feedback) feedback.textContent = text;
      labLog(text);
    };
    buttons.forEach(button => { button.disabled = true; });
    report("正在打开系统设置…");
    try {
      const bridge = systemBridge();
      const appSet = appSettingsPlugin();
      if (kind === "background" && bridge && bridge.openBackgroundSettings) {
        const result = await bridge.openBackgroundSettings();
        if (result && result.ok === false) throw new Error("设置请求失败");
        if (result && result.opened === "batteryOptimization") {
          report("已请求打开后台耗电设置。请找到安心收件箱并允许后台耗电；返回不代表开关已开启。");
        } else {
          report("请在应用信息中查找电池或后台运行设置；若未到对应页面，可从手机设置手动进入。开关仍需手动确认。");
        }
      } else {
        if (bridge && bridge.openAppDetailsSettings) await bridge.openAppDetailsSettings();
        else if (appSet && appSet.openAppDetailsSettings) await appSet.openAppDetailsSettings();
        else throw new Error("设置入口不可用");
        report(kind === "background"
          ? "已请求打开应用信息，请查找电池或后台运行设置，允许后台耗电。开关仍需手动确认。"
          : "已请求打开应用信息。vivo 请点「查看所有权限」，确认「自启动」和「锁屏显示」；其他手机请查找相近选项。返回不代表已授权。");
      }
    } catch (error) {
      report("未能打开设置。请手动进入手机设置 → 应用 → 安心收件箱，检查后台耗电、自启动、锁屏显示。");
      toast("未能打开设置，请按面板说明手动检查");
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  async function openSystemSetting(kind) {
    const bridge = systemBridge();
    const appSet = appSettingsPlugin();
    try {
      if (kind === "notify") {
        if (bridge && bridge.openNotificationSettings) await bridge.openNotificationSettings();
        else if (appSet && appSet.openNotificationSettings) await appSet.openNotificationSettings();
      } else if (kind === "exact") {
        if (bridge && bridge.openExactAlarmSettings) await bridge.openExactAlarmSettings();
        else if (NativeReminders.openExactAlarmSettings) await NativeReminders.openExactAlarmSettings();
      } else if (kind === "battery") {
        if (bridge && bridge.openBatterySettings) await bridge.openBatterySettings();
        else if (appSet && appSet.openBatterySettings) await appSet.openBatterySettings();
      } else if (kind === "overlay") {
        // Q3：解锁亮屏时全屏闹钟的必要条件（Android 10+ 的 BAL 豁免）
        if (bridge && bridge.openOverlaySettings) await bridge.openOverlaySettings();
        else await openSystemSetting("autoStart");
      } else if (kind === "fsi") {
        // Q3：Android 14+ 的「全屏通知」特殊权限
        if (bridge && bridge.openFullScreenIntentSettings) await bridge.openFullScreenIntentSettings();
        else await openSystemSetting("autoStart");
      } else if (kind === "autoStart") {
        // 国产 ROM 专有开关；原生按厂商组件逐个试，全失败退回应用详情
        if (bridge && bridge.openAutoStartSettings) {
          const r = await bridge.openAutoStartSettings();
          if (r && r.component) labLog("已跳转厂商自启动设置（" + r.component + "）");
        } else if (bridge && bridge.openAppDetailsSettings) {
          await bridge.openAppDetailsSettings();
        } else if (appSet && appSet.openAppDetailsSettings) {
          await appSet.openAppDetailsSettings();
        }
      }
      labLog("已跳转系统设置（" + kind + "），返回后请点「刷新诊断」");
    } catch (error) {
      toast("无法打开系统设置");
    }
  }

  function bindNotifyLab() {
    const labBtn = $("#btnNotifyLab");
    if (labBtn) {
      labBtn.addEventListener("click", () => {
        openSheet("sheetNotifyLab");
        refreshNotifyLab();
      });
    }
    const req = $("#labReqNotify");
    if (req) req.addEventListener("click", labRequestNotify);
    const openNotify = $("#labOpenNotify");
    if (openNotify) openNotify.addEventListener("click", () => openSystemSetting("notify"));
    const openExact = $("#labOpenExact");
    if (openExact) openExact.addEventListener("click", () => openSystemSetting("exact"));
    const openBattery = $("#labOpenBattery");
    if (openBattery) openBattery.addEventListener("click", () => openSystemSetting("battery"));
    const openOverlay = $("#labOpenOverlay");
    if (openOverlay) openOverlay.addEventListener("click", () => openSystemSetting("overlay"));
    const openFsi = $("#labOpenFsi");
    if (openFsi) openFsi.addEventListener("click", () => openSystemSetting("fsi"));
    const openAutoStart = $("#labOpenAutoStart");
    if (openAutoStart) openAutoStart.addEventListener("click", () => openBackgroundGuide("permissions"));
    const openBackground = $("#labOpenBackground");
    if (openBackground) openBackground.addEventListener("click", () => openBackgroundGuide("background"));
    const traceTest = $("#labTraceTest");
    if (traceTest) traceTest.addEventListener("click", labTraceTest);
    const testNow = $("#labTestNow");
    if (testNow) testNow.addEventListener("click", labShowNow);
    const test10 = $("#labTest10s");
    if (test10) test10.addEventListener("click", () => labScheduleAlarm(10000, "10 秒"));
    const test60 = $("#labTest60s");
    if (test60) test60.addEventListener("click", () => labScheduleAlarm(60000, "1 分钟"));
    const cancel = $("#labCancelAlarm");
    if (cancel) cancel.addEventListener("click", labCancelAlarms);
    const refresh = $("#labRefresh");
    if (refresh) refresh.addEventListener("click", refreshNotifyLab);
    // Q6：强制重排一次，并且把「系统里实际挂着几条」直接写进日志 ——
    // 用户不必再靠反复试来猜排程有没有落地。
    const resync = $("#labResync");
    if (resync) {
      resync.addEventListener("click", async () => {
        labLog("正在重新对账…");
        try {
          const status = await syncNativeRemindersNow();
          const diag = await refreshNotifyLab();
          const v = await renderBackgroundVerdict(diag);
          labLog("重排完成 · " + v.label + " · " + v.text +
            "（本轮计划 " + (Number(status && status.desired) || 0) + " 条，" +
            "全屏闹钟 " + (Number(status && status.alarmCount) || 0) + " 条）");
        } catch (error) {
          labLog("重排失败：" + (error && error.message ? error.message : String(error)));
        }
      });
    }

    // Q3：闹钟到点后用户回到应用，自动刷新投递结论（否则要手点「刷新诊断」才知道全屏有没有弹出来）
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      const sheet = $("#sheetNotifyLab");
      if (sheet && sheet.classList.contains("open")) refreshNotifyLab();
    });

    // P0-3：reviewSnooze / reviewSkip 不再在此绑定 —— 它们随 renderReviewCard() 重建，改由渲染处逐次挂载

    $$("[data-snooze-review]").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.snoozeReview;
        let ms = 7200000;
        let label = "2 小时后";
        if (v === "1800000") { ms = 1800000; label = "30 分钟后"; }
        else if (v === "7200000") { ms = 7200000; label = "2 小时后"; }
        else if (v === "tonight") {
          const d = new Date();
          d.setHours(22, 30, 0, 0);
          if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
          ms = d.getTime() - Date.now();
          label = "今晚稍后";
        } else if (v === "tomorrow") {
          const d = new Date();
          d.setDate(d.getDate() + 1);
          d.setHours(ensureReviewSettings().hour || 21, ensureReviewSettings().minute || 30, 0, 0);
          ms = d.getTime() - Date.now();
          label = "明天";
        } else if (v === "next") {
          ms = nextReviewWindowStart() - Date.now();
          label = "下一个整理时间";
        }
        if (ms < 60000) ms = 60000;
        closeSheet("sheetReviewSnooze");
        snoozeReview(ms, label);
      });
    });

    const btnReviewSettings = $("#btnReviewSettings");
    if (btnReviewSettings) {
      btnReviewSettings.addEventListener("click", () => {
        const rs = ensureReviewSettings();
        const sw = $("#swReviewEnabled");
        if (sw) sw.classList.toggle("on", !!rs.enabled);
        const start = $("#reviewStart");
        const end = $("#reviewEnd");
        if (start) start.value = pad2(rs.hour || 21) + ":" + pad2(rs.minute || 30);
        if (end) end.value = pad2(rs.windowEndHour != null ? rs.windowEndHour : 23) + ":" + pad2(rs.windowEndMinute || 0);
        openSheet("sheetReviewSchedule");
      });
    }
    const swReviewEnabled = $("#swReviewEnabled");
    if (swReviewEnabled) {
      swReviewEnabled.addEventListener("click", () => {
        swReviewEnabled.classList.toggle("on");
      });
    }
    const btnSaveReviewSchedule = $("#btnSaveReviewSchedule");
    if (btnSaveReviewSchedule) {
      btnSaveReviewSchedule.addEventListener("click", () => {
        const rs = ensureReviewSettings();
        rs.enabled = $("#swReviewEnabled") ? $("#swReviewEnabled").classList.contains("on") : true;
        const start = ($("#reviewStart") && $("#reviewStart").value) || "21:30";
        const end = ($("#reviewEnd") && $("#reviewEnd").value) || "23:00";
        const sm = start.match(/^(\d{1,2}):(\d{2})$/);
        const em = end.match(/^(\d{1,2}):(\d{2})$/);
        if (sm) { rs.hour = parseInt(sm[1], 10); rs.minute = parseInt(sm[2], 10); }
        if (em) { rs.windowEndHour = parseInt(em[1], 10); rs.windowEndMinute = parseInt(em[2], 10); }
        rs.lastSessionKey = "";
        rs.followupCount = 0;
        rs.snoozedUntil = 0;
        rs.skippedUntil = 0;
        save();
        closeSheet("sheetReviewSchedule");
        renderMe();
        scheduleNextReviewAlarm();
        toast("待整理时间已保存");
      });
    }
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function renderUpcomingRow(it) {
    const d = new Date(it.triggerAt);
    const day = dayLabel(it.triggerAt);
    const time = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    const pills = [];
    if (it.priority === "important") pills.push('<span class="pill warn">☆ 重要</span>');
    if (it.priority === "critical") pills.push('<span class="pill crit">🚨 关键</span>');
    if (it.deadlineAt) pills.push('<span class="pill warn">有截止</span>');
    if (it.repeat && it.repeat.every) pills.push('<span class="pill future">周期</span>');
    return '<div class="upcoming-item" data-act="edit" data-id="' + it.id + '">' +
      '<div class="upcoming-when"><b>' + escapeHtml(time) + "</b>" + escapeHtml(day) + "</div>" +
      '<div class="upcoming-body">' +
      '<div class="upcoming-title">' + escapeHtml(it.title || "未命名事项") + "</div>" +
      '<div class="upcoming-meta">' + pills.join("") +
      '<span class="pill future">' + escapeHtml(relDue(it.triggerAt)) + "</span>" +
      "</div></div></div>";
  }

  // D5：首页「即将到来」区块已删除（未来只在「未来」页查看）

  async function initializeNativeReminders() {
    // 非安卓容器（浏览器 / PWA）：原生能力本就不适用，直接返回。
    // 绝不能走下面的「桥未就绪」分支 —— 否则 Web 版会看到一句吓人的误报。
    if (!isNativeAndroidRuntime()) return;
    if (!NativeReminders.isNativeAndroid || !NativeReminders.isNativeAndroid()) {
      // Q6：这里以前是一句**静默 return** —— 整条原生链路就此消失，而界面毫无异样
      // （按钮照常可点、应用内提醒照常弹），现象因此只能被描述成「关掉 App 就不响」。
      // 现在：等桥就绪（注入时机不受我们控制，实测有数秒级时间差）；
      // 确实等不到就留下一条界面上看得见的失败记录，而且之后仍可重试。
      const bridged = await waitForNativeBridge(10000);
      if (!bridged) {
        setNativeReminderStatus({
          native: false,
          notifications: "unavailable",
          exactAlarm: "unavailable",
          reliability: "error",
          bridgeNotReady: true
        });
        return;
      }
    }
    try {
      const status = await NativeReminders.initialize({
        onAction: handleNativeNotificationAction,
        // F1：系统确实送达时的回调，用于记录真实送达而不是靠时刻推断
        onDelivered: markDeadlineDelivered,
        onStatusChange: setNativeReminderStatus,
        onResume: async () => {
          try {
            if (NativeReminders.getPermissionState) {
              const status = await NativeReminders.getPermissionState();
              setNativeReminderStatus(status);
              // R1：系统权限状态与「用户主动开关」是两件事。
              // 恢复前台只刷新能力信息，绝不替用户把他亲手关掉的通知开关再打开 ——
              // 否则「关闭通知」这个动作会在下一次切回应用时被静默撤销。
              renderMe();
            }
          } catch (error) {}
          // 消费全屏闹钟动作（V09：排空队列，处理成功并落库后才确认删除）
          try {
            if (NativeReminders.drainAlarmActions) {
              await NativeReminders.drainAlarmActions(handleAlarmAction);
            }
          } catch (error) {}
          refreshNativeScheduleBasis();
          await refreshActiveAlarmPanel(true);
          promoteDue();
          queueNativeReminderSync();
        }
      });
      nativeReady = true;
      setNativeReminderStatus(status);
      await refreshActiveAlarmPanel(true);
      refreshNativeScheduleBasis();
      await syncNativeRemindersNow();
    } catch (error) {
      nativeReady = true;
      setNativeReminderStatus({
        native: true,
        reliability: "error",
        error: error && error.message ? error.message : String(error)
      });
    }
  }

  async function maybePromptAndroidNotify() {
    if (!(NativeReminders.isNativeAndroid && NativeReminders.isNativeAndroid())) return;
    if (state.settings.onboardDone) return;
    state.settings.onboardDone = true;
    state.settings.notifyPrompted = true;
    save();
    setTimeout(() => {
      openSheet("sheetNotifyLab");
      refreshNotifyLab();
      toast("请完成提醒能力自检，并做一次通知/闹钟测试");
    }, 600);
  }

  function shouldSkipAlert(it) {
    const until = it.dismissedUntil || 0;
    if (until > Date.now()) return true;
    const at = dismissedAlerts[it.id];
    if (!at) return false;
    return Date.now() - at < 30 * 60 * 1000;
  }

  function showSystemNotification(opts) {
    if (!state.settings.notify) return;
    if (NativeReminders.isNativeAndroid && NativeReminders.isNativeAndroid()) return;
    // 用真值判断而非 `in`：属性存在但为 undefined 时（部分壳/旧浏览器）会直接抛错，
    // 而本函数在 tick → showAlert 的主链路上，抛错会打断整轮提醒。
    const N = typeof window !== "undefined" ? window.Notification : null;
    if (!N || N.permission !== "granted") return;
    const privacy = !!state.settings.privacyNotify;
    const payload = {
      title: privacy ? "安心收件箱提醒" : (opts.title || "安心收件箱提醒"),
      body: privacy ? "有一条事项需要你确认" : (opts.body || ""),
      tag: opts.tag || "attention",
      requireInteraction: !!opts.requireInteraction,
      data: opts.data || {},
      actions: opts.actions || []
    };
    // Prefer SW (supports actions on many browsers)
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "SHOW_NOTIFICATION",
        notification: payload
      });
      return;
    }
    try {
      new Notification(payload.title, {
        body: payload.body,
        tag: payload.tag,
        requireInteraction: payload.requireInteraction,
        data: payload.data
      });
    } catch (e) {}
  }

  let alertAutoHideTimer = null;

  function showAlert(it) {
    alertItem = it;
    $("#alertTitle").textContent =
      it.priority === "critical" ? "🚨 关键提醒" :
      it.priority === "important" ? "☆ 重要提醒" : "提醒";
    $("#alertBody").textContent = it.title + (it.note ? " · " + it.note : "");
    const b = $("#alertBanner");
    b.classList.toggle("crit", it.priority === "critical");
    b.classList.add("show");
    // D14：挂 10 分钟自动收起（纯展示，不记账、不消耗提醒预算）
    if (alertAutoHideTimer) clearTimeout(alertAutoHideTimer);
    alertAutoHideTimer = setTimeout(() => {
      if (alertItem && alertItem.id === it.id) {
        hideAlert();
      }
    }, 10 * 60 * 1000);
    showSystemNotification({
      title: it.priority === "critical" ? "🚨 关键事项" :
             it.priority === "important" ? "☆ 重要事项" : "安心收件箱提醒",
      body: it.title,
      tag: "item-" + it.id,
      requireInteraction: it.priority !== "normal",
      data: { itemId: it.id },
      actions: [
        { action: "ack", title: "我知道了" },
        { action: "snooze", title: "稍后 2 小时" },
        { action: "done", title: "完成" }
      ]
    });
    if (navigator.vibrate && it.priority !== "normal") {
      try {
        navigator.vibrate(it.priority === "critical" ? [80, 40, 80, 40, 120] : [60, 40, 60]);
      } catch (e) {}
    }
    updateAppBadge();
  }

  function hideAlert() {
    if (alertAutoHideTimer) {
      clearTimeout(alertAutoHideTimer);
      alertAutoHideTimer = null;
    }
    $("#alertBanner").classList.remove("show");
    alertItem = null;
  }

  /** D13：只有点 × 才算关闭（消耗 30 分钟抑制） */
  function dismissAlert() {
    if (alertItem) {
      const now = Date.now();
      const applied = runUserOp(
        applyAlertDismissal,
        [alertItem.id, now + 30 * 60 * 1000],
        { userFacing: true, itemArg: 0, name: "dismissAlert" }
      );
      if (applied === false) return false;
      dismissedAlerts[alertItem.id] = now;
      save();
    }
    hideAlert();
    toast("已关闭提醒 · 事项仍在首页");
    return true;
  }

  function applyAlertDismissal(itemId, until) {
    const item = state.items.find(x => x.id === itemId);
    if (!item) return false;
    item.dismissedUntil = until;
    bumpRev(item);
    return true;
  }

  function tick() {
    promoteDue();
    maybeReviewSession();
    const now = Date.now();
    const candidates = state.items.filter(it => {
      if (it.status !== "due") return false;
      if (shouldSkipAlert(it)) return false;
      if (!it.lastAlertShownAt) return true;
      if (!Lib.shouldRealert) return false;
      return Lib.shouldRealert(it, now, {
        importantRepeat: state.settings.importantRepeat !== false,
        dismissedAt: dismissedAlerts[it.id] || null
      });
    });
    if (!alertItem && candidates.length) {
      candidates.sort((a, b) => {
        const pr = priorityRank(a.priority) - priorityRank(b.priority);
        if (pr !== 0) return pr;
        return (a.triggerAt || 0) - (b.triggerAt || 0);
      });
      const next = candidates[0];
      if (next.lastAlertShownAt && Lib.markReminded) Lib.markReminded(next, now);
      next.lastAlertShownAt = now;
      save();
      showAlert(next);
    }
    if (state.ui.tab === "home") renderHome();
    else if (state.ui.tab === "me") renderStats();
  }

  /* ---------- data import/export ---------- */
  function exportData() {
    const payload = {
      app: "attention-inbox",
      schema: SCHEMA,
      exportedAt: new Date().toISOString(),
      items: state.items,
      notes: state.notes,
      projects: state.projects,
      settings: {
        notify: state.settings.notify,
        dnd: state.settings.dnd,
        importantRepeat: state.settings.importantRepeat,
        quietStart: state.settings.quietStart,
        quietEnd: state.settings.quietEnd,
        dailySummary: state.settings.dailySummary,
        privacyNotify: state.settings.privacyNotify,
        defaultDeliveryMode: state.settings.defaultDeliveryMode || "notification",
        // do not export AI secrets
        ai: {
          enabled: !!(state.settings.ai && state.settings.ai.enabled),
          baseUrl: "",
          apiKey: "",
          model: state.settings.ai && state.settings.ai.model ? state.settings.ai.model : "",
          autoOnSave: !!(state.settings.ai && state.settings.ai.autoOnSave)
        }
      }
    };
    const text = JSON.stringify(payload, null, 2);
    const name = "安心收件箱备份-" + new Date().toISOString().slice(0, 10) + ".json";
    const file = new File([text], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "安心收件箱备份" })
        .then(() => toast("已分享备份"))
        .catch(() => downloadFile(name, text));
      return;
    }
    downloadFile(name, text);
    toast("已导出备份文件");
  }

  function importDataFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(String(reader.result || ""));
        if (!data || !Array.isArray(data.items)) throw new Error("bad format");
        const okImp = await confirmDialog("导入将覆盖当前数据，继续？", "导入数据");
        if (!okImp) return;
        if (inflightActionDepth > 0) {
          toast("提醒操作正在保存 · 请稍后重新导入");
          return;
        }
        state.items = data.items.map(normalizeItem);
        state.notes = Array.isArray(data.notes) ? data.notes : [];
        state.projects = Array.isArray(data.projects) ? data.projects : [];
        state.settings = Object.assign(state.settings, data.settings || {});
        save();
        render();
        toast("导入成功 · " + state.items.length + " 条事项");
      } catch (e) {
        toast("导入失败：文件格式不正确");
      }
    };
    reader.readAsText(file);
  }

  /* ---------- seed ---------- */
  function seed() {
    if (inflightActionDepth > 0) {
      toast("提醒操作正在保存 · 请稍后再载入示例数据");
      return false;
    }
    const now = new Date();
    state.projects = [
      { id: "p_work", name: "工作", color: "#1b6b4a" },
      { id: "p_read", name: "阅读", color: "#3d5a80" },
      { id: "p_life", name: "生活", color: "#9a6b12" }
    ];
    state.items = [
      makeItem({
        title: "看看 Horolog 的调度设计",
        note: "GitHub 上那个开源调度库，重点看它的 cron 与重试策略",
        tags: ["阅读", "工程"],
        url: "https://github.com/search?q=horolog",
        projectId: "p_read",
        priority: "normal",
        status: "due",
        triggerAt: Date.now() - 5 * 60000
      }),
      makeItem({
        title: "报名截止，提前确认材料",
        note: "需要成绩单扫描件 + 证件照",
        tags: ["行政"],
        projectId: "p_work",
        priority: "important",
        status: "waiting",
        triggerAt: applyClock(addDays(now, 1), Date.now()),
        deadlineAt: endOfDay(addDays(now, 5)).getTime()
      }),
      makeItem({
        title: "交房租",
        projectId: "p_life",
        priority: "normal",
        status: "waiting",
        triggerAt: applyClock(addDays(now, 3), Date.now()),
        repeat: { mode: "calendar", every: "month" }
      }),
      makeItem({
        title: "给爸妈打电话",
        projectId: "p_life",
        priority: "important",
        status: "waiting",
        triggerAt: nextWeekend(now),
        repeat: { mode: "ack", every: "biweek" }
      }),
      makeItem({
        title: "看看那篇注意力管理文章",
        note: "分享进来的，周末有空再读",
        tags: ["阅读"],
        url: "https://example.com/attention",
        projectId: "p_read",
        priority: "normal",
        status: "waiting",
        triggerAt: nextWeekend(now)
      }),
      makeItem({
        title: "续费域名",
        note: "已经确认过了，还没操作",
        projectId: "p_work",
        priority: "normal",
        status: "acknowledged",
        triggerAt: Date.now() - 86400000,
        acknowledgedAt: Date.now() - 3600000
      }),
      makeItem({
        title: "买猫粮",
        projectId: "p_life",
        priority: "normal",
        status: "archived",
        triggerAt: Date.now() - 7200000,
        completedAt: Date.now() - 3600000
      })
    ];
    state.notes = [
      {
        id: uid(),
        title: "注意力原则",
        body: "## 核心原则\n\n- Acknowledge ≠ Complete\n- Future 默认不占据首页\n- 通知送达 ≠ 用户看到\n\n> 放心忘记，而不是帮记住更多事情。",
        pinned: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: uid(),
        title: "周末阅读清单",
        body: "1. Horolog 调度设计\n2. 本地优先架构文章\n3. RFC 5545 重复规则\n\n`本地优先` = 无网也能完成核心流程。",
        projectId: "p_read",
        createdAt: Date.now(),
        updatedAt: Date.now() - 86400000
      }
    ];
    state.settings = Object.assign(state.settings, { notify: false, dnd: true, importantRepeat: true });
    save();
    state.ui.tab = "home";
    render();
    toast("示例数据已载入");
  }

  /* ---------- share / deep link ---------- */
  function applyShareParams() {
    const params = new URLSearchParams(location.search);
    const text = params.get("text") || params.get("title") || "";
    const url = params.get("url") || params.get("link") || "";
    const body = params.get("body") || "";
    if (!text && !url && !body) return false;
    const title = text || (url ? url : body.slice(0, 40));
    openCapture({
      title,
      url: url || (/^https?:\/\//.test(body) ? body : ""),
      note: body && body !== url ? body : ""
    });
    // clean query so refresh doesn't reopen
    try {
      history.replaceState(null, "", location.pathname);
    } catch (e) {}
    return true;
  }

  /* ---------- events ---------- */
  function bind() {
    bindNotifyLab();
    $$(".nav-item").forEach(btn => {
      btn.addEventListener("click", () => {
        state.ui.tab = btn.dataset.tab;
        render();
      });
    });

    $("#fab").addEventListener("click", () => openCapture());

    $("#backdrop").addEventListener("click", closeAllSheets);
    $$("[data-close]").forEach(b => {
      b.addEventListener("click", () => closeSheet(b.dataset.close));
    });

    let parseTimer = null;
    $("#capText").addEventListener("input", () => {
      clearTimeout(parseTimer);
      parseTimer = setTimeout(updateParseHint, 120);
    });
    $$("#capPriority .chip").forEach(c => {
      c.addEventListener("click", () => {
        $$("#capPriority .chip").forEach(x => x.classList.remove("on"));
        c.classList.add("on");
      });
    });
    $("#btnSaveItem").addEventListener("click", saveItemFromForm);
    $("#capText").addEventListener("keydown", e => {
      if (e.key === "Enter") saveItemFromForm();
    });
    $("#capText").addEventListener("blur", () => {
      renderSimilarHint($("#capText").value.trim());
    });
    $("#capText").addEventListener("input", () => {
      clearTimeout(similarTimer);
      similarTimer = setTimeout(() => renderSimilarHint($("#capText").value.trim()), 400);
    });
    $("#capRepeat").addEventListener("change", updateRepeatPreview);
    $("#capRepeatMode").addEventListener("change", updateRepeatPreview);
    $("#capNth").addEventListener("change", updateRepeatPreview);
    $("#capWeekday").addEventListener("change", updateRepeatPreview);
    $("#capTrigger").addEventListener("change", () => {
      // L01：只有用户真的动过这个字段，才算「明确选择的时间」
      triggerUserPicked = true;
      updateRepeatPreview();
    });

    document.addEventListener("click", e => {
      const sim = e.target.closest("[data-open-similar]");
      if (sim) {
        openDetail(sim.dataset.openSimilar);
        return;
      }
    }, true);

    // low confidence
    $$("#lowConfChips .chip").forEach(c => {
      c.addEventListener("click", () => {
        const now = new Date();
        if (c.dataset.days) {
          setLowConfPick(Date.now() + parseInt(c.dataset.days, 10) * 86400000, c);
        } else if (c.dataset.preset === "weekend") {
          setLowConfPick(nextWeekend(now), c);
        }
      });
    });
    $("#lowConfCustom").addEventListener("change", () => {
      const ts = parseLocalInput($("#lowConfCustom").value);
      if (ts) setLowConfPick(ts, null);
    });
    $("#btnLowConfOk").addEventListener("click", () => {
      const ts = state.ui.pendingLowConf || parseLocalInput($("#lowConfCustom").value);
      if (ts) $("#capTrigger").value = toLocalInput(ts);
      closeSheet("sheetLowConf");
      finishSaveAfterLowConf(ts);
    });

    document.addEventListener("click", async (e) => {
      const actBtn = e.target.closest("[data-act]");
      if (actBtn) {
        const id = actBtn.dataset.id;
        const act = actBtn.dataset.act;
        if (act === "ack") {
          if (ackItem(id) !== false) { closeSheet("sheetDetail"); hideAlert(); }
        }
        else if (act === "done") {
          if (completeItem(id) !== false) { closeSheet("sheetDetail"); hideAlert(); }
        }
        else if (act === "snooze") {
          if (isItemActionPending(id)) { rejectPendingItemCommand(); return; }
          state.ui.snoozeId = id;
          snoozePick = null;
          snoozeBasis = "elapsed";
          $("#snoozeCustom").value = "";
          $$("#snoozeChips .chip").forEach(x => x.classList.remove("on"));
          closeSheet("sheetDetail");
          openSheet("sheetSnooze");
        }
        else if (act === "reopen") { if (reopenItem(id) !== false) closeSheet("sheetDetail"); }
        else if (act === "delete") {
          const okDel = await confirmDialog("确定删除这条事项？", "删除");
          if (okDel) {
            if (deleteItem(id) !== false) {
              closeSheet("sheetDetail");
              hideAlert();
            }
          }
        }
        else if (act === "restore") { if (restoreItem(id) !== false) closeSheet("sheetDetail"); }
        // L03：停止重复（保留当前这条，只结束规则）
        else if (act === "stopRepeat") { if (stopRepeat(id) !== false) closeSheet("sheetDetail"); }
        // D23：显式恢复被暂停的截止保护
        else if (act === "resumeDeadline") { if (resumeDeadlineProtection(id) !== false) closeSheet("sheetDetail"); }
        else if (act === "open") openDetail(id);
        else if (act === "edit") openEditItem(id);
        return;
      }

      const delProj = e.target.closest("[data-del-proj]");
      if (delProj) {
        const okP = await confirmDialog("删除该项目？事项会保留但去掉项目。", "删除项目");
        if (okP) deleteProject(delProj.dataset.delProj);
        return;
      }
      const colorBtn = e.target.closest("[data-color]");
      if (colorBtn && colorBtn.closest("#projColors")) {
        selectedColor = colorBtn.dataset.color;
        renderProjectsSheet();
        return;
      }

      const calNav = e.target.closest("[data-cal]");
      if (calNav) {
        const kind = calNav.dataset.cal;
        const cur = state.ui.calMonth ? new Date(state.ui.calMonth) : new Date();
        if (kind === "prev") cur.setMonth(cur.getMonth() - 1);
        else if (kind === "next") cur.setMonth(cur.getMonth() + 1);
        else {
          const t = new Date();
          state.ui.calMonth = t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-01";
          state.ui.calSelected = null;
          renderFuture();
          return;
        }
        state.ui.calMonth = cur.getFullYear() + "-" + pad(cur.getMonth() + 1) + "-01";
        state.ui.calSelected = null;
        renderFuture();
        return;
      }
      const calDay = e.target.closest("[data-cal-day]");
      if (calDay) {
        const day = parseInt(calDay.dataset.calDay, 10);
        state.ui.calSelected = state.ui.calSelected === day ? null : day;
        renderFuture();
        return;
      }
      if (e.target.closest("#clearCalSel")) {
        state.ui.calSelected = null;
        renderFuture();
        return;
      }

      const card = e.target.closest(".card[data-id]");
      if (card && !e.target.closest("a") && !e.target.closest("button")) {
        openDetail(card.dataset.id);
        return;
      }

      const note = e.target.closest("[data-note]");
      if (note) { openNote(note.dataset.note); return; }

      if (e.target.closest("#toggleActive")) {
        state.ui.activeExpanded = !state.ui.activeExpanded;
        renderHome();
        return;
      }
      if (e.target.closest("#btnNewNote")) openNote(null);
    });

    $$("#futureSeg .seg-item").forEach(b => {
      b.addEventListener("click", () => {
        state.ui.futureSeg = b.dataset.seg;
        state.ui.calSelected = null;
        render();
      });
    });
    $$("#futureFilters .chip").forEach(c => {
      c.addEventListener("click", () => {
        state.ui.futureFilter = c.dataset.filter;
        render();
      });
    });
    $$("#notesFilters .chip").forEach(c => {
      c.addEventListener("click", () => {
        state.ui.notesFilter = c.dataset.nfilter;
        render();
      });
    });

    let snoozePick = null;
    let snoozeBasis = "elapsed";
    $$("#snoozeChips .chip").forEach(c => {
      c.addEventListener("click", () => {
        $$("#snoozeChips .chip").forEach(x => x.classList.remove("on"));
        c.classList.add("on");
        const now = new Date();
        if (c.dataset.min) {
          snoozeBasis = "elapsed";
          snoozePick = Date.now() + parseInt(c.dataset.min, 10) * 60000;
        }
        else if (c.dataset.preset === "tonight") {
          snoozeBasis = "wall-clock";
          const d = new Date(); d.setHours(20, 0, 0, 0);
          if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
          snoozePick = d.getTime();
        } else if (c.dataset.preset === "tomorrow") {
          snoozeBasis = "wall-clock";
          const d = addDays(now, 1); d.setHours(9, 0, 0, 0);
          snoozePick = d.getTime();
        } else if (c.dataset.preset === "weekend") {
          snoozeBasis = "wall-clock";
          snoozePick = nextWeekend(now);
        }
        $("#snoozeCustom").value = toLocalInput(snoozePick);
      });
    });
    $("#snoozeCustom").addEventListener("change", () => {
      const v = $("#snoozeCustom").value;
      if (v) {
        snoozePick = parseLocalInput(v);
        snoozeBasis = "wall-clock";
      }
      $$("#snoozeChips .chip").forEach(x => x.classList.remove("on"));
    });
    $("#btnApplySnooze").addEventListener("click", () => {
      const id = state.ui.snoozeId;
      let when = snoozePick;
      if (!when && $("#snoozeCustom").value) {
        when = parseLocalInput($("#snoozeCustom").value);
        snoozeBasis = "wall-clock";
      }
      if (!when) { toast("请选择时间"); return; }
      if (snoozeItem(id, when, snoozeBasis) === false) return;
      closeSheet("sheetSnooze");
      hideAlert();
      snoozePick = null;
      snoozeBasis = "elapsed";
      $$("#snoozeChips .chip").forEach(x => x.classList.remove("on"));
      $("#snoozeCustom").value = "";
    });

    $("#btnSaveNote").addEventListener("click", saveNote);
    $("#swNotePin").addEventListener("click", () => {
      state.ui.notePin = !state.ui.notePin;
      $("#swNotePin").classList.toggle("on", state.ui.notePin);
    });
    $("#btnNotePreview").addEventListener("click", () => {
      const wrap = $("#notePreviewWrap");
      const show = wrap.hidden;
      wrap.hidden = !show;
      $("#btnNotePreview").textContent = show ? "隐藏预览" : "预览";
      if (show) $("#notePreview").innerHTML = renderMarkdown($("#noteBody").value);
    });
    $("#noteBody").addEventListener("input", () => {
      if (!$("#notePreviewWrap").hidden) {
        $("#notePreview").innerHTML = renderMarkdown($("#noteBody").value);
      }
    });

    $("#btnSearch").addEventListener("click", () => {
      openSheet("sheetSearch");
      doSearch("");
      setTimeout(() => $("#searchInput").focus(), 280);
    });
    $("#searchInput").addEventListener("input", e => doSearch(e.target.value));

    $("#swNotify").addEventListener("click", async () => {
      if (!state.settings.notify) {
        if (NativeReminders.isNativeAndroid && NativeReminders.isNativeAndroid()) {
          const status = await NativeReminders.requestNotificationPermission();
          setNativeReminderStatus(status);
          state.settings.notify = status.notifications === "granted";
          state.settings.notifyPrompted = true;
          toast(state.settings.notify ? "已开启 Android 原生通知" : "通知权限未授予，将使用应用内提醒");
          if (state.settings.notify) queueNativeReminderSync();
        } else if (isNativeAndroidRuntime()) {
          // Q6：安卓上**绝不允许**走下面的 Web 通知分支。
          // WebView 的 Notification.requestPermission() 会返回 granted（Capacitor 的
          // WebChromeClient 默认放行），于是开关显示「已开启」，而系统通知权限根本没授予 ——
          // reconcile 的 enabled 仍是 false，一条排程都不落，界面上却完全看不出来。
          // 宁可明确拒绝，也不给一个假的「开着」。
          state.settings.notify = false;
          state.settings.notifyPrompted = true;
          // 桥往往只是慢一点而不是不在，再给它一点时间
          const bridged = await waitForNativeBridge(1500);
          if (bridged) {
            const status = await NativeReminders.requestNotificationPermission();
            setNativeReminderStatus(status);
            state.settings.notify = status.notifications === "granted";
            toast(state.settings.notify
              ? "已开启 Android 原生通知"
              : "通知权限未授予，请到系统设置手动允许");
            if (state.settings.notify) queueNativeReminderSync();
          } else {
            toast("原生通知桥未就绪，请完全退出后重开应用再试");
          }
        } else if (typeof window !== "undefined" && window.Notification &&
          typeof window.Notification.requestPermission === "function") {
          const perm = await window.Notification.requestPermission();
          state.settings.notify = perm === "granted";
          toast(perm === "granted" ? "已开启本地通知" : "通知权限未授予，将使用应用内提醒");
        } else {
          toast("当前环境不支持系统通知，将使用应用内提醒");
          state.settings.notify = false;
        }
      } else {
        state.settings.notify = false;
        toast("已关闭本地通知");
      }
      save(); renderMe();
    });
    $("#btnExactAlarm").addEventListener("click", async () => {
      if (!isNativeAndroidRuntime()) return;
      await openSystemSetting("exact");
      try {
        const status = await NativeReminders.getPermissionState();
        setNativeReminderStatus(status);
        queueNativeReminderSync();
        renderMe();
      } catch (error) {}
    });
    const btnNotifySettings = $("#btnNotifySettings");
    if (btnNotifySettings) {
      btnNotifySettings.addEventListener("click", async () => {
        if (!isNativeAndroidRuntime()) return;
        await openSystemSetting("notify");
      });
    }
    const btnBatterySettings = $("#btnBatterySettings");
    if (btnBatterySettings) {
      btnBatterySettings.addEventListener("click", async () => {
        if (!isNativeAndroidRuntime()) return;
        await openSystemSetting("battery");
      });
    }
    $("#swDnd").addEventListener("click", () => {
      state.settings.dnd = !state.settings.dnd; save(); renderMe();
    });
    $("#swImp").addEventListener("click", () => {
      state.settings.importantRepeat = !state.settings.importantRepeat; save(); renderMe();
    });
    // D25：默认提醒方式（只影响之后录入）
    $$("#deliveryModeSeg .seg-item").forEach(btn => {
      btn.addEventListener("click", () => {
        state.settings.defaultDeliveryMode = btn.dataset.mode === "alarm" ? "alarm" : "notification";
        save();
        renderMe();
        queueNativeReminderSync();
        toast(state.settings.defaultDeliveryMode === "alarm"
          ? "默认提醒方式：闹钟（仅影响之后录入）"
          : "默认提醒方式：系统通知（仅影响之后录入）");
      });
    });
    $("#swSummary").addEventListener("click", () => {
      state.settings.dailySummary = !state.settings.dailySummary;
      if (state.settings.dailySummary) state.settings.lastSummaryAt = 0;
      save(); renderMe();
      toast(state.settings.dailySummary ? "轻量摘要已开启" : "轻量摘要已关闭");
    });
    $("#swPrivacy").addEventListener("click", () => {
      state.settings.privacyNotify = !state.settings.privacyNotify;
      save(); renderMe();
      toast(state.settings.privacyNotify ? "锁屏隐私已开启" : "锁屏隐私已关闭");
    });

    $("#btnProjects").addEventListener("click", () => {
      renderProjectsSheet();
      openSheet("sheetProjects");
    });
    $("#btnAddProject").addEventListener("click", addProject);

    $("#btnQuiet").addEventListener("click", () => {
      $("#quietStart").value = state.settings.quietStart || "23:00";
      $("#quietEnd").value = state.settings.quietEnd || "07:30";
      openSheet("sheetQuiet");
    });
    $("#btnSaveQuiet").addEventListener("click", () => {
      state.settings.quietStart = $("#quietStart").value || "23:00";
      state.settings.quietEnd = $("#quietEnd").value || "07:30";
      save();
      closeSheet("sheetQuiet");
      renderMe();
      toast("勿扰时段已更新");
    });

    // AI
    $("#btnAi").addEventListener("click", openAiSheet);
    $("#swAi").addEventListener("click", () => {
      $("#swAi").classList.toggle("on");
    });
    $$("#aiAutoChips .chip").forEach(ch => {
      ch.addEventListener("click", () => {
        $$("#aiAutoChips .chip").forEach(x => x.classList.remove("on"));
        ch.classList.add("on");
      });
    });
    $("#btnSaveAi").addEventListener("click", saveAiSettings);
    $("#btnAiTest").addEventListener("click", async () => {
      // apply current form values temporarily for test
      const prev = state.settings.ai;
      state.settings.ai = {
        enabled: $("#swAi").classList.contains("on"),
        baseUrl: ($("#aiBaseUrl").value || "").trim().replace(/\/+$/, ""),
        apiKey: ($("#aiApiKey").value || "").trim(),
        model: ($("#aiModel").value || "").trim(),
        autoOnSave: ($$("#aiAutoChips .chip.on")[0] || {}).dataset?.auto === "on"
      };
      const btn = $("#btnAiTest");
      btn.disabled = true;
      btn.textContent = "测试中…";
      try {
        await aiTestConnection();
        toast("连接成功");
      } catch (e) {
        toast("连接失败：" + (e && e.message ? e.message : "未知错误"));
      } finally {
        state.settings.ai = prev;
        btn.disabled = false;
        btn.textContent = "测试连接";
      }
    });
    $("#btnAiParse").addEventListener("click", () => runAiOnCapture("parse"));
    $("#btnAiPolish").addEventListener("click", () => runAiOnCapture("polish"));

    $("#btnExport").addEventListener("click", exportData);
    $("#btnImport").addEventListener("click", () => $("#importFile").click());
    $("#importFile").addEventListener("change", e => {
      const f = e.target.files && e.target.files[0];
      if (f) importDataFile(f);
      e.target.value = "";
    });
    $("#btnSeed").addEventListener("click", () => {
      try {
        seed();
        toast("示例数据已载入");
      } catch (e) {
        console.error(e);
        toast("载入失败：" + (e && e.message ? e.message : "未知错误"));
      }
    });
    $("#btnClear").addEventListener("click", async () => {
      const ok = await confirmDialog("确定清空本机全部事项、笔记与项目？", "清空数据");
      if (!ok) return;
      if (inflightActionDepth > 0) {
        toast("提醒操作正在保存 · 请稍后再清空数据");
        return;
      }
      state.items = []; state.notes = []; state.projects = [];
      save(); render(); toast("已清空");
    });
    $("#btnPrd").addEventListener("click", () => { location.href = "prd.html"; });

    $("#alertClose").addEventListener("click", e => {
      e.stopPropagation();
      dismissAlert();
    });
    $("#alertAck").addEventListener("click", () => {
      if (!alertItem) return;
      if (ackItem(alertItem.id, true) === false) return;
      toast("已确认看到");
      hideAlert();
    });
    $("#alertDone").addEventListener("click", () => {
      if (!alertItem || completeItem(alertItem.id) === false) return;
      hideAlert();
    });
    $("#alertSnooze").addEventListener("click", () => {
      if (!alertItem) return;
      if (isItemActionPending(alertItem.id)) { rejectPendingItemCommand(); return; }
      state.ui.snoozeId = alertItem.id;
      snoozePick = null;
      snoozeBasis = "elapsed";
      $("#snoozeCustom").value = "";
      $$("#snoozeChips .chip").forEach(x => x.classList.remove("on"));
      hideAlert();
      openSheet("sheetSnooze");
    });
    // D13：只有点 × 才关闭；点击页面其他区域不关闭（不再绑定 outside dismiss）
    // 已移除：$("#app") click → dismissAlert
  }

  /* ---------- init ---------- */
  let deferredInstallPrompt = null;

  function registerPwa() {
    if (NativeReminders.isNativeAndroid && NativeReminders.isNativeAndroid()) {
      renderPwaStatus();
      return;
    }
    const sw = navigator && navigator.serviceWorker;
    if (!sw || typeof sw.register !== "function") {
      renderPwaStatus();
      return;
    }
    sw.register("sw.js").then((reg) => {
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      if (reg && reg.addEventListener) {
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (nw) {
            nw.addEventListener("statechange", () => {
              if (nw.state === "installed" && sw.controller) {
                nw.postMessage({ type: "SKIP_WAITING" });
              }
            });
          }
        });
      }
      renderPwaStatus();
    }).catch(() => {
      renderPwaStatus();
    });

    if (typeof sw.addEventListener === "function") {
      sw.addEventListener("controllerchange", () => {
        // new SW took over; keep UI as-is to avoid reload loops
      });
      sw.addEventListener("message", (event) => {
        const data = event.data || {};
        if (data.type !== "notification-action") return;
        const id = data.itemId;
        if (id === "review-session" || data.tag === "review-session") {
          openReviewSession();
          return;
        }
        if (!id) return;
        if (data.action === "ack") {
          if (ackItem(id, true) === false) return;
          toast("已从通知确认看到");
          hideAlert();
        } else if (data.action === "done") {
          if (completeItem(id) === false) return;
          hideAlert();
        } else if (data.action === "snooze") {
          // D11：快捷稍后固定 2 小时
          if (snoozeItem(id, Date.now() + 2 * 3600000) === false) return;
          hideAlert();
        } else {
          openDetail(id);
        }
      });
    }
  }

  function bindInstall() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      const btn = $("#btnInstall");
      if (btn) btn.hidden = false;
    });
    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      const btn = $("#btnInstall");
      if (btn) btn.hidden = true;
      toast("已安装到主屏幕");
    });
    const btn = $("#btnInstall");
    if (btn) {
      btn.addEventListener("click", async () => {
        if (!deferredInstallPrompt) {
          toast("当前浏览器不支持直接安装，可使用「添加到主屏幕」");
          return;
        }
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        btn.hidden = true;
      });
    }
  }

  // Native deliveries can outlive their window, or have no item (diagnostic/removed item).
  let committedAlarmItems = [];
  function deliveryHandledByCommittedItem(alarm, item) {
    if (!item) return false;
    if (isTerminal(item)) return true;
    // ACK/snooze only ends an older delivery; a new deadline alert with the current
    // revision is independent and must remain actionable.
    return (item.status === "acknowledged" || item.status === "snoozed") &&
      hasKnownRev(alarm.itemRev) && Number(item.rev) > Number(alarm.itemRev);
  }
  async function completeActiveAlarm(alarm) {
    const bridge = systemBridge();
    const eventId = "active:" + alarm.token + ":done";
    const completed = await handleAlarmAction({ action: "done", itemId: alarm.itemId,
      itemRev: alarm.itemRev, alarmEventId: eventId });
    if (!completed && !alarmEventSeen(eventId)) throw new Error("提醒已变更，请在事项详情中确认；仍可停止声振");
    await bridge.stopAlarmDelivery({ id: alarm.id, token: alarm.token });
    return true;
  }
  let activeAlarmRefreshBusy = false;
  let activeAlarmPanelSignature = "";
  async function refreshActiveAlarmPanel(reveal) {
    const host = $("#activeAlarmPanel");
    const bridge = systemBridge();
    if (!host || !bridge || !bridge.activeAlarmDeliveries || activeAlarmRefreshBusy) return;
    activeAlarmRefreshBusy = true;
    try {
      const result = await bridge.activeAlarmDeliveries();
      const rows = [];
      for (const alarm of result.alarms || []) {
        const item = state.items.find(it => it.id === alarm.itemId);
        // Current committed item state wins over an old delivery; never change it from a stale alarm.
        const committedItem = committedAlarmItems.find(it => it.id === alarm.itemId);
        if (deliveryHandledByCommittedItem(alarm, committedItem)) {
          await bridge.stopAlarmDelivery({ id: alarm.id, token: alarm.token });
          continue;
        }
        const canComplete = item && hasKnownRev(alarm.itemRev) && Number(item.rev) === Number(alarm.itemRev);
        rows.push({ alarm, item, canComplete });
      }
      const signature = JSON.stringify(rows.map(({alarm,item}) => [alarm, item && item.title, item && item.rev]));
      if (signature === activeAlarmPanelSignature) {
        if (reveal && rows.length) host.scrollIntoView({ block: "start" });
        return;
      }
      activeAlarmPanelSignature = signature;
      host.hidden = rows.length === 0;
      host.innerHTML = rows.map(({alarm,item,canComplete}, index) =>
        '<div class="card" style="margin-bottom:12px;padding:16px;border:2px solid var(--accent)">' +
        '<strong>闹钟待处理</strong><p>' + escapeHtml(item ? item.title : alarm.title || "闹钟提醒") + '</p>' +
        '<p style="color:var(--muted)">' + escapeHtml(item ? "全屏未显示时，也可以在这里处理。" :
          "测试提醒或原事项已不存在，仍可停止声振。") + '</p>' +
        '<button class="btn" data-alarm-stop="' + index + '">停止声振</button> ' +
        (canComplete ? '<button class="btn" data-alarm-done="' + index + '">完成事项</button>' : '') + '</div>'
      ).join("");
      if (reveal && rows.length) host.scrollIntoView({ block: "start" });
      host.querySelectorAll("[data-alarm-stop], [data-alarm-done]").forEach(button => {
        button.addEventListener("click", async () => {
          button.disabled = true;
          const done = button.hasAttribute("data-alarm-done");
          const row = rows[Number(button.getAttribute(done ? "data-alarm-done" : "data-alarm-stop"))];
          try {
            if (done) {
              // Persist completion first; a failed save must remain visible and retryable.
              await completeActiveAlarm(row.alarm);
            } else {
              await bridge.stopAlarmDelivery({ id: row.alarm.id, token: row.alarm.token });
            }
            activeAlarmPanelSignature = "";
            toast(done ? "已完成并停止声振" : "已停止本次声振，事项状态未改变");
            await refreshActiveAlarmPanel();
          } catch (error) { toast(error.message || "操作失败，请重试"); }
          finally { button.disabled = false; }
        });
      });
    } catch (error) {
      // Keep existing stop controls on a transient bridge failure.
    } finally { activeAlarmRefreshBusy = false; }
  }

  // N-03：轮询句柄必须留痕。`bindNetwork` 目前只在 `init()` 里调一次，
  // 但重复初始化（热重载、将来多实例挂载）会静默堆出多个 2 秒定时器且无人能清 —— 先清后建。
  let activeAlarmPollTimer = null;
  function bindNetwork() {
    if (activeAlarmPollTimer != null) clearInterval(activeAlarmPollTimer);
    activeAlarmPollTimer = setInterval(() => {
      if (document.visibilityState === "visible") refreshActiveAlarmPanel();
    }, 2000);
    window.addEventListener("online", renderPwaStatus);
    window.addEventListener("offline", renderPwaStatus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        // Q6：切回前台是补做原生初始化的天然时机。
        // 冷启动时若桥还没注入（存在稳定时间差），这里的 ensure 会再试一遍并把排程补上。
        if (!nativeReady) queueNativeReminderSync();
        promoteDue();
        refreshActiveAlarmPanel(true);
        tick();
      }
    });
  }

  function handleQueryActions() {
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab");
    if (tab === "future" || tab === "notes" || tab === "me" || tab === "home") {
      state.ui.tab = tab;
      if (tab === "future") state.ui.futureSeg = "waiting";
    }
    const action = params.get("action");
    if (action === "capture") {
      setTimeout(() => openCapture(), 200);
    }
    // D20：通知/深链直达整理会话
    if (action === "review" || params.get("itemId") === "review-session") {
      state.ui.tab = "home";
      setTimeout(() => openReviewSession(), 250);
    }
    // 全屏闹钟动作回传
    const alarmAction = params.get("alarmAction");
    if (alarmAction) {
      handleAlarmAction({
        action: alarmAction,
        itemId: params.get("alarmItem") || params.get("alarmItemId"),
        itemRev: params.get("alarmItemRev") || params.get("itemRev")
      });
      try { history.replaceState(null, "", location.pathname); } catch (e) {}
    }
  }

  async function init() {
    window.addEventListener("error", (e) => {
      console.error("App error:", e && e.message, e && e.error);
      try {
        const host = document.getElementById("homeEmpty") || document.getElementById("main");
        if (host && !host.dataset.errShown) {
          host.dataset.errShown = "1";
          const div = document.createElement("div");
          div.className = "hint-bar";
          div.style.color = "#8f3a3a";
          div.style.background = "#f6e8e8";
          div.textContent = "脚本出错：" + (e && e.message ? e.message : "unknown");
          host.insertBefore(div, host.firstChild);
        }
      } catch (err) {}
    });

    const loaded = await loadAsync();
    bind();
    if (schemaMigrationNeeded) {
      schemaMigrationNeeded = false;
      save();
    }
    // Q6：原生初始化**不挡在启动链上**（幂等、可重试、内部已兜错）。
    // 它内部要跨桥通信（注册动作类型 / 挂监听 / 建通知渠道 / 首次对账），
    // 任何一步慢或抛错都会把下面的 seed / render / 15 秒心跳一起拖住 ——
    // 而 V1 已经证明这类中断是静默的：界面照常可点，数据永不落库。
    ensureNativeReminders();
    // D11/D12：监听全屏闹钟动作
    //
    // Q1：这里**必须**兜住异常。监听注册是「旁路能力」而不是启动前提，
    // 一旦它抛错就会顺次打断下面整条启动链（seed / render / 15 秒心跳 / 角标），
    // 而表现只是「界面照常可点、数据永不落库」—— 极难发现。
    // 兜住之后最坏结果退化为「全屏闹钟动作不被监听」，其余功能照常。
    if (NativeReminders.onAlarmAction) {
      try {
        NativeReminders.onAlarmAction(handleAlarmAction);
      } catch (error) {
        console.error(
          "Alarm action listener registration failed:",
          error && error.message ? error.message : error
        );
      }
    }
    // 兼容深链：?alarmAction=&alarmItem=
    maybePromptAndroidNotify();
    maybeReviewSession();
    scheduleNextReviewAlarm();
    registerPwa();
    bindInstall();
    bindNetwork();
    if (!applyShareParams()) {
      // 首次运行：没有任何已保存数据时才 seed（与后端无关）
      if (!loaded && !state.items.length) seed();
      else render();
    } else {
      state.ui.tab = "home";
      render();
    }
    handleQueryActions();
    render();
    maybeDailySummary();
    setInterval(tick, 15000);
    tick();
    updateAppBadge();
  }

  /**
   * G5：**初始化完成信号**。
   *
   * 冷启动的 init() 是异步的：`loadAsync()` 恢复持久化状态时，`applyParsedState`
   * 会**整体替换** `state.items` / `state.settings`（并重建全部事项对象）。
   * 任何在它完成之前对 `state` 的写入都会被这次恢复覆盖 —— 写入者手里的引用
   * 也随之变成「不在库里的孤儿对象」。
   *
   * 所以「脚本已加载」≠「应用已就绪」。测试与调试代码必须先 `await ready()` 再准备状态。
   */
  let readyPromise = null;

  function startApp() {
    // 同步启动，保持与之前一致的启动时机；只把结果包成一个总是兑现的 Promise
    const running = init();
    readyPromise = running.then(() => true, err => {
      console.error("App init failed:", err && err.message ? err.message : err);
      return false;
    });
    return readyPromise;
  }

  /* ---------- 给可重放状态命令装上统一日志 ---------- */

  /**
   * 单个事项上、用户能直接触发的**业务操作**在这里统一包一层。
   *
   * 这些入口只改事项状态，参数是**自足的值**（id / 时间戳 / 字段快照）。
   * 同事务域的入口在提交未决时拒绝；不相关事项的入口可按原顺序重放。
   *
   * 刻意**不包**：
   *  · `promoteDue` / 渲染 —— 自动推进在提交窗口延后，下一拍会自己重算；展示不写状态；
   *  · `saveItemFromForm` —— 它要读表单，重放时表单已关；改为在内部单独记录
   *    `applyItemEdit`（见该函数）。
   *
   * `markReviewDone(item, extra)` 一并包上：它是**参数自足的纯字段写入**（不碰别的状态），
   * 整理确认、截止对账、真实送达回调和原生时间迁移也写同一 items 状态，因此同样纳入。
   */
  const itemCommand = { userFacing: true, itemArg: 0 };
  ackItem = wrapUserOp(ackItem, Object.assign({ name: "ackItem" }, itemCommand));
  snoozeItem = wrapUserOp(snoozeItem, Object.assign({ name: "snoozeItem" }, itemCommand));
  completeItem = wrapUserOp(completeItem, Object.assign({ name: "completeItem" }, itemCommand));
  reopenItem = wrapUserOp(reopenItem, Object.assign({ name: "reopenItem" }, itemCommand));
  restoreItem = wrapUserOp(restoreItem, Object.assign({ name: "restoreItem" }, itemCommand));
  resumeDeadlineProtection = wrapUserOp(resumeDeadlineProtection, Object.assign({ name: "resumeDeadlineProtection" }, itemCommand));
  deleteItem = wrapUserOp(deleteItem, Object.assign({ name: "deleteItem" }, itemCommand));
  stopRepeat = wrapUserOp(stopRepeat, Object.assign({ name: "stopRepeat" }, itemCommand));
  markReviewDone = wrapUserOp(markReviewDone, Object.assign({ name: "markReviewDone" }, itemCommand));
  applyDeadlineEvents = wrapUserOp(applyDeadlineEvents);
  markDeadlineDelivered = wrapUserOp(markDeadlineDelivered);
  refreshNativeScheduleBasis = wrapUserOp(refreshNativeScheduleBasis);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { startApp(); });
  } else {
    startApp();
  }

  // Dev/test hook — no user-facing effect
  if (typeof globalThis !== "undefined") {
    globalThis.__ATTENTION_INBOX__ = {
      parseChineseTime,
      makeItem,
      nextRepeatTrigger,
      nthWeekdayOfNextMonth,
      nthWeekdayInMonth,
      lastDayOfMonth,
      repeatLabel,
      findSimilarItems,
      isDue,
      inQuietHours,
      quietEnd,
      promoteDue,
      ackItem,
      completeItem,
      snoozeItem,
      reopenItem,
      restoreItem,
      deleteItem,
      seed,
      hasSpecificTimeWord,
      fallbackTriggerAt,
      resolveDeliveryMode,
      ensureReviewSettings,
      inReviewHighlight,
      // 渲染 / 会话 / 弹条 —— 供测试直接断言行为，无用户可见副作用
      renderHome,
      renderReviewEntry,
      renderReviewCard,
      openReviewSession,
      maybeReviewSession,
      needsReviewItems,
      detectNeedsReview,
      // L05：整理会话出口与时间来源判断
      reviewConfirm,
      reviewSaveEdit,
      reviewKeepCurrent,
      resolveReviewTrigger,
      markReviewDone,
      markReviewTriggerPicked: (v) => { reviewTriggerUserPicked = !!v; },
      // L03 / D23：规则级二级操作与截止保护恢复
      stopRepeat,
      resumeDeadlineProtection,
      // F1：截止事件按阶段记账
      applyDeadlineEvents,
      markDeadlineDelivered,
      // D43：单次提醒台账（与截止台账同构）
      applyReminderEvents,
      // H-07：IDB 恢复后重放降级期的改动
      replayPendingSnapshot,
      showAlert,
      hideAlert,
      dismissAlert,
      // H-08：投递归因（自检面板的结论由它产生，必须能被行为级断言）
      describeAlarmDelivery,
      // A-2 / D68：首页告知条的判定与渲染（纯逻辑 + DOM，都要能被行为级断言）
      homeNoticeVerdict,
      renderHomeNotice,
      // A-2：原生状态的唯一漏斗 —— 「权限恢复后警告自动消失」这句话就是经它成立的，
      // 所以断言必须穿过它，而不是绕过它去直接摆状态
      setNativeReminderStatus,
      handleAlarmAction,
      completeActiveAlarm,
      deliveryHandledByCommittedItem,
      alarmEventSeen,
      // G5：初始化完成信号（loadAsync/applyParsedState 已不再改动 state）
      ready: () => readyPromise || Promise.resolve(true),
      handleNativeNotificationAction,
      saveItemFromForm,
      markTriggerPicked: (v) => { triggerUserPicked = !!v; },
      clearAlert: () => { alertItem = null; },
      get state() { return state; },
      save,
      // 真实的持久化 Promise：测试要断言「落库之后」的状态就必须等它
      saveAsync,
      load,
      // H-07：降级恢复的取证入口（探测器需要在不重启页面的情况下重放一次）
      loadAsync,
      normalizeAiResult,
      extractJson,
      renderMarkdown,
      uid,
      startOfDay,
      addDays,
      sameDay,
      applyClock
    };
    // Console helper for manual recovery in preview
    globalThis.seedAttentionInbox = seed;
  }
})();
