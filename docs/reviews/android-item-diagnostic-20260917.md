# 正常事项诊断补充

用户确认失败事项为关键、手选时间。当前无 OPPO 该事项排程/广播原始记录，不能认定根因已确认。

修改：正常事项诊断独立于测试按钮结果，显示最近创建五条事项的时间、priority/status/rev、delivery_mode、兜底标记、原生计划/广播/前台/撤销/错误。原生新增 itemId 元数据便于关联；旧记录仅能按当前版本重建 ID 尝试匹配，找不到明确显示未知，不当作从未排程。原生环形日志仍只保留 150 条事件，频繁对账或版本变化可能使旧证据不可用。未改动调度策略。

基础 main/acbe3c539c88f00d836d448dafc31addf1496c90，保留工作区其他修改（本次发现 parse-cn/test-unit 等亦在变化），未提交推送。APK 包含构建时整个工作区。

验证：npm test 1007 通过（105+160+175+567），Gradle debug/release 通过；改动路径 diff --check 通过；APK web 资源与源文件一致，release 签名验证通过。

模拟器 API34 经正常表单点击选择 critical、手选时间并保存，事项 i_yb75vsphmu5bkqc3。计划 1789636920000，原生排程 1789636920108，广播 1789636920209，Activity resumed 1789636922067。触发时熄屏、非安全锁屏。使用 CDP 操作 WebView DOM，不等于物理触屏验收。回前台诊断显示该事项完整记录，截图目视核对可读、可滚动，随后通过应用删除测试事项。OPPO API36 真机复验 NOT_PERFORMED。

证据 evidence-item-diagnostic-20260917/。

发布包 releases/安心收件箱-item-diagnostic-20260917-release.apk
SHA256 8c4e9f0733f9c140507c00cefd88a23729fa69de5eb442f837bd8e32805d7aa6
调试包 releases/安心收件箱-item-diagnostic-20260917-debug.apk
SHA256 c99840b166ff740c91ec80de7e1f0ba521d97b924110388aeafd97659b49d116

用户下一步：覆盖安装，不删除失败事项，在自检刷新后截图“最近事项排程诊断”内该事项记录；不再做测试按钮实验。若旧记录已被环形日志覆盖，再决定是否需一次新的正常事项测试。
