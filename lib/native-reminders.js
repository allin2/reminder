/* Android native reminder projection for Capacitor — UMD */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.AttentionNativeReminders = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const ACTION_TYPE_ID = "attention-actions";
  /** L06：待整理的通知动作与事项动作语义不同，必须独立注册，不能让标签与行为对不上 */
  const REVIEW_ACTION_TYPE_ID = "attention-review-actions";
  const MANAGED_KIND = "attention-reminder";
  const SCHEDULE_VERSION = 2;
  const REVIEW_MANAGED_KIND = "review-session";
  const CHANNELS = {
    normal: "attention-normal-v2",
    important: "attention-important-v2",
    critical: "attention-critical-v2"
  };
  const POLICY = {
    normal: { total: 1, intervalMs: 0 },
    important: { total: 4, intervalMs: 30 * 60 * 1000 },
    critical: { total: 8, intervalMs: 15 * 60 * 1000 }
  };

  /**
   * 截止保护的阶段与身份：单一实现在 lib/reminder.js。
   * 浏览器里由 AttentionLib 提供；Node 下（含测试）直接 require 同一个文件。
   */
  const Lib = (function () {
    if (root && root.AttentionLib && root.AttentionLib.deadlineStageKey) return root.AttentionLib;
    try {
      if (typeof require === "function") return require("./reminder.js");
    } catch (error) {}
    return null;
  })();
  const DEADLINE_LEAD_MS = (Lib && Lib.DEADLINE_LEAD_MS) || 24 * 60 * 60 * 1000;
  const DEADLINE_GRACE_MS = (Lib && Lib.DEADLINE_GRACE_MS) || 24 * 60 * 60 * 1000;

  function deadlineStageKey(deadlineAt, now) {
    if (Lib && Lib.deadlineStageKey) return Lib.deadlineStageKey(deadlineAt, now);
    return null;
  }

  /** V03：每个保护阶段各自预排，而不是只排 deadline-24h 一个点 */
  function deadlineStagePoints(deadlineAt) {
    if (Lib && Lib.deadlineStagePoints) return Lib.deadlineStagePoints(deadlineAt);
    const dl = Number(deadlineAt) || 0;
    return dl ? [{ id: "p24", at: dl - DEADLINE_LEAD_MS }] : [];
  }

  /**
   * F1：按「阶段」取截止事件记录。
   *
   * 此前每个事项只有 `deadlineNotifiedKey/At` 一组字段，p24 与 p2 轮流覆盖同一槽位：
   * 每轮对账都在两个值之间来回改 → changed 永远为真 → 持续写库 + 持续对账；
   * 而且 p24 的记录会被 p2 顶掉，送达后又会被重新排一条。
   */
  function deadlineEventOf(item, stageKey) {
    const table = item && item.deadlineEvents;
    if (!table || typeof table !== "object") return null;
    const rec = table[stageKey];
    return rec && typeof rec === "object" ? rec : null;
  }

  let initialized = false;
  let actionListener = null;
  let deliveredListener = null;
  let appListener = null;
  let statusListener = null;

  function capacitor() {
    return root && root.Capacitor ? root.Capacitor : null;
  }

  function plugin(name) {
    const cap = capacitor();
    return cap && cap.Plugins ? cap.Plugins[name] : null;
  }

  function isNativeAndroid() {
    const cap = capacitor();
    if (!cap) return false;
    const platform = typeof cap.getPlatform === "function" ? cap.getPlatform() : cap.platform;
    if (platform !== "android") return false;
    return !!(plugin("LocalNotifications") || plugin("SystemBridge") || plugin("AppSettings"));
  }

  function systemBridge() {
    return plugin("SystemBridge");
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toLocalDateTime(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return null;
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function fromLocalDateTime(value) {
    const m = String(value || "").match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
    );
    if (!m) return null;
    const d = new Date(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6] || 0), 0
    );
    const ts = d.getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  function migrateItem(item) {
    if (!item || typeof item !== "object") return false;
    let changed = false;
    if (item.scheduleBasis !== "wall-clock" && item.scheduleBasis !== "elapsed") {
      item.scheduleBasis = "wall-clock";
      changed = true;
    }
    if (item.scheduleBasis === "wall-clock") {
      if (!item.localTrigger && item.triggerAt) {
        item.localTrigger = toLocalDateTime(item.triggerAt);
        changed = true;
      }
      const localTs = fromLocalDateTime(item.localTrigger);
      if (localTs && localTs !== item.triggerAt) {
        item.triggerAt = localTs;
        changed = true;
      }
    } else if (item.snoozedAt && item.snoozeDelayMs != null) {
      const elapsedTs = Number(item.snoozedAt) + Number(item.snoozeDelayMs);
      if (Number.isFinite(elapsedTs) && elapsedTs > 0 && elapsedTs !== item.triggerAt) {
        item.triggerAt = elapsedTs;
        changed = true;
      }
    }
    if (item.dismissedUntil == null) {
      item.dismissedUntil = null;
      changed = true;
    }
    return changed;
  }

  function parseHHMM(value, fallbackHour, fallbackMinute) {
    const m = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return { hour: fallbackHour, minute: fallbackMinute };
    return { hour: Number(m[1]), minute: Number(m[2]) };
  }

  function inQuietHours(date, settings) {
    if (!settings || !settings.dnd) return false;
    const start = parseHHMM(settings.quietStart, 23, 0);
    const end = parseHHMM(settings.quietEnd, 7, 30);
    const current = date.getHours() * 60 + date.getMinutes();
    const startMinutes = start.hour * 60 + start.minute;
    const endMinutes = end.hour * 60 + end.minute;
    if (startMinutes === endMinutes) return false;
    if (startMinutes < endMinutes) return current >= startMinutes && current < endMinutes;
    return current >= startMinutes || current < endMinutes;
  }

  function quietEnd(date, settings) {
    const end = parseHHMM(settings && settings.quietEnd, 7, 30);
    const start = parseHHMM(settings && settings.quietStart, 23, 0);
    const current = date.getHours() * 60 + date.getMinutes();
    const startMinutes = start.hour * 60 + start.minute;
    const endMinutes = end.hour * 60 + end.minute;
    const result = new Date(date);
    if (startMinutes >= endMinutes && current >= startMinutes) result.setDate(result.getDate() + 1);
    result.setHours(end.hour, end.minute, 0, 0);
    return result.getTime();
  }

  function effectiveTriggerAt(item, settings) {
    let at = Number(item && item.triggerAt) || 0;
    if (!at) return 0;
    if (item.priority === "normal" && inQuietHours(new Date(at), settings)) {
      at = quietEnd(new Date(at), settings);
    }
    return at;
  }

  function hash32(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) & 0x7fffffff;
  }

  function allocateId(key, used) {
    let id = hash32("attention:" + key) || 1;
    while (used.has(id)) {
      id++;
      if (id > 0x7ffffffe) id = 1;
    }
    used.add(id);
    return id;
  }

  function scheduleKey(item, event, attempt, at, title, body, channelId) {
    // V05：数据版本进入身份。只改版本（不改时间/标题）的操作也必须让通知重排，
    // 否则 pending 里会一直留着旧版本的通知，用户点它的按钮反而被版本校验拒绝。
    return [SCHEDULE_VERSION, item.id, item.rev == null ? 0 : item.rev,
      event, attempt, at, title, body, channelId].join("|");
  }

  function notificationFor(item, event, attempt, at, settings, usedIds, keyAt) {
    const privacy = !!(settings && settings.privacyNotify);
    const title = item.priority === "critical" ? "🚨 关键事项" :
      item.priority === "important" ? "☆ 重要事项" :
      event === "deadline" ? "截止时间临近" : "安心收件箱提醒";
    const body = privacy ? "有一条事项需要你确认" : String(item.title || "未命名事项");
    const channelId = CHANNELS[item.priority] || CHANNELS.normal;
    // R6：身份（id + scheduleKey）可以用一个稳定的「事件时刻」而不是实际投递时刻，
    // 否则「进入保护窗口后立即提醒」会在每次对账时换一个新身份 → 撤销/重排循环。
    const key = scheduleKey(item, event, attempt, keyAt == null ? at : keyAt, title, body, channelId);
    return {
      title,
      body,
      id: allocateId(key, usedIds),
      channelId,
      actionTypeId: ACTION_TYPE_ID,
      autoCancel: true,
      sound: "attention_reminder",
      schedule: { at: new Date(at), allowWhileIdle: true },
      extra: {
        managedKind: MANAGED_KIND,
        scheduleVersion: SCHEDULE_VERSION,
        itemId: item.id,
        // L04：事件携带事项版本，投递后由 JS 校验，旧通知不得覆盖新状态
        itemRev: item.rev == null ? 0 : Number(item.rev),
        event,
        attempt,
        scheduleKey: key
      }
    };
  }

  /** D25 / A-01：有标记（重要/关键）或 delivery_mode=alarm 时，首次走全屏闹钟 */
  function shouldFirstAlarm(item) {
    if (!item) return false;
    if (item.priority === "important" || item.priority === "critical") return true;
    return item.delivery_mode === "alarm";
  }

  function buildDesired(items, settings, now) {
    now = now == null ? Date.now() : Number(now);
    const usedIds = new Set();
    const desired = [];
    const reviewEnabled = !!(settings && settings.review && settings.review.enabled);
    const sorted = (Array.isArray(items) ? items.slice() : []).sort((a, b) =>
      String(a && a.id || "").localeCompare(String(b && b.id || ""))
    );

    sorted.forEach(item => {
      if (!item || !item.id || item.status === "archived" || item.status === "completed") return;
      const active = item.status === "waiting" || item.status === "snoozed" || item.status === "due";
      // L01 / R5 / D17 / V0.2 §9.2：只有「系统兜底时间」的记录不发事项提醒。
      //  · 用户手选或解析出的真实时间继续生效（Review 只管内容质量）；
      //  · Review 关闭后一律按普通事项正常排程（否则这些记录永久搁浅）。
      // V06：判定不能再带 `review_status === NEEDS_REVIEW` —— 整理确认后记录已 REVIEWED，
      //      若兜底标记还在，原生就会排出正式提醒，而前台按 fallback 一律抑制，两边不一致。
      const reviewSuppressed = reviewEnabled && !!item.isFallbackTrigger;
      if (active && item.triggerAt && !reviewSuppressed) {
        const policy = POLICY[item.priority] || POLICY.normal;
        const total = item.priority === "important" && settings && settings.importantRepeat === false
          ? 1 : policy.total;
        const firstAt = effectiveTriggerAt(item, settings || {});
        const useAlarmFirst = shouldFirstAlarm(item);
        for (let attempt = 0; attempt < total; attempt++) {
          const at = firstAt + attempt * policy.intervalMs;
          if (at <= now + 1000) continue;
          if (attempt > 0 && item.dismissedUntil && at < Number(item.dismissedUntil)) continue;
          const n = notificationFor(
            item,
            attempt === 0 ? "primary" : "realert",
            attempt,
            at,
            settings || {},
            usedIds
          );
          // 首次闹钟由 SystemBridge 排程，不进 LocalNotifications desired
          if (attempt === 0 && useAlarmFirst) {
            n.extra.useAlarm = true;
            n.extra.itemId = item.id;
          }
          desired.push(n);
        }
      }

      // R6 / L02 / V03 / INV-05：截止保护按「阶段身份 + 消费状态」排程。
      //  · **每个阶段**（p24 / p2）都是独立事件，各自预排；
      //  · 稳定身份用「该阶段的保护点时刻」而不是 `now` → 反复对账不换身份；
      //  · 已消费（应用内已唤醒）的阶段不再排；
      //  · 已送达（有真实送达证据）→ 不再排、也不再补发；
      //  · 已排期且投递时刻已过 → 视为**待定**，既不重排也不补发（无法判定是否送达）；
      //  · 已撤销（排程被成功撤销，见 G3）→ 视同「从未排过」，保护点已过则立即补提醒；
      //  · deadlinePaused（D23 归档重开）→ 遵守"不自动提醒"的承诺。
      if (item.deadlineAt && !item.deadlinePaused) {
        const deadlineTs = Number(item.deadlineAt);
        if (deadlineTs > now - DEADLINE_GRACE_MS) {
          deadlineStagePoints(deadlineTs).forEach(point => {
            const stageKey = point.id + "@" + deadlineTs;
            if (item.deadlineStageKey === stageKey) return; // 应用内已消费（已确认）
            // F1：每个阶段一条独立记录，不再是两组字段轮流覆盖
            const rec = deadlineEventOf(item, stageKey);
            if (rec && rec.state === "delivered") return;   // 已送达：不再重排
            let at = point.at;
            if (rec && rec.state === "scheduled" && Number(rec.at) > 0) {
              at = Number(rec.at);
              // 已排期且投递时刻已过：本轮不排（也无法判定是否送达），保持待定
              if (at <= now) return;
            } else if (at <= now) {
              // 从未排过、或排程已被撤销 → 保护点已过也立即补提醒（身份仍是保护点时刻）
              at = now + 2000;
            }
            if (at > now + 1000) {
              const n = notificationFor(item, "deadline", 0, at, settings || {}, usedIds, point.at);
              n.extra.stageKey = stageKey;
              desired.push(n);
            }
          });
        }
      }
    });

    return desired.sort((a, b) => a.schedule.at.getTime() - b.schedule.at.getTime() || a.id - b.id);
  }

  function reviewNotificationFor(count, index, at, usedIds) {
    const title = "待整理";
    const body = "有 " + count + " 条随手记录待整理 · 预计只需几分钟";
    // 身份用「槽位编号」而不是过滤后的数组下标 —— 前面槽位过去后，后面的槽位不应该换身份
    const key = [SCHEDULE_VERSION, "review", index, at, title, body].join("|");
    return {
      title,
      body,
      id: allocateId(key, usedIds),
      // D18 / P1-6：待整理按「普通事项」对待，渠道显著性不得高于普通提醒
      channelId: CHANNELS.normal,
      // L06 / V0.2 §9.3：待整理使用自己的动作集（开始整理 / 稍后 30 分钟 / 今天跳过），
      // 不再复用事项的「我知道了 / 稍后 2 小时 / 完成」——否则标签承诺与实际行为对不上。
      actionTypeId: REVIEW_ACTION_TYPE_ID,
      autoCancel: true,
      sound: "attention_reminder",
      schedule: { at: new Date(at), allowWhileIdle: true },
      extra: {
        managedKind: REVIEW_MANAGED_KIND,
        scheduleVersion: SCHEDULE_VERSION,
        itemId: "review-session",
        event: "review",
        attempt: index,
        scheduleKey: key
      }
    };
  }

  /**
   * R4：按「稳定的会话日期」生成完整槽位，再交由调用方过滤已过去的槽位。
   *
   * 不能因为「窗口起点已过」就把整天的槽位挪到明天：那样每次对账都会把当晚尚未到时的
   * 补提醒当作陈旧排程撤销 —— 用户点了「稍后」却在约定时间收不到任何提醒。
   *
   * L07 / D18 / V0.2 §9.3：勿扰是硬约束。锚点顺延后补提醒按固定间隔从「已顺延的锚点」
   * 往后推（否则多条会被各自顺延到同一时刻而被去重压成一条）；某一档若因勿扰顺延后
   * 已经越过本次窗口，就交给下一个窗口（D22「达上限后滚入下一个窗口」），
   * 不允许多发一次来穿透勿扰。
   */
  function buildReviewSlots(reviewSettings, settings, sessionStartTs) {
    const hour = reviewSettings.hour != null ? reviewSettings.hour : 21;
    const minute = reviewSettings.minute != null ? reviewSettings.minute : 30;
    const followupMs = reviewSettings.followupMs != null ? reviewSettings.followupMs : 60 * 60 * 1000;
    const maxFollowups = reviewSettings.maxFollowups != null ? reviewSettings.maxFollowups : 2;
    const windowEnd = new Date(sessionStartTs);
    windowEnd.setHours(
      reviewSettings.windowEndHour != null ? reviewSettings.windowEndHour : 23,
      reviewSettings.windowEndMinute != null ? reviewSettings.windowEndMinute : 0,
      0, 0
    );
    if (windowEnd.getTime() < sessionStartTs) windowEnd.setDate(windowEnd.getDate() + 1);

    function shift(ts) {
      if (!ts) return 0;
      if (!settings || !inQuietHours(new Date(ts), settings)) return ts;
      return quietEnd(new Date(ts), settings);
    }

    const anchor = shift(sessionStartTs);
    const slots = [{ index: 0, at: anchor }];
    for (let i = 1; i <= maxFollowups; i++) {
      const raw = anchor + i * followupMs;
      const at = shift(raw);
      // 勿扰顺延后已越过本次窗口 → 滚入下一个窗口
      if (at !== raw && at > windowEnd.getTime()) continue;
      slots.push({ index: i, at: at });
    }
    return slots;
  }

  /**
   * D19/D22：待整理用 LocalNotifications 预排，60 分钟 × 2 次补提醒。
   * D18：受「本地通知」总开关控制（由 reconcile 的 enabled 决定），并按普通事项参与勿扰。
   * D20：`snoozedUntil` 必须单独占一个槽位——否则「稍后 30 分钟」会被窗口起点吞掉，
   *      用户点了稍后却在约定时间收不到任何提醒。
   * R4：先取「今天这一场」的剩余槽位；只有今天整场都过去（含窗口已结束）才顺延到明天。
   */
  function buildReviewDesired(count, reviewSettings, now, settings) {
    if (!count || !reviewSettings || !reviewSettings.enabled) return [];
    now = now == null ? Date.now() : Number(now);

    const usedIds = new Set();
    // V07 / V0.2 §9.3：「今天跳过」必须真的撤销当晚排程。
    // 此前 buildReviewDesired 完全不读 skippedUntil，点了「今天跳过」之后
    // 对账仍会把当晚剩余槽位留在 desired 里（甚至重新排一遍）。
    const skippedUntil = Number(reviewSettings.skippedUntil) || 0;
    if (skippedUntil > now) return [];

    const hour = reviewSettings.hour != null ? reviewSettings.hour : 21;
    const minute = reviewSettings.minute != null ? reviewSettings.minute : 30;
    function sessionStart(baseTs) {
      const d = new Date(baseTs);
      d.setHours(hour, minute, 0, 0);
      return d.getTime();
    }

    const slots = [];
    const snoozedUntil = Number(reviewSettings.snoozedUntil) || 0;
    if (snoozedUntil > now + 1000) {
      const shifted = settings && inQuietHours(new Date(snoozedUntil), settings)
        ? quietEnd(new Date(snoozedUntil), settings)
        : snoozedUntil;
      slots.push({ index: 90, at: shifted });
    }

    const todaySession = sessionStart(now);
    let sessionSlots = buildReviewSlots(reviewSettings, settings, todaySession)
      .filter(s => s.at > now + 1000);
    if (!sessionSlots.length) {
      const tomorrow = new Date(todaySession);
      tomorrow.setDate(tomorrow.getDate() + 1);
      sessionSlots = buildReviewSlots(reviewSettings, settings, tomorrow.getTime())
        .filter(s => s.at > now + 1000);
    }
    sessionSlots.forEach(s => slots.push(s));

    // 同一时刻只留一个槽位（稍后时刻与补提醒撞车时，用户约定的那个优先）
    const byAt = new Map();
    slots.filter(s => s.at > now + 1000).forEach(s => {
      if (!byAt.has(s.at)) byAt.set(s.at, s);
    });
    return Array.from(byAt.values())
      .sort((a, b) => a.at - b.at)
      .map(s => reviewNotificationFor(count, s.index, s.at, usedIds));
  }

  /**
   * P0-2：全屏闹钟对账。
   * 此前只调 scheduleAlarm、从不调 cancelAlarm，导致删除/改期/ACK/关通知权限后
   * 已排的全屏闹钟照响（幽灵闹钟，违反 AC-11 / INV-09）。
   * 排程本身幂等（同一 request code 的 PendingIntent 会被替换），因此对 desired 全量重排，
   * 只把「上一轮排过、这一轮不再需要」的 id 撤掉。
   */
  async function reconcileAlarms(desired, items, settings, now) {
    now = now == null ? Date.now() : Number(now);
    const bridge = systemBridge();
    const prev = Array.isArray(settings && settings.scheduledAlarmIds)
      ? settings.scheduledAlarmIds.filter(id => typeof id === "number")
      : [];
    const wanted = desired.map(n => n.id);
    const wantedSet = new Set(wanted);
    const stale = prev.filter(id => !wantedSet.has(id));

    if (!bridge || (!bridge.scheduleAlarm && !bridge.scheduleAt)) {
      // 桥不可用：保留原台账，别把「其实还挂着」的闹钟忘掉（否则桥恢复后永远撤不掉）
      return { available: false, cancelled: 0, scheduled: 0, ids: prev, errors: [] };
    }

    const errors = [];
    // R7：台账只记录「确认仍然有效」的 id。
    //  · 撤销失败 → 保留，下一次对账还要再撤它（否则留下幽灵闹钟）
    //  · 排程失败 → 不入账，下一次对账会重新尝试
    const held = new Set(prev.filter(id => wantedSet.has(id)));

    let cancelled = 0;
    if (bridge.cancelAlarm) {
      for (const id of stale) {
        try {
          await bridge.cancelAlarm({ id });
          cancelled++;
        } catch (error) {
          held.add(id);
          errors.push("cancel:" + id + ":" + (error && error.message ? error.message : String(error)));
        }
        // R8：闹钟撤销后残留的通知也要清掉，否则点旧通知会再次进入全屏界面
        if (bridge.cancelNotification) {
          try { await bridge.cancelNotification({ id }); } catch (error) {}
        }
      }
    }

    let scheduled = 0;
    for (const n of desired) {
      const item = (Array.isArray(items) ? items : []).find(x => x && x.id === n.extra.itemId);
      const level = item && item.priority === "important" ? "☆ 重要" :
        item && item.priority === "critical" ? "🚨 关键" : "提醒";
      const payload = {
        title: n.title,
        body: n.body,
        id: n.id,
        itemId: (n.extra && n.extra.itemId) || "",
        itemRev: n.extra && n.extra.itemRev != null ? n.extra.itemRev : 0,
        level
      };
      try {
        if (bridge.scheduleAlarm) {
          const delayMs = Math.max(1000, n.schedule.at.getTime() - Date.now());
          await bridge.scheduleAlarm(Object.assign({ delayMs }, payload));
        } else {
          await bridge.scheduleAt(Object.assign({ at: n.schedule.at.getTime() }, payload));
        }
        scheduled++;
        held.add(n.id);
      } catch (error) {
        errors.push("schedule:" + n.id + ":" + (error && error.message ? error.message : String(error)));
      }
    }

    return {
      available: true,
      cancelled,
      scheduled,
      ids: Array.from(held).sort((a, b) => a - b),
      errors
    };
  }

  function permissionValue(result, keys, fallback) {
    if (!result) return fallback;
    for (const key of keys) {
      if (result[key] != null) return result[key];
    }
    return fallback;
  }

  async function getPermissionState() {
    if (!isNativeAndroid()) {
      return { native: false, notifications: "web", exactAlarm: "web", reliability: "web" };
    }
    const local = plugin("LocalNotifications");
    const bridge = systemBridge();
    let notifications = "unknown";
    let exactAlarm = "unknown";
    if (bridge && bridge.diagnose) {
      try {
        const d = await bridge.diagnose();
        notifications = d.notificationsEnabled && d.postNotificationsGranted ? "granted" : "denied";
        exactAlarm = d.canExactAlarm ? "granted" : "denied";
        const reliability = notifications !== "granted" ? "in-app" :
          exactAlarm === "granted" ? "exact" : "inexact";
        return { native: true, notifications, exactAlarm, reliability, source: "SystemBridge", diag: d };
      } catch (error) {}
    }
    if (!local) {
      return { native: true, notifications, exactAlarm, reliability: "in-app", source: "none" };
    }
    try {
      const result = await local.checkPermissions();
      notifications = permissionValue(result, ["display", "receive"], "unknown");
    } catch (error) {}
    try {
      const result = await local.checkExactNotificationSetting();
      exactAlarm = permissionValue(result, ["exact_alarm", "exactAlarm", "display"], "unknown");
    } catch (error) {}
    const reliability = notifications !== "granted" ? "in-app" :
      exactAlarm === "granted" ? "exact" : "inexact";
    return { native: true, notifications, exactAlarm, reliability };
  }

  async function requestNotificationPermission() {
    if (!isNativeAndroid()) return getPermissionState();
    const bridge = systemBridge();
    if (bridge && bridge.requestNotificationPermission) {
      try {
        await bridge.requestNotificationPermission();
      } catch (error) {}
    }
    const local = plugin("LocalNotifications");
    if (local && local.requestPermissions) {
      try {
        await local.requestPermissions();
      } catch (error) {}
    }
    return getPermissionState();
  }

  async function openExactAlarmSettings() {
    if (!isNativeAndroid()) return getPermissionState();
    const bridge = systemBridge();
    if (bridge && bridge.openExactAlarmSettings) {
      try {
        await bridge.openExactAlarmSettings();
        return getPermissionState();
      } catch (error) {}
    }
    const local = plugin("LocalNotifications");
    if (local && local.changeExactNotificationSetting) {
      await local.changeExactNotificationSetting();
    }
    return getPermissionState();
  }

  async function ensureChannels() {
    if (!isNativeAndroid()) return;
    const local = plugin("LocalNotifications");
    if (!local || !local.createChannel) return;
    const channels = [
      {
        id: CHANNELS.normal,
        name: "普通提醒",
        description: "普通事项提醒",
        importance: 3,
        sound: "attention_reminder",
        vibration: true
      },
      {
        id: CHANNELS.important,
        name: "重要提醒",
        description: "重要事项持续提醒",
        importance: 4,
        sound: "attention_reminder",
        vibration: true
      },
      {
        id: CHANNELS.critical,
        name: "关键提醒",
        description: "关键事项高显著提醒",
        importance: 5,
        sound: "attention_reminder",
        vibration: true
      }
    ];
    for (const channel of channels) await local.createChannel(channel);
  }

  function isManaged(notification) {
    return !!(notification && notification.extra &&
      (notification.extra.managedKind === MANAGED_KIND || notification.extra.managedKind === REVIEW_MANAGED_KIND));
  }

  async function reconcile(items, settings, now, review) {
    if (!isNativeAndroid()) return getPermissionState();
    const local = plugin("LocalNotifications");
    const permissions = await getPermissionState();
    const enabled = !!(settings && settings.notify) && permissions.notifications === "granted";
    let allDesired = enabled && local ? buildDesired(items, settings, now) : [];
    // P0-1：待整理排程并入同一次对账（此前 buildReviewDesired 有定义无调用点，安卓上永远不会响）
    if (enabled && local && review && review.count) {
      const used = new Set(allDesired.map(n => n.id));
      buildReviewDesired(review.count, review.settings, now, settings).forEach(n => {
        while (used.has(n.id)) n.id = n.id >= 0x7ffffffe ? 1 : n.id + 1;
        used.add(n.id);
        allDesired.push(n);
      });
    }
    // 首次闹钟走 SystemBridge；其余走 LocalNotifications
    const alarmDesired = allDesired.filter(n => n.extra && n.extra.useAlarm);
    const desired = allDesired.filter(n => !(n.extra && n.extra.useAlarm));
    let pending = [];
    try {
      if (local) {
        const result = await local.getPending();
        pending = Array.isArray(result && result.notifications) ? result.notifications.filter(isManaged) : [];
      }
    } catch (error) {}

    const desiredById = new Map(desired.map(n => [n.id, n]));
    const matching = new Set();
    const stale = [];
    pending.forEach(n => {
      const wanted = desiredById.get(n.id);
      if (wanted && n.extra && n.extra.scheduleKey === wanted.extra.scheduleKey) matching.add(n.id);
      else stale.push(n); // 保留原始通知：G3 需要识别「被撤销的是哪条截止排程」
    });
    if (stale.length && local) await local.cancel({ notifications: stale.map(n => ({ id: n.id })) });

    const missing = desired.filter(n => !matching.has(n.id));
    if (missing.length && local) {
      await ensureChannels();
      await local.schedule({ notifications: missing });
    }

    // P0-2：全屏闹钟对账（enabled=false 时传空数组 → 撤销全部已排闹钟）
    const alarmState = await reconcileAlarms(enabled ? alarmDesired : [], items, settings, now);

    // V03：把「已排的截止保护事件」回给上层落库，用于记录原生送达消费
    const deadlineEvents = allDesired
      .filter(n => n.extra && n.extra.event === "deadline" && n.extra.stageKey)
      .map(n => ({
        itemId: n.extra.itemId,
        stageKey: n.extra.stageKey,
        at: n.schedule.at.getTime()
      }));
    // G3：本轮**真的被撤销**的截止排程。上层据此把台账记为 cancelled，
    // 而不是凭「计划时刻已过」推断成 delivered —— 否则撤销过的阶段永远不会补提醒。
    const cancelledDeadlineEvents = stale
      .filter(n => n.extra && n.extra.event === "deadline" && n.extra.stageKey)
      .map(n => ({
        itemId: n.extra.itemId,
        stageKey: n.extra.stageKey,
        at: n.schedule && n.schedule.at ? new Date(n.schedule.at).getTime() : null
      }));
    // V08 / F4：任何影响当前承诺的对账失败（排程或撤销）都必须改变用户可见状态。
    // 撤销失败意味着「旧闹钟可能还在」—— 显示"精确就绪"会掩盖这个风险。
    const alarmFailures = (alarmState.errors || []).length;
    const reliability = alarmFailures > 0 ? "error" : (!enabled ? "in-app" : permissions.reliability);
    const status = Object.assign({}, permissions, {
      enabled,
      reliability,
      desired: allDesired.length,
      scheduled: missing.length,
      cancelled: stale.length,
      alarmCount: alarmDesired.length,
      alarmScheduled: alarmState.scheduled,
      alarmCancelled: alarmState.cancelled,
      scheduledAlarmIds: alarmState.ids,
      deadlineEvents,
      cancelledDeadlineEvents,
      // R7：失败项不再被静默吞掉，状态里带上可诊断的信息
      errors: (alarmState.errors || []).slice()
    });
    if (statusListener) statusListener(status);
    return status;
  }

  function normalizeAction(event) {
    const notification = event && event.notification ? event.notification : {};
    const extra = notification.extra || {};
    return {
      action: event && event.actionId ? event.actionId : "tap",
      itemId: extra.itemId || null,
      // L04：带上投递时的数据版本；调用方据此丢弃"编辑时间之后才点下的旧通知"
      itemRev: extra.itemRev == null ? null : Number(extra.itemRev),
      // F1：截止事件的阶段身份，用于记录「已送达」而不是靠时刻推断
      stageKey: extra.stageKey || null,
      managedKind: extra.managedKind || null,
      notification
    };
  }

  /**
   * V09：取出 → 处理 → 确认删除。
   *
   * 原实现「读取即删除」：JS 拿到动作后若还没落库就崩溃（或处理抛错），这次操作就永久丢了。
   * 现在只有 handler 成功执行完才调 `ackAlarmAction` 显式删除；并且一次排空积压，
   * 而不是每次回前台只取一条。
   *
   * G1：**消费必须串行**。恢复前台（onResume）与 appStateChange 轮询是两个消费入口，
   * 并发进入时会各自把同一个事件取走、各走一遍 handler —— 配合 handler 一侧的
   * 提交中复用（见 app-core 的 inflightAlarmActions），这里再保证同一时刻只有一次排空。
   */
  let drainPromise = null;

  async function drainAlarmActions(handler) {
    if (drainPromise) return drainPromise;
    const running = runDrainAlarmActions(handler);
    drainPromise = running.then(
      value => { drainPromise = null; return value; },
      error => { drainPromise = null; throw error; }
    );
    return drainPromise;
  }

  async function runDrainAlarmActions(handler) {
    const bridge = systemBridge();
    if (!bridge || typeof bridge.consumeAlarmAction !== "function") return 0;
    if (typeof handler !== "function") return 0;
    let processed = 0;
    for (let i = 0; i < 20; i++) {
      let event = null;
      try {
        event = await bridge.consumeAlarmAction();
      } catch (error) {
        break;
      }
      if (!event || !event.action) break;
      const eventId = event.id != null ? event.id : null;
      try {
        // G1：handler 必须等到**真正落库**才返回；失败时它会抛错，这里就不再确认删除
        await handler({
          action: event.action,
          itemId: event.itemId,
          itemRev: event.itemRev,
          alarmEventId: eventId
        });
      } catch (error) {
        // 处理失败：不确认删除，留给下一次重试
        break;
      }
      if (eventId && typeof bridge.ackAlarmAction === "function") {
        try {
          await bridge.ackAlarmAction({ id: eventId });
        } catch (error) {}
      }
      processed++;
    }
    return processed;
  }

  function onAlarmAction(handler) {
    const bridge = systemBridge();
    if (!bridge || typeof handler !== "function") return;
    // 优先事件；否则在 resume 时轮询 consumeAlarmAction
    if (typeof bridge.addListener === "function") {
      try {
        bridge.addListener("alarmAction", data => handler(data || {}));
      } catch (error) {}
    }
    if (typeof bridge.consumeAlarmAction === "function") {
      const poll = () => { drainAlarmActions(handler).catch(() => {}); };
      const app = plugin("App");
      if (app && typeof app.addListener === "function") {
        app.addListener("appStateChange", state => {
          if (state && state.isActive) poll();
        }).catch(() => {});
      }
      // 启动时也消费一次（闹钟动作可能发生在冷启动前）
      setTimeout(poll, 800);
    }
  }

  async function initialize(handlers) {
    handlers = handlers || {};
    statusListener = typeof handlers.onStatusChange === "function" ? handlers.onStatusChange : statusListener;
    if (!isNativeAndroid()) return getPermissionState();
    if (initialized) return getPermissionState();
    initialized = true;

    const local = plugin("LocalNotifications");
    if (local) {
      try {
        await local.registerActionTypes({
          types: [
            {
              id: ACTION_TYPE_ID,
              actions: [
                { id: "ack", title: "我知道了" },
                { id: "snooze", title: "稍后 2 小时" },
                { id: "done", title: "完成" }
              ]
            },
            {
              // L06 / V0.2 §9.3：待整理自己的三个动作，标签与执行效果一一对应
              id: REVIEW_ACTION_TYPE_ID,
              actions: [
                { id: "review_start", title: "开始整理" },
                { id: "review_snooze", title: "稍后 30 分钟" },
                { id: "review_skip", title: "今天跳过" }
              ]
            }
          ]
        });
      } catch (error) {}
      if (typeof handlers.onAction === "function" && local.addListener) {
        try {
          actionListener = await local.addListener("localNotificationActionPerformed", event => {
            const normalized = normalizeAction(event);
            // 只有业务状态真正提交成功后才移除已送达通知；Promise 拒绝时保留通知供用户重试。
            Promise.resolve(handlers.onAction(normalized)).then(() => {
              if (normalized.action !== "tap" && normalized.notification && normalized.notification.id != null &&
                typeof local.removeDeliveredNotifications === "function") {
                return local.removeDeliveredNotifications({ notifications: [{ id: normalized.notification.id }] });
              }
            }).catch(() => {});
          });
        } catch (error) {}
      }
      // F1 / G3：系统**确实送达**的回调 —— 这是「已送达」的**唯一**真实证据。
      // 不再靠「计划时刻已过」去推测：后台送达拿不到这个回调时，阶段记录保持
      // `scheduled`（待投递），既不重复提醒、也不谎报已送达。只有被**确认撤销**
      // 的排程才记为 `cancelled`，从而允许重新开启通知后补提醒。
      if (typeof handlers.onDelivered === "function" && local.addListener) {
        try {
          deliveredListener = await local.addListener("localNotificationReceived", event => {
            const notification = event && event.notification ? event.notification : event || {};
            const extra = notification.extra || (notification.data ? notification.data : {});
            if (extra && extra.managedKind === MANAGED_KIND && extra.event === "deadline" && extra.stageKey) {
              handlers.onDelivered({
                itemId: extra.itemId || null,
                stageKey: extra.stageKey
              });
            }
          });
        } catch (error) {}
      }
    }
    const app = plugin("App");
    if (app && typeof app.addListener === "function" && typeof handlers.onResume === "function") {
      appListener = await app.addListener("appStateChange", state => {
        if (state && state.isActive) handlers.onResume();
      });
    }
    if (local) {
      try { await ensureChannels(); } catch (error) {}
    }
    return getPermissionState();
  }

  async function resetForTests() {
    if (actionListener && actionListener.remove) await actionListener.remove();
    if (deliveredListener && deliveredListener.remove) await deliveredListener.remove();
    if (appListener && appListener.remove) await appListener.remove();
    actionListener = null;
    deliveredListener = null;
    appListener = null;
    statusListener = null;
    initialized = false;
  }

  return {
    ACTION_TYPE_ID,
    REVIEW_ACTION_TYPE_ID,
    MANAGED_KIND,
    REVIEW_MANAGED_KIND,
    SCHEDULE_VERSION,
    CHANNELS,
    POLICY,
    isNativeAndroid,
    systemBridge,
    toLocalDateTime,
    fromLocalDateTime,
    migrateItem,
    effectiveTriggerAt,
    shouldFirstAlarm,
    deadlineStageKey,
    deadlineEventOf,
    buildDesired,
    buildReviewSlots,
    buildReviewDesired,
    reconcileAlarms,
    getPermissionState,
    requestNotificationPermission,
    openExactAlarmSettings,
    ensureChannels,
    reconcile,
    initialize,
    normalizeAction,
    onAlarmAction,
    drainAlarmActions,
    _resetForTests: resetForTests
  };
});
