# P2-C-S B1 修复：真实历史时间数据（ISO createdAt）的导出→导入回环

- 日期：2026-09-22
- 依据：独立复验 `20260922T134219-independent-p2cs-recheck`（结论 FAIL / FIX_REQUIRED，阻断项 B1）
- 性质：**实施方自验**。Node + 真实 Chrome 已跑；Android 实机三段（文件选择器 / 磁盘层零副作用 / 导入后冷启动）仍 NOT_PERFORMED，待独立复验按其 README §8 顺序恢复。

## 判定

**自验 PASS（真机三段 NOT_PERFORMED）** —— B1 已修，可进入 Android 实机验收。

## 修复内容（lib/app-backup.js）

1. **`checkTimeField`** 新增合法形态：非负 epoch 毫秒数字、null，**或** `parseIsoTimeField()` 认可的「严格带时区（`Z` / `±HH:MM`）、`Date.parse` 有效、解析非负」的 ISO 8601 字符串（与 `exportedAt` 同一判据）。其余（无时区串、文字串、NaN/Infinity、负数、1970 前负毫秒 ISO）一律 `field-type` 拒绝。**未放宽成「任意字符串时间都接受」**（复验 §5 红线）。
2. **sanitized 一次性迁移**：`sanitizeTimeFields()` 把合规 ISO 字符串统一转换为 epoch 毫秒（作用于 `pickFields` 新副本，输入文件对象不动；数字与 null 原样保留）。字符串绝不写回权威状态 —— 下一轮导出即毫秒，迁移收敛。
3. **`quietStart`/`quietEnd` 收紧为合法 HH:MM**（复验 §6 两个选项中取「收紧」；真实设备 payload 为 `23:00`/`07:30`，不受影响）。
4. `sw.js` 缓存 **v16 → v17**。

## 修改范围与哈希

| 文件 | 前（e59f32c4 / 288e7444 / b9ff15b6 / 235104ee） | 后 |
|---|---|---|
| `lib/app-backup.js` | `e59f32c476698492` | `6871da9c87c906b9` |
| `test-unit.js` | `288e74441a77ca1f` | `989d841c0c40b767` |
| `sw.js` | `b9ff15b6ee8ce12d` | `a6728dfba3acb8d5` |
| `scripts/verification/browser-import-format-check.py` | `235104ee5c4bf0ba` | `f5d638244072233e` |
| `app-core.js` | `c7e0e09fd4bdb423` | **零字节变化** ✅ |

## 测试证据

### Node（`npm test` exit 0，0 失败）

607（unit，+9）+ 324（native）+ 384（boot）+ 257（smoke）+ 730（regressions）+ 160（parse 单一来源 PASS）= **2462 通过**（原基线 2453 + B1 新增 9 条）。

新增 B1 段（夹具 = 复验归档的**真实设备 payload**，非构造数据）：

- ① 真实设备 payload 直接过验证器（修复前在此 `field-type @ items[0].createdAt` FAIL）；
- ② sanitized 两处 ISO → `1789948800000`（= 2026-09-21T08:00+08:00），数字 `1790009208456` 原样，输入对象不被改写；
- ③④ 同一 payload 经 `importDataFile` 生产路径导入成功，落库权威状态的时间全部为毫秒数字；
- ⑤⑥⑦ 第二层回环：当前 `buildLegacyBackupPayload()` 对**含 ISO createdAt/updatedAt/snoozedAt 的历史状态**导出 → 当前验证器接受 → sanitized 全部收敛为毫秒 → 完整导入路径成功（复验 §5.5 要求的双层夹具）；
- ⑧ 新负向六组：无时区串 / 文字串 / 负数 / 1970 前 ISO（负毫秒）在时间字段全拒；`quietStart="9:00"`、`quietEnd=" nighttime"` 被拒。

原有 18 组反例、正向兼容面、四条变异（M-S1–M-S4）全部保留并通过。

### 真实 Chrome（`browser-import-format-check.py`，**11/11 PASS**，exit 0）

原 10 用例全绿不变；新增 **`legacy-iso-time`**（夹具 = 真实设备 payload）：

- 进入确认框（`confirmBody = 导入将覆盖当前数据，继续？`）；
- 点确定后 IDB put **0→1**，items 落库 `['p2c-item-1', 'i_1eofm1s6mubh9kso']`，toast「导入成功 · 2 条事项」；
- 导入后内存中 item/note createdAt 类型全部 `number`；
- **冷启动读回**：同一 context 内新开页面（新文档、重新 boot、从 IDB 重载），读回 items×2 + notes×1 的 createdAt 类型**全部为 `number`**。

原始观测：`browser/browser-import-format.json`。

## 对复验 §6 两项记录的处置

- 「非空数组」文字错误：上轮 run README 已更正为「items/notes/projects 必须是数组（合法空库可备份可恢复）」。
- quietStart/quietEnd：选择**收紧为合法 HH:MM**，文案与判据一致；已补负向断言（⑧）。

## NOT_PERFORMED（待独立复验，按复验 README §8 顺序）

1. 当前设备真实 payload 离线回环（Node 侧已自验，设备侧未做）；
2. APK 内 22 项 Web 资源逐字节核对；
3. 覆盖安装 exportrecheck 测试包；
4. 两个无效文件经真实系统选择器导入，IDB 记录哈希与文件集合不变；
5. 合法备份导入后 force-stop 冷启动持久化 + loaded/authoritative/idb；
6. 原始测试数据按备份恢复并再次核对。

## 交接入口

- Chrome 脚本独立重跑：`IMPORT_CHECK_OUT=<dir> /usr/bin/python3 scripts/verification/browser-import-format-check.py`（11 用例，exit 0 = 全过）。
- B1 夹具路径：`docs/reviews/verification-runs/20260922T134219-independent-p2cs-recheck/evidence/device-preexisting-backup.json`（test-unit ⑧ 段与 Chrome 用例均直接读取该文件，夹具丢失会显式 FAIL）。
