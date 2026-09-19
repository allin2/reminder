# 第二次返工独立复验

结论：**FAIL / FIX_REQUIRED**。上一轮 X1–X4 与 SW 定向缺陷均已修复；新增状态转换反例 Y1–Y3 仍失败，涉及轮次身份与表单会话隔离。不能宣布三个优先项整体通过。

## 对象与执行边界

- 分支 main，HEAD 与本地 origin/main 均为 `8d1c2617cff3aac5c4450a949c9044b79f63a673`；未 fetch，不代表远端此刻状态。
- 回交：`user-experience-three-priorities-rework2-20260920T003000.md`。
- 合同：`../handoff/2026-09-19-user-experience-three-priorities.md`。
- 本轮证据：`verification-runs/20260920-ux-independent-recheck2/`。只新增报告和复验文件；未改生产实现、未提交推送、未装设备，旧报告/证据/候选保留。
- 测试为生产 JS + 受控 DOM/存储/网络及 Android 单测；不是浏览器 GUI 或设备验收。

## 仍需修复

### P1 / Y1：接收回执时丢失 roundBase

`lib/delivery-evidence.js:226–234` 在合并回执时重新构造 delivered 对象，没有复制已登记的 roundBase。`entryRoundBase` 又把缺字段解释为当前 triggerAt，使该旧条目以后可以随当前触发起点“换身份”。

复现通过真实 applyReminderEvents 登记旧追提醒，调用 mergeEvidence 正常接收，随后通过生产编辑保存入口把提醒时间改到旧追提醒之前，登记新轮。结果旧条目从含 roundBase 变为不含 roundBase；当前事项仍显示“系统已接收这次提醒”，而新轮无回执。

Y1 特意使用编辑到过去的时间（系统当前允许保存），不伪称是普通未来稍后的实机观察。核心不变量“正常回执不得抹去已知轮次身份”已直接失败；用户编辑新轮后旧接收证据错误延续亦已复现。

**最小修复与验收：** 所有 scheduled → delivered、cancelled/suppressed、保存/恢复路径保留稳定身份。测试应从生产排程/接收入口生成 delivered，不能直接手造带 roundBase 的 delivered fixture。之后改时间并重启、重读，旧历史可显示，但不得证明当前轮已接收。

### P1 / Y2：升级旧数据被无依据认作当前轮

`lib/delivery-evidence.js:78–87` 明确把缺少 roundBase 的条目认作当前 triggerAt。该规则并不保守：身份未知不能升级成当前轮的肯定证据，且不只影响“用户已看到过的 delivered”，也接受旧 scheduled/cancelled。

Y2 从上一版合法数据形态 `{at,state:'scheduled'}` 出发：真实 snooze 到未来 5 分钟、真实对账保留未来 29 分钟的旧追提醒并取消，随后模拟旧回执回读。结果 `applied=1`，当前新轮显示 delivered。它与上一轮 X1 是同类场景，只是输入为升级前真实数据结构；没有额外手动删除新写入字段。

**最小修复与验收：** 缺失/无效身份不能默认赋予当前轮。迁移能证明旧归属时才固定归属；无法证明则保留历史、当前核查 unknown/unverifiable。至少覆盖旧 scheduled/cancelled/delivered、换轮前后升级、重启回读。不要通过测试容忍此误判，也不要仅修 Y1 留下升级路径。

### P2 / Y3：保存完成回调仍未检查表单会话

`app-core.js:4234–4238` 新建保存完成只比较字段签名，编辑回调也同样；新增 itemFormSession 仅被 AI 回填判断使用。

Y3：从 openCapture 开始，保存“明天下午3点提醒我取快递”，扣住持久化提交；重新 openCapture，输入同一句，确认会话 ID 从 1 变为 2；释放旧提交。新表单输入变成空串，实际只持久化第一条。即使字段相同，新会话也不属于旧请求，旧回调不应将其关闭/清空。

