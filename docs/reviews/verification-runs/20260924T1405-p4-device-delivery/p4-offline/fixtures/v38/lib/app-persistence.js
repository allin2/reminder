/* P3-B persistence layer. UMD factory; evaluation performs no IO or state mutation. */
(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else { root.AttentionLib = root.AttentionLib || {}; root.AttentionLib.AppPersistence = factory(root); }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";

  function createAppPersistence(input) {
    const deps = input || {};
    ["getSchema", "getItems", "getNotes", "getProjects", "getSettings", "applyRecoveredState",
      "getStorage", "hasIdb", "readLocal", "writeLocal", "removeLocal", "now", "onCommitted", "onSaveFailure"]
      .forEach(function(name) {
        if (typeof deps[name] !== "function") throw new Error("createAppPersistence(deps) 缺少依赖：" + name);
      });
    const key = typeof deps.key === "string" && deps.key ? deps.key : "attention-inbox-v2";
    const pendingKey = key + "-pending-replay";
    const LOAD_LOADED = "loaded";
    const LOAD_EMPTY = "empty";
    const LOAD_FAILED = "failed";
    const LOAD_UNCONFIRMED = "unconfirmed";
    let storageReady = false;
    let stateAuthority = LOAD_UNCONFIRMED;
    let lastLoadReport = null;
    let loadAttempts = 0;
    let blockedWriteCount = 0;
    let lastReplayFailure = null;
    let commitChain = Promise.resolve();
    let committedAlarmItems = [];

    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function currentPayload() {
      return { schema: deps.getSchema(), items: deps.getItems(), notes: deps.getNotes(),
        projects: deps.getProjects(), settings: deps.getSettings() };
    }
    function establishCommittedBaseline(items, alreadyDetached) {
      committedAlarmItems = alreadyDetached ? (Array.isArray(items) ? items : []) : clone(Array.isArray(items) ? items : []);
    }
    function committedItemById(id) {
      const item = committedAlarmItems.find(function(it) { return it && it.id === id; });
      return item ? clone(item) : null;
    }
    function authoritativeWritesAllowed() {
      return stateAuthority === LOAD_LOADED || stateAuthority === LOAD_EMPTY;
    }
    function getStorage() { return deps.getStorage(); }
    function idbIsAvailable() { try { return !!deps.hasIdb(); } catch (_) { return false; } }
    function authoritativeBackendMissing(storage) {
      try { return idbIsAvailable() && (!storage || storage.backend !== "idb"); } catch (_) { return false; }
    }
    function mirrorBytes() {
      try { const raw = deps.readLocal(key); return raw == null ? null : String(raw).length; } catch (_) { return null; }
    }
    function stateCameFromMirror() {
      const reason = lastLoadReport && lastLoadReport.reason ? String(lastLoadReport.reason) : "";
      return reason === "mirror-recovered" || reason === "mirror-recovered-unconfirmed-authority" ||
        reason === "degraded-mirror" || reason === "degraded-mirror-unconfirmed-authority";
    }
    function markPendingReplay(json) {
      if (!authoritativeWritesAllowed() || stateCameFromMirror()) return false;
      try { deps.writeLocal(pendingKey, JSON.stringify({ at: deps.now(), json: json })); return true; }
      catch (error) { return false; }
    }
    function readPendingReplay() {
      try {
        const raw = deps.readLocal(pendingKey);
        if (!raw) return null;
        const pending = JSON.parse(raw);
        return pending && typeof pending.json === "string" ? pending : null;
      } catch (_) { return null; }
    }
    function clearPendingReplay() { try { deps.removeLocal(pendingKey); } catch (_) {} }
    function publishLoadReport(status, reason, attempt, at, detail, storage) {
      stateAuthority = status;
      lastLoadReport = { status: status, reason: reason,
        detail: detail ? String((detail && detail.message) || detail) : null,
        attempt: attempt, at: at, backend: storage ? storage.backend : null,
        mirrorBytes: mirrorBytes(), writesAllowed: status === LOAD_LOADED || status === LOAD_EMPTY };
      return lastLoadReport;
    }
    async function writeSnapshot(payload, options) {
      if (!authoritativeWritesAllowed()) {
        blockedWriteCount += 1;
        const blocked = new Error("state-authority-" + stateAuthority);
        blocked.code = "state-authority-blocked";
        throw blocked;
      }
      const json = JSON.stringify(payload || currentPayload());
      const snapshot = JSON.parse(json);
      const storage = getStorage();
      if (storage && storageReady) {
        await storage.save(snapshot);
        if (authoritativeBackendMissing(storage)) markPendingReplay(json);
      } else {
        deps.writeLocal(key, json);
        if (idbIsAvailable()) markPendingReplay(json);
      }
      // `snapshot` is the one JSON round-trip and is already detached from live state.
      establishCommittedBaseline(snapshot.items, true);
      deps.onCommitted(options || {});
      return true;
    }
    function runCommit(job, args) {
      const invoke = function() { return job.apply(null, args || []); };
      const next = commitChain.then(invoke, invoke);
      commitChain = next.then(function() {}, function() {});
      return next;
    }
    function saveAsync(options) { return runCommit(writeSnapshot, [undefined, options]); }
    function save(options) {
      const pending = saveAsync(options);
      pending.catch(function(error) { deps.onSaveFailure(error); });
      return pending;
    }
    async function replayPendingSnapshot() {
      lastReplayFailure = null;
      const pending = readPendingReplay();
      if (!pending) return false;
      let payload;
      try { payload = JSON.parse(pending.json); }
      catch (_) { clearPendingReplay(); return false; }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) { clearPendingReplay(); return false; }
      let items;
      try { items = deps.applyRecoveredState(payload); establishCommittedBaseline(items); }
      catch (error) { lastReplayFailure = error; return false; }
      try { await getStorage().save(payload); clearPendingReplay(); }
      catch (_) { /* writeback failed: retain credential for the next healthy launch */ }
      return true;
    }
    function recoverFromMirror() {
      let raw;
      try { raw = deps.readLocal(key); } catch (error) { return { status: LOAD_FAILED, reason: "mirror-unreadable", error: error }; }
      if (raw == null) return { status: LOAD_EMPTY, reason: "mirror-absent" };
      let parsed;
      try { parsed = JSON.parse(raw); } catch (error) { return { status: LOAD_FAILED, reason: "mirror-unparsable", error: error }; }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: LOAD_FAILED, reason: "mirror-not-object" };
      try { establishCommittedBaseline(deps.applyRecoveredState(parsed)); }
      catch (error) { return { status: LOAD_FAILED, reason: "mirror-apply-failed", error: error }; }
      return { status: LOAD_LOADED, reason: "mirror-recovered" };
    }
    async function loadAsync() {
      loadAttempts += 1;
      const attempt = loadAttempts;
      const at = deps.now();
      const storage = getStorage();
      let authoritativeError = null;
      if (storage) {
        try {
          const parsed = await storage.load();
          storageReady = true;
          if (storage.backend === "idb" && await replayPendingSnapshot()) return publishLoadReport(LOAD_LOADED, "pending-replay", attempt, at, null, storage);
          if (lastReplayFailure) return publishLoadReport(LOAD_FAILED, "pending-replay-failed", attempt, at, lastReplayFailure, storage);
          if (parsed == null) {
            if (authoritativeBackendMissing(storage)) return publishLoadReport(LOAD_FAILED, "authoritative-backend-degraded", attempt, at, null, storage);
            if (mirrorBytes() != null || readPendingReplay() != null) return publishLoadReport(LOAD_FAILED, "authoritative-empty-with-residual-evidence", attempt, at, null, storage);
            return publishLoadReport(LOAD_EMPTY, "authoritative-empty", attempt, at, null, storage);
          }
          if (typeof parsed !== "object" || Array.isArray(parsed)) return publishLoadReport(LOAD_FAILED, "authoritative-value-not-object", attempt, at, null, storage);
          establishCommittedBaseline(deps.applyRecoveredState(parsed));
          if (authoritativeBackendMissing(storage)) return publishLoadReport(LOAD_FAILED, "degraded-mirror-unconfirmed-authority", attempt, at, null, storage);
          return publishLoadReport(LOAD_LOADED, "authoritative", attempt, at, null, storage);
        } catch (error) { storageReady = false; authoritativeError = error; }
      }
      const mirror = recoverFromMirror();
      if (mirror.status === LOAD_LOADED) {
        if (idbIsAvailable()) return publishLoadReport(LOAD_FAILED, "mirror-recovered-unconfirmed-authority", attempt, at, authoritativeError, storage);
        return publishLoadReport(LOAD_LOADED, "mirror-recovered", attempt, at, authoritativeError, storage);
      }
      return publishLoadReport(LOAD_FAILED, "authoritative-read-failed:" + mirror.reason, attempt, at, authoritativeError || mirror.error, storage);
    }
    function loadSync() {
      try {
        const raw = deps.readLocal(key);
        if (!raw) return false;
        establishCommittedBaseline(deps.applyRecoveredState(JSON.parse(raw)));
        return true;
      } catch (_) { return false; }
    }
    function load() { return loadSync(); }
    function authoritySnapshot() {
      return { status: stateAuthority, report: lastLoadReport ? Object.assign({}, lastLoadReport) : null,
        attempts: loadAttempts, blockedWriteCount: blockedWriteCount, writesAllowed: authoritativeWritesAllowed(), mirrorBytes: mirrorBytes() };
    }
    function reopen() { const storage = getStorage(); return !!(storage && typeof storage.reopen === "function" && storage.reopen()); }
    return { currentPayload: currentPayload, writeSnapshot: writeSnapshot, runCommit: runCommit, saveAsync: saveAsync,
      save: save, loadAsync: loadAsync, loadSync: loadSync, load: load, replayPendingSnapshot: replayPendingSnapshot,
      authoritativeWritesAllowed: authoritativeWritesAllowed, authoritySnapshot: authoritySnapshot, reopen: reopen,
      committedItemById: committedItemById, establishCommittedBaseline: establishCommittedBaseline, getStorage: getStorage };
  }
  return { createAppPersistence: createAppPersistence };
});
