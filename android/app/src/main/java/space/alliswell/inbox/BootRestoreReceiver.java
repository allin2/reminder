package space.alliswell.inbox;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * P1-4：开机 / 应用更新后恢复 SystemBridge 排下的全屏闹钟。
 *
 * Capacitor 的 LocalNotifications 插件只恢复它自己排的通知；
 * 关键/重要档的「首次」提醒走 setAlarmClock，重启后不恢复就会静默丢失（AC-13）。
 * 已过期的记录不再补排，避免开机后集中补响。
 */
public class BootRestoreReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (context == null || intent == null) return;
    String action = intent.getAction();
    if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
      && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
      return;
    }
    try {
      SystemBridgePlugin.restorePersistedAlarms(context);
    } catch (Exception ignored) {}
  }
}
