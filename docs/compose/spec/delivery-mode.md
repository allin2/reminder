---
feature: delivery-mode
status: decided
updated: 2026-09-16
branch: main
relates: android-fullscreen-alarm.md
amendment: A-01
decisions: D9 D12 D25
---

# 投递方式（Delivery Mode）

## Report

**交付状态** — **规格已定，代码未落地。** 基线依据
[V0.2 修订附录 A-01](../../baseline/V0.2-amendments.md)（来源提案 CP-001），
与 [关键档全屏闹钟](./android-fullscreen-alarm.md) 的 D9 配套。

**现状** — 这个概念**完全不存在**：

- 事项没有"投递方式"字段；全局也没有任何杠杆；
- 现状的投递由**档位间接决定**：普通/重要走通知渠道（importance 3 / 4）；
- 关键档**本应**走更强机制，但目前**根本没接**（D9 未落地）。

所以现状实际是：**所有事项都只有通知栏一条路**，而通知栏默认还是关的
（`settings.notify = false`，见 `docs/product-logic.md` §6）。

## [S1] Problem

用户希望「我要求多强的唤醒」是一次设定就能覆盖所有事项，而不是逐条标记。但基线的档位模型
只提供**逐条**表达，全局层面唯一杠杆是"把推送整个关掉"（§23 D-02）。

结果是：**想让所有提醒都真正叫到自己的用户，只能逐条标关键** ——
而这正是产品本该消除的记账负担（§21 第 2 问：它是否降低 Attention Management 的操作成本？
逐条标关键显然是**提高**）。

## [S2] Design

### [S2.1] 两条正交轴

| 轴 | 取值 | 决定什么 | 谁定 |
|---|---|---|---|
| `importance` **档位** | normal / important / critical | 追踪频率、通知显著性、排序 | 用户**逐条**标记 |
| `delivery_mode` **投递方式** | alarm / notification | **首次**提醒走全屏闹钟还是通知 | **有标记 → alarm（强制）**；未标记 → 全局默认的**快照** |

两轴互不替代：档位仍决定"追几次、多显眼"，投递方式只决定"第一次怎么叫你"。

### [S2.2] 数据模型

- `settings.defaultDeliveryMode`：`"alarm" | "notification"`，**默认 `"notification"`**
  （保持现状行为，不惊动已有用户）
- `item.delivery_mode`：`"alarm" | "notification"`，**录入时快照写入**

### [S2.3] 赋值规则（快照）

```
delivery_mode = 有标记(importance ∈ {important, critical})
              ? "alarm"
              : settings.defaultDeliveryMode
```

「快照」的含义：值在**录入那一刻**定下来写到事项上。之后用户改全局设置，
**不影响已存在的事项** —— 这是产品所有人 2026-09-16 明确选定的语义。

### [S2.4] 编辑时的重算

编辑保存时按同一公式**重新快照**：

| 编辑动作 | `delivery_mode` |
|---|---|
| 未标记 → 有标记 | 变 `alarm` |
| 有标记 → 未标记 | **取当前** `settings.defaultDeliveryMode`（重新快照，**不保留**旧的 alarm） |
| 有标记 → 有标记（改重要↔关键） | 保持 `alarm` |

理由：R3 是「有标记的一定闹钟」，反过来说「没标记的按默认」。若去掉标记仍保留 `alarm`，
R2 就不成立。

### [S2.5] 首次闹钟 + 后续通知

沿用 D9 对关键档的形态，**对称扩展到重要档**：

| 档位 | 总提醒次数 | **首次** | 后续 |
|---|---|---|---|
| 普通（未标记） | 1 | 按 `delivery_mode` | 无 |
| **重要** | 4 | **全屏闹钟** | 3 次通知（`attention-important-v2`） |
| **关键** | 8 | **全屏闹钟** | 7 次通知（`attention-critical-v2`） |

普通事项只有 1 次提醒（`POLICY.normal.total = 1`），所以"首次＝全部"，不存在歧义。

> ⚠️ **这是本规格的推定。** 若你要的是「**每一次**都全屏」，那重要档会连响 4 次、
> 关键档连响 8 次全屏 —— 请明确指出，我改。

### [S2.6] 聚合的已知失效

`defaultDeliveryMode = alarm` 时，普通事项的首次提醒是全屏，**无法与同刻其他事项聚合**。
同一时刻 N 条普通事项到期 → **N 次全屏串行弹出**。

这是 A-01 记录的第 2 条知情代价。缓解方向（**不在本规格范围**）：全屏界面加"还有 N 条"的队列提示。

### [S2.7] 迁移（schema 5）

- 老事项没有 `delivery_mode` → 按档位推导，未标记的取**迁移时**的 `settings.defaultDeliveryMode`
  （即首次迁移快照一次）；
- **与 G01（正交状态建模）合并到同一次 schema 5**，避免连做两次迁移。

### [S2.8] 设置界面

「我的」→ 提醒分组新增一行「**默认提醒方式**」，两个选项。副标题必须写明两句：

1. 选定后**只影响之后录入**的事项（历史事项不变）；
2. **标记为「重要」或「关键」的事项始终使用闹钟提醒**，不受此项影响。

> 这两句必须显式展示。否则用户改了设置、发现历史事项没变，会当成 bug 报。

## [S3] Out of Scope

- **逐条**切换投递方式（本规格只有"有标记 → 闹钟"这一条覆盖规则；逐条覆盖留给后续）
- 把 `defaultDeliveryMode` 做成「唤醒上限」形态（CP-001 的方案 B，另议）
- 全屏界面的队列／聚合展示（缓解 S2.6 的代价）
- 真机验证（本机无 JDK 17 / Android SDK / 模拟器）

## Tasks

- [ ] T1: 新增 `settings.defaultDeliveryMode`（默认 `notification`）与 `item.delivery_mode` — acceptance: 字段出现在 state 与 `normalizeItem` (covers: S2.2)
- [ ] T2: 录入时按 S2.3 快照赋值 — acceptance: 有标记必为 alarm；未标记取当时设置 (covers: S2.3)
- [ ] T3: 编辑时按 S2.4 重算 — acceptance: 去掉标记会退回当前默认，而非保留 alarm (covers: S2.4)
- [ ] T4: 「我的」新增设置行与两行说明文案 — acceptance: 文案含"只影响之后录入"与"标记项不受影响" (covers: S2.8)
- [ ] T5: **关键档接入全屏闹钟**（D9，前置依赖） — acceptance: 关键档首次走全屏 (covers: S2.5)
- [ ] T6: 重要档首次接入全屏闹钟 — acceptance: 重要档首次全屏、后续 3 次走通知 (covers: S2.5)
- [ ] T7: 普通档按 `delivery_mode` 路由 — acceptance: 默认 notification 时行为与现状完全一致 (covers: S2.5)
- [ ] T8: `delivery_mode` 纳入原生对账重建 — acceptance: 重建后投递方式不漂移（INV-09） (covers: S2.7)
- [ ] T9: schema 5 迁移，与 G01 合并 — acceptance: 老数据迁移后投递方式与档位一致 (covers: S2.7)
- [ ] T10: 补测试 — acceptance: 覆盖赋值、编辑重算、迁移、路由四条 (covers: S2.3–S2.7)
