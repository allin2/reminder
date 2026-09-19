# 三项优先改进：独立验收结果

时间：2026-09-19 23:48 CST。结论：**FAIL / FIX_REQUIRED**。

验收依据：[实施合同](../handoff/2026-09-19-user-experience-three-priorities.md)。本轮未修改产品代码、未修改既有测试、未安装或操作个人手机；仅新增本报告与独立复现证据。没有提交、推送。

## 1. 结论与版本

当前实现确实完成了干净首启、只读演示、收起高级字段和部分动作说明。但 P1 的真实证据回流、P2 的保存隔离、P3 的撤销一致性均存在阻断问题，不能接受实施报告中这些项目的 PASS。

仓库 `/Users/qlyf/Developer/reminder`，`main`，HEAD `8d1c2617cff3aac5c4450a949c9044b79f63a673`，大量未提交改动。当前关键文件哈希与实施报告结束状态一致；debug/release APK 哈希与报告一致，独立核对的 6 个 Web 文件在两包内均与当前源码逐字节一致。不能将这些缺陷解释为验了旧代码。

- debug SHA-256：`69c5761bc624a980937f62ffd93dedcf2f3dec0a9adea73b125013fa9eef6443`。
- release SHA-256：`58925fa4002c9f4e0232d7431f0e22268fbd522eae9f1fbf89649bd4262d3b7c`。
- 源码、产物身份：[identity.json](verification-runs/20260919T234129-ux-independent/identity.json)。本轮未重新构建候选 APK，未核对当前设备安装身份。

## 2. 阻断问题

### F01 [P1] 原生回执字段不匹配，真实证据无法进入事项台账

位置：`android/app/src/main/java/space/alliswell/inbox/DeliveryEvidenceStore.java:95`、`lib/native-reminders.js:1233`、`lib/delivery-evidence.js:66`。

Java `rowFor()` 写 `{itemId, key, at, carrier, receivedAt, itemRev, token}`；桥直接返回这些行，JS `normalizeEvidence()` 却只读取 `row.reminderKey`。因此每条正常原生回执都因 missing-identity 被丢弃。

独立反例 R7 使用生产 Java 的真实字段结构，经生产 JS 桥适配和归一化函数：`available=true`，但 `valid=false`、`applied=0`。现有测试人工输入 `reminderKey`，没有穿过 Java→JS 的字段合同，因而全绿。

同一通路还丢掉原生 `available:false`：JS 无条件返回 `available:true`（R7b）。Java 内部读取错误转空数组、写入 commit 返回值未检查，也削弱了失败可观测性。

要求：统一生产协议并用原生真实输出做集成契约测试；保留不可用与空结果的区别。普通 LocalNotifications 后台投递的持久证据也须补齐或明确记为未覆盖，当前只新增实时监听，不能声称其冷启动证据已全通。

### F02 [P1] 保存防重复使用不同身份，连续回车会持久化两条

位置：`app-core.js:3863`、`app-core.js:3992`；编辑与 AI 分支同样使用另一种 token。

入口查的是 `new|文本|时间`，真正加入集合的是 `new:<新ID>`（编辑为 `edit:<ID>:<时间>`，AI 为 `ai:<时间>`）。检查永远对不上。保存按钮 disabled 不能拦住输入框的 Enter 监听再次调用保存。

反例 R1：扣住持久化，连续调用实际表单保存函数两次，两个调用均返回 true，最终内存和权威存储均有 **2 条**相同记录。

要求：同一表单提交身份从接收、异步解析到提交完成一致；重复 Enter、双击及 AI 在途均验，合法的下一条新记录仍能处理。

### F03 [P1] 上一笔保存结果会清掉用户后续输入

位置：`app-core.js:3937`、`app-core.js:3995`、`app-core.js:4013`。

持久化回调无条件关闭并重置全局表单；失败回调也无条件将旧草稿恢复到当前表单。没有绑定表单会话/草稿版本。用户在慢写入时继续输入，或取消后打开下一张表单，会被旧请求的结果覆盖。

反例 R2：第一笔保存未提交时，将输入改成「第二条尚未保存的输入」，释放第一笔提交后，输入成为空字符串。

要求：提交保存使用自足快照，回调只更新对应会话；新草稿不被旧成功清空、不被旧失败覆盖；AI 迟到也遵守同一规则。

### F04 [P1] 撤销完成绕过事务日志，显示成功后仍会回到已归档

位置：`app-core.js:2036`、`app-core.js:2083`；与 `app-core.js:7339` 起的统一命令注册对照。

