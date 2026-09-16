---
feature: android-native-reminders
status: delivered
updated: 2026-09-16
branch: android-capacitor
---

# Android 原生可靠提醒

## 结论

本特性把 Android 提醒从 Web Notification 切换为 Capacitor 6 官方 Local Notifications 投影。产品事项仍以 IndexedDB 为真源；原生 pending 通知按事项状态全量对账，可被取消并重建，不构成第二套任务数据库。

当前证据证明源码逻辑、Node mock、Web 回归、Capacitor 同步和 Android 配置静态检查通过。由于本轮按约定不安装 JDK 17、Android SDK 或模拟器，Gradle、APK、安装、Doze、重启、系统杀进程和真机通知动作均为 `NOT_PERFORMED`，不得标记 Android 真机 PASS。

## 能力契约

| ID | 需求 | 实现 |
|---|---|---|
| ANR-01 | 进程外原生提醒 | `@capacitor/local-notifications@6.1.3` 以 Android `AlarmManager` 排程；不增加常驻前台服务 |
| ANR-02 | 三档策略 | 普通 1 次；重要首次加 30 分钟间隔补充，共 4 次；关键首次加 15 分钟间隔补充，共 8 次 |
| ANR-03 | 权限降级 | Android 13+ 通知权限由用户主动申请；Android 12+ 精确闹钟未授权时继续非精确原生排程并显示降级状态 |
| ANR-04 | 恢复与对账 | 插件接收开机广播；更新后恢复；应用启动、恢复前台和从精确闹钟设置返回后重新对账 |
| ANR-05 | 生命周期动作 | ACK 停止常规补充提醒；完成和删除取消全部投影；Snooze 固定通知动作 2 小时；普通点击只打开详情；Deadline 独立排程并在完成后取消 |
| ANR-06 | 时间语义 | 用户选择时间保存本地墙钟；30 分钟/2 小时 Snooze 保存相对时长；旧数据原位迁移且不删除事项 |
| ANR-07 | 隐私与打扰边界 | 关闭弹条持久化 `dismissedUntil` 并抑制 30 分钟内补充提醒；隐私模式隐藏正文；不绕过系统勿扰、不使用全屏通知 |

## 数据与投影

兼容字段为 `scheduleBasis`、`localTrigger`、`snoozedAt`、`snoozeDelayMs` 和 `dismissedUntil`。旧事项第一次加载时以原 `triggerAt` 生成本地墙钟值并保存，原事项 ID、内容和生命周期不变。

每条原生通知使用稳定的 Android 32 位正整数 ID，`extra` 包含 `managedKind`、`scheduleVersion`、`itemId`、`event`、`attempt` 和 `scheduleKey`。对账只识别 `managedKind=attention-reminder` 的 pending 通知，不取消其他通知。

三个通知渠道均启用提示音和震动：

- `attention-normal`：importance 3。
- `attention-important`：importance 4。
- `attention-critical`：importance 5。

这些渠道不申请 Notification Policy Access，也不设置全屏 Intent，因此仍服从系统勿扰和用户对渠道的设置。

## Android 配置

- 应用 Manifest 显式声明 `android.permission.SCHEDULE_EXACT_ALARM`。
- Local Notifications 插件 Manifest 提供 `POST_NOTIFICATIONS`、`RECEIVE_BOOT_COMPLETED`、`WAKE_LOCK` 及恢复接收器，待 Android 构建时合并。
- 应用 Manifest 为同一恢复接收器补充 `MY_PACKAGE_REPLACED`，用于应用更新后恢复持久化排程。
- `@capacitor/app@6.0.3` 监听前后台切换，恢复前台时检查权限、重算墙钟并对账。

## 验证记录

| 检查 | 结果 | 证据等级 |
|---|---|---|
| `npm ci` | PASS | 依赖安装 |
| `npm test` | PASS：unit 29/29，native mock 42/42，smoke 55/55 | 源码 / mock |
| `npm run cap:sync` | PASS | Web 资源与 Capacitor 配置同步 |
| 插件注册、Manifest 合并输入、boot/update receiver 静态核对 | PASS | 生成配置静态检查 |
| Gradle 编译、APK/AAB 生成 | `NOT_PERFORMED` | 缺 JDK 17 / Android SDK |
| APK 安装、通知权限交互、通知栏动作 | `NOT_PERFORMED` | 无模拟器 / 真机 |
| 普通杀进程、Doze、设备重启、时区变化 | `NOT_PERFORMED` | 无 Android 运行环境 |

## 平台边界

Android 的普通进程回收、设备休眠和重启是设计支持场景，但只有真机验证后才能判定通过。用户主动在系统设置中“强制停止”应用会冻结闹钟和广播，直到再次手动打开应用；应用不能绕过这一系统限制。
