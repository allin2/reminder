"""R7: 清理与恢复。
1. 用 __ATTENTION_INBOX__.deleteItem(id) 删除所有 R3 开头的隔离事项。
2. 确认系统闹钟中没有指向这些事项的项，通知中没有 R3 残留。
3. 把 settings.setupPromptStarted 恢复成测试前的值（直接改 state.settings 后调用 saveAsync()，注明非业务写入）。
4. 杀进程冷启动（kill -9，不用 force-stop）。
5. 重新读取 IDB 快照 06-final-after-cleanup，确认事项 ID 集合等于测试前记录的集合。
6. 与 00-baseline 对比，列出所有差异。
"""
import json
import time
from devlib import *

def pkg_alarms():
    out = sh("dumpsys alarm", timeout=90)
    res = []
    for l in out.splitlines():
        m = re.search(r"Alarm\{\S+ type \d+ origWhen (\d+).*tag=(\*walarm\*:space\.alliswell\.inbox\S*)", l)
        if m:
            res.append((int(m.group(1)), m.group(2)))
    return sorted(set(res))

log("== R7: Cleanup and restore to baseline state")
start_app()
log("ready", wait_ready())

# 1. Read all R3 items
r3_items = cdp_eval("__ATTENTION_INBOX__.state.items.filter(x => /^R3/.test(x.title)).map(x => ({id: x.id, title: x.title, triggerAt: x.triggerAt}))")
log(f"R3 items to delete: {len(r3_items)}", [x["title"] for x in r3_items])

deleted_results = []
for it in r3_items:
    r = cdp_eval(f"""(async () => {{
      const A = __ATTENTION_INBOX__;
      const ok = A.deleteItem ? A.deleteItem({json.dumps(it['id'])}) : false;
      if (A.hideAlert) A.hideAlert();
      for (let i = 0; i < 50 && A.inflightDepth() > 0; i++) await new Promise(res => setTimeout(res, 100));
      if (A.saveAsync) await A.saveAsync();
      return {{ ok, remaining: A.state.items.length }};
    }})()""")
    log(f"Deleted {it['title']} ({it['id']}): {r}")
    deleted_results.append({"item": it, "result": r})

# Dismiss any delivered notifications for R3 items via Capacitor LocalNotifications
cdp_eval("""(async () => {
  const ln = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
  if (!ln) return;
  const d = await ln.getDeliveredNotifications();
  const r3Notifs = (d.notifications || []).filter(n => (n.body && n.body.startsWith('R3')) || (n.title && n.title.startsWith('R3')));
  if (r3Notifs.length) {
    await ln.removeDeliveredNotifications({ notifications: r3Notifs.map(n => ({ id: n.id })) });
  }
})()""")

time.sleep(4)

# 2. Check alarms and notifications
alarms_after = pkg_alarms()
item_times = {it["triggerAt"] for it in r3_items if it.get("triggerAt")}
alarms_referencing_r3 = [a for a in alarms_after if any(abs(a[0] - t) < 1000 for t in item_times)]
log("Package alarms after cleanup:", len(alarms_after), alarms_after)
log("Alarms referencing R3 trigger times:", alarms_referencing_r3)
assert len(alarms_referencing_r3) == 0, f"Leftover alarms referencing R3: {alarms_referencing_r3}"

own_notifs = notif_dump_pkg()
r3_notif_leftover = [it["title"].split()[0] for it in r3_items if it["title"].split()[0] in own_notifs]
log("Leftover R3 notifications:", r3_notif_leftover)
assert len(r3_notif_leftover) == 0, f"Leftover R3 notifications: {r3_notif_leftover}"

# 3. Restore setupPromptStarted if needed
baseline_info = json.loads((RAW / "step0-baseline.json").read_text(encoding="utf-8"))
orig_started = baseline_info["setupPromptStartedBefore"]

restore_res = cdp_eval(f"""(async () => {{
  const A = __ATTENTION_INBOX__;
  const curr = !!(A.state.settings && A.state.settings.setupPromptStarted);
  const target = {json.dumps(orig_started)};
  let restored = false;
  if (curr !== target) {{
    A.state.settings.setupPromptStarted = target;
    restored = true;
    if (A.saveAsync) await A.saveAsync();
  }}
  return {{ before: curr, target: target, restored: restored }};
}})()""")
log("setupPromptStarted restore:", restore_res)

# 4. Cold restart (kill -9, not force-stop)
home()
time.sleep(1)
kill_app()
time.sleep(1)
start_app()
log("ready after cold restart", wait_ready())
time.sleep(3)

# 5. Authoritative IDB snapshot
final_snap = idb_snapshot("06-final-after-cleanup")
base_snap = json.loads((RAW / "00-baseline.idb-hashes.json").read_text(encoding="utf-8"))
diff_res = diff_snapshots(base_snap, final_snap)
(RAW / "step7-final-diff.json").write_text(json.dumps(diff_res, ensure_ascii=False, indent=2), encoding="utf-8")
log("Final diff vs 00-baseline:", json.dumps(diff_res, ensure_ascii=False))

# 6. Verify item IDs set
curr_items = cdp_eval("__ATTENTION_INBOX__.state.items.map(x => ({id: x.id, title: x.title}))")
curr_ids = sorted([x["id"] for x in curr_items])
base_ids = sorted(baseline_info["userItemIds"])
log(f"Baseline item IDs: {base_ids}")
log(f"Final item IDs:    {curr_ids}")
assert curr_ids == base_ids, f"Final item IDs {curr_ids} != baseline {base_ids}"

# Check detailed changes
a_state = raw_state("00-baseline")["kv/state"]
b_state = raw_state("06-final-after-cleanup")["kv/state"]

changed_settings = {}
sa = a_state.get("settings", {})
sb = b_state.get("settings", {})
for k in set(sa) | set(sb):
    if sa.get(k) != sb.get(k):
        changed_settings[k] = {"before": sa.get(k), "after": sb.get(k)}
log("Changed settings vs baseline:", json.dumps(changed_settings, ensure_ascii=False))

ss_final = screenshot("step7-final-app")
log("Final screenshot saved:", ss_final)

result = {
    "step": "R7",
    "status": "PASS",
    "deletedItems": deleted_results,
    "alarmsReferencingR3": alarms_referencing_r3,
    "r3NotifLeftover": r3_notif_leftover,
    "setupPromptStartedRestore": restore_res,
    "finalItemCount": len(curr_ids),
    "userItemsPreserved": (curr_ids == base_ids),
    "changedSettings": changed_settings,
    "diffVsBaseline": diff_res,
    "screenshot": str(ss_final) if ss_final else None
}
(RAW / "step7-r7-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
log("R7 cleanup and restore completed successfully: PASS")
