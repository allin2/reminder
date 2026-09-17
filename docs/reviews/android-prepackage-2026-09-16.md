# Android 封装前代码审查（2026-09-16）

结论：建议先修复下列问题，再生成用于安卓验收的候选包。现有测试通过，不能据此判定原生提醒链路已可靠。

审查对象：`/Users/qlyf/Developer/reminder`，分支 `main`，HEAD `7972af7c516bb72040c82d62984384d59a1caae0`。开始时 tracked 文件干净，仅有既存未跟踪目录 `.workbuddy/`；本轮只新增此报告，不修改产品代码、依赖、配置、历史包，不提交或推送。

方法：主代理检查 JS 排程、状态与持久化调用，执行现有测试及无落盘 Node/VM 探针；Astra 顾问独立只读检查 Android 原生链路。历史记录仅用于确定检查方向，以下结论依据本轮源码与检查。

## 验证结果与边界

- `npm test`：unit **29/29**、native mock **69/69**、smoke **98/98**，共 **196/196** 通过。
- `git diff --check`：通过。
- 额外探针：复现 R1、R4、R5、R6、R7；未改变源码或新增测试文件。
- Android 静态审查：Manifest、Java、Gradle、桥接接口与官方 API 文档核对。R2、R3、R8 是源码确定性缺陷分析，**不是实机复现**。
- 本机发现 JDK 24，未发现 JDK 17、默认路径 Android SDK 或 PATH 中的 adb；当前没有 node_modules，Android assets 目录也不存在。未下载工具链、同步资源或运行 Gradle。
- **Gradle 编译、APK 安装、锁屏/休眠/进程回收/重启与真机交互：NOT_PERFORMED。**仓库既有 APK 未验证绑定当前 HEAD，不是本轮产物。
- README 的 smoke 96 项已落后于当前 98 项；报告不以旧验收计数代替当前结果。

## R1 · P1：恢复前台会重新打开用户关闭的通知总开关

位置：`app-core.js:3089`；用户关闭入口 `app-core.js:3732`。

触发：系统通知权限已授予 → 用户在应用内关闭本地通知 → 切后台后回到应用。`onResume` 只要看到权限 granted，就把 `state.settings.notify` 写回 true，并保存、重排提醒。用户的停止通知意愿因此失效。

证据：使用现有 smoke 的 VM 环境，注入权限与生命周期 mock，执行真实 `initializeNativeReminders` 和回调。输入 notify=false，输出 `user disabled notify; after resume: true`。

建议：把系统权限状态与用户主动开关分开存储；恢复前台只刷新能力，不自动启用用户关闭的开关。若要处理首次授权后的启用，应绑定明确的授权操作上下文。

复测：主动关闭后，后台恢复、权限设置返回、重启应用均保持关闭且排程为空；主动开启仍正常工作。

## R2 · P1：第二条全屏闹钟会复用第一条事项的数据

位置：`android/app/src/main/AndroidManifest.xml:31`、`android/app/src/main/java/space/alliswell/inbox/AlarmActivity.java:70`。

`AlarmActivity` 为 singleInstance，只有 onCreate 读取 Intent，没有 onNewIntent；按钮闭包捕获第一次的 finalItemId。当 A 闹钟窗口还在时 B 到达，或点击 B 的通知复用现有窗口，界面和按钮仍对应 A。可能漏掉 B，并对错误的事项执行确认或完成。

