package space.alliswell.inbox;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import android.util.Log;

@CapacitorPlugin(
  name = "SystemBridge",
  permissions = {
    @Permission(
      alias = "notifications",
      strings = { Manifest.permission.POST_NOTIFICATIONS }
    )
  }
)
public class SystemBridgePlugin extends Plugin {
  private static final String TAG = "SystemBridgePlugin";

  public static final String CHANNEL_ID = "attention-bridge-v2";
  public static final String CHANNEL_NAME = "提醒测试";
  public static final int REQ_NOTIFY = 21001;
  public static final int REQ_EXACT = 21002;

  /** P1-4 & Phase D：已排全屏闹钟的持久化记录架构（schemaVersion: 1） */
  public static final String PREFS_SCHEDULES = "attention_alarm_schedules";
  public static final String KEY_ALARMS = "alarms";
  public static final String KEY_MISSED_ALARMS = "missed_alarms";
  public static final String KEY_SCHEMA_VERSION = "schemaVersion";
  public static final int CURRENT_SCHEMA_VERSION = 1;
  public static final String BASIS_WALL_CLOCK = "wall-clock";
  public static final String BASIS_ELAPSED = "elapsed";

  public static final String PREFS_DIRECT_BOOT = "attention_direct_boot_schedules";

  private static Context getDeviceProtectedContext(Context context) {
    if (context == null) return null;
    if (Build.VERSION.SDK_INT >= 24) {
      return context.createDeviceProtectedStorageContext();
    }
    return context;
  }

  /** P1-4：记录一条已排闹钟（同 id 覆盖）。V02：一并持久化数据版本 */
  static synchronized void persistAlarm(Context context, int id, long triggerAt,
                                        String title, String body, String itemId, String level) {
    persistAlarm(context, id, triggerAt, title, body, itemId, level, "0");
  }

  static synchronized void persistAlarm(Context context, int id, long triggerAt, String title,
                                        String body, String itemId, String level, String itemRev) {
    persistAlarm(context, id, triggerAt, null, BASIS_WALL_CLOCK, title, body, itemId, level, itemRev);
  }

  /** Phase D & F5：完整元数据持久化，并同步维护 Direct Boot 最小不含隐私镜像 */
  static synchronized void persistAlarm(Context context, int id, long triggerAtMs,
                                        String localTrigger, String scheduleBasis,
                                        String title, String body, String itemId,
                                        String level, String itemRev) {
    persistAlarm(context, id, triggerAtMs, localTrigger, scheduleBasis, title, body, itemId,
      level, itemRev, "");
  }

