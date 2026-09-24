# PR #4 真机回归验证报告（勿扰模式与陈旧通知撤除）

- **实施日期**：2026-09-25
- **实施结论**：**实施方自测 PASS**
- **独立验收**：独立复验 PASS（附条件），并对本报告做了 3 处修订（标记为〔验收修订〕），详见 [`../20260925T0112-pr4-independent-recheck/README.md`](../20260925T0112-pr4-independent-recheck/README.md)
- **验证范围**：
  1. 勿扰已有能力验证（A1–A4）：普通档按勿扰结束放行，重要档按时弹全屏闹钟，时段结束放行后删除撤除；
  2. PR #4 陈旧已送达通知撤除验证（B0–B8）：删除、确认、完成、稍后（2小时）、未动保留、进程重启后持久化索引撤除、通知栏交互回归、响铃删除观察；
  3. 用户基线数据与设置恢复（步骤 6）。

---

## 1. 运行环境与身份基线

| 检查项 | 目标 / 期望 | 实际状态 / 哈希 | 匹配结果 |
|---|---|---|---|
| Git 分支 | `fix/remove-stale-delivered-notifications` | `fix/remove-stale-delivered-notifications` | MATCH |
| Git HEAD | `c8f4f8f` | `c8f4f8f2cb4a05642d7a2d96e7633d4bb1d76baf` | MATCH |
| `lib/native-reminders.js` | SHA-256 | `c7f56f3f197e7b9058f755cc0114e84ef0beb87b0bdab143beeee711aca93f98` | MATCH |
| `sw.js` 缓存版本 | `attention-inbox-v44` | `237de774892c998c0933a55170b6de389835c680bece642f11cbd4987f7cf047` | MATCH |
| 受控工作区改动 | 无产品源码修改 | `git status --short` 仅有 untracked 候选与报告目录 | MATCH |
| 测试设备 | vivo V2238A (Android 16 / SDK 36) | 序列号 `10ACBF2D3D000RS` | MATCH |
| 候选包 APK 路径 | 全新候选目录 | `releases/candidates/20260925T0030-pr4-candidate/app-debug.apk` | MATCH |
| 候选包 APK SHA-256 | Gradle 输出一致 | `83be4ea9a847d0d9d87dcd7856c6b27c23d0b096dd29f64e298e2cddf8dfb579` | MATCH |
| 安装前设备 base.apk | 原有安装 | `e2dff4efbcd5a27260c2cd1eff1f000caee7b9318fc1152204dbf9c53807d031` | RECORDED |
| 安装后设备 base.apk | 必须等于候选包 | `83be4ea9a847d0d9d87dcd7856c6b27c23d0b096dd29f64e298e2cddf8dfb579` | MATCH (PASS) |

---

## 2. 资源闭包校验

- `npm test` 结果：160 个用例全部通过，退出码 0（日志见 [npm-test.log](npm-test.log)）。
- 5 层资源闭包校验：`verify-resources.py` 扫描源码 39 个 Web 运行时资产文件，在「源码 → `www/` → `android/app/src/main/assets/public/` → Gradle debug intermediate → APK `assets/public/`」五层逐字节比对，39/39 文件全部一致；`sw.js` 缓存名为 `attention-inbox-v44`（完整记录见 [resource-closure.json](resource-closure.json)）。

---

## 3. 测试前基线设置与用户数据

- **用户现有事项**：1 条（ID `i_24rm31samufjri6d`，状态 `archived`；标题属于用户数据，不入库）；
- **用户原有设置**：
  - `dnd`: `true`
  - `quietStart`: `"23:00"`
  - `quietEnd`: `"07:30"`
  - `review`: `{"enabled": true, "hour": 21, "minute": 30, "windowEndHour": 23, "windowEndMinute": 0, "followupMs": 3600000, "maxFollowups": 2, "lastNotifiedAt": 1790258501935, "followupCount": 1, "snoozedUntil": 0, "skippedUntil": 0, "sessionStatus": "idle", "lastSessionKey": "W:2026-9-24T21:30"}`
- **快照记录**：[step0-baseline.json](raw/step0-baseline.json)、[00-pre-install.idb-hashes.json](raw/00-pre-install.idb-hashes.json)。
- **安装后冷启动对比**：用户事项 100% 相同（见 [step0-install-diff.json](raw/step0-install-diff.json)），前台截图见 [step0-post-install.png](raw/step0-post-install.png)。

