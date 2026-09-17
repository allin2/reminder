#!/usr/bin/env bash
# F3 对照实验：应用**保持前台**（不被 fast_freezer 冻结）时，
# 前台服务解冻器与广播投递能否正常执行？
#
# 目的：把「冻结导致失败」与「机制本身有缺陷」分开。
#   · 若本实验里 unfreezerStarted / received 都出现 → 机制本身可用，冻结是唯一阻塞
#   · 若不出现 → PendingIntent.getForegroundService 或 shortService 本身有问题，先修它
#
# 用法：SERIAL=<sn> LABEL=f3-ctl LEAD=35 bash scripts/verification/vivo-alarm-foreground-control.sh

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
LABEL="${LABEL:-f3-ctl}"
LEAD="${LEAD:-35}"
RUN="${RUN:-$REPO_ROOT/docs/reviews/verification-runs/$(date -u +%Y%m%dT%H%M%SZ)-vivo-alarm-foreground-control-$$}"
ITEM_ID="${ITEM_ID:-i_8zju7b9emu5j3pv6}"

[[ "${LABEL:-trial}" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "Invalid LABEL" >&2; exit 2; }
[[ "${ITEM_ID:-unused}" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "Invalid ITEM_ID" >&2; exit 2; }
for numeric in "${LEAD:-75}" "${HOLD:-60000}" "${WATCH:-30}"; do
  [[ "$numeric" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid duration" >&2; exit 2; }
done
[[ "${SCREEN:-off}" == off || "${SCREEN:-off}" == on ]] || { echo "Invalid SCREEN" >&2; exit 2; }

mkdir -p "$(dirname "$RUN")"
mkdir "$RUN" || exit 2; OUT="$RUN/$LABEL.log"
a() { "$ADB_BIN" -s "$S" "$@"; }
log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$OUT"; }
: > "$OUT"
printf 'serial=%s\npackage=%s\nitem=%s\nlead=%s\nscreen=%s\nhold=%s\nwatch=%s\nstarted_utc=%s\n' \
  "$S" "$PKG" "${ITEM_ID:-unused}" "${LEAD:-unused}" "${SCREEN:-unused}" "${HOLD:-unused}" "${WATCH:-unused}" "$(date -u +%FT%TZ)" > "$RUN/run-metadata.txt"

log "=== 对照实验 $LABEL · 保持前台 LEAD=${LEAD}s ==="
a shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1; sleep 1
a shell input swipe 540 2000 540 500 300 >/dev/null 2>&1; sleep 2
a shell wm dismiss-keyguard >/dev/null 2>&1; sleep 1
a shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1; sleep 9
PID=$(a shell pidof "$PKG" | tr -d '\r' | awk '{print $1}')
log "PID=$PID"

CDP_PORT=$(a forward tcp:0 localabstract:webview_devtools_remote_"$PID") || exit 3
CDP_PORT=$(printf "%s" "$CDP_PORT" | tr -d "\r")
SET=$(/usr/bin/python3 "$REPO_ROOT/scripts/android-cdp-eval.py" \
  "(async function(){ var A=window.__ATTENTION_INBOX__; var it=A.state.items.filter(function(x){return x.id==='$ITEM_ID';})[0]; if(!it) return JSON.stringify({err:'no item'}); it.triggerAt=Date.now()+$LEAD*1000; it.status='waiting'; it.priority='important'; it.lastAlertShownAt=null; await A.saveAsync(); await new Promise(r=>setTimeout(r,6000)); return JSON.stringify({targetLocal:new Date(it.triggerAt).toLocaleTimeString('zh-CN',{hour12:false})}); })()" "$CDP_PORT") || { log "CDP 设置失败，本次无效"; exit 3; }
[[ "$SET" != *'"err"'* ]] || { log "测试事项不存在，本次无效: $SET"; exit 3; }
log "设置: $SET"

sleep 2
a shell dumpsys alarm > "$RUN/$LABEL-alarm-before.txt" 2>/dev/null
log "排程回读: 广播=$(awk '/ACTION_TEST_ALARM/{c++}END{print c+0}' "$RUN/$LABEL-alarm-before.txt") 服务=$(awk '/AlarmRingService/{c++}END{print c+0}' "$RUN/$LABEL-alarm-before.txt")"

# 冻结基线：确认实验期间进程**没有**被冻结

a logcat -T 1 -v epoch -b events > "$RUN/$LABEL-events.txt" 2>&1 &
COLLECTOR_PIDS+=("$!")
sleep 1

log "保持前台，等到点…（${LEAD}s 后）"
sleep $((LEAD + 25))

cleanup; sleep 1
log "当前焦点窗口: $(a shell dumpsys window 2>/dev/null | tr -d '\r' | awk '/mCurrentFocus/{print; exit}')"
log "进程: [$(a shell pidof "$PKG" | tr -d '\r')]  屏幕: $(a shell dumpsys power 2>/dev/null | awk -F= '/mWakefulness=/{print $2; exit}' | tr -d '\r')"

a shell run-as "$PKG" cat shared_prefs/alarm_trace.xml > "$RUN/$LABEL-trace-after.xml" 2>/dev/null
a shell run-as "$PKG" cat shared_prefs/attention_alarm.xml > "$RUN/$LABEL-delivery.xml" 2>/dev/null

echo "" | tee -a "$OUT"
log "--- events（冻结/解冻/Activity）---"
awk '/am_app_frozen|am_app_unfrozen|wm_create_activity|am_proc_start/ && /alliswell/' "$RUN/$LABEL-events.txt" | sed 's/^/    /' | tee -a "$OUT"
log "（以上为空 = 实验期间进程未发生冻结/解冻）"
log "=== 结束: $RUN/$LABEL-* ==="
