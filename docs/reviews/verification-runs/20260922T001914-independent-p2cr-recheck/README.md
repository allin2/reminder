# P2-C-R 独立复验

- run：`20260922T001914-independent-p2cr-recheck`
- 身份：独立验收方；未修改产品源码、测试源码或候选 APK
- 复验对象：实施方 run `20260921T2355-p2cr-authority-gate` 所绑定源码与候选 APK
- 结论：**FAIL / FIX_REQUIRED**

## 1. 阻断结论

当前写闸门仍可让**旧 localStorage 镜像覆盖更新的 IndexedDB 权威状态**。

独立反例以同一生产组合 harness 连续启动两次：

1. 初始数据：IndexedDB 有 `mirror-old + idb-new` 两条，localStorage 旧镜像只有 `mirror-old`。
2. 第一次启动分别注入 IndexedDB `get` 失败、`open` 失败。
3. 两种情况下应用都把旧镜像判为 `loaded`，`writesAllowed=true`，启动 15 秒业务心跳；显式 `saveAsync()` 也成功，并留下 `attention-inbox-v2-pending-replay`。
4. 第二次启动恢复健康 IndexedDB。`replayPendingSnapshot()` 优先采用旧镜像快照并写回 IndexedDB。
5. 结果：权威库从两条降为一条，`idb-new` 被覆盖；报告原因为 `pending-replay`。

两个故障分支均完整复现，原始结果见：

- `evidence/stale-mirror-two-boot-probe.js`
- `evidence/stale-mirror-two-boot-probe.json`
- `evidence/stale-mirror-two-boot-probe.exit`（0 表示阻断反例按预期复现）

这不是只由 `migrateItem()` 的启动期误保存造成。探针在第一次启动后又显式调用一次 `saveAsync()`；它同样越过闸门。因此即使只修迁移幂等性，用户在降级界面做一次正常保存，下一次启动仍会覆盖较新的 IndexedDB。

## 2. 根因

`lib/storage.js` 已明确规定：`backend=idb` 时 IndexedDB 是权威，localStorage 只是尽力镜像。`app-core.js` 却在两条“权威未确认”路径上把镜像提升为可写权威：

- IndexedDB 读异常后，`mirror-recovered` 返回 `LOAD_LOADED`；
- IndexedDB 打不开、后端降为 local 后，`degraded-mirror` 返回 `LOAD_LOADED`。

`authoritativeWritesAllowed()` 只看 `loaded/empty`，所以两条路径都会进入完整业务启动并允许保存。降级保存生成 pending replay；下次健康启动又在处理已读出的 IndexedDB 值之前优先回放 pending snapshot，最终覆盖更新数据。

现有 B5 测试没有覆盖该状态分叉：

- `idbGetFails` 与 `idbOpenFails` 用例都没有同时种下一个**有效但落后**的镜像；
- M9 对照从“镜像空”出发，只证明 failed 分支能挡住空基线，没有证明“镜像有效”时仍 fail closed；
- 因此 360 条 boot 断言全绿，但关键反例仍成立。

## 3. 第二项缺口：迁移不幂等

`lib/native-reminders.js:migrateItem()` 对已经存在的 `dismissedUntil:null` 仍进入 `== null` 分支，赋回同一个 `null` 并返回 `changed=true`。

独立探针构造所有字段已经规范、调用前后 JSON 字节完全一致的事项，结果仍为 `true`：

- `evidence/migrate-item-idempotence.json`
- `evidence/migrate-item-idempotence.exit`（1，说明幂等性判据失败）

这会让每次冷启动产生一次无意义权威提交，也是旧故障的稳定触发器。它应在本批修复，而不是继续留作已知开口。

## 4. 必须完成的修复

1. **镜像不得在权威读取失败时取得写权限。** 当设备存在 IndexedDB，而本轮 `open/get` 失败时，`mirror-recovered` / `degraded-mirror` 必须保持 fail closed。可展示镜像供只读查看，但不得进入业务启动、保存、原生对账或心跳。
2. **待回放凭据不得由未确认镜像产生。** 若产品要支持权威库不可用时继续编辑，需要额外的单调版本或提交身份与冲突裁决；当前“镜像快照下次无条件覆盖 IDB”不能作为安全降级。
3. **修正迁移幂等性。** `dismissedUntil` 缺字段时才补 `null`；已经存在且为 `null` 时应返回未变化。连续第二次迁移必须为 `false`。
4. **永久加入两启动反例。** `IDB=两条、镜像=一条`，分别覆盖 `get` 失败与 `open` 失败；第一轮保存必须被拦且不生成 pending replay，第二轮健康启动必须仍保留两条。
5. **加入变异对照。** 临时把镜像路径恢复成 `LOAD_LOADED` 后，上述反例必须变红，证明断言确实守住来源差异。
6. **保留健康路径。** 权威成功读到对象仍为 `loaded`；权威成功读到空且没有任何残留才为 `empty`；合法且来源可证明的 pending replay 行为需单独测试。

## 5. 独立回归结果

| 检查 | 结果 |
|---|---|
| `npm test` | 2320 通过，0 失败，exit 0（492 / 321 / 360 / 257 / 730 / 160） |
| UI 格式对照 | 567 项一致，exit 0 |
| UI DOM 对照 | 16 场景 / 590 字段一致，exit 0 |
| Chrome 生产组合 | 12 用例，0 项断言不满足，exit 0 |
| 双启动旧镜像反例 | **两种故障均复现权威覆盖，BLOCKER_REPRODUCED** |
| `migrateItem` 幂等性 | **失败：字节不变仍返回 `true`** |

全量回归与 Chrome 基线说明没有普遍启动回归，但不能抵消数据覆盖反例。

## 6. 交付身份

- HEAD 与 `origin/main` 均为 `3574824357dc7beb04cbd3e32aa413cd508e8484`。
- 复验开始时工作区已有 112 条脏条目；未 checkout、stash、reset 或还原任何现场。
- `app-core.js`、`lib/storage.js`、`lib/native-reminders.js` 等关键哈希与实施方记录一致。
- 候选 APK SHA-256 为 `314321a20a705a91c6b0e23205a8e2021febd3e55fc8d0002bfa56c44785a4b5`。
- APK 内 22 个仓库 Web 资源与当前源码逐字节一致；`cordova.js` 与 `cordova_plugins.js` 是构建生成文件，仓库无对应源文件。

详见 `evidence/source-hashes.txt`、`evidence/apk-hash.txt`、`evidence/apk-source-byte-compare.txt`。

## 7. NOT_PERFORMED

- Android 真机独立冷启动：**NOT_PERFORMED**，本轮设备列表为空。实施方的健康冷启动证据只作为既有材料，不升级为本轮独立 PASS。
- Android 真机 IndexedDB 故障注入：**NOT_PERFORMED**，现有候选无法在不改包的前提下稳定注入 `open/get` 故障；同源生产组合 harness 已完整复现两启动覆盖链。
- 提交、推送：**NOT_PERFORMED**。

P2-C-R 在修复第 4 节全部条件并再次独立复验前，不得标记 PASS，也不应继续导入格式安全面的实现批次。
