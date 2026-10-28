package space.alliswell.inbox;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.capacitorjs.plugins.localnotifications.LocalNotification;
import com.capacitorjs.plugins.localnotifications.LocalNotificationManager;
import com.capacitorjs.plugins.localnotifications.LocalNotificationsPlugin;
import com.getcapacitor.CapConfig;
import com.getcapacitor.JSObject;
import java.lang.reflect.Field;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.*;
import org.mockito.MockedConstruction;
import org.mockito.MockedStatic;
import org.mockito.ArgumentCaptor;

/** Real scheduler/store/receiver methods; Android alarm dispatch and renderer are platform seams.
 * This does not establish OEM delivery or actual notification visibility. Run -Xint (SDK_INT fixture).
 */
public class NotificationSchedulerTest {
  Context context;
  AlarmManager alarm;
  PendingIntent pi;
  MockedStatic<PendingIntent> pending;
  MockedConstruction<Intent> intents;
  MockedStatic<NotificationManagerCompat> notifications;
  NotificationManagerCompat nm;
  Map<String, Map<String, String>> stores;
  boolean commitOk;
  int originalSdk;

  private void sdk(int value) throws Exception {
    Class<?> c = Class.forName("sun.misc.Unsafe");
    Field f = c.getDeclaredField("theUnsafe"); f.setAccessible(true); Object u = f.get(null);
    Field target = Build.VERSION.class.getDeclaredField("SDK_INT");
    c.getMethod("putInt", Object.class, long.class, int.class).invoke(u,
      c.getMethod("staticFieldBase", Field.class).invoke(u, target),
      (Long) c.getMethod("staticFieldOffset", Field.class).invoke(u, target), value);
  }

  @Before public void before() throws Exception {
    originalSdk = Build.VERSION.SDK_INT; sdk(36);
    stores = new HashMap<>(); commitOk = true;
    context = mock(Context.class); alarm = mock(AlarmManager.class); pi = mock(PendingIntent.class);
    when(context.getSystemService(Context.ALARM_SERVICE)).thenReturn(alarm);
    when(alarm.canScheduleExactAlarms()).thenReturn(true);
    when(context.getSharedPreferences(anyString(), anyInt())).thenAnswer(a -> {
      Map<String, String> values = stores.computeIfAbsent(a.getArgument(0), k -> new HashMap<>());
      SharedPreferences prefs = mock(SharedPreferences.class);
      when(prefs.getString(anyString(), any())).thenAnswer(b -> values.getOrDefault(b.getArgument(0), b.getArgument(1)));
      when(prefs.edit()).thenAnswer(b -> {
        SharedPreferences.Editor ed = mock(SharedPreferences.Editor.class);
        Map<String, String> staged = new HashMap<>();
        when(ed.putString(anyString(), anyString())).thenAnswer(e -> { staged.put(e.getArgument(0), e.getArgument(1)); return ed; });
        when(ed.commit()).thenAnswer(e -> { if (commitOk) values.putAll(staged); return commitOk; });
        doAnswer(e -> { values.putAll(staged); return null; }).when(ed).apply();
        return ed;
      });
      return prefs;
    });
    intents = mockConstruction(Intent.class, withSettings().defaultAnswer(RETURNS_SELF));
    pending = mockStatic(PendingIntent.class);
    pending.when(() -> PendingIntent.getBroadcast(any(), anyInt(), any(), anyInt())).thenReturn(pi);
    pending.when(() -> PendingIntent.getActivity(any(), anyInt(), any(), anyInt())).thenReturn(mock(PendingIntent.class));
    notifications = mockStatic(NotificationManagerCompat.class);
    nm = mock(NotificationManagerCompat.class);
    notifications.when(() -> NotificationManagerCompat.from(context)).thenReturn(nm);
    when(nm.areNotificationsEnabled()).thenReturn(true);
  }
  @After public void after() throws Exception { pending.close(); notifications.close(); intents.close(); sdk(originalSdk); }

