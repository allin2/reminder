"""PR4 阶段 B：关闭勿扰后验证 PR #4 已送达通知撤除（B0–B8）。
1. 关闭勿扰：在「我的」页点 #swDnd，确认 settings.dnd === false；
2. B0: 勿扰已关，在原本属于勿扰时段的时间（00:xx）新建普通档「2分钟后提醒我 RFX 关勿扰直投零」，确认按原定时刻送达，不再延后；
3. B1: 新建「2分钟后提醒我 RFX 撤除删除丙」，送达后在应用内 deleteItem，10s 内通知消失，removedDeliveredIds 含该 id，冷启动后通知栏仍无；
4. B2: 新建「2分钟后提醒我 RFX 确认撤除丁」，送达后在应用内 ackItem，通知消失，事项在内存与 IDB 为 acknowledged；
5. B3: 新建「2分钟后提醒我 RFX 完成撤除戊」，送达后在应用内 completeItem，通知消失，事项在内存与 IDB 为完成/归档；
6. B4: 新建「2分钟后提醒我 RFX 稍后撤除己」，送达后在应用内 snoozeItem（2小时），旧通知消失，待发队列中有约 +2 小时的新排程；
7. B5: 新建「2分钟后提醒我 RFX 保留未动庚」，送达后触发 syncNativeRemindersNow('b5') 并回前台一次，通知仍在通知栏，removedDeliveredIds 不含它；
8. B6: 新建「2分钟后提醒我 RFX 重启删除辛」，送达后 kill -9 杀进程并冷启动，再在应用内 deleteItem，通知被撤掉（归属索引进程重启持久化）；
9. B7: 新建「2分钟后提醒我 RFX 通知栏确认壬」，送达后在通知栏点「我知道了」，事项为 acknowledged、写入 IDB、通知消失；
10. B8: 观察项：新建重要档「2分钟后提醒我 RFX 响铃删除癸」，全屏响铃时在应用内删除它，如实记录响铃、全屏面板与通知变化。
"""
import datetime
import json
import os
import sys
import time
from devlib import *

log("== PHASE B: PR #4 Stale Delivered Notification Removal Verification (B0 - B8)")
start_app()
log("Ready:", wait_ready())

# 1. Turn off DND
log("Turning off DND switch via UI (#swDnd)...")
dnd_res = cdp_eval("""(() => {
  const A = window.__ATTENTION_INBOX__;
  const sw = document.querySelector("#swDnd");
  if (sw && A.state.settings.dnd) sw.click();
  return { dnd: A.state.settings.dnd };
})()""")
log("DND after toggle:", dnd_res)
assert dnd_res["dnd"] is False, f"Failed to turn off DND: {dnd_res}"

results = {}

def wait_for_delivery_in_shade(item_id, token, orig_trigger, max_wait_extra=45):
    """置于后台等待通知送达通知栏。返回 (delivered, delivered_at, node, notif_id)。"""
    home()
    t_target = (orig_trigger / 1000.0) + 5
    wait_s = t_target - time.time()
    if wait_s > 0:
        log(f"Waiting {wait_s:.1f}s until trigger + 5s for {token}...")
        time.sleep(wait_s)
    
    delivered = False
    del_node = None
    t0 = time.time()
    delivered_at = None
    while time.time() - t0 < max_wait_extra:
        wake()
        node, ns = open_shade_for(token)
        if node is not None:
            delivered = True
            del_node = node
            delivered_at = int(time.time() * 1000)
            log(f"Notification {token} delivered in shade at {delivered_at}:", node)
            break
        time.sleep(3)
    sh("cmd statusbar collapse")
    return delivered, delivered_at, del_node

def get_pending_notif_for(item_id):
    time.sleep(1)
    p = cdp_eval("""(async () => {
      const ln = Capacitor.Plugins.LocalNotifications;
      return (await ln.getPending()).notifications || [];
    })()""")
    for n in p:
        if (n.get("extra") or {}).get("itemId") == item_id:
            return n
    return None

