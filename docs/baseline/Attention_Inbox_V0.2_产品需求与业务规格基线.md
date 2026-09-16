# Attention Inbox V0.2 产品需求与业务规格基线

**文档状态：** Baseline / 冻结基线  
**版本日期：** 2026-09-16  
**产品形态：** iOS / Android 手机 App  
**产品口号：** Remember less. Miss nothing. / 少记挂，不错过。

## 0. 执行摘要

Attention Inbox 不是 Todo App、日历或 AI 自动排程工具。它负责管理“某件事情什么时候有资格重新占用用户的注意力”。用户可以用极低成本捕获一件未来事项，然后暂时忘记；系统在合适的时间重新唤醒，并通过明确 ACK 机制确认用户是否真正看到。

- 核心价值：让用户获得“已经交给系统，所以现在可以放心忘记”的心理安全感。

- 通知发送不等于用户看到；只有用户明确点击“我知道了”才算 ACK。

- ACK 不等于完成；“我知道了”“稍后提醒”“待整理”“完成”是不同动作。

- Future 默认隐藏，避免未来事项提前消耗当前注意力。

- Capture 可以粗糙但不能丢；Review 可以延期但不能阻断 Reminder；Deadline Protection 独立存在。

- 任何会破坏提醒可靠性的系统异常必须对用户可见。



## 1. 产品定义与边界

### 1.1 一句话定义

Attention Inbox 是一个让用户安全地把未来需要关注的事情交出去，并在合适的时候可靠地重新获得这部分注意力的系统。

### 1.2 产品负责什么

- 低摩擦捕获未来事项。

- 解析提醒时间、柔性时间窗口、周期与明确的截止时间。

- 在正确时机主动提醒。

- 可靠区分 DELIVERED / OPENED / ACKNOWLEDGED。

- 支持 Snooze、Deferred Clarification（待整理）与 Complete。

- 对硬 Deadline 做独立保护。

- 自动保留来源上下文，帮助未来恢复认知现场。



### 1.3 产品明确不负责什么

- 不替用户判断事情的优先级；默认无优先级，仅允许用户主动标记“重要/关键”。

- 不替用户规划完整日程，不做 Motion 类自动排程。

- 不做 Project、子任务、Kanban、甘特图、四象限。

- 不做番茄钟、时间统计、效率评分、打卡。

- 不主动推荐用户“应该关注什么”。

- 不自动判断用户当前是否有空。

- 不以 DAU、打开时长为核心产品目标。



## 2. 产品级不变量（所有实现不得违反）

| 编号 | 不变量 |

| --- | --- |

| INV-01 | Capture 不能因信息不完整而失败。 |

| INV-02 | 已存在的 Attention Trigger 不能被 Review 状态阻断。 |

| INV-03 | 仅显式 ACK 才算“用户已看到”。 |

| INV-04 | ACK 绝不等于 Complete。 |

| INV-05 | Deadline Protection 不能被普通状态静默覆盖。 |

| INV-06 | 系统丧失提醒能力（权限、调度等）必须明确告知用户。 |

| INV-07 | 未来事项默认不主动占用首页注意力。 |

| INV-08 | Review 只提高信息质量，不升级为任务管理。 |

| INV-09 | 数据库是事实来源；系统通知/Alarm 是可重建执行层。 |

| INV-10 | 自动化宁可保守，不得因为错误“智能”导致漏提醒。 |



## 3. 核心概念与术语

| 术语 | 定义 |

| --- | --- |

| Attention Item | 用户交给系统的一条未来关注事项。 |

| Capture | 把一件事快速交给系统的动作。 |

| Attention Trigger | 某事项应重新进入用户注意力的时间点。 |

| Trigger Window | 允许系统在某一时间窗口内选择提醒时机。 |

| ACK / 我知道了 | 用户明确确认自己已看到，不代表完成。 |

| Snooze / 稍后提醒 | 用户已看到，但要求未来再次唤醒。 |

| Review / 待整理 | 延迟澄清信息质量，解决粗糙 Capture。 |

| Review Window | 集中整理 NEEDS_REVIEW 项的固定或柔性时间。 |

| Deadline | 用户语义中明确存在的硬截止时间。 |

