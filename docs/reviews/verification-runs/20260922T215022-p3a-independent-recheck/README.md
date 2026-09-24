# P3-A `app-model.js` 独立复验

时间：2026-09-22。角色：独立验收方。结论：**PASS（开发机源码、生产 Chrome、隔离 debug APK 资源身份）**。

P3-A 模型层迁出通过；这不等于整个 P3 或 `app-core.js` 拆分完成。Android 真机、离线 SW v23→v24 升级、release 签名与正式发布均为 `NOT_PERFORMED`。

## 交付身份

- branch `main`；HEAD 与 `origin/main` 均为 `3574824357dc7beb04cbd3e32aa413cd508e8484`；工作区保留既有未提交修改与证据，未 checkout/reset/stash/clean，未提交推送。
- `app-core.js`: `f8b1226ea1f65dcf0ae46b6ccedc0825e2651a89317835478b3e76db93a9557d`
- `lib/app-model.js`: `0219c576a82d4df6fefe4dca62561c491f1b36c97d59de426afff7ccad41f94e`
- `index.html`: `3c0d060a1e8ce2d88bd0192976059a75ffa04a4c2a40c30ec8b12877bd6b091d`
- `sw.js`: `dd3ca91f891a56ff54e7791be905aa6dc7dce5f148a57b24431d02633f7b1fdf`（v24）
- `scripts/verification/production-scripts.js`: `05ce5998a21dcdd8ee3d2edc87c4a2cb9121a012f6955b1c4a9058fa1ec97356`
- `test-boot-combination.js`: `a359e79ae830b9b23f5eaf80b30a620f5ebb26db02d1c722c1f73fa4b4cb0818`

最终哈希原文见 `preflight/source-sha256-final-authoritative.txt`。

## 独立结论

1. `lib/app-model.js` 是 schema、项目颜色、初始状态、事项归一、投递方式、rev 与终态判定的唯一实现。core 中保留的同名函数均为直接转发；AI、review 与示例重置所需默认值也改为从同一已验证 model 实例的新初始状态取得，core 不再保留第二份默认表。
2. `AppModel` 在业务启动前按命名空间、工厂与 9 个实例成员 fail closed。独立矩阵覆盖缺脚本、空命名空间、工厂抛错和逐成员缺失，共 13/13；失败路径 `ready=false`，无 IDB put、原生排程或 15000/2000 ms 业务心跳。
3. `modelInstanceCoverage()` 的 `used` 与 `declared` 均为 9 项，`missingInContract=[]`、`unusedInContract=[]`；正式套件含删契约成员和删真实转发的双向反例。
4. 初始状态默认值逐项一致且两份实例深隔离；fallback event 对象不共享；caller 提供的 tags/events 引用、`0/false` 等既有语义保持；native migrate 每个事项恰一次且原位修改在返回前可见；live 默认投递、important/critical、周期身份、rev 与 terminal 矩阵均通过。
5. `index.html` 在 core 前加载模型，SW v24 预缓存模型；最终 debug APK 的 28 个 `www` Web 资源在 `www → android assets → build intermediates → APK` 四层逐字节一致。

## 复验中发现并闭环的三个问题

- 首版 `normalizeItem()` 在全局默认渠道为空字符串时返回 `""`，而旧实现回退到 `notification`。独立反例为 9 PASS / 1 FAIL；修复后 10/10，正式源码变异可检出该退化。
- 首版 core 仍保留 AI/review/示例重置默认表，违反唯一所有权。现已从 `appModel.createInitialState()` 取独立默认副本；模型默认突变会同时沿旧数据恢复和示例重置路径生效。
- 第二轮默认表修复先覆盖了 `modelDefaults.settings.ai` 引用，导致半份旧 AI 设置与自己合并，缺失字段未补回。原始独立红证据为 `tests/independent-partial-ai-restore-red.log`（exit 1）；修复后 `tests/independent-partial-ai-restore-green.log`（exit 0）恢复完整默认值并保留旧覆盖项。

原始红证据均保留。APK 首次核对时使用了错误的 Gradle intermediate 路径而产生的工具假红也保留为 `resource-chain-initial-wrong-intermediate-path.*`；修正路径后以及最终重建后均为 28/28。

## 最终验证

- `npm test`: **2674 通过、0 失败、exit 0** = unit 642 / native 324 / boot 552 / smoke 266 / regressions 730 / parse 160。原始输出：`tests/npm-test-final-authoritative.log`。
- 独立模型行为：10/10；启动合同：13/13；正式模型变异：events 共享、live 默认、空默认回退、series identity、rev=0 共 5/5 检出。
- UI 对照：567 项与 590 项均 PASS，反向对照有牙齿。
- 生产 Chrome：capture/edit/session/重复预览 PASS；导入矩阵 11/11 PASS，含 schema 2、真实历史 ISO 时间导入后新页面读回；views/content/setup/diagnostics 回归均无失败。最终 core 修改后重新跑了 capture 与 import。
- debug APK: `apk/p3a-app-debug.apk`，SHA-256 `81e7b45d2020969c4295e0ecdcc82559a71219e0677ff4b31b74c571bd7d88c3`；28/28 资源链 PASS，另有 Capacitor 生成的 `cordova.js` 与 `cordova_plugins.js` 两项不计入源码资源数。
- 语法检查、`git diff --check` 均 exit 0。

## 边界与下一步

- 未在 Android 真机安装本包，未验证真机旧状态恢复、原生迁移或提醒投影；这些不能由 Chrome/harness/APK 字节链替代。
- 未实测已安装 PWA 从 SW v23 离线升级到 v24。
- 未生成 release APK、未签名、未发布。
- P3-A 通过后，下一批应为 P3-B persistence；事务、事项动作与原生协调仍分别留给后续批次。
