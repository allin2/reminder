# 提醒与闹钟功能 · 规划 vs 实现 一致性审查报告

> **2026-09-19 独立复核更正（优先于下文原审查）**：
> - N1/N2 成立，交付报告已纠正；保留静态检查，但不得称原生行为证明。
> - N3 文档漂移成立，已统一为“代码接线已实现、设备全场景未验”。
> - N4 算术与双通路边界差异成立；统一规则待产品确认，本轮不擅自改提醒时间。
> - N5 并非五项都缺断言：C13、D10 原已有覆盖；本轮补 D11、D13 与 C15 独立排程。C15 串行展示未实现，最新交接要求保持单声源替换而非新增队列。
> - N6 的“没有参数逐值断言”不成立：smoke 已断言 followupMs=3600000、maxFollowups=2；真正缺口是跨通路窗口一致性。
> - N8 的“D69 未实现、仍全量重排”过时：当前已串行合并/差量；长期真机效果仍未完整复验。
> - H-08 不应概括为“屏幕始终未拉起”：旧候选 7bcb5663... 的 cold 有截图与 windowVisible=true，仅能记 INHERITED_EVIDENCE；other/off 未见可见界面，当前包全矩阵仍未验。
> - 本文探针只支持所测分支，不足以给完整生命周期/所有边界作“符合”结论。N7 schema5 仍未做；N9 脏工作区不是功能缺陷，不清理、不提交。
>
> 原文保留为历史审查记录。整改范围、现测结果与剩余项见 [审查整改报告](./reminder-alarm-audit-remediation-2026-09-19.md)。

- **日期**：2026-09-19
- **审查对象**：提醒（Attention / 重提醒 / 截止保护）与闹钟（全屏闹钟 / 原生投递）全链路
- **代码基线**：`main` 工作区（HEAD = `origin/main` = `8d1c261`；**32 处改动未提交**，见 §7-N9）
- **方法**：主张抽取 → 三查（调用点 / 断言覆盖 / 平台分支）→ 假时钟探针驱动真实状态机 → 实跑四套测试 → 文档漂移复查
- **红线遵守**：**只读不改**。本报告不改动任何源码；所有结论尽量以可复算的计数或字节码证据给出。

---

## 一、判定摘要

| 维度 | 判定 |
|---|---|
| 功能流程（解析→排程→投递→ACK→完成） | **符合** |
| 触发条件（档位路由 / 重提醒预算 / 截止两阶段 / 补投边界） | **符合**（探针 A–F 实测） |
| 状态管理（三态台账 / 投递 carrier 字段 / 差量对账） | **符合** |
| 边界情况（勿扰顺延 / 24h 补投窗 / 重入幂等 / 跨重启隔离） | **基本符合**，1 处规划张力（N4） |
| 逻辑缺陷 | **未发现功能性崩溃缺陷**；1 处已知未修（N8 / D69，待裁决） |
| **交付报告可信度** | **不符合**（N1、N2：报告声称与实测不符） |
| 文档一致性 | **不符合**（N3 三份文档三方状态；N7 已自认未做） |
| 验收覆盖 | **部分缺失**（N5：5 条直接相关案例仍 ⬜） |

**总评**：核心实现逻辑（流程、触发、状态机、边界）**基本符合**规格与裁决，探针实测未见功能断裂；**主要问题集中在「交付报告声称失真」与「文档状态漂移」两侧**，而非产品行为本身。界面可达性（H-08）与部分验收覆盖仍为开口项。

---

## 二、符合项（含文件:行 + 条款证据）