# ==================== B0: 勿扰已关，在原本属于勿扰时段的时间新建普通档 ====================
log("\n== B0: Normal item during quiet hours with DND OFF")
# Check if current time is within user quiet hours (23:00 - 07:30)
is_in_orig_quiet = cdp_eval("""(() => {
  const d = new Date();
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= 23 * 60 || mins < 7 * 60 + 30;
})()""")
log(f"Current time in original quiet hours (23:00-07:30): {is_in_orig_quiet}")

if is_in_orig_quiet:
    b0_res = create_item_via_text("2分钟后提醒我 RFX 关勿扰直投零", priority="normal")
    b0_item = b0_res["item"]
    b0_id = b0_item["id"]
    b0_orig = b0_item["triggerAt"]
    
    b0_pending = get_pending_notif_for(b0_id)
    assert b0_pending is not None, f"B0 pending notification not found: {b0_id}"
    b0_notif_id = b0_pending.get("id")
    sched_val = b0_pending.get("schedule", {}).get("at")
    sched_ms = int(sched_val) if isinstance(sched_val, (int, float)) else cdp_eval(f"new Date({json.dumps(sched_val)}).getTime()")
    diff_from_orig = abs(sched_ms - b0_orig)
    log(f"B0 sched_ms={sched_ms}, orig={b0_orig}, diff={diff_from_orig}ms")
    # Must NOT be deferred to 07:30 (diff from orig should be < 2000ms)
    assert diff_from_orig < 2000, f"B0 was deferred even though DND is off! diff={diff_from_orig}ms"
    
    delivered, del_at, node = wait_for_delivery_in_shade(b0_id, "关勿扰直投零", b0_orig)
    assert delivered, "B0 notification was not delivered at original trigger time!"
    log(f"B0 delivered on time at {del_at}")
    
    # Cleanup B0
    start_app(); wait_ready()
    cdp_eval(f"__ATTENTION_INBOX__.deleteItem('{b0_id}'); __ATTENTION_INBOX__.saveAsync();")
    results["B0"] = {
        "status": "PASS",
        "itemId": b0_id,
        "notifId": b0_notif_id,
        "origTrigger": b0_orig,
        "deliveredAt": del_at,
        "schedAt": sched_ms,
        "deliveredOnTime": True
    }
else:
    log("B0: Current time not in quiet hours window, marking N/A")
    results["B0"] = {"status": "N/A", "reason": "Current time not in user quiet hours (23:00-07:30)"}

# ==================== B1: deleteItem 撤除 ====================
log("\n== B1: Delete item in app after delivery")
b1_res = create_item_via_text("2分钟后提醒我 RFX 撤除删除丙", priority="normal")
b1_item = b1_res["item"]
b1_id = b1_item["id"]
b1_orig = b1_item["triggerAt"]

b1_pending = get_pending_notif_for(b1_id)
assert b1_pending is not None, "B1 pending not found"
b1_notif_id = b1_pending.get("id")

delivered, del_at, node = wait_for_delivery_in_shade(b1_id, "撤除删除丙", b1_orig)
assert delivered, "B1 not delivered"

start_app(); wait_ready()
op_time = int(time.time() * 1000)
log(f"B1 operation at {op_time}: calling deleteItem({b1_id})")
cdp_eval(f"__ATTENTION_INBOX__.deleteItem('{b1_id}'); __ATTENTION_INBOX__.saveAsync();")

gone_at = None
in_removed = False
removed_ids = []
for i in range(10):
    time.sleep(1)
    st = cdp_eval("window.__ATTENTION_INBOX__.getNativeReminderStatus()")
    removed_ids = st.get("removedDeliveredIds") or []
    if b1_notif_id in removed_ids or str(b1_notif_id) in [str(x) for x in removed_ids] or b1_id in removed_ids:
        in_removed = True
        gone_at = int(time.time() * 1000)
        log(f"B1 removedDeliveredIds contains notif {b1_notif_id} / item {b1_id} after {i+1}s: {removed_ids}")
        break

assert in_removed, f"B1 {b1_notif_id} / {b1_id} not in removedDeliveredIds within 10s: {removed_ids}"

