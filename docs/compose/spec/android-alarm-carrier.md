---
feature: android-alarm-carrier
status: delivered
updated: 2026-09-19
branch: main
relates: android-fullscreen-alarm.md
decisions: D58 D59 D60 D61 D64 D65 D66 D67
---

# 闹钟档交付载体

## Report

**交付状态** — **已交付并真机验证（2026-09-19）。** 本规格只回答一个问题：
**闹钟档靠什么把用户叫醒**。它不改变档位路由、不改变动作集 —— 那些仍归
[`android-fullscreen-alarm.md`](./android-fullscreen-alarm.md) 管。

真机结论：无通知权限 + 息屏下**铃声与振动照常**（旧实现同场景 0/4）；
**界面仍不可达**（卡在 BAL，与 D59 无关，见「已知缺口 2」）。
证据：[`docs/reviews/d59-alarm-carrier-device-verification-2026-09-19.md`](../../reviews/d59-alarm-carrier-device-verification-2026-09-19.md)

**现状（勘明，附行号）**

| 环节 | 现状实现 |
|---|---|
| 排程 | `SystemBridgePlugin.java:614` `am.setAlarmClock(clockInfo, pi)`；逐级降级 `setExactAndAllowWhileIdle`(626) → `setAndAllowWhileIdle`(629) → `setExact`(633) → `set`(636/640) |
| 到点 | `AlarmTestReceiver.onReceive`：① `context.startActivity(AlarmActivity)`(169) ② 建通知(183–233) ③ **声音交给通知** `notification.flags \|= FLAG_INSISTENT`(244) + `ActiveAlarmStore.postIfActive`(245) |
| 声 / 振 / 屏 的载体 | **全部是那一条通知**：声音(244) · 振动(`setDefaults(DEFAULT_ALL)`(193) + channel) · 屏幕(`setFullScreenIntent`(230)) |

**缺陷** — 通知是三合一单点。通知权限被拒时 `notify()` 静默空操作，**声音、振动、屏幕同时归零**（真机实测：无权限息屏 **0/4**）。

## [S1] Problem

1. **三合一单点**（H-08）：声振与屏幕挂在同一条通知上，一条线断，三件全没。
2. **旧归因误导**：`AlarmTestReceiver.java:142` 注释「setAlarmClock 触发时系统会临时放开 BAL」与「post 通知换来 `NOTIFICATION_SERVICE` 豁免」两条**均无文档支持**（详见 D58）。它曾把排查引向「加悬浮窗权限」这一错误方向。
3. **规格缺契约**：原 [S2.5] 写「无 `POST_NOTIFICATIONS` → 退回应用内提醒，不弹全屏」，读起来像是允许静默。**D61 明确否决这种读法。**
4. **声源归属未定义**：现状声音一度同时存在通知与 WebView 两条来源，是 V3「响铃被打断重启」的成因；D59 若不把所有权写死，缺陷会原样复现。

## [S2] Design

### [S2.1] 载体所有权 —— 本规格的核心

| 要素 | 闹钟档载体 | 依赖 `POST_NOTIFICATIONS`？ |
|---|---|---|
| 进程唤醒 / 保活 | `AlarmManager` 广播 + **前台服务** | **否** |
| **铃声** | **应用自播**（原生独占，`USAGE_ALARM` + `CONTENT_TYPE_SONIFICATION`，走 `STREAM_ALARM`） | **否** |
| **振动** | **应用自调 `Vibrator`** | **否** |
| 屏幕 / 界面 | 自己 `startActivity` + Activity 内 `setTurnScreenOn`/`setShowWhenLocked`；全屏意图退为系统级兜底 | 部分（仅兜底那一路） |
| 停止入口 | 有权限 → 通知动作；无权限 → 界面内按钮（D63） | 部分 |
| 台账 | `SharedPreferences`（`AlarmTrace`） | **否** |

