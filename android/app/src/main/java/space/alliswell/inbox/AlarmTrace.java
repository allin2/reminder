package space.alliswell.inbox;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

/** Bounded, durable per-delivery evidence. Never contains reminder body text. */
final class AlarmTrace {
  static final String EXTRA = "alarmTraceToken";
  static final String TEST = "alarmTraceTest";
  static synchronized void record(Context c, String token, String stage, String detail) {
    if (token == null || token.isEmpty()) return;
    try {
      android.content.SharedPreferences p = c.getSharedPreferences("alarm_trace", Context.MODE_PRIVATE);
      JSONArray old = new JSONArray(p.getString("events", "[]"));
      JSONArray out = new JSONArray();
      for (int i = Math.max(0, old.length() - 149); i < old.length(); i++) out.put(old.get(i));
      JSONObject e = new JSONObject();
      e.put("token", token); e.put("stage", stage); e.put("at", System.currentTimeMillis());
      e.put("detail", detail == null ? "" : detail);
      out.put(e);
      p.edit().putString("events", out.toString()).commit();
    } catch (Exception e) { android.util.Log.e("AlarmTrace", "trace write failed", e); }
  }
  static synchronized void cancel(Context c, int id, String reason) {
    try {
      JSONArray events = read(c);
      for (int i = events.length() - 1; i >= 0; i--) {
        JSONObject e = events.getJSONObject(i);
        String token = e.optString("token");
        if (token.startsWith(id + ":")) {
          record(c, token, "cancelled", reason); return;
        }
      }
    } catch (Exception e) { android.util.Log.e("AlarmTrace", "cancel trace failed", e); }
  }
  static synchronized JSONArray read(Context c) throws Exception {
    return new JSONArray(c.getSharedPreferences("alarm_trace", Context.MODE_PRIVATE).getString("events", "[]"));
  }
}
