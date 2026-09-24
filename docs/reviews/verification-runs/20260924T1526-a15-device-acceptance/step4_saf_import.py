"""A15-4b：SAF 导入——点真实 #btnImport，系统选择器选刚导出的文件，应用确认框真实点击「确定」，比对导入前后 IDB 记录。"""
from devlib import *
start_app(); log("== STEP4b ready", wait_ready())
pre = json.load(open(RAW / "04-pre-import.idb-hashes.json"))
cdp_eval("""(()=>{window.__a15Toasts=[];const t=document.querySelector('#toast');if(t){if(window.__a15Obs)window.__a15Obs.disconnect();window.__a15Obs=new MutationObserver(()=>{const s=t.textContent.trim(); if(s) window.__a15Toasts.push([Date.now(),s]);});window.__a15Obs.observe(t,{childList:true,subtree:true,characterData:true});}
const b=document.querySelector('#btnImport'); b.scrollIntoView(); b.click(); return true;})()""", gesture=True)
f = ""
for _ in range(20):
    f = focus()
    if "documentsui" in f.lower(): break
    time.sleep(1)
log("picker focus", f)
target = "安心收件箱备份-2026-09-24.json"
node = find_node(lambda n: n["text"] == target, tries=5)
if not node:
    # 进入「下载」
    dl = find_node(lambda n: n["text"] in ("下载", "Downloads") and n["clickable"], tries=2)
    log("navigate to downloads", dl and dl["bounds"])
    if dl: tap(dl); time.sleep(2)
    node = find_node(lambda n: n["text"] == target, tries=5)
log("file node", node and node["bounds"])
assert node, "exported file not visible in picker"
tap(node); time.sleep(3)
log("focus after pick", focus())
ok_text = cdp_eval("(()=>{const s=document.querySelector('#sheetConfirm');const o=document.querySelector('#confirmOk');return {open:s&&!s.hidden&&getComputedStyle(s).display!=='none'&&s.classList.contains('open')||null, body:(document.querySelector('#confirmBody')||{}).textContent, ok:o&&o.textContent.trim()}})()")
log("confirm dialog", json.dumps(ok_text, ensure_ascii=False))
btn = find_node(lambda n: n["pkg"] == PKG and n["text"].strip() == (ok_text or {}).get("ok"), tries=5)
log("confirm ok node", btn and btn["bounds"])
assert btn, "confirm button not found"
tap(btn); time.sleep(4)
toasts = cdp_eval("window.__a15Toasts"); log("toasts", json.dumps(toasts, ensure_ascii=False))
post = idb_snapshot("05-post-import")
d = diff_snapshots(pre, post)
log("import diff", json.dumps(d, ensure_ascii=False))
res = {"toasts": toasts, "diff": d}
if d["records"].get("kv/state") not in ("identical", None):
    a, b = raw_state("04-pre-import")["kv/state"], raw_state("05-post-import")["kv/state"]
    res["settingsChangedKeys"] = sorted(k for k in set(a.get("settings", {})) | set(b.get("settings", {})) if a.get("settings", {}).get(k) != b.get("settings", {}).get(k))
    ia = {i["id"]: i for i in a["items"]}; ib = {i["id"]: i for i in b["items"]}
    res["itemFieldDiffs"] = {k: sorted(f for f in set(ia[k]) | set(ib[k]) if ia[k].get(f) != ib[k].get(f)) for k in ia if k in ib and ia[k] != ib[k]}
    res["otherTopKeysChanged"] = sorted(k for k in set(a) | set(b) if k not in ("items", "settings") and a.get(k) != b.get(k))
    log("detail", json.dumps({k: res[k] for k in ("settingsChangedKeys", "itemFieldDiffs", "otherTopKeysChanged")}, ensure_ascii=False))
json.dump(res, open(RAW / "step4-import.json", "w"), ensure_ascii=False, indent=1)
screenshot("step4-after-import")
