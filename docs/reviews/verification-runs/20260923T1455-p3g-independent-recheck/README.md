# P3-G 独立复验：FAIL / FIX_REQUIRED

本轮仅复验实施方交付；未改动产品源码、旧候选或旧证据。仓库为 `/Users/qlyf/Developer/reminder`，HEAD 与 `origin/main` 均为 `3574824357dc7beb04cbd3e32aa413cd508e8484`。受验源码哈希：`app-core.js` 为 `f3e78157480326b4bdd39e087add6914fbeca693450995117e99b271821140dd`，`lib/app-alerts.js` 为 `497c573560ee0c4482b9c3162c2400871f890faa11da8b7b3434bd426391c10e`。候选 APK `releases/candidates/20260923T1405-p3g-candidate/app-debug.apk` 的 SHA-256 为 `dca49aee027e691eeda67d4e124018d913bed82508b3f44cfc4a5545bbd7c4eb`。

## 阻断反例

同一生产模块的独立复现脚本 `repro-alerts-gaps.js` 退出 1（预期变红），原始输出见 `repro-alerts-gaps.log`：

1. 重复调用 `bindAlertControls()`，同一个 `#alertClose` 节点装了 2 个 click 监听器，预期为 1。`lib/app-alerts.js:225-231` 每次都无条件注册；重复点击路径会重复显示关闭提示。P3-G 交接要求提醒监听单一所有者、重复启动不叠加，专项测试只绑定一次。
2. 注入拒绝的保存 Promise 后调用 `dismissAlert()`，返回 `true`，并显示“已关闭提醒 · 事项仍在首页”。`lib/app-alerts.js:175-189` 没有等待权威提交。该语义继承自拆分前，但仍与本批“保存失败不得报成功”验收条件冲突。内存变更保留的语义可以维持；成功提示必须与真实提交结果一致，并覆盖事务在途时的保存抑制分支，不能只机械地 `await save()`。

## 证据缺口

`scripts/verification/browser-alerts-check.py` 只打印 JSON 而不对布尔值执行断言或设置失败退出码；即使输出 `{error: ...}` 或 `ready: false`，脚本仍会退出 0。且其 `refreshSuccess` 只表示调用未抛错；在无原生桥时 `refreshActiveAlarmPanel()` 直接返回，不能证明活动原生闹钟面板的读、完成、失败重试路径。实施方报告“Chrome PASS”只适用于其输出的正向 DOM 观测。

实施报告写“27 项必需依赖”，实际 `REQUIRED_DEPS` 为 29 项，请更正文档。P3-G 专项测试留下真实 10 分钟自动收起计时器，断言输出后 Node 进程仍会等待计时器，拖慢 `npm test`；请在测试末尾清理实例计时器或用可控假计时器。

## 已独立核对

- `node --check lib/app-alerts.js`、`node --check app-core.js`、`git diff --check` 退出 0。
- `npm test` 独立总入口退出 0；有数字计数的六套为 642/324/890/266/730/160，合计 3012 项，失败 0。P3-G 专项断言和变异亦输出通过。原始输出及退出码见 `npm-test.log`、`npm-test.exit`。P3-G 专项断言输出后曾因未清理的真实 10 分钟计时器停留约 10 分钟，随后才执行余下套件。
- 组合启动 890、smoke 266、regressions 730、静态单一来源 160，单独重跑均退出 0；原始输出分别见 `boot.log`、`smoke.log`、`regressions.log`、`parse.log`。
- 真实 Chrome 正向弹条输出见 `browser-alerts.log`；Review Chrome 回归见 `browser-review.log`，均退出 0。UI DOM 590 项和格式 567 项比对退出 0，见对应日志。
- 独立只读遍历 34 项 Web 资源，源码、www、Android assets、Debug 中间层及候选 APK 逐字节一致，APK 内无额外 Web 资源。此结论是字节一致性，不是物理真机行为或真实离线升级 PASS。

两项阻断反例应先修复并各自证明由红转绿，再申请下一次独立复验。物理真机响铃和真实旧缓存跨版本离线升级均为 **NOT_PERFORMED**。
