# P3-A app-model 实施 run

日期：2026-09-22。工作区 `main`，开工 HEAD `3574824357dc7beb04cbd3e32aa413cd508e8484`；P2-G2 交接身份为 `app-core.js` sha256 `5dd1f515ab7b0202eacfde7543e0ae1111a285ede92435660d4d55da47ec6fab`、`lib/app-capture.js` sha256 `cbf3285f427c8aec7394b8305255a545e84c4ec8152faf0d1d8c6ce35da57a4b`、SW v23。

本轮新增 `lib/app-model.js`，由 app-core 在装配闸门通过后创建同一实例并创建初始 state；normalizeItem、makeItem、投递方式、rev、terminal、schema 和项目颜色不再在 core 保留第二份实现。native migrate 通过 live 依赖调用，每个归一事项恰一次。

P3-A 独立复验补丁：旧快照的 `settings.ai` 允许只存一部分字段。`applyParsedState` 在顶层合并覆盖该字段前保留 app-model 产生的 AI 默认对象，再用旧字段覆盖；因此部分旧值保留，`baseUrl`、`apiKey`、`model`、`autoOnSave` 等缺项继续来自唯一的 app-model 默认来源。`production-scripts.js` 新增 `modelInstanceCoverage()`，`test-boot-combination.js` 覆盖模型实例合同的正向双空、删合同成员（missing）和删真实转发（unused）反例；其中部分 AI 旧设置在模型默认 `model` 变异后仍会补得该变异值。

验证结果：

- `node docs/reviews/verification-runs/20260922T215022-p3a-independent-recheck/tests/independent-partial-ai-restore.js`：先前失败的独立部分 AI 恢复 probe 现为 PASS，日志见 `partial-ai-restore.log`。
- `node scripts/verification/p3a-model-tests.js`：直接行为 PASS；events 共享、live 默认投递、空默认回退、series identity、rev=0 五条真实源码变异均被同一行为断言检出。
- `npm test`：通过，原始日志见 `npm-test.log`。
- `node test-boot-combination.js`：通过 552、失败 0；完整生产脚本组合和装配闸门通过，含 P3-A 缺脚本、空命名空间、工厂抛错、全部实例成员缺失、模型实例合同双向闭合、模型默认突变沿旧数据恢复、部分 AI 旧设置补全及示例重置路径反例，日志见 `production-combination.log`。
- `node scripts/verification/parse-single-source.js`：通过 160、失败 0，日志见 `production-scripts.log`。
- Chrome 生产页 `browser-capture-check.py`：ready、capture/edit/session/重复预览均通过；本轮输出为临时 `/tmp/p3a-browser-final`。

当前源文件哈希见 `source-sha256.txt`。本轮仅 app-core/model 与验证代码变化，SW 保持 v24，属于同一未发布批次，未另升缓存版本。APK 28/28 隔离自测：`NOT_PERFORMED`。当前 release intermediates 资源台账见 `apk-assets-current-build.txt`；现存 APK 是历史候选，未安装、未覆盖、未冒充本轮 P3-A 产物或真机证据。

实施自测不构成独立验收 PASS；独立方仍需重跑旧 schema 归一/重载、live 默认投递、四条变异和隔离 APK 资源链。
