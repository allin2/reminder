# P2-C-R2 独立复验

- run：`20260922T110036-independent-p2cr2-recheck`
- 身份：独立验收方
- 对象：`20260922T0055-p2cr-mirror-failclosed` 源码与候选 APK
- 产品结论：**PASS**
- 交付结论：**PASS_WITH_FOLLOWUP**（三个证据脚本缺口须在冻结 checkpoint 前修复）

## 1. 结论

上一轮阻断项已经关闭：

1. IndexedDB `get` 失败与 `open` 失败时，有效但陈旧的 localStorage 镜像都只用于只读展示；状态为 `failed`、`writesAllowed=false`，业务心跳不启动。
2. 实际调用 `saveAsync()` 被 `state-authority-blocked` / 真机错误文案 `state-authority-failed` 拦截，没有生成 pending replay。
3. 下一次健康启动仍从 IndexedDB 读到完整权威数据，旧镜像没有覆盖新增事项。
4. `migrateItem()` 已幂等；连续健康冷启动不再产生状态 put。
5. 真机把 IndexedDB 的 `CURRENT` 指向不存在的 manifest 后，候选包按预期 fail closed；恢复后两个 LevelDB 目录逐文件、逐字节以及文件集合完全一致，连续两次冷启动恢复正常。

因此 P2-C-R 产品门可以通过，后续可进入“导入格式安全面”。

## 2. 交付身份

| 项 | 独立核验结果 |
|---|---|
| HEAD / origin/main | 均为 `3574824357dc7beb04cbd3e32aa413cd508e8484` |
| 候选 APK | `62e5c876d4e1b9d707369c79f72631e3f51e76840070cf65fb3936c518191b4f` |
| 设备已安装 base.apk | 与候选 APK 逐字节相同 |
| 包身份 | `space.alliswell.inbox.exportrecheck`，versionCode 2；firstInstallTime 仍为 `2026-09-21 16:10:02` |
| APK Web 资源 | 22 个仓库资源与当前源码逐字节相同；2 个 Cordova 文件为构建生成物 |
| 实施方源码哈希 | 9/9 重新校验通过 |

证据：`evidence/candidate-apk-hash.txt`、`device/installed-apk-hash.txt`、
`device/installed-candidate-compare.txt`、`evidence/apk-source-byte-compare.txt`、
`evidence/implementer-source-hashes-check.txt`。

## 3. 离线双启动反例

独立脚本重新构造：IndexedDB 两条、镜像一条，分别注入 `get` 与 `open` 失败。

两种路径均满足：

- 第一启动：`failed`、写闸门关闭、无 15 秒心跳、IDB puts=0；
- 显式保存：抛 `state-authority-blocked`，`blockedWriteCount=1`；
- localStorage：没有 `attention-inbox-v2-pending-replay`；
- 镜像一条仅只读可见，恢复面板存在；
- 第二启动：`loaded/authoritative`，内存和 IDB 都仍为 `mirror-old,idb-new` 两条。

上一轮原始阻断探针现在返回 `PROBE_DID_NOT_REPRODUCE`；本轮正向验收脚本返回 `PASS`。

证据：`evidence/prior-blocker-probe.stdout.json`、`evidence/independent-failclosed-probe.json`。

## 4. 自动化与浏览器

| 检查 | 结果 |
|---|---|
| `npm test` | **2347 通过 / 0 失败 / exit 0**（492 / 324 / 384 / 257 / 730 / 160） |
| UI 格式对照 | 567 项一致，exit 0 |
| UI DOM 对照 | 16 场景 / 590 字段一致，exit 0 |
| Chrome 生产组合 | 12 用例，0 项断言不满足，exit 0 |

## 5. 真机健康冷启动与 SIGKILL

设备 `QSKFAE95CQEUJZ8L`，已安装包与候选 APK 逐字节相同。

三轮 `force-stop → 冷启动`：

- 权威记录哈希始终为 `0625aacabcd5068a`，2443 字节；
- 每轮死亡窗口两个非空文件哈希相同；
- 页面始终 `loaded/authoritative/idb`、`writesAllowed=true`、`blockedWriteCount=0`；
- 每轮 WAL 增量精确为 19 字节，仅 1 条 12 字节 payload 的 WriteBatch，`OPS=0`、`seq=560`；不存在空标记后隐藏的第二条写记录。

独立 SIGKILL：pid 消失，死亡窗口两个非空文件哈希一致，重启前后记录哈希相同，恢复为 `loaded/authoritative`。

