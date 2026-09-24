# P2-A `app-core.js` AI 模块迁出：独立复验

- run：`20260921T090750-independent-p2a-app-ai-recheck`
- 角色：独立验收方；未参与本轮实现
- 验收对象：未提交工作区，基线 HEAD `3574824357dc7beb04cbd3e32aa413cd508e8484`
- 单项裁决：**P2-A PASS**
- 项目阶段裁决：**PASS_WITH_GAPS**。AI 模块迁出、装配闸门、静态闭合和现有行为回归已被独立复现；P2 剩余、P3、P4、真实 AI 网络、APK 与 Android 实机仍未执行。

验收期间没有执行 `checkout`、`restore`、`stash`、`reset`，没有改动产品源码、测试源码或既有证据。新增内容仅为本 run 的日志、JSON、独立探针和本报告。

## 交付身份

- `HEAD == origin/main == 3574824357dc7beb04cbd3e32aa413cd508e8484`
- 独立取证开始时 `git status --porcelain | wc -l = 97`。实施方记录的 95 与当前相差 2 个未跟踪证据目录；关键交付文件的 SHA-256 与实施方 `source-hashes.txt` **逐项一致**，未发现产品源码漂移。
- `app-core.js`：8,620 行 / 405,182 字节，SHA-256 `88f9cc01aecd8990855f36be2a8128823f92e611a17234cb10e90c66972265ec`
- `lib/app-ai.js`：497 行 / 22,419 字节，SHA-256 `e55a286009b102129e2efe3e1bdc0a9dc8b9fbb2f1bd4884b02b56d8e20862d9`
- 身份原始记录：`evidence/source-identity-start.txt`

## 原子验收记录

### F01 | 生产回归水位

- 主张：迁出 AI 后六套 `npm test` 全绿，且前一轮基线不回退。
- 我跑的命令：`npm test`
- 原始输出：unit `465/0`、native `321/0`、boot `308/0`、smoke `256/0`、regressions `730/0`、parse `160/0`；合计 **2240 通过、0 失败**；退出码 0。
- 判定：**PASS**
- 证据：`evidence/npm-test.log`、`evidence/npm-test.exit`

### F02 | UI 行为对照

- 主张：UI 格式与 DOM 行为基线未因 AI 迁出回退。
- 我跑的命令：`node scripts/verification/ui-format-parity.js`；`node scripts/verification/ui-dom-parity.js`
- 原始输出：格式 **567** 项一致；DOM **16 场景 / 590 字段**一致；两条命令退出码均为 0。
- 判定：**PASS**
- 证据：`evidence/ui-format-parity.log`、`evidence/ui-dom-parity.log`、`evidence/ui.exit`

### F03 | 单一实现与求值期副作用

- 主张：AI 纯函数与实例实现只在 `lib/app-ai.js`，模块求值不启动业务。
- 我跑的命令：`node evidence/independent-p2a-probe.js`
- 原始输出：`extractJsonObject`、`normalizeAiResult`、`localIsoWithOffset` 在 `app-core.js` 的函数定义数均为 0，在 `lib/app-ai.js` 均为 1；模块求值只写入一次 `AttentionLib.AppAi`，fetch/定时器/监听/存储调用均为 0。
- 判定：**PASS**
- 证据：`evidence/independent-p2a-probe.js`、`evidence/independent-p2a-probe.json`

### F04 | 加载链与缓存

- 主张：生产页与 Service Worker 均包含唯一一份 `lib/app-ai.js`。
- 我跑的命令：独立探针读取 `index.html` 的真实脚本顺序和 `sw.js` 的真实 `ASSETS`。
- 原始输出：生产脚本中 `lib/app-ai.js` 恰好 1 次且位于 `app-core.js` 之前；SW 预缓存中恰好 1 次；静态 `precache=[]`、`packaging=[]`；缓存名为 `attention-inbox-v11`。
- 判定：**PASS**
- 证据：`evidence/independent-p2a-probe.json`、`evidence/static-coverage.json`

### F05 | AI 实例契约双向闭合

