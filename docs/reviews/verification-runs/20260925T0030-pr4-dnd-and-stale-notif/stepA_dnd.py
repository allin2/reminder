"""PR4 阶段 A：勿扰开启时的效果验证（A1–A4）。
1. 记录当前时间与基线设置；设置 A-临时窗口（now-1m ~ now+6m），保存并确认 dnd=true；
2. A1: 新建普通档「2分钟后提醒我 RFX 勿扰普通甲」，断言 getPending() 中 schedule.at 为 quietEnd；原定时刻+30s 通知未发出；
3. A2: 新建重要档「2分钟后提醒我 RFX 勿扰重要乙」，原定时刻弹出全屏 AlarmActivity，点击「完成」，断言内存与 IDB 为 completed；
4. A3: 等待到 quietEnd，90s 内 A1 通知送达通知栏，事项到期；
5. A4: 不在通知上操作，调用 deleteItem(A1.id)，10s 内通知从通知栏消失，removedDeliveredIds 含该 id；
6. 恢复勿扰时段为 23:00–07:30。
"""
import datetime
import json
import os
import sys
import time
from devlib import *

log("== PHASE A: DND Verification (A1 - A4)")
start_app()
log("Ready:", wait_ready())

# 1. Check current time & setup temporary quiet window
now_res = cdp_eval("""(() => {
  const d = new Date();
  return {
    ts: d.getTime(),
    hours: d.getHours(),
    minutes: d.getMinutes(),
    seconds: d.getSeconds()
  };
})()""")
log("Current app time:", now_res)

# If seconds > 40, wait for minute rollover for clean window
now_sec = cdp_eval("(new Date()).getSeconds()")
if now_sec > 40:
    wait_s = 62 - now_sec
    log(f"Waiting {wait_s}s for next clean minute...")
    time.sleep(wait_s)

win_info = cdp_eval("""(() => {
  const d = new Date();
  const startD = new Date(d.getTime() - 60000);
  const endD = new Date(d.getTime() + 6 * 60000);
  const pad = n => String(n).padStart(2, "0");
  const startStr = pad(startD.getHours()) + ":" + pad(startD.getMinutes());
  const endStr = pad(endD.getHours()) + ":" + pad(endD.getMinutes());
  endD.setSeconds(0, 0);
  return {
    startStr,
    endStr,
    quietEndTs: endD.getTime()
  };
})()""")
start_str = win_info["startStr"]
end_str = win_info["endStr"]
quiet_end_ts = win_info["quietEndTs"]
log(f"Setting quiet window: {start_str} to {end_str}, target timestamp: {quiet_end_ts}")

# Set quiet window via UI
set_res = cdp_eval("""(() => {
  const A = window.__ATTENTION_INBOX__;
  const btnQuiet = document.querySelector("#btnQuiet");
  if (btnQuiet) btnQuiet.click();
  const qs = document.querySelector("#quietStart");
  const qe = document.querySelector("#quietEnd");
  if (qs) qs.value = %s;
  if (qe) qe.value = %s;
  const btnSave = document.querySelector("#btnSaveQuiet");
  if (btnSave) btnSave.click();
  return {
    dnd: A.state.settings.dnd,
    quietStart: A.state.settings.quietStart,
    quietEnd: A.state.settings.quietEnd
  };
})()""" % (json.dumps(start_str), json.dumps(end_str)))
log("Quiet settings after save:", set_res)
assert set_res["dnd"] is True, f"DND is not true: {set_res}"
assert set_res["quietStart"] == start_str, f"quietStart mismatch: {set_res}"
assert set_res["quietEnd"] == end_str, f"quietEnd mismatch: {set_res}"

log(f"Quiet end target timestamp: {quiet_end_ts} ({end_str})")

# 2. A1: 新建普通档 2分钟后提醒我 RFX 勿扰普通甲
log("== A1: Creating normal item '2分钟后提醒我 RFX 勿扰普通甲'")
a1_res = create_item_via_text("2分钟后提醒我 RFX 勿扰普通甲", priority="normal")
a1_item = a1_res["item"]
a1_id = a1_item["id"]
a1_orig_trigger = a1_item["triggerAt"]
log(f"A1 item created: id={a1_id}, orig_trigger={a1_orig_trigger}")

# Check getPending()
time.sleep(2)
pending_res = cdp_eval("""(async () => {
  const ln = Capacitor.Plugins.LocalNotifications;
  const p = await ln.getPending();
  return p.notifications || [];
})()""")
a1_pending = next((n for n in pending_res if (n.get("extra") or {}).get("itemId") == a1_id), None)
log("A1 pending notification:", a1_pending)
assert a1_pending is not None, "A1 pending notification not found in getPending()"

