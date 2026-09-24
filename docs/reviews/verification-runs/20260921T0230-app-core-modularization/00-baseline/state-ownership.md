# 关键状态所有权表（P0 冻结）

判据：`scripts/verification/core-inventory.js` 的符号表 + 直接赋值点扫描。
「所有者」= 允许写该状态的唯一模块/函数；其它模块只能通过它暴露的命令改变该状态。
基线下这份表**并不成立**（`state` 有 370 处触碰、散布在几乎每个函数里），
它是 P3 的验收对象，不是现状描述。

## 1. 三组「只能有一个所有者」的状态（计划 §4 点名）

| 状态 | 当前写入点 | 目标所有者 | 目标读取方式 |
| --- | --- | --- | --- |
| 提交链 `commitChain` (L773) | `runCommit` (L787) 唯一直接赋值；`saveAsync` 经它排队 | `lib/app-persistence.js` | 只暴露 `save()` / `saveAsync()` |
| 原生同步队列 `nativeSyncInFlight` / `nativeSyncPending` / `nativeSyncVersion` / `nativeSyncMetrics` (L5134–5137) | `bumpNativeSyncVersion` (L5144)、`syncNativeRemindersNow` (L5148)、`queueNativeReminderSync` (L5250) | `lib/app-native.js` | 只暴露 `queueNativeReminderSync(source)`；计数经 `nativeSyncStats()` |
| 已提交快照 `committedAlarmItems` (L8141) | `publishActionDraft` (L5408) 与 `completeActiveAlarm` (L8150) 一带 | `lib/app-native.js` | 只读访问器 |

## 2. 活绑定（原 IIFE 闭包）必须特别处理的状态

计划 §4 明确点名的陷阱：模块**不得闭包捕获旧 `state.items`**，
必须经受控 `getState()` 读当前状态 —— 因为 `withDraftState(draft, job)` 会临时切换整份状态。

| 状态 | 当前 | 目标 | 约束 |
| --- | --- | --- | --- |
| `state` (L595) | 370 处触碰；`applyParsedState` (L1007) 是唯一的**整对象替换**点，其余为就地字段写入 | `lib/app-model.js` 持有；经 `getState()` 暴露 | 草稿切换的同步区间、恢复动作与异常处理保持原契约；异步任务不得跨过临时状态切换 |
| `storageReady` / `schemaMigrationNeeded` (L22–23) | `loadAsync` (L1086) / `loadSync` (L1107) / `applyParsedState` | `lib/app-persistence.js` | 装配期状态，不得被 UI 读取后缓存 |
| `triggerUserPicked` / `reviewTriggerUserPicked` / `lowConfUserPicked` / `itemFormSession` (L31–40) | 各命令内直接赋值 | `lib/app-capture.js`（表单会话事实） | 会话身份必须经显式命令读写，测试 hook 与生产 UI 用同一实例 |

## 3. 模块私有状态（随职责一起搬走，不得外泄）

| 状态 | 目标模块 |
| --- | --- |
| `homeViewSignature` / `homeRenderStats` (L2693–2695) | `lib/app-views.js` |
| `lastCompleteUndo` / `COMPLETE_UNDO_MS` / `undoNativeCheckPending` (L2171–2180) | `lib/app-items.js` |
| `feedbackWaiters` / `FEEDBACK_WAIT_MS` / `saveSubmitsInFlight` (L3563/3846) | `lib/app-capture.js` |
| `alertItem` / `dismissedAlerts` / `alertAutoHideTimer` (L4836–4837/7061) | `lib/app-alerts.js` |
| `exportInProgress` / `exportOperationId` / `pendingNativeExport` / `EXPORT_RESULT_GRACE_MS` (L7166–7169) | `lib/app-backup.js` |
| `deliveryEvidenceState` / `deliveryEvidenceInFlight` (L6413–6414) | `lib/app-native.js` |
| `activeAlarmRefreshBusy` / `activeAlarmPanelSignature` / `activeAlarmPollTimer` (L8159–8222) | `lib/app-alerts.js` |
| `toastTimer` / `similarTimer` / `aiBusy` / `deferredInstallPrompt` (L3514/4142/3396/8048) | `lib/app-ui.js` / `lib/app-ai.js` / `lib/app-platform.js` |
| `recentAlarmActions` / `ALARM_ACTION_DEDUP_MS` / `alarmEventClock` (L5332–5349) | `lib/app-native.js` |
| `inflightActionDepth` / `pendingUserOps` / `suppressUserFeedback` / `replayCreatedIds` / `activeActionScope` / `applyingActionDraft` (L845–850) | `lib/app-transactions.js` |
| `suppressInnerSave` (L818) | `lib/app-persistence.js` |
| `Lib` / `NativeReminders` / `FeedbackLib` / `EvidenceLib` / `storage` (L13–19) | `app-core.js` 装配处（构造后注入各模块） |
| `readyPromise` (L8360) | `app-core.js` |

## 4. 装配顺序约束（计划 §4）

- `wrapUserOp` 必须在**事件绑定与回调捕获之前**完成，且**只装饰一次**（当前在 L8389–8400，
  位于 `bind()` 调用之后 —— P3 需核对：`bind()` 在 `startApp()` 内被调用，而装饰在文件末尾同步执行，
  早于 DOMContentLoaded 回调，因此顺序成立；拆分后必须保持这一时序）。
- 所有调用者都必须取得**装饰后**的命令，不得残留拆分前的裸函数引用。
- 测试 hook 与生产 UI 使用同一实例、同一命令。
