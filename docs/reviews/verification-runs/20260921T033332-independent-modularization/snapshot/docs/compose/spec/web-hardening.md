---
feature: web-hardening
status: delivered
updated: 2026-09-15
branch: web-hardening
commits: 98022ed..d6e1793
---

# 加固 Web 版

## Report

**What was built** — 将安心收件箱从单文件逻辑拆出可测纯模块，并加固存储与提醒：`lib/parse-cn.js`（中文时间解析）、`lib/repeat.js`（周期）、`lib/reminder.js`（勿扰/窗口/有限重提醒）、`lib/storage.js`（IndexedDB + localStorage 回退与迁移）。`app-core.js` 改为 async 初始化，优先 IDB；重要事项约 30 分钟/最多 4 次、关键约 15 分钟/最多 8 次重提醒，关闭弹条 30 分钟内不再打扰；周末窗口仅作用于 waiting，不覆盖 snooze。新增 `test-unit.js`（29 项）并保持 `test-smoke.js` 55 项全绿。

**Verification** — `node test-unit.js`：通过 29 / 失败 0（PASS）。`node test-smoke.js`：通过 55 / 失败 0（PASS）。独立审查后修复 2 个 critical：① IDB 可用时误把「后端就绪」当成「已有数据」导致首启不 seed；② 窗口择时覆盖用户 snooze。另将 `lastAlertShownAt` 纳入 `normalizeItem` 持久化，避免刷新后重提醒预算失效。修复后两套测试复跑 PASS。

**Journey log**
- 无打包器场景用 UMD `lib/*` + script 顺序加载，Node 可直接 require，避免 file:// 下 ES module 限制。
- 「storage backend ready」与「storage has data」必须分开；否则 IDB 首启静默跳过 seed。
- 对 `triggerAt` 的自动改写必须按 status 门控，否则会与 snooze/reopen 打架。
- 审查指出 app-core 内仍留有 parse/repeat 副本（Lib 存在时被覆盖）；后续清理可删死代码以消除双维护。

## [S1] Problem
安心收件箱已可交付，但作为日常工具仍有三处薄弱：
1. **存储**：`localStorage` 容量与配额脆弱，无统一备份/迁移层，清站点数据易丢。
2. **提醒调度**：到期后仅一次性进入 `due`；重要/关键未 ACK 时缺少有限重提醒；柔性时间窗口（周末等）几乎未参与择时。
3. **可测性**：解析/周期/生命周期挤在单文件 IIFE，Node 冒烟靠注入钩子，新增逻辑难以做干净单测。

## [S2] Design

### 架构约束
- 保持**无构建**静态交付：`index.html` 多 `<script>` 顺序加载，不用打包器。
- 纯逻辑拆到 `lib/*.js`，UMD 包装（浏览器挂 `window.AttentionLib`，Node `module.exports`）。
- `app-core.js` 只做 UI/状态编排，优先调用 `AttentionLib.*`。

### [S2.1] 存储（IndexedDB）
- 新模块 `lib/storage.js`：
  - `openDb()`：库名 `attention-inbox`，仓库 `kv`，键 `state`。
  - `loadState()` / `saveState(obj)`：异步。
  - `migrateFromLocalStorage(key)`：若 IDB 空且 localStorage 有旧键 `attention-inbox-v2`，导入后写入 IDB（旧键保留作回退，不删除用户数据）。
  - 回退：IDB 不可用时自动用 `localStorage` 同步实现同一接口。
- 启动：`init` 改为 `async`；`await loadAsync()` 后再 `bind`/`render`。
- 首启 seed：仅当 load 未返回真实数据且 `items` 为空时 seed（与后端类型无关）。
- 保存：`save()` 优先 IDB，失败落 localStorage。

### [S2.2] 提醒调度
- 柔性窗口：仅 `waiting` 状态应用 `applyWindowTrigger`；`snoozed` 不改写。
- 有限重提醒：
  - normal：不自动重弹。
  - important：未 ACK 每 30 分钟，最多 4 次。
  - critical：未 ACK 每 15 分钟，最多 8 次。
- 字段：`remindCount`、`lastRemindAt`、`lastAlertShownAt`（经 `normalizeItem` 持久化）。
- 关闭弹条 30 分钟屏蔽优先于重提醒；ACK/完成停止。

### [S2.3] 单元测试
- `test-unit.js`：解析、周期、勿扰、重提醒策略、存储内存后端。
- 保留 `test-smoke.js` 55 项。
- README 验证一节补充两套命令。

### [S2.4] 兼容
- 旧 localStorage 数据首次打开自动迁入 IDB。
- 不改 PRD、不引入 npm 运行时依赖。

## [S3] Out of Scope
- Capacitor / 原生闹钟
- 云同步、账号
- Service Worker 大改
- 将 app-core 全面拆成 ES module 组件树
- 删除 app-core 内已由 Lib 覆盖的 parse/repeat 死代码（后续清理）

## Tasks
- [x] T1: 抽取 `lib/parse-cn.js`、`lib/repeat.js`、`lib/reminder.js`（UMD）并让 app-core 引用 — acceptance: 浏览器与 Node 均可加载；解析/周期行为与现网一致 (covers: S2)
- [x] T2: 实现 `lib/storage.js`（IDB + localStorage 回退 + 迁移）并接入 async init/save — acceptance: 无 IDB 时仍可用；有旧 localStorage 时自动迁移 (covers: S2.1)
- [x] T3: 实现窗口择时与 important/critical 有限重提醒 — acceptance: 单测覆盖次数与间隔；ACK 后不再弹 (covers: S2.2)
- [x] T4: 编写 `test-unit.js` 并跑通；`test-smoke.js` 仍 55/55 — acceptance: 两套测试均 PASS (covers: S2.3)
- [x] T5: 更新 README 验证与文件地图 — acceptance: 含 lib/ 与 test-unit.js 说明 (covers: S2.3)
