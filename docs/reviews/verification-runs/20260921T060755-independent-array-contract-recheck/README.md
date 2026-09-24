# app-core 数组形状契约第五次独立复验

日期：2026-09-21。run：`20260921T060755-independent-array-contract-recheck`。

**本轮裁决：F02-R3 PASS；F01–F03 阻断返工可关闭。** 独立复验没有发现新的同级阻断。`Feedback.TEST_FEEDBACK` 现在同时校验数组容器、非空和每个元素的 `value`/`label` 键；坏形状会在 IndexedDB、通知/闹钟排程和后台心跳之前失败。分别移除三层判定后，对应坏输入都会重新被放行，说明通过结果不是恒真断言。

**整体 `app-core.js` 模块化仍是 PARTIAL / NOT_COMPLETE。** 本次 PASS 只关闭历次独立复验发现的 F01–F03 返工链；P2 剩余、P3、P4 离线升级、打包链、APK 和 Android 实机均未完成，不能据此宣布“巨模块拆分和双实现彻底移除”整体完成。

## 1. 被测身份

- 仓库 `/Users/qlyf/Developer/reminder`，分支 `main`。
- HEAD 与 `origin/main` 均为 `3574824357dc7beb04cbd3e32aa413cd508e8484`；被测实现仍是未提交工作区字节。
- `app-core.js`：8,709 行 / 404,171 字节，SHA-256 `ef37935be81929b98cb7b5f8eeb34e88c1e787c5d5c2be8dcea4cfdde394b0cc`。
- `scripts/verification/production-scripts.js`：`f59fa78ae41d29f4678c6c6ce3c40005809c33204a6731e6cce6ec18fde03bf8`。
- `test-boot-combination.js`：`d79d0e7cfc0a49b975e3f1486bdca5be1f7ab9b7815de9a08932cc38ab0e8336`。
- `scripts/verification/parse-single-source.js`：`08922995df3233a09030b7b2ec70c8e27137da0b101b0cf37ecf9170584a7ba9`。
- `scripts/verification/browser-recovery-check.py`：`e72eb4319b95b38a9dd33f47c958a01fff211d63179544b2355da6ab0156ce4a`。
- `sw.js`：`a342b66ab62c6269971b7d0d36f737156f5f60849dc95217a39b32230fdaf102`，源码缓存名为 `attention-inbox-v10`。
- 本次没有修改产品源码、原测试、实施方报告或 Git 历史。新增内容仅位于本独立 run；产品哈希在结束时未变化，`git diff --check` 与语法检查均退出 0。见 [source-integrity-final.txt](evidence/source-integrity-final.txt)。

## 2. F02-R3 独立反例：PASS

当前契约位于 `app-core.js:232–235`：

```js
["Feedback.TEST_FEEDBACK", "array", why, ["value", "label"]]
```

运行时闸门在 `app-core.js:396–423` 使用 `Array.isArray` 区分数组与普通对象，拒绝空数组，并遍历全部元素检查所需键。独立探针没有调用实施方的 `array-contract-probe.js`，而是从当前生产模块生成隔离变异并通过真实 `bootCombination()` 启动。

| 注入值 | 独立结果 | 启动前副作用 |
| --- | --- | --- |
| `{}` | `ready=false`；`object（不是数组）` | put=0、通知=0、闹钟=0、interval=[] |
| `[]` | `ready=false`；`空数组（清单至少要有一项）` | 全部为 0 |
| `[{value:"heard"}]` | `ready=false`；`array[0] 缺少 label` | 全部为 0 |
| `[{label:"我听到了"}]` | `ready=false`；`array[0] 缺少 value` | 全部为 0 |
| `[7]` | `ready=false`；`array[0] 元素不是对象（number）` | 全部为 0 |
| 第二个元素缺 `label` | `ready=false`；`array[1] 缺少 label` | 全部为 0 |

六个失败均精确点名 `Feedback.TEST_FEEDBACK`，期望值均为 `array<value,label>`。健康生产导出则 `ready=true`、`startupFailure=null`。

三项移除修复的对照也成立：