| # | 主张 | 条款 | 证据 |
|---|---|---|---|
| 1 | **档位路由**：normal 仅通知；important/critical 首发全屏闹钟 + 后续走通知；`delivery_mode=alarm` 强制全屏 | delivery-mode §S2.5 / D9·D25·A-01 / C1–C5 | 探针 B：normal `0 闹钟/1 通知`；important `1 闹钟 + 3 通知(10:30/11:00/11:30)`；critical `1 闹钟 + 7 通知(10:15–11:45)`；normal+`delivery_mode=alarm` → `1 闹钟/0 通知`。代码 `app-core.js:1069-1072 resolveDeliveryMode`、`lib/reminder.js REALERT`、`lib/native-reminders.js shouldFirstAlarm` |
| 2 | **重提醒预算**：normal 1 · important 4×30min · critical 8×15min | delivery-mode §S2.5 | 探针 F：`1 / 4 / 8` 精确吻合 |
| 3 | **截止保护两阶段**：p24（提前 24h）+ p2（提前 2h），独立身份 `stageKey@deadlineAt` | 交接书 D 时间语义 | 探针 C：`deadlineAt=now+26h` → `buildDesired` 排 **2 条**（p24@11:00、p2@09:00）。`lib/reminder.js deadlineStage/deadlineStageKey` |
| 4 | **补投边界**：错过 ≤24h 补投，>24h 丢弃 | `DEADLINE_GRACE_MS=24h` | 探针 D：错过 1h / 23h → 补投 1；错过 **25h → 0** |
| 5 | **窗口粒度节流修复**：整理提醒按「窗口」而非「分钟」取 key，`maxFollowups` 不再被绕过 | D22 / 回归 | `app-core.js:1242-1250 reviewSessionKey` = `W:<date>T21:30`；`maybeReviewSession:1328-1342`。smoke D22 断言 `hitsA===2` 通过 ✅ |
| 6 | **待整理原生排程已接线**（非死代码） | D19 / E6 / I11 | `lib/native-reminders.js:842-848` 在 `reconcile()` 同一次对账内调用 `buildReviewDesired` |
| 7 | **权限分流告知**：总开关 / 系统权限 / 桥 / 对账失败四态分开 | INV-06 / §473 / D59 | `app-core.js:1588-1631 homeNoticeVerdict`，含「无法保证提醒」「系统通知权限未授予：关掉 App 后不会有通知，屏幕也不会亮」 |
| 8 | **投递台账字段**：真实送达可回溯（sound/vibrate/autoSilenced/exact/fsi） | 交接书 B 生命周期 | `SystemBridgePlugin.lastAlarmDelivery` 回传 `carrierSound/carrierVibrate/carrierFGS/carrierTrace/autoSilenced/exactAtDelivery/fsiAtDelivery`；`AlarmRingService.recordCarrier` |
| 9 | **全屏四出口 + 返回键=关闭，关闭止响不写 ACK** | C7 / D12 / Inv-03 | `AlarmActivity.java`（ack/snooze/done/close，`onBackPressed=close`） |
| 10 | **`onStop` 不停声振**（刻意裁决） | D45-a | `AlarmActivity` 停止逻辑仅 `onDestroy` 回落 |
| 11 | **勿扰只顺延普通档**，重要/关键照常 | C12 / §15 | 探针 A（`dnd=true` 抑制窗口外槽位）+ `buildReviewSlots.shift()` |
| 12 | **对账差量缓存**：签名未变则跳过重排 | C1 压测 | `lib/native-reminders.js:587-702 alarmSignaturesCache`；C1 报告「100 次对账仅首次排程」 |

---

## 三、不符合项 / 疑点

### N1 【高】交付报告声称不实：Java 源码正则「未移除」

- **声称**：`docs/reviews/reminder-alarm-implementation-2026-09-19.md:85`（R2-05）——「**彻底移除** `test-native-reminders.js` 中所有 Java 源码正则匹配」。
- **实测**：
  - `grep -c readSrc test-native-reminders.js` → **31**
  - `grep -c 'readSrc("android/app/src/main/java'` → **11**（直接读 Java 生产源）
  - 含 `src/main/java` 路径的行 → **15**
  - 样例 `test-native-reminders.js:396-398`：读 `AlarmTestReceiver.java` / `AlarmActivity.java` / `SystemBridgePlugin.java` 做正则断言。