# Check shade
node_after, _ = open_shade_for("撤除删除丙")
assert node_after is None, f"B1 notification still in shade after deleteItem! Node: {node_after}"
sh("cmd statusbar collapse")
log("B1 notification disappeared from shade within 10s!")

# Cold start verification: notification still gone
log("B1: Verifying notification remains gone after cold start...")
kill_app()
time.sleep(1)
start_app(); wait_ready()
node_cold, _ = open_shade_for("撤除删除丙")
assert node_cold is None, f"B1 notification reappeared after cold start! Node: {node_cold}"
sh("cmd statusbar collapse")
log("B1 cold start check passed!")

results["B1"] = {
    "status": "PASS",
    "itemId": b1_id,
    "notifId": b1_notif_id,
    "deliveredAt": del_at,
    "operationAt": op_time,
    "notificationGoneAt": gone_at,
    "removedDeliveredIds": removed_ids,
    "deliveredCleanupError": st.get("deliveredCleanupError")
}

# ==================== B2: ackItem 撤除 ====================
log("\n== B2: Acknowledge item in app after delivery")
b2_res = create_item_via_text("2分钟后提醒我 RFX 确认撤除丁", priority="normal")
b2_item = b2_res["item"]
b2_id = b2_item["id"]
b2_orig = b2_item["triggerAt"]

b2_pending = get_pending_notif_for(b2_id)
assert b2_pending is not None
b2_notif_id = b2_pending.get("id")

delivered, del_at, node = wait_for_delivery_in_shade(b2_id, "确认撤除丁", b2_orig)
assert delivered, "B2 not delivered"

start_app(); wait_ready()
op_time = int(time.time() * 1000)
log(f"B2 operation at {op_time}: calling ackItem({b2_id})")
cdp_eval(f"__ATTENTION_INBOX__.ackItem('{b2_id}'); __ATTENTION_INBOX__.saveAsync();")

gone_at = None
in_removed = False
removed_ids = []
for i in range(10):
    time.sleep(1)
    st = cdp_eval("window.__ATTENTION_INBOX__.getNativeReminderStatus()")
    removed_ids = st.get("removedDeliveredIds") or []
    if b2_notif_id in removed_ids or str(b2_notif_id) in [str(x) for x in removed_ids] or b2_id in removed_ids:
        in_removed = True
        gone_at = int(time.time() * 1000)
        log(f"B2 removedDeliveredIds contains notif {b2_notif_id} / item {b2_id} after {i+1}s: {removed_ids}")
        break

assert in_removed, f"B2 {b2_notif_id} / {b2_id} not in removedDeliveredIds: {removed_ids}"

node_after, _ = open_shade_for("确认撤除丁")
assert node_after is None, f"B2 notification still in shade! Node: {node_after}"
sh("cmd statusbar collapse")

# Verify memory & IDB acknowledged
b2_mem = item_state(b2_id)
b2_idb = idb_item(b2_id)
log(f"B2 state: mem={b2_mem.get('status')}, idb={b2_idb.get('status')}")
assert b2_mem.get("status") == "acknowledged", f"B2 memory not acknowledged: {b2_mem}"
assert b2_idb.get("status") == "acknowledged", f"B2 IDB not acknowledged: {b2_idb}"
log("B2 passed: ackItem removed notification and updated memory & IDB!")

# Cleanup B2
cdp_eval(f"__ATTENTION_INBOX__.deleteItem('{b2_id}'); __ATTENTION_INBOX__.saveAsync();")

results["B2"] = {
    "status": "PASS",
    "itemId": b2_id,
    "notifId": b2_notif_id,
    "deliveredAt": del_at,
    "operationAt": op_time,
    "notificationGoneAt": gone_at,
    "removedDeliveredIds": removed_ids,
    "deliveredCleanupError": st.get("deliveredCleanupError")
}

# ==================== B3: completeItem 撤除 ====================
log("\n== B3: Complete item in app after delivery")
b3_res = create_item_via_text("2分钟后提醒我 RFX 完成撤除戊", priority="normal")
b3_item = b3_res["item"]
b3_id = b3_item["id"]
b3_orig = b3_item["triggerAt"]

