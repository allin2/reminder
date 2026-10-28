package space.alliswell.inbox;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.*;

import androidx.activity.OnBackPressedDispatcher;
import androidx.arch.core.executor.ArchTaskExecutor;
import androidx.arch.core.executor.TaskExecutor;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.LifecycleRegistry;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/** 测试真实注册方法与 AndroidX Dispatcher；不模拟系统手势或实际音频设备。 */
public class AlarmBackNavigationTest {
  private AlarmActivity activity;
  private OnBackPressedDispatcher dispatcher;
  private LifecycleRegistry lifecycle;

  @Before public void setUp() {
    ArchTaskExecutor.getInstance().setDelegate(new TaskExecutor() {
      @Override public void executeOnDiskIO(Runnable r) { r.run(); }
      @Override public void postToMainThread(Runnable r) { r.run(); }
      @Override public boolean isMainThread() { return true; }
    });
    activity = mock(AlarmActivity.class);
    dispatcher = new OnBackPressedDispatcher();
    lifecycle = new LifecycleRegistry(activity);
    when(activity.getLifecycle()).thenReturn(lifecycle);
    when(activity.getOnBackPressedDispatcher()).thenReturn(dispatcher);
    doCallRealMethod().when(activity).registerBackHandler();
    lifecycle.handleLifecycleEvent(Lifecycle.Event.ON_CREATE);
    activity.registerBackHandler();
  }

  @After public void tearDown() {
    lifecycle.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY);
    ArchTaskExecutor.getInstance().setDelegate(null);
  }

  @Test public void committedBackClosesWithoutAckOrReschedule() {
    lifecycle.handleLifecycleEvent(Lifecycle.Event.ON_START);
    assertTrue(dispatcher.hasEnabledCallbacks());
    dispatcher.onBackPressed();
    verify(activity).finishWithAction("close", false);
    verify(activity, never()).finishWithAction("ack", false);
    verify(activity, never()).finishWithAction("snooze", true);
  }

  @Test public void committedBackStopsServiceAndLocalEffectsAndFinishes() throws Exception {
    android.content.Intent intent = mock(android.content.Intent.class);
    when(activity.getIntent()).thenReturn(intent);
    when(intent.getStringExtra(AlarmTrace.EXTRA)).thenReturn("delivery-B");
    when(intent.getStringExtra(AlarmActivity.EXTRA_ITEM_ID)).thenReturn("item-B");
    android.media.MediaPlayer player = mock(android.media.MediaPlayer.class);
    when(player.isPlaying()).thenReturn(true);
    android.os.Vibrator vibrator = mock(android.os.Vibrator.class);
    setField("handler", mock(android.os.Handler.class));
    setField("mediaPlayer", player);
    setField("vibrator", vibrator);
    setField("currentAlarmId", 90002);
    setField("currentItemRev", "7");
    doCallRealMethod().when(activity).finishWithAction(anyString(), anyBoolean());
    try (org.mockito.MockedStatic<AlarmRingService> ring = mockStatic(AlarmRingService.class);
         org.mockito.MockedStatic<ActiveAlarmStore> store = mockStatic(ActiveAlarmStore.class);
         org.mockito.MockedStatic<SystemBridgePlugin> bridge = mockStatic(SystemBridgePlugin.class);
         org.mockito.MockedStatic<AlarmTrace> trace = mockStatic(AlarmTrace.class)) {
      lifecycle.handleLifecycleEvent(Lifecycle.Event.ON_START);
      dispatcher.onBackPressed();
      ring.verify(() -> AlarmRingService.requestStop(activity, 90002, "delivery-B"));
      verify(player).stop();
      verify(player).release();
      verify(vibrator).cancel();
      store.verify(() -> ActiveAlarmStore.stop(activity, 90002, "delivery-B"));
      bridge.verify(() -> SystemBridgePlugin.enqueueAlarmAction(activity, "close", "item-B", "7"));
      bridge.verifyNoMoreInteractions();
      verify(activity).finish();
    }
  }

  private void setField(String name, Object value) throws Exception {
    java.lang.reflect.Field field = AlarmActivity.class.getDeclaredField(name);
    field.setAccessible(true);
    field.set(activity, value);
  }

  @Test public void cancelledPredictiveGestureDoesNotClose() {
    lifecycle.handleLifecycleEvent(Lifecycle.Event.ON_START);
    dispatcher.dispatchOnBackStarted(new androidx.activity.BackEventCompat(0f, 0f, 0f, 0));
    dispatcher.dispatchOnBackProgressed(new androidx.activity.BackEventCompat(10f, 0f, 0.5f, 0));
    dispatcher.dispatchOnBackCancelled();
    verify(activity, never()).finishWithAction(anyString(), anyBoolean());
  }

  @Test public void callbackOnlyHandlesBackWhileStarted() {
    assertFalse(dispatcher.hasEnabledCallbacks());
    lifecycle.handleLifecycleEvent(Lifecycle.Event.ON_START);
    assertTrue(dispatcher.hasEnabledCallbacks());
    lifecycle.handleLifecycleEvent(Lifecycle.Event.ON_STOP);
    assertFalse(dispatcher.hasEnabledCallbacks());
    dispatcher.onBackPressed();
    verify(activity, never()).finishWithAction(anyString(), anyBoolean());
    lifecycle.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY);
    assertFalse(dispatcher.hasEnabledCallbacks());
  }
}
