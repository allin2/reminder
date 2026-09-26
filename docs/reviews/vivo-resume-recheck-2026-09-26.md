---
title: vivo 真机复测 · 回前台补读原生状态（PR #9，run 20260926T005700Z-vivo-resume-recheck）
date: 2026-09-26
run: 20260926T005700Z-vivo-resume-recheck
verdict: PASS（附 3 条环境观察与 1 条 WARN）
---

# vivo 复测：回前台后补读原生状态；设置面板随状态变化重绘（PR #9）

> ## 验收评审补充（2026-09-26）
>
> 本报告结论「PASS」成立，但需要区分 PR #9 的两处改动各自被证明了什么：
>
> 1. **1.5 s / 5 s 补读：本机未被用上。** 6/6 次在回前台的**即时读**（0.15–0.37 s）就拿到了新值，而这次即时读是 PR #9 之前就已存在的行为；补读因结果未变而未回写。开关矩阵 §4.2 所担心的「回前台后首读仍是旧值」在正方向（开启）未复现，当时的旧值很可能读自应用尚未回前台时的缓存。补读逻辑无害（仅在有能力未验证时触发、结果不变不回写），保留它是为其他机型上可能存在的写入延迟兜底，但**其有效性在本机没有得到证明**。
> 2. **设置面板随状态重绘：基本成立。** 面板开着时每次都有重绘记录、关着时没有；但从设置页返回后，`runSetupStep` 自身也会调用 `renderSetupSheetBody`，本次观察无法把两条来源完全区分。钩子本身的有效性由 `test-boot-combination` 的两条断言及变异测试证明。
> 3. **反方向（撤销）滞后是真实风险，补读覆盖不到。** 允许 → 智能控制后，vivo 撤销白名单常超过 5 s、一次超过 4 分钟，常需灭屏 / 亮屏才更新。期间应用仍显示「已开启」、首页不提示——是一种错误的安心。下次回前台会重新读取，不会永久错下去；建议后续在打开设置面板或切回首页时也补读一次。
> 4. **基线冲突**：上轮 01:21 记录已恢复「智能控制」，本轮 08:59 实测为「允许」，原因不明；本轮已按用户裁决在测后恢复为「智能控制」。

## 1. 环境与版本身份

| 项 | 值 |
|---|---|
| 设备 | vivo V2238A · Android 16 (API 36) / OriginOS 16，serial `10ACBF2D3D000RS` |
| 被测分支 / commit | `fix/refresh-native-status-on-resume` @ `7852ea2`（HEAD 与 origin 一致，工作区仅 `.claude/` 未跟踪） |
| 构建 | `bash scripts/android-build.sh debug` → `releases/安心收件箱-debug.apk` sha256 `19247c739156d51ef9d346253a6c5f205968506b808b134eaab753c6a5412053` |
| 安装 | `adb install -r` 09:56 前完成于 08:56:11（设备时间）；vivo PackageInterceptActivity「已安装相同版本」→ 点「重新安装」（见 run.log §2） |
| 版本身份证据 | 设备 `base.apk` 拉回解包，`assets/public/{sw.js,app-core.js,lib/app-native-coordinator.js}` 与仓库**逐字节 cmp 全 MATCH**；sw.js 含 `attention-inbox-v49` |
| 说明 | 本构建 WebView 不走 SW（caches.keys() 为空），版本判据采用 APK 解包比对（任务书指定替代方案） |

## 2. 步骤 0 · 只读基线

三开关（证据：run 目录 `dumpsys/baseline_allperm.xml`、`screenshots-sanitized/resume_bgpower_detail.png` 等）：

| 开关 | 基线实测值 | 证据 |
|---|---|---|
| 后台耗电管理 | **允许后台耗电**（截图 radio 蓝点 + dump checked RadioButton + `dumpsys deviceidle whitelist` 含 `user,space.alliswell.inbox`，三证一致） | `dumpsys/resume_bgpower_detail.xml`、`screenshots-sanitized/resume_bgpower_detail.png` |
| 锁屏显示 | 关 | `dumpsys/baseline_allperm.xml`（checked=false） |
| 自启动 | 关 | 同上 |

⚠️ **基线冲突（已按 §22 停下请示）**：上轮矩阵收尾（01:21）记录已恢复「智能控制」，但本次 08:59 实测为「允许后台耗电」，间隔 8 小时、原因不明（并行会话或手动）。**用户裁决：从「智能控制」开始，测后恢复「智能控制」**。

