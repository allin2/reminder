package space.alliswell.inbox;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

public class AlarmTestReceiver extends BroadcastReceiver {
  public static final String EXTRA_ID = "id";
  public static final String EXTRA_TITLE = "title";
  public static final String EXTRA_BODY = "body";
  public static final String EXTRA_FULL_SCREEN = "fullScreen";
  public static final String CHANNEL_ID = "attention-alarm-v3";
  public static final String CHANNEL_NAME = "提醒闹钟";

  @Override
  public void onReceive(Context context, Intent intent) {
    if (context == null || intent == null) return;
    int id = intent.getIntExtra(EXTRA_ID, 90002);
    String title = intent.getStringExtra(EXTRA_TITLE);
    String body = intent.getStringExtra(EXTRA_BODY);
    boolean fullScreen = intent.getBooleanExtra(EXTRA_FULL_SCREEN, true);
    if (title == null || title.isEmpty()) title = "安心收件箱";
    if (body == null || body.isEmpty()) body = "有一条事项需要你确认";

    PowerManager pm = context.getSystemService(PowerManager.class);
    PowerManager.WakeLock wl = null;
    if (pm != null) {
      wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "attention:alarm");
      wl.setReferenceCounted(false);
      try { wl.acquire(30000L); } catch (Exception ignored) {}
    }

    try {
      // 1) Directly launch full-screen alarm UI (works when setAlarmClock grants temp allowlist)
      boolean launched = false;
      if (fullScreen) {
        try {
          Intent activity = new Intent(context, AlarmActivity.class);
          activity.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP
            | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
          activity.putExtra(AlarmActivity.EXTRA_ID, id);
          activity.putExtra(AlarmActivity.EXTRA_TITLE, title);
          activity.putExtra(AlarmActivity.EXTRA_BODY, body);
          context.startActivity(activity);
          launched = true;
        } catch (Exception ignored) {}
      }

      // 2) Always post high-priority alarm notification (backup if activity blocked)
      NotificationManager nm = context.getSystemService(NotificationManager.class);
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
      PendingIntent contentPi = PendingIntent.getActivity(context, id, alarmUi, flags);
      builder.setContentIntent(contentPi);
      if (fullScreen) builder.setFullScreenIntent(contentPi, true);

      nm.notify(id, builder.build());

      if (!launched) {
        // last resort: open main app so user sees something
        try {
          Intent main = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
          if (main != null) {
            main.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            main.putExtra("fromAlarm", true);
            main.putExtra("alarmTitle", title);
            main.putExtra("alarmBody", body);
            context.startActivity(main);
          }
        } catch (Exception ignored) {}
      }
    } finally {
      if (wl != null && wl.isHeld()) {
        try { wl.release(); } catch (Exception ignored) {}
      }
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
