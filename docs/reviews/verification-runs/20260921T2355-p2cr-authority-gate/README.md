# Run: 20260921T2355 · P2-C-R 冷启动权威状态保护（阻断项修复 + 真机复验）

- 开始：2026-09-21T23:47+0800；真机复验完成：2026-09-22T00:12+0800
- HEAD：`3574824357dc7beb04cbd3e32aa413cd508e8484`（**未提交未推送**；工作区脏 = 交付身份，112 条）
- 目的：处理上一批真机复验暴露的**阻断项** —— 进程死亡区间内权威状态从 1/1 变 0/0。
  本批做两件事：**① 把加载判定改成三态并加写闸门**；**② 把「谁写掉的」查实**（机理文档）。
- 授权范围：只做 P2-C-R；导入格式安全面**顺延**；E1–E4 不动；不提交不推送。

## 结论（先说判定）

| 项 | 判定 |
|---|---|
| 三态加载 + 写闸门 + 恢复面板（实施） | 自测通过（见"自动化水位"），**待独立复验** |
| 阻断项机理 | **已确立**（`blocker-mechanism.md`：写入者、触发条件、逐帧调用栈） |
| 真机：多轮 `force-stop → 冷启动` 三时点 | **PASS**（1 次安装后首启 + 3 轮 + 2 轮含镜像核对） |
| 真机：内核 SIGKILL | **PASS** |
| 真机：后台回收（LMK/`am kill`） | **NOT_PERFORMED**（AMS 拒绝回收该进程，理由与替代证据见 `not-performed.md`） |
| 真机：桥初始化失败 | **NOT_PERFORMED**（不可在不改包前提下构造）；替代证据 = 组合 harness 桥故障注入（8 条断言） |
| 整体 | **实施方自测通过 + 真机通过；未获独立复验前不宣称收口** |

## 环境与构建身份

| 项 | 值 |
|---|---|
| 设备 | `QSKFAE95CQEUJZ8L` · PKC130（OPPO Find X8 Pro 卫星通信版）· Android 16 · `PKC130_16.0.10.500(CN01)` |
| 被测包 | `space.alliswell.inbox.exportrecheck`（vCode 2 / vName 1.1）<br>`firstInstallTime=2026-09-21 16:10:02`（**未重装**）· `lastUpdateTime=2026-09-21 23:48:42`（本批 `install -r`） |
| 数据目录身份 | `drwx------ u0_a30 u0_a30 /data/data/…exportrecheck`，创建时间 **16:10**（**未被重建 ⇒ 排除清数据**） |
| 生产包 | `space.alliswell.inbox`：`lastUpdateTime=2026-09-20 23:49`（**全程未触碰**） |
| 构建 | JDK17 Temurin；等价 sync 路径（`sync:www` → `cp -R www/. assets/public/` → `gradlew assembleDebug`），**未跑 `cap sync`** |
| 候选 APK | `releases/candidates/20260921T2355-p2cr-authority-gate/attention-inbox-p2cr-authority-gate-debug.apk`<br>sha256 `314321a20a705a91c6b0e23205a8e2021febd3e55fc8d0002bfa56c44785a4b5` |
| APK 内资源一致性 | **22 个 Web 资源与当前源码逐字节一致、双向无缺**（`apk-assets-byte-compare.txt`；收尾时用**收尾版源码**重比一次，仍 22/0/0） |
| tracked debug APK | 构建后按字节还原，`git diff -- android/app/build.gradle` 干净 |

> 等价性前提：APK 内的 Web 资源与仓库源码**逐字节相同** ⇒ 「真机跑的是本批源码」成立。
> 该比对在收尾时**重做过一次**，覆盖了本批收尾阶段的全部源码改动。

## 行为所有权（本批的验证对象）

| 行为 | 持有者 | 验证方式 |
|---|---|---|
| 载入三态判定 `loaded/empty/failed` | `app-core.js` `loadAuthority()` / `publishLoadReport()` | 组合 harness B5（含反例）+ 真机 `stateAuthority()` |
| 写闸门（唯一收口） | `app-core.js` `writeSnapshot()` 首行 `authoritativeWritesAllowed()` | 组合 harness B5「puts=0」类断言 + 真机 `blockedWriteCount` |
| 启动分界：失败即整段跳过 | `init()` → `startBusinessStartup()` | 组合 harness B5（不排钟、不起心跳、无待回放凭据） |
| 可见恢复面板 + 重试 | `renderStateRecovery()` / `retryRestore()` | 组合 harness（面板/仅按钮/重试后 loaded）+ 真机探针读 `panel` |
| 权威后端重开 | `lib/storage.js` `reopen()` | B5「打不开 → 重试必须重新尝试权威后端」 |
| 8 秒宽限闸门（超时分支） | `lib/app-backup.js` `noteExportAppVisibility()` | `test-unit.js` 假计时器 7999/8000 + 迟到结果 + M10/M11 变异 |

## 真机复验协议（三时点）

每轮采三个**与进程生死对应**的时点，两类证据各管一段：

- **记录级哈希**（`scripts/idb-state-hash.py`，直连 IndexedDB 读 `kv/state` 的值字节）＝**内容判据**，只能在进程活着时采；
- **文件级哈希**（`scripts/verification/device-storage-hash.sh`，读磁盘 leveldb 目录）＝**死亡窗口静止判据**，与进程生死无关。

> ⚠️ 度量口径：leveldb 目录的**文件级**哈希**不是内容判据** —— 它包含 leveldb 自己的 `LOG`/`LOG.old`
> （每次开合都变）与 WAL 追加。本批因此把内容判定一律交给**记录级哈希**，文件级只用于「死区间是否静止」。

