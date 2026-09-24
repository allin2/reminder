"""A15 独立验收共用工具：ADB、WebView CDP、IDB 记录级快照、UI 查找。

只读/写入边界：本模块本身不写业务数据；写入由各步骤脚本显式调用业务命令完成。
证据只保存哈希与隔离事项字段，不保存用户真实事项内容；原始快照另存到 RAW_PRIVATE（仓库外）。
"""
import hashlib
import json
import os
import pathlib
import re
import subprocess
import time
import urllib.request
import xml.etree.ElementTree as ET

import websocket

for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
    os.environ.pop(k, None)

ADB = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
SERIAL = "10ACBF2D3D000RS"
PKG = "space.alliswell.inbox"
MAIN = f"{PKG}/.MainActivity"
RUN = pathlib.Path(__file__).resolve().parent
RAW = RUN / "raw"
ROOT = RUN.parents[3]
CANDIDATE = ROOT / "releases/candidates/20260924T2157-pr3-regression-candidate/app-debug.apk"
RAW_PRIVATE = pathlib.Path(os.environ.get("A15_PRIVATE_DIR", "/private/tmp/claude-501/-Users-qlyf-Developer-reminder/5f5c9ea0-11fa-4ed0-9d48-1e8bad8e2724/scratchpad/pr3-recheck-private"))
RAW.mkdir(exist_ok=True)
RAW_PRIVATE.mkdir(parents=True, exist_ok=True)

LOG = RUN / "run.log"


def log(*a):
    line = time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a)
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def adb(*args, text=True, timeout=60):
    p = subprocess.run([ADB, "-s", SERIAL, *args], capture_output=True, text=text, timeout=timeout)
    return p.returncode, (p.stdout.strip() if text else p.stdout), (p.stderr.strip() if text else p.stderr)


def sh(cmd, timeout=60):
    return adb("shell", cmd, timeout=timeout)[1]


def pid():
    return sh(f"pidof {PKG}").split()[0] if sh(f"pidof {PKG}") else ""


def wake():
    sh("input keyevent KEYCODE_WAKEUP")
    sh("wm dismiss-keyguard")
    time.sleep(0.5)


def focus():
    m = re.search(r"mCurrentFocus=(.*)", sh("dumpsys window | grep mCurrentFocus"))
    return m.group(1) if m else ""


def start_app():
    wake()
    sh(f"am start -W -n {MAIN}")
    time.sleep(2)


def force_stop():
    sh(f"am force-stop {PKG}")
    time.sleep(1)


def home():
    sh("input keyevent KEYCODE_HOME")
    time.sleep(1)


def screenshot(name):
    rc, data, _ = adb("exec-out", "screencap", "-p", text=False)
    if rc == 0 and data:
        (RAW / f"{name}.png").write_bytes(data)
    return RAW / f"{name}.png"


def notif_dump():
    return sh("dumpsys notification --noredact", timeout=90)


def notif_records(title_token):
    """返回 dumpsys 中本包、含 token 的 NotificationRecord 段落。"""
    out = notif_dump()
    blocks = re.split(r"\n\s*NotificationRecord\(", out)
    return [b for b in blocks if f"pkg={PKG}" in b and title_token in b]


def alarm_dump():
    return sh(f"dumpsys alarm | grep -A6 -B2 {PKG}", timeout=90)


# ---------------- CDP ----------------

def cdp_eval(expr, timeout=60, launch=True, gesture=False):
    p = pid()
    if not p:
        if not launch:
            raise RuntimeError("app not running")
        start_app()
        p = pid()
    rc, port, err = adb("forward", "tcp:0", f"localabstract:webview_devtools_remote_{p}")
    port = int(port)
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        deadline = time.time() + 20
        page = None
        while time.time() < deadline:
            try:
                targets = json.loads(opener.open(f"http://127.0.0.1:{port}/json", timeout=10).read().decode())
                page = next((t for t in targets if t.get("type") == "page"), None)
                if page:
                    break
            except Exception:
                pass
            time.sleep(1)
        if not page:
            raise RuntimeError("no page target")
        ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=timeout, suppress_origin=True)
        ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                            "params": {"expression": expr, "returnByValue": True, "awaitPromise": True, "userGesture": gesture}}))
        while True:
            resp = json.loads(ws.recv())
            if resp.get("id") == 1:
                break
        ws.close()
        res = resp.get("result", {})
        if "exceptionDetails" in res:
            raise RuntimeError(json.dumps(res["exceptionDetails"], ensure_ascii=False)[:2000])
        return res.get("result", {}).get("value")
    finally:
        adb("forward", "--remove", f"tcp:{port}")


