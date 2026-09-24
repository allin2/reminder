# 修复独立复验：部分通过，后台送达尚未关闭

日期：2026-09-20。范围：复核编辑保时修复，以及修复方案中后台送达阻塞的关闭状态。本轮未修改产品源码、未提交或推送。

## 结论

- **PASS：编辑丢失提醒时间的原反例已修复。** 独立源码快照测试、旧基线负对照、当前安装包真实 WebView 表单保存及重载结果一致。
- **未通过整体验收：后台／锁屏／冷进程送达没有得到关闭证据。** 当前仅有 app-core.js 与测试增量，无原生修复增量；当前包的并行诊断原始数据仍有到点后 120 秒未接收、再次打开才接收的现象。
- 不能把本轮编辑功能 PASS 扩展为整机所有功能 PASS。手机重启、当前包独立冷进程送达矩阵为 **NOT_PERFORMED**；历史失败只作继承背景。

## 身份与隔离

- 仓库 `/Users/qlyf/Developer/reminder`，分支 `main`，HEAD `4de5f597573bc2c45b51ba8ab18a279d054339a0`；保留既有 dirty/untracked 文件。
- 在 git archive 生成的独立临时源码快照中复制当前两个改动文件执行测试，见 `snapshot-path.txt`、`reviewed.patch`、`source-hashes.txt`。未切换或清理源工作区。
- OPPO PKC130，ADB `QSKFAE95CQEUJZ8L`。
- 从手机拉取 installed.apk；其 SHA-256 与 releases/安心收件箱-debug.apk 一致：`de9e63771d3caca0a454562dfd608b44a3d75743a45bff89c4c9ab3b3c19231c`。
- 包内 assets/public/app-core.js 与被测源码一致：`1409850ddffb73a35dae93a2bfd21d39392e44d14c3157f433d4170cdf229c99`。见 `identity.json`。这项核验不替代完整构建来源证明。

## 独立验证结果

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| npm test | 1625 通过，0 失败（330 + 321 + 244 + 730） | npm-test.log |
| 独立反例：标题、含时间词标题、备注/标签、elapsed 稍后、显式清空、改期、已确认事项改标题 | 7/7 PASS，保存后不额外调用 saveAsync，直接重建测试运行时验证磁盘数据 | probes.cjs、probes-result.json |
| 同一反例在 HEAD 旧代码上运行 | 5 个失败：标题、时间词、元数据、稍后、已确认；清空与改期通过 | baseline-probes.json |
| 当前 APK 实机：上述 7 组 | 7/7 PASS；真实 DOM input 事件和保存按钮，保存后 WebView reload 保持结果 | device-review.py、device-edits.json、device-reloaded.json、device-checks.json |
| 实机普通通知改期/清空 | PASS：改期后 pending 仅含新 reminderKey；清空后该事项 pending 为空、triggerAt 为 null | native-cancel-probe.js、native-cancel-result.json |
| 测试事项收尾 | 本轮创建事项通过 completeItem 完成，未删除用户数据；初次中断遗留事项亦按确切 ID 完成 | device-cleanup.json、interrupted-test-cleanup.json |

“重载”指 WebView 或测试运行时重建，不是手机重启。实机表单通过 CDP 驱动真实 DOM；不宣称手指触摸路径或全套视觉验收。普通通知 pending 变化只证明排程投影更新，不证明到点用户可见。未改原生代码，本轮未重跑 Android 构建/JVM 检查。

首次实机尝试与另一个 diag-runner 任务重叠，读取直接注入测试项时失败，后续 CDP 连接超时。保留 `device-interrupted-attempt.txt`，不将其算为产品失败。待对方任务结束后改用生产表单创建事项并完成上述实机复验。

## 后台诊断证据的独立复核

复核来源：相邻目录 `../20260920T124045-bg-diag/`，该任务自行生成的原始证据，不是本轮独立执行的后台矩阵。安装包哈希已在本轮核实一致。

1. `diag-foreground` 实际不是合格前台对照：due-3-power.txt 为 `mWakefulness=Dozing`，window 为 NotificationShade / `mDreamingLockscreen=true`，截图为黑屏。不能把这个目录名解释为“前台功能回归失败”。
2. diag-runner.py 的事件匹配存在假阴性风险：先按 detail/itemId 筛选后，只有匹配为空才做 token 关联；已有 `stage=item` 时，其他同 token 阶段被漏掉。后续诊断必须始终先由 item 找全 token，再关联所有事件。
3. 本轮已重新按 token 关联原始 trace，而非直接采用其布尔结果。`diagnostic-token-recheck.json` 显示 foreground 标记那组到点 +120 秒仅有 scheduled，再打开才出现 received。
4. `other-token-recheck.json` 同样显示 `diag-other-1789879664846` 在 +3/+10/+30/+60/+120 秒无 received/windowVisible，再打开才在 `1789879816880` 接收、`1789879817014` 可见，较原目标 `1789879694846` 迟约 122 秒。这不是准时送达 PASS。

以上足以拒绝“后台已修复”的结论，但不能据此确定唯一厂商原因，也不能代替受控的新一轮四场景验收。

## 剩余工作

1. 先修诊断脚本 token 关联及实际场景判定，确保屏幕、锁屏、前台和 PID 与测试名称一致，避免多个任务同时操作设备。
2. 沿原修复方案继续定位后台派发，取得经证据支持的修复后再运行前台、其他应用、锁屏、冷进程矩阵。
3. 后台正式 PASS 仍需同 token 接收、可见台账与屏幕证据，并满足时延要求；不能以打开 App 后补到达代替。