- **结论**：**声称与实测直接矛盾**。项目方法论红线「源码级断言无法反向验证」的风险**未消除**；同时该声称会误导后续审查者对测试可信度的判断。

### N2 【中】交付报告单测清单与实际文件不符

- **声称**：报告第二节列 **6 项** Java 单测。
- **实测**：`android/app/src/test/java/space/alliswell/inbox/ProductionJavaAlarmTest.java` 有 **8 个 `@Test`**；其中报告所列 `testRealComponentsUnlockedGetSharedPreferencesRecursionImmunity` 与 `testRealComponentsLockedDirectBootStorageRouting` **在整个 `android/` 树中不存在**；实际另含 `testOldDelegatingPatternOverflowsThroughRealProductionChain` / `testDirectBootRoutingMatrixOnRealComponents` / `testDirectBootUtilsRouteDiscrimination` / `testRealComponentsInstantiateAndNeverRecurse`。
- **结论**：报告测试清单**陈旧或凭想象**，与实现漂移。实际单测数量更多、且真实实例化生产类（`new AlarmRingService()` / `new AlarmActivity()`），质量优于正则；但**报告本身不可信**。

### N3 【中】全屏闹钟规格三方状态互相矛盾（文档漂移）

同一份全屏能力，三份文档给出三种状态：

| 文档 | 状态 |
|---|---|
| `docs/compose/spec/android-fullscreen-alarm.md` | `status: decided`；Report 写「**规格已定，代码接线未落地**」；Tasks **T1–T6 全部 `[ ]` 未勾选** |
| `docs/compose/spec/delivery-mode.md` | **T5 / T6 已勾选 `[x]`**（关键档 / 重要档接入全屏闹钟） |
| `docs/product-logic.md:17` | 声称「有标记事项首次走全屏闹钟」（已落地） |

- 且 `android-fullscreen-alarm.md` **文件内自相矛盾**：§S2.1（2026-09-19 已更正）称重要档也走全屏，而 §S3「Out of Scope」仍把「普通档、**重要档**使用全屏闹钟」列为排除项。
- 代码/实机侧：`AlarmActivity.java` / `AlarmRingService.java` 存在，真机声振已验证能响。
- **注**：用户可见结果（屏幕拉起）**仍未达成** → 属已知缺口 H-08，见 §六 NOT_PERFORMED。故此矛盾是**文档状态**问题，不是「功能声称虚假」。

### N4 【中】D22「当天最多 3 次」在默认窗口下达不到（规划—实现张力）

- **规划**：`docs/decisions/interaction-logic-2026-09-16.md:113`（D22）——「60 分钟 × 2 次（当天最多 3 次）」，依据原文称「**60×2 正好铺满 21:30–23:00 的窗口**」。
- **实测**：
  - 探针 E（假时钟驱动 `maybeReviewSession`，21:00–23:45 每 15 分钟）：**实际只发 21:30、22:30 两次**；第 2 次补充应为 23:30，越过窗口上界 23:00，被 `app-core.js:1320 if (!windowOpen && !snoozeDue) return` 抑制。
  - 探针 A（原生 `buildReviewDesired`）：`dnd=false` → `21:30 / 22:30 / 23:30`（第 3 次落在窗口**外**）；`dnd=true`（默认）→ `21:30 / 22:30`。
- **算法核对**：`21:30 + 60min×2 = 23:30 > 23:00`，故 D22 依据里「60×2 正好铺满 21:30–23:00」这句**算术不自洽**（真要铺满至 23:00，间隔应为 45 分钟）。
- **两条通路不一致**：默认（`dnd=true`）两者都给 2 次；**关闭勿扰时原生给 3 次（第 3 次在窗口外）、应用内仍给 2 次**——窗口边界的处理不一致。
- **需澄清**：窗口上界 23:00 是否应作为待整理补提醒的**硬边界**；若「3 次」是硬目标，应改间隔或放宽窗口。

