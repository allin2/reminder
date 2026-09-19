---
doc: decisions
topic: 导入与导出（CP-002）
date: 2026-09-18
decided_by: 产品所有人
baseline: Attention_Inbox_V0.2_产品需求与业务规格基线.md
proposal: CP-002
spec: ../compose/spec/import-export.md
---

# 裁决 · 导入与导出（D49–D54）

> 来源：变更提案 [CP-002](../baseline/change-proposals.md)。
> 裁决方式：产品所有人 2026-09-18 对提案中 Q1–Q6 的六个问题**逐项采纳推荐方案**（原话：「按照推荐来」）。
>
> **结论先行：本次裁决不修订冻结基线。** 「计划」按「批量 Capture」落地（不建容器），
> AI 只做抽取不做推断 —— 两者都落在 §1.3 / §22 已划定的边界**之内**，因此
> `V0.2-amendments.md` **不新增条目**。

## ⚠️ 编号说明（先读）

本裁决**原拟使用 D46–D54**，起草时发现 **D46 / D47 / D48 已被同一日的第十三轮 review 修复裁决占用**
（见 [`review-round12-fixes-2026-09-18.md`](./review-round12-fixes-2026-09-18.md)：D46 = H-06 补投台账、
D47 = H-07 待回放快照、D48 = H-08 归因）。两条工作线在**同一天并行**，编号撞车。

**已整体后移 3 位，最终编号：本裁决 = D49–D54，实现期推定 = D55–D57。**
本文件、规格、提案三处引用已同步改写，并对全部 `docs/**.md` 复核过编号占用。

> **教训（值得沿用）**：本项目 D 编号是全局递增的**单一序列**，却分散在多个文档里、**没有登记处**。
> 并行会话下，分配编号前应先扫一遍 `docs/` 的实际占用，而不是照记忆里"下一个可用号"往前推。
> 扫描方式：
>
> ```bash
> /Users/qlyf/.workbuddy/binaries/python/envs/default/bin/python -c "
> import re,os
> u=set()
> for r,d,fs in os.walk('docs'):
>     for f in fs:
>         if f.endswith('.md'):
>             u |= {int(x) for x in re.findall(r'\bD(\d{1,2})\b', open(os.path.join(r,f),encoding='utf-8',errors='replace').read())}
> print(sorted(u)); print('max', max(u))"
> ```

## 裁决表

| # | 问题 | 裁决 | 依据 |
|---|---|---|---|
| **D49** | 「计划」落在哪里 | **方案 C**：不建任何容器；导入 = 批量 Capture（追加一批 `AttentionItem`），预览时按来源文件的小标题/表格**分组展示**，分组不落库 | §1.3「不做 Project、子任务」· D-09「事项彼此独立」· §21 第 4 问 |
| **D50** | AI 能否推断原文没写的时间 | **不能。** AI 只做抽取；原文没有的时间一律不产出，落到 Fallback Trigger + `NEEDS_REVIEW` | §22「避免第一版用 LLM 决定关键提醒时间」· INV-10 |
| **D51** | 导入条目能否进首页 | **不能。** 一律 `status = waiting` + `review_status = NEEDS_REVIEW`，不参与 `promoteDue()`、不进首页、不计 Badge | §12 首页规则 · INV-07 · 与 [deferred-clarification](../compose/spec/deferred-clarification.md) [S2.3] 同构 |
| **D52** | 大批量确认形态 | **默认全勾选的确认列表**：可逐条取消、可逐条改；确认一次入库。**该形态仅限导入场景**，不改动「待整理」会话本身的逐条流程 | §9.4 主路径不变；提前交付 §18.2 P1 的「批量确认」条目（**仅调整交付顺序，§18.2 原文不改**） |
| **D53** | 图片 / 扫描件 / 音频 | **本期不做。** 多模态能力依赖用户自备模型，会形成"时好时坏"的单点依赖 | §22「AI/云能力只能增强，不能成为单点依赖」 |
| **D54** | 导出范围 | 待整理条目**包含并标注** `review_status`；已归档条目**默认不含**；范围可由用户在导出前调整 | §13 上下文可回溯 · 避免下游把未确认数据当真 |

## 本次裁决的边界

- **不需要基线修订**：D49 选 C 而非 B，正是为了不动 §1.3 与 D-09；D50 是把 §22 的既有约束写成可执行规则。
- **未解决的遗留**：代码中已存在 `projects` / `projectId` / 设置页「项目」入口（`app-core.js` 的 `state.projects`、
  `PROJECT_COLORS`、`renderProjects`，以及筛选器「有项目」），而 D-09 禁止项目概念。
  这是**先于本次需求存在的漂移**，D49 只是保证导入不会把它固化。
  **另行裁决，不在本次范围内**（已登记在 [CP-002](../baseline/change-proposals.md) 的现状核对表）。

## 实现期推定（D55–D57，未经单独裁决）

以下三条是实现中为避免"文档没写、代码各写各的"而做的细化推定。
**属推荐方案的直接推论**，如与预期不符请指出。

| # | 推定 | 为什么必须现在定 |
|---|---|---|
| **D55** | **时间载体分两类**：① 结构化来源（`.ics` / `.json` / CSV 的 ISO 列）→ 草稿直接携带**时间戳**；② 自然语言来源（`.txt` / `.md` / AI 抽取）→ 只携带**原文时间串**，由 `lib/parse-cn.js` 换算。**实现按字段判定**（先看该字段有没有时间戳，缺了才回落解析），不按草稿整体判定 | D50 约束的是"AI 不得**推断**"；`.ics` 里写的是确定事实，让它绕一圈自然语言解析反而会引入误差。两类来源必须用不同通道，否则实现时会混为一谈 |
| **D56** | **ICS 导出用 UTC（`Z`）表达时刻** | 不带 `VTIMEZONE` 而写 `DTSTART;TZID=Asia/Shanghai` 是**不合规**的 ICS；而 JSON 侧已经用「当地时间 + 偏移」表达了 §15 的当地语义。JSON 保语义、ICS 保通用 |
| **D57** | 导出字段 `time_source` **不产出 `USER`**，当前只会是 `PARSED` 或 `FALLBACK`；该取值保留在 schema 枚举中 | 内部没有"用户显式设定过时间"的持久标记（`reviewTriggerUserPicked` 只是局部变量）。**如实少给一个取值，比猜一个更安全** —— 已记入规格的已知缺口 |

## 对规格与提案的影响

| 文件 | 变更 |
|---|---|
| [CP-002](../baseline/change-proposals.md) | 状态 → **✅ 已批准** |
| [import-export.md](../compose/spec/import-export.md) | `status: draft` → `decided`；Q1–Q6 收敛为 D49–D54；[S2.6] 定案为方案 C；[S2.7] 定案为全勾选确认列表；[S3.1] 定案导出范围 |
| `V0.2-amendments.md` | **无变更**（本次不修订基线） |
