# 四阶段提醒/闹钟独立验收

日期：2026-09-19。结论：**FAIL / FIX_REQUIRED**。不能认可“四阶段全矩阵通过、100% 完成”的 Walkthrough 结论。

## 范围与版本

- 合同：`docs/handoff/2026-09-19-reminder-alarm-implementation.md`，保留原 A1–R1 编号及场景，不以实现者重新命名的用例替代。
- 实际 checkout：`/Users/qlyf/Developer/reminder`，分支 `main`，HEAD `8d1c2617cff3aac5c4450a949c9044b79f63a673`；产品改动尚未提交。
- 本轮只审查、运行现有测试与隔离 JS 反例、读取设备身份及包哈希；仅新增本报告及配套独立 probe 文件。没有修改产品、重装 APK、变更权限、重启或改时改区；没有提交、推送或 PR。
- 源码定位行号以本轮未提交工作区为准。JS 反例是实际生产函数 + 平台 mock，不冒充 Android 实机复现。

## 已核实成立的部分

1. `npm test` 本轮退出码 0；native 子套件 284/0、regression 子套件 574/0。574 是最后一个子套件的计数，不是整个 npm test 的总数。
2. `git diff --check` 通过。
3. 两个本地 APK 和设备当前 `base.apk` 的 SHA-256 均为 `f453fd8afdddf9b64c0c9ce7ca8cb01cdcd1bab0f9a08155b367d643280a16e1`。设备为在线 vivo V2238A，serial `10ACBF2D3D000RS`。
4. APK 中 `assets/public/app-core.js`、`assets/public/lib/native-reminders.js` 与当前两个源码文件逐字节哈希一致。本轮未重新编译，也未独立证明全部 Java 源码与 DEX 的构建对应关系。
5. A 阶段确有通知权限分流和 LocalNotifications 缺失隔离的 JS mock 行为测试；不能因此断言真实表单→后台→到点声振已验收。

## 阻断问题与修复要求

### F1 / P1：时间语义被覆盖，时区恢复产生错误时刻

- 位置：`lib/native-reminders.js:655–665`；`SystemBridgePlugin.java:160–170,199–211`。
- 所有闹钟载荷固定 `scheduleBasis: "wall-clock"`，`localTrigger` 使用 `toISOString()`（UTC），忽略事项的 elapsed 语义。原生解析只截取日期和时分秒，再按设备当前时区构造 Calendar，忽略 Z。
- 本轮实际 reconcile 反例：输入 `scheduleBasis:"elapsed"`，桥接收到 `"wall-clock"` 和带 Z 时间串。
- 示例：上海本地 08:00 的载荷为 00:00Z；换时区后代码按新时区的 00:00 恢复，而不是 08:00。可能提前、漏响或被当成过期删除。TIME_SET 分支也未实现 elapsed 剩余时长校准。
- 要求：从权威事项保留时间依据，墙上时间传无时区本地日历字段；elapsed 使用同次开机单调截止点并定义跨重启恢复策略，补生产载荷、改时、改区行为测试。

### F2 / P1：在途删除丢失已发生的原生副作用，留下幽灵闹钟

- 位置：`app-core.js:3884–3905`；`lib/native-reminders.js:597–605`。
- 旧轮 bridge 已排程，但业务版本改变后整份返回台账被丢弃。下一轮只从 settings 中寻找待撤销 ID，因新排的 ID 没有被记住，无法取消它。
- 独立 probe 提取未修改的 `syncNativeRemindersNow()`，阻塞桥调用→删除事项并推进版本→释放旧轮。观察：`runs=2, items=0, ledger=[], schedules=1, cancels=0`。
- 要求：业务消费记录不能接受过期结果，但平台已成功执行的副作用必须独立跟踪并补偿；补在途删除、改期、完成以及补跑期间再次修改的行为测试。

### F3 / P1：迟到的旧投递仍会停止或抢占新闹钟