> **硬约束 1**：铃声与振动**任何情况下不得**再走 `FLAG_INSISTENT`、通知 channel sound 或 channel vibration。
> **硬约束 2**：**任何降级都不得阻塞铃声与振动**（D61）。

### [S2.2] 投递链路（目标态）

```
setAlarmClock 到点
  └─ AlarmTestReceiver.onReceive
       ├─ a) 启动前台服务（mediaPlayback）── 由它持有铃声与振动
       ├─ b) startActivity(AlarmActivity)  ── 保留现有 directPath/fsiPath 判定与「同 token 幂等」
       └─ c) 建通知 ── 仅作台账 + 停止入口；有权限时挂 FSI 作系统级兜底
```

`AlarmActivity` 侧：API 27+ 用 `setShowWhenLocked(true)` + `setTurnScreenOn(true)` + `FLAG_KEEP_SCREEN_ON`；
低版本回退 `FLAG_SHOW_WHEN_LOCKED` / `FLAG_TURN_SCREEN_ON`。（与 AOSP DeskClock 同构。）

**保留不变**：两路并存与同 token 幂等（`onNewIntent` 只记 `duplicateIntent`）、`PARTIAL_WAKE_LOCK`、
`ActiveAlarmStore` 防重复投递。

### [S2.3] 权限降级矩阵（取代 `android-fullscreen-alarm.md` [S2.5]）

| 情况 | 行为 |
|---|---|
| **无 `POST_NOTIFICATIONS`** | **铃声 + 振动照常**（前台服务自播）；界面尽力而为；通知据实缺失 |
| 无精确闹钟权限 | 沿用现有逐级降级（`AlarmManager` 四档）；界面标明可能延迟 |
| 无 `SYSTEM_ALERT_WINDOW` | 不阻塞；照记 `launchLikelyBlocked` |
| FSI 被拒 / A14+ 未获授 | **不影响声振**；保留 D48 的归因分支 |
| 前台服务起不来 | 回落为 Activity 进程内自播；**账本必须记明降到了哪一级** |

### [S2.4] 与提醒档的边界 —— 禁止档内混用（D60）

| 禁止 | 原因 |
|---|---|
| 闹钟档使用通知 channel 的 sound / vibration | 那就是 H-08 本身 |
| 提醒档使用 FSI / 全屏闹钟 / 前台服务持有铃声 | 提醒档无「必须叫醒」承诺，不该占用闹钟级资源 |
| 档位判定与载体判定互相渗透 | 档位由 `shouldFirstAlarm()`（`native-reminders.js:279-283`）**唯一**决定；载体由本规格**唯一**决定 |

### [S2.5] 台账必须跟着改（否则会把「响了但没亮屏」误报成「完全静默」）

`AlarmTrace` 需新增载体归因字段：`carrierSound`（native / notification）、`carrierVibrate`、
`foregroundServiceStarted`。

**并且**：现有 `fullScreenCarrierMissing` 的文案
（`"system notifications disabled; full-screen intent has no carrier"`，`AlarmTestReceiver.java:126-129`）
在 D59 之后**只对「屏幕」成立，对声音不再成立**。必须改字段与文案，
否则诊断会反着报 —— 这是本次修复里**最容易漏、也最会骗人**的一处。

### [S2.6] 停止与对账

- **停止入口**（D63）：`AlarmStopReceiver` 保持不变（通知动作）；**新增**前台服务的停止路径与界面内按钮，
  覆盖「无通知权限」这一格；`MAX_AGE_MS` 兜底维持 6h（D45 既有裁决，不改）。
- **对账**：ACK / 完成 / 删除 / Snooze 除停声振外，**须一并停止前台服务**；
  `ActiveAlarmStore` 的投影语义不变（仍以 IndexedDB 为真源）。

### [S2.7] 响铃时限与自动静音（D68，2026-09-19）

