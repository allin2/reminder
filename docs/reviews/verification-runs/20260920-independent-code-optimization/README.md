# 独立验收证据索引

- 被验收 run-id：`20260920T1706-code-optimization`
- 验收结论：`FAIL / FIX_REQUIRED`
- 验收日期：2026-09-20
- 仓库：`main` / `4de5f597573bc2c45b51ba8ab18a279d054339a0`
- 身份边界：按交付方 `source-hashes.txt` 校验工作区字节；全部匹配
- 隔离边界：Node 测试、独立探针和 localhost Chromium 页面均读取临时字节快照
- Android 边界：本机 SDK 的 adb 可执行，但没有已连接或已授权设备，状态为 `NOT_PERFORMED`

## 关键证据

- `identity-check.json`：交付哈希复核结果
- `snapshot-manifest.json`：158 个隔离文件的 SHA-256 清单
- `npm-test.log` / `npm-test-result.json`：1801 通过、0 失败
- `independent-probes.cjs` / `independent-probes.json`：持久化、对账和标签签名反例
- `perf-rerun.json` / `perf-rerun.log`：O2/O4/O5/O6/O7 计数复跑
- `browser-results.json`：Chromium 153 DOM、焦点、URL 和跨日结果
- `device-status.txt`：本轮 ADB 可见性边界
- `evidence-sha256.txt`：关键验收材料摘要

验收报告位于 `../../code-optimization-independent-acceptance-20260920.md`。
