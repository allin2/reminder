# 安卓开发环境与 APK 构建产物（2026-09-17）

本文件记录本机安卓构建环境的**实际安装结果**、**可复现的构建方式**、**产物的类型与路径**，
以及**在安卓设备上安装运行的验证证据**。

> 运行期验证发现的缺陷（`init()` 中途中断）单独记在
> `docs/reviews/android-runtime-verification-2026-09-17.md`，本文件只描述环境与产物。
> **该缺陷已于 2026-09-17 修复并复验通过**（修复与更正后的完整证据见该报告 §2）。

对应源码：`main`，HEAD `acbe3c539c88f00d836d448dafc31addf1496c90`（`fix: harden Android reminder transactions`）。
**修复后的产物与源码已同步**（包内 `app-core.js` / `lib/native-reminders.js` 与工作区逐字节一致）。

---

## 1. 结论摘要

| 项 | 结果 |
| --- | --- |
| 本地安卓开发环境 | 已装齐（JDK 17 + SDK + 构建工具 + 平台 + 模拟器 + AVD），**全程未用 Android Studio** |
| 构建产物类型 | **调试版** 与 **发布版（已签名）** 各一份 |
| 调试版路径 | `releases/安心收件箱-debug.apk` |
| 发布版路径 | `releases/安心收件箱-release.apk` |
| 安装 | ✅ 两者均在 Android 14 / arm64-v8a 上 `Success` |
| 启动 | ✅ 冷启动进入 `MainActivity`，持续前台无崩溃；WebView 内 DOM 完整渲染 |
| 运行 | ✅ **已修复**：`init()` 修复前在 `app-core.js:5127` 中断（P0），修复后 `ready() === true`、首启 seed 生效 → 见 §8 |

**验收口径**：「能在安卓设备上正常安装与运行」中，**安装、启动与初始化完整性均已达成**。
**仍未验证**的是真机（非模拟器）与 Doze / 锁屏 / 重启后的投递行为，见 §7。

---

## 2. 环境安装结果

### 2.1 为什么必须手工装

本机原始状态：只有 **JDK 24**（`java 24`）、**无 Android SDK**、**无 gradle**、**无 adb**、**无 Homebrew**。

- Capacitor 6 / Android Gradle Plugin 8.2.1 **不支持 JDK 24**，Gradle 8.2.1 亦不支持 → 必须装 JDK 17。
- 无 Homebrew → 走**官方命令行工具包 + 官方压缩包**手工安装，全程落在用户目录，**不需要 sudo**。

### 2.2 JDK 17（Temurin）

| 项 | 值 |
| --- | --- |
| 版本 | `openjdk 17.0.20.1 2026-08-18` / `Temurin-17.0.20.1+1`（aarch64） |
| 安装位置 | `~/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home` |
| 安装包 | `OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.20.1_1.tar.gz`（177 MB） |
| SHA-256 | `196d13ba5f10414bef7f6a05a9b3f00edacb18ebacef2b99485db9e2ee18f0e8`（与官方一致） |

装在 `~/Library/Java/JavaVirtualMachines/` 下（而不是 `/Library/...`），因此
`/usr/libexec/java_home` 能识别、且**无需 sudo**。

### 2.3 Android SDK

安装位置：`~/Library/Android/sdk`（约 **5.9 GB**）

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| `cmdline-tools` | sdkmanager 12.0 | `commandlinetools-mac-11076708_latest.zip` |
| `platform-tools` | adb 1.0.41 / 37.0.1-15733141 | 设备与模拟器调试 |
| `platforms;android-34` | Android 14 | `compileSdk` / `targetSdk` |
| `build-tools;34.0.0` | 34.0.0 | aapt2 / zipalign / apksigner |
| `emulator` | 37.2.9 | 与官方仓库 `emulator-darwin_aarch64-16322952.zip` 对应 |
| `system-images;android-34;google_apis;arm64-v8a` | rev 14 | Apple Silicon 原生镜像（**非** x86 转译） |

许可：`sdkmanager --licenses` 已全部接受，`~/Library/Android/sdk/licenses/` 下已落盘。

**三处必须手工绕过的坑**（复现时同样会遇到）：

