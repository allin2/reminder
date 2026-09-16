/* Android native reminder projection for Capacitor — UMD */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.AttentionNativeReminders = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const ACTION_TYPE_ID = "attention-actions";
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

  let initialized = false;
  let actionListener = null;
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
    return [SCHEDULE_VERSION, item.id, event, attempt, at, title, body, channelId].join("|");
  }

  function notificationFor(item, event, attempt, at, settings, usedIds) {
    const privacy = !!(settings && settings.privacyNotify);
    const title = item.priority === "critical" ? "🚨 关键事项" :
      item.priority === "important" ? "☆ 重要事项" :
      event === "deadline" ? "截止时间临近" : "安心收件箱提醒";
    const body = privacy ? "有一条事项需要你确认" : String(item.title || "未命名事项");
    const channelId = CHANNELS[item.priority] || CHANNELS.normal;
    const key = scheduleKey(item, event, attempt, at, title, body, channelId);
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
    const sorted = (Array.isArray(items) ? items.slice() : []).sort((a, b) =>
      String(a && a.id || "").localeCompare(String(b && b.id || ""))
    );

    sorted.forEach(item => {
      if (!item || !item.id || item.status === "archived" || item.status === "completed") return;
      if (item.review_status === "NEEDS_REVIEW") return;
      const active = item.status === "waiting" || item.status === "snoozed" || item.status === "due";
      if (active && item.triggerAt) {
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

      if (item.deadlineAt) {
        let deadlineAt = Number(item.deadlineAt) - 24 * 60 * 60 * 1000;
        if (deadlineAt <= now && Number(item.deadlineAt) > now) deadlineAt = now + 2000;
        if (deadlineAt > now + 1000) {
          desired.push(notificationFor(item, "deadline", 0, deadlineAt, settings || {}, usedIds));
        }
      }
    });

    return desired.sort((a, b) => a.schedule.at.getTime() - b.schedule.at.getTime() || a.id - b.id);
  }

  function reviewNotificationFor(count, attempt, at, usedIds) {
    const title = "待整理";
    const body = "有 " + count + " 条随手记录待整理 · 预计只需几分钟";
    const key = [SCHEDULE_VERSION, "review", attempt, at, title, body].join("|");
    return {
      title,
      body,
      id: allocateId(key, usedIds),
      channelId: CHANNELS.important,
      autoCancel: true,
      sound: "attention_reminder",
      schedule: { at: new Date(at), allowWhileIdle: true },
      extra: {
        managedKind: REVIEW_MANAGED_KIND,
        scheduleVersion: SCHEDULE_VERSION,
        itemId: "review-session",
        event: "review",
        attempt,
        scheduleKey: key
      }
    };
  }

  /** D19/D22：待整理用 LocalNotifications 预排，60 分钟 × 2 次补提醒 */
  function buildReviewDesired(count, reviewSettings, now) {
    if (!count || !reviewSettings || !reviewSettings.enabled) return [];
    now = now == null ? Date.now() : Number(now);
    const usedIds = new Set();
    const hour = reviewSettings.hour != null ? reviewSettings.hour : 21;
    const minute = reviewSettings.minute != null ? reviewSettings.minute : 30;
    const start = new Date(now);
    start.setHours(hour, minute, 0, 0);
    if (start.getTime() <= now) start.setDate(start.getDate() + 1);
    const out = [reviewNotificationFor(count, 0, start.getTime(), usedIds)];
    const followupMs = reviewSettings.followupMs != null ? reviewSettings.followupMs : 60 * 60 * 1000;
    const maxFollowups = reviewSettings.maxFollowups != null ? reviewSettings.maxFollowups : 2;
    for (let i = 1; i <= maxFollowups; i++) {
      out.push(reviewNotificationFor(count, i, start.getTime() + i * followupMs, usedIds));
    }
    return out;
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

  async function reconcile(items, settings, now) {
    if (!isNativeAndroid()) return getPermissionState();
    const local = plugin("LocalNotifications");
    const permissions = await getPermissionState();
    const enabled = !!(settings && settings.notify) && permissions.notifications === "granted";
    const allDesired = enabled && local ? buildDesired(items, settings, now) : [];
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
      else stale.push({ id: n.id });
    });
    if (stale.length && local) await local.cancel({ notifications: stale });

    const missing = desired.filter(n => !matching.has(n.id));
    if (missing.length && local) {
      await ensureChannels();
      await local.schedule({ notifications: missing });
    }

    // 首次全屏闹钟（D9 / D25）
    if (enabled && alarmDesired.length) {
      const bridge = systemBridge();
      if (bridge && (bridge.scheduleAlarm || bridge.scheduleAt)) {
        for (const n of alarmDesired) {
          try {
            const delayMs = Math.max(1000, n.schedule.at.getTime() - Date.now());
            const item = items.find(x => x && x.id === n.extra.itemId);
            const level = item && item.priority === "important" ? "☆ 重要" :
              item && item.priority === "critical" ? "🚨 关键" : "提醒";
            const payload = {
              title: n.title,
              body: n.body,
              id: n.id,
              itemId: (n.extra && n.extra.itemId) || "",
              level
            };
            if (bridge.scheduleAlarm) await bridge.scheduleAlarm(Object.assign({ delayMs }, payload));
            else if (bridge.scheduleAt) await bridge.scheduleAt(Object.assign({ at: n.schedule.at.getTime() }, payload));
          } catch (error) {}
        }
      }
    }

    const status = Object.assign({}, permissions, {
      enabled,
      reliability: enabled ? permissions.reliability : "in-app",
      desired: allDesired.length,
      scheduled: missing.length,
      cancelled: stale.length,
      alarmCount: alarmDesired.length
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
      managedKind: extra.managedKind || null,
      notification
    };
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
      const poll = async () => {
        try {
          const r = await bridge.consumeAlarmAction();
          if (r && r.action) handler(r);
        } catch (error) {}
      };
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
          types: [{
            id: ACTION_TYPE_ID,
            actions: [
              { id: "ack", title: "我知道了" },
              { id: "snooze", title: "稍后 2 小时" },
              { id: "done", title: "完成" }
            ]
          }]
        });
      } catch (error) {}
      if (typeof handlers.onAction === "function" && local.addListener) {
        try {
          actionListener = await local.addListener("localNotificationActionPerformed", event => {
            const normalized = normalizeAction(event);
            if (normalized.action !== "tap" && normalized.notification && normalized.notification.id != null &&
              typeof local.removeDeliveredNotifications === "function") {
              local.removeDeliveredNotifications({ notifications: [{ id: normalized.notification.id }] }).catch(() => {});
            }
            handlers.onAction(normalized);
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
    if (appListener && appListener.remove) await appListener.remove();
    actionListener = null;
    appListener = null;
    statusListener = null;
    initialized = false;
  }

  return {
    ACTION_TYPE_ID,
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
    buildDesired,
    buildReviewDesired,
    getPermissionState,
    requestNotificationPermission,
    openExactAlarmSettings,
    ensureChannels,
    reconcile,
    initialize,
    normalizeAction,
    onAlarmAction,
    _resetForTests: resetForTests
  };
});
