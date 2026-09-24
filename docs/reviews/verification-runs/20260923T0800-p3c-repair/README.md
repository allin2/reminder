# P3-C-R 实施自测报告：事务重绑后旧包装命令失效修复

## 1. 任务身份与工作区约束

- **仓库路径**：`/Users/qlyf/Developer/reminder`
- **身份定位**：P3-C 实施方（非独立验收方，本报告为实施自测凭据，交回独立复验方进行独立重验）。
- **Git HEAD**：`3574824357dc7beb04cbd3e32aa413cd508e8484`（`main` / `origin/main`）。
- **工作区保护**：严格遵守无 destructive git 命令约束，未执行 `git checkout`、`reset`、`stash`、`clean`、`commit` 或 `push`。历史证据目录与既有 APK 完整保留。

## 2. 源码哈希比对与版本变更

| 文件路径 | 独立复验前基线 SHA-256 | 本轮修复后 SHA-256 | 变更性质 |
| --- | --- | --- | --- |
| `app-core.js` | `0a5ae42b518021a95a4a6d2c8dccd4cbf0f4c3feac00a2c2c7dea1d36c2a7c89` | `e7459c98b082c1ef03e8ecc1298b286bb9952cebe4cd90889d516c0221f17d05` | 修复 `wrapUserOp()` 缓存实例失效机制 |
| `sw.js` | `0fd2186d3e28e325e12d6c6959142905b2d35f8e30ad9b1d4a00667bcec23d49` | `ed487b5489b01c5aa179e43da497f010013dea8c03725e7f93c03b28315c431f` | 递增 Service Worker 预缓存版本至 `v27` |
| `test-boot-combination.js` | `6c10e30d1e39a3f2b2b1ff9ecfca27806f8c474d284f18f97e2f5f9aa9eb10a2` | `e34033844a3c35bd6ddd94eb5058b22d7b2adc7ce383ee79ef102cd34edeb3a2` | 正式生产组合增补 B7 段 A/B 反例与变异测试 |
| `lib/app-transaction.js` | `e6df807a8330c618ce5d9e4b7a4087bfe7f07fbab1b32a8693a49908b71dea48` | `e6df807a8330c618ce5d9e4b7a4087bfe7f07fbab1b32a8693a49908b71dea48` | **完全一致（零修改）** |
| `lib/app-persistence.js` | `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50` | `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50` | **完全一致（零修改）** |
| `lib/storage.js` | `b710ec23d819dfdc7eeeafa4688e44d69a11062a18c35b931c2240177721478a` | `b710ec23d819dfdc7eeeafa4688e44d69a11062a18c35b931c2240177721478a` | **完全一致（零修改）** |
| `lib/native-reminders.js` | `723f218c68866309f364e1e71968eb3efc6ae8b9b85aea7e211c878bee6e031b` | `723f218c68866309f364e1e71968eb3efc6ae8b9b85aea7e211c878bee6e031b` | **完全一致（零修改）** |

新生成 Android Debug APK SHA-256：`c3a5cc52891400cad35210d7211ea5703fd5225f5c7ca2ddd28272126886a785`。

## 3. 阻断问题根因分析与最小闭环修复

### 3.1 根因分析
在独立复验报告 `docs/reviews/verification-runs/20260923T0735-p3c-independent-recheck/README.md` 中指出：
`app-core.js` 原 `wrapUserOp(fn, options)` 实现如下：
```javascript
function wrapUserOp(fn, options) {
  let cached = null;
  return function () {
    if (!cached && appTransaction) {
      cached = appTransaction.wrapUserOp(fn, options);
    }
    if (cached) return cached.apply(null, arguments);
    return runUserOp(fn, Array.prototype.slice.call(arguments), options);
  };
}
```
闭包内的 `cached` 变量永久保留了首次绑定的 `appTransaction` 实例所生成的包装函数。当 `bindRuntime()` 被再次调用（例如应用启动重试、故障恢复重试等生命周期节点），`appTransaction` 切换为新创建的事务协调器实例，但已被预先包装的核心命令（`completeItem`、`ackItem` 等）依旧调用旧实例。
旧实例无活跃动作，`inflightActionDepth` 为 0，导致：
1. 原生动作执行期间本应被拒绝的同事项命令错误放行并提前更改状态；
2. 无冲突命令被登记在旧实例的待重放队列中，无法被新实例感知，新实例提交后重写状态导致无冲突命令丢失。

### 3.2 最小闭环修复
修改 `app-core.js` 中的 `wrapUserOp()`，引入实例身份比较机制（`cachedInstance !== appTransaction`）：
```javascript
function wrapUserOp(fn, options) {
  let cachedInstance = null;
  let cached = null;
  return function () {
    if (cachedInstance !== appTransaction) {
      cachedInstance = appTransaction;
      cached = appTransaction ? appTransaction.wrapUserOp(fn, options) : null;
    }
    if (cached) return cached.apply(null, arguments);
    return runUserOp(fn, Array.prototype.slice.call(arguments), options);
  };
}
```
当 `appTransaction` 实例因重绑发生变化时，旧缓存自动失效，重新通过当前有效的 `appTransaction.wrapUserOp()` 获得新的包装函数，从而确保所有调用始终穿透到当前事务协调器实例。

### 3.3 Service Worker 缓存递增
按仓库约定，修改 `sw.js`：
- 缓存标识更新为 `const CACHE = "attention-inbox-v27";`
- 头部添加变更说明：`// v27：P3-C-R 修复重绑后旧命令包装函数仍引用旧事务实例的缺陷，使 wrapUserOp 随当前事务实例失效重绑。`

