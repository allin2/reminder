# P1 SDK 36 独立审查处理报告

日期：2026-10-28。输入：`/tmp/rv-report.md`（Gemini，“修改后合并”）。工作分支：`fix/p1-sdk36`。

## 官方文档核实与方案

[Android 16 目标版本行为变更](https://developer.android.com/about/versions/16/behavior-changes-16#predictive-back)说明：targetSdk 36 且运行于 Android 16+ 时默认启用预测返回，不再调用旧 `onBackPressed` 或分派 `KEYCODE_BACK`；同时明确允许通过 application/activity 的 `enableOnBackInvokedCallback=false` 临时退出。因此，不能把“Android 16 已无视该 opt-out、旧方案已必然穿透”当成事实。

[官方迁移指南](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture)推荐迁移到 AndroidX `OnBackPressedDispatcher` / `OnBackPressedCallback`，并说明 AndroidX 回调不受上述 flag 取值影响。采纳迁移建议：移除全局 opt-out，AlarmActivity 在 onCreate 注册绑定自身生命周期的 callback，提交返回时走既有 `finishWithAction("close", false)`。这会停止当前投递的服务和本地声振、撤销通知、排入 close 动作并退出界面，不写 ACK、不重排提醒；取消手势不关闭。闹钟页需消费返回完成自定义关闭流程，不承诺该页播放系统返回动画。

MainActivity 无自定义返回；核实本地锁定的 `@capacitor/app@7.1.2` 源码 `AppPlugin.java` 已以 Activity 为 owner 注册 AndroidX callback，因此不再添加竞争的返回拦截。

## 逐条处理

| 审查意见 | 处理结果与理由 |
| --- | --- |
| 预测返回 / 返回止响（阻断） | 采纳迁移方案；纠正“API 36 opt-out 失效”推断，证据见上。删除旧 onBackPressed 覆写，使用生命周期 callback。新增 4 项 JVM 测试。 |
| CI Gradle 缓存 | 采纳。setup-java 增加 `cache: gradle`，缓存键包含 Android Gradle 脚本及 Wrapper 配置；官方实现缓存 Gradle caches 及 wrapper。 |
| SDK 安装方式 / action 版本 | 采纳。核实最新稳定 release 后精确使用 `actions/setup-java@v6.1.0` 与 `android-actions/setup-android@v4.0.4`，两者均为 Node 24 action。使用原生 `packages` 安装 platform-tools、platforms;android-36、build-tools;35.0.0，默认接受许可证，删除手工 sdkmanager 步骤。SDK/Build Tools 保持本项目已验证的版本。 |
| AlarmActivity 根视图空检查 | 采纳。同时检查 content 容器及首个子视图，存在根视图才设置 Insets listener。 |
| MainActivity configChanges | 采纳。与锁定的 Capacitor CLI 7.6.9 官方 android-template.tar.gz 模板逐项比对，补齐 navigation。 |
| -Xint / SDK_INT 注入重构 | 本轮不采纳实施，按任务边界留 P2；保留现有测试执行模式与断言。 |
| minSdk<23 死代码清理 | 本轮不采纳实施，按任务边界留 P2。 |

版本与能力证据：

- [setup-android v4.0.4 发布](https://github.com/android-actions/setup-android/releases/tag/v4.0.4)及 [action.yml](https://github.com/android-actions/setup-android/blob/v4.0.4/action.yml)：packages、许可证默认值、Node 24。
- [setup-java v6.1.0 发布](https://github.com/actions/setup-java/releases/tag/v6.1.0)、[action.yml](https://github.com/actions/setup-java/blob/v6.1.0/action.yml)及[缓存实现](https://github.com/actions/setup-java/blob/v6.1.0/src/cache.ts)：Gradle 依赖与 Wrapper 缓存。

## 验证范围

新增 JVM 测试使用真实 AndroidX Dispatcher、LifecycleRegistry 和生产注册方法，验证提交返回的 close 路由、取消手势不关闭、生命周期启停/销毁；另沿真实 finishWithAction 调用链断言停止当前服务投递、本地播放器停止释放、振动取消、撤通知、仅入队 close 及 finish。系统服务以 Mockito 替身隔离。首次完整跑发现夹具未初始化 Handler，补齐替身后重跑通过。

两时区首次并行执行争用既有测试的固定临时文件 `/tmp/attention-native-missing-reconcile.js`，上海时区启动组合套件报 ENOENT；UTC 成功结束后独立重跑上海时区。未为此修改无关测试基础设施。

JVM 不模拟 Android 16 系统手势桥接及真实音频硬件；本轮未做真机/模拟器手势与三键验收。CI 配置已核实官方 action 输入，本地构建通过；远端 GitHub Actions 运行结果另行查看。

最终检查结果：

| 命令 | 结果 |
| --- | --- |
| `TZ=Asia/Shanghai npm test` | 15/15 套件通过，回归用例 736/736。 |
| `TZ=UTC npm test` | 15/15 套件通过，回归用例 736/736。 |
| `npm audit` | 退出码 0，0 vulnerabilities（未限审计等级）。 |
| `cd android && ./gradlew assembleDebug testDebugUnitTest --no-daemon` | BUILD SUCCESSFUL；app JVM 共 62 项，失败/错误/跳过均 0。 |
| `git diff --check` | 通过。 |

测试日志保存在本机 `/tmp/p1-review-npm-shanghai.log`、`/tmp/p1-review-npm-utc.log`、`/tmp/p1-review-audit.log`、`/tmp/p1-review-gradle.log`；JVM 明细见 `android/app/build/test-results/testDebugUnitTest/`。

本轮代码提交：

- `a06d3e4` fix(android): 用生命周期返回回调保障闹钟止响
- `fcc9c72` fix(android): 补齐安全边距保护与导航配置并缓存构建依赖
- `166d81a` test(android): 为返回止响真实调用链补齐平台 Handler 替身

本报告作为单独的中文文档提交；所有检查通过后普通 push 到同一分支，不修改 main、不强推。
