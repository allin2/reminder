# 闹钟排程修复（2026-09-17）

用户设备：OPPO Find X8 Pro；Android / ColorOS 版本及失败场景未提供。尚无该手机日志，以下是已复现的代码缺陷与模拟器证据，不认定为用户设备的全部根因。

## 修改

- `lib/native-reminders.js`：未来 1 秒内的事项不再被排除，避免对账在到点前撤掉原生闹钟和普通通知。
- 全屏闹钟对账独立于普通通知排程；普通通知抛错时仍排首次闹钟，返回闹钟台账及错误状态，便于后续取消和重试。
- 只有确认成功的通知排程、撤销才计入统计和截止保护台账，避免失败被记为成功。
- `test-native-reminders.js`：新增 7 项断言，修复前 6 项失败，修复后全部通过。

当前分支 main，基础 HEAD acbe3c539c88f00d836d448dafc31addf1496c90。开始时已有大量未提交修改，本次保留；APK 包含当前工作区已有修复。未提交或推送，未覆盖 releases 中原有 APK。

## 验证

- npm test：unit 29、native 160、smoke 162、regressions 567，总计 918 通过，0 失败。
- cap sync、assembleDebug、assembleRelease 成功；git diff --check 通过。
- 发布 APK v1/v2/v3 签名验证通过。两种 APK 内 app-core.js、lib/native-reminders.js 与当前源码逐字节一致。
- Android 14 API 34 模拟器：覆盖安装调试包成功，ready() 为 true。
- 经应用 makeItem + saveAsync 保存普通档显式 alarm 测试事项，30 秒后触发。读取 AlarmManager 确认实际排程，然后 Home、熄屏、am kill；pidof 返回空，确认进程已结束（非 force-stop）。
- 计划时刻 1789630757000，系统排程 1789630757002；广播收到 1789630757500，全屏 Activity 写入 shownAt=1789630758018。投递时 screenOn=false、locked=false、overlay=false。因此这是熄屏、后台进程回收验证，不是安全锁屏验证，也没有声学采样证明扬声器声音。
- 验证后返回主界面并通过应用删除测试事项；其他事项保留。

证据位于 evidence-alarm-fix-20260917/：before.log、tests.log、build.log、delivery.xml、receiver.log。

## 交付

- releases/安心收件箱-alarm-fix-20260917-release.apk
  SHA-256: 14d7129d22d5043b94d21a001f48e523c160ce90bd5e8d0393adc8ae043ae917
- releases/安心收件箱-alarm-fix-20260917-debug.apk
  SHA-256: 892ecd94c945bb7a1228f0b4d3af0503d02e3d5a9f1239c38d3d47e08243d473

## 待验证

NOT_PERFORMED：OPPO 真机、ColorOS 后台限制、重启、Doze、安全锁屏、发布包真机覆盖安装。模拟器运行证据对应调试包。

在 OPPO 上覆盖安装对应签名的版本，勿先卸载以免丢数据。新建 2 分钟后的显式闹钟，按 Home 后锁屏，观察到点结果；若仍失败，提供应用“提醒能力自检”中的权限、后台排程和最近投递记录，以及 Android / ColorOS 版本。

## 追加：用户反馈仅弹框成功一次

亮屏、解锁、桌面前台复测：测试闹钟计划 1789631417588，Receiver 于 1789631417597 收到，shownAt=0；ActivityTaskManager 明确 BAL_BLOCK，前台仍为桌面。全屏通知权限=true、悬浮窗权限=false。此结果说明原 APK 在亮屏后台场景不能保证自动弹出，上一轮熄屏成功不能外推。证据：awake-delivery.xml、awake-bal-block.log。测试闹钟 9172001 与对应通知已撤销。

用户 OPPO 是否同一原因尚未确认。需区分独立闹钟与同一事项的重复通知（现有策略只有首次使用全屏），并取得失败时亮屏/锁屏、声音/通知以及权限状态。此次未据此盲目修改弹框策略或再发 APK。
