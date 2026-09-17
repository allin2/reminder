package space.alliswell.inbox;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;

/**
 * F3：闹钟到点时的「解冻投递器」。
 *
 * ## 为什么需要它
 *
 * vivo / OriginOS 的 `fast_freezer` 会把后台进程冻进 cgroup。真机取证
 * （2026-09-17，events 缓冲）：
 *
 * ```
 * 22:35:30.956  am_app_frozen   [10190, space.alliswell.inbox, from fast_freezer]
 * 22:35:31.809  device_idle_wake_from_idle [*walarm*:…ACTION_TEST_ALARM]   ← 系统侧分秒不差
 * 22:36:48.335  am_app_unfrozen […reason=resume top activity]              ← 解冻者不是广播
 * 22:36:48.664  deliveryAt                                                 ← 实际送达，晚 77 秒
 * ```
 *
 * 每一次解冻的原因只有两类：`screen on` / `resume top activity`。**广播投递不会解冻进程**，
 * 所以闹钟虽然准时唤醒了系统，却要等到用户点亮屏幕才被送达 —— 用户感知就是
 * 「闹钟只有打开 App 才响」。
 *
 * 2026-09-17 晚的补充取证（把机制钉死，两次独立实验）：
 *
 * ```
 * ① 冻结期间系统侧到底发生了什么（dumpsys alarm，dump 时刻 23:02:39.933）
 *      u0a190:
 *        #1..#10: Reason=frozen   rtc=2026-09-17 22:59:09.923   ← 与 am_app_frozen 同一毫秒
 *        #6: tag=*walarm*:space.alliswell.inbox/.AlarmRingService ← 本服务也在被挂起之列
 *      +478ms 8 wakes 8 alarms, last -2m31s595ms: *walarm*:…ACTION_TEST_ALARM
 *        （-2m31s595ms 回推 = 23:00:08.338，正是 device_idle_wake_from_idle 的时刻）
 *      → 「闹钟时钟」形态准点派发；allow-while-idle 形态被冻结挂起。
 *
 * ② 同一份代码，应用**没有被冻结**（保持前台）时的对照实验
 *      unfreezerStarted → received → notifyReturned(insistent) → unfreezerStopped
 *      deliveryAt=23:05:01.963（目标 23:05:01）、deliveryVisible=true、deliveryPath=direct
 *      → 机制本身没毛病，冻结是唯一阻塞。冻结那次（23:00:08 的闹钟）直到 23:04 把应用
 *        拉回前台才补投 —— 与「解冻后补投」一致。
 * ```
 *
 * 所以本服务的闹钟**必须排在「闹钟时钟」位**（`setAlarmClock`，见 AlarmScheduler.scheduleUnfreezer），
 * 否则它自己就会在冻结态被挂起，等于没排。
 *
 * 另外两条已实测排除的路径：
 * * 把闹钟时钟的 PendingIntent 换成「拉起 AlarmActivity」—— 休眠态下 `wm_create_activity`
 *   根本不出现（启动被直接丢弃），比广播更糟；亮屏解锁下才正常。
 * * 加入电池优化白名单（`cmd deviceidle whitelist +pkg`）—— 白名单后 6 秒依然被冻结。
 *
 * 剩下的唯一杠杆是：**服务启动必须把进程拉起来**。所以闹钟到点时会同时发出两条排程 ——
 * 广播负责投递（冻结时被挂起，解冻后补投，不会丢），本服务负责在这一刻把进程解冻，
 * 让那条已经在队列里的广播能被及时投递。
 *
 * ## 它做什么
 *
 * 只做两件事：成为前台服务（合法地把进程拉起来并短暂留住），然后等广播投递完成再退出。
 * **它自己不投递任何东西** —— 投递逻辑仍然只有 AlarmTestReceiver 一条实现。
 *
 * ## 已知边界（诚实记录，别当成已修）
 *
 * 冻结态下广播与 Activity 启动都进不去这个进程。若某台设备上连「闹钟时钟 → 前台服务」
 * 也被系统丢弃（例如更激进的 ROM），那么应用侧**没有任何**手段能在不被冻结的前提下响铃 ——
 * 那时唯一的出路是让进程始终不被冻结（常驻前台服务）或由用户把应用加入厂商后台白名单。
 */
public class AlarmRingService extends Service {
  /** 与闹钟通知（90002/90003…）分开的 id，避免覆盖 */
  private static final int FOREGROUND_ID = 90090;
  private static final String CHANNEL_ID = "attention-alarm-guard";
  /** 前台通知保留时长：覆盖广播投递，并让进程在被再次冻结前把投递做完 */
  private static final long HOLD_MS = 8000L;
  /**
   * 测试钩子：允许调用方指定前台身份保留多久（毫秒）。
   *
   * 服务不导出，只有应用自己（或 run-as / shell）能带这个 extra，所以不构成外部攻击面。
   * 加它的原因是「前台身份到底能不能挡住 fast_freezer」必须用**长于 8 秒**的窗口才测得出：
   * 首轮实验里冻结恰好落在 8 秒持有期结束的那一刻，无法区分「没被冻」与「冻完就解」。
   */
  static final String EXTRA_HOLD_MS = "holdMs";

  private final Handler handler = new Handler(Looper.getMainLooper());

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String trace = intent == null ? null : intent.getStringExtra(AlarmTrace.EXTRA);
    long holdMs = intent == null ? HOLD_MS : intent.getLongExtra(EXTRA_HOLD_MS, HOLD_MS);
    if (holdMs < 1000) holdMs = 1000;
    AlarmTrace.record(this, trace, "unfreezerStarted", "foreground service torn down the freezer");
    try {
      startForeground(FOREGROUND_ID, guardNotification());
    } catch (Exception error) {
      // 拿不到前台身份也要把广播那条路放出去 —— 它至少还能迟到送达
      AlarmTrace.record(this, trace, "unfreezerForegroundFailed", error.toString());
    }
    final long hold = holdMs;
    handler.postDelayed(() -> {
      try { stopForeground(true); } catch (Exception ignored) {}
      stopSelf();
      AlarmTrace.record(this, trace, "unfreezerStopped", "hold=" + hold + "ms");
    }, hold);
    return START_NOT_STICKY;
  }

  /**
   * 前台身份必须有一张通知。这张是**静音、无图标**的占位（IMPORTANCE_MIN），
   * 与闹钟通知不是同一条 —— 用户看到的仍然是「提醒闹钟」那条带声的通知。
   */
  private Notification guardNotification() {
    Object nmObj = getSystemService(NOTIFICATION_SERVICE);
    NotificationManager nm = nmObj instanceof NotificationManager ? (NotificationManager) nmObj : null;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null
      && nm.getNotificationChannel(CHANNEL_ID) == null) {
      NotificationChannel channel = new NotificationChannel(
        CHANNEL_ID, "闹钟送达护航", NotificationManager.IMPORTANCE_MIN);
      channel.setDescription("仅在闹钟到点、需要把进程从冻结态唤醒时短暂出现");
      channel.setShowBadge(false);
      channel.setSound(null, null);
      nm.createNotificationChannel(channel);
    }
    return new NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle("闹钟正在送达")
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setOngoing(true)
      .build();
  }

  @Override
  public void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