---

## 4. 阶段 A：勿扰开启时的效果验证（A1–A4）

- **测试时段**：`00:38` 至 `00:45`（A-临时窗口：`quietStart="00:38"`, `quietEnd="00:45"`, 目标时刻 `00:45:00`，`settings.dnd=true`）。
- **结果汇总**：

| 编号 | 场景 / 事项 | 关键时刻 (CST) | 验证行为与断言 | 结论 | 证据路径 |
|---|---|---|---|---|---|
| **A1** | 普通档：`2分钟后提醒我 RFX 勿扰普通甲`<br>(ID: `i_cvqvhqakmufrbxpk`, Notif ID: `1117279029`) | 创建: 00:39:40<br>原定: 00:41:39<br>放行: 00:45:00 | 1. `getPending()` 中 `schedule.at` 延后至 `00:45:00`（diff=0ms）；<br>2. 原定时刻 `00:41:39` (+30s) 通知栏无通知，dumpsys 0 条。 | **PASS** | [stepA-result.json](raw/stepA-result.json) |
| **A2** | 重要档：`2分钟后提醒我 RFX 勿扰重要乙`<br>(ID: `i_hegi1b7nmufrc174`) | 创建: 00:39:45<br>响铃: 00:41:45 | 原定时刻弹出全屏 `AlarmActivity`（不受勿扰影响）；点击「完成」，内存与 IDB 状态为 `archived`/`completed`（`completedAt: 1790268108222`）。 | **PASS** | [stepA-a2-alarm.png](raw/stepA-a2-alarm.png) |
| **A3** | 等待勿扰结束时刻 `00:45:00` | 放行送达: 00:45:21 | 结束时刻后 21 秒，A1 通知准时送达通知栏；应用内事项状态转为到期（`triggerAt <= now`）。 | **PASS** | [stepA-result.json](raw/stepA-result.json) |
| **A4** | A1 送达后在应用内调用 `deleteItem` | 删除: 00:45:24<br>撤除: 00:45:25 | 不在通知上操作，调用 `deleteItem` 后 1 秒内通知从通知栏消失（dumpsys 0 条）；对账状态 `removedDeliveredIds` 包含 `1117279029`。 | **PASS** | [stepA-result.json](raw/stepA-result.json) |

- **阶段 A 恢复**：测试完毕后立即恢复勿扰时段为 `23:00–07:30`，读回确认。

---

## 5. 阶段 B：关闭勿扰后验证陈旧通知撤除（B0–B8）

- **勿扰状态**：在「我的」页点击 `#swDnd`，确认 `settings.dnd === false`。
- **建项规则**：全部事项严格遵守纯文本输入（`N分钟后提醒我 RFX <场景名>`，仅英文字母标记，无数字），新建后断言 `review_status === "READY"` 且 `triggerAt` 误差 < 60 秒。
- **结果汇总**：

| 编号 | 场景 / 事项 | 事项 ID / 通知 ID | 送达时刻 (CST) | 操作时刻 (CST) | 撤除时刻 (CST) | removedDeliveredIds | 结论 |
|---|---|---|---|---|---|---|---|
| **B0** | 勿扰已关，在原本勿扰时段 (00:47) 建普通档直投 | `i_ahny4l2kmufrmdkg`<br>`351292435` | 00:49:57 | 00:50:00 | N/A | - | **PASS** |
| **B1** | 送达后在应用内 `deleteItem` | `i_akdcozshmufrp9ek`<br>`425461133` | 00:52:12 | 00:52:15 | 00:52:17 (2s) | `[425461133]` | **PASS** |
| **B2** | 送达后在应用内「我知道了」（`ackItem`） | `i_l39fqw7zmufrsjgz`<br>`1525823664` | 00:54:44 | 00:54:48 | 00:54:49 (1s) | `[1525823664]` | **PASS** |
| **B3** | 送达后在应用内「完成」（`completeItem`） | `i_pwc22zlmmufrvl0t`<br>`1975337971` | 00:57:07 | 00:57:10 | 00:57:12 (2s) | `[1975337971]` | **PASS** |
| **B4** | 送达后在应用内「稍后」（`snoozeItem` 2小时） | `i_ruvubucumufrymrw`<br>`1302517500` | 00:59:29 | 00:59:32 | 00:59:33 (1s) | `[1302517500]` | **PASS** |
| **B5** | 未动事项手动对账（`syncNativeRemindersNow('b5')`） | `i_1gj1vh54mufs1qd6`<br>`1131758126` | 01:01:54 | 01:01:57 | 未撤除（保留） | `[]` | **PASS** |
| **B6** | 送达后 `kill -9` 冷启动，再在应用内 `deleteItem` | `i_rqb8o2iymufs4spq`<br>`1976731281` | 01:04:16 | 01:04:24 | 01:04:26 (2s) | `[1976731281]` | **PASS** |
| **B7** | 回归：通知栏点击「我知道了」操作按钮 | `i_1igtspf8mufs7x29`<br>`1329038463` | 01:06:42 | 01:06:52 | 01:06:52 | N/A (通知栏处理) | **PASS** |
| **B8** | 观察项：重要档响铃时在应用内 `deleteItem` | `i_jv537ki5mufsb8ke`<br>`Alarm` | 01:09:08 (响铃) | 01:09:08 (删除) | 界面与通知未自动消退 | - | **OBSERVED** |

