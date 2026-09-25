/* 安心收件箱 — unit tests for lib modules (node) */
"use strict";

const path = require("path");
const fs = require("fs");
const vm = require("vm");
const parse = require(path.join(__dirname, "lib/parse-cn.js"));
const repeat = require(path.join(__dirname, "lib/repeat.js"));
const reminder = require(path.join(__dirname, "lib/reminder.js"));
const storageMod = require(path.join(__dirname, "lib/storage.js"));
const feedbackMod = require(path.join(__dirname, "lib/feedback.js"));
const evidenceMod = require(path.join(__dirname, "lib/delivery-evidence.js"));
const appSetupMod = require(path.join(__dirname, "lib/app-setup.js"));
const appContentMod = require(path.join(__dirname, "lib/app-content.js"));
const appCaptureMod = require(path.join(__dirname, "lib/app-capture.js"));
const appViewsMod = require(path.join(__dirname, "lib/app-views.js"));

let passed = 0, failed = 0;
const failures = [];
/**
 * 异步段的**收尾门**计数（声明必须在这里，不能放到文件尾部跟 `finish()` 一起 ——
 * 段首登记发生在文件中部，`let` 在那时还处于 TDZ）。用法见文件末尾的
 * `beginAsyncSection()`：段首 `const done = beginAsyncSection();`，段尾 `done()`。
 * 每段自己销账，账平了才真正打印结果。
 */
let asyncSectionsPending = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else {
    failed++;
    failures.push(name + (extra ? " — " + extra : ""));
    console.log("  ✗ " + name + (extra ? " — " + extra : ""));
  }
}

