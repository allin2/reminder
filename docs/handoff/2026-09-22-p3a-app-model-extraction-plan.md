# P3-A `app-model.js` 模型层迁出：实施与独立验收任务书

前置：P2-G1/G2 独立通过，P2 UI/功能模块迁出阶段收口。P3 必须按模型→持久化→事务→事项→原生协调分批推进；本批只做模型。

## 身份与保护

- 仓库 `/Users/qlyf/Developer/reminder`，`main`，HEAD/origin `3574824357dc7beb04cbd3e32aa413cd508e8484`。开工核对 P2-G2 产品身份：`app-core.js` `5dd1f515ab7b0202eacfde7543e0ae1111a285ede92435660d4d55da47ec6fab`、`lib/app-capture.js` `cbf3285f427c8aec7394b8305255a545e84c4ec8152faf0d1d8c6ce35da57a4b`、SW v23。
- 保留大量未提交源码/证据/APK。禁止 checkout/restore/reset/stash/clean、覆盖历史 run/候选、提交推送、安装生产包或改生产数据。不得顺手修改 NativeReminders `migrateItem` 的既有语义、schema 号、默认设置、存储/事务/排程算法。

## 唯一所有权

新增 UMD `lib/app-model.js` 与 `createAppModel(deps)`，实例唯一持有：

- schema 5、项目颜色常量与 `createInitialState()`；每次创建必须深度独立，settings/review/ai/ui/数组不得共享引用；
- `normalizeItem`、`makeItem`、`resolveDeliveryMode`、`bumpRev`、`isTerminal`、`hasKnownRev`；保留所有默认字段、`deadlineEvents`/`reminderEvents`、rev、seriesId/repeatParentId、delivery_mode 与 native migration 调用顺序。

依赖只用具名函数：`uid()`、`now()`、`getDefaultDeliveryMode()`、`migrateNativeItem(item)`。其中 uid 仍以 `UiFormat.uid` 为唯一来源；native migration 仍以 `lib/native-reminders.js` 为唯一来源，本批不复制算法。`getDefaultDeliveryMode` 必须 live 读取当前 state，不能捕获初始 settings。

core 在绑定通过后由同一个已验证 model 实例创建初始 state；缺 model 时 state 不得进入可写业务启动。core 可保留兼容转发供既有调用/测试，不保留字段默认表或第二份终态/版本算法。`currentPayload`、`applyParsedState`、load/save/FIFO/pending replay、`state` 可写容器、事务命令、事项动作均留后续 P3 批次。

## 装配、行为与反例

- 增加 AppModel 命名空间/工厂/逐实例 API 合同；缺脚本、空命名空间、工厂抛错、缺任一成员时 `ready=false`、可见点名、零 IDB/排程/业务心跳。检查与绑定必须使用同一实例，重试可重建。
- 同步 index（core 前）、SW v23→v24、boot EXPECTED、smoke、regressions、production-scripts 双向覆盖。新增模块后 APK Web 资源应为 **28** 个。
- 直接测试覆盖：两份初始状态深隔离；全部默认值逐项保持；旧 schema 项目字段归一；`0/false/空数组/空对象` 的既有兼容语义不被“顺手修正”；重复事项 seriesId 稳定；events 对象不在事项间共享；normal/important/critical 与 live 默认投递方式；rev 非数字/0/正数；terminal；native migrate 恰一次及返回前可见。
- 持久化组合覆盖空库、已有 schema 2–5 数据、schema 迁移写回、备份导入 normalize、重载后字段与 ID 不漂移。不得因 state 延迟创建破坏 ready、分享/深链或缺模块失败面板。
- 至少四条真实行为变异：① events 共享/漏补；② delivery_mode 不读 live 默认；③ repeat seriesId 不稳定或漏 parent；④ rev/terminal 判据退化。健康对照通过、变异同一断言失败、产品哈希前后不变。
- 完整 `npm test`、语法/diff、生产 Chrome 首启/已有数据/新建/编辑/重载、既有模块浏览器回归、隔离 debug APK 28/28 资源链。

## 交接与验收

实施 run 保存开工/收尾哈希、所有权矩阵、原始日志/exit、行为变异、浏览器、APK、NOT_PERFORMED。实施自测不写独立 PASS。独立方将重跑旧数据归一/重载、live 默认投递、变异和 APK；Android 真机未做则明记。P3-A 独立通过后才进入 P3-B persistence。
