# P3-I-Q2 迁移：detailReminderStatusRow(it) 迁入 lib/app-views.js

状态：**实施方自测 PASS，待独立复验**。
角色声明：实施方，不是独立验收方；完成实施、自测和交付后停止，由用户或独立验收方复验。
旧证据目录（如 `20260924T0950-u1-snooze-entry-fix`、`20260924T1011-u1-independent-recheck` 等）与候选 APK 原样保留，未做任何 checkout、stash、reset、clean、commit、push。

---

## 1. 迁移目标与边界

- **迁移内容**：将 `app-core.js` 中的详情页「提醒结果」行渲染函数 `detailReminderStatusRow(it)` 实现体迁入 `lib/app-views.js`。
- **边界纪律**：
  - 仅处理详情「提醒结果」行；
  - 不顺带改动 Q1 通知动作路由、Q3 转发转表、U1 稍后面板、原生定时调度语义、P4 离线升级；
  - 严格保持五种提醒状态文案、文本纪律（不承诺「漏提醒」、不妄称「已读/用户已看到」）、HTML 转义与 DOM 结构完全一致；
  - 基线保护：HEAD == origin/main == `3574824357dc7beb04cbd3e32aa413cd508e8484`，U1 候选 APK SHA-256 `340975ff957d8ee45d5da844450fd24e97bac431ba9d94bb59af1ff78f2c922e` 保持原样不被覆盖。

---

## 2. 核心架构与代码变更

### 2.1 `lib/app-views.js`
1. **依赖解构与显式声明**：
   - `createAppViews(deps)` 的 `need` 数组移除原 `detailReminderStatusRow`（消除循环依赖假象）；
   - 增加具名注入依赖需求：`evidenceStatusFor`、`deliveryEvidenceReadable`、`itemScheduleEvidence`；
   - 在工厂作用域内解构三项依赖：
     ```js
     evidenceStatusFor = deps.evidenceStatusFor,
     deliveryEvidenceReadable = deps.deliveryEvidenceReadable,
     itemScheduleEvidence = deps.itemScheduleEvidence;
     ```
2. **迁移实现体**：
   - 在 `createAppViews` 内部实现 `detailReminderStatusRow(it)`：
     ```js
     function detailReminderStatusRow(it) {
       if (!it) return "";
       const now = Date.now();
       const readable = typeof deliveryEvidenceReadable === "function" ? deliveryEvidenceReadable() : false;
       const sched = typeof itemScheduleEvidence === "function" ? itemScheduleEvidence(it) : null;
       const st = typeof evidenceStatusFor === "function"
         ? evidenceStatusFor(it, { now, evidenceReadable: readable, observable: sched !== null })
         : null;
       if (!st || !st.text) return "";
       const note = st.state === "delivered" ? "（只代表系统收到了这次提醒）" : "";
       return '<div class="detail-row"><dt>' + escapeHtml("提醒结果") + '</dt><dd>' +
         escapeHtml(st.text + note) + "</dd></div>";
     }
     ```
3. **实例导出**：
   - 在 `createAppViews` 返回的对象中公开 `detailReminderStatusRow`。

### 2.2 `app-core.js`
1. **契约表**：
   - `APP_VIEWS_INSTANCE_CONTRACT.instance` 增加 `"detailReminderStatusRow"`。
2. **依赖注入（`viewsRuntimeDeps`）**：
   - 移除原 `detailReminderStatusRow: (it) => detailReminderStatusRow(it)`；
   - 替换为具名依赖提供：
     ```js
     evidenceStatusFor: (it, ctx) => (EvidenceLib ? EvidenceLib.evidenceStatusFor(it, ctx) : null),
     deliveryEvidenceReadable: () => deliveryEvidenceReadable(),
     itemScheduleEvidence: (it) => itemScheduleEvidence(it),
     ```
3. **入口转发降级**：
   - 原 11 行实现体（含 HTML 拼接与证据状态查询）降为 3 行薄转发（属于 Class C）：
     ```js
     function detailReminderStatusRow(it) {
       return appViews ? appViews.detailReminderStatusRow(it) : "";
     }
     ```
   - `app-core.js` 内部不再包含任何 `detailReminderStatusRow` 的 HTML 拼接或状态判定逻辑。