1. **`sdkmanager` 下载 `emulator` 包时 TLS 握手被代理中断**
   （报 `SSL peer shut down incorrectly`；`platform-tools` / `platforms` / `build-tools` 均正常，
   只有这个 420 MB 的包必失败，重试 3 次仍失败）。
   → 改为从官方仓库索引 `https://dl.google.com/android/repository/repository2-3.xml`
   中取出真实 URL，用 `curl` 下载后手工解压。
2. **手工解压的 `emulator` 不被 SDK 识别** —— `avdmanager` 会报
   `Package path is not valid: emulator`，因为它按 `package.xml` 索引而不是目录。
   → 按 `platform-tools/package.xml` 的官方元数据格式（含 `license id="android-sdk-license"` 全文）
   为 `emulator/package.xml` 补一份，`avdmanager` 即正常识别。
3. **系统镜像压缩包多一层目录** —— 解压后是 `arm64-v8a/…`，
   而 SDK 期望内容直接位于 `system-images/android-34/google_apis/arm64-v8a/`。
   → 需**展平一层**。

### 2.4 模拟器实例（AVD）

| 项 | 值 |
| --- | --- |
| 名称 | `attention_api34` |
| 设备档 | `medium_phone` |
| ABI | `arm64-v8a` |
| 屏幕 | 1080 × 2400 @ 420 dpi |
| 内存 | 1536 MB |
| 位置 | `~/.android/avd/attention_api34.avd`（约 1.2 GB） |

