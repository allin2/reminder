/* P3-H platform adaptation & PWA lifecycle layer.
 * UMD factory: evaluation performs no I/O, no DOM querying, and no state mutation.
 */
(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.AttentionLib = root.AttentionLib || {};
    root.AttentionLib.AppPlatform = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function(root) {
  "use strict";

  function createAppPlatform(input) {
    const deps = input || {};
    const REQUIRED_DEPS = [
      "getCapacitor",
      "getNativeReminders",
      "getServiceWorker",
      "getWindow",
      "getDocument",
      "getState",
      "toast",
      "renderPwaStatus",
      "onNotificationAction",
      "noteAppVisibility",
      "onForeground"
    ];
    REQUIRED_DEPS.forEach(function(name) {
      if (typeof deps[name] !== "function") {
        throw new Error("createAppPlatform(deps) 缺少依赖：" + name);
      }
    });

    const timerSet = typeof deps.setTimeout === "function" ? deps.setTimeout : (typeof setTimeout !== "undefined" ? setTimeout : function() {});
    const timerClear = typeof deps.clearTimeout === "function" ? deps.clearTimeout : (typeof clearTimeout !== "undefined" ? clearTimeout : function() {});

    let deferredInstallPrompt = null;
    let installBound = false;
    let networkBound = false;
    let pwaRegistered = false;
    let swRegistration = null;
    let swRegistering = false;
    let swEpoch = 0;
    let updateFoundHandler = null;
    let installingWorker = null;
    let workerStateChangeHandler = null;

    // Handlers stored for deduplication / unbinding
    let beforeInstallPromptHandler = null;
    let appInstalledHandler = null;
    let installButtonClickHandler = null;
    let onlineHandler = null;
    let offlineHandler = null;
    let blurHandler = null;
    let focusHandler = null;
    let visibilityChangeHandler = null;
    let swMessageHandler = null;
    let swControllerChangeHandler = null;

    function getCapacitor() {
      return deps.getCapacitor ? deps.getCapacitor() : null;
    }

    function getNativeReminders() {
      return deps.getNativeReminders ? deps.getNativeReminders() : null;
    }

    function getServiceWorker() {
      return deps.getServiceWorker ? deps.getServiceWorker() : null;
    }

    function getWindow() {
      return deps.getWindow ? deps.getWindow() : (typeof window !== "undefined" ? window : null);
    }

    function getDocument() {
      return deps.getDocument ? deps.getDocument() : (typeof document !== "undefined" ? document : null);
    }

    /**
     * 平台侧的应用角标（PWA Badging API）。
     *
     * 为什么它在平台层：`navigator.setAppBadge` / `clearAppBadge` 是**宿主能力**，
     * 与 PWA 注册、安装提示、在线状态同属一类；入口原先内联了这段实现，
     * 于是「宿主能力怎么写」和「入口怎么装模块」混在一起。
     *
     * 数量语义（`forced == null` 时数「到期」的条数）保持与原实现逐字一致：
     * 显式传入的数字优先，否则现场从状态里数。不支持的宿主下是**静默无操作**
     * （而不是抛错）—— 角标只是锦上添花，绝不能因为它把主流程带崩。
     */
    function updateAppBadge(forced) {
      const win = getWindow();
      const nav = (win && win.navigator) || (typeof navigator !== "undefined" ? navigator : null);
      if (!nav || typeof nav.setAppBadge !== "function") return null;
      const count = forced != null
        ? forced
        : deps.getState().items.filter(function(it) { return it.status === "due"; }).length;
      if (count > 0) nav.setAppBadge(count).catch(function() {});
      else if (typeof nav.clearAppBadge === "function") nav.clearAppBadge().catch(function() {});
      return count;
    }

    function query(selector) {
      if (typeof deps.query === "function") return deps.query(selector);
      const doc = getDocument();
      return doc && typeof doc.querySelector === "function" ? doc.querySelector(selector) : null;
    }

    function isNativeAndroidRuntime() {
      const cap = getCapacitor();
      if (!cap) return false;
      const platform = typeof cap.getPlatform === "function" ? cap.getPlatform() : cap.platform;
      return platform === "android";
    }

    function waitForNativeBridge(timeoutMs) {
      const deadline = Date.now() + (timeoutMs || 3000);
      return new Promise(function(resolve) {
        (function check() {
          const nr = getNativeReminders();
          if (nr && nr.isNativeAndroid && nr.isNativeAndroid()) return resolve(true);
          if (Date.now() >= deadline) return resolve(false);
          timerSet(check, 50);
        })();
      });
    }

    function systemBridge() {
      const nr = getNativeReminders();
      if (nr && typeof nr.systemBridge === "function") {
        const b = nr.systemBridge();
        if (b) return b;
      }
      const cap = getCapacitor();
      return cap && cap.Plugins && cap.Plugins.SystemBridge ? cap.Plugins.SystemBridge : null;
    }

    function appSettingsPlugin() {
      const cap = getCapacitor();
      return cap && cap.Plugins && cap.Plugins.AppSettings ? cap.Plugins.AppSettings : null;
    }

    function getDeferredInstallPrompt() {
      return deferredInstallPrompt;
    }

    async function promptInstall() {
      if (!deferredInstallPrompt) {
        deps.toast("当前浏览器不支持直接安装，可使用「添加到主屏幕」");
        return false;
      }
      try {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        const btn = query("#btnInstall");
        if (btn) btn.hidden = true;
        return true;
      } catch (err) {
        deferredInstallPrompt = null;
        return false;
      }
    }

    function bindInstall() {
      if (installBound) return;
      const win = getWindow();
      if (!win || typeof win.addEventListener !== "function") return;

      beforeInstallPromptHandler = function(e) {
        if (e && typeof e.preventDefault === "function") {
          e.preventDefault();
        }
        deferredInstallPrompt = e;
        const btn = query("#btnInstall");
        if (btn) btn.hidden = false;
      };

      appInstalledHandler = function() {
        deferredInstallPrompt = null;
        const btn = query("#btnInstall");
        if (btn) btn.hidden = true;
        deps.toast("已安装到主屏幕");
      };

      win.addEventListener("beforeinstallprompt", beforeInstallPromptHandler);
      win.addEventListener("appinstalled", appInstalledHandler);

      const btn = query("#btnInstall");
      if (btn && typeof btn.addEventListener === "function") {
        installButtonClickHandler = async function() {
          await promptInstall();
        };
        btn.addEventListener("click", installButtonClickHandler);
      }

      installBound = true;
    }

    function bindNetwork() {
      if (networkBound) return;
      const win = getWindow();
      const doc = getDocument();
      if (!win || typeof win.addEventListener !== "function") return;

      onlineHandler = function() {
        deps.renderPwaStatus();
      };
      offlineHandler = function() {
        deps.renderPwaStatus();
      };
      blurHandler = function() {
        deps.noteAppVisibility(false);
      };
      focusHandler = function() {
        deps.noteAppVisibility(true);
      };

      win.addEventListener("online", onlineHandler);
      win.addEventListener("offline", offlineHandler);
      win.addEventListener("blur", blurHandler);
      win.addEventListener("focus", focusHandler);

      if (doc && typeof doc.addEventListener === "function") {
        visibilityChangeHandler = function() {
          const isVisible = doc.visibilityState === "visible";
          deps.noteAppVisibility(isVisible);
          if (isVisible) {
            deps.onForeground();
          }
        };
        doc.addEventListener("visibilitychange", visibilityChangeHandler);
      }

      networkBound = true;
    }

    function registerPwa() {
      const nr = getNativeReminders();
      if (nr && nr.isNativeAndroid && nr.isNativeAndroid()) {
        deps.renderPwaStatus();
        return;
      }

      const sw = getServiceWorker();
      if (!sw || typeof sw.register !== "function") {
        deps.renderPwaStatus();
        return;
      }

      if (!pwaRegistered && typeof sw.addEventListener === "function") {
        swControllerChangeHandler = function() {
          // new SW took over; keep UI as-is to avoid reload loops
        };
        swMessageHandler = function(event) {
          const data = (event && event.data) || {};
          if (data.type !== "notification-action") return;
          deps.onNotificationAction(data);
        };
        sw.addEventListener("controllerchange", swControllerChangeHandler);
        sw.addEventListener("message", swMessageHandler);
        pwaRegistered = true;
      }

      if (swRegistration) {
        deps.renderPwaStatus();
        return;
      }

      if (swRegistering) {
        return;
      }

      swRegistering = true;
      const currentEpoch = ++swEpoch;

      sw.register("sw.js").then(function(reg) {
        if (currentEpoch !== swEpoch) {
          return;
        }
        swRegistering = false;
        swRegistration = reg;
        if (reg && reg.waiting && typeof reg.waiting.postMessage === "function") {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        if (reg && typeof reg.addEventListener === "function" && !updateFoundHandler) {
          updateFoundHandler = function() {
            if (currentEpoch !== swEpoch) return;
            const nw = reg.installing;
            if (nw && typeof nw.addEventListener === "function") {
              if (installingWorker && workerStateChangeHandler && typeof installingWorker.removeEventListener === "function") {
                installingWorker.removeEventListener("statechange", workerStateChangeHandler);
              }
              installingWorker = nw;
              workerStateChangeHandler = function() {
                if (currentEpoch !== swEpoch) return;
                if (nw.state === "installed" && sw.controller && typeof nw.postMessage === "function") {
                  nw.postMessage({ type: "SKIP_WAITING" });
                }
              };
              nw.addEventListener("statechange", workerStateChangeHandler);
            }
          };
          reg.addEventListener("updatefound", updateFoundHandler);
        }
        deps.renderPwaStatus();
      }).catch(function() {
        if (currentEpoch !== swEpoch) {
          return;
        }
        swRegistering = false;
        swRegistration = null;
        deps.renderPwaStatus();
      });
    }

    function unbindAll() {
      swEpoch++;
      swRegistering = false;

      const win = getWindow();
      const doc = getDocument();
      if (win && typeof win.removeEventListener === "function") {
        if (beforeInstallPromptHandler) win.removeEventListener("beforeinstallprompt", beforeInstallPromptHandler);
        if (appInstalledHandler) win.removeEventListener("appinstalled", appInstalledHandler);
        if (onlineHandler) win.removeEventListener("online", onlineHandler);
        if (offlineHandler) win.removeEventListener("offline", offlineHandler);
        if (blurHandler) win.removeEventListener("blur", blurHandler);
        if (focusHandler) win.removeEventListener("focus", focusHandler);
      }
      if (doc && typeof doc.removeEventListener === "function") {
        if (visibilityChangeHandler) doc.removeEventListener("visibilitychange", visibilityChangeHandler);
      }
      const btn = query("#btnInstall");
      if (btn && typeof btn.removeEventListener === "function" && installButtonClickHandler) {
        btn.removeEventListener("click", installButtonClickHandler);
      }
      const sw = getServiceWorker();
      if (sw && typeof sw.removeEventListener === "function") {
        if (swControllerChangeHandler) sw.removeEventListener("controllerchange", swControllerChangeHandler);
        if (swMessageHandler) sw.removeEventListener("message", swMessageHandler);
      }
      if (swRegistration && typeof swRegistration.removeEventListener === "function" && updateFoundHandler) {
        swRegistration.removeEventListener("updatefound", updateFoundHandler);
      }
      if (installingWorker && typeof installingWorker.removeEventListener === "function" && workerStateChangeHandler) {
        installingWorker.removeEventListener("statechange", workerStateChangeHandler);
      }

      beforeInstallPromptHandler = null;
      appInstalledHandler = null;
      installButtonClickHandler = null;
      onlineHandler = null;
      offlineHandler = null;
      blurHandler = null;
      focusHandler = null;
      visibilityChangeHandler = null;
      swMessageHandler = null;
      swControllerChangeHandler = null;
      updateFoundHandler = null;
      installingWorker = null;
      workerStateChangeHandler = null;

      installBound = false;
      networkBound = false;
      pwaRegistered = false;
      swRegistration = null;
      deferredInstallPrompt = null;
    }

    function getSwRegistration() {
      return swRegistration;
    }

    return {
      isNativeAndroidRuntime: isNativeAndroidRuntime,
      waitForNativeBridge: waitForNativeBridge,
      systemBridge: systemBridge,
      appSettingsPlugin: appSettingsPlugin,
      getDeferredInstallPrompt: getDeferredInstallPrompt,
      promptInstall: promptInstall,
      bindInstall: bindInstall,
      bindNetwork: bindNetwork,
      registerPwa: registerPwa,
      updateAppBadge: updateAppBadge,
      unbindAll: unbindAll,
      getSwRegistration: getSwRegistration
    };
  }

  return {
    createAppPlatform: createAppPlatform
  };
});
