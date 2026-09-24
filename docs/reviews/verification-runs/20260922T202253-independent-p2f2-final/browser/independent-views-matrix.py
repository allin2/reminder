#!/usr/bin/env python3
"""Independent real-Chrome exercise of AppViews production instance routes."""
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import threading
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[4]
spec = importlib.util.spec_from_file_location("content_browser", ROOT / "scripts/verification/browser-content-check.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
PORT, CDP = 19031, 19032

def main():
    srv = mod.http.server.ThreadingHTTPServer(("127.0.0.1", PORT), mod.H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    proc = subprocess.Popen([mod.CHROME, "--headless=new", f"--user-data-dir={tempfile.mkdtemp(prefix='p2f2-matrix-')}",
        f"--remote-debugging-port={CDP}", "--remote-allow-origins=*", "--no-first-run", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    result = {}
    try:
        for _ in range(100):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP}/json"))
                break
            except Exception:
                time.sleep(.1)
        c = mod.C(next(t for t in tabs if t.get("type") == "page")["webSocketDebuggerUrl"])
        c.e(f"location.href='http://127.0.0.1:{PORT}/index.html'; true")
        time.sleep(1.5)
        result = c.e(r"""(async()=>{
          const errors=[];window.addEventListener('error',e=>errors.push(e.message));
          const a=window.__ATTENTION_INBOX__,ready=await a.ready(),s=a.state,v=a.views,now=Date.now();
          s.projects=[{id:'p',name:'Project',color:'#1b6b4a'}];
          const due={id:'due',title:'Due card',status:'due',priority:'critical',projectId:'p',
            triggerAt:now-1000,createdAt:now-2000,rev:1,tags:[],deadlineAt:now+3600000,
            deadlinePaused:true,repeat:{every:1,unit:'day',mode:'ack'}};
          const active={id:'active',title:'Active card',status:'acknowledged',priority:'normal',
            acknowledgedAt:now-1000,createdAt:now-2000,rev:1,tags:[]};
          const future={id:'future',title:'Future card',status:'waiting',priority:'important',
            triggerAt:now+3600000,createdAt:now-2000,rev:1,tags:[]};
          const archived={id:'archived',title:'Archived card',status:'archived',priority:'normal',
            completedAt:now-1000,createdAt:now-2000,rev:1,tags:[]};
          s.items=[due,active,future,archived];s.ui.tab='home';s.ui.activeExpanded=false;a.renderHome();
          const homeCollapsed=document.querySelector('#homeDue').textContent.includes('Due card') &&
            !document.querySelector('#activeList').textContent.includes('Active card');
          s.ui.activeExpanded=true;a.renderHome();
          const homeExpanded=document.querySelector('#activeList').textContent.includes('Active card');
          const bad=v.renderItemCard({id:'x" onclick="bad',title:'<img src=x>',status:'waiting',
            priority:'normal',url:'javascript:alert(1)',tags:[]},'future');
          const cardSafety=bad.includes('&lt;img') && bad.includes('&quot;') &&
            !/<a[^>]+href="javascript:/i.test(bad) && bad.includes('linkish-plain');
          const modes=['due','active','future','archived'].map(mode=>v.renderItemCard(due,mode));
          const modeActions=modes[0].includes('data-act="ack"') && modes[1].includes('data-act="reopen"') &&
            modes[2].includes('data-act="edit"') && modes[3].includes('data-act="restore"');
          s.ui.futureSeg='waiting';s.ui.futureFilter='important';s.ui.calSelected=null;v.renderFuture();
          const futureFilter=document.querySelector('#futureList').textContent.includes('Future card') &&
            !document.querySelector('#futureList').textContent.includes('Due card');
          const calendar=!!document.querySelector('#calMount .cal-grid');
          s.ui.futureSeg='archive';v.renderFuture();
          const archive=document.querySelector('#futureList').textContent.includes('Archived card');
          s.notes=[{id:'n1',title:'Pinned note',body:'one',pinned:true,updatedAt:now},
            {id:'n2',title:'Ordinary note',body:'two',pinned:false,updatedAt:now+1}];
          s.ui.notesFilter='pinned';v.renderNotes();
          const pinned=document.querySelector('#notesList').textContent.includes('Pinned note') &&
            !document.querySelector('#notesList').textContent.includes('Ordinary note');
          v.refreshProjectSelects();document.querySelector('#capProject').value='p';
          s.projects[0].name='Renamed';v.refreshProjectSelects();
          const projectSelect=document.querySelector('#capProject').value==='p' &&
            document.querySelector('#capProject').textContent.includes('Renamed');
          v.openDetail('due');
          const detail=document.querySelector('#detailBody').textContent.includes('截止保护已暂停') &&
            document.querySelector('#detailBody').textContent.includes('周期') &&
            document.querySelector('#detailFoot').textContent.includes('恢复截止保护');
          return {ready,homeCollapsed,homeExpanded,cardSafety,modeActions,futureFilter,calendar,
            archive,pinned,projectSelect,detail,errors};
        })()""")
    finally:
        proc.terminate()
        srv.shutdown()
    (HERE / "independent-views-matrix.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result and all(value is True for key, value in result.items() if key != "errors") and not result.get("errors") else 1

if __name__ == "__main__":
    raise SystemExit(main())
