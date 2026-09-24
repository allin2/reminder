# P3-F 实施自测报告：待整理（Review）模块化拆分

> **实施方声明**：本文档为实施方自测交接记录，并非独立验收结论。全部自测结论均表述为“实施方自测通过”，最终结果待独立复验方复核断定。

---

## 1. 任务背景与工作区保护

- **任务目标**：将 `app-core.js` 中待整理（Review）的窗口规则、会话流转、卡片操作、首页入口与计划设置完整迁至唯一实现 `lib/app-review.js`；`app-core.js` 仅保留必需的依赖装配与跨模块薄委托；保持现有用户行为、权威保存路径与原生通知分工；严格不顺带实施 P3-G、P3-H 或 P4 离线升级。
- **工作区基线**：
  - Git HEAD: `3574824357dc7beb04cbd3e32aa413cd508e8484`（分支 `main`，与 `origin/main` 保持一致）
  - 未使用任何破坏性 git 命令（无 `checkout`、`reset`、`stash`、`clean`、`commit`、`push`）
  - 保留所有既有未提交改动与历史复验目录，无覆盖、无删除
- **历史候选保护**：
  - 严格保护前序候选：`releases/candidates/20260923T1115-p3er-candidate/app-debug.apk`
  - 现场实测 SHA-256：`5624f9a851b0364a1ccb2512a90e4cfdaaa90077fc18212fbddbf854e258a267`（完全一致，未被触碰）
  - 本轮全新候选写入唯一隔离路径：`releases/candidates/20260923T1135-p3f-candidate/app-debug.apk`
  - 实测 SHA-256：`f61e1849e3e2c3de4c7b40421a40ae19e07042a472c2992b39a2b4ed6b2aa379`

---

## 2. 变更内容清单

### 2.1 模块创建：`lib/app-review.js`
- **定位**：待整理（Review）窗口规则、会话、卡片操作、入口与设置层唯一权威实现。
- **模块规范**：UMD 工厂，通过 `createAppReview(deps)` 装配。求值与工厂创建期 **0 IO、0 状态变更、0 全局事件监听**。
- **依赖校验**：严格校验 27 项必需依赖函数与访问器（缺少任一项立即抛出具体依赖名）。
- **契约闭合**：实现并导出 27 个实例方法：
  `ensureReviewSettings`, `fallbackTriggerAt`, `reviewSessionKey`, `nextReviewWindowStart`, `inReviewWindow`, `inReviewHighlight`, `isVagueContent`, `detectNeedsReview`, `needsReviewItems`, `fireReviewNotification`, `maybeReviewSession`, `openReviewSession`, `currentReviewItem`, `scheduleNextReviewAlarm`, `renderReviewCard`, `resolveReviewTrigger`, `markReviewDone`, `reviewConfirm`, `reviewSaveEdit`, `reviewKeepCurrent`, `reviewDelete`, `snoozeReview`, `skipReviewThisTime`, `renderReviewEntry`, `bindReviewControls`, `markReviewTriggerPicked`, `isFallbackSuppressed`。
- **关键设计保障**：
  - `markReviewDone` 在内部通过 `deps.wrapUserOp` 进行事务包装，`reviewConfirm` 与 `reviewSaveEdit` 在内部均使用同一包装函数；若事务闸门拒绝（返回 `false`），立即中止，不推进会话、不修改事项；
  - `reviewTriggerUserPicked` 状态闭包封装于模块内部，每次 `renderReviewCard()` 时严格重置，外部仅通过 `markReviewTriggerPicked` 注入；
  - `renderReviewEntry` 依赖 `deps.writeIfChanged` 保证 `#homeReview` 容器在无变化时不发生 DOM 重建，避免重复绑定监听器；
  - `ensureReviewSettings` 的 legacy migration 仅针对缺少 `"W:"` 或 `"S:"` 前缀的旧键重置一次，防止重读时修改状态。