/* ---------- P2-F1：真实 AppContent 工厂（不经 app-core 薄转发） ---------- */
section("P2-F1 AppContent — live 注入、笔记/搜索/项目与幂等绑定");
{
  const evalCalls = { getState: 0, listeners: 0 };
  const evalSandbox = { module: { exports: {} }, exports: {}, setTimeout: () => 0,
    document: { addEventListener: () => { evalCalls.listeners++; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "lib/app-content.js"), "utf8"), evalSandbox,
    { filename: "lib/app-content.js" });
  ok("P2-F1 模块求值零副作用", evalCalls.getState === 0 && evalCalls.listeners === 0 &&
    typeof evalSandbox.module.exports.createAppContent === "function", JSON.stringify(evalCalls));

  function contentFixture() {
    let state = { items: [{ id: "i1", title: "Alpha", note: "memo", tags: ["tag"], url: "https://x", projectId: "p1", rev: 2 }],
      notes: [], projects: [{ id: "p1", name: "Project One", color: "#1b6b4a" }], ui: {} };
    const nodes = {}, docListeners = [];
    function node(id) {
      if (!nodes[id]) nodes[id] = { id, value: "", textContent: "", innerHTML: "", hidden: true, dataset: {},
        classList: { on: false, toggle(_name, value) { this.on = !!value; } }, listeners: [],
        addEventListener(name, fn) { this.listeners.push({ name, fn }); }, focus() { this.focused = true; } };
      return nodes[id];
    }
    const calls = { save: 0, render: 0, refresh: 0, remove: [], toast: [], opens: [], closes: [], reject: 0 };
    const app = appContentMod.createAppContent({
      query: sel => node(sel), queryAll: () => [], getDocument: () => ({ addEventListener: (name, fn) => docListeners.push({ name, fn }) }),
      openSheet: id => calls.opens.push(id), closeSheet: id => calls.closes.push(id), toast: (...args) => calls.toast.push(args),
      confirmDialog: async () => false, escapeHtml: x => String(x).replace(/</g, "&lt;"), escapeAttr: x => String(x).replace(/"/g, "&quot;"),
      renderMarkdown: x => String(x).replace(/</g, "&lt;"), getState: () => state, save: () => { calls.save++; }, render: () => { calls.render++; },
      renderItemCard: item => '<article class="card">' + String(item.title).replace(/</g, "&lt;") + "</article>",
      refreshProjectSelects: () => { calls.refresh++; }, uid: () => "uid", getProjectColors: () => ["#1b6b4a", "#3d5a80"],
      itemConflictsWithActiveAction: item => !!item.pending, rejectPendingItemCommand: () => { calls.reject++; return false; },
      removeProjectFromItems: id => { calls.remove.push(id); state.items.forEach(item => { if (item.projectId === id) { item.projectId = ""; item.rev++; } }); }
    });
    return { app, node, nodes, state: () => state, setState: next => { state = next; }, calls, docListeners };
  }

  const content = contentFixture();
  content.app.bind(); content.app.bind();
  ok("P2-F1 静态与 document 委托 bind 都是实例内幂等", content.node("#btnSaveNote").listeners.length === 1 &&
    content.node("#btnSearch").listeners.length === 1 && content.docListeners.length === 1, JSON.stringify({ static: content.node("#btnSaveNote").listeners.length, delegated: content.docListeners.length }));
  content.app.openNote(null);
  content.node("#noteTitle").value = ""; content.node("#noteBody").value = "<img onerror=1>";
  content.app.saveNote();
  const created = content.state().notes[0];
  ok("P2-F1 新建笔记保留默认标题、置顶字段与单次保存/渲染", created.title === "无标题" && created.pinned === false &&
    content.calls.save === 1 && content.calls.render === 1 && created.createdAt === created.updatedAt, JSON.stringify(created));
  const preview = content.app.doSearch("<img");
  ok("P2-F1 搜索覆盖笔记且输出转义", preview.notes.length === 1 && /&lt;img/.test(content.node("#searchResults").innerHTML), content.node("#searchResults").innerHTML);
  content.node("#projName").value = "New Project";
  content.app.addProject();
  const newProject = content.state().projects.find(p => p.name === "New Project");
  ok("P2-F1 项目新增经 live state、刷新选择器、保存与提示各一次", !!newProject && content.calls.refresh === 2 &&
    content.calls.save === 2 && content.calls.toast.some(row => row[0] === "已添加项目"), JSON.stringify(content.calls));
  const projectCountBeforeConflict = content.state().projects.length;
  const noteProjectBeforeConflict = content.state().notes[0].projectId;
  const itemProjectBeforeConflict = content.state().items[0].projectId;
  const itemRevBeforeConflict = content.state().items[0].rev;
  content.state().items[0].pending = true;
  const blocked = content.app.deleteProject("p1");
  ok("P2-F1 删除冲突拒绝不改项目/笔记/事项且不进事务", blocked === false && content.calls.reject === 1 &&
    content.calls.remove.length === 0 && content.state().projects.length === projectCountBeforeConflict &&
    content.state().notes[0].projectId === noteProjectBeforeConflict && content.state().items[0].projectId === itemProjectBeforeConflict &&
    content.state().items[0].rev === itemRevBeforeConflict, JSON.stringify(content.calls));
  content.state().items[0].pending = false;
  const removed = content.app.deleteProject("p1");
  ok("P2-F1 删除成功只经注入事务清理事项、笔记关联清空", removed === true && content.calls.remove.length === 1 &&
    content.state().items[0].projectId === "" && content.state().items[0].rev === 3 && content.state().notes.every(n => n.projectId === ""), JSON.stringify(content.state()));
}
function section(t) { console.log("\n== " + t + " =="); }

/* ---------- P2-G1：真实 AppCapture 工厂（不经 app-core 薄转发） ---------- */
section("P2-G1 AppCapture — 表单会话、live 状态与幂等绑定");
{
  const evalCalls = { state: 0, listeners: 0, timers: 0 };
  const evalSandbox = { module: { exports: {} }, exports: {}, document: { addEventListener: () => { evalCalls.listeners++; } },
    setTimeout: () => { evalCalls.timers++; return 1; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "lib/app-capture.js"), "utf8"), evalSandbox,
    { filename: "lib/app-capture.js" });
  ok("P2-G1 模块求值零 DOM/state/timer 副作用", evalCalls.state === 0 && evalCalls.listeners === 0 && evalCalls.timers === 0 &&
    typeof evalSandbox.module.exports.createAppCapture === "function", JSON.stringify(evalCalls));

  let state = { items: [
    { id: 'same" onclick="bad', title: '<b>缴费</b>', status: "waiting", priority: "normal" },
    { id: "done", title: "缴费完成", status: "completed", priority: "normal" }
  ], projects: [{ id: "p1", name: "项目一" }], ui: { editItemId: null, pendingLowConf: null } };
  const nodes = {}, documentListeners = [];
  function classList() { return { values: new Set(), add(x) { this.values.add(x); }, remove(x) { this.values.delete(x); },
    toggle(x, on) { if (on) this.values.add(x); else this.values.delete(x); }, contains(x) { return this.values.has(x); } }; }
  function node(id) {
    if (!nodes[id]) nodes[id] = { id, value: "", textContent: "", innerHTML: "", hidden: false, disabled: false,
      className: "", dataset: {}, listeners: [], classList: classList(),
      addEventListener(name, fn) { this.listeners.push({ name, fn }); }, setAttribute(name, value) { this[name] = value; }, focus() { this.focused = true; } };
    return nodes[id];
  }
  const chips = ["normal", "important", "critical"].map(p => { const n = node("chip-" + p); n.dataset.p = p; return n; });
  const quickChips = ["tonight", "tomorrow", "weekend", "monday"].map(k => { const n = node("quick-" + k); n.dataset.quick = k; return n; });
  let lowConf = false; const calls = { refresh: 0, opens: [], details: [], timers: 0 };
  const capture = appCaptureMod.createAppCapture({
    query: node, queryAll: sel => sel === "#capQuick [data-quick]" ? quickChips
      : sel === "#capPriority .chip" || sel === "#capPriority .chip.on"
      ? (sel.endsWith(".on") ? chips.filter(c => c.classList.contains("on")) : chips) : [],
    getDocument: () => ({ addEventListener: (name, fn) => documentListeners.push({ name, fn }) }), getState: () => state,
    openSheet: id => calls.opens.push(id), refreshProjectSelects: () => { calls.refresh++; }, openDetail: id => calls.details.push(id),
    toLocalInput: ts => ts ? "2026-09-22T09:30" : "", parseLocalInput: value => value ? 123456 : null,
    parseChineseTime: () => ({ confidence: "high", trigger: 123456, deadline: 0, repeat: { every: "week", mode: "calendar" } }),
    nextRepeatPreview: () => [1, 2, 3, 4, 5], fmtDate: value => "D" + value, fmtTime: value => "T" + value,
    repeatLabel: rep => rep.every, getFeedback: () => ({ captureSummary: () => ({ empty: false, text: "摘要" }) }),
    escapeHtml: value => String(value).replace(/</g, "&lt;").replace(/>/g, "&gt;"), escapeAttr: value => String(value).replace(/"/g, "&quot;"),
    setTimeout: fn => { calls.timers++; return calls.timers; }, clearTimeout: () => {},
    fallbackTriggerAt: () => 123456, hasSpecificTimeWord: () => false, makeItem: fields => Object.assign({ id: "x" }, fields),
    resolveDeliveryMode: () => "notification", detectNeedsReview: () => false,
    runEditCommand: () => true, runNewCommand: () => true, rollbackNewItem: () => {}, save: () => Promise.resolve(),
    render: () => {}, closeSheet: () => {}, announceSaveOutcome: () => {}, noteFirstRemindSaved: () => {},
    queueNativeReminderSync: () => {}, toast: () => {}, getAi: () => null
  });
  capture.resetItemSheet(); const firstSession = capture.session();
  node("#capText").value = "同一内容"; const untouched = capture.snapshotItemForm();
  node("#capTrigger").value = "2026-09-22T09:30"; capture.markTriggerPicked(true);
  const picked = capture.snapshotItemForm();
  ok("P2-G1 reset 每次递增独立会话，手选时间进入签名", capture.session() === firstSession &&
    capture.formDraftSignature(untouched) !== capture.formDraftSignature(picked), JSON.stringify({ firstSession, untouched, picked }));
  capture.openCapture({ title: "同一内容" });
  ok("P2-G1 同内容重新打开仍是另一会话且走 live 项目刷新", capture.session() === firstSession + 1 && calls.refresh === 1 &&
    node("#capText").value === "同一内容", JSON.stringify({ session: capture.session(), refresh: calls.refresh }));
  state.items.push({ id: "edit", title: "复杂事项", note: "备注", tags: ["t"], url: "https://example.test", projectId: "p1", priority: "important",
    triggerAt: 1, deadlineAt: 2, repeat: { every: "nthWeekday", mode: "ack", nth: 2, dow: 3 } });
  capture.openEditItem("edit");
  ok("P2-G1 编辑复杂事项保留项目/周期并展开更多字段", state.ui.editItemId === "edit" && node("#capProject").value === "p1" &&
    node("#capAdvanced").hidden === false && node("#capRepeat").value === "nthWeekday" && node("#capNth").value === "2", JSON.stringify({ ui: state.ui, advanced: node("#capAdvanced").hidden }));
  capture.updateRepeatPreview(); capture.renderSimilarHint("缴费");
  ok("P2-G1 重复预览与相似提示真实渲染且危险 id/title 均转义", /D1/.test(node("#repeatPreview").textContent) &&
    /&quot;/.test(node("#similarHint").innerHTML) && /&lt;b&gt;/.test(node("#similarHint").innerHTML), node("#similarHint").innerHTML);
  capture.resetItemSheet(); node("#capText").value = "明天"; node("#capTrigger").value = "保留"; capture.markTriggerPicked(true); capture.updateParseHint();
  ok("P2-G1 parse hint 尊重用户手选时间并更新摘要", node("#capTrigger").value === "保留" && node("#capSummary").textContent === "摘要", JSON.stringify({ trigger: node("#capTrigger").value, summary: node("#capSummary").textContent }));
  capture.bind(); capture.bind();
  ok("P2-G1 capture bind 对输入、重复、时间和更多选项幂等", node("#capText").listeners.length === 3 &&
    node("#capTrigger").listeners.length === 2 && node("#btnCapMore").listeners.length === 1 && documentListeners.length === 1,
    JSON.stringify({ text: node("#capText").listeners.length, trigger: node("#capTrigger").listeners.length, more: node("#btnCapMore").listeners.length, delegated: documentListeners.length }));

  // 方案 A 快捷时间：点胶囊 = 手选时间（写入时间框、置 triggerPicked、提示「已保留」），且绑定幂等
  ok("快捷时间 bind 幂等：每个胶囊只挂 1 个 click", quickChips.every(c => c.listeners.length === 1 && c.listeners[0].name === "click"),
    JSON.stringify(quickChips.map(c => c.listeners.length)));
  capture.resetItemSheet();
  node("#capText").value = "交周报";
  node("#capHint").textContent = "";
  node("#capSummary").textContent = "";
  const beforeQuick = capture.snapshotItemForm();
  quickChips[1].listeners[0].fn({});
  const afterQuick = capture.snapshotItemForm();
  ok("快捷时间点击：写入时间框并视同手选（triggerPicked=true）",
    beforeQuick.triggerPicked === false && afterQuick.triggerPicked === true && node("#capTrigger").value === "2026-09-22T09:30",
    JSON.stringify({ beforeQuick, afterQuick }));
  ok("快捷时间点击：提示「已保留你选择的时间」且摘要同步刷新",
    /^已保留你选择的时间：T\d+ · 可修改$/.test(node("#capHint").textContent) && node("#capSummary").textContent === "摘要",
    JSON.stringify({ hint: node("#capHint").textContent, summary: node("#capSummary").textContent }));
  node("#capText").value = "后天下午3点交周报"; capture.updateParseHint();
  ok("快捷时间点击后继续打字：时间框不被解析结果覆盖", node("#capTrigger").value === "2026-09-22T09:30",
    node("#capTrigger").value);
}

section("快捷时间 quickTimeAt — 纯函数边界");
{
  const q = appCaptureMod.quickTimeAt;
  // 全部用本地时间构造，结果与运行机器时区无关
  const at = (y, mo, d, h, mi, s) => new Date(y, mo - 1, d, h, mi || 0, s || 0);
  const same = (kind, now, expect) => q(kind, now) === expect.getTime();
  const show = (kind, now) => { const v = q(kind, now); return v == null ? String(v) : new Date(v).toString(); };
  ok("quickTimeAt 已导出为函数", typeof q === "function");

  const fri = at(2026, 9, 25, 10, 50, 37);   // 周五上午（真机验证当天）
  ok("周五 10:50 · 今晚 → 当天 20:00", same("tonight", fri, at(2026, 9, 25, 20, 0)), show("tonight", fri));
  ok("周五 10:50 · 明早 → 周六 09:00", same("tomorrow", fri, at(2026, 9, 26, 9, 0)), show("tomorrow", fri));
  ok("周五 10:50 · 周六 → 次日周六 10:00", same("weekend", fri, at(2026, 9, 26, 10, 0)), show("weekend", fri));
  ok("周五 10:50 · 下周一 → 9月28日 09:00", same("monday", fri, at(2026, 9, 28, 9, 0)), show("monday", fri));
  ok("结果秒与毫秒归零", q("tomorrow", fri) % 60000 === 0);

  ok("今晚：恰好 20:00 视为已过 → 21:00", same("tonight", at(2026, 9, 25, 20, 0), at(2026, 9, 25, 21, 0)), show("tonight", at(2026, 9, 25, 20, 0)));
  ok("今晚：20:30 已过 → 顺延到 21:00（不改成明天 20:00）", same("tonight", at(2026, 9, 25, 20, 30), at(2026, 9, 25, 21, 0)), show("tonight", at(2026, 9, 25, 20, 30)));
  ok("今晚：19:59 未过 → 当天 20:00", same("tonight", at(2026, 9, 25, 19, 59), at(2026, 9, 25, 20, 0)), show("tonight", at(2026, 9, 25, 19, 59)));
  ok("今晚：23:40 → 次日 00:00（跨日由摘要如实展示）", same("tonight", at(2026, 9, 25, 23, 40), at(2026, 9, 26, 0, 0)), show("tonight", at(2026, 9, 25, 23, 40)));

  ok("周六：周六 09:00 → 当天 10:00", same("weekend", at(2026, 9, 26, 9, 0), at(2026, 9, 26, 10, 0)), show("weekend", at(2026, 9, 26, 9, 0)));
  ok("周六：周六恰好 10:00 → 下周六", same("weekend", at(2026, 9, 26, 10, 0), at(2026, 10, 3, 10, 0)), show("weekend", at(2026, 9, 26, 10, 0)));
  ok("周六：周日 → 6 天后的周六", same("weekend", at(2026, 9, 27, 12, 0), at(2026, 10, 3, 10, 0)), show("weekend", at(2026, 9, 27, 12, 0)));

  ok("下周一：周日 → 次日周一", same("monday", at(2026, 9, 27, 12, 0), at(2026, 9, 28, 9, 0)), show("monday", at(2026, 9, 27, 12, 0)));
  ok("下周一：周一早上 08:00 仍取下周一（不取当天）", same("monday", at(2026, 9, 28, 8, 0), at(2026, 10, 5, 9, 0)), show("monday", at(2026, 9, 28, 8, 0)));

  ok("跨月：9月30日 · 明早 → 10月1日 09:00", same("tomorrow", at(2026, 9, 30, 22, 0), at(2026, 10, 1, 9, 0)), show("tomorrow", at(2026, 9, 30, 22, 0)));
  ok("跨年：12月31日 · 下周一 → 次年 1月4日", same("monday", at(2026, 12, 31, 10, 0), at(2027, 1, 4, 9, 0)), show("monday", at(2026, 12, 31, 10, 0)));

  const frozen = at(2026, 9, 25, 10, 50);
  const frozenTs = frozen.getTime();
  ["tonight", "tomorrow", "weekend", "monday"].forEach(k => q(k, frozen));
  ok("不修改传入的 now", frozen.getTime() === frozenTs);
  ok("未知 kind → null", q("nextYear", fri) === null && q("", fri) === null);
}

/* parse */
section("P2-F2 AppViews — direct live dependencies");
{
  const state = { items: [{ id: "a", title: "archived", status: "archived", priority: "normal", createdAt: 100, completedAt: 200, tags: [] }],
    notes: [], projects: [], ui: { futureSeg: "archive" }, settings: { notify: true, userMode: "normal", quietStart: "23:00", quietEnd: "07:30" } };
  const nodes = {};
  const node = id => nodes[id] || (nodes[id] = { innerHTML: "", textContent: "", hidden: false, value: "", dataset: {},
    classList: { toggle() {}, add() {}, remove() {} } });
  let native = false, startCalls = 0, padCalls = 0;
  const noop = () => {};
  const views = appViewsMod.createAppViews({
    query: node, queryAll: () => [], getState: () => state, openSheet: noop, openCapture: noop, openDemoPreview: noop,
    isAttentionDue: () => false, needsReviewItems: () => [], renderReviewEntry: noop, inReviewHighlight: () => false,
    renderAiSub: noop, ensureReviewSettings: () => ({ enabled: true, hour: 9, minute: 5 }), updateSetupEntry: noop,
    isTerminal: () => false, updateAppBadge: noop,
    fmtTime: String, fmtDate: String, relDue: () => "", repeatLabel: () => "", dayLabel: () => "昨天",
    escapeHtml: v => String(v).replace(/</g, "&lt;").replace(/"/g, "&quot;"), escapeAttr: v => String(v).replace(/"/g, "&quot;"),
    safeExternalHref: () => null, sameDay: () => false,
    startOfDay: ts => { startCalls++; return new Date(Number(ts)); }, pad2: n => { padCalls++; return String(n).padStart(2, "0"); },
    getNativeReminderStatus: () => ({ notifications: "granted", exactAlarm: "granted", reliability: "exact", errors: [] }),
    getNativeReminders: () => ({ isNativeAndroid: () => native }), getSwReg: () => null, isNativeAndroidRuntime: () => native,
    evidenceStatusFor: () => ({ state: "unverifiable", text: "这条记录的提醒无法核查" }),
    deliveryEvidenceReadable: () => true,
    itemScheduleEvidence: () => null
  });
  const archive = views.renderArchiveList();
  ok("P2-F2 archive 通过注入 startOfDay 分组", startCalls > 0 && /archived/.test(archive), archive);
  const dangerous = { id: 'x" onmouseover="bad', title: '<img src=x>', url: 'javascript:bad()', status: "due",
    priority: "critical", createdAt: 1, updatedAt: 1, tags: ["<tag>"] };
  const modes = ["due", "active", "future", "archived"].map(mode => views.renderItemCard(Object.assign({}, dangerous, {
    status: mode === "archived" ? "archived" : dangerous.status
  }), mode));
  ok("P2-F2 四种卡片 mode 保持属性/文本/危险 URL 安全降级",
    modes.length === 4 && modes.every(html => /&lt;img/.test(html) && !/href=\"javascript:/.test(html) && !/data-id=\"x\" onmouseover/.test(html)),
    modes.join("\\n").slice(0, 300));
  state.items[0].deadlineAt = 300; state.items[0].deadlinePaused = true; state.items[0].repeat = { every: "week", mode: "ack" };
  state.items[0].id = "detail"; state.items[0].status = "due"; state.items[0].title = "detail";
  views.openDetail("detail");
  ok("P2-F2 详情保留暂停截止、周期与注入证据行",
    /已暂停/.test(node("#detailBody").innerHTML) && /周期/.test(node("#detailBody").innerHTML) && /提醒结果/.test(node("#detailBody").innerHTML),
    node("#detailBody").innerHTML.slice(0, 300));
  ok("P3-I-Q2 views 实例公开 detailReminderStatusRow 且直接调用与详情一致",
    typeof views.detailReminderStatusRow === "function" &&
    node("#detailBody").innerHTML.includes(views.detailReminderStatusRow(state.items[0])));
  state.projects = [{ id: "p", name: "项目一", color: "#000" }];
  node("#capProject").value = "p"; views.refreshProjectSelects();
  ok("P2-F2 项目选择器刷新保留选中值", node("#capProject").value === "p" && /项目一/.test(node("#capProject").innerHTML),
    JSON.stringify({ value: node("#capProject").value, html: node("#capProject").innerHTML }));
  global.navigator = { onLine: true, serviceWorker: null };
  views.renderMe();
  ok("P2-F2 stats 通过注入 pad2", padCalls > 0, String(padCalls));
  views.renderPwaStatus(); const webHidden = node("#btnSetup").hidden;
  native = true; views.renderPwaStatus(); const nativeVisible = node("#btnSetup").hidden === false;
  ok("P2-F2 原生 getter 每次渲染读取，Web→native 可见性更新", webHidden === true && nativeVisible, JSON.stringify({ webHidden, nativeVisible }));
}

section("parse-cn");
{
  const now = new Date(2026, 8, 14, 10, 0, 0);
  const p1 = parse.parseChineseTime("周五提醒我看看 Horolog", now);
  ok("周五 trigger", !!p1.trigger && p1.trigger > now.getTime());
  ok("周五 confidence", p1.confidence === "high" || p1.confidence === "mid");

  const p2 = parse.parseChineseTime("过阵子再看看这个", now);
  ok("低置信度", p2.confidence === "low");

  const p3 = parse.parseChineseTime("9月30日截止，提前五天交材料", now);
  ok("截止", !!p3.deadline);
  ok("提前 trigger", !!p3.trigger);

  const p4 = parse.parseChineseTime("每两周看看一次", now);
  ok("biweek ack", p4.repeat && p4.repeat.every === "biweek" && p4.repeat.mode === "ack");

  const p5 = parse.parseChineseTime("每月底提醒我交房租", now);
  ok("monthEnd", p5.repeat && p5.repeat.every === "monthEnd");

  const p6 = parse.parseChineseTime("每月第2个周二开例会", now);
  ok("nthWeekday", p6.repeat && p6.repeat.every === "nthWeekday" && p6.repeat.nth === 2 && p6.repeat.dow === 2);
}

/* Relative reminders: fixed reference, including seconds and date rollover. */
section("relative Chinese time");
{
  const now = new Date(2026, 11, 31, 23, 59, 42, 321);
  const cases = [
    ["三分钟以后提醒我", 180000],
    ["三分钟后提醒我喝水", 180000],
    ["3分钟之后提醒我喝水", 180000],
    ["３ 分钟以后提醒我喝水", 180000],
    ["过三分钟提醒我喝水", 180000],
    ["再过 3 分钟提醒我喝水", 180000],
    ["提醒我三分钟后喝水", 180000],
    ["半小时后提醒我喝水", 1800000],
    ["半个小时以后提醒我喝水", 1800000],
    ["一个半小时之后提醒我喝水", 5400000],
    ["一个小时半后提醒我喝水", 5400000],
    ["一小时三十分钟后提醒我喝水", 5400000],
    ["一小时零五分钟后提醒我喝水", 3900000],
    ["四十五分钟后提醒我喝水", 2700000],
    ["一百二十分钟后提醒我喝水", 7200000],
    ["1.5小时后提醒我喝水", 5400000],
    ["三十秒后提醒我喝水", 30000],
    ["两分钟三十秒后提醒我喝水", 150000],
    ["半分钟后提醒我喝水", 30000],
    ["两个钟头后提醒我喝水", 7200000]
  ];
  for (const [text, elapsed] of cases) {
    const p = parse.parseChineseTime(text, now);
    ok(text + " 精确时长", p.trigger === now.getTime() + elapsed && p.confidence === "high");
    ok(text + " 具体时间判定", parse.hasSpecificTimeWord(text));
    ok(text + " 保留原文及标题", p.raw === text && p.title === (text.includes("喝水") ? "喝水" : text));
  }
  for (const text of ["零分钟后提醒我", "负三分钟后提醒我", "-3分钟后提醒我", "几分钟后提醒我", "三分钟后五分钟后提醒我", "三分钟后明天提醒我", "过三分钟前提醒我", "一小时半半后提醒我", "三分钟后9点提醒我", "以后提醒我喝水", "看三分钟视频", "每三分钟后提醒我"]) {
    ok(text + " 不冒充精确识别", parse.parseChineseTime(text, now).confidence === "low");
  }
  const day = parse.parseChineseTime("三天以后提醒我喝水", now);
  const expectedDay = new Date(now); expectedDay.setDate(expectedDay.getDate() + 3);
  ok("三天以后按日历天且保留时刻", day.trigger === expectedDay.getTime() && day.confidence === "high");
  const clock = parse.parseChineseTime("三天后下午三点提醒我喝水", now);
  expectedDay.setHours(15, 0, 0, 0);
  ok("天数可组合明确钟点", clock.trigger === expectedDay.getTime());
  const tag = parse.parseChineseTime("三分钟以后提醒我喝水 #健康", now);
  ok("清除时间但保留事项和标签", tag.title === "喝水" && tag.tags[0] === "健康");
  ok("正文含月报不误判为日期冲突", parse.parseChineseTime("三分钟后提醒我写月报", now).confidence === "high");
}

/* 解析层回归：H-01 / H-02 / H-03 / N-04（2026-09-18 修复） */
section("calendar anchors: 下周 / 下下周 / 每月N号 / 下个月N号 / X前");
{
  const now = new Date(2026, 8, 18, 14, 0, 0); // 2026-09-18 周五 14:00
  const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h || 0, mi || 0, 0, 0).getTime();
  const eod = (y, mo, d) => new Date(y, mo - 1, d, 23, 59, 59, 999).getTime();
  const show = ts => (ts ? new Date(ts).toLocaleString("zh-CN", { hour12: false }) : String(ts));

  // H-01：「下周X」被无条件 delta += 7，整体晚一周；「下周日」另有一套只加一次的实现
  const w = parse.parseChineseTime("提醒我下周三交房租", now);
  ok("H-01 下周三 = 09-23（不是 09-30）", w.trigger === at(2026, 9, 23, 10, 0), show(w.trigger));
  const ws = parse.parseChineseTime("下周日交房租", now);
  ok("H-01 下周日 = 09-27", ws.trigger === at(2026, 9, 27, 10, 0), show(ws.trigger));
  ok("H-01 两个分支统一为同一日历周",
    new Date(w.trigger).getDay() === 3 && new Date(ws.trigger).getDay() === 0 &&
    ws.trigger - w.trigger === 4 * 86400000, show(w.trigger) + " / " + show(ws.trigger));
  const w2 = parse.parseChineseTime("下下周一开会", now);
  ok("H-01 下下周一 = 09-28", w2.trigger === at(2026, 9, 28, 10, 0), show(w2.trigger));

  // H-02：「每月N号」的号数被丢弃，落 +30 天兜底，锚点永久漂移
  const m = parse.parseChineseTime("每月15号提醒我", now);
  ok("H-02 每月15号 = 10-15（不是 10-18）", m.trigger === at(2026, 10, 15, 10, 0), show(m.trigger));
  ok("H-02 每月15号 周期为 monthly", m.repeat && m.repeat.every === "month" && m.repeat.mode === "calendar");
  const mNext = repeat.nextRepeatTrigger({ repeat: m.repeat, triggerAt: m.trigger }, m.trigger);
  ok("H-02 次期仍锚 15 号（不再漂到 18）",
    new Date(mNext).getDate() === 15 && new Date(mNext).getMonth() === 10, show(mNext));
  ok("H-02 每月N号 判为具体时间（不再进延后澄清）", parse.hasSpecificTimeWord("每月15号提醒我") === true);

  // H-03：「下个月N号」号数被丢掉、硬编码成 1 号
  const n = parse.parseChineseTime("下个月5号交电费", now);
  ok("H-03 下个月5号 = 10-05（不是 10-01）", n.trigger === at(2026, 10, 5, 10, 0), show(n.trigger));
  ok("H-03 号数不留在标题里", n.title === "交电费", n.title);
  const n2 = parse.parseChineseTime("下个月交电费", now);
  ok("H-03 未给号数时仍为次月 1 号", n2.trigger === at(2026, 10, 1, 10, 0), show(n2.trigger));
  const ml = parse.parseChineseTime("下个月底结算", now);
  ok("H-03 下个月底 = 10-31（不是本月底 09-30）", ml.trigger === at(2026, 10, 31, 10, 0), show(ml.trigger));
  const cl = parse.parseChineseTime("月底结算", now);
  ok("H-03 月底 仍为当月末", cl.trigger === at(2026, 9, 30, 10, 0), show(cl.trigger));

  // N-04：标题残留 / 「半」不识别 / 「X 前·之前」丢截止
  const s = parse.parseChineseTime("每周一早上9点站会", now);
  ok("N-04 每周X 不留孤立星期字", s.title === "站会", s.title);
  ok("N-04 每周一 落在周一 09:00",
    new Date(s.trigger).getDay() === 1 && new Date(s.trigger).getHours() === 9, show(s.trigger));
  const t2 = parse.parseChineseTime("下下周一开会", now);
  ok("N-04 下下周X 不留孤立「下」", t2.title === "开会", t2.title);
  const t3 = parse.parseChineseTime("本周五前提交报告", now);
  ok("N-04 本周X 不留孤立「本」", t3.title === "提交报告", t3.title);
  const half = parse.parseChineseTime("明天上午10点半面试", now);
  ok("N-04 「半」= 30 分", half.trigger === at(2026, 9, 19, 10, 30), show(half.trigger));
  ok("N-04 「半」不留在标题", half.title === "面试", half.title);
  const b1 = parse.parseChineseTime("明天上午9点前提交", now);
  ok("N-04 「9点前」产出截止（精确到那一刻）", b1.deadline === at(2026, 9, 19, 9, 0), show(b1.deadline));
  ok("N-04 「9点前」标题干净", b1.title === "提交", b1.title);
  const b2 = parse.parseChineseTime("12月31日之前提交年报", now);
  ok("N-04 「之前」产出截止（当天末尾）", b2.deadline === eod(2026, 12, 31), show(b2.deadline));
  ok("N-04 「之前」标题干净", b2.title === "提交年报", b2.title);

  // 不能把既有口径改坏：硬关键词 + 「提前N天」的截止仍走原路径
  const b3 = parse.parseChineseTime("9月30日截止，提前五天交材料", now);
  ok("既有：截止 + 提前五天 仍按原口径", b3.deadline === eod(2026, 9, 30), show(b3.deadline));
  // 也不能因为硬关键词就顺手给周期事项加截止（会每期多一轮截止打扰）
  const mEnd = parse.parseChineseTime("每月最后一天交房租", now);
  ok("周期事项不因「最后一天」被加上截止", mEnd.deadline == null, String(mEnd.deadline));
  ok("周期事项仍是 monthEnd", mEnd.repeat && mEnd.repeat.every === "monthEnd");
  // 没有时间指向词时不得凭空造出截止
  ok("无截止语义时不产出截止", parse.parseChineseTime("记得买牛奶", now).deadline == null);
}

/* repeat */
section("repeat");
{
  const base = new Date(2026, 0, 15, 10, 0, 0);
  const day = repeat.nextRepeatTrigger({ repeat: { every: "day", mode: "calendar" }, triggerAt: base.getTime() }, base.getTime());
  ok("day +1", new Date(day).getDate() === 16);

  const me = new Date(repeat.nextRepeatTrigger({
    repeat: { every: "monthEnd", mode: "calendar" },
    triggerAt: base.getTime()
  }, base.getTime()));
  ok("monthEnd last day", me.getDate() === 31 || me.getDate() === 30 || me.getDate() === 28 || me.getDate() === 29);
  ok("monthEnd is Jan 31 2026", me.getMonth() === 0 && me.getDate() === 31, me.toString());

  const nth = new Date(repeat.nextRepeatTrigger({
    repeat: { every: "nthWeekday", mode: "calendar", nth: 2, dow: 2 },
    triggerAt: base.getTime()
  }, base.getTime()));
  ok("nth weekday Tue", nth.getDay() === 2);
  ok("nth in 8-14", nth.getDate() >= 8 && nth.getDate() <= 14);

  const prev = repeat.nextRepeatPreview({ every: "week", mode: "calendar" }, base.getTime(), 5);
  ok("preview 5", prev.length === 5);
  ok("preview ascending", prev.every((t, i) => i === 0 || t > prev[i - 1]));
}

/* quiet + realert */
section("reminder");
{
  const settings = { dnd: true, quietStart: "23:00", quietEnd: "07:30" };
  ok("23:30 quiet", reminder.inQuietHours(new Date(2026, 5, 10, 23, 30), settings));
  ok("08:00 not quiet", !reminder.inQuietHours(new Date(2026, 5, 10, 8, 0), settings));
  const end = new Date(reminder.quietEnd(new Date(2026, 5, 10, 23, 30), settings));
  ok("quiet end next 07:30", end.getHours() === 7 && end.getMinutes() === 30 && end.getDate() === 11);

  const now = Date.now();
  const important = {
    status: "due",
    priority: "important",
    remindCount: 1,
    lastRemindAt: now - 31 * 60 * 1000,
    deliveredAt: now - 31 * 60 * 1000
  };
  ok("important realert after 30m", reminder.shouldRealert(important, now, { importantRepeat: true }));
  ok("important no realert if disabled", !reminder.shouldRealert(important, now, { importantRepeat: false }));
  ok("important blocked by dismiss", !reminder.shouldRealert(important, now, {
    importantRepeat: true,
    dismissedAt: now - 5 * 60 * 1000
  }));

  const critical = {
    status: "due",
    priority: "critical",
    remindCount: 2,
    lastRemindAt: now - 16 * 60 * 1000,
    deliveredAt: now - 16 * 60 * 1000
  };
  ok("critical realert after 15m", reminder.shouldRealert(critical, now, {}));

  const maxed = {
    status: "due",
    priority: "important",
    remindCount: 4,
    lastRemindAt: now - 60 * 60 * 1000
  };
  ok("important max 4", !reminder.shouldRealert(maxed, now, { importantRepeat: true }));

  const normal = {
    status: "due",
    priority: "normal",
    remindCount: 1,
    lastRemindAt: now - 60 * 60 * 1000
  };
  ok("normal no auto realert", !reminder.shouldRealert(normal, now, {}));

  const acked = { status: "acknowledged", priority: "critical", remindCount: 1 };
  ok("acked no realert", !reminder.shouldRealert(acked, now, {}));

  // window
  const sat = new Date(2026, 8, 19, 0, 0, 0); // assume Saturday
  const item = {
    triggerAt: sat.getTime(),
    windowStart: sat.getTime(),
    windowEnd: new Date(2026, 8, 20, 23, 59, 59).getTime()
  };
  const winTs = reminder.applyWindowTrigger(item, new Date(2026, 8, 15).getTime());
  const winD = new Date(winTs);
  ok("window pick 10:00", winD.getHours() === 10, winD.toString());

  const marked = reminder.markReminded({ remindCount: 1 }, now);
  ok("markReminded +1", marked.remindCount === 2 && marked.lastRemindAt === now);
}

/* ---------- 导入 / 导出（CP-002 · D46–D54） ---------- */

section("export-format");
{
  const fs = require("fs");
  const ex = require(path.join(__dirname, "lib/export-format.js"));

  const ts = new Date(2026, 8, 21, 9, 0, 0).getTime();
  const iso = ex.isoWithOffset(ts);
  ok("iso 带偏移", /[+-]\d{2}:\d{2}$/.test(iso), iso);
  ok("iso 往返仍是同一时刻", new Date(iso).getTime() === ts, iso);
  ok("iso null 安全", ex.isoWithOffset(null) === null);
  ok("utcStamp 以 Z 结尾", /^\d{8}T\d{6}Z$/.test(ex.utcStamp(ts)), ex.utcStamp(ts));

  // 导出侧不得自己长出一套「提前多久算临近截止」的规则
  ok("DEADLINE_LEAD_MS 与 reminder 一致",
    ex.DEADLINE_LEAD_MS === reminder.DEADLINE_LEAD_MS,
    ex.DEADLINE_LEAD_MS + " vs " + reminder.DEADLINE_LEAD_MS);

  const EVERY = ["day", "week", "biweek", "month", "monthEnd", "nthWeekday"];
  ok("ack 周期一律不产出 rrule（硬红线）",
    EVERY.every(e => ex.rruleFor({ every: e, mode: "ack", nth: 2, dow: 2 }, ts) === null));
  ok("day → FREQ=DAILY", ex.rruleFor({ every: "day", mode: "calendar" }, ts) === "FREQ=DAILY");
  ok("monthEnd → BYMONTHDAY=-1",
    ex.rruleFor({ every: "monthEnd", mode: "calendar" }, ts) === "FREQ=MONTHLY;BYMONTHDAY=-1");
  ok("month → 锚在当日",
    ex.rruleFor({ every: "month", mode: "calendar" }, ts) === "FREQ=MONTHLY;BYMONTHDAY=21");
  ok("nthWeekday → BYDAY=2TU",
    ex.rruleFor({ every: "nthWeekday", mode: "calendar", nth: 2, dow: 2 }, ts) === "FREQ=MONTHLY;BYDAY=2TU");
  ok("nthWeekday 最后 → BYDAY=-1MO",
    ex.rruleFor({ every: "nthWeekday", mode: "calendar", nth: -1, dow: 1 }, ts) === "FREQ=MONTHLY;BYDAY=-1MO");
  ok("biweek 带 INTERVAL=2",
    ex.rruleFor({ every: "biweek", mode: "calendar" }, ts).indexOf("INTERVAL=2") > 0);
  ok("week 带 BYDAY", /;BYDAY=(SU|MO|TU|WE|TH|FR|SA)$/.test(ex.rruleFor({ every: "week", mode: "calendar" }, ts)));

  const now2 = new Date(2026, 8, 18, 12, 0, 0).getTime();
  ok("无截止 → NONE", ex.deriveDeadlineStatus({}, now2) === "NONE");
  ok("远期 → PENDING", ex.deriveDeadlineStatus({ deadlineAt: now2 + 72 * 3600e3 }, now2) === "PENDING");
  ok("24h 内 → PROTECTED", ex.deriveDeadlineStatus({ deadlineAt: now2 + 3 * 3600e3 }, now2) === "PROTECTED");
  ok("已过 → PASSED", ex.deriveDeadlineStatus({ deadlineAt: now2 - 1000 }, now2) === "PASSED");
  ok("暂停 → PENDING",
    ex.deriveDeadlineStatus({ deadlineAt: now2 + 3 * 3600e3, deadlinePaused: true }, now2) === "PENDING");

  ok("已完成且曾 ACK → ACKNOWLEDGED",
    ex.deriveAttentionStatus({ status: "completed", acknowledgedAt: now2 }) === "ACKNOWLEDGED");
  ok("已完成但无 ACK 记录 → 不假装 ACKNOWLEDGED",
    ex.deriveAttentionStatus({ status: "completed" }) === "WAITING");
  ok("due → DELIVERED", ex.deriveAttentionStatus({ status: "due" }) === "DELIVERED");

  ok("time_source 只产出 PARSED / FALLBACK（D54）",
    [{}, { triggerAt: now2 }, { triggerAt: now2, isFallbackTrigger: true }]
      .every(c => ["PARSED", "FALLBACK"].indexOf(ex.deriveTimeSource(c)) >= 0));
  ok("无触发时刻 → FALLBACK", ex.deriveTimeSource({}) === "FALLBACK");

  const mk = o => Object.assign({
    id: "x", title: "t", status: "waiting", priority: "normal",
    review_status: "READY", createdAt: now2 - 1000, tags: []
  }, o);
  const now3 = new Date(2026, 8, 18, 15, 0, 0).getTime();
  const fixture = [
    mk({ id: "a", title: "交房租", triggerAt: now3 + 3 * 24 * 3600e3, repeat: { every: "month", mode: "calendar" } }),
    mk({ id: "b", title: "报名截止", status: "acknowledged", priority: "important", triggerAt: null,
      acknowledgedAt: now3 - 3600e3, deadlineAt: now3 + 5 * 24 * 3600e3 }),
    mk({ id: "c", title: "待整理项", review_status: "NEEDS_REVIEW", isFallbackTrigger: true, triggerAt: now3 + 86400e3 }),
    mk({ id: "d", title: "已归档", status: "archived" }),
    mk({ id: "f", title: "给爸妈打电话", triggerAt: now3 + 2 * 24 * 3600e3, repeat: { every: "biweek", mode: "ack" } }),
    mk({ id: "g", title: "这是一条特别特别长的标题用来验证 ICS 折行是否真的生效".repeat(3), triggerAt: now3 + 4 * 24 * 3600e3 })
  ];
  const exp = ex.buildExport(fixture, {
    now: now3, appVersion: "test", internalSchema: 4, scope: { mode: "active" },
    extras: { settingsSubset: { defaultDeliveryMode: "alarm", quietStart: "23:00", ai: { apiKey: "sk-LEAK", baseUrl: "https://leak.example" } } }
  });
  ok("默认范围排除已归档", exp.items.every(i => i.id !== "d"));
  ok("默认范围包含待整理", exp.items.some(i => i.id === "c"));
  ok("counts 与条目数一致", exp.counts.items === exp.items.length, String(exp.counts.items));
  ok("绝不导出密钥", ex.scanSecrets(exp).length === 0, JSON.stringify(ex.scanSecrets(exp)));
  ok("设置子集保留非密钥项", exp.extensions.internal.settings_subset.quietStart === "23:00");
  ok("original_capture 如实为 null（不臆造）", exp.items.every(i => i.original_capture === null));
  ok("derived 标注派生字段", exp.items.find(i => i.id === "b").derived.indexOf("attention_status") >= 0);
  ok("importance 不算派生（它就是存储的 priority）",
    exp.items.find(i => i.id === "b").derived.indexOf("importance") < 0);
  ok("repeat.rrule 计入 derived", exp.items.find(i => i.id === "a").derived.indexOf("repeat.rrule") >= 0);
  ok("ack 周期条目的 rrule 为 null", exp.items.find(i => i.id === "f").repeat.rrule === null);
  ok("ack 周期也不进 derived", exp.items.find(i => i.id === "f").derived.indexOf("repeat.rrule") < 0);
  ok("ACK 未完成 → ACKNOWLEDGED + ACTIVE",
    exp.items.find(i => i.id === "b").attention_status === "ACKNOWLEDGED" &&
    exp.items.find(i => i.id === "b").completion_status === "ACTIVE");
  ok("时间双写指向同一时刻", exp.items.every(i =>
    (i.trigger_at_ms == null && i.trigger_at_iso == null) ||
    new Date(i.trigger_at_iso).getTime() === i.trigger_at_ms));

  // 代码与对外契约不得各自漂移：条目字段必须与 JSON Schema 完全一致
  const schema = JSON.parse(fs.readFileSync(
    path.join(__dirname, "docs/compose/spec/schemas/attention-inbox.export.v1.schema.json"), "utf8"));
  const allowedItem = Object.keys(schema.$defs.item.properties).sort();
  const actualItem = Object.keys(exp.items[0]).sort();
  ok("条目字段与 schema 完全一致（不多不少）",
    JSON.stringify(actualItem) === JSON.stringify(allowedItem),
    "多: " + actualItem.filter(k => allowedItem.indexOf(k) < 0) +
    " 少: " + allowedItem.filter(k => actualItem.indexOf(k) < 0));
  ok("schema 必填字段齐备",
    schema.$defs.item.required.every(k => exp.items[0][k] !== undefined));
  ok("顶层字段都在 schema 内",
    Object.keys(exp).every(k => schema.properties[k] !== undefined),
    JSON.stringify(Object.keys(exp).filter(k => schema.properties[k] === undefined)));
  ok("scope.mode 是合法枚举",
    ["all", "active", "future", "range"].indexOf(exp.scope.mode) >= 0);
  ok("导出范围过滤可关闭 NEEDS_REVIEW",
    ex.buildExport(fixture, { now: now3, scope: { mode: "active", include_needs_review: false } })
      .items.every(i => i.review_status !== "NEEDS_REVIEW"));

  const ics = ex.buildIcs(fixture, { now: now3, scope: { mode: "active" } });
  ok("ICS 用 CRLF 断行", ics.text.indexOf("\r\n") > 0);
  ok("兜底且无截止的条目不进日历", ics.dropped === 1, String(ics.dropped));
  ok("兜底但有真实截止的条目降级为 VTODO", ics.downgraded === 1 && ics.text.indexOf("BEGIN:VTODO") >= 0);
  ok("被丢弃的条目确实不在文件里", ics.text.indexOf("UID:c@attention-inbox") < 0);
  ok("普通的条目是 VEVENT", ics.text.indexOf("BEGIN:VEVENT") >= 0);
  const dtLines = ics.text.split("\r\n").filter(l => /^DT(START|END|STAMP|DUE):/.test(l));
  ok("所有 DT 行都是 UTC（D53）", dtLines.length > 0 && dtLines.every(l => /Z$/.test(l)),
    JSON.stringify(dtLines.slice(0, 3)));
  ok("写入对外语义契约（ACK != Complete）", ics.text.indexOf("ACK != Complete") >= 0);
  ok("写入 X-ATTENTION 语义标注", ics.text.indexOf("X-ATTENTION-ATTENTION-STATUS:") >= 0);
  const enc = new TextEncoder();
  const icsLines = ics.text.split("\r\n");
  ok("ICS 每行不超过 75 字节",
    icsLines.every(l => enc.encode(l).length <= 75),
    "最长 " + Math.max.apply(null, icsLines.map(l => enc.encode(l).length)));
  ok("ICS 折行真的发生过（存在续行）", icsLines.some(l => l.startsWith(" ")));
  const fBlock = ics.text.split("BEGIN:VEVENT").filter(b => b.indexOf("UID:f@attention-inbox") >= 0)[0] || "";
  ok("ack 周期在 ICS 里没有 RRULE 行", fBlock !== "" && fBlock.indexOf("RRULE:") < 0);
  const aBlock = ics.text.split("BEGIN:VEVENT").filter(b => b.indexOf("UID:a@attention-inbox") >= 0)[0] || "";
  ok("日历周期有 RRULE 行", aBlock.indexOf("RRULE:FREQ=MONTHLY;BYMONTHDAY=") >= 0);
}

section("import-extract");
{
  const ix = require(path.join(__dirname, "lib/import-extract.js"));

  ok("按扩展名识别类型",
    ix.detectKind("a.ICS", "") === "ics" && ix.detectKind("x.csv", "") === "csv" &&
    ix.detectKind("n.md", "") === "markdown" && ix.detectKind("b.JSON", "") === "json");
  ok("按 MIME 识别类型", ix.detectKind("noext", "text/calendar") === "ics");
  ok("不认识的后缀 → null", ix.detectKind("a.pdf", "application/pdf") === null);
  ok("hash32 稳定且能区分", ix.hash32("abc") === ix.hash32("abc") && ix.hash32("abc") !== ix.hash32("abd"));

  const t = ix.extract({ name: "a.txt", text: "-------\n交房租\n\n- 明天买牛奶\n   \n" });
  ok("txt 解析成功", t.ok === true && t.kind === "text");
  ok("txt 跳过分隔线与空行", t.drafts.length === 2, JSON.stringify(t.drafts.map(d => d.title)));
  ok("txt 剥掉列表符", t.drafts[1].title === "明天买牛奶");
  ok("txt 带行定位", t.drafts[0].source_locator.indexOf("行") > 0);

  const mdText = "---\ntitle: x\n---\n## 会议纪要\n- [ ] 下周三之前提交季度报销\n- 普通一项\n说明段落不该进来\n";
  const m = ix.extract({ name: "m.md", text: mdText });
  ok("md 只抽列表项", m.drafts.length === 2, JSON.stringify(m.drafts.map(d => d.title)));
  ok("md 标题成为标签", m.drafts[0].tags[0] === "会议纪要");
  ok("md 复选框标记被剥离", m.drafts[0].title === "下周三之前提交季度报销");
  ok("md 段落不混入列表结果", m.drafts.every(d => d.title.indexOf("说明段落") < 0));
  ok("md 跳过 front matter", m.drafts.every(d => d.title.indexOf("title: x") < 0));

  const m2 = ix.extract({ name: "m2.md", text: "第一件事是买牛奶\n第二件事是交房租\n" });
  ok("md 无列表时按段落兜底", m2.drafts.length === 2 && m2.warnings.length > 0, JSON.stringify(m2.warnings));

  const csvText = "标题,提醒时间,截止时间,备注,标签\n交房租,明天,本月最后一天,转账给房东,生活\n体检,\"下周三 9:00\",,需要空腹,\n";
  const c = ix.extract({ name: "a.csv", text: csvText });
  ok("csv 表头映射出两条", c.drafts.length === 2, JSON.stringify(c.drafts.map(d => d.title)));
  ok("csv 取到标题", c.drafts[0].title === "交房租");
  ok("csv 取到时间串", c.drafts[0].when_text === "明天");
  ok("csv 取到截止串", c.drafts[0].deadline_text === "本月最后一天");
  ok("csv 引号内的逗号不被拆列", c.drafts[1].when_text === "下周三 9:00", JSON.stringify(c.drafts[1].when_text));
  ok("csv 标签按顿号/逗号拆开", c.drafts[0].tags[0] === "生活");
  ok("csv 表头行本身不成为条目", c.drafts.every(d => d.title !== "标题"));

  const c2 = ix.extract({ name: "b.csv", text: "买牛奶,明天\n交房租,月底\n" });
  ok("csv 无表头时回退并告警",
    c2.drafts.length === 2 && c2.drafts[0].title === "买牛奶" && c2.warnings.length > 0);

  const icsText = [
    "BEGIN:VCALENDAR", "VERSION:2.0",
    "BEGIN:VEVENT", "UID:u1", "SUMMARY:季度评审", "DTSTART:20260923T010000Z",
    "RRULE:FREQ=WEEKLY;BYDAY=WE", "DESCRIPTION:会议室 A", "END:VEVENT",
    "BEGIN:VTODO", "UID:u2", "SUMMARY:提交报销", "DUE;VALUE=DATE:20260930", "END:VTODO",
    "END:VCALENDAR"
  ].join("\r\n");
  const i = ix.extract({ name: "a.ics", text: icsText });
  ok("ics 抽出两条", i.drafts.length === 2, JSON.stringify(i.drafts.map(d => d.title)));
  ok("ics 是结构化来源", i.drafts.every(d => d.source_kind === "structured"));
  ok("ics 的 UTC 时刻换算正确", i.drafts[0].at_ms === Date.UTC(2026, 8, 23, 1, 0, 0), String(i.drafts[0].at_ms));
  ok("ics 周期映射为 week", i.drafts[0].repeat && i.drafts[0].repeat.every === "week");
  ok("ics 全天截止落到当天 23:59", (function () {
    const d = new Date(i.drafts[1].deadline_at_ms);
    return d.getFullYear() === 2026 && d.getMonth() === 8 && d.getDate() === 30 &&
      d.getHours() === 23 && d.getMinutes() === 59;
  })());
  ok("ics 不带 when_text（不该绕自然语言解析）", i.drafts.every(d => d.when_text == null));

  const exMod = require(path.join(__dirname, "lib/export-format.js"));
  const rtNow = new Date(2026, 8, 18, 15, 0, 0).getTime();
  const own = exMod.buildExport([
    { id: "r1", title: "交房租", status: "waiting", priority: "normal", review_status: "READY",
      triggerAt: rtNow + 86400e3, createdAt: rtNow, tags: [], repeat: { every: "month", mode: "calendar" } },
    { id: "r2", title: "待整理", status: "waiting", review_status: "NEEDS_REVIEW",
      isFallbackTrigger: true, triggerAt: rtNow + 3600e3, createdAt: rtNow, tags: [] }
  ], { now: rtNow, scope: { mode: "all", include_needs_review: true } });
  const rt = ix.extract({ name: "export.json", text: JSON.stringify(own) });
  ok("自家导出件可被识别", rt.ok === true && rt.drafts.length === own.items.length, JSON.stringify(rt.warnings));
  ok("回环携带内部字段", rt.drafts[0].internal && rt.drafts[0].internal.status != null);
  ok("回环走结构化通道", rt.drafts.every(d => d.source_kind === "structured"));
  ok("回环保留原状态（不被打回 waiting）", rt.drafts[1].internal.status === "waiting");
  ok("回环保留周期", rt.drafts[0].repeat && rt.drafts[0].repeat.every === "month");

  const gen = ix.extract({
    name: "g.json",
    text: JSON.stringify([{ 标题: "交房租", 时间: "2026-09-21T09:00:00+08:00" }, { title: "买牛奶", time: "明天" }])
  });
  ok("通用 JSON 抽出两条", gen.drafts.length === 2, JSON.stringify(gen.drafts.map(d => d.title)));
  ok("ISO 时间走结构化通道", gen.drafts[0].at_ms === new Date("2026-09-21T09:00:00+08:00").getTime());
  ok("自然语言时间走文本通道", gen.drafts[1].when_text === "明天" && gen.drafts[1].at_ms === null);

  ok("坏 JSON 是真失败（不伪装成 0 条）",
    ix.extract({ name: "bad.json", text: "{ oops" }).ok === false);
  ok("不支持的类型被拒",
    ix.extract({ name: "a.pdf", mime: "application/pdf", text: "x" }).ok === false);
  ok("超过大小上限被拒",
    ix.extract({ name: "a.txt", text: "x", size: 6 * 1024 * 1024 }).ok === false);
  ok("空文件被拒", ix.extract({ name: "a.txt", text: "" }).ok === false);

  const many = ix.extract({ name: "many.txt", text: Array.from({ length: 260 }, (_, k) => "事项" + k).join("\n") });
  ok("超量截断且如实标记",
    many.drafts.length === 200 && many.truncated === true && many.skipped === 60,
    many.drafts.length + "/" + many.truncated + "/" + many.skipped);
  const exact = ix.extract({ name: "exact.txt", text: Array.from({ length: 200 }, (_, k) => "事项" + k).join("\n") });
  ok("正好 200 条不算截断", exact.drafts.length === 200 && exact.truncated === false);
}

section("import-map");
{
  const im = require(path.join(__dirname, "lib/import-map.js"));
  const now4 = new Date(2026, 8, 18, 15, 0, 0).getTime();
  const FALLBACK_TS = new Date(2026, 8, 19, 21, 30, 0).getTime();
  let seq = 0;
  const deps = {
    parse: parse.parseChineseTime,
    now: now4,
    uid: () => "it" + (++seq),
    fallbackTriggerAt: () => FALLBACK_TS,
    defaultDeliveryMode: "notification",
    batchId: "b1"
  };
  const r1 = im.mapDrafts([
    { title: "下周三之前提交季度报销", when_text: "下周三", source_quote: "下周三之前提交季度报销", source_locator: "第 3 行", source_kind: "text" },
    { title: "看看 Horolog 的调度设计", when_text: null, source_quote: "看看 Horolog 的调度设计", source_locator: "第 5 行", source_kind: "text" },
    { title: "体检", at_ms: new Date(2026, 9, 10, 9, 0, 0).getTime(), when_text: "明早八点", source_kind: "structured", source_locator: "UID u9" }
  ], deps);

  ok("映射出三条", r1.items.length === 3);
  ok("一律 waiting（绝不直接落 due）", r1.items.every(x => x.status === "waiting"));
  ok("一律 NEEDS_REVIEW", r1.items.every(x => x.review_status === "NEEDS_REVIEW"));
  ok("一律 priority=normal（AI 不判优先级）", r1.items.every(x => x.priority === "normal"));
  ok("保留来源引用", r1.items[0].sourceQuote === "下周三之前提交季度报销");
  ok("保留来源标题", r1.items[0].sourceTitle === "第 3 行");
  ok("打上批次号", r1.items.every(x => x.importBatchId === "b1"));
  ok("原生投递方式取全局默认快照", r1.items.every(x => x.delivery_mode === "notification"));
  ok("自然语言时间由注入的解析器换算",
    r1.items[0].triggerAt === parse.parseChineseTime("下周三", now4).trigger,
    String(r1.items[0].triggerAt));
  ok("无法识别时间 → 兜底时刻 + isFallbackTrigger",
    r1.items[1].isFallbackTrigger === true && r1.items[1].triggerAt === FALLBACK_TS);
  ok("结构化来源直接采信时间戳",
    r1.items[2].triggerAt === new Date(2026, 9, 10, 9, 0, 0).getTime());
  ok("结构化来源忽略 when_text（两条通道不互相污染）", r1.items[2].isFallbackTrigger === false);
  ok("预览带置信度与时间来源说明", r1.preview.length === 3 && r1.preview[1].timeNote.length > 0);
  ok("摘要统计可用", im.summarize(r1.preview).fallback === 1, JSON.stringify(im.summarize(r1.preview)));

  const r2 = im.mapDrafts([{
    title: "回环项", source_kind: "structured", at_ms: now4 + 1000,
    internal: { evil: 1, status: "hacked", rev: 5, unknownKey: "x" }
  }], deps);
  ok("白名单拒绝非法状态", r2.items[0].status === "waiting", r2.items[0].status);
  ok("白名单不引入未知字段", r2.items[0].evil === undefined && r2.items[0].unknownKey === undefined);
  ok("白名单恢复合法字段", r2.items[0].rev === 5);
  const r2b = im.mapDrafts([{ title: "回环项2", source_kind: "structured", at_ms: now4 + 1000, internal: { status: "acknowledged" } }], deps);
  ok("白名单允许合法状态回环", r2b.items[0].status === "acknowledged");

  const r3 = im.mapDrafts([{ title: "买牛奶", source_kind: "text" }],
    Object.assign({}, deps, { existingItems: [{ id: "old1", title: " 买牛奶 " }] }));
  ok("疑似重复只标记、绝不自动合并",
    r3.items.length === 1 && r3.preview[0].duplicateOf === "old1");
  ok("摘要统计疑似重复", im.summarize(r3.preview).possibleDuplicates === 1);

  const r4 = im.mapDrafts([{ title: "x", source_kind: "text" }], { now: now4, uid: () => "z" });
  ok("未注入解析器时明确告警", r4.warnings.some(w => w.indexOf("时间解析器") >= 0), JSON.stringify(r4.warnings));
  ok("未注入兜底函数时明确告警", r4.warnings.some(w => w.indexOf("fallbackTriggerAt") >= 0));
}

/* ui-format（P2 首批搬移：从 app-core 抽出的纯格式化工具） */
section("ui-format");
{
  const uf = require(path.join(__dirname, "lib/ui-format.js"));
  const prim = require(path.join(__dirname, "lib/date-utils.js"));

  // 别名同一性：格式化里用到的日历判定必须来自 lib/date-utils.js 同一份，
  // 不是「行为相同的另一份 sameDay」。
  ok("ui-format 挂在命名空间 AttentionLib.UiFormat 上（不是扁平合并）",
    (function () {
      // Node 下走 module.exports，浏览器下走 root.AttentionLib.UiFormat —— 这里验形状与自洽。
      return typeof uf.fmtTime === "function" && typeof uf.renderMarkdown === "function" &&
        typeof uf.escapeHtml === "function" && typeof uf.escapeAttr === "function";
    })());

  // 固定时钟：「今天 / 明天 / 昨天 / 带日期 / 跨年带年份」
  const ref = new Date(2026, 8, 18, 14, 0, 0).getTime();   // 2026-09-18 周五 14:00
  ok("fmtTime 今天", uf.fmtTime(new Date(2026, 8, 18, 9, 5, 0).getTime(), ref) === "今天 09:05",
    uf.fmtTime(new Date(2026, 8, 18, 9, 5, 0).getTime(), ref));
  ok("fmtTime 明天", uf.fmtTime(new Date(2026, 8, 19, 23, 59, 0).getTime(), ref) === "明天 23:59",
    uf.fmtTime(new Date(2026, 8, 19, 23, 59, 0).getTime(), ref));
  ok("fmtTime 昨天", uf.fmtTime(new Date(2026, 8, 17, 0, 0, 0).getTime(), ref) === "昨天 00:00",
    uf.fmtTime(new Date(2026, 8, 17, 0, 0, 0).getTime(), ref));
  ok("fmtTime 同年带月日", uf.fmtTime(new Date(2026, 8, 23, 10, 0, 0).getTime(), ref) === "9月23日 10:00",
    uf.fmtTime(new Date(2026, 8, 23, 10, 0, 0).getTime(), ref));
  ok("fmtTime 跨年带年份", uf.fmtTime(new Date(2027, 0, 3, 8, 0, 0).getTime(), ref) === "2027年1月3日 08:00",
    uf.fmtTime(new Date(2027, 0, 3, 8, 0, 0).getTime(), ref));
  ok("fmtTime 空值返回空串", uf.fmtTime(0, ref) === "" && uf.fmtTime(null, ref) === "");

  ok("fmtDate 不带钟点", uf.fmtDate(new Date(2026, 8, 19, 5, 0, 0).getTime(), ref) === "明天",
    uf.fmtDate(new Date(2026, 8, 19, 5, 0, 0).getTime(), ref));

  // 相对到期：边界分钟 / 小时 / 天
  ok("relDue 未来不足 1 分钟 = 现在", uf.relDue(ref + 30000, ref) === "现在");
  ok("relDue 未来 5 分钟", uf.relDue(ref + 300000, ref) === "5 分钟后");
  ok("relDue 未来 3 小时", uf.relDue(ref + 3 * 3600000, ref) === "3 小时后");
  ok("relDue 未来 2 天", uf.relDue(ref + 2 * 86400000, ref) === "2 天后");
  ok("relDue 已过不足 1 小时至少报 1 分钟", uf.relDue(ref - 30000, ref) === "已过 1 分钟");
  ok("relDue 已过 2 小时", uf.relDue(ref - 2 * 3600000, ref) === "已过 2 小时");
  ok("relDue 已过 3 天", uf.relDue(ref - 3 * 86400000, ref) === "已过 3 天");

  // 转义：文本侧与属性侧字符集一致、命名分开
  const evil = '<img src=x onerror="alert(1)">';
  ok("escapeHtml 转义尖引号", uf.escapeHtml(evil).indexOf("<") < 0 && uf.escapeHtml(evil).indexOf('"') < 0,
    uf.escapeHtml(evil));
  ok("escapeAttr 与 escapeHtml 字符集一致（同样的输入同样输出）",
    uf.escapeAttr(evil) === uf.escapeHtml(evil));
  ok("escapeHtml 空值安全", uf.escapeHtml(null) === "" && uf.escapeHtml(undefined) === "");

  // Markdown：必须先转义再插标签，用户内容里的标签不能活着出去
  const md = uf.renderMarkdown('# 标题\n\n**粗** 与 `代码`\n\n- 甲\n- 乙');
  ok("renderMarkdown 生成 h1", md.indexOf("<h1>标题</h1>") >= 0, md);
  ok("renderMarkdown 生成 strong 与 code", md.indexOf("<strong>粗</strong>") >= 0 && md.indexOf("<code>代码</code>") >= 0, md);
  ok("renderMarkdown 生成 ul/li", md.indexOf("<ul>") >= 0 && md.indexOf("<li>甲</li>") >= 0, md);
  ok("renderMarkdown 先转义：用户写 <script> 不会变成真标签",
    uf.renderMarkdown("<script>alert(1)</script>").indexOf("<script>") < 0,
    uf.renderMarkdown("<script>alert(1)</script>"));
  ok("renderMarkdown 只放行 http(s) 链接",
    uf.renderMarkdown("[a](javascript:alert(1))").indexOf("<a ") < 0,
    uf.renderMarkdown("[a](javascript:alert(1))"));
  ok("renderMarkdown 放行 https 链接",
    uf.renderMarkdown("[a](https://example.com)").indexOf('href="https://example.com"') >= 0);

  // pad / uid 形状
  ok("pad 补零", uf.pad(3) === "03" && uf.pad(12) === "12");
  const id1 = uf.uid();
  ok("uid 形状为 i_ 前缀的字符串", typeof id1 === "string" && id1.indexOf("i_") === 0, id1);

  // P2-b 追加：归档日标签与时间输入框双向转换（固定时钟，不依赖运行时「今天」）
  ok("dayLabel 空值 = 「更早」（与 fmtDate 的 \"\" 不同，刻意不合并）",
    uf.dayLabel(null) === "更早" && uf.dayLabel(0) === "更早" && uf.fmtDate(null) === "");
  ok("dayLabel 今天", uf.dayLabel(new Date(2026, 8, 18, 1, 0, 0).getTime(), ref) === "今天");
  ok("dayLabel 昨天", uf.dayLabel(new Date(2026, 8, 17, 23, 0, 0).getTime(), ref) === "昨天");
  ok("dayLabel 没有「明天」分支（回月日，而 fmtDate 回「明天」）",
    uf.dayLabel(new Date(2026, 8, 19, 9, 0, 0).getTime(), ref) === "9月19日" &&
    uf.fmtDate(new Date(2026, 8, 19, 9, 0, 0).getTime(), ref) === "明天");
  ok("dayLabel 跨年回完整年月日（fmtDate 不回）",
    uf.dayLabel(new Date(2025, 11, 31, 9, 0, 0).getTime(), ref) === "2025年12月31日" &&
    uf.fmtDate(new Date(2025, 11, 31, 9, 0, 0).getTime(), ref) === "12月31日");
  ok("toLocalInput 形状 YYYY-MM-DDTHH:mm（补零到分、不含秒）",
    uf.toLocalInput(new Date(2026, 0, 5, 9, 7, 42).getTime()) === "2026-01-05T09:07",
    uf.toLocalInput(new Date(2026, 0, 5, 9, 7, 42).getTime()));
  ok("toLocalInput 空值 = 空串", uf.toLocalInput(null) === "" && uf.toLocalInput(0) === "");
  ok("parseLocalInput 与 toLocalInput 回环（同一分钟进出不变）",
    uf.parseLocalInput(uf.toLocalInput(new Date(2026, 0, 5, 9, 7, 0).getTime())) ===
    new Date(2026, 0, 5, 9, 7, 0).getTime());
  ok("parseLocalInput 解析不出时返回 null（**不**兜底成「现在」）",
    uf.parseLocalInput("") === null && uf.parseLocalInput(null) === null &&
    uf.parseLocalInput("不是时间") === null);

  // 依赖同一来源：ui-format 的「今天/明天」判定与 date-utils 的 sameDay 一致
  ok("ui-format 的日判定与 date-utils.sameDay 一致（不是另一套实现）",
    prim.sameDay(new Date(2026, 8, 18, 1, 0, 0), new Date(2026, 8, 18, 23, 0, 0)) === true &&
    uf.fmtDate(new Date(2026, 8, 18, 1, 0, 0).getTime(), ref) === "今天");
}

/* ---------- P2-b：DOM 共用展示能力（lib/app-ui.js） ---------- */
section("app-ui — 弹层 / toast / 确认框 / 外链白名单");
const appUiDone = beginAsyncSection();
(async function () {
  const appUiMod = require(path.join(__dirname, "lib/app-ui.js"));
  const hadDoc = Object.prototype.hasOwnProperty.call(global, "document");
  const savedDoc = global.document;
  const savedSetTimeout = global.setTimeout;
  const savedClearTimeout = global.clearTimeout;

  /* 假 DOM：只实现被测代码真正用到的选择器与属性（多一个都算我没核对过）。 */
  function makeFakeDocument(extraSheetIds) {
    const byId = Object.create(null);
    const sheets = [];
    function node(id, isSheet) {
      const cls = new Set();
      const n = {
        id: id, textContent: "", hidden: false, onclick: null, _cls: cls,
        classList: {
          add(c) { cls.add(c); },
          remove(c) { cls.delete(c); },
          contains(c) { return cls.has(c); }
        }
      };
      byId[id] = n;
      if (isSheet) sheets.push(n);
      return n;
    }
    node("backdrop");
    node("toast"); node("toastText"); node("toastAction"); node("toastAction2");
    node("sheetConfirm", true);
    (extraSheetIds || []).forEach(function (id) { node(id, true); });
    node("confirmBody"); node("confirmTitle");
    node("confirmOk"); node("confirmCancel"); node("confirmClose");
    return {
      byId: byId,
      document: {
        querySelector(s) { return s.charAt(0) === "#" ? (byId[s.slice(1)] || null) : null; },
        querySelectorAll(s) {
          if (s === ".sheet") return sheets.slice();
          if (s === ".sheet.open") return sheets.filter(x => x._cls.has("open"));
          return [];
        }
      }
    };
  }

  /* 假定时器：否则「时长」这条只能等真实 2.4 秒才验得了。 */
  const scheduled = [];
  let seq = 0;
  global.setTimeout = function (fn, delay) { seq += 1; scheduled.push({ id: seq, fn: fn, delay: delay }); return seq; };
  global.clearTimeout = function (id) {
    const i = scheduled.findIndex(s => s.id === id);
    if (i >= 0) scheduled.splice(i, 1);
  };

  const dom = makeFakeDocument(["sheetCapture", "sheetDetail"]);
  global.document = dom.document;
  const box = { suppressed: false };
  const ui = appUiMod.createUi({ isFeedbackSuppressed: function () { return box.suppressed; } });

  try {
    /* 形状与「模块求值无副作用」 */
    ok("createUi 交出 8 支展示能力（$ / $$ / 弹层三支 / 确认框 / toast / hideToast）",
      typeof ui.$ === "function" && typeof ui.$$ === "function" &&
      typeof ui.openSheet === "function" && typeof ui.closeSheet === "function" &&
      typeof ui.closeAllSheets === "function" && typeof ui.confirmDialog === "function" &&
      typeof ui.toast === "function" && typeof ui.hideToast === "function");
    ok("safeExternalHref 是模块级纯函数（不需要实例）",
      typeof appUiMod.safeExternalHref === "function");
    ok("模块求值 + 实例化都不建定时器、不动 DOM（求值无副作用）",
      scheduled.length === 0 && !dom.byId.toast._cls.has("show") && dom.byId.toastText.textContent === "");

    /* 弹层：backdrop 的撤销口径是「还有没有开着的层」，不是「关了一次就撤」 */
    ui.openSheet("sheetCapture");
    ok("openSheet 打开目标层并亮出 backdrop",
      dom.byId.sheetCapture._cls.has("open") && dom.byId.backdrop._cls.has("show"));
    ui.openSheet("sheetDetail");
    ui.closeSheet("sheetCapture");
    ok("还有一层开着时关一层：backdrop 必须留着",
      !dom.byId.sheetCapture._cls.has("open") && dom.byId.sheetDetail._cls.has("open") &&
      dom.byId.backdrop._cls.has("show"));
    ui.closeSheet("sheetDetail");
    ok("关掉最后一层：backdrop 撤掉", !dom.byId.backdrop._cls.has("show"));
    ui.openSheet("sheetCapture"); ui.openSheet("sheetDetail");
    ui.closeAllSheets();
    ok("closeAllSheets 关掉全部层并撤遮罩",
      !dom.byId.sheetCapture._cls.has("open") && !dom.byId.sheetDetail._cls.has("open") &&
      !dom.byId.backdrop._cls.has("show"));

    /* toast：文案 / 按钮 / 时长 / 覆盖 / 抑制 */
    let acted = 0;
    ui.toast("已删除", "撤销", function () { acted += 1; });
    ok("toast 写入文案并亮出提示条",
      dom.byId.toastText.textContent === "已删除" && dom.byId.toast._cls.has("show"));
    ok("toast 亮出动作按钮并挂上回调",
      dom.byId.toastAction.hidden === false && dom.byId.toastAction.textContent === "撤销" &&
      typeof dom.byId.toastAction.onclick === "function");
    ok("未给第二个动作时该槽位置隐藏并清空 onclick",
      dom.byId.toastAction2.hidden === true && dom.byId.toastAction2.onclick === null);
    ok("带动作的提示时长 = 5000ms",
      scheduled.length === 1 && scheduled[0].delay === 5000, JSON.stringify(scheduled.map(s => s.delay)));
    dom.byId.toastAction.onclick();
    ok("点动作：先收起提示再执行回调",
      acted === 1 && !dom.byId.toast._cls.has("show"));

    scheduled.length = 0;
    ui.toast("普通提示");
    ok("无动作的提示时长 = 2400ms，且动作槽被收起",
      scheduled.length === 1 && scheduled[0].delay === 2400 &&
      dom.byId.toastAction.hidden === true && dom.byId.toastAction.onclick === null);

    scheduled.length = 0;
    ui.toast("第一条"); ui.toast("第二条");
    ok("连续两次 toast：前一个定时器必须被撤掉（挂起只剩 1 个）",
      scheduled.length === 1 && dom.byId.toastText.textContent === "第二条");

    ui.hideToast();
    scheduled.length = 0;
    box.suppressed = true;
    ui.toast("重放期不该弹出来", "撤销", function () {});
    ok("抑制反馈时 toast 完全不动 DOM、也不建定时器（M1 的判据）",
      scheduled.length === 0 && !dom.byId.toast._cls.has("show") &&
      // 文案停在进入抑制前那一次（"第二条"），既没被覆盖、也没重新亮起
      dom.byId.toastText.textContent === "第二条" && dom.byId.toastAction.hidden === true);
    box.suppressed = false;
    ui.toast("恢复正常");
    ok("解除抑制后 toast 恢复（文案更新、定时器重建、提示条亮出）",
      scheduled.length === 1 && dom.byId.toastText.textContent === "恢复正常" &&
      dom.byId.toast._cls.has("show"));
    ui.hideToast();
    ok("hideToast 收起提示条", !dom.byId.toast._cls.has("show"));

    /* 确认框：DOM 效果（同步）与返回值（需要 await） */
    const p1 = ui.confirmDialog("确定删除？", "删除");
    ok("确认框弹出：标题/正文回填、层打开、backdrop 亮出",
      dom.byId.confirmTitle.textContent === "删除" && dom.byId.confirmBody.textContent === "确定删除？" &&
      dom.byId.sheetConfirm._cls.has("open") && dom.byId.backdrop._cls.has("show"));
    ok("确认框三个出口都挂上了 onclick",
      typeof dom.byId.confirmOk.onclick === "function" &&
      typeof dom.byId.confirmCancel.onclick === "function" &&
      typeof dom.byId.confirmClose.onclick === "function");
    dom.byId.confirmOk.onclick();
    ok("点确定：层关闭、backdrop 撤掉、三个 onclick 全部清干净",
      !dom.byId.sheetConfirm._cls.has("open") && !dom.byId.backdrop._cls.has("show") &&
      dom.byId.confirmOk.onclick === null && dom.byId.confirmCancel.onclick === null &&
      dom.byId.confirmClose.onclick === null);
    ok("点确定 ⇒ 解析为 true", (await p1) === true);

    const p2 = ui.confirmDialog("确定删除？");
    ok("省略标题时用默认「确认」，正文原样回填",
      dom.byId.confirmTitle.textContent === "确认" && dom.byId.confirmBody.textContent === "确定删除？");
    dom.byId.confirmCancel.onclick();
    ok("点取消 ⇒ 解析为 false", (await p2) === false);

    const p3 = ui.confirmDialog();
    ok("省略正文时用默认「确定继续？」", dom.byId.confirmBody.textContent === "确定继续？");
    dom.byId.confirmClose.onclick();
    ok("点关闭 ⇒ 解析为 false", (await p3) === false);

    /* 兜底路径：没有 #sheetConfirm 时落到 window.confirm */
    const domNoSheet = makeFakeDocument([]);
    delete domNoSheet.byId.sheetConfirm;
    const savedQuery = domNoSheet.document.querySelector;
    domNoSheet.document.querySelector = function (s) {
      return s === "#sheetConfirm" ? null : savedQuery(s);
    };
    global.document = domNoSheet.document;
    const hadWindow = Object.prototype.hasOwnProperty.call(global, "window");
    const savedWindow = global.window;
    global.window = { confirm: function () { return false; } };
    ok("没有 #sheetConfirm 时落到 window.confirm，返回 false",
      (await ui.confirmDialog("危险操作")) === false);
    global.window = { confirm: function () { throw new Error("blocked"); } };
    ok("兜底路径里 window.confirm 抛错 ⇒ 保守取 true（不静默当作取消）",
      (await ui.confirmDialog("危险操作")) === true);
    if (hadWindow) global.window = savedWindow; else delete global.window;
  } finally {
    if (hadDoc) global.document = savedDoc; else delete global.document;
    global.setTimeout = savedSetTimeout;
    global.clearTimeout = savedClearTimeout;
  }

  /* 外链白名单：模块级，不需要 DOM */
  const safe = appUiMod.safeExternalHref;
  ok("https 放行", safe("https://example.com/x") === "https://example.com/x");
  ok("http 放行", safe("http://example.com") === "http://example.com");
  ok("javascript: 拒绝", safe("javascript:alert(1)") === null);
  ok("大小写混杂的 JaVaScRiPt: 拒绝（按解析后的协议判定，不看字形）", safe("jAvAsCrIpT:alert(1)") === null);
  ok("带换行的 java\\nscript: 拒绝（解析器会剔除控制字符后再判定）", safe("java\nscript:alert(1)") === null);
  ok("带 TAB 的 ja\\tvascript: 拒绝", safe("ja\tvascript:alert(1)") === null);
  ok("data: 拒绝", safe("data:text/html;base64,PHNjcmlwdD4=") === null);
  ok("空值 / 空串 / 纯空白一律拒绝", safe(null) === null && safe("") === null && safe("   ") === null);
  ok("前后空白被裁掉", safe("  https://example.com/x  ") === "https://example.com/x");
  ok("相对路径拒绝（不是绝对 URL）", safe("example.com/x") === null && safe("//example.com/x") === null);
  ok("解析不出授权段拒绝", safe("https://") === null && safe("https://a b") === null);

  appUiDone();
})();

/* ---------- P2-A：AI 智能理解（lib/app-ai.js） ---------- */
section("app-ai — 请求 / 归一 / 设置 / 表单合并");
const appAiDone = beginAsyncSection();
(async function () {
  const appAiMod = require(path.join(__dirname, "lib/app-ai.js"));
  const hadFetch = Object.prototype.hasOwnProperty.call(global, "fetch");
  const savedFetch = global.fetch;
  // ⚠️ 假 DOM **不挂到 `global.document`**：本文件里 app-ui 那一段也是异步的，
  //    两段会在 `await` 处交错 —— 挂在全局上，我这段 await 期间 app-ui 恢复的那次
  //    「还原」会被我覆盖、而我这段又会在它恢复后拿到 undefined。
  //    DOM 一律从 `deps.query` 注入，这也是被测模块**只通过依赖拿 DOM** 的证据。

  /* 假 DOM：只造被测代码真正查询的那几个选择器（多一个都算没核对过）。 */
  const byId = Object.create(null);
  const groups = Object.create(null);
  function node(id, group) {
    const cls = new Set();
    const n = {
      id: id, value: "", textContent: "", disabled: false, dataset: {},
      _cls: cls,
      classList: {
        add(c) { cls.add(c); }, remove(c) { cls.delete(c); },
        contains(c) { return cls.has(c); },
        toggle(c, on) { if (on === undefined) on = !cls.has(c); if (on) cls.add(c); else cls.delete(c); return on; }
      }
    };
    byId[id] = n;
    if (group) { groups[group] = groups[group] || []; groups[group].push(n); }
    return n;
  }
  ["capText", "capTrigger", "capDeadline", "capNote", "capTags", "capHint",
    "capRepeat", "capRepeatMode", "capNth", "capWeekday",
    "swAi", "aiBaseUrl", "aiApiKey", "aiModel", "aiSub",
    "btnAiParse", "btnAiPolish"].forEach(id => node(id));
  ["normal", "important", "critical"].forEach(p => {
    const n = node("chip-" + p, "capPriority");
    n.dataset.p = p;
  });
  ["on", "off"].forEach(a => {
    const n = node("auto-" + a, "aiAutoChips");
    n.dataset.auto = a;
  });
  const fakeDoc = {
    querySelector(s) { return s.charAt(0) === "#" ? (byId[s.slice(1)] || null) : null; },
    querySelectorAll(s) {
      const m = /^#(\w+) \.chip(\.on)?$/.exec(s);
      if (!m) return [];
      const list = groups[m[1]] || [];
      return m[2] ? list.filter(x => x._cls.has("on")) : list.slice();
    }
  };

  /* 依赖替身：记录每一次被调用的「外部权力」，好断言 AI 只用了它被给的东西。 */
  const calls = { toast: [], sheet: [], closeSheet: [], renderMe: 0, save: 0, preview: 0, missingConfig: 0 };
  let settings = { ai: { enabled: false, baseUrl: "", apiKey: "", model: "", autoOnSave: false } };
  const deps = {
    getSettings: () => settings,
    setAiConfig: (next) => { settings.ai = next; },
    query: (s) => fakeDoc.querySelector(s),
    queryAll: (s) => fakeDoc.querySelectorAll(s),
    pad: (n) => String(n).padStart(2, "0"),
    toLocalInput: (ts) => (ts == null ? "" : "L" + ts),
    fmtTime: (ts) => "T" + ts,
    fmtDate: (ts) => "D" + ts,
    repeatLabel: (r) => "R:" + r.every,
    parseChineseTime: (t) => ({ trigger: 111, deadline: 222, title: t }),
    updateRepeatPreview: () => { calls.preview += 1; },
    toast: (m) => { calls.toast.push(m); },
    openSheet: (id) => { calls.sheet.push(id); },
    closeSheet: (id) => { calls.closeSheet.push(id); },
    renderMe: () => { calls.renderMe += 1; },
    save: () => { calls.save += 1; },
    onMissingConfig: () => { calls.missingConfig += 1; }
  };

  try {
    /* ① 模块级纯函数 */
    ok("createAppAi 是模块级导出（实例由入口统一装配）", typeof appAiMod.createAppAi === "function");
    ok("归一 / 提取 / 本地 ISO 都是模块级纯函数（不需要实例）",
      typeof appAiMod.normalizeAiResult === "function" &&
      typeof appAiMod.extractJsonObject === "function" &&
      typeof appAiMod.localIsoWithOffset === "function");
    ok("围栏剥离：```json 代码块 + 前后客套话都能剥出 JSON",
      JSON.stringify(appAiMod.extractJsonObject("好的：\n```json\n{\"a\":1}\n```\n希望有用")) === '{"a":1}');
    ok("围栏剥离：只截第一个 { 到最后一个 }",
      JSON.stringify(appAiMod.extractJsonObject("前缀 {\"a\":1} 后缀")) === '{"a":1}');
    ok("围栏剥离：没有 JSON 时**抛出**（不静默返回空对象）",
      (function () { try { appAiMod.extractJsonObject("抱歉我做不到"); return false; } catch (e) { return true; } })());

    const n1 = appAiMod.normalizeAiResult({ priority: "super-urgent", repeat: { every: "yearly" } }, "原话");
    ok("归一：模型自创的优先级被收窄成 normal（越权值不得绕过重要档的渠道规则）",
      n1.priority === "normal");
    ok("归一：白名单外的周期被整体丢弃（不能造一个算不出下一轮的事项）", n1.repeat === null);
    ok("归一：标题空时回落用户原话", n1.title === "原话");
    const n2 = appAiMod.normalizeAiResult(
      { tags: [" a ", "b", "", "c", "d", "e", "f", "g", "h", "i", "j"] }, "x");
    ok("归一：标签去空、trim、截到 8 个", n2.tags.length === 8 && n2.tags[0] === "a");
    const n3 = appAiMod.normalizeAiResult({ trigger_at: "not-a-date", deadline: "2026-09-21T10:00:00" }, "x");
    ok("归一：解析不出的时间是 null（**不兜底成现在**），能解析的保留",
      n3.triggerAt === null && typeof n3.deadlineAt === "number");
    ok("归一：confidence 由**提醒时间**推导，不由模型自评 —— " +
      "只有 deadline 不算「解析出了时间」（否则低置信度确认面板会整体消失）",
      n3.confidence === "low" &&
      appAiMod.normalizeAiResult({ trigger_at: "2026-09-21T09:00:00" }, "x").confidence === "high" &&
      appAiMod.normalizeAiResult({}, "x").confidence === "low");
    const n4 = appAiMod.normalizeAiResult(
      { repeat: { every: "nthWeekday", mode: "ack", nth: -1, dow: 3 } }, "x");
    ok("归一：nthWeekday 的 nth / dow 被转成数字（-1 保留）",
      n4.repeat.nth === -1 && n4.repeat.dow === 3 && n4.repeat.mode === "ack");
    ok("归一：mode 不在 calendar/ack 里一律回落 calendar",
      appAiMod.normalizeAiResult({ repeat: { every: "day", mode: "weird" } }, "x").repeat.mode === "calendar");

    /* ② 工厂：缺依赖必须抛（不静默装一个半残实例） */
    let threw = null;
    try { appAiMod.createAppAi({ getSettings: () => settings }); } catch (e) { threw = e && e.message; }
    ok("缺依赖时 createAppAi **抛错并点名缺哪几项**（不装半残实例）",
      typeof threw === "string" && threw.indexOf("缺少依赖") >= 0 && threw.indexOf("setAiConfig") >= 0,
      String(threw));

    const ai = appAiMod.createAppAi(deps);
    ok("实例交出 15 支 AI API",
      ["config", "ready", "nowIso", "systemPrompt", "chat", "parseCapture", "polishCapture",
        "testConnection", "applyToForm", "mergedDraft", "isBusy", "runOnCapture",
        "openAiSheet", "saveAiSettings", "renderAiSub"].every(k => typeof ai[k] === "function"));
    ok("模块求值不开定时器、不发请求、不读 DOM（装配前 isBusy 为 false、无记录）",
      ai.isBusy() === false && calls.preview === 0 && calls.toast.length === 0);

    /* ③ 设置：三态小字 + 保存走入口给定的那几个出口 */
    ai.renderAiSub();
    ok("未开启 ⇒ 小字说「未开启」", byId.aiSub.textContent.indexOf("未开启") === 0);
    settings.ai = { enabled: true, baseUrl: "https://x/v1", apiKey: "k", model: "m", autoOnSave: false };
    ai.renderAiSub();
    ok("已开启且配全 ⇒ 小字带上模型名与「仅手动」",
      byId.aiSub.textContent.indexOf("已开启 · m") === 0 &&
      byId.aiSub.textContent.indexOf("仅手动") > 0);
    settings.ai = { enabled: true, baseUrl: "", apiKey: "", model: "", autoOnSave: true };
    ai.renderAiSub();
    ok("已开启但没配全 ⇒ 小字提醒「请完善 API 配置」（不是报成可用）",
      byId.aiSub.textContent.indexOf("请完善") > 0);
    ok("ready() 四样齐全才算能用（enabled / baseUrl / apiKey / model 缺一即 false）",
      ai.ready() === false &&
      (settings.ai = { enabled: true, baseUrl: "b", apiKey: "k", model: "m", autoOnSave: false },
        ai.ready() === true));

    byId.swAi._cls.add("on");
    byId.aiBaseUrl.value = " https://api.example.com/v1/ ";
    byId.aiApiKey.value = " sk-x ";
    byId.aiModel.value = " gpt-4o-mini ";
    byId["auto-on"]._cls.add("on");
    ai.saveAiSettings();
    ok("保存：整段写回（不是逐字段 patch），斜杠去掉、空白 trim",
      settings.ai.enabled === true && settings.ai.baseUrl === "https://api.example.com/v1" &&
      settings.ai.apiKey === "sk-x" && settings.ai.model === "gpt-4o-mini" &&
      settings.ai.autoOnSave === true,
      JSON.stringify(settings.ai));
    ok("保存：落库 / 关弹层 / 重渲染「我的」/ 提示，四件事按序发生且各一次",
      calls.save === 1 && calls.closeSheet.length === 1 && calls.closeSheet[0] === "sheetAi" &&
      calls.renderMe === 1 && calls.toast[calls.toast.length - 1] === "AI 已启用",
      JSON.stringify(calls));

    ai.openAiSheet();
    ok("打开设置弹层：每次都从**当前配置**重画（不留弹层里的旧值）",
      calls.sheet[calls.sheet.length - 1] === "sheetAi" &&
      byId.aiBaseUrl.value === "https://api.example.com/v1" &&
      byId.aiModel.value === "gpt-4o-mini" && byId.swAi._cls.has("on"));

    /* ④ 表单合并：applyToForm 写界面，mergedDraft 只写快照 */
    byId.capText.value = "";
    byId.capTags.value = "home";
    byId.capNote.value = "我写的备注";
    ai.applyToForm({
      title: "AI 标题", triggerAt: 1000, deadlineAt: 2000, note: "AI 备注",
      tags: ["work", "home"], priority: "important",
      repeat: { every: "week", mode: "ack" }
    }, "AI 理解");
    ok("applyToForm：标题 / 时间 / 截止都写进表单",
      byId.capText.value === "AI 标题" && byId.capTrigger.value === "L1000" &&
      byId.capDeadline.value === "L2000");
    ok("applyToForm：备注**只在用户没写时**才填（不覆盖人写的上下文）",
      byId.capNote.value === "我写的备注");
    ok("applyToForm：标签是**并集**（用户手打的一个都不丢）",
      byId.capTags.value.split(" ").sort().join(",") === "home,work");
    ok("applyToForm：优先级点亮对应 chip",
      byId["chip-important"]._cls.has("on") && !byId["chip-normal"]._cls.has("on"));
    ok("applyToForm：周期写进 select 并**刷新预览**",
      byId.capRepeat.value === "week" && byId.capRepeatMode.value === "ack" && calls.preview === 1);
    ok("applyToForm：提示行以「 · 可修改」收尾（结果不是判决）",
      byId.capHint.textContent.indexOf("AI 理解：T1000") === 0 &&
      byId.capHint.textContent.indexOf(" · 截止 D2000") > 0 &&
      byId.capHint.textContent.indexOf(" · R:week") > 0 &&
      / · 可修改$/.test(byId.capHint.textContent),
      byId.capHint.textContent);

    const base = { text: "orig", tags: "home", note: "   ", trigger: "", deadline: "" };
    const merged = ai.mergedDraft(base, {
      title: "ai-title", triggerAt: 1000, deadlineAt: 2000, note: "ai-note",
      tags: ["work"], priority: "critical", repeat: { every: "nthWeekday", mode: "ack", nth: 2, dow: 5 }
    });
    ok("mergedDraft：合出了 AI 结果（标题 / 时间 / 截止 / 优先级 / 周期）",
      merged.text === "ai-title" && merged.trigger === "L1000" && merged.deadline === "L2000" &&
      merged.priority === "critical" && merged.repeat === "nthWeekday" &&
      merged.nth === "2" && merged.weekday === "5",
      JSON.stringify(merged));
    ok("mergedDraft：**纯的** —— 提交时冻结的那份草稿一个字都没被改",
      base.text === "orig" && base.tags === "home" && base.note === "   " && !("priority" in base),
      JSON.stringify(base));
    ok("mergedDraft：标签并集（work + home）",
      String(merged.tags).split(" ").sort().join(",") === "home,work");
    ok("mergedDraft：备注**只在原快照为空时**填（空白串算空）", merged.note === "ai-note");

    /* ⑤ 请求：URL / 头 / body 形状，以及 HTTP 错误**原样冒上去** */
    const sent = [];
    let nextRes = { ok: true, json: async () => ({ choices: [{ message: { content: '{"title":"t"}' } }] }) };
    global.fetch = async (url, init) => { sent.push({ url: url, init: init }); return nextRes; };
    const r1 = await ai.parseCapture("明天九点开会");
    ok("请求：baseUrl 的尾斜杠被去掉后再拼 /chat/completions",
      sent[0].url === "https://api.example.com/v1/chat/completions", sent[0].url);
    ok("请求：Authorization 头是 Bearer + key，Content-Type 是 JSON",
      sent[0].init.headers.Authorization === "Bearer sk-x" &&
      sent[0].init.headers["Content-Type"] === "application/json");
    ok("请求：system prompt 带本地时钟，并在 systemExtra 里写明任务类型",
      JSON.parse(sent[0].init.body).messages[0].content.indexOf("当前本地时间 ISO") >= 0 &&
      JSON.parse(sent[0].init.body).messages[0].content.indexOf("capture_parse") >= 0);
    ok("请求：temperature 0.1 与 model 都来自配置",
      JSON.parse(sent[0].init.body).temperature === 0.1 &&
      JSON.parse(sent[0].init.body).model === "gpt-4o-mini");
    ok("解析结果走同一套归一（标题来自模型）", r1.title === "t");
    await ai.polishCapture("明天九点开会");
    ok("润色用的是另一段 systemExtra（polish）",
      JSON.parse(sent[1].init.body).messages[0].content.indexOf("polish") >= 0);
    await ai.testConnection();
    ok("连通性测试：只求能通（max_tokens 8 + ping），端点同样是 /chat/completions",
      sent[2].url === "https://api.example.com/v1/chat/completions" &&
      JSON.parse(sent[2].init.body).max_tokens === 8 &&
      JSON.parse(sent[2].init.body).messages[0].content === "ping");

    nextRes = { ok: false, status: 401, text: async () => "invalid api key" };
    let httpErr = null;
    try { await ai.testConnection(); } catch (e) { httpErr = e && e.message; }
    ok("HTTP 错误**原样冒上去**（带状态码与响应片段），不吞成一句「AI 不可用」",
      typeof httpErr === "string" && httpErr.indexOf("HTTP 401") === 0 &&
      httpErr.indexOf("invalid api key") > 0, String(httpErr));
    nextRes = { ok: true, json: async () => ({ choices: [] }) };
    let emptyErr = null;
    try { await ai.parseCapture("x"); } catch (e) { emptyErr = e && e.message; }
    ok("空返回抛「AI 返回为空」（不静默当成解析成功）", emptyErr === "AI 返回为空", String(emptyErr));

    /* ⑥ runOnCapture：本地解析先行、busy 闸门、按钮 busy 还原、失败回退文案 */
    byId.capText.value = "明天九点开会";
    byId.capTrigger.value = "";
    byId.capHint.textContent = "";
    nextRes = { ok: true, json: async () => ({ choices: [{ message: { content: '{"title":"AI 标题","trigger_at":"2026-09-21T09:00:00"}' } }] }) };
    const sentBefore = sent.length;
    const flying = ai.runOnCapture("parse");
    ok("runOnCapture：请求在途时 isBusy() 为 true（这是**唯一**的在途闸门）", ai.isBusy() === true);
    ok("runOnCapture：按钮被置成「思考中」并 disabled",
      byId.btnAiParse.textContent === "✦ 思考中…" && byId.btnAiParse.disabled === true);
    ok("runOnCapture：**先落本地解析**（等待期间界面不是空的）",
      byId.capTrigger.value === "L111" && byId.capDeadline.value === "L222");
    const secondCall = ai.runOnCapture("parse");
    ok("runOnCapture：在途期间的第二次调用**立刻返回**且 busy 仍为真（闸门没被绕过）",
      ai.isBusy() === true);
    await flying;
    await secondCall;
    ok("runOnCapture：在途期间的第二次调用**没有再发请求**（连点不会叠加两次结果）",
      sent.length === sentBefore + 1,
      JSON.stringify({ sentBefore: sentBefore, sentAfter: sent.length }));
    ok("runOnCapture：整个连点过程只填了一次表单（没有第二次结果覆盖第一次）",
      byId.capText.value === "AI 标题", byId.capText.value);
    ok("runOnCapture：完成后 busy 复位、按钮文案与 disabled 还原",
      ai.isBusy() === false && byId.btnAiParse.disabled === false &&
      byId.btnAiParse.textContent === "");
    ok("runOnCapture：AI 结果真的填进了表单",
      byId.capText.value === "AI 标题", byId.capText.value);

    nextRes = { ok: false, status: 500, text: async () => "upstream down" };
    await ai.runOnCapture("parse");
    ok("runOnCapture：失败时按钮**仍然**还原（finally 无条件复位，失败也能再按一次）",
      ai.isBusy() === false && byId.btnAiParse.disabled === false);
    ok("runOnCapture：失败提示写明「已用本地解析」并带上原因",
      byId.capHint.textContent.indexOf("AI 暂不可用，已用本地解析") === 0 &&
      byId.capHint.textContent.indexOf("HTTP 500") > 0, byId.capHint.textContent);

    byId.capText.value = "";
    await ai.runOnCapture("parse");
    ok("runOnCapture：空输入不发请求（提示「先写一句话吧」）",
      calls.toast[calls.toast.length - 1] === "先写一句话吧");
    settings.ai = { enabled: false, baseUrl: "", apiKey: "", model: "", autoOnSave: false };
    byId.capText.value = "有事";
    await ai.runOnCapture("parse");
    ok("runOnCapture：没配置时不发请求，提示去配置并跳过去（跳转由入口编排，模块只回调）",
      calls.toast[calls.toast.length - 1].indexOf("开启并配置") > 0 && calls.missingConfig === 1);
  } finally {
    if (hadFetch) global.fetch = savedFetch; else delete global.fetch;
  }

  appAiDone();
})();

/* ---------- P2-C：导入可靠性（lib/app-backup.js，独立复验 G01/G02 修复） ---------- */
section("app-backup — 导入的读取失败反馈与「成功 = 提交已兑现」");
const appBackupDone = beginAsyncSection();
(async function () {
  const appBackupMod = require(path.join(__dirname, "lib/app-backup.js"));

  // 假 FileReader：只实现被测代码真正用的四个成员。不挂 `global` 的恢复交给
  // 段尾 finally —— 其它异步段不碰 FileReader，这里没有交错风险。
  const hadFileReader = Object.prototype.hasOwnProperty.call(global, "FileReader");
  const savedFileReader = global.FileReader;
  function FakeFileReader() {
    this.onload = null; this.onerror = null; this.onabort = null;
  }
  FakeFileReader.last = null;
  FakeFileReader.prototype.readAsText = function () { FakeFileReader.last = this; };
  global.FileReader = FakeFileReader;

  /* 依赖替身：save 是**可控的权威提交** —— 挂住 / 兑现 / 拒绝三态都能演。 */
  const calls = { toast: [], render: 0, confirm: 0 };
  const state = { items: [], notes: [], projects: [], settings: {} };
  let saveImpl = async () => {};
  const deps = {
    getSchema: () => 5,
    getState: () => state,
    normalizeItem: (x) => Object.assign({}, x),
    save: () => saveImpl(),
    render: () => { calls.render += 1; },
    toast: (m) => { calls.toast.push(m); },
    confirmDialog: async () => { calls.confirm += 1; return true; },
    query: () => null,
    isNativeAndroidRuntime: () => false,
    systemBridge: () => null,
    getInflightActionDepth: () => 0
  };
  const backup = appBackupMod.createAppBackup(deps);

  function lastToast() { return calls.toast[calls.toast.length - 1] || ""; }
  /**
   * 合法整库备份（P2-C-S 之后这是唯一能进确认框的形状）。
   *
   * 为什么 G01/G02 的载荷必须升级：本批次之前，`importDataFile()` 只检查
   * `Array.isArray(data.items)`，所以三段用例喂的是 `{ items: [...] }` 这种
   * **半截文件**。格式契约落地后这类文件会被整体拒绝（那正是本轮要证明的事），
   * 因此这里补上 app / schema / exportedAt / notes / projects / settings
   * —— 让 G01/G02 继续只考「读取失败反馈」与「成功＝提交已兑现」。
   *
   * ⚠️ 覆盖是**字段级**替换，不做深合并：改动某一项时其余键保持合法。
   */
  function validPayload(overrides) {
    const payload = {
      app: "attention-inbox",
      schema: 5,
      exportedAt: "2026-09-22T08:00:00.000Z",
      items: [{ id: "a", title: "A", status: "waiting" }],
      notes: [],
      projects: [],
      settings: {
        notify: true, dnd: false, importantRepeat: true, quietStart: "22:00", quietEnd: "07:00",
        dailySummary: false, privacyNotify: true, defaultDeliveryMode: "notification",
        userMode: "beginner",
        ai: { enabled: false, baseUrl: "", apiKey: "", model: "m", autoOnSave: false }
      }
    };
    if (!overrides) return payload;
    if (overrides.app !== undefined) payload.app = overrides.app;
    if (overrides.schema !== undefined) payload.schema = overrides.schema;
    if (overrides.exportedAt !== undefined) payload.exportedAt = overrides.exportedAt;
    if (overrides.items) payload.items = overrides.items;
    if (overrides.notes) payload.notes = overrides.notes;
    if (overrides.projects) payload.projects = overrides.projects;
    if (overrides.settings) payload.settings = Object.assign(payload.settings, overrides.settings);
    return payload;
  }
  function importPayload(payload) {
    backup.importDataFile({ name: "backup.json" });
    FakeFileReader.last.result = JSON.stringify(payload);
    FakeFileReader.last.onload();
  }

  try {
    /* G02 ①：提交挂住时**不许**报成功 —— 这是「成功 = 提交已兑现」的核心反例，
       拔掉 `await deps.save()` 这条立即变红（旧实现同步路径里 toast 先出现）。 */
    let releaseSave;
    saveImpl = () => new Promise(resolve => { releaseSave = resolve; });
    importPayload(validPayload());
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    ok("导入：提交在途时不出现「导入成功」，也不提前渲染",
      calls.toast.indexOf("导入成功 · 1 条事项") < 0 && calls.render === 0,
      JSON.stringify({ toasts: calls.toast, render: calls.render }));
    releaseSave();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await new Promise(r => setTimeout(r, 0));
    ok("导入：提交兑现**之后**才渲染并报成功（条数来自归一后的清单）",
      calls.render === 1 && lastToast() === "导入成功 · 1 条事项",
      JSON.stringify({ toasts: calls.toast, render: calls.render }));

    /* G02 ②：提交拒绝 ⇒ 报「未能保存」而不是成功，更不能落进「格式不正确」
       的误导文案 —— 文件本身是好的。 */
    saveImpl = async () => { throw new Error("idb write failed"); };
    importPayload(validPayload({ items: [{ id: "b", title: "B" }, { id: "c", title: "C" }] }));
    await new Promise(r => setTimeout(r, 0));
    ok("导入：提交失败报「数据未能保存」，不报成功、不误报格式错误",
      lastToast() === "导入失败 · 数据未能保存，请重新导入",
      JSON.stringify(calls.toast));
    ok("导入：提交失败时内存状态保留（与保存失败路径同一语义，不清空）",
      state.items.length === 2 && calls.confirm === 2);

    /* G02 ③：正常路径仍是老语义 —— 成功提示文案与条数逐字保持。 */
    saveImpl = async () => {};
    importPayload(validPayload({
      items: [{ id: "d", title: "D" }], notes: [{ id: "n" }], projects: [{ id: "p", name: "P" }]
    }));
    await new Promise(r => setTimeout(r, 0));
    ok("导入：提交成功后渲染 + 成功提示（文案逐字保持）",
      calls.render === 2 && lastToast() === "导入成功 · 1 条事项" &&
      state.notes.length === 1 && state.projects.length === 1);

    /* G01 ④：读取失败必须有反馈 —— 旧实现没有 onerror，这条拔掉即红。 */
    backup.importDataFile({ name: "broken.json" });
    FakeFileReader.last.onerror();
    ok("导入：读取失败给出明确反馈（不是「点了没反应」）",
      lastToast() === "导入失败：文件读取失败，请重试" && calls.render === 2);
    backup.importDataFile({ name: "broken.json" });
    FakeFileReader.last.onabort();
    ok("导入：读取中止同样给出反馈",
      lastToast() === "导入失败 · 文件读取已取消" && calls.render === 2);
    ok("导入：读取失败/中止不触发确认框、不触发提交（反馈止步在读取层）",
      calls.confirm === 3);

    /* ==================================================================
     * P2-C-S：整库导入格式安全面
     * ==================================================================
     * 独立诊断 `20260922T124205-independent-import-format-audit` 的 18 组反例
     * 在本段逐条转正：**格式不满足契约的文件必须在任何可见/可写副作用之前被拒**，
     * 而「拒绝得干净」的判据只有一条（`verifyRejectCase`），正式断言与四个变异共用它。
     *
     * 位置说明（重要）：这一段**必须**留在同一个异步段内 —— 它同样要替换
     * `global.FileReader`，另起一个异步段会与本段在 await 点交错、互相踩。
     */
    section("app-backup — P2-C-S 整库导入格式安全面");
    const fs = require("fs");
    const os = require("os");
    const CONTRACT = appBackupMod.BACKUP_CONTRACT;

    /**
     * 一次真实导入：只走注入依赖，**每一项副作用都记账**。
     * `ledger.effects` 只记「会改变世界」的调用（toast / confirm / save / render /
     * normalizeItem / query / 平台分支），读取类（getSchema / getState）单独计数 ——
     * 于是「拒绝时只有一次 toast」才能被断言成事实，而不是看起来像。
     */
    function runImport(mod, mutate, options) {
      options = options || {};
      const limit = options.schemaLimit === undefined ? 5 : options.schemaLimit;
      let payload = null;
      let payloadText = null;
      if (options.rawText) {
        // 有些形状（顶层 `__proto__`）只有经 `JSON.parse` 才会成为**自有**属性 ——
        // 在对象字面量上写它改的是原型，测不到要测的那条路。
        payloadText = options.rawText;
      } else {
        payload = validPayload();
        payload.items = [{ id: "new-item", title: "新事项", status: "waiting" }];
        payload.notes = [{ id: "new-note", text: "新备注", createdAt: 2 }];
        payload.projects = [{ id: "new-project", name: "新项目", color: "#fff" }];
        if (mutate) mutate(payload);
        payloadText = JSON.stringify(payload);
      }
      const verdict = (function () {
        try {
          return mod.validateBackupPayload(JSON.parse(payloadText), limit);
        } catch (parseError) {
          return null;   // 非 JSON：验证器根本不会被调用（解析层就失败了）
        }
      })();
      const ledger = {
        effects: [], confirm: 0, save: 0, render: 0, normalize: 0,
        getSchema: 0, getState: 0, inflight: 0
      };
      const toasts = [];
      const confirmArgs = [];
      const state = {
        items: [{ id: "old-item", title: "保留事项" }],
        notes: [{ id: "old-note", text: "保留备注" }],
        projects: [{ id: "old-project", name: "保留项目", color: "#000" }],
        settings: {
          notify: false,
          review: { enabled: true, hour: 21 },
          onboardDone: true,
          userMode: "beginner",
          ai: {
            enabled: true, baseUrl: "https://local.example/v1", apiKey: "local-secret",
            model: "local-model", autoOnSave: false
          }
        }
      };
      const before = JSON.stringify(state);
      const deps = {
        getSchema: () => { ledger.getSchema += 1; return limit; },
        getState: () => { ledger.getState += 1; return state; },
        normalizeItem: (it) => { ledger.normalize += 1; ledger.effects.push("normalizeItem"); return Object.assign({}, it); },
        save: () => {
          ledger.save += 1; ledger.effects.push("save");
          return options.saveResult ? options.saveResult() : Promise.resolve();
        },
        render: () => { ledger.render += 1; ledger.effects.push("render"); },
        toast: (m) => { ledger.effects.push("toast"); toasts.push(m); },
        confirmDialog: (msg, title) => {
          ledger.confirm += 1; ledger.effects.push("confirm");
          confirmArgs.push([msg, title]);
          return Promise.resolve(options.confirm !== false);
        },
        query: (sel) => { ledger.effects.push("query:" + sel); return null; },
        isNativeAndroidRuntime: () => { ledger.effects.push("isNativeAndroidRuntime"); return false; },
        systemBridge: () => { ledger.effects.push("systemBridge"); return null; },
        getInflightActionDepth: () => { ledger.inflight += 1; return options.inflight || 0; }
      };
      const api = mod.createAppBackup(deps);
      api.importDataFile({ name: "backup.json" });
      const reader = FakeFileReader.last;
      reader.result = payloadText;
      const done = reader.onload();
      return { payload, payloadText, verdict, ledger, toasts, confirmArgs, state, before, done };
    }

    /**
     * **唯一判据**：坏文件必须被干净地拒绝 ——
     *   · 验证器给出预期的 code/path（错误点不是「一条通用文案」）；
     *   · 没有弹确认框（`confirm=0`）；
     *   · state 的形态字节前后相同，而且**根本没被读过**（`getState=0`）；
     *   · 没有提交、没有渲染、没有归一、没有平台分支；
     *   · 副作用清单**恰好**是一次 toast。
     */
    function verifyRejectCase(mod, spec) {
      const run = runImport(mod, spec.mutate, spec.options);
      const v = run.verdict;
      const detail = {
        code: v && v.code, path: v && v.path,
        confirm: run.ledger.confirm, save: run.ledger.save, render: run.ledger.render,
        normalize: run.ledger.normalize, getState: run.ledger.getState,
        effects: run.ledger.effects, toasts: run.toasts,
        stateChanged: JSON.stringify(run.state) !== run.before
      };
      const pass = !!v && v.ok === false &&
        v.code === spec.code && v.path === spec.path &&
        run.ledger.confirm === 0 && run.ledger.save === 0 && run.ledger.render === 0 &&
        run.ledger.normalize === 0 && run.ledger.getState === 0 &&
        JSON.stringify(run.state) === run.before &&
        run.ledger.effects.length === 1 && run.ledger.effects[0] === "toast" &&
        run.toasts.length === 1;
      return { pass: pass, run: run, detail: detail };
    }

    /* ---------- 反例矩阵（身份 / 版本 / 顶层 / 容器 / 记录 / 事件 / 设置） ---------- */
    const REJECT_CASES = [
      // 身份与版本
      ["不是本应用的备份（app = other-app）", p => { p.app = "other-app"; }, "app-mismatch", "app"],
      ["缺少 app 标识", p => { delete p.app; }, "app-missing", "app"],
      ["缺少 schema", p => { delete p.schema; }, "schema-missing", "schema"],
      ["schema 是字符串", p => { p.schema = "5"; }, "schema-type", "schema"],
      ["schema 是浮点", p => { p.schema = 5.5; }, "schema-type", "schema"],
      ["schema 过旧（1）", p => { p.schema = 1; }, "schema-too-old", "schema"],
      ["schema 是未来版本（当前 + 1）", p => { p.schema = 6; }, "schema-too-new", "schema"],
      ["schema 是未来版本（999）", p => { p.schema = 999; }, "schema-too-new", "schema"],
      ["当前版本号取不到（getSchema 坏掉）", () => {}, "schema-limit-unavailable", "schema",
        { schemaLimit: null }],
      // 顶层与容器
      ["顶层缺 items", p => { delete p.items; }, "missing-key", "items"],
      ["顶层缺 notes（旧代码会静默清空笔记）", p => { delete p.notes; }, "missing-key", "notes"],
      ["顶层缺 projects（旧代码会静默清空项目）", p => { delete p.projects; }, "missing-key", "projects"],
      ["顶层缺 settings", p => { delete p.settings; }, "missing-key", "settings"],
      ["顶层未知字段", p => { p.injected = "persist-me"; }, "unknown-key", "injected"],
      ["items 是对象", p => { p.items = { id: "x" }; }, "container-type", "items"],
      ["notes 是对象（旧代码会静默清空笔记）", p => { p.notes = { id: "x" }; }, "container-type", "notes"],
      ["projects 是对象", p => { p.projects = { id: "x" }; }, "container-type", "projects"],
      ["settings 是数组", p => { p.settings = ["x"]; }, "container-type", "settings"],
      ["exportedAt 缺失", p => { delete p.exportedAt; }, "missing-key", "exportedAt"],
      ["exportedAt 没有时区", p => { p.exportedAt = "2026-09-22T08:00:00"; }, "time-format", "exportedAt"],
      ["exportedAt 不可解析", p => { p.exportedAt = "昨天下午"; }, "time-format", "exportedAt"],
      // 记录与身份
      ["item 是 null", p => { p.items = [null]; }, "record-type", "items[0]"],
      ["item 是数字", p => { p.items = [7]; }, "record-type", "items[0]"],
      ["item 是数组", p => { p.items = [[]]; }, "record-type", "items[0]"],
      ["item 是空对象", p => { p.items = [{}]; }, "id-invalid", "items[0].id"],
      ["item 缺 id", p => { delete p.items[0].id; }, "id-invalid", "items[0].id"],
      ["item id 是空串", p => { p.items[0].id = ""; }, "id-invalid", "items[0].id"],
      ["item id 非字符串", p => { p.items[0].id = 7; }, "id-invalid", "items[0].id"],
      ["item 缺 title", p => { delete p.items[0].title; }, "title-invalid", "items[0].title"],
      ["item title 是空串", p => { p.items[0].title = ""; }, "title-invalid", "items[0].title"],
      ["item title 非字符串", p => { p.items[0].title = 7; }, "title-invalid", "items[0].title"],
      ["items 重复 id", p => { p.items = [{ id: "dup", title: "A" }, { id: "dup", title: "B" }]; },
        "duplicate-id", "items[1].id"],
      ["notes 重复 id", p => { p.notes = [{ id: "dup", text: "A" }, { id: "dup", text: "B" }]; },
        "duplicate-id", "notes[1].id"],
      ["projects 重复 id", p => { p.projects = [{ id: "dup", name: "A" }, { id: "dup", name: "B" }]; },
        "duplicate-id", "projects[1].id"],
      ["note 是 null", p => { p.notes = [null]; }, "record-type", "notes[0]"],
      ["project 缺 name", p => { p.projects = [{ id: "p" }]; }, "name-invalid", "projects[0].name"],
      // 未知字段（覆盖式恢复不允许「静默忽略」）
      ["item 未知字段", p => { p.items[0].mystery = 1; }, "unknown-key", "items[0].mystery"],
      ["note 未知字段", p => { p.notes[0].mystery = 1; }, "unknown-key", "notes[0].mystery"],
      ["project 未知字段", p => { p.projects[0].mystery = 1; }, "unknown-key", "projects[0].mystery"],
      ["顶层 __proto__ 键（原型链不算已知字段）", null, "unknown-key", "__proto__"],
      // 字段类型 / 枚举 / 嵌套
      ["tags 不是数组", p => { p.items[0].tags = "home"; }, "field-type", "items[0].tags"],
      ["tags 含非字符串", p => { p.items[0].tags = ["home", 7]; }, "field-type", "items[0].tags[1]"],
      ["时间字段是字符串", p => { p.items[0].triggerAt = "2026-09-22"; }, "field-type", "items[0].triggerAt"],
      ["时间字段为负", p => { p.items[0].deadlineAt = -1; }, "field-type", "items[0].deadlineAt"],
      ["计数为负", p => { p.items[0].snoozeCount = -1; }, "field-type", "items[0].snoozeCount"],
      ["计数是小数", p => { p.items[0].remindCount = 1.5; }, "field-type", "items[0].remindCount"],
      ["rev 为 0（会让版本校验整体失效）", p => { p.items[0].rev = 0; }, "field-type", "items[0].rev"],
      ["布尔字段是字符串", p => { p.items[0].deadlinePaused = "yes"; }, "field-type", "items[0].deadlinePaused"],
      ["priority 非法枚举", p => { p.items[0].priority = "super-urgent"; }, "enum-invalid", "items[0].priority"],
      ["status 非法枚举", p => { p.items[0].status = "exploded"; }, "enum-invalid", "items[0].status"],
      ["review_status 非法枚举", p => { p.items[0].review_status = "MAYBE"; }, "enum-invalid", "items[0].review_status"],
      ["delivery_mode 非法枚举", p => { p.items[0].delivery_mode = "sms"; }, "enum-invalid", "items[0].delivery_mode"],
      ["scheduleBasis 非法枚举", p => { p.items[0].scheduleBasis = "moon"; }, "enum-invalid", "items[0].scheduleBasis"],
      ["repeat 错型", p => { p.items[0].repeat = "daily"; }, "field-type", "items[0].repeat"],
      ["repeat.every 未知", p => { p.items[0].repeat = { every: "yearly", mode: "calendar" }; },
        "enum-invalid", "items[0].repeat.every"],
      ["repeat.mode 未知", p => { p.items[0].repeat = { every: "day", mode: "sometimes" }; },
        "enum-invalid", "items[0].repeat.mode"],
      ["repeat 未知字段", p => { p.items[0].repeat = { every: "day", mode: "calendar", rrule: "FREQ=DAILY" }; },
        "unknown-key", "items[0].repeat.rrule"],
      ["reminderEvents 是数组", p => { p.items[0].reminderEvents = []; }, "field-type", "items[0].reminderEvents"],
      ["reminderEvents 状态未知", p => { p.items[0].reminderEvents = { k: { at: 1, state: "bogus" } }; },
        "enum-invalid", 'items[0].reminderEvents["k"].state'],
      ["reminderEvents 条目未知字段",
        p => { p.items[0].reminderEvents = { k: { at: 1, state: "scheduled", extra: 1 } }; },
        "unknown-key", 'items[0].reminderEvents["k"].extra'],
      ["deadlineEvents 是字符串", p => { p.items[0].deadlineEvents = "{}"; }, "field-type", "items[0].deadlineEvents"],
      ["deadlineEvents 状态未知", p => { p.items[0].deadlineEvents = { "p24@1": { at: 1, state: "bogus" } }; },
        "enum-invalid", 'items[0].deadlineEvents["p24@1"].state'],
      // settings
      ["settings 未知键", p => { p.settings.injected = "persist-me"; }, "unknown-key", "settings.injected"],
      ["settings.notify 错型", p => { p.settings.notify = "true"; }, "field-type", "settings.notify"],
      ["settings.quietStart 错型", p => { p.settings.quietStart = 2200; }, "field-type", "settings.quietStart"],
      ["settings.defaultDeliveryMode 非法枚举", p => { p.settings.defaultDeliveryMode = "sms"; },
        "enum-invalid", "settings.defaultDeliveryMode"],
      ["settings.userMode 非法枚举", p => { p.settings.userMode = "expert"; }, "enum-invalid", "settings.userMode"],
      ["settings.ai 是数组", p => { p.settings.ai = []; }, "field-type", "settings.ai"],
      ["settings.ai 是 null", p => { p.settings.ai = null; }, "field-type", "settings.ai"],
      ["settings.ai 未知键", p => { p.settings.ai.injected = 1; }, "unknown-key", "settings.ai.injected"],
      ["settings.ai.apiKey 非空（禁止用备份注入密钥）",
        p => { p.settings.ai.apiKey = "sk-live-injected"; }, "ai-credential-not-empty", "settings.ai.apiKey"],
      ["settings.ai.baseUrl 非空（禁止用备份改请求终点）",
        p => { p.settings.ai.baseUrl = "http://evil.invalid/v1"; }, "ai-credential-not-empty", "settings.ai.baseUrl"],
      ["settings.ai.enabled 错型", p => { p.settings.ai.enabled = "yes"; }, "field-type", "settings.ai.enabled"]
    ];

    for (let i = 0; i < REJECT_CASES.length; i++) {
      const spec = REJECT_CASES[i];
      const options = Object.assign({}, spec[4]);
      if (spec[1] === null) {
        // 顶层 `__proto__`：经 `JSON.parse` 才是**自有**属性 —— 原型链上不算已知字段
        options.rawText = '{"__proto__":{"polluted":true},"app":"attention-inbox","schema":5,' +
          '"exportedAt":"2026-09-22T08:00:00.000Z","items":[{"id":"new-item","title":"X"}],' +
          '"notes":[],"projects":[],"settings":{}}';
      }
      const judged = verifyRejectCase(appBackupMod, {
        mutate: spec[1], code: spec[2], path: spec[3], options: options
      });
      if (judged.run.done && typeof judged.run.done.then === "function") await judged.run.done;
      ok("反例：" + spec[0] + " ⇒ " + spec[2] + " @ " + spec[3],
        judged.pass, JSON.stringify(judged.detail));
    }
    ok("反例总账：上述 " + REJECT_CASES.length + " 组全部「零副作用拒绝」（确认框 0 / 提交 0 / 渲染 0 / 归一 0 / 未曾读 state / 仅一次 toast）",
      true);

    /* ---------- 非 JSON 场景：直接喂验证器（NaN / Infinity / 原型键） ---------- */
    const direct = appBackupMod.validateBackupPayload;
    const nanPayload = JSON.parse(JSON.stringify(validPayload()));
    nanPayload.items[0].triggerAt = NaN;
    ok("直测：时间字段是 NaN ⇒ field-type @ items[0].triggerAt（NaN 不是有限数字）",
      direct(nanPayload, 5).code === "field-type" && direct(nanPayload, 5).path === "items[0].triggerAt",
      JSON.stringify(direct(nanPayload, 5)));
    const infPayload = JSON.parse(JSON.stringify(validPayload()));
    infPayload.items[0].snoozeCount = Infinity;
    ok("直测：计数是 Infinity ⇒ field-type @ items[0].snoozeCount",
      direct(infPayload, 5).code === "field-type" && direct(infPayload, 5).path === "items[0].snoozeCount");
    const protoOwn = JSON.parse('{"__proto__":{"a":1},"app":"attention-inbox","schema":5,' +
      '"exportedAt":"2026-09-22T08:00:00.000Z","items":[],"notes":[],"projects":[],"settings":{}}');
    ok("直测：`__proto__` 被当成未知自有键拒绝（不靠原型链判定）",
      Object.keys(protoOwn).indexOf("__proto__") >= 0 &&
      direct(protoOwn, 5).code === "unknown-key" && direct(protoOwn, 5).path === "__proto__");
    ok("直测：根是数组 / null / 字符串 ⇒ root-type",
      direct([], 5).code === "root-type" && direct(null, 5).code === "root-type" &&
      direct("{}", 5).code === "root-type");

    /* ---------- 契约自身：字段集合不许与产品代码漂移 ---------- */
    const appModelSrc = fs.readFileSync(path.join(__dirname, "lib/app-model.js"), "utf8");
    const normalizeBlock = /const item = \{[\s\S]*?\n      \};/.exec(appModelSrc);
    const normalizeKeys = normalizeBlock
      ? (normalizeBlock[0].match(/\b([A-Za-z_$][\w$]*):/g) || [])
        .map(line => line.trim().replace(/:$/, ""))
      : [];
    const sortedNormalizeKeys = normalizeKeys.slice().sort().join(",");
    const sortedContractKeys = CONTRACT.itemKeys.slice().sort().join(",");
    ok("契约闭合：ITEMS 允许字段集合 == app-model normalizeItem() 返回的字段集合（" +
      normalizeKeys.length + " 项，逐项相等）",
      normalizeKeys.length === CONTRACT.itemKeys.length && sortedNormalizeKeys === sortedContractKeys,
      JSON.stringify({ normalizeOnly: normalizeKeys.filter(k => CONTRACT.itemKeys.indexOf(k) < 0),
        contractOnly: CONTRACT.itemKeys.filter(k => normalizeKeys.indexOf(k) < 0) }));

    /* ---------- 正向：真实快照可回环 ---------- */
    /**
     * 真实 schema 5 事项（字段集合取自设备真实备份形状），逐字段给合法值 ——
     * 用它证明「我们自己的导出能被我们自己的契约接受」，而不是只用最小对象糊过去。
     */
    const REAL_ITEM = {
      id: "it_real", title: "读一读契约", note: "note", tags: ["home"],
      url: "https://example.com/a", projectId: "p_real", priority: "important",
      status: "snoozed", triggerAt: 1790000000000, windowStart: null, windowEnd: null,
      deadlineAt: 1790003600000, repeat: { every: "week", mode: "calendar" },
      createdAt: 1789990000000, acknowledgedAt: null, completedAt: null, snoozeCount: 2,
      deliveredAt: 1790000000000, remindCount: 1, lastRemindAt: 1790000000000,
      lastAlertShownAt: null, scheduleBasis: "wall-clock", localTrigger: "2026-09-22T10:00:00",
      snoozedAt: 1790000000000, snoozeDelayMs: 600000, dismissedUntil: null,
      review_status: "NEEDS_REVIEW", reviewed_at: null, sourceTitle: "", sourceApp: "",
      delivery_mode: "alarm", isFallbackTrigger: false, deadlineStageKey: "p24@1790003600000",
      deadlineEvents: { "p24@1790003600000": { at: 1790000000000, state: "scheduled" } },
      reminderEvents: {
        "1@1790000000000": { at: 1790000000000, state: "delivered", roundBase: 1790000000000,
          receivedAt: 1790000001000, carrier: "notification", level: "received", source: "native" },
        "2@1790000000000": { at: 1790000000000, state: "suppressed", suppressedAt: 1790000002000 }
      },
      deadlinePaused: false, ackAdvancedAt: null, rev: 3, seriesId: "s_real",
      repeatParentId: null
    };
    ok("正向对照：真实 schema 5 事项的字段集合与契约字段集合逐一相等",
      Object.keys(REAL_ITEM).sort().join(",") === sortedContractKeys,
      JSON.stringify({ extra: Object.keys(REAL_ITEM).filter(k => CONTRACT.itemKeys.indexOf(k) < 0),
        missing: CONTRACT.itemKeys.filter(k => !(k in REAL_ITEM)) }));

    const roundTripState = {
      items: [REAL_ITEM],
      notes: [
        { id: "n_old", text: "旧形态备注", createdAt: 1 },
        { id: "n_new", title: "新形态", body: "正文", projectId: "p_real", pinned: true,
          createdAt: 2, updatedAt: 3 }
      ],
      projects: [{ id: "p_real", name: "项目", color: "#6b7280" }],
      settings: {
        notify: true, dnd: false, importantRepeat: true, quietStart: "23:00", quietEnd: "07:30",
        dailySummary: false, privacyNotify: false, defaultDeliveryMode: "notification",
        userMode: "beginner",
        ai: { enabled: true, baseUrl: "https://local.example/v1", apiKey: "local-secret",
          model: "local-model", autoOnSave: true }
      }
    };
    const exporter = appBackupMod.createAppBackup(Object.assign({}, deps, {
      getState: () => roundTripState,
      getSchema: () => 5
    }));
    const snapshot = exporter.buildLegacyBackupPayload();
    const snapshotVerdict = direct(JSON.parse(JSON.stringify(snapshot)), 5);
    ok("回环：buildLegacyBackupPayload() 的真实快照能被自己的契约接受（导出侧与导入侧同一份真相）",
      snapshotVerdict.ok === true, JSON.stringify(snapshotVerdict));
    ok("回环：导出外壳的键集合 == 契约顶层键集合；settings 键集合 == 契约白名单（含密钥被脱敏成空串）",
      Object.keys(snapshot).sort().join(",") === CONTRACT.topLevelKeys.slice().sort().join(",") &&
      Object.keys(snapshot.settings).sort().join(",") === CONTRACT.settingKeys.slice().sort().join(",") &&
      snapshot.settings.ai.apiKey === "" && snapshot.settings.ai.baseUrl === "");
    ok("回环：真实快照里的密钥未被带出去（导出侧脱敏），而本机状态里的密钥没被改动",
      roundTripState.settings.ai.apiKey === "local-secret" &&
      JSON.stringify(snapshot).indexOf("local-secret") < 0);

    /* ---------- 正向：schema 2 / 3 / 4 / 5 全部可恢复 ---------- */
    const acceptedSchemas = [];
    for (let s = 2; s <= 5; s++) {
      const run = runImport(appBackupMod, p => { p.schema = s; });
      await run.done;
      if (run.ledger.confirm === 1 && run.ledger.save === 1 && run.ledger.render === 1) acceptedSchemas.push(s);
    }
    ok("正向：schema 2/3/4/5 全部通过验证并完成导入（迁移继续交给 normalizeItem），schema 6 被拒",
      acceptedSchemas.join(",") === "2,3,4,5" && direct(validPayload({ schema: 6 }), 5).ok === false,
      JSON.stringify(acceptedSchemas));

    /* ---------- 正向：确认语义与「密钥/私有键不被覆盖」 ---------- */
    const good = runImport(appBackupMod, null);
    await good.done;
    ok("正向：合法文件经确认后完成整份替换并报成功（条数取自替换后的清单）",
      good.ledger.confirm === 1 && good.ledger.save === 1 && good.ledger.render === 1 &&
      good.state.items.length === 1 && good.state.items[0].id === "new-item" &&
      good.toasts[good.toasts.length - 1] === "导入成功 · 1 条事项",
      JSON.stringify({ toasts: good.toasts, effects: good.ledger.effects }));
    ok("正向：确认文案是覆盖警告「导入将覆盖当前数据，继续？」",
      good.confirmArgs.length === 1 && good.confirmArgs[0][0] === "导入将覆盖当前数据，继续？" &&
      good.confirmArgs[0][1] === "导入数据", JSON.stringify(good.confirmArgs));
    ok("正向：本机 AI 密钥与请求终点不被备份覆盖（文件里是空串），本机私有键（review/onboardDone）保留",
      good.state.settings.ai.apiKey === "local-secret" &&
      good.state.settings.ai.baseUrl === "https://local.example/v1" &&
      good.state.settings.review.enabled === true && good.state.settings.onboardDone === true &&
      good.state.settings.notify === true && good.state.settings.ai.enabled === false,
      JSON.stringify(good.state.settings));

    const cancelled = runImport(appBackupMod, null, { confirm: false });
    await cancelled.done;
    ok("正向：用户取消后零副作用（内存不变 / 不提交 / 不渲染），确认框只对已验证可用的文件弹出",
      cancelled.ledger.confirm === 1 && cancelled.ledger.save === 0 && cancelled.ledger.render === 0 &&
      JSON.stringify(cancelled.state) === cancelled.before);

    const inflight = runImport(appBackupMod, null, { inflight: 1 });
    await inflight.done;
    ok("正向：提醒操作在途时连确认框都不弹（闸门排在确认之前）",
      inflight.ledger.inflight === 1 && inflight.ledger.confirm === 0 && inflight.ledger.save === 0 &&
      JSON.stringify(inflight.state) === inflight.before &&
      inflight.toasts[inflight.toasts.length - 1] === "提醒操作正在保存 · 请稍后重新导入");

    let releaseProbeSave = null;
    const pending = runImport(appBackupMod, null, {
      saveResult: () => new Promise(resolve => { releaseProbeSave = resolve; })
    });
    await new Promise(r => setTimeout(r, 0));
    ok("正向：提交在途时不渲染、不报成功（合法文件也一样）",
      pending.ledger.save === 1 && pending.ledger.render === 0 &&
      pending.toasts.indexOf("导入成功 · 1 条事项") < 0, JSON.stringify(pending.toasts));
    releaseProbeSave();
    await pending.done;
    await new Promise(r => setTimeout(r, 0));
    ok("正向：提交兑现后才渲染并报成功",
      pending.ledger.render === 1 && pending.toasts[pending.toasts.length - 1] === "导入成功 · 1 条事项");

    const rejectedSave = runImport(appBackupMod, null, {
      saveResult: () => Promise.reject(new Error("idb write failed"))
    });
    await rejectedSave.done;
    ok("正向：提交失败仍用 G02 专属文案，且内存保留（不落回「格式不正确」）",
      rejectedSave.toasts[rejectedSave.toasts.length - 1] === "导入失败 · 数据未能保存，请重新导入" &&
      rejectedSave.ledger.render === 0 && rejectedSave.state.items[0].id === "new-item");

    const notJson = runImport(appBackupMod, null, { rawText: "{ 这不是 JSON" });
    await notJson.done;
    ok("正向：非 JSON 文件保持搬移前文案「文件格式不正确」（与契约不满足区分开）",
      notJson.ledger.confirm === 0 && notJson.ledger.save === 0 &&
      notJson.toasts.length === 1 && notJson.toasts[0] === "导入失败：文件格式不正确");

    const futureRun = runImport(appBackupMod, p => { p.schema = 99; });
    await futureRun.done;
    const oldRun = runImport(appBackupMod, p => { p.schema = 1; });
    await oldRun.done;
    const foreignRun = runImport(appBackupMod, p => { p.app = "other"; });
    await foreignRun.done;
    const shapeRun = runImport(appBackupMod, p => { p.settings.injected = 1; });
    await shapeRun.done;
    ok("提示按 code 分派：未来版本要求「先更新应用」，别的应用有专属文案，其余错误点名具体路径",
      futureRun.toasts[0] === "导入失败：这份备份来自更新版本（schema 99）· 请先更新应用再导入" &&
      oldRun.toasts[0] === "导入失败：这份备份的版本过旧（schema 1）· 无法恢复" &&
      foreignRun.toasts[0] === "导入失败：这不是「安心收件箱」的备份文件" &&
      shapeRun.toasts[0] === "导入失败：备份格式不正确（settings.injected）",
      JSON.stringify([futureRun.toasts, oldRun.toasts, foreignRun.toasts, shapeRun.toasts]));

    /* ==================================================================
     * 变异：拔掉修复必红
     * ==================================================================
     * 四条变异都**只动 lib/app-backup.js 的临时副本**（工作区字节不动），
     * 而且必须由**上面那一条正式判据**（`verifyRejectCase`）变红 ——
     * 不另写一套只服务于变异的测试，否则「判据有分辨力」就没有证据。
     */
    const backupSrcPath = path.join(__dirname, "lib/app-backup.js");
    const backupSrc = fs.readFileSync(backupSrcPath, "utf8");
    function patchOnce(src, from, to) {
      const at = src.indexOf(from);
      if (at < 0) return null;
      if (src.indexOf(from, at + 1) >= 0) return null;   // 必须唯一匹配，否则不猜
      return src.slice(0, at) + to + src.slice(at + from.length);
    }
    function tmpModule(name, text) {
      const p = path.join(os.tmpdir(), name);
      fs.writeFileSync(p, text);
      return require(p);
    }
    async function judgeOn(mod, spec) {
      const judged = verifyRejectCase(mod, spec);
      await judged.run.done;
      return judged;
    }

    /* M-S1：移除 app 检查 ⇒ wrong-app 重新被接受 */
    const M_S1 = patchOnce(backupSrc, "if (data.app !== BACKUP_APP_ID) {", "if (false) {");
    ok("（前置）M-S1 只改一行：app 身份检查被拔掉（行数不变）",
      !!M_S1 && M_S1 !== backupSrc &&
      M_S1.split("\n").length === backupSrc.split("\n").length);
    const WRONG_APP = { mutate: p => { p.app = "other-app"; }, code: "app-mismatch", path: "app" };
    const cleanWrongApp = await judgeOn(appBackupMod, WRONG_APP);
    ok("（对照）未变异时 wrong-app 是干净拒绝 —— 下面那条变红才有意义",
      cleanWrongApp.pass === true, JSON.stringify(cleanWrongApp.detail));
    const mS1 = await judgeOn(tmpModule("attention-p2cs-ms1.js", M_S1), WRONG_APP);
    ok("M-S1 变红：身份检查拔掉后，别的应用的备份重新被接受（确认 1 / 提交 1 / 内存被替换）",
      mS1.pass === false && mS1.run.ledger.confirm === 1 && mS1.run.ledger.save === 1 &&
      mS1.run.state.items[0].id === "new-item", JSON.stringify(mS1.detail));

    /* M-S2：移除 schema 上界 ⇒ future-schema 重新被接受 */
    const M_S2 = patchOnce(backupSrc, "if (schema > currentSchema) {", "if (false) {");
    ok("（前置）M-S2 只改一行：schema 上界检查被拔掉（行数不变）",
      !!M_S2 && M_S2 !== backupSrc &&
      M_S2.split("\n").length === backupSrc.split("\n").length);
    const FUTURE_SCHEMA = { mutate: p => { p.schema = 999; }, code: "schema-too-new", path: "schema" };
    const cleanFuture = await judgeOn(appBackupMod, FUTURE_SCHEMA);
    ok("（对照）未变异时 future-schema 是干净拒绝", cleanFuture.pass === true,
      JSON.stringify(cleanFuture.detail));
    const mS2 = await judgeOn(tmpModule("attention-p2cs-ms2.js", M_S2), FUTURE_SCHEMA);
    ok("M-S2 变红：上界拔掉后，未来 schema 的备份重新被接受（确认 1 / 提交 1）",
      mS2.pass === false && mS2.run.ledger.confirm === 1 && mS2.run.ledger.save === 1,
      JSON.stringify(mS2.detail));

    /* M-S3：移除未知 settings 键检查 ⇒ 文件重新进入确认并落库 */
    const M_S3 = patchOnce(backupSrc,
      'if (unknown) return formatFailure("unknown-key", unknown, "设置里出现未知字段");',
      'if (false) return formatFailure("unknown-key", unknown, "设置里出现未知字段");');
    ok("（前置）M-S3 只改一行：settings 未知键检查被拔掉（行数不变）",
      !!M_S3 && M_S3 !== backupSrc &&
      M_S3.split("\n").length === backupSrc.split("\n").length);
    const SETTINGS_UNKNOWN = {
      mutate: p => { p.settings.injected = "persist-me"; },
      code: "unknown-key", path: "settings.injected"
    };
    const cleanSettings = await judgeOn(appBackupMod, SETTINGS_UNKNOWN);
    ok("（对照）未变异时 settings 未知键是干净拒绝", cleanSettings.pass === true,
      JSON.stringify(cleanSettings.detail));
    const mS3 = await judgeOn(tmpModule("attention-p2cs-ms3.js", M_S3), SETTINGS_UNKNOWN);
    ok("M-S3 变红：未知键检查拔掉后，来历不明的文件重新进入确认并落库" +
      "（确认 1 / 提交 1；键本身仍进不去 state —— settings 合并是白名单，这是第二道闸）",
      mS3.pass === false && mS3.run.ledger.confirm === 1 && mS3.run.ledger.save === 1 &&
      mS3.run.state.settings.injected === undefined,
      JSON.stringify(mS3.detail));

    /* M-S4：把验证与准备挪到 confirm 之后 ⇒ 坏文件重新触发确认 */
    const BLOCK_START = "        // 2) 整树验证（纯函数，不碰 state）。";
    const BLOCK_END = "        // 4) 在途闸门：提醒操作正在保存时，连问都不问。";
    const CONFIRM_LINE = "        if (!okImp) return;\n";
    let M_S4 = null;
    {
      const a = backupSrc.indexOf(BLOCK_START);
      const b = backupSrc.indexOf(BLOCK_END);
      if (a >= 0 && b > a && backupSrc.indexOf(CONFIRM_LINE, b) >= 0) {
        const block = backupSrc.slice(a, b);
        M_S4 = backupSrc.slice(0, a) + backupSrc.slice(b)
          .replace(CONFIRM_LINE, CONFIRM_LINE + block);
      }
    }
    ok("（前置）M-S4 补丁真的把「验证 + 准备」整段搬到了确认之后",
      !!M_S4 && M_S4 !== backupSrc &&
      M_S4.split("\n").length === backupSrc.split("\n").length &&
      M_S4.indexOf(BLOCK_START) > M_S4.indexOf("const okImp = await deps.confirmDialog"));
    const mS4 = await judgeOn(tmpModule("attention-p2cs-ms4.js", M_S4), WRONG_APP);
    ok("M-S4 变红：验证后置后，坏文件**重新触发确认框**（confirm=1），拒绝也不再是「零副作用」",
      mS4.pass === false && mS4.run.ledger.confirm === 1,
      JSON.stringify(mS4.detail));

    ok("收口：四条变异只用临时副本，工作区 lib/app-backup.js 字节未变",
      fs.readFileSync(backupSrcPath, "utf8") === backupSrc);

    /* ---------- B1：真实设备 payload 的「导出→导入」回环 ----------
     * 独立复验 `20260922T134219-independent-p2cs-recheck` 的阻断项：应用历史把
     * `createdAt` 持久化成带时区 ISO 字符串，旧验证器只认数字 ⇒ 自家导出过不了
     * 自家导入。实施方此前的夹具全是手工构造的毫秒数字，没盖住这条正向边界。
     * 这里两层都钉死：
     *   · 夹具一 —— 复验归档的**真实设备 payload**（`buildLegacyBackupPayload`
     *     对设备现存权威状态的真实输出）直接过验证器并走完整 importDataFile；
     *   · 夹具二 —— 当前 `buildLegacyBackupPayload()` 对**含 ISO createdAt 的
     *     历史状态**导出，再喂回当前验证器（复验 §5.5 要求的第二层）。
     */
    section("app-backup — P2-C-S B1：真实历史时间数据的导出→导入回环");
    // 夹具取自复验 run `20260922T134219-independent-p2cs-recheck/evidence/device-preexisting-backup.json`，
    // 仅把 items[1] 的个人标题换成占位文本；其余字段（含 createdAt 的 ISO/数字混合形态）逐字节保留。
    const DEVICE_PAYLOAD_PATH = path.join(__dirname,
      "test-fixtures/device-preexisting-backup.redacted.json");
    const deviceText = fs.readFileSync(DEVICE_PAYLOAD_PATH, "utf8");
    const devicePayload = JSON.parse(deviceText);
    const ISO_AT = "2026-09-21T08:00:00+08:00";
    const ISO_MS = 1789948800000;

    ok("B1 夹具前置：设备 payload 里 items[0]/notes[0] 的 createdAt 确为带时区 ISO 字符串（不是构造出来的）",
      devicePayload.items[0].createdAt === ISO_AT &&
      devicePayload.notes[0].createdAt === ISO_AT &&
      typeof devicePayload.items[1].createdAt === "number");

    const deviceVerdict = appBackupMod.validateBackupPayload(JSON.parse(deviceText), 5);
    ok("B1 ①：真实设备 payload 直接过验证器（修复前在这里 field-type @ items[0].createdAt FAIL）",
      deviceVerdict.ok === true, JSON.stringify({ code: deviceVerdict.code, path: deviceVerdict.path }));
    ok("B1 ②：sanitized 把两处 ISO 迁移为 epoch 毫秒，数字原样保留，输入文件对象不被改写",
      deviceVerdict.ok &&
      deviceVerdict.sanitized.items[0].createdAt === ISO_MS &&
      deviceVerdict.sanitized.notes[0].createdAt === ISO_MS &&
      deviceVerdict.sanitized.items[1].createdAt === 1790009208456 &&
      devicePayload.items[0].createdAt === ISO_AT &&
      devicePayload.notes[0].createdAt === ISO_AT,
      JSON.stringify({ item0: deviceVerdict.ok && deviceVerdict.sanitized.items[0].createdAt,
        note0: deviceVerdict.ok && deviceVerdict.sanitized.notes[0].createdAt }));

    const deviceRun = runImport(appBackupMod, null, { rawText: deviceText });
    await deviceRun.done;
    ok("B1 ③：同一 payload 经 importDataFile 生产路径导入成功（确认 1 / 提交 1 / 渲染 1 / 2 条事项）",
      deviceRun.ledger.confirm === 1 && deviceRun.ledger.save === 1 &&
      deviceRun.ledger.render === 1 && deviceRun.state.items.length === 2,
      JSON.stringify(deviceRun.ledger.effects));
    ok("B1 ④：落库后的权威状态里 items/notes 时间全部是毫秒数字（字符串不进权威状态）",
      deviceRun.state.items[0].createdAt === ISO_MS &&
      deviceRun.state.items[1].createdAt === 1790009208456 &&
      deviceRun.state.notes[0].createdAt === ISO_MS,
      JSON.stringify({ items: deviceRun.state.items.map(i => i.createdAt),
        notes: deviceRun.state.notes.map(n => n.createdAt) }));

    const legacyIsoState = {
      items: [Object.assign({}, REAL_ITEM, { id: "it_iso", createdAt: ISO_AT,
        snoozedAt: "2026-09-20T22:00:00+08:00" })],
      notes: [{ id: "n_iso", text: "历史 ISO 备注", createdAt: ISO_AT,
        updatedAt: "2026-09-21T09:30:00.000Z" }],
      projects: [{ id: "p_iso", name: "ISO 项目", color: "#333" }],
      settings: {
        notify: true, dnd: false, importantRepeat: true, quietStart: "23:00", quietEnd: "07:30",
        dailySummary: false, privacyNotify: false, defaultDeliveryMode: "notification",
        userMode: "beginner",
        ai: { enabled: false, baseUrl: "", apiKey: "", model: "m", autoOnSave: false }
      }
    };
    const isoExporter = appBackupMod.createAppBackup(Object.assign({}, deps, {
      getState: () => legacyIsoState, getSchema: () => 5
    }));
    const isoSnapshotText = JSON.stringify(isoExporter.buildLegacyBackupPayload());
    const isoVerdict = appBackupMod.validateBackupPayload(JSON.parse(isoSnapshotText), 5);
    ok("B1 ⑤：当前导出器对含 ISO createdAt 的历史状态导出的快照，能被当前验证器接受（第二层回环）",
      isoVerdict.ok === true, JSON.stringify({ code: isoVerdict.code, path: isoVerdict.path }));
    ok("B1 ⑥：第二层回环的 sanitized 同样全部收敛为毫秒数字（迁移一次到位，不把字符串写回）",
      isoVerdict.ok &&
      isoVerdict.sanitized.items[0].createdAt === ISO_MS &&
      isoVerdict.sanitized.items[0].snoozedAt === Date.parse("2026-09-20T22:00:00+08:00") &&
      isoVerdict.sanitized.notes[0].createdAt === ISO_MS &&
      isoVerdict.sanitized.notes[0].updatedAt === Date.parse("2026-09-21T09:30:00.000Z"),
      JSON.stringify(isoVerdict.ok ? { item: isoVerdict.sanitized.items[0].createdAt,
        note: isoVerdict.sanitized.notes[0].createdAt } : isoVerdict));

    const isoImport = runImport(appBackupMod, null, { rawText: isoSnapshotText });
    await isoImport.done;
    ok("B1 ⑦：第二层快照走完整导入路径同样成功且时间全部为数字",
      isoImport.ledger.confirm === 1 && isoImport.ledger.save === 1 &&
      isoImport.state.items[0].createdAt === ISO_MS &&
      isoImport.state.notes[0].updatedAt === Date.parse("2026-09-21T09:30:00.000Z"),
      JSON.stringify({ items: isoImport.state.items.map(i => i.createdAt),
        notes: isoImport.state.notes.map(n => n.createdAt) }));

    ok("B1 ⑧：新负向 —— 无时区串 / 文字串 / 负数 / 1970 前 ISO（负毫秒）在时间字段全被拒；quietStart/quietEnd 收紧为合法 HH:MM",
      (function () {
        const probes = [
          [p => { p.items[0].createdAt = "2026-09-21T08:00:00"; }, "items[0].createdAt"],
          [p => { p.notes[0].createdAt = "昨天"; }, "notes[0].createdAt"],
          [p => { p.items[0].createdAt = -1; }, "items[0].createdAt"],
          [p => { p.items[0].createdAt = "0001-01-01T00:00:00Z"; }, "items[0].createdAt"],
          [p => { p.settings.quietStart = "9:00"; }, "settings.quietStart"],
          [p => { p.settings.quietEnd = " nighttime"; }, "settings.quietEnd"]
        ];
        for (let i = 0; i < probes.length; i++) {
          const p = JSON.parse(deviceText);
          probes[i][0](p);
          const v = appBackupMod.validateBackupPayload(p, 5);
          if (v.ok || v.code !== "field-type" || v.path !== probes[i][1]) {
            return { probe: i, verdict: { ok: v.ok, code: v.code, path: v.path } };
          }
        }
        return true;
      })());
  } finally {
    if (hadFileReader) global.FileReader = savedFileReader; else delete global.FileReader;
  }

  appBackupDone();
})();

/* ---------- P2-C-R：导出「结果未返回」宽限闸门（假计时器，8 秒） ----------
 *
 * 真机上这条分支是 NOT_PERFORMED：`am force-stop com.coloros.filemanager` 之后平台
 * **仍然投递了 RESULT_CANCELED**，构造不出「结果永不返回」（见
 * `docs/reviews/verification-runs/20260921T1610-p2c-device-closure/not-performed.md`）。
 * 所以这里用**假计时器**把 7999 / 8000 两个边界钉死，并证明「超时之后迟到的结果
 * 不许再改界面」—— 那是宽限闸门存在的全部意义。
 *
 * 假计时器只在**同步块**内安装（本文件多个异步段并发推进，长窗口替换全局 `setTimeout`
 * 会把别的段挂住）：宽限计时器的确立与推进都在同一个同步块里完成，退出即还原。
 */
section("app-backup — 导出宽限闸门（假计时器：7999 / 8000 ms 与迟到结果）");
const graceDone = beginAsyncSection();
(async function () {
  const fs = require("fs");
  const os = require("os");
  const backupMod = require(path.join(__dirname, "lib/app-backup.js"));
  const GRACE = backupMod.EXPORT_RESULT_GRACE_MS;

  const nodes = {
    "#btnExport": { disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
    "#exportSub": { textContent: "" }
  };
  const calls = { toast: [] };
  const pendingResolvers = [];
  let bridgeCalls = 0;
  const bridge = {
    saveDocument() {
      bridgeCalls += 1;
      return new Promise(resolve => { pendingResolvers.push(resolve); });
    }
  };
  const deps = {
    getSchema: () => 5,
    getState: () => ({ items: [], notes: [], projects: [], settings: {} }),
    normalizeItem: x => x,
    save: async () => {},
    render: () => {},
    toast: m => { calls.toast.push(m); },
    confirmDialog: async () => true,
    query: sel => nodes[sel] || null,
    isNativeAndroidRuntime: () => true,
    systemBridge: () => bridge,
    getInflightActionDepth: () => 0
  };
  const backup = backupMod.createAppBackup(deps);
  const lastToast = () => calls.toast[calls.toast.length - 1] || "";
  const settle = () => new Promise(r => setImmediate(r));

  /** 同步块内安装假计时器，退出即还原；`fn(api)` 必须是**同步**的。 */
  function withClock(fn) {
    const clock = { now: 0, seq: 0, timers: [], fired: [] };
    const realSet = global.setTimeout;
    const realClear = global.clearTimeout;
    const api = {
      now: () => clock.now,
      armed: () => clock.timers.filter(t => !t.cleared).length,
      firedAt: () => clock.fired.slice(),
      advance(ms) {
        clock.now += ms;
        clock.timers.filter(t => !t.cleared && t.at <= clock.now).forEach(t => {
          t.cleared = true;
          clock.fired.push(clock.now);
          t.fn();
        });
      }
    };
    global.setTimeout = (f, ms) => {
      const t = { id: ++clock.seq, at: clock.now + (Number(ms) || 0), fn: f, cleared: false };
      clock.timers.push(t);
      return t.id;
    };
    global.clearTimeout = id => {
      const t = clock.timers.find(x => x.id === id);
      if (t) t.cleared = true;
    };
    try { fn(api); } finally { global.setTimeout = realSet; global.clearTimeout = realClear; }
  }

  /* ① 边界：7999 不触发、8000 触发并恢复按钮。 */
  let round1 = null;
  ok("（前置）宽限时长是 8 秒", GRACE === 8000, String(GRACE));
  withClock(clock => {
    round1 = backup.exportData();               // 同步跑到 `await saveDocument`
    ok("（前置）原生导出进入在途：按钮被锁 + 副文案改成「正在等待保存结果…」",
      bridgeCalls === 1 && nodes["#btnExport"].disabled === true &&
      nodes["#exportSub"].textContent === "正在等待保存结果…",
      JSON.stringify({ calls: bridgeCalls, btn: nodes["#btnExport"].disabled,
        sub: nodes["#exportSub"].textContent }));

    backup.noteExportAppVisibility(false);      // 用户进了系统选择器
    backup.noteExportAppVisibility(true);       // 回到应用：开始计时
    ok("（前置）回到前台后宽限计时器被装上（离开期间不计时）",
      clock.armed() === 1, JSON.stringify(clock.firedAt()));

    clock.advance(7999);
    ok("宽限：7999 ms **不触发**（不报「无法确认」、按钮仍保持等待）",
      clock.firedAt().length === 0 && clock.armed() === 1 &&
      nodes["#btnExport"].disabled === true &&
      lastToast() === "请选择保存位置和文件名",
      JSON.stringify({ fired: clock.firedAt(), armed: clock.armed(),
        btn: nodes["#btnExport"].disabled, toast: lastToast() }));

    clock.advance(1);                            // 累计 8000 ms
    ok("宽限：8000 ms 触发「保存结果未返回 · 文件状态无法确认，请重试」",
      clock.firedAt().length === 1 && clock.firedAt()[0] === 8000 &&
      lastToast() === "保存结果未返回 · 文件状态无法确认，请重试",
      JSON.stringify({ fired: clock.firedAt(), toast: lastToast() }));
    ok("宽限：超时时恢复按钮与副文案（可以重试，不是永久卡死）",
      clock.armed() === 0 && nodes["#btnExport"].disabled === false &&
      nodes["#btnExport"].attrs["aria-busy"] === "false" &&
      nodes["#exportSub"].textContent === "JSON 备份到文件",
      JSON.stringify({ armed: clock.armed(), btn: nodes["#btnExport"].disabled,
        attrs: nodes["#btnExport"].attrs, sub: nodes["#exportSub"].textContent }));
    ok("宽限：整条超时路径**一句「已保存」都没有出现过**（绝不报成功）",
      calls.toast.every(m => !/已保存|已分享/.test(m)), JSON.stringify(calls.toast));
  });

  /* ② 迟到结果：超时作废了这轮操作身份 ⇒ 不得再 toast、不得再改界面。 */
  const afterGrace = calls.toast.length;
  pendingResolvers.shift()({ status: "saved", fileName: "安心收件箱备份-x.json", locationLabel: "下载" });
  const r1 = await round1;
  await settle();
  ok("迟到结果：超时之后才回来的 saved ⇒ 返回 stale，**不再 toast**、也不再改按钮",
    r1 && r1.status === "stale" && calls.toast.length === afterGrace &&
    nodes["#btnExport"].disabled === false,
    JSON.stringify({ r1: r1, toasts: calls.toast }));

  /* ③ 新一轮不受上一轮迟到结果影响：晚到的 stale 结果不得把新一轮说成已保存。 */
  const round2 = backup.exportData();
  await settle();
  ok("新一轮：上一轮已作废后可以重新导出（按钮重新进入在途）",
    bridgeCalls === 2 && nodes["#btnExport"].disabled === true,
    JSON.stringify({ calls: bridgeCalls, btn: nodes["#btnExport"].disabled }));
  pendingResolvers.shift()({ status: "saved", fileName: "安心收件箱备份-新.json", locationLabel: "下载" });
  const r2 = await round2;
  await settle();
  ok("新一轮：结果正常时照旧报「已保存」，且用的是**这一轮**的文件名",
    r2 && r2.status === "saved" && /安心收件箱备份-新\.json/.test(lastToast()) &&
    nodes["#btnExport"].disabled === false,
    JSON.stringify({ r2: r2, toast: lastToast() }));

  /* ④ 迟到的 cancelled 同样不许再 toast（超时判定已经把这个「取消」变成了不可信信息）。 */
  let round3 = null;
  withClock(clock => {
    round3 = backup.exportData();
    backup.noteExportAppVisibility(false);
    backup.noteExportAppVisibility(true);
    clock.advance(8000);
    ok("（前置）第三轮宽限同样在 8000 ms 触发", clock.firedAt().length === 1,
      JSON.stringify(clock.firedAt()));
  });
  const beforeLateCancel = calls.toast.length;
  pendingResolvers.shift()({ status: "cancelled" });
  const r3 = await round3;
  await settle();
  ok("迟到结果：超时之后才回来的 cancelled ⇒ 也不 toast「已取消导出」",
    r3 && r3.status === "stale" && calls.toast.length === beforeLateCancel &&
    !calls.toast.some(m => /已取消导出/.test(m.slice(beforeLateCancel))),
    JSON.stringify({ r3: r3, toasts: calls.toast }));

  /* ⑤ 反向对照：把两处守卫各自拔掉，上面的断言必须变红。
   *
   * 用**本轮工作区字节**做最小反向编辑（只改 lib/app-backup.js 的临时副本，
   * harness 与其它模块一个字不动）—— 这是「同一组合、只有这一处差别」。 */
  {
    const srcPath = path.join(__dirname, "lib/app-backup.js");
    const src = fs.readFileSync(srcPath, "utf8");
    const tmpMod = (name, text) => {
      const p = path.join(os.tmpdir(), name);
      fs.writeFileSync(p, text);
      return p;
    };
    /** 用给定模块做一轮「超时 → 迟到 saved」；返回该轮的观察值。 */
    async function lateSavedRun(mod) {
      const localCalls = { toast: [] };
      const localNodes = { "#btnExport": { disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
        "#exportSub": { textContent: "" } };
      const resolvers = [];
      const localDeps = Object.assign({}, deps, {
        toast: m => localCalls.toast.push(m),
        query: sel => localNodes[sel] || null,
        systemBridge: () => ({ saveDocument: () => new Promise(r => resolvers.push(r)) })
      });
      const inst = mod.createAppBackup(localDeps);
      let round = null;
      let lockedAtGrace = null;
      withClock(clock => {
        round = inst.exportData();
        inst.noteExportAppVisibility(false);
        inst.noteExportAppVisibility(true);
        clock.advance(8000);
        lockedAtGrace = localNodes["#btnExport"].disabled;
      });
      const afterGraceLocal = localCalls.toast.length;
      resolvers.shift()({ status: "saved", fileName: "迟到.json", locationLabel: "下载" });
      const result = await round;
      await settle();
      return { toasts: localCalls.toast, afterGrace: afterGraceLocal, result: result,
        lockedAtGrace: lockedAtGrace };
    }

    const STALE_GUARD = 'if (operationId !== exportOperationId) return { status: "stale" };';
    const m10Src = src.replace(STALE_GUARD, 'if (false) return { status: "stale" };');
    ok("（前置）M10 反例补丁真的拔掉了 stale 判断（只改这一行）",
      m10Src !== src && m10Src.indexOf(STALE_GUARD) < 0 &&
      m10Src.split("\n").length === src.split("\n").length);
    const m10 = require(tmpMod("attention-m10-app-backup.js", m10Src));
    const m10Run = await lateSavedRun(m10);
    ok("M10 变红：拔掉 stale 判断后，超时后迟到的 saved **重新 toast 出「已保存」**" +
      "⇒ ② 的断言不会恒真",
      m10Run.toasts.length > m10Run.afterGrace &&
      /已保存/.test(m10Run.toasts[m10Run.toasts.length - 1]),
      JSON.stringify({ toasts: m10Run.toasts, afterGrace: m10Run.afterGrace }));
    ok("M10 的对照面：同一路径在**未变异**模块上不 toast（两边合起来才说明判据有分辨力）",
      await (async () => {
        const clean = await lateSavedRun(backupMod);
        return clean.toasts.length === clean.afterGrace && clean.result.status === "stale" &&
          clean.lockedAtGrace === false;
      })());

    const ARM_BLOCK = [
      "      pending.timer = setTimeout(() => {",
      '        if (pendingNativeExport !== pending || !exportInProgress) return;',
      "        pendingNativeExport = null;",
      "        exportOperationId++;",
      "        exportInProgress = false;",
      "        setExportBusy(false);",
      '        deps.toast("保存结果未返回 · 文件状态无法确认，请重试");',
      "      }, EXPORT_RESULT_GRACE_MS);"
    ].join("\n");
    const m11Src = src.replace(ARM_BLOCK, "      pending.timer = 0;");
    ok("（前置）M11 反例补丁真的删掉了宽限计时器的装配",
      m11Src !== src && src.indexOf(ARM_BLOCK) > 0 &&
      m11Src.indexOf("EXPORT_RESULT_GRACE_MS);") < 0);
    const m11 = require(tmpMod("attention-m11-app-backup.js", m11Src));
    const m11Run = await lateSavedRun(m11);
    ok("M11 变红：宽限计时器被删掉后，8000 ms **不再有任何判定** —— 按钮一直锁在等待态，" +
      "迟到的结果反被当成成功 ⇒ ① 的两个边界断言都不会恒真",
      m11Run.lockedAtGrace === true &&
      !m11Run.toasts.some(m => /文件状态无法确认/.test(m)) &&
      m11Run.result && m11Run.result.status === "saved",
      JSON.stringify({ lockedAtGrace: m11Run.lockedAtGrace, toasts: m11Run.toasts,
        result: m11Run.result }));
    ok("M11 的对照面：同一路径在**未变异**模块上，8000 ms 已恢复按钮且判为 stale",
      await (async () => {
        const clean = await lateSavedRun(backupMod);
        return clean.lockedAtGrace === false && clean.result.status === "stale" &&
          clean.toasts.some(m => /文件状态无法确认/.test(m));
      })());
    ok("收口：反向编辑只用临时副本，工作区 lib/app-backup.js 未被改写",
      fs.readFileSync(srcPath, "utf8") === src);
  }

  graceDone();
})();

/* storage memory backend */
section("storage");
{
  const storageDone = beginAsyncSection();
  // force memory by temporarily removing indexedDB
  const store = storageMod.createStorage({ lsKey: "attention-inbox-v2" });
  store._useMemory();
  // load empty
  store.load().then(v => {
    ok("memory empty load", v == null);
    return store.save({ items: [{ id: "a" }], notes: [] });
  }).then(() => store.load()).then(v => {
    ok("memory save/load", v && v.items && v.items[0].id === "a");
    storageDone();
  }).catch(e => {
    ok("storage async", false, e && e.message);
    storageDone();
  });
}

/* ---------- UX-T01 / T02 / A01：反馈与动作语义（lib/feedback.js） ---------- */
section("feedback — 保存结果与排程结果分开");
{
  const fb = feedbackMod;

  ok("保存中不得出现「已保存」", !/已保存/.test(fb.saveFeedback("saving").text));
  const failedSave = fb.saveFeedback("failed");
  ok("保存失败不伪装成功", !/已保存/.test(failedSave.text) && failedSave.actionKind === "retry-save");
  const degraded = fb.saveFeedback("degraded");
  ok("降级保存按实际保障程度提示", /受限/.test(degraded.text));

  const nativeOK = {
    isNative: true, bridgeReady: true, notifySwitch: true, notifications: "granted",
    exactAlarm: "granted", reliability: "exact", alarmCount: 0, alarmScheduled: 0,
    capabilities: { notifications: true, screen: true, exact: true }
  };
  const timed = { hasTrigger: true, isFallbackTrigger: false, triggerAt: Date.now() + 3600000 };

  const vOK = fb.reminderFeedback({ persistence: "confirmed", item: timed, native: nativeOK, itemScheduled: true });
  ok("本条已获真实确认 → scheduled", vOK.kind === fb.REMINDER_KINDS.SCHEDULED, vOK.kind);
  ok("已确认的文案给出具体时间", /明天|今天|\d{1,2}月\d{1,2}日/.test(vOK.text), vOK.text);

  // 关键反例：全局一切正常，但**本条**的排程结果未知 —— 不许冒充已安排
  const vUnknown = fb.reminderFeedback({ persistence: "confirmed", item: timed, native: nativeOK, itemScheduled: null });
  ok("全局正常不能证明刚保存的这一条已排成功", vUnknown.kind === fb.REMINDER_KINDS.UNKNOWN, vUnknown.kind);

  const noTime = fb.reminderFeedback({
    persistence: "confirmed",
    item: { hasTrigger: false, isFallbackTrigger: false },
    native: nativeOK, itemScheduled: null
  });
  ok("没有明确时间 → 待补提醒时间", noTime.kind === fb.REMINDER_KINDS.NO_TIME, noTime.kind);
  ok("待整理文案不得暴露兜底时间为事项承诺", !/\d{1,2}:\d{2}/.test(noTime.text), noTime.text);

  const fbItem = fb.reminderFeedback({
    persistence: "confirmed",
    item: { hasTrigger: true, isFallbackTrigger: true, triggerAt: Date.now() + 7200000 },
    native: nativeOK, itemScheduled: true
  });
  ok("兜底时间不冒充已定的提醒时间", fbItem.kind === fb.REMINDER_KINDS.NO_TIME, fbItem.kind);

  const vOff = fb.reminderFeedback({
    persistence: "confirmed", item: timed, itemScheduled: null,
    native: Object.assign({}, nativeOK, { notifySwitch: false })
  });
  ok("总开关关闭 → 提醒已关闭", vOff.kind === fb.REMINDER_KINDS.SWITCH_OFF, vOff.kind);
  ok("不擅自替用户宣布已开启", !/已开启|已打开/.test(vOff.text), vOff.text);

  const vDenied = fb.reminderFeedback({
    persistence: "confirmed", item: timed, itemScheduled: null,
    native: Object.assign({}, nativeOK, { notifications: "denied", reliability: "in-app" })
  });
  ok("通知权限被拒 → permission-denied", vDenied.kind === fb.REMINDER_KINDS.PERMISSION_DENIED, vDenied.kind);
  ok("权限被拒文案不得说「完全不响」", !/完全|静默|不响/.test(vDenied.text), vDenied.text);

  const vAlarmLimited = fb.reminderFeedback({
    persistence: "confirmed", item: timed, itemScheduled: true,
    native: Object.assign({}, nativeOK, {
      notifications: "denied", reliability: "in-app", alarmCount: 1, alarmScheduled: 1,
      capabilities: { notifications: false, screen: false, exact: true }
    })
  });
  ok("闹钟可排但通知受限 → alarm-limited", vAlarmLimited.kind === fb.REMINDER_KINDS.ALARM_LIMITED, vAlarmLimited.kind);
  ok("受限文案明确「已安排闹钟」而不是「没安排」", /已安排闹钟/.test(vAlarmLimited.text), vAlarmLimited.text);
  ok("受限文案不误称完全不响", !/完全|静默/.test(vAlarmLimited.text), vAlarmLimited.text);

  const vInexact = fb.reminderFeedback({
    persistence: "confirmed", item: timed, itemScheduled: null,
    native: Object.assign({}, nativeOK, { exactAlarm: "denied", reliability: "inexact" })
  });
  ok("只能非精确 → 提醒可能延迟", vInexact.kind === fb.REMINDER_KINDS.INEXACT, vInexact.kind);

  const vErr = fb.reminderFeedback({
    persistence: "confirmed", item: timed, itemScheduled: null,
    native: Object.assign({}, nativeOK, { reliability: "error" })
  });
  ok("对账失败 → 排程失败 + 重试", vErr.kind === fb.REMINDER_KINDS.ERROR && vErr.actionKind === "retry-schedule");

  const vWeb = fb.reminderFeedback({ persistence: "confirmed", item: timed, native: { isNative: false }, itemScheduled: null });
  ok("Web/PWA 不显示 Android 就绪结论", vWeb.kind === fb.REMINDER_KINDS.WEB, vWeb.kind);

  // 反例（有牙齿）：任何输入组合都不许产出「漏提醒」这一结论
  const combos = [];
  ["confirmed", "degraded", "failed"].forEach(p => {
    [true, false].forEach(sc => {
      [null, nativeOK,
        Object.assign({}, nativeOK, { notifySwitch: false }),
        Object.assign({}, nativeOK, { notifications: "denied" }),
        Object.assign({}, nativeOK, { bridgeReady: false }),
        Object.assign({}, nativeOK, { reliability: "error" }),
        { isNative: false }].forEach(n => {
        [timed, { hasTrigger: false }, { hasTrigger: true, isFallbackTrigger: true }].forEach(it => {
          combos.push({ persistence: p, item: it, native: n, itemScheduled: sc });
        });
      });
    });
  });
  const wrong = combos.map(c => fb.reminderFeedback(c))
    .filter(v => /漏提醒|漏了提醒|确定漏/.test(v.text));
  ok("穷举 " + combos.length + " 种组合：不产出「漏提醒」结论", wrong.length === 0,
    wrong.length ? JSON.stringify(wrong[0]) : "");
}

section("feedback — 动作语义与术语");
{
  const fb = feedbackMod;
  const ack = fb.actionSpec("ack");
  ok("ACK 语义：停止本轮、仍未完成", /仍未完成/.test(ack.sub));
  ok("ACK 文案不承诺「以后不再提醒」", !/不再提醒|不会再提醒/.test(ack.firstTimeText + ack.sub));
  ok("ACK 首次反馈提供「稍后提醒」入口", ack.firstTimeAction === "稍后提醒");

  const snooze = fb.actionSpec("snooze", { when: Date.now() + 7200000 });
  ok("稍后提醒展示具体时间", /今天|明天|\d{1,2}月\d{1,2}日/.test(snooze.sub), snooze.sub);
  ok("原生快捷稍后明确标注 2 小时", /2 小时/.test(snooze.nativeSub));

  const done = fb.actionSpec("done", { hasRepeat: false });
  ok("完成：结束当前实例并归档", /归档/.test(done.sub));
  ok("完成后撤销窗口为 8 秒", done.undoWindowMs === 8000);
  const doneRep = fb.actionSpec("done", { hasRepeat: true });
  ok("周期完成的反馈说明是否存在下一周期", /下一周期/.test(doneRep.sub));

  const stop = fb.actionSpec("stop");
  ok("关闭声振不冒充 ACK/完成/稍后", stop.notAck === true && !/已确认|已完成|稍后/.test(stop.sub));

  ok("术语替换 ACK", fb.humanize("点击 ACK 按钮") === "点击 我知道了 按钮", fb.humanize("点击 ACK 按钮"));
  ok("术语替换 NEEDS_REVIEW", fb.humanize("NEEDS_REVIEW 记录") === "待整理 记录");
  ok("术语替换 Capture", fb.humanize("Capture 一条") === "记下 一条");

  const s1 = fb.captureSummary({});
  ok("无时间摘要明确说明会被先记下", s1.empty === true && /待整理/.test(s1.text));
  const s2 = fb.captureSummary({ triggerAt: Date.now() + 3600000, repeatText: "每两周", deadlineAt: Date.now() + 86400000 });
  ok("摘要展示有效提醒时间", /提醒/.test(s2.text));
  ok("摘要不隐藏已识别的周期", /每两周/.test(s2.text), s2.text);
  ok("摘要展示截止", /截止/.test(s2.text));

  const st = fb.setupSteps({ notifications: "granted", exactAlarm: "denied" });
  ok("已满足的能力不重复申请", st.next && st.next.id === "exact", st.next && st.next.id);
  ok("每个步骤都解释「为何需要」与「拒绝后的影响」",
    st.steps.every(s => s.why && s.denyImpact));
  const stAll = fb.setupSteps({ notifications: "granted", exactAlarm: "granted" });
  ok("测试步骤仍可达（未测试前不算全通过）", !stAll.allDone || stAll.steps.some(s => s.id === "test"));
  const background = stAll.steps.find(s => s.id === "background");
  ok("未打开后台设置且系统未确认时不算完成", background.done === false && background.verified === false);
  ok("后台说明不再声称所有国产系统锁屏 20 秒必然冻结",
    !/国产系统锁屏超过\s*20\s*秒/.test(background.why), background.why);
  const visited = fb.setupSteps(
    { notifications: "granted", exactAlarm: "granted", overlay: "denied", fullScreenIntent: "denied" },
    { backgroundVisited: true, overlayVisited: true }
  );
  const visitedBackground = visited.steps.find(s => s.id === "background");
  const visitedOverlay = visited.steps.find(s => s.id === "overlay");
  ok("打开过后台设置只推进向导，不冒充系统能力已验证",
    visitedBackground.done === true && visitedBackground.verified === false);
  ok("打开过悬浮窗设置只推进向导，不承诺一定只显示横幅",
    visitedOverlay.done === true && visitedOverlay.verified === false && /可能/.test(visitedOverlay.denyImpact));
  const verified = fb.setupSteps({
    notifications: "granted", exactAlarm: "granted", ignoringBatteryOptimizations: true,
    overlay: "granted", fullScreenIntent: "granted"
  });
  ok("系统可回读的后台与全屏能力仍可标记为已验证",
    verified.steps.find(s => s.id === "background").verified === true &&
    verified.steps.find(s => s.id === "overlay").verified === true);
  // 真机原生状态的实际形态：这三项能力只在 diag 下（vivo V2238A / Android 16 实测）。
  const deviceShape = fb.setupSteps({
    notifications: "granted", exactAlarm: "granted",
    diag: { canDrawOverlays: true, canUseFullScreenIntent: true, ignoringBatteryOptimizations: false }
  });
  const devOverlay = deviceShape.steps.find(s => s.id === "overlay");
  const devBackground = deviceShape.steps.find(s => s.id === "background");
  ok("真机形态：diag 回读悬浮窗与全屏通知均已允许 ⇒ 该步已验证且完成，不再要求去开启",
    devOverlay.verified === true && devOverlay.done === true);
  ok("真机形态：diag 回读未忽略电池优化 ⇒ 后台一步仍未验证、未完成",
    devBackground.verified === false && devBackground.done === false);
  ok("真机形态：下一步是后台运行，而不是已开启的悬浮窗",
    deviceShape.next && deviceShape.next.id === "background", deviceShape.next && deviceShape.next.id);
  const devPartial = fb.setupSteps({
    notifications: "granted", exactAlarm: "granted",
    diag: { canDrawOverlays: true, canUseFullScreenIntent: false, ignoringBatteryOptimizations: true }
  });
  ok("真机形态：全屏通知未允许时悬浮窗一步不算验证；电池优化已忽略时后台一步已验证",
    devPartial.steps.find(s => s.id === "overlay").verified === false &&
    devPartial.steps.find(s => s.id === "background").verified === true);
  const missedRun = fb.setupSteps({}, {
    testRun: { startedAt: 1000, feedbackAt: 1100 },
    testFeedback: { value: "missed", at: 1100 }
  }).steps.find(s => s.id === "test");
  ok("60 秒测试有结果不等于验证通过", missedRun.done === true && missedRun.verified === false);
  const heardRun = fb.setupSteps({}, {
    testRun: { startedAt: 1000, feedbackAt: 1100 },
    testFeedback: { value: "heard", at: 1100 }
  }).steps.find(s => s.id === "test");
  ok("本次测试明确听到后才可标记为验证通过", heardRun.done === true && heardRun.verified === true);
  ok("未回答测试反馈不等于失败或成功", fb.testFeedbackVerdict(undefined).ok === null);
  ok("不确定既不算失败也不算成功", fb.testFeedbackVerdict("unsure").ok === null);
  ok("区分「没收到」与「不确定」", fb.testFeedbackVerdict("missed").ok === false);

  // 防冻结是首页必须提示的一步；首页按 homeDone 判断：点进过设置页不算解决
  ok("防冻结：标记为 essential（首页会提示）", background.essential === true);
  ok("防冻结：悬浮窗与 60 秒测试仍是可选步骤",
    stAll.steps.find(s => s.id === "overlay").essential !== true && stAll.steps.find(s => s.id === "test").essential !== true);
  ok("防冻结：点进过设置页 ⇒ 向导视为完成（done），但首页仍未解决（homeDone=false）",
    visitedBackground.done === true && visitedBackground.homeDone === false, JSON.stringify(visitedBackground));
  ok("防冻结：diag 回读到忽略电池优化 ⇒ 首页视为已解决",
    devPartial.steps.find(s => s.id === "background").homeDone === true);
  ok("防冻结：diag 回读未忽略电池优化 ⇒ 首页未解决", devBackground.homeDone === false);
  const bgHeard = fb.setupSteps(
    { notifications: "granted", exactAlarm: "granted", diag: { ignoringBatteryOptimizations: false } },
    { backgroundVisited: true, testRun: { startedAt: 1000, feedbackAt: 1100 }, testFeedback: { value: "heard", at: 1100 } }
  ).steps.find(s => s.id === "background");
  ok("防冻结：60 秒测试被确认（听到了）⇒ 首页视为已解决（真实效果优先于无法回读的厂商开关）",
    bgHeard.homeDone === true && bgHeard.verified === false);
  const bgMissed = fb.setupSteps(
    { notifications: "granted", exactAlarm: "granted" },
    { backgroundVisited: true, testRun: { startedAt: 1000, feedbackAt: 1100 }, testFeedback: { value: "missed", at: 1100 } }
  ).steps.find(s => s.id === "background");
  ok("防冻结：60 秒测试「没收到」⇒ 首页仍未解决", bgMissed.homeDone === false);
  ok("除防冻结外，其余步骤不带 homeDone（首页沿用 done）",
    stAll.steps.filter(s => s.id !== "background").every(s => !Object.prototype.hasOwnProperty.call(s, "homeDone")));
}

/* ---------- UX-T03：原生送达证据（lib/delivery-evidence.js） ---------- */
section("delivery-evidence — 证据合并与事后核查");
{
  const ev = evidenceMod;
  ok("展示状态里没有 missed 这一档", !Object.prototype.hasOwnProperty.call(ev.STATUS, "MISSED"));
  const allStates = Object.keys(ev.STATUS).map(k => ev.STATUS[k]);
  ok("没有代表「漏提醒」的状态值", allStates.indexOf("missed") < 0 && allStates.indexOf("fail") < 0);

  const now = 1789000000000;
  // 独立验收 F06 / R4：回执必须锚到**我们登记过的那一轮**，所以事项先得有一份排程登记。
  // 没有登记的轮次一律 unknown —— 宁可「尚未确认」，也不谎报「系统已接收」。
  const scheduledAt = (at, roundBase) => ({ at: at, state: "scheduled", roundBase: roundBase });
  const baseItem = () => ({
    id: "i1", status: "waiting", triggerAt: now - 3600000, rev: 3,
    reminderEvents: {
      ["0@" + (now - 3600000)]: scheduledAt(now - 3600000, now - 3600000),
      ["1@" + (now - 1800000)]: scheduledAt(now - 1800000, now - 3600000)
    }
  });

  const rawGood = [{ id: 5, token: "t1", itemId: "i1", itemRev: "3", reminderKey: "0@" + (now - 3600000), receivedAt: now - 3599000, carrier: "alarm" }];
  const norm = ev.normalizeEvidence(rawGood, "bridge");
  ok("身份完整的事件被接受", norm.length === 1 && norm[0].valid === true);
  ok("最小身份含事项 ID + 提醒键 + 计划时刻 + 载体", norm[0].itemId === "i1" && norm[0].key && norm[0].at && norm[0].carrier === "alarm");
  ok("只声明「系统已接收」，不写成用户看到", norm[0].level === "received");

  const items = [baseItem()];
  const r1 = ev.mergeEvidence(items, norm, now);
  ok("首次合并写入 delivered", r1.changed === true && r1.applied === 1);
  ok("送达证据落在三态台账上", items[0].reminderEvents[norm[0].key].state === "delivered");

  const r2 = ev.mergeEvidence(items, ev.normalizeEvidence(rawGood, "bridge"), now);
  ok("重复回执幂等：第二次不产生变化", r2.changed === false && r2.applied === 0 && r2.deduped === 1);
  // 差分对照：不同 key 的证据**确实**会改变 —— 证明上面的 false 不是因为函数恒空转
  const r2b = ev.mergeEvidence(items, ev.normalizeEvidence(
    [{ itemId: "i1", reminderKey: "1@" + (now - 1800000), receivedAt: now - 1799000, itemRev: "3", carrier: "alarm" }], "bridge"), now);
  ok("对照组：换一个提醒键会正常写入（上面的幂等不是空转）", r2b.changed === true && r2b.applied === 1);

  // 旧轮次守卫：键的原定时刻早于当前触发起点
  const item2 = [{ id: "i2", status: "waiting", triggerAt: now, rev: 9 }];
  const stale = ev.normalizeEvidence(
    [{ itemId: "i2", reminderKey: "0@" + (now - 7200000), receivedAt: now - 7199000, itemRev: "9", carrier: "alarm" }], "bridge");
  const rs = ev.mergeEvidence(item2, stale, now);
  ok("旧轮次回执不写入（不污染新轮次）", rs.applied === 0 && item2[0].reminderEvents === undefined);
  ok("旧轮次回执的判据是 stale-round，不是被身份检查顺带挡掉",
    rs.reasons.indexOf("stale-round") >= 0, JSON.stringify(rs));
  // 成对差分：两条事项只差「本轮有没有登记过这个键」
  const freshKey = "0@" + (now + 60000);
  const item2b = [{
    id: "i2b", status: "waiting", triggerAt: now, rev: 9,
    reminderEvents: { [freshKey]: scheduledAt(now + 60000, now) }
  }];
  const fresh = ev.normalizeEvidence(
    [{ itemId: "i2b", reminderKey: freshKey, receivedAt: now + 61000, itemRev: "9", carrier: "alarm" }], "bridge");
  const rf = ev.mergeEvidence(item2b, fresh, now);
  ok("成对差分：仅把原定时刻挪进本轮就必须写入", rf.applied === 1, JSON.stringify(rf));

  // R4 反例（独立验收报告 F06）：原定时刻**落在本轮内**，但这一轮我们从来没登记过。
  // 旧实现只比 `ev.at >= item.triggerAt`，在这里会写出「系统已接收」—— 那是假的。
  const item2c = [{ id: "i2c", status: "waiting", triggerAt: now, rev: 9, reminderEvents: {} }];
  const unreg = ev.normalizeEvidence(
    [{ itemId: "i2c", reminderKey: "0@" + (now + 90000), receivedAt: now + 91000, itemRev: "9", carrier: "alarm" }], "bridge");
  const ru = ev.mergeEvidence(item2c, unreg, now);
  ok("R4 未登记的轮次不写入（宁可尚未确认，不谎报已接收）",
    ru.applied === 0 && ru.unknown === 1 && ru.reasons[0] === "unregistered-round" &&
    Object.keys(item2c[0].reminderEvents).length === 0, JSON.stringify(ru));

  // 独立复验 R-F06 / X1：键**登记过**、原定时刻也落在本轮范围内，但它属于**上一轮**。
  // 「稍后提醒」把触发起点往后挪之后，旧轮的追提醒键照样落在新范围内 ——
  // 只判「登记过」就会让旧回执把新轮抬成「系统已接收」。
  const roundItem = (id) => ({
    id: id, status: "waiting", triggerAt: now, rev: 9,
    reminderEvents: {
      // 当前轮：真的登记过，还没收到证据
      ["0@" + (now + 60000)]: { at: now + 60000, state: "scheduled", roundBase: now },
      // 上一轮留下的历史：原定时刻晚于当前起点，所以范围判据拦不住它
      ["1@" + (now + 1800000)]: { at: now + 1800000, state: "cancelled", roundBase: now - 3600000 }
    }
  });
  ok("R-F06 条目自带轮次身份时以它为准",
    ev.entryRoundBase({ triggerAt: now }, { at: now + 1000, state: "delivered", roundBase: now - 5000 }) === now - 5000);
  ok("Y2 旧版写入的条目没有轮次身份时保持不可验证（不冒充当前轮）",
    ev.entryRoundBase({ triggerAt: now }, { at: now + 1000, state: "delivered" }) === null);
  ok("Y2 对照：旧版 0@triggerAt 首期键可证明属于当前轮",
    ev.entryRoundBase({ triggerAt: now }, { at: now, state: "delivered" }, "0@" + now) === now);
  ok("Y2 旧版追提醒即使落在当前范围也不可从时刻猜成当前轮",
    ev.entryRoundBase({ triggerAt: now }, { at: now + 1800000, state: "delivered" }, "1@" + (now + 1800000)) === null);

  const item2d = [roundItem("i2d")];
  const oldRoundEv = ev.normalizeEvidence(
    [{ itemId: "i2d", reminderKey: "1@" + (now + 1800000), receivedAt: now + 1800000, itemRev: "8", carrier: "alarm" }], "bridge");
  const rd = ev.mergeEvidence(item2d, oldRoundEv, now);
  ok("R-F06 登记过但属于上一轮的键不写入（判据 superseded-round，不是被范围判据顺带挡掉）",
    rd.applied === 0 && rd.unknown === 1 && rd.reasons[0] === "superseded-round", JSON.stringify(rd));
  ok("R-F06 旧轮的键保留为历史（cancelled 不被改写成 delivered）",
    item2d[0].reminderEvents["1@" + (now + 1800000)].state === "cancelled",
    JSON.stringify(item2d[0].reminderEvents));

  // 对照组：同一事项、同一批形状，只把回执换成**当前轮**登记的那条 ⇒ 必须写入
  const item2e = [roundItem("i2e")];
  const newRoundEv = ev.normalizeEvidence(
    [{ itemId: "i2e", reminderKey: "0@" + (now + 60000), receivedAt: now + 61000, itemRev: "9", carrier: "alarm" }], "bridge");
  const re = ev.mergeEvidence(item2e, newRoundEv, now);
  ok("R-F06 对照组：属于当前轮的回执照常写入（上面的拒绝不是通路故障）",
    re.applied === 1 && item2e[0].reminderEvents["0@" + (now + 60000)].state === "delivered", JSON.stringify(re));

  // 展示面：旧轮的 delivered 不能让当前轮显示「系统已接收」
  const statusFixture = (deliveredRound) => ({
    id: "i2f", status: "waiting", triggerAt: now, rev: 9,
    reminderEvents: {
      ["0@" + (now + 60000)]: { at: now + 60000, state: "scheduled", roundBase: now },
      ["1@" + (now + 1800000)]: { at: now + 1800000, state: "delivered", receivedAt: now + 1810000, roundBase: deliveredRound }
    }
  });
  const oldDelivered = ev.evidenceStatusFor(statusFixture(now - 3600000),
    { now: now + 1810000, evidenceReadable: true });
  ok("R-F06 旧轮的 delivered 不抬高当前轮的状态（旧实现：直接显示「系统已接收」）",
    oldDelivered.state !== ev.STATUS.DELIVERED && oldDelivered.text !== ev.STATUS_TEXT.delivered,
    JSON.stringify(oldDelivered));
  const curDelivered = ev.evidenceStatusFor(statusFixture(now),
    { now: now + 1810000, evidenceReadable: true });
  ok("R-F06 对照组：属于当前轮的 delivered 仍然算数",
    curDelivered.state === ev.STATUS.DELIVERED, JSON.stringify(curDelivered));

  // 完成事项不被复活
  const item3 = [{
    id: "i3", status: "archived", completedAt: now - 1000, triggerAt: now - 3600000, rev: 4,
    reminderEvents: { ["0@" + (now - 3600000)]: scheduledAt(now - 3600000, now - 3600000) }
  }];
  ev.mergeEvidence(item3, ev.normalizeEvidence(
    [{ itemId: "i3", reminderKey: "0@" + (now - 3600000), receivedAt: now - 3599000, itemRev: "4", carrier: "alarm" }], "bridge"), now);
  ok("迟到回执不复活已完成事项", item3[0].status === "archived" && item3[0].completedAt === now - 1000);

  // 身份缺失/事项不存在 → unknown，不反推失败
  const bad = ev.normalizeEvidence([{ id: 7, itemId: "i1", receivedAt: now }, { title: "只有标题" }], "bridge");
  const rr = ev.mergeEvidence([baseItem()], bad, now);
  ok("缺身份的证据计入 unknown", rr.unknown === 2 && rr.applied === 0, JSON.stringify(rr));
  ok("unknown 不等于失败（不产生任何失败标记）", rr.reasons.every(x => x === "missing-identity"));
  const orphan = ev.mergeEvidence([baseItem()], ev.normalizeEvidence(
    [{ itemId: "nope", reminderKey: "0@" + now, receivedAt: now, itemRev: "1", carrier: "alarm" }], "bridge"), now);
  ok("事项已不存在 → unknown 而不是指控", orphan.unknown === 1 && orphan.reasons[0] === "item-missing");

  // 展示判定
  const noReg = ev.evidenceStatusFor({ id: "x", triggerAt: now }, { now: now });
  ok("没有登记过排程 → 无法核查（不是漏）", noReg.state === ev.STATUS.UNVERIFIABLE, noReg.state);
  ok("无法核查/未知的文案都不含「漏」", !/漏/.test(noReg.text), noReg.text);

  const pendingItem = { id: "p", triggerAt: now + 600000, reminderEvents: { ["0@" + (now + 600000)]: { at: now + 600000, state: "scheduled", roundBase: now + 600000 } } };
  ok("未到点 → pending", ev.evidenceStatusFor(pendingItem, { now: now }).state === ev.STATUS.PENDING);

  const dueNoEvidence = { id: "d", triggerAt: now - 3600000, reminderEvents: { ["0@" + (now - 3600000)]: { at: now - 3600000, state: "scheduled", roundBase: now - 3600000 } } };
  const st1 = ev.evidenceStatusFor(dueNoEvidence, { now: now });
  ok("到点但缺证据 → unknown", st1.state === ev.STATUS.UNKNOWN, st1.state);
  ok("缺证据的文案只说「尚未确认」", /尚未确认/.test(st1.text), st1.text);
  ok("缺证据绝不判成失败", st1.isMissed === false && !/失败|漏/.test(st1.text));

  const st2 = ev.evidenceStatusFor(dueNoEvidence, { now: now - 3600000 + 30000 });
  ok("刚到点 → processing（不立刻断言结果）", st2.state === ev.STATUS.PROCESSING, st2.state);
  const st3 = ev.evidenceStatusFor(dueNoEvidence, { now: now, evidenceReadable: false });
  ok("证据通道读不到 → unknown（不指控）", st3.state === ev.STATUS.UNKNOWN);
  const st4 = ev.evidenceStatusFor(dueNoEvidence, { now: now, readbackInFlight: true });
  ok("回读进行中 → processing", st4.state === ev.STATUS.PROCESSING);

  const delivered = { id: "z", triggerAt: now - 3600000, reminderEvents: { ["0@" + (now - 3600000)]: { at: now - 3600000, state: "delivered", level: "received", roundBase: now - 3600000 } } };
  const st5 = ev.evidenceStatusFor(delivered, { now: now });
  ok("有证据 → delivered", st5.state === ev.STATUS.DELIVERED);
  ok("有证据也只说「系统已接收」", /系统已接收/.test(st5.text) && !/已读|用户看到/.test(st5.text), st5.text);

  // 乱序：先收到晚轮次、再收到早轮次
  const item4 = [{
    id: "i4", status: "waiting", triggerAt: now - 7200000, rev: 1,
    reminderEvents: {
      ["0@" + (now - 7200000)]: scheduledAt(now - 7200000, now - 7200000),
      ["3@" + (now - 1800000)]: scheduledAt(now - 1800000, now - 7200000)
    }
  }];
  ev.mergeEvidence(item4, ev.normalizeEvidence(
    [{ itemId: "i4", reminderKey: "3@" + (now - 1800000), receivedAt: now - 1799000, itemRev: "1", carrier: "alarm" }], "bridge"), now);
  ev.mergeEvidence(item4, ev.normalizeEvidence(
    [{ itemId: "i4", reminderKey: "0@" + (now - 7200000), receivedAt: now - 7199000, itemRev: "1", carrier: "alarm" }], "bridge"), now);
  ok("乱序到达的两轮证据都能各自关联", Object.keys(item4[0].reminderEvents).length === 2);
  ok("乱序下展示取最新已送达轮次",
    ev.evidenceStatusFor(item4[0], { now: now }).at === now - 1800000);
}

/* ---------- P2-E：真实 AppSetup 工厂（不经 app-core 薄转发） ---------- */
section("P2-E AppSetup — 求值、live 注入、60 秒测试与停铃边界");
{
  // 模块求值不得读状态、注册监听、排程或保存。这里跑的是文件字节，不复用 Node 的 require cache。
  const evaluationCalls = { getState: 0, listener: 0, timer: 0 };
  const evalSandbox = {
    module: { exports: {} }, exports: {},
    setInterval: () => { evaluationCalls.timer++; },
    document: { addEventListener: () => { evaluationCalls.listener++; } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "lib/app-setup.js"), "utf8"), evalSandbox,
    { filename: "lib/app-setup.js" });
  ok("P2-E 模块求值零副作用（不读状态、不绑监听、不起计时器）",
    evaluationCalls.getState === 0 && evaluationCalls.listener === 0 && evaluationCalls.timer === 0 &&
    typeof evalSandbox.module.exports.createAppSetup === "function", JSON.stringify(evaluationCalls));

  function setupFixture(options) {
    options = options || {};
    const listeners = {};
    const nodes = {};
    const makeNode = id => ({
      id: id, hidden: false, innerHTML: "", textContent: "", dataset: {},
      listeners: [],
      addEventListener(name, fn) { this.listeners.push({ name: name, fn: fn }); },
      click() { this.listeners.filter(x => x.name === "click").forEach(x => x.fn({ target: this })); }
    });
    nodes["#btnSetup"] = makeNode("btnSetup");
    nodes["#btnSetup"].hidden = true;
    nodes["#homeSetup"] = makeNode("homeSetup");
    nodes["#setupBody"] = makeNode("setupBody");
    nodes["#setupSub"] = makeNode("setupSub");
    const state = { settings: Object.assign({ setupPromptStarted: false }, options.settings || {}), items: [] };
    let native = options.native || { isNativeAndroid: () => false };
    let status = options.status || { notifications: "granted", notificationsGranted: true, exactAlarm: "granted", scheduledAlarmIds: [] };
    let feedback = options.feedback || {
      TEST_FEEDBACK: [{ value: "heard", label: "我听到了" }, { value: "missed", label: "没收到" }],
      setupSteps: () => ({ steps: [
        { id: "notify", essential: true, title: "允许发通知", why: "通知", denyImpact: "看不到提醒", action: "去授权", done: false },
        { id: "test", title: "60 秒测试", why: "验证", denyImpact: "不影响记录", done: false }
      ], next: { id: "notify" } }),
      testFeedbackVerdict: value => value ? { text: value } : null
    };
    const calls = { saves: 0, schedules: [], cancels: [], stops: [], toasts: [], openSheets: 0, writes: 0, logs: [] };
    let bridge = options.bridge || {
      scheduleAlarm: async value => { calls.schedules.push(value); return { triggerAt: Date.now() + value.delayMs, mode: "alarmClock" }; },
      activeAlarmDeliveries: async () => ({ alarms: [] }),
      stopAlarmDelivery: async value => { calls.stops.push(value); return { stopped: true }; },
      lastAlarmDelivery: async () => null
    };
    const query = sel => {
      if (sel === "#setupEntry" && !nodes[sel] && nodes["#homeSetup"].innerHTML.indexOf("setupEntry") >= 0) nodes[sel] = makeNode("setupEntry");
      if (sel === "#setupEvidence" && !nodes[sel]) nodes[sel] = makeNode("setupEvidence");
      if (sel === "#setupPrimary" && !nodes[sel]) nodes[sel] = makeNode("setupPrimary");
      if (sel === "#setupTestStart" && !nodes[sel]) nodes[sel] = makeNode("setupTestStart");
      if (sel === "#setupTestStop" && !nodes[sel]) nodes[sel] = makeNode("setupTestStop");
      return nodes[sel] || null;
    };
    const deps = {
      query: query, queryAll: () => [], openSheet: () => { calls.openSheets++; },
      toast: (...args) => { calls.toasts.push(args); }, escapeHtml: x => String(x), fmtTime: x => String(x),
      writeIfChanged: (el, html) => { if (el.innerHTML === html) return false; el.innerHTML = html; calls.writes++; delete nodes["#setupEntry"]; return true; },
      getState: () => state, save: () => { calls.saves++; }, renderMe: () => {},
      systemBridge: () => bridge, getNativeReminders: () => native, getNativeReminderStatus: () => status,
      setNativeReminderStatus: value => { status = value; }, getFeedback: () => feedback,
      labLog: msg => { calls.logs.push(msg); }, labCancelAlarms: async value => { calls.cancels.push(value); return { ok: true }; },
      describeAlarmDelivery: d => d.title || "delivery", openBackgroundGuide: async () => false,
      openSystemSetting: async () => false, isNativeAndroidRuntime: () => !!(native.isNativeAndroid && native.isNativeAndroid())
    };
    return {
      app: appSetupMod.createAppSetup(deps), state: state, nodes: nodes, calls: calls,
      setNative: value => { native = value; }, setStatus: value => { status = value; }, setFeedback: value => { feedback = value; },
      setBridge: value => { bridge = value; }
    };
  }

  const live = setupFixture();
  live.app.maybePromptAndroidNotify();
  ok("P2-E live getter：创建后才接入 Android 原生模块，prompt 才显示入口", live.nodes["#btnSetup"].hidden === true);
  live.setNative({ isNativeAndroid: () => true });
  live.app.maybePromptAndroidNotify();
  ok("P2-E live getter：后续 NativeReminders 装配立即生效（不缓存创建时快照）", live.nodes["#btnSetup"].hidden === false);
  live.app.noteFirstRemindSaved({ triggerAt: Date.now() + 60000 });
  const entry = live.nodes["#setupEntry"];
  const writesBefore = live.calls.writes;
  live.app.renderSetupEntry();
  live.app.renderSetupEntry();
  entry.click();
  ok("P2-E 静态 bind 幂等且动态入口 writeIfChanged 短路不叠监听",
    live.nodes["#btnSetup"].listeners.length === 0 && entry.listeners.length === 1 &&
    live.calls.writes === writesBefore && live.calls.openSheets === 1,
    JSON.stringify({ btn: live.nodes["#btnSetup"].listeners.length, entry: entry.listeners.length, writes: live.calls.writes }));
  live.app.bind(); live.app.bind();
  ok("P2-E 静态 #btnSetup bind 实例内幂等", live.nodes["#btnSetup"].listeners.length === 1,
    String(live.nodes["#btnSetup"].listeners.length));

  // 冷启动：原生状态还是初始占位 "unknown" 时，不得先闪「还差 N 步：允许发通知」
  const cold = setupFixture({
    native: { isNativeAndroid: () => true }, settings: { setupPromptStarted: true },
    status: { native: false, notifications: "unknown", exactAlarm: "unknown", reliability: "web" }
  });
  cold.app.renderSetupEntry();
  ok("设置入口：原生状态未读回（unknown）时首页不渲染卡片",
    cold.nodes["#homeSetup"].innerHTML === "", cold.nodes["#homeSetup"].innerHTML);
  cold.setStatus({ notifications: "granted", exactAlarm: "granted", scheduledAlarmIds: [] });
  cold.app.renderSetupEntry();
  ok("设置入口：状态读回后重绘才出现卡片",
    /setupEntry/.test(cold.nodes["#homeSetup"].innerHTML), cold.nodes["#homeSetup"].innerHTML);

  // 首页卡片只为关键缺口（essential）出现；只剩可选步骤 / 测试时不再常驻首页
  const optionalOnly = setupFixture({
    native: { isNativeAndroid: () => true }, settings: { setupPromptStarted: true },
    feedback: {
      TEST_FEEDBACK: [],
      setupSteps: () => ({ steps: [
        { id: "notify", essential: true, done: true, title: "允许发通知" },
        { id: "overlay", done: false, title: "允许锁屏弹窗与悬浮窗" },
        { id: "test", done: false, title: "60 秒测试" }
      ], next: { id: "overlay" } }),
      testFeedbackVerdict: () => null
    }
  });
  optionalOnly.app.renderSetupEntry();
  ok("设置入口：关键权限齐了、只剩可选步骤时首页不出卡片",
    optionalOnly.nodes["#homeSetup"].innerHTML === "", optionalOnly.nodes["#homeSetup"].innerHTML);

  const dismissable = setupFixture({ native: { isNativeAndroid: () => true }, settings: { setupPromptStarted: true } });
  dismissable.app.renderSetupEntry();
  ok("设置入口：卡片带关闭按钮", /setupEntryDismiss/.test(dismissable.nodes["#homeSetup"].innerHTML));
  const cardHtml = dismissable.nodes["#homeSetup"].innerHTML;
  dismissable.state.settings.setupDismissed = true;
  dismissable.app.renderSetupEntry();
  ok("设置入口：关闭（setupDismissed）后首页卡片消失",
    /setupEntry/.test(cardHtml) && dismissable.nodes["#homeSetup"].innerHTML === "",
    dismissable.nodes["#homeSetup"].innerHTML);

  // 防冻结接入真实 Feedback.setupSteps：点进过设置页不关首页卡片；系统回读或测试确认后才消失
  const realFeedback = { TEST_FEEDBACK: feedbackMod.TEST_FEEDBACK, setupSteps: feedbackMod.setupSteps,
    testFeedbackVerdict: feedbackMod.testFeedbackVerdict };
  const bgCard = setupFixture({
    native: { isNativeAndroid: () => true }, settings: { setupPromptStarted: true, backgroundVisited: true },
    status: { notifications: "granted", exactAlarm: "granted", scheduledAlarmIds: [],
      diag: { canDrawOverlays: true, canUseFullScreenIntent: true, ignoringBatteryOptimizations: false } },
    feedback: realFeedback
  });
  bgCard.app.renderSetupEntry();
  const bgHtml = bgCard.nodes["#homeSetup"].innerHTML;
  ok("防冻结：通知与精确提醒都已授权、只点进过后台设置页 ⇒ 首页仍出卡片，下一步是防冻结",
    /还差 1 步/.test(bgHtml) && /允许完全后台运行/.test(bgHtml) && /setupEntryDismiss/.test(bgHtml), bgHtml);
  bgCard.setStatus({ notifications: "granted", exactAlarm: "granted", scheduledAlarmIds: [],
    diag: { canDrawOverlays: true, canUseFullScreenIntent: true, ignoringBatteryOptimizations: true } });
  bgCard.app.renderSetupEntry();
  ok("防冻结：系统回读到忽略电池优化后首页卡片消失", bgCard.nodes["#homeSetup"].innerHTML === "",
    bgCard.nodes["#homeSetup"].innerHTML);
  const bgTested = setupFixture({
    native: { isNativeAndroid: () => true },
    settings: { setupPromptStarted: true, backgroundVisited: true,
      testRun: { startedAt: 1000, feedbackAt: 1100 }, testFeedback: { value: "heard", at: 1100 } },
    status: { notifications: "granted", exactAlarm: "granted", scheduledAlarmIds: [],
      diag: { ignoringBatteryOptimizations: false } },
    feedback: realFeedback
  });
  bgTested.app.renderSetupEntry();
  ok("防冻结：60 秒测试已确认听到 ⇒ 即使厂商开关无法回读，首页也不再提示",
    bgTested.nodes["#homeSetup"].innerHTML === "", bgTested.nodes["#homeSetup"].innerHTML);
  bgCard.setStatus({ notifications: "granted", exactAlarm: "granted", scheduledAlarmIds: [],
    diag: { ignoringBatteryOptimizations: false } });
  bgCard.app.renderSetupEntry();
  bgCard.state.settings.setupDismissed = true;
  bgCard.app.renderSetupEntry();
  ok("防冻结：用户关掉卡片后不再出现（不会成为关不掉的常驻提示）", bgCard.nodes["#homeSetup"].innerHTML === "");

  const doneSetup = beginAsyncSection();
  (async () => {
    const h = setupFixture({ native: { isNativeAndroid: () => true }, settings: { setupPromptStarted: true } });
    const started = await h.app.startSetupTestRun();
    const firstRun = h.state.settings.testRun;
    ok("P2-E 60 秒测试只排独立 90003 闹钟，参数固定为 60000ms",
      started === true && h.calls.schedules.length === 1 && h.calls.schedules[0].id === 90003 &&
      h.calls.schedules[0].delayMs === 60000 && /闹钟测试/.test(h.calls.schedules[0].title), JSON.stringify(h.calls.schedules));
    ok("P2-E 排程成功后才保留本次 run 并保存一次", !!firstRun && firstRun.id === 90003 && h.calls.saves === 1,
      JSON.stringify({ run: firstRun, saves: h.calls.saves }));

    h.setBridge({
      scheduleAlarm: async () => { throw new Error("schedule failed"); }, activeAlarmDeliveries: async () => ({ alarms: [] }),
      stopAlarmDelivery: async () => ({ stopped: true }), lastAlarmDelivery: async () => null
    });
    const beforeFailedRun = h.state.settings.testRun;
    const failedStart = await h.app.startSetupTestRun();
    ok("P2-E 排程失败不创建或替换 testRun，面板可恢复重试", failedStart === false && h.state.settings.testRun === beforeFailedRun,
      JSON.stringify({ failedStart: failedStart, toasts: h.calls.toasts }));

    const run = h.state.settings.testRun;
    run.startedAt = 5000; run.seenAt = null;
    h.setBridge({ lastAlarmDelivery: async () => ({ at: 4000, title: "安心收件箱闹钟测试" }) });
    const oldEvidence = await h.app.setupEvidenceHtml();
    ok("P2-E 旧时间投递不算本次测试", /还没有记录/.test(oldEvidence) && !run.seenAt, oldEvidence);
    h.setBridge({ lastAlarmDelivery: async () => ({ at: 6000, title: "业务提醒" }) });
    const wrongTitleEvidence = await h.app.setupEvidenceHtml();
    ok("P2-E 错标题投递不算本次测试", /还没有记录/.test(wrongTitleEvidence) && !run.seenAt, wrongTitleEvidence);
    h.setBridge({ lastAlarmDelivery: async () => ({ at: 6000, title: "安心收件箱闹钟测试" }) });
    const currentEvidence = await h.app.setupEvidenceHtml();
    ok("P2-E 同次且测试标题的投递才更新 seenAt", /本次测试投递/.test(currentEvidence) && !!run.seenAt, currentEvidence);

    h.setBridge({
      scheduleAlarm: async value => ({ triggerAt: Date.now() + value.delayMs, mode: "alarmClock" }),
      activeAlarmDeliveries: async () => ({ alarms: [] }), stopAlarmDelivery: async () => ({ stopped: true }),
      lastAlarmDelivery: async () => ({ at: 6000, title: "安心收件箱闹钟测试" })
    });
    h.state.settings.testFeedback = { value: "heard", at: 1 };
    const oldFeedback = h.app.testFeedbackButtonsHtml();
    await h.app.startSetupTestRun();
    const retriedFeedback = h.app.testFeedbackButtonsHtml();
    ok("P2-E 重测隔离旧 feedback，不把上次答案标为本次结果", !/chip on/.test(oldFeedback) && !/chip on/.test(retriedFeedback),
      JSON.stringify({ oldFeedback: oldFeedback, retriedFeedback: retriedFeedback }));

    const stopRun = h.state.settings.testRun;
    stopRun.stoppedAt = null;
    h.setBridge({ activeAlarmDeliveries: async () => { throw new Error("read failed"); }, stopAlarmDelivery: async () => ({ stopped: false }) });
    const readFailed = await h.app.stopSetupTestRun();
    ok("P2-E 停铃读失败不写 stoppedAt、不报成功", readFailed === 0 && !stopRun.stoppedAt &&
      h.calls.toasts.some(x => /读不到铃声状态/.test(x[0])), JSON.stringify(h.calls.toasts.slice(-1)));
    h.setBridge({ activeAlarmDeliveries: async () => ({ alarms: [] }), stopAlarmDelivery: async () => ({ stopped: true }) });
    const emptyStopped = await h.app.stopSetupTestRun();
    ok("P2-E 对照：确认空投递才标记 stoppedAt", emptyStopped === 0 && !!stopRun.stoppedAt,
      JSON.stringify({ stoppedAt: stopRun.stoppedAt, toast: h.calls.toasts.slice(-1) }));
    stopRun.stoppedAt = null;
    h.setBridge({ activeAlarmDeliveries: async () => ({ alarms: [{ id: 90003, token: "this-run", receivedAt: stopRun.startedAt + 1 }] }),
      stopAlarmDelivery: async value => { h.calls.stops.push(value); return { stopped: true }; } });
    const trulyStopped = await h.app.stopSetupTestRun();
    ok("P2-E 对照：真实在响且 token 匹配时才停住本次测试", trulyStopped === 1 && !!stopRun.stoppedAt &&
      h.calls.stops.some(x => x.id === 90003 && x.token === "this-run"), JSON.stringify(h.calls.stops));
    doneSetup();
  })().catch(error => { ok("P2-E AppSetup 异步测试未抛出", false, error && error.stack); doneSetup(); });
}

/**
 * 异步段的**收尾门**（计数变量的声明在文件顶部，见 `asyncSectionsPending`）。
 *
 * 本文件此前只有 storage 一段是异步的，`finish()` 就直接写在它的链尾 —— 那等于隐含
 * 假定「异步只有一段」。P2-b 起 app-ui 的确认框也必须被 `await`（它的返回值就是
 * 「确定 / 取消」这个契约本身），再加一段之后，**先到达的那一段不能提前出结果**，
 * 否则后一段的断言会在 `process.exit` 之前被丢掉、结果却看起来是「全过」。
 *
 * 用法：段首 `const done = beginAsyncSection();`，段尾（异步链的最后）`done()`。
 */
function beginAsyncSection() {
  asyncSectionsPending += 1;
  let settled = false;
  return function () {
    if (settled) return;
    settled = true;
    asyncSectionsPending -= 1;
    finish();
  };
}

function finish() {
  // 还有异步段没回话 —— 先不出结果。
  if (asyncSectionsPending > 0) return;
  console.log("\n========== unit results ==========");
  console.log("通过: " + passed + "  失败: " + failed);
  if (failed) {
    failures.forEach(f => console.log("  - " + f));
    process.exit(1);
  }
  console.log("全部通过。");
}
