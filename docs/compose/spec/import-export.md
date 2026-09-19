---
feature: import-export
status: decided
updated: 2026-09-18
branch: main
baseline: Attention_Inbox_V0.2_产品需求与业务规格基线.md
proposals: CP-002
decisions: D49 D50 D51 D52 D53 D54
assumed: D55 D56 D57
ruling: ../decisions/import-export-ruling-2026-09-18.md
---

# 内容导入与结构化导出（Import / Export）

## Report

**交付状态** — **已裁决（2026-09-18），且无需修订基线。纯逻辑层已落地，UI / 提交 / AI 调用留下一轮。**

| 层 | 状态 |
|---|---|
| 裁决 | ✅ [D49–D54](../../decisions/import-export-ruling-2026-09-18.md)（+ 实现期推定 D55–D57） |
| 基线 | ✅ **不变**（方案 C 与「AI 只抽取」都在 §1.3 / §22 已划定的边界之内） |
| 纯逻辑 | ✅ `lib/export-format.js` · `lib/import-extract.js` · `lib/import-map.js`（含单测） |
| 格式契约 | ✅ `schemas/attention-inbox.export.v1.schema.json` + 样例 + 跨语言校验脚本 |
| UI / 提交 / AI | ⬜ 未开始（T4 · T8–T14 的 UI 部分） |

**六个问题的裁决结果**（原话「按照推荐来」）：

| # | 裁决 | 影响本节哪一条 |
|---|---|---|
| D49 | **不建容器**，导入即批量 Capture；预览按来源**分组展示**（不落库） | [S2.6] |
| D50 | AI **只抽取，不推断** | [S2.4] |
| D51 | 导入条目**不进首页**，一律 `NEEDS_REVIEW` | [S2.7] |
| D52 | 批量确认 = **默认全勾列表**，仅限导入场景 | [S2.7] |
| D53 | 图片 / 扫描件 / 音频**不做** | [S2.2] |
| D54 | 导出：待整理**含并标注**，已归档**默认不含** | [S3.1] |

**要回答的三个问题**（原文诉求）：

| 诉求 | 本文位置 | 一句话结论 |
|---|---|---|
| 导入支持哪些文件类型 | [S2.2] | **P0 五种必须有确定性路径**（txt / md / csv / json / ics），P1 三种本机结构解析（docx / xlsx / pdf 文本层），P2 图片与扫描件**本期不做** |
| AI 识别 → 计划生成的映射逻辑 | [S2.4] [S2.5] [S2.6] | AI **只做抽取、不做推断、不做决策**；产出 `ImportDraft[]`，由本地既有解析器换算出时间；全部落 `NEEDS_REVIEW`；**不建"计划"容器**（Q1） |
| 导出字段结构与格式规范 | [S3] + [schema 文件](./schemas/attention-inbox.export.v1.schema.json) | 新增独立对外契约 `attention-inbox.export/v1`（JSON，无损可回环）+ ICS 互操作；四维状态**派生**导出并标 `derived` |

**已裁决的两条红线**：

1. 「计划」按**方案 C** 落地（不建容器）—— 若按字面做成"自动建立计划/项目"，会直接撞 §1.3 与 D-09。
2. AI **不推断**原文未写的时间（§22 明令"避免第一版用 LLM 决定关键提醒时间"）。

> 裁决前本文件曾以 `status: draft` 挂在 [CP-002](../../baseline/change-proposals.md) 下；
> 2026-09-18 产品所有人逐项采纳推荐方案，转为 `decided`。

---

## [S1] Problem

系统现在只有**整库 JSON 备份/恢复**（`exportData()` / `importDataFile()`，覆盖式），没有"内容"层面的
进出。用户真正要的是两件事：

- **进**：手上已有的文件（会议纪要、需求清单、课程表、别人发来的待办）里躺着几十件事，
  现在只能一条条手打。这是 Capture 成本问题，不是数据迁移问题。
- **出**：本系统里的事实要能被别的程序读走（日历、待办、别的提醒工具）。

导入的真实难点不在"能不能读文件"，而在**错了的代价不对称**：

| 失败形态 | 代价 |
|---|---|
| 漏一条 | 用户以为已经交给系统 → **信任崩塌**（正是北向指标「主动查看 Future 的频率」要压下去的东西） |
| 多一条假的 | 一条不该出现的注意力，且用户不知道它是哪来的 |
| 时间算错 | 到点没响 / 提前响 → INV-10 保护的反面 |

所以导入的设计目标不是"尽量多抽",而是**每条都能溯源、错落可回收**。这直接决定了 [S2.5] 里
"AI 不得判优先级、不得直接给 ISO 时间、必须带原文引用"这几条硬约束。

导出侧的真实难点是**语义不能撒谎**：本产品最容易被下游误读的一点是
「ACK ≠ Complete」（INV-04）——如果导出只给一个 `status` 字符串，几乎一定会被别的程序
当成"已完成"。所以 [S3.3] 必须写死对外语义契约。

## [S2] Design — 导入

### [S2.1] 两种"导入"必须分开（现状偏差）

现有 `importDataFile()` 是**整库覆盖**，和"追加内容"是两种不同承诺，共用一个入口会出事。

| 入口 | 语义 | 处理 |
|---|---|---|
| **恢复备份** | 整库替换（覆盖） | 保留现有实现；文案改为「恢复备份（**覆盖**当前数据）」并保留二次确认 |
| **导入内容** | 从文件**追加**事项，已有数据不受影响 | 新增 |

**硬规则：内容导入是 append-only，永不覆盖、永不删除已有条目。**

