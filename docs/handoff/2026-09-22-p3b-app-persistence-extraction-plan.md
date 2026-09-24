# P3-B `app-persistence.js` 持久化层迁出：实施与独立验收任务书

前置：P3-A `app-model.js` 独立复验通过，证据为 `docs/reviews/verification-runs/20260922T215022-p3a-independent-recheck/README.md`。P3 顺序保持“模型 → 持久化 → 事务 → 事项 → 原生协调”；本批只迁持久化，不提前搬事务 reducer 或原生排程。

## 1. 身份与保护

- 仓库 `/Users/qlyf/Developer/reminder`，`main`，HEAD/origin 均为 `3574824357dc7beb04cbd3e32aa413cd508e8484`。开工产品身份：`app-core.js` `f8b1226ea1f65dcf0ae46b6ccedc0825e2651a89317835478b3e76db93a9557d`、`lib/app-model.js` `0219c576a82d4df6fefe4dca62561c491f1b36c97d59de426afff7ccad41f94e`、SW v24。
- 工作区含大量未提交源码、历史证据与 APK。禁止 checkout/restore/reset/stash/clean、覆盖旧 run/APK、提交推送、安装生产包或修改设备真实数据。
- 不修改 `lib/storage.js` 的后端契约，不改变 schema、状态字段、镜像键、pending replay 格式、D41 事务语义或 native reconcile 算法。若实现确需变更 storage，先停止并说明必要性。

## 2. 唯一所有权与模块边界

新增无加载期副作用的 UMD `lib/app-persistence.js`，导出 `createAppPersistence(deps)`；状态恢复协议、写闸门与已提交快照由同一个已验证实例唯一持有。

模块迁入：

- `currentPayload`、权威状态四态与 report/attempt/blocked count、`storageReady`；
- `writeSnapshot`、`saveAsync`、`save`、FIFO `runCommit`；
- pending replay 的 key/read/write/clear/replay 与镜像来源判定；
- `loadAsync`、`recoverFromMirror`、兼容 `loadSync/load`；
- 已提交事项快照：启动恢复后建立独立基线，权威写成功后才更新；提供按 id 查询或独立快照读取，core 不再持有第二份 `committedAlarmItems`。

core 保留：

- 可变 `state` 容器、`applyParsedState` 的模型归一与 settings 迁移、`schemaMigrationNeeded`；
- D41 的 `pendingUserOps/replayUserOps`、alarm action 草稿/补偿/发布以及所有事项命令；
- native sync version、queue/reconcile 与 UI 恢复面板。持久化成功后只调用具名回调，请 core 决定是否 bump/queue；`deferNativeSync` 必须逐字保留。

core 可保留同名薄转发以兼容现有调用和测试，但不得保留写闸门、pending replay、FIFO、镜像判定或 committed snapshot 的第二份算法。`applyParsedState` 返回或让模块读取归一后的 items，以便模块建立 committed baseline；禁止模块持有第二个 live state。

## 3. 依赖与实例 API

依赖必须是具名、窄能力，建议包括：

- 数据读取：`getSchema/getItems/getNotes/getProjects/getSettings`；
- 恢复应用：`applyRecoveredState(payload)`，由 core 使用同一 AppModel 归一并更新 live state；
- 后端：`getStorage()`（lazy，装配检查期间不得开库）、`hasIdb()`；
- 镜像：`readLocal(key)/writeLocal(key,value)/removeLocal(key)`；
- 时钟：`now()`；
- 提交完成：`onCommitted(options)`，只负责 core 的 native sync 编排；
- 保存失败：`onSaveFailure(error)`，只负责现有 toast/日志。

不得注入整个 core API、DOM、render、native namespace 或 transaction context。实例至少公开现有兼容转发所需的 `currentPayload/writeSnapshot/runCommit/saveAsync/save/loadAsync/loadSync/load/replayPendingSnapshot/authoritativeWritesAllowed/authoritySnapshot/reopen/committedItemById`；最终名称可按现有风格调整，但要有实例合同和双向静态闭合。

## 4. 必须保持的行为

