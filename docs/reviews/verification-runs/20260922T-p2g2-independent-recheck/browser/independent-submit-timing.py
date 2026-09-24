#!/usr/bin/env python3
"""Real Chrome checks for pending/reject/late/success capture submission timing."""
import importlib.util, json, pathlib, subprocess, tempfile, threading, time, urllib.request
HERE=pathlib.Path(__file__).resolve().parent; ROOT=HERE.parents[4]
spec=importlib.util.spec_from_file_location("helper",ROOT/"scripts/verification/browser-content-check.py")
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

PATCH=r"""(()=>{const p=IDBDatabase.prototype;if(!p.__g2orig)p.__g2orig=p.transaction;
p.transaction=function(){const args=[...arguments],mode=args[1];if(mode==='readwrite'&&window.__g2Mode){
 const tx={oncomplete:null,onerror:null,error:null};tx.objectStore=()=>({put(){if(window.__g2Mode==='reject'){
  tx.error=new Error('g2-reject');setTimeout(()=>tx.onerror&&tx.onerror(),0);}return {};}});
 (window.__g2Tx||(window.__g2Tx=[])).push(tx);return tx;}return p.__g2orig.apply(this,args);};return true;})()"""

def session(port,cdp):
    srv=mod.http.server.ThreadingHTTPServer(("127.0.0.1",port),mod.H);threading.Thread(target=srv.serve_forever,daemon=True).start()
    proc=subprocess.Popen([mod.CHROME,"--headless=new",f"--user-data-dir={tempfile.mkdtemp(prefix='p2g2-submit-')}",
      f"--remote-debugging-port={cdp}","--remote-allow-origins=*","--no-first-run","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    for _ in range(100):
        try: tabs=json.load(urllib.request.urlopen(f"http://127.0.0.1:{cdp}/json"));break
        except Exception: time.sleep(.1)
    c=mod.C(next(t for t in tabs if t.get("type")=="page")["webSocketDebuggerUrl"])
    c.e(f"location.href='http://127.0.0.1:{port}/index.html';true");time.sleep(1.3)
    return srv,proc,c

def main():
    out={}
    srv,proc,c=session(19051,19052)
    try:
      out["pendingLate"]=c.e(r"""(async()=>{const a=__ATTENTION_INBOX__;await a.ready();"""+PATCH+r""";
       document.querySelector('#fab').click();document.querySelector('#capText').value='pending item';
       window.__g2Mode='hold';document.querySelector('#btnSaveItem').click();await new Promise(r=>setTimeout(r,100));
       const pending={buttonDisabled:document.querySelector('#btnSaveItem').disabled,
        buttonText:document.querySelector('#btnSaveItem').textContent,sheetOpen:document.querySelector('#sheetItem').classList.contains('open'),
        itemInMemory:a.state.items.some(x=>x.title==='pending item')};
       document.querySelector('[data-close="sheetItem"]').click();a.openCapture({title:'reopened draft',note:'new note'});
       const newSession=a.formSession;window.__g2Mode=null;window.__g2Tx[0].oncomplete();await new Promise(r=>setTimeout(r,100));
       return {pending,lateProtected:a.formSession===newSession&&document.querySelector('#sheetItem').classList.contains('open')&&
        document.querySelector('#capText').value==='reopened draft'&&document.querySelector('#capNote').value==='new note'};})()""")
    finally: proc.terminate();srv.shutdown()
    srv,proc,c=session(19053,19054)
    try:
      out["reject"]=c.e(r"""(async()=>{const a=__ATTENTION_INBOX__;await a.ready();"""+PATCH+r""";
       document.querySelector('#fab').click();document.querySelector('#capText').value='reject item';window.__g2Mode='reject';
       document.querySelector('#btnSaveItem').click();await new Promise(r=>setTimeout(r,150));return {
        rolledBack:!a.state.items.some(x=>x.title==='reject item'),sheetOpen:document.querySelector('#sheetItem').classList.contains('open'),
        draftKept:document.querySelector('#capText').value==='reject item',buttonRestored:!document.querySelector('#btnSaveItem').disabled,
        failureToast:/保存|内容还在/.test(document.querySelector('#toastText').textContent)};})()""")
    finally: proc.terminate();srv.shutdown()
    srv,proc,c=session(19055,19056)
    try:
      out["success"]=c.e(r"""(async()=>{const a=__ATTENTION_INBOX__;await a.ready();document.querySelector('#fab').click();
       document.querySelector('#capText').value='persist item';document.querySelector('#btnSaveItem').click();
       for(let i=0;i<50&&document.querySelector('#sheetItem').classList.contains('open');i++)await new Promise(r=>setTimeout(r,50));
       return {saved:a.state.items.some(x=>x.title==='persist item'),closed:!document.querySelector('#sheetItem').classList.contains('open'),
        buttonRestored:!document.querySelector('#btnSaveItem').disabled,feedback:document.querySelector('#toastText').textContent};})()""")
      c.e("location.reload();true");time.sleep(1.3)
      out["reload"]=c.e("(async()=>{const a=__ATTENTION_INBOX__;await a.ready();return {ready:true,persisted:a.state.items.some(x=>x.title==='persist item')};})()")
    finally: proc.terminate();srv.shutdown()
    checks=[out.get("pendingLate",{}).get("pending",{}).get(k) for k in ("buttonDisabled","sheetOpen","itemInMemory")]
    ok=all(checks) and out.get("pendingLate",{}).get("lateProtected") and all(out.get("reject",{}).values()) and \
      all(out.get("success",{}).get(k) for k in ("saved","closed","buttonRestored")) and out.get("reload",{}).get("persisted")
    out["pass"]=bool(ok);(HERE/"independent-submit-timing.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(out,ensure_ascii=False));return 0 if ok else 1
if __name__=="__main__":raise SystemExit(main())
