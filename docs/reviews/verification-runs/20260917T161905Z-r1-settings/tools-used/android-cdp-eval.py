#!/usr/bin/env python3
"""在模拟器上对应用 WebView 求值任意 JS —— 后台投放实验的取证工具。

用法：
  adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
  python3 scripts/android-cdp-eval.py "表达式" [端口]

表达式可以是返回 Promise 的 IIFE（会 await）。
端口可选（默认 9222）—— 同时挂着真机与模拟器时必须指定不同端口，
否则两台设备的 forward 会互相顶掉，表现为「CDP 时通时不通」。
"""
import json
import os
import sys
import urllib.request

import websocket

# 沙箱里 *_PROXY 会把 127.0.0.1 也代理走，必须显式清掉
for _k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
    os.environ.pop(_k, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"


def connect(port=9222):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    targets = json.loads(
        opener.open("http://127.0.0.1:%d/json" % port, timeout=10).read().decode("utf-8")
    )
    page = next(t for t in targets if t.get("type") == "page")
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=60,
                                     suppress_origin=True)
    return ws


def main():
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 9222
    ws = connect(port)
    seq = 0

    def call(method, params=None):
        nonlocal seq
        seq += 1
        ws.send(json.dumps({"id": seq, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == seq:
                return msg

    call("Runtime.enable")
    r = call("Runtime.evaluate", {
        "expression": sys.argv[1],
        "returnByValue": True,
        "awaitPromise": True,
    })
    res = r.get("result", {})
    if "exceptionDetails" in res:
        print("EVAL_EXCEPTION:", json.dumps(res["exceptionDetails"], ensure_ascii=False)[:800])
        sys.exit(1)
    value = res.get("result", {}).get("value")
    print(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2))
    ws.close()


if __name__ == "__main__":
    main()
