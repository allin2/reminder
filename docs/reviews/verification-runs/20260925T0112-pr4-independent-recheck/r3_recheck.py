"""复验 R3（经用户同意：临时把默认提醒方式切到 notification，结束后恢复 alarm）。
A1/A3/A4：临时勿扰窗口；B1/B5：勿扰关闭（用户当前基线）；冷启动；清理；恢复；终态快照比对。
用户基线（05:14 读回，用户确认保留）：dnd=false, 23:00–07:30, defaultDeliveryMode=alarm。"""
import json, time, datetime
from devlib import *

def ui_quiet(start, end, dnd):
    return cdp_eval("""(async()=>{const A=__ATTENTION_INBOX__;
const b=document.querySelector('#btnQuiet'); if(b) b.click(); await new Promise(r=>setTimeout(r,300));
document.querySelector('#quietStart').value=%s; document.querySelector('#quietEnd').value=%s;
document.querySelector('#btnSaveQuiet').click(); await new Promise(r=>setTimeout(r,300));
if (A.state.settings.dnd !== %s) document.querySelector('#swDnd').click();
await new Promise(r=>setTimeout(r,500)); await A.saveAsync();
const s=A.state.settings; return {dnd:s.dnd,quietStart:s.quietStart,quietEnd:s.quietEnd};})()""" % (json.dumps(start), json.dumps(end), json.dumps(dnd)))

def ui_mode(mode):
    return cdp_eval("""(async()=>{const A=__ATTENTION_INBOX__;
document.querySelector('#deliveryModeSeg .seg-item[data-mode="%s"]').click();
await new Promise(r=>setTimeout(r,500)); await A.saveAsync(); return A.state.settings.defaultDeliveryMode;})()""" % mode)

def hm(dt): return dt.strftime("%H:%M")
def at_ms(s): return int(datetime.datetime.strptime(s.replace("GMT+08:00 ", ""), "%a %b %d %H:%M:%S %Y").timestamp() * 1000)

def create(text, prio="normal"):
    t0 = time.time() * 1000
    it = create_text_item(text, prio)
    m = int(text.split("分钟")[0])
    ok = it and "RFX" in it["title"] and it["review_status"] == "READY" and abs(it["triggerAt"] - (t0 + m * 60000)) < 60000
    log("created", json.dumps(it, ensure_ascii=False), "assert", ok)
    if not ok:
        if it: delete_item(it["id"])
        raise SystemExit("creation assertion failed; deleted and stopping")
    return it