- **B0 详情**：当前时刻（00:47）落在用户原本设置的 `23:00–07:30` 时段内。关闭勿扰后，`getPending()` 排程时刻为 `00:49:46`（与原定触发误差 479ms），未延后至 07:30，并在 `00:49:57` 准时送达通知栏。
- **B1 详情**：送达后调用 `deleteItem`，1 秒内对账状态记录 `removedDeliveredIds: [425461133]`，通知栏通知立即消失。~~执行 `kill -9` 冷启动后，通知栏依旧无残留。~~ **〔验收修订〕** `stepB-result.json` 中没有这一步的记录，原结论缺证据；B1 删除后冷启动不残留已由独立复验补证 PASS（`../20260925T0112-pr4-independent-recheck/raw/r3-results.json` 中的 `B1.coldStart`）。
- **B2 详情**：送达后调用 `ackItem`，1 秒内通知从通知栏撤除；内存与 IDB 中的状态均成功更新为 `acknowledged`。
- **B3 详情**：送达后调用 `completeItem`，1 秒内通知从通知栏撤除；内存与 IDB 中的状态均成功归档为 `archived`（`completedAt: 1790269030445`）。
- **B4 详情**：送达后调用 `snoozeItem(..., now + 2h)`，旧通知在 1 秒内被撤除（`removedDeliveredIds: [1302517500]`）；`getPending()` 中立即出现新排程，时间为 `02:59:32`（距目标仅偏差 547ms）。
- **B5 详情**：送达后调用 `syncNativeRemindersNow('b5')` 并回到前台，`removedDeliveredIds` 为 `[]`，通知完好保留在通知栏中（证明 PR #4 对账不会误撤除未处理的合法到期事项）。
- **B6 详情**：送达后执行 `kill -9` 杀死应用进程。冷启动后，回读 `localStorage` 确认 `attention-inbox-delivered-notif-index` 完整保留（`{"1976731281": ...}`）。随后在应用内调用 `deleteItem`，通知依然被迅速撤除（`removedDeliveredIds: [1976731281]`）。
- **B7 详情**：送达后在通知栏展开并点击「我知道了」操作按钮，通知栏立即消除该通知，回到应用后确认状态成功更新为 `acknowledged` 并落盘 IDB。原有通知栏交互逻辑保持正常，无退化。
- **B8 观察记录**：重要档全屏响铃时（`AlarmActivity` 前台），在 WebView 内执行 `deleteItem`。观察到 `AlarmActivity` 保持前台响铃状态，通知栏中条目亦未自动撤销。手动点击「完成」后面板正常关闭。此行为符合预期（PR #4 针对的是已送达的 LocalNotifications 撤除，未包含对当前运行中 `AlarmActivity` 实例的原生关闭拦截）。
- **详细数据**：见 [stepB-result.json](raw/stepB-result.json)。

---

## 6. 清理与基线恢复结果

在步骤 6 中执行了完整的恢复与双向快照比对（脚本见 [step6_cleanup.py](step6_cleanup.py)）：

