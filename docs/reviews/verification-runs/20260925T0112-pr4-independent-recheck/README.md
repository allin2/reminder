# PR #4 独立验收复验报告（勿扰 + 陈旧已送达通知撤除）

- **复验日期**：2026-09-25（01:12 开始，01:13 中断；05:13–05:35 续跑完成）
- **复验对象**：实施方自测 [`../20260925T0030-pr4-dnd-and-stale-notif/`](../20260925T0030-pr4-dnd-and-stale-notif/README.md)
- **复验结论**：**独立复验 PASS（附条件）**：关键断言 A1、A3、A4、B1、B5 以及 B1 冷启动都在真机上重跑通过。附条件如下：
  1. 复验时**临时**把「默认提醒方式」切到了「系统通知」，已事先征得用户同意，结束后已恢复。PR #4 只覆盖系统通知路径，用户现在的默认方式是「闹钟」，这条路径 PR #4 没有覆盖（见第 6 节 F1）；
  2. 实施方报告有 3 处与证据不符或不合规（见第 5 节），不影响产品结论，已由验收方在该报告中修订（标记为〔验收修订〕）。

## 1. 身份核对

| 项 | 值 | 结果 |
|---|---|---|
| 分支 / HEAD | `fix/remove-stale-delivered-notifications` / `c8f4f8f2cb4a05642d7a2d96e7633d4bb1d76baf` | MATCH |
| 受控文件改动 | `git status` 中没有已跟踪文件的改动 | MATCH |
| `lib/native-reminders.js` SHA-256 | `c7f56f3f197e7b9058f755cc0114e84ef0beb87b0bdab143beeee711aca93f98` | 与实施方一致 |
| `sw.js` SHA-256 / 缓存名 | `237de774…f047` / `attention-inbox-v44` | 与实施方一致 |
| 候选包 `releases/candidates/20260925T0030-pr4-candidate/app-debug.apk` | `83be4ea9a847d0d9d87dcd7856c6b27c23d0b096dd29f64e298e2cddf8dfb579` | — |
| 机上 base.apk（05:13 读取） | `83be4ea9a847d0d9d87dcd7856c6b27c23d0b096dd29f64e298e2cddf8dfb579`，lastUpdateTime 00:36:09 | **与候选包一致** |
| 设备 | vivo V2238A / Android 16，`10ACBF2D3D000RS` | — |

证据：`raw/r1-identity-leftover.json`。

## 2. 中断与续跑时间线（如实记录）

| 时间 | 事件 |
|---|---|
| 01:12:53 | 复验开始，记录基线（`raw/00-*`）：dnd=true，23:00–07:30 |
| 01:12:57 | 新建 `RFX 复验勿扰甲`（`i_81ttgndmmufsiqo6`），读回待发时刻为 07:30（勿扰结束），**之后复验中断** |
| 01:14–01:16 | 用户手动在应用里试用：新建 5 条自己的事项，关闭勿扰，把默认提醒方式改成「闹钟」（用户已确认这些是本人操作，要保留） |
| 05:13 | 手机重新连上。确认机上包与候选包一致；删除中断遗留的 RFX 事项（待发排程已清除，没有打扰到用户） |
| 05:14 | **重新建立复验基线**（`raw/10-recheck-baseline*`）：dnd=false，23:00–07:30，defaultDeliveryMode=alarm |
| 05:14–05:20 | 第一次重跑（R2），结果**作废**，原因见 §3.1 |
| 05:26–05:34 | 正式重跑（R3），全部通过 |
| 05:35 | 终态检查与快照比对（R4） |

## 3. 复验结果

### 3.1 R2 作废说明（05:14–05:20，`r2_dnd_a1_a4.py`、`raw/r2-*`）

当时的默认提醒方式是「闹钟」，新建的普通档事项因此是 `delivery_mode=alarm`，走的是原生全屏闹钟，而不是 LocalNotifications，所以 `getPending()` 为空。另外，05:20:05 用户在手机上手动点了「完成」（用户已确认；原生 AlarmTrace 里没有闹钟界面的动作记录，完成动作来自 WebView），事项在删除前已经是完成状态。这一轮只有 A3 的「到勿扰结束时刻才送达」能说明勿扰对闹钟路径同样生效；A1、A4 都不计入结论。

