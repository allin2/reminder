# 三个用户体验优先项 · 二次返工实现报告

时间：2026-09-20 00:55 CST。run-id：`20260920T003000-ux-rework2`。

起点是**第二次独立复验**把上一轮返工判为 **FAIL / FIX_REQUIRED**，列出 3 个遗漏分支
（[复验报告](user-experience-three-priorities-independent-recheck-20260920.md)）：
R-F06（旧轮回执仍污染新轮）、R-F03（AI 迟到结果覆盖新草稿）、R-F07（停铃读取失败被当成无铃），
并对 `sw.js` 预缓存缺口作出**应修**裁决。本报告只讲**这次改了什么、怎么证明的、还有什么没做**。

**结论先说：三处遗漏分支的产品代码都已改，SW 缺口按裁决修完；复验给出的 X1–X4 四个反例用
同一份探针（逐字节复制）重跑后全部转绿，并各自落成带对照组的回归；10 处修复都做了
「拔掉就变红」的反向自检；JS 1572/1572 通过。但本报告不宣布独立验收通过 —— 是否通过由验收方
复验决定，且本轮仍未执行真机链路（V18/V19/V20 保持 NOT_PERFORMED）。**

---

## 1. 身份与边界

- 仓库 `/Users/qlyf/Developer/reminder`，分支 `main`，HEAD `8d1c2617cff3aac5c4450a949c9044b79f63a673`，
  `HEAD == origin/main`。**本轮未提交、未推送、未改 HEAD**；工作区仍有 90 条未提交改动（含本轮）。
- 身份文件（源码/Java/候选 APK 哈希、相对**上一轮失败候选**的源码变化）：
  [identity.json](verification-runs/20260920T003000-ux-rework2/identity.json)。
- 两轮失败证据（`20260919T234129-ux-independent/`、`20260920-ux-independent-recheck/`）
  **原样保留**，上一轮候选目录 `20260919T235500-ux-rework/` 也**未被覆盖**。本轮只新增文件。

**相对上一轮失败候选，被改动的源码只有 3 个文件**（identity.json `changedVsFailedRound`，逐字节比对）：

| 文件 | 上一轮 sha256（前 8） | 本轮 sha256（前 8） |
|---|---|---|
| `app-core.js` | `e2fcad68` | `cf1fe51a` |
| `lib/delivery-evidence.js` | `33659312` | `e4662193` |
| `sw.js` | `9acd48f4` | `aa077b2e` |

**Java 一个都没动** —— identity.json 的 `changedJavaVsFailedRound` 为空、`javaChangedCount = 0`。
反向自检里**没有任何 Gradle 条目**是同一件事的另一面（`reverse-selfcheck.json` 把 `java_injections: 0`
显式登记进去，避免被读成「跳过了没做」）。

### 本轮没有做什么（明确边界）

- 未覆盖任何历史候选目录或历史证据目录。
- `releases/安心收件箱-debug.apk` 在归档时被覆写，**已按字节还原**到开工前的 `186c28b9…`（§6）。
- 未清空/迁移用户数据，未改设备设置，未重启设备，未在真机上制造响铃。
- 未改 `docs/baseline/`、未改既有失败报告、未改 `docs/decisions/` 下任何裁决。
- **未宣布独立验收通过。**

---

## 2. 逐条：根因 → 改法 → 变成哪条断言

### R-F06 [P1] 旧轮回执仍把新轮抬成「系统已接收」

**根因**：上一轮的判据是「这条键**登记过**」+「原定时刻落在当前范围内」。但真实的
「稍后提醒」+ 对账流程会**保留**旧轮的键当历史（含 `cancelled`、`delivered`），
而旧轮**追提醒**的原定时刻常常**晚于**新的触发起点 ⇒ 两条判据都成立，但它属于上一轮。
上一轮在保留历史条目时**丢掉了条目自己的轮次身份**，于是旧键看起来就是当前轮。
（复验 X1 实测：旧版本 1、新版本 2，旧键仍在台账且是 `cancelled`，结果 `applied=1`。）

**改法 —— 引入「轮次身份」`roundBase`**：

- `lib/delivery-evidence.js:82` `entryRoundBase(item, entry)`：有 `roundBase` 字段就用它；
  旧版写入的条目没有这个字段 ⇒ **按升级前的规则（范围内即算本轮）保守推定**，
  升级本身不该把用户已经看到过的「系统已接收」翻成未知。