### N5 【中】验收覆盖缺口：5 条与提醒/闹钟直接相关仍 ⬜

`docs/acceptance-cases.md` 中仍未补断言的：

| 案例 | 要求 | 备注 |
|---|---|---|
| **C13** | 通知权限关闭 → 首页明确告知「无法保证提醒」 | **实现存在**（`homeNoticeVerdict:1588-1631` 有对应文案），属「未补断言」 |
| **C15** | 相同时间多事项：走闹钟的**不能聚合**，会串行弹出 | 无断言，实现状态待确认 |
| **D10** | 事项有周五 Trigger 且 NEEDS_REVIEW → 周五仍必须正常提醒 | INV-02，无断言 |
| **D11** | 6 条待整理到窗口 → 只发 **1 个**会话通知，不逐条轰炸 | AC-07，无断言 |
| **D13** | 10 条只处理 4 条退出 → 4 条立即持久化，下次只继续剩余 6 条 | AC-09，无断言 |

（另有 A9–A12、B3/B6/B8/B11、C8–C11、D5 亦 ⬜，多属录入/UI 范畴。）

### N6 【中】D9 验收 ✅ 的依据是「节奏守卫」而非「次数」

- `acceptance-cases.md:125` D9 标 ✅，依据列「native 待整理排程 + smoke 3f **节奏守卫**」。
- 该断言验证的是「不刷屏」（节流形状），**未逐值断言 D22 的参数**（60min×2 / 最多 3 次）。
- 这属**掩盖性断言**：断言测的是行为形状而非规格数值，恰好解释了为何 N4 的偏差长期未被测出。

### N7 【低-中】schema 5 迁移未做（功能遗漏，已自认）

- `delivery-mode.md:130` T9 `[ ]`（schema 5 迁移，与 G01 正交状态建模合并）；T10 `[~]`「迁移一档仍缺」。
- `product-logic.md:24` 亦列「仍未落地：schema 5 迁移（T9）与 G01」。
- **影响**：历史数据的 `delivery_mode` 与档位一致性无迁移保证（T8 已覆盖「重建不漂移」，但老数据缺失）。属**已知未做**，非隐瞒。

### N8 【低】D69 对账风暴放大器仍在（待裁决，未修）

- `app-core.js:5077-5098 onResume`：`await getPermissionState()` → `await drainAlarmActions()` → `await refreshActiveAlarmPanel(true)`，再 `queueNativeReminderSync()`；另有 `syncNativeRemindersNow` 通路各自 await 原生往返，**绕过 80ms 去抖** → 一次前台事件触发两轮全量重排。
- 与 `docs/decisions/request-d69-reconcile-churn-2026-09-19.md` 一致，**项目约定：裁决前不动代码**。

### N9 【低】审查对象为未提交工作区

- `git status --porcelain` → **32 项**（15 modified + 17 untracked），含四阶段实现轮与 `DirectBootUtils.java`（新建）。
- HEAD = `origin/main` = `8d1c261`（本地与远程同步；改动全在工作区未提交）。
- 属交付报告自述的 No-Commit 约定，非缺陷；但需注意**「当前源码 ≠ 已提交基线」**，审查结论只对工作区快照成立。

---

## 四、验证发现（探针实测数据）

以假时钟驱动**真实状态机**（非仅观察计数器），观察真实副作用时间戳：

