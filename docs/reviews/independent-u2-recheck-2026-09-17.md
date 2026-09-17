# U2 最新修复独立复核

结论：**本轮 U2 修复及所检查的相关 JavaScript 事务场景通过，未发现新的可复现阻断问题。此结论不是安卓封装或实机验收 PASS。**

## 审核对象

已读取任务 `01a0ad11-0ccc-7963-bc6d-e28842d28b0d` 最新交付，并检查实际工作树 `/Users/qlyf/.codex/worktrees/5158/reminder`。Git HEAD 为 `7972af7c516bb72040c82d62984384d59a1caae0`，修复仍未提交、未落回源目录。

本轮源码指纹：

- app-core.js SHA-256：`6d58aa7ef1dff64395ac29c78c99614e540b3f0a3a37253c18c28c391ff3822f`
- lib/native-reminders.js：`f675faba4ddb944ad2742cc149d1017b9490da1c92a98af099eb5b9a0d397190`
- test-regressions.js：`e564088beb0399eb4db74e653083654f7638c5c61df10490cb41f4bdd07aa18e`

## 根因修复核验

当前明确采用“同事项/同周期在原生提交期间拒绝新点击，用户稍后重试”的合同，而非先显示成功再重放覆盖。activeActionScope 在原生事务期间生效、finally 释放；runUserOp 在业务变更前检查冲突，返回 false 并显示正在保存。编辑路径在拒绝后不继续保存/关闭表单。重放对 false 也报告错误，不再把它当无条件成功。

已审查 36 组合矩阵（3 原生动作 × 6 UI 命令 × 2 提交结果）：它检查拒绝返回值、非成功提示、编辑输入保留、内存、权威快照、重载、事件台账和派生唯一性。新合同改变了并发同对象操作的接受方式；相关测试按明确拒绝验证，不把丢弃已接受操作当成功。

## 独立复现检查

额外使用真实业务函数和现有可控存储 harness，重跑原 U2 非周期事项场景，并同时操作无关事项 B：

| 原生完成结果 | 提交期间 A 的稍后 | B 完成 | 结果/重载 |
|---|---|---|---|
| 成功 | false，未接受 | true | A archived；B archived；原生事件已记录 |
| 失败 | false，未接受 | true | 事务结束后 A 稍后重试为 true；重载 A snoozed 且为所选时间，B archived；失败事件未记录 |

这确认原来的“稍后先成功后消失”复现关闭，无关操作保留，失败后事务锁释放，重试可持久化恢复。

## 本轮执行验证

- 独立运行 `npm test`，退出码 0：unit 29、native 105、smoke 161、regressions 559，合计 **854/854**。
- `node --check app-core.js`、`node --check lib/native-reminders.js`、`git diff --check` 通过。
- 源目录 tracked diff SHA-256 仍为 `eea5f1a4c17b3e432fac44f27792d449ef2f712f9b567efc0dd7fbd4af20d888`，与交付记录一致。这只证明该 tracked diff，不代表所有未跟踪文件也做了哈希比较。

## 边界与下一步

本轮检查为源码与 Node/VM/mock 行为验证，没有运行真实浏览器点击或 Android 实机。该任务报告 Android Gradle 在配置阶段受 Java 24 阻塞；本轮没有重新运行该构建，也不将它记为通过。Android 测试、Lint、APK、锁屏/Doze/重启和通知交互仍未验证。

可以进入受控增量整合及目标环境验证阶段；整合后须在源目录再跑必要检查，不能整目录覆盖。当前仅新增本独立报告，未修改产品代码、提交、推送或合并工作树；旧独立审核报告保留，U2 以本报告标记关闭。
