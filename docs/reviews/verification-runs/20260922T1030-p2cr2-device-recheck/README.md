# P2-C-R2 真机复验（设备接回后补跑）

- run：`20260922T1030-p2cr2-device-recheck`
- 身份：**实施方**（本轮的设备侧复验），**非独立验收方**
- 上游 run：`20260922T0055-p2cr-mirror-failclosed`（修复轮，其真机部分原记 NOT_PERFORMED）
- 触发：裁决的推进顺序 ① —— P2-C-R 修复后需在真机上复验；修复轮构建完成时设备离线，故本轮补跑
- 设备：`QSKFAE95CQEUJZ8L`（PKC130 / ColorOS，Android 16，1080×2376 @560dpi，override 480）

## 0. 一句话结论

**在真机上，修复成立。**

1. 多轮 `force-stop → 冷启动` 后，权威记录的**记录级内容哈希逐字节不变**（`0625aacabcd5068a`），
   未被空快照覆盖；每次冷启动在 WAL 上只追加一条 **`count=0` 的空 WriteBatch**（零键操作、序号不前进）。
2. 制造「权威存储打不开」后，修复包判 **`failed`**、**关写闸门**、**显示恢复面板**、
   **不生成待回放凭据**；同一个故障打在修复前候选上，判的是 **`loaded` + `writesAllowed=true` +
   生成待回放凭据** —— 这就是被修掉的那条链，真机上两次都能复现。
3. 复原后两个 leveldb 目录**逐文件逐字节一致**，`CURRENT` 回到 `MANIFEST-000001`，
   再启动两次均 `loaded / authoritative`、内容哈希仍是 `0625aacabcd5068a`。

同时**修正了一条假红的判据**（见 §3.3）：不能拿「WAL 字节数增长」当「产生了提交」的代理，
leveldb 每次打开都会追加一条 19 字节的无害标记。

## 1. 交付身份与等价性

| 项 | 值 |
|---|---|
| HEAD | `3574824357dc7beb04cbd3e32aa413cd508e8484`（未提交、未推送，工作区保持脏条目交付状态） |
| 被测候选 APK | `releases/candidates/20260922T0055-p2cr-mirror-failclosed/attention-inbox-…-debug.apk` |
| 候选 SHA-256 | `62e5c876d4e1b9d707369c79f72631e3f51e76840070cf65fb3936c518191b4f` |
| 对照（修复前）APK | `releases/candidates/20260921T2355-p2cr-authority-gate/attention-inbox-…-debug.apk` |
| 对照 SHA-256 | `314321a20a705a91c6b0e23205a8e2021febd3e55fc8d0002bfa56c44785a4b5` |
| 包名 / versionCode | `space.alliswell.inbox.exportrecheck` / 2（隔离验证包，避免污染真实包） |

**与源码的等价性**：本轮开工时对 9 个生产/测试文件逐个重算 sha256，与修复轮
`production-source-hashes.txt` 的记录**逐字节相同**（`production-source-hashes.txt` 已在修复轮归档）。
两个 APK 也都是从同一份源码构建的产物（修复轮的 `apk-assets-byte-compare.txt` 证明包内 22 个
仓库资源与源码一致），因此本轮真机结论对应的是**当前工作区源码**。

## 2. 复验协议

判据分三层，各管一段，不互相冒充：

| 层 | 工具 | 回答什么 | 只在什么时候能采 |
|---|---|---|---|
| **记录级内容** | `scripts/idb-state-hash.py` | 权威记录**内容**有没有变（内容判据） | 进程活着（需要 JS 引擎） |
| **文件级目录** | `scripts/verification/device-storage-hash.sh` | 死亡窗口内**有没有写入者**（不是内容判据） | 与进程生死无关 |
| **WAL 追加记录** | `scripts/verification/idb-wal-delta.py` | 这次启动**到底写了几个键**（提交判据） | 与进程生死无关 |

每轮三时点：

- **A（启动前，进程活着）**：记录级哈希 `R_A` + 页面判定；
- **B（进程死亡后、尚未启动）**：文件哈希两次（间隔 3 s）⇒ 必须相同（死亡窗口静止）；
- **C（启动恢复完成后）**：记录级哈希 `R_C` + 页面判定 + WAL 追加记录解析。

**通过判据**：`R_A == R_C` 且 WAL 追加记录 `OPS=0` 且页面判定为 `loaded / authoritative`、
`writesAllowed=true`、`blockedWriteCount=0`、`nativeBlocked=0`。

## 3. 结果

### 3.1 包身份：是覆盖安装，不是重装、不是清数据

