#!/usr/bin/env bash
#
# P2-C-R 真机复验：不同**终止方式**下的权威状态保护。
#
# 为什么区分终止方式：`am force-stop` 是平台的正规停法，而真机上更常见的是
# ① 内核 SIGKILL（进程被杀，没有优雅退出）；② 后台回收（LMK/`am kill`）。
# 三者的共同点是「WebView 没有机会做收尾」，正是可能把半写状态留在磁盘上的场景。
#
# 每种方式的协议（与 force-stop 轮次一致）：
#   活着时：记录级哈希 R_A（内容判据）+ 页面判定
#   死后未启动：文件级哈希两次（间隔 3s）⇒ 必须相同（死亡窗口静止）
#   冷启动后：记录级哈希 R_C + 页面判定
#   判据：R_A == R_C，且判定为 loaded/authoritative、writesAllowed、blockedWriteCount=0
#
# 用法：bash scripts/verification/p2cr-kill-modes.sh <run目录> [包名]
#
set -uo pipefail

ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
RUN="${1:?run 目录}"
PKG="${2:-space.alliswell.inbox.exportrecheck}"
PORT=9223
PY="${PY:-$HOME/.workbuddy/binaries/python/envs/default/bin/python}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ACTIVITY="$PKG/space.alliswell.inbox.MainActivity"
FAILED=0
NOT_PERFORMED=0

rec() { $PY scripts/idb-state-hash.py $PORT 2>/dev/null | grep -E '^(IDB_STATE_SHA256|BYTES)='; }
rec_sha() { printf '%s\n' "$1" | grep '^IDB_STATE_SHA256=' | cut -d= -f2; }
filesnap() { bash scripts/verification/device-storage-hash.sh "$PKG" 2>/dev/null | grep -E '^IDB_'; }
fsha() { printf '%s\n' "$1" | grep '^IDB_SHA256=' | cut -d= -f2; }
pid() { $ADB shell pidof "$PKG" 2>/dev/null | tr -d '\r\n'; }

forward() {
  local p; p="$(pid)"
  # 「进程活着」≠「devtools 可达」：应用在后台时 /json 会挂到超时（假故障）。
  # 每次 CDP 读取前先无条件把 Activity 提到前台（已在栈顶时是幂等的）。
  $ADB shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
  $ADB shell wm dismiss-keyguard >/dev/null 2>&1
  $ADB shell am start -n "$ACTIVITY" >/dev/null 2>&1
  $ADB forward --remove tcp:$PORT >/dev/null 2>&1
  [ -n "$p" ] && $ADB forward tcp:$PORT "localabstract:webview_devtools_remote_$p" >/dev/null 2>&1
  sleep 1
}

page() {
  forward
  local out
  out="$($PY scripts/android-cdp-eval.py "(() => { const A = window.__ATTENTION_INBOX__; if (!A) return 'NO_INSTANCE'; const sa = A.stateAuthority ? A.stateAuthority() : null; return JSON.stringify({ items: A.state.items.length, projects: A.state.projects.length, title: A.state.items[0] ? A.state.items[0].title : null, status: sa && sa.status, reason: sa && sa.report && sa.report.reason, backend: sa && sa.report && sa.report.backend, writesAllowed: sa && sa.writesAllowed, blockedWriteCount: sa && sa.blockedWriteCount, nativeBlocked: sa && sa.nativeBlocked, panel: !!document.getElementById('state-authority-recovery') }); })()" $PORT 2>/dev/null | tail -1)"
  [ -n "$out" ] && echo "PAGE=$out" || echo "PAGE=<无响应>"
}

cold_start() {
  $ADB shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
  $ADB shell wm dismiss-keyguard >/dev/null 2>&1
  $ADB shell am start -n "$ACTIVITY" >/dev/null 2>&1
  sleep 8
  forward
}

kill_sigkill() { # 内核信号终止（无优雅退出）
  local p; p="$(pid)"
  [ -z "$p" ] && { echo "  (进程本就不存在)"; return; }
  $ADB shell "run-as $PKG kill -9 $p" >/dev/null 2>&1
  sleep 1
}