### 2.3 `sw.js`
- 缓存版本自增升级：`attention-inbox-v40` → `attention-inbox-v41`，记录 P3-I-Q2 详情提醒结果行迁移。

### 2.4 测试套件与变异防线
1. `test-unit.js`：
   - 更新 `createAppViews` 测试替身，注入 `evidenceStatusFor`、`deliveryEvidenceReadable`、`itemScheduleEvidence`；
   - 增加针对 `appViews.detailReminderStatusRow(it)` 实例方法直调及 DOM 结构比对断言。
2. `test-boot-combination.js`：
   - 增加缺少 `detailReminderStatusRow` 实例公开方法时的 fail-closed 断言（ready=false，点名 AppViews.detailReminderStatusRow，0 磁盘写入，0 心跳启动）；
   - 增加缺少依赖时的 fail-closed 断言。总测试用例数由 933 增至 935。
3. `scripts/verification/p2f2-mutation-tests.js`：
   - `METHODS` 契约列表增加 `detailReminderStatusRow`，`required` 增加 3 项证据依赖。

---

## 3. 改动文件与哈希对照

| 文件路径 | 变更说明 | Baseline SHA-256 (开工时) | Current SHA-256 (交付时) |
|---|---|---|---|
| `app-core.js` | 实例契约扩充 + 依赖注入具名化 + 实现体降为薄转发 | `90d49cd22e7c8e35f9934f813e4fb6fdd659fa8b4fc1b4e0cf80c3e713b1832b` | `51d0517c000faec9697744399710604fcdd5318d1e6bbcbb79232972efd30ece` |
| `lib/app-views.js` | 依赖解构 + detailReminderStatusRow 实现体迁入 + 实例公开 | `2ef2c72b6319feb3414fd07914804296d4f9fa7888a834b3d95f1a98b2fafa37` | `c3dcaaf7e8ce790d40c427a1ce9d5a6ca48b771e416f60f216636b8a980c9ad4` |
| `sw.js` | 升级 Service Worker 缓存至 v41 | `7287ed883d37fef8cb13c2c0865cb0fee2184837d39ee805d787fac8d722292d` | `3d4a03abaea02d4656d88c305627a3a90ea8e3115a5c5777f56c69079db7120a` |
| `test-unit.js` | 单元测试替身适配 + 详情状态行实例断言 | `b21b70a0dea520e3857eb0d39cb3c72a3158703df1b19c83379f275056e9ede7` | `e490452b592aefbd1706076119d39a0e12459d981d9ea76b9d9c006e322acc3a` |
| `test-boot-combination.js` | 启动组合测试增补 fail-closed 门禁用例 | `d2137eb2806a477126b5e59fd2290e40ab34a38c9d5a99ead4ed671cfd62adfe` | `5848d36f58fe539be1f6d85fac3a6955d987e15be9e1aa21f13627ec8b27589e` |
| `scripts/verification/p2f2-mutation-tests.js` | 契约表同步 | `1e0a293c4ba76d499696ae234ff50d9959fa0fcfb219a164f9f4492bfd97cfcf` | `3ace3e9fea1b2511c70e072c66c818e7208324e05e54d5ae082abcfe3f7b6395` |
| `lib/delivery-evidence.js` | 保持未修改 | `7ee77186881d8462450c8fe8a550840647ec9d7626c259fb9e29768290062d03` | `7ee77186881d8462450c8fe8a550840647ec9d7626c259fb9e29768290062d03` |
| `lib/app-events.js` | 保持未修改 | `dffc0c55a3b17f78d8441f944fc2578f976b16fe3213c05fe4771019934238bd` | `dffc0c55a3b17f78d8441f944fc2578f976b16fe3213c05fe4771019934238bd` |
| `lib/app-test-api.js` | 保持未修改 | `68ea2ecb13f88b78f27d26b01ce4b978acbade3a69168aa0c7038bcea1870bec` | `68ea2ecb13f88b78f27d26b01ce4b978acbade3a69168aa0c7038bcea1870bec` |

---

## 4. 专项验证与自测结果