| Deadline Protection | 即使事项已 ACK，只要未完成且临近 Deadline，仍可重新唤醒。 |

| Important / 重要 | 提高未 ACK 事项的追踪频率与显著性。 |

| Critical / 关键 | 用户显式开启的“绝不能错过”模式，可使用更强提醒能力。 |

| Future | 尚未到达提醒时间的事项空间，默认不在首页展示。 |

| Archive | 已完成事项历史，仅主动搜索/查看时出现。 |



## 4. 四引擎业务架构

| 引擎 | 职责 |

| --- | --- |

| Capture Engine | 负责“先收下来”：极速录入、Share Sheet、原始上下文保存、解析结果落库。 |

| Attention Engine | 负责“什么时候重新出现”：Trigger、Window、通知、ACK、Snooze、重要/关键升级。 |

| Review Engine | 负责“之后集中整理”：NEEDS_REVIEW、Review Schedule、Review Session、Snooze/Skip。 |

| Deadline Engine | 负责“硬时间保护”：Deadline 抽取、保护点、Deadline Passed。 |



```text
Capture Engine
      │
      ▼
 Attention Item ──────► Attention Engine
      │                      │
      ├──────────────► Review Engine
      │                      │
      └──────────────► Deadline Engine
                             │
                             ▼
                  Effective Reminder Plan
```

## 5. 数据模型与正交状态

禁止把所有组合状态塞进单一巨大枚举。一个 Attention Item 至少包含以下正交维度：

| 维度 | 说明 |

| --- | --- |

| attention_status | WAITING / DELIVERED / ACKNOWLEDGED / SNOOZED 等，描述“注意力交付状态”。 |

| review_status | READY / NEEDS_REVIEW / REVIEWED，描述“信息质量状态”。 |

| completion_status | ACTIVE / COMPLETED / ARCHIVED，描述“事情是否结束”。 |

| deadline_status | NONE / PENDING / PROTECTED / PASSED 等，描述“硬截止风险”。 |



### 5.1 AttentionItem 建议字段

- id

- original_capture

- content

- created_at

- updated_at

- attention_status

- review_status

- completion_status

- deadline_status

- trigger_at

- trigger_window_start

- trigger_window_end

- time_source（PARSED / USER / FALLBACK）

- deadline_at

- importance（NORMAL / IMPORTANT / CRITICAL）

- repeat_rule

- repeat_mode（CALENDAR / ACK_BASED）

- source_title

- source_url

- source_app

- source_context

- reason / note（可选）

- acknowledged_at

- reviewed_at

- completed_at

- archived_at

- version（用于旧通知/并发动作校验）



## 6. Capture 需求

- 打开 App 默认直接进入输入页。

- 目标路径：1 次唤起 + 1 句话 + 自动保存；目标耗时 ≤ 5 秒。

- 默认无需再次点击“保存/确认”，保存后短暂展示“已设置：时间 · 修改”。

- 支持 App 内输入、Share Sheet、桌面/锁屏快捷入口；语音直接复用系统/第三方输入法。

- 分享来源自动保存标题、URL、来源 App 与创建时间；“为什么关注”可选，不强迫。

- 任何无法解析时间或内容粗糙的输入仍必须成功保存。



### 6.1 时间解析

| 情况 | 处理 |

| --- | --- |

| 高置信度 | 直接保存并展示解析结果，例如“明天 20:00”。 |

| 中置信度 | 自动保存，明显展示结果供修改，例如“周末 → 本周末”。 |

| 低置信度 | 保存成功，同时标记 NEEDS_REVIEW；仅在必要时给极简选择。 |

| 无法识别 | 使用 Fallback Trigger，并进入 NEEDS_REVIEW。默认 Fallback 为“下一个 Review Window”；若未设置 Review Window，则使用系统默认次日晚间。 |



## 7. Attention Lifecycle 与用户动作

```text
CAPTURED → WAITING → DELIVERED → (OPENED 可选记录)
                         │
                         ├─ 我知道了 → ACKNOWLEDGED
                         ├─ 稍后提醒 → ACKNOWLEDGED + SNOOZED → WAITING
                         ├─ 待整理   → ACKNOWLEDGED + NEEDS_REVIEW
                         └─ 完成     → COMPLETED → ARCHIVED
```

