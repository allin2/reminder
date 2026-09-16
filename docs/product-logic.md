---
doc: product-logic
updated: 2026-09-16
basis: 代码实测（commit a2d384b + 2026-09-16 晚修复轮）
schema: 4
status: 描述代码现状；全部 D1–D25 裁决与 A-01 已落地
---

# 安心收件箱 · 当前产品逻辑

> **读法**：本文描述「代码现在**实际**怎么跑」，不描述「PRD 希望它怎么跑」。凡两者不一致，
> 本文以代码为准；文中所有数字都是从代码里读出来的实际值，不是设计意图。
>
> ✅ **2026-09-16 晚：25 项交互裁决已落地到代码**（D1–D25，含 A-01 投递方式），
> 并完成一轮缺陷修复：首页删「即将到来」、待整理两档入口、弹条只能点 × 关闭、
> 兜底=Review Window、低置信度按「必要」弹极简选择、归档重开不自动提醒、
> 有标记事项首次走全屏闹钟。
>
> ✅ **2026-09-16 晚修复轮**（P0/P1）：待整理原生排程接线、全屏闹钟撤销（幽灵闹钟）、
> 整理会话出口不可达、全屏闹钟开机恢复、待整理渠道改回普通；
> 另修掉**整理提醒每分钟重复发**（`maxFollowups` 失效）与「稍后」到点不提醒。
> 详见 §11 的 I10–I15 与 [`docs/reviews/code-vs-plan-2026-09-16.md`](./reviews/code-vs-plan-2026-09-16.md)。
>
> ⬜ **仍未落地**：schema 5 迁移（T9）与 G01 正交状态建模（H1/H2）、
> `completed` / `sessionStatus` / `notifyPrompted` 遗留字段、旧通知渠道处置。

---

## 1. 一句话

用户用一句话把「未来某时需要重新关注」的事交给系统。系统托管它，到点在合适的时间把它重新
送回注意力，并严格区分「我知道了」与「我完成了」。**模糊到无法确定时间的记录不打断当下**——
一律先收下，攒到当晚统一整理。

三个动作的语义边界（贯穿全篇）：

| 动作 | 语义 | 结果 |
|---|---|---|
| 我知道了 | Attention Delivery 成功 | → `acknowledged`，**不归档**，仍算未完成 |
| 稍后 | 现在不适合关注 | → `snoozed`，重新建立下一次唤醒 |
| 完成 | 这件事结束了 | → `archived`，唯一正常归档出口 |

---

## 2. 数据模型（schema 4）

```js
state = { schema: 4, items[], notes[], projects[], settings{} }
```

### 2.1 Attention Item 字段

| 字段 | 说明 |
|---|---|
| `id` / `title` / `note` / `tags[]` / `url` / `projectId` | 内容 |
| `priority` | `normal` \| `important` \| `critical`，决定提醒档位与排序 |
| `status` | 见 §2.2 |
| `triggerAt` | 进入注意力的时刻（时间戳） |
| `windowStart` / `windowEnd` | 柔性窗口（「周末」这类） |
| `deadlineAt` | 截止时刻，独立于 `triggerAt` |
| `repeat` | `{ every, mode, nth?, dow? }` |
| `scheduleBasis` | `wall-clock` \| `elapsed`，见 §3 |
| `localTrigger` / `snoozedAt` / `snoozeDelayMs` | 上面两种基准各自的持久化形式 |
| `remindCount` / `lastRemindAt` / `lastAlertShownAt` | 重提醒预算与节奏 |
| `dismissedUntil` | 关闭弹条后的抑制截止时刻 |
| `deliveredAt` / `acknowledgedAt` / `completedAt` / `createdAt` | 生命周期时间戳 |
| `snoozeCount` | 推迟次数（仅记录，不参与逻辑） |
| `review_status` | `READY` \| `NEEDS_REVIEW` \| `REVIEWED`，见 §7 |
| `reviewed_at` / `sourceTitle` / `sourceApp` | 整理会话用 |

### 2.2 状态值

