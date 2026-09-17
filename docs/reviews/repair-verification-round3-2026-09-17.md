# 第三轮修复复核

结论：**尚未通过，不宜据此确认安卓封装前逻辑验收完成。**本轮只审核，未修改产品代码。

基线：main，HEAD `7972af7c516bb72040c82d62984384d59a1caae0`，审核对象为当前未提交工作区。保留全部已有修改和未跟踪文件。

## 上轮修复状态

| 上轮项 | 本轮结果 |
|---|---|
| F1 截止阶段记录 | 已改为分阶段 map，解决共享槽位问题；取消后被误记送达仍未解决，见 G3 |
| F2 动作持久化后确认 | 已返回 Promise、加入事件台账；并发确认和失败回滚仍有缺陷，见 G1/G2 |
| F3 停止整个周期 | 新建实例已继承 seriesId，能够停止下一期；同时误归档已确认的旧实例，见 G4 |
| F4 撤销失败显示异常 | 当前 alarmFailures > 0 即显示 error，原分支缺口关闭 |
| F5 未知版本保护 | 缺失/0 版本被拒绝修改状态，原分支缺口关闭 |

## G1 · P1 · 并发消费仍会在持久化前删除原生事件

位置：`app-core.js:3262`、`:3305`，`lib/native-reminders.js:751`、`:799`；另一路恢复消费位于 `app-core.js:3667`。

handleAlarmAction 在提交之前写入内存 alarmEventLog。第一个调用还在等待 storage.save 时，第二个调用看到 alarmEventSeen 就成功返回；drain 随即 ackAlarmAction 删除原生事件。恢复前台存在两个消费入口，drain 本身没有串行锁。

独立 VM 探针调用真实 drain 两次，以未完成 Promise 模拟数据库提交：`acks=1, queued=false`，此时第一次提交仍未完成。故“await handler”尚未建立可靠提交边界。

建议：串行消费或按事件复用正在提交的 Promise；只把已提交事件视为可直接确认。补测同一事件并发消费、提交失败和中途退出。

## G2 · P1 · 周期动作保存失败后残留下一期，重试重复派生

位置：`app-core.js:3312`–`:3345`，周期派生位于 `:1423`。

回滚仅还原原事项的六个字段，没有撤回 spawnNextInstance 新增事项，也没有还原 ackAdvancedAt 等关联状态。内部 ackItem/completeItem/snoozeItem 还会先调用一次不等待的 save，动作不是单次提交。

独立 VM 用 ACK 周期事项并让 localStorage.setItem 抛错：失败后原事项恢复 due，但事项数从 1 变成 2，ackAdvancedAt 仍有值；恢复存储重试后事项数变成 3，出现两个下一期。

建议：将动作状态变更和派生实例作为完整事务提交，避免内部重复保存；失败时恢复整个受影响状态。覆盖 ACK/calendar 完成派生、snooze 元数据和重试。

## G3 · P1 · 已取消的截止阶段仍被误记为已送达

位置：`app-core.js:3091`–`:3097`，`lib/native-reminders.js:311`–`:317`。

applyDeadlineEvents 在当前计划不含某阶段时仍保留 scheduled，且仅凭 at <= now 将其改为 delivered。比如排程后关闭通知、成功撤销，越过原计划时间后再开启：这条取消的记录仍会被标为已送达，buildDesired 随后直接排除该阶段，错过补提醒。实际 onDelivered 回调存在，但时间推断仍绕开了它。

独立 VM：输入已有 scheduled 记录，连续以空计划对账，时间跨过 at 后记录由 scheduled 变为 delivered，全程没有送达回调。

建议：区分撤销、待投递、已送达，撤销成功后更新台账；不要将经过计划时刻当成送达证据。补测关闭后开启、系统延迟和权限恢复。

## G4 · P2 · 停止下一期会归档已确认但尚未完成的历史事项

位置：`app-core.js:1361`–`:1364`、`:1596`–`:1603`。

seriesMembers 选择同系列所有非终态事项，不判断是否未来实例。ACK 后当前事项仍 acknowledged、未完成；对生成的下一期执行停止重复，会把原事项也归档并设置 completedAt=null。它从待处理列表消失，违反代码中“已经交付/确认过的历史一律保留”的承诺。

独立 VM：A 执行 ACK 产生 B，对 B stopRepeat，A 结果为 `status=archived, completedAt=null`。

建议：停止系列规则与归档未开始实例分开处理；保留已确认、已到期但未完成实例的业务状态。补测从当前期、下一期和历史入口停止。

## G5 · P2 · 正式测试入口仍失败，测试初始化存在竞态

`npm test`：unit 29 通过、native 103 通过、smoke 156 通过/1 失败，共 288 通过/1 失败。失败项为 `F2 存储恢复后重试成功 — status=due seen=false rev=1`。单独执行 `node test-smoke.js` 复现，退出码 1。

测试 harness 将 document.readyState 设置为 complete，自动启动异步 init，同时直接修改 app.state；新加入的 await 给初始化恢复状态留下交错机会。仅在内存中把 readyState 改为 loading、禁止自动初始化后，同一 smoke 得到 157/157。该对照说明原失败受初始化竞态影响，不能直接当成普通非周期重试必然失败的产品证据；但正式测试入口仍须修复，G1/G2 独立探针不受自动初始化影响。

建议：测试明确等待初始化完成或禁用它后独立准备状态；异步动作测试等待返回 Promise。保留正式入口失败记录，不以诊断版通过替代。

## 验证边界

- `git diff --check` 通过。
- 上述产品复现执行真实 JS 业务/队列函数，使用 VM 与存储/原生桥 mock；未写入用户数据库。
- Android 编译、Lint、APK 安装、锁屏、重启、真实通知与设备故障恢复：**NOT_PERFORMED**。本报告不构成安卓实机 PASS。
- 本轮仅新增本报告；没有提交、推送或替换 APK。优先处理 G1/G2/G3，再修 G4 和正式测试入口。