  JSObject request(int rev) throws Exception {
    return new JSObject("{\"id\":123,\"title\":\"普通\",\"body\":\"测试\",\"channelId\":\"attention-normal-v2\","
      + "\"actionTypeId\":\"attention-actions\",\"schedule\":{\"at\":\"2099-01-01T00:00:00.000Z\"},"
      + "\"extra\":{\"managedKind\":\"attention-reminder\",\"itemId\":\"test-item\",\"itemRev\":" + rev
      + ",\"reminderKey\":\"0@1000\",\"scheduleKey\":\"round-" + rev + "\"}}");
  }
  JSObject schedule() throws Exception {
    JSObject n = request(2); n.getJSONObject("extra").put("punctual_reminder", true);
    return NotificationScheduler.schedule(context, n, System.currentTimeMillis() + 120000,
      "wall-clock", "2099-01-01T00:00:00");
  }

  @Test public void ordinaryTimingUsesClockWithoutAlarmPresentationAndPersistsIdentity() throws Exception {
    JSObject r = schedule();
    assertTrue(r.getBoolean("exact")); assertEquals("alarmClockNotification", r.getString("mode"));
    verify(alarm).setAlarmClock(any(), eq(pi));
    JSONObject n = NotificationScheduler.pending(context).getJSONObject(0);
    assertEquals("attention-normal-v2", n.getString("channelId"));
    assertEquals("attention-actions", n.getString("actionTypeId"));
    assertEquals(2, n.getJSONObject("extra").getInt("itemRev"));
    assertEquals(r.getString("token"), n.getJSONObject("nativeTiming").getString("token"));
    verify(context, never()).startActivity(any()); verify(context, never()).startService(any());
  }

  @Test public void unavailableExactPermissionReturnsInexactInsteadOfSuccessClaim() throws Exception {
    when(alarm.canScheduleExactAlarms()).thenReturn(false);
    JSObject r = schedule(); assertFalse(r.getBoolean("exact")); assertFalse(r.getBoolean("systemNextAlarm"));
    verify(alarm, never()).setAlarmClock(any(), any());
    verify(alarm).setAndAllowWhileIdle(eq(AlarmManager.RTC_WAKEUP), anyLong(), eq(pi));
    assertFalse(NotificationScheduler.pending(context).getJSONObject(0).getJSONObject("nativeTiming").getBoolean("exact"));
  }

  @Test public void permissionRaceDegradesWithoutAlarmService() throws Exception {
    doThrow(new SecurityException("revoked")).when(alarm).setAlarmClock(any(), any());
    doThrow(new SecurityException("revoked")).when(alarm).setExactAndAllowWhileIdle(anyInt(), anyLong(), any());
    assertFalse(schedule().getBoolean("exact"));
    verify(alarm).setAndAllowWhileIdle(anyInt(), anyLong(), eq(pi));
    verify(context, never()).startService(any());
  }

  @Test public void persistenceFailureDoesNotDispatchAlarm() throws Exception {
    commitOk = false;
    try { schedule(); fail("expected durable storage rejection"); } catch (IllegalStateException expected) {}
    verify(alarm, never()).setAlarmClock(any(), any());
  }

  @Test public void cancellationInvalidatesAlreadyQueuedDelivery() throws Exception {
    String token = schedule().getString("token");
    NotificationScheduler.cancel(context, 123);
    try (MockedConstruction<LocalNotificationManager> renderer = mockConstruction(LocalNotificationManager.class)) {
      NotificationScheduler.deliver(context, 123, token);
      assertEquals(0, renderer.constructed().size());
      assertEquals(0, NotificationScheduler.pending(context).length());
      verify(alarm).cancel(pi);
    }
  }

