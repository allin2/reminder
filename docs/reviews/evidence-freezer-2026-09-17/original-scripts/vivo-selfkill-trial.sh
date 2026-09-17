#!/usr/bin/env bash
# 假设：fast_freezer 只冻结「活着的」后台进程。
# 若应用在退后台时**自行结束进程**（不是 force-stop，不进 stopped 态），
# 那么闹钟到点时 AMS 必须重新拉起它 —— 没有活进程，也就没有可冻的东西。
#
# 判据：到点后
#   · 台账出现 received / notifyReturned → 投递成功（交付延迟接近 0）
#   · 通知条数 ≥ 1 → 用户可见
#   · events 出现 am_proc_start → 进程确实被重新拉起
#
# 用法：SERIAL=<sn> LABEL=sk-a LEAD=75 bash /tmp/vivo-selfkill-trial.sh

set -uo pipefail
ADB_BIN="$HOME/Library/Android/sdk/platform-tools/adb"
S="${SERIAL:?need SERIAL}"
PKG="space.alliswell.inbox"
LABEL="${LABEL:-sk-a}"
LEAD="${LEAD:-75}"
ITEM_ID="${ITEM_ID:-i_8zju7b9emu5j3pv6}"
RUN=/tmp/vivo-f3; mkdir -p "$RUN"; OUT="$RUN/$LABEL.log"
a() { "$ADB_BIN" -s "$S" "$@"; }
log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$OUT"; }
: > "$OUT"

log "=== 自尽避冻结实验 $LABEL · LEAD=${LEAD}s ==="
a shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1; sleep 1
a shell input swipe 540 2000 540 500 300 >/dev/null 2>&1; sleep 2
a shell wm dismiss-keyguard >/dev/null 2>&1; sleep 1
a shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1; sleep 9
PID=$(a shell pidof "$PKG" | tr -d '\r' | awk '{print $1}')
log "PID=$PID"

a forward --remove-all >/dev/null 2>&1
a forward tcp:9222 localabstract:webview_devtools_remote_"$PID" >/dev/null 2>&1
SET=$(/usr/bin/python3 "$HOME/Developer/reminder/scripts/android-cdp-eval.py" \
  "(async function(){ var A=window.__ATTENTION_INBOX__; var it=A.state.items.filter(function(x){return x.id==='$ITEM_ID';})[0]; if(!it) return JSON.stringify({err:'no item'}); it.triggerAt=Date.now()+$LEAD*1000; it.status='waiting'; it.priority='important'; it.lastAlertShownAt=null; await A.saveAsync(); await new Promise(r=>setTimeout(r,6000)); return JSON.stringify({targetLocal:new Date(it.triggerAt).toLocaleTimeString('zh-CN',{hour12:false})}); })()" 2>&1 | tail -1)
log "设置: $SET"
sleep 2
a shell dumpsys alarm > "$RUN/$LABEL-alarm.txt" 2>/dev/null
log "排程回读: 广播=$(awk '/ACTION_TEST_ALARM/{c++}END{print c+0}' "$RUN/$LABEL-alarm.txt") 服务=$(awk '/AlarmRingService/{c++}END{print c+0}' "$RUN/$LABEL-alarm.txt")"

log "--- 自尽：以应用自身 uid 发 SIGKILL（不是 am kill、不是 force-stop）---"
a shell run-as "$PKG" /system/bin/kill -9 "$PID" 2>&1 | tr -d '\r' | head -2
sleep 2
log "kill 后进程: [$(a shell pidof "$PKG" | tr -d '\r')]"
log "User 0 行: $(a shell dumpsys package "$PKG" 2>/dev/null | tr -d '\r' | awk '/User 0:/{print; exit}')"

a logcat -c -b events 2>/dev/null
( a logcat -v epoch -b events > "$RUN/$LABEL-events.txt" 2>&1 & echo $! > "$RUN/$LABEL-ev.pid" )
sleep 1
a shell input keyevent 223 >/dev/null 2>&1; sleep 2
log "关屏: $(a shell dumpsys power 2>/dev/null | awk -F= '/mWakefulness=/{print $2; exit}' | tr -d '\r')"

log "等到点…"
sleep $((LEAD + 40))

kill "$(cat "$RUN/$LABEL-ev.pid" 2>/dev/null)" 2>/dev/null; rm -f "$RUN/$LABEL-ev.pid"; sleep 1
log "--- 到点后 ---"
log "进程: [$(a shell pidof "$PKG" | tr -d '\r')]"
log "通知条数: $(a shell dumpsys notification --noredact 2>/dev/null | tr -d '\r' | awk '/pkg=space.alliswell.inbox/{c++}END{print c+0}')"
log "屏幕: $(a shell dumpsys power 2>/dev/null | awk -F= '/mWakefulness=/{print $2; exit}' | tr -d '\r')"

a shell run-as "$PKG" cat shared_prefs/alarm_trace.xml > "$RUN/$LABEL-trace.xml" 2>/dev/null
a shell run-as "$PKG" cat shared_prefs/attention_alarm.xml > "$RUN/$LABEL-delivery.xml" 2>/dev/null

echo "" | tee -a "$OUT"
log "--- events（进程生死 / 唤醒 / 冻结）---"
awk '/am_proc_start|am_proc_died|am_app_frozen|am_app_unfrozen|device_idle_wake_from_idle|wm_create_activity/ && (/alliswell|walarm|wake_from_idle/)' "$RUN/$LABEL-events.txt" | sed 's/^/    /' | tee -a "$OUT"
log "=== 结束 ==="
