#!/usr/bin/env python3
"""Disposable production-page P3-F review check; uses a fresh Chrome profile."""
import http.server, json, os, pathlib, subprocess, tempfile, threading, time, urllib.request, websocket

for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
    os.environ.pop(k, None)

ROOT = pathlib.Path(os.environ.get('REVIEW_ROOT', str(pathlib.Path(__file__).resolve().parents[4])))
PORT, CDP = 19007, 19008
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass
    def do_GET(self):
        p = ROOT / (self.path.split("?", 1)[0].lstrip("/") or "index.html")
        if not p.is_file() or p.name == "sw.js":
            self.send_error(404)
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(p.read_bytes())

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
                return r.get("result", {}).get("result", {}).get("value")

srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
p = subprocess.Popen([
    CHROME,
    "--headless=new",
    f"--user-data-dir={tempfile.mkdtemp(prefix='review-')}",
    f"--remote-debugging-port={CDP}",
    "--remote-allow-origins=*",
    "--no-first-run",
    "about:blank"
], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

try:
    for _ in range(100):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP}/json"))
            break
        except Exception:
            time.sleep(0.1)
    c = C(next(t for t in tabs if t.get("type") == "page")["webSocketDebuggerUrl"])
    c.e(f"location.href='http://127.0.0.1:{PORT}/index.html';true")
    time.sleep(1.2)
    out = c.e("""(async () => {
      try {
        const a = window.__ATTENTION_INBOX__;
        const q = s => document.querySelector(s);
        const fire = (e, n) => e.dispatchEvent(new Event(n, { bubbles: true }));
        await a.ready();

        const surface = a.reviewSurface;
        const hasContract = surface && surface.hasEnsureSettings && surface.hasOpenReviewSession && surface.hasRenderReviewEntry;

        // 1. Inject an item that needs review
        const item = {
            id: 'browser-review-item-1',
            title: '需要确认的备忘',
            note: '详细说明',
            review_status: 'NEEDS_REVIEW',
            status: 'waiting',
            isFallbackTrigger: true,
            triggerAt: 0,
            createdAt: Date.now()
        };
        a.state.items.push(item);
        a.renderHome();
        await new Promise(r => setTimeout(r, 50));

        const entryRendered = !!q('#openReview');

        // 2. Click #openReview to open review sheet
        if (q('#openReview')) q('#openReview').click();
        await new Promise(r => setTimeout(r, 50));
        const sheetOpen = q('#sheetReview').classList.contains('open');
        const cardTitle = q('#reviewTitle') ? q('#reviewTitle').value : '';

        // 3. Keep current item
        if (q('#reviewKeep')) q('#reviewKeep').click();
        await new Promise(r => setTimeout(r, 50));

        // 4. Open review settings sheet
        const btnSettings = q('#btnReviewSettings');
        if (btnSettings) btnSettings.click();
        await new Promise(r => setTimeout(r, 50));
        const scheduleOpen = q('#sheetReviewSchedule').classList.contains('open');

        // 5. Save review settings
        const btnSave = q('#btnSaveReviewSchedule');
        if (btnSave) btnSave.click();
        await new Promise(r => setTimeout(r, 50));
        const scheduleClosed = !q('#sheetReviewSchedule').classList.contains('open');

        const doneItem = a.makeItem({id:'review-done-probe',title:'完成按钮探针',status:'waiting',review_status:'NEEDS_REVIEW',triggerAt:Date.now()+86400000});
        a.state.items = [doneItem];
        a.openReviewSession();
        const confirmBtn = q('#reviewConfirm');
        if (confirmBtn) confirmBtn.click();
        await new Promise(r => setTimeout(r, 300));
        const completed = !!q('#reviewFoot [data-close="sheetReview"]');
        const doneBtn = q('#reviewFoot [data-close="sheetReview"]');
        if (doneBtn) doneBtn.click();
        const remainedOpen = q('#sheetReview').classList.contains('open');
        return {
            completed, remainedOpen,
            ready: true,
            hasContract,
            entryRendered,
            sheetOpen,
            cardTitleMatched: cardTitle === '需要确认的备忘',
            scheduleOpen,
            scheduleClosed
        };
      } catch (err) {
        return { error: err.stack || String(err) };
      }
    })()""")
    print(json.dumps(out, ensure_ascii=False))
    if not out or not out.get("completed") or not out.get("remainedOpen"):
        raise SystemExit(1)
finally:
    p.terminate()
    srv.shutdown()
