# P2-C-R2：陈旧镜像不得覆盖权威（独立复验 FAIL 的修复轮）

- run：`20260922T0055-p2cr-mirror-failclosed`
- 身份：**实施方**（本轮修复 + 自测 + 真机复验准备），非独立验收方
- 触发：`20260922T001914-independent-p2cr-recheck` 判定 **FAIL / FIX_REQUIRED**
- 状态：**修复完成 + 自测通过（待独立复验）**；真机部分因设备离线 **NOT_PERFORMED**

## 1. 上一收获点名的四点，逐条结果

| 要求 | 结果 | 落点 |
|---|---|---|
| ① 权威读取失败时镜像保持只读/失败态 | **已修** | `app-core.js` 两条升格路径改为 fail closed |
| ② 未确认镜像不得生成 pending replay | **已修** | `markPendingReplay()` 自己认来源（第二道） |
| ③ 修正 `dismissedUntil:null` 的幂等判定 | **已修** | `lib/native-reminders.js:migrateItem()` |
| ④ 两启动分叉加入永久反例 + 变异对照 | **已加** | `test-boot-combination.js` B6 段（含 M12 变异） |

## 2. 根因与修复

### 2.1 根因：两条「陈旧镜像 → 可写权威」的升格路径

`lib/storage.js` 的契约写明 `backend=idb` 时 IndexedDB 是权威、localStorage 只是镜像，
但 `loadAsync()` 在两条「这一轮权威没有真正读成功」的路径上把镜像提升为 `LOAD_LOADED`：

1. **`get` 失败**：`storage.load()` 抛错 → `recoverFromMirror()` 拿到旧镜像 → 判 `loaded`
   （旧 reason：`mirror-recovered`）。此时 `storage.backend` 已经是 `idb`，
   只看 backend 的 `authoritativeBackendMissing()` **认不出来**。
2. **`open` 失败**：`ensure()` 把后端整体降为 `local`，`load()` 从镜像读出一个对象 → 判 `loaded`
   （旧 reason：`degraded-mirror`）。

`authoritativeWritesAllowed()` 只看 `loaded/empty` ⇒ 两条路径都放行保存、原生对账、15 秒心跳；
用户在降级界面做一次正常保存 ⇒ 留下 `attention-inbox-v2-pending-replay` ⇒
**下一次健康启动时 `replayPendingSnapshot()` 优先回放这份旧快照并写回 IDB** ⇒ 更新的权威数据被覆盖。

修复：新增 `idbIsAvailable()` 判据（区别于只看 backend 的 `authoritativeBackendMissing()`）——
**设备上存在 IndexedDB 而这一轮没能真正用上它 ⇒ 只能判 `failed`**；
设备根本没有 IDB 时 localStorage 本身就是权威（`lib/storage.js` 的后端契约），照旧 `loaded`。
新的失败原因：`mirror-recovered-unconfirmed-authority` / `degraded-mirror-unconfirmed-authority`。

内存里仍会留下镜像内容供**只读查看**（这是前一版就有的用户可见行为），但不判 loaded、不开写闸门、
不启业务；恢复面板照常抢占容器且不放任何可编辑控件。

### 2.2 第二道防线：待回放凭据自己认来源

写闸门在 `writeSnapshot()` 首行，但它只守「不满足条件不许写」。凭据的性质不同 ——
它是**「下一次启动无条件覆盖权威」的授权书**，所以生成点自己也必须认得来源：

```js
function markPendingReplay(json) {
  if (!authoritativeWritesAllowed() || stateCameFromMirror()) { /* 记日志并拒绝 */ return; }
  …
}
```

保留健康语义：权威成功读到对象 ⇒ `loaded`；权威成功读到空且无任何残留 ⇒ `empty`；
设备无 IDB 时 localStorage 作为权威的降级写入仍可正常落盘。

### 2.3 迁移幂等：修掉每轮冷启动的那次无意义提交

```js
// 旧：赋回同一个 null，条件下次仍成立 ⇒ changed 恒真
if (item.dismissedUntil == null) { item.dismissedUntil = null; changed = true; }
// 新：只有字段**不在**对象上时才补默认值
if (!("dismissedUntil" in item) || item.dismissedUntil === undefined) { item.dismissedUntil = null; changed = true; }
```

这条是上一轮「每次冷启动都产生一次权威提交」（WAL 每轮 +3276 B）的实际成因。

## 3. 自测证据

### 3.1 独立复验方那两个探针，逐条理反跑

