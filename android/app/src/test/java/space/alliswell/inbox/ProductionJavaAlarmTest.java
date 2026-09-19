package space.alliswell.inbox;

import static org.junit.Assert.*;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.UserManager;
import androidx.arch.core.executor.ArchTaskExecutor;
import androidx.arch.core.executor.TaskExecutor;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.TimeZone;
import java.util.function.Supplier;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/**
 * 生产级 Java 原生单元测试：Direct Boot 路由、递归阻断、时间解析、投递记录。
 *
 * <p>本轮（第四轮返工复核后）修补两处「测试名不副实」：
 * <ol>
 *   <li>Direct Boot <b>锁定</b>路由此前从未被真正驱动 —— 见
 *       {@link #testDirectBootRoutingMatrixOnRealComponents()}。</li>
 *   <li>旧缺陷对照组此前是<b>恒真断言</b>（自递归 + 手动抛 StackOverflowError，与被怀疑的调用链无关）——
 *       见 {@link #testOldDelegatingPatternOverflowsThroughRealProductionChain()}。</li>
 * </ol>
 *
 * <p><b>harness 硬事实（实测，勿再凭猜测）：</b>
 * <ul>
 *   <li>单元测试 classpath 用的是 mockable android.jar（{@code unitTests.returnDefaultValues = true}），
 *       其中 {@code Build.VERSION.SDK_INT} 的 {@code <clinit>} 被抹平 ⇒ 恒为 <b>0</b>。</li>
 *   <li>该字段声明为 {@code public static final} ⇒ 普通反射写不了
 *       （实测 {@code IllegalAccessException: Can not set static final int field}），
 *       只能用 {@code sun.misc.Unsafe} 写入。本类只在测试内改写，并在 {@code @After} 恢复原值。</li>
 *   <li>⟹ 生产代码里所有 {@code if (Build.VERSION.SDK_INT >= 24) ...} 分支在默认情况下<b>不可达</b>。
 *       这才是上一轮「锁定路由」测试无法成立的根因，而不是断言写法问题。
 *       Robolectric 未在本工程 classpath 上，故采用 Unsafe 直接满足门禁。</li>
 * </ul>
 *
 * <p><b>测试替身的边界（诚实声明）：</b> §{@link PlatformSeams} 只补
 * {@code isDeviceProtectedStorage()} / {@code createDeviceProtectedStorageContext()} /
 * {@code getSystemService()} 三条<b>平台缝</b>（JVM 里这三个 API 全部返回 mockable 默认值）。
 * 已核对 {@code AlarmRingService} 与 {@code AlarmActivity} <b>自身都没有覆写</b>这三个方法，
 * 因此被测的 {@code getSharedPreferences} 是生产类<b>未改动</b>的实现。
 */
public class ProductionJavaAlarmTest {

  private int harnessSdkInt;

  @Before
  public void setUp() {
    harnessSdkInt = Build.VERSION.SDK_INT;
    ArchTaskExecutor.getInstance().setDelegate(new TaskExecutor() {
      @Override public void executeOnDiskIO(Runnable runnable) { runnable.run(); }
      @Override public void postToMainThread(Runnable runnable) { runnable.run(); }
      @Override public boolean isMainThread() { return true; }
    });
  }

  @After
  public void tearDown() {
    try {
      setSdkInt(harnessSdkInt);
    } catch (Throwable ignored) {
      // 恢复失败不应掩盖真正的断言结果，但会在下一轮检查中出现
    }
    ArchTaskExecutor.getInstance().setDelegate(null);
  }

  // ---------------------------------------------------------------- 缺口 2

