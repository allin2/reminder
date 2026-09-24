#!/usr/bin/env python3
"""Independent production-page exercise for P2-G1 capture/form ownership."""
import importlib.util, json, pathlib, subprocess, tempfile, threading, time, urllib.request
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[4]
spec = importlib.util.spec_from_file_location("browser_helper", ROOT / "scripts/verification/browser-content-check.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
PORT, CDP = 19041, 19042

def main():
    srv = mod.http.server.ThreadingHTTPServer(("127.0.0.1", PORT), mod.H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    proc = subprocess.Popen([mod.CHROME, "--headless=new", f"--user-data-dir={tempfile.mkdtemp(prefix='p2g1-capture-')}",
        f"--remote-debugging-port={CDP}", "--remote-allow-origins=*", "--no-first-run", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    result = {}
    try:
        for _ in range(100):
            try: tabs=json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP}/json")); break
            except Exception: time.sleep(.1)
        c=mod.C(next(t for t in tabs if t.get("type")=="page")["webSocketDebuggerUrl"])
        c.e(f"location.href='http://127.0.0.1:{PORT}/index.html';true"); time.sleep(1.5)
        result=c.e(r"""(async()=>{ try {
          const errors=[];addEventListener('error',e=>errors.push(e.message));
          const a=__ATTENTION_INBOX__,ready=await a.ready(),s=a.state,now=Date.now();
          s.projects=[{id:'p',name:'Capture project',color:'#1b6b4a'}];
          s.items=[{id:'similar" bad',title:'<b>缴费提醒</b>',status:'waiting',priority:'normal',
            triggerAt:now+86400000,createdAt:now,updatedAt:now,rev:1,tags:[]}];
          const before=a.formSession;document.querySelector('#fab').click();
          const opened=document.querySelector('#sheetItem').classList.contains('open')&&a.formSession===before+1;
          const text=document.querySelector('#capText');text.value='缴费提醒';text.dispatchEvent(new Event('input',{bubbles:true}));
          await new Promise(r=>setTimeout(r,450));text.dispatchEvent(new Event('blur',{bubbles:true}));
          const similar=document.querySelector('#similarHint').hidden===false&&
            document.querySelector('#similarHint').innerHTML.includes('&lt;b&gt;')&&
            document.querySelector('#similarHint').innerHTML.includes('&quot;')&&
            !document.querySelector('#similarHint').innerHTML.includes('<b>缴费');
          document.querySelector('#btnCapMore').click();
          const more=!document.querySelector('#capAdvanced').hidden&&document.querySelector('#btnCapMore').getAttribute('aria-expanded')==='true';
          const trigger=document.querySelector('#capTrigger');trigger.value='2026-09-23T09:30';trigger.dispatchEvent(new Event('input',{bubbles:true}));
          document.querySelector('#capRepeat').value='week';document.querySelector('#capRepeat').dispatchEvent(new Event('change',{bubbles:true}));
          const preview=document.querySelector('#repeatPreview').textContent.includes('下次 5 次');
          const selected=document.querySelector('#capProject');selected.value='p';
          const session1=a.formSession;document.querySelector('[data-close="sheetItem"]').click();a.openCapture({title:'缴费提醒'});
          const reopened=a.formSession===session1+1&&document.querySelector('#capText').value==='缴费提醒'&&
            document.querySelector('#capTrigger').value===''&&document.querySelector('#capAdvanced').hidden;
          a.openEditItem('similar" bad');
          const edit=document.querySelector('#sheetItemTitle').textContent==='编辑事项'&&
            document.querySelector('#capText').value==='<b>缴费提醒</b>'&&document.querySelector('#capTrigger').value!=='';
          return {ready,opened,similar,more,preview,reopened,edit,errors};
          } catch(e) { return {caught:String(e),stack:e&&e.stack}; }
        })()""")
    finally: proc.terminate(); srv.shutdown()
    (HERE/'independent-capture-ui.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False))
    return 0 if result and all(v is True for k,v in result.items() if k!='errors') and not result.get('errors') else 1
if __name__=='__main__': raise SystemExit(main())
