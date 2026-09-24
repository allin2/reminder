"""A15-1：安装前后权威 IDB 记录级比对（同一冻结候选覆写安装，不卸载不清数据）。"""
import sys
from devlib import *

log("== STEP1 seed isolated item before install")
start_app(); log("ready", wait_ready())
tok = "A15P1-" + time.strftime("%H%M%S")
trig = int((time.time() + 26 * 3600) * 1000)  # 次日，避免本步内触发
r = create_item_via_form(f"{tok} 安装比对隔离事项", trig, "important")
log("seed", json.dumps(r, ensure_ascii=False))
assert r and r["item"], "seed failed"
seed_id = r["item"]["id"]
json.dump({"seed_id": seed_id, "token": tok}, open(RAW / "step1-seed.json", "w"))
time.sleep(3)
log("idb seed", idb_item(seed_id))
log("alarm dump pre", alarm_dump()[:3000])
pre = idb_snapshot("02-pre-install")
log("pre", json.dumps({k: {x: v[x] for x in ("sha256", "itemCount")} for k, v in pre["stores"]["kv"].items()}))

log("== install -r same frozen candidate")
cand = sha_file(CANDIDATE)
path = sh(f"pm path {PKG}").replace("package:", "")
log("before base.apk", sh(f"sha256sum {path}"), "lastUpdate", sh(f"dumpsys package {PKG} | grep lastUpdateTime"))
home()
p = subprocess.Popen([ADB, "-s", SERIAL, "install", "-r", str(CANDIDATE)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
clicked = []
t0 = time.time()
while p.poll() is None and time.time() - t0 < 120:
    f = focus()
    if "PackageIntercept" in f or "packageinstaller" in f.lower() or "com.vivo.secime" in f:
        nodes = ui_nodes()
        texts = [n["text"] for n in nodes if n["text"]]
        if any("密码" in t for t in texts):
            log("installer asks for password -> abort (not entering credentials)", texts)
            p.kill(); sys.exit(2)
        for want in ("继续安装", "安装", "确定", "完成"):
            n = next((n for n in nodes if n["text"] == want and n["clickable"] or n["text"] == want), None)
            if n:
                log("tap installer", want, f); tap(n); clicked.append(want); time.sleep(1); break
    time.sleep(1)
out, err = p.communicate(timeout=30)
log("install rc", p.returncode, out, err, "clicked", clicked, f"{time.time()-t0:.1f}s")
assert p.returncode == 0 and "Success" in out
path2 = sh(f"pm path {PKG}").replace("package:", "")
after_sha = sh(f"sha256sum {path2}").split()[0]
log("after base.apk", after_sha, path2, "lastUpdate", sh(f"dumpsys package {PKG} | grep lastUpdateTime"))
assert after_sha == cand
time.sleep(5)
log("alarm dump after install (before app start)", alarm_dump()[:3000])

log("== cold start after install")
force_stop(); start_app()
log("ready", wait_ready())
time.sleep(3)
post = idb_snapshot("03-post-install")
d = diff_snapshots(pre, post)
(RAW / "step1-install-diff.json").write_text(json.dumps(d, ensure_ascii=False, indent=1))
log("diff", json.dumps(d, ensure_ascii=False))
log("idb seed after", idb_item(seed_id))
screenshot("step1-post-install")