| 状态 | 含义 | 出现在首页 |
|---|---|---|
| `waiting` | 托管中，未到点 | 否（未来只在「未来」页查看，D5） |
| `snoozed` | 用户主动推迟中 | 否（同上） |
| `due` | **已进入注意力** | 是 →「现在需要注意」 |
| `acknowledged` | 已看到、未完成 | 是 →「已看到未完成」 |
| `archived` | 已归档（完成） | 是 →「今天已完成」 |
| `completed` | **从不产生** | — |

> ⚠️ `completed` 是个幽灵值：`isDue()`、归档列表、相似度判定都把它当终态处理，但
> `completeItem()` 实际写入的是 `archived`。它只可能来自外部导入的旧数据。

---

## 3. 时间语义：两套基准

这是全篇最容易踩坑的地方。`scheduleBasis` 决定 `triggerAt` 怎么被重算：

| 基准 | 用于 | 持久化 | 换时区 / 改系统时间后 |
|---|---|---|---|
| `wall-clock` | 用户选定的本地墙钟时间（含「明天 09:00」这类） | `localTrigger` 字符串 | **跟着当地时间走**——用户要的「明天 9 点」永远是本地 9 点 |
| `elapsed` | 相对时长（30 分钟后 / 2 小时后） | `snoozedAt` + `snoozeDelayMs` | **跟着真实流逝时间走**——「30 分钟后」就是 30 分钟后 |

每次加载数据时 `migrateItem()` 会按基准重算一遍 `triggerAt`；旧数据第一次加载时以原
`triggerAt` 反推生成 `localTrigger`，原 `id`、内容、生命周期不变。

---

## 4. 状态机

`promoteDue()` 是唯一的「到点晋升」入口，由 15 秒一次的 `tick()` 和每次 render 调用。

| 从 | 到 | 触发条件 | 副作用 |
|---|---|---|---|
| — | `waiting` | 新建事项 | `triggerAt` 来自解析结果，解析不出则 **now + 7 天** |
| `waiting` | `waiting` | 有 `windowStart/End` 且仍在等待 | 时间被改写为**窗口首日 10:00**；若已过但窗口未关，改为**立刻** |
| `waiting` / `snoozed` | `due` | `triggerAt ≤ now` | `deliveredAt`、`remindCount=1`、`lastRemindAt=now`、`lastAlertShownAt=null` |
| `waiting` / `snoozed` | 延后 | `triggerAt ≤ now` **且** `priority=normal` **且**处于勿扰时段 | `triggerAt` 推到勿扰结束时刻，**不进入 `due`** |
| `acknowledged` | `due` | 有 `deadlineAt` 且剩余 **≤ 1.05 天**（且未过期超 1 天） | **Deadline Protection**，`remindCount` 归零重新计数 |
| `due` | `acknowledged` | 用户「我知道了」（任一入口） | `acknowledgedAt`、`lastRemindAt=null` |
| `due` / `acknowledged` | `snoozed` | 用户「稍后」 | 按选项决定基准（§6.5） |
| `due` / `acknowledged` | `archived` | 用户「完成」 | `completedAt`；若有周期则**额外生成一条新的 `waiting`** |
| `acknowledged` | `snoozed` | 卡片/详情里的「再提醒」 | 固定 now + 2 小时，`elapsed` |
| `archived` | `waiting` | 归档里「恢复」 | 固定 now + 1 小时，`elapsed`，`completedAt` 清空 |

**周期事项的关键设计**：下一周期**只在「完成」时生成**，不在 ACK 或到点时生成。`mode` 决定从
哪个时间点起算：

- `calendar`：按固定日期推进（每天 / 每周 / 每两周 / 每月 / 每月最后一天 / 每月第 N 个星期 X）
- `ack`：从 `acknowledgedAt` 起算，即「ACK 后重新计时」

---

## 5. 捕获链路

### 5.1 入口

| 入口 | 实现 |
|---|---|
| 首页 + 按钮 | `openCapture()` |
| 系统分享 / 深链 | URL 参数 `text`/`title`/`url`/`link`/`body` → 自动带出标题、URL、备注 |
| 浏览器 query action | `handleQueryActions()` |

