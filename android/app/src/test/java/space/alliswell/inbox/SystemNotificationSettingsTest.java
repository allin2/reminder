package space.alliswell.inbox;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.mockito.MockedConstruction;

public class SystemNotificationSettingsTest {
  private final Context context = mock(Context.class);
  private final SystemBridgePlugin plugin = new SystemBridgePlugin() {
    @Override public Context getContext() { return context; }
  };
  private int originalSdk;

  private void sdk(int value) throws Exception {
    // Same mockable-android.jar seam as ProductionJavaAlarmTest; run with -Xint.
    Class<?> unsafeClass = Class.forName("sun.misc.Unsafe");
    Field field = unsafeClass.getDeclaredField("theUnsafe");
    field.setAccessible(true);
    Object unsafe = field.get(null);
    Field target = Build.VERSION.class.getDeclaredField("SDK_INT");
    Object base = unsafeClass.getMethod("staticFieldBase", Field.class).invoke(unsafe, target);
    long offset = (Long) unsafeClass.getMethod("staticFieldOffset", Field.class).invoke(unsafe, target);
    unsafeClass.getMethod("putInt", Object.class, long.class, int.class).invoke(unsafe, base, offset, value);
  }

  @Before public void before() throws Exception {
    originalSdk = Build.VERSION.SDK_INT;
    sdk(36);
    when(context.getPackageName()).thenReturn("space.alliswell.inbox");
  }
  @After public void after() throws Exception { sdk(originalSdk); }

  @Test public void channelSettingTargetsTheRequestedReminderCategory() {
    PluginCall call = mock(PluginCall.class);
    when(call.getString("channelId")).thenReturn("attention-normal-v2");
    try (MockedConstruction<Intent> intents = mockConstruction(Intent.class)) {
      plugin.openNotificationSettings(call);
      Intent intent = intents.constructed().get(0);
      verify(intent).setAction(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
      verify(intent).putExtra(Settings.EXTRA_CHANNEL_ID, "attention-normal-v2");
      verify(intent).putExtra(Settings.EXTRA_APP_PACKAGE, "space.alliswell.inbox");
      verify(context).startActivity(intent);
      verify(call).resolve();
    }
  }

  @Test public void existingAppSettingsEntryStillOpensTheAppNotificationPage() {
    PluginCall call = mock(PluginCall.class);
    try (MockedConstruction<Intent> intents = mockConstruction(Intent.class)) {
      plugin.openNotificationSettings(call);
      verify(intents.constructed().get(0)).setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
      verify(call).resolve();
    }
  }

  @Test public void unknownChannelDoesNotLaunchSettings() {
    PluginCall call = mock(PluginCall.class);
    when(call.getString("channelId")).thenReturn("unrelated-channel");
    plugin.openNotificationSettings(call);
    verify(context, never()).startActivity(any(Intent.class));
    verify(call).reject("未知提醒渠道");
  }

  @Test public void channelReadbackDistinguishesDisabledMissingAndUnreadable() throws Exception {
    Method read = SystemBridgePlugin.class.getDeclaredMethod("channelImportance", String.class);
    read.setAccessible(true);
    NotificationManager manager = mock(NotificationManager.class);
    when(context.getSystemService(Context.NOTIFICATION_SERVICE)).thenReturn(manager);
    assertEquals(-2, read.invoke(plugin, "attention-normal-v2"));
    NotificationChannel channel = mock(NotificationChannel.class);
    when(manager.getNotificationChannel("attention-normal-v2")).thenReturn(channel);
    when(channel.getImportance()).thenReturn(0);
    assertEquals(0, read.invoke(plugin, "attention-normal-v2"));
    when(channel.getImportance()).thenReturn(4);
    assertEquals(4, read.invoke(plugin, "attention-normal-v2"));
    when(manager.getNotificationChannel("attention-normal-v2")).thenThrow(new SecurityException());
    assertEquals(-1, read.invoke(plugin, "attention-normal-v2"));
    sdk(25);
    assertEquals(-1, read.invoke(plugin, "attention-normal-v2"));
  }
}