  /**
   * 缺口 2 修复：<b>真实对照实验</b>。
   *
   * <p>旧缺陷形态 = 组件覆写体里委托 {@code DirectBootUtils.getSafeSharedPreferences(this, ...)}，
   * 而该方法末尾又会回调 {@code context.getSharedPreferences(...)} ⇒ 相互委托死循环。
   * 这里用 {@code AlarmRingService} 的<b>同一个子类</b>、只把「委托」那一行还原，
   * 走的是<b>真实委托链</b>，不手动抛任何异常。
   *
   * <p><b>反向自检（本测试的牙齿）</b>：把
   * {@code AlarmRingService.getSharedPreferences} 改回委托实现 ⇒ 本测试必须变红。
   */
  @Test
  public void testOldDelegatingPatternOverflowsThroughRealProductionChain() {
    OldDelegatingAlarmRingService buggy = new OldDelegatingAlarmRingService();

    StackOverflowError soe = null;
    try {
      buggy.getSharedPreferences("old_buggy_case", 0);
    } catch (StackOverflowError e) {
      soe = e;
    }

    assertNotNull(
        "修复前的委托实现必须真实抛出 StackOverflowError（由真实调用链自然溢出，不是断言方手动抛出）",
        soe);
    assertTrue(
        "栈帧必须穿过真实被怀疑的生产方法 DirectBootUtils.getSafeSharedPreferences",
        frameSeen(soe, "DirectBootUtils", "getSafeSharedPreferences"));
    assertTrue(
        "栈帧必须穿过组件的 getSharedPreferences 覆写",
        frameSeen(soe, "OldDelegatingAlarmRingService", "getSharedPreferences"));

    // 同输入下，已修复的真实生产组件必须安全终结且不溢出、不递归。
    AlarmRingService fixed = new AlarmRingService();
    assertNull(
        "已修复组件在完全相同输入下必须安全终结（mockable 下 super 返回 null）",
        fixed.getSharedPreferences("old_buggy_case", 0));
  }

  /** 旧缺陷形态的精确复现：同一个生产类，只把「委托 DirectBootUtils」那一行还原。 */
  static class OldDelegatingAlarmRingService extends AlarmRingService {
    @Override
    public SharedPreferences getSharedPreferences(String name, int mode) {
      // 修复前的实现长这样：组件 -> DirectBootUtils -> 组件 -> ... 相互委托
      return DirectBootUtils.getSafeSharedPreferences(this, name, mode);
    }
  }

  // ---------------------------------------------------------------- 缺口 1

  /**
   * 缺口 1 修复：<b>真实生产组件上的 Direct Boot 路由矩阵</b>。
   *
   * <p>五个用例合起来才构成「能区分 DE 路由与回退路径」的证明：
   * <ol>
   *   <li>SDK 34 + 未解锁 ⇒ 必须落到 DE 上下文（且 DE 上下文确实收到原始 name/mode）；</li>
   *   <li>SDK 34 + 已解锁 ⇒ 必须回落 CE，绝不创建 DE 上下文（数据完整性方向）；</li>
   *   <li>SDK 34 + 无法判定（UserManager 为 null）⇒ 回落；</li>
   *   <li>SDK 34 + 自身已是 DE 上下文 ⇒ 直接 super，不重路由；</li>
   *   <li>SDK 23 ⇒ 整个门禁块被跳过 ⇒ 回落（顺带证明门禁真实存在）。</li>
   * </ol>
   * 对 {@code AlarmRingService} 与 {@code AlarmActivity} 各跑一遍完整矩阵。
   */
  @Test
  public void testDirectBootRoutingMatrixOnRealComponents() throws Exception {
    runRoutingMatrix("AlarmRingService", RoutingServiceDouble::new);
    runRoutingMatrix("AlarmActivity", RoutingActivityDouble::new);
  }

