#!/usr/bin/env bash
#
# 二次返工候选的归档与核对（手工版 `scripts/android-build.sh` 的后半段）。
#
# 为什么不用 `bash scripts/android-build.sh both`：
#   它的 `npx cap sync android` 会撞上沙箱的批量删除护栏（阈值 50，按回合计数，TTL 7 天），
#   本回合配额耗尽 ⇒ 必然失败。更糟的是它会**先删掉** `android/capacitor-cordova-android-plugins/`
#   再重建，删成功一半就崩，留下一个残缺目录让 Gradle 直接报错。
#
# 替代做法（等价性由两处核对保证，见报告 §6）：
#   1. Web 资源：`npm run sync:www` 生成 `www/`，再 `cp -R www/. android/app/src/main/assets/public/`
#      （只覆盖，不删除；文件集与上轮完全相同，用 `diff -rq` 核对）
#   2. 被删掉的那个生成目录：`node restore-cordova-plugins-project.js`（只写文件，不删）
#   3. 真正的打包：**原封不动**用 `./gradlew assembleDebug assembleRelease`
#   4. 签名与产物路径：逐条照抄 `scripts/android-build.sh` 的 `finish_debug` / `finish_release`
#
# 用法：bash archive-and-verify.sh
set -uo pipefail

RUN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$RUN/../../../.." && pwd)"
CAND="$REPO/releases/candidates/20260920T003000-ux-rework2"
BUILD_TOOLS="$HOME/Library/Android/sdk/build-tools/34.0.0"
KEYSTORE="$HOME/.android-keys/attention-inbox-release.jks"
CREDS="$HOME/.android-keys/attention-inbox-release.credentials.txt"

mkdir -p "$CAND"

# ---- 1. debug：与脚本一致的路径与产物 ----
cp -f "$REPO/android/app/build/outputs/apk/debug/app-debug.apk" \
      "$REPO/releases/安心收件箱-debug.apk"
cp -n "$REPO/releases/安心收件箱-debug.apk" \
      "$CAND/attention-inbox-debug-ux-rework2.apk"
echo "debug -> $CAND/attention-inbox-debug-ux-rework2.apk"

# ---- 2. release：zipalign + 签名（照抄脚本） ----
pass="$(grep '^storepass=' "$CREDS" | cut -d= -f2)"
aligned="$REPO/android/app/build/outputs/apk/release/app-release-aligned.apk"
"$BUILD_TOOLS/zipalign" -f -p 4 \
  "$REPO/android/app/build/outputs/apk/release/app-release-unsigned.apk" "$aligned"
"$BUILD_TOOLS/apksigner" sign \
  --ks "$KEYSTORE" --ks-key-alias attention-inbox \
  --ks-pass "pass:$pass" --key-pass "pass:$pass" \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$CAND/attention-inbox-release-ux-rework2.apk" "$aligned"
echo "release -> $CAND/attention-inbox-release-ux-rework2.apk"

# ---- 3. 校验和 ----
(cd "$CAND" && shasum -a 256 *.apk > SHA256SUMS.txt)
cat "$CAND/SHA256SUMS.txt"

# ---- 4. 逐字节核对包内 Web 资源（判据不是「构建成功」） ----
bash "$RUN/apk-web-assets.sh" \
  "$CAND/attention-inbox-debug-ux-rework2.apk" \
  "$CAND/attention-inbox-release-ux-rework2.apk"
