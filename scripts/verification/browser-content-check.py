#!/usr/bin/env python3
"""P2-F1 production-page content smoke in a disposable Chrome profile."""
import http.server, json, os, pathlib, subprocess, tempfile, threading, time, urllib.request, websocket
for k in ("http_proxy","https_proxy","HTTP_PROXY","HTTPS_PROXY","all_proxy","ALL_PROXY"): os.environ.pop(k,None)
os.environ["NO_PROXY"]="*"
ROOT=pathlib.Path(__file__).resolve().parents[2]; OUT=pathlib.Path(os.environ.get("CONTENT_CHECK_OUT","/tmp/attention-content")); OUT.mkdir(parents=True,exist_ok=True)
PORT,CDP=18991,18992; CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
class H(http.server.BaseHTTPRequestHandler):
 def log_message(self,*a): pass
 def do_GET(self):
  rel=self.path.split("?",1)[0].lstrip("/") or "index.html"; p=ROOT/rel
  if rel=="sw.js" or not p.is_file(): self.send_error(404); return
  self.send_response(200); self.send_header("Content-Type","text/html" if rel.endswith(".html") else "text/javascript"); self.send_header("Cache-Control","no-store"); self.end_headers(); self.wfile.write(p.read_bytes())
class C:
 def __init__(self,u): self.w=websocket.create_connection(u,timeout=20); self.i=0
 def e(self,x):
  self.i+=1; self.w.send(json.dumps({"id":self.i,"method":"Runtime.evaluate","params":{"expression":x,"awaitPromise":True,"returnByValue":True}}))
  while 1:
   r=json.loads(self.w.recv())
   if r.get("id")==self.i: return r.get("result",{}).get("result",{}).get("value")
def main():
 srv=http.server.ThreadingHTTPServer(("127.0.0.1",PORT),H); threading.Thread(target=srv.serve_forever,daemon=True).start(); prof=tempfile.mkdtemp(prefix="content-")
 p=subprocess.Popen([CHROME,"--headless=new",f"--user-data-dir={prof}",f"--remote-debugging-port={CDP}","--remote-allow-origins=*","--no-first-run","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); out={"cases":[],"failures":[]}
 try:
  for _ in range(100):
   try: tabs=json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP}/json")); break
   except Exception: time.sleep(.1)
  c=C(next(t for t in tabs if t.get("type")=="page")["webSocketDebuggerUrl"]); c.e("location.href='http://127.0.0.1:%d/index.html'; true"%PORT); time.sleep(1.5)
  value=c.e("""(async()=>{const a=window.__ATTENTION_INBOX__; const ready=await a.ready(); const s=a.state;
    s.items=[{id:'i1',title:'needle item',note:'memo',tags:['needle-tag'],url:'https://needle',projectId:'p1',status:'waiting',priority:'normal',createdAt:Date.now(),updatedAt:Date.now(),rev:1}];
    s.notes=[];s.projects=[{id:'p1',name:'needle project',color:'#1b6b4a'}];
    const x=a.content; x.openNote(null); document.querySelector('#noteTitle').value='needle note';document.querySelector('#noteBody').value='<img onerror=1> needle';x.saveNote();
    x.doSearch('needle');const search=document.querySelector('#searchResults').innerHTML; x.doSearch('onerror');const escaped=document.querySelector('#searchResults').innerHTML;
    document.querySelector('#projName').value='new project';x.addProject();const p=s.projects.find(v=>v.name==='new project');x.deleteProject('p1');
    return {ready, surface:a.contentSurface, note:s.notes.length===1&&s.notes[0].title==='needle note', searchItem:/needle item/.test(search),searchNote:/needle note/.test(search),searchProject:/needle project/.test(search),escaped:/&lt;img/.test(escaped)&&!/<img onerror/.test(escaped),added:!!p,removed:s.items[0].projectId===''&&s.projects.every(v=>v.id!=='p1')};})()""")
  out["cases"].append({"name":"production-content-flow","value":value}); req=("ready","note","searchItem","searchNote","searchProject","escaped","added","removed")
  if not value or not all(value.get(k) is True for k in req) or not value.get("surface",{}).get("hasBind"): out["failures"].append("production-content-flow")
 finally:
  (OUT/"browser-content.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n"); p.terminate(); srv.shutdown()
 print(json.dumps(out,ensure_ascii=False)); return 1 if out["failures"] else 0
if __name__=="__main__": raise SystemExit(main())
