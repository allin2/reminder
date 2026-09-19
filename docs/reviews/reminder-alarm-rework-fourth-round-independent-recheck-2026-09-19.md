# 第四轮返工报告 · 独立复核（只读）

- **日期**：2026-09-19
- **复核对象**：`docs/reviews/reminder-alarm-implementation-2026-09-19.md`（第四轮更新）
- **复核方式**：只读。重跑全部测试与探针、读编译产物字节码、读 APK 清单、独立读取设备在机包哈希。
- **本次未修改任何项目代码**；`git status` 维持返工会话原样（未提交、未推送）。
- **复核基线**：`HEAD = origin/main = 8d1c2617cff3aac5c4450a949c9044b79f63a673`（`ahead/behind = 0/0`）。
- **后续更新（同日）**：§三 第 **4、5** 条已**闭环**（新增真实对照组 + 五用例 Direct Boot 路由矩阵，并经反向自检证明有牙齿）——
  见 `docs/reviews/directboot-locked-route-and-control-closure-2026-09-19.md`。第 **6** 条（Java 源码正则一条没少）**仍未处理**，待裁决。

---

## 一、复核结论

| # | 报告声称 | 复核结论 |
|---|---|---|
| 1 | `AlarmRingService`/`AlarmActivity` 的 `getSharedPreferences` 递归已切断 | ✅ **成立**（字节码证据） |
| 2 | 时间解析单测改为精确 Epoch 断言 | ✅ **成立**（生产代码与断言一致） |
| 3 | 交付报告分「局部测试 / 合同场景」两栏 | ✅ **成立** |
| 4 | 「旧缺陷对照实验」验证测试环境能捕获 SOE | ❌ **不成立：断言恒真** |
| 5 | `testRealComponentsLockedDirectBootStorageRouting` 验证 Direct Boot DE 路由 | ❌ **不成立：名不副实，该分支零覆盖** |
| 6 | 「彻底移除 `test-native-reminders.js` 中所有 Java 源码正则匹配」 | ❌ **不成立：一条没少（31 → 31）** |

---

## 二、成立项的证据

### 1. 递归确已切断（读编译产物，非读源码）

```bash
export JAVA_HOME="$HOME/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
$JAVA_HOME/bin/javap -c -p -cp android/app/build/intermediates/javac/debug/classes \
  space.alliswell.inbox.AlarmRingService   # 与 ...AlarmActivity
```

两个覆写的 DE 分支与回退分支**都调 `super`**：

- `AlarmRingService.getSharedPreferences` → `invokespecial android/app/Service.getSharedPreferences`（DE 分支 L18、回退 L66）
- `AlarmActivity.getSharedPreferences` → `invokespecial androidx/appcompat/app/AppCompatActivity.getSharedPreferences`

不存在任何指回 `DirectBootUtils` 的 `invoke`。`DirectBootUtils` 只在**外部**上下文（`de` / `getApplicationContext()`）上调用 `getSharedPreferences`。

**可检测性推演**：若覆写被改回委托 `DirectBootUtils`，两分支（`SDK_INT >= 24` 与 `< 24`）都会在 `getApplicationContext() == null` 时把 `target` 落回组件自身 → 无限递归 → `StackOverflowError` → 测试变红。**该正命题是有效回归护栏。**

### 2. 时间解析

生产代码 `SystemBridgePlugin.java:388-404`（报告写 `309–318`，**行号引用有误**）：

- `localTrigger == null || length() < 16` → 回退 `fallback`（满足断言）
- `sec = (length() >= 19) ? substring(17,19) : 0`
- `Calendar.getInstance(TimeZone.getDefault())` → 真实本地区换算

断言用 `Instant.parse(...).toEpochMilli()` 精确值，且用 `assertNotEquals(originalUtc, actualTokyoMinute)` 防「回退误通过」。合格。

### 3. 实测水位（本次亲跑）

