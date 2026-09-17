#!/usr/bin/env bash
# vivo 真机 F3 复测：验证「前台服务解冻 + 广播投递」是否消除 fast_freezer 造成的投递延迟
#
# 用法：
#   SERIAL=<sn> LABEL=f3-a LEAD=75 SCREEN=off bash scripts/verification/vivo-alarm-screenoff-trial.sh
#
# 与旧试验（/tmp/vivo-alarm-trial.sh）的差别 —— 新增三块取证：
#   1) 排程回读：系统队列里必须**同时**出现广播（ACTION_TEST_ALARM）与前台服务（AlarmRingService）两条
#   2) events 缓冲：am_app_frozen / am_app_unfrozen / device_idle_wake_from_idle / wm_create_activity
#      （旧脚本只看 main/system，看不到冻结事件，这才漏掉了真因）
#   3) 应用侧台账：alarm_trace（unfreezerStarted）与投递台账（deliveryAt），用于算投递延迟
#
# 核心指标：lag = deliveryAt - triggerAt。修复前实测 77000ms（晚 77 秒）。

set -uo pipefail
COLLECTOR_PIDS=()
CDP_PORT=""
cleanup() {
  local collector
  for collector in ${COLLECTOR_PIDS[@]+"${COLLECTOR_PIDS[@]}"}; do
    kill "$collector" 2>/dev/null || true
    wait "$collector" 2>/dev/null || true
  done
  COLLECTOR_PIDS=()
  if [[ -n "$CDP_PORT" ]]; then
    a forward --remove "tcp:$CDP_PORT" >/dev/null 2>&1 || true
    CDP_PORT=""
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADB_BIN="${ADB_BIN:-$HOME/Library/Android/sdk/platform-tools/adb}"
S="${SERIAL:?need SERIAL}"
PKG="${PKG:-space.alliswell.inbox}"
LABEL="${LABEL:-f3}"
LEAD="${LEAD:-75}"
SCREEN="${SCREEN:-off}"
RUN="${RUN:-$REPO_ROOT/docs/reviews/verification-runs/$(date -u +%Y%m%dT%H%M%SZ)-vivo-alarm-screenoff-trial-$$}"
ITEM_ID="${ITEM_ID:-i_87wsnzxnmu5j3pv5}"

[[ "${LABEL:-trial}" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "Invalid LABEL" >&2; exit 2; }
[[ "${ITEM_ID:-unused}" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "Invalid ITEM_ID" >&2; exit 2; }
for numeric in "${LEAD:-75}" "${HOLD:-60000}" "${WATCH:-30}"; do
  [[ "$numeric" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid duration" >&2; exit 2; }
done
[[ "${SCREEN:-off}" == off || "${SCREEN:-off}" == on ]] || { echo "Invalid SCREEN" >&2; exit 2; }

mkdir -p "$(dirname "$RUN")"
mkdir "$RUN" || exit 2
OUT="$RUN/$LABEL.log"
a() { "$ADB_BIN" -s "$S" "$@"; }
log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$OUT"; }

: > "$OUT"
printf 'serial=%s\npackage=%s\nitem=%s\nlead=%s\nscreen=%s\nhold=%s\nwatch=%s\nstarted_utc=%s\n' \
  "$S" "$PKG" "${ITEM_ID:-unused}" "${LEAD:-unused}" "${SCREEN:-unused}" "${HOLD:-unused}" "${WATCH:-unused}" "$(date -u +%FT%TZ)" > "$RUN/run-metadata.txt"
log "=== F3 试验 $LABEL · SCREEN=$SCREEN LEAD=${LEAD}s ==="

# ---------------------------------------------------------------- 0. 前置
a shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1; sleep 1
a shell input swipe 540 2000 540 500 300 >/dev/null 2>&1; sleep 2
a shell wm dismiss-keyguard >/dev/null 2>&1; sleep 1
a shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1; sleep 9
PID=$(a shell pidof "$PKG" 2>/dev/null | tr -d '\r' | awk '{print $1}')
log "前置: PID=$PID wakefulness=$(a shell dumpsys power 2>/dev/null | awk '/mWakefulness=/{print; exit}' | tr -d '\r' | sed 's/.*mWakefulness=//')"
[[ -n "$PID" ]] || { log "✗ 应用没起来，终止"; exit 3; }

# ---------------------------------------------------------------- 1. 设闹钟
CDP_PORT=$(a forward tcp:0 localabstract:webview_devtools_remote_"$PID") || exit 3
CDP_PORT=$(printf "%s" "$CDP_PORT" | tr -d "\r")
SET=$(/usr/bin/python3 "$REPO_ROOT/scripts/android-cdp-eval.py" \
  "(async function(){ var A=window.__ATTENTION_INBOX__; var it=A.state.items.filter(function(x){return x.id==='$ITEM_ID';})[0]; if(!it) return JSON.stringify({err:'no item'}); it.triggerAt=Date.now()+$LEAD*1000; it.status='waiting'; it.priority='important'; it.lastAlertShownAt=null; await A.saveAsync(); await new Promise(r=>setTimeout(r,6000)); return JSON.stringify({triggerAt:it.triggerAt, targetLocal:new Date(it.triggerAt).toLocaleTimeString('zh-CN',{hour12:false}), nowLocal:new Date().toLocaleTimeString('zh-CN',{hour12:false}), scheduled:A.state.settings.scheduledAlarmIds.length}); })()" "$CDP_PORT") || { log "CDP 设置失败，本次无效"; exit 3; }
[[ "$SET" != *'"err"'* ]] || { log "测试事项不存在，本次无效: $SET"; exit 3; }
log "设置结果: $SET"

# ---------------------------------------------------------------- 2. 排程回读（F3 关键：两条都要在）
sleep 3
a shell dumpsys alarm > "$RUN/$LABEL-alarm-before.txt" 2>/dev/null
BCAST=$(awk '/ACTION_TEST_ALARM/{c++}END{print c+0}' "$RUN/$LABEL-alarm-before.txt")
SVC=$(awk '/AlarmRingService/{c++}END{print c+0}' "$RUN/$LABEL-alarm-before.txt")
log "排程回读: 广播条目=$BCAST 前台服务条目=$SVC"
awk '/ACTION_TEST_ALARM|AlarmRingService/{print NR ":" $0}' "$RUN/$LABEL-alarm-before.txt" 2>/dev/null | head -8 | sed 's/^/    /' | tee -a "$OUT"
if [[ "$BCAST" -eq 0 ]]; then log "系统队列未见广播，本次无效"; exit 3; fi
if [[ "$SVC" -eq 0 ]]; then log "系统队列未见 AlarmRingService，本次无效"; exit 3; fi

# ---------------------------------------------------------------- 3. 清台账 + 后台化
a shell run-as "$PKG" cat shared_prefs/alarm_trace.xml > "$RUN/$LABEL-trace-before.xml" 2>/dev/null
a shell run-as "$PKG" ls shared_prefs/ > "$RUN/$LABEL-prefs-list.txt" 2>/dev/null
log "shared_prefs: $(tr '\n' ' ' < "$RUN/$LABEL-prefs-list.txt" 2>/dev/null)"



# 双通道采集：main/system 看投递，events 看冻结/解冻
a logcat -T 1 -v time -b main -b system > "$RUN/$LABEL-main.txt" 2>&1 &
COLLECTOR_PIDS+=("$!")
a logcat -T 1 -v epoch -b events > "$RUN/$LABEL-events.txt" 2>&1 &
COLLECTOR_PIDS+=("$!")
sleep 2

a shell input keyevent KEYCODE_HOME >/dev/null 2>&1; sleep 4

# ---------------------------------------------------------------- 4. 屏幕
if [[ "$SCREEN" == "off" ]]; then
  a shell input keyevent 223 >/dev/null 2>&1; sleep 3
  log "关屏: mWakefulness=$(a shell dumpsys power 2>/dev/null | awk '/mWakefulness=/{print; exit}' | tr -d '\r' | sed 's/.*mWakefulness=//') 锁屏=$(a shell dumpsys window 2>/dev/null | awk '/mDreamingLockscreen=/{print; exit}' | tr -d '\r' | sed 's/.*mDreamingLockscreen=//')"
else
  log "保持亮屏"
fi

# ---------------------------------------------------------------- 5. 等到点后 45 秒
log "等到点…（现在 $(date '+%H:%M:%S')，目标约 ${LEAD}s 后）"
sleep $((LEAD + 45))

# ---------------------------------------------------------------- 6. 收尾取证
cleanup; sleep 1
sleep 1
log "--- 到点后 $(date '+%H:%M:%S') ---"
log "证据1 进程被拉起: [$(a shell pidof "$PKG" 2>/dev/null | tr -d '\r')]"
log "证据2 通知条数: $(a shell dumpsys notification --noredact 2>/dev/null | tr -d '\r' | awk -v needle="pkg=$PKG" 'index($0,needle){c++}END{print c+0}')"
log "证据3 屏幕: $(a shell dumpsys power 2>/dev/null | awk '/mWakefulness=/{print; exit}' | tr -d '\r' | sed 's/.*mWakefulness=//')"
log "证据4 队列残留: 广播=$(a shell dumpsys alarm 2>/dev/null | tr -d '\r' | awk '/ACTION_TEST_ALARM/{c++}END{print c+0}') 服务=$(a shell dumpsys alarm 2>/dev/null | tr -d '\r' | awk '/AlarmRingService/{c++}END{print c+0}')"

# 应用侧台账
a shell run-as "$PKG" cat shared_prefs/alarm_trace.xml > "$RUN/$LABEL-trace-after.xml" 2>/dev/null
for f in attention_alarm alarm_delivery attention_delivery; do
  a shell run-as "$PKG" cat "shared_prefs/$f.xml" > "$RUN/$LABEL-$f.xml" 2>/dev/null
done
log "台账文件: $(ls -la "$RUN" | awk -v label="$LABEL-" 'index($0,label)' | awk '{print $9"("$5")"}' | tr '\n' ' ')"

echo "" | tee -a "$OUT"
log "--- events 缓冲（冻结/解冻/唤醒/Activity）---"
awk '/am_app_frozen|am_app_unfrozen|device_idle_wake_from_idle|wm_create_activity|am_proc_start|am_kill|sysui/' "$RUN/$LABEL-events.txt" 2>/dev/null \
  | awk '/alliswell|ACTION_TEST_ALARM|walarm|am_app_frozen|am_app_unfrozen|wm_create_activity/' | tail -30 | sed 's/^/    /' | tee -a "$OUT"

echo "" | tee -a "$OUT"
log "--- main/system 关键行 ---"
awk 'tolower($0) ~ /attentionalarm|alarmtestreceiver|alarmringservice|start proc.*alliswell|deliver fullscreen|bal/' "$RUN/$LABEL-main.txt" 2>/dev/null | head -30 | sed 's/^/    /' | tee -a "$OUT"

log "=== 结束，日志: $RUN/$LABEL-*.txt ==="
