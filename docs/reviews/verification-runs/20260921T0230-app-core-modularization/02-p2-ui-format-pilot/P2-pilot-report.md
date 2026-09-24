# P2 首批搬移报告：UI 纯格式化 → `lib/ui-format.js`

- **run**：`20260921T0230-app-core-modularization`
- **阶段**：P0 ✅ → P1 ✅ → **P2（首批，本报告）** 🔶 进行中 → P3/P4 未开始
- **提交状态**：**未提交、未推送**（源身份见 `source-hashes.txt`；`git HEAD` 仍是**未含本轮改动**的提交，
  这正是下面 oracle 对照能成立的前提）

---

## 1. 一句话结论

P2 的第一步按「先搬**纯函数**、建立装配模式」落地：**8 个 UI 纯格式化函数**从 `app-core.js`
移入新模块 `lib/ui-format.js`，四处加载链全部同步，并且**用 `git HEAD` 里的旧实现当 oracle**
逐项证明「搬移没有改变行为」（567 项一致）。
`npm test` 六套 **1966 项全绿**、退出码 0。

| 套件 | P1 后 | P2 首批后 | 变化 |
| --- | --- | --- | --- |
| `test-unit.js` | 337 | **364** | +27（新增 ui-format 段，全部固定时钟） |
| `test-native-reminders.js` | 321 | **321** | — |
| `test-boot-combination.js` | 198 | **202** | +4（新模块的缺件 / 顺序错反例） |
| `test-smoke.js` | 256 | **256** | — |
| `test-regressions.js` | 730 | **730** | — |
| `parse-single-source.js` | 81 | **97** | +16（新增 A2 段：搬移后的结构判据） |
| **合计** | **1920** | **1966** | +46，失败 0 |

---

## 2. 搬了什么

| 函数 | 说明 |
| --- | --- |
| `pad` / `uid` | 补零、事项 id 生成 |
| `escapeHtml` / `escapeAttr` | 文本侧与属性侧转义（字符集相同、命名必须分开） |
| `fmtTime` / `fmtDate` / `relDue` | 时间显示、日期显示、相对到期 |
| `renderMarkdown` | 最小 Markdown 渲染 |

**只搬纯函数**：不碰 DOM、不读 `state`、不调 `save`。
碰 DOM 的（`toast` / `downloadFile`）、需要 `state` 的、要读设置的，**留在 app-core**
—— 它们属于「视图 / 表单」层，需要自己的装配边界，混在这一层搬走正是这类拆分出事的典型方式。

`app-core.js` 里只剩**单行委托**（如 `function fmtTime(ts) { return UiFormat.fmtTime(ts); }`），
与 `inQuietHours` 同一形态（计划明确允许：「转发适配只准转换参数或读取设置」）。

### 新模块的设计要点

- 与 `lib/date-utils.js` **同构**：命名空间挂载 `AttentionLib.UiFormat`，不走扁平 `Object.assign`
  （扁平合并的同名键「谁后加载谁生效」，顺序错了**不抛错**）。
- 求值时抓 `AttentionLib.DatePrimitives`（`sameDay` / `addDays`），**拿不到直接抛错**，
  不在这里自带一份日历兜底。
- 为 `fmtTime` / `fmtDate` / `relDue` 加了**可选**的 `now` 入参 —— 这是**唯一**对外的形状变化，
  是纯增量（既有调用方传 1 个参数，语义不变），目的是让「今天/明天/昨天」能被**固定时钟**验证。
  该增量由 oracle 对照的「默认路径」一节专门守住。

---

## 3. 「搬移没改行为」怎么证 —— oracle 对照

光说「我抄对了」不算证据。本轮的做法：

1. **oracle 来自 git**：本轮全部改动**未提交**，所以 `git show HEAD:app-core.js` 里就是
   搬移**之前**的原始函数体 —— 不是「我另写的一份副本」。取体方式按**行**累计大括号深度，
   不逐字符扫描（`renderMarkdown` 里的 `/[&<>"']/g` 会让「跳过字符串」的逻辑跑到正则中间，
   把深度数错，直接报「未闭合」）。
2. **注入可控 Date**：旧实现内部读 `new Date()` / `Date.now()`，不注入就无法逐项比对
   （「今天/明天」随运行时刻漂移）。给旧实现注入「无参构造 = 固定时刻」的 Date 替身。
3. **矩阵比对**：5 个「现在」× 18 个目标时刻 × 3 个格式函数 + 19 组字符串 × 3 个转义/渲染函数，
   共 **567 项**逐字符比对 → **全部一致**。
4. **反向对照**：篡改新实现必须被报出差异（否则脚本没有分辨力）；同一输入重复调用必须稳定。

```
$ node scripts/verification/ui-format-parity.js
反向对照：篡改实现能被报出差异 = true
反向对照：同一输入重复调用结果稳定 = true

比对项：567
结果：搬移前后逐项一致（PASS）
```

> ⚠️ 这个脚本是**本次搬移的一次性证据**，**不**入 `npm test`：
> 它的职责是「证明这一次没改行为」，长期挂在测试里会变成「锁死文案」的枷锁。
> 长期价值由 `test-unit.js` 的 ui-format 段承担（固定时钟黄金用例，27 项）。

---

## 4. 结构判据（防搬回来）

`parse-single-source.js` 新增 **A2 段**（16 项），两层判据：

