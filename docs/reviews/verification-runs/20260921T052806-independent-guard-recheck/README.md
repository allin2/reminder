# app-core 根守卫修复第四次独立复验

日期：2026-09-21。run：`20260921T052806-independent-guard-recheck`。

**裁决：FAIL / FIX_REQUIRED。** 上轮 F02-R2 已修复：根对象守卫不再替成员豁免，别名与直接命名空间两种真实形态都会进入 `undeclared/problems`，真正的成员级守卫仍保留为可选引用。新增的两个成员缺失或 `UNDO_WINDOW_MS` 类型错误，也会在 IndexedDB 打开前阻断。

仍有一个运行时契约阻断：`Feedback.TEST_FEEDBACK` 的真实消费者直接调用 `.map()`，但声明表只要求 `object`，启动闸门也只检查 `typeof`。独立注入 `{}` 后，应用仍报告 `ready=true` 且 `startupFailure=null`，随后真实消费者抛出 `list.map is not a function`。因此“依赖坏掉时启动前 fail-closed”尚未成立。

本轮 `npm test` 2144 项、567/590 UI 对照和 Chrome 六场景都通过；这些正常路径与已有故障场景没有覆盖上述对象形状反例，不能覆盖该阻断。原计划 P2 剩余、P3、P4、构建、APK 与实机验收仍未执行。

## 1. 被测身份

- 仓库 `/Users/qlyf/Developer/reminder`，分支 `main`，HEAD `3574824357dc7beb04cbd3e32aa413cd508e8484`。
- 验收对象是未提交工作区字节；没有把 HEAD 或 `origin/main` 当成本轮实现内容。
- `app-core.js`：8,650 行 / 400,477 字节，SHA-256 `1d955da3123c3f1897e53fd0155871b35ae563cb4417d7ad6f69cc832f697434`。
- `scripts/verification/production-scripts.js`：`36ddb03182b2ea0f791ddfcfabf86c6e62d30b87cff6ce521a05f6c628dc09dc`。
- `test-boot-combination.js`：`43f6e0c4a8116e225177a9af5753e58ead387dc76ca3dbcb7b2428ecd710231d`。
- `scripts/verification/parse-single-source.js`：`91440b84d57e70da3f5936fb71d44ebe81d4b39f79be2a718feceed98159230d`。
- `lib/feedback.js`：`bfe41dd392d5ff27d8c92b41154fc7e4e5a125eaaa1c8fae6ae3298186669eb3`。
- 本次没有修改产品源码、原测试、实施方证据或 Git 历史。变异只作用于独立 harness 的源码副本与运行时 overrides。
- 结束时上述产品哈希未变，`git diff --check` 退出 0。见 [source-integrity-final.txt](evidence/source-integrity-final.txt)。

## 2. F02-R2 复验：PASS

`scripts/verification/production-scripts.js:144–149` 的 `isGuardedRef(line, ref)` 现在只识别精确成员守卫：`if (...Ns.member...)`、`Ns.member &&/||/?` 与 `!Ns.member`。原先把 `Ns ? Ns.member()` 视为成员守卫的根对象分支已经删除。

独立探针复用了生产中的调用位置，并分别执行以下反例和对照：

| 场景 | 独立结果 |
| --- | --- |
| `feedbackApi ? feedbackApi.independentGuardedMember(...)` | 进入 `Feedback.independentGuardedMember` 的 `undeclared` 与 `problems`；不进 `guardedRefs` |
| `FeedbackLib ? FeedbackLib.independentGuardedMember() : null` | 同样进入 `undeclared/problems`；不进 `guardedRefs` |
| `if (FeedbackLib.independentOptionalMember)` | 进入 `guardedRefs`；不进 `undeclared/problems` |

这三项同时成立，说明修复既封住了根对象守卫绕过，也没有把真正的可选成员误判成必需成员。基线四出口仍为空。原始结果见 [independent-guard-and-type-probe.log](evidence/independent-guard-and-type-probe.log)。

新增的 `Feedback.TEST_FEEDBACK` 与 `Feedback.UNDO_WINDOW_MS` 已被静态扫描识别为引用和声明。把两者改成 `undefined` 后，独立运行得到 `ready=false`、IndexedDB `puts=0`、后台 interval 为空，故障逐条点名两个路径；把 `UNDO_WINDOW_MS` 改成字符串也会以 `expected=number, actual=string` 阻断。上述部分判定 PASS。

## 3. F02-R3 阻断：数组依赖只按 object 校验

`app-core.js:217` 将 `Feedback.TEST_FEEDBACK` 声明为 `object`。`collectRuntimeBindings()` 在 `app-core.js:380–387` 只做：

```js
if (got === null || typeof got !== want) {
  problems.push(...);
}
```

但真实消费者在 `app-core.js:6808–6814` 取出该值后直接执行 `list.map(...)`，实际要求至少是数组，而不是任意非 null 对象。