| 时点 | 含义 | 采什么 |
|---|---|---|
| A | 启动前（进程活着） | 记录级哈希 + 页面判定 + IDB/镜像文件哈希 |
| B | 进程死亡后且尚未启动 | 文件哈希**两次**（间隔 3 s）⇒ 必须相同；`pid` 必须为空 |
| C | 启动恢复完成后 | 记录级哈希 + 页面判定 + IDB/镜像文件哈希 |

**判据**：A == B == C 的记录级哈希（内容零变化）；页面判定必须 `loaded/authoritative/idb`、
`writesAllowed=true`、`blockedWriteCount=0`、`panel=false`；镜像内容哈希也应与 IDB 内容一致。

## 结果明细

见 `device-coldstart-rounds.txt`（3 轮）、`device-coldstart-rounds-2.txt`（2 轮，含镜像）、
`device-storage-C-firststart.txt`（安装后首启）、`device-kill-modes.txt`（SIGKILL）、`device-test-log.md`（逐条）。

- 安装后首启：`loaded/authoritative/idb`，1 项目/1 事项，`blockedWriteCount=0`。
- 3 轮 `force-stop → 冷启动`：**每轮 A==C**，记录级哈希恒为 `a22c3748c400e643`；死亡窗口两次文件哈希相同。
- 2 轮复核（含镜像）：记录级哈希与**镜像内容哈希**每轮都等于 `a22c3748c400e643`。
- SIGKILL（`run-as kill -9`）：A==C，死亡窗口静止。
- **每轮都观察到**：IDB 的 WAL 增长 **+3276 B**（= 2 × 1638），而内容不变 ⇒ 启动期存在一次「写回同值」。
  该写入者已逐帧查实（`blocker-mechanism.md`），是旧版覆盖面的触发点。

## 本批新增/修改的工作区文件（未提交）

- `app-core.js`：三态加载 `loadAuthority()` / `publishLoadReport()`；`writeSnapshot` 写闸门；
  `init()` 拆分为「恢复闸门 + `startBusinessStartup()`」；`renderStateRecovery()`/`retryRestore()`；
  `stateAuthority()` 探针（判定/拦下计数/镜像字节）。
- `lib/storage.js`：新增 `reopen()`（重试时重新尝试打开权威后端）。
- `sw.js`：缓存名 `v13 → v14`（内容变必须换名）。
- `test-boot-combination.js`：新增 B5 段（三态/闸门/面板/重试/镜像迁移/残留证据/脏值/桥故障注入/M9 三道闸门反向对照）。
- `test-unit.js`：新增导出宽限闸门假计时器段（7999/8000、迟到 saved/cancelled、新一轮、M10/M11 变异）。
- 新工具（均可复算）：`scripts/verification/device-storage-hash.sh`、`p2cr-coldstart-rounds.sh`、
  `p2cr-kill-modes.sh`、`idb-write-probe.py`、`idb-write-caller.py`、`scripts/idb-wal-inspect.py`。

## 自动化水位（收尾实测）

| 套件 | 结果 |
|---|---|
| `test-unit.js` | 通过 492 / 失败 0 |
| `test-native-reminders.js` | 通过 321 / 失败 0 |
| `test-boot-combination.js` | 通过 360 / 失败 0 |
| `test-smoke.js` | 通过 257 / 失败 0 |
| `test-regressions.js` | 通过 730 / 失败 0 |
| `scripts/verification/parse-single-source.js` | 通过 160 / 失败 0（单一来源闭合 PASS） |
| 合计 | **2320** |

## 文件清单

| 文件 | 内容 |
|---|---|
| `blocker-mechanism.md` | **阻断项机理**：写入者、触发条件、逐帧调用栈、与时间线的吻合、修复切断在哪一环 |
| `device-test-log.md` | 逐条真机用例的步骤/观测/判定 |
| `not-performed.md` | 未成立项 + 理由 + 替代证据 |
| `device-coldstart-rounds.txt` / `device-coldstart-rounds-2.txt` | 多轮三时点复验原始输出 |
| `device-storage-C-firststart.txt` | 安装后首次冷启动的恢复时点 |
| `device-kill-modes.txt` | SIGKILL / 后台回收两种终止方式 |
| `apk-hash.txt` / `apk-assets-byte-compare.txt` | 候选 APK 身份与 APK↔源码逐字节结果 |
| `package-identity.txt` | 包身份（UID/安装时间/更新时间/数据目录） |
| `production-source-hashes.txt` | 收尾版源码与工具哈希 |
| `device-artifacts-hashes.txt` | 本目录证据文件的 sha256 |

## 复现要点

1. 装候选 APK：`adb install -r -d <候选>`；启动 `space.alliswell.inbox.exportrecheck/space.alliswell.inbox.MainActivity`。
2. 屏幕必须常亮（`svc power stayon usb`）；熄屏会让 WebView devtools 挂起、CDP 读超时。
3. CDP：`adb forward tcp:9223 localabstract:webview_devtools_remote_$(adb shell pidof <pkg>)`
   —— **每次进程重启后都要重建 forward**（否则会误判成「内容变了」；本轮次脚本初版栽过一次，已加重试）。
4. 轮次复验：`bash scripts/verification/p2cr-coldstart-rounds.sh <run目录> <轮数>`。
5. 终止方式：`bash scripts/verification/p2cr-kill-modes.sh <run目录>`。
6. 机理复现：`idb-write-probe.py`（注入 IDB 钩子抓写入者）、`idb-write-caller.py`（断点 + 异步栈抓调用者）。
