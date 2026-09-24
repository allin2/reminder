"""复验 R4：残留检查 + kill -9 冷启动 + 终态快照，与 05:14 复验基线（10-recheck-baseline）逐记录比对。"""
import json, time
from devlib import *
log("== R4 final residue & snapshot")
p_old = pid(); sh(f"run-as {PKG} kill -9 {p_old}"); time.sleep(2); start_app(); wait_ready(); time.sleep(3)
st = cdp_eval("""(async()=>{const A=__ATTENTION_INBOX__;const s=A.state.settings;
const p=(await Capacitor.Plugins.LocalNotifications.getPending()).notifications||[];
const ids=new Set(A.state.items.filter(i=>(i.title||'').includes('RFX')).map(i=>i.id));
const idx=JSON.parse(localStorage.getItem('attention-inbox-delivered-notif-index')||'{}');
return {rfxItems:[...ids], pendingRfx:p.filter(n=>/RFX/.test(n.title||'')).length,
 indexRfxItems:Object.values(idx).filter(e=>/RFX/.test((A.state.items.find(i=>i.id===e.itemId)||{}).title||'')||!A.state.items.find(i=>i.id===e.itemId)).map(e=>e.itemId),
 settings:{dnd:s.dnd,quietStart:s.quietStart,quietEnd:s.quietEnd,defaultDeliveryMode:s.defaultDeliveryMode}}})()""")
alarms = alarm_dump()
st["rfxNotif"] = len(notif_records("RFX"))
st["rfxAlarmLines"] = sum(1 for l in alarms.splitlines() if "RFX" in l)
log("residue", json.dumps(st, ensure_ascii=False))
snap = idb_snapshot("20-recheck-final")
base = json.loads((RAW / "10-recheck-baseline.idb-hashes.json").read_text())
diff = diff_snapshots(base, snap)
a, b = raw_state("10-recheck-baseline")["kv/state"]["settings"], raw_state("20-recheck-final")["kv/state"]["settings"]
sd = {}
for k in sorted(set(a) | set(b)):
    if a.get(k) != b.get(k):
        sd[k] = {"addedKeys": len(set(b[k]) - set(a[k])), "removedKeys": len(set(a[k]) - set(b[k]))} if k == "alarmEventLog" else {"before": a.get(k), "after": b.get(k)}
out = {"residue": st, "diff": diff, "settingsDiff": sd}
(RAW / "r4-final.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
log("diff", json.dumps(diff, ensure_ascii=False)); log("settingsDiff", json.dumps(sd, ensure_ascii=False))
if PKG in focus(): screenshot("r4-final-app")
log("R4 done")
