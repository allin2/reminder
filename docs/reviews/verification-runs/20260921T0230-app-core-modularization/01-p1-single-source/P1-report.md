# P1 实施报告：规则收敛与装配失败闭环

- **run**：`20260921T0230-app-core-modularization`
- **阶段**：P0（冻结基线）✅ → **P1（本报告）** ✅ → P2/P3/P4 未开始
- **提交状态**：**未提交、未推送**（按流程保留全部改动在工作区；源身份见 `source-hashes.txt`）
- **基线**：HEAD `3574824`，`app-core.js` 拆分前 8,558 行 / 387,384 B，五套 1814 全绿

---

## 1. 一句话结论

P1 出口「唯一来源矩阵闭合 · 缺依赖反例可见失败 · Web/Node/原生模拟组合正常 · 五套测试通过」**已达成**，
且把「五套」扩成了**六套**（新增 `parse-single-source.js` 并挂进 `npm test`）。
基线 1814 项 → 现在 **1920 项全绿**，`npm test` 退出码 0。

| 套件 | 基线 | P1 后 | 变化 |
| --- | --- | --- | --- |
| `test-unit.js` | 337 | **337** | — |
| `test-native-reminders.js` | 321 | **321** | — |
| `test-boot-combination.js` | 170 | **198** | +28（含 17 条闸门反例 + 依赖/顺序反例） |
| `test-smoke.js` | 256 | **256** | — |
| `test-regressions.js` | 730 | **730** | — |
| `parse-single-source.js`（新） | — | **81** | 新增，已入 `npm test` |
| **合计** | **1814** | **1920** | +106，失败 0 |

> **基线是 1814 全绿、零失败**（`00-baseline/baseline-npm-test.log` line 956 实测 `通过: 170  失败: 0`）。
> 中途 `test-boot-combination.js` 曾出现 **5 条失败**，那是**本轮自己造成**的：新增第 9 支脚本
> `lib/date-utils.js` 后，脚本里写死的 `indexScripts.length === 8` 与两条负向夹具（少带了
> `date-utils.js` 依赖）失配。已按 P4「不仅比较数量，还核对集合与顺序」改为**有序全清单契约**，
> 并把负向夹具补齐依赖 —— 不是把数字从 8 改成 9 了事。
> 附带发现：这两条失配恰好**证明**了新加的加载期依赖声明是有牙齿的
> （负向清单少了 `date-utils.js` 时，检查器如实报出 `missing-load-time-dependency`）。

---

## 2. 做了什么（逐项对 P1 要求）

### 2.1 抽共享日期原语 → `lib/date-utils.js`（新增）

原先 `startOfDay` / `endOfDay` / `addDays` / `applyClock` / `lastDayOfMonth` /
`nthWeekdayInMonth` / `weekdayOfNextWeek` / `dayOfMonthIn` / `nextDayOfMonth` / `nextWeekend`
在 **`app-core.js`、`lib/parse-cn.js`、`lib/repeat.js` 各有一份同算法副本**（`nthWeekdayInMonth` 三份）。

新文件的关键设计**不是**「抽出来共享」，而是**换了导出机制**：

- 用**命名空间挂载** `AttentionLib.DatePrimitives`，不再走扁平的
  `Object.assign(AttentionLib, factory())`。后者是「同名键谁后加载谁生效」，**顺序错了不抛错**，
  只会静默换一套实现 —— 这正是拆分前副本得以长期共存的原因。
- 消费方（`parse-cn` / `repeat`）在**求值时**就把命名空间抓进闭包常量，**拿不到直接抛错**，
  不再自带一份兜底算法。
- 把**故意不同**的两条语义显式分开命名：`nthWeekdayOfNextMonthByInstant`（首期候选，按具体时刻比较）
  与 `...ByDay`（周期推进，按「日」比较）。合并会让周期**原地打转**（锚点 1/31 09:00 时，
  1/31 10:00 被当成未来）。两者已用固定时钟取证：`2026-01-05(周一) 09:00` 锚点上结果分叉，
  普通锚点上一致。

### 2.2 清除 `app-core.js` 里的副本、覆盖块与静默替代

`app-core.js` 从 **8,558 行 / 387,384 B** → **8,391 行 / 311,743 B**（−167 行、−75,641 B）。

删除清单（每一条都由 `parse-single-source.js` 的 A 段**逐条断言**，塞回去就变红）：

- 整份中文解析器副本：`CN_NUM` / `cnInt` / `parseChineseTime` / `hasSpecificTimeWord`（**约 250 行**）
- 周期推进副本 `nextRepeatTrigger`、周期文案 `repeatLabel`、预演 `nextRepeatPreview`
- 日历原语定义 20 处（`function startOfDay` … `function nextWeekend`）
- **运行时函数覆盖块** `if (Lib.parseChineseTime) parseChineseTime = Lib.parseChineseTime;` 等 4 条
- 截止保护兜底 `deadlineStageKeyOf` 的「24h/2h 自算一份」（与规范实现是**两套边界常量**）
- 免打扰兜底：`parseHHMM` 及 `23, 0` / `7, 30` 默认值常量
- `lib/native-reminders.js` 里的三份算法副本：`parseHHMM` / `inQuietHours` / `quietEnd`，
  以及「只排 p24」的 `deadlineStagePoints` 兜底（**丢掉整个 p2 档**）

