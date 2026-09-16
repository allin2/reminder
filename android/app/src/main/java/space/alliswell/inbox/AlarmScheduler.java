package space.alliswell.inbox;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public final class AlarmScheduler {
  private AlarmScheduler() {}

  public static void schedule(Context context, long triggerAt, String title, String body, int id) {
    AlarmManager am = context.getSystemService(AlarmManager.class);
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
    AlarmManager am = context.getSystemService(AlarmManager.class);
    Intent intent = new Intent(context, AlarmTestReceiver.class);
    intent.setAction("space.alliswell.inbox.ACTION_TEST_ALARM");
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
    PendingIntent pi = PendingIntent.getBroadcast(context, id, intent, flags);
    if (am != null) am.cancel(pi);
    pi.cancel();
  }
}
