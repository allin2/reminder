# Y1 / Y2 / Y3 修复验证证据

Run ID：`20260920T011417-ux-y123-fix`  
交付候选：`releases/candidates/20260920T014002-ux-y123-fix/`  
源码基线：`/Users/qlyf/Developer/reminder` 的未提交工作区，HEAD `8d1c2617cff3aac5c4450a949c9044b79f63a673`

## 结论

- Y1：`scheduled -> delivered` 保留 `roundBase`，编辑换轮和重启后旧历史不再证明当前轮。
- Y2：缺失 `roundBase` 的旧 `scheduled/cancelled/delivered` 默认不可验证；仅 `0@triggerAt`
  精确首期键或当前原生对账再次登记同键时允许可证明迁移。
- Y3：新建/编辑的成功与失败收尾同时绑定表单会话和草稿签名；同会话重复提交仍去重，
  新会话同内容允许独立提交。
- `npm test`：330 + 321 + 226 + 715 = **1592 / 1592 PASS**。
- Android JDK 17 JVM 单测：**22 / 22 PASS**；Debug + Release：**BUILD SUCCESSFUL**。
- 最终两个 APK 的 13 个 Web 文件与工作区逐字节一致；与上一候选相比，ZIP 条目集合
  均为 508，差异仅为 `app-core.js`、`lib/delivery-evidence.js` 和签名元数据。
- 未做安装、设备回读或真机投递观察，设备级结论为 `NOT_PERFORMED`。

## 证据索引

| 文件 | 用途 / 结果 |
| --- | --- |
| `baseline-hashes.json` | 开工基线源码与上一候选身份 |
| `final-hashes.json` | 最终源码、测试、候选与证据哈希 |
| `task-delta.patch` | 相对源工作区仅 4 个任务文件的补丁 |
| `npm-test.log` | 1592 / 1592 |
| `transition-probes.cjs` / `transition-results.json` | Y1/Y2/Y3 生产入口探针，3 / 3 |
| `probes.cjs` / `probe-results.json` | 原审计基础探针复跑 |
| `extended-probes.cjs` / `extended-results.json` | X1-X4 扩展探针，均 `pass: true` |
| `sw-probe.cjs` / `sw-result.json` | SW 脚本缓存边界复跑 |
| `sw-boundaries.cjs` / `sw-boundaries.json` | 缺失脚本 504、导航回落 HTML，`pass: true` |
| `reverse-y1.log` | 移除 Y1 修复后 4 条失败 |
| `reverse-y2.log` | 恢复“缺身份即猜当前轮”后 6 条失败 |
| `reverse-y3.log` | 移除会话守卫后 Y3 探针 `pass: false` |
| `android-unit-jdk17.log` | Temurin 17，22 / 22，66 tasks executed |
| `android-assemble-jdk17.log` | Temurin 17，260 tasks executed，Debug + Release |
| `apk-web-assets.txt` | 最终两包内 13 个 Web 文件逐字节一致 |
| `candidate-entry-diff-jdk17.txt` | 条目集合一致、无非预期差异 |
| `apksigner-verify-jdk17.log` | Release v1/v2/v3 签名验证通过 |

## 主要命令

```text
npm test
node docs/reviews/verification-runs/20260920T011417-ux-y123-fix/probes.cjs
node docs/reviews/verification-runs/20260920T011417-ux-y123-fix/extended-probes.cjs
node docs/reviews/verification-runs/20260920T011417-ux-y123-fix/transition-probes.cjs
node docs/reviews/verification-runs/20260920T011417-ux-y123-fix/sw-probe.cjs
node docs/reviews/verification-runs/20260920T011417-ux-y123-fix/sw-boundaries.cjs
JAVA_HOME=/Users/qlyf/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home ./gradlew --offline --rerun-tasks :app:testDebugUnitTest
JAVA_HOME=/Users/qlyf/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home ./gradlew --offline --rerun-tasks :app:assembleDebug :app:assembleRelease
python3 docs/reviews/verification-runs/20260920T011417-ux-y123-fix/compare-candidate-entries.py
```

## 构建路径与拒收候选

没有运行会先批量删除生成目录的 `npx cap sync android`。本轮采用只覆盖、不删除的安全路径：

1. `npm run sync:www`；
2. 把 `www/` 覆盖到 Android `assets/public/`；
3. 从源工作区逐字节补齐已有的 Capacitor 生成资产，并用既有 write-only 恢复脚本重建插件工程；
4. JDK 17 运行 Gradle；
5. zipalign、签名、包内资源比对、上一候选条目比对。

为遵守候选不可覆盖原则，三次中间构建均保留且明确拒收：

- `20260920T011417-ux-y123-fix/`：缺 Capacitor 生成资产；
- `20260920T013229-ux-y123-fix/`：仍缺 `res/xml/config.xml`；
- `20260920T013650-ux-y123-fix/`：完整但使用默认 JDK 24，合成类与既有 JDK 17 工具链漂移。

只有 `20260920T014002-ux-y123-fix/` 是本报告接受的 JDK 17 候选。

## 诊断记录

- 默认 Java 24 下，Android 单测曾为 21 / 22，失败点是
  `ProductionJavaAlarmTest.testDirectBootUtilsRouteDiscrimination`；`-Xint` 可通过，说明存在
  JIT/测试桩敏感性。改回项目目标 JDK 17 后，不加 `-Xint` 即 22 / 22。
- Java 24 构建与旧候选的差异集中在 javac 合成 lambda/枚举类；JDK 17 重建后，非 Web、
  非签名条目全部恢复一致。
- `android-unit.log`、`android-unit-rerun.log`、`android-unit-final.log` 等失败日志被保留，
  分别记录缺生成插件工程、缺 `local.properties`、缺依赖目录等预检问题；它们不是最终 PASS。

## 保护边界

- 未提交、未推送、未改 HEAD。
- 未覆盖 `/Users/qlyf/Developer/reminder` 的源码或根目录 APK。
- 未覆盖任何历史候选或历史证据；失败候选同样冻结保留。
- 未安装 APK、未清设备数据、未改设备设置、未执行真机验收。
