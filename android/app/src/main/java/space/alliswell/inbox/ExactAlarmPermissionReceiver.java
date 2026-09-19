package space.alliswell.inbox;

import android.app.AlarmManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * D64：精确闹钟权限**变更后自动重排**已持久化的闹钟。
 *
 * ## 为什么必须有它
 *
 * 这是官方迁移清单里我们**唯一没做的一步**。Android 14 行为变更
 * （`about/versions/14/changes/schedule-exact-alarms`）写明：
 *
 * > Set up your app to listen and properly react to the foreground broadcast
 * > `AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`,
 * > which the system sends when the user grants the permission.
 *
 * 缺这一步的后果是**静默的**：用户被引导到「闹钟和提醒」页并授予权限之后，
 * 此前因为没权限而降级成非精确的闹钟**不会自己变回精确**，要等到下次开机
 * （`BootRestoreReceiver`）或用户重新编辑事项。用户以为自己刚修好了，实际没有。
 *
 * ## 为什么现在才需要
 *
 * 在此之前本应用声明了 `USE_EXACT_ALARM`（安装即授予、且用户无法撤销），
 * 于是 `canScheduleExactAlarms()` 恒为 true，这条广播永远不会来。
 * 移除该权限（D64：本应用核心功能是提醒/待办，不满足 Play 对该受限权限的资格）
 * 之后，`SCHEDULE_EXACT_ALARM` 在 Android 14+ 上**默认拒绝**，这条路才真正被走到。
 *
 * ## 触发的时机与边界
 *
 * - 系统只在用户**授予**时发这条广播；**撤销没有对应广播**（且撤销会连带清掉已排的精确闹钟），
 *   所以撤销方向依靠「排程前的 `canScheduleExactAlarms()` 预检」+ 开机重排兜底，这里不假装能接住。
 * - 收到广播≠一定已授权，仍以 `canScheduleExactAlarms()` 的实测值为准。
 * - 用 `goAsync()` 而不是在 `onReceive` 里直接做完：重排要走 SharedPreferences 与
 *   AlarmManager，`onReceive` 有 10 秒上限；`goAsync()` 能让系统在 `finish()`
 *   之前保持本进程存活，避免重排做到一半被回收。
 */
public class ExactAlarmPermissionReceiver extends BroadcastReceiver {

  /** 本次权限变更事件的台账分组用的 token（区别于具体某条闹钟的 `id:uuid`） */
  static final String TRACE_TOKEN = "exactAlarmPermission";

  @Override
  public void onReceive(Context context, Intent intent) {
    if (context == null || intent == null) return;
    String action = intent.getAction();
    if (!AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(action)) {
      return;
    }

    final Context appContext = context.getApplicationContext() == null
      ? context : context.getApplicationContext();
    final PendingResult pending = goAsync();

    new Thread(() -> {
      try {
        boolean granted = AlarmScheduler.canScheduleExactAlarms(appContext);
        AlarmTrace.record(appContext, TRACE_TOKEN, "exactAlarmPermissionChanged",
          granted
            ? "canScheduleExactAlarms=true; rescheduling persisted alarms"
            : "canScheduleExactAlarms=false (broadcast not proof of grant); nothing rescheduled");
        if (granted) {
          // 与开机恢复同一条实现：丢弃已过期的、重排仍未来的。
          // 每条闹钟会经 AlarmScheduler.schedule 落一条真实 mode 的台账（D64）。
          SystemBridgePlugin.restorePersistedAlarms(appContext);
        }
      } catch (Exception error) {
        AlarmTrace.record(appContext, TRACE_TOKEN, "exactAlarmPermissionFailed", error.toString());
      } finally {
        try {
          pending.finish();
        } catch (Exception ignored) {}
      }
    }, "exact-alarm-permission").start();
  }
}