def wait_ready():
    for _ in range(30):
        try:
            v = cdp_eval("(async()=>{const A=window.__ATTENTION_INBOX__; if(!A) return null; const r=await A.ready(); const sa=A.stateAuthority&&A.stateAuthority(); return {ready:r, status:sa&&sa.status, writesAllowed:sa&&sa.writesAllowed, native:!!(window.Capacitor&&Capacitor.isNativePlatform())};})()")
            if v and v.get("ready") is not None:
                return v
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("app not ready")


# 页面内：稳定序列化 + SHA-256；返回每条 IDB 记录与 localStorage 的哈希，以及 state 记录中逐事项哈希。
SNAPSHOT_JS = r"""
(async () => {
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  async function sha(s) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
  }
  const db = await new Promise((res, rej) => { const r = indexedDB.open('attention-inbox'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const stores = Array.from(db.objectStoreNames);
  const out = { dbVersion: db.version, stores: {}, localStorage: {}, raw: {} };
  for (const s of stores) {
    const tx = db.transaction(s, 'readonly');
    const os = tx.objectStore(s);
    const keys = await new Promise((res, rej) => { const r = os.getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const vals = await new Promise((res, rej) => { const r = os.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    out.stores[s] = {};
    for (let i = 0; i < keys.length; i++) {
      const k = String(keys[i]);
      const c = canon(vals[i]);
      const rec = { sha256: await sha(c), bytes: c.length };
      const v = vals[i];
      if (v && typeof v === 'object' && Array.isArray(v.items)) {
        rec.itemCount = v.items.length;
        rec.items = {};
        for (const it of v.items) rec.items[it.id] = { sha256: await sha(canon(it)), status: it.status, rev: it.rev, triggerAt: it.triggerAt || null };
        rec.topKeys = {};
        for (const tk of Object.keys(v).sort()) rec.topKeys[tk] = await sha(canon(v[tk]));
      }
      out.stores[s][k] = rec;
      out.raw[s + '/' + k] = vals[i];
    }
  }
  db.close();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i); const v = localStorage.getItem(k);
    out.localStorage[k] = { sha256: await sha(v), bytes: v.length };
    out.raw['ls/' + k] = v;
  }
  return out;
})()
"""


