package space.alliswell.inbox;

import android.content.Context;
import android.app.NotificationManager;
import android.app.Notification;
import org.json.JSONArray;
import org.json.JSONObject;

/** Delivered alarms are separate from future schedules. Keep a stop path even without a window/item. */
final class ActiveAlarmStore {
  private static final String PREFS = "active_alarm_deliveries";
  /**
   * 一条投递在多长时间之后不再被视为「仍在响」。
   *
   * 台账此前只增不减：只要用户没通过界面/通知/面板处理，记录就永久驻留，
   * 于是对账的 `preserveActive` 会一直命中它、永远不撤销那条 FLAG_INSISTENT 通知 —— 表现为幽灵持续响铃。
   * 超过这个时长仍未停止的投递，视为已不再活跃：不再阻止撤销。
   *
   * D59 之后它多了一重身份：`AlarmRingService` 的响铃上限也用它 —— 铃声由前台服务
   * 自播（不再交给通知），必须有兜底上限，否则「界面拉不起来 + 用户不在旁边」
   * 会让一条闹钟一直响下去。所以这里去掉 private，供服务复用同一个常量。
   */
  static final long MAX_AGE_MS = 6L * 60L * 60L * 1000L;

  static synchronized JSONArray list(Context context) {
    return prune(context, readRaw(context));
  }

  private static JSONArray readRaw(Context context) {
    try { return new JSONArray(context.getSharedPreferences(PREFS, 0).getString("alarms", "[]")); }
    catch (Exception e) { return new JSONArray(); }
  }

  /** 丢弃过期投递并写回，避免台账无限膨胀、也避免过期项继续钉住通知 */
  private static JSONArray prune(Context context, JSONArray rows) {
    long cutoff = System.currentTimeMillis() - MAX_AGE_MS;
    JSONArray fresh = new JSONArray();
    boolean dropped = false;
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = rows.optJSONObject(i);
      if (row == null) continue;
      long receivedAt = row.optLong("receivedAt", 0L);
      // receivedAt 缺失时按活跃处理，宁可多保留一条也不要误删正在响的投递
      if (receivedAt > 0L && receivedAt < cutoff) { dropped = true; continue; }
      fresh.put(row);
    }
    if (dropped) {
      try { context.getSharedPreferences(PREFS, 0).edit().putString("alarms", fresh.toString()).commit(); }
      catch (Exception ignored) {}
    }
    return fresh;
  }
  static synchronized boolean contains(Context context, int id, String token) {
    JSONArray rows = list(context);
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = rows.optJSONObject(i);
      if (row != null && row.optInt("id") == id && (token == null || token.equals(row.optString("token")))) return true;
    }
    return false;
  }
  static synchronized void record(Context context, int id, String token, String itemId,
      String itemRev, String title, String body) {
    JSONArray rows = list(context), next = new JSONArray();
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = rows.optJSONObject(i);
      if (row != null && row.optInt("id") != id) next.put(row);
    }
    try {
      next.put(new JSONObject().put("id", id).put("token", token).put("itemId", itemId)
        .put("itemRev", itemRev).put("title", title).put("body", body).put("receivedAt", System.currentTimeMillis()));
      context.getSharedPreferences(PREFS, 0).edit().putString("alarms", next.toString()).commit();
    } catch (Exception e) { AlarmTrace.record(context, token, "activeRecordFailed", e.toString()); }
  }
  static synchronized boolean postIfActive(Context context, int id, String token, Notification notification) {
    if (!contains(context, id, token)) return false;
    Object service = context.getSystemService(Context.NOTIFICATION_SERVICE);
    if (!(service instanceof NotificationManager)) return false;
    ((NotificationManager) service).notify(id, notification);
    return true;
  }
  static synchronized boolean cancelNotification(Context context, int id, boolean preserveActive) {
    if (preserveActive && contains(context, id, null)) return true;
    if (!preserveActive) stop(context, id, null);
    Object service = context.getSystemService(Context.NOTIFICATION_SERVICE);
    if (service instanceof NotificationManager) ((NotificationManager) service).cancel(id);
    return false;
  }
  /**
   * 切换投递时丢弃上一条：撤通知并出账，但**不回调界面**（界面还要继续展示新的那条）。
   *
   * 与 stop() 的区别就在这里 —— stop() 会通过 AlarmActivity.stopDelivery 把界面一起 finish，
   * 而 onNewIntent 的语义是「换成 B 继续展示」，不能连自己一起关掉。
   */
  static synchronized void drop(Context context, int id) {
    JSONArray rows = list(context), next = new JSONArray();
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = rows.optJSONObject(i);
      if (row != null && row.optInt("id") != id) next.put(row);
    }
    context.getSharedPreferences(PREFS, 0).edit().putString("alarms", next.toString()).commit();
    Object service = context.getSystemService(Context.NOTIFICATION_SERVICE);
    if (service instanceof NotificationManager) ((NotificationManager) service).cancel(id);
  }

  static synchronized boolean stop(Context context, int id, String token) {
    boolean tracked = contains(context, id, null);
    // A stale notification/button must not silence a newer delivery with the same ID.
    if (tracked && !contains(context, id, token)) return false;
    JSONArray rows = list(context), next = new JSONArray();
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = rows.optJSONObject(i);
      if (row != null && row.optInt("id") != id) next.put(row);
    }
    context.getSharedPreferences(PREFS, 0).edit().putString("alarms", next.toString()).commit();
    // 台账里查不到也必须撤通知：那是一条残留通知，恰恰是最需要被静音的。
    // 此前这里在 !contains 时直接 return，用户点了「停止声振」/「关闭」而系统通知仍在响 —— 关不掉。
    Object service = context.getSystemService(Context.NOTIFICATION_SERVICE);
    if (service instanceof NotificationManager) ((NotificationManager) service).cancel(id);
    // D59：铃声与振动由前台服务持有，**撤通知并不会让它停** —— 必须显式停服务。
    //
    // 这一行是「关得掉」的关键：漏掉它，用户点「停止声振」后通知消失、铃声照旧，
    // 而唯一的兜底是 6 小时后的 MAX_AGE —— 比修复前的体验更糟。
    // 停服务会走它的 onDestroy，那里统一收口（MediaPlayer + Vibrator + 前台身份）。
    AlarmRingService.requestStop(context);
    if (tracked) {
      AlarmActivity.stopDelivery(id, token);
      AlarmTrace.record(context, token, "deliveryStopped", "notification, ring service and fallback effects stopped");
    } else {
      AlarmTrace.record(context, token, "leftoverCancelled", "no active delivery row; notification and ring service stopped anyway");
    }
    return tracked;
  }
}