  private void runRoutingMatrix(String who, Supplier<PlatformSeams> factory) throws Exception {
    final SharedPreferences dePrefs = new MockSharedPreferences("de_prefs");

    int prev = setSdkInt(34);
    try {
      // 用例 1：锁定期 ⇒ 必须路由到 DE，且证明走的是 DE 而不是回退。
      {
        PlatformSeams s = factory.get();
        DeviceProtectedSentinel de = new DeviceProtectedSentinel(dePrefs);
        s.setAlreadyDeviceProtected(false);
        s.setDeviceProtectedContext(de);
        s.setUserManager(lockedUserManager());

        SharedPreferences got = ((Context) s).getSharedPreferences("locked_case", 0);

        assertSame(who + "：未解锁时必须返回 DE 存储句柄（而非回退）", dePrefs, got);
        assertNotNull(who + "：未解锁时返回值不得为回退路径结果（harness 下 super 为 null）", got);
        assertEquals(who + "：未解锁时必须恰好创建一次 DE 上下文",
            1, s.createdDeviceProtectedCount());
        assertEquals(who + "：DE 上下文必须收到原始 name/mode",
            Arrays.asList("locked_case/0"), de.reads);
      }

      // 用例 2：已解锁 ⇒ 必须回落 CE，绝不碰 DE（这条是数据完整性方向）。
      {
        PlatformSeams s = factory.get();
        DeviceProtectedSentinel de = new DeviceProtectedSentinel(dePrefs);
        s.setAlreadyDeviceProtected(false);
        s.setDeviceProtectedContext(de);
        s.setUserManager(unlockedUserManager());

        SharedPreferences got = ((Context) s).getSharedPreferences("unlocked_case", 0);

        assertNotSame(who + "：已解锁绝不能拿到 DE 句柄", dePrefs, got);
        assertTrue(who + "：已解锁后 DE 上下文不得被读取", de.reads.isEmpty());
        assertEquals(who + "：已解锁后不得创建 DE 上下文",
            0, s.createdDeviceProtectedCount());
      }

      // 用例 3：无法判定（UserManager 为 null）⇒ 回落，且绝不递归。
      {
        PlatformSeams s = factory.get();
        DeviceProtectedSentinel de = new DeviceProtectedSentinel(dePrefs);
        s.setAlreadyDeviceProtected(false);
        s.setDeviceProtectedContext(de);
        s.setUserManager(null);

        SharedPreferences got = ((Context) s).getSharedPreferences("indeterminate_case", 0);

        assertNotSame(who + "：无法判定时不得拿到 DE 句柄", dePrefs, got);
        assertTrue(who + "：无法判定时 DE 上下文不得被读取", de.reads.isEmpty());
        assertEquals(who + "：无法判定时不得创建 DE 上下文",
            0, s.createdDeviceProtectedCount());
      }

      // 用例 4：自身已是 DE 上下文 ⇒ 直接 super，不重路由。
      {
        PlatformSeams s = factory.get();
        DeviceProtectedSentinel de = new DeviceProtectedSentinel(dePrefs);
        s.setAlreadyDeviceProtected(true);
        s.setDeviceProtectedContext(de);
        s.setUserManager(lockedUserManager());

        ((Context) s).getSharedPreferences("already_de_case", 0);

        assertTrue(who + "：已处于 DE 上下文时不得重路由到另一个 DE 上下文", de.reads.isEmpty());
        assertEquals(who + "：已处于 DE 上下文时不得创建 DE 上下文",
            0, s.createdDeviceProtectedCount());
      }
    } finally {
      setSdkInt(prev);
    }

    // 用例 5：SDK 23 ⇒ 门禁块整体跳过（也解释了 harness 默认 SDK_INT=0 时该分支为何不可达）。
    {
      int p2 = setSdkInt(23);
      try {
        PlatformSeams s = factory.get();
        DeviceProtectedSentinel de = new DeviceProtectedSentinel(dePrefs);
        s.setAlreadyDeviceProtected(false);
        s.setDeviceProtectedContext(de);
        s.setUserManager(lockedUserManager());

        ((Context) s).getSharedPreferences("low_sdk_case", 0);

        assertTrue(who + "：SDK<24 时 DE 路由必须整体关闭", de.reads.isEmpty());
        assertEquals(who + "：SDK<24 时不得创建 DE 上下文",
            0, s.createdDeviceProtectedCount());
      } finally {
        setSdkInt(p2);
      }
    }
  }

