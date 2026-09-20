# 代码优化首轮实施报告（O1–O7）

- **run-id**：`20260920T1706-code-optimization`
- **报告日期**：2026-09-20
- **依据**：`docs/handoff/2026-09-20-code-optimization-repair-plan.md`（§4 实施顺序、§5 验收矩阵、§6 对照方法、§7 交付包）
- **状态**：**实现与自检已完成，未提交、未推送，交回原任务独立验收**
- **交付证据**：`docs/reviews/verification-runs/20260920T1706-code-optimization/`（含源码 SHA-256、原始日志、计数 JSON、diff）
- **自检 ≠ 独立验收**：本报告所有 `PASS` 只表示**我方自检通过**；§5 的最终判定权在原审查 Agent。

---

## 1. 工作区与基线（动手前实测，不是照抄方案）

| 项 | 实测值 |
|---|---|
| 仓库 / 分支 | `/Users/qlyf/Developer/reminder`，`main` |
| HEAD | `4de5f597573bc2c45b51ba8ab18a279d054339a0` |
| 交付时 `origin/main` | `4de5f597573bc2c45b51ba8ab18a279d054339a0`（**与 HEAD 相同，本轮无提交、无推送**） |
| 接手时工作区 | 大量未提交修改 + untracked（`repo-state-end.txt` 记录交付时完整清单）。**全部保留**，未 reset / checkout / 拷回旧文件 |
| 基线 `npm test`（动手前） | unit **330** / native **321** / smoke **255** / regressions **730** = **1636 通过 0 失败** |

**基线与方案的差异要解释清楚**：方案 §2 记录的是 `unit 330 / native 321 / smoke 244 / regressions 730 = 1625`。本机动手前实测 smoke 已是 **255**（+11）。这与方案 §3 的「基线已经漂移」一致 —— 那 11 条来自交接前其他会话对 `test-smoke.js` 的既有改动，**不属于本任务**。本任务**没有**修改 `test-smoke.js`（见 §3 改动清单，逐字节相同）。

**编辑前副本**（用于区分「接手前 dirty」与「本轮改动」）归档在 `pre-edit/`：
`app-core.js`、`lib/native-reminders.js`、`index.html`、`test-smoke.js`、`test-regressions.js`。

---

## 2. O1–O7 逐项状态

| 项 | 状态 | 一句话结论 |
|---|---|---|
| O1 生产组合启动测试 | **已实现**（新增 harness + 辅助模块 + 挂入 `npm test`） | 8 支脚本同序加载、真实原生模块被调用、反向对照有牙齿 |
| O2 `deferNativeSync` 断链 | **已修** | options 沿 `save → saveAsync → writeSnapshot` 传到正确参数位；台账回写不再自激下一轮对账 |
| O3 链接协议 + 属性转义 | **已修** | 只放行解析后 `http:`/`https:`；其余降级为转义纯文本；ID 在属性上下文转义 |
| O4 台账/排程/证据匹配用调用内索引 | **已修** | `Array.find` 首项胜语义保持；n=2000 空台账 2,001,000 次谓词比较 → 0 |
| O5 复用独立快照 | **已修** | 一次正常保存 2 次全量 parse → **1 次**；已提交快照只在权威提交成功后发布 |
| O6 折叠按需生成 + 首页局部更新 | **已修**（含一处派生项，见 §2.6） | 折叠 1000 条生成 **0** 张卡片；无变化的一拍不重写卡片容器 |
| O7 合并启动重复渲染 | **已修** | 首页三个卡片容器启动期各只写 **1** 次（原 3 次） |

### 2.1 O1：生产组合启动测试

新增三个文件，职责单一、互不重叠：

