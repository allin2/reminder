# P3-E `app-native-coordinator.js` 实施方自测报告

> **声明**：本报告为实施方自测与改动记录，不自称独立 PASS，交回独立验收。

## 1. 范围与开工基线核对

- 开工检查分支与提交：`main` / `3574824357dc7beb04cbd3e32aa413cd508e8484`。
- P3-D 独立验收基线：`docs/reviews/verification-runs/20260923T0923-p3d-independent-recheck/README.md`。
- 工作区保护：严格遵守工作区保护规则，未执行 `checkout` / `reset` / `stash` / `clean`，未覆盖历史 run、旧 APK、基线候选或用户数据；未提交、未推送。既存脏条目与既有产物完整保留。

### 基线与交付物哈希比对

| 文件 | P3-D 开工基线 SHA-256 | P3-E 最终产物 SHA-256 | 状态说明 |
| --- | --- | --- | --- |
| `lib/app-native-coordinator.js` | *(未创建)* | `51d99e649ba1e9407d45e0b09b74458d2bd57476e61183c6b219c48f7c3f361d` | **[NEW]** 唯一原生提醒协调与事件台账 UMD 模块 |
| `app-core.js` | `4ee18ef5c24ba4c0cbfdd251c44d7b42ffe396c3eb429e33e0bf7ed5cf731ebd` | `fe9d446caf64a95c86e437122aca760c1c1cbfab08753f2d87f0352f88f9c471` | **[MODIFY]** 迁出协调层与台账，保留薄转发与闭合装配 |
| `index.html` | `994837548fce7d992d46b393a64274dda6c061baa72d8e1cdfb2f1cdc74962a8` | `a0193f9291f315bf06670e6b088f87b71e949163bcc65468d0567789680658c5` | **[MODIFY]** 顺序引入 `lib/app-native-coordinator.js`（第 16 支） |
| `sw.js` | `acd6b79d712dcc7ba24c7f993029da48bbec42319d5b059580644d381bd46890` | `1042baedeb892936068daec59053905b93ea8c482624f604bacbc39f424b1bb6` | **[MODIFY]** 缓存版本升至 `attention-inbox-v29`，加入新脚本预缓存（28 项） |
| `package.json` | `7fbfa3f5fc3ad5677ad15926ec09f4dd7db269d05e0a6dcfc623aaee81b7e682` | `c9b04c286054dc413617ba19bf3736ed98bdedeccfac2f33b21085c1740e9998` | **[MODIFY]** `npm test` 接入 `p3e-coordinator-tests.js` |
| `lib/app-items.js` | `e807599395caa4f0a69e13ab957a43bd6d377d5dbab682c32c121c4a7a4be519` | `e807599395caa4f0a69e13ab957a43bd6d377d5dbab682c32c121c4a7a4be519` | **UNCHANGED** 保持 P3-D 独立验收基线一致 |
| `lib/app-transaction.js` | `e6df807a8330c618ce5d9e4b7a4087bfe7f07fbab1b32a8693a49908b71dea48` | `e6df807a8330c618ce5d9e4b7a4087bfe7f07fbab1b32a8693a49908b71dea48` | **UNCHANGED** 保持 P3-C-R 独立验收基线一致 |
| `lib/app-persistence.js` | `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50` | `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50` | **UNCHANGED** 保持 P3-B 独立验收基线一致 |
| `lib/app-model.js` | `0219c576a82d4df6fefe4dca62561c491f1b36c97d59de426afff7ccad41f94e` | `0219c576a82d4df6fefe4dca62561c491f1b36c97d59de426afff7ccad41f94e` | **UNCHANGED** 保持 P3-A 独立验收基线一致 |
| `lib/native-reminders.js` | `723f218c68866309f364e1e71968eb3efc6ae8b9b85aea7e211c878bee6e031b` | `723f218c68866309f364e1e71968eb3efc6ae8b9b85aea7e211c878bee6e031b` | **UNCHANGED** 保持底层桥实现一致 |
| `lib/storage.js` | `b710ec23d819dfdc7eeeafa4688e44d69a11062a18c35b931c2240177721478a` | `b710ec23d819dfdc7eeeafa4688e44d69a11062a18c35b931c2240177721478a` | **UNCHANGED** 保持底层存储一致 |
| Baseline Debug APK | `23742f54b680724fbc14326f2fdac8db847e564f466f1cae5e2411a24bc8307f` | `23742f54b680724fbc14326f2fdac8db847e564f466f1cae5e2411a24bc8307f` | **FROZEN** 冻结在 `releases/candidates/20260923T0923-p3d-baseline/` |
| P3-E Candidate APK | *(未构建)* | `ebc57bb6c8423334cd9f8b717130433ee6edcc8d0ac2ab80aa766a5e7c53754f` | **[NEW]** 存留于 `releases/candidates/20260923T1000-p3e-candidate/` |

