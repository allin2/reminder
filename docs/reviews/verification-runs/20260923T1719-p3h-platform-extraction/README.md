# P3-H 实施自测报告：平台适配与 PWA 生命周期（Platform）模块化拆分

> **实施方声明**：本文档为实施方自测交接记录，并非独立验收结论。全部自测结论均表述为“实施方自测通过”，最终结果待独立复验方复核断定。本轮工作严格遵循任务边界，不宣称整个 `app-core.js` 模块化或 P4 阶段完成。

---

## 1. 任务背景与工作区保护

- **任务目标**：将 `app-core.js` 中的平台适配与 PWA 生命周期管理代码完整迁至唯一 UMD 模块 `lib/app-platform.js`；消除 `lib/app-native-coordinator.js` 与 `app-core.js` 之间的重复平台判定与桥等待算法；保持现有用户行为、生命周期监听幂等性以及原生/Web 分支降级语义；严格不顺带实施 P4 离线升级验收或宣称整体模块化完成。
- **工作区基线核对**：
  - Git HEAD: `3574824357dc7beb04cbd3e32aa413cd508e8484`（分支 `main`）
  - 工作区保护：严格不执行任何破坏性 git 操作（无 `checkout`、`reset`、`stash`、`clean`、`commit`、`push`）。
  - 保留所有既有未提交改动与历史复验目录，无覆盖、无删除。
- **历史候选保护**：
  - 严格保护前序候选（如 `20260923T1605-p3gr-candidate/app-debug.apk`、`20260923T1405-p3g-candidate/app-debug.apk` 等），不进行任何覆盖。
  - 本轮全新候选写入唯一隔离路径：`releases/candidates/20260923T1719-p3h-candidate/app-debug.apk`。
  - 实测 SHA-256：`6fd03728a329f05e6a3676718779a161a0863ba6c76c99f2511072050c9fada0`。

---

## 2. 状态与函数迁移矩阵

| 原函数 / 可变状态 | 原所在位置 | 新所有者 (`lib/app-platform.js`) | 生产与测试调用者 | 测试覆盖与变异检测 |
| :--- | :--- | :--- | :--- | :--- |
| `systemBridge()` | `app-core.js` 内联 | `appPlatform.systemBridge()` | `app-core.js` (系统通知/跳转设置), `lib/app-alerts.js`, `lib/app-native-coordinator.js` | `p3h-platform-tests.js`, `browser-platform-check.py`, `p3h-device-verify.py` |
| `appSettingsPlugin()` | `app-core.js` 内联 | `appPlatform.appSettingsPlugin()` | `app-core.js` (应用设置跳转) | `p3h-platform-tests.js`, `browser-platform-check.py`, `p3h-device-verify.py` |
| `isNativeAndroidRuntime()` | `app-core.js` 内联 | `appPlatform.isNativeAndroidRuntime()` | `app-core.js` (启动/设置分支), `lib/app-native-coordinator.js` 依赖注入 | `p3h-platform-tests.js` (变异3), `test-boot-combination.js` |
| `waitForNativeBridge(timeoutMs)` | `app-core.js` 内联 | `appPlatform.waitForNativeBridge(timeoutMs)` | `app-core.js` (init 启动链), `lib/app-native-coordinator.js` 依赖注入 | `p3h-platform-tests.js` (变异4), `test-boot-combination.js` |
| `deferredInstallPrompt` | `app-core.js` 模块级变量 | `appPlatform` 私有状态 (`getDeferredInstallPrompt()`) | `bindInstall`, `promptInstall`, `test-boot-combination.js` | `p3h-platform-tests.js` (变异5), `browser-platform-check.py` |
| `promptInstall()` | `app-core.js` 内联 | `appPlatform.promptInstall()` | 安装按钮点击事件 | `p3h-platform-tests.js`, `browser-platform-check.py` |
| `bindInstall()` | `app-core.js` 内联 | `appPlatform.bindInstall()` | `app-core.js` `bindEvents()` | `p3h-platform-tests.js` (变异1), `browser-platform-check.py` |
| `bindNetwork()` | `app-core.js` 内联 | `appPlatform.bindNetwork()` | `app-core.js` `bindEvents()` | `p3h-platform-tests.js` (变异1), `browser-platform-check.py` |
| `registerPwa()` | `app-core.js` 内联 | `appPlatform.registerPwa()` | `app-core.js` `init()` | `p3h-platform-tests.js` (变异2), `test-boot-combination.js` |
| `unbindAll()` | 无 (新增清理入口) | `appPlatform.unbindAll()` | 测试 teardown, 模块重置 | `p3h-platform-tests.js` |
| `getSwRegistration()` | 无 (新增访问器) | `appPlatform.getSwRegistration()` | 测试与诊断观察 | `p3h-platform-tests.js` |