### 2.2 核心文件瘦身：`app-core.js`
- 源码行数从 **5005 行** 缩减至 **4695 行**（净减少 310 行业务实现）。
- 移除 core 中内联的 Review 规则、会话状态变量与事件监听逻辑；
- 增加 `AppReview` 依赖声明与 `APP_REVIEW_INSTANCE_CONTRACT` 契约声明；
- `collectRuntimeBindings()` 中执行 `AppReview` 启动闸门校验与实例创建；
- 保留所有向后兼容的薄委托函数，全部直达 `appReview.<method>()`；
- 移除外层对 `markReviewDone` 的重复 `wrapUserOp` 包装（已在模块内部统一包装）；
- 在 `__ATTENTION_INBOX__` 导出 `APP_REVIEW_INSTANCE_CONTRACT`、`get review()`、`get reviewSurface()` 与 `markReviewTriggerPicked`。

### 2.3 生产清单与缓存契约
- **`index.html`**：在 `lib/app-native-coordinator.js` 之后引入 `<script src="lib/app-review.js"></script>`。
- **`sw.js`**：
  - 缓存版本从 `attention-inbox-v30` 推进至 `attention-inbox-v31`；
  - `ASSETS` 静态资源清单增补 `"./lib/app-review.js"`。
- **`scripts/verification/production-scripts.js`**：
  - 导出 `reviewInstanceCoverage`，与 `APP_REVIEW_INSTANCE_CONTRACT` 双向闭合对齐。

### 2.4 测试套件与线索补充
- **`test-smoke.js`**：沙箱 VM 环境同步加载并运行 `lib/app-review.js`。
- **`test-regressions.js`**：`LIB_SOURCES` 增补 `"lib/app-review.js"`。
- **`test-boot-combination.js`**：
  - `EXPECTED_INDEX_SCRIPTS` 增补 `"lib/app-review.js"`；
  - 增补 `reviewInstanceCoverage` 双向闭合测试及契约/转发缺失的反向变异测试；
  - 增补 `assertReviewBootFailure`（缺脚本、空命名空间、工厂抛错、缺契约成员共 30 项启动失败路径）；
  - 增补正向 `AppReview` 生产链装配与方法可用性断言。
- **`package.json`**：`"test"` 脚本增补 `node scripts/verification/p3f-review-tests.js`。
- **`scripts/verification/p3f-review-tests.js`**：
  - 11 项健康行为单元测试（依赖校验、默认与升级迁移、窗口键格式、窗口判定与跨午夜、模糊检测、队列过滤、事务包装、拒绝中止、writeIfChanged 短路、额度上限、兜底抑制）；
  - 5 项临时源变异测试（窗口键前缀篡改、额度上限绕过、wrapUserOp 绕过、writeIfChanged 短路绕过、兜底抑制篡改），全部变红捕获；
  - 变异执行后断言产品源码 `lib/app-review.js` SHA-256 逐字节一致。
- **`scripts/verification/browser-review-check.py`**：
  - 无头 Chrome 真实页面测试：验证 `#openReview` 渲染、点击打开 `#sheetReview`、卡片数据展示、`#reviewKeep` 推进、`#btnReviewSettings` 打开计划设置 `#sheetReviewSchedule` 以及保存后关闭。

---

## 3. 验证结果汇总（实施方自测）

### 3.1 单元与变异测试（`p3f-review-tests.js`）
```
healthy checks passed
windowKeyPrefixMutant: prefix W: removed from reviewSessionKey: mutation detected
quotaLimitBypassMutant: maxNotifications check removed: mutation detected
markReviewDoneUnwrappedMutant: wrapUserOp bypassed: mutation detected
writeIfChangedBypassMutant: writeIfChanged short-circuit bypassed: mutation detected
fallbackSuppressedBypassMutant: isFallbackSuppressed forced false: mutation detected
lib/app-review.js before/after SHA-256 match: d367fa85bf39164bdc08ff5c406174349f101bc888b2f736f4eeecf46f37f762
```

### 3.2 组合启动测试（`test-boot-combination.js`）
```
========== 生产组合启动测试结果 ==========
通过: 846  失败: 0
全部通过。
```

