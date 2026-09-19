# 用户体验三项优先问题 Y1 / Y2 / Y3 修复报告

## 结论

三项指定缺口已在独立工作树中修复并形成新的 JDK 17 Debug/Release 候选：

- **Y1 PASS（源码 + 行为回归）**：正常回执不再丢失 `roundBase`；旧轮送达历史跨编辑、
  换轮和重启保留，但不会抬高当前轮核查状态。
- **Y2 PASS（源码 + 升级/乱序/重启回归）**：升级数据缺 `roundBase` 时不再按当前
  `triggerAt` 猜测归属。旧 `scheduled/cancelled/delivered` 均保持不可验证；只有可从键或
  当前原生对账证明的记录才迁移。
- **Y3 PASS（源码 + 新建/编辑/成功/失败回归）**：持久化异步收尾必须匹配提交时的
  `itemFormSession` 与草稿签名。关闭重开后的同内容表单不被旧回调清空或恢复；同一会话的
  双击仍去重，新会话同内容可独立提交。

结论等级止于源码、Node 行为、Android JVM 单测和本机打包。真机安装、设备哈希回读、
后台投递和锁屏可见性均为 `NOT_PERFORMED`，不能宣称设备 PASS。

## 身份与范围

- 实施工作树：`/Users/qlyf/.codex/worktrees/3547/reminder`
- 只读源基线：`/Users/qlyf/Developer/reminder`
- HEAD / origin/main：`8d1c2617cff3aac5c4450a949c9044b79f63a673`
- 工作树为 detached HEAD；未创建分支、未提交、未推送。
- 相对用户源工作区，本次产品/测试增量仅 4 个文件：
  `app-core.js`、`lib/delivery-evidence.js`、`test-unit.js`、`test-regressions.js`。
- 完整增量见 `verification-runs/20260920T011417-ux-y123-fix/task-delta.patch`；基线与最终哈希
  分别见同目录的 `baseline-hashes.json`、`final-hashes.json`。

最终复核时，源工作区四个基线文件哈希仍与开工值一致；源工作区根目录
`releases/安心收件箱-debug.apk` 哈希仍为 `186c28b9…`。本工作树对应 HEAD 文件为
`cb6a9217…`，两者的既存差异没有被本轮改写。

## 实现

### Y1：回执状态迁移保留轮次身份

`mergeEvidence` 由新建对象改为保留登记条目后覆盖送达字段，并显式携带已验证的
`roundBase`。这使 `scheduled -> delivered` 不再把一条可验证记录降级为“缺轮次身份”。
状态汇总和接收入口统一通过同一轮次解析函数。

### Y2：升级数据不猜轮次

`entryRoundBase(item, entry, key)` 的迁移规则收紧为：

1. 有有限数值 `roundBase`：使用它；
2. 无字段但键精确为 `0@triggerAt`：可证明是当前首期，允许迁移；
3. 其余：返回 `null`，合并原因记为 `unverifiable-round`，历史保留但不提升状态。

当前原生对账明确再次登记同键时，`applyReminderEvents` 可为缺身份终态补当前轮身份；已有
显式身份绝不改写。这样既避免旧历史冒充当前轮，也保留了可证明迁移通路。

### Y3：异步回调绑定表单会话

提交 token 新增 `itemFormSession`。成功回调只有在“会话相同 + 草稿签名相同”时才关闭并
复位；失败回调也只有满足同一条件才恢复旧草稿。新建、编辑四条成功/失败分支采用同一规则。
测试钩子新增 `openEditItem`，用真实编辑表单入口覆盖编辑分支。

## 验收矩阵

| 项目 | 正向场景 | 失败/逆向场景 | 结果 |
| --- | --- | --- | --- |
| Y1 | scheduled→delivered、编辑换轮、重启 | 去掉 `roundBase` 保留逻辑后 4 条失败 | PASS |
| Y2 | 三种旧状态、乱序、重复、稍后提醒、对账迁移、重启 | 恢复“缺字段即当前轮”后 6 条失败 | PASS |
| Y3 | 新建/编辑 × 成功/失败；同会话失败；新会话同内容 | 去掉会话守卫后 Y3 探针失败 | PASS |

正式回归用生产 `applyReminderEvents`、`applyNativeDeliveryEvidence`、真实保存入口和共享持久化
磁盘模拟重启，不是只测辅助函数。已有 AI 成功/失败、关闭重开同内容、冻结草稿分支也继续通过。

## 验证结果

### Node / 行为层

- `npm test`：
  - unit：330 / 330
  - native reminders：321 / 321
  - smoke：226 / 226
  - regressions：715 / 715
  - 合计：**1592 / 1592**
- 生产入口 Y1/Y2/Y3 探针：3 / 3。
- 独立复验探针、扩展探针、SW 缓存与边界探针均重跑；扩展 X1-X4 全部
  `pass: true`，缺失脚本返回 504、导航请求仍回落 HTML。
- `git diff --check`：PASS。

### Android JVM / 打包层

- Temurin 17.0.20.1，`:app:testDebugUnitTest --rerun-tasks`：**22 / 22 PASS**，66 tasks。
- Temurin 17.0.20.1，`:app:assembleDebug :app:assembleRelease --rerun-tasks`：
  **BUILD SUCCESSFUL**，260 tasks。
- Release 签名：v1/v2/v3 均验证通过；签名者证书 SHA-256
  `bbdaeece7fa34052a529e3fc3aaab2a4f6d688b7e60845750f10cd4e17469f0b`。
- 两个最终 APK 内 13 个 Web 文件与工作区逐字节一致。
- 对上一候选做 ZIP 条目级比对：Debug 508 = 508、Release 508 = 508；无增删条目，
  内容差异仅在两个任务产品文件与签名元数据，`unexpected: []`。

默认 Java 24 的单测曾出现 21 / 22（DirectBoot 测试桩/JIT 敏感），且构建产生合成类漂移；
它和 `-Xint` 诊断结果都保留为过程证据，但不作为正式结论。正式结果统一绑定项目目标 JDK 17。

## 候选

正式候选目录：`releases/candidates/20260920T014002-ux-y123-fix/`

| APK | 大小 | SHA-256 |
| --- | ---: | --- |
| `attention-inbox-debug-ux-y123-fix.apk` | 4,081,606 | `dbdd79732d0595df3e502c98cfbc66ebeb92651cb5464cbc0faf1953d1a158da` |
| `attention-inbox-release-ux-y123-fix.apk` | 3,251,418 | `2d5f5226635c6fc64a773062f312aaa3051929b58ab9166c28354d01bd1c62b9` |

三个中间目录均保留原文件并新增 `REJECTED.md`，没有覆盖：

- `20260920T011417-ux-y123-fix`：生成资产不完整；
- `20260920T013229-ux-y123-fix`：缺 `res/xml/config.xml`；
- `20260920T013650-ux-y123-fix`：JDK 24 工具链漂移。

## 剩余边界

- 真机 V18/V19/V20、普通通知后台持久交付、锁屏可见性：`NOT_PERFORMED`。
- UX-T02 的独立通道问题不属于本次 Y1/Y2/Y3 授权范围，仍是已知缺口。
- 本轮没有清理历史候选、构建目录、证据或源工作区；没有提交/推送。

可复用证据入口：`docs/reviews/verification-runs/20260920T011417-ux-y123-fix/README.md`。

