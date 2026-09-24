"""R6: 少量回归验证。
1. 普通档隔离事项（R3N1）：应用在后台，到点在通知栏点「我知道了」：
   - 状态变为 acknowledged 并写入 IDB；
   - 通知被移除。
2. 重要档隔离事项（R3A1）：应用在后台，到点弹出全屏面板 AlarmActivity，点「完成」：
   - 回到前台，内存与 IDB 都是已完成（completed）；
   - 通知已移除。
通过标准：两项均符合预期。
"""
import json
import time
from devlib import *

log("== R6: Regression testing (notification action + fullscreen alarm)")
start_app()
log("ready", wait_ready())

# ----------------- Part 1: Normal priority item (R3N1) -----------------
log("--- Part 1: Normal priority notification action ---")
tok1 = "R3N1-" + time.strftime("%H%M%S")
trig1 = next_minute_ms(1)
wait1 = (trig1 - time.time() * 1000) / 1000.0
log(f"Creating normal item {tok1}, trigger at {trig1} (in {wait1:.1f}s)")

r1 = create_item_via_form(f"{tok1} 普通回归", trig1, "normal")
assert r1 and r1.get("item"), f"Create normal item failed: {r1}"
id1 = r1["item"]["id"]
log(f"R3N1 created: {id1}")

# Background app
home()
log("App backgrounded, waiting for trigger...")
while time.time() * 1000 < trig1 + 10000:
    time.sleep(5)
    wake()

# Wait for notification to be posted
posted1 = False
for _ in range(15):
    recs = notif_records(tok1)
    if recs:
        posted1 = True
        break
    time.sleep(2)
log(f"R3N1 notification posted: {posted1}")
assert posted1, f"Notification for {tok1} was not posted"

# Tap "我知道了"
ok_tap, msg_tap = tap_notification_action(tok1, "我知道了")
log(f"tap_notification_action result: ok={ok_tap}, msg={msg_tap}")
assert ok_tap, f"Failed to tap '我知道了': {msg_tap}"

time.sleep(3)
sh("cmd statusbar collapse")
time.sleep(1)

# Verify notification removed
recs_after = notif_records(tok1)
log(f"R3N1 notification remaining after tap: {len(recs_after)}")
assert len(recs_after) == 0, f"Notification still present: {recs_after}"

# Return to app and verify status in mem & IDB
start_app()
wait_ready()
time.sleep(1)

mem1 = item_state(id1)
idb1 = idb_item(id1)
log(f"R3N1 mem state: {json.dumps(mem1, ensure_ascii=False)}")
log(f"R3N1 idb state: {json.dumps(idb1, ensure_ascii=False)}")
assert mem1["status"] == "acknowledged", f"Expected mem status acknowledged, got {mem1['status']}"
assert idb1["status"] == "acknowledged", f"Expected idb status acknowledged, got {idb1['status']}"
ss_n1 = screenshot("step6-r3n1-acknowledged")

# ----------------- Part 2: Important priority item (R3A1) -----------------
log("--- Part 2: Important priority fullscreen alarm ---")
tok2 = "R3A1-" + time.strftime("%H%M%S")
trig2 = next_minute_ms(1)
wait2 = (trig2 - time.time() * 1000) / 1000.0
log(f"Creating important item {tok2}, trigger at {trig2} (in {wait2:.1f}s)")

r2 = create_item_via_form(f"{tok2} 重要回归", trig2, "important")
assert r2 and r2.get("item"), f"Create important item failed: {r2}"
id2 = r2["item"]["id"]
log(f"R3A1 created: {id2}")

# Background app
home()
log(f"App backgrounded, waiting for AlarmActivity until {trig2 + 60000}...")

alarm_activity_seen = False
alarm_focus = ""
while time.time() * 1000 < trig2 + 75000:
    f = focus()
    if "AlarmActivity" in f:
        alarm_activity_seen = True
        alarm_focus = f
        break
    time.sleep(2)
    wake()

log(f"AlarmActivity seen: {alarm_activity_seen}, focus: {alarm_focus}")
assert alarm_activity_seen, "AlarmActivity did not launch in time"

# Screenshot of alarm panel (focus is space.alliswell.inbox)
ss_alarm = screenshot("step6-alarm-activity")
log(f"Alarm panel screenshot saved: {ss_alarm}")

# Find and tap "完成" (btnDone)
btn_done = find_node(lambda n: n["rid"] == f"{PKG}:id/btnDone" or n["text"] == "完成", tries=5)
assert btn_done, "Could not find '完成' button on AlarmActivity"
log(f"Tapping '完成' button at {btn_done['bounds']}")
tap(btn_done)
time.sleep(3)

# Return to app foreground
start_app()
wait_ready()
time.sleep(2)

mem2 = item_state(id2)
idb2 = idb_item(id2)
recs_alarm = notif_records(tok2)
log(f"R3A1 mem state: {json.dumps(mem2, ensure_ascii=False)}")
log(f"R3A1 idb state: {json.dumps(idb2, ensure_ascii=False)}")
log(f"R3A1 notification remaining: {len(recs_alarm)}")

assert mem2["status"] == "completed", f"Expected mem status completed, got {mem2['status']}"
assert idb2["status"] == "completed", f"Expected idb status completed, got {idb2['status']}"
assert len(recs_alarm) == 0, f"Alarm notification remaining: {recs_alarm}"

ss_a1 = screenshot("step6-r3a1-completed")

result = {
    "step": "R6",
    "status": "PASS",
    "part1_normal": {
        "token": tok1,
        "id": id1,
        "posted": posted1,
        "tappedAction": "我知道了",
        "notificationRemoved": (len(recs_after) == 0),
        "memStatus": mem1["status"],
        "idbStatus": idb1["status"],
        "screenshot": str(ss_n1) if ss_n1 else None
    },
    "part2_important": {
        "token": tok2,
        "id": id2,
        "alarmActivitySeen": alarm_activity_seen,
        "alarmFocus": alarm_focus,
        "tappedAction": "完成",
        "notificationRemoved": (len(recs_alarm) == 0),
        "memStatus": mem2["status"],
        "idbStatus": idb2["status"],
        "screenshotAlarm": str(ss_alarm) if ss_alarm else None,
        "screenshotCompleted": str(ss_a1) if ss_a1 else None
    }
}
(RAW / "step6-r6-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
log("R6 completed successfully: PASS")