- **`scripts/verification/production-scripts.js`**（281 行，纯读取）：生产脚本清单的**唯一读取口**。期望集合从 `index.html` **推导**，不硬编码第二份副本。提供 `inspectList`（形状 / 重复 / 缺文件 / `app-core` 必须在最后 / **加载期依赖顺序**）、`coverageProblems`（某 harness 对每支生产脚本必须交代去向：加载了 / 声明的替代注入 / 声明的有意缺席，否则报 `unaccounted-production-script`）、`precacheProblems`（`sw.js` 的 `ASSETS` 覆盖 + 清单条目真实存在）、`packagingProblems`（`scripts/sync-www.js` 复制链覆盖）、`readHarnessLoadSets`（**从另两套 harness 的源码推导它们各自加载了哪些生产脚本**）。
  - 其中**加载期依赖**是关键：`lib/native-reminders.js` 在被求值那一刻就把 `AttentionLib.deadlineStageKey/deadlineStagePoints` 抓进闭包常量 `Lib`，反序加载会让截止保护静默退化成只剩一个阶段。
  - `readHarnessLoadSets` 存在的原因见 §2.1.1：`test-smoke.js` 与 `test-regressions.js` **都**没把 `lib/native-reminders.js` 放进沙箱（regressions 是直接 `require` 那一支做专项测试），因此那两套里 `AttentionNativeReminders` 恒为 `undefined`、app-core 走 `|| {}` 兜底而**一切照常变绿**。本函数只做**读取**，不改动那两套 harness（§4 O1：「保留有效的专项替身」），把「它们加载了什么」变成可断言的事实。
- **`test-boot-combination.js`**（1417 行，挂入 `npm test`）：在隔离 VM 里**按 `index.html` 的顺序加载同一组合**，并挂一个**可控 Android 桥**。
  - **为什么不塞进 `test-smoke.js`**：方案 §4 O1 要求「不要机械把 native 脚本再执行一遍，导致双实例、双监听或宿主 global 与沙箱 root 混用」。实测把真实原生模块注入 smoke 沙箱会在导出路径抛 `Cannot read properties of null (reading 'content')`（smoke 的 `window.Capacitor` 不是 Android 形态）。因此新增职责单一的 harness，`test-smoke.js` **一行未改**，它原有的 require 注入与平台故障 mock 全部保留。
- **`scripts/verification/perf-counts.js`**（399 行）：§6 的计数与对照证据脚本，输出 `perf-counts.json`（可复算）。

**注入面**：`loadCombination(options)` 支持 `scripts`（坏清单反向对照）、`seedState`（持久化数据启动）、`search`（深链 / 分享）、`overrides`（**同一 harness 只换 `app-core.js`** —— 这是优化前后对照成立的唯一诚实做法）、`addListenerContract`（`"handle"` 同步句柄 / `"promise"` 官方 Promise）。

**计数的技术要点（踩过的坑，写下来免得复现）**：
- `Array.prototype.find` 的谓词计数必须打在 **VM realm 自己的** `Array.prototype`（`Object.getPrototypeOf([])`）。沙箱对象上的 `Array` 只是全局绑定，而 VM 里的数组字面量 `[]` 走 realm 内建的 `%Array.prototype%` —— 补宿主那份会得到「0 次比较」这种恒真结论。
- 计数型 DOM：`innerHTML` 用访问器累加计数，因为「无变化的一拍不替换节点」只能靠「这个容器被写了几次」证明。

#### 2.1.1 另两套 harness 的组合覆盖：把隐形缺口变成被检查的声明

方案 §3 已判定 S-03 的表述有误（regressions 通过 `require` 注入真实模块并直接测队列等功能，是**有效**的专项替身）。但实测确认了一个仍然存在的、**静默**的事实：

- `test-smoke.js` 的 `vm.runInContext` 序列只加载 6 支 lib + `app-core.js`，**没有** `lib/native-reminders.js`；
- `test-regressions.js` 的 `LIB_SOURCES` 同样只列 6 支 lib（外加 `APP_SOURCE`）。

因此这两套里 `AttentionNativeReminders` 恒为 `undefined`，app-core 走 `|| {}` 兜底 —— 而这**不会让任何断言变红**。补位方式是 `test-boot-combination.js` 的 B 段（真实组合 + 「删掉它」的反向对照），但补位本身也要被发现者看见。

于是新增 **A4 段**（11 条断言），从源码推导两套 harness 的加载集合，并声明式地检查：

1. 它们加载的每支脚本都在生产清单里（不许自创 / 拼错脚本名）；
2. **缺口恰好是 `lib/native-reminders.js`** —— 谁增删了那两个列表，这里立刻变红，必须重新交代；
3. 这个缺口被 `coverageProblems` 如实报成 `unaccounted-production-script`（证明「声明」要有牙齿）；
4. `app-core.js` 在两套里都排在最后；
5. 缺口有明确补位（本 harness 的 B 段加载了它）；
6. **反向对照**：只给一个**没有 `why`** 的注入声明不算交代，覆盖判定仍然报错。

**没有修改那两套 harness 的任何一行**（`cmp` 逐字节相同）。缺口依旧是缺口，但从此是**被声明的、被检查的**缺口。