- 位置：`AlarmRingService.java:279–283,467–500,700–703`。
- B 正在响时，迟到的已 STOPPED/AUTO_SILENCED 的 A 进入 `onStartCommand`，终态分支调用无身份限定的 `stopSelf()`；销毁收口 `stopRinging()` 会停止当前 B。
- `STATE_REPLACED` 未被 `isDeliveryTerminated()` 视为终态。A 被 B 替换后，迟到 A 可以越过终态检查，把 B 标记为 REPLACED，再把 A 的状态改回 RINGING。
- 要求：无效旧事件仅丢弃，不停止当前其它投递；REPLACED 必须不可由迟到事件复活。覆盖 A→B→迟到 A、已静音 A→B→迟到 A 的原生行为测试。
- 证据级别：可执行源码路径审查；本轮未对设备注入上述干扰场景。

### F4 / P1：普通残留通知清理仍暗含全局停铃

- 位置：`ActiveAlarmStore.java:81–84,105–138`；`AlarmRingService.java:412–444`。
- `cancelNotification(context,A,false)` 调用 `stop(context,A,null)`；token 为空绕过未命中台账检查，最终仍调用无身份的全局 `requestStop(context)`。因此“新增 stopAll”并没有消除旧隐式全停路径。
- 要求：普通清理必须解析并限定目标投递，找不到 A 只清 A 通知，不能停止 B；全局操作仅保留显式独立入口。测试 tracked/untracked、null/旧 token、相同/不同 ID 组合。
- 证据级别：源码路径；本轮未在设备上停止用户的闹钟。

### F5 / P1：首次解锁前恢复缺失

- 位置：`BootRestoreReceiver.java:40–47`。
- 收到 LOCKED_BOOT_COMPLETED 且用户未解锁时直接 return。搜索原生源码无 `createDeviceProtectedStorageContext`，未实现合同要求的 device-protected 最小计划镜像。Manifest 的 `directBootAware` 不能替代恢复实现。
- 要求：落实最小、不含私密正文的镜像和锁定启动执行链；解锁后权威对账。设备重启/首次解锁前验证仍为 NOT_PERFORMED。

### F6 / P1：差量缓存阻断冷启动修复，forceRebuild 没接入口

- 位置：`lib/native-reminders.js:639–652`；`app-core.js:3884`。
- `forceRebuild` 仅存在于底层参数判断，无生产调用方传入。持久化 ID/签名会在新的 JS 生命周期中被直接当作有效系统排程证据。
- 独立 probe 重置 JS 状态、使用新的空原生 mock、恢复旧 settings：底层 schedule 次数为 0。系统排程已丢失但镜像仍在时无法修复。
- 要求：接通明确的生命周期重建入口，不把本地镜像当作系统队列证明；失败时保留可重试状态。

## 其它必须补齐的缺口

- **B 持久化/跨重启**：`AlarmRingService.java:211–220,228–270` 持久化 elapsed 截止时间但无 boot identity；恢复读取后直接复用。`saveDeliveryRecord` 仍用 apply 并吞异常，未提供合同要求的写入确认/失败策略。这些不应因出现 elapsedRealtime 字符串就判通过。
- **C4 日志**：`AlarmTrace.java:35–61` 全局裁剪直接丢弃最早事件，不区分关键生命周期；单 token 全为关键事件时不丢任何项，上限 25 也不成立。连续重复事件虽然聚合，仍每次重写 JSON。需要“关键首末事实保留 + 普通事件洪泛”行为测试。
- **D3 失败重试**：`SystemBridgePlugin.java:182–193` 某条 schedule 抛错后未加入 kept，最后用 kept 覆盖镜像，失败计划被删除，后续原生恢复无法重试。需区分无效/过期和暂时失败，不因一次失败永久丢计划。

## 原合同验收矩阵

FAIL 表示发现反例/明确合同冲突；NOT_PERFORMED 表示缺该场景执行证据。两者可同时存在于同一项不同证据层。