### 5.2 解析与分流

输入边打字边解析（`updateParseHint`），实时回填时间、截止、周期，并显示「已设置：X · 可修改」。

解析置信度三档 → **多数情况直接保存**：

| 置信度 | 代码行为 |
|---|---|
| `high` / `mid` | 正常保存为 `waiting` |
| `low` / `none`，且**不含具体时间指向词** | **不弹任何框，直接保存**，标记 `review_status = NEEDS_REVIEW` |
| `low` / `none`，但**含具体时间指向词**（明天 / 下周x / x月x日 / N 天后 / 时刻等） | 弹一次**极简选择**（D15：这是「真正的矛盾」，值得打断一次）；选完仍按 D17 决定兜底 |

保存成功后：命中 `NEEDS_REVIEW` → 提示「已收下 · 待整理」+「去整理」；否则提示
「已交给系统 · 时间」+「查看未来」。**捕获永不失败**。

### 5.3 相似事项

`findSimilarItems()` 做归一化包含 + 字符重叠度（> 0.72 且长度 ≥ 4）匹配，**只提示
「可能已有类似提醒」，绝不自动合并、删除或覆盖**。

### 5.4 AI（可选，BYOK）

OpenAI 兼容接口。`autoOnSave` 开启时保存前先过一遍 AI 解析，失败自动回退本地解析。
AI 不参与判断优先级、不主动对话。

---

## 6. 提醒链路

有**两条并行**的链路，互不替代：

### 6.1 应用内 + Web 通知（PWA / 桌面浏览器）

`tick()` 每 **15 秒** 跑一次：

1. `promoteDue()` 晋升到点事项
2. `maybeReviewSession()` 检查是否该发起整理提醒（§7）
3. 从 `due` 里挑候选项：跳过被抑制的，按 **关键 > 重要 > 普通**、同档次按时间排序
4. 每次只弹一条 → 顶部弹条 + 系统通知（三个动作按钮）+ 重要/关键附带震动

### 6.2 Android 原生投影（Capacitor）

事项仍以 IndexedDB 为**唯一真源**，原生 pending 通知只是**可删可重建的投影**，靠全量对账同步。

排程规则（`POLICY`）：

| 档位 | 总次数 | 追加间隔 | 通知渠道 | importance |
|---|---|---|---|---|
| 普通 | 1 | — | `attention-normal-v2` | 3 |
| 重要 | 4 | 30 分钟 | `attention-important-v2` | 4 |
| 关键 | 8 | 15 分钟 | `attention-critical-v2` | 5 |

- 通知 ID = `scheduleKey` 的 FNV-1a 哈希取 31 位正整数，冲突则递增；`scheduleKey` 包含
  版本、事项 ID、事件、第几次、时刻、标题、正文、渠道，用于对账时判断「这条是否还是想要的」。
- **只对账 `managedKind = attention-reminder` 的通知**，不碰用户其他通知。
- 截止事项额外排一条**截止前 24 小时**的通知（事件名 `deadline`）。
- 渠道开启提示音（`attention_reminder`）与震动，**不申请勿扰访问、不设全屏 Intent**（就本插件而言）。
- 恢复链路：插件自带开机广播接收器 + 应用 Manifest 补的 `MY_PACKAGE_REPLACED`；应用启动、
  回到前台都会重新对账（前台恢复时还会重算墙钟基准）。

### 6.3 优先于一切的抑制规则

| 规则 | 效果 |
|---|---|
| 关闭弹条（**仅点 ×**，D13） | `dismissedUntil = now + 30 分钟`，且内存里也记 30 分钟 |
| 弹条挂满 10 分钟（D14） | **自动收起，纯展示行为，零记账**；不算关闭、不写抑制 |
| 勿扰时段（默认 23:00–07:30） | **只有 `normal`** 被推到勿扰结束；`important`/`critical` 照常 |
| `importantRepeat` 开关 | 关掉后 `important` 退化成只提醒 1 次 |
| 通知权限未授予 | `desired = []` → **取消所有已排的原生通知与全屏闹钟**，退回应用内提醒 |