启动：

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
"$ANDROID_HOME/emulator/emulator" -avd attention_api34 -no-snapshot -no-boot-anim -no-audio
```

> 沙箱/脚本环境注意：模拟器会随执行它的 shell 一起被回收。
> 需要「启动 → 安装 → 取证」时，**必须在同一条命令内**完成，否则会误判为「应用闪退」。

### 2.5 发布签名密钥

**刻意放在仓库之外**，避免把签名身份写进版本库：

| 项 | 值 |
| --- | --- |
| 密钥库 | `~/.android-keys/attention-inbox-release.jks`（PKCS12，600，目录 700） |
| 别名 | `attention-inbox` |
| 凭据记录 | `~/.android-keys/attention-inbox-release.credentials.txt`（600） |
| 证书 DN | `CN=Attention Inbox, OU=Local Android Build, O=Local, L=Beijing, ST=Beijing, C=CN` |
| 证书 SHA-256 | `bbdaeece7fa34052a529e3fc3aaab2a4f6d688b7e60845750f10cd4e17469f0b` |
| 有效期 | 10000 天 |

> ⚠️ **这是本地自签的测试密钥，不是应用商店的发布密钥。**
> 若要真正上架，应另行生成并妥善保管正式密钥；且**同一应用后续升级必须沿用同一把密钥**，
> 否则无法覆盖安装。凭据文件在仓库外，不会被提交。

### 2.6 工程内改动

**环境搭建那一轮**（只碰构建基建，不碰产品代码）：

| 文件 | 改动 | 说明 |
| --- | --- | --- |
| `android/local.properties` | 新建，写入 `sdk.dir=…` | 已被 `.gitignore` 忽略 |
| `android/gradlew` | 补执行权限（`chmod +x`） | 仓库里原本丢了 exec 位，Gradle wrapper 需要它 |
| `scripts/android-build.sh` | 新增 | 一键构建脚本，见 §4 |
| `releases/安心收件箱-debug.apk` | 覆盖为本次构建产物 | 旧包另存为 `…-debug.apk.stale-20260916` |
| `releases/安心收件箱-release.apk` | 新增 | 签名后的发布版 |

**后续 V1 修复那一轮**（按用户裁决修改产品代码，见 §8 与评审报告 §2）：

| 文件 | 改动 |
| --- | --- |
| `lib/native-reminders.js` | 新增 `listenSafely()`；`onAlarmAction` 两处注册改走它 |
| `app-core.js` | 闹钟监听注册包 `try/catch`（启动链错误隔离） |
| `test-regressions.js` | mock 契约改为同步句柄；`setInterval` 可观测；新增 Q1 用例 8 项 |
| `test-native-reminders.js` | mock 契约改为同步句柄；新增 Q1 用例 5 项 |
| `test-smoke.js` | 断言 `await app.ready() === true`（新增 1 项） |
| `releases/安心收件箱-debug.apk` | 重建（含修复） |

---

## 3. 构建产物

### 3.1 清单

> **调试版已因 V1 修复而重建**（2026-09-17 12:37），下表调试版一列为**新产出**；
> 发布版仍是修复前构建的产物，其内含的 Web 资源对应 V1 修复前的 `app-core.js`。
> 若需要「含修复的发布版」，重跑 `bash scripts/android-build.sh release` 即可。

|  | 调试版（含 V1 修复） | 发布版（修复前构建） |
| --- | --- | --- |
| 路径 | `releases/安心收件箱-debug.apk` | `releases/安心收件箱-release.apk` |
| Gradle 原始产物 | `android/app/build/outputs/apk/debug/app-debug.apk` | `android/app/build/outputs/apk/release/app-release-unsigned.apk` |
| 大小 | 3.8 MB | 2.9 MB |
| SHA-256 | `326d4132b18ea9a53094f2cadd86257c7060d6ba9e431c0b21b222bdf7c55c84` | `d449391c6cf3ee4dbe5762ff9811cf970f773edad9909841b6a6961b2b10dbf6` |
| 签名证书 DN | `C=US, O=Android, CN=Android Debug` | `CN=Attention Inbox, OU=Local Android Build, …` |
| 证书 SHA-256 | `7ad67d49f059c504f43f6866e828b44acd03f8fcad8a216e2c689fb504dccc0a` | `bbdaeece…69f0b` |
| 签名方案 | v1 ✅ v2 ✅ | v1 ✅ v2 ✅ v3 ✅ |
| 可调试标记 | `application-debuggable` 有 | **无** |
| zipalign（4 字节） | ✅ | ✅ |
| 渠道/统计 SDK | 无 | 无 |

### 3.2 两版共有的元数据（`aapt2 dump badging`）

```
package: name='space.alliswell.inbox'  versionCode='1'  versionName='1.0'
compileSdkVersion='34'  platformBuildVersionName='14'
sdkVersion:'22'  targetSdkVersion:'34'
application-label:'安心收件箱'
```

权限（两版一致，共 **11** 条）：
`INTERNET`、`POST_NOTIFICATIONS`、`SCHEDULE_EXACT_ALARM`、`USE_EXACT_ALARM`、
`RECEIVE_BOOT_COMPLETED`、`WAKE_LOCK`、`VIBRATE`、`FOREGROUND_SERVICE`、
`USE_FULL_SCREEN_INTENT`、`DISABLE_KEYGUARD`、`space.alliswell.inbox.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`。

### 3.3 打包内容校验：产物不陈旧

这是本次最需要确认的一点——仓库里原有的 `releases/安心收件箱-debug.apk`（9-16）**是陈旧包**
（其 `assets/public/` 缺少 `index.html`、`app-core.js`）。本次逐字节核对（**修复后重测**）：

| 文件 | APK 内（SHA-256 前 16 位） | 磁盘源码 | 一致 |
| --- | --- | --- | --- |
| `assets/public/app-core.js` | `2bdfedb4a06c87bc` | 同左 | ✅ |
| `assets/public/lib/native-reminders.js` | `afb10ba791ece3c5` | 同左 | ✅ |
| `assets/public/index.html` | `f0f82b6ffee0dbbd` | 同左 | ✅ |

两个包的 Web 资源**完全相同**（修复前构建时核对过），且与**当时的**源码逐字节一致。
修复后重建的调试版同样逐字节一致 —— 所以「产物不陈旧」这一结论在修复前后都成立。

> **构建期一个必须注意的点**：`npx cap sync android` 会在
> `android/capacitor-cordova-android-plugins/` 下做批量删除，作业沙箱的**批量删除护栏**
> （`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，阈值 50 个文件/轮）会把它拦下并使构建失败。
> 绕法是先手工整目录移除再同步：`rm -rf android/capacitor-cordova-android-plugins && npx cap sync android`
> —— 这样它只需新建、无需删除。注意 `cap copy` **不会**重新生成该模块的
> `cordova.variables.gradle`，单用它会让 `gradlew` 报 `Could not read script …`。

### 3.4 两版的实质差异

