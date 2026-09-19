# 四阶段返工独立复验（第二轮）

日期：2026-09-19。结论：**FAIL / FIX_REQUIRED；局部修复成立，但不能全矩阵验收通过。**

本轮使用 prd-code-gap-delivery 的需求追踪和证据分级方法：仍按原交接合同判定，不接受用 payload 字段、源码正则、冷进程测试替代改时和首次解锁前行为。仅新增本报告及时间格式反例脚本；未修改产品代码、既有证据、设备权限或系统时钟，未提交/推送/重装。

## 版本与已经确认的改进

- 分支 `main`，HEAD `8d1c2617cff3aac5c4450a949c9044b79f63a673`，实现仍为未提交工作区差异。
- 本地两个 APK 及本轮在线设备 `base.apk` SHA-256 均为 `7bcb566355989fa9b73b6f776567c4b0d1c48ab243404347f71326c85db80851`。
- APK 内 `app-core.js`、`lib/native-reminders.js` 与当前源码哈希一致。未重新构建，也未独立证明所有 Java 源与 DEX 一致；APK 身份相同不等于“所有当前源码 100% 对应”。
- 本轮 `npm test` 退出码 0：native 子套件 285/0，最后的 regression 子套件 574/0。574 不是 npm test 全部子套件总数。`git diff --check` 通过（不是语法检查）。
- 原独立探针本轮重跑：TIME_BASIS=elapsed、COLD_REBUILD=1、INFLIGHT_DELETE 实际 cancel=1；上轮三个具体 JS 反例已修复。
- F3：REPLACED 已纳入终态，旧终态 Intent 遇正在响铃的服务不再直接全停。F4：untracked/null 残留清理不再无身份停声。源码路径修复成立；原生生命周期组合仍缺行为测试。
- F5 新增 DE 最小镜像；F6 冷启动/实验室 forceRebuild 已接入；恢复单项调度异常也已保留在 kept。这些是实质进展，不代表整条恢复链通过。

## 仍然阻断的代码问题

### R2-01 / P1：正常表单产生分钟格式，原生恢复只接受秒格式

位置：`app-core.js:94–99,3336`；`lib/native-reminders.js:654–662`；`SystemBridgePlugin.java:309–310`。

真实表单保存的 `toLocalInput()` 输出 `YYYY-MM-DDTHH:mm`（16 字符）。本次桥接优先原样沿用 `item.localTrigger`，不会统一补秒。原生 parser 遇长度小于 19 直接返回旧 triggerAt。因此正常创建的墙上时间提醒在时区变更后保持旧绝对时间，违反本地日历语义。

本轮提取实际 JS 格式函数、实际 reconcile 和实际 Java parser，在 JDK 17 执行：上海 08:00 → 东京时区。分钟格式结果仍为 `00:00Z`，正确应为 `23:00Z`（东京 08:00）；带秒对照组能得到正确值。设备时间没有改变。

可复现：`node docs/reviews/reminder-alarm-rework-time-probe-2026-09-19.cjs`。输出 expected/actual 才是判断依据，脚本退出码只代表运行完成。

要求：统一输入格式或兼容分钟与秒；从真实表单保存到原生恢复端到端验证，不能仅构造本来就是 19 字符的测试数据。

### R2-02 / P1：elapsed 仍只有标签，原生未实现经过时长恢复

位置：`SystemBridgePlugin.java:95–108,213–234,264–290,818`；`AlarmScheduler.java:76–106,177–182`。

计划仅保存墙钟 triggerAt 和 basis/localTrigger 等字段，没有该计划的 elapsed 截止点及跨启动恢复锚点。恢复仅对 wall-clock 且 TIMEZONE_CHANGED 的情况换算；TIME_SET 下 elapsed 仍使用旧墙钟 triggerAt，排程载体仍为 AlarmClock/RTC_WAKEUP。

例如设置 1 小时后响，经过 10 分钟将系统时间调快 2 小时：剩余应为 50 分钟，代码却会把旧 triggerAt 判过期并剔除；回拨则可能推迟。JS payload 从 wall-clock 改为 elapsed 只修好了传参，不等于实现了原合同 D1。

要求：实现同次开机内基于单调时钟的剩余时长换算，并定义跨重启、关机跨过目标的恢复政策；覆盖前拨/回拨/时区变更。本轮只核对代码，设备改时验证 NOT_PERFORMED。

### R2-03 / P1：Direct Boot 仅恢复注册，投递载体仍不能在首次解锁前运行

位置：`SystemBridgePlugin.java:230–234`；`AlarmScheduler.java` 的 broadcast/service PendingIntent；`AndroidManifest.xml:57–59,80–83`。

DE 恢复依然投递到 `AlarmTestReceiver` 和 `AlarmRingService`，这两个组件都未声明 directBootAware；AlarmActivity 同样未声明。合并后的 debug Manifest 也相同。仅给 BootRestoreReceiver 标记不能让后续组件自动获得 Direct Boot 可运行资格。

