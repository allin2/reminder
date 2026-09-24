/* 内容导入：文件 → ImportDraft[]（P0 五种确定性抽取） — UMD */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else {
    root.AttentionLib = root.AttentionLib || {};
    Object.assign(root.AttentionLib, factory());
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_DRAFTS = 200;
  const MAX_BYTES = 5 * 1024 * 1024;

  /* ---------- 小工具 ---------- */

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /** 同步内容指纹。浏览器侧优先用 `crypto.subtle` 的 SHA-256，这里只做幂等键的降级实现。 */
  function hash32(str) {
    let h = 0x811c9dc5;
    const s = String(str == null ? "" : str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  function lineLocator(i) { return "第 " + (i + 1) + " 行"; }

  function cleanLine(s) {
    return String(s == null ? "" : s)
      .replace(/^[\s\u3000]+/, "")
      .replace(/[\s\u3000]+$/, "");
  }

  /** 去掉行首的列表标记/复选框标记，返回 { text, checked, isItem } */
  function stripBullet(line) {
    let s = cleanLine(line);
    if (!s) return { text: "", checked: false, isItem: false };
    let isItem = false, checked = false;
    const cb = s.match(/^([-*+]|\d{1,3}[.)])\s+\[([ xX])\]\s*(.*)$/);
    if (cb) return { text: cleanLine(cb[3]), checked: cb[2].toLowerCase() === "x", isItem: true };
    const ul = s.match(/^([-*+•·])\s+(.*)$/);
    if (ul) { isItem = true; s = cleanLine(ul[2]); }
    const ol = s.match(/^(\d{1,3})[.)]\s+(.*)$/);
    if (ol) { isItem = true; s = cleanLine(ol[2]); }
    return { text: s, checked: checked, isItem: isItem };
  }

  function isSeparator(line) {
    const s = cleanLine(line);
    if (!s) return true;
    if (/^[-=_*~#]{3,}$/.test(s)) return true;               // ---- / ==== / *** 分隔线
    if (/^[|+\s:-]+$/.test(s) && s.length >= 3) return true;  // 表格线
    return false;
  }

  function makeDraft(o) {
    const d = {
      title: "",
      when_text: null,
      deadline_text: null,
      repeat_text: null,
      repeat: null,
      note: "",
      tags: [],
      url: null,
      source_quote: "",
      source_locator: "",
      confidence: "high",
      source_kind: "text",
      at_ms: null,
      deadline_at_ms: null,
      internal: null
    };
    return Object.assign(d, o || {});
  }

  /* ---------- 纯文本 ---------- */

  function extractPlainText(text, meta) {
    const warnings = [];
    const drafts = [];
    let skipped = 0;
    const lines = String(text || "").split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (isSeparator(raw)) continue;
      const b = stripBullet(raw);
      if (!b.text) continue;
      if (b.text.length < 2) continue;
      // 上限之外的行要**数出来**：否则「已截断」这个提示永远不会出现
      if (drafts.length >= MAX_DRAFTS) { skipped++; continue; }
      drafts.push(makeDraft({
        title: clampTitle(b.text),
        note: b.text.length > 60 ? b.text : "",
        source_quote: cleanLine(raw),
        source_locator: (meta && meta.name ? "" : "") + lineLocator(i),
        source_kind: "text"
      }));
    }
    return { drafts: drafts, warnings: warnings, sourceKind: "text", truncated: skipped > 0, skipped: skipped };
  }

  function clampTitle(s) {
    const t = cleanLine(s);
    if (t.length <= 60) return t;
    return t.slice(0, 57) + "…";
  }

  /* ---------- Markdown ---------- */

  function extractMarkdown(text, meta) {
    const warnings = [];
    const drafts = [];
    const lines = String(text || "").split(/\r\n|\r|\n/);
    let heading = "";
    let inFrontMatter = false;
    let inFence = false;
    let sawItem = false;
    let skipped = 0;
    const pending = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = cleanLine(raw);
      if (i === 0 && trimmed === "---") { inFrontMatter = true; continue; }
      if (inFrontMatter) { if (trimmed === "---") inFrontMatter = false; continue; }
      if (/^(```|~~~)/.test(trimmed)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (h) { heading = cleanLine(h[2]); continue; }
      if (isSeparator(raw)) continue;

      const b = stripBullet(raw);
      if (b.isItem && b.text.length >= 2) {
        sawItem = true;
        if (drafts.length >= MAX_DRAFTS) { skipped++; continue; }
        drafts.push(makeDraft({
          title: clampTitle(b.text),
          note: b.text.length > 60 ? b.text : "",
          tags: heading ? [heading] : [],
          source_quote: trimmed,
          source_locator: heading ? heading + " · " + lineLocator(i) : lineLocator(i),
          source_kind: "text"
        }));
        continue;
      }
      if (trimmed.length >= 2 && !/^>$/.test(trimmed)) pending.push({ i: i, raw: raw, text: trimmed, heading: heading });
    }

    // 整份 md 没有列表项 → 退回「按段落/行当条目」，否则会一条都抽不出来
    if (!sawItem) {
      pending.forEach(p => {
        if (drafts.length >= MAX_DRAFTS) { skipped++; return; }
        if (p.text.startsWith(">")) return;
        drafts.push(makeDraft({
          title: clampTitle(p.text.replace(/^>\s?/, "")),
          note: p.text.length > 60 ? p.text : "",
          tags: p.heading ? [p.heading] : [],
          source_quote: p.text,
          source_locator: p.heading ? p.heading + " · " + lineLocator(p.i) : lineLocator(p.i),
          source_kind: "text"
        }));
      });
      if (drafts.length) warnings.push("未找到列表项，已按段落拆分");
    }
    return {
      drafts: drafts.slice(0, MAX_DRAFTS), warnings: warnings, sourceKind: "text",
      truncated: skipped > 0, skipped: skipped
    };
  }

  /* ---------- CSV ---------- */

  function parseCsvRows(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    const s = String(text || "");
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
        continue;
      }
      if (c === '"') { inQuotes = true; continue; }
      if (c === ",") { row.push(field); field = ""; continue; }
      if (c === "\r") continue;
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
      field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => cleanLine(c) !== ""));
  }

  const HEADER_MAP = {
    title: ["title", "标题", "事项", "内容", "任务", "名称", "subject", "name", "what"],
    time: ["time", "remind_at", "remindat", "提醒时间", "提醒", "时间", "when", "trigger", "trigger_at"],
    deadline: ["deadline", "due", "due_at", "dueat", "截止", "截止时间", "到期", "ddl"],
    note: ["note", "notes", "备注", "说明", "描述", "desc", "description", "remark", "detail"],
    tags: ["tags", "tag", "标签", "分类", "label", "labels"],
    url: ["url", "link", "链接", "网址"]
  };

  function normalizeHeader(h) {
    return String(h || "").replace(/^\ufeff/, "").trim().toLowerCase().replace(/[\s_\-]/g, "");
  }

  function detectHeader(cells) {
    const map = {};
    let hits = 0;
    cells.forEach((c, idx) => {
      const n = normalizeHeader(c);
      Object.keys(HEADER_MAP).forEach(k => {
        if (map[k] != null) return;
        if (HEADER_MAP[k].some(a => normalizeHeader(a) === n)) { map[k] = idx; hits++; }
      });
    });
    return hits > 0 ? map : null;
  }

  function extractCsv(text, meta) {
    const warnings = [];
    const drafts = [];
    let skipped = 0;
    const rows = parseCsvRows(text);
    if (!rows.length) return { drafts: [], warnings: ["未解析到任何行"], sourceKind: "structured" };

    const header = detectHeader(rows[0]);
    let body = rows, map = null;
    if (header) { map = header; body = rows.slice(1); }
    else warnings.push("未识别到表头，已按「第 1 列当标题、其余列并入备注」处理");

    body.forEach((cells, idx) => {
      if (drafts.length >= MAX_DRAFTS) { skipped++; return; }
      const lineNo = header ? idx + 2 : idx + 1;
      if (map) {
        const pick = k => (map[k] != null ? cleanLine(cells[map[k]]) : "");
        const title = pick("title");
        const whenText = pick("time");
        const deadlineText = pick("deadline");
        if (!title && !whenText && !deadlineText) return;
        const tagRaw = pick("tags");
        drafts.push(makeDraft({
          title: clampTitle(title || whenText || "未命名事项"),
          when_text: whenText || null,
          deadline_text: deadlineText || null,
          note: pick("note"),
          url: pick("url") || null,
          tags: tagRaw ? tagRaw.split(/[、,;；|]/).map(s => cleanLine(s)).filter(Boolean) : [],
          source_quote: cleanLine(cells.join(" | ")),
          source_locator: (meta && meta.name ? meta.name + " · " : "") + lineLocator(lineNo),
          source_kind: "text"
        }));
        return;
      }
      const first = cleanLine(cells[0]);
      if (!first) return;
      drafts.push(makeDraft({
        title: clampTitle(first),
        note: cells.slice(1).map(c => cleanLine(c)).filter(Boolean).join(" · "),
        source_quote: cleanLine(cells.join(" | ")),
        source_locator: (meta && meta.name ? meta.name + " · " : "") + lineLocator(lineNo),
        source_kind: "text"
      }));
    });
    return {
      drafts: drafts.slice(0, MAX_DRAFTS), warnings: warnings, sourceKind: header ? "mixed" : "text",
      truncated: skipped > 0, skipped: skipped
    };
  }

  /* ---------- ICS（结构化，不走自然语言解析） ---------- */

  function unfoldIcs(text) {
    return String(text || "").replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  }

  function parseIcsDateValue(value, params, warnings, opts) {
    const v = String(value || "").trim();
    const isDateOnly = params.VALUE === "DATE" || /^\d{8}$/.test(v);
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2] - 1, d = +m[3];
    const hh = m[4] != null ? +m[4] : (isDateOnly ? (opts && opts.allDayHour != null ? opts.allDayHour : 10) : 0);
    const mm = m[5] != null ? +m[5] : (isDateOnly ? (opts && opts.allDayMinute != null ? opts.allDayMinute : 0) : 0);
    if (m[7] === "Z") return Date.UTC(y, mo, d, hh, mm, 0, 0);
    if (params.TZID && params.TZID !== localTz()) {
      // 不擅自做时区换算：算错比不算是更坏的失败。保留条目 + 明确告警（INV-01：宁可粗糙不可丢）
      if (warnings) warnings.push("时区 " + params.TZID + " 未做转换，按本地时间处理");
    }
    return new Date(y, mo, d, hh, mm, 0, 0).getTime();
  }

  function localTz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; }
  }

  function rruleToRepeat(rrule, warnings) {
    if (!rrule) return null;
    const parts = {};
    String(rrule).split(";").forEach(kv => {
      const i = kv.indexOf("=");
      if (i > 0) parts[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1).toUpperCase();
    });
    const freq = parts.FREQ;
    const interval = parseInt(parts.INTERVAL, 10) || 1;
    if (freq === "DAILY") return { every: "day", mode: "calendar" };
    if (freq === "WEEKLY") {
      if (interval === 2) return { every: "biweek", mode: "calendar" };
      if (interval !== 1) { if (warnings) warnings.push("不支持的周期 INTERVAL=" + interval + "，未设置重复"); return null; }
      return { every: "week", mode: "calendar" };
    }
    if (freq === "MONTHLY") {
      if (parts.BYMONTHDAY === "-1") return { every: "monthEnd", mode: "calendar" };
      if (parts.BYMONTHDAY) return { every: "month", mode: "calendar" };
      const byday = (parts.BYDAY || "").match(/^(-?\d)?(SU|MO|TU|WE|TH|FR|SA)$/);
      if (byday) {
        const dowMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
        return {
          every: "nthWeekday",
          mode: "calendar",
          nth: byday[1] ? parseInt(byday[1], 10) : 1,
          dow: dowMap[byday[2]]
        };
      }
    }
    if (warnings) warnings.push("不支持的 RRULE「" + rrule + "」，未设置重复");
    return null;
  }

  function extractIcs(text, meta) {
    const warnings = [];
    const drafts = [];
    let skipped = 0;
    const body = unfoldIcs(text);
    const lines = body.split(/\n/);
    let cur = null;
    const flush = () => {
      if (!cur) return;
      const summary = (cur.SUMMARY || "").trim();
      const startAt = cur._DTSTART != null ? cur._DTSTART : null;
      const dueAt = cur._DUE != null ? cur._DUE : null;
      const whenAt = dueAt != null ? dueAt : startAt;
      if (summary || whenAt != null) {
        if (drafts.length >= MAX_DRAFTS) { skipped++; cur = null; return; }
        if (whenAt != null && whenAt < Date.now() && cur._RRULE) {
          warnings.push("「" + (summary || "未命名") + "」的起始时刻已过，请确认");
        }
        drafts.push(makeDraft({
          title: clampTitle(summary || "未命名事项"),
          note: cleanLine(cur.DESCRIPTION || "").replace(/\\n/g, " ").slice(0, 200),
          repeat: rruleToRepeat(cur._RRULE, warnings),
          at_ms: startAt,
          deadline_at_ms: dueAt,
          source_quote: cleanLine((cur.SUMMARY || "") + (cur._RRULE ? " " + cur._RRULE : "")),
          source_locator: (meta && meta.name ? meta.name + " · " : "") + (cur.UID ? "UID " + cur.UID : "ICS 条目"),
          source_kind: "structured"
        }));
      }
      cur = null;
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^BEGIN:(VEVENT|VTODO|VJOURNAL)$/i.test(line)) { cur = {}; continue; }
      if (/^END:(VEVENT|VTODO|VJOURNAL)$/i.test(line)) { flush(); continue; }
      if (!cur) continue;
      const ci = line.indexOf(":");
      if (ci < 0) continue;
      const rawKey = line.slice(0, ci);
      const value = line.slice(ci + 1);
      const segs = rawKey.split(";");
      const key = segs[0].toUpperCase();
      const params = {};
      segs.slice(1).forEach(s => {
        const eq = s.indexOf("=");
        if (eq > 0) params[s.slice(0, eq).toUpperCase()] = s.slice(eq + 1);
      });
      if (key === "SUMMARY") cur.SUMMARY = unescapeIcs(value);
      else if (key === "DESCRIPTION") cur.DESCRIPTION = unescapeIcs(value);
      else if (key === "UID") cur.UID = value.trim();
      else if (key === "RRULE") cur._RRULE = value.trim();
      else if (key === "DTSTART") cur._DTSTART = parseIcsDateValue(value, params, warnings, { allDayHour: 10, allDayMinute: 0 });
      else if (key === "DUE") cur._DUE = parseIcsDateValue(value, params, warnings, { allDayHour: 23, allDayMinute: 59 });
    }
    flush();
    return {
      drafts: drafts, warnings: dedupe(warnings), sourceKind: "structured",
      truncated: skipped > 0, skipped: skipped
    };
  }

  function unescapeIcs(s) {
    return String(s == null ? "" : s)
      .replace(/\\n/gi, "\n")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .replace(/\\\\/g, "\\");
  }

  function dedupe(arr) {
    const seen = {};
    return arr.filter(x => (seen[x] ? false : (seen[x] = true)));
  }

  /* ---------- JSON ---------- */

  const IMPORT_ID_KEYS = ["title", "标题", "事项", "内容", "name", "subject", "summary"];
  const IMPORT_TIME_KEYS = ["time", "when", "trigger_at", "triggerAt", "at", "start", "提醒时间", "时间"];
  const IMPORT_DEADLINE_KEYS = ["deadline", "due", "due_at", "dueAt", "截止", "截止时间", "到期"];
  const IMPORT_NOTE_KEYS = ["note", "notes", "备注", "desc", "description", "content", "说明"];
  const IMPORT_TAG_KEYS = ["tags", "tag", "标签"];
  const IMPORT_URL_KEYS = ["url", "link", "链接"];

  function pickKey(obj, keys) {
    for (let i = 0; i < keys.length; i++) if (obj[keys[i]] != null && obj[keys[i]] !== "") return obj[keys[i]];
    return null;
  }

  function toMs(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const t = new Date(String(v)).getTime();
    return Number.isFinite(t) ? t : null;
  }

  /** 本应用自己的导出件：无损回环（结构与时间都是权威的）。 */
  function draftsFromOwnExport(obj, meta) {
    const warnings = ["检测到本应用的导出文件，按结构化来源导入（含回环字段）"];
    const drafts = (obj.items || []).slice(0, MAX_DRAFTS).map(e => makeDraft({
      title: clampTitle(e.title || "未命名事项"),
      note: e.content || "",
      tags: Array.isArray(e.tags) ? e.tags.slice() : [],
      url: e.url || null,
      repeat: e.repeat ? {
        every: e.repeat.every,
        mode: e.repeat.mode,
        nth: e.repeat.nth,
        dow: e.repeat.dow
      } : null,
      at_ms: e.trigger_at_ms != null ? e.trigger_at_ms : null,
      deadline_at_ms: e.deadline_at_ms != null ? e.deadline_at_ms : null,
      source_quote: e.source_quote || "",
      source_locator: (meta && meta.name ? meta.name + " · " : "") + "导出件",
      source_kind: "structured",
      internal: Object.assign({}, (e.extensions && e.extensions.internal) || {}, {
        review_status: e.review_status,
        acknowledgedAt: e.acknowledged_at_ms,
        completedAt: e.completed_at_ms,
        deadlinePaused: e.deadline_paused,
        createdAt: e.created_at_ms,
        sourceQuote: e.source_quote || null,
        sourceTitle: e.source_title || null
      })
    }));
    const over = (obj.items || []).length > MAX_DRAFTS;
    if (over) warnings.push("条目超过上限，已截断");
    return { drafts: drafts, warnings: warnings, sourceKind: "structured", truncated: over, skipped: Math.max(0, (obj.items || []).length - MAX_DRAFTS) };
  }

  function draftsFromGenericJson(obj, meta, warnings) {
    let arr = null;
    if (Array.isArray(obj)) arr = obj;
    else if (obj && typeof obj === "object") {
      ["items", "tasks", "todos", "list", "data"].some(k => {
        if (Array.isArray(obj[k])) { arr = obj[k]; return true; }
        return false;
      });
    }
    if (!arr) return { drafts: [], warnings: ["未找到可导入的条目数组"], sourceKind: "structured" };

    const drafts = [];
    let skipped = 0;
    arr.forEach((x, idx) => {
      if (drafts.length >= MAX_DRAFTS) { skipped++; return; }
      if (typeof x === "string") {
        const t = cleanLine(x);
        if (t) drafts.push(makeDraft({
          title: clampTitle(t),
          source_quote: t,
          source_locator: (meta && meta.name ? meta.name + " · " : "") + "第 " + (idx + 1) + " 条",
          source_kind: "text"
        }));
        return;
      }
      if (!x || typeof x !== "object") return;
      const titleRaw = pickKey(x, IMPORT_ID_KEYS);
      const timeRaw = pickKey(x, IMPORT_TIME_KEYS);
      const deadlineRaw = pickKey(x, IMPORT_DEADLINE_KEYS);
      const title = titleRaw == null ? null : String(titleRaw);
      if (!title && !timeRaw && !deadlineRaw) return;

      const isoReq = /^\d{4}-\d{2}-\d{2}/;
      const timeIsISO = timeRaw != null && isoReq.test(String(timeRaw));
      const deadlineIsISO = deadlineRaw != null && isoReq.test(String(deadlineRaw));
      const noteRaw = pickKey(x, IMPORT_NOTE_KEYS);
      const tagsRaw = pickKey(x, IMPORT_TAG_KEYS);
      const urlRaw = pickKey(x, IMPORT_URL_KEYS);

      drafts.push(makeDraft({
        title: clampTitle(title || "未命名事项"),
        // 看起来是 ISO 时间的 → 走结构化通道；否则当自然语言串交给本地解析器
        at_ms: timeIsISO ? toMs(timeRaw) : null,
        when_text: !timeIsISO && timeRaw != null ? String(timeRaw) : null,
        deadline_at_ms: deadlineIsISO ? toMs(deadlineRaw) : null,
        deadline_text: !deadlineIsISO && deadlineRaw != null ? String(deadlineRaw) : null,
        note: noteRaw == null ? "" : String(noteRaw).slice(0, 500),
        tags: Array.isArray(tagsRaw) ? tagsRaw.map(t => cleanLine(t)).filter(Boolean)
          : (tagsRaw ? String(tagsRaw).split(/[、,;；|]/).map(s => cleanLine(s)).filter(Boolean) : []),
        url: urlRaw == null ? null : String(urlRaw),
        source_quote: cleanLine(JSON.stringify(x)).slice(0, 200),
        source_locator: (meta && meta.name ? meta.name + " · " : "") + "第 " + (idx + 1) + " 条",
        source_kind: timeIsISO ? "structured" : "text"
      }));
    });
    if (skipped) warnings.push("条目超过上限，已截断");
    return { drafts: drafts, warnings: warnings, sourceKind: "mixed", truncated: skipped > 0, skipped: skipped };
  }

  function extractJson(text, meta) {
    const warnings = [];
    let obj;
    try {
      obj = JSON.parse(String(text || ""));
    } catch (e) {
      return {
        drafts: [], warnings: ["JSON 解析失败：" + (e && e.message ? e.message : "格式错误")],
        sourceKind: "structured", failed: true
      };
    }
    if (obj && typeof obj === "object" && obj.format === "attention-inbox.export" && Array.isArray(obj.items)) {
      return draftsFromOwnExport(obj, meta);
    }
    return draftsFromGenericJson(obj, meta, warnings);
  }

  /* ---------- 调度 ---------- */

  const TYPE_TABLE = [
    { exts: [".ics", ".ical"], mimes: ["text/calendar"], kind: "ics" },
    { exts: [".csv"], mimes: ["text/csv", "application/csv"], kind: "csv" },
    { exts: [".json"], mimes: ["application/json", "text/json"], kind: "json" },
    { exts: [".md", ".markdown"], mimes: ["text/markdown"], kind: "markdown" },
    { exts: [".txt", ".text"], mimes: ["text/plain"], kind: "text" }
  ];

  function detectKind(name, mime) {
    const n = String(name || "").toLowerCase();
    const m = String(mime || "").toLowerCase().split(";")[0].trim();
    for (let i = 0; i < TYPE_TABLE.length; i++) {
      const t = TYPE_TABLE[i];
      if (t.exts.some(e => n.endsWith(e))) return t.kind;
      if (m && t.mimes.indexOf(m) >= 0) return t.kind;
    }
    return null;
  }

  function byteLength(text) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(String(text || "")).length;
    return String(text || "").length;
  }

  /**
   * 主入口。
   * @param {object} input { name, mime, text, size }
   * @param {object} opts  { maxDrafts, maxBytes }
   * @returns {{ ok, reason, kind, drafts, warnings, truncated, bytes }}
   */
  function extract(input, opts) {
    opts = opts || {};
    const maxDrafts = opts.maxDrafts || MAX_DRAFTS;
    const maxBytes = opts.maxBytes || MAX_BYTES;
    const meta = { name: input && input.name };

    const text = input && input.text;
    if (text == null || text === "") {
      return { ok: false, reason: "文件为空", kind: null, drafts: [], warnings: [], truncated: false, bytes: 0 };
    }
    const bytes = input && input.size != null ? Number(input.size) : byteLength(text);
    if (bytes > maxBytes) {
      return {
        ok: false,
        reason: "文件超过 " + Math.round(maxBytes / 1024 / 1024) + " MB 上限",
        kind: null, drafts: [], warnings: [], truncated: false, bytes: bytes
      };
    }
    const kind = detectKind(meta.name, input && input.mime);
    if (!kind) {
      return {
        ok: false,
        reason: "暂不支持该文件类型（本期支持：txt / md / csv / json / ics）",
        kind: null, drafts: [], warnings: [], truncated: false, bytes: bytes
      };
    }

    let res;
    if (kind === "ics") res = extractIcs(text, meta);
    else if (kind === "csv") res = extractCsv(text, meta);
    else if (kind === "json") res = extractJson(text, meta);
    else if (kind === "markdown") res = extractMarkdown(text, meta);
    else res = extractPlainText(text, meta);

    const truncated = !!(res.truncated || res.drafts.length > maxDrafts);
    // JSON 解析失败是**真失败**，不能伪装成「成功但 0 条」
    if (res.failed) {
      return {
        ok: false, reason: res.warnings[0] || "文件格式不正确", kind: kind,
        drafts: [], warnings: res.warnings, truncated: false, skipped: 0, bytes: bytes
      };
    }
    return {
      ok: true,
      reason: "",
      kind: kind,
      drafts: res.drafts.slice(0, maxDrafts),
      warnings: res.warnings || [],
      sourceKind: res.sourceKind || "text",
      truncated: truncated,
      skipped: res.skipped || 0,
      bytes: bytes
    };
  }

  return {
    MAX_DRAFTS,
    MAX_BYTES,
    hash32,
    detectKind,
    stripBullet,
    parseCsvRows,
    detectHeader,
    parseIcsDateValue,
    rruleToRepeat,
    unfoldIcs,
    extractPlainText,
    extractMarkdown,
    extractCsv,
    extractIcs,
    extractJson,
    extract
  };
});
