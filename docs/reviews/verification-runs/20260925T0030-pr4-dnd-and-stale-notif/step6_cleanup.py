"""PR4 阶段 6：清理与设置恢复。
1. 删除所有标题含 RFX 的残留事项；
2. 验证系统闹钟无 RFX 项、通知栏无 RFX 通知、getPending() 无 RFX 排程；
3. 通过界面恢复 settings.dnd=True, quietStart="23:00", quietEnd="07:30" 并读回确认；
4. kill -9 冷启动；
5. 取 06-final-after-cleanup 快照，对比 00-pre-install：用户事项 100% 相同，review 设置 0 变化；
6. 检查 localStorage 中的 attention-inbox-delivered-notif-index 无 RFX 事项条目。
"""
import json
import sys
import time
from devlib import *

log("== STEP 6: Cleanup and Baseline Restoration")
start_app()
log("Ready:", wait_ready())

# 1. Delete all RFX items
rfx_cleanup = cdp_eval("""(async () => {
  const A = window.__ATTENTION_INBOX__;
  const items = A.state.items || [];
  const rfxList = items.filter(x => x.title && x.title.includes("RFX"));
  for (const it of rfxList) {
    A.deleteItem(it.id);
  }
  await A.saveAsync();
  return {
    deletedCount: rfxList.length,
    deletedIds: rfxList.map(x => x.id),
    remainingCount: A.state.items.length,
    remainingIds: A.state.items.map(x => x.id)
  };
})()""")
log("RFX cleanup result:", rfx_cleanup)

# Wait for native sync
time.sleep(3)

# Verify no RFX in getPending()
pending = cdp_eval("""(async () => {
  const ln = Capacitor.Plugins.LocalNotifications;
  return (await ln.getPending()).notifications || [];
})()""")
rfx_pending = [n for n in pending if "RFX" in str(n)]
log(f"Remaining pending count: {len(pending)}, RFX pending: {len(rfx_pending)}")
assert len(rfx_pending) == 0, f"Found lingering RFX pending notifications: {rfx_pending}"

# Verify no RFX in notifications
recs = notif_records("RFX")
log(f"Lingering RFX notification records in dumpsys: {len(recs)}")
assert len(recs) == 0, f"Found lingering RFX notifications in dumpsys: {recs}"

# Verify no RFX in alarms
alarms = alarm_dump()
rfx_alarms = [line for line in alarms.split("\n") if "RFX" in line]
log(f"Lingering RFX alarms: {len(rfx_alarms)}")
assert len(rfx_alarms) == 0, f"Found lingering RFX alarms: {rfx_alarms}"

# 2. Restore settings via UI: dnd=True, quietStart="23:00", quietEnd="07:30"
log("Restoring settings: dnd=True, quietStart=23:00, quietEnd=07:30...")
restore_ui = cdp_eval("""(() => {
  const A = window.__ATTENTION_INBOX__;
  const sw = document.querySelector("#swDnd");
  if (sw && !A.state.settings.dnd) sw.click();
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
log("Settings after UI restore:", restore_ui)
assert restore_ui["dnd"] is True, f"DND not restored: {restore_ui}"
assert restore_ui["quietStart"] == "23:00", f"quietStart not restored: {restore_ui}"
assert restore_ui["quietEnd"] == "07:30", f"quietEnd not restored: {restore_ui}"

# 3. Kill app and cold start
log("== Cold start after cleanup (kill -9)")
kill_app()
time.sleep(2)
start_app()
wait_ready()
time.sleep(3)

# 4. Take final snapshot and diff with 00-pre-install
final_snap = idb_snapshot("06-final-after-cleanup")
pre_snap = json.loads((RAW / "00-pre-install.idb-hashes.json").read_text(encoding="utf-8"))
diff_res = diff_snapshots(pre_snap, final_snap)
(RAW / "step6-cleanup-diff.json").write_text(json.dumps(diff_res, ensure_ascii=False, indent=2), encoding="utf-8")
log("Cleanup diff vs pre-install:", json.dumps(diff_res, ensure_ascii=False))

# Check items 100% match
a_state = raw_state("00-pre-install")["kv/state"]
f_state = raw_state("06-final-after-cleanup")["kv/state"]
items_before = [x["id"] for x in a_state.get("items", [])]
items_final = [x["id"] for x in f_state.get("items", [])]
log(f"Items pre-install: {items_before}, Items final: {items_final}")
assert items_before == items_final, f"User items mismatch! {items_before} vs {items_final}"

# Verify user item fields identical
for it_b in a_state.get("items", []):
    it_f = next((x for x in f_state.get("items", []) if x["id"] == it_b["id"]), None)
    assert it_f is not None, f"Item {it_b['id']} missing in final state"
    assert it_b["title"] == it_f["title"], f"Item title changed: {it_b} vs {it_f}"
    assert it_b["status"] == it_f["status"], f"Item status changed: {it_b} vs {it_f}"

# Check settings.review has ZERO changes
rev_before = json.dumps(a_state.get("settings", {}).get("review", {}), sort_keys=True)
rev_final = json.dumps(f_state.get("settings", {}).get("review", {}), sort_keys=True)
log(f"Review settings before: {rev_before}")
log(f"Review settings final:  {rev_final}")
assert rev_before == rev_final, f"settings.review was modified! {rev_before} vs {rev_final}"

# 5. Check delivered index in localStorage contains no RFX
ls_index_raw = cdp_eval("localStorage.getItem('attention-inbox-delivered-notif-index')")
log(f"Final delivered index in localStorage: {ls_index_raw}")
if ls_index_raw:
    idx = json.loads(ls_index_raw)
    for notif_id, entry in idx.items():
        assert entry.get("itemId") in items_final, f"Lingering non-user entry in index: {entry}"

final_ss = screenshot("step6-final-app")
log(f"Final foreground screenshot: {final_ss}")

cleanup_summary = {
    "userItemsMatch": True,
    "userItemIds": items_final,
    "reviewSettingsUnchanged": True,
    "dndRestored": True,
    "quietWindowRestored": True,
    "lingeringRfxNotifications": 0,
    "lingeringRfxAlarms": 0,
    "lingeringRfxPending": 0,
    "status": "PASS"
}
(RAW / "step6-cleanup-summary.json").write_text(json.dumps(cleanup_summary, ensure_ascii=False, indent=2), encoding="utf-8")
log("STEP 6 CLEANUP & RESTORATION COMPLETED SUCCESSFULLY: PASS!")
