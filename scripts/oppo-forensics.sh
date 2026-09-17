#!/usr/bin/env bash
#
# 真机后台闹钟只读取证（OPPO / ColorOS 交接任务用）
#
# 设计红线（来自 docs/handoff/OPPO-闹钟后台延迟-调试交接-20260917.md §3）：
#   * 全程只读：dumpsys / logcat / pidof / getprop / pm path，不含任何写设备命令
#   * 永不启动 App（无 am start）、永不 force-stop、永不 am kill / pm clear
#   * 永不改动权限、appops、白名单、电池设置
#   * 所有命令显式 -s <SERIAL>；拒绝在模拟器上执行
#
# 用法：
#   export SERIAL=<OPPO序列号>
#   bash scripts/oppo-forensics.sh init
#   bash scripts/oppo-forensics.sh snapshot baseline
#   bash scripts/oppo-forensics.sh logcat          # 前台持续写 $RUN/logcat.txt，Ctrl-C 结束
#   bash scripts/oppo-forensics.sh timeline <到点epoch毫秒> [尾随秒数=180] [采样间隔秒=5]
#   bash scripts/oppo-forensics.sh analyze         # 合并日志与采样，输出时间线
#   bash scripts/oppo-forensics.sh trace-attempt   # 尝试 run-as 读私有 trace（release 会失败，属正常）
#
set -uo pipefail

ADB=${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}
PKG=${PKG:-space.alliswell.inbox}
: "${SERIAL:?请先 export SERIAL=<OPPO 序列号>，用 adb devices -l 查}"
RUN=${RUN:-}

# 设备毫秒时钟：toybox date 的 %N 不一定支持，先探测再回退到秒
dev_ms() {
  local raw
  raw=$("$ADB" -s "$SERIAL" shell 'date +%s%3N' 2>/dev/null | tr -d '\r')
  if [[ "$raw" =~ ^[0-9]{13}$ ]]; then printf '%s' "$raw"; return; fi
  raw=$("$ADB" -s "$SERIAL" shell 'date +%s' 2>/dev/null | tr -d '\r')
  if [[ "$raw" =~ ^[0-9]+$ ]]; then printf '%s000' "$raw"; return; fi
  printf '0'
}

host_ms() {
  local raw
  raw=$(/usr/bin/python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null)
  [[ "$raw" =~ ^[0-9]+$ ]] && { printf '%s' "$raw"; return; }
  printf '%s000' "$(date +%s)"
}

require_serial() {
  case "$SERIAL" in
    *emulator*|*EMULATOR*)
      echo "拒绝执行：SERIAL=$SERIAL 指向模拟器。本流程只针对真机（交接文档 §5）。" >&2
      exit 2 ;;
  esac
  local online
  online=$("$ADB" devices | awk -v s="$SERIAL" '$1==s && $2=="device" {print $1}')
  if [[ -z "$online" ]]; then
    echo "拒绝执行：未找到状态为 device 的 $SERIAL。当前设备：" >&2
    "$ADB" devices -l >&2
    exit 2
  fi
}

require_run() {
  if [[ -z "$RUN" || ! -d "$RUN" ]]; then
    echo "请先 export RUN=<证据目录>（init 会打印它）" >&2
    exit 2
  fi
}

sh_() { "$ADB" -s "$SERIAL" shell "$@" 2>&1 | tr -d '\r'; }

