#!/usr/bin/env python3
"""D68 真机验证：A-1 自动静音上限（**生产值 5 分钟**）· A-2 首页硬告知 · Q6 文案留证。

用法：
  /usr/bin/python3 scripts/verification/d68-autosilence-home-notice.py \\
      docs/reviews/verification-runs/<utc>-d68-autosilence-home-notice \\
      --serial <sn> --sha256 <apk sha256>

设计要点（与 scripts/verification/vivo-alarm-actions.py 同一套取证惯例）：

1. **A-1 不注入任何测试用的静音窗口**。`AlarmRingService.EXTRA_AUTO_SILENCE_MS` 虽然存在，
   但投递链路（`AlarmTestReceiver.fillDelivery`）**不转发它** —— 也就是说真机上跑到的
   就是**生产值 `AUTO_SILENCE_MS`(5 分钟)**。刻意如此：D48 的教训是「注入过的路径证明不了
   生产路径」。代价是这一轮要真等 5 分钟。

2. A-2 用 `pm revoke/grant POST_NOTIFICATIONS` 制造真实断链。注意 Android 13+ 上这两个命令
   都会**杀掉进程**，所以「恢复后自动消失」这一格在真机上只能走冷启动（onResume 那条通路
   由 test-smoke 第 11b 节做行为级断言：同一个 `setNativeReminderStatus` 漏斗）。

3. 台账一律从 `run-as <pkg> cat shared_prefs/alarm_trace.xml` 读原始 XML，不做二次加工。
   **但绝不假设「拉一次就有全部历史」**：`AlarmTrace` 只保留最后 150 条，而一次
   「重排既有闹钟」写 5 条（cancelled/requested/item/unfreezerScheduled/scheduled）
   ⇒ 可用窗口 ≈ 30 轮。实测遇到过对账密集到 ~1 秒一轮，台账窗口因此只剩几十秒，
   上一版脚本正是这样在等 `ringAutoSilenced` 时读到空表而崩掉的。
   现在的做法是 `Ledger` 累积器（每 2 秒读一次、按 (token,stage,at) 去重累积），
   同时对「5 分钟上限」取两路见证：累积台账 + `attention_alarm` 里 AlarmRingService
   自己写的 `deliveryAt`/`autoSilencedAt`（后者不会被后续重排冲掉）。
"""
import argparse
import hashlib
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("evidence", type=Path)
p.add_argument("--serial", required=True)
p.add_argument("--sha256", required=True)
p.add_argument("--lead-s", type=int, default=30, help="排程提前量（事项 triggerAt = now + lead）")
p.add_argument("--silence-ms", type=int, default=300000, help="生产值，仅用于比对，不注入")
p.add_argument("--tolerance-ms", type=int, default=30000)
p.add_argument("--max-wait-s", type=int, default=420)
a = p.parse_args()

root = Path(__file__).resolve().parents[2]
run = a.evidence.resolve()
run.mkdir(exist_ok=False)
adb = [str(Path.home() / "Library/Android/sdk/platform-tools/adb"), "-s", a.serial]
PKG = "space.alliswell.inbox"
UID = None


def cmd(*args, timeout=60):
    return subprocess.check_output(adb + list(args), timeout=timeout)


def shell(*args, timeout=60):
    return cmd("shell", *args, timeout=timeout)


def cdp(js):
    pid = shell("pidof", PKG).decode().strip().split()[0]
    port = cmd("forward", "tcp:0", "localabstract:webview_devtools_remote_" + pid).decode().strip()
    try:
        return json.loads(subprocess.check_output(
            ["/usr/bin/python3", str(root / "scripts/android-cdp-eval.py"), js, port],
            text=True, timeout=120))
    finally:
        cmd("forward", "--remove", "tcp:" + port)


