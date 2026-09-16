package space.alliswell.inbox;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
 */
public class AlarmActivity extends AppCompatActivity {
  public static final String EXTRA_TITLE = "alarmTitle";
  public static final String EXTRA_BODY = "alarmBody";
  public static final String EXTRA_ID = "alarmId";
  public static final String EXTRA_ITEM_ID = "alarmItemId";
  public static final String EXTRA_LEVEL = "alarmLevel";
  public static final String PREFS = "attention_alarm";
  public static final String KEY_ACTION = "lastAction";
  public static final String KEY_ITEM_ID = "lastItemId";

  private MediaPlayer mediaPlayer;
  private Vibrator vibrator;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private Runnable clockTicker;

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

    String title = getIntent() != null ? getIntent().getStringExtra(EXTRA_TITLE) : null;
    String body = getIntent() != null ? getIntent().getStringExtra(EXTRA_BODY) : null;
    String level = getIntent() != null ? getIntent().getStringExtra(EXTRA_LEVEL) : null;
    String itemId = getIntent() != null ? getIntent().getStringExtra(EXTRA_ITEM_ID) : "";
    if (itemId == null) itemId = "";
    if (title == null || title.isEmpty()) title = "安心收件箱";
    if (body == null || body.isEmpty()) body = "有一条事项需要你确认";
    final String finalTitle = title;
    final String finalBody = body;
    final String finalItemId = itemId;
    final int alarmId = getIntent() != null ? getIntent().getIntExtra(EXTRA_ID, 90002) : 90002;

    TextView titleView = findViewById(R.id.alarmTitle);
    TextView bodyView = findViewById(R.id.alarmBody);
    TextView clockView = findViewById(R.id.alarmClockText);
    TextView levelView = findViewById(R.id.alarmLevel);
    titleView.setText(finalTitle);
    bodyView.setText(finalBody);
    if (level != null && !level.isEmpty()) levelView.setText(level);

    SimpleDateFormat fmt = new SimpleDateFormat("HH:mm", Locale.getDefault());
    clockView.setText(fmt.format(new Date()));
    clockTicker = new Runnable() {
      @Override
      public void run() {
        clockView.setText(fmt.format(new Date()));
        handler.postDelayed(this, 1000L);
      }
    };
    handler.post(clockTicker);

    startAlarmSound();
    startVibration();

    // D11：快捷动作 = 我知道了 / 稍后 2 小时 / 完成；D12：关闭只止响
    Button ack = findViewById(R.id.btnAck);
    Button snooze = findViewById(R.id.btnSnooze);
    Button done = findViewById(R.id.btnDone);
    Button dismiss = findViewById(R.id.btnDismiss);

    ack.setOnClickListener(v -> {
      finishWithAction("ack", finalItemId, false);
    });
    snooze.setOnClickListener(v -> {
      finishWithAction("snooze", finalItemId, true);
    });
    done.setOnClickListener(v -> {
      finishWithAction("done", finalItemId, false);
    });
    dismiss.setOnClickListener(v -> {
      finishWithAction("close", finalItemId, false);
    });
  }

  private void finishWithAction(String action, String itemId, boolean reschedule) {
    stopAlarmEffects();
    if (reschedule) {
      try {
        long delay = 2 * 60 * 60 * 1000L; // D11：快捷稍后固定 2 小时
        long triggerAt = System.currentTimeMillis() + delay;
        String title = getIntent() != null ? getIntent().getStringExtra(EXTRA_TITLE) : "安心收件箱";
        String body = getIntent() != null ? getIntent().getStringExtra(EXTRA_BODY) : "有一条事项需要你确认";
        String level = getIntent() != null ? getIntent().getStringExtra(EXTRA_LEVEL) : null;
        int id = getIntent() != null ? getIntent().getIntExtra(EXTRA_ID, 90002) : 90002;
        AlarmScheduler.schedule(this, triggerAt, title, body, id, itemId, level);
        // P0-2：自行重排的闹钟也要入账，否则下一轮对账撤不掉它（会变成幽灵闹钟 / 重复响）
        SystemBridgePlugin.persistAlarm(this, id, triggerAt, title, body, itemId, level);
      } catch (Exception ignored) {}
    }
    try {
      SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
      prefs.edit().putString(KEY_ACTION, action).putString(KEY_ITEM_ID, itemId).apply();
    } catch (Exception ignored) {}
    // 回到 WebView 让 JS 处理 ACK/完成
    try {
      Intent main = getPackageManager().getLaunchIntentForPackage(getPackageName());
      if (main != null) {
        main.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        main.putExtra("alarmAction", action);
        main.putExtra("alarmItemId", itemId);
        startActivity(main);
      }
    } catch (Exception ignored) {}
    finish();
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
        VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
        vibrator = vm != null ? vm.getDefaultVibrator() : null;
      } else {
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
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
    finishWithAction("close",
      getIntent() != null ? getIntent().getStringExtra(EXTRA_ITEM_ID) : "",
      false);
  }
}
