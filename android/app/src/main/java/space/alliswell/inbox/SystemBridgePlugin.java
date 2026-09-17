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

  /** P1-4：记录一条已排闹钟（同 id 覆盖）。V02：一并持久化数据版本 */
  static synchronized void persistAlarm(Context context, int id, long triggerAt,
                                        String title, String body, String itemId, String level) {
    persistAlarm(context, id, triggerAt, title, body, itemId, level, "0");
  }

  static synchronized void persistAlarm(Context context, int id, long triggerAt, String title,
                                        String body, String itemId, String level, String itemRev) {
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
      entry.put("itemRev", itemRev == null || itemRev.isEmpty() ? "0" : itemRev);
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
        String rev = o.optString("itemRev", "0");
        AlarmScheduler.schedule(context, triggerAt, o.optString("title"), o.optString("body"),
          id, o.optString("itemId"), o.optString("level"),
          rev == null || rev.isEmpty() ? "0" : rev);
        kept.put(o);
      }
      prefs.edit().putString(KEY_ALARMS, kept.toString()).apply();
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
    Number rev = call.getInt("itemRev", 0);
    return String.valueOf(rev == null ? 0 : rev.intValue());
  }

  @PluginMethod
  public void scheduleAlarm(PluginCall call) {
    try {
      Number delayMsNum = call.getLong("delayMs", 10000L);
      long delayMs = delayMsNum == null ? 10000L : delayMsNum.longValue();
      String title = call.getString("title", "安心收件箱闹钟测试");
      String body = call.getString("body", "这是定时闹钟提醒测试");
      int id = call.getInt("id", 90002);
      JSObject r = scheduleAlarmInternal(delayMs, title, body, id, callItemId(call), callLevel(call), callItemRev(call));
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
      JSObject r = scheduleAlarmInternal(delayMs, title, body, id, callItemId(call), callLevel(call), callItemRev(call));
      call.resolve(r);
    } catch (Exception e) {
      call.reject("设置定时失败: " + e.getMessage(), e);
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

  /** R8 / R7：撤销闹钟时同步清掉可能已投递的通知 */
  @PluginMethod
  public void cancelNotification(PluginCall call) {
    try {
      int id = call.getInt("id", 90002);
      NotificationManager nm = notificationManager();
      if (nm != null) nm.cancel(id);
      JSObject r = new JSObject();
      r.put("ok", true);
      call.resolve(r);
    } catch (Exception e) {
      call.reject("取消通知失败: " + e.getMessage(), e);
    }
  }

  private JSObject scheduleAlarmInternal(long delayMs, String title, String body, int id, String itemId, String level, String itemRev) throws Exception {
    ensureChannel();
    if (delayMs < 500) delayMs = 500;
    long triggerAt = System.currentTimeMillis() + delayMs;

    AlarmManager am = alarmManager();
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
    if (itemRev != null) intent.putExtra(AlarmTestReceiver.EXTRA_ITEM_REV, itemRev);
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
    // P1-4：落盘，供开机恢复（V02：带上数据版本）
    persistAlarm(getContext(), id, triggerAt, title, body, itemId, level, itemRev);
    return r;
  }

  @PluginMethod
  public void cancelAlarm(PluginCall call) {
    try {
      int id = call.getInt("id", 90002);
      AlarmManager am = alarmManager();
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
