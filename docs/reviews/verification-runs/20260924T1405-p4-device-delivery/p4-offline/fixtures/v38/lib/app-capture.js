/* P2-G1 capture form/session. UMD factory; evaluation has no DOM, state, or timer side effects. */
(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else { root.AttentionLib = root.AttentionLib || {}; root.AttentionLib.AppCapture = factory(root); }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";

  function createAppCapture(d) {
    const deps = d || {};
    const required = ["query", "queryAll", "getDocument", "getState",
      "openSheet", "refreshProjectSelects", "openDetail", "toLocalInput", "parseLocalInput", "parseChineseTime",
      "nextRepeatPreview", "fmtDate", "fmtTime", "repeatLabel", "getFeedback", "escapeHtml", "escapeAttr",
      "setTimeout", "clearTimeout", "fallbackTriggerAt", "hasSpecificTimeWord", "makeItem", "resolveDeliveryMode",
      "detectNeedsReview", "runEditCommand", "runNewCommand", "rollbackNewItem", "save",
      "render", "closeSheet", "announceSaveOutcome", "noteFirstRemindSaved", "queueNativeReminderSync",
      "toast", "getAi"];
    required.forEach(k => { if (typeof deps[k] !== "function") throw new Error("createAppCapture(deps) 缺少依赖：" + k); });
    const $ = sel => deps.query(sel);
    const $$ = sel => deps.queryAll(sel);
    const getState = () => deps.getState();
    const openSheet = id => deps.openSheet(id);
    const refreshProjectSelects = () => deps.refreshProjectSelects();
    const openDetail = id => deps.openDetail(id);
    const toLocalInput = ts => deps.toLocalInput(ts);
    const parseLocalInput = value => deps.parseLocalInput(value);
    const parseChineseTime = text => deps.parseChineseTime(text);
    const nextRepeatPreview = (rep, from, count) => deps.nextRepeatPreview(rep, from, count);
    const fmtDate = ts => deps.fmtDate(ts);
    const fmtTime = ts => deps.fmtTime(ts);
    const repeatLabel = rep => deps.repeatLabel(rep);
    const getFeedback = () => deps.getFeedback();
    const escapeHtml = value => deps.escapeHtml(value);
    const escapeAttr = value => deps.escapeAttr(value);
    const schedule = (fn, ms) => deps.setTimeout(fn, ms);
    const cancel = id => deps.clearTimeout(id);
    const fallbackTriggerAt = () => deps.fallbackTriggerAt();
    const hasSpecificTimeWord = text => deps.hasSpecificTimeWord(text);
    const makeItem = fields => deps.makeItem(fields);
    const resolveDeliveryMode = priority => deps.resolveDeliveryMode(priority);
    const detectNeedsReview = input => deps.detectNeedsReview(input);
    const runEditCommand = (it, values) => deps.runEditCommand(it, values);
    const runNewCommand = item => deps.runNewCommand(item);
    const rollbackNewItem = id => deps.rollbackNewItem(id);
    const save = () => deps.save();
    const render = () => deps.render();
    const closeSheet = id => deps.closeSheet(id);
    const announceSaveOutcome = (id, opts) => deps.announceSaveOutcome(id, opts);
    const noteFirstRemindSaved = item => deps.noteFirstRemindSaved(item);
    const queueNativeReminderSync = reason => deps.queueNativeReminderSync(reason);
    const toast = (msg, label, fn, second, opts) => deps.toast(msg, label, fn, second, opts);
    const getAi = () => deps.getAi();
    let itemFormSession = 0;
    let triggerUserPicked = false;
    let similarTimer = null;
    let parseTimer = null;
    let bound = false;

function snapshotItemForm() {
  const val = (sel) => ($(sel) ? $(sel).value : "");
  const on = $$("#capPriority .chip.on")[0];
  const picked = !!(triggerUserPicked || lowConfUserPicked);
  const triggerVal = val("#capTrigger");
  let triggerAction = "untouched";
  if (picked) {
    triggerAction = triggerVal ? "changed" : "cleared";
  }
  return {
    text: val("#capText"),
    note: val("#capNote"),
    tags: val("#capTags"),
    url: val("#capUrl"),
    trigger: triggerVal,
    triggerAction: triggerAction,
    deadline: val("#capDeadline"),
    project: val("#capProject"),
    repeat: val("#capRepeat"),
    repeatMode: val("#capRepeatMode"),
    nth: val("#capNth"),
    weekday: val("#capWeekday"),
    priority: on ? on.dataset.p : "normal",
    advanced: $("#capAdvanced") ? !$("#capAdvanced").hidden : false,
    editItemId: getState().ui.editItemId,
    triggerPicked: triggerUserPicked,
    lowConfPicked: lowConfUserPicked
  };
}

/**
 * F03：一次提交属于**哪一份草稿**。
 *
 * 持久化回调必须能回答「现在表单里还是不是刚才提交的那一份」——
 * 否则慢写入期间用户继续输入的内容会被旧请求的结果清掉（独立验收 R2）。
 *
 * 时间框只在**用户自己选过**时才算数：解析器与兜底会自己往它里面写值，
 * 把它无条件算进来，会让「解析器刚补完时间」被误判成「用户改了草稿」，
 * 于是面板不再关闭、草稿不再复位。编辑时若显式清空或改期，也以 triggerAction 区分。
 */
function formDraftSignature(snap) {
  if (!snap) return "";
  const picked = !!(snap.triggerPicked || snap.lowConfPicked);
  const triggerPart = picked
    ? (snap.triggerAction ? snap.triggerAction + ":" : "") + (snap.trigger || "")
    : (snap.editItemId ? "untouched" : "");
  return [
    snap.editItemId || "new",
    snap.text, snap.note, snap.tags, snap.url, snap.deadline, snap.project,
    snap.repeat, snap.repeatMode, snap.nth, snap.weekday, snap.priority,
    triggerPart
  ].join("\u0001");
}

function restoreItemForm(snap) {
  if (!snap) return;
  const set = (sel, v) => { if ($(sel)) $(sel).value = v == null ? "" : v; };
  set("#capText", snap.text);
  set("#capNote", snap.note);
  set("#capTags", snap.tags);
  set("#capUrl", snap.url);
  set("#capTrigger", snap.trigger);
  set("#capDeadline", snap.deadline);
  set("#capProject", snap.project);
  set("#capRepeat", snap.repeat);
  set("#capRepeatMode", snap.repeatMode);
  set("#capNth", snap.nth);
  set("#capWeekday", snap.weekday);
  $$("#capPriority .chip").forEach(c => c.classList.toggle("on", c.dataset.p === snap.priority));
  getState().ui.editItemId = snap.editItemId || null;
  triggerUserPicked = !!snap.triggerPicked;
  lowConfUserPicked = !!snap.lowConfPicked;
  if (snap.editItemId) {
    $("#sheetItemTitle").textContent = "编辑事项";
    $("#btnSaveItem").textContent = "保存修改";
  }
  const adv = $("#capAdvanced");
  if (adv) adv.hidden = !snap.advanced;
}

/* ---------- item sheet (capture / edit) ---------- */
function resetItemSheet() {
  getState().ui.editItemId = null;
  getState().ui.pendingLowConf = null;
  // R-F03：换一张表单 = 换一个会话身份，之前提交的异步结果不再属于这张表单
  itemFormSession++;
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
  // UX-T01：新一张表单没有在途提交，按钮标签退回默认（不继承上一条的「保存中…」）
  $("#btnSaveItem").dataset.idleLabel = "";
  $("#btnSaveItem").disabled = false;
  // UX-C02：新建默认收起「更多选项」
  if ($("#capAdvanced")) $("#capAdvanced").hidden = true;
  if ($("#btnCapMore")) {
    $("#btnCapMore").textContent = "更多选项";
    $("#btnCapMore").setAttribute("aria-expanded", "false");
  }
  if ($("#capSummary")) $("#capSummary").innerHTML = "";
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
  schedule(() => { const input = $("#capText"); if (input) input.focus(); }, 280);
}

function openEditItem(id) {
  const it = getState().items.find(x => x.id === id);
  if (!it) return;
  resetItemSheet();
  refreshProjectSelects();
  getState().ui.editItemId = id;
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
  // UX-C02：编辑已有复杂事项时展开「更多选项」，并显示已设置内容摘要；
  // 未改动的字段完整保留（表单值已逐项填好，隐藏 ≠ 清空）。
  const complex = !!(it.repeat && it.repeat.every) || !!it.deadlineAt ||
    !!it.projectId || (it.priority && it.priority !== "normal") ||
    !!it.note || !!it.url || !!(it.tags && it.tags.length);
  if ($("#capAdvanced")) $("#capAdvanced").hidden = !complex;
  if ($("#btnCapMore")) {
    $("#btnCapMore").textContent = complex ? "收起更多选项" : "更多选项";
    $("#btnCapMore").setAttribute("aria-expanded", complex ? "true" : "false");
  }
  renderCaptureSummary();
  $("#capHint").textContent = "可直接修改时间与字段，不必重新解析";
  $("#capHint").classList.remove("muted");
  openSheet("sheetItem");
}

/**
 * 周期设置。传 `src`（`snapshotItemForm()` 的冻结快照）时只读快照，
 * 不读当前表单 —— R-F03 要求「落库内容只来自提交时冻结的那一份」。
 */
function formRepeat(src) {
  const read = (sel, key) => (src ? String(src[key] == null ? "" : src[key]) : $(sel).value);
  const every = read("#capRepeat", "repeat");
  if (!every) return null;
  const mode = read("#capRepeatMode", "repeatMode") || "calendar";
  if (every === "nthWeekday") {
    return {
      every,
      mode,
      nth: parseInt(read("#capNth", "nth"), 10) || 1,
      dow: parseInt(read("#capWeekday", "weekday"), 10)
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
  return getState().items.filter(it => {
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
    list.map(it => '<button type="button" data-open-similar="' + escapeAttr(it.id) + '">· ' +
      escapeHtml(it.title) + "</button>").join("") +
    "</div>";
}

function updateParseHint() {
  const text = $("#capText").value.trim();
  if (getState().ui.editItemId) return;
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
  // D17：低置信度是「没识别出精确时间」，不是「识别出一个约等于的时间」。
  // 把解析器拍的 +7 天写回表单，会让同一屏出现两句互相打脸的话 ——
  // 提示说「未识别精确时间」，摘要却说「提醒 9月26日 10:00」，时间框里也躺着一个具体日期。
  // 保存路径早就按同一条理由拒收它了（见 finishSave 的 parsedLow），这里只是让表单跟上。
  const lowConf = p.confidence === "low" || p.confidence === "none";
  // L01：用户手选的时间优先 —— 继续输入正文不得把它覆盖掉
  const picked = triggerUserPicked ? parseLocalInput($("#capTrigger").value) : null;
  if (!picked) $("#capTrigger").value = lowConf ? "" : toLocalInput(p.trigger);
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
  renderCaptureSummary();
}

/**
 * UX-C02：识别摘要。
 *
 * 必须显示**有效提醒时间**，以及已识别的周期/截止这类会影响行为的信息 ——
 * 把周期藏进「更多选项」会让用户以为建的是一次性记录，实际每两周回来一次。
 * 摘要只读表单的**当前值**，所以「清除或手选时间后摘要同步更新」是天然成立的。
 */
function renderCaptureSummary() {
  const host = $("#capSummary");
  if (!host) return;
  const feedbackApi = getFeedback();
  if (!feedbackApi) { host.textContent = ""; return; }
  const hasContent = !!getState().ui.editItemId ||
    ($("#capText") && $("#capText").value.trim());
  if (!hasContent) { host.textContent = ""; host.className = "cap-summary"; return; }
  const rep = formRepeat();
  const chip = $$("#capPriority .chip.on")[0];
  const pv = chip ? chip.dataset.p : "normal";
  const s = feedbackApi.captureSummary({
    triggerAt: parseLocalInput($("#capTrigger").value),
    repeatText: rep
      ? repeatLabel(rep) + (rep.mode === "ack" ? " · 从我点过「我知道了」重新计时" : "")
      : "",
    deadlineAt: parseLocalInput($("#capDeadline").value),
    priorityLabel: pv === "critical" ? "关键（用闹钟提醒）" : pv === "important" ? "重要（用闹钟提醒）" : ""
  });
  host.className = "cap-summary" + (s.empty ? " is-empty" : "");
  host.textContent = s.text;
}

    /* ---------- G2 submit orchestration ---------- */
    let saveSubmitsInFlight = new Set();
    let pendingFinishSave = null;
    let lowConfUserPicked = false;

    function setSaveButtonRunning(running) {
      const btn = $("#btnSaveItem");
      if (!btn) return;
      if (running) {
        if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.textContent || "保存";
        btn.disabled = true;
        btn.textContent = "保存中…";
      } else {
        btn.disabled = false;
        if (btn.dataset.idleLabel) btn.textContent = btn.dataset.idleLabel;
        btn.dataset.idleLabel = "";
      }
    }
    function beginSaveSubmit(token) { saveSubmitsInFlight.add(token || "anonymous"); setSaveButtonRunning(true); }
    function endSaveSubmit(token) {
      saveSubmitsInFlight.delete(token || "anonymous");
      if (!saveSubmitsInFlight.size) setSaveButtonRunning(false);
    }
    function saveSubmitToken(sessionId, editItemId, text, triggerValue) {
      return String(sessionId) + "|" + (editItemId || "new") + "|" + (text || "") + "|" + (triggerValue || "");
    }
    function settleFailedDraft(draft, signature, sessionId) {
      if (session() === sessionId && formDraftSignature(snapshotItemForm()) === signature) {
        keepDraftForRetry(draft);
        return;
      }
      toast("上一条没保存成功 · 你正在写的内容没被动过", "找回上一条", () => keepDraftForRetry(draft));
    }
    function keepDraftForRetry(draft) {
      restoreItemForm(draft);
      openSheet("sheetItem");
      const feedbackResult = getFeedback() && getFeedback().saveFeedback
        ? getFeedback().saveFeedback("failed")
        : { text: "未能保存 · 内容还在，可重试", actionLabel: "重试" };
      toast(feedbackResult.text, feedbackResult.actionLabel, () => {
        restoreItemForm(draft);
        saveItemFromForm();
      });
    }
    function openLowConfSheet(defaultTs, rawText) {
      const state = getState();
      state.ui.pendingLowConf = defaultTs || fallbackTriggerAt();
      state.ui.pendingLowConfRaw = rawText || "";
      const custom = $("#lowConfCustom");
      if (custom) custom.value = toLocalInput(state.ui.pendingLowConf);
      const hint = $("#lowConfHint");
      if (hint) hint.textContent = "当前：" + fmtTime(state.ui.pendingLowConf);
      $$("#lowConfChips .chip").forEach(c => c.classList.remove("on"));
      openSheet("sheetLowConf");
    }
    function setLowConfPick(ts, chipEl) {
      const state = getState();
      state.ui.pendingLowConf = ts;
      $("#lowConfCustom").value = toLocalInput(ts);
      $("#lowConfHint").textContent = "当前：" + fmtTime(ts);
      $$("#lowConfChips .chip").forEach(c => c.classList.remove("on"));
      if (chipEl) chipEl.classList.add("on");
    }
    function finishSaveAfterLowConf(ts) {
      if (ts) $("#capTrigger").value = toLocalInput(ts);
      lowConfUserPicked = true;
      if (pendingFinishSave) {
        const fn = pendingFinishSave;
        pendingFinishSave = null;
        fn(null);
      }
    }

    function saveItemFromForm() {
      const state = getState();
      const rawPrefetch = $("#capText") ? $("#capText").value.trim() : "";
      const submitToken = saveSubmitToken(session(), state.ui.editItemId, rawPrefetch,
        $("#capTrigger") ? $("#capTrigger").value : "");
      if (saveSubmitsInFlight.has(submitToken)) { toast("正在保存 · 请稍候"); return false; }
      const raw = rawPrefetch;
      if (!raw && !state.ui.editItemId) { $("#capText").focus(); toast("先写一句话吧"); return; }
      const editing = state.ui.editItemId ? state.items.find(x => x.id === state.ui.editItemId) : null;
      const frozenDraft = snapshotItemForm();
      const frozenSig = formDraftSignature(frozenDraft);
      const frozenSession = session();
      const formUntouched = () => session() === frozenSession && formDraftSignature(snapshotItemForm()) === frozenSig;

      const finishSave = (parsed, opts) => {
        const resuming = !!(opts && opts.resuming);
        const src = (opts && opts.source) || snapshotItemForm();
        if (!resuming && saveSubmitsInFlight.has(submitToken)) { toast("正在保存 · 请稍候"); return false; }
        if (!resuming) beginSaveSubmit(submitToken);
        let title = raw;
        if (parsed) title = parsed.title || raw || (editing ? editing.title : "未命名事项");
        else if (!editing) { const local = parseChineseTime(raw); parsed = local; title = local.title || raw; }
        else title = raw || (editing ? editing.title : "未命名事项");
        const extraTags = String(src.tags == null ? "" : src.tags).trim().split(/\s+/).filter(Boolean);
        const parsedTags = (!editing && parsed) ? (parsed.tags || []) : [];
        const tags = Array.from(new Set(parsedTags.concat(extraTags)));
        const priority = src.priority || "normal";
        const formTrigger = parseLocalInput(src.trigger);
        let triggerAt, scheduleBasis;
        let snoozedAt = editing ? editing.snoozedAt : null;
        let snoozeDelayMs = editing ? editing.snoozeDelayMs : null;
        if (editing) {
          const triggerAction = src.triggerAction || (src.triggerPicked ? (src.trigger ? "changed" : "cleared") : "untouched");
          const initialFormTrigger = toLocalInput(editing.triggerAt);
          const formTriggerMatchesInitial = (src.trigger || "") === initialFormTrigger;
          if (triggerAction === "cleared" || (!src.trigger && editing.triggerAt != null && src.triggerPicked)) {
            triggerAt = null; scheduleBasis = "wall-clock"; snoozedAt = null; snoozeDelayMs = null;
          } else if (triggerAction === "changed" || (!formTriggerMatchesInitial && src.trigger)) {
            triggerAt = formTrigger; scheduleBasis = "wall-clock"; snoozedAt = null; snoozeDelayMs = null;
          } else if (!src.trigger && editing.triggerAt == null) {
            triggerAt = null; scheduleBasis = "wall-clock"; snoozedAt = null; snoozeDelayMs = null;
          } else {
            triggerAt = editing.triggerAt; scheduleBasis = editing.scheduleBasis || "wall-clock";
            snoozedAt = editing.snoozedAt; snoozeDelayMs = editing.snoozeDelayMs;
          }
        } else {
          const parsedTrigger = parsed ? (parsed.trigger || parsed.triggerAt) : null;
          const userPicked = !!(src.triggerPicked || src.lowConfPicked);
          const explicitTime = userPicked ? formTrigger : null;
          const parsedLow = !!(parsed && (parsed.confidence === "low" || parsed.confidence === "none"));
          triggerAt = explicitTime || (parsedLow ? null : (parsedTrigger || formTrigger)) || null;
          scheduleBasis = !userPicked && !parsedLow && parsed && parsed.scheduleBasis === "elapsed" ? "elapsed" : "wall-clock";
        }
        const deadlineAt = parseLocalInput(src.deadline) || (!editing && parsed ? parsed.deadline || parsed.deadlineAt : null);
        const repeat = formRepeat(src) || (!editing && parsed && parsed.repeat
          ? (parsed.repeat.every === "nthWeekday"
            ? { every: "nthWeekday", mode: parsed.repeat.mode || "calendar", nth: parsed.repeat.nth || 1, dow: parsed.repeat.dow != null ? parsed.repeat.dow : 1 }
            : parsed.repeat) : null);
        if (editing) {
          const draft = src, draftSig = formDraftSignature(draft);
          const applied = runEditCommand(editing, { title, note: String(src.note == null ? "" : src.note).trim(), tags,
            url: String(src.url == null ? "" : src.url).trim(), projectId: src.project || "", priority, triggerAt,
            scheduleBasis, snoozedAt, snoozeDelayMs, deadlineAt, repeat });
          if (applied === false) { endSaveSubmit(submitToken); return false; }
          const editId = editing.id;
          const pendingEdit = save();
          pendingEdit.then(() => {
            endSaveSubmit(submitToken);
            if (session() === frozenSession && formDraftSignature(snapshotItemForm()) === draftSig) {
              closeSheet("sheetItem"); closeSheet("sheetDetail"); resetItemSheet();
            }
            render(); announceSaveOutcome(editId, { editing: true, draft, persistence: "confirmed" });
            queueNativeReminderSync("save-edit");
          }).catch(() => { endSaveSubmit(submitToken); settleFailedDraft(draft, draftSig, frozenSession); });
          return true;
        }
        const item = makeItem({ title, note: String(src.note == null ? "" : src.note).trim(), tags,
          url: String(src.url == null ? "" : src.url).trim(), projectId: src.project || "", priority,
          status: "waiting", triggerAt, scheduleBasis, localTrigger: scheduleBasis === "wall-clock" ? toLocalInput(triggerAt) : null,
          deadlineAt, windowStart: parsed && parsed.window ? parsed.window.start : null,
          windowEnd: parsed && parsed.window ? parsed.window.end : null, repeat, review_status: "READY",
          delivery_mode: resolveDeliveryMode(priority) });
        const needs = detectNeedsReview({ title: item.title, note: item.note, url: item.url, triggerAt: item.triggerAt,
          confidence: parsed ? parsed.confidence : "none" });
        if (needs) {
          item.review_status = "NEEDS_REVIEW";
          if (!item.triggerAt) { item.triggerAt = fallbackTriggerAt(); item.scheduleBasis = "wall-clock";
            item.localTrigger = toLocalInput(item.triggerAt); item.isFallbackTrigger = true; }
        }
        const draft = src, draftSig = formDraftSignature(draft);
        runNewCommand(item);
        const newId = item.id;
        const pendingNew = save();
        pendingNew.then(() => {
          endSaveSubmit(submitToken);
          if (session() === frozenSession && formDraftSignature(snapshotItemForm()) === draftSig) {
            closeSheet("sheetItem"); resetItemSheet(); state.ui.tab = "home";
          }
          render(); announceSaveOutcome(newId, { editing: false, draft, persistence: "confirmed", needs });
          noteFirstRemindSaved(item); queueNativeReminderSync("save-new");
        }).catch(() => { endSaveSubmit(submitToken); rollbackNewItem(newId); settleFailedDraft(draft, draftSig, frozenSession); });
        return true;
      };

      if (!editing) {
        lowConfUserPicked = false;
        const localP = parseChineseTime(raw);
        const low = localP.confidence === "low" || localP.confidence === "none";
        if (low && hasSpecificTimeWord(raw)) {
          pendingFinishSave = finishSave; endSaveSubmit(submitToken); openLowConfSheet(fallbackTriggerAt(), raw); return;
        }
        if (low) return finishSave(localP);
      }
      const ai = getAi();
      if (!editing && ai && ai.ready() && ai.config().autoOnSave && raw) {
        const btn = $("#btnSaveItem"); beginSaveSubmit(submitToken); if (btn) btn.textContent = "AI 理解中…";
        const frozenText = String(frozenDraft.text == null ? "" : frozenDraft.text).trim();
        ai.parseCapture(raw).then(r => {
          const merged = ai.mergedDraft(frozenDraft, r);
          if (formUntouched()) ai.applyToForm(r, "AI 理解");
          finishSave({ title: String(merged.text == null ? "" : merged.text).trim() || frozenText || r.title,
            trigger: parseLocalInput(merged.trigger), deadline: parseLocalInput(merged.deadline),
            tags: String(merged.tags == null ? "" : merged.tags).trim().split(/\s+/).filter(Boolean), window: null,
            repeat: formRepeat(merged), confidence: "high" }, { resuming: true, source: merged });
        }).catch(() => finishSave(null, { resuming: true, source: frozenDraft }));
        return;
      }
      return finishSave(null);
    }

    function markTriggerPicked(value) { triggerUserPicked = !!value; }
    function session() { return itemFormSession; }

    function bind() {
      if (bound) return;
      bound = true;
      const text = $("#capText");
      if (!text) return;
      text.addEventListener("input", () => {
        cancel(parseTimer);
        parseTimer = schedule(updateParseHint, 120);
      });
      $$("#capPriority .chip").forEach(c => c.addEventListener("click", () => {
        $$("#capPriority .chip").forEach(x => x.classList.remove("on"));
        c.classList.add("on");
        renderCaptureSummary();
      }));
      text.addEventListener("blur", () => renderSimilarHint(text.value.trim()));
      text.addEventListener("input", () => {
        cancel(similarTimer);
        similarTimer = schedule(() => renderSimilarHint(text.value.trim()), 400);
      });
      ["#capRepeat", "#capRepeatMode", "#capNth", "#capWeekday"].forEach(sel => {
        const el = $(sel); if (el) el.addEventListener("change", () => { updateRepeatPreview(); renderCaptureSummary(); });
      });
      const trigger = $("#capTrigger");
      if (trigger) {
        trigger.addEventListener("change", () => { triggerUserPicked = true; updateRepeatPreview(); renderCaptureSummary(); });
        trigger.addEventListener("input", () => { triggerUserPicked = true; renderCaptureSummary(); });
      }
      ["#capDeadline"].forEach(sel => {
        const el = $(sel); if (el) { el.addEventListener("change", renderCaptureSummary); el.addEventListener("input", renderCaptureSummary); }
      });
      const more = $("#btnCapMore");
      if (more) more.addEventListener("click", () => {
        const adv = $("#capAdvanced");
        if (!adv) return;
        const open = adv.hidden;
        adv.hidden = !open;
        more.textContent = open ? "收起更多选项" : "更多选项";
        more.setAttribute("aria-expanded", open ? "true" : "false");
      });
      const doc = deps.getDocument();
      if (doc && typeof doc.addEventListener === "function") doc.addEventListener("click", e => {
        const target = e.target && e.target.closest ? e.target.closest("[data-open-similar]") : null;
        if (target) openDetail(target.dataset.openSimilar);
      }, true);
    }

    return { bind, session, markTriggerPicked, snapshotItemForm, formDraftSignature, restoreItemForm,
      resetItemSheet, openCapture, openEditItem, formRepeat, updateRepeatPreview, renderSimilarHint,
      updateParseHint, renderCaptureSummary, findSimilarItems, saveItemFromForm, openLowConfSheet,
      finishSaveAfterLowConf, setLowConfPick, lowConfUserPicked: () => lowConfUserPicked,
      beginSaveSubmit, endSaveSubmit, setSaveButtonRunning };
  }

  return { createAppCapture: createAppCapture };
});