独立变异保持模块和其他成员完好，只把 `Feedback.TEST_FEEDBACK` 改成 `{}`，再调用源码中的真实 `testFeedbackButtonsHtml()`。实测：

```json
{
  "ready": true,
  "startupFailure": null,
  "call": {
    "threw": true,
    "message": "list.map is not a function"
  }
}
```

这不是测试夹具自造的消费方式：异常来自 `app-core.js` 的真实 `.map()` 路径。它证明当前闸门只能发现“成员不存在”和粗粒度 `typeof` 错误，不能验证该成员满足消费者需要的数组形状。实施报告把该成员称为“硬编码数组/测试反馈清单”，但代码契约仍写成 `object`，两者不一致。

**判定：FAIL / FIX_REQUIRED。** 即使正常导出和成员缺失测试都通过，一个非数组对象仍能让应用先宣告就绪，之后在用户进入相应界面时崩溃。这违反本次改造要求的启动前 fail-closed 边界。

证据：[independent-guard-and-type-probe.js](evidence/independent-guard-and-type-probe.js)、[independent-guard-and-type-probe.log](evidence/independent-guard-and-type-probe.log)。探针退出 0 表示预设的反例和对照均被成功验证，不表示产品通过。

## 4. 修复与下轮验收出口

1. 给运行时依赖表增加明确的数组契约，例如 `"array"`，并在闸门中用 `Array.isArray(got)` 判定；不能继续把数组等同于 `typeof === "object"`。
2. 将 `Feedback.TEST_FEEDBACK` 的期望类型改为数组契约，并让静态声明表读取器接受该类型；`UNDO_WINDOW_MS` 继续保持 `number`。
3. 增加永久运行时反例：`TEST_FEEDBACK={}` 必须在 IndexedDB 打开、写入、迁移、提醒调度和后台心跳之前失败，且 `startupFailure` 点名该路径及期望数组。
4. 保留 `undefined`/`null` 反例和有效数组的正常启动对照。若这里承担的是完整数据契约，还应校验每项至少具有消费者所需的 `value`、`label`；若本轮只收紧容器类型，报告须明确元素形状仍未验证。
5. 静态扫描的根守卫反例与成员守卫对照必须继续保留，避免修数组契约时回退 F02-R2。
6. 复跑 2144 项、567/590 UI 对照、Chrome 六场景，并由独立方复现 `{}` 在启动前变红。

满足这些条件后，本轮 F02-R3 才可转 PASS；这仍不等同于整个 `app-core.js` 模块化计划完成。

## 5. 通过项与证据水位

| 验证 | 独立结果 | 证据 |
| --- | --- | --- |
| `npm test` | unit 411、native 321、boot 272、smoke 256、regressions 730、single-source 154；合计 2144，失败 0，退出 0 | [npm-test.log](evidence/npm-test.log) |
| UI 格式对照 | 567 项一致 | [static-and-parity.log](evidence/static-and-parity.log) |
| DOM 工具对照 | 16 场景 / 590 字段一致 | [static-and-parity.log](evidence/static-and-parity.log) |
| 当前静态组合 | `undeclared=[]`、`ambiguousAliases=[]`、`ambiguousRefs=[]`、`problems=[]`；UI 实例契约闭合；precache/packaging 为空 | [static-and-parity.log](evidence/static-and-parity.log) |
| Chrome 恢复矩阵 | control + 5 个故障场景，0 项断言失败；control `open=1/put=1` 且重载保留事项，五个故障场景 `open=0/put=0` | [browser-command.log](evidence/browser-command.log)、[browser-recovery.json](browser/browser-recovery.json) |
| 独立守卫/类型探针 | 根守卫修复、成员守卫对照、常量缺失/类型错误均通过；同时稳定复现数组形状阻断 | [independent-guard-and-type-probe.log](evidence/independent-guard-and-type-probe.log) |

这些通过项确认本轮修改没有破坏已覆盖的正常路径与既有 fail-closed 场景，但测试全集没有覆盖 `TEST_FEEDBACK={}`，所以不能据此覆盖 F02-R3。

## 6. NOT_PERFORMED 与整体边界

| 项 | 状态 |
| --- | --- |
| P2 剩余：AI、备份、诊断、引导、内容视图、表单、逐功能拆 `bind()` | 未交付 |
| P3：持久化、事务、事项命令、原生协调迁出 | 未交付 |
| 薄装配入口 | 未达成，`app-core.js` 仍为 400,477 字节 |
| P4 离线升级、旧缓存激活 | NOT_PERFORMED；浏览器测试禁用 Service Worker |
| 构建、www/Android assets/APK 逐字节一致性 | NOT_PERFORMED；本轮未构建 APK |
| Android 实机排钟、锁屏/冷进程提醒、SAF | NOT_PERFORMED |
| 完整 UI 与性能矩阵 | NOT_PERFORMED |

实施方报告正确保留了这些边界。本次没有把旧 APK、历史设备结果、静态 packaging 检查或同机实施自测升级为当前候选的独立设备证据。
