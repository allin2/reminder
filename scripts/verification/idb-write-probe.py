#!/usr/bin/env python3
"""抓「启动期写入 IndexedDB」的调用栈。

背景：P2-C-R 真机观察到**每次冷启动 leveldb WAL 都增长 3276 B（=2×状态 JSON 长度）**，
而记录级哈希不变 —— 即启动路径上存在一次「写回同值」的写入。
不查清归属就无法判断它是不是旧版「空快照覆盖」的机理面。

做法：用 `Page.addScriptToEvaluateOnNewDocument` 在**页面脚本求值之前**把
`IDBObjectStore.prototype.put/delete/clear` 包一层，然后 `Page.reload`。
重载后应用会重新走一遍启动路径（loadAsync → startBusinessStartup），
钩子记录下每次写入的 store/key/长度与**调用栈**，从而指认写入者。

用法：python scripts/verification/idb-write-probe.py [端口]
输出：逐条写入记录（含栈顶若干帧）+ 应用侧的 stateAuthority 判定
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

HOOK = r"""
(() => {
  window.__idbLog = [];
  const rec = (op, store, key, len, extra) => {
    let trace = '';
    try { throw new Error('trace'); } catch (e) {
      trace = String(e.stack || '').split('\n').slice(1, 26).join('\n');
    }
    window.__idbLog.push({ op, store, key, len, at: Date.now(), trace, extra: extra || null });
  };
  const proto = IDBObjectStore.prototype;
  const op = proto.put;
  proto.put = function (value, key) {
    let len = -1;
    try { len = JSON.stringify(value === undefined ? null : value).length; } catch (e) { len = -2; }
    rec('put', this.name, key === undefined ? null : String(key), len,
        { keys: Object.keys(value || {}).slice(0, 8) });
    return op.apply(this, arguments);
  };
  const od = proto.delete;
  proto.delete = function (key) { rec('delete', this.name, String(key), 0, null); return od.apply(this, arguments); };
  const oc = proto.clear;
  proto.clear = function () { rec('clear', this.name, null, 0, null); return oc.apply(this, arguments); };
})();
"""


def connect(port):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    targets = json.loads(opener.open("http://127.0.0.1:%d/json" % port, timeout=10).read().decode())
    page = next(t for t in targets if t.get("type") == "page")
    return websocket.create_connection(page["webSocketDebuggerUrl"], timeout=60, suppress_origin=True), page


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9223
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
    call("Page.enable")
    r = call("Page.addScriptToEvaluateOnNewDocument", {"source": HOOK})
    print("addScriptToEvaluateOnNewDocument ->", json.dumps(r.get("result")))
    print("reloading page ...")
    try:
        call("Page.reload", {"ignoreCache": False})
    except Exception as e:
        print("reload 期间连接中断（预期：目标可能换掉）:", e)

    # 重载后页面会重建，等应用启动完成
    for attempt in range(20):
        time.sleep(1)
        try:
            ws, page = connect(port)
            seq2 = [0]

            def call2(method, params=None):
                seq2[0] += 1
                ws.send(json.dumps({"id": seq2[0], "method": method, "params": params or {}}))
                while True:
                    msg = json.loads(ws.recv())
                    if msg.get("id") == seq2[0]:
                        return msg

            call2("Runtime.enable")
            res = call2("Runtime.evaluate", {
                "expression": "(() => { const A = window.__ATTENTION_INBOX__; if (!A) return 'NOT_READY'; "
                              "return JSON.stringify({ log: window.__idbLog || null, "
                              "authority: A.stateAuthority ? A.stateAuthority() : null, "
                              "items: A.state.items.length }); })()",
                "returnByValue": True})
            val = res["result"]["result"].get("value")
            if val and val != "NOT_READY":
                data = json.loads(val)
                logs = data.get("log")
                print("")
                print("=== 启动期 IDB 写入记录：%d 条 ===" % (len(logs) if logs is not None else -1))
                if logs is None:
                    print("（钩子未生效 —— 需要在 reload 之前注入，或页面未重载）")
                for i, e in enumerate(logs or []):
                    print("[%d] %s store=%s key=%s len=%s keys=%s" % (
                        i, e.get("op"), e.get("store"), e.get("key"), e.get("len"),
                        e.get("extra", {}).get("keys") if e.get("extra") else None))
                    for line in (e.get("trace") or "").split("\n")[:22]:
                        print("      " + line.strip())
                    print("")
                print("=== 应用侧判定 ===")
                print(json.dumps(data.get("authority"), ensure_ascii=False))
                print("items =", data.get("items"))
                return
        except Exception as e:
            if attempt == 19:
                print("读取失败:", e)
    print("超时：未能在重载后读到钩子结果")


if __name__ == "__main__":
    main()