| 动作 | 语义与状态 |

| --- | --- |

| 我知道了 | Attention Delivery 完成；停止当前追提醒；事项仍未完成。 |

| 稍后提醒 | 表示“已看到，但现在不适合继续关注”；重新选择时间后回 WAITING。 |

| 待整理 | 从提醒入口点击时同时视为 ACK；进入 NEEDS_REVIEW；不创建重复 Item。 |

| 完成 | 事项结束，进入 Archive。 |



## 8. 提醒与升级策略

| 等级 | 策略 |

| --- | --- |

| 普通 | 到点主动提醒；未 ACK 时有限补提醒；达到上限后进入未确认区，不无限追击。 |

| 重要 | A+B：重复提醒 + 提高通知显著性；持续追踪强于普通事项。 |

| 关键 | 用户显式开启；在系统/权限允许时可使用闹钟级或更强提醒。不得偷偷降级而不告知。 |



### 8.1 ACK 判定

- DELIVERED 仅代表通知送达设备。

- OPENED 仅记录用户打开通知/App。

- 只有点击“我知道了”“稍后提醒”或“待整理”等明确动作，才可产生 ACK。

- 系统不得根据解锁、进入 App、通知消失等行为推测 ACK。



## 9. Deferred Clarification / Review Engine

Review 的目标是允许 Capture 阶段保持极低摩擦，把信息质量问题延迟到固定时间集中解决。Review 是信息质量流程，不是任务状态。

### 9.1 进入 NEEDS_REVIEW 的典型条件

- 无明确提醒时间。

- 时间解析置信度较低。

- 内容过于模糊。

- 分享内容缺少有效标题/上下文。

- 用户主动选择“先收着/待整理”。

- 从 Reminder 点击“待整理”。



### 9.2 Review Schedule

- MVP 支持一个每日默认 Review Window。

- 支持全局默认 + 今日临时覆盖；今日覆盖次日自动恢复。

- 可使用固定时间或柔性窗口。

- Review 功能可完全关闭；关闭后 NEEDS_REVIEW 数据仍保存，已有 Trigger 仍正常工作。



### 9.3 Review Session

| 场景 | 规则 |

| --- | --- |

| 无待整理事项 | 不发送 Review Notification。 |

| 存在待整理事项 | 只创建一次 Review Session，不按 Item 分别轰炸通知。 |

| 通知动作 | 开始整理 / 稍后 / 今天跳过。 |

| 未响应 | 按用户可配置的间隔与次数有限补提醒；达到上限后滚入下一个 Review Window。 |

| Quiet Hours | Review Reminder 必须受勿扰/睡眠规则约束。 |

| 中途退出 | 逐条即时持久化，下次只继续剩余项。 |



### 9.4 Review 单条操作

- 确认：当前内容/时间已足够未来理解。

- 修改：仅修改标题/内容、提醒时间/窗口、可选备注。

- 删除：删除无价值 Capture。

- 继续待整理：若用户仍不知道什么时候/如何整理，可以继续 NEEDS_REVIEW，不强迫填写。

- P1 可支持一次处理 5/10 条或批量确认清晰事项。



## 10. Deadline Engine

- Deadline 不是必填字段，仅在用户语义明确出现“截止/到期/最后一天/报名结束”等时提取。

- 显式用户提醒（例如“提前 5 天”）优先于默认保护策略。

- 已 ACK 但未完成的事项，在临近 Deadline 时允许再次唤醒。

- NEEDS_REVIEW 不得阻断 Deadline Protection。

- Deadline 到达仍未完成时进入 DEADLINE_PASSED 风险状态；允许完成、重新安排、保留未完成，不无限轰炸。



### 10.1 默认保护点

MVP 使用确定性分层规则，不使用 AI 估算任务难度。规则以配置常量实现；示例：较远 Deadline 可在 3 天前 + 1 天前保护，较近 Deadline 至少保留一个 24 小时/短期保护点。具体数值可在实现阶段参数化。

## 11. 周期事项

| 规则 | 说明 |

| --- | --- |

| 固定周期 | 按日历规则继续，例如“每月 1 日”。 |

