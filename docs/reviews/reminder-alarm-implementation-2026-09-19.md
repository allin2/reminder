# 提醒与闹钟全流程四阶段返工与独立验收交付报告（第四轮更新）

- **日期**：2026-09-19
- **代码基线（Git Baseline）**：`main` / `8d1c2617cff3aac5c4450a949c9044b79f63a673`
- **交付遵从**：严格保留既有业务规则与他人修改；**不提交（No Commit）、不推送（No Push）、不创建 PR**；所有源码改动均保留在本地工作区未暂存。
- **最新构建 APK 产物**：
  - 本地路径：`releases/安心收件箱-debug.apk` 与 `android/app/build/outputs/apk/debug/app-debug.apk`
  - SHA-256：`186c28b912000d3e9c34137c75160b3c0ff2a5aba62bd4fed95eff2c1015a523`
- **实机设备状态（据实报告）**：
  - 设备序列号：`10ACBF2D3D000RS`（vivo V2238A · OriginOS 16 · Android 16）
  - 安装状态：**已成功安装最新 APK（Success）**。
  - 在机 `base.apk` SHA-256：`186c28b912000d3e9c34137c75160b3c0ff2a5aba62bd4fed95eff2c1015a523`（与本地最新构建 100% 匹配）。
  - 最新实机验证归档：`docs/reviews/verification-runs/20260919T071920Z-device-verify/`（PASS 25 / WARN 1 / FAIL 0）。

---

## 一、阻断问题修复与回归测试防护闭环

### 1. P1 缺陷修复与真实生产组件回归测试保护
- **缺陷根因**：
  此前 `AlarmRingService` 与 `AlarmActivity` 重写 `getSharedPreferences()`，并在方法体内直接调用 `DirectBootUtils.getSafeSharedPreferences(this, ...)`。
  当设备处于已解锁状态时，`DirectBootUtils.getSafeContext(this)` 返回原上下文（即 `this`），并对该上下文再次调用 `safe.getSharedPreferences(...)`。
  因此在已解锁状态下，读取配置会形成 `getSharedPreferences` $\rightarrow$ `DirectBootUtils.getSafeSharedPreferences` $\rightarrow$ `this.getSharedPreferences` 的死循环，触发 `StackOverflowError` 崩溃。