  @Test public void replacementRejectsStaleTokenAndDuplicateDispatchOnlyPostsOnce() throws Exception {
    String old = schedule().getString("token");
    String current = NotificationScheduler.schedule(context, request(3), System.currentTimeMillis() + 120000,
      "wall-clock", "2099-01-01T00:00:00").getString("token");
    try (MockedStatic<CapConfig> config = mockStatic(CapConfig.class);
         MockedConstruction<LocalNotificationManager> renderer = mockConstruction(LocalNotificationManager.class,
           (mock, init) -> when(mock.schedule(isNull(), anyList())).thenReturn(new JSONArray().put(123)))) {
      NotificationScheduler.deliver(context, 123, old);
      assertEquals(0, renderer.constructed().size());
      NotificationScheduler.deliver(context, 123, current);
      NotificationScheduler.deliver(context, 123, current);
      assertEquals(1, renderer.constructed().size());
      ArgumentCaptor<List<LocalNotification>> list = ArgumentCaptor.forClass(List.class);
      verify(renderer.constructed().get(0)).schedule(isNull(), list.capture());
      LocalNotification n = list.getValue().get(0);
      assertNull(n.getSchedule()); assertEquals("attention-normal-v2", n.getChannelId());
      assertEquals(3, n.getExtra().getInt("itemRev"));
      assertEquals("0@1000", n.getExtra().getString("reminderKey"));
      verify(context, never()).startActivity(any()); verify(context, never()).startService(any());
      JSONArray evidence = DeliveryEvidenceStore.list(context);
      assertEquals("notification", evidence.getJSONObject(0).getString("carrier"));
      assertEquals(current, evidence.getJSONObject(0).getString("token"));
    }
  }

  @Test public void deniedNotificationsRejectScheduleAndBlockDispatchAfterRevocation() throws Exception {
    when(nm.areNotificationsEnabled()).thenReturn(false);
    try { schedule(); fail("must reject"); } catch (IllegalStateException expected) {}
    verify(alarm, never()).setAlarmClock(any(), any());
    when(nm.areNotificationsEnabled()).thenReturn(true);
    String token = schedule().getString("token");
    when(nm.areNotificationsEnabled()).thenReturn(false);
    try (MockedConstruction<LocalNotificationManager> renderer = mockConstruction(LocalNotificationManager.class)) {
      NotificationScheduler.deliver(context, 123, token);
      assertEquals(0, renderer.constructed().size());
      assertEquals(0, DeliveryEvidenceStore.list(context).length());
    }
  }

  @Test public void restoreRetainsFutureTokenButDropsExpiredWithoutBurst() throws Exception {
    String token = schedule().getString("token");
    NotificationScheduler.restore(context, Intent.ACTION_BOOT_COMPLETED);
    assertEquals(token, NotificationScheduler.pending(context).getJSONObject(0).getJSONObject("nativeTiming").getString("token"));
    JSONObject rows = new JSONObject(stores.get(NotificationScheduler.PREFS).get("rows"));
    rows.getJSONObject("123").put("triggerAt", 1);
    stores.get(NotificationScheduler.PREFS).put("rows", rows.toString());
    clearInvocations(alarm);
    NotificationScheduler.restore(context, Intent.ACTION_BOOT_COMPLETED);
    assertEquals(0, NotificationScheduler.pending(context).length());
    verify(alarm, never()).setAlarmClock(any(), any());
    assertTrue(stores.get(SystemBridgePlugin.PREFS_SCHEDULES).get(SystemBridgePlugin.KEY_MISSED_ALARMS).contains("0@1000"));
  }

  @Test public void restoreWithNotificationsRevokedDoesNotCreateFutureWakeupsOrClaimReady() throws Exception {
    schedule(); clearInvocations(alarm);
    when(nm.areNotificationsEnabled()).thenReturn(false);
    NotificationScheduler.restore(context, Intent.ACTION_BOOT_COMPLETED);
    verify(alarm, never()).setAlarmClock(any(), any());
    JSONObject timing = NotificationScheduler.pending(context).getJSONObject(0).getJSONObject("nativeTiming");
    assertEquals("restoreFailed", timing.getString("mode")); assertFalse(timing.getBoolean("exact"));
    when(nm.areNotificationsEnabled()).thenReturn(true);
    NotificationScheduler.restore(context, "app-start");
    assertTrue(NotificationScheduler.pending(context).getJSONObject(0).getJSONObject("nativeTiming").getBoolean("exact"));
  }

