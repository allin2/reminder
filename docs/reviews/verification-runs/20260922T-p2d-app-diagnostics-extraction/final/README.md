# P2-D 实施交接（诊断模块迁出）

状态：实施方自测完成，等待独立验收。此文档不构成 PASS。

本轮把通知实验室、投递判读、闹钟 trace 和系统设置导航的唯一实现放入
`lib/app-diagnostics.js`，由 `createAppDiagnostics(deps)` 创建实例。`app-core.js`
只保留装配、转发和 setup/review 控件绑定；共享平台访问器仍留在 core。实例成员进入
启动闸门，`bind()` 有实例级幂等保护，模块求值不注册监听、不启动计时器、不读状态。

## 实施范围

- 加入 `index.html`、`sw.js` v18、boot/smoke/regression 加载清单和生产脚本覆盖检查。
- 修正 `test-native-reminders.js` 的旧 app-core 源码切片，使 F6/Q6 检查直接驱动真实诊断模块。
- 新增真实生产页面检查 `scripts/verification/browser-diagnostics-check.py`：纯 Web ready、无桥诊断面、完整假桥 verdict/trace、设置导航失败恢复、重复 bind 不增加监听。
- 新增永久反例：投递 carrier 优先级、投递时 overlay 快照优先级、诊断实例契约、生产加载链漏项。
- 运行 `npm run sync:www`、`npx cap copy android`，构建隔离 debug APK；未安装生产包。

## 测试结果

`npm test` exit 0：

- unit 607/0
- native 324/0
- boot 400/0
- smoke 266/0
- regressions 730/0
- parse 160/0

单独检查：

- `python3 scripts/verification/browser-diagnostics-check.py`：4/4 case，exit 0。
- `node --check`：改动 JS 全部通过，exit 0。
- `git diff --check`：exit 0。
- 隔离 APK 构建：`android/app/build/outputs/apk/debug/app-debug.apk`，Gradle exit 0。
- APK 内 19 个 Web 资源逐字节匹配当前源码，`all_match=true`；APK SHA-256 见 `apk-assets.json`。

## 反例结果

- 缺 `lib/app-diagnostics.js`：ready=false，失败面板只点名 AppDiagnostics，IDB/业务定时器为 0。
- 空诊断工厂：合同成员逐项点名，既有绑定保持不变。
- carrier 优先级变异：`已响未亮` 行为反例变红。
- 投递时 overlay 快照变异：快照与当前权限混用的归因变异变红。
- 清空诊断实例合同：静态 API 覆盖和运行时空壳检查变红。
- 生产 harness 漏载 `lib/app-diagnostics.js`：覆盖检查点名 `unaccounted-production-script`。
- `bind()` 重复调用：第二次不增加诊断按钮或 visibility listener。

原始日志与结构化结果：

- `npm-test.log`、`boot-test.log`、`native-test.log`、`smoke-test.log`
- `browser-diagnostics.json`
- `source-hashes.txt`
- `apk-assets.json`

## NOT_PERFORMED

- 独立验收尚未完成；本 run 只代表实施方自测。
- 未安装生产包，未操作真实 Android 用户数据。
- 未执行真机通知权限申请、系统设置跳转、发送测试通知或排测试闹钟；这些动作会产生设备副作用，应由独立验收方按授权单独决定。
- 未把 Android 原生 Java/Manifest 行为重新判为本轮 PASS；本批只验证 Web 模块装配、生产加载链和隔离构建。
- 未提交、未推送，未清理或还原工作区既有脏改动与历史证据。
