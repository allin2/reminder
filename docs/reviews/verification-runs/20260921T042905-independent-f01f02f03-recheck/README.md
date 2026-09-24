# app-core 模块化返工独立复验

日期：2026-09-21。run：`20260921T042905-independent-f01f02f03-recheck`。

**裁决：FAIL / FIX_REQUIRED。** F01 与 F03 已独立复现为关闭；F02 的当前运行时成员检查也已生效，但“别名感知的静态依赖矩阵闭合”仍有一个可复现盲区：`f` 同时被用作 `FeedbackLib` 别名和文件变量后，扫描器把全部 `f.*` 只列入 `ambiguousRefs`、不参与 `undeclared` 判定。把真实的 `f.setupSteps` 换成未声明成员，闭合检查仍返回 `undeclared=[]`。因此不能接受“实际依赖路径已闭合”的主张。

这项缺口不表示当前 69 项运行时声明里的既有成员在正常启动时失效；它表示静态守门无法阻止后续或剩余拆分代码通过 `f.<新成员>` 引入一个未登记的必需依赖。原计划 P2 剩余、P3、P4 仍未交付，整体也不能宣告完成。

## 1. 被测身份与保护

- 仓库：`/Users/qlyf/Developer/reminder`；分支 `main`；HEAD `3574824357dc7beb04cbd3e32aa413cd508e8484`。
- 验收对象是未提交工作区字节。`app-core.js` 为 8,621 行 / 397,859 字节，SHA-256 `789ee3b7abbb2f4849ea1fea02c7cd5f9c133cbefd2822140eec93cccc0cc1ed`。
- `lib/date-utils.js`：`7328f1e6ec1634a523deb21ba96ff9f9bf50f6b2ebe827b3a1e7765394cdb46c`。
- `lib/ui-format.js`：`3dcccc41863aef136abe513527d79955c5b80be9d997f5ff90d68f0fd5850c9f`。
- `lib/app-ui.js`：`84e3e97663c2a7525ff25432f335a5a422791c83e26f81014b34443d63b632e4`。
- 本次没有改产品源码、原测试、实施方证据、Git 历史或构建产物。所有独立变异只写入本 run 的 `evidence/`，通过 harness 的 `overrides` 或 HTTP 响应替换执行。
- 结束时上述产品文件哈希与开始时一致，`git diff --check` 退出 0。见 [source-hashes.txt](evidence/source-hashes.txt) 与 [source-integrity-final.txt](evidence/source-integrity-final.txt)。

## 2. 逐项裁决

### F01 | 必需 native JS 模块与原生桥是否已分开

- **我跑的命令**：当前工作区 `npm test`；Chrome 故障组合；独立 M2/M3 反向变异。
- **原始输出**：缺 `lib/native-reminders.js` 时 `ready=false`、可见失败面板点名 `AttentionNativeReminders` 及 13 个成员、IDB open=0、写入=0；完整脚本但无 Capacitor 的纯 Web 对照 `ready=true`、保存并重载保留。
- **反向能力**：跳过全部 native 声明后，失败面板消失并进入 `Cannot read properties of null`；只跳过 `reconcile` 后，损坏模块会 `ready=true`，证明当前正向判据有分辨力。
- **判定**：**PASS**。
- **证据**：[browser-recovery.json](browser/browser-recovery.json)、[browser-command.log](evidence/browser-command.log)、[independent-mutations.log](evidence/independent-mutations.log)。

### F02 | null、缺成员、UI 实例以及依赖矩阵是否闭合

运行时部分通过：

- `Feedback=null` 会点名根对象及成员；缺 `Feedback.setupSteps` 会在打开 IDB 前失败；`createUi` 空壳会点名 8 个实例 API；缺 `NativeReminders.reconcile` 会在读写库、排程和心跳前停止。
- Chrome 故障组合中这些场景均 `ready=false`、失败面板可见、IDB open=0、写入=0。
- M1 去掉 `got === null ||` 后，`Feedback` 根诊断立即消失；说明 null 断言不是恒真。

静态闭合部分未通过：

- `app-core.js:6607–6608` 的 `const f = FeedbackLib; f.setupSteps(...)` 是真实必需依赖；`app-core.js:7945` 又把 `f` 用作文件对象。
- `collectNamespaceAliases` 只做全文件级名字归类。发现第二种赋值后，把 `f` 整体标为 ambiguous；`runtimeDependencyCoverage` 在 `production-scripts.js:198–202` 将所有 `f.*` 记入 `ambiguousRefs` 后直接 `continue`，不进入 `refs/undeclared`。
- 独立变异把真实 `f.setupSteps` 换为 `f.independentUndeclaredMember`。结果仍为 `undeclared=[]`，只多出 `ambiguousRefs:["f.independentUndeclaredMember"]`。对照把 `FeedbackLib.saveFeedback` 换为同名新成员时，正确报出 `Feedback.independentUndeclaredMember`。
- 当前测试在 `test-boot-combination.js:836–844` 明确把“放弃归因，只报告”断言为成功，因此现有 2113 项回归不会捕获此盲区。

