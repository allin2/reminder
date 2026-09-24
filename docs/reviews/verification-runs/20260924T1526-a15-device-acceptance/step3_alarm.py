"""A15-3：重要档全屏闹钟面板动作 + 回前台对账。
A1：应用在后台（进程存活）→ 面板点「我知道了」→ 先读 IDB（未回前台）→ 回前台 → 对账。
A2：应用进程被 am kill（模拟系统回收；不用 force-stop，因其会清掉 AlarmManager）→ 面板点「完成」→ 冷启动 → 对账。
"""
from devlib import *

def wait_alarm_activity(deadline_ms):
    while time.time() * 1000 < deadline_ms:
        f = focus()
        if "AlarmActivity" in f:
            return f
        time.sleep(2)
    return focus()

def run_case(tag, rid, label, kill):
    v = items[tag]
    home()
    if kill:
        sh(f"am kill {PKG}"); time.sleep(2)
        v["pidBeforeTrigger"] = pid()
        log(tag, "after am kill pid=", v["pidBeforeTrigger"] or "(none)")
    log(tag, "waiting for AlarmActivity until", v["trig"])
    f = wait_alarm_activity(v["trig"] + 90000)
    v["alarmFocus"] = f; v["pidAtAlarm"] = pid()
    log(tag, "focus", f, "pid", v["pidAtAlarm"])
    v["notifAtAlarm"] = bool(notif_records(v["token"]))
    (RAW / f"step3-{tag}-notif-at-alarm.txt").write_text(notif_dump_pkg())
    screenshot(f"step3-{tag}-alarm-panel")
    if "AlarmActivity" not in f:
        v["tapped"] = False; return
    btn = find_node(lambda n: n["rid"] == f"{PKG}:id/{rid}", tries=5)
    v["panelTexts"] = [n["text"] for n in ui_nodes() if n["pkg"] == PKG and n["text"]]
    log(tag, "panel texts", v["panelTexts"])
    tap(btn); v["tapped"] = True; log(tag, "tapped", label, btn["bounds"])
    time.sleep(3)
    v["focusAfterTap"] = focus(); v["pidAfterTap"] = pid()
    v["notifAfterTap"] = bool(notif_records(v["token"]))
    v["ringServiceAfterTap"] = "AlarmRingService" in sh(f"dumpsys activity services {PKG} | grep ServiceRecord")
    log(tag, "after tap focus", v["focusAfterTap"], "pid", v["pidAfterTap"], "notif", v["notifAfterTap"], "ringService", v["ringServiceAfterTap"])
    # 回前台之前：若进程存活，读 IDB（不触发前台对账）；读取本身经 CDP，不改业务状态
    if v["pidAfterTap"]:
        v["idbBeforeForeground"] = idb_item(v["id"]); log(tag, "IDB before foreground", json.dumps(v["idbBeforeForeground"], ensure_ascii=False))
    else:
        v["idbBeforeForeground"] = "process not running"
    home(); time.sleep(1)
    start_app(); log(tag, "foreground ready", wait_ready()); time.sleep(4)
    v["memAfterForeground"] = item_state(v["id"]); v["idbAfterForeground"] = idb_item(v["id"])
    log(tag, "mem after fg", json.dumps(v["memAfterForeground"], ensure_ascii=False)); log(tag, "IDB after fg", json.dumps(v["idbAfterForeground"], ensure_ascii=False))
    v["notifAfterForeground"] = bool(notif_records(v["token"]))
    screenshot(f"step3-{tag}-after-foreground")
    log(tag, "notif after fg", v["notifAfterForeground"])

start_app(); log("== STEP3 ready", wait_ready())
stamp = time.strftime("%H%M%S")
t1 = next_minute_ms(1); t2 = t1 + 4 * 60000
items = {}
for tag, t, pri in (("A1", t1, "important"), ("A2", t2, "important")):
    tok = f"A15{tag}-{stamp}"
    r = create_item_via_form(f"{tok} 全屏闹钟", t, pri)
    log("create", tag, json.dumps(r["item"], ensure_ascii=False))
    items[tag] = {"token": tok, "id": r["item"]["id"], "trig": t, "before": r["item"]}
time.sleep(3)
al = sh("dumpsys alarm", timeout=90)
for tag, v in items.items():
    v["systemAlarmRegistered"] = str(v["trig"])[:10] in al
    log(tag, "system alarm with origWhen≈trig registered:", v["systemAlarmRegistered"])
run_case("A1", "btnAck", "我知道了", kill=False)
run_case("A2", "btnDone", "完成", kill=True)
json.dump(items, open(RAW / "step3-items.json", "w"), ensure_ascii=False, indent=1)
home()