| ACK-based 周期 | 从本次 ACK 实际时间重新计时，例如“每隔 14 天重新关注”。 |

| 完成 | 对周期事项，“完成”默认表示完成本次实例。 |

| 停止重复 | 二级操作，用于终止整个周期规则并归档。 |

| Review | 整理主 Item 的内容和规则，不要求每个周期实例重复 Review。 |



## 12. 信息架构与首页规则

| 区域 | 规则 |

| --- | --- |

| 首页第一视觉 | 现在需要注意：只显示当前真正需要用户 Attention 的事项。 |

| 首页第二视觉 | 已看到未完成 · N：弱化展示，主动点开才看明细。 |

| 待整理 | 弱入口“待整理 · N”，仅在 Review Window 或用户主动进入时提高存在感。 |

| Future | 默认隐藏，但可主动查看、搜索、修改、删除。 |

| Archive | 已完成历史；默认不主动重新浮现；支持搜索和重新打开。 |

| Badge | 只统计当前需要确认的 Attention 数，不统计全部未完成/Future/Archive。 |



## 13. 上下文与搜索

- 自动保存 source_title / source_url / source_app / created_at。

- 保留 original_capture，用户修改内容后仍可回溯；前台默认隐藏。

- 搜索覆盖 Future、已看到未完成、Archive。

- 重复 Capture 或同 URL：先保存，再轻提示“可能已有类似记录”；不得自动合并。

- 历史不主动制造“年度总结/完成数”等注意力噪声。



## 14. 可靠性、异常与自愈

| 异常/操作 | 处理原则 |

| --- | --- |

| 删除 | 必须撤销该 Item 的所有未来通知/Alarm/周期/Deadline 调度；普通删除支持短时 Undo。 |

| 编辑时间 | 取消旧调度 → 保存新数据 → 建立新调度；避免双提醒。 |

| 旧通知操作 | 使用 version/updated_at 校验，旧通知不得覆盖新状态。 |

| 设备重启 / App 更新 | 启动 Reconcile：数据库计划与系统实际调度对账，缺失补建、多余取消。 |

| 时区/系统时间变化 | 重新计算未来调度；已错过且未 ACK 的事项进入“需要 Attention”，不得静默跳过。 |

| 通知权限关闭 | 首页明确告知“无法保证提醒”；恢复权限后自动 Reconcile。 |

| 精确提醒能力不可用 | 允许普通事项降级，但必须显式告知；关键事项不得偷偷降级。 |

| 离线 | Capture、数据库、通知、ACK、Snooze、Complete、Review 都必须可离线工作。 |

| 积压恢复 | 长期未打开 App 时不重放几十条通知；生成恢复摘要，重要/关键单独突出。 |



## 15. 时间语义与 Quiet Hours

- 默认采用“当地时间语义”：例如每天晚上 9 点，用户跨时区后仍是当地晚上 9 点。

- 绝对时刻仅在语义明确时使用；MVP 不要求用户理解 UTC。

- Review Reminder 必须服从 Quiet Hours。

- 普通事项可被用户配置的睡眠/会议/勿扰规则轻量过滤。

- 重要事项可以提高显著性；关键事项按用户显式授权处理。

- 第一版不自动判断“用户是否有空”。



## 16. Onboarding 与信任建立

- 首次使用不强制注册。

- 首次授权通知后提供“测试提醒”按钮，并要求用户点击“我知道了”，验证链路并教育 ACK 概念。

- 第一次收到真实提醒时，用一次性说明解释“我知道了 ≠ 完成”。

- 首次产生 NEEDS_REVIEW 时，再轻提示默认 Review Window；不在首次启动时强制配置。

- 如果系统检测到提醒能力异常，只提示影响履约的实际问题，不做复杂技术健康仪表盘。



## 17. MVP 默认规则（可参数化）

| 规则 | 默认 |

| --- | --- |

| 默认 Review Window | 每日晚间一个固定/柔性窗口；首次产生 NEEDS_REVIEW 时可修改。 |

| Review 补提醒 | 建议默认 60 分钟间隔，补提醒 2 次（当天最多 3 次），最终滚入下一窗口。 |