### [S2.2] 支持的文件类型范围

分三档，依据是**离线可用性**（§22「核心功能必须离线可用；AI/云能力只能增强，不能成为单点依赖」）。

#### P0 · 必须有确定性路径（不依赖 AI，不依赖网络）

| 扩展名 | MIME | 抽取方式 | 是否需要 AI |
|---|---|---|---|
| `.txt` | `text/plain` | 非空行 → 一行一条 draft | 否（可选增强） |
| `.md` | `text/markdown` | 无序/有序列表项、`- [ ]` 任务项、`##` 标题作分组标签 | 否（可选增强） |
| `.csv` | `text/csv` | 表头映射（见下） | 否 |
| `.json` | `application/json` | 本应用导出件**原样无损回环**；或通用「对象数组」格式 | 否 |
| `.ics` | `text/calendar` | `VEVENT` / `VTODO` / `VALARM` / `RRULE` 确定性解析 | **否，且不应使用 AI** |

- **`.ics` 明确不走 AI**：它已经是结构化数据，交给模型等于用不确定方法处理确定数据（§22 相反方向）。
- **CSV 表头映射**（不区分大小写，同时接受中英）：

  | 目标 | 可识别的表头 |
  |---|---|
  | 标题 | `title` / `标题` / `事项` / `内容` |
  | 提醒时间 | `time` / `remind_at` / `提醒时间` / `时间` |
  | 截止时间 | `deadline` / `due` / `截止` / `截止时间` |
  | 备注 | `note` / `备注` / `说明` |
  | 标签 | `tags` / `标签` |

  表头无法识别时 → 回退「第 1 列当标题，其余列拼进备注」，**不得因为表头不认识就拒绝导入**（同 §6 INV-01 精神）。

#### P1 · 本机结构解析（需新增**内置**依赖，非网络）

| 扩展名 | MIME | 抽取方式 | 说明 |
|---|---|---|---|
| `.docx` | `…wordprocessingml.document` | 解 zip 取 `word/document.xml` → 段落文本 | 无打包器，需以 `lib/vendor/` + 多 `<script>` 顺序加载 |
| `.xlsx` | `…spreadsheetml.sheet` | 解 zip 取 `sharedStrings.xml` + `sheet1.xml` → 行 | 同上；首行当表头，复用 P0 的 CSV 映射 |
| `.pdf` | `application/pdf` | 文本层抽取（`pdfjs-dist`，vendored） | 仅文本层；无文本层 → 明确提示"这是扫描件"，归 P2，**不得静默返回空** |

#### P2 · 本期不做（列出来是为了不再反复问）

| 类型 | 为什么不做 |
|---|---|
| 图片（`.png` / `.jpg` / `.webp`，截图与拍照） | 需**多模态**模型；用户 BYOK 的模型不保证支持 → 会成为"看起来支持其实经常失败"的单点依赖，违反 §22 |
| 扫描版 PDF | 同上（需 OCR / 多模态） |
| 音频（`.m4a` / `.mp3`） | 转写通道未定 |
| 压缩包（`.zip`） | 与隐私提示、大小上限的交互太复杂，收益低 |
| `.ics` 之外的日历交换格式（`.vcs` 等） | 无实际需求 |

#### 统一限制

| 项 | 上限 | 超限行为 |
|---|---|---|
| 单文件大小 | 5 MB | 拒绝并说明（不截断） |
| 单批 draft 数 | 200 条 | 解析到上限即停，**明确告知"已截断，可再次导入剩余部分"**（不静默丢） |
| 送入模型的文本 | 每块 12k 字符 | 分块**串行**处理，显示进度，可中断 |
| 单文件解析耗时 | 30 s | 超时中断，保留已解析部分 |

### [S2.3] 三段流水线

```text
文件
 │
 ├─(1) Extract ──────────► ImportDraft[]        AI 或确定性抽取；只产出「原文里有什么」
 │                                              每条必带 source_quote + source_locator
 │
 ├─(2) Normalize ────────► AttentionItem[] 草稿  本地确定性：时间交给 lib/parse-cn.js
 │                                              字段映射见 [S2.5]；一律 waiting + NEEDS_REVIEW
 │
 └─(3) Commit ───────────► 用户预览确认 → 一笔事务落库 → 原生投影重建
```

**贯穿原则：AI 只做第 (1) 段，且只允许"抽取"，不允许"推断"或"决策"。** 理由：§22
「默认策略优先确定性规则，避免第一版用 LLM 决定关键提醒时间」，以及既有
`aiSystemPrompt()` 里已经存在的禁令（禁止评价优先级、禁止编造未提及的事项）。

### [S2.4] AI 抽取契约

新增独立调用（与既有 `aiParseCapture` 并列，不复用它——单条语义 vs 批量语义不同）：

`aiExtractDrafts(textChunk, context) → ImportDraft[]`

模型必须只返回一个 JSON 对象：

```json
{
  "drafts": [
    {
      "title": "提交季度报销",
      "when_text": "下周三之前",
      "deadline_text": "下周三",
      "repeat_text": null,
      "note": "需要附发票扫描件",
      "tags": ["工作"],
      "source_quote": "下周三之前提交季度报销，需要附发票扫描件",
      "source_locator": "p.2 第 3 段",
      "confidence": "high"
    }
  ]
}
```

字段硬要求：

