# 独立验收提示词：app-core 模块化（P0 / P1 / P2-pilot / P2-b）

> 用途：本文件是**可直接复制给独立验收方**的提示词原文（下方「提示词正文」起）。
> 落盘时间：2026-09-21。待验收对象：工作区**未提交**改动，基线 HEAD `3574824`。

---

## 提示词正文（复制以下全部内容）

你现在是**独立验收方**，不是实施方。请对一个 Android/PWA 混合应用（「安心收件箱」，
仓库 `/Users/qlyf/Developer/reminder`）的 `app-core.js` 模块化改造做**独立复验**。

### 0. 你的立场（不可协商）

1. 实施方交付的报告是**待验证的主张**，不是证据。报告里每一个「已完成 / 已验证 / 全部通过」，
   你都必须**自己复跑并出示原始输出**。复现不出来的，判 `NOT_PERFORMED` ——
   **不得「合理推断」为 PASS，也不得因为「看起来没问题」而豁免**。
2. 不接受叙述性结论。判据只能是**可复算的计数、字节、退出码、哈希**。
   凡结论是「已移除 / 已补齐 / 已全部覆盖」的，请用计数或字节证据回答。
3. 你**只做验证**：不改源码、不改断言、不调整测试、不重建产物、不提交、不推送。
   发现缺陷 ⇒ 保留现场 + 记录最小复现 + 上报，等独立裁决，**不要就地修复**。
4. **红线（务必先读）**：当前工作区的全部改动 **故意未提交**，它就是待验收对象。
   **绝对禁止**用 `git checkout --` / `git restore` / `git stash` / `git reset --hard` 去「还原现场」——
   那会把交付物直接抹成基线 `3574824`，且无法恢复。
   需要对照或做反例时，先 `cp 目标文件 /tmp/...bak`，改完**从你的备份拷回**。
5. 反向对照的「变红」判据不能只看子串：必须是**行首 `✗ ` + 断言名**（或退出码非 0）。
   只看到红字就下结论、或看到「FAIL」出现在测试名里就当成失败，都算判定无效。

### 1. 先固定身份（在你自己的记录里写明）

```bash
cd /Users/qlyf/Developer/reminder
rm -f .git/index.lock            # 沙箱下 git 写操作会留锁，读操作不受影响
git rev-parse HEAD               # 期望 3574824357dc7beb04cbd3e32aa413cd508e8484
git status --porcelain | wc -l   # 应为一组未提交改动（含 ?? 未跟踪证据目录）
git diff --stat HEAD -- app-core.js index.html sw.js lib/ package.json
wc -l app-core.js lib/*.js
shasum -a 256 app-core.js lib/ui-format.js lib/app-ui.js lib/date-utils.js | tee /tmp/verify-hashes.txt
```

把 HEAD、`app-core.js` 行数/字节、四个新模块的 sha256 抄进你的报告首段。
**若 HEAD 不是 `3574824`，立即停止并上报** —— 说明有人提交了，对照基准已失效。

### 2. 亲跑复算命令（全部要贴原始输出）

```bash
cd /Users/qlyf/Developer/reminder
npm test                                                     # 期望六套合计 2063，失败 0，退出码 0
node scripts/verification/ui-dom-parity.js                  # 期望 590 项逐步逐字段一致 + 3 条自检为 true
node scripts/verification/ui-format-parity.js                # 期望 567 项逐项一致
node scripts/verification/parse-single-source.js             # 期望 137 项
node -e "const p=require('./scripts/verification/production-scripts.js');\
console.log('undeclared:',JSON.stringify(p.runtimeDependencyCoverage('.').undeclared));\
console.log('precache:',JSON.stringify(p.precacheProblems()));\
console.log('packaging:',JSON.stringify(p.packagingProblems()));"
```

**逐套核对拆解水位，不要只看总数**：`unit 411` / `native 321` / `boot-combination 208` /
`smoke 256` / `regressions 730` / `parse-single-source 137`。
任何一套的数字与上表不符 ⇒ 记录实际值，不要「总数对得上就算过」。

