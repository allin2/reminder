# P3-E-R 实施自测报告：原生提醒协调模块两项阻断修复与反例复跑

## 1. 任务身份与工作区约束

- **仓库路径**：`/Users/qlyf/Developer/reminder`
- **身份定位**：P3-E 实施方自测报告（非独立验收方，本报告为实施自测凭据，交回独立复验方进行独立重验；不自称独立 PASS）。
- **Git HEAD**：`3574824357dc7beb04cbd3e32aa413cd508e8484`（`main` / `origin/main`）。
- **工作区保护**：严格遵守无 destructive git 命令约束，未执行 `git checkout`、`reset`、`stash`、`clean`、`commit` 或 `push`。既有脏工作区、历史证据目录与既有候选 APK 完整保留。

---

## 2. 源码哈希与产物状态比对

| 文件路径 | P3-E 复验前基线 SHA-256 | 本轮修复后 SHA-256 | 变更性质 |
| --- | --- | --- | --- |
| `app-core.js` | `4ee18ef557008ff77ea8c38a391515bbcf684ea68b693dc83296c050bc698ebc` | `664cc69fb5e5cd246e680e1f7548ad572c7717c1019c009bc11049cb0bb15989` | 协调器依赖显式传入 `handleAlarmAction`；保持通知入口 `onNotificationAction` 独立 |
| `lib/app-native-coordinator.js` | `a65cf2338ae0cf8f2b38992e5917fe283e742ca716b14620f4c0c16921312ea9` | `6d91d0047ef321651689dad7a5c3c98e660d48b1dc64c8f64bbf69963585f361` | `handleAlarmAction` 设为必需依赖；排空队列直达该处理器保留 `alarmEventId`；恢复漂移补偿重跑逻辑 |
| `sw.js` | `1042baedeb892936068daec59053905b93ea8c482624f604bacbc39f424b1bb6` | `1042baedeb892936068daec59053905b93ea8c482624f604bacbc39f424b1bb6` | **完全一致（保持 v29 预缓存版本）** |
| `test-boot-combination.js` | `e34033844a3c35bd6ddd94eb5058b22d7b2adc7ce383ee79ef102cd34edeb3a2` | `00a7410df9845bf8368a1e2cb62d341d51ab02efae7d36a184bcd45315b67ba3` | 增补 B9 段正向全链路与 5 组反向变异测试，隔离晚到桥沙箱环境 |
| `scripts/verification/p3e-coordinator-tests.js` | `3715c0e42ec162c8fbcf34b4c741490214c770c8a66d0c64c728ee3e2fb3d2f9` | `26b896ecbbf6a6f69ddff32630509a25b39920199d7dbbaefeeea42861c8cb4d` | 增补动作排空路由、必需依赖判定、漂移重跑与反向变异 9/10/11 |
| `scripts/verification/replay-counterexamples.js` | *新创* | `2170f2824fa9333333423b054238e5539fa76a2ebdbddfcab292ba57805d762e` | 独立复验目录两条反例的统一复跑执行脚本 |
| `lib/app-items.js` | `e807599395caa4f0a69e13ab957a43bd6d377d5dbab682c32c121c4a7a4be519` | `e807599395caa4f0a69e13ab957a43bd6d377d5dbab682c32c121c4a7a4be519` | **完全一致（零修改）** |
| `lib/app-transaction.js` | `e6df807a8330c618ce5d9e4b7a4087bfe7f07fbab1b32a8693a49908b71dea48` | `e6df807a8330c618ce5d9e4b7a4087bfe7f07fbab1b32a8693a49908b71dea48` | **完全一致（零修改）** |
| `lib/app-persistence.js` | `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50` | `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50` | **完全一致（零修改）** |
| `lib/app-model.js` | `0219c576a82d4df6fefe4dca62561c491f1b36c97d59de426afff7ccad41f94e` | `0219c576a82d4df6fefe4dca62561c491f1b36c97d59de426afff7ccad41f94e` | **完全一致（零修改）** |
| `lib/native-reminders.js` | `723f218c68866309f364e1e71968eb3efc6ae8b9b85aea7e211c878bee6e031b` | `723f218c68866309f364e1e71968eb3efc6ae8b9b85aea7e211c878bee6e031b` | **完全一致（零修改）** |

新构建 Android Debug APK SHA-256：`96a2a0a41e8ba55652297fd94d6f9b2560e8801e1ff4d4b38b6979b6698d8300`。
候选文件路径：`releases/candidates/20260923T1000-p3e-candidate/app-debug.apk`。

---

## 3. 两项阻断根因分析与最小安全修复

### 3.1 阻断 1：全屏闹钟动作排空直达事务处理器与保留 alarmEventId

