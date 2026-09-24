package space.alliswell.inbox;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * UX-T03：**闹钟通道的持久送达证据台账**。
 *
 * 为什么必须有它（D70 前置核验的现场对照实验）：
 *   一条**真的响过**的重要档提醒，原生的 `AlarmTrace` 里 `received` / `systemNotificationPosted`
 *   全在，而三态台账里它停在 `scheduled` —— 因为接收侧的阶段从来没有一条通路回到 JS。
 *   于是任何「scheduled 且已过期 ⇒ 未送达」的判定都会在每次成功提醒后成立（近 100% 误报）。
 *
 * 为什么不能复用 `AlarmTrace`：它是**诊断**用的有界环形缓冲（150 条），高频事件会把它挤掉；
 * 也不可能当证据源（拿被挤掉的日志反推「没送达」正是那条误报的另一种写法）。
 *
 * 与 `ActiveAlarmStore` 的分工：那个回答「现在有没有一条正在响的投递」（有生命周期、会出账），
 * 这个回答「这一次提醒，系统到底接收到了没有」（只增、按容量与时长淘汰、与投递生命周期无关）。
 *
 * 层级纪律：这里只证明**系统接收**。窗口创建不等于用户看到，声振请求不等于用户听到 ——
 * 落到 Web 侧时统一记 `level: "received"`，不得改写成 ACK 或「已读」。
 *
 * <p><b>明确未覆盖的一条（不许写成已覆盖）</b>：普通提醒（非闹钟档）走的是
 * Capacitor LocalNotifications，进程被系统杀掉之后由**插件自己的广播接收器**投递，
 * 那一跳没有任何应用侧代码会执行 —— 因此「应用不在时收到的普通通知」在这本台账里
 * **没有行**。Web 侧对这种情形只会显示「本次提醒结果尚未确认」（unknown），不会反推失败。
 * 进程活着时收到的普通通知由 JS 的运行期监听写进事项台账，与本文件无关。
 */
final class DeliveryEvidenceStore {
  /** 与 CE/DE 无关：证据必须在「锁屏后投递 → 解锁后回读」这条路上活着（见 {@link #store}）。 */
  private static final String PREFS = "delivery_evidence";
  private static final String KEY_ROWS = "rows";

  /**
   * **线上字段名（唯一协议）**，与 Web 侧 `lib/delivery-evidence.js` 的 `ROW_FIELDS` 一一对应。
   *
   * 独立验收 F01：这里以前写 `key` / `at`，而 Web 侧只读 `reminderKey`，于是一条**正常**的
   * 原生回执在 JS 里恒被判成 `missing-identity` 丢弃 —— 证据回流整条链其实没打通，
   * 却因为「写入测试喂的是手造字段」而全绿。所以两边现在用同一组名字，并由
   * `test-native-reminders.js` 的往返契约断言把 Java 写出的键集与 Web 侧读的键集钉在一起。
   */
  static final String F_ITEM_ID = "itemId";
  static final String F_REMINDER_KEY = "reminderKey";
  static final String F_PLANNED_AT = "plannedAt";
  static final String F_CARRIER = "carrier";
  static final String F_RECEIVED_AT = "receivedAt";
  static final String F_ITEM_REV = "itemRev";
  static final String F_TOKEN = "token";
  static final String[] ROW_FIELDS = {
    F_ITEM_ID, F_REMINDER_KEY, F_PLANNED_AT, F_CARRIER, F_RECEIVED_AT, F_ITEM_REV, F_TOKEN
  };

  /** 载体只有两种；不认识的取值**不是**「默认通知」，而是身份不成立（见 {@link #rowFor}）。 */
  private static String normalizeCarrier(String carrier) {
    if ("alarm".equals(carrier)) return "alarm";
    if ("notification".equals(carrier)) return "notification";
    return "";
  }

  /**
   * 保留策略（T03 要求「证据至少支持次日重开仍可关联」并「报告实际选值与理由」）。
   *
   *  · 7 天：覆盖「周末响过的那条，周一回来查」与跨时区旅行，同时不至于无限膨胀；
   *  · 300 条：按每天 10 条提醒估算约一个月，远超「次日重开」的下限。
   * 两者都是**上限**：超出的最旧条目淘汰后一律归为 unknown，绝不反推失败。
   */
  static final long MAX_AGE_MS = 7L * 24L * 60L * 60L * 1000L;
  static final int MAX_ROWS = 300;

  private DeliveryEvidenceStore() {}