```
codePath=/data/app/~~9r8qXxt-…==/space.alliswell.inbox.exportrecheck-WkKGOQ4TpsupqinfDDuYqg==
versionCode=2  versionName=1.1
firstInstallTime=2026-09-21 16:10:02      ← 首装时间戳**没变**
lastUpdateTime=2026-09-22 10:48:19        ← 只更新了这一项（本轮装回的修复包）
dataDir=/data/user/0/space.alliswell.inbox.exportrecheck
```

`firstInstallTime` 全过程不变 ⇒ 数据目录未被重建；`-r -d` 覆盖安装未清数据。
原始输出：`package-identity.txt`（首次装修复包）、`package-identity-final.txt`（全部跑完后）。

### 3.2 多轮冷启动：内容零变化

`scripts/verification/p2cr-coldstart-rounds.sh` 跑 3 轮（原始输出 `device-coldstart-rounds.txt`）：

| 轮次 | B 窗口（死 3 s × 2 次） | 记录级哈希 A → C | WAL 追加记录 | 页面判定 |
|---|---|---|---|---|
| 1 | ✓ 静止 | `0625aacabcd5068a` → 同值 | `EMPTY_MARKER` `OPS=0` `SEQ=548` | `loaded/authoritative`，`writesAllowed=true`，`blockedWriteCount=0` |
| 2 | ✓ 静止 | 同值 | `EMPTY_MARKER` `OPS=0` `SEQ=548` | 同上 |
| 3 | ✓ 静止 | 同值 | `EMPTY_MARKER` `OPS=0` `SEQ=548` | 同上 |

每轮页面判定（逐字节来自设备）：

```json
{"items":2,"projects":1,"title":"P2C 复验事项","status":"loaded","reason":"authoritative",
 "backend":"idb","writesAllowed":true,"blockedWriteCount":0,"nativeBlocked":0,
 "mirrorLen":2443,"mirrorSha16":"0625aacabcd5068a","panel":false}
```

镜像内容哈希 `mirrorSha16` 与权威内容哈希**同值**，且三时点不变 ⇒ 镜像没有被改写、也没有被升格。

### 3.3 ⚠️ 本轮的方法论修正：字节增长不是提交判据

第一遍跑出的是 `OVERALL=FAIL`，理由是「第 2/3 轮 WAL 仍增长 +19 B」。
原始输出保留在 `device-coldstart-rounds-BYTE-PROXY-falsepositive.txt`，**不改写**。

把那条追加记录（19 字节）逐字节解开：

```
fd8aab6a 0c00 01 | 24 02 00 00 00 00 00 00 | 00 00 00 00
   crc32c  len  type      seq = 548            count = 0
```

即一条 **`count=0` 的空 WriteBatch**（7 B 日志头 + 12 B 载荷 = 19 B，leveldb 可能的最小记录）。
它的语义是「一个键都没碰」：

- **`count=0`** ⇒ 零 put / 零 delete；
- **`seq=548` 不前移** ⇒ 全库序号没动，也不作废任何快照；
- 同一条 WAL 里还有 **13 条更早的同型空标记**（`seq` 各不相同：140/152/212/248/260/272/284/296/392/416/428/440/452）
  ⇒ 这是**长期存在的 leveldb 行为**（`reuse_logs` 恢复路径上的「日志已复用、恢复点在此」标记），
  不是本轮改动引入的；它每次数据库打开追加一次；
- **`indexedDB` 语义上它等于「什么都没发生」**。

旁证：在进程不重启的前提下 `Page.reload`（重建 IndexedDB 连接但 leveldb 仍由浏览器进程持有）
**WAL 零变化**（`DELTA_BYTES=0`）⇒ 该标记跟的是 **leveldb 打开**，不是页面/应用启动。

修正后的判据是**解析追加记录的 WriteBatch 操作条数 `OPS`**：`OPS>0` 才算产生提交。
重跑 3 轮：`OVERALL=PASS`（`device-coldstart-rounds.txt`，逐轮报告 `wal-delta-round-1/2/3.txt`）。

### 3.4 修复前 vs 修复后的真机签名对照

| | 修复前（`20260921T2355`） | 修复后（本轮） |
|---|---|---|
| 每次冷启动的 WAL 追加 | **+3276 B = 2 × 1638 B**，是 `count=2` 的**真实 put**（状态 JSON 被写回同值） | 19 B，`count=0` 空标记，**零操作** |
| 记录级内容 | 不变（所以只看内容看不出问题） | 不变 |

修复前那条签名的完整机理见 `../20260921T2355-p2cr-authority-gate/blocker-mechanism.md`（含注入钩子与
调试器异步调用栈逐帧指认）。

### 3.5 WAL 判据的牙齿（用真机历史字节做的对照）

