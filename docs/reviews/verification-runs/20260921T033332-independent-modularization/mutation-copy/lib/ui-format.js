/* UI 纯格式化工具 —— UMD（P2 首批搬移）
 *
 * 为什么单独成文件：这些函数此前都定义在 `app-core.js` 里。它们**不需要 DOM、不需要
 * `state`、不写任何状态** —— 只是「输入 → 字符串」的纯函数，却和几千行编排逻辑挤在
 * 同一个 IIFE 里，于是任何测试想验证「时间怎么显示」都得先把整个 app-core 跑起来。
 *
 * 与 `lib/date-utils.js` 同构：**命名空间挂载**（`AttentionLib.UiFormat`），
 * 不走扁平 `Object.assign`。扁平合并的同名键「谁后加载谁生效」，顺序错了不抛错 ——
 * 那正是拆分前副本得以长期共存的机制。消费方在求值时抓命名空间，拿不到直接抛错。
 *
 * 依赖：`AttentionLib.DatePrimitives`（`sameDay` / `addDays`），必须在其之后加载。
 *
 * 边界：**只放纯函数**（输入 → 字符串/数值，可注入 `now` 做固定时钟测试）。
 * 凡是碰 DOM、碰 `state`、或要有状态的：
 *   · DOM 展示动作（`$` / 弹层 / `toast` / 确认框 / 外链白名单）→ `lib/app-ui.js`；
 *   · 需要读设置或装配会话的 → 各自的视图/表单层。
 * 在「看起来都像工具函数」的地方按**是否碰宿主**划线，而不是按功能名划线。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.UiFormat = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  /**
   * 日历原语来自命名空间导出（显式依赖）。
   * 拿不到就是装配错误，不在这里自带一份 `sameDay` / `addDays` 兜底 ——
   * 那会让「加载顺序错」退化成「换一套日历规则继续跑」。
   */
  const P = (function () {
    if (root && root.AttentionLib && root.AttentionLib.DatePrimitives) return root.AttentionLib.DatePrimitives;
    try {
      if (typeof require === "function") return require("./date-utils.js");
    } catch (error) {}
    return null;
  })();

  if (!P) {
    throw new Error("ui-format.js: 缺少 lib/date-utils.js（日历原语唯一来源）。请检查 index.html 的脚本顺序。");
  }

  const sameDay = P.sameDay;
  const addDays = P.addDays;

  function pad(n) { return String(n).padStart(2, "0"); }

  /**
   * 事项 id 生成。
   *
   * 注意：**不保证全局唯一**（时间戳 + 随机后缀，同一毫秒内有极小碰撞概率）。
   * 导入数据里的 id 可以任意字符串，所以任何拼进 HTML 的 id 都必须走 `escapeAttr`。
   */
  function uid() {
    return "i_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  /** 文本节点转义。 */
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  /**
   * **属性上下文**转义。
   *
   * 字符集与 `escapeHtml` 相同（`& < > " '` 已覆盖能在属性里闭合引号的每一个字符），
   * 但语义不同、也必须分开命名：`escapeHtml` 是给**文本节点**用的，这里是给
   * `attr="…"` 用的。事项 id 未必由内部 `uid()` 生成 —— 导入数据里可以带任意字符串，
   * 直接拼进 `data-id="…"` 就能闭合引号、往标签里塞新属性。
   * 分开命名是为了让「改转义字符集」的人一眼看到属性侧也是消费者，不会只改一边。
   */
  function escapeAttr(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  /**
   * 绝对时间 → 「今天 09:00」/「明天 09:00」/「昨天 09:00」/「9月23日 09:00」，
   * 跨年时带上年份。`now` 可注入，便于固定时钟测试。
   */
  function fmtTime(ts, now) {
    if (!ts) return "";
    const d = new Date(ts);
    const ref = now ? new Date(now) : new Date();
    const t = pad(d.getHours()) + ":" + pad(d.getMinutes());
    if (sameDay(d, ref)) return "今天 " + t;
    if (sameDay(d, addDays(ref, 1))) return "明天 " + t;
    if (sameDay(d, addDays(ref, -1))) return "昨天 " + t;
    const md = (d.getMonth() + 1) + "月" + d.getDate() + "日";
    if (d.getFullYear() !== ref.getFullYear()) return d.getFullYear() + "年" + md + " " + t;
    return md + " " + t;
  }

  /** 同上，但不含钟点。 */
  function fmtDate(ts, now) {
    if (!ts) return "";
    const d = new Date(ts);
    const ref = now ? new Date(now) : new Date();
    if (sameDay(d, ref)) return "今天";
    if (sameDay(d, addDays(ref, 1))) return "明天";
    if (sameDay(d, addDays(ref, -1))) return "昨天";
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }

  /** 相对「现在」的到期描述：「3 小时后」/「已过 2 小时」。`now` 可注入。 */
  function relDue(ts, now) {
    const ref = now == null ? Date.now() : now;
    const diff = ts - ref;
    const abs = Math.abs(diff);
    const h = Math.round(abs / 3600000);
    if (diff < 0) {
      if (abs < 3600000) return "已过 " + Math.max(1, Math.round(abs / 60000)) + " 分钟";
      if (h < 24) return "已过 " + h + " 小时";
      return "已过 " + Math.round(abs / 86400000) + " 天";
    }
    if (abs < 60000) return "现在";
    if (abs < 3600000) return Math.round(abs / 60000) + " 分钟后";
    if (abs < 86400000) return h + " 小时后";
    return Math.round(abs / 86400000) + " 天后";
  }

  /**
   * 归档/列表用的「日」标签：今天 / 昨天 / `9月23日` / 跨年带年份。
   *
   * 与 `fmtDate` **刻意不合并**（不是遗漏）：
   *   · 空值语义不同 —— `fmtDate(null)` = `""`，`dayLabel(null)` = `"更早"`；
   *   · `dayLabel` 没有「明天」分支，跨年时回**完整年月日**，`fmtDate` 不回。
   * 合并任何一条都会改动既有显示，属于行为变更，须单独立项。
   */
  function dayLabel(ts, now) {
    if (!ts) return "更早";
    const d = new Date(ts);
    const ref = now ? new Date(now) : new Date();
    if (sameDay(d, ref)) return "今天";
    if (sameDay(d, addDays(ref, -1))) return "昨天";
    if (d.getFullYear() !== ref.getFullYear()) {
      return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
    }
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }

  /** 时间戳 → `<input type="datetime-local">` 的本地串（不含秒）。 */
  function toLocalInput(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  /** `datetime-local` 串 → 时间戳；解析不出返回 `null`（不兜底成「现在」）。 */
  function parseLocalInput(v) {
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }

  /**
   * Minimal markdown renderer。
   *
   * 先整体 `escapeHtml` 再往里插标签 —— 顺序不能反，否则用户内容里的 `<script>` 会被当成
   * 我们自己生成的标签放过。链接只认 `http(s)`，其余一律留在转义后的文本里。
   */
  function renderMarkdown(src) {
    let text = escapeHtml(src || "");
    // fenced code
    text = text.replace(/```([\s\S]*?)```/g, (_, code) => "<pre><code>" + code.trim() + "</code></pre>");
    // headings
    text = text.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    text = text.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    text = text.replace(/^# (.+)$/gm, "<h1>$1</h1>");
    // blockquote
    text = text.replace(/^&gt; (.+)$/gm, "<blockquote><p>$1</p></blockquote>");
    // bold / italic / code
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    // links
    text = text.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // lists
    text = text.replace(/(?:^|\n)((?:- .+(?:\n|$))+)/g, (m, block) => {
      const items = block.trim().split(/\n/).map(l => "<li>" + l.replace(/^- /, "") + "</li>").join("");
      return "\n<ul>" + items + "</ul>";
    });
    text = text.replace(/(?:^|\n)((?:\d+\. .+(?:\n|$))+)/g, (m, block) => {
      const items = block.trim().split(/\n/).map(l => "<li>" + l.replace(/^\d+\. /, "") + "</li>").join("");
      return "\n<ol>" + items + "</ol>";
    });
    // paragraphs
    text = text.split(/\n{2,}/).map(chunk => {
      const t = chunk.trim();
      if (!t) return "";
      if (/^<(h\d|ul|ol|pre|blockquote)/.test(t)) return t;
      return "<p>" + t.replace(/\n/g, "<br/>") + "</p>";
    }).join("\n");
    return text;
  }

  return {
    pad: pad,
    uid: uid,
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    fmtTime: fmtTime,
    fmtDate: fmtDate,
    relDue: relDue,
    dayLabel: dayLabel,
    toLocalInput: toLocalInput,
    parseLocalInput: parseLocalInput,
    renderMarkdown: renderMarkdown
  };
});
