# P3-H-R 实施自测报告：Service Worker 重复注册与监听器幂等缺口收口

> **实施方声明**：本文档为实施方自测交接记录，并非独立验收结论。全部自测结论均表述为“实施方自测通过”，最终结果由独立复验方独立断定。本轮工作严格聚焦于 P3-H 独立复验发现的 Service Worker 重复注册与 `updatefound` 监听器重复挂载缺口，不借机做 P4 离线升级验收或其他模块拆分。

---

## 1. 验收基线与现场核对

- **独立复验基线**：[`docs/reviews/verification-runs/20260923T1726-p3h-independent-recheck/README.md`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1726-p3h-independent-recheck/README.md)（结论：`PASS_WITH_LIMITATIONS`）。
- **Git 状态核对**：
  - HEAD 与 `origin/main` 保持一致：`3574824357dc7beb04cbd3e32aa413cd508e8484`。
  - 严格遵守纪律：未执行 `checkout`、`stash`、`reset`、`clean`、`commit` 或 `push`。
  - 工作区中所有既有修改、未跟踪文件及历史复验目录全部保留。
- **候选 APK 保护与新版本交付**：
  - 前序 P3-H 候选完全保留，未被覆盖：
    `releases/candidates/20260923T1719-p3h-candidate/app-debug.apk`
    SHA-256：`6fd03728a329f05e6a3676718779a161a0863ba6c76c99f2511072050c9fada0`
  - 本轮全新候选写入唯一隔离路径：
    `releases/candidates/20260923T1745-p3hr-candidate/app-debug.apk`
    SHA-256：`dc1f21fe1578f4a8e8cc49eb0d4ed5a1e68fa4a1a521d2e19df667fc3e859554`

---

## 2. 缺口定位与修复实施

### 2.1 缺口根因
在 P3-H 原实现中，`pwaRegistered` 仅用于守卫 `sw.addEventListener("message")` 与 `sw.addEventListener("controllerchange")`。当外部多次调用 `registerPwa()`（如启动失败后重试、或者并发在途调用）时：
1. `sw.register("sw.js")` 被多次发起；
2. 每次 Promise 兑现都会向同一个 registration 对象重复添加 `updatefound` 监听器；
3. 未处理在途 Promise 兑现期间发生 `unbindAll()` 的时序竞争，导致解绑后旧回调仍可能将 registration 和监听器挂回实例。

### 2.2 实施方案（`lib/app-platform.js`）
1. **在途排他与成功缓存守卫**：
   - 增加 `swRegistering` 布尔标记。当注册进行中再次调用 `registerPwa()` 时，立即返回，防止并发调用重复触发 `sw.register()`。
   - 增加 `swRegistration` 判定。当注册已成功后再次调用 `registerPwa()` 时，仅刷新状态并直接返回，不再重复调用 `sw.register()`。
2. **`updatefound` 监听器单次绑定**：
   - 增加 `updateFoundHandler` 状态变量，在 registration 上通过 `if (reg && !updateFoundHandler)` 保证只挂载一次更新监听。
3. **注册失败允许重试（无永久死锁）**：
   - 在 `catch` 路径中清理 `swRegistering = false` 与 `swRegistration = null`，保证注册失败后后续显式重试可以重新拉起注册。
4. **解绑世代纪元（Epoch）隔离**：
   - 增加 `swEpoch` 计数器，并在 `unbindAll()` 时自增。
   - `sw.register().then(...)` 与 `catch(...)` 执行前检查 `if (currentEpoch !== swEpoch) return;`。若在 Promise 在途期间触发了 `unbindAll()`，迟到的兑现回调将直接丢弃，不赋值 `swRegistration`，不挂载监听器，不触发外部状态刷新。
   - `unbindAll()` 同时主动解绑 `swRegistration` 上的 `updatefound` 监听。
5. **缓存版本号递增（`sw.js`）**：
   - 因 Web 模块 `lib/app-platform.js` 发生代码变更，按既有约定推进 `CACHE = "attention-inbox-v36"`，建立新版本预缓存边界。
6. **`app-core.js` 零字节变化**：
   - 经核验，装配层接口与契约无任何变化，`app-core.js` 保持 **0 字节修改**（SHA-256：`12e841dcb401f584f17d3b0abf21d534315e0a6f89f515e172f38bdfe0c61e9e`）。

---

## 3. 探针对比与成功条件达成

### 3.1 幂等探针（`probe-pwa-idempotency.js`）
- **修复前（独立复验报告记录）**：
  ```json
  {"register":2,"updatefound":2,"message":1,"controllerchange":1}
  ```