> D13 落地后，**点击页面任意非弹条区域不再关闭弹条**（原先的 outside dismiss 绑定已移除）。

### 6.4 重提醒预算（Web 与原生一致）

`remindCount` 在晋升为 `due` 时就被置为 1（首发算一次），所以：

- 普通：**1 次，永不重弹**
- 重要：首发 + 3 次补充 = **4 次**
- 关键：首发 + 7 次补充 = **8 次**
- 达到上限即停，ACK 也会立刻停止

### 6.5 「稍后」选项

| 选项 | 基准 |
|---|---|
| 30 分钟后 | `elapsed` |
| 2 小时后 | `elapsed` |
| 今晚 20:00 | `wall-clock` |
| 明天 09:00 | `wall-clock` |
| 本周末 | `wall-clock` |
| 自定义 | `wall-clock` |

> 但从**通知按钮**点「稍后」是写死的 **2 小时**（`elapsed`）；从**全屏闹钟**点「稍后」同样是
> **2 小时**（`AlarmActivity` 快捷档）。两处已由 D11 统一，**10 分钟硬编码已删除**。

### 6.6 全屏闹钟到底用在哪

全屏闹钟（`setAlarmClock` + 亮屏 `AlarmActivity` + 循环响铃 + 波形震动）
**不再是「关键档专属」，也不再由「待整理」使用**。当前规则（D9 / D25 / A-01）：

1. **☆ 重要 · 🚨 关键** 的**首次**提醒 → 全屏闹钟；后续 3 / 7 次走通知渠道
2. **未标记**事项 → 按 `settings.defaultDeliveryMode`：`alarm` 则首次也走全屏，`notification` 走通知
3. **「待整理」** → 只走 LocalNotifications 普通通知（D19），受「本地通知」总开关与勿扰约束（D18）
4. **「提醒能力自检」面板**的测试按钮仍直连 SystemBridge（10 秒后 / 1 分钟后）

全屏闹钟界面有**四个出口**：**我知道了 / 稍后 2 小时 / 完成 / 关闭**。
「关闭」只止响——**不写 ACK、不停后续补充提醒、不消耗提醒预算**（D12）；
`onBackPressed()` 等同「关闭」。

排程由 `lib/native-reminders.js` 的 `shouldFirstAlarm()` 判定，走 `SystemBridge.scheduleAlarm`；
**每次对账都会撤销不再需要的闹钟**（`reconcileAlarms`），避免删除 / 改期 / 关权限后留下幽灵提醒。

---

## 7. 延迟澄清子系统（Deferred Clarification）

本次最大的新增块。核心思想：**不为了一条记不清的记录打断用户，攒到晚上批量处理。**

### 7.1 什么会被标记为「待整理」

`detectNeedsReview()` 命中任意一条即标记：

| 条件 | 例子 |
|---|---|
| 用户手动保留 | 表单里主动勾了 |
| 解析不出任何时间 | 「记得看看那个」 |
| 置信度 `low` / `none` | 「过阵子再说」 |
| 内容过于模糊 | 「看看这个」「研究一下」「以后看看」 |
| 只有 URL，没有标题也没有备注 | 纯分享链接 |

模糊判定正则 `VAGUE_RE` 覆盖：这个 / 那个 / 它 / something + 以后 / 后面 / 之后 / 过阵子 /
回头 / 有空 / 有时间 + 看看 / 看一下 / 关注 / 处理 / 研究 / 了解。

### 7.2 默认兜底时间

被标记为 `NEEDS_REVIEW` 的兜底记录，`triggerAt` 兜底为 **下一个整理窗口起点**（`fallbackTriggerAt()`，D17）——
不再是 `now + 7 天`。若「整理」功能被关闭，则退到**次日晚间 20:00**，并按普通事项正常提醒
（否则这些记录会永久搁浅）。

兜底记录**不进入「需要注意」**，只触发整理提醒；`isFallbackTrigger` 标记位供整理卡片回溯。

### 7.3 整理会话

