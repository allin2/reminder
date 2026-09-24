# F02-R3 返工：依赖契约从「类型名」扩到「容器形状」

日期：2026-09-21。run：`20260921T0545-array-contract`。

上游：第四次独立复验 `20260921T052806-independent-guard-recheck` 判 **FAIL / FIX_REQUIRED** ——
根对象守卫那条已 PASS，新阻断是 **`Feedback.TEST_FEEDBACK` 只按 `object` 校验**：注入 `{}` 后
`ready=true`、`startupFailure=null`，真实消费者随后抛 `list.map is not a function`。

**本轮状态：已改、已自测通过。实施方自测，不是独立验收，不得视为 PASS。**

## 1. 根因

三种判据被当成了一件事：

| 判据 | 能证明 | 证明不了 |
| --- | --- | --- |
| `typeof got === "object"` | 值不是原始类型 | `[]` 与 `{}` 都是 `"object"` |
| `Array.isArray` | 容器是数组 | 元素是不是消费者要的形状 |
| 元素逐个查字段 | 元素可用 | —— |

真实消费点是 `testFeedbackButtonsHtml()`：`list.map(x => … x.value … x.label …)`。
只按 `object` 校验时，`{}` 会让应用**宣告就绪**，崩在用户走到那一屏的路上。

更隐蔽的一层：**静态侧看不出这件事**。探针实测（[`array-contract-probe.json`](evidence/array-contract-probe.json)）——
把声明表的 `array` 退回 `object`，四个出口 `undeclared / ambiguousAliases / ambiguousRefs / problems`
**仍然全空**。也就是说「形状契约」这件事从头到尾只有运行时闸门这一道防线，而闸门此前压根没有判形状的能力。
这一点必须在证据里写死：否则后来者会以为「静态四个出口是空的 ⇒ 形状也判过了」。

## 2. 改了什么

本轮动六个文件：四个产品/取证资产 + 一个浏览器用例脚本 + `sw.js` 缓存版本号。
「到底改了什么」一律以 [`source-hashes.txt`](evidence/source-hashes.txt) 里的带 `*` 条目为准。

### `app-core.js`

- 闸门的类型判定从一行抽出来成 **`describeTypeMismatch(got, want, itemShape)`**：
  - `want === "array"` 时由 `Array.isArray` 判定，**不用 `typeof`**；
  - `null` / `undefined` 仍单独判（`typeof null === "object"`，混在一起会放行）；
  - 第 4 列 `itemShape`（可选）逐个查元素字段，缺哪个就报哪个。
- 声明表新增可选**第 4 列**：`Feedback.TEST_FEEDBACK` 从 `"object"` 改成
  `"array"` + `["value", "label"]`；随之要求**非空**（空清单会让消费者什么都不渲染且不报错，
  同属「界面看着正常、功能已经没了」那一类）。
- 表头文档补上「期望类型」两类的说明。条目数仍是 **73**，类型分布 `{"function":64,"object":7,"array":1,"number":1}`。

### `scripts/verification/production-scripts.js`

- 读表正则的白名单加 `array`（此前只认 `function|object|number|string|boolean` ⇒
  `array` 的行会整条从 `declared` 消失，引用被误报 `undeclared`）。
- 返回新增 `declaredTypeOf`（路径 → 类型）与 `declaredTypes`（去重取值），
  并导出 **`CONTRACT_TYPES`** —— 让「类型白名单」有单一出处，而不是测试里各抄一份。

### `test-boot-combination.js`

- **B3 ⑪**（常驻）：三种坏形状**真启动**一遍 —— `{}` / `[{value:"heard"}]`（缺 label） / `[]`，
  每次都要求 `ready=false`、点名 `Feedback.TEST_FEEDBACK`、期望值以 `array` 开头、
  实际值是「object（不是数组）」「array[0] 缺少 label」「空数组（清单至少要有一项）」，
  且**副作用为零**（不开库 `puts=0`、不排通知、不排闹钟、不起 15000 心跳）。
  另有对照组：正常数组照常就绪 —— 否则这三条可能只是「这个 harness 起不来」。
- **B4 N4 / N5**（拔掉修复必须变红）：
  - N4 把期望类型退回 `object` ⇒ `{}` **重新被放行**（独立复验的缺陷形态复现），且有对照面；
  - N5 删掉元素形状核对 ⇒ 缺 label 的清单重新被放行（容器对 ≠ 元素对）。
- M1 的反向编辑随之更新：`null` 判据搬进 `describeTypeMismatch()` 之后，
  原来那一行 `got === null || typeof got !== want` 已不存在，改打那一句 `null` 早退。

### `scripts/verification/parse-single-source.js`

- F 段新增四条：该条是 `array` 契约、`UNDO_WINDOW_MS` 仍是 `number`、
  声明表里出现的类型取值都在 `CONTRACT_TYPES` 白名单内；
