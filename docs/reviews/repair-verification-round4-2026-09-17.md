# 第四轮修复复核

结论：**上轮直接复现已修复，正式测试全绿；事务边界仍有两个 P1 缺陷，暂不能整体通过。**本轮只审核，未修改产品代码。

基线：main，HEAD `7972af7c516bb72040c82d62984384d59a1caae0`，对象为当前未提交工作区。保留所有已有修改和未跟踪文件。

## G1–G5 复核

| 上轮项 | 当前结论 |
|---|---|
| G1 同事件并发提前确认 | inflight Promise 与 drain 单飞已补齐，上轮同事件并发复现关闭 |
| G2 周期回滚残留下一期 | 当前定点回滚撤销派生实例、恢复事项字段，内部重复保存已抑制；但新增全局保存抑制会丢其他操作，且双存储提交仍不一致，见 H1/H2 |
| G3 取消后误记送达 | 不再凭时刻推断 delivered，成功撤销且未到时记录 cancelled，原复现关闭；后台无送达证据时仍保持 scheduled 且不补发，为决策 D31 记载的限制，未实机确认 |
| G4 停止下一期误归档已确认历史 | 已按生命周期区分实例，保留已确认历史状态，原复现关闭 |
| G5 测试初始化竞态 | ready 与 await 已加入，正式入口通过 |

## H1 · P1 · 等待闹钟提交期间，普通用户操作的保存被静默丢弃

位置：`app-core.js:563`–`:567`、`:3426`–`:3445`。

actionTxnDepth 是全局计数，并且跨越 await saveAsync 持续为正。此时普通 UI 的完成、稍后、新建等操作仍可修改内存，但它们调用的 save() 直接 return，没有排队或事务结束后的补存。如果这些修改发生在 IndexedDB put 已克隆数据之后，当前提交也不包含它们。

独立探针复用 test-regressions.js 的真实应用沙箱，给 fakeDb.put 增加 JSON 快照以模拟 IndexedDB 在 put 时克隆数据：

1. A 执行闹钟 ACK，扣住数据库事务完成回调。
2. 等待 put 已执行后，普通调用 completeItem(B)。
3. 释放 A 的提交。

结果：`B memory=archived, persisted=due`。界面显示完成，但数据库仍为待处理；重启将恢复旧状态。现有 mock 只触发提交回调，不保存写入快照，因此 342 项通过不能排除此问题。

建议：只抑制动作同步变更体内部的重复 save；将其他保存请求排队并确保提交后执行，持久化使用独立快照。补测等待提交时操作另一事项，以及操作同一事项后前一事务失败，避免旧快照回滚覆盖新操作。

## H2 · P1 · localStorage 失败但 IndexedDB 成功，仍回滚内存并报告失败

位置：`app-core.js:535`–`:551`、`:3453`–`:3458`；存储适配器 `lib/storage.js` 的 save/load。

saveAsync 先尝试 localStorage，失败记入 err，然后仍然提交 IndexedDB；即便 IndexedDB 已成功，最后仍抛出之前的 err。performAlarmAction 因此回滚内存，而磁盘保留已提交的 ACK、派生实例和事件台账。重启优先从 IndexedDB 读回的结果与用户刚看到的回滚状态不同；继续操作也可能覆盖已经提交的动作。

独立探针：localStorage.setItem 抛出 quota，IndexedDB 提交成功，执行周期 ACK：

```text
failure=quota
memory.status=due, memory.items=1
disk.status=acknowledged, disk.items=2, disk.alarmEventLog[eventId]=true
```

这是两个存储只有一个失败的实际分支，不是“两者都不可用”的测试。原生队列会因 handler 抛错保留事件，但数据已提交，无法再把此次行为解释为成功回滚。

建议：明确权威持久化后端，以其提交结果决定成功；备用镜像写失败不能把已提交事务当成未提交。若要求双写，须有可恢复的一致性协议，不能只回滚内存。补测 localStorage 失败/IndexedDB 成功、反向失败及重启恢复。

## 本轮验证

- `npm test` 退出码 0：unit 29、native 103、smoke 161、regressions 49，共 **342/342 通过**。
- `git diff --check` 通过。
- H1/H2 使用真实业务函数和真实 storage.js，DOM/IndexedDB 为可控 mock，探针只在内存修改测试 harness；未修改产品和现有测试文件，未访问用户数据库。
- Android 编译、Lint、安装、锁屏、重启、真实通知与存储故障恢复：**NOT_PERFORMED**。JavaScript 测试通过不等于安卓实机 PASS。
- 本轮仅新增本报告，没有提交或推送。建议先修 H1/H2，再以持久化快照及重载结果补充回归证据。
