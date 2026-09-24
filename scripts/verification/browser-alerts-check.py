#!/usr/bin/env python3
"""Disposable production-page P3-G alerts check; uses a fresh Chrome profile."""
import http.server, json, os, pathlib, subprocess, sys, tempfile, threading, time, urllib.request, websocket

for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
    os.environ.pop(k, None)

ROOT = pathlib.Path(__file__).resolve().parents[2]
PORT, CDP = 18995, 18996
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
    f"--user-data-dir={tempfile.mkdtemp(prefix='alerts-')}",
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
        await a.ready();

        const alerts = a.alerts;
        const hasAlerts = !!alerts;
        const contract = (a.APP_ALERTS_INSTANCE_CONTRACT && a.APP_ALERTS_INSTANCE_CONTRACT.instance) || [];
        const hasAllContract = contract.every(m => typeof alerts[m] === "function");

        // 1. Show critical alert
        const testItem = {
          id: 'browser-alert-item-1',
          title: '重要火警演习',
          note: '请在十分钟内疏散',
          priority: 'critical',
          status: 'due',
          triggerAt: Date.now()
        };
        a.state.items.push(testItem);
        alerts.showAlert(testItem);
        await new Promise(r => setTimeout(r, 50));

        const banner = q('#alertBanner');
        const bannerShown = banner && banner.classList.contains('show');
        const bannerCrit = banner && banner.classList.contains('crit');
        const titleText = q('#alertTitle') ? q('#alertTitle').textContent : '';
        const bodyText = q('#alertBody') ? q('#alertBody').textContent : '';

        // 2. Click dismiss "×"
        const btnClose = q('#alertClose');
        if (btnClose) btnClose.click();
        await new Promise(r => setTimeout(r, 50));

        const bannerClosed = banner && !banner.classList.contains('show');
        const skippedNow = alerts.shouldSkipAlert(testItem);

        // 3. Active alarm panel: inject mock bridge to verify card render and stop interaction
        window.Capacitor = window.Capacitor || { Plugins: {} };
        window.Capacitor.Plugins = window.Capacitor.Plugins || {};
        const stoppedAlarms = [];
        window.Capacitor.Plugins.SystemBridge = {
          activeAlarmDeliveries: async () => ({
            alarms: [
              { id: 'active-1', token: 'tok-1', itemId: 'alarm-item-1', itemRev: 1, title: '全屏闹钟声振中' }
            ]
          }),
          stopAlarmDelivery: async (alarm) => {
            stoppedAlarms.push(alarm);
            return { ok: true };
          }
        };

        const activeAlarmPanel = q('#activeAlarmPanel');
        const panelExists = !!activeAlarmPanel;

        await alerts.refreshActiveAlarmPanel();
        await new Promise(r => setTimeout(r, 50));

        const panelVisible = activeAlarmPanel && !activeAlarmPanel.hidden;
        const panelRenderedCard = activeAlarmPanel && activeAlarmPanel.innerHTML.includes('全屏闹钟声振中');

        // Click stop button on active alarm card
        const btnStop = activeAlarmPanel ? activeAlarmPanel.querySelector('[data-alarm-stop]') : null;
        if (btnStop) btnStop.click();
        await new Promise(r => setTimeout(r, 50));

        const alarmDeliveryStopped = stoppedAlarms.length === 1 && stoppedAlarms[0].token === 'tok-1';

        // Clear mock and reset
        alerts.clearAlert();

        return {
          ready: true,
          hasAlerts,
          hasAllContract,
          contractLength: contract.length,
          bannerShown,
          bannerCrit,
          titleText,
          bodyText,
          bannerClosed,
          skippedNow,
          panelExists,
          panelVisible,
          panelRenderedCard,
          alarmDeliveryStopped
        };
      } catch (err) {
        return { error: err.stack || String(err) };
      }
    })()""")

    print(json.dumps(out, ensure_ascii=False))

    expected = (
        isinstance(out, dict) and
        out.get("ready") is True and
        out.get("hasAlerts") is True and
        out.get("hasAllContract") is True and
        out.get("contractLength") == 17 and
        out.get("bannerShown") is True and
        out.get("bannerCrit") is True and
        out.get("titleText") == "🚨 关键提醒" and
        "重要火警演习" in out.get("bodyText", "") and
        out.get("bannerClosed") is True and
        out.get("skippedNow") is True and
        out.get("panelExists") is True and
        out.get("panelVisible") is True and
        out.get("panelRenderedCard") is True and
        out.get("alarmDeliveryStopped") is True
    )

    if not expected:
        print("ASSERTION FAILED: unexpected browser check output", file=sys.stderr)
        sys.exit(1)

    print("All browser alerts checks PASSED")

finally:
    p.kill()
    srv.shutdown()