`undoLastComplete()` 直接修改共享 state，没有加入原生在途事务的冲突检查/命令日志。在原生动作提交期间，撤销不会被重放到随后发布的权威草稿。

反例 R3：B 已完成，A 原生 ACK 提交被扣住，此时撤销 B。返回 true，B 立即变 due；释放 A 提交后，B 又变 archived；重启后仍为 archived。用户明确完成的撤销被静默丢掉。

反例 R6：撤销直接 `save()` 后立即提示「已撤销完成」。注入权威写入失败后，磁盘与重启结果仍为 archived。原有通用保存失败提示随后出现，不能替代「持久化后才确认撤销」合同。

要求：把撤销变成符合既有事务模型的受控命令；同域冲突拒绝、无关操作可正确重放，成功反馈等提交确认。证据合并 `applyNativeDeliveryEvidence()` 同样直接写 state，需一起纳入在途事务复核，不能再留一个旁路。

### F05 [P1] 跨原定时间撤销完成，会立即补投已经取消的事件

位置：`app-core.js:2083–2094`、`lib/native-reminders.js:328` 起的既有补投分支。

反例 R5 完整采用生产取消记账函数：事项到点前完成 → 原生确认取消并经 `applyReminderEvents()` 标记 cancelled → 原定时间跨过 → 8 秒内撤销完成。撤销恢复 waiting，保留 cancelled 台账，随后 `buildDesired()` 生成 `catchUp:true`、约 now+2 秒的普通通知。

这与本合同「撤销不能立即补响已经过去的同次事件」冲突；代码旁的注释并没有实现该抑制。该结果是生产计划生成行为证据，本轮没有让手机实际响铃。

要求：明确撤销事件的投递抑制语义，只恢复未来有效计划，不改变全局补投规则；用真实取消 reducer 与跨点时序回归，不能只断言事项回到未完成。

### F06 [P1] 旧回执没有按轮次/版本核对，会误报新提醒已接收

位置：`lib/delivery-evidence.js:65–86`、`lib/delivery-evidence.js:120–136`、`lib/delivery-evidence.js:171`。

合并仅校验 `ev.at >= item.triggerAt`，不核对 itemRev/token、当前登记键或有效轮次。旧轮的第 2 次追提醒可能发生在新轮首次时间之后；时间下界不能证明两者是同一轮。展示又是「存在任意 delivered 就显示已接收」。

反例 R4：原轮次在 31 分钟前开始，旧追提醒在 1 分钟前；用户已将当前轮次改为 2 分钟前、版本 9。收到版本 1 的旧追提醒回执后仍应用成功，并将当前结果显示为「系统已接收这次提醒」。当前轮次本身仍只有 scheduled，没有接收证据。

R4b 还确认：仅 itemId/reminderKey、缺接收时间/版本/token 的行被标 valid，并可使用当前时间补成收到。Java 也仅强制两个字段；实施报告「任一身份字段缺失就拒绝」不符合代码。

要求：使用可验证的排程/轮次身份，不把版本字段存在等同于已校验；缺证据保持未知。版本因非排程操作变化的情形应按统一身份模型处理，不简单加一个可能误拒合法回执的数字相等检查。

### F07 [P1] 「停止铃声 / 取消未触发的测试」实际没有停止当前铃声的路径

位置：`app-core.js:6086–6089`、`app-core.js:5443`、`SystemBridgePlugin.java:1110`、`AlarmScheduler.java:238`。

按钮先调用 `labCancelAlarms()`，只撤 PendingIntent 和排程镜像；后面条件调用 `NativeReminders.stopAllAlarms`，但该 API 在模块中不存在，分支永不执行。已有响铃服务不会被这条取消排程路径停止。

这是源码完整调用链确认的缺陷，本轮未在用户手机上制造响铃。不能以存在按钮、取消接口返回成功证明停铃有效。

要求：获取并核对本次测试的活跃投递 id/token，调用已存在的 token 限定停止链路；不误停其他用户闹钟。测试证据和用户反馈绑定本次运行，不能继续展示上一条业务闹钟或上次测试的结果。`setupSteps()` 当前 test.done 永远为 false，也需落实测试完成与重测状态。

### F08 [P2] 无时间记录刚生成的撤销入口被下一条 toast 覆盖

位置：`app-core.js:4001–4005`。

`announceSaveOutcome()` 创建带撤销的保存反馈，随后 `needs` 分支立即再调用不带撤销的 toast。独立 Web UI 操作「有空看看这个项目 → 保存」只出现「已收下 · 待整理 / 去整理」，没有撤销。

要求：统一反馈出口，保留待整理语义与本次可用撤销动作。对应 UX-C03，不能仅对有明确时间的记录签完整 PASS。

