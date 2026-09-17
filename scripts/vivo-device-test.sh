#!/usr/bin/env bash
# vivo 真机全面测试取证
#
# 纪律（沿用 OPPO 交接文档）：
#   · 显式 -s SERIAL，拒绝模拟器 —— 模拟器通过 ≠ 真机通过
#   · 默认只读：不卸载、不清数据、不改设备设置、不启动应用（除非显式 ask）
#   · 每次采集都落盘到 RUN 目录，便于交叉核对
#
# 用法：
#   SERIAL=<序列号> RUN=/tmp/vivo-test bash scripts/vivo-device-test.sh <cmd>
#
# 命令：
#   guard                     校验设备为真机且已授权
#   init                      采集设备/ROM/安装/权限基线（只读）
#   pkg                       采集已安装包信息 + APK 指纹
#   perms                     采集风险权限与 appops 全量
#   shot <名字>               截屏到 RUN/shots/<名字>.png
#   ui <名字>                 uiautomator 视图层级 dump
#   logcat-start | logcat-stop 日志采集开关
#   logcat-dump               导出已采集日志
#   perf-cold <Activity>      冷启动耗时（am start -W）
#   perf-mem                  内存快照
#   perf-gfx                  渲染性能快照（jank/掉帧）
#   all                       一次跑完只读基线（init pkg perms perf-*）

set -uo pipefail

ADB_BIN="${ADB_BIN:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${SERIAL:-}"
RUN="${RUN:-/tmp/vivo-test}"
PKG="${PKG:-space.alliswell.inbox}"

die() { echo "错误：$*" >&2; exit 2; }
note() { printf '\033[36m%s\033[0m\n' "$*"; }

adb() { "$ADB_BIN" -s "$SERIAL" "$@"; }

require_serial() {
  [[ -n "$SERIAL" ]] || die "必须用 SERIAL=<序列号> 显式指定设备（不猜、不选默认）"
  # 模拟器拒绝：真机行为（厂商 ROM 策略）无法在模拟器上复现
  case "$SERIAL" in
    *emulator*|*EMULATOR*|*sdk_gphone*) die "拒绝模拟器 $SERIAL —— 本测试只针对真机" ;;
  esac
  local st
  st=$("$ADB_BIN" devices 2>/dev/null | awk -v s="$SERIAL" '$1==s {print $2}')
  [[ "$st" == "device" ]] || die "设备 $SERIAL 当前状态为 '${st:-未连接}'，需要 'device'（若为 unauthorized，请在手机上点「允许 USB 调试」）"
}

ts() { date +%Y%m%d-%H%M%S; }
dclock() { adb shell "date +%s%3N" 2>/dev/null | tr -d '\r'; }

ensure_run() { mkdir -p "$RUN" "$RUN/shots" "$RUN/ui" ; }

# ---------------------------------------------------------------- guard
cmd_guard() {
  require_serial
  echo "OK：$SERIAL 为真机且已授权"
  adb shell getprop ro.product.manufacturer 2>/dev/null | tr -d '\r' | sed 's/^/  manufacturer: /'
  adb shell getprop ro.product.model 2>/dev/null | tr -d '\r' | sed 's/^/  model:        /'
}