# 本包在 dumpsys alarm 里的 alarm 头行形如：
#   RTC_WAKEUP #43: Alarm{762d726 type 0 origWhen 1789715400394 whenElapsed 95528921 space.alliswell.inbox}
# 用「头行 + 紧随字段」抽取，避免 -B10 误抓相邻的 GMS/系统闹钟。
PKG_RE=${PKG//./\\.}

extract_our_alarms() {
  grep -A9 -E "Alarm\{[^}]*${PKG_RE}" "$1" 2>/dev/null | sed 's/^ *//'
}

# 时间线里的一行紧凑摘要：保留 policyWhenElapsed 与 origWhen/flags —— 这三个字段
# 分别回答「是否被策略推后」「计划时刻」「是否 alarmClock/exact」。
our_alarm_digest() {
  grep -A9 -E "Alarm\{[^}]*${PKG_RE}" "$1" 2>/dev/null \
    | grep -E "Alarm\{|origWhen=|window=|exactAllowReason=|flags=0x|policyWhenElapsed|triggerTime=|tag=\*walarm\*" \
    | sed 's/^ *//; s/  */ /g' | tr '\n' '|' | cut -c1-900
}

cmd_init() {
  require_serial
  if [[ -z "$RUN" ]]; then
    RUN="$PWD/docs/reviews/oppo-usb-$(date +%Y%m%d-%H%M%S)"
  fi
  mkdir -p "$RUN"
  {
    echo "RUN=$RUN"
    echo "SERIAL=$SERIAL"
    echo "PKG=$PKG"
    echo "host_time=$(date '+%Y-%m-%dT%H:%M:%S%z')"
    echo "adb_version=$("$ADB" version | head -1)"
  } > "$RUN/run-env.txt"

  sh_ getprop ro.product.manufacturer      > "$RUN/manufacturer.txt"
  sh_ getprop ro.product.model             > "$RUN/model.txt"
  sh_ getprop ro.product.brand             > "$RUN/brand.txt"
  sh_ getprop ro.build.version.sdk         > "$RUN/sdk.txt"
  sh_ getprop ro.build.version.release     > "$RUN/android.txt"
  sh_ getprop ro.build.display.id          > "$RUN/build.txt"
  sh_ getprop ro.build.fingerprint         > "$RUN/fingerprint.txt"
  sh_ getprop ro.product.cpu.abi           > "$RUN/abi.txt"
  sh_ getprop ro.boot.verifiedbootstate    > "$RUN/vbstate.txt"
  sh_ date '+%Y-%m-%dT%H:%M:%S%z'          > "$RUN/device-time.txt"
  sh_ cat /proc/uptime                     > "$RUN/uptime.txt"

  sh_ dumpsys package "$PKG"               > "$RUN/package.txt"
  sh_ cmd appops get "$PKG"                > "$RUN/appops.txt"
  sh_ am get-standby-bucket "$PKG"         > "$RUN/standby.txt"
  sh_ dumpsys deviceidle                   > "$RUN/deviceidle.txt"
  sh_ dumpsys battery                      > "$RUN/battery.txt"
  sh_ dumpsys power                        > "$RUN/power.txt"
  sh_ dumpsys alarm                        > "$RUN/baseline-alarm.txt"
  sh_ dumpsys notification --noredact      > "$RUN/baseline-notify.txt"
  sh_ pm path "$PKG"                       > "$RUN/apk-paths.txt"
  sh_ dumpsys activity processes           > "$RUN/baseline-processes.txt"
  sh_ dumpsys activity broadcasts          > "$RUN/baseline-broadcasts.txt"
  sh_ dumpsys window                       > "$RUN/baseline-window.txt"

  # 已安装 APK 落地路径（不自动 pull，避免误拉大文件；路径给出来由人工决定）
  echo
  echo "证据目录：$RUN"
  echo "型号：$(cat "$RUN/manufacturer.txt") $(cat "$RUN/model.txt") · API $(cat "$RUN/sdk.txt") · Android $(cat "$RUN/android.txt")"
  echo "设备时间：$(cat "$RUN/device-time.txt")"
  echo
  echo "已安装 APK 路径（如需核对哈希，用下面命令自行 pull）："
  sed 's/^/  /' "$RUN/apk-paths.txt"
  echo
  echo "本包当前排程上下文："
  extract_our_alarms "$RUN/baseline-alarm.txt" | sed 's/^/  /'
}

cmd_snapshot() {
  local phase="${1:?用法: snapshot <phase>}"
  require_run; require_serial
  local dm; dm=$(dev_ms)
  printf '%s\t%s\n' "$(host_ms)" "$dm" > "$RUN/$phase-clocks.txt"
  date '+%Y-%m-%dT%H:%M:%S%z'      > "$RUN/$phase-host-time.txt"
  sh_ date '+%Y-%m-%dT%H:%M:%S%z'   > "$RUN/$phase-device-time.txt"
  sh_ cat /proc/uptime              > "$RUN/$phase-uptime.txt"
  sh_ dumpsys alarm                 > "$RUN/$phase-alarm.txt"
  sh_ pidof "$PKG"                  > "$RUN/$phase-pid.txt"
  sh_ dumpsys activity processes    > "$RUN/$phase-processes.txt"
  sh_ dumpsys activity broadcasts   > "$RUN/$phase-broadcasts.txt"
  sh_ dumpsys window                > "$RUN/$phase-window.txt"
  sh_ dumpsys notification --noredact > "$RUN/$phase-notify.txt"
  sh_ dumpsys deviceidle            > "$RUN/$phase-deviceidle.txt"

  local pid; pid=$(tr -d '\n' < "$RUN/$phase-pid.txt")
  echo "[$phase] 设备毫秒=$dm 进程pid=${pid:-（无进程）}"
  echo "  本包排程上下文："
  extract_our_alarms "$RUN/$phase-alarm.txt" | sed 's/^/    /'
}

# 从 dumpsys alarm 抽出「本包的 alarm 头行 → id / 计划时刻 / tag」
# 头行形如：RTC_WAKEUP #43: Alarm{762d726 type 0 origWhen 1789715400394 whenElapsed 95528921 space.alliswell.inbox}
our_entries() {
  awk -v pkg="$PKG" '
    /Alarm\{/ {
      ours = (index($0, pkg) > 0)
      id = ""; when = ""
      if (match($0, /Alarm\{[0-9a-f]+/)) id = substr($0, RSTART+6, RLENGTH-6)
      if (match($0, /origWhen[ =]([0-9]+)/)) { when = substr($0, RSTART, RLENGTH); gsub(/[^0-9]/, "", when) }
      if (when == "" && match($0, /when=[0-9]{10,}/)) { when = substr($0, RSTART, RLENGTH); gsub(/[^0-9]/, "", when) }
    }
    /^[ \t]*tag=/ { if (ours) { t = $0; sub(/^[ \t]*tag=/, "", t); printf "%s\t%s\t%s\n", id, when, t; ours = 0 } }
    /^[ \t]*operation=/ { if (ours) { printf "%s\t%s\t%s\n", id, when, "(无 tag 行)"; ours = 0 } }
  ' "$1" 2>/dev/null
}

cmd_auto() {
  local max_wait="${1:?用法: auto <等待新闹钟最长秒数> [尾随秒数=180] [采样间隔秒=5]}"
  local tail_s="${2:-180}"
  local interval="${3:-5}"
  require_run; require_serial
  mkdir -p "$RUN/timeline-alarm"

  # 1) 先记下现存 alarm id 集合，用来识别「本次新建事项带来的新闹钟」
  sh_ dumpsys alarm > "$RUN/auto-preexisting-alarm.txt"
  our_entries "$RUN/auto-preexisting-alarm.txt" | sort > "$RUN/auto-preexisting-ids.txt"
  local before_ids
  before_ids=$(cut -f1 "$RUN/auto-preexisting-ids.txt" | tr '\n' ' ')
  echo "已存在的本包 alarm id：${before_ids:-（无）}"
  echo "等待新闹钟出现（最长 ${max_wait}s）—— 现在请用正常表单新建关键事项；本脚本不会打开 App。"
  echo -e "hostMs\tdevMs\tpid\ttopActivity\tourAlarmDigest" > "$RUN/timeline.tsv"

  # 2) 轮询新 id
  local deadline_s=$(( $(date +%s) + max_wait ))
  local found_ts="" due_ms="" new_id="" new_tag=""
  while [[ $(date +%s) -lt $deadline_s ]]; do
    sh_ dumpsys alarm > "$RUN/auto-latest-alarm.txt"
    our_entries "$RUN/auto-latest-alarm.txt" | sort > "$RUN/auto-latest-ids.txt"
    while IFS=$'\t' read -r id when tag; do
      [[ -z "$id" ]] && continue
      if ! grep -q "^$id	" "$RUN/auto-preexisting-ids.txt" 2>/dev/null; then
        found_ts="$id"; new_id="$id"; due_ms="$when"; new_tag="$tag"; break
      fi
    done < "$RUN/auto-latest-ids.txt"
    [[ -n "$found_ts" ]] && break
    sleep 8
  done

  if [[ -z "$found_ts" ]]; then
    echo "在 ${max_wait}s 内没有观察到新的本包闹钟。"
    echo "→ 这本身就是重要证据：保存后系统队列里没有出现新排程。"
    echo "  请把 $RUN/auto-latest-alarm.txt 与 $RUN/auto-preexisting-alarm.txt 保留，交回分析。"
    cp "$RUN/auto-latest-alarm.txt" "$RUN/NO_NEW_ALARM_after-save-alarm.txt"
    return 3
  fi

  echo
  echo "★ 观察到新闹钟：id=$new_id 计划=$due_ms tag=$new_tag"
  echo "  本机时间 $(date '+%H:%M:%S') · 设备毫秒 $(dev_ms)"
  # 保存后快照（含进程/广播/窗口）
  cmd_snapshot after-save
  echo "  提示：现在请按 Home 并锁屏，然后什么都不要做，直到脚本运行结束。"

  # 3) 从此刻采到 到点+tail_s；关键偏移点额外采全量快照
  local stop_ms=$(( due_ms + tail_s * 1000 ))
  local took_before=0 took_p10=0 took_p60=0 took_p120=0
  while :; do
    local dm hm pid top tfile digest
    dm=$(dev_ms)
    [[ "$dm" -gt "$stop_ms" ]] && break
    if [[ $took_before -eq 0 && $dm -ge $(( due_ms - 20000 )) ]]; then
      cmd_snapshot before-due; took_before=1
    fi
    if [[ $took_p10 -eq 0 && $dm -ge $(( due_ms + 10000 )) ]]; then
      cmd_snapshot due-plus10; took_p10=1
    fi
    if [[ $took_p60 -eq 0 && $dm -ge $(( due_ms + 60000 )) ]]; then
      cmd_snapshot due-plus60; took_p60=1
    fi
    if [[ $took_p120 -eq 0 && $dm -ge $(( due_ms + 120000 )) ]]; then
      cmd_snapshot due-plus120; took_p120=1
    fi
    hm=$(host_ms)
    pid=$(sh_ pidof "$PKG" | tr -d '\n ')
    top=$(sh_ dumpsys activity activities 2>/dev/null | grep -m1 -E "mResumedActivity|topResumedActivity" | sed 's/^ *//')
    tfile="$RUN/timeline-alarm/$dm-alarm.txt"
    sh_ dumpsys alarm > "$tfile"
    digest=$(our_alarm_digest "$tfile")
    printf '%s\t%s\t%s\t%s\t%s\n' "$hm" "$dm" "${pid:-none}" "${top:-?}" "${digest:-（本包无排程）}" >> "$RUN/timeline.tsv"
    printf '%s  Δ=%+5.0fs  pid=%-8s %s\n' "$dm" "$(( (dm - due_ms) / 1000 ))" "${pid:-none}" "${top:-?}"
    sleep "$interval"
  done
  # 到点后仍未打开 App 的收尾快照
  cmd_snapshot before-open
  echo
  echo "采集结束。请现在才打开 App（如已自动响铃请先记录你看到/听到的时刻）。"
  echo "分析： bash scripts/oppo-forensics.sh analyze \"$RUN\" \"$due_ms\""
}

cmd_logcat() {
  require_run; require_serial
  echo "持续采集到 $RUN/logcat.txt（Ctrl-C 结束）。不执行 logcat -c，保留既有缓冲。"
  "$ADB" -s "$SERIAL" logcat -v epoch -b main -b system -b crash > "$RUN/logcat.txt" 2>&1
}

cmd_timeline() {
  local due_ms="${1:?用法: timeline <到点epoch毫秒> [尾随秒] [间隔秒]}"
  local tail_s="${2:-180}"
  local interval="${3:-5}"
  require_run; require_serial
  mkdir -p "$RUN/timeline-alarm"
  local stop_ms=$(( due_ms + tail_s * 1000 ))
  echo "时间线：到点 $due_ms，采集至 $(( stop_ms ))（尾随 ${tail_s}s，间隔 ${interval}s）"
  echo -e "hostMs\tdevMs\tpid\ttopActivity\tourAlarmDigest" > "$RUN/timeline.tsv"

  while :; do
    local dm hm pid top digest tfile
    dm=$(dev_ms)
    [[ "$dm" -gt "$stop_ms" ]] && { echo "已到采集终点。"; break; }
    hm=$(host_ms)
    pid=$(sh_ pidof "$PKG" | tr -d '\n ')
    top=$(sh_ dumpsys activity activities 2>/dev/null | grep -m1 -E "mResumedActivity|topResumedActivity" | sed 's/^ *//')
    tfile="$RUN/timeline-alarm/$dm-alarm.txt"
    sh_ dumpsys alarm > "$tfile"
    # 摘要：本包相关行 + 紧随其前的 Alarm{} 时间行
    digest=$(our_alarm_digest "$tfile")
    printf '%s\t%s\t%s\t%s\t%s\n' "$hm" "$dm" "${pid:-none}" "${top:-?}" "${digest:-（本包无排程）}" >> "$RUN/timeline.tsv"
    printf '%s  pid=%-8s %s\n' "$dm" "${pid:-none}" "${top:-?}"
    sleep "$interval"
  done
  echo "时间线已写入 $RUN/timeline.tsv；每次完整 dumpsys 在 $RUN/timeline-alarm/"
}

cmd_analyze() {
  local dir="${1:-$RUN}"
  local due_ms="${2:-}"
  [[ -d "$dir" ]] || { echo "目录不存在：$dir" >&2; exit 2; }
  local out="$dir/timeline-merged.txt"
  local stage="$dir/.merge-stage.tsv"

  # logcat 噪音：AppsFilter / SplashScreen / 窗口转场 / CoreBackPreview 会因出现包名而命中，
  # 但它们不含任何投递事实，量却极大（自检实测占输出 95% 以上）。
  local NOISE='AppsFilter|SplashScreenExceptionList|CoreBackPreview|WindowManagerShell|WindowManager:|AppsFilter|PackageManager: |AppsFilter'
  # 关键清单：只留能回答「排了没有 / 到点有没有执行 / 谁拉起的 / 有没有被拦」的行
  local KEY='AlarmTestReceiver|AttentionAlarm|AlarmService|Start proc .*alliswell|Force stopping .*alliswell|Killing .*alliswell|ActivityTaskManager: START .*alliswell|ActivityManager: START .*alliswell|Background activity launch|BAL_BLOCK|BAL_ALLOW|ANR in .*alliswell|CachedAppOptimizer.*alliswell|Freezer.*alliswell|AppStandby.*alliswell|BatterySaver.*alliswell|DeviceIdleController.*alliswell|AlarmManager.*alliswell|alliswell.*AlarmManager|am_proc_start|am_anr|PowerManagerService.*alliswell'

  if [[ -f "$dir/logcat.txt" ]]; then
    grep -iE "alliswell|AlarmTestReceiver|AttentionAlarm|AlarmManager|Start proc|BAL |broadcastIntent|ANR in|am_proc_start|AlarmService|DeviceIdle|CachedAppOptimizer" \
      "$dir/logcat.txt" 2>/dev/null | grep -viE "$NOISE" > "$dir/logcat-broad.txt" || true
    grep -iE "space\.alliswell\.inbox" "$dir/logcat-broad.txt" > "$dir/logcat-ours.txt" 2>/dev/null || true
    grep -iE "$KEY" "$dir/logcat-broad.txt" > "$dir/logcat-key.txt" 2>/dev/null || true
  fi

  # 归并：TSV 设备毫秒 与 logcat -v epoch 的「秒.毫秒」统一成 epoch 毫秒后排序；
  # 若给出到点毫秒，额外标出 Δ=相对到点的秒数。
  {
    if [[ -f "$dir/timeline.tsv" ]]; then
      awk -F'\t' 'NR>1 && $2 ~ /^[0-9]+$/ {printf "%s\t[采样] pid=%s | %s | %s\n", $2, $3, $4, $5}' "$dir/timeline.tsv"
    fi
    if [[ -f "$dir/logcat-key.txt" ]]; then
      awk '{t=$1; if (t ~ /^[0-9]+\.[0-9]+$/) {s=$0; sub(/^[^ ]+ +/,"",s); printf "%d\t[日志] %s\n", int(t*1000), s}}' "$dir/logcat-key.txt"
    fi
  } > "$stage"

  {
    echo "================ 归并时间线（设备时钟；打开 App 前/后据此切分） ================"
    echo "runId   : $dir"
    echo "设备    : $(cat "$dir/manufacturer.txt" 2>/dev/null) $(cat "$dir/model.txt" 2>/dev/null) · API $(cat "$dir/sdk.txt" 2>/dev/null)"
    echo "build   : $(cat "$dir/build.txt" 2>/dev/null)"
    echo "SERIAL  : $(grep -m1 '^SERIAL=' "$dir/run-env.txt" 2>/dev/null | cut -d= -f2-)"
    [[ -n "$due_ms" ]] && echo "到点    : $due_ms（Δ 为相对到点的秒数，负=早于到点）"
    echo
    if [[ -n "$due_ms" ]]; then
      sort -n -k1,1 "$stage" | awk -F'\t' -v d="$due_ms" '{printf "%s  Δ=%+.1fs  %s\n", $1, ($1-d)/1000, $2}'
    else
      sort -n -k1,1 "$stage" | awk -F'\t' '{printf "%s  %s\n", $1, $2}'
    fi
    echo
    echo "================ 阶段快照时钟（本机 / 设备毫秒） ================"
    for f in "$dir"/*-clocks.txt; do
      [[ -f "$f" ]] && printf '%-30s %s\n' "$(basename "$f" .txt)" "$(tr '\t' '/' < "$f")"
    done
  } > "$out"

  sed -n '1,140p' "$out"
  echo
  echo "完整归并结果        : $out"
  echo "本包相关日志（宽）  : $dir/logcat-ours.txt   ($(wc -l < "$dir/logcat-ours.txt" 2>/dev/null || echo 0) 行)"
  echo "关键证据日志（筛过）: $dir/logcat-key.txt    ($(wc -l < "$dir/logcat-key.txt" 2>/dev/null || echo 0) 行)"
  echo "原始全量（未筛）    : $dir/logcat.txt        ($(wc -c < "$dir/logcat.txt" 2>/dev/null || echo 0) 字节)"
}

cmd_trace_attempt() {
  require_run; require_serial
  mkdir -p "$RUN/private"
  sh_ run-as "$PKG" cat shared_prefs/alarm_trace.xml               > "$RUN/private/alarm_trace.xml"
  sh_ run-as "$PKG" cat shared_prefs/attention_alarm_schedules.xml > "$RUN/private/schedules.xml"
  for f in alarm_trace.xml schedules.xml; do
    if grep -qiE "package not debuggable|Unknown package|Permission Denial|not debuggable" "$RUN/private/$f"; then
      echo "$f：run-as 被拒（release 包属正常边界，不代表没有记录）"
    else
      echo "$f：已取得 $(wc -c < "$RUN/private/$f") 字节"
    fi
  done
}

cmd_help() { sed -n '2,20p' "$0"; }

case "${1:-help}" in
  init)          shift; cmd_init "$@" ;;
  snapshot)      shift; cmd_snapshot "$@" ;;
  auto)          shift; cmd_auto "$@" ;;
  logcat)        shift; cmd_logcat "$@" ;;
  timeline)      shift; cmd_timeline "$@" ;;
  analyze)       shift; cmd_analyze "$@" ;;
  trace-attempt) shift; cmd_trace_attempt "$@" ;;
  guard)         require_serial; echo "OK：$SERIAL 为真机且在线" ;;
  help|*)        cmd_help ;;
esac