- 主张：`APP_AI_INSTANCE_CONTRACT` 与 `app-core.js` 的实际实例调用双向闭合。
- 我跑的命令：`aiInstanceCoverage(ROOT)`，并向内存源码增加 `ai.independentMissing()` 后重跑。
- 原始输出：基线 `missingInContract=[]`、`unusedInContract=[]`；变异后只出现 `missingInContract=["independentMissing"]`。
- 判定：**PASS**
- 证据：`evidence/static-coverage.json`、`evidence/independent-p2a-probe.json`

### F06 | 整支模块缺失与迟加载恢复

- 主张：缺少 `lib/app-ai.js` 时 fail closed；补载后可以在同一页面重试恢复。
- 我跑的命令：独立探针从生产清单删除 `lib/app-ai.js` 启动，再在同一 VM 求值真实模块并调用 `startApp()` 两次。
- 原始输出：首次 `ready=false`，只点名 `AppAi`、`AppAi.createAppAi`、`AppAi.normalizeAiResult`、`AppAi.extractJsonObject`，`puts=0`、通知排程=0、闹钟排程=0、心跳=0；补载后 `ready=true`、失败清单清空、绑定实例包含 `runOnCapture`；再次启动没有增加 2000/15000 ms 心跳。
- 判定：**PASS**
- 证据：`evidence/independent-p2a-probe.json`

### F07 | 空壳工厂与失败重绑原子性

- 主张：AI 工厂返回空对象时逐项拒绝，且不会污染此前健康实例。
- 我跑的命令：健康启动后保存实例身份，把真实 `createAppAi` 临时替换为 `() => ({})`，直接调用生产 `bindRuntime()`。
- 原始输出：15/15 个 `AppAi.*` 实例成员全部被点名；失败后 `app.ai` 与原健康实例严格同一对象。
- 判定：**PASS**
- 证据：`evidence/independent-p2a-probe.json`

### F08 | 真浏览器恢复与故障面

- 主张：真实 Chrome 中控制组可持久化，AI 整支缺失与空壳均在业务副作用前阻断。
- 我跑的命令：`python3 scripts/verification/browser-recovery-check.py --out-dir .../browser`
- 原始输出：**10 用例，0 项断言不满足，退出码 0**。control `ready=true / opens=1 / puts=1`；`shell-ai` 为 15 项 AppAi 实例错误，`missing-app-ai` 为 4 项 AppAi 模块错误，两者均 `opens=0 / puts=0` 且出现可见失败面板。
- 判定：**PASS**
- 证据：`evidence/browser-command.log`、`evidence/browser.exit`、`browser/browser-recovery.json`、`browser/browser-recovery.log`

### F09 | 实施方证据边界

- 主张：本轮没有把 P2 剩余、P3/P4、APK/实机或真实网络请求写成已完成。
- 核对结果：实施方 README 与 `not-performed.md` 对这些范围均明确标为未执行。
- 判定：**PASS_WITH_GAPS**
- 非阻断记录：实施方 `not-performed.md` 第 7 项称 `app-core.js` “仍约 4,000 行”，实际为 **8,620 行**。这是证据文案错误，不影响本次 AI 迁出的行为结论；后续汇总报告应更正。

## 独立结论

P2-A 可以收口。当前字节身份下，`lib/app-ai.js` 是 AI 请求、归一、设置和表单合并逻辑的实现位置；入口保留提交身份、表单会话裁决和测试按钮交互符合既定所有权边界。静态扫描、Node 生产组合、浏览器故障注入与独立变异探针均能在拔掉模块、增加漏声明调用或退化工厂时变红，并证明失败发生在读写库、排程和心跳之前。

## NOT_PERFORMED

- P2 剩余模块：备份、诊断、引导、内容视图、表单以及逐功能拆分 `bind()`。
- P3：持久化、事务、事项、原生协调迁出。
- P4：生产组合最终收口、离线升级、APK 内 `assets/public` 逐字节比对。
- APK 构建与本轮候选 Android 实机验收。
- AI 真实 BYOK 网络端点端到端；本轮自动化使用假 fetch。
- `Feedback.TEST_FEEDBACK` 元素值类型和函数返回值契约。
- 实施方 `not-performed.md` 所列既有产品缺口，均未因 P2-A 自动解除。

因此后续可进入 **P2 下一支模块迁移**，但不能进入“整体模块化完成”、发布或实机 PASS 的表述。