b3_pending = get_pending_notif_for(b3_id)
assert b3_pending is not None
b3_notif_id = b3_pending.get("id")

delivered, del_at, node = wait_for_delivery_in_shade(b3_id, "完成撤除戊", b3_orig)
assert delivered, "B3 not delivered"

start_app(); wait_ready()
op_time = int(time.time() * 1000)
log(f"B3 operation at {op_time}: calling completeItem({b3_id})")
cdp_eval(f"__ATTENTION_INBOX__.completeItem('{b3_id}'); __ATTENTION_INBOX__.saveAsync();")

gone_at = None
in_removed = False
removed_ids = []
for i in range(10):
    time.sleep(1)
    st = cdp_eval("window.__ATTENTION_INBOX__.getNativeReminderStatus()")
    removed_ids = st.get("removedDeliveredIds") or []
    if b3_notif_id in removed_ids or str(b3_notif_id) in [str(x) for x in removed_ids] or b3_id in removed_ids:
        in_removed = True
        gone_at = int(time.time() * 1000)
        log(f"B3 removedDeliveredIds contains notif {b3_notif_id} / item {b3_id} after {i+1}s: {removed_ids}")
        break

assert in_removed, f"B3 {b3_notif_id} / {b3_id} not in removedDeliveredIds: {removed_ids}"

node_after, _ = open_shade_for("完成撤除戊")
assert node_after is None, f"B3 notification still in shade! Node: {node_after}"
sh("cmd statusbar collapse")

b3_mem = item_state(b3_id)
b3_idb = idb_item(b3_id)
log(f"B3 state: mem={b3_mem.get('status')}, idb={b3_idb.get('status')}, completedAt={b3_mem.get('completedAt')}")
assert b3_mem.get("completedAt") is not None and b3_mem.get("status") in ("completed", "archived"), f"B3 mem not completed: {b3_mem}"
assert b3_idb.get("completedAt") is not None and b3_idb.get("status") in ("completed", "archived"), f"B3 IDB not completed: {b3_idb}"
log("B3 passed: completeItem removed notification and updated memory & IDB!")

# Cleanup B3
cdp_eval(f"__ATTENTION_INBOX__.deleteItem('{b3_id}'); __ATTENTION_INBOX__.saveAsync();")

results["B3"] = {
    "status": "PASS",
    "itemId": b3_id,
    "notifId": b3_notif_id,
    "deliveredAt": del_at,
    "operationAt": op_time,
    "notificationGoneAt": gone_at,
    "removedDeliveredIds": removed_ids,
    "deliveredCleanupError": st.get("deliveredCleanupError")
}

# ==================== B4: snoozeItem 撤除旧通知并排新通知 ====================
log("\n== B4: Snooze item (2 hours) in app after delivery")
b4_res = create_item_via_text("2分钟后提醒我 RFX 稍后撤除己", priority="normal")
b4_item = b4_res["item"]
b4_id = b4_item["id"]
b4_orig = b4_item["triggerAt"]

b4_pending = get_pending_notif_for(b4_id)
assert b4_pending is not None
b4_notif_id = b4_pending.get("id")

delivered, del_at, node = wait_for_delivery_in_shade(b4_id, "稍后撤除己", b4_orig)
assert delivered, "B4 not delivered"

start_app(); wait_ready()
op_time = int(time.time() * 1000)
snooze_target = op_time + 2 * 3600 * 1000
log(f"B4 operation at {op_time}: calling snoozeItem({b4_id}, +2h)")
cdp_eval(f"__ATTENTION_INBOX__.snoozeItem('{b4_id}', {snooze_target}); __ATTENTION_INBOX__.saveAsync();")

gone_at = None
in_removed = False
removed_ids = []
for i in range(10):
    time.sleep(1)
    st = cdp_eval("window.__ATTENTION_INBOX__.getNativeReminderStatus()")
    removed_ids = st.get("removedDeliveredIds") or []
    if b4_notif_id in removed_ids or str(b4_notif_id) in [str(x) for x in removed_ids] or b4_id in removed_ids:
        in_removed = True
        gone_at = int(time.time() * 1000)
        log(f"B4 removedDeliveredIds contains notif {b4_notif_id} / item {b4_id} after {i+1}s: {removed_ids}")
        break