| 项 | 默认值 |
|---|---|
| 触发窗口 | **每天 21:30 – 23:00** |
| 跟催 | 同一窗口内最多 **2** 次补充，间隔 **60 分钟**（当天最多 3 次，D22） |
| 队列排序 | 按 `createdAt` 从旧到新 |
| 每条卡片 | 标题、笔记、原始记录、系统解析结果、来源（标题/URL/App/记录时间） |
| 每条动作 | 删除 · 确认 · 保存修改（可改标题、提醒时间、备注） |
| 出口 | 稍后（30 分钟 / 2 小时 / 今晚 22:30 / 明天 21:30 / 下一个整理时间）<br>跳过本次 · 完成 |

- 「确认」与「保存修改」都会把 `review_status` 改为 `REVIEWED` 并记录 `reviewed_at`；
  若新时间在未来且事项本来是 `due` 或 `acknowledged`，会被重新打回 `waiting`。
- 无时间的记录在「确认」时若仍为空，同样走 `fallbackTriggerAt()`。
- 首页入口**常驻弱形态**（无数字、无强调色，位于「需要注意」之后）；
  进入窗口 ∪ 宽限期（`snoozedUntil` 后 1 小时）时变**显著形态**（带数字、提到最前，D6 / D20）。
  无待整理时**完全不渲染**。
- 副标题明确写「信息尚未二次确认，不是逾期任务」。
- **两个会话级出口「稍后 / 跳过本次」随卡片一起重建**（P0-3 修复点：此前被 `#reviewFoot` 的
  整体 `innerHTML` 替换冲掉，导致宏观上不可达）。

### 7.4 提醒方式

会话提醒走 **LocalNotifications 普通通知预排**（D19）——首个窗口起点 + 60 分钟 × 2 次补充；
**不使用全屏闹钟**。受「本地通知」总开关控制（关掉即一并取消，D18），
窗口起点若落在勿扰时段内则顺延到勿扰结束。
排程由 `reconcile()` 与事项排程在**同一次对账**里完成。

---

## 8. 首页信息架构（实际渲染顺序）

首页 DOM 顺序即视觉顺序，共**三块**（D5 删除「即将到来」后）：

| 顺序 | 区块 | 内容 | 出现条件 |
|---|---|---|---|
| 1 | **现在需要注意** | `due` 列表 | 有到点事项 |
| — | **待整理** | 软入口；显著时提到最前，弱形态时排在「已看到未完成」之后 | `NEEDS_REVIEW` 队列非空（D6） |
| 2 | **已看到未完成** | 折叠成一行「已看到未完成 · N」，点开才看明细 | 有；**永远折叠**，无阈值（D7） |
| 3 | 空态 | 「此刻很安静」；若有当天完成则补一句纯文字「今天已完成 N 件」，**不可点击**（D8） | 无 `due` 也无 `acknowledged` |

**Badge**：底部导航角标与应用角标都等于 `due` 数量（不是总未完成数）。

> 未来事项**一律不上首页**，只在「未来」页查看（D5 / Inv-07）。
> `#homeUpcoming` 容器保留为空，不再承载任何内容。

---

## 9. 其他页面

| 页面 | 内容 |
|---|---|
| **未来** | 两个分段：托管中（`waiting` + `snoozed`）、已归档。托管中带月历视图（有事项的日期打点，到期的标红点，点日期筛选）和筛选 chips：全部 / 重要 / 有截止 / 周期 / 有项目 |
| **笔记** | 轻量 Markdown，可置顶、可关联项目；筛选 chips |
| **搜索** | 跨 事项标题/备注/标签、笔记标题/正文、项目名 |
| **我的** | 三组设置（见下）+ 数据导入导出 + 载入示例 + 清空 |

「我的」页设置项：

- **提醒**：本地通知开关、精确闹钟权限、系统通知设置、后台保活、**提醒能力自检**
- **整理**：待整理时间（每天几点、窗口结束点）
- **行为**：睡眠勿扰、重要事项持续提醒、轻量当日摘要、锁屏隐私
- **数据**：项目管理、勿扰时段、AI 智能理解、安装到主屏幕、离线与提醒状态、导出/导入/示例/清空、查看 PRD