  /**
   * {@code DirectBootUtils} 自身四态可区分：DE 句柄与 CE 句柄用 identity 区分，不是「都返回同一个 mock」。
   */
  @Test
  public void testDirectBootUtilsRouteDiscrimination() throws Exception {
    final SharedPreferences dePrefs = new MockSharedPreferences("de_prefs");
    final SharedPreferences cePrefs = new MockSharedPreferences("ce_prefs");

    int prev = setSdkInt(34);
    try {
      // 未解锁 ⇒ DE
      DualSentinelContext locked = new DualSentinelContext(dePrefs, cePrefs);
      locked.setUserManager(lockedUserManager());
      assertSame("未解锁时 DirectBootUtils 必须给出 DE 句柄",
          dePrefs, DirectBootUtils.getSafeSharedPreferences(locked, "k_locked", 0));
      assertEquals("DE 路径必须只读 DE", 1, locked.de.reads.size());
      assertTrue("DE 路径不得读 CE", locked.ce.reads.isEmpty());

      // 已解锁 ⇒ CE
      DualSentinelContext unlocked = new DualSentinelContext(dePrefs, cePrefs);
      unlocked.setUserManager(unlockedUserManager());
      assertSame("已解锁时 DirectBootUtils 必须给出 CE 句柄",
          cePrefs, DirectBootUtils.getSafeSharedPreferences(unlocked, "k_unlocked", 0));
      assertTrue("CE 路径不得读 DE", unlocked.de.reads.isEmpty());

      // 无法判定 ⇒ CE（回退）
      DualSentinelContext unknown = new DualSentinelContext(dePrefs, cePrefs);
      unknown.setUserManager(null);
      assertSame("无法判定时 DirectBootUtils 必须回退 CE",
          cePrefs, DirectBootUtils.getSafeSharedPreferences(unknown, "k_unknown", 0));
      assertTrue("回退路径不得读 DE", unknown.de.reads.isEmpty());

      // null 上下文 ⇒ null
      assertNull("null 上下文必须返回 null", DirectBootUtils.getSafeSharedPreferences(null, "k", 0));
    } finally {
      setSdkInt(prev);
    }

    // SDK 23 ⇒ 门禁关闭，直接回退 CE
    int p2 = setSdkInt(23);
    try {
      DualSentinelContext low = new DualSentinelContext(dePrefs, cePrefs);
      low.setUserManager(lockedUserManager());
      assertSame("SDK<24 时 DirectBootUtils 必须回退 CE",
          cePrefs, DirectBootUtils.getSafeSharedPreferences(low, "k_low", 0));
      assertTrue("SDK<24 时不得读 DE", low.de.reads.isEmpty());
    } finally {
      setSdkInt(p2);
    }
  }

  /**
   * 真实生产组件实例化后，直接调用与经 {@code DirectBootUtils} 调用都必须安全终结（无递归）。
   * 本用例不再声称覆盖「已解锁/锁定路由」—— 那由 {@link #testDirectBootRoutingMatrixOnRealComponents()} 负责。
   */
  @Test
  public void testRealComponentsInstantiateAndNeverRecurse() {
    AlarmRingService realService = new AlarmRingService();
    AlarmActivity realActivity = new AlarmActivity();

    assertNotNull("AlarmRingService 必须可实例化", realService);
    assertNotNull("AlarmActivity 必须可实例化", realActivity);

    assertNull("AlarmRingService 直接调用必须安全终止（mockable 下 super 返回 null）",
        realService.getSharedPreferences("service_test", 0));
    assertNull("AlarmRingService 经 DirectBootUtils 调用必须安全终止",
        DirectBootUtils.getSafeSharedPreferences(realService, "service_test", 0));
    assertNull("AlarmActivity 直接调用必须安全终止",
        realActivity.getSharedPreferences("activity_test", 0));
    assertNull("AlarmActivity 经 DirectBootUtils 调用必须安全终止",
        DirectBootUtils.getSafeSharedPreferences(realActivity, "activity_test", 0));
  }

  // ---------------------------------------------------------------- 测试替身与工具

  /**
   * 只补平台缝的测试替身契约。已核对两个生产类自身都没有覆写这三个方法，
   * 因此被测方法 {@code getSharedPreferences} 是生产类的未改动实现。
   */
  interface PlatformSeams {
    void setUserManager(UserManager um);
    void setAlreadyDeviceProtected(boolean value);
    void setDeviceProtectedContext(Context context);
    int createdDeviceProtectedCount();

    // 三条被补的平台缝本身
    boolean isDeviceProtectedStorage();
    Context createDeviceProtectedStorageContext();
    Object getSystemService(String name);
  }

  /** 缝状态容器：两个替身各自持有一份，避免与父类构造相互纠缠。 */
  static final class SeamState implements PlatformSeams {
    private UserManager um;
    private boolean alreadyDeviceProtected;
    private Context deviceProtectedContext;
    private int createdCount;

    @Override public void setUserManager(UserManager value) { this.um = value; }
    @Override public void setAlreadyDeviceProtected(boolean value) { this.alreadyDeviceProtected = value; }
    @Override public void setDeviceProtectedContext(Context value) { this.deviceProtectedContext = value; }
    @Override public int createdDeviceProtectedCount() { return createdCount; }

    @Override public boolean isDeviceProtectedStorage() { return alreadyDeviceProtected; }

    @Override public Context createDeviceProtectedStorageContext() {
      createdCount++;
      return deviceProtectedContext;
    }

    @Override public Object getSystemService(String name) {
      if (Context.USER_SERVICE.equals(name)) return um;
      return null;
    }
  }

