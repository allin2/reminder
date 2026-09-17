package space.alliswell.inbox;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public final class AlarmScheduler {
  private AlarmScheduler() {}

  public static void schedule(Context context, long triggerAt, String title, String body, int id) {
    schedule(context, triggerAt, title, body, id, "", "🚨 关键", "0");
  }

  public static void schedule(Context context, long triggerAt, String title, String body,
                              int id, String itemId, String level) {
    schedule(context, triggerAt, title, body, id, itemId, level, "0");
  }

  /**
   * V02：数据版本必须一路带到 Receiver → Activity → JS，
   * 否则「开机恢复」和「稍后重排」这两条路径的动作会带着 rev=0 被判为过期。
   */
  public static void schedule(Context context, long triggerAt, String title, String body,
                              int id, String itemId, String level, String itemRev) {
    // R3：minSdk 22 —— 不用 API 23+ 的 getSystemService(Class) 重载
    Object svc = context.getSystemService(Context.ALARM_SERVICE);
    AlarmManager am = svc instanceof AlarmManager ? (AlarmManager) svc : null;
    if (am == null) return;
    if (triggerAt < System.currentTimeMillis() + 500) {
      triggerAt = System.currentTimeMillis() + 500;
    }

    String trace = id + ":" + java.util.UUID.randomUUID().toString();
    AlarmTrace.record(context, trace, "requested", "restore/snooze triggerAt=" + triggerAt);

    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;

    // 投递 = 广播（唯一实现，见 AlarmTestReceiver）
    Intent delivery = new Intent(context, AlarmTestReceiver.class);
    delivery.setAction("space.alliswell.inbox.ACTION_TEST_ALARM");
    delivery.putExtra(AlarmTrace.EXTRA, trace);
    delivery.putExtra(AlarmTestReceiver.EXTRA_ID, id);
    delivery.putExtra(AlarmTestReceiver.EXTRA_TITLE, title);
    delivery.putExtra(AlarmTestReceiver.EXTRA_BODY, body);
    delivery.putExtra(AlarmTestReceiver.EXTRA_FULL_SCREEN, true);
    delivery.putExtra(AlarmTestReceiver.EXTRA_ITEM_ID, itemId == null ? "" : itemId);
    delivery.putExtra(AlarmTestReceiver.EXTRA_ITEM_REV,
      itemRev == null || itemRev.isEmpty() ? "0" : itemRev);
    if (level != null) delivery.putExtra(AlarmTestReceiver.EXTRA_LEVEL, level);
    PendingIntent pi = PendingIntent.getBroadcast(context, id, delivery, flags);

    AlarmManager.AlarmClockInfo info = null;
    try {
      if (Build.VERSION.SDK_INT >= 21) {
        Intent showIntent = new Intent(context, MainActivity.class);
        showIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent showPi = PendingIntent.getActivity(context, id + 100000, showIntent, flags);
        info = new AlarmManager.AlarmClockInfo(triggerAt, showPi);
        am.setAlarmClock(info, pi);
        AlarmTrace.record(context, trace, "scheduled", "triggerAt=" + triggerAt + ";mode=alarmClock");
        scheduleUnfreezer(context, am, id, trace, delivery, triggerAt, flags, info);
        return;
      }
    } catch (Exception ignored) {}

    // 兜底排程（无需精确闹钟权限时）
    try {
      if (Build.VERSION.SDK_INT >= 23) {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
      } else {
        am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
      }
      scheduleUnfreezer(context, am, id, trace, delivery, triggerAt, flags, null);
    } catch (SecurityException se) {
      am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
    }
  }

  /**
   * F3：同一时刻再排一条「前台服务」闹钟，专门负责把进程从 fast_freezer 的冻结态里拉出来。
   *
   * 为什么必须是服务：休眠态下把闹钟时钟的 PendingIntent 换成「拉起 Activity」，
   * `wm_create_activity` 根本不会出现（启动被系统直接丢弃）；而服务启动必须拉起进程。
   *
   * 为什么必须走 `setAlarmClock`（F3b，2026-09-17 真机对照实验的结论）：
   *
   * ```
   * # 冻结瞬间（22:59:09.923 = am_app_frozen 同一毫秒），dumpsys alarm 给该 UID 的全部闹钟
   * # 打上挂起标记，条目里既有 capacitor 的通知闹钟，也有 .AlarmRingService：
   *   u0a190:
   *     #6: Reason=frozen ... tag=*walarm*:space.alliswell.inbox/.AlarmRingService
   * # 而占用「闹钟时钟」位的那条（flags 3 = FLAG_WAKE_FROM_IDLE）准点派发：
   *   +478ms 8 wakes 8 alarms, last -2m31s595ms: *walarm*:...ACTION_TEST_ALARM
   *   （-2m31s595ms 回推 = 23:00:08.338，与 device_idle_wake_from_idle 同一毫秒）
   * ```
   *
   * 结论：冻结期间只有「闹钟时钟」形态会被 AlarmManager 准点派发，`setExactAndAllowWhileIdle`
   * 会被挂起 —— 所以解冻器**必须**排在闹钟时钟位上，否则它自己在冻结态根本不会被派发
   * （首轮 F3 就是这样哑火的：解冻器没跑，广播也没送达，两者都没发生）。
   *
   * 代价：本应用会有两条闹钟时钟（投递 + 解冻）。系统「下一个闹钟」只显示最后注册的那条，
   * 两条 showIntent 指向同一个 Activity，用户看不出差别；但两条都会照常触发。
   * 本方法自己不投递任何东西 —— 投递逻辑仍然只有 AlarmTestReceiver 一条实现。
   */
  static void scheduleUnfreezer(Context context, AlarmManager am, int id, String trace,
                                Intent delivery, long triggerAt, int flags,
                                AlarmManager.AlarmClockInfo info) {
    if (Build.VERSION.SDK_INT < 26) return;
    try {
      Intent service = new Intent(context, AlarmRingService.class);
      AlarmTestReceiver.fillDelivery(service, delivery);
      PendingIntent unfreezePi = PendingIntent.getForegroundService(context, id, service, flags);
      String mode;
      if (info != null) {
        am.setAlarmClock(info, unfreezePi);
        mode = "alarmClock";
      } else {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, unfreezePi);
        mode = "allowWhileIdle";
      }
      AlarmTrace.record(context, trace, "unfreezerScheduled",
        "triggerAt=" + triggerAt + ";mode=" + mode);
    } catch (Exception error) {
      AlarmTrace.record(context, trace, "unfreezerScheduleFailed", error.toString());
    }
  }

  /**
   * F3：取消必须覆盖排程时用到的**每一种** PendingIntent。
   *
   * PendingIntent 的匹配靠 (requestCode, Intent, flags)，换了形态就是另一个对象；
   * 只撤一种会留下撤不掉的幽灵闹钟 —— 到点会在用户没预期的时候弹全屏 / 响铃。
   * 三种都要撤：广播（投递）、前台服务（解冻）、以及历史版本曾用过的 Activity 直投。
   */
  public static void cancel(Context context, int id) {
    Object svc = context.getSystemService(Context.ALARM_SERVICE);
    AlarmManager am = svc instanceof AlarmManager ? (AlarmManager) svc : null;
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;

    Intent intent = new Intent(context, AlarmTestReceiver.class);
    intent.setAction("space.alliswell.inbox.ACTION_TEST_ALARM");
    cancelOne(context, am, PendingIntent.getBroadcast(context, id, intent, flags));

    if (Build.VERSION.SDK_INT >= 26) {
      Intent service = new Intent(context, AlarmRingService.class);
      cancelOne(context, am, PendingIntent.getForegroundService(context, id, service, flags));
    }

    // 历史形态：F1 实验版曾用 Activity 直投（休眠态会被系统丢弃），留在这里清掉残留
    Intent ui = new Intent(context, AlarmActivity.class);
    ui.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
      | Intent.FLAG_ACTIVITY_CLEAR_TOP
      | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    cancelOne(context, am, PendingIntent.getActivity(context, id, ui, flags));
  }

  private static void cancelOne(Context context, AlarmManager am, PendingIntent pi) {
    if (pi == null) return;
    if (am != null) am.cancel(pi);
    pi.cancel();
  }
}
