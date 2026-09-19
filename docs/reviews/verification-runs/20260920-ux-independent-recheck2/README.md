# 第二次返工独立复验证据

报告：`../../user-experience-three-priorities-independent-recheck2-20260920.md`。
脚本从本目录层级解析仓库根，只读生产代码，写本证据目录；不操作真实用户数据或设备。重跑应复制到同层新 run 目录，以保留本次冻结结果。

| 入口/输出 | 复现及判读 |
|---|---|
| probes.cjs / probe-results.json / probe-run.log | `node <目录>/probes.cjs`；原失败场景，退出 0 表示完成，结果须逐条判读 |
| extended-probes.cjs / extended-results.json / extended-run.log | `node <目录>/extended-probes.cjs`；上一轮 X1–X4 原探针副本，本轮全部通过，退出 0 |
| transition-probes.cjs / transition-results.json / transition-run.log | `node <目录>/transition-probes.cjs`；Y1/Y2/Y3 当前均失败，退出 1；脚本异常为 2。Y1 经过生产编辑保存改到过去时间，Y2 模拟升级前台账及未来旧回执，Y3 真实新表单会话配合受控存储提交 |
| sw-probe.cjs / sw-result.json / sw-run.log | `node <目录>/sw-probe.cjs`；真实 SW 处理器、内存缓存、离线网络模拟 |
| sw-boundaries.cjs / sw-boundaries.json | `node <目录>/sw-boundaries.cjs`；缺脚本 504、导航回落 HTML 断言；非 GUI |
| npm-test.log | 根目录 `npm test` 重定向到新日志；1572 通过，退出 0 |
| android-unit.log | android 下 `JAVA_HOME=/Users/qlyf/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home ./gradlew :app:testDebugUnitTest --offline --rerun-tasks`；22/22，退出 0 |
| artifact-audit.py / artifact-results.json | `python3 <目录>/artifact-audit.py`；核对旧 identity 清单、两轮两种 APK 的实际条目内容及当前源码，记录最新 Android XML；先跑 Android 测试 |

源码变异自检、构建、安装、设备、GUI：本轮均未执行。旧 run 目录未覆盖。