**最小修复与验收：** 提交会话身份必须贯穿新建/编辑、AI 成功/失败以及持久化成功/失败的 UI 收尾；判断同会话且未被用户修改，不能只比较内容。补正常同会话清理与关闭重开同内容、不同内容、失败恢复检查。

## 本轮通过与未通过的边界

| 项目 | 结果 | 证据 |
|---|---|---|
| X1 旧 cancelled 键、具有 roundBase | PASS（该反例） | applied=0，superseded-round |
| X2 AI 迟到串写 | PASS（该反例） | 新草稿保留，第一条备注不串写 |
| X3 无时间撤销 | PASS（harness） | 撤销动作可见 |
| X4 停铃读取异常 | PASS（该分支） | 如实提示无法确认，未写 stoppedAt |
| SW 预缓存遗漏 | PASS（处理器测试） | native bridge 已在安装缓存 |
| SW 离线资源类型 | PASS（处理器测试） | 缺脚本返回 504，导航才回落 HTML |
| Y1 接收后轮次丢失 | FAIL | transition-results.json |
| Y2 升级数据轮次误认 | FAIL | 同上 |
| Y3 新会话同内容被旧保存清空 | FAIL | 同上 |

本轮 `npm test` 退出 0，**1572/1572**（328/321/226/697）。JDK 17 的 `:app:testDebugUnitTest --offline --rerun-tasks` 退出 0，66 tasks 全执行、XML 汇总 **22/22**。原独立 probes 副本执行退出 0，逐项观察保留在 probe-results.json；extended-probes 退出 0；transition-probes **退出 1**，不是脚本异常（异常为 2）。未执行源码变异脚本，其 10/10 结论仅是实施者证据，本轮没有独立复现。

## 候选与替代构建裁决

独立以 ZIP 条目内容 SHA-256/字节比较核对，未仅依赖 CRC32：

- debug：`06a404499237ea7656c04c8856f5845f9ddbafc6307a96f5a0d0525a01848200`。
- release：`679768958743aba528f32d58d9dab4171f21023c0ec91c63b2e83003635b4658`。
- 两包各 508 个条目，无新增/删除，恰好 3 个 Web 文件及 3 个签名条目变化；DEX、manifest、res 等其余条目内容一致。
- 两包 13 个 Web 资源均与当前源码逐字节一致。
- 依上一轮 identity 文件的源码清单重新计算当前哈希，只有 app-core.js、lib/delivery-evidence.js、sw.js 变化；登记的 Java 源码无变化。旧源码哈希属于冻结基线记录，DEX 内容另作直接独立比对。
- `releases/安心收件箱-debug.apk` 当前哈希为 `186c28b912000d3e9c34137c75160b3c0ff2a5aba62bd4fed95eff2c1015a523`，与回交的还原目标相符。

**接受这些候选的内容差异证据。** 现有结果支持“替代构建没有引入预期之外的包内内容变化”，不等于所有环境下标准脚本已修好，也不是安装/签名验证/真机运行通过。本轮没有重新构建、复现删除护栏或绕过任何拒绝；关于护栏阈值与 TTL 的描述仅来自实施回交，没有独立核实。

## 合同与后续

- UX-T01 / UX-C03：AI 原反例已修，表单会话隔离仍 partial（Y3）。
- UX-T03：轮次证据仍 partial（Y1/Y2）；普通通知后台持久证据覆盖也按回交保留未完成，不能靠 Java 未改证明需求已覆盖。
- UX-T02：停铃读失败分支已修，独立事项测试通道仍是回交明确遗留的规格缺口；不视作已获豁免。
- UX-A03 等上一轮已通过的窄场景继续有旧探针回归，不扩大为全平台 PASS。
- V18/V19/V20 继续 **NOT_PERFORMED**；D70 与导出落地出口保持原范围，不在本轮擅自实现。

下一轮先修 Y1/Y2/Y3，补生产状态转换与升级测试，再冻结新候选。不要覆盖当前任何失败候选或报告。源码闭合后仍需补合同中的设备及未完成规格项，才能评定整体完成。
