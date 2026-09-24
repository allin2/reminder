"""复验 R1：身份核对（候选包 vs 机上 base.apk）+ 处理 01:12 中断复验留下的 RFX 事项。"""
import json, time
from devlib import *

log("== R1 resume after interruption", time.strftime("%c"))
cand = sha_file(CANDIDATE)
path = sh(f"pm path {PKG}").splitlines()[0].replace("package:", "")
dev = sh(f"sha256sum {path}").split()[0]
log("candidate", cand, "device base.apk", dev, "MATCH" if cand == dev else "MISMATCH")
ver = sh(f"dumpsys package {PKG} | grep -E 'versionName|lastUpdateTime' | head -3")
log("pkg", ver.replace("\n", " | "))
log("ready", wait_ready())
st = cdp_eval("""(async()=>{const A=__ATTENTION_INBOX__;const s=A.state.settings;
const p=(await Capacitor.Plugins.LocalNotifications.getPending()).notifications||[];
return {now:Date.now(),items:A.state.items.map(i=>({id:i.id,rfx:(i.title||'').includes('RFX'),status:i.status,triggerAt:i.triggerAt,title:(i.title||'').includes('RFX')?i.title:null})),
dnd:s.dnd,quietStart:s.quietStart,quietEnd:s.quietEnd,index:localStorage.getItem('attention-inbox-delivered-notif-index'),
pending:p.map(n=>({id:n.id,at:n.schedule&&n.schedule.at,itemId:n.extra&&n.extra.itemId,event:n.extra&&n.extra.event}))}})()""")
log("state", json.dumps(st, ensure_ascii=False))
rfx_notif = [b[:200] for b in notif_records("RFX")]
log("RFX notifications in shade:", len(rfx_notif))
left = [i for i in st["items"] if i["rfx"]]
res = {"candidateSha": cand, "deviceBaseSha": dev, "match": cand == dev, "stateBefore": st, "rfxNotifBefore": len(rfx_notif), "leftoverDeleted": []}
for it in left:
    ok = delete_item(it["id"])
    time.sleep(2)
    res["leftoverDeleted"].append({"id": it["id"], "ok": ok, "pendingAfter": pending_for(it["id"]), "state": item_state(it["id"]), "idb": idb_item(it["id"])})
    log("deleted leftover", json.dumps(res["leftoverDeleted"][-1], ensure_ascii=False))
res["rfxNotifAfter"] = len(notif_records("RFX"))
(RAW / "r1-identity-leftover.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
log("R1 done")
