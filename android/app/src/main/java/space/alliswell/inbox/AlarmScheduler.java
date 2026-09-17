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

    Intent intent = new Intent(context, AlarmTestReceiver.class);
    intent.setAction("space.alliswell.inbox.ACTION_TEST_ALARM");
    intent.putExtra(AlarmTestReceiver.EXTRA_ID, id);
    intent.putExtra(AlarmTestReceiver.EXTRA_TITLE, title);
    intent.putExtra(AlarmTestReceiver.EXTRA_BODY, body);
    intent.putExtra(AlarmTestReceiver.EXTRA_FULL_SCREEN, true);
    intent.putExtra(AlarmTestReceiver.EXTRA_ITEM_ID, itemId == null ? "" : itemId);
    intent.putExtra(AlarmTestReceiver.EXTRA_ITEM_REV, itemRev == null || itemRev.isEmpty() ? "0" : itemRev);
    if (level != null) intent.putExtra(AlarmTestReceiver.EXTRA_LEVEL, level);

    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
    PendingIntent pi = PendingIntent.getBroadcast(context, id, intent, flags);

    try {
      if (Build.VERSION.SDK_INT >= 21) {
        Intent showIntent = new Intent(context, MainActivity.class);
        showIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent showPi = PendingIntent.getActivity(context, id + 100000, showIntent, flags);
        am.setAlarmClock(new AlarmManager.AlarmClockInfo(triggerAt, showPi), pi);
        return;
      }
    } catch (Exception ignored) {}

    try {
      if (Build.VERSION.SDK_INT >= 23) {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
      } else {
        am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
      }
    } catch (SecurityException se) {
      am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
    }
  }

  public static void cancel(Context context, int id) {
    Object svc = context.getSystemService(Context.ALARM_SERVICE);
    AlarmManager am = svc instanceof AlarmManager ? (AlarmManager) svc : null;
    Intent intent = new Intent(context, AlarmTestReceiver.class);
    intent.setAction("space.alliswell.inbox.ACTION_TEST_ALARM");
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
    PendingIntent pi = PendingIntent.getBroadcast(context, id, intent, flags);
    if (am != null) am.cancel(pi);
    pi.cancel();
  }
}
