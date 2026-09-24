#!/usr/bin/env bash
#
# P2-C-R2 真机复验：**在设备上**制造「权威存储（IndexedDB）打不开」的故障，看应用是否 fail-closed。
#
# 为什么改用「改磁盘上的 leveldb」而不是「在 WebView 层注入」：
#   上一轮把真机 IDB 故障注入记为 NOT_PERFORMED，理由是「不改 APK 就注入不了 WebView 层的故障」。
#   其实还有一条更朴素的路线 —— **直接破坏磁盘上的 leveldb 目录**（`CURRENT` 指向一个不存在的
#   MANIFEST ⇒ leveldb 打开即报 Corruption）。它比改包更贴近真实故障（真实的存储损坏就是这样），
#   而且**不动 APK ⇒ 与源码等价性不受影响**，事后退回备份即可完全复原。
#
# 注入点选择：
#   只改 `CURRENT` 一个文件（19 字节 → 指向 MANIFEST-000099）。**不动 `000003.log`**，
#   所以原始数据一个字节都没丢，恢复备份后逐字节可比。
#
# 子命令：
#   backup  <备份目录>   把 IDB leveldb 目录逐文件拉到本地 + 写 sha256 清单
#   corrupt              把 CURRENT 指向一个不存在的 MANIFEST（制造「打不开」）
#   restore <备份目录>   把备份逐文件写回设备（run-as cp，属主仍是应用 uid）
#   verify  <备份目录>   复原核对：**文件名集合**双向差集（多出/缺失都判失败）+ 逐个逐字节比哈希
#                        （只比清单内文件会漏掉「设备目录残留新文件」，见缺口 #3）
#
# ⚠️ verify 的前提是「**restore 之后、应用启动之前**，且进程已停止」。
#    应用一旦启动，leveldb 就会在 000003.log 追加重放标记、重写 LOG/LOG.old ⇒
#    这几个文件必然不再逐字节一致，此时 VERIFY=FAIL 是**正确**行为（不是缺陷）。
#    （实测见 docs/reviews/verification-runs/20260922T1130-evidence-script-gaps/gap3-06-*.txt：
#     启动后文件**集合**仍 5/5 相同，差异只在 leveldb 打开时必然重写的三个文件上。）
#
# 用法示例：
#   ADB=~/Library/Android/sdk/platform-tools/adb \
#   bash scripts/verification/p2cr-idb-fault-inject.sh backup /tmp/p2cr2-idb-backup
set -uo pipefail

ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
PKG="${PKG:-space.alliswell.inbox.exportrecheck}"
DIR="${IDB_DIR:-/data/data/$PKG/app_webview/Default/IndexedDB/https_localhost_0.indexeddb.leveldb}"
TMP="/data/local/tmp/p2cr2-inject"

files() { # 列出目录内的**普通文件**（跳过 LOCK 之类由 leveldb 自己重建的锁文件）
  "$ADB" shell "run-as $PKG ls '$DIR'" 2>/dev/null | tr -d '\r' | grep -v '^LOCK$' | sort
}

cmd_backup() {
  local out="${1:?备份目录}"
  mkdir -p "$out"
  : > "$out/SHA256SUMS"
  local f
  for f in $(files); do
    "$ADB" exec-out run-as "$PKG" cat "$DIR/$f" > "$out/$f" 2>/dev/null
    printf '%s  %s\n' "$(shasum -a 256 "$out/$f" | awk '{print $1}')" "$f" >> "$out/SHA256SUMS"
  done
  echo "BACKUP_DIR=$out"
  echo "BACKUP_FILES=$(wc -l < "$out/SHA256SUMS" | tr -d ' ')"
  cat "$out/SHA256SUMS"
}

