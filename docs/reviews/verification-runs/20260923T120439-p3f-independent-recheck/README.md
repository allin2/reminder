# P3-F `app-review.js` 独立复验

**结论：FIX_REQUIRED。** 模块装配、测试及候选资源闭合通过，但整理会话两条真实浏览器终点不成立：最后一条确认后的“完成”按钮无法关闭面板；IDB 权威提交失败时，界面先推进到“整理完成”，权威记录仍是 `NEEDS_REVIEW`。两项在 v30 旧候选也可复现，属于继承缺陷，并非本次迁出新增；然而 P3-F 的交付范围包含卡片操作、提交失败和重启恢复，不能把该范围判为 PASS。新模块另留下第二份 Review 默认值表。

## 身份与已通过项目

- `main`，HEAD/origin/main `3574824357dc7beb04cbd3e32aa413cd508e8484`；既有脏工作区未还原，产品源码与候选包未由本轮修改。
- 当前源码哈希、候选哈希见 `current-hashes.txt`。v30 历史候选仍为 `5624f9a851b0364a1ccb2512a90e4cfdaaa90077fc18212fbddbf854e258a267`；P3-F v31 新候选为 `f61e1849e3e2c3de4c7b40421a40ae19e07042a472c2992b39a2b4ed6b2aa379`。
- 独立运行 `npm test`，退出码 0；unit 642、native 324、boot 846、smoke 266、regressions 730、parse 160，合计 2968 项、0 失败，P3 模块直测链均执行。原始输出及退出码见 `npm-test.log`、`npm-test.exit`。`node --check`（`app-review.js`、`app-core.js`）和 `git diff --check` 均退出 0。
- 独立重算新 APK 的 33 项 Web 资源：源码、www、Android assets、Debug 中间层、APK 五层哈希与实施 TSV 一致；APK 清单无缺项、无额外条目（不计 Capacitor 生成的 Cordova 文件和插件目录）。`index.html` 的 24 个脚本都在 v31 SW 清单中。实施方浏览器脚本本轮独立重跑退出 0，但它只覆盖打开、保留和设置，没有点“确认”后的“完成”。

## 阻断 1：完成按钮是孤立节点

复现：运行 `python3 repro-final-button.py`，脚本使用一次性 Chrome profile，经真实页面准备待整理事项，点击确认至“整理完成”，再点击新生成的“完成”。`final-button-current.json` 为 `completed=true, remainedOpen=true`，表示按钮存在但 `#sheetReview` 仍打开。`renderReviewCard()` 在 `lib/app-review.js:285-290` 用 `innerHTML` 新建按钮；`app-core.js:3469-3471` 的 `[data-close]` 监听只在启动时绑定旧节点。

把同一脚本对 v30 候选 APK 解出的 Web 资源运行，`final-button-old-v30.json` 也得到 `completed=true, remainedOpen=true`。这是继承缺陷，但新模块已接管卡片尾部的创建，应在本批关闭。修复后要由真实浏览器断言点击“完成”使面板及背板关闭，并证明重复渲染不叠加监听。

## 阻断 2：权威保存失败却先宣告整理完成

复现：运行 `python3 repro-save-failure.py`。脚本先将 `NEEDS_REVIEW` 事项成功写入隔离 Chrome profile 的 IDB，再临时令 `IDBObjectStore.prototype.put` 抛错，点击真实 `#reviewConfirm`，随后直接读取 IDB `kv/state`。`save-failure-current.json` 为：内存 `REVIEWED`、IDB `NEEDS_REVIEW`、`reviewIndexAfterFault=1`、`completedAfterFault=true`。模块在 `lib/app-review.js:392-403` 调用异步 `deps.save()` 后立即推进索引和渲染，未等待权威提交。页面另会收到保存失败反馈，但完成面板已错误地宣告本条处理完毕。`repro-save-failure-reload.py` 进一步在同一隔离 Chrome profile 中真实刷新页面，`save-failure-reload-current.json` 证明读回状态确为 `NEEDS_REVIEW`。

同一脚本针对 v30 候选得到相同结果，见 `save-failure-old-v30.json`。这也是继承缺陷，但 P3-F 明确要求提交未决、拒绝和重启读回的整理语义。修复需覆盖 `reviewConfirm` 与 `reviewSaveEdit`，并审计 `openReviewSession`、`snoozeReview`、`skipReviewThisTime`、设置保存及通知额度记账的 `deps.save()` 路径，避免在提交未决/拒绝时提前宣称成功或触发原生副作用。保留既有权威状态与内存保留契约，不另开保存后端；处理连点与迟到完成，避免旧提交推进新的会话。修复后对同一故障注入应保持卡片可重试、权威记录不变、无成功宣告；提交兑现后再前进，重启读回为 `REVIEWED`。

## 唯一来源缺口

`lib/app-review.js:17-28` 已要求 `getInitialReviewSettings` 为必需函数，但 `lib/app-review.js:42-46` 又内置一份 Review 默认值表作为所谓缺依赖回退。正常路径不可达，直接运行风险较低，却新增了第二个默认值来源，违背 AppModel 持有默认状态的模块边界。删除该表及类似已声明必需依赖的静默回退，并用模型默认值变异证明真实生产路径使用 `AppModel`。

## 下一轮验收出口

实施方在现有脏工作区做最小修复，旧证据与 v31 候选保持原样；运行新增的真实浏览器终点、IDB 拒绝/兑现/重启对照及必要的反向变异，重跑受影响套件和完整 `npm test`。若产品 `lib/app-review.js` 等运行资源变更，推进 SW 缓存版本，构建到**新的唯一候选目录**并重新核对资源，不覆盖 1135 候选。修复报告应区分本轮发现的继承缺陷和新引入的默认值重复。真机 Review 通知/交互、旧缓存离线升级未执行，继续为 `NOT_PERFORMED`。

`repro-final-button.py` 与 `repro-save-failure.py` 的退出 0 表示**成功复现缺陷**，不是产品通过；JSON 原始结果是判据。两脚本可设置 `REVIEW_ROOT` 指向从旧 APK 解出的 `assets/public` 目录，以相同操作做 A/B。
