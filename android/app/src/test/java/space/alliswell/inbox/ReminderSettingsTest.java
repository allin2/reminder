package space.alliswell.inbox;

import static org.junit.Assert.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.SharedPreferences;
import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.json.JSONArray;
import org.junit.Test;

/** JVM 平台替身仅代替 Intent / SharedPreferences；测试生产传递与持久化代码。 */
public class ReminderSettingsTest {
  static final class PrefContext extends ContextWrapper {
    final Map<String, SharedPreferences> stores = new HashMap<>();
    final Context device;
    PrefContext(Context device) { super(null); this.device = device; }
    @Override public Context createDeviceProtectedStorageContext() { return device; }
    @Override public SharedPreferences getSharedPreferences(String name, int mode) {
      if (!stores.containsKey(name)) stores.put(name, prefs());
      return stores.get(name);
    }
  }
  static SharedPreferences prefs() {
    Map<String, String> values = new HashMap<>();
    SharedPreferences p = mock(SharedPreferences.class);
    SharedPreferences.Editor e = mock(SharedPreferences.Editor.class);
    when(p.getString(anyString(), anyString())).thenAnswer(a -> values.getOrDefault(a.getArgument(0), a.getArgument(1)));
    when(p.edit()).thenReturn(e);
    when(e.putString(anyString(), anyString())).thenAnswer(a -> { values.put(a.getArgument(0), a.getArgument(1)); return e; });
    when(e.putInt(anyString(), anyInt())).thenReturn(e);
    when(e.putLong(anyString(), anyLong())).thenReturn(e);
    when(e.commit()).thenReturn(true);
    return p;
  }

  @Test public void durationTravelsAlongReceiverAndUnfreezerPath() {
    Intent source = mock(Intent.class), target = mock(Intent.class);
    when(source.getLongExtra(AlarmRingService.EXTRA_AUTO_SILENCE_MS, AlarmRingService.AUTO_SILENCE_MS)).thenReturn(120000L);
    AlarmTestReceiver.fillDelivery(target, source);
    verify(target).putExtra(AlarmRingService.EXTRA_AUTO_SILENCE_MS, 120000L);
    Intent legacy = mock(Intent.class), out = mock(Intent.class);
    when(legacy.getLongExtra(AlarmRingService.EXTRA_AUTO_SILENCE_MS, AlarmRingService.AUTO_SILENCE_MS)).thenReturn(AlarmRingService.AUTO_SILENCE_MS);
    AlarmTestReceiver.fillDelivery(out, legacy);
    verify(out).putExtra(AlarmRingService.EXTRA_AUTO_SILENCE_MS, 300000L);
  }

  @Test public void persistedSchedulesKeepDurationInBothStorageDomains() throws Exception {
    // 沿用现有 JVM 工具修改 SDK，并在 finally 恢复，不污染其他用例。
    Method sdk = ProductionJavaAlarmTest.class.getDeclaredMethod("setSdkInt", int.class);
    sdk.setAccessible(true);
    int prior = (Integer) sdk.invoke(null, 26);
    try {
      PrefContext de = new PrefContext(null), ce = new PrefContext(de);
      SystemBridgePlugin.persistAlarm(ce, 12, 2000000000000L, "2033-05-18T09:15:00", "wall-clock",
        "private title", "private body", "item", "normal", "2", "0@123", 120000L);
      JSONArray saved = new JSONArray(ce.getSharedPreferences(SystemBridgePlugin.PREFS_SCHEDULES, 0).getString("alarms", "[]"));
      JSONArray direct = new JSONArray(de.getSharedPreferences(SystemBridgePlugin.PREFS_DIRECT_BOOT, 0).getString("alarms", "[]"));
      assertEquals(120000L, saved.getJSONObject(0).getLong("autoSilenceMs"));
      assertEquals(120000L, direct.getJSONObject(0).getLong("autoSilenceMs"));
      assertFalse(direct.getJSONObject(0).has("title"));
      assertFalse(direct.getJSONObject(0).has("body"));
      // 同 id 覆盖更新；旧调用仍用默认值，不破坏旧记录恢复。
      SystemBridgePlugin.persistAlarm(ce, 12, 2000000000000L, "title", "body", "item", "normal", "2");
      saved = new JSONArray(ce.getSharedPreferences(SystemBridgePlugin.PREFS_SCHEDULES, 0).getString("alarms", "[]"));
      assertEquals(1, saved.length());
      assertEquals(300000L, saved.getJSONObject(0).getLong("autoSilenceMs"));
    } finally { sdk.invoke(null, prior); }
  }

  @Test public void configuredDeadlineDoesNotRestartOnRepeatedDelivery() {
    PrefContext context = new PrefContext(null);
    String token = UUID.randomUUID().toString();
    AlarmRingService.DeliveryRecord first = AlarmRingService.ensureDeliveryRecord(context, token, 120000L);
    assertEquals(120000L, first.silenceDeadlineElapsed - first.startedElapsed);
    assertSame(first, AlarmRingService.ensureDeliveryRecord(context, token, 180000L));
    AlarmRingService.markAutoSilenced(context, token);
    assertEquals(0L, AlarmRingService.getRemainingSilenceMs(context, token, 180000L));
    assertEquals(AlarmRingService.STATE_AUTO_SILENCED, AlarmRingService.getDeliveryState(context, token));
    assertFalse(context.stores.containsKey("attention_alarm_actions"));
  }
}
