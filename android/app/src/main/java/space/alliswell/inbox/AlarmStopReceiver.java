package space.alliswell.inbox;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Notification stop/dismiss works without opening the WebView or finding an item. */
public class AlarmStopReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context context, Intent intent) {
    if (intent == null || !intent.hasExtra(AlarmTestReceiver.EXTRA_ID)) return;
    String token = intent.getStringExtra(AlarmTrace.EXTRA);
    if (token == null) return;
    ActiveAlarmStore.stop(context, intent.getIntExtra(AlarmTestReceiver.EXTRA_ID, 0), token);
  }
}
