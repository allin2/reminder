/* P3-H / P3-H-R direct platform module behavior and source mutation checks.
 * Uses the loaded source in temporary VM context, never rewriting the product file.
 */
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const targetPath = path.join(ROOT, "lib/app-platform.js");
const source = fs.readFileSync(targetPath, "utf8");
const hashBefore = crypto.createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");

function createMockEnvironment() {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const btnListeners = new Map();
  const swListeners = new Map();

  const mockBtn = {
    hidden: true,
    addEventListener(type, handler) {
      if (!btnListeners.has(type)) btnListeners.set(type, []);
      btnListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      if (!btnListeners.has(type)) return;
      const list = btnListeners.get(type).filter(h => h !== handler);
      btnListeners.set(type, list);
    },
    dispatch(type, eventObj) {
      const list = (btnListeners.get(type) || []).slice();
      for (const h of list) h(eventObj);
    }
  };

  const mockWin = {
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      if (!windowListeners.has(type)) return;
      const list = windowListeners.get(type).filter(h => h !== handler);
      windowListeners.set(type, list);
    },
    dispatch(type, eventObj) {
      const list = (windowListeners.get(type) || []).slice();
      for (const h of list) h(eventObj);
    }
  };

  const mockDoc = {
    visibilityState: "visible",
    querySelector(selector) {
      if (selector === "#btnInstall") return mockBtn;
      return null;
    },
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      if (!documentListeners.has(type)) return;
      const list = documentListeners.get(type).filter(h => h !== handler);
      documentListeners.set(type, list);
    },
    dispatch(type, eventObj) {
      const list = (documentListeners.get(type) || []).slice();
      for (const h of list) h(eventObj);
    }
  };

  const mockSw = {
    controller: {},
    registerCalls: [],
    registerResult: null,
    register(url) {
      mockSw.registerCalls.push(url);
      if (mockSw.registerFn) return mockSw.registerFn(url);
      return mockSw.registerResult ? Promise.resolve(mockSw.registerResult) : Promise.reject(new Error("no reg"));
    },
    addEventListener(type, handler) {
      if (!swListeners.has(type)) swListeners.set(type, []);
      swListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      if (!swListeners.has(type)) return;
      const list = swListeners.get(type).filter(h => h !== handler);
      swListeners.set(type, list);
    },
    dispatch(type, eventObj) {
      const list = (swListeners.get(type) || []).slice();
      for (const h of list) h(eventObj);
    }
  };

  return {
    window: mockWin,
    document: mockDoc,
    btn: mockBtn,
    sw: mockSw,
    windowListeners,
    documentListeners,
    btnListeners,
    swListeners
  };
}

function load(src) {
  const box = {
    module: { exports: {} },
    self: {},
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Date: Date,
    Promise: Promise,
    console: console
  };
  vm.runInNewContext(src, box, { filename: "lib/app-platform.js" });
  return { exports: box.module.exports || box.self.AttentionLib.AppPlatform };
}

