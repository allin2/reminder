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

  private static android.content.SharedPreferences prefs(Context context) {
    return DirectBootUtils.getSafeSharedPreferences(context, PREFS, 0);
  }

  private static JSONArray readRaw(Context context) {
    try {
      android.content.SharedPreferences sp = prefs(context);
      return sp != null ? new JSONArray(sp.getString("alarms", "[]")) : new JSONArray();
    } catch (Exception e) { return new JSONArray(); }
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
      try {
        android.content.SharedPreferences sp = prefs(context);
        if (sp != null) sp.edit().putString("alarms", fresh.toString()).commit();
      } catch (Exception ignored) {}
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
      android.content.SharedPreferences sp = prefs(context);
      if (sp != null) sp.edit().putString("alarms", next.toString()).commit();
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
    if (!preserveActive && contains(context, id, null)) {
      String token = null;
      JSONArray rows = list(context);
      for (int i = 0; i < rows.length(); i++) {
        JSONObject r = rows.optJSONObject(i);
        if (r != null && r.optInt("id") == id) {
          token = r.optString("token", null);
          break;
        }
      }
      stop(context, id, token);
    }
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
    android.content.SharedPreferences sp = prefs(context);
    if (sp != null) sp.edit().putString("alarms", next.toString()).commit();
    Object service = context.getSystemService(Context.NOTIFICATION_SERVICE);
    if (service instanceof NotificationManager) ((NotificationManager) service).cancel(id);
  }

  static synchronized boolean stop(Context context, int id, String token) {
    boolean tracked = contains(context, id, null);
    String targetToken = token;

    if (tracked) {
      JSONArray rows = list(context), next = new JSONArray();
      for (int i = 0; i < rows.length(); i++) {
        JSONObject row = rows.optJSONObject(i);
        if (row != null && row.optInt("id") == id) {
          String rowToken = row.optString("token", null);
          if (token != null && !token.equals(rowToken)) {
            AlarmTrace.record(context, token, "mismatch-rejected", "id=" + id + " has newer delivery");
            return false;
          }
          if (targetToken == null) targetToken = rowToken;
        } else if (row != null) {
          next.put(row);
        }
      }
      android.content.SharedPreferences sp = prefs(context);
      if (sp != null) sp.edit().putString("alarms", next.toString()).commit();
    }

    // 撤销该 id 的通知栏通知
    Object service = context.getSystemService(Context.NOTIFICATION_SERVICE);
    if (service instanceof NotificationManager) ((NotificationManager) service).cancel(id);

    // 停止响铃：
    // 若处于 tracked 状态，使用确定的 targetToken 停止；
    // 若为 untracked（普通残留通知清理），仅在 caller 显式传入有效 token 时按 token 停止；若 token 为空，绝不隐式停止服务！
    boolean ringStopped = false;
    if (tracked) {
      ringStopped = AlarmRingService.requestStop(context, id, targetToken);
      AlarmActivity.stopDelivery(id, targetToken);
      AlarmTrace.record(context, targetToken, "deliveryStopped", "notification and ring service stopped (stopped=" + ringStopped + ")");
    } else {
      if (token != null) {
        ringStopped = AlarmRingService.requestStop(context, id, token);
      }
      AlarmTrace.record(context, token != null ? token : ("untracked:" + id),
        "leftoverCancelled", "untracked notification cancelled; ringStopped=" + ringStopped);
    }
    return tracked;
  }

  /** 全局兜底停止：清空所有活跃投递台账并停止响铃服务与界面 */
  static synchronized void stopAll(Context context) {
    if (context == null) return;
    try {
      JSONArray rows = list(context);
      Object service = context.getSystemService(Context.NOTIFICATION_SERVICE);
      NotificationManager nm = (service instanceof NotificationManager) ? (NotificationManager) service : null;
      for (int i = 0; i < rows.length(); i++) {
        JSONObject row = rows.optJSONObject(i);
        if (row != null && nm != null) {
          nm.cancel(row.optInt("id"));
        }
      }
      android.content.SharedPreferences sp = prefs(context);
      if (sp != null) sp.edit().putString("alarms", "[]").commit();
      AlarmRingService.requestStop(context);
      AlarmActivity.stopDelivery(-1, null);
      AlarmTrace.record(context, "global", "stopAll", "all deliveries cleared and ring stopped");
    } catch (Exception ignored) {}
  }
}
