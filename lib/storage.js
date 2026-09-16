/* IndexedDB + localStorage fallback — UMD */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else {
    root.AttentionLib = root.AttentionLib || {};
    Object.assign(root.AttentionLib, factory());
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DB_NAME = "attention-inbox";
  const STORE = "kv";
  const STATE_KEY = "state";
  const LS_KEY = "attention-inbox-v2";

  function hasIdb() {
    return typeof indexedDB !== "undefined" && indexedDB != null;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!hasIdb()) {
        reject(new Error("no-indexeddb"));
        return;
      }
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("idb-open-failed"));
    });
  }

  function idbGet(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbSet(db, key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  function lsGet(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function lsSet(key, obj) {
    localStorage.setItem(key, JSON.stringify(obj));
    return true;
  }

  /**
   * Create a storage adapter.
   * load() / save(obj) are async. backend: "idb" | "local" | "memory"
   */
  function createStorage(opts) {
    opts = opts || {};
    const lsKey = opts.lsKey || LS_KEY;
    let db = null;
    let backend = "memory";
    let forceMemory = !!opts.forceMemory;
    const mem = { value: null };

    function hasLocalStorage() {
      try {
        return typeof localStorage !== "undefined" && localStorage != null;
      } catch (e) {
        return false;
      }
    }

    async function ensure() {
      if (forceMemory) { backend = "memory"; return; }
      if (backend === "idb" || backend === "local") return;
      if (hasIdb()) {
        try {
          db = await openDb();
          backend = "idb";
          return;
        } catch (e) { /* fall through */ }
      }
      if (hasLocalStorage()) {
        backend = "local";
        return;
      }
      backend = "memory";
    }

    return {
      get backend() { return backend; },

      async load() {
        await ensure();
        if (backend === "idb") {
          let val = await idbGet(db, STATE_KEY);
          if (val == null && hasLocalStorage()) {
            const legacy = lsGet(lsKey);
            if (legacy != null) {
              await idbSet(db, STATE_KEY, legacy);
              val = legacy;
            }
          }
          return val;
        }
        if (backend === "local") return lsGet(lsKey);
        return mem.value;
      },

      async save(obj) {
        await ensure();
        if (backend === "idb") {
          await idbSet(db, STATE_KEY, obj);
          if (hasLocalStorage()) {
            try { lsSet(lsKey, obj); } catch (e) { /* quota */ }
          }
          return true;
        }
        if (backend === "local") {
          lsSet(lsKey, obj);
          return true;
        }
        mem.value = obj;
        return true;
      },

      /** test helper */
      _useMemory() { forceMemory = true; backend = "memory"; db = null; }
    };
  }

  return {
    createStorage,
    DB_NAME,
    STORE,
    STATE_KEY,
    LS_KEY,
    hasIdb
  };
});
