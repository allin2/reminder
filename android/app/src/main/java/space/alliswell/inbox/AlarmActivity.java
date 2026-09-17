package space.alliswell.inbox;

import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 全屏闹钟（D9/D11/D12）：四出口 —— 我知道了 / 稍后 2 小时 / 完成 / 关闭。
 * 「关闭」只止响、不写 ACK、不停后续补充提醒。
 *
 * R2：launchMode=singleInstance 时，第二条闹钟会通过 onNewIntent 送达。
 * 此前只有 onCreate 读取 Intent，B 到达时界面与按钮仍指向 A —— 可能漏掉 B，
 * 或对错误的事项执行确认/完成。现在统一由 bindIntent() 绑定「当前 Intent」，
 * 并在 onNewIntent 里重新绑定 + 重新起响。
 *
 * R8：四个出口都会撤掉这条闹钟已投递的通知，避免事后点残留通知再次响铃。
 */
public class AlarmActivity extends AppCompatActivity {
  public static final String EXTRA_TITLE = "alarmTitle";
  public static final String EXTRA_BODY = "alarmBody";
  public static final String EXTRA_ID = "alarmId";
  public static final String EXTRA_ITEM_ID = "alarmItemId";
  public static final String EXTRA_LEVEL = "alarmLevel";
  /** L04：投递时的事项数据版本，用于丢弃「已被改写的旧通知」 */
  public static final String EXTRA_ITEM_REV = "alarmItemRev";
  public static final String PREFS = "attention_alarm";
  /** 兼容旧版单槽位字段；新写入一律走 SystemBridgePlugin 的动作队列 */
  public static final String KEY_ACTION = "lastAction";
  public static final String KEY_ITEM_ID = "lastItemId";
  public static final String KEY_ACTIONS = "pendingActions";

  private MediaPlayer mediaPlayer;
  private Vibrator vibrator;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private Runnable clockTicker;