应用内（CDP 只读）：`setupPromptStarted=true, setupDismissed=false, backgroundVisited=true, overlayVisited=null, testRun=null, testFeedback=null`（`baseline-settings.json`）；diag 六项全 granted，`ignoringBatteryOptimizations=true`（`baseline-diag.json`）；首页无防冻结卡片；事项 7 条（ID 集合见 `baseline-items-sanitized.json`）。

前置整改（用户已同意）：后台耗电 允许→智能控制（09:10:56 radio 验证），一次回前台后 ignoring=false、卡片重现「还差 1 步…防冻结」。

## 3. 观察手段

- CDP 只读采样 250ms：`#homeSetup` innerHTML、`#sheetSetup.open`、`#setupBody` 中「允许完全后台运行」行 done 标记、`getNativeReminderStatus().diag.ignoringBatteryOptimizations`（脚本 `run_attempt.py`，SAMPLE_EXPR 纯读）。
- **被动重绘观察器**：对 `#setupBody` 挂 MutationObserver（childList），只记录重绘时刻，不写产品状态（`INSTALL_OBSERVER_JS`）。原因：面板行 done=visited||verified，visited 在点入口时已置 true，ignoring 翻转在面板 HTML 上可能无可见差异，重绘本身需要独立证据通道。
- 全程 logcat `-b main,system,events`（归档 `logcat-full.txt`，60108 行；08:57:22–09:17:47 有缺口已登记 run.log §4）。
- Tresume 判定：logcat events `wm_resume_activity …MainActivity`（行号见 §5）。

## 4. 时间线（6 次有效尝试；R1-a 与 R3 两次 recents 误点为 INVALID，见 run.log）

时刻均为设备毫秒时钟（与 logcat 同源）。延迟相对 logcat `wm_resume_activity` 时刻。

| 尝试 | Tswitch | 回前台方式 | Tresume(logcat 行) | 回前台前采样值 | 回前台后首次新值 | 延迟 | 卡片消失 | 面板重绘 |
|---|---|---|---|---|---|---|---|---|
| R1-b（首页卡片进面板） | 1790386038055 | BACK×4+桌面重拉 | 09:27:43.263（L25795） | false | true @+270ms | **0.27s** | +270ms | 22→26 ✓ |
| R1-c（同上） | 1790386284673 | 同上 | 09:31:50.140（L29070） | false | true @+178ms | **0.18s** | +178ms | 36→40 ✓ |
| R2-a（我的页进面板） | 1790386406691 | 同上 | 09:33:51.032（L32753） | false | true @+366ms | **0.37s** | ① | 50→54 ✓ |
| R2-b（同上） | 1790386866xxx | 同上 | 09:41:31.458（L37082） | false | true @-25ms² | **≤0.3s** | ① | 64→68 ✓ |
| R3-a（对照：系统设置直切，面板不开） | 1790387464860 | 最近任务点卡片 | 09:51:14.633（L49564） | false | true @+282ms | **0.28s** | +282ms ✓ | 无（面板关着，符合设计） |
| R3-b（同上） | 1790387704314 | 最近任务点卡片 | 09:55:14.219（L58021） | false | true @+145ms | **0.15s** | +145ms ✓ | 无 |

① R2 停留在「我的」tab：`renderSetupEntry` 仅在 home tab 重绘（既有守卫，`app-core.js:1847`），隐藏的 home DOM 保持旧卡片；**切回首页 tab 后卡片消失**（R2-a、R2-b 均验证）。
② 采样恰在 resume 检测前 25ms 落到新值，属采样相位差，实际为回前台即时读。

6/6 全部满足：回前台后 ≤6 秒（实测 ≤0.4s）ignoring 变 true；面板开着时自动重绘；全程无第二次离开/回到应用。

## 5. 关键日志（文件名 + 行号）

均在归档 `~/Developer/reminder-archive/verification-runs/20260926T005700Z-vivo-resume-recheck/logcat-full.txt`：

- R1-b 回前台：L25795 `wm_resume_activity [0,257007346,152,space.alliswell.inbox/.MainActivity]`
- R1-c：L29070；R2-a：L32753；R2-b：L37082；R3-a：L49564；R3-b：L58021
- 撤销方向收敛参照：L14879（09:11:05.752，恢复智能控制后的回前台，首读仍 true）
- 每次尝试的操作时间线：run 目录 `attempt-R*.log`（含 Tswitch/BACK 序列/radio 校验）；250ms 采样：`samples-R*.jsonl`