  @Test public void restoreFailureRemainsExplicitAndRetryable() throws Exception {
    schedule();
    doThrow(new IllegalStateException("alarm service failure")).when(alarm).setAlarmClock(any(), any());
    NotificationScheduler.restore(context, Intent.ACTION_BOOT_COMPLETED);
    JSONObject timing = NotificationScheduler.pending(context).getJSONObject(0).getJSONObject("nativeTiming");
    assertEquals("restoreFailed", timing.getString("mode")); assertFalse(timing.getBoolean("exact"));
  }

  @Test public void elapsedRestoreRequiresProvenSameBootAndDoesNotReanchorOnClockChange() throws Exception {
    JSONObject row = new JSONObject().put("scheduleBasis", "elapsed").put("bootId", "boot-A")
      .put("triggerAt", 9000).put("elapsedAt", 6000);
    assertEquals(13000, NotificationScheduler.restoredAt(row, Intent.ACTION_TIME_CHANGED, 10000, 3000, "boot-A"));
    assertEquals(9000, NotificationScheduler.restoredAt(row, Intent.ACTION_BOOT_COMPLETED, 10000, 3000, "boot-B"));
    assertEquals(9000, NotificationScheduler.restoredAt(row, Intent.ACTION_BOOT_COMPLETED, 10000, 3000, ""));
  }
  @Test public void rendererFailureRetainsMatchedIdentityAndDoesNotRetryDuplicateOrRestore() throws Exception {
    String token = schedule().getString("token");
    try (MockedStatic<CapConfig> config = mockStatic(CapConfig.class);
         MockedConstruction<LocalNotificationManager> renderer = mockConstruction(LocalNotificationManager.class,
           (mock, init) -> when(mock.schedule(isNull(), anyList())).thenThrow(new IllegalStateException("render failed")))) {
      try { NotificationScheduler.deliver(context, 123, token); fail("expected renderer failure"); }
      catch (IllegalStateException expected) {}
      JSONObject row = NotificationScheduler.pending(context).getJSONObject(0);
      assertEquals("failed", row.getJSONObject("nativeTiming").getString("state"));
      assertEquals(1, row.getJSONObject("nativeTiming").getInt("attempts"));
      JSONObject missed = NotificationScheduler.failedDeliveries(context).getJSONObject(0);
      assertEquals("test-item", missed.getString("itemId")); assertEquals("2", missed.getString("itemRev"));
      assertEquals("0@1000", missed.getString("reminderKey")); assertEquals(token, missed.getString("token"));
      assertEquals(0, DeliveryEvidenceStore.list(context).length());
      clearInvocations(alarm);
      NotificationScheduler.deliver(context, 123, token);
      NotificationScheduler.restore(context, "app-start");
      assertEquals(1, renderer.constructed().size());
      verify(alarm, never()).setAlarmClock(any(), any());
      SystemBridgePlugin bridge = new SystemBridgePlugin() { @Override public Context getContext() { return context; } };
      com.getcapacitor.PluginCall call = mock(com.getcapacitor.PluginCall.class);
      bridge.getMissedAlarms(call);
      ArgumentCaptor<JSObject> result = ArgumentCaptor.forClass(JSObject.class);
      verify(call).resolve(result.capture());
      assertEquals(token, result.getValue().getJSONArray("missed").getJSONObject(0).getString("token"));
      NotificationScheduler.cancel(context, 123);
      assertEquals(0, NotificationScheduler.pending(context).length());
      assertEquals(0, NotificationScheduler.failedDeliveries(context).length());
      NotificationScheduler.deliver(context, 123, token);
      assertEquals(1, renderer.constructed().size());
    }
  }

