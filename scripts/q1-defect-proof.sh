#!/usr/bin/env bash
#
# 缺陷可复现性验证（区分度证明）——Q1：`addListener` 契约
#
# 用途：证明「新增的测试**真的能抓住**这个缺陷」，而不是只会陪跑。
#   做法：把仓库拷到临时沙箱，**只把源码回退成修复前的写法**（测试保持最新），
#         然后跑测试。预期结果是**变红**，且报错原文与真机实测一致：
#             App init failed: app.addListener(...).catch is not a function
#
#   bash scripts/q1-defect-proof.sh
#
# 说明：临时副本位于 $TMPDIR 下，不动工作区。回退是**文本替换**，不依赖 git，
#       因此在未提交的工作区里同样可用。
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST="${TMPDIR:-/tmp}/q1-defect-proof"
PY="$(command -v python3)"

NODE_BIN="$HOME/.workbuddy/binaries/node/versions/22.22.2-3/bin"
[ -x "$NODE_BIN/node" ] && export PATH="$NODE_BIN:$PATH"

rm -rf "$DST" && mkdir -p "$DST"
cd "$REPO" || exit 1
cp -R lib "$DST/"
cp app-core.js index.html styles.css sw.js manifest.json package.json "$DST/"
cp test-unit.js test-native-reminders.js test-smoke.js test-regressions.js "$DST/"

"$PY" - "$DST" <<'PY'
import sys

dst = sys.argv[1]

# ① lib/native-reminders.js —— 回到修复前的 app.addListener(...).catch(...)
p = dst + "/lib/native-reminders.js"
s = open(p, encoding="utf-8").read()
a = s.index("      // Q1：这里此前是 `app.addListener(")
b = s.index("      // 启动时也消费一次")
s = s[:a] + (
    "      const app = plugin(\"App\");\n"
    "      if (app && typeof app.addListener === \"function\") {\n"
    "        app.addListener(\"appStateChange\", state => {\n"
    "          if (state && state.isActive) poll();\n"
    "        }).catch(() => {});\n"
    "      }\n"
) + s[b:]
s = s.replace(
    '    listenSafely(bridge, "alarmAction", data => handler(data || {}));',
    '    try {\n      bridge.addListener("alarmAction", data => handler(data || {}));\n    } catch (error) {}'
)
open(p, "w", encoding="utf-8").write(s)
print("[lib/native-reminders.js] 已回退到修复前写法:", "}).catch(() => {});" in s)

# ② app-core.js —— 撤掉启动链的 try/catch 兜底
p2 = dst + "/app-core.js"
s2 = open(p2, encoding="utf-8").read()
s2 = s2.replace(
    """    if (NativeReminders.onAlarmAction) {
      try {
        NativeReminders.onAlarmAction(handleAlarmAction);
      } catch (error) {
        console.error(
          "Alarm action listener registration failed:",
          error && error.message ? error.message : error
        );
      }
    }""",
    """    if (NativeReminders.onAlarmAction) {
      NativeReminders.onAlarmAction(handleAlarmAction);
    }"""
)
open(p2, "w", encoding="utf-8").write(s2)
print("[app-core.js] 启动链兜底已撤:", "Alarm action listener registration failed" not in s2)
PY

echo
echo "########## 沙箱副本（修复前源码 + 最新测试）##########"
cd "$DST" || exit 1
rc_all=0
for f in test-native-reminders.js test-smoke.js test-regressions.js; do
  node "$f" > "$DST/$f.log" 2>&1
  rc=$?
  [ "$rc" -ne 0 ] && rc_all=1
  printf '%-26s 退出码=%s  %s\n' "$f" "$rc" "$(grep -E '^通过: ' "$DST/$f.log" | tail -1)"
done

echo
echo "----- 捕获到的关键报错（应出现原始的 TypeError）-----"
grep -h "App init failed" "$DST"/*.log 2>/dev/null | sort -u || true

echo
echo "----- 失败项（区分度的直接证据）-----"
grep -h "  ✗" "$DST"/*.log 2>/dev/null || echo "(没有失败项 —— 说明新用例没抓住缺陷，需要检查)"

echo
echo "临时副本：$DST"
echo "预期：native 与 regressions 变红；smoke 保持绿（该套件没有平台 mock，本来就走不到该分支）。"
exit 0
