package space.alliswell.inbox;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * UX-T03：持久送达证据台账的原生单测。
 *
 * <p>为什么这些断言值得存在：「证据回流的唯一验收标准」是
 * <b>缺证据只能归为 unknown，绝不能反推失败</b>（D70 前置核验近 100% 误报的教训）。
 * 台账本身一旦漏写、重复写或身份不全却照写，Web 侧的判定层再正确也无从挽救。
 *
 * <p><b>两条刻意的 harness 纪律（都是实测踩出来的，不是风格偏好）：</b>
 * <ol>
 *   <li><b>不碰 {@code Build.VERSION.SDK_INT}</b>。该字段是 {@code static final}，
 *       只能靠 {@code sun.misc.Unsafe} 改写，而 JIT 会把它常量折叠 —— 本类若先改写它，
 *       同一 JVM 里随后运行的
 *       {@code ProductionJavaAlarmTest#testDirectBootUtilsRouteDiscrimination}
 *       会读到折叠后的旧值而变红。生产实现里因此也刻意不写 SDK_INT 判断，
 *       直接用 {@code createDeviceProtectedStorageContext()} 能否拿到作为唯一判据。</li>
 *   <li><b>不用 Mockito 假 {@code Context}</b>。实测在本工程里 {@code mock(Context.class)}
 *       会同样让上面那个既有用例变红（仅「本类先跑」时复现）。改用与
 *       {@code ProductionJavaAlarmTest} 同款的手写 {@code ContextWrapper} 替身后复现消失。
 *       替身只补平台缝（{@code getSharedPreferences} /
 *       {@code createDeviceProtectedStorageContext} / {@code getApplicationContext}），
 *       被测的 {@code DeliveryEvidenceStore} 全是生产实现。</li>
 * </ol>
 */
public class DeliveryEvidenceStoreTest {

  /* ------------------------- 手写替身 ------------------------- */

  /** 内存版 SharedPreferences：够用即可，不做并发语义。 */
  private static final class FakePrefs implements SharedPreferences {
    final Map<String, String> values = new HashMap<>();

    @Override public String getString(String key, String def) {
      return values.containsKey(key) ? values.get(key) : def;
    }
    @Override public Map<String, ?> getAll() { return new HashMap<>(values); }
    @Override public java.util.Set<String> getStringSet(String k, java.util.Set<String> d) { return d; }
    @Override public int getInt(String k, int d) { return d; }
    @Override public long getLong(String k, long d) { return d; }
    @Override public float getFloat(String k, float d) { return d; }
    @Override public boolean getBoolean(String k, boolean d) { return d; }
    @Override public boolean contains(String k) { return values.containsKey(k); }
    @Override public Editor edit() { return new Editor() {
      @Override public Editor putString(String k, String v) { values.put(k, v); return this; }
      @Override public Editor putStringSet(String k, java.util.Set<String> v) { return this; }
      @Override public Editor putInt(String k, int v) { return this; }
      @Override public Editor putLong(String k, long v) { return this; }
      @Override public Editor putFloat(String k, float v) { return this; }
      @Override public Editor putBoolean(String k, boolean v) { return this; }
      @Override public Editor remove(String k) { values.remove(k); return this; }
      @Override public Editor clear() { values.clear(); return this; }
      @Override public boolean commit() { return true; }
      @Override public void apply() {}
    }; }
    @Override public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {}
    @Override public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {}
  }

  /**
   * 只补三条平台缝的上下文替身。
   *
   * {@code deContext} / {@code deError} 分别复刻「拿得到 DE 上下文」与「平台不支持 / 抛错」
   * 两种真实情形；{@code hostile} 复刻存储层整体不可用。
   */
  private static final class FakeContext extends ContextWrapper {
    private final FakePrefs prefs;
    private final Context deContext;
    private final RuntimeException deError;
    private final boolean hostile;

    FakeContext(FakePrefs prefs, Context deContext, RuntimeException deError, boolean hostile) {
      super(null);
      this.prefs = prefs;
      this.deContext = deContext;
      this.deError = deError;
      this.hostile = hostile;
    }

    @Override public SharedPreferences getSharedPreferences(String name, int mode) {
      if (hostile) throw new RuntimeException("prefs unavailable");
      return prefs;
    }
    @Override public Context getApplicationContext() {
      if (hostile) throw new RuntimeException("no app context");
      return this;
    }
    @Override public Context createDeviceProtectedStorageContext() {
      if (deError != null) throw deError;
      return deContext;
    }
  }

  private static FakeContext plain(FakePrefs prefs) {
    return new FakeContext(prefs, null, null, false);
  }

  private static FakeContext withDeviceProtected(FakePrefs ce, FakePrefs de) {
    return new FakeContext(ce, new FakeContext(de, null, null, false), null, false);
  }

  private static JSONArray rowsIn(FakePrefs prefs) throws Exception {
    String raw = prefs.values.get("rows");
    return raw == null ? new JSONArray() : new JSONArray(raw);
  }

  /* ------------------------- 纯逻辑：rowFor ---------------------- */

  @Test
  public void rowForRejectsIncompleteIdentity() {
    // 没有身份就没有证据 —— 写一条「说不清是哪一轮」的记录比不写更糟：
    // Web 侧会把它当成本轮已送达。
    assertNull(DeliveryEvidenceStore.rowFor("", "1@100", 100L, "alarm", "1", "t", 5L));
    assertNull(DeliveryEvidenceStore.rowFor("it1", "", 100L, "alarm", "1", "t", 5L));
    assertNull(DeliveryEvidenceStore.rowFor(null, null, 100L, "alarm", null, null, 5L));
    // F01/R4b：接收时刻与版本号也是身份的一部分 ——
    //   · 缺接收时刻 ⇒ 无法区分「这次收到」与「同一行被读了两次」；
    //   · 缺版本 ⇒ 与本轮排程身份无从对照（R4b 正是缺它才漏过去的）。
    assertNull("缺接收时刻不得成行",
      DeliveryEvidenceStore.rowFor("it1", "1@100", 100L, "alarm", "1", "t", 0L));
    assertNull("缺事项版本不得成行",
      DeliveryEvidenceStore.rowFor("it1", "1@100", 100L, "alarm", "", "t", 5L));
    assertNull("缺事项版本(null)不得成行",
      DeliveryEvidenceStore.rowFor("it1", "1@100", 100L, "alarm", null, "t", 5L));
    // 未知载体不是「默认通知」，而是身份不成立（不再偷偷归到 notification）
    assertNull("未知载体不得成行",
      DeliveryEvidenceStore.rowFor("it1", "1@100", 100L, "carrier-unknown", "1", "t", 5L));
    assertNotNull(DeliveryEvidenceStore.rowFor("it1", "1@100", 100L, "alarm", "1", "t", 5L));
  }

  /**
   * F01 的根因是「两边各写各的字段名」：Java 写 {@code key/at}，Web 侧只读
   * {@code reminderKey/plannedAt}，于是每条**正常**回执都在 JS 里被判 missing-identity 丢掉。
   * 所以这里把线上键集**钉死**成一份清单 —— 改名字必须同时改这条断言和 Web 侧。
   */
  @Test
  public void rowFieldsAreTheWebProtocol() {
    assertArrayEquals(
      new String[]{"itemId", "reminderKey", "plannedAt", "carrier", "receivedAt", "itemRev", "token"},
      DeliveryEvidenceStore.ROW_FIELDS);
    // 旧名不得再出现在协议清单里
    for (String legacy : new String[]{"key", "at"}) {
      for (String name : DeliveryEvidenceStore.ROW_FIELDS) {
        assertNotEquals("旧字段名 " + legacy + " 不得再出现在协议里", legacy, name);
      }
    }
  }

  @Test
  public void rowForUsesCanonicalFieldNamesAndNeverStoresContent() throws Exception {
    JSONObject row = DeliveryEvidenceStore.rowFor("it1", "1@100", 100L, "notification", "3", "trace", 7L);
    assertNotNull(row);
    assertEquals("notification", row.getString("carrier"));
    assertEquals("it1", row.getString("itemId"));
    assertEquals("1@100", row.getString("reminderKey"));
    assertEquals(100L, row.getLong("plannedAt"));
    assertEquals(7L, row.getLong("receivedAt"));
    assertEquals("3", row.getString("itemRev"));
    assertEquals("trace", row.getString("token"));
    // F01：旧名一律不得再写出 —— 写出来 Web 侧读不到，等于没有证据
    assertFalse("旧字段名 key 不得再写出", row.has("key"));
    assertFalse("旧字段名 at 不得再写出", row.has("at"));
    // 证据里不得出现标题/正文（本台账只认身份与阶段）
    assertFalse(row.has("title"));
    assertFalse(row.has("body"));
    assertFalse(row.has("text"));
  }

  /* ------------------------- 纯逻辑：trim ------------------------ */

  @Test
  public void trimDropsExpiredRowsAndKeepsCapacityBound() throws Exception {
    long now = 1_000_000_000_000L;
    JSONArray rows = new JSONArray();
    // 旧的在前（写入顺序）
    rows.put(new JSONObject().put("receivedAt", now - DeliveryEvidenceStore.MAX_AGE_MS - 1).put("key", "old"));
    rows.put(new JSONObject().put("receivedAt", now - 1000L).put("key", "fresh"));
    // 缺 receivedAt ⇒ 不可判龄 ⇒ 保留（宁可多留也别误删）
    rows.put(new JSONObject().put("key", "ageless"));

    JSONArray kept = DeliveryEvidenceStore.trim(rows, now);
    assertEquals(2, kept.length());
    assertEquals("fresh", kept.getJSONObject(0).getString("key"));
    assertEquals("ageless", kept.getJSONObject(1).getString("key"));

    // 容量上限：只保留最新的 MAX_ROWS 条
    JSONArray many = new JSONArray();
    int total = DeliveryEvidenceStore.MAX_ROWS + 25;
    for (int i = 0; i < total; i++) {
      many.put(new JSONObject().put("receivedAt", now - 1000L).put("key", "k" + i));
    }
    JSONArray capped = DeliveryEvidenceStore.trim(many, now);
    assertEquals(DeliveryEvidenceStore.MAX_ROWS, capped.length());
    assertEquals("k25", capped.getJSONObject(0).getString("key"));
    assertEquals("k" + (total - 1), capped.getJSONObject(capped.length() - 1).getString("key"));
  }

  @Test
  public void trimKeepsAtLeastOneDayOfEvidence() {
    // 「次日重开仍可关联」是硬要求：保留窗口必须显著大于 24 小时
    assertTrue(DeliveryEvidenceStore.MAX_AGE_MS >= 24L * 60L * 60L * 1000L);
  }

  /* ------------------------- 落盘：record / list ------------------------ */

  @Test
  public void recordIsIdempotentPerIdentity() throws Exception {
    FakePrefs prefs = new FakePrefs();
    Context context = plain(prefs);

    DeliveryEvidenceStore.record(context, "it1", "1@100", 100L, "alarm", "1", "trace-a");
    JSONArray first = DeliveryEvidenceStore.list(context);
    assertEquals("第一次写入必须落盘（否则下面的对比是空转）", 1, first.length());
    long receivedAtFirst = first.optJSONObject(0).optLong("receivedAt", 0L);

    // 时间推进一点点再写重复回执：若实现把重复回执当作新记录，receivedAt 必然变化
    Thread.sleep(5L);
    DeliveryEvidenceStore.record(context, "it1", "1@100", 100L, "alarm", "2", "trace-b");

    JSONArray after = DeliveryEvidenceStore.list(context);
    assertEquals("同身份重复回执只落一条", 1, after.length());
    assertEquals("重复回执不得把接收时刻刷掉",
      receivedAtFirst, after.optJSONObject(0).optLong("receivedAt", 0L));
    assertEquals("重复回执也不得覆盖首次回执上的版本号",
      "1", after.optJSONObject(0).optString("itemRev"));

    // 换一个身份（下一轮）才落第二条
    DeliveryEvidenceStore.record(context, "it1", "2@100", 100L, "alarm", "2", "trace-c");
    assertEquals(2, DeliveryEvidenceStore.list(context).length());
  }

  @Test
  public void recordSkipsRowsWithoutIdentity() throws Exception {
    FakePrefs prefs = new FakePrefs();
    Context context = plain(prefs);

    DeliveryEvidenceStore.record(context, "", "1@100", 100L, "alarm", "1", "t");
    DeliveryEvidenceStore.record(context, "it1", "", 100L, "alarm", "1", "t");

    assertEquals("身份不全一律不写（宁缺证据，不要假证据）", 0, rowsIn(prefs).length());
  }

  @Test
  public void recordNeverThrowsEvenWhenStorageIsHostile() throws Exception {
    // 写证据失败不能反过来打断投递本身 —— 接收路径上不允许抛
    FakeContext context = new FakeContext(null, null, null, true);
    DeliveryEvidenceStore.record(context, "it1", "1@100", 100L, "alarm", "1", "t");
    assertEquals(0, DeliveryEvidenceStore.list(context).length());
  }

  /**
   * F01 / R7b：**「读不到」必须与「读到空」分开**。
   *
   * 传到 JS 的都是空证据时，两者会变成同一句话「本次提醒结果尚未确认」——
   * 但语义完全不同：读不到是**通道故障**（不许反推没送达），空是真的没有回执。
   * 以前 `list()` 把读失败转成空数组、桥又恒回 `available:true`，这个区别整条丢失。
   */
  @Test
  public void listOrNullSeparatesUnavailableFromEmpty() throws Exception {
    FakePrefs prefs = new FakePrefs();
    assertNotNull("空台账读得成功 ⇒ 不是 null",
      DeliveryEvidenceStore.listOrNull(plain(prefs), 1L));
    assertNull("存储不可用 ⇒ null（不是空数组）",
      DeliveryEvidenceStore.listOrNull(new FakeContext(null, null, null, true), 1L));

    FakePrefs broken = new FakePrefs();
    broken.values.put("rows", "{not json");
    assertNull("内容坏掉同样是「读不到」", DeliveryEvidenceStore.listOrNull(plain(broken), 1L));
  }

  @Test
  public void recordCheckedReportsWhetherTheWriteLanded() throws Exception {
    FakePrefs prefs = new FakePrefs();
    assertTrue("写得进去时如实回答 true",
      DeliveryEvidenceStore.recordChecked(plain(prefs), "it1", "1@100", 100L, "alarm", "1", "t"));
    assertFalse("身份不全 ⇒ false，且一行都没写",
      DeliveryEvidenceStore.recordChecked(plain(prefs), "", "1@100", 100L, "alarm", "1", "t"));
    assertFalse("存储不可用 ⇒ false（不是「静默成功」）",
      DeliveryEvidenceStore.recordChecked(new FakeContext(null, null, null, true),
        "it1", "1@100", 100L, "alarm", "1", "t"));
  }

  /* ------------------------- Direct Boot 路由 --------------------------- */

  @Test
  public void evidenceAlwaysLandsInDeviceProtectedStorage() throws Exception {
    // 「锁屏期间投递 → 解锁后回读」是这条台账存在的理由。
    // 若随解锁状态在 DE/CE 之间切换，锁屏时写进 DE 的证据解锁后就「消失」了。
    FakePrefs ce = new FakePrefs();
    FakePrefs de = new FakePrefs();
    Context context = withDeviceProtected(ce, de);

    DeliveryEvidenceStore.record(context, "it1", "1@100", 100L, "alarm", "1", "trace");

    assertEquals("证据必须落在 DE 存储", 1, rowsIn(de).length());
    assertFalse("CE 存储不得被写", ce.values.containsKey("rows"));
  }

  @Test
  public void fallsBackWhenDeviceProtectedIsUnavailable() throws Exception {
    // API 24 以下 / 平台上拿不到 DE 上下文 ⇒ 退回普通存储，而不是静默丢证据。
    FakePrefs plainPrefs = new FakePrefs();
    DeliveryEvidenceStore.record(plain(plainPrefs), "it1", "1@100", 100L, "alarm", "1", "trace");
    assertEquals(1, rowsIn(plainPrefs).length());
  }

  @Test
  public void fallsBackWhenDeviceProtectedThrows() throws Exception {
    // 某些 ROM 上该方法存在但会抛 —— 证据写入不得因此整条丢失
    FakePrefs plainPrefs = new FakePrefs();
    FakeContext context = new FakeContext(plainPrefs, null,
      new IllegalStateException("device protected storage unavailable"), false);

    DeliveryEvidenceStore.record(context, "it1", "1@100", 100L, "alarm", "1", "trace");
    assertEquals(1, rowsIn(plainPrefs).length());
  }
}
