package space.alliswell.inbox;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import androidx.core.app.NotificationCompat;

public class AlarmTestReceiver extends BroadcastReceiver {
  private static final String TAG = "AttentionAlarm";
  public static final String EXTRA_ID = "id";
  public static final String EXTRA_TITLE = "title";
  public static final String EXTRA_BODY = "body";
  public static final String EXTRA_FULL_SCREEN = "fullScreen";
  public static final String EXTRA_ITEM_ID = "itemId";
  public static final String EXTRA_LEVEL = "level";
  /** L04：投递时的事项数据版本 */
  public static final String EXTRA_ITEM_REV = "itemRev";
  public static final String CHANNEL_ID = "attention-alarm-v3";
  public static final String CHANNEL_NAME = "提醒闹钟";

  // Q3：投递结局台账（AlarmActivity 写 shownAt，SystemBridgePlugin.lastAlarmDelivery 回读）
  public static final String KEY_DELIVERY_AT = "deliveryAt";
  public static final String KEY_DELIVERY_ATTEMPTED = "deliveryAttempted";
  public static final String KEY_DELIVERY_SHOWN_AT = "deliveryShownAt";
  public static final String KEY_DELIVERY_TITLE = "deliveryTitle";
  public static final String KEY_DELIVERY_LEVEL = "deliveryLevel";
  public static final String KEY_DELIVERY_SCREEN_ON = "deliveryScreenOn";
  public static final String KEY_DELIVERY_LOCKED = "deliveryLocked";
  public static final String KEY_DELIVERY_OVERLAY = "deliveryOverlay";
  /** Q5：投递时是否正在响铃/通话 —— 通话中不允许抢屏 */
  public static final String KEY_DELIVERY_IN_CALL = "deliveryInCall";
  /** V1：这次投递走的是哪条路 —— fsi（系统全屏意图）/ direct（直起界面）/ banner（只出横幅） */
  public static final String KEY_DELIVERY_PATH = "deliveryPath";
  /** V1：界面是否真的显示出来（窗口可见，或获得窗口焦点） */
  public static final String KEY_DELIVERY_VISIBLE = "deliveryVisible";
  /** V1：判定「界面没能显示出来」的时刻；0 = 没被判过 */
  public static final String KEY_DELIVERY_HIDDEN_AT = "deliveryHiddenAt";

  @Override
  public void onReceive(Context context, Intent intent) {
    if (context == null || intent == null) return;
    String trace = intent.getStringExtra(AlarmTrace.EXTRA);
    AlarmTrace.record(context, trace, "received", "");
    int id = intent.getIntExtra(EXTRA_ID, 90002);
    String title = intent.getStringExtra(EXTRA_TITLE);
    String body = intent.getStringExtra(EXTRA_BODY);
    String itemId = intent.getStringExtra(EXTRA_ITEM_ID);
    String level = intent.getStringExtra(EXTRA_LEVEL);
    String itemRev = intent.getStringExtra(EXTRA_ITEM_REV);
    if (itemId == null) itemId = "";
    if (itemRev == null || itemRev.isEmpty()) itemRev = "0";
    boolean fullScreen = intent.getBooleanExtra(EXTRA_FULL_SCREEN, true);
    if (title == null || title.isEmpty()) title = "安心收件箱";
    if (body == null || body.isEmpty()) body = "有一条事项需要你确认";

    // R3：minSdk 22 —— 用字符串形式的 getSystemService，避免 API 23+ 的 Class 重载
    Object pmObj = context.getSystemService(Context.POWER_SERVICE);
    PowerManager pm = pmObj instanceof PowerManager ? (PowerManager) pmObj : null;
    PowerManager.WakeLock wl = null;
    if (pm != null) {
      wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "attention:alarm");
      wl.setReferenceCounted(false);
      try { wl.acquire(30000L); } catch (Exception ignored) {}
    }

    // Q5：投递当时的环境。锁屏状态与通话状态共同决定「能不能抢屏」
    boolean screenOn = pm == null || pm.isInteractive();
    boolean locked = isKeyguardLocked(context);
    boolean inCall = isCallActive(context);

