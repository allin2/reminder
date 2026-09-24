/* P2-F1 notes / projects / search. UMD factory; evaluation has no side effects. */
(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else { root.AttentionLib = root.AttentionLib || {}; root.AttentionLib.AppContent = factory(root); }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";

  function createAppContent(d) {
    const deps = d || {};
    const required = ["query", "queryAll", "getDocument", "openSheet", "closeSheet", "toast",
      "confirmDialog", "escapeHtml", "escapeAttr", "renderMarkdown", "getState", "save", "render",
      "renderItemCard", "refreshProjectSelects", "uid", "getProjectColors",
      "itemConflictsWithActiveAction", "rejectPendingItemCommand", "removeProjectFromItems"];
    required.forEach(k => { if (typeof deps[k] !== "function") throw new Error("createAppContent(deps) 缺少依赖：" + k); });

    const $ = sel => deps.query(sel);
    const state = new Proxy({}, { get: (_, key) => deps.getState()[key], set: (_, key, value) => (deps.getState()[key] = value, true) });
    const openSheet = id => deps.openSheet(id);
    const closeSheet = id => deps.closeSheet(id);
    const toast = (...args) => deps.toast(...args);
    const render = () => deps.render();
    const save = () => deps.save();
    const refreshProjectSelects = () => deps.refreshProjectSelects();
    const escapeHtml = value => deps.escapeHtml(value);
    const escapeAttr = value => deps.escapeAttr(value);
    const renderMarkdown = value => deps.renderMarkdown(value);
    const renderItemCard = (item, mode) => deps.renderItemCard(item, mode);
    let selectedColor = null;
    let bound = false;
    /**
     * 本次绑定登记过的监听器（回滚用）。
     *
     * 绑定是**一个事务**：中途抛错（例如某个必需节点缺失）时，已经挂上的监听器必须
     * 被摘掉再上抛。否则调用方看到的是「绑失败了」，可下一次重试会在半套监听器上
     * 再挂一套 —— 一次点击触发两次，且抛出点之前的那些监听器永远无人回收。
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

    function projectColors() {
      const colors = deps.getProjectColors();
      return Array.isArray(colors) ? colors : [];
    }

    function currentColor() {
      const colors = projectColors();
      if (colors.indexOf(selectedColor) < 0) selectedColor = colors[0] || "";
      return selectedColor;
    }

    function openNote(id) {
      state.ui.editNoteId = id || null;
      refreshProjectSelects();
      if (id) {
        const note = state.notes.find(x => x.id === id);
        if (!note) return false;
        $("#sheetNoteTitle").textContent = "编辑笔记";
        $("#noteTitle").value = note.title || "";
        $("#noteBody").value = note.body || "";
        $("#noteProject").value = note.projectId || "";
        state.ui.notePin = !!note.pinned;
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
      return true;
    }

    function saveNote() {
      const title = $("#noteTitle").value.trim() || "无标题";
      const body = $("#noteBody").value.trim();
      const projectId = $("#noteProject").value || "";
      if (state.ui.editNoteId) {
        const note = state.notes.find(x => x.id === state.ui.editNoteId);
        if (note) {
          note.title = title;
          note.body = body;
          note.projectId = projectId;
          note.pinned = state.ui.notePin;
          note.updatedAt = Date.now();
        }
      } else {
        const now = Date.now();
        state.notes.push({ id: deps.uid(), title: title, body: body, projectId: projectId,
          pinned: state.ui.notePin, createdAt: now, updatedAt: now });
      }
      save();
      closeSheet("sheetNote");
      render();
      toast("笔记已保存");
      return true;
    }

    function doSearch(query) {
      const q = (query || "").trim().toLowerCase();
      const box = $("#searchResults");
      if (!q) {
        box.innerHTML = '<p style="color:var(--muted);font-size:0.88rem">输入关键词，覆盖 Future、已看到未完成、归档、项目与笔记。</p>';
        return { items: [], notes: [], projects: [] };
      }
      const items = state.items.filter(item =>
        (item.title || "").toLowerCase().includes(q) ||
        (item.note || "").toLowerCase().includes(q) ||
        (item.tags || []).some(tag => tag.toLowerCase().includes(q)) ||
        (item.url || "").toLowerCase().includes(q));
      const notes = state.notes.filter(note =>
        (note.title || "").toLowerCase().includes(q) || (note.body || "").toLowerCase().includes(q));
      const projects = state.projects.filter(project => (project.name || "").toLowerCase().includes(q));
      box.innerHTML = (items.length || notes.length || projects.length)
        ? (projects.length
          ? '<div class="sec-head"><div class="sec-title">项目</div></div>' +
            projects.map(project => '<div class="note-card"><h3>' + escapeHtml(project.name) + "</h3><p>项目</p></div>").join("")
          : "") +
          items.map(item => renderItemCard(item,
            item.status === "archived" ? "archived" : item.status === "acknowledged" ? "active" : "future")).join("") +
          notes.map(note => '<article class="note-card" data-note="' + escapeAttr(note.id) + '"><h3>' +
            escapeHtml(note.title) + "</h3><p>" + escapeHtml(note.body) + "</p></article>").join("")
        : '<div class="empty" style="padding:28px 12px"><p>没有找到「' + escapeHtml(q) + "」</p></div>";
      return { items: items, notes: notes, projects: projects };
    }

    function renderProjectsSheet() {
      const color = currentColor();
      $("#projectsList").innerHTML = state.projects.length
        ? state.projects.map(project => {
          const count = state.items.filter(item => item.projectId === project.id).length;
          return '<div class="note-card" style="display:flex;align-items:center;gap:10px">' +
            '<span style="width:12px;height:12px;border-radius:50%;background:' + escapeHtml(project.color) + ';flex-shrink:0"></span>' +
            '<div style="flex:1"><h3>' + escapeHtml(project.name) + "</h3><p>" + count + " 个事项</p></div>" +
            '<button class="chip" data-del-proj="' + escapeAttr(project.id) + '">删除</button></div>';
        }).join("")
        : '<p style="color:var(--muted);font-size:0.88rem">还没有项目。项目用于轻量归类，不是完整任务管理。</p>';
      $("#projColors").innerHTML = projectColors().map(c =>
        '<button type="button" class="chip' + (c === color ? " on" : "") + '" data-color="' + escapeAttr(c) + '" ' +
        'style="min-width:36px;background:' + escapeAttr(c) + ';border-color:transparent;color:transparent">' + escapeHtml(c) + "</button>").join("");
    }

    function addProject() {
      const name = $("#projName").value.trim();
      if (!name) { toast("请输入项目名称"); return false; }
      state.projects.push({ id: "p_" + deps.uid(), name: name, color: currentColor() });
      $("#projName").value = "";
      save();
      renderProjectsSheet();
      refreshProjectSelects();
      toast("已添加项目");
      return true;
    }

    function deleteProject(id) {
      const affected = state.items.filter(item => item.projectId === id);
      if (affected.some(item => deps.itemConflictsWithActiveAction(item))) return deps.rejectPendingItemCommand();
      state.projects = state.projects.filter(project => project.id !== id);
      // Only core owns item mutations/revisions and the user-operation conflict domain.
      deps.removeProjectFromItems(id);
      state.notes.forEach(note => { if (note.projectId === id) note.projectId = ""; });
      save();
      renderProjectsSheet();
      toast("已删除项目");
      return true;
    }

    function refreshNotePreview() {
      if (!$("#notePreviewWrap").hidden) $("#notePreview").innerHTML = renderMarkdown($("#noteBody").value);
    }

    /**
     * 绑定的入口：**只在事务体全部成功后**才宣布 `bound`，失败则整体回滚并可重试。
     */
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
      listen($("#btnSaveNote"), "click", saveNote);
      listen($("#swNotePin"), "click", () => {
        state.ui.notePin = !state.ui.notePin;
        $("#swNotePin").classList.toggle("on", state.ui.notePin);
      });
      listen($("#btnNotePreview"), "click", () => {
        const wrap = $("#notePreviewWrap");
        const show = wrap.hidden;
        wrap.hidden = !show;
        $("#btnNotePreview").textContent = show ? "隐藏预览" : "预览";
        if (show) $("#notePreview").innerHTML = renderMarkdown($("#noteBody").value);
      });
      listen($("#noteBody"), "input", refreshNotePreview);
      listen($("#btnSearch"), "click", () => {
        openSheet("sheetSearch");
        doSearch("");
        setTimeout(() => $("#searchInput").focus(), 280);
      });
      listen($("#searchInput"), "input", event => doSearch(event.target.value));
      listen($("#btnProjects"), "click", () => { renderProjectsSheet(); openSheet("sheetProjects"); });
      listen($("#btnAddProject"), "click", addProject);
      const doc = deps.getDocument();
      listen(doc, "click", async event => {
        const target = event.target;
        if (!target || typeof target.closest !== "function") return;
        const delProject = target.closest("[data-del-proj]");
        if (delProject) {
          event.stopImmediatePropagation();
          const ok = await deps.confirmDialog("删除该项目？事项会保留但去掉项目。", "删除项目");
          if (ok) deleteProject(delProject.dataset.delProj);
          return;
        }
        const colorButton = target.closest("[data-color]");
        if (colorButton && colorButton.closest("#projColors")) {
          event.stopImmediatePropagation();
          selectedColor = colorButton.dataset.color;
          renderProjectsSheet();
          return;
        }
        const note = target.closest("[data-note]");
        if (note) {
          event.stopImmediatePropagation();
          openNote(note.dataset.note);
          return;
        }
        if (target.closest("#btnNewNote")) {
          event.stopImmediatePropagation();
          openNote(null);
        }
      });
    }

    return { bind: bind, openNote: openNote, saveNote: saveNote, doSearch: doSearch,
      renderProjectsSheet: renderProjectsSheet, addProject: addProject, deleteProject: deleteProject };
  }

  return { createAppContent: createAppContent };
});