# The pending schedule.at should equal quietEnd (within 2s)
sched_at_val = a1_pending.get("schedule", {}).get("at")
if isinstance(sched_at_val, (int, float)):
    sched_at_ms = int(sched_at_val)
else:
    sched_at_ms = cdp_eval(f"new Date({json.dumps(sched_at_val)}).getTime()")

diff_from_quiet_end = abs(sched_at_ms - quiet_end_ts)
diff_from_orig = abs(sched_at_ms - a1_orig_trigger)
log(f"A1 schedule.at={sched_at_ms}, quiet_end_ts={quiet_end_ts}, diff={diff_from_quiet_end}ms; diff_from_orig={diff_from_orig}ms")
assert diff_from_quiet_end < 2000, f"A1 schedule.at is not quietEnd! diff={diff_from_quiet_end}ms"
assert diff_from_orig > 60000, f"A1 schedule.at was not deferred! diff_from_orig={diff_from_orig}ms"
log("A1 assertion 1 passed: notification schedule.at deferred to quietEnd!")

# 3. A2: 新建重要档 2分钟后提醒我 RFX 勿扰重要乙
log("== A2: Creating important item '2分钟后提醒我 RFX 勿扰重要乙'")
a2_res = create_item_via_text("2分钟后提醒我 RFX 勿扰重要乙", priority="important")
a2_item = a2_res["item"]
a2_id = a2_item["id"]
a2_orig_trigger = a2_item["triggerAt"]
log(f"A2 item created: id={a2_id}, orig_trigger={a2_orig_trigger}")

# Now wait for the original trigger time (approx 2 minutes from now)
# Put app in home screen so full screen alarm can be observed cleanly
home()
t_orig_trigger = a2_orig_trigger / 1000.0
wait_to_alarm = (t_orig_trigger - 5) - time.time()
log(f"Waiting {wait_to_alarm:.1f}s until 5s before A2 alarm trigger...")
if wait_to_alarm > 0:
    time.sleep(wait_to_alarm)

# Check A2: AlarmActivity should pop up within 60s of original trigger
log("Waiting for A2 AlarmActivity to pop up...")
alarm_popped = False
a2_ss = None
t_alarm_deadline = t_orig_trigger + 60
while time.time() < t_alarm_deadline:
    wake()
    f = focus()
    if "AlarmActivity" in f:
        log("AlarmActivity is focused!", f)
        alarm_popped = True
        a2_ss = screenshot("stepA-a2-alarm")
        break
    time.sleep(2)

assert alarm_popped, f"AlarmActivity did not pop up for A2 within 60s! Current focus: {focus()}"
log(f"AlarmActivity popped up successfully! Screenshot: {a2_ss}")

# Click "完成" on AlarmActivity
log("Tapping '完成' on AlarmActivity...")
nodes = ui_nodes()
btn_done = next((n for n in nodes if n["text"] == "完成" or n["rid"].endswith("btnDone")), None)
assert btn_done is not None, f"Could not find '完成' button on AlarmActivity! Nodes: {nodes}"
tap(btn_done)
time.sleep(3)

# Verify A2 status in memory and IDB is completed
start_app()
wait_ready()
a2_mem = item_state(a2_id)
a2_idb = idb_item(a2_id)
log(f"A2 state in memory: status={a2_mem.get('status')}, completedAt={a2_mem.get('completedAt')}")
log(f"A2 state in IDB: status={a2_idb.get('status')}, completedAt={a2_idb.get('completedAt')}")
assert a2_mem.get("completedAt") is not None and a2_mem.get("status") in ("completed", "archived"), f"A2 memory status not completed/archived: {a2_mem}"
assert a2_idb.get("completedAt") is not None and a2_idb.get("status") in ("completed", "archived"), f"A2 IDB status not completed/archived: {a2_idb}"
log("A2 assertion passed: AlarmActivity popped up and completed successfully!")

# Now check A1: at original trigger + 30s, notification MUST NOT be in shade
log("Checking A1 at original trigger time: must NOT be posted...")
a1_notif_token = "勿扰普通甲"
a1_node, _ = open_shade_for(a1_notif_token)
a1_recs = notif_records(a1_notif_token)
log(f"A1 in shade node: {a1_node}, rec count: {len(a1_recs)}")
assert a1_node is None, f"A1 notification should NOT be visible in shade during quiet hours! Node: {a1_node}"
assert len(a1_recs) == 0, f"A1 notification record found in dumpsys: {a1_recs}"
log("A1 assertion 2 passed: notification is NOT posted at original trigger time!")
home()

# 4. A3: 等到勿扰结束时刻 (quiet_end_ts)
home()
t_quiet_end = quiet_end_ts / 1000.0
wait_until_end = (t_quiet_end + 15) - time.time()
log(f"Waiting {wait_until_end:.1f}s until quietEnd + 15s...")
if wait_until_end > 0:
    time.sleep(wait_until_end)