| 字段 | 要求 | 违反后果 |
|---|---|---|
| `source_quote` | **原文逐字片段**，必须能在输入文本中定位到 | 定位不到 → 该 draft **整条丢弃**并计入"已跳过 N 条" |
| `when_text` / `deadline_text` / `repeat_text` | **必须是原文中出现的字面串**，不得是模型换算出的 ISO 时间 | 出现 ISO 或模型中译 → 视为不合法，退回该字段为 `null`（其余字段保留） |
| `confidence` | `high` / `medium` / `low` | 缺失按 `low` 处理 |
| `title` | 简短、可独立理解；不得含评价性文字 | 空则用 `source_quote` 首行裁剪到 60 字 |
| `tags` | 只允许来自文件结构（文件名、表头、章节名） | 模型自造的标签丢弃 |

**时间的换算权在后端（本地）**：`when_text` → `Lib.parseCn(when_text)` → `triggerAt`。
这保证「导入进来的时间」与「手输同一句话得到的时间」**必然一致**（同一个解析器、同一套
D41 修复后的规则），不会出现两套解析各自漂移。

**两条时间通道（D55，实现期推定）**——D50 约束的是"AI 不得**推断**"，不是"不许有确定时间"：

| 来源 | 携带什么 | 谁来换算 |
|---|---|---|
| **结构化**：`.ics` / `.json` / CSV 的 ISO 列 | 草稿携带**时间戳**（`at_ms`） | 直接采用。**绕一圈自然语言解析只会引入误差** |
| **自然语言**：`.txt` / `.md` / AI 抽取 | 草稿只携带**原文时间串**（`when_text`） | `lib/parse-cn.js` |

两类草稿用 `source_kind`（`"structured"` / `"text"`）标记来源。
**实现按字段判定，而不是按草稿整体判定**：先看有没有 `at_ms` / `deadline_at_ms`，
只有缺失的那个字段才回落到自然语言解析；结构化草稿**已给出时间戳**时 `when_text` 一律忽略并告警
（防两条通道互相污染）。

**禁止清单（写进 system prompt）**：

- 禁止推断原文没有的时间（"考试周"不得换算出具体日期）；
- 禁止判优先级（`priority` 一律 `normal`）；
- 禁止补全未提及的事项、禁止合并多条为一条；
- 禁止给出建议、总结、评价；
- 纯说明文 / 无任何行动项的文件 → **返回空 `drafts`**，不得硬凑（INV-10）。

### [S2.5] ImportDraft → AttentionItem 映射表

| # | draft | AttentionItem | 规则 | 禁止 |
|---|---|---|---|---|
| 1 | `title` | `title` | 空则源引用首行裁剪 60 字 | 不得为空（§6 INV-01 精神：宁可粗糙不可丢） |
| 2 | `when_text` → `parseCn` | `triggerAt` / `windowStart` / `windowEnd` | 高置信度直接落；中置信度照落但标记；低置信度 → **Fallback Trigger** | **AI 路径不得直接给时间戳**（D50） |
| 2b | `at_ms`（仅 `source_kind: "structured"`） | `triggerAt` | 直接采用，不做自然语言解析 | 仅结构化来源可用；文本/AI 来源携带 `at_ms` 视为不合法，丢弃该字段 |
| 3 | 解析失败 / 无时间 | `triggerAt` = `fallbackTriggerAt()` + `isFallbackTrigger = true` + `review_status = NEEDS_REVIEW` | 复用 D-17/D-18 既有兜底语义 | 不得默认"今天就提醒" |
| 4 | `deadline_text` | `deadlineAt` | **仅当原文出现**「截止/到期/最后一天/报名结束」等（§10） | 不得把提醒时间当截止时间 |
| 5 | `repeat_text` | `repeat` | 映射到既有枚举 `day/week/biweek/month/monthEnd/nthWeekday`（与 `normalizeAiResult` 同一张白名单） | 不得自造周期枚举 |
| 6 | `note` | `note` | 可空 | — |
| 7 | `tags` | `tags` | 文件结构派生 | **不得据此创建或归属项目**（D-09） |
| 8 | `source_locator` + 文件名 | `sourceTitle` / `sourceApp` / `url` | `sourceTitle` = `文件名 · p.2 第 3 段`；`sourceApp` = `"import"` | — |
| 9 | — | `status` | **一律 `waiting`** | **不得直接落 `due`**（会立刻进首页，违反 §12 / INV-07） |
| 10 | — | `review_status` | **一律 `NEEDS_REVIEW`**（除用户在预览里逐条确认） | 不得默认 `READY` |
| 11 | — | `priority` | **一律 `normal`** | AI 判优先级（§1.2「不替用户判断优先级」+ 既有 prompt 禁令） |
| 12 | — | `delivery_mode` | 走既有 `resolveDeliveryMode()` 快照 | 不得绕过 |
| 13 | — | `createdAt` / `updatedAt` | 导入时刻；`rev = 1` | — |
| 14 | `source_quote` | **新增** `sourceQuote` | 落库保留，供整理会话展示"这句话从哪来" | — |
| 15 | 文件 SHA-256 | **新增** `importBatchId` | 幂等与回溯 | — |

新增字段 2 个（`sourceQuote`、`importBatchId`）→ 需同步 `normalizeItem()`、`SCHEMA` 迁移、
`currentPayload()` 序列化、导出映射（§22「实现新字段时同步更新迁移脚本、序列化、搜索和归档逻辑」）。

### [S2.6] 「计划」的落点（**D49 已定：方案 C**）