### 2.2 O2：修通 `deferNativeSync`

改动点（`app-core.js`）：

```js
function runCommit(job, args) {                    // 原先不接受 args
  const invoke = () => job.apply(null, args || []);
  const next = commitChain.then(invoke, invoke);   // 原先是 then(job, job) —— job 收到的是上一个已兑现值
  commitChain = next.then(() => {}, () => {});
  return next;
}
function saveAsync(options) { return runCommit(writeSnapshot, [undefined, options]); }
function save(options) { ... saveAsync(options) ... }
```

为什么原来是断的：`commitChain.then(job, job)` 把**上一个已兑现的值**（`undefined`）当第一个实参传给 `writeSnapshot`，于是 `options` 永远到不了第二参数位。修法保持了「**轮到提交时才取快照**」——payload 传 `undefined`，由 `writeSnapshot` 在提交时刻调 `currentPayload()`，**不在入队时冻结普通保存**，也没有把 options 当 payload。

台账回写侧：`syncNativeRemindersNow` 里只给**内部记账那一段**传 `{ deferNativeSync: true }`，`applyDeadlineEvents` / `applyReminderEvents` 末尾改成 `if (changed) save(options)`。其它调用方（导入、迁移、事件回调）不给选项，照常请求同步 —— 没有「把所有事件保存一律禁用同步」。

### 2.3 O3：链接协议与属性转义

- `safeExternalHref(raw)`：**解析结果**判定协议，只放行 `http:` / `https:`。先剔除首尾空白、**含控制字符（含 TAB/LF/CR）一律拒绝**；解析器不可用时退到保守字形判定（要求完整绝对 URL 结构 + 无空白 + 授权段字符集），宁可降级也不放行。
  - 为什么不能用 `startsWith("http")`：`new URL("java\nscript:alert(1)")` 的协议**就是** `javascript:`（解析器先剔除 TAB/LF/CR）。
  - 为什么不能用 `escapeHtml` 代替：它只处理引号，对协议完全无能为力。
- `escapeAttr(v)`：**属性上下文**转义，字符集与 `escapeHtml` 相同但**分开命名**，让「改转义字符集」的人一眼看到属性侧也是消费者。
- 应用面：事项卡片链接、详情页链接、`actionButton` 的 `data-id`、详情/删除按钮 `data-id`、笔记 `data-note`、未来页 `data-id`。
- **不删用户数据**：不合格的 URL 原样留在 `it.url`（用 `<span class="linkish-plain">` 转义呈现），详情页编辑入口仍能改它。不顺带重编号 ID、不删除重复 ID。

### 2.4 O4：调用内索引

| 位置 | 改法 |
|---|---|
| `applyDeadlineEvents` / `applyReminderEvents` | 新增 `const byId = indexItemsById(state.items);`，`targetItemIds.forEach(id => state.items.find(...))` → `byId.get(id)` |
| `applyNativeDeliveryEvidence` | 同上，替代「每个有证据的事项各扫一遍 `state.items`」 |
| `lib/native-reminders.js` 的 `reconcileAlarms` | 调用内建一次 `itemsById`，替代每个 desired 项的 `items.find(...)` |

- `indexItemsById` 用 **`if (map.has(it.id)) return;` 先出现者胜**，与 `Array.find` 的首项匹配语义逐字一致。**刻意不用** `new Map(items.map(...))` —— 那是末项覆盖，会把「首项」静默变成「末项」。
- 索引是**调用内**的局部变量，不引入需要跨所有修改入口维护的全局缓存。
- 保留台账 JSON 比较（方案 §4 O4 第三步：「只有完整定义键集合/字段/缺省值与未知字段的等价语义后才替换」—— 本轮不做，避免同时改算法和数据判等）。
- 遍历期间只写 `it.deadlineEvents` / `it.reminderEvents`，**不改动 `state.items` 成员**，索引全程有效。

### 2.5 O5：复用独立快照

```js
async function writeSnapshot(payload, options) {
  const json = JSON.stringify(payload || currentPayload());
  const snapshot = JSON.parse(json);              // ← 全流程唯一的一次全量 parse
  if (storage && storageReady) {
    await storage.save(snapshot);                 // 权威提交：失败即本次提交失败
    if (authoritativeBackendMissing()) markPendingReplay(json);
    committedAlarmItems = snapshot.items || [];   // ← 与后端写入共享**同一份已冻结副本**
    ...
  }
  ...
}
```

