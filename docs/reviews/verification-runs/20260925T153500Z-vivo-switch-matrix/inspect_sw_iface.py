#!/usr/bin/env python3
"""只读：确认 SW 缓存版本（v48 判据）、__ATTENTION_INBOX__ 接口面、diag 路径。"""
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
    line = f"[{datetime.fromtimestamp(ms_i/1000.0).strftime('%Y-%m-%d %H:%M:%S')}] [{ms_i}] [RESUME-INSPECT2] {msg}"
    print(line, flush=True)
    for p in (LOG_PATH, os.path.join(ARCH_RUN, "run.log")):
        with open(p, "a", encoding="utf-8") as f: f.write(line + "\n")

def cdp_eval_all(expr):
    """在所有 page targets 上求值，返回 [(target_url, value)]"""
    pid = adb_cmd(["shell", "pidof", PACKAGE])
    subprocess.run([ADB, "-s", SERIAL, "forward", f"tcp:{PORT}", f"localabstract:webview_devtools_remote_{pid}"], capture_output=True)
    time.sleep(0.4)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    targets = json.loads(opener.open(f"http://127.0.0.1:{PORT}/json", timeout=5).read().decode())
    out = []
    for t in targets:
        if t.get('type') != 'page': continue
        try:
            ws = websocket.create_connection(t['webSocketDebuggerUrl'], timeout=15, suppress_origin=True)
            ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == 1:
                    ws.close(); break
            r = msg.get("result", {}).get("result", {}).get("value")
            out.append((t.get('url'), r))
        except Exception as e:
            out.append((t.get('url'), f"ERR {e}"))
    return out

EXPR = """(async () => {
  const inbox = window.__ATTENTION_INBOX__;
  return {
    href: location.href,
    ua: navigator.userAgent.slice(0, 80),
    inboxKeys: inbox ? Object.keys(inbox) : null,
    hasAttentionLib: typeof window.AttentionLib !== 'undefined' ? Object.keys(window.AttentionLib) : null,
    hasFeedbackGlobal: typeof Feedback !== 'undefined',
    caches: caches.keys ? await caches.keys() : 'no-caches-api',
    swRegs: navigator.serviceWorker && navigator.serviceWorker.getRegistrations
      ? (await navigator.serviceWorker.getRegistrations()).map(r => r.scope + ' active=' + !!r.active)
      : 'no-sw',
    swController: navigator.serviceWorker && navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null
  };
})()"""

def main():
    log("=== resume: SW/version/interface inspection start ===")
    for url, val in cdp_eval_all(EXPR):
        log(f"target={url} => {json.dumps(val, ensure_ascii=False)}")
    log("=== resume: SW/version/interface inspection end ===")

if __name__ == '__main__':
    main()