**问题**：D59 把「响」修好之后，闹钟档的实际承诺变成「**响到用户确认为止**」，
而唯一兜底 `MAX_AGE_MS` 是 **6 小时**。在 D63 记下的那一格（无通知权限 + 息屏）里，
界面起不来、通知栏也没有、唯一停止入口是解锁打开 App —— 于是最坏形态是**响 6 小时且停不掉**。

**裁决（D68）**：给闹钟档加一条**可见的响铃时限** —— 与「到达上限后进入未确认区，
不无限追击」同一条纪律（基线 §8）。

| # | 规则 |
|---|---|
| **R1** | 前台服务持有铃声与振动时，**首次启动**即登记一条自动静音回调，时限 `AUTO_SILENCE_MS` = **5 分钟**（照搬 DeskClock / Google Clock 的 Silence-after 惯例） |
| **R2** | 到点动作顺序固定：**先落盘「本次投递已自动静音」，再 `stopSelf()`**。反了会被界面回落自播重新播起来 |
| **R3** | 自动静音**不产生 ACK**（§8.1：不得根据解锁/进入 App/通知消失推测 ACK）。投递记录**保留**，事项状态不变 —— 它是「进未确认区」，不是「已处理」 |
| **R4** | 界面回落自播（S2.3 降级矩阵最后一行）前**必须**先查本次投递是否已自动静音；已静音则不再自播 |
| **R5** | 与 `MAX_AGE_MS`(6h) **并列、互不覆盖**：前者管「响多久」（可感），后者管「记录存多久」（兜底）。两个 token 分开 |
| **R6** | 自动静音必须**可被看见**：台账记 `ringAutoSilenced`（含 `silencedAfter=<ms>` 与 `no ACK`），`lastAlarmDelivery` 回传 `autoSilenced` / `autoSilencedAt` |

**同一次投递的重复启动**（两条同刻排程：投递 + 解冻器）刻意**不重新计时** ——
否则两条排程会把静音窗口往后推，实际响铃时长取决于排程条数而不是常量。

**测试注入口**：`AlarmRingService.EXTRA_AUTO_SILENCE_MS` 可覆盖时限，但
`AlarmTestReceiver.fillDelivery` **刻意不转发它** —— 投递链路上跑到的永远是生产值。
真机验证因此**真等 5 分钟**（见 [`docs/reviews/d68-autosilence-home-notice-2026-09-19.md`](../../reviews/d68-autosilence-home-notice-2026-09-19.md)）。

## [S3] Out of Scope

- 提醒档的任何改动（已自洽，见 D60）
- 档位路由与动作集（见 `android-fullscreen-alarm.md`）
- `USE_EXACT_ALARM` 的合规方案本身（单独裁决）
- A14+ `USE_FULL_SCREEN_INTENT` 的检测与引导（单独裁决）
- 真机验证（本机无 JDK 17 / Android SDK / 模拟器）
- iOS 工程

## Tasks

> **状态（2026-09-19）**：T1–T9 **全部落地**。真机验证见
> [`docs/reviews/d59-alarm-carrier-device-verification-2026-09-19.md`](../../reviews/d59-alarm-carrier-device-verification-2026-09-19.md)。

- [x] **T1** 前台服务改造：`AlarmRingService` 改 `foregroundServiceType="mediaPlayback"` + 加 `FOREGROUND_SERVICE_MEDIA_PLAYBACK`，由它持有铃声与振动 — acceptance: 无通知权限时服务仍启动且播音 (covers: S2.1, S2.2)
  — **真机**：`isForeground=true types=0x00000002`，无通知权限下 `ringStarted sound=true;vibrate=true`
- [x] **T2** 摘掉声音对通知的依赖：删除闹钟档的 `FLAG_INSISTENT` 与 channel sound 路径 — acceptance: 闹钟档通知不再承载声音 (covers: S2.1)
  — 渠道换 id `attention-alarm-v3`→`v4`（属性创建后不可改，**必须删旧渠道**）