顶部还有三个统计数字：**待确认**（`due`）、**已看到**（`acknowledged`）、**托管中**（`waiting`+`snoozed`）。

### 提醒能力自检面板

首次在 Android 上启动会**自动弹出**（`onboardDone` 只触发一次）。内容：

1. 诊断：平台 / 插件是否就绪、系统通知权限、精确闹钟、电池优化白名单
2. 四步引导：申请通知权限 → 打开系统通知设置 → 允许精确闹钟 → 关闭电池优化
3. 实测：立即发送通知、10 秒后全屏闹钟、1 分钟后全屏闹钟、取消未触发闹钟

若诊断出通知已授权，会自动把「本地通知」开关打开。

---

## 10. 持久化与可靠性

| 层 | 实现 |
|---|---|
| 主存储 | IndexedDB（库 `attention-inbox`，仓库 `kv`，键 `state`） |
| 回退 | localStorage（键 `attention-inbox-v2`） |
| 迁移 | 首次打开时若 IDB 为空而 localStorage 有旧数据 → 导入 IDB，**旧键保留作备份不删除** |
| 双写 | IDB 模式下同时写 localStorage，防 IDB 损坏 |
| 首启 | **仅当「没有读到真实数据」且「事项为空」**才载入示例数据 |
| 迁移标记 | `applyParsedState` 里检查 `schema` 与关键字段缺失，需要则立即回存 |

启动顺序（`init`）：加载数据 → 绑定事件 → 需要则迁移回存 → 初始化原生提醒 →
可能弹自检面板 → 检查整理会话 → 排下次整理闹钟 → 注册 SW → 绑定安装/网络 → 处理分享参数 →
首次则 seed → 渲染 → 可能发当日摘要 → 起 15 秒 `tick` → 更新角标。

---

## 11. 代码层面的已知不一致

**已在 2026-09-16 晚修复轮结清的项已标注「✅ 已落地」；其余登记为待清理。**

| # | 问题 | 位置 | 状态 |
|---|---|---|---|
| I1 | `#sheetLowConf` 曾无调用点 | `app-core.js` `saveItemFromForm` | ✅ **已落地**：按「含具体时间词却落兜底」的条件触发（D15） |
| I2 | **`sessionStatus` 是只写字段**：6 处赋值，全应用无读取点 | `app-core.js` | 待清理 E2 |
| I3 | **`notifyPrompted` 同样是只写字段** | `app-core.js` | 待清理 E3 |
| I4 | **`completed` 幽灵状态**：被当终态判断，但从不写入 | `app-core.js` | 待清理 E4 |
| I5 | 「稍后」三处不一致：全屏闹钟 10 分钟 / 通知按钮 2 小时 / 表单 6 个选项 | `AlarmActivity.java` · `native-reminders.js` · `app-core.js` | ✅ **已落地**：快捷固定 2 小时（D11），10 分钟硬编码已删 |
| I6 | 整理会话「今晚」用的是 22:30，而窗口起点默认 21:30 | `app-core.js` | 非缺陷：22:30 落在窗口内 |
| I7 | 通知渠道改名 `-v2` 后，设备上已存在的旧渠道不会被复用也不会被清理 | `native-reminders.js` | 待清理 E5 |
| I8 | 原生排程只在**首次**排程时套用勿扰偏移，第 2..n 次补充提醒按固定间隔叠加，不再复检勿扰 | `native-reminders.js` | **实为非问题**：只有 `normal` 参与勿扰，而 `normal` 没有补充提醒 |
| I9 | 「点击页面任意非弹条区域即关闭提醒并抑制 30 分钟」——一次误触就会压掉提醒预算 | `app-core.js` | ✅ **已落地**：只有点 × 才算关闭；弹条 10 分钟自动收起且不记账（D13 / D14） |
| I10 | 全屏闹钟只排不撤 —— 删除 / 改期 / ACK / 关权限后已排闹钟照响（幽灵闹钟） | `native-reminders.js` | ✅ **已落地**：`reconcileAlarms()` 逐轮撤销 + 台账持久化（P0-2） |
| I11 | 「待整理」原生排程有函数无调用点，安卓上永远不会响 | `native-reminders.js` | ✅ **已落地**：并入 `reconcile()` 同一次对账（P0-1），渠道改回普通（P1-6） |
| I12 | 整理会话「稍后 / 跳过本次」被 `#reviewFoot` 的整体 `innerHTML` 替换冲掉 | `app-core.js` | ✅ **已落地**：出口随卡片重建（P0-3） |
| I13 | 全屏闹钟无开机恢复（Capacitor 插件只恢复自己的通知排程） | `AndroidManifest.xml` | ✅ **已落地（未编译验证）**：新增 `BootRestoreReceiver`（P1-4） |
| I14 | `showSystemNotification()` 用 `"Notification" in window` 判断，属性存在但为 `undefined` 时会抛错并打断整轮 tick | `app-core.js` | ✅ **已落地**：改用真值判断（`renderPwaStatus()` 同源写法一并修掉） |
| I15 | **整理会话提醒每分钟重复发**：`reviewSessionKey()` 用「分钟」做粒度，key 每分钟都变，配合 `lastSessionKey !== key → followupCount = 0` 的重置逻辑，`maxFollowups` 永远回不到上限 → 窗口内 21:30–23:00 会发 ~90 条；「稍后」跨出窗口后更会无限重复（`snoozedUntil` 永不过期） | `app-core.js` | ✅ **已落地**：key 改为**窗口粒度**（`W:<窗口起点>`），「稍后」用独立额度 `S:<时刻>`；`snoozedUntil` 过 1 小时宽限期即清空；旧版分钟 key 自动作废 |

