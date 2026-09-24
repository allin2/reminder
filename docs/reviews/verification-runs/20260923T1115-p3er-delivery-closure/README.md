# P3-E-R 交付收口报告（实施方自测交接文档）

## 1. 任务身份与工作区约束

- **仓库路径**：`/Users/qlyf/Developer/reminder`
- **身份定位**：P3-E-R 实施方自测报告（非独立验收方；不自称整体 PASS；本报告为实施自测与交付收口凭据，交由独立验收方复核）。
- **Git HEAD**：`3574824357dc7beb04cbd3e32aa413cd508e8484`（分支 `main`，对应 `origin/main`）。
- **工作区保护与零重构原则**：
  - 严格未执行任何破坏性 git 操作（无 `checkout`、`reset`、`stash`、`clean`、`commit`、`push`）；
  - 既有脏工作区、历史证据目录与既有候选完整保留，未覆盖、未清理；
  - 本轮严格零重构已通过独立复验的业务源码，未开展下一批模块拆分，未并入 P4 完整离线升级；
  - `app-core.js` 与 `lib/app-native-coordinator.js` **零字节改动**，保持独立复验通过时的原始字节。

---

## 2. 交付缺口处理说明与代码变更

上一轮独立复验（`docs/reviews/verification-runs/20260923T1104-p3er-independent-recheck/README.md`）确认两项源码行为已通过（PASS），但交付评定为 `FIX_REQUIRED`，本轮针对所列两个缺口进行最小闭环处理：

