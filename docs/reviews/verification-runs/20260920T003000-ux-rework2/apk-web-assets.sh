#!/bin/bash
# 核对候选 APK 内的 assets/public/ 与当前工作区源码是否逐字节一致。
# 用法：bash apk-web-assets.sh <apk> [<apk> ...]
# 退出 0 = 全部逐字节一致；非 0 = 有差异（差异逐条打印）。
# 判据是 cmp 的逐字节结果，不是「构建成功」。
set -u

REPO="$(cd "$(dirname "$0")/../../../.." && pwd)"
OUT="$(dirname "$0")/apk-web-assets.txt"

# 需要核对的 Web 资源清单（相对仓库根）
FILES=(
  "index.html"
  "app-core.js"
  "sw.js"
)
while IFS= read -r f; do
  FILES+=("lib/$f")
done < <(cd "$REPO/lib" && ls *.js)

rc=0
: > "$OUT"
for apk in "$@"; do
  work="$(mktemp -d)"
  echo "== APK: $apk" | tee -a "$OUT"
  echo "   sha256(apk) = $(shasum -a 256 "$apk" | awk '{print $1}')" | tee -a "$OUT"
  unzip -oq "$apk" 'assets/public/*' -d "$work" || { echo "   UNZIP FAILED" | tee -a "$OUT"; rc=1; continue; }
  for f in "${FILES[@]}"; do
    a="$REPO/$f"
    b="$work/assets/public/$f"
    if [ ! -f "$b" ]; then
      echo "   MISSING_IN_APK  $f" | tee -a "$OUT"; rc=1; continue
    fi
    if cmp -s "$a" "$b"; then
      echo "   IDENTICAL       $f  ($(shasum -a 256 "$a" | awk '{print $1}'))" | tee -a "$OUT"
    else
      echo "   DIFFERS         $f" | tee -a "$OUT"; rc=1
    fi
  done
  rm -rf "$work"
done

if [ "$rc" -eq 0 ]; then
  echo "RESULT: ALL_WEB_ASSETS_BYTE_IDENTICAL"
else
  echo "RESULT: MISMATCH_FOUND"
fi
exit "$rc"