- **独立快照**：轮到 FIFO 作业时才读取 live payload，且只序列化/解析一次；传给异步 storage 的不是 live state。
- **权威提交**：IDB 可用时只以 `storage.save` 兑现为成功；镜像失败不能推翻已完成的权威提交。无 IDB 时 localStorage 才是权威。
- **写闸门**：`unconfirmed/failed` 一律拒写并抛 `state-authority-blocked`；零 IDB、零镜像、零 pending replay、零 native sync，同时 blocked count 增一。
- **FIFO**：前一笔成功或失败都放行下一笔；参数不能被 Promise 兑现值覆盖；`deferNativeSync:true` 抵达实际写入路径。
- **pending replay**：只代表权威已确认后的降级写；镜像恢复且权威未确认时不得生成。应用失败判 load failed；写回失败保留凭据；成功才清除。
- **恢复三态**：只有权威成功读空且无镜像/pending 残留才是 `empty`。IDB 存在但打不开、get/parse/apply 失败、只读到旧镜像，都必须 fail closed。无 IndexedDB 的环境继续以 localStorage 为权威。
- **已提交基线**：恢复成功后对归一 items 做独立快照；写失败前不得更新；原生旧投递查询继续按最后确认快照判定。
- `loadSync/load` 保持兼容行为，但生产启动仍只走 `loadAsync`；恢复失败不进入 bind/schema migration/native/tick。

## 5. 装配与资源链

- 增加 `AppPersistence` 命名空间、工厂与逐实例成员合同。缺脚本、空命名空间、工厂抛错或缺任一成员时：`ready=false`、可见点名、零读写/排程/业务心跳；检查与绑定使用同一实例，失败重试可重建。
- 同步 `index.html`（core 前）、SW v24→v25、boot EXPECTED、smoke、regressions、`production-scripts.js` 的 `persistenceInstanceCoverage()` 双向闭合、sync/www/Android 清单。
- 新模块后源码 Web 资源为 **29** 个；Capacitor 生成的 cordova 两项仍单列，不计入源码资源数。

## 6. 永久测试与真实变异

直接测试必须覆盖：模块求值零副作用、缺 deps；payload 字段与引用语义；独立快照；FIFO 顺序与失败放行；options 传递；IDB/local 权威差异；镜像异常；pending replay 保留/清除；恢复四态；committed baseline；save 失败反馈分类。

复用现有 P2-C-R/B5、storage degradation、D41 回归，不另抄一套业务实现。至少保留六条“健康绿、拔掉修复同一断言红”的临时源码变异：

1. 删除写闸门；
2. 独立快照退化为 live 对象或提前取 payload；
3. FIFO 退回 `then(job, job)` 或失败后锁死；
4. mirror/degraded 错判 loaded 并生成 pending；
5. replay 写回失败仍清 pending；
6. storage 兑现前更新 committed baseline，或恢复时不建立深拷贝基线。

变异只写独立 run 或系统临时目录，前后核对产品哈希。字符串自证或只搜索注释不算行为变异。

## 7. 验证矩阵

- 完整 `npm test`，受影响文件 `node --check`，`git diff --check`；UI 567/590 对照保持。
- 生产组合：空库、schema 2–5、migration save、分享/深链；缺 persistence 各坏形态 fail closed。
- 故障组合：IDB open/get/put 失败、镜像 absent/bad/apply fail、无 IDB、pending parse/apply/writeback fail、首次失败后 reopen 重试。
- D41：普通 save 与 alarm draft 共用同一 FIFO；不相关保存顺序、失败补偿、下一笔放行、deferNativeSync 计数保持。
- 生产 Chrome：首次启动、已有数据、导入后重载、写失败/恢复面板；复跑 capture/views/content/setup/diagnostics 的受影响入口。
- 独立 debug APK：当前源码 `www → Android assets → intermediates → APK` 29/29 逐字节一致；不覆盖历史 APK。
- Android 真机和离线 SW v24→v25 若未执行，明确 `NOT_PERFORMED`，不得由 Chrome/构建替代。

## 8. 交接与独立验收

实施 run 至少保存开工/最终哈希、函数/状态所有权表、API/依赖表、原始日志与 exit、六条行为变异、浏览器输出、资源清单、NOT_PERFORMED。实施自测不得写“独立 PASS”。

独立方将重点重跑：IDB 两项/镜像一项双启动反例、failed/unconfirmed 写闸门、pending 写回失败保留、FIFO 前笔失败后下一笔成功、committed baseline、生产 Chrome 重载和 29/29 APK。P3-B 独立通过后才进入 P3-C transaction。
