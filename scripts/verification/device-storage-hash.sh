#!/usr/bin/env bash
#
# P2-C-R：设备侧**权威存储（IndexedDB）**与**镜像（Local Storage）**的**文件级**哈希。
#
# 为什么不能只用 CDP 读：CDP 只能读到「应用进程活着」的那一瞬，而本轮要回答的问题
# 恰恰横跨「进程已经死了、还没启动」这个区间。文件级哈希与进程生死无关，
# 也不经过应用内存态 —— 它读的就是磁盘上那几份 leveldb 记录。
#
# 用法：
#   bash scripts/verification/device-storage-hash.sh [包名] [标签]
# 输出（每行一个事实，便于直接粘进 run 文档）：
#   IDB_FILES=<n> IDB_BYTES=<n> IDB_SHA256=<64 hex>
#   MIRROR_FILES=<n> MIRROR_BYTES=<n> MIRROR_SHA256=<64 hex>
#
set -euo pipefail

ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
PKG="${1:-space.alliswell.inbox.exportrecheck}"
LABEL="${2:-}"

BASE="/data/data/$PKG/app_webview/Default"
IDB_DIR="$BASE/IndexedDB/https_localhost_0.indexeddb.leveldb"
MIRROR_DIR="$BASE/Local Storage/leveldb"

# leveldb 目录里逐文件取 sha256，再按**文件名排序**把所有子哈希串起来取总哈希。
# 排序是必须的：`ls` 顺序不稳定，否则同一个磁盘状态会算出不同结果（不可复算）。
hash_dir() {
  local dir="$1" files acc f
  files="$("$ADB" shell "run-as $PKG ls '$dir'" 2>/dev/null | tr -d '\r' | grep -v '^LOCK$' | sort)"
  if [ -z "$files" ]; then
    echo "0 0 EMPTY-DIR"
    return
  fi
  acc=""
  local bytes=0 count=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in *:*) continue ;; esac   # 跳过 `ls` 的目录/错误行
    acc="$acc$("$ADB" exec-out run-as "$PKG" cat "$dir/$f" 2>/dev/null | shasum -a 256 | awk '{print $1}')"
    bytes=$((bytes + $("$ADB" exec-out run-as "$PKG" cat "$dir/$f" 2>/dev/null | wc -c)))
    count=$((count + 1))
  done <<< "$files"
  echo "$count $bytes $(printf '%s' "$acc" | shasum -a 256 | awk '{print $1}')"
}

if [ -n "$LABEL" ]; then echo "LABEL=$LABEL"; fi
echo "PKG=$PKG"

read -r n b h <<< "$(hash_dir "$IDB_DIR")"
echo "IDB_FILES=$n IDB_BYTES=$b IDB_SHA256=$h"

read -r n b h <<< "$(hash_dir "$MIRROR_DIR")"
echo "MIRROR_FILES=$n MIRROR_BYTES=$b MIRROR_SHA256=$h"