判据能不能红，不能靠嘴说。用**同一条真机 WAL 里两条真实写批量**做对照输入
（`scripts/verification/idb-wal-delta.py`）：

| 对照输入 | 真实语义 | 工具输出 | 退出码 |
|---|---|---|---|
| 偏移 132907 起的批量 | `count=5`：含 `state` 值 2141 B 等真实 put | `RECORD_KIND=OPS` `OPS=5` | **2（判红）** |
| 偏移 137462 起的批量 | `count=4`：全部是 delete | `RECORD_KIND=OPS` `OPS=4` | **2（判红）** |
| 冷启动追加的那条 | `count=0` 空标记 | `RECORD_KIND=EMPTY_MARKER` `OPS=0` | 0 |

⇒ 修复前那种「写回同值」的提交（`count≥1`）在这套判据下**照样报红**。

### 3.6 终止方式（原始输出 `device-kill-modes.txt`）

| 方式 | 结果 | 证据 |
|---|---|---|
| 内核 SIGKILL（`run-as <pkg> kill -9`） | **PASS** | 终止生效（`pid-after-kill=[]`）；死亡窗口静止；记录级哈希 A==C = `0625aacabcd5068a`；事件后判定 `loaded/authoritative` |
| 后台回收（HOME + `am kill`） | **NOT_PERFORMED** | `am kill` 拒绝执行，进程仍活（`pid-after-kill=[6641]`）。实测取证：应用持有到自身 WebView renderer 的绑定 `ServiceRecord{… SandboxedProcessService0:0}` / `ConnectionRecord{… flags=0x80000041}`（BIND_IMPORTANT｜BIND_AUTO_CREATE），AMS 视其为「不可安全杀」。等价路径由内核 SIGKILL 覆盖（LMK 的终止手段同样是 SIGKILL） |

脚本已改为：终止未生效记 `MODE=NOT_PERFORMED` 而**不是** FAIL —— 「没造出来」与「没通过」是两件事，
但 `NOT_PERFORMED` 计数照实打印（`EXECUTED=2 NOT_PERFORMED=1`）。

### 3.7 真机 IDB 故障注入：fail-closed A/B（本轮最有分量的一组）

前一轮把「真机 IDB 故障注入」记为 NOT_PERFORMED，理由是「不改 APK 就注入不了 WebView 层的故障」。
本轮换了一条**更朴素也更贴近真实故障**的路线：**直接破坏磁盘上的 leveldb 目录** ——
把 `CURRENT`（原本指向 `MANIFEST-000001`）改成指向不存在的 `MANIFEST-000099`，leveldb 打开即失败。
**APK 一个字节没改 ⇒ 与源码的等价性不受影响**；只动 `CURRENT` 一个文件，
`000003.log`（真正装数据的那份）一个字节没碰，所以事后可完全复原。

```bash
bash scripts/verification/p2cr-idb-fault-inject.sh backup  /tmp/p2cr2-backup/idb
IDB_DIR="…/Local Storage/leveldb" bash scripts/verification/p2cr-idb-fault-inject.sh backup /tmp/p2cr2-backup/mirror
bash scripts/verification/p2cr-idb-fault-inject.sh corrupt      # CURRENT -> MANIFEST-000099
# …冷启动 + 取证…
bash scripts/verification/p2cr-idb-fault-inject.sh restore /tmp/p2cr2-backup/idb
bash scripts/verification/p2cr-idb-fault-inject.sh verify  /tmp/p2cr2-backup/idb
```

**同一个注入，两个包，两次都跑**（`fault-injection/` 目录）：

| 观测量 | 修复前 `314321a2…` | 修复后 `62e5c876…` |
|---|---|---|
| `status` | **`loaded`** | **`failed`** |
| `reason` | `degraded-mirror` | `degraded-mirror-unconfirmed-authority` |
| `writesAllowed` | **`true`**（写闸门开着） | **`false`**（写闸门关着） |
| 恢复面板 | 无（`panelPresent=false`） | **有且可见**（`panelHidden=false`，文案见下） |
| 待回放凭据 | **已生成**：`attention-inbox-v2-pending-replay`（2809 字符） | **无**（`pendingReplay=null`） |
| 调一次 `saveAsync()` | **不抛错**（真的走完了保存） | **抛错** `state-authority-failed`，`blockedWriteCount` 0 → **1** |
| 只读可见性 | 2 条事项、标题 `P2C 复验事项` | 2 条事项、标题 `P2C 复验事项`（只读仍可见） |

原始输出：`fault-injection/PRE-R2-faulted-state.txt`、`fault-injection/R2-faulted-state.txt`。
观察脚本 `scripts/verification/p2cr-failure-state-probe.py`（它会**真的调一次 `saveAsync()`**，
「不许写」必须用一次真写去顶，不能只看状态位）。