  @Test public void cancellationDuringRendererFailureCannotResurrectTheOldRow() throws Exception {
    String token = schedule().getString("token");
    try (MockedStatic<CapConfig> config = mockStatic(CapConfig.class);
         MockedConstruction<LocalNotificationManager> renderer = mockConstruction(LocalNotificationManager.class,
           (mock, init) -> when(mock.schedule(isNull(), anyList())).thenAnswer(args -> {
             NotificationScheduler.cancel(context, 123);
             throw new IllegalStateException("failed after cancellation");
           }))) {
      try { NotificationScheduler.deliver(context, 123, token); fail("expected renderer failure"); }
      catch (IllegalStateException expected) {}
      assertEquals(0, NotificationScheduler.pending(context).length());
      assertEquals(0, NotificationScheduler.failedDeliveries(context).length());
      NotificationScheduler.deliver(context, 123, token);
      assertEquals(1, renderer.constructed().size());
    }
  }

  @Test public void replacementDuringRendererFailureKeepsOnlyTheNewRevisionAndToken() throws Exception {
    String old = schedule().getString("token");
    try (MockedStatic<CapConfig> config = mockStatic(CapConfig.class);
         MockedConstruction<LocalNotificationManager> renderer = mockConstruction(LocalNotificationManager.class,
           (mock, init) -> when(mock.schedule(isNull(), anyList())).thenAnswer(args -> {
             NotificationScheduler.schedule(context, request(3), System.currentTimeMillis() + 120000,
               "wall-clock", "2099-01-01T00:00:00");
             throw new IllegalStateException("failed after replacement");
           }))) {
      try { NotificationScheduler.deliver(context, 123, old); fail("expected renderer failure"); }
      catch (IllegalStateException expected) {}
      JSONObject row = NotificationScheduler.pending(context).getJSONObject(0);
      assertEquals(3, row.getJSONObject("extra").getInt("itemRev"));
      assertNotEquals(old, row.getJSONObject("nativeTiming").getString("token"));
      assertEquals("pending", row.getJSONObject("nativeTiming").getString("state"));
      assertEquals(0, NotificationScheduler.failedDeliveries(context).length());
      NotificationScheduler.deliver(context, 123, old);
      assertEquals(1, renderer.constructed().size());
    }
  }

  @Test public void interruptedClaimIsDiagnosticUnknownAndNeverBlindlyRetried() throws Exception {
    String token = schedule().getString("token");
    JSONObject rows = new JSONObject(stores.get(NotificationScheduler.PREFS).get("rows"));
    rows.getJSONObject("123").put("state", "delivering").put("attempts", 1);
    stores.get(NotificationScheduler.PREFS).put("rows", rows.toString());
    clearInvocations(alarm);
    try (MockedConstruction<LocalNotificationManager> renderer = mockConstruction(LocalNotificationManager.class)) {
      NotificationScheduler.deliver(context, 123, token);
      NotificationScheduler.restore(context, "app-start");
      assertEquals(0, renderer.constructed().size());
      verify(alarm, never()).setAlarmClock(any(), any());
      assertEquals("delivering", NotificationScheduler.pending(context).getJSONObject(0).getJSONObject("nativeTiming").getString("state"));
      assertEquals(0, NotificationScheduler.failedDeliveries(context).length());
    }
  }

  @Test public void ordinaryReceivedReceiptIsReleasedOnlyAfterSuccessfulPublication() throws Exception {
    String token = schedule().getString("token");
    java.util.List<JSObject> receipts = new java.util.ArrayList<>();
    try (MockedStatic<CapConfig> config = mockStatic(CapConfig.class);
         MockedStatic<LocalNotificationsPlugin> callbacks = mockStatic(LocalNotificationsPlugin.class);
         MockedConstruction<LocalNotificationManager> renderer = mockConstruction(LocalNotificationManager.class,
           (mock, init) -> when(mock.schedule(isNull(), anyList())).thenAnswer(args -> {
             List<LocalNotification> ns = args.getArgument(1);
             LocalNotificationsPlugin.fireReceived(new JSObject(ns.get(0).getSource()));
             return new JSONArray().put(123);
           }))) {
      callbacks.when(() -> LocalNotificationsPlugin.fireReceived(any())).thenAnswer(args -> { receipts.add(args.getArgument(0)); return null; });
      NotificationScheduler.deliver(context, 123, token);
      assertEquals(2, receipts.size());
      assertTrue(receipts.get(0).getJSONObject("extra").getBoolean("nativeReceiptPending"));
      assertFalse(receipts.get(1).getJSONObject("extra").optBoolean("nativeReceiptPending"));
      assertEquals(1, DeliveryEvidenceStore.list(context).length());
    }
  }

