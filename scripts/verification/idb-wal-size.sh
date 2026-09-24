#!/usr/bin/env bash
#
# 逐文件列出设备侧 leveldb 目录的**字节数**（含 WAL `NNNNNN.log`）。
#
# 为什么单独要这个：`device-storage-hash.sh` 只给「目录合计字节」，而本轮要回答的
# 那个问题恰恰是**某一类文件**的增长 —— 冷启动是否又追加了一次权威提交。
# 上一轮实测规律是 WAL `000003.log` 每轮 +3276 B（= 2 × 1638 B 的状态 JSON），
# 而内容哈希不变。合计字节看不出「是哪个文件在长」，所以这里逐文件报。
#
# 判据（配合冷启动轮次）：
#   同一份内容被重复提交 ⇒ WAL 单调增长；提交幂等 ⇒ WAL 不增长（或仅 leveldb 自身压实带来的变化）。
#
# 用法：bash scripts/verification/idb-wal-size.sh [包名] [标签]
set -uo pipefail

ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
PKG="${1:-space.alliswell.inbox.exportrecheck}"
LABEL="${2:-}"

BASE="/data/data/$PKG/app_webview/Default"

# 注意：用 `ls -l` 的 5 列（size 在第 5 列）比 `stat` 稳（toybox/busybox 差异大）。
dump() {
  local kind="$1" dir="$2" out
  out="$("$ADB" shell "run-as $PKG ls -l '$dir'" 2>/dev/null | tr -d '\r')"
  if [ -z "$out" ]; then echo "${kind}_DIR=ABSENT"; return; fi
  local total=0 line size name
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in total*) continue ;; esac
    # 目录本身（drwx…）不算文件
    case "$line" in d*) continue ;; esac
    size="$(printf '%s' "$line" | awk '{print $5}')"
    name="$(printf '%s' "$line" | awk '{print $NF}')"
    case "$size" in ''|*[!0-9]*) continue ;; esac
    echo "${kind}_FILE=$name SIZE=$size"
    total=$((total + size))
  done <<< "$out"
  echo "${kind}_TOTAL_BYTES=$total"
}

# WAL 单独拎出来：名字形如 000003.log，且**不含** MANIFEST-000001（那也以 - 结尾但不是 .log）
wal_bytes() {
  "$ADB" shell "run-as $PKG ls -l '$1'" 2>/dev/null | tr -d '\r' \
    | awk '/\.log$/ { s+=$5 } END { print s+0 }'
}

if [ -n "$LABEL" ]; then echo "LABEL=$LABEL"; fi
echo "PKG=$PKG"
echo "AT=$(date +%Y-%m-%dT%H:%M:%S%z)"

dump IDB "$BASE/IndexedDB/https_localhost_0.indexeddb.leveldb"
dump MIRROR "$BASE/Local Storage/leveldb"

echo "IDB_WAL_BYTES=$(wal_bytes "$BASE/IndexedDB/https_localhost_0.indexeddb.leveldb")"
echo "MIRROR_WAL_BYTES=$(wal_bytes "$BASE/Local Storage/leveldb")"