assert in_removed, f"B4 {b4_notif_id} / {b4_id} not in removedDeliveredIds: {removed_ids}"

node_after, _ = open_shade_for("稍后撤除己")
assert node_after is None, f"B4 old notification still in shade! Node: {node_after}"
sh("cmd statusbar collapse")

# Verify new pending schedule ~ +2 hours
time.sleep(2)
b4_new_pending = get_pending_notif_for(b4_id)
log("B4 new pending notification:", b4_new_pending)
assert b4_new_pending is not None, "B4 new pending notification not found!"
sched_val = b4_new_pending.get("schedule", {}).get("at")
sched_ms = int(sched_val) if isinstance(sched_val, (int, float)) else cdp_eval(f"new Date({json.dumps(sched_val)}).getTime()")
diff_snooze = abs(sched_ms - snooze_target)
log(f"B4 new schedule at {sched_ms}, target {snooze_target}, diff={diff_snooze}ms")
assert diff_snooze < 120000, f"B4 new schedule diff too large: {diff_snooze}ms"
log("B4 passed: old notification removed and new +2h schedule created!")

# Cleanup B4
cdp_eval(f"__ATTENTION_INBOX__.deleteItem('{b4_id}'); __ATTENTION_INBOX__.saveAsync();")

results["B4"] = {
    "status": "PASS",
    "itemId": b4_id,
    "notifId": b4_notif_id,
    "deliveredAt": del_at,
    "operationAt": op_time,
    "notificationGoneAt": gone_at,
    "newScheduleAt": sched_ms,
    "removedDeliveredIds": removed_ids,
    "deliveredCleanupError": st.get("deliveredCleanupError")
}

# ==================== B5: 未动事项保留通知不误撤 ====================
log("\n== B5: Unhandled item notification must NOT be removed during reconcile")
b5_res = create_item_via_text("2分钟后提醒我 RFX 保留未动庚", priority="normal")
b5_item = b5_res["item"]
b5_id = b5_item["id"]
b5_orig = b5_item["triggerAt"]

b5_pending = get_pending_notif_for(b5_id)
assert b5_pending is not None
b5_notif_id = b5_pending.get("id")

delivered, del_at, node = wait_for_delivery_in_shade(b5_id, "保留未动庚", b5_orig)
assert delivered, "B5 not delivered"

start_app(); wait_ready()
op_time = int(time.time() * 1000)
log(f"B5: Triggering manual reconcile syncNativeRemindersNow('b5') at {op_time}...")
sync_res = cdp_eval("""(async () => {
  const A = window.__ATTENTION_INBOX__;
  await A.syncNativeRemindersNow('b5');
  return A.getNativeReminderStatus();
})()""")
removed_ids = sync_res.get("removedDeliveredIds") or []
log(f"B5 reconcile status removedDeliveredIds: {removed_ids}")
assert b5_notif_id not in removed_ids and str(b5_notif_id) not in [str(x) for x in removed_ids] and b5_id not in removed_ids, f"B5 {b5_notif_id} was erroneously added to removedDeliveredIds: {removed_ids}"

# Check notification is STILL in shade
node_still, _ = open_shade_for("保留未动庚")
log("B5 node in shade after sync:", node_still)
assert node_still is not None, f"B5 notification was ERRONEOUSLY removed from shade!"
sh("cmd statusbar collapse")
log("B5 passed: unhandled delivered notification safely preserved in shade!")

# Cleanup B5
cdp_eval(f"__ATTENTION_INBOX__.deleteItem('{b5_id}'); __ATTENTION_INBOX__.saveAsync();")
time.sleep(2)
sh("cmd statusbar collapse")

