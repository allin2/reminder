# 别名歧义「fail closed」返工报告（实施方自测，**不是**独立验收）

- run：`20260921T0530-alias-fail-closed`
- 起因：第二次独立复验（`20260921T042905-independent-f01f02f03-recheck`）在 F02 上进一步指出：
  扫描器对**同名歧义**的处置是「放弃归因、只报告」，于是
  `const f = FeedbackLib` 与 `const f = e.target.files[0]` 撞名后，整条别名路径退出判定 ——
  换个别名就能把新依赖藏到矩阵之外。
- 用户裁定的修复路线：**消除源码歧义 + 扫描器遇到歧义即失败**，不引入 AST 解析器，
  不扩展到 P2/P3，不构建 APK。
- 改动文件（仅四个）：`app-core.js`、`scripts/verification/production-scripts.js`、
  `test-boot-combination.js`、`scripts/verification/parse-single-source.js`。

---

## 1. 逐条对照：要求 → 改了什么 → 拿什么证明

### ① 消除 `f` 的多重含义（app-core.js）

| 原形态 | 改为 | 处数 |
| --- | --- | --- |
| `const f = FeedbackLib;`（7 处） | `const feedbackApi = FeedbackLib;` | 21 处引用 |
| `const f = e.target.files && e.target.files[0];` | `const selectedFile = …` | 3 处 |
| `const f = FeedbackLib ? FeedbackLib.saveFeedback("failed") : …`（返回值与别名同名） | `const feedbackResult = …` | 3 处 |

实测（`stripComments` 后）：独立 `f` 标识符 **0 行**，`const/let/var f =` **0 处**，
`feedbackApi` 21 / `selectedFile` 3 / `feedbackResult` 3。

**这一步当场挖出两条真实未声明依赖**：别名不再撞名后，
`Feedback.captureSummary` 与 `Feedback.reminderFeedback` 从「歧义桶」里掉了出来，
暴露出它们**从未进过启动闸门声明表**（旧行为下它们靠运行时 `|| {}` 兜底静默降级）。
已补登，声明表 **69 → 71 条**（Feedback 相关 5 → 7 条）。

### ② 扫描器 fail closed（production-scripts.js）

`runtimeDependencyCoverage()` 新增**唯一判定出口** `problems`：

- 未声明依赖 → `problems`（`undeclared-dependency:<路径>（文件:行）`）；
- 歧义别名 → `problems`（`ambiguous-alias:<名>（…）`）；
- 歧义引用 → `problems`（`ambiguous-ref:<名.成员>（归属不可证明）`）。

`undeclared` / `ambiguousAliases` / `ambiguousRefs` **原样保留**供诊断，但判定只看
`problems.length === 0`。文档注释同步改写：旧的「这类引用的实际保护由运行时闸门承担」
已删——那句话正是「只报告、不判错」的理论依据。

### ③ 改掉「把放弃归因视为成功」的断言（test-boot-combination.js）

原文（约 836 行）断言的是「`f` 撞名 ⇒ 不进 `aliases`、只进 `ambiguousRefs`」——
即把缺陷写成了期望。现改为四条正向断言：

1. `feedbackApi ⇒ FeedbackLib` 别名归一生效（引用真的落到 `Feedback.*` 声明路径上）；
2. 产品源码**没有歧义别名**；
3. 产品源码**没有歧义引用**；
4. 依赖矩阵完全闭合：`undeclared` / `ambiguousAliases` / `ambiguousRefs` / `problems` 四空。

### ④ 三组永久反向测试（两组脚本各一套，都用 `options.source`，不动工作区源码）