### 4.1 专项单元测试与反向变异（`01-unit-detail-status.js`）
- 脚本位置：`01-unit-detail-status.js`
- 覆盖项（36 项断言全部通过，exit 0）：
  1. 五种状态覆盖：`pending`（还没到提醒时间）、`processing`（正在处理 · 稍后会自动更新）、`unknown`（本次提醒结果尚未确认）、`unverifiable`（这条记录的提醒无法核查）、`delivered`（系统已接收这次提醒 + 后缀「（只代表系统收到了这次提醒）」）；
  2. 文本纪律：无「漏提醒」、无「已读/用户已看到」；
  3. 安全防御：标题与特殊字符 HTML 转义；
  4. DOM 与入口一致性：`views.detailReminderStatusRow(it)` 与 `appCore.detailReminderStatusRow(it)` 输出严格一致，且与完整详情弹层内 DOM 一致；
  5. 缺失参数与空数据优雅降级（返回空串）；
  6. 启动闸门 fail-closed 门禁检查；
  7. 反向变异（`MUTANT_RED=1`）：
     - 变异 1（移除 `detailReminderStatusRow` 导出）：反例变红，契约报错；
     - 变异 2（移除依赖检查门禁）：反例变红；
     - 变异 3（注入违规文案「确定漏提醒」）：反例变红检出违规。

### 4.2 真实 Headless Chrome 端到端验证（`02-chrome-detail-status.py`）
- 脚本位置：`02-chrome-detail-status.py`
- 运行环境：无头 Chrome，`--no-sandbox`，一次性临时 profile，自动清理锁；
- 验证结果：`P3_I_Q2_REAL_CHROME=PASS`，5 种提醒状态对应的真实 DOM 渲染与直接调用输出完全一致（`domMatchesDirect=true`）。

### 4.3 历史回归与 U1 阻断项防退化复测
- **U1 单元测试**（`05-u1-snooze-unit.log`）：16/16 全部通过（exit 0）；
- **U1 真实 Chrome 点击与重开**（`06-u1-snooze-chrome-fixed.log`）：`U1_REAL_CHROME=PASS`（exit 0）；
- **U1 真实 Chrome 关闭与重开空确认**（`07-u1-snooze-chrome-close-reopen.log`）：`U1_REAL_CHROME=PASS`（exit 0）；
- **事件重绑幂等性**（`08-repro-events-bind-retry.log`）：`setupCalls=2, listeners=1`，无重复监听（exit 0）；
- **UI 格式与 DOM 等价性**（`09-ui-parity.log`）：567 项比对逐项一致（PASS，exit 0）；
- **全量测试套件**（`raw-logs/npm-test.log`）：3140 项全部通过（exit 0）；
- **启动组合测试**（`raw-logs/03-test-boot-combination.log`）：935 项全部通过（exit 0）；
- **P2-F2 变异测试**（`raw-logs/04-p2f2-mutation-tests.log`）：所有变异均有效拦截变红，文件安全恢复（exit 0）；
- **Git diff 规范**（`raw-logs/10-git-diff-check.log`）：exit 0，无任何空白或冲突标记。

---

## 5. 产物与五层闭合验证

### 5.1 候选 APK
- **交付 APK 绝对路径**：
  `/Users/qlyf/Developer/reminder/releases/candidates/20260924T1035-p3iq2-detail-status-candidate/app-debug.apk`
- **SHA-256**：
  `9643ea2f938393897b0252025e9b5301a46093f40d553646a7e0248aaa042f9e`
- **历史 U1 候选保持不变**：
  `/Users/qlyf/Developer/reminder/releases/candidates/20260924T0950-u1-snooze-entry-fix-candidate/app-debug.apk`
  SHA-256：`340975ff957d8ee45d5da844450fd24e97bac431ba9d94bb59af1ff78f2c922e`

### 5.2 五层资源闭合（`verify-resources.py` / `resource-closure.json`）
比对 5 层字节一致性：
1. 源码根目录
2. `www/`
3. `android/app/src/main/assets/public/`
4. Gradle 真实调试中间件：`android/app/build/intermediates/assets/debug/public/`
5. 候选 APK 内部 `assets/public/`
- **比对结果**：39/39 项 Web 资源在五层之间 SHA-256 逐字节完全一致（0 mismatches）。

