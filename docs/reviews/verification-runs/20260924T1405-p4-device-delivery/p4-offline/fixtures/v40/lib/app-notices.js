/* P3-I-R notices layer: home notice bar & startup light summary.
 *
 * 为什么这些职责不能留在入口：它们**是**具体业务判定与 DOM 渲染 ——
 *   · `homeNoticeVerdict` 是四档断链判定 + 文案纪律（纯函数，可行为级断言）；
 *   · `renderHomeNotice` 是 `#homeNotice` 的单写入者渲染；
 *   · `maybeDailySummary` 是「今日新增/重要」的计数与轻量摘要通知。
 * 入口保留同名薄转发只为历史契约与测试接口，实现只此一份。
 *
 * UMD factory: evaluation performs no I/O, no DOM querying, and no state mutation.
 */
(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.AppNotices = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";

  function createAppNotices(input) {
    const deps = input || {};
    const REQUIRED_DEPS = [
      "getStatus",
      "getState",
      "isNativeAndroidRuntime",
      "query",
      "escapeHtml",
      "writeIfChanged",
      "openSheet",
      "refreshNotifyLab",
      "render",
      "save",
      "toast",
      "showSystemNotification",
      "startOfDay"
    ];
    REQUIRED_DEPS.forEach(function(name) {
      if (typeof deps[name] !== "function") {
        throw new Error("createAppNotices(deps) 缺少必要依赖：" + name);
      }
    });

    function getNow() {
      return typeof deps.now === "function" ? deps.now() : Date.now();
    }

    /**
     * A-2 / D68（2026-09-19）：后台提醒链路断了，**首页**必须直说。
     *
     * 依据（基线既有条款，非新增需求）：
     *   · §473「通知权限关闭 → 首页明确告知『无法保证提醒』；恢复权限后自动 Reconcile」
     *   · AC-14「不得继续伪装正常」
     *   · §305「关键能力不得偷偷降级而不告知」
     *
     * 此前这条只落在「我的」页（renderPwaStatus）与自检面板（renderBackgroundVerdict），
     * 而用户天天看的是**首页** —— 于是「关掉 App 就不响」在首页一个字都看不出来，
     * 界面照常平静。这正是 H-08 能长期存活的原因：缺陷是静默的，界面在撒谎。
     *
     * 纯函数：只吃 (status, settings, native)，输出 null 或一条文案，便于行为级断言。
     *
     * 红线：**只在能确证断链时出声**。`notifications === "unknown"` 是「还没问过」，
     * 不是「没有」；冷启动时桥晚到几秒，此时弹警告就是拿新误报换旧误报。
     * 故一切「未定」状态一律返回 null。
     *
     * 范围边界（刻意）：`exactAlarm === "denied"` 不进首页 —— 它只让**到达时刻**可能被推迟，
     * 不产生「关掉 App 就没有提醒」这类硬断链，且已在「我的」页如实标注「时间可能延迟」。
     * 首页只在「你会有提醒」这个承诺被打破时开口。
     */
    function homeNoticeVerdict(status, settings, native) {
      if (!native) return null;
      const s = status || {};
      // ① 用户自己关了总开关 —— 与「系统权限没给」是两件事，必须分开说（Q6 既有结论）。
      //    放最前：此时把他引去授权，他授完权仍然不响（开关还是关的），是反复授权却始终不响的老路。
      if (!(settings && settings.notify)) {
        return {
          kind: "switch",
          title: "后台提醒已关闭",
          text: "关掉 App 后不会有任何提醒。到「我的 → 本地通知」把它打开。"
        };
      }
      // ② 系统通知权限没给 —— H-08 的根因落点，也是唯一「用户能自己修好」的断链
      //
      // 文案纪律（D59 的直接教训）：**不得把「响了但没亮屏」反着报成「完全静默」**。
      // D59 之后声音与振动归 AlarmRingService（mediaPlayback 前台服务，不需要通知权限），
      // 所以「闹钟不响」是错的；真正丢的是**通知**与**屏幕**（setFullScreenIntent 是
      // Notification 的属性，通知发不出去系统就不会替我们全屏）。
      // 也刻意不说成「只剩铃声」——深冻结态的 ROM 连服务都起不来，那时什么都没有。
      if (s.notifications === "denied") {
        return {
          kind: "permission",
          title: "无法保证提醒",
          text: "系统通知权限未授予：关掉 App 后不会有通知，屏幕也不会亮 —— 可能只剩铃声与振动。点这里去授权。"
        };
      }
      // ③ 原生桥始终没就绪（等满 10s 仍不可用）—— 整条原生链路静默消失
      if (s.notifications === "unavailable" || s.bridgeNotReady) {
        return {
          kind: "bridge",
          title: "无法保证提醒",
          text: "提醒能力未就绪：请完全退出后重开应用，再做一次提醒自检。"
        };
      }
      // ④ 对账失败 —— 排程没落进系统
      if (s.reliability === "error") {
        return {
          kind: "error",
          title: "无法保证提醒",
          text: "提醒同步失败，排程可能没落进系统。请打开提醒自检重新排程。"
        };
      }
      return null;
    }

    /**
     * A-2：把 verdict 渲染到首页顶部。断链消失时**主动清空** ——
     * 否则权限恢复后这句警告会一直挂着，变成新的「界面在撒谎」。
     *
     * `#homeNotice` 是**单一写入者**容器：内容逐字节相同就不重建 DOM，
     * 免得焦点/滚动位置/按钮忙碌态被一次等价更新打断（见 `writeIfChanged` 的说明）。
     */
    function renderHomeNotice() {
      const host = deps.query("#homeNotice");
      if (!host) return null;
      const verdict = homeNoticeVerdict(
        deps.getStatus(),
        deps.getState().settings,
        deps.isNativeAndroidRuntime()
      );
      if (!verdict) {
        deps.writeIfChanged(host, "");
        return null;
      }
      const html =
        '<button class="soft-entry notice-entry" id="homeNoticeBtn" data-notice-kind="' + verdict.kind + '">' +
        '<span><span class="notice-title">' + deps.escapeHtml(verdict.title) + "</span><br>" +
        '<span style="font-size:0.78rem;color:var(--muted)">' + deps.escapeHtml(verdict.text) + "</span></span>" +
        '<span style="color:var(--muted)">›</span></button>';
      // 内容没变 ⇒ DOM 不重建，监听也保持原样（旧闭包读的是同一个 verdict，行为一致）。
      if (!deps.writeIfChanged(host, html)) return verdict;
      const btn = deps.query("#homeNoticeBtn");
      if (btn) {
        btn.addEventListener("click", function() {
          // 总开关的修法在「我的」页；权限/桥/对账的修法在自检面板（那里有「1. 申请通知权限」）
          if (verdict.kind === "switch") {
            deps.getState().ui.tab = "me";
            deps.render();
            return;
          }
          deps.openSheet("sheetNotifyLab");
          deps.refreshNotifyLab();
        });
      }
      return verdict;
    }

    /**
     * 每日轻量摘要（每 20 小时至多一次）：今天新增了几条、其中几条重要。
     *
     * 它只做两件事：把「今天新增/重要」数出来，并按判定结果**同时**给应用内 toast 与
     * 系统通知。判定与文案只此一份，入口不再保留第二份计数逻辑。
     */
    function maybeDailySummary() {
      const state = deps.getState();
      if (!state.settings.dailySummary) return null;
      const last = state.settings.lastSummaryAt || 0;
      if (getNow() - last < 20 * 3600000) return null;
      // ⚠️ 这里必须是 `new Date(getNow())` 而不是 `new Date()`：同一函数里的节流
      // （`getNow() - last`）和 `lastSummaryAt` 都走注入的时间源，若"今天"偷偷改读真实
      // 墙钟，函数就同时挂在两个时钟上 —— 表现是跨过本地午夜后计数整体错位，
      // 而且**不可复现**（同一份测试在午夜前后会给出相反结论）。
      const today = deps.startOfDay(new Date(getNow())).getTime();
      const added = state.items.filter(function(it) { return it.createdAt >= today; }).length;
      const important = state.items.filter(function(it) {
        return it.createdAt >= today && (it.priority === "important" || it.priority === "critical");
      }).length;
      state.settings.lastSummaryAt = getNow();
      deps.save();
      if (added >= 3 || important > 0) {
        const msg = "今天新增 " + added + " 条未来关注" + (important ? "，其中 " + important + " 条重要" : "");
        deps.toast(msg);
        deps.showSystemNotification({
          title: "安心收件箱 · 今日摘要", body: msg,
          tag: "daily-summary", requireInteraction: false
        });
        return msg;
      }
      return null;
    }

    return {
      homeNoticeVerdict: homeNoticeVerdict,
      renderHomeNotice: renderHomeNotice,
      maybeDailySummary: maybeDailySummary
    };
  }

  return {
    createAppNotices: createAppNotices
  };
});
