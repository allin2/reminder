"""A15-2b：对已投递的 N1/N2/N3 通知，真实点击动作按钮（应用在后台）。"""
from devlib import *
items = json.load(open(RAW / "step2-items.json"))
(RAW / "step2-notif-own-before.txt").write_text(notif_dump_pkg())
home()
for tag, v in items.items():
    ok, why = tap_notification_action(v["token"], v["action"])
    v["tapped"], v["tapNote"] = ok, why
    log(tag, v["action"], ok, why)
    time.sleep(4)
    sh("cmd statusbar collapse"); time.sleep(1)
    v["focusAfterTap"] = focus()
    v["notifAfterTap"] = bool(notif_records(v["token"]))
    log(tag, "notification still present:", v["notifAfterTap"], "focus", v["focusAfterTap"])
    if "MainActivity" in v["focusAfterTap"]:
        home()
time.sleep(3)
(RAW / "step2-notif-own-after.txt").write_text(notif_dump_pkg())
for tag, v in items.items():
    v["mem"] = item_state(v["id"]); v["idb"] = idb_item(v["id"])
    log(tag, "mem", json.dumps(v["mem"], ensure_ascii=False)); log(tag, "idb", json.dumps(v["idb"], ensure_ascii=False))
home()
json.dump(items, open(RAW / "step2-items.json", "w"), ensure_ascii=False, indent=1)
