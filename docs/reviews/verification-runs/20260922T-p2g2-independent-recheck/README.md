# P2-G2 capture 提交编排独立复验

判定：**PASS（开发机源码、生产 Chrome、debug APK 资源身份）**。连同 P2-G1 的独立 PASS，P2-G capture 模块化在本证据等级上收口。Android 真机保存/失败注入、离线 SW v22→v23 升级和正式发布仍为 **NOT_PERFORMED**。

## 身份与边界

- 仓库 `/Users/qlyf/Developer/reminder`；`main`、HEAD、`origin/main` 均为 `3574824357dc7beb04cbd3e32aa413cd508e8484`。收尾 `git status --short` 164 行，保留全部既有源码、证据和未提交项；未 checkout/stash/reset/clean、提交、推送或操作生产数据。
- 最终 SHA-256：`app-core.js` `5dd1f515ab7b0202eacfde7543e0ae1111a285ede92435660d4d55da47ec6fab`；`lib/app-capture.js` `cbf3285f427c8aec7394b8305255a545e84c4ec8152faf0d1d8c6ce35da57a4b`；`index.html` `2a1de8f70de8ecf9010432e5dcda67f47a6712438b8519263031712ac41490b7`；`sw.js` `ff9dc3b400d53b0e13c5d92214fcdc7e8da1eb84f77fa877ebbf30fed76a4bfa`（v23）。完整测试/脚本/APK 身份见 `final/source-hashes-end.txt`。
- `saveSubmitsInFlight`、低置信度 pending、`saveItemFromForm` 及保存 Promise 编排只在 `lib/app-capture.js` 有实现；core 仅保留入口转发和 `runEditCommand/runNewCommand/rollbackNewItem/save` 等窄命令。事务原语和权威存储没有复制进 capture。

## 独立结果

- 第一次全量复验真实发现 boot **519/520**：AI 的 `applyToForm/parseCapture` 消费迁到 capture 后，覆盖器仍只扫描 core。原始失败日志保留为 `final/npm-test-before-ai-coverage-fix.log`。实施方修正为扫描 core + capture，并加入“删除 capture 消费会重新报 unused”的反例；随后独立 `npm test` exit 0：unit **642**、native **324**、boot **521**、smoke **266**、regressions **730**、parse **160**，合计 **2643/0**。语法与 `git diff --check` 通过。
- 生产 Chrome `browser/independent-submit-timing.json`：权威写入挂起时按钮保持“保存中”、面板不关闭；旧提交完成不触碰关闭重开的新会话；IDB 写入拒绝时事项回滚、草稿和面板保留、按钮恢复并显示失败反馈；正常保存后关闭并在页面重载后从权威存储读回。该脚本对临时 profile 的 `IDBDatabase.transaction` 做当前页面故障注入，不碰用户浏览器或设备数据。
- G1 表单浏览器矩阵继续全绿；views/content/setup/diagnostics 全绿；import-format **11/11 PASS**。
- `mutations/p2g2-mutation-rerun.json` 由独立方重跑真实工厂变异：摘 token 闸门会重复新建；摘 session+signature 闸门会让迟到 AI 覆盖新表单；把权威保存 Promise 换成已兑现 Promise 会提前关闭；摘失败回滚会留下未保存事项。四条健康对照通过、变异同一行为断言失败，产品哈希前后不变。
- 构建前保留 G1 APK（SHA-256 `dfd0eb8bf65b4963fe64406ff3fed1153a0725bfad9412cf0fc22674f32098a0`）。`cap:sync` 与 `:app:assembleDebug` 成功；G2 APK `apk/p2g2-app-debug.apk` SHA-256 `ae530bcf48b4a4b2b64e20feb505ffb34400d08ef1b8ae7e7fbf3818b4d824dd`。`apk/resource-chain.json` 验证 **27/27** Web 资源在源码、`www`、Android assets、APK 内逐字节一致，missing/mismatch 为空。

## 未执行与下一步

未执行 Android 真机 capture/save/reject/迟到结果、离线缓存升级、正式签名包或发布。P2-G 已在开发机证据等级闭合；下一阶段进入 P3，必须先按模型→持久化→事务→事项→原生协调分批制定边界，不能把剩余 core 一次性搬进共享 ctx。