- **委托形态**：app-core 里这 8 个函数必须只剩单行委托，且委托体里**不准**出现任何「算」的痕迹
  （`sameDay` / `addDays` / `getMonth` / `getDate` / `getHours` / `getMinutes` / `getFullYear` /
  `Date.now` / `Math` / `forEach` / `replace` / `padStart`）。
  这条**比「算法体标记」更强** —— 标记只对**搬移前的原样行**有效，微调过一版的抄写会漏过去。
- **算法体标记消失**：6 条标记行是**从 `git HEAD` 原样摘下来的**（不是「我猜大概长这样」），
  出现即回归。附一条反向对照：把 id 生成算法体塞回去必须被检出。

### 两处「我自己踩的坑」（记录下来，避免重犯）

1. **标记必须唯一属于被搬移的实现**：最初用 `if (sameDay(d, addDays(now, -1))) return "昨天";`
   当 `fmtDate` 的标记 —— 但它同时属于 **`dayLabel`**（另一个函数，默认值「更早」、跨年分支也不同）。
   假红。改为不依赖该行，并**显式断言 `dayLabel` 仍留在 app-core**，把这个「刻意的范围边界」
   写成可检查的事实，免得日后有人「顺手统一」而不知那是行为变更。
2. **取函数体不能用「找下一个 `\n  }`」**：单行函数（`function pad(n) { … }`）没有独立收尾行，
   那样会把后面一大段无关代码吞进来，于是委托判定被相邻代码误伤
   （`pad` 的体里混进紧随其后的别名声明）。必须按行累计深度。
   同理**不要**把函数自己或 `UiFormat` 的名字写进禁词表，否则委托本身就被误伤。

---

## 5. 加载链同步（四处 + 依赖声明）

| 位置 | 改动 |
| --- | --- |
| `index.html` | 新增 `<script src="lib/ui-format.js">`，紧跟 `lib/date-utils.js` |
| `sw.js` | `ASSETS` 加 `./lib/ui-format.js`；缓存版本 **v6 → v7** |
| `test-smoke.js` | 新增 `libUiFormat` 读取与 `vm.runInContext` |
| `test-regressions.js` | `LIB_SOURCES` 加 `"lib/ui-format.js"` |
| `test-boot-combination.js` | `EXPECTED_INDEX_SCRIPTS` 9 → **10 支**（有序契约） |
| `production-scripts.js` | `LOAD_TIME_DEPENDENCIES` 加 `lib/ui-format.js -> lib/date-utils.js`；新增 `NAMESPACE_LOCALS` 常量（`Lib` / `DatePrimitives` / `UiFormat`） |

`scripts/sync-www.js` 按目录整包复制 `lib/`，新文件自动进 `www/` —— 由 `packagingProblems()` 实测确认（返回空）。

**闭合状态**：引用 39 / 声明 40 / 未声明 **[]**；`inspectList` / `precacheProblems` / `packagingProblems` 全部 **[]**。

---

## 6. 反例清单（新模块）

| 反例 | 期望 | 结果 |
| --- | --- | --- |
| 抽掉 `lib/ui-format.js` | `ready=false`、点名 `UiFormat`、**IDB 零写入**、**无 15s 定时器** | ✅ |
| `lib/ui-format.js` 排到 `lib/date-utils.js` 之前 | `eval-failed:lib/ui-format.js`，且闸门拦启动并点名 `UiFormat` | ✅ |
| 篡改新实现 | 对照脚本报出差异 | ✅ |
| 把 id 生成算法体塞回 app-core | 结构判据检出 | ✅ |

---

## 7. 未做 / 遗留

1. **P2 其余部分全部未开始**：AI、备份、诊断、引导、内容/视图、表单，以及**逐功能拆 `bind()`**
   （`bind()` 仍是一个大函数，初始化顺序仍是隐式的一条长链）。
2. **`app-core.js` 里仍有大量 UI/编排逻辑**。本轮只搬了 8 个纯函数（约 110 行），
   app-core 仍是 8,000+ 行 —— **P2 远未完成**。
3. **`dayLabel` 与 `fmtDate` 语义相近但未合并**（见第 4 节第 1 条）：这是**刻意**的，
   不是遗漏。若将来要合并，属行为变更，必须单独立项。
4. **`FeedbackLib ? … : null` 形式的其余内联兜底仍在**（P1 遗留项 3），
   按计划属 P2 搬移对应功能时清理。
5. **未做真机构建与实机验证**（属 P4）。`releases/安心收件箱-debug.apk` 的字节还原、
   `www/` 与 `assets/public` 的逐字节比对均**未做**。
6. **本阶段全部改动未提交、未推送。**

---

## 8. 复算方式

```bash
cd /Users/qlyf/Developer/reminder
npm test                                              # 六套，期望 1966 项全绿、退出码 0
node scripts/verification/parse-single-source.js      # 97 项，期望 PASS
node scripts/verification/ui-format-parity.js         # 567 项逐字符一致，期望 PASS
node -e "const p=require('./scripts/verification/production-scripts.js');
         console.log(p.runtimeDependencyCoverage('.').undeclared)"   # 期望 []
```

证据目录：`docs/reviews/verification-runs/20260921T0230-app-core-modularization/02-p2-ui-format-pilot/`

- `npm-test-p2.log`、`parse-single-source.log`、`ui-format-parity.log`
- `dependency-matrix.txt`（含 10 支脚本清单、4 条加载期依赖、三项检查结果）
- `source-hashes.txt`

**实施者自测 ≠ 独立验收。** 关键反例（抽模块 / 顺序错 / 篡改实现）请验收方自行复跑。