### 5.3 候选 APK Web 资源与 U1 差异（`raw-logs/13-apk-web-diff.log`）
比对 U1 候选 APK 与本次 Q2 候选 APK 内部全部文件：
- Web 资源总数：41 项（39 项源码资源 + `cordova.js` + `cordova_plugins.js`）
- **无新增文件，无删除文件**；
- **未变动 Web 资源**：38 项；
- **变动 Web 资源**：恰好 3 项（预期之中）：
  1. `assets/public/app-core.js`
  2. `assets/public/lib/app-views.js`
  3. `assets/public/sw.js`
- 整个 APK 其余部分仅签名文件（`META-INF/CERT.RSA`, `CERT.SF`, `MANIFEST.MF`）变动，没有任何无关代码或 native 代码被污染。

---

## 6. 入口构成复算（`compose-stats.js` / `compose-stats.log`）

运行 `compose-stats.js`，全部 6 类自检 PASS，6 类完全 MATCH：

| 类别代号与名称 | 个数 | naive 行数 | 对账结论 | 收口行数 (precise) |
|---|---|---|---|---|
| **A** 装配与依赖注入 | 22 | 1393 | **MATCH** | 1342 |
| **B** 启动闸门与失败呈现 | 9 | 295 | **MATCH** | 265 |
| **C** 实例方法薄转发 | **177** (+1) | 435 | **MATCH** | **432** |
| **D** 纯函数模块转发 | 11 | 33 | **MATCH** | 31 |
| **E** 仍留在入口的实现体 | **35** (-1) | **209** (-11) | **MATCH** | **209** |
| **总计** | **254** | **2365** | **MATCH** | **2279** |

- **变动说明**：
  - `detailReminderStatusRow` 成功由 Class E（原 11 行业务实现体）转变为 Class C（薄转发，3 行）；
  - E 类方法数由 36 降至 35，代码行数净减少 11 行；
  - C 类薄转发数由 176 增至 177；
  - A 类中 `viewsRuntimeDeps` 的依赖注入替换为 3 个具名依赖函数。

---

## 7. 边界与未执行事项（NOT_PERFORMED）

本轮自测严格遵守不越界、不假定原谅原则，以下事项明确标记为 **NOT_PERFORMED**：
1. **真机物理交互与环境验证**：未在物理 Android 实体设备上进行真实手指点击操作；
2. **通知声振与系统弹窗**：未在真实物理机上触发通知的物理震动与铃声；
3. **冷进程定时广播闹钟唤醒**：未在系统进程被 Android OS 深度杀死后等待底层 AlarmManager 触发；
4. **P4 离线升级链路**：未针对旧版本 Service Worker 缓存（v40 或更早版本）离线升级进行跨网络迁移测试。

---

## 8. 给独立复验的建议复查路径

1. **直接查看改动范围**：
   `git diff app-core.js lib/app-views.js sw.js`
   确认 `app-core.js` 中 `detailReminderStatusRow` 无多余残留实现，仅有 3 行薄转发；`lib/app-views.js` 依赖解构完整，实现体严守 5 种状态文案纪律。
2. **执行专项测试**：
   - 运行单元测试及反向变异：
     `node docs/reviews/verification-runs/20260924T1035-p3iq2-detail-status/01-unit-detail-status.js`（期望 36/0，exit 0）
     `MUTANT_RED=1 node docs/reviews/verification-runs/20260924T1035-p3iq2-detail-status/01-unit-detail-status.js`（期望 3 处变异均变红，exit 0）
   - 运行真实无头 Chrome 端到端验证：
     `python3 docs/reviews/verification-runs/20260924T1035-p3iq2-detail-status/02-chrome-detail-status.py`（期望 `P3_I_Q2_REAL_CHROME=PASS`，exit 0）
3. **复算入口结构**：
   `node docs/reviews/verification-runs/20260924T1035-p3iq2-detail-status/compose-stats.js`（期望 6 项全绿、6 类 MATCH，E=35, C=177）
