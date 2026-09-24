"""R3 (F2): 冷启动时的设置卡片。
前提：settings.setupPromptStarted === true。
执行 run-as space.alliswell.inbox kill -9 <pid> 杀掉进程（不用 force-stop），然后 am start 冷启动。
从 CDP 能连上开始，每 100 ms 采样一次 #homeSetup.innerHTML 与 getNativeReminderStatus().notifications，持续 10 秒，重复 3 轮。
通过：
1. 只要 notifications 为 "unknown"，#homeSetup 就为空；
2. 任何一次采样都不出现「允许发通知」（通知已授权）；
3. 状态读回后卡片出现，文字中的步数与 R2 一致（还差 2 步）。
"""
import json
import time
from devlib import *

log("== R3 (F2): Cold start setup card sampling (3 rounds)")

# Confirm premise
start_app()
wait_ready()
started = cdp_eval("!!(__ATTENTION_INBOX__.state.settings && __ATTENTION_INBOX__.state.settings.setupPromptStarted)")
log(f"Premise check: settings.setupPromptStarted = {started}")
assert started is True, "setupPromptStarted must be true before running R3"

SAMPLE_JS = """(() => {
  const host = document.querySelector('#homeSetup');
  const hasApi = typeof __ATTENTION_INBOX__ !== 'undefined' && typeof __ATTENTION_INBOX__.getNativeReminderStatus === 'function';
  const st = hasApi ? __ATTENTION_INBOX__.getNativeReminderStatus() : null;
  return {
    hasApi: hasApi,
    notifications: st ? st.notifications : 'no_api',
    html: host ? host.innerHTML : '',
    text: host ? host.innerText : ''
  };
})()"""

rounds_data = []

for round_idx in range(1, 4):
    log(f"--- Starting Round {round_idx}/3 ---")
    kill_app()
    time.sleep(1)
    
    t0 = time.time()
    # am start
    sh(f"am start -n {MAIN}")
    
    # Wait for pid and connect CDP
    p = None
    for _ in range(30):
        p = pid()
        if p:
            break
        time.sleep(0.1)
    assert p, "Failed to get app pid after cold start"
    
    # Connect websocket via port forward
    rc, port, err = adb("forward", "tcp:0", f"localabstract:webview_devtools_remote_{p}")
    port = int(port)
    ws = None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    connect_deadline = time.time() + 15
    page = None
    while time.time() < connect_deadline:
        try:
            targets = json.loads(opener.open(f"http://127.0.0.1:{port}/json", timeout=2).read().decode())
            page = next((t for t in targets if t.get("type") == "page"), None)
            if page:
                break
        except Exception:
            pass
        time.sleep(0.1)
    assert page, f"No page target found for pid {p}"
    
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
    
    samples = []
    sample_deadline = time.time() + 10.0
    msg_id = 1
    
    while time.time() < sample_deadline:
        sample_time = time.time() - t0
        ws.send(json.dumps({"id": msg_id, "method": "Runtime.evaluate",
                            "params": {"expression": SAMPLE_JS, "returnByValue": True}}))
        resp = None
        while True:
            r = json.loads(ws.recv())
            if r.get("id") == msg_id:
                resp = r
                break
        msg_id += 1
        val = resp.get("result", {}).get("result", {}).get("value", {})
        samples.append({
            "t_ms": int(sample_time * 1000),
            "notifications": val.get("notifications"),
            "html_empty": (val.get("html", "").strip() == ""),
            "has_notify_text": ("允许发通知" in val.get("html", "") or "允许发通知" in val.get("text", "")),
            "html": val.get("html", ""),
            "text": val.get("text", "")
        })
        time.sleep(0.1)
    
    ws.close()
    adb("forward", "--remove", f"tcp:{port}")
    
    # Analyze round
    unknown_samples = [s for s in samples if s["notifications"] == "unknown"]
    unknown_with_content = [s for s in unknown_samples if not s["html_empty"]]
    samples_with_notify_text = [s for s in samples if s["has_notify_text"]]
    granted_samples = [s for s in samples if s["notifications"] == "granted"]
    last_sample = samples[-1] if samples else {}
    
    log(f"Round {round_idx}: total samples={len(samples)}, unknown_count={len(unknown_samples)}, "
        f"unknown_with_content={len(unknown_with_content)}, notify_leak_count={len(samples_with_notify_text)}")
    log(f"Round {round_idx} final text: {last_sample.get('text', '').replace(chr(10), ' ')}")
    
    assert len(unknown_with_content) == 0, f"Round {round_idx}: card shown while notifications==unknown: {unknown_with_content}"
    assert len(samples_with_notify_text) == 0, f"Round {round_idx}: '允许发通知' leaked: {samples_with_notify_text}"
    assert "还差 2 步" in last_sample.get("text", ""), f"Round {round_idx}: final card missing '还差 2 步': {last_sample.get('text')}"
    
    rounds_data.append({
        "round": round_idx,
        "sampleCount": len(samples),
        "unknownCount": len(unknown_samples),
        "unknownWithContent": len(unknown_with_content),
        "notifyLeakCount": len(samples_with_notify_text),
        "finalNotifications": last_sample.get("notifications"),
        "finalText": last_sample.get("text"),
        "samples": samples
    })

# Take screenshot of home setup card
ss = screenshot("step3-home-setup-card")
log("Screenshot saved:", ss)

result = {
    "step": "R3",
    "status": "PASS",
    "rounds": rounds_data,
    "passCriteria": {
        "unknownAlwaysEmpty": all(r["unknownWithContent"] == 0 for r in rounds_data),
        "neverShowsNotifyPrompt": all(r["notifyLeakCount"] == 0 for r in rounds_data),
        "finalStepCountMatchesR2": all("还差 2 步" in r["finalText"] for r in rounds_data)
    },
    "screenshot": str(ss) if ss else None
}
(RAW / "step3-r3-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
log("R3 (F2) completed successfully: PASS (all 3 rounds passed)")