| 编号 | 注入 | 必须发生 |
| --- | --- | --- |
| MUT-A 唯一别名 | `const feedbackApi = FeedbackLib; feedbackApi.independentUndeclaredMember();` | 归一为 `Feedback.independentUndeclaredMember` 并进 `undeclared` |
| MUT-B 直接命名空间 | `FeedbackLib.independentUndeclaredMember();` | 同样进 `undeclared`（对照组） |
| MUT-C 同名歧义 | `const auditAlias = FeedbackLib; auditAlias.auditMember();` + 另一处 `const auditAlias = nativeReminderStatus;` | `problems` 非空（既有 `ambiguous-alias` 也有落在它上面的 `ambiguous-ref`），**不许**返回闭合 |

MUT-C 另带**前置断言**：夹具必须真的改到两处，否则下面是空断言。

### ⑤ 单一来源验证同步（parse-single-source.js）

F 段原有两个出口（`undeclared` + `Lib.brandNewThing` 反例）扩为四个出口
（`undeclared` / `ambiguousAliases` / `ambiguousRefs` / `problems` 全空），
并把反向对照从「只有 `Lib` 路径」扩到**模块别名路径**（MUT-A / MUT-B / MUT-C 三条，
与组合测试同构、注入点都是 `function uid() {`）。

---

## 2. 修复前 / 修复后覆盖对照（同一次运行产出）

证据：`evidence/coverage-before-after.json`、`evidence/coverage-and-mutations-probe.log`

| | 修复前（旧别名形态） | 修复后（工作区） |
| --- | --- | --- |
| `undeclared` | `[]` | `[]` |
| `ambiguousAliases` | `["f"]` | `[]` |
| `ambiguousRefs` | 6 条（`f.TEST_FEEDBACK` / `f.captureSummary` / …） | `[]` |
| `problems` | **7 条**（按当前扫描器复算） | **`[]`** |
| `aliases` | `{}`（一条都没归上） | `{ feedbackApi: "FeedbackLib" }` |

修复前那条 `ambiguousFMutation` 是关键：注入 `f.independentUndeclaredMember()` 后
`undeclared` 仍是 `[]`、只落进 `ambiguousRefs` —— **盲点复现成功**。
而同一份旧源码上的 `directAliasControl`（直接写 `FeedbackLib.…`）能被报出来，
证明扫描器本身没坏，坏的是别名路径。

三组静态变异（`evidence/static-mutations.json`）全部按预期变红：

```
MUT-A-unique-alias       undeclared=["Feedback.independentUndeclaredMember"] problems=1
MUT-B-direct-namespace   undeclared=["Feedback.independentUndeclaredMember"] problems=1
MUT-C-same-name-ambiguity ambiguousAliases=["auditAlias"] ambiguousRefs=["auditAlias.auditMember"] problems=2
```

---

## 3. 把修复拔掉，必须变红（`evidence/fix-removal-must-go-red.log`）

两条最小变异，都只改一个文件、改完按字节还原：

- **N1**：把两类歧义从 `problems` 里摘掉（退回「只报告、不判错」）→
  组合测试 261→**260 过 1 败**、单一来源 149→**148 过 1 败**；红点正是
  「MUT-C 同名歧义 ⇒ `problems` 非空」与「产品源码没有歧义别名/引用」。
- **N2**：把 `app-core.js` 的别名改制整体退回（`feedbackApi`→`f` 21 处、
  `selectedFile`→`f` 3 处）→ 组合测试 **257 过 4 败**、单一来源 **145 过 4 败**；
  红点包括「别名归一生效」「没有歧义别名/引用」「problems 为空」。

还原后逐字节 sha 一致（`app-core.js` / `production-scripts.js` 均 YES），
两套测试回到 261 / 149 全绿。

---

## 4. 本轮水位（实测）

| 套件 | 通过 | 失败 |
| --- | --- | --- |
| test-unit | 411 | 0 |
| test-native-reminders | 321 | 0 |
| test-boot-combination | **261**（上轮 254） | 0 |
| test-smoke | 256 | 0 |
| test-regressions | 730 | 0 |
| parse-single-source | **149**（上轮 141） | 0 |
| **合计** | **2128**（上轮 2113） | **0** |