#### 根因分析
在 `docs/reviews/verification-runs/20260923T1014-p3e-independent-recheck/README.md` 中指明：
1. `lib/app-native-coordinator.js` 的 `onResume` 回调中，`nr.drainAlarmActions` 错误地将动作排空交由 `deps.onNotificationAction` 处理；
2. 全屏闹钟原生动作集合包含 `close`、`ack`、`snooze`、`done`。当 `close` 事件进入 `handleNativeNotificationAction` 时，因通知入口不认 `close` 动作分支，静默回退至 `openDetail(id)` 意外弹出编辑详情面板；
3. `handleNativeNotificationAction` 缺少针对全屏闹钟 `alarmEventId` 的事务级写入与去重保护（`alarmEventSeen` / `inflightAlarmActions`），导致原生事件去重能力在排空时丢失；
4. `createAppNativeCoordinator` 依赖声明中遗漏了 `handleAlarmAction`，未形成强制契约。

#### 修复实施
1. **依赖硬约束**：在 `lib/app-native-coordinator.js` 的 `REQUIRED_DEPS` 数组中增加 `"handleAlarmAction"`。如果未传入该函数，工厂函数在初始化时立即抛出 `createAppNativeCoordinator(deps) 缺少依赖：handleAlarmAction`。
2. **直达事务处理器**：在 `lib/app-native-coordinator.js` 的 `onResume` 动作排空中，直接调用 `await nr.drainAlarmActions(deps.handleAlarmAction)`，将全屏闹钟动作直达事务层，完整保留 `alarmEventId`、`action`、`itemId`、`itemRev`。
3. **依赖显式注入**：在 `app-core.js` 的 `coordinatorRuntimeDeps()` 中显式注入 `handleAlarmAction: (event) => handleAlarmAction(event)`。
4. **两类入口严格隔离**：系统通知栏动作仍保持调用 `onNotificationAction`（即 `handleNativeNotificationAction`），全屏闹钟与通知栏动作互不干扰。

### 3.2 阻断 2：版本漂移后补偿重跑对账完成条件

#### 根因分析
在 `syncNativeRemindersNow()` 的执行循环中，前序实现将跳出循环的条件 `if (!nativeSyncPending) { break; }` 置于 `if (capturedVersion === nativeSyncVersion)` 代码块之外。
在 `reconcile` 异步落库期间若触发了新的业务写入（如 `bumpNativeSyncVersion` 使得 `nativeSyncVersion` 递增），虽然判定了 `capturedVersion !== nativeSyncVersion`，但由于 `nativeSyncPending` 为 false，循环在第 1 轮末尾直接提前 `break` 退出。这导致新产生的业务快照未能在第 2 轮中执行补偿排程与最新台账回写。

#### 修复实施
将循环退出条件收敛于版本完全一致分支内：
```javascript
          if (capturedVersion === nativeSyncVersion) {
            nativeSyncInFlight = false;
            if (!nativeSyncPending) {
              break;
            }
          }
```
当检测到版本漂移时，`capturedVersion !== nativeSyncVersion` 分支不退出，循环自然继续进入下一轮对账，重新拉取最新快照进行补偿排程；只有当业务版本与对账版本严格一致且无挂起排程时才平稳退出。单次漂移严格跑 2 轮完成补偿，稳定无漂移轮次严格跑 1 轮退出，不自激循环。

---

## 4. 独立复验反例复跑至绿与新增测试

### 4.1 独立复验目录反例复跑（`scripts/verification/replay-counterexamples.js`）
针对 `docs/reviews/verification-runs/20260923T1014-p3e-independent-recheck/` 留下的两条反例逻辑，编写针对性复跑脚本：
1. **反例 1（路由与漂移补偿）**：
   - 依赖缺失：未传 `handleAlarmAction` 立即抛错（`threwMissingDep: true`）；
   - 正向路由：排空队列直达 `handleAlarmAction`，`direct: 2`，`notification: 0`，保留 `alarmEventId: "evt-123"` 与 `"evt-124"`；
   - 漂移补偿：单次版本漂移下 `driftRuns === 2`，稳定状态下 `stableRuns === 1`（`driftCompensationPass: true`）。
2. **反例 2（全屏闹钟 close 行为与排空隔离）**：
   - 直接事务处理：`app.handleAlarmAction({ action: "close" })` 正常关闭告警，`directDetail === null`；
   - 排空路由：resume 排空走 `handleAlarmAction`，`drainDetail === null`，`drainedCount === 1`。
- **复跑结果**：`PASS: Both counterexamples replayed to green successfully!`。

