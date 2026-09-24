# Run: 20260921T1610 · P2-C 真机收口（数据备份迁移的真实设备验证）

- 开始：2026-09-21T16:04:53+0800；收尾：2026-09-21 23:4x
- HEAD：`3574824357dc7beb04cbd3e32aa413cd508e8484`（**未提交未推送**，工作区脏=交付身份）
- 目的：把 P2-C（数据备份迁出 `lib/app-backup.js`）+ G01/G02 修复放到**真实设备**上验证，覆盖「保存落盘 / 同名 / 快照内容 / 取消 / 导入回环 / 重启持久 / 失败零误报 / 在途无残留」八面。

## 环境

| 项 | 值 |
|---|---|
| 设备 | QSKFAE95CQEUJZ8L · PKC130（OPPO Find X8 Pro 卫星通信版）· Android 16 · `PKC130_16.0.10.500(CN01)` |
| 被测包 | `space.alliswell.inbox.exportrecheck`（vCode 2 / vName 1.1，16:10:02 安装） |
| 生产包 | `space.alliswell.inbox` **全程未触碰** |
| 构建 | JDK17 Temurin；等价 sync 路径（`sync:www` → `cp assets` → restore-cordova-plugins → `gradlew assembleDebug`），**未跑 `cap sync`** |
| 候选 APK | `releases/candidates/20260921T1610-p2c-device-closure/attention-inbox-p2c-device-closure-debug.apk`<br>sha256 `63aa0918124df83349f093715e64854970f7929c6285574eb7b4d1fcc33d4119` |
| APK 内资源一致性 | 22 个 Web 资源与源码逐字节一致、双向无缺（`apk-assets-byte-compare.txt`） |
| tracked debug APK | 构建后按字节还原（`378ee91e…`），`git diff` 干净 |
| CDP | `adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>`；`scripts/android-cdp-eval.py <expr> 9223` |

## 行为所有权（本 run 验证对象）

| 行为 | 持有者 | 验证方式 |
|---|---|---|
| 快照构造 + AI 密钥排除 | `lib/app-backup.js` `buildLegacyBackupPayload()` | 用例 ③：解包导出文件 |
| 导出三通路 + 在途闸门 + 操作身份 | `lib/app-backup.js` `exportData()` | 用例 ①②④⑧⑨ |
| 导入：读 → 解析 → 确认 → 覆盖 → **await 权威提交** → 渲染 | `lib/app-backup.js` `importDataFile()`（G02） | 用例 ⑤⑦ |
| 读取失败反馈（不触发确认/提交） | `lib/app-backup.js` `reader.onerror/onabort`（G01） | 单元 8 条（真机见 `not-performed.md` §3） |
| 宽限闸门 | `lib/app-backup.js` `noteExportAppVisibility()` | 用例 ⑨；⑩ 见 `not-performed.md` §1 |
| 事件接线（blur/focus/visibilitychange） | `app-core.js:8024-8027` | 用例 ⑨（探针实测） |
| 持久化权威 | IDB `attention-inbox`/kv/`state` | 用例 ⑤⑥⑦⑧（原始字节哈希） |

## 结果

**总体判定：`PASS_WITH_BLOCKER`**（九个真机用例各自成立，但存在一个权威数据可能丢失的阻断项，
且当时数据丢失机制尚未确立 ⇒ 不构成完整收口；实施方自测，尚待独立复验）。

- **PASS（真机）**：①导出落盘 ②同名 `_1.json`+系统真实文件名 ③快照内容/中文/schema 5/密钥排除 ④取消还原 ⑤**导入回环 1/1 恢复** ⑥**重启持久** ⑦**非法 JSON 全量拒绝 + IDB 逐字节零副作用** ⑧**导出在途强杀无残留** ⑨宽限闸门输入路径 + 不误报。
- **🔴 BLOCKER**：进程死亡后权威状态由 1/1 变 0/0（`idb-state-loss-observation.md`，当时记 **NOT_ESTABLISHED**）。
  **后续**：阻断项已定名 **P2-C-R · 冷启动权威状态保护** 并在独立 run `20260921T2355-p2cr-authority-gate` 中处理 ——
  该 run 已把**写入者与触发条件**逐帧查实（`blocker-mechanism.md`），并在真机上验证候选不再发生覆盖。
  本 run 的判定**不因此自动转 PASS**：需 P2-C-R 通过独立复验后再回来重判。
- **NOT_PERFORMED**：生产包安装、宽限 8 s 真实超时、unavailable、stale、G01 真机故障注入 —— 逐条理由与替代证据见 `not-performed.md`。
- **文义校正（按裁决）**：本 run 已用当前隔离候选在真机上验证了 **SAF 落盘 / 取消 / 系统真实文件名 / 导入回环**，
  这四条正是 **E1–E4 所指向的主要行为**，**不再**记作「E1–E4 未执行」；仍未成立的只有 Web `<a download>` 通路本身
  （真机不经该通路），该缺陷逐字保留待裁决。详见 `not-performed.md` §5 / §6。


## 文件清单

| 文件 | 内容 |
|---|---|
| `device-test-log.md` | 十条用例的步骤/观测/判定、坐标换算、五条关键观察 |
| `not-performed.md` | 6 类未成立项 + 理由 + 替代证据 |
| `idb-state-loss-observation.md` | IDB 内容丢失的时间线与候选假设（不结论） |
| `apk-hash.txt` / `production-source-hashes.txt` / `git-head.txt` / `run-started-at.txt` | 构建与源码身份 |
| `apk-assets-byte-compare.txt` | APK 内 Web 资源 ↔ 源码逐字节结果 |
| `device-exports/` | 两个设备导出 JSON 副本 + 现场截图 |
| `idb-state-before-failed-import.json` / `idb-state-after-failed-import.json` | 失败导入前后 IDB 原始字节（sha256 相同 = 零副作用） |
| `device-artifacts-hashes.txt` | 上述证据的 sha256 清单 |

## 本轮新增的工作区文件（未提交）

- `scripts/idb-state-hash.py` —— 读设备 WebView IDB `kv/state` 原始 JSON 的 sha256 + 字节数；`IDB_RAW_OUT=<path>` 可落盘供 `cmp` 逐字节比对。副作用类断言一律用它，别对比内存态。
- 真机操作经验沉淀为技能：`~/.workbuddy/skills/android-webview-device-test/SKILL.md`。

## 复现要点

1. 装隔离包 `space.alliswell.inbox.exportrecheck`；`am start -n space.alliswell.inbox.exportrecheck/space.alliswell.inbox.MainActivity`。
2. `adb forward tcp:9223 localabstract:webview_devtools_remote_$(adb shell pidof …)`（**进程重启后必须重建**；屏幕熄灭时 devtools 会挂起，先 `input keyevent KEYCODE_WAKEUP` + `wm dismiss-keyguard` + `svc power stayon usb`）。
3. 合成数据写入 **IDB**（`attention-inbox`/kv/`state`），不要写 localStorage 镜像。
4. 文件选择器只能由**真实 `input tap`** 唤起；坐标 = `(css_x*3, 120+css_y*3)`，CSS 坐标从 CDP `getBoundingClientRect()` 取。
5. 副作用度量一律用 `scripts/idb-state-hash.py`（IDB 原始字节哈希 + `cmp` 逐字节），不要对比内存态（含 `ui.*` 运行态字段会漂）。