| 探针 | 驱动方式 | 实测结果 | 判定 |
|---|---|---|---|
| **A** 待整理原生槽位 | `buildReviewDesired` | `dnd=false` → `21:30/22:30/23:30`；`dnd=true` → `21:30/22:30` | 第 3 次可越窗口（见 N4） |
| **B** 档位路由 | `buildDesired` + 各档位 | normal `0闹钟/1通知`；important `1闹钟+3通知`；critical `1闹钟+7通知`；normal+alarm `1闹钟/0通知` | ✅ 符合 C1–C5 |
| **C** 截止保护 | `deadlineAt=now+26h` | 排 **2 条**：p24@11:00、p2@09:00 | ✅ |
| **D** 补投边界 | 错过 1h / 23h / 25h | 补投 1 / 1 / **0**（24h 窗） | ✅ |
| **E** 应用内整理提醒 | 21:00–23:45 每 15 分钟驱动 `maybeReviewSession` | **仅 21:30、22:30 两次** | ⚠ 见 N4 |
| **F** 重提醒预算 | `shouldRealert` | normal `1` / important `4` / critical `8` | ✅ |

**文档漂移复查**：`delivery-mode.md` T9 `[ ]`（schema 5 迁移）、T10 `[~]`（迁移一档缺）；`android-fullscreen-alarm.md` T1–T6 全 `[ ]` 而 `delivery-mode.md` T5/T6 `[x]`（见 N3、N7）。

---

## 五、测试可信度评估

| 套件 | 实测 | 可信度说明 |
|---|---|---|
| `test-unit.js` | **249 通过 / 0 失败** | 纯逻辑，可信 |
| `test-native-reminders.js` | **291 通过 / 0 失败** | ⚠ 仍含 **31 处 `readSrc`（11 处读 Java 源）** 的正则断言，「源码级断言无法反向验证」风险未消（N1） |
| `test-smoke.js` | **219 通过 / 0 失败** | 含 D22 窗口粒度回归 `hitsA===2`，可信 |
| `test-regressions.js` | **574 通过 / 0 失败** | 可信 |
| `ProductionJavaAlarmTest`（Gradle `:app:testDebugUnitTest`） | **8 个 `@Test`**（报告只列 6） | 真实实例化生产类，质量**优于**正则；但 JVM 上跑，属逻辑级非真机（N2） |

**方法论提示**：「报告说已验证」≠「验证成立」。本轮四套测试**全绿**，但绿的原因需区分——N1/N6 提示部分断言测的是**行为形状或常量**，而非规格数值。

---

## 六、NOT_PERFORMED 清单

1. **界面/屏幕拉起（H-08 已知缺口 2）**——声振已真机验证能响，但屏幕/界面**仍拉不起来**（`AlarmActivity` 计数 0、屏幕全程 Asleep、`launchLikelyBlocked(no SYSTEM_ALERT_WINDOW)`）。全屏闹钟 T7「真机弹出」= **NOT_PERFORMED**。
2. **D69 对账风暴修复**——待裁决，未动代码。
3. **真机物理破坏性场景**——冷重启后首次解锁前响铃（LOCKED_BOOT_COMPLETED）、篡改系统时钟/时区、并发双闹钟物理交叉；交付报告自标 `NOT_PERFORMED` / `PARTIAL`。
4. **schema 5 迁移的历史数据一致性**（N7）——未实现，无法验证。

---

## 七、建议下一步（按优先级）

1. **澄清 N4**：窗口上界 23:00 是否为待整理补提醒硬边界？「3 次」是硬目标还是上限？裁决后再决定改间隔或放宽窗口。
2. **登记 N1 / N2 为交付报告缺陷**：要求交付方**更正报告**或**补做** readSrc 移除；报告可信度问题应在独立会话复核。
3. **统一 N3**：三份文档（spec status / Tasks 勾选 / product-logic 表述）对齐同一状态。
4. **补 N5 断言**：C13 已有实现，补齐断言即可；C15/D10/D11/D13 先确认实现状态再补。
5. **N8 待 D69 裁决**；**N6** 建议把 D9 的「节奏守卫」升级为对参数值的逐值断言。

---

*本报告为只读审查产物，未改动任何源码。所有计数、行号、探针数值均可按 §三/§四所述命令复算。*
