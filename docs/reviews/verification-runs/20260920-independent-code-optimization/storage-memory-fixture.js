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
   *
   * **权威 / 镜像契约**（app-core 的 saveAsync 按此判定「这笔提交算不算成功」）：
   *  · backend = `idb`：IndexedDB 是**权威**，localStorage 只是**镜像**。
   *    镜像写失败（配额等）不得让已经提交的写事务失败 —— 读回时以 IDB 为准。
   *    只有 IDB 里还是空值（首次运行）才回落到 localStorage 的旧数据并迁移进 IDB，
   *    所以镜像的意义是「IDB 尚未建立时的兜底来源」，不是等价的第二权威。
   *  · backend = `local`：没有 IndexedDB，localStorage 就是权威，写失败必须上抛。
   *  · backend = `memory`：测试 / 极端降级用，写只落在进程内。
   *
   * 与之配套：`save(obj)` 收到的对象必须是**调用方自己的独立快照**。
   * IDB 的 `put` 发生在 microtask 之后，传活对象会把期间的内存改动混进这次提交。
   */
  function createStorage(opts) {
    opts = opts || {};
    const lsKey = opts.lsKey || LS_KEY;
    let db = null;
    let backend = "memory";
    let forceMemory = true; // independent fixture
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