async function healthy(loaded) {
  const factory = loaded.exports.createAppPlatform;
  assert.strictEqual(typeof factory, "function", "createAppPlatform must be a function");

  // 1. Missing required deps throws fail-closed error
  assert.throws(() => {
    factory({});
  }, /缺少依赖/, "createAppPlatform must throw on missing dependencies");

  // 2. Pure Web scenario
  {
    const env = createMockEnvironment();
    let toastMsg = null;
    let pwaStatusCalls = 0;
    let notificationAction = null;
    let visibilityNoted = [];
    let foregroundCalls = 0;

    const deps = {
      getCapacitor: () => null,
      getNativeReminders: () => ({ isNativeAndroid: () => false }),
      getServiceWorker: () => env.sw,
      getWindow: () => env.window,
      getDocument: () => env.document,
      getState: () => ({ items: [] }),
      query: (sel) => env.document.querySelector(sel),
      toast: (msg) => { toastMsg = msg; },
      renderPwaStatus: () => { pwaStatusCalls++; },
      onNotificationAction: (data) => { notificationAction = data; },
      noteAppVisibility: (v) => { visibilityNoted.push(v); },
      onForeground: () => { foregroundCalls++; }
    };

    const platform = factory(deps);
    assert.strictEqual(platform.isNativeAndroidRuntime(), false, "Pure Web isNativeAndroidRuntime must be false");
    assert.strictEqual(platform.systemBridge(), null, "Pure Web systemBridge must be null");
    assert.strictEqual(platform.appSettingsPlugin(), null, "Pure Web appSettingsPlugin must be null");

    const waitRes = await platform.waitForNativeBridge(60);
    assert.strictEqual(waitRes, false, "waitForNativeBridge must return false when no bridge arrives");
  }

  // 3. Android runtime & late bridge arrival
  {
    const env = createMockEnvironment();
    const mockSb = { showAppDetails: () => {} };
    const mockSettings = { open: () => {} };
    const mockCap = {
      platform: "android",
      Plugins: { SystemBridge: mockSb, AppSettings: mockSettings }
    };

    let bridgeArrived = false;
    const mockNr = {
      isNativeAndroid: () => bridgeArrived,
      systemBridge: () => (bridgeArrived ? mockSb : null)
    };

    const deps = {
      getCapacitor: () => mockCap,
      getNativeReminders: () => mockNr,
      getServiceWorker: () => env.sw,
      getWindow: () => env.window,
      getDocument: () => env.document,
      getState: () => ({ items: [] }),
      query: (sel) => env.document.querySelector(sel),
      toast: () => {},
      renderPwaStatus: () => {},
      onNotificationAction: () => {},
      noteAppVisibility: () => {},
      onForeground: () => {}
    };

    const platform = factory(deps);
    assert.strictEqual(platform.isNativeAndroidRuntime(), true, "Android isNativeAndroidRuntime must be true");
    assert.strictEqual(platform.appSettingsPlugin(), mockSettings, "appSettingsPlugin must return capacitor plugin");
    assert.strictEqual(platform.systemBridge(), mockSb, "systemBridge returns mockSb");

    const waitPromise = platform.waitForNativeBridge(500);
    setTimeout(() => {
      bridgeArrived = true;
    }, 70);
    const resolved = await waitPromise;
    assert.strictEqual(resolved, true, "waitForNativeBridge must resolve true when bridge arrives within deadline");
  }

  // 4. Install prompt lifecycle & idempotency
  {
    const env = createMockEnvironment();
    let toastMsg = null;
    const deps = {
      getCapacitor: () => null,
      getNativeReminders: () => ({ isNativeAndroid: () => false }),
      getServiceWorker: () => env.sw,
      getWindow: () => env.window,
      getDocument: () => env.document,
      getState: () => ({ items: [] }),
      query: (sel) => env.document.querySelector(sel),
      toast: (m) => { toastMsg = m; },
      renderPwaStatus: () => {},
      onNotificationAction: () => {},
      noteAppVisibility: () => {},
      onForeground: () => {}
    };

    const platform = factory(deps);
    platform.bindInstall();
    platform.bindInstall(); // idempotent call

    assert.strictEqual((env.windowListeners.get("beforeinstallprompt") || []).length, 1, "beforeinstallprompt listener attached exactly once");
    assert.strictEqual((env.windowListeners.get("appinstalled") || []).length, 1, "appinstalled listener attached exactly once");
    assert.strictEqual((env.btnListeners.get("click") || []).length, 1, "btnInstall click listener attached exactly once");

    const noPromptRes = await platform.promptInstall();
    assert.strictEqual(noPromptRes, false, "promptInstall without event returns false");
    assert.strictEqual(toastMsg, "当前浏览器不支持直接安装，可使用「添加到主屏幕」");

    let prevented = false;
    let promptCalled = false;
    const fakePromptEvent = {
      preventDefault: () => { prevented = true; },
      prompt: () => { promptCalled = true; },
      userChoice: Promise.resolve({ outcome: "accepted" })
    };
    env.window.dispatch("beforeinstallprompt", fakePromptEvent);

    assert.strictEqual(prevented, true, "beforeinstallprompt default was prevented");
    assert.strictEqual(env.btn.hidden, false, "btnInstall made visible on beforeinstallprompt");
    assert.strictEqual(platform.getDeferredInstallPrompt(), fakePromptEvent, "deferred prompt stored");

    await platform.promptInstall();
    assert.strictEqual(promptCalled, true, "prompt() was invoked");
    assert.strictEqual(platform.getDeferredInstallPrompt(), null, "deferred prompt cleared after install");
    assert.strictEqual(env.btn.hidden, true, "btnInstall hidden after promptInstall");

    env.window.dispatch("beforeinstallprompt", fakePromptEvent);
    assert.strictEqual(platform.getDeferredInstallPrompt(), fakePromptEvent);
    env.window.dispatch("appinstalled", {});
    assert.strictEqual(platform.getDeferredInstallPrompt(), null, "deferred prompt cleared on appinstalled");
    assert.strictEqual(toastMsg, "已安装到主屏幕", "toast called on appinstalled");
  }

  // 5. Network & Visibility lifecycle & idempotency
  {
    const env = createMockEnvironment();
    let pwaStatusCount = 0;
    let visibilityStates = [];
    let foregroundCount = 0;

    const deps = {
      getCapacitor: () => null,
      getNativeReminders: () => ({ isNativeAndroid: () => false }),
      getServiceWorker: () => env.sw,
      getWindow: () => env.window,
      getDocument: () => env.document,
      getState: () => ({ items: [] }),
      query: (sel) => env.document.querySelector(sel),
      toast: () => {},
      renderPwaStatus: () => { pwaStatusCount++; },
      onNotificationAction: () => {},
      noteAppVisibility: (v) => { visibilityStates.push(v); },
      onForeground: () => { foregroundCount++; }
    };

    const platform = factory(deps);
    platform.bindNetwork();
    platform.bindNetwork(); // idempotent call

    assert.strictEqual((env.windowListeners.get("online") || []).length, 1, "online listener attached once");
    assert.strictEqual((env.windowListeners.get("offline") || []).length, 1, "offline listener attached once");
    assert.strictEqual((env.windowListeners.get("blur") || []).length, 1, "blur listener attached once");
    assert.strictEqual((env.windowListeners.get("focus") || []).length, 1, "focus listener attached once");
    assert.strictEqual((env.documentListeners.get("visibilitychange") || []).length, 1, "visibilitychange listener attached once");

    env.window.dispatch("online", {});
    assert.strictEqual(pwaStatusCount, 1, "online triggered renderPwaStatus");
    env.window.dispatch("offline", {});
    assert.strictEqual(pwaStatusCount, 2, "offline triggered renderPwaStatus");

    env.window.dispatch("blur", {});
    assert.strictEqual(visibilityStates[visibilityStates.length - 1], false, "blur noted visibility false");
    env.window.dispatch("focus", {});
    assert.strictEqual(visibilityStates[visibilityStates.length - 1], true, "focus noted visibility true");

    env.document.visibilityState = "visible";
    env.document.dispatch("visibilitychange", {});
    assert.strictEqual(visibilityStates[visibilityStates.length - 1], true, "visible state noted");
    assert.strictEqual(foregroundCount, 1, "onForeground called on visible");

    env.document.visibilityState = "hidden";
    env.document.dispatch("visibilitychange", {});
    assert.strictEqual(visibilityStates[visibilityStates.length - 1], false, "hidden state noted");
    assert.strictEqual(foregroundCount, 1, "onForeground NOT called on hidden");
  }

  // 6. P3-H-R: Service Worker registration idempotency, in-flight deduplication, retry on failure, late fulfillment guard
  {
    // 6a. In-flight repeated calls & post-success repeated calls with exact counts
    const env = createMockEnvironment();
    let notificationActionCount = 0;
    let lastActionData = null;
    let waitingSkipWaiting = false;
    let installingSkipWaiting = false;

    const regListeners = new Map();
    const fakeInstalling = {
      state: "installing",
      listeners: new Map(),
      addEventListener(type, handler) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(handler);
      },
      postMessage(msg) {
        if (msg && msg.type === "SKIP_WAITING") installingSkipWaiting = true;
      }
    };

    const fakeReg = {
      waiting: {
        postMessage(msg) {
          if (msg && msg.type === "SKIP_WAITING") waitingSkipWaiting = true;
        }
      },
      installing: fakeInstalling,
      addEventListener(type, handler) {
        if (!regListeners.has(type)) regListeners.set(type, []);
        regListeners.get(type).push(handler);
      },
      removeEventListener(type, handler) {
        if (!regListeners.has(type)) return;
        regListeners.set(type, regListeners.get(type).filter(h => h !== handler));
      },
      dispatch(type, eventObj) {
        const list = (regListeners.get(type) || []).slice();
        for (const h of list) h(eventObj);
      }
    };

    let registerPromiseResolve;
    const registerPromise = new Promise(resolve => {
      registerPromiseResolve = resolve;
    });

    let swRegisterCallCount = 0;
    env.sw.registerFn = () => {
      swRegisterCallCount++;
      return registerPromise;
    };

    const deps = {
      getCapacitor: () => null,
      getNativeReminders: () => ({ isNativeAndroid: () => false }),
      getServiceWorker: () => env.sw,
      getWindow: () => env.window,
      getDocument: () => env.document,
      getState: () => ({ items: [] }),
      query: (sel) => env.document.querySelector(sel),
      toast: () => {},
      renderPwaStatus: () => {},
      onNotificationAction: (data) => {
        notificationActionCount++;
        lastActionData = data;
      },
      noteAppVisibility: () => {},
      onForeground: () => {}
    };

    const platform = factory(deps);

    // Call 1: starts registration
    platform.registerPwa();
    // Call 2: in-flight call (must be deduplicated)
    platform.registerPwa();

    assert.strictEqual(swRegisterCallCount, 1, "P3-H-R: sw.register called exactly once while in-flight");
    assert.strictEqual((env.swListeners.get("controllerchange") || []).length, 1, "sw controllerchange attached once");
    assert.strictEqual((env.swListeners.get("message") || []).length, 1, "sw message attached once");

    // Resolve the in-flight registration
    registerPromiseResolve(fakeReg);
    await registerPromise;
    await new Promise(r => setTimeout(r, 10));

    assert.strictEqual(platform.getSwRegistration(), fakeReg, "swRegistration saved on resolution");
    assert.strictEqual(waitingSkipWaiting, true, "SKIP_WAITING sent to waiting worker");
    assert.strictEqual((regListeners.get("updatefound") || []).length, 1, "updatefound listener attached exactly once");

    // Call 3: call after success (must be deduplicated)
    platform.registerPwa();
    assert.strictEqual(swRegisterCallCount, 1, "sw.register NOT called again after success");
    assert.strictEqual((regListeners.get("updatefound") || []).length, 1, "updatefound listener NOT duplicated after success");

    // Notification action dispatch: verify single forwarding per event
    env.sw.dispatch("message", { data: { type: "notification-action", itemId: "it-1", action: "done" } });
    assert.strictEqual(notificationActionCount, 1, "notification action invoked once");
    assert.deepStrictEqual(lastActionData, { type: "notification-action", itemId: "it-1", action: "done" });

    env.sw.dispatch("message", { data: { type: "notification-action", itemId: "it-2", action: "snooze" } });
    assert.strictEqual(notificationActionCount, 2, "subsequent notification action invoked once");

    // 6b. Retry after registration failure: must not be permanently locked out
    {
      const retryEnv = createMockEnvironment();
      let retryCalls = 0;
      let rejectPromise;
      const secondReg = {
        addEventListener: (t, h) => {},
        removeEventListener: () => {}
      };

      retryEnv.sw.registerFn = () => {
        retryCalls++;
        if (retryCalls === 1) {
          return Promise.reject(new Error("failed registration"));
        }
        return Promise.resolve(secondReg);
      };

      const retryPlatform = factory(Object.assign({}, deps, { getServiceWorker: () => retryEnv.sw }));

      // First call fails
      retryPlatform.registerPwa();
      await new Promise(r => setTimeout(r, 10));
      assert.strictEqual(retryCalls, 1, "first call initiated");
      assert.strictEqual(retryPlatform.getSwRegistration(), null, "swRegistration is null after failure");

      // Second call (explicit retry) must be allowed and succeed
      retryPlatform.registerPwa();
      await new Promise(r => setTimeout(r, 10));
      assert.strictEqual(retryCalls, 2, "second call retried after failure");
      assert.strictEqual(retryPlatform.getSwRegistration(), secondReg, "swRegistration saved on retry success");
    }

    // 6c. Late resolution after unbindAll: must NOT attach to registration or store it
    {
      const lateEnv = createMockEnvironment();
      let lateRegListeners = [];
      const lateReg = {
        addEventListener: (t, h) => { lateRegListeners.push({ t, h }); },
        removeEventListener: () => {}
      };

      let deferredResolve;
      lateEnv.sw.registerFn = () => new Promise(r => { deferredResolve = r; });

      const latePlatform = factory(Object.assign({}, deps, { getServiceWorker: () => lateEnv.sw }));
      latePlatform.registerPwa();

      // unbindAll called while registration is still in-flight
      latePlatform.unbindAll();

      // Now late resolution arrives
      deferredResolve(lateReg);
      await new Promise(r => setTimeout(r, 10));

      assert.strictEqual(latePlatform.getSwRegistration(), null, "late resolution does not set swRegistration");
      assert.strictEqual(lateRegListeners.length, 0, "late resolution does not attach updatefound listener");
    }
  }

  // 7. UnbindAll cleans up all listeners
  {
    const env = createMockEnvironment();
    const deps = {
      getCapacitor: () => null,
      getNativeReminders: () => ({ isNativeAndroid: () => false }),
      getServiceWorker: () => env.sw,
      getWindow: () => env.window,
      getDocument: () => env.document,
      getState: () => ({ items: [] }),
      query: (sel) => env.document.querySelector(sel),
      toast: () => {},
      renderPwaStatus: () => {},
      onNotificationAction: () => {},
      noteAppVisibility: () => {},
      onForeground: () => {}
    };

    const platform = factory(deps);
    platform.bindInstall();
    platform.bindNetwork();
    platform.unbindAll();

    assert.strictEqual((env.windowListeners.get("beforeinstallprompt") || []).length, 0, "beforeinstallprompt unbound");
    assert.strictEqual((env.windowListeners.get("appinstalled") || []).length, 0, "appinstalled unbound");
    assert.strictEqual((env.btnListeners.get("click") || []).length, 0, "btn click unbound");
    assert.strictEqual((env.windowListeners.get("online") || []).length, 0, "online unbound");
    assert.strictEqual((env.windowListeners.get("offline") || []).length, 0, "offline unbound");
    assert.strictEqual((env.documentListeners.get("visibilitychange") || []).length, 0, "visibilitychange unbound");
  }

  // 8. P3-H-R2: Worker statechange listener unbound on unbindAll and guarded against post-unbind execution
  {
    const env = createMockEnvironment();
    let workerMessages = [];
    const workerListeners = new Map();
    const fakeWorker = {
      state: "installing",
      addEventListener(type, handler) {
        if (!workerListeners.has(type)) workerListeners.set(type, []);
        workerListeners.get(type).push(handler);
      },
      removeEventListener(type, handler) {
        if (!workerListeners.has(type)) return;
        workerListeners.set(type, workerListeners.get(type).filter(h => h !== handler));
      },
      postMessage(msg) {
        workerMessages.push(msg);
      },
      dispatch(type) {
        const list = (workerListeners.get(type) || []).slice();
        for (const h of list) h();
      }
    };

    const regListeners = new Map();
    const fakeReg = {
      installing: fakeWorker,
      addEventListener(type, handler) {
        if (!regListeners.has(type)) regListeners.set(type, []);
        regListeners.get(type).push(handler);
      },
      removeEventListener(type, handler) {
        if (!regListeners.has(type)) return;
        regListeners.set(type, regListeners.get(type).filter(h => h !== handler));
      },
      dispatch(type) {
        const list = (regListeners.get(type) || []).slice();
        for (const h of list) h();
      }
    };

    env.sw.registerFn = () => Promise.resolve(fakeReg);
    env.sw.controller = {};

    const deps = {
      getCapacitor: () => null,
      getNativeReminders: () => ({ isNativeAndroid: () => false }),
      getServiceWorker: () => env.sw,
      getWindow: () => env.window,
      getDocument: () => env.document,
      getState: () => ({ items: [] }),
      query: (sel) => env.document.querySelector(sel),
      toast: () => {},
      renderPwaStatus: () => {},
      onNotificationAction: () => {},
      noteAppVisibility: () => {},
      onForeground: () => {}
    };

    const platform = factory(deps);
    platform.registerPwa();
    await new Promise(r => setTimeout(r, 10));

    // trigger updatefound to attach statechange to fakeWorker
    fakeReg.dispatch("updatefound");
    assert.strictEqual((workerListeners.get("statechange") || []).length, 1, "worker statechange attached on updatefound");

    // unbindAll should unbind the statechange handler
    platform.unbindAll();
    assert.strictEqual((workerListeners.get("statechange") || []).length, 0, "worker statechange removed on unbindAll");

    // simulate worker reaching installed state anyway
    fakeWorker.state = "installed";
    fakeWorker.dispatch("statechange");
    assert.strictEqual(workerMessages.length, 0, "no SKIP_WAITING sent after unbindAll");
  }

  // 9. P3-I-R：平台角标（updateAppBadge）—— 宿主能力不足时静默，到期条数照实上报
  {
    const calls = { set: [], clear: 0 };
    const badgeWin = {
      navigator: {
        setAppBadge(n) { calls.set.push(n); return Promise.resolve(); },
        clearAppBadge() { calls.clear++; return Promise.resolve(); }
      }
    };
    const state = { items: [{ status: "due" }, { status: "due" }, { status: "waiting" }] };
    const deps = {
      getCapacitor: () => null,
      getNativeReminders: () => ({ isNativeAndroid: () => false }),
      getServiceWorker: () => null,
      getWindow: () => badgeWin,
      getDocument: () => ({ querySelector: () => null }),
      getState: () => state,
      query: () => null,
      toast: () => {},
      renderPwaStatus: () => {},
      onNotificationAction: () => {},
      noteAppVisibility: () => {},
      onForeground: () => {}
    };
    const platform = factory(deps);
    assert.strictEqual(platform.updateAppBadge(), 2, "updateAppBadge must count due items");
    assert.strictEqual(calls.set.length, 1, "setAppBadge called once");
    assert.strictEqual(calls.set[0], 2, "setAppBadge receives the due count");
    assert.strictEqual(platform.updateAppBadge(0), 0, "explicit 0 must be honoured");
    assert.strictEqual(calls.clear, 1, "clearAppBadge called when count is 0");
    assert.strictEqual(platform.updateAppBadge(5), 5, "explicit count wins over derived count");
    assert.strictEqual(calls.set.length, 2, "setAppBadge called again for explicit count");

    const noBadge = factory(Object.assign({}, deps, { getWindow: () => ({ navigator: {} }) }));
    assert.strictEqual(noBadge.updateAppBadge(), null, "host without Badging API ⇒ silent null, never throws");
  }

  return "healthy checks passed";
}