| 方案 | 落地形态 | 基线影响 | 裁决 |
|---|---|---|---|
| **A** 批量 Capture | 文件 → 一批事项，全部进 `NEEDS_REVIEW` | 不需改基线 | — |
| **B** 建立计划/项目 | 按文件结构自动建项目 + 归属 | **需修订 §1.3 + D-09** | ❌ 否决 |
| **C** A + 预览分组 | 同 A，预览里按章节/表格分组**仅作展示**，不落库成容器 | 不需改基线 | ✅ **采用** |

**落地要求**：分组信息只存在于**预览界面**，不写入条目、不产生"项目/计划"记录；
条目导出时也不携带分组（`source_quote` / `source_title` 已足以还原来源）。

⚠️ 代码中已存在 `projects` / `projectId` / 设置页「项目」入口，与 D-09 冲突。
那是**先于本需求存在的漂移**，本次只是保证导入不把它固化；**需单独裁决**。

### [S2.7] 批处理与确认形态

| 项 | 规则 |
|---|---|
| 先预览后落库 | 第 (1)(2) 段**全在内存**；用户点了确认才进第 (3) 段 |
| 预览分组（D49） | 按来源文件的小标题 / 表格分堆显示；**分组仅存在于预览**，不落库、不产生"项目/计划"记录 |
| 默认选择（D52） | **全部勾选**，可逐条取消（取消 = **不导入**，不是删除已有） |
| 批量确认的边界（D52） | 这套"全勾选列表"**只用于导入场景**；「待整理」会话本身仍按 §9.4 逐条处理，不因本次而改 |
| 预览必须显示 | 标题 · **系统解析出的时间**（含"未设定时间"）· 来源引用（`source_quote` + 定位）· 是否疑似重复 |
| 落库 | 过 `commitChain` FIFO；**每 50 条一笔事务**，一次导入**不是** 200 次 `saveAsync()` |
| 闸门冲突 | `inflightActionDepth > 0` 时提示"提醒操作正在保存 · 请稍后重新导入"（沿用现有 `importDataFile()` 的保护） |
| 落库后 | 触发既有原生投影对账（INV-09：数据库是事实来源，调度可重建） |
| Review 交互 | 只产生**一次**整理会话（§9.3），不按条目轰炸通知；整理会话卡片里展示 `source_quote` 作为「原始记录」 |
| 归档影响 | 导入的条目**不进首页、不计入 Badge、不参与 `promoteDue()`** —— 直接复用
[deferred-clarification](./deferred-clarification.md) [S2.3] 的既有裁定 |
| 幂等 | 记录**文件内容指纹** + 条目数；同一文件二次导入 → 预览里提示"这批之前导入过（N 条）"，默认**不重复创建**，用户可强制。指纹在浏览器侧优先用 `crypto.subtle` 的 SHA-256，降级为 `lib/import-extract.js` 的 `hash32`（**降级时不得声称是 SHA-256**） |
| 重复项 | 只在预览里标「可能重复」，**不得自动合并**（§13 · [S3]） |
| 失败原子性 | 落库阶段任一条失败 → 整批回滚（复用既有回滚/重放机制），不留半批 |

### [S2.8] 离线与降级（INV-10 / §22）

- **无 AI 配置时 P0 五种类型仍必须可用**：txt 一行一条 / md 列表项 / csv 表头映射 / json 原样 / ics 确定性解析。
- AI 调用中断 → **已解析的 draft 保留在预览里**，横幅标注「未使用 AI 解析」，用户可继续导入或重试。
- 网络不可用 → 与上同。**不得出现"配了 AI 才能导入"的形态。**
- 导入进行中不得阻塞提醒投递（走既有闸门排队，不抢占）。

### [S2.9] 隐私（新增要求，必须可见）

内容导入会把文件正文发送到用户自己配置的 `settings.ai.baseUrl`。因此：

- 导入面板在触发 AI 之前必须显示**目标主机**（如 `api.openai.com`）与"内容将发送到该地址"；
- **AI 路径不得默认开启**（沿用 `settings.ai.enabled` 与 `autoOnSave` 的既有语义）；
- 未配置 AI 时，文案必须写明"将使用本机解析，内容不外发"；
- 导入预览的"来源"区块保留文件路径/定位，便于用户理解系统读到了什么。

（与 INV-06「能力异常必须告知」同向：这里告知的是**能力边界**，不是故障。）

## [S3] Design — 导出

### [S3.1] 格式与范围

| 格式 | 用途 | 说明 |
|---|---|---|
| **JSON `attention-inbox.export/v1`** | **主格式** | 无损、机器可读、可被本应用重新导入（回环）；规范见 [S3.2] |
| **ICS** | 互操作 | `VCALENDAR`；**有截止的 → `VTODO`（`DUE`），否则 → `VEVENT`（`DTSTART` = `triggerAt`）**；两者都带 `VALARM`；周期 → `RRULE`；`UID = <item.id>@attention-inbox` |

**ICS 的两条硬规定**：

1. **时刻一律用 UTC（`...Z`）**（D56）。不带 `VTIMEZONE` 却写 `DTSTART;TZID=Asia/Shanghai` 是
   **不合规**的 ICS；而 JSON 侧已经用「当地时间 + 偏移」承载了 §15 的当地语义。
   **JSON 保语义，ICS 保通用。**
2. **`time_source === "FALLBACK"` 的条目不进 ICS。** [S3.3] 明文要求消费方不得据兜底时间建日程 ——
   那就不能由我们自己把它塞进日历格式里。排除数量需在导出结果里回报。
   （JSON 仍然包含这些条目，只是带 `time_source: "FALLBACK"` 标注。）
| CSV | 人读 / 表格 | 可选，字段同 JSON 的扁平子集 |

**范围选择**（导出前可配）：