- **H1 独立快照没有被「复用」破坏**：共享的是 `JSON.parse(json)` 产出的**独立副本**，不是活对象。`payload || currentPayload()` 本身绝不能直接传给异步后端 —— 内存后端 `lib/storage.js:155` 是 `mem.value = obj`（存引用），传活对象会让后续内存改动污染已提交判定。
- **失败不提前发布**：`committedAlarmItems` 的赋值在 `await storage.save(...)` **之后**，提交抛错到不了那里。
- 保留 `localStorage` 镜像尽力写、IDB 权威、无 IDB 时本地权威、H-07 pending-replay 语义；主键与镜像算**同一个键**（不是两个）。

### 2.6 O6：折叠按需生成 + 首页局部更新

- 折叠态：`active` **不排序、不建卡片**，`#activeList` 保留为空容器（结构不变），只写入口与数量。收起时整段重写 ⇒ 卡片节点随之释放。
- `homeCardSignature(dueList, active, expanded, extra)`：视图模型签名，覆盖展开状态、`quiet`、`reviewPending`、`doneTodayCount`、`userMode`、`projects`，以及每条卡片**格式化后**的字段（`relDue` / `fmtDate` 等）—— 折叠时只放数量，不放内容。签名相同 ⇒ 跳过 `innerHTML` 重写，焦点 / 滚动 / 按钮忙碌态不受影响。
- `promoteDue()` 移出短路：**业务推进永远执行**，只有 DOM 写入可跳过。
- **派生改动（方案未逐字列出、但属于 O6 范围「首页相关刷新调用」）**：新增 `writeIfChanged(host, html)`，对**单一写入者**容器 `#homeNotice`、`#homeSetup`、`#homeReview` 做「内容逐字节相同就不重建」。
  - 动机是计数暴露的事实：`setNativeReminderStatus` 是原生状态的唯一漏斗，真机上每次 `onResume` 读权限都会调它，而结论多数次完全一样；`renderReviewEntry` 则**每一拍 `renderHome` 都会被调一次**（包括被签名短路的那一拍）。改动前一次数据启动里 `#homeNotice` 被写 6 次、`#homeReview` 3 次。
  - 逐个容器手工接入、不做全局拦截：一旦有第二处代码绕过 `writeIfChanged` 直接写同一节点，缓存会失真并开始吞掉必要的更新。监听只在**真的替换了内容**时重绑，旧闭包读的是同一个判定对象，行为一致。

### 2.7 O7：合并启动重复渲染

`init()` 改成「先定路由 → 再渲染一次」：`applyShareParams()` → `handleQueryActions()` → 单次 `render()` → `maybeDailySummary()` → 装计时器 → `tick()` → `updateAppBadge()`。删掉了分支里的重复 `render()` 与末尾的第二次首页渲染。

**没有靠这些手段凑「1 次」**：没删首次 `tick`（到期事项仍在启动当期立刻处理）、没丢 `handleQueryActions`、没改计时器安装时机、没冻结 UI。

---

## 3. 本轮改动清单（区分接手前 dirty 与本轮改动）

**本轮改动的文件**（`diff` 见证据目录，`pre-edit/` 为准）：

| 文件 | 本轮改动量 | 说明 |
|---|---|---|
| `app-core.js` | 478 行差异（unified diff 781 行，+380/-100） | O2–O7 全部实现 |
| `lib/native-reminders.js` | 12 行差异（+12/-2） | O4：`reconcileAlarms` 调用内索引 |
| `package.json` | 1 行 | O1：`test` 脚本挂入 `test-boot-combination.js` |
| `test-boot-combination.js` | **新增** 1417 行 | O1 harness（A–H 共 12 段） |
| `scripts/verification/production-scripts.js` | **新增** 281 行 | O1 清单读取口 + 两套 harness 的覆盖推导 |
| `scripts/verification/perf-counts.js` | **新增** 399 行 | §6 计数证据脚本 |

**本轮逐字节未改**（`cmp` 验证，见 §5）：`index.html`、`sw.js`、`lib/parse-cn.js`、`lib/repeat.js`、`lib/reminder.js`、`lib/storage.js`、`lib/feedback.js`、`lib/delivery-evidence.js`、`test-unit.js`、`test-native-reminders.js`、`test-smoke.js`、`test-regressions.js`、`capacitor.config.json`、`android/` 全部。

