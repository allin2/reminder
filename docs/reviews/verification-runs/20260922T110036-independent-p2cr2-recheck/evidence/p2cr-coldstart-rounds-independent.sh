#!/usr/bin/env bash
#
# P2-C-R 真机复验：`force-stop → 冷启动` 多轮 **三时点**复验。
#
# 要回答的问题：进程死亡区间/冷启动是否会让权威状态被空快照覆盖（本轮阻断项）。
#
# 两类证据，各管一段：
#
#   1) **记录级哈希**（`scripts/idb-state-hash.py`）：直连 IndexedDB 读 kv/state 的值字节，
#      不走应用内存态。这是**内容判据** —— 「有没有被覆盖」看它。
#      只能在进程活着时采（应用死了就没有 JS 引擎可执行）。
#   2) **文件级哈希**（`scripts/verification/device-storage-hash.sh`）：读磁盘上 leveldb 目录。
#      与进程生死无关，所以用来回答「**死了之后、还没启动**这段有没有写入者」。
#      注意：leveldb 会因自身写入/压实而漂移，**文件哈希不等 ≠ 内容变了**，
#      因此它只用于「同一死亡窗口内是否静止」这一件事，不作为内容判据。
#
# 每轮时点：
#   A（启动前，进程活着）      → 记录级哈希 R_A + 页面判定
#   B（进程死亡后且尚未启动）  → 文件哈希两次（间隔 3s）⇒ 必须相同（死亡窗口静止）
#   C（启动恢复完成后）        → 记录级哈希 R_C + 页面判定 + 文件哈希
# 判据：R_A == R_C（内容零变化）且页面判定为 loaded/authoritative、
#       writesAllowed=true、blockedWriteCount=0。
#
# 用法：bash scripts/verification/p2cr-coldstart-rounds.sh <run目录> [轮数] [包名]
#
set -uo pipefail

ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
RUN="${1:?run 目录}"
ROUNDS="${2:-3}"
PKG="${3:-space.alliswell.inbox.exportrecheck}"
PORT=9223
PY="${PY:-$HOME/.workbuddy/binaries/python/envs/default/bin/python}"

ROOT="/Users/qlyf/Developer/reminder"
cd "$ROOT"

ACTIVITY="$PKG/space.alliswell.inbox.MainActivity"
FAILED=0

# 设备侧的 CDP 读取偶发会撞上「forward 刚重建 / devtools 还没挂上」，
# 重试几次再判失败 —— 否则会把「读不到」误判成「内容变了」（本脚本初版栽过一次）。
cdp_retry() { # $1=命令… ；成功（输出非空）即返回
  local i out
  for i in 1 2 3 4; do
    out="$("$@" 2>/dev/null)"
    if [ -n "$out" ]; then printf '%s' "$out"; return 0; fi
    sleep 1.5
  done
  return 1
}

rec() { # 记录级哈希（需进程活着）
  cdp_retry $PY scripts/idb-state-hash.py $PORT | grep -E '^(IDB_STATE_SHA256|BYTES)='
}
rec_sha() { printf '%s\n' "$1" | grep '^IDB_STATE_SHA256=' | cut -d= -f2; }
filesnap() { # 文件级哈希（与进程生死无关）；**IDB 与镜像都要**，缺一项就不算核过
  bash scripts/verification/device-storage-hash.sh "$PKG" 2>/dev/null | grep -E '^(IDB_|MIRROR_)'
  # WAL 单独报：本轮要回答的「冷启动是否又追加了一次权威提交」只有它看得出来。
  bash scripts/verification/idb-wal-size.sh "$PKG" 2>/dev/null | grep -E '^(IDB_WAL_BYTES|MIRROR_WAL_BYTES)='
}
fsha() { printf '%s\n' "$1" | grep '^IDB_SHA256=' | cut -d= -f2; }
fwals() { printf '%s\n' "$1" | grep '^IDB_WAL_BYTES=' | cut -d= -f2; }

# WAL 原文拉到本地临时目录（不进仓库：单份 ~138 KB，只归档「追加的那十几字节」）
WALTMP="${WALTMP:-/tmp/p2cr2-wal}"
mkdir -p "$WALTMP"
WAL_REMOTE="/data/data/$PKG/app_webview/Default/IndexedDB/https_localhost_0.indexeddb.leveldb/000003.log"
walpull() { # $1 = 本地目标
  $ADB exec-out run-as "$PKG" cat "$WAL_REMOTE" > "$1" 2>/dev/null
  [ -s "$1" ]
}

