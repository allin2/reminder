# 安心收件箱

少记挂，不错过 —— 本地优先的注意力唤醒与未来事项托管（中文移动 Web App）。

> Remember less. Miss nothing.

融合 [alliswell](https://github.com/allin2/alliswell) 的任务/提醒/笔记能力，以及 Attention Inbox 产品原则：  
**Attention ≠ Task · Acknowledged ≠ Completed · Future 默认不可见 · 通知送达 ≠ 用户看到**。

---

## 快速开始

无需构建、无需后端。

1. 用浏览器打开项目根目录下的 `index.html`  
   （手机宽度约 390px 体验最佳；也可「添加到主屏幕」作 PWA）
2. 若首页为空：进入 **我的 → 载入示例数据**
3. 点右下角 **+**，输入例如：`周五提醒我再看看这个项目`

数据优先保存在本机 `IndexedDB`，不可用时回退到 `localStorage`，离线可用。

---

## 核心交互

| 操作 | 说明 |
|------|------|
| 快速录入 | 一句话自然语言；自动解析时间；**捕获永不失败**，解析不出来也照样收下 |
| 现在需要注意 | 首页只展示当前应进入注意力的事项；**不出现「即将到来」**（D5） |
| 我知道了 | 确认「已看到」，**不会**变成完成 |
| 稍后 | 应用内给完整六档；通知栏/全屏闹钟快捷动作固定 **2 小时**（D11） |
| 完成 | 唯一正常归档出口 |
| 待整理 | 模糊记录先收下；入口**常驻弱形态**，整理窗口∪宽限期内变显著（D6）；兜底=下一个 Review Window，不占首页（D17） |
| 弹条 | **只有点 × 才关闭**；挂 10 分钟自动收起且不记账（D13/D14） |
| 未来 | 托管中的事项 + 月历；默认不占首页 |
| 已归档 | 按日回看，可恢复；**重开不自动提醒**，可选设时间（D23） |
| 默认提醒方式 | 未标记事项按全局默认（录入时快照）；**有标记（重要/关键）一律闹钟**（D25 / A-01） |
| 笔记 | 轻量 Markdown，可置顶、关联项目 |
| 搜索 | 事项、标签、项目、笔记；也是找回待整理记录的入口 |
| AI（可选） | 我的 → AI 智能理解，BYOK；失败自动回退本地解析 |

---

## 文件地图

| 文件 | 职责 |
|------|------|
| `index.html` | App 界面与样式 |
| `app-core.js` | 核心编排（UI、状态、生命周期） |
| `lib/parse-cn.js` | 中文自然语言时间解析 |
| `lib/repeat.js` | 周期规则（含月底、第 N 个星期 X） |
| `lib/reminder.js` | 勿扰、柔性窗口、有限重提醒策略 |
| `lib/native-reminders.js` | Capacitor Android 原生通知、权限与排程对账适配层 |
| `lib/storage.js` | IndexedDB 存储 + localStorage 回退/迁移 |
| `sw.js` | Service Worker（离线壳层、通知） |
| `manifest.json` | PWA 清单（安装、分享入口、快捷方式） |
| `icon.svg` / `icon-192.png` / `icon-512.png` | 应用图标 |
| `docs/baseline/` | **唯一业务基线**（V0.2 冻结版）与对齐分析 |
| `prd.html` | 产品需求文档 **V0.1（历史详述）**，依赖同目录 `styles.css`、`app.js` |
| `test-smoke.js` | Node 集成冒烟（生命周期主路径） |
| `test-unit.js` | Node 单元测试（解析/周期/提醒/存储） |
| `test-native-reminders.js` | Android 原生提醒投影与权限 mock 测试 |
| `docs/compose/spec/` | Compose 特性规格 |

---

## 验证

在项目根目录执行：

```bash
npm test
```

预期：
- `test-unit.js`：**29 项全部通过**
- `test-native-reminders.js`：**69 项全部通过**（含 D9/D25 首次全屏路由、P0-2 闹钟撤销、P0-1 待整理排程）
- `test-smoke.js`：**96 项全部通过**（含 D5/D6/D7/D8 首页架构、D12/D13/D14 弹条与全屏语义、
  D15/D17/D22/D23/D25 落地断言、P0-3 整理会话出口回归）

UI 手测建议顺序：示例载入 → 导航 → 录入 → 到期弹条 → 我知道了 → 完成 → 归档。

---

## 数据与提醒（加固说明）

- **存储**：优先 IndexedDB（`attention-inbox`），不可用时自动退回 `localStorage`；首次打开会把旧 `localStorage` 数据迁入 IDB（旧键保留作备份）。
- **重提醒**：普通事项不自动重弹；重要约每 30 分钟、最多 4 次；关键约每 15 分钟、最多 8 次；用户关闭弹条后 30 分钟内不再打扰；ACK/完成后停止。
- **首次投递**：有标记（重要/关键）或 `delivery_mode=alarm` 的事项，**首次**走全屏闹钟，后续仍走通知（D9/D25）。
- **周末窗口**：解析出 `window` 的事项，倾向在窗口日 10:00 进入注意力。

---

## 已知限制（Web 边界）

以下能力需原生壳（如 Capacitor）才能完整提供，当前 Web 版不承诺：

- 静音模式穿透闹钟、开机后精确闹钟恢复
- 系统分享面板（仅支持 URL 参数 / PWA share_target）
- Android 桌面角标（仅在支持 Badge API 时尽力）
- SQLite（当前为 IndexedDB，必要时回退 localStorage）
- 真机自动化可靠性测试套件

---

## 产品原则（摘要）

原则分两级，**红线不可让渡**，**默认值允许有意识的例外但必须显式论证**：

**红线**

1. 系统管理的是「何时重新进入注意力」，不是完整任务管理（Attention ≠ Task）
2. 只有用户主动「完成」才归档；「我知道了」永不等同于完成（Acknowledged ≠ Completed）
3. 只有显式「我知道了」才算真正注意到；送达、显示、解锁、点击通知、打开 App 都不算（送达 ≠ 看到）

**默认值**

4. 未来事项默认不占据首页（Future 默认不可见）
5. 管理注意力的工具本身不能成为新的注意力负担（低交互优先）

> **例外的唯一论证标准**：它会让「用户主动查看 Future 的频率」上升还是下降？
> 该指标在 PRD 里被定义为**不信任信号**，理想方向是下降。

**需求基线**：[`docs/baseline/Attention_Inbox_V0.2_产品需求与业务规格基线.md`](./docs/baseline/Attention_Inbox_V0.2_产品需求与业务规格基线.md)
（V0.2 冻结基线，**唯一业务基线**）。`prd.html` 是 V0.1，已降级为历史详述，冲突时以 V0.2 为准。

> **生效基线 = V0.2 原文（冻结，不编辑）+ 已批准的条款级修订**
> （[`docs/baseline/V0.2-amendments.md`](./docs/baseline/V0.2-amendments.md)，当前 1 项：A-01 默认提醒方式）。
> 新需求按 §24 先记为[变更提案](./docs/baseline/change-proposals.md)。

逐条对齐、7 项冲突的裁决与全新需求清单见
[`docs/baseline/v0.2-alignment.md`](./docs/baseline/v0.2-alignment.md)。

交互逻辑的裁决记录见
[`docs/decisions/interaction-logic-2026-09-16.md`](./docs/decisions/interaction-logic-2026-09-16.md)。

---

## Android 打包（Capacitor）

本仓库已接入 Capacitor Android 工程与官方本地通知插件，可在 **Android Studio** 中打开并生成 APK。

### 环境要求
- Node.js ≥ 18
- JDK 17（Android Studio 自带亦可）
- Android Studio + Android SDK（本机编译 APK 时需要）

### 常用命令

```bash
npm ci
npm run sync:www      # 把 Web 资源同步到 www/
npm run cap:sync      # sync:www + 同步到 android 工程
npm run cap:open      # 用 Android Studio 打开 android/
```

### 步骤
1. `npm ci`
2. `npm run cap:sync`
3. `npm run cap:open`（或在 Android Studio 打开 `android/` 目录）
4. 选择模拟器/真机 → Run；或 Build → Generate Signed Bundle/APK

### 工程说明
| 路径 | 说明 |
|------|------|
| `capacitor.config.json` | appId `space.alliswell.inbox`，应用名「安心收件箱」 |
| `www/` | 打包用 Web 资源（由 `sync:www` 生成，不入库） |
| `android/` | Capacitor 生成的 Android 平台工程 |
| `scripts/sync-www.js` | 资源同步脚本 |

### 原生提醒与权限

- Android 使用 `@capacitor/local-notifications@6.1.3`，底层由 `AlarmManager` 排程；应用进程被普通回收或设备休眠时不依赖常驻前台服务。
- 普通、重要、关键三个通知渠道分别排 1、4、8 次；重要每 30 分钟、关键每 15 分钟补充提醒。渠道启用提示音和震动，不申请勿扰策略访问，也**不使用全屏 Intent**。
- **全屏闹钟是独立通道，不再只给「关键」档**（D25 / A-01）：**有标记**（☆重要 · 🚨关键）事项的**首次**提醒一律走 `SystemBridge` 的 `setAlarmClock` + 全屏 `AlarmActivity`（亮屏、循环响铃、波形震动、锁屏直达）；**未标记**事项按「我的 → 默认提醒方式」的录入时快照决定。后续补充提醒（重要 3 次 / 关键 7 次）仍走通知渠道。全屏界面提供「我知道了 / 稍后 2 小时 / 完成」，以及一个只止响、不表态的「关闭」。
- **闹钟台账与撤销**：每次对账都会撤销不再需要的全屏闹钟（删除、改期、ACK、完成、关闭「本地通知」都会触发），并持久化已排 id，避免幽灵提醒。
- **待整理不使用全屏闹钟**，只用普通通知（`attention-normal-v2`）：在下一个整理窗口起点预排首次 + 60 分钟 × 2 次补充；其提醒受「本地通知」总开关控制，并按普通事项参与勿扰。
- Android 13+ 由用户在“我的”页面主动授予通知权限；未授权时只保留应用内提醒，不循环弹窗。
- Android 12+ 可主动进入系统“闹钟和提醒”设置授予精确闹钟权限；未授权时仍使用原生非精确 `AlarmManager`，界面会标明时间可能延迟。
- 官方插件接收 `BOOT_COMPLETED` / `LOCKED_BOOT_COMPLETED` 并恢复**它自己**的持久化排程；`SystemBridge` 排下的**全屏闹钟另由 `BootRestoreReceiver` 恢复**（读 `attention_alarm_schedules`，只补未过期项）。应用更新后也恢复排程，应用启动和恢复前台时会重新对账。
- 用户在系统设置中主动“强制停止”应用后，Android 会阻止闹钟和广播，必须由用户再次打开应用；这是平台边界。

数据仍以 IndexedDB 中的事项为真源，原生 pending 通知只是可删除、可重建的投影。完整契约与验证等级见
[`docs/compose/spec/android-native-reminders.md`](./docs/compose/spec/android-native-reminders.md) 与
[`docs/compose/spec/android-fullscreen-alarm.md`](./docs/compose/spec/android-fullscreen-alarm.md)。

### 当前验证边界

- 已完成 Node mock（含 SystemBridge 通道）、Web 冒烟、Capacitor 资源同步与 Manifest/插件注册静态核对。
- 仓库内的 `releases/安心收件箱-debug.apk` 是**自签名 debug 包**，只能用于侧载验证，不可发布。
- 本机未安装 JDK 17、Android SDK 或模拟器，因此 Gradle 编译、APK 生成/安装、系统杀进程、Doze、重启和真机通知动作均为 `NOT_PERFORMED`，不能据此宣称 Android 真机 PASS。
- 2026-09-16 晚修复轮新增/修改的 Java（`BootRestoreReceiver`、`SystemBridgePlugin` 的闹钟落盘与撤销、`AlarmActivity` 的重排入账）**只做到 `javac` 语法级通过**，未编译、未装机。
- 全屏闹钟、`USE_EXACT_ALARM` / `USE_FULL_SCREEN_INTENT` 等受限权限的**商店审核影响尚未评估**；PRD §33 也未把上架纳入 MVP。

### 已知未落地

- `schema 5` 迁移（`docs/compose/spec/delivery-mode.md` T9），需与 G01 正交状态建模合并。
- 四维正交状态 / `time_source`（验收 H1–H3）、Onboarding（I1–I3）、Deadline 分层保护（E3–E7）。
- `completed` 幽灵状态、`sessionStatus` / `notifyPrompted` 只写字段、旧通知渠道 `-v1` 的处置。
- 最近一次对齐审查：[`docs/reviews/code-vs-plan-2026-09-16.md`](./docs/reviews/code-vs-plan-2026-09-16.md)。

---

## 开发说明

- 纯静态，无 npm 构建；改完刷新即可  
- 改动 `app-core.js` 后请跑 `node test-smoke.js`  
- Service Worker 为网络优先，避免旧脚本缓存；调试时可强制刷新  
- 控制台兜底：`seedAttentionInbox()` 可强制载入示例数据  

---

## 许可与来源说明

本仓库为结合 alliswell 产品思路与 Attention Inbox PRD 的中文轻量实现 Demo/应用，用于学习与个人使用验证。  
alliswell 原项目许可请以其仓库为准（PolyForm Noncommercial 等）。