# ---------------------------------------------------------------- init
cmd_init() {
  require_serial; ensure_run
  note "采集设备基线 → $RUN"
  {
    echo "RUN=$(basename "$RUN")"
    echo "SERIAL=$SERIAL"
    echo "HOST_TIME=$(date '+%Y-%m-%d %H:%M:%S')"
    echo "DEVICE_EPOCH_MS=$(dclock)"
  } > "$RUN/run-env.txt"

  local p
  for p in ro.product.manufacturer ro.product.model ro.product.device ro.product.board \
           ro.build.version.release ro.build.version.sdk ro.build.display.id \
           ro.build.fingerprint ro.miui.ui.version.name ro.build.version.opporom \
           ro.vivo.os.version ro.vivo.os.build.display.id ro.build.version.emui \
           ro.product.brand; do
    adb shell getprop "$p" 2>/dev/null | tr -d '\r' > "$RUN/prop-${p//./_}.txt"
  done

  echo "--- 设备概览 ---"
  printf '  %-14s %s\n' "厂商"    "$(cat "$RUN/prop-ro_product_manufacturer.txt")"
  printf '  %-14s %s\n' "型号"    "$(cat "$RUN/prop-ro_product_model.txt")"
  printf '  %-14s %s\n' "品牌"    "$(cat "$RUN/prop-ro_product_brand.txt")"
  printf '  %-14s %s\n' "ROM 版本" "$(cat "$RUN/prop-ro_build_version_release.txt") (API $(cat "$RUN/prop-ro_build_version_sdk.txt"))"
  printf '  %-14s %s\n' "build id" "$(cat "$RUN/prop-ro_build_display_id.txt")"
  printf '  %-14s %s\n' "vivo OS"  "$(cat "$RUN/prop-ro_vivo_os_version.txt" 2>/dev/null)"
  echo "  fingerprint : $(cat "$RUN/prop-ro_build_fingerprint.txt" | cut -c1-90)"

  # 屏幕 / 电量 / 温度 / 是否亮屏
  {
    echo "== wm size =="; adb shell wm size 2>/dev/null | tr -d '\r'
    echo "== wm density =="; adb shell wm density 2>/dev/null | tr -d '\r'
    echo "== power =="; adb shell dumpsys power 2>/dev/null | grep -E "mWakefulness=|mScreenOn|Display Power" | head -5 | tr -d '\r'
    echo "== battery =="; adb shell dumpsys battery 2>/dev/null | tr -d '\r'
    echo "== thermal =="; adb shell dumpsys thermalservice 2>/dev/null | grep -E "Temperature|mStatus" | head -6 | tr -d '\r'
  } > "$RUN/device-state.txt"
  echo ""
  sed -n '/== wm size ==/,/== battery ==/p' "$RUN/device-state.txt" | head -12

  # 应用是否安装
  if adb shell pm list packages 2>/dev/null | tr -d '\r' | grep -q "^package:$PKG$"; then
    echo ""
    echo "应用已安装：$PKG"
  else
    echo ""
    echo "⚠️  应用未安装：$PKG"
  fi
}

# ---------------------------------------------------------------- pkg
cmd_pkg() {
  require_serial; ensure_run
  note "采集应用包信息"
  adb shell dumpsys package "$PKG" 2>/dev/null | tr -d '\r' > "$RUN/dumpsys-package.txt"
  if [[ ! -s "$RUN/dumpsys-package.txt" ]]; then
    echo "⚠️  查询不到 $PKG —— 应用可能未安装"
    return 0
  fi

  echo "--- 版本与安装 ---"
  grep -E "versionName=|versionCode=|targetSdk=|minSdk=" "$RUN/dumpsys-package.txt" | sort -u | sed 's/^/  /' | head -8
  grep -E "firstInstallTime=|lastUpdateTime=" "$RUN/dumpsys-package.txt" | sed 's/^/  /'
  echo ""
  echo "--- 调试/签名标志 ---"
  grep -cE "DEBUGGABLE" "$RUN/dumpsys-package.txt" | sed 's/^/  DEBUGGABLE 出现次数: /'
  grep -E "^\s+(pkgFlags|flags)=|installerPackageName=" "$RUN/dumpsys-package.txt" | head -4 | sed 's/^/  /'
  grep -E "signatures|signature" "$RUN/dumpsys-package.txt" | head -3 | sed 's/^/  /'

  # APK 路径与指纹（不导出内容，只算哈希）
  local apkpath
  apkpath=$(adb shell pm path "$PKG" 2>/dev/null | tr -d '\r' | sed -n 's/^package://p' | head -1)
  if [[ -n "$apkpath" ]]; then
    echo ""
    echo "--- APK ---"
    echo "  path: $apkpath"
    # 设备侧直接算哈希，避免大文件传输
    adb shell "sha256sum '$apkpath' 2>/dev/null || md5sum '$apkpath' 2>/dev/null" | tr -d '\r' | sed 's/^/  /'
    adb shell "ls -la '$apkpath'" 2>/dev/null | tr -d '\r' | sed 's/^/  /'
  fi
}