**判定：FAIL / FIX_REQUIRED。** 当前 69 项手工声明覆盖了本次已知成员，但 `undeclared=[]` 不能证明别名调用闭合。修复验收需做到作用域级别识别，或消除 `FeedbackLib` 的短别名并禁止新增；随后用 `f.<未声明成员>` 的反向变异证明 `undeclared` 必须非空。

证据：[alias-coverage-probe.js](evidence/alias-coverage-probe.js)、[alias-coverage-probe.log](evidence/alias-coverage-probe.log)、[static-and-parity.log](evidence/static-and-parity.log)。探针退出 0 表示盲区按预期被复现，不表示产品通过。

### F03 | 补载、错误顺序与重试是否使用当前绑定

- **补载重试**：Chrome 先挡掉 `parse-cn.js`，得到 `ready=false`、失败面板、IDB open=0/写入=0；补载真实脚本后重试，`ready=true`、`parseChineseTime=current`、中文输入可保存、IDB 写入=1。
- **错误顺序**：独立 HTTP 响应仅把 `parse-cn.js` 移到 `app-core.js` 后。Chrome 实测 `ready=true`、绑定 current、15 秒心跳只有一份；中文输入保存后事项数 1，重载后相同 id/title 保留，JS 错误为空。
- **结构**：`bindRuntime()` 对同一批值检查和绑定；依赖失败发生在 `init()` 前，因此失败后重试没有重复业务监听或心跳。
- **判定**：**PASS**。
- **证据**：[browser-recovery.json](browser/browser-recovery.json)、[browser-order-recheck.json](evidence/browser-order-recheck.json)、[browser-order-recheck.log](evidence/browser-order-recheck.log)。

## 3. 回归与对照水位

| 验证 | 独立结果 | 证据 |
| --- | --- | --- |
| `npm test` | unit 411、native 321、boot 254、smoke 256、regressions 730、single-source 141；合计 2113，失败 0，退出 0 | [npm-test.log](evidence/npm-test.log) |
| UI 格式对照 | 567 项一致，反向时长变异可检出 | [static-and-parity.log](evidence/static-and-parity.log) |
| DOM 工具对照 | 16 场景 / 590 字段一致，自检通过 | [static-and-parity.log](evidence/static-and-parity.log) |
| 当前静态清单 | `undeclared=[]`、precache=[]、packaging=[]；因上述 `f` 盲区，`undeclared=[]` 只代表非歧义路径 | [static-and-parity.log](evidence/static-and-parity.log) |
| Chrome 故障组合 | 6 个用例，0 项断言不满足 | [browser-command.log](evidence/browser-command.log) |
| 独立 F01/F02 反向变异 | 6/6 检查满足，退出 0 | [independent-mutations.log](evidence/independent-mutations.log) |
| F03 错序真实浏览器 | 7/7 检查满足，退出 0 | [browser-order-recheck.json](evidence/browser-order-recheck.json) |

这些通过项证明当前已登记成员的运行时故障闭环和 F03 行为已修复，不能抵消 F02 静态闭合反例。

## 4. 原计划完成度与 NOT_PERFORMED

| 项 | 本轮状态 |
| --- | --- |
| P2 剩余：AI、备份、诊断、引导、内容视图、表单、逐功能拆 `bind()` | **未交付**。`downloadFile`、巨型 `bind()` 等仍在 `app-core.js` |
| P3：持久化、提交重放事务、事项命令、原生协调迁出 | **未交付**。`writeSnapshot`、`runCommit`、`replayUserOps`、`saveItemFromForm`、`syncNativeRemindersNow`、`applyAlarmAction` 仍在 core |
| 薄装配入口 | **未达成**。`app-core.js` 仍为 397,859 字节 |
| P4 离线升级：残缺下载、旧缓存激活 | **NOT_PERFORMED**。本轮 Chrome 明确禁用 Service Worker |
| P4 构建、www/Android assets/APK 逐字节一致性 | **NOT_PERFORMED**。本轮未构建；静态 `packaging=[]` 不是产物证据 |
| Android 实机排钟、后台/锁屏/冷进程可见提醒、SAF | **NOT_PERFORMED**。无本轮候选与设备运行 |
| 完整 UI / 性能矩阵 | **NOT_PERFORMED**。仅最小保存/重启与依赖故障场景 |

实施方报告对这些未做项保持了边界，没有把它们写成 PASS。本轮也没有继承旧 APK 或历史设备证据。

## 5. 修复后复验出口

只需针对当前剩余缺口重新交付：

1. `runtimeDependencyCoverage` 能按作用域识别 `const f = FeedbackLib`，或产品源码不再使用这类短别名；文件上传处的 `f` 不得误归因。
2. 独立反向变异 `f.independentUndeclaredMember(...)` 必须进入 `undeclared`，并归一成 `Feedback.independentUndeclaredMember`。
3. 当前真实成员保持 `undeclared=[]`；2113 项回归、567/590 对照及 F01/F03 浏览器用例继续通过。

修完这一项可把 F01–F03 返工裁决提升为 PASS；原计划整体仍需完成 P2 剩余、P3、P4 后另行验收。
