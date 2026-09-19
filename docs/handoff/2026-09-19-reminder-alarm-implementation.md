# 提醒与闹钟机制改进：实现交接与独立验收合同

日期：2026-09-19。交接基线：`main` / `8d1c2617cff3aac5c4450a949c9044b79f63a673`。

用户要求：根据最新代码检查与推荐方案，交由其他 agent 实现，再回到原任务由交接 agent 独立验收。
本文件是实现任务书，不是实现完成报告。创建时产品代码未改动，工作区此前干净。

## 1. 目标与授权

实现下述四个阶段，顺序推进；阶段划分不是缩减交付范围。目标是：通知权限拒绝时仍能维护闹钟；旧操作不能误停新闹钟；自动静音后同次投递不复活；对账串行且减少无变化重排；恢复保留正确时间语义，并提供可核查证据。

本次用户要求是这些改进的实施依据。同步更新 D69 等相关文档，引用本交接和用户本次指令，区分既有裁决、实现选择与实际验证结果，不伪造过去的审批。不得借通用“先裁决”流程重复请求已授权实现；如确需改变提醒次数、ACK 语义、到期补投规则等产品行为，指出具体差异再交回用户。

默认在用户交给你的当前 checkout 实施；开始先核对仓库、分支、HEAD、工作区和适用 AGENTS.md。本文件的 HEAD 仅供对照，不得重置到此版本。你并非唯一工作者，保留他人修改和 untracked 文件；不要撤销、覆盖或提交不属于本任务的改动。默认本地完成，不提交、不推送、不创建 PR，不修改其他应用、设备全局限制或用户既有事项。

## 2. 必读入口与现状

- `lib/native-reminders.js`：`shouldFirstAlarm`、`buildDesired`、`reconcile`、`reconcileAlarms`、`runDrainAlarmActions`。
- `app-core.js`：`queueNativeReminderSync`、`syncNativeRemindersNow`、`applyAlarmAction`、提醒/截止台账回写和恢复前台入口。
- `android/app/src/main/java/space/alliswell/inbox/`：`SystemBridgePlugin`、`AlarmScheduler`、`AlarmTestReceiver`、`AlarmRingService`、`AlarmActivity`、`ActiveAlarmStore`、`AlarmStopReceiver`、`BootRestoreReceiver`、`ExactAlarmPermissionReceiver`、`AlarmTrace`。
- `android/app/src/main/AndroidManifest.xml`。
- `docs/decisions/alarm-carrier-2026-09-19.md`、`ui-reachability-d68-2026-09-19.md`、`release-gates-2026-09-19.md`、`request-d69-reconcile-churn-2026-09-19.md`。
- `docs/compose/spec/android-native-reminders.md`、`android-fullscreen-alarm.md`、`android-alarm-carrier.md`；按需阅读它们引用的业务基线。
- `docs/reviews/d59-alarm-carrier-device-verification-2026-09-19.md`、`d64-release-gates-device-verification-2026-09-19.md`、`d68-autosilence-home-notice-2026-09-19.md`。

文档存在历史描述未同步的问题，例如仍称最多响 6 小时。以当前源码、最新适用裁决、对应候选证据核对，不能照旧段落重新实现已完成能力。

当前规则：普通默认 1 次；重要默认 4 次/30 分钟、可关闭补提醒；关键 8 次/15 分钟。重要、关键及显式 `delivery_mode=alarm` 的首次走闹钟，后续及错过补投走普通通知。截止保护、整理提醒独立。ACK 不等于完成，停止声振不等于 ACK。服务已有 5 分钟自动静音；6 小时台账兜底与之分开。

交接前 `npm test` 已通过，属于 JS 行为/mock 与部分 Java 源码断言证据，不代表 Android 当前候选实机通过。

## 3. 实施阶段

### A. 权限与计划分流（最高优先级）

已确认：`reconcile` 用 `settings.notify && notifications === granted` 控制全部计划生成，再拆闹钟/通知。通知权限拒绝会把闹钟 desired 清空，并可能撤销已有闹钟。原生服务能在无通知权限下播放，不代表业务创建入口已贯通。

要求：

