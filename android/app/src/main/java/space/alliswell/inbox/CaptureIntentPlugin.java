package space.alliswell.inbox;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayDeque;
import java.util.UUID;

/** Text-only inbox. Never resolves URIs, reads streams, or evaluates shared content. */
@CapacitorPlugin(name = "CaptureIntent")
public class CaptureIntentPlugin extends Plugin {
  static final int MAX_TEXT = 65536;
  private static final String CONSUMED = "space.alliswell.inbox.CAPTURE_CONSUMED";
  private final ArrayDeque<JSObject> pending = new ArrayDeque<>();
  private boolean pendingOverflow = false;

  @Override public void load() { enqueue(getActivity().getIntent()); }
  @Override protected void handleOnNewIntent(Intent intent) { enqueue(intent); }

  private synchronized void enqueue(Intent intent) {
    JSObject request;
    try {
      request = readRequest(intent, System.currentTimeMillis());
      if (request == null) return;
      Uri referrer = getActivity().getReferrer();
      if (referrer != null) request.put("sourceApp", referrer.toString());
    } catch (RuntimeException error) {
      request = new JSObject();
      request.put("id", UUID.randomUUID().toString());
      request.put("error", "无法读取这次分享 · 请重新分享纯文本");
    }
    if (pending.size() >= 16) {
      // Retain earlier requests; report overflow instead of silently replacing a draft.
      pendingOverflow = true;
      JSObject error = new JSObject();
      error.put("error", "待处理分享较多 · 请处理后重新分享");
      notifyListeners("captureAvailable", error);
      return;
    }
    pending.addLast(request);
    notifyListeners("captureAvailable", new JSObject());
  }

  static JSObject readRequest(Intent intent, long now) {
    if (intent == null || intent.getBooleanExtra(CONSUMED, false)) return null;
    boolean share = Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType());
    boolean shortcut = "space.alliswell.inbox.CAPTURE".equals(intent.getAction());
    if (!share && !shortcut) return null;
    intent.putExtra(CONSUMED, true);
    JSObject request = new JSObject();
    request.put("id", UUID.randomUUID().toString());
    request.put("createdAt", now);
    if (share) {
      CharSequence body = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
      String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
      if (body == null || body.length() == 0) { request.put("error", "分享中没有可接收的文本"); return request; }
      if (body.length() > MAX_TEXT || (subject != null && subject.length() > MAX_TEXT)) {
        request.put("error", "分享内容过长 · 请缩短后重试"); return request;
      }
      request.put("text", body.toString());
      request.put("sourceTitle", subject == null ? "" : subject);
    } else request.put("text", "");
    return request;
  }

  @PluginMethod public synchronized void takeCaptureRequests(PluginCall call) {
    JSArray requests = new JSArray();
    while (!pending.isEmpty()) requests.put(pending.removeFirst());
    if (pendingOverflow) {
      JSObject error = new JSObject();
      error.put("id", UUID.randomUUID().toString());
      error.put("error", "待处理分享较多 · 请处理后重新分享");
      requests.put(error);
      pendingOverflow = false;
    }
    JSObject result = new JSObject();
    result.put("requests", requests);
    call.resolve(result);
  }
}
