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
   * Q2：回读校验允许的偏差。JS 算 delayMs 与 Java 落 AlarmManager 之间只隔一次桥调用，
   * 正常在毫秒级；3 秒足以吸收调度抖动而不放过「排在 10 秒后」这类静默失约。
   */
  const ALARM_TIME_TOLERANCE_MS = 3000;

  /**
   * 阶段 C 差量排程缓存：在模块生命周期内跟踪已排闹钟签名，
   * 结合 settings.scheduledAlarmSignatures 实现无变化跳过重排。
   */
  const alarmSignaturesCache = new Map();

  function alarmSignature(n, item) {
    const at = n.schedule.at.getTime();
    const rev = (n.extra && n.extra.itemRev != null) ? n.extra.itemRev : (item && item.rev != null ? item.rev : 0);
    const itemId = (n.extra && n.extra.itemId) || (item && item.id) || "";
    const level = item && item.priority === "important" ? "☆ 重要" :
      item && item.priority === "critical" ? "🚨 关键" : "提醒";
    return [n.id, at, itemId, rev, n.title, n.body, level].join("|");
  }

  /**
   * 截止保护与勿扰规则的阶段、常量与身份：**单一实现在 `lib/reminder.js`**。
   *
   * 这里不再自带任何算法副本，也不再写「拿不到就退化成简化版」的兜底 ——
   * 兜底曾让「只排 p24、丢掉 p2」这种情况在**界面与日志都正常**的前提下静默发生
   * （见 production-scripts.js 的 LOAD_TIME_DEPENDENCIES 注释）。
   * 拿不到规则模块属于**装配错误**，必须当场说清，而不是换一套规则继续跑。
   *
   * 浏览器里由 `AttentionLib` 提供；Node 下（含测试）require 同一个文件。
   */
  const Lib = (function () {
    if (root && root.AttentionLib && root.AttentionLib.deadlineStageKey) return root.AttentionLib;
    try {
      if (typeof require === "function") return require("./reminder.js");
    } catch (error) {}
    return null;
  })();

  if (!Lib || !Lib.deadlineStageKey || !Lib.deadlineStagePoints ||
    !Lib.inQuietHours || !Lib.quietEnd || !Lib.parseHHMM) {
    throw new Error(
      "native-reminders.js: 缺少规则模块 lib/reminder.js（截止阶段 + 勿扰规则的唯一来源）。" +
      "请检查 index.html 的脚本顺序：reminder.js 必须排在 native-reminders.js 之前。"
    );
  }

  /** 宽限期（哪些「已经错过的触发点」还值得补投）—— 常量本身也只在 reminder.js 定义一处 */
  const DEADLINE_GRACE_MS = Lib.DEADLINE_GRACE_MS;

  function deadlineStageKey(deadlineAt, now) {
    return Lib.deadlineStageKey(deadlineAt, now);
  }

  /** V03：每个保护阶段各自预排，而不是只排 deadline-24h 一个点 */
  function deadlineStagePoints(deadlineAt) {
    return Lib.deadlineStagePoints(deadlineAt);
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

  /**
   * D43：单次提醒台账 —— 与 `deadlineEvents` **结构对称**，按「原定触发点」记账。
   *
   * 为什么必须有这份台账：投影只排**严格未来**的触发点（见 buildDesired 的 `at <= now`），
   * 于是「触发点已过、事项仍活跃」的提醒永远拿不到原生通知 —— 用户**少一条提醒**。
   * 而补投必须能回答「这个触发点是不是已经消费过」，否则每次对账都会再补一次
   * （身份稳定 → 同一个 id 反复 notify；身份不稳定 → 撤销/重排循环）。
   *
   * 三态语义与截止台账**逐字相同**（这是本项目已经验证过一遍的模式）：
   *   · `scheduled` 已请求系统投递、还没有送达证据 → **不重排也不补发**（无法判定是否送达）；
   *   · `delivered` 有真实送达证据 → 终态，永不再打扰；
   *   · `cancelled` 排程被成功撤销 → 视同「从未排过」，触发点已过则允许补一次；
   *   · `suppressed` **用户撤销「完成」时确认过不要这一次**（见 `suppressPastReminderReplay`）
   *     → 触发点已过也不补投。
   *
   * 身份的取法也与截止台账一致：**原定触发点**（不是补投时刻），否则每次对账都会换身份。
   */
  function reminderKeyOf(attempt, at) {
    return attempt + "@" + at;
  }

  function reminderEventOf(item, key) {
    const table = item && item.reminderEvents;
    if (!table || typeof table !== "object") return null;
    const rec = table[key];
    return rec && typeof rec === "object" ? rec : null;
  }

  /**
   * R5：把「本次完成期间被取消、且已经跨过原定时刻」的提醒键标成 `suppressed`。
   *
   * 为什么要单独一档、而不直接复用 `cancelled`：`cancelled` 的含义是「排程被撤了，但用户
   * 并没有对这一次表过态」，所以规则允许补一次 —— 那是给「在应用里改了时间/关了提醒」用的。
   * 而撤销「完成」恰恰相反：用户**明确**让这件事结束过，8 秒内反悔只是要把它放回未完成，
   * 并不是要一次迟到的响铃。把两者混成一档，就会出现「刚撤销完就被自己刚取消的闹钟补一响」。
   */
  const REMINDER_STATE_SUPPRESSED = "suppressed";

  function suppressPastReminderReplay(item, now) {
    const table = item && item.reminderEvents;
    if (!table || typeof table !== "object") return [];
    const touched = [];
    Object.keys(table).forEach(key => {
      const ev = table[key];
      if (!ev || typeof ev !== "object" || ev.state !== "cancelled") return;
      const at = Number(String(key).split("@")[1]);
      // 只有**已经过点**的才算：还没到点的那条会被正常重排，不需要抑制
      if (!Number.isFinite(at) || at > now) return;
      table[key] = Object.assign({}, ev, { state: REMINDER_STATE_SUPPRESSED, suppressedAt: now });
      touched.push(key);
    });
    return touched;
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
    // 字段**不在**对象上时才补默认值；已经在（哪怕是 null）就不动 ——
    // 写成 `== null` 会把「已经是 null」也判成需要迁移，于是赋值后下一次仍命中同一条件，
    // `changed` 恒为真：每次冷启动都会产生一次无意义的权威提交 —— 而那次提交写的是
    // 内存当时的状态，写闸门一旦漏判就等于把权威数据覆盖掉。
    if (!("dismissedUntil" in item) || item.dismissedUntil === undefined) {
      item.dismissedUntil = null;
      changed = true;
    }
    return changed;
  }

  /**
   * 勿扰规则**唯一实现在 `lib/reminder.js`**。
   *
   * `parseHHMM` 这里只是**形状适配器**（无算法）：`reminder.js` 返回 `{h, m}`，
   * 本模块历史调用点用的是 `{hour, minute}`。适配器只做字段改名，
   * 不允许再长出第二份正则/第二套跨午夜判断。
   */
  function parseHHMM(value, fallbackHour, fallbackMinute) {
    const r = Lib.parseHHMM(value, fallbackHour, fallbackMinute);
    return { hour: r.h, minute: r.m };
  }

  function inQuietHours(date, settings) {
    return Lib.inQuietHours(date, settings);
  }

  function quietEnd(date, settings) {
    return Lib.quietEnd(date, settings);
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
        // D43：触发点已过时**补投一条**（此前直接 `continue`，用户少收一条通知）。
        // 补投的准入由「单次提醒台账」回答，规则与截止块逐条对齐：
        //   · 已送达 → 不再打扰；
        //   · 已排期且投递时刻已过 → 视为**待定**，既不重排也不补发（无法判定是否送达）；
        //   · 无记录 / 已被撤销 → 触发点已过也立即补一条。
        // 另加一条**去噪**边界：只补「还在补投窗口内」的触发点 —— 复用截止保护的同一个
        // 宽限期常量（DEADLINE_GRACE_MS），否则一个几天前错过的普通事项会在半夜补一条通知，
        // 与「降低打扰」的取舍相反（事项本身早就在首页「待确认」里看得到）。
        const missed = [];
        for (let attempt = 0; attempt < total; attempt++) {
          const at = firstAt + attempt * policy.intervalMs;
          // 尚未到点的排程必须保留，不能提前一秒把系统闹钟撤掉。
          if (at <= now) {
            const key = reminderKeyOf(attempt, at);
            const rec = reminderEventOf(item, key);
            if (rec && rec.state === "delivered") continue;
            if (rec && rec.state === "scheduled") continue;
            // R5：被**撤销完成**抑制掉的键。它在台账里曾经是 `cancelled`（排程确实被撤了），
            // 但那一次取消是用户自己按「完成」造成的；8 秒内撤销完成后如果只按
            // 「无记录 / 已被撤销 ⇒ 立即补一条」处理，用户就会收到一次**自己刚取消掉的**提醒
            // （独立验收 R5：约 now+2 秒、catchUp:true 的普通通知）。
            // 抑制只作用于这一条键，**不改变全局补投规则** —— 其它触发点照旧。
            if (rec && rec.state === REMINDER_STATE_SUPPRESSED) continue;
            // 用户明确要求「在此之前别打扰」时不得补投打断这个承诺
            if (item.dismissedUntil && now < Number(item.dismissedUntil)) continue;
            if (at > now - DEADLINE_GRACE_MS) missed.push({ attempt, at });
            continue;
          }
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
          n.extra.reminderKey = reminderKeyOf(attempt, at);
          desired.push(n);
        }
        if (missed.length) {
          // 与 D44-b 同一取舍：全都错过时保留**最后一次**尝试（「马上就要到点」最准确）。
          const pick = missed[missed.length - 1];
          const n = notificationFor(
            item,
            pick.attempt === 0 ? "primary" : "realert",
            pick.attempt,
            now + 2000,
            settings || {},
            usedIds,
            pick.at
          );
          // 补投**不**走全屏闹钟：错过的提醒应当是普通通知，抢屏等于把一次迟到
          // 变成一次打扰（历史决策：全屏闹钟只给「关键档且首次」）。
          n.extra.reminderKey = reminderKeyOf(pick.attempt, pick.at);
          n.extra.catchUp = true;
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
          // N-08：多个保护点可能**同时**过期 —— 截止不足 2 小时时 p24 与 p2 都已 <= now，
          // 原实现会让两者各自补投 `now + 2000`，同一事项在同一毫秒弹出**两条**通知。
          // 「全都错过了」只应补一条，因此先把待补投的阶段收起来，循环后再挑一条产出。
          const catchups = [];
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
              catchups.push(point);
              return;
            }
            if (at > now + 1000) {
              const n = notificationFor(item, "deadline", 0, at, settings || {}, usedIds, point.at);
              n.extra.stageKey = stageKey;
              desired.push(n);
            }
          });
          if (catchups.length) {
            // 全部过期时保留**最接近截止**的阶段（p2 = 最终保护），它表达「马上就要截止」最准确；
            // 只剩更早的阶段过期（截止还有 2h 以上）时才补那一个。
            const point = catchups.find(p => p.id === "p2") || catchups[catchups.length - 1];
            const at = now + 2000;
            const stageKey = point.id + "@" + deadlineTs;
            const n = notificationFor(item, "deadline", 0, at, settings || {}, usedIds, point.at);
            n.extra.stageKey = stageKey;
            desired.push(n);
          }
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
    if (anchor >= windowEnd.getTime()) return [];
    const slots = [{ index: 0, at: anchor }];
    for (let i = 1; i <= maxFollowups; i++) {
      const raw = anchor + i * followupMs;
      const at = shift(raw);
      // 所有普通槽位都受硬窗口约束，终点不含；主动稍后在调用方独立处理。
      if (at >= windowEnd.getTime()) continue;
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
    const previousSession = new Date(todaySession);
    previousSession.setDate(previousSession.getDate() - 1);
    let sessionSlots = buildReviewSlots(reviewSettings, settings, previousSession.getTime())
      .filter(s => s.at > now + 1000);
    if (!sessionSlots.length) sessionSlots = buildReviewSlots(reviewSettings, settings, todaySession)
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
   * Q2：**排钟之后必须回读原生实际落的时刻。**
   *
   * 只断言「调用成功」抓不到「参数被平台静默丢弃」—— 那正是 Q2 的形态：
   * `scheduleAlarm` 一路 resolve `{ok:true}`，可闹钟其实排在 10 秒后。
   * 原生插件回传 `triggerAt`（见 SystemBridgePlugin.scheduleAlarmInternal）；
   * 与**本次请求所声明的时刻**偏差超过阈值就记成错误，让 `reliability` 变成
   * `error`（用户可见），而不是悄悄失约。
   *
   * 比较基准刻意用「发送时刻 + 本次请求的 delayMs」而不是绝对日历时刻：
   * 前者只考察「原生有没有照单执行」，不受两端时钟偏差影响。
   * 返回值缺 `triggerAt` 时不做判断（旧实现 / 测试替身），避免误报。
   */
  function alarmTimeDrift(result, askedAt) {
    const actual = Number(result && result.triggerAt);
    if (!Number.isFinite(actual) || actual <= 0) return null;
    return actual - askedAt;
  }

  /**
   * P0-2：全屏闹钟对账。
   * 此前只调 scheduleAlarm、从不调 cancelAlarm，导致删除/改期/ACK/关通知权限后
   * 已排的全屏闹钟照响（幽灵闹钟，违反 AC-11 / INV-09）。
   *
   * 阶段 C 改进：引入差量排程。
   * 比对上一轮已排的签名（id, triggerAt, itemId, itemRev, title, body, level），
   * 签名无变化时保留既有排程与 token，跳过 scheduleAlarm 调用；
   * 仅在新闹钟、改期、内容/版本变更或显式 forceRebuild 时重新安排；
   * 过时项及时撤销。
   */
  async function reconcileAlarms(desired, items, settings, now, options) {
    options = options || {};
    now = now == null ? Date.now() : Number(now);
    const bridge = systemBridge();
    const prev = Array.isArray(settings && settings.scheduledAlarmIds)
      ? settings.scheduledAlarmIds.filter(id => typeof id === "number")
      : [];
    const prevSignatures = (settings && typeof settings.scheduledAlarmSignatures === "object" && settings.scheduledAlarmSignatures)
      ? settings.scheduledAlarmSignatures
      : {};
    const wanted = desired.map(n => n.id);
    const wantedSet = new Set(wanted);
    const stale = prev.filter(id => !wantedSet.has(id));

    if (!bridge || (!bridge.scheduleAlarm && !bridge.scheduleAt)) {
      // 桥不可用：保留原台账，别把「其实还挂着」的闹钟忘掉（否则桥恢复后永远撤不掉）
      return { available: false, cancelled: 0, scheduled: 0, ids: prev, signatures: prevSignatures, errors: [] };
    }

    const errors = [];
    // R7：台账只记录「确认仍然有效」的 id。
    //  · 撤销失败 → 保留，下一次对账还要再撤它（否则留下幽灵闹钟）
    //  · 排程失败 → 不入账，下一次对账会重新尝试
    const held = new Set(prev.filter(id => wantedSet.has(id)));
    const nextSignatures = Object.assign({}, prevSignatures);

    let cancelled = 0;
    if (bridge.cancelAlarm) {
      for (const id of stale) {
        try {
          await bridge.cancelAlarm({ id });
          cancelled++;
          delete nextSignatures[id];
          alarmSignaturesCache.delete(id);
        } catch (error) {
          held.add(id);
          errors.push("cancel:" + id + ":" + (error && error.message ? error.message : String(error)));
        }
        // R8：闹钟撤销后残留的通知也要清掉，否则点旧通知会再次进入全屏界面
        if (bridge.cancelNotification) {
          try { await bridge.cancelNotification({ id, preserveActive: true }); } catch (error) {}
        }
      }
    }

    let scheduled = 0;
    const forceRebuild = !!options.forceRebuild;
    if (forceRebuild) {
      alarmSignaturesCache.clear();
    }
    // O4：原先每个 desired 项都 `items.find(x => x.id === …)`，一次对账是
    // O(desired × items)。这里**调用内**建一次索引，语义与 `Array.find` 逐字一致 ——
    // 先出现者胜（重复 id 不会被后出现者覆盖，那会把「首项」静默变成「末项」）。
    // `items` 是调用方传入的固定数组（app-core 传的是已提交快照），循环内不增删成员。
    const itemsById = new Map();
    (Array.isArray(items) ? items : []).forEach(x => {
      if (!x) return;
      if (itemsById.has(x.id)) return;
      itemsById.set(x.id, x);
    });
    for (const n of desired) {
      const item = itemsById.get(n.extra.itemId);
      const level = item && item.priority === "important" ? "☆ 重要" :
        item && item.priority === "critical" ? "🚨 关键" : "提醒";
      const sig = alarmSignature(n, item);

      // 阶段 C 差量排程：仅当当前运行会话（内存缓存）已经成功排程且签名未变、且未要求强制重建时，跳过重排
      if (!forceRebuild && alarmSignaturesCache.has(n.id) && alarmSignaturesCache.get(n.id) === sig && held.has(n.id)) {
        nextSignatures[n.id] = sig;
        continue;
      }

      const basis = (item && item.scheduleBasis) ? item.scheduleBasis : "wall-clock";
      let localTrigger = null;
      if (basis === "wall-clock") {
        if (item && item.localTrigger) {
          localTrigger = item.localTrigger;
        } else {
          localTrigger = toLocalDateTime(n.schedule.at);
        }
      }

      const payload = {
        title: n.title,
        body: n.body,
        id: n.id,
        itemId: (n.extra && n.extra.itemId) || "",
        itemRev: n.extra && n.extra.itemRev != null ? n.extra.itemRev : 0,
        // UX-T03：闹钟通道也要带上提醒键，否则原生落下的送达证据
        // 回不到三态台账的 `<attempt>@<原定时刻>` 上（现在是空的）。
        reminderKey: (n.extra && n.extra.reminderKey) || "",
        level,
        scheduleBasis: basis,
        localTrigger
      };
      try {
        let result = null;
        const expectedAt = n.schedule.at.getTime();
        const sentAt = Date.now();
        // 本次请求实际声明的落点：scheduleAlarm 走相对延迟，scheduleAt 走绝对时刻
        let askedAt = expectedAt;
        if (bridge.scheduleAlarm) {
          const delayMs = Math.max(1000, expectedAt - sentAt);
          askedAt = sentAt + delayMs;
          result = await bridge.scheduleAlarm(Object.assign({ delayMs }, payload));
        } else {
          result = await bridge.scheduleAt(Object.assign({ at: expectedAt }, payload));
        }
        scheduled++;
        held.add(n.id);
        nextSignatures[n.id] = sig;
        alarmSignaturesCache.set(n.id, sig);
        // Q2：排下去不等于排对了 —— 回读原生真正落的时刻，偏差过大必须变成可见错误。
        // 只在请求的就是「未来时刻」时校验：过去时刻原生会夹到最小延迟，偏差属正常。
        if (expectedAt > sentAt) {
          const drift = alarmTimeDrift(result, askedAt);
          if (drift != null && Math.abs(drift) > ALARM_TIME_TOLERANCE_MS) {
            errors.push("verify:" + n.id + ":drift=" + drift + "ms");
          }
        }
      } catch (error) {
        delete nextSignatures[n.id];
        alarmSignaturesCache.delete(n.id);
        errors.push("schedule:" + n.id + ":" + (error && error.message ? error.message : String(error)));
      }
    }

    return {
      available: true,
      cancelled,
      scheduled,
      ids: Array.from(held).sort((a, b) => a - b),
      signatures: nextSignatures,
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

  async function reconcile(items, settings, now, review, options) {
    if (!isNativeAndroid()) return getPermissionState();
    options = options || {};
    const local = plugin("LocalNotifications");
    const permissions = await getPermissionState();

    // 阶段 A：业务总开关控制是否生成完整计划。开关关闭时清空计划并撤销未来提醒。
    const notifySwitchOn = !!(settings && settings.notify);
    const notificationsGranted = permissions.notifications === "granted";

    // 总开关打开时生成完整期望计划；总开关关闭时清空（撤销全部未来提醒）
    let allDesired = notifySwitchOn ? buildDesired(items, settings, now) : [];
    // P0-1：待整理排程并入同一次对账（通知权限具备且业务总开关打开时预排）
    if (notifySwitchOn && local && review && review.count && notificationsGranted) {
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
    const localErrors = [];
    let pending = [];
    try {
      if (local) {
        const result = await local.getPending();
        pending = Array.isArray(result && result.notifications) ? result.notifications.filter(isManaged) : [];
      }
    } catch (error) {
      localErrors.push("notifications:pending:" + String(error.message || error));
    }

    const desiredById = new Map(desired.map(n => [n.id, n]));
    const matching = new Set();
    const stale = [];
    pending.forEach(n => {
      const wanted = desiredById.get(n.id);
      if (wanted && n.extra && n.extra.scheduleKey === wanted.extra.scheduleKey) matching.add(n.id);
      else stale.push(n); // 保留原始通知：G3 需要识别「被撤销的是哪条截止排程」
    });

    // 阶段 A：闹钟计划不依赖通知权限，也不依赖 LocalNotifications 插件存在，
    // 仅受业务开关、事项有效性及 SystemBridge 能力约束。
    const alarmState = await reconcileAlarms(notifySwitchOn ? alarmDesired : [], items, settings, now, options);

    let cancelled = [];
    let scheduled = [];
    try {
      if (stale.length && local) {
        await local.cancel({ notifications: stale.map(n => ({ id: n.id })) });
        cancelled = stale;
      }
      // 阶段 A：普通通知受通知权限和 LocalNotifications 可用性约束
      if (notificationsGranted && notifySwitchOn) {
        const missing = desired.filter(n => !matching.has(n.id));
        if (missing.length && local) {
          await ensureChannels();
          await local.schedule({ notifications: missing });
          scheduled = missing;
        }
      }
    } catch (error) {
      localErrors.push("notifications:sync:" + String(error.message || error));
    }

    // 阶段 A：通知拒绝时不凭空记普通通知“已排/已送达”；只有真正已排或已确认有效的通知进入 acceptedIds
    const acceptedIds = (notificationsGranted && notifySwitchOn)
      ? new Set([...matching, ...scheduled.map(n => n.id)])
      : new Set();

    // D43：单次提醒台账的准入集合还要并上**闹钟通道**真正排下的 id。
    // 关键/重要档的首次提醒走 SystemBridge（`extra.useAlarm`），不在 LocalNotifications
    // 的 pending 里；只用 acceptedIds 判会把它们误记成「从未排过」→ 到点后重复补投。
    // 桥不可用时 reconcileAlarms 原样回传旧台账（ids = prev），那种情况**不能**当「已排」——
    // 否则排程失败的事项再也补不回来，故用 available 严格把关。
    const alarmAccepted = new Set(
      alarmState && alarmState.available !== false && Array.isArray(alarmState.ids) ? alarmState.ids : []
    );
    const reminderAccepted = new Set([...acceptedIds, ...alarmAccepted]);

    // V03：把「已排的截止保护事件」回给上层落库，用于记录原生送达消费
    const deadlineEvents = allDesired
      .filter(n => acceptedIds.has(n.id) && n.extra && n.extra.event === "deadline" && n.extra.stageKey)
      .map(n => ({
        itemId: n.extra.itemId,
        stageKey: n.extra.stageKey,
        at: n.schedule.at.getTime()
      }));
    // G3：本轮**真的被撤销**的截止排程。上层据此把台账记为 cancelled，
    // 而不是凭「计划时刻已过」推断成 delivered —— 否则撤销过的阶段永远不会补提醒。
    const cancelledDeadlineEvents = cancelled
      .filter(n => n.extra && n.extra.event === "deadline" && n.extra.stageKey)
      .map(n => ({
        itemId: n.extra.itemId,
        stageKey: n.extra.stageKey,
        at: n.schedule && n.schedule.at ? new Date(n.schedule.at).getTime() : null
      }));
    // D43：与截止事件对称 —— 把本轮已排的单次提醒回给上层落库，用于回答
    // 「这个触发点是否已经消费过」。没有这条回传，补投就会每次对账都重来一遍。
    const reminderEvents = allDesired
      .filter(n => reminderAccepted.has(n.id) && n.extra && n.extra.reminderKey)
      .map(n => ({
        itemId: n.extra.itemId,
        key: n.extra.reminderKey,
        at: n.schedule.at.getTime()
      }));
    const cancelledReminderEvents = cancelled
      .filter(n => n.extra && n.extra.reminderKey)
      .map(n => ({
        itemId: n.extra.itemId,
        key: n.extra.reminderKey,
        at: n.schedule && n.schedule.at ? new Date(n.schedule.at).getTime() : null
      }));
    // V08 / F4：任何影响当前承诺的对账失败（排程或撤销）都必须改变用户可见状态。
    // 撤销失败意味着「旧闹钟可能还在」—— 显示"精确就绪"会掩盖这个风险。
    const errors = (alarmState.errors || []).concat(localErrors);
    const alarmFailures = errors.length;
    // 阶段 A 能力状态区分声振、通知、屏幕和准点能力
    const capabilities = {
      sound: notifySwitchOn && (alarmDesired.length > 0
        ? (alarmState && alarmState.available !== false && (alarmState.ids || []).length > 0)
        : (notificationsGranted && local != null)),
      notifications: permissions.notifications === "granted",
      screen: !!(permissions.diag && (permissions.diag.canDrawOverlays || permissions.diag.canUseFullScreenIntent)),
      exact: permissions.exactAlarm === "granted"
    };

    const reliability = alarmFailures > 0 ? "error" : (!notifySwitchOn ? "in-app" : (notificationsGranted ? permissions.reliability : "in-app"));
    const status = Object.assign({}, permissions, {
      enabled: notifySwitchOn,
      notifySwitchOn,
      notificationsGranted,
      capabilities,
      reliability,
      desired: allDesired.length,
      scheduled: scheduled.length,
      cancelled: cancelled.length,
      alarmCount: alarmDesired.length,
      alarmScheduled: alarmState.scheduled,
      alarmCancelled: alarmState.cancelled,
      scheduledAlarmIds: alarmState.ids,
      scheduledAlarmSignatures: alarmState.signatures || {},
      deadlineEvents,
      cancelledDeadlineEvents,
      // D43：单次提醒台账（与截止台账同构）
      reminderEvents,
      cancelledReminderEvents,
      // R7：失败项不再被静默吞掉，状态里带上可诊断的信息
      errors
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

  /**
   * Q1：**`addListener` 的返回契约随运行环境变化，不能直接链式 `.catch()`。**
   *
   * 本仓库没有打包器，WebView 里只有原生注入的 `native-bridge.js`；插件方法由
   * Android 侧 `JSExport.getPluginJS()` 生成：
   *
   *     t.addListener = function (eventName, callback) {
   *       return w.Capacitor.addListener('<pluginId>', eventName, callback);
   *     }
   *
   * 而 `native-bridge.js` 里的 `cap.addListener` **同步返回 `{ remove }` 句柄对象**——
   * 它不带 `.then` / `.catch`。（官方 `@capacitor/core` 的 `capacitor.js` 确实会返回
   * Promise 并把 `.remove` 挂在上面，但本项目并未打包它，那条路径不存在。）
   *
   * 因此 `addListener(...).catch(...)` 在真机上抛
   * `TypeError: app.addListener(...).catch is not a function`。更要命的是
   * `onAlarmAction()` 是**同步函数**，异常会直接冒泡出 `init()`，
   * 使第 5129 行之后的 seed / render / 15 秒心跳全部不执行 —— 且不崩溃、不弹错。
   *
   * `Promise.resolve()` 同时接受两种契约：句柄对象立即兑现，Promise 则原样接住拒绝。
   * 返回值原样透出，方便调用方持有句柄；注册失败（含同步抛错）返回 null，**绝不牵连调用方**。
   */
  function listenSafely(target, eventName, callback) {
    if (!target || typeof target.addListener !== "function") return null;
    let handle = null;
    try {
      handle = target.addListener(eventName, callback);
    } catch (error) {
      // 该监听注册失败，但不允许它冒泡出去 —— 监听是旁路能力，不是启动前提
      return null;
    }
    Promise.resolve(handle).catch(() => {});
    return handle;
  }

  function onAlarmAction(handler) {
    const bridge = systemBridge();
    if (!bridge || typeof handler !== "function") return;
    // 优先事件；否则在 resume 时轮询 consumeAlarmAction
    listenSafely(bridge, "alarmAction", data => handler(data || {}));
    if (typeof bridge.consumeAlarmAction === "function") {
      const poll = () => { drainAlarmActions(handler).catch(() => {}); };
      // Q1：这里此前是 `app.addListener(...).catch(() => {})`，真机上同步抛错并中断整个 init()
      listenSafely(plugin("App"), "appStateChange", state => {
        if (state && state.isActive) poll();
      });
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
              return;
            }
            // UX-T03：**普通提醒（primary / realert）也有送达回调** —— 此前这里显式只认
            // deadline，于是「已响过的提醒也停在 scheduled」成了系统性事实。
            // 通知通道的这一层只能证明「系统接收/提交」，因此 level 固定为 received。
            if (typeof handlers.onReminderDelivered === "function" &&
              extra && extra.managedKind === MANAGED_KIND && extra.reminderKey) {
              handlers.onReminderDelivered({
                itemId: extra.itemId || null,
                reminderKey: String(extra.reminderKey),
                itemRev: extra.itemRev == null ? null : String(extra.itemRev),
                carrier: "notification",
                receivedAt: Date.now(),
                level: "received"
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

  /**
   * UX-T03：读取原生**持久**的送达证据。
   *
   * 为什么不能只靠 JS 运行期的监听：闹钟通道的首次提醒（重要/关键档）由原生服务
   * 投递，那时 WebView 可能根本没在跑；只挂监听等于「没打开 App 的那次永远没证据」。
   * 也不能只读 150 条的诊断环形日志（会被高频事件挤掉）或「最后一次投递结果」。
   *
   * 返回值形状固定为 `{ available, rows, retention, reason }`：
   *  · `available: false` 表示**这次读不到**（桥不支持 / 抛错 / 原生自己报不可用）——
   *    调用方必须按 unknown 处理，不得因此指控「漏提醒」；
   *  · `available: true, rows: []` 是**真的没有证据**，与上一条是两件事。
   *
   * 独立验收 R7b：这里以前无条件返回 `available: true`，把原生明确报出的
   * `available:false`（例如证据存储读失败）吞成「读到了，只是空的」——
   * 于是「读不到」与「没有证据」在下游变成同一个结论，D70 前置核验那条误报又有了入口。
   */
  async function getDeliveryEvidence(options) {
    options = options || {};
    if (!isNativeAndroid()) {
      return { available: false, rows: [], reason: "not-native", retention: null };
    }
    const bridge = systemBridge();
    if (!bridge || typeof bridge.deliveryEvidence !== "function") {
      return { available: false, rows: [], reason: "bridge-unsupported", retention: null };
    }
    try {
      const res = await bridge.deliveryEvidence({ since: options.since || 0 });
      const rows = Array.isArray(res && res.evidence) ? res.evidence : [];
      // 原生说读不到就照实转述：**不**因为「数组是空的」就改口说读成功
      if (res && res.available === false) {
        return {
          available: false,
          rows: [],
          reason: (res && (res.error || res.reason)) || "native-unavailable",
          retention: null
        };
      }
      return {
        available: true,
        rows: rows,
        retention: {
          maxAgeMs: res && res.retentionMaxAgeMs ? Number(res.retentionMaxAgeMs) : null,
          capacity: res && res.retentionCapacity ? Number(res.retentionCapacity) : null
        },
        reason: ""
      };
    } catch (error) {
      return {
        available: false,
        rows: [],
        reason: (error && error.message ? error.message : String(error)),
        retention: null
      };
    }
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
    alarmSignaturesCache.clear();
  }

  return {
    ACTION_TYPE_ID,
    REVIEW_ACTION_TYPE_ID,
    MANAGED_KIND,
    REVIEW_MANAGED_KIND,
    SCHEDULE_VERSION,
    CHANNELS,
    POLICY,
    ALARM_TIME_TOLERANCE_MS,
    isNativeAndroid,
    systemBridge,
    toLocalDateTime,
    fromLocalDateTime,
    migrateItem,
    effectiveTriggerAt,
    shouldFirstAlarm,
    deadlineStageKey,
    deadlineEventOf,
    reminderKeyOf,
    reminderEventOf,
    REMINDER_STATE_SUPPRESSED,
    suppressPastReminderReplay,
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
    // UX-T03：原生送达证据的回读入口
    getDeliveryEvidence,
    _resetForTests: resetForTests
  };
});