### 4.2 正式生产组合增补测试（`test-boot-combination.js` B9）
在正式生产组合 harness 中构建端到端正向业务与 5 组反向变异：
- **正向验证**：
  - 生产组合启动成功（`bootReady === true`）；
  - 单次业务保存静置后恰好执行 1 轮对账（`runsAfterSaveIdle === 1`，自激循环防护生效）；
  - 单次版本漂移执行 2 轮对账完成补偿排程（`driftSyncRuns === 2`）；
  - 补偿排程后最新业务台账回写生效（`driftItemEventsWritten === true`）；
  - 全屏闹钟 close 动作经 resume 排空不打开详情页（`closeDetailId === null`）；
  - 全屏闹钟 ACK / snooze / done 动作保留 `alarmEventId` 且事务去重生效（`ackSeen` / `snzSeen` / `doneSeen` 均为 `true`）；
  - 权威提交拒绝后事件未被持久去重占用，保留重试资格（`rejectedEventSeen === false`）；
  - 事项索引重复 ID 首项胜出（首项被修改，次项未被修改）；
  - 桥晚到重试成功排干对账队列（`lateBridgeRuns >= 1`）。
- **5 组反向变异（全红变异杀手）**：
  - 变异 1：去掉 `deferNativeSync: true` 导致保存后自激多轮对账（变红）；
  - 变异 2：漂移后提前 `break` 导致仅执行 1 轮对账遗漏补偿（变红）；
  - 变异 3：丢弃重试导致桥晚到未执行对账（变红）；
  - 变异 4：`indexItemsById` 破坏首项胜出导致次项被篡改（变红）；
  - 变异 5：`drainAlarmActions` 篡改为通知入口导致 close 意外弹出详情面板（变红）。
- **运行结果**：通过 782 项，失败 0 项。

### 4.3 模块单元与反向变异测试（`scripts/verification/p3e-coordinator-tests.js`）
- 11 组反向变异全部检出并变红（含变异 9 缺少依赖、变异 10 闹钟动作误入通知入口、变异 11 漂移提前退出）。
- 运行结果：退出码 0，全量检出。

---

## 5. 全套验证套件结果

| 验证项 | 执行命令 | 结果 | 关键指标 / 结论 |
| --- | --- | --- | --- |
| 独立反例复跑 | `node scripts/verification/replay-counterexamples.js` | **PASS (exit 0)** | 两条反例均以符合规范的行为跑通 |
| 模块变异自测 | `node scripts/verification/p3e-coordinator-tests.js` | **PASS (exit 0)** | 11 组变异全部检出，源码无污染 |
| 生产组合全量测试 | `node test-boot-combination.js` | **PASS (exit 0)** | 782 项全部通过，0 失败 |
| 仓库全量单元测试 | `npm test` | **PASS (exit 0)** | 160 项全部通过，0 失败 |
| DOM 搬移前后一致性 | `node scripts/verification/ui-dom-parity.js` | **PASS (exit 0)** | 16 场景 590 字段逐项逐字段一致 |
| UI 格式化搬移前后一致性 | `node scripts/verification/ui-format-parity.js` | **PASS (exit 0)** | 567 项格式化比对逐项一致 |
| 真实浏览器启动恢复门禁 | `python3 scripts/verification/browser-recovery-check.py` | **PASS (exit 0)** | 12 个浏览器场景无副作用启动 |
| 真实浏览器整库导入门禁 | `python3 scripts/verification/browser-import-format-check.py` | **PASS (exit 0)** | 11 个导入安全测试全绿 |
| 32 项 Web 资源五层一致性 | `verify-resources` 逻辑 | **PASS (exit 0)** | source / www / assets / intermediate / APK 五层逐字节一致（0 mismatch） |
| Capacitor 资源同步 | `npm run cap:sync` | **PASS (exit 0)** | www 33 项资源无损同步 |
| Android Debug APK 构建 | `cd android && ./gradlew assembleDebug` | **PASS (exit 0)** | 构建成功，产物与候选目录已对齐更新 |

---

## 6. 32 项五层 Web 资源哈希核对摘要

经全量核验，全部 32 项 Web 资源在以下 5 层逐字节哈希一致：
1. `root / <relative>`（项目根源码）
2. `www / <relative>`（Capacitor 导出）
3. `android/app/src/main/assets/public / <relative>`（Android assets）
4. `android/app/build/intermediates/assets/debug/public / <relative>`（Gradle 中间构建）
5. `assets/public / <relative>`（已打包进 `app-debug.apk` 的 zip 内部条目）

`resource-hashes.tsv` 已在当前目录生成，无任何 mismatch。

---

## 7. 交付总结与交回说明

1. **修改范围严格受控**：仅在 `app-core.js`、`lib/app-native-coordinator.js` 及对应验证测试文件中按两项阻断最小表面积实施，未改动任何无关文件。
2. **测试与证据链完整闭合**：从反例复现到反例复绿、从单元变异到生产集成组合（782项）、从浏览器无头执行到五层 APK 资源比对，所有退出码与日志均归档至本目录。
3. **保持实施方定位**：本报告仅为实施方自测通过证明，不作独立 PASS 声明，现将工作区完整交回独立验收方复验。
