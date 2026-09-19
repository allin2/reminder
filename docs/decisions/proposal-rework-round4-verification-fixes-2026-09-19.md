---
doc: proposal
status: proposed
date: 2026-09-19
topic: 第四轮返工报告三条不成立项的具体改法
companion: docs/reviews/reminder-alarm-rework-fourth-round-independent-recheck-2026-09-19.md
note: 提案不等于决议。**未获产品所有人裁决前，本项目一行代码不改。**
status_update: 条 1、条 2 已实施（**未采用本提案的"产品缝"路线，改为纯测试侧方案，生产源码零改动**），
  闭环证据见 `docs/reviews/directboot-locked-route-and-control-closure-2026-09-19.md`；
  条 2c 选项 A/B 已由「Mockito 桩 UserManager + Unsafe 写 SDK_INT」取代，两个覆写类的结构未动。
  条 3 于本次用户“检查上述结论是否正确，并修复相关问题”授权后纠正文案、清单与证据分级；保留静态守卫，不宣称全部正则已删除。
---

# 提案：修复第四轮返工的三条不成立项

对应 `docs/reviews/reminder-alarm-rework-fourth-round-independent-recheck-2026-09-19.md` 的 §三（第 4/5/6 条）。
每条给：**根因 → 具体改法（可直接落地的代码）→ 验收判据 → 风险**。

---

## 零、先确认一个决定设计的事实：单测 harness 里 `SDK_INT == 0`

这不是推测，是从单元测试真实运行时用的 jar 里读出来的：

```bash
J=/Users/qlyf/.gradle/caches/transforms-3/b9062f62cadf3d0cfea89e3e269ba13d/transformed/android.jar   # 3.78 MB，return-defaults 变体
$JAVA_HOME/bin/javap -c -p -cp "$J" 'android.os.Build$VERSION' | awk '/static \{\};/,0'
#   static {};
#     Code:
#        0: return          ← 空的 <clinit>，所有 putstatic 都被剥掉
$JAVA_HOME/bin/javap -p -cp "$J" 'android.os.Build$VERSION' | grep SDK_INT
#   public static final int SDK_INT;    ← 声明仍是 final
```

同一 jar 里其他相关方法体（`japav -c -p android.content.ContextWrapper`）：

| 方法 | 行为 |
|---|---|
| `getSharedPreferences(String,int)` | `aconst_null; areturn`（返回 null，与现有 `assertNull` 通过一致） |
| `getApplicationContext()` | 返回 null |
| `isDeviceProtectedStorage()` | 返回 `false` |
| `getSystemService(String)` | 返回 null |
| `createDeviceProtectedStorageContext()` | 返回 null |

**两个后果，全文设计都建立在这上面：**

1. **`Build.VERSION.SDK_INT == 0`** ⇒ `DirectBootUtils.getSafeSharedPreferences` 的整个 `if (SDK_INT >= 24) { … }` 块（**L46–L57，含 L51–L55 未解锁→DE 分支**）以及两个生产覆写的 DE 分支，**在单元测试中根本不会被执行**，无论测试怎么写。
2. 字段声明为 `final` 且初值来自空 `<clinit>` ⇒ Java 17 下 `Field.set` 会抛 `IllegalAccessException` ⇒ **「用反射把 SDK_INT 改成 34」这条路走不通**，不要在这上面浪费时间。

> 顺带：这也解释了现有 `testRealComponentsLockedDirectBootStorageRouting` 为什么「看起来通过」——它的 `assertSame(mockDeSp, …)` 是走 **L58 回退路径**（`deContext.getApplicationContext()` 被覆写成返回自身）拿到的，与 DE 路由无关。

**结论：要让 L51–55 真正被覆盖，必须在生产代码上开一个接缝**（条 2）。这是本提案唯一需要动生产代码的地方，且是行为等价重构。

---

## 条 1：把「对照实验」改成真对照组

### 根因

`ProductionJavaAlarmTest.java:104-110` 的 `reproduceOldBuggyRecursion` **不调用任何被委托方法**，只在 `depth>20000` 时手动 `throw new StackOverflowError`：

```java
private void reproduceOldBuggyRecursion(int depth) {
  if (depth > 20000) { throw new StackOverflowError("Simulated recursion depth limit reached"); }
  reproduceOldBuggyRecursion(depth + 1);
}
```