### 3.2 R3 正式结果（`r3_recheck.py`、`raw/r3-results.json`）

前置：经用户同意，通过「我的」页的 `#deliveryModeSeg` 把默认提醒方式临时切到 notification（只影响之后新建的事项）。

| 编号 | 场景 | 关键时刻 | 断言 | 结论 |
|---|---|---|---|---|
| **A1** | 临时勿扰窗口 05:25–05:32，新建普通档 `2分钟后提醒我 RFX 复验勿扰丁`（`i_w5rrkpztmug1kkt2`，通知 id `2098440493`） | 原定 05:28:18.7 | `getPending` 中 `schedule.at` = 05:32:00，与勿扰结束时刻相差 **0 ms**；原定时刻 +30 s 时通知栏中本包没有这条通知 | **PASS** |
| **A3** | 等到勿扰结束 | 送达 05:32:01.9 | 结束后 **1.9 s** 送达；事项状态为 `due` | **PASS** |
| **A4** | 送达后不动通知，在应用内 `deleteItem` | 删除 05:32:05.5 → 消失 05:32:06.3 | **0.7 s** 内从通知栏消失；`removedDeliveredIds=[2098440493]`，`deliveredCleanupError=null` | **PASS** |
| **B5** | 勿扰关闭（用户基线），`RFX 复验保留丙`（通知 id `701794945`）送达后不做处理；手动调用 `syncNativeRemindersNow('b5-recheck')`，再回一次前台 | 送达 05:34:10.7 | 对账后 `removedDeliveredIds=[]`，通知**仍在**；冷启动后也仍在 | **PASS** |
| **B1** | `RFX 复验删除乙`（通知 id `1860032609`）送达后在应用内 `deleteItem` | 送达 05:34:10.1；删除 05:34:24.2 → 消失 05:34:24.8 | **0.7 s** 内消失；`removedDeliveredIds=[1860032609]`；同时在通知栏中的 B5 **不受影响**（顺带验证不会误撤） | **PASS** |
| **B1-冷启动** | `run-as kill -9`（pid 23295 → 27898）后冷启动 | 05:34:37 | B1 通知仍然没有；B5 通知仍在；归属索引在进程重启后仍保留 B5 的条目 | **PASS** |
| 清理 B5 | 在应用内 `deleteItem` B5 | 05:34:38.5 → 05:34:39.3 | 0.8 s 消失，`removedDeliveredIds=[701794945]`（额外又一次撤除样本） | PASS |

截图（截图时前台为本应用）：`raw/r3-after-cold-start.png`、`raw/r4-final-app.png`。本包通知记录段落：`raw/r3-a3-notif-pkg.txt`、`raw/r3-b-delivered-notif-pkg.txt`。

### 3.3 未重跑的项

A2、B0、B2、B3、B4、B6、B7、B8 按验收方的职责只审查了实施方的证据（`stepA-result.json`、`stepB-result.json`），没有重跑。这些证据的时间戳在内部是一致的（每项都是送达 → 操作约 3 s → 消失 1–2 s，`removedDeliveredIds` 与通知 id 对应），**采信**。B1 冷启动与 B6（进程重启后归属索引仍然有效）已经由本次 R3 的 B1 冷启动步骤独立覆盖。

## 4. 恢复与残留（`r4_final.py`、`raw/r4-final.json`）

- RFX 事项 0 条；本包通知栏中 RFX 通知 0 条；`getPending` 中 RFX 排程 0 条；本包 AlarmManager 中 RFX 闹钟 0 条；`attention-inbox-delivered-notif-index` 中没有 RFX 事项的条目。
- 用户设置读回：dnd=false，23:00–07:30，defaultDeliveryMode=alarm，与复验基线一致（其中 defaultDeliveryMode 由临时的 notification 恢复而来）。
- `kill -9` 冷启动后做 IDB 记录级快照，与 05:14 的复验基线比对：**`kv/state` 完全一致**，包括用户全部 6 条事项与全部设置（`settings` 没有任何差异，`review` 也没有变化）。`localStorage` 只有 `attention-inbox-delivered-notif-index` 有变化：里面是用户自己两条 07:30 事项的归属登记，属于正常行为，没有 RFX 条目。
- 不能恢复的变更：无。说明：用户自己在勿扰期间新建的两条事项将在 07:30 提醒，这是用户本人操作的结果（见 F2），与复验无关。

