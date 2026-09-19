---
doc: decisions
topic: 两条上架门禁（USE_EXACT_ALARM 资格 / A14+ 全屏意图）
date: 2026-09-19
decided_by: 产品所有人
baseline: Attention_Inbox_V0.2_产品需求与业务规格基线.md + A-01
proposal: 无（本次不修订冻结基线）
spec: ../compose/spec/android-alarm-carrier.md · ../compose/spec/android-fullscreen-alarm.md
---

# 裁决 · 两条上架门禁（D64–D67）

> **来源**：H-08「照搬成熟做法」调研中顺带勘出的两条**独立于 H-08** 的发布门禁，
> 见 [`alarm-carrier-2026-09-19.md`](./alarm-carrier-2026-09-19.md) 的「待裁决」表。
> **裁决方式**：产品所有人 2026-09-19 就「给界面那一格出提案、还是先处理两条门禁」回答
> 「**出提案并处理门禁**」→ 界面缺口另出提案（不写代码），两条门禁本轮**动手处理**。
>
> **结论先行：本次裁决不修订冻结基线。** 两条门禁都属**实现层合规与可观测性**，
> 不改动 PRD 的任何产品语义 —— 因此 `V0.2-amendments.md` 不新增条目，也不新增 CP。

## ⚠️ 编号说明

按 [`import-export-ruling-2026-09-18.md`](./import-export-ruling-2026-09-18.md) 记下的教训，
分配前扫描 `docs/**.md` 的**实际占用**（排除 `verification-runs/` 下的历史快照）：

```
max = 63（D58–D61 = 闹钟档载体裁决；D62–D63 = 其实现期推定）
```

**本裁决自 D64 起编号。** 同时确认 `docs/` 内不存在 D64 及以上的占用。

## ⚠️ 先更正一条我们自己写下的事实错误

上一轮我向产品所有人报告「**A14+ 的 `USE_FULL_SCREEN_INTENT` 缺口本项目完全没处理**」。

**这条是错的。** 实测代码：`SystemBridgePlugin.canUseFullScreenIntent()`（API 34+）、
`diagnose()` 回传、`openFullScreenIntentSettings()`（`MANAGE_APP_USE_FULL_SCREEN_INTENT`）、
`index.html` 的 `#labFullScreen`/`#labFullScreenPill`、`app-core.js:4413-4424` 的渲染与
`app-core.js:4685` 的跳转接线、以及 `test-native-reminders.js:429` 的守护断言，**全部存在** ——
它们来自 2026-09-17 的 Q3-a/Q3-b 轮次（[`android-fullscreen-alarm-2026-09-17.md`](../reviews/android-fullscreen-alarm-2026-09-17.md) 有记录）。

也就是说：**该门禁的「检测 + 归因 + 引导」三件早已交付**，我当时是照记忆推的，没有回读代码。
这条更正很重要 —— 它把本轮的工作量从「从零实现」改成了「补一个真实存在的缺口」（见 D65）。

## 裁决表

| # | 问题 | 裁决 | 依据 |
|---|---|---|---|
| **D64** | **`USE_EXACT_ALARM` 的上架资格** | 本应用**不满足资格**，**从清单移除该声明**，改为只声明 `SCHEDULE_EXACT_ALARM`，并**补齐官方迁移清单的全部四步**（先查 → 请求 → 授权后重排 → 优雅降级）。移除后 Android 14+ 上精确排程需用户授权；未授权时降级为非精确并**如实落台账** | 官方 Play 政策（受限权限，仅闹钟/计时器或显示活动通知的日历类可声明，「若是應用程式不符合使用限制條件,就禁止在 Google Play 發布」）· Android 14 行为变更「Schedule exact alarms are denied by default」明确受影响应用特征为「**Isn't a calendar or alarm clock app**」，并给出替换路径原文 |
| **D65** | **投递时快照两项权限** | 投递台账新增 `deliveryExactEnabled` / `deliveryFullScreenIntentEnabled` 两个**投递当时**的快照；`lastAlarmDelivery` 回传为 `exactAtDelivery` / `fsiAtDelivery`；**归因优先读快照**，活值仅作老记录回退。理由与 H-08 的 `deliveryNotifyEnabled` **完全同构**：用「现在」的权限解释「当时」的结果会误诊 | D48 的教训（本项目已因「用现在的权限解释当时的结果」误诊过一次）· 见「已知缺口」一节 |
| **D66** | **消除排程静默降级** | `AlarmScheduler.schedule`：① 排程前先查 `canScheduleExactAlarms()`；② **解冻器调用移出精确排程的 try 块**（原来降级后连解冻器都不排，F3 的解冻整条失效）；③ 每条路径**都写一条带真实 `mode` 的台账**，区分 `alarmClock` / `exactIdle` / `exact` / `inexactFallback` / `inexactNoPermission`；④ 闹钟时钟位排程失败**不再 `catch (Exception ignored)` 吞掉** | 去重后的失效形态与本项目最痛的一类完全相同：**安静地不响、不报错、不留痕**。D64 移除 `USE_EXACT_ALARM` 后这条路会成为 Android 14+ 的默认路径 |
| **D67** | **非精确降级必须被说出来** | 「本次为**非精确**排程」是**排程层**的事实，与「屏幕有没有载体」**正交**。只要投递时 `exactAtDelivery === false`，归因文案（含「无通知权限」那条早返回分支）都必须带上它 —— 否则用户会把「到点晚了十分钟」理解成界面/通知问题，去反复授权无关权限 | 与 D59 同一条纪律（「响了但没亮屏」不得被报成「完全静默」）· 缺键（老 APK 记录）按「精确」处理，不凭空指控 |

