#!/usr/bin/env python3
"""Disposable production-page P3-H / P3-H-R platform check with real SW registration in fresh Chrome profile."""
import functools, http.server, json, os, pathlib, subprocess, sys, tempfile, threading, time, urllib.request, websocket

for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
    os.environ.pop(k, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

ROOT = pathlib.Path(__file__).resolve().parents[2]
CDP = 18998
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, *a):
        pass
    def end_headers(self):
        if self.path.endswith(".js"):
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
        super().end_headers()

class C:
    def __init__(s, u):
        s.w = websocket.create_connection(u, timeout=20)
        s.i = 0
    def e(s, x):
        s.i += 1
        s.w.send(json.dumps({"id": s.i, "method": "Runtime.evaluate", "params": {"expression": x, "awaitPromise": True, "returnByValue": True}}))
        while True:
            r = json.loads(s.w.recv())
            if r.get("id") == s.i:
                if "exceptionDetails" in r.get("result", {}):
                    raise RuntimeError("CDP Eval Error: " + json.dumps(r["result"]["exceptionDetails"]))
                return r.get("result", {}).get("result", {}).get("value")

server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
port = server.server_address[1]

profile_dir = tempfile.mkdtemp(prefix="p3hr-platform-")
p = subprocess.Popen([
    CHROME,
    "--headless=new",
    f"--user-data-dir={profile_dir}",
    f"--remote-debugging-port={CDP}",
    "--no-proxy-server",
    "--remote-allow-origins=*",
    "--no-first-run",
    "about:blank"
], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

try:
    for _ in range(100):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP}/json", timeout=1))
            break
        except Exception:
            time.sleep(0.1)
    else:
        raise RuntimeError("Chrome CDP unavailable")

    c = C(next(t for t in tabs if t.get("type") == "page")["webSocketDebuggerUrl"])
    c.e(f"location.href='http://127.0.0.1:{port}/index.html';true")
    time.sleep(1.5)

    out = c.e("""(async () => {
      try {
        const a = window.__ATTENTION_INBOX__;
        const q = s => document.querySelector(s);
        if (!a || !(await a.ready())) return { ready: false };

        const platform = a.platform;
        const hasPlatform = !!platform;
        const contract = (a.APP_PLATFORM_INSTANCE_CONTRACT && a.APP_PLATFORM_INSTANCE_CONTRACT.instance) || [];
        const hasAllContract = contract.every(m => typeof platform[m] === "function");

        // 1. Pure browser runtime checks
        const isNative = platform.isNativeAndroidRuntime();
        const sysBridge = platform.systemBridge();
        const appSettings = platform.appSettingsPlugin();

        // 2. Real Service Worker registration & cache verification
        const swReady = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise(resolve => setTimeout(() => resolve(null), 7000))
        ]);
        const browserReg = await navigator.serviceWorker.getRegistration();
        const platformReg = platform.getSwRegistration();
        const platformRegMatches = (platformReg === browserReg);
        const swActive = !!(swReady && swReady.active);
        const cacheNames = await caches.keys();
        const hasV38Cache = cacheNames.includes('attention-inbox-v38');
        const platformCached = !!(await caches.match('./lib/app-platform.js'));

        // Idempotency: repeated registerPwa() in real browser
        platform.registerPwa();
        platform.registerPwa();
        const platformRegAfterRepeat = platform.getSwRegistration();
        const repeatPreservesReg = (platformRegAfterRepeat === platformReg);

        // 3. Install prompt lifecycle & counts
        const btnInstall = q('#btnInstall');
        if (btnInstall) btnInstall.hidden = true;
        const initialBtnHidden = btnInstall ? btnInstall.hidden : null;

        let promptPrevented = false;
        const bipEvent = new Event('beforeinstallprompt');
        bipEvent.preventDefault = () => { promptPrevented = true; };
        bipEvent.prompt = () => {};
        bipEvent.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(bipEvent);

        const btnVisibleAfterPrompt = btnInstall ? !btnInstall.hidden : false;
        const deferredPromptSaved = platform.getDeferredInstallPrompt() === bipEvent;

        window.dispatchEvent(new Event('appinstalled'));
        const btnHiddenAfterInstalled = btnInstall ? btnInstall.hidden : false;
        const deferredPromptCleared = platform.getDeferredInstallPrompt() === null;

        // 4. Network and visibility side-effect assertions
        let pwaStatusUpdates = 0;
        const origRenderPwa = a.renderPwaStatus;
        if (typeof origRenderPwa === "function") {
          a.renderPwaStatus = function() {
            pwaStatusUpdates++;
            return origRenderPwa.apply(this, arguments);
          };
        }

        window.dispatchEvent(new Event('online'));
        window.dispatchEvent(new Event('offline'));

        // Idempotency: re-call bindInstall / bindNetwork
        platform.bindInstall();
        platform.bindNetwork();

        return {
          ready: true,
          hasPlatform,
          hasAllContract,
          contractLength: contract.length,
          isNative,
          sysBridgeIsNull: sysBridge === null,
          appSettingsIsNull: appSettings === null,
          swRegistered: !!browserReg,
          platformRegMatches,
          swActive,
          cacheNames,
          hasV38Cache,
          platformCached,
          repeatPreservesReg,
          initialBtnHidden,
          promptPrevented,
          btnVisibleAfterPrompt,
          deferredPromptSaved,
          btnHiddenAfterInstalled,
          deferredPromptCleared,
          pwaStatusUpdates
        };
      } catch (err) {
        return { error: err.stack || String(err) };
      }
    })()""")

    print(json.dumps(out, ensure_ascii=False))

    expected = (
        isinstance(out, dict) and
        out.get("ready") is True and
        out.get("hasPlatform") is True and
        out.get("hasAllContract") is True and
        out.get("contractLength") == 9 and
        out.get("isNative") is False and
        out.get("sysBridgeIsNull") is True and
        out.get("appSettingsIsNull") is True and
        out.get("swRegistered") is True and
        out.get("platformRegMatches") is True and
        out.get("swActive") is True and
        out.get("hasV38Cache") is True and
        out.get("platformCached") is True and
        out.get("repeatPreservesReg") is True and
        out.get("initialBtnHidden") is True and
        out.get("promptPrevented") is True and
        out.get("btnVisibleAfterPrompt") is True and
        out.get("deferredPromptSaved") is True and
        out.get("btnHiddenAfterInstalled") is True and
        out.get("deferredPromptCleared") is True and
        out.get("pwaStatusUpdates", 0) >= 2
    )

    if not expected:
        print("ASSERTION FAILED: unexpected browser check output", file=sys.stderr)
        sys.exit(1)

    print("All browser platform and SW checks PASSED")

finally:
    p.kill()
    server.shutdown()
