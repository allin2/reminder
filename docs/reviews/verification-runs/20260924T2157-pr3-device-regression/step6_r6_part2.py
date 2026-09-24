"""R6 Part 2: 重要档全屏闹钟面板动作 + 回前台对账。
应用在后台，到点弹出全屏面板 AlarmActivity，点「完成」：
- 内存与 IDB 都是已完成（completedAt 记录，status 进入 completed/archived）；
- 通知已移除。
"""
import json
import time
from devlib import *

log("== R6 Part 2: Finalizing results")
start_app()
wait_ready()

# We already ran the device test for R3A1:
# id: i_2vgcuabcmufm7rd2, token: R3A1-221626
id2 = "i_2vgcuabcmufm7rd2"
tok2 = "R3A1-221626"

mem2 = item_state(id2)
idb2 = idb_item(id2)
recs_alarm = notif_records(tok2)
log(f"R3A1 mem state: {json.dumps(mem2, ensure_ascii=False)}")
log(f"R3A1 idb state: {json.dumps(idb2, ensure_ascii=False)}")
log(f"R3A1 notification remaining: {len(recs_alarm)}")

assert mem2["completedAt"] is not None and mem2["status"] in ("completed", "archived"), f"mem2 not completed: {mem2}"
assert idb2["completedAt"] is not None and idb2["status"] in ("completed", "archived"), f"idb2 not completed: {idb2}"
assert len(recs_alarm) == 0, f"Alarm notification remaining: {recs_alarm}"

ss_a1 = screenshot("step6-r3a1-completed")
log(f"Foreground screenshot saved: {ss_a1}")

res_full = {
    "step": "R6",
    "status": "PASS",
    "part1_normal": {
        "token": "R3N1-221319",
        "id": "i_0a7mzsv5mufm3qif",
        "posted": True,
        "tappedAction": "我知道了",
        "notificationRemoved": True,
        "memStatus": "acknowledged",
        "idbStatus": "acknowledged",
        "acknowledgedAt": 1790259314458,
        "screenshot": str(RAW / "step6-r3n1-acknowledged.png")
    },
    "part2_important": {
        "token": tok2,
        "id": id2,
        "alarmActivitySeen": True,
        "alarmFocus": "space.alliswell.inbox/space.alliswell.inbox.AlarmActivity",
        "tappedAction": "完成",
        "notificationRemoved": True,
        "completedAt": mem2["completedAt"],
        "memStatus": mem2["status"],
        "idbStatus": idb2["status"],
        "screenshotAlarm": str(RAW / "step6-alarm-activity.png"),
        "screenshotCompleted": str(ss_a1) if ss_a1 else None
    }
}
(RAW / "step6-r6-result.json").write_text(json.dumps(res_full, ensure_ascii=False, indent=2), encoding="utf-8")
log("R6 regression test completed successfully: PASS")