  @Test public void failedPublicationNeverEmitsAnUnmarkedSuccessReceipt() throws Exception {
    String token = schedule().getString("token");
    java.util.List<JSObject> receipts = new java.util.ArrayList<>();
    try (MockedStatic<CapConfig> config = mockStatic(CapConfig.class);
         MockedStatic<LocalNotificationsPlugin> callbacks = mockStatic(LocalNotificationsPlugin.class);
         MockedConstruction<LocalNotificationManager> renderer = mockConstruction(LocalNotificationManager.class,
           (mock, init) -> when(mock.schedule(isNull(), anyList())).thenAnswer(args -> {
             List<LocalNotification> ns = args.getArgument(1);
             LocalNotificationsPlugin.fireReceived(new JSObject(ns.get(0).getSource()));
             throw new IllegalStateException("notify failed after early callback");
           }))) {
      callbacks.when(() -> LocalNotificationsPlugin.fireReceived(any())).thenAnswer(args -> { receipts.add(args.getArgument(0)); return null; });
      try { NotificationScheduler.deliver(context, 123, token); fail("expected renderer failure"); }
      catch (IllegalStateException expected) {}
      assertEquals(1, receipts.size());
      assertTrue(receipts.get(0).getJSONObject("extra").getBoolean("nativeReceiptPending"));
      assertEquals(0, DeliveryEvidenceStore.list(context).length());
      assertEquals(1, NotificationScheduler.failedDeliveries(context).length());
    }
  }

  @Test public void missingFalseAndStringFlagsAlwaysUseStandardExactWithoutNextAlarm() throws Exception {
    for (Object flag : new Object[] { null, false, "true", 1 }) {
      JSObject n = request(2); if (flag != null) n.getJSONObject("extra").put("punctual_reminder", flag);
      JSObject r = NotificationScheduler.schedule(context,n,System.currentTimeMillis()+120000,"wall-clock","");
      assertTrue(r.getBoolean("exact")); assertEquals("exactNotification",r.getString("mode"));
      assertFalse(r.getBoolean("systemNextAlarm"));
      assertFalse(NotificationScheduler.pending(context).getJSONObject(0).getJSONObject("nativeTiming").getBoolean("systemNextAlarm"));
    }
    verify(alarm,never()).setAlarmClock(any(),any());
    verify(alarm,times(4)).setExactAndAllowWhileIdle(eq(AlarmManager.RTC_WAKEUP),anyLong(),eq(pi));
  }

  @Test public void punctualGrantRestorePromotesFallbackAndRevocationReturnsInexact() throws Exception {
    when(alarm.canScheduleExactAlarms()).thenReturn(false);
    JSObject first = schedule();
    assertEquals("inexactNotification", first.getString("mode"));
    assertFalse(first.getBoolean("systemNextAlarm"));
    when(alarm.canScheduleExactAlarms()).thenReturn(true);
    try (MockedStatic<SystemBridgePlugin> bridge = mockStatic(SystemBridgePlugin.class)) {
      ExactAlarmPermissionReceiver.restoreGrantedSchedules(context);
      bridge.verify(() -> SystemBridgePlugin.restorePersistedAlarms(context));
    }
    JSONObject restored = NotificationScheduler.pending(context).getJSONObject(0).getJSONObject("nativeTiming");
    assertEquals("alarmClockNotification", restored.getString("mode"));
    assertTrue(restored.getBoolean("systemNextAlarm"));
    when(alarm.canScheduleExactAlarms()).thenReturn(false);
    NotificationScheduler.restore(context, "permission-revoked-resume");
    JSONObject revoked = NotificationScheduler.pending(context).getJSONObject(0).getJSONObject("nativeTiming");
    assertEquals("inexactNotification", revoked.getString("mode"));
    assertFalse(revoked.getBoolean("systemNextAlarm"));
  }