实测天然溢出点：默认栈 **20001 帧**、`-Xss512k` **4143 帧**、`-Xss256k` **1247 帧** ⇒ 手动 throw 先于/等于天然溢出触发 ⇒ `assertTrue(oldPatternRecursed)` **恒真**。

### 改法

**① 删掉 `reproduceOldBuggyRecursion`（L93-110 整段）**，替换为下列内容。

**② 对照组：同签名、同委托对象，只差「那一行」**

```java
  /**
   * 对照组：复刻被修复掉的那一行 —— 覆写内直接委托 DirectBootUtils。
   * 与真实 AlarmRingService 只差 `super.getSharedPreferences` ↔ `DirectBootUtils.getSafeSharedPreferences(this,…)`。
   */
  private static final class OldBuggyAlarmRingService extends AlarmRingService {
    @Override public SharedPreferences getSharedPreferences(String name, int mode) {
      return DirectBootUtils.getSafeSharedPreferences(this, name, mode);
    }
  }

  /**
   * 对照组断言：把修复行「拔掉」必须变红。
   * 走的是真实生产类 + 真实 DirectBootUtils，不是自搭递归。
   */
  @Test
  public void testControlGroupOldDelegationMustOverflow() throws Exception {
    final Throwable[] captured = new Throwable[1];
    // 小栈（256 KB）⇒ 确定性、毫秒级，不依赖测试 worker 的默认栈
    Thread t = new Thread(null, () -> {
      try {
        new OldBuggyAlarmRingService().getSharedPreferences("control", 0);
      } catch (StackOverflowError e) {
        captured[0] = e;
      }
    }, "old-delegation-control", 256 * 1024);
    t.start();
    t.join(10_000);

    assertNotNull("对照组未溢出 ⇒ 本测试发现不了递归回归，正命题随之失效", captured[0]);
    assertTrue("栈帧必须穿过 DirectBootUtils.getSafeSharedPreferences",
        walkedThrough(captured[0], "space.alliswell.inbox.DirectBootUtils", "getSafeSharedPreferences"));
    assertTrue("栈帧必须回到组件自身的覆写方法",
        walkedThrough(captured[0], "space.alliswell.inbox.AlarmRingService", "getSharedPreferences"));
  }

  private static boolean walkedThrough(Throwable t, String cls, String method) {
    for (StackTraceElement el : t.getStackTrace()) {
      if (cls.equals(el.getClassName()) && method.equals(el.getMethodName())) return true;
    }
    return false;
  }
```

### 为什么它真的会溢出（用实测值推演，不是猜测）

`OldBuggyAlarmRingService.getSharedPreferences` → `DirectBootUtils.getSafeSharedPreferences(this,…)`，因 `SDK_INT == 0` 跳过 24 块 → L58 `getApplicationContext()`（mockable jar 返回 null）⇒ `target = this` → `this.getSharedPreferences` → 回到覆写 → **无限递归**。

两条栈帧断言因此都能成立（`DirectBootUtils` 帧出现在最前若干个，远在 JVM 默认 1024 帧截断之内）。

> 若担心 `extends AlarmRingService` 在 JVM 下脆弱，备选是把上一节那个匿名 `ContextWrapper` 作为被委托对象——但那样就丢掉了「同一个类、只差一行」的紧密度，**优先用子类版**。

### 验收判据（关键）

| 步骤 | 期望 |
|---|---|
| 现状运行 | `testControlGroupOldDelegationMustOverflow` **PASS**，且两条栈帧断言都成立 |
| **反向自检**：把 `AlarmRingService.getSharedPreferences` 的 `return super.getSharedPreferences(...)`（L854）改回 `return DirectBootUtils.getSafeSharedPreferences(this, name, mode)` | `testRealComponentsUnlockedGetSharedPreferencesRecursionImmunity` **必须变红**；反之对照组不受影响 |
| 复原 | 测试重新全绿 |

第二条是「拔掉修复要变红」的硬证据——**改完必须真跑一次再复原**，并把两次结果记进报告。

### 风险

低。纯测试改动，不碰生产代码；新增线程有 10 秒 join 上限，不会挂死构建。

---