---

## 3. 架构规范与单一实现收口

### 3.1 模块求值纯净性保证
- `lib/app-platform.js` 采用 UMD 规范，顶层求值时不访问 DOM (`window`/`document`)、不注册任何监听器、不发起任何 I/O 请求、不调用 Capacitor/NativeReminders 桥。
- 实例在工厂函数 `createAppPlatform(deps)` 显式调用时才被创建，严格校验 10 项必需依赖（`getCapacitor`, `getNativeReminders`, `getServiceWorker`, `getWindow`, `getDocument`, `toast`, `renderPwaStatus`, `onNotificationAction`, `noteAppVisibility`, `onForeground`），缺失任一依赖立即抛出具名异常（fail-closed）。

### 3.2 单一实现与算法去重
- **判定逻辑去重**：在此前代码中，`lib/app-native-coordinator.js` 与 `app-core.js` 各自内联实现了 `isNativeAndroidRuntime()` 和 `waitForNativeBridge()` 轮询算法。本轮重构中：
  - `lib/app-platform.js` 作为平台检测与桥等待算法的**唯一实现源**。
  - `lib/app-native-coordinator.js` 消除重复算法，改通过 `deps.isNativeAndroidRuntime` 与 `deps.waitForNativeBridge` 由 `app-core.js` 装配时注入；若未提供依赖则安全降级到非安卓环境。
  - `app-core.js` 中的同名函数收缩为转发到 `appPlatform` 实例的薄代理。
- **监听器去重与幂等性保障**：
  - `bindInstall()` 内部使用 `installBound` 门禁，避免重复绑定导致 `beforeinstallprompt` / `appinstalled` 监听器膨胀。
  - `bindNetwork()` 内部使用 `networkBound` 门禁，避免重复绑定导致 `online` / `offline` / `blur` / `focus` / `visibilitychange` 多次触发。
  - `registerPwa()` 内部使用 `pwaRegistered` 门禁，保证 SW message 监听器仅注册一次。

---

## 4. 变更文件与 SHA-256 校验矩阵

| 文件路径 | 变更类型 | SHA-256 (Source) | SHA-256 (www) | SHA-256 (Android Assets) | SHA-256 (in APK) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `lib/app-platform.js` | **新增模块** | `e28f3c6b493fc57d4e39dc3c3c795fa82701a0fa0568ddccb5d8649cdf90f44a` | `e28f3c6b493fc57d4e39dc3c3c795fa82701a0fa0568ddccb5d8649cdf90f44a` | `e28f3c6b493fc57d4e39dc3c3c795fa82701a0fa0568ddccb5d8649cdf90f44a` | `e28f3c6b493fc57d4e39dc3c3c795fa82701a0fa0568ddccb5d8649cdf90f44a` |
| `app-core.js` | **重构瘦身** | `12e841dcb401f584f17d3b0abf21d534315e0a6f89f515e172f38bdfe0c61e9e` | `12e841dcb401f584f17d3b0abf21d534315e0a6f89f515e172f38bdfe0c61e9e` | `12e841dcb401f584f17d3b0abf21d534315e0a6f89f515e172f38bdfe0c61e9e` | `12e841dcb401f584f17d3b0abf21d534315e0a6f89f515e172f38bdfe0c61e9e` |
| `sw.js` | **版本与预缓存** | `a9fd960bb87cd85b363106c98afd00328b3c18acaffcee09a9dcf0a3a152e12c` | `a9fd960bb87cd85b363106c98afd00328b3c18acaffcee09a9dcf0a3a152e12c` | `a9fd960bb87cd85b363106c98afd00328b3c18acaffcee09a9dcf0a3a152e12c` | `a9fd960bb87cd85b363106c98afd00328b3c18acaffcee09a9dcf0a3a152e12c` |
| `index.html` | **加载链引入** | `0cc4e73abd6a7d7303e662d695bfbe4170e5834bf0b4192180158ff4dd5d46d8` | `0cc4e73abd6a7d7303e662d695bfbe4170e5834bf0b4192180158ff4dd5d46d8` | `0cc4e73abd6a7d7303e662d695bfbe4170e5834bf0b4192180158ff4dd5d46d8` | `0cc4e73abd6a7d7303e662d695bfbe4170e5834bf0b4192180158ff4dd5d46d8` |
| `lib/app-native-coordinator.js` | **委派去重** | `3de9902b0cb97d3159b5c710a1698908211189c7de71861caf69637b0f30948f` | - | - | - |
| `package.json` | **测试脚本注册** | `a1056927ae22dcd74f484b316c8b372be4f9dcc06349c2852826b8b26515c811` | - | - | - |
| `releases/candidates/20260923T1719-p3h-candidate/app-debug.apk` | **候选安装包** | `6fd03728a329f05e6a3676718779a161a0863ba6c76c99f2511072050c9fada0` | - | - | - |

