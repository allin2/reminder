#!/usr/bin/env python3
"""用 CDP 调试器在 `writeSnapshot` 的权威提交行下断点，取**启动期那次写入**的调用栈。

为什么要它：`Page.addScriptToEvaluateOnNewDocument` 注入的 IDB 钩子把写入者定位到
`writeSnapshot`（app-core.js:1251），但 `async` 边界会截断 `Error().stack`，
看不到上游调用者。调试器断点拿到的 `callFrames` 不受 async 边界影响。

用法：python scripts/verification/idb-write-caller.py [端口] [行号(1-based，默认1251)] [超时秒]
"""
import json
import os
import sys
import time
import urllib.request

import websocket

for _k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
    os.environ.pop(_k, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

SCRIPT_URL = "https://localhost/app-core.js"


def connect(port):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    targets = json.loads(opener.open("http://127.0.0.1:%d/json" % port, timeout=10).read().decode())
    page = next(t for t in targets if t.get("type") == "page")
    return websocket.create_connection(page["webSocketDebuggerUrl"], timeout=60, suppress_origin=True), page


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9223
    line_1based = int(sys.argv[2]) if len(sys.argv) > 2 else 1251
    timeout = float(sys.argv[3]) if len(sys.argv) > 3 else 25.0

    ws, page = connect(port)
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
    call("Debugger.enable")
    call("Debugger.setAsyncCallStackDepth", {"maxDepth": 32})
    call("Page.enable")
    bp = call("Debugger.setBreakpointByUrl", {
        "lineNumber": line_1based - 1,
        "url": SCRIPT_URL,
    })
    print("breakpoint:", json.dumps(bp.get("result")))
    print("reloading ...")
    call("Page.reload", {"ignoreCache": False})

    deadline = time.time() + timeout
    hits = 0
    while time.time() < deadline:
        ws.settimeout(2.0)
        try:
            msg = json.loads(ws.recv())
        except Exception:
            continue
        method = msg.get("method")
        if method == "Debugger.paused":
            hits += 1
            frames = msg["params"]["callFrames"]
            print("")
            print("=== 第 %d 次命中 writeSnapshot 提交行 —— 调用栈 ===" % hits)
            for i, f in enumerate(frames):
                loc = f["location"]
                print("  #%d %-28s %s:%d" % (
                    i, f.get("functionName") or "(anonymous)", loc.get("scriptId"), loc.get("lineNumber", -1) + 1))
                # 打印该帧里出现的局部变量里最像「触发源」的字符串
            # 异步父链：async 边界的上游调用者在这里
            node = msg["params"].get("asyncStackTrace")
            lvl = 0
            while node and lvl < 12:
                desc = node.get("description") or "(no description)"
                print("  ~async[%d] %s" % (lvl, desc))
                for f in (node.get("callFrames") or [])[:8]:
                    loc = f.get("location") or {}
                    print("      %-30s %s:%d" % (
                        f.get("functionName") or "(anonymous)",
                        (loc.get("url") or f.get("url") or "?"),
                        (loc.get("lineNumber", f.get("lineNumber", -1)) + 1)))
                node = node.get("parent")
                lvl += 1
            # 恢复执行，让启动继续
            wid = 0
            try:
                call("Debugger.resume")
            except Exception as e:
                print("resume 失败:", e)
            if hits >= 3:
                break
    if hits == 0:
        print("未命中（断点可能没生效，或该行在本次启动未被走到）")


if __name__ == "__main__":
    main()