- [x] **T3** 振动改为自调 `Vibrator`（波形 + `USAGE_ALARM`） — acceptance: 无通知权限时仍振动 (covers: S2.1)
  — **真机**：8 次采样 5 振 3 停，符合波形 `{0,800,400,800,600}` 的间歇
- [x] **T4** `AlarmActivity` 亮屏补齐 `setShowWhenLocked` / `setTurnScreenOn` / `FLAG_KEEP_SCREEN_ON`（含低版本回退） — acceptance: 锁屏下界面可见 (covers: S2.2)
  — ⚠️ 代码齐备（原有，本轮补断言），但**锁屏下界面仍起不来**，卡在 BAL 而非亮屏属性，见「已知缺口 2」
- [x] **T5** 台账增载体归因字段，并修正 `fullScreenCarrierMissing` 的文案与适用条件 — acceptance: 「响了但没亮屏」不再被报成「完全静默」 (covers: S2.5)
  — 字段改名 `screenCarrierMissing`；**真机**确认台账 `carrierSound=native` 且归属判定 `deliveryTrace==carrierTrace`
- [x] **T6** 停声收口：停声振须一并停前台服务；补无通知权限下的停止入口 — acceptance: 归档后无残留响铃 (covers: S2.6)
  — **真机**：真实 `AlarmStopReceiver` 路径下音频活跃播放器 1→0、服务前台 0、振动 IDLE
- [x] **T7** 单一音源收口（D62）：JS 侧不再播音频，只保留状态显示与动作提交 — acceptance: 不存在双声源 (covers: S2.1)
  — 核查结论：**JS 侧本就没有音频播放**（全仓无 `new Audio`/`AudioContext`）；实质收口在 `AlarmActivity`
  删掉 `notificationOwnsSound()`、改为 `AlarmRingService.isRinging()` 互斥；服务为主、界面仅回落
- [x] **T8** 补 `test-native-reminders.js` / `test-smoke.js` 用例 — acceptance: 档内不混用可被断言；降级矩阵各分支有区分度断言 (covers: S2.3, S2.4)
  — native 210→**234**、smoke 193→**197**；并新增 `scripts/verification/reverse-check-d59.js`（**10/10**）
- [x] **T9** 真机验证 — acceptance: **无通知权限 + 息屏**下响铃且振动 (covers: S2.3)
  — **已执行**（原计划标 `NOT_PERFORMED`，因本机已具备 JDK 17 / SDK / 真机）。
- [x] **T10** 响铃时限与自动静音（D68） — acceptance: 到点自动停声振、留记录、**不产生 ACK**，且界面不会把它重新播起来 (covers: S2.7)
  — 常量 `AUTO_SILENCE_MS`(5min) · `scheduleAutoSilence` 先落盘再 `stopSelf` · `AlarmActivity.restartAlarmEffects` 前置闸门 ·
    台账 `ringAutoSilenced` · `lastAlarmDelivery.autoSilenced`
  — 断言：native 245→**259**（`D68/A-1` 7 条）· smoke 204→**219**（`11b A-2` **15** 条，
    含 D59 文案纪律两条）· 反向验证新增 **9** 条（31/31 全红）
  — **真机**：见 [`docs/reviews/d68-autosilence-home-notice-2026-09-19.md`](../../reviews/d68-autosilence-home-notice-2026-09-19.md)
  真机为 vivo V2238A / **Android 16 (API 36)**；铃声 `state:started usage=USAGE_ALARM` 持续 3 分钟以上。
  **界面/屏幕仍不可达** —— 见「已知缺口 2」，那不在 D59 范围内。

**T2 / T3 / T7 是源码级断言可达上限**（Java 侧无法做行为级反向验证）；
JS 侧的结构性规则（S2.4 不混用）必须挂进 `__ATTENTION_INBOX__` 钩子做**行为级**断言 ——
否则断言会「回退即绿」，这在 H-08 的 D48 阶段已经踩过一次。
本轮把这条做到了可证伪：`reverse-check-d59.js` 逐条**真的回退一次**，
要求断言当场变红（10/10 通过），而不是只声明「断言存在」。

