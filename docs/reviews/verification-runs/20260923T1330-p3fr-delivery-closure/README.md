# P3-F-R 待整理模块修复与交付收口报告

> **声明：本报告为实施方自测记录，待独立验收方复验，不作为独立 PASS 结论。**

---

## 一、交付目标与问题定位

上一轮 P3-F 独立复验（`docs/reviews/verification-runs/20260923T120439-p3f-independent-recheck/README.md`）给出了 `FIX_REQUIRED` 结论，指出了两项继承缺陷阻断与一项唯一来源缺口：

1. **阻断 1（“完成”按钮无响应）**：最后一条记录确认后出现“整理完成”面板，点击动态创建的“完成”按钮无法关闭 `#sheetReview`（`completed=true, remainedOpen=true`）。原因是 `renderReviewCard()` 在 `lib/app-review.js` 中动态设置 `innerHTML` 创建按钮，而全局 `[data-close]` 监听只在启动时对既有节点绑定一次。
2. **阻断 2（保存失败误报完成并推进）**：在注入 IDB 写入失败时，`reviewConfirm()` 与 `reviewSaveEdit()` 调用异步 `deps.save()` 后未等待权威提交兑现，立即将 `state.ui.reviewIndex` 加 1 并渲染“整理完成”，页面误宣告处理完毕，而权威存储仍为 `NEEDS_REVIEW`（`reviewIndexAfterFault=1, completedAfterFault=true`）。
3. **唯一来源缺口（默认值表重复）**：`lib/app-review.js` 在已声明 `getInitialReviewSettings` 为必需依赖的前提下，在 `ensureReviewSettings` 中内置了一份 Review 默认值表作为本地回退，违背了 `AppModel` 持有默认状态的单一真理源原则。

---

## 二、修复实施细节

### 1. 动态“完成”按钮绑定关闭监听 (`lib/app-review.js`)
在 `renderReviewCard()` 的 `idx >= total` 分支中，动态生成带有 `id="btnReviewDone"` 的完成按钮后，显式为其挂载 `click` 事件监听器，直接调用 `deps.closeSheet("sheetReview")`：
- 点击该按钮即可可靠关闭 `#sheetReview` 面板及背景遮罩；
- 每次重新渲染都会重置 `innerHTML`，监听器挂载在新建的元素节点上，不会发生监听器叠加。

### 2. 权威提交等待、In-flight 闸门与 Session Token 校验 (`lib/app-review.js`)
- **权威提交守卫**：`reviewConfirm()` 与 `reviewSaveEdit()` 改为异步实现，首先调用 `wrappedMarkReviewDone`，随后 `await deps.save()` 等待权威落库兑现；
- **失败容错与内存保留契约**：若 `deps.save()` 抛出异常或被拒绝，进入 `catch` 分支，**不推进** `state.ui.reviewIndex`，**不调用** `deps.queueNativeReminderSync()`，**不渲染**完成态界面。卡片停留在当前项，确认与修改按钮保持可重试状态；
- **防重复连击（In-flight 闸门）**：引入 `reviewInflight` 状态标识，在 `deps.save()` 挂起未决期间，拦截重复点击，避免连续点击触发多次提交与并发状态冲突；
- **跨会话保护（Session Token）**：会话启动时推进 `currentSessionToken`，在异步保存兑现后比对 token、index 与 itemId，防止迟到的旧提交错误推进新建或重置后的整理会话；
- **审计其他保存路径**：`snoozeReview`、`skipReviewThisTime` 及设置保存同样在 `deps.save()` 成功后再关闭面板、提示并触发副作用。`app-core.js` 中的 `handleNativeNotificationAction` 对 `snoozeReview` 和 `skipReviewThisTime` 增加 `await` 支撑。

### 3. 收敛默认值至单一来源 `AppModel` (`lib/app-review.js`)
- 彻底移除 `lib/app-review.js` 中内联的 Review 默认值对象；
- `ensureReviewSettings()` 直接调用已校验的必需依赖 `deps.getInitialReviewSettings()`，确保与 `AppModel` 的初始状态定义完全一致。

### 4. 缓存版本与候选 APK 交付收口
- **Service Worker 升级**：`sw.js` 缓存名推进至 `attention-inbox-v32`，注释记录本次修复内容与变更原因；
- **资源同步与构建**：执行 `npm run cap:sync`，在 `android/` 下执行 `./gradlew assembleDebug` 构建新包；
- **独立候选归档**：将产物归档至全新唯一候选路径 `releases/candidates/20260923T1330-p3fr-candidate/app-debug.apk`（SHA-256: `a220d8b080c006965b47f40d5acf2ee313c9cc0a1a2e41e36a36786b8586cae2`）；
- **历史候选严格隔离**：
  - P3-E-R 历史候选 `releases/candidates/20260923T1115-p3er-candidate/app-debug.apk` 保持为 `5624f9a851b0364a1ccb2512a90e4cfdaaa90077fc18212fbddbf854e258a267`；
  - P3-F 候选 `releases/candidates/20260923T1135-p3f-candidate/app-debug.apk` 保持为 `f61e1849e3e2c3de4c7b40421a40ae19e07042a472c2992b39a2b4ed6b2aa379`。

---

## 三、验证记录

### 1. 源码语法与静态检查
- `node --check lib/app-review.js`：退出码 0。
- `node --check app-core.js`：退出码 0。
- `git diff --check`：退出码 0，无任何空白或格式问题。

