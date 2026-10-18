package space.alliswell.inbox;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;
import android.os.UserManager;
import androidx.core.app.NotificationManagerCompat;
import com.capacitorjs.plugins.localnotifications.LocalNotification;
import com.capacitorjs.plugins.localnotifications.LocalNotificationManager;
import com.capacitorjs.plugins.localnotifications.NotificationStorage;
import com.capacitorjs.plugins.localnotifications.LocalNotificationsPlugin;
import com.getcapacitor.CapConfig;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** One-shot timing only. Presentation/actions remain Capacitor ordinary notifications.
 * No Activity, foreground service, full-screen intent, repeating sound or permission changes.
 * Explicit item opt-in alone uses AlarmClockInfo and may expose the system next-alarm UI.
 */
public class NotificationScheduler extends BroadcastReceiver {
  static final String PREFS = "attention_notification_schedules";
  static final String ACTION = "space.alliswell.inbox.NOTIFICATION_DUE";
  private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

  private static SharedPreferences prefs(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  private static JSONObject read(Context context) throws Exception {
    return new JSONObject(prefs(context).getString("rows", "{}"));
  }

  private static void write(Context context, JSONObject rows) {
    if (!prefs(context).edit().putString("rows", rows.toString()).commit()) {
      throw new IllegalStateException("notification schedule persistence failed");
    }
  }

  private static AlarmManager manager(Context context) {
    AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    if (am == null) throw new IllegalStateException("AlarmManager unavailable");
    return am;
  }

  private static Intent intent(Context context, int id, String token) {
    return new Intent(context, NotificationScheduler.class).setAction(ACTION)
      .putExtra("id", id).putExtra("token", token);
  }

  private static int immutable() {
    return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
  }

  static synchronized JSObject schedule(Context context, JSObject notification, long at,
                                        String basis, String localTrigger) throws Exception {
    if (notification == null || !notification.has("id") || at <= 0) {
      throw new IllegalArgumentException("missing ordinary notification/id/time");
    }
    JSONObject extra = notification.optJSONObject("extra");
    String kind = extra == null ? "" : extra.optString("managedKind");
    if ((!"attention-reminder".equals(kind) && !"review-session".equals(kind))
      || (extra != null && extra.optBoolean("useAlarm"))) {
      throw new IllegalArgumentException("not an ordinary managed notification");
    }
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
      throw new IllegalStateException("notifications disabled");
    }
    // Validate the real renderer input before accepting/persisting it.
    LocalNotification.buildNotificationFromJSObject(notification);
    int id = notification.getInt("id");
    String token = id + ":" + UUID.randomUUID();
    JSONObject row = new JSONObject().put("notification", new JSONObject(notification.toString()))
      .put("id", id).put("token", token).put("triggerAt", Math.max(System.currentTimeMillis() + 500, at))
      .put("plannedAt", at).put("scheduleBasis", basis == null ? "wall-clock" : basis)
      .put("localTrigger", localTrigger == null ? "" : localTrigger)
      .put("elapsedAt", SystemClock.elapsedRealtime() + Math.max(500, at - System.currentTimeMillis()))
      .put("bootId", AlarmRingService.getBootId());
    JSONObject rows = read(context);
    JSONObject previous = rows.optJSONObject(String.valueOf(id));
    rows.put(String.valueOf(id), row);
    write(context, rows); // Never report accepted before durable storage.
    AlarmTrace.record(context, token, "notificationRequested", identity(row));
    try {
      install(context, row);
      rows.put(String.valueOf(id), row);
      write(context, rows);
    } catch (Exception error) {
      if (previous == null) cancel(context, id);
      else {
        rows.put(String.valueOf(id), previous);
        write(context, rows);
        try { install(context, previous); write(context, rows); }
        catch (Exception recoveryError) {
          previous.put("mode", "restoreFailed").put("exact", false);
          rows.put(String.valueOf(id), previous); write(context, rows);
          AlarmTrace.record(context, previous.optString("token"), "notificationRestoreFailed", recoveryError.toString());
        }
      }
      AlarmTrace.record(context, token, "notificationScheduleFailed", error.toString());
      throw error;
    }
    return new JSObject().put("ok", true).put("triggerAt", row.optLong("triggerAt"))
      .put("exact", row.optBoolean("exact")).put("mode", row.optString("mode"))
      .put("token", token).put("systemNextAlarm", "alarmClockNotification".equals(row.optString("mode")));
  }

