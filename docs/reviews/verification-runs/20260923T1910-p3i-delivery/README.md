# P3-I 实施交付自测报告 (AppActionFeedback, AppEvents & AppTestApi 迁出与 app-core 收敛)

**实施方声明**：本项目由 P3-I 实施方完成开发、自测与交付，署名统一为「实施方自测」，非独立验收方；交付后立即停止操作，等待独立复验方进行独立复验。

---

## 一、基线与现场核对

### 1. 开工基线现场
- 分支与提交：`HEAD` = `origin/main` = `3574824357dc7beb04cbd3e32aa413cd508e8484`；
- 开工前 `app-core.js`：4,567 行、221,444 字节，SHA-256 为 `12e841dcb401f584f17d3b0abf21d534315e0a6f89f515e172f38bdfe0c61e9e`；
- SW 缓存版本：由 `v37` 递增至 `v38`（纳入三个新增拆分脚本）。

### 2. 交付物与源码指标
- 交付候选 APK：`releases/candidates/20260923T1910-p3i-candidate/app-debug.apk`
- 候选 APK SHA-256：`c949ad2861bd47680a29384d4f4bdc8a69a594473a366936a9eb239ca8bac7a3`
- 交付时 `app-core.js`：3,971 行、195,751 字节，SHA-256 为 `2eaadab743af723e492d6d770f68d2b2edb45bf1f0636e67e991822cd9d19758`；
- 新增独立模块：
  1. `lib/app-action-feedback.js`：412 行、16,334 字节，SHA-256 为 `82136e69623e165842880b9195b05fe8050e8b159f8a37943d0e980327f12361`；
  2. `lib/app-events.js`：879 行、33,479 字节，SHA-256 为 `c1bbcc3514a60b9687e1704e6c99446df6db9213192aa734d5885fbf803b0c25`；
  3. `lib/app-test-api.js`：401 行、25,233 字节，SHA-256 为 `877e84e55fe9dc3f1406859e0a0d9275bf1cc19d45e0f7fe91b5c46d3284000a`；
- 现场保护纪律：严格遵守零破坏性 git 操作原则，未执行 `checkout`、`stash`、`reset`、`clean`、`commit`、`push`；历史候选 APK 及既有工作区脏条目完整保留。

---

## 二、实施与迁出明细

### 1. `lib/app-action-feedback.js` (保存与排程反馈控制器)
- **职责范围**：保存反馈两阶段结算（保存成功即时 Toast、排程证据异步回流与更新）、原生/事项排程快照比对、排程结论生成（`feedbackVerdictFor`）以及回执队列管理；
- **导出规格**：标准 UMD 挂载于 `AttentionLib.AppActionFeedback.createAppActionFeedback(deps)`；
- **契约方法**：`announceSaveOutcome`、`settleSaveFeedback`、`itemScheduleEvidence`、`feedbackNativeSnapshot`、`feedbackItemSnapshot`、`feedbackVerdictFor`、`runFeedbackAction`（7项完整契约）；
- **纯度与守卫**：模块求值零副作用，依赖缺失即时抛错（fail closed）。

### 2. `lib/app-events.js` (DOM 事件绑定与路由控制器)
- **职责范围**：全量界面交互与事件委托（首页分段、事项卡片点击/展开、操作确认、撤销入口、模态弹层、我的/设置交互）、Web Share API 分享参数消费（`applyShareParams`）、URL query 动作路由（`handleQueryActions`）以及只读演示数据预览（`demoPreviewRows`, `openDemoPreview`, `seed`）；
- **导出规格**：标准 UMD 挂载于 `AttentionLib.AppEvents.createAppEvents(deps)`；
- **契约方法**：`bind`、`isBound`、`applyShareParams`、`handleQueryActions`、`demoPreviewRows`、`openDemoPreview`、`seed`（7项完整契约）；
- **幂等防护**：内部维护私有 `bound` 标志，二次调用 `bind()` 同步短路，杜绝 DOM 监听重复注册。

### 3. `lib/app-test-api.js` (自动化测试与诊断接口装配)
- **职责范围**：组装挂载至 `globalThis.__ATTENTION_INBOX__` 与 `globalThis.seedAttentionInbox` 的动态测试接口；
- **动态读写**：采用 ES5/ES6 getter 属性（如 `get state()`, `get storage()`, `get alerts()` 等）实时穿透底层活动实例，彻底消除测试闭包陈旧引用；对有参函数通过 `.apply(null, arguments)` 完整透传所有入参（含 `promoteDue(now)`、`maybeReviewSession(now)`、`applyReminderEvents(events, now, cancelledEvents)` 等）；
- **导出规格**：标准 UMD 挂载于 `AttentionLib.AppTestApi.createAppTestApi(deps)`；
- **契约方法**：`assembleTestApi`、`getTestApi`。

### 4. `app-core.js` 最终职责边界
经 P3-A 至 P3-I 阶段系统性迁出后，`app-core.js` 彻底摆脱具体业务、算法及 DOM 渲染实现，主要收敛为：
1. **静态契约与依赖门禁**：声明 `REQUIRED_RUNTIME_EXPORTS`、全量模块实例契约，执行严格的运行时类型检查与 fail closed 防护；
2. **实例装配与生命周期注入**：依序构建各模块运行时依赖（`aiRuntimeDeps`, `persistenceRuntimeDeps`, `transactionRuntimeDeps`, ..., `actionFeedbackRuntimeDeps`, `eventsRuntimeDeps`, `testApiRuntimeDeps`）；
3. **应用生命周期中枢**：统筹 `init`、`startApp`、`startBusinessStartup` 启动时序与定时心跳调度；
4. **启动故障兜底**：`renderStartupFailure` 与 `renderStateRecovery` 界面渲染与恢复交互；
5. **必要入口协调**：为历史契约与静态覆盖矩阵提供必要的薄包装转发。详细归属见同目录下 [`responsibility-table.md`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1910-p3i-delivery/responsibility-table.md)。