| 选项 | 默认 |
|---|---|
| 全部条目 / 仅未完成（未 `completed`、未 `archived`） / 仅 Future / 时间区间 | 仅未完成 |
| 包含已归档 | 否（**D54**） |
| 包含待整理（`NEEDS_REVIEW`） | **是**，且带 `review_status` 标注供消费方自行决定（**D54**） |
| 包含备注正文 | 是 |
| 包含设置 | 否（设置只进"恢复备份"，不进内容导出） |

### [S3.2] 字段结构与格式规范

**完整机器可读规范见 [`schemas/attention-inbox.export.v1.schema.json`](./schemas/attention-inbox.export.v1.schema.json)**
（JSON Schema 2020-12）；**可校验的样例见
[`schemas/attention-inbox.export.v1.example.json`](./schemas/attention-inbox.export.v1.example.json)**。

**一键核对**（正例 + 一致性 + 8 个负例，**最近一次 21/21 通过**）：

```bash
/Users/qlyf/.workbuddy/binaries/python/envs/default/bin/python \
    scripts/verification/export-schema-check.py
```

该脚本做四件事：① 校验仓库样例；② 用 node **现场跑 `lib/export-format.js`** 生成一份导出件再校验；
③ 逐项核对 ICS 的硬规定（UTC、75 字节折行、CRLF、兜底不进日历、ACK 周期无 RRULE）；
④ 跑负例——**每一例都必须被拒绝**，否则说明某条约束其实没生效。

**已实测的约束**（2026-09-18）：

| 用例 | 结果 |
|---|---|
| 样例文件 / 现场生成的导出件 | ✅ 通过 |
| 条目字段集与 schema `properties` | ✅ 完全相等（多一个少一个都算失败） |
| `attention_status` 改成 `DONE` | ✅ 拒绝（枚举不含） |
| `attention_status` 改成 `COMPLETED`（把 ACK 当完成） | ✅ 拒绝 |
| `importance` 改成 `URGENT` | ✅ 拒绝 |
| 时间串去掉时区偏移 | ✅ 拒绝（`pattern` 要求偏移或 `Z`） |
| ACK 周期锚 `rrule: FREQ=WEEKLY;INTERVAL=2` | ✅ 拒绝（`if/then` 硬约束） |
| `nthWeekday` 缺 `nth`/`dow` | ✅ 拒绝 |
| 删掉顶层 `scope` | ✅ 拒绝（required） |
| 条目上多一个未声明字段 | ✅ 拒绝（`additionalProperties: false`） |
| 导出件里残留 `apiKey` | ✅ 拒绝（`scanSecrets` 命中） |
| 正常 `mode: "ack"` + `rrule: null` | ✅ 通过 |

> 「ACK 周期不得伪造 RRULE」原本只写在文档里，靠人自觉。**已改成 schema 的 `if/then` 硬约束**——
> 因为一旦有人用近似 RRULE 填充，消费方就会按固定日历重复建日程，这是 §22 禁止的"错误智能"。

要点：

#### 顶层

| 字段 | 类型 | 说明 |
|---|---|---|
| `format` | string 常量 | `"attention-inbox.export"` |
| `format_version` | string 常量 | `"1.0"` |
| `generator` | object | `{ app, app_version, internal_schema }` —— 内部 schema 号，便于消费方定位差异 |
| `exported_at` | string | ISO 8601 **带 UTC 偏移** |
| `exported_at_ms` | integer | epoch 毫秒（消歧） |
| `timezone` | string | IANA 名，如 `Asia/Shanghai`（§15 当地语义） |
| `scope` | object | 本次导出范围，供消费方理解"为什么缺了东西" |
| `counts` | object | `items` 总数 + 按各维度分布 |
| `items` | array | 见下 |
| `extensions.internal` | object | **回环用**：放 `notes` / `projects` / 设置子集等**整库级**内部数据。消费方**必须忽略** |

#### 每条 item（对外契约字段）

按 §5.1 的基线语义命名（`snake_case`），**不是**内部 `camelCase` 的原样倾倒——导出是一个独立契约，
不能把内部实现细节暴露成别人的接口。