### 2.1 缺口 1：Service Worker 缓存名推进至 `v30`
- **原因**：`app-core.js` 与 `lib/app-native-coordinator.js` 运行时内容在 P3-E-R 中已变更，但 `sw.js` 仍使用 `attention-inbox-v29`。按本仓 Service Worker 契约，预缓存条目按 URL 索引，必须更新缓存名以确保已安装 PWA 用户能拉取到新脚本。
- **改动**：
  - 文件：[`sw.js`](file:///Users/qlyf/Developer/reminder/sw.js)
  - 推进缓存版本：`const CACHE = "attention-inbox-v30";`
  - 增补头部版本说明注释：`// v30：P3-E-R 修复全屏闹钟动作排空直达事务处理器与版本漂移补偿重跑；更新运行时脚本缓存。`
  - 保持 `ASSETS` 清单中的 `./lib/app-native-coordinator.js` 及缓存抓取逻辑完全不变。

### 2.2 缺口 2：候选包身份隔离与全新唯一候选创建
- **原因**：在上一轮 `20260923T1055-p3e-repair` 过程中，直接向 `releases/candidates/20260923T1000-p3e-candidate/app-debug.apk` 覆盖写入了修复包，导致该路径原有的 `ebc57bb6...` 候选身份被覆盖重绑。
- **改动**：
  - 绝不向 `releases/candidates/` 下任何既有文件覆盖写入；
  - 也不将 `0958` 原始包拷回 `1000` 路径（避免二次改变路径身份）；
  - 创建全新、唯一的候选目录：[`releases/candidates/20260923T1115-p3er-candidate/`](file:///Users/qlyf/Developer/reminder/releases/candidates/20260923T1115-p3er-candidate/)；
  - 完成同步与 Gradle 构建后，将本轮新生成的 Debug APK 复制至该唯一路径并冻结：
    `releases/candidates/20260923T1115-p3er-candidate/app-debug.apk`。

---

## 3. 历史证据纠错与时间线说明

针对此前 `docs/reviews/verification-runs/20260923T1055-p3e-repair/README.md` 中的记录偏差，在此做正式纠错说明：

### 3.1 候选包路径与实测哈希时间线
1. **0958 原始包**：
   - 路径：`releases/candidates/20260923T0958-p3e-candidate/app-debug.apk`
   - 实测 SHA-256：`ebc57bb6c8423334cd9f8b717130433ee6edcc8d0ac2ab80aa766a5e7c53754f`
   - 状态：从最初生成至今保持完整未动，是未经两项修复的原始 P3-E 构建产物。
2. **1000 路径候选（曾被覆盖）**：
   - 路径：`releases/candidates/20260923T1000-p3e-candidate/app-debug.apk`
   - 原始报告记录哈希：`ebc57bb6c8423334cd9f8b717130433ee6edcc8d0ac2ab80aa766a5e7c53754f`（见 `20260923T1000-p3e-app-native-coordinator/debug-apk-sha256.txt`）；
   - 当前现场实测哈希：`96a2a0a41e8ba55652297fd94d6f9b2560e8801e1ff4d4b38b6979b6698d8300`；
   - 纠错说明：该路径在 `1055-p3e-repair` 过程中被当时的修复包覆盖，因此**该路径已不再代表未改变的原始候选**。此前 `1055-p3e-repair/README.md` 中所称“旧候选均被保留”对 1000 路径不成立。本轮保留现场实测字节，不进行回拷伪造，以全新候选交付。
3. **本轮新候选（v30 完整交付包）**：
   - 路径：`releases/candidates/20260923T1115-p3er-candidate/app-debug.apk`
   - 实测 SHA-256：`5624f9a851b0364a1ccb2512a90e4cfdaaa90077fc18212fbddbf854e258a267`
   - 构建产物对齐：与 `android/app/build/outputs/apk/debug/app-debug.apk` 逐字节一致（SHA-256 完全相同）。

### 3.2 修复前源码基线哈希纠错
此前 `20260923T1055-p3e-repair/README.md` 表格中所列“独立复验前基线 SHA-256”误采纳了更早的历史基线。经核对原始归档 `docs/reviews/verification-runs/20260923T1014-p3e-independent-recheck/source-hashes.txt`，真实修复前源码哈希纠正如下：
- **修复前 `app-core.js`**：
  - 误写值：`4ee18ef557008ff77ea8c38a391515bbcf684ea68b693dc83296c050bc698ebc`
  - **真实值**：`fe9d446caf64a95c86e437122aca760c1c1cbfab08753f2d87f0352f88f9c471`
- **修复前 `lib/app-native-coordinator.js`**：
  - 误写值：`a65cf2338ae0cf8f2b38992e5917fe283e742ca716b14620f4c0c16921312ea9`
  - **真实值**：`51d99e649ba1e9407d45e0b09b74458d2bd57476e61183c6b219c48f7c3f361d`

---

## 4. 源码与产物实测哈希全览

| 目标文件 | 实测 SHA-256 | 本轮变更状态 |
| --- | --- | --- |
| `app-core.js` | `664cc69fb5e5cd246e680e1f7548ad572c7717c1019c009bc11049cb0bb15989` | **零字节修改**（继承 1104 复验通过状态） |
| `lib/app-native-coordinator.js` | `6d91d0047ef321651689dad7a5c3c98e660d48b1dc64c8f64bbf69963585f361` | **零字节修改**（继承 1104 复验通过状态） |
| `sw.js` | `e9631d76ae46713d4a8f03827422616930fec5ec822471884e82467217140870` | **推进至 attention-inbox-v30** |
| `index.html` | `a0193f9291f315bf06670e6b088f87b71e949163bcc65468d0567789680658c5` | 零修改 |
| `lib/app-items.js` | `e807599395caa4f0a69e13ab957a43bd6d377d5dbab682c32c121c4a7a4be519` | 零修改 |
| `lib/app-transaction.js` | `e6df807a8330c618ce5d9e4b7a4087bfe7f07fbab1b32a8693a49908b71dea48` | 零修改 |
| `lib/app-persistence.js` | `d31a3112044af28c5efe14f770ccec99e9a5a3ce18172d81d79376ce3d6aab50` | 零修改 |
| `lib/app-model.js` | `0219c576a82d4df6fefe4dca62561c491f1b36c97d59de426afff7ccad41f94e` | 零修改 |
| `lib/native-reminders.js` | `723f218c68866309f364e1e71968eb3efc6ae8b9b85aea7e211c878bee6e031b` | 零修改 |
| `test-boot-combination.js` | `00a7410df9845bf8368a1e2cb62d341d51ab02efae7d36a184bcd45315b67ba3` | 零修改 |
| `releases/candidates/20260923T0958-p3e-candidate/app-debug.apk` | `ebc57bb6c8423334cd9f8b717130433ee6edcc8d0ac2ab80aa766a5e7c53754f` | 原始未修复包（保留现状） |
| `releases/candidates/20260923T1000-p3e-candidate/app-debug.apk` | `96a2a0a41e8ba55652297fd94d6f9b2560e8801e1ff4d4b38b6979b6698d8300` | 历史被覆盖包（保留现状） |
| `releases/candidates/20260923T1115-p3er-candidate/app-debug.apk` | `5624f9a851b0364a1ccb2512a90e4cfdaaa90077fc18212fbddbf854e258a267` | **本次唯一新交付候选** |
| `android/app/build/outputs/apk/debug/app-debug.apk` | `5624f9a851b0364a1ccb2512a90e4cfdaaa90077fc18212fbddbf854e258a267` | 本地构建输出（与新候选逐字节一致） |

---

## 5. 32 项五层 Web 资源哈希核对摘要

对新候选包执行五层核验（源码 `root/`、同步 `www/`、Android 资产 `android-assets/`、构建中间层 `intermediate/`、以及 APK 内条目 `apk: assets/public/`）：
- 检查文件数：**32** 项（排除了 cordova.js / cordova_plugins.js）；
- 差异数（mismatch）：**0**；
- 缺项（missing）：**0**；
- 包含更新后的 `sw.js`（SHA-256 `e9631d76...`）与 `lib/app-native-coordinator.js`（SHA-256 `6d91d004...`）；
- 详细逐文件清单见同目录 [`resource-hashes.tsv`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1115-p3er-delivery-closure/resource-hashes.tsv)。

---

## 6. 验证命令执行与结果汇总

| 验证项 | 执行命令 | 退出码 | 结果与摘要 |
| --- | --- | --- | --- |
| Git 差异检查 | `git diff --check` | 0 | 无空白符错误或格式异常 |
| SW 语法检查 | `node --check sw.js` | 0 | 语法通过 |
| 协调器独立单元与变异 | `node scripts/verification/p3e-coordinator-tests.js` | 0 | 11 组反向变异全部检出 |
| 历史两条反例复跑 | `node scripts/verification/replay-counterexamples.js` | 0 | 两条反例持续稳定全绿 |
| 生产组合组合测试 | `node test-boot-combination.js` | 0 | 782 / 782 全部通过，0 失败 |
| 仓库全量单元测试 | `npm test` | 0 | 160 / 160 全部通过，0 失败 |
| DOM 搬移前后一致性 | `node scripts/verification/ui-dom-parity.js` | 0 | 16 场景 590 字段完全一致 |
| UI 格式化一致性 | `node scripts/verification/ui-format-parity.js` | 0 | 567 项逐项一致 |
| 浏览器启动恢复测试 | `python3 scripts/verification/browser-recovery-check.py` | 0 | 12 个真实浏览器场景无副作用通过 |
| 浏览器整库导入安全 | `python3 scripts/verification/browser-import-format-check.py` | 0 | 11 个整库导入场景全部通过 |
| 五层 32 项资源比对 | Python 脚本五层遍历 | 0 | 32 项资源哈希完全一致，0 mismatch |
| Capacitor 同步 | `npm run cap:sync` | 0 | 33 项资源无损同步完成 |
| Android Gradle 调试构建 | `cd android && ./gradlew assembleDebug` | 0 | BUILD SUCCESSFUL |

---

## 7. 分层结论

1. **两项源码修复（INHERITED_EVIDENCE）**：
   - 全屏闹钟动作直达事务处理器并保留 `alarmEventId`（`handleAlarmAction` 必需依赖）；
   - 版本漂移后必须重跑对账补偿排程；
   - 引用独立复验报告 `docs/reviews/verification-runs/20260923T1104-p3er-independent-recheck/README.md` 的独立结论（**PASS**）。
   - 本轮 `app-core.js` 与 `lib/app-native-coordinator.js` **零字节修改**，哈希保持一致，完整继承该独立结论。
2. **交付收口项（实施方自测通过）**：
   - `sw.js` 缓存名推进为 `attention-inbox-v30`，经静态语法、回归测试与浏览器测试检验通过；
   - 历史被覆盖候选与哈希记录完成正式时间线纠错；
   - 全新唯一候选 APK 路径 `releases/candidates/20260923T1115-p3er-candidate/app-debug.apk` 完成构建与冻结，经五层 32 项资源一致性核验无任何差异。
3. **未执行范围（NOT_PERFORMED）**：
   - 真实真机原生通知/闹钟物理送达与弹窗交互；
   - 真实浏览器离线环境下 Service Worker 从旧缓存版本（v28 / v29）向新缓存版本（v30）的就地升级测试；
   - 上述两项均未执行，明确标记为 **NOT_PERFORMED**，留待后续独立验收阶段及 P4 离线升级专项验证，不以桌面模拟或 APK 比对替代。

---

## 8. 交接物清单

本轮收口证据与日志保存于：
[`docs/reviews/verification-runs/20260923T1115-p3er-delivery-closure/`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1115-p3er-delivery-closure/)

交付新候选 APK：
[`releases/candidates/20260923T1115-p3er-candidate/app-debug.apk`](file:///Users/qlyf/Developer/reminder/releases/candidates/20260923T1115-p3er-candidate/app-debug.apk)
（SHA-256：`5624f9a851b0364a1ccb2512a90e4cfdaaa90077fc18212fbddbf854e258a267`）

交付实施完成，停止后续操作，等待独立验收方复核。