**生产脚本组合未变化** ⇒ 不需要动 `sw.js` 的 `ASSETS` 与缓存版本号，也不需要动 `scripts/sync-www.js`（方案 §4 O1：「不要为补测试无故修改运行脚本或升缓存版本」）。证据：`script-combination-check.txt`。

**未提交、未暂存**：仓库工作区保持 dirty（含接手前所有改动），**没有** `git add`、`commit`、`push`、PR，**没有**安装 APK、覆盖 `releases/` 候选、变更设备设置、删除旧产物、修改用户真实事项。

---

## 4. 验证结果

### 4.1 最终 `npm test`（本轮全部改动落地后）

| 套件 | 通过 | 失败 |
|---|---|---|
| `test-unit.js` | 330 | 0 |
| `test-native-reminders.js` | 321 | 0 |
| **`test-boot-combination.js`（本轮新增）** | **165** | 0 |
| `test-smoke.js` | 255 | 0 |
| `test-regressions.js` | 730 | 0 |
| **合计** | **1801** | **0** |

原始日志：`final-npm-test.log`（基线：`baseline-npm-test.log`）。**不拿「总数 ≥ 1625」替代逐场景验证** —— 逐场景结论见 §4.2–§4.4 与 harness 的 165 条断言。

### 4.2 计数对照（`perf-counts.json`，可复跑）

**O4 复杂度**（`scripts/verification/perf-counts.js`，同一 harness、同一组合，只换 `app-core.js`）：

| 台账 | n | 编辑前 `Array.find` 谓词比较 | 本轮 |
|---|---|---|---|
| deadline（空台账） | 100 / 500 / 2000 | 5,050 / 125,250 / **2,001,000** | 0 / 0 / **0** |
| reminder（满台账） | 100 / 500 / 2000 | 5,050 / 125,250 / **2,001,000** | 0 / 0 / **0** |

- 编辑前恰好是 `n(n+1)/2`，与方案 §3 E-04 记录的 2,001,000 **逐字吻合**（可复算）。
- 两侧的业务结果一致（同判「无变化」）；两侧索引构建次数都记录在 `o4.rows[*].reminders.mapBuilds`。
- 耗时仅作参考：`applyReminderEvents([])+applyDeadlineEvents([])`（空台账）n=500：编辑前 median **0.90 ms** → 本轮 **0.26 ms**；本轮 n=2000 median **1.02 ms**（O(n)）。**这是 Node 桌面环境数字，不乘倍数推算真机。**

**O2 同步/对账**：一次业务保存 → `{totalRequests:1, runs:1, deduped:0, bySource:{save:1}}`，桥调用 `scheduleAlarm +1`；静置 600 ms 后仍为 `runs:1`（**台账回写不再自激下一轮**）；相同计划二次保存 `runs:2` 但 `scheduleAlarm +0 / cancelAlarm +0`。

**O5 序列化**：一次正常保存 = `JSON.parse` **1** 次、`JSON.stringify` **2** 次（① 生成 json 载荷 ② localStorage 镜像序列化）、IDB `put` 1 次；在途改内存 / 在途新增项都不会混进这次提交。

**O6 折叠卡片数**（HTML 字符串体积，**不是** DOM/堆内存）：

| n | 编辑前折叠 | 本轮折叠 | 本轮展开 |
|---|---|---|---|
| 100 | 100 张 / 59,598 B | **0 张 / 147 B** | 100 张 |
| 500 | 500 张 / 299,598 B | **0 张 / 147 B** | 500 张 |
| 2000 | 2000 张 / 1,204,599 B | **0 张 / 148 B** | 2000 张 |

**O7 启动期容器写入次数**（数据启动）：

| 容器 | 编辑前 | 本轮 |
|---|---|---|
| `#homeDue` | 3 | **1** |
| `#homeActive` | 3 | **1** |
| `#homeEmpty` | 3 | **1** |
| `#homeStart` | 3 | **1** |
| `#homeUpcoming` | 3 | **1** |
| `#homeSetup` | 4 | **1** |
| `#homeNotice` | 6 | **3** |
| `#homeReview` | 3 | **1** |

深链 `?tab=future`：首页三个卡片容器**一次都没被碰过**（不是「先渲染首页再切走」），`ready()` 为真，`futureSeg` 落到 `waiting`，计时器照常装上。

### 4.3 harness 覆盖的场景（154 条断言，逐段）

