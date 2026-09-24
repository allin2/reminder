"""A15-5：用业务命令 deleteItem（UI 删除按钮调用的同一已装饰命令）清理全部 A15 隔离事项，并断言 IDB / 通知 / 系统闹钟 / 屏幕无残留。"""
from devlib import *

def pkg_alarms():
    out = sh("dumpsys alarm", timeout=90)
    res = []
    for l in out.splitlines():
        m = re.search(r"Alarm\{\S+ type \d+ origWhen (\d+).*tag=(\*walarm\*:space\.alliswell\.inbox\S*)", l)
        if m: res.append((int(m.group(1)), m.group(2)))
    return sorted(set(res))

start_app(); log("== STEP5 ready", wait_ready())
ids = cdp_eval("__ATTENTION_INBOX__.state.items.filter(x=>/^A15/.test(x.title)).map(x=>({id:x.id,token:x.title.split(' ')[0],status:x.status,triggerAt:x.triggerAt}))")
others = cdp_eval("__ATTENTION_INBOX__.state.items.filter(x=>!/^A15/.test(x.title)).length")
log("A15 items to delete", json.dumps(ids, ensure_ascii=False), "non-A15 items", others)
alarms_before = pkg_alarms(); log("pkg alarms before cleanup", len(alarms_before), alarms_before)
res = {"deleted": [], "alarmsBefore": alarms_before}
for it in ids:
    r = cdp_eval("""(async()=>{const A=__ATTENTION_INBOX__; const ok=A.deleteItem(%s); A.hideAlert&&A.hideAlert();
      for(let i=0;i<50&&A.inflightDepth()>0;i++) await new Promise(r=>setTimeout(r,100));
      await A.saveAsync(); return {ok, remaining:A.state.items.length};})()""" % json.dumps(it["id"]))
    log("deleteItem", it["token"], r); res["deleted"].append([it["token"], r])
time.sleep(6)
st = cdp_eval("(()=>{const s=__ATTENTION_INBOX__.getNativeReminderStatus();return {desired:s.desired,scheduled:s.scheduled,alarmScheduled:s.alarmScheduled,alarmCount:s.alarmCount,scheduledAlarmIds:s.scheduledAlarmIds,errors:s.errors}})()")
log("native status after delete", json.dumps(st, ensure_ascii=False)); res["nativeStatusAfter"] = st
a_after = pkg_alarms(); log("pkg alarms after cleanup", len(a_after), a_after); res["alarmsAfter"] = a_after
item_times = {it["triggerAt"] for it in ids}
res["alarmsReferencingA15Triggers"] = [a for a in a_after if any(abs(a[0] - t) < 1000 for t in item_times if t)]
res["alarmsNewSinceBaseline"] = [a for a in a_after if a[0] not in (1790256600000, 1790260200000)]
log("alarms still referencing A15 trigger times", res["alarmsReferencingA15Triggers"])
log("alarms other than pre-test baseline (21:30/22:30 review reminders)", res["alarmsNewSinceBaseline"])
own = notif_dump_pkg(); (RAW / "step5-notif-own-after-cleanup.txt").write_text(own)
res["notifA15"] = [t for t in (i["token"] for i in ids) if t in own]
log("A15 notifications remaining", res["notifA15"])
res["ringService"] = sh(f"dumpsys activity services {PKG} | grep ServiceRecord")
log("app services", res["ringService"] or "(none)")
screenshot("step5-after-cleanup-app")

log("-- cold restart (kill -9, not force-stop) and re-read authoritative IDB")
home(); time.sleep(2); p0 = pid(); adb("shell", "run-as", PKG, "kill", "-9", p0); time.sleep(2)
log("killed", p0, "pid now", pid() or "(none)")
start_app(); log("ready", wait_ready()); time.sleep(3)
final = idb_snapshot("06-final-after-cleanup")
base = json.load(open(RAW / "01-pre-install.idb-hashes.json"))
d = diff_snapshots(base, final); res["diffVsBaseline"] = d
log("final vs pre-test baseline", json.dumps(d, ensure_ascii=False))
a, b = raw_state("01-pre-install")["kv/state"], raw_state("06-final-after-cleanup")["kv/state"]
res["finalItemCount"] = len(b["items"]); res["finalA15"] = [i["id"] for i in b["items"] if i.get("title", "").startswith("A15")]
if d["records"].get("kv/state") != "identical":
    res["changedTopKeys"] = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
    res["changedSettings"] = {k: {"before": a.get("settings", {}).get(k), "after": b.get("settings", {}).get(k)} for k in sorted(set(a.get("settings", {})) | set(b.get("settings", {}))) if a.get("settings", {}).get(k) != b.get("settings", {}).get(k)}
    log("changed top keys", res["changedTopKeys"]); log("changed settings", json.dumps(res["changedSettings"], ensure_ascii=False))
res["alarmsAfterRestart"] = pkg_alarms(); log("pkg alarms after restart", res["alarmsAfterRestart"])
res["notifA15AfterRestart"] = [t for t in (i["token"] for i in ids) if t in notif_dump_pkg()]
log("A15 notifications after restart", res["notifA15AfterRestart"])
screenshot("step5-final-app")
json.dump(res, open(RAW / "step5-cleanup.json", "w"), ensure_ascii=False, indent=1)