  /**
   * 证据存储**固定走 Device Protected（DE）**，而不是随解锁状态切换。
   *
   * `DirectBootUtils.getSafeSharedPreferences` 的语义是「未解锁读 DE、已解锁读 CE」——
   * 对活跃投递台账是对的，对证据台账恰恰是错的：闹钟在锁屏状态下投递（写入落 DE），
   * 用户解锁后回读却读 CE ⇒ 证据「消失」，而那正是本台账要覆盖的场景。
   * 所以这里显式钉在 DE 上。
   *
   * 这里**刻意不写 `if (Build.VERSION.SDK_INT >= 24)`**：`createDeviceProtectedStorageContext()`
   * 本身就是 API 24 才有的方法，拿不到它就说明平台不支持 —— 直接兜住。
   * 少一个 SDK_INT 判断有两个好处：① minSdk 22 上不必依赖编译器对 API 的静态检查；
   * ② 单测不必再去用 Unsafe 改写 `Build.VERSION.SDK_INT`。那个字段是 `static final`，
   *    JIT 可以把它常量折叠，而一旦某个测试类先改写它，同一 JVM 里后跑的测试就会读到
   *    折叠后的旧值（实测：本仓既有的 Direct Boot 路由测试会因此变红）。
   */
  private static SharedPreferences store(Context context) {
    if (context == null) return null;
    try {
      SharedPreferences de = deviceProtectedPrefs(context);
      if (de != null) return de;
      Context target = context.getApplicationContext() != null ? context.getApplicationContext() : context;
      return target.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    } catch (Throwable error) {
      // 「拿不到存储」与「没有证据」是两件事，但都不许把异常抛到调用方：
      //   · 读取路径上抛 ⇒ 接收侧/对账侧会以外，而它本该只是 `available:false`；
      //   · 写入路径上抛 ⇒ 写证据失败反过来打断投递本身。
      // 统一收敛成 null，由 `readRaw` / `write` 转成「读不到 / 没写成」。
      AlarmTrace.record(context, "delivery-evidence", "storeUnavailable", error.toString());
      return null;
    }
  }

  /** API 24 以下没有 DE 存储：拿到 null 或被平台拒绝都当作「不支持」，退回普通存储。 */
  private static SharedPreferences deviceProtectedPrefs(Context context) {
    try {
      Context de = context.createDeviceProtectedStorageContext();
      return de != null ? de.getSharedPreferences(PREFS, Context.MODE_PRIVATE) : null;
    } catch (Throwable error) {
      return null;
    }
  }


  /** 身份判等：事项 + 提醒键 + 载体。**时间戳或标题单独都不是身份。** */
  static boolean sameIdentity(JSONObject a, JSONObject b) {
    if (a == null || b == null) return false;
    return a.optString(F_ITEM_ID).equals(b.optString(F_ITEM_ID))
      && a.optString(F_REMINDER_KEY).equals(b.optString(F_REMINDER_KEY))
      && a.optString(F_CARRIER).equals(b.optString(F_CARRIER));
  }

  /**
   * 构造一行证据。
   *
   * **身份不全一律返回 null**，而不是「写一条字段缺失的行」—— 缺项的行在 Web 侧会被拒收
   * （`missing-identity`），写进去只是把「说不清是哪一轮」的记录留在磁盘上。判定：
   *   · 事项 ID、提醒键：没有它就没有身份；
   *   · 载体：只接受 alarm / notification（未知取值不再被偷偷归到 notification）；
   *   · 接收时刻：必须是真实时刻，否则无法区分「这次收到」与「同一行被读了两次」；
   *   · 事项版本：本轮排程身份的一部分（独立验收 R4b 正是缺它才漏过去的）。
   */
  static JSONObject rowFor(String itemId, String reminderKey, long plannedAt,
                           String carrier, String itemRev, String token, long receivedAt) {
    if (itemId == null || itemId.isEmpty()) return null;
    if (reminderKey == null || reminderKey.isEmpty()) return null;
    String normalized = normalizeCarrier(carrier);
    if (normalized.isEmpty()) return null;
    if (receivedAt <= 0L) return null;
    if (itemRev == null || itemRev.isEmpty()) return null;
    try {
      JSONObject row = new JSONObject()
        .put(F_ITEM_ID, itemId)
        .put(F_REMINDER_KEY, reminderKey)
        .put(F_PLANNED_AT, plannedAt)
        .put(F_CARRIER, normalized)
        .put(F_RECEIVED_AT, receivedAt)
        .put(F_ITEM_REV, itemRev);
      if (token != null && !token.isEmpty()) row.put(F_TOKEN, token);
      return row;
    } catch (Exception error) {
      return null;
    }
  }