证据：`device/coldstart-rounds-final.log`、`device/wal-delta-independent-summary.json`、
`device/sigkill-corrected.log`。首次手工 SIGKILL 日志里的 B1/B2 因错误的行首 grep 为空，原始假 PASS 保留在
`device/sigkill.log`，未用于结论。

后台 `HOME + am kill` 独立重试仍未杀掉进程：pid 前后均为 22061；dumpsys 可见 WebView sandbox 服务的
`ConnectionRecord flags=0x80000041`。该方式记 `NOT_PERFORMED`，不冒充通过；SIGKILL 已覆盖无优雅退出路径。

## 6. 真机 IndexedDB 故障注入

在进程停止时完整备份 IDB 与镜像 LevelDB，各 5 个普通文件。仅把 IDB `CURRENT` 改为
`MANIFEST-000099`，随后启动当前候选。

实测：

- `status=failed`；原因 `degraded-mirror-unconfirmed-authority`；backend 为 local；
- `writesAllowed=false`；恢复面板存在且可见；
- 镜像里的 2 条事项仅只读可见；
- pending replay 为 null；
- 真调用 `saveAsync()` 抛 `state-authority-failed`；拦截计数从 0 增至 1。

恢复阶段在进程停止后执行：

- IDB 5/5 文件逐字节一致；
- 镜像 5/5 文件逐字节一致；
- 恢复前后的普通文件名集合完全一致，没有遗漏额外残留文件；
- 恢复后两次冷启动均为 `loaded/authoritative/idb`，记录哈希仍为 `0625aacabcd5068a`，无 pending replay。

证据：`device/fault-state-probe.log`、`device/idb-restore-verify.log`、
`device/mirror-restore-verify.log`、`device/restore-complete.exit`、`device/post-restore-boot-1.log`、
`device/post-restore-boot-2.log`。

## 7. 证据脚本待修项

这些问题没有影响本轮产品结论，因为独立复验用额外判据关闭了缺口；但在冻结可复算 checkpoint 前必须修复。

### T1：冷启动脚本在当前 Bash 下直接退出

`p2cr-coldstart-rounds.sh` 多处写成 `$BASE_WAL（…`、`$A_RSHA）：…`、`$C_WAL（…`、`$KIND）：…`。
在 `set -u` 和当前 locale 下，Bash 把中文标点并入变量名，报 `unbound variable`。独立复验保存了仅加花括号的副本并成功完成三轮。

修复：所有紧邻非 ASCII 字符的变量改为 `${NAME}`。原始失败与最小补丁见
`device/coldstart-rounds.log`、`device/coldstart-rounds-fixed-run-2.log`、
`evidence/coldstart-script-portability.patch`。

### T2：WAL 判据只解析第一条新增记录

`idb-wal-delta.py` 使用 `recs[0]` 计算总 verdict。合成“第一条 count=0、第二条 count=1 put”的 43 字节增量时，
工具输出 `records_appended=2` 却仍给 `OPS=0 / NO_OPERATIONS`，可漏掉空标记之后的真实写。

修复：遍历全部新增 records，汇总总 ops；任一合法 WriteBatch `count>0` 即 `HAS_OPERATIONS`。解析失败、轮转或尾部不完整不能默认当 `NO_OPERATIONS`，应给 `INCONCLUSIVE` 并让验收脚本 fail closed。

证据：`evidence/wal-parser-two-record-counterexample.json`。

本轮三轮实际增量均只有一条完整记录，因此 T2 不影响本次 `OPS=0` 结论。

### T3：恢复 verify 不检查额外文件

`p2cr-idb-fault-inject.sh verify` 只逐个校验备份清单里的文件，设备目录若多出新文件仍会 PASS。

修复：同时比较当前普通文件名集合与 `SHA256SUMS` 的文件集合。本轮独立复验已额外执行集合比较，两个目录均一致。

## 8. NOT_PERFORMED

- 后台回收：`am kill` 未终止进程，记 `NOT_PERFORMED`。
- WebView JavaScript 层故障注入：未改 APK；磁盘层真实损坏注入已覆盖权威后端打不开。
- 空镜像破坏性真机变体：未执行；由离线双启动反例及 M12 变异覆盖。
- 导入格式安全面：本轮未实施。
- Git commit / push：未执行。

## 9. 推进裁决

P2-C-R 产品修复通过，可进入“导入格式安全面”。T1–T3 属证据工程缺口，不要求回滚产品结论，
但应在冻结 checkpoint 前完成并复跑其各自反例。