| 段 | 覆盖 | 对应验收项 |
|---|---|---|
| A / A3 | 清单从 `index.html` 推导、形状 / 重复 / 缺文件 / 顺序 / 加载期依赖；SW 预缓存覆盖；打包复制链覆盖 | V01（负例有牙齿） |
| **A4** | 另两套 harness 的组合覆盖被**推导 + 声明式检查**：缺口恰好是 `lib/native-reminders.js`、被 `coverageProblems` 报出、有明确补位；反向对照：没有 `why` 的注入声明不算交代 | V01（覆盖判定） |
| B | 同序加载真实组合、导出与 `ready`、逐支点名断言导出**是真实现**不是空对象；**反向对照**：删 `lib/native-reminders.js` 后应用**照样 ready**（缺口是静默的）且被 `coverageProblems` 报出；`app-core` 提前后 `AttentionLib` 为空、IDB 一次不写、详情页「提醒结果」行消失 | V01 |
| C / C2–C5 | 监听注册 / 一次排程 / 相同计划不重排 / 改期撤销+重排 / 排程失败保留重试且不谎报已排；`nativeSyncStats` 计数来自**真实 app 编排链** | V02、V03、V12 |
| C6 | `addListener` **同步句柄**与 **Promise** 两种契约都能启动并真的排起原生链路 | V01 |
| C7 | 一次保存 `parse=1 / stringify=2`；**held 模式**验证提交在途改内存不混进本次提交 | V04、V05 |
| C8 | 权威提交失败被如实上报、**不提前发布已提交快照**、旧投递不被误停；成功后旧投递才被停；真实 `visibilitychange` 入口也被接上 | V04、V05 |
| D / D2 | 空启动与持久数据启动各容器只写 1 次；到期事项启动当期就推进；1000 条折叠 0 卡片、展开 1000、收起释放 | V07、V09 |
| E | 危险协议 8 类（含大小写 / 前导空白 / 内嵌换行 / data / vbscript / file / 畸形）全部降级为转义纯文本；所有可点击 `href` 都是 `https:`；原始 `it.url` 未被删；含引号 ID 的 `data-id` 与动作按钮都被转义、无裸 `onmouseover=` 属性 | V10 |
| F / F2 | 100/500/2000 × 空/满台账 0 次大数组 `find`；编辑前 vs 本轮对照；满台账业务结果正确；重复 ID 首项胜；delivered / suppressed / cancelled / roundBase 逐条保留 | V06 |
| G | 无变化的一拍不重写容器且记为 `skipped`；跨日文案变化必须重建；数量 / 展开状态变化必须重建；`#homeNotice` 同一结论重复到达不重写、结论变化立刻更新、断链消失主动清空；`#homeReview` 每拍被调但不重写 | V07、V08 |
| H | 深链 `?tab=future` 不渲染首页；分享参数在渲染前进表单且首页仍只写 1 次 | V09 |

### 4.4 与方案 §5 验收矩阵的对照（含**未覆盖**的部分，逐条说清）

| 编号 | 本轮结论 | 依据 / 缺口 |
|---|---|---|
| V01 | **自检通过** | A / A3 / A4 / B / C6。负例经**反向对照**（真实删脚本、真实倒序、坏清单）证明能抓住，不是「数长度」；另两套 harness 的组合缺口被声明式检查 |
| V02 | **自检通过** | C2/C3 计数 + 桥调用分离观察（「额外对账」与「实际重排」分开计） |
| V03 | **部分覆盖** | 排程 / 撤销失败与重试已覆盖（C5）；**「对账阻塞期间改时间 / 删除 / 完成」未单独立专项用例** —— 串行与 pending 保护由既有 `test-regressions.js`（730 条）与 `commitChain` 机制覆盖，但本轮**未新增**该场景的计数证据。**如实标注为未完成。** |
| V04 | **自检通过** | C7（held 模式）+ C8（失败不提前发布） |
| V05 | **自检通过（部分为既有覆盖）** | IDB 正常 / 失败由 C7/C8 新增覆盖；镜像尽力写、无 IDB 本地权威、IDB open 失败与 pending-replay 由既有 `test-smoke.js`（H-07 段）与 `test-unit.js`（memory 后端）覆盖，**本轮未新增** |
| V06 | **自检通过** | F/F2：100/500/2000 × 空/满台账 0 次整表扫描；重复 ID 首项语义有专项断言 |
| V07 | **自检通过** | D2（折叠 0 / 展开 1000 / 收起释放）+ G（改内容 / 数量 / 展开状态） |
| V08 | **部分覆盖** | 「无变化不重建」「应变化不滞后」有断言；**「跨分钟 / 午夜 / 勿扰与整理窗口 / 权限状态变化」的浏览器级交互验证 NOT_PERFORMED**（无浏览器，见 §6）。签名覆盖项已由源码审查 + `quiet`/`reviewPending`/`doneTodayCount`/`userMode`/`projects` 入签名单列确认 |
| V09 | **自检通过** | D（空 / 持久数据 / 到期启动）+ H（深链 / 分享） |
| V10 | **自检通过（JS/VM 层）** | E：危险值不成为可执行入口、属性结构完整、数据不被静默删除。**真实浏览器的 `href` 可执行性验证 NOT_PERFORMED**（无浏览器）—— VM 里 `safeExternalHref` 走的是真 `URL` 解析器，但「浏览器点了会不会执行」未实测 |
| V11 | **自检通过（既有语义不变）** | ACK / 稍后 / 完成 / 恢复 / 停止声振 / 截止保护 / 相对与日历时间的既有断言（`test-regressions.js` 730 条 + `test-unit.js` 330 条）在本轮**全部保持通过**；F2 另行确认台账三态语义未变 |