Android 官方明确要求参与 Direct Boot 的组件注册为 encryption-aware，默认组件不会在此阶段运行，并且需要通过 DE context 访问必要数据：[Direct Boot 官方文档](https://developer.android.com/privacy-and-security/direct-boot)。这说明问题不只是“还没真机测”，而是执行链配置缺口。

修复不能只加清单属性：还需审计响铃/投递/停止/追踪链的默认 CE SharedPreferences 访问，并保证解锁前使用安全镜像。用户已解锁后杀进程（cold）并不是重启后首次未解锁（Direct Boot）。整机重启场景仍为 NOT_PERFORMED。

### R2-04 / P2：bootTimeMs 不是稳定开机会话标识，改时会误判重启

位置：`AlarmRingService.java:222–241`。

记录和读取都使用 `System.currentTimeMillis() - elapsedRealtime()` 作为 bootTimeMs，以相差超过 10 秒判重启。同次开机调整墙钟超过 10 秒就满足该条件；随后进程重建加载 RINGING 记录会误标 STOPPED / terminated-on-reboot，拒绝合法恢复。旧记录缺少 bootTimeMs 时又直接接受旧 elapsed 字段，缺少迁移时的可靠判断。

要求：用不会随用户改时改变的启动身份，定义旧 schema 和不确定状态处理；加入同 boot 改时+进程重建、真实重启、旧记录迁移的行为测试。此项为源码推导，未在设备改时复现。

## 报告与测试证据不符

### R2-05 / 高优先级验收缺口：没有“彻底剔除源码正则测试”

`test-native-reminders.js:1609–1638` 的 B1/B2/B3 仍是 `.test(source)` 正则；B3 甚至匹配注释 `terminated delivery cannot preempt ringing`。C4、D3 也仍主要匹配名字/源码。新增 100 次顺序对账和 C2 删除、C3 抛错是真实 JS 行为改进，但不能外推成原生生命周期已通过。

尤其 D1 测试主动给出秒格式 `2026-09-19T15:00:00`，因此漏掉 R2-01 的实际分钟格式。C2 新用例在测试内重写部分补偿逻辑；本轮原独立探针另行执行了实际 sync 函数，才确认那个具体删除反例已修复。

应撤回“全部行为守护”和原合同全表 PASS。提交反例覆盖及原生可执行测试/设备证据，保留未执行格为 NOT_PERFORMED。

## 新候选设备证据：认可实际覆盖，不跨场景外推

设备：vivo V2238A，Android 16，serial `10ACBF2D3D000RS`。本轮仅只读复核包身份；以下执行结果是实现者归档的 **INHERITED_EVIDENCE**，不是本轮重跑实机。

| 归档场景 | 核对结果 | 可支持的结论 |
|---|---|---|
| `20260919T051023Z-device-verify` | PASS25/WARN1；POST_NOTIFICATIONS=true、POST_NOTIFICATION=allow | 连接、模块与往返，不是拒绝通知权限验收 |
| `20260919-vivo-candidate/other` | received=true、visible=false、lag=56ms | 后台收到投递；有原生声振启动台账，无可见闹钟证据 |
| `20260919-vivo-candidate/off` | received=true、visible=false、lag=163ms | 熄屏收到投递；有声振启动台账，不应省略 visible=false |
| `20260919-vivo-candidate/cold` | received=true、visible=true、lag=958ms；杀前 PID28234、杀后空 | 冷进程唤醒和该次界面显示证据成立 |

cold 的 due-screen.png 本轮已查看，确有“后台验收 cold”闹钟界面；对应 token 的 windowVisible 台账亦存在。这是相较上轮有价值的新证据。声振启动台账证明程序执行结果，不单独证明用户确实听到或感受到。

脚本 `scripts/verification/alarm-device-matrix.py` 通过 CDP 调用 makeItem、push、saveAsync，非真实表单操作；未撤销通知权限，也未执行重启/时区变更。不能用它把 A1“通知拒绝真实表单”或 D2“首次解锁前恢复”标为 PASS。ringDuplicateStart 也不能替代 5 分钟自动静音后迟到重入。

## 原合同覆盖与回交条件

| 合同项 | 本轮状态 |
|---|---|
| A1/A2 | partial：JS 权限分流有证据；指定拒绝权限及真实表单实机场景 NOT_PERFORMED |
| A3 | partial：已有 JS 隔离测试通过；未新增整机故障组合 |
| B1/B2/B3 | partial：上轮具体源码路径改善；原生组合测试不足，跨启动标识仍有 R2-04 |
| C1 | partial：100 次顺序对账 PASS，不等同并发入口压力验收 |
| C2 | partial：原独立在途删除反例 PASS；在途修改/完成/补跑期间再修改未完整覆盖 |
| C3/C4 | partial：单项失败保留和有界裁剪有改进；完整持久化/进程中断/日志洪泛行为证据不足 |
| D1 | divergent / FAIL：R2-01 和 R2-02 |
| D2 | divergent / FAIL：R2-03；冷启动 JS 重建及 cold 设备场景仅局部 PASS |
| D3 | partial：异常项 kept 改善；关机跨目标及坏项/失败组合设备证据不足 |
| R1 | partial：Node 回归 PASS，F10 简短业务探测不能替代完整设备语义回归 |

后续先修 R2-01～R2-04，再补原合同真正缺失的行为矩阵并纠正报告。任何新构建使用新候选哈希和独立证据目录，不覆盖本轮归档。未执行重启/改时/撤权限时可继续交付局部通过，但不得称全矩阵完成。
