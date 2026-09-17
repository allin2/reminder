#!/usr/bin/env bash
# 长窗口免冻实验：前台服务持有 60 秒前台身份，退到后台后观察 30 秒
# 判读：
#   · 30 秒内**没有** am_app_frozen[space.alliswell.inbox] → 仅说明该观察窗口未见冻结，不证明长期免冻
#   · 很快出现 am_app_frozen → 前台服务挡不住，只剩厂商白名单一条路
#
# 用法：SERIAL=<sn> HOLD=60000 WATCH=30 bash scripts/verification/vivo-fgs-exempt-test.sh

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
PKG="space.alliswell.inbox"
HOLD="${HOLD:-60000}"
WATCH="${WATCH:-30}"
RUN="${RUN:-$REPO_ROOT/docs/reviews/verification-runs/$(date -u +%Y%m%dT%H%M%SZ)-vivo-fgs-exempt-test-$$}"
[[ "${LABEL:-trial}" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "Invalid LABEL" >&2; exit 2; }
[[ "${ITEM_ID:-unused}" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "Invalid ITEM_ID" >&2; exit 2; }
for numeric in "${LEAD:-75}" "${HOLD:-60000}" "${WATCH:-30}"; do
  [[ "$numeric" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid duration" >&2; exit 2; }
done
[[ "${SCREEN:-off}" == off || "${SCREEN:-off}" == on ]] || { echo "Invalid SCREEN" >&2; exit 2; }

mkdir -p "$(dirname "$RUN")"
mkdir "$RUN" || exit 2
OUT="$RUN/fgs-exempt-long.log"
a() { "$ADB_BIN" -s "$S" "$@"; }
log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$OUT"; }
: > "$OUT"
printf 'serial=%s\npackage=%s\nitem=%s\nlead=%s\nscreen=%s\nhold=%s\nwatch=%s\nstarted_utc=%s\n' \
  "$S" "$PKG" "${ITEM_ID:-unused}" "${LEAD:-unused}" "${SCREEN:-unused}" "${HOLD:-unused}" "${WATCH:-unused}" "$(date -u +%FT%TZ)" > "$RUN/run-metadata.txt"

log "=== 长窗口免冻实验 · HOLD=${HOLD}ms WATCH=${WATCH}s ==="
a shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1; sleep 1
a shell input swipe 540 2000 540 500 300 >/dev/null 2>&1; sleep 2
a shell wm dismiss-keyguard >/dev/null 2>&1; sleep 1
a shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1; sleep 9
log "应用 PID=$(a shell pidof "$PKG" | tr -d '\r' | awk '{print $1}')"


a logcat -T 1 -v epoch -b events > "$RUN/fgs-long-events.txt" 2>&1 &
COLLECTOR_PIDS+=("$!")
sleep 1

a shell run-as "$PKG" am start-foreground-service --user 0 \
  -n "$PKG/.AlarmRingService" --el holdMs "$HOLD" --es alarmTraceToken "fgs-$HOLD-$$" > "$RUN/service-start.txt" 2>&1
sleep 2
if ! a shell dumpsys activity services "$PKG" | awk '/isForeground=true/{found=1} END{exit !found}'; then
  log "服务未进入前台，本次无效；查看 service-start.txt"; exit 3
fi
sleep 2
log "服务: $(a shell dumpsys activity services "$PKG" 2>/dev/null | tr -d '\r' | awk '/AlarmRingService/{f=1} f&&/isForeground|foregroundServiceType|startRequested/{gsub(/^ +/,"");printf "%s; ",$0} /^  \* ServiceRecord/&&/Sandboxed/{exit}' | head -c 200)"

log "退到后台，观察 ${WATCH} 秒…"
a shell input keyevent KEYCODE_HOME >/dev/null 2>&1
sleep "$WATCH"

cleanup; sleep 1
log "进程: [$(a shell pidof "$PKG" | tr -d '\r')]"
echo "" | tee -a "$OUT"
log "--- events（本应用 + 前台服务相关）---"
awk '/space\.alliswell\.inbox\/(\.AlarmRingService)|alliswell\.inbox,/' "$RUN/fgs-long-events.txt" | sed 's/^/    /' | tee -a "$OUT"

FROZEN=$(awk '/am_app_frozen.*space\.alliswell\.inbox/{c++}END{print c+0}' "$RUN/fgs-long-events.txt")
log "窗口内 am_app_frozen 次数: $FROZEN"

# 收尾：停掉守护服务
a shell run-as "$PKG" am stopservice --user 0 -n "$PKG/.AlarmRingService" >/dev/null 2>&1
log "=== 结束 ==="
