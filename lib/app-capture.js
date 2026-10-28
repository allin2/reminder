/* P2-G1 capture form/session. UMD factory; evaluation has no DOM, state, or timer side effects. */
(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else { root.AttentionLib = root.AttentionLib || {}; root.AttentionLib.AppCapture = factory(root); }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";

  /**
   * 录入面板快捷时间（#capQuick）的具体时刻。纯函数：只依赖传入的 now，便于单测。
   * - tonight：当天 20:00；已过则顺延到下一个整点（不偷偷改成明天 20:00）
   * - tomorrow：明天 09:00
   * - weekend：最近的周六 10:00；周六 10:00 及之后则下周六
   * - monday：下一个周一 09:00（今天是周一也取下周）
   * 未知 kind 返回 null。
   */
  function quickTimeAt(kind, now) {
    const d = new Date(now.getTime());
    d.setSeconds(0, 0);
    if (kind === "tonight") {
      d.setHours(20, 0);
      if (d <= now) { d.setTime(now.getTime()); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); }
    } else if (kind === "tomorrow") {
      d.setDate(d.getDate() + 1); d.setHours(9, 0);
    } else if (kind === "weekend") {
      d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7)); d.setHours(10, 0);
      if (d <= now) d.setDate(d.getDate() + 7);
    } else if (kind === "monday") {
      d.setDate(d.getDate() + (((1 - d.getDay() + 7) % 7) || 7)); d.setHours(9, 0);
    } else {
      return null;
    }
    return d.getTime();
  }

  function createAppCapture(d) {
    const deps = d || {};
    let punctualOverride;
    const punctualValue = value => typeof value === "boolean" ? value : (getState().settings || {}).punctualPriority !== false;
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
    let sharedCapture = null;
    let parkedCaptureDraft = null;
    // Only the draft interrupted by sharing; normal capture cancellation keeps its existing semantics.
    let captureDraftToResume = null;
    const captureRequests = [];
    const seenCaptureRequests = new Set();
    let nativeCaptureBound = false;
    let nativeCaptureDraining = false;
    let nativeCaptureDrainRequested = false;

    function hasCaptureDraft() {
      const s = snapshotItemForm();
      return !!(s.editItemId || s.text || s.note || s.url || s.tags || s.triggerPicked || s.lowConfPicked || s.deadline || s.project || s.repeat || s.priority !== "normal" || s.punctual_reminder === true);
    }

    function renderCaptureRequests() {
      const prompt = $("#captureSharePrompt"), button = $("#btnCaptureShare");
      if (prompt) prompt.hidden = !captureRequests.length;
      if (button) {
        button.disabled = !!sharedCapture;
        button.textContent = sharedCapture ? "还有 " + captureRequests.length + " 条分享 · 处理当前内容后查看" : "查看分享（" + captureRequests.length + "）";
      }
    }

    function offerCaptureRequest() {
      renderCaptureRequests();
      if (!captureRequests.length) return;
      toast("收到分享 · 当前草稿已保留", "查看分享", () => showCaptureRequest(), null, { durationMs: 8000 });
    }

    function showCaptureRequest() {
      if (!captureRequests.length) return;
      if (sharedCapture) { offerCaptureRequest(); return; }
      if (!parkedCaptureDraft) {
        if (captureDraftToResume) {
          // A later explicitly opened form owns its current input. Keep both it and the
          // interrupted draft intact until that form is saved or closed.
          if ($("#sheetItem").classList.contains("open") && hasCaptureDraft()) {
            toast("请先保存或关闭当前内容 · 原草稿和分享都还在");
            return;
          }
          parkedCaptureDraft = captureDraftToResume;
          captureDraftToResume = null;
        } else if (hasCaptureDraft()) parkedCaptureDraft = snapshotItemForm();
      }
      const request = captureRequests.shift();
      openCapture({ title: request.text || request.sourceTitle || "", url: request.url || "" });
      sharedCapture = request;
      renderCaptureRequests();
    }

    function receiveCaptureRequest(request) {
      if (!request || !request.id || seenCaptureRequests.has(request.id)) return;
      seenCaptureRequests.add(request.id);
      if (seenCaptureRequests.size > 256) seenCaptureRequests.delete(seenCaptureRequests.values().next().value);
      if (request.error) { toast(request.error); return; }
      if (captureRequests.length >= 16) { toast("待处理分享较多 · 请处理后重新分享"); return; }
      const text = String(request.text || "");
      if (text.length > 65536) { toast("分享内容过长 · 请缩短后重试"); return; }
      let url = "";
      const match = text.match(/https?:\/\/[^\s<>]+/i);
      if (match) { try { const u = new URL(match[0]); if (u.protocol === "http:" || u.protocol === "https:") url = u.href; } catch (e) {} }
      captureRequests.push(Object.assign({}, request, { text, url }));
      if (sharedCapture || hasCaptureDraft()) offerCaptureRequest();
      else showCaptureRequest();
    }

    async function bindNativeCapture() {
      const cap = root && root.Capacitor;
      const plugin = cap && cap.Plugins && cap.Plugins.CaptureIntent;
      if (!plugin || nativeCaptureBound) return;
      nativeCaptureBound = true;
      const drain = async () => {
        if (nativeCaptureDraining) { nativeCaptureDrainRequested = true; return; }
        nativeCaptureDrainRequested = false;
        nativeCaptureDraining = true;
        try {
          // Drain again after each batch: intents arriving during an async read are not lost.
          for (;;) {
            const result = await plugin.takeCaptureRequests();
            const requests = result.requests || [];
            requests.forEach(receiveCaptureRequest);
            if (!requests.length) break;
          }
        } catch (e) { toast("分享接收未就绪 · 请重新分享"); }
        finally { nativeCaptureDraining = false; if (nativeCaptureDrainRequested) drain(); }
      };
      try { await plugin.addListener("captureAvailable", event => { if (event && event.error) toast(event.error); return drain(); }); await drain(); }
      catch (e) { nativeCaptureBound = false; toast("分享接收未就绪 · 请重新分享"); }
    }

    let itemFormSession = 0;
    let triggerUserPicked = false;
    let deadlineUserPicked = false;
    let repeatUserPicked = false;
    let similarTimer = null;
    let parseTimer = null;
    let bound = false;
    /**
     * 本次绑定登记过的监听器（回滚用）。
     *
     * 绑定是**一个事务**：中途抛错时先把已挂上的监听器全部摘掉再上抛，重试才是一次
     * 干净的起点。只把 `bound` 挪到末尾只能救「第一行就抛」，救不了「绑到一半才抛」——
     * 那时半套监听器已经在 DOM 上，重试会再挂一套。
     */
    let registered = [];

    function listen(target, type, handler, options) {
      if (!target || typeof target.addEventListener !== "function") return;
      target.addEventListener(type, handler, options);
      registered.push({ target: target, type: type, handler: handler, options: options });
    }

    function rollbackListeners() {
      while (registered.length) {
        const record = registered.pop();
        try {
          record.target.removeEventListener(record.type, record.handler, record.options);
        } catch (error) {}
      }
    }

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
    share: sharedCapture ? Object.assign({}, sharedCapture) : null,
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
    punctual_reminder: punctualOverride,
    advanced: $("#capAdvanced") ? !$("#capAdvanced").hidden : false,
    editItemId: getState().ui.editItemId,
    triggerPicked: triggerUserPicked,
    lowConfPicked: lowConfUserPicked,
    deadlinePicked: deadlineUserPicked,
    repeatPicked: repeatUserPicked
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
    snap.repeat, snap.repeatMode, snap.nth, snap.weekday, snap.priority, String(snap.punctual_reminder),
    triggerPart, !!snap.deadlinePicked, !!snap.repeatPicked
  ].join("\u0001");
}