---

## 2. 函数/可变状态迁移映射台账

| 原始实体/函数/可变状态 | 新主人 | 外部/内部调用者 | 核心职责与验证点 |
| --- | --- | --- | --- |
| `nativeReady` | `lib/app-native-coordinator.js` 闭包状态 | `appNativeCoordinator.isNativeReady()`, `app-core.js` 启动网关 | 标识原生底层桥与协调层是否已就绪。初始化成功后置 `true`，失败时可重试。 |
| `nativeSyncTimer` | `lib/app-native-coordinator.js` 闭包状态 | `queueNativeReminderSync` | 80ms 防抖定时器，收敛短时间内的并发对账请求，更新 `deduped` 指标。 |
| `nativeInitPromise` | `lib/app-native-coordinator.js` 闭包状态 | `ensureNativeReminders` | 保证原生初始化的幂等性与在途单例，初始化完成后置 `null` 允许重试。 |
| `nativeSyncInFlight` / `nativeSyncPending` | `lib/app-native-coordinator.js` 闭包状态 | `syncNativeRemindersNow`, `queueNativeReminderSync` | 控制对账互斥。在途时标记 `pending` 并递增 `deduped`；在途完成后自动排干 `pending`。 |
| `nativeSyncVersion` | `lib/app-native-coordinator.js` 闭包状态 | `getNativeSyncVersion`, `bumpNativeSyncVersion` | 递增的版本计数。异步对账完成时比对版本，若漂移则拦截业务台账回写。 |
| `nativeSyncMetrics` | `lib/app-native-coordinator.js` 闭包状态 | `getNativeSyncMetrics`, `app.nativeSyncStats`, `resetNativeSyncStats` | 包含 `totalRequests`, `bySource`, `runs`, `deduped`, `blockedByAuthority`，提供可观测性。 |
| `nativeReminderStatus` | `lib/app-native-coordinator.js` 闭包状态 | `getNativeReminderStatus`, `setNativeReminderStatus`, `onStatusChange` | 维护原生通知、精确闹钟、可靠性状态，通过 `onStatusChange` 回调驱动 UI 渲染与保存结清。 |
| `deliveryEvidenceState` / `deliveryEvidenceInFlight` | `lib/app-native-coordinator.js` 闭包状态 | `getDeliveryEvidenceState`, `deliveryEvidenceReadable`, `readDeliveryEvidence` | 投递证据读取与合并状态。防止并发读取，记录行数与状态，保留终态与 `roundBase`。 |
| `refreshNativeScheduleBasis()` | `lib/app-native-coordinator.js` | `app-core.js` 薄壳转发 | 扫描事项并调用 `migrateItem` 刷新排程基准，产生变更时触发 `deps.save()`。 |
| `applyDeadlineEvents(events, now, cancelled, opts)` | `lib/app-native-coordinator.js` | `syncNativeRemindersNow`, `app-core.js` | 截止保护台账维护。保持 `delivered`/`cancelled` 终态，首项胜出，带 `deferNativeSync: true`。 |
| `applyReminderEvents(events, now, cancelled, opts)` | `lib/app-native-coordinator.js` | `syncNativeRemindersNow`, `app-core.js` | 事项提醒台账维护。保持三态流转，注入/保留 `roundBase` 轮次身份，带 `deferNativeSync: true`。 |
| `markDeadlineDelivered(event)` | `lib/app-native-coordinator.js` | 原生插件 `onDelivered` 回调 | 将指定事项的截止事件状态推进至 `delivered`，触发持久化。 |
| `applyReminderDelivered(ev)` | `lib/app-native-coordinator.js` | 原生插件 `onReminderDelivered` 回调 | 将单次提醒投递转换为投递证据并合并。 |
| `syncNativeRemindersNow(options)` | `lib/app-native-coordinator.js` | `queueNativeReminderSync`, 初始化流程 | 获取快照，调用底层 `reconcile`，同步设置闹钟 ID，版本未漂移时回写事件台账。 |
| `ensureNativeReminders()` | `lib/app-native-coordinator.js` | `queueNativeReminderSync`, `readDeliveryEvidence` | 惰性且幂等地确保原生环境就绪，失败兜底。 |
| `queueNativeReminderSync(source)` | `lib/app-native-coordinator.js` | `saveAsync`, 前台恢复, 外部调用 | 权威写闸门检查，未授权时累加 `blockedByAuthority`；在途排队去重；80ms 定时对账。 |
| `readDeliveryEvidence(source)` | `lib/app-native-coordinator.js` | `onResume`, `initializeNativeReminders`, 诊断 | 从底层插件读取投递证据并合并至事项。 |
| `applyNativeDeliveryEvidence(rows)` | `lib/app-native-coordinator.js` | `readDeliveryEvidence`, `applyReminderDelivered` | 规范化证据并通过 `runUserOp` 包装安全合并，保留 `roundBase`。 |
| `initializeNativeReminders()` | `lib/app-native-coordinator.js` | `ensureNativeReminders` | 注册通知动作、投递回调、权限变化回调及生命周期 `onResume` 补排程逻辑。 |
| `isNativeAndroidRuntime()` | `lib/app-native-coordinator.js` | `app-core.js`, setup 视图, views 视图 | 依据 Capacitor platform 严格判定是否为 Android 原生运行时（保护 Web）。 |
| `waitForNativeBridge(timeoutMs)` | `lib/app-native-coordinator.js` | `initializeNativeReminders`, 外部测试 | 轮询等待 Capacitor 原生桥注入。 |

