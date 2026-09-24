# 代码优化修复实机验收

- run-id：`20260920T183614-code-optimization-repair-device-debug`
- 日期：2026-09-20
- 仓库：`/Users/qlyf/Developer/reminder`
- 分支 / HEAD：`main` / `4de5f597573bc2c45b51ba8ab18a279d054339a0`
- 设备：OPPO Find X8 Pro（PKC130），Android 16 / API 36，ColorOS `PKC130_16.0.10.500(CN01)`
- ADB serial：`QSKFAE95CQEUJZ8L`
- 最终结论：**候选构建、同签名覆盖安装、真实启动与数据恢复 PASS；O3/O6 的合成反例仍由自动化与 Chromium 证据承担，不上调为实机业务场景 PASS。**

## 1. 为什么最初找不到设备

最初检查时，`adb devices` 为空，macOS USB 设备树也没有该手机，因此不是 ADB 筛选或序列号问题。开发者模式本身不会让设备自动出现；还需要数据线建立 USB 数据连接、开启 USB 调试并接受本机 RSA 授权。完成连接与授权后，设备以 `QSKFAE95CQEUJZ8L device` 出现，后续构建、安装、启动和取证均在该 serial 上执行。

## 2. 最终安装身份

| 项 | 结果 |
|---|---|
| 正式候选 | `releases/candidates/20260920T183614-code-optimization-repair-device-debug/attention-inbox-release-code-optimization-repair.apk` |
| APK SHA-256 | `881ffabd3ad99cc2b38b7e64acb77fff1e5685ddae800c97234b2e558109b29e` |
| 设备最终 `base.apk` SHA-256 | 与候选逐字一致：`881ffabd3ad99cc2b38b7e64acb77fff1e5685ddae800c97234b2e558109b29e` |
| 签名证书 SHA-256 | `bbdaeece7fa34052a529e3fc3aaab2a4f6d688b7e60845750f10cd4e17469f0b` |
| APK 签名方案 | v1 / v2 / v3 均验证通过 |
| 包名 / 版本 | `space.alliswell.inbox` / versionCode 2 / versionName 1.1 |
| 内嵌 `app-core.js` | `d54f4947a50ab24360bdf7d737c119682ce12511c5f295c927d056e2f545aa1d`，与工作区修复源码一致 |
| 最终生产标志 | 无 `DEBUGGABLE`；应用进程没有 WebView 调试 socket |

覆盖安装保留了首次安装时间 `2026-09-20 15:07:22`、应用 UID 10558 和数据目录 `/data/user/0/space.alliswell.inbox`。最终 `lastUpdateTime` 对应本轮覆盖安装。

## 3. 实机结果

| 检查 | 结果 | 证据等级 |
|---|---|---|
| 同签名 `adb install -r` | `Success` | 实机 PASS |
| 冷启动 | `Status: ok`，`LaunchState: COLD`，首次测得 `TotalTime: 501 ms` | 实机 PASS |
| 正式包运行 | `MainActivity` 获得焦点，进程存活 | 实机 PASS |
| 崩溃 / ANR | 本轮筛选日志中无 `FATAL EXCEPTION`、无该包 ANR | 实机 PASS（本轮观察窗） |
| 用户数据 | 正式包最终首页显示 2 件需要注意；“买饭。”恢复为今天 16:53 的逾期事项；“待整理 · 1”恢复 | 实机 PASS |
| 权限 | `POST_NOTIFICATIONS` granted；`SCHEDULE_EXACT_ALARM: allow`；`SYSTEM_ALERT_WINDOW: allow` | 实机 PASS |
| 正式包身份 | 设备拉回 APK 与候选 SHA-256 完全一致 | 实机 PASS |
| 生产调试面 | 正式包无 `DEBUGGABLE`，只看到其它应用的 WebView socket | 实机 PASS |

安装前后保留了原有 21:00 精确闹钟记录。21:30 / 22:30 的两条旧 LocalNotifications 在待整理事项被处理时由应用撤销；该事项现已恢复为待整理，正式 UI 显示队列数量 1。这里不把 AlarmManager 记录等同于用户可见送达。

## 4. 误触与恢复记录

UIAutomator 返回的 WebView 坐标在底部弹层动画期间发生偏移，黑盒点击误触了两项真实数据：

1. “买饭。”被点成完成；
2. “<personal-item-title-1>”被从 `NEEDS_REVIEW` 确认为 `REVIEWED`。

两项均已恢复并留存证据：

- “买饭。”先从归档详情读取原提醒时间（今天 16:53），再通过正式“恢复到待办 → 修改时间”流程恢复。最终首页重新显示 2 件需要注意和“买饭。”；
- 待整理记录没有反向 UI。为避免猜测字段，先构建同签名临时诊断包、用 `run-as` 备份完整应用数据，再经 CDP 读取目标记录。前置条件确认它仍是 `waiting`、21:30 兜底时间、`isFallbackTrigger=true`，只有 `review_status/reviewed_at` 发生变化；随后将其恢复为 `NEEDS_REVIEW` / `null`，版本从 2 单调推进为 3，并通过项目现有 pending-replay 机制写回 IndexedDB；
- 冷启动后读取到 `NEEDS_REVIEW`、队列数 1、pending-replay 键已清除，证明权威写回成功；
- 最后重新安装正式候选。最终截图显示“待整理 · 1”、2 件需要注意及“买饭。”，正式 APK 哈希重新核验一致。

数据备份：`app-data-before-review-recovery.tar`，SHA-256 记录在同目录。临时诊断 APK 已退出设备，保留在证据目录供审计；设备最终运行正式候选。

## 5. 性能观察

这部分是单次实机观察，不是优化前后基准：

- `dumpsys meminfo`：TOTAL PSS 185,643 KB，TOTAL RSS 296,672 KB；其中 Graphics 45,160 KB。采样时 WebView 已经历多轮页面、弹层和调试交互，不能拿来代表干净冷启动常驻值；
- `dumpsys gfxinfo`：1229 帧，现代 jank 68 帧（5.53%），50/90/95/99 分位为 6/15/25/61 ms。该统计混入日期选择器、锁屏/唤醒和多次页面切换，仅作现场水位；
- O4/O5/O6/O7 的前后计数仍以 `20260920T1706-code-optimization` 的同 harness 对照为正式性能证据。

## 6. 自动化复验

最终重新执行 `npm test`：

- unit 330
- native 321
- boot-combination 170
- smoke 255
- regressions 730
- 合计 **1806 通过 / 0 失败**

`git diff --check` 通过。

采集命令在 `npm test` 已完整结束后，因 zsh 将 `status` 视为只读变量而在包装层返回非零；这不是测试用例失败。上述五套结果均已写入 `final-npm-test.log`，随后另行执行的 `git diff --check` 返回成功。

## 7. 证据边界

- O3 畸形 URL 与 O6 签名碰撞/折叠大列表没有再次向真实用户数据注入测试记录，因此这两项的行为结论来自修复轮的 Chromium 153 与隔离 harness；实机证明的是同一修复源码确实进入最终 APK并正常运行。
- 本轮没有执行新的 60 秒锁屏响铃或 10/60/120 秒诊断，避免干扰现有提醒；不能把本轮写成新的锁屏可见送达 PASS。
- 内存与帧数据没有同设备优化前基线，只能报告观察值，不能宣称实机提升百分比。
- 未提交、未推送，工作区原有 dirty 状态全部保留。

证据目录：`docs/reviews/verification-runs/20260920T183614-code-optimization-repair-device-debug/`。
