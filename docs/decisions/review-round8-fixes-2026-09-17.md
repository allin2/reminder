# 第八轮复核修复决策（2026-09-17）

范围：落实 `docs/reviews/repair-verification-round8-2026-09-17.md`（M1）。

编号承接 `interaction-logic-2026-09-16.md` 的 D1–D25、`review-fixes-2026-09-16.md` 的 D26–D27、
`review-round3-fixes-2026-09-17.md` 的 D30–D31、`review-round4-fixes-2026-09-17.md` 的 D32–D33、
`review-round5-fixes-2026-09-17.md` 的 D34、`review-round6-fixes-2026-09-17.md` 的 D35、
`review-round7-fixes-2026-09-17.md` 的 D36。

第七轮把回滚从「整条跳过」改成「逐字段比值撤销」，方向对，但**判据错了**：
值相等只能说明「这个字段现在的值恰好等于动作留下的值」，**不能**说明「之后没人写过它」。
两个不同的用户动作可以有意写进同一个值。这一轮把它换成**不依赖任何值比较**的机制。

---

## D37 · 回滚 = 整体还原 + 重放用户后来的业务操作（废除逐字段比值）

| # | 决议 | 依据 |
|---|---|---|
| **D37** | 动作提交失败的回滚改为三步：<br>① 撤回本事务派生的实例（仅限之后 rev 未变的）；<br>② 被操作项**整体**还原成动作前的快照（等价于「这次动作从未发生」）；<br>③ 按原顺序**重放**该窗口期内用户做过的业务操作 —— 只重放「实际动过被还原事项或被撤派生实例」的那些。<br>**删除** `revertActionFields` 的逐字段比值逻辑，**删除** K1 的顺延特例分支。 | M1：`revertActionFields` 用 `it[k] === post[k]` 判断字段归属。两次「稍后」都写 `status=snoozed` / `scheduleBasis=elapsed` / `localTrigger=null`，只有 `triggerAt` / `snoozeDelayMs` 不同 —— 这三个字段被判成「之后没人动过」而还原成第一次动作前的值，于是留下「第二次选的时间 + 第一次的时间语义」。重启时 `migrateItem` 又按那套语义重算 `triggerAt`，用户明确做出、且**提交成功**的第二次选择就丢了。 |

### 机制：`runUserOp` / `replayUserOps`

- **窗口**：`applyAlarmAction` 在**同步变更体之后**、`await writeSnapshot()` 之前把
  `inflightActionDepth` 加一，提交定成败后在 `finally` 里减一。窗口内用户做的业务操作会被记进
  `pendingUserOps`。开在变更体之后是必须的 —— 动作自己的写入不是「用户的后续操作」。
- **记录**：每条记录带 `touched` —— 用 `bumpRev` 前后的**版本差**算出「这次操作到底动过哪些事项」
  （含被它删掉的事项）。这是**写入归属**的直接证据，不是值的比较。
- **重放**：只重放 `touched` 与被回滚影响的事项（被还原的那条 + 被撤掉的派生实例）有交集的记录。
  其余的（用户顺手完成了另一条无关事项）没有被回滚波及，重放只会重复施加副作用 ——
  `spawnNextInstance` 没有去重，重复的 ACK 会凭空多出一期（有专项回归守住这条）。
- **重放不落库**：回滚正在占用提交闸门，重放期间抑制内部 `save()`；用户那次操作自己的保存请求
  早已排队，它出队取快照时读到的就是重放之后的正确状态。同理抑制提示，避免同一句 toast 弹两次。

### 被纳入日志的操作

`ackItem` / `snoozeItem` / `completeItem` / `reopenItem` / `restoreItem` /
`resumeDeadlineProtection` / `deleteItem` / `stopRepeat` / `markReviewDone`
—— 统一在启动前用 `wrapUserOp` 包一层（`markReviewDone` 是参数自足的纯字段写入，
而整理会话确认时改的正是这条事项；通知栏动作也经由这几个函数，所以一并覆盖）；
编辑保存把字段变更抽成 `applyItemEdit(it, values)` 单独记录（`saveItemFromForm` 要读表单，
重放时表单已关，不能直接重放它）。

**刻意不纳入**：`promoteDue` / 对账 / 渲染（自动推进与纯展示，不是用户的业务意图，且时间驱动
的推进下一拍会自己重算）、整理会话（Review）里的动作（作用于待整理的那一条，与闹钟动作的对象
不同，回滚碰不到它）。