---

## 5. 交付身份（源码 SHA-256）

完整清单见 `source-hashes.txt`（交付瞬间冻结）。关键条目：

```
3055d7a166040bf11c645a8ddcd383ae74d85ae2029d1f12e1997992aa2a8515  app-core.js
718cc42589df3f6a85a28d97520d5cd898ea837240dfdc939f355f6a908e0679  lib/native-reminders.js
f13eca9a0479a59d19e2c03f7d3152406fe7d378ff62e33a0627f4ed2171c0b5  index.html
aa077b2eaad0f49aa4e8ea7e27eab39a101d1086e03dcaccdc7a083f4cb784a3  sw.js
dbbe3d768001a916aad4f9f3cda2b91f263a01074cfb15e5738a978820dfe476  package.json
d84eaa3fa740d12a2aee0811f085be79177cc6f08e2a14e70dbba99e7cdf7d51  scripts/verification/production-scripts.js
3a607a4200ef6e467a714aebdafc94a42ec583b58df0b3d3c829315aa3f67602  scripts/verification/perf-counts.js
eb53e77019ce29a61287d9c0f0d85c2b7d7b29e41339b5015e3f247607fae7ef  test-boot-combination.js
```

`git HEAD` = `origin/main` = `4de5f597573bc2c45b51ba8ab18a279d054339a0`。

**注意（交给独立验收时的提醒）**：由于本轮**未提交**，`HEAD` 并不包含本轮改动 —— 交付身份是**工作区字节**（上列哈希），不是 commit。验收方必须按哈希核对工作区，不能按 `HEAD` 恢复。同样地，`pre-edit/` 归档的是「本轮动手前的工作区」，它本身也不等于任何 commit。

---

## 6. 证据级别声明（§5 的分级要求）

| 级别 | 本轮状态 |
|---|---|
| 源码 | **已完成**（diff + 哈希） |
| JS 单元 / mock | **已完成**（5 套共 1790 条） |
| **浏览器实际交互** | **NOT_PERFORMED** —— 本机**没有** Chromium / Playwright 浏览器二进制（`~/Library/Caches/ms-playwright` 下只有 `daemon` 与版本检查文件，无 `chromium-*` 目录），`agent-browser` 未安装（安装需约 500MB 下载 + 网络）。`/Applications` 下无 Chrome/Chromium/Edge。**不用 DOM stub 冒充浏览器证据。** |
| 打包运行时（APK 内 `assets/public/` 逐字节 cmp） | **NOT_PERFORMED** —— 本任务未授权安装 APK / 覆盖 `releases/` 候选，也没有跑 `cap sync`（沙箱批量删除护栏 + 会覆写 tracked 的 debug.apk）。生产脚本组合未变化，`sw.js`/`sync-www.js` 的**静态覆盖**已用 `production-scripts.js` 核对（见 `script-combination-check.txt`）。 |
| **Android 实机** | **NOT_PERFORMED** —— 未安装 APK、未变更设备设置、未操作用户真实事项。方案 §6 明确「不因没有真机就编写『无感/省电』」；本报告**不含**任何真机耗时或省电结论。 |

---

## 7. 剩余风险与未完成项（不掩盖）

