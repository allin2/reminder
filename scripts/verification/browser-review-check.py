#!/usr/bin/env python3
"""Disposable production-page P3-F review check; uses a fresh Chrome profile."""
import http.server, json, os, pathlib, subprocess, tempfile, threading, time, urllib.request, websocket

for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
    os.environ.pop(k, None)

ROOT = pathlib.Path(__file__).resolve().parents[2]
PORT, CDP = 18997, 18998
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
        await new Promise(r => setTimeout(r, 200));
        const completed = !!q('#reviewFoot [data-close="sheetReview"]');
        const doneBtn = q('#reviewFoot [data-close="sheetReview"]');
        if (doneBtn) doneBtn.click();
        await new Promise(r => setTimeout(r, 100));
        const sheetClosedByDone = !q('#sheetReview').classList.contains('open');

        // 6. Test IDB save failure prevents advancing, keeps retryable
        const faultItem = a.makeItem({id:'review-save-fault-probe',title:'保存故障探针',status:'waiting',review_status:'NEEDS_REVIEW',triggerAt:Date.now()+86400000});
        a.state.items = [faultItem];
        a.openReviewSession();
        await a.saveAsync();
        const originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function() { throw new Error('p3f-forced-idb-failure'); };
        const faultConfirm = q('#reviewConfirm');
        if (faultConfirm) faultConfirm.click();
        await new Promise(r => setTimeout(r, 350));
        const reviewIndexAfterFault = a.state.ui.reviewIndex;
        const completedAfterFault = !!q('#reviewFoot [data-close="sheetReview"]');
        const cardHasConfirm = !!q('#reviewConfirm');
        IDBObjectStore.prototype.put = originalPut;
        const persistedDuringFault = await new Promise((resolve,reject) => {
          const req = indexedDB.open('attention-inbox',1);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => { const tx=req.result.transaction('kv','readonly'); const g=tx.objectStore('kv').get('state'); g.onsuccess=()=>resolve(g.result); g.onerror=()=>reject(g.error); };
        });
        const persistedStatusDuringFault = persistedDuringFault?.items?.find(x => x.id === 'review-save-fault-probe')?.review_status;

        // 7. Retry after restoring IDB
        const retryConfirm = q('#reviewConfirm');
        if (retryConfirm) retryConfirm.click();
        await new Promise(r => setTimeout(r, 250));
        const reviewIndexAfterRetry = a.state.ui.reviewIndex;
        const completedAfterRetry = !!q('#reviewFoot [data-close="sheetReview"]');
        const doneBtn2 = q('#reviewFoot [data-close="sheetReview"]');
        if (doneBtn2) doneBtn2.click();

        return {
            ready: true,
            hasContract,
            entryRendered,
            sheetOpen,
            cardTitleMatched: cardTitle === '需要确认的备忘',
            scheduleOpen,
            scheduleClosed,
            completed,
            sheetClosedByDone,
            reviewIndexAfterFault,
            completedAfterFault,
            cardHasConfirm,
            persistedStatusDuringFault,
            reviewIndexAfterRetry,
            completedAfterRetry
        };
      } catch (err) {
        return { error: err.stack || String(err) };
      }
    })()""")
    print("Initial check:", json.dumps(out, ensure_ascii=False))

    c.e("location.reload();true")
    time.sleep(1.0)
    after = c.e("""(async()=>{
      const a = window.__ATTENTION_INBOX__;
      await a.ready();
      const it = a.state.items.find(x => x.id === 'review-save-fault-probe');
      return {
        ready: true,
        reloadedStatus: it ? it.review_status : null
      };
    })()""")
    print("After reload:", json.dumps(after, ensure_ascii=False))

    expected_checks = (
        out.get("ready") is True and
        out.get("hasContract") is True and
        out.get("entryRendered") is True and
        out.get("sheetOpen") is True and
        out.get("cardTitleMatched") is True and
        out.get("scheduleOpen") is True and
        out.get("scheduleClosed") is True and
        out.get("completed") is True and
        out.get("sheetClosedByDone") is True and
        out.get("reviewIndexAfterFault") == 0 and
        out.get("completedAfterFault") is False and
        out.get("cardHasConfirm") is True and
        out.get("persistedStatusDuringFault") == "NEEDS_REVIEW" and
        out.get("reviewIndexAfterRetry") == 1 and
        out.get("completedAfterRetry") is True and
        after.get("ready") is True and
        after.get("reloadedStatus") == "REVIEWED"
    )
    if not expected_checks:
        print("ASSERTION FAILED")
        raise SystemExit(1)
    print("All browser review checks PASSED")
finally:
    p.terminate()
    srv.shutdown()