---

## 三、全量验证结果汇总 (实施方自测)

| 序号 | 验证套件 / 脚本 | 命令 | 结果 | 关键指标 / 说明 | 判定 |
| :--- | :--- | :--- | :---: | :--- | :---: |
| 1 | 完整 npm test 套件 | `npm test` | Exit 0 | 15 个子套件全部顺序执行且 0 失败 | PASS |
| 2 | P3-I 模块契约与幂等测试 | `node scripts/verification/p3i-modularization-tests.js` | Exit 0 | 44 项断言通过（求值纯净、依赖守卫、参数透传、动态 getter） | PASS |
| 3 | 启动组合变异测试 | `node test-boot-combination.js` | Exit 0 | 917 项启动组合断言全部通过（0 失败） | PASS |
| 4 | 回归测试套件 | `node test-regressions.js` | Exit 0 | 730 项回归断言全部通过（0 失败） | PASS |
| 5 | 功能冒烟套件 | `node test-smoke.js` | Exit 0 | 266 项功能断言全部通过（0 失败） | PASS |
| 6 | 单一来源闭合检查 | `node scripts/verification/parse-single-source.js` | Exit 0 | 160 项断言全部通过（单一来源闭合） | PASS |
| 7 | 原生提醒测试 | `node test-native-reminders.js` | Exit 0 | 36 项断言全部通过（0 失败） | PASS |
| 8 | 单元测试 | `node test-unit.js` | Exit 0 | 34 项断言全部通过（0 失败） | PASS |
| 9 | 真实 Chrome 平台与 SW 检查 | `python3 scripts/verification/browser-platform-check.py` | Exit 0 | v38 缓存激活、平台 9 契约、网络状态更新计数正常 | PASS |
| 10 | 真实 Chrome 全量浏览器检查 | `for f in scripts/verification/browser-*.py; do python3 "$f"; done` | Exit 0 | alerts, capture, content, diagnostics, import, recovery, review, setup, views, platform 全部通过 | PASS |
| 11 | 五层资源闭合断言 | `python3 verify-resources.py` | Exit 0 | 38/38 资源（含 3 个 P3-I 新模块）五层哈希完全一致，0 不匹配 | PASS |
| 12 | 代码格式与冲突检查 | `git diff --check` | Exit 0 | 无语法错误、无空白错误、无冲突标记 | PASS |
| 13 | 真实设备冷启动与 CDP 断言 | `python3 scripts/verification/p3i-device-verify.py` | Exit 0 | 候选 APK 与设备 APK SHA 完全一致，冷启动后 CDP 断言 7+7+2 契约全部满足 | PASS |

---

## 四、真实设备运行数据 (vivo V2238A, Serial: 10ACBF2D3D000RS)

- 在机 APK 路径：`/data/app/~~b-v18SRL8oHobSrhFYAD1g==/space.alliswell.inbox-HFbFwxJqJEfPJU1Fd7ZHMw==/base.apk`
- 在机 APK SHA-256：`c949ad2861bd47680a29384d4f4bdc8a69a594473a366936a9eb239ca8bac7a3`（与候选 APK 完全一致）
- CDP 实机断言结果 (`device-verify-summary.json`)：
  ```json
  {
    "ready": true,
    "isNative": true,
    "hasSysBridge": true,
    "hasAppSettings": true,
    "hasActionFeedback": true,
    "fbContractLength": 7,
    "hasAllFbContract": true,
    "hasEvents": true,
    "evContractLength": 7,
    "hasAllEvContract": true,
    "isBound": true,
    "demoRowsCount": 5,
    "hasTestApi": true,
    "testApiContractLength": 2,
    "hasAllTestApiContract": true,
    "schedEvHasScheduled": false
  }
  ```
- 屏幕截屏与快照日志：已归档至本目录 `p3i-device-verify.png`、`p3i-device-verify-audio.txt`、`p3i-device-verify-notifications.txt`、`p3i-device-verify-vibrator.txt`。

---

## 五、明确声明的 NOT_PERFORMED 项

1. **P4 跨版本离线原地升级**：未模拟从旧缓存版本断网直切 v38 的离线升级流程，属于 P4 范畴；
2. **物理声振与系统通知栏物理交互**：真机验证聚焦于原生桥绑定、冷启动生命周期、事件绑定与排程证据生成，未进行物理闹钟真实响铃拦截测试；
3. **独立复验结论**：本报告仅代表实施方自测完成，不作任何无条件通过或越权独立复验结论声明。

---

## 六、交付物与交付状态

- **交付目录**：`docs/reviews/verification-runs/20260923T1910-p3i-delivery/`
- **候选 APK**：`releases/candidates/20260923T1910-p3i-candidate/app-debug.apk` (`c949ad2861bd47680a29384d4f4bdc8a69a594473a366936a9eb239ca8bac7a3`)
- **实施方状态**：实施与自测工作已全部闭合，停止所有开发动作，等待独立复验方进行独立复验。
