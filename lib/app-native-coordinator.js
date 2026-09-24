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
      retention: null
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
      nativeReminderStatus = Object.assign({}, nativeReminderStatus, status || {});
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
          keep(key, { at: at, state: "scheduled", roundBase: base });
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
          const status = await nr.reconcile(snapshotItems, snapshotSettings, Date.now(), review, options);
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

    function mergeEvidenceInto(it, evidences, at) {
      const evLib = getEvidenceLib();
      if (!it || !evLib) return false;
      const res = evLib.mergeEvidence([it], evidences, at);
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
                setNativeReminderStatus(pStatus);
                deps.renderMe();
              }
            } catch (error) {}
            try {
              if (nr.drainAlarmActions) {
                await nr.drainAlarmActions(deps.handleAlarmAction);
              }
            } catch (error) {}
            try { await readDeliveryEvidence("resume"); } catch (error) {}
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
      waitForNativeBridge: waitForNativeBridge
    };
  }

  return {
    createAppNativeCoordinator: createAppNativeCoordinator
  };
});
