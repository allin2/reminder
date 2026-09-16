/* 安心收件箱 — Local-first attention hub
 * 原则：Attention ≠ Task · Acknowledged ≠ Completed · Future 默认不可见
 */
(function () {
  "use strict";

  const KEY = "attention-inbox-v2";
  const SCHEMA = 4;
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
      const clock2 = text.match(/(上午|中午|下午|晚上|早上)?\s*([0-9一二两三四五六七八九十]+)\s*[点時时](\s*([0-9一二三四五六七八九十]+)\s*分?)?/);
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

  function save() {
    const payload = {
      schema: SCHEMA,
      items: state.items,
      notes: state.notes,
      projects: state.projects,
      settings: state.settings
    };
    if (storage && storageReady) {
      storage.save(payload).catch(() => {
        try { localStorage.setItem(KEY, JSON.stringify(payload)); } catch (e) {}
      });
      queueNativeReminderSync();
      return;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(payload));
    } catch (e) { /* quota */ }
    queueNativeReminderSync();
  }

  function applyParsedState(parsed) {
    schemaMigrationNeeded = parsed.schema !== SCHEMA || (Array.isArray(parsed.items) && parsed.items.some(it =>
      !it || !it.scheduleBasis || it.dismissedUntil === undefined
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
  }

  async function loadAsync() {
    if (storage) {
      try {
        const parsed = await storage.load();
        storageReady = true;
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
      isFallbackTrigger: !!it.isFallbackTrigger
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

  function reviewSessionKey(d) {
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate() +
      "T" + d.getHours() + ":" + d.getMinutes();
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
    if (!inReviewWindow(now) && !(rs.snoozedUntil && now >= rs.snoozedUntil && now < rs.snoozedUntil + 3600000)) {
      // allow snoozed follow-up outside window briefly handled above
      if (!rs.snoozedUntil) return;
    }

    const key = reviewSessionKey(new Date(now));
    const windowOpen = inReviewWindow(now);
    const snoozeDue = rs.snoozedUntil && now >= rs.snoozedUntil;
    if (!windowOpen && !snoozeDue) return;

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
    const parsedHint = it.isFallbackTrigger || !it.triggerAt
      ? "未设定时间 · 已用兜底值（" + fmtTime(it.triggerAt || fallbackTriggerAt()) + " 的整理窗口）"
      : fmtTime(it.triggerAt) + (it.deadlineAt ? " · 截止 " + fmtDate(it.deadlineAt) : "");
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
      '<div class="field"><label for="reviewTrigger">提醒时间</label><input id="reviewTrigger" type="datetime-local" value="' + toLocalInput(it.triggerAt) + '" /></div>' +
      '<div class="field"><label for="reviewNote">备注（可选）</label><input id="reviewNote" type="text" value="' + escapeHtml(it.note || "") + '" placeholder="例如：主要想看它的调度机制" /></div>';

    const foot = $("#reviewFoot");
    if (foot) {
      foot.innerHTML =
        '<button class="btn secondary" id="reviewDelete">删除</button>' +
        '<button class="btn secondary" id="reviewConfirm">确认</button>' +
        '<button class="btn primary" id="reviewSave">保存修改</button>';
      $("#reviewDelete").onclick = reviewDelete;
      $("#reviewConfirm").onclick = reviewConfirm;
      $("#reviewSave").onclick = reviewSaveEdit;
    }
  }

  function markReviewDone(item, extra) {
    item.review_status = "REVIEWED";
    item.reviewed_at = Date.now();
    item.isFallbackTrigger = false;
    if (extra && extra.triggerAt != null) {
      item.triggerAt = extra.triggerAt;
      item.scheduleBasis = "wall-clock";
      item.localTrigger = toLocalInput(extra.triggerAt);
      if (item.triggerAt > Date.now() && (item.status === "due" || item.status === "acknowledged")) {
        item.status = "waiting";
      }
    }
    if (extra && extra.title != null) item.title = extra.title;
    if (extra && extra.note != null) item.note = extra.note;
  }

  function reviewConfirm() {
    const it = currentReviewItem();
    if (!it) return;
    const triggerInput = $("#reviewTrigger");
    const triggerAt = triggerInput ? parseLocalInput(triggerInput.value) : it.triggerAt;
    // D17：无时间时兜底为下一个 Review Window，而不是 now+7 天
    markReviewDone(it, { triggerAt: triggerAt || fallbackTriggerAt() });
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
    const triggerAt = parseLocalInput($("#reviewTrigger") ? $("#reviewTrigger").value : "") || it.triggerAt;
    const note = $("#reviewNote") ? $("#reviewNote").value.trim() : it.note;
    markReviewDone(it, { title, triggerAt: triggerAt || fallbackTriggerAt(), note });
    save();
    state.ui.reviewIndex += 1;
    queueNativeReminderSync();
    renderReviewCard();
    render();
  }

  function reviewDelete() {
    const it = currentReviewItem();
    if (!it) return;
    state.items = state.items.filter(x => x.id !== it.id);
    save();
    state.ui.reviewIndex += 1;
    renderReviewCard();
    render();
    toast("已删除该条记录");
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
    now = now || Date.now();
    const reviewEnabled = ensureReviewSettings().enabled;
    let changed = false;
    state.items.forEach(it => {
      // D17：Review 开启时，NEEDS_REVIEW 兜底记录永不进 due；
      // Review 关闭时退为普通事项，正常提醒
      if (reviewEnabled && it.review_status === "NEEDS_REVIEW") return;
      if (it.status === "waiting" || it.status === "snoozed") {
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
      if (it.status === "acknowledged" && it.deadlineAt) {
        const daysLeft = (it.deadlineAt - now) / 86400000;
        if (daysLeft <= 1.05 && daysLeft > -1) {
          it.status = "due";
          it.deliveredAt = now;
          it.remindCount = 0;
          it.lastRemindAt = now;
          it.lastAlertShownAt = null;
          changed = true;
        }
      }
    });
    if (changed) save();
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

  function ackItem(id, silent) {
    const it = state.items.find(x => x.id === id);
    if (!it) return;
    it.status = "acknowledged";
    it.acknowledgedAt = Date.now();
    it.lastRemindAt = null;
    save();
    if (!silent) toast("已确认看到 · 仍保持未完成");
    render();
  }

  // Prefer lib implementations when loaded (single source of truth)
  if (Lib.parseChineseTime) parseChineseTime = Lib.parseChineseTime;
  if (Lib.nextRepeatTrigger) nextRepeatTrigger = Lib.nextRepeatTrigger;
  if (Lib.repeatLabel) repeatLabel = Lib.repeatLabel;
  if (Lib.nextRepeatPreview) nextRepeatPreview = Lib.nextRepeatPreview;

  function completeItem(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return;
    it.status = "archived";
    it.completedAt = Date.now();
    if (it.repeat && it.repeat.every) {
      const nextTrigger = nextRepeatTrigger(it, it.acknowledgedAt || Date.now());
      if (nextTrigger) {
        state.items.push(makeItem({
          title: it.title,
          note: it.note,
          tags: it.tags.slice(),
          url: it.url,
          projectId: it.projectId,
          priority: it.priority,
          status: "waiting",
          repeat: it.repeat,
          triggerAt: nextTrigger,
          scheduleBasis: "wall-clock",
          localTrigger: toLocalInput(nextTrigger),
          deadlineAt: null,
          // 下一周期继承投递方式快照（有标记仍为 alarm）
          delivery_mode: resolveDeliveryMode(it.priority)
        }));
      }
    }
    save();
    toast(it.repeat ? "已完成 · 下一周期已生成" : "已完成并归档");
    render();
  }

  function snoozeItem(id, when, basis) {
    const it = state.items.find(x => x.id === id);
    if (!it) return;
    const snoozedAt = Date.now();
    it.status = "snoozed";
    it.triggerAt = when;
    it.scheduleBasis = basis === "wall-clock" ? "wall-clock" : "elapsed";
    it.localTrigger = it.scheduleBasis === "wall-clock" ? toLocalInput(when) : null;
    it.snoozedAt = it.scheduleBasis === "elapsed" ? snoozedAt : null;
    it.snoozeDelayMs = it.scheduleBasis === "elapsed" ? Math.max(0, when - snoozedAt) : null;
    it.dismissedUntil = null;
    it.snoozeCount = (it.snoozeCount || 0) + 1;
    save();
    toast("已改到 " + fmtTime(when));
    render();
  }

  function deleteItem(id) {
    state.items = state.items.filter(x => x.id !== id);
    save();
    toast("已删除");
    render();
  }

  function reopenItem(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return;
    const snoozedAt = Date.now();
    it.status = "snoozed";
    it.triggerAt = snoozedAt + 2 * 3600000;
    it.scheduleBasis = "elapsed";
    it.localTrigger = null;
    it.snoozedAt = snoozedAt;
    it.snoozeDelayMs = 2 * 3600000;
    it.dismissedUntil = null;
    save();
    toast("将在 2 小时后再次提醒");
    render();
  }

  /** D23：归档重开不设 trigger_at（不自动提醒），可选给一次极简时间选择 */
  function restoreItem(id) {
    const it = state.items.find(x => x.id === id);
    if (!it) return;
    it.status = "waiting";
    it.completedAt = null;
    it.triggerAt = null;
    it.scheduleBasis = null;
    it.localTrigger = null;
    it.snoozedAt = null;
    it.snoozeDelayMs = null;
    it.dismissedUntil = null;
    save();
    toast("已恢复 · 不会自动提醒", "设置时间", () => {
      state.ui.snoozeId = it.id;
      openSheet("sheetSnooze");
    });
    render();
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
    const now = Date.now();
    const dueMap = new Map();
    const reviewEnabled = ensureReviewSettings().enabled;
    state.items.forEach(it => {
      if (reviewEnabled && it.review_status === "NEEDS_REVIEW") return;
      if (isDue(it, now) || it.status === "due") dueMap.set(it.id, it);
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

    // D8：空态里一句纯文字完成数；当天完成卡片只在空态容身
    const quiet = !dueList.length && !active.length;
    $("#homeEmpty").innerHTML = quiet
      ? '<div class="empty"><div class="empty-mark">✓</div><h3>此刻很安静</h3>' +
        "<p>没有需要你注意的事项。已交给系统的未来，会自己在合适的时候回来。</p>" +
        (doneToday.length
          ? '<p style="margin-top:12px;font-size:0.92rem;color:var(--ink-2)">今天已完成 ' + doneToday.length + " 件</p>" +
            doneToday.map(it => renderItemCard(it, "archived")).join("")
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
      const reliability = state.settings.notify ? nativeReminderStatus.reliability : "in-app";
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
      sub.textContent = reliability === "exact" ? "原生精确提醒已就绪 · 数据本地保存" :
        reliability === "inexact" ? "原生提醒已开 · 时间可能延迟" :
        reliability === "error" ? "原生提醒同步失败 · 请重新打开设置" :
        "通知未授权 · 仅应用内提醒";
      return;
    }
    const online = navigator.onLine;
    const swReady = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    const notify = state.settings.notify && "Notification" in window && Notification.permission === "granted";
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
      $("#capTrigger").value = "";
      $("#capDeadline").value = "";
      return;
    }
    const p = parseChineseTime(text);
    $("#capTrigger").value = toLocalInput(p.trigger);
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
    if (p.confidence === "high" || p.confidence === "mid") {
      msg = "已设置：" + fmtTime(p.trigger);
      if (p.deadline) msg += " · 截止 " + fmtDate(p.deadline);
      if (p.repeat) msg += " · " + repeatLabel(p.repeat);
      msg += " · 可修改";
    } else {
      msg = "未识别精确时间，默认一周后：" + fmtTime(p.trigger) + " · 保存前请确认";
    }
    $("#capHint").textContent = msg;
    $("#capHint").classList.remove("muted");
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
      const triggerAt = parseLocalInput($("#capTrigger").value) || (parsed ? parsed.trigger || parsed.triggerAt : null);
      const deadlineAt = parseLocalInput($("#capDeadline").value) || (parsed ? parsed.deadline || parsed.deadlineAt : null);
      const repeat = formRepeat() || (parsed && parsed.repeat
        ? (parsed.repeat.every === "nthWeekday"
            ? { every: "nthWeekday", mode: parsed.repeat.mode || "calendar", nth: parsed.repeat.nth || 1, dow: parsed.repeat.dow != null ? parsed.repeat.dow : 1 }
            : parsed.repeat)
        : null);

      if (editing) {
        editing.title = title;
        editing.note = $("#capNote").value.trim();
        editing.tags = tags;
        editing.url = $("#capUrl").value.trim();
        editing.projectId = $("#capProject").value || "";
        editing.priority = priority;
        // D25 编辑重算快照
        editing.delivery_mode = resolveDeliveryMode(priority);
        editing.triggerAt = triggerAt;
        editing.scheduleBasis = "wall-clock";
        editing.localTrigger = toLocalInput(triggerAt);
        editing.snoozedAt = null;
        editing.snoozeDelayMs = null;
        editing.dismissedUntil = null;
        editing.deadlineAt = deadlineAt;
        editing.repeat = repeat;
        if (triggerAt && triggerAt > Date.now() && (editing.status === "due" || editing.status === "acknowledged")) {
          editing.status = "waiting";
        }
        save();
        closeSheet("sheetItem");
        closeSheet("sheetDetail");
        render();
        toast("已保存修改");
        queueNativeReminderSync();
        return;
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
        scheduleBasis: "wall-clock",
        localTrigger: toLocalInput(triggerAt),
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
        // D17：未用户确认的兜底时间 → 下一个 Review Window
        if (!item.triggerAt || (!lowConfUserPicked && parsed && (parsed.confidence === "low" || parsed.confidence === "none"))) {
          item.triggerAt = fallbackTriggerAt();
          item.scheduleBasis = "wall-clock";
          item.localTrigger = toLocalInput(item.triggerAt);
          item.isFallbackTrigger = true;
        }
      }
      state.items.push(item);
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
        finishSave(localP);
        return;
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

    finishSave(null);
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
    $("#detailFoot").innerHTML = foot;
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
    state.projects = state.projects.filter(p => p.id !== id);
    state.items.forEach(it => { if (it.projectId === id) it.projectId = ""; });
    state.notes.forEach(n => { if (n.projectId === id) n.projectId = ""; });
    save();
    renderProjectsSheet();
    toast("已删除项目");
  }

  /* ---------- notifications ---------- */
  let alertItem = null;
  const dismissedAlerts = Object.create(null);

  function setNativeReminderStatus(status) {
    nativeReminderStatus = Object.assign({}, nativeReminderStatus, status || {});
    if (state.ui.tab === "me") renderPwaStatus();
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

  async function syncNativeRemindersNow() {
    if (!nativeReady || !NativeReminders.reconcile) return nativeReminderStatus;
    try {
      const status = await NativeReminders.reconcile(state.items, state.settings, Date.now());
      setNativeReminderStatus(status);
      return status;
    } catch (error) {
      const status = { reliability: "error", error: error && error.message ? error.message : String(error) };
      setNativeReminderStatus(status);
      return status;
    }
  }

  function queueNativeReminderSync() {
    if (!nativeReady || !NativeReminders.reconcile) return;
    if (nativeSyncTimer) clearTimeout(nativeSyncTimer);
    nativeSyncTimer = setTimeout(() => {
      nativeSyncTimer = null;
      syncNativeRemindersNow();
    }, 80);
  }

  function handleNativeNotificationAction(event) {
    if (!event) return;
    // D20：待整理通知点击直达整理会话
    if (event.itemId === "review-session" || event.managedKind === "review-session") {
      if (event.action === "ack" || event.action === "snooze" || event.action === "done") {
        // 快捷动作：完成=开始整理；稍后=30 分钟后再提
        if (event.action === "done" || event.action === "ack") {
          openReviewSession();
        } else {
          snoozeReview(30 * 60 * 1000, "30 分钟");
        }
        return;
      }
      openReviewSession();
      return;
    }
    if (!event.itemId) return;
    const id = event.itemId;
    if (event.action === "ack") {
      ackItem(id, true);
      toast("已从通知确认看到");
      hideAlert();
    } else if (event.action === "snooze") {
      // D11：快捷「稍后」固定 2 小时
      snoozeItem(id, Date.now() + 2 * 3600000);
      hideAlert();
    } else if (event.action === "done") {
      completeItem(id);
      hideAlert();
    } else {
      openDetail(id);
    }
  }

  /** 全屏闹钟四动作（D11/D12）：ack / snooze2h / done / close（close 不写 ACK） */
  function handleAlarmAction(data) {
    const action = data && (data.action || data.actionId);
    const itemId = data && (data.itemId || data.item_id);
    if (!action) return;
    if (action === "close") {
      hideAlert();
      return;
    }
    if (!itemId) return;
    if (action === "ack") {
      ackItem(itemId, true);
      toast("已确认看到 · 仍保持未完成");
    } else if (action === "snooze") {
      snoozeItem(itemId, Date.now() + 2 * 3600000);
    } else if (action === "done") {
      completeItem(itemId);
    }
    queueNativeReminderSync();
  }

  function systemBridge() {
    if (NativeReminders.systemBridge) return NativeReminders.systemBridge();
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SystemBridge
      ? window.Capacitor.Plugins.SystemBridge
      : null;
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
    if (!diag.available) {
      $("#labNotifyPerm").textContent = diag.reason || "原生桥不可用";
      setPill($("#labNotifyPill"), "异常", false, false);
      $("#labExact").textContent = "无法检测";
      setPill($("#labExactPill"), "未知", false, true);
      $("#labBattery").textContent = "无法检测";
      setPill($("#labBatteryPill"), "未知", false, true);
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
    $("#labBattery").textContent = batteryOk ? "已忽略电池优化" : "未加入白名单 · 后台可能被限制";
    setPill($("#labBatteryPill"), batteryOk ? "正常" : "建议开启", batteryOk, !batteryOk);

    if (notifyOk && state.settings.notify === false) {
      state.settings.notify = true;
      save();
      renderMe();
    }
    labLog("诊断完成 · SDK " + diag.sdkInt +
      " · 通知 " + (notifyOk ? "OK" : "NO") +
      " · 精确闹钟 " + (exactOk ? "OK" : "降级"));
    return diag;
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
        title: "安心收件箱闹钟测试",
        body: label + "闹钟触发成功 · 可锁屏验证"
      });
      labLog("已设置 " + label + " 闹钟 · " + (r.mode || (r.exact ? "精确" : "非精确")) +
        (r.alarmClock ? " · 全屏闹钟" : "") +
        " · 触发于 " + fmtTime(r.triggerAt));
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

    const reviewSnoozeBtn = $("#reviewSnooze");
    if (reviewSnoozeBtn) reviewSnoozeBtn.addEventListener("click", () => openSheet("sheetReviewSnooze"));
    const reviewSkipBtn = $("#reviewSkip");
    if (reviewSkipBtn) reviewSkipBtn.addEventListener("click", skipReviewThisTime);

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
    if (!NativeReminders.isNativeAndroid || !NativeReminders.isNativeAndroid()) return;
    try {
      const status = await NativeReminders.initialize({
        onAction: handleNativeNotificationAction,
        onStatusChange: setNativeReminderStatus,
        onResume: async () => {
          try {
            if (NativeReminders.getPermissionState) {
              const status = await NativeReminders.getPermissionState();
              setNativeReminderStatus(status);
              if (status.notifications === "granted" && !state.settings.notify) {
                state.settings.notify = true;
                save();
              }
              renderMe();
            }
          } catch (error) {}
          // 消费全屏闹钟动作
          try {
            const bridge = systemBridge();
            if (bridge && bridge.consumeAlarmAction) {
              const r = await bridge.consumeAlarmAction();
              if (r && r.action) handleAlarmAction(r);
            }
          } catch (error) {}
          refreshNativeScheduleBasis();
          promoteDue();
          queueNativeReminderSync();
        }
      });
      nativeReady = true;
      setNativeReminderStatus(status);
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
    if (!("Notification" in window) || Notification.permission !== "granted") return;
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
      dismissedAlerts[alertItem.id] = now;
      alertItem.dismissedUntil = now + 30 * 60 * 1000;
      save();
    }
    hideAlert();
    toast("已关闭提醒 · 事项仍在首页");
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
    $("#capTrigger").addEventListener("change", updateRepeatPreview);

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
        if (act === "ack") { ackItem(id); closeSheet("sheetDetail"); hideAlert(); }
        else if (act === "done") { completeItem(id); closeSheet("sheetDetail"); hideAlert(); }
        else if (act === "snooze") {
          state.ui.snoozeId = id;
          snoozePick = null;
          snoozeBasis = "elapsed";
          $("#snoozeCustom").value = "";
          $$("#snoozeChips .chip").forEach(x => x.classList.remove("on"));
          closeSheet("sheetDetail");
          openSheet("sheetSnooze");
        }
        else if (act === "reopen") { reopenItem(id); closeSheet("sheetDetail"); }
        else if (act === "delete") {
          const okDel = await confirmDialog("确定删除这条事项？", "删除");
          if (okDel) {
            deleteItem(id);
            closeSheet("sheetDetail");
            hideAlert();
          }
        }
        else if (act === "restore") { restoreItem(id); closeSheet("sheetDetail"); }
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
      snoozeItem(id, when, snoozeBasis);
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
        } else if ("Notification" in window) {
          const perm = await Notification.requestPermission();
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
      state.items = []; state.notes = []; state.projects = [];
      save(); render(); toast("已清空");
    });
    $("#btnPrd").addEventListener("click", () => { location.href = "prd.html"; });

    $("#alertClose").addEventListener("click", e => {
      e.stopPropagation();
      dismissAlert();
    });
    $("#alertAck").addEventListener("click", () => {
      if (alertItem) { ackItem(alertItem.id, true); toast("已确认看到"); }
      hideAlert();
    });
    $("#alertDone").addEventListener("click", () => {
      if (alertItem) completeItem(alertItem.id);
      hideAlert();
    });
    $("#alertSnooze").addEventListener("click", () => {
      if (!alertItem) return;
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
          ackItem(id, true);
          toast("已从通知确认看到");
          hideAlert();
        } else if (data.action === "done") {
          completeItem(id);
          hideAlert();
        } else if (data.action === "snooze") {
          // D11：快捷稍后固定 2 小时
          snoozeItem(id, Date.now() + 2 * 3600000);
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

  function bindNetwork() {
    window.addEventListener("online", renderPwaStatus);
    window.addEventListener("offline", renderPwaStatus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        promoteDue();
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
      handleAlarmAction({ action: alarmAction, itemId: params.get("alarmItem") });
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
    await initializeNativeReminders();
    // D11/D12：监听全屏闹钟动作
    if (NativeReminders.onAlarmAction) {
      NativeReminders.onAlarmAction(handleAlarmAction);
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { init(); });
  } else {
    init();
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
      seed,
      hasSpecificTimeWord,
      fallbackTriggerAt,
      resolveDeliveryMode,
      ensureReviewSettings,
      inReviewHighlight,
      get state() { return state; },
      save,
      load,
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
