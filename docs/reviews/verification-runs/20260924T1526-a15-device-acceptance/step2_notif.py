"""A15-2：普通档系统通知上的动作按钮（完成 / 稍后 2 小时 / 我知道了），应用在后台时由真实点击触发。"""
from devlib import *

start_app(); log("== STEP2 ready", wait_ready())
trig = next_minute_ms(1)
plan = [("N1", "完成"), ("N2", "稍后 2 小时"), ("N3", "我知道了")]
items = {}
stamp = time.strftime("%H%M%S")
for tag, act in plan:
    tok = f"A15{tag}-{stamp}"
    r = create_item_via_form(f"{tok} 通知按钮", trig, "normal")
    log("create", tag, json.dumps(r["item"], ensure_ascii=False))
    items[tag] = {"token": tok, "id": r["item"]["id"], "action": act, "before": r["item"]}
json.dump(items, open(RAW / "step2-items.json", "w"), ensure_ascii=False, indent=1)
time.sleep(2)
log("native status", json.dumps(cdp_eval("(()=>{const s=__ATTENTION_INBOX__.getNativeReminderStatus();return {desired:s.desired,scheduled:s.scheduled,alarmScheduled:s.alarmScheduled,errors:s.errors}})()"), ensure_ascii=False))
home(); log("app backgrounded; focus", focus(), "wait until", trig)
while time.time() * 1000 < trig + 8000:
    time.sleep(5); wake()
for _ in range(20):
    recs = {t: notif_records(v["token"]) for t, v in items.items()}
    if all(recs.values()): break
    time.sleep(3)
for t, v in items.items():
    v["posted"] = bool(recs[t]); log("posted", t, v["posted"])
(RAW / "step2-notif-before.txt").write_text(notif_dump())
wake(); sh("cmd statusbar expand-notifications"); time.sleep(2)
screenshot("step2-shade-before")

for tag, v in items.items():
    if not v["posted"]:
        v["tapped"] = False; continue
    wake(); sh("cmd statusbar expand-notifications"); time.sleep(1.5)
    nodes = ui_nodes()
    title_node = next((n for n in nodes if v["token"] in n["text"]), None)
    if not title_node:
        log(tag, "title not visible in shade"); v["tapped"] = False; continue
    # 动作按钮在该通知标题之下、下一条通知之前；若折叠，先点展开箭头或长按展开
    def buttons():
        ns = ui_nodes()
        tn = next((n for n in ns if v["token"] in n["text"]), None)
        if not tn: return None, ns
        cand = [n for n in ns if n["text"] == v["action"] and n["cy"] > tn["cy"]]
        cand.sort(key=lambda n: n["cy"])
        return (cand[0] if cand else None), ns
    btn, ns = buttons()
    if not btn:
        # 尝试展开：在标题上向下两指/单指下拉
        tn = next((n for n in ns if v["token"] in n["text"]), None)
        sh(f"input swipe {tn['cx']} {tn['cy']} {tn['cx']} {tn['cy']+400} 300"); time.sleep(1.5)
        btn, ns = buttons()
    screenshot(f"step2-{tag}-before-tap")
    if not btn:
        log(tag, "action button not found; texts:", [n["text"] for n in ns if n["text"]][:60]); v["tapped"] = False; continue
    log(tag, "tap", v["action"], btn["bounds"]); tap(btn); v["tapped"] = True
    time.sleep(4)
    sh("cmd statusbar collapse"); time.sleep(1)
    v["notif_after_tap"] = bool(notif_records(v["token"]))
    log(tag, "notification still present after tap:", v["notif_after_tap"], "focus", focus())
    home()

time.sleep(3)
(RAW / "step2-notif-after.txt").write_text(notif_dump())
screenshot("step2-after")
for tag, v in items.items():
    v["mem"] = item_state(v["id"]); v["idb"] = idb_item(v["id"])
    log(tag, "mem", json.dumps(v["mem"], ensure_ascii=False)); log(tag, "idb", json.dumps(v["idb"], ensure_ascii=False))
json.dump(items, open(RAW / "step2-items.json", "w"), ensure_ascii=False, indent=1)
