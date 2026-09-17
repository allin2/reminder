#!/usr/bin/env bash
# vivo 真机 F3 复测：验证「前台服务解冻 + 广播投递」是否消除 fast_freezer 造成的投递延迟
#
# 用法：
#   SERIAL=<sn> LABEL=f3-a LEAD=75 SCREEN=off bash /tmp/vivo-f3-trial.sh
#
# 与旧试验（/tmp/vivo-alarm-trial.sh）的差别 —— 新增三块取证：
#   1) 排程回读：系统队列里必须**同时**出现广播（ACTION_TEST_ALARM）与前台服务（AlarmRingService）两条
#   2) events 缓冲：am_app_frozen / am_app_unfrozen / device_idle_wake_from_idle / wm_create_activity
#      （旧脚本只看 main/system，看不到冻结事件，这才漏掉了真因）
#   3) 应用侧台账：alarm_trace（unfreezerStarted）与投递台账（deliveryAt），用于算投递延迟
#
# 核心指标：lag = deliveryAt - triggerAt。修复前实测 77000ms（晚 77 秒）。

set -uo pipefail
ADB_BIN="$HOME/Library/Android/sdk/platform-tools/adb"
S="${SERIAL:?need SERIAL}"
PKG="${PKG:-space.alliswell.inbox}"
LABEL="${LABEL:-f3}"
LEAD="${LEAD:-75}"
SCREEN="${SCREEN:-off}"
RUN="${RUN:-/tmp/vivo-f3}"
ITEM_ID="${ITEM_ID:-i_87wsnzxnmu5j3pv5}"

mkdir -p "$RUN"
OUT="$RUN/$LABEL.log"
a() { "$ADB_BIN" -s "$S" "$@"; }
log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$OUT"; }

: > "$OUT"
log "=== F3 试验 $LABEL · SCREEN=$SCREEN LEAD=${LEAD}s ==="

# ---------------------------------------------------------------- 0. 前置
a shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1; sleep 1
a shell input swipe 540 2000 540 500 300 >/dev/null 2>&1; sleep 2
a shell wm dismiss-keyguard >/dev/null 2>&1; sleep 1
a shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1; sleep 9
PID=$(a shell pidof "$PKG" 2>/dev/null | tr -d '\r' | awk '{print $1}')
log "前置: PID=$PID wakefulness=$(a shell dumpsys power 2>/dev/null | grep -m1 'mWakefulness=' | tr -d '\r' | sed 's/.*mWakefulness=//')"
[[ -n "$PID" ]] || { log "✗ 应用没起来，终止"; exit 3; }

# ---------------------------------------------------------------- 1. 设闹钟
a forward --remove-all >/dev/null 2>&1
a forward tcp:9222 localabstract:webview_devtools_remote_"$PID" >/dev/null 2>&1
SET=$(/usr/bin/python3 "$HOME/Developer/reminder/scripts/android-cdp-eval.py" \
  "(async function(){ var A=window.__ATTENTION_INBOX__; var it=A.state.items.filter(function(x){return x.id==='$ITEM_ID';})[0]; if(!it) return JSON.stringify({err:'no item'}); it.triggerAt=Date.now()+$LEAD*1000; it.status='waiting'; it.priority='important'; it.lastAlertShownAt=null; await A.saveAsync(); await new Promise(r=>setTimeout(r,6000)); return JSON.stringify({triggerAt:it.triggerAt, targetLocal:new Date(it.triggerAt).toLocaleTimeString('zh-CN',{hour12:false}), nowLocal:new Date().toLocaleTimeString('zh-CN',{hour12:false}), scheduled:A.state.settings.scheduledAlarmIds.length}); })()" 2>&1 | tail -1)
log "设置结果: $SET"

# ---------------------------------------------------------------- 2. 排程回读（F3 关键：两条都要在）
sleep 3
a shell dumpsys alarm > "$RUN/$LABEL-alarm-before.txt" 2>/dev/null
BCAST=$(grep -c "ACTION_TEST_ALARM" "$RUN/$LABEL-alarm-before.txt" 2>/dev/null || echo 0)
SVC=$(grep -c "AlarmRingService" "$RUN/$LABEL-alarm-before.txt" 2>/dev/null || echo 0)
log "排程回读: 广播条目=$BCAST 前台服务条目=$SVC"
grep -nE "ACTION_TEST_ALARM|AlarmRingService" "$RUN/$LABEL-alarm-before.txt" 2>/dev/null | head -8 | sed 's/^/    /' | tee -a "$OUT"
if [[ "$BCAST" -eq 0 ]]; then log "⚠️ 系统队列没有广播 —— 后续无投递属排程问题"; fi
if [[ "$SVC" -eq 0 ]]; then log "✗ 系统队列没有 AlarmRingService —— F3 解冻器没排上，本次试验无效"; fi