| 导出字段 | 来源（内部） | 说明 |
|---|---|---|
| `id` | `id` | 稳定标识，消费方应原样保留 |
| `rev` | `rev` | 变更检测用 |
| `title` | `title` | |
| `content` | `note` | 正文/说明 |
| `original_capture` | **无对应字段 → `null`** | ⚠️ **已知缺口**：§5.1 定义了该字段，代码未落地。导出**如实置 null**，不臆造 |
| `url` | `url` | |
| `tags` | `tags` | |
| `attention_status` | `status` **派生** | `waiting`/`snoozed` → `WAITING`；`due` → `DELIVERED`；`acknowledged` → `ACKNOWLEDGED` |
| `review_status` | `review_status` | `READY` / `NEEDS_REVIEW` / `REVIEWED` |
| `completion_status` | `status` + `completedAt` **派生** | `completed`/`archived` → `COMPLETED` / `ARCHIVED`；其余 `ACTIVE` |
| `deadline_status` | `deadlineAt` + `deadlinePaused` + 现值 **派生** | 无 → `NONE`；未到 → `PENDING`；临近 → `PROTECTED`；已过未完成 → `PASSED`；暂停 → `PENDING` + `deadline_paused: true` |
| `importance` | `priority` 派生 | `normal`/`important`/`critical` → `NORMAL`/`IMPORTANT`/`CRITICAL` |
| `trigger_at_iso` / `trigger_at_ms` | `triggerAt` | **双写**，消时区歧义 |
| `trigger_window_start_iso` / `_end_iso` | `windowStart` / `windowEnd` | 柔性窗口（D-07） |
| `time_source` | `isFallbackTrigger` 派生 | `USER` / `PARSED` / `FALLBACK`。⚠️ **已知缺口（D57）**：内部没有"用户显式设定过时间"的持久标记，**当前只会产出 `PARSED` 或 `FALLBACK`**，`USER` 保留在枚举里待补。**少给一个取值比猜一个安全** |
| `deadline_at_iso` / `deadline_at_ms` | `deadlineAt` | |
| `deadline_paused` | `deadlinePaused` | |
| `repeat` | `repeat` | `{ every, mode }` + **派生 `rrule`**（RFC 5545，消费方可直接用） |
| `source_title` / `source_url` / `source_app` | 同名字段 | |
| `created_at_iso` / `created_at_ms` | `createdAt` | |
| `acknowledged_at_*` / `reviewed_at_*` / `completed_at_*` | 对应字段 | 可为 `null` |
| `derived` | — | **字符串数组**，列出本条中由本应用派生而非存储的字段名 |
| `source_quote` | `sourceQuote`（导入新增） | 该条在来源文件中的原文片段 |
| `extensions.internal` | 内部字段 | **逐条**回环用：`status`（原始枚举）/ `scheduleBasis` / `delivery_mode` / `isFallbackTrigger` / `deadlineStageKey` / `deadlineEvents` / `seriesId` / `repeatParentId` / `ackAdvancedAt` / `importBatchId` 等。消费方**必须忽略** |

**`derived` 是这套规范的诚实条款**：四维正交状态在本应用内部并未全部作为独立字段存储，
是导出时按确定性规则**计算**出来的。标注出来，消费方才知道哪些字段可以被信任为"用户设定的事实"，
哪些是"本应用的解释"。**没有这一条，导出就是在撒谎。**

#### 时间与周期

- 所有 `*_iso` 均为**带偏移**的 ISO 8601（`2026-09-23T21:30:00+08:00`），并同时给 `*_ms`；
- `repeat.rrule` 由 `every` + `triggerAt` 派生（例：`every: "month"` 且锚 15 日 →
  `FREQ=MONTHLY;BYMONTHDAY=15`），与 `lib/repeat.js` 的语义保持同一套规则；
- `repeat.mode: "ack"`（ACK-based 周期）**没有对应的 RRULE**，此时 `rrule` 置 `null`
  并在 `derived` 里不含 `repeat.rrule` —— **不得**用 `FREQ=DAILY;INTERVAL=14` 之类的近似糊弄。

#### 安全

- **不导出任何密钥**：`settings.ai.apiKey` / `baseUrl` 一律不出现（既有 `exportData()` 已有此约束，继承）；
- 不导出 `state.ui`（纯界面状态）；
- 导出是**用户显式触发**的本地文件操作，**不自动、不上传、不同步**（§23 D-20）。

### [S3.3] 对外语义契约（给消费方，必须写进文档头）

这是一份"别人要照着建提醒/日程/待办"的格式，所以必须把**本产品的语义红线**明确传递出去，
否则第一个消费方就会把语义用错：

| 导出形态 | 消费方**必须**理解为 | 消费方**不得**理解为 |
|---|---|---|
| `attention_status = ACKNOWLEDGED` | 用户**看到了**这条提醒 | ❌ 事情已完成（INV-04：ACK ≠ Complete） |
| `completion_status = ACTIVE` + `attention_status = ACKNOWLEDGED` | 已看到、未完成 → **应当建为待办** | ❌ 已完成、可忽略 |
| `time_source = FALLBACK` | 时间是**系统兜底值**，不是用户本意 | ❌ 可据此建立日程 |
| `review_status = NEEDS_REVIEW` | 信息质量未二次确认 | ❌ 无效数据（可导入但宜标记为"待确认"） |
| `deadline_status = PASSED` | 已过截止仍未完成 | ❌ 已完成 |
| `importance = CRITICAL` | 用户显式开启的最强提醒 | ❌ 可自行提高或降低提醒强度 |

建议的消费方映射（写进文档，供对接方参考）：

| 用途 | 取哪些 | 映射 |
|---|---|---|
| 日程 / 日历 | `deadline_at_iso` ≠ null，或 `trigger_at_iso` 且 `time_source ≠ FALLBACK` | `VEVENT`（DTSTART = 该时刻，VALARM 提前/准点） |
| 提醒事项 | 同上 | `VTODO` / 系统提醒 |
| 待办 | `completion_status = ACTIVE` | 待办项；`attention_status` 不参与"是否完成"判断 |
| 周期 | `repeat.rrule` ≠ null | 原生 RRULE |

### [S3.4] 与既有"恢复备份"的关系

| | 恢复备份（现有） | 内容导出（新增） |
|---|---|---|
| 目的 | 灾备、换机 | 供外部程序消费 |
| 形态 | 内部结构原文（`settings` + `items` + `notes` + `projects`） | 对外契约（`items` 派生视图） |
| 可否回环 | 是（本应用自用） | **是**（导出件可被本应用导入，无损） |
| 密钥 | 置空 | 不出现 |

两者**并存**，入口文案必须区分。

## [S4] 与十条不变量的核验