  static final class RoutingServiceDouble extends AlarmRingService implements PlatformSeams {
    private final SeamState seams = new SeamState();
    @Override public void setUserManager(UserManager um) { seams.setUserManager(um); }
    @Override public void setAlreadyDeviceProtected(boolean v) { seams.setAlreadyDeviceProtected(v); }
    @Override public void setDeviceProtectedContext(Context c) { seams.setDeviceProtectedContext(c); }
    @Override public int createdDeviceProtectedCount() { return seams.createdDeviceProtectedCount(); }
    @Override public boolean isDeviceProtectedStorage() { return seams.isDeviceProtectedStorage(); }
    @Override public Context createDeviceProtectedStorageContext() { return seams.createDeviceProtectedStorageContext(); }
    @Override public Object getSystemService(String name) { return seams.getSystemService(name); }
  }

  static final class RoutingActivityDouble extends AlarmActivity implements PlatformSeams {
    private final SeamState seams = new SeamState();
    @Override public void setUserManager(UserManager um) { seams.setUserManager(um); }
    @Override public void setAlreadyDeviceProtected(boolean v) { seams.setAlreadyDeviceProtected(v); }
    @Override public void setDeviceProtectedContext(Context c) { seams.setDeviceProtectedContext(c); }
    @Override public int createdDeviceProtectedCount() { return seams.createdDeviceProtectedCount(); }
    @Override public boolean isDeviceProtectedStorage() { return seams.isDeviceProtectedStorage(); }
    @Override public Context createDeviceProtectedStorageContext() { return seams.createDeviceProtectedStorageContext(); }
    @Override public Object getSystemService(String name) { return seams.getSystemService(name); }
  }

  /** DE 存储哨兵：记录被读的 name/mode，用于区分「路由到 DE」与「回退到 CE」。 */
  static final class DeviceProtectedSentinel extends ContextWrapper {
    final SharedPreferences prefs;
    final List<String> reads = new ArrayList<>();
    DeviceProtectedSentinel(SharedPreferences prefs) { super(null); this.prefs = prefs; }
    @Override public boolean isDeviceProtectedStorage() { return true; }
    @Override public Context getApplicationContext() { return this; }
    @Override public SharedPreferences getSharedPreferences(String name, int mode) {
      reads.add(name + "/" + mode);
      return prefs;
    }
  }

  /** 双哨兵上下文：同一对象上同时暴露 DE 与 CE 两条可区分的读取路径。 */
  static final class DualSentinelContext extends ContextWrapper implements PlatformSeams {
    final DeviceProtectedSentinel de;
    final CredentialProtectedSentinel ce;
    private UserManager um;
    private boolean alreadyDeviceProtected;

    DualSentinelContext(SharedPreferences dePrefs, SharedPreferences cePrefs) {
      super(null);
      this.de = new DeviceProtectedSentinel(dePrefs);
      this.ce = new CredentialProtectedSentinel(cePrefs);
    }

    @Override public void setUserManager(UserManager value) { this.um = value; }
    @Override public void setAlreadyDeviceProtected(boolean value) { this.alreadyDeviceProtected = value; }
    @Override public void setDeviceProtectedContext(Context context) { /* 未使用 */ }
    @Override public int createdDeviceProtectedCount() { return 0; }

    @Override public boolean isDeviceProtectedStorage() { return alreadyDeviceProtected; }
    @Override public Context createDeviceProtectedStorageContext() { return de; }
    @Override public Object getSystemService(String name) {
      return Context.USER_SERVICE.equals(name) ? um : null;
    }
    /** 回退目标 = 自身，与生产 {@code getApplicationContext()} 语义一致。 */
    @Override public Context getApplicationContext() { return this; }
    @Override public SharedPreferences getSharedPreferences(String name, int mode) { return ce.read(name, mode); }
  }

  static final class CredentialProtectedSentinel {
    final SharedPreferences prefs;
    final List<String> reads = new ArrayList<>();
    CredentialProtectedSentinel(SharedPreferences prefs) { this.prefs = prefs; }
    SharedPreferences read(String name, int mode) {
      reads.add(name + "/" + mode);
      return prefs;
    }
  }

  /** 未解锁态 UserManager（显式桩，不依赖 mockable 默认值碰巧为 false）。 */
  private static UserManager lockedUserManager() {
    UserManager um = mock(UserManager.class);
    when(um.isUserUnlocked()).thenReturn(false);
    return um;
  }