- 先根据业务总开关生成完整计划，再按载体及能力分流。总开关关闭仍取消所有未来提醒。
- 普通通知受通知权限和 LocalNotifications 可用性约束；闹钟计划不依赖通知权限，也不依赖 LocalNotifications 插件存在，仍受业务开关、事项有效性及 SystemBridge 能力约束。
- 精确权限不足沿用真实可用的降级，向用户显示能力限制；不能把排程降级记成准点保证。
- 通知拒绝时不凭空记普通通知“已排/已送达”；恢复权限按既有补投窗口、待定和去重规则对账。
- 能力状态区分声振、通知、屏幕和准点能力。首页文案不能一概声称闹钟不响，也不能在未排成功时承诺会响。

### B. 投递身份、停止与自动静音（最高优先级）

源码风险：`ActiveAlarmStore.stop` 最终调用不带身份的 `AlarmRingService.requestStop(context)`。当 A 的旧通知被处理而 B 正在响时，可能误停整个服务。此次只读检查未做真机复现，先补反例测试定位。

要求：

- 开始、停止、替换、服务回调、Activity 回落都使用同一个投递身份（deliveryId/token + 必要的 id/version），在执行副作用处再次校验。
- 清理 A 的旧通知只清理 A；找不到 A 的台账不能成为停止 B 的理由。若有“停止全部”功能，必须是独立明确入口，不能暗含在普通清理里。
- 保存每次投递的静音截止时间和终止原因。服务入口与 Activity 回落入口均拒绝已停止、已自动静音或已失效的同次投递。
- 自动静音后服务已退出，迟到的同 token Intent 也不得重启声振；不同的新投递可以正常响。
- 同 token 重入不能推迟截止时间。服务失败后的 Activity 回落也遵守同一截止时间，不能获得新 5 分钟。
- 用单调时钟处理同次开机内持续时长；明确持久化与重启策略。不能只靠 `Handler` 定时或一条全局“最后静音 token”证明跨生命周期正确。
- 关键状态写入确认、失败处理及 stop 顺序必须明确；`SharedPreferences.apply()` 更新内存不等于已同步落盘。持久化失败不得阻止用户停铃，但要记录失败并防止无条件复活。
- 保留单声源原则、现有 OEM 解冻路径及同 token 幂等。不要未经对照就删除双调度路径。多闹钟并发沿用现有替换规则，并记录被替换的投递，不擅自增加队列或并播策略。

### C. 串行对账、差量排程与诊断

已确认：闹钟每轮全量重排，JS 仅 80ms 去抖，无在途串行闸门；普通通知已经按 id/scheduleKey 做差量。

要求：

- 同时最多一轮对账；读取不可变的已提交快照及计划版本。在途新请求合并，若业务版本变更，结束后继续处理最新版本，直到收敛，不能丢掉补跑期间的新修改。
- 串行化覆盖实际入口，不只是一个定时器包装。旧轮结果不能把旧事项版本、旧排程 id、旧消费记录写回新状态。
- 区分业务计划变化与纯结果记账，避免 `save → queue → reconcile → save` 自激。
- 差量依据至少涵盖时间语义、目标时间、载体、payload/事项版本和调度模式。无变化时保留投递 token；新增/变化才安排，过时项才撤销。失败保留待重试状态。
- 普通变化采用差量；冷启动、重启、升级、权限恢复及时间事件走明确的强制重建入口。对厂商静默清理没有完整可观测保证，应如实说明，并保留合理的生命周期修复策略。
- **不能用 `getNextAlarmClock()`证明所有排程存在**：它仅提供下一闹钟信息。`PendingIntent` 存在、插件本地镜像存在、桥返回计算出的 triggerAt，也不等于系统队列逐条核验。`dumpsys alarm`只作设备验收证据，不作应用运行依赖。
- 诊断关键事件单独有界保留；重复对账聚合计数/原因，避免不断重写扩大后的 JSON。保留 received/ringStarted/visible/stopped/autoSilenced/failed 等关键事实，禁止记录提醒正文或凭据。
- 给 `queueNativeReminderSync`请求补来源与版本计数，以定位高频驱动；D69 的 1Hz 根因仍未定位，不得写成已证明是 appStateChange 抖动。

