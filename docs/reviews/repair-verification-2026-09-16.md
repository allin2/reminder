# 两份审查建议的修复复核

结论：**部分修复，不能标记全部完成，也不建议据此进入正式安卓验收。**存在新的全屏闹钟回归，以及原有截止、周期、Review 和旧通知校验未闭环的问题。

## 对象与方法

- 对照 `android-prepackage-2026-09-16.md` 的 R1–R8、`business-logic-2026-09-16.md` 的 L01–L08 与恢复归档附项。
- 对象为 `main@7972af7c516bb72040c82d62984384d59a1caae0` **之上的未提交工作区**，不是该提交本身已经修复。开始时 11 个 tracked 文件有修改，另有 `.workbuddy/`、两份原报告和修复决策文档未跟踪。
- 主代理直接审查 diff、真实入口与新测试；使用现有 smoke 的 VM/DOM harness 和假时钟做无落盘探针；未修改产品代码或已有测试。
- 本轮 `npm test`：unit 29、native 89、smoke 129，共 **247/247 通过**；`git diff --check` 通过。
- 只发现 JDK 24，默认 SDK 路径不存在。Gradle/Lint、APK、浏览器 GUI、安卓真机均 **NOT_PERFORMED**。缺依赖的 javac 输出不能代替 Android 编译通过。
- D26/D27 已存在于工作区决策文件；本轮按其陈述核对实现，不把文档存在视为已核实用户批准，也不自行修改产品决策。

## 必须继续修正的发现

### V01 · P1 · 新回归：首次全屏窗口不启动循环声与震动

`AlarmActivity.java:99` 的 onCreate 仅执行 bindIntent，bindIntent 只更新 UI/时钟。启动效果只在 `onNewIntent:115` 中调用。第一次创建窗口不会进入 startAlarmSound/startVibration。通知渠道可能仍发出一次提示音，但它不等于全屏闹钟循环响铃。

这是 R2 拆分绑定函数引入的源码确定性回归，未实机验证。修复应让初次创建与重入都通过统一入口启动效果，并分别验证首次/第二条/停止效果。

### V02 · P1 · 新回归：全屏动作版本号写 String、读 int

`AlarmTestReceiver.java:37,68,108` 以 String 读取并向 Activity 写入 itemRev；`AlarmActivity.java:124` 用 getIntExtra 读取。类型不匹配，读不到正确版本，默认成为 0。事项 `normalizeItem` 默认 rev=1，`handleAlarmAction` 会拒绝该版本。