---

## 3. 双向实例合同闭合

`APP_NATIVE_COORDINATOR_INSTANCE_CONTRACT` 共声明 21 个实例成员：
1. `refreshNativeScheduleBasis`
2. `applyDeadlineEvents`
3. `applyReminderEvents`
4. `markDeadlineDelivered`
5. `applyReminderDelivered`
6. `syncNativeRemindersNow`
7. `ensureNativeReminders`
8. `queueNativeReminderSync`
9. `readDeliveryEvidence`
10. `applyNativeDeliveryEvidence`
11. `initializeNativeReminders`
12. `getNativeReminderStatus`
13. `setNativeReminderStatus`
14. `isNativeReady`
15. `getNativeSyncMetrics`
16. `getNativeSyncVersion`
17. `bumpNativeSyncVersion`
18. `deliveryEvidenceReadable`
19. `getDeliveryEvidenceState`
20. `isNativeAndroidRuntime`
21. `waitForNativeBridge`

`scripts/verification/production-scripts.js` 执行 `coordinatorInstanceCoverage` 静态双向闭合断言：
- `missingInContract`: `[]`（无未在合同中声明的调用）
- `unusedInContract`: `[]`（无合同中声明但未被引用的死成员）
- `internalOnly`: `[]`
- 双向覆盖判定结果：**100% 闭合（PASS）**。

---

## 4. 测试与验证执行记录

| 验证项 / 测试脚本 | 命令与参数 | Exit Code | 结果摘要 | 产物日志 |
| --- | --- | --- | --- | --- |
| 全套自动化测试 | `npm test` | **0** | 11 套测试全绿（100% 通过） | `selfcheck.log`, `npm-test-final.log` |
| 协调器专属单元与反向变异 | `node scripts/verification/p3e-coordinator-tests.js` | **0** | 正向健康行为全过 + **8 组反向变异全数拦截** + 源码哈希一致 | `p3e-coordinator-tests.log` |
| 生产组合与装配断言 | `node test-boot-combination.js` | **0** | **774/0 项通过**（含 B9 生产组合用例及 4 组反向变异） | `production-combination.log` |
| 单元测试 | `node test-unit.js` | **0** | 642/0 项通过 | `unit.log` |
| 原生提醒契约测试 | `node test-native-reminders.js` | **0** | 324/0 项通过（含 Q6 正则检查） | `native-reminders.log` |
| 冒烟测试 | `node test-smoke.js` | **0** | 266/0 项通过 | `smoke.log` |
| 回归测试 | `node test-regressions.js` | **0** | 730/0 项通过 | `regressions.log` |
| 单一来源静态解析检查 | `node scripts/verification/parse-single-source.js` | **0** | 160/0 项通过（单一来源已闭合） | `parse.log` |
| UI DOM 逐字段比对 | `node scripts/verification/ui-dom-parity.js` | **0** | 16 场景 / 590 字段逐项一致（PASS） | `ui-dom-parity.log` |
| UI 格式化比对 | `node scripts/verification/ui-format-parity.js` | **0** | 567 比对项逐项一致（PASS） | `ui-format-parity.log` |
| 真实浏览器冷启动与装配探针 | `python3 scripts/verification/browser-recovery-check.py` | **0** | 12 个用例全部 PASS（无断言不满足） | `browser-recovery.log` |
| 真实浏览器导入与格式校验 | `python3 scripts/verification/browser-import-format-check.py` | **0** | 11 个用例全部 PASS（无断言不满足） | `browser-import.log` |
| 生产资源同步 | `npm run cap:sync` | **0** | 33 entries synced (`www` -> `android/assets`) | `cap-sync.log` |
| Android Debug APK 构建 | `cd android && ./gradlew assembleDebug` | **0** | BUILD SUCCESSFUL in 851ms | `assemble-debug.log` |
| 32 项生产资源同源比对 | `node -e '...'` | **0** | 32 项生产 Web 资源逐字节比对全数一致 (`MATCH_ALL`) | `resource-32-way.log`, `resource-hashes.tsv` |

