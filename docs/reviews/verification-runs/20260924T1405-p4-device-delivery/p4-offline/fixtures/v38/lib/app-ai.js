/* AI 智能理解（可选 BYOK，OpenAI 兼容）—— UMD（P2-A 搬移）
 *
 * 为什么单独成文件：这一段原先挤在 `app-core.js` 的一个分节里（约 290 行），
 * 但它其实是**三件互不相关的事**被放在一起：
 *   · **发请求** —— 拼 system prompt、打 `/chat/completions`、剥 markdown 代码块、归一结果；
 *   · **管设置** —— 读 `settings.ai`、画 AI 设置弹层、保存后回写并重渲染「我的」；
 *   · **合表单** —— 把 AI 结果填回捕获表单，或合并到「提交时冻结的那份草稿」上。
 * 三者都不需要知道事务、原生排程或持久化怎么走，却因为写在 IIFE 里而顺手拿到了
 * `state` / `save()` / `toast()` 的全部闭包权限。迁出之后，它对外的权力只剩
 * `createAppAi(deps)` 那张清单上写明的几项。
 *
 * 边界（刻意**不**搬的部分）：
 *   · `submitToken` / `beginSaveSubmit` —— 提交身份属于事务层，AI 只是「占用同一个
 *     身份」，不能自己发明第二个（`ai:<时间戳>` 那个 bug 就是这么来的）；
 *   · `itemFormSession` / `formUntouched()` —— 表单会话身份属于捕获表单，
 *     本模块只提供 `mergedDraft()`（纯快照合并），由入口决定往哪儿合；
 *   · `#btnAiTest` 里「临时换上表单里的配置再测」——那是设置页的交互，留在入口。
 *
 * 装配方式：导出 `createAppAi(deps)`，由**入口统一实例化**。
 * 本模块求值不注册监听、不开定时器、不碰全局状态、不发请求 ——
 * `busy` 是**实例内**的可变状态，也只有第一次调用 `runOnCapture()` 才会被置真。
 *
 * 依赖为什么一律是**函数**（不是值）：入口那边的 `parseChineseTime` / `repeatLabel`
 * 是「重试时可重建」的 `let` 绑定（F03），`$` / `$$` / `openSheet` 来自 `createUi()`
 * 的实例。按值传进来，就等于把「补载脚本后点重试」这条路重新堵死一次。
 *
 * 依赖方向：本模块不反向导入 `app-core`，也不读 `AttentionLib`。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.AppAi = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  /** `settings.ai` 的缺省形状。`config()` 只在整段缺失时用它，不做逐字段兜底。 */
  const AI_DEFAULTS = {
    enabled: false, baseUrl: "", apiKey: "", model: "", autoOnSave: false
  };

  /**
   * 允许 AI 返回的周期取值。
   *
   * 只认这份白名单，其余一律当成「没识别到周期」—— 不能把模型吐出的任意字符串
   * 直接写进 `repeat.every`：那会流到 `lib/repeat.js` 的推进算法里，而它对这些值
   * 是有前提的（`nthWeekday` 还要带 `nth` / `dow`）。宁可丢掉周期，也不要造出一个
   * 算不出下一轮的事项。
   */
  const REPEAT_EVERY = ["day", "week", "biweek", "month", "monthEnd", "nthWeekday"];

  /* ---------- 纯函数（模块级导出，不需要实例、不读状态） ---------- */

  /**
   * 从模型回复里剥出 JSON 对象。
   *
   * 为什么不能只 `JSON.parse(text)`：模型很爱把 JSON 包在 ```json … ``` 里，
   * 有时前后还有一句客套话。这里先去代码块围栏，再截第一个 `{` 到最后一个 `}`，
   * 最后才 parse。解析失败由调用方（`parseCapture` / `polishCapture`）往外抛，
   * 入口整体回退本地解析 —— **不静默返回一个空结果**。
   *
   * ⚠️ 与 `lib/import-extract.js` 的 `extractJson(text, meta)` 是**两个不同的函数**，
   * 只是名字相近：那个是导入文件的按类型提取（带 meta 与格式分支），这是 AI 回复
   * 的围栏剥离。刻意不复用、也不同名，避免将来有人「顺手合并」把两边一起改坏。
   */
  function extractJsonObject(text) {
    let s = String(text || "").trim();
    s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    return JSON.parse(s);
  }

  /** ISO 串 → 时间戳；解析不出返回 `null`（**不兜底成「现在」**）。 */
  function parseIsoSafe(v) {
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }

  /**
   * 归一 AI 结果。
   *
   * 契约：**字段逐个收窄**，不把模型的原话直接交给下游。
   *   · `title` 空 → 回落用户原话（`fallbackText`），再空才叫「未命名事项」；
   *   · 时间一律过 `parseIsoSafe`，无效即 `null`；
   *   · `tags` 只认数组，逐项 trim、去空、**截到 8 个**（再多会撑爆卡片）；
   *   · `priority` 不在 `normal|important|critical` 里的一律 `normal`
   *     —— 让模型自己发明一个「super-urgent」会静默绕过重要档的所有渠道规则；
   *   · `repeat.every` 不在白名单里 → 整个 `repeat` 变 `null`（理由见 `REPEAT_EVERY`）；
   *   · `confidence` 由「有没有解析出时间」推导，不由模型自评 —— 自评 `high` 却没时间
   *     的结果会让低置信度确认面板整体消失。
   */
  function normalizeAiResult(obj, fallbackText) {
    const data = obj || {};
    const title = (data.title && String(data.title).trim()) || fallbackText || "未命名事项";
    const triggerAt = parseIsoSafe(data.trigger_at);
    const deadlineAt = parseIsoSafe(data.deadline);
    const tags = Array.isArray(data.tags)
      ? data.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 8)
      : [];
    const note = data.note ? String(data.note).trim() : "";
    let priority = data.priority;
    if (priority !== "important" && priority !== "critical") priority = "normal";
    let repeat = null;
    if (data.repeat && data.repeat.every) {
      const every = REPEAT_EVERY.indexOf(data.repeat.every) >= 0 ? data.repeat.every : null;
      if (every) {
        repeat = {
          every: every,
          mode: data.repeat.mode === "ack" ? "ack" : "calendar"
        };
        if (every === "nthWeekday") {
          repeat.nth = data.repeat.nth === -1 ? -1 : (parseInt(data.repeat.nth, 10) || 1);
          repeat.dow = data.repeat.dow != null ? (parseInt(data.repeat.dow, 10) || 0) : 1;
        }
      }
    }
    return {
      title: title,
      triggerAt: triggerAt,
      deadlineAt: deadlineAt,
      tags: tags,
      note: note,
      priority: priority,
      repeat: repeat,
      confidence: triggerAt ? "high" : "low"
    };
  }

  /**
   * 带时区偏移的本地 ISO 串（给 system prompt 用）。
   *
   * 用**本地时间 + 偏移**而不是 `toISOString()`：后者恒为 UTC，模型拿它当「当前本地
   * 时间」就会把「下午 3 点」算到另一个时区去。偏移按 `getTimezoneOffset()` 反号得到
   * —— 那个 API 返回的是「本地比 UTC 慢多少分钟」，符号与 ISO 惯例相反。
   */
  function localIsoWithOffset(pad) {
    const d = new Date();
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const abs = Math.abs(off);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + sign +
      pad(Math.floor(abs / 60)) + ":" + pad(abs % 60);
  }

  /* ---------- 实例工厂 ---------- */

  /**
   * 造一份「AI 能力」实例。
   *
   * 所有依赖**每次调用都重新取值**（见文件头）：本模块不缓存任何外部函数或状态对象。
   */
  function createAppAi(deps) {
    deps = deps || {};

    const REQUIRED_DEPS = [
      "getSettings", "setAiConfig", "query", "queryAll",
      "pad", "toLocalInput", "fmtTime", "fmtDate", "repeatLabel",
      "parseChineseTime", "updateRepeatPreview",
      "toast", "openSheet", "closeSheet", "renderMe", "save", "onMissingConfig"
    ];
    const missing = REQUIRED_DEPS.filter(function (k) { return typeof deps[k] !== "function"; });
    if (missing.length) {
      throw new Error("createAppAi 缺少依赖：" + missing.join(" / "));
    }

    const $ = deps.query;
    const $$ = deps.queryAll;

    /** 当前 AI 配置。整段缺失时才用缺省形状 —— 不做逐字段兜底（否则「配置了但少一项」会被补齐成假值）。 */
    function config() {
      const settings = deps.getSettings() || {};
      return settings.ai || AI_DEFAULTS;
    }

    /** 四样齐全才算「能用」：`baseUrl` 会带斜杠，`apiKey` / `model` 为空时请求必然 401/400。 */
    function ready() {
      const c = config();
      return !!(c.enabled && c.baseUrl && c.apiKey && c.model);
    }

    function nowIso() {
      return localIsoWithOffset(deps.pad);
    }

    function systemPrompt() {
      return [
        "你是「安心收件箱」的隐形解析引擎。用户会输入一句中文待办/提醒。",
        "你的职责仅限：提炼标题、提取提醒时间与截止时间、提取标签、必要时补一句上下文。",
        "禁止：评价优先级重要性、展开对话、给出建议、编造未提及的事项。",
        "当前本地时间 ISO：" + nowIso(),
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

    /**
     * 一次 chat 请求。
     *
     * 失败一律**抛错**，由调用方决定回退成什么 —— 本函数不返回「半份结果」，
     * 也不把 HTTP 状态码吞掉：`HTTP 401` 这种必须原样冒上去，否则用户只会看到
     * 一句「AI 暂不可用」，永远查不出是 key 错了。
     */
    async function chat(userText, systemExtra) {
      const c = config();
      if (!c.baseUrl || !c.apiKey || !c.model) {
        throw new Error("请先配置 AI API");
      }
      const base = String(c.baseUrl).replace(/\/+$/, "");
      const url = base + "/chat/completions";
      const body = {
        model: c.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: systemPrompt() + (systemExtra ? "\n" + systemExtra : "") },
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

    async function parseCapture(text) {
      const content = await chat(text, "任务类型：capture_parse。把用户原话解析成结构化提醒。");
      const obj = extractJsonObject(content);
      return normalizeAiResult(obj, text);
    }

    async function polishCapture(text) {
      const content = await chat(
        text,
        "任务类型：polish。只润色 title 与 note，尽量保留原意；时间字段若原文没有则给 null。"
      );
      const obj = extractJsonObject(content);
      return normalizeAiResult(obj, text);
    }

    /** 连通性测试：`max_tokens: 8` 只求一个「能通」，不为省钱而省掉报错细节。 */
    async function testConnection() {
      const c = config();
      if (!c.baseUrl || !c.apiKey || !c.model) throw new Error("请先填写 API 配置");
      const base = String(c.baseUrl).replace(/\/+$/, "");
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

    /**
     * 把 AI 结果填回**当前**捕获表单。
     *
     * 逐字段语义（与 `mergedDraft()` 必须一一对应，改一处就要改另一处）：
     *   · 标题 / 时间 / 截止 —— 有值就覆盖；
     *   · 备注 —— **只在用户还没写时**才填（不覆盖人已经写的上下文）；
     *   · 标签 —— **并集**（用户手打的标签一个都不丢）；
     *   · 优先级 —— 直接点亮对应 chip；
     *   · 周期 —— 写进 select，`nthWeekday` 额外写 `nth` / `dow`，然后**必须**刷预览。
     * 末尾的提示行固定以「 · 可修改」收尾 —— 这是在告诉用户结果不是判决。
     */
    function applyToForm(r, sourceLabel) {
      const result = r || {};
      if (result.title) $("#capText").value = result.title;
      if (result.triggerAt) $("#capTrigger").value = deps.toLocalInput(result.triggerAt);
      if (result.deadlineAt) $("#capDeadline").value = deps.toLocalInput(result.deadlineAt);
      if (result.note && !$("#capNote").value.trim()) $("#capNote").value = result.note;
      if (result.tags && result.tags.length) {
        const existing = $("#capTags").value.trim().split(/\s+/).filter(Boolean);
        const merged = Array.from(new Set(existing.concat(result.tags)));
        $("#capTags").value = merged.join(" ");
      }
      if (result.priority) {
        $$("#capPriority .chip").forEach(c => c.classList.toggle("on", c.dataset.p === result.priority));
      }
      if (result.repeat) {
        $("#capRepeat").value = result.repeat.every;
        $("#capRepeatMode").value = result.repeat.mode;
        if (result.repeat.every === "nthWeekday") {
          $("#capNth").value = String(result.repeat.nth || 1);
          $("#capWeekday").value = String(result.repeat.dow != null ? result.repeat.dow : 1);
        }
        deps.updateRepeatPreview();
      }
      let msg = (sourceLabel || "AI") + "：" + (result.triggerAt ? deps.fmtTime(result.triggerAt) : "未识别时间");
      if (result.deadlineAt) msg += " · 截止 " + deps.fmtDate(result.deadlineAt);
      if (result.repeat) msg += " · " + deps.repeatLabel(result.repeat);
      msg += " · 可修改";
      $("#capHint").textContent = msg;
      $("#capHint").classList.remove("muted");
    }

    /**
     * R-F03：把 AI 结果合并进**冻结草稿的副本**。
     *
     * 逐条对应 `applyToForm()` 的字段语义（标题/时间/截止/空备注/标签并集/优先级/周期），
     * 但作用在快照上而不是界面上 —— 于是「落库内容」与改前**完全一致**，
     * 只是不再从「可能已经被用户改过的当前表单」里读。「迟到结果覆盖新草稿」正是那一步造成的。
     *
     * 本函数是**纯的**：不改 `base`，不发请求，不碰 DOM。谁拿走返回值、往哪儿合，
     * 由入口按「表单会话身份」决定 —— 那道闸门不能搬到模块里，否则又会变成
     * 「模块自己判断表单是不是原来那张」。
     */
    function mergedDraft(base, r) {
      const result = r || {};
      const snap = Object.assign({}, base);
      if (result.title) snap.text = result.title;
      if (result.triggerAt) snap.trigger = deps.toLocalInput(result.triggerAt);
      if (result.deadlineAt) snap.deadline = deps.toLocalInput(result.deadlineAt);
      if (result.note && !String(snap.note == null ? "" : snap.note).trim()) snap.note = result.note;
      if (result.tags && result.tags.length) {
        const existing = String(snap.tags == null ? "" : snap.tags).trim().split(/\s+/).filter(Boolean);
        snap.tags = Array.from(new Set(existing.concat(result.tags))).join(" ");
      }
      if (result.priority) snap.priority = result.priority;
      if (result.repeat) {
        snap.repeat = result.repeat.every;
        snap.repeatMode = result.repeat.mode;
        if (result.repeat.every === "nthWeekday") {
          snap.nth = String(result.repeat.nth || 1);
          snap.weekday = String(result.repeat.dow != null ? result.repeat.dow : 1);
        }
      }
      return snap;
    }

    /**
     * **在途请求闸门**（原 `aiBusy`）。
     *
     * 它不是「按钮 disabled」的镜像：按钮挡不住输入框里的 Enter 监听，
     * 而一次请求往返要几秒 —— 连点会在同一张表单上叠加两次结果，
     * 第二次把第一次的字段覆盖掉（还可能写进提交）。所以真正的闸门在这里。
     * `finally` 里无条件复位，保证失败也能再按一次。
     */
    let busy = false;

    /**
     * 手动触发一次 AI（理解 / 润色）。
     *
     * 顺序刻意保持原样：**先落本地解析，再发请求** ——
     * UI 因此在等待期间不是空的（用户看得见「明天 9 点」已经填上了），
     * 而 AI 失败时那份本地结果就是回退值，不必再算一遍。
     */
    async function runOnCapture(mode) {
      if (busy) return;
      if (!ready()) {
        deps.toast("请先在「我的 → AI 智能理解」开启并配置");
        deps.onMissingConfig();
        return;
      }
      const text = $("#capText").value.trim();
      if (!text) { deps.toast("先写一句话吧"); return; }

      // local parse first so UI never blocks empty
      const local = deps.parseChineseTime(text);
      if (mode === "parse") {
        $("#capTrigger").value = deps.toLocalInput(local.trigger);
        $("#capDeadline").value = deps.toLocalInput(local.deadline);
      }

      busy = true;
      const btn = mode === "polish" ? $("#btnAiPolish") : $("#btnAiParse");
      const prev = btn.textContent;
      btn.textContent = "✦ 思考中…";
      btn.disabled = true;
      try {
        const r = mode === "polish" ? await polishCapture(text) : await parseCapture(text);
        applyToForm(r, mode === "polish" ? "AI 润色" : "AI 理解");
        deps.toast("AI 已更新字段");
      } catch (e) {
        $("#capHint").textContent = "AI 暂不可用，已用本地解析 · " + (e && e.message ? e.message : "失败");
        $("#capHint").classList.remove("muted");
        deps.toast("AI 失败，已回退本地解析");
      } finally {
        busy = false;
        btn.textContent = prev;
        btn.disabled = false;
      }
    }

    /** 打开 AI 设置弹层：**每次都从当前配置重画**，不留弹层内的旧值。 */
    function openAiSheet() {
      const c = config();
      $("#swAi").classList.toggle("on", !!c.enabled);
      $("#aiBaseUrl").value = c.baseUrl || "";
      $("#aiApiKey").value = c.apiKey || "";
      $("#aiModel").value = c.model || "";
      $$("#aiAutoChips .chip").forEach(ch => {
        ch.classList.toggle("on", (ch.dataset.auto === "on") === !!c.autoOnSave);
      });
      deps.openSheet("sheetAi");
    }

    /**
     * 保存 AI 设置。
     *
     * 写回的是**整段**配置（不是逐字段 patch）：开关、地址、密钥、模型、自动开关
     * 是同一份契约，半新半旧会让「开了但请求还是打到旧地址」这种状态存在。
     * 密钥在此**明文存进 localStorage / IndexedDB**（BYOK 的既有契约，未变更）——
     * 变更它属于产品决策，不在本次搬移范围内。
     */
    function saveAiSettings() {
      // 自动开关是 chip 组里的单选：取当前点上 `.on` 的那一个；一个都没有即为关。
      const autoChip = $$("#aiAutoChips .chip.on")[0];
      const next = {
        enabled: $("#swAi").classList.contains("on"),
        baseUrl: ($("#aiBaseUrl").value || "").trim().replace(/\/+$/, ""),
        apiKey: ($("#aiApiKey").value || "").trim(),
        model: ($("#aiModel").value || "").trim(),
        autoOnSave: !!(autoChip && autoChip.dataset && autoChip.dataset.auto === "on")
      };
      deps.setAiConfig(next);
      deps.save();
      deps.closeSheet("sheetAi");
      deps.renderMe();
      deps.toast(next.enabled ? "AI 已启用" : "AI 已关闭");
    }

    /** 「我的」页 AI 那一行的小字：把「开了 / 没配全 / 配全了」三种状态说清楚。 */
    function renderAiSub() {
      const c = config();
      const el = $("#aiSub");
      if (!el) return;
      if (!c.enabled) el.textContent = "未开启 · 解析时间与提炼标题";
      else if (!c.apiKey || !c.baseUrl || !c.model) el.textContent = "已开启 · 请完善 API 配置";
      else el.textContent = "已开启 · " + (c.model || "模型") + (c.autoOnSave ? " · 保存时自动" : " · 仅手动");
    }

    return {
      config: config,
      ready: ready,
      nowIso: nowIso,
      systemPrompt: systemPrompt,
      chat: chat,
      parseCapture: parseCapture,
      polishCapture: polishCapture,
      testConnection: testConnection,
      applyToForm: applyToForm,
      mergedDraft: mergedDraft,
      /** 在途闸门的可观测快照 —— 测试要能断言「第二次进来被挡住」。 */
      isBusy: () => busy,
      runOnCapture: runOnCapture,
      openAiSheet: openAiSheet,
      saveAiSettings: saveAiSettings,
      renderAiSub: renderAiSub
    };
  }

  return {
    createAppAi: createAppAi,
    AI_DEFAULTS: AI_DEFAULTS,
    REPEAT_EVERY: REPEAT_EVERY,
    extractJsonObject: extractJsonObject,
    normalizeAiResult: normalizeAiResult,
    parseIsoSafe: parseIsoSafe,
    localIsoWithOffset: localIsoWithOffset
  };
});
