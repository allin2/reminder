#!/usr/bin/env python3
"""Disposable production-page P2-F2 smoke; no user profile or persistent data."""
import http.server,json,os,pathlib,subprocess,tempfile,threading,time,urllib.request,websocket
for k in ("http_proxy","https_proxy","HTTP_PROXY","HTTPS_PROXY","all_proxy","ALL_PROXY"): os.environ.pop(k,None)
ROOT=pathlib.Path(__file__).resolve().parents[2]; PORT,CDP=18993,18994; CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
class H(http.server.BaseHTTPRequestHandler):
 def log_message(self,*a): pass
 def do_GET(self):
  p=ROOT/(self.path.split("?",1)[0].lstrip("/") or "index.html")
  if not p.is_file() or p.name=="sw.js": self.send_error(404); return
  self.send_response(200);self.end_headers();self.wfile.write(p.read_bytes())
class C:
 def __init__(s,u): s.w=websocket.create_connection(u,timeout=20);s.i=0
 def e(s,x):
  s.i+=1;s.w.send(json.dumps({"id":s.i,"method":"Runtime.evaluate","params":{"expression":x,"awaitPromise":True,"returnByValue":True}}))
  while 1:
   r=json.loads(s.w.recv())
   if r.get("id")==s.i:return r.get("result",{}).get("result",{}).get("value")
srv=http.server.ThreadingHTTPServer(("127.0.0.1",PORT),H);threading.Thread(target=srv.serve_forever,daemon=True).start()
p=subprocess.Popen([CHROME,"--headless=new",f"--user-data-dir={tempfile.mkdtemp(prefix='views-')}",f"--remote-debugging-port={CDP}","--remote-allow-origins=*","--no-first-run","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 for _ in range(100):
  try: tabs=json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP}/json"));break
  except Exception: time.sleep(.1)
 c=C(next(t for t in tabs if t.get("type")=="page")["webSocketDebuggerUrl"]);c.e(f"location.href='http://127.0.0.1:{PORT}/index.html';true");time.sleep(1.2)
 out=c.e("""(async()=>{const a=window.__ATTENTION_INBOX__,r=await a.ready(),s=a.state,now=Date.now();s.settings.dnd=false;s.items=[{id:'view-i',title:'view item',status:'waiting',priority:'normal',triggerAt:now-1,createdAt:now,updatedAt:now,rev:1,tags:[]},{id:'arch-i',title:'archive item',status:'archived',priority:'normal',completedAt:now-86400000,createdAt:now-86400000,updatedAt:now,rev:1,tags:[]}];a.renderHome();const home=!!document.querySelector('[data-id=\"view-i\"]');document.querySelector('[data-tab=\"future\"]').click();const future=document.querySelector('#view-future').classList.contains('active');const archive=typeof a.views.renderArchiveList()==='string';document.querySelector('[data-tab=\"notes\"]').click();const notes=document.querySelector('#view-notes').classList.contains('active');document.querySelector('[data-tab=\"me\"]').click();const me=document.querySelector('#view-me').classList.contains('active');const stats=(a.views.renderStats(),true);return {ready:r,views:a.viewsSurface,home,future,archive,notes,me,stats};})()""")
 print(json.dumps(out,ensure_ascii=False))
 if not out or not all(out.get(k) for k in ("ready","home","future","archive","notes","me","stats")) or not out.get("views",{}).get("hasDetail"): raise SystemExit(1)
finally:p.terminate();srv.shutdown()