  /** 已解锁态 UserManager。 */
  private static UserManager unlockedUserManager() {
    UserManager um = mock(UserManager.class);
    when(um.isUserUnlocked()).thenReturn(true);
    return um;
  }

  private static boolean frameSeen(Throwable t, String classFragment, String methodName) {
    if (t == null) return false;
    for (StackTraceElement e : t.getStackTrace()) {
      if (e.getClassName().contains(classFragment) && methodName.equals(e.getMethodName())) {
        return true;
      }
    }
    return false;
  }

  /**
   * 写 {@code Build.VERSION.SDK_INT}，返回旧值。
   *
   * <p>mockable jar 抹平了该字段的 {@code <clinit>}（恒 0）且字段为 {@code static final}，
   * 普通反射抛 {@code IllegalAccessException}，故必须走 {@code sun.misc.Unsafe}。
   * 调用方必须在 {@code finally} 中恢复。
   */
  private static int setSdkInt(int value) throws Exception {
    Field sdkInt = Build.VERSION.class.getField("SDK_INT");
    Class<?> unsafeClass = Class.forName("sun.misc.Unsafe");
    Field theUnsafe = unsafeClass.getDeclaredField("theUnsafe");
    theUnsafe.setAccessible(true);
    Object unsafe = theUnsafe.get(null);

    Object base = unsafeClass.getMethod("staticFieldBase", Field.class).invoke(unsafe, sdkInt);
    long offset = (Long) unsafeClass.getMethod("staticFieldOffset", Field.class).invoke(unsafe, sdkInt);
    int previous = Build.VERSION.SDK_INT;
    unsafeClass.getMethod("putInt", Object.class, long.class, int.class)
        .invoke(unsafe, base, offset, value);

    assertEquals("SDK_INT 改写必须真实生效（否则整条 DE 分支仍不可达）",
        value, Build.VERSION.SDK_INT);
    return previous;
  }

  // ---------------------------------------------------------------- 其余生产测试

  /**
   * R2-01：生产代码 parseLocalTriggerInCurrentZone 精确时区时间戳换算断言。
   * 绝不使用模糊的 > 0 断言，必须在指定时区下断言精确 epoch 毫秒值。
   */
  @Test
  public void testParseLocalTriggerInCurrentZoneExactTimestamp() {
    TimeZone oldTz = TimeZone.getDefault();
    try {
      TimeZone.setDefault(TimeZone.getTimeZone("Asia/Tokyo"));

      long originalUtc = Instant.parse("2030-09-20T00:00:00Z").toEpochMilli();

      long expectedTokyoMinute = Instant.parse("2030-09-19T23:00:00Z").toEpochMilli();
      long actualTokyoMinute = SystemBridgePlugin.parseLocalTriggerInCurrentZone("2030-09-20T08:00", originalUtc);

      assertEquals("16-char minute format in Asia/Tokyo must exactly match 2030-09-19T23:00:00Z (not fallback to originalUtc)",
          expectedTokyoMinute, actualTokyoMinute);
      assertNotEquals("Must not return unadjusted originalUtc", originalUtc, actualTokyoMinute);

      long expectedTokyoSec = Instant.parse("2030-09-19T23:00:45Z").toEpochMilli();
      long actualTokyoSec = SystemBridgePlugin.parseLocalTriggerInCurrentZone("2030-09-20T08:00:45", originalUtc);

      assertEquals("19-char seconds format in Asia/Tokyo must exactly match 2030-09-19T23:00:45Z",
          expectedTokyoSec, actualTokyoSec);

      TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));
      long expectedShanghai = Instant.parse("2030-09-20T00:00:00Z").toEpochMilli();
      long actualShanghai = SystemBridgePlugin.parseLocalTriggerInCurrentZone("2030-09-20T08:00", originalUtc);
      assertEquals("16-char minute format in Asia/Shanghai must match 2030-09-20T00:00:00Z",
          expectedShanghai, actualShanghai);

      long fallbackShort = SystemBridgePlugin.parseLocalTriggerInCurrentZone("2030-09-20", originalUtc);
      assertEquals("Short string (<16 chars) must fallback to originalUtc", originalUtc, fallbackShort);

