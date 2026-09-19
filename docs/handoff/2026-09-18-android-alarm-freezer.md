> **2026-09-18 OPPO 最新暂停点**：本轮已修复隐藏震动的停止入口，用户要求完成当前实验后暂停验收。先读 [OPPO 修复与验收状态](../reviews/android-oppo-hidden-alarm-20260918.md)。当前候选 SHA256 `b4eb10c410e3537a88cf0f4821d714a9d97dd1c22dfa73b5b5cf983eb7c7acfc`；75 秒息屏/其他 App 前台通过，SIGKILL 后冷启动失败，不能沿用下方 vivo 的 PASS。OPPO 已改“完全允许后台行为”，自启动设置尚未核对。源码未提交，新 Release 未发布。
>
> **2026-09-18 vivo 最新候选复验续跑点**：当前仅连接 vivo `10ACBF2D3D000RS`。目标 APK 仍为上述 `b4eb10c4…7acfc`，但机上实际安装的仍是 F6c `7813017e5d7f9454bdafb5ead8ccfc5417f44c1242f096647eb16cf7032fa1c9`。本轮重新执行保留数据升级安装时，vivo 返回 `INSTALL_FAILED_ABORTED: User rejected permissions`；随后取证确认设备处于锁屏，最新候选没有落地。因此 **尚未开始把 off / other / cold 三组结果绑定到最新候选**。安装前快照在 `docs/reviews/verification-runs/20260918-vivo-latest-candidate/before-install/`，安装等待/拒绝现场在同目录的 `installer-wait/` 与 `install-rejected/`。下一步必须先解锁手机，再由用户在 vivo「安全守护」页手动勾选风险确认并点“继续安装”；不得绕过该系统确认。安装完成后先核对机上 SHA-256 为 `b4eb10c4…7acfc` 与升级前数据未丢，再依次运行最新候选的 75 秒 `off / other / cold`，脚本入口为 `scripts/verification/alarm-device-matrix.py`。

# Android 闹钟交接 · vivo freezer / R-1 · 2026-09-18

接手 Agent 先读这一份即可开始工作；下方报告与原始证据供核验，不需要回溯对话。


## 最新功能验证：F6c 当前候选（2026-09-18）

用户要求优先验证功能，已补齐 F6c 本机息屏和进程被杀后唤起：接收/界面延迟分别 **90 / 886 ms**、**811 / 2082 ms**，当前候选实测 PASS。四个原生按钮（关闭、我知道了、稍后 2 小时、完成）的状态、停止效果、通知撤销与排程均通过；关闭保留 3 个后续提醒，完成清空本事项排程。没有发现需改产品的功能故障。

- 当前候选 SHA-256 仍为下节 F6c 值，测试前再次读取机上 APK 核实。
- 详细报告：`docs/reviews/android-vivo-f6c-functional-20260918.md`。
- 原始证据：`docs/reviews/verification-runs/20260917T165157Z-f6c-acceptance/`、`docs/reviews/verification-runs/20260918-f6c-actions-r3/`。无效采集首轮与错误断言 r2 保留并标记，不充当产品故障证据。
- 原有 8 条事项保持不变，独立测试事项归档；重载持久化核对见报告。
- **30 分钟长待机按用户优先级延后，NOT_PERFORMED**；2 小时后实际投递、拔 USB、重启恢复、录音确认未执行。现有结果绑定当前白名单设置和 USB 连接条件。
- 验证脚本在 `scripts/verification/`；新脚本与证据尚未 Git 提交/推送。

## 最新进展：F6c 设置引导已接入（2026-09-18）

用户“继续推进”后，已完成三项设置说明和两个入口，位于提醒能力自检顶部；新增请求中禁用、防连点、失败手动恢复及返回后的“需确认”提示。系统白名单与厂商权限分开说明，排程登记不再冒充后台已就绪；无法读取排程显示未知。

- 当前机上已更新为 **F6c**：`releases/安心收件箱-alarm-fix6c-20260918-debug.apk`。
- 本地与机上 SHA-256 均为 `7813017e5d7f9454bdafb5ead8ccfc5417f44c1242f096647eb16cf7032fa1c9`。
- 设置原生入口增加 NEW_TASK | CLEAR_TOP；权限引导使用标准应用详情入口。实际页面验证在 F6b 完成；F6c 仅增加自检标签 CSS，最终真机布局、数据、安装哈希已验证。
- 四组测试 `105 + 193 + 175 + 567 = 1040` 全通过，其中 9 项新行为测试；Gradle debug 构建通过。最终 CSS 调整未重复跑产品全套测试，已做真机布局验证。
- 8 条既有事项（原 7 条 + 已归档 R-1 测试记录）安装前后逐字段一致，系统放行设置未修改。
- 本轮证据：`docs/reviews/verification-runs/20260917T164225Z-f6-guidance/`，含原始日志、截图、源码前后快照、仅本轮增量 `changes.patch`、SHA-256 清单。
- 设置引导阶段未重跑息屏/冷启动；后续 F6c 当前候选实测结果见文档顶部。下文 F5 历史记录仍绑定 F5，不能与 F6c 原始证据混用。
- 已保留 F5、F6、F6b、F6c，不覆盖旧候选；本轮源码、脚本与验证证据已纳入 `main` 的同步范围。

