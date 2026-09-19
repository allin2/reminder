# Y1–Y3 定向修复独立验收

结论：**PASS（本次 Y1–Y3 定向源码/行为修复）**。本轮未发现阻断这三项修复的新问题。此结论不是三个产品优先项整体完成、正式发布或目标设备 PASS。

## 验收对象与集成状态

- 实际验收目录：`/Users/qlyf/.codex/worktrees/3547/reminder`。
- 只读源目录：`/Users/qlyf/Developer/reminder`，仍保留上轮失败实现，**尚未集成修复**。
- worktree detached HEAD：`8d1c2617cff3aac5c4450a949c9044b79f63a673`；未提交、未推送。
- 独立比对确认 app-core.js、lib/delivery-evidence.js、test-unit.js、test-regressions.js 的当前哈希与实施 final-hashes.json 相符。前两者为产品增量，后两者为测试。
- 基线/修复差异已直接读取；不把 git diff 相对旧 HEAD 的全部脏改动当成本次任务新增。
- 本轮只新增本报告和 `verification-runs/20260920-y123-independent/`，未修改产品或合回源目录。

## 逐项结果

| 项目 | 独立复验结果 | 依据 |
|---|---|---|
| Y1 正常接收抹去轮次身份 | PASS | 原 transition-probes 不改内容重跑；scheduled→delivered 保留 roundBase，生产编辑换轮后旧回执不抬高新轮 |
| Y2 升级旧台账冒充当前轮 | PASS（已测场景） | 原 Y2 旧 scheduled 经稍后/对账后回读，被拒为 unverifiable-round；当前状态 unknown；正式回归覆盖三态、重复/乱序和重启 |
| Y3 旧保存清空新会话同内容 | PASS | 会话 1→2 后输入保留；源码守卫覆盖新建/编辑的成功和失败收尾，正式回归亦覆盖这些分支 |
| 上轮 X1–X4 | PASS | extended-probes 原副本 4/4；旧取消事件隔离、AI 串写、无时间撤销、停铃读失败均保持修复 |
| 更早独立 probes | 原场景保持修复 | 副本重跑，观察值见 probe-results.json；该脚本退出 0 本身仅表示执行完成 |

Y2 现在对缺身份条目默认不可验证，保留首期键精确锚定当前 triggerAt、或当前对账明确登记的迁移分支。本次检查覆盖报告列出的升级和换轮反例，不扩大为所有历史数据组合穷尽验证。

## 独立执行

- `npm test`：退出 0，unit 330 / native 321 / smoke 226 / regression 715，共 **1592 通过、0 失败**。
- JDK 17：`./gradlew :app:testDebugUnitTest --offline --rerun-tasks`，退出 0，66 tasks 全执行；XML **22 测试、0 失败/错误/跳过**。
- transition-probes：Y1/Y2/Y3 全 true；extended-probes：X1–X4 全 true。
- `git diff --check`：退出 0。
- 本轮未重复执行源码变异、GUI、构建、签名验证或安装；实施者对应结果不升级成本轮独立执行。

## 候选内容核对

正式候选目录：`releases/candidates/20260920T014002-ux-y123-fix/`。

| 类型 | SHA-256 |
|---|---|
| debug | dbdd79732d0595df3e502c98cfbc66ebeb92651cb5464cbc0faf1953d1a158da |
| release | 2d5f5226635c6fc64a773062f312aaa3051929b58ab9166c28354d01bd1c62b9 |

独立读取 ZIP 条目实际字节比对（不仅 CRC）：两包均 508 条，无新增/删除；相对上一轮候选仅 app-core.js、lib/delivery-evidence.js 和 3 个签名元数据条目改变。其余条目含 DEX 一致；13 个 Web 资源与当前工作树逐字节一致。产物身份与回交吻合。没有采用标为 REJECTED 的中间候选。

## 后续边界

1. 本次修复仍在独立 worktree；如需主目录生效，应以已审阅的 4 文件任务增量为单位集成，重新核对源基线并保留其余修改。本次“检查”不自动授权合回或提交。
2. V18/V19/V20、设备安装与锁屏/后台可见性：**NOT_PERFORMED**。
3. UX-T02 独立事项测试通道、普通通知后台持久证据的既有缺口继续保留；D70 与导出按原范围未改。不能据本报告宣布整体产品通过。
4. 旧报告、证据、失败和正式候选均保留。
