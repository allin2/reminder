# 阻断项机理：IDB 1/1 → 0/0 的写入者与触发条件

> 本文件回答的是「P2-C 真机复验中观察到的权威数据消失」**到底是谁写掉的**。
> 结论全部来自设备上的可复算证据（WAL 字节、注入钩子、调试器调用栈）+ 源码逐行核对，
> 不来自推测。**本文件只陈述机理，不宣称缺陷已修复**（修复见 `production-source-hashes.txt`
> 对应的候选，验收归独立复验）。

## 结论（一句话）

**每次冷启动都会执行一次权威提交**，提交者是
`ensureNativeReminders() → initializeNativeReminders() → refreshNativeScheduleBasis() → save()`。
在**没有写闸门**的旧实现里，这次提交会把**当时内存里的状态**写进 IndexedDB ——
只要那一次启动的权威读取静默失败（`loadAsync()` 返回 `false`，内存停在默认空态），
这次提交就把 1/1 换成 0/0。这就是观察到的丢失。

## 证据链

### ① 每次冷启动，leveldb WAL 都增长 3276 B（= 2 × 状态 JSON 长度）

`force-stop → 冷启动` 连续三轮，`000003.log` 字节数：

| 轮次 | 冷启动后 WAL 字节 | 增量 |
|---|---|---|
| 安装后首次 | 55701 | +3276（相对 52425） |
| round 1 C | 55701 | — |
| round 2 C | 58977 | **+3276** |
| round 3 C | 62253 | **+3276** |

同期的**记录级哈希恒定**（`a22c3748c400e643`，见 `device-coldstart-rounds.txt`）⇒
写进去的**内容相同**，只是每次都写。增长全部落在 WAL，`MANIFEST`/`CURRENT` 未变。

> 注意：leveldb 目录的**文件级**哈希不是内容判据 —— 它包含 leveldb 自己的 `LOG`/`LOG.old`
> （每次开合都变）与 WAL 追加。所以本 run 用**记录级哈希**判内容、**文件级哈希**只判
> 「死亡窗口是否静止」。这一条是上一轮踩过的度量口径教训的延伸。

### ② 注入钩子：启动期**恰好一次** `put`，写的是完整状态

`Page.addScriptToEvaluateOnNewDocument` 在页面脚本求值前包裹
`IDBObjectStore.prototype.put`，随后 `Page.reload`（工具：`scripts/verification/idb-write-probe.py`）：

```
=== 启动期 IDB 写入记录：1 条 ===
[0] put store=kv key=state len=1638 keys=['schema','items','notes','projects','settings']
      at proto.put (<anonymous>)
      at idbSet        https://localhost/lib/storage.js:52
      at Object.save   https://localhost/lib/storage.js:145
      at async writeSnapshot https://localhost/app-core.js:1251
```

同一次重载前后 WAL：64698 → 67962（+3264）。

### ③ 调试器断点 + 异步调用栈：调用者逐帧指认

`Error().stack` 在 `async` 边界被截断，改用 `Debugger.setBreakpointByUrl`
（app-core.js:1251 权威提交行）+ `Debugger.setAsyncCallStackDepth`
（工具：`scripts/verification/idb-write-caller.py`）：

```
  #0 writeSnapshot                app-core.js:1251
  #1 invoke                       app-core.js:1365
  ~async[0] Promise.then
      runCommit                   app-core.js:1367
      saveAsync                   app-core.js:1380
      save                        app-core.js:1406
      refreshNativeScheduleBasis  app-core.js:5201   ← if (changed) save();
      runUserOp                   app-core.js:1479
      initializeNativeReminders   app-core.js:6931
  ~async[1] await
      ensureNativeReminders       app-core.js:5560
      startBusinessStartup        app-core.js:8491
      init                        app-core.js:8476
```

### ④ `changed` 为什么恒为真：迁移判定不幂等

`refreshNativeScheduleBasis()`（app-core.js:5195-5203）只在
`NativeReminders.migrateItem(it)` 返回真时才保存；而
`lib/native-reminders.js:228-231`：

```js
if (item.dismissedUntil == null) {
  item.dismissedUntil = null;   // 赋的仍然是 null
  changed = true;               // ⇒ 下一次调用仍然 == null，仍然 true
}
```

赋值后依然满足 `== null`，所以**该分支永远成立**，`migrateItem` 对同一份
已被迁移过的数据仍返回 `true`。设备侧实测该事项确实带这个字段且值为 `null`：

```
dismissedUntil: null, hasKey: true, scheduleBasis: "wall-clock"
```

⇒ 每次冷启动 `changed` 都为真 ⇒ 每次都 `save()`。

## 与观察时间线的吻合

`idb-state-loss-observation.md` 记录的是：进程死亡（约 16:20）→ 约 7 小时后冷启动 →
16:16 的导出证明当时 IDB 为 1/1，23:12 直读为 0/0。

按上链，那次冷启动只要权威读取没有成功返回（返回 `null` / 抛错 / 后端降级），
内存就是默认空态；随后 `refreshNativeScheduleBasis` 的这次提交
**在没有闸门的旧实现里会照常落库**，1/1 即被 0/0 取代。
—— 这是**唯一**需要成立的额外前提（「那次读取没成功」），而它正是本轮要防的那件事本身；
其余环节全部由 ①②③④ 逐字节/逐帧证实，无推测成分。

## 修复后，这条链被切断在哪一环

| 环节 | 修复前 | 修复后（本候选） |
|---|---|---|
| 读取判定 | `loadAsync()` 折叠成 `false`，`init()` 忽略返回值 | 三态 `loaded/empty/failed`，`init()` 检查 |
| 失败时的业务启动 | 照常 `bind()`/排钟/心跳 | **整段跳过**，只显示恢复面板 |
| 提交 | 无条件落库（内存是空态也落） | `writeSnapshot` 首行闸门：`!authoritativeWritesAllowed()` ⇒ 计数并抛 `state-authority-blocked`，**不落库、不落镜像、不留待回放凭据** |
| 失败时的镜像 | 照写 + 留待回放凭据 ⇒ 下次启动被重放回健康 IDB | 闸门内同样不写 ⇒ 不存在「下次启动再覆盖一次」的第二段 |

真机已验：安装候选后冷启动，判定为 `loaded / authoritative / idb`，
`writesAllowed=true`、`blockedWriteCount=0`，记录级哈希跨 3 轮恒定。

## 遗留（需裁决，本轮**未动**）

`migrateItem` 不幂等这条**本身**没修（属于行为/语义变更，不在本轮授权范围）。它的可观测后果：

1. 每次冷启动都产生一次**无意义的权威提交**（WAL 每次 +3276 B，永不回收）；
2. 该提交未带 `deferNativeSync`，因此每次冷启动都 `bumpNativeSyncVersion()` +
   `queueNativeReminderSync("save")` —— **每启动一次就多请求一轮原生对账**。

在有闸门的现在它不再危及数据（写的是同一份正确状态），但「每次启动都写一次权威存储」
本身就是危险面的扩张：**任何一次启动期的判定失误都会被立刻落库**。
建议单独立项裁决是否把该迁移判定改为幂等（并补一条「连续两次冷启动的第二轮不应产生提交」的断言）。
