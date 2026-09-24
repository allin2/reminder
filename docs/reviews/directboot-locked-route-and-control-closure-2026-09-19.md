---
doc: review
status: delivered
date: 2026-09-19
topic: 两条遗留缺口的闭环（Direct Boot 锁定路由真实覆盖 + 旧缺陷真实对照组）
scope: 仅测试代码与测试依赖；生产源码零改动
related:
  - docs/reviews/reminder-alarm-rework-fourth-round-independent-recheck-2026-09-19.md
  - docs/decisions/proposal-rework-round4-verification-fixes-2026-09-19.md
---

# Direct Boot 锁定路由 + 旧缺陷对照组 · 闭环验证

- **输入裁决**：第四轮复核确认两条遗留项 —— ①Direct Boot 测试未真正测试锁定路由；②旧缺陷对照不成立（自递归 + 手动抛）。
  同时关闭「时间断言不足」与「原递归源码缺陷」。
- **本轮动作**：改测试、改测试依赖；**生产源码零改动**（逐字节校验）。
- **结论**：两条均已闭环，且**经反向自检证明有牙齿**（拆掉修复 → 3/8 变红）。

---

## 一、根因：不是断言写法问题，是 harness 把门禁抹平了

上一轮锁定路由测试之所以不成立，根因在**单元测试运行时用的 jar**，而不是测试怎么写：

| 事实 | 实测证据 |
|---|---|
| `Build.VERSION.SDK_INT` 在单测里恒为 **0** | 探针输出 `SDK_INT=0`；mockable jar（`unitTests.returnDefaultValues = true`）抹掉了 `Build$VERSION.<clinit>` |
| 该字段 `public static final`，**普通反射写不了** | `IllegalAccessException: Can not set static final int field android.os.Build$VERSION.SDK_INT to (int)34` |
| `sun.misc.Unsafe` **可以写** | `unsafe_write=OK now=34` |
| `UserManager` 非 final、`isUserUnlocked()` 非 final | `javap` 实测 ⇒ 可被 Mockito 子类桩 |
| Mockito / Robolectric 是否在 classpath | **都不在**；mockito-core 5.2.0 与 byte-buddy 1.14.1、objenesis 3.3 在 Gradle 缓存中，可离线解析 |

**推论**：`DirectBootUtils.getSafeSharedPreferences` 与两个组件覆写里的 `if (SDK_INT >= 24)` 块，在默认 harness 下**整块不可达**；
上一轮那条测试实际断言的是 `SDK_INT=0` 时的**回退路径**，与「DE 路由」不可区分。这正是裁决书的原话。

---

## 二、缺口 1 的闭环：真实生产组件上的路由矩阵

被测方法 = 生产类的 `getSharedPreferences` **未改动实现**。替身只补三条**平台缝**
（`isDeviceProtectedStorage()` / `createDeviceProtectedStorageContext()` / `getSystemService()`），
已核对 `AlarmRingService`、`AlarmActivity` **自身都没有覆写**这三者。

对 **`AlarmRingService` 与 `AlarmActivity` 各跑一遍五用例矩阵**：

| # | 条件 | 期望 | 为何必要 |
|---|---|---|---|
| 1 | SDK 34 + 未解锁 + DE 可用 | 返回 **DE 句柄**；`createDeviceProtectedStorageContext` 恰好 1 次；DE 哨兵收到原始 `name/mode` | **直接闭合裁决项 ①** |
| 2 | SDK 34 + **已解锁** | 回落 CE；**绝不创建/读取 DE** | 数据完整性方向（此前完全未覆盖；若恒定读 DE，解锁后会静默读错盘） |
| 3 | SDK 34 + 无法判定（UM=null） | 回落；不创建 DE | 旧实现在此条件下**必递归** ⇒ 也是对照组的判别点 |
| 4 | SDK 34 + 自身已是 DE 上下文 | 直接 `super`，不重路由 | 防「无脑再包一层 DE」 |
| 5 | SDK **23** | 整块跳过 | 证明门禁真实存在（并解释默认 harness 为何不可达） |

**「可区分」是这样被证明的**：DE 路径返回**哨兵 A**，回退路径在 harness 下返回 `null`，
两者以 identity 断言区分；并且 DE 哨兵**记录被读的 `name/mode`**、非 DE 用例断言该记录**为空**。
单看「返回了 mock」无法区分路径 —— 这是上一轮的病灶，现已消除。

另有一条 `testDirectBootUtilsRouteDiscrimination`：在**同一对象**上同时暴露 DE 与 CE 两条可区分路径，
覆盖 未解锁→DE / 已解锁→CE / 无法判定→CE / null→null / SDK23→CE 五态。
**未解锁 → 切 DE（`DirectBootUtils` L51–55）首次有了自动化覆盖。**

---

## 三、缺口 2 的闭环：真实对照组

旧缺陷形态（已从源码确认）= 组件覆写体里**委托** `DirectBootUtils.getSafeSharedPreferences(this, …)`，
而该方法末尾又会回调 `context.getSharedPreferences(…)` ⇒ **相互委托死循环**。
修复形态 = 内联逻辑 + 调 `super`。

