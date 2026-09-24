/* 共用展示能力（DOM 层）—— UMD（P2 搬移）
 *
 * 为什么单独成文件：`$` / `$$` / 弹层 / `toast` / 确认框 / 外链白名单此前都定义在
 * `app-core.js` 里。它们**不需要 `state`、不写业务数据**，只负责「把话说给用户」，
 * 却和几千行编排逻辑挤在同一个 IIFE 里 —— 于是任何测试想验证「保存失败会不会弹提示」
 * 都得先把整个 app-core 跑起来。
 *
 * 边界（与 `lib/ui-format.js` 的分工）：
 *   · `ui-format.js` —— **纯函数**：输入 → 字符串（时间显示、转义、Markdown、补零、id）。
 *   · 本文件 —— **碰 DOM 的展示动作**：查询、弹层开关、toast、确认框，以及外链的
 *     「安全输出」判定（它决定一段用户数据能不能进 `href`）。
 *
 * 装配方式：导出 `createUi(deps)`，由**入口统一实例化**，不在模块求值时做任何事 ——
 * 本模块求值不注册监听、不开定时器、不碰全局状态；`toast` 的定时器只在第一次
 * 调用 `toast()` 时才建立。
 *
 * 依赖注入为什么是**函数**而不是值：`isFeedbackSuppressed` 对应 app-core 里那个会
 * 在「用户操作重放」期间临时置真的标志位。装配发生在 IIFE 顶部，那一刻它必然是
 * `false`；按值传进来就会把整段重放期的抑制逻辑钉死成「永远不抑制」。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.AppUi = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  /**
   * O3：可点击外部链接的**协议白名单**。
   *
   * 只放行「解析后协议是 `http:` / `https:`」的串，其余一律返回 `null`，
   * 由调用方降级成转义后的**纯文本**（原始数据照旧保留在 `it.url` 里，不静默删除）。
   *
   * 为什么不能用 `startsWith("http")` 或 `escapeHtml` 代替：
   *  · URL 解析器会先剔除 TAB / LF / CR —— `"java\nscript:alert(1)"` 的协议其实是
   *    `javascript:`，只看字面前缀根本拦不到；`" javascript:…"` 同理；
   *  · `escapeHtml` 只处理引号，对协议完全无能为力，`href` 里照样是可执行的
   *    `javascript:` / `data:`。
   * 因此判定必须落在**解析结果**上，而不是字形上。
   *
   * 解析器不可用（老环境 / 提供不了构造函数的测试替身）时退到**保守**字形判定：
   * 仍然不是前缀检查，而是要求完整的绝对 URL 结构（协议 + 非空格授权段 + 无空白），
   * 宁可把形态不明的串降级成纯文本，也不放它进 `href`。
   * —— 这条降级是**登记在案**的：触发条件 = 运行环境没有 `URL` 构造器；
   *    唯一实现 = 本函数；失败反馈 = 返回 `null`（调用方渲染为纯文本）；覆盖用例 =
   *    `test-regressions.js` 的危险 URL 矩阵。
   */
  function safeExternalHref(raw) {
    if (raw == null) return null;
    const trimmed = String(raw).trim();
    if (!trimmed) return null;
    // 含控制字符（含 TAB/LF/CR）一律拒绝：解析器会「剔除后再解析」，
    // 于是 `java\nscript:…` 会变成「看着不像 javascript:、实际就是 javascript:」。
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;

    if (typeof URL === "function") {
      let parsed;
      try {
        parsed = new URL(trimmed);
      } catch (error) {
        // 浏览器提供了解析器却判定输入无效时，不能再用较宽松的字形规则把它放行。
        return null;
      }
      const protocol = String(parsed.protocol || "").toLowerCase();
      return protocol === "http:" || protocol === "https:" ? trimmed : null;
    }

    // 仅在运行环境确实没有 URL 构造器时使用保守兼容分支。
    if (!/^https?:\/\//i.test(trimmed)) return null;
    if (/\s/.test(trimmed)) return null;
    const authority = trimmed.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
    if (!authority) return null;
    if (!/^[A-Za-z0-9._~%!$&'()*+,;=:@\[\]-]+$/.test(authority)) return null;
    return trimmed;
  }

  /**
   * 造一份「共用展示能力」实例。
   *
   * `deps.isFeedbackSuppressed()` —— 重放用户操作期间返回真值，此时不再重复弹提示
   * （那一次提示在用户操作时已经弹过了）。**每次调用都重新取值**，不缓存。
   */
  function createUi(deps) {
    deps = deps || {};
    const isFeedbackSuppressed = typeof deps.isFeedbackSuppressed === "function"
      ? deps.isFeedbackSuppressed
      : function () { return false; };

    // 延迟解析 `document`：不闭包捕获求值期的那个对象 —— 宿主可能替换它
    // （测试替身 / WebView 注入）。写法与原实现逐字一致。
    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

    function openSheet(id) {
      $("#backdrop").classList.add("show");
      $("#" + id).classList.add("open");
    }
    function closeSheet(id) {
      $("#" + id).classList.remove("open");
      if (!$$(".sheet.open").length) $("#backdrop").classList.remove("show");
    }
    function closeAllSheets() {
      $$(".sheet").forEach(s => s.classList.remove("open"));
      $("#backdrop").classList.remove("show");
    }

    /* In-app confirm (preview may block native confirm) */
    function confirmDialog(message, title) {
      return new Promise((resolve) => {
        const sheet = $("#sheetConfirm");
        const body = $("#confirmBody");
        const titleEl = $("#confirmTitle");
        if (!sheet || !body) {
          // last resort
          try { resolve(window.confirm(message)); } catch (e) { resolve(true); }
          return;
        }
        titleEl.textContent = title || "确认";
        body.textContent = message || "确定继续？";
        openSheet("sheetConfirm");

        const cleanup = (val) => {
          $("#confirmOk").onclick = null;
          $("#confirmCancel").onclick = null;
          $("#confirmClose").onclick = null;
          closeSheet("sheetConfirm");
          resolve(val);
        };
        $("#confirmOk").onclick = () => cleanup(true);
        $("#confirmCancel").onclick = () => cleanup(false);
        $("#confirmClose").onclick = () => cleanup(false);
      });
    }

    let toastTimer = null;
    /**
     * 浮动提示。
     *
     * `second` 是 UX-C03/A03 需要的**第二个动作**（例如「查看」旁边的「撤销」）——
     * 一个提示槽只有一个按钮时，「撤销」这种限时入口就没有位置，
     * 会被迫缩成不可点的一句说明，等于没有恢复路径。
     */
    function toast(msg, actionLabel, onAction, second, opts) {
      // M1：重放用户操作时不重复弹提示 —— 那一次提示在用户操作时已经弹过了
      if (isFeedbackSuppressed()) return;
      const t = $("#toast"), a = $("#toastAction"), b = $("#toastAction2");
      $("#toastText").textContent = msg;
      if (actionLabel) {
        a.hidden = false;
        a.textContent = actionLabel;
        a.onclick = () => { hideToast(); if (onAction) onAction(); };
      } else {
        a.hidden = true;
        a.onclick = null;
      }
      if (b) {
        if (second && second.label) {
          b.hidden = false;
          b.textContent = second.label;
          b.onclick = () => { hideToast(); if (second.onClick) second.onClick(); };
        } else {
          b.hidden = true;
          b.onclick = null;
        }
      }
      t.classList.add("show");
      clearTimeout(toastTimer);
      const hasAction = !!(actionLabel || (second && second.label));
      const duration = (opts && opts.durationMs) || (hasAction ? 5000 : 2400);
      toastTimer = setTimeout(hideToast, duration);
    }
    function hideToast() { $("#toast").classList.remove("show"); }

    return {
      $: $,
      $$: $$,
      openSheet: openSheet,
      closeSheet: closeSheet,
      closeAllSheets: closeAllSheets,
      confirmDialog: confirmDialog,
      toast: toast,
      hideToast: hideToast
    };
  }

  return {
    createUi: createUi,
    safeExternalHref: safeExternalHref
  };
});
