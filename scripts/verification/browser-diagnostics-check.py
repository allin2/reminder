#!/usr/bin/env python3
"""P2-D：真实生产脚本的诊断面冒烟检查。

使用本地 HTTP 服务和隔离 headless Chrome，加载当前 index.html 的完整生产链，
不注入算法、不接触真实设备。检查纯 Web ready、诊断面可打开、无桥状态如实显示，
以及重复 bind/visibilitychange 不产生重复刷新。
"""
import http.server, json, os, pathlib, subprocess, tempfile, threading, time, urllib.request
import websocket

for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
    os.environ.pop(k, None)
os.environ["NO_PROXY"] = "*"
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(os.environ.get("DIAGNOSTICS_CHECK_OUT", "/tmp/attention-diagnostics"))
OUT.mkdir(parents=True, exist_ok=True)
PORT, CDP = 18881, 18882
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        rel = self.path.split("?", 1)[0].lstrip("/") or "index.html"
        if rel == "sw.js": self.send_error(404); return
        p = ROOT / rel
        if not p.is_file(): self.send_error(404); return
        self.send_response(200)
        self.send_header("Content-Type", "text/html" if rel.endswith(".html") else "text/javascript")
        self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(p.read_bytes())

class Cdp:
    def __init__(self, url): self.ws=websocket.create_connection(url, timeout=20); self.i=0
    def call(self, method, params=None):
        self.i += 1; ident=self.i
        self.ws.send(json.dumps({"id":ident,"method":method,"params":params or {}}))
        while True:
            msg=json.loads(self.ws.recv())
            if msg.get("id") == ident: return msg.get("result", {})
    def ev(self, expr):
        r=self.call("Runtime.evaluate", {"expression":expr,"awaitPromise":True,"returnByValue":True})
        if "exceptionDetails" in r: return {"__exception__": str(r["exceptionDetails"])}
        return r.get("result",{}).get("value")

def main():
    server=http.server.ThreadingHTTPServer(("127.0.0.1",PORT),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    profile=tempfile.mkdtemp(prefix="attention-diagnostics-")
    proc=subprocess.Popen([CHROME,"--headless=new",f"--user-data-dir={profile}",f"--remote-debugging-port={CDP}","--remote-allow-origins=*","--no-first-run","--no-default-browser-check","about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    result={"cases":[],"failures":[]}
    try:
        for _ in range(100):
            try:
                tabs=json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP}/json",timeout=1)); break
            except Exception: time.sleep(.1)
        tab=next((t for t in tabs if t.get("type")=="page"), tabs[0])
        c=Cdp(tab["webSocketDebuggerUrl"])
        c.call("Page.enable")
        c.call("Runtime.enable")
        c.call("Page.navigate", {"url":f"http://127.0.0.1:{PORT}/index.html?diag=1"})
        time.sleep(1.5)
        ready=c.ev("window.__ATTENTION_INBOX__ && window.__ATTENTION_INBOX__.ready()")
        startup=c.ev("window.__ATTENTION_INBOX__ && window.__ATTENTION_INBOX__.startupFailure()")
        result["cases"].append({"name":"pure-web-ready","ready":ready,"startupFailure":startup})
        if ready is not True or startup not in (None,): result["failures"].append("pure-web-ready")
        opened=c.ev("(()=>{const b=document.querySelector('#btnNotifyLab'); if(!b) return false; b.click(); return document.querySelector('#sheetNotifyLab').classList.contains('open')})()")
        time.sleep(.2)
        unavailable=c.ev("document.querySelector('#labBridge').textContent")
        result["cases"].append({"name":"web-diagnostics-open","opened":opened,"system":unavailable})
        if opened is not True or not unavailable or "无" not in unavailable: result["failures"].append("web-diagnostics-open")
        count=c.ev("(()=>{const d=window.__ATTENTION_INBOX__.diagnostics; let n=0; const old=document.addEventListener; document.addEventListener=function(){n++; return old.apply(this,arguments)}; d.bind(); d.bind(); document.addEventListener=old; return n})()")
        result["cases"].append({"name":"bind-idempotent","refreshes-after-double-bind":count})
        if count != 0: result["failures"].append("bind-idempotent")
        fake=c.ev("(async()=>{const C=AttentionLib.AppDiagnostics.createAppDiagnostics; const ns={}; const q=s=>ns[s]||(ns[s]={textContent:'',className:'',style:{},classList:{contains:()=>false},disabled:false,hidden:false}); const b={diagnose:async()=>({notificationsEnabled:true,postNotificationsGranted:true,canUseFullScreenIntent:true,canDrawOverlays:true}),lastAlarmDelivery:async()=>({attempted:true,at:1,visible:true,shownAt:2}),alarmTrace:async()=>({events:[]}),openBackgroundSettings:async()=>{throw new Error('denied')}}; const d=C({query:q,queryAll:()=>[],openSheet(){},toast(){},fmtTime:()=>'',getState:()=>({settings:{notify:true},items:[]}),save:async()=>{},renderMe(){},systemBridge:()=>b,appSettingsPlugin:()=>null,getNativeReminderStatus:()=>({enabled:true,desired:1,alarmCount:1}),setNativeReminderStatus(){},requestNativeNotificationPermission:async()=>{},openExactAlarmSettings:async()=>{},buildDesired:()=>[{}],syncNativeRemindersNow:async()=>({}),getCapacitor:()=>({Plugins:{LocalNotifications:{getPending:async()=>({notifications:[{}]})}}}),getDocument:()=>({addEventListener(){},visibilityState:'visible'})}); await d.refreshNotifyLab(); await d.openBackgroundGuide('background'); return {verdict:q('#labVerdict').textContent,scheduled:q('#labScheduled').textContent,feedback:q('#labSettingsFeedback').textContent,restored:q('#labOpenBackground').disabled===false};})()")
        result["cases"].append({"name":"fake-bridge-diagnostics","value":fake})
        if not fake or not fake.get("verdict"): result["failures"].append("fake-bridge-diagnostics")
        if not fake or not fake.get("restored"): result["failures"].append("navigation-failure-recovery")
    finally:
        (OUT/"browser-diagnostics.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
        proc.terminate(); server.shutdown()
    print(json.dumps(result,ensure_ascii=False))
    return 1 if result["failures"] else 0

if __name__ == "__main__": raise SystemExit(main())
