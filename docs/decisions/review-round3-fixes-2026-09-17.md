# 第三轮复核修复决策（2026-09-17）

范围：落实 `docs/reviews/repair-verification-round3-2026-09-17.md`（G1–G5）。

编号承接 `interaction-logic-2026-09-16.md` 的 D1–D25 与 `review-fixes-2026-09-16.md` 的 D26–D27。
其中 **G4 与 G3 触及产品行为**（会改变用户看得见的结果），按 V0.2 §22「若实现与基线冲突应先停下并报告」的
要求，先在这里裁决，再回改代码；G1 / G2 / G5 属实现层正确性，一并记录根因。

---

## D30 · 停止重复 = 终止规则 + 只归档「尚未开始」的未来实例

| # | 决议 | 依据 |
|---|---|---|
| **D30** | 「停止重复」拆成两件事：<br>① 整个系列（含历史实例）**一律摘掉 `repeat`**，从此不再派生、不再按周期提醒；<br>② **只归档尚未开始的未来实例**（判据：`status === "waiting"` 且从未确认 / 送达 / 稍后过），不写 `completedAt`；<br>③ **已经确认或交付过但尚未完成的历史实例保留原业务状态**，不归档、不改写确认时间。 | 原实现按「同系列所有非终态事项」归档，会把**已 ACK 的上一条**一起 `archived` 且 `completedAt = null` —— 它从待处理列表凭空消失，也污染「今天已完成 N 件」。这与代码里「已经交付/确认过的历史一律保留」的承诺、以及红线 **Acknowledged ≠ Completed** 直接冲突（用户只是「看到了」，不是「完成了」，不该被归档）。<br>判据用**生命周期证据**而不是时钟：时刻已过不等于用户看过（红线：通知送达 ≠ 用户看到）。 |

**实现位置**：`app-core.js` → `isUnstartedInstance()` / `stopRepeat()`。
**验收**：`test-regressions.js` 的「G4 停止重复 = 终止规则 + 只归档未开始的未来实例」三组；
`test-smoke.js` 的 D23 / V04 停止重复既有断言不回归。

---

## D31 · 截止保护分「待投递 / 已送达 / 已撤销」三态，计划时刻不再等于送达

| # | 决议 | 依据 |
|---|---|---|
| **D31** | 截止阶段台账只承认三类记录：<br>`scheduled` 已请求系统投递、无证据 → **保持待定**；<br>`delivered` 仅有**真实送达回调**（`localNotificationReceived`）才写；<br>`cancelled` 仅当原生**确认撤销**且撤销发生在**投递时刻之前**才写。<br>「计划时刻已过」**不再**作为送达证据。<br>被撤销的阶段视同「从未排过」：重新开启通知后若保护点已过，**立即补提醒**。 | 原实现把「当前计划里没有该阶段 + `at <= now`」直接改写成 `delivered`。于是**排程后关掉通知、或撤销成功**，越过原计划时刻再开启时，这条**已经被取消**的记录会被当成已送达，`buildDesired` 随后直接排除该阶段 —— 用户永远收不到这次保护提醒。这就是「时间推断绕开了真实的 `onDelivered` 回调」。<br>三种状态分开之后：既不会谎报送达（保住台账可信度），也不会把撤销过的提醒永久吞掉（保住 INV-05）。 |

**取舍（必须明说）**：后台送达拿不到 `localNotificationReceived`，因此后台已送达的阶段会停在
`scheduled`（待定）而不是 `delivered`。这是刻意的保守选择：它也**不会重复提醒**（待定且已过点的阶段既不重排也不补发），
只是不把「不知道」写成「已送达」。
**已知可改进项**：点击截止通知本身是强证据，但 `handleNativeNotificationAction` 尚未处理
`extra.stageKey`（点击只打开详情）。留待后续单独裁决。

**实现位置**：`app-core.js` → `applyDeadlineEvents(events, now, cancelledEvents)` / `syncNativeRemindersNow()`；
`lib/native-reminders.js` → `reconcile()`（新增 `cancelledDeadlineEvents`）/ `buildDesired()`（`cancelled` 视同未排过）。
**验收**：`test-regressions.js` 的「G3 截止阶段：撤销 / 待投递 / 已送达必须分开」三组；
`test-smoke.js` 的 F1 五条（已按新契约改写）；`test-native-reminders.js` 的 V03 / F1 条目。

---

## 本轮工程修复（实现层正确性，不需产品裁决）