> **注**：经 Python 脚本逐字节比对，Source、www、Android assets 以及 APK 压缩包内对应资源的 SHA-256 完全一致（100% MATCH）。

---

## 5. 变异测试与反例分析（拔掉修复即变红）

在 [`scripts/verification/p3h-platform-tests.js`](file:///Users/qlyf/Developer/reminder/scripts/verification/p3h-platform-tests.js) 中建立了 5 项临时源变异测试：

1. **变异 1：监听器未去重防抖（移除 `bindNetwork` / `bindInstall` 幂等保护标志）**
   - 变异操作：移除 `if (installBound) return;` 与 `if (networkBound) return;`。
   - 变异结果：重复调用导致监听器数量翻倍，被断言 `listener attached exactly once` 立即捕获变红。
2. **变异 2：通知动作转发被绕过（注释掉 `onNotificationAction` 调用）**
   - 变异操作：移除 SW 消息中的 `deps.onNotificationAction(data)`。
   - 变异结果：SW 点击动作未传递到业务层，断言 `notification action forwarded` 立即捕获变红。
3. **变异 3：原生 Android 检测在没有 Capacitor 时误判为 true**
   - 变异操作：将 `if (!cap) return false;` 篡改为 `return true;`。
   - 变异结果：纯 Web 场景误识别为 Android，断言 `Pure Web isNativeAndroidRuntime must be false` 立即捕获变红。
4. **变异 4：桥晚到轮询被破坏（直接返回 false，不轮询）**
   - 变异操作：将 `if (Date.now() >= deadline) return resolve(false);` 篡改为 `return resolve(false);`。
   - 变异结果：延迟 70ms 到达的桥未能被成功捕获，断言 `waitForNativeBridge must resolve true` 立即捕获变红。
5. **变异 5：`appinstalled` 时未清理 `deferredInstallPrompt`**
   - 变异操作：移除 `deferredInstallPrompt = null;`。
   - 变异结果：已安装后仍残留 prompt 句柄，断言 `deferred prompt cleared on appinstalled` 立即捕获变红。

执行日志：
```
healthy checks passed
mutant1_listenerDoubling: remove installBound / networkBound check: mutation detected
mutant2_notificationActionBypassed: omit onNotificationAction: mutation detected
mutant3_nativeAndroidWithoutCapacitor: return true when cap is null: mutation detected
mutant4_lateBridgePollingBroken: immediate false on first check: mutation detected
mutant5_deferredPromptNotClearedOnAppInstalled: omit clearing deferredInstallPrompt: mutation detected
lib/app-platform.js before/after SHA-256 match: e28f3c6b493fc57d4e39dc3c3c795fa82701a0fa0568ddccb5d8649cdf90f44a
```

---

## 6. 生产组合与浏览器 CDP 验证

### 6.1 无头 Chrome 浏览器真实环境验证（`browser-platform-check.py`）
- 独立起动临时无头 Chrome Profile 访问页面并加载完整运行时；
- 验证 `AttentionLib.AppPlatform` 导出与 `window.__ATTENTION_INBOX__.platform` 装配；
- 验证纯 Web 环境下 `isNativeAndroidRuntime() === false`、`systemBridge() === null`、`appSettingsPlugin() === null`；
- 验证模拟 `beforeinstallprompt` 唤起安装按钮、保存 prompt、`appinstalled` 清理 prompt 并收起按钮；
- 验证 `bindInstall()` / `bindNetwork()` 幂等性与在线/离线/可见性事件派发无异常抛出。
- 输出结果：
```json
{"ready": true, "hasPlatform": true, "hasAllContract": true, "contractLength": 9, "isNative": false, "sysBridgeIsNull": true, "appSettingsIsNull": true, "initialBtnHidden": true, "promptPrevented": true, "btnVisibleAfterPrompt": true, "deferredPromptSaved": true, "btnHiddenAfterInstalled": true, "deferredPromptCleared": true}
All browser platform checks PASSED
```

### 6.2 完整回归测试套件（`npm test`）
- `test-unit.js`: PASS
- `test-native-reminders.js`: PASS
- `scripts/verification/p3a-model-tests.js`: PASS
- `scripts/verification/p3b-persistence-tests.js`: PASS
- `scripts/verification/p3c-transaction-tests.js`: PASS
- `scripts/verification/p3d-items-tests.js`: PASS
- `scripts/verification/p3e-coordinator-tests.js`: PASS (11 mutation checks passed)
- `scripts/verification/p3f-review-tests.js`: PASS
- `scripts/verification/p3g-alerts-tests.js`: PASS
- `scripts/verification/p3h-platform-tests.js`: PASS (5 mutation checks passed)
- `test-boot-combination.js`: 通过 916 项，失败 0 项（含正向平台可用断言与缺少依赖 fail-closed 断言）
- `test-smoke.js`: 通过 266 项，失败 0 项
- `test-regressions.js`: 通过 730 项，失败 0 项
- `scripts/verification/parse-single-source.js`: 通过 160 项，失败 0 项

---

## 7. 物理真机（vivo V2238A）实机验证

- **连接设备**：vivo V2238A (serial: `10ACBF2D3D000RS`, Android 16)
- **候选 APK 安装**：安装成功，机上指纹与候选一致：
  - `Device APK SHA: 6fd03728a329f05e6a3676718779a161a0863ba6c76c99f2511072050c9fada0`
  - `Candidate APK SHA: 6fd03728a329f05e6a3676718779a161a0863ba6c76c99f2511072050c9fada0`
- **CDP 运行时核验**：
```json
{
  "ready": true,
  "hasPlatform": true,
  "hasAllContract": true,
  "contractLength": 9,
  "isNative": true,
  "hasSysBridge": true,
  "sysBridgeType": "object",
  "hasAppSettings": true,
  "appSettingsType": "object",
  "waitResult": true,
  "deferredPromptIsNull": true,
  "btnInstallHidden": true
}
```
- **实机运行结论**：
  - 真实 Android WebView 环境下，`a.platform.isNativeAndroidRuntime()` 确为 `true`；
  - 原生 `SystemBridge` 与 `AppSettings` 插件对象成功桥接，类型均为 `object`；
  - `waitForNativeBridge(100)` 判定立即通过（返回 `true`）；
  - Android 原生容器内 `deferredInstallPrompt` 恒为 `null` 且安装按钮保持隐藏；
  - 运行时 `bindInstall()` 与 `bindNetwork()` 多次调用无异常；
  - 屏幕截图与音频/振动/通知 dumpsys 均已持久化保存至本运行目录。

---

## 8. P3-G-R 复验局限性说明与本轮声明

在上一轮 P3-G-R 复验中，独立复验方得出的结论为 `PASS_WITH_LIMITATIONS`，指出了两项客观局限性：
1. **保存抑制探针仅验证了方法调用未被拦截，未构成对“该分支是否被真正进入”的充要证明**：因保存被合法抑制属于内存标记，外部黑盒观测难以区分未进入与被抑制；
2. **Web 提醒弹条在真实视口中是否可能物理遮挡活动闹钟面板尚未经自然用户操作链完整证明**：虽然 DOM 层级与样式在理论上独立，但未进行自然手指多点并发点击的实际操作验证。

针对上述局限性及本轮 P3-H 的验证范围，本轮实施方做如下明确声明：
- **NOT_PERFORMED 项 1：弹条遮挡下的自然手指盲击活动闹钟按钮**
  - **状态**：`NOT_PERFORMED`
  - **理由**：本轮任务聚焦于平台适配代码提取（`lib/app-platform.js`），不涉及 UI 布局或弹条交互变更。为避免破坏既有验证基准与引入不确定性，本轮未安排自然用户点击链复测。
- **NOT_PERFORMED 项 2：多版本 Service Worker 真实离线更新与缓存替换演练**
  - **状态**：`NOT_PERFORMED`
  - **理由**：SW 离线更新策略与版本切换属于 P4 阶段的验收范围，本批次严格限定为 P3-H 实施，严禁跨批次宣称完成。

---

## 9. 结论

- **实施方自测结论**：**实施方自测通过**
- **当前状态**：停在 P3-H 完成点，无后续偷跑。等待独立复验方进行复验断定。