修复后的恢复面板是**用户可见**的（`panelHidden=false`），文案：

> 数据没有恢复成功，应用暂未启动本机数据的权威状态没能确认（第 1 次尝试）。
> 原因：degraded-mirror-unconfirmed-authority。为免覆盖本机已有数据，这次没有写入任何内容，
> 也没有安排提醒或启动后台心跳。本机旧数据仍在原处，重试成功后照常进入应用。［重试恢复］［重新加载］

**复原与回归**：

| 步骤 | 结果 |
|---|---|
| 复原 IDB 目录后（进程已停）逐文件核对 | **VERIFY=PASS**（5/5 文件逐字节一致） |
| 复原镜像目录后逐文件核对 | **VERIFY=PASS**（5/5） |
| `CURRENT` | `MANIFEST-000001` ✔（损坏已撤销） |
| 复原后第 1 次冷启动 | `loaded / authoritative / idb`，`writesAllowed=true`，无面板，**无待回放凭据**，内容哈希 `0625aacabcd5068a`，2 条事项 |
| 复原后第 2 次冷启动 | 同上（`reason=authoritative`） |

⇒ 修复前那次注入**真的留下了授权书**（`attention-inbox-v2-pending-replay`，2809 字符 = 「下次启动无条件覆盖权威」）。
这份凭据在复原时随镜像目录一起被还原掉；**修复后的包在同样故障下不会生成它** —— 这正是被修掉的窗口。

## 4. 什么**没有**被这组证据证明

- **「空镜像 + 空内存」的破坏性变体没有在真机上制造**：本轮的注入只让权威打不开，
  镜像本身是好的（`mirrorLen=2443`），所以内存里留下了可只读的旧数据。
  要复现「IDB 1/1 → 0/0」还要**同时**把镜像清空 —— 那会真的让测试机数据归零，
  不在真机上做；该变体由离线永久反例 B6（`get`/`open` 两种故障 × 双启动）与 M12 变异覆盖。
- 修复前那次注入**之后**如果让镜像目录先复原、权威仍坏着再启动，凭证会在下一次健康启动被回放 ——
  本轮没有专门去跑这条时序（内容同值，观测不到数据差异，价值低）。
- 本轮不构成独立验收：同一份判据需要独立方复跑。

## 5. NOT_PERFORMED（本轮）

见 `not-performed.md`。摘要：后台回收终止（AMS 拒绝）、WebView 层 JS 注入（须改包）、
破坏性空镜像变体、导入格式安全面（按裁决顺延）、提交推送（保持脏工作区交付）。

## 6. 文件清单

| 文件 | 内容 |
|---|---|
| `run-started-at.txt` / `git-head.txt` / `apk-hash.txt` / `production-source-hashes.txt` | 身份 |
| `install-output.txt` / `package-identity.txt` / `package-identity-final.txt` | 装包与包身份 |
| `device-storage-A-preinstall.txt` / `-B-postinstall.txt` / `-FINAL.txt` | 目录级快照（文件数/字节/串接哈希） |
| `device-wal-A-preinstall.txt` / `-B-postinstall.txt` / `-FINAL.txt` | 逐文件字节（含 WAL 实际大小） |
| `idb-record-A-preinstall.txt` / `state-raw-preinstall.json` | 装包前的权威记录内容（**旧构建**写入的那份） |
| `device-coldstart-rounds.txt` / `wal-delta-round-1..3.txt` | 多轮冷启动三时点 + WAL 判据 |
| `device-coldstart-rounds-BYTE-PROXY-falsepositive.txt` | **假红原始输出（保留不改写）** |
| `device-kill-modes.txt` | 终止方式 + AMS 绑定取证 |
| `fault-injection/prefault-*.txt`、`prefault-*.log` | 注入前的目录清单与两份 `000003.log`（可复原凭据） |
| `fault-injection/PRE-R2-faulted-state.txt` / `R2-faulted-state.txt` | 同一注入下的 A/B |
| `fault-injection/restore-verify.txt` | 复原后逐字节核对 |
| `fault-injection/R2-after-restore.txt` / `-2nd-boot.txt` | 复原后两次冷启动 |
| `device-artifacts-hashes.txt` | 本轮所有设备侧产物的哈希清单 |

## 7. 下一步（按裁决的推进顺序）

1. 独立方用**同一份协议**复验本轮（关键是 §3.7 的注入路线与 §3.3 的 `OPS` 判据）；
2. 通过后进入「导入格式安全面」；
3. 再独立复验 P2-C；4. 冻结可复算 checkpoint；5. P2-D。