Android 对该模式的复用请求通过 onNewIntent 交付，见[官方 Activity 启动模式说明](https://developer.android.com/guide/topics/manifest/activity-element)。

建议：统一当前 Intent 的绑定过程，onNewIntent 调用 setIntent 并更新展示和动作目标；明确多条闹钟的保留/排队策略，避免更新 B 时丢掉 A。

复测：A 未关闭时 B 到达、连续点击不同事项通知；每个按钮只操作当前展示事项，另一事项仍可处理。实机 NOT_PERFORMED。

## R3 · P1：最低 Android 版本与无保护 API 调用不匹配

位置：`android/variables.gradle:2`、`android/app/src/main/java/space/alliswell/inbox/SystemBridgePlugin.java:140`；同类调用还有 `AlarmScheduler.java:17` 与 `AlarmTestReceiver.java:40`。

工程 minSdk=22，但启动 diagnose 必经路径无保护地调用 API 23 的 getSystemService(Class) 和 API 24 的 areNotificationsEnabled()。Android 5.1/6.0 缺少相应方法，会触发 NoSuchMethodError；catch(Exception) 不能兜住这种 Error。

API 等级依据：[Context 官方 API](https://developer.android.com/reference/kotlin/android/content/Context)、[NotificationManager 官方 API](https://developer.android.com/reference/android/app/NotificationManager)。

建议：用字符串 service lookup 或兼容库，并采用 NotificationManagerCompat 查询通知状态。只有明确调整产品支持范围时才提高 minSdk。

复测：API 22/23 启动、权限诊断、排程、响铃、撤销；执行 Android Lint 检查其余 NewApi 调用。实机 NOT_PERFORMED。

## R4 · P1：整理窗口开始后对账会撤掉当晚剩余补提醒

位置：`lib/native-reminders.js:300`。

buildReviewDesired 只要当天窗口起点已过，就把锚点移到明天，再生成三次排程，没有保留今天尚未到时的补提醒。reconcile 将它们视为陈旧排程撤销。窗口内恢复前台或任何保存引发对账都可触发。

Node 探针（2026-09-16，窗口 21:30、间隔 60 分钟、补充两次、勿扰关闭）：

```text
21:25 计算：09-16 21:30、22:30、23:30
21:35 计算：09-17 21:30、22:30、23:30
```

建议：以稳定的整理会话日期生成当天完整槽位，再过滤已过去/已消费/被抑制的槽位；按需补下一天。稳定事件身份不应依赖过滤后的数组下标。

复测：窗口起点前后、每次补提醒前后恢复前台，当晚未执行槽位仍保留，已执行槽位不重复；覆盖跨日勿扰顺延。

## R5 · P1：关闭整理功能后，遗留待整理事项失去安卓后台提醒

位置：`lib/native-reminders.js:213`；对照 `app-core.js:1105` 的 promoteDue。

Web 生命周期仅在 Review 开启时跳过 NEEDS_REVIEW；原生 buildDesired 却无条件跳过。关闭 Review 后，整理排程也不再生成，因此这些事项两种原生投影都没有。

证据：对未来一小时、waiting、normal、NEEDS_REVIEW 的事项，传入 notify=true、review.enabled=false，buildDesired 返回 0 条。

建议：原生投影与真实生命周期使用相同的 Review 启用条件，保证关闭整理后按普通事项排程。

复测：关闭整理前后检查待整理事项的原生 pending，并在后台验证到时提醒；恢复开关时避免两套排程重复。

## R6 · P1：截止保护在最后 24 小时内每次对账生成新的即时提醒

位置：`lib/native-reminders.js:242`。

当 deadlineAt-24h 已过去且截止尚未到，代码把投递时间设为 now+2000。时间又参与 scheduleKey 和 ID，任何后续对账都会生成另一条两秒后的提醒。没有保护事件已消费的记录，已确认事项同样命中。

证据：同一 acknowledged 事项，截止还有 12 小时，间隔 15 秒分别调用 buildDesired：首次 ID=1975456327、时间=首个 now+2000；再次 ID=1220614957、时间=首个 now+17000。这两个调用模拟两次对账，不表示应用无条件每 15 秒对账。

影响：频繁返回应用、保存其他数据可反复触发通知；若对账快于两秒，则可不断撤旧排新而推迟投递。

建议：为每个截止保护阶段建立稳定事件身份与已排/已触发记录，补发仅针对尚未消费的保护事件；保持保护与普通 ACK 独立，不能简单用 ACK 禁掉所有保护。

复测：首次排程、送达后多次恢复/保存、ACK 后进入保护阶段、修改截止日期，各阶段只按既定策略通知。

## R7 · P2：撤销失败仍清空闹钟台账，失去后续重试依据

位置：`lib/native-reminders.js:344`、`:377`，回写点 `app-core.js:2685`。

reconcileAlarms 吞掉 cancelAlarm 异常，但最终无条件返回 ids=wanted。上层持久化该集合后，撤销失败的旧 ID 消失。下一次对账不再知道要撤它，留下幽灵闹钟；排程失败也被吞掉，状态缺少错误信息。

证据：mock cancelAlarm 抛错，输入 scheduledAlarmIds=[123]、desired=[]；实际返回 `{available:true,cancelled:0,scheduled:0,ids:[]}`。

建议：保留撤销失败 ID 并记录错误，仅在确认撤销成功后移除；区分计划、已成功排程和待重试。必要时从原生持久化台账读取实际状态，而不只信 JS 台账。

复测：撤销失败后成功重试、排程失败、原生成功但 JS 持久化失败及重启恢复，不丢失清理依据、不显示虚假成功。

## R8 · P2：全屏闹钟完成后仍可从残留通知重新响铃

位置：`android/app/src/main/java/space/alliswell/inbox/AlarmTestReceiver.java:101`、`AlarmActivity.java:124`。

Receiver 总会发布直接打开 AlarmActivity 的通知；全屏窗口的四个出口都不取消该通知，cancelAlarm 也只撤排程。setAutoCancel(true) 不会因另一个窗口中的按钮动作自动撤通知。完成后点旧通知，Activity 新建时仍会无条件播放声音，没有检查事项已经完成。

建议：全屏动作完成时清理当前已投递通知；删除/完成事项时同时清理对应通知。旧入口再次进入时验证有效状态，避免恢复无效闹钟。

复测：四个出口后的通知栏状态，完成后点击旧通知不得再次响铃或重复创建周期事项。实机 NOT_PERFORMED。

## 修复与封装顺序

1. 优先修 R1–R6，并补实际生命周期、时钟推进与多闹钟场景回归；同时修 R7/R8 的清理和失败重试。
2. 复跑现有测试及新增回归，在有 JDK 17/SDK 的环境安装锁定依赖、同步 Web/Capacitor 资源，执行 Gradle 编译及适当 Lint。
3. 生成绑定本次源码与哈希的新候选，验证首次安装/升级、权限拒绝和授予、锁屏、Doze、进程回收、重启、连续闹钟与通知动作。

附加待验证风险：全屏动作使用单个 lastAction/lastItemId 槽位，并在 JS 持久化前消费删除，连续动作或消费中崩溃可能丢操作。未做故障注入，未计入上述已确认八项；建议后续验证事件队列与确认机制。