环境提示：本机托管 Node 在 `/Users/qlyf/.workbuddy/binaries/node/versions/22.22.2-3/bin/node`；
沙箱里 `grep` 会**静默失效**（返回空却不报错），内容检索请用编辑器/自带搜索工具；
BSD `grep` 不支持 `\|` 交替，多模式必须 `grep -E`。

### 3. 亲造反例：**拔掉修复必须变红**（本步不可省，这是验收的核心）

报告声称的每一处「搬移没改行为」，你都要**自己拔一次钉子**看它是否真的报警。
每个反例做完 **必须从备份还原并复跑一次确认回绿**（只变红不回绿 = 你把环境搞坏了，不是发现了缺陷）。

**A. 算法体必须只剩一份（单一来源）**
把任一条已被搬走的算法体塞回 `app-core.js`，例如在文件任意函数体内加入
`$("#backdrop").classList.add("show");`（原 `closeSheet` 的算法体），
跑 `node scripts/verification/parse-single-source.js` ⇒ **必须变红并点名该标记**。
把 `AppUi.createUi({ isFeedbackSuppressed: () => suppressUserFeedback })`
改成按值传（`isFeedbackSuppressed: suppressUserFeedback`）⇒ **必须变红**（活绑定判据）。
把 `lib/app-ui.js` 里 `toast` 的默认时长 `2400` 改成 `2500` ⇒
`node scripts/verification/ui-dom-parity.js` **必须报出差异**（该脚本内置的反向对照应当为 true，
但你要自己改真源码再验一次，别只信它自带的那条）。

**B. 运行时依赖闸门必须真的有牙齿**
先从 `cp app-core.js /tmp/app-core.bak` 备份，然后二选一：
① 从 `app-core.js` 的 `REQUIRED_RUNTIME_EXPORTS` 里删掉 `AppUi.createUi` 一条；
② 从 `lib/app-ui.js` 的导出里临时去掉一个被引用的符号。
跑 `node test-boot-combination.js` ⇒ **必须失败且文案里点名缺失的符号**，
并确认 `ready` 返回假、不发生读写库、不启动业务定时器、**仍然渲染出可见的失败面板**。
从 `/tmp/app-core.bak` 拷回后再跑一次 ⇒ 必须回绿。

**C. 加载链六处同步：漏一处必须能被抓到**
分别做（每次只改一处、验证后还原）：
- 删掉 `index.html` 里 `<script src="lib/app-ui.js">` ⇒ boot-combination 的脚本清单契约应报错；
- 删掉 `sw.js` 的 `ASSETS` 中 `./lib/app-ui.js` ⇒ `precacheProblems()` 必须非空；
- 删掉 `test-smoke.js` 加载清单里的 `lib/app-ui.js` ⇒ smoke 必须变红；
- 删掉 `test-regressions.js` 的 `LIB_SOURCES` 中 `lib/app-ui.js` ⇒ regressions 必须变红。
**若某处删掉后测试照样全绿，说明该契约是空的 —— 这是必须上报的缺陷。**

**D. 对照组是否真的走过了被怀疑的调用链**
报告称 `ui-dom-parity.js` 覆盖了 16 场景 / 590 字段。请抽查其**反向能力**：
把 `lib/app-ui.js` 的 `closeSheet` 里 backdrop 口径从「还有没有开着的层」
改成「关一次就撤」（`backdrop.classList.remove("show")`）⇒ 必须变红。
若不变红，说明该场景恒真、证明不了任何事。

### 4. 行为所有权核对（不靠行数，靠「谁持有行为」）

报告明确说 **`app-core.js` 行数不是进展指标**（8,558 → 8,319，仅 −2.8%，
被删的算法体位置换成了说明注释）。请照此核对：

