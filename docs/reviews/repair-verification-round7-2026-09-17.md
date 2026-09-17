# 第七轮修复复核

结论：**J1 原复现已关闭，381 项测试全通过；仍有一个 P1 周期连续操作缺陷，尚不能整体通过。**本轮只审核，未修改产品代码。

基线：main，HEAD `7972af7c516bb72040c82d62984384d59a1caae0`，对象为当前未提交工作区；保留全部既有修改及未跟踪文件。

## J1 核验

performAlarmAction 现在把 applyAlarmAction 整体放入 runCommit，校验、共享状态变更、派生、事件台账、提交与失败回滚均在队列任务内执行。原“较早保存提前写入后到 ACK”的路径已被阻断；本轮正式回归覆盖该三笔提交场景并通过。

## K1 · P1 · ACK 提交期间完成本期，ACK 失败回滚后下一期消失

位置：`app-core.js:1507` 的 completeItem、`:3370` 的 rollbackItemTransaction、`:3527` 附近的失败回滚路径。

普通 UI completeItem 仍直接操作共享 state，未进入动作串行边界。ACK 提交进行中时，它已经能看到 ACK 派生的下一期和 ackAdvancedAt，于是完成本期时跳过再次派生。若 ACK 提交随后失败，回滚会删除未被修改的下一期，却因本期 rev 已被 completeItem 推进而跳过本期字段恢复。本期因此保留 archived 与 ackAdvancedAt，但下一期已经不存在。

这是跨事项依赖未被版本守卫保护的问题：下一期本身没有被后续操作修改，但后续“完成本期”已经依赖它存在。不能将“对象 rev 未变”等同于“后续操作不依赖该对象”。

### 独立复现与重载

使用当前 test-regressions.js 的 createApp/boot/createDisk，以及真实 app-core.js、storage.js；只在内存拼接探针，无产品或测试文件修改。

1. 保存一条 ACK 模式的每周周期事项 A。
2. 调用 handleAlarmAction(ack)，扣住数据库提交；确认 A 已 acknowledged、ackAdvancedAt 有值，事项总数为 2。
3. 普通调用 completeItem(A)，模拟 UI 点击“完成”。
4. 让 ACK 提交失败，等待失败回滚；再让“完成”的保存成功。
5. 使用同一模拟磁盘重启，等待 boot 后检查。

实测：

```text
ACK 提交中：A=acknowledged，ackAdvancedAt=true，items=2
失败后：A=archived，ackAdvancedAt=true，items=1，active=0
重启后：仅 A=archived，repeat={mode:ack,every:week}，ackAdvancedAt=true
```

界面代码仍提示“已完成 · 下一周期已生成”，但实际上没有下一期，周期静默中断。原生失败事件重试时源事项已经是终态，也不会重新派生下一期。

### 修复建议与验收

让同一事项及其周期派生关系上的后续操作基于已提交状态执行：把普通完成等相关业务动作也纳入一致的串行操作边界，或在前一笔失败后重放后续业务意图。仅保留新 rev、按子实例 rev 决定删除不足以维护周期依赖关系；不应通过重新覆盖用户后来的完成状态来修复。

补测“周期 ACK 提交中 → UI 完成本期 → ACK 失败 → 完成保存成功 → 重载”：本期保持已完成，恰好存在一个有效下一期，不残留已处理失败事件标记。并保留 ACK 成功时不重复派生、I1/J1、其他事项保存及同事件并发的回归。

## 验证与边界

- `npm test` 退出码 0：unit 29、native 103、smoke 161、regressions 88，共 **381/381 通过**。
- `git diff --check` 通过。
- K1 为真实 JS 业务函数/持久化适配器 + 可控 IndexedDB mock 的独立复现，包含模拟磁盘重载；未访问用户数据库。
- Android 编译、Lint、APK 安装、锁屏、重启、真实通知及设备存储故障恢复：**NOT_PERFORMED**。本报告不构成安卓实机 PASS。
- 本轮仅新增本报告，没有提交、推送或替换 APK。
