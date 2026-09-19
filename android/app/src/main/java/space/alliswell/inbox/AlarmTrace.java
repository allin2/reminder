package space.alliswell.inbox;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

/** Bounded, durable per-delivery evidence. Never contains reminder body text. */
final class AlarmTrace {
  static final String EXTRA = "alarmTraceToken";
  static final String TEST = "alarmTraceTest";
  private static final int MAX_GLOBAL_EVENTS = 150;
  private static final int MAX_PER_TOKEN_EVENTS = 25;

  static synchronized void record(Context c, String token, String stage, String detail) {
    if (c == null || token == null || token.isEmpty()) return;
    try {
      android.content.SharedPreferences p = DirectBootUtils.getSafeSharedPreferences(c, "alarm_trace", Context.MODE_PRIVATE);
      if (p == null) return;
      JSONArray old = new JSONArray(p.getString("events", "[]"));

      // 治理高频抖动与重复事件：相同 token、相同 stage、相同 detail 的连续事件进行计数合并
      if (old.length() > 0) {
        JSONObject last = old.optJSONObject(old.length() - 1);
        if (last != null
            && token.equals(last.optString("token"))
            && stage.equals(last.optString("stage"))
            && (detail == null ? "" : detail).equals(last.optString("detail"))) {
          int count = last.optInt("count", 1) + 1;
          last.put("count", count);
          last.put("lastAt", System.currentTimeMillis());
          p.edit().putString("events", old.toString()).apply();
          return;
        }
      }

      // 新事件
      JSONObject newEvent = new JSONObject();
      newEvent.put("token", token);
      newEvent.put("stage", stage);
      newEvent.put("at", System.currentTimeMillis());
      newEvent.put("detail", detail == null ? "" : detail);

      // 统计既有事件
      java.util.List<JSONObject> list = new java.util.ArrayList<>();
      int tokenEventsCount = 0;
      for (int i = 0; i < old.length(); i++) {
        JSONObject item = old.optJSONObject(i);
        if (item != null) {
          list.add(item);
          if (token.equals(item.optString("token"))) {
            tokenEventsCount++;
          }
        }
      }
      list.add(newEvent);
      tokenEventsCount++;

      // 1. 单 token 上限控制 (MAX_PER_TOKEN_EVENTS = 25)：
      // 优先淘汰中间非关键事件，保护首部初始事实（received/ringStarted）与尾部终态事实
      while (tokenEventsCount > MAX_PER_TOKEN_EVENTS) {
        int dropIndex = -1;
        for (int i = 1; i < list.size() - 1; i++) {
          JSONObject item = list.get(i);
          if (token.equals(item.optString("token")) && !isCriticalStage(item.optString("stage"))) {
            dropIndex = i;
            break;
          }
        }
        if (dropIndex == -1) {
          for (int i = 1; i < list.size() - 1; i++) {
            JSONObject item = list.get(i);
            if (token.equals(item.optString("token"))) {
              dropIndex = i;
              break;
            }
          }
        }
        if (dropIndex != -1) {
          list.remove(dropIndex);
          tokenEventsCount--;
        } else {
          break;
        }
      }

      // 2. 全局容量控制 (MAX_GLOBAL_EVENTS = 150)：
      // 优先淘汰全局中的非关键事件，避免中间洪泛冲刷关键事实
      while (list.size() > MAX_GLOBAL_EVENTS) {
        int dropIndex = -1;
        for (int i = 0; i < list.size() - 1; i++) {
          if (!isCriticalStage(list.get(i).optString("stage"))) {
            dropIndex = i;
            break;
          }
        }
        if (dropIndex == -1) {
          dropIndex = 0;
        }
        list.remove(dropIndex);
      }

      JSONArray out = new JSONArray();
      for (JSONObject item : list) {
        out.put(item);
      }
      p.edit().putString("events", out.toString()).apply();
    } catch (Exception e) {
      android.util.Log.e("AlarmTrace", "trace write failed", e);
    }
  }

  /** 关键核心生命周期首末事实保护 */
  private static boolean isCriticalStage(String stage) {
    if (stage == null) return false;
    switch (stage) {
      case "received":
      case "ringStarted":
      case "deliveryStopped":
      case "ringAutoSilenced":
      case "fallbackAutoSilenced":
      case "mismatch-rejected":
      case "alarmExpiredMissed":
        return true;
      default:
        return false;
    }
  }

  static synchronized void cancel(Context c, int id, String reason) {
    if (c == null) return;
    try {
      JSONArray events = read(c);
      for (int i = events.length() - 1; i >= 0; i--) {
        JSONObject e = events.optJSONObject(i);
        if (e == null) continue;
        String token = e.optString("token");
        if (token.startsWith(id + ":")) {
          record(c, token, "cancelled", reason);
          return;
        }
      }
    } catch (Exception e) {
      android.util.Log.e("AlarmTrace", "cancel trace failed", e);
    }
  }

  static synchronized JSONArray read(Context c) throws Exception {
    if (c == null) return new JSONArray();
    android.content.SharedPreferences p = DirectBootUtils.getSafeSharedPreferences(c, "alarm_trace", Context.MODE_PRIVATE);
    return p != null ? new JSONArray(p.getString("events", "[]")) : new JSONArray();
  }

  static synchronized void clear(Context c) {
    if (c == null) return;
    try {
      android.content.SharedPreferences p = DirectBootUtils.getSafeSharedPreferences(c, "alarm_trace", Context.MODE_PRIVATE);
      if (p != null) p.edit().clear().apply();
    } catch (Exception ignored) {}
  }
}
