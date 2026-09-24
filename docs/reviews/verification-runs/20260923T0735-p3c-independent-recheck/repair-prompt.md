# 给实施 agent：P3-C-R 重绑后旧事务包装函数修复

仓库 `/Users/qlyf/Developer/reminder`。先读 `docs/handoff/2026-09-22-p3c-app-transaction-extraction-plan.md`、P3-C 实施报告和独立复验 `docs/reviews/verification-runs/20260923T0735-p3c-independent-recheck/README.md`。本任务是修复独立复验的阻断项；实施方自测不能代替后续独立验收。

当前冻结身份：HEAD/origin/main `3574824357dc7beb04cbd3e32aa413cd508e8484`；`app-core.js` SHA-256 `0a5ae42b518021a95a4a6d2c8dccd4cbf0f4c3feac00a2c2c7dea1d36c2a7c89`，`lib/app-transaction.js` `e6df807a8330c618ce5d9e4b7a4087bfe7f07fbab1b32a8693a49908b71dea48`。工作区有大量有意保留的脏文件、历史证据与 APK；不得 checkout/reset/stash/clean，不覆盖旧 run 或 APK，不提交推送。先重验当前字节，若身份变化先记录差异并以实际字节为准。

阻断：`app-core.js` 的 `wrapUserOp()` 把首次 `appTransaction.wrapUserOp(fn, options)` 的结果永久缓存；`bindRuntime()` 重绑新事务后，已创建的包装命令仍用旧实例。复验 A/B 原始探针：`docs/reviews/verification-runs/20260923T0735-p3c-independent-recheck/repro-stale-transaction.js`，输出见同目录 `.log`。无重绑对照：同事项命令返回 `false`、保存未决时可见状态不变、无冲突命令在提交后仍在。重绑后：同事项命令错误返回 `true` 并提前改变状态，另一命令在提交后消失。

要求以最小闭环修复核心薄转发：每次调用必须使用当前事务实例，或者缓存严格按实例身份失效。保留 `AppTransaction` 11 项契约、模块唯一实现、P3-B 持久化权威与 FIFO、原生语义、UI 文案。不要改 `lib/storage.js`、`lib/native-reminders.js`、导入 schema 或 Android 原生代码。

把 A/B 变成正式生产组合测试：先调用包装函数建立旧缓存，重绑并恢复，再让新事务的权威写 Promise 挂起；期间同事项命令必须返回 `false`、可见状态保持原值，无冲突命令必须按序重放并在提交后保留。还要在临时副本中把旧永久缓存写法加回去，证明这条正式测试变红；临时变异不得改产品字节。沿用原有 D41 回归与 P3-C 九项变异，不删减旧断言。注意原独立探针的退出 0 表示“成功复现缺陷”，修复后它应不再满足旧期望，不能把它当通过标准。

`app-core.js` 内容改变后按本仓约定把 `sw.js` v26 递增并记录预缓存版本。跑 `npm test`（原水位 642/324/587/266/730/160 不下降）、静态契约闭合、受影响 Chrome 场景、UI 对照；重新 `cap:sync`、assembleDebug，验证 30 个源 Web 资源与 www、Android assets、debug intermediate、APK 逐字节一致。给新 run 保存产品前后 SHA-256、原始日志/退出码、A/B 正反例、变异结果与 NOT_PERFORMED。真机和物理离线升级未实测时明写 NOT_PERFORMED。完成后把路径与哈希交回独立验收方复验。
