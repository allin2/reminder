/* P3-F Review window rules, session management, card operations, entry, and settings layer.
 * UMD factory; evaluation and factory creation perform no IO, state mutation, or global listeners.
 */
(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.AppReview = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";

  function createAppReview(input) {
    const deps = input || {};
    const REQUIRED_DEPS = [
      "getState", "getItems", "getSettings", "save", "render", "renderMe",
      "toast", "openSheet", "closeSheet", "fmtTime", "fmtDate", "toLocalInput",
      "parseLocalInput", "escapeHtml", "deleteItem", "completeItem", "bumpRev", "wrapUserOp",
      "queueNativeReminderSync", "inQuietHours", "quietEnd", "addDays",
      "systemBridge", "showSystemNotification", "isNativeAndroid", "writeIfChanged",
      "query", "queryAll", "getInitialReviewSettings"
    ];
    REQUIRED_DEPS.forEach(function(name) {
      if (typeof deps[name] !== "function") {
        throw new Error("createAppReview(deps) 缺少依赖：" + name);
      }
    });

    let reviewTriggerUserPicked = false;
    let currentSessionToken = 0;
    let reviewInflight = false;
    /**
     * `bindReviewControls()` 的幂等闸门。
     *
     * 为什么必须有：这些控件（`[data-snooze-review]` 等）是 `index.html` 里的**静态**节点，
     * 而 `bindReviewControls` 由启动链调用。启动失败后允许重试之后，「调用两次」不再
     * 只是理论问题 —— 没有闸门就会给同一个按钮挂两套监听，一次点击执行两次动作。
     */
    let reviewControlsBound = false;
    /** 本次绑定登记过的监听器（回滚用：失败时摘掉，成功后才置位）。 */
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

    function pad(n) {
      return String(n).padStart(2, "0");
    }

    function markReviewTriggerPicked(v) {
      reviewTriggerUserPicked = !!v;
    }

    /* ---------- Deferred Clarification / 延迟澄清 ---------- */
    function ensureReviewSettings() {
      const reviewDefaults = deps.getInitialReviewSettings();
      const settings = deps.getSettings ? deps.getSettings() : (deps.getState() && deps.getState().settings);
      if (!settings.review) {
        settings.review = Object.assign({}, reviewDefaults);
      } else {
        // 升级旧参数：45min×1 → 60min×2
        if (settings.review.followupMs == null || settings.review.followupMs === 45 * 60 * 1000) {
          settings.review.followupMs = reviewDefaults.followupMs;
        }
        if (settings.review.maxFollowups == null || settings.review.maxFollowups === 1) {
          settings.review.maxFollowups = reviewDefaults.maxFollowups;
        }
        // 迁移：旧的 lastSessionKey 按分钟编码（无 "W:" / "S:" 前缀），会绕过 maxFollowups，直接作废
        const lsk = settings.review.lastSessionKey;
        if (lsk && lsk.indexOf("W:") !== 0 && lsk.indexOf("S:") !== 0) {
          settings.review.lastSessionKey = "";
          settings.review.followupCount = 0;
        }
      }
      return settings.review;
    }

    /**
     * L01 / R5 / D17：只有「系统兜底时间」的记录不发事项提醒。
     *  · 用户手选或解析出的真实时间照常生效（Review 只管内容质量）；
     *  · Review 关闭后一律按普通事项正常提醒（V0.2 §9.2）。
     */
    function isFallbackSuppressed(it) {
      return !!it && !!it.isFallbackTrigger && ensureReviewSettings().enabled;
    }

    /** D17：兜底 = 下一个 Review Window；Review 关闭时退次日晚间 20:00 */
    function fallbackTriggerAt() {
      const rs = ensureReviewSettings();
      if (rs.enabled) return nextReviewWindowStart();
      const d = deps.addDays(new Date(), 1);
      d.setHours(20, 0, 0, 0);
      return d.getTime();
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
      const o = opts || {};
      const title = o.title || "";
      const note = o.note || "";
      const url = o.url || "";
      const triggerAt = o.triggerAt || null;
      const confidence = o.confidence || "none";
      const userKeep = !!o.userKeep;

      if (userKeep) return true;
      if (!triggerAt) return true;
      if (confidence === "low" || confidence === "none") return true;
      if (isVagueContent(title, note, url)) return true;
      if (url && !title && !note) return true;
      return false;
    }

    function needsReviewItems() {
      const items = (deps.getItems ? deps.getItems() : (deps.getState() && deps.getState().items)) || [];
      return items.filter(it =>
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
      start.setHours(rs.hour != null ? rs.hour : 21, rs.minute != null ? rs.minute : 30, 0, 0);
      if (start.getTime() <= base.getTime()) start.setDate(start.getDate() + 1);
      return start.getTime();
    }

    function inReviewWindow(now) {
      const rs = ensureReviewSettings();
      if (!rs.enabled) return false;
      const d = new Date(now || Date.now());
      const cur = d.getHours() * 60 + d.getMinutes();
      const start = (rs.hour != null ? rs.hour : 21) * 60 + (rs.minute != null ? rs.minute : 30);
      const end = (rs.windowEndHour != null ? rs.windowEndHour : 23) * 60 +
        (rs.windowEndMinute != null ? rs.windowEndMinute : 0);
      if (start === end) return false;
      if (start < end) return cur >= start && cur < end;
      return cur >= start || cur < end;
    }

    async function fireReviewNotification(count) {
      const settings = deps.getSettings ? deps.getSettings() : (deps.getState() && deps.getState().settings);
      if (!settings || !settings.notify) return;
      const title = "待整理";
      const body = "有 " + count + " 条随手记录待整理 · 预计只需几分钟";
      // D19：走 LocalNotifications / Web 通知，不再用全屏闹钟
      if (deps.isNativeAndroid && deps.isNativeAndroid()) {
        // 原生侧由 reconcile/buildReviewDesired 排程；此处仅在应用内 toast
        return;
      }
      const bridge = deps.systemBridge ? deps.systemBridge() : null;
      if (bridge && bridge.showNotification) {
        try {
          await bridge.showNotification({ title, body, id: 91001 });
          return;
        } catch (e) {}
      }
      if (deps.showSystemNotification) {
        deps.showSystemNotification({
          title,
          body,
          tag: "review-session",
          requireInteraction: true,
          data: { itemId: "review-session" }
        });
      }
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
      const snoozeAt = rs.snoozedUntil && deps.inQuietHours(new Date(rs.snoozedUntil))
        ? deps.quietEnd(new Date(rs.snoozedUntil)) : Number(rs.snoozedUntil) || 0;
      if (snoozeAt && now < snoozeAt) return;
      if (rs.skippedUntil && now < rs.skippedUntil) return;
      // D20：宽限期（snoozedUntil 后 1 小时）一过即失效。
      // 否则 snoozeDue 永远为真，会一直顶掉后续窗口的提醒额度。
      if (snoozeAt && now >= snoozeAt + 3600000) rs.snoozedUntil = 0;
      if (deps.inQuietHours(new Date(now))) return;
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
      const maxNotifications = snoozeDue ? 1 : 1 + maxFollowups;
      if (rs.lastSessionKey === key && rs.followupCount >= maxNotifications) {
        // already fully notified for this window
        return;
      }

      let shouldNotify = false;
      if (rs.lastSessionKey !== key) {
        rs.lastSessionKey = key;
        rs.followupCount = 0;
        rs.sessionStatus = "due";
        shouldNotify = true;
      } else if (rs.followupCount < maxNotifications &&
        now - (rs.lastNotifiedAt || 0) >= (rs.followupMs || 60 * 60 * 1000)) {
        shouldNotify = true;
      }

      if (shouldNotify) {
        rs.followupCount += 1;
        rs.lastNotifiedAt = now;
        rs.sessionStatus = "delivered";
        deps.save();
        fireReviewNotification(queue.length);
        deps.toast("有 " + queue.length + " 条随手记录待整理", "开始整理", () => openReviewSession());
      }
    }

    // UI identity is an item ID, never the filtered row's position.
    let selectedReviewId = null;
    let editorId = null;
    let editorRev = null;
    let reviewFilter = "pending";
    let keptReviewIds = new Set();
    let confirmedReviewIds = new Set();
    let completedReviewIds = new Map();
    const pendingReviewIds = new Set();
    const pendingReviewSnapshots = new Map();
    let lastListHtml = "";
    let returnFocus = null;
    let overlayGeneration = 0;

    function reviewItemById(id) {
      return (deps.getItems() || []).find(it => it && it.id === id) || null;
    }

    function sessionItems() {
      const state = deps.getState();
      const ids = state && state.ui && state.ui.reviewQueue || [];
      const wanted = new Set(ids);
      return needsReviewItems().filter(it => wanted.has(it.id) || pendingReviewIds.has(it.id))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    }

    function hasReviewTime(it) { return !!it.triggerAt && !it.isFallbackTrigger; }

    function openReviewSession() {
      const queue = needsReviewItems().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      if (!queue.length) { deps.toast("没有待整理事项"); return; }
      currentSessionToken += 1;
      selectedReviewId = null;
      editorId = null;
      reviewTriggerUserPicked = false;
      keptReviewIds = new Set();
      confirmedReviewIds = new Set();
      completedReviewIds = new Map();
      reviewFilter = "pending";
      lastListHtml = "";
      closeReviewOverlay("sheetReviewEdit", false);
      closeReviewOverlay("sheetReviewActions", false);
      const state = deps.getState();
      state.ui.reviewQueue = queue.map(it => it.id);
      state.ui.reviewIndex = 0; // compatibility: number processed in this session, not row identity
      ensureReviewSettings().sessionStatus = "started";
      deps.save();
      deps.openSheet("sheetReview");
      renderReviewCard();
      const body = deps.query("#reviewBody");
      if (body) body.scrollTop = 0;
      const sheet = deps.query("#sheetReview");
      if (sheet && sheet.focus) sheet.focus({ preventScroll: true });
    }

    function currentReviewItem() {
      if (editorId) return reviewItemById(editorId);
      if (selectedReviewId) return reviewItemById(selectedReviewId);
      return sessionItems().find(it => !keptReviewIds.has(it.id)) || null;
    }

    function closeReviewOverlay(id, restoreFocus) {
      overlayGeneration += 1;
      deps.closeSheet(id);
      const parent = deps.query("#sheetReview");
      if (parent) { parent.inert = false; parent.classList.toggle("review-dimmed", false); }
      if (id === "sheetReviewEdit") { editorId = null; reviewTriggerUserPicked = false; }
      if (restoreFocus !== false && returnFocus) {
        let target = returnFocus;
        if (!target.isConnected && target.dataset) {
          const id = target.dataset.reviewEdit || target.dataset.reviewMore;
          target = deps.queryAll("[data-review-edit], [data-review-more]").find(btn =>
            (btn.dataset.reviewEdit || btn.dataset.reviewMore) === id);
        }
        if (target && target.focus) target.focus({ preventScroll: true });
      }
    }

    function openReviewOverlay(id) {
      ["sheetReviewEdit", "sheetReviewActions", "sheetReviewSnooze"].forEach(other => {
        if (other !== id) deps.closeSheet(other);
      });
      overlayGeneration += 1;
      const parent = deps.query("#sheetReview");
      returnFocus = typeof document !== "undefined" ? document.activeElement : null;
      deps.openSheet(id);
      const sheet = deps.query("#" + id);
      if (sheet && sheet.focus) sheet.focus({ preventScroll: true });
      if (parent) { parent.inert = true; parent.classList.toggle("review-dimmed", true); }
    }

    function selectReviewItem(id) {
      if (reviewInflight) { deps.toast("整理会话正在保存 · 请稍后重试"); return null; }
      const it = reviewItemById(id);
      if (!it || it.review_status !== "NEEDS_REVIEW" || it.status === "archived" || it.status === "completed") {
        deps.toast("这条记录已变化 · 列表已更新"); renderReviewCard(); return null;
      }
      if (pendingReviewIds.has(id)) { deps.toast("这条事项正在保存 · 请稍后重试"); return null; }
      selectedReviewId = id;
      return it;
    }

    function openReviewEditor(id) {
      const it = selectReviewItem(id);
      if (!it) return;
      editorId = id;
      editorRev = Number(it.rev || 0);
      reviewTriggerUserPicked = false;
      const saveBtn = deps.query("#reviewSave");
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "保存并确认"; }
      const set = (s, value) => { const e = deps.query(s); if (e) e.value = value; };
      set("#reviewTitle", it.title || "");
      set("#reviewTrigger", hasReviewTime(it) ? deps.toLocalInput(it.triggerAt) : "");
      set("#reviewNote", it.note || "");
      const source = deps.query("#reviewOriginal");
      if (source) source.textContent = [it.title || "未命名", it.sourceTitle, it.url, it.sourceApp,
        "记录于 " + deps.fmtTime(it.createdAt)].filter(Boolean).join("\n");
      const details = deps.query("#reviewSourceDetails");
      if (details) details.open = false;
      openReviewOverlay("sheetReviewEdit");
    }

    function openReviewActions(id) {
      const it = selectReviewItem(id);
      if (!it) return;
      const title = deps.query("#reviewActionTitle");
      if (title) title.textContent = it.title || "未命名";
      const keep = deps.query("#reviewKeep");
      if (keep) keep.textContent = keptReviewIds.has(id) ? "放回本次整理" : "留待下次";
      const question = deps.query("#reviewDeleteQuestion");
      if (question) question.hidden = true;
      openReviewOverlay("sheetReviewActions");
    }

    function renderReviewCard() {
      const state = deps.getState();
      if (!state || !state.ui || !state.ui.reviewQueue) return;
      // completeItem owns undo. Reconcile session bookkeeping when its undo restores a row.
      completedReviewIds.forEach((counted, id) => {
        const it = reviewItemById(id);
        const completed = !!it && (it.status === "archived" || it.status === "completed");
        if (completed !== counted) {
          completedReviewIds.set(id, completed);
          state.ui.reviewIndex = Math.max(0, state.ui.reviewIndex + (completed ? 1 : -1));
        }
      });
      const completedCount = Array.from(completedReviewIds.values()).filter(Boolean).length;
      const body = deps.query("#reviewBody");
      if (!body) return;
      // A pending mutation remains visible until the authoritative save returns.
      const queue = new Set(state.ui.reviewQueue);
      const pending = Array.from(pendingReviewSnapshots.values()).filter(it => queue.has(it.id));
      const all = sessionItems().filter(it => !pendingReviewIds.has(it.id)).concat(pending)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const active = all.filter(it => !keptReviewIds.has(it.id));
      const kept = all.filter(it => keptReviewIds.has(it.id));
      const noTime = active.filter(it => !hasReviewTime(it));
      const progress = deps.query("#reviewProgress");
      if (progress) progress.textContent = String(all.length);
      const summary = deps.query("#reviewSummary");
      if (summary) summary.textContent = "按记录时间排列 · 本次已确认 " + confirmedReviewIds.size + " 条" + (completedCount ? " · 已完成 " + completedCount + " 条" : "");
      const counts = { pending: active.length, noTime: noTime.length, kept: kept.length };
      deps.queryAll("[data-review-filter]").forEach(btn => {
        const filter = btn.dataset.reviewFilter;
        btn.setAttribute("aria-pressed", filter === reviewFilter ? "true" : "false");
        const label = { pending: "待处理", noTime: "未设时间", kept: "留待下次" }[filter];
        btn.textContent = label + " " + counts[filter];
      });
      const list = reviewFilter === "kept" ? kept : reviewFilter === "noTime" ? noTime : active;
      let html = list.map(it => {
        const id = deps.escapeHtml(it.id);
        const saving = pendingReviewIds.has(it.id);
        const time = hasReviewTime(it) ? deps.fmtTime(it.triggerAt) : "未设定提醒时间";
        const source = [deps.fmtTime(it.createdAt), it.sourceApp || (it.url ? "链接记录" : "随手记录")].filter(Boolean).join(" · ");
        return '<article class="review-row" data-review-id="' + id + '">' +
          '<button class="review-row-content" data-review-edit="' + id + '"><strong>' + deps.escapeHtml(it.title || "未命名") + '</strong>' +
          '<span class="review-row-time' + (hasReviewTime(it) ? '' : ' no-time') + '">' + deps.escapeHtml(time) + '</span>' +
          '<span class="review-row-source">' + deps.escapeHtml(source) +
          (it.deadlineAt ? ' <span class="review-deadline">截止 ' + deps.escapeHtml(deps.fmtDate(it.deadlineAt)) + '</span>' : '') + '</span></button>' +
          '<div class="review-row-actions"><button class="review-row-primary' + (hasReviewTime(it) ? ' ready' : '') +
          '" data-review-primary="' + id + '"' + (saving ? ' disabled aria-busy="true"' : '') + '>' +
          (saving ? '保存中' : keptReviewIds.has(it.id) ? '放回' : hasReviewTime(it) ? '确认' : '整理') + '</button>' +
          '<button class="review-row-primary" data-review-complete="' + id + '" aria-label="将' + deps.escapeHtml(it.title || "未命名") + '标为已完成"' + (saving ? ' disabled aria-busy="true"' : '') + '>已完成</button>' +
          '<button class="review-row-more" data-review-more="' + id + '" aria-label="' + deps.escapeHtml(it.title || "未命名") + '的更多操作">•••</button></div></article>';
      }).join("");
      if (!list.length) {
        html = all.length ? '<div class="empty"><h3>' + (reviewFilter === "kept" ? '没有留待下次的记录' : reviewFilter === "noTime" ? '没有未设时间的记录' : '本次清单已处理') +
          '</h3><p>' + (kept.length ? '还有 ' + kept.length + ' 条留待下次，可切换筛选继续。' : '可以切换筛选查看其他记录。') + '</p></div>' :
          '<div class="empty"><div class="empty-mark">✓</div><h3>整理完成</h3><p>确认整理不等于已知晓或完成事项。</p></div>';
      }
      if (lastListHtml !== html) {
        const top = body.scrollTop;
        body.innerHTML = html;
        body.scrollTop = top;
        lastListHtml = html;
        deps.queryAll("[data-review-complete]").forEach(btn => { btn.onclick = () => reviewComplete(btn.dataset.reviewComplete); });
        deps.queryAll("[data-review-edit]").forEach(btn => { btn.onclick = () => openReviewEditor(btn.dataset.reviewEdit); });
        deps.queryAll("[data-review-more]").forEach(btn => { btn.onclick = () => openReviewActions(btn.dataset.reviewMore); });
        deps.queryAll("[data-review-primary]").forEach(btn => { btn.onclick = () => {
          const it = selectReviewItem(btn.dataset.reviewPrimary);
          if (!it) return;
          if (keptReviewIds.has(it.id)) { keptReviewIds.delete(it.id); renderReviewCard(); }
          else if (hasReviewTime(it)) reviewConfirm();
          else openReviewEditor(it.id);
        }; });
      }
      const foot = deps.query("#reviewFoot");
      if (foot) {
        const footHtml = all.length ? '<button class="btn secondary" id="reviewSnooze">稍后整理</button><button class="btn secondary" id="reviewSkip">跳过本次整理</button>' :
          '<button class="btn primary" data-close="sheetReview" id="btnReviewDone">返回首页</button>';
        if (foot.innerHTML !== footHtml) {
          foot.innerHTML = footHtml;
          const bSnooze = deps.query("#reviewSnooze");
          if (bSnooze) bSnooze.onclick = () => { if (!pendingReviewIds.size) openReviewOverlay("sheetReviewSnooze"); };
          const bSkip = deps.query("#reviewSkip");
          if (bSkip) bSkip.onclick = skipReviewThisTime;
          const doneBtn = deps.query("#btnReviewDone");
          if (doneBtn) doneBtn.addEventListener("click", () => { deps.closeSheet("sheetReview"); });
        }
      }
    }

    /**
     * L05：确认 ≠ 采用系统兜底时间。三种来源分开处理 ——
     *  · 用户在卡片里明确改过时间 → 采用，并解除兜底标记；
     *  · 记录本来就有真实时间 → 保留；
     *  · 只有兜底值（或时间已过期）→ 顺延到下一个整理窗口，**不生成立即到期提醒**。
     */
    function resolveReviewTrigger(it) {
      const input = deps.query("#reviewTrigger");
      const typed = input ? deps.parseLocalInput(input.value) : null;
      if (reviewTriggerUserPicked) return typed
        ? { triggerAt: typed, keepFallback: false }
        : { triggerAt: fallbackTriggerAt(), keepFallback: true };
      if (it.isFallbackTrigger) return { triggerAt: fallbackTriggerAt(), keepFallback: true };
      if (it.triggerAt) return { triggerAt: it.triggerAt, keepFallback: false };
      return { triggerAt: fallbackTriggerAt(), keepFallback: true };
    }

    function rawMarkReviewDone(item, extra) {
      if (!item) return false;
      if (extra && extra.restore) {
        if (Number(item.rev || 0) !== Number(extra.expectedRev) ||
            (extra.expectedSignature && reviewUndoSignature(item) !== extra.expectedSignature)) return false;
        const rev = item.rev;
        const sameRound = item.triggerAt === extra.restore.triggerAt;
        const projections = { reminderEvents: item.reminderEvents, deadlineEvents: item.deadlineEvents };
        restoreReviewSnapshot(item, extra.restore);
        if (sameRound) Object.assign(item, projections);
        item.rev = rev;
        deps.bumpRev(item);
        return true;
      }
      item.review_status = "REVIEWED";
      item.reviewed_at = Date.now();
      if (extra && extra.triggerAt != null) {
        item.triggerAt = extra.triggerAt;
        item.scheduleBasis = "wall-clock";
        item.localTrigger = deps.toLocalInput(extra.triggerAt);
        if (item.triggerAt > Date.now() && (item.status === "due" || item.status === "acknowledged")) {
          item.status = "waiting";
        }
      }
      // 只有「用户明确采用了一个时间」才解除兜底标记（L01）
      item.isFallbackTrigger = !!(extra && extra.keepFallback);
      if (extra && extra.title != null) item.title = extra.title;
      if (extra && extra.note != null) item.note = extra.note;
      deps.bumpRev(item);
      return true;
    }

    const wrappedMarkReviewDone = deps.wrapUserOp(rawMarkReviewDone, { name: "markReviewDone", userFacing: true, itemArg: 0 });

    function restoreReviewSnapshot(item, snapshot) {
      Object.keys(item).forEach(key => { if (!Object.prototype.hasOwnProperty.call(snapshot, key)) delete item[key]; });
      Object.assign(item, JSON.parse(JSON.stringify(snapshot)));
    }

    function reviewUndoSignature(item) {
      const business = Object.assign({}, item);
      ["reminderEvents", "deadlineEvents"].forEach(field => {
        const facts = {};
        Object.keys(item[field] || {}).sort().forEach(key => {
          const row = item[field][key];
          if (row && (row.state !== "scheduled" && row.state !== "cancelled" || row.lostAt)) facts[key] = row;
        });
        business[field] = facts;
      });
      const canonical = value => {
        if (!value || typeof value !== "object") return value;
        if (Array.isArray(value)) return value.map(canonical);
        const out = {};
        Object.keys(value).sort().forEach(key => { out[key] = canonical(value[key]); });
        return out;
      };
      return JSON.stringify(canonical(business));
    }

    async function commitReview(edit) {
      const it = currentReviewItem();
      if (!it || pendingReviewIds.has(it.id) || reviewInflight) return false;
      if (edit && editorId && (editorId !== it.id || Number(it.rev || 0) !== editorRev)) {
        deps.toast("这条记录已变化 · 请重新打开后整理"); return false;
      }
      const token = currentSessionToken;
      const overlay = overlayGeneration;
      const itemId = it.id;
      const before = JSON.parse(JSON.stringify(it));
      const resolved = resolveReviewTrigger(it);
      const extra = { keepFallback: resolved.keepFallback };
      if (reviewTriggerUserPicked || it.isFallbackTrigger || !it.triggerAt) extra.triggerAt = resolved.triggerAt;
      if (edit) {
        const titleInput = deps.query("#reviewTitle");
        const title = titleInput && titleInput.value.trim();
        if (!title) { deps.toast("请填写标题"); return false; }
        extra.title = title;
        const noteInput = deps.query("#reviewNote");
        extra.note = noteInput ? noteInput.value.trim() : it.note;
      }
      if (wrappedMarkReviewDone(it, extra) === false) return false;
      const appliedRev = it.rev;
      pendingReviewIds.add(itemId);
      pendingReviewSnapshots.set(itemId, before);
      renderReviewCard();
      const saveBtn = deps.query("#reviewSave");
      if (saveBtn && editorId === itemId) { saveBtn.disabled = true; saveBtn.textContent = "保存中…"; }
      try {
        await deps.save();
        deps.queueNativeReminderSync("review-confirm");
        if (currentSessionToken === token) {
          confirmedReviewIds.add(itemId);
          keptReviewIds.delete(itemId);
          deps.getState().ui.reviewIndex += 1;
          if (selectedReviewId === itemId) selectedReviewId = null;
          if (!editorId || editorId === itemId) reviewTriggerUserPicked = false;
          if (editorId === itemId && overlayGeneration === overlay) closeReviewOverlay("sheetReviewEdit", false);
          const after = reviewUndoSignature(reviewItemById(itemId));
          const expires = Date.now() + 8000;
          const undoReview = async () => {
            const target = reviewItemById(itemId);
            if (!target || Date.now() >= expires || reviewUndoSignature(target) !== after || pendingReviewIds.has(itemId)) {
              deps.toast("这条记录已变化 · 请直接修改"); return;
            }
            // Restore only the fields changed by this confirmation. Retain current projection rows
            // when the time is unchanged; a changed round is reconstructed by reconciliation.
            const undoBefore = JSON.parse(JSON.stringify(target));
            const restore = Object.assign({}, target);
            ["review_status", "reviewed_at", "triggerAt", "scheduleBasis", "localTrigger",
              "isFallbackTrigger", "title", "note", "status"].forEach(key => {
              if (Object.prototype.hasOwnProperty.call(before, key)) restore[key] = before[key];
              else delete restore[key];
            });
            if (restore.triggerAt !== target.triggerAt) {
              restore.reminderEvents = before.reminderEvents || {};
              restore.deadlineEvents = before.deadlineEvents || {};
            }
            if (wrappedMarkReviewDone(target, { restore, expectedRev: target.rev, expectedSignature: after }) === false) return;
            pendingReviewIds.add(itemId);
            const undoRev = target.rev;
            const undoSignature = reviewUndoSignature(target);
            try {
              await deps.save();
              if (currentSessionToken === token) {
                confirmedReviewIds.delete(itemId);
                deps.getState().ui.reviewIndex = Math.max(0, deps.getState().ui.reviewIndex - 1);
              }
              deps.queueNativeReminderSync("review-undo");
              deps.toast("已放回待整理");
            } catch (err) {
              const live = reviewItemById(itemId);
              if (live && live.rev === undoRev && reviewUndoSignature(live) === undoSignature) {
                const projections = { reminderEvents: live.reminderEvents, deadlineEvents: live.deadlineEvents };
                const sameRound = live.triggerAt === undoBefore.triggerAt;
                restoreReviewSnapshot(live, undoBefore);
                if (sameRound) Object.assign(live, projections);
              }
              deps.toast("撤销未保存 · 请重试", "撤销", undoReview, null, { durationMs: Math.max(1, expires - Date.now()) });
            } finally {
              pendingReviewIds.delete(itemId); renderReviewCard(); deps.render();
            }
          };
          deps.toast("已确认整理 · 事项尚未完成", "撤销", undoReview, null, { durationMs: 8000 });
        }
        return true;
      } catch (err) {
        // Authoritative save rejected: do not advance reviewIndex or declare completion.
        const live = reviewItemById(itemId);
        if (live && live.rev === appliedRev) restoreReviewSnapshot(live, before);
        deps.toast("整理未保存 · 请重试");
        return false;
      } finally {
        pendingReviewIds.delete(itemId);
        pendingReviewSnapshots.delete(itemId);
        if (saveBtn && editorId === itemId) { saveBtn.disabled = false; saveBtn.textContent = "保存并确认"; }
        renderReviewCard();
        deps.render();
      }
    }

    function reviewComplete(id) {
      const it = selectReviewItem(id);
      if (!it) return false;
      // Keep completion, recurrence, terminal protection and undo in the shared item command.
      const nextIndex = deps.getState().ui.reviewIndex + (keptReviewIds.has(it.id) ? 0 : 1);
      const completed = deps.completeItem(it.id);
      if (completed === false) return false;
      deps.getState().ui.reviewIndex = nextIndex;
      completedReviewIds.set(it.id, true);
      keptReviewIds.delete(it.id);
      selectedReviewId = null;
      renderReviewCard();
      return true;
    }

    function reviewConfirm() { return commitReview(false); }
    function reviewSaveEdit() { return commitReview(true); }

    // Keep changes only this session's queue view; it never changes NEEDS_REVIEW or schedules.
    function reviewKeepCurrent() {
      const it = currentReviewItem();
      if (!it || pendingReviewIds.has(it.id)) return;
      if (keptReviewIds.has(it.id)) keptReviewIds.delete(it.id);
      else { keptReviewIds.add(it.id); deps.getState().ui.reviewIndex += 1; }
      selectedReviewId = null;
      closeReviewOverlay("sheetReviewActions");
      renderReviewCard();
      deps.toast("已更新本次清单 · 记录仍待整理");
    }

    async function reviewDelete() {
      const it = currentReviewItem();
      if (!it || pendingReviewIds.has(it.id)) return;
      const id = it.id;
      const token = currentSessionToken;
      const overlay = overlayGeneration;
      pendingReviewIds.add(id);
      pendingReviewSnapshots.set(id, JSON.parse(JSON.stringify(it)));
      try {
        const deleted = await deps.deleteItem(id, { waitForSave: true });
        if (deleted === false) return;
        if (currentSessionToken === token && overlayGeneration === overlay) {
          deps.getState().ui.reviewIndex += 1;
          selectedReviewId = null;
          closeReviewOverlay("sheetReviewActions", false);
        }
      } finally { pendingReviewIds.delete(id); pendingReviewSnapshots.delete(id); renderReviewCard(); }
    }

    async function snoozeReview(ms, label) {
      if (reviewInflight || pendingReviewIds.size) return;
      const rs = ensureReviewSettings();
      const before = { snoozedUntil: rs.snoozedUntil, skippedUntil: rs.skippedUntil, sessionStatus: rs.sessionStatus };
      const token = currentSessionToken;
      rs.snoozedUntil = Date.now() + ms;
      rs.sessionStatus = "snoozed";
      reviewInflight = true;
      try {
        const p = deps.save();
        if (p && typeof p.then === "function") await p;
        if (token === currentSessionToken) deps.closeSheet("sheetReview");
        deps.toast("待整理稍后提醒 · " + label);
        // D19：普通通知，不走全屏闹钟
        fireReviewNotification(needsReviewItems().length);
        deps.queueNativeReminderSync();
      } catch (err) {
        Object.assign(rs, before);
        deps.toast("整理安排未保存 · 请重试");
        // Save failed: do not close sheet or trigger side effects
      } finally {
        reviewInflight = false;
      }
    }

    async function skipReviewThisTime() {
      if (reviewInflight || pendingReviewIds.size) return;
      const rs = ensureReviewSettings();
      const before = { snoozedUntil: rs.snoozedUntil, skippedUntil: rs.skippedUntil, sessionStatus: rs.sessionStatus };
      const token = currentSessionToken;
      rs.skippedUntil = nextReviewWindowStart();
      rs.sessionStatus = "skipped";
      reviewInflight = true;
      try {
        const p = deps.save();
        if (p && typeof p.then === "function") await p;
        if (token === currentSessionToken) deps.closeSheet("sheetReview");
        deps.toast("已跳过本次 · 下个整理时间再见");
      } catch (err) {
        Object.assign(rs, before);
        deps.toast("整理安排未保存 · 请重试");
        // Save failed: do not close sheet or toast success
      } finally {
        reviewInflight = false;
      }
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
      const host = deps.query("#homeReview");
      if (!host) return;
      const n = needsReviewItems().length;
      if (!n) {
        deps.writeIfChanged(host, "");
        return;
      }
      const strong = inReviewHighlight();
      let html;
      if (strong) {
        // 显著：提到最前，带数字
        html = '<button class="soft-entry strong-entry" id="openReview" style="margin-bottom:10px;border-color:var(--attention);background:var(--attention-bg)">' +
          '<span><strong style="color:#7a540e">待整理 · ' + n + "</strong><br><span class=\"review-sub\" style=\"font-size:0.78rem;color:#8a6a17\">信息尚未二次确认，不是逾期任务</span></span>" +
          "<span>整理 ›</span></button>";
      } else {
        // 弱形态：无数字、无强调色
        html = '<button class="soft-entry" id="openReview" style="margin-bottom:10px;opacity:.75">' +
          '<span><strong style="font-weight:500;color:var(--muted)">待整理</strong><br>' +
          '<span class=\"review-sub\" style=\"font-size:0.78rem;color:var(--muted)\">信息尚未二次确认，不是逾期任务</span></span>' +
          "<span style=\"color:var(--muted)\">›</span></button>";
      }
      // O6：这个入口在**每一拍** renderHome 都会被调用一次（包括被签名短路的那一拍），
      // 但内容只在数量 / 高亮窗口变化时才变 —— 单写入者容器，内容相同就不重建。
      if (!deps.writeIfChanged(host, html)) return;
      const btn = deps.query("#openReview");
      if (btn) btn.addEventListener("click", () => openReviewSession());
    }

    function scheduleNextReviewAlarm() {
      const rs = ensureReviewSettings();
      if (!rs.enabled) return;
      const count = needsReviewItems().length;
      if (!count) return;
      const settings = deps.getSettings ? deps.getSettings() : (deps.getState() && deps.getState().settings);
      if (!settings || !settings.notify) return;
      // D19：原生侧由 reconcile 预排 LocalNotifications；Web 侧依赖 tick
      deps.queueNativeReminderSync();
    }

    /**
     * 绑定待整理控件：**只在事务体全部成功后**才置位，失败则整体回滚并可重试。
     */
    function bindReviewControls() {
      if (reviewControlsBound) return;
      registered = [];
      try {
        bindReviewControlNodes();
        reviewControlsBound = true;
      } catch (error) {
        rollbackListeners();
        throw error;
      } finally {
        registered = [];
      }
    }

    /** 绑定的**事务体**：全部注册动作都在这里。 */
    function bindReviewControlNodes() {
      deps.queryAll("[data-review-filter]").forEach(btn => {
        listen(btn, "click", () => {
          reviewFilter = btn.dataset.reviewFilter;
          selectedReviewId = null;
          renderReviewCard();
          const body = deps.query("#reviewBody");
          if (body) body.scrollTop = 0;
        });
      });
      deps.queryAll("[data-review-close]").forEach(btn => {
        listen(btn, "click", () => closeReviewOverlay(btn.dataset.reviewClose));
      });
      const trigger = deps.query("#reviewTrigger");
      if (trigger) listen(trigger, "change", () => { reviewTriggerUserPicked = true; });
      const saveReview = deps.query("#reviewSave");
      if (saveReview) listen(saveReview, "click", reviewSaveEdit);
      const editReview = deps.query("#reviewEdit");
      if (editReview) listen(editReview, "click", () => {
        const id = selectedReviewId;
        const focus = returnFocus;
        closeReviewOverlay("sheetReviewActions", false);
        openReviewEditor(id);
        returnFocus = focus;
      });
      const keepReview = deps.query("#reviewKeep");
      if (keepReview) listen(keepReview, "click", reviewKeepCurrent);
      const deleteReview = deps.query("#reviewDelete");
      if (deleteReview) listen(deleteReview, "click", () => {
        const question = deps.query("#reviewDeleteQuestion");
        if (question) question.hidden = false;
      });
      const deleteCancel = deps.query("#reviewDeleteCancel");
      if (deleteCancel) listen(deleteCancel, "click", () => {
        const question = deps.query("#reviewDeleteQuestion");
        if (question) question.hidden = true;
      });
      const deleteConfirm = deps.query("#reviewDeleteConfirm");
      if (deleteConfirm) listen(deleteConfirm, "click", reviewDelete);
      deps.queryAll("[data-review-time]").forEach(btn => {
        listen(btn, "click", () => {
          const field = deps.query("#reviewTrigger");
          if (!field) return;
          const choice = btn.dataset.reviewTime;
          const date = new Date();
          if (choice === "tomorrow") { date.setDate(date.getDate() + 1); date.setHours(9, 0, 0, 0); }
          else date.setHours(20, 0, 0, 0);
          field.value = choice === "clear" ? "" : deps.toLocalInput(date.getTime());
          reviewTriggerUserPicked = true;
        });
      });
      ["sheetReview", "sheetReviewEdit", "sheetReviewActions", "sheetReviewSnooze"].forEach(id => {
        const sheet = deps.query("#" + id);
        listen(sheet, "attention:sheet-closed", () => {
          overlayGeneration += 1;
          if (id === "sheetReview") {
            currentSessionToken += 1;
            ["sheetReviewEdit", "sheetReviewActions", "sheetReviewSnooze"].forEach(child => deps.closeSheet(child));
            selectedReviewId = null; editorId = null; reviewTriggerUserPicked = false;
          } else if (id === "sheetReviewEdit") { editorId = null; reviewTriggerUserPicked = false; }
          const parent = deps.query("#sheetReview");
          const anyOpen = ["sheetReviewEdit", "sheetReviewActions", "sheetReviewSnooze"].some(child => {
            const el = deps.query("#" + child); return el && el.classList.contains("open");
          });
          if (parent) { parent.inert = anyOpen; parent.classList.toggle("review-dimmed", anyOpen); }
          if (id === "sheetReview") {
            const entry = deps.query("#openReview");
            if (entry && entry.focus) entry.focus({ preventScroll: true });
          } else if (!anyOpen && parent && parent.classList.contains("open")) {
            const target = returnFocus && returnFocus.isConnected ? returnFocus : parent;
            if (target.focus) target.focus({ preventScroll: true });
          }
        });
        listen(sheet, "keydown", e => {
          if (e.key === "Escape") {
            e.preventDefault(); e.stopPropagation();
            if (id === "sheetReview") deps.closeSheet(id);
            else closeReviewOverlay(id);
          } else if (e.key === "Tab" && sheet.querySelectorAll) {
            const controls = Array.from(sheet.querySelectorAll('button:not([disabled]), input, textarea, summary, [tabindex="0"]'))
              .filter(el => !el.hidden && el.getClientRects().length);
            const first = controls[0], last = controls[controls.length - 1];
            if (first && ((!e.shiftKey && (e.target === last || e.target === sheet)) || (e.shiftKey && (e.target === first || e.target === sheet)))) {
              e.preventDefault(); (e.shiftKey ? last : first).focus({ preventScroll: true });
            }
          }
        });
      });

      const snoozeBtns = deps.queryAll ? deps.queryAll("[data-snooze-review]") : [];
      snoozeBtns.forEach(btn => {
        listen(btn, "click", () => {
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
            const rs = ensureReviewSettings();
            d.setHours(rs.hour || 21, rs.minute || 30, 0, 0);
            ms = d.getTime() - Date.now();
            label = "明天";
          } else if (v === "next") {
            ms = nextReviewWindowStart() - Date.now();
            label = "下一个整理时间";
          }
          if (ms < 60000) ms = 60000;
          closeReviewOverlay("sheetReviewSnooze", false);
          snoozeReview(ms, label);
        });
      });

      const btnReviewSettings = deps.query("#btnReviewSettings");
      if (btnReviewSettings) {
        listen(btnReviewSettings, "click", () => {
          const rs = ensureReviewSettings();
          const sw = deps.query("#swReviewEnabled");
          if (sw) {
            sw.classList.toggle("on", !!rs.enabled);
            sw.setAttribute("aria-checked", rs.enabled ? "true" : "false");
          }
          const start = deps.query("#reviewStart");
          const end = deps.query("#reviewEnd");
          if (start) start.value = pad(rs.hour || 21) + ":" + pad(rs.minute || 30);
          if (end) end.value = pad(rs.windowEndHour != null ? rs.windowEndHour : 23) + ":" + pad(rs.windowEndMinute || 0);
          deps.openSheet("sheetReviewSchedule");
        });
      }
      const swReviewEnabled = deps.query("#swReviewEnabled");
      if (swReviewEnabled) {
        listen(swReviewEnabled, "click", () => {
          /* 视觉 on 类与 aria-checked 同步翻面（读屏以 aria-checked 为准） */
          swReviewEnabled.setAttribute("aria-checked",
            swReviewEnabled.classList.toggle("on") ? "true" : "false");
        });
      }
      const btnSaveReviewSchedule = deps.query("#btnSaveReviewSchedule");
      if (btnSaveReviewSchedule) {
        listen(btnSaveReviewSchedule, "click", async () => {
          if (reviewInflight) return;
          const rs = ensureReviewSettings();
          const sw = deps.query("#swReviewEnabled");
          rs.enabled = sw ? sw.classList.contains("on") : true;
          const startInput = deps.query("#reviewStart");
          const endInput = deps.query("#reviewEnd");
          const start = (startInput && startInput.value) || "21:30";
          const end = (endInput && endInput.value) || "23:00";
          const sm = start.match(/^(\d{1,2}):(\d{2})$/);
          const em = end.match(/^(\d{1,2}):(\d{2})$/);
          if (sm) { rs.hour = parseInt(sm[1], 10); rs.minute = parseInt(sm[2], 10); }
          if (em) { rs.windowEndHour = parseInt(em[1], 10); rs.windowEndMinute = parseInt(em[2], 10); }
          rs.lastSessionKey = "";
          rs.followupCount = 0;
          rs.snoozedUntil = 0;
          rs.skippedUntil = 0;
          reviewInflight = true;
          try {
            const p = deps.save();
            if (p && typeof p.then === "function") await p;
            deps.closeSheet("sheetReviewSchedule");
            if (deps.renderMe) deps.renderMe();
            scheduleNextReviewAlarm();
            deps.toast("待整理时间已保存");
          } catch (err) {
            // Save failed
          } finally {
            reviewInflight = false;
          }
        });
      }
    }

    return {
      ensureReviewSettings: ensureReviewSettings,
      fallbackTriggerAt: fallbackTriggerAt,
      reviewSessionKey: reviewSessionKey,
      nextReviewWindowStart: nextReviewWindowStart,
      inReviewWindow: inReviewWindow,
      inReviewHighlight: inReviewHighlight,
      isVagueContent: isVagueContent,
      detectNeedsReview: detectNeedsReview,
      needsReviewItems: needsReviewItems,
      fireReviewNotification: fireReviewNotification,
      maybeReviewSession: maybeReviewSession,
      openReviewSession: openReviewSession,
      currentReviewItem: currentReviewItem,
      scheduleNextReviewAlarm: scheduleNextReviewAlarm,
      renderReviewCard: renderReviewCard,
      resolveReviewTrigger: resolveReviewTrigger,
      markReviewDone: wrappedMarkReviewDone,
      reviewConfirm: reviewConfirm,
      reviewComplete: reviewComplete,
      reviewSaveEdit: reviewSaveEdit,
      reviewKeepCurrent: reviewKeepCurrent,
      reviewDelete: reviewDelete,
      snoozeReview: snoozeReview,
      skipReviewThisTime: skipReviewThisTime,
      renderReviewEntry: renderReviewEntry,
      bindReviewControls: bindReviewControls,
      markReviewTriggerPicked: markReviewTriggerPicked,
      isFallbackSuppressed: isFallbackSuppressed
    };
  }

  return {
    createAppReview: createAppReview
  };
});