- 将声明从 `array` 退回 `object` 后，`{}` 再次得到 `ready=true`。
- 移除元素形状参数后，缺 `label` 的数组再次得到 `ready=true`。
- 移除非空判定后，`[]` 再次得到 `ready=true`。

因此容器、元素键和非空三条判据各自都有可观察作用。完整输出见 [independent-array-contract-probe.json](evidence/independent-array-contract-probe.json)，探针源码见 [independent-array-contract-probe.js](evidence/independent-array-contract-probe.js)。

## 3. 静态边界：实施方结论成立

当前静态基线为：

```json
{
  "undeclared": [],
  "ambiguousAliases": [],
  "ambiguousRefs": [],
  "problems": []
}
```

`declaredTypeOf["Feedback.TEST_FEEDBACK"]` 为 `array`，`Feedback.UNDO_WINDOW_MS` 仍为 `number`；当前声明类型 `array/function/number/object` 全在 `CONTRACT_TYPES` 中。

独立把 `TEST_FEEDBACK` 的声明类型退回 `object` 后，四个静态出口仍然全空。这个结果确认：静态扫描只能证明引用有声明并读出声明类型，不能证明运行时值满足数组及元素形状；F02-R3 的最终保障确实来自运行时启动闸门。

一个不阻断本轮的维护性观察：`CONTRACT_TYPES` 数组与读表正则仍各自写了一份类型列表，并非代码结构上的单一来源；当前测试会核对实际声明类型属于导出的白名单，且未知类型会 fail closed，所以当前行为没有因此失守。后续若继续扩展契约类型，应同时修改两处，或由同一常量生成读表表达式。

## 4. 回归水位

| 验证 | 独立结果 | 证据 |
| --- | --- | --- |
| `npm test` | unit 411、native 321、boot 287、smoke 256、regressions 730、single-source 160；合计 2165，失败 0，退出 0 | [npm-test.log](evidence/npm-test.log) |
| UI 格式对照 | 567 项一致，退出 0 | [ui-format-parity.log](evidence/ui-format-parity.log) |
| DOM 工具对照 | 16 场景 / 590 字段一致，退出 0 | [ui-dom-parity.log](evidence/ui-dom-parity.log) |
| 静态组合 | 四个问题出口为空；UI 实例契约、precache、packaging 均无问题 | [static-coverage.json](evidence/static-coverage.json) |
| Chrome 恢复矩阵 | control + 7 个故障场景，0 项断言失败；control open=1/put=1 且重载保留事项，七个故障场景 open=0/put=0 | [browser-command.log](evidence/browser-command.log)、[browser-recovery.json](browser/browser-recovery.json) |
| 独立形状探针 | 11/11 判据成立；包含六种坏形状、三种移除修复对照、静态边界和已声明值类型边界 | [independent-array-contract-probe.json](evidence/independent-array-contract-probe.json) |

Chrome 中新增的两条真实页面结果为：

- `feedback-array-object`：`ready=false`，面板显示 `array<value,label>` / `object（不是数组）`，open=0、put=0。
- `feedback-array-item`：`ready=false`，面板显示 `array<value,label>` / `array[0] 缺少 label`，open=0、put=0。

`sw.js` 的 v10 只得到源码级核对；浏览器恢复脚本明确不加载 Service Worker，不能把该结果提升为 P4 离线升级验证。

## 5. 已确认但不阻断本轮的边界

- 元素字段的值类型没有校验。独立注入 `[{value:{}, label:3}]` 仍得到 `ready=true`、`startupFailure=null`，与实施方报告一致。本轮 PASS 只覆盖容器、非空与键存在性。
- 函数返回值契约不在本轮范围内。
- `app-core.js` 仍为 404,171 字节，不是薄装配入口。
- P2 剩余、P3 均未交付。
- P4 离线安装/旧缓存激活为 `NOT_PERFORMED`。
- www/Android assets/APK 逐字节比对、APK 构建、Android 实机排钟、锁屏/冷进程提醒和 SAF 均为 `NOT_PERFORMED`。

因此，实施方这轮 F02-R3 修复可以进入下一阶段；整体模块化项目仍须按原计划继续，不能用本报告替代后续拆分、打包或实机验收。