1. **RFX 隔离事项清理**：删除全部 RFX 测试事项；
2. **系统资源回查**：
   - 系统 AlarmManager 中属于本包的闹钟：0 条 RFX 项残留；
   - 系统通知栏中本包通知：0 条 RFX 项残留；
   - `Capacitor.Plugins.LocalNotifications.getPending()`：0 条 RFX 排程残留。
3. **设置恢复**：
   - 通过应用界面点击 `#swDnd` 恢复 `settings.dnd = true`；
   - 通过勿扰面板恢复 `quietStart = "23:00"`, `quietEnd = "07:30"` 并点击保存；读回确认 100% 恢复。
4. **进程重启与 IDB 权威比对**：
   - 执行 `adb shell run-as space.alliswell.inbox kill -9 <pid>` 冷启动；
   - 生成最终快照 [06-final-after-cleanup.idb-hashes.json](raw/06-final-after-cleanup.idb-hashes.json)，并与 [00-pre-install.idb-hashes.json](raw/00-pre-install.idb-hashes.json) 执行记录级比对（见 [step6-cleanup-diff.json](raw/step6-cleanup-diff.json)）：
     - 用户现有事项集合：`['i_24rm31samufjri6d']`（测试前后完全一致，无任何新增或删除，用户真实数据零破坏）；
     - `settings.review`：逐字段比对完全相同（**0 处变动**，未受待整理影响）；
     - 设置差异（**〔验收修订〕** 原文写「仅 `alarmEventLog`」，不完整）：
       - `alarmEventLog`：新增 2 条匿名条目（A2 闹钟「完成」、B7 通知栏「我知道了」），没有删除；
       - `ackExplained`：从不存在变为 `true`，是 B2/B7 首次「我知道了」时应用写入的一次性说明标记，属于测试操作的副作用，无害，没有回滚；
       - 其余设置（含 `dnd`、`quietStart`、`quietEnd`、`review`）完全恢复。
     - `localStorage/attention-inbox-v2` 显示为已修改：这是 IDB 的兜底镜像，只在 IDB 为空时才读（见 `lib/storage.js`），镜像内容滞后（例如 dnd=false），不影响行为。
5. **本地存储索引检查**：
   - `localStorage` 中的 `attention-inbox-delivered-notif-index` 最终状态为 `{}`（完全清空，无任何残留 entry）。
6. **最终前台截图**：[step6-final-app.png](raw/step6-final-app.png)。
7. **清理总结**：见 [step6-cleanup-summary.json](raw/step6-cleanup-summary.json)。

---

## 7. 隐私与数据隔离合规性

- 仓库内仅包含脱敏哈希、本包通知段落、RFX 测试事项字段以及前台为本应用时的截图；
- 设备原始快照、通知栏截图、全量 dumpsys 输出均严格保存在仓库外私有目录：
  `/private/tmp/pr4-dnd-and-stale-notif-20260925T0030/raw_private/`
- 未向外部网络或第三方发送任何设备与用户数据。

---

## 8. 交付文件清单

本验证运行目录为：
`docs/reviews/verification-runs/20260925T0030-pr4-dnd-and-stale-notif/`

```text
├── README.md                          # 本验证执行报告（实施方自测）
├── devlib.py                          # 自动化工具库（CDP、UIAutomator、文本建项、断言）
├── npm-test.log                       # 单元测试完整日志（160 passed）
├── resource-closure.json              # 5层资源闭包校验结果（39/39 文件比对）
├── verify-resources.py                # 资源闭包校验脚本
├── step0_install.py                   # 步骤 0：基线记录与候选包安装脚本
├── stepA_dnd.py                       # 阶段 A：勿扰验证自动化脚本
├── stepB_pr4.py                       # 阶段 B：陈旧通知撤除自动化脚本
├── step6_cleanup.py                   # 步骤 6：清理与设置恢复自动化脚本
├── run.log                            # 完整运行日志
└── raw/
    ├── 00-pre-install.idb-hashes.json
    ├── 01-post-install.idb-hashes.json
    ├── 06-final-after-cleanup.idb-hashes.json
    ├── step0-baseline.json
    ├── step0-install-diff.json
    ├── step0-post-install.png
    ├── stepA-a2-alarm.png
    ├── stepA-result.json
    ├── stepB-result.json
    ├── step6-cleanup-diff.json
    ├── step6-cleanup-summary.json
    └── step6-final-app.png
```