# ---------------------------------------------------------------- perms
cmd_perms() {
  require_serial; ensure_run
  note "采集权限与 appops"
  adb shell dumpsys package "$PKG" 2>/dev/null | tr -d '\r' > "$RUN/perms-package.txt"
  adb shell appops get "$PKG" 2>/dev/null | tr -d '\r' > "$RUN/perms-appops.txt"

  echo "--- 本应用相关风险权限（运行时授予状态）---"
  grep -E "POST_NOTIFICATIONS|SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM|SYSTEM_ALERT_WINDOW|USE_FULL_SCREEN_INTENT|RECEIVE_BOOT_COMPLETED|WAKE_LOCK|FOREGROUND_SERVICE" \
    "$RUN/perms-package.txt" | sed 's/^/  /' | head -30

  echo ""
  echo "--- appops（关键项）---"
  grep -E "POST_NOTIFICATION|SYSTEM_ALERT_WINDOW|SCHEDULE_EXACT_ALARM|AUTO_START|BACKGROUND_START|START_FOREGROUND|WAKE_LOCK" \
    "$RUN/perms-appops.txt" | sed 's/^/  /' | head -20

  # vivo 特有：自启动 / 后台运行 白名单（不同 ROM 字段不同，尽力探测）
  echo ""
  echo "--- 厂商后台策略探测 ---"
  adb shell dumpsys deviceidle whitelist 2>/dev/null | tr -d '\r' | grep -i "$PKG" | sed 's/^/  电池优化白名单: /' || echo "  电池优化白名单: (未在名单中)"
  adb shell dumpsys activity 2>/dev/null | grep -iE "bg-$PKG|allowed.*$PKG" | head -3 | sed 's/^/  /'
  adb shell cmd appops get "$PKG" 2>/dev/null | tr -d '\r' | grep -iE "RUN_IN_BACKGROUND|RUN_ANY_IN_BACKGROUND" | sed 's/^/  /'
}

# ---------------------------------------------------------------- 截屏/视图
cmd_shot() {
  require_serial; ensure_run
  local name="${1:-screen-$(ts)}"
  local out="$RUN/shots/$name.png"
  adb exec-out screencap -p > "$out" 2>/dev/null
  local size; size=$(wc -c < "$out" | tr -d ' ')
  if [[ "${size:-0}" -lt 1000 ]]; then
    echo "⚠️  截屏可能失败（$size 字节）：$out"
  else
    echo "截屏：$out ($size 字节)"
  fi
}

cmd_ui() {
  require_serial; ensure_run
  local name="${1:-ui-$(ts)}"
  local out="$RUN/ui/$name.xml"
  adb shell uiautomator dump /sdcard/ui-dump.xml >/dev/null 2>&1
  adb shell cat /sdcard/ui-dump.xml 2>/dev/null | tr -d '\r' > "$out"
  adb shell rm -f /sdcard/ui-dump.xml >/dev/null 2>&1
  if [[ ! -s "$out" ]]; then echo "⚠️  视图 dump 为空（Android 12+ 可能限制 uiautomator 对非 debuggable 应用）"; return 0; fi
  echo "视图：$out ($(wc -c < "$out" | tr -d ' ') 字节)"
  # 抽出可点击文本节点，便于定位坐标
  grep -oE 'text="[^"]+"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' "$out" | head -40 | sed 's/^/  /'
}

# ---------------------------------------------------------------- logcat
cmd_logcat_start() {
  require_serial; ensure_run
  adb logcat -c 2>/dev/null
  : > "$RUN/logcat.txt"
  ( adb logcat -v epoch > "$RUN/logcat.txt" 2>&1 & echo $! > "$RUN/logcat.pid" )
  sleep 1
  echo "日志采集中（pid $(cat "$RUN/logcat.pid" 2>/dev/null)）→ $RUN/logcat.txt"
  echo "注意：运行期间不要拔线；结束用 logcat-stop"
}