  @Test public void reviewPayloadTrueIsForcedStandardEvenAcrossRestore() throws Exception {
    JSObject n=request(2);n.getJSONObject("extra").put("managedKind","review-session").put("punctual_reminder",true);
    JSObject r=NotificationScheduler.schedule(context,n,System.currentTimeMillis()+120000,"wall-clock","");
    assertEquals("exactNotification",r.getString("mode"));assertFalse(r.getBoolean("systemNextAlarm"));
    NotificationScheduler.restore(context,"app-start");
    verify(alarm,never()).setAlarmClock(any(),any());
    assertEquals("exactNotification",NotificationScheduler.pending(context).getJSONObject(0).getJSONObject("nativeTiming").getString("mode"));
  }

  @Test public void standardElapsedUsesMonotonicClockAndPermissionFallbackIsExplicit() throws Exception {
    JSObject n=request(2);
    NotificationScheduler.schedule(context,n,System.currentTimeMillis()+120000,"elapsed","");
    verify(alarm).setExactAndAllowWhileIdle(eq(AlarmManager.ELAPSED_REALTIME_WAKEUP),anyLong(),eq(pi));
    when(alarm.canScheduleExactAlarms()).thenReturn(false);
    JSObject r=NotificationScheduler.schedule(context,n,System.currentTimeMillis()+120000,"elapsed","");
    assertEquals("inexactNotification",r.getString("mode"));assertFalse(r.getBoolean("systemNextAlarm"));
    verify(alarm).setAndAllowWhileIdle(eq(AlarmManager.ELAPSED_REALTIME_WAKEUP),anyLong(),eq(pi));
  }

  @Test public void onOffReplacementAndRestoreUsePersistedChoiceNotOldExactness() throws Exception {
    JSObject on=schedule();assertTrue(on.getBoolean("systemNextAlarm"));
    JSObject off=NotificationScheduler.schedule(context,request(2),System.currentTimeMillis()+120000,"wall-clock","");
    assertEquals("exactNotification",off.getString("mode"));assertFalse(off.getBoolean("systemNextAlarm"));
    clearInvocations(alarm);NotificationScheduler.restore(context,"app-start");
    verify(alarm,never()).setAlarmClock(any(),any());verify(alarm).setExactAndAllowWhileIdle(anyInt(),anyLong(),eq(pi));
    JSObject n=request(3);n.getJSONObject("extra").put("punctual_reminder",true);
    NotificationScheduler.schedule(context,n,System.currentTimeMillis()+120000,"wall-clock","");
    clearInvocations(alarm);NotificationScheduler.restore(context,"app-start");verify(alarm).setAlarmClock(any(),eq(pi));
  }

  @Test public void rejectedSameIdReconfigurationPreservesAcceptedWakeup() throws Exception {
    JSObject first=schedule();String old=first.getString("token");
    doThrow(new IllegalStateException("standard install failed")).when(alarm).setExactAndAllowWhileIdle(anyInt(),anyLong(),any());
    try {NotificationScheduler.schedule(context,request(2),System.currentTimeMillis()+120000,"wall-clock","");fail("reject");}
    catch(IllegalStateException expected) {}
    JSONObject n=NotificationScheduler.pending(context).getJSONObject(0);
    assertEquals(old,n.getJSONObject("nativeTiming").getString("token"));
    assertEquals("alarmClockNotification",n.getJSONObject("nativeTiming").getString("mode"));
    verify(alarm,never()).cancel(any(PendingIntent.class));
  }

}