| 探针 | 修复前 | 修复后 |
|---|---|---|
| `evidence/stale-mirror-two-boot-probe.js` | `BLOCKER_REPRODUCED`（get / open 两种故障都成立） | **`PROBE_DID_NOT_REPRODUCE`**（exit 1，两种故障的 3 项检查全 false） |
| `migrateItem` 幂等（对齐其判据） | `result=true`、字节不变（`pass=false`） | **`result=false`、`second=false`、字节不变（`pass=true`，exit 0）** |

原始结果：`probe-rerun-two-boot.json` / `probe-rerun-two-boot.exit`、`probe-rerun-migrate-idempotence.json` / `.exit`。

### 3.2 永久反例（B6 段，24 条，全部加入 `npm test`）

「权威两条（`mirror-old` + `idb-new`）/ 镜像一条（`mirror-old` 旧版）」双启动，分别注入 `get` 失败与 `open` 失败：

- 第一轮 ⇒ `failed` + `writesAllowed=false` + 无 15 秒心跳 + `puts=0` + IDB 两条未动；
- 用户硬要 `saveAsync()` ⇒ `state-authority-blocked`，**没有**留下待回放凭据；
- 第二轮（健康 IDB + 上一轮 carry 出来的 localStorage）⇒ `loaded/authoritative`，**仍是两条**，
  `idb-new` 没有被旧镜像覆盖。

对照面（防止「一律失败」蒙混过关）：权威读得到时镜像被忽略仍判 `loaded/authoritative`；
权威读到**空**而镜像有值时仍走既有的「迁移进权威」语义。

### 3.3 变异对照（拔掉修复必变红）

- **M12**（B6 内）：把两条升格路径拧回 `LOAD_LOADED` 并拆掉凭据来源守卫 ⇒
  双启动覆盖**重新出现**：第一次 `ready=true` + `writesAllowed=true` + 心跳起来，
  保存留下待回放凭据，第二次健康启动 report reason `pending-replay`、两条变一条。
  补丁三处命中、行数不变，工作区 `app-core.js` 逐字节复核未被改写。
- **M9**（B5 内）同步扩展：上一轮只拔三道闸门已不够 —— 新增的凭据守卫也会挡住那条链，
  现改为拔四道，变异上下文仍然成立。
- **迁移幂等变异**：把 `migrateItem` 改回 `== null` 后实跑 ⇒
  `test-native-reminders.js` 2 条变红（322/324）、`test-boot-combination.js` 1 条变红
  （「连续第二次冷启动不再产生任何提交」puts=1）；按字节还原（sha256 `723f218c…`）后回绿。

### 3.4 水位

| 套件 | 通过 | 失败 |
|---|---|---|
| `test-unit.js` | 492 | 0 |
| `test-native-reminders.js` | **324**（+3 幂等） | 0 |
| `test-boot-combination.js` | **384**（+24，B6） | 0 |
| `test-smoke.js` | 257 | 0 |
| `test-regressions.js` | 730 | 0 |
| `parse-single-source.js` | 160 | 0 |
| **合计 `npm test`** | **2347** | **0** |
| UI 格式对照 | 567 项一致 | 0 |
| UI DOM 对照 | 16 场景 / 590 字段一致 | 0 |
| Chrome 生产组合（真实 headless Chrome） | 12 用例 | 0 |

SW 缓存版本 v14 → **v15**（内容变了必须换名）。

## 4. 交付身份

- HEAD `3574824357dc7beb04cbd3e32aa413cd508e8484`；未提交、未推送。
- 候选 APK（仅用于隔离包验证）：`releases/candidates/20260922T0055-p2cr-mirror-failclosed/`，
  SHA-256 `62e5c876d4e1b9d707369c79f72631e3f51e76840070cf65fb3936c518191b4f`。
- APK 内 22 个仓库 Web 资源与**当前源码逐字节一致**（`apk-assets-byte-compare.txt`）；
  `cordova.js` / `cordova_plugins.js` 是构建生成文件，仓库无对应源文件。
- `releases/安心收件箱-debug.apk`（tracked）构建后按字节还原：`378ee91e…`。
- `android/app/build.gradle` 的 applicationId 已还原为 `space.alliswell.inbox`（`git diff` 为空）。

## 5. NOT_PERFORMED

见 `not-performed.md`。最要紧的一条：**本轮真机复验没有做** —— 开始时有设备，
执行到构建完成时 `adb devices` 已为空列表、USB 枚举无 Android 设备，
故不做任何真机结论，也不把上一轮（修复前代码）的真机证据升级为本轮 PASS。

## 6. 下一步

1. 把测试机用数据线接回，跑完 §5 里挂起的真机冷启动轮（脚本已备好）；
2. 交由独立方按同一份双启动反例 + M12 变异复验；
3. 通过后才进入「导入格式安全面」，再后才「再次独立复验 P2-C」。