保留的**只有转发适配**（计划允许：「只准转换参数或读取设置」）：
`function inQuietHours(d) { return Lib.inQuietHours(d, state.settings); }`。

### 2.3 启动前依赖闸门（`assertRuntimeDependencies`）

原先 `assertRuntimeDependencies()` **只存在于注释里**。现在真正落地：

- **声明表** `REQUIRED_RUNTIME_EXPORTS`：29 条 `[路径, 期望类型, 缺了会怎样]`，第三项原样出现在用户可见面板上。
- **闸门位置**：`startApp()` 的**第一条语句**，早于 `init()` 全部内容。
  这点是硬要求 —— 一旦进了 `init()` 就会依次发生 `loadAsync`（读库并**整体替换** `state`）、
  schema 迁移的 `save()`、`ensureNativeReminders()`（排钟/建通知渠道）、`setInterval(tick, 15000)`。
- **可见失败面板** `renderStartupFailure()`：纯文本 + 「重试」「重新加载」两个按钮，**不放任何可编辑控件**，
  并写明「为免出现『能输入但存不下来』的界面，本次未加载数据、未做迁移、未安排提醒、未启动后台心跳」。
- **`ready()` 明确返回 `false`**，不是挂起、不是假装成功。
- **刻意不包含** `AttentionNativeReminders` / `Capacitor`：原生桥是**旁路能力**，
  纯 Web 环境没有它是**正常状态**。这条有专门的反例守着。

### 2.4 顺带查出并修掉 4 处**未被声明**的静默降级

写「矩阵闭合」检查时发现的（不是这次引入的，是长期存在的）：

| 位置 | 缺件时的真实后果（原来是静默的） |
| --- | --- |
| `Lib.hasIdb` | 无法判断是否在降级后端上，降级期保护静默失效 |
| `Lib.applyWindowTrigger` | **柔性窗口完全不生效**，带 `windowStart/End` 的事项按硬时刻触发 |
| `Lib.shouldRealert` | **重要事项的重复提醒整体不再触发**（判定被静默转成 `false`） |
| `Lib.markReminded` | 重复提醒台账不落，下一拍把同一事项再当「未提醒」重新弹 |

四处都改为**声明 + 去兜底**：现在缺件是启动失败，而不是换一套规则。

### 2.5 `parse-parity.js` → `parse-single-source.js`（重写）

原脚本的前提是「app-core 里还有一份解析器副本」，它按花括号配平把副本切出来跑对照。
P1 删掉副本后**它第一步就抛错**（`找不到函数定义：function startOfDay(d)`），
而且即便能跑，证明的也是一个**已不存在的性质**。

新脚本证明三件原脚本证明不了的事：

1. **结构**：20 处算法体定义已从 app-core 消失（含反向对照：塞回去必须变红；注释里的不算）
2. **绑定**：lib 的别名是**同一函数对象**（`parse.startOfDay === prim.startOfDay`），
   不是「行为相同的两份副本」；两种 `nthWeekdayOfNextMonth` 语义显式分叉
3. **语义**：语料走唯一入口，逐条断言**可从契约独立推导**的性质（星期几、跨周/跨月推进、
   elapsed vs wall-clock 记账基准、月末收敛、不原地打转）

> ⚠️ **期望值纪律**：凡写死的时间戳都能从句义独立推出（附「判据」注释）。
> 推不出来的（例如「每月第一个周一」在某天的具体落点）**不写死** —— 那会变成快照而非契约。
> 同理，**没有**断言 `repeat.dow === 1`：按当前契约 `every:"week"` 的星期几由**锚点**
> （`item.triggerAt`）承载，`nextRepeatTrigger` 只加 7 天并沿用原钟点。
> 「是周一」这句话改由**推进结果**证明（后续 4 轮都在周一 09:00）。

---

## 3. 新增/复用的验证资产

| 文件 | 作用 |
| --- | --- |
| `scripts/verification/core-inventory.js` | 顶层函数/状态清单（P0 搬移表的数据源，可复跑） |
| `scripts/verification/module-map-gen.js` | 职责分配表生成（365/365 符号已分配） |
| `scripts/verification/parse-single-source.js` | **新**：单一来源核对，81 项，已入 `npm test` |
| `production-scripts.js` `runtimeDependencyCoverage()` | **新**：运行时依赖矩阵闭合检查（剥注释，支持源码注入做反例） |
| `production-scripts.js` `stripComments()` | **新**：等长空白剥注释，供闭合检查与结构判据共用 |
| `test-boot-combination.js` B2 段 | **新**：闸门的 17 条断言（含 9 条反例） |

