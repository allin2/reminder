# P3-E-R 交付收口独立复验

结论：**PASS（仅 P3-E-R 交付收口）**。本轮独立核对 v30 缓存、全新候选身份、五层资源和历史纠错；源码两项行为沿用 `20260923T1104-p3er-independent-recheck` 的独立 PASS，因本轮源码哈希未变。真机物理行为及旧缓存到 v30 的真实离线升级仍为 **NOT_PERFORMED**，本结论不覆盖它们。

## 身份与范围

- 仓库 `/Users/qlyf/Developer/reminder`；`main`、HEAD 与 `origin/main` 均为 `3574824357dc7beb04cbd3e32aa413cd508e8484`；工作区原有脏文件保留。
- `app-core.js` SHA-256 `664cc69fb5e5cd246e680e1f7548ad572c7717c1019c009bc11049cb0bb15989`，`lib/app-native-coordinator.js` SHA-256 `6d91d0047ef321651689dad7a5c3c98e660d48b1dc64c8f64bbf69963585f361`，与 1104 独立复验归档逐字一致。
- `sw.js` SHA-256 `e9631d76ae46713d4a8f03827422616930fec5ec822471884e82467217140870`，缓存名为 `attention-inbox-v30`。从 1000 候选 APK 提取 v29 SW 与新候选对比，仅新增 v30 注释并把缓存名 v29 改为 v30；23 个 `index.html` 脚本均在 SW 资源清单中。

## 独立实测

- `node --check sw.js` 与 `git diff --check` 均退出 0。
- 本轮直接运行 `npm test` 退出 0。日志显示 unit 642、native 324、boot 782、smoke 266、regressions 730、parse 160，合计 **2904 项，0 失败**；中间的 P3 模块专项脚本也均成功执行。实施报告所写“`npm test` 160 项”是最后一个子套件的计数，不是全套计数，不影响测试结果。
- 以 Python 标准库重新读取当前源码、`www`、`android/app/src/main/assets/public`、`android/app/build/intermediates/assets/debug/public` 和**新候选 APK**的 `assets/public`，逐条重算实施方 32 行 TSV：32/32 五层哈希一致、与 TSV 一致；APK 资源清单无遗漏、无额外条目（排除 Capacitor 生成的 Cordova 文件及插件目录）。
- 对比 1000 路径当前修复包与新候选的全部 `assets/public` 文件，只有 `assets/public/sw.js` 的字节发生变化。
- 新候选 `releases/candidates/20260923T1115-p3er-candidate/app-debug.apk` 与当前 Gradle Debug 输出的 SHA-256 均为 `5624f9a851b0364a1ccb2512a90e4cfdaaa90077fc18212fbddbf854e258a267`；包内有 `app-core.js`、`lib/app-native-coordinator.js` 和 v30 `sw.js`。本轮未重新构建 APK，验的是交付候选现有字节及来源闭合。
- 独立重算历史路径：0958 原始包为 `ebc57bb6c8423334cd9f8b717130433ee6edcc8d0ac2ab80aa766a5e7c53754f`；1000 路径现为 `96a2a0a41e8ba55652297fd94d6f9b2560e8801e1ff4d4b38b6979b6698d8300`。1014 原始归档的修复前源码哈希与 1115 追加纠错相符。旧报告及旧候选保持原样，没有回拷或覆盖。

## 证据边界

- 1115 实施方的 Chrome 恢复与导入结果、构建日志及 Gradle 成功记录属于**实施方证据**；本轮独立复算候选与资源身份并重跑 `npm test`，未重新运行 Chrome 或 Gradle。
- 未在 Android 真机执行原生闹钟的响铃、展示或动作链；未运行真实浏览器 v28/v29→v30 的断网、重连、激活和升级。两项均为 **NOT_PERFORMED**，需在对应真机矩阵和 P4 离线升级专项另行验收。
- `sw.js` 安装路径仍会吞掉 `cache.addAll` 失败后继续激活；本轮只验证版本推进与产物字节，不能据此声称离线升级完整通过。