    // V3：两条启动路径必须**按环境互斥**，绝不两路同时去拉同一个 AlarmActivity。
    // 平台语义（AOSP 行为表，取证见 docs/reviews/vivo-device-test-2026-09-17.md §5.5）：
    //   · 锁屏 / 息屏 / AOD：全屏意图由系统接管，系统此时会真的全屏；
    //   · 解锁亮屏：系统会把全屏意图**有意降级成横幅**，只能自己把界面拉起来（需 BAL 豁免）。
    // 此前两路都开，锁屏时同一个 Activity 被拉起两次，现场实测产生
    // replaced different delivery → effectsStopped → audioStarted → duplicateIntent：
    // 响铃被打断后重启，窗口可见性一并受损。
    boolean backgroundDelivery = locked || !screenOn;
    /** 锁屏/息屏：系统全屏意图是**兜底**（真机上它并不总会拉起 Activity，见下方直起段） */
    boolean fsiPath = fullScreen && backgroundDelivery;
    /**
     * Q5：解锁时不得打断通话；锁屏时不受此限（锁屏本就是闹钟优先的场景）。
     *
     * V1 复测修正：此前这一格写成「解锁亮屏专用」，于是锁屏/息屏**完全不直起**，
     * 把「能不能看到闹钟」全押在系统的全屏意图上。vivo/OriginOS 16 实测该押注不成立
     * （见下方直起段的取证），结果是用户既看不到界面又听不到声音。
     * 直起改为**与全屏意图并存**，仅「解锁 + 通话中」这一格让路。
     */
    boolean directPath = fullScreen && (!inCall || locked);
    String path = !directPath ? "banner" : backgroundDelivery ? "fsi+direct" : "direct";