---

## 5. 32 项生产资源同源比对表 (Source / www / Android Assets / APK)

详见 `resource-hashes.tsv` 与 `resource-32-way.log`。32 项生产 Web 资源全部严格一致：

```
app-core.js:                   fe9d446caf64a95c86e437122aca760c1c1cbfab08753f2d87f0352f88f9c471  (MATCH_ALL)
icon-192.png:                  48e5078385c990aa02f164874609dccb1108a54cdb8fb8882bdbfb3caaf38411  (MATCH_ALL)
icon-512.png:                  a558b0502031e078b7a3087779f2777dffe5f5f7f8ccb3869783cc28f776f3af  (MATCH_ALL)
icon.svg:                      fb09a46eae6dcd7c165811710d8fb91ae47f4273bb7228711076ea016ce8ddbb  (MATCH_ALL)
index.html:                    a0193f9291f315bf06670e6b088f87b71e949163bcc65468d0567789680658c5  (MATCH_ALL)
lib/app-ai.js:                 e55a286009b102129e2efe3e1bdc0a9dc8b9fbb2f1bd4884b02b56d8e20862d9  (MATCH_ALL)
lib/app-backup.js:             6871da9c87c906b943762a75c73573cbf9b9c13c84c40e8860652f3a3c8104e0  (MATCH_ALL)
lib/app-capture.js:            cbf3285f427c8aec7394b8305255a545e84c4ec8152faf0d1d8c6ce35da57a4b  (MATCH_ALL)
lib/app-content.js:            82be748ea5719244cb725602a78599c1daff9a7fc349128d3e64eb7d76ab4289  (MATCH_ALL)
lib/app-diagnostics.js:        36f91c1b7612628e6b7fab7c6d99560afd132f72ecc6c3df4622ad5df3c78b54  (MATCH_ALL)
lib/app-items.js:              e807599395caa4f0a69e13ab957a43bd6d377d5dbab682c32c121c4a7a4be519  (MATCH_ALL)
lib/app-model.js:              0219c576a82d4df6fefe4dca62561c491f1b36c97d59de426afff7ccad41f94e  (MATCH_ALL)
lib/app-native-coordinator.js: 51d99e649ba1e9407d45e0b09b74458d2bd57476e61183c6b219c48f7c3f361d  (MATCH_ALL)
lib/app-persistence.js:        d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50  (MATCH_ALL)
lib/app-setup.js:              e7b000620da77777f0bd1cc5537d1f4a87aee0efc7aed6566d9248077a8ce112  (MATCH_ALL)
lib/app-transaction.js:        e6df807a8330c618ce5d9e4b7a4087bfe7f07fbab1b32a8693a49908b71dea48  (MATCH_ALL)
lib/app-ui.js:                 84e3e97663c2a7525ff25432f335a5a422791c83e26f81014b34443d63b632e4  (MATCH_ALL)
lib/app-views.js:              2ef2c72b6319feb3414fd07914804296d4f9fa7888a834b3d95f1a98b2fafa37  (MATCH_ALL)
lib/date-utils.js:             7328f1e6ec1634a523deb21ba96ff9f9bf50f6b2ebe827b3a1e7765394cdb46c  (MATCH_ALL)
lib/delivery-evidence.js:      7ee77186881d8462450c8fe8a550840647ec9d7626c259fb9e29768290062d03  (MATCH_ALL)
lib/export-format.js:          37e60a07624c2dda1f1afadec8c1b2d61fe5b4a5a34b4c9c82f2c10ed0270423  (MATCH_ALL)
lib/feedback.js:               bfe41dd392d5ff27d8c92b41154fc7e4e5a125eaaa1c8fae6ae3298186669eb3  (MATCH_ALL)
lib/import-extract.js:         edd959660e9fb9525ba7c290cde3019a81d53f1873c0ce31af24da30e1714bfa  (MATCH_ALL)
lib/import-map.js:             51fe5528bb7189400946685ab0b9e9819f71eae8096166920deb048a4a0529d9  (MATCH_ALL)
lib/native-reminders.js:        723f218c68866309f364e1e71968eb3efc6ae8b9b85aea7e211c878bee6e031b  (MATCH_ALL)
lib/parse-cn.js:               80c6e4db43ebe018c2fc90fbe1e8b1cc126be801aec5ae790490cb5fe53a9f9d  (MATCH_ALL)
lib/reminder.js:               886ab9eb1a438b34122b71a461ed89a4a5b37fa85dedf8ee7afa558ee58f62fd  (MATCH_ALL)
lib/repeat.js:                 d48b8d67336976c4d514101b9990c904d8a00a9aa1ecabf3fe6abace86afd83a  (MATCH_ALL)
lib/storage.js:                b710ec23d819dfdc7eeeafa4688e44d69a11062a18c35b931c2240177721478a  (MATCH_ALL)
lib/ui-format.js:              3dcccc41863aef136abe513527d79955c5b80be9d997f5ff90d68f0fd5850c9f  (MATCH_ALL)
manifest.json:                 660c2314cc921232ed9f9c3f7271839f57109e6640e1a9b0cf2a7259ca42e2f1  (MATCH_ALL)
sw.js:                         1042baedeb892936068daec59053905b93ea8c482624f604bacbc39f424b1bb6  (MATCH_ALL)
```

