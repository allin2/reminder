---
feature: android-capacitor
status: delivered
updated: 2026-09-15
branch: android-capacitor
commits: c6921ed..e3b48ba
superseded_by: android-native-reminders.md
---

# Android Capacitor 脚手架

> 本文件记录 2026-09-15 的脚手架阶段；下方“不实现原生闹钟”是当时范围，不代表当前能力。现状见 [Android 原生可靠提醒](./android-native-reminders.md)。

## Report

**What was built** — 为安心收件箱增加 Capacitor Android 工程脚手架：根目录 `package.json` / `capacitor.config.json`（appId `space.alliswell.inbox`，应用名「安心收件箱」，`webDir=www`），`scripts/sync-www.js` 将 Web 运行资源同步到 `www/`，并执行 `npx cap add android` 生成完整 Gradle 工程（`MainActivity` 包名 `space.alliswell.inbox`）。README 增加 Android 打包章节（环境、命令、限制）。本机未装 Android SDK，按约定不产出 APK。

**Verification** — `npm install` 成功（Capacitor 6.x）。`npm run sync:www` 生成 12 项资源。`npx cap add android` 成功，存在 `android/app/build.gradle` 与已拷贝的 `assets/public/index.html`。`node test-unit.js`：29 PASS。`node test-smoke.js`：55 PASS。独立审查：acceptance 全 PASS，无 critical。

**Journey log**
- 无 Android SDK 时交付「可打开的工程脚手架」即可，不必强行本机编 APK。
- Capacitor 默认会把 `www` 拷进 `android/app/src/main/assets/public`，且这些中间产物常被 android/.gitignore 排除——克隆后必须先 `npm run cap:sync` 再 `cap:open`。
- Web 源码目录保持不动，打包资源走 `www/` 副本，避免污染本地预览路径。

## [S1] Problem
安心收件箱已是加固后的静态 Web App，但无法以 Android 应用形态安装/分发。本机无 Android SDK，无法在本环境产出 APK；需要可交接的 Capacitor 工程，让开发者用 Android Studio 直接打开并打包。

## [S2] Design

### [S2.1] 目标形态
- 根目录增加 Capacitor 项目（`package.json`、`capacitor.config.json`）。
- `webDir = "www"`：打包用静态资源副本（index/app-core/lib/sw/manifest/icon）。
- `npx cap add android` 生成 `android/` 平台工程（可在 Android Studio 打开）。
- **本机不安装 Android SDK、不编译 APK**。

### [S2.2] 同步脚本
- `npm run sync:www`：把 Web 资源复制到 `www/`（排除 prd、test、docs、.git、node_modules）。
- `npm run cap:sync`：`sync:www` + `npx cap sync android`。
- 复制列表固定：`index.html`、`app-core.js`、`lib/**`、`sw.js`、`manifest.json`、`icon.svg`、`icon-192.png`、`icon-512.png`。

### [S2.3] 应用身份
- appId: `space.alliswell.inbox`
- appName: `安心收件箱`
- webDir: `www`
- `server.androidScheme`: `https`

### [S2.4] 原生能力边界（本轮明确不做）
- 不实现自定义闹钟插件 / AlarmManager 穿透静音
- 不接入系统分享面板插件的完整调试
- 不在本机产出 release 签名 APK
- Capacitor 插件若加入，仅限官方常用且纯 JS 可验证的配置层

### [S2.5] 文档
- README 增加「Android 打包」章节：环境要求、命令、打开路径 `android/`、已知限制。

### [S2.6] 验收
- `npm install` 可完成
- `npm run sync:www` 后 `www/` 含完整可运行资源
- `npx cap add android` 成功生成 `android/`
- 现有 `node test-unit.js` / `test-smoke.js` 仍通过
- README 含 Android 章节

## [S3] Out of Scope
- 本机编译 APK/AAB
- 自定义原生闹钟、通知渠道高级配置的设备实测
- iOS 工程
- 上架 Play Store

## Tasks
- [x] T1: 添加 package.json + capacitor.config + .gitignore 更新 — acceptance: 配置字段符合 S2.3 (covers: S2.1)
- [x] T2: 实现 sync:www 脚本并生成 www/ — acceptance: www 含 Web 运行所需文件 (covers: S2.2)
- [x] T3: 执行 cap add android 生成平台工程 — acceptance: android/ 目录存在且含标准 Gradle 工程 (covers: S2.1)
- [x] T4: 更新 README Android 章节 — acceptance: 含环境、命令、限制 (covers: S2.5)
- [x] T5: 复跑 test-unit + test-smoke — acceptance: 29 + 55 通过 (covers: S2.6)