  /** 当前 Intent 绑定的数据（R2：随 onNewIntent 更新） */
  private String currentTitle = "";
  private String currentBody = "";
  private String currentLevel = "";
  private String currentItemRev = "0";
  private int currentAlarmId = 90002;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (Build.VERSION.SDK_INT >= 27) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
    }
    if (Build.VERSION.SDK_INT >= 26) {
      KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
      if (km != null) {
        try { km.requestDismissKeyguard(this, null); } catch (Exception ignored) {}
      }
    }
    getWindow().addFlags(
      WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
    );

    setContentView(R.layout.activity_alarm);

    Button ack = findViewById(R.id.btnAck);
    Button snooze = findViewById(R.id.btnSnooze);
    Button done = findViewById(R.id.btnDone);
    Button dismiss = findViewById(R.id.btnDismiss);

    // 闭包只引用实例字段，重绑后自然指向「当前展示的事项」
    ack.setOnClickListener(v -> finishWithAction("ack", false));
    snooze.setOnClickListener(v -> finishWithAction("snooze", true));
    done.setOnClickListener(v -> finishWithAction("done", false));
    dismiss.setOnClickListener(v -> finishWithAction("close", false));

    bindIntent();
    // V01：首次创建同样必须起响（此前只有 onNewIntent 会启动效果）
    restartAlarmEffects();
  }

  /**
   * R2：A 仍在响时 B 到达（或点击 B 的通知复用本窗口）→ 切换到 B。
   *
   * 多闹钟保留策略：界面只展示「最新到达」的那一条（否则界面无法表示两组按钮），
   * A 不会因此丢失 —— 它仍是应用里一条已到期的 due 事项，通知也仍在通知栏，
   * 用户处理完 B 之后仍可在首页对 A 执行确认/完成。
   */
  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    stopAlarmEffects();
    bindIntent();
    restartAlarmEffects();
  }

  private void bindIntent() {
    Intent intent = getIntent();
    String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
    String body = intent != null ? intent.getStringExtra(EXTRA_BODY) : null;
    String level = intent != null ? intent.getStringExtra(EXTRA_LEVEL) : null;
    String itemId = intent != null ? intent.getStringExtra(EXTRA_ITEM_ID) : "";
    // V02：整条链路统一用 String 承载数据版本（Intent 的 typed getter 必须与实际类型匹配，
    // 用 getIntExtra 读一个 String extra 只会拿到默认值 0，导致旧版本校验把有效动作全部拒绝）
    String itemRev = intent != null ? intent.getStringExtra(EXTRA_ITEM_REV) : null;
    if (itemId == null) itemId = "";
    if (itemRev == null || itemRev.isEmpty()) itemRev = "0";
    if (title == null || title.isEmpty()) title = "安心收件箱";
    if (body == null || body.isEmpty()) body = "有一条事项需要你确认";
    currentTitle = title;
    currentBody = body;
    currentLevel = level == null ? "" : level;
    currentItemRev = itemRev == null ? "0" : itemRev;
    currentAlarmId = intent != null ? intent.getIntExtra(EXTRA_ID, 90002) : 90002;

    TextView titleView = findViewById(R.id.alarmTitle);
    TextView bodyView = findViewById(R.id.alarmBody);
    TextView levelView = findViewById(R.id.alarmLevel);
    if (titleView != null) titleView.setText(currentTitle);
    if (bodyView != null) bodyView.setText(currentBody);
    if (levelView != null && !currentLevel.isEmpty()) levelView.setText(currentLevel);

    TextView clockView = findViewById(R.id.alarmClockText);
    if (clockView != null) {
      SimpleDateFormat fmt = new SimpleDateFormat("HH:mm", Locale.getDefault());
      clockView.setText(fmt.format(new Date()));
      if (clockTicker != null) handler.removeCallbacks(clockTicker);
      clockTicker = new Runnable() {
        @Override
        public void run() {
          TextView v = findViewById(R.id.alarmClockText);
          if (v != null) v.setText(new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date()));
          handler.postDelayed(this, 1000L);
        }
      };
      handler.post(clockTicker);
    }
  }

  private void restartAlarmEffects() {
    startAlarmSound();
    startVibration();
  }

  private void finishWithAction(String action, boolean reschedule) {
    stopAlarmEffects();
    if (reschedule) {
      try {
        long delay = 2 * 60 * 60 * 1000L; // D11：快捷稍后固定 2 小时
        long triggerAt = System.currentTimeMillis() + delay;
        String itemIdForReschedule = currentItemId();
        String itemRevForReschedule = currentItemRev == null ? "0" : currentItemRev;
        AlarmScheduler.schedule(this, triggerAt, currentTitle, currentBody,
          currentAlarmId, itemIdForReschedule, currentLevel, itemRevForReschedule);
        // P0-2：自行重排的闹钟也要入账，否则下一轮对账撤不掉它（会变成幽灵闹钟 / 重复响）
        SystemBridgePlugin.persistAlarm(this, currentAlarmId, triggerAt, currentTitle, currentBody,
          itemIdForReschedule, currentLevel, itemRevForReschedule);
      } catch (Exception ignored) {}
    }
    // R8：四条出口都清掉已投递的通知，避免事后点残留通知再次进入全屏并响铃
    cancelPostedNotification();
    SystemBridgePlugin.enqueueAlarmAction(this, action, currentItemId(), currentItemRev);
    // 回到 WebView 让 JS 处理 ACK/完成
    try {
      Intent main = getPackageManager().getLaunchIntentForPackage(getPackageName());
      if (main != null) {
        main.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        main.putExtra("alarmAction", action);
        main.putExtra("alarmItemId", currentItemId());
        if (currentItemRev != null) main.putExtra("alarmItemRev", currentItemRev);
        startActivity(main);
      }
    } catch (Exception ignored) {}
    finish();
  }

  private String currentItemId() {
    Intent intent = getIntent();
    String itemId = intent != null ? intent.getStringExtra(EXTRA_ITEM_ID) : "";
    return itemId == null ? "" : itemId;
  }

  private void cancelPostedNotification() {
    try {
      Object svc = getSystemService(Context.NOTIFICATION_SERVICE);
      if (svc instanceof NotificationManager) {
        ((NotificationManager) svc).cancel(currentAlarmId);
      }
    } catch (Exception ignored) {}
  }

  private Uri alarmUri() {
    try {
      int soundId = getResources().getIdentifier(
        "attention_reminder", "raw", getPackageName()
      );
      if (soundId != 0) {
        return Uri.parse("android.resource://" + getPackageName() + "/" + soundId);
      }
    } catch (Exception ignored) {}
    return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
  }

  private void startAlarmSound() {
    try {
      mediaPlayer = new MediaPlayer();
      mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build());
      mediaPlayer.setDataSource(this, alarmUri());
      mediaPlayer.setLooping(true);
      mediaPlayer.prepare();
      mediaPlayer.start();
    } catch (Exception e) {
      try {
        mediaPlayer = MediaPlayer.create(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));
        if (mediaPlayer != null) {
          mediaPlayer.setLooping(true);
          mediaPlayer.start();
        }
      } catch (Exception ignored) {}
    }
  }

  private void startVibration() {
    try {
      if (Build.VERSION.SDK_INT >= 31) {
        Object svc = getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
        VibratorManager vm = svc instanceof VibratorManager ? (VibratorManager) svc : null;
        vibrator = vm != null ? vm.getDefaultVibrator() : null;
      } else {
        Object svc = getSystemService(Context.VIBRATOR_SERVICE);
        vibrator = svc instanceof Vibrator ? (Vibrator) svc : null;
      }
      if (vibrator == null || !vibrator.hasVibrator()) return;
      long[] pattern = { 0, 800, 400, 800, 600 };
      if (Build.VERSION.SDK_INT >= 26) {
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
      } else {
        vibrator.vibrate(pattern, 0);
      }
    } catch (Exception ignored) {}
  }

  private void stopAlarmEffects() {
    try {
      if (mediaPlayer != null) {
        if (mediaPlayer.isPlaying()) mediaPlayer.stop();
        mediaPlayer.release();
      }
    } catch (Exception ignored) {}
    mediaPlayer = null;
    try {
      if (vibrator != null) vibrator.cancel();
    } catch (Exception ignored) {}
    vibrator = null;
    if (clockTicker != null) handler.removeCallbacks(clockTicker);
  }

  @Override
  protected void onDestroy() {
    stopAlarmEffects();
    super.onDestroy();
  }

  @Override
  public void onBackPressed() {
    // D12：返回 = 「关闭」（只止响，不写 ACK）
    finishWithAction("close", false);
  }
}
