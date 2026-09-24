#!/usr/bin/env python3
"""读取设备 WebView 上 IndexedDB kv/state 的原始 JSON 字符串哈希（不经应用内存态）。

用法：python scripts/idb-state-hash.py [端口]
输出：IDB_STATE_SHA256=<前16位> BYTES=<长度> ITEMS=<n>
"""
import json
import os
import sys
import urllib.request

import websocket

for _k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
    os.environ.pop(_k, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

JS = """(async () => {
  const L = window.AttentionLib;
  const db = await new Promise((res, rej) => {
    const rq = indexedDB.open(L.DB_NAME);
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
  const rec = await new Promise((res, rej) => {
    const tx = db.transaction(L.STORE, 'readonly');
    const rq = tx.objectStore(L.STORE).get(L.STATE_KEY);
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
  db.close();
  const value = (rec && rec.value !== undefined) ? rec.value : rec;
  const text = JSON.stringify(value);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return JSON.stringify({ sha: hex, bytes: text.length, raw: text });
})()"""


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9223
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    targets = json.loads(opener.open("http://127.0.0.1:%d/json" % port, timeout=10).read().decode())
    page = next(t for t in targets if t.get("type") == "page")
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=60, suppress_origin=True)
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
    r = call("Runtime.evaluate", {"expression": JS, "returnByValue": True, "awaitPromise": True})
    value = json.loads(r["result"]["result"]["value"])
    ws.close()
    print("IDB_STATE_SHA256=%s" % value["sha"][:16])
    print("IDB_STATE_FULL_SHA256=%s" % value["sha"])
    print("BYTES=%d" % value["bytes"])
    # 原始字节另存，供逐字节 diff
    out = os.environ.get("IDB_RAW_OUT")
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write(value["raw"])


if __name__ == "__main__":
    main()