  /**
   * 按「时长 + 容量」淘汰，返回新数组（纯函数，便于单测直接断言）。
   *
   * 顺序语义：入参是**写入顺序**（旧的在前）。超容量时丢最旧的；
   * 缺 `receivedAt` 的行按「不可判龄」保留，宁可多留一条也不要误删。
   */
  static JSONArray trim(JSONArray rows, long now) {
    JSONArray fresh = new JSONArray();
    if (rows == null) return fresh;
    long cutoff = now - MAX_AGE_MS;
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = rows.optJSONObject(i);
      if (row == null) continue;
      long receivedAt = row.optLong("receivedAt", 0L);
      if (receivedAt > 0L && receivedAt < cutoff) continue;
      fresh.put(row);
    }
    if (fresh.length() <= MAX_ROWS) return fresh;
    JSONArray capped = new JSONArray();
    for (int i = fresh.length() - MAX_ROWS; i < fresh.length(); i++) capped.put(fresh.opt(i));
    return capped;
  }

  static JSONArray list(Context context) {
    return list(context, System.currentTimeMillis());
  }

  static synchronized JSONArray list(Context context, long now) {
    JSONArray rows = listOrNull(context, now);
    return rows == null ? new JSONArray() : rows;
  }

  /**
   * 与 {@link #list} 同一实现，但**保留「读不到」与「读到空」的区别**。
   *
   * 返回 `null` = 这次读失败（存储拿不到 / 内容坏了）。这个区别不能丢：Web 侧要把它
   * 显示成「本次提醒结果尚未确认」，而不是「没有证据 ⇒ 没送达」——D70 前置核验里那条
   * 近 100% 的误报就是这么产生的。独立验收 R7b 指出：以前不管读成什么，
   * 传到 JS 的都是 `available: true`。
   */
  static synchronized JSONArray listOrNull(Context context, long now) {
    JSONArray raw = readRaw(context);
    if (raw == null) return null;
    JSONArray fresh = trim(raw, now);
    if (fresh.length() != raw.length()) write(context, fresh);
    return fresh;
  }

  /** `null` = 这次读不到（**不是**「没有证据」）。 */
  private static JSONArray readRaw(Context context) {
    SharedPreferences sp = store(context);
    if (sp == null) return null;
    String stored;
    try {
      stored = sp.getString(KEY_ROWS, "[]");
    } catch (Throwable error) {
      AlarmTrace.record(context, "delivery-evidence", "readFailed", error.toString());
      return null;
    }
    if (stored == null) return new JSONArray();
    try {
      return new JSONArray(stored);
    } catch (Throwable error) {
      // 内容坏了：同样是「读不到」。不要在读取路径上假装成空台账 ——
      // 下一次 record 会用空基线重建，坏数据自然被覆盖掉。
      AlarmTrace.record(context, "delivery-evidence", "corrupt", error.toString());
      return null;
    }
  }

  /** @return 这次写入是否**真的提交成功**（独立验收：以前完全不看 commit 的返回值）。 */
  private static boolean write(Context context, JSONArray rows) {
    SharedPreferences sp = store(context);
    if (sp == null) return false;
    try {
      boolean committed = sp.edit().putString(KEY_ROWS, rows.toString()).commit();
      if (!committed) {
        AlarmTrace.record(context, "delivery-evidence", "commitRejected", "rows=" + rows.length());
      }
      return committed;
    } catch (Throwable error) {
      AlarmTrace.record(context, "delivery-evidence", "writeFailed", error.toString());
      return false;
    }
  }

  /**
   * 记一条送达证据。
   *
   * 幂等：同身份重复回执**保留最早那条** —— 「系统接收」只发生过一次，
   * 后到的重复回执不得把它刷成新时刻（否则 `receivedAt` 会随重试不断后移）。
   *
   * 绝不抛：调用点在接收路径上，写证据失败不能反过来打断投递本身。
   */
  static synchronized void record(Context context, String itemId, String reminderKey,
                                  long plannedAt, String carrier, String itemRev, String token) {
    recordChecked(context, itemId, reminderKey, plannedAt, carrier, itemRev, token);
  }

  /**
   * 与 {@link #record} 是同一份实现，只多回答一句「这次到底写进去了没有」。
   *
   * 投递路径用 void 版本（失败绝不能反噬投递），对账 / 自检路径可以用这个版本把
   * 「写失败」当成一个可观测的事实，而不是当它没发生过。
   */
  static synchronized boolean recordChecked(Context context, String itemId, String reminderKey,
                                            long plannedAt, String carrier, String itemRev,
                                            String token) {
    if (context == null) return false;
    JSONObject row = rowFor(itemId, reminderKey, plannedAt, carrier, itemRev, token,
      System.currentTimeMillis());
    if (row == null) return false;
    try {
      JSONArray rows = list(context);
      JSONArray next = new JSONArray();
      boolean dup = false;
      for (int i = 0; i < rows.length(); i++) {
        JSONObject cur = rows.optJSONObject(i);
        if (cur == null) continue;
        if (sameIdentity(cur, row)) {
          dup = true;
          next.put(cur);
          continue;
        }
        next.put(cur);
      }
      if (!dup) next.put(row);
      return write(context, trim(next, System.currentTimeMillis()));
    } catch (Throwable error) {
      AlarmTrace.record(context, token != null ? token : "delivery-evidence",
        "deliveryEvidenceRecordFailed", error.toString());
      return false;
    }
  }
}
