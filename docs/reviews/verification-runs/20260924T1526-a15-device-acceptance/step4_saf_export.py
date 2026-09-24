"""A15-4a：SAF 导出——点真实 #btnExport，系统 DocumentsUI 选位置保存，拉回文件校验内容。"""
from devlib import *
start_app(); log("== STEP4a ready", wait_ready())
cdp_eval("""(()=>{window.__a15Toasts=[];const t=document.querySelector('#toast');if(t&&!window.__a15Obs){window.__a15Obs=new MutationObserver(()=>{const s=t.textContent.trim(); if(s) window.__a15Toasts.push([Date.now(),s]);});window.__a15Obs.observe(t,{childList:true,subtree:true,characterData:true});}
window.__a15Export=null; const b=document.querySelector('#btnExport'); b.scrollIntoView(); b.click(); return !!t;})()""", gesture=True)
f = ""
for _ in range(20):
    f = focus()
    if "documentsui" in f.lower() or "DocumentsActivity" in f or "files" in f.lower(): break
    time.sleep(1)
log("picker focus", f)
screenshot_path = screenshot("tmp"); import shutil; shutil.move(screenshot_path, RAW_PRIVATE / "step4-export-picker.png")
ns = ui_nodes()
own = [n for n in ns if n["text"] in ("保存", "SAVE", "Save") or "安心收件箱备份" in n["text"] or n["rid"].endswith("toolbar") or "下载" == n["text"] or "Download" == n["text"]]
log("picker own nodes", [(n["text"], n["rid"], n["bounds"]) for n in own])
save = next((n for n in ns if n["text"] in ("保存", "SAVE", "Save") and n["clickable"]), None) or next((n for n in ns if n["text"] in ("保存", "SAVE", "Save")), None)
fname = next((n["text"] for n in ns if "安心收件箱备份" in n["text"]), None)
log("filename field", fname, "save btn", save and save["bounds"])
assert save, "save button not found"
tap(save); time.sleep(3)
# 同名冲突时 DocumentsUI 可能再问一次
ns2 = ui_nodes()
again = next((n for n in ns2 if n["text"] in ("确定", "替换", "OK") and "documentsui" in n["pkg"]), None)
if again: log("second confirm", again["text"]); tap(again); time.sleep(2)
log("focus after save", focus())
time.sleep(2)
toasts = cdp_eval("window.__a15Toasts")
log("app toasts", json.dumps(toasts, ensure_ascii=False))
listing = sh("ls -l --time-style=+%H:%M:%S /sdcard/Download/ | grep 安心收件箱备份")
log("Download listing", listing)
json.dump({"toasts": toasts, "listing": listing, "fileNameField": fname}, open(RAW / "step4-export.json", "w"), ensure_ascii=False, indent=1)