| Fallback Trigger | 下一个 Review Window；无 Review Window 时使用次日晚间默认值。 |

| 普通事项追提醒 | 有限次数；达到上限后停止主动追击。 |

| 重要事项 | 重复 + 更高显著性。 |

| 关键事项 | 仅显式开启；采用系统允许的最强可用机制。 |

| 相同时间多事项 | 普通事项可聚合；重要/关键可单独显示。 |



## 18. 版本范围与优先级

### 18.1 P0 / MVP 必须实现

- Local-first AttentionItem 数据模型与正交状态。

- 极速 Capture + 自然语言时间解析基础能力。

- WAITING / DELIVERED / ACK / Snooze / Complete / Archive。

- 普通/重要提醒基础策略。

- Future、Now、已看到未完成、Archive、搜索。

- Share Sheet 与来源上下文保存。

- NEEDS_REVIEW + Review Schedule + Review Session + Snooze/Skip。

- Deadline 提取与基础 Deadline Protection。

- 周期规则（固定周期 + ACK-based）。

- 重启/更新/时间变化后的 Reconcile。

- 通知权限异常可见。

- 离线完整核心链路。

- 测试提醒与基础 Onboarding。



### 18.2 P1

- 柔性 Review Window。

- 批量 Review / 一次处理 5 或 10 条。

- 更完整的相似项提示。

- 提醒可靠性自检。

- 更丰富的 Widget / 锁屏快捷入口。

- 关键事项更强提醒的系统能力接入。



### 18.3 P2 / 后续版本

- 账号、云备份与多设备同步。

- 桌面 Capture、浏览器扩展、macOS 菜单栏、Windows 托盘。

- Event Trigger：版本发布、降价、报名开放等外部事件触发。

- AI 辅助整理标题/摘要，但不得阻断离线核心流程。

- 日历轻量联动，但不演进为完整自动排程。



## 19. 核心验收场景

| 验收编号 | 验收条件 |

| --- | --- |

| AC-01 极速 Capture | 输入“周五提醒我看 Horolog”后无需二次确认，成功保存并展示解析时间。 |

| AC-02 模糊 Capture | 输入“Horolog 后面看看”也必须保存；使用 Fallback Trigger + NEEDS_REVIEW。 |

| AC-03 ACK ≠ Complete | 收到提醒点“我知道了”后停止追提醒，但出现在“已看到未完成”。 |

| AC-04 Snooze | 点“2 小时后”后旧通知失效，2 小时后重新进入 Attention。 |

| AC-05 待整理 | 从 Reminder 点“待整理”后同时 ACK + NEEDS_REVIEW，不继续按“未看到”追击。 |

| AC-06 Review 独立 | 事项有周五 Trigger 且 NEEDS_REVIEW；即使一直没整理，周五必须正常提醒。 |

| AC-07 Review Session | 到 Review Window 且有 6 条待整理，只发 1 个 Review Session 通知。 |

| AC-08 Review 没空 | Review 通知可 Snooze/今天跳过；未处理数据保留并滚入下一次。 |

| AC-09 部分 Review | 10 条只处理 4 条退出；4 条状态立即保存，剩余 6 条下次继续。 |

| AC-10 Deadline | 9/30 截止、9/25 首次提醒；9/25 已 ACK 但未完成，临近 9/30 仍可重新唤醒。 |

| AC-11 删除 | 删除 Item 后数据库与所有未来调度同时撤销，不得幽灵提醒。 |

| AC-12 编辑时间 | 把周五改周六后，周五旧提醒不得再出现。 |

| AC-13 重启恢复 | 设备重启后，未来提醒和 Review Schedule 能通过 Reconcile 恢复。 |

| AC-14 权限关闭 | 通知权限关闭后 App 明确提示无法保证履约，不得继续伪装正常。 |

| AC-15 离线 | 断网状态下 Capture、提醒、ACK、Snooze、Review、Complete 均可工作。 |

| AC-16 重复 Capture | 同 URL 再次保存时允许创建，仅轻提示可能重复。 |

| AC-17 周期完成 | 周期事项“完成”仅结束本次实例；“停止重复”才终止规则。 |

| AC-18 归档恢复 | 归档事项可重新打开为未完成，但不自动产生新提醒。 |



