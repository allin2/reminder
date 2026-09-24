#!/usr/bin/env python3
"""Independent production-page P2-F2 exercise of previously untested routes."""
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
PORT, CDP = 19021, 19022

def main():
    srv = mod.http.server.ThreadingHTTPServer(("127.0.0.1", PORT), mod.H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    proc = subprocess.Popen([mod.CHROME, "--headless=new", f"--user-data-dir={tempfile.mkdtemp(prefix='p2f2-independent-')}",
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
          const a=window.__ATTENTION_INBOX__,ready=await a.ready(),s=a.state,now=Date.now();
          s.projects=[{id:'p',name:'Initial project',color:'#1b6b4a'}];
          s.items=[
            {id:'archived',title:'Archived proof',status:'archived',projectId:'p',completedAt:now-1000,createdAt:now-2000,rev:1},
            {id:'due',title:'Due proof',status:'due',projectId:'p',triggerAt:now-1000,createdAt:now-2000,rev:1,url:'javascript:alert(1)'}
          ];
          document.querySelector('[data-tab="future"]').click();
          document.querySelector('#futureSeg [data-seg="archive"]').click();
          const archived=document.querySelector('#futureList').textContent.includes('Archived proof') &&
            document.querySelector('#pageTitle').textContent==='已归档';
          document.querySelector('[data-tab="me"]').click();
          const me=document.querySelector('#view-me').classList.contains('active') &&
            /每天 21:30/.test(document.querySelector('#reviewScheduleSub').textContent);
          document.querySelector('[data-tab="home"]').click();
          const card=document.querySelector('#homeDue .card[data-id="due"]');
          const first=card;a.renderHome();
          const stable=first===document.querySelector('#homeDue .card[data-id="due"]');
          s.projects[0].name='Renamed project';a.renderHome();
          const projectRefresh=first!==document.querySelector('#homeDue .card[data-id="due"]') &&
            document.querySelector('#homeDue').textContent.includes('Renamed project');
          document.querySelector('#homeDue .card[data-id="due"] .card-title').click();
          const detail=document.querySelector('#sheetDetail').classList.contains('open') &&
            document.querySelector('#detailBody').textContent.includes('Due proof');
          const unsafeUrlPlain=!document.querySelector('#detailBody a[href^="javascript:"]') &&
            document.querySelector('#detailBody').textContent.includes('javascript:alert(1)');
          return {ready,archived,me,stable,projectRefresh,detail,unsafeUrlPlain,errors};
        })()""")
    finally:
        proc.terminate()
        srv.shutdown()
    (HERE / "independent-views-ui.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result and all(result.get(k) is True for k in (
        "ready", "archived", "me", "stable", "projectRefresh", "detail", "unsafeUrlPlain")) and not result.get("errors") else 1

if __name__ == "__main__":
    raise SystemExit(main())