| 不变量 | 影响 |
|---|---|
| INV-01 Capture 不失败 | **受益**——导入侧"表头不认识也必须能导""无 AI 也必须能导"都是这条的延伸 |
| INV-02 Trigger 不被 Review 阻断 | **须验证**：导入条目全部 `NEEDS_REVIEW`，**其 `triggerAt` 必须照常生效**（[S2.5] 第 2 条的高置信度路径不得被 Review 状态压制）。这是本特性最容易被写错的一条 |
| INV-03 仅显式 ACK 才算看到 | 不受影响（导入不产生 ACK） |
| INV-04 ACK ≠ Complete | **需对外守住**——[S3.3] 的核心 |
| INV-05 Deadline Protection 不被静默覆盖 | **须验证**：导入带 `deadlineAt` 的条目必须正常进入保护点排程 |
| INV-06 丧失提醒能力必须告知 | **受益**——[S2.9] 的隐私告知是同一精神的延伸 |
| INV-07 未来事项不占首页 | **须验证**：`status` 一律 `waiting`、全部 `NEEDS_REVIEW` → 不进首页 |
| INV-08 Review 只提高信息质量 | **受益**——导入即复用既有整理流程，未新增任务管理概念 |
| INV-09 数据库是事实来源、调度可重建 | **须验证**：导入后必须触发对账；新增的 2 个字段须入库并参与重建 |
| INV-10 自动化宁可保守 | **核心约束**——[S2.4] 的全部禁令都由它推出 |

## [S5] Out of Scope

- 图片 / 扫描件 / 音频（多模态 OCR、转写）——见 [S2.2] P2（**D53 已定：不做**）
- 自动建项目 / 计划容器（**D49 已否决**）
- 自动合并相似条目（§13 永久禁止）
- 云同步 / 账号（D-20）
- 导出后自动推送到日历或第三方（§3.4：不同步、不上传）
- 双向同步（导出 → 外部修改 → 回流）
- AI 判断优先级、AI 决定提醒时间（§22 永久禁止）

## [S6] 裁决结果（2026-09-18，原「待裁决」）

全文见 [D49–D54](../../decisions/import-export-ruling-2026-09-18.md)。**六项全部采纳推荐方案，且不修订基线。**

| # | 原问题 | 裁决 |
|---|---|---|
| Q1 | 「计划」的落点 | **方案 C**（D49）—— 不建容器；预览分组仅作展示 |
| Q2 | AI 能否推断原文未写的时间 | **不能**（D50）—— 只抽取 |
| Q3 | 导入条目进不进首页 | **不进**（D51）—— 一律 `NEEDS_REVIEW` |
| Q4 | 大批量确认形态 | **默认全勾列表**，仅限导入场景（D52） |
| Q5 | 图片 / 扫描件是否进本期 | **不做**（D53） |
| Q6 | 导出是否含待整理与已归档 | 待整理**含并标注**、已归档**默认不含**（D54） |

**实现期推定**（D55–D57，未单独裁决，如与预期不符请指出）：

| # | 推定 | 落地位置 |
|---|---|---|
| D55 | 时间载体分两类：结构化来源给时间戳，自然语言来源给原文串 | [S2.4] · [S2.5] 第 2/2b 条 |
| D56 | ICS 导出用 UTC（`Z`）表达时刻 | [S3.1] |
| D57 | `time_source` 当前不产出 `USER`（内部无该持久标记） | [S3.2] 已知缺口 |

**仍未解决的遗留**：代码中的 `projects` 与 D-09 冲突，需**单独裁决**（见 [S2.6] 末尾）。

## Tasks

> 图例：✅ 本轮已完成并测过 · 🔶 部分完成（下列注明缺口） · ⬜ 未开始
>
> **本轮范围 = 纯逻辑层**（`lib/*.js`，无 DOM / 无 Capacitor 依赖，全部可由 node 单测覆盖）。
> 涉及 `app-core.js` 提交闸门、UI、原生投影、AI 调用的部分**单独一轮**做，
> 因为它们动的是本仓库最脆的部分（FIFO 闸门 / 回滚重放 / 投递台账）。

### 导入

- [ ] T1: 拆分入口 —— 「恢复备份（覆盖）」保留原逻辑，新增「导入内容（追加）」 — acceptance: 内容导入不改变任何既有条目；恢复备份仍覆盖 (covers: S2.1)
- [x] T2: 实现 P0 五种类型的确定性抽取（txt/md/csv/json/ics） — `lib/import-extract.js`；acceptance: 不配置 AI 时可完成导入；ics 不经过 AI (covers: S2.2)
- [x] T3: CSV 表头映射 + 表头不认识时的回退 — acceptance: 任意两列 CSV 均能抽出条目，不报错拒绝 (covers: S2.2)
- [ ] T4: 新增 `aiExtractDrafts()` + system prompt 禁令清单 — acceptance: 模型返回的 ISO 时间被拒收为 null；无 `source_quote` 的 draft 被丢弃并计数 (covers: S2.4)
- [x] T5: 时间换算走 `lib/parse-cn.js`（**注入式**，不复制解析逻辑） — `lib/import-map.js`；acceptance: 同一 `when_text` 在导入与手输两条路径得到**相同** `triggerAt`（单测逐字比对） (covers: S2.4)
- [x] T6: 实现 [S2.5] 映射表（含 2 个新字段 `sourceQuote` / `importBatchId`） — acceptance: 导入条目 `status === "waiting"`、`review_status === "NEEDS_REVIEW"`、`priority === "normal"` 均已断言 (covers: S2.5)
- [ ] T7: `SCHEMA` 迁移 + `normalizeItem()` + 序列化同步 — acceptance: 旧数据加载后两字段有默认值；`schemaMigrationNeeded` 正确置位 (covers: S2.5)
- [ ] T8: 导入预览页（dry-run）—— 含系统解析时间、来源引用、疑似重复标记 — acceptance: 未确认前不产生任何写入 (covers: S2.7)
- [ ] T9: 落库走 `commitChain` + 每 50 条一笔事务 + 整批原子性 — acceptance: 200 条导入的 `saveAsync()` 调用 ≤ 4 次；中途失败不留半批 (covers: S2.7)
- [ ] T10: 导入后触发原生投影对账 — acceptance: 新条目在原生通知面板可见 (covers: S2.7)
- [ ] T11: 幂等 —— 文件内容指纹台账（`crypto.subtle` SHA-256 优先，降级 `hash32`） — acceptance: 同一文件二次导入默认不新增条目 (covers: S2.7)
- [ ] T12: 导入的 fallback 条目不进首页 / 不计 Badge / 不参与 `promoteDue()` — acceptance: 同 [deferred-clarification] [S2.3] 的既有断言 (covers: S2.7)
- [ ] T13: AI 失败降级 + 隐私告知 — acceptance: 无 AI 配置时提示"使用本机解析，内容不外发"；有配置时显示目标主机 (covers: S2.8, S2.9)
- [x] T14: 上限与超时 —— 5 MB / 200 条已在 `lib/import-extract.js` 落地并断言（**触顶时如实报告 `skipped` 条数**，不静默截断）；12k 字符分块与 30 s 超时属 AI 路径，随 T4 一起做 (covers: S2.2)