下文是 R-1 的 F5 历史验证和方法。其“当前候选/尚未接线”状态由本节更新；本轮已按既有设计完成条件性说明、常驻自检入口、失败提示，不增加常驻服务或准点保证。

## 1. R-1 结论和下一步（F5 阶段记录）

**这台 vivo 的当前 F5 已通过息屏全屏及进程退出后冷启动两种实机验证。** 本轮通过系统设置依次开启“允许后台耗电”“锁屏显示”“自启动”，没有改产品代码或重装 APK。设置已保留。

这三项解决不同层次的问题：后台耗电放行恢复及时投递；锁屏显示允许闹钟界面出现；自启动允许进程不存在时被闹钟重新创建。既有悬浮窗权限保持开启；关联启动与后台弹出界面仍关闭。

**Q2 已获用户授权并执行，不再等待用户手动操作。** 下一步是产品设置引导与深链接线。Q1/Q3/Q4/Q5 尚未确定，不将本机配置成功擅自改为跨设备准点保证。

## 2. 当前候选、工作区和证据位置

| 项目 | 值 |
| --- | --- |
| 仓库 | `/Users/qlyf/Developer/reminder`；`main`；验证执行时基线 HEAD 为 `acbe3c539c88f00d836d448dafc31addf1496c90`；同步后的提交以 `git log -1` 为准 |
| 工作区 | 验证执行时包含未提交修改；本轮已将任务相关源码、脚本、文档与证据纳入 `main` 同步。历史基线 HEAD 不能代表 F5/F6c 完整源码 |
| 真机 | vivo V2238A，Android 16 / API 36，serial `10ACBF2D3D000RS`；OriginOS 16 为历史环境记录 |
| adb | `/Users/qlyf/Library/Android/sdk/platform-tools/adb`；还连着模拟器，命令必须指定真机 serial |
| 包名 / UID | `space.alliswell.inbox` / `10190`，debug，可 `run-as` |
| 当前安装候选 | F5；本轮重新读取机上 `base.apk` SHA-256，与本地候选一致 |
| F5 SHA-256（不是提交 ID） | `68cd6203db96118423faa4daa0b69ffddcbdfee8ba3bf21f30dbbc1e1a80b246` |
| 本地候选 | `releases/安心收件箱-alarm-fix5-20260917-debug.apk` |
| 本轮 run ID | `20260917T161905Z-r1-settings`（UTC 命名，北京时间 2026-09-18） |
| 当前验收报告 | `docs/reviews/android-vivo-r1-validation-20260918.md` |
| 当前原始证据 | `docs/reviews/verification-runs/20260917T161905Z-r1-settings/`，含 SHA-256 清单 |
| 历史主报告 | `docs/reviews/android-vivo-freezer-rootcause-20260917.md`，其“唯一路径 / 尚未放行验证”结论由本交接更新 |
| 历史原始证据 | `docs/reviews/evidence-freezer-2026-09-17/`：49 份原始证据 + `original-scripts/` 的 4 份历史脚本 |

原有归档只有 40 份，不是旧文字所写的 38 份；与 `/tmp/vivo-f3/` 比对一致后补齐了 9 份。
历史 `manifest.json` 记录 53 个文件的来源、大小、SHA-256。4 个空 XML 原样保留，不能将空采集当作没有投递的证明。
这些文件已纳入本轮 Git 同步范围；新 Agent 从同步后的 `main` 即可取得交接文档、可复用脚本与证据。历史中间 APK 和 `.workbuddy/` 等本地临时产物仍不属于交接内容。

离线校验历史归档及当前证据（均不连接设备）：

```bash
cd /Users/qlyf/Developer/reminder
/usr/bin/python3 scripts/verification/verify-freezer-archive.py
/usr/bin/python3 scripts/verification/verify-freezer-archive.py docs/reviews/verification-runs/20260917T161905Z-r1-settings
```