### 支撑 D64 的官方原文

**Play 政策**（[support.google.com/googleplay/android-developer/answer/16558241](https://support.google.com/googleplay/android-developer/answer/16558241)）：

> 「USE_EXACT_ALARM 是一項受限制權限,只有當應用程式的核心功能支援精確鬧鐘需求,應用程式才能宣告這項權限｡
> 要求這項受限制權限的應用程式必須接受審查,**若是應用程式不符合使用限制條件,就禁止在 Google Play 發布**」
>
> 「只有在應用程式為使用者提供的**核心功能**需要精確計時的操作時,應用程式才必須使用 USE_EXACT_ALARM,例如:
> · 應用程式是鬧鐘或計時器應用程式｡· 應用程式是會顯示活動通知的日曆應用程式｡」
>
> 错误做法：「將這項權限用於『**未直接涉及應用程式主要用途**』的非核心功能｡」

本应用核心功能是「注意力收件箱 / 提醒与待办管理」，闹钟是**其中一档交付形态**，不是核心功能。

**Android 14 行为变更**（[Schedule exact alarms are denied by default](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms)）：

> 「Calendar and alarm clock apps should declare USE_EXACT_ALARM」
> 「**Affected apps** … Targets Android 13 (API level 33) or higher. Declares the SCHEDULE_EXACT_ALARM
> permission in the manifest. Doesn't fall under an exemption or pre-grant scenario.
> **Isn't a calendar or alarm clock app.**」

官方给受影响应用（即我们这一类）的迁移步骤，逐条对应本次落地：

| 官方步骤（原文） | 我们的落点 |
|---|---|
| 「At a minimum, apps must check to see if they have the permission before scheduling exact alarms.」 | `AlarmScheduler.canScheduleExactAlarms()` + 排程前预检（D66） |
| 「invoke an intent that includes the `ACTION_REQUEST_SCHEDULE_EXACT_ALARM`, along with the app's package name」 | `SystemBridgePlugin.openExactAlarmSettings()`（**此前已实现**）+ 自检面板第 3 项 / 应用设置页入口 |
| 「Set up your app to listen and properly react to the foreground broadcast `AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`」 | **本次新增** `ExactAlarmPermissionReceiver`（D64，此前完全缺失） |
| 「If the user denied the permission instead, gracefully degrade your app experience」 | 降级为非精确 + 如实记 `mode`（D66）+ 归因明示（D67） |

## 已知缺口（本轮**未**解决，需另议）

1. **降级后的用户可见面只到「自检面板 + 应用设置页」为止。** 目前没有在**投递失败时**主动提示
   「你的闹钟现在是非精确的，去开一下」。这与 D63 记下的界面缺口属同一类（该说的没说），
   但**不是同一件事**，不合并处理。
2. **撤销方向接不住。** 官方只在**授予**时发那条广播；撤销没有对应广播，且撤销会连带清掉已排的精确闹钟。
   现状依靠「排程前预检」+ 开机重排兜底，**不假装能接住撤销瞬间**。
3. **`USE_FULL_SCREEN_INTENT` 的「清楚说明需求」文案未审。** 官方政策要求非闹钟/通话类应用
   「必須取得使用者明確同意,並**清楚地說明您的需求**」。我们有跳转入口与状态显示，
   但**没有审过那段文案是否满足「清楚说明」**。建议单独一轮（文案 + 截图留证）。

## 影响面

| 文件 | 动作 |
|---|---|
| `android/app/src/main/AndroidManifest.xml` | 移除 `USE_EXACT_ALARM` 声明；注册 `ExactAlarmPermissionReceiver` |
| `android/.../ExactAlarmPermissionReceiver.java` | **新增** |
| `android/.../AlarmScheduler.java` | 权限预检 + 解冻器移出 try + 各路径记 mode |
| `android/.../AlarmTestReceiver.java` | 新增两项投递时快照 + 两个取值方法（含 minSdk 22 版本闸门） |
| `android/.../SystemBridgePlugin.java` | `lastAlarmDelivery` 回传快照，并标明活值语义 |
| `app-core.js` | 归因优先读快照；新增非精确提示（含早返回分支） |
| `test-native-reminders.js` / `test-smoke.js` | 断言 233→245 / 197→204 |
| `scripts/verification/reverse-check-d59.js` | 反向验证 10→**22** 条 |

## 回退方式（逐条）

| 裁决 | 回退动作 |
|---|---|
| D64 | 把 `USE_EXACT_ALARM` 的 `uses-permission` 行加回清单（同时恢复 Play 拒审风险）；接收器可留着，无害 |
| D65 | 把 `describeAlarmDelivery` 里的 `fsiAtDelivery`/`exactAtDelivery` 换回 `canUseFullScreenIntent`（1 处） |
| D66 | 把 `scheduleUnfreezer` 调用移回 try 内（1 行）—— 但**不建议**，那正是本轮修掉的失效 |
| D67 | 删掉 `exactNote` 的拼接（2 处） |

---

## 落地与真机验证（2026-09-19）

D64–D67 已全部落地并接真机。完整取证见
[`../reviews/d64-release-gates-device-verification-2026-09-19.md`](../reviews/d64-release-gates-device-verification-2026-09-19.md)。

| 项 | 状态 |
|---|---|
| 代码 | ✅ 清单移除 `USE_EXACT_ALARM` + 注册接收器；`AlarmScheduler` 预检/移出 try/记 `mode`；投递时快照；归因优先读快照 + 非精确提示 |
| 测试水位 | ✅ unit **249** · native **245**（233→245）· smoke **204**（197→204）· regressions **574** = **1272**，0 失败 |
| 反向验证 | ✅ `reverse-check-d59.js` **22/22**（10→22，每条 D64 断言可证伪） |
| 真机 | ✅ vivo V2238A / Android 16 (API 36) |

### 三条最值得记住的实测结论

1. **D64 在产物层成立，且核它的方法被修正了。** 源码里 `grep USE_EXACT_ALARM` 会命中 3 次
   —— **全是注释**（AGP 把主清单注释原样合并进合并清单，其中一行正是 D64 自己写的说明）。
   权威判据是**读 APK 的二进制清单**（注释被 AXML 编译器丢弃）：
   `aapt2 dump xmltree --file AndroidManifest.xml <apk>` → 12 条权限，**不含** `USE_EXACT_ALARM`。
   **纪律：核权限读 APK，不读源码/合并清单文本。**
2. **权限变更接收器端到端跑通，且走的是真实路径。**
   `SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED` 是**受保护广播**，
   `am broadcast … from uid=<app>` 被 `SecurityException` 拒（第三方发不出）。
   `appops set … allow` → **系统自行发出** → 台账 `exactAlarmPermissionChanged … rescheduling`
   → 三个闹钟 `requested → scheduled mode=alarmClock → unfreezerScheduled`。
   **接收器没有把「收到广播」当「已授权」**，而是自己实测方法值 —— 这正是设计要点。
3. ⚠️ **移除 `USE_EXACT_ALARM` 在本机没有造成降级**（与预期相反，如实记录）。
   `appops … deny` 后 `canScheduleExactAlarms()` **仍为 true**（系统侧却记 `Last OP_…: deny`）
   ⇒ **该 vivo / Android 16 ROM 不按 appop 判定**。决定性探针（真实排一个闹钟）返回
   `{exact:true, alarmClock:true, mode:"alarmClock"}`。
   **后果**：D66 的 `inexactNoPermission` 降级分支**在本机没被真正触发过**，
   「Android 14 默认拒绝后优雅降级」在本机**仍是推断**；要实测它需要一台按标准 AOSP 行为判定的设备。
   **不编造降级已发生。**

## 本次**未**闭合（延续「已知缺口」）

| 项 | 说明 |
|---|---|
| 界面/屏幕在无通知权限下仍不可达 | **另出提案**：[`ui-reachability-proposal-2026-09-19.md`](./ui-reachability-proposal-2026-09-19.md)（未裁决，代码未动） |
| D66 的非精确降级分支 | 本机不可达（上表第 3 条），需另一台设备 |
| `USE_FULL_SCREEN_INTENT`「清楚说明需求」文案 | 未审；见「已知缺口 3」 |
| 降级后（非精确）的**排程时**主动提示 | 现只在**投递时**归因，D67 不管排程时刻 |