## 条 2：让 `DirectBootUtils` L51–55 真正可测

### 根因

三件事叠加，导致 L51–55 零覆盖：

1. `SDK_INT == 0` ⇒ 整块不可达（§零）；
2. 现有 `testRealComponentsLockedDirectBootStorageRouting` **不碰** `AlarmRingService`/`AlarmActivity`；
3. 它构造的 `baseContext`（含「未解锁 UserManager 代理」）**从未被使用**，且这个代理是 `java.lang.reflect.Proxy`，而 `DirectBootUtils` L50 会把它 **cast 成 `android.os.UserManager`（类，不是接口）→ 一旦真的走到就会 `ClassCastException`**。

⇒ 用 Proxy 假装 `UserManager` 这条路是**死路**，接缝里不能再依赖 `getSystemService`。

### 改法（2a｜生产代码行为等价重构，**必做**）

`DirectBootUtils.java` 把「平台判定」与「路由决策」拆开，路由决策改成接缝：

```java
  /**
   * 安全获取 SharedPreferences：未解锁时读写 DE 存储，已解锁后读写标准 CE 存储。
   */
  static SharedPreferences getSafeSharedPreferences(Context context, String name, int mode) {
    return getSafeSharedPreferences(context, name, mode, queryUserUnlocked(context));
  }

  /** 返回 null 表示平台层无法/无需判定（API < 24），等价于「不做 DE 路由」。 */
  private static Boolean queryUserUnlocked(Context context) {
    if (context == null || Build.VERSION.SDK_INT < 24) return null;
    UserManager um = (UserManager) context.getSystemService(Context.USER_SERVICE);
    return um == null ? null : um.isUserUnlocked();
  }

  /**
   * 可测接缝：userUnlocked 显式传入。
   * null  ⇒ 不做 DE 路由（等价于 API < 24 或 UserManager 不可用）
   * false ⇒ 未解锁，路由到 DE
   * true  ⇒ 已解锁，走 CE
   */
  static SharedPreferences getSafeSharedPreferences(Context context, String name, int mode, Boolean userUnlocked) {
    if (context == null) return null;
    if (userUnlocked != null) {
      if (context.isDeviceProtectedStorage()) {
        return context.getSharedPreferences(name, mode);
      }
      if (!userUnlocked) {
        Context de = context.createDeviceProtectedStorageContext();
        if (de != null) {
          return de.getSharedPreferences(name, mode);
        }
      }
    }
    Context target = context.getApplicationContext() != null ? context.getApplicationContext() : context;
    return target.getSharedPreferences(name, mode);
  }
```

**语义等价性对照**（须在提案评审时逐条核）：

| 原逻辑 | 新逻辑 | 等价？ |
|---|---|---|
| `SDK_INT < 24` → 不做 DE 路由 | `queryUserUnlocked` 返回 null → `userUnlocked == null` → 不做 DE 路由 | ✅ |
| `um == null` → 不做 DE 路由 | 返回 null → 同上 | ✅ |
| `um != null && !um.isUserUnlocked()` → `createDeviceProtectedStorageContext()` 非空则用 DE | `userUnlocked == false && de != null` → 用 DE | ✅ |
| `context.isDeviceProtectedStorage()` 优先早返回 | 同 | ✅ |
| 兜底 `getApplicationContext() ?: context` | 同 | ✅ |

> 落地后**必须**给 `javap -c -p -cp android/app/build/intermediates/javac/debug/classes space.alliswell.inbox.DirectBootUtils` 前后两版做对照，确认只有「参数来源」变化、分支结构不变。

同样处理 `getSafeContext(Context)`（L30–39）与 `isUserUnlocked(Context)`（L17–24）——它们有一模一样的 `SDK_INT >= 24` 结构，同样不可测。

### 改法（2b｜测试：用真哨兵区分两条路）

**删除** `testRealComponentsLockedDirectBootStorageRouting`，替换为：