### D. 时间语义与恢复

要求：

- 原生最小计划镜像增加 schemaVersion、时间依据、恢复所需时间字段和计划/事项版本。业务真源仍是 IndexedDB，不新增另一套独立可写业务状态。
- 墙上时间保持本地日历含义；相对时长在同次开机内按经过时长处理。`setAlarmClock`使用墙上时间戳，需明确两种时间之间的换算和改时重排。
- 重启后单调时钟会重置，不能复用旧 elapsed 时间戳；定义与现有稍后提醒语义一致的恢复算法，写出关机跨过目标时刻的处理。
- 统一开机、升级、精确权限恢复、TIME_SET、TIMEZONE_CHANGED 的恢复入口，幂等且逐项容错。单条损坏/失败不能阻止其它条目恢复；失败可追踪。
- 不擅自改变既有错过闹钟“不集中补响”规则；必要时记录 missed/uncertain，沿用业务补投策略。
- 评估并实现锁定启动恢复所需的最小 device-protected 镜像与接收器配置；不要在首次解锁前读取 IndexedDB/credential-protected 数据。最小镜像默认不包含私密正文；解锁后回到权威状态对账。若现有产品隐私规则冲突，先报告具体冲突，继续其它阶段。
- Receiver 需要异步时使用 `goAsync()`，确保有界工作、finally finish 和必要资源释放。

## 4. 架构边界与成熟代码借鉴

保留双通道。业务状态、排程状态和声/振/屏/通知结果分开：声音成功与屏幕失败可以同时成立，不能塞进一个线性状态枚举。

不立即改成“全局仅一个 next-wake”：这要求原生能够独立计算完整计划，会扩大改动。普通通知保留现有 Capacitor 投影；不新增云推送、常驻轮询服务或不必要依赖。

参考：

- AOSP DeskClock 实例状态与恢复：https://android.googlesource.com/platform/packages/apps/DeskClock/+/refs/heads/main/src/com/android/deskclock/alarms/AlarmStateManager.kt
- Fossify Clock 调度/载体：https://github.com/FossifyOrg/Clock/tree/92a5b4c24e6b2756c0e63f7fe7d986c7b8bb7d84/app/src/main/kotlin/org/fossify/clock
- Tasks.org 通知生命周期：https://github.com/tasks/tasks/blob/47b0f7b079a223b393c05a0f35b7af559a437d0a/app/src/main/java/org/tasks/notifications/NotificationManager.kt
- Android 调度：https://developer.android.com/develop/background-work/services/alarms

复用思想和测试场景，避免直接搬入 GPL 实现。代码确需复用时核对具体文件许可证与依赖并记录来源。Android API 行为按当前官方文档核实；精确闹钟的前台服务启动豁免不能推导为任意后台 Activity 启动豁免。

## 5. 必须覆盖的验收矩阵

| 编号 | 场景 | 必须观察的结果 |
|---|---|---|
| A1 | 通知拒绝，通过真实表单新建重要/关键闹钟，退出 App 后到点 | 原生排程存在、声振投递；通知和屏幕能力据实报告 |
| A2 | 已有未来闹钟后拒绝通知权限，再进入 App 对账 | 闹钟不被误撤；普通通知不误记已送达 |
| A3 | 关闭业务总开关；仅 LocalNotifications 缺失；仅桥不可用 | 分别正确取消/隔离故障/报告不可用，无幽灵排程 |
| B1 | B 正在响，执行 A 的旧停止按钮、残留通知清理 | B 不停；真正停止 B 后声振与前台服务全部停止 |
| B2 | 同 token 双启动、自动静音后迟到启动、Activity 恢复 | 不重播、不延长；自动静音不产生 ACK |
| B3 | 服务失败、Activity 回落；A 被 B 替换后旧回调到达 | 回落遵守原截止时间；旧回调不影响 B |
| C1 | 相同计划连续请求 100 次 | 无并发对账；完成初次注册后无无谓重排/token 变化 |
| C2 | 对账阻塞时修改时间/删除/完成，再完成旧轮 | 最新状态最终生效，旧结果不能复活旧计划 |
| C3 | 排程失败、撤销失败、持久化失败、进程中断 | 状态可恢复、可重试；无虚假成功、无遗漏撤销 |
| C4 | 关键投递后大量普通对账 | 关键投递首末事实仍可查，日志有界且不含正文 |
| D1 | 墙上时间/相对时长分别改系统时间与时区 | 按各自时间语义执行，非统一固定旧 timestamp |
| D2 | 开机未解锁、解锁后、应用升级、精确权限恢复 | 恢复幂等、镜像最小化、权威对账不重复投递 |
| D3 | 关机跨过时间、损坏一条镜像、多条恢复中一条失败 | 过期不集中补响，其余有效项继续恢复 |
| R1 | ACK/稍后/完成/关闭、截止保护、整理、补提醒 | 保持现有业务语义，失败/重载不丢操作、不重复派生 |

