# 原生窗口和声音检查

用户否认在后台看到/听到闹钟，之前 onResume 不得作为人眼可见或听见的证据。OPPO 根因仍未确认。

修改：同一 trace token 的重复 Intent 不再停止重启声振；不同 token 仍换事项。移除 Receiver 直接启动异常后的 MainActivity 兜底，避免与系统 FSI 竞争窗口。未移除通知兜底。MediaPlayer 主播放失败释放实例，备用声音同样使用 USAGE_ALARM。补记录创建、焦点、恢复、暂停、停止、销毁、按钮动作、自动关闭、音量、播放成功/错误及延迟窗口采样。旧 shownAt 改由获得焦点写入，UI 明确为非目视确认；历史安装包留下的 shownAt 不会被重新验证，旧结论不可沿用。

已有窗口权限、音量设置保持原样，不擅自改音量或申请更高权限。没有证明这些修正就是 OPPO 根因。

当前 main / acbe3c539c88f00d836d448dafc31addf1496c90，保留已有 dirty 修改；未提交推送。

## 实测

正常表单创建 critical、手选时间。模拟器 API34，Home 后熄屏；事项计划1789638060000，原生排程1789638061147，广播1789638061218；audioVolume=6/7，audioStarted isPlaying=true；focus=true；1.2秒采样 shown=true/windowVisibility=0/playing=true。原生全屏截图可见。对账1789638063080撤销排程后，窗口和播放器继续运行，直到1789638088102按返回产生userAction=close，随后effectsStopped。说明取消排程不自动终止已经启动的窗口，不能凭该记录判为根因。

没有扬声器声学采样，无 OPPO/API36 真机验证。重复 Intent 去重与启动异常兜底修正尚无独立注入测试；记录已有模拟器运行验证而非宣称全部修复成立。

最终包较运行期实测版本只调整不同 token 时停止旧播放器的归属顺序，以及轨迹中文标签；重新 npm test / 构建，最终 debug 覆盖安装初始化与诊断回读通过。npm test 1007 通过（105+160+175+567）。debug/release Gradle构建、签名校验、APK index/app-core 字节一致、受影响路径 diff --check 通过。测试事项经应用删除，保留其他数据。

## 产物

releases/安心收件箱-window-fix-20260917-release.apk
SHA256 2996cd640f712ff39622bcea06d02fc6ae2b16bb5d268feed811ea2a36ab7109
releases/安心收件箱-window-fix-20260917-debug.apk
SHA256 7fde31fa3903699a1179f529f58170be20af571a8bd90f8bea0c8e3a36c0ef87

原有包保留。下一步只需真机一条关键事项，触发后未操作前先观察，再回自检截图窗口/声音轨迹。当前迭代是有边界的修正和诊断，不是正式设备 PASS。
