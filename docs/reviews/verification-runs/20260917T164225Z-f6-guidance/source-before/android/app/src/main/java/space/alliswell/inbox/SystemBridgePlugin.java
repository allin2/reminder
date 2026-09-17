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

  @PluginMethod
  public void scheduleAlarm(PluginCall call) {
    try {
      long delayMs = longArg(call, "delayMs", 10000L);
      String title = call.getString("title", "安心收件箱闹钟测试");
      String body = call.getString("body", "这是定时闹钟提醒测试");
      int id = intArg(call, "id", 90002);
      JSObject r = scheduleAlarmInternal(delayMs, title, body, id, callItemId(call), callLevel(call), callItemRev(call));
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
      int id = intArg(call, "id", 90002);
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
    PendingIntent pi = PendingIntent.getBroadcast(getContext(), id, intent, flags);

    String mode = "inexact";
    boolean exact = false;
    boolean alarmClock = false;
    AlarmManager.AlarmClockInfo clockInfo = null;

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
    // P1-4：落盘，供开机恢复（V02：带上数据版本）
    if (id != -917010 && id != -917060 && id != -917120)
      persistAlarm(getContext(), id, triggerAt, title, body, itemId, level, itemRev);
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
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
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
   * 这类 ROM 上应用侧**没有任何**手段能在后台被唤醒：
   *   ① 进程活着 → 被 `fast_freezer` 冻进 cgroup，冻结态下广播 / 前台服务 / Activity 全进不来；
   *   ② 进程被杀掉 → 系统连重新拉起都不做（`device_idle_wake_from_idle` 照常触发，进程仍为空、
   *      通知 0 条，events 里没有 `am_proc_start`）。
   * 而厂商的「自启动 / 后台运行 / 高耗电」白名单**没有可读状态位**（appops 里查不到，
   * `getAppStandbyBucket()` 返回厂商自定义值，`isBackgroundRestricted()` 恒为 false），
   * 所以只能**引导用户手动放行**，不能靠应用自己猜。
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
      battery.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(battery);
      opened = "batteryOptimization";
    } catch (Exception ignored) {}
    if (opened == null) {
      try {
        Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        details.setData(Uri.parse("package:" + getContext().getPackageName()));
        details.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
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
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
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
      r.put("hiddenAt", sp.getLong(AlarmTestReceiver.KEY_DELIVERY_HIDDEN_AT, 0L));
      // V3：这次投递走的路径 —— fsi（系统全屏意图）/ direct（直起界面）/ banner（只出横幅）
      r.put("path", sp.getString(AlarmTestReceiver.KEY_DELIVERY_PATH, ""));
      r.put("title", sp.getString(AlarmTestReceiver.KEY_DELIVERY_TITLE, ""));
      r.put("screenOn", sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_SCREEN_ON, false));
      r.put("locked", sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_LOCKED, false));
      r.put("overlayAtDelivery", sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_OVERLAY, false));
      r.put("inCall", sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_IN_CALL, false));
      r.put("canDrawOverlays", canDrawOverlays());
      r.put("canUseFullScreenIntent", canUseFullScreenIntent());
      call.resolve(r);
    } catch (Exception e) {
      call.reject("读取投递记录失败: " + e.getMessage(), e);
    }
  }
}
