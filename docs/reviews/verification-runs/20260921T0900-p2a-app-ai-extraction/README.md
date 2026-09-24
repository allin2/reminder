# P2-A：AI 能力整体迁出 app-core → lib/app-ai.js（实施方自测）

- run：`20260921T0900-p2a-app-ai-extraction`
- 日期：2026-09-21
- 基点：HEAD `3574824`（== origin/main），**工作区 95 条脏条目即交付身份**（未提交未推送）
- 约束遵守：未执行 `checkout` / `restore` / `stash`；未覆盖任何旧 run 目录或 APK；未进入 P3。

## 1. 范围与做法

只迁出 **app-ai** 一支。唯一实现体在新模块 `lib/app-ai.js`（UMD，导出
`createAppAi(deps)` 工厂 + 纯函数 `normalizeAiResult` / `extractJsonObject` / `localIsoWithOffset`），
`app-core.js` 中**实现体整体删除、不留转发壳、不留双实现**——`app-core.js` 内
`aiConfig/aiReady/aiChat/aiParseCapture/aiPolishCapture/aiTestConnection/applyAiToForm/
aiMergedDraft/runAiOnCapture/openAiSheet/saveAiSettings/renderAiSub/aiNowIso/aiSystemPrompt/aiBusy`
全部归零（可 grep 复算）。调用点一律写 `ai.xxx()`，`ai` 由 `bindRuntime()` 装配。

**刻意留在入口（非 AI 逻辑，搬走会让所有权错位）**：
- `submitToken` / `beginSaveSubmit()` —— 提交身份属于事务层（AI 只是占用同一身份）；
- `itemFormSession` / `formUntouched()` —— 表单会话身份属于捕获表单，迟到结果能否回填由它裁决（R-F03）；
- `#btnAiTest` 的「临时换表单配置再测」 —— 设置页交互。

**装配契约**（与 F01–F03 修复同源）：
- `REQUIRED_RUNTIME_EXPORTS` 新增 4 条声明（`AppAi` / `AppAi.createAppAi` /
  `AppAi.normalizeAiResult` / `AppAi.extractJsonObject`），别名表 `[AppAi, AppAi]`；
- `APP_AI_INSTANCE_CONTRACT`：15 个实例 API 逐项核对（config/ready/nowIso/systemPrompt/chat/
  parseCapture/polishCapture/testConnection/applyToForm/mergedDraft/isBusy/runOnCapture/
  openAiSheet/saveAiSettings/renderAiSub），空壳/缺成员/工厂抛错都在开门前点名；
- `bindRuntime()`「检查+绑定」同源，失败时零实例、零副作用、可见失败面板。

## 2. 行为所有权变化

| 行为 | 迁出前 | 迁出后 |
|---|---|---|
| AI 请求（chat/fetch、busy 闸门、按钮还原） | app-core.js | `lib/app-ai.js`（唯一实现） |
| 结果归一（时间/优先级/周期收窄、越权拦截） | app-core.js | `lib/app-ai.js` 纯函数 |
| 设置页读写（baseUrl/key/model/autoOnSave） | app-core.js | `lib/app-ai.js` |
| 表单合并（R-F03 冻结草稿快照合并） | app-core.js | `lib/app-ai.js` 提供纯 `mergedDraft`；**会话身份裁决仍在入口** |
| 提交身份 / 表单会话 / 测试连接的交互壳 | app-core.js | 仍在 app-core.js（所有权属事务层/表单/设置页） |
| 缺件告警 | 无（静默缺件） | 装配闸门点名 `AppAi*`，可见失败面板、零副作用 |

请求 token、迟到响应丢弃、设置与表单合并行为逐项保持（unit 新增 54 条断言覆盖，
含「在途第二次调用被挡」「失败仍还原按钮」「本地解析前置」「mergedDraft 不动冻结草稿」）。

## 3. 同步的加载链（四处 + 派生）

- `index.html`：`<script src="lib/app-ai.js">`（app-ui 之后、parse-cn 之前）
- `sw.js`：`ASSETS` 增加条目，缓存版本 v10→**v11**
- `test-smoke.js`：加载列表
- `test-regressions.js`：`LIB_SOURCES`
- `test-boot-combination.js`：`EXPECTED_INDEX_SCRIPTS`
- `scripts/verification/production-scripts.js`：`NAMESPACE_PATHS` + `aiInstanceCoverage()`
  （与 `uiInstanceCoverage` 同构的双向闭合：源码里用的实例 API ↔ 契约声明）

## 4. 反例（全部「拔掉修复必须变红」）

- `test-boot-combination.js` ⑪：抽掉 `lib/app-ai.js` ⇒ ready 失败、**只**点名 AppAi 系
  （无连带误报）、零读库零定时器、可见失败面板写明 AppAi；
- B3 ⑤·2：`AppAi.createAppAi = () => ({})` 空壳 ⇒ 闸门逐项点名全部 15 个实例 API，绑定不被覆盖；
- B3 ⑤·3：工厂抛错 ⇒ 闸门报 `AppAi.createAppAi() threw:…`；
- B4 **N6**（静态+运行时）：清空 `APP_AI_INSTANCE_CONTRACT.instance` ⇒ 双向闭合报
  missingInContract ≥10；同一空壳重新被放行（对照面：未变异源码逐项点名）；
- B4 **N7**：删掉 AppAi 系 4 条声明 ⇒ 静态矩阵立刻报 `undeclared-dependency:AppAi*`
  （对照面：未变异 problems 为空）；收口断言证明 N6/N7 只差那几行、工作区未被改写；
- Chrome（真浏览器）：`shell-ai`（工厂空壳）与 `missing-app-ai`（整支 404）两个新用例，
  均判 ready=false、可见面板、opens=0/puts=0、失败清单全为 AppAi 系。

## 5. 回归结果（八套全绿，exit 0，原始日志见 logs/）

| 套件 | 本轮 | P2-A 前 | Δ |
|---|---|---|---|
| test-unit | **465** 通过 | 411 | +54（P2-A 行为断言） |
| test-boot-combination | **308** 通过 | 287 | +21（⑪/⑤·2/⑤·3/N6/N7） |
| test-smoke | 256 通过 | 256 | 持平 |
| test-regressions | 730 通过 | 730 | 持平 |
| test-native-reminders | 321 通过 | 321 | 持平 |
| parse-single-source | 160 通过 | 160 | 持平（单一来源闭合） |
| ui-format-parity | 567 一致 | 567 | 持平 |
| ui-dom-parity | 590 一致（16 场景） | 590 | 持平 |

第五次独立复验的 2165/567/590 基线全部保留（各项增量只增不减）。
Chrome 真浏览器 **10 用例 0 项断言不满足**（原 8 例 + 新 2 例），证据见 browser/。

## 6. 交付身份

- `source-hashes.txt`：15 个交付文件的 SHA-256（**工作区字节即交付身份**）
- `git-head.txt`：`3574824…`；`dirty-count.txt`：95；`dirty-files.txt`：全部脏条目清单
- 本轮未提交、未推送；未触碰任何旧 run 目录、旧 APK、旧验收证据。

## 7. NOT_PERFORMED（不得豁免成 PASS）

见 `not-performed.md`。要点：自测 ≠ 独立验收；P2 剩余（备份/诊断/引导/内容视图/表单 +
逐功能拆 `bind()`）、P3、P4、离线升级实测、打包逐字节比对、APK、实机验收全部未做；
AI 真实网络请求的端到端行为未在真机验证。