- `app-core.js:4721` 排程登记时写入 `roundBase: base`；`:4731` **保留历史条目时连同它原来的
  `roundBase` 一起保留**（就是这里丢掉才漏的）。
- 三处过滤各自都要认轮：`mergeEvidence:217`（写入，判 `superseded-round`）、
  `evidenceStatusFor:275`（展示）、`itemScheduleEvidence:3468`（保存反馈）。

**为什么比「轮」而不是比「版本号」**：机械要求 `rev` 相同会把**合法证据**误拒 ——
改个标题也会推进 `rev`。所以判据是「这条键登记时事项的 `triggerAt` 是否等于现在的 `triggerAt`」，
而不是「版本号数字是否相等」。这一条复验明确要求过，并且有对照组守着。

**变成的断言**（`test-regressions.js` 两个 section + `test-unit.js`，共约 20 条）：
X1 形态用真实 `snoozeItem` + `applyReminderEvents` 构造（`applied=0`、`unknown=1`、
原因 `superseded-round`、展示停在「本次提醒结果尚未确认」）；
并覆盖复验点名的几种**不能误伤**的形态：同刻重排不换轮、重复回执幂等、乱序到达照常记账、
非排程字段编辑（rev 推进但轮次不变 ⇒ 回执仍有效）。

### R-F03 [P1] AI 迟到结果覆盖新草稿、备注串写

**根因**：上一轮的 `formDraftSignature` 保护**只覆盖了持久化回调**，而签名是在 AI 返回**之后**
才建立的 ⇒ AI 异步窗口不设防。于是回来时先无条件 `applyAiToForm`（清空用户第二份草稿），
再读**当前**表单去保存（第一条的备注取到了第二份的值）。

**改法 —— 提交时冻结，AI 只作用于冻结副本**：

- `app-core.js:40` 新增表单会话序号 `itemFormSession`，`:3698` `resetItemSheet()` 里自增
  ⇒ **换一张表单就是换一个会话**，之前提交的异步结果不再属于它。
- `:4092` 提交时冻结 `snapshotItemForm()` + 签名 + 会话号；`formUntouched()` 判定
  「还是同一张表单且一个字都没改过」。
- `:3120` `aiMergedDraft(base, r)`：把 AI 结果合并进**冻结草稿的副本**（逐字段对应
  `applyAiToForm` 的语义，但作用在快照上）。
- `:4294` AI 分支重写：`aiParseCapture().then(r => { const merged = aiMergedDraft(frozenDraft, r);
  if (formUntouched()) applyAiToForm(r, "AI 理解"); finishSave(..., { source: merged }); })`，
  **失败分支同样走冻结快照**（`source: frozenDraft`），不吞掉用户输入。
- `:4108` `finishSave` 的字段读取一律走 `opts.source`；没给 source 才读当前表单
  （那是同一次交互内低置信度面板的**显式手选**，不是异步窗口）。

**变成的断言**（5 组，含 4 个对照组）：慢响应不清空/不串写、正常路径照样回填并关表单、
AI 失败不吞稿且落库的是冻结那份、关闭重开后迟到结果不碰新表单（**内容相同也不行**）、
连续两次不同内容各落一条。

### R-F07 [P2] 停铃读取失败被当成「没有正在响」

**根因**：`activeAlarmDeliveries()` 抛错后，read 异常被吞 ⇒ `seen` 仍是 0 ⇒
落进「没有正在响」分支并**无条件写 `stoppedAt`**。读取失败只能说明**未知**；
取消未来的 PendingIntent 不能证明当前铃声已停。

**改法 —— 三态分离，`stoppedAt` 只作成功证据**（`app-core.js:6384`–`6449`）：

- 区分 `readOk`（读成功）／`seen`（本次运行的活跃条数）／`stopped`（真停住的条数）／
  `stopFailed`／`cancel.ok`（未来排程是否撤掉）。
- `const confirmed = stopped > 0 || (readOk && seen === 0);` —— **只有确认过才写 `stoppedAt`**。
- 提示按结论分档：真停住 →「已停止本次测试的铃声」；`!readOk` →「读不到铃声状态 · 无法确认是否已停」
  （带重试）；确认无活跃 →「没有正在响的测试铃声」；有活跃但没停成功 →「没能停住这次铃声 · 
  它可能还在响」。**绝不用「没找到正在响的」冒充「读到了、是空的」。**