**闭合检查为什么比「启动正常」强**：闸门只保护它**列出来**的东西。
有人新写一行 `Lib.somethingNew(...)` 却忘了进表，闸门看不见它 —— 运行到那一行才 TypeError，
或者更糟：写成 `Lib.x ? … : 兜底` 于是静默降级。
`runtimeDependencyCoverage()` 把「引用集合」与「声明集合」逐符号对齐，由这条守住。

---

## 4. 反例清单（「拔掉修复后必须变红」）

| 反例 | 期望 | 结果 |
| --- | --- | --- |
| 抽掉 `lib/parse-cn.js` | `ready=false`、点名 `parseChineseTime`、**IDB 零写入**、**无 15s/2s 定时器**、`state.items` 空、面板真的插进首页容器、日志也有记录 | ✅ |
| 抽掉 `lib/feedback.js` | `ready=false`、点名 `Feedback` | ✅ |
| 抽掉 `lib/storage.js` | `ready=false`、点名 `createStorage` | ✅ |
| 抽掉 `lib/date-utils.js` | `parse-cn`/`repeat` **求值即失败**（不再静默换算法） | ✅ |
| 把 `date-utils.js` 排到解析器之后（**顺序错**） | `eval-failed:lib/parse-cn.js`，且闸门拦启动、不读库、不起定时器 | ✅ |
| **没有原生桥** | 闸门**不**报错、`ready=true`（纯 Web 是正常状态） | ✅ |
| 新增未声明的 `Lib.brandNewThing` | 闭合判定报出 `undeclared` | ✅ |
| 注释里提到 `Lib.commentOnlyThing` | **不**误报（剥注释真的生效） | ✅ |
| 塞回 `function startOfDay` / `function cnInt` | 结构判据变红 | ✅ |
| 坏清单（顺序倒置 / 未知脚本 / 缺文件 / 重复加载 / app-core 不在最后） | 各自报**具名**问题，而不是「长度对不上」 | ✅ |

---

## 5. 未做 / 遗留（不隐瞒）

1. **`test-smoke.js` 与 `test-regressions.js` 仍不加载 `lib/native-reminders.js`**。
   这是**已知并已被断言**的缺口（`production-scripts.js` 会报出来、A4 段有专门断言），
   本轮**刻意未改**以保留其专项替身。新增 `lib/*.js` 后请以 `runtimeDependencyCoverage()` + A4 为准核对。
2. **`deadlineStagePoints` 在声明表里属「冗余声明」**（app-core 自己不调，消费者是 `lib/native-reminders.js`）。
   已在源码注释里写明理由；`unusedDeclarations` 会报出来，那是已知冗余而非漏洞。
3. **`FeedbackLib ? … : null` 形式的其余内联兜底仍有若干处**（动作语义、撤销窗口、测试反馈步骤）。
   闸门已保证这些模块**必然存在**，所以它们在实际运行中不可达；
   但「代码里还留着」这件事本身，按计划属于 P2（搬移 UI/AI/反馈）时应一并清理的范围。
   **本轮未动**，不把它算作 P1 的完成项。
4. **P2/P3/P4 全部未开始**：UI/平台功能搬移、持久化与事务整组迁出、生产组合/离线升级/打包收口。
5. **未做真机构建与实机验证**。P1 不要求构建；`releases/安心收件箱-debug.apk` 的字节还原、
   `assets/public` 逐字节 cmp 属 P4。**设备条件不足时保留明确缺口，不把构建成功写成实机 PASS。**
6. **本阶段全部改动未提交、未推送。**

---

## 6. 复算方式

```bash
cd /Users/qlyf/Developer/reminder
npm test                                                   # 六套，期望 1920 项全绿、退出码 0
node scripts/verification/parse-single-source.js           # 81 项，期望 PASS
node -e "const p=require('./scripts/verification/production-scripts.js');
         console.log(p.runtimeDependencyCoverage('.').undeclared)"   # 期望 []
shasum -a 256 -c <(sed -n '/^[0-9a-f]/p' \
  docs/reviews/verification-runs/20260921T0230-app-core-modularization/01-p1-single-source/source-hashes.txt | \
  sed 's| |  |')                                            # 期望逐字节一致
```

证据目录：`docs/reviews/verification-runs/20260921T0230-app-core-modularization/`

- `00-baseline/`：基线日志（1814）、源哈希、`core-inventory-before.json`、职责分配表、状态所有权表
- `01-p1-single-source/`：`npm-test-p1.log`、`parse-single-source.log`、`dependency-matrix.txt`、`source-hashes.txt`

**实施者自测 ≠ 独立验收。** 本报告只陈述自测结果；P1 是否通过须由验收方自行复跑上表反例。
