# 1.3 发布记录

## 范围与身份

- 基线：当前工作分支 `docs/setup-60s-test-verification`，起点 `e603edceda8fcae450e2e59294ff25d6fe2e9ccb`；本记录随本次修复、版本更新一起交付。
- 版本：`package.json` / lockfile 为 `1.3.0`，Android `versionName 1.3`、`versionCode 4`。
- 发布包：`releases/attention-inbox-v1.3.apk`（本机保存，Git 忽略目录；GitHub Release 附件）。
- APK SHA-256：`624451cfb940f4d873f8819d4fcc699d577b487030eea2c98117bc39e4cf0f3d`，大小 3,367,830 字节。
- 发布证书 SHA-256：`bbdaeece7fa34052a529e3fc3aaab2a4f6d688b7e60845750f10cd4e17469f0b`，与 1.2 发布证书及此前 OPPO 安装证书一致。APK v1/v2/v3 签名验证通过。

## 功能变化

- 在「我的 → 提醒设置」补充 vivo/其他 Android 厂商的锁屏显示、锁屏通知、悬浮通知手动检查说明和系统设置入口。
- 区分系统能力回读、打开设置页和用户手动确认；无法回读的厂商开关不显示为系统已验证。
- 60 秒测试按本次原生 trace、锁屏状态和窗口实际展示时间判断，避免把旧结果、仅响铃或解锁后展示算成锁屏通过。
- 增加对应单元、浏览器交互和变异验证；SW 缓存版本 v51。

## 发布前验证

| 检查 | 结果 |
| --- | --- |
| `npm test` 全链 | PASS；单元 703、回归 730，以及其余项目脚本全部退出 0 |
| 设置向导浏览器生产页交互 | PASS；360 × 800、实际 DOM、无横向溢出、手动状态和设置路由 |
| 设置向导变异检查 | PASS；5 项变异变红、原源码哈希未变 |
| `testDebugUnitTest` | PASS；Gradle 任务执行成功，测试结果复用既有输出 |
| `assembleRelease` | PASS；签名包构建成功，`lintVitalRelease` 通过 |
| APK 版本/证书/包内资源 | PASS；`aapt` 显示 1.3/4；签名一致；`index.html`、`sw.js`、`lib/app-setup.js`、`lib/feedback.js` 与源码逐字节一致 |
| OPPO 真机 | 此前同修复源码的 debug 包已验证锁屏弹出、通知列表、声振、停止和数据保留；详见 [第一阶段](oppo-lockscreen-guide-verification-2026-09-30.md)与[解锁后补验](oppo-lockscreen-guide-completion-2026-09-30.md)。正式 1.3 release 包未单独安装实测 |

## 已知边界

- 原生载体诊断字段可能显示 `none`，即使声振实际运行；此版本未修该诊断误报。
- OPPO 重启后早期快照出现两条事项提醒时间短暂变化，稳定后 18 条事项全量数据与此前一致；原因未在本次发布中解决。
- 一次 60 秒锁屏测试不代表长时间待机、冷进程、所有厂商及系统设置组合的送达可靠性；关键提醒需在目标手机上再次实测。

本地测试日志位于 `/Users/qlyf/Developer/reminder-archive/`，OPPO 原始证据位于对应 `verification-runs/` 目录；私有数据与截图未放入 Git。
