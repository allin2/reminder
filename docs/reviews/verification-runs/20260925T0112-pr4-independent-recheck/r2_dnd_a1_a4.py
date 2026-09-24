"""复验 R2：A1（普通档延后到勿扰结束）、A3（结束后送达）、A4（应用内删除后撤除，PR #4）。
基线（05:13 读回）：dnd=false, 23:00–07:30。临时窗口 = 当前分钟-1 ~ +6，结束后恢复基线。"""
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

def hm(dt): return dt.strftime("%H:%M")

log("== R2 A1/A3/A4 recheck (temp window)")
start_app(); wait_ready()
base = idb_snapshot("10-recheck-baseline")
bs = cdp_eval("(()=>{const s=__ATTENTION_INBOX__.state.settings;return {dnd:s.dnd,quietStart:s.quietStart,quietEnd:s.quietEnd,review:s.review}})()")
(RAW / "10-recheck-baseline-settings.json").write_text(json.dumps(bs, ensure_ascii=False, indent=1), encoding="utf-8")
log("baseline settings", json.dumps(bs, ensure_ascii=False))
now = datetime.datetime.now().replace(second=0, microsecond=0)
qs, qe = now - datetime.timedelta(minutes=1), now + datetime.timedelta(minutes=6)
qe_ts = int(qe.timestamp() * 1000)
r = ui_quiet(hm(qs), hm(qe), True); log("temp window set", r)
assert r == {"dnd": True, "quietStart": hm(qs), "quietEnd": hm(qe)}, r

res = {"window": [hm(qs), hm(qe)], "quietEndTs": qe_ts}
a1 = create_text_item("2分钟后提醒我 RFX 复验勿扰甲", "normal"); log("A1 created", json.dumps(a1, ensure_ascii=False))
expect = time.time() * 1000 + 120000
ok = a1 and "RFX" in a1["title"] and a1["review_status"] == "READY" and abs(a1["triggerAt"] - expect) < 60000
if not ok:
    if a1: delete_item(a1["id"])
    raise SystemExit("A1 creation assertion failed; deleted and stopping")
orig = a1["triggerAt"]; iid = a1["id"]
time.sleep(5)
p = pending_for(iid); log("A1 pending", p)
at_ms = int(datetime.datetime.strptime(p[0]["at"].replace("GMT+08:00 ", ""), "%a %b %d %H:%M:%S %Y").timestamp() * 1000) if p else None
res["A1"] = {"item": a1, "pending": p, "pendingAtMs": at_ms, "diffFromQuietEnd": (at_ms - qe_ts) if at_ms else None}
nid = p[0]["id"] if p else None
home()
time.sleep(max(0, orig / 1000 + 30 - time.time()))
blocks = notif_records("RFX 复验勿扰甲")
res["A1"]["notifAtOrigPlus30s"] = len(blocks)
res["A1"]["verdict"] = "PASS" if (at_ms == qe_ts and len(blocks) == 0) else "FAIL"
log("A1", res["A1"]["verdict"], "diff", res["A1"]["diffFromQuietEnd"], "notif@orig+30s", len(blocks))

# A3
delivered_at = None
t_end = time.time() + max(0, qe_ts / 1000 - time.time()) + 90
while time.time() < t_end:
    if time.time() * 1000 >= qe_ts - 2000:
        b = notif_records("RFX 复验勿扰甲")
        if b:
            delivered_at = int(time.time() * 1000); break
    time.sleep(3)
(RAW / "r2-a3-notif-pkg.txt").write_text(notif_dump_pkg(), encoding="utf-8")
res["A3"] = {"deliveredAt": delivered_at, "afterQuietEndMs": (delivered_at - qe_ts) if delivered_at else None,
             "verdict": "PASS" if delivered_at and delivered_at - qe_ts <= 90000 else "FAIL"}
log("A3", res["A3"])

# A4
start_app()
res["A4"] = {"stateBeforeDelete": item_state(iid)}
t0 = int(time.time() * 1000); delete_item(iid)
gone_at, st = None, None
for i in range(20):
    if not notif_records("RFX 复验勿扰甲"):
        gone_at = int(time.time() * 1000); break
    time.sleep(0.5)
st = last_status()
res["A4"].update({"deleteAt": t0, "goneAt": gone_at, "goneAfterMs": (gone_at - t0) if gone_at else None, "status": st, "notifId": nid})
res["A4"]["verdict"] = "PASS" if gone_at and gone_at - t0 <= 10000 and nid in (st.get("removed") or []) else "FAIL"
log("A4", json.dumps(res["A4"], ensure_ascii=False))
screenshot("r2-a4-app") if PKG in focus() else None

r = ui_quiet(bs["quietStart"], bs["quietEnd"], bs["dnd"]); log("restored", r)
res["restored"] = r
assert r == {"dnd": bs["dnd"], "quietStart": bs["quietStart"], "quietEnd": bs["quietEnd"]}, r
(RAW / "r2-a1-a4.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
log("R2 done")