- 反向对照：写成白名单外的类型（`arrray`）⇒ 该声明不再被认 ⇒ 引用变 `undeclared`（fail closed），
  外加「合法类型下必须被识别」的对照面 —— 否则上面那条可能是「这张表本来就不认它」。

### `scripts/verification/browser-recovery-check.py`

- 新增两个真实 Chrome 用例：`feedback-array-object`（`TEST_FEEDBACK={}`）与
  `feedback-array-item`（元素缺 label）。两者的判据里**明确要求点名且期望以 `array` 开头**，
  不是只看「有没有失败」。

### `sw.js`

- 缓存名 `attention-inbox-v9` → **`v10`**：`app-core.js` 内容变了，不换名的话已装用户
  会一直吃旧那一份，修复对他们等于没发生（这个坑前几轮已经踩过）。

## 3. 实测水位

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| `npm test` | unit 411 / native 321 / **boot 287** / smoke 256 / regressions 730 / **single-source 160** = **2165**，失败 0，退出码 0（上轮 2144） | [npm-test.log](evidence/npm-test.log) |
| 常态化合约取证 | ⑪ 三条 × 3 断言 + 对照 + N4/N5 前置与变红，共 15 条全绿 | [runtime-contract-tests.log](evidence/runtime-contract-tests.log) |
| 静态契约探针 | 四出口全空、`TEST_FEEDBACK`=array、白名单闭合、退回 `object` 时静态**看不出**、非法类型 ⇒ 变红，6/6 | [array-contract-probe.log](evidence/array-contract-probe.log)、[.json](evidence/array-contract-probe.json) |
| UI 格式对照 | 567 项一致 | [ui-format-parity.log](evidence/ui-format-parity.log) |
| DOM 工具对照 | 16 场景 / 590 字段一致 | [ui-dom-parity.log](evidence/ui-dom-parity.log) |
| Chrome 恢复矩阵 | **8 个用例**（control + 7 故障场景）0 项断言失败、退出码 0 | [browser-recovery-command.log](evidence/browser-recovery-command.log)、[browser-recovery.json](evidence/browser-recovery.json) |

Chrome 两个新用例的面板原文（真实取证，不是复述）：

```
feedback-array-object  ready=false  opens=0 puts=0
  Feedback.TEST_FEEDBACK 期望是 array<value,label>，实际是 object（不是数组）
feedback-array-item   ready=false  opens=0 puts=0
  Feedback.TEST_FEEDBACK 期望是 array<value,label>，实际是 array[0] 缺少 label
```

对照：独立复验在**同一注入**上量到的是 `ready=true` / `startupFailure=null` /
`list.map is not a function`。同一份坏数据，现在在打开 IndexedDB 之前就被拦住。

## 4. 这一轮把验收出口抬到哪里

F02 的判据变化：

| 轮次 | 出口判据 |
| --- | --- |
| 第一轮 | 「成员是否已手工登记」 |
| 第三轮 | 「新增别名依赖无法绕过矩阵」 |
| 第四轮 | 「根对象守卫不能冒充成员守卫」 |
| **第五轮（本轮）** | **「形状也是契约：容器必须是数组、非空、每项带消费者要的字段；坏形状在副作用之前就被点名」** |

## 5. 本轮**没有**做的事（明确边界，避免被读成已验证）

- **元素字段自身的值类型未校验**：`[{value:{}, label:3}]` 这类「键在、值类型不对」不会被拦。
  本轮收紧的是容器 + 非空 + 键的存在性。
- **函数返回值不在契约里**：`someFn()` 返回 `[1,2]` 还是 `{}`，闸门不查（那是运行时返回契约，
  需要另一套机制，本轮不碰）。
- 除模块根之外，声明表里当前的非 `function` 成员只有两条 —— `Feedback.TEST_FEEDBACK`（数组）
  与 `Feedback.UNDO_WINDOW_MS`（number）；本轮逐条处置了这两条，没有「还有一批同类没查」。
- **P2 剩余 / P3 / P4 离线升级实测 / 打包链逐字节比对 / APK / 实机验收：全部未做。** 本轮未构建 APK，
  任何实机项仍是 `NOT_PERFORMED`。`app-core.js` 仍 404,171 字节，远未到薄装配入口。

## 6. 交付身份

- HEAD `3574824` == `origin/main`，未提交未推送，93 条脏条目（`git diff --check` 退出 0）。
- 本轮改动的五个文件 SHA-256 见 [`source-hashes.txt`](evidence/source-hashes.txt)（带 `*` 标记）；
  记录值与当前工作区字节**逐文件核对一致**。
- ⚠️ 验收方**不要**用 `git checkout -- <file>` / `git stash` 还原现场 —— 交付物就是这些未提交字节，
  还原会把它们抹成基线且不可恢复。