function restoreItemForm(snap) {
  sharedCapture = snap && snap.share ? Object.assign({}, snap.share) : null;
  if (!snap) return;
  const set = (sel, v) => { if ($(sel)) $(sel).value = v == null ? "" : v; };
  punctualOverride = snap.punctual_reminder;
  if ($("#capPunctual")) $("#capPunctual").checked = punctualValue(punctualOverride);
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
  deadlineUserPicked = !!snap.deadlinePicked;
  repeatUserPicked = !!snap.repeatPicked;
  if (snap.editItemId) {
    $("#sheetItemTitle").textContent = "编辑事项";
    $("#btnSaveItem").textContent = "保存修改";
  }
  const adv = $("#capAdvanced");
  if (adv) adv.hidden = !snap.advanced;
  const more = $("#btnCapMore");
  if (more) {
    more.textContent = snap.advanced ? "收起更多选项" : "更多选项";
    more.setAttribute("aria-expanded", snap.advanced ? "true" : "false");
  }
  if ($("#nthWeekdayRow")) $("#nthWeekdayRow").hidden = snap.repeat !== "nthWeekday";
}

/* ---------- item sheet (capture / edit) ---------- */
function resetItemSheet() {
  sharedCapture = null;
  getState().ui.editItemId = null;
  getState().ui.pendingLowConf = null;
  // R-F03：换一张表单 = 换一个会话身份，之前提交的异步结果不再属于这张表单
  itemFormSession++;
  // L01：换一张表单就是新的一次判断，不能继承上一条的手选状态
  triggerUserPicked = false;
  lowConfUserPicked = false;
  deadlineUserPicked = false;
  repeatUserPicked = false;
  $("#sheetItemTitle").textContent = "安心记下";
  punctualOverride = undefined;
  if ($("#capPunctual")) $("#capPunctual").checked = punctualValue(undefined);
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
  const resume = !prefill && !$("#sheetItem").classList.contains("open") ? captureDraftToResume : null;
  if (resume) captureDraftToResume = null;
  resetItemSheet();
  refreshProjectSelects();
  if (resume) {
    restoreItemForm(resume);
    updateRepeatPreview();
    renderCaptureSummary();
  } else if (prefill) {
    if (prefill.title) $("#capText").value = prefill.title;
    if (prefill.url) $("#capUrl").value = prefill.url;
    if (prefill.note) $("#capNote").value = prefill.note;
    updateParseHint();
  }
  renderCaptureRequests();
  openSheet("sheetItem");
  const openedSession = session();
  schedule(() => {
    if (session() !== openedSession || !$("#sheetItem").classList.contains("open")) return;
    // Do not steal focus after the user has already chosen the new control.
    if (root.document && root.document.activeElement === $("#capPunctual")) return;
    const input = $("#capText"); if (input) input.focus();
  }, 280);
}

