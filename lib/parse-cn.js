/* Chinese NL time parser — UMD */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else {
    root.AttentionLib = root.AttentionLib || {};
    const api = factory(root);
    Object.keys(api).forEach(function (k) {
      // `nthWeekdayOfNextMonth` 不在扁平命名空间里合并：它与 lib/repeat.js 的同名导出
      // **语义故意不同**（按具体时刻 vs 按日）。扁平 `Object.assign` 会变成「谁后加载谁生效」，
      // 而顺序错了不抛错。同一来源的其余别名合并无妨，这两个改为显式命名。
      if (k === "nthWeekdayOfNextMonth") return;
      root.AttentionLib[k] = api[k];
    });
    root.AttentionLib.nthWeekdayOfNextMonthByInstant = api.nthWeekdayOfNextMonth;
  }
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  /**
   * 日历原语来自 `lib/date-utils.js` 的**命名空间**导出。
   *
   * 刻意不从这个模块的扁平导出里取（`AttentionLib.startOfDay` 等）—— 那是
   * `Object.assign` 合并出来的，谁后加载谁生效；正是拆分前「同名导出互相覆盖」的成因。
   * 命名空间是显式依赖：拿不到就是装配错误，不是「换了个实现」。
   */
  const P = (function () {
    if (root && root.AttentionLib && root.AttentionLib.DatePrimitives) return root.AttentionLib.DatePrimitives;
    try {
      if (typeof require === "function") return require("./date-utils.js");
    } catch (error) {}
    return null;
  })();

  if (!P) {
    throw new Error("parse-cn.js: 缺少 lib/date-utils.js（日历原语唯一来源）。请检查 index.html 的脚本顺序。");
  }

  // 兼容导出：同名，但**只是同一来源的别名**，不另存算法体。
  const startOfDay = P.startOfDay;
  const endOfDay = P.endOfDay;
  const addDays = P.addDays;
  const nextWeekend = P.nextWeekend;
  const lastDayOfMonth = P.lastDayOfMonth;
  const nthWeekdayInMonth = P.nthWeekdayInMonth;
  const weekdayOfNextWeek = P.weekdayOfNextWeek;
  const dayOfMonthIn = P.dayOfMonthIn;
  const nextDayOfMonth = P.nextDayOfMonth;
  /**
   * 解析器的「首期候选」语义：按**具体时刻**比较（原口径，不得改成按日）。
   * 周期推进用的是另一个函数（`repeat.js` → `nthWeekdayOfNextMonthByDay`），
   * 两者故意不同，见 lib/date-utils.js 的注释。
   */
  const nthWeekdayOfNextMonth = P.nthWeekdayOfNextMonthByInstant;

  /** 星期几中文 → JS getDay()。「每周X」的周期首期与「周X」各分支共用同一张表（P1-①）。 */
  const WEEKDAY_OF = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 };

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
    // Parse positional digits and section units instead of a 1–31 lookup table.
    if (/^[零〇一二两三四五六七八九]+$/.test(str)) {
      return Number(Array.from(str, ch => CN_NUM[ch]).join(""));
    }
    if (!/^[零〇一二两三四五六七八九十百千]+$/.test(str)) return null;
    let total = 0, digit = 0, previousUnit = Infinity;
    const units = { "十": 10, "百": 100, "千": 1000 };
    for (const ch of str) {
      if (units[ch]) {
        const unit = units[ch];
        if (unit >= previousUnit) return null;
        total += (digit || 1) * unit;
        digit = 0;
        previousUnit = unit;
      } else digit = CN_NUM[ch];
    }
    return total + digit;
  }

  function normalizeTimeText(input) {
    return String(input || "").replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  }

  // Extract a whole duration before interpreting vague words such as “以后”.
  // Keep this local and dependency-free; time points still use the calendar rules below.
  const DURATION_NUMBER = "(?:[0-9]+(?:\\.[0-9]+)?|[零〇一二两三四五六七八九十百千]+)";
  const DURATION_UNIT = "(?:小时|钟头|分钟|秒钟|星期|周|天|日|分|秒)";
  const DURATION_PART = "(?:" + DURATION_NUMBER + "\\s*(?:个\\s*半|个)?|半个?|半)\\s*" + DURATION_UNIT + "(?:\\s*半)?";
  function extractDuration(text) {
    const pattern = new RegExp("(?:再过|过|再等|等)?\\s*(" + DURATION_PART + "(?:\\s*(?:零|又)?\\s*" + DURATION_PART + ")*)\\s*(?:以后|之后|后)");
    const prefixPattern = new RegExp("(?:再过|过|再等|等)\\s*(" + DURATION_PART + "(?:\\s*(?:零|又)?\\s*" + DURATION_PART + ")*)");
    const match = text.match(pattern) || text.match(prefixPattern);
    if (!match) return null;
    // Do not recognize a suffix of an invalid number or a recurring duration.
    const before = text.slice(0, match.index);
    const invalidPrefix = /[\d.负零〇一二两三四五六七八九十百千万几数每隔半个+−-]\s*$/.test(before);
    const invalidSuffix = /^\s*(?:前|以前|之前|内|左右|多|几)/.test(text.slice(match.index + match[0].length));
    const part = new RegExp("(" + DURATION_NUMBER + "|半)\\s*(个\\s*半|个)?\\s*(" + DURATION_UNIT + ")(\\s*半)?", "g");
    const scale = { "小时": 3600000, "钟头": 3600000, "分钟": 60000, "分": 60000, "秒钟": 1000, "秒": 1000, "天": 86400000, "日": 86400000, "周": 604800000, "星期": 604800000 };
    let ms = 0, days = 0, previousScale = Infinity, valid = !invalidPrefix && !invalidSuffix;
    let token;
    while ((token = part.exec(match[1]))) {
      let n = token[1] === "半" ? 0.5 : (/^[0-9]/.test(token[1]) ? Number(token[1]) : cnInt(token[1]));
      if (n == null || (token[2] && /半/.test(token[2]) && token[4])) valid = false;
      if ((token[2] && /半/.test(token[2])) || token[4]) n += 0.5;
      const unit = scale[token[3]];
      if (unit >= previousScale) valid = false;
      previousScale = unit;
      if (unit >= 86400000 && Number.isInteger(n)) days += n * unit / 86400000;
      else ms += n * unit;
    }
    if (!(ms + days * 86400000 > 0) || !Number.isSafeInteger(ms + days * 86400000)) valid = false;
    return { text: match[0], ms, days, valid };
  }

  function parseChineseTime(input, now) {
    now = now || new Date();
    const raw = String(input || "").trim();
    let text = normalizeTimeText(raw);
    let confidence = "none";
    let trigger = null;
    let deadline = null;
    let win = null;
    let repeat = null;
    /** H-02：「每月 N 号」里的 N；为 null 表示只说「每月」没说号数 */
    let monthDay = null;
    /** P1-①：「每周X」里的星期几（getDay() 值）；null = 只说「每周」没说星期 */
    let weeklyDow = null;
    const duration = extractDuration(text);
    let cleaned = duration ? text.replace(duration.text, "") : text;
    // Prevent duration tokens (e.g. 小时) from being treated as clock times.
    if (duration) text = cleaned;
    const base = startOfDay(now);

    if (/每两周|隔周|每两星期/.test(text)) {
      repeat = { mode: "ack", every: "biweek" };
      cleaned = cleaned.replace(/每两周|隔周|每两星期/g, "");
    } else if (/每月.{0,4}(最后一天|月底|月末)|每月底|每月末/.test(text)) {
      repeat = { mode: "calendar", every: "monthEnd" };
      cleaned = cleaned.replace(/每月.{0,4}(最后一天|月底|月末)|每月底|每月末/g, "");
    } else if (/每月(?:第\s*([一二三四五六日天]|\d)\s*个|(最后\s*一?\s*个?))\s*(?:星期|周)?\s*([一二三四五六日天])/.test(text)) {
      // P1-③：「每月最后一个周五」此前不被识别（「最后」不在 N 的字符类里），
      // 整句退化成「每月」+30 天兜底；而 nthWeekdayInMonth 与 repeat 推进
      // 本就支持 nth=-1（最后一个周X），解析层只需把「最后」传下去。
      const m = text.match(/每月(?:第\s*([一二三四五六日天]|\d)\s*个|(最后\s*一?\s*个?))\s*(?:星期|周)?\s*([一二三四五六日天])/);
      const nthMap = { "一": 1, "二": 2, "三": 3, "四": 4, "1": 1, "2": 2, "3": 3, "4": 4 };
      const dowMap = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 };
      const nth = m[2] != null ? -1 : (nthMap[m[1]] || 1);
      const dow = dowMap[m[3]];
      repeat = { mode: "calendar", every: "nthWeekday", nth, dow };
      cleaned = cleaned.replace(m[0], "");
    } else if (/每周|每星期|每週/.test(text)) {
      repeat = { mode: "calendar", every: "week" };
      // N-04：星期几必须跟着「每周」一起剥掉，否则「每周一…站会」会留下孤立的「一」，
      // 标题变成「一站会」。
      // P1-①：星期几同时交给下方「周期首期」分支 ——「每周一9点」的首期是「下一个
      // 严格未来的周一 09:00」，不能再由「本周X」的「最近周一」给出（周一当天说会
      // 落到已过的今天）。繁体「每週」同义并入：此前它连周期都识别不出（repeat=null）。
      const wm = text.match(/每(?:周|星期|週)\s*[一二三四五六日天]?/);
      const wd = wm ? /(?:周|星期|週)\s*([一二三四五六日天])\s*$/.exec(wm[0]) : null;
      weeklyDow = wd ? WEEKDAY_OF[wd[1]] : null;
      cleaned = cleaned.replace(wm ? wm[0] : /每周|每星期|每週/g, "");
    } else if (/每天|每日/.test(text)) {
      repeat = { mode: "calendar", every: "day" };
      cleaned = cleaned.replace(/每天|每日/g, "");
    } else if (/每月|每个月/.test(text)) {
      repeat = { mode: "calendar", every: "month" };
      // H-02：「每月15号」必须留下 15。此前只剥掉「每月」，号数被丢掉，
      // 触发时刻落到「+30 天」兜底（09-18 → 10-18），此后每月都锚在 18 号，永久漂移。
      const md = text.match(/每(?:个)?月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[日号]/);
      if (md) monthDay = cnInt(md[1]);
      cleaned = cleaned.replace(md ? md[0] : /每月|每个月/g, "");
    }

    /**
     * N-04 / M-03：截止语义此前只认「截止 / 到期 / 报名结束」等硬词，
     * 于是「明天上午9点前提交」「12月31日之前提交年报」这两类最常见的截止表达**完全不产出截止**，
     * 首页的截止保护（p24 / p2）对它们从不生效，残留的「之前/前」还会污染标题。
     *
     * 这里补两类：① 「之前 / 以前」；② 紧跟在时刻或日期之后的「前」（9点前 / 3号前）。
     * 刻意**不使用 lookbehind** —— 老 Android WebView 解析到会直接抛语法错误，
     * 那会让整个 lib/parse-cn.js 加载失败，代价远大于收益。
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
    const absDate = text.match(/(?:(\d{4}|[零〇一二三四五六七八九]{4})\s*年\s*)?(\d{1,2}|[一二三四五六七八九十]+)\s*月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[日号]/);
    let invalidAbsoluteDate = false;
    if (absDate) {
      // Resolve the year after reading the explicit clock; reject calendar clamping.
      cleaned = cleaned.replace(absDate[0], "");
    }

    /**
     * P1-②：「30号前交材料」只给号数不给月份 —— 此前整段不被识别（absDate 必须有「月」），
     * 落到「+7 天」兜底后，截止又被 endOfDay(fallback) 凭空补成 7 天后（语料 #36：9/21）。
     * 裸 N 号按「本月 N 号，已过则下月」给锚点，月份不足 N 天时收敛到月末（与
     * dayOfMonthIn 同口径，避免 9 月说「31号」溢出成 10-01）。触发分支排在
     * absDate 与 hour 之间且让位给 repeat：
     * 「每月N号 / 下个月N号」仍由各自更具体的分支消费（它们会把「每月15号」/
     * 「下个月5号」整段剥出标题），本锚点只兜无月份的口语 —— 否则先抢走「5号」
     * 会让「下个月交电费」残进标题（H-03）。
     */
    const bareDay = absDate || /下个月|下月/.test(text) || (repeat && repeat.every === "month")
      ? null : text.match(/(\d{1,2}|[一二三四五六七八九十]+)\s*号/);
    if (bareDay) {
      const dayNum = cnInt(bareDay[1]);
      if (dayNum != null && dayNum >= 1 && dayNum <= 31) {
        const dayIn = (y, mo) => new Date(y, mo, Math.min(dayNum, new Date(y, mo + 1, 0).getDate()), 10, 0, 0, 0);
        let dt = dayIn(now.getFullYear(), now.getMonth());
        if (dt < startOfDay(now)) dt = dayIn(now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear(), (now.getMonth() + 1) % 12);
        deadlineAnchor = dt.getTime();
        cleaned = cleaned.replace(bareDay[0], "");
        if (hasDeadlineKw) deadline = endOfDay(dt).getTime();
      }
    }

    let hour = null, minute = 0;
    /** P1-④：裸钟点（无「上午/下午/晚上」）要在 hour 分支做 12/24 消歧，须先留住「是否有时段词」。 */
    let clockMer = null;
    const clock = text.match(/(上午|中午|下午|晚上|早上)?\s*(\d{1,2})[:：](\d{2})/);
    if (clock) {
      hour = parseInt(clock[2], 10);
      minute = parseInt(clock[3], 10);
      clockMer = clock[1] || null;
      const mer = clock[1];
      if ((mer === "下午" || mer === "晚上") && hour < 12) hour += 12;
      if (mer === "中午") hour = 12;
      cleaned = cleaned.replace(clock[0], "");
    } else {
      // N-04：「半」也是分钟表达（10点半 = 10:30）。此前只认数字，
      // 「10点半」被算成 10:00，而且「半」留在正文里（标题「半面试」）。
      // P1-①：数字段改为「纯数字 或 纯中文数字」整段匹配 —— 原字符类会把「每周一9点」
      // 里的「一9」粘连成一个 token（cnInt 对混合串返回 null → 钟点被吞、9点残留标题）。
      // P1-⑤：分钟补「刻」表达（一刻=15、二/两刻=30、三刻=45），此前「一/三」被当成
      // 分钟数（15:01/15:03），「刻」还留在标题里。
      const clock2 = text.match(/(上午|中午|下午|晚上|早上)?\s*([0-9]+|[一二两三四五六七八九十]+)\s*[点時时](\s*(半|[一二两三]\s*刻|[0-9一二两三四五六七八九十]+)\s*分?)?/);
      if (clock2) {
        hour = cnInt(clock2[2]);
        const mtok = clock2[4] == null ? "" : clock2[4].replace(/\s+/g, "");
        if (mtok === "半") minute = 30;
        else if (/刻$/.test(mtok)) minute = ({ "一刻": 15, "二刻": 30, "两刻": 30, "三刻": 45 })[mtok] || 0;
        else minute = mtok ? (cnInt(mtok) || 0) : 0;
        clockMer = clock2[1] || null;
        const mer = clock2[1];
        if ((mer === "下午" || mer === "晚上") && hour != null && hour < 12) hour += 12;
        if (mer === "中午" && hour != null) hour = 12;
        cleaned = cleaned.replace(clock2[0], "");
      }
    }

    if (absDate) {
      const year = absDate[1] ? cnInt(absDate[1]) : null;
      const month = cnInt(absDate[2]), day = cnInt(absDate[3]);
      for (let y = year || now.getFullYear(); y <= (year || now.getFullYear() + 8); y++) {
        const dt = P.dayOfMonthIn(y, month - 1, day);
        if (dt.getFullYear() !== y || dt.getMonth() !== month - 1 || dt.getDate() !== day) continue;
        dt.setHours(hour == null ? 10 : hour, minute, 0, 0);
        if (!year && dt.getTime() <= now.getTime()) continue;
        deadlineAnchor = dt.getTime(); break;
      }
      invalidAbsoluteDate = deadlineAnchor == null || (hour != null && (hour < 0 || hour > 23 || minute < 0 || minute > 59));
      if (hasDeadlineKw && !invalidAbsoluteDate) deadline = hour != null ? deadlineAnchor : endOfDay(new Date(deadlineAnchor)).getTime();
    }

    function applyTime(ts, h, m) {
      const d = new Date(ts);
      if (h != null) d.setHours(h, m || 0, 0, 0);
      else d.setHours(10, 0, 0, 0);
      return d.getTime();
    }

    if (duration) {
      const target = addDays(now, duration.days).getTime() + duration.ms;
      // Mixed independent anchors require clarification instead of silently choosing one.
      const conflicting = /今天|明天|后天|今晚|今早|周[一二三四五六日天末]|星期[一二三四五六日天]|下个?月|月底|月末|截止|到期/.test(text) || absDate || repeat || extractDuration(text) || (hour != null && duration.ms !== 0);
      if (duration.valid && !conflicting && Number.isFinite(new Date(target).getTime())) {
        trigger = hour != null ? applyTime(target, hour, minute) : target;
        confidence = "high";
      }
    } else if (/大后天/.test(text)) {
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
      // H-01：合并原「下周日」与「下周X」两个分支。它们语义相同却实现不一致
      // （前者只加一次 7 天、后者多加一次），「下周三」因此晚一周。
      // 「下+」同时覆盖「下下周X」——原实现会在「下下周一」里匹配到中间的「下周一」，
      // 剥掉后留下孤立的「下」，标题变成「下开会」。
      const m = text.match(/(下+)周([一二三四五六日天])|(下+)星期([一二三四五六日天])/);
      const weekOffset = (m[1] || m[3] || "下").length;
      const ch = m[2] || m[4];
      const map = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 };
      trigger = applyTime(weekdayOfNextWeek(now, weekOffset, map[ch]).getTime(), hour, minute);
      confidence = "high";
      cleaned = cleaned.replace(m[0], "");
    } else if (repeat && (repeat.every === "nthWeekday" || (repeat.every === "week" && weeklyDow != null))) {
      /**
       * P1-①/P1-③：周期短语里的「周X」首期由周期规则给出，不得让下面的「本周X」分支劫持 ——
       * 它按「最近的周X」取值，「每周一9点」在周一当天说会给出已过的当天时刻（#45：11:00）。
       *  · 每周X：下一个**严格未来**的周X（今天就是 X 且该时刻已过 → 顺延 7 天），
       *    与基线的「未来语义」一致：只剩未来时刻才算下一次出现；
       *  · 每月第N/最后一个周X：nthWeekdayOfNextMonth 按「第 N 个星期几」定位首期。
       * 该分支必须排在「本周X」之前：「每月最后一个周五」里的「周五」同样会被它抢先命中。
       */
      if (repeat.every === "nthWeekday") {
        trigger = nthWeekdayOfNextMonth(now, repeat.nth || 1, repeat.dow != null ? repeat.dow : 1, hour, minute);
      } else {
        const delta = (weeklyDow - base.getDay() + 7) % 7;
        let ts = applyTime(addDays(base, delta).getTime(), hour, minute);
        if (ts <= now.getTime()) ts = applyTime(addDays(base, delta + 7).getTime(), hour, minute);
        trigger = ts;
      }
      confidence = "high";
    } else if (/(这|本)?周([一二三四五六日天])|(这|本)?星期([一二三四五六日天])/.test(text)) {
      // N-04：「本周五」里的「本」必须跟着一起剥掉，否则「截止到本周五前提交报告」会留下孤立的「本」。
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
      // 「下个月底」此前落到「本月底」（先匹配到「月底」），日期整整早一个月。
      const nextMonth = /下个月|下月/.test(text);
      const y = nextMonth && now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
      const m = nextMonth ? (now.getMonth() + 1) % 12 : now.getMonth();
      trigger = new Date(y, m + 1, 0, 10, 0, 0, 0).getTime();
      confidence = "mid";
      cleaned = cleaned.replace(nextMonth ? /下个月底|下个月末|下月底|下月末/g : /月底|月末/g, "");
    } else if (/下个月|下月/.test(text)) {
      // H-03：「下个月5号」里的号数此前被丢掉，硬编码成 1 号 → 10-01（应 10-05）。
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
        deadline = hour != null ? deadlineAnchor : endOfDay(new Date(deadlineAnchor)).getTime();
        confidence = "high";
      } else {
        trigger = deadlineAnchor;
        confidence = "mid";
      }
    } else if (bareDay && deadlineAnchor != null && !repeat) {
      // P1-②：裸 N 号的触发口径与 absDate 分支相同 —— 有截止词就提前 3 天
      // （或明示的「提前N天」）提醒、截止取当天末尾；没有截止词就锚在 N 号当天。
      // 必须排在 hour 分支之前（「30号9点交材料」的日期锚不能被裸钟点吞掉）、
      // 且让位给 repeat（「每月N号」有 nextDayOfMonth 的按时刻口径，含当天已过的边缘）。
      if (hasDeadlineKw) {
        const off = advanceDays != null ? advanceDays : 3;
        trigger = applyTime(addDays(new Date(deadlineAnchor), -off).getTime(), hour, minute);
        deadline = endOfDay(new Date(deadlineAnchor)).getTime();
        confidence = "high";
      } else {
        trigger = hour != null ? applyTime(deadlineAnchor, hour, minute) : deadlineAnchor;
        confidence = "mid";
      }
    } else if (hour != null) {
      // P1-④：能走到这里的输入只剩裸钟点（没有日期/星期锚点）。无时段词时按
      // 「上午优先、已过转下午」消歧：口语「三点半开会」在上午说指的是 15:30，
      // 不是次日凌晨 03:30。截止语境（「9点前」）不消歧 —— 已过的上午截止
      // 顺延到明天是既有口径（70 条语料 #37 为准），不能被这条改动带偏。
      if (clockMer == null && hour < 12 && !hasDeadlineKw &&
          applyTime(base.getTime(), hour, minute) <= now.getTime()) hour += 12;
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
      // H-02：「每月N号」锚到 N 号的下一次出现，repeat.js 的 month 推进再以该日期为锚顺延。
      else if (monthDay != null) trigger = applyTime(nextDayOfMonth(now, monthDay), hour, minute);
      else trigger = applyTime(addDays(base, 30).getTime(), 10, 0);
      confidence = "mid";
    }

    if (!trigger) {
      trigger = applyTime(addDays(base, 7).getTime(), 10, 0);
      confidence = "low";
    }

    /**
     * N-04 / M-03：带截止语义的表达，其时间点本身就是截止。
     * 有明确时刻（「9点前」）就精确到那一刻；只有日期/模糊时刻就取当天末尾 ——
     * 与 absDate 分支既有的 `endOfDay` 口径一致，避免同一语义两套标准。
     *
     * 只对「X 前 / 之前」生效，**不**按 `hasDeadlineKw` 放宽：硬关键词里的「最后一天」
     * 会命中「每月最后一天交房租」这种**周期**表达，给它加截止等于每个周期都多一轮
     * 截止保护提醒 —— 净增打扰，与「降低 Future 查看频率」的取舍相反。
     */
    if (beforeToken != null && deadline == null && trigger != null) {
      deadline = hour != null ? trigger : endOfDay(new Date(trigger)).getTime();
    }

    if (invalidAbsoluteDate) { trigger = null; deadline = null; confidence = "low"; }

    let title = cleaned
      .replace(/提醒我|提醒一下|提醒|记得|别忘了|需要|帮我|请/g, " ")
      .replace(/看一眼|看一下|看看|瞧瞧/g, "看看")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) title = raw || "未命名事项";

    const tags = [];
    const hashTags = title.match(/#([^\s#]+)/g) || [];
    hashTags.forEach(t => tags.push(t.slice(1)));
    title = title.replace(/#[^\s#]+/g, "").replace(/\s+/g, " ").trim();

    const scheduleBasis = duration && confidence === "high" && hour == null ? "elapsed" : "wall-clock";
    return { title, trigger, deadline, window: win, repeat, confidence, raw, tags, scheduleBasis };
  }

  /** 含具体时间指向词（D15「必要」判定：与模糊词相对） */
  function hasSpecificTimeWord(text) {
    const t = normalizeTimeText(text);
    if (!t) return false;
    if (extractDuration(t)) return true;
    // N-04：补「每月N号」—— 它是精确日期，此前被判成模糊词，会被推进「延后澄清」流程。
    return /大后天|后天|明天|今天|今晚|今早|周末|下+周[一二三四五六日天]|下+星期[一二三四五六日天]|这?周[一二三四五六日天]|本?星期[一二三四五六日天]|月底|月末|下个月|下月|过两天|每(?:个)?月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[日号]|([0-9一二两三四五六七八九十]+)\s*[天日]\s*后|([0-9一二三四五六七八九十]+)\s*月\s*([0-9一二两三四五六七八九十]+)\s*[日号]|\d{1,2}:\d{2}/.test(t);
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