## 3. 本轮四次实机结果（当前证据）

均使用独立事项 `r1_20260918_001`，LEAD=75 秒。逐项改设置，目标时间不人工打开 App；对本次 item/token 关联 trace、events、通知记录和截图。

| 实验 | 设置 / 进程状态 | 接收延迟 | 界面可见延迟 | 判定 |
| --- | --- | ---: | ---: | --- |
| battery-trial | 开后台耗电；锁屏显示关、自启动关；进程存活 | 62 ms | 未显示 | 部分恢复，完整验收 FAIL |
| lockscreen-trial | 再开锁屏显示；进程存活 | 84 ms | 936 ms | PASS |
| cold-trial | 同上；应用 UID 自行 SIGKILL，PID 为空且 stopped=false | 无本次接收 | 未显示 | FAIL：未见系统启动新进程 |
| autostart-trial | 再开自启动；同样退出进程 | 814 ms | 2584 ms | PASS：系统创建新 PID 16238、全屏截图可见 |

- 两次 PASS 都有目标时间约 +8 秒的匹配通知 ID 记录、`focus=true`、`windowVisible` 和实际全屏截图；不是仅靠退出码或 `notify()` 返回。
- 冷启动成功时 `am_proc_start` 明确由 `ACTION_TEST_ALARM` 广播触发。
- `cold-trial` 的旧投递台账仍为上一轮 `deliveryVisible=true`，但本次 token 没有接收记录，故 FAIL；不能跨轮借用旧台账。
- 系统有 `notification_alert` 与 sound key 证据；未做人工听感或录音验收，不称为声学输出实测。
- 试验末尾的“通知条数”是全文匹配次数，不是真实计数；通知也可能在末尾取样前超时取消。以到点快照及匹配 ID 为准。

测试事项已通过闹钟“完成”按钮归档，未删除。`cleanup-verification.json` 确认原有 7 条事项逐字段未变，`settings.notify=true` 保持不变；测试事项已退出排程。手机返回桌面并息屏。

**未测（NOT_PERFORMED）**：设备重启、系统“强行停止”、划掉最近任务、长时间待机、省电模式、多机型、实际音频输出。当前两场景 PASS 不外推到这些条件。

## 4. F5 已有修复与历史验证边界

以下为上一轮已进入 F5 的改动，本轮未再修改产品代码：

- `AlarmScheduler.java`：解冻服务排 `setAlarmClock`；降级如实记 mode；`cancel()` 撤三种 PendingIntent。
- `AlarmTestReceiver.java`：共享 extras、`FLAG_INSISTENT` 让系统拥有通知声音。
- `AlarmRingService.java`：shortService 与 `EXTRA_HOLD_MS` 测试钩子，服务不导出。
- `AlarmActivity.java`：兼容两套 extras，同一通知避免双路声音。
- `SystemBridgePlugin.java`：`openBackgroundSettings()`，优先标准后台耗电 Action，失败退应用详情；尚未接 UI。
- Manifest 与 `test-native-reminders.js` 已有相应守卫。

历史四组测试记录为 `105 / 184 / 175 / 567`，合计 **1031**，原文 1030 为算术错误。本轮未重跑，记 INHERITED_EVIDENCE。
历史五个实验（未放行的息屏、前台对照、alarmClock 解冻器、40 秒服务、杀进程）见旧主报告；前台成功只说明对应链路可用，不能证明代码完全没有缺陷。

## 5. 复用脚本与复测操作

| 脚本 | 用途 |
| --- | --- |
| `scripts/verification/vivo-alarm-screenoff-trial.sh` | 息屏/亮屏后台排程采集；默认 ITEM_ID 为历史真实事项，复测必须显式覆盖 |
| `scripts/verification/vivo-alarm-foreground-control.sh` | 前台对照；同样显式指定独立事项 |
| `scripts/verification/vivo-fgs-exempt-test.sh` | HOLD/WATCH 窗口内观察服务与冻结；不是长期免冻证明 |
| `scripts/verification/vivo-selfkill-trial.sh` | 非 force-stop 的进程退出测试；杀之前保存 trace 并开始 events；验证退出后 PID 为空 |
| `scripts/verification/capture-alarm-deadline.py` | 并行在目标 +8 秒采集截图、窗口、通知和台账，不唤醒屏幕，记录退出码与取样时间 |

前置：`/usr/bin/python3 -c 'import websocket'`，依赖 `scripts/android-cdp-eval.py`；debug APK 的 `run-as` 可用。
脚本会改测试事项时间、状态、优先级，会切换屏幕；自杀脚本会结束应用进程。不要直接使用默认真实事项，也不要在用户有未保存操作时杀进程。