1. **V03 的「对账阻塞期间改时间 / 删除 / 完成」没有本轮新增的专项计数证据**。机制上由 `commitChain` 串行 + pending 保护承担，且既有 730 条回归全绿，但这是**推断**不是本轮实测。列为未完成。
2. **浏览器 / Android 实测全部 NOT_PERFORMED**（原因见 §6）。因此下列结论**只在 Node VM + mock 层成立**：
   - 危险 URL「点不动」在真实 Blink 里的行为；
   - 折叠态 0 卡片对应的**实测 DOM 节点数 / 堆内存**（本报告只有 HTML 字符串体积，方案 §3 已明确「这是字符串体积，不是实测 DOM/堆内存」）；
   - 焦点 / 滚动位置 / 按钮忙碌态在「不重写容器」时的稳定性（逻辑上由不替换节点推出，未实测）。
3. **`refreshActiveAlarmPanel` 仍然对每个在途投递做 `state.items.find`**（`app-core.js` 中 `for (const alarm of result.alarms || [])` 内）。它不在方案 §4 O4 列出的四处范围内，且「在途投递」数量级是 0–2，本轮**未改**。登记为后续候选（与 §8 的「最小已提交快照」同域）。
4. **`#homeNotice` 在一次数据启动里仍被写 3 次**（原 6 次）。剩下的 3 次是真实的状态迁移（初始无状态 → 总开关话术 → ……），不是重复内容。若要求继续压低，需要把「告知条判定」并进首页视图模型签名，属结构性改动，本轮不做。
5. **`promoteDue()` 仍每拍执行**（这是刻意的：业务推进不能藏在渲染短路后）。它自身可能触发保存 → 对账，本轮未为其做计数。
6. **O5 的 memory 后端别名**：`lib/storage.js:155` 是 `mem.value = obj`（存引用）。因为 `writeSnapshot` 交给 `storage.save` 的**已经是 `JSON.parse` 出来的独立副本**，别名只指向那份冻结副本，后续内存改动不会污染已提交判定。这一条是**代码论证 + C7 的 held 模式实测**，但**没有**单独的「memory 后端 + 后续改动」专项用例。
7. **`test-boot-combination.js` 的 DOM 是计数替身**，不是真实 DOM。`insertBefore`、`closest`、`scrollIntoView` 等都是空实现 —— 因此 §4.3 里所有涉及 DOM 结构的结论都是**替身层**结论（例如「卡片节点被释放」是「容器 innerHTML 变回 0 张」）。
8. **本报告不构成 PASS 标签**。V18/V19/V20 一类的 `NOT_PERFORMED` 不得被豁免成 PASS，这一点在本轮同样适用。
9. **`test-smoke.js` 与 `test-regressions.js` 仍然没有把 `lib/native-reminders.js` 放进沙箱**（这两套里原生模块恒 `undefined`，走 `|| {}` 兜底）。本轮**刻意未改**这两套（§4 O1：保留有效的专项替身），只是把这个缺口变成 A4 段里被声明的、可断言的事实。生产组合层的覆盖由 `test-boot-combination.js` 承担。**如果验收方认为这两套也应当加载真实原生模块，那是一个独立决定，本报告不代为实现。**

---

## 8. 复跑方式

```bash
cd /Users/qlyf/Developer/reminder
npm test                                                   # 5 套，1790 通过
node scripts/verification/perf-counts.js                   # 计数对照 → perf-counts.json（约 40s）
node -e '...'                                              # 见 script-combination-check.txt 头部注释
```

对照用的 `pre-edit/app-core.js` 随证据目录一起留档；`perf-counts.js` 通过 `loadCombination({ overrides: { "app-core.js": "<pre-edit 路径>" } })` 在**同一 harness、同一组合**下跑编辑前那一份。**任何后续补丁请用新 run-id 并标注替代关系，不要覆盖本目录。**

---

## 9. 交回独立验收

按用户要求，本任务**未提交、未推送**。以下三项交回原审查任务：

1. 实现报告绝对路径：`/Users/qlyf/Developer/reminder/docs/reviews/code-optimization-implementation-20260920T1706-code-optimization.md`
2. 证据目录：`/Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260920T1706-code-optimization/`
3. 最终源码身份：`docs/reviews/verification-runs/20260920T1706-code-optimization/source-hashes.txt`

验收方请按 §5 的工作区哈希核对，并复跑下文列出的反例：删 `lib/native-reminders.js`、`app-core.js` 提前、dangerous URL 矩阵、折叠 1000 条、held 模式下在途改内存、失败提交后旧投递是否被误停。
