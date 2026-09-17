# 第二轮修复复核

结论：**修复有进展，但仍有阻断结项的问题。**本轮对照上一份 `repair-verification-2026-09-16.md` 的 V01–V09，核验当前未提交工作区，没有修改产品代码。

基线：分支 main，HEAD `7972af7c516bb72040c82d62984384d59a1caae0`；修复位于 HEAD 之上的 11 个 tracked 修改文件。既存未跟踪文件全部保留。本轮仅新增此报告，由主代理直接完成。

验证：unit **29/29**、native **98/98**、smoke **137/137**，共 **264/264** 通过；`git diff --check` 通过。另执行真实业务函数/对账函数的 VM、mock 故障探针。JDK 仍仅发现 24；Android 编译、Lint、安装、锁屏、重启、真实通知动作均 **NOT_PERFORMED**。代码结论不等于安卓 PASS。

## F1 · P1 · V03：两个截止阶段共用单槽位，造成持续保存/对账及重复通知

位置：`app-core.js:2982` 的 deadlineEvents 写回循环、`lib/native-reminders.js:294` 的阶段消费判断。

当前已经预排 p24 与 p2，但每个事项只有 `deadlineNotifiedKey/At` 一组字段。对账返回两个阶段，写回先存 p24，再覆盖成 p2。下一轮依然从 p2 改成 p24 再改回 p2，changed 永远为 true；save 又触发 80ms debounce 对账。因此即使计划没有变化，也可形成持续写库和插件调用。

独立探针用截止还有12小时的 acknowledged 事项，执行真实 reconcile，再逐句执行当前写回算法，连续三轮均输出：

```text
events=[p24,p2], saveRequired=true, savedStage=p2
```

模拟 p24 已送达、从 pending 移除，15秒后对账仍新增1条 p24，原先的重复提醒没有消失。单纯“计划时刻已过就视为送达”也缺少系统实际执行证据，不宜冒充真实送达确认。

建议：按事项、截止版本和阶段保存多个事件记录，批量比较最终状态后只保存真实变化；分清已排、已送达、已确认与过期，不使用一个字段轮流覆盖。复测稳定对账不再次 save，p24 送达后不重排，p2 仍按时保留，进程恢复不会丢失消费记录。

## F2 · P1 · V09：确认删除仍早于数据库持久化

位置：`lib/native-reminders.js:744` 的 await handler 与后续 ackAlarmAction；`app-core.js:519` 的 save、`:3102` 的动作处理。

原生已改成 peek+ack，方向正确；但 handleAlarmAction 是同步函数，内部 save 启动异步 storage.save 后立即返回，不返回持久化 Promise。drain 的 await handler 等不到数据库事务，因此仍会提前删除原生事件。

已用 VM 替换存储适配器的 save 为永不完成的 Promise，执行真实 `drainAlarmActions(app.handleAlarmAction)`。实测：存储 Promise 尚未完成，ackAlarmAction 已执行、队列事件已删除，事项只在内存变成 archived。此刻崩溃仍会丢操作。

建议：让状态变更返回真实持久化结果，失败明确上抛，只有成功提交后才确认队列；以 alarmEventId 持久化去重。现有5秒、itemId+action的内存去重不等于事件提交记录，也可能在重试时提前跳过尚未落库的操作。

## F3 · P1 · V04：停止重复没有停止已经生成的下一实例

位置：`app-core.js:1331` 的 spawnNextInstance、`:1531` 的 stopRepeat。

ACK 后新建下一实例、再完成当前实例保留下一期，这个旧复现已修正。但当前实例与下一实例没有系列关联，stopRepeat 只修改当前条目。

VM 实测：ACK-based 事项执行 ACK 生成下一期，再对原事项执行 stopRepeat；仍有 **1条未归档且带 repeat 的活跃事项**，它会继续提醒、继续派生周期。界面“周期已终止并归档”与实际不符。

建议：赋予周期稳定的系列身份；停止操作应终止系列与其未来实例/排程，保留历史。补测 ACK 后停止、完成后从历史入口停止、多个未来实例及重启后的规则状态。

## F4 · P2 · V08：只把排程失败标异常，撤销失败仍显示就绪

位置：`lib/native-reminders.js:695`，scheduleFailed 仅识别 `schedule:` 前缀。

mock 让 cancelAlarm(123) 抛错，真实 reconcile 输出：

```json
{"reliability":"exact","errors":["cancel:123:cancel failed"],"ids":[123]}
```

台账保留正确，但用户看不到“旧闹钟可能仍会响”，仍显示精确就绪。原 V08 的撤销失败场景未修完。

建议：任何影响当前承诺的排程/撤销失败都进入可见异常，区分失败动作并保留重试依据；验证开启和关闭通知时的撤销失败提示。

## F5 · P2 · V02/V05：把未知版本直接放行，削弱旧动作保护

位置：`app-core.js:3040`、`:3088`。

String 版本号链路已修复，但新逻辑将缺失/0版本视为未知并直接放行。旧版本通知、缺失版本的恢复路径就能对改期后的未完成事项执行 done/snooze，绕过本轮新增的版本校验。终态保护只能保护已归档，不能保护改期后的当前状态。

建议：未知版本通知允许打开当前详情；改变状态前需要建立可靠的事件与当前版本对应关系，不能把“未知”当成有效匹配。本项为源码链路结论；旧安装升级后的通知动作未实机验证。

## V01–V09 状态表

| 编号 | 当前结果 |
|---|---|
| V01 | onCreate 已调用 restartAlarmEffects，源码缺口关闭；设备起响未验 |
| V02 | Activity、Receiver、Scheduler、持久化恢复的版本统一 String；原类型错误已修，未知版本放行见F5；设备未验 |
| V03 | p24/p2 预排已加，但阶段记录覆盖、持续对账、送达后重复未通过，见F1 |
| V04 | ACK后完成保留下一期、09:00月末推进已修；系列停止仍失败，见F3 |
| V05 | editing递增版本、改期重置轮次、scheduleKey带rev已加；未知版本分支见F5 |
| V06 | 抑制仅作用于兜底普通提醒，首页使用isAttentionDue，原生统一fallback判定；上一轮所列源码缺口已修，GUI未验 |
| V07 | skippedUntil有效时原生投影为空，原“今天跳过仍响当晚”复现已修；当前直接不预排下个窗口，长期后台恢复下一场仍需验证 |
| V08 | 排程失败可见；撤销失败依旧隐藏，见F4 |
| V09 | 原生peek/ack接口和排空循环已加；实际数据库提交边界未闭环，见F2 |

本轮没有修改旧审查报告，没有提交、推送或替换 APK。建议先解决F1/F2/F3，再补F4/F5；补测真实串联路径，而不是仅断言新增字段和单函数返回值。