def save(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n")


def screenshot(path):
    path.write_bytes(cmd("exec-out", "screencap", "-p"))


def prefs_xml(name):
    return shell("run-as", PKG, "cat", "shared_prefs/" + name + ".xml")


def trace_events():
    """读一次台账（**可能是有界缓冲的一个切片**，见 Ledger 的说明）。

    台账是 SharedPreferences XML，读写之间可能读到半截/空文件；这里重试而不是直接抛，
    因为「读空了」在真机上确实发生过（ParseeError: no element found: line 1, column 0）。
    """
    last = None
    for _ in range(3):
        try:
            xml = prefs_xml("alarm_trace")
            node = ET.fromstring(xml).find("string[@name='events']")
            events = json.loads(node.text or "[]")
            if events:
                return events
            last = "台账为空"
        except Exception as error:  # noqa: BLE001 —— 读出任何异常都只说明这一瞬不可读
            last = error
        time.sleep(0.5)
    print("台账读取告警（连续 3 次未取到）: %s" % last, flush=True)
    return []


def alarm_prefs():
    """`attention_alarm` 里的投递/静音记录 —— **独立于台账的第二见证**。

    台账是 150 条的有界缓冲，会被对账刷满；而这两个时间戳由动作本身（投递、自动静音）
    各写一次，不会被后续重排冲掉。所以「5 分钟上限」这条结论应当有两个来源同时成立。

    ⚠️ 解析陷阱：Android 的 SharedPreferences XML 里**只有 boolean/int/long 用 `value=`
    属性**，`<string>` 的值在元素**文本**里。只读 `value=` 会让所有字符串项静默变成
    None —— 上一版就是这样把「第二见证」读空的（`autoSilencedTrace: null`）。
    """
    out = {}
    for node in ET.fromstring(prefs_xml("attention_alarm")):
        name = node.get("name")
        if not name:
            continue
        value = node.get("value")
        out[name] = value if value is not None else (node.text or "")
    return out


def ack_events(events):
    """只认「明确的 ACK 动作」，**不能用 `"ack" in stage`**。

    `localFallbackStopped` 里就含 `ack`（fall**back**）—— 用子串匹配会把它判成 ACK，
    让「自动静音不产生 ACK」这条断言假红（本轮真实发生）。
    ACK 的可信形态只有两种：stage 本身是 ACK，或 `AlarmActivity.finishWithAction`
    记下的 `userAction`（detail = ack/done）。
    """
    hits = []
    for e in events:
        stage = (e.get("stage") or "").strip().lower()
        detail = (e.get("detail") or "").strip().lower()
        if stage in ("ack", "acknowledged", "acknowledge"):
            hits.append(e)
        elif stage == "useraction" and detail in ("ack", "done"):
            hits.append(e)
    return hits


class Ledger:
    """台账累积器 —— 真机取证的硬要求。

    `AlarmTrace.record` 只保留**最后 150 条**事件（AlarmTrace.java:17），而一次
    「重排既有闹钟」就写 5 条（cancelled/requested/item/unfreezerScheduled/scheduled）。
    也就是说台账的可用历史 ≈ 150 ÷ 5 = **30 轮**；对账一旦密集（实测见过 ~1 秒一轮），
    台账窗口就只剩几十秒 —— 「拉一次拿全部历史」在这台机器上不成立。

    因此这里每隔 poll 秒读一次，把每条事件按 (token, stage, at) 去重后**累积**保存：
    即使后面的重排把台账刷满，已经捕获到的证据也不会丢。同时统计重排轮次，
    让评审者知道这次取证的台账窗口有多短。
    """

    def __init__(self):
        self.seen = {}
        self.reads = 0
        self.empty_reads = 0

    def poll(self):
        events = trace_events()
        self.reads += 1
        if not events:
            self.empty_reads += 1
        for e in events:
            self.seen.setdefault((e.get("token"), e.get("stage"), e.get("at")), e)
        return events

    def events(self, token=None):
        rows = [e for (t, _s, _a), e in self.seen.items() if token is None or t == token]
        rows.sort(key=lambda e: e.get("at") or 0)
        return rows

    def stage(self, token, name):
        hits = [e for e in self.events(token) if e.get("stage") == name]
        return hits[-1] if hits else None

    def churn_rounds(self):
        """累积期内观测到的「排程请求」轮次 —— 远超实际需要轮数即说明台账在被打转。"""
        return len({e.get("token") for e in self.seen.values() if e.get("stage") == "requested"})

    def summary(self):
        return {
            "reads": self.reads,
            "emptyReads": self.empty_reads,
            "accumulatedEvents": len(self.seen),
            "scheduleRoundsObserved": self.churn_rounds(),
            "ledgerCapacity": 150,
            "note": "台账保留最后 150 条；每次重排写 5 条 ⇒ 可用窗口 ≈ 30 轮",
        }


def launch():
    shell("input", "keyevent", "KEYCODE_WAKEUP")
    shell("wm", "dismiss-keyguard")
    shell("am", "start", "-W", "-n", PKG + "/.MainActivity")
    time.sleep(6)


def home_notice():
    return cdp(
        "(async()=>{const A=window.__ATTENTION_INBOX__;await A.ready();"
        "const n=document.querySelector('#homeNotice');"
        "const b=document.querySelector('#homeNoticeBtn');"
        "return JSON.stringify({html:n?n.innerHTML:'',kind:b?b.dataset.noticeKind:null,"
        "renderedHeight:n?n.offsetHeight:0,screenNotify:!!A.state.settings.notify})})()")


def last_delivery():
    return cdp(
        "(async()=>{const b=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.SystemBridge;"
        "if(!b||!b.lastAlarmDelivery)return JSON.stringify(null);"
        "return JSON.stringify(await b.lastAlarmDelivery())})()")


def shipped_matches_working_tree(apk_path):
    """源 ↔ 交付物一致性：APK 里的 Web 资源必须与**仓库根**的同名文件逐字节相同。

    `scripts/sync-www.js` 把仓库根拷成 `www/`，`cap sync` 再拷进 `assets/public/`。
    所以根目录是唯一真源 —— 而「构建之后再改根目录源码」会得到一个**看起来验证通过、
    实际跑的是旧文案**的候选包（本轮真实发生过：`app-core.js` 在 10:05 被改，
    APK 却是 09:58 构建的，于是真机上跑的是 D59 之前的错误措辞）。
    APK 的 sha256 只能证明「设备上的包 == 本地候选」，证明不了「候选 == 当前源码」。
    """
    import zipfile
    with zipfile.ZipFile(apk_path) as zf:
        shipped = [n for n in zf.namelist() if n.startswith("assets/public/")]
        rows = []
        for member in sorted(shipped):
            rel = member[len("assets/public/"):]
            local_path = root / rel
            if not local_path.exists():
                # cap 生成物（cordova.js / cordova_plugins.js 等）没有根对应物，跳过
                continue
            shipped_sha = hashlib.sha256(zf.read(member)).hexdigest()
            local_sha = hashlib.sha256(local_path.read_bytes()).hexdigest()
            rows.append({"file": rel,
                         "status": "MATCH" if shipped_sha == local_sha else "STALE_IN_APK",
                         "shippedSha256": shipped_sha[:16],
                         "workingTreeSha256": local_sha[:16]})
    if not rows:
        rows.append({"file": "*", "status": "NOTHING_COMPARED"})
    return rows


def alarm_service_running():
    out = shell("dumpsys", "activity", "services", PKG).decode()
    return "AlarmRingService" in out


def owns_audio():
    """本应用是否还有活跃音频播放（**信息性证据，不作硬判据**）。

    硬判据用「服务是否还在跑」：D59 之后 AlarmRingService 是声音与振动的**唯一**持有者，
    而 `onDestroy → stopRinging() → releasePlayer() + vibrator.cancel()` 是唯一收口点
    （AlarmRingService.java:459-473）。所以「服务停了」可推出「铃声与振动已停」；
    dumpsys audio 只作为旁证留档。
    """
    out = shell("dumpsys", "audio").decode()
    keys = ["aliswell"] + (["uid:" + UID, "uid=" + UID] if UID else [])
    hits = [ln.strip() for ln in out.splitlines() if any(k in ln for k in keys)]
    active = [ln for ln in hits if "started" in ln]
    return {"uid": UID, "matchedCount": len(hits), "activeCount": len(active),
            "active": active[:10], "sample": hits[:20]}


# ---------------- 0. 前置 ----------------
apk_path = shell("pm", "path", PKG).decode().strip().removeprefix("package:")
actual_sha = shell("sha256sum", apk_path).decode().split()[0]
if actual_sha != a.sha256:
    raise SystemExit("设备上的 APK 与候选不一致：%s != %s" % (actual_sha, a.sha256))
pkg_dump = shell("dumpsys", "package", PKG).decode()
m = re.search(r"userId=(\d+)", pkg_dump)
UID = m.group(1) if m else None

# 源 ↔ 交付物一致性（**在真机 sha 核对之外**再加一道）：
# 设备上的包 == 本地候选 只能证明这两者一致，证明不了候选是用当前源码构建的。
candidate_local = root / "releases" / "安心收件箱-debug.apk"
consistency = shipped_matches_working_tree(candidate_local)
stale = [r for r in consistency if r["status"] != "MATCH"]
if stale:
    print("PREFLIGHT 失败：候选包与工作树不一致 —— 先重新构建再验证", flush=True)
    for row in consistency:
        print("  ", json.dumps(row, ensure_ascii=False), flush=True)
    raise SystemExit("候选包内 Web 资源不是当前源码构建的（STALE_IN_APK）；"
                     "重跑 npm run sync:www + cap sync android + android-build.sh 后再来")

source_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
save(run / "metadata.json", {
    "serial": a.serial, "candidateSha256": a.sha256, "deviceApkPath": apk_path,
    "uid": UID, "silenceMsProduction": a.silence_ms, "toleranceMs": a.tolerance_ms,
    "sourceScriptSha256": source_sha, "startedAt": int(time.time() * 1000),
    "sourceArtifactConsistency": consistency,
})
print("PREFLIGHT ok apk=%s uid=%s 源↔交付物=%s" % (actual_sha[:12], UID, "一致"), flush=True)

results = {}

# ---------------- 1. A-2 首页硬告知 ----------------
print("A2 revoke-notification", flush=True)
shell("pm", "revoke", PKG, "android.permission.POST_NOTIFICATIONS")
time.sleep(3)
launch()
notice_revoked = home_notice()
save(run / "a2-revoked-notice.json", notice_revoked)
screenshot(run / "a2-revoked-notice.png")
results["a2RevokedShowsNotice"] = bool(
    notice_revoked["kind"] == "permission"
    and "无法保证提醒" in notice_revoked["html"]
    and notice_revoked["renderedHeight"] > 0
    and notice_revoked["screenNotify"])
print("A2 revoked:", json.dumps(notice_revoked, ensure_ascii=False)[:160], flush=True)

print("A2 grant-notification (negative control)", flush=True)
shell("pm", "grant", PKG, "android.permission.POST_NOTIFICATIONS")
time.sleep(3)
launch()
notice_granted = home_notice()
save(run / "a2-granted-notice.json", notice_granted)
screenshot(run / "a2-granted-notice.png")
results["a2GrantedStaysSilent"] = bool(
    notice_granted["html"] == "" and notice_granted["screenNotify"])
print("A2 granted:", json.dumps(notice_granted, ensure_ascii=False)[:160], flush=True)

# ── 驱动式：应用内总开关关掉 → 必须换成「总开关未开」那一条（与权限那条分开说） ──
print("A2 master-switch off (driven)", flush=True)
cdp("(async()=>{const A=window.__ATTENTION_INBOX__;A.state.settings.notify=false;"
    "await A.saveAsync();A.setNativeReminderStatus({notifications:'granted',reliability:'exact'});"
    "return JSON.stringify(true)})()")
time.sleep(1)
notice_switch = home_notice()
save(run / "a2-switch-off-notice.json", notice_switch)
results["a2SwitchOffDistinct"] = bool(
    notice_switch["kind"] == "switch" and "我的" in notice_switch["html"])
cdp("(async()=>{const A=window.__ATTENTION_INBOX__;A.state.settings.notify=true;"
    "await A.saveAsync();return JSON.stringify(true)})()")
time.sleep(1)
print("A2 switch-off:", json.dumps(notice_switch, ensure_ascii=False)[:160], flush=True)

# ---------------- 2. Q6 自检面板文案留证 ----------------
print("Q6 panel copy", flush=True)
cdp("(async()=>{const n=document.querySelector('.nav-item[data-tab=\"me\"]');"
    "if(n)n.click();return JSON.stringify(!!n)})()")
time.sleep(2)
shell("input", "keyevent", "KEYCODE_WAKEUP")
shell("wm", "dismiss-keyguard")
screenshot(run / "q6-settings-me.png")
# 打开提醒能力自检面板（Q6 的文案就在第 6 项）
cdp("(async()=>{const b=document.querySelector('#btnNotifyLab');if(b)b.click();"
    "return JSON.stringify(!!b)})()")
time.sleep(3)
screenshot(run / "q6-notify-lab-panel.png")
# Q6 文案留证：直接读候选 APK 里的资源（`run-as` 看不到 APK 内的 assets）
import zipfile
with zipfile.ZipFile(root / "releases" / "安心收件箱-debug.apk") as zf:
    shipped = zf.read("assets/public/index.html").decode("utf-8")
results["q6PurposeCopyPresent"] = "直接亮屏弹到最前" in shipped
results["q6OldMechanismCopyGone"] = "Android 14+ 锁屏/息屏弹全屏的必要条件" not in shipped

# ---------------- 3. A-1 自动静音（生产值 5 分钟） ----------------
iid = "d68_autosilence_" + str(int(time.time()))
title = "D68 自动静音验证"
print("A1 creating item triggerAt=now+%ss" % a.lead_s, flush=True)
item = cdp(
    "(async()=>{const A=window.__ATTENTION_INBOX__;await A.ready();"
    "const it=A.makeItem({id:ID,title:TITLE,note:'D68 自动静音专用',priority:'critical',"
    "status:'waiting',triggerAt:Date.now()+LEAD,isFallbackTrigger:false,repeat:null});"
    "A.state.items.push(it);await A.saveAsync();await new Promise(r=>setTimeout(r,5000));"
    "return JSON.stringify(it)})()"
    .replace("ID", json.dumps(iid)).replace("TITLE", json.dumps(title))
    .replace("LEAD", str(a.lead_s * 1000)))
save(run / "a1-item-before.json", item)

# 退到后台 + 息屏：这是「真的需要它自己响、自己停」的那一档
shell("input", "keyevent", "KEYCODE_HOME")
time.sleep(1)
shell("input", "keyevent", "KEYCODE_SLEEP")

ledger = Ledger()

deadline = time.time() + 150
token = None
while time.time() < deadline:
    ledger.poll()
    cands = [e for e in ledger.events() if e.get("stage") == "item" and e.get("detail") == iid]
    if cands:
        token = cands[-1]["token"]
        break
    time.sleep(2)
if not token:
    save(run / "a1-ledger-summary.json", ledger.summary())
    raise SystemExit("A1 失败：150s 内台账里没出现本事项的 token（排程没落地）")
print("A1 token=%s" % token, flush=True)

# 等服务真的开始响（每 2 秒累积一次，见 Ledger：台账窗口可能只有几十秒）
started = None
deadline = time.time() + 150
while time.time() < deadline:
    ledger.poll()
    started = ledger.stage(token, "ringStarted")
    if started:
        break
    time.sleep(2)
if not started:
    save(run / "a1-ledger-summary.json", ledger.summary())
    raise SystemExit("A1 失败：150s 内没有 ringStarted（铃没响，静音上限无从谈起）")
save(run / "a1-ring-started.json", started)
print("A1 ringStarted at=%s detail=%s" % (started["at"], started["detail"]), flush=True)

# 响铃确认：30s 后服务应在跑、音频应活跃
time.sleep(30)
mid = {"serviceRunning": alarm_service_running(), "audio": owns_audio()}
shell("input", "keyevent", "KEYCODE_WAKEUP")
shell("input", "keyevent", "KEYCODE_SLEEP")
screenshot(run / "a1-while-ringing.png")
save(run / "a1-during-ring.json", mid)
print("A1 during:%s" % json.dumps(mid, ensure_ascii=False)[:200], flush=True)

# 等自动静音（生产值 5 分钟）—— 每 2 秒累积，台账被刷满也不丢证据
silenced = None
deadline = time.time() + a.max_wait_s
while time.time() < deadline:
    ledger.poll()
    silenced = ledger.stage(token, "ringAutoSilenced")
    if silenced:
        break
    time.sleep(2)
save(run / "a1-ring-auto-silenced.json", silenced or {})
save(run / "a1-ledger-summary.json", ledger.summary())
if not silenced:
    raise SystemExit("A1 失败：%ss 内没有 ringAutoSilenced" % a.max_wait_s)
delta = silenced["at"] - started["at"]
print("A1 ringAutoSilenced at=%s delta=%sms detail=%s" % (silenced["at"], delta, silenced["detail"]), flush=True)

time.sleep(5)
ledger.poll()
prefs_now = alarm_prefs()
after = {
    "serviceRunning": alarm_service_running(),
    "audio": owns_audio(),
    # 台账里**累积**到的本 token 全部事件（不依赖单次读取，见 Ledger）
    "eventsForToken": ledger.events(token),
    # 独立第二见证：AlarmRingService 自己写下的投递/静音时刻，不会被后续重排冲掉
    "alarmPrefs": {
        "deliveryAt": prefs_now.get("deliveryAt"),
        "autoSilencedAt": prefs_now.get("autoSilencedAt"),
        "autoSilencedTrace": prefs_now.get("autoSilencedTrace"),
        "deliveryTrace": prefs_now.get("deliveryTrace"),
        "carrierSound": prefs_now.get("carrierSound"),
        "deliveryPath": prefs_now.get("deliveryPath"),
    },
}
save(run / "a1-after-silence.json", after)

# 后台/息屏下取回投递结局与事项状态
shell("input", "keyevent", "KEYCODE_WAKEUP")
shell("wm", "dismiss-keyguard")
shell("am", "start", "-W", "-n", PKG + "/.MainActivity")
time.sleep(5)
delivery = last_delivery()
save(run / "a1-last-delivery.json", delivery or {})
item_after = cdp(
    "(async()=>{const A=window.__ATTENTION_INBOX__;await A.ready();"
    "const it=A.state.items.find(x=>x.id===ID)||null;return JSON.stringify(it)})()"
    .replace("ID", json.dumps(iid)))
save(run / "a1-item-after.json", item_after)

prefs = after["alarmPrefs"]
try:
    witness_delta = int(prefs["autoSilencedAt"]) - int(prefs["deliveryAt"])
except (TypeError, ValueError):
    witness_delta = None

checks = {
    "silenceWindowIsProductionValue":
        abs(delta - a.silence_ms) <= a.tolerance_ms,
    "silencedAfterRecordedInDetail":
        ("silencedAfter=%dms" % a.silence_ms) in (silenced.get("detail") or ""),
    "statementSaysNoAck": "no ACK" in (silenced.get("detail") or ""),
    # 只认明确的 ACK 动作（见 ack_events）—— 子串匹配会把 localFallbackStopped 判成 ACK
    "noAckRecorded": not ack_events(after["eventsForToken"]),
    "deliveryRecordKept": bool(item_after) and item_after.get("status") not in ("acknowledged", "archived"),
    # D59：AlarmRingService 是声音与振动的唯一持有者，onDestroy→stopRinging() 是唯一收口点。
    # 因此「服务不在跑」可推出「铃声与振动已停」（dumpsys audio 仅作旁证留档）。
    "serviceStoppedSoSoundStopped": not after["serviceRunning"],
    "ringHappenedBeforeSilence": mid["serviceRunning"],
    # 第二见证：同一结论必须由**另一份记录**独立成立 —— 台账会被对账刷满，
    # 而 AlarmRingService 自己写下的这两个时刻不会。两份记录对不上说明我们读错了 token。
    "secondWitnessMatchesToken": prefs.get("autoSilencedTrace") == token,
    "secondWitnessAgreesOnWindow":
        witness_delta is not None and abs(witness_delta - a.silence_ms) <= a.tolerance_ms,
}
results["a1ProductionSilenceMs"] = delta
results["a1DeltaToleranceMs"] = a.tolerance_ms
results["a1SecondWitnessDeltaMs"] = witness_delta
results["a1Checks"] = checks
results["a1AllChecksPass"] = all(checks.values())
results["a1AutoSilencedFlagOnDelivery"] = (delivery or {}).get("autoSilenced") is True
results["a1CarrierSoundObserved"] = (delivery or {}).get("carrierSound")
# 信息性：这次取证的台账窗口有多短（见 Ledger）。不作为判据 —— 它是既有缺陷的观测值。
results["a1Ledger"] = ledger.summary()
print("A1 checks:%s" % json.dumps(checks, ensure_ascii=False), flush=True)
print("A1 delivery:%s" % json.dumps(delivery or {}, ensure_ascii=False)[:240], flush=True)

# ---------------- 4. D68 防回归：静音之后界面回落不得把铃声重新播起来 ----------------
#
# 注意 `AlarmActivity.onNewIntent` 对**同一个 token** 是早返回的（"duplicateIntent ...
# keep sound playing"），所以这里刻意**沿用同一个 token**：真正被验证的是
# `onResume → restartAlarmEffects()` 这条路径 —— 也正是用户「重新看到界面」时走的那条。
# 判据只看两件事：① 没有第二次 `ringStarted`（界面没自播）；② 服务仍不在跑。
# 音频 dump 仅作旁证留档，不参与判定（它命中不到任何条目时 activeCount 也是 0，会假绿）。
print("A1 guard: relaunch AlarmActivity after silence", flush=True)
alarm_id = token.split(":")[0]
guard = {"attempted": True, "attempts": []}
launch_args = ["am", "start", "--user", "0", "-n", PKG + "/.AlarmActivity",
               "-e", "alarmTraceToken", token, "-e", "alarmTitle", title,
               "-e", "alarmItemId", iid, "--ei", "alarmId", alarm_id]
launched = False
# 两条路都试：直接 am start / 先 run-as 再 am start。
# 本机实测两条都被拒 —— AlarmTestReceiver 与 AlarmActivity 都是 exported=false，
# 而 adb shell 的 uid 不在该包的 uid 集合里，`assertPackageMatchesCallingUid` 直接拒。
# 也就是说这条「同 token 重启界面」的路径**无法从外部驱动**，只能如实记为 NOT_PERFORMED。
for label, args in (("direct", launch_args), ("run-as", ["run-as", PKG] + launch_args)):
    try:
        shell(*args)
        launched = True
        guard["attempts"].append({"via": label, "ok": True})
        break
    except subprocess.CalledProcessError as error:
        guard["attempts"].append({"via": label, "ok": False,
                                  "error": str(error.output)[-200:] if error.output else str(error)})

if launched:
    time.sleep(12)
    ledger.poll()
    ev = ledger.events(token)
    guard["eventsAfterRelaunch"] = ev[-12:]
    guard["ringStartedCountAfterRelaunch"] = len([e for e in ev if e["stage"] == "ringStarted"])
    guard["serviceRunning"] = alarm_service_running()
    guard["audio"] = owns_audio()
    guard["guardHeld"] = (guard["ringStartedCountAfterRelaunch"] == 1
                          and not guard["serviceRunning"])
    screenshot(run / "a1-guard-after-relaunch.png")
else:
    guard["attempted"] = False
    guard["reason"] = "AlarmActivity/AlarmTestReceiver 均 exported=false，adb 无法以同 token 驱动"

save(run / "a1-guard.json", guard)

# 驱动不了也不是「通过」—— 改从**自然生命周期**里取等价证据：
# 累积台账里该 token 的 ringStarted 只出现一次，且静音后服务已不跑。
ledger.poll()
natural = ledger.events(token)
natural_ring_starts = [e for e in natural if e["stage"] == "ringStarted"]
results["a1GuardTested"] = bool(guard.get("attempted"))
results["a1GuardHeldOnDevice"] = guard.get("guardHeld") is True if launched else None
results["a1GuardNotPerformedReason"] = None if launched else guard.get("reason")
results["a1GuardHeldFromLedger"] = bool(
    len(natural_ring_starts) == 1 and not alarm_service_running())
results["a1RingStartedCountObserved"] = len(natural_ring_starts)
print("A1 guard:%s" % json.dumps({k: guard.get(k) for k in
                                  ("attempted", "reason", "guardHeld", "ringStartedCountAfterRelaunch", "serviceRunning")},
                                 ensure_ascii=False), flush=True)
print("A1 guard(ledger): ringStartedCount=%d  guardHeldFromLedger=%s"
      % (len(natural_ring_starts), results["a1GuardHeldFromLedger"]), flush=True)

# ---------------- 5. 收尾：还原设备 ----------------
try:
    cdp("(async()=>{const A=window.__ATTENTION_INBOX__;await A.ready();"
        "const it=A.state.items.find(x=>x.id===ID);"
        "if(it){await A.completeItem(ID);await A.saveAsync();}"
        "return JSON.stringify(true)})()".replace("ID", json.dumps(iid)))
except Exception as error:
    guard["cleanupError"] = str(error)
time.sleep(2)
results["notPerformed"] = sorted(
    k for k in ("a1GuardTested", "a1GuardHeldOnDevice")
    if results.get(k) is False or results.get(k) is None)
save(run / "results.json", results)
print("RESULTS " + json.dumps(results, ensure_ascii=False), flush=True)
# NOT_PERFORMED 不算失败（与 vivo-d45a 报告口径一致）：它表达「这一格没做」，
# 而不是「做了但不对」。真正的失败只认显式 False，且排除未执行项。
failed = [k for k, v in results.items()
          if v is False and k not in ("a1GuardTested", "a1GuardHeldOnDevice")]
print("NOT_PERFORMED %s" % results["notPerformed"], flush=True)
print("FAILED %s" % failed, flush=True)
raise SystemExit(1 if failed else 0)