```java
  /**
   * 未解锁用户必须路由到 DE 存储，且不得落回 CE 回退路径。
   * 经 Boolean 接缝注入「未解锁」，绕开单测里 SDK_INT == 0 与不可 Proxy 化的 UserManager。
   */
  @Test
  public void testLockedUserRoutesToDeviceProtectedStorage() {
    final SharedPreferences dePrefs = new MockSharedPreferences("de");
    final SharedPreferences cePrefs = new MockSharedPreferences("ce");
    final boolean[] ceFallbackTouched = { false };

    final Context deContext = new ContextWrapper(null) {
      @Override public boolean isDeviceProtectedStorage() { return true; }
      @Override public SharedPreferences getSharedPreferences(String n, int m) { return dePrefs; }
    };

    final Context lockedCe = new ContextWrapper(null) {
      @Override public boolean isDeviceProtectedStorage() { return false; }
      @Override public Context createDeviceProtectedStorageContext() { return deContext; }
      @Override public Context getApplicationContext() { return this; }   // 回退路径会落到这里
      @Override public SharedPreferences getSharedPreferences(String n, int m) {
        ceFallbackTouched[0] = true;    // 哨兵：回退路径一旦被走到就点灯
        return cePrefs;
      }
    };

    SharedPreferences got = DirectBootUtils.getSafeSharedPreferences(lockedCe, "x", 0, Boolean.FALSE);

    assertSame("未解锁必须路由到 DE 存储", dePrefs, got);
    assertFalse("不得落回 CE 回退路径（哨兵被触发即本用例无效）", ceFallbackTouched[0]);
  }

  /** 已解锁时必须走 CE，不得误入 DE。 */
  @Test
  public void testUnlockedUserStaysOnCeStorage() {
    /* 同构：userUnlocked = Boolean.TRUE，断言拿到的 cePrefs 且 de 侧哨兵未触发 */
  }

  /** userUnlocked == null（≈ API < 24）时保持旧行为：不做 DE 路由。 */
  @Test
  public void testNullUnlockedFallsBackToPlatformDefault() {
    /* 同构：userUnlocked = null，断言落到 getApplicationContext() 的 CE 路径 */
  }
```

**三条用例合起来才构成「能区分路径」的证明**——只有正例没有反例，就又回到「mock 把两条路覆盖成同一返回值」的老问题。

### 改法（2c｜可选，需单独裁决）

即便做完 2a/2b，**两个组件覆写（`AlarmRingService` L841-855、`AlarmActivity` L604-618）自己的 DE 分支在单测里仍然不可达**（它们的判断直接读 `SDK_INT`，我没给它们开接缝）。两条路：

- **A：不动**。承认这两段只由真机 `LOCKED_BOOT_COMPLETED` 演练背书，报告如实记 `NOT_PERFORMED` + 同源替代证据。**符合项目既有的诚实分级习惯，成本最低。**
- **B：改成复用接缝**，顺势消掉三处重复逻辑：

```java
  @Override
  public android.content.SharedPreferences getSharedPreferences(String name, int mode) {
    return DirectBootUtils.getSafeSharedPreferences(
        this, name, mode, DirectBootUtils.queryUserUnlocked(this), super::getSharedPreferences);
  }
```
  接缝再加一个 `Function<String, SharedPreferences>`-风格的 `fallback` 参数（`super::getSharedPreferences` 在 Java 中合法），这样**修复行「必须调 super」就被结构锁死**，想改回递归都改不了——比现在的「靠约定」硬得多。
  代价：触及两个已交付的热点类，`git diff` 变大，需要重跑全套 + 真机复验一次。

**我的推荐：2a + 2b 立刻做；2c 选 A**（先把「能测的测到、测不到的如实说」做到位），2c-B 留给下一轮。

### 验收判据

| 项 | 期望 |
|---|---|
| Gradle 单测 | 用例数由 6 → 8 或 9，全绿 |
| `DirectBootUtils` 行覆盖 | L51–55 首次被真实执行（可用 `--info` 或在断言里挂计数器佐证） |
| 反向自检 | 把 L52 的 `createDeviceProtectedStorageContext()` 换成返回 `context` ⇒ `testLockedUserRoutesToDeviceProtectedStorage` **必须变红** |
| 回归 | `node test-native-reminders.js` 291/0、`npm test` 574/0 不倒退 |

---

## 条 3：报告措辞与行号纠正

对 `docs/reviews/reminder-alarm-implementation-2026-09-19.md` 的**逐处替换**（只改字，不动结论）：