| 编号 | 覆盖状态 | 本轮判定及缺口 |
|---|---|---|
| A1 | partial | JS 分流 PASS；通知拒绝真实表单→退出→声振/屏幕场景 NOT_PERFORMED |
| A2 | partial | 权限逻辑有修改；先排再撤权限的实机场景 NOT_PERFORMED |
| A3 | partial | 部分桥/LN/开关 mock 通过；整机隔离与幽灵排程未完整验证 |
| B1 | divergent | FAIL：F4；错 token 单次回报不能证明残留清理隔离 |
| B2 | divergent | FAIL：F3 及跨生命周期缺口；原生迟到/静音完整行为 NOT_PERFORMED |
| B3 | divergent | FAIL：F3；fallback/替换组合实机 NOT_PERFORMED |
| C1 | partial | 差量及串行结构存在；原合同 100 次并发行为矩阵未提供 |
| C2 | divergent | FAIL：F2 已用实际生产函数和受控 bridge 复现 |
| C3 | divergent | FAIL：F2/F6；完整持久化失败/进程中断矩阵 NOT_PERFORMED |
| C4 | divergent | FAIL：日志边界与关键事件保护存在上述缺口 |
| D1 | divergent | FAIL：F1；改系统时间/时区的实机 NOT_PERFORMED |
| D2 | missing/partial | FAIL：F5/F6；锁定启动最小镜像 missing，其余恢复 partial |
| D3 | partial | 有过期过滤/逐项 try-catch；失败项丢失重试，真实关机/故障矩阵 NOT_PERFORMED |
| R1 | partial | 既有业务 Node 回归 PASS；新候选全场景实机 NOT_PERFORMED |

## 真机证据审计

归档 `docs/reviews/verification-runs/20260919T043405Z-device-verify/report.md` 的确为 PASS 25 / FAIL 0 / WARN 1 / SKIP 0，运行约 27 秒。该结果是 **INHERITED_EVIDENCE**：本轮检查原始归档，没有重跑 live 写入套件。

- A/B 项主要是连接、ADB、文件和日志通道；F11 是普通通知 schedule/cancel 往返；F12 是存储写入/恢复。
- F03 权限项为 WARN；POST_NOTIFICATIONS 为 true，不能证明“通知拒绝”场景。F08 原生计划镜像 entries=0。
- 未包含原合同的改时、时区、未解锁启动、5 分钟自动静音后重入、B 正在响时清理 A、在途变更矩阵。
- 报告列举的额外三项 CDP 检查即使成立，也只证明字段写入及两个 stop 请求回报；未给出足以建立上述完整投递关系的逐场景原始证据，不能外推为全流程验收。
- 当前已安装 APK 哈希由本轮只读设备命令重新核实，属当前证据；用户实际听到/看到/停止效果未由该哈希证明。

## 测试覆盖误报

`test-native-reminders.js:1609–1638,1679–1708` 的新增 B/D 用例主要是源码正则，例如匹配 `isDeliveryTerminated`、`elapsedRealtime()`、`directBootAware="true"`，甚至匹配注释 `unacknowledged, no ACK`。R1 还要求源码含固定 `scheduleBasis:"wall-clock"`，恰好容纳了 F1。

实现报告 C2 改成“无变化差量”、C3 改成“修改后重排”，与原合同 C2 在途修改删除、C3 故障注入不是同一场景。应恢复原编号对应关系，补行为反例，撤回“全矩阵通过/100% 完成”的结论。

## 可复现检查与回交条件

运行：`node docs/reviews/reminder-alarm-independent-probes-2026-09-19.cjs`。

当前观察：

```text
TIME_BASIS       expected=elapsed actual=wall-clock
COLD_REBUILD     expectedScheduleCalls=1 actual=0
INFLIGHT_DELETE  runs=2 items=0 ledger=[] schedules=1 expectedCancels=1 actualCancels=0
```

脚本退出码 0 仅表示探针执行完成；输出中的 expected/actual 差异才是失败证据。该脚本复用当前测试的环境工厂，直接调用真实 reconcile，提取真实 sync 函数；隔离 UI、持久化和平台 I/O，不是完整 App/Android 集成测试。

下一轮先修 F1–F6 和上述恢复/日志缺口，再补原编号行为测试，运行必需检查并重新构建新候选；新 APK 使用新哈希及独立设备 run，旧证据不能沿用为新候选 PASS。涉及重启/改时/撤权限的场景按设备授权执行。未执行项继续明确 NOT_PERFORMED，不能用正则或桥成功回报替代。
