# 统一事务修复独立复核

结论：**T1 的直接路径已关闭，独立复跑 533 项全通过，但仍有一个 P1 已接受操作丢失缺陷，不建议直接落回主工作区或作为封装验收通过。**

## 审核对象和证据

- 已读取用户指定任务 `01a0ad11-0ccc-7963-bc6d-e28842d28b0d` 的交付与执行记录，并检查实际文件。
- 修复位于 `/Users/qlyf/.codex/worktrees/5158/reminder`，HEAD `7972af7c516bb72040c82d62984384d59a1caae0` 上的未提交工作区；不是 `/Users/qlyf/Developer/reminder` 的当前运行代码。
- 审核了隔离草稿、提交/发布、命令重放、周期身份、通知确认边界及新增表驱动测试。
- 独立运行 `npm test` 退出码 0：29 unit + 105 native + 161 smoke + 238 regressions = **533/533**。
- `node --check app-core.js`、`node --check lib/native-reminders.js`、`git diff --check` 通过。

## 已确认的改进

原生动作提交前不再把派生下一期发布给用户，因此原 T1 的“用户修改未提交派生实例、创建失败后丢失”路径被阻断。通知栏改状态也调用同一事务入口，移除已送达通知等待业务 Promise。原有回归经过新异步契约调整后全绿。

这次结构比共享状态回滚更清楚，但“提交期间 UI 继续操作旧状态、成功后重放到新状态”仍需要显式处理业务前置条件冲突。

## U2 · P1 · 完成提交期间接受的稍后被静默丢弃，两笔都成功也会发生

位置：`app-core.js:712` 重放忽略业务函数返回值；`:1679` 附近 snoozeItem 的终态保护；`:3704` 重放与 `:3715` 草稿发布。

原生 done 的不可见草稿为 archived，但可见事项仍是 due。用户此时能正常点击稍后，snoozeItem 返回成功、显示“已改到”，并排队保存。done 提交成功后，重放针对 archived 草稿调用 snoozeItem；终态保护返回 false，重放器却没有将业务拒绝识别为冲突。随后发布 archived 草稿覆盖刚接受的稍后，排队保存也写入这个归档状态。

### 独立复现

使用修复工作树当前 test-regressions.js 的 createApp/boot/createDisk/releaseCommits/restartApp 与真实业务函数，内存中拼接探针，未编辑测试或产品代码：

1. 保存 due 事项 A。
2. 原生 handleAlarmAction(done) 开始提交，扣住数据库完成回调。
3. 用户 snoozeItem(A.id, now+3h)，观察到 snoozed 且 triggerAt 等于所选时间。
4. done 的提交成功，稍后的排队保存也成功。
5. 同一模拟磁盘重新启动应用。

```text
USER_ACCEPTED: status=snoozed, chosen=true
AFTER:         status=archived, chosen=false
RESTART:       status=archived, chosen=false
```

这里没有注入任何存储失败；只延迟完成回调以模拟用户连续操作。用户以为稍后仍会提醒，最终提醒被归档，重启不能恢复。

### 必须解决的语义

不能把 reducer 的 false/no-op 当作重放成功。应统一决定冲突命令是延迟接受、明确拒绝并反馈，还是作为用户最新意图合法重开/改期；在命令实际适用的状态上校验，反馈与持久化结果一致。仅发现 false 后继续或静默改回旧值不足以修复。若采用补偿，仍需验证权威提交已发生后的失败及崩溃窗口。

## 验证覆盖差距

新增表驱动测试实际是五组手工选择场景，包含“完成失败→稍后”和“完成成功→删除”，恰好没有“完成成功→稍后”。它不能支持“已接受后续命令都不丢”的全面结论。

建议至少将原生 ACK/snooze/done 与同对象 ACK/完成/稍后/编辑/删除/停止周期的成功和失败组合表驱动展开，显式覆盖终态前置条件变化；三层校验用户接受结果、持久化及重载。对“拒绝”也断言清楚反馈，不只检查未抛异常。继续保留派生对象身份、原生事件确认和存储失败场景。

## 边界

本轮为独立只读产品审核，仅新增本报告；未修改产品代码、源目录、提交或推送，也未把修复落回主工作区。

Android 编译、Lint、安装、锁屏/Doze/重启及真实通知交互均 **NOT_PERFORMED**。JavaScript/mock 证据不能替代安卓实机验收。
