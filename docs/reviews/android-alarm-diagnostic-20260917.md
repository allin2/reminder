# 逐次闹钟诊断包

基础 main / acbe3c539c88f00d836d448dafc31addf1496c90，保留既有未提交修改，未提交或推送。

新增 AlarmTrace 原生持久化环形记录（最多 150 条事件，不记录事项正文）。每次 schedule 有独立 token，通过 Intent 传到 Receiver 和 Activity。记录请求、排程 API 成功、广播接收及亮屏/锁屏/通话状态、通知调用返回或异常、启动请求和 Activity.onResume；记录撤销与替换。API 返回不等于系统可见，onResume 也不是人眼确认或声学验证。

一键测试原生一次登记三个独立 ID，10 / 60 / 120 秒。诊断界面 5 秒自动关闭，不回主应用，不写事项动作；测试不参与重启恢复。旧 10 秒、60 秒按钮也改为独立 ID，避免互相覆盖。再次点击连续测试会替换此前未触发的同组测试。取消测试按钮覆盖三个诊断 ID。

结果页显示最新三条测试的计划时间、广播、通知调用、界面前台时间和接收环境。到点未记广播明确显示未收到，不把旧成功冒充新结果。底层完整记录仍保留。

## 验证

npm test 918 项通过（29 / 160 / 162 / 567）。Gradle debug/release 构建通过。发布包签名验证通过；APK 内 index.html / app-core.js 与当前源码逐字节相同。受影响路径 diff --check 通过；全仓库检查另有用户既存 README 行尾空格，未清理。

模拟器 Android 14 / API 34，通过 UI 连续测试按钮启动、Home、熄屏、am kill 后等待：

| 测试 | 计划 epoch ms | 广播 epoch ms | Activity resumed |
| --- | --- | --- | --- |
| 10s | 1789632421175 | 1789632421190 | 1789632421808 |
| 60s | 1789632471318 | 1789632471384 | 未记录 |
| 120s | 1789632531423 | 1789632531481 | 未记录 |

10 秒时 screenOn=false，后两次 screenOn=true；三次 locked=false，inCall=false。三次通知调用均返回。说明诊断能分别呈现收到广播但未进入前台；不能把结果认作 OPPO 同根因。首次弹框会唤醒屏幕，后续屏幕状态由系统决定，本测试不是三次完全同条件的锁屏实验。已验证最终结果页显示三条摘要并目视截图检查。

最终 APK 仅对结果格式做了后续精简，原生代码与连续投递实测版本相同；最终调试 APK 覆盖安装后回读原持久化记录成功。OPPO ColorOS 16 / API 36 真机以及发布版真机安装 NOT_PERFORMED。

证据：evidence-alarm-diagnostic-20260917/trace-complete.xml、screen.png、tests.log、build.log。

## 产物

releases/安心收件箱-diagnostic-20260917-release.apk
SHA256 45a6f36432ffbf2691c71b083632b2d6e8cb8670def2c4c39ea7337f915d2462

releases/安心收件箱-diagnostic-20260917-debug.apk
SHA256 ac305c37d049100d60c59ef7e61c17e930fa1ead71064a85b0ea4c82a691e536

保留原 releases 包。覆盖安装后进入提醒能力自检，点一次“一键后台诊断”，返回桌面锁屏，等待三分钟再刷新并截图“逐次诊断记录”。若签名冲突不要卸载。

## 正常事项路径复查

用户报告测试按钮通过而正常事项失败。使用已安装诊断包，通过 fab 打开表单、手选未来时间、选择重要、点击保存。事项 i_fhn7pt5qmu59tjxd，delivery_mode=alarm，isFallbackTrigger=false；计划 1789633980000，原生最终排程 1789633980178，收到广播 1789633980246，界面 resumed 1789633980980。Home/熄屏后触发，screenOn=false、locked=false。实测未复现用户故障；不可将模拟器结果外推为 OPPO 通过。验证后经应用删除测试事项，其他数据保留。证据 normal-form-trace.json。

源码确认单条表单无提醒方式选择，普通事项沿用录入时全局默认，重要/关键固定 alarm；因此此前要求单条事项明确选择闹钟的指引不准确。等待用户提供失败事项的优先级及时间输入方式。此次无产品源码变更。