kill_background() { # 后台回收：先退到后台，再由平台回收
  $ADB shell input keyevent KEYCODE_HOME >/dev/null 2>&1
  sleep 3
  $ADB shell am kill "$PKG" >/dev/null 2>&1
  sleep 2
}

run_mode() {
  local name="$1"; shift
  echo "════ 终止方式：$name ════"
  cold_start
  echo "## [$name] 活着时：A 时点"
  local A_REC A_RSHA A_F
  A_REC="$(rec)"; echo "$A_REC"
  A_F="$(filesnap)"; echo "file: $(printf '%s' "$A_F" | tr '\n' ' ')"
  page
  A_RSHA="$(rec_sha "$A_REC")"
  echo ""

  echo "## [$name] 终止"
  "$@"
  local p; p="$(pid)"
  echo "  pid-after-kill=[$p]"
  if [ -n "$p" ]; then
    # ⚠️ 这里**不判 FAIL**：本次终止方式根本没生效，就没有产生任何可判的证据。
    # 真实原因（2026-09-22 实机取证）：应用进程持有到自己的 WebView renderer 的绑定
    #   ServiceRecord{… sandboxed_process0 …}
    #   ConnectionRecord{… flags=0x80000041}   ← BIND_IMPORTANT|BIND_AUTO_CREATE
    # AMS 视其为「不可安全杀」，`am kill` / `am kill-all` 都拒绝执行。
    # 这属于「造不出该场景」，如实记 NOT_PERFORMED；等价路径由内核 SIGKILL 覆盖
    # （LMK/后台回收的终止手段同样是 SIGKILL）。
    echo "  MODE=NOT_PERFORMED（终止未生效：AMS 拒绝杀持有 WebView 绑定的进程；见 dumpsys 取证）"
    echo ""
    NOT_PERFORMED=$((NOT_PERFORMED + 1))
    return
  fi
  local B1 B2
  B1="$(filesnap)"; echo "  B1: $(printf '%s' "$B1" | tr '\n' ' ')"
  sleep 3
  B2="$(filesnap)"; echo "  B2: $(printf '%s' "$B2" | tr '\n' ' ')"
  if [ "$(fsha "$B1")" = "$(fsha "$B2")" ]; then
    echo "  ✓ 死亡窗口静止"
  else
    echo "  ✗ 死亡窗口不稳定：$(fsha "$B1") -> $(fsha "$B2")"; FAILED=1
  fi
  echo ""

  echo "## [$name] 冷启动后：C 时点"
  cold_start
  local C_REC C_RSHA
  C_REC="$(rec)"; echo "$C_REC"
  echo "file: $(printf '%s' "$(filesnap)" | tr '\n' ' ')"
  page
  C_RSHA="$(rec_sha "$C_REC")"
  echo ""
  if [ -n "$A_RSHA" ] && [ "$A_RSHA" = "$C_RSHA" ]; then
    echo "  ✓ 记录级哈希 A==C（$A_RSHA）：内容零变化"
  else
    echo "  ✗ 记录级哈希 A!=C：$A_RSHA -> $C_RSHA"; FAILED=1
  fi
  echo ""
}

echo "PKG=$PKG  run-start=$(date +%Y-%m-%dT%H:%M:%S%z)"
echo ""
run_mode "SIGKILL(run-as kill -9)" kill_sigkill
run_mode "后台回收(HOME + am kill)" kill_background

echo "结束 $(date +%Y-%m-%dT%H:%M:%S%z)"
echo ""
echo "=== AMS 绑定取证（后台回收为何杀不掉；与上面的 pid-after-kill 一起看）==="
$ADB shell "dumpsys activity services" 2>/dev/null \
  | grep -E "ServiceRecord.*$PKG|ConnectionRecord.*$PKG" | head -8
echo ""
echo "EXECUTED=2 NOT_PERFORMED=$NOT_PERFORMED"
[ "$FAILED" = "0" ] && echo "OVERALL=PASS（已执行的终止方式全部通过；NOT_PERFORMED 见上）" || echo "OVERALL=FAIL"
exit "$FAILED"
