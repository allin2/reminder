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
  private static java.lang.ref.WeakReference<AlarmActivity> current = new java.lang.ref.WeakReference<>(null);

  static void stopDelivery(int id, String token) {
    AlarmActivity activity = current.get();
    if (activity == null) return;
    activity.runOnUiThread(() -> {
      String activeToken = activity.getIntent().getStringExtra(AlarmTrace.EXTRA);
      if ((id != -1 && activity.currentAlarmId != id) || (token != null && !token.equals(activeToken))) return;
      activity.stopAllEffects();
      activity.finish();
    });
  }
  private final Handler handler = new Handler(Looper.getMainLooper());
  private Runnable clockTicker;
  /** V1：本次投递是否已经判定为「显示出来了」，避免重复落盘与重复采样 */
  private boolean visibilityMarked = false;

  /** 当前 Intent 绑定的数据（R2：随 onNewIntent 更新） */
  private String currentTitle = "";
  private String currentBody = "";
  private String currentLevel = "";
  private String currentItemRev = "0";
  private int currentAlarmId = 90002;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    trace("created", "test=" + getIntent().getBooleanExtra(AlarmTrace.TEST, false));
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

    current = new java.lang.ref.WeakReference<>(this);
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
    String oldToken = getIntent().getStringExtra(AlarmTrace.EXTRA);
    String newToken = intent.getStringExtra(AlarmTrace.EXTRA);
    if (oldToken != null && oldToken.equals(newToken)) {
      trace("duplicateIntent", "same delivery; keep sound playing");
      return;
    }
    trace("replaced", "different delivery");
    // 上一条的通知必须一并撤掉：D59 之后它不再承载声音（声音在服务里），
    // 但残留的通知仍带着全屏意图与停止按钮，留着会让用户点到已经过期的入口。
    if (currentAlarmId != intent.getIntExtra(EXTRA_ID, currentAlarmId)) {
      ActiveAlarmStore.drop(this, currentAlarmId);
    }
    // **只停界面这一路**，绝不停服务。
    //
    // 新投递的服务在 `AlarmTestReceiver.onReceive` 里就已经启动了，而它的 trace 与当前
    // 界面手里的旧 trace 不同 —— 此刻调 `stopAllEffects()` 会把**刚为新投递起的那条铃声**
    // 一起杀掉，用户听到的是「B 响了一声就没了」。而服务自己认 trace：
    // 它的 `onStartCommand` 收到新 trace 时会自行把铃声从 A 换到 B。
    stopLocalFallback();
    setIntent(intent);
    bindIntent();
    restartAlarmEffects();
    // V1：换了一条投递，可见性判定要重新开始（新投递必须自己证明自己显示出来了）
    visibilityMarked = false;
    try {
      getSharedPreferences(PREFS, MODE_PRIVATE).edit()
        .putBoolean(AlarmTestReceiver.KEY_DELIVERY_VISIBLE, false)
        .putLong(AlarmTestReceiver.KEY_DELIVERY_HIDDEN_AT, 0L)
        .apply();
    } catch (Exception ignored) {}
    observeWindow();
  }

  @Override
  protected void onResume() {
    super.onResume();
    trace("resumed", "lifecycle only");
    if (clockTicker != null) {
      handler.removeCallbacks(clockTicker);
      handler.post(clockTicker);
    }
    // N-02：`onStop` 无条件停掉声振（隐藏的界面不该自己独立重复振动 / 循环响铃），
    // 但此前**没有对应的恢复** —— 用户按 Home 再切回来，在通知权限被禁（声音只能靠界面自播）
    // 的机器上，闹钟就永久哑了。可见即恢复，与 onStop 的决策配成一对。
    // 幂等性由 startAlarmSound 保证；token 已失效（被停止 / 被替换）时它自己 finish。
    restartAlarmEffects();
    observeWindow();
  }

  private void trace(String stage, String detail) {
    AlarmTrace.record(this, getIntent() == null ? null : getIntent().getStringExtra(AlarmTrace.EXTRA), stage, detail);
  }

  /**
   * V1：在 onResume 之后取三次窗口样本，自己证明「界面到底有没有送到用户眼前」。
   *
   * 此前只采一次（1.2 秒），且「可见」只认 onWindowFocusChanged(true)。真机实测：
   * 后台被拉起时窗口可能**可见但拿不到焦点**，于是 deliveryShownAt 永远是 0，
   * 被自检面板判成「用户没看到」—— 与事实不符。现在两条判据任一成立即算显示出来，
   * 三次都没中才记一笔 deliveryHiddenAt：声音照旧响（它是用户唯一的线索），
   * 但我们不再假装这次投递成功了。
   */
  private void observeWindow() {
    final String token = getIntent().getStringExtra(AlarmTrace.EXTRA);
    final int[] delays = { 300, 800, 1500 };
    for (final int delay : delays) {
      handler.postDelayed(() -> {
        if (isFinishing() || isDestroyed() || token == null || !token.equals(getIntent().getStringExtra(AlarmTrace.EXTRA))) return;
        android.view.View view = getWindow().getDecorView();
        boolean playing = false;
        try { playing = mediaPlayer != null && mediaPlayer.isPlaying(); } catch (Exception ignored) {}
        AlarmTrace.record(this, token, "windowSample", "after=" + delay + "ms;focus=" + view.hasWindowFocus() +
          ";shown=" + view.isShown() + ";visibility=" + view.getWindowVisibility() + ";playing=" + playing);
        markVisible("sample@" + delay);
        if (delay == delays[delays.length - 1] && !visibilityMarked) markHidden();
      }, delay);
    }
  }

  /**
   * V1：把「界面真的显示出来了」落盘。判据二选一 —— 窗口可见（isShown 且 windowVisibility==0）
   * 或获得窗口焦点。只看焦点会漏掉「可见但无焦点」的情形，只看可见性会漏掉被系统半透明覆盖的情形。
   */
  private void markVisible(String reason) {
    if (visibilityMarked) return;
    android.view.View view = getWindow() == null ? null : getWindow().getDecorView();
    if (view == null) return;
    boolean shown = view.isShown() && view.getWindowVisibility() == 0;
    boolean focused = view.hasWindowFocus();
    if (!shown && !focused) return;
    visibilityMarked = true;
    try {
      getSharedPreferences(PREFS, MODE_PRIVATE).edit()
        .putLong(AlarmTestReceiver.KEY_DELIVERY_SHOWN_AT, System.currentTimeMillis())
        .putBoolean(AlarmTestReceiver.KEY_DELIVERY_VISIBLE, true)
        .apply();
    } catch (Exception ignored) {}
    trace("windowVisible", "via=" + reason + ";focused=" + focused + ";shown=" + shown);
  }

  /** V1：1.5 秒后窗口仍不可见 ⇒ 如实记一笔「这次投递没送到用户眼前」 */
  private void markHidden() {
    try {
      getSharedPreferences(PREFS, MODE_PRIVATE).edit()
        .putLong(AlarmTestReceiver.KEY_DELIVERY_HIDDEN_AT, System.currentTimeMillis())
        .putBoolean(AlarmTestReceiver.KEY_DELIVERY_VISIBLE, false)
        .apply();
    } catch (Exception ignored) {}
    trace("windowHidden", "never visible within 1500ms");
  }

  @Override
  public void onWindowFocusChanged(boolean focused) {
    super.onWindowFocusChanged(focused);
    trace("focus", String.valueOf(focused));
    if (focused) markVisible("focus");
  }

  @Override
  protected void onPause() {
    trace("paused", "finishing=" + isFinishing());
    super.onPause();
  }

  @Override
  protected void onStop() {
    trace("stopped", "finishing=" + isFinishing());
    // D45-a 反向选择（2026-09-18）：界面被遮挡时**不再停止声振**。
    // 原先的决策是 "A hidden Activity must never hold an independent repeating
    // vibration"；但它只在一种情况下成为问题，即声音另有载体（通知）时。
    // 而走到这里由界面发声，前提恰恰是 notificationOwnsSound() 为 false ——
    // 用户关掉了通知权限，通知栏里根本没有那条带停止按钮的常驻通知，
    // 界面因此是**唯一**的声源与唯一的静音入口；此时停声 = 整个闹钟消失。
    //
    // D59 补注（2026-09-19）：这条裁决的**前提已经被改掉一半** —— 声音与振动的主载体
    // 不再是通知，而是 `AlarmRingService`。所以「遮挡期继续响」现在是**服务**的性质，
    // 与界面死活无关；本方法连 `stopLocalFallback()` 都不必调，因为服务那边的铃声
    // 不会因为界面的 onStop 而中断。D45-a 的结论不变（要响），但原因换了：
    // 从前是「界面停了就没人响了」，现在是「界面本来就管不着铃声」。
    // 覆盖该决策所接受的两项代价与两道边界：
    //   · 代价：用户必须回到界面、或点通知按钮才能静音（通知按钮在无权限时不存在，
    //     此时界面按钮是唯一入口 —— 见 D63 已显式接受该风险）
    //   · 代价：遮挡期间振动也继续（USAGE_ALARM + repeat=0，本就该如此）
    //   · 边界一：onDestroy 仍调 stopLocalFallback()，**回落路径**的响铃不越过界面自身的销毁
    //     （服务路径不受此限，它有自己的 MAX_AGE 上限）
    //   · 边界二：ActiveAlarmStore.MAX_AGE_MS 给台账与响铃设同一条上限
    // 时钟刷新仍然停：它只服务于可见界面，onResume 会重新 post。
    if (clockTicker != null) handler.removeCallbacks(clockTicker);
    super.onStop();
  }

  private void bindIntent() {
    Intent intent = getIntent();
    if (intent != null && intent.getBooleanExtra(AlarmTrace.TEST, false)) {
      final String token = intent.getStringExtra(AlarmTrace.EXTRA);
      handler.postDelayed(() -> {
        if (token != null && token.equals(getIntent().getStringExtra(AlarmTrace.EXTRA))) {
          trace("autoClose", "diagnostic 5-second timeout");
          stopAllEffects(); cancelPostedNotification(); finish();
        }
      }, 5000L);
    }
    // F1：两套键名都认 —— 闹钟时钟直接投递时带的是 Receiver 那套（见 AlarmScheduler.schedule）
    String title = pick(EXTRA_TITLE, AlarmTestReceiver.EXTRA_TITLE);
    String body = pick(EXTRA_BODY, AlarmTestReceiver.EXTRA_BODY);
    String level = pick(EXTRA_LEVEL, AlarmTestReceiver.EXTRA_LEVEL);
    String itemId = pick(EXTRA_ITEM_ID, AlarmTestReceiver.EXTRA_ITEM_ID);
    // V02：整条链路统一用 String 承载数据版本（Intent 的 typed getter 必须与实际类型匹配，
    // 用 getIntExtra 读一个 String extra 只会拿到默认值 0，导致旧版本校验把有效动作全部拒绝）
    String itemRev = pick(EXTRA_ITEM_REV, AlarmTestReceiver.EXTRA_ITEM_REV);
    if (itemId == null) itemId = "";
    if (itemRev == null || itemRev.isEmpty()) itemRev = "0";
    if (title == null || title.isEmpty()) title = "安心收件箱";
    if (body == null || body.isEmpty()) body = "有一条事项需要你确认";
    currentTitle = title;
    currentBody = body;
    currentLevel = level == null ? "" : level;
    currentItemRev = itemRev == null ? "0" : itemRev;
    currentAlarmId = intent != null
      ? (intent.hasExtra(EXTRA_ID)
          ? intent.getIntExtra(EXTRA_ID, 90002)
          : intent.getIntExtra(AlarmTestReceiver.EXTRA_ID, 90002))
      : 90002;

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

  private static final Object FALLBACK_SILENCE_TOKEN = new Object();

  /**
   * D59：界面不再持有铃声与振动的主载体 —— 那是 `AlarmRingService` 的职责。
   *
   * 这里只做两件事：确认这次投递仍然有效（否则自关），以及**在服务缺席时回落自播**
   * （S2.3 降级矩阵最后一行：前台服务起不来时，进程内自播是最后一道防线）。
   *
   * 互斥是硬要求：服务在响时界面绝不自己播。V3 记的就是两路同时持有声音的现场 ——
   * `replaced different delivery → effectsStopped → audioStarted → duplicateIntent`，
   * 用户听到的是响铃被打断后从头重播。
   */
  private void restartAlarmEffects() {
    String token = getIntent().getStringExtra(AlarmTrace.EXTRA);
    if (!ActiveAlarmStore.contains(this, currentAlarmId, token)) {
      finish();
      return;
    }
    // D68 / Phase B：检查该投递是否已自动静音或已终止
    if (AlarmRingService.wasAutoSilenced(this, token) || AlarmRingService.isDeliveryTerminated(this, token)) {
      stopLocalFallback();
      recordFallbackCarrier("none");
      return;
    }
    if (AlarmRingService.isRinging()) {
      stopLocalFallback();
      recordFallbackCarrier("none");
      return;
    }
    startLocalFallback();
  }

  /**
   * 回落自播：只有服务确实没起来时才走这里。
   * 继承并遵守剩余静音倒计时（单调递减）。
   */
  private void startLocalFallback() {
    String token = getIntent() == null ? null : getIntent().getStringExtra(AlarmTrace.EXTRA);
    long remainingMs = AlarmRingService.getRemainingSilenceMs(this, token, AlarmRingService.AUTO_SILENCE_MS);
    if (remainingMs <= 0L) {
      AlarmRingService.markAutoSilenced(this, token);
      stopLocalFallback();
      recordFallbackCarrier("none");
      return;
    }
    AlarmRingService.ensureDeliveryRecord(this, token, remainingMs);
    startAlarmSound();
    startVibration();
    recordFallbackCarrier(mediaPlayer != null ? "activity" : "none");
    scheduleFallbackAutoSilence(token, remainingMs);
  }

  private void scheduleFallbackAutoSilence(String token, long remainingMs) {
    handler.removeCallbacksAndMessages(FALLBACK_SILENCE_TOKEN);
    handler.postAtTime(() -> {
      AlarmRingService.markAutoSilenced(this, token);
      stopLocalFallback();
      recordFallbackCarrier("none");
      AlarmTrace.record(this, token, "fallbackAutoSilenced",
        "silenced by fallback deadline; sound+vibration stopped; no ACK");
    }, FALLBACK_SILENCE_TOKEN, android.os.SystemClock.uptimeMillis() + remainingMs);
  }

  /**
   * 把「这次是界面在响」记进载体台账。
   *
   * 必须带上本次投递的 trace —— 读取方（`SystemBridgePlugin.lastAlarmDelivery`）靠它
   * 判断这份载体记录属于哪一次投递；不写就会被判成陈旧值而返回 "unknown"，
   * 于是「界面回落确实响了」这件事在面板上反而看不见。
   */
  private void recordFallbackCarrier(String sound) {
    try {
      getSharedPreferences(PREFS, MODE_PRIVATE).edit()
        .putString(AlarmTestReceiver.KEY_CARRIER_SOUND, sound)
        .putString(AlarmTestReceiver.KEY_CARRIER_VIBRATE, sound.equals("none") ? "none" : "activity")
        .putBoolean(AlarmTestReceiver.KEY_CARRIER_FGS, false)
        .putLong(AlarmTestReceiver.KEY_CARRIER_AT, System.currentTimeMillis())
        .putString(AlarmTestReceiver.KEY_CARRIER_TRACE,
          getIntent() == null ? "" : String.valueOf(getIntent().getStringExtra(AlarmTrace.EXTRA)))
        .apply();
    } catch (Exception ignored) {}
  }

  /** F1：闹钟时钟直接拉起界面时，extras 用的是 Receiver 那套键名；两套都认，界面才能正确渲染 */
  private String pick(String uiKey, String deliveryKey) {
    Intent intent = getIntent();
    if (intent == null) return null;
    String value = intent.getStringExtra(uiKey);
    if (value == null || value.isEmpty()) value = intent.getStringExtra(deliveryKey);
    return value;
  }

  private void finishWithAction(String action, boolean reschedule) {
    trace("userAction", action);
    // 用户明确要求停止 —— 这是**唯一**该停服务的出口类型（服务 + 界面回落一起停）
    stopAllEffects();
    if (reschedule) {
      try {
        long delay = 2 * 60 * 60 * 1000L; // D11：快捷稍后固定 2 小时
        long triggerAt = System.currentTimeMillis() + delay;
        String itemIdForReschedule = currentItemId();
        String itemRevForReschedule = currentItemRev == null ? "0" : currentItemRev;
        AlarmScheduler.schedule(this, triggerAt, currentTitle, currentBody,
          currentAlarmId, itemIdForReschedule, currentLevel, itemRevForReschedule,
          "wall-clock", 0L,
          // UX-T03：原生快捷稍后是**固定的 2 小时**（D11），JS 调度器并不知道这一轮，
          // 所以给它一个自解释的身份前缀。没有它，2 小时后真响的那次在证据台账里
          // 没有身份，用户回来查只能看到「尚未确认」。
          "snooze@" + triggerAt, triggerAt);
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
    String itemId = pick(EXTRA_ITEM_ID, AlarmTestReceiver.EXTRA_ITEM_ID);
    return itemId == null ? "" : itemId;
  }

  private void cancelPostedNotification() {
    ActiveAlarmStore.stop(this, currentAlarmId, getIntent().getStringExtra(AlarmTrace.EXTRA));
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
    // N-02：`onResume` 会在「从后台切回来」时重新起响，所以这里必须**幂等**。
    // `playAlarm` 无条件 `new MediaPlayer()` 并直接覆盖字段 —— 旧 player 仍在 looping
    // 但已失去引用，既停不掉也释放不掉，结果是两路铃声叠加。
    // 已在播就直接复用；存在但已停（异常残留）才重建。
    if (mediaPlayer != null) {
      try { if (mediaPlayer.isPlaying()) return; } catch (Exception ignored) {}
      releasePlayer();
    }
    android.media.AudioManager audio = (android.media.AudioManager) getSystemService(Context.AUDIO_SERVICE);
    if (audio != null) trace("audioState", "alarmVolume=" + audio.getStreamVolume(android.media.AudioManager.STREAM_ALARM)
      + ";max=" + audio.getStreamMaxVolume(android.media.AudioManager.STREAM_ALARM) + ";mode=" + audio.getMode());
    try {
      playAlarm(alarmUri());
    } catch (Exception error) {
      trace("audioFailed", "primary: " + error.toString());
      releasePlayer();
      try { playAlarm(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)); }
      catch (Exception fallback) { trace("audioFailed", "fallback: " + fallback.toString()); releasePlayer(); }
    }
  }

  private void playAlarm(Uri uri) throws Exception {
    mediaPlayer = new MediaPlayer();
    mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
    mediaPlayer.setOnErrorListener((player, what, extra) -> {
      trace("audioFailed", "async what=" + what + ";extra=" + extra); return false;
    });
    mediaPlayer.setDataSource(this, uri);
    mediaPlayer.setLooping(true);
    mediaPlayer.prepare();
    mediaPlayer.start();
    trace("audioStarted", "isPlaying=" + mediaPlayer.isPlaying() + ";not acoustic proof");
  }

  private void releasePlayer() {
    try { if (mediaPlayer != null) mediaPlayer.release(); } catch (Exception ignored) {}
    mediaPlayer = null;
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

  /**
   * 停掉**界面这一路**的回落自播。
   *
   * D59 之前它叫 `stopAlarmEffects()` —— 那时界面确实是声音的所有者，名字是准的。
   * 现在主载体在服务里，界面这条路只剩「服务没起来」时的回落，名字必须跟着改，
   * 否则下一个读代码的人会以为调用它就是「静音了整个闹钟」，而在服务持有铃声时
   * 它其实**什么也没停**。
   */
  private void stopLocalFallback() {
    trace("localFallbackStopped", "service-owned sound is stopped separately");
    handler.removeCallbacksAndMessages(FALLBACK_SILENCE_TOKEN);
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

  /**
   * 停掉**全部**声振：服务那一路 + 界面回落这一路。
   *
   * 只给「用户明确要求停止」的出口用（四个出口 / 诊断自动关闭）——
   * 绝不能用在对账或换投递的路径上：换投递时服务正在为新投递响，
   * 停掉它等于把刚起的那条铃声也一起杀了（见 `onNewIntent` 的注释）。
   */
  private void stopAllEffects() {
    String token = getIntent() == null ? null : getIntent().getStringExtra(AlarmTrace.EXTRA);
    AlarmRingService.requestStop(this, currentAlarmId, token);
    stopLocalFallback();
  }

  @Override
  protected void onDestroy() {
    trace("destroyed", "finishing=" + isFinishing());
    // V1：到销毁都没能判定为可见（例如被系统在几百毫秒内收掉）⇒ 这次投递没送到眼前，如实落盘
    if (!visibilityMarked) markHidden();
    // D59：**只停回落路径**。服务持有的铃声不随界面销毁而中断 ——
    // 这正是本次修复的目的：界面起不来（vivo 上常态）时闹钟照样响。
    // 服务的生命周期由它自己管（显式停止 / MAX_AGE 上限），不由界面的生死决定。
    stopLocalFallback();
    handler.removeCallbacksAndMessages(null);
    super.onDestroy();
  }

  @Override
  public void onBackPressed() {
    // D12：返回 = 「关闭」（只止响，不写 ACK）
    finishWithAction("close", false);
  }

  @Override
  public android.content.SharedPreferences getSharedPreferences(String name, int mode) {
    if (android.os.Build.VERSION.SDK_INT >= 24) {
      if (isDeviceProtectedStorage()) {
        return super.getSharedPreferences(name, mode);
      }
      android.os.UserManager um = (android.os.UserManager) getSystemService(Context.USER_SERVICE);
      if (um != null && !um.isUserUnlocked()) {
        Context de = createDeviceProtectedStorageContext();
        if (de != null) {
          return de.getSharedPreferences(name, mode);
        }
      }
    }
    return super.getSharedPreferences(name, mode);
  }
}