# ---------------------------------------------------------------- 3. 清台账 + 后台化
a shell run-as "$PKG" cat shared_prefs/alarm_trace.xml > "$RUN/$LABEL-trace-before.xml" 2>/dev/null
a shell run-as "$PKG" ls shared_prefs/ > "$RUN/$LABEL-prefs-list.txt" 2>/dev/null
log "shared_prefs: $(tr '\n' ' ' < "$RUN/$LABEL-prefs-list.txt" 2>/dev/null)"

a shell input keyevent KEYCODE_HOME >/dev/null 2>&1; sleep 4
a logcat -c -b main -b system -b events 2>/dev/null

# 双通道采集：main/system 看投递，events 看冻结/解冻
( a logcat -v time -b main -b system > "$RUN/$LABEL-main.txt" 2>&1 & echo $! > "$RUN/$LABEL-main.pid" )
( a logcat -v epoch -b events > "$RUN/$LABEL-events.txt" 2>&1 & echo $! > "$RUN/$LABEL-events.pid" )
sleep 2

# ---------------------------------------------------------------- 4. 屏幕
if [[ "$SCREEN" == "off" ]]; then
  a shell input keyevent 223 >/dev/null 2>&1; sleep 3
  log "关屏: mWakefulness=$(a shell dumpsys power 2>/dev/null | grep -m1 'mWakefulness=' | tr -d '\r' | sed 's/.*mWakefulness=//') 锁屏=$(a shell dumpsys window 2>/dev/null | grep -m1 'mDreamingLockscreen=' | tr -d '\r' | sed 's/.*mDreamingLockscreen=//')"
else
  log "保持亮屏"
fi

# ---------------------------------------------------------------- 5. 等到点后 45 秒
log "等到点…（现在 $(date '+%H:%M:%S')，目标约 ${LEAD}s 后）"
sleep $((LEAD + 45))

# ---------------------------------------------------------------- 6. 收尾取证
kill "$(cat "$RUN/$LABEL-main.pid" 2>/dev/null)" 2>/dev/null; rm -f "$RUN/$LABEL-main.pid"
kill "$(cat "$RUN/$LABEL-events.pid" 2>/dev/null)" 2>/dev/null; rm -f "$RUN/$LABEL-events.pid"
sleep 1
log "--- 到点后 $(date '+%H:%M:%S') ---"
log "证据1 进程被拉起: [$(a shell pidof "$PKG" 2>/dev/null | tr -d '\r')]"
log "证据2 通知条数: $(a shell dumpsys notification --noredact 2>/dev/null | tr -d '\r' | grep -cE "pkg=$PKG")"
log "证据3 屏幕: $(a shell dumpsys power 2>/dev/null | grep -m1 'mWakefulness=' | tr -d '\r' | sed 's/.*mWakefulness=//')"
log "证据4 队列残留: 广播=$(a shell dumpsys alarm 2>/dev/null | tr -d '\r' | grep -cE 'ACTION_TEST_ALARM') 服务=$(a shell dumpsys alarm 2>/dev/null | tr -d '\r' | grep -cE 'AlarmRingService')"

# 应用侧台账
a shell run-as "$PKG" cat shared_prefs/alarm_trace.xml > "$RUN/$LABEL-trace-after.xml" 2>/dev/null
for f in attention_alarm alarm_delivery attention_delivery; do
  a shell run-as "$PKG" cat "shared_prefs/$f.xml" > "$RUN/$LABEL-$f.xml" 2>/dev/null
done
log "台账文件: $(ls -la "$RUN" | grep "$LABEL-" | awk '{print $9"("$5")"}' | tr '\n' ' ')"

echo "" | tee -a "$OUT"
log "--- events 缓冲（冻结/解冻/唤醒/Activity）---"
grep -E "am_app_frozen|am_app_unfrozen|device_idle_wake_from_idle|wm_create_activity|am_proc_start|am_kill|sysui" "$RUN/$LABEL-events.txt" 2>/dev/null \
  | grep -iE "alliswell|ACTION_TEST_ALARM|walarm|am_app_frozen|am_app_unfrozen|wm_create_activity" | tail -30 | sed 's/^/    /' | tee -a "$OUT"

echo "" | tee -a "$OUT"
log "--- main/system 关键行 ---"
grep -iE "AttentionAlarm|AlarmTestReceiver|AlarmRingService|Start proc.*alliswell|deliver fullScreen|Bal|BAL" "$RUN/$LABEL-main.txt" 2>/dev/null | head -30 | sed 's/^/    /' | tee -a "$OUT"

log "=== 结束，日志: $RUN/$LABEL-*.txt ==="