cmd_corrupt() {
  "$ADB" shell "mkdir -p $TMP" >/dev/null 2>&1
  printf 'MANIFEST-000099\n' > /tmp/p2cr2-current-bad.txt
  "$ADB" push /tmp/p2cr2-current-bad.txt "$TMP/CURRENT" >/dev/null 2>&1
  # 注意：重定向必须由 run-as 起的 sh 执行，否则会用 adb shell 自己的 uid 去写应用目录（必然失败）
  "$ADB" shell "run-as $PKG sh -c 'cp $TMP/CURRENT $DIR/CURRENT'" 2>&1
  echo "CORRUPTED_CURRENT=$("$ADB" shell "run-as $PKG cat '$DIR/CURRENT'" 2>/dev/null | tr -d '\r')"
}

cmd_restore() {
  local out="${1:?备份目录}"
  "$ADB" shell "mkdir -p $TMP" >/dev/null 2>&1
  # 目录本身可能已经被 Chromium 的「损坏库自动删除」清掉，所以先 mkdir -p 再逐文件拷回。
  "$ADB" shell "run-as $PKG mkdir -p '$DIR'" 2>&1
  local f
  for f in $(awk '{print $2}' "$out/SHA256SUMS"); do
    "$ADB" push "$out/$f" "$TMP/$f" >/dev/null 2>&1
    "$ADB" shell "run-as $PKG cp $TMP/$f '$DIR/$f'" 2>&1
  done
  echo "RESTORED=1"
}

cmd_verify() {
  local out="${1:?备份目录}"
  local bad=0 f cur want
  local want_list cur_list extra missing

  # ① **文件名集合必须一致**（本版修正：证据脚本缺口 #3）。
  #    旧版只遍历 SHA256SUMS 里的文件逐个比哈希 —— 设备目录里**多出来的**文件
  #    （leveldb 新写的 LOG/LOG.old/NNNNNN.log、上次注入残留的临时文件）根本不在被遍历的
  #    名单里，于是照样 VERIFY=PASS，把「目录没还原干净」放过去。
  #    这里先取两个「普通文件名」集合再做双向差集：多出、缺失都判失败。
  want_list="$(awk '{print $2}' "$out/SHA256SUMS" | sort)"
  cur_list="$(files | sort)"
  extra="$(comm -13 <(printf '%s\n' "$want_list") <(printf '%s\n' "$cur_list") | grep -v '^$' || true)"
  missing="$(comm -23 <(printf '%s\n' "$want_list") <(printf '%s\n' "$cur_list") | grep -v '^$' || true)"

  local n_want n_cur
  n_want="$(printf '%s\n' "$want_list" | grep -c . || true)"
  n_cur="$(printf '%s\n' "$cur_list" | grep -c . || true)"
  echo "  文件集合：备份清单 ${n_want} 个 / 设备当前 ${n_cur} 个"
  if [ -n "$extra" ]; then
    echo "  ✗ 设备目录存在**备份清单之外**的文件（残留，未还原干净）："
    printf '      + %s\n' $extra
    bad=1
  else
    echo "  ✓ 无多余文件（设备普通文件集合 ⊆ 备份清单）"
  fi
  if [ -n "$missing" ]; then
    echo "  ✗ 备份清单里的文件在设备上**缺失**："
    printf '      - %s\n' $missing
    bad=1
  fi

  # ② 清单内文件逐个逐字节比对
  while read -r want f; do
    [ -n "$f" ] || continue
    cur="$("$ADB" exec-out run-as "$PKG" cat "$DIR/$f" 2>/dev/null | shasum -a 256 | awk '{print $1}')"
    if [ "$cur" = "$want" ]; then
      echo "  ✓ $f 逐字节一致"
    else
      echo "  ✗ $f 不一致：备份 $want 设备 $cur"
      bad=1
    fi
  done < "$out/SHA256SUMS"

  [ "$bad" = "0" ] && echo "VERIFY=PASS" || echo "VERIFY=FAIL"
  return "$bad"
}

case "${1:-}" in
  backup)  shift; cmd_backup "$@" ;;
  corrupt) shift; cmd_corrupt "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  verify)  shift; cmd_verify "$@" ;;
  *) sed -n '2,30p' "$0"; exit 1 ;;
esac