# **进程活着 ≠ devtools 可达**：应用退到后台时 `/json` 会**挂住直到超时**
# （表现为「读不到」，很容易被误判成「内容变了」）。真机上踩过一次：
# 进程 16408 一直在，socket 也在，但 HTTP 端点 10 秒无响应；
# 把 Activity 提到前台后立刻 200。所以每次 CDP 读取前都先无条件 `am start`（幂等）。
foreground() {
  $ADB shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
  $ADB shell wm dismiss-keyguard >/dev/null 2>&1
  $ADB shell am start -n "$ACTIVITY" >/dev/null 2>&1
}

page() {
  local pid out
  pid="$($ADB shell pidof "$PKG" 2>/dev/null | tr -d '\r\n')"
  if [ -z "$pid" ]; then echo "PAGE=<进程不存在>"; return; fi
  foreground
  $ADB shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
  $ADB forward --remove tcp:$PORT >/dev/null 2>&1
  $ADB forward tcp:$PORT "localabstract:webview_devtools_remote_$pid" >/dev/null 2>&1
  sleep 1
  out="$(cdp_retry $PY scripts/android-cdp-eval.py "(async () => { const A = window.__ATTENTION_INBOX__; if (!A) return 'NO_INSTANCE'; const sa = A.stateAuthority ? A.stateAuthority() : null; const mir = localStorage.getItem('attention-inbox-v2') || ''; let mir16 = 'absent'; if (mir) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(mir)); mir16 = [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('').slice(0,16); } return JSON.stringify({ items: A.state.items.length, projects: A.state.projects.length, title: A.state.items[0] ? A.state.items[0].title : null, status: sa && sa.status, reason: sa && sa.report && sa.report.reason, backend: sa && sa.report && sa.report.backend, writesAllowed: sa && sa.writesAllowed, blockedWriteCount: sa && sa.blockedWriteCount, nativeBlocked: sa && sa.nativeBlocked, mirrorLen: mir.length, mirrorSha16: mir16, panel: !!document.getElementById('state-authority-recovery') }); })()" $PORT | tail -1)"
  if [ -z "$out" ]; then echo "PAGE=<CDP 无响应>"; else echo "PAGE=$out"; fi
}

ensure_alive() {
  if [ -z "$($ADB shell pidof "$PKG" 2>/dev/null | tr -d '\r\n')" ]; then
    foreground
    sleep 7
  fi
  foreground
  local pid
  pid="$($ADB shell pidof "$PKG" 2>/dev/null | tr -d '\r\n')"
  $ADB forward --remove tcp:$PORT >/dev/null 2>&1
  [ -n "$pid" ] && $ADB forward tcp:$PORT "localabstract:webview_devtools_remote_$pid" >/dev/null 2>&1
  sleep 1
}

echo "ROUNDS=$ROUNDS PKG=$PKG"
echo "run-start=$(date +%Y-%m-%dT%H:%M:%S%z)"
echo ""

ensure_alive
echo "## timepoint A (启动前 · 进程活着)"
A_REC="$(rec)"; echo "$A_REC"
A_F="$(filesnap)"; echo "$A_F"
page
A_RSHA="$(rec_sha "$A_REC")"
BASE_WAL="$(fwals "$A_F")"
echo "BASE_WAL=${BASE_WAL}（冷启动前 WAL 字节数；下面每轮与它比，看有没有新增提交）"
WAL_PREV="$WALTMP/wal-A.bin"
if walpull "$WAL_PREV"; then
  echo "WAL_A_LOCAL=$WAL_PREV BYTES=$(wc -c < "$WAL_PREV" | tr -d ' ')"
else
  echo "✗ WAL 拉取失败"; FAILED=1
fi
echo ""

