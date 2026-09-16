---
feature: android-fullscreen-alarm
status: decided
updated: 2026-09-16
branch: main
relates: android-native-reminders.md
decisions: D9 D10 D11 D12
---

# 关键档全屏闹钟

## Report

**交付状态** — **规格已定，代码接线未落地。** 本规格规定全屏闹钟的适用范围与动作集；
按 [交互逻辑决策清单](../../decisions/interaction-logic-2026-09-16.md) 的 D4，代码改动单独一轮。

**现状** — 原生能力**已经存在**：`SystemBridgePlugin.scheduleAlarm/scheduleAt` 走
`AlarmManager.setAlarmClock`，`AlarmTestReceiver` 直接拉起 `AlarmActivity` 并同时投递带
`setFullScreenIntent` 的通知，`AlarmActivity` 负责亮屏、循环响铃、波形震动与时钟走秒。
但**接线是错的**：

- 它只服务「提醒能力自检」面板和「待整理」会话（`app-core.js` 的 id 91002 / 91003）；
- **关键档完全没有接它**——`critical` 只走 `attention-critical-v2`（importance 5）通知渠道。

结果就是显著性倒挂：一条随手记的模糊记录会点亮手机、全屏响铃；一条标了「🚨 关键」的事项
只收到一条通知。

## [S1] Problem

1. **显著性倒挂**：最不该被打断的（待整理）用了最强通道，最不能漏的（关键）用了普通通道。
2. **动作集不全**：全屏界面只有「关闭」和「稍后」，没有「我知道了」、没有「完成」。
3. **「稍后」写死 10 分钟**（`AlarmActivity`），与通知栏的 2 小时、表单的六个选项三方不一致。
4. **`onBackPressed()` 被刻意置空**，用户按返回键退不出去，只能二选一。
5. **权限合规未评估**：`USE_EXACT_ALARM` 与 `USE_FULL_SCREEN_INTENT` 在 Google Play 上属受限权限。

## [S2] Design

### [S2.1] 适用范围（唯一性）

全屏闹钟**仅归「关键」档所有，且仅用于首次提醒**。

| 档位 | 首次提醒 | 补充提醒 |
|---|---|---|
| 普通 | 通知（`attention-normal-v2`） | 无 |
| 重要 | 通知（`attention-important-v2`） | 通知，30 分钟 × 3 |
| **关键** | **全屏闹钟** | 通知（`attention-critical-v2`），15 分钟 × 7 |

**待整理、普通档、重要档一律不得使用全屏闹钟。** 这条是硬约束。

### [S2.2] 「显式开启」的判定

PRD §13.3 要求关键模式「必须显式开启，不作为默认录入字段」。
判定方式：录入表单的优先级默认档位是**普通**，用户选中「🚨 关键」本身就是一次主动选择。
**不额外增加全局开关**——那只是仪式感。

### [S2.3] 触发链路

关键档事项在 `promoteDue()` 中首次晋升为 `due` 时，除原有的通知排程外，额外排一次全屏闹钟：

- 时刻 = `effectiveTriggerAt(item, settings)`，与通知渠道同一时刻；
- 走 `SystemBridge.scheduleAlarm({ at, title, body, id })`；
- 闹钟 id 使用独立号段，**不得与通知 id 混用**（通知 id 由 `scheduleKey` 哈希分配）；
- 排程后必须登记到投影状态，使 ACK / 完成 / 删除能取消它。

### [S2.4] 动作集

全屏界面提供四个出口：

| 动作 | 语义 | 副作用 |
|---|---|---|
| 我知道了 | Attention Delivery 完成 | 写 ACK；停掉后续 7 次补充提醒 |
| 稍后 2 小时 | 现在不适合关注 | 按**相对时长**重排；重新计一轮预算 |
| 完成 | 事项结束 | 归档；周期事项生成下一条 |
| **关闭** | 止响，但**不表态** | **不写 ACK、不计入关闭抑制、后续补充提醒照常** |

「关闭」的存在理由：一个人被闹钟吵醒、只想让它停下来时，如果唯一出路是「我知道了」，
系统就是在**逼他谎报"我看到了"**，而 ACK 会停掉后续全部补充提醒——那等于绕过
PRD 原则四（送达 ≠ 看到）。

**`onBackPressed()` 必须恢复为「等同关闭」**，不得置空。

### [S2.5] 权限与降级

| 情况 | 行为 |
|---|---|
| 无 `POST_NOTIFICATIONS` | 退回应用内提醒，不弹全屏 |
| 无精确闹钟权限（Android 12+） | 使用非精确 `AlarmManager`，界面标明可能延迟 |
| `setAlarmClock` 抛异常 | 逐级降级：`setExactAndAllowWhileIdle` → `setAndAllowWhileIdle`（现有链路已具备） |
| 全屏 Intent 被系统拒绝 | 仍投递高优先级通知作为兜底（现有 `AlarmTestReceiver` 已同时投递通知） |

**任何降级都不得阻塞事项本身**——闹钟是增强，不是依赖。

### [S2.6] 投影与对账

全屏闹钟与通知一样，是**可删可重建的投影**，事项仍以 IndexedDB 为真源。
ACK / 完成 / 删除 / Snooze 都必须取消已排的全屏闹钟。新增 id 号段需纳入投影响应集，
否则会出现「事项已归档但闹钟还在响」。

### [S2.7] 勿扰

关键档**不受勿扰影响**（与现状一致：只有 `normal` 参与勿扰）。

## [S3] Out of Scope

- 待整理使用全屏闹钟（**明确禁止**）
- 普通档、重要档使用全屏闹钟
- iOS 工程
- Google Play 受限权限的合规方案本身（仅在 README 记录风险，不在本轮解决）
- 真机验证（本机无 JDK 17 / Android SDK / 模拟器）

## Tasks

- [ ] T1: 关键档首次提醒接入 `SystemBridge.scheduleAlarm` — acceptance: `critical` 首次走全屏，`normal`/`important` 不受影响 (covers: S2.1, S2.3)
- [ ] T2: 全屏界面补齐四动作（我知道了 / 稍后 2 小时 / 完成 / 关闭），删除 10 分钟硬编码 — acceptance: 关闭止响但不写 ACK (covers: S2.4)
- [ ] T3: 恢复 `onBackPressed()` 为等同关闭 — acceptance: 返回键可退出且不写 ACK (covers: S2.4)
- [ ] T4: 全屏闹钟纳入投影对账，ACK/完成/删除/Snooze 均取消 — acceptance: 归档后无残留响铃 (covers: S2.6)
- [ ] T5: 摘掉待整理与自检面板之外的全屏调用 — acceptance: 仅 `critical` 路径使用 `scheduleAlarm` (covers: S2.1)
- [ ] T6: 补 `test-native-reminders.js` 用例 — acceptance: 覆盖档位路由与四动作映射 (covers: S2.2, S2.4)
- [ ] T7: 真机验证 — acceptance: 锁屏/息屏下全屏弹出并循环响铃（**本机无法执行，标 `NOT_PERFORMED`**）(covers: S2.5)