## 3. 需求覆盖结论

| 需求 | 本轮判断 | 依据/边界 |
|---|---|---|
| T01 保存与排程 | FAIL | F02/F03；状态判定纯函数通过不足以证明真实提交链路 |
| T02 首用短路径 | FAIL / partial | 页面已接线，但 F07；测试反馈未绑定本次事件，实机测试未执行 |
| T03 证据回流 | FAIL | F01/F06；不能声称原生半边已端到端补齐 |
| T04 OEM 诚实引导 | partial / NOT_PERFORMED | 部分文案改进；本轮未复验设备落点/修复效果 |
| C01 首启/演示 | 局部 PASS | 独立 Web 首启无自动示例，主动演示为只读；既有数据升级设备证据只继承 |
| C02 轻量录入 | partial | 默认收起高级项可见，无时间能记录；受 F03 影响，大字体/键盘未验 |
| C03 查看/撤销 | FAIL | F08；撤销仍应覆盖持久化确认、过点与取消失败 |
| A01 动作说明 | partial | Web 确有副说明，全部原生入口未独立实测 |
| A02 未完成找回 | INHERITED_EVIDENCE / partial | 既有回归通过；未独立跑数日与全部搜索路径 |
| A03 完成撤销 | FAIL | F04/F05，不以正常单函数测试替代竞态/失败/重启 |

另有待复核观察：桌面和手机宽度下通过浏览器自动聚焦操作曾使 `#app` 自身滚动，露出未打开的 sheet 并截掉当前输入区。尚未排除自动化焦点/滚动影响，**未将其列为已确认产品回归**，也不据截图宣称完整视觉验收通过。

## 4. 实际执行与证据等级

- `npm test`：本轮独立复跑 **1475/1475**（319 + 318 + 226 + 612），退出 0。[日志](verification-runs/20260919T234129-ux-independent/npm-test.log)。
- `git diff --check`：退出 0。
- JDK 17，`./gradlew :app:testDebugUnitTest --offline --rerun-tasks`：真实重跑 **19/19**，退出 0；不是第一次 UP-TO-DATE 的缓存结果。[日志](verification-runs/20260919T234129-ux-independent/android-unit-rerun.log)、[结果](verification-runs/20260919T234129-ux-independent/android-results.json)。
- 独立生产函数反例：R1/R2/R3/R4/R4b/R5/R6/R7/R7b，原始结果见 [probe-results.json](verification-runs/20260919T234129-ux-independent/probe-results.json)。脚本退出 0 表示取证完成，**不表示这些产品行为通过**。
- 使用现有 VM/IndexedDB 可控外设 harness，不改生产源码、不改原测试；原生跨桥反例使用 Java 实际字段格式，经真实 JS 适配器处理。它是合同/行为证据，不冒充真机投递。
- Web：独立 localhost 存储，检查首启、演示入口、录入、无时间保存反馈及 390px 展示；测试内容只写该临时浏览器来源，不触碰手机用户数据。
- APK：独立校验两候选哈希与 6 个 Web 资源；未重新打包。当前候选实机投递、自然冷进程、长待机、重启、权限设置与 OEM 对照：**NOT_PERFORMED**。已有源码/行为层阻断，不把未做设备验证填成 PASS。

复现命令（仓库根目录）：

```sh
node docs/reviews/verification-runs/20260919T234129-ux-independent/probes.cjs
```

该命令仅运行隔离数据并更新本证据目录的 probe-results.json，不触碰真实通知或个人数据。修复后建议复制脚本到新的 run 目录运行，保留本次失败证据。

## 5. 返工与再次验收要求

优先统一两份合同，而不是对每个失败添加局部布尔：

1. **保存/撤销事务合同**：提交身份、表单会话、业务版本、持久化、原生在途动作、周期派生、对账副作用使用一套明确的先后顺序。修 F02–F05，并补已有测试没有覆盖的真实等待窗口。
2. **投递证据合同**：Java 输出→桥→JS→权威存储→详情展示用一份真实样本贯穿测试；处理轮次、乱序、不可用、丢记录及普通通知后台覆盖，修 F01/F06。
3. **首用测试闭环**：本次测试身份、可达的 token 限定停铃、用户反馈与事件关联、可跳过/重测；修 F07/F08，不能仅增加页面文案。

返工后仍交付新的实现报告、独立候选和原始证据。原报告留作历史，不覆盖本轮失败记录。先让这些反例变成有断言的回归并通过，再复验本合同要求的真实 Android 链路；OEM 冷进程限制未解决时保持明确边界。
