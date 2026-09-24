# P3-F-R 独立复验

**结论：PASS（P3-F-R 源码修复与新候选交付，限定于本轮范围）。** 上轮指出的动态“完成”按钮、权威保存失败误报整理完成、Review 默认值重复三项缺口已关闭。真机 Review 通知/交互和真实旧缓存→v32 离线升级仍是 **NOT_PERFORMED**；本结论不等于整个 app-core 模块化或目标设备验收通过。

## 交付身份

- 仓库 `/Users/qlyf/Developer/reminder`，分支 `main`，HEAD 与 `origin/main` 均为 `3574824357dc7beb04cbd3e32aa413cd508e8484`，工作区原有脏条目保留。本轮仅添加此独立证据目录，未修改产品源码、旧证据或候选 APK。
- 新候选：`releases/candidates/20260923T1330-p3fr-candidate/app-debug.apk`，SHA-256 `a220d8b080c006965b47f40d5acf2ee313c9cc0a1a2e41e36a36786b8586cae2`。旧 v30 与 v31 候选实测哈希与交付记录一致，详见 `source-hashes.txt`。
- `sw.js` 为 `attention-inbox-v32`，含 `lib/app-review.js`；`index.html` 的 24 支运行脚本均在 SW 清单中。独立重算源码、www、Android assets、Debug 中间层和**新候选 APK**的 33 项资源：逐项哈希一致，APK 清单无缺项/多项。此为现有 APK 字节复验，本轮未重建或真机安装。

## 独立执行与反例

- 新跑 `npm test` 退出 0，unit 642、native 324、boot 846、smoke 266、regressions 730、parse 160，合计 2968 项，失败 0；P3 模块直测链包含在命令内。原始日志、退出码见 `npm-test.log`、`npm-test.exit`。`node --check lib/app-review.js`、`node --check app-core.js`、`git diff --check` 均退出 0。
- 独立重跑实施方真实 Chrome Review 流程，退出 0：完成按钮关闭面板；IDB put 拒绝后 `reviewIndex=0`、卡片可重试、权威记录仍 `NEEDS_REVIEW`；恢复后重试推进、刷新读回 `REVIEWED`。
- 上轮独立复验脚本 `repro-final-button.py` 在新代码输出 `completed=true, remainedOpen=false`，退出 1；`repro-save-failure-reload.py` 输出拒绝后 `reviewIndexAfterFault=0, completedAfterFault=false`，刷新读回 `NEEDS_REVIEW`，也退出 1。**退出 1 是旧脚本所要求的缺陷条件不再成立，属于预期反向结果**，并非新代码测试失败。原始输出见 `old-final-button-probe.json`、`old-save-failure-probe.json`。
- 另以当前生产 Chrome 页面独立补测“保存修改”分支，见 `browser-review-save-edit-check.py` 和日志：故障拒绝时卡片不推进且 IDB 保持 `NEEDS_REVIEW`；恢复后重试完成，真实刷新读回 `REVIEWED` 及修改后的标题 `编辑后标题`，退出 0。
- 代码核对：`lib/app-review.js` 由 `deps.getInitialReviewSettings()` 获取模型默认值，已无内联 Review 默认表；动态完成按钮显式绑定关闭事件；`reviewConfirm`/`reviewSaveEdit` 等待 `deps.save()` 兑现后才推进 UI 与请求原生重排。组合闸门及 8 项变异测试随 `npm test` 通过。

## 边界

- 当前 Review 失败路径沿用项目既有“内存修改保留、权威提交失败则不宣告完成”的语义；上述独立 Chrome 注入验证了权威数据与刷新后结果。未据此推断所有原生通知或进程回收路径。
- Android 真机的 Review 通知到达、通知动作、面板交互以及真实浏览器 v30/v31→v32 离线升级未执行，仍为 **NOT_PERFORMED**。`sw.js` 既有安装时吞 `cache.addAll` 失败的路径留待 P4 离线升级专项，不能从缓存名推进或资源哈希推断升级可靠性。