`npm test` 退出码 **0**。UI 对照：`ui-format-parity` **567 PASS**、
`ui-dom-parity` **590 PASS**。真实浏览器（Chrome + CDP，带 IDB 副作用计量器）**6 用例 0 失败、
退出码 0**：control `ready=True opens=1 puts=1`（证明计量器有牙齿），
五个故障场景全部 `ready=False opens=0 puts=0` + 可见失败面板。

---

## 5. 验收出口的变化

F02 的判据从「**当前**成员手工登记完整」升级为
「**新增别名依赖无法绕过矩阵**」：唯一别名路径、直接命名空间路径、同名歧义路径
三条都各有永久反向测试盯着，且拔掉任一环修复都会变红。
这把「声明表有没有写全」这件靠人细心的事，变成了「漏写就会被机器抓到」的事。

---

## 6. 仍然没做的（不因本轮而改变）

- 整体拆分剩余阶段：P2 剩余（AI / 备份 / 诊断 / 引导 / 内容视图 / 表单、逐功能拆 `bind()`）、P3、P4。
- 离线升级实测、打包链逐字节比对、APK、实机验收（排钟 / 锁屏 / 冷进程 / SAF）——**全部未做**，
  本轮**没有**构建 APK，任何实机项仍是 NOT_PERFORMED。
- 这是**实施方自测**（同机同人），**不能替代第三次独立复验**，不得视为通过。
- 改动**未提交未推送**：HEAD `3574824` == `origin/main`，工作区 89 条未提交/未跟踪。
  交付身份见 `evidence/source-hashes.txt`（工作区字节）。⚠️ 复验方**不要**用
  `git checkout -- <file>` / `git stash` 还原现场，会把交付物抹成基线且不可恢复。

---

## 7. 复算入口

```bash
cd /Users/qlyf/Developer/reminder

# 1) 六套测试（2128 项）
npm test

# 2) UI 两个对照（567 / 590）
node scripts/verification/ui-format-parity.js
node scripts/verification/ui-dom-parity.js

# 3) 覆盖矩阵 + 三组静态变异（本报告 §2 的原始输出）
node docs/reviews/verification-runs/20260921T0530-alias-fail-closed/evidence/coverage-and-mutations-probe.js

# 4) 真实浏览器六个故障场景（需要 Chrome，约 15 s）
BROWSER_CHECK_OUT=/tmp/attention-browser-recovery \
  /usr/bin/python3 scripts/verification/browser-recovery-check.py

# 5) 拔掉修复必须变红（改文件 → 跑测试 → 按字节还原 → 回绿确认）
bash docs/reviews/verification-runs/20260921T0530-alias-fail-closed/evidence/fix-removal-must-go-red.sh
```

## 8. 证据文件清单（`evidence/`）

| 文件 | 内容 |
| --- | --- |
| `npm-test.log` | 六套测试全量日志 + 退出码 0 |
| `ui-format-parity.log` / `ui-dom-parity.log` | 567 / 590 PASS |
| `browser-recovery-command.log` / `browser-recovery.json` / `browser-recovery-percase.log` / `chrome.log` | Chrome 六用例 + IDB 副作用计量 |
| `coverage-before-after.json` / `coverage-and-mutations-probe.log` | 修复前后覆盖对照 + 三组静态变异原始输出 |
| `static-mutations.json` | 三组变异的注入内容与完整返回 |
| `fix-removal-must-go-red.log` / `.sh` | N1/N2 变异变红 + 字节还原 + 回绿确认 |
| `mutation-N1-red.log` / `mutation-N2-red.log` | 两条变异各自的摘录 |
| `repo-state.txt` | HEAD / 分支 / 与 origin/main 关系 / 脏条目数 |
| `source-hashes.txt` | 交付身份（工作区字节 SHA-256） |
| `coverage-and-mutations-probe.js` | 上面第 3 条复算入口的脚本本体 |