- `labCancelAlarms()` 由 void 改成返回 `{ ok, error }`，取消失败要能传上来。

**变成的断言**（4 组对照）：读取失败不报停住条数 / 不说「没有正在响」/ 不写 `stoppedAt` / 给重试；
对照组：确认无铃 → 如实说无铃且可记 `stoppedAt`；真停住 → 报停住并记 `stoppedAt`；
停不住 → 不宣称已停、不谎称无铃、不记 `stoppedAt`。

### SW（P2，按裁决「应修」）

两处缺口，各自独立：

1. **预缓存缺项**：`sw.js` 的 `ASSETS` 补上 `./lib/native-reminders.js`，缓存版本 `v4 → v5`。
   它在 `index.html` 里被加载，却从来不在预缓存清单里（HEAD 就漏，不是返工引入）。
2. **回落规则**：新增 `offlineFallback(req)`，**只有 `req.mode === "navigate"` 才回落 `index.html`**，
   其余返回 `504`。旧实现是 `hit || caches.match("./index.html")` ⇒ 缓存未命中的**脚本**
   会拿到一段 HTML 当 JS 执行，原生桥静默消失（比网络错误更坏）。

**按复验的裁决，这里只按 Web/PWA 缓存缺陷处理**：Android 原生容器不走 SW
（`registerPwa()` 在 `isNativeAndroid()` 时直接返回），**不能据此说「新装 APK 离线必然缺桥」**。

**变成的断言**：期望集合**从 `index.html` 推出来**（不是抄一份清单 —— 抄一份只是把同一个
遗漏复制进测试里，这个缺口当初正是这么活下来的）；真跑生产 `install`/`fetch` 处理函数，
断言新装预缓存覆盖 index.html 加载的**全部**脚本、缓存未命中的脚本**不回落** index.html；
对照组：离线导航仍然回落 index.html（否则离线打开白屏）。

---

## 3. 复验的四个反例：同一份探针重跑

探针**逐字节复制**自复验证据目录（`shasum` 已核对一致），不是本轮重写的：

| 反例 | 结果 | 观察 |
|---|---|---|
| X1 旧轮回执污染新轮 | **pass** | `merged.applied=0`、`unknown=1`、`reasons=["superseded-round"]`；状态 `unknown / 本次提醒结果尚未确认`（不再显示「系统已接收这次提醒」） |
| X2 AI 迟到覆盖新草稿 | **pass** | 输入保留为「第二条尚未保存的草稿」；落库 1 条 `{title:"取快递", note:""}`（备注不再串） |
| X3 无时间保存的撤销入口 | **pass**（上轮已 pass） | 文案「已收下 · 待整理」+「撤销」可见 |
| X4 停铃读取失败 | **pass** | `stopped=0`；文案「读不到铃声状态 · 无法确认是否已停」 |

SW 探针：`precacheHasNativeBridge: true`、`offlineScriptResponseIsIndexHtml: false`（上轮分别是 false / true）。
更早那批 `probes.cjs` 反例也照常通过。原始输出见
[extended-results.json](verification-runs/20260920T003000-ux-rework2/extended-results.json) 与
[sw-result.json](verification-runs/20260920T003000-ux-rework2/sw-result.json)。

---

## 4. 反向自检：10 处注入，10/10 变红

脚本：[reverse-selfcheck.py](verification-runs/20260920T003000-ux-rework2/reverse-selfcheck.py)，
结果 [reverse-selfcheck.json](verification-runs/20260920T003000-ux-rework2/reverse-selfcheck.json)。