| 项 | 结果 |
|---|---|
| `cd android && ./gradlew :app:testDebugUnitTest --rerun-tasks` | **BUILD SUCCESSFUL**；`tests="6" failures="0" errors="0"` |
| `node test-native-reminders.js` | **291 / 0** |
| `npm test` | **574 / 0** |
| `node docs/reviews/reminder-alarm-rework-time-probe-2026-09-19.cjs` | exit 0，`ACTUAL=2030-09-19T23:00:00Z` = `EXPECTED`（真端到端：JS `toLocalInput` → payload → jshell 调真实 Java 方法，`TZ=Asia/Tokyo`） |
| `node docs/reviews/reminder-alarm-independent-probes-2026-09-19.cjs` | exit 0，`TIME_BASIS` / `COLD_REBUILD` / `INFLIGHT_DELETE` 全通过 |
| `releases/安心收件箱-debug.apk` SHA-256 | `186c28b912000d3e9c34137c75160b3c0ff2a5aba62bd4fed95eff2c1015a523` |
| **设备端** `base.apk` SHA-256（`10ACBF2D3D000RS`，独立读取） | `186c28b9…15a523` — **一致** |
| APK 清单 `directBootAware`（`aapt2 dump xmltree`） | 5 个组件（`AlarmActivity`/`AlarmRingService`/`AlarmTestReceiver`/`AlarmStopReceiver`/`ExactAlarmPermissionReceiver`）= `true` |
| 基础提交 `8d1c2617…` | 存在，且 = `HEAD` = `origin/main` |

---

## 三、不成立项的证据

### 4. 「旧缺陷对照实验」是恒真断言 —— 零对照能力

`ProductionJavaAlarmTest.java:104-110`：

```java
private void reproduceOldBuggyRecursion(int depth) {
  if (depth > 20000) {
    throw new StackOverflowError("Simulated recursion depth limit reached");
  }
  // 旧代码逻辑：getSharedPreferences -> getSafeSharedPreferences -> getSharedPreferences ...
  reproduceOldBuggyRecursion(depth + 1);
}
```

该方法**不调用 `getSharedPreferences`，也不调用 `DirectBootUtils.getSafeSharedPreferences`**，与注释所写的委托链毫无关系；它只是在一个恒为真的递归里**手动抛出** `StackOverflowError`。

实测同一 JDK 下的天然溢出点（`/tmp` 探针，行为与该方法逐行一致）：

```
java Depth.java            → NATIVE_OVERFLOW_at_depth=20001   # 天然溢出晚于手动 throw ⇒ 手动 throw 先触发
java -Xss512k Depth.java   → NATIVE_OVERFLOW_at_depth=4143
java -Xss256k Depth.java   → NATIVE_OVERFLOW_at_depth=1247
```

⇒ `assertTrue(oldPatternRecursed)` **在默认栈下必然通过**（由手动 throw 触发），在更小栈下也通过（由天然溢出触发）。无论哪种情形都与「测试环境能否捕获真实递归」无关。

**报告 §1 第 36 行称其「验证测试环境能够敏锐捕获 `StackOverflowError`，确证新代码的免疫性真实有效」= 过度声明。**

> 对照组的正确判据：必须真的走被怀疑的调用链，且**拔掉修复后要变红**。（参 `scripts/verification/storage-degrade-probe.js` 的 `reverse-check-d59.js` 做法。）

### 5. `testRealComponentsLockedDirectBootStorageRouting` 名不副实

`ProductionJavaAlarmTest.java:116-157`：

- **不碰 `AlarmRingService` / `AlarmActivity`**（与方法名与 javadoc「验证真实的 AlarmRingService 与 AlarmActivity 在未解锁状态下自动透明路由至 DE 存储」矛盾）。
- 构造的 `baseContext`（内嵌「未解锁 `UserManager` 代理」，用于驱动 `DirectBootUtils` L51–55）**从未被使用**；测试只在 `deContext` 上断言（L152、L155）。
- 被断言的 `deContext` **自己就把 `getSharedPreferences` 覆写成返回 `mockDeSp`**（L123）⇒ 无论走「DE 早返回（L47-48）」还是「回退路径（L58-59）」，返回值都相同 ⇒ **该断言无法区分两条路径**。
- 因此 `DirectBootUtils` L51–55「`!isUserUnlocked()` → `createDeviceProtectedStorageContext()`」分支在**所有自动化测试中零覆盖**。
- 两处 `attachBaseContext` 反射准备（test1 L61、test2 L148）均为死代码；`attachBase` 取到后未使用。