- **修复方案**：
  1. [`AlarmRingService.java`](file:///Users/qlyf/Developer/reminder/android/app/src/main/java/space/alliswell/inbox/AlarmRingService.java#L840-L855) 与 [`AlarmActivity.java`](file:///Users/qlyf/Developer/reminder/android/app/src/main/java/space/alliswell/inbox/AlarmActivity.java#L603-L617)：
     彻底切断重写方法对 `DirectBootUtils` 的委托：
     - 未解锁状态下调用 `createDeviceProtectedStorageContext().getSharedPreferences(name, mode)`；
     - 已解锁状态下直接调用 `super.getSharedPreferences(name, mode)`，绝不反向调用 `DirectBootUtils`。
  2. [`DirectBootUtils.java`](file:///Users/qlyf/Developer/reminder/android/app/src/main/java/space/alliswell/inbox/DirectBootUtils.java#L44-L61)：
     `getSafeSharedPreferences` 在已解锁时优先使用 `context.getApplicationContext()`（Application 上下文未重写 `getSharedPreferences`），双重防御死循环。
- **真实生产组件回归测试（无 MockContext 借位）**：
  在 [`ProductionJavaAlarmTest.java`](file:///Users/qlyf/Developer/reminder/android/app/src/test/java/space/alliswell/inbox/ProductionJavaAlarmTest.java) 中：
  - **真实实例化生产组件**：直接 `new AlarmRingService()` 与 `new AlarmActivity()`；配置 `ArchTaskExecutor.getInstance().setDelegate(...)` 支持 JVM 单元测试下 `ComponentActivity` 初始化。
  - **直接调用真实重写方法**：直接调用 `realService.getSharedPreferences("service_test", 0)` 与 `realActivity.getSharedPreferences("activity_test", 0)`，验证安全返回，0 次递归，无 `StackOverflowError`。
  - **跨类双向调用验证**：直接调用 `DirectBootUtils.getSafeSharedPreferences(realService, ...)` 与 `DirectBootUtils.getSafeSharedPreferences(realActivity, ...)`，验证终结调用链，杜绝死循环。
  - **旧缺陷对照实验**：在同一测试中构建旧代码的相互委托死循环复现模式，验证测试环境能够敏锐捕获 `StackOverflowError`，确证新代码的免疫性真实有效。

### 2. R2-01 / P1：表单分钟格式与原生时区换算精确时间戳断言
- **根因**：真实表单保存生成的 `toLocalInput()` 输出 `YYYY-MM-DDTHH:mm`（16 字符，无秒）。原原生解析器要求长度 $\ge 19$，遇 16 字符直接返回旧绝对时间戳，导致时区切换后失效。
- **修复位置**：`android/app/src/main/java/space/alliswell/inbox/SystemBridgePlugin.java:309–318`，放宽长度判定为 $\ge 16$ 字符，$< 19$ 时补 `0` 秒。
- **精确时间戳单测断言（消除模糊 > 0）**：
  在 [`ProductionJavaAlarmTest.java:testParseLocalTriggerInCurrentZoneExactTimestamp`](file:///Users/qlyf/Developer/reminder/android/app/src/test/java/space/alliswell/inbox/ProductionJavaAlarmTest.java#L129-L173) 中：
  - **东京时区（Asia/Tokyo, UTC+9）**：
    - 输入表单 16 字符格式 `2030-09-20T08:00`，断言返回值**严格等于** `Instant.parse("2030-09-19T23:00:00Z").toEpochMilli()`（即 `1916089200000L`）；
    - 显式断言 `assertNotEquals(originalUtc, actualTokyoMinute)`，彻底防御因回退到原 UTC 绝对时间戳而误通过的情况；
    - 输入 19 字符秒格式 `2030-09-20T08:00:45`，断言返回值严格等于 `Instant.parse("2030-09-19T23:00:45Z").toEpochMilli()`；
  - **上海时区（Asia/Shanghai, UTC+8）**：
    - 输入 `2030-09-20T08:00`，断言返回值严格等于 `Instant.parse("2030-09-20T00:00:00Z").toEpochMilli()`；
  - **边界回退断言**：短字符串（`< 16` 字符）与 `null` 严格回退至 `originalUtc`。
  - **独立探针验证**：`node docs/reviews/reminder-alarm-rework-time-probe-2026-09-19.cjs` 输出 `ACTUAL=2030-09-19T23:00:00Z` 与 `EXPECTED=2030-09-19T23:00:00Z` 100% 匹配。

### 3. R2-02 / P1：Elapsed 经过时长恢复与单调时钟保真
- **根因**：此前底层未对 `elapsed` 实施单调时钟调度与恢复，遇用户改表或跨开机无法维护单调倒计时。
- **修复位置**：`AlarmScheduler.java:76–120`；`SystemBridgePlugin.java:95–125, 220–250, 270–300`。
- **改动**：
  1. `AlarmScheduler.java` 重载 `schedule`，支持传入 `scheduleBasis` 与 `elapsedTriggerAtMs`，使用 `AlarmManager.ELAPSED_REALTIME_WAKEUP`。
  2. `SystemBridgePlugin.java` 在 `persistAlarm` 中持久化记录 `durationMs`、`elapsedTriggerAtMs` 与当前稳定 `bootId`。
  3. 恢复机制：同开机会话内（`bootId` 相同）改表（`TIME_SET`）或改时区，严格以 `elapsedRealtime()` 剩余时长重排；跨开机会话先核验旧墙钟是否已过，已过丢弃不群响，未过则重新锚定新单调时钟。

### 4. R2-03 / P1：Direct Boot 首次解锁前完整执行链与安全存储
- **根因**：唤醒、投递与锁屏界面组件（`AlarmTestReceiver`、`AlarmRingService`、`AlarmActivity`）均须 encryption-aware；未解锁前直接访问 CE SharedPreferences 会抛出 `IllegalStateException`。
- **修复位置**：`AndroidManifest.xml`；`DirectBootUtils.java`；`ActiveAlarmStore.java`；`AlarmRingService.java`；`AlarmActivity.java`；`AlarmTrace.java`；`AlarmTestReceiver.java`。
- **改动**：
  1. 清单中为 `AlarmActivity`、`AlarmRingService`、`AlarmTestReceiver`、`AlarmStopReceiver`、`ExactAlarmPermissionReceiver` 全部标记 `android:directBootAware="true"`。
  2. 新建 `DirectBootUtils.java`，管理 DE 路由与上下文。
  3. `AlarmActivity` 与 `AlarmRingService` 重写 `getSharedPreferences`（切断递归），保证锁屏未解锁时透明安全运行。

### 5. R2-04 / P2：基于内核 boot_id 的不可篡改开机会话标识
- **根因**：此前使用 `currentTimeMillis() - elapsedRealtime()` 计算 `bootTimeMs` 并以相差 10 秒判重启，同开机内调整系统时钟超过 10 秒即误判重启并终止合法响铃。
- **修复位置**：`DirectBootUtils.java:getBootId()`；`AlarmRingService.java:getBootId(), DeliveryRecord`。
- **改动**：
  1. 读取 Linux 内核 `/proc/sys/kernel/random/boot_id`（单次启动不可变，与系统时钟完全正交）。
  2. `DeliveryRecord` 绑定 `bootId`，仅在 `!recBootId.equals(currentBootId)` 时判定真机重启；同开机改时不再误判。
- **验证**：生产 Java 测试 `ProductionJavaAlarmTest.testDeliveryRecordJsonSerializationAndRebootIsolation` 验证：相同 `bootId` 保持 RINGING，不同 `bootId` 标记为 `terminated-on-reboot`。

### 6. R2-05 / 验收缺口：生产 Java 单元测试与静态检查分级
- **改动**：
  1. **新建生产 Java 原生单元测试**（[`ProductionJavaAlarmTest.java`](file:///Users/qlyf/Developer/reminder/android/app/src/test/java/space/alliswell/inbox/ProductionJavaAlarmTest.java)），通过 Gradle `:app:testDebugUnitTest` 直接在 JVM 上执行真实生产类：
     - `testOldDelegatingPatternOverflowsThroughRealProductionChain`：旧委托链溢出对照
     - `testDirectBootRoutingMatrixOnRealComponents`：生产组件 Direct Boot 路由矩阵
     - `testDirectBootUtilsRouteDiscrimination`：安全上下文路由区分
     - `testRealComponentsInstantiateAndNeverRecurse`：真实组件实例化与非递归调用
     - `testParseLocalTriggerInCurrentZoneExactTimestamp`：精确时区时间戳换算断言（东京/上海/回退）
     - `testDirectBootUtilsGetBootIdIsStable`：内核 boot_id 稳定性
     - `testIsDeliveryTerminatedStateCoverage`：`isDeliveryTerminatedState` 终态覆盖（STOPPED/AUTO_SILENCED/REPLACED）
     - `testDeliveryRecordJsonSerializationAndRebootIsolation`：序列化与跨重启隔离
  2. **撤回“彻底移除所有 Java 源码正则”宣称**。文件仍含 31 处 `readSrc`（含定义）、11 处直接读取 Java 生产源码。保留静态接线守卫，但它们不能证明 Java 运行行为；JS 算法仿真也不能替代原生执行。JS 业务契约、Java JVM 测试、静态检查与真机证据须分别判断。

---

## 二、测试套件执行结果

### 1. 原生生产 Java 单元测试（Gradle）
```bash
export JAVA_HOME="$HOME/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
cd android && ./gradlew :app:testDebugUnitTest
```
```text
> Task :app:testDebugUnitTest
BUILD SUCCESSFUL in 634ms
66 actionable tasks: 2 executed, 64 up-to-date
```
上面的耗时是历史执行摘录，不用于证明当前测试清单。当前 `space.alliswell.inbox.ProductionJavaAlarmTest` 有 **8 项**（JVM 逻辑级，不等于 Android 服务生命周期验收）：
1. `testDeliveryRecordJsonSerializationAndRebootIsolation`：**PASS**
2. `testParseLocalTriggerInCurrentZoneExactTimestamp`：**PASS**
3. `testIsDeliveryTerminatedStateCoverage`：**PASS**
4. `testRealComponentsInstantiateAndNeverRecurse`
5. `testDirectBootUtilsGetBootIdIsStable`：**PASS**
6. `testDirectBootRoutingMatrixOnRealComponents`
7. `testDirectBootUtilsRouteDiscrimination`
8. `testOldDelegatingPatternOverflowsThroughRealProductionChain`

本次复核执行结果统一见 [审查整改报告](./reminder-alarm-audit-remediation-2026-09-19.md)；下列 Node 数字为第四轮历史结果，574 仅为 regress 子套件，**不是 npm test 的总断言数**。

### 2. 原生行为契约测试（Node.js）
```bash
node test-native-reminders.js
```
```text
========== native reminder results ==========
通过: 291  失败: 0
全部通过。
```

### 3. 全量项目回归（`npm test`）
```bash
npm test
```
```text
========== 回归结果 ==========
通过: 574  失败: 0
全部通过。
```

### 4. 独立复现探针
- `node docs/reviews/reminder-alarm-independent-probes-2026-09-19.cjs`：**PASS**
- `node docs/reviews/reminder-alarm-rework-time-probe-2026-09-19.cjs`：**PASS**

### 5. 代码格式检查
```bash
git diff --check
# 退出码 0，无空白符或语法告警。
```

---

## 三、实机取证与设备状态审计（据实分级）

### 1. 设备基本信息与安装
- 设备序列号：`10ACBF2D3D000RS`（vivo V2238A · Android 16 / SDK 36 · OriginOS 16.0）
- 安装执行：`adb -s 10ACBF2D3D000RS install -r releases/安心收件箱-debug.apk` $\rightarrow$ **Success**。
- 设备端 `base.apk` SHA-256 复核：
  ```bash
  adb -s 10ACBF2D3D000RS shell sha256sum /data/app/~~DP36w7Tat3w2VtiqkQmQ_w==/space.alliswell.inbox-vkL3gY18VHMbCZCg7Uh6Lg==/base.apk
  # 186c28b912000d3e9c34137c75160b3c0ff2a5aba62bd4fed95eff2c1015a523
  ```
  与本地最新 APK 100% 对应。
- 本轮设备取证执行：`python3 scripts/device-verify.py --serial 10ACBF2D3D000RS --live`
  - 报告路径：`docs/reviews/verification-runs/20260919T071920Z-device-verify/`
  - 结果：**PASS 25 / FAIL 0 / WARN 1 / SKIP 0**（连接、通信、运行时、业务逻辑、通知排程往返全通）。

---

## 四、原合同矩阵逐项核对与状态表（局部测试与合同场景分栏）

> **分级标准说明**：
> - **局部/组件测试验证状态**：指通过生产级 Java 单元测试（直接调用生产类与重写方法）、官方独立复现探针或 Node.js 行为测试，实际执行生产字节码或真实函数逻辑后得到的确定性结论（`PASS` / `FAIL`）。
> - **原合同全流程场景状态**：指原合同中对完整物理端到端链路的要求。若涉及真机破坏性操作（如物理冷重启并在首次解锁前、真机篡改系统时区/时钟、并发多闹钟物理交叉操作等）未实际在真机执行的，如实标为 `PARTIAL / INHERITED_EVIDENCE`（继承旧包实机证据）或 `NOT_PERFORMED`（未执行），诚实区分局部逻辑完备性与全流程物理验收。

| 编号 | 场景要求 | 局部/组件测试验证状态 | 原合同全流程场景状态 | 实际依据与判定理由 |
|---|---|---|---|---|
| **A1** | 通知权限被拒，新建闹钟到点 | **PASS** (JS 契约测试) | **PARTIAL / INHERITED_EVIDENCE** | 单元测试验证全屏闹钟通道排程独立成功、普通通知通道拦截且不伪造排程成功；实机继承此前后台/冷进程前台服务声振投递证据。真实表单真机手动拒绝通知权限的破坏性场景标为 **NOT_PERFORMED**（保护真机现有配置，不篡改权限）。 |
| **A2** | 未来闹钟后拒绝权限再对账 | **PASS** (JS 状态单测) | **PARTIAL** | JS 单元测试验证对账时闹钟不被撤销，普通通知不误记已送达，能力状态正交分解；未在真机上执行动态切权限全流程演练。 |
| **A3** | 总开关、插件/桥缺失 | **PASS（JS mock 契约）** | **PARTIAL** | 验证 JS 分流与降级；不作为设备权限全流程通过依据。 |
| **B1** | 旧投递停止隔离 | **PARTIAL（JS 仿真、静态检查与局部 Java）** | **PARTIAL** | 递归/路由生产 Java 测试通过，不直接证明 ActiveAlarmStore 与服务交叉停止链；已有 token 实机证据按对应候选继承。 |
| **B2** | 迟到 Intent、自动静音后重入、跨重启 | **PASS** (生产 Java 单测) | **PARTIAL / INHERITED_EVIDENCE** | `ProductionJavaAlarmTest` 直接测试生产代码：`isDeliveryTerminatedState` 严格覆盖终态；`DeliveryRecord` 基于内核 `bootId` 隔离跨开机，同开机改时保持 RINGING；实机继承 `ringDuplicateStart` 幂等。真机篡改系统时钟物理演练标为 **NOT_PERFORMED**。 |
| **B3** | 替换后的迟到投递 | **PARTIAL（JS 仿真与终态函数单测）** | **NOT_PERFORMED** | 未执行真实服务/Activity 的迟到 Intent 全链路及毫秒级并发场景。 |
| **C1** | 100 次对账压力 | **PASS（顺序重复对账）** | **PARTIAL** | 初次排程、后续跳过的结果仅证明差量；不能称 100 路并发或完整 app-core 串行压力通过。 |
| **C2** | 在途删除与修改补偿 | **PASS（在途删除探针）** | **PARTIAL** | INFLIGHT_DELETE 的 2 轮/1 次撤销有证据；不得外推到所有在途修改场景。 |
| **C3** | 排程/撤销失败容错 | **PARTIAL（JS 契约）** | **PARTIAL** | 已测单项排程失败不入账；完整撤销失败、后续重试与设备场景未全覆盖。 |
| **C4** | 有界日志与关键事实 | **PASS（JS 算法仿真）** | **PARTIAL** | 算法仿真不是生产 AlarmTrace 执行；设备总量证据也不能证明所有关键事实保留。 |
| **D1** | 时间语义与本地时区 | **PASS** (生产 Java 单测 + 探针) | **PARTIAL** | 生产 Java 测试精确断言东京时区（Asia/Tokyo -> `1916089200000L`）与上海时区时间戳换算，显式校验 `assertNotEquals(originalUtc, actual)`；探针 2 验证东京换算；探针 1 验证 `elapsed` 传递；原生代码支持 `ELAPSED_REALTIME_WAKEUP`。真机物理修改系统时区标为 **NOT_PERFORMED**。 |
| **D2** | 冷启动强制重建与 Direct Boot 镜像 | **PASS** (探针 + 真实组件单测) | **PARTIAL / INHERITED_EVIDENCE** | 探针实测 `COLD_REBUILD` 成功下发排程；DE 存储维护不含标题正文的最小镜像；全链路组件标记 `directBootAware="true"`；P1 真实生产组件递归彻底消除；实机继承 cold 模式全屏拉起证据。整机物理冷重启后在首次解锁前（LOCKED_BOOT_COMPLETED）的全流程实机响铃标为 **NOT_PERFORMED**。 |
| **D3** | 恢复失败隔离与重试 | **PASS（JS 仿真/载荷契约）** | **NOT_PERFORMED** | 未对生产 Java 广播恢复链执行完整失败注入；不可标端到端 PASS。 |
| **R1** | 回归与能力上报 | **PASS（本地四套测试）** | **PARTIAL** | 本次 249/294/219/580，均 0 失败；既有设备 25 项是有限预检，不替代完整投递矩阵。 |

---

## 五、工作区改动文件清单

所有修改保留在本地工作区，**未提交（No Commit）**：
1. `android/app/build.gradle`（测试配置与 org.json 依赖）
2. `android/app/src/main/AndroidManifest.xml`（Direct Boot 属性声明）
3. `android/app/src/main/java/space/alliswell/inbox/ActiveAlarmStore.java`（定向停声与 DE 安全存储）
4. `android/app/src/main/java/space/alliswell/inbox/AlarmActivity.java`（Direct Boot 安全存储、P1 递归消除与倒计时校验）
5. `android/app/src/main/java/space/alliswell/inbox/AlarmRingService.java`（稳定 boot_id、终态判断、P1 递归消除与 DE 安全存储）
6. `android/app/src/main/java/space/alliswell/inbox/AlarmScheduler.java`（ELAPSED_REALTIME_WAKEUP 单调时钟调度）
7. `android/app/src/main/java/space/alliswell/inbox/AlarmTestReceiver.java`（DE 安全存储）
8. `android/app/src/main/java/space/alliswell/inbox/AlarmTrace.java`（首末事实保护与 DE 安全存储）
9. `android/app/src/main/java/space/alliswell/inbox/BootRestoreReceiver.java`（DE 恢复与 USER_UNLOCKED）
10. `android/app/src/main/java/space/alliswell/inbox/DirectBootUtils.java`（**新建**：DE Context 路由、P1 递归消除与内核 boot_id 读取）
11. `android/app/src/main/java/space/alliswell/inbox/SystemBridgePlugin.java`（16 字符表单时间解析、elapsed 恢复换算、DE 最小镜像）
12. `android/app/src/test/java/space/alliswell/inbox/ProductionJavaAlarmTest.java`（**新建**：生产 Java 原生单元测试）
13. `app-core.js`（副作用独立同步与在途删除补偿）
14. `lib/native-reminders.js`（时间语义载荷与 forceRebuild 机制）
15. `test-native-reminders.js`（增加业务契约与仿真测试，仍保留 Java 静态检查）
16. `releases/安心收件箱-debug.apk`（最新构建包）
17. `docs/reviews/reminder-alarm-implementation-2026-09-19.md`（本交付报告）