默认输出到仓库 `docs/reviews/verification-runs/<UTC时间>-<脚本名>-<PID>/`；`RUN` 指定目录必须不存在，拒绝覆盖。端口由 ADB 分配，退出仅清理本脚本的转发和采集进程，不清空设备日志、不删除全部转发。

示例：先准备已获授权的独立测试事项，然后在两个终端运行：

```bash
SERIAL=10ACBF2D3D000RS ITEM_ID="独立测试事项ID" LABEL=r1 LEAD=75 SCREEN=off RUN="$PWD/docs/reviews/verification-runs/新运行ID" bash scripts/verification/vivo-alarm-screenoff-trial.sh
/usr/bin/python3 scripts/verification/capture-alarm-deadline.py "$PWD/docs/reviews/verification-runs/新运行ID" r1 --serial 10ACBF2D3D000RS
```

脚本是采集工具，退出 0 不是 PASS；必须核对本次 `scheduled.triggerAt`、itemId、token、`received`、界面和通知。空文件或采集失败记 UNKNOWN/试验无效，不写为 0。
复测后归档测试事项，核对原有事项、通知和排程，保存清单。

## 6. 系统设置路径与新的深链边界

本机验证可用的设置路径：

1. `android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS` → 后台耗电管理 → 安心收件箱 → 允许后台耗电。
2. `android.settings.APPLICATION_DETAILS_SETTINGS` + `package:space.alliswell.inbox` → **查看所有权限** → 锁屏显示 / 自启动。

“权限”文字本身不是入口，要点“查看所有权限”。UI XML 里权限行外层 Switch 的 `checked=false` 不可靠，实际状态在内部 Switch 节点（本轮保存了前后状态）。

**新发现**：后台耗电 Action 可能只把旧设置任务带到前台，实际仍停在权限详情。`am start -W` 返回成功也不等于正确落页。
本机追加 `NEW_TASK | CLEAR_TOP`（`-f 0x14000000`）已实测回到 `com.iqoo.powersaving/.BackgroundHighUsageActivity`。
当前产品代码仅使用 NEW_TASK，后续 UI 接线应修复并验证该返回路径；`opened` 是请求路径，不能声称已识别实际页面或 OEM 开关状态。

## 7. 待产品决定与下一步

| 项 | 当前状态 / 建议 |
| --- | --- |
| Q1 准点承诺 | 待决定；说明依赖系统放行，不把单机试验提升为保证 |
| Q2 立即验证 R-1 | **已授权、已完成**；两个当前场景 PASS，不再要求用户手动操作 |
| Q3 常驻前台服务 | 待决定；当前配置已通过，不建议仅为绕冻结加入常驻服务 |
| Q4 入口位置 | 待决定；建议自检常驻入口 + 失败后提示 |
| Q5 引导措辞 | 待决定；明确写“后台耗电、自启动、锁屏显示”，并提示到系统设置确认 |

接线时最小范围：实际页面返回修复、设置入口、条件性说明、受影响交互验证。沿用现有设计，不擅自扩大产品承诺或增加系统权限。按需要另做长待机/重启等场景，不重跑已充分验证的相同条件来替代未测条件。

## 8. 容易踩的陷阱

1. 所有 adb 带 serial，防止打到模拟器；执行前重新确认设备连接。
2. 历史环境曾报告 grep 意外为空，本轮不将其泛化为系统规律；本地检索用 rg，脚本用 awk。
3. 此机 main/system 框架日志不足，events 的冻结/唤醒/进程生命周期是关键；不随意清空日志。
4. `run-as` 启动服务必须带 `--user 0`；以 shell 身份直起未导出的服务会失败。
5. trace token 为空时 `AlarmTrace.record` 不落盘；手工服务实验需带 token。
6. `resolveActivity != null` 不证明有启动权限；`am start` 成功也不证明正确落页，须核对实际 UI/top activity。
7. `onCreate/onResume` 不证明可见，必须关联窗口焦点/可见性与截图。
8. 台账跨轮残留、trace 仅保留最近 150 条；先保存再实验，以本次 token 关联。
9. 变更 PendingIntent 形态后，旧实验形态可能仍在队列；全队列计数不是本次排程证明。
10. 普通 SIGKILL、划掉任务、force-stop、重启不是同一场景；不得互相代替验收。
11. 安装可能被锁屏/厂商确认拦下；需要时解锁后 push + pm install -r，保留数据。本轮无需安装。
12. 构建使用 JDK 17 与 `scripts/android-build.sh`；不覆盖冻结候选，证据放候选外。
