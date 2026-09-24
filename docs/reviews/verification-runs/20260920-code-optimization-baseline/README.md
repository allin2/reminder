# 2026-09-20 代码优化审查历史基线

此目录由原只读审查 Agent 在生成实现交接时建立。产品源码未被本次交接改动。

- [修复任务书](../../../handoff/2026-09-20-code-optimization-repair-plan.md)
- [原始 npm test 日志](./npm-test.log)：330 unit + 321 native + 244 smoke + 730 regressions = 1625，0 失败。
- [原始探针输出](./probe-results.json)：含观察结果、Node v20.17.0 和相关源码 SHA-256。
- [原始探针](./original-probe.cjs)：从临时目录原样归档，保留历史绝对路径；不要直接重跑覆盖输出。
- [可移植探针](./probe.cjs)：仅将仓库根定位改为参数/相对路径，并移除自动写文件；输出到 stdout。
- [交接元数据](./handoff-metadata.json)：归档文件哈希、交接时源码哈希及与旧探针相比变化的文件。

## 证据边界

探针复用回归 harness，在内存中增加只读计数/访问钩子，使用 mock DOM、mock IDB 和 mock 原生桥。没有编辑产品源码，没有操作真实用户数据或设备。`deferOption.passed: true` 表示调用时**传入了选项**，不是测试通过；`extraSyncRequests: 1` 才是该缺陷的观察结果。

`elapsedMs` 含探针计数开销，且只是单次测量，不是可靠基准；比较次数和卡片生成数可用于确认算法/渲染路径。HTML 字节数不是 DOM/堆内存。

原始测试与探针来自上轮审查。交接时 app-core.js 和 test-smoke.js 已变化，不能把旧测试结果当作当前状态。没有冻结完整历史 dirty 源码；哈希用于识别，不能据此恢复旧版本。

## 重跑

从任意目录执行，默认仓库根按此目录推导，也可显式传入目标 checkout：

```sh
node /Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260920-code-optimization-baseline/probe.cjs /Users/qlyf/Developer/reminder
```

结果只输出到终端。需要保存时选用新的证据 run-id，不重定向到本目录的旧结果。

此探针依赖当时私有函数名与 harness 结构，后续修复可能使它不再适用。若入口改名/重构，应把观察意图迁移为真实入口行为测试，并保留原始输出；不能为满足字符串替换而倒退实现，也不能把探针失效当作行为 PASS。
