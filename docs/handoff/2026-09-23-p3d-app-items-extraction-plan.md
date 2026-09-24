# P3-D `app-items.js` 事项命令迁出：实施与独立验收交接

## 1. 目标、基线和保护

从 `app-core.js` 迁出事项业务命令与周期派生，形成唯一 UMD 实现 `lib/app-items.js`；核心只保留装配、现有调用点所需的薄转发和 UI/平台适配。此批不宣布整个 P3 或整体模块化完成；原生协调、Review 会话、Web 提醒与测试 hook 清理属于后续批次。

开工必须重验实际字节。2026-09-23 P3-C-R 独立通过时的基线：`main` / HEAD = `origin/main` = `3574824357dc7beb04cbd3e32aa413cd508e8484`；`app-core.js` SHA-256 `e7459c98b082c1ef03e8ecc1298b286bb9952cebe4cd90889d516c0221f17d05`，`lib/app-transaction.js` `e6df807a8330c618ce5d9e4b7a4087bfe7f07fbab1b32a8693a49908b71dea48`，`lib/app-persistence.js` `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50`，`lib/app-model.js` `0219c576a82d4df6fefe4dca62561c491f1b36c97d59de426afff7ccad41f94e`，`sw.js` v27 `ed487b5489b01c5aa179e43da497f010013dea8c03725e7f93c03b28315c431f`。测试地板 642 unit / 324 native / 619 boot / 266 smoke / 730 regressions / 160 parse；UI 590/590 DOM、567/567 格式；生产链 21 支脚本、30 项源 Web 资源。独立复验入口：`docs/reviews/verification-runs/20260923T0803-p3cr-independent-recheck/README.md`。

工作区有大量有意保留的脏条目。不可 checkout/reset/stash/clean，不可覆盖旧 run、旧 APK、候选或用户数据；不得提交/推送。新证据放独立 run 目录，构建前冻结现有 Debug APK 的哈希与副本或在隔离构建输出进行，避免覆盖唯一候选。若实际基线变化，先记录差异再实施。

## 2. 迁移归属与明确边界

先制作“原函数/可变状态 → 新主人 → 调用者 → 命令装饰点 → 行为断言”表。`lib/app-items.js` 唯一拥有下列仍在 core 的事项规则及其私有辅助；旧实现体必须删掉：

- `promoteDue`；周期辅助 `ensureSeriesId`、`seriesMembers`、`isUnstartedInstance`、`spawnNextInstance`、`advanceSeriesOnArchive`；
- `ackItem`、`completeItem`、`snoozeItem`、`deleteItem`、`reopenItem`、`restoreItem`、`resumeDeadlineProtection`、`stopRepeat`；
- `applyItemEdit`、`applyNewItem`、`applyProjectRemovalToItems`；
- 完成撤销的业务与状态：`applyCompleteUndo`、`revertCompleteUndo`、`undoLastComplete`、`lastCompleteUndo`；新建撤销 `undoNewItem`。有限时窗、当前 rev、已投递证据、周期派生整组回收与保存失败回滚语义必须保留。

可用少量具名回调把 toast/render、打开稍后面板、原生重排请求、撤销后的原生核查标志留给核心平台/UI 层；不能把 DOM、`window`、完整核心 API、全局 service locator 或巨型 `ctx` 塞进事项模块。状态必须经实时 getter/setter 访问，尤其要跟随 P3-C 草稿临时切换和恢复时数组替换；不得闭包缓存旧 `state.items`。工厂求值/创建不得写状态、读库、绑监听、起定时器或排钟。

以下所有权不在本批变动：P3-A `makeItem`/`normalizeItem`/`bumpRev`/终态等模型；P3-B 权威恢复、`save`/FIFO/快照/镜像；P3-C `runUserOp`/`wrapUserOp`、冲突域、草稿、重放、原生动作提交；`lib/repeat.js` 的日历规则；AppCapture 表单字段/会话和 `saveItemFromForm`；Review 的 `markReviewDone`；原生协调与事件台账的 `refreshNativeScheduleBasis`、`applyDeadlineEvents`、`markDeadlineDelivered`、监听/桥/reconcile；Android 原生与备份 schema。必要的命名回调接线可改 core，不能在新模块复制这些算法。

