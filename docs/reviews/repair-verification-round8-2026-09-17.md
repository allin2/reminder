# 第八轮修复复核

结论：**K1 原场景已修复，397 项测试全通过；新逐字段回滚仍有一个 P1 缺陷，尚不能整体通过。**本轮只审核，未修改产品代码。

基线：main，HEAD `7972af7c516bb72040c82d62984384d59a1caae0`，审核当前未提交工作区，保留全部已有修改和未跟踪文件。

## K1 核验

本轮增加 revertActionFields 与失败后的周期顺延重放，completeItem 和回滚共用 advanceSeriesOnArchive。正式回归中的“ACK 提交中完成本期 → ACK 失败 → 完成保存成功 → 重载”已通过；恰好保留一个下一期，原 K1 复现关闭。

## M1 · P1 · 相同字段值不代表没有后续操作，回滚会破坏第二次稍后

位置：`app-core.js:3394` 的 revertActionFields、`:1546` 的 snoozeItem。

revertActionFields 用 `it[k] === post[k]` 判定字段后来没有被修改，并恢复动作前的值。但两个不同用户动作可以有意写入同一个字段值。例如两次稍后都写 status=snoozed、scheduleBasis=elapsed、localTrigger=null；第二次虽然选择了不同提醒时间，这些字段依然相等。第一次动作失败时，它们会被错误撤销，第二次的 triggerAt/snoozeDelayMs 却保留下来，形成不一致的状态组合。

### 独立复现与重载

复用当前 test-regressions.js 的真实应用和存储适配器、createDisk/boot/releaseCommits；只在内存拼接探针，无源码或测试文件修改。

1. 保存一条 due 事项。
2. handleAlarmAction(snooze) 将其设为两小时后，扣住数据库提交。
3. 用户通过普通 snoozeItem 将同一事项再次设为四小时后。
4. 第一笔提交失败，等待回滚；第二笔保存成功。
5. 使用同一模拟磁盘启动新应用，检查恢复后的事项。

实测：

```text
第一次提交失败后：status=due，triggerAt 仍为第二次选择，snoozeDelayMs=14400000，scheduleBasis=wall-clock
重启后：status=due，triggerAt 已不等于第二次选择，snoozeDelayMs=14400000，scheduleBasis=wall-clock
```

正确结果应是 snoozed、elapsed，保留四小时后的选择。当前回滚恢复旧 scheduleBasis/localTrigger，重载时按旧本地时间恢复又进一步改变 triggerAt。用户明确作出的第二次稍后因此丢失，即使其保存成功。

### 修复建议与验收

不能用值相等推断字段写入归属。应记录后续业务操作并在失败后的有效状态上重放，或让相关业务变更统一串行执行；若采用字段版本，也须同时维护 status、triggerAt、scheduleBasis、localTrigger、snoozedAt、snoozeDelayMs 的整体契约。仅为这两个相同值字段加例外不能建立可靠回滚语义。

新增验收：两次不同时间的稍后，前失败后成功，重载后仍为 snoozed/elapsed、第二次选择时间和延迟完整保留。覆盖同值重复操作、wall-clock 与 elapsed 切换，并保留 K1 成功/失败对照、I1/J1 和原存储回归。

## 验证与边界

- `npm test` 退出码 0：unit 29、native 103、smoke 161、regressions 104，共 **397/397 通过**。
- `git diff --check` 通过。
- M1 为真实 JS 业务/存储代码 + 可控 IndexedDB mock 的独立复现，包含模拟磁盘重载；未访问用户数据库。
- Android 编译、Lint、安装、锁屏、重启、真实通知及设备存储故障恢复：**NOT_PERFORMED**。本报告不构成安卓实机 PASS。
- 本轮仅新增本报告，没有提交、推送或替换 APK。