## 5. 实施方报告审查

| # | 问题 | 依据 | 严重度 |
|---|---|---|---|
| R-1 | 报告称「设置中仅 `alarmEventLog` 新增」，实际 `settings.ackExplained` 也从不存在变成了 `true`（B2/B7 首次「我知道了」写入的），报告没有列出这项差异，违反计划第 6 节第 3 条「其余差异逐项列出并解释」。**已修订**：已在该 README §6 中补充 | 实施方私有快照 `00-pre-install` 与 `06-final-after-cleanup` 的比对 | 低 |
| R-2 | 仓库内 README §3 写入了用户真实事项的**标题**，违反计划第 2 节第 6 条（仓库内只能有 RFX 事项字段和哈希）。**已修订**：标题已从 README 中删除 | `README.md` §3 | 中（隐私） |
| R-3 | README 称 B1「`kill -9` 冷启动后通知栏依旧无残留」，但 `stepB-result.json` 里没有冷启动的字段，没有证据支撑。**已修订**：原句已划掉并标注，改为引用本次复验的证据 | `raw/stepB-result.json` | 低（本次 R3 已独立补证 PASS） |
| 注 | `step6-cleanup-diff.json` 显示 `localStorage/attention-inbox-v2` 被修改，报告没有解释。经查，这是 IDB 的兜底镜像，只在 IDB 为空时才读（`lib/storage.js`）；测试后镜像里 dnd=false、IDB 里 dnd=true，说明镜像滞后。不影响行为 | 私有快照 | 信息 |

## 6. 新发现（PR #4 范围外，建议另开任务）

- **F1：闹钟方式的普通档没有被 PR #4 覆盖。** 用户现在的默认提醒方式是「闹钟」，普通档事项走的是原生 AlarmActivity 和 AlarmRingService，已送达的系统通知由 native 自己发出，不在 LocalNotifications 的撤除范围内。实施方的 B8 也观察到：响铃中在应用内删除事项，全屏界面和通知都不会撤掉。对这位用户来说，PR #4 的效果只在手动选「系统通知」的事项上才能看到。
- **F2：勿扰延后会永久改写 `triggerAt`。** `lib/app-items.js:153-156` 在勿扰时段内遇到到期的普通档事项时，会直接把 `it.triggerAt` 改成勿扰结束时刻。之后关闭勿扰，这些事项也不会恢复原来的时间（用户 01:14 新建的两条事项，直到现在仍排在 07:30）。原生层的 `effectiveTriggerAt` 是只在排程时换算、不改写数据，两层语义不一致。
- **F3（信息）**：devlib 里的 `pending_for` 只查 LocalNotifications；闹钟方式的事项必须从 AlarmManager 或 `scheduledAlarmIds` 查。今后的计划应该在开工前记录 `defaultDeliveryMode`，并写明应对办法。

## 7. 隐私合规

- 仓库内：哈希、RFX 事项字段、只含本包的通知记录段落（已核对：`raw/*.txt` 中 `pkg=` 只有本包，另有一条 `pkg=android` 是本包分组摘要的图标资源；标题和正文只有「安心收件箱提醒」、「闹钟正在响」以及 RFX 标题）、前台为本应用时的截图。
- 私有原始快照（未入库）：`/private/tmp/claude-501/-Users-qlyf-Developer-reminder/81649cad-1cd0-4829-b477-27edd29b8364/scratchpad/pr4-recheck-private/`。01:12 那一轮的私有目录在上一个会话的 scratchpad 里。
- 查看用户事项标题只是为了判断 5 条新事项的来源，只在终端里读取，没有写入任何文件。
- 没有向外部发送任何数据。

## 8. 文件

`devlib.py`（01:12 从 PR3 复验复制并已调整）、`r1_identity_and_leftover.py`、`r2_dnd_a1_a4.py`（作废轮）、`r3_recheck.py`、`r4_final.py`、`run.log`、`raw/`。