cmd_logcat_stop() {
  ensure_run
  if [[ -f "$RUN/logcat.pid" ]]; then
    kill "$(cat "$RUN/logcat.pid")" 2>/dev/null
    rm -f "$RUN/logcat.pid"
  fi
  pkill -f "adb.*logcat -v epoch" 2>/dev/null
  echo "日志已停。文件：$RUN/logcat.txt ($(wc -l < "$RUN/logcat.txt" 2>/dev/null | tr -d ' ') 行)"
}

cmd_logcat_dump() {
  require_serial; ensure_run
  adb logcat -d -v epoch > "$RUN/logcat-dump.txt" 2>/dev/null
  echo "已导出：$RUN/logcat-dump.txt ($(wc -l < "$RUN/logcat-dump.txt" | tr -d ' ') 行)"
  echo "--- 本应用与闹钟相关 ---"
  grep -iE "alliswell|AttentionAlarm|AlarmTestReceiver|AlarmManager.*alliswell" "$RUN/logcat-dump.txt" | tail -30 | sed 's/^/  /'
}

# ---------------------------------------------------------------- 性能
cmd_perf_cold() {
  require_serial; ensure_run
  local act="${1:-$PKG/.MainActivity}"
  note "冷启动测量：$act（3 次取全量，不出均值 —— 真机波动大）"
  {
    echo "== am start -W (cold) =="
    for i in 1 2 3; do
      adb shell am force-stop "$PKG" >/dev/null 2>&1
      sleep 3
      echo "--- 第 $i 次 ---"
      adb shell am start -W -n "$act" 2>&1 | tr -d '\r'
      sleep 5
    done
  } | tee "$RUN/perf-cold-start.txt"
}

cmd_perf_mem() {
  require_serial; ensure_run
  adb shell dumpsys meminfo "$PKG" 2>/dev/null | tr -d '\r' > "$RUN/perf-meminfo.txt"
  echo "--- 内存 ---"
  sed -n '1,25p' "$RUN/perf-meminfo.txt" | sed 's/^/  /'
}

cmd_perf_gfx() {
  require_serial; ensure_run
  adb shell dumpsys gfxinfo "$PKG" framestats 2>/dev/null | tr -d '\r' > "$RUN/perf-gfxinfo.txt"
  echo "--- 渲染（jank）---"
  grep -E "Total frames rendered|Janky frames|50th percentile|90th percentile|95th percentile|99th percentile|Number Missed Vsync|Number Slow UI thread|Number Slow bitmap uploads|Number Slow issue draw commands" \
    "$RUN/perf-gfxinfo.txt" | sed 's/^/  /'
  echo ""
  echo "--- CPU ---"
  adb shell dumpsys cpuinfo 2>/dev/null | tr -d '\r' | grep -E "$PKG|Load:" | head -5 | sed 's/^/  /'
}

cmd_all() {
  cmd_init
  echo ""
  cmd_pkg
  echo ""
  cmd_perms
  echo ""
  cmd_perf_mem
  echo ""
  cmd_perf_gfx
}

cmd_help() {
  sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
}

case "${1:-help}" in
  guard)        shift; cmd_guard "$@" ;;
  init)         shift; cmd_init "$@" ;;
  pkg)          shift; cmd_pkg "$@" ;;
  perms)        shift; cmd_perms "$@" ;;
  shot)         shift; cmd_shot "$@" ;;
  ui)           shift; cmd_ui "$@" ;;
  logcat-start) shift; cmd_logcat_start "$@" ;;
  logcat-stop)  shift; cmd_logcat_stop "$@" ;;
  logcat-dump)  shift; cmd_logcat_dump "$@" ;;
  perf-cold)    shift; cmd_perf_cold "$@" ;;
  perf-mem)     shift; cmd_perf_mem "$@" ;;
  perf-gfx)     shift; cmd_perf_gfx "$@" ;;
  all)          shift; cmd_all "$@" ;;
  help|*)       cmd_help ;;
esac