---

## 12. 参数速查

| 参数 | 值 |
|---|---|
| tick 间隔 | 15 秒 |
| 默认缩放 | 无时间 → **下一个整理窗口起点**（整理关闭时次日晚 20:00）；无窗口 → 窗口首日 10:00 |
| 勿扰默认 | 23:00 – 07:30，仅普通事项受影响 |
| 重提醒 | 普通 1 / 重要 4×30min / 关键 8×15min |
| 首次投递 | 有标记（重要/关键）或 `delivery_mode=alarm` → 全屏闹钟；其余通知 |
| 关闭弹条抑制 | 30 分钟（仅点 × 触发） |
| 弹条自动收起 | 10 分钟，零记账 |
| Deadline Protection 触发 | 剩余 ≤ 1.05 天 |
| 原生 Deadline 通知 | 截止前 24 小时 |
| 整理窗口 | 21:30 – 23:00；窗口内首发 + 60 分钟一次补充（`maxFollowups` 真正生效）；「稍后」单独占一次额度，宽限期 1 小时 |
| 「再提醒」 | +2 小时 |
| 「恢复」 | +1 小时（**不设 `triggerAt`**，D23） |
| 相似度阈值 | 长度 ≥ 4 且字符重合 > 0.72 |
| 原生排程最短提前量 | 1 秒 |
| 摘要节流 | 20 小时；阈值 3 条新增或 1 条重要 |
| 今日摘要 / 通知渠道 | 默认关闭 / `-v2` 三档（待整理用 `attention-normal-v2`） |
| appId | `space.alliswell.inbox` |

---

## 13. 验证边界

- 本机 `npm test` 全绿：unit **29** / native mock **69** / smoke **96**（= 194）。
- **原生侧已在 mock 层接线**：SystemBridge 进入测试 mock，D9/D25 首次全屏闹钟路由、
  闹钟撤销（P0-2）、待整理排程（P0-1）均有断言。
- 本机无 JDK 17、Android SDK、模拟器 → **Gradle 编译、APK 生成与安装、Doze、重启恢复、
  真机通知动作全部为 `NOT_PERFORMED`**，不能据此宣称 Android 真机 PASS。
  本轮新增 / 修改的 Java（`BootRestoreReceiver`、`SystemBridgePlugin` 落盘、`AlarmActivity` 入账）
  只做到 **javac 语法级通过**，未编译、未装机。
- `releases/安心收件箱-debug.apk` 是别人签出的 debug 包，只能用于侧载验证。
