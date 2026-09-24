# app-core 别名 fail-closed 第三次独立复验

日期：2026-09-21。run：`20260921T050350-independent-alias-recheck`。

**裁决：FAIL / FIX_REQUIRED。** 本轮确实消除了 `f` 的命名歧义，歧义别名也已进入统一 `problems`；实施方新增的 MUT-A/B/C 均有效。但“新增别名依赖无法绕过矩阵”仍不成立：扫描器把“必需模块对象存在”误当成“成员可选”。在真实生产形态 `feedbackApi ? feedbackApi.setupSteps(...) : null` 中，只把成员名换成未声明成员，结果仍是 `undeclared=[]`、`problems=[]`。

F01、F03 回归继续通过；`Feedback.captureSummary` 与 `Feedback.reminderFeedback` 的新增运行时闸门也有效。阻断只在 F02 静态依赖闭合，不表示当前正常组合启动失败。原计划 P2 剩余、P3、P4 仍未交付，整体模块化不能宣告完成。

## 1. 被测身份

- 仓库 `/Users/qlyf/Developer/reminder`，分支 `main`，HEAD `3574824357dc7beb04cbd3e32aa413cd508e8484`。
- 验收对象是未提交工作区字节。
- `app-core.js`：8,634 行 / 399,210 字节，SHA-256 `8b05e1cdba1b2ab04a2abb181fb38b36d85ee998c279c503b2a87eda8630cefc`。
- `scripts/verification/production-scripts.js`：`35ea18371856a5f1c769dbe0d8b270d7e7fb637ac3c2aa44b9a705c314aae443`。
- `test-boot-combination.js`：`e644ab1a97c5f84743081074a12e72c4b17656279adb8758769a21c78c067773`。
- `scripts/verification/parse-single-source.js`：`e89d9ad08535a066ae2088f2cb1b13be5c556e6892d97a9233935a32bbf7bce9`。
- 本次没有修改产品源码、原测试、实施方证据或 Git 历史。变异只通过 `options.source` 或 harness `overrides` 作用于本 run 的证据副本。
- 结束时上述产品哈希未变，`git diff --check` 退出 0。见 [source-hashes.txt](evidence/source-hashes.txt) 与 [source-integrity-final.txt](evidence/source-integrity-final.txt)。

## 2. 阻断发现

### F02-R2 | 命名空间存在性守卫仍可绕过未声明成员检查

实际生产调用位于 `app-core.js:6620–6621`：

```js
const feedbackApi = FeedbackLib;
const st = feedbackApi ? feedbackApi.setupSteps(...) : null;
```

`Feedback` 根模块已经是 `REQUIRED_RUNTIME_EXPORTS` 的必需对象。`feedbackApi ?` 只能证明模块对象存在，不能证明 `setupSteps` 成员存在。成员缺失时仍会执行 `undefined(...)`。

扫描器的 `isGuardedRef()` 在 `production-scripts.js:137` 把任何 `Ns &&`、`Ns ||` 或 `Ns ?` 都视为成员可选；`runtimeDependencyCoverage()` 在 222 行据此把引用放入 `guardedRefs`，不参与 `undeclared/problems`。

独立反例使用真实调用位置，只做一处替换：

```diff
- feedbackApi.setupSteps(...)
+ feedbackApi.independentGuardedMember(...)
```

实测结果：

```json
{
  "undeclared": [],
  "guardedRefs": ["Feedback.independentGuardedMember"],
  "ambiguousAliases": [],
  "ambiguousRefs": [],
  "problems": []
}
```

通过直接命名空间写成 `FeedbackLib ? FeedbackLib.independentGuardedMember() : null` 也得到同一结果。说明该缺口与别名解析无关，根因是“模块守卫”被错误提升为“成员守卫”。

**判定：FAIL / FIX_REQUIRED。** 实施方 MUT-A/B 只覆盖无守卫直接调用，MUT-C 只覆盖同名歧义，三者都没有覆盖产品真实的三元守卫形态，因此 2128 项测试仍会放过这个反例。

原始证据：[independent-guard-probe.js](evidence/independent-guard-probe.js)、[independent-guard-probe.log](evidence/independent-guard-probe.log)。探针退出 0 表示反例和对照均成功复现，不表示产品通过。

## 3. 本轮通过项

### 别名消歧和 fail-closed 基础能力

