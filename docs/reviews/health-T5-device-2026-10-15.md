# 体检报告 · T5 真机投递与可靠性（含 T8 真机 WebView 部分）

- **执行人**：Agent（真机检查线 T5）
- **日期**：2026-10-15
- **代码版本**：HEAD `f79b1a7396c6f5493e43a27ec88e960f8b620ac3`（未提交文件 51 个）
- **设备与系统**：vivo V2238A（`10ACBF2D3D000RS`）· Android 16（API 36）
- **装机包**：`space.alliswell.inbox` versionCode=**4** / versionName=**1.3**，lastUpdateTime **2026-10-16 14:25:45**（debug 包 `app-debug.apk` 重装成功；versionCode 未随修复递增）
- **证据目录**：`docs/reviews/health-evidence-2026-10-15/T5/`
- **覆盖率**：计划 20 项（T5 主用例 14 + T8 真机 6）→ **执行 8 项，跳过 12 项**（逐条原因见下表）。**只体检，未改产品代码、未 git 提交。**

## 结论（4 句以内）

1. **装包成功**：用户在主设备侧手动 dismiss keyguard 后 `adb install -r` 返回 `Success`；versionCode 仍 4，但 lastUpdateTime 已刷新（debug 包内含 `attention-alarm-v5`）。
2. **HC-T5-0 通过**：用 App 自带「一键多点后台诊断」（`SystemBridge.startAlarmTraceTest`，经 WebView DevTools 触发）排队一次闹钟后，`attention-alarm-v5` 被创建且 **`mSound=null`、`mVibrationEnabled=false`**；**v4 已被删除（`mDeleted=true`）、v3 不存在**。首轮 P0-① 在该修复包上**已修复**。
3. **HC-T5-1／T5-2／T5-3 通过**：亮屏下到点延迟 **16/141/198 ms**，**熄屏+锁屏下首响 285 ms**（走系统全屏意图 `fsi+direct`），均 < 1s；每次投递只有一条 `ringStarted`（声音仅来自 AlarmRingService，v5 渠道静音），未复现双响；**强停后重开仅补投一次**、身份仍是原定触发点。
4. **T8 真机 WebView 有 nuance**：文档被撑高到 ~2× 视口（`#app overflow:visible`）在真机复现，但在 capture+软键盘、detail 两条流程下**未见**可见的「整体上移」（`#app top` 恒 0、`scrollY` 恒 0）；深色模式仍缺失（明确 FAIL）。

## 用例结果

| ID | 结果 | 证据 | 备注 |
|---|---|---|---|
| HC-T5-0 新包渠道（v5 无声无振动、删除 v3/v4） | ✅ PASS | `hc-t5-0-new-package-channels.txt` | 触发方式见下 |
| HC-T5-1 锁屏/息屏到点延迟 | ✅ PASS | `hc-t5-1-alarm-trace.json`、`hc-t5-1-screenoff.txt` | 亮屏 16/141/198 ms；**熄屏+锁屏首响 285 ms（fsi+direct）**，全 < 1s |
| HC-T5-2 到点只一路响铃、不双响 | ✅ PASS | `hc-t5-2-single-ring.txt` | 渠道静音 + 每次仅一条 ringStarted |
| HC-T5-3 强停后补投（只补一次） | ✅ PASS | `hc-t5-3-setup.txt`、`hc-t5-3-result.txt` | `catchUp` 仅 1 次；身份=原触发点；首页 alertBanner 出现提示 |
| HC-T5-4 重启（需用户同意） | ⏭ 待用户同意 | 见文末清单 | 破坏性 |
| HC-T5-5 撤销/重授精确闹钟权限 | ⏭ 跳过 | — | 需用户在系统设置操作 |
| HC-T5-6 关闭通知权限后的行为 | ⏭ 跳过 | — | 同上 |
| HC-T5-7…13 | ⏭ 跳过 | — | 依赖系统设置/时钟改动或跨天观察（P1/P2） |
| HC-T8-1 窄屏整页上移（真机 WebView） | ⚠️ 结构复现 / 可见症状未复现 | `t8-device-new-package.json`、3 张 PNG | 见 P0-C |
| HC-T8-2 软键盘遮挡（真机） | ✅ PASS | `t8-dev-02-keyboard-up.png` | 真点 `input tap` 唤出键盘，面板/输入框完整可见 |
| HC-T8-3 深色模式（真机） | ❌ FAIL | `t8-device-new-package.json` | `prefersDark=true` 仍 `rgb(244,243,239)` |
| HC-T8-4 触控目标（真机） | ⏭ 引用 web 报告 | — | 见 T8-web P1-③ |
| HC-T8-5 无障碍（真机） | ⚠️ 部分 FAIL | `t8-device-new-package.json` | `#toast` 无 `aria-live` |
| HC-T8-6 文案（真机） | ⏭ 引用 web 报告 | — | 见 T8-web P2-⑤ |

## HC-T5-0 通过判据与触发方式