    try {
      // Q3：先落「尝试投递」的台账（含投递当时的环境），再尝试起全屏。
      // 顺序不能反：AlarmActivity 一起就会写 shownAt，晚写会把它的记录覆盖掉。
      AlarmTrace.record(context, trace, "environment",
        "screenOn=" + screenOn + ";locked=" + locked + ";inCall=" + inCall + ";path=" + path);
      recordAttempt(context, title, level, fullScreen, screenOn, locked, inCall, path);

      // 1) 直起全屏界面 —— 除「解锁 + 通话中」外的所有情况都走这里。
      //
      //    V1 真机复测取证（vivo V2238A / OriginOS 16，2026-09-17）：
      //    息屏锁屏下连续三次投递，通知里 fullscreenIntent 存在、系统也已给出
      //    "+30s0ms NOTIFICATION_SERVICE" 的 BAL 豁免，但 AlarmActivity **始终没有 created**，
      //    其中两次连声音都没有（声音只在 AlarmActivity 里播放）——
      //    把投递全权交给系统全屏意图，在这类 ROM 上等于不投递，比竞态更糟。
      //
      //    因此直起是主路径，全屏意图退居系统级兜底：
      //    · setAlarmClock 触发时系统会临时放开 BAL，直起通常能成；
      //    · 有「显示在其他应用上层」时更稳（实测解锁亮屏 100% 可见）。
      //    重复拉起是安全的：两条路径携带**同一个 token**，AlarmActivity.onNewIntent
      //    对同 token 只记 duplicateIntent 并保持响铃，不会 replaced、不会重启声音 ——
      //    这正是旧版「两路同时拉、声音被打断重启」的修复点。
      if (directPath) {
        if (!canDrawOverlays(context)) {
          // 没有「显示在其他应用上层」时，后台 startActivity 会被 BAL **静默**拦下。
          // 仍然照发（setAlarmClock 自带豁免、个别 ROM 的自启动白名单也会放行），
          // 但先把「大概率被拦」记进台账 —— 否则事后只能靠猜，
          // 这正是自检面板把「后台启动被拦」误诊成「缺全屏通知权限」的根源。
          AlarmTrace.record(context, trace, "launchLikelyBlocked", "no SYSTEM_ALERT_WINDOW");
        }
        try {
          Intent activity = new Intent(context, AlarmActivity.class);
          activity.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP
            | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
          activity.putExtra(AlarmActivity.EXTRA_ID, id);
          activity.putExtra(AlarmActivity.EXTRA_TITLE, title);
          activity.putExtra(AlarmActivity.EXTRA_BODY, body);
          activity.putExtra(AlarmActivity.EXTRA_ITEM_ID, itemId);
          activity.putExtra(AlarmActivity.EXTRA_ITEM_REV, itemRev);
          if (level != null) activity.putExtra(AlarmActivity.EXTRA_LEVEL, level);
          activity.putExtra(AlarmTrace.EXTRA, trace);
          activity.putExtra(AlarmTrace.TEST, intent.getBooleanExtra(AlarmTrace.TEST, false));
          context.startActivity(activity);
          AlarmTrace.record(context, trace, "launchRequested",
            fsiPath ? "direct launch alongside full-screen intent" : "not proof of visibility");
        } catch (Exception error) { AlarmTrace.record(context, trace, "launchFailed", error.toString()); }
      } else {
        AlarmTrace.record(context, trace, "directSkipped", "in-call yields, banner + sound only");
      }

      // 2) Always post high-priority alarm notification (backup if activity blocked)
      Object nmObj = context.getSystemService(Context.NOTIFICATION_SERVICE);
      NotificationManager nm = nmObj instanceof NotificationManager ? (NotificationManager) nmObj : null;
      if (nm == null) return;
      ensureChannel(context, nm);

      NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setCategory(NotificationCompat.CATEGORY_ALARM)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setAutoCancel(true)
        .setOngoing(false)
        .setDefaults(NotificationCompat.DEFAULT_ALL);
      try {
        int iconId = context.getResources().getIdentifier(
          "ic_stat_attention", "drawable", context.getPackageName()
        );
        if (iconId != 0) builder.setSmallIcon(iconId);
      } catch (Exception ignored) {}

      int flags = PendingIntent.FLAG_UPDATE_CURRENT;
      if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;

      Intent alarmUi = new Intent(context, AlarmActivity.class);
      alarmUi.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
      alarmUi.putExtra(AlarmActivity.EXTRA_ID, id);
      alarmUi.putExtra(AlarmActivity.EXTRA_TITLE, title);
      alarmUi.putExtra(AlarmActivity.EXTRA_BODY, body);
      alarmUi.putExtra(AlarmActivity.EXTRA_ITEM_ID, itemId);
      alarmUi.putExtra(AlarmActivity.EXTRA_ITEM_REV, itemRev);
      if (level != null) alarmUi.putExtra(AlarmActivity.EXTRA_LEVEL, level);
      alarmUi.putExtra(AlarmTrace.EXTRA, trace);
      alarmUi.putExtra(AlarmTrace.TEST, intent.getBooleanExtra(AlarmTrace.TEST, false));
      PendingIntent contentPi = PendingIntent.getActivity(context, id, alarmUi, flags);
      builder.setContentIntent(contentPi);
      // V3：只有「锁屏/息屏」这一格才挂全屏意图（系统会真的用它全屏）；
      // 解锁亮屏时系统只会把它降级成横幅 —— 挂上去没有收益，反而会让这一次投递的
      // 全屏意图与直起的界面争抢同一个 Activity。同时把同 id 的旧通知撤掉，
      // 确保上一次投递残留的全屏意图不会继续留在系统里。
      if (fsiPath) {
        builder.setFullScreenIntent(contentPi, true);
      } else {
        try { nm.cancel(id); } catch (Exception ignored) {}
      }

      try {
        // F2：声音的所有权交给系统。
        //
        // 此前铃声由 AlarmActivity 的 MediaPlayer 播放 —— 界面一旦被系统收掉，声音随之消失
        // （真机实测：audioStarted 后 186ms 就 effectsStopped）。而通知的声音是
        // NotificationManagerService 用 IRingtonePlayer 播的，**不受本进程生死影响**；
        // 加上 FLAG_INSISTENT 后它会一直循环，直到通知被撤掉。
        // 于是「闹钟到底响没响」不再取决于界面能不能显示出来。
        Notification notification = builder.build();
        notification.flags |= Notification.FLAG_INSISTENT;
        nm.notify(id, notification);
        AlarmTrace.record(context, trace, "notifyReturned",
          "insistent; notify returned; not proof of display");
      } catch (Exception error) {
        AlarmTrace.record(context, trace, "notifyFailed", error.toString());
      }

      // Keep the notification as fallback. Opening MainActivity here can cover
      // AlarmActivity when the system concurrently dispatches the full-screen intent.
    } finally {
      if (wl != null && wl.isHeld()) {
        try { wl.release(); } catch (Exception ignored) {}
      }
    }
  }

  /**
   * Q3：写下「闹钟到点了、全屏请求已发出」这个事实，以及投递当时的环境。
   *
   * 光靠通知栏分不清下面两种情况 —— 两者在手机上都只是"响了一声"：
   * - 全屏界面真的弹出来了（AlarmActivity 会写 shownAt）；
   * - 全屏被系统拦下、只剩一条横幅（startActivity 不抛异常，只写 BAL_BLOCK 日志）。
   * 于是把「尝试」与「真的起来了」拆成两条记录，由 App 侧对比后给出结论。
   */
  private static void recordAttempt(Context context, String title, String level, boolean fullScreen,
                                    boolean screenOn, boolean locked, boolean inCall, String path) {
    try {
      SharedPreferences sp = context.getSharedPreferences(AlarmActivity.PREFS, Context.MODE_PRIVATE);
      sp.edit()
        .putLong(KEY_DELIVERY_AT, System.currentTimeMillis())
        .putBoolean(KEY_DELIVERY_ATTEMPTED, true)
        .putLong(KEY_DELIVERY_SHOWN_AT, 0L)
        .putBoolean(KEY_DELIVERY_VISIBLE, false)
        .putLong(KEY_DELIVERY_HIDDEN_AT, 0L)
        .putString(KEY_DELIVERY_PATH, path == null ? "" : path)
        .putString(KEY_DELIVERY_TITLE, title == null ? "" : title)
        .putString(KEY_DELIVERY_LEVEL, level == null ? "" : level)
        .putBoolean(KEY_DELIVERY_SCREEN_ON, screenOn)
        .putBoolean(KEY_DELIVERY_LOCKED, locked)
        .putBoolean(KEY_DELIVERY_OVERLAY, canDrawOverlays(context))
        .putBoolean(KEY_DELIVERY_IN_CALL, inCall)
        .apply();
      Log.i(TAG, "deliver path=" + path + " fullScreen=" + fullScreen
        + " screenOn=" + screenOn + " locked=" + locked + " inCall=" + inCall
        + " canDrawOverlays=" + canDrawOverlays(context));
    } catch (Exception ignored) {}
  }

  /**
   * 把「投递所需的全部信息」装进一个 Intent —— 广播投递与前台服务解冻两条路共用同一套键。
   *
   * 闹钟到点时会同时发出两条 AlarmManager 排程（见 AlarmScheduler.schedule）：
   * 广播负责投递，前台服务负责把进程从 fast_freezer 的冻结态里拉出来。
   * 两者必须携带**完全相同的 extras**，否则服务那一路解冻成功却投递不下去。
   */
  static Intent fillDelivery(Intent out, Intent source) {
    if (out == null || source == null) return out;
    String[] stringKeys = {
      EXTRA_TITLE, EXTRA_BODY, EXTRA_ITEM_ID, EXTRA_LEVEL, EXTRA_ITEM_REV, AlarmTrace.EXTRA
    };
    for (String key : stringKeys) {
      String value = source.getStringExtra(key);
      if (value != null) out.putExtra(key, value);
    }
    out.putExtra(EXTRA_ID, source.getIntExtra(EXTRA_ID, 90002));
    out.putExtra(EXTRA_FULL_SCREEN, source.getBooleanExtra(EXTRA_FULL_SCREEN, true));
    out.putExtra(AlarmTrace.TEST, source.getBooleanExtra(AlarmTrace.TEST, false));
    return out;
  }

  /** 投递当时是否已有「显示在其他应用上层」—— 没有的话后台 startActivity 必被 BAL 静默拦下 */
  static boolean canDrawOverlays(Context context) {    if (Build.VERSION.SDK_INT < 23) return true;
    try {
      return Settings.canDrawOverlays(context);
    } catch (Exception ignored) {
      return false;
    }
  }

  private static boolean isKeyguardLocked(Context context) {
    try {
      Object kmObj = context.getSystemService(Context.KEYGUARD_SERVICE);
      if (kmObj instanceof KeyguardManager) {
        return ((KeyguardManager) kmObj).isKeyguardLocked();
      }
    } catch (Exception ignored) {}
    return false;
  }

  /**
   * Q5：是否正在响铃/通话。
   *
   * 用 `AudioManager.getMode()` 而不是 `TelecomManager.isInCall()` —— 后者要
   * READ_PHONE_STATE 权限，前者不需要，且同时覆盖蜂窝通话（MODE_IN_CALL）
   * 与微信/WhatsApp 这类 VoIP（MODE_IN_COMMUNICATION）；MODE_RINGTONE 是来电响铃未接。
   * 任一种都算「电话优先」，闹钟此时只响铃 + 出横幅，不抢屏。
   */
  private static boolean isCallActive(Context context) {
    try {
      Object amObj = context.getSystemService(Context.AUDIO_SERVICE);
      if (!(amObj instanceof AudioManager)) return false;
      int mode = ((AudioManager) amObj).getMode();
      return mode == AudioManager.MODE_RINGTONE
        || mode == AudioManager.MODE_IN_CALL
        || mode == AudioManager.MODE_IN_COMMUNICATION;
    } catch (Exception ignored) {
      return false;
    }
  }

  private static Uri alarmSound(Context context) {
    try {
      int soundId = context.getResources().getIdentifier(
        "attention_reminder", "raw", context.getPackageName()
      );
      if (soundId != 0) {
        return Uri.parse("android.resource://" + context.getPackageName() + "/" + soundId);
      }
    } catch (Exception ignored) {}
    return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
  }

  private static void ensureChannel(Context context, NotificationManager nm) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
    NotificationChannel channel = new NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      NotificationManager.IMPORTANCE_HIGH
    );
    channel.setDescription("到期提醒与闹钟（可在锁屏弹出）");
    channel.enableVibration(true);
    channel.setBypassDnd(false);
    channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
    try {
      channel.setSound(alarmSound(context), new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build());
    } catch (Exception ignored) {}
    nm.createNotificationChannel(channel);
  }
}
