/* P3-C transaction layer. UMD factory; evaluation performs no IO or state mutation. */
(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.AppTransaction = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";

  function createAppTransaction(input) {
    const deps = input || {};
    const REQUIRED_DEPS = [
      "getItems", "setItems", "getNotes", "setNotes", "getProjects", "setProjects",
      "getSettings", "setSettings", "currentPayload", "runCommit", "writeSnapshot",
      "isTerminal", "hasKnownRev", "ackItem", "snoozeItem", "completeItem",
      "queueNativeReminderSync", "render", "toast", "openDetail", "hideAlert", "fmtTime"
    ];
    REQUIRED_DEPS.forEach(function(name) {
      if (typeof deps[name] !== "function") {
        throw new Error("createAppTransaction(deps) 缺少依赖：" + name);
      }
    });

    const ALARM_ACTION_DEDUP_MS = 5000;
    const ALARM_EVENT_LOG_LIMIT = 50;

    let suppressInnerSave = false;
    let inflightActionDepth = 0;
    let pendingUserOps = [];
    let suppressUserFeedback = false;
    let replayCreatedIds = null;
    let activeActionScope = null;
    let applyingActionDraft = false;

    const inflightAlarmActions = new Map();
    const recentAlarmActions = Object.create(null);
    let alarmEventClock = 0;

    function shouldSuppressInnerSave() {
      return suppressInnerSave;
    }

    function isFeedbackSuppressed() {
      return suppressUserFeedback;
    }

    function inflightDepth() {
      return inflightActionDepth;
    }

    function alarmEventSeen(id) {
      if (!id) return false;
      const settings = deps.getSettings();
      const log = settings && settings.alarmEventLog;
      return !!(log && typeof log === "object" && log[id]);
    }

    function rememberAlarmEvent(id) {
      if (!id) return;
      let settings = deps.getSettings();
      if (!settings || typeof settings !== "object") {
        settings = {};
        deps.setSettings(settings);
      }
      if (!settings.alarmEventLog || typeof settings.alarmEventLog !== "object") {
        settings.alarmEventLog = {};
      }
      const log = settings.alarmEventLog;
      const stamp = Math.max(Date.now(), alarmEventClock + 1);
      alarmEventClock = stamp;
      log[id] = stamp;
      const keys = Object.keys(log);
      if (keys.length > ALARM_EVENT_LOG_LIMIT) {
        keys.sort((a, b) => log[a] - log[b]);
        keys.slice(0, keys.length - ALARM_EVENT_LOG_LIMIT).forEach(k => { delete log[k]; });
      }
    }

    function clonePayload(payload) {
      return JSON.parse(JSON.stringify(payload || deps.currentPayload()));
    }

    function withDraftState(draft, job) {
      const live = {
        items: deps.getItems(),
        notes: deps.getNotes(),
        projects: deps.getProjects(),
        settings: deps.getSettings()
      };
      deps.setItems(draft.items);
      deps.setNotes(draft.notes);
      deps.setProjects(draft.projects);
      deps.setSettings(draft.settings);
      try {
        return job();
      } finally {
        draft.items = deps.getItems();
        draft.notes = deps.getNotes();
        draft.projects = deps.getProjects();
        draft.settings = deps.getSettings();
        deps.setItems(live.items);
        deps.setNotes(live.notes);
        deps.setProjects(live.projects);
        deps.setSettings(live.settings);
      }
    }

    function publishActionDraft(draft) {
      const liveItems = deps.getItems() || [];
      const liveById = new Map(liveItems.map(item => [item.id, item]));
      const nextItems = draft.items.map(committed => {
        const live = liveById.get(committed.id);
        if (!live) return committed;
        Object.keys(live).forEach(key => {
          if (!(key in committed)) delete live[key];
        });
        Object.keys(committed).forEach(key => { live[key] = committed[key]; });
        return live;
      });
      deps.setItems(nextItems);
      const liveSettings = deps.getSettings();
      if (liveSettings && typeof liveSettings === "object") {
        liveSettings.alarmEventLog = JSON.parse(JSON.stringify((draft.settings && draft.settings.alarmEventLog) || {}));
      }
    }

    function itemConflictsWithActiveAction(item) {
      if (!item || !activeActionScope) return false;
      if (item.id === activeActionScope.itemId) return true;
      if (activeActionScope.seriesId && item.seriesId === activeActionScope.seriesId) return true;
      return item.repeatParentId === activeActionScope.itemId;
    }

    function isItemActionPending(id) {
      const items = deps.getItems() || [];
      const item = items.find(x => x && x.id === id);
      return itemConflictsWithActiveAction(item);
    }

    function rejectPendingItemCommand() {
      deps.toast("这条事项正在保存 · 请稍后重试");
      return false;
    }

    function commandConflicts(args, options) {
      if (!activeActionScope || !options || !options.userFacing) return false;
      if (options.globalConflict) return true;
      let id;
      if (typeof options.scopeId === "function") {
        try { id = options.scopeId.apply(null, args); } catch (error) { id = null; }
      } else {
        const index = options.itemArg == null ? 0 : options.itemArg;
        const arg = args[index];
        id = arg && typeof arg === "object" ? (arg.id || arg.__itemRef) : arg;
      }
      const items = deps.getItems() || [];
      const item = items.find(x => x && x.id === id);
      return itemConflictsWithActiveAction(item);
    }

    function recordArg(a) {
      if (!a || typeof a !== "object") return a;
      const items = deps.getItems() || [];
      if (items.indexOf(a) >= 0) return { __itemRef: a.id };
      try {
        return JSON.parse(JSON.stringify(a));
      } catch (error) {
        return a;
      }
    }

    function resolveArg(a) {
      if (a && typeof a === "object" && a.__itemRef) {
        const items = deps.getItems() || [];
        return items.find(x => x && x.id === a.__itemRef) || null;
      }
      return a;
    }

    function runUserOp(fn, args, options) {
      if (!applyingActionDraft && commandConflicts(args, options)) return rejectPendingItemCommand();
      if (inflightActionDepth <= 0) return fn.apply(null, args);
      const itemsBefore = deps.getItems() || [];
      const beforeIds = new Set(itemsBefore.map(x => x && x.id));
      const recorded = (args || []).map(recordArg);
      const result = fn.apply(null, args);
      if (result === false) return false;
      const itemsAfter = deps.getItems() || [];
      const createdItems = itemsAfter.filter(x => x && !beforeIds.has(x.id));
      const created = createdItems.map(x => x.id);
      const createdRecords = createdItems.map(x => ({
        id: x.id,
        repeatParentId: x.repeatParentId || null
      }));
      pendingUserOps.push({
        fn: fn,
        name: (options && options.name) || fn.name || "command",
        args: recorded,
        created: created,
        createdRecords: createdRecords
      });
      return result;
    }

    function wrapUserOp(fn, options) {
      return function () {
        return runUserOp(fn, Array.prototype.slice.call(arguments), options);
      };
    }

    function takeReplayCreatedId() {
      if (!replayCreatedIds || !replayCreatedIds.length) return null;
      return replayCreatedIds.shift();
    }

    function replayUserOps(ops) {
      if (!ops || !ops.length) return 0;
      const prevSave = suppressInnerSave;
      const prevFeedback = suppressUserFeedback;
      suppressInnerSave = true;
      suppressUserFeedback = true;
      try {
        ops.forEach(op => {
          const specs = op.args || [];
          const args = [];
          for (let i = 0; i < specs.length; i++) {
            const value = resolveArg(specs[i]);
            if (value === null && specs[i] && specs[i].__itemRef) {
              throw new Error("transaction-replay-missing-item:" + specs[i].__itemRef);
            }
            args.push(value);
          }
          replayCreatedIds = (op.created || []).slice();
          const items = deps.getItems() || [];
          (op.createdRecords || []).forEach(record => {
            if (!record || !record.repeatParentId) return;
            const existing = items.find(x => x && x.repeatParentId === record.repeatParentId);
            if (!existing || existing.id === record.id || items.some(x => x && x.id === record.id)) return;
            existing.id = record.id;
            const index = replayCreatedIds.indexOf(record.id);
            if (index >= 0) replayCreatedIds.splice(index, 1);
          });
          const applied = op.fn.apply(null, args);
          if (applied === false) {
            throw new Error("transaction-replay-business-rejected:" + (op.name || op.fn.name || "command"));
          }
          if (replayCreatedIds.length) {
            throw new Error("transaction-replay-unused-created-id:" + replayCreatedIds[0]);
          }
          replayCreatedIds = null;
        });
      } finally {
        replayCreatedIds = null;
        suppressUserFeedback = prevFeedback;
        suppressInnerSave = prevSave;
      }
      return ops.length;
    }

    function handleAlarmAction(data) {
      const action = data && (data.action || data.actionId);
      const itemId = data && (data.itemId || data.item_id);
      if (!action) return Promise.resolve();
      if (action === "close") {
        deps.hideAlert();
        return Promise.resolve();
      }
      if (!itemId) return Promise.resolve();
      const eventId = data && data.alarmEventId ? String(data.alarmEventId) : "";
      if (eventId) {
        const inflight = inflightAlarmActions.get(eventId);
        if (inflight) return inflight;
        if (alarmEventSeen(eventId)) return Promise.resolve();
      }
      const running = performAlarmAction(data, action, itemId, eventId);
      if (eventId) {
        inflightAlarmActions.set(eventId, running);
        const release = () => {
          if (inflightAlarmActions.get(eventId) === running) inflightAlarmActions.delete(eventId);
        };
        running.then(release, release);
      }
      return running;
    }

    async function performAlarmAction(data, action, itemId, eventId) {
      return deps.runCommit(() => applyAlarmAction(data, action, itemId, eventId));
    }

    async function applyAlarmAction(data, action, itemId, eventId) {
      const items = deps.getItems() || [];
      const it = items.find(x => x && x.id === itemId);
      if (!it) return;
      const terminal = deps.isTerminal(it);
      if (!terminal && (!deps.hasKnownRev(data.itemRev) || Number(it.rev || 0) !== Number(data.itemRev))) {
        deps.toast(data.itemRev == null || data.itemRev === ""
          ? "无法确认这条提醒是否为最新 · 请在应用内处理"
          : "这条提醒已过期 · 未作改动");
        deps.openDetail(itemId);
        return;
      }
      const now = Date.now();
      Object.keys(recentAlarmActions).forEach(k => {
        if (now - recentAlarmActions[k] > ALARM_ACTION_DEDUP_MS) delete recentAlarmActions[k];
      });
      const key = itemId + "|" + action;
      if (recentAlarmActions[key] && now - recentAlarmActions[key] < ALARM_ACTION_DEDUP_MS) {
        return;
      }

      const previousScope = activeActionScope;
      activeActionScope = { itemId: it.id, seriesId: it.seriesId || null };
      try {
        const draft = clonePayload(deps.currentPayload());
        const prevSave = suppressInnerSave;
        const prevFeedback = suppressUserFeedback;
        const prevApplyingDraft = applyingActionDraft;
        suppressInnerSave = true;
        suppressUserFeedback = true;
        applyingActionDraft = true;
        try {
          withDraftState(draft, () => {
            if (eventId) rememberAlarmEvent(eventId);
            if (terminal) return;
            if (action === "ack") deps.ackItem(itemId, true);
            else if (action === "snooze") deps.snoozeItem(itemId, Date.now() + 2 * 3600000);
            else if (action === "done") deps.completeItem(itemId);
          });
        } finally {
          applyingActionDraft = prevApplyingDraft;
          suppressUserFeedback = prevFeedback;
          suppressInnerSave = prevSave;
          deps.render();
        }

        let userOps = [];
        pendingUserOps = [];
        inflightActionDepth++;
        try {
          await deps.writeSnapshot(draft, { deferNativeSync: true });
        } catch (error) {
          delete recentAlarmActions[key];
          throw error;
        } finally {
          inflightActionDepth--;
          userOps = pendingUserOps;
          pendingUserOps = [];
        }

        try {
          withDraftState(draft, () => replayUserOps(userOps));
        } catch (replayError) {
          try {
            await deps.writeSnapshot(deps.currentPayload(), { deferNativeSync: true });
          } catch (compensationError) {
            replayError.compensationError = compensationError;
          }
          delete recentAlarmActions[key];
          throw replayError;
        }

        publishActionDraft(draft);
        recentAlarmActions[key] = now;
        deps.queueNativeReminderSync();
        deps.render();
        if (terminal) deps.toast("该事项已完成 · 本次提醒已忽略");
        else if (action === "ack") deps.toast("已确认看到 · 仍保持未完成");
        else if (action === "snooze") {
          const committed = (deps.getItems() || []).find(x => x && x.id === itemId);
          deps.toast(committed ? "已改到 " + deps.fmtTime(committed.triggerAt) : "提醒操作已保存 · 后续删除也已保留");
        }
        else if (action === "done") deps.toast(it.repeat ? "已完成 · 下一周期已生成" : "已完成并归档");
        return true;
      } finally {
        activeActionScope = previousScope;
      }
    }

    return {
      runUserOp: runUserOp,
      wrapUserOp: wrapUserOp,
      itemConflictsWithActiveAction: itemConflictsWithActiveAction,
      isItemActionPending: isItemActionPending,
      rejectPendingItemCommand: rejectPendingItemCommand,
      takeReplayCreatedId: takeReplayCreatedId,
      handleAlarmAction: handleAlarmAction,
      alarmEventSeen: alarmEventSeen,
      inflightDepth: inflightDepth,
      isFeedbackSuppressed: isFeedbackSuppressed,
      shouldSuppressInnerSave: shouldSuppressInnerSave
    };
  }

  return {
    createAppTransaction: createAppTransaction
  };
});