尽量用行为测试构造竞态与失败，不用仅检查源码字符串替代行为验证。Java 原生风险需要原生测试或设备证据，JS mock 不足以结案。

## 6. 验证与交付

1. 执行 `npm test` 和 `git diff --check`；仅按新风险补相应测试，不运行会临时修改当前源码的反向脚本，除非确认其隔离与恢复方式。
2. 按 `docs/android-build.md`、构建脚本和适用 release gate 构建，确认 Web 资源同步且 APK 对应当前源码。不得复用陈旧 APK 声称新实现通过。
3. 可用设备按实际权限完成验证；优先真实创建事项链路，不只向 Receiver 注入 Intent。新增测试数据带标识，不改用户既有事项。涉及设备重启、改时、改区、权限撤销等有影响操作，按设备授权范围执行，记录并恢复原设置；授权或设备缺失只阻塞相关格。
4. 写 `docs/reviews/reminder-alarm-implementation-2026-09-19.md`，记录：基线/结束 HEAD、未提交差异、改动文件、A–D 完成情况、测试命令结果、剩余问题，以及上表逐项证据。
5. 新证据目录用独立时间戳且不覆盖旧候选。设备记录型号/系统、包名、APK SHA-256、源码版本或差异摘要、run ID、测试事项/token、权限状态、目标时刻/接收/声振/可见/停止时刻。日志必要脱敏。
6. 证据级别分别写 `PASS`、`FAIL`、`NOT_PERFORMED`、`INHERITED_EVIDENCE`。历史 vivo 结果只能继承引用。通知提交、播放器 started、Activity created 均不得单独当作用户可见/可听成功。
7. 修正触及文档中的过时结论，保留历史证据及其时间边界，不覆盖冻结基线或擅自分配已占用决策号。

## 7. 回交后的独立验收

原任务的交接 agent 负责独立验收；实现者自测不等于独立通过。

验收从实际交付版本重新核对：范围与差异、A–D 对应实现、行为反例、业务回归、打包资源、候选身份及设备矩阵。重点复核 A1/A2、B1/B2、C2/C3、D1/D2。缺设备或有效证据的格保持 NOT_PERFORMED，不批准为完整真机通过。

实现者最终回报必须包含：报告绝对路径、代码所在 checkout/分支/HEAD、是否存在未提交改动、测试结果、APK/证据路径和未完成项。由用户将该回报带回原任务启动验收；本文件不创建后台监控，也不表示已有 agent 自动接单。

## 8. 可直接发送给实现 agent 的任务指令

请在 `/Users/qlyf/Developer/reminder` 实现 `docs/handoff/2026-09-19-reminder-alarm-implementation.md`。先核对实际仓库、分支、HEAD、工作区和适用指令，保留他人修改。按 A→B→C→D 完成权限分流、token 限定的投递生命周期、串行差量对账、时间语义与恢复，逐阶段验证但不要在第一阶段结束时停止。保持现有产品提醒规则，不新增 next-wake 架构或云推送。按交接矩阵补行为测试、运行必需检查、完成可用的构建和设备验证；缺失项明确 NOT_PERFORMED。不要提交或推送。交付实现报告、实际代码版本/差异、候选和证据路径；完成后由原任务 agent 独立验收。