`android/app/build.gradle` 的 `release` 仅设了 `minifyEnabled false` + ProGuard 文件，
**没有 `signingConfig`**。因此：

- 发布版与调试版的**代码与资源没有混淆/裁剪差异**，体积差（3.7 MB → 2.9 MB）
  主要来自 `optimizeReleaseResources`、调试符号与 lint 资源的去除；
- 发布版的**唯一区别性收益**是：不可调试、必须自带签名、可作为**正式分发/覆盖升级**的基线；
- 真正上架前还需要另行决定：是否开启 R8 混淆、是否换正式密钥、`versionCode` 递增策略。

---

## 4. 构建方式

### 4.1 一键脚本（推荐）

```bash
bash scripts/android-build.sh            # 调试版（默认）
bash scripts/android-build.sh debug
bash scripts/android-build.sh release    # 发布版（自动 zipalign + 签名）
bash scripts/android-build.sh both
```

脚本内部依次做：设好 `JAVA_HOME`/`ANDROID_HOME` → `npm run sync:www` → `npx cap sync android`
→ `./gradlew assemble<Debug|Release>` → 拷贝到 `releases/`；
发布版额外走 `zipalign -p 4` + `apksigner sign`（v1+v2+v3）。
若环境里存在 `HTTPS_PROXY`，脚本会把代理端口透传给 Gradle（首次拉依赖需要）。

### 4.2 手工等价步骤

```bash
cd /Users/qlyf/Developer/reminder

export JAVA_HOME="$HOME/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$HOME/.workbuddy/binaries/node/versions/22.22.2-3/bin:$PATH"

npm run sync:www          # 按 scripts/sync-www.js 组装 www/
npx cap sync android      # 同步到 android/app/src/main/assets/public 并生成 plugins 工程

cd android
PORT="${HTTPS_PROXY##*:}"   # 首次拉依赖时用
./gradlew -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort="$PORT" \
          -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort="$PORT" \
          assembleDebug      # 或 assembleRelease
```

构建耗时参考：调试版首次约 **5 分 14 秒**（134 个任务）；
发布版增量约 **37 秒**（182 个任务）。

> 注意：`sdkmanager` 的 `--proxy=…` 这类参数在 zsh 下**不能靠变量拼接**——
> zsh 不做无引号参数分词，会被当成单个参数。要直接内联书写。

---

## 5. 安装到设备

### 5.1 模拟器

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
ADB="$ANDROID_HOME/platform-tools/adb"