## 已知缺口

1. ~~**真机未验**~~ → **已验（2026-09-19）**。「无通知权限 + 息屏」下铃声与振动照常；
   旧实现同场景 0/4，本轮实测响铃持续 3 分钟以上。证据：
   [`docs/reviews/d59-alarm-carrier-device-verification-2026-09-19.md`](../../reviews/d59-alarm-carrier-device-verification-2026-09-19.md)。

2. **无权限时的「看得到 + 停得掉」仍然不成立（真机已确认，需裁决）**。
   原担心是「若界面在无权限下也拉不起来」—— **真机确认它确实拉不起来**：
   `dumpsys activity activities | grep AlarmActivity` = **0**，屏幕全程 `Asleep`，台账记
   `launchLikelyBlocked (no SYSTEM_ALERT_WINDOW)`。
   即 D59 把「响」修好了，但用户面对的是**只闻其声、不见其屏、通知栏也没有**（无权限），
   唯一停止入口是解锁打开 App，否则响到 `MAX_AGE_MS`（6h）。
   **这不是 D59 的回归，而是 D63 显式接受的风险被真机坐实。**
   **2026-09-19：已出独立提案** [`ui-reachability-proposal-2026-09-19.md`](../../decisions/ui-reachability-proposal-2026-09-19.md)
   —— 内含 BAL 官方例外清单逐条对照（我们实际只有 `SYSTEM_ALERT_WINDOW` 与「系统发送的 PendingIntent」两条可达）、
   四个候选的利弊、推荐组合与待答问题 Q1–Q6。
   **仍处未裁决，代码未动。** 提案对原 (b)「持续重试」的结论是：**不建议作为主方案**
   —— BAL 不是偶发失败，重试不产生新例外条件（真机实测：响铃前台服务已在运行仍 0 可见）。

3. ~~**上架资格未决**~~ → **已处理（2026-09-19，D64–D67）**。
   - `USE_EXACT_ALARM`：**已从清单移除**（不满足 Play 受限权限资格），只留 `SCHEDULE_EXACT_ALARM`，
     并补齐官方迁移四步（含新增 `ExactAlarmPermissionReceiver`）。**产物层已实测**（aapt2 读 APK 二进制清单）。
   - A14+ `USE_FULL_SCREEN_INTENT`：**原写「未处理」是错的** —— 检测 + 归因 + 引导三件
     早在 Q3-a/Q3-b 轮次就已交付（`canUseFullScreenIntent()` / `diagnose()` /
     `openFullScreenIntentSettings()` / 自检面板 / 归因渲染 / 守护断言）。
     遗留一项：官方要求的「**清楚说明需求**」文案未审。
   - 详见 [`release-gates-2026-09-19.md`](../../decisions/release-gates-2026-09-19.md) 与
     [`d64-…-device-verification-2026-09-19.md`](../../reviews/d64-release-gates-device-verification-2026-09-19.md)。
   - ⚠️ 一条与预期相反的实测：本机（vivo / Android 16）**不按 appop 判定**
     `canScheduleExactAlarms()`，故「移除 `USE_EXACT_ALARM` ⇒ 降级为非精确」**在本机没有发生**，
     D66 的降级分支**未被真正触发**，仍是推断。

4. **新登记：`AudioHardening` 告警（Android 15+）**。真机 log 出现
   `AudioHardening background playback would be muted for space.alliswell.inbox, level: full`；
   实测**未真的被静音**（`state:started`、`mutedState:streamVolume`、`STREAM_ALARM Muted: false`），
   推测由 `mediaPlayback` 前台服务豁免（**推断，未证**）。
   风险在于：若某版 ROM 把 `would be muted` 变成真静音，D59 会以**同样安静**的方式失效 ——
   与 H-08 一模一样的失效形态。需要一条能在真机上读到它的检查。