对照组用 `AlarmRingService` 的**同一个子类**、只把「委托」那一行还原：
真实溢出（**不手动抛任何异常**），并断言**栈帧真的穿过** `DirectBootUtils.getSafeSharedPreferences`
与组件的 `getSharedPreferences` 覆写；再用同输入断言**已修复组件安全终结**。

### 反向自检（本条的牙齿）

把 `AlarmRingService.getSharedPreferences` 临时改回委托实现，`--rerun-tasks` 后：

```
tests=8 failures=3
  [RED] testOldDelegatingPatternOverflowsThroughRealProductionChain   → StackOverflowError
  [RED] testDirectBootRoutingMatrixOnRealComponents                    → StackOverflowError
  [RED] testRealComponentsInstantiateAndNeverRecurse                   → StackOverflowError
```

红栈逐帧可读，证明走的是**真实相互委托**，且**锁定分支确被驱动**：

```
at AlarmRingService.getSharedPreferences(AlarmRingService.java:843)      ← 委托行
at DirectBootUtils.getSafeSharedPreferences(DirectBootUtils.java:59)     ← 回调 getSharedPreferences
at AlarmRingService.getSharedPreferences(AlarmRingService.java:843)
...
at DirectBootUtils.getSafeSharedPreferences(DirectBootUtils.java:51)     ← 未解锁判定行（评审称"零覆盖"的那条）
```

随后从备份还原，`AlarmRingService.java` SHA-256 与**本轮开始时逐字节一致**
（`edc1346184fdbd95d258c26cfc6b2038eb61ab975ab0d433d67906c401ac21d5`），绕行标记 grep 计数 = 0。

---

## 四、可复算证据

```bash
export JAVA_HOME="$HOME/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
cd android

# 1) 逐用例结果（不是只看 BUILD SUCCESSFUL）
./gradlew :app:testDebugUnitTest --offline --rerun-tasks
python3 -c "import glob,xml.etree.ElementTree as ET;[print(t.get('name'),t.get('tests'),t.get('failures'),t.get('errors')) for t in (ET.parse(p).getroot() for p in glob.glob('app/build/test-results/testDebugUnitTest/TEST-space*.xml'))]"
# → ProductionJavaAlarmTest tests=8 failures=0 errors=0
#   8 个用例：testOldDelegatingPatternOverflowsThroughRealProductionChain /
#             testDirectBootRoutingMatrixOnRealComponents /
#             testDirectBootUtilsRouteDiscrimination /
#             testRealComponentsInstantiateAndNeverRecurse /
#             testParseLocalTriggerInCurrentZoneExactTimestamp /
#             testDeliveryRecordJsonSerializationAndRebootIsolation /
#             testIsDeliveryTerminatedStateCoverage / testDirectBootUtilsGetBootIdIsStable

# 2) 主构建未被测试依赖变更破坏（实测 packageDebug UP-TO-DATE ⇒ 打包产物未变）
./gradlew :app:assembleDebug --offline

# 3) 生产源码零改动
shasum -a 256 app/src/main/java/space/alliswell/inbox/AlarmRingService.java
# → edc1346184fdbd95d258c26cfc6b2038eb61ab975ab0d433d67906c401ac21d5
```

**改动面（净）**

| 文件 | 改动 |
|---|---|
| `android/app/src/test/java/space/alliswell/inbox/ProductionJavaAlarmTest.java` | 重写：新增真实对照组 + 五用例路由矩阵 + 四态判别；删除恒真自递归断言 |
| `android/app/build.gradle` | +1 行 `testImplementation "org.mockito:mockito-core:$mockitoVersion"` |
| `android/variables.gradle` | +`mockitoVersion = '5.2.0'`（含离线可解析说明） |

生产源码、设备、APK 产物**均未改动**；`AlarmRingService` 内的临时反向自检改动已逐字节还原。

---

## 五、仍不能声称的（诚实边界，勿外推）

1. **真机物理 Direct Boot 仍未演练**：整机冷重启后、**首次解锁前**（`LOCKED_BOOT_COMPLETED`）真的响铃/读 DE，
   依旧是 **NOT_PERFORMED**。本轮是**分支级**覆盖，不是**设备级**证明。
2. **`SDK_INT` 由 `Unsafe` 直接写入、`UserManager` 由 Mockito 桩**：满足的是门禁条件，
   不是「真实系统服务返回的真实状态」。若日后希望走受支持路径，正解是引入 **Robolectric**
   （`@Config(sdk=34)` + `ShadowUserManager`）—— 当前不在 classpath，且需联网拉 `android-all`。
3. **`Unsafe` 依赖 JDK 内部 API**：现测通于 Temurin 17；换 JDK 版本需重跑本报告 §四 命令确认。
4. **`AlarmActivity` 与 `AlarmRingService` 的路由逻辑是两处独立复制**（未抽公共方法）。
   两处现都有矩阵覆盖，但**未来改一处漏另一处**的风险仍在 —— 属于待裁决的结构问题，本轮未动。
5. 上一轮复核的**第 6 条（`test-native-reminders.js` 中 Java 源码正则一条没少）本轮未处理**，
   仍在 `docs/decisions/proposal-rework-round4-verification-fixes-2026-09-19.md` 条 3 项下待裁决。