def idb_snapshot(name):
    snap = cdp_eval(SNAPSHOT_JS, timeout=120)
    raw = snap.pop("raw")
    (RAW_PRIVATE / f"{name}.raw.json").write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    (RAW / f"{name}.idb-hashes.json").write_text(json.dumps(snap, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    return snap


def diff_snapshots(a, b):
    """记录级对比：每个 store/key、localStorage key、state 内逐事项。"""
    d = {"storesAdded": [], "storesRemoved": [], "records": {}, "localStorage": {}}
    for s in sorted(set(a["stores"]) | set(b["stores"])):
        if s not in a["stores"]:
            d["storesAdded"].append(s); continue
        if s not in b["stores"]:
            d["storesRemoved"].append(s); continue
        for k in sorted(set(a["stores"][s]) | set(b["stores"][s])):
            ra, rb = a["stores"][s].get(k), b["stores"][s].get(k)
            key = f"{s}/{k}"
            if ra is None or rb is None:
                d["records"][key] = "added" if ra is None else "removed"; continue
            if ra["sha256"] == rb["sha256"]:
                d["records"][key] = "identical"; continue
            info = {"change": "modified"}
            if "items" in ra and "items" in rb:
                ia, ib = ra["items"], rb["items"]
                info["itemsAdded"] = sorted(set(ib) - set(ia))
                info["itemsRemoved"] = sorted(set(ia) - set(ib))
                info["itemsModified"] = {i: {"before": ia[i], "after": ib[i]} for i in sorted(set(ia) & set(ib)) if ia[i]["sha256"] != ib[i]["sha256"]}
                info["itemsIdentical"] = sum(1 for i in set(ia) & set(ib) if ia[i]["sha256"] == ib[i]["sha256"])
                info["topKeysChanged"] = sorted(t for t in set(ra["topKeys"]) | set(rb["topKeys"]) if ra["topKeys"].get(t) != rb["topKeys"].get(t))
            d["records"][key] = info
    for k in sorted(set(a["localStorage"]) | set(b["localStorage"])):
        va, vb = a["localStorage"].get(k), b["localStorage"].get(k)
        d["localStorage"][k] = "added" if va is None else "removed" if vb is None else ("identical" if va["sha256"] == vb["sha256"] else "modified")
    return d


def raw_state(name):
    return json.loads((RAW_PRIVATE / f"{name}.raw.json").read_text(encoding="utf-8"))


# ---------------- UI (uiautomator) ----------------

def ui_nodes():
    sh("uiautomator dump /sdcard/a15-ui.xml", timeout=60)
    xml = sh("cat /sdcard/a15-ui.xml")
    xml = xml[xml.find("<?xml"):] if "<?xml" in xml else xml
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    nodes = []
    for n in root.iter("node"):
        b = re.findall(r"\d+", n.get("bounds", ""))
        if len(b) == 4:
            x1, y1, x2, y2 = map(int, b)
            nodes.append({"text": n.get("text", ""), "desc": n.get("content-desc", ""), "rid": n.get("resource-id", ""),
                          "pkg": n.get("package", ""), "cls": n.get("class", ""), "clickable": n.get("clickable") == "true",
                          "cx": (x1 + x2) // 2, "cy": (y1 + y2) // 2, "bounds": (x1, y1, x2, y2)})
    return nodes


def find_node(pred, tries=10, delay=1.0):
    for _ in range(tries):
        for n in ui_nodes():
            if pred(n):
                return n
        time.sleep(delay)
    return None


def tap(n):
    sh(f"input tap {n['cx']} {n['cy']}")


def sha_file(p):
    return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()


# ---------------- 业务路径：经捕获表单新建（与用户保存同一命令） ----------------

def create_item_via_form(title, trigger_ms, priority="normal"):
    """打开捕获表单、填标题/时间/优先级、调用 saveItemFromForm（runNewCommand + 权威 save）。"""
    js = """
(async () => {
  const A = __ATTENTION_INBOX__;
  const title = %s, trig = %d, pri = %s;
  A.openCapture();
  await new Promise(r => setTimeout(r, 300));
  const d = new Date(trig);
  const pad = n => String(n).padStart(2, '0');
  const local = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  const t = document.querySelector('#capText'); t.value = title; t.dispatchEvent(new Event('input', {bubbles: true}));
  const tr = document.querySelector('#capTrigger'); tr.value = local; tr.dispatchEvent(new Event('change', {bubbles: true}));
  A.markTriggerPicked(true);
  const chip = document.querySelector('#capPriority .chip[data-p="' + pri + '"]'); chip.click();
  const before = A.state.items.length;
  const ok = A.saveItemFromForm();
  for (let i = 0; i < 50; i++) {
    const it = A.state.items.find(x => x.title === title);
    if (it && A.inflightDepth() === 0) break;
    await new Promise(r => setTimeout(r, 100));
  }
  await new Promise(r => setTimeout(r, 800));
  const it = A.state.items.find(x => x.title === title);
  return { ok, before, after: A.state.items.length, item: it ? { id: it.id, title: it.title, status: it.status, rev: it.rev, triggerAt: it.triggerAt, priority: it.priority, delivery_mode: it.delivery_mode, scheduleBasis: it.scheduleBasis, reminderKey: it.reminderKey || null } : null };
})()
""" % (json.dumps(title), trigger_ms, json.dumps(priority))
    return cdp_eval(js)


def next_minute_ms(min_ahead=1):
    """datetime-local 只到分钟：取至少 min_ahead 分钟后、且距离 >=40s 的整分钟。"""
    now = time.time()
    t = (int(now // 60) + min_ahead) * 60
    if t - now < 40:
        t += 60
    return int(t * 1000)


def item_state(item_id):
    return cdp_eval("""(()=>{const it=__ATTENTION_INBOX__.state.items.find(x=>x.id===%s); if(!it) return null; const o={}; for (const k of ['id','title','status','rev','triggerAt','snoozedAt','snoozeCount','acknowledgedAt','completedAt','archivedAt','priority','delivery_mode','reminderKey','lastDeliveredAt','deliveredAt','seriesId']) o[k]=it[k]===undefined?null:it[k]; return o;})()""" % json.dumps(item_id))


def idb_item(item_id):
    """直接从 IDB 权威记录读隔离事项（不经内存 state）。"""
    return cdp_eval("""(async()=>{const db=await new Promise((res,rej)=>{const q=indexedDB.open('attention-inbox');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});
const v=await new Promise((res,rej)=>{const r=db.transaction('kv').objectStore('kv').get('state');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}); db.close();
const it=(v&&v.items||[]).find(x=>x.id===%s); if(!it) return {found:false, count:(v&&v.items||[]).length};
const o={found:true}; for (const k of ['id','title','status','rev','triggerAt','snoozedAt','snoozeCount','acknowledgedAt','completedAt','archivedAt']) o[k]=it[k]===undefined?null:it[k]; return o;})()""" % json.dumps(item_id))


def notif_dump_pkg():
    """只保留本包的 NotificationRecord 段落（避免把其他应用的个人通知写入证据）。"""
    out = notif_dump()
    blocks = re.split(r"\n(?=\s*NotificationRecord\()", out)
    return "\n".join(b for b in blocks if f"pkg={PKG}" in b.split("\n", 1)[0] or f"pkg={PKG}" in b[:400])


def own_nodes(nodes, tokens=("A15",), labels=("安心收件箱", "我知道了", "稍后 2 小时", "完成", "稍后", "展开", "收起")):
    """只返回与本应用相关的节点，用于日志（不记录他人通知文本）。"""
    return [{k: n[k] for k in ("text", "desc", "rid", "bounds", "clickable")} for n in nodes
            if any(t in n["text"] for t in tokens) or n["text"] in labels or n["desc"] in labels or "expand" in n["rid"].lower() or n["text"].isdigit()]


def open_shade_for(token):
    """展开通知栏 → 若本应用分组折叠则点数量徽标展开 → 返回含 token 的文本节点。"""
    wake(); sh("cmd statusbar expand-notifications"); time.sleep(1.5)
    ns = ui_nodes()
    tn = next((n for n in ns if token in n["text"]), None)
    if tn is None:
        badge = next((n for n in ns if n["rid"] == "vivo:id/noti_number"), None)
        if badge:
            tap(badge); time.sleep(1.5); ns = ui_nodes()
            tn = next((n for n in ns if token in n["text"]), None)
    return tn, ns


def tap_notification_action(token, label):
    """找到 token 对应通知，展开它，点击其动作按钮 label。返回 (ok, 说明)。"""
    tn, ns = open_shade_for(token)
    if tn is None:
        # 分组可能已是展开状态但 token 在下一屏；尝试点徽标
        return False, "notification not visible in shade"
    def action_below(ns, tn):
        c = [n for n in ns if n["text"] == label and n["cy"] > tn["cy"] and n["cy"] - tn["cy"] < 500]
        return sorted(c, key=lambda n: n["cy"])[0] if c else None
    btn = action_below(ns, tn)
    if btn is None:
        exp = [n for n in ns if n["rid"] == "android:id/expand_button" and n["desc"] == "展开" and 0 < tn["cy"] - n["cy"] < 150]
        if not exp:
            return False, "no expand button for row"
        tap(exp[0]); time.sleep(1.5)
        ns = ui_nodes(); tn = next((n for n in ns if token in n["text"]), None)
        if tn is None:
            return False, "row vanished after expand"
        btn = action_below(ns, tn)
    if btn is None:
        return False, "action button not found after expand; own labels=" + str([n["text"] for n in ns if n["text"] in ("我知道了", "稍后 2 小时", "完成")])
    tap(btn)
    return True, f"tapped {label} at {btn['bounds']}"
