# 20260920 独立返工复验

报告：`../../user-experience-three-priorities-independent-recheck-20260920.md`。
从仓库根运行；脚本只读生产源码，写本证据目录。使用原有 VM/存储 harness，不操作真实用户数据或设备。再次运行会更新本目录结果，需保留本轮证据时应先复制至同层新 run 目录。

| 文件 | 复现与判读 |
|---|---|
| probes.cjs / probe-results.json / probe-run.log | `node <本目录>/probes.cjs`；原失败探针副本，退出 0 仅表示跑完，结论看每条 actual |
| extended-probes.cjs / extended-results.json / extended-run.log | `node <本目录>/extended-probes.cjs`；仅在内存中给 harness 暴露 sandbox，不改源码。当前退出 1，X1/X2/X4 失败，X3 通过；异常退出 2 不算有效反例 |
| sw-probe.cjs / sw-result.json | `node <本目录>/sw-probe.cjs`；真实 SW install/fetch + 内存缓存/离线网络模拟，不等于浏览器实测 |
| npm-test.log | `npm test > <新证据目录>/npm-test.log 2>&1`；本轮退出 0，1517/1517 |
| android-unit.log | 在 android 下执行 `JAVA_HOME=/Users/qlyf/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home ./gradlew :app:testDebugUnitTest --offline --rerun-tasks`；本轮退出 0，66 tasks 执行 |
| verify-artifacts.py / artifacts.json | `python3 <本目录>/verify-artifacts.py`；只读 ZIP，比对源码并记录 SHA 与最新 Android XML 汇总；应先跑 Android 单测。本轮 22/22 |

X1 时间安排：旧首次为 now−1 分钟、旧追提醒 now+29 分钟、新稍后 now+5 分钟；生产对账保留 cancelled 旧键，模拟到旧追提醒时刻读入旧版本回执。此为旧回执隔离反例，不是实际等候 29 分钟的设备投递记录。
X2 网络仅受控 Promise，fixture.invalid 不发实际网络请求、无真实凭据。
X4 模拟原生桥读取异常，只取消未来测试的 mock 计划；真实铃声停止 NOT_PERFORMED。
