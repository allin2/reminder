# P2-G1 `app-capture.js` 表单层迁出：实施与独立验收任务书

前置：P2-F2 独立复验 `20260922T202253-independent-p2f2-final` 判为开发机/浏览器/APK 资源 PASS。G1 是 P2-G 的第一片，**不能**在 G1 后声称 capture 整体迁完；G2 再处理 `saveItemFromForm`、低置信度续跑和异步提交反馈。

## 身份与保护

- 仓库 `/Users/qlyf/Developer/reminder`，`main`，HEAD/origin `3574824357dc7beb04cbd3e32aa413cd508e8484`。G1 开工先复核；P2-F2 `app-core.js` SHA-256 `3eff2c1107c1f6d1f577a0dd2ea37480364495c284c9480e4aeb62cdc0241125`、`lib/app-views.js` `2ef2c72b6319feb3414fd07914804296d4f9fa7888a834b3d95f1a98b2fafa37`。
- 工作区有大量未提交修改和历史证据。不得 checkout/restore/reset/stash/clean、覆盖旧 run/APK、改生产数据、提交或推送；不得改 schema、存储 key、原生排程、AI 算法、P2-C/P2-D/P2-E/P2-F 实现。实施方不是唯一工作者，保留并适配他人编辑。

## G1 唯一所有权

新增 UMD `lib/app-capture.js`、`createAppCapture(deps)`。模块求值零 DOM/状态/计时器副作用，工厂显式核对具名依赖，实例是表单展示和会话身份唯一所有者。迁出原 core 的：

- `itemFormSession`、`triggerUserPicked`；`snapshotItemForm`、`formDraftSignature`、`restoreItemForm`、`resetItemSheet`、`openCapture`、`openEditItem`、`formRepeat`、`updateRepeatPreview`、`normalizeText`、`findSimilarItems`、`renderSimilarHint`、`updateParseHint`、`renderCaptureSummary`。只保留调用转发，不能留两份算法。
- 把表单输入 `change/input` 中对 `triggerUserPicked` 的设置与上述渲染绑定交给 capture 实例，保持绑定幂等。开放 `session()`、`markTriggerPicked()`、`snapshotItemForm()`、`formDraftSignature()` 等最小现有调用面；明确 `lowConfUserPicked` 在 G1 仍由 core 持有，快照与签名所需值经具名 getter/setter 注入，G2 再整体搬走。
- `openEditItem` 的只读项目/事项查询用 live getter，事项和 `state.ui` 不在工厂创建时缓存；`refreshProjectSelects` 走已验证 views 实例的具名回调。表单 DOM/签名由 capture 管，事务不经 capture 绕写。

**刻意保留 core**：`saveSubmitsInFlight`、提交 token、`beginSaveSubmit`/`endSaveSubmit`、`saveItemFromForm` 的全部解析决策与事务、`applyItemEdit`/`applyNewItem`、`runUserOp`、`save`、反馈、低置信度 `pendingFinishSave`/续跑。这些属于 G2/P3 的高风险异步边界。G1 不引入通用可写 ctx、第二套去重/解析/保存实现，也不改变任何成功/失败文案或按钮时序。

## 装配与反例

- 使用 core 既有 `collectRuntimeBindings()` 的检查和绑定同源路径：`AppCapture` 命名空间、`createAppCapture` 工厂、逐项实例 API 合同，失败面板点名；缺脚本、空命名空间、工厂抛错、任一缺成员时 `ready=false` 且 IDB put/原生排程/业务心跳零。
- 同步 `index.html`（core 前）、SW v21→v22、`test-boot-combination` EXPECTED、`test-smoke`、`test-regressions`、`production-scripts.js` 双向实例覆盖和预缓存清单。构建后 27 个 Web 资源应与 APK 逐字节一致。
- 保留 R-F03：提交在途时关闭重开、改字、编辑/新建切换，旧成功不能清空新表单，旧失败不能覆盖新字；用户手选/清空提醒时间优先级和原稍后 elapsed 元数据不变。相似提醒只提示不自动合并；危险标题/id 在提示 DOM 中安全转义。新建空态、编辑复杂字段展开、重复预览和低置信度选择入口继续正常。
- 正式直接实例测试至少覆盖表单会话每次 reset 递增、快照/签名对手选与未手选时间的区别、重新打开同内容仍不同会话、编辑填充/复杂展开、项目选中、相似提示转义与筛选、重复预览、parse hint 用户时间不被覆盖。boot 真实坏模块反例，至少四条带健康对照、同断言变红的源码变异（会话不递增、删除表单签名时间区分、漏实例成员、漏加载链）。
- 浏览器真实点击新建/编辑、输入手选时间、展开更多、重复预览、相似提示、关闭重开、点击保存；P2-F2 views、P2-F1 content、P2-E setup、P2-D diagnostics、P2-C-S import 格式回归继续通过。跑 `npm test`、语法/diff、隔离 APK 源码→www→assets→APK 比对。

## 交接与判定

实施证据新建 run：源码前后哈希、所有权表、原始日志与 exit、反例变异、浏览器记录、APK 身份、NOT_PERFORMED。实施自测不得写独立 PASS。独立方会复核当前字节、生产入口、R-F03 迟到结果反例、浏览器与 APK；实机未做必须明记。G1 独立通过后再开 G2；P2-G 需 G1+G2 都通过才收口。