### 6. 「彻底移除所有 Java 源码正则匹配」为假

```bash
git show HEAD:test-native-reminders.js | grep -cE "readSrc|readSrc2"   # 31
grep -cE "readSrc|readSrc2" test-native-reminders.js                    # 31
git diff -U0 -- test-native-reminders.js | grep -E "^[-+].*(readSrc|\.java)" | wc -l   # 0
```

`readSrc/readSrc2` 调用数 **HEAD = 工作区 = 31**，diff 中删除的 Java 源码断言行 **0**。仍存在形如
`/recordFallbackCarrier/.test(jCode(readSrc("…/AlarmActivity.java")))`（L1335）、
`/AlarmRingService\.requestStop\(context\)/.test(readSrc("…/ActiveAlarmStore.java"))`（L1341）等**源码级正则断言**。

报告 §1/§6 第 85 行「**彻底移除** `test-native-reminders.js` 中**所有** Java 源码正则匹配」与事实不符。
这与项目既有红线直接冲突：**源码级断言无法反向验证**（D48 实测 `if (x===false)` → `if (false && x===false)`，正则照样命中）。

---

## 四、建议（不代做，待裁决）

1. **把对照实验改成真对照组**：让 `reproduceOldBuggyRecursion` 真的调用组件覆写（例如在测试内建一个把 `getSharedPreferences` 委托给 `DirectBootUtils` 的 `ContextWrapper`），使其在缺少 `super` 修复时必然溢出。
2. **补 `DirectBootUtils` L51–55 的覆盖**：给 `baseContext` 加「`getApplicationContext()` 返回自身且 `getSharedPreferences` 抛 `AssertionError`」的哨兵，再用它驱动 `getSafeSharedPreferences(baseContext, …)`，断言拿到的是 `mockDeSp`（证明走的是 DE 路由而非回退）。
3. **报告措辞纠正**：删掉或改写第 4/5/6 三条声称；`SystemBridgePlugin` 的修复行号改为 `388–404`。
4. **Java 源码正则**：要么真移除并用行为级/字节码级断言替代，要么在报告中如实记为「未处理」。

### 补充事实：单测 harness 里 `Build.VERSION.SDK_INT == 0`

从单元测试真实运行时 jar 读出（`japav -c -p`）：`Build$VERSION.<clinit>` 为空（所有 `putstatic` 被剥掉），
且字段声明为 `final`（Java 17 下不可反射改写）。

⟹ 两个后果，修正本报告 §三.5 的措辞并加强其结论：

- `DirectBootUtils.getSafeSharedPreferences` 的 `if (SDK_INT >= 24)` 整块（**L46–L57，含 L51–L55**）
  以及两个生产覆写的 DE 分支，在单元测试中**根本不会被执行**，与测试怎么写无关。
- 现有 `testRealComponentsLockedDirectBootStorageRouting` 的 `assertSame(mockDeSp, …)` 实际是走
  **L58 回退路径**（`deContext.getApplicationContext()` 被覆写成返回自身）拿到的，**与 DE 路由毫无关系**。
  即便把那个从未被使用的 `baseContext` 接上去也没用——它用 `java.lang.reflect.Proxy` 假装 `UserManager`，
  而 L50 会把它 cast 成 `android.os.UserManager`（类，非接口）⇒ 一旦真走到就 `ClassCastException`。

具体改法见配套提案 `docs/decisions/proposal-rework-round4-verification-fixes-2026-09-19.md`。

