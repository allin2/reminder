package space.alliswell.inbox;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;
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

  public static final String CHANNEL_ID = "attention-bridge-v2";
  public static final String CHANNEL_NAME = "提醒测试";
  public static final int REQ_NOTIFY = 21001;
  public static final int REQ_EXACT = 21002;

  /** P1-4：已排全屏闹钟的持久化记录，供开机后恢复 */
  public static final String PREFS_SCHEDULES = "attention_alarm_schedules";
  public static final String KEY_ALARMS = "alarms";

  /** P1-4：记录一条已排闹钟（同 id 覆盖） */
  static synchronized void persistAlarm(Context context, int id, long triggerAt,
                                        String title, String body, String itemId, String level) {
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
      entry.put("triggerAt", triggerAt);
      entry.put("title", title == null ? "" : title);
      entry.put("body", body == null ? "" : body);
      entry.put("itemId", itemId == null ? "" : itemId);
      entry.put("level", level == null ? "" : level);
      out.put(entry);
      prefs.edit().putString(KEY_ALARMS, out.toString()).apply();
    } catch (Exception ignored) {}
  }

  /** P1-4：撤销记录 */
  static synchronized void forgetAlarm(Context context, int id) {
    try {
      SharedPreferences prefs = context.getSharedPreferences(PREFS_SCHEDULES, Context.MODE_PRIVATE);
      JSONArray arr = new JSONArray(prefs.getString(KEY_ALARMS, "[]"));
      JSONArray out = new JSONArray();
      for (int i = 0; i < arr.length(); i++) {
        JSONObject o = arr.optJSONObject(i);
        if (o != null && o.optInt("id", 0) != id) out.put(o);
      }
      prefs.edit().putString(KEY_ALARMS, out.toString()).apply();
    } catch (Exception ignored) {}
  }

  /** P1-4：开机 / 应用更新后重排仍未来的闹钟，丢弃已过期的 */
  static synchronized void restorePersistedAlarms(Context context) {
    try {
      SharedPreferences prefs = context.getSharedPreferences(PREFS_SCHEDULES, Context.MODE_PRIVATE);
      JSONArray arr = new JSONArray(prefs.getString(KEY_ALARMS, "[]"));
      JSONArray kept = new JSONArray();
      long now = System.currentTimeMillis();
      for (int i = 0; i < arr.length(); i++) {
        JSONObject o = arr.optJSONObject(i);
        if (o == null) continue;
        int id = o.optInt("id", 0);
        long triggerAt = o.optLong("triggerAt", 0L);
        if (id == 0 || triggerAt <= now) continue;
        AlarmScheduler.schedule(context, triggerAt, o.optString("title"), o.optString("body"),
          id, o.optString("itemId"), o.optString("level"));
        kept.put(o);
      }
      prefs.edit().putString(KEY_ALARMS, kept.toString()).apply();
    } catch (Exception ignored) {}
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = getContext().getSystemService(NotificationManager.class);
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

  private boolean notificationsEnabled() {
    NotificationManager nm = getContext().getSystemService(NotificationManager.class);
    return nm != null && nm.areNotificationsEnabled();
  }

  private boolean hasPostNotifications() {
    if (Build.VERSION.SDK_INT < 33) return true;
    return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
      == PackageManager.PERMISSION_GRANTED;
  }

  private boolean canExactAlarm() {
    if (Build.VERSION.SDK_INT < 31) return true;
    AlarmManager am = getContext().getSystemService(AlarmManager.class);
    if (am == null) return false;
    try {
      if (am.canScheduleExactAlarms()) return true;
    } catch (Exception ignored) {}
    return false;
  }

  private boolean ignoringBatteryOptimizations() {
    if (Build.VERSION.SDK_INT < 23) return true;
    PowerManager pm = getContext().getSystemService(PowerManager.class);
    return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
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
    result.put("alarmManagerAvailable", getContext().getSystemService(AlarmManager.class) != null);
    result.put("notificationManagerAvailable", getContext().getSystemService(NotificationManager.class) != null);
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
      int id = call.getInt("id", 90001);
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
      NotificationManager nm = getContext().getSystemService(NotificationManager.class);
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

  @PluginMethod
  public void scheduleAlarm(PluginCall call) {
    try {
      Number delayMsNum = call.getLong("delayMs", 10000L);
      long delayMs = delayMsNum == null ? 10000L : delayMsNum.longValue();
      String title = call.getString("title", "安心收件箱闹钟测试");
      String body = call.getString("body", "这是定时闹钟提醒测试");
      int id = call.getInt("id", 90002);
      JSObject r = scheduleAlarmInternal(delayMs, title, body, id, callItemId(call), callLevel(call));
      call.resolve(r);
    } catch (Exception e) {
      call.reject("设置闹钟失败: " + e.getMessage(), e);
    }
  }

  @PluginMethod
  public void scheduleAt(PluginCall call) {
    try {
      Number atNum = call.getLong("at", 0L);
      long at = atNum == null ? 0L : atNum.longValue();
      String title = call.getString("title", "安心收件箱提醒");
      String body = call.getString("body", "有一条事项需要你确认");
      int id = call.getInt("id", 90100);
      long delayMs = Math.max(500L, at - System.currentTimeMillis());
      JSObject r = scheduleAlarmInternal(delayMs, title, body, id, callItemId(call), callLevel(call));
      call.resolve(r);
    } catch (Exception e) {
      call.reject("设置定时失败: " + e.getMessage(), e);
    }
  }

  /** JS 轮询消费全屏闹钟动作（D11/D12） */
  @PluginMethod
  public void consumeAlarmAction(PluginCall call) {
    try {
      android.content.SharedPreferences prefs =
        getContext().getSharedPreferences(AlarmActivity.PREFS, android.content.Context.MODE_PRIVATE);
      String action = prefs.getString(AlarmActivity.KEY_ACTION, null);
      String itemId = prefs.getString(AlarmActivity.KEY_ITEM_ID, "");
      JSObject r = new JSObject();
      if (action != null) {
        prefs.edit().remove(AlarmActivity.KEY_ACTION).remove(AlarmActivity.KEY_ITEM_ID).apply();
        r.put("action", action);
        r.put("itemId", itemId == null ? "" : itemId);
      } else {
        r.put("action", "");
      }
      call.resolve(r);
    } catch (Exception e) {
      call.reject("读取闹钟动作失败", e);
    }
  }

  private JSObject scheduleAlarmInternal(long delayMs, String title, String body, int id, String itemId, String level) throws Exception {
    ensureChannel();
    if (delayMs < 500) delayMs = 500;
    long triggerAt = System.currentTimeMillis() + delayMs;

    AlarmManager am = getContext().getSystemService(AlarmManager.class);
    if (am == null) {
      throw new IllegalStateException("AlarmManager 不可用");
    }

    Intent intent = new Intent(getContext(), AlarmTestReceiver.class);
    intent.setAction("space.alliswell.inbox.ACTION_TEST_ALARM");
    intent.putExtra(AlarmTestReceiver.EXTRA_ID, id);
    intent.putExtra(AlarmTestReceiver.EXTRA_TITLE, title);
    intent.putExtra(AlarmTestReceiver.EXTRA_BODY, body);
    intent.putExtra(AlarmTestReceiver.EXTRA_FULL_SCREEN, true);
    intent.putExtra(AlarmTestReceiver.EXTRA_ITEM_ID, itemId == null ? "" : itemId);
    if (level != null) intent.putExtra(AlarmTestReceiver.EXTRA_LEVEL, level);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
    PendingIntent pi = PendingIntent.getBroadcast(getContext(), id, intent, flags);

    String mode = "inexact";
    boolean exact = false;
    boolean alarmClock = false;

    if (Build.VERSION.SDK_INT >= 21) {
      try {
        Intent showIntent = getContext().getPackageManager()
          .getLaunchIntentForPackage(getContext().getPackageName());
        if (showIntent == null) showIntent = new Intent(getContext(), MainActivity.class);
        showIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent showPi = PendingIntent.getActivity(getContext(), id + 100000, showIntent, flags);
        AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(triggerAt, showPi);
        am.setAlarmClock(info, pi);
        alarmClock = true;
        exact = true;
        mode = "alarmClock";
      } catch (Exception ignored) {}
    }

    if (!alarmClock) {
      exact = canExactAlarm();
      try {
        if (Build.VERSION.SDK_INT >= 23) {
          if (exact) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            mode = "exactIdle";
          } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            mode = "inexactIdle";
          }
        } else if (exact) {
          am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
          mode = "exact";
        } else {
          am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
          mode = "inexact";
        }
      } catch (SecurityException se) {
        am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        exact = false;
        mode = "fallback";
      }
    }

    JSObject r = new JSObject();
    r.put("ok", true);
    r.put("id", id);
    r.put("exact", exact);
    r.put("alarmClock", alarmClock);
    r.put("mode", mode);
    r.put("triggerAt", triggerAt);
    r.put("delayMs", delayMs);
    // P1-4：落盘，供开机恢复
    persistAlarm(getContext(), id, triggerAt, title, body, itemId, level);
    return r;
  }

  @PluginMethod
  public void cancelAlarm(PluginCall call) {
    try {
      int id = call.getInt("id", 90002);
      AlarmManager am = getContext().getSystemService(AlarmManager.class);
      Intent intent = new Intent(getContext(), AlarmTestReceiver.class);
      intent.setAction("space.alliswell.inbox.ACTION_TEST_ALARM");
      int flags = PendingIntent.FLAG_UPDATE_CURRENT;
      if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
      PendingIntent pi = PendingIntent.getBroadcast(getContext(), id, intent, flags);
      if (am != null) am.cancel(pi);
      pi.cancel();
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
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      call.reject("无法打开电池优化设置", e);
    }
  }

  @PluginMethod
  public void openAppDetailsSettings(PluginCall call) {
    try {
      Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
      intent.setData(Uri.parse("package:" + getContext().getPackageName()));
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      call.reject("无法打开应用详情", e);
    }
  }
}