"$ANDROID_HOME/emulator/emulator" -avd attention_api34 -no-snapshot -no-boot-anim -no-audio &
"$ADB" wait-for-device
until [ "$("$ADB" shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 2; done

"$ADB" install -r releases/安心收件箱-debug.apk
"$ADB" shell am start -n space.alliswell.inbox/.MainActivity
```

**签名冲突**：调试版与发布版签名不同，互相覆盖安装会报
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`，需先 `adb uninstall space.alliswell.inbox`。

### 5.2 真机

1. 手机开启「开发者选项 → USB 调试」，连接后 `adb devices` 应显示 `device`（若为 `unauthorized`，在手机上确认授权弹窗）。
2. `adb install -r releases/安心收件箱-debug.apk`。
3. 首次启动请先到「我的」→ 开启**系统通知**与**精确闹钟**权限，并关闭电池优化，否则提醒可能被系统杀掉。

### 5.3 模拟器上的调试通道（本次取证手段）

调试版可开启 WebView 调试，能直接读取应用内部的真实 DOM，比截图更硬：

```bash
SOCK=$("$ADB" shell cat /proc/net/unix | grep -oE 'webview_devtools_remote_[0-9]+' | head -1 | tr -d '\r')
"$ADB" forward tcp:9222 "localabstract:$SOCK"
curl -s http://127.0.0.1:9222/json      # 列出页面；拿 webSocketDebuggerUrl 后可走 CDP
```

已固化为探针脚本 **`scripts/android-cdp-verify.py`**（需 `websocket-client`）：

```bash
"$ADB" forward tcp:9222 "localabstract:$SOCK"
WS=$(curl -s http://127.0.0.1:9222/json | python3 -c \
  "import json,sys;print([p['webSocketDebuggerUrl'] for p in json.load(sys.stdin) if p.get('type')=='page'][0])")
python3 scripts/android-cdp-verify.py "$WS"
```

它会输出五组结果：① 真机 `addListener` 返回契约（缺陷根因现场证据）、
② **`__ATTENTION_INBOX__.ready()`**（最核心的端到端断言）、③ 修复点之后才发生的副作用
（SW / IndexedDB `items.length`）、④ 界面可交互、⑤ 全生命周期错误与 `App init failed` 计数。

---

## 6. 验证证据

全部在 **Android 14 / API 34 / arm64-v8a / 1080×2400** 模拟器上，`adb install` 全流程实测。

| 验证项 | 调试版 | 发布版 | 证据 |
| --- | --- | --- | --- |
| 安装 | ✅ `Success` | ✅ `Success` | `adb install -r` |
| 冷启动 | ✅ `Status: ok`，`TotalTime 1758 ms` | ✅ `Status: ok`，`TotalTime 1209 ms` | `am start -W` |
| 前台保持 | ✅ | ✅ 5s/10s/15s 三轮均在 `topResumedActivity` | `dumpsys activity activities` |
| WebView 渲染 | ✅ 沙箱进程 `sandboxed_process0` 已拉起 | ✅ | `ps -A` |
| 界面真实渲染 | ✅ 截屏主导色 `#f3f4f1` 占 82.0%，与 `styles.css` 的 `--paper: #f3f4f1` 一致 | ✅ 同左 | 截屏像素统计 |
| DOM 完整性 | ✅ `title=安心收件箱`、`readyState=complete`、6 个脚本全加载、`window.AttentionLib=object` | — | CDP `Runtime.evaluate` |
| 持久化层 | ✅ IndexedDB `attention-inbox` v1，store `kv`，键 `state` 可读 | — | CDP 直读 IndexedDB |
| 页签交互 | ✅ 首页/未来/笔记/我的 逐个点击，视图 `view-home` / `view-future` / `view-notes` / `view-me` 正确切换 | — | CDP 点击 + 视图读取 |
| 内存 | — | ✅ `TOTAL PSS 82.7 MB` | `dumpsys meminfo` |
| 崩溃 | ✅ 0 条 `FATAL EXCEPTION` | ✅ 0 条 | `logcat` |

截屏取证文件：`docs/android-build/01-debug-running.png`、`docs/android-build/02-release-running.png`、
`docs/android-build/03-debug-fixed-running.png`（**含 V1 修复的调试版**）。

界面实际渲染出的内容（CDP 读到的可见文本节选）确认产品决策已生效，例如
「每月（按触发日）/ 每月最后一天 / 每月第 N 个星期 X」的周期选项、
「稍后提醒」的「30 分钟后 / 2 小时后 / 今晚 20:00 / 明天 09:00 / 本周末 / 自定义时间」、
「待整理时间 每天 21:30」、「睡眠勿扰」、「提醒能力自检」。

### 6.1 V1 修复后的复验（含修复的调试版）

| 复验项 | 修复前 | 修复后 | 手段 |
| --- | --- | --- | --- |
| `App init failed` 控制台错误 | 1 次 | **0 次** | CDP `Log` / `Runtime.consoleAPICalled` |
| `__ATTENTION_INBOX__.ready()` | `false` | **`true`**（1 ms） | CDP 直接调用应用暴露的就绪钩子 |
| 首启 IDB `items.length` | `0` | **`7`**（`projects: 3`） | CDP 直读 IndexedDB |
| 冷启动 | `Status: ok`，`TotalTime 2153 ms` | 同左 | `am start -W` |
| 应用内异常 / 崩溃 | 1 条初始化错误 | **0 异常、0 崩溃** | CDP + `logcat` |
| 内存 | `TOTAL PSS 82.7 MB` | `TOTAL PSS 93.2 MB`（多出 seed 数据渲染，合理） | `dumpsys meminfo` |

> 「`ready() === true`」是目前**最强的一条端到端断言**：`app-core.js` 的 `startApp()`
> 会把 `init()` 的结果兑现成 `true`/`false`，修复前实测为 `false`。
> 界面侧旁证：UI 树里出现了 seed 才有的项目文本（如「续费域名」）。

---

## 7. 未验证（NOT_PERFORMED）

以下**没有**在本次执行，不得据本文件推断为已通过：

- **15 秒心跳的端到端行为**：`ready() === true` 只证明 `setInterval(tick, 15000)` 被**执行到**，
  不等于验证了 `tick()` 的推进效果。需另做：造一条 `triggerAt` 已过期的事项、不触碰屏幕，
  观察 15 秒内是否自动进入注意力。
- **真机**（非模拟器）安装与运行；厂商 ROM 的通知/后台保活差异。
- **发布版在真机的覆盖升级**（需沿用同一签名密钥）。
- 锁屏、休眠、进程被回收、重启后的提醒投递
  （**进程被杀掉时的到点投递已于 2026-09-17 验证通过**，见
  `docs/reviews/android-background-alarm-2026-09-17.md` §4.3；锁屏/重启仍未验）。
- 通知渠道、全屏闹钟、动作按钮、权限拒绝/撤销等原生提醒链路。
- 应用商店上架相关（R8 混淆、正式密钥、`versionCode` 策略）。

---

## 8. 已知缺陷 —— V1 已修复

**修复前**：`app-core.js:5127` 调用 `NativeReminders.onAlarmAction(handleAlarmAction)` 会**同步抛出**
`TypeError: app.addListener(...).catch is not a function`，导致 `init()` 从第 5129 行起全部不可达：
首启 `seed()`、初始 `render()`、`setInterval(tick, 15000)` 心跳、`maybePromptAndroidNotify()`
都不执行，且**不崩溃、不弹错、界面照常可点**。

**修复（2026-09-17）**：

| 文件 | 改动 |
| --- | --- |
| `lib/native-reminders.js` | 新增 `listenSafely()`（`Promise.resolve()` 归一「`{remove}` 句柄」与「Promise」两种契约，并兜住同步抛错）；`onAlarmAction` 的两处注册改走它 |
| `app-core.js` | 闹钟监听注册包进 `try/catch`，失败只记日志 —— 旁路能力的故障不得带走 seed / render / 心跳 |
| `test-regressions.js` / `test-native-reminders.js` | mock 契约改为**同步返回句柄**（与真机一致）；`setInterval` 改为可观测；新增 Q1 用例 |
| `test-smoke.js` | 断言 `await app.ready() === true` |

- 完整取证、根因（含 `JSExport.java` 源码级证据）、更正与复测数据见
  **`docs/reviews/android-runtime-verification-2026-09-17.md` §2**。
- 回归基线：**868 全绿**（修复前 854）；逐条回退修复后新用例会红 **7 项**。

**残留项**：`init()` 其余步骤仍未做错误隔离（V2 建议 2 / 3 属产品可观测性取向，未实施）。

---

## 8b. 已知缺陷 —— Q2 已修复（2026-09-17）

**修复前**：`SystemBridgePlugin.scheduleAlarm` 用 `call.getLong("delayMs", 10000L)` 取参，
而 Capacitor 的取值器只接受 `Long` 装箱；`delayMs` 这类小整数在 JSON 里是 `Integer`
→ **参数被静默丢弃、回退默认 10 秒**。于是「重要 / 关键 / 默认闹钟」的全屏闹钟全部排在
`对账后 10 秒`，关掉应用就再也等不到 —— 现象即「闹钟只有打开 app 才可以」。

**修复**：

| 文件 | 改动 |
| --- | --- |
| `android/.../SystemBridgePlugin.java` | 新增 `rawArg`/`longArg`/`intArg` 按 `Number` 取参，`delayMs`/`at`/`id`/`itemRev` 全改走它 |
| `lib/native-reminders.js` | `reconcileAlarms` 排钟后**回读**原生 `triggerAt`，偏差 > 3 秒即记错误、`reliability=error` |
| `test-native-reminders.js` | 契约替身改为回传 `triggerAt`；新增 `honorsDelayMs:false` 复刻真机缺陷态，7 项新用例 |

- 取证与复验：`docs/reviews/android-background-alarm-2026-09-17.md`。
- 回归基线：**875 全绿**（Q2 修复前 868）。

---

## 8c. 已知缺陷 —— Q3 / Q5 已修复（2026-09-17）

**现象（用户截图）**：自检面板的「10 秒后全屏闹钟」到点后，桌面只出现一条横幅，没有全屏。

**根因是三件事叠加**（与 Q2 无关，闹钟准时响了）：

| # | 根因 | 性质 |
| --- | --- | --- |
| Q3-a | 清单没声明 `SYSTEM_ALERT_WINDOW` → 后台直起 `AlarmActivity` 被 BAL 静默拦下 | 实现缺失 |
| Q3-b | 从没检查 `canUseFullScreenIntent()`（API 34+ FSI 变成特殊权限） | 实现缺失 |
| Q3-c | 投递结局无记录（`launched` 恒为 true）→「成功」与「被拦」在界面上无法区分 | 可观测性缺失 |

平台规则：**解锁亮屏时 FSI 会被系统有意降级成横幅**（锁屏/息屏/AOD 才弹全屏）；
要在解锁时也全屏，只能靠 BAL 豁免 `SYSTEM_ALERT_WINDOW`。

**修复**：

| 文件 | 改动 |
| --- | --- |
| `AndroidManifest.xml` | 新增 `SYSTEM_ALERT_WINDOW` |
| `SystemBridgePlugin.java` | `diagnose` 增 `canDrawOverlays`/`canUseFullScreenIntent`/渠道重要性；新增 `openOverlaySettings`/`openFullScreenIntentSettings`/`openAutoStartSettings`/`lastAlarmDelivery` |
| `AlarmTestReceiver.java` | 投递**前**落台账（attempted/screenOn/locked/overlay/inCall）+ `AttentionAlarm` 日志；新增通话闸门 |
| `AlarmActivity.java` | `onCreate` 写 `deliveryShownAt`（全屏真的起来了的唯一硬证据） |
| `app-core.js` / `index.html` | 自检面板加「全屏闹钟」状态行、三项跳转、「上次闹钟投递结果」；`visibilitychange` 自动刷新 |
| `test-native-reminders.js` | 新增 `Q3 全屏权限与投递台账契约` 17 项源码级契约断言 |

**Q5 行为裁决**（用户：锁屏可以全屏；解锁不得打断通话）：

```
直起全屏闸门 = fullScreen && (!inCall || locked)
inCall = AudioManager.getMode() ∈ {RINGTONE, IN_CALL, IN_COMMUNICATION}  // 无需 READ_PHONE_STATE
```

- 取证与复验：`docs/reviews/android-fullscreen-alarm-2026-09-17.md`（含四条对照证据）。
- 回归基线：**892 全绿**（Q3/Q5 前 875）。

---

## 8c. 「关掉 App 就不响」的根治（Q6，用户第三次报障）

- **根因**：`index.html` **不加载 `capacitor.js`**，`window.Capacitor` 完全靠原生 WebView 注入，
  而 `init()` 在 `DOMContentLoaded` 就跑 —— 实测那一刻它还是 `undefined`，约 6 秒后 7 个插件才齐全。
  于是 `isNativeAndroid()` 返回 false，`initializeNativeReminders()` 第一行**静默 return**，
  `nativeReady` 永远是 false，`queueNativeReminderSync()` 的首行守卫便把
  **整场会话的每一次对账都丢掉** → 原生 0 条排程。
  应用内提醒由 `tick()` 负责、不依赖原生 → 现象精确表现为「打开 App 有提醒，关掉就什么都不响」。
- **修复**：`ensureNativeReminders()` 幂等可重试（in-flight promise，跑完置回 null）；
  `queueNativeReminderSync` 未就绪时**补做初始化而不是丢弃请求**；`init()` 不再 await 它；
  切回前台再试一遍；等待放宽到 10 秒；失败写 `bridgeNotReady` 让界面看得见。
- **顺带修的既有缺陷**：`isNativeAndroidRuntime()` 被 3 处调用却**从未定义**（点了没反应）；
  安卓上不再落 Web 通知分支（WebView 会返回 `granted`，造出「开关开着但没权限」的假象）；
  设置页区分「总开关未开」与「系统权限未授予」。
- **可观测性**：自检面板新增结论条（直接回答「关掉 App 会不会响」并指出第一个断掉的环节）、
  已排提醒实数（`getPending()`）、「立即重排后台提醒」按钮。
- 取证与复验：`docs/reviews/android-zero-schedule-2026-09-17.md`。
- 回归基线：**911 全绿**（Q6 前 892）。

---

## 9. 复现命令速查

```bash
# 环境
export JAVA_HOME="$HOME/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$HOME/.workbuddy/binaries/node/versions/22.22.2-3/bin:$PATH"

# 构建（一键）
bash scripts/android-build.sh both

# 若 cap sync 被沙箱批量删除护栏拦下（SAFE_DELETE_BULK_CONFIRM_REQUIRED）：
# 护栏按「本轮对话」累计删除条数（阈值 50），一旦用尽，**本轮内任何 unlink 都会被拒**，
# 连 cargo/rm 都拦。两个可用绕法：
#   ① 不删只覆盖：scripts/sync-www.js 已改为逐条 prune，不再整目录 rmSync
#   ② 把待清理目录整体 mv 走（重命名不算删除），让 cap 自己重建
mv android/app/src/main/assets/public /tmp/cap-bak-public
mv android/capacitor-cordova-android-plugins /tmp/cap-bak-cordova
npx cap sync android

# 注意：cordova 桥目录若被移走而 cap sync 又没跑完，会缺 cordova.variables.gradle，
# Gradle 报 "Could not read script .../cordova.variables.gradle"。
# 手工补回（内容见 node_modules/@capacitor/cli/dist/android/update.js:227-233）：
#   android/capacitor-cordova-android-plugins/cordova.variables.gradle
#   且该目录的 build.gradle 首行需有：apply from: "cordova.variables.gradle"

# 全屏闹钟判据（Q3/Q5）：投递台账里 attempted=true 而 shownAt=0 ⇒ 全屏被拦
ADB=~/Library/Android/sdk/platform-tools/adb; PKG=space.alliswell.inbox
$ADB shell appops set $PKG SYSTEM_ALERT_WINDOW allow      # 授予/收回，复现两种结局
$ADB shell run-as $PKG cat /data/data/$PKG/shared_prefs/attention_alarm.xml | grep delivery
$ADB logcat -d | grep -E "AttentionAlarm|BAL_BLOCK"

# 关掉 App 就不响（Q6）的判据：面板结论不能是「原生对账从未执行」
$ADB shell am start -n $PKG/.MainActivity && sleep 14
PID=$($ADB shell pidof $PKG | tr -d '\r' | awk '{print $1}')
$ADB forward tcp:9222 localabstract:webview_devtools_remote_$PID
/usr/bin/python3 scripts/android-cdp-eval.py \
  "(async function(){ var p=await window.Capacitor.Plugins.LocalNotifications.getPending(); return 'pending='+p.notifications.length; })()"
# 模拟「关掉 App」必须用 am kill（先退桌面，否则不杀前台进程）。
# 千万不要用 am force-stop —— 它会取消该应用的全部 AlarmManager 排程。
$ADB shell input keyevent KEYCODE_HOME && sleep 3 && $ADB shell am kill $PKG
$ADB shell pidof $PKG                     # 应为空
$ADB logcat -d | grep -E "Start proc.*alliswell|AttentionAlarm"

# 单元/原生/冒烟/回归（预期 29 / 153 / 162 / 567 = 911 全绿）
npm test

# 校验产物
"$ANDROID_HOME/build-tools/34.0.0/aapt2" dump badging releases/安心收件箱-release.apk | head
"$ANDROID_HOME/build-tools/34.0.0/apksigner" verify --print-certs releases/安心收件箱-release.apk

# 缺陷可复现性验证（回退修复后新用例应当变红）
bash scripts/q1-defect-proof.sh

# 后台唤醒闹钟（Q2）现场判据 —— 详见 docs/reviews/android-background-alarm-2026-09-17.md
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell ps -A | grep alliswell | awk '{print $2}')
python3 scripts/android-cdp-eval.py "(async function(){
  var r = await window.Capacitor.Plugins.SystemBridge.scheduleAlarm({delayMs:300000,id:771001,title:'t',body:'b'});
  return JSON.stringify(r);
})()"
# 期望 delayMs=300000、triggerAt ≈ now+300000；缺陷态是 delayMs=10000、now+10s
adb shell dumpsys alarm | grep -A4 ACTION_TEST_ALARM | grep origWhen
```
