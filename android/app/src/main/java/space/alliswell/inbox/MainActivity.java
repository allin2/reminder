package space.alliswell.inbox;

import android.os.Bundle;
import android.content.Intent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(SecureKeyPlugin.class);
    registerPlugin(SystemBridgePlugin.class);
    registerPlugin(AppSettingsPlugin.class);
    registerPlugin(CaptureIntentPlugin.class);
    super.onCreate(savedInstanceState);
  }
  @Override
  protected void onNewIntent(Intent intent) {
    setIntent(intent);
    super.onNewIntent(intent);
  }
}