  /**
   * UX-T03：把提醒键一起落盘。
   *
   * 开机恢复 / 恢复对账都会**重排**闹钟（`kept` 那两条路径）。如果键只活在
   * 首次排程的 Intent 里，重排之后这次投递在证据台账里就没有身份了 ——
   * 表现是「重启后响过的那次提醒查不到结果」。
   */
  static synchronized void persistAlarm(Context context, int id, long triggerAtMs,
                                        String localTrigger, String scheduleBasis,
                                        String title, String body, String itemId,
                                        String level, String itemRev, String reminderKey) {
    if (context == null) return;
    try {
      SharedPreferences prefs = context.getSharedPreferences(PREFS_SCHEDULES, Context.MODE_PRIVATE);
      JSONArray arr = new JSONArray(prefs.getString(KEY_ALARMS, "[]"));
      JSONArray out = new JSONArray();
      for (int i = 0; i < arr.length(); i++) {
        JSONObject o = arr.optJSONObject(i);
        if (o != null && o.optInt("id", 0) != id) out.put(o);
      }
      JSONObject entry = new JSONObject();
      entry.put("id", id);
      entry.put("triggerAtMs", triggerAtMs);
      entry.put("triggerAt", triggerAtMs); // backwards compatibility
      String basis = (scheduleBasis == null || scheduleBasis.isEmpty()) ? BASIS_WALL_CLOCK : scheduleBasis;
      entry.put("scheduleBasis", basis);

      long delayMs = Math.max(0L, triggerAtMs - System.currentTimeMillis());
      long elapsedTriggerAtMs = android.os.SystemClock.elapsedRealtime() + delayMs;
      String bootId = AlarmRingService.getBootId();
      entry.put("elapsedTriggerAtMs", elapsedTriggerAtMs);
      entry.put("durationMs", delayMs);
      entry.put("bootId", bootId);

      String local = localTrigger;
      if (local == null || local.isEmpty()) {
        try {
          SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault());
          local = sdf.format(new Date(triggerAtMs));
        } catch (Exception ignored) {
          local = "";
        }
      }
      entry.put("localTrigger", local);
      entry.put("title", title == null ? "" : title);
      entry.put("body", body == null ? "" : body);
      entry.put("itemId", itemId == null ? "" : itemId);
      entry.put("level", level == null ? "" : level);
      entry.put("itemRev", itemRev == null || itemRev.isEmpty() ? "0" : itemRev);
      // UX-T03：提醒键不是隐私内容（只是 `<轮次>@<原定时刻>`），两条镜像都带上
      entry.put("reminderKey", reminderKey == null ? "" : reminderKey);
      out.put(entry);
      prefs.edit()
        .putInt(KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION)
        .putString(KEY_ALARMS, out.toString())
        .apply();

      // F5：同步维护 Device Protected Storage 最小镜像（无私密标题与正文）
      try {
        Context deCtx = getDeviceProtectedContext(context);
        if (deCtx != null) {
          SharedPreferences dePrefs = deCtx.getSharedPreferences(PREFS_DIRECT_BOOT, Context.MODE_PRIVATE);
          JSONArray deArr = new JSONArray(dePrefs.getString(KEY_ALARMS, "[]"));
          JSONArray deOut = new JSONArray();
          for (int i = 0; i < deArr.length(); i++) {
            JSONObject o = deArr.optJSONObject(i);
            if (o != null && o.optInt("id", 0) != id) deOut.put(o);
          }
          JSONObject deEntry = new JSONObject();
          deEntry.put("id", id);
          deEntry.put("triggerAtMs", triggerAtMs);
          deEntry.put("triggerAt", triggerAtMs);
          deEntry.put("scheduleBasis", basis);
          deEntry.put("elapsedTriggerAtMs", elapsedTriggerAtMs);
          deEntry.put("durationMs", delayMs);
          deEntry.put("bootId", bootId);
          deEntry.put("localTrigger", local);
          deEntry.put("itemId", itemId == null ? "" : itemId);
          deEntry.put("level", level == null ? "" : level);
          deEntry.put("itemRev", itemRev == null || itemRev.isEmpty() ? "0" : itemRev);
          deEntry.put("reminderKey", reminderKey == null ? "" : reminderKey);
          deOut.put(deEntry);
          dePrefs.edit()
            .putInt(KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION)
            .putString(KEY_ALARMS, deOut.toString())
            .apply();
        }
      } catch (Exception deError) {
        Log.w(TAG, "persistAlarm to DE storage failed", deError);
      }
    } catch (Exception e) {
      Log.e(TAG, "persistAlarm failed", e);
    }
  }

  /** P1-4 & F5：撤销记录（同时清理 CE 与 DE 镜像） */
  static synchronized void forgetAlarm(Context context, int id) {
    if (context == null) return;
    try {
      SharedPreferences prefs = context.getSharedPreferences(PREFS_SCHEDULES, Context.MODE_PRIVATE);
      JSONArray arr = new JSONArray(prefs.getString(KEY_ALARMS, "[]"));
      JSONArray out = new JSONArray();
      for (int i = 0; i < arr.length(); i++) {
        JSONObject o = arr.optJSONObject(i);
        if (o != null && o.optInt("id", 0) != id) out.put(o);
      }
      prefs.edit().putString(KEY_ALARMS, out.toString()).apply();

      try {
        Context deCtx = getDeviceProtectedContext(context);
        if (deCtx != null) {
          SharedPreferences dePrefs = deCtx.getSharedPreferences(PREFS_DIRECT_BOOT, Context.MODE_PRIVATE);
          JSONArray deArr = new JSONArray(dePrefs.getString(KEY_ALARMS, "[]"));
          JSONArray deOut = new JSONArray();
          for (int i = 0; i < deArr.length(); i++) {
            JSONObject o = deArr.optJSONObject(i);
            if (o != null && o.optInt("id", 0) != id) deOut.put(o);
          }
          dePrefs.edit().putString(KEY_ALARMS, deOut.toString()).apply();
        }
      } catch (Exception ignored) {}
    } catch (Exception ignored) {}
  }

  /** P1-4：开机 / 应用更新后重排仍未来的闹钟，丢弃已过期的 */
  static synchronized void restorePersistedAlarms(Context context) {
    restorePersistedAlarms(context, "boot");
  }

  /** F5：Direct Boot 锁定开机状态下从 DE 最小镜像恢复排程（无私密标题与正文） */
  static synchronized void restoreDirectBootAlarms(Context deContext, String reason) {
    if (deContext == null) return;
    try {
      SharedPreferences dePrefs = deContext.getSharedPreferences(PREFS_DIRECT_BOOT, Context.MODE_PRIVATE);
      JSONArray arr = new JSONArray(dePrefs.getString(KEY_ALARMS, "[]"));
      JSONArray kept = new JSONArray();
      long now = System.currentTimeMillis();
      long currentElapsed = android.os.SystemClock.elapsedRealtime();
      String currentBootId = AlarmRingService.getBootId();
      boolean isTimezoneChange = Intent.ACTION_TIMEZONE_CHANGED.equals(reason);

      for (int i = 0; i < arr.length(); i++) {
        JSONObject o = arr.optJSONObject(i);
        if (o == null) continue;
        int id = o.optInt("id", 0);
        if (id == 0) continue;

        long triggerAt = o.optLong("triggerAtMs", o.optLong("triggerAt", 0L));
        String basis = o.optString("scheduleBasis", BASIS_WALL_CLOCK);
        String localTrigger = o.optString("localTrigger", "");
        long elapsedTriggerAtMs = o.optLong("elapsedTriggerAtMs", 0L);
        String itemBootId = o.optString("bootId", "");

        boolean isElapsed = BASIS_ELAPSED.equals(basis);
        boolean sameBoot = (!itemBootId.isEmpty() && itemBootId.equals(currentBootId))
            || (elapsedTriggerAtMs > 0 && elapsedTriggerAtMs > currentElapsed);

        if (isElapsed) {
          if (sameBoot) {
            long remainingMs = elapsedTriggerAtMs - currentElapsed;
            if (remainingMs <= 0) {
              continue;
            }
            triggerAt = now + remainingMs;
            o.put("triggerAtMs", triggerAt);
            o.put("triggerAt", triggerAt);
            o.put("bootId", currentBootId);
          } else {
            if (triggerAt <= now) {
              continue;
            }
            long remainingMs = triggerAt - now;
            elapsedTriggerAtMs = currentElapsed + remainingMs;
            o.put("elapsedTriggerAtMs", elapsedTriggerAtMs);
            o.put("bootId", currentBootId);
          }
        } else {
          if (isTimezoneChange && !localTrigger.isEmpty()) {
            long recalculated = parseLocalTriggerInCurrentZone(localTrigger, triggerAt);
            if (recalculated > 0L) {
              triggerAt = recalculated;
              o.put("triggerAtMs", triggerAt);
              o.put("triggerAt", triggerAt);
            }
          }
          if (triggerAt <= now) {
            continue;
          }
        }

        try {
          String rev = o.optString("itemRev", "0");
          // UX-T03：重排必须沿用**原来的提醒身份与计划时刻** —— 换一个身份
          // 会让重启后真正响过的那次提醒查不到结果（证据落在没人问津的键上）。
          AlarmScheduler.schedule(deContext, triggerAt, "提醒", "",
            id, o.optString("itemId"), o.optString("level"),
            rev == null || rev.isEmpty() ? "0" : rev, basis, elapsedTriggerAtMs,
            o.optString("reminderKey", ""), triggerAt);
          kept.put(o);
        } catch (Exception itemError) {
          kept.put(o);
          Log.w(TAG, "DirectBoot restore failed for item " + id, itemError);
        }
      }
      dePrefs.edit().putString(KEY_ALARMS, kept.toString()).apply();
    } catch (Exception e) {
      Log.e(TAG, "restoreDirectBootAlarms failed", e);
    }
  }

  /** Phase D & D3：系统事件恢复（支持开机、更新、时区变更与时间调整，带单项异常隔离、防群响与失败保留重试） */
  static synchronized void restorePersistedAlarms(Context context, String reason) {
    if (context == null) return;
    try {
      SharedPreferences prefs = context.getSharedPreferences(PREFS_SCHEDULES, Context.MODE_PRIVATE);
      JSONArray arr = new JSONArray(prefs.getString(KEY_ALARMS, "[]"));
      JSONArray kept = new JSONArray();
      long now = System.currentTimeMillis();
      long currentElapsed = android.os.SystemClock.elapsedRealtime();
      String currentBootId = AlarmRingService.getBootId();
      boolean isTimezoneChange = Intent.ACTION_TIMEZONE_CHANGED.equals(reason);

      for (int i = 0; i < arr.length(); i++) {
        try {
          JSONObject o = arr.optJSONObject(i);
          if (o == null) continue;
          int id = o.optInt("id", 0);
          if (id == 0) continue;

          long triggerAt = o.optLong("triggerAtMs", o.optLong("triggerAt", 0L));
          String basis = o.optString("scheduleBasis", BASIS_WALL_CLOCK);
          String localTrigger = o.optString("localTrigger", "");
          long elapsedTriggerAtMs = o.optLong("elapsedTriggerAtMs", 0L);
          String itemBootId = o.optString("bootId", "");

          boolean isElapsed = BASIS_ELAPSED.equals(basis);
          boolean sameBoot = (!itemBootId.isEmpty() && itemBootId.equals(currentBootId))
              || (elapsedTriggerAtMs > 0 && elapsedTriggerAtMs > currentElapsed);

          if (isElapsed) {
            // R2-02：elapsed 语义在同次开机内严格按单调时钟计算剩余时长；不受用户前拨、回拨系统时钟或修改时区的影响
            if (sameBoot) {
              long remainingMs = elapsedTriggerAtMs - currentElapsed;
              if (remainingMs <= 0) {
                // 已在当前开机周期内自然到期
                recordMissedAlarm(context, o, reason, triggerAt, now);
                AlarmTrace.record(context, id + ":missed", "alarmElapsedExpired",
                  "reason=" + reason + ";elapsedTriggerAtMs=" + elapsedTriggerAtMs + ";now=" + now);
                continue;
              }
              // 未到期：重新校准对应的绝对时刻（供 AlarmClock/通知展示），保持剩余时长绝对不变
              triggerAt = now + remainingMs;
              o.put("triggerAtMs", triggerAt);
              o.put("triggerAt", triggerAt);
              o.put("bootId", currentBootId);
            } else {
              // 跨真机重启恢复：利用关机前的绝对时刻判断关机期间是否已跨过目标时刻
              if (triggerAt <= now) {
                // 关机期间已过期：遵守防群响政策，绝不集中补响，记录 missed
                recordMissedAlarm(context, o, "reboot_expired", triggerAt, now);
                AlarmTrace.record(context, id + ":missed", "alarmRebootExpired",
                  "reason=" + reason + ";triggerAt=" + triggerAt + ";now=" + now);
                continue;
              }
              // 重启后仍在未来：按关机前约定的绝对时刻在新开机会话中重新锚定单调时钟
              long remainingMs = triggerAt - now;
              elapsedTriggerAtMs = currentElapsed + remainingMs;
              o.put("elapsedTriggerAtMs", elapsedTriggerAtMs);
              o.put("bootId", currentBootId);
            }
          } else {
            // wall-clock 语义：时区变更时按本地日历格式重新换算绝对时间戳
            if (isTimezoneChange && !localTrigger.isEmpty()) {
              long recalculated = parseLocalTriggerInCurrentZone(localTrigger, triggerAt);
              if (recalculated > 0L) {
                triggerAt = recalculated;
                o.put("triggerAtMs", triggerAt);
                o.put("triggerAt", triggerAt);
              }
            }

            // 防群响治理：已过期的闹钟绝不重排（AlarmManager 对过去时刻会集体立即起响）
            if (triggerAt <= now) {
              recordMissedAlarm(context, o, reason, triggerAt, now);
              AlarmTrace.record(context, id + ":missed", "alarmExpiredMissed",
                "reason=" + reason + ";triggerAt=" + triggerAt + ";now=" + now);
              continue;
            }
          }

          String rev = o.optString("itemRev", "0");
          try {
            // UX-T03：同 DirectBoot 恢复 —— 重排沿用原身份与计划时刻
            AlarmScheduler.schedule(context, triggerAt, o.optString("title"), o.optString("body"),
              id, o.optString("itemId"), o.optString("level"),
              rev == null || rev.isEmpty() ? "0" : rev, basis, elapsedTriggerAtMs,
              o.optString("reminderKey", ""), triggerAt);
          } catch (Exception schedErr) {
            // D3 失败重试：某条 schedule 抛错不代表数据损坏或应永久遗弃，保留在 kept 供后续恢复重试
            AlarmTrace.record(context, "restore:item" + i, "restoreItemFailed", schedErr.toString());
            Log.e(TAG, "Failed to schedule alarm item at index " + i, schedErr);
          }
          kept.put(o);
        } catch (Exception itemError) {
          // 单项异常隔离，确保坏数据不影响其他有效排程的恢复
          AlarmTrace.record(context, "restore:item" + i, "restoreItemFailed", itemError.toString());
          Log.e(TAG, "Failed to restore alarm item at index " + i, itemError);
        }
      }
      prefs.edit().putString(KEY_ALARMS, kept.toString()).apply();
    } catch (Exception e) {
      Log.e(TAG, "restorePersistedAlarms failed", e);
    }
  }

  static long parseLocalTriggerInCurrentZone(String localTrigger, long fallback) {
    if (localTrigger == null || localTrigger.length() < 16) return fallback;
    try {
      int year = Integer.parseInt(localTrigger.substring(0, 4));
      int month = Integer.parseInt(localTrigger.substring(5, 7)) - 1;
      int day = Integer.parseInt(localTrigger.substring(8, 10));
      int hour = Integer.parseInt(localTrigger.substring(11, 13));
      int min = Integer.parseInt(localTrigger.substring(14, 16));
      int sec = (localTrigger.length() >= 19) ? Integer.parseInt(localTrigger.substring(17, 19)) : 0;
      Calendar cal = Calendar.getInstance(TimeZone.getDefault());
      cal.set(year, month, day, hour, min, sec);
      cal.set(Calendar.MILLISECOND, 0);
      return cal.getTimeInMillis();
    } catch (Exception ignored) {
      return fallback;
    }
  }

  static synchronized void recordMissedAlarm(Context context, JSONObject alarmObj, String reason, long triggerAt, long now) {
    if (context == null || alarmObj == null) return;
    try {
      SharedPreferences prefs = context.getSharedPreferences(PREFS_SCHEDULES, Context.MODE_PRIVATE);
      JSONArray missed = new JSONArray(prefs.getString(KEY_MISSED_ALARMS, "[]"));
      JSONObject entry = new JSONObject();
      entry.put("id", alarmObj.optInt("id"));
      entry.put("itemId", alarmObj.optString("itemId"));
      entry.put("title", alarmObj.optString("title"));
      entry.put("triggerAt", triggerAt);
      entry.put("missedAt", now);
      entry.put("reason", reason);
      missed.put(entry);
      while (missed.length() > 50) {
        missed.remove(0);
      }
      prefs.edit().putString(KEY_MISSED_ALARMS, missed.toString()).apply();
    } catch (Exception ignored) {}
  }

  /* ---------- 全屏闹钟动作队列（取代单槽位 lastAction/lastItemId） ---------- */

  /**
   * 旧实现只用一个槽位存「最后一次动作」，且在 JS 读取时立即删除 ——
   * 连续动作（比如先「稍后」再「完成」）或消费过程中崩溃都会丢操作。
   * 改为 FIFO 队列：写入追加，消费只移除队首。
   */
  static synchronized void enqueueAlarmAction(Context context, String action, String itemId, String itemRev) {
    try {
      SharedPreferences prefs = context.getSharedPreferences(AlarmActivity.PREFS, Context.MODE_PRIVATE);
      JSONArray arr = new JSONArray(prefs.getString(AlarmActivity.KEY_ACTIONS, "[]"));
      JSONObject entry = new JSONObject();
      entry.put("id", "a" + System.currentTimeMillis() + "_" + arr.length() + "_" + (int) (Math.random() * 100000));
      entry.put("action", action == null ? "" : action);
      entry.put("itemId", itemId == null ? "" : itemId);
      entry.put("itemRev", itemRev == null ? "0" : itemRev);
      arr.put(entry);
      prefs.edit().putString(AlarmActivity.KEY_ACTIONS, arr.toString()).apply();
    } catch (Exception ignored) {}
  }

  /**
   * V09：**只读不删**。
   * 「取出即删」在 JS 处理完之前崩溃就会永久丢掉这次动作；改为由 JS 处理并落库后
   * 再调 `ackAlarmAction` 显式确认删除。兼容旧的 lastAction/lastItemId 单槽位残留。
   */
  static synchronized JSONObject peekAlarmAction(Context context) {
    try {
      SharedPreferences prefs = context.getSharedPreferences(AlarmActivity.PREFS, Context.MODE_PRIVATE);
      JSONArray arr = new JSONArray(prefs.getString(AlarmActivity.KEY_ACTIONS, "[]"));
      if (arr.length() > 0) {
        JSONObject head = arr.optJSONObject(0);
        if (head != null) return head;
      }
      String legacyAction = prefs.getString(AlarmActivity.KEY_ACTION, null);
      if (legacyAction != null) {
        String legacyItem = prefs.getString(AlarmActivity.KEY_ITEM_ID, "");
        JSONObject entry = new JSONObject();
        entry.put("id", "legacy_" + legacyAction + "_" + (legacyItem == null ? "" : legacyItem));
        entry.put("action", legacyAction);
        entry.put("itemId", legacyItem == null ? "" : legacyItem);
        entry.put("itemRev", "0");
        return entry;
      }
    } catch (Exception ignored) {}
    return null;
  }

  /** V09：JS 处理完成并落库后确认删除；同时清掉旧单槽位残留 */
  static synchronized void ackAlarmAction(Context context, String id) {
    try {
      SharedPreferences prefs = context.getSharedPreferences(AlarmActivity.PREFS, Context.MODE_PRIVATE);
      if (id == null || id.indexOf("legacy_") == 0) {
        prefs.edit().remove(AlarmActivity.KEY_ACTION).remove(AlarmActivity.KEY_ITEM_ID).apply();
        return;
      }
      JSONArray arr = new JSONArray(prefs.getString(AlarmActivity.KEY_ACTIONS, "[]"));
      JSONArray out = new JSONArray();
      for (int i = 0; i < arr.length(); i++) {
        JSONObject o = arr.optJSONObject(i);
        if (o == null) continue;
        if (id.equals(o.optString("id", ""))) continue;
        out.put(o);
      }
      prefs.edit().putString(AlarmActivity.KEY_ACTIONS, out.toString()).apply();
    } catch (Exception ignored) {}
  }

  /** R3：minSdk 22 —— 一律用字符串形式的 getSystemService，避免 API 23+ 的 Class 重载 */
  private static <T> T systemService(Context context, String name, Class<T> type) {
    Object svc = context.getSystemService(name);
    return type.isInstance(svc) ? type.cast(svc) : null;
  }

  private NotificationManager notificationManager() {
    return systemService(getContext(), Context.NOTIFICATION_SERVICE, NotificationManager.class);
  }

  private AlarmManager alarmManager() {
    return systemService(getContext(), Context.ALARM_SERVICE, AlarmManager.class);
  }

  private PowerManager powerManager() {
    return systemService(getContext(), Context.POWER_SERVICE, PowerManager.class);
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = notificationManager();
    if (nm == null) return;
    createChannelIfMissing(nm, CHANNEL_ID, CHANNEL_NAME);
    createChannelIfMissing(nm, AlarmTestReceiver.CHANNEL_ID, AlarmTestReceiver.CHANNEL_NAME);
  }

  private void createChannelIfMissing(NotificationManager nm, String id, String name) {
    if (nm.getNotificationChannel(id) != null) return;
    NotificationChannel channel = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
    channel.setDescription("系统通知与闹钟通道");
    channel.enableVibration(true);
    channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
    try {
      int soundId = getContext().getResources().getIdentifier(
        "attention_reminder", "raw", getContext().getPackageName()
      );
      if (soundId != 0) {
        Uri uri = Uri.parse("android.resource://" + getContext().getPackageName() + "/" + soundId);
        android.media.AudioAttributes attrs = new android.media.AudioAttributes.Builder()
          .setUsage(android.media.AudioAttributes.USAGE_ALARM)
          .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build();
        channel.setSound(uri, attrs);
      }
    } catch (Exception ignored) {}
    nm.createNotificationChannel(channel);
  }

  /**
   * R3：`areNotificationsEnabled()` 是 API 24 才有的 NotificationManager 方法，
   * minSdk 22 上直接调用会 NoSuchMethodError（catch(Exception) 兜不住 Error）。
   * 改用 androidx 的 NotificationManagerCompat，在所有版本上都有定义。
   */
  private boolean notificationsEnabled() {
    try {
      return NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
    } catch (Exception ignored) {}
    return true;
  }

  private boolean hasPostNotifications() {
    if (Build.VERSION.SDK_INT < 33) return true;
    return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
      == PackageManager.PERMISSION_GRANTED;
  }

  private boolean canExactAlarm() {
    if (Build.VERSION.SDK_INT < 31) return true;
    AlarmManager am = alarmManager();
    if (am == null) return false;
    try {
      if (am.canScheduleExactAlarms()) return true;
    } catch (Exception ignored) {}
    return false;
  }

  private boolean ignoringBatteryOptimizations() {
    if (Build.VERSION.SDK_INT < 23) return true;
    PowerManager pm = powerManager();
    return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
  }

  /**
   * Q3：「显示在其他应用上层」（悬浮窗）—— 解锁亮屏时全屏闹钟能不能抢到前台。
   *
   * Android 10（API 29）起，后台进程 startActivity 默认被拦（BAL）。对第三方应用，
   * 官方豁免清单里唯一可主动申请的一条就是 SYSTEM_ALERT_WINDOW：
   * 「The app has the SYSTEM_ALERT_WINDOW permission granted by the user」。
   * 没有它，`AlarmTestReceiver` 里的 startActivity 会被**静默丢弃**
   * （不抛异常，只写一行 logcat `Background activity launch blocked … BAL_BLOCK`）。
   */
  private boolean canDrawOverlays() {
    if (Build.VERSION.SDK_INT < 23) return true;
    try {
      return Settings.canDrawOverlays(getContext());
    } catch (Exception ignored) {
      return false;
    }
  }

  /**
   * Q3：Android 14（API 34）起 `USE_FULL_SCREEN_INTENT` 从普通权限变成**特殊应用访问权限**，
   * 只有通话/闹钟类应用默认授予；未授予时全屏 intent 被**静默丢弃** —— 锁屏也只得到一条横幅。
   * 官方给应用的自检入口就是 `NotificationManager#canUseFullScreenIntent()`。
   */
  private boolean canUseFullScreenIntent() {
    if (Build.VERSION.SDK_INT < 34) return true;
    try {
      NotificationManager nm = notificationManager();
      return nm != null && nm.canUseFullScreenIntent();
    } catch (Exception ignored) {
      return false;
    }
  }

  /** 闹钟渠道的重要性；-2 = 渠道尚未创建，0 = 被用户关掉，>=4 = HIGH */
  private int alarmChannelImportance() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return -1;
    NotificationManager nm = notificationManager();
    if (nm == null) return -1;
    try {
      NotificationChannel channel = nm.getNotificationChannel(AlarmTestReceiver.CHANNEL_ID);
      return channel == null ? -2 : channel.getImportance();
    } catch (Exception ignored) {
      return -1;
    }
  }

  @PluginMethod
  public void diagnose(PluginCall call) {
    JSObject result = new JSObject();
    result.put("sdkInt", Build.VERSION.SDK_INT);
    result.put("packageName", getContext().getPackageName());
    result.put("notificationsEnabled", notificationsEnabled());
    result.put("postNotificationsGranted", hasPostNotifications());
    result.put("canExactAlarm", canExactAlarm());
    result.put("ignoringBatteryOptimizations", ignoringBatteryOptimizations());
    result.put("alarmManagerAvailable", alarmManager() != null);
    result.put("notificationManagerAvailable", notificationManager() != null);
    // Q3：全屏闹钟的两道门 + 闹钟渠道状态，缺一项就只会出通知横幅
    result.put("canDrawOverlays", canDrawOverlays());
    result.put("canUseFullScreenIntent", canUseFullScreenIntent());
    result.put("alarmChannelImportance", alarmChannelImportance());
    result.put("alarmChannelId", AlarmTestReceiver.CHANNEL_ID);
    call.resolve(result);
  }

  @PluginMethod
  public void requestNotificationPermission(PluginCall call) {
    if (Build.VERSION.SDK_INT < 33) {
      JSObject r = new JSObject();
      r.put("granted", notificationsEnabled());
      call.resolve(r);
      return;
    }
    if (hasPostNotifications()) {
      JSObject r = new JSObject();
      r.put("granted", true);
      call.resolve(r);
      return;
    }
    requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
  }

  @PermissionCallback
  private void notificationPermissionCallback(PluginCall call) {
    JSObject r = new JSObject();
    r.put("granted", hasPostNotifications() && notificationsEnabled());
    call.resolve(r);
  }

  @PluginMethod
  public void showNotification(PluginCall call) {
    try {
      ensureChannel();
      if (!notificationsEnabled()) {
        call.reject("系统通知未授权");
        return;
      }
      String title = call.getString("title", "安心收件箱测试");
      String body = call.getString("body", "这是一条系统通知测试");
      int id = intArg(call, "id", 90001);
      NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setCategory(NotificationCompat.CATEGORY_ALARM)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setAutoCancel(true)
        .setDefaults(NotificationCompat.DEFAULT_ALL);
      try {
        int iconId = getContext().getResources().getIdentifier(
          "ic_stat_attention", "drawable", getContext().getPackageName()
        );
        if (iconId != 0) builder.setSmallIcon(iconId);
      } catch (Exception ignored) {}
      Intent intent = getContext().getPackageManager()
        .getLaunchIntentForPackage(getContext().getPackageName());
      if (intent != null) {
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        builder.setContentIntent(PendingIntent.getActivity(getContext(), id, intent, flags));
      }
      NotificationManager nm = notificationManager();
      if (nm == null) {
        call.reject("NotificationManager 不可用");
        return;
      }
      nm.notify(id, builder.build());
      JSObject r = new JSObject();
      r.put("ok", true);
      r.put("id", id);
      call.resolve(r);
    } catch (Exception e) {
      call.reject("发送通知失败: " + e.getMessage(), e);
    }
  }

  /**
   * Q2：**数值参数必须按 `Number` 取，不能用 `PluginCall.getLong` / `getInt`。**
   *
   * Capacitor 的取值器做了**类型精确匹配**（`PluginCall.java:224-252`）：
   *
   *     if (value instanceof Integer) return (Integer) value;   // getInt
   *     if (value instanceof Long)    return (Long) value;      // getLong
   *     return defaultValue;                                    // 其余一律静默回退
   *
   * 而 JS→Java 的 JSON 数字按**取值范围**落到 Integer 或 Long：`delayMs = 300000`
   * 是 Integer，于是 `getLong("delayMs", 10000L)` 直接命中最后一行 ——
   * **参数被静默丢弃，闹钟永远排在 10 秒后**（既不报错，日志里也看不出）。
   * 更远的时刻（delayMs > 2^31-1，约 24.8 天）反而因为成了 Long 而"恰好正确"。
   *
   * 这里统一按 Number 取值（并容忍字符串形态），与具体装箱类型解耦。
   */
  private static Object rawArg(PluginCall call, String key) {
    try {
      JSObject data = call.getData();
      return data == null ? null : data.opt(key);
    } catch (Exception ignored) {
      return null;
    }
  }

  private static long longArg(PluginCall call, String key, long fallback) {
    Object value = rawArg(call, key);
    if (value instanceof Number) return ((Number) value).longValue();
    if (value instanceof String) {
      try { return Long.parseLong(((String) value).trim()); } catch (Exception ignored) {}
    }
    return fallback;
  }

  private static int intArg(PluginCall call, String key, int fallback) {
    Object value = rawArg(call, key);
    if (value instanceof Number) return ((Number) value).intValue();
    if (value instanceof String) {
      try { return Integer.parseInt(((String) value).trim()); } catch (Exception ignored) {}
    }
    return fallback;
  }

  private String callItemId(PluginCall call) {
    String itemId = call.getString("itemId");
    if (itemId == null || itemId.isEmpty()) itemId = call.getString("item_id");
    return itemId == null ? "" : itemId;
  }

  private String callLevel(PluginCall call) {
    String level = call.getString("level");
    if (level == null || level.isEmpty()) level = "🚨 关键";
    return level;
  }

  /** L04：投递时的事项数据版本，用于识别「已被改写的旧通知」 */
  private String callItemRev(PluginCall call) {
    return String.valueOf(intArg(call, "itemRev", 0));
  }

  /**
   * UX-T03：JS 侧生成的提醒键 `<attempt>@<原定时刻>`。
   *
   * 缺省为空串而不是 null —— 这条链路上「没有身份」和「身份为空」都必须走同一条
   * 保守分支：接收侧不写证据（`DeliveryEvidenceStore.rowFor` 直接返回 null），
   * 于是这类投递的核查结论停在 unknown，而不是被当成「送达」或「漏了」。
   */
  private String callReminderKey(PluginCall call) {
    String key = call.getString("reminderKey", "");
    return key == null ? "" : key;
  }

  @PluginMethod
  public void scheduleAlarm(PluginCall call) {
    try {
      long delayMs = longArg(call, "delayMs", 10000L);
      String title = call.getString("title", "安心收件箱闹钟测试");
      String body = call.getString("body", "这是定时闹钟提醒测试");
      int id = intArg(call, "id", 90002);
      String localTrigger = call.getString("localTrigger", null);
      String scheduleBasis = call.getString("scheduleBasis", BASIS_WALL_CLOCK);
      JSObject r = scheduleAlarmInternal(delayMs, title, body, id, callItemId(call), callLevel(call), callItemRev(call), localTrigger, scheduleBasis, callReminderKey(call));
      call.resolve(r);
    } catch (Exception e) {
      call.reject("设置闹钟失败: " + e.getMessage(), e);
    }
  }

  @PluginMethod
  public void scheduleAt(PluginCall call) {
    try {
      long at = longArg(call, "at", 0L);
      String title = call.getString("title", "安心收件箱提醒");
      String body = call.getString("body", "有一条事项需要你确认");
      int id = intArg(call, "id", 90100);
      long delayMs = Math.max(500L, at - System.currentTimeMillis());
      String localTrigger = call.getString("localTrigger", null);
      String scheduleBasis = call.getString("scheduleBasis", BASIS_WALL_CLOCK);
      JSObject r = scheduleAlarmInternal(delayMs, title, body, id, callItemId(call), callLevel(call), callItemRev(call), localTrigger, scheduleBasis, callReminderKey(call));
      call.resolve(r);
    } catch (Exception e) {
      call.reject("设置定时失败: " + e.getMessage(), e);
    }
  }

  /** Phase D：查询因过期/防群响拦截的漏响记录台账 */
  @PluginMethod
  public void getMissedAlarms(PluginCall call) {
    try {
      SharedPreferences prefs = getContext().getSharedPreferences(PREFS_SCHEDULES, Context.MODE_PRIVATE);
      JSONArray missed = new JSONArray(prefs.getString(KEY_MISSED_ALARMS, "[]"));
      JSObject r = new JSObject();
      r.put("missed", missed);
      call.resolve(r);
    } catch (Exception e) {
      call.reject("读取漏响记录失败: " + e.getMessage(), e);
    }
  }

  /**
   * JS 轮询消费全屏闹钟动作（D11/D12）。
   * V09：只**读取**队首并带回事件 id，不在这里删除 —— 由 `ackAlarmAction` 在 JS 落库后确认。
   */
  @PluginMethod
  public void consumeAlarmAction(PluginCall call) {
    try {
      JSONObject head = peekAlarmAction(getContext());
      JSObject r = new JSObject();
      if (head != null) {
        r.put("action", head.optString("action", ""));
        r.put("itemId", head.optString("itemId", ""));
        String rev = head.optString("itemRev", "0");
        r.put("itemRev", rev.isEmpty() ? "0" : rev);
        r.put("id", head.optString("id", ""));
      } else {
        r.put("action", "");
      }
      call.resolve(r);
    } catch (Exception e) {
      call.reject("读取闹钟动作失败", e);
    }
  }

  /** V09：JS 成功处理并持久化后确认删除该事件 */
  @PluginMethod
  public void ackAlarmAction(PluginCall call) {
    try {
      String id = call.getString("id");
      ackAlarmAction(getContext(), id);
      JSObject r = new JSObject();
      r.put("ok", true);
      call.resolve(r);
    } catch (Exception e) {
      call.reject("确认闹钟动作失败: " + e.getMessage(), e);
    }
  }

  @PluginMethod
  public void activeAlarmDeliveries(PluginCall call) {
    JSObject result = new JSObject();
    result.put("alarms", ActiveAlarmStore.list(getContext()));
    call.resolve(result);
  }

  /**
   * UX-T03：读原生**持久**送达证据。
   *
   * 与 `activeAlarmDeliveries` 的区别不是措辞：那一个回答「现在有没有一条正在响的投递」
   * （有生命周期、会被 stop/drop 出账），这一个回答「这一次提醒，系统到底接收到了没有」
   * （只增、按 7 天 / 300 条淘汰，与投递生命周期无关）。
   *
   * 返回值里的 `retentionMaxAgeMs` / `retentionCapacity` 是**实际选值**，
   * 不是文档承诺 —— Web 侧要把它显示成「哪些结果无法核查」的依据。
   *
   * 失败一律 `available: false`：调用方必须按 unknown 处理，
   * 绝不能把「这次读不到」写成「漏提醒」（D70 前置核验的近 100% 误报就是这么来的）。
   */
  @PluginMethod
  public void deliveryEvidence(PluginCall call) {
    try {
      // 独立验收 F01：`list` 以前把「读失败」也返回成空数组，于是「读不到」与
      // 「没有证据」在 JS 侧变成同一个结论 ⇒ 一旦读取出错，界面会照常显示
      // 「本次提醒结果尚未确认」都做不到，反而可能被当成「确实没送达」。
      // 现在两件事分开表达：读不到 = available:false。
      JSONArray rows = DeliveryEvidenceStore.listOrNull(getContext(), System.currentTimeMillis());
      JSObject result = new JSObject();
      if (rows == null) {
        result.put("available", false);
        result.put("evidence", new JSONArray());
        result.put("error", "evidence-store-unreadable");
        call.resolve(result);
        return;
      }
      result.put("available", true);
      result.put("evidence", rows);
      result.put("retentionMaxAgeMs", DeliveryEvidenceStore.MAX_AGE_MS);
      result.put("retentionCapacity", DeliveryEvidenceStore.MAX_ROWS);
      call.resolve(result);
    } catch (Exception e) {
      JSObject result = new JSObject();
      result.put("available", false);
      result.put("evidence", new JSONArray());
      result.put("error", e.getMessage() == null ? "unavailable" : e.getMessage());
      call.resolve(result);
    }
  }

  @PluginMethod
  public void stopAlarmDelivery(PluginCall call) {
    String token = call.getString("token");
    if (token == null || call.getInt("id") == null) { call.reject("缺少闹钟标识"); return; }
    JSObject result = new JSObject();
    result.put("stopped", ActiveAlarmStore.stop(getContext(), call.getInt("id"), token));
    call.resolve(result);
  }

  /** R8 / R7：撤销闹钟时同步清掉可能已投递的通知 */
  @PluginMethod
  public void cancelNotification(PluginCall call) {
    try {
      int id = intArg(call, "id", 90002);
      // Reconciliation removes future schedules, not a currently ringing delivery.
      boolean preserve = Boolean.TRUE.equals(call.getBoolean("preserveActive", false));
      boolean active = ActiveAlarmStore.cancelNotification(getContext(), id, preserve);
      JSObject r = new JSObject();
      r.put("ok", true);
      r.put("active", active);
      call.resolve(r);
    } catch (Exception e) {
      call.reject("取消通知失败: " + e.getMessage(), e);
    }
  }

  private JSObject scheduleAlarmInternal(long delayMs, String title, String body, int id, String itemId, String level, String itemRev) throws Exception {
    return scheduleAlarmInternal(delayMs, title, body, id, itemId, level, itemRev, null, BASIS_WALL_CLOCK);
  }

  private JSObject scheduleAlarmInternal(long delayMs, String title, String body, int id, String itemId, String level, String itemRev, String localTrigger, String scheduleBasis) throws Exception {
    return scheduleAlarmInternal(delayMs, title, body, id, itemId, level, itemRev, localTrigger,
      scheduleBasis, "");
  }

  /**
   * UX-T03：`reminderKey` 是 JS 侧生成的 `<attempt>@<原定时刻>`。
   * 它必须一路带到投递 Intent —— 接收侧要落「系统已接收」证据，而证据的最小身份
   * 就是「事项 + 轮次 + 计划时刻 + 载体」；只带 itemId 说明不了响的是哪一轮。
   */
  private JSObject scheduleAlarmInternal(long delayMs, String title, String body, int id, String itemId, String level, String itemRev, String localTrigger, String scheduleBasis, String reminderKey) throws Exception {
    ensureChannel();
    AlarmTrace.cancel(getContext(), id, "replaced by new schedule");
    String trace = id + ":" + java.util.UUID.randomUUID().toString();
    AlarmTrace.record(getContext(), trace, "requested", "delayMs=" + delayMs);
    AlarmTrace.record(getContext(), trace, "item", itemId == null ? "" : itemId);
    try {
    if (delayMs < 500) delayMs = 500;
    long triggerAt = System.currentTimeMillis() + delayMs;

    AlarmManager am = alarmManager();
    if (am == null) {
      throw new IllegalStateException("AlarmManager 不可用");
    }

    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;

    // 投递载体 = 广播（唯一实现，见 AlarmTestReceiver）。闹钟时钟另外再排一条前台服务，
    // 专门把进程从 vivo fast_freezer 的冻结态里拉出来 —— 详见 AlarmScheduler.scheduleUnfreezer。
    Intent intent = new Intent(getContext(), AlarmTestReceiver.class);
    intent.setAction("space.alliswell.inbox.ACTION_TEST_ALARM");
    intent.putExtra(AlarmTrace.EXTRA, trace);
    intent.putExtra(AlarmTrace.TEST, id == -917010 || id == -917060 || id == -917120);
    intent.putExtra(AlarmTestReceiver.EXTRA_ID, id);
    intent.putExtra(AlarmTestReceiver.EXTRA_TITLE, title);
    intent.putExtra(AlarmTestReceiver.EXTRA_BODY, body);
    intent.putExtra(AlarmTestReceiver.EXTRA_FULL_SCREEN, true);
    intent.putExtra(AlarmTestReceiver.EXTRA_ITEM_ID, itemId == null ? "" : itemId);
    if (level != null) intent.putExtra(AlarmTestReceiver.EXTRA_LEVEL, level);
    if (itemRev != null) intent.putExtra(AlarmTestReceiver.EXTRA_ITEM_REV, itemRev);
    // UX-T03：提醒身份与计划时刻（计划时刻 = 请求落点，不是下面可能被夹紧的 triggerAt）
    if (reminderKey != null && !reminderKey.isEmpty()) {
      intent.putExtra(AlarmTestReceiver.EXTRA_REMINDER_KEY, reminderKey);
    }
    intent.putExtra(AlarmTestReceiver.EXTRA_PLANNED_AT, triggerAt);
    PendingIntent pi = PendingIntent.getBroadcast(getContext(), id, intent, flags);

    String mode = "inexact";
    boolean exact = false;
    boolean alarmClock = false;
    AlarmManager.AlarmClockInfo clockInfo = null;
    boolean isElapsed = BASIS_ELAPSED.equals(scheduleBasis);
    long nowElapsed = android.os.SystemClock.elapsedRealtime();
    long elapsedTriggerAtMs = nowElapsed + delayMs;

    if (Build.VERSION.SDK_INT >= 21) {
      try {
        Intent showIntent = getContext().getPackageManager()
          .getLaunchIntentForPackage(getContext().getPackageName());
        if (showIntent == null) showIntent = new Intent(getContext(), MainActivity.class);
        showIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent showPi = PendingIntent.getActivity(getContext(), id + 100000, showIntent, flags);
        clockInfo = new AlarmManager.AlarmClockInfo(triggerAt, showPi);
        am.setAlarmClock(clockInfo, pi);
        alarmClock = true;
        exact = true;
        mode = isElapsed ? "alarmClockElapsed" : "alarmClock";
      } catch (Exception ignored) {}
    }

    if (!alarmClock) {
      exact = canExactAlarm();
      try {
        if (Build.VERSION.SDK_INT >= 23) {
          if (exact) {
            if (isElapsed) {
              am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsedTriggerAtMs, pi);
              mode = "exactElapsed";
            } else {
              am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
              mode = "exactIdle";
            }
          } else {
            if (isElapsed) {
              am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsedTriggerAtMs, pi);
              mode = "inexactElapsedIdle";
            } else {
              am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
              mode = "inexactIdle";
            }
          }
        } else if (exact) {
          if (isElapsed) {
            am.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsedTriggerAtMs, pi);
            mode = "exactElapsed";
          } else {
            am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            mode = "exact";
          }
        } else {
          if (isElapsed) {
            am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsedTriggerAtMs, pi);
            mode = "inexactElapsed";
          } else {
            am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            mode = "inexact";
          }
        }
      } catch (SecurityException se) {
        if (isElapsed) {
          am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsedTriggerAtMs, pi);
          mode = "fallbackElapsed";
        } else {
          am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
          mode = "fallback";
        }
        exact = false;
      }
    }

    // 与广播同一时刻再排一条前台服务，负责把进程从冻结态里拉出来。
    // 必须传入 clockInfo：冻结期间只有「闹钟时钟」形态会被 AlarmManager 准点派发，
    // allow-while-idle 会被挂起（dumpsys alarm: Reason=frozen）—— 详见 scheduleUnfreezer。
    AlarmScheduler.scheduleUnfreezer(getContext(), am, id, trace, intent, triggerAt, flags, clockInfo);

    JSObject r = new JSObject();
    r.put("ok", true);
    r.put("id", id);
    r.put("exact", exact);
    r.put("alarmClock", alarmClock);
    r.put("mode", mode);
    r.put("triggerAt", triggerAt);
    r.put("delayMs", delayMs);
    r.put("trace", trace);
    AlarmTrace.record(getContext(), trace, "scheduled", "triggerAt=" + triggerAt + ";mode=" + mode);
    // P1-4 & Phase D：落盘，供开机恢复（带上数据版本、本地表达与基准）
    if (id != -917010 && id != -917060 && id != -917120)
      persistAlarm(getContext(), id, triggerAt, localTrigger, scheduleBasis, title, body, itemId, level, itemRev, reminderKey);
    return r;
    } catch (Exception error) {
      AlarmTrace.record(getContext(), trace, "scheduleFailed", error.toString());
      throw error;
    }
  }

  @PluginMethod
  public void cancelAlarm(PluginCall call) {
    try {
      int id = intArg(call, "id", 90002);
      // F1：撤闹钟的 PendingIntent 形态与排程时一致，交给 AlarmScheduler 一种实现维护
      // （它同时撤「界面投递」与「旧版广播投递」，避免留下撤不掉的幽灵闹钟）
      AlarmScheduler.cancel(getContext(), id);
      AlarmTrace.cancel(getContext(), id, "cancel API succeeded");
      // P1-4：同步撤销记录，避免开机后被"复活"
      forgetAlarm(getContext(), id);
      JSObject r = new JSObject();
      r.put("ok", true);
      call.resolve(r);
    } catch (Exception e) {
      call.reject("取消闹钟失败: " + e.getMessage(), e);
    }
  }

  @PluginMethod
  public void openNotificationSettings(PluginCall call) {
    try {
      Intent intent = new Intent();
      if (Build.VERSION.SDK_INT >= 26) {
        intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
      } else {
        intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      call.reject("无法打开通知设置", e);
    }
  }

  @PluginMethod
  public void openExactAlarmSettings(PluginCall call) {
    try {
      Intent intent = new Intent();
      if (Build.VERSION.SDK_INT >= 31) {
        intent.setAction(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
      } else {
        intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      call.reject("无法打开精确闹钟设置", e);
    }
  }

  @PluginMethod
  public void openBatterySettings(PluginCall call) {
    try {
      Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      call.reject("无法打开电池优化设置", e);
    }
  }

  /**
   * R-1：把用户送到「允许本应用后台运行」的厂商设置页。
   *
   * **为什么必须有它** —— 真机取证（vivo V2238A / OriginOS 16，2026-09-17）证明，
   * 未放行时，以下两种受测场景均未能唤醒应用：
   *   ① 进程活着 → 被 `fast_freezer` 冻进 cgroup，冻结态下广播 / 前台服务 / Activity 全进不来；
   *   ② 进程被杀掉 → 系统连重新拉起都不做（`device_idle_wake_from_idle` 照常触发，进程仍为空、
   *      通知 0 条，events 里没有 `am_proc_start`）。
   * 而厂商的「自启动 / 后台运行 / 高耗电」白名单**没有可读状态位**（appops 里查不到，
   * `getAppStandbyBucket()` 返回厂商自定义值，`isBackgroundRestricted()` 恒为 false），
   * 所以引导用户在系统设置确认，不能靠应用自己猜。
   * 2026-09-18 R-1：后台耗电 + 锁屏显示恢复息屏全屏，自启动放行后冷启动通过。
   * NEW_TASK 单独使用可能只带回旧权限页；本机 CLEAR_TOP 已验证回到目标设置页。
   * 返回 opened 仅描述请求路径，不证明实际页面或厂商开关状态。
   *
   * ## 深链必须用**实测能启动**的，不能用「查得到组件」的
   *
   * 第一轮按 `cmd package resolve-activity` 的结果写了两个厂商显式组件，真机上**全部打不开**：
   *
   * ```
   * am start -n com.vivo.abe/…ExcessivePowerManagerActivity      → Exception，top 仍是桌面
   * am start -n com.iqoo.secure/…appmanager.AppManagerActivity   → Exception，top 仍是桌面
   * am start -n com.vivo.permissionmanager/.activity.PurviewActivity → Exception
   * ```
   *
   * 原因：这些 Activity **没有导出**（`exported=false`），第三方应用与 shell 都无权启动。
   * **`resolveActivity() != null` 只说明组件存在，不代表能启动** —— 别拿它当可用性判据。
   *
   * 真正能打开、而且**正好是需要的那页**的是标准 Action（实测 top 值）：
   *
   * ```
   * ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS
   *   → top = com.iqoo.powersaving/.BackgroundHighUsageActivity   ← vivo/iQOO 的「后台高耗电」页
   * ACTION_APPLICATION_DETAILS_SETTINGS (package:<本包>)
   *   → top = com.android.settings/.applications.InstalledAppDetails
   * ```
   */
  @PluginMethod
  public void openBackgroundSettings(PluginCall call) {
    String opened = null;
    try {
      Intent battery = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
      battery.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      getContext().startActivity(battery);
      opened = "batteryOptimization";
    } catch (Exception ignored) {}
    if (opened == null) {
      try {
        Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        details.setData(Uri.parse("package:" + getContext().getPackageName()));
        details.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        getContext().startActivity(details);
        opened = "appDetails";
      } catch (Exception e) {
        call.reject("无法打开后台运行设置", e);
        return;
      }
    }
    JSObject r = new JSObject();
    r.put("ok", true);
    r.put("opened", opened);
    call.resolve(r);
  }

  @PluginMethod
  public void openAppDetailsSettings(PluginCall call) {
    try {
      Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
      intent.setData(Uri.parse("package:" + getContext().getPackageName()));
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      call.reject("无法打开应用详情", e);
    }
  }

  /**
   * Q3：跳「显示在其他应用上层」。
   * 这是解锁亮屏全屏闹钟的**前提权限** —— 也是国产 ROM 上「后台弹出界面」的落点。
   */
  @PluginMethod
  public void openOverlaySettings(PluginCall call) {
    try {
      Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:" + getContext().getPackageName()));
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      call.reject("无法打开悬浮窗设置", e);
    }
  }

  /** Q3：Android 14+ 的「全屏通知」特殊权限页；低版本没有这一项，退回应用详情 */
  @PluginMethod
  public void openFullScreenIntentSettings(PluginCall call) {
    try {
      Intent intent;
      if (Build.VERSION.SDK_INT >= 34) {
        intent = new Intent("android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT",
          Uri.parse("package:" + getContext().getPackageName()));
      } else {
        intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
          Uri.parse("package:" + getContext().getPackageName()));
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      call.reject("无法打开全屏通知设置", e);
    }
  }

  /**
   * Q3：国产 ROM 的「自启动 / 后台弹出界面」不在 AOSP Settings 里，只能按厂商组件逐个试。
   * 全部失败则退回应用详情页（用户可在里面找权限管理）。返回 `component` 供诊断记录实际落点。
   */
  @PluginMethod
  public void openAutoStartSettings(PluginCall call) {
    String[][] candidates = new String[][] {
      {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
      {"com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"},
      {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
      {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
      {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
      {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
      {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
      {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"},
      {"com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"},
      {"com.letv.android.letvsafe", "com.letv.android.letvsafe.AutobootManageActivity"}
    };
    for (String[] candidate : candidates) {
      try {
        Intent intent = new Intent();
        intent.setComponent(new ComponentName(candidate[0], candidate[1]));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        JSObject r = new JSObject();
        r.put("ok", true);
        r.put("component", candidate[0] + "/" + candidate[1]);
        call.resolve(r);
        return;
      } catch (Exception ignored) {}
    }
    try {
      Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.parse("package:" + getContext().getPackageName()));
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      JSObject r = new JSObject();
      r.put("ok", true);
      r.put("component", "app-details");
      call.resolve(r);
    } catch (Exception e) {
      call.reject("无法打开自启动设置", e);
    }
  }

  /**
   * Q3：上一次闹钟投递的**真实结局**。
   *
   * 光看「通知出现了」分不清是「全屏被点开」还是「全屏被系统拦下、只剩横幅」——
   * 两者在界面上都只是"响了一声"。所以拆成两个字段：
   * - `attempted`（AlarmTestReceiver 写）：闹钟到点、广播收到了、全屏请求发出去了；
   * - `shown`（AlarmActivity 写）：全屏界面**真的**起来了。
   *
   * `attempted && !shown` ⇒ 被 BAL 拦下（缺「显示在其他应用上层」）。
   */
  @PluginMethod
  public void alarmTrace(PluginCall call) {
    try {
      JSObject r = new JSObject();
      r.put("events", AlarmTrace.read(getContext()));
      r.put("now", System.currentTimeMillis());
      call.resolve(r);
    } catch (Exception e) { call.reject("读取记录失败", e); }
  }

  @PluginMethod
  public void startAlarmTraceTest(PluginCall call) {
    JSObject r = new JSObject();
    org.json.JSONArray results = new org.json.JSONArray();
    for (int seconds : new int[] {10, 60, 120}) {
      try {
        results.put(scheduleAlarmInternal(seconds * 1000L, "后台诊断 " + seconds + " 秒",
          "诊断闹钟，5 秒后自动关闭", -917000 - seconds, "", "诊断", "0"));
      } catch (Exception e) {
        JSObject failure = new JSObject();
        failure.put("seconds", seconds); failure.put("error", e.toString()); results.put(failure);
      }
    }
    r.put("results", results); call.resolve(r);
  }

  @PluginMethod
  public void lastAlarmDelivery(PluginCall call) {
    try {
      SharedPreferences sp = getContext().getSharedPreferences(AlarmActivity.PREFS, Context.MODE_PRIVATE);
      JSObject r = new JSObject();
      r.put("ok", true);
      r.put("at", sp.getLong(AlarmTestReceiver.KEY_DELIVERY_AT, 0L));
      r.put("attempted", sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_ATTEMPTED, false));
      r.put("shownAt", sp.getLong(AlarmTestReceiver.KEY_DELIVERY_SHOWN_AT, 0L));
      // V1：界面是否真的显示出来（窗口可见或获得焦点），以及判定「没能显示」的时刻
      r.put("visible", sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_VISIBLE, false));
      r.put("notificationPosted",
        sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_NOTIFICATION_POSTED, false));
      r.put("hiddenAt", sp.getLong(AlarmTestReceiver.KEY_DELIVERY_HIDDEN_AT, 0L));
      // V3：这次投递走的路径 —— fsi（系统全屏意图）/ direct（直起界面）/ banner（只出横幅）
      r.put("path", sp.getString(AlarmTestReceiver.KEY_DELIVERY_PATH, ""));
      r.put("title", sp.getString(AlarmTestReceiver.KEY_DELIVERY_TITLE, ""));
      r.put("screenOn", sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_SCREEN_ON, false));
      r.put("locked", sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_LOCKED, false));
      r.put("overlayAtDelivery", sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_OVERLAY, false));
      r.put("inCall", sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_IN_CALL, false));
      // H-08：投递当时的系统通知可用性 —— 缺了它，界面只能给出「权限齐备但系统没展示」
      // 这种误导性的结论（真机上真实的断点其实是「通知权限没开 → 全屏意图无载体」）。
      r.put("notifyEnabledAtDelivery",
        sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_NOTIFY_ON, true));
      // D59：载体归因。声音与振动不再挂在通知上，所以 `notifyEnabledAtDelivery=false`
      // 只意味着「**屏幕**没有载体」，不等于「完全静默」—— 面板必须能看到声音落在哪里，
      // 否则会把「响了但没亮屏」反着读成「什么都没发生」。
      //
      // 归属用 trace 判定，不用时间戳：广播投递与响铃服务是两条**同刻**的闹钟时钟
      // （见 AlarmScheduler.scheduleUnfreezer），谁先派发不确定。用「谁更新」判断，
      // 会在「服务先跑」时把本次结果误判成上一次的陈旧值。trace 相同才算本次上报。
      String deliveryTrace = sp.getString(AlarmTestReceiver.KEY_DELIVERY_TRACE, "");
      String carrierTrace = sp.getString(AlarmTestReceiver.KEY_CARRIER_TRACE, "");
      boolean carrierFresh = !deliveryTrace.isEmpty() && deliveryTrace.equals(carrierTrace);
      r.put("carrierSound", carrierFresh
        ? sp.getString(AlarmTestReceiver.KEY_CARRIER_SOUND, "none") : "unknown");
      r.put("carrierVibrate", carrierFresh
        ? sp.getString(AlarmTestReceiver.KEY_CARRIER_VIBRATE, "none") : "unknown");
      r.put("carrierForegroundService",
        carrierFresh && sp.getBoolean(AlarmTestReceiver.KEY_CARRIER_FGS, false));
      // D68：这次投递是否已被**自动静音** —— 响满上限后自己停的声振，
      // **不是**用户确认。面板与归因必须把两者分开：混在一起，
      // 「响过但没人管」这件事就会在界面上消失（而它正是最该被看见的那一类）。
      boolean autoSilenced = AlarmRingService.wasAutoSilenced(getContext(), deliveryTrace);
      r.put("autoSilenced", autoSilenced);
      r.put("autoSilencedAt", autoSilenced
        ? sp.getLong(AlarmRingService.KEY_AUTO_SILENCED_AT, 0L) : 0L);
      // D64：投递**当时**的两项权限快照。命名上刻意与下面的活值分开 ——
      // 拿「现在的权限」去解释一次**历史**投递的失败原因，会在用户事后改过权限时
      // 给出反向结论（H-08 就是被同类的「用现在解释当时」误诊过）。
      //
      // 缺键时读回 true：老版本 APK 写的记录里没有这两个字段，
      // 不能让它们在升级后凭空变成「没有权限」。
      r.put("exactAtDelivery", sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_EXACT_ON, true));
      r.put("fsiAtDelivery", sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_FSI_ON, true));
      // 活值：描述**当前**能力状态，供设置页 / 自检面板显示。
      // **不要用它解释历史投递** —— 解释历史请用上面的 *AtDelivery 快照。
      r.put("canDrawOverlays", canDrawOverlays());
      r.put("canUseFullScreenIntent", canUseFullScreenIntent());
      call.resolve(r);
    } catch (Exception e) {
      call.reject("读取投递记录失败: " + e.getMessage(), e);
    }
  }
}
