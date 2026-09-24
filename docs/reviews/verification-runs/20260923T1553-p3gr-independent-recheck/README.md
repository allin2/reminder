# P3-G 修复与真机证据独立复核

**结论：行为反例已转绿；真机物理响铃有可信的限定证据；候选交付仍为 FAIL / FIX_REQUIRED。** 本轮只读复核产品源码、既有设备证据与设备当前状态，仅新增本独立证据目录；未重装 APK、未触发新闹钟、未更改权限、未改产品源码或旧证据。

## 身份断裂（阻断）

- 2026-09-23 14:55 的独立复验 `20260923T1455-p3g-independent-recheck/README.md` 已绑定 `releases/candidates/20260923T1405-p3g-candidate/app-debug.apk` 的 SHA-256 `dca49aee027e691eeda67d4e124018d913bed82508b3f44cfc4a5545bbd7c4eb`，`app-core.js` 为 `f3e78157…`，`lib/app-alerts.js` 为 `497c5735…`。
- **同一路径现在变成** `bc87fe0530330ab3011af2b3254b784fcc94a429ac34c470dca6b6f15b7f2783`；产品源码现为 `app-core.js` `8b7ea240…` 与 `lib/app-alerts.js` `142746c1…`。`20260923T1405-p3g-alerts-extraction` 的 README、哈希表、资源表及测试日志也在 15:15–15:17 重新写入，现指向新版字节。这些历史路径不能再称作冻结的 14:05 候选或不变的原始自测证据。保留现场，不回拷伪造历史；应另建修复 run 与唯一新候选，并附明确时间线纠错。
- `sw.js` 哈希仍为 `ec78a184…`、缓存名仍是 `attention-inbox-v33`，但 `app-core.js` 和 `lib/app-alerts.js` 已变。现有 Service Worker 为网络优先、离线回退缓存；同名缓存与未变的 SW 脚本不能建立一次新的完整预缓存/激活边界，离线时可能沿用旧字节或混用版本。需按仓库版本契约推进缓存名并以新路径构建候选。真实旧缓存升级仍须单列 P4 实测。

## 独立复验通过的范围

- 旧两条红色反例 `20260923T1455-p3g-independent-recheck/repro-alerts-gaps.js` 在当前源码退出 0：同一关闭按钮仅一个 listener/一次 toast；注入 `save` 拒绝时返回 `false`、无成功 toast。原始输出在 `previous-repro-now-green.log`。
- 新跑 `npm test` 退出 0；六套数字计数为 642/324/890/266/730/160，共 3012 项、0 失败，P3-G 专项与变异也通过。原始日志见 `npm-test.log`、`npm-test.exit`。Chrome 弹条及模拟活动闹钟卡片按钮检查退出 0，见 `browser-alerts.log`。
- 当前 34 项 Web 资源在源码、www、Android assets、Debug 中间层和现存 APK 内逐字节一致；APK 自身 `bc87fe…`。这只证明现存新版资源闭合，不能修复被覆盖的候选身份。
- 只读再查真机：设备型号 vivo V2238A、serial `10ACBF2D3D000RS`，安装包 SHA-256 为 `bc87fe…`；WebView 当前事项数 0，`device_p3g_alarm_` 测试 ID 无残留。`firstInstallTime=2026-09-23 15:38:35`，所以本轮是该包在此设备上的首次安装，不能称为已安装版本的覆盖升级。

## 真机证据的准确边界

实施方 `20260923T1540-p3g-device-verification` 的同 token 台账有 `ringStarted` 与 `windowVisible`，`alarm-triggered.png` 可见全屏闹钟；同一时刻 `alarm-triggered-audio.txt` 有该包 PID 的 `state:started`、`USAGE_ALARM`，`alarm-triggered-vibrator.txt` 有该包 UID 的 running `CurrentVibration`。这足以支持 **现存 `bc87fe…` 包在当前已开权限的 vivo 上发生过可见全屏响铃与声振**。这是对实施方原始证据的独立核对，非本轮重新触发一次物理响铃。

活动面板 `panelHidden=false` 与卡片文本来自 WebView DOM 读取；`app-foreground-with-alarm.png` 未拍到该卡片。所谓“完成事项”由 `p3g-device-verify.py:345` 通过 CDP 直接调用 `A.alerts.completeActiveAlarm(targetAlarm)`，没有实际点击面板按钮。因此真实手指点击面板“完成事项”的交互仍为 **NOT_PERFORMED**。设备脚本的最终 `delivery_ok` 使用宽松 OR，未把同 token 可见/声振、面板显示和完成操作全部纳入强制断言；本报告以上述原始截图与转储另行限定证据等级。

设备测试前有人执行 `pm grant POST_NOTIFICATIONS`、`cmd appops set ... SCHEDULE_EXACT_ALARM allow` 和 `cmd appops set ... SYSTEM_ALERT_WINDOW allow`。当前只读值为两个 AppOps 均 `allow`，此前取值未归档，故不能将这轮结果推广为自然安装/默认权限下的表现，也不宜盲目“恢复默认”。本轮未修改设备权限。

## 仍需修复/裁决

1. 以新 run、新候选路径冻结当前修复及 SW 新版本；逐字节验证五层资源，保留旧路径和历史冲突事实，不再重写 14:05 证据。
2. `dismissAlert()` 的受抑制内层保存分支仍会在 `saveCalls=0`、无外层提交凭据时返回 `true` 并报成功。`probe-suppressed-save.js` 强制该分支，退出 1；**生产 UI 可达性尚未确立**，不能把探针当作已复现的用户故障。需要明确说明该分支是否可达，并以权威提交结果或明确的事务回执收口，避免仅凭 `shouldSuppressInnerSave()` 判成功。
3. 若目标是当前修复候选的正式真机 PASS，需对新候选重新绑定包哈希，并补真实面板按钮点击及必要的设备场景；当前 `bc87fe…` 的物理证据可作为先前版本的 `INHERITED_EVIDENCE`。真实旧缓存跨版本升级仍是 P4 `NOT_PERFORMED`。
