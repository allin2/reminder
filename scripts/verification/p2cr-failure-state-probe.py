#!/usr/bin/env python3
"""P2-C-R2：读取「权威存储打不开」时的应用判定（fail-closed 取证），并**真的试写一次**。

为什么不能只看状态：本轮要证的是一句行为 —— 「读不到权威时不许写」。
判定要读 `stateAuthority()`（status / writesAllowed / blockedWriteCount / recoveryPanel），
而「不许写」必须用一次**真的保存尝试**去顶：调用 `saveAsync()`，
期望它抛 `state-authority-blocked`，且 `blockedWriteCount` 从 N 变成 N+1。
顺带核一件事：这种状态下**不许生成待回放凭据**（`*-pending-replay`），
它是「下次启动无条件覆盖权威」的授权书，镜像兜底出来的状态绝不能持有它。

用法：python scripts/verification/p2cr-failure-state-probe.py [端口]
输出：FAILED_STATE={...} 一行 JSON（含 before / writeAttempt / after / pendingReplayKey）
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
  const A = window.__ATTENTION_INBOX__;
  if (!A) return JSON.stringify({ error: 'NO_INSTANCE' });
  const snap = async () => {
    const sa = A.stateAuthority();
    let mir16 = 'absent';
    const mir = localStorage.getItem('attention-inbox-v2') || '';
    if (mir) {
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(mir));
      mir16 = [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
    }
    // 待回放凭据（「下次启动无条件覆盖权威」的授权书）在不在
    let pending = null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('-pending-replay') >= 0) pending = { key: k, len: (localStorage.getItem(k) || '').length };
    }
    const panel = document.getElementById('state-authority-recovery');
    return {
      status: sa.status,
      reason: sa.report && sa.report.reason,
      backend: sa.report && sa.report.backend,
      writesAllowed: sa.writesAllowed,
      blockedWriteCount: sa.blockedWriteCount,
      nativeBlocked: sa.nativeBlocked,
      recoveryPanel: sa.recoveryPanel,
      panelPresent: !!panel,
      panelHidden: panel ? !!panel.hidden : null,
      panelText: panel ? (panel.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200) : null,
      items: A.state.items.length,
      projects: A.state.projects.length,
      title: A.state.items[0] ? A.state.items[0].title : null,
      mirrorLen: mir.length,
      mirrorSha16: mir16,
      pendingReplay: pending,
      storageBackend: A.storage ? A.storage.backend : null
    };
  };

  const before = await snap();
  let writeAttempt = null;
  try {
    await A.saveAsync();
    writeAttempt = { threw: false };
  } catch (e) {
    writeAttempt = { threw: true, name: e && e.name, message: e && e.message };
  }
  const after = await snap();
  return JSON.stringify({ before, writeAttempt, after, pendingReplayKey: before.pendingReplay });
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
    ws.close()
    res = r.get("result", {}).get("result", {})
    if "value" not in res:
        print("PROBE_ERROR=%s" % json.dumps(r)[:600])
        return 1
    print("FAILED_STATE=%s" % res["value"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