def wait_pending(iid, secs=60):
    for _ in range(secs // 3):
        p = pending_for(iid)
        if p: return p
        time.sleep(3)
    return []

def wait_notif(token, until_ts):
    while time.time() < until_ts:
        if notif_records(token): return int(time.time() * 1000)
        time.sleep(3)
    return None

def delete_and_watch(iid, token, nid):
    t0 = int(time.time() * 1000); delete_item(iid)
    gone, seen = None, []
    for _ in range(24):
        st = last_status(); seen = st.get("removed") or seen if (st.get("removed")) else seen
        if gone is None and not notif_records(token): gone = int(time.time() * 1000)
        if gone and nid in seen: break
        time.sleep(0.5)
    st = last_status()
    return {"deleteAt": t0, "goneAt": gone, "goneAfterMs": (gone - t0) if gone else None, "removedSeen": seen,
            "statusAfter": st, "notifIdInRemoved": nid in seen,
            "verdict": "PASS" if gone and gone - t0 <= 10000 and nid in seen else "FAIL"}

res = {}
log("== R3 start (user consented to temporary defaultDeliveryMode=notification)")
start_app(); wait_ready()
bs = cdp_eval("(()=>{const s=__ATTENTION_INBOX__.state.settings;return {dnd:s.dnd,quietStart:s.quietStart,quietEnd:s.quietEnd,defaultDeliveryMode:s.defaultDeliveryMode}})()")
log("baseline", bs); res["baseline"] = bs
assert bs == {"dnd": False, "quietStart": "23:00", "quietEnd": "07:30", "defaultDeliveryMode": "alarm"}, bs
res["modeSet"] = ui_mode("notification"); log("mode ->", res["modeSet"]); assert res["modeSet"] == "notification"

# ---------- A ----------
now = datetime.datetime.now().replace(second=0, microsecond=0)
qs, qe = now - datetime.timedelta(minutes=1), now + datetime.timedelta(minutes=6)
qe_ts = int(qe.timestamp() * 1000)
w = ui_quiet(hm(qs), hm(qe), True); log("temp window", w)
assert w == {"dnd": True, "quietStart": hm(qs), "quietEnd": hm(qe)}, w
res["window"] = w
a1 = create("2分钟后提醒我 RFX 复验勿扰丁"); iid, orig = a1["id"], a1["triggerAt"]
p = wait_pending(iid); nid = p[0]["id"] if p else None
d = (at_ms(p[0]["at"]) - qe_ts) if p else None
home()
time.sleep(max(0, orig / 1000 + 30 - time.time()))
n30 = len(notif_records("RFX 复验勿扰丁"))
res["A1"] = {"item": a1, "pending": p, "diffFromQuietEndMs": d, "notifAtOrigPlus30s": n30,
             "verdict": "PASS" if p and d == 0 and n30 == 0 else "FAIL"}
log("A1", res["A1"]["verdict"], "pending", p, "diff", d, "notif@+30s", n30)
got = wait_notif("RFX 复验勿扰丁", qe_ts / 1000 + 90)
res["A3"] = {"deliveredAt": got, "afterQuietEndMs": (got - qe_ts) if got else None, "verdict": "PASS" if got and got >= qe_ts - 1000 else "FAIL"}
log("A3", res["A3"])
(RAW / "r3-a3-notif-pkg.txt").write_text(notif_dump_pkg(), encoding="utf-8")
start_app()
res["A4"] = {"notifId": nid, "stateBefore": item_state(iid)}
res["A4"].update(delete_and_watch(iid, "RFX 复验勿扰丁", nid))
log("A4", json.dumps(res["A4"], ensure_ascii=False))
w = ui_quiet(bs["quietStart"], bs["quietEnd"], bs["dnd"]); log("dnd restored", w)
assert w == {"dnd": bs["dnd"], "quietStart": bs["quietStart"], "quietEnd": bs["quietEnd"]}, w

# ---------- B1 + B5 (DnD off) ----------
b1 = create("2分钟后提醒我 RFX 复验删除乙"); b5 = create("2分钟后提醒我 RFX 复验保留丙")
p1, p5 = wait_pending(b1["id"]), wait_pending(b5["id"])
n1, n5 = (p1[0]["id"] if p1 else None), (p5[0]["id"] if p5 else None)
log("B pending", p1, p5)
home()
latest = max(b1["triggerAt"], b5["triggerAt"]) / 1000
d1 = wait_notif("RFX 复验删除乙", latest + 60); d5 = wait_notif("RFX 复验保留丙", latest + 60)
log("B delivered", d1, d5)
(RAW / "r3-b-delivered-notif-pkg.txt").write_text(notif_dump_pkg(), encoding="utf-8")
start_app()
st5 = cdp_eval("(async()=>{await __ATTENTION_INBOX__.syncNativeRemindersNow('b5-recheck');const s=__ATTENTION_INBOX__.getNativeReminderStatus();return {removed:s.removedDeliveredIds,cleanupError:s.deliveredCleanupError}})()")
home(); time.sleep(2); start_app(); time.sleep(3)
still5 = len(notif_records("RFX 复验保留丙"))
res["B5"] = {"item": b5, "notifId": n5, "deliveredAt": d5, "syncStatus": st5, "statusAfterResume": last_status(), "notifStillPresent": still5,
             "verdict": "PASS" if d5 and still5 == 1 and n5 not in (st5.get("removed") or []) else "FAIL"}
log("B5", json.dumps(res["B5"], ensure_ascii=False))
res["B1"] = {"item": b1, "notifId": n1, "deliveredAt": d1}
res["B1"].update(delete_and_watch(b1["id"], "RFX 复验删除乙", n1))
res["B1"]["b5StillPresentAfterB1Delete"] = len(notif_records("RFX 复验保留丙"))
log("B1", json.dumps(res["B1"], ensure_ascii=False))
p_old = pid(); sh(f"run-as {PKG} kill -9 {p_old}"); time.sleep(2)
start_app(); wait_ready(); time.sleep(4)
idx = cdp_eval("localStorage.getItem('attention-inbox-delivered-notif-index')")
res["B1"]["coldStart"] = {"oldPid": p_old, "newPid": pid(), "b1NotifAfterCold": len(notif_records("RFX 复验删除乙")),
                          "b5NotifAfterCold": len(notif_records("RFX 复验保留丙")), "indexAfterCold": json.loads(idx or "{}")}
res["B1"]["verdict"] = "PASS" if res["B1"]["verdict"] == "PASS" and res["B1"]["coldStart"]["b1NotifAfterCold"] == 0 else "FAIL"
res["B5"]["notifAfterColdStart"] = res["B1"]["coldStart"]["b5NotifAfterCold"]
log("cold start", res["B1"]["coldStart"])
screenshot("r3-after-cold-start") if PKG in focus() else None

# ---------- cleanup ----------
res["cleanupB5"] = delete_and_watch(b5["id"], "RFX 复验保留丙", n5)
log("cleanup B5", json.dumps(res["cleanupB5"], ensure_ascii=False))
res["modeRestored"] = ui_mode(bs["defaultDeliveryMode"]); log("mode restored", res["modeRestored"])
(RAW / "r3-results.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
log("R3 done")