function openEditItem(id) {
  const it = getState().items.find(x => x.id === id);
  if (!it) return;
  resetItemSheet();
  refreshProjectSelects();
  getState().ui.editItemId = id;
  $("#sheetItemTitle").textContent = "编辑事项";
  $("#btnSaveItem").textContent = "保存修改";
  punctualOverride = it.punctual_reminder;
  if ($("#capPunctual")) $("#capPunctual").checked = punctualValue(punctualOverride);
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
  // 与 openSnoozeSheet 同一约定：编辑面板不叠在详情面板上，先关再开
  closeSheet("sheetDetail");
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
    if (!deadlineUserPicked) $("#capDeadline").value = "";
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
  if (!deadlineUserPicked) $("#capDeadline").value = toLocalInput(p.deadline);
  if (p.repeat && !repeatUserPicked) {
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
      ? repeatLabel(rep) + (rep.mode === "ack" ? " · 从我点过「已知晓」重新计时" : "")
      : "",
    deadlineAt: parseLocalInput($("#capDeadline").value),
    priorityLabel: pv === "critical" ? "关键（用闹钟提醒）" : pv === "important" ? "重要（用闹钟提醒）" : ""
  });
  host.className = "cap-summary" + (s.empty ? " is-empty" : "");
  host.textContent = s.text + ($("#capPunctual") && $("#capPunctual").checked ? " · 准时保障已开启" : "");
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
        // P1-②：低置信解析不落截止 —— 日期锚点没解析出来时，deadline 多为「+7 天」式
        // 兜底猜测（endOfDay(fallback)），落库会让 p24/p2 的截止保护打在错误日期上
        // （「30号前交材料」曾凭空变 9/21）。解析层修复后该输入已 high；
        // 这里兜住其它仍未识别的截止口语，防止错误截止被持久化。
        const deadlineAt = parseLocalInput(src.deadline) ||
          (!editing && parsed && parsed.confidence !== "low" && parsed.confidence !== "none"
            ? parsed.deadline || parsed.deadlineAt : null);
        const repeat = formRepeat(src) || (!editing && parsed && parsed.repeat
          ? (parsed.repeat.every === "nthWeekday"
            ? { every: "nthWeekday", mode: parsed.repeat.mode || "calendar", nth: parsed.repeat.nth || 1, dow: parsed.repeat.dow != null ? parsed.repeat.dow : 1 }
            : parsed.repeat) : null);
        if (editing) {
          const draft = src, draftSig = formDraftSignature(draft);
          const applied = runEditCommand(editing, { title, note: String(src.note == null ? "" : src.note).trim(), tags,
            url: String(src.url == null ? "" : src.url).trim(), projectId: src.project || "", priority, punctual_reminder: src.punctual_reminder, triggerAt,
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
            noteFirstRemindSaved(editing); queueNativeReminderSync("save-edit");
          }).catch(() => { endSaveSubmit(submitToken); settleFailedDraft(draft, draftSig, frozenSession); });
          return true;
        }
        const item = makeItem({ title, note: String(src.note == null ? "" : src.note).trim(), tags,
          url: String(src.url == null ? "" : src.url).trim(), projectId: src.project || "", priority,
          status: "waiting", triggerAt, scheduleBasis, localTrigger: scheduleBasis === "wall-clock" ? toLocalInput(triggerAt) : null,
          deadlineAt, windowStart: parsed && parsed.window ? parsed.window.start : null,
          windowEnd: parsed && parsed.window ? parsed.window.end : null, repeat, review_status: "READY",
          delivery_mode: resolveDeliveryMode(priority), punctual_reminder: src.punctual_reminder,
          sourceTitle: src.share ? src.share.sourceTitle || "" : "",
          sourceApp: src.share ? src.share.sourceApp || "" : "",
          createdAt: src.share ? src.share.createdAt || Date.now() : Date.now() });
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

    /** 绑定的入口：**只在事务体全部成功后**才宣布 `bound`，失败则整体回滚并可重试。 */
    function bind() {
      if (bound) return;
      registered = [];
      try {
        bindControls();
        bound = true;
      } catch (error) {
        rollbackListeners();
        throw error;
      } finally {
        registered = [];
      }
    }

    /** 绑定的**事务体**：全部注册动作都在这里。 */
    function bindControls() {
      const text = $("#capText");
      if (!text) return;
      const punctual = $("#capPunctual");
      if (punctual) listen(punctual, "change", () => { punctualOverride = punctual.checked === punctualValue(undefined) ? undefined : punctual.checked; renderCaptureSummary(); });
      const pendingShare = $("#btnCaptureShare");
      if (pendingShare) listen(pendingShare, "click", showCaptureRequest);
      listen(text, "input", () => {
        cancel(parseTimer);
        parseTimer = schedule(updateParseHint, 120);
      });
      $$("#capPriority .chip").forEach(c => listen(c, "click", () => {
        $$("#capPriority .chip").forEach(x => x.classList.remove("on"));
        c.classList.add("on");
        renderCaptureSummary();
      }));
      listen(text, "blur", () => renderSimilarHint(text.value.trim()));
      listen(text, "input", () => {
        cancel(similarTimer);
        similarTimer = schedule(() => renderSimilarHint(text.value.trim()), 400);
      });
      ["#capRepeat", "#capRepeatMode", "#capNth", "#capWeekday"].forEach(sel => {
        const el = $(sel); if (el) listen(el, "change", () => { repeatUserPicked = true; updateRepeatPreview(); renderCaptureSummary(); });
      });
      const trigger = $("#capTrigger");
      if (trigger) {
        listen(trigger, "change", () => { triggerUserPicked = true; updateRepeatPreview(); renderCaptureSummary(); });
        listen(trigger, "input", () => { triggerUserPicked = true; renderCaptureSummary(); });
      }
      // 方案 A：快捷时间 —— 与手动在时间框里选时间完全同义（置 triggerUserPicked，之后打字不覆盖）
      $$("#capQuick [data-quick]").forEach(chip => listen(chip, "click", () => {
        const ts = quickTimeAt(chip.dataset.quick, new Date());
        const input = $("#capTrigger");
        if (!ts || !input) return;
        input.value = toLocalInput(ts);
        triggerUserPicked = true;
        updateRepeatPreview();
        renderCaptureSummary();
        const hint = $("#capHint");
        if (hint) {
          hint.textContent = "已保留你选择的时间：" + fmtTime(ts) + " · 可修改";
          hint.classList.remove("muted");
        }
      }));
      ["#capDeadline"].forEach(sel => {
        const el = $(sel); if (el) {
          const changed = () => { deadlineUserPicked = true; renderCaptureSummary(); };
          listen(el, "change", changed); listen(el, "input", changed);
        }
      });
      const more = $("#btnCapMore");
      if (more) listen(more, "click", () => {
        const adv = $("#capAdvanced");
        if (!adv) return;
        const open = adv.hidden;
        adv.hidden = !open;
        more.textContent = open ? "收起更多选项" : "更多选项";
        more.setAttribute("aria-expanded", open ? "true" : "false");
      });
      const doc = deps.getDocument();
      if (doc && typeof doc.addEventListener === "function") listen(doc, "click", e => {
        const target = e.target && e.target.closest ? e.target.closest("[data-open-similar]") : null;
        if (target) openDetail(target.dataset.openSimilar);
      }, true);
    }

    const bindCaptureControls = bind;
    function bindWithShare() {
      const result = bindCaptureControls();
      const sheet = $("#sheetItem");
      if (sheet && !sheet.__captureCloseBound && sheet.addEventListener) {
        sheet.__captureCloseBound = true;
        sheet.addEventListener("attention:sheet-closed", () => {
          if (!sharedCapture) return;
          sharedCapture = null;
          const restore = parkedCaptureDraft;
          parkedCaptureDraft = null;
          if (restore) captureDraftToResume = restore;
          const closedSession = session();
          schedule(() => {
            // This timer only tidies the same canceled share form. A successful save
            // resets the form into another session; the interrupted draft stays in
            // captureDraftToResume until the user opens the normal capture entry.
            if (session() !== closedSession || $("#sheetItem").classList.contains("open")) return;
            if (restore && captureDraftToResume === restore) restoreItemForm(restore);
            else if (!restore) resetItemSheet();
            offerCaptureRequest();
          }, 0);
        });
      }
      return result;
    }

    return { bind: bindWithShare, bindNativeCapture, receiveCaptureRequest, session, markTriggerPicked, snapshotItemForm, formDraftSignature, restoreItemForm,
      resetItemSheet, openCapture, openEditItem, formRepeat, updateRepeatPreview, renderSimilarHint,
      updateParseHint, renderCaptureSummary, findSimilarItems, saveItemFromForm, openLowConfSheet,
      finishSaveAfterLowConf, setLowConfPick, lowConfUserPicked: () => lowConfUserPicked,
      beginSaveSubmit, endSaveSubmit, setSaveButtonRunning };
  }

  return { createAppCapture: createAppCapture, quickTimeAt: quickTimeAt };
});
