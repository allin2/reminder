# P3-I-Q2 独立复验：功能 PASS，交付报告需勘误

对象为实施方 `20260924T1035-p3iq2-detail-status` 的详情“提醒结果”行迁移。实施方报告只作线索；本 run 在当前工作区独立执行源码审查、生产组合、真实 Chrome、变异及候选身份核对。核对时 `HEAD=origin/main=3574824357dc7beb04cbd3e32aa413cd508e8484`；既有未提交工作和历史候选均保留。本 run 仅增加独立证据，不改产品源码、不提交、不推送。

## 功能与装配判定

- `lib/app-views.js` 实例现在唯一持有 `detailReminderStatusRow(it)` 的状态调用与 HTML 实现，`app-core.js` 同名函数仅薄转发；`lib/delivery-evidence.js` 仍只判状态。`viewsRuntimeDeps()` 具名注入 `evidenceStatusFor`、`deliveryEvidenceReadable`、`itemScheduleEvidence`；工厂逐项检查三者，实例契约要求新方法。详情 `openDetail()` 调用同一个实例方法，无第二份 HTML 实现。
- 专项单元独立复跑 **36/0**。真实 Chrome 独立复跑五种状态，详情 DOM 含直接调用的相同 HTML。另用本 run 的 `browser-click-detail.py` 从真实首页卡片点击进入详情，`cardFound/sheetOpen/rowVisible=true`、`detailId=it-delivered`。未知状态不写“漏提醒”；送达只说“系统已接收”，并保留限定后缀。状态文本转义测试通过。证据：`unit.log`、`browser.log`、`browser-click.log`。
- 实施方的启动组合用例对“缺具名依赖”注入了一个**新造的** `missingRequiredEvidenceDep`，没有移除真实注入的 `evidenceStatusFor`。本 run 用同一生产组合 harness 从入口装配中真正删除该字段：健康对照 `ready=true`；变异体 `ready=false`，失败面板点名 `AppViews.createAppViews()` 和 `evidenceStatusFor`；IDB put、原生排程、业务心跳均为零。证据：`boot-missing-evidence-dep.js/.log` 与保留在本 run 的变异入口副本。
- 实施方 `01-unit-detail-status.js` 的 `MUTANT_RED=1` 是检查“变异后出现坏现象”，且设置 `MUTANT_RED=1` 环境变量不改变脚本行为；它没有证明**同一正式断言**在变异源码上失败。本 run 的 `mutation-probe.js` 对正常与变异源码运行相同断言：删除实例方法、删除必需依赖检查、删除文本转义三种变异均从 pass 变为 fail，原始 `lib/app-views.js` 哈希保持不变。证据：`mutation.log`。因此功能所需的反向证据已由独立复验补齐，实施方原文对其变异方法的描述仍需勘误。
- 独立 `npm test` 退出 0；七套有数字的断言分别为 unit 643、native 324、P3-I 84、boot 935、smoke 266、regressions 730、single-source 160，按实施方既有计数口径合计 **3142/0**。UI DOM 16 场景/590 字段、UI 格式 567 项一致；U1 真实 Chrome 取消后重开及事件重绑反例继续通过。证据：`npm-test.log`、`ui-*-parity.log`、`u1-chrome.log`、`bind-retry.log`。

## 交付身份

- 当前候选：`releases/candidates/20260924T1035-p3iq2-detail-status-candidate/app-debug.apk`，SHA-256 `9643ea2f938393897b0252025e9b5301a46093f40d553646a7e0248aaa042f9e`。
- `sw.js` 为 `attention-inbox-v41`；页面 30 支脚本均在预缓存。独立复算 34 项 SW 资源和全部 39 项 Web 资源，在源码、www、Android assets、Gradle debug intermediate、APK 五层逐字节一致。证据：`sw-identity.log`、`identity.log`。
- 与 U1 候选相比，APK 无增删条目；Web 内容仅 `app-core.js`、`lib/app-views.js`、`sw.js` 三项变化，非 Web 内容仅 APK 签名清单三项变化。证据：`apk-diff.log`。入口构成脚本独立运行，自检与六类对账均绿；254 支函数，naive 2365 行、花括号收口 2279 行。此算术结果不代替行为验收。

## 报告勘误与边界

1. 实施方 README/交付报告写“npm test 3140”，与其原始输出及七项计数不符；应更正为 **3142**。原始日志退出码 0，此为汇总算术错误，不是测试失败。
2. 实施方变异报告应明确其脚本实际验证方式；不能把环境变量 `MUTANT_RED=1` 的重复绿色运行描述为正式断言变红。本 run 的独立同断言变异及精确缺依赖启动反例已补上所需证据。
3. 本批功能结论仅覆盖 P3-I-Q2 和已复跑的 U1 回归。当前候选的真机物理交互、通知声振、冷进程闹钟及 v40/更旧缓存 P4 离线就地升级均为 **NOT_PERFORMED**；不得把 Chrome 或旧候选证据写成当前 APK 实机 PASS。Q1、Q3 也不在本批。
4. 粘贴的实施执行记录包含一次 `find www android/app/src/main/assets/public -name ".DS_Store" -delete`。该操作不在 Q2 迁移目标内，且没有逐项删除前盘点；本 run 未尝试恢复或重做它。现有 39 项产品 Web 资源与候选闭合仍成立，但无法从事后哈希证明被删隐藏文件的原始状态。

本 run 保留全部原始输出与退出码。实施方可在其报告新增勘误说明，保留原报告与原日志，不回写历史证据。