| 编号 | 注入的缺陷 | 必须变红的断言 | 结果 |
|---|---|---|---|
| `R-F06-write` | `mergeEvidence` 的 `superseded-round` 判据恒不成立 | R-F06 旧轮回执不写入台账 | `RED_AS_EXPECTED` |
| `R-F06-identity` | `entryRoundBase` 不认条目自带的 `roundBase` | R-F06 条目自带轮次身份时以它为准 | `RED_AS_EXPECTED` |
| `R-F06-status` | `evidenceStatusFor` 的 `inRound` 去掉轮次判据 | R-F06b 但它不算当前轮的证据 | `RED_AS_EXPECTED` |
| `R-F06-schedule` | `itemScheduleEvidence` 的轮次判据恒真 | R-F06b 保存反馈用的「本条排程证据」也不认旧轮 | `RED_AS_EXPECTED` |
| `R-F03-late` | `applyAiToForm` 去掉 `formUntouched()` 闸门 | R-F03 迟到结果不清空新草稿 | `RED_AS_EXPECTED` |
| `R-F03-freeze` | `finishSave` 恒读当前表单（忽略冻结快照） | R-F03 第一条**没有**串进第二条的备注 | `RED_AS_EXPECTED` |
| `R-F07-stoppedAt` | `if (run && confirmed)` 退回 `if (run)` | R-F07 未确认就不把 stoppedAt 当成功证据 | `RED_AS_EXPECTED` |
| `R-F07-toast` | 读失败分支 `else if (!readOk)` 不可达 | R-F07 读取失败不说「没有正在响」 | `RED_AS_EXPECTED` |
| `SW-assets` | 把 `./lib/native-reminders.js` 从 `ASSETS` 移除 | SW 新装预缓存覆盖 index.html 加载的**全部**脚本 | `RED_AS_EXPECTED` |
| `SW-fallback` | 回落退回 `hit \|\| caches.match("./index.html")` | SW 缓存未命中的脚本**不回落** index.html | `RED_AS_EXPECTED` |
| — | 全部还原 | — | `RESTORE: BYTE_IDENTICAL` |

「变红」的判据仍然是**失败清单里出现目标断言**（JS 侧 `✗ ` 前缀），不是「输出里出现过这个字符串」
—— 后者会命中同名的通过行，第一版就是这么误判的。

**R-F06 与 R-F03 各注入两处**，是刻意的：这两条缺陷都是**两个环节同时失效**才成立
（R-F06：写入 + 展示 + 反馈三处过滤；R-F03：UI 回填 + 落库来源），只注入一处会得到一个
「仍然变红但只红了一半」的错觉。

---

## 5. 测试水位

`npm test` 全量四套件：[npm-test.log](verification-runs/20260920T003000-ux-rework2/npm-test.log)。

| 套件 | 通过 | 增量 |
|---|---|---|
| `test-unit.js` | **328** | +7（R-F06 轮次身份单测） |
| `test-native-reminders.js` | **321** | — |
| `test-smoke.js` | **226** | — |
| `test-regressions.js` | **697** | +48（返工2 五个 section） |
| 合计 | **1572 / 1572** | 上一轮 1517 |

Android 原生单测（`--rerun-tasks`，非缓存）：**22 通过、0 失败**（本轮未改 Java，见 §1）。

---

## 6. 构建产物核查

**本轮没能走 `bash scripts/android-build.sh both`**，原因如实记录：`npx cap sync android`
撞上沙箱的批量删除护栏（阈值 50、**按回合计数**、TTL 7 天），本回合配额耗尽 ⇒ 必然失败；
更糟的是它会**先删掉** `android/capacitor-cordova-android-plugins/` 再重建，删成功一半就崩，
留下一个残缺目录让 Gradle 直接报
`Could not read script '.../cordova.variables.gradle' as it does not exist`。

替代路径（脚本与说明：[archive-and-verify.sh](verification-runs/20260920T003000-ux-rework2/archive-and-verify.sh)、
[restore-cordova-plugins-project.js](verification-runs/20260920T003000-ux-rework2/restore-cordova-plugins-project.js)）：

1. `npm run sync:www` 生成 `www/` → `cp -R www/. android/app/src/main/assets/public/`
   （**只覆盖不删除**；文件集与上轮完全相同，`diff -rq` 只多出 cordova 那两个文件）；
2. 被删掉的那个生成目录按 `@capacitor/cli` 的 `updateAndroid()` 逐条复刻
   （模板 tarball + `handleCordovaPluginsGradle` 的两段替换 + `cordova.variables.gradle`），**只写文件**；
3. **打包原封不动用 `./gradlew assembleDebug assembleRelease`**，签名与产物路径照抄原脚本。

**等价性的两条核对**（判据都不是「构建成功」）：

- **包内 Web 资源逐字节**：[apk-web-assets.txt](verification-runs/20260920T003000-ux-rework2/apk-web-assets.txt)
  —— 13 个资源在**两个包里**全部 `IDENTICAL`，`RESULT: ALL_WEB_ASSETS_BYTE_IDENTICAL`。
