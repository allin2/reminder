# P2-F2 `app-views.js` 迁出：实施任务与独立验收计划

日期：2026-09-22。前置：P2-F1 已由独立 run `20260922T172519-independent-p2f1-recheck` 判定 PASS。实施由其他 agent 执行；当前任务保留独立验收职责。

## 1. 身份与保护边界

- 仓库 `/Users/qlyf/Developer/reminder`，`main`，HEAD / `origin/main` 为 `3574824357dc7beb04cbd3e32aa413cd508e8484`。
- P2-F1 源码身份：`app-core.js` SHA-256 `61f24626c2d7332f19da652644d77e351392c325412d7efdcf379b23497e5a5f`（379,284 B），`lib/app-content.js` `82be748ea5719244cb725602a78599c1daff9a7fc349128d3e64eb7d76ab4289`。开工重新核对，若已变化先识别并保留增量。
- 大量源码、证据、release APK 与候选未提交。禁止 checkout/restore/reset/stash/clean、覆盖旧 run/APK、提交/推送或安装生产包。不要改 schema、存储 key、原生排程、AI/备份/诊断/setup/content 算法；你不是唯一工作者，不要回退他人修改。

## 2. 唯一所有权与迁移清单

新增 UMD `lib/app-views.js`，导出 `createAppViews(deps)`；模块求值零 DOM/状态副作用，实例只管理展示及自己的首页签名缓存。迁出以下当前 `app-core.js` 实现体，core 调用点只转发到同一实例：

- 卡片与详情：`priorityRank`、`actionButton`、`renderItemCard`、`openDetail`。保留原安全契约：用户文本和 `data-*` 属性转义、外链 `http(s)` 白名单、不安全 URL 降为纯文本，详情证据行由原核心回调提供。
- 首页、未来、日历、归档、笔记、我的：`homeCardSignatureRow`、`homeCardSignature`、`homeViewSignature`、`homeRenderStats`、`renderCalendar`、`renderArchiveList`、`renderFuture`、`renderNotes`、`renderStats`、`syncUserMode`、`renderMe`、`renderPwaStatus`、`render`、`refreshProjectSelects` 和 `renderHome` 的 DOM 构建/签名部分。
- `setBadge` 的 DOM 显示可迁入 views；原生/PWA app badge 写入 `updateAppBadge` 留 core，经具名回调注入。`projectById` 可迁入 views 的私有查找；若 core 其他调用仍需它，则保留单行转发，不能留第二份查找逻辑。

**关键边界：**原 `renderHome()` 在签名短路前调用 `promoteDue()`，它会改变业务状态并落库。这条业务推进不能藏进 `app-views.js`。core 保留显式 `renderHome()` 编排：先 `promoteDue()`，再调用原所有者的 `renderSetupEntry()`、`renderHomeNotice()`，然后调用 `views.renderHome()`。`views.renderHome()` 仅计算/写 DOM、刷新徽标及调用待整理入口回调；签名短路绝不跳过前述业务推进。`renderMe()` 中 AI 子面板、setup 入口、review 计数等由具名回调/live getter 提供，模块不接管这些能力。

原 `writeIfChanged` 与 `lastWrittenHtml` 仍属于首页提示/setup/review 共享写入路径，本批不要搬动；P2-E/P2-D 的绑定与动态入口条件保持。`setUserMode` 仍是设置命令，留 core，只调用 views 的 `syncUserMode`/`render`。事项动作和 `[data-act]` 路由、`state`、save/事务、review、capture、native 协调均留原所有者。不要为了实现迁移复制一份业务规则或把整个可写 ctx 注入视图。

## 3. 装配合同与加载链

明确列出 deps，至少 live `getState()`、query/queryAll/getDocument、时间和安全格式化、项目查找、attention/review 判定、原生状态/能力 getter、badge 更新、setup/notice/review/AI/详情证据的具名回调、首页空态按钮动作回调。状态数组和 `state.ui` 必须每次读取，不缓存工厂创建时的旧引用；首页签名缓存必须实例内唯一。对于核心可写动作，只注入命名命令，views 不直接调用 `save()`。

增加必需 `AppViews` 命名空间、工厂和逐项实例 API 合同；检查和绑定同一工厂结果，缺脚本、空命名空间、空壳、抛错、任一缺失成员时 `ready=false`、可见点名、IDB put/原生排程/2 秒与 15 秒业务定时器为零。同步 `index.html`（在 core 前）、SW v20→v21、boot EXPECTED、smoke、regressions、`production-scripts.js` 的 `viewsInstanceCoverage()` 双向闭合；`scripts/sync-www.js` 目录复制无需改，但必须实测。

## 4. 行为与反例

保持原文案、排序、折叠、筛选、计数、日期、详情按钮、页签标题、项目选择器选中值、设置页状态，以及首页卡片 DOM 的签名短路。首页签名必须覆盖相对时间、项目名称/颜色、可见卡片字段、折叠状态、用户模式和待整理/今日完成计数；相同签名不得重建卡片，但 `promoteDue`/setup/notice/review 的外部刷新不能被跳过。

直接实例测试至少覆盖：卡片四种 mode 与危险 title/id/url；首页空态和 due/active 展开折叠；签名不变时节点身份/焦点保持、跨分钟相对时间变动时重建、项目名变动时重建；未来日历/归档分组；笔记置顶筛选；我的页 Web/Android 状态与 AI/setup 协作；详情 paused deadline/重复规则/证据行/动作；项目选择器刷新。测试 hook 只转发生产实例，不复制渲染算法。

至少四个可执行变异并配健康对照：① 摘 `promoteDue` 编排会漏业务推进；② 删除签名中的相对时间或项目名后本应重建却跳过；③ 去掉属性转义或 URL 白名单后危险内容进入 DOM；④ 漏生产/harness 加载或清空实例合同被静态/boot 发现。每条锚点命中、同一断言变红、产品哈希前后不变。

生产浏览器至少真实点击页签、展开/收起、未来过滤/日历、笔记筛选、详情打开/关闭，验证 DOM 与状态；覆盖纯 Web 和假原生状态。P2-F1 content、P2-E setup、P2-D diagnostics、导入格式浏览器检查继续通过。跑完整 `npm test`、语法/diff、浏览器、隔离 debug APK 构建及源码→`www`→Android assets→APK 逐字节比对。

## 5. 交接和独立验收

实施 run 新建于 `docs/reviews/verification-runs/<timestamp>-p2f2-app-views-extraction/`，保存 README、所有权矩阵、开工/收尾身份与 SHA-256、原始测试退出码、浏览器记录、变异日志、APK/资源链报告及 NOT_PERFORMED。只写“实施自测”，不自判独立 PASS。不要覆盖 P2-F1 独立 run。

独立方将重读实际源码与 diff，独立跑完整回归、真实生产交互、自己的变异、打包字节核对；Android 实机交互若未执行则如实记 NOT_PERFORMED。P2-F2 通过后才进入 P2-G capture；P3 模型/事务/持久化随后分批推进。
