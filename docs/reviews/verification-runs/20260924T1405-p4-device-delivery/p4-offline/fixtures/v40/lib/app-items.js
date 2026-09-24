/* P3-D item commands and series repeat derivation layer. UMD factory; evaluation performs no IO or state mutation. */
(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.AppItems = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";

  function createAppItems(input) {
    const deps = input || {};
    const REQUIRED_DEPS = [
      "getItems", "setItems", "getSettings", "save", "render", "toast", "fmtTime", "toLocalInput",
      "uid", "bumpRev", "isTerminal", "normalizeItem", "makeItem", "resolveDeliveryMode",
      "nextRepeatTrigger", "takeReplayCreatedId", "isFeedbackSuppressed", "inflightDepth",
      "runUserOp", "wrapUserOp", "openSnoozeSheet", "openRestoreSnooze", "goToArchive",
      "markUndoNativeCheckPending", "queueNativeReminderSync", "isFallbackSuppressed",
      "inQuietHours", "quietEnd", "deadlineStageKeyOf", "applyWindowTrigger"
    ];
    REQUIRED_DEPS.forEach(function(name) {
      if (typeof deps[name] !== "function") {
        throw new Error("createAppItems(deps) 缺少依赖：" + name);
      }
    });

    let lastCompleteUndoState = null;

    function getCompleteUndoMs() {
      if (typeof deps.getUndoWindowMs === "function") return deps.getUndoWindowMs();
      if (typeof deps.undoWindowMs === "number") return deps.undoWindowMs;
      return 8000;
    }

    /**
     * F3：保证周期事项有稳定的系列身份。
     * 「停止重复」必须能找到 ACK 生成的未来实例 —— 否则它会带着 repeat 继续提醒、
     * 继续派生周期，界面却提示「周期已终止并归档」。
     */
    function ensureSeriesId(it) {
      if (!it) return null;
      if (!it.repeat || !it.repeat.every) return it.seriesId || null;
      if (!it.seriesId) it.seriesId = "s_" + deps.uid();
      return it.seriesId;
    }

    function seriesMembers(seriesId, exceptId, sourceItem) {
      const items = deps.getItems() || [];
      if (seriesId) {
        return items.filter(x =>
          x && x.id !== exceptId && x.seriesId === seriesId && !deps.isTerminal(x));
      }
      if (sourceItem && sourceItem.repeat && sourceItem.repeat.every) {
        return items.filter(x =>
          x && x.id !== exceptId && !deps.isTerminal(x) &&
          x.title === sourceItem.title &&
          x.projectId === sourceItem.projectId &&
          x.repeat && x.repeat.every === sourceItem.repeat.every);
      }
      return [];
    }

    /**
     * G4：该实例是否「尚未开始」—— 规则派生出来、用户还**从未接触过**。
     *
     * 停止重复时要区分两类同系列事项：
     *  · 未开始的未来实例：只是规则的投影，随规则一起归档（不写 completedAt）；
     *  · 已经交付/确认过的历史实例：用户真的处理过，必须原样保留业务状态。
     * 判据用生命周期证据（确认时间 / 送达时间 / 稍后时间）而不是时钟 ——
     * 「时刻已过」不代表用户已经看过（红线：通知送达 ≠ 用户看到）。
     */
    function isUnstartedInstance(it) {
      if (!it || deps.isTerminal(it)) return false;
      if (it.acknowledgedAt || it.deliveredAt || it.snoozedAt) return false;
      return it.status === "waiting";
    }

    /**
     * L03：生成周期的下一条实例 —— 「完成本次实例」，原记录不被改写。
     * 返回新事项，未生成时返回 null。
     */
    function spawnNextInstance(it, fromTs) {
      const nextTrigger = deps.nextRepeatTrigger(it, fromTs);
      if (!nextTrigger) return null;
      const preferredId = deps.takeReplayCreatedId();
      const items = deps.getItems() || [];
      const existing = items.find(x => x && x.repeatParentId === it.id);
      if (existing) {
        if (preferredId && existing.id !== preferredId && !items.some(x => x && x.id === preferredId)) {
          existing.id = preferredId;
        }
        return existing;
      }
      const next = deps.makeItem({
        id: preferredId || deps.uid(),
        title: it.title,
        note: it.note,
        tags: it.tags ? it.tags.slice() : [],
        url: it.url,
        projectId: it.projectId,
        priority: it.priority,
        status: "waiting",
        repeat: it.repeat,
        seriesId: ensureSeriesId(it),
        repeatParentId: it.id,
        triggerAt: nextTrigger,
        scheduleBasis: "wall-clock",
        localTrigger: deps.toLocalInput(nextTrigger),
        deadlineAt: null,
        // 下一周期继承投递方式快照（有标记仍为 alarm）
        delivery_mode: deps.resolveDeliveryMode(it.priority)
      });
      items.push(next);
      return next;
    }

    /**
     * 归档一条事项时，周期是否需要顺延到下一期。
     *
     * `calendar` 由**完成**推进；`ack` 由**确认**推进 —— 已经由 ACK 推进过（`ackAdvancedAt`）
     * 就不再重复推进（V04：否则活跃实例归零）。
     *
     * K1：这条规则有两个调用方 —— 用户点「完成」，以及原生草稿提交成功后重放该命令。
     * 必须共用一处实现，否则两边的判断会各自漂移。
     */
    function advanceSeriesOnArchive(it) {
      if (!it || !it.repeat || !it.repeat.every) return null;
      const ackBased = it.repeat.mode === "ack";
      if (ackBased && it.ackAdvancedAt) return null;
      return spawnNextInstance(it, ackBased ? (it.acknowledgedAt || Date.now()) : null);
    }

    function promoteDue(now) {
      // 隔离草稿尚未提交时，可见 state 仍是最后确认状态；自动推进下一拍即可重算。
      if (deps.inflightDepth() > 0) return false;
      now = now || Date.now();
      let changed = false;
      const items = deps.getItems() || [];
      items.forEach(it => {
        if (!it) return;
        // D17：Review 开启时，只有「系统兜底时间」的记录不因其兜底时间进 due；
        // 有真实时间的待整理记录照常提醒，Review 关闭时兜底记录也退为普通事项。
        // V06：抑制只作用于**普通提醒**，绝不能连截止保护一起跳过（INV-05）。
        const fallbackSuppressed = deps.isFallbackSuppressed(it);
        if (!fallbackSuppressed && (it.status === "waiting" || it.status === "snoozed")) {
          // 柔性窗口：仅对 waiting 生效，避免覆盖用户 snooze
          if (it.status === "waiting" && (it.windowStart || it.windowEnd)) {
            const winTs = deps.applyWindowTrigger(it, now);
            if (winTs && winTs !== it.triggerAt) { it.triggerAt = winTs; changed = true; }
          }
          if (it.triggerAt && it.triggerAt <= now) {
            if (it.priority === "normal" && deps.inQuietHours(new Date(now))) {
              const end = deps.quietEnd(new Date(now));
              if (it.triggerAt < end) { it.triggerAt = end; changed = true; }
              return;
            }
            it.status = "due";
            it.deliveredAt = now;
            it.remindCount = Math.max(1, it.remindCount || 0);
            it.lastRemindAt = now;
            it.lastAlertShownAt = null;
            changed = true;
          }
        }
        // L02 / INV-05：截止保护**分阶段**，每个阶段有稳定身份与消费状态。
        // ACK 结束当前阶段的事件，只有到下一个保护点才会再次唤醒 ——
        // 否则「临近截止时点我知道了」会在下一次 render 里立刻变回 due，确认按钮形同虚设。
        if (it.deadlineAt && !it.deadlinePaused && !deps.isTerminal(it)) {
          const stageKey = deps.deadlineStageKeyOf(it.deadlineAt, now);
          if (stageKey && it.deadlineStageKey !== stageKey) {
            it.deadlineStageKey = stageKey;
            it.status = "due";
            it.deliveredAt = now;
            it.remindCount = 0;
            it.lastRemindAt = now;
            it.lastAlertShownAt = null;
            it.dismissedUntil = null;
            deps.bumpRev(it);
            changed = true;
          }
        }
      });
      if (changed) deps.save();
    }

    /**
     * 我知道了 —— 只表示「看到了」，不等于完成（红线：Acknowledged ≠ Completed）。
     *
     * L03：周期分两种语义，必须分开兑现承诺
     *  · `mode: "ack"`   「ACK 后计时」→ 由**确认**推进到下一周期
     *  · `mode: "calendar"`「日历规则」→ 由**完成**推进，ACK 不改变原定日期
     * V04：ACK 推进必须**新建实例**。就地把 triggerAt 改到下一期会把「本次实例」与
     *      「下一期」混成同一条记录 —— 随后完成本次实例时，下一期会被一起归档（活跃实例归零）。
     * L04：终态保护 —— 已完成 / 已归档的事项不接受旧通知的 ACK。
     */
    function rawAckItem(id, silent) {
      const items = deps.getItems() || [];
      const it = items.find(x => x && x.id === id);
      if (!it) return false;
      if (deps.isTerminal(it)) return false;
      const now = Date.now();
      it.status = "acknowledged";
      it.acknowledgedAt = now;
      it.lastRemindAt = null;
      it.dismissedUntil = null;
      if (it.repeat && it.repeat.every && it.repeat.mode === "ack") {
        if (spawnNextInstance(it, now)) it.ackAdvancedAt = now;
      }
      deps.bumpRev(it);
      deps.save();
      if (!silent) {
        // UX-A01：第一次点「我知道了」时用**非阻塞**反馈说清后果，并就地给出「稍后提醒」入口。
        // 文案纪律：不得承诺「以后不再提醒」—— 截止保护与 ACK 型周期都会再回来。
        const settings = deps.getSettings() || {};
        const first = !settings.ackExplained;
        if (first) {
          settings.ackExplained = true;
          deps.save();
        }
        const spec = deps.actionSpec ? deps.actionSpec("ack") : null;
        if (first) {
          deps.toast(
            (spec && spec.firstTimeText) || "已停止本轮催促，这件事仍未完成",
            (spec && spec.firstTimeAction) || "稍后提醒",
            () => deps.openSnoozeSheet(id)
          );
        } else {
          deps.toast((spec && spec.sub) || "已停止本轮催促 · 仍未完成");
        }
      }
      deps.render();
      return true;
    }

    /**
     * 完成 —— 归档当前实例。
     *
     * L03：`calendar` 周期从这里推进，且锚定**原定日期**而不是完成时刻
     *      （否则「每月 1 日」会因为晚几天完成而漂成每月 5 日）。
     *      `ack` 周期已经由 ACK 推进过，不再重复生成下期。
     * L04：终态保护 —— 同一条完成事件重复投递时只能推进一次周期。
     */
    function rawCompleteItem(id) {
      const items = deps.getItems() || [];
      const it = items.find(x => x && x.id === id);
      if (!it) return false;
      if (deps.isTerminal(it)) return false;
      const prev = {
        status: it.status,
        completedAt: it.completedAt || null,
        dismissedUntil: it.dismissedUntil == null ? null : it.dismissedUntil,
        acknowledgedAt: it.acknowledgedAt == null ? null : it.acknowledgedAt,
        ackAdvancedAt: it.ackAdvancedAt == null ? null : it.ackAdvancedAt,
        lastRemindAt: it.lastRemindAt == null ? null : it.lastRemindAt
      };
      const beforeIds = new Set(items.map(x => x && x.id));
      it.status = "archived";
      it.completedAt = Date.now();
      it.dismissedUntil = null;
      advanceSeriesOnArchive(it);
      deps.bumpRev(it);
      // 只有**应用内**的完成才提供短时撤销。原生锁屏/通知里的完成不强行拉起主应用，
      // 也不在次日重开时补发一个撤销窗口（UX-A03）。
      if (!deps.isFeedbackSuppressed()) {
        const spawned = items
          .filter(x => x && !beforeIds.has(x.id))
          .map(x => ({ id: x.id, rev: x.rev }));
        lastCompleteUndoState = {
          itemId: it.id,
          rev: it.rev,
          at: Date.now(),
          prev: prev,
          spawned: spawned
        };
      }
      deps.save();
      const spec = deps.actionSpec ? deps.actionSpec("done", { hasRepeat: !!(it.repeat && it.repeat.every) }) : null;
      const msg = (spec && spec.undoText) || (it.repeat ? "已完成 · 下一周期已生成" : "已完成并归档");
      if (deps.isFeedbackSuppressed()) {
        // 原生路径：没有提示，也就不提供撤销入口
      } else if (lastCompleteUndoState) {
        deps.toast(msg, "前往归档", () => deps.goToArchive(),
          { label: "撤销", onClick: () => undoLastComplete() }, { durationMs: getCompleteUndoMs() });
      } else {
        deps.toast(msg);
      }
      deps.render();
      return true;
    }

    /**
     * 稍后 —— 进入新一轮。
     *
     * L04：终态保护；已完成的事项不接受旧通知的「稍后」。
     * L08：稍后开启新一轮时重置追提醒预算与轮次状态，让前台与应用后台使用同一份轮次。
     *      否则旧计数会跟着新时间走，用户点完稍后反而更早静音
     *      （原生投影从 attempt=0 重排，前台却按旧上限判断）。
     */
    function rawSnoozeItem(id, when, basis) {
      const items = deps.getItems() || [];
      const it = items.find(x => x && x.id === id);
      if (!it) return false;
      if (deps.isTerminal(it)) return false;
      const snoozedAt = Date.now();
      it.status = "snoozed";
      it.triggerAt = when;
      it.scheduleBasis = basis === "wall-clock" ? "wall-clock" : "elapsed";
      it.localTrigger = it.scheduleBasis === "wall-clock" ? deps.toLocalInput(when) : null;
      it.snoozedAt = it.scheduleBasis === "elapsed" ? snoozedAt : null;
      it.snoozeDelayMs = it.scheduleBasis === "elapsed" ? Math.max(0, when - snoozedAt) : null;
      it.dismissedUntil = null;
      it.snoozeCount = (it.snoozeCount || 0) + 1;
      it.remindCount = 0;
      it.lastRemindAt = null;
      it.lastAlertShownAt = null;
      it.deliveredAt = null;
      deps.bumpRev(it);
      deps.save();
      deps.toast("已改到 " + deps.fmtTime(when));
      deps.render();
      return true;
    }

    function rawDeleteItem(id) {
      const items = deps.getItems() || [];
      if (!items.some(x => x && x.id === id)) return false;
      deps.setItems(items.filter(x => x && x.id !== id));
      deps.save();
      deps.toast("已删除");
      deps.render();
      return true;
    }

    function rawReopenItem(id) {
      const items = deps.getItems() || [];
      const it = items.find(x => x && x.id === id);
      if (!it) return false;
      const snoozedAt = Date.now();
      it.status = "snoozed";
      it.triggerAt = snoozedAt + 2 * 3600000;
      it.scheduleBasis = "elapsed";
      it.localTrigger = null;
      it.snoozedAt = snoozedAt;
      it.snoozeDelayMs = 2 * 3600000;
      it.dismissedUntil = null;
      // 「再提醒」同样开启新一轮，与 snoozeItem 保持同一份轮次语义
      it.remindCount = 0;
      it.lastRemindAt = null;
      it.lastAlertShownAt = null;
      it.deliveredAt = null;
      deps.bumpRev(it);
      deps.save();
      deps.toast("将在 2 小时后再次提醒");
      deps.render();
      return true;
    }

    /**
     * D23：归档重开不设 trigger_at（不自动提醒），可选给一次极简时间选择。
     *
     * 承诺一致性：重开时同时**暂停截止保护**。截止保护同样是「自动提醒」，
     * 而原实现会让原生投影在恢复后立刻补一条截止提醒，与「不会自动提醒」直接冲突。
     * 暂停是显式可见的，用户可以在卡片/详情里一键恢复。
     */
    function rawRestoreItem(id) {
      const items = deps.getItems() || [];
      const it = items.find(x => x && x.id === id);
      if (!it) return false;
      it.status = "waiting";
      it.completedAt = null;
      it.triggerAt = null;
      it.scheduleBasis = null;
      it.localTrigger = null;
      it.snoozedAt = null;
      it.snoozeDelayMs = null;
      it.dismissedUntil = null;
      it.remindCount = 0;
      it.lastRemindAt = null;
      it.lastAlertShownAt = null;
      it.deliveredAt = null;
      it.deadlinePaused = true;
      deps.bumpRev(it);
      deps.save();
      deps.toast("已恢复 · 不会自动提醒", "设置时间", () => {
        deps.openRestoreSnooze(it.id);
      });
      deps.render();
      return true;
    }

    /** D23 例外必须由用户显式解除：恢复归档时被暂停的截止保护 */
    function rawResumeDeadlineProtection(id) {
      const items = deps.getItems() || [];
      const it = items.find(x => x && x.id === id);
      if (!it) return false;
      it.deadlinePaused = false;
      it.deadlineStageKey = null;
      // 一并清掉暂停前的原生排期记录，否则恢复后会被判成「已送达」而不再排程
      it.deadlineEvents = {};
      deps.bumpRev(it);
      deps.save();
      deps.toast(it.deadlineAt ? "截止保护已恢复 · 截止 " + deps.fmtTime(it.deadlineAt) : "截止保护已恢复");
      deps.render();
      return true;
    }

    /**
     * L03 / V0.2 §417：停止重复 = **终止整个周期规则并归档当前实例**。
     *
     * F3：终止的是**整个系列**。
     * G4：但「终止规则」与「归档实例」是两件事，必须分开 ——
     *  1. 整个系列（含历史实例）一律摘掉 `repeat`，从此不再派生、不再按周期提醒；
     *  2. 用户明确操作的那一条归档（这是「归档当前实例」的语义）；
     *  3. 同系列里**尚未开始**的未来实例随规则一起归档，不写 `completedAt`
     *     （它们从未被用户处理过，不应计入「今天已完成 N 件」）；
     *  4. 已经确认/交付过的历史实例**保留业务状态** —— 之前把 `acknowledged` 的
     *     上一条也一并归档且 `completedAt=null`，它会从待处理列表里凭空消失。
     */
    function rawStopRepeat(id) {
      const items = deps.getItems() || [];
      const it = items.find(x => x && x.id === id);
      if (!it) return false;
      const seriesId = it.seriesId || null;
      const members = seriesMembers(seriesId, id, it);
      // 1) 先终止规则：历史与未来实例都不再属于这个周期
      const all = [it].concat(members);
      all.forEach(m => {
        m.repeat = null;
        m.ackAdvancedAt = null;
        m.dismissedUntil = null;
      });
      // 2) 归档当前实例
      if (!deps.isTerminal(it)) {
        it.status = "archived";
        it.completedAt = Date.now();
      }
      // 3) 只归档「尚未开始」的未来实例；4) 已确认/已交付的历史保留业务状态
      const archived = [];
      members.forEach(m => {
        if (!isUnstartedInstance(m)) return;
        m.status = "archived";
        m.completedAt = null; // 未真正完成，只随规则终止
        archived.push(m);
      });
      all.forEach(m => deps.bumpRev(m));
      deps.save();
      deps.queueNativeReminderSync();
      deps.toast(archived.length
        ? "已停止重复 · 周期已终止并归档（含 " + archived.length + " 个未开始的未来实例）"
        : "已停止重复 · 周期已终止并归档");
      deps.render();
      return true;
    }

    const itemCommand = { userFacing: true, itemArg: 0 };
    const wrappedAckItem = deps.wrapUserOp(rawAckItem, Object.assign({ name: "ackItem" }, itemCommand));
    const wrappedSnoozeItem = deps.wrapUserOp(rawSnoozeItem, Object.assign({ name: "snoozeItem" }, itemCommand));
    const wrappedCompleteItem = deps.wrapUserOp(rawCompleteItem, Object.assign({ name: "completeItem" }, itemCommand));
    const wrappedReopenItem = deps.wrapUserOp(rawReopenItem, Object.assign({ name: "reopenItem" }, itemCommand));
    const wrappedRestoreItem = deps.wrapUserOp(rawRestoreItem, Object.assign({ name: "restoreItem" }, itemCommand));
    const wrappedResumeDeadlineProtection = deps.wrapUserOp(rawResumeDeadlineProtection, Object.assign({ name: "resumeDeadlineProtection" }, itemCommand));
    const wrappedDeleteItem = deps.wrapUserOp(rawDeleteItem, Object.assign({ name: "deleteItem" }, itemCommand));
    const wrappedStopRepeat = deps.wrapUserOp(rawStopRepeat, Object.assign({ name: "stopRepeat" }, itemCommand));

    /**
     * 撤销完成的**实际写入**——参数自足，因此可以进命令日志、被重放到随后发布的权威草稿。
     *
     * 只还原业务字段与本次完成派生的下一期；**不回放**已发生的铃声/通知/ACK/投递证据。
     * R5：同时把「本次完成期间被取消、且已跨过原定时刻」的提醒键标成 suppressed，
     * 否则对账会按「已被撤销 ⇒ 补一条」立刻补响用户刚刚取消掉的那一次。
     */
    function applyCompleteUndo(command) {
      if (!command || !command.itemId) return false;
      const items = deps.getItems() || [];
      const it = items.find(x => x && x.id === command.itemId);
      if (!it) return false;
      Object.assign(it, command.prev);
      if (command.reclaim && command.reclaim.length) {
        const drop = new Set(command.reclaim);
        deps.setItems(items.filter(x => x && !drop.has(x.id)));
      }
      if (deps.suppressPastReminderReplay) {
        deps.suppressPastReminderReplay(it, Date.now());
      }
      deps.bumpRev(it);
      deps.render();
      return true;
    }

    /**
     * 持久化失败时把**可见状态退回撤销之前**。
     *
     * 界面与磁盘必须说同一件事：留下一个「已撤销」的界面、而磁盘上仍是 archived，
     * 就是这一轮被打回的形态（用户重启后又看到它回到已归档）。所以失败不是「算了」，
     * 而是回滚 + 明确的重试入口。
     */
    function revertCompleteUndo(command) {
      const snap = command && command.before;
      if (!snap) return false;
      const items = deps.getItems() || [];
      const it = items.find(x => x && x.id === command.itemId);
      if (it && snap.item) {
        Object.keys(it).forEach(k => { if (!(k in snap.item)) delete it[k]; });
        Object.keys(snap.item).forEach(k => { it[k] = snap.item[k]; });
      }
      (snap.removed || []).slice().sort((a, b) => a.index - b.index).forEach(entry => {
        if (!entry || !entry.item) return;
        if (items.some(x => x && x.id === entry.item.id)) return;
        const at = Math.max(0, Math.min(entry.index, items.length));
        items.splice(at, 0, entry.item);
      });
      deps.render();
      return true;
    }

    /**
     * UX-A03 / 独立验收 F04：撤销「完成」是**统一事务里的一条受控命令**。
     *
     * 以前它直接改共享 state 再 `save()`，绕过统一命令日志，于是：
     *  · 原生动作提交在途时撤销，会被随后发布的权威草稿整体覆盖 ——
     *    界面说撤销成功，提交结束或重启后它又回到「已归档」（独立验收 R3）；
     *  · 提示在**落库之前**就发出去了，写失败时用户已经被告知「已撤销完成」（R6）。
     *
     * 现在：
     *  · 走 `runUserOp` —— 同域（同一条事项 / 同一周期）在途时明确拒绝，
     *    无关事项则记进日志、在原生草稿发布之后按序重放；
     *  · 成功反馈等**持久化确认**；失败则回滚可见状态并保留重试入口。
     */
    function undoLastComplete() {
      const u = lastCompleteUndoState;
      if (!u) return false;
      const items = deps.getItems() || [];
      const it = items.find(x => x && x.id === u.itemId);
      if (!it) { lastCompleteUndoState = null; return false; }
      // 过期：只失效撤销入口，不影响已经正常完成的这条
      if (Date.now() - u.at > getCompleteUndoMs()) {
        lastCompleteUndoState = null;
        deps.toast("撤销时间已过 · 可在「未来 → 已归档」里恢复");
        return false;
      }
      // 本次完成之后又被改过 / 已经不是刚完成的状态 ⇒ 拒绝不安全撤销
      if (Number(it.rev) !== Number(u.rev)) {
        deps.toast("这条之后又被改过 · 可在归档里恢复");
        return false;
      }
      if (it.status !== "archived") {
        deps.toast("这条状态已经变了 · 可在归档里恢复");
        return false;
      }
      // 完成之后到来的投递证据 ⇒ 说明已经进入投递，撤销会制造幽灵响铃
      const events = it.reminderEvents && typeof it.reminderEvents === "object" ? it.reminderEvents : {};
      const deliveredAfter = Object.keys(events).some(k => {
        const ev = events[k];
        return ev && ev.state === "delivered" && Number(ev.receivedAt || ev.at || 0) >= u.at;
      });
      if (deliveredAfter) {
        deps.toast("这条已经开始提醒 · 可在归档里恢复");
        return false;
      }
      // 周期派生的下一期：只回收**本次完成生成的、且尚未被处理/投递**的
      const reclaim = [];
      for (const sp of u.spawned) {
        const x = items.find(y => y && y.id === sp.id);
        if (!x) continue;
        if (x.repeatParentId !== it.id) continue; // 不是这条派生的，绝不删
        const untouched = Number(x.rev) === Number(sp.rev) &&
          x.status === "waiting" &&
          !x.acknowledgedAt && !x.deliveredAt && !x.lastRemindAt && !x.remindCount &&
          !x.ackAdvancedAt && !x.completedAt;
        if (!untouched) {
          deps.toast("下一期已经开始处理 · 不能安全撤销，请到归档里逐条处理");
          return false;
        }
        reclaim.push(x.id);
      }
      // 命令只携带**自足的值**：重放时按 itemId 在当时的草稿里重新解析，
      // 不保留任何可能已被替换掉的旧对象引用。
      const command = {
        itemId: u.itemId,
        rev: u.rev,
        at: u.at,
        prev: JSON.parse(JSON.stringify(u.prev)),
        reclaim: reclaim.slice(),
        // 仅用于「写失败回滚」，不参与重放（重放路径不会走到回滚）
        before: {
          item: JSON.parse(JSON.stringify(it)),
          removed: reclaim.map(id => {
            const index = items.findIndex(y => y && y.id === id);
            return { index: index, item: index >= 0 ? JSON.parse(JSON.stringify(items[index])) : null };
          })
        }
      };
      const applied = deps.runUserOp(applyCompleteUndo, [command], {
        userFacing: true,
        // 目标 id 藏在参数里（参数是一份撤销记录），必须显式告诉冲突检查
        scopeId: (c) => c && c.itemId,
        name: "undoComplete"
      });
      if (applied === false) return false;
      lastCompleteUndoState = null;
      const pending = deps.save();
      const onSaved = () => {
        deps.toast("已撤销完成 · 这条仍在「未完成」里");
        // 只对未来仍有效的计划按现有规则对账；不因撤销立刻补响已经过去的那次
        deps.markUndoNativeCheckPending();
        deps.queueNativeReminderSync("undo-complete");
      };
      const onFailed = () => {
        // 没写进去就不算撤销过：退回原状 + 明确的重试入口
        revertCompleteUndo(command);
        lastCompleteUndoState = u;
        deps.toast("撤销还没写进本机存储 · 请重试", "重试", () => undoLastComplete());
      };
      if (pending && typeof pending.then === "function") {
        pending.then(onSaved).catch(onFailed);
      } else {
        onSaved();
      }
      return true;
    }

    /**
     * UX-C03：新建事项的有限撤销（8 秒内）。
     *
     * 只针对本次创建、当前版本未被后续操作改变、且未开始投递的事项。
     * 过期/已变化一律拒绝并引导去修改 —— 用整份旧快照覆盖当前数据会造成丢改动。
     */
    function undoNewItem(itemId, rev) {
      const items = deps.getItems() || [];
      const it = items.find(x => x && x.id === itemId);
      if (!it) return false;
      if (Number(it.rev) !== Number(rev)) {
        deps.toast("这条之后又被改过 · 请直接修改");
        return false;
      }
      if (deps.isTerminal(it) || it.acknowledgedAt) {
        deps.toast("这条已经开始处理 · 请直接修改");
        return false;
      }
      const events = it.reminderEvents && typeof it.reminderEvents === "object" ? it.reminderEvents : {};
      const delivered = Object.keys(events).some(k => events[k] && events[k].state === "delivered");
      if (delivered || it.deliveredAt || it.lastRemindAt) {
        deps.toast("这条已经开始提醒 · 请直接修改");
        return false;
      }
      // deleteItem 本身已由 wrapUserOp 包过：它已经负责「提交中拒绝」与命令日志，
      // 这里再套一层 runUserOp 会把同一条命令记两次。
      const applied = wrappedDeleteItem(itemId);
      if (applied === false) return false;
      // 原生那边由接下来的对账撤销；失败会经 undoNativeCheckPending 如实说出来
      deps.markUndoNativeCheckPending();
      deps.queueNativeReminderSync("undo-new");
      deps.toast("已撤销这条记录");
      return true;
    }

    function applyItemEdit(it, values) {
      if (!it) return false;
      const prevTrigger = it.triggerAt;
      it.title = values.title; it.note = values.note; it.tags = values.tags; it.url = values.url;
      it.projectId = values.projectId; it.priority = values.priority;
      it.delivery_mode = deps.resolveDeliveryMode(values.priority);
      it.triggerAt = values.triggerAt;
      it.scheduleBasis = values.scheduleBasis === "elapsed" ? "elapsed" : "wall-clock";
      it.localTrigger = it.scheduleBasis === "wall-clock" ? deps.toLocalInput(values.triggerAt) : null;
      it.deadlineAt = values.deadlineAt; it.repeat = values.repeat;
      if (values.triggerAt !== prevTrigger) {
        it.remindCount = 0; it.lastRemindAt = null; it.lastAlertShownAt = null; it.deliveredAt = null;
        it.snoozedAt = null; it.snoozeDelayMs = null; it.dismissedUntil = null;
      } else {
        it.snoozedAt = values.snoozedAt !== undefined ? values.snoozedAt : it.snoozedAt;
        it.snoozeDelayMs = values.snoozeDelayMs !== undefined ? values.snoozeDelayMs : it.snoozeDelayMs;
        it.dismissedUntil = values.dismissedUntil !== undefined ? values.dismissedUntil : it.dismissedUntil;
      }
      if (values.triggerAt && values.triggerAt !== prevTrigger && values.triggerAt > Date.now() &&
        (it.status === "due" || it.status === "acknowledged")) it.status = "waiting";
      deps.bumpRev(it);
      return true;
    }

    function applyNewItem(id, fields) {
      const replayId = deps.takeReplayCreatedId();
      if (replayId) id = replayId;
      const items = deps.getItems() || [];
      if (!id || items.some(x => x && x.id === id)) return false;
      items.push(deps.normalizeItem(Object.assign({}, fields, { id: id })));
      return true;
    }

    function applyProjectRemovalToItems(id) {
      const items = deps.getItems() || [];
      items.forEach(it => {
        if (!it || it.projectId !== id) return;
        it.projectId = "";
        deps.bumpRev(it);
      });
      return true;
    }

    return {
      promoteDue: promoteDue,
      ensureSeriesId: ensureSeriesId,
      seriesMembers: seriesMembers,
      isUnstartedInstance: isUnstartedInstance,
      spawnNextInstance: spawnNextInstance,
      advanceSeriesOnArchive: advanceSeriesOnArchive,
      ackItem: wrappedAckItem,
      completeItem: wrappedCompleteItem,
      snoozeItem: wrappedSnoozeItem,
      deleteItem: wrappedDeleteItem,
      reopenItem: wrappedReopenItem,
      restoreItem: wrappedRestoreItem,
      resumeDeadlineProtection: wrappedResumeDeadlineProtection,
      stopRepeat: wrappedStopRepeat,
      applyItemEdit: applyItemEdit,
      applyNewItem: applyNewItem,
      applyProjectRemovalToItems: applyProjectRemovalToItems,
      applyCompleteUndo: applyCompleteUndo,
      revertCompleteUndo: revertCompleteUndo,
      undoLastComplete: undoLastComplete,
      undoNewItem: undoNewItem,
      lastCompleteUndo: () => lastCompleteUndoState
    };
  }

  return {
    createAppItems: createAppItems
  };
});
