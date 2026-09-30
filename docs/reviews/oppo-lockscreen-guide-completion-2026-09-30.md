# OPPO 解锁后功能补验

## 结论

同一个已安装修复包在 OPPO PKC130 上完成本轮补测：通知列表实际可见，取消未触发测试和闹钟界面关闭按钮正常，用户确认 00:28:49 测试的铃声与振动均正常。APP 进程重启后，设置向导的手动检查标记和测试身份保留；最终 18 条事项 full JSON 与补测前完全一致。

此前同包在锁定且熄屏状态下自动显示闹钟界面，窗口显示比计划晚 574 ms，见 [第一阶段记录](oppo-lockscreen-guide-verification-2026-09-30.md)。本轮两次触发时保持解锁，仅用于补验通知列表和关闭交互，不能新增锁屏、长待机或冷进程送达的通过结论。

## 身份与范围

- 日期：2026-09-30，北京时间。
- OPPO PKC130，Android 16 / API 36，ColorOS `V16.1.0`，序列号 `QSKFAE95CQEUJZ8L`。
- 包：`/Users/qlyf/Developer/reminder/releases/安心收件箱-lockscreen-guide-v51-oppo-debug.apk`。
- 已安装候选 SHA-256：`bb2aaa05d514ae4f2700ad21ac523b8835d4bd0c86984ba7d4b55c879ea196e6`，沿用第一阶段已核对的候选身份；本轮没有重新打包或安装。
- 分支 `docs/setup-60s-test-verification`，HEAD `e603edceda8fcae450e2e59294ff25d6fe2e9ccb`。本轮只添加验证记录，产品源码和候选未改动；未提交、未推送，已有修改与 `.claude/` 保留。
- 用户已授权安装并验证，随后解锁手机。未卸载、清数据、修改系统权限开关或使用 `force-stop`。

## 当前实机结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 取消未触发的 60 秒测试 | PASS | 实际点击开始和停止；`stoppedAt` 有值，`seenAt=null`，活跃投递为空，待触发测试撤销；旧展示记录不计入本次 |
| 解锁状态下自动显示闹钟界面 | PASS | 两次从实际设置向导按钮发起，原生弹窗实际截图与 trace 对应 |
| 用户实际听觉与触感 | USER_CONFIRMED | 用户明确回复 00:28:49 这轮“铃声和振动都正常”；不延伸为其他测试轮的用户体验证明 |
| 通知列表实际可见 | PASS | 00:33:17 测试从左侧状态栏下拉后，截图与 XML 显示应用名称、测试标题、60 秒触发正文和“停止声振”按钮 |
| 闹钟界面关闭按钮 | PASS | 两次实际点击“关闭（只止响，不表态）”；native `deliveryStopped`，活跃投递清空，响铃服务与测试通知撤销；不确认或完成业务事项 |
| 通知中的停止按钮交互 | NOT_PERFORMED | 本轮观察到该按钮，但未点击；不以原生关闭按钮的结果替代 |
| APP 进程重启与向导状态保留 | PASS_WITH_OBSERVATION | 普通 `am kill` 未终止进程；核对进程身份后，以应用自身 UID 发送 SIGTERM。旧 PID 6912 消失，重新启动 PID 7221，系统记录 COLD；手动标记、测试 trace 保留，实际 UI 显示“已手动检查 · 系统无法回读” |
| 事项保护 | PASS_AT_SETTLED_STATE | 最终 18 条事项 full JSON 与本轮开始完全一致，SHA-256 `2d6007009a0004ad72ca391b15cf0a280450b6719f5a974b7aaff1d8ff4f59e7`；启动初期变化见下文 |
| 结果提示准确性 | PASS | 本轮解锁触发虽然窗口可见，向导仍明确显示“本次锁屏展示尚未验证”，没有套用此前锁屏成功；厂商开关仍标为手动确认 |
| 测试清场 | PASS | 最终无活跃测试投递、AlarmRingService 或 id=90003 活跃通知；两条业务排程仍保留 |
| 长待机与冷进程闹钟送达 | NOT_PERFORMED | APP 进程重启与数据保留不是冷进程闹钟送达测试 |

## 测试身份

- 取消测试：`90003:4c8ba1f2-8ce4-4029-b836-c2b5fd84bd5a`，00:26:33.469 开始，计划 00:27:33.493，00:26:34.671 已停止。
- 声振与关闭补测：`90003:6021eb9d-0e1e-4fa5-b775-b4046ea4f8d8`，计划 00:28:48.881，用户确认这轮声振正常；窗口记录为解锁状态。
- 通知列表补测：`90003:37a9d220-080f-48d6-9999-bf5958b2ec41`，计划 00:33:17.113，`ringStarted` 00:33:17.208，`received` 00:33:17.216，实际关闭后 `deliveryStopped` 00:33:26.962。

## 观察与剩余限制

1. **声振诊断字段仍有误报。** 第一阶段已经发现 `AlarmActivity.java` 在服务正在响时调用 `recordFallbackCarrier("none")`，覆盖正确的载体信息。用户本轮实际确认声振正常，该诊断字段问题仍未修复。本轮保持候选不变。
2. **启动初期快照短暂变化。** 两次重启后的早期断言未通过：两条 wall-clock 事项的 `triggerAt` 短暂按过去的本地时间变化，一条同时出现取消记录。后续稳定状态再次全量读回，恢复为补测前相同的 full JSON。记录早期失败与最终结果，不将其写成重启期间从未变化。此次未进一步确定恢复机制或修改时间协调源码。
3. **通知中心操作路径。** 第一次从屏幕中间下拉打开 ColorOS 控制中心，未观察到通知内容；改从左侧状态栏下拉才实际看到通知列表。第一次空列表不构成产品通知不可见的证据，原始截图和输出均保留。
4. 第一阶段锁定后的 WebView 自动化回执超时仍为已记录的补测限制；本轮采用真实 UI 开始按钮、保持解锁并记录原生行为，没有宣称该等待问题被修复。

## 证据

原始日志、完整快照与截图保存在候选外，不入库：

`/Users/qlyf/Developer/reminder-archive/verification-runs/20260930T002531-oppo-guide-completion/`

关键文件：`RESULTS.json`、`cancel-result.json`、`cancel-alarm-queue.txt`、`visible-test-run.json`、`native-popup.png`、`after-close-state.json`、`notification-proof-test-run.json`、`notification-proof-drawer.png`、`notification-proof-drawer.xml`、`notification-proof-observation.json`、`notification-proof-trace.json`、`restart-process.json`、`restart-test.log`、`restart-after.json`、`restart-after-settled.json`、`restart-setup-details.png`、`final-state.json`、`final-alarm.txt`、`final-notification.txt`、`final-activity-services.txt`。

私有事项数据及其他应用通知只留在本机证据目录。文档新增后执行 `git diff --check`；本轮没有产品源码变更，未重复运行此前已完成的 npm/JVM 全量验证。
