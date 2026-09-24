# P2-C-S 整库导入格式安全面加固（实施批次）

- 日期：2026-09-22
- 依据：独立诊断 `20260922T124205-independent-import-format-audit`（结论 FIX_REQUIRED，含 18 组现状反例、四项变异要求与独立验收矩阵）
- 性质：**实施方自验**。Node + 真实 Chrome 已跑；真实 Android 文件选择器、IDB 磁盘层零副作用、合法备份冷启动持久化留给独立复验。

## 判定

**自验 PASS（NOT_PERFORMED：真机三段）** —— 待独立复验裁决。

## 修改范围（合同遵守情况）

| 文件 | 变化 | sha256（前 16） |
|---|---|---|
| `app-core.js` | **零字节变化** ✅ | `c7e0e09fd4bdb423`（前后一致） |
| `lib/app-backup.js` | 重写导入路径 | `e59f32c476698492` |
| `test-unit.js` | 新增 P2-C-S 段 | `288e74441a77ca1f` |
| `sw.js` | 缓存 v15 → **v16** | `b9ff15b6ee8ce12d` |
| `scripts/verification/browser-import-format-check.py` | 新增 | `235104ee5c4bf0ba` |

改动前基线：`source-hashes-before.txt`；改动后：`source-hashes-after.txt`。

## 实施内容（lib/app-backup.js）

1. **唯一格式契约 `validateBackupPayload(payload, currentSchema)`**（纯函数，求值即可用）：
   - 顶层必须是普通对象（拒绝 `__proto__` 自有键 / 数组 / null / 空对象）；
   - `app` 严格 `=== "attention-inbox"`；
   - `schema` 整数 2–5；`<2` 报 `schema-too-old`，`>5` 报 `schema-too-new`，错型/非整数报 `schema-type`；
   - `exportedAt` 必须带时区的 ISO 8601（`Date.parse` 且 `/Z|[+-]\d\d:\d\d$/`）；
   - `items/notes/projects` 必须是数组（**合法空库可备份可恢复**；勘误：本 README 初版误写「非空数组」，实际源码允许空数组，独立复验 `20260922T134219` §6 已确认代码行为正确）；逐条完整校验（id 非空且**全局唯一**、title 字符串、status/review_status/delivery_mode/优先级枚举、repeat 形态、tags 字符串数组、事件台账键值形态、日期字段可解析等）——未知字段**点名具体路径**拒绝；
   - `settings` 必须是普通对象，键白名单逐个校验，未知键点名（如 `settings.injected`）；**`settings.ai.apiKey / baseUrl` 必须为空字符串**，非空即 `settings.ai.apiKey` 拒绝 —— 备份永远不能注入密钥/端点；
   - 返回 `{ok, sanitized}` 或 `{ok:false, code, path, message}`。
2. **顺序反转**：`importDataFile()` 改为 读文件 → 解析 → **完整验证 → 内存外准备 sanitized 副本** → 弹确认框 → 覆盖 → `await save()` 兑现 → render → 成功提示。任何验证失败：确认框 0、save/render/normalize 0、IDB put 0、原生排程 0，只弹一次点名路径的失败提示。G01（读取失败反馈）/G02（成功提示在提交兑现后）继承保留。
3. 失败提示按 code 分派：`schema-too-new` →「请先更新应用」；`app-mismatch` →「不是『安心收件箱』的备份」；其余 →「备份格式不正确（具体路径）」。

## 测试证据

### Node 单测（`npm test`，全绿，exit 0）

| 套件 | 改动前 | 改动后 |
|---|---|---|
| test-unit.js | 492 | **598**（+106，全为新段） |
| regressions | 324 | 324 |
| smoke | 384 | 384 |
| boot-combination | 257 | 257 |
| native | 730 | 730 |

新段覆盖：诊断 18 组现状反例逐一「零副作用拒绝」（确认框 0 / 提交 0 / 渲染 0 / 归一 0 / 未读 state / 恰一次 toast）；sanitized 副本落库断言（schema 2/3/4/5 正向兼容面、schema 4 显式 `migrateV4` 归一后落库）；失败提示按 code 分派直测；**报告 §6 四条变异全部变红** —— M-S1 移除 app 检查（wrong-app 重新被接受）/ M-S2 移除 schema 上界（future-schema 重新被接受）/ M-S3 移除未知 settings 键检查（injected 重新进入确认并落库）/ M-S4 验证挪到 confirm 之后（坏文件重新触发确认框）。每个变异由同一条正式测试经 `importDataFile` 生产路径判红；变异只用临时副本，工作区字节未变。

### 真实 Chrome（`scripts/verification/browser-import-format-check.py`，10/10 PASS，exit 0）

生产路径：`new File` + `DataTransfer` 塞 `#importFile` 派发真实 `change`；IDB 计量器在任何页面脚本之前安装，比的是 put 增量；确认框读 `#sheetConfirm.open`。

| 用例 | 确认框 | IDB put 增量 | 结果 |
|---|---|---|---|
| control-valid | 弹 | 0→1，items=['new-item'] | PASS |
| control-cancel | 弹，点取消 | 0 | PASS |
| legacy-schema2 | 弹 | 0→1 | PASS |
| wrong-app / future-schema / missing-notes / notes-object / duplicate-item-id / ai-secret-endpoint / unknown-settings-key | **不弹** | **0** | PASS ×7 |

原始观测：`browser/browser-import-format.json`（每例含 toast 文案、items/notes/settings 前后、meterBefore/AfterReject/meter、startupPanel=false）。

## NOT_PERFORMED（不得豁免，留给独立复验）

- 真实 Android 文件选择器路径（V18/V19/V20 口径延续）；
- IDB **磁盘层**（leveldb 文件）零副作用度量 —— 本轮只证了 JS API 层 put=0；
- 合法备份导入后冷启动持久化 + 权威态保护交互（P2-C-R2 共存）。

## 交接给独立复验的入口

- 实施方 run：本目录；Chrome 脚本可独立重跑：`IMPORT_CHECK_OUT=<dir> /usr/bin/python3 scripts/verification/browser-import-format-check.py`。
- 变异要求核对清单见诊断报告 README「四项变异要求」节；对应断言名以行首 `✗ ` 输出。
