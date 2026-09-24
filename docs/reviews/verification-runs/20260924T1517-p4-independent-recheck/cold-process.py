#!/usr/bin/env python3
"""Independent v40-to-v42 upgrade with a fresh browser process for offline reopen."""
import importlib.util
import pathlib
import tempfile
import threading
import time
import http.server

src = pathlib.Path(__file__).resolve().parents[1] / "20260924T1405-p4-device-delivery/p4-offline/01-p4-cross-version-offline.py"
spec = importlib.util.spec_from_file_location("p4_impl_fixture", src)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

server = http.server.ThreadingHTTPServer(("127.0.0.1", m.HTTP_PORT), m.P4Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
profile = tempfile.mkdtemp(prefix="p4-independent-cold-")
m.server_state.update(version="v40", offline=False)
c = m.CdpSession(m.CDP_PORT, profile)
try:
    c.evaluate(f"location.href='http://127.0.0.1:{m.HTTP_PORT}/index.html'; true")
    for _ in range(80):
        v = c.evaluate("(async()=>({ready:!!(window.__ATTENTION_INBOX__&&await window.__ATTENTION_INBOX__.ready()), controller:!!navigator.serviceWorker.controller, keys:await caches.keys()}))()")
        if v["ready"] and v["controller"] and "attention-inbox-v40" in v["keys"]:
            break
        time.sleep(.2)
    assert v["ready"] and v["controller"] and "attention-inbox-v40" in v["keys"], v
    c.evaluate("(async()=>{const A=window.__ATTENTION_INBOX__; A.state.items.push(A.makeItem({id:'p4-independent-cold-item',title:'P4_COLD_PROCESS',status:'waiting',priority:'normal',triggerAt:Date.now()+7200000,repeat:null})); await A.saveAsync(); return true})()")
    m.server_state["version"] = "new"
    c.evaluate("(async()=>{const r=await navigator.serviceWorker.getRegistration(); await r.update(); return true})()")
    for _ in range(80):
        keys = c.evaluate("caches.keys()")
        if keys == ["attention-inbox-v42"]:
            break
        time.sleep(.2)
    assert keys == ["attention-inbox-v42"], keys
    print("online upgrade:", v, "new caches:", keys)
finally:
    c.close()

time.sleep(1)
m.server_state["offline"] = True
c = m.CdpSession(m.CDP_PORT, profile)
try:
    c.set_offline(True)
    c.evaluate(f"location.href='http://127.0.0.1:{m.HTTP_PORT}/index.html'; true")
    for _ in range(80):
        result = c.evaluate("(async()=>{const A=window.__ATTENTION_INBOX__; return {ready:!!(A&&await A.ready()), controller:!!navigator.serviceWorker.controller, keys:await caches.keys(), item:!!(A&&A.state.items.find(x=>x.id==='p4-independent-cold-item'&&x.title==='P4_COLD_PROCESS'))}})()")
        if result["ready"] and result["item"]:
            break
        time.sleep(.2)
    assert result["ready"] and result["controller"] and result["item"] and result["keys"] == ["attention-inbox-v42"], result
    print("fresh-process offline:", result)
finally:
    c.close()
    server.shutdown()