      long fallbackNull = SystemBridgePlugin.parseLocalTriggerInCurrentZone(null, originalUtc);
      assertEquals("Null localTrigger must fallback to originalUtc", originalUtc, fallbackNull);

    } finally {
      TimeZone.setDefault(oldTz);
    }
  }

  /** R2-04：生产代码 DirectBootUtils.getBootId 稳定标识测试 */
  @Test
  public void testDirectBootUtilsGetBootIdIsStable() {
    String bootId1 = DirectBootUtils.getBootId();
    assertNotNull("bootId must not be null", bootId1);
    assertFalse("bootId must not be empty", bootId1.isEmpty());

    String bootId2 = DirectBootUtils.getBootId();
    assertEquals("Consecutive getBootId calls must return identical cached boot ID", bootId1, bootId2);
  }

  /** B2 / R2-04：生产代码 isDeliveryTerminatedState 终态覆盖测试 */
  @Test
  public void testIsDeliveryTerminatedStateCoverage() {
    assertTrue("STATE_STOPPED must be terminated",
        AlarmRingService.isDeliveryTerminatedState(AlarmRingService.STATE_STOPPED));
    assertTrue("STATE_AUTO_SILENCED must be terminated",
        AlarmRingService.isDeliveryTerminatedState(AlarmRingService.STATE_AUTO_SILENCED));
    assertTrue("STATE_REPLACED must be terminated",
        AlarmRingService.isDeliveryTerminatedState(AlarmRingService.STATE_REPLACED));

    assertFalse("STATE_RINGING must not be terminated",
        AlarmRingService.isDeliveryTerminatedState(AlarmRingService.STATE_RINGING));
    assertFalse("RECEIVED must not be terminated",
        AlarmRingService.isDeliveryTerminatedState("RECEIVED"));
    assertFalse("Empty state must not be terminated",
        AlarmRingService.isDeliveryTerminatedState(""));
  }

  /** B2 / R2-04：生产代码 DeliveryRecord 序列化与跨开机/同开机改时隔离测试 */
  @Test
  public void testDeliveryRecordJsonSerializationAndRebootIsolation() {
    String currentBootId = DirectBootUtils.getBootId();

    AlarmRingService.DeliveryRecord rec = new AlarmRingService.DeliveryRecord(
        "token-101",
        AlarmRingService.STATE_RINGING,
        50000L,
        350000L,
        700000L,
        1700000000000L,
        0L,
        "",
        1700000000000L - 50000L,
        currentBootId
    );

    JSONObject json = rec.toJson();
    assertNotNull(json);
    assertEquals("token-101", json.optString("token"));
    assertEquals(AlarmRingService.STATE_RINGING, json.optString("state"));
    assertEquals(currentBootId, json.optString("bootId"));
    assertEquals(50000L, json.optLong("startedElapsed"));

    AlarmRingService.DeliveryRecord parsedSameBoot = AlarmRingService.DeliveryRecord.fromJson(json);
    assertNotNull(parsedSameBoot);
    assertEquals("Same boot session record must remain RINGING",
        AlarmRingService.STATE_RINGING, parsedSameBoot.state);

    try {
      JSONObject rebootJson = new JSONObject(json.toString());
      rebootJson.put("bootId", "previous-boot-session-id-different-from-current");
      AlarmRingService.DeliveryRecord parsedReboot = AlarmRingService.DeliveryRecord.fromJson(rebootJson);
      assertNotNull(parsedReboot);
      assertEquals("Record from different boot session must transition to STOPPED",
          AlarmRingService.STATE_STOPPED, parsedReboot.state);
      assertEquals("Stop reason must be terminated-on-reboot",
          "terminated-on-reboot", parsedReboot.stopReason);
    } catch (Exception e) {
      fail("Failed to test reboot isolation: " + e.getMessage());
    }
  }

  static class MockSharedPreferences implements SharedPreferences {
    private final String name;
    MockSharedPreferences(String name) { this.name = name; }
    @Override public String toString() { return "MockSharedPreferences(" + name + ")"; }
    @Override public java.util.Map<String, ?> getAll() { return java.util.Collections.emptyMap(); }
    @Override public String getString(String key, String defValue) { return defValue; }
    @Override public java.util.Set<String> getStringSet(String key, java.util.Set<String> defValues) { return defValues; }
    @Override public int getInt(String key, int defValue) { return defValue; }
    @Override public long getLong(String key, long defValue) { return defValue; }
    @Override public float getFloat(String key, float defValue) { return defValue; }
    @Override public boolean getBoolean(String key, boolean defValue) { return defValue; }
    @Override public boolean contains(String key) { return false; }
    @Override public Editor edit() { return null; }
    @Override public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}
    @Override public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}
  }
}