## 4. 正式生产组合回归（Section B7）与变异验证

在 `test-boot-combination.js` 中新增 **B7 段（P3-C-R：事务重绑后旧命令包装函数实例更新）**，将复验反例纳入正式测试体系：

1. **对照组（A: 无重绑）**：
   - 验证原生动作挂起期间：同事项命令被拒绝（返回 `false`）、可见状态保持 `waiting` 不变；
   - 验证无冲突命令被接受，提交后成功重放并持久化保留。
2. **实验组（B: 重绑后）**：
   - 预先调用包装命令建立旧实例缓存；
   - 执行 `bindRuntime()` 与 `loadAsync()` 完成重绑并产生新事务实例；
   - 验证在权威写 Promise 挂起期间：旧包装命令调用穿透到新事务实例，正确拒绝冲突（返回 `false`）、可见状态保持 `waiting`；
   - 验证无冲突命令被新事务实例记录，并在提交后成功重放保留（`unrelatedAfter === true`）。
3. **反向变异证明变红（Mutant Proof）**：
   - 使用内存临时副本将 `app-core.js` 还原为旧永久缓存写法（`let cached = null;`）；
   - 使用 `overrides: { "app-core.js": tmpCore }` 运行重绑实验组；
   - 成功捕获 3 项红线缺陷：
     - `mutantRes.conflictResult === true`（同事项命令漏判被放行）
     - `mutantRes.duringStatus === "archived"`（可见状态提前泄露）
     - `mutantRes.unrelatedAfter === false`（提交后丢失无冲突命令）
   - 临时文件测试完成后即刻安全清理，产品源码无任何变异污染。

同时，原有独立复验探针 `docs/reviews/verification-runs/20260923T0735-p3c-independent-recheck/repro-stale-transaction.js`（原断言 `rebound.conflictResult === true`）在修复后执行时抛出 `AssertionError: false !== true`，退出码为 1（见 `stale-transaction-probe.log` 与 `stale-transaction-probe.exit`），证明旧缺陷已不可复现。

## 5. 验证执行与原始凭据汇总

本次测试与比对全部通过，原始证据均已归档于当前目录：

| 验证项 | 执行命令 / 目标 | 结果 / 水位 | 对应凭据文件 |
| --- | --- | --- | --- |
| 源码语法检查 | `node --check app-core.js sw.js test-boot-combination.js` | 全部通过（exit 0） | 控制台执行 |
| Git Diff 规范 | `git diff --check app-core.js sw.js test-boot-combination.js` | 无空白/格式错误（exit 0） | `diff-check.log` |
| 静态契约闭合 | `prod.transactionInstanceCoverage(".")` | declared 11 / used 11 / missing 0 / unused 0 | `transaction-closure.json` |
| 协调器独占归属 | 扫描 9 项状态变量 + 7 项核心算法实现体 | 仅存在于 `lib/app-transaction.js`，`app-core.js` 中均为 0 | `unique-ownership.log` |
| 核心回归套件 | `npm test` | **2741/2741 全部通过**（unit 642, native 324, boot 619, smoke 266, regressions 730, parse 160） | `npm-test.log`, `npm-test.exit` |
| 直接事务行为与变异 | `node scripts/verification/p3c-transaction-tests.js` | 10 项直接行为 PASS，9/9 变异全部检出 | `p3c-transaction-tests.log`, `p3c-transaction-tests.exit` |
| UI 格式与 DOM 等价 | `ui-dom-parity.js`, `ui-format-parity.js` | DOM 590/590 一致，格式 567/567 一致 | `ui-dom-parity.log`, `ui-format-parity.log` |
| Chrome 恢复重试场景 | `browser-recovery-check.py` | 12/12 用例 PASS，退出码 0 | `browser-recovery.log`, `browser-recovery.exit` |
| Chrome 导入格式场景 | `browser-import-format-check.py` | 11/11 用例 PASS，退出码 0 | `browser-import-format-check.log`, `browser-import-format-check.exit` |
| Chrome 捕获/内容/诊断/设置/视图 | 其余 5 个 browser 场景脚本 | 5/5 全部 PASS，退出码 0 | `browser-*.log`, `browser-*.exit` |
| 原生同步与资源打包 | `npm run cap:sync` | 31 entries synced, 退出码 0 | `cap-sync.log`, `cap-sync.exit` |
| Android Debug 构建 | `cd android && ./gradlew assembleDebug` | BUILD SUCCESSFUL in 4s，退出码 0 | `assemble-debug.log`, `assemble-debug.exit` |
| 30 项 Web 资源 5 处比对 | source ↔ www ↔ android assets ↔ debug intermediate ↔ APK | **30/30 资源逐字节哈希完全一致** | `resource-30-way.log`, `resource-30-way-sha256.tsv`, `resource-30-way.exit` |

## 6. NOT_PERFORMED 边界说明与交付

以下内容在本轮实施自测中未执行，由后续独立验收方或真机环境评估：
1. **Android 物理真机运行时验证**：真机 APK 真实安装、前后台切换与硬件闹铃触发未在物理设备上跑测；
2. **物理离线 Service Worker v26 → v27 升级**：未在物理脱机浏览器环境中模拟实际升级切换链路；
3. **独立性边界**：本目录所有日志及结论均为实施方自测数据，不能取代独立验收。

交付物已就绪，请独立复验方进行独立重验。
