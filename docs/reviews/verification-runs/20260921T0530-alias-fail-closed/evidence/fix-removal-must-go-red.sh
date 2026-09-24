#!/bin/bash
# 「拔掉修复必须变红」取证：两个最小变异，各跑一次两套静态判定，然后按字节还原。
# 判据不是「有输出」而是「行首 ✗ + 断言名 / 通过 N 项里的 N 下降」。
set -u
cd /Users/qlyf/Developer/reminder
RUN=/tmp/fc-mut
mkdir -p "$RUN"

PS=scripts/verification/production-scripts.js
AC=app-core.js

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
PS_SHA=$(sha "$PS"); AC_SHA=$(sha "$AC")
echo "解锁前 sha: production-scripts.js=$PS_SHA  app-core.js=$AC_SHA"

# 备份（按字节）
cp "$PS" "$RUN/production-scripts.orig.js"
cp "$AC" "$RUN/app-core.orig.js"

banner() { echo; echo "############ $1 ############"; }

# ============================================================
banner "N1 变异：把两类歧义从 problems 里摘掉（退回「只报告、不判错」）"
python3 - <<'PY'
p = "scripts/verification/production-scripts.js"
s = open(p, encoding="utf-8").read()
old = '''  aliasInfo.ambiguous.forEach(a => problems.push(
    "ambiguous-alias:" + a + "（同一名字既被赋成已知命名空间、又被赋成别的东西）"));
  Array.from(ambiguousRefs.keys()).sort().forEach(k => problems.push(
    "ambiguous-ref:" + k + "（归属不可证明）"));'''
assert old in s, "N1 锚点未找到"
s = s.replace(old, "  /* N1 变异：歧义不再进 problems（退回「只报告、不判错」） */")
open(p, "w", encoding="utf-8").write(s)
print("N1 已注入")
PY
node --check "$PS" && echo "N1 语法 OK"
{
  echo "--- node test-boot-combination.js ---"
  node test-boot-combination.js 2>&1 | grep -E "^  ✗ |^通过|^  MUT-|MUT-C" 
  echo "--- node scripts/verification/parse-single-source.js ---"
  node scripts/verification/parse-single-source.js 2>&1 | grep -E "^  ✗ |^通过"
} > "$RUN/N1-red.log" 2>&1
echo "N1 变红摘要："
grep -E "^  ✗ " "$RUN/N1-red.log" || echo "  （没有 ✗ —— 恒真！）"
grep -E "^通过" "$RUN/N1-red.log"
cp "$RUN/production-scripts.orig.js" "$PS"
echo "N1 还原后 sha 一致 = $([ "$(sha "$PS")" = "$PS_SHA" ] && echo YES || echo NO)"

# ============================================================
banner "N2 变异：把 app-core 的别名改制整体退回（feedbackApi→f，selectedFile→f）"
python3 - <<'PY'
import re
p = "app-core.js"
s = open(p, encoding="utf-8").read()
n1 = s.count("feedbackApi"); n2 = s.count("selectedFile")
s = s.replace("feedbackApi", "f").replace("selectedFile", "f")
open(p, "w", encoding="utf-8").write(s)
print("feedbackApi 替换 %d 处，selectedFile 替换 %d 处" % (n1, n2))
PY
node --check "$AC" && echo "N2 语法 OK"
{
  echo "--- node test-boot-combination.js ---"
  node test-boot-combination.js 2>&1 | grep -E "^  ✗ |^通过"
  echo "--- node scripts/verification/parse-single-source.js ---"
  node scripts/verification/parse-single-source.js 2>&1 | grep -E "^  ✗ |^通过"
} > "$RUN/N2-red.log" 2>&1
echo "N2 变红摘要："
grep -E "^  ✗ " "$RUN/N2-red.log" || echo "  （没有 ✗ —— 恒真！）"
grep -E "^通过" "$RUN/N2-red.log"

# ============================================================
banner "按字节还原并核对"
cp "$RUN/app-core.orig.js" "$AC"
cp "$RUN/production-scripts.orig.js" "$PS"
echo "app-core.js          sha 一致 = $([ "$(sha "$AC")" = "$AC_SHA" ] && echo YES || echo NO)"
echo "production-scripts.js sha 一致 = $([ "$(sha "$PS")" = "$PS_SHA" ] && echo YES || echo NO)"
echo
echo "############ 还原后回绿确认 ############"
node test-boot-combination.js 2>&1 | tail -3
node scripts/verification/parse-single-source.js 2>&1 | tail -2
