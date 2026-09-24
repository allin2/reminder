# 真机用例逐条记录 · P2-C-R

> 纪律：每条给出**步骤 → 观测量 → 判定**。判据只用可复算事实（记录级哈希 / 磁盘文件哈希 / `pid` / 页面判定），
> 不用「看起来对」。三类证据的区别见 `README.md`「真机复验协议」。

## 用例 0：安装候选后首次冷启动

- 步骤：设备上原为上一批 P2-C 包（数据 1/1）→ `adb install -r -d 候选` → 冷启动 → 读判定。
- 观测量：
  - 安装前 IDB 目录 `IDB_FILES=5 IDB_BYTES=49149 IDB_SHA256=87462b51…`；
  - 安装后未启动 `IDB_FILES=5 IDB_BYTES=49149 IDB_SHA256=87462b51…`（**与安装前逐字节相同 ⇒ 安装没动数据**）；
  - 恢复完成后页面判定 `{"items":1,"projects":1,"title":"P2C 复验事项","status":"loaded","reason":"authoritative","backend":"idb","writesAllowed":true,"blockedWriteCount":0,"panel":false}`。
- 判定：**PASS**（数据跨安装保留；恢复判定为「从权威读到」）。
- 证据：`device-storage-A-preinstall.txt`、`device-storage-B-postinstall.txt`、`device-storage-C-firststart.txt`。

## 用例 1：`force-stop → 冷启动` 三时点（3 轮）

- 步骤：`p2cr-coldstart-rounds.sh <run> 3`。每轮 A（活着）/B（死、未启动，隔 3 s 采两次）/C（恢复完成）。
- 观测量：

| 轮 | A 记录级哈希 | C 记录级哈希 | 死亡窗口两次文件哈希 | 单轮判定 |
|---|---|---|---|---|
| 1 | `a22c3748c400e643` | `a22c3748c400e643` | 相同 | ✓ |
| 2 | `a22c3748c400e643` | `a22c3748c400e643` | 相同 | ✓ |
| 3 | `a22c3748c400e643` | `a22c3748c400e643` | 相同 | ✓ |

  - 每轮 C 的页面判定都是 `loaded/authoritative/idb`、`writesAllowed=true`、`blockedWriteCount=0`、`panel=false`、`items=1`、`title=P2C 复验事项`。
- 判定：**PASS**（内容零变化；死亡窗口无写入者）。
- 证据：`device-coldstart-rounds.txt`。

## 用例 2：同样两轮 + **镜像核对**（IDB 与 localStorage 都要）

- 步骤：`p2cr-coldstart-rounds.sh <run> 2`（脚本已加「读取重试」与「镜像内容哈希」）。
- 观测量：两轮的页面判定里 `mirrorLen=1638`、`mirrorSha16=a22c3748c400e643`
  —— **镜像内容与 IDB 内容同哈希**；IDB 目录与镜像目录的文件哈希在死亡窗口内两次相同。
  - 镜像的**文件级**哈希每轮都在漂（leveldb 自己的 LOG 在写），**内容级**哈希不变。
- 判定：**PASS**（不只是内存；IDB 与镜像两条都核到了）。
- 证据：`device-coldstart-rounds-2.txt`。

> 记录在案的两个失败尝试（都是**度量工具**的问题，不是被测对象的问题，故保留以示口径）：
> 1. 第 1 次跑 2 轮时 A 时点 CDP 读空 ⇒ 记录级哈希取空 ⇒ 误判 `A!=C`。真因：`adb forward` 指向了重启前的 pid。
>    已给脚本加重试；此后每轮都读到。
> 2. 更早一版用**文件级**哈希判内容，看到 IDB 目录哈希每次启动都变，差点误判为「内容被改」。
>    真因：leveldb 的 `LOG`/`LOG.old` 与 WAL 追加。已改为「内容判据只看记录级哈希」。

## 用例 3：内核 SIGKILL（`run-as kill -9`）

- 步骤：`p2cr-kill-modes.sh <run>` 的 SIGKILL 分支。
- 观测量：A 记录级 `a22c3748c400e643` → 杀后 `pid=[]` → B1==B2（文件哈希相同）→ C 记录级 `a22c3748c400e643`；
  C 判定 `loaded/authoritative`、`writesAllowed=true`、`blockedWriteCount=0`。
- 判定：**PASS**。
- 证据：`device-kill-modes.txt`。

## 用例 4：后台回收（LMK / `am kill`）

- 步骤：HOME 退后台 → 等 5 s（确认前台已是 launcher）→ `am kill --user 0 <pkg>` → 再 `am kill-all`。
- 观测量：`pid` **仍是 11596**（两次都没杀掉）；`dumpsys activity processes` 显示该进程持有与
  WebView sandboxed 进程的连接（`ConnectionRecord … flags=0x80000041`）。
- 判定：**NOT_PERFORMED**（AMS 认为该进程「不可安全杀」）。理由与替代证据见 `not-performed.md` §1。

## 用例 5：桥初始化失败（冷启动）

- 步骤：尝试在冷启动时让原生桥不可用；不做改包的手段均不可构造（见 `not-performed.md` §2）。
- 判定：**NOT_PERFORMED**（真机）。替代证据 = 组合 harness 桥故障注入 8 条断言（`test-boot-combination.js` B5 ⑦）。

## 用例 6：8 秒宽限闸门（假计时器，非真机）

- 步骤：`node test-unit.js` 的 `app-backup — 导出宽限闸门（假计时器：7999 / 8000 ms 与迟到结果）` 段。
- 观测量（全部通过）：7999 ms 不触发 / 8000 ms 触发「保存结果未返回 · 文件状态无法确认，请重试」并恢复按钮 /
  超时后迟到的 `saved` 与 `cancelled` **都不再 toast** / 新一轮导出不受上一轮迟到结果影响 /
  M10（拔掉 stale 判断）与 M11（删掉宽限计时器）**都必须变红**，且各自有「未变异 + 同路径」对照面。
- 判定：**PASS（自动化）**。真机 8 s 真实超时仍为 NOT_PERFORMED（见 `not-performed.md` §3）。

## 用例 7：每轮都观察到的「启动期一次写入」

- 观测量：每轮冷启动 IDB 的 `000003.log` 增长 **+3276 B**（= 2 × 1638，状态 JSON 长度），
  而记录级哈希不变 ⇒ 写回同值。
- 查实（三步，互相独立）：
  1. 注入 `IDBObjectStore.prototype.put` 钩子 ⇒ 启动期**恰好 1 条** `put`（store=kv、key=state、len=1638）；
  2. 调试器断点 + 异步调用栈 ⇒ 调用链 `init → startBusinessStartup → ensureNativeReminders →
     initializeNativeReminders → runUserOp → refreshNativeScheduleBasis → save → writeSnapshot`；
  3. 源码 + 设备字段 ⇒ `migrateItem()` 的 `dismissedUntil` 分支**不幂等**（赋的仍是 `null`），
     所以 `changed` 恒为真，每次启动都提交。
- 判定：**机理确立**（写入者与条件）。这条写入就是旧版「空快照覆盖」的落库路径。
- 证据：`blocker-mechanism.md`。
