#!/usr/bin/env python3
"""独立驱动真实 Chrome 的 File -> FileReader -> 确认 -> IDB 导入链。"""

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

bc.HTTP_PORT = 18773
bc.CDP_PORT = 18774
bc.STATE["block"] = None

OUT = pathlib.Path(__file__).resolve().parent.parent / "browser"
OUT.mkdir(parents=True, exist_ok=True)


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", bc.HTTP_PORT), bc.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    chrome_log = open(OUT / "import-chrome.log", "w")
    proc = subprocess.Popen([
        bc.CHROME, "--headless=new", "--no-sandbox", "--disable-gpu",
        "--disable-dev-shm-usage", "--remote-debugging-port=%d" % bc.CDP_PORT,
        "--remote-allow-origins=http://localhost:%d" % bc.CDP_PORT,
        "--user-data-dir=" + str(OUT / "import-browser-profile"),
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
            "url": "http://127.0.0.1:%d/import-live/index.html" % bc.HTTP_PORT
        }, session)
        time.sleep(1.5)
        result["ready"] = browser.evaluate(session, bc.READY)

        result["dispatch"] = browser.evaluate(session, r"""
(() => {
  const input = document.querySelector('#importFile');
  const now = Date.now();
  const payload = {
    app: 'attention-inbox', schema: 7,
    items: [{
      id: 'import-live-1', title: '浏览器真实导入', status: 'captured',
      createdAt: now, updatedAt: now, triggerAt: now + 3600000
    }],
    notes: [{ id: 'note-live-1', title: '导入笔记' }],
    projects: [{ id: 'project-live-1', name: '导入项目', color: 'blue' }],
    settings: { notify: false }
  };
  const file = new File([JSON.stringify(payload)], 'independent-backup.json',
    { type: 'application/json' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { files: input.files.length, valueCleared: input.value === '' };
})()
""")
        time.sleep(0.3)
        result["confirmation"] = browser.evaluate(session, r"""
(() => ({
  open: document.querySelector('#sheetConfirm').classList.contains('open'),
  title: document.querySelector('#confirmTitle').textContent,
  body: document.querySelector('#confirmBody').textContent
}))()
""")
        result["confirmClick"] = browser.evaluate(
            session, "(() => { document.querySelector('#confirmOk').click(); return true; })()")
        time.sleep(1.0)
        result["afterImport"] = browser.evaluate(session, r"""
(() => ({
  items: window.__ATTENTION_INBOX__.state.items.map(x => ({ id: x.id, title: x.title })),
  notes: window.__ATTENTION_INBOX__.state.notes.length,
  projects: window.__ATTENTION_INBOX__.state.projects.length,
  notify: window.__ATTENTION_INBOX__.state.settings.notify,
  toast: document.querySelector('#toastText').textContent,
  meter: window.__IDB_METER__
}))()
""")
        browser.call("Page.reload", {}, session)
        time.sleep(1.6)
        result["afterReload"] = browser.evaluate(session, r"""
(async () => {
  const app = window.__ATTENTION_INBOX__;
  await app.ready();
  return { items: app.state.items.map(x => ({ id: x.id, title: x.title })) };
})()
""")
        checks = {
            "ready": result["ready"].get("ready") is True,
            "file-dispatched": result["dispatch"].get("files") == 0 and result["dispatch"].get("valueCleared") is True,
            "confirmation-visible": result["confirmation"].get("open") is True,
            "imported-one-item": len(result["afterImport"].get("items", [])) == 1,
            "correct-title": result["afterImport"].get("items", [{}])[0].get("title") == "浏览器真实导入",
            "saved-to-idb": (result["afterImport"].get("meter") or {}).get("puts", 0) >= 1,
            "success-feedback": "导入成功" in result["afterImport"].get("toast", ""),
            "survives-reload": len(result["afterReload"].get("items", [])) == 1,
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
        (OUT / "browser-import.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result.get("failed") else 0


if __name__ == "__main__":
    raise SystemExit(main())