results["B5"] = {
    "status": "PASS",
    "itemId": b5_id,
    "notifId": b5_notif_id,
    "deliveredAt": del_at,
    "reconcileAt": op_time,
    "notificationPreserved": True,
    "removedDeliveredIds": removed_ids,
    "deliveredCleanupError": sync_res.get("deliveredCleanupError")
}

# ==================== B6: 进程重启后归属索引持久化生效 ====================
log("\n== B6: Delivered notification index persists across kill -9 restart")
b6_res = create_item_via_text("2分钟后提醒我 RFX 重启删除辛", priority="normal")
b6_item = b6_res["item"]
b6_id = b6_item["id"]
b6_orig = b6_item["triggerAt"]

b6_pending = get_pending_notif_for(b6_id)
assert b6_pending is not None
b6_notif_id = b6_pending.get("id")

delivered, del_at, node = wait_for_delivery_in_shade(b6_id, "重启删除辛", b6_orig)
assert delivered, "B6 not delivered"

log("B6: Killing app process (kill -9) and cold restarting...")
kill_app()
time.sleep(2)
start_app(); wait_ready()

# Verify index in localStorage exists
ls_index = cdp_eval("localStorage.getItem('attention-inbox-delivered-notif-index')")
log("B6 delivered-notif-index in localStorage after restart:", ls_index)
assert ls_index is not None, "delivered-notif-index missing after restart!"

op_time = int(time.time() * 1000)
log(f"B6 operation at {op_time}: calling deleteItem({b6_id}) after cold restart")
cdp_eval(f"__ATTENTION_INBOX__.deleteItem('{b6_id}'); __ATTENTION_INBOX__.saveAsync();")

gone_at = None
in_removed = False
removed_ids = []
for i in range(10):
    time.sleep(1)
    st = cdp_eval("window.__ATTENTION_INBOX__.getNativeReminderStatus()")
    removed_ids = st.get("removedDeliveredIds") or []
    if b6_notif_id in removed_ids or str(b6_notif_id) in [str(x) for x in removed_ids] or b6_id in removed_ids:
        in_removed = True
        gone_at = int(time.time() * 1000)
        log(f"B6 removedDeliveredIds contains notif {b6_notif_id} / item {b6_id} after {i+1}s: {removed_ids}")
        break

assert in_removed, f"B6 {b6_notif_id} / {b6_id} not in removedDeliveredIds after restart: {removed_ids}"

node_after, _ = open_shade_for("重启删除辛")
assert node_after is None, f"B6 notification still in shade after restart delete! Node: {node_after}"
sh("cmd statusbar collapse")
log("B6 passed: index survived process restart and notification was successfully removed!")

results["B6"] = {
    "status": "PASS",
    "itemId": b6_id,
    "notifId": b6_notif_id,
    "deliveredAt": del_at,
    "operationAt": op_time,
    "notificationGoneAt": gone_at,
    "removedDeliveredIds": removed_ids,
    "deliveredCleanupError": st.get("deliveredCleanupError")
}

# ==================== B7: 回归：通知栏点击「我知道了」 ====================
log("\n== B7: Regression - tap '我知道了' directly in notification shade")
b7_res = create_item_via_text("2分钟后提醒我 RFX 通知栏确认壬", priority="normal")
b7_item = b7_res["item"]
b7_id = b7_item["id"]
b7_orig = b7_item["triggerAt"]

b7_pending = get_pending_notif_for(b7_id)
assert b7_pending is not None
b7_notif_id = b7_pending.get("id")

delivered, del_at, node = wait_for_delivery_in_shade(b7_id, "通知栏确认壬", b7_orig)
assert delivered, "B7 not delivered"

log("B7: Tapping '我知道了' action button on notification in shade...")
tap_ok, tap_msg = tap_notification_action("通知栏确认壬", "我知道了")
log(f"B7 tap result: {tap_ok}, msg: {tap_msg}")
assert tap_ok, f"Failed to tap '我知道了' in shade: {tap_msg}"
time.sleep(3)
sh("cmd statusbar collapse")

# Verify notification is gone from shade
node_after, _ = open_shade_for("通知栏确认壬")
assert node_after is None, f"B7 notification still in shade after tapping action! Node: {node_after}"
sh("cmd statusbar collapse")