- **修复后（本轮实测）**：
  ```json
  {"register":1,"updatefound":1,"message":1,"controllerchange":1}
  ```
  **退出码**：`0`（通过严格断言 `counts.register === 1 && counts.updatefound === 1`）。

### 3.2 失败重试与消息转发探针（`probe-pwa-rejection.js`）
- **实测结果**：
  ```json
  {"renders":1,"registration":null,"actions":1}
  ```
  **退出码**：`0`。注册拒绝时不阻断通知动作派发，且不产生虚假 registration。

---

## 4. 变异测试与反例分析（拔掉修复即变红）

在 [`scripts/verification/p3h-platform-tests.js`](file:///Users/qlyf/Developer/reminder/scripts/verification/p3h-platform-tests.js) 中增补了 P3-H-R 专属的用例与变异，全套 8 项变异全部变红捕获：

1. **变异 1**：`mutant1_listenerDoubling` — 移除 `bindNetwork`/`bindInstall` 幂等保护，变红捕获。
2. **变异 2**：`mutant2_notificationActionBypassed` — 注释掉通知动作转发，变红捕获。
3. **变异 3**：`mutant3_nativeAndroidWithoutCapacitor` — 无 Capacitor 时误判为 Android，变红捕获。
4. **变异 4**：`mutant4_lateBridgePollingBroken` — 桥晚到轮询被篡改为立即失败，变红捕获。
5. **变异 5**：`mutant5_deferredPromptNotClearedOnAppInstalled` — `appinstalled` 未清空 prompt，变红捕获。
6. **变异 6（P3-H-R 新增）**：`mutant6_swDuplicateRegistrationNotPrevented` — 移除 `swRegistration` 与 `swRegistering` 重复调用守卫，测试断言 `sw.register called exactly once` 立即变红捕获。
7. **变异 7（P3-H-R 新增）**：`mutant7_swFailurePermanentLockout` — 失败后不重置 `swRegistering` 造成重试永久锁死，测试断言 `retryPlatform.getSwRegistration() === secondReg` 立即变红捕获。
8. **变异 8（P3-H-R 新增）**：`mutant8_swLateResolutionEpochIgnored` — 移除迟到兑现的 `currentEpoch` 检查，测试断言解绑后 `latePlatform.getSwRegistration() === null` 立即变红捕获。

变异执行日志见 [`p3h-platform-tests.log`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1745-p3hr-delivery/p3h-platform-tests.log)，退出码 `0`。

---

## 5. 真实 Chrome 浏览器与 Service Worker 实机测试

修复了前序 `browser-platform-check.py` 阻止 `sw.js`（返回 404）的缺陷，更新后的脚本在独立临时 Chrome profile 下真实启动 HTTP 服务器提供 `sw.js`，运行结果如下：
```json
{
  "ready": true,
  "hasPlatform": true,
  "hasAllContract": true,
  "contractLength": 9,
  "isNative": false,
  "sysBridgeIsNull": true,
  "appSettingsIsNull": true,
  "swRegistered": true,
  "platformRegMatches": true,
  "swActive": true,
  "cacheNames": ["attention-inbox-v36"],
  "hasV36Cache": true,
  "platformCached": true,
  "repeatPreservesReg": true,
  "initialBtnHidden": true,
  "promptPrevented": true,
  "btnVisibleAfterPrompt": true,
  "deferredPromptSaved": true,
  "btnHiddenAfterInstalled": true,
  "deferredPromptCleared": true
}
```
**断言项说明**：
- `swRegistered`: `navigator.serviceWorker.getRegistration()` 成功返回；
- `platformRegMatches`: `platform.getSwRegistration()` 与浏览器原生 registration 严格同一对象；
- `swActive`: Service Worker 成功激活；
- `hasV36Cache`: `caches.keys()` 中包含 `attention-inbox-v36`；
- `platformCached`: `./lib/app-platform.js` 真实命中缓存；
- `repeatPreservesReg`: 浏览器中再次重复调用 `registerPwa()` 两次，实例保持幂等；
- 安装提示与网络/可见性断言全部成立。
日志见 [`browser-platform-check.log`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1745-p3hr-delivery/browser-platform-check.log)，退出码 `0`。

---

## 6. 全量自动化测试套件（`npm test`）

- `test-unit.js`: PASS
- `test-native-reminders.js`: PASS
- `p3a-model-tests.js` ~ `p3h-platform-tests.js`: 全部 8 支专项与变异测试 PASS
- `test-boot-combination.js`: 通过 917 项，失败 0 项（增补了纯 Web 下 `registerPwa()` 连续重复调用幂等稳定性断言）
- `test-smoke.js`: 通过 266 项，失败 0 项
- `test-regressions.js`: 通过 730 项，失败 0 项
- `scripts/verification/parse-single-source.js`: 通过 160 项，失败 0 项

日志见 [`npm-test.log`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1745-p3hr-delivery/npm-test.log)，退出码 `0`。

---

## 7. 5 层全量资源哈希闭合矩阵（35 个 Web 资源）

经脚本逐字节比对，全部 35 个 Web 资源在 Source、`www`、Android assets、Debug Intermediate 与 Candidate APK 五层完全一致（100% MATCH，0 mismatches）。完整清单记录于 [`resource-closure.json`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1745-p3hr-delivery/resource-closure.json)。

核心变更文件哈希表：
| 文件路径 | 变更说明 | SHA-256 |
| :--- | :--- | :--- |
| `lib/app-platform.js` | SW 幂等与迟到兑现修复 | `10a2118c85ff9383ddaaffc494a4f949d001246d4ddab38b2e4c087346252cc5` |
| `sw.js` | 缓存名推进至 v36 | `1135264eccca2a0a36376616c74ca2d7367e1f3467c4eb2d3cdf540ab39f880a` |
| `app-core.js` | **0 字节改动** | `12e841dcb401f584f17d3b0abf21d534315e0a6f89f515e172f38bdfe0c61e9e` |
| `test-boot-combination.js` | 增补重复注册稳定性断言 | `7e8a3de2ecefaf66c5fc6b1e556517db4ed07a8a40951bcd4a1bc5e274dc004c` |
| `scripts/verification/p3h-platform-tests.js` | 增补 M6/M7/M8 变异与断言 | `2d5e1a018c8cae75dae357c6c4a266438189bf8d29631e69d04020102555bf9b` |
| `scripts/verification/browser-platform-check.py` | 引入真实 SW 注册与 v36 激活 | `8f0a41fbb2cf47544c8801ef03cd7c8bec8db4fdee3e142edc1174bce99c73e5` |
| `releases/candidates/20260923T1745-p3hr-candidate/app-debug.apk` | 本轮全新候选安装包 | `dc1f21fe1578f4a8e8cc49eb0d4ed5a1e68fa4a1a521d2e19df667fc3e859554` |
| `releases/candidates/20260923T1719-p3h-candidate/app-debug.apk` | 前序候选（原样保护） | `6fd03728a329f05e6a3676718779a161a0863ba6c76c99f2511072050c9fada0` |

---

## 8. 物理真机（vivo V2238A）实测

- **安装与指纹**：候选 APK 安装至设备，安装后 `base.apk` SHA-256 逐字匹配 `dc1f21fe1578f4a8e8cc49eb0d4ed5a1e68fa4a1a521d2e19df667fc3e859554`。
- **正常启动与冷启动双断言**：
  - 正常热启与 `am force-stop` 后冷启两次均通过 CDP 检查；
  - `ready: true`, `hasPlatform: true`, `hasAllContract: true`, `contractLength: 9`, `isNative: true`, `hasSysBridge: true`, `hasAppSettings: true`, `waitResult: true`, `deferredPromptIsNull: true`, `btnInstallHidden: true`。
  - 日志见 [`device-verify.log`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1745-p3hr-delivery/device-verify.log) 与 [`device-cold.log`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1745-p3hr-delivery/device-cold.log)，退出码均为 `0`。

---

## 9. 限制说明与未执行项（NOT_PERFORMED）

1. **多版本 Service Worker 真实离线切换与就地升级**：
   - **状态**：`NOT_PERFORMED`
   - **理由**：真实客户端在完全脱网环境下的旧版本缓存迁移与离线就地升级演练属于 P4 范围，本轮严格遵循 P3-H-R 边界，不跨批次宣称完成。
2. **物理闹钟声振投递与物理通知栏交互**：
   - **状态**：`NOT_PERFORMED`
   - **理由**：平台层验证断言了 `SystemBridge` 原生桥对象与 `isNativeAndroidRuntime()` 的就绪；桥对象存在不代表物理闹钟投递 PASS，本轮不越界宣称闹钟物理投递完成。
3. **自然手指在弹条遮挡下的活动闹钟点击盲操**：
   - **状态**：`NOT_PERFORMED`
   - **理由**：属于 P3-G-R 已记录的物理视口局限性，本轮平台层修复不涉及 UI 布局调整。

---

## 10. 结论

- **实施方自测结论**：**实施方自测通过**
- **当前状态**：所有修改、测试与证据均已就绪并归档，严格停在当前任务边界，等待独立复验方进行独立复验。
