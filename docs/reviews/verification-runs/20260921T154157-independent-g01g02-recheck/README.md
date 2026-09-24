# G01/G02 导入可靠性修复：独立复验

- run：`20260921T154157-independent-g01g02-recheck`
- 待验对象：未提交工作区，HEAD `3574824357dc7beb04cbd3e32aa413cd508e8484`
- 修复裁决：**G01 PASS / G02 PASS**
- P2-C 总体：**PASS_WITH_GAPS**，剩余缺口为 E1–E4、Android SAF/实机与导入格式安全面。

验收期间没有执行 `checkout`、`restore`、`stash` 或 `reset`，没有修改产品源码、产品测试或既有证据；只新增本独立 run 的日志、探针与报告。

## 交付身份

- `HEAD == origin/main == 3574824357dc7beb04cbd3e32aa413cd508e8484`
- `app-core.js`：8,510 行 / 403,228 字节，SHA-256 `f40e1b03efacaa9523b628b335dde91cfaa9c0065b6a961126fc712b398699f5`，与 P2-C 交付完全一致。
- `lib/app-backup.js`：370 行 / 16,700 字节，SHA-256 `4d38ecb6e42d00173bb72187806df28298b9b417277c3e9342f7412b889bb4eb`。
- `sw.js`：SHA-256 `bc02b02112fe4beb3b1b182e6614235168620b06738188dd3c7868925154e1e6`，缓存名 `attention-inbox-v13`。
- `test-unit.js`：SHA-256 `8a88617fa23b795bffe5d40720fa8618fa22783396525e5efb4681ee2c2ba709`。
- 上述哈希与实施方 `20260921T1425-g01g02-import-reliability/source-hashes.txt` 逐项一致。

## 验收记录

### F01 | 全量回归

- 命令：`npm test`
- 输出：unit `473/0`、native `321/0`、boot `322/0`、smoke `256/0`、regressions `730/0`、parse `160/0`，合计 **2262 通过、0 失败**，退出码 0。
- 判定：**PASS**
- 证据：`evidence/npm-test.log`、`evidence/npm-test.exit`

### F02 | UI、静态契约与加载链

- UI：格式 567 项一致；DOM 16 场景 / 590 字段一致；退出码均为 0。
- 静态：`runtime.problems=[]`、`backup.missingInContract=[]`、`backup.unusedInContract=[]`、`precache=[]`、`packaging=[]`。
- SW：v13，预缓存仍含唯一一份 `lib/app-backup.js`。
- 判定：**PASS**
- 证据：`evidence/ui-format-parity.log`、`evidence/ui-dom-parity.log`、`evidence/static-coverage.json`

### F03 | G02：成功提示等待权威提交

在真实 Chrome 的生产组合中，把实际 `app.storage.save()` 临时替换为可控 Promise，然后通过真实隐藏文件输入和生产确认弹层触发导入：

- Promise 挂起时：内存已替换为 `pending-import`，但没有成功提示、没有提前渲染。
- Promise 兑现后：首页才出现导入事项，并提示 `导入成功 · 1 条事项`。
- Promise 拒绝时：内存保留 `rejected-import`，最终文案为 `导入失败 · 数据未能保存，请重新导入`；未出现成功或“文件格式不正确”，确认弹层正常关闭。
- 判定：**PASS**
- 证据：`evidence/browser-import-reliability.py`、`evidence/browser-import-reliability.log`、`browser/browser-import-reliability.json`

### F04 | G01：FileReader error/abort 止步读取层

在真实 Chrome 生产接线中分别注入 FileReader `error` 与 `abort`：

- error：提示 `导入失败：文件读取失败，请重试`。
- abort：提示 `导入失败 · 文件读取已取消`。
- 两条路径均未打开确认弹层，未改变此前状态，也未进入持久化。
- 判定：**PASS**
- 证据：`browser/browser-import-reliability.json`

### F05 | 真实成功路径与刷新恢复

恢复真实 FileReader 和真实 storage 后再次导入：

- `stateIds=["durable-import"]`；最终提示 `导入成功 · 1 条事项`。
- IndexedDB 计量器 `opens=1 / puts=1`。
- 页面刷新后仍为 `stateIds=["durable-import"]`。
- 真实 Chrome 时序探针共 **19 项判据，0 项失败**。
- 判定：**PASS**
- 证据：`browser/browser-import-reliability.json`、`evidence/browser-import-reliability.exit`

### F06 | 独立变异

探针在内存源码中同时移除 `await deps.save()` 与 `reader.onerror/onabort`，不改工作区：

- 当前实现：11 项行为判据全部成立，`currentFailures=[]`。
- 变异实现：明确失败 `pendingNoSuccess`、`pendingNoRender`、`rejectSpecific`、`rejectNoWrongMessages`、`rejectNoRender`、`readerHandlersPresent`、`readerMessages`。
- 说明变红由本次修复产生，不是测试恒真。
- 判定：**PASS**
- 证据：`evidence/independent-g01g02-probe.js`、`evidence/independent-g01g02-probe.json`

### F07 | 既有浏览器故障矩阵

- Chrome 12 用例全部通过，0 项断言不满足。
- control `ready=true / opens=1 / puts=1`；缺件与空壳场景仍全部在开库前 fail closed。
- 判定：**PASS**
- 证据：`evidence/browser-command.log`、`browser/browser-recovery.json`、`evidence/browser.exit`

## 探针校正说明

真实 Chrome 探针首轮使用了首页不展示的 `captured` 状态，却用 `#homeActive` 判断是否渲染，产生一条探针假阴性。将夹具改为真实可见的 `due` 状态，并同时读取 `homeDue/homeActive/homeEmpty` 后，挂起期保持旧 DOM、兑现后出现事项，判据成立。产品源码与产品测试在此过程中没有改动。

## NOT_PERFORMED

- Android WebView 的真实文件导入。
- E1–E4：WebView `<a download>` 没有真实落地出口。
- Android SAF `saveDocument` 的 saved/cancelled/failed/unavailable/stale 与 8 秒宽限实机时序。
- 备份 `app/schema` 身份校验，以及 notes/projects/settings 的逐项外部输入形状校验。
- P2 剩余、P3、P4、离线升级、APK、打包逐字节比对和实机验收。

## 结论

G01 与 G02 已独立复验通过，可以从 P2-C 缺陷清单中关闭。`app-core.js` 无需改动的主张成立，SW v13 更新也正确。P2-C 的模块迁移与导入可靠性修复已收口，但备份功能仍不能升级为完整 PASS，直到 E1–E4 和 Android SAF 实机证据完成。