wake()
# Within 90s after quietEnd, A1 notification should be delivered
a1_delivered = False
a1_delivered_node = None
for i in range(15):
    wake()
    a1_node, ns = open_shade_for(a1_notif_token)
    if a1_node is not None:
        a1_delivered = True
        a1_delivered_node = a1_node
        log("A1 notification delivered in shade:", a1_node)
        break
    time.sleep(6)

assert a1_delivered, f"A1 notification was NOT delivered within 90s after quietEnd!"
log("A1 delivered to notification shade successfully!")

# Verify A1 is due in app
start_app()
wait_ready()
a1_mem_state = item_state(a1_id)
log("A1 state in app:", a1_mem_state)
# In app, triggerAt has arrived
now_ts = cdp_eval("Date.now()")
assert a1_mem_state["triggerAt"] <= now_ts, f"A1 item is not due! triggerAt={a1_mem_state['triggerAt']}, now={now_ts}"
log("A3 assertion passed: A1 delivered after quietEnd and item is due!")

# 5. A4: 送达后不在通知上操作，直接在应用内调用 deleteItem(A1.id)
log("== A4: Deleting A1 inside app via deleteItem...")
del_res = cdp_eval("""(async () => {
  const A = window.__ATTENTION_INBOX__;
  A.deleteItem(%s);
  await A.saveAsync();
  return { itemsCount: A.state.items.length };
})()""" % json.dumps(a1_id))
log("Delete result:", del_res)

# Wait up to 10s and check removedDeliveredIds and shade
removed_ok = False
removed_ids = []
for i in range(10):
    time.sleep(1)
    status_now = cdp_eval("window.__ATTENTION_INBOX__.getNativeReminderStatus()")
    removed_ids = status_now.get("removedDeliveredIds") or []
    if a1_id in removed_ids:
        removed_ok = True
        log(f"removedDeliveredIds contains A1 ({a1_id}) after {i+1}s: {removed_ids}")
        break

assert removed_ok, f"A1 ({a1_id}) not found in removedDeliveredIds within 10s! Current status: {removed_ids}"

# Check notification shade: A1 notification MUST be gone within 10s
a1_node_after, _ = open_shade_for(a1_notif_token)
a1_recs_after = notif_records(a1_notif_token)
log(f"A1 node after delete: {a1_node_after}, recs: {len(a1_recs_after)}")
assert a1_node_after is None, f"A1 notification is STILL in shade after deleteItem! Node: {a1_node_after}"
assert len(a1_recs_after) == 0, f"A1 notification record still in dumpsys: {a1_recs_after}"
log("A4 assertion passed: A1 notification automatically removed after deleteItem!")

# 6. Restore quiet window to 23:00–07:30
log("Restoring quiet window to 23:00 - 07:30...")
start_app()
wait_ready()
restore_res = cdp_eval("""(() => {
  const A = window.__ATTENTION_INBOX__;
  const btnQuiet = document.querySelector("#btnQuiet");
  if (btnQuiet) btnQuiet.click();
  const qs = document.querySelector("#quietStart");
  const qe = document.querySelector("#quietEnd");
  if (qs) qs.value = "23:00";
  if (qe) qe.value = "07:30";
  const btnSave = document.querySelector("#btnSaveQuiet");
  if (btnSave) btnSave.click();
  return {
    dnd: A.state.settings.dnd,
    quietStart: A.state.settings.quietStart,
    quietEnd: A.state.settings.quietEnd
  };
})()""")
log("Quiet settings restored:", restore_res)
assert restore_res["quietStart"] == "23:00" and restore_res["quietEnd"] == "07:30", f"Failed to restore quiet window: {restore_res}"

res_data = {
    "A1": {
        "id": a1_id,
        "title": a1_item["title"],
        "origTrigger": a1_orig_trigger,
        "quietEndTarget": quiet_end_ts,
        "scheduleAt": sched_at_ms,
        "deferredToQuietEnd": True,
        "suppressedAtOrig": True,
        "deliveredAtQuietEnd": True,
        "status": "PASS"
    },
    "A2": {
        "id": a2_id,
        "title": a2_item["title"],
        "alarmPopped": True,
        "action": "done",
        "completedInMemory": True,
        "completedInIdb": True,
        "status": "PASS"
    },
    "A3": {
        "deliveredAfterQuietEnd": True,
        "status": "PASS"
    },
    "A4": {
        "deletedInApp": True,
        "notificationRemovedWithin10s": True,
        "inRemovedDeliveredIds": True,
        "removedDeliveredIds": removed_ids,
        "status": "PASS"
    }
}
(RAW / "stepA-result.json").write_text(json.dumps(res_data, ensure_ascii=False, indent=2), encoding="utf-8")
log("PHASE A COMPLETED SUCCESSFULLY: ALL PASS!")
