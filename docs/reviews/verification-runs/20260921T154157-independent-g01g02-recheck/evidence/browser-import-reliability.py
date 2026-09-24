#!/usr/bin/env python3
"""真实 Chrome 中复验导入提交时点、拒绝文案与 FileReader error/abort。"""

import importlib.util
import json
import pathlib
import subprocess
import threading
import time
import urllib.request
import http.server

ROOT = pathlib.Path(__file__).resolve().parents[5]
SOURCE = ROOT / "scripts/verification/browser-recovery-check.py"
spec = importlib.util.spec_from_file_location("browser_check", SOURCE)
bc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bc)
bc.HTTP_PORT = 18775
bc.CDP_PORT = 18776
bc.STATE["block"] = None

OUT = pathlib.Path(__file__).resolve().parent.parent / "browser"
OUT.mkdir(parents=True, exist_ok=True)


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", bc.HTTP_PORT), bc.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    chrome_log = open(OUT / "import-reliability-chrome.log", "w")
    proc = subprocess.Popen([
        bc.CHROME, "--headless=new", "--no-sandbox", "--disable-gpu",
        "--disable-dev-shm-usage", "--remote-debugging-port=%d" % bc.CDP_PORT,
        "--remote-allow-origins=http://localhost:%d" % bc.CDP_PORT,
        "--user-data-dir=" + str(OUT / "import-reliability-profile"),
        "--no-first-run", "--no-default-browser-check", "about:blank"
    ], stdout=chrome_log, stderr=chrome_log)
    result = {}
    try:
        info = None
        for _ in range(100):
            try:
                info = json.load(urllib.request.urlopen(
                    "http://127.0.0.1:%d/json/version" % bc.CDP_PORT))
                break
            except Exception:
                time.sleep(0.1)
        if not info:
            raise RuntimeError("chrome did not start")
        browser = bc.CDP(info["webSocketDebuggerUrl"])
        context = browser.call("Target.createBrowserContext")["browserContextId"]
        target = browser.call("Target.createTarget", {
            "url": "about:blank", "browserContextId": context
        })["targetId"]
        session = browser.call("Target.attachToTarget", {
            "targetId": target, "flatten": True
        })["sessionId"]
        browser.call("Runtime.enable", {}, session)
        browser.call("Page.enable", {}, session)
        browser.call("Page.addScriptToEvaluateOnNewDocument", {"source": bc.IDB_PROBE}, session)
        browser.call("Page.navigate", {
            "url": "http://127.0.0.1:%d/import-reliability/index.html" % bc.HTTP_PORT
        }, session)
        time.sleep(1.5)
        result["ready"] = browser.evaluate(session, bc.READY)

        result["setup"] = browser.evaluate(session, r"""
(() => {
  window.__realFileReader = window.FileReader;
  window.__realStorageSave = window.__ATTENTION_INBOX__.storage.save;
  window.__toastHistory = [];
  new MutationObserver(() => {
    const text = document.querySelector('#toastText').textContent;
    if (text) window.__toastHistory.push(text);
  }).observe(document.querySelector('#toastText'), { childList: true, characterData: true, subtree: true });
  window.__dispatchImport = function (id) {
    const input = document.querySelector('#importFile');
    const now = Date.now();
    const payload = {
      app: 'attention-inbox', schema: 7,
      items: [{ id: id, title: id, status: 'due', createdAt: now, updatedAt: now, triggerAt: now - 1000 }],
      notes: [], projects: [], settings: { notify: false }
    };
    const file = new File([JSON.stringify(payload)], id + '.json', { type: 'application/json' });
    const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  return true;
})()
""")

        # G02-A: storage.save 挂住，确认后不能提前渲染/报成功。
        result["pendingSetup"] = browser.evaluate(session, r"""
(() => {
  window.__toastHistory = [];
  const storage = window.__ATTENTION_INBOX__.storage;
  storage.save = () => new Promise((resolve, reject) => {
    window.__resolveImportSave = resolve;
    window.__rejectImportSave = reject;
  });
  window.__dispatchImport('pending-import');
  return true;
})()
""")
        time.sleep(0.25)
        browser.evaluate(session, "document.querySelector('#confirmOk').click()")
        time.sleep(0.35)
        result["whilePending"] = browser.evaluate(session, r"""
(() => ({
  stateIds: window.__ATTENTION_INBOX__.state.items.map(x => x.id),
  toast: document.querySelector('#toastText').textContent,
  history: window.__toastHistory.slice(),
  homeText: document.querySelector('#homeDue').textContent + '|' +
    document.querySelector('#homeActive').textContent + '|' +
    document.querySelector('#homeEmpty').textContent
}))()
""")
        browser.evaluate(session, "window.__resolveImportSave()")
        time.sleep(0.35)
        result["afterResolve"] = browser.evaluate(session, r"""
(() => ({
  toast: document.querySelector('#toastText').textContent,
  history: window.__toastHistory.slice(),
  homeText: document.querySelector('#homeDue').textContent + '|' +
    document.querySelector('#homeActive').textContent + '|' +
    document.querySelector('#homeEmpty').textContent
}))()
""")

        # G02-B: 权威提交拒绝，不能出现成功或格式错误。
        result["rejectSetup"] = browser.evaluate(session, r"""
(() => {
  window.__toastHistory = [];
  window.__ATTENTION_INBOX__.storage.save = () => Promise.reject(new Error('independent-idb-failure'));
  window.__dispatchImport('rejected-import');
  return true;
})()
""")
        time.sleep(0.25)
        browser.evaluate(session, "document.querySelector('#confirmOk').click()")
        time.sleep(0.5)
        result["afterReject"] = browser.evaluate(session, r"""
(() => ({
  stateIds: window.__ATTENTION_INBOX__.state.items.map(x => x.id),
  toast: document.querySelector('#toastText').textContent,
  history: window.__toastHistory.slice(),
  confirmOpen: document.querySelector('#sheetConfirm').classList.contains('open')
}))()
""")

        # G01-A: FileReader error 止步读取层，不打开确认框。
        result["readerError"] = browser.evaluate(session, r"""
(async () => {
  window.__toastHistory = [];
  window.FileReader = class {
    readAsText() { queueMicrotask(() => { if (this.onerror) this.onerror(new Event('error')); }); }
  };
  window.__dispatchImport('reader-error');
  await new Promise(r => setTimeout(r, 80));
  return {
    toast: document.querySelector('#toastText').textContent,
    history: window.__toastHistory.slice(),
    confirmOpen: document.querySelector('#sheetConfirm').classList.contains('open'),
    stateIds: window.__ATTENTION_INBOX__.state.items.map(x => x.id)
  };
})()
""")

        # G01-B: FileReader abort 同样止步读取层。
        result["readerAbort"] = browser.evaluate(session, r"""
(async () => {
  window.__toastHistory = [];
  window.FileReader = class {
    readAsText() { queueMicrotask(() => { if (this.onabort) this.onabort(new Event('abort')); }); }
  };
  window.__dispatchImport('reader-abort');
  await new Promise(r => setTimeout(r, 80));
  return {
    toast: document.querySelector('#toastText').textContent,
    history: window.__toastHistory.slice(),
    confirmOpen: document.querySelector('#sheetConfirm').classList.contains('open'),
    stateIds: window.__ATTENTION_INBOX__.state.items.map(x => x.id)
  };
})()
""")

        # 恢复真实 FileReader/storage，跑一次真实提交并刷新验证。
        result["successSetup"] = browser.evaluate(session, r"""
(() => {
  window.FileReader = window.__realFileReader;
  window.__ATTENTION_INBOX__.storage.save = window.__realStorageSave;
  window.__toastHistory = [];
  window.__dispatchImport('durable-import');
  return true;
})()
""")
        time.sleep(0.25)
        browser.evaluate(session, "document.querySelector('#confirmOk').click()")
        time.sleep(1.0)
        result["afterSuccess"] = browser.evaluate(session, r"""
(() => ({
  stateIds: window.__ATTENTION_INBOX__.state.items.map(x => x.id),
  toast: document.querySelector('#toastText').textContent,
  history: window.__toastHistory.slice(),
  meter: window.__IDB_METER__
}))()
""")
        browser.call("Page.reload", {}, session)
        time.sleep(1.6)
        result["afterReload"] = browser.evaluate(session, r"""
(async () => {
  const app = window.__ATTENTION_INBOX__; await app.ready();
  return { stateIds: app.state.items.map(x => x.id) };
})()
""")

        pending_history = result["whilePending"].get("history", [])
        reject_history = result["afterReject"].get("history", [])
        rejected_ids = result["afterReject"].get("stateIds", [])
        checks = {
            "ready": result["ready"].get("ready") is True,
            "pending-mutates-memory": result["whilePending"].get("stateIds") == ["pending-import"],
            "pending-no-success": not any("导入成功" in x for x in pending_history),
            "pending-no-render": "pending-import" not in result["whilePending"].get("homeText", ""),
            "resolve-then-success": result["afterResolve"].get("toast") == "导入成功 · 1 条事项",
            "resolve-then-render": "pending-import" in result["afterResolve"].get("homeText", ""),
            "reject-keeps-memory": rejected_ids == ["rejected-import"],
            "reject-specific-final": result["afterReject"].get("toast") == "导入失败 · 数据未能保存，请重新导入",
            "reject-no-success": not any("导入成功" in x for x in reject_history),
            "reject-no-format-error": not any("文件格式不正确" in x for x in reject_history),
            "reader-error-message": result["readerError"].get("toast") == "导入失败：文件读取失败，请重试",
            "reader-error-no-confirm": result["readerError"].get("confirmOpen") is False,
            "reader-error-no-state-change": result["readerError"].get("stateIds") == ["rejected-import"],
            "reader-abort-message": result["readerAbort"].get("toast") == "导入失败 · 文件读取已取消",
            "reader-abort-no-confirm": result["readerAbort"].get("confirmOpen") is False,
            "reader-abort-no-state-change": result["readerAbort"].get("stateIds") == ["rejected-import"],
            "real-success": result["afterSuccess"].get("stateIds") == ["durable-import"] and
                            result["afterSuccess"].get("toast") == "导入成功 · 1 条事项",
            "real-idb-write": (result["afterSuccess"].get("meter") or {}).get("puts", 0) >= 1,
            "real-survives-reload": result["afterReload"].get("stateIds") == ["durable-import"],
        }
        result["checks"] = checks
        result["failed"] = [name for name, ok in checks.items() if not ok]
        browser.call("Target.disposeBrowserContext", {"browserContextId": context})
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        server.shutdown()
        chrome_log.close()
        (OUT / "browser-import-reliability.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result.get("failed") else 0


if __name__ == "__main__":
    raise SystemExit(main())
