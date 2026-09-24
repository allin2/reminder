# P2-G2 `app-capture.js` 提交编排迁出：实施与独立验收任务书

前置：P2-G1 独立 run `20260922T-p2g1-independent-recheck` 判定开发机/生产 Chrome/debug APK 资源 PASS。G2 完成且独立通过后，P2-G capture 才能整体收口。

## 1. 身份与保护

- 仓库 `/Users/qlyf/Developer/reminder`，`main`，HEAD/origin `3574824357dc7beb04cbd3e32aa413cd508e8484`。开工核对 G1 产品身份：`app-core.js` `1b10e4b23a6ecd04a03beda8e268fbe55f47235c260120f95d826f5791cdc763`、`lib/app-capture.js` `a2336044fb2fda30248a7ae4fb373eb87c37406e1d0962d43317fe4a99483fb1`、SW v22。
- 大量源码与证据未提交。禁止 checkout/restore/reset/stash/clean、覆盖历史 run/APK、提交/推送、安装生产包或操作生产数据；不得改 schema/storage key/native 排程/AI 网络协议/P2-C~P2-F 行为。实施方不是唯一工作者，保留他人修改，不能触碰独立 run。

## 2. 唯一所有权与边界

在现有 `lib/app-capture.js` 内迁入并成为唯一实现：

- `saveSubmitsInFlight`、`saveSubmitToken`、`beginSaveSubmit`、`endSaveSubmit`、`setSaveButtonRunning`；
- `lowConfUserPicked`、`pendingFinishSave`、`openLowConfSheet`、`finishSaveAfterLowConf`、`setLowConfPick`；G1 的跨模块 `getLowConfUserPicked/setLowConfUserPicked` 依赖应随之移除；
- `settleFailedDraft`、`keepDraftForRetry`、`saveItemFromForm` 及其内部 `finishSave` 编排。core 的按钮/Enter/低置信度 UI 事件只调用同一个 capture 实例，不保留第二份实现或另一套 token 集合。

**仍由 core/P3 所有者保留，作为具名能力注入：**模型与事务原语 `makeItem`、`normalizeItem`、`applyItemEdit`、`applyNewItem`、`runUserOp`、`save`、失败时撤回未提交新事项；解析与规则 `parseChineseTime`、`hasSpecificTimeWord`、`fallbackTriggerAt`、`detectNeedsReview`、`resolveDeliveryMode`；AI 实例 live getter；保存后的 `announceSaveOutcome`、`noteFirstRemindSaved`、`queueNativeReminderSync`、`render` 和 sheet/toast 命令。模块不能拿 `runUserOp` 通用入口再任意调用函数，也不能接收整包可写 ctx；为新建、编辑、失败回滚分别注入窄命令。权威提交 Promise 仍由 persistence 唯一产生，capture 只等待结果。

必须保持：编辑未动提醒时间时原 elapsed/snooze 元数据原样保留；显式清空/改期才切 wall-clock；用户手选 > 有效解析 > 兜底；低置信度取消后同一草稿可以再次提交；AI 失败回退本地解析；成功只在 `save()` 兑现后关闭/清空/提示，失败保留草稿且撤回未落库的新事项。

## 3. 契约、加载与测试

- 扩展 `APP_CAPTURE_INSTANCE_CONTRACT`，检查与绑定仍走同一个实例。工厂缺依赖、抛错、实例缺任一新成员时 `ready=false`、面板逐项点名、IDB/排程/2 秒与 15 秒心跳为零。
- `lib/app-capture.js` 内容变化，SW v22→v23；脚本 URL 和资源数量不变，`index.html` 顺序不改。同步 unit/boot/smoke/regressions/production coverage；最终 APK 仍应是 **27** 个 Web 资源逐字节一致。
- 直接实例与生产组合必须覆盖：普通新建、编辑、空标题、低置信度确认/改选/取消、AI 成功与失败、同一草稿 click+Enter 去重、不同会话同内容不互相阻塞、两笔不同草稿并行、权威保存 pending/resolve/reject、失败找回旧草稿、新表单不被迟到成功/失败覆盖、成功后的唯一反馈与 native sync。
- 原有 R-F03 全组必须逐条保留；F02 重复提交、F03 草稿、F08 唯一反馈、编辑稍后元数据、低置信度手选、P2-C-R 写闸门相关回归不得弱化。
- 至少四条真实源码变异并带健康对照：① 摘 token 去重会落两条；② 摘会话+签名的 `formUntouched` 会清空新表单；③ 不等待保存 Promise 会提前成功/关闭；④ 失败不回滚或旧草稿无条件恢复会污染状态/覆盖新输入。锚点必须命中，同一行为断言变红，产品源哈希前后不变。
- 生产 Chrome 真实点击保存，分别观察在途按钮、成功后落库/关闭、失败保草稿；重放关闭重开与继续输入的迟到结果。继续跑 capture G1、views/content/setup/diagnostics/import-format 浏览器回归。跑 `npm test`、syntax/diff、`cap:sync`、debug APK 资源链。

## 4. 交接

新建实施 run，保存开工/收尾哈希、所有权表、原始 exit/log、变异、浏览器、APK 和 NOT_PERFORMED。实施自测不能自判独立 PASS。独立方将用冻结后的实际字节另建 run，重点反向验证保存 pending/reject、关闭重开、双提交和 APK。Android 真机保存若没执行必须写 NOT_PERFORMED。
