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
    def call(s, method, params=None):
        s.i += 1
        s.w.send(json.dumps({"id": s.i, "method": method, "params": params or {}}))
        while True:
            r = json.loads(s.w.recv())
            if r.get("id") == s.i:
                if "error" in r:
                    raise RuntimeError(r["error"])
                return r.get("result", {})
    def e(s, x):
        result = s.call("Runtime.evaluate", {"expression": x, "awaitPromise": True, "returnByValue": True})
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"])
        return result.get("result", {}).get("value")

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
        const accessibleWhenShown = banner.getAttribute('role') === 'region' &&
          banner.getAttribute('aria-hidden') === 'false' && !banner.inert &&
          banner.getAttribute('aria-labelledby') === 'alertTitle' &&
          q('#alertBody').getAttribute('role') === 'status';

        // 2. Click dismiss "×"
        const btnClose = q('#alertClose');
        if (btnClose) btnClose.click();
        await new Promise(r => setTimeout(r, 50));

        const bannerClosed = banner && !banner.classList.contains('show');
        const skippedNow = alerts.shouldSkipAlert(testItem);
        const inaccessibleWhenHidden = banner.inert && banner.getAttribute('aria-hidden') === 'true';

        // Delete through the real command: authoritative commit, without waiting for a delivery tick.
        alerts.showAlert(testItem);
        const deleted = await a.items.deleteItem(testItem.id, { waitForSave: true });
        const deletedBannerClearedOnCommit = deleted !== false && !alerts.getAlertItem() &&
          !banner.classList.contains('show');
        await a.save();
        await a.loadAsync();
        const persistedDeleted = !a.state.items.some(it => it.id === testItem.id);
        const restored = a.items.undoLastDelete();
        await a.save();
        await a.loadAsync();
        const undoPreserved = restored !== false && a.state.items.some(it => it.id === testItem.id);

        const other = a.makeItem({ id: 'browser-alert-item-2', title: '其他事项', status: 'due' });
        a.state.items.push(other);
        alerts.showAlert(testItem);
        await a.items.deleteItem(other.id, { waitForSave: true });
        const unrelatedDeletePreservedBanner = alerts.getAlertItem()?.id === testItem.id &&
          banner.classList.contains('show');

        // Exercise the delegated UI route too: calling deleteItem directly skips it.
        const otherUi = a.makeItem({ id: 'browser-alert-ui-other', title: 'UI 删除其他事项',
          status: 'waiting', triggerAt: Date.now() + 86400000 });
        a.state.items.push(otherUi);
        a.views.openDetail(otherUi.id);
        alerts.showAlert(testItem);
        q('#sheetDetail [data-act="delete"][data-id="' + otherUi.id + '"]').click();
        await new Promise(r => setTimeout(r, 50));
        q('#confirmOk').click();
        await new Promise(r => setTimeout(r, 100));
        const unrelatedUiDeletePreservedBanner = !a.state.items.some(it => it.id === otherUi.id) &&
          alerts.getAlertItem()?.id === testItem.id && banner.classList.contains('show');

        a.views.openDetail(testItem.id);
        alerts.showAlert(testItem);
        q('#sheetDetail [data-act="delete"][data-id="' + testItem.id + '"]').click();
        await new Promise(r => setTimeout(r, 50));
        q('#confirmOk').click();
        await new Promise(r => setTimeout(r, 100));
        const ownUiDeleteClearedBanner = !a.state.items.some(it => it.id === testItem.id) &&
          !alerts.getAlertItem() && !banner.classList.contains('show');
        alerts.hideAlert();
        const priorFocus = q('#btnSearch');
        priorFocus.focus();
        alerts.showAlert(testItem);
        const showPreservesFocus = document.activeElement === priorFocus;
        q('#alertAck').focus();
        const shownButtonFocusable = document.activeElement === q('#alertAck');
        alerts.hideAlert();
        const hideRestoresFocus = document.activeElement === priorFocus;
        q('#alertAck').focus();
        const hiddenButtonNotFocusable = document.activeElement === priorFocus;

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
          accessibleWhenShown,
          inaccessibleWhenHidden,
          deletedBannerClearedOnCommit,
          persistedDeleted,
          undoPreserved,
          unrelatedDeletePreservedBanner,
          unrelatedUiDeletePreservedBanner,
          ownUiDeleteClearedBanner,
          showPreservesFocus,
          shownButtonFocusable,
          hideRestoresFocus,
          hiddenButtonNotFocusable,
          panelExists,
          panelVisible,
          panelRenderedCard,
          alarmDeliveryStopped
        };
      } catch (err) {
        return { error: err.stack || String(err) };
      }
    })()""")

    # Inspect the browser accessibility tree, beyond checking ARIA attributes.
    c.e("__ATTENTION_INBOX__.alerts.showAlert({id:'ax-only',title:'读屏提醒',priority:'normal'});true")
    shown_ax = c.call("Accessibility.getFullAXTree")
    dom = c.call("DOM.getDocument")
    banner_id = c.call("DOM.querySelector", {"nodeId": dom["root"]["nodeId"], "selector": "#alertBanner"})["nodeId"]
    banner_backend = c.call("DOM.describeNode", {"nodeId": banner_id})["node"]["backendNodeId"]
    nodes = {n["nodeId"]: n for n in shown_ax.get("nodes", [])}
    banner_ax = next((n for n in nodes.values() if n.get("backendDOMNodeId") == banner_backend), {})
    descendants, pending = [], [banner_ax]
    while pending:
        node = pending.pop()
        descendants.append(node)
        pending.extend(nodes[nid] for nid in node.get("childIds", []) if nid in nodes)
    names = [n.get("name", {}).get("value", "") for n in descendants
             if not n.get("ignored") and n.get("role", {}).get("value") == "button"]
    out["accessibilityButtonsExposed"] = all(any(label in name for name in names)
        for label in ("已知晓", "完成", "稍后提醒", "待整理"))
    c.e("__ATTENTION_INBOX__.alerts.clearAlert();true")
    hidden_ax = c.call("Accessibility.getFullAXTree")
    # The close button has a unique name, so cards with the same action text cannot mask a failure.
    out["hiddenAlertAbsentFromAccessibilityTree"] = not any(
        not n.get("ignored") and n.get("name", {}).get("value") == "关闭这次铃声（不代表已知晓或完成）"
        for n in hidden_ax.get("nodes", []))

    # Focusing/scrolling a sheet control must not scroll the entire app shell.
    # Overflow hidden still permits scrollIntoView to move that ancestor.
    layout_checks = []
    for width, height in ((360, 736), (390, 844), (768, 1024), (1280, 800)):
        c.call("Emulation.setDeviceMetricsOverride", {
            "width": width, "height": height, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(0.1)
        layout = c.e("""(async()=>{
          const q=s=>document.querySelector(s),app=q('#app'),main=q('.main');
          app.scrollTop=0;
          const content=document.createElement('div');content.style.height='1800px';
          main.append(content);main.scrollTop=160;const listScrolls=main.scrollTop>0;
          q('#fab').click();await new Promise(r=>setTimeout(r,350));
          const body=q('#sheetItem .sheet-body'),probe=document.createElement('div');
          probe.style.height='1000px';body.append(probe);body.scrollTop=120;
          const sheetScrolls=body.scrollTop>0;
          q('#btnSaveItem').scrollIntoView({block:'center'});
          q('#sheetItem [data-close="sheetItem"]').click();
          await new Promise(r=>setTimeout(r,350));
          const ar=app.getBoundingClientRect(),nr=q('#nav').getBoundingClientRect();
          const result={width:innerWidth,height:innerHeight,appScrollTop:app.scrollTop,
            rootScrollTop:document.scrollingElement.scrollTop,navBottom:nr.bottom,
            appBottom:ar.bottom,listScrolls,sheetScrolls,
            shellStable:app.scrollTop===0&&document.scrollingElement.scrollTop===0&&
              Math.abs(nr.bottom-ar.bottom)<2};
          probe.remove();content.remove();main.scrollTop=0;app.scrollTop=0;
          return result;
        })()""")
        layout_checks.append(layout)
    out["layoutChecks"] = layout_checks
    out["outerShellStaysFixed"] = all(
        x["shellStable"] and x["listScrolls"] and x["sheetScrolls"] for x in layout_checks)
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
        out.get("accessibleWhenShown") is True and
        out.get("inaccessibleWhenHidden") is True and
        out.get("deletedBannerClearedOnCommit") is True and
        out.get("persistedDeleted") is True and
        out.get("undoPreserved") is True and
        out.get("unrelatedDeletePreservedBanner") is True and
        out.get("unrelatedUiDeletePreservedBanner") is True and
        out.get("ownUiDeleteClearedBanner") is True and
        out.get("showPreservesFocus") is True and
        out.get("shownButtonFocusable") is True and
        out.get("hideRestoresFocus") is True and
        out.get("hiddenButtonNotFocusable") is True and
        out.get("accessibilityButtonsExposed") is True and
        out.get("hiddenAlertAbsentFromAccessibilityTree") is True and
        out.get("panelExists") is True and
        out.get("panelVisible") is True and
        out.get("panelRenderedCard") is True and
        out.get("alarmDeliveryStopped") is True
        and out.get("outerShellStaysFixed") is True
    )

    if not expected:
        print("ASSERTION FAILED: unexpected browser check output", file=sys.stderr)
        sys.exit(1)

    print("All browser alerts checks PASSED")

finally:
    p.kill()
    srv.shutdown()