---

## 6. 变异测试检验说明

1. **协调层专属反向变异（`scripts/verification/p3e-coordinator-tests.js` 共 8 组）**：
   - 变异 1（权威闸门被绕过）：断言失败，捕获 `blockedByAuthority` 未递增及越权对账。
   - 变异 2（版本漂移保护放行）：断言失败，捕获漂移状态下脏台账被写入。
   - 变异 3（去掉 `deferNativeSync: true`）：断言失败，捕获保存缺少延迟对账标识。
   - 变异 4（丢弃桥晚到重试）：断言失败，捕获桥就绪后未补做初始化且未执行对账。
   - 变异 5（破坏首项胜出机制）：断言失败，捕获次项被篡改及首项丢失变更。
   - 变异 6（绕过并发请求去重指标）：断言失败，捕获 `deduped` 计数为 0。
   - 变异 7（投递证据可读性标记篡改）：断言失败，捕获 `deliveryEvidenceState.readable` 异常。
   - 变异 8（丢弃 `roundBase` 轮次身份）：断言失败，捕获提醒事件轮次基准丢失。
   *运行完毕后通过 SHA-256 校验确认产品文件 `lib/app-native-coordinator.js` 零污染。*

2. **生产组合反向变异（`test-boot-combination.js` Section B9 共 4 组）**：
   - 变异 1：去掉 `deferNativeSync: true` ⇒ 生产单次保存后静置引发死循环自激，`runs > 1` 拦截成功。
   - 变异 2：放行版本漂移写入 ⇒ 异步对账完成时覆盖漂移事项，`driftItemEventsWritten === true` 拦截成功。
   - 变异 3：桥未就绪时丢弃 queue 请求 ⇒ 真实桥晚到后队列被吞，`lateBridgeRuns === 0` 拦截成功。
   - 变异 4：破坏首项胜出 ⇒ 重复 ID 的次项被篡改，`dupSecondModified === true` 拦截成功。
   *运行完毕后通过 SHA-256 校验确认产品文件 `lib/app-native-coordinator.js` 零污染。*

---

## 7. 未执行项与交回说明

- 未在真机物理设备上执行安装运行（已完成真机 debug APK 构建与资源同源校验）。
- 未在真实离线环境中模拟 Service Worker 从 v28 到 v29 的物理升级缓存置换（已完成 VM 与单测断言）。
- 实施方自测已完毕，不自称独立 PASS，正式交回独立验收。