### 3.3 全量 `npm test` 套件
完整日志归档于同目录 [`p3f-npm-test.log`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1135-p3f-app-review/p3f-npm-test.log)。
- `test-unit.js`: 通过 642 项，失败 0 项
- `test-native-reminders.js`: 通过 324 项，失败 0 项
- `scripts/verification/p3a-model-tests.js`: PASS
- `scripts/verification/p3b-persistence-tests.js`: PASS
- `scripts/verification/p3c-transaction-tests.js`: PASS
- `scripts/verification/p3d-items-tests.js`: PASS
- `scripts/verification/p3e-coordinator-tests.js`: PASS
- `scripts/verification/p3f-review-tests.js`: PASS (11 healthy + 5 mutants)
- `test-boot-combination.js`: 通过 846 项，失败 0 项
- `test-smoke.js`: 通过 266 项，失败 0 项
- `test-regressions.js`: 通过 730 项，失败 0 项
- `scripts/verification/parse-single-source.js`: 通过 160 项，失败 0 项
**累计通过：2968 项，失败：0 项**。

### 3.4 浏览器真实 DOM 行为（`browser-review-check.py`）
```json
{"ready": true, "hasContract": true, "entryRendered": true, "sheetOpen": true, "cardTitleMatched": true, "scheduleOpen": true, "scheduleClosed": true}
```
- `browser-recovery-check.py`: PASS
- `browser-import-format-check.py`: 11 个用例全部 PASS
- `ui-dom-parity.js`: 590 项比对逐项一致 (PASS)
- `ui-format-parity.js`: 567 项比对逐项一致 (PASS)

---

## 4. 33 项五层 Web 资源哈希核对

核验范围涵盖 33 个 Web 资源（26 个 `lib/` 脚本 + 7 个根目录文件）：
- `source`（根目录）
- `www`（Capacitor 导出）
- `android-assets`（Android 主工程静态资源）
- `intermediate`（Gradle 编译产物合并目录）
- `apk`（新生成候选包内部资源）

核验脚本：[`verify-resources.py`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1135-p3f-app-review/verify-resources.py)
核验结果：
```
source-resource-count=33
mismatch-count=0
apk-sha256=f61e1849e3e2c3de4c7b40421a40ae19e07042a472c2992b39a2b4ed6b2aa379
```
- 资源总数：**33** 项
- 五层不匹配（mismatch）：**0** 项
- 缺失（missing）：**0** 项
- 逐文件比对清单参见同目录 [`resource-hashes.tsv`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1135-p3f-app-review/resource-hashes.tsv)。

---

## 5. 核心文件 SHA-256 汇总

详细见同目录 [`source-hashes.txt`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1135-p3f-app-review/source-hashes.txt)。

| 文件路径 | 现场 SHA-256 | 说明 |
| --- | --- | --- |
| `app-core.js` | `2e62e955cb051acb4529f80c3dd7c2e2a9a21fb0a4e6ca55880a9077da085430` | P3-F 瘦身后核心装配脚本（4695 行） |
| `lib/app-review.js` | `d367fa85bf39164bdc08ff5c406174349f101bc888b2f736f4eeecf46f37f762` | 本轮新抽取待整理 UMD 模块（636 行） |
| `sw.js` | `acee626f2d50298f0d32b7f839fb03be2264bba4097c2ffcdc78cc24f16f8805` | 升级至 `v31` 并包含 `lib/app-review.js` |
| `index.html` | `a5899d2811e08c31b50d8005b40bbf1ee140c13c5010b98ca20511c00320f41d` | 引入 `lib/app-review.js` |
| `lib/app-native-coordinator.js` | `6d91d0047ef321651689dad7a5c3c98e660d48b1dc64c8f64bbf69963585f361` | 零改动，保持 P3-E-R 交付字节 |
| `releases/candidates/20260923T1115-p3er-candidate/app-debug.apk` | `5624f9a851b0364a1ccb2512a90e4cfdaaa90077fc18212fbddbf854e258a267` | **前序候选受保护未改动** |
| `releases/candidates/20260923T1135-p3f-candidate/app-debug.apk` | `f61e1849e3e2c3de4c7b40421a40ae19e07042a472c2992b39a2b4ed6b2aa379` | **本轮 P3-F 全新候选 APK** |

---

## 6. 遗留风险与交付结论

- **遗留风险**：
  - 待整理卡片的富交互在极端低内存 Android 设备上的 WebView 回收行为依赖原生状态暂存，已通过 `browser-review-check.py` 验证基本 DOM 与交互流转，真实设备长期后台保留由独立验收阶段进一步确认。
  - P3-G 提醒弹条与 P3-H 入口收口尚未开展，当前留在 core 的相关引用保持原样。
- **实施结论**：
  **实施方自测通过，交付收口就绪，待独立复验方复核。**
