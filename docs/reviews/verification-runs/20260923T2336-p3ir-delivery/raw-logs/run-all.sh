#!/usr/bin/env bash
# P3-I-R 原始日志采集器（实施方自测，逐套件落盘 + 退出码）
#
# 为什么不直接跑 npm test 了事：README 的水位必须能被独立复验方**逐条重跑**并核对，
# 所以每一支套件都单独留一份原始 stdout/stderr 与退出码。
#
# 环境纪律：
#   · Node 必须 20.x —— 22.x 在 test-unit.js:215 写 global.navigator 会 TypeError。
#   · npm 在后台非 TTY shell 里会挂住（DETAIL.md §17.1），所以只在前台跑，且整体落盘。
set -u

REPO="/Users/qlyf/Developer/reminder"
RUN="$REPO/docs/reviews/verification-runs/20260923T2336-p3ir-delivery"
OUT="$RUN/raw-logs"

cd "$REPO" || exit 1
export PATH="$HOME/.nvm/versions/node/v20.17.0/bin:$PATH"

echo "cwd=$REPO" > "$OUT/exit-codes.txt"
echo "node=$(node --version)" >> "$OUT/exit-codes.txt"
echo "npm=$(npm --version)" >> "$OUT/exit-codes.txt"
echo "collected_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$OUT/exit-codes.txt"
echo "---" >> "$OUT/exit-codes.txt"

record() {
  local name="$1"; shift
  "$@" > "$OUT/$name.log" 2>&1
  local code=$?
  printf '%-34s exit=%s\n' "$name" "$code" | tee -a "$OUT/exit-codes.txt"
  return 0
}

record 01-npm-test                  npm test
record 02-test-unit                 node test-unit.js
record 03-test-native-reminders     node test-native-reminders.js
record 04-p3a-model-tests           node scripts/verification/p3a-model-tests.js
record 05-p3b-persistence-tests     node scripts/verification/p3b-persistence-tests.js
record 06-p3c-transaction-tests     node scripts/verification/p3c-transaction-tests.js
record 07-p3d-items-tests           node scripts/verification/p3d-items-tests.js
record 08-p3e-coordinator-tests     node scripts/verification/p3e-coordinator-tests.js
record 09-p3f-review-tests          node scripts/verification/p3f-review-tests.js
record 10-p3g-alerts-tests          node scripts/verification/p3g-alerts-tests.js
record 11-p3h-platform-tests        node scripts/verification/p3h-platform-tests.js
record 12-p3i-modularization-tests  node scripts/verification/p3i-modularization-tests.js
record 13-test-boot-combination     node test-boot-combination.js
record 14-test-smoke                node test-smoke.js
record 15-test-regressions          node test-regressions.js
record 16-parse-single-source       node scripts/verification/parse-single-source.js

# 浏览器族：需要 websocket-client，只有这个隔离 venv 里有
PY="$HOME/.workbuddy/binaries/python/envs/default/bin/python"
record 17-browser-views             "$PY" scripts/verification/browser-views-check.py
record 18-browser-capture           "$PY" scripts/verification/browser-capture-check.py
record 19-browser-recovery          "$PY" scripts/verification/browser-recovery-check.py

echo "---" >> "$OUT/exit-codes.txt"
echo "done=$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$OUT/exit-codes.txt"
cat "$OUT/exit-codes.txt"
