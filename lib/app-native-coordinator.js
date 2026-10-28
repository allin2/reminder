/* P3-E native reminder coordinator layer. UMD factory; evaluation performs no IO or state mutation. */
(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.AppNativeCoordinator = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";

  function createAppNativeCoordinator(input) {
    const deps = input || {};
    const REQUIRED_DEPS = [
      "getItems", "getSettings", "authoritativeWritesAllowed", "save",
      "runUserOp", "getNativeReminders", "getEvidenceLib", "onStatusChange",
      "onNotificationAction", "handleAlarmAction", "needsReviewCount", "ensureReviewSettings",
      "promoteDue", "refreshActiveAlarmPanel", "renderMe"
    ];
    REQUIRED_DEPS.forEach(function(name) {
      if (typeof deps[name] !== "function") {
        throw new Error("createAppNativeCoordinator(deps) 缺少依赖：" + name);
      }
    });

    const timerSet = typeof deps.setTimeout === "function" ? deps.setTimeout : (typeof setTimeout !== "undefined" ? setTimeout : function () {});
    const timerClear = typeof deps.clearTimeout === "function" ? deps.clearTimeout : (typeof clearTimeout !== "undefined" ? clearTimeout : function () {});

    let nativeReady = false;
    let nativeSyncTimer = null;
    let nativeInitPromise = null;
    let nativeSyncInFlight = false;
    let nativeSyncPending = false;
    let nativeForceRebuildPending = false;
    let nativeSyncVersion = 0;
    const nativeSyncMetrics = {
      totalRequests: 0,
      bySource: {},
      runs: 0,
      deduped: 0,
      blockedByAuthority: 0
    };

    let nativeReminderStatus = {
      native: false,
      notifications: "unknown",
      exactAlarm: "unknown",
      reliability: "web"
    };

    const deliveryEvidenceState = {
      readable: null,
      lastReadAt: 0,
      rows: 0,
      reason: "",
      retention: null,
      // B-3（JS 侧）：闹钟投递档案（lastAlarmDelivery，含 notificationPosted）——
      // 证据通道之外唯一已持久化的「系统通知已投递」记录，readDeliveryEvidence
      // 顺带回读进状态；null = 桥/能力不可用，不参与 readable 判据。
      lastAlarmDelivery: null
    };
    let deliveryEvidenceInFlight = false;

    function getNativeReminders() {
      return deps.getNativeReminders() || {};
    }

    function getEvidenceLib() {
      return deps.getEvidenceLib();
    }

    function isNativeReady() {
      return nativeReady;
    }

    function getNativeSyncMetrics() {
      return nativeSyncMetrics;
    }

    function getNativeSyncVersion() {
      return nativeSyncVersion;
    }

    function bumpNativeSyncVersion() {
      nativeSyncVersion++;
    }

    function getNativeReminderStatus() {
      return Object.assign({}, nativeReminderStatus);
    }

    function getDeliveryEvidenceState() {
      return Object.assign({}, deliveryEvidenceState);
    }

    function deliveryEvidenceReadable() {
      return deliveryEvidenceState.readable;
    }

    function isNativeAndroidRuntime() {
      if (typeof deps.isNativeAndroidRuntime === "function") {
        return deps.isNativeAndroidRuntime();
      }
      return false;
    }

    function waitForNativeBridge(timeoutMs) {
      if (typeof deps.waitForNativeBridge === "function") {
        return deps.waitForNativeBridge(timeoutMs);
      }
      return Promise.resolve(false);
    }

    function sameIdSet(a, b) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }

    function indexItemsById(list) {
      const map = new Map();
      (list || []).forEach(it => {
        if (!it) return;
        if (map.has(it.id)) return;
        map.set(it.id, it);
      });
      return map;
    }

    function reminderKeyInTriggerRange(key, triggerAt) {
      const at = Number(String(key).split("@")[1]);
      return Number.isFinite(at) && at >= triggerAt;
    }

    function refreshNativeScheduleBasis() {
      const nr = getNativeReminders();
      if (!nr.migrateItem) return false;
      let changed = false;
      const items = deps.getItems() || [];
      items.forEach(it => {
        if (nr.migrateItem(it)) changed = true;
      });
      if (changed) deps.save();
      return changed;
    }

    function setNativeReminderStatus(status, origin) {
      const previousExact = nativeReminderStatus.exactAlarm;
      nativeReminderStatus = Object.assign({}, nativeReminderStatus, status || {});
      // 对账也会回读权限；集中检测，避免其先写入 denied 吞掉 onResume 的权限边沿。
      if (nativeReady && (previousExact === "granted" || previousExact === "denied") &&
          status && status.exactAlarm && status.exactAlarm !== "unknown" &&
          previousExact !== status.exactAlarm) {
        nativeForceRebuildPending = true;
        queueNativeReminderSync("exact-permission-changed");
      }
      deps.onStatusChange(nativeReminderStatus, origin);
    }

    function applyDeadlineEvents(events, now, cancelledEvents, options) {
      const planned = new Map();
      (events || []).forEach(ev => {
        if (!ev || !ev.itemId || !ev.stageKey) return;
        if (!planned.has(ev.itemId)) planned.set(ev.itemId, new Map());
        planned.get(ev.itemId).set(ev.stageKey, Number(ev.at));
      });
      const cancelledKeys = new Map();
      (cancelledEvents || []).forEach(ev => {
        if (!ev || !ev.itemId || !ev.stageKey) return;
        if (!cancelledKeys.has(ev.itemId)) cancelledKeys.set(ev.itemId, new Set());
        cancelledKeys.get(ev.itemId).add(ev.stageKey);
      });
      let changed = false;
      const targetItemIds = new Set(planned.keys());
      cancelledKeys.forEach((_v, itemId) => targetItemIds.add(itemId));
      const items = deps.getItems() || [];
      items.forEach(it => {
        if (it && it.deadlineEvents && typeof it.deadlineEvents === "object") {
          targetItemIds.add(it.id);
        }
      });
      const byId = indexItemsById(items);
      targetItemIds.forEach(itemId => {
        const it = byId.get(itemId);
        if (!it) return;
        const stages = planned.get(itemId) || new Map();
        const cancelled = cancelledKeys.get(itemId) || null;
        const dl = Number(it.deadlineAt) || 0;
        const prev = it.deadlineEvents && typeof it.deadlineEvents === "object" ? it.deadlineEvents : {};
        const next = {};
        const keep = (key, value) => { next[key] = value; };
        stages.forEach((at, stageKey) => {
          if (!dl || String(stageKey).indexOf("@" + dl) < 0) return;
          const old = prev[stageKey];
          if (old && typeof old === "object" && old.state === "delivered") { keep(stageKey, old); return; }
          keep(stageKey, { at: at, state: "scheduled" });
        });
        Object.keys(prev).forEach(stageKey => {
          if (next[stageKey]) return;
          if (!dl || String(stageKey).indexOf("@" + dl) < 0) return;
          const old = prev[stageKey];
          if (!old || typeof old !== "object") return;
          if (old.state === "delivered" || old.state === "cancelled") { keep(stageKey, old); return; }
          const at = Number(old.at) || 0;
          if (at > now && cancelled && cancelled.has(stageKey)) {
            keep(stageKey, { at: at, state: "cancelled" });
            return;
          }
          keep(stageKey, old);
        });
        if (JSON.stringify(prev) !== JSON.stringify(next)) {
          if (Object.keys(next).length > 0) {
            it.deadlineEvents = next;
          } else {
            delete it.deadlineEvents;
          }
          changed = true;
        }
      });
      if (changed) deps.save(options);
      return changed;
    }

    function applyReminderEvents(events, now, cancelledEvents, options) {
      const planned = new Map();
      (events || []).forEach(ev => {
        if (!ev || !ev.itemId || !ev.key) return;
        if (!planned.has(ev.itemId)) planned.set(ev.itemId, new Map());
        planned.get(ev.itemId).set(ev.key, Number(ev.at));
      });
      const cancelledKeys = new Map();
      (cancelledEvents || []).forEach(ev => {
        if (!ev || !ev.itemId || !ev.key) return;
        if (!cancelledKeys.has(ev.itemId)) cancelledKeys.set(ev.itemId, new Set());
        cancelledKeys.get(ev.itemId).add(ev.key);
      });
      let changed = false;
      const targetItemIds = new Set(planned.keys());
      cancelledKeys.forEach((_value, itemId) => targetItemIds.add(itemId));
      const items = deps.getItems() || [];
      items.forEach(it => {
        if (it && it.reminderEvents && typeof it.reminderEvents === "object" &&
          Object.keys(it.reminderEvents).length > 0) targetItemIds.add(it.id);
      });
      const byId = indexItemsById(items);
      targetItemIds.forEach(itemId => {
        const it = byId.get(itemId);
        if (!it) return;
        const keys = planned.get(itemId) || new Map();
        const cancelled = cancelledKeys.get(itemId) || null;
        const base = Number(it.triggerAt) || 0;
        const prev = it.reminderEvents && typeof it.reminderEvents === "object" ? it.reminderEvents : {};
        const next = {};
        const keep = (key, value) => { next[key] = value; };
        keys.forEach((at, key) => {
          if (!base || !reminderKeyInTriggerRange(key, base)) return;
          const old = prev[key];
          if (old && typeof old === "object" &&
            (old.state === "delivered" || old.state === "suppressed")) {
            keep(key, old.roundBase == null
              ? Object.assign({}, old, { roundBase: base })
              : old);
            return;
          }
          // 体检 P0-2：判过丢失的键被补投后重新登记为 scheduled，但 `lostAt` 必须留着 ——
          // 它是「这一轮已经补过一次」的唯一记号，丢了就会被再判丢失、再补投，无限循环。
          const lostMark = old && typeof old === "object" && old.lostAt
            ? { lostAt: old.lostAt, lostReason: old.lostReason } : {};
          keep(key, Object.assign({ at: at, state: "scheduled", roundBase: base }, lostMark));
        });
        Object.keys(prev).forEach(key => {
          if (next[key]) return;
          if (!base || !reminderKeyInTriggerRange(key, base)) return;
          const old = prev[key];
          if (!old || typeof old !== "object") return;
          const roundField = (old.roundBase != null && Number.isFinite(Number(old.roundBase)))
            ? { roundBase: Number(old.roundBase) } : {};
          if (old.state === "delivered" || old.state === "cancelled" ||
            old.state === "suppressed") { keep(key, old); return; }
          const at = Number(old.at) || 0;
          if (at > now && cancelled && cancelled.has(key)) {
            keep(key, Object.assign({ at: at, state: "cancelled" }, roundField));
            return;
          }
          keep(key, old);
        });
        if (JSON.stringify(prev) !== JSON.stringify(next)) {
          if (Object.keys(next).length > 0) {
            it.reminderEvents = next;
          } else {
            delete it.reminderEvents;
          }
          changed = true;
        }
      });
      if (changed) deps.save(options);
      return changed;
    }

    function markDeadlineDelivered(event) {
      if (!event || !event.itemId || !event.stageKey) return false;
      const items = deps.getItems() || [];
      const it = items.find(x => x && x.id === event.itemId);
      if (!it) return false;
      if (!it.deadlineEvents || typeof it.deadlineEvents !== "object") it.deadlineEvents = {};
      const old = it.deadlineEvents[event.stageKey];
      if (old && old.state === "delivered") return false;
      it.deadlineEvents[event.stageKey] = {
        at: old && Number(old.at) ? Number(old.at) : Date.now(),
        state: "delivered"
      };
      deps.save();
      return true;
    }

    async function syncNativeRemindersNow(options) {
      const nr = getNativeReminders();
      if (options && options.forceRebuild) nativeForceRebuildPending = true;
      if (!nativeReady || !nr.reconcile) return nativeReminderStatus;
      if (nativeSyncInFlight) {
        nativeSyncPending = true;
        nativeSyncMetrics.deduped++;
        return nativeReminderStatus;
      }
      nativeSyncInFlight = true;
      try {
        while (true) {
          nativeSyncPending = false;
          const capturedVersion = nativeSyncVersion;
          const snapshotItems = JSON.parse(JSON.stringify(deps.getItems() || []));
          const snapshotSettings = JSON.parse(JSON.stringify(deps.getSettings() || {}));
          const review = {
            count: deps.needsReviewCount(),
            settings: deps.ensureReviewSettings()
          };
          nativeSyncMetrics.runs++;
          const runOptions = Object.assign({}, options, { forceRebuild: nativeForceRebuildPending });
          nativeForceRebuildPending = false;
          const status = await nr.reconcile(snapshotItems, snapshotSettings, Date.now(), review, runOptions);
          setNativeReminderStatus(status, "reconcile");

          const settings = deps.getSettings() || {};
          const idsChanged = status && Array.isArray(status.scheduledAlarmIds) &&
            !sameIdSet(settings.scheduledAlarmIds, status.scheduledAlarmIds);
          const sigsChanged = status && status.scheduledAlarmSignatures &&
            JSON.stringify(settings.scheduledAlarmSignatures || {}) !== JSON.stringify(status.scheduledAlarmSignatures || {});
          if (idsChanged) settings.scheduledAlarmIds = status.scheduledAlarmIds;
          if (sigsChanged) settings.scheduledAlarmSignatures = status.scheduledAlarmSignatures;

          if (capturedVersion === nativeSyncVersion) {
            const ledgerOptions = { deferNativeSync: true };
            if (status && Array.isArray(status.deadlineEvents)) {
              applyDeadlineEvents(status.deadlineEvents, Date.now(), status.cancelledDeadlineEvents, ledgerOptions);
            }
            if (status && Array.isArray(status.reminderEvents)) {
              applyReminderEvents(status.reminderEvents, Date.now(), status.cancelledReminderEvents, ledgerOptions);
            }
            if (idsChanged || sigsChanged) {
              deps.save(ledgerOptions);
            }
            if (!nativeSyncPending) {
              break;
            }
          }
        }
        return nativeReminderStatus;
      } catch (error) {
        const status = { reliability: "error", error: error && error.message ? error.message : String(error) };
        setNativeReminderStatus(status);
        return status;
      } finally {
        nativeSyncInFlight = false;
      }
    }

    function ensureNativeReminders() {
      if (nativeReady) return Promise.resolve(true);
      if (nativeInitPromise) return nativeInitPromise;
      nativeInitPromise = initializeNativeReminders()
        .then(() => !!nativeReady)
        .catch(error => {
          console.error("Native reminders init failed:",
            error && error.message ? error.message : error);
          return false;
        })
        .then(ok => {
          nativeInitPromise = null;
          return ok;
        });
      return nativeInitPromise;
    }

    /**
     * 回到前台后的原生状态补读。
     *
     * 用户从系统设置页（后台耗电、锁屏显示、精确提醒……）返回时，onResume 会立刻读一次；
     * 但部分厂商把改动写进系统是异步的 —— vivo 开关矩阵与撤销复测实测：
     *   1. 开启方向：切到「允许后台高耗电」后回到应用，第一次读到的 ignoringBatteryOptimizations
     *      仍可能是旧值（docs/reviews/vivo-switch-matrix-2026-09-26.md §4.2）；
     *   2. 撤销方向：改回「智能控制」后，撤销白名单往往超过 5 秒甚至数分钟才生效
     *      （docs/reviews/vivo-resume-recheck-2026-09-26.md 验收评审补充第 3 条）。
     * 因此无论当前是否「全部已验证」，回前台均安排在 1.5 s、5 s 各补读一次，状态真有变化才回写；
     * 再次回前台会取消上一轮尚未执行的补读。
     */
    const RESUME_RECHECK_DELAYS_MS = [1500, 5000];
    let resumeRecheckTimers = [];

    function applyPermissionStateIfChanged(next, origin) {
      if (!next) return false;
      const merged = Object.assign({}, nativeReminderStatus, next);
      if (JSON.stringify(merged) === JSON.stringify(nativeReminderStatus)) return false;
      setNativeReminderStatus(next, origin);
      deps.renderMe();
      return true;
    }

    let nativeStatusRefreshPromise = null;

    function refreshNativeStatus(origin) {
      if (!isNativeAndroidRuntime() || !nativeReady) return Promise.resolve(false);
      const nr = getNativeReminders();
      if (!nr || typeof nr.getPermissionState !== "function") return Promise.resolve(false);
      if (nativeStatusRefreshPromise) return nativeStatusRefreshPromise;
      nativeStatusRefreshPromise = (async () => {
        try {
          const next = await nr.getPermissionState();
          applyPermissionStateIfChanged(next, origin);
        } catch (error) {
        } finally {
          nativeStatusRefreshPromise = null;
        }
      })();
      return nativeStatusRefreshPromise;
    }

    function scheduleResumeStatusRechecks(nr) {
      resumeRecheckTimers.forEach(t => timerClear(t));
      resumeRecheckTimers = [];
      if (!nr || !nr.getPermissionState) return;
      RESUME_RECHECK_DELAYS_MS.forEach(ms => {
        resumeRecheckTimers.push(timerSet(async () => {
          try {
            const next = await nr.getPermissionState();
            applyPermissionStateIfChanged(next, "resume-recheck");
          } catch (error) {}
        }, ms));
      });
    }

    function queueNativeReminderSync(source) {
      source = source || "default";
      if (!deps.authoritativeWritesAllowed()) {
        nativeSyncMetrics.blockedByAuthority++;
        return;
      }
      nativeSyncMetrics.totalRequests++;
      nativeSyncMetrics.bySource[source] = (nativeSyncMetrics.bySource[source] || 0) + 1;
      const nr = getNativeReminders();
      if (!nr.reconcile) return;
      if (!nativeReady) {
        ensureNativeReminders().then(ok => { if (ok) queueNativeReminderSync(source); });
        return;
      }
      if (nativeSyncInFlight) {
        nativeSyncPending = true;
        nativeSyncMetrics.deduped++;
        return;
      }
      if (nativeSyncTimer) {
        timerClear(nativeSyncTimer);
        nativeSyncMetrics.deduped++;
      }
      nativeSyncTimer = timerSet(() => {
        nativeSyncTimer = null;
        syncNativeRemindersNow();
      }, 80);
    }

    /**
     * A-2：按台账实际过点轮数推进 remindCount。
     *
     * remindCount 的既有写入点只有前台 tick（markReminded）与 promoteDue 首投；
     * 原生后台追提醒只把证据写进 reminderEvents、不动 remindCount，于是后台已
     * 实际响过 N 轮的事项，首页「第 N/M 次」仍停在第 1 次 —— 用户看到的轮次比
     * 真实催促次数少。
     *
     * 在证据合并的**同一事务**里，按**当前轮**（entryRoundBase 与 triggerAt 对
     * 得上，判据与 mergeEvidence 逐字相同）里 delivered 的最大 attempt 推进：
     *   · 轮次随 attempt 顺序递进，attempt=0 即第 1 次，所以 N = maxAttempt + 1；
     *     中间轮判 lost / 补投不回退计数（B-2 台账语义里 lostAt 只防重复补投）。
     *   · lastRemindAt 同步取 delivered 的 receivedAt 最大值 —— shouldRealert 用
     *     它做间隔闸门，不同步的话原生刚追完轮次、前台 tick 会立刻再弹一次。
     *   · 只在 status === "due" 时推进：waiting 交给 promoteDue 首投计数，
     *     acknowledged/completed 的追提醒已终止，推进只制造无意义的写入。
     *   · 只升不降：与 promoteDue 的 max(1, …) 同向；snooze 换轮后旧轮 delivered
     *     被 entryRoundBase 挡在门外，remindCount 仍由 snooze 自己清零。
     *   · 不 bumpRev：remindCount/lastRemindAt 是计数面，不是身份面（promoteDue
     *     与 markReminded 都不 bump），避免一次回读触发全量原生重排。
     */
    function syncRemindCountFromLedger(it) {
      if (!it || it.status !== "due") return;
      const table = it.reminderEvents;
      if (!table || typeof table !== "object") return;
      const base = Number(it.triggerAt) || 0;
      if (!base) return;
      const evLib = getEvidenceLib();
      if (!evLib || typeof evLib.entryRoundBase !== "function") return;
      let maxAttempt = -1;
      let latestReceived = 0;
      Object.keys(table).forEach(key => {
        const entry = table[key];
        if (!entry || typeof entry !== "object" || entry.state !== "delivered") return;
        if (evLib.entryRoundBase(it, entry, key) !== base) return;
        const attempt = Number(String(key).split("@")[0]);
        if (Number.isFinite(attempt) && attempt > maxAttempt) maxAttempt = attempt;
        const received = Number(entry.receivedAt) > 0 ? Number(entry.receivedAt) : (Number(entry.at) || 0);
        if (Number.isFinite(received) && received > latestReceived) latestReceived = received;
      });
      if (maxAttempt < 0) return;
      const next = maxAttempt + 1;
      if (next > (Number(it.remindCount) || 0)) it.remindCount = next;
      if (latestReceived > (Number(it.lastRemindAt) || 0)) it.lastRemindAt = latestReceived;
    }

    function mergeEvidenceInto(it, evidences, at) {
      const evLib = getEvidenceLib();
      if (!it || !evLib) return false;
      const res = evLib.mergeEvidence([it], evidences, at);
      if (res.changed === true) syncRemindCountFromLedger(it);
      return res.changed === true;
    }

    function applyNativeDeliveryEvidence(rows) {
      const evLib = getEvidenceLib();
      if (!evLib || !Array.isArray(rows) || !rows.length) return false;
      const normalized = evLib.normalizeEvidence(rows, "native");
      const byItem = new Map();
      normalized.forEach(ev => {
        if (!ev || ev.valid !== true || !ev.itemId) return;
        if (!byItem.has(ev.itemId)) byItem.set(ev.itemId, []);
        byItem.get(ev.itemId).push(ev);
      });
      if (!byItem.size) return false;
      const at = Date.now();
      let changed = false;
      const items = deps.getItems() || [];
      const byId = indexItemsById(items);
      byItem.forEach((evidences, itemId) => {
        const it = byId.get(itemId);
        if (!it) return;
        if (deps.runUserOp(mergeEvidenceInto, [it, evidences, at], {
          userFacing: false,
          itemArg: 0,
          name: "mergeDeliveryEvidence"
        }) === true) changed = true;
      });
      if (!changed) return false;
      deps.save();
      return true;
    }

    function applyReminderDelivered(ev) {
      if (!ev) return false;
      return applyNativeDeliveryEvidence([{
        itemId: ev.itemId,
        reminderKey: ev.reminderKey,
        itemRev: ev.itemRev,
        carrier: ev.carrier || "notification",
        receivedAt: ev.receivedAt || Date.now()
      }]);
    }

    /**
     * B-3（JS 侧）：回读闹钟投递档案（lastAlarmDelivery）。
     *
     * SystemBridgePlugin.lastAlarmDelivery() 返回最近一次**闹钟载体**投递的档案
     * （receivedAt / posted / postedAt / notificationPosted …），是通知载体之外的
     * 另一份持久证据 —— 其中 notificationPosted（系统通知是否真投出去了）此前
     * 只进设置自检/诊断页，台账回读看不见。这里把它挂进 deliveryEvidenceState，
     * 与证据行同一次回读；桥或能力缺失 → null，绝不影响 readable 判据。
     */
    function readLastAlarmDeliveryIntoState() {
      let rec = null;
      try {
        const bridge = typeof deps.systemBridge === "function" ? deps.systemBridge() : null;
        if (bridge && typeof bridge.lastAlarmDelivery === "function") {
          rec = bridge.lastAlarmDelivery();
        }
      } catch (error) {
        rec = null;
      }
      deliveryEvidenceState.lastAlarmDelivery = rec || null;
    }

    async function readDeliveryEvidence(source) {
      if (deliveryEvidenceInFlight) return false;
      const nr = getNativeReminders();
      if (!nr.getDeliveryEvidence) {
        deliveryEvidenceState.readable = false;
        deliveryEvidenceState.reason = "module-unsupported";
        return false;
      }
      deliveryEvidenceInFlight = true;
      try {
        if (!nativeReady) {
          const ok = await ensureNativeReminders();
          if (!ok) {
            deliveryEvidenceState.readable = false;
            deliveryEvidenceState.reason = "bridge-not-ready";
            return false;
          }
        }
        const res = await nr.getDeliveryEvidence({ since: 0 });
        deliveryEvidenceState.readable = !!(res && res.available);
        deliveryEvidenceState.reason = (res && res.reason) || "";
        deliveryEvidenceState.retention = (res && res.retention) || null;
        deliveryEvidenceState.lastReadAt = Date.now();
        // B-3（JS 侧）：通知载体（追提醒轮次）在原生端没有持久接收证据，完整修复
        // 要在 Java 写证据行，本轮不动 Java —— 先把**已有**的闹钟投递档案
        // （lastAlarmDelivery，含 notificationPosted「系统通知是否投递」）并入
        // 台账回读状态，getDeliveryEvidenceState() 的消费方（诊断页/测试 API）
        // 从此能在 JS 侧看到这份证据；读失败只置 null，不影响证据主回读判据。
        readLastAlarmDeliveryIntoState();
        if (!res || !res.available) return false;
        deliveryEvidenceState.rows = Array.isArray(res.rows) ? res.rows.length : 0;
        return applyNativeDeliveryEvidence(res.rows);
      } catch (error) {
        deliveryEvidenceState.readable = false;
        deliveryEvidenceState.reason = error && error.message ? error.message : String(error);
        return false;
      } finally {
        deliveryEvidenceInFlight = false;
      }
    }

    /**
     * 体检 P0-2 / P1-3：把「系统其实没投递」的提醒从待定降级为 lost，触发一次补投并告知用户。
     * 必须排在送达证据回读之后：先把真送达的升成 delivered，剩下的才有资格判丢失。
     */
    async function reconcileLostReminders(source) {
      const nr = getNativeReminders();
      if (typeof nr.markLostReminders !== "function") return [];
      let missed = [];
      try {
        if (typeof nr.getMissedAlarms === "function") {
          const res = await nr.getMissedAlarms();
          if (res && res.available) missed = res.rows || [];
        }
      } catch (error) {}
      const retention = deliveryEvidenceState.retention || null;
      const lost = nr.markLostReminders(deps.getItems() || [], {
        missed: missed,
        evidenceReadable: deliveryEvidenceState.readable === true,
        evidenceMaxAgeMs: retention && retention.maxAgeMs ? retention.maxAgeMs : null,
        // B-2：跨重启丢了会话内排程精确性缓存时，用「当前精确闹钟权限」回退——
        // 权限未授予时本轮排程必然是非精确路径，markLostReminders 据此放宽判丢宽限。
        exactAlarmGranted: getNativeReminderStatus().exactAlarm === "granted"
      }, Date.now());
      if (!lost.length) return lost;
      deps.save({ deferNativeSync: true });
      if (typeof deps.onRemindersLost === "function") {
        try { deps.onRemindersLost(lost, source); } catch (error) {}
      }
      queueNativeReminderSync("lost-reminders");
      return lost;
    }

    async function initializeNativeReminders() {
      if (!isNativeAndroidRuntime()) return;
      const nr = getNativeReminders();
      if (!nr.isNativeAndroid || !nr.isNativeAndroid()) {
        const bridged = await waitForNativeBridge(10000);
        if (!bridged) {
          setNativeReminderStatus({
            native: false,
            notifications: "unavailable",
            exactAlarm: "unavailable",
            reliability: "error",
            bridgeNotReady: true
          });
          return;
        }
      }
      try {
        const status = await nr.initialize({
          onAction: deps.onNotificationAction,
          onDelivered: markDeadlineDelivered,
          onReminderDelivered: applyReminderDelivered,
          onStatusChange: setNativeReminderStatus,
          onResume: async () => {
            try {
              if (nr.getPermissionState) {
                const pStatus = await nr.getPermissionState();
                applyPermissionStateIfChanged(pStatus, "resume");
                scheduleResumeStatusRechecks(nr);
              }
            } catch (error) {}
            try {
              if (nr.drainAlarmActions) {
                await nr.drainAlarmActions(deps.handleAlarmAction);
              }
            } catch (error) {}
            try { await readDeliveryEvidence("resume"); } catch (error) {}
            try { await reconcileLostReminders("resume"); } catch (error) {}
            refreshNativeScheduleBasis();
            await deps.refreshActiveAlarmPanel(true);
            deps.promoteDue();
            queueNativeReminderSync();
          }
        });
        nativeReady = true;
        setNativeReminderStatus(status);
        await deps.refreshActiveAlarmPanel(true);
        refreshNativeScheduleBasis();
        await syncNativeRemindersNow({ forceRebuild: true });
        try { await readDeliveryEvidence("init"); } catch (error) {}
        try { await reconcileLostReminders("init"); } catch (error) {}
      } catch (error) {
        nativeReady = true;
        setNativeReminderStatus({
          native: true,
          reliability: "error",
          error: error && error.message ? error.message : String(error)
        });
      }
    }

    return {
      refreshNativeScheduleBasis: refreshNativeScheduleBasis,
      applyDeadlineEvents: applyDeadlineEvents,
      applyReminderEvents: applyReminderEvents,
      markDeadlineDelivered: markDeadlineDelivered,
      applyReminderDelivered: applyReminderDelivered,
      syncNativeRemindersNow: syncNativeRemindersNow,
      ensureNativeReminders: ensureNativeReminders,
      queueNativeReminderSync: queueNativeReminderSync,
      readDeliveryEvidence: readDeliveryEvidence,
      reconcileLostReminders: reconcileLostReminders,
      applyNativeDeliveryEvidence: applyNativeDeliveryEvidence,
      initializeNativeReminders: initializeNativeReminders,
      getNativeReminderStatus: getNativeReminderStatus,
      setNativeReminderStatus: setNativeReminderStatus,
      isNativeReady: isNativeReady,
      getNativeSyncMetrics: getNativeSyncMetrics,
      getNativeSyncVersion: getNativeSyncVersion,
      bumpNativeSyncVersion: bumpNativeSyncVersion,
      deliveryEvidenceReadable: deliveryEvidenceReadable,
      getDeliveryEvidenceState: getDeliveryEvidenceState,
      isNativeAndroidRuntime: isNativeAndroidRuntime,
      waitForNativeBridge: waitForNativeBridge,
      refreshNativeStatus: refreshNativeStatus
    };
  }

  return {
    createAppNativeCoordinator: createAppNativeCoordinator
  };
});
