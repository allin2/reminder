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

    // D64（2026-09-19）：精确闹钟权限必须**先查再排**，不能只靠 try/catch 兜。
    //
    // 官方迁移步骤第一条就是「At a minimum, apps must check to see if they have the
    // permission before scheduling exact alarms」（Android 14 行为变更 / schedule-exact-alarms）。
    // 此前的写法只靠异常兜底，于是形成一条**静默降级**路径：
    //   ① `setExactAndAllowWhileIdle` 抛 SecurityException → 落到 `am.set()`（非精确）；
    //   ② 而 `scheduleUnfreezer` 写在同一 try 内 → **连解冻器都没排**；
    //   ③ 整条路径**一条台账都不写** → 与「安静地不响」同类的失效形态。
    // 这条路径在本次移除 `USE_EXACT_ALARM`（D64：本应用非闹钟/日历核心功能）后，会成为
    // Android 14+ 的**默认**路径，所以必须在它变成默认之前修好。
    boolean exactPerm = canScheduleExactAlarms(context);

    AlarmManager.AlarmClockInfo info = null;
    if (exactPerm && Build.VERSION.SDK_INT >= 21) {
      try {
        Intent showIntent = new Intent(context, MainActivity.class);
        showIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent showPi = PendingIntent.getActivity(context, id + 100000, showIntent, flags);
        info = new AlarmManager.AlarmClockInfo(triggerAt, showPi);
        am.setAlarmClock(info, pi);
      } catch (Exception error) {
        // 不再 `catch (Exception ignored)`：闹钟时钟位是冻结态下唯一会被准点派发的形态
        // （见下方 scheduleUnfreezer 的取证），拿不到就必须留痕，否则事后只能靠猜。
        AlarmTrace.record(context, trace, "alarmClockFailed", error.toString());
        info = null;
      }
    } else if (!exactPerm) {
      AlarmTrace.record(context, trace, "exactAlarmPermissionMissing",
        "canScheduleExactAlarms=false; degrades to inexact");
    }

    String mode;
    if (info != null) {
      mode = "alarmClock";
    } else if (exactPerm) {
      try {
        if (Build.VERSION.SDK_INT >= 23) {
          am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
          mode = "exactIdle";
        } else {
          am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
          mode = "exact";
        }
      } catch (Exception error) {
        AlarmTrace.record(context, trace, "exactScheduleFailed", error.toString());
        am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        mode = "inexactFallback";
      }
    } else {
      // 无精确闹钟权限：官方认可的降级形态。`set()` 由系统批量对齐，**不保证准点**
      // （官方对「用户指定时间之后发生的动作」正是推荐 `set()`）。如实记 mode。
      am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
      mode = "inexactNoPermission";
    }

    AlarmTrace.record(context, trace, "scheduled",
      "triggerAt=" + triggerAt + ";mode=" + mode);

    // 解冻器**必须**留在这次判定之外：即使精确排程拿不到，进程仍然需要被拉起来。
    // 否则 F3 的解冻（「只有打开 App 才响」的那个修复）在权限缺失时整条失效。
    scheduleUnfreezer(context, am, id, trace, delivery, triggerAt, flags, info);
  }

  /**
   * D64：精确闹钟权限的**单一判据**。
   *
   * Android 14 起 `SCHEDULE_EXACT_ALARM` 对 targetSdk ≥ 33 的新装应用**默认拒绝**
   * （官方：「no longer being pre-granted to most newly installed apps targeting Android 13
   * and higher」），而 `setExact()` / `setExactAndAllowWhileIdle()` / `setAlarmClock()`
   * 缺权限会抛 `SecurityException`。API 31 以下没有这个权限概念，恒为可用。
   */
  static boolean canScheduleExactAlarms(Context context) {
    if (Build.VERSION.SDK_INT < 31) return true;
    Object svc = context.getSystemService(Context.ALARM_SERVICE);
    AlarmManager am = svc instanceof AlarmManager ? (AlarmManager) svc : null;
    if (am == null) return false;
    try {
      return am.canScheduleExactAlarms();
    } catch (Exception ignored) {
      return false;
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
      } else if (canScheduleExactAlarms(context)) {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, unfreezePi);
        mode = "allowWhileIdle";
      } else {
        // D64：无精确闹钟权限时只能退回非精确 —— 冻结态下它会被挂起（`Reason=frozen`），
        // 也就是说解冻本身在此时**是失效的**。如实记 mode，不假装它与闹钟时钟位等价。
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, unfreezePi);
        mode = "inexactIdle";
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