# Verify app state
start_app(); wait_ready()
time.sleep(2)
b7_mem = item_state(b7_id)
b7_idb = idb_item(b7_id)
log(f"B7 state after shade action: mem={b7_mem.get('status')}, idb={b7_idb.get('status')}")
assert b7_mem.get("status") == "acknowledged", f"B7 mem not acknowledged: {b7_mem}"
assert b7_idb.get("status") == "acknowledged", f"B7 IDB not acknowledged: {b7_idb}"
log("B7 passed: notification action acknowledged item and removed notification!")

# Cleanup B7
cdp_eval(f"__ATTENTION_INBOX__.deleteItem('{b7_id}'); __ATTENTION_INBOX__.saveAsync();")

results["B7"] = {
    "status": "PASS",
    "itemId": b7_id,
    "notifId": b7_notif_id,
    "deliveredAt": del_at,
    "actionInShade": "我知道了",
    "acknowledgedInMemory": True,
    "acknowledgedInIdb": True
}

# ==================== B8: 观察项：重要档响铃时在应用内删除 ====================
log("\n== B8: Observation - delete important item while AlarmActivity is ringing")
b8_res = create_item_via_text("2分钟后提醒我 RFX 响铃删除癸", priority="important")
b8_item = b8_res["item"]
b8_id = b8_item["id"]
b8_orig = b8_item["triggerAt"]

home()
t_b8_trigger = b8_orig / 1000.0
wait_to_b8 = (t_b8_trigger - 5) - time.time()
if wait_to_b8 > 0:
    log(f"Waiting {wait_to_b8:.1f}s until 5s before B8 alarm trigger...")
    time.sleep(wait_to_b8)

alarm_focused = False
b8_alarm_time = None
for _ in range(35):
    wake()
    f = focus()
    if "AlarmActivity" in f:
        alarm_focused = True
        b8_alarm_time = int(time.time() * 1000)
        log("B8 AlarmActivity is focused and ringing!", f)
        break
    time.sleep(2)

assert alarm_focused, f"B8 AlarmActivity did not appear! Focus: {focus()}"

# While AlarmActivity is visible, call deleteItem via CDP in background webview
log(f"B8: Calling deleteItem({b8_id}) while AlarmActivity is ringing...")
cdp_eval(f"__ATTENTION_INBOX__.deleteItem('{b8_id}'); __ATTENTION_INBOX__.saveAsync();")
time.sleep(3)

# Observe: does AlarmActivity remain?
f_after = focus()
log(f"B8 focus after deleteItem: {f_after}")
alarm_still_focused = "AlarmActivity" in f_after

# Check shade for notification
node_b8, _ = open_shade_for("响铃删除癸")
b8_notif_present = node_b8 is not None
sh("cmd statusbar collapse")
log(f"B8 observation: alarm_still_focused={alarm_still_focused}, notif_present={b8_notif_present}")

# Dismiss AlarmActivity if still showing
if alarm_still_focused or "AlarmActivity" in focus():
    log("B8: Dismissing AlarmActivity via '完成' or back button...")
    nodes = ui_nodes()
    btn_done = next((n for n in nodes if n["text"] == "完成" or n["rid"].endswith("btnDone")), None)
    if btn_done:
        tap(btn_done)
    else:
        sh("input keyevent KEYCODE_BACK")
    time.sleep(2)

start_app(); wait_ready()
results["B8"] = {
    "status": "OBSERVED",
    "itemId": b8_id,
    "alarmFiredAt": b8_alarm_time,
    "alarmActivityDismissedOnDelete": not alarm_still_focused,
    "notificationDismissedOnDelete": not b8_notif_present,
    "observationNotes": (
        f"During active ringing, deleteItem({b8_id}) was executed in webview. "
        f"AlarmActivity remaining on screen: {alarm_still_focused}; "
        f"Notification shade record present: {b8_notif_present}."
    )
}

(RAW / "stepB-result.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
log("\nPHASE B COMPLETED SUCCESSFULLY!")
