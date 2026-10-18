package space.alliswell.inbox;

import static org.junit.Assert.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.junit.Test;

/** Production plugin/parser/receiver; Intent, Activity and preferences are JVM seams. */
public class CaptureIntentTest {
  private Intent intent(String action, String text, String type) {
    Intent i = mock(Intent.class);
    Map<String,Boolean> flags = new HashMap<>();
    when(i.getAction()).thenReturn(action); when(i.getType()).thenReturn(type);
    when(i.getCharSequenceExtra(Intent.EXTRA_TEXT)).thenReturn(text);
    when(i.getStringExtra(Intent.EXTRA_SUBJECT)).thenReturn("来源标题");
    when(i.getBooleanExtra(anyString(), anyBoolean())).thenAnswer(a -> flags.getOrDefault(a.getArgument(0), a.getArgument(1)));
    when(i.putExtra(anyString(), anyBoolean())).thenAnswer(a -> { flags.put(a.getArgument(0), a.getArgument(1)); return i; });
    return i;
  }
  @Test public void textUrlConsumedOnceAndInvalidPayloads() throws Exception {
    Intent i = intent(Intent.ACTION_SEND,"中文 <script>alert(1)</script> https://example.test/路径","text/plain");
    JSObject r = CaptureIntentPlugin.readRequest(i,123L);
    assertTrue(r.getString("text").contains("<script>"));
    assertEquals("来源标题",r.getString("sourceTitle")); assertEquals(123L,r.getLong("createdAt"));
    assertNull(CaptureIntentPlugin.readRequest(i,124L));
    assertNull(CaptureIntentPlugin.readRequest(intent(Intent.ACTION_SEND,"x","image/png"),0));
    assertNull(CaptureIntentPlugin.readRequest(intent(Intent.ACTION_VIEW,"x","text/plain"),0));
    assertNotNull(CaptureIntentPlugin.readRequest(intent(Intent.ACTION_SEND,null,"text/plain"),0).getString("error"));
    assertNotNull(CaptureIntentPlugin.readRequest(intent(Intent.ACTION_SEND,new String(new char[65537]),"text/plain"),0).getString("error"));
    assertEquals(65536,CaptureIntentPlugin.readRequest(intent(Intent.ACTION_SEND,new String(new char[65536]),"text/plain"),0).getString("text").length());
    assertEquals("",CaptureIntentPlugin.readRequest(intent("space.alliswell.inbox.CAPTURE",null,null),0).getString("text"));
  }
  @Test public void coldLoadHotIntentQueuedBeforeBridgeDrain() throws Exception {
    CaptureIntentPlugin p = spy(new CaptureIntentPlugin()); MainActivity activity = mock(MainActivity.class);
    Intent cold = intent(Intent.ACTION_SEND,"冷启动中文","text/plain"); when(activity.getIntent()).thenReturn(cold);
    doReturn(activity).when(p).getActivity(); p.load();
    p.handleOnNewIntent(intent(Intent.ACTION_SEND,"热启动 https://example.test","text/plain")); p.handleOnNewIntent(cold);
    PluginCall call = mock(PluginCall.class); p.takeCaptureRequests(call);
    org.mockito.ArgumentCaptor<JSObject> result = org.mockito.ArgumentCaptor.forClass(JSObject.class);
    verify(call).resolve(result.capture()); JSONArray requests = result.getValue().getJSONArray("requests");
    assertEquals(2,requests.length()); assertEquals("冷启动中文",requests.getJSONObject(0).getString("text"));
    assertTrue(requests.getJSONObject(1).getString("text").contains("https://"));
    PluginCall empty = mock(PluginCall.class);p.takeCaptureRequests(empty);
    verify(empty).resolve(result.capture());assertEquals(0,result.getValue().getJSONArray("requests").length());
  }
  @Test public void receiverEarlyFailureIsTraceBoundWithoutVisibleDeliveryClaim() throws Exception {
    Context c = mock(Context.class); SharedPreferences prefs = ReminderSettingsTest.prefs();
    when(c.getSharedPreferences(anyString(),anyInt())).thenReturn(prefs);
    when(c.getSystemService(Context.POWER_SERVICE)).thenThrow(new IllegalStateException("injected"));
    Intent i = intent("space.alliswell.inbox.ACTION_TEST_ALARM","","text/plain");
    when(i.getStringExtra(AlarmTrace.EXTRA)).thenReturn("rf-trace");
    when(i.getStringExtra(AlarmTestReceiver.EXTRA_ITEM_ID)).thenReturn("rf-item");
    when(i.getStringExtra(AlarmTestReceiver.EXTRA_ITEM_REV)).thenReturn("7");
    when(i.getStringExtra(AlarmTestReceiver.EXTRA_REMINDER_KEY)).thenReturn("0@123");
    when(i.getLongExtra(AlarmTestReceiver.EXTRA_PLANNED_AT,0L)).thenReturn(123L);
    new AlarmTestReceiver().onReceive(c,i); JSONArray events = AlarmTrace.read(c);
    assertEquals(4,events.length()); assertEquals("received",events.getJSONObject(0).getString("stage"));
    assertEquals("receiverIdentity",events.getJSONObject(1).getString("stage"));
    assertTrue(events.getJSONObject(1).getString("detail").contains("rev=7;key=0@123;plannedAt=123"));
    assertEquals("deliveryEvidenceRecorded",events.getJSONObject(2).getString("stage"));
    assertEquals("receiverFailed",events.getJSONObject(3).getString("stage"));
    for(int n=0;n<events.length();n++) assertEquals("rf-trace",events.getJSONObject(n).getString("token"));
  }
}