async function mutant(name, transform) {
  const mutatedSrc = transform(source);
  assert.notStrictEqual(mutatedSrc, source, name + " did not modify source");
  let failed = false;
  try {
    const loaded = load(mutatedSrc);
    await healthy(loaded);
  } catch (e) {
    failed = true;
  }
  assert.strictEqual(failed, true, name + " did not fail healthy behavior");
  return name + ": mutation detected";
}

(async () => {
  const out = [await healthy(load(source))];

  // 变异 1：监听器未去重防抖（移除 bindNetwork / bindInstall 幂等保护标志）
  out.push(await mutant("mutant1_listenerDoubling: remove installBound / networkBound check", s => {
    return s.replace(
      "if (installBound) return;",
      "/* installBound bypassed */"
    ).replace(
      "if (networkBound) return;",
      "/* networkBound bypassed */"
    );
  }));

  // 变异 2：通知动作转发被绕过（注释掉 onNotificationAction 调用）
  out.push(await mutant("mutant2_notificationActionBypassed: omit onNotificationAction", s => {
    return s.replace(
      "deps.onNotificationAction(data);",
      "/* bypassed onNotificationAction */"
    );
  }));

  // 变异 3：原生 Android 检测在没有 Capacitor 时误判为 true
  out.push(await mutant("mutant3_nativeAndroidWithoutCapacitor: return true when cap is null", s => {
    return s.replace(
      "if (!cap) return false;",
      "if (!cap) return true;"
    );
  }));

  // 变异 4：桥晚到轮询被破坏（直接返回 false，不轮询）
  out.push(await mutant("mutant4_lateBridgePollingBroken: immediate false on first check", s => {
    return s.replace(
      "if (Date.now() >= deadline) return resolve(false);",
      "return resolve(false);"
    );
  }));

  // 变异 5：appinstalled 时未清理 deferredInstallPrompt
  out.push(await mutant("mutant5_deferredPromptNotClearedOnAppInstalled: omit clearing deferredInstallPrompt", s => {
    return s.replace(
      "appInstalledHandler = function() {\n        deferredInstallPrompt = null;",
      "appInstalledHandler = function() {\n        /* deferredInstallPrompt retained */"
    );
  }));

  // 变异 6：P3-H-R：移除 SW 重复注册与 updatefound 幂等保护（回归独立复验发现的缺口）
  out.push(await mutant("mutant6_swDuplicateRegistrationNotPrevented: remove in-flight and success registration check", s => {
    return s.replace(
      "if (swRegistration) {\n        deps.renderPwaStatus();\n        return;\n      }",
      "/* swRegistration check removed */"
    ).replace(
      "if (swRegistering) {\n        return;\n      }",
      "/* swRegistering check removed */"
    );
  }));

  // 变异 7：P3-H-R：注册失败后不释放锁导致永久死锁（无法重试）
  out.push(await mutant("mutant7_swFailurePermanentLockout: do not clear swRegistering on rejection", s => {
    return s.replace(
      "swRegistering = false;\n        swRegistration = null;\n        deps.renderPwaStatus();",
      "swRegistration = null;\n        deps.renderPwaStatus();"
    );
  }));

  // 变异 8：P3-H-R：移除解绑后迟到兑现的 epoch 检查（旧回调错误挂在解绑后实例上）
  out.push(await mutant("mutant8_swLateResolutionEpochIgnored: omit currentEpoch check", s => {
    return s.replace(
      "if (currentEpoch !== swEpoch) {\n          return;\n        }",
      "/* epoch check bypassed */"
    );
  }));

  // 变异 9：P3-H-R2：unbindAll 时未解绑 worker 的 statechange 监听器
  out.push(await mutant("mutant9_workerStateChangeNotUnboundOnUnbindAll: omit worker removeEventListener on unbindAll", s => {
    return s.replace(
      "if (installingWorker && typeof installingWorker.removeEventListener === \"function\" && workerStateChangeHandler) {\n        installingWorker.removeEventListener(\"statechange\", workerStateChangeHandler);\n      }",
      "if (installingWorker && typeof installingWorker.removeEventListener === \"function\" && workerStateChangeHandler) {\n        /* worker removeEventListener omitted on unbindAll */\n      }"
    );
  }));

  // 变异 10：P3-I-R：角标计数被写死（既不数到期条数，也不认显式传入）
  out.push(await mutant("mutant10_appBadgeCountHardcoded: count always 0", s => {
    return s.replace(
      "const count = forced != null\n        ? forced\n        : deps.getState().items.filter(function(it) { return it.status === \"due\"; }).length;",
      "const count = 0;"
    );
  }));

  const hashAfter = crypto.createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");
  assert.strictEqual(hashBefore, hashAfter, "lib/app-platform.js must be byte-for-byte identical before and after mutations");

  out.push("lib/app-platform.js before/after SHA-256 match: " + hashBefore);
  console.log(out.join("\n"));
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