## 3. 装配与易错时序

把 `AppItems.createAppItems(deps)` 加到启动前依赖闸门，实例逐项验证后与所检查的同一对象绑定。工厂可接收延迟调用的命名函数，以解决 AppTransaction ↔ AppItems 的运行时相互引用；不得在工厂创建时调用尚未绑定的实例。核心、事务实例、AppCapture/AppContent、UI 事件和 `__ATTENTION_INBOX__` 必须调用同一组已装饰命令，不能出现旧裸函数或二次装饰。P3-C-R 修好的实例身份缓存失效行为必须保留：重绑后命令改用当前事务实例，旧闭包不可绕过冲突或丢失无冲突命令。实例契约与 `production-scripts.js` 双向闭合，检查缺项与未使用项。

逐条保持：ACK 不等于完成；`ack` 周期由 ACK 产生下一期，`calendar` 周期由完成按原定日期产生下一期，稳定 `seriesId`/`repeatParentId`/创建 ID；终态/旧通知不再派生；停止重复只归档当前和未开始的未来实例，已确认/已投递历史保留；snooze 的 elapsed/wall-clock 及新轮计数；恢复归档不自动提醒并暂停截止保护；编辑未改时间不丢提醒身份，明确清除不被标题时间词恢复；完成撤销仅在时窗/rev/未投递条件下生效，保存失败回滚并可重试。所有命令仍经 D41 冲突检查和按序重放。`promoteDue` 在原生动作写入在途时跳过。

## 4. 生产链、反例和验证

新增模块后预计 22 支生产脚本、31 项源 Web 资源；调整 `index.html` 加载顺序、`sw.js` v27→v28 及 ASSETS、smoke/regressions/boot 有序清单、`production-scripts.js` 命名空间与实例 API 静态闭合、`package.json` 直测入口。`scripts/sync-www.js` 若仍自动同步 `lib/*.js`，无需修改其逻辑。

直测真实模块（非复制一份算法）并与生产组合测试覆盖：缺整支模块、空命名空间、工厂抛错、每个实例成员缺失均 `ready=false`、明确点名 `AppItems`、0 IDB put/0 native schedule/无业务心跳；正常 Web 组合可用。测试必须把命令执行前、权威保存未决、保存兑现/拒绝、重启读回串起来，特别是同事项/同周期拒绝与无关命令重放；P3-C-R 的重绑 A/B 不得退化。反向变异至少针对 ACK 与完成推进时点、稳定派生 ID、停止重复历史保留、撤销条件/失败回滚、编辑时间身份、`promoteDue` 在途阻断、绕过 `wrapUserOp` 的入口和静态契约漏项；每条应让同一正式测试变红，变异只作用于临时副本。

保留并重跑 D41 `test-regressions.js` 的 G1/G2/G4/H1/I1/J1/K1/M1/N1/P1/Q1/T1/U2 等历史断言，以及当前 P3-C-R B7、P3-B/P3-C 变异；不得删减/跳过来换绿。`npm test` 各套不得低于上述基线，UI 对照 590/567 持平；受影响真实 Chrome UI/恢复/捕获检查与生产脚本组合通过。独立 run 保存源码身份、唯一归属清单、正反例、全量日志与退出码。完成 `cap:sync` 与 Debug APK 构建，逐字节比对全部 31 项源码→www→Android assets→debug intermediate→APK；检查旧资源/缺件。Android 真机行为和物理离线 SW 升级未做时明写 NOT_PERFORMED。实施方报告不可自称独立 PASS；交回我复验后才进入原生协调批次。