| 编号 | 根因 | 处理 |
|---|---|---|
| **G1** | 事件台账条目是与状态变更**同一次**写入的内存对象，提交落地前就已经可见。并发到达的第二个消费调用被这个内存标记判成「已处理过」立刻返回成功，`drainAlarmActions` 随即 `ackAlarmAction` 删除原生事件 —— 此时第一次提交还在路上，一旦失败，这条动作**永久丢失**。`drainAlarmActions` 本身也没有串行锁（恢复前台 + `appStateChange` 轮询是两个入口）。 | ① `handleAlarmAction` 先查**提交中表**（`inflightAlarmActions`，按事件 id 复用同一个提交 Promise），再查已落库台账；② `performAlarmAction` 拆出真正的动作体；③ `drainAlarmActions` 改为单飞（并发进入复用同一次排空）。 |
| **G2** | 动作回滚只还原原事项 6 个字段：`spawnNextInstance` 新增的下一期不撤、`ackAdvancedAt` 不还原；且 `ackItem` / `completeItem` / `snoozeItem` 各自还会先发一次不等待的 `save()` —— 一次动作变成多次落库，失败后库里留下半个状态，重试又多派生一期。 | ① 引入动作事务：事务内 `save()` 不落库，由事务出口统一 `await saveAsync()` 一次提交；② 回滚改为**定点**：只撤回本事务派生出的实例（动作体同步执行，用「开始前的 id 集合」精确识别）+ 逐字段还原被操作的那一条；③ 回滚不再按旧 id 集合整体过滤 `state.items`（那会连带删掉期间由别的动作新建的事项）。 |
| **G5** | `init()` 是异步的：`loadAsync → applyParsedState` 会**整体替换** `state.items` 并重建全部事项对象。测试在它完成前直接改 `app.state`，写入的对象被这次恢复丢掉，断言落在孤儿对象上（表现为「动作看着成功、状态却没变」）。测试里没 `await` 的异步动作还会在后续触发失败回滚，进一步污染状态。 | ① 应用暴露**初始化完成信号** `ready()`（`startApp()` 返回一个总兑现的 Promise）；② `test-smoke.js` / `test-regressions.js` 一律先 `await app.ready()`；③ 异步动作测试改为 `await` 返回的提交 Promise；④ 清掉上一轮遗留在 `test-smoke.js` 的调试插桩。 |
| **附带** | `alarmEventLog` 裁剪按 `Date.now()` 排序：事件 id 可能是数字型字符串（JS 对象对整数型键按数值排序、不保插入顺序），且整套动作常在同一毫秒完成 —— 刚写入的那条可能被排进「最旧」批次被立刻删掉，崩溃重放保护直接失效。 | 记账时刻改为**单调递增**（`Math.max(Date.now(), last + 1)`），排序稳定且向下兼容历史时间戳。 |

---

## 验证方法（可复现）

1. **全量入口**：`npm test` → unit 29 / native 103 / smoke 161 / regressions 49，共 **342 项全部通过**。
   > **第四轮后更新**：本轮（第三轮）的修复本身引入了两条新缺陷（H1 抑制跨越 await、H2 让镜像失败否定提交），
   > 已由 `review-round4-fixes-2026-09-17.md` 修掉。当前基线为 regressions **65**、共 **358** 项，
   > 同一条区分度回退路径下失败 **28** 项。本文档其余内容保持第三轮当时的判断。
2. **定向回归**：`node test-regressions.js`。每个案例都用**真实的**业务与队列函数，
   只把 DOM / 存储 / 原生桥换成可控 mock；写事务的「完成 / 失败」由测试显式释放，
   因此「提交未落地就被确认删除」「提交失败留下半个状态」可以稳定复现而不是碰运气。
3. **区分度验证**（证明这些测试真的能发现问题，而不是恒真）：
   把本轮修复按语义逐条回退（G1 只查内存台账、G2 不抑制内部 save 且不做定点回滚、
   G3 恢复「时刻过了就当已送达」、G4 恢复「所有非终态成员一律归档」、
   `drainAlarmActions` 去掉单飞、`reconcile` 不上报撤销），同一份回归测试会**失败 22 项**，
   且症状与复核报告描述一致（例如 `A` 变成 `archived`、`p24` 被写成 `delivered`、
   并发第二次调用 `resolved`、提交失败后 `items=0`）。
4. **边界与未覆盖**：`git diff --check` 通过。
   Android 编译 / Lint / APK 安装 / 锁屏 / 重启 / 真机通知与设备故障恢复：**NOT_PERFORMED**
   （本机无 JDK 17 / Android SDK / 模拟器）。**本文档不构成安卓实机 PASS。**