**(1) §1 第 36 行**（「旧缺陷对照实验：在同一测试中构建旧代码的相互委托死循环复现模式…」）→ 替换为：

> - **旧缺陷对照实验（真对照组）**：`OldBuggyAlarmRingService` 复刻被修复掉的那一行（覆写内直接委托 `DirectBootUtils.getSafeSharedPreferences(this, …)`），在 256 KB 栈线程上断言其必抛 `StackOverflowError`，并断言栈帧确实穿过 `DirectBootUtils.getSafeSharedPreferences` 与 `AlarmRingService.getSharedPreferences`。该对照组证明：**一旦把修复行改回去，正命题立刻变红**。
>   （上一版此处是一条恒真断言——手动 `throw`，不调用任何被委托方法——详见复核报告 §三.4。）

**(2) §1 第 80 行**（`testRealComponentsLockedDirectBootStorageRouting`：Direct Boot DE 存储路由）→ 替换为：

> - `testLockedUserRoutesToDeviceProtectedStorage` / `testUnlockedUserStaysOnCeStorage` / `testNullUnlockedFallsBackToPlatformDefault`：经 `DirectBootUtils.getSafeSharedPreferences(…, Boolean)` 接缝分别验证「未解锁→DE」「已解锁→CE」「无法判定→平台默认」，CE 回退路径挂哨兵，被走到即失败
>   （原 `testRealComponentsLockedDirectBootStorageRouting` **已删除**：不触达生产组件、`baseContext` 未被使用、断言对象自身覆写了 `getSharedPreferences` 而无法区分两条路径。）

**(3) §1 第 85 行 + §6**（「彻底移除 `test-native-reminders.js` 中所有 Java 源码正则匹配」）→ 替换为：

> 2. `test-native-reminders.js` 的 **Java 源码正则断言本轮未处理**（`readSrc/readSrc2` 调用数 HEAD = 31、工作区 = 31，diff 删除 0 行），已登记为遗留项。原因：源码级断言无法反向验证（D48 实测 `if (x===false)` → `if (false && x===false)` 正则照样命中），替换需先确定行为级/字节码级替代方案。

**(4) §2 第 40 行**：`SystemBridgePlugin.java:309–318` → **`SystemBridgePlugin.java:388-404`**；§2 内引用处同步。

**(5) §4 表格 D2 行「实际依据」列**追加一句：

> ⚠️ 未解锁态**组件覆写**的 DE 分支在单元测试中**不可达**（harness `Build.VERSION.SDK_INT == 0`，且字段 `final` 无法反射改写）；DE 路由证据来自 `DirectBootUtils` 接缝测试 + 真机，`LOCKED_BOOT_COMPLETED` 全流程仍为 `NOT_PERFORMED`。

**(6) §2 之后新增一节**，避免下一个人再被同一件事骗一次：

> ## 二·补：本轮单元测试环境的两个硬事实
> 1. `Build.VERSION.SDK_INT == 0`（mockable jar 的 `Build$VERSION.<clinit>` 为空，所有 `putstatic` 被剥掉）。
>    ⟹ 任何 `if (SDK_INT >= 24)` 分支在单测中**都不可达**，不要用单测给这类分支背书。
> 2. `Build.VERSION.SDK_INT` 声明为 `final` ⟹ Java 17 下不可反射改写。
>    ⟹ 想覆盖版本分支，只有「在生产代码上开接缝」一条路。
>    判定命令：`javap -c -p -cp ~/.gradle/caches/transforms-3/b9062f62…/transformed/android.jar 'android.os.Build$VERSION'`

---

## 四、建议的执行顺序

1. **条 3**（纯文档，零风险，先把记录改对，避免错误结论继续被引用）
2. **条 1**（纯测试，含一次反向自检 + 复原）
3. **条 2a + 2b**（一处行为等价重构 + 用例替换，含反向自检）
4. 全量回归：`cd android && ./gradlew :app:testDebugUnitTest`、`node test-native-reminders.js`、`npm test`，并与本文档的验收判据逐条对齐
5. 真机复验（`scripts/device-verify.py --serial 10ACBF2D3D000RS --live`）+ 重新出包 + 复核 APK 哈希（设备侧 `sha256sum $(pm path …)`）

**任何一步都不提交、不推送**（见项目「提交与推送」约定）。
