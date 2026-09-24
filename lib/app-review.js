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
      "parseLocalInput", "escapeHtml", "deleteItem", "bumpRev", "wrapUserOp",
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

    function openReviewSession() {
      const queue = needsReviewItems().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      if (!queue.length) {
        deps.toast("没有待整理事项");
        return;
      }
      currentSessionToken += 1;
      reviewInflight = false;
      const state = deps.getState();
      state.ui.reviewQueue = queue.map(it => it.id);
      state.ui.reviewIndex = 0;
      ensureReviewSettings().sessionStatus = "started";
      deps.save();
      deps.openSheet("sheetReview");
      renderReviewCard();
    }

    function currentReviewItem() {
      const state = deps.getState();
      if (!state || !state.ui || !state.ui.reviewQueue) return null;
      const id = state.ui.reviewQueue[state.ui.reviewIndex];
      const items = (deps.getItems ? deps.getItems() : state.items) || [];
      return items.find(x => x && x.id === id) || null;
    }

    function renderReviewCard() {
      const state = deps.getState();
      if (!state || !state.ui || !state.ui.reviewQueue) return;
      const total = state.ui.reviewQueue.length;
      const idx = state.ui.reviewIndex || 0;
      const progress = deps.query("#reviewProgress");
      const body = deps.query("#reviewBody");
      // 每张卡片是独立的一次「采用/不采用时间」判断，不能继承上一条的选择
      reviewTriggerUserPicked = false;
      if (!body) return;
      if (idx >= total) {
        if (progress) progress.textContent = "全部处理完成";
        body.innerHTML = '<div class="empty"><div class="empty-mark">✓</div><h3>整理完成</h3><p>已确认的记录已进入正常提醒流程。</p></div>';
        const foot = deps.query("#reviewFoot");
        if (foot) {
          foot.innerHTML = '<button class="btn primary" data-close="sheetReview" id="btnReviewDone">完成</button>';
          const doneBtn = deps.query("#btnReviewDone") || (foot.querySelector ? foot.querySelector('[data-close="sheetReview"]') : null);
          if (doneBtn) {
            doneBtn.addEventListener("click", () => {
              deps.closeSheet("sheetReview");
            });
          }
        }
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
        ? "未设定时间 · 确认后顺延到下一个整理窗口（" + deps.fmtTime(fallbackTriggerAt()) + "）"
        : (!it.triggerAt
          ? "未设定时间"
          : deps.fmtTime(it.triggerAt) + (it.deadlineAt ? " · 截止 " + deps.fmtDate(it.deadlineAt) : ""));
      const sourceBits = [];
      if (it.sourceTitle) sourceBits.push(deps.escapeHtml(it.sourceTitle));
      if (it.url) sourceBits.push(deps.escapeHtml(it.url));
      if (it.sourceApp) sourceBits.push(deps.escapeHtml(it.sourceApp));
      sourceBits.push("记录于 " + deps.fmtTime(it.createdAt));

      body.innerHTML =
        '<div class="detail-title">' + deps.escapeHtml(it.title || "未命名") + "</div>" +
        (it.note ? '<p style="color:var(--muted);font-size:0.9rem;margin-bottom:10px;white-space:pre-wrap">' + deps.escapeHtml(it.note) + "</p>" : "") +
        '<dl class="detail-rows">' +
        '<div class="detail-row"><dt>原始记录</dt><dd>' + deps.escapeHtml(it.title || "") + "</dd></div>" +
        '<div class="detail-row"><dt>系统解析</dt><dd>' + deps.escapeHtml(parsedHint) + "</dd></div>" +
        (sourceBits.length ? '<div class="detail-row"><dt>来源</dt><dd>' + sourceBits.join("<br>") + "</dd></div>" : "") +
        "</dl>" +
        '<div class="field"><label for="reviewTitle">标题</label><input id="reviewTitle" type="text" value="' + deps.escapeHtml(it.title || "") + '" /></div>' +
        // L05：兜底记录不再把兜底值预填进输入框 —— 预填会让「确认」看起来像采用了那个时间
        '<div class="field"><label for="reviewTrigger">提醒时间</label><input id="reviewTrigger" type="datetime-local" value="' +
        (it.isFallbackTrigger ? "" : deps.toLocalInput(it.triggerAt)) + '"' +
        (it.isFallbackTrigger ? ' placeholder="未设定 · 不选则顺延到下一个整理窗口"' : "") + " /></div>" +
        '<div class="field"><label for="reviewNote">备注（可选）</label><input id="reviewNote" type="text" value="' + deps.escapeHtml(it.note || "") + '" placeholder="例如：主要想看它的调度机制" /></div>';

      // L05：只有用户真的手动改过提醒时间，才算「明确采用这个时间」
      const trigInput = deps.query("#reviewTrigger");
      if (trigInput && trigInput.addEventListener) {
        trigInput.addEventListener("change", () => { reviewTriggerUserPicked = true; });
      }

      // P0-3：「稍后 / 跳过本次」必须随每次渲染重建 —— 整块替换 innerHTML 会把静态节点连监听器一起丢掉
      const foot = deps.query("#reviewFoot");
      if (foot) {
        foot.innerHTML =
          '<button class="btn secondary" id="reviewSnooze">稍后</button>' +
          '<button class="btn secondary" id="reviewSkip">跳过本次</button>' +
          '<button class="btn secondary" id="reviewKeep">留着待整理</button>' +
          '<button class="btn secondary" id="reviewDelete">删除</button>' +
          '<button class="btn secondary" id="reviewConfirm">确认</button>' +
          '<button class="btn primary" id="reviewSave">保存修改</button>';
        const bSnooze = deps.query("#reviewSnooze");
        if (bSnooze) bSnooze.onclick = () => deps.openSheet("sheetReviewSnooze");
        const bSkip = deps.query("#reviewSkip");
        if (bSkip) bSkip.onclick = skipReviewThisTime;
        // L05：逐条保留并前进 —— 「稍后 / 跳过本次」管的是整场会话，不是单条
        const bKeep = deps.query("#reviewKeep");
        if (bKeep) bKeep.onclick = reviewKeepCurrent;
        const bDel = deps.query("#reviewDelete");
        if (bDel) bDel.onclick = reviewDelete;
        const bConf = deps.query("#reviewConfirm");
        if (bConf) bConf.onclick = reviewConfirm;
        const bSave = deps.query("#reviewSave");
        if (bSave) bSave.onclick = reviewSaveEdit;
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
      if (reviewTriggerUserPicked && typed) return { triggerAt: typed, keepFallback: false };
      if (it.isFallbackTrigger) return { triggerAt: fallbackTriggerAt(), keepFallback: true };
      if (it.triggerAt) return { triggerAt: it.triggerAt, keepFallback: false };
      return { triggerAt: fallbackTriggerAt(), keepFallback: true };
    }

    function rawMarkReviewDone(item, extra) {
      if (!item) return false;
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
      if (!(extra && extra.keepFallback)) item.isFallbackTrigger = false;
      if (extra && extra.title != null) item.title = extra.title;
      if (extra && extra.note != null) item.note = extra.note;
      deps.bumpRev(item);
      return true;
    }

    const wrappedMarkReviewDone = deps.wrapUserOp(rawMarkReviewDone, { name: "markReviewDone", userFacing: true, itemArg: 0 });

    async function reviewConfirm() {
      if (reviewInflight) return;
      const it = currentReviewItem();
      if (!it) return;
      const resolved = resolveReviewTrigger(it);
      const state = deps.getState();
      if (!state || !state.ui) return;
      const token = currentSessionToken;
      const index = state.ui.reviewIndex || 0;
      const itemId = it.id;

      if (wrappedMarkReviewDone(it, { triggerAt: resolved.triggerAt, keepFallback: resolved.keepFallback }) === false) return;

      reviewInflight = true;
      try {
        const p = deps.save();
        if (p && typeof p.then === "function") {
          await p;
        }
        const curState = deps.getState();
        if (curState && curState.ui &&
            currentSessionToken === token &&
            curState.ui.reviewIndex === index &&
            curState.ui.reviewQueue &&
            curState.ui.reviewQueue[index] === itemId) {
          curState.ui.reviewIndex += 1;
          deps.queueNativeReminderSync();
          renderReviewCard();
          deps.render();
        }
      } catch (err) {
        // Authoritative save rejected: do not advance reviewIndex or declare completion.
        // Item remains on current card and retryable by user.
      } finally {
        reviewInflight = false;
      }
    }

    async function reviewSaveEdit() {
      if (reviewInflight) return;
      const it = currentReviewItem();
      if (!it) return;
      const titleInput = deps.query("#reviewTitle");
      const title = (titleInput && titleInput.value.trim()) || it.title;
      const resolved = resolveReviewTrigger(it);
      const noteInput = deps.query("#reviewNote");
      const note = noteInput ? noteInput.value.trim() : it.note;
      const state = deps.getState();
      if (!state || !state.ui) return;
      const token = currentSessionToken;
      const index = state.ui.reviewIndex || 0;
      const itemId = it.id;

      if (wrappedMarkReviewDone(it, {
        title,
        triggerAt: resolved.triggerAt,
        keepFallback: resolved.keepFallback,
        note
      }) === false) return;

      reviewInflight = true;
      try {
        const p = deps.save();
        if (p && typeof p.then === "function") {
          await p;
        }
        const curState = deps.getState();
        if (curState && curState.ui &&
            currentSessionToken === token &&
            curState.ui.reviewIndex === index &&
            curState.ui.reviewQueue &&
            curState.ui.reviewQueue[index] === itemId) {
          curState.ui.reviewIndex += 1;
          deps.queueNativeReminderSync();
          renderReviewCard();
          deps.render();
        }
      } catch (err) {
        // Authoritative save rejected: do not advance reviewIndex or declare completion.
        // Item remains on current card and retryable by user.
      } finally {
        reviewInflight = false;
      }
    }

    /**
     * L05 / V0.2 §9.4「中途退出：逐条即时持久化，下次只继续剩余项」。
     * 「稍后 / 跳过本次」管的是整场会话，不能拿来处理「这一条我还想不清」——
     * 于是需要一个逐条的「留着待整理」出口：本条留在队列里，先处理下一条。
     */
    function reviewKeepCurrent() {
      if (reviewInflight) return;
      const it = currentReviewItem();
      if (!it) return;
      const state = deps.getState();
      state.ui.reviewIndex += 1;
      renderReviewCard();
      deps.toast("已保留这条 · 下次整理再处理");
    }

    function reviewDelete() {
      if (reviewInflight) return;
      const it = currentReviewItem();
      if (!it) return;
      const state = deps.getState();
      if (!state || !state.ui) return;
      const token = currentSessionToken;
      const index = state.ui.reviewIndex || 0;
      const itemId = it.id;
      if (deps.deleteItem(it.id) === false) return;
      const curState = deps.getState();
      if (curState && curState.ui &&
          currentSessionToken === token &&
          curState.ui.reviewIndex === index &&
          curState.ui.reviewQueue &&
          curState.ui.reviewQueue[index] === itemId) {
        curState.ui.reviewIndex += 1;
        renderReviewCard();
      }
    }

    async function snoozeReview(ms, label) {
      if (reviewInflight) return;
      const rs = ensureReviewSettings();
      rs.snoozedUntil = Date.now() + ms;
      rs.sessionStatus = "snoozed";
      reviewInflight = true;
      try {
        const p = deps.save();
        if (p && typeof p.then === "function") await p;
        deps.closeSheet("sheetReview");
        deps.toast("待整理稍后提醒 · " + label);
        // D19：普通通知，不走全屏闹钟
        fireReviewNotification(needsReviewItems().length);
        deps.queueNativeReminderSync();
      } catch (err) {
        // Save failed: do not close sheet or trigger side effects
      } finally {
        reviewInflight = false;
      }
    }

    async function skipReviewThisTime() {
      if (reviewInflight) return;
      const rs = ensureReviewSettings();
      rs.skippedUntil = nextReviewWindowStart();
      rs.sessionStatus = "skipped";
      reviewInflight = true;
      try {
        const p = deps.save();
        if (p && typeof p.then === "function") await p;
        deps.closeSheet("sheetReview");
        deps.toast("已跳过本次 · 下个整理时间再见");
      } catch (err) {
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
          deps.closeSheet("sheetReviewSnooze");
          snoozeReview(ms, label);
        });
      });

      const btnReviewSettings = deps.query("#btnReviewSettings");
      if (btnReviewSettings) {
        listen(btnReviewSettings, "click", () => {
          const rs = ensureReviewSettings();
          const sw = deps.query("#swReviewEnabled");
          if (sw) sw.classList.toggle("on", !!rs.enabled);
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
          swReviewEnabled.classList.toggle("on");
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