### 顺带解决

K1 的「完成本期 → ACK 失败 → 下一期消失」不再是特例：`completeItem` 被重放时，
源事项已经回到动作前的状态（`ackAdvancedAt` 已消失），`advanceSeriesOnArchive` 自然补出下一期。
**D36 的第 ② 条（顺延特例）由本决议取代**；D36 的第 ③ 条「共用一处顺延实现」保留。

### 仍未覆盖

- `handleNativeNotificationAction` 仍不在动作串行边界内（承 D35/D36 的说明）。
- 不纳入日志的自动推进（`promoteDue`）在极窄的窗口内被回滚覆盖，由下一拍自行重算。

> **⚠️ 第九轮更正（D38，2026-09-17）**：本决议的**撤销范围**不足 ——
> 第 ② 步只还原「被操作的那一条」，第 ① 步只撤「本事务派生出来的实例」，
> **没有撤销用户操作首次执行时产生的副作用**。用户在提交期间 ACK 一条周期事项时，
> 那次 ACK 自己派生的一期不在其中，重放再派生一次 → **两个下一期**（N1）。
> 现已改为：窗口开始前拍**全量**基线，失败时整体退回基线再重放用户操作
> （重放时复用该操作当初新建实例的 id）。见 `review-round9-fixes-2026-09-17.md`。

---

## 验证方法（可复现）

1. **全量入口**：`npm test` → unit 29 / native 103 / smoke 161 / regressions **131**，共 **424 项全部通过**；
   `git diff --check` 通过。
2. **区分度验证（四条口径）**：
   - 把 D30–D37 的修复**全部**按语义逐条回退 → 同一份回归**失败 53 项**。
   - **只回退 M1**（恢复逐字段比值 + 不重放）→ **失败 9 项**：M1/M1b 专项 5 项 + K1 专项 4 项
     （同一机制，属预期）。M1 专项症状与复核探针逐条一致：
     `M1 内存：第二次稍后完整保留 — status=due basis=wall-clock trigger=<第二次选择> delay=14400000`、
     `M1 磁盘：… {status:due, basis:wall-clock, trigger:…, delay:14400000}`、
     `M1 重载后：… — {status:due, basis:wall-clock, trigger:<被重算成另一个值>}`。
   - **只回退提交闸门**（I1，恢复「提交不过闸门」）→ **失败 14 项**；
     **只回退动作隔离**（J1，恢复「动作先改共享 state 再入队」）→ **失败 47 项**。
     这两条在 131 项的口径下比前几轮更多：M1 的用例同样依赖「快照在轮到自己时才生成」
     与「动作整笔在闸门内」，所以一并被这两条回退打掉。
3. **新增验收**（按复核要求）：
   - 两次不同时间的稍后、前失败后成功，**重载后仍为 `snoozed` / `elapsed`**，
     第二次选择的时间与延迟完整保留（M1）；
   - 同值重复操作（`status` / `scheduleBasis` / `localTrigger` 完全同值）；
   - wall-clock 与 elapsed 互相切换（M1b：第一次 elapsed、第二次 wall-clock，
     重载后按钟点重算得到同一个时刻）；
   - 提交在途期间的**编辑保存**必须被保留（M1c）；
   - 无关事项的操作不得被重复施加、派生实例不得翻倍（M1d，守护重放的过滤规则）；
   - K1 成功/失败对照、I1/J1、G1–G4、与原存储回归全部保留。
   断言里**不放毫秒级相等的判据**（`snoozeDelayMs === 4h` 会随时钟是否正好跨过 1 ms 波动，
   实测确实抖过一次）：改成**契约自洽**（`snoozedAt + snoozeDelayMs === triggerAt`）+ 容差比较，
   连续三跑 npm test 与两次口径复跑结果完全一致。
   回归 harness 另外新增 `setField(selector, value)`，用来驱动「读表单再保存」的编辑路径。
4. **边界与未覆盖**：Android 编译 / Lint / APK 安装 / 锁屏 / 重启 / 真实通知与设备存储故障恢复：
   **NOT_PERFORMED**（本机无 JDK 17 / Android SDK / 模拟器）。**本文档不构成安卓实机 PASS。**
