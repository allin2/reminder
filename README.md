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
| 快速录入 | 一句话自然语言；自动解析时间；低置信度时会让你极简确认 |
| 现在需要注意 | 首页只展示当前应进入注意力的事项 |
| 我知道了 | 确认「已看到」，**不会**变成完成 |
| 稍后 | 30 分钟 / 2 小时 / 今晚 / 明天 / 周末 / 自定义 |
| 完成 | 唯一正常归档出口 |
| 未来 | 托管中的事项 + 月历；默认不占首页 |
| 已归档 | 按日回看，可恢复 |
| 笔记 | 轻量 Markdown，可置顶、关联项目 |
| 搜索 | 事项、标签、项目、笔记 |
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
| `prd.html` | 产品需求文档（附属，依赖同目录 `styles.css`、`app.js`） |
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
- `test-native-reminders.js`：**42 项全部通过**
- `test-smoke.js`：**55 项全部通过**

UI 手测建议顺序：示例载入 → 导航 → 录入 → 到期弹条 → 我知道了 → 完成 → 归档。

---

## 数据与提醒（加固说明）

- **存储**：优先 IndexedDB（`attention-inbox`），不可用时自动退回 `localStorage`；首次打开会把旧 `localStorage` 数据迁入 IDB（旧键保留作备份）。
- **重提醒**：普通事项不自动重弹；重要约每 30 分钟、最多 4 次；关键约每 15 分钟、最多 8 次；用户关闭弹条后 30 分钟内不再打扰；ACK/完成后停止。
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

1. 系统管理的是「何时重新进入注意力」，不是完整任务管理  
2. 只有用户主动「完成」才归档  
3. 未来事项默认不占据首页  
4. 只有显式「我知道了」才算真正注意到  
5. 管理注意力的工具本身不能成为新的注意力负担  

完整说明见 [prd.html](./prd.html)。

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
- 普通、重要、关键三个通知渠道分别排 1、4、8 次；重要每 30 分钟、关键每 15 分钟补充提醒。渠道启用提示音和震动，但不申请勿扰策略访问，也不使用全屏通知。
- Android 13+ 由用户在“我的”页面主动授予通知权限；未授权时只保留应用内提醒，不循环弹窗。
- Android 12+ 可主动进入系统“闹钟和提醒”设置授予精确闹钟权限；未授权时仍使用原生非精确 `AlarmManager`，界面会标明时间可能延迟。
- 官方插件接收 `BOOT_COMPLETED` / `LOCKED_BOOT_COMPLETED` 并恢复持久化排程；应用更新后也恢复排程，应用启动和恢复前台时会重新对账。
- 用户在系统设置中主动“强制停止”应用后，Android 会阻止闹钟和广播，必须由用户再次打开应用；这是平台边界。

数据仍以 IndexedDB 中的事项为真源，原生 pending 通知只是可删除、可重建的投影。完整契约与验证等级见 [`docs/compose/spec/android-native-reminders.md`](./docs/compose/spec/android-native-reminders.md)。

### 当前验证边界

- 已完成 Node mock、Web 冒烟、Capacitor 资源同步与 Manifest/插件注册静态核对。
- 本次环境未安装 JDK 17、Android SDK 或模拟器，因此 Gradle 编译、APK 生成/安装、系统杀进程、Doze、重启和真机通知动作均为 `NOT_PERFORMED`，不能据此宣称 Android 真机 PASS。

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