已执行 JS 后半链探针：新事项 rev=1，传入原生错误读取后的 done/rev=0，事项仍为 due，操作未生效。Java 类型链为静态证据，未用 Android 运行时复现。依据 [Android Intent API](https://developer.android.com/reference/android/content/Intent)：typed extra getter 需要匹配相应类型。

此外 `persistAlarm` 和开机恢复、AlarmScheduler 的稍后重排没有保存/传递 rev，重启恢复后的动作也缺完整版本链。应统一类型并覆盖正常排程、稍后、持久化、恢复、Activity、JS 全路径。

### V03 · P1 · R6/L02 未完成：已送达后仍重复排；第二阶段不预排

`lib/native-reminders.js:277` 仍只生成 deadline-24h 一个保护时刻。固定 ID 只避免 pending 中已有通知时重复创建，没有记录原生送达消费。

mock 对账实测：第一次 schedule 后模拟系统送达，将 pending 清空；15 秒后再次 reconcile，同 ID 被安排到新的 now+2s。故“ID 稳定”并不意味着“送达后不重复”。

另把 p24 标为已消费、截止还有 12 小时，buildDesired 返回 **0 条**截止排程，未预排 p2。用户 ACK 后进入后台且不再打开 App，2 小时保护点没有独立未来排程。p24/p2 还共用 protectAt 身份，未真正按阶段分开原生执行。

应为每个保护阶段预排稳定事件，结合原生送达/动作和持久化消费状态对账。补测必须跨越 pending 已消失、ACK 后后台到 p2，而非只比较两次 buildDesired 的 ID。

### V04 · P1 · L03 未完成：ACK 后完成会停止整个重复，月末仍有死循环日期

ACK-based 实测：ACK 将同一条事项改成 waiting 并设下一期；随后 completeItem 将这同一条归档，又因 ackAdvancedAt 不创建下一条，**活跃实例为 0**。界面却仍提示下一周期已生成。`app-core.js:1314,1360`。

月末实测：原定 `2026-01-31 09:00`，calendar/monthEnd 的 nextRepeatTrigger 不传 fromTs（与真实完成入口一致），返回仍是 **2026-01-31 09:00**。`lib/repeat.js:89` 先拿 10:00 与锚点比较，最后换回 09:00，未保证结果严格晚于原期。

新测试 `test-smoke.js:584` 只检查“完成后条目数量没增加”，恰好允许“下一期也被归档”的错误通过。应检查仍有一个有效下一期，并使用真实完成入口验证 09:00 月末、迟到完成、连续多个周期。

### V05 · P1 · L04 部分修复：正常编辑不增版本，旧动作仍覆盖新安排

`app-core.js:2578` 起的 editing 保存分支没有 bumpRev。探针通过真实 saveItemFromForm 将事项改到 10 月 1 日，rev 仍为 3；随后传入旧通知 done/itemRev=3，事项被归档。

因此终态保护确实修好了“已归档被旧 ACK 复活”，但“编辑后旧通知失效”未修。还应让排程匹配包含版本：当前 scheduleKey 不含 rev，某些只增加 rev 而不改变时间/标题的操作会让 pending 保留旧版本，反而拒绝后续有效按钮。

### V06 · P1 · L01/L05 部分修复：前台、首页、原生使用三种兜底判定

- `app-core.js:1209` 对 isFallbackSuppressed 直接 return，仍跳过其截止保护。带 1 小时后 deadline 的兜底记录，执行 promote/render 后仍 waiting，deadlineStageKey=null。
- `app-core.js:1605` 移除了原来的首页过滤，isDue 又只看 triggerAt。已过期兜底即使仍 waiting，**出现在“需要注意”**。探针已复现。
- Review 确认后 `markReviewDone` 写 REVIEWED，却保留 isFallbackTrigger=true。原生 `lib/native-reminders.js:243` 只抑制 NEEDS_REVIEW+fallback，所以确认后的兜底会排出 primary；前台按 fallback 一律抑制。探针输出 REVIEWED、native primary=[primary]。

手选时间优先已补上，但时间来源/首页/截止/Review 确认的完整契约仍未统一。应让抑制仅作用于兜底的普通提醒，不阻断截止保护；首页与原生共用同一判断；无明确时间的整理确认不能变成原生正式提醒。

### V07 · P1 · L06 部分修复：“今天跳过”仍排当晚通知

独立 Review action type 和 30 分钟标签已修正，但 buildReviewDesired 没有读取 skippedUntil。探针设置 skippedUntil=次日21:30，在当日21:35仍生成当晚22:30/23:30排程（勿扰关闭）。默认勿扰开启时仍会保留22:30。

`test-smoke.js:672` 只断言 skippedUntil>now，未断言原生投影清空当前场次。应验证按钮后实际 pending 撤销，以及稍后期间是否仍残留早于约定时间的常规槽位。

### V08 · P2 · R7 部分修复：错误只放入字段，界面仍显示精确就绪

取消失败保留 ID 与重试成功后移除的测试通过。但 `lib/native-reminders.js:650` reliability 仍仅来自权限，errors 有内容也可能为 exact；app-core 的界面读取 reliability，不呈现这些失败项。

应让实际排程失败改变用户可见状态，并区分权限可用与本次排程成功。不能仅增加 errors 字段就认定“失败已告知用户”。

### V09 · P2 · 动作队列仍不具备崩溃恢复保证

`SystemBridgePlugin.java:139` 仍在返回给 JS 之前移除队首。FIFO 能解决连续写入覆盖，但不能解决“已取出、JS 尚未落库时崩溃丢动作”。工作区决策文档第8条声称避免消费中崩溃丢操作，超过代码证据。

应采用事件 ID、读取后保留、JS 成功持久化后确认删除。JS 目前每次回前台/启动只取一条，也应验证积压队列能完整排空。此项为静态链路结论，崩溃故障注入 NOT_PERFORMED。

## 原报告逐项状态

“通过”均限制在下列证据层，不代表安卓真机 PASS。

| 原编号 | 本轮结论 | 依据/剩余 |
|---|---|---|
| R1 | 源码层修复 | 恢复前台及诊断自动开启 notify 的分支已移除；完整设备生命周期未验 |
| R2 | 部分修复，伴随新回归 | onNewIntent 重绑已加；V01/V02 阻止原生链路结项 |
| R3 | 已修复所列 API 调用，待构建 | 改字符串 service lookup 与 NotificationManagerCompat；API22/23/Lint 未验 |
| R4 | 原复现通过 | 21:35 保留当晚槽位且 ID 稳定；Review整体仍受 V06/V07 影响 |
| R5 | 原生投影原复现通过 | 关闭 Review 后原生可排兜底；V06 是相关未闭环 |
| R6 | 未通过 | V03：送达后的对账重排、p2 未预排 |
| R7 | 部分修复 | 失败台账重试通过，用户可见失败状态未完成，见 V08 |
| R8 | 源码部分修复，设备未验 | 四出口取消通知及对账取消通知已接入；旧 Intent 进入仍无有效状态校验，原生链路受 V01/V02 影响 |
| L01 | 部分修复 | 手选时间保存通过，首页/截止抑制不一致，见 V06 |
| L02 | 前台原复现通过，跨端未完成 | 同阶段先 promote 后 ACK 不再立刻反弹；原生保护见 V03 |
| L03 | 未通过 | V04；停止重复只清当前 repeat，不符合基线“终止并归档”，也没有系列身份保证 |
| L04 | 部分修复 | 重复 done/终态保护通过；编辑版本和原生传递见 V02/V05 |
| L05 | 部分修复 | 逐条“留着待整理”已加；确认兜底后原生仍排正式提醒，见 V06 |
| L06 | 部分修复 | 标签与30分钟一致；今天跳过不撤原生排程，见 V07 |
| L07 | 默认勿扰原复现通过 | 默认第三档被过滤；D26 只限制因勿扰顺延越窗，与“窗口硬边界”并非完全同义，勿扰关闭时仍可23:30 |
| L08 | 稍后/再提醒原复现通过，编辑缺口 | snooze/reopen 重置轮次；普通编辑改期分支未重置 remindCount/lastAlertShownAt，不能扩称所有改期均已统一 |
| 恢复归档附项 | 函数层通过 | deadlinePaused 阻止投影、可显式恢复；UI真实点击未验，D27授权来源本轮未核实 |

## 建议下一轮

优先 V01/V02（真实闹钟入口）→ V03/V04/V05（时间与动作）→ V06/V07（Review）→ V08/V09（失败可见与恢复）。保留已通过的回归，新增跨入口/跨阶段/送达后状态的断言，避免用字段存在或条目总数代替行为。完成后运行有依赖的 Android 构建与实际设备验证。

本报告不修改两份原始报告，以保留原问题与本轮复核的证据关系；没有修改、提交或推送产品代码。