对下表每个符号，在 **HEAD 侧**（`git show HEAD:app-core.js`）与 **工作区侧**分别定位，
确认三件事：① 新位置存在且是**唯一实现**；② 老位置只剩别名绑定或说明注释；
③ **两侧不同时存在实现体**。

| 符号 | 报告声称的新家 | 对照的旧家 |
| --- | --- | --- |
| `$` / `$$` / `openSheet` / `closeSheet` / `closeAllSheets` | `lib/app-ui.js` | `app-core.js` |
| `confirmDialog` / `toast` / `hideToast` / `toastTimer` | `lib/app-ui.js` | `app-core.js` |
| `safeExternalHref` | `lib/app-ui.js`（模块级纯函数） | `app-core.js` |
| `dayLabel` / `toLocalInput` / `parseLocalInput` | `lib/ui-format.js` | `app-core.js` |
| 中文日期解析 / 重复规则 / 免打扰 / 截止时间 | `lib/parse-cn.js`、`lib/repeat.js`、`lib/date-utils.js` | `app-core.js` |

同时确认计划允许的**边界调整**是真实的：`ui-format.js`（纯函数，可注入 `now`）与
`app-ui.js`（碰 DOM / `setTimeout` / `window`）的分界是按「是否碰宿主」划的，
两个文件头部注释里互相写明了归属。如果你发现某符号被复制成两份实现，
**这本身就是 FAIL**，请直接给出两处行号。

### 5. 你必须独立确认「未做的事」也没被偷偷宣称完成

报告自述**未做**以下各项。请核对报告、提交状态、证据目录，确认它们**没有被写成 PASS**：

- 真机构建与实机验证（属 P4）——本轮**连构建都没跑**；
- 离线升级实测（属 P4）；
- P2 剩余全部：AI / 备份 / 诊断 / 引导 / 内容视图 / 表单 / `bind()` 逐功能拆分；
- `downloadFile` 仍留在 `app-core`（按计划属 `lib/app-backup.js`）；
- P3（持久化、事务、事项、原生协调）、P4（生产组合、逐字节比对）**未开始**；
- 实施方自测**不等于**独立验收 —— 你这次跑完才算。

若上述任一项在报告或证据里被表述为已完成，请单独列为缺陷。

### 6. 输出格式（按此结构提交你的验收报告）

每条发现一个编号，形如：

```
F01 | 主张：<实施方原话/你正在验的点>
     | 我跑的命令：<命令原文>
     | 原始输出：<关键行，含退出码/计数>
     | 判定：PASS | FAIL | NOT_PERFORMED
     | 证据落盘：<文件路径>
```

最后给**整体裁决**（`PASS` / `FAIL` / `PASS_WITH_GAPS`）+ 一句话理由 +
`NOT_PERFORMED` 清单（逐项说明为什么没验）+ 你未能复现或存在矛盾的条目。

判定纪律：**任何一条你没亲手跑过的，只能写 `NOT_PERFORMED`。**
不允许用「与报告描述一致」代替复跑，也不允许把 `NOT_PERFORMED` 汇总成 `PASS`。

---

## 相关路径（给验收方定位用）

- 计划：`docs/handoff/2026-09-21-app-core-modularization-plan.md`
- 证据根：`docs/reviews/verification-runs/20260921T0230-app-core-modularization/`
  - `00-baseline/`（基线水位 + 搬移清单 + 状态清单 + 哈希）
  - `01-p1-single-source/`（P1 报告 + 依赖矩阵 + 日志）
  - `02-p2-ui-format-pilot/`（P2 首批报告）
  - `03-p2b-app-ui/`（P2-b 报告 + `scale.txt` 规模数据）
- 关键源码：`app-core.js`、`lib/{app-ui,ui-format,date-utils,parse-cn,repeat,native-reminders}.js`、
  `index.html`、`sw.js`、`scripts/verification/production-scripts.js`
- 一次性对照脚本（**不入** `npm test`）：`ui-dom-parity.js`、`ui-format-parity.js`