## 20. 产品指标

北极星指标：Attention Delivery Rate（ADR）= 最终得到用户明确 ACK 的到期事项 ÷ 需要 Attention Delivery 的到期事项。

- Capture 平均耗时、Capture 放弃率。

- 普通/重要/关键事项 ACK 率。

- 重要事项未确认率。

- Deadline 漏失率。

- Snooze 后最终 ACK 率。

- 时间解析修改率。

- 重启后调度恢复率。

- 用户主动检查 Future 的频率（长期下降可作为信任增强信号）。



## 21. 新需求进入基线的判断规则

1. 它是否帮助用户更放心地忘记未来？

2. 它是否降低 Attention Management 的操作成本？

3. 它是否提高提醒可靠性或上下文恢复质量？

4. 它是否会把产品推向 Todo/Project/Calendar 管理器？

5. 它是否可以在不破坏 Local-first 核心链路的情况下实现？



若新增功能主要增加管理负担、焦虑或“使用 App 的时间”，且无法明显提升托管信任，应默认拒绝。

## 22. 给开发 Agent 的实现约束

- 以本文件为唯一业务基线；若实现与本文冲突，应先停下并报告冲突，不自行“优化产品逻辑”。

- 业务状态必须正交建模，不得使用组合爆炸式枚举。

- 所有通知调度必须可由数据库重建。

- Review 状态不得阻断 Attention/Deadline 调度。

- 任何删除/编辑必须同步处理已注册通知，避免幽灵提醒或双提醒。

- 旧通知动作必须做版本校验。

- 默认策略优先确定性规则，避免第一版用 LLM 决定关键提醒时间。

- 核心功能必须离线可用；AI/云能力只能增强，不能成为单点依赖。

- 所有 P0 功能必须有状态机单元测试 + 调度恢复测试 + 关键真机集成测试。

- 实现新字段/状态时同步更新迁移脚本、序列化、搜索和归档逻辑。



## 23. 已冻结关键决策清单

| 决策 | 结论 |

| --- | --- |

| D-01 | 不让系统自动判断事情优先级；默认无优先级。 |

| D-02 | 移动 App 为最终主体；主动推送可关闭。 |

| D-03 | 必须有“我知道了”确认机制。 |

| D-04 | 普通事项有限追踪；重要事项持续更强追踪；关键事项可闹钟级。 |

| D-05 | 自然语言模糊时间采用“自动解释 + 轻量可修改”。 |

| D-06 | 周期同时支持自然语言周期与 ACK 后重新计时。 |

| D-07 | 支持柔性时间窗口。 |

| D-08 | 上下文自动保存，“为什么关注”可选。 |

| D-09 | 事项彼此独立，不建设项目/主题关系。 |

| D-10 | 首页 = 现在需要注意 + 已看到未完成；Future 默认隐藏但可查可搜。 |

| D-11 | Share 来源即内容；用户只补时间即可。 |

| D-12 | 默认不做日报；大量新增/重要事项时可轻量摘要。 |

| D-13 | Capture 默认自动保存，无需再点确认。 |

| D-14 | 截止时间为保护信息，不是必填字段。 |

| D-15 | 新增 Deferred Clarification：Capture 可粗糙，固定时间集中整理。 |

| D-16 | Review Session 未处理时有限追提醒，最终滚入下一天。 |

| D-17 | Review 是信息质量状态，与 Attention/Complete/Deadline 正交。 |

| D-18 | 无法识别时间时使用 Fallback Trigger + NEEDS_REVIEW。 |

| D-19 | 数据库为事实来源；调度层必须可自愈重建。 |

| D-20 | MVP 不做云同步；多设备作为后续阶段。 |



## 24. Baseline Freeze

V0.2 视为当前产品与业务逻辑冻结基线。后续开发中，如没有来自真实使用、技术限制或可靠性验证的新证据，不应继续凭空增加产品能力。新增需求先记录为变更提案，再评估是否违反本文件的不变量与边界。

**最终约束：** Capture 可以粗糙，但不能丢；Review 可以延期，但不能阻断 Reminder；ACK 不等于 Complete；Deadline 必须独立保护。
