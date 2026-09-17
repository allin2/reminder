#!/usr/bin/env bash
# 长窗口免冻实验：前台服务持有 60 秒前台身份，退到后台后观察 30 秒
# 判读：
#   · 30 秒内**没有** am_app_frozen[space.alliswell.inbox] → 前台服务能挡住 fast_freezer
#   · 很快出现 am_app_frozen → 前台服务挡不住，只剩厂商白名单一条路
#
# 用法：SERIAL=<sn> HOLD=60000 WATCH=30 bash /tmp/vivo-fgs-exempt-long.sh

set -uo pipefail
ADB_BIN="$HOME/Library/Android/sdk/platform-tools/adb"
S="${SERIAL:?need SERIAL}"
PKG="space.alliswell.inbox"
HOLD="${HOLD:-60000}"
WATCH="${WATCH:-30}"
RUN=/tmp/vivo-f3; mkdir -p "$RUN"; OUT="$RUN/fgs-exempt-long.log"
a() { "$ADB_BIN" -s "$S" "$@"; }
log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$OUT"; }
: > "$OUT"

log "=== 长窗口免冻实验 · HOLD=${HOLD}ms WATCH=${WATCH}s ==="
a shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1; sleep 1
a shell input swipe 540 2000 540 500 300 >/dev/null 2>&1; sleep 2
a shell wm dismiss-keyguard >/dev/null 2>&1; sleep 1
a shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1; sleep 9
log "应用 PID=$(a shell pidof "$PKG" | tr -d '\r' | awk '{print $1}')"

a logcat -c -b events 2>/dev/null
( a logcat -v epoch -b events > "$RUN/fgs-long-events.txt" 2>&1 & echo $! > "$RUN/fgs2.pid" )
sleep 1

a shell run-as "$PKG" am start-foreground-service \
  -n "$PKG/.AlarmRingService" --el holdMs "$HOLD" >/dev/null 2>&1
sleep 2
log "服务: $(a shell dumpsys activity services "$PKG" 2>/dev/null | tr -d '\r' | awk '/AlarmRingService/{f=1} f&&/isForeground|foregroundServiceType|startRequested/{gsub(/^ +/,"");printf "%s; ",$0} /^  \* ServiceRecord/&&/Sandboxed/{exit}' | head -c 200)"

log "退到后台，观察 ${WATCH} 秒…"
a shell input keyevent KEYCODE_HOME >/dev/null 2>&1
sleep "$WATCH"

kill "$(cat "$RUN/fgs2.pid" 2>/dev/null)" 2>/dev/null; rm -f "$RUN/fgs2.pid"; sleep 1
log "进程: [$(a shell pidof "$PKG" | tr -d '\r')]"
echo "" | tee -a "$OUT"
log "--- events（本应用 + 前台服务相关）---"
awk '/space\.alliswell\.inbox\/(\.AlarmRingService)|alliswell\.inbox,/' "$RUN/fgs-long-events.txt" | sed 's/^/    /' | tee -a "$OUT"

FROZEN=$(awk '/am_app_frozen.*10190,space\.alliswell\.inbox/{c++}END{print c+0}' "$RUN/fgs-long-events.txt")
log "窗口内 am_app_frozen 次数: $FROZEN"

# 收尾：停掉守护服务
a shell run-as "$PKG" am stopservice -n "$PKG/.AlarmRingService" >/dev/null 2>&1
log "=== 结束 ==="
