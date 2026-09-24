"""独立复验 R4（F3 收起面板）与 R5（F4 角标）。R5 建一条 R3V 隔离事项，结束时用 deleteItem 清理。"""
from devlib import *
res = {}
LEAK = "(()=>{const v=[];document.querySelectorAll('.sheet').forEach(s=>{const r=s.getBoundingClientRect();if(r.top<innerHeight&&r.bottom>0&&getComputedStyle(s).visibility!=='hidden')v.push(s.id)});return v})()"
start_app(); wait_ready()
cdp_eval("__ATTENTION_INBOX__.closeAllSheets(); true"); time.sleep(0.6)
r4 = {"idle": {}, "cycles": []}
for tab in ("home", "future", "notes", "me"):
    cdp_eval(f"document.querySelector('[data-tab={tab}]').click(); true"); time.sleep(0.8)
    r4["idle"][tab] = cdp_eval(LEAK)
    if "MainActivity" in focus(): screenshot(f"r4-tab-{tab}")
openers = {
    "setup": "document.querySelector('[data-tab=me]').click(); document.querySelector('#btnSetup').click();",
    "capture": "__ATTENTION_INBOX__.openCapture();",
    "demo": "__ATTENTION_INBOX__.openDemoPreview();",
    "guide": "document.querySelector('[data-tab=home]').click(); (document.querySelector('#openGuide,[data-open=guide],.guide-entry')||{click(){}}).click();",
}
for name, js in openers.items():
    cdp_eval(js + " true"); time.sleep(0.8)
    opened = cdp_eval("Array.from(document.querySelectorAll('.sheet.open')).map(s=>[s.id,getComputedStyle(s).visibility])")
    focusable = None
    if name == "capture":
        focusable = cdp_eval("(()=>{const t=document.querySelector('#capText');t.focus();return document.activeElement===t})()")
    cdp_eval("__ATTENTION_INBOX__.closeAllSheets(); true"); time.sleep(0.6)
    leak = cdp_eval(LEAK)
    r4["cycles"].append({"sheet": name, "openedVisible": opened, "captureFocus": focusable, "leakAfterClose": leak})
    log("R4", name, json.dumps(r4["cycles"][-1], ensure_ascii=False))
r4["pass"] = all(not v for v in r4["idle"].values()) and all(not c["leakAfterClose"] for c in r4["cycles"]) \
    and all(any(vis == "visible" for _, vis in c["openedVisible"]) for c in r4["cycles"] if c["sheet"] != "guide") \
    and next(c for c in r4["cycles"] if c["sheet"] == "capture")["captureFocus"] is True
log("R4 idle leaks", r4["idle"], "PASS" if r4["pass"] else "FAIL")
res["R4"] = r4

BADGE = "(()=>{const b=document.querySelector('#navBadge');return {hidden:b.hidden,display:getComputedStyle(b).display,text:b.textContent}})()"
cdp_eval("document.querySelector('[data-tab=home]').click(); true"); time.sleep(0.8)
r5 = {"noDue": cdp_eval(BADGE)}
if "MainActivity" in focus(): screenshot("r5-badge-none")
tok = "R3V-" + time.strftime("%H%M%S"); trig = next_minute_ms(1)
c = create_item_via_form(f"{tok} 角标复验", trig, "normal"); iid = c["item"]["id"]; log("R5 created", json.dumps(c["item"], ensure_ascii=False))
while time.time() * 1000 < trig + 8000: time.sleep(3)
cdp_eval("__ATTENTION_INBOX__.promoteDue&&__ATTENTION_INBOX__.promoteDue(); __ATTENTION_INBOX__.closeAllSheets(); document.querySelector('[data-tab=home]').click(); true"); time.sleep(1.5)
r5["due"] = cdp_eval(BADGE); r5["dueCount"] = cdp_eval("__ATTENTION_INBOX__.state.items.filter(i=>__ATTENTION_INBOX__.isDue(i)).length")
if "MainActivity" in focus(): screenshot("r5-badge-due")
cdp_eval("(async()=>{const A=__ATTENTION_INBOX__;A.deleteItem(%s);A.hideAlert&&A.hideAlert();for(let i=0;i<50&&A.inflightDepth()>0;i++)await new Promise(r=>setTimeout(r,100));await A.saveAsync();return true})()" % json.dumps(iid)); time.sleep(1.5)
r5["afterDelete"] = cdp_eval(BADGE)
if "MainActivity" in focus(): screenshot("r5-badge-cleared")
r5["pass"] = (r5["noDue"]["hidden"] and r5["noDue"]["display"] == "none" and not r5["due"]["hidden"] and r5["due"]["display"] != "none"
              and r5["due"]["text"] == str(r5["dueCount"]) and r5["afterDelete"]["hidden"] and r5["afterDelete"]["display"] == "none")
log("R5", json.dumps(r5, ensure_ascii=False), "PASS" if r5["pass"] else "FAIL")
res["R5"] = r5
time.sleep(4)
res["notifR3VAfter"] = bool(notif_records(tok))
res["itemsAfter"] = cdp_eval("__ATTENTION_INBOX__.state.items.map(i=>i.id)")
log("cleanup: R3V notif remaining", res["notifR3VAfter"], "items", res["itemsAfter"])
json.dump(res, open(RAW / "r4-r5.json", "w"), ensure_ascii=False, indent=1)
