"""A15-3b：冷进程——应用进程被 kill -9（run-as，debug 包；不清 AlarmManager）后，全屏面板「稍后 2 小时」，冷启动对账。"""
from devlib import *
start_app(); log("== STEP3b ready", wait_ready())
tok = "A15A3-" + time.strftime("%H%M%S")
trig = next_minute_ms(1)
r = create_item_via_form(f"{tok} 冷进程闹钟", trig, "important"); log("create A3", json.dumps(r["item"], ensure_ascii=False))
v = {"token": tok, "id": r["item"]["id"], "trig": trig, "before": r["item"]}
time.sleep(3); home(); time.sleep(3)
p0 = pid(); out = adb("shell", "run-as", PKG, "kill", "-9", p0)
time.sleep(2); v["pidKilled"] = p0; v["killOut"] = out; v["pidAfterKill"] = pid()
log("A3 killed pid", p0, out, "pid now:", v["pidAfterKill"] or "(none)")
v["alarmRegisteredAfterKill"] = str(trig)[:10] in sh("dumpsys alarm", timeout=90)
log("A3 system alarm still registered after kill:", v["alarmRegisteredAfterKill"])
while time.time() * 1000 < trig + 90000:
    f = focus()
    if "AlarmActivity" in f: break
    time.sleep(2)
v["alarmFocus"] = focus(); v["pidAtAlarm"] = pid(); log("A3 focus", v["alarmFocus"], "pid at alarm", v["pidAtAlarm"])
(RAW / "step3-A3-notif-at-alarm.txt").write_text(notif_dump_pkg())
screenshot("step3-A3-alarm-panel")
if "AlarmActivity" in v["alarmFocus"]:
    btn = find_node(lambda n: n["rid"] == f"{PKG}:id/btnSnooze", tries=5)
    tap(btn); v["tapped"] = True; log("A3 tapped 稍后 2 小时", btn["bounds"]); time.sleep(4)
    v["focusAfterTap"] = focus(); v["pidAfterTap"] = pid(); log("A3 after tap focus", v["focusAfterTap"], "pid", v["pidAfterTap"])
    if "MainActivity" not in v["focusAfterTap"]:
        start_app()
    log("A3 ready", wait_ready()); time.sleep(4)
    v["mem"] = item_state(v["id"]); v["idb"] = idb_item(v["id"])
    log("A3 mem", json.dumps(v["mem"], ensure_ascii=False)); log("A3 idb", json.dumps(v["idb"], ensure_ascii=False))
    v["notifAfter"] = bool(notif_records(tok)); v["ringServiceAfter"] = "AlarmRingService" in sh(f"dumpsys activity services {PKG} | grep ServiceRecord")
    snooze_at = v["mem"] and v["mem"]["triggerAt"]
    v["snoozeAlarmRegistered"] = bool(snooze_at) and str(snooze_at)[:10] in sh("dumpsys alarm", timeout=90)
    log("A3 notif", v["notifAfter"], "ringService", v["ringServiceAfter"], "snooze alarm registered", v["snoozeAlarmRegistered"])
    screenshot("step3-A3-after")
else:
    v["tapped"] = False
json.dump(v, open(RAW / "step3b-A3.json", "w"), ensure_ascii=False, indent=1)
home()