  private static void install(Context context, JSONObject row) throws Exception {
    int id = row.getInt("id");
    long at = row.getLong("triggerAt");
    String token = row.getString("token");
    AlarmManager am = manager(context);
    PendingIntent pi = PendingIntent.getBroadcast(context, id, intent(context, id, token),
      PendingIntent.FLAG_UPDATE_CURRENT | immutable());
    boolean exact = false;
    boolean systemNextAlarm = false;
    JSONObject extra = row.getJSONObject("notification").optJSONObject("extra");
    // Strict opt-in; review is always standard even if an external payload adds true.
    boolean punctual = extra != null && "attention-reminder".equals(extra.optString("managedKind"))
      && Boolean.TRUE.equals(extra.opt("punctual_reminder"));
    boolean exactPermission = AlarmScheduler.canScheduleExactAlarms(context);
    if (punctual && exactPermission) {
      try {
        PendingIntent show = PendingIntent.getActivity(context, id,
          new Intent(context, MainActivity.class).setAction("space.alliswell.inbox.SHOW_NOTIFICATION_TIME")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP),
          PendingIntent.FLAG_UPDATE_CURRENT | immutable());
        am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), pi);
        exact = true;
        systemNextAlarm = true;
      } catch (SecurityException error) {
        AlarmTrace.record(context, token, "notificationExactUnavailable", error.toString());
      }
    }
    boolean elapsed = "elapsed".equals(row.optString("scheduleBasis"));
    int type = elapsed ? AlarmManager.ELAPSED_REALTIME_WAKEUP : AlarmManager.RTC_WAKEUP;
    long trigger = elapsed ? row.getLong("elapsedAt") : at;
    if (!exact && exactPermission) {
      try {
        if (Build.VERSION.SDK_INT >= 23) am.setExactAndAllowWhileIdle(type, trigger, pi);
        else am.setExact(type, trigger, pi);
        exact = true;
      } catch (SecurityException error) {
        AlarmTrace.record(context, token, "notificationExactUnavailable", error.toString());
      }
    }
    if (!exact) {
      if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(type, trigger, pi);
      else am.set(type, trigger, pi);
    }
    String mode = systemNextAlarm ? "alarmClockNotification" : exact ? "exactNotification" : "inexactNotification";
    row.put("exact", exact).put("mode", mode);
    AlarmTrace.record(context, token, "notificationScheduled", identity(row) + ";triggerAt=" + at
      + ";mode=" + mode + ";systemNextAlarm=" + systemNextAlarm);
  }

  private static java.util.List<String> keys(JSONObject rows) {
    java.util.List<String> out = new java.util.ArrayList<>();
    java.util.Iterator<String> it = rows.keys();
    while (it.hasNext()) out.add(it.next());
    return out;
  }

  static synchronized JSONArray pending(Context context) throws Exception {
    JSONObject rows = read(context);
    JSONArray out = new JSONArray();
    for (String key : keys(rows)) {
      JSONObject row = rows.getJSONObject(key);
      JSONObject n = new JSONObject(row.getJSONObject("notification").toString());
      n.put("nativeTiming", new JSONObject().put("exact", row.optBoolean("exact"))
        .put("mode", row.optString("mode")).put("token", row.optString("token"))
        .put("systemNextAlarm", "alarmClockNotification".equals(row.optString("mode")))
        .put("state", row.optString("state", "pending")).put("failure", row.optString("failure"))
        .put("attempts", row.optInt("attempts")));
      out.put(n);
    }
    return out;
  }

  static synchronized void cancel(Context context, int id) throws Exception {
    // Invalidate durably before cancelling so an already queued broadcast cannot notify.
    JSONObject rows = read(context);
    JSONObject old = rows.optJSONObject(String.valueOf(id));
    rows.remove(String.valueOf(id));
    write(context, rows);
    PendingIntent pi = PendingIntent.getBroadcast(context, id, intent(context, id, ""),
      PendingIntent.FLAG_NO_CREATE | immutable());
    if (pi != null) { manager(context).cancel(pi); pi.cancel(); }
    if (old != null) AlarmTrace.record(context, old.optString("token"), "notificationCancelled", identity(old));
  }

  static String identity(JSONObject row) {
    JSONObject n = row.optJSONObject("notification");
    JSONObject e = n == null ? null : n.optJSONObject("extra");
    return "id=" + row.optInt("id") + ";itemId=" + (e == null ? "" : e.optString("itemId"))
      + ";itemRev=" + (e == null ? "" : e.optString("itemRev"))
      + ";reminderKey=" + (e == null ? "" : e.optString("reminderKey"));
  }

  /** Failed rows remain cancellable and supply matched missed evidence while current.
   * There is no native retry timer: existing JS lostAt policy permits only one recovery.
   * A crash in 'delivering' is ambiguous and must NOT be automatically retried.
   */
  static synchronized JSONArray failedDeliveries(Context context) throws Exception {
    JSONArray out = new JSONArray();
    JSONObject rows = read(context);
    for (String key : keys(rows)) {
      JSONObject row = rows.getJSONObject(key);
      if (!"failed".equals(row.optString("state"))) continue;
      JSONObject extra = row.getJSONObject("notification").optJSONObject("extra");
      if (extra == null || extra.optString("reminderKey").isEmpty()) continue;
      out.put(new JSONObject().put("id", row.optInt("id")).put("itemId", extra.optString("itemId"))
        .put("itemRev", extra.optString("itemRev")).put("reminderKey", extra.optString("reminderKey"))
        .put("triggerAt", row.optLong("plannedAt")).put("token", row.optString("token"))
        .put("missedAt", row.optLong("failedAt")).put("reason", "notification_render_failed")
        .put("failure", row.optString("failure")));
    }
    return out;
  }

  static synchronized void deliver(Context context, int id, String token) throws Exception {
    JSONObject rows = read(context);
    JSONObject row = rows.optJSONObject(String.valueOf(id));
    if (row == null || !row.optString("token").equals(token)
      || !"pending".equals(row.optString("state", "pending"))) return;
    AlarmTrace.record(context, token, "notificationReceived", identity(row));
    // Durable one-shot claim; a duplicate, restart or restore cannot invoke the renderer again.
    row.put("state", "delivering").put("attempts", row.optInt("attempts") + 1);
    rows.put(String.valueOf(id), row);
    write(context, rows);
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
      rows.remove(String.valueOf(id));
      write(context, rows);
      AlarmTrace.record(context, token, "notificationBlocked", "notifications disabled; not delivered");
      return;
    }
    JSObject source = new JSObject(row.getJSONObject("notification").toString());
    try {
      // Suppress the renderer's premature 'received' callback, not ordinary actions.
      JSObject rendering = new JSObject(source.toString());
      rendering.getJSONObject("extra").put("nativeReceiptPending", true);
      LocalNotification n = LocalNotification.buildNotificationFromJSObject(rendering);
      n.setSchedule(null);
      LocalNotificationManager renderer = new LocalNotificationManager(new NotificationStorage(context),
        null, context, CapConfig.loadFromAssets(context, null));
      JSONArray result = renderer.schedule(null, Collections.singletonList(n));
      if (result == null || result.length() != 1) throw new IllegalStateException("ordinary notification not posted");
    } catch (Exception error) {
      row.put("state", "failed").put("mode", "deliveryFailed").put("exact", false)
        .put("failedAt", System.currentTimeMillis()).put("failure", error.getClass().getSimpleName());
      JSONObject latest = read(context);
      JSONObject current = latest.optJSONObject(String.valueOf(id));
      if (current != null && token.equals(current.optString("token"))) {
        latest.put(String.valueOf(id), row);
        write(context, latest);
      }
      AlarmTrace.record(context, token, "notificationRenderFailed", identity(row) + ";failure=" + row.optString("failure"));
      throw error;
    }
    // Publication succeeded. Later bookkeeping/callback failures must not request re-publication.
    AlarmTrace.record(context, token, "notificationPosted", identity(row) + ";visibility=unverified");
    JSONObject extra = source.optJSONObject("extra");
    if (extra != null && extra.has("reminderKey")) {
      DeliveryEvidenceStore.record(context, extra.optString("itemId"), extra.optString("reminderKey"),
        row.optLong("plannedAt"), "notification", extra.optString("itemRev"), token);
    }
    JSONObject latest = read(context);
    JSONObject current = latest.optJSONObject(String.valueOf(id));
    if (current != null && token.equals(current.optString("token"))) latest.remove(String.valueOf(id));
    try { write(context, latest); }
    catch (Exception error) {
      AlarmTrace.record(context, token, "notificationCompletionUnconfirmed", identity(row));
      throw error; // persisted 'delivering' remains non-retryable/diagnostic
    }
    try { LocalNotificationsPlugin.fireReceived(source); }
    catch (Exception error) { AlarmTrace.record(context, token, "notificationReceiptCallbackFailed", identity(row)); }
  }

  static long restoredAt(JSONObject row, String reason, long now, long elapsed, String boot) {
    long at = row.optLong("triggerAt");
    if ("elapsed".equals(row.optString("scheduleBasis"))) {
      if (!boot.isEmpty() && boot.equals(row.optString("bootId"))) {
        return now + row.optLong("elapsedAt") - elapsed;
      }
    } else if (Intent.ACTION_TIMEZONE_CHANGED.equals(reason)) {
      return SystemBridgePlugin.parseLocalTriggerInCurrentZone(row.optString("localTrigger"), at);
    }
    return at;
  }

  static synchronized void restore(Context context, String reason) throws Exception {
    JSONObject rows = read(context);
    for (String key : new java.util.ArrayList<>(keys(rows))) {
      JSONObject row = rows.getJSONObject(key);
      if (!"pending".equals(row.optString("state", "pending"))) continue;
      long at = restoredAt(row, reason, System.currentTimeMillis(), SystemClock.elapsedRealtime(), AlarmRingService.getBootId());
      if (at <= System.currentTimeMillis()) {
        JSONObject e = row.getJSONObject("notification").optJSONObject("extra");
        JSONObject missed = e == null ? new JSONObject() : new JSONObject(e.toString());
        missed.put("id", row.optInt("id"));
        SystemBridgePlugin.recordMissedAlarm(context, missed, "notification_restore_expired", at, System.currentTimeMillis());
        cancel(context, row.getInt("id"));
        rows.remove(key);
        AlarmTrace.record(context, row.optString("token"), "notificationRestoreExpired", identity(row));
        continue;
      }
      row.put("triggerAt", at).put("elapsedAt", SystemClock.elapsedRealtime() + at - System.currentTimeMillis())
        .put("bootId", AlarmRingService.getBootId());
      try {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
          throw new IllegalStateException("notifications disabled during restore");
        }
        install(context, row);
      }
      catch (Exception error) {
        row.put("exact", false).put("mode", "restoreFailed");
        AlarmTrace.record(context, row.optString("token"), "notificationRestoreFailed", error.toString());
      }
      rows.put(key, row);
      write(context, rows);
    }
  }

  @Override public void onReceive(Context context, Intent input) {
    if (context == null || input == null) return;
    String action = input.getAction();
    if (!ACTION.equals(action) && !Intent.ACTION_BOOT_COMPLETED.equals(action)
      && !Intent.ACTION_USER_UNLOCKED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
      && !Intent.ACTION_TIME_CHANGED.equals(action) && !Intent.ACTION_TIMEZONE_CHANGED.equals(action)
      && !AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(action)) return;
    if (Build.VERSION.SDK_INT >= 24) {
      UserManager user = (UserManager) context.getSystemService(Context.USER_SERVICE);
      if (user != null && !user.isUserUnlocked()) return; // CE private payload; defer until first unlock.
    }
    PendingResult pending = goAsync();
    EXECUTOR.execute(() -> {
      try {
        if (ACTION.equals(action)) deliver(context, input.getIntExtra("id", 0), input.getStringExtra("token"));
        else restore(context, action);
      } catch (Exception error) {
        AlarmTrace.record(context, input.getStringExtra("token"), "notificationFailed", error.toString());
      } finally { if (pending != null) pending.finish(); }
    });
  }
}