- **渠道创建是惰性的**：只在 `AlarmTestReceiver.ensureAlarmChannel`（`AlarmTestReceiver.java:572`）建，唯一入口是 `SystemBridgePlugin.scheduleAlarmInternal → ensureChannel()`（`SystemBridgePlugin.java:1152 / 698-706`）。**只启动 App 不会建 v5**（实测：重装+启动后仍只有 v4）。
- **触发方式（本线采用）**：`adb shell am broadcast -a space.alliswell.inbox.ACTION_TEST_ALARM …` 不通（receiver `exported=false`）；改用 App 自带 **「一键多点后台诊断」**：`adb forward tcp:9225 localabstract:webview_devtools_remote_4421` → `python3 scripts/android-cdp-eval.py "(async()=>await window.Capacitor.Plugins.SystemBridge.startAlarmTraceTest())" 9225`。该调用内部对 10/60/120s 各调一次 `scheduleAlarmInternal` → `ensureChannel()` → 建 v5 并删 v3/v4。
- **实测渠道属性**（`hc-t5-0-new-package-channels.txt`）：
  - `mId='attention-alarm-v5'` → `mImportance=4 · mSound=null · mVibrationEnabled=false · mDeleted=false` ✅
  - `mId='attention-alarm-v4'` → `mSound=android.resource://space.alliswell.inbox/2131558400 · mVibrationEnabled=true · mDeleted=true · mDeletedTimeMs=1792132392094` ✅（已删；dump 中作为软删除记录保留，属 Android 正常行为）
  - `attention-alarm-v3`：dump 中不存在 ✅
- **首轮 P0-①（闹钟渠道带声 → 双响）在本包上已修复**。

## 发现的问题（按严重度排序）

### P0-a 真机 WebView：文档被撑高到 ~2× 视口，`#app` 未裁剪（结构风险）
- **违反条款**：第二轮 A-1 / INV-07（面板不应带走页面位置）
- **实测**：360×742 CSS px（dpr=3）下 `document.documentElement.scrollHeight=1476`（≈2×742）；`#app overflow=visible`、`body overflow=hidden`；`window.scrollTo(0,323)` 生效（`after=323`）。键盘弹起时 `ih=433`、`sh=861`（同为 ~2×）。
- **证据**：`t8-device-new-package.json`；旧包首连时另观测到 `scrollY=693`。
- **nuance**：**未见可见的「整体上移」**——capture+软键盘与 detail 面板两条流程下 `#app top=0`、`scrollY=0`，首页头部仍在屏内（见 3 张 PNG）。故本轮判「结构复现、可见症状未复现」。
- **建议**：给 `#app` 加 `overflow:hidden`（或 `contain:paint`）；收起态 `.sheet` 用 `display:none`/`inert`。验证：360 宽下 `sh` 应恒 = 视口高。

### P1-a 真机无深色模式（设备深色态下页面整屏亮色）
- **证据**：`t8-device-new-package.json` → `prefersDark=true` 而 `bodyBg=rgb(244, 243, 239)`。OLED 夜间刺眼。

### P1-b 真机 `#toast` 缺 `aria-live`
- **证据**：`t8-device-new-package.json` → `toastAriaLive=null`、`role=dialog`=0。TalkBack 无法播报保存结果。

## 已知问题复核

- **首轮 P0-①（渠道带声）**：**已修复**（见 HC-T5-0）。
- **首轮 P0-②（过点卡死 → lost 补投）**：**已修复**。强停后重开仅补投一次，`catchUp:true` 且身份仍为原定触发点 `0@1792132870000`，无重复补投（`remindCount=1`）。
- **第二轮 A-1（窄屏上移）**：真机 **结构复现、可见症状未复现**（P0-a）。
- **T8-web 的可见上移结论**：真机 WebView **未能复现同等可见症状**，建议以真机为准重估严重度。

## 待用户同意（破坏性/需用户操作项，本线一律未执行）

> 以下命令与前置条件已列出，**待用户明确同意后**再执行。

1. **HC-T5-4 重启**（前置：排好「重启期间到点」「重启后才到点」两条事项）：
   `$ADB reboot`
2. **HC-T5-5 撤销/重授「闹钟和提醒」权限**：用户在「设置 → 应用 → 安心收件箱 → 闹钟和提醒」手动关/开
3. **HC-T5-6 关闭通知权限后到点行为**：用户在「设置 → 通知」手动关/开
4. **改系统时间 / 时区**（HC-T5-11 等）：用户在系统设置手动改（Agent 不改受保护设置）
5. **清除数据**：`$ADB shell pm clear space.alliswell.inbox`
6. **卸载**：`$ADB uninstall space.alliswell.inbox`

## 附录 · 复现命令

```bash
ADB=~/Library/Android/sdk/platform-tools/adb
# 1) 装包（需解锁）
$ADB install -r android/app/build/outputs/apk/debug/app-debug.apk
$ADB shell dumpsys package space.alliswell.inbox | grep -E "versionCode|versionName|lastUpdateTime"
# 2) 渠道查询
$ADB shell dumpsys notification --noredact | grep -E "mId='attention"
# 3) WebView CDP：触发排程 / 读指标 / 软键盘
$ADB forward tcp:9225 localabstract:webview_devtools_remote_<pid>
python3 scripts/android-cdp-eval.py "(async()=>await window.Capacitor.Plugins.SystemBridge.startAlarmTraceTest())" 9225
python3 scripts/android-cdp-eval.py "JSON.stringify({sh:document.documentElement.scrollHeight,ih:innerHeight,ov:getComputedStyle(document.getElementById('app')).overflow})" 9225
# 4) HC-T5-3：强停 → 等待 → 重开
$ADB shell am force-stop space.alliswell.inbox
# …等待 >10 分钟…
$ADB shell am start -n space.alliswell.inbox/.MainActivity
```
