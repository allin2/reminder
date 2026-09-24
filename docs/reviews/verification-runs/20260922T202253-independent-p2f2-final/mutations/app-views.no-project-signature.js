(function(root,factory){var api=factory();root.AttentionLib=root.AttentionLib||{};root.AttentionLib.AppViews=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){"use strict";
function createAppViews(deps){deps=deps||{};var need=['query','queryAll','getState','openSheet','openCapture','openDemoPreview','isAttentionDue','needsReviewItems','renderReviewEntry','inReviewHighlight','renderAiSub','ensureReviewSettings','updateSetupEntry','detailReminderStatusRow','isTerminal','updateAppBadge','fmtTime','fmtDate','relDue','repeatLabel','dayLabel','escapeHtml','escapeAttr','safeExternalHref','sameDay','startOfDay','pad2','getNativeReminderStatus','getNativeReminders','getSwReg','isNativeAndroidRuntime'];var missing=need.filter(function(k){return typeof deps[k]!=="function";});if(missing.length)throw new Error("AppViews missing dependencies: "+missing.join(','));var $=deps.query,$$=deps.queryAll,openSheet=deps.openSheet,openCapture=deps.openCapture,openDemoPreview=deps.openDemoPreview;var state=new Proxy({}, {get:function(_,k){return deps.getState()[k];},set:function(_,k,v){deps.getState()[k]=v;return true;}});var isAttentionDue=deps.isAttentionDue,needsReviewItems=deps.needsReviewItems,renderReviewEntry=deps.renderReviewEntry,inReviewHighlight=deps.inReviewHighlight,renderAiSub=deps.renderAiSub,ensureReviewSettings=deps.ensureReviewSettings,updateSetupEntry=deps.updateSetupEntry,detailReminderStatusRow=deps.detailReminderStatusRow,isTerminal=deps.isTerminal,updateAppBadge=deps.updateAppBadge,fmtTime=deps.fmtTime,fmtDate=deps.fmtDate,relDue=deps.relDue,repeatLabel=deps.repeatLabel,dayLabel=deps.dayLabel,escapeHtml=deps.escapeHtml,escapeAttr=deps.escapeAttr,safeExternalHref=deps.safeExternalHref,sameDay=deps.sameDay,startOfDay=deps.startOfDay,pad2=deps.pad2,isNativeAndroidRuntime=deps.isNativeAndroidRuntime;var homeViewSignature=null,homeRenderStats={builds:0,skipped:0,dueCards:0,activeCards:0};
  function projectById(id) {
    return state.projects.find(p => p.id === id) || null;
  }
  function priorityRank(p) {
    return { critical: 0, important: 1, normal: 2 }[p] != null ? { critical: 0, important: 1, normal: 2 }[p] : 3;
  }
  function actionButton(act, id, cls, label, sub) {
    return '<button class="' + cls + '" data-act="' + act + '" data-id="' + escapeAttr(id) + '">' +
      '<span class="act-label">' + escapeHtml(label) + "</span>" +
      (sub ? '<span class="act-sub">' + escapeHtml(sub) + "</span>" : "") +
      "</button>";
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
        actionButton("snooze", it.id, "ghost", "稍后提醒", "改到具体时间") +
        actionButton("ack", it.id, "primary", "我知道了", "停止本轮 · 仍未完成") +
        actionButton("done", it.id, "ghost", "完成", "结束并归档") +
        "</div>";
    } else if (mode === "active") {
      actions = '<div class="card-actions">' +
        actionButton("reopen", it.id, "ghost", "稍后提醒", "2 小时后") +
        actionButton("edit", it.id, "ghost", "修改", "改时间或内容") +
        actionButton("done", it.id, "primary", "完成", "结束并归档") +
        "</div>";
    } else if (mode === "future") {
      actions = '<div class="card-actions">' +
        actionButton("open", it.id, "ghost", "详情", "") +
        actionButton("edit", it.id, "primary", "修改", "") +
        "</div>";
    } else if (mode === "archived") {
      actions = '<div class="card-actions">' +
        actionButton("open", it.id, "ghost", "详情", "") +
        // D23：归档恢复与「撤销完成」不是一回事 —— 恢复不会自动提醒，也不还原截止保护
        actionButton("restore", it.id, "primary", "恢复到待办", "不会自动提醒") +
        "</div>";
    }

    // O3：链接只走协议白名单；不合格的降级成纯文本，**不删数据**（it.url 原样保留，
    // 详情页的编辑入口仍能改它）。
    const safeUrl = safeExternalHref(it.url);
    const link = it.url
      ? (safeUrl
        ? '<a class="linkish" href="' + escapeAttr(safeUrl) + '" target="_blank" rel="noopener">' + escapeHtml(it.url) + "</a>"
        : '<span class="linkish-plain">' + escapeHtml(it.url) + "</span>")
      : "";

    return '<article class="card ' +
      (it.priority === "critical" ? "urgent " : it.priority === "important" ? "important " : "") +
      (mode === "active" ? "acked " : "") +
      (mode === "archived" ? "done" : "") +
      '" data-id="' + escapeAttr(it.id) + '">' +
      '<div class="card-title">' + escapeHtml(it.title) + "</div>" +
      '<div class="card-meta">' + pills.join("") + "</div>" +
      (it.note ? '<p style="font-size:0.86rem;color:var(--muted);margin:-4px 0 8px;white-space:pre-wrap">' + escapeHtml(it.note) + "</p>" : "") +
      link + actions +
      "</article>";
  }
  function setBadge(n) {
    const el = $("#navBadge");
    if (n > 0) { el.hidden = false; el.textContent = n > 9 ? "9+" : String(n); }
    else el.hidden = true;
    updateAppBadge(n);
  }
  function renderHome() {
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

    // D7：「已看到未完成」永远折叠成一行（带数量）。
    // O6：折叠态只显示数量 ⇒ **不排序、不建卡片**；展开时才按 acknowledgedAt 排一次。
    const expanded = state.ui.activeExpanded;
    const active = state.items
      .filter(it => it.status === "acknowledged" && it.review_status !== "NEEDS_REVIEW");
    if (expanded) active.sort((a, b) => (b.acknowledgedAt || 0) - (a.acknowledgedAt || 0));

    const doneToday = state.items.filter(it => {
      if (it.status !== "archived") return false;
      if (!it.completedAt) return false;
      return sameDay(new Date(it.completedAt), new Date());
    });

    const quiet = !dueList.length && !active.length;
    const reviewPending = needsReviewItems().length;

    // D8：空态里一句纯文字完成数 —— 纯文字、不可点击、无徽标、无强调色、不新增区块
    // （当天完成明细走「未来 → 已归档」，不在首页开入口）
    //
    // UX-C01：空首页必须给出**一句用途说明 + 明显「记一件事」入口 + 输入示例**，
    // 否则新用户的第一件事就是去读文档。
    //
    // 两件事**必须分容器**：D8 的纪律是「完成数不得变成伪待办入口」，它检查的是
    // `#homeEmpty` 里没有 `<button>` / `data-act`。把新增入口塞进同一个容器，
    // 那条纪律会当场失效 —— 于是说明留在 `#homeEmpty`，入口挂在兄弟节点 `#homeStart`。
    const signature = homeCardSignature(dueList, active, expanded, {
      quiet: quiet, reviewPending: reviewPending, doneTodayCount: doneToday.length
    });

    if (signature === homeViewSignature) {
      // 这一拍要写进容器的内容与上一拍完全一致 ⇒ **不替换任何卡片节点**。
      // 焦点、滚动位置、按钮忙碌态与事件闭包因此都不受影响；下面的廉价刷新照常执行。
      homeRenderStats.skipped++;
    } else {
      homeViewSignature = signature;
      homeRenderStats.builds++;
      homeRenderStats.dueCards = dueList.length;
      homeRenderStats.activeCards = expanded ? active.length : 0;

      // D5：首页不再出现「即将到来」；顺序 = 需要注意 → 已看到（折叠） → 待整理弱入口 → 空态
      const homeUpcoming = $("#homeUpcoming");
      if (homeUpcoming) homeUpcoming.innerHTML = "";

      $("#homeDue").innerHTML = dueList.length
        ? '<div class="sec"><div class="sec-head"><div class="sec-title">现在需要注意</div><div class="sec-count">' +
          dueList.length + "</div></div>" +
          dueList.map(it => renderItemCard(it, "due")).join("") + "</div>"
        : "";

      // D7：折叠时**只**生成入口与数量，隐藏卡片一张都不生成（`#activeList` 保留为空容器，
      // 结构不变、可被外部样式与顺序调整引用，但里面没有节点）。展开后按**当前**状态生成，
      // 收起时整段重写 ⇒ 那些卡片节点随之释放，不再常驻内存。
      $("#homeActive").innerHTML = active.length
        ? '<button class="soft-entry" id="toggleActive"><span><strong>已看到未完成 · ' + active.length +
          "</strong></span><span>" + (expanded ? "收起" : "展开") + " ›</span></button>" +
          '<div id="activeList"' + (expanded ? "" : " hidden") + ">" +
          (expanded ? active.map(it => renderItemCard(it, "active")).join("") : "") + "</div>"
        : "";

      $("#homeEmpty").innerHTML = quiet
        ? '<div class="empty"><div class="empty-mark">✓</div><h3>' +
          (reviewPending ? "暂时没有到点的提醒" : "把要记的事丢进来") + "</h3>" +
          "<p>" +
          (reviewPending
            ? "还有 " + reviewPending + " 条待整理，等你有空再补时间。"
            : "写一句话就行，例如「明天下午3点提醒我取快递」。到点我会提醒你。") +
          "</p>" +
          (doneToday.length
            ? '<p style="margin-top:12px;font-size:0.92rem;color:var(--ink-2)">今天已完成 ' + doneToday.length + " 件</p>"
            : "") +
          "</div>"
        : "";

      const homeStart = $("#homeStart");
      if (homeStart) {
        const isBeginner = state.settings.userMode !== "normal";
        homeStart.innerHTML = quiet
          ? '<div class="empty-start">' +
            '<button class="btn primary" id="emptyCapture">记一件事</button>' +
            (isBeginner ? '<button class="soft-entry" id="emptyGuide"><span>新手指南与核心概念</span><span style="color:var(--muted)">›</span></button>' : "") +
            '<button class="soft-entry" id="emptyDemo"><span>看看演示（只读，不会写入数据）</span><span style="color:var(--muted)">›</span></button>' +
            "</div>"
          : "";
        const emptyCapture = $("#emptyCapture");
        if (emptyCapture) emptyCapture.addEventListener("click", () => openCapture());
        const emptyGuide = $("#emptyGuide");
        if (emptyGuide) emptyGuide.addEventListener("click", () => openSheet("sheetGuide"));
        const emptyDemo = $("#emptyDemo");
        if (emptyDemo) emptyDemo.addEventListener("click", () => openDemoPreview());
      }
    }

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
            return '<article class="note-card" data-note="' + escapeAttr(n.id) + '">' +
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
  function syncUserMode() {
    const isNormal = state.settings.userMode === "normal";
    if (typeof document !== "undefined" && document.body) {
      if (document.body.classList && typeof document.body.classList.toggle === "function") {
        document.body.classList.toggle("mode-normal", isNormal);
        document.body.classList.toggle("mode-beginner", !isNormal);
      } else if (typeof document.body.className === "string") {
        const cls = document.body.className.split(/\s+/).filter(c => c && c !== "mode-normal" && c !== "mode-beginner");
        cls.push(isNormal ? "mode-normal" : "mode-beginner");
        document.body.className = cls.join(" ");
      }
    }
  }
  function renderMe() {
    // 使用模式：初学者模式 / 正常模式
    const userModeSeg = $("#userModeSeg");
    if (userModeSeg) {
      const mode = state.settings.userMode === "normal" ? "normal" : "beginner";
      $$("#userModeSeg .seg-item").forEach(b => {
        b.classList.toggle("on", b.dataset.mode === mode);
      });
      const userModeSub = $("#userModeSub");
      if (userModeSub) {
        userModeSub.textContent = mode === "normal"
          ? "正常模式：界面紧凑清爽，隐藏释义小字"
          : "初学者模式：保留操作释义小字与新手引导";
      }
    }
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
    var nativeReminderStatus=deps.getNativeReminderStatus();
    var NativeReminders=deps.getNativeReminders();
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
    // UX-T02：首用设置入口与「高级诊断」都只在原生环境出现；诊断不再挡在首用路径上
    const setupRow = $("#btnSetup");
    if (setupRow) setupRow.hidden = !native;
    if (native) {
      const notificationGranted = nativeReminderStatus.notifications === "granted";
      const exactGranted = nativeReminderStatus.exactAlarm === "granted";
      const alarmErrors = nativeReminderStatus.errors || [];
      const hasErrors = alarmErrors.length > 0 || nativeReminderStatus.reliability === "error";
      const reliability = hasErrors ? "error" : (state.settings.notify ? nativeReminderStatus.reliability : "in-app");
      if (exactRow) exactRow.disabled = !notificationGranted;
      updateSetupEntry();
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
          (it.repeat.mode === "ack" ? "（从我点过「我知道了」重新计时）" : "（按日历）") + "</dd></div>"
        : "") +
      // UX-T03：事后核查。只有**有证据**时才说结论，缺证据一律「尚未确认」。
      detailReminderStatusRow(it) +
      '<div class="detail-row"><dt>创建</dt><dd>' + fmtTime(it.createdAt) + "</dd></div>" +
      (it.acknowledgedAt ? '<div class="detail-row"><dt>确认看到</dt><dd>' + fmtTime(it.acknowledgedAt) + "</dd></div>" : "") +
      (it.completedAt ? '<div class="detail-row"><dt>完成</dt><dd>' + fmtTime(it.completedAt) + "</dd></div>" : "") +
      "</dl>" +
      (it.url ? (safeExternalHref(it.url)
        ? '<a class="linkish" href="' + escapeAttr(safeExternalHref(it.url)) + '" target="_blank" rel="noopener">' + escapeHtml(it.url) + "</a>"
        : '<span class="linkish-plain">' + escapeHtml(it.url) + "</span>") : "") +
      '<p class="beginner-hint" style="margin-top:16px;font-size:0.78rem;color:var(--muted);line-height:1.5">「我知道了」只表示你真正注意到了，不会自动变成「完成」。已经点过「我知道了」的事项会留在首页的「未完成」里，随时能找到。</p>';

    const ab = actionButton;
    let foot = "";
    if (it.status === "due") {
      foot = ab("snooze", it.id, "btn secondary", "稍后提醒", "改到具体时间") +
        ab("ack", it.id, "btn primary", "我知道了", "停止本轮 · 仍未完成") +
        '<button class="btn secondary" data-act="done" data-id="' + escapeAttr(it.id) + '" style="flex:0 0 auto">完成</button>';
    } else if (it.status === "acknowledged") {
      foot = ab("reopen", it.id, "btn secondary", "稍后提醒", "2 小时后") +
        ab("done", it.id, "btn primary", "完成", "结束并归档");
    } else if (it.status === "waiting" || it.status === "snoozed") {
      foot = '<button class="btn secondary" data-act="delete" data-id="' + escapeAttr(it.id) + '">删除</button>' +
        ab("edit", it.id, "btn primary", "修改", "");
    } else {
      // D23：恢复 ≠ 撤销完成 —— 恢复不会自动提醒，也不还原截止保护
      foot = ab("restore", it.id, "btn secondary", "恢复到待办", "不会自动提醒") +
        '<button class="btn danger" data-act="delete" data-id="' + escapeAttr(it.id) + '">删除</button>';
    }
    // L03 / D23：规则级的二级操作与「恢复截止保护」——
    // 不能用「删除当前记录」冒充整条重复规则的终止，也不能让暂停状态没有回去的路。
    const extras = [];
    if (it.repeat && it.repeat.every) {
      extras.push('<button class="btn secondary" data-act="stopRepeat" data-id="' + escapeAttr(it.id) + '">停止重复</button>');
    }
    if (it.deadlineAt && it.deadlinePaused && !isTerminal(it)) {
      extras.push('<button class="btn secondary" data-act="resumeDeadline" data-id="' + escapeAttr(it.id) + '">恢复截止保护</button>');
    }
    $("#detailFoot").innerHTML = extras.join("") + foot;
    openSheet("sheetDetail");
  }
  function homeCardSignatureRow(kind, it) {
    return [kind, it.id, it.priority || "", it.projectId || "",
      it.triggerAt ? relDue(it.triggerAt) : "-",
      it.deadlineAt ? fmtDate(it.deadlineAt) : "-",
      it.deadlinePaused ? "P" : "-",
      (it.repeat && it.repeat.every) ? repeatLabel(it.repeat) + "/" + (it.repeat.mode || "") : "-",
      (it.tags || []).slice(),
      it.title || "", it.note || "", it.url || ""];
  }
  function homeCardSignature(dueList, active, expanded, extra) {
    // 只序列化这一屏真正读取的字段。嵌套数组保留字段与标签边界，避免逗号、控制字符
    // 或其他分隔符出现在用户数据时，把两个不同视图误判成同一个签名。
    const parts = [
      expanded ? "E" : "C",
      extra.quiet ? "q" : "n",
      "r:" + extra.reviewPending,
      "d:" + extra.doneTodayCount,
      "m:" + (state.settings.userMode === "normal" ? "n" : "b"),
      state.projects.map(p => [p.id, p.color]),
      dueList.map(it => homeCardSignatureRow("D", it)),
      expanded
        ? active.map(it => homeCardSignatureRow("A", it))
        : ["A#", active.length]
    ];
    return JSON.stringify(parts);
  }return {priorityRank:priorityRank,actionButton:actionButton,renderItemCard:renderItemCard,openDetail:openDetail,setBadge:setBadge,renderHome:renderHome,renderCalendar:renderCalendar,renderArchiveList:renderArchiveList,renderFuture:renderFuture,renderNotes:renderNotes,renderStats:renderStats,syncUserMode:syncUserMode,renderMe:renderMe,renderPwaStatus:renderPwaStatus,render:render,refreshProjectSelects:refreshProjectSelects,projectById:projectById,homeRenderStats:function(){return homeRenderStats;},resetHomeRenderStats:function(){homeViewSignature=null;homeRenderStats.builds=0;homeRenderStats.skipped=0;homeRenderStats.dueCards=0;homeRenderStats.activeCards=0;}};}
return {createAppViews:createAppViews};});