### 导出

- [x] T15: 实现 `attention-inbox.export/v1` 生成器（含四维派生与 `derived` 标注） — `lib/export-format.js`；acceptance: 产出物通过 schema 校验（单测 + `export-schema-check.py` 双通道） (covers: S3.2)
- [x] T16: 时间双写 + `timezone` + `time_source` — acceptance: 导出件不含无偏移的时间字符串（schema `pattern` 强制，负例已验证） (covers: S3.2)
- [x] T17: `repeat.rrule` 派生；`mode: "ack"` 时置 `null` — acceptance: ACK 周期不产生近似 RRULE（6 种 `every` 全覆盖断言 + schema `if/then` + 负例） (covers: S3.2)
- [x] T18: ICS 导出（VTODO/VEVENT + VALARM + RRULE） — acceptance: 时刻全 UTC、行宽 ≤ 75 字节、CRLF、兜底时间不进日历（已断言） (covers: S3.1)
- [x] T19: 范围选择 + 密钥排除 — acceptance: 导出件中不含 `apiKey` / `baseUrl`（`scanSecrets` 断言 + 负例）；范围内条目数与 `counts` 一致 (covers: S3.1, S3.2)
- [~] T20: 回环无损 —— 抽取侧已实现（自家导出件识别 + `internal` 白名单回环 + 单测），**经 app-core 落库的完整往返待下一轮** — acceptance: 关键字段（含 `rev`、台账、`sourceQuote`）往返后一致 (covers: S3.4)
- [~] T21: 对外语义契约写入产出物 —— **ICS 侧已写**（`DESCRIPTION` 含「已看到，未完成（ACK != Complete）」+ `X-ATTENTION-*` 属性）；**JSON 侧待补**：在顶层加契约摘要字段，或明确要求消费方读 schema 的 `description` (covers: S3.3)

### 测试

- [~] T22: 状态机单测 —— 映射表逐行断言已完成、`INV-07`（一律 `waiting`）已断言；`INV-02` / `INV-05` 需在 app-core 层验证，随 T7 一起做 — acceptance: 见 [S4] (covers: S2.5, S4)
- [ ] T23: 解析一致性 —— 扩展 `scripts/verification/parse-parity.js` 覆盖导入路径 — acceptance: 两路径零差异 (covers: S2.4)
- [x] T24: `scripts/verification/export-schema-check.py` —— 13 项正例/一致性 + **8 个负例**（非法枚举、ACK 当 COMPLETED、无偏移时间、ACK 伪造 RRULE、`nthWeekday` 缺字段、缺顶层字段、未声明字段、非法 `importance`）— acceptance: 21/21 通过，可被 CI 复跑 (covers: S3.2)
- [ ] T25: 导出件中 `derived` 数组与实际派生字段一致性断言（当前只断言了代表性字段，未逐字段核对）— acceptance: 声明派生却实际存储、或反之，均报错 (covers: S3.2)

### 本轮新增的守护

- [x] 单测与对外 schema **字段集交叉核对**：条目字段集合必须与 `attention-inbox.export.v1.schema.json` 的
  `properties` **完全相等**（既抓"多"也抓"少"）——代码与契约不再可能各自漂移。
- [x] `DEADLINE_LEAD_MS` 与 `lib/reminder.js` 的一致性断言 —— 防止导出侧长出第二套"提前多久算临近截止"。
- [x] 测试基线：unit **249** / native **225** / smoke **193** / regressions **574**，四套合计 **1241**，
  **0 失败**。对齐口径（两处都已复核，避免"基线"一词被两种含义混用）：
  - `git show HEAD:test-unit.js` 单独跑 = **105 / 0** —— 仓库提交版的真实水位；
  - 本会话动手前的工作树口径 = **132 / 0** —— 早前几轮 review 修复加了 27 条但未提交；
  - 本次新增三段**静态**断言 **117** 条（`export-format` 53 / `import-extract` 42 / `import-map` 22）。
    注意：部分断言写在循环内会被重复执行，故运行时的 249 高于"132 + 117 = 249"以外的其他段，静态条数不等于增量，**不要用静态计数反推运行时差值**。
