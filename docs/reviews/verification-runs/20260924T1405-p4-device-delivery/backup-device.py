#!/usr/bin/env python3
import os
import subprocess
import json
import urllib.request
import websocket
from pathlib import Path

for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
    os.environ.pop(k, None)

ADB = "/Users/qlyf/Library/Android/sdk/platform-tools/adb"
SERIAL = "10ACBF2D3D000RS"
PKG = "space.alliswell.inbox"

rc, pid_out = subprocess.getstatusoutput(f"{ADB} -s {SERIAL} shell pidof {PKG}")
pid = pid_out.split()[0]
rc, port_out = subprocess.getstatusoutput(f"{ADB} -s {SERIAL} forward tcp:0 localabstract:webview_devtools_remote_{pid}")
port = int(port_out.strip())

try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    targets = json.loads(opener.open(f"http://127.0.0.1:{port}/json", timeout=10).read().decode())
    page = next(t for t in targets if t.get("type") == "page")
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=20, suppress_origin=True)
    
    msg = {
        "id": 1,
        "method": "Runtime.evaluate",
        "params": {
            "expression": """(async () => {
                const A = window.__ATTENTION_INBOX__;
                const mirror = localStorage.getItem("attention-inbox-v2") || "";
                return {
                    mirror: mirror,
                    items: A ? A.state.items : [],
                    projects: A ? A.state.projects : [],
                    settings: A ? A.state.settings : {}
                };
            })()""",
            "returnByValue": True,
            "awaitPromise": True
        }
    }
    ws.send(json.dumps(msg))
    resp = json.loads(ws.recv())
    val = resp["result"]["result"]["value"]
    
    out_file = Path("docs/reviews/verification-runs/20260924T1405-p4-device-delivery/pre-install-device-backup.json")
    out_file.write_text(json.dumps(val, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Pre-install backup saved to {out_file}, mirror length={len(val.get('mirror', ''))}")
    ws.close()
finally:
    subprocess.run([ADB, "-s", SERIAL, "forward", "--remove", f"tcp:{port}"])