- **与上轮候选逐条目比对**：[compare-candidate-entries.py](verification-runs/20260920T003000-ux-rework2/compare-candidate-entries.py)
  —— 508 个 zip 条目，只有 6 个不同，且**恰好**是 3 个签名条目（`META-INF/*`）+ 3 个本轮改动的
  Web 文件；**DEX / res / manifest 全部一致**。
  这同时印证了两件事：① 本轮未改 Java；② 替代构建路径与标准路径产物等价。

| 候选 | 路径 | 大小 | sha256 |
|---|---|---|---|
| debug | `releases/candidates/20260920T003000-ux-rework2/attention-inbox-debug-ux-rework2.apk` | 4,242,746 | `06a404499237ea7656c04c8856f5845f9ddbafc6307a96f5a0d0525a01848200` |
| release | `.../attention-inbox-release-ux-rework2.apk` | 3,251,418 | `679768958743aba528f32d58d9dab4171f21023c0ec91c63b2e83003635b4658` |

校验和：[SHA256SUMS.txt](../../releases/candidates/20260920T003000-ux-rework2/SHA256SUMS.txt)。

**`releases/安心收件箱-debug.apk` 在归档时被覆写，已按字节还原**到开工前的 `186c28b9…`
（它与 HEAD 的 `cb6a9217…` 本来就不同，那是开工前就存在的差异，不是本轮造成的）。
本轮没有在 `releases/` 下新产生 release 产物。

---

## 7. 未完成项与残留风险

1. **真机链路全部 NOT_PERFORMED**：候选未装到设备、未回读设备侧 sha、未做真实投递观察窗。
   复验要求「先让反例变成有断言的回归并通过，**再**复验真实 Android 链路」—— 前半已完成，后半**未做**。
2. **V18 / V19 / V20 依然 NOT_PERFORMED**（复验已裁决：不得豁免成 PASS）。
   **冷进程修复格不得记 PASS，也不算已修。**
3. **OEM 冷进程投递黑洞未解决**（D70 提案待裁决 Q1–Q4，代码未动）。
4. **导出仍没有落地出口**（`lib/export-format.js` **尚未接线**，待裁决 E1–E4）。
5. **UX-T02 规格缺口未解**：60 秒测试仍没有独立事项通道。
6. **普通通知后台投递的持久证据仍未覆盖** —— 与 R-F06 相邻，但本轮只覆盖了 JS 侧的轮次判定，
   真机**投递路径上的证据写入**本轮未实测。
7. `test-native-reminders.js` 的 Java 源码正则未收口；`projects` 与 D-09 冲突；
   `USE_FULL_SCREEN_INTENT` 文案未审 —— 均原样遗留。

---

## 8. 复验中两项裁决的落实

- **「SW 缺项应修」** → 已修（§2 第四小节），并落成带对照组的回归 + 注入自检。
  同时**按裁决保持范围**：只按 Web/PWA 缓存缺陷处理，不引申成「Android APK 离线缺桥」。
- **「V18–V20 继续 NOT_PERFORMED，不能豁免成 PASS」** → 已遵守，见 §7 第 2 条；
  D70 冷进程与导出落地出口**保持原范围**，本轮没有借返工顺手实现。

---

## 9. 交付物与回交信息

- 报告：本文件。
- 证据目录：[`docs/reviews/verification-runs/20260920T003000-ux-rework2/`](verification-runs/20260920T003000-ux-rework2/)
  （含 README 说明每个文件怎么复现）。
- 候选：[`releases/candidates/20260920T003000-ux-rework2/`](../../releases/candidates/20260920T003000-ux-rework2/)
  （debug/release + `SHA256SUMS.txt`）。
- 分支/提交：**`main`，HEAD `8d1c2617…`，`HEAD == origin/main`，未提交未推送**；工作区 90 条未提交改动。
- 动作：**未提交、未推送、未改 HEAD、未装设备、未清用户数据、未改设备设置。**
- 需要决策或注意的：
  - 构建走的是**替代路径**（§6），已用「包内资源逐字节」+「与上轮候选逐条目等价」两条核对证明等价；
    后续若要在沙箱内复现标准 `android-build.sh`，需要先解决
    `npx cap sync` 撞批量删除护栏的问题（护栏按回合计数，一轮里跑两次必然第二次失败）。
  - `releases/安心收件箱-debug.apk` 已**按字节还原**到开工前的 `186c28b9…`。
  - §7 各项均**原样遗留**，未擅自处理。
- **是否通过由独立验收复验决定；本报告不自行宣布通过。**