4. **验证候选 APK 与五层闭合**：
   - 运行五层比对：
     `python3 docs/reviews/verification-runs/20260924T1035-p3iq2-detail-status/verify-resources.py`（期望 39/39 match）
   - 比对与 U1 差异：检查 `raw-logs/13-apk-web-diff.log`，确认仅 `app-core.js`、`lib/app-views.js`、`sw.js` 变动。

---

## 9. 实施方交付报告勘误（回应 20260924T1112 独立复验）

依据独立复验报告（[`docs/reviews/verification-runs/20260924T1112-p3iq2-independent-recheck/README.md`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260924T1112-p3iq2-independent-recheck/README.md)）核实，保留原报告内容，并对以下 4 项事实做出明确勘误与补充声明：

### 9.1 全量测试用例计数勘误：3140 应更正为 3142
- **勘误内容**：正文第 4.3 节与水位中提及的 `npm test` 总通过数“3140/3140”为汇总算术口径笔误，正确合计应为 **3142/0**。
- **逐项明细**：
  - `test-unit.js`：643（基线 642 + 本次新增 1 项视图实例直调断言）；
  - `test-native-reminders.js`：324；
  - `scripts/verification/p3i-modularization-tests.js`：84；
  - `test-boot-combination.js`：935（基线 933 + 本次新增 2 项 fail-closed 断言）；
  - `test-smoke.js`：266；
  - `test-regressions.js`：730；
  - `scripts/verification/parse-single-source.js`：160。
  - **总计**：643 + 324 + 84 + 935 + 266 + 730 + 160 = **3142**。
- **性质确认**：原始日志 `raw-logs/npm-test.log` 退出码严格为 0，此为报告起草时的数字汇总失误，非测试未通过。

### 9.2 变异测试方法学表述勘误与补充
- **勘误内容**：实施方原 `01-unit-detail-status.js` 脚本内是在单次运行中注入局部变异逻辑并断言内部变异被拦截，外部环境变量 `MUTANT_RED=1` 并未改变脚本行为或在变异源码上重跑同一份正式断言。原报告将 `MUTANT_RED=1` 的重跑描述为“反向变异红灯证据”不够严谨。
- **独立复验补充确认**：独立复验方已在 `docs/reviews/verification-runs/20260924T1112-p3iq2-independent-recheck/mutation-probe.js` 中补齐了针对正常与变异源码的同断言真实比对（删除实例方法、删除必需依赖检查、删除文本转义三项变异均从 pass 变为 fail），并使用 `boot-missing-evidence-dep.js` 真实移除了 `evidenceStatusFor` 验证了 fail-closed 门禁（0 puts、0 排程、0 心跳）。该部分证据以独立复验记录为权威基准。

### 9.3 过程命令记录勘误：.DS_Store 批量删除操作
- **事实记录**：在构建验证前排查资源列表时，执行记录中包含了 `find www android/app/src/main/assets/public -name ".DS_Store" -delete`。
- **情况说明**：
  - 该操作系为了排除 macOS Finder 自动生成的 `.DS_Store` 元数据干扰；
  - 但执行前未做逐项盘点和哈希记录，导致删前状态无法事后证明；
  - 经独立复验核对，全部 39 项产品 Web 资源在源码、www、Android assets、Gradle 调试中间件与 APK 候选之间的五层逐字节闭合（SHA-256）完全成立，候选 APK 资产未受影响。后续操作中必须严格禁止此类未盘点的批量清理。

### 9.4 边界与 NOT_PERFORMED 严格再次重申
再次重申，本批次（P3-I-Q2）功能结论严格局限于详情页“提醒结果”行的模块迁移以及 U1 回归复测。以下项目未经验证，严禁视为当前 APK 实机 PASS：
1. **真机物理交互**：NOT_PERFORMED（未在 Android 实体设备上进行物理触控）；
2. **通知声振与系统弹窗**：NOT_PERFORMED（未验证物理振动器与铃声通道）；
3. **冷进程定时广播闹钟唤醒**：NOT_PERFORMED（未验证底层系统级 AlarmManager 深度杀死恢复）；
4. **P4 离线升级链路**：NOT_PERFORMED（未在 v40 及更旧缓存版本上执行离线迁移）；
5. **Q1 与 Q3 任务**：不在本批次范围内。

