# 其他应用前台时的系统横幅收敛与真机验收

- 日期：2026-09-19
- 基线：`main` / `8d1c2617cff3aac5c4450a949c9044b79f63a673`
- 当前候选：`releases/candidates/20260919-foreground-banner/app-debug.apk`
- SHA-256：`dd58144c53753d9a229eed84c0a58616842fda21cf09a94ddf7cae1816401a1f`
- 设备：vivo V2238A / OriginOS 16 / Android 16 / `10ACBF2D3D000RS`
- Git：未提交、未推送

## 结论

按 A-03 收敛后，当前候选在「其他应用位于前台、设备解锁亮屏」场景取得 **PASS**：

- 本应用的全屏 Activity 没有显示（`visible=false`），设置页始终是前台应用；
- 原生仍提交 importance 4、category alarm、带 `fullScreenIntent` 的系统通知；
- vivo 系统实际显示顶部悬浮通知，内容为「☆ 重要事项 / 后台验收 other / 停止声振」；
- 声音、振动由 `AlarmRingService` 独立承载，不依赖横幅通知的声振属性；
- 同一候选的熄屏与冷进程回归均显示全屏闹钟，未因前台横幅修复而退化。

这项 PASS 的设备前置条件是：应用通知允许、闹钟渠道为高重要性、厂商「悬浮通知/横幅」允许。
应用只能请求系统横幅，不能越权强开厂商开关；所以代码把「通知已提交」与「全屏/横幅已对用户可见」
分开记账，避免把通知中心条目伪报成用户已经看到。

## 实现收敛

### 原生投递

`AlarmTestReceiver` 不再只在锁屏/息屏时附加 `fullScreenIntent`：凡首次闹钟的
`fullScreen=true`，均附加同 token 的 `fullScreenIntent`。

- 锁屏/息屏：系统可使用它展示全屏闹钟；
- 解锁亮屏、其他应用前台：系统把它作为 heads-up / 悬浮通知请求；
- 直起 Activity 仍并行尝试；同 token 的重复 Intent 幂等，不重启声振；
- 新增 `deliveryNotificationPosted` 台账，仅表示通知已提交，不等同于可见。

### 产品诊断与引导

- `SystemBridgePlugin.lastAlarmDelivery()` 回传 `notificationPosted`；
- 自检在「通知已提交但全屏未显示」时明确提示检查「悬浮通知/横幅」；
- 系统通知设置入口文案改为同时检查通知、悬浮通知/横幅、锁屏通知；
- 通话中不抢全屏，但仍请求系统横幅并继续声振。

### 规格与验收

- `docs/compose/spec/android-fullscreen-alarm.md` 增加 A-03 前台系统横幅兜底；
- `docs/product-logic.md` 记录双路屏幕交付与证据边界；
- `docs/acceptance-cases.md` 增加 C16。

## 自动化验证

| 层级 | 结果 |
|---|---:|
| `node test-unit.js` | 249 / 0 |
| `node test-native-reminders.js` | 298 / 0 |
| `node test-smoke.js` | 226 / 0 |
| `node test-regressions.js` | 580 / 0 |
| 总计 | 1353 / 0 |
| `ProductionJavaAlarmTest` | 8 / 0 |
| Gradle `:app:testDebugUnitTest :app:assembleDebug` | BUILD SUCCESSFUL |
| `git diff --check` | PASS |

Smoke 行为测试覆盖两条相反分支：

1. `notificationPosted=true` 但未全屏：显示「系统通知已投递」，并提示检查悬浮通知/横幅；
2. `notificationPosted=false`：不得冒充系统横幅已经投递。

## vivo 真机证据

### 安装身份

本地候选与设备 `/data/app/.../base.apk` 的 SHA-256 均为：

`dd58144c53753d9a229eed84c0a58616842fda21cf09a94ddf7cae1816401a1f`

### 厂商设置前置条件

安装后只读检查发现 vivo 的应用级状态为：

`isShowHeadsUp=false isShowKeyguard=false`

通过 vivo 正常系统设置界面勾选「悬浮通知」后为：

`isShowHeadsUp=true isShowKeyguard=false`

没有使用 `settings put`、`appops set` 或 root 命令绕过系统 UI。锁屏通知开关未修改。

### 场景 1：其他应用前台（PASS）

证据目录：`verification-runs/20260919-foreground-banner-other/`

- 安装包哈希：匹配当前候选；
- 广播收到：`received=true`，到点延迟 `245ms`；
- 环境：`screenOn=true; locked=false; path=direct+banner`；
- Activity：`visible=false`，证明不是拿全屏界面冒充系统横幅；
- 台账：`systemNotificationPosted`；
- 通知记录：`fullscreenIntent` 非空、importance 4 / HIGH、`mIsInterruptive=true`；
- 可见证据：`banner-plus3_2s.png` 顶部出现系统悬浮通知；
- 载体：`sound=true; vibrate=true; foreground=true`。

### 场景 2：熄屏锁屏（PASS）

证据目录：`verification-runs/20260919-foreground-banner-off/`

- `received=true`，到点延迟 `192ms`；
- `screenOn=false; locked=true; path=fsi+direct`；
- `windowVisible=true`；
- `due-screen.png` 显示全屏闹钟和四个出口。

### 场景 3：冷进程 + 熄屏锁屏（PASS）

证据目录：`verification-runs/20260919-foreground-banner-cold/`

- 投递前进程已被验证不存在；
- `received=true`，到点延迟 `842ms`；
- `screenOn=false; locked=true; path=fsi+direct`；
- `windowVisible=true`；
- `due-screen.png` 显示全屏闹钟。

### 清理

- 三个测试事项均已归档；
- 对应测试投递已不在原生排程与通知列表中；
- `CurrentVibration: null`；
- 未编辑原有用户事项。

## 证据边界

- **PASS**：当前哈希的 JS/Java/Gradle、前台系统横幅、熄屏全屏、冷进程全屏。
- **设备前置条件**：用户或 OEM 关闭系统通知/悬浮通知时，第三方应用无法强制展示横幅；产品已提供明确引导，不能把该状态写成 PASS。
- **NOT_PERFORMED**：通话中实机、勿扰策略组合、物理重启后首次解锁前、主动撤销通知权限。
- 本报告不把 `NotificationManager.notify()` 返回、通知栏落账或声音发生当作横幅可见；前台 PASS 以截图和系统通知记录共同判定。
