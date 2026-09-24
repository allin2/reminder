# P2-G1 `app-capture.js` 独立复验

判定：**PASS（开发机源码、生产 Chrome、debug APK 资源身份）**。Android 真机表单操作、离线 SW v21→v22 升级和正式发布均 **NOT_PERFORMED**。

## 身份与范围

- 仓库 `/Users/qlyf/Developer/reminder`；`main`、HEAD、`origin/main` 均为 `3574824357dc7beb04cbd3e32aa413cd508e8484`。保留 159 条既有脏/未跟踪记录；未 checkout、stash、reset、clean、提交或推送。
- 最终产品 SHA-256：`app-core.js` `1b10e4b23a6ecd04a03beda8e268fbe55f47235c260120f95d826f5791cdc763`；`lib/app-capture.js` `a2336044fb2fda30248a7ae4fb373eb87c37406e1d0962d43317fe4a99483fb1`；`lib/app-views.js` 仍为 `2ef2c72b6319feb3414fd07914804296d4f9fa7888a834b3d95f1a98b2fafa37`；`index.html` `2a1de8f70de8ecf9010432e5dcda67f47a6712438b8519263031712ac41490b7`；`sw.js` `7a3c2eab774d222f23b6858aa4f314a66fd08778162c8ab8226501bb2baa0f72`（v22）。完整清单见 `final/source-hashes-end.txt`。
- G1 仅验收表单展示、会话身份、快照/签名、编辑填充、相似提示、重复预览和输入绑定。提交去重、低置信度续跑、事务和权威保存仍在 core，留给 G2；没有把 G1 写成整个 P2-G 完成。

## 独立结果

- `npm test` exit 0：unit **642**、native **324**、boot **506**、smoke **266**、regressions **730**、parse **160**，合计 **2628/0**；原始日志 `final/npm-test.log`。语法检查及 `git diff --check` 均通过。
- 唯一所有权成立：`itemFormSession`、`triggerUserPicked` 及 12 个表单实现体只存在于 `lib/app-capture.js`；core 对现有调用面只做实例转发。模块求值无 DOM/state/timer 副作用，`bind()` 有实例内幂等闸门，状态与低置信度选择通过 live getter 读取。
- 正式 boot 逐项反例：缺脚本、空命名空间、空壳、工厂抛错、15 个实例成员逐一缺失，均 `ready=false`、只点名 AppCapture、IDB put/原生排程/2 秒与 15 秒业务心跳为零。R-F03 正式回归覆盖 AI 迟到期间继续输入、失败回退、关闭重开同内容、两次并行提交，全部通过。
- 独立 Chrome `browser/independent-capture-ui.json`：真实 FAB 打开、相似提示危险 id/title 转义、更多选项、周期预览、关闭重开换会话、编辑填充均通过且无页面异常。views/content/setup/diagnostics 回归全绿，import-format **11/11 PASS**。
- 独立源码变异 `mutations/capture-contract-probe.json`：摘会话递增后重开身份断言变红；摘手选时间签名后不同草稿被判相同；摘 bind 幂等后监听由 3/2/1 翻倍为 6/4/2。健康对照全绿，产品哈希前后不变。
- 隔离构建前保留 P2-F2 APK（SHA-256 `ad14f9593b60d6aef2ad43246991141224c52398597662ca1179897e8b8d3bb3`）。`cap:sync` 与 `:app:assembleDebug` 成功；本轮 APK `apk/p2g1-app-debug.apk` SHA-256 `dfd0eb8bf65b4963fe64406ff3fed1153a0725bfad9412cf0fc22674f32098a0`。`apk/resource-chain.json` 的 **27/27** Web 资源在源码、`www`、Android assets、APK 内逐字节一致，missing/mismatch 为空。

## 边界

未执行 Android 真机 capture/save、离线缓存升级、正式签名包、发布或生产数据操作。G2 需独立迁移并复验提交身份、低置信度选择、失败保草稿和保存时序；P2-G 只有 G1 与 G2 均通过才可收口。