### 2. 模块行为单元测试与变异测试 (`scripts/verification/p3f-review-tests.js`)
测试包含 16 项健康断言与 8 项源码变异测试，全部通过（退出码 0）：
- 变异 1（`windowKeyPrefixMutant`）：前缀 W: 移除变异被捕获。
- 变异 2（`quotaLimitBypassMutant`）：followup 额度上限检查移除变异被捕获。
- 变异 3（`markReviewDoneUnwrappedMutant`）：wrapUserOp 包装绕过变异被捕获。
- 变异 4（`writeIfChangedBypassMutant`）：writeIfChanged 短路绕过变异被捕获。
- 变异 5（`fallbackSuppressedBypassMutant`）：isFallbackSuppressed 强转 false 变异被捕获。
- 变异 6（`completionButtonListenerOmittedMutant`）：完成按钮关闭监听遗漏变异被捕获。
- 变异 7（`saveFailureAdvanceMutant`）：保存失败推进 reviewIndex 变异被捕获。
- 变异 8（`appModelDefaultsBypassMutant`）：使用硬编码默认值绕过 AppModel 变异被捕获。
- 运行前后 `lib/app-review.js` 字节级哈希完全匹配：`03b846fb783e8b377028c7c6f3ac2454c48e4b8b74574ee43ed4cfbf9608a831`。

### 3. 生产组合装配测试 (`test-boot-combination.js`)
- 执行 846 项组合测试，0 失败，退出码 0。

### 4. 全量回归与冒烟测试 (`npm test`)
- unit 642 项通过、0 失败；
- native 324 项通过、0 失败；
- boot 846 项通过、0 失败；
- smoke 266 项通过、0 失败；
- regressions 730 项通过、0 失败；
- parse 160 项通过、0 失败；
- **合计 2968 项通过，0 失败，退出码 0**。完整输出见 `p3fr-npm-test.log`。

### 5. 真实浏览器端到端测试 (`scripts/verification/browser-review-check.py`)
使用独立隔离临时 Chrome profile 运行生产页面：
```json
Initial check: {
  "ready": true,
  "hasContract": true,
  "entryRendered": true,
  "sheetOpen": true,
  "cardTitleMatched": true,
  "scheduleOpen": true,
  "scheduleClosed": true,
  "completed": true,
  "sheetClosedByDone": true,
  "reviewIndexAfterFault": 0,
  "completedAfterFault": false,
  "cardHasConfirm": true,
  "persistedStatusDuringFault": "NEEDS_REVIEW",
  "reviewIndexAfterRetry": 1,
  "completedAfterRetry": true
}
After reload: {
  "ready": true,
  "reloadedStatus": "REVIEWED"
}
All browser review checks PASSED
```
- 点击“完成”按钮后，面板可靠关闭（`sheetClosedByDone: true`）；
- 注入 IDB 保存失败时，`reviewIndexAfterFault: 0`、`completedAfterFault: false`、`cardHasConfirm: true`，IDB 权威记录仍为 `NEEDS_REVIEW`；
- 恢复存储后点击重试，推进至完成态（`reviewIndexAfterRetry: 1, completedAfterRetry: true`）；
- 页面真实刷新 reload 后，读回 IDB 权威状态确为 `REVIEWED`。

### 6. 历史复现探针反向验证
运行上一轮独立复验提供的复现脚本：
- `repro-final-button.py`：输出 `completed: true, remainedOpen: false`，因 `remainedOpen` 判定不再成立而退出 1，证实阻断 1 已消除；
- `repro-save-failure.py`：输出 `reviewIndexAfterFault: 0, completedAfterFault: false`，因缺陷判定不再成立而退出 1，证实阻断 2 已消除；
- `repro-save-failure-reload.py`：同上，证实保存失败后索引未推进。

### 7. 33 项 Web 资源五层哈希核对 (`verify-resources.py`)
运行 `python3 verify-resources.py`，核对结果：
- `source-resource-count=33`
- `mismatch-count=0`
- `apk-sha256=a220d8b080c006965b47f40d5acf2ee313c9cc0a1a2e41e36a36786b8586cae2`
- 33 项资源在源码、www、Android assets、中间构建层、APK 内部完全逐字节一致。详细清单见 `resource-hashes.tsv`。

---

## 四、候选与关键资产哈希记录

```
143e10ee5d911775bf42e1dba8dd792dedc400b76b4aa9b41a1491c1a2279f74  app-core.js
081370c6712dd74a0e8080b47e9f8917c3560fe8faef6e1b14d1b32df936e106  sw.js
03b846fb783e8b377028c7c6f3ac2454c48e4b8b74574ee43ed4cfbf9608a831  lib/app-review.js
5624f9a851b0364a1ccb2512a90e4cfdaaa90077fc18212fbddbf854e258a267  releases/candidates/20260923T1115-p3er-candidate/app-debug.apk
f61e1849e3e2c3de4c7b40421a40ae19e07042a472c2992b39a2b4ed6b2aa379  releases/candidates/20260923T1135-p3f-candidate/app-debug.apk
a220d8b080c006965b47f40d5acf2ee313c9cc0a1a2e41e36a36786b8586cae2  releases/candidates/20260923T1330-p3fr-candidate/app-debug.apk
```

---

## 五、交付结论与交接

**实施方自测结论**：P3-F 遗留的两个阻断项（完成按钮无响应、IDB 保存失败误报完成并推进）与默认值表重复项均已闭合，通过全部 2968 项自动化测试、8 项反向变异测试、端到端真实浏览器行为验证以及五层 33 项资源核对。新候选构建于 `releases/candidates/20260923T1330-p3fr-candidate/app-debug.apk`，历史证据与历史候选保持原样。

**交接说明**：本结果为实施方自测记录，现移交独立验收方进行独立复验。