- 当前源码 `aliases={feedbackApi:"FeedbackLib"}`。
- `undeclared=[]`、`ambiguousAliases=[]`、`ambiguousRefs=[]`、`problems=[]`。
- 唯一别名的无守卫新成员能归一为 `Feedback.independentDirectMember` 并进入 `undeclared/problems`。
- 直接命名空间的无守卫新成员同样被抓到。
- 同名歧义会产生 `ambiguous-alias` 与 `ambiguous-ref` 两类问题。

### 新增运行时成员

独立损坏 `lib/feedback.js` 导出：

| 损坏成员 | ready | IDB put | startupFailure |
| --- | --- | --- | --- |
| `Feedback.captureSummary` | false | 0 | 点名该成员 |
| `Feedback.reminderFeedback` | false | 0 | 点名该成员 |

说明本轮补入的两条当前依赖已经受到运行时闸门保护。

### 回归水位

| 验证 | 独立结果 | 证据 |
| --- | --- | --- |
| `npm test` | unit 411、native 321、boot 261、smoke 256、regressions 730、single-source 149；合计 2128，失败 0，退出 0 | [npm-test.log](evidence/npm-test.log) |
| UI 格式对照 | 567 项一致 | [static-and-parity.log](evidence/static-and-parity.log) |
| DOM 工具对照 | 16 场景 / 590 字段一致 | [static-and-parity.log](evidence/static-and-parity.log) |
| 当前静态组合 | 四出口为空，UI 实例契约闭合，precache/packaging 为空 | [static-and-parity.log](evidence/static-and-parity.log) |
| Chrome | control + 5 个故障场景，0 项断言不满足；control open=1/put=1，故障场景 open=0/put=0 | [browser-command.log](evidence/browser-command.log) |
| 独立静态/运行时探针 | 8/8 对照成立，其中两条确认守卫盲区 | [independent-guard-probe.log](evidence/independent-guard-probe.log) |

这些通过项确认 F01、F03 和本轮已登记成员没有回归，但不能证明静态矩阵能够捕获真实守卫形态下的新成员。

## 4. 修复出口

下一轮只需处理这一项：

1. `isGuardedRef()` 必须区分“精确检查成员存在”与“仅检查模块对象存在”。
2. 对已声明为必需的命名空间，`Ns ? Ns.member()`、`Ns && Ns.member()` 不能豁免 `member`；只有 `Ns.member && Ns.member()`、`if (Ns.member)` 等真正检查成员的形态才能进入 `guardedRefs`。
3. 检查当前 `guardedRefs` 中的所有成员。对实际上已经必需的成员，要么进入声明表并按 required 处理，要么删除无效的根对象兜底；不要仅靠手工补当前这一条。
4. 新增两条永久反向测试：
   - 在真实 `feedbackApi ? feedbackApi.setupSteps(...)` 位置替换为未声明成员，必须进入 `undeclared/problems`；
   - `FeedbackLib ? FeedbackLib.<未声明成员>() : null` 同样必须变红。
5. 保留一个真正的成员存在性守卫对照，证明可选成员仍进入 `guardedRefs`，避免把所有可选能力都误判为必需。
6. 复跑 2128 项、567/590 对照、Chrome 六场景，并确认独立反例回绿。

完成这些条件后，F01–F03 返工可判 PASS；原计划整体仍需另行完成 P2 剩余、P3、P4。

## 5. NOT_PERFORMED 与整体边界

| 项 | 状态 |
| --- | --- |
| P2 剩余：AI、备份、诊断、引导、内容视图、表单、逐功能拆 `bind()` | 未交付 |
| P3：持久化、事务、事项命令、原生协调迁出 | 未交付 |
| 薄装配入口 | 未达成，`app-core.js` 仍为 399,210 字节 |
| P4 离线升级、旧缓存激活 | NOT_PERFORMED；浏览器测试禁用 Service Worker |
| 构建、www/Android assets/APK 逐字节一致性 | NOT_PERFORMED；本轮未构建 |
| Android 实机排钟、锁屏/冷进程提醒、SAF | NOT_PERFORMED |
| 完整 UI 与性能矩阵 | NOT_PERFORMED |

实施方报告正确保留了这些边界，本次也没有把旧 APK、历史设备结果或静态 packaging 检查升级为当前候选证据。
