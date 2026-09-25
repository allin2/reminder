#!/usr/bin/env python3
"""只读：重读 diag（native 状态）与 Feedback.setupSteps 输出。"""
import os, time, json, subprocess, urllib.request

for k in ('HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy'):
    os.environ.pop(k, None)
os.environ['NO_PROXY'] = '*'; os.environ['no_proxy'] = '*'
import websocket

SERIAL = "10ACBF2D3D000RS"
PACKAGE = "space.alliswell.inbox"
ADB = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
RUN_ID = "20260925T153500Z-vivo-switch-matrix"
REPO_RUN = os.path.join("/Users/qlyf/Developer/reminder", "docs/reviews/verification-runs", RUN_ID)
ARCH_RUN = os.path.expanduser(f"~/Developer/reminder-archive/verification-runs/{RUN_ID}")
LOG_PATH = os.path.join(REPO_RUN, "run.log")
PORT = 53421

def adb_cmd(args):
    return subprocess.run([ADB, "-s", SERIAL] + args, capture_output=True, text=True).stdout.strip()

def log(msg):
    ms = adb_cmd(["shell", "date", "+%s%3N"])
    from datetime import datetime
    try: ms_i = int(ms)
    except: ms_i = int(time.time()*1000)
    line = f"[{datetime.fromtimestamp(ms_i/1000.0).strftime('%Y-%m-%d %H:%M:%S')}] [{ms_i}] [RESUME-INSPECT3] {msg}"
    print(line, flush=True)
    for p in (LOG_PATH, os.path.join(ARCH_RUN, "run.log")):
        with open(p, "a", encoding="utf-8") as f: f.write(line + "\n")

def cdp_eval(expr):
    pid = adb_cmd(["shell", "pidof", PACKAGE])
    subprocess.run([ADB, "-s", SERIAL, "forward", f"tcp:{PORT}", f"localabstract:webview_devtools_remote_{pid}"], capture_output=True)
    time.sleep(0.4)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    targets = json.loads(opener.open(f"http://127.0.0.1:{PORT}/json", timeout=5).read().decode())
    page = next(t for t in targets if t.get('type') == 'page')
    ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=30, suppress_origin=True)
    ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
        "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == 1:
            ws.close(); break
    res = msg.get("result", {})
    if "exceptionDetails" in res: raise RuntimeError(str(res["exceptionDetails"]))
    return res.get("result", {}).get("value")

def main():
    log("=== resume: diag + setupSteps re-read start ===")
    val = cdp_eval("""(async () => {
      const I = window.__ATTENTION_INBOX__;
      const F = window.AttentionLib && window.AttentionLib.Feedback;
      let diag = null;
      try {
        const st = (typeof I.getNativeReminderStatus === 'function') ? I.getNativeReminderStatus() : null;
        diag = st && st.diag ? st.diag : (st ? Object.assign({__top: st}, {}) : null);
        diag = { nativeStatus: st };
      } catch (e) { diag = 'DIAG_ERR ' + e; }
      let steps = null;
      try {
        const native = (typeof I.getNativeReminderStatus === 'function') ? I.getNativeReminderStatus() : null;
        steps = F ? F.setupSteps(native, I.setupStepsContext()) : 'NO_FEEDBACK';
      } catch (e) { steps = 'STEPS_ERR ' + e; }
      let homeCard = null;
      try { const el = document.querySelector('#homeSetup'); homeCard = el ? el.innerHTML : ''; } catch (e) {}
      return { diag, steps, homeCard };
    })()""")
    log(f"diag={json.dumps(val.get('diag'), ensure_ascii=False)}")
    log(f"steps={json.dumps(val.get('steps'), ensure_ascii=False)}")
    log(f"homeCard={json.dumps(val.get('homeCard'), ensure_ascii=False)[:600]}")
    log("=== resume: diag + setupSteps re-read end ===")

if __name__ == '__main__':
    main()