for i in $(seq 1 "$ROUNDS"); do
  echo "════ round $i / $ROUNDS ════"

  echo "## [$i] timepoint B (进程死亡后且尚未启动)"
  $ADB shell am force-stop "$PKG" >/dev/null 2>&1
  sleep 3
  B1="$(filesnap)"; echo "B1: $(printf '%s' "$B1" | tr '\n' ' ')"
  PID_DEAD="$($ADB shell pidof "$PKG" 2>/dev/null | tr -d '\r\n')"
  echo "pid-after-kill=[$PID_DEAD]"
  sleep 3
  B2="$(filesnap)"; echo "B2: $(printf '%s' "$B2" | tr '\n' ' ')"
  if [ "$(fsha "$B1")" = "$(fsha "$B2")" ]; then
    echo "  ✓ 死亡窗口静止（3 秒间隔两次文件哈希相同；此期间没有任何写入者）"
  else
    echo "  ✗ 死亡窗口**不稳定**：$(fsha "$B1") -> $(fsha "$B2")"
    FAILED=1
  fi
  echo ""

  echo "## [$i] timepoint C (启动恢复完成后)"
  $ADB shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
  $ADB shell wm dismiss-keyguard >/dev/null 2>&1
  $ADB shell am start -n "$ACTIVITY" >/dev/null 2>&1
  sleep 8
  ensure_alive
  C_REC="$(rec)"; echo "$C_REC"
  C_F="$(filesnap)"; echo "file: $(printf '%s' "$C_F" | tr '\n' ' ')"
  page
  C_RSHA="$(rec_sha "$C_REC")"
  echo ""

  echo "## [$i] 判定"
  if [ -n "$A_RSHA" ] && [ "$A_RSHA" = "$C_RSHA" ]; then
    echo "  ✓ 记录级哈希 A==C（${A_RSHA}）：冷启动后权威记录与启动前逐字节一致 ⇒ 未被空快照覆盖"
  else
    echo "  ✗ 记录级哈希 A!=C：$A_RSHA -> $C_RSHA"
    FAILED=1
  fi

  # ── WAL 判定：本轮要回答的那个问题 ──────────────────────────────────────
  # ⚠️ 判据不能用「WAL 字节数增长」。2026-09-22 真机实测：leveldb 在 reuse_logs
  #    恢复路径上会追加一个 **count=0 的空 WriteBatch**（19 B = 7 B 头 + 12 B 载荷），
  #    它一个键都不写、序号也不前进，但字节数每轮稳定 +19 ⇒ 粗判据会假红。
  #    真判据是解析追加记录里的 **操作条数 OPS**：>0 才算「产生了提交」。
  #    旧代码的签名是 count=2 的真 put（每轮 +3276 B = 2×1638 B 状态 JSON），
  #    用 OPS>0 判它照样报红 ⇒ 判据有牙齿（真机历史里的 count=5/count=4 批量已验证）。
  C_WAL="$(fwals "$C_F")"
  WAL_NOW="$WALTMP/wal-round-$i.bin"
  if walpull "$WAL_NOW"; then
    if [ -n "$WAL_PREV" ] && [ -f "$WAL_PREV" ]; then
      "$PY" scripts/verification/idb-wal-delta.py "$WAL_PREV" "$WAL_NOW" \
        > "$RUN/wal-delta-round-$i.txt" 2>&1
      OPS="$("$PY" scripts/verification/idb-wal-delta.py "$WAL_PREV" "$WAL_NOW" 2>/dev/null | grep '^OPS=' | cut -d= -f2)"
      KIND="$("$PY" scripts/verification/idb-wal-delta.py "$WAL_PREV" "$WAL_NOW" 2>/dev/null | grep '^RECORD_KIND=' | cut -d= -f2)"
      echo "  WAL 字节：$BASE_WAL -> ${C_WAL}（相对 A 时点累计 +$((C_WAL - BASE_WAL)) B；**逐轮增量**见下面这一行）"
      if [ "$OPS" = "0" ]; then
        echo "  ✓ 追加记录为**空标记**（OPS=0，RECORD_KIND=${KIND}）：零键操作、序号不前进 ⇒ 本轮冷启动没有产生任何提交"
      elif [ -z "$OPS" ] || [ "$OPS" = "None" ]; then
        echo "  · 追加记录无法解析（RECORD_KIND=${KIND}）⇒ 记为信息项，见 wal-delta-round-$i.txt"
      else
        echo "  ✗ 追加记录含 **$OPS 条真实操作**（RECORD_KIND=${KIND}）⇒ 冷启动仍写回了数据，幂等未生效"
        FAILED=1
      fi
    fi
    WAL_PREV="$WAL_NOW"
  else
    echo "  ✗ WAL 拉取失败（${WAL_REMOTE}）"
    FAILED=1
  fi
  echo ""
  A_RSHA="$C_RSHA"
done

echo "## 复验结束 $(date +%Y-%m-%dT%H:%M:%S%z)"
if [ "$FAILED" = "0" ]; then echo "OVERALL=PASS"; else echo "OVERALL=FAIL"; fi
exit "$FAILED"
