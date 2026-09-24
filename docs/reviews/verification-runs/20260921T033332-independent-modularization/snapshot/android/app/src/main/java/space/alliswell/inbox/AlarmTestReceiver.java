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
import android.media.AudioManager;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

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
  /**
   * UX-T03：提醒键 `<attempt>@<原定时刻>` 与计划时刻。
   *
   * 为什么要一路带到这里：送达证据的**最小身份**是「事项 + 逻辑轮次 + 计划时刻 + 载体」，
   * 时间戳或标题单独都不能当身份。没有这两个 extra，接收侧就算知道自己响过，
   * 也说不清「响的是哪一轮」—— 回写到三态台账时只能计成 unknown。
   */
  public static final String EXTRA_REMINDER_KEY = "reminderKey";
  public static final String EXTRA_PLANNED_AT = "plannedAt";
  public static final String CHANNEL_ID = "attention-alarm-v4";
  public static final String CHANNEL_NAME = "提醒闹钟";
  /**
   * D59：旧渠道必须退役。
   *
   * `attention-alarm-v3` 建的时候带了 `setSound(...)` + `enableVibration(true)`，
   * 而通知渠道一旦创建，**除了名字和描述之外任何属性都不能再改** ——
   * 只把代码里的 `setSound(null)` 改掉对已安装的设备完全无效，
   * 那条老渠道会继续按老属性播声音，于是「服务自播 + 渠道播音」两路同时响。
   * 这正是 V3「响铃被打断重启」的同一个坑，只是换了个入口。
   * 所以：换新 id，并显式删掉旧的。
   */
  public static final String LEGACY_CHANNEL_ID = "attention-alarm-v3";

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
  /** 系统通知已提交到 NotificationManager；不等同于横幅已被 OEM 展示。 */
  public static final String KEY_DELIVERY_NOTIFICATION_POSTED = "deliveryNotificationPosted";
  /** V1：判定「界面没能显示出来」的时刻；0 = 没被判过 */
  public static final String KEY_DELIVERY_HIDDEN_AT = "deliveryHiddenAt";
  /**
   * H-08：投递当时**系统通知是否可用**。
   *
   * `setFullScreenIntent` 是 **Notification 的属性**（见下方 fsiPath 分支）。通知发不出去时
   * 全屏意图就没有载体、系统也不会替我们展示 —— 2026-09-18 vivo 真机取证：无通知权限 + 息屏
   * 7 轮受控投递 **0/4** 成功（有权限 2/2），断点每次都在 `created` 之前。
   *
   * **D59 之后这条只对「屏幕」成立，对声音与振动不再成立** —— 那两者已改由
   * `AlarmRingService` 自播，不经过通知。别再用它推断「闹钟没响」。
   *
   * 投递当时的值必须落盘：事后权限可能已被改过，用「现在」的权限去解释「当时」的结果会误诊
   * （这正是本项目此前把「后台启动被拦」误判成「缺全屏通知权限」的同一类错误）。
   */
  public static final String KEY_DELIVERY_NOTIFY_ON = "deliveryNotifyEnabled";
  /**
   * D64：投递当时**精确闹钟权限是否可用**。
   *
   * 与通知可用性同一条理由：事后权限可能已被改过。Android 14 起 `SCHEDULE_EXACT_ALARM`
   * 对 targetSdk ≥ 33 的新装应用**默认拒绝**，缺权限时 `AlarmScheduler` 会降级为非精确并
   * 记下真实 mode。把「投递当时能不能精确排程」一并落盘，才能把「本次本来就不准时」
   * 与「准时了但系统没展示」分开 —— 否则又会拿当下的权限去解释当时的结果，重演 H-08 的误诊。
   */
  public static final String KEY_DELIVERY_EXACT_ON = "deliveryExactEnabled";
  /**
   * D64：投递当时**全屏通知（`USE_FULL_SCREEN_INTENT`）权限是否可用**。
   *
   * Android 14 起它从普通权限变成**特殊应用访问权限**，非闹钟/通话类应用默认不授予
   * （官方 Play 政策要求这类应用「取得使用者明確同意,並清楚地說明您的需求」）。
   * 与 `deliveryOverlay`（显示在其他应用上层）并列，两者共同决定「屏幕」这一格有没有载体。
   *
   * 必须区分「投递当时」与「现在」：`lastAlarmDelivery` 回传的活值反映的是**当前**权限，
   * 用它解释一次**历史**投递的失败原因，会在用户事后改过权限时给出反向结论。
   */
  public static final String KEY_DELIVERY_FSI_ON = "deliveryFullScreenIntentEnabled";

  // ── D59/S2.5：载体归因 ──────────────────────────────────────────────────────
  //
  // 这组字段回答的问题是「这一次投递，声音/振动/前台服务**各自**落在哪里」。
  // 没有它，`notifyEnabledAtDelivery=false` 会被读成「完全静默」—— 而在 D59 之后
  // 那只是「屏幕没有载体」，声音照常在响。诊断反着报比不报更危险：
  // 2026-09-18 那轮就是靠这种反着的结论把排查引向了「加悬浮窗权限」。
  //
  // 取值：native（服务自播）· activity（界面回落自播）· notification（旧路径，不应再出现）
  //      · none（确实没响）· unknown（这次投递没有报告，不能沿用上一次的旧值）
  public static final String KEY_CARRIER_SOUND = "carrierSound";
  public static final String KEY_CARRIER_VIBRATE = "carrierVibrate";
  /** 前台服务是否成功拿到前台身份 */
  public static final String KEY_CARRIER_FGS = "carrierForegroundService";
  /** 载体上报时刻 */
  public static final String KEY_CARRIER_AT = "carrierAt";
  /**
   * 载体归属哪一次投递 —— 用 trace 而不是时间戳。
   *
   * 广播投递与前台服务是**两条同刻的闹钟时钟**（见 `AlarmScheduler.scheduleUnfreezer`），
   * 谁先派发不确定。用「谁的时间戳更新」判断归属会在「服务先跑」时判错；
   * 而两条排程携带的是**同一个 trace**，比对它才是唯一无竞态的判据。
   */
  public static final String KEY_CARRIER_TRACE = "carrierTrace";
  /** 本次投递的 trace，供上面的归属判定使用 */
  public static final String KEY_DELIVERY_TRACE = "deliveryTrace";

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
    // UX-T03：这一行就是「系统接收」的落点 —— 只有走到这里的投递才写证据。
    // 之后的通知提交 / 声振请求 / 窗口可见都**不**在此处升级层级：
    // 接收可确认时只写「系统已接收」，绝不写成用户看到或已读。
    DeliveryEvidenceStore.record(context, itemId,
      intent.getStringExtra(EXTRA_REMINDER_KEY),
      intent.getLongExtra(EXTRA_PLANNED_AT, 0L),
      "alarm", itemRev, trace);
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

    // A-03：界面直起与系统通知是两层兜底，共用同一个 token 保证重复 Intent 幂等。
    // 平台语义：
    //   · 锁屏 / 息屏 / AOD：全屏意图由系统接管，系统此时会真的全屏；
    //   · 解锁亮屏：系统会把全屏意图**有意降级成横幅**，只能自己把界面拉起来（需 BAL 豁免）。
    // 系统通知必须在两格都存在；否则 directPath 被 OEM 拦截时只剩通知中心条目，没有横幅请求。
    boolean backgroundDelivery = locked || !screenOn;
    /** 系统全屏 Intent：锁屏时尝试全屏，解锁时请求 heads-up 横幅。 */
    // A-03：全屏 Intent 也是解锁亮屏时的系统横幅请求。Android 会在锁屏/息屏时全屏，
    // 在解锁亮屏时降级为 heads-up。不能因为同时尝试 directPath 就把这个系统兜底摘掉。
    boolean fsiPath = fullScreen;
    /**
     * Q5：解锁时不得打断通话；锁屏时不受此限（锁屏本就是闹钟优先的场景）。
     *
     * V1 复测修正：此前这一格写成「解锁亮屏专用」，于是锁屏/息屏**完全不直起**，
     * 把「能不能看到闹钟」全押在系统的全屏意图上。vivo/OriginOS 16 实测该押注不成立
     * （见下方直起段的取证），结果是用户既看不到界面又听不到声音。
     * 直起改为**与全屏意图并存**，仅「解锁 + 通话中」这一格让路。
     */
    boolean directPath = fullScreen && (!inCall || locked);
    String path = !directPath ? "banner" : backgroundDelivery ? "fsi+direct" : "direct+banner";

    try {
      // Q3：先落「尝试投递」的台账（含投递当时的环境），再尝试起全屏。
      // 顺序不能反：AlarmActivity 一起就会写 shownAt，晚写会把它的记录覆盖掉。
      AlarmTrace.record(context, trace, "environment",
        "screenOn=" + screenOn + ";locked=" + locked + ";inCall=" + inCall + ";path=" + path);
      // H-08 / D59：通知不可用时，**屏幕**这一格在投递开始前就已经注定没有载体。
      //
      // 注意这里只陈述「屏幕」—— D59 把声音与振动的所有权收回应用（AlarmRingService）之后，
      // 通知不再是它们的载体。旧文案写的是 "system notifications disabled; full-screen intent
      // has no carrier"，读起来像「整个闹钟都哑了」，会把「响了但没亮屏」反着报成「完全静默」。
      // 一行文案的错误足以让下一轮排查重新走错方向，所以改的是**字段与措辞**，不只是措辞。
      if (!notificationsUsable(context)) {
        AlarmTrace.record(context, trace, "screenCarrierMissing",
          "system notifications disabled; full-screen intent has no carrier (sound+vibration unaffected: carried by AlarmRingService)");
      }
      recordAttempt(context, trace, title, level, fullScreen, screenOn, locked, inCall, path);
      ActiveAlarmStore.record(context, id, trace, itemId, itemRev, title, body);

      // D59：铃声与振动的载体是前台服务，**先于界面**启动。
      //
      // 顺序是有意的：界面能不能被拉起取决于 BAL（在 vivo 上实测经常拉不起来），
      // 而「响」不该被「亮」的失败连带。服务只要能起，声音与振动就成立 ——
      // 它走的是 exact alarm 的「后台启动前台服务」豁免，与通知权限、
      // 与界面可见性都无关。界面失败最多是「响着但看不到」，不再是「静默」。
      startRingService(context, intent, trace);

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
        .setAutoCancel(false)
        .setOngoing(false);
      // D59：**刻意不调 `setDefaults(DEFAULT_ALL)`**。
      //
      // 它会把声音与振动重新挂回这条通知上 —— 那正是 H-08 本身：通知一断，声振全没。
      // 现在这条通知只负责三件事：台账、停止入口、以及锁屏/息屏时的全屏意图兜底。
      // 声音与振动由 AlarmRingService 持有，与通知权限无关。
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
      Intent stop = new Intent(context, AlarmStopReceiver.class);
      stop.setAction("space.alliswell.inbox.STOP_DELIVERY");
      stop.putExtra(EXTRA_ID, id);
      stop.putExtra(AlarmTrace.EXTRA, trace);
      // Token in data keeps an old action distinct from a replacement delivery.
      stop.setData(android.net.Uri.parse("attention-alarm://stop/" + id + "/" + trace));
      PendingIntent stopPi = PendingIntent.getBroadcast(context, id, stop, flags);
      builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "停止声振", stopPi);
      builder.setDeleteIntent(stopPi);
      // A-03：所有 fullScreen 投递都挂同一 PendingIntent。
      // · 锁屏/息屏：系统可使用它拉起全屏；
      // · 解锁且其他应用在前台：平台按规则降级成 heads-up 横幅。
      // directPath 仍并行尝试；同 token 的 onNewIntent 是幂等的，不会重启声振。
      if (fsiPath) {
        builder.setFullScreenIntent(contentPi, true);
      }

      try {
        // D59：**不再设 `FLAG_INSISTENT`**，通知也不再承载任何声音。
        //
        // F2 当年把声音的所有权交给系统（通知的 IRingtonePlayer 播放，不受本进程生死影响），
        // 收益是「界面被系统收掉，声音还在」。但它的代价在 2026-09-18 真机上显形：
        // 无 POST_NOTIFICATIONS 时 `notify()` 是**静默空操作**，声音与振动随屏幕一起归零 ——
        // 「界面藏起来声音还在」这点收益，被「权限一拒就彻底静默」这个损失盖过。
        // D59 相应地把所有权收回 AlarmRingService（前台服务自播），本行是那次裁决的落点。
        Notification notification = builder.build();
        if (!ActiveAlarmStore.postIfActive(context, id, trace, notification)) return;
        recordNotificationPosted(context, trace);
        AlarmTrace.record(context, trace, "notifyReturned",
          "system notification posted; fullScreenIntent=" + fsiPath
            + "; sound+vibration carried by AlarmRingService; banner visibility is OEM-controlled");
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
  private static void recordAttempt(Context context, String trace, String title, String level,
                                    boolean fullScreen, boolean screenOn, boolean locked,
                                    boolean inCall, String path) {
    try {
      SharedPreferences sp = DirectBootUtils.getSafeSharedPreferences(context, AlarmActivity.PREFS, Context.MODE_PRIVATE);
      if (sp == null) return;
      sp.edit()
        .putLong(KEY_DELIVERY_AT, System.currentTimeMillis())
        .putBoolean(KEY_DELIVERY_ATTEMPTED, true)
        .putLong(KEY_DELIVERY_SHOWN_AT, 0L)
        .putBoolean(KEY_DELIVERY_VISIBLE, false)
        .putBoolean(KEY_DELIVERY_NOTIFICATION_POSTED, false)
        .putLong(KEY_DELIVERY_HIDDEN_AT, 0L)
        .putString(KEY_DELIVERY_PATH, path == null ? "" : path)
        .putString(KEY_DELIVERY_TITLE, title == null ? "" : title)
        .putString(KEY_DELIVERY_LEVEL, level == null ? "" : level)
        .putBoolean(KEY_DELIVERY_SCREEN_ON, screenOn)
        .putBoolean(KEY_DELIVERY_LOCKED, locked)
        .putBoolean(KEY_DELIVERY_OVERLAY, canDrawOverlays(context))
        .putBoolean(KEY_DELIVERY_IN_CALL, inCall)
        // H-08：投递当时的系统通知可用性（notify() 静默失败时这是唯一的线索）
        .putBoolean(KEY_DELIVERY_NOTIFY_ON, notificationsUsable(context))
        // D64：投递当时的两项「精确计时 / 亮屏」权限。与上一条同一条纪律 ——
        // 事后权限可能已被改过，只有当时的取值能解释当时的结果。
        // 没有这两个字段时，归因只能拿**现在**的权限去解释一次历史投递，
        // 结论会随用户事后是否改过权限而反转（H-08 那轮踩过的同一坑）。
        .putBoolean(KEY_DELIVERY_EXACT_ON, canScheduleExactAlarmsNow(context))
        .putBoolean(KEY_DELIVERY_FSI_ON, canUseFullScreenIntentNow(context))
        // D59：本次投递身份。载体字段归谁，靠它与 carrierTrace 比对 —— 不能用时间戳，
        // 因为「广播投递」与「响铃服务」是两条同刻的闹钟时钟，谁先跑不确定。
        .putString(KEY_DELIVERY_TRACE, trace == null ? "" : trace)
        .apply();
      Log.i(TAG, "deliver path=" + path + " fullScreen=" + fullScreen
        + " screenOn=" + screenOn + " locked=" + locked + " inCall=" + inCall
        + " canDrawOverlays=" + canDrawOverlays(context));
    } catch (Exception ignored) {}
  }

  private static void recordNotificationPosted(Context context, String trace) {
    try {
      SharedPreferences sp = DirectBootUtils.getSafeSharedPreferences(
        context, AlarmActivity.PREFS, Context.MODE_PRIVATE);
      if (sp == null) return;
      // 只允许本次投递写回，避免迟到旧通知覆盖新投递结局。
      if (!String.valueOf(trace).equals(sp.getString(KEY_DELIVERY_TRACE, ""))) return;
      sp.edit().putBoolean(KEY_DELIVERY_NOTIFICATION_POSTED, true).apply();
      AlarmTrace.record(context, trace, "systemNotificationPosted", "NotificationManager accepted active delivery");
    } catch (Exception error) {
      AlarmTrace.record(context, trace, "systemNotificationRecordFailed", error.toString());
    }
  }

  /**
   * D59：把铃声与振动交给前台服务（`AlarmRingService`）。
   *
   * 它同时承担 F3 的解冻职责 —— 这个服务本来就排在「闹钟时钟」位
   * （`AlarmScheduler.scheduleUnfreezer`），到点必然被派发。
   *
   * 起不来不是致命错误：`AlarmActivity` 还留着进程内回落自播（S2.3 降级矩阵最后一行），
   * 但账本必须记明降到了哪一级 —— 否则事后分不清「没响」与「响了但载体不同」。
   */
  private static void startRingService(Context context, Intent source, String trace) {
    try {
      Intent ring = new Intent(context, AlarmRingService.class);
      fillDelivery(ring, source);
      if (Build.VERSION.SDK_INT >= 26) {
        context.startForegroundService(ring);
      } else {
        context.startService(ring);
      }
      AlarmTrace.record(context, trace, "ringServiceRequested",
        "foreground service asked to hold sound+vibration");
    } catch (Exception error) {
      AlarmTrace.record(context, trace, "ringServiceStartFailed", error.toString());
    }
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
      EXTRA_TITLE, EXTRA_BODY, EXTRA_ITEM_ID, EXTRA_LEVEL, EXTRA_ITEM_REV,
      // UX-T03：两条路共用同一套 extras，提醒键与计划时刻也必须一起带过去，
      // 否则「服务那一路解冻成功并真的响铃」这一次投递在证据台账里没有身份。
      EXTRA_REMINDER_KEY, AlarmTrace.EXTRA
    };
    for (String key : stringKeys) {
      String value = source.getStringExtra(key);
      if (value != null) out.putExtra(key, value);
    }
    out.putExtra(EXTRA_ID, source.getIntExtra(EXTRA_ID, 90002));
    out.putExtra(EXTRA_PLANNED_AT, source.getLongExtra(EXTRA_PLANNED_AT, 0L));
    out.putExtra(EXTRA_FULL_SCREEN, source.getBooleanExtra(EXTRA_FULL_SCREEN, true));
    out.putExtra(AlarmTrace.TEST, source.getBooleanExtra(AlarmTrace.TEST, false));
    return out;
  }

  /** 投递当时是否已有「显示在其他应用上层」—— 没有的话后台 startActivity 必被 BAL 静默拦下 */
  static boolean canDrawOverlays(Context context) {
    if (Build.VERSION.SDK_INT < 23) return true;
    try {
      return Settings.canDrawOverlays(context);
    } catch (Exception ignored) {
      return false;
    }
  }

  /**
   * H-08：系统通知是否真的可用（Android 13+ 未授予 POST_NOTIFICATIONS 时 `notify()` 是**静默**空操作）。
   *
   * 用 NotificationManagerCompat 而不是 `NotificationManager.areNotificationsEnabled()`：
   * 后者是 API 24+ 的方法，minSdk 22 下直接调用会抛 `NoSuchMethodError`，而
   * `catch (Exception)` 兜不住它（H-04 已修过同一处，这里是投递侧的同一坑）。
   */
  static boolean notificationsUsable(Context context) {
    try {
      return NotificationManagerCompat.from(context).areNotificationsEnabled();
    } catch (Exception | Error ignored) {
      // 判不出来时按「可用」处理：宁可让诊断少说一句，也不要误报成「没权限」。
      return true;
    }
  }

  /**
   * D64：投递当时的「精确闹钟」可用性。
   *
   * 判据只有 `AlarmManager.canScheduleExactAlarms()` 一个（`AlarmScheduler` 同源），
   * 不用「声明了哪个权限」去推断 —— 权限声明与运行时授予是两件事，
   * Android 14 起 `SCHEDULE_EXACT_ALARM` 正是「声明了但默认没授予」的典型。
   */
  static boolean canScheduleExactAlarmsNow(Context context) {
    try {
      return AlarmScheduler.canScheduleExactAlarms(context);
    } catch (Exception | Error ignored) {
      return true;
    }
  }

  /**
   * D64：投递当时的「全屏通知」特殊权限（Android 14+ 起属特殊应用访问权限）。
   *
   * 与上面的通知可用性同一条纪律：**投递当时**取值才有解释力，
   * `SystemBridgePlugin.lastAlarmDelivery` 里那个活值表达的是「现在」。
   *
   * minSdk 22 陷阱同 H-08：`NotificationManager.canUseFullScreenIntent()` 是 API 34+ 的方法，
   * 低版本直接调用抛 `NoSuchMethodError`，而 `catch (Exception)` **兜不住它** ——
   * 所以版本判断必须前置，且 catch 要并上 `Error`。
   */
  static boolean canUseFullScreenIntentNow(Context context) {
    if (Build.VERSION.SDK_INT < 34) return true;
    try {
      Object svc = context.getSystemService(Context.NOTIFICATION_SERVICE);
      NotificationManager nm = svc instanceof NotificationManager ? (NotificationManager) svc : null;
      return nm != null && nm.canUseFullScreenIntent();
    } catch (Exception | Error ignored) {
      // 与 notificationsUsable 同调：判不出来时按「可用」处理，避免把「读不到」误报成「没权限」。
      return true;
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

  private static void ensureChannel(Context context, NotificationManager nm) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    // D59：先退役旧渠道。
    //
    // 通知渠道一旦创建，**除名字与描述外任何属性都不能再改**。`attention-alarm-v3`
    // 带有 `setSound(...)` 与 `enableVibration(true)`，光改代码对已安装的设备无效 ——
    // 那条老渠道会继续按老属性播声音，与 AlarmRingService 的自播叠成两路。
    // 所以必须换 id + 显式删除，不能指望"改属性"。
    try {
      if (nm.getNotificationChannel(LEGACY_CHANNEL_ID) != null) {
        nm.deleteNotificationChannel(LEGACY_CHANNEL_ID);
      }
    } catch (Exception ignored) {}
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
    NotificationChannel channel = new NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      NotificationManager.IMPORTANCE_HIGH
    );
    channel.setDescription("到期提醒与闹钟（可在锁屏弹出；声音与振动由应用自己播）");
    // D59：**无声音、无振动**。保留 IMPORTANCE_HIGH 只为保住横幅与全屏意图的能力
    //  —— 那两者是「屏幕」的载体，与声音/振动无关。
    channel.enableVibration(false);
    channel.setSound(null, null);
    channel.setBypassDnd(false);
    channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
    nm.createNotificationChannel(channel);
  }
}
