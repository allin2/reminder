package space.alliswell.inbox;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.UserManager;
import android.util.Log;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * P1-4 & Phase D：开机 / 应用更新 / 系统时间或时区变更后恢复 SystemBridge 排下的全屏闹钟。
 *
 * Capacitor 的 LocalNotifications 插件只恢复它自己排的通知；
 * 关键/重要档的「首次」提醒走 setAlarmClock，重启后不恢复就会静默丢失（AC-13）。
 *
 * 关键改造（Phase D）：
 * - 使用 goAsync() 并在后台单线程池中异步重排，杜绝 BroadcastReceiver 主线程 ANR；
 * - 监听 ACTION_TIME_SET 与 ACTION_TIMEZONE_CHANGED，执行防群响与本地时钟校准；
 * - 兼顾 Direct Boot 安全上下文。
 */
public class BootRestoreReceiver extends BroadcastReceiver {
  private static final String TAG = "BootRestoreReceiver";
  private static final ExecutorService RESTORE_EXECUTOR = Executors.newSingleThreadExecutor();

  @Override
  public void onReceive(Context context, Intent intent) {
    if (context == null || intent == null) return;
    final String action = intent.getAction();
    if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
      && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
      && !Intent.ACTION_TIME_CHANGED.equals(action)
      && !"android.intent.action.TIME_SET".equals(action)
      && !Intent.ACTION_TIMEZONE_CHANGED.equals(action)
      && !"android.intent.action.LOCKED_BOOT_COMPLETED".equals(action)
      && !Intent.ACTION_USER_UNLOCKED.equals(action)) {
      return;
    }

    // Direct Boot (API 24+)：若设备尚未解锁，使用 Device Protected 存储中的最小计划镜像进行安全恢复
    if (Build.VERSION.SDK_INT >= 24) {
      try {
        UserManager um = (UserManager) context.getSystemService(Context.USER_SERVICE);
        if (um != null && !um.isUserUnlocked()) {
          final PendingResult pendingResult = goAsync();
          final Context deContext = context.createDeviceProtectedStorageContext();
          RESTORE_EXECUTOR.execute(() -> {
            try {
              SystemBridgePlugin.restoreDirectBootAlarms(deContext, action);
            } catch (Throwable t) {
              Log.e(TAG, "restoreDirectBootAlarms failed for action=" + action, t);
            } finally {
              try {
                pendingResult.finish();
              } catch (Exception ignored) {}
            }
          });
          return;
        }
      } catch (Exception ignored) {}
    }

    final PendingResult pendingResult = goAsync();
    final Context appContext = context.getApplicationContext() != null
      ? context.getApplicationContext() : context;

    RESTORE_EXECUTOR.execute(() -> {
      try {
        SystemBridgePlugin.restorePersistedAlarms(appContext, action);
      } catch (Throwable t) {
        Log.e(TAG, "restorePersistedAlarms failed for action=" + action, t);
      } finally {
        try {
          pendingResult.finish();
        } catch (Exception ignored) {}
      }
    });
  }
}
