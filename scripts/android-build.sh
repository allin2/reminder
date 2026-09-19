#!/usr/bin/env bash
#
# 一键构建安卓 APK（无需 Android Studio）
#
#   bash scripts/android-build.sh            # 构建调试版（默认）
#   bash scripts/android-build.sh debug      # 构建调试版
#   bash scripts/android-build.sh release    # 构建已签名的发布版
#   bash scripts/android-build.sh both       # 两者都构建
#
# 依赖（本机已装好，见 docs/android-build.md）：
#   JDK 17  : ~/Library/Java/JavaVirtualMachines/temurin-17.jdk
#   SDK     : ~/Library/Android/sdk
#   发布密钥 : ~/.android-keys/attention-inbox-release.jks
#
# 产物：
#   android/app/build/outputs/apk/debug/app-debug.apk
#   android/app/build/outputs/apk/release/app-release-unsigned.apk
#   releases/安心收件箱-debug.apk
#   releases/安心收件箱-release.apk
#
set -euo pipefail

TARGET="${1:-debug}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---------- 1. 环境变量 ----------
export JAVA_HOME="${JAVA_HOME:-$HOME/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

NODE_BIN="$HOME/.workbuddy/binaries/node/versions/22.22.2-3/bin"
[ -x "$NODE_BIN/node" ] && export PATH="$NODE_BIN:$PATH"

BUILD_TOOLS="$ANDROID_HOME/build-tools/34.0.0"
KEYSTORE="$HOME/.android-keys/attention-inbox-release.jks"
CREDS="$HOME/.android-keys/attention-inbox-release.credentials.txt"

fail() { echo "错误：$*" >&2; exit 1; }

[ -x "$JAVA_HOME/bin/java" ] || fail "找不到 JDK 17：$JAVA_HOME"
[ -x "$BUILD_TOOLS/apksigner" ] || fail "找不到 build-tools 34.0.0：$BUILD_TOOLS"
[ -d "$ANDROID_HOME/platforms/android-34" ] || fail "缺少 platforms;android-34"
[ -f "$REPO/android/local.properties" ] || {
  echo "sdk.dir=$ANDROID_HOME" > "$REPO/android/local.properties"
  echo "已生成 android/local.properties"
}

echo "JDK   : $("$JAVA_HOME/bin/java" -version 2>&1 | head -1)"
echo "SDK   : $ANDROID_HOME"
echo "目标  : $TARGET"
echo

# ---------- 2. 同步 Web 资源 ----------
cd "$REPO"
echo "==> 同步 Web 资源到安卓工程"
npm run --silent sync:www
npx --yes cap sync android

# ---------- 3. Gradle 构建 ----------
cd "$REPO/android"
chmod +x gradlew
GRADLE_ARGS=()
if [ -n "${HTTPS_PROXY:-}" ]; then
  PORT="${HTTPS_PROXY##*:}"
  GRADLE_ARGS+=(-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort="$PORT"
                -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort="$PORT")
  echo "（已透传 HTTP 代理端口 $PORT 给 Gradle）"
fi

build_one() {
  local variant="$1" task="assembleDebug" name="debug"
  if [ "$variant" = "release" ]; then task="assembleRelease"; name="release"; fi
  echo "==> ./gradlew $task"
  # bash 3.2（macOS 自带 /bin/bash）在 `set -u` 下不允许展开**空**数组：
  # `"${GRADLE_ARGS[@]}"` 会直接报 `GRADLE_ARGS[@]: unbound variable` 并终止。
  # 没设 HTTPS_PROXY 时 GRADLE_ARGS 就是空的 —— 于是「本地无代理」这一最常见情况下构建必然失败。
  # 这里显式分支，不依赖 bash 版本，也不给 gradlew 传空参数。
  if [ ${#GRADLE_ARGS[@]} -gt 0 ]; then
    ./gradlew "${GRADLE_ARGS[@]}" "$task"
  else
    ./gradlew "$task"
  fi
}

mkdir -p "$REPO/releases"

finish_debug() {
  local apk="app/build/outputs/apk/debug/app-debug.apk"
  [ -f "$apk" ] || fail "调试版产物不存在"
  cp -f "$apk" "$REPO/releases/安心收件箱-debug.apk"
  echo "调试版 -> $REPO/releases/安心收件箱-debug.apk"
  "$BUILD_TOOLS/apksigner" verify --print-certs "$REPO/releases/安心收件箱-debug.apk" 2>&1 | grep -E "Signer #1 certificate DN" || true
}

finish_release() {
  local raw="app/build/outputs/apk/release/app-release-unsigned.apk"
  [ -f "$raw" ] || fail "发布版产物不存在"
  [ -f "$KEYSTORE" ] || fail "找不到发布签名密钥：$KEYSTORE（请先生成，见 docs/android-build.md）"
  local pass
  pass="$(grep '^storepass=' "$CREDS" | cut -d= -f2)"
  local aligned="$REPO/android/app/build/outputs/apk/release/app-release-aligned.apk"
  "$BUILD_TOOLS/zipalign" -f -p 4 "$raw" "$aligned"
  rm -f "$REPO/releases/安心收件箱-release.apk" "$REPO/releases/安心收件箱-release.apk.idsig"
  "$BUILD_TOOLS/apksigner" sign \
    --ks "$KEYSTORE" --ks-key-alias attention-inbox \
    --ks-pass "pass:$pass" --key-pass "pass:$pass" \
    --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
    --out "$REPO/releases/安心收件箱-release.apk" "$aligned"
  echo "发布版 -> $REPO/releases/安心收件箱-release.apk"
  "$BUILD_TOOLS/apksigner" verify -v "$REPO/releases/安心收件箱-release.apk" 2>&1 | grep -E "^Verifies|Verified using v[123] scheme" || true
}

case "$TARGET" in
  debug)   build_one debug;   finish_debug ;;
  release) build_one release; finish_release ;;
  both)    build_one debug;   finish_debug
           build_one release; finish_release ;;
  *)       fail "未知目标：$TARGET（可选 debug / release / both）" ;;
esac

echo
echo "===== 产物汇总 ====="
ls -lh "$REPO/releases"/*.apk
echo
echo "安装到已连接设备："
echo "  \"$ANDROID_HOME/platform-tools/adb\" install -r \"$REPO/releases/安心收件箱-debug.apk\""
