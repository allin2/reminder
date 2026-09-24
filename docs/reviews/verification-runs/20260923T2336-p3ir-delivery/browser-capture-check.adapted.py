#!/usr/bin/env python3
# P3-I-R 适配副本：只做三处改动（见下方注释），断言逻辑与原脚本逐字相同。
#   1) ROOT 改为绝对路径（副本不在 scripts/verification 下，parents[2] 会算错）
#   2) Chrome 启动参数补 --no-sandbox / --disable-gpu / --disable-dev-shm-usage
#      （本执行环境的 Chrome 无法初始化自身 sandbox，网络服务反复崩溃）
#   3) 补 no_proxy=* —— 原脚本只 pop 代理变量，本环境的代理会把 127.0.0.1 的
#      CDP 请求也送去代理（HTTP 502），与 browser-recovery-check.py 的做法一致。
# 原脚本 scripts/verification/browser-capture-check.py 保持未修改。
#!/usr/bin/env python3
"""Disposable production-page P2-G1 capture check; uses a fresh Chrome profile."""
import http.server,json,os,pathlib,subprocess,tempfile,threading,time,urllib.request,websocket
for k in ("http_proxy","https_proxy","HTTP_PROXY","HTTPS_PROXY","all_proxy","ALL_PROXY"): os.environ.pop(k,None)
os.environ["no_proxy"] = "*"
os.environ["NO_PROXY"] = "*"
ROOT=pathlib.Path("/Users/qlyf/Developer/reminder"); PORT,CDP=18995,18996; CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
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
p=subprocess.Popen([CHROME,"--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",f"--user-data-dir={tempfile.mkdtemp(prefix='capture-')}",f"--remote-debugging-port={CDP}","--remote-allow-origins=*","--no-first-run","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 for _ in range(100):
  try: tabs=json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP}/json"));break
  except Exception: time.sleep(.1)
 c=C(next(t for t in tabs if t.get("type")=="page")["webSocketDebuggerUrl"]);c.e(f"location.href='http://127.0.0.1:{PORT}/index.html';true");time.sleep(1.2)
 out=c.e("""(async()=>{const a=window.__ATTENTION_INBOX__,q=s=>document.querySelector(s),fire=(e,n)=>e.dispatchEvent(new Event(n,{bubbles:true}));await a.ready();q('#fab').click();const one=a.formSession;q('#capText').value='缴费提醒';fire(q('#capText'),'input');q('#capTrigger').value='2026-09-23T09:30';fire(q('#capTrigger'),'input');q('#btnCapMore').click();q('#capRepeat').value='week';fire(q('#capRepeat'),'change');await new Promise(r=>setTimeout(r,20));const opened=!q('#sheetItem').hidden,handpicked=q('#capTrigger').value==='2026-09-23T09:30',more=!q('#capAdvanced').hidden,preview=/下次 5 次/.test(q('#repeatPreview').textContent);a.resetItemSheet();const two=a.formSession;q('#capText').value='缴费';fire(q('#capText'),'blur');const similar=/类似提醒/.test(q('#similarHint').innerHTML)||q('#similarHint').hidden; a.state.items.push({id:'browser-edit',title:'复杂编辑',note:'n',tags:['t'],url:'https://example.test',projectId:'',priority:'important',status:'waiting',triggerAt:Date.now()+3600000,deadlineAt:Date.now()+7200000,repeat:{every:'week',mode:'calendar'}});a.openEditItem('browser-edit');const edit=q('#sheetItemTitle').textContent==='编辑事项'&&!q('#capAdvanced').hidden&&q('#capRepeat').value==='week';return {ready:a.ready!=null,capture:a.captureSurface,opened,handpicked,more,preview,sessionAdvanced:two===one+1,similar,edit};})()""")
 print(json.dumps(out,ensure_ascii=False))
 if not out or not all(out.get(k) for k in ("ready","opened","handpicked","more","preview","sessionAdvanced","similar","edit")) or not out.get("capture",{}).get("hasEdit"): raise SystemExit(1)
finally:p.terminate();srv.shutdown()