## 6. 「厂商异步生效」前提在本机的复现情况（单独报告项）

- **正方向（智能控制→允许，白名单添加）传播快**：6/6 次尝试中，切换到回到前台间隔 10–25s，回前台即时读全部拿到新值。「回前台后第一次原生回读仍是旧值」**未复现**；观察到的是「回前台前应用缓存值恒为旧（6/6）+ 回前台即时读即翻新（≤0.4s）」——这正是本修复要解决的形态。
- **反方向（允许→智能控制，白名单移除）传播慢且惰性（WARN）**：实测多次 >1 分钟，一次 >4 分钟，需灭屏/亮屏或更长时间才收敛（run.log §10、§13；09:11 事件链：回前台即时读与 1.5s/5s 补读全部拿到旧值 true，直到**再次**回前台才翻 false）。**PR 的 1.5s/5s 补读窗口覆盖不到撤销方向**；该方向的用户可见症状是「卡片该出现而不出现」，影响小于防冻结失效方向。
- `origin="resume-recheck"` 标记无法从应用侧只读观测（状态对象不携带 origin），本次以「回前台后无进一步写回/重绘」间接推断补读未产生回写；不影响主判定。

## 7. 设置变更记录（全部经用户对话同意）

| 变更 | 原值 | 改后 | 恢复 |
|---|---|---|---|
| 系统设置·后台耗电管理 | 允许后台耗电（基线实测；与上轮记录冲突，用户裁决从智能控制开始） | 智能控制（09:10:56，测前整改）→ 允许（R1/R2/R3 各 2 次，每次尝试间恢复智能控制） | **智能控制**（09:56:11 radio 验证；白名单条目有惰性残留，属 vivo 撤销方向传播滞后，非设置未生效） |
| 应用内 setupDismissed | false | 未改 | false（与基线一致） |
| 其余开关（锁屏显示/自启动/悬浮窗等） | 关/关/开 | 未改 | 原样 |
| 事项集合 | 7 条（ID 见基线） | 未改 | 收尾与基线 ID 集合**完全一致**；settings 五字段与基线一致（收尾巡检 09:56:44） |

同意记录：本轮对话中用户对「全部同意（系统开关切换 + setupDismissed 必要时临时改）」和「测后恢复智能控制」两次明确批复。

## 8. 证据目录与归档

- 仓库（已脱敏）：`docs/reviews/verification-runs/20260926T005700Z-vivo-resume-recheck/`（run.log、attempt-*.log、samples-*.jsonl、dumpsys/、screenshots-sanitized/、脚本原件 ×4：read_switches.py / baseline-app-state.py / set_bgpower.py / run_attempt.py）
- 归档（原始，含用户内容）：`~/Developer/reminder-archive/verification-runs/20260926T005700Z-vivo-resume-recheck/`（完整 logcat、全部截图、baseline-items-full.json）；SHA-256 已追加至 `docs/reviews/verification-runs/ARCHIVED-RAW-2026-09-25.tsv`（+132 条）
- 仓库侧脱敏动作：移除 8 张含用户事项标题的首页截图（run.log §17）

## 9. 结论

**PASS —— PR #9 建议合入**。6 次有效真机尝试（R1×2 / R2×2 / R3×2）中，「回前台后 ≤6s ignoring 变 true」实测 ≤0.4s；面板开着时随状态变化重绘（MutationObserver 4 记录/次）；首页卡片自动消失（R2 的 me-tab DOM 滞留为既有守卫行为，切回首页即收敛）。附带发现（不阻断合入）：

1. **WARN**：撤销方向（允许→智能控制）vivo 系统侧传播 >5s（一次 >4min，需灭屏/亮屏触发），1.5s/5s 补读窗口覆盖不到；如需覆盖，建议后续把补读扩展到更长间隔或在 diag 页提供手动「重新读取」。
2. 面板行「done」= visited||verified，`verified` 不渲染；「面板显示已验证」的用户预期与面板实际语义存在落差（`lib/feedback.js:368`）。
3. R2 场景下回前台时若停留在「我的」tab，home 卡片 DOM 不刷新（既有守卫 `app-core.js:1847`，非本 PR 引入）。
