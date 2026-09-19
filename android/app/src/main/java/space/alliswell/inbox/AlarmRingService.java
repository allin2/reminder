package space.alliswell.inbox;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.core.app.NotificationCompat;

/**
 * 闹钟档的「两个身份」（D59）。
 *
 * ## 身份一（F3，原有）：解冻投递器
 *
 * vivo / OriginOS 的 `fast_freezer` 会把后台进程冻进 cgroup。真机取证
 * （2026-09-17，events 缓冲）：
 *
 * ```
 * 22:35:30.956  am_app_frozen   [10190, space.alliswell.inbox, from fast_freezer]
 * 22:35:31.809  device_idle_wake_from_idle [*walarm*:…ACTION_TEST_ALARM]   ← 系统侧分秒不差
 * 22:36:48.335  am_app_unfrozen […reason=resume top activity]              ← 解冻者不是广播
 * 22:36:48.664  deliveryAt                                                 ← 实际送达，晚 77 秒
 * ```
 *
 * 每一次解冻的原因只有两类：`screen on` / `resume top activity`。**广播投递不会解冻进程**，
 * 所以闹钟虽然准时唤醒了系统，却要等到用户点亮屏幕才被送达 —— 用户感知就是
 * 「闹钟只有打开 App 才响」。服务启动必须把进程拉起来，所以闹钟到点时会同时发出两条排程
 * （见 `AlarmScheduler.scheduleUnfreezer`），本服务负责解冻。
 *
 * 2026-09-17 晚的补充取证（把机制钉死，两次独立实验）：
 *
 * ```
 * ① 冻结期间系统侧到底发生了什么（dumpsys alarm，dump 时刻 23:02:39.933）
 *      u0a190:
 *        #1..#10: Reason=frozen   rtc=2026-09-17 22:59:09.923   ← 与 am_app_frozen 同一毫秒
 *        #6: tag=*walarm*:space.alliswell.inbox/.AlarmRingService ← 本服务也在被挂起之列
 *      +478ms 8 wakes 8 alarms, last -2m31s595ms: *walarm*:…ACTION_TEST_ALARM
 *        （-2m31s595ms 回推 = 23:00:08.338，正是 device_idle_wake_from_idle 的时刻）
 *      → 「闹钟时钟」形态准点派发；allow-while-idle 形态被 Reason=frozen 挂起。
 *
 * ② 同一份代码，应用**没有被冻结**（保持前台）时的对照实验
 *      unfreezerStarted → received → notifyReturned(insistent) → unfreezerStopped
 *      → 机制本身没毛病，冻结是唯一阻塞。
 * ```
 *
 * **别再退回 `setExactAndAllowWhileIdle`**：冻结态下只有「闹钟时钟」位会被派发，
 * 退回去等于解冻器自己先哑火，广播也一并晚到。
 *
 * ## 身份二（D59，本轮新增）：铃声与振动的**唯一持有者**
 *
 * 旧实现把「声音、振动、屏幕」三件事全部挂在**同一条通知**上：
 * 声音靠 `Notification.FLAG_INSISTENT` 交给 `NotificationManagerService` 的 IRingtonePlayer、
 * 振动靠通知渠道、屏幕靠 `setFullScreenIntent`。于是通知权限被拒时 `notify()` 是**静默空操作**，
 * 三件事同时归零 —— 真机实测「无通知权限 + 息屏」7 轮受控投递 **0/4** 成功。
 *
 * D59 把声音与振动的所有权**收回应用**：
 *
 * | 要素 | 旧载体 | 新载体 |
 * |---|---|---|
 * | 铃声 | 通知（`FLAG_INSISTENT` + 渠道音） | **本服务**（`MediaPlayer`，`USAGE_ALARM`，循环） |
 * | 振动 | 通知渠道 | **本服务**（`Vibrator` 波形） |
 * | 屏幕 | 全屏意图通知 | 仍走 `startActivity` + 全屏意图兜底（通知权限只管这一格） |
 *
 * 关键依据（官方文档明写）：
 * - 「Apps don't need to request the POST_NOTIFICATIONS permission in order to launch
 *   a foreground service.」—— 权限被拒时**服务照常运行**，只是它的通知不出现在状态栏。
 *   没有任何官方说法称无权限会导致 `startForeground` 失败或服务被杀。
 * - 「exact alarms aren't affected by foreground service launch restrictions」——
 *   这正是「闹钟时钟 → 后台起前台服务」的官方依据（注意它是 **FGS 启动**豁免，
 *   与「BAL 豁免」是两件事；旧代码注释把两者混为一谈，见 D58）。
 *
 * ## 身份三（D68，本轮新增）：响铃**追多久**的决定者
 *
 * 持有铃声的服务同时也是唯一知道「这次投递响了多久」的地方，所以「自动静音上限」归它。
 * 见 `AUTO_SILENCE_MS`：5 分钟后停声振、留记录、**不产生 ACK**（基线 §8「不无限追击」+ §8.1）。
 *
 * ## 已知边界（诚实记录，别当成已修）
 *
 * 冻结态下广播与 Activity 启动都进不去这个进程。若某台设备上连「闹钟时钟 → 前台服务」
 * 也被系统丢弃（例如更激进的 ROM），那么应用侧**没有任何**手段能在不被冻结的前提下响铃 ——
 * 那时唯一的出路是让进程始终不被冻结（常驻前台服务）或由用户把应用加入厂商后台白名单。
 * 此时 `AlarmActivity` 的进程内回落自播是最后一道防线（S2.3 降级矩阵最后一行）。
 */
public class AlarmRingService extends Service {
  /** 与闹钟通知（90002/90003…）分开的 id，避免互相覆盖 */
  private static final int FOREGROUND_ID = 90090;
  private static final String CHANNEL_ID = "attention-alarm-guard";
  /**
   * 停铃动作。用显式动作而不是 `stopSelf()` —— 停止请求可能来自别的组件
   * （通知按钮 / 界面按钮 / 对账），它们只能通过 `requestStop()` 把服务停掉，
   * 而 `stopService()` 会走 `onDestroy`，那里才是真正的收口点。
   */
  static final String ACTION_STOP = "space.alliswell.inbox.ACTION_RING_STOP";

  /**
   * 测试钩子：允许调用方指定响铃上限（毫秒）。
   *
   * 服务不导出，只有应用自己（或 run-as / shell）能带这个 extra，所以不构成外部攻击面。
   * 加它的原因是「响铃上限到底有没有生效」必须用**短于生产值**的窗口才测得出：
   * 生产上限是 6 小时，不可能在真机上等。
   */
  static final String EXTRA_MAX_RING_MS = "maxRingMs";

  /** `scheduleMaxAge` 的回调 token —— 重复启动时用它清掉旧的那条，避免上限回调堆叠 */
  private static final Object MAX_AGE_TOKEN = new Object();

  /**
   * D68：响铃的**自动静音上限** —— 「追多久」的答案。
   *
   * 基线 §8 对普通档写的是「未 ACK 时有限补提醒；**达到上限后进入未确认区，不无限追击**」。
   * 闹钟档此前唯一的上限是 `ActiveAlarmStore.MAX_AGE_MS`(6h)，而 D63 之后
   * 「无通知权限 + 息屏」时界面与通知栏**都没有** —— 用户面对的是
   * 「只闻其声、不见其屏、也停不下来」，最坏情况要响 6 小时。
   * 本上限就是那条 §8 原则在闹钟档的落地。
   *
   * 取值照搬成熟闹钟：AOSP DeskClock / Google Clock 的「静音时长（Silence after）」
   * 默认 5 分钟，可选 5/10/15/30。**取 5 分钟** —— 足够叫醒，又不至于变成骚扰。
   *
   * **静音 ≠ 用户确认**（基线 §8.1：「系统不得根据解锁、进入 App、通知消失等行为推测 ACK」）：
   * 本路径**不产生任何 ACK**，投递记录也**不删除** —— 它留在台账里，
   * 等用户下次打开 App 时以「响过、未被确认」呈现。6h 的 `MAX_AGE_MS` 仍是最后防线。
   */
  static final long AUTO_SILENCE_MS = 5L * 60L * 1000L;

  /**
   * 测试钩子：允许调用方指定自动静音上限（毫秒）。理由与 `EXTRA_MAX_RING_MS` 完全相同 ——
   * 生产值是 5 分钟，真机上不可能为验证等 5 分钟；而「静音到底有没有发生」
   * 必须用**短于生产值**的窗口才测得出。服务不导出，不构成外部攻击面。
   */
  static final String EXTRA_AUTO_SILENCE_MS = "autoSilenceMs";

  /** 自动静音的回调 token —— 与响铃上限分开，两者互不覆盖 */
  private static final Object AUTO_SILENCE_TOKEN = new Object();

  /**
   * 「这一次投递已被自动静音」的落盘标记。
   *
   * 必须落盘、不能只用内存变量：`AlarmActivity.restartAlarmEffects()` 的**回落自播**条件是
   * 「服务不响」，而自动静音之后服务**恰好不响** —— 不标记的话，用户重新看到界面时
   * 铃声会被界面自己重新播起来，等于静音根本没发生（那正是 D68 要消灭的形态）。
   */
  private static final String KEY_AUTO_SILENCED_TRACE = "autoSilencedTrace";

  /** 自动静音发生的时刻。面板用它说明「响了多久之后静的」，而不是让用户猜。 */
  static final String KEY_AUTO_SILENCED_AT = "autoSilencedAt";

  /** 这次投递是否已经走到自动静音。供界面判定「不要回落自播」、供面板归因。 */
  static boolean wasAutoSilenced(Context context, String trace) {
    if (context == null || trace == null || trace.isEmpty()) return false;
    try {
      return trace.equals(context.getSharedPreferences(AlarmActivity.PREFS, Context.MODE_PRIVATE)
        .getString(KEY_AUTO_SILENCED_TRACE, ""));
    } catch (Exception ignored) {
      return false;
    }
  }

  /** 当前活跃实例。仅用于回答「现在是不是本服务在响」，不持有任何投递数据。 */
  private static volatile AlarmRingService instance;

  private final Handler handler = new Handler(Looper.getMainLooper());
  private MediaPlayer player;
  private Vibrator vibrator;
  private boolean ringing = false;
  /**
   * 当前正在响的是**哪一次投递**。
   *
   * 「广播投递」与「响铃服务」本来就是两条同刻的闹钟时钟（`scheduleUnfreezer`），
   * 它们都会走到这里。若不认身份就重起铃声，同一个闹钟会被打断后从头重播 ——
   * 用户听到的是「响了两声、停一下、又从开头响」，这正是 V3 记下的那类现场
   * （replaced different delivery → effectsStopped → audioStarted）。
   */
  private String ringingTrace;

  /**
   * 现在是否由**本服务**持有铃声。
   *
   * `AlarmActivity` 用它做互斥：服务在响时界面绝不自己播（否则就是 V3 那个
   * 「两路同时拉、响铃被打断重启」的坑）；服务没起来时界面才回落自播。
   */
  static boolean isRinging() {
    AlarmRingService service = instance;
    return service != null && service.ringing;
  }

  /**
   * 停铃收口 —— D59 之后**所有**停声路径都必须经过这里：
   * 通知的「停止声振」按钮（`AlarmStopReceiver`）、界面出口（`AlarmActivity`）、
   * 以及对账撤销（`ActiveAlarmStore`）。少一条就会表现为「关掉了界面，铃声还在响」。
   *
   * 用 `stopService()` 而不是 `startService(ACTION_STOP)`：服务没在跑时它是无害的 no-op，
   * 而 `startService` 会把一个没在响的服务**拉起来**再停掉 —— 白起一次前台服务。
   */
  static void requestStop(Context context) {
    if (context == null) return;
    try {
      context.stopService(new Intent(context, AlarmRingService.class));
    } catch (Exception ignored) {}
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null && ACTION_STOP.equals(intent.getAction())) {
      AlarmTrace.record(this, intent.getStringExtra(AlarmTrace.EXTRA), "ringStopRequested", "explicit stop action");
      stopSelf();
      return START_NOT_STICKY;
    }

    String trace = intent == null ? null : intent.getStringExtra(AlarmTrace.EXTRA);
    String title = intent == null ? null : intent.getStringExtra(AlarmTestReceiver.EXTRA_TITLE);
    // 没有投递数据的启动（系统重启服务、或外来 Intent）一律不响铃：
    // 宁可不响，也不要响一条没有归属、不知道该由哪条事项负责的闹钟。
    if (title == null || title.isEmpty()) {
      AlarmTrace.record(this, trace, "ringSkippedNoPayload", "started without delivery extras");
      stopSelf();
      return START_NOT_STICKY;
    }

    // 同一次投递的重复启动必须幂等 —— 两条同刻排程都会到这里，重起铃声就是打断重播。
    // 换了投递（trace 变了）才重启铃声，见下方 releasePlayer/stopRinging 的收口。
    if (ringing && trace != null && trace.equals(ringingTrace)) {
      AlarmTrace.record(this, trace, "ringDuplicateStart", "same delivery already ringing; kept as-is");
      scheduleMaxAge(trace, intent.getLongExtra(EXTRA_MAX_RING_MS, ActiveAlarmStore.MAX_AGE_MS));
      return START_NOT_STICKY;
    }

    instance = this;
    long maxRingMs = intent.getLongExtra(EXTRA_MAX_RING_MS, ActiveAlarmStore.MAX_AGE_MS);
    if (maxRingMs < 1000L) maxRingMs = 1000L;

    // 前台身份。**拿不到也要继续响** —— D59 之后铃声与振动不依赖通知，
    // 前台身份只是「让系统不要轻易杀掉我们」，不是响铃的前提（S2.3 降级矩阵）。
    boolean foreground = false;
    try {
      startForeground(FOREGROUND_ID, ringNotification(title));
      foreground = true;
    } catch (Exception error) {
      AlarmTrace.record(this, trace, "ringForegroundFailed", error.toString());
    }

    boolean sound = startRingtone(trace);
    boolean vibrate = startVibration(trace);
    // 「服务在响」= 至少一个载体到手。两者都失败才让界面回落自播，避免双声源。
    ringing = sound || vibrate;
    if (ringing) ringingTrace = trace;

    // D59/S2.5：载体归因必须落盘并与「本次投递」绑定 —— 时间戳让 App 侧能区分
    // 「服务真的报了到」与「服务没起来，读到的还是上一次投递的旧值」。
    recordCarrier(trace, sound, vibrate, foreground);

    AlarmTrace.record(this, trace, "ringStarted",
      "carrier=native;foreground=" + foreground + ";sound=" + sound + ";vibrate=" + vibrate);

    final long limit = maxRingMs;
    scheduleMaxAge(trace, limit);
    // D68：自动静音。**只在首次启动时arm** —— 上面「同一次投递重复启动」的早返回分支
    // 刻意不重新计时，否则两条同刻排程（投递 + 解冻器）会把静音窗口往后推。
    scheduleAutoSilence(trace, intent.getLongExtra(EXTRA_AUTO_SILENCE_MS, AUTO_SILENCE_MS));
    return START_NOT_STICKY;
  }

  /**
   * D68：到点自动静音 —— 停声振、留记录、**不产生 ACK**。
   *
   * 与 `scheduleMaxAge` 的分工：本方法管「响多久」（5 分钟，可感），
   * `scheduleMaxAge` 管「记录存多久」（6h，兜底）。两个上限并存，互不覆盖。
   */
  private void scheduleAutoSilence(String trace, long limitMs) {
    if (limitMs < 1000L) limitMs = 1000L;
    handler.removeCallbacksAndMessages(AUTO_SILENCE_TOKEN);
    final long limit = limitMs;
    handler.postAtTime(() -> {
      // 顺序有意：**先把「已静音」落盘，再停声**。
      // 界面（若可见）可能在服务停下的同一时刻 resume，那时它读到的必须已经是「已静音」，
      // 否则回落自播会在静音之后把铃声重新播起来。
      markAutoSilenced(trace);
      AlarmTrace.record(this, trace, "ringAutoSilenced",
        "silencedAfter=" + limit + "ms; sound+vibration stopped; delivery record kept (unacknowledged, no ACK)");
      stopSelf();
    }, AUTO_SILENCE_TOKEN, android.os.SystemClock.uptimeMillis() + limit);
  }

  /** 落盘「本次投递已自动静音」。写失败不阻塞静音本身 —— 停下来比标记更重要。 */
  private void markAutoSilenced(String trace) {
    try {
      getSharedPreferences(AlarmActivity.PREFS, Context.MODE_PRIVATE).edit()
        .putString(KEY_AUTO_SILENCED_TRACE, trace == null ? "" : trace)
        .putLong(KEY_AUTO_SILENCED_AT, System.currentTimeMillis())
        .apply();
    } catch (Exception ignored) {}
  }

  /**
   * D59：响铃上限兜底。
   *
   * 铃声不再交给通知（通知被撤掉就自动停），而是应用自己循环播 —— 因此必须有上限。
   * 上限用的是 `ActiveAlarmStore.MAX_AGE_MS`(6h) 同一个常量：它本来就是「一条投递
   * 多久之后不再算活跃」的既有裁决（D45），响铃与台账用同一条线，不会互相矛盾。
   *
   * 用 token 定位并先清旧回调：同一次投递可能被重复启动（两条同刻排程），
   * 堆叠会让 trace 里出现多条 ringMaxAgeReached，「到底响了多久」就读不准了。
   */
  private void scheduleMaxAge(String trace, long limitMs) {
    if (limitMs < 1000L) limitMs = 1000L;
    handler.removeCallbacksAndMessages(MAX_AGE_TOKEN);
    final long limit = limitMs;
    handler.postAtTime(() -> {
      AlarmTrace.record(this, trace, "ringMaxAgeReached", "limit=" + limit + "ms");
      stopSelf();
    }, MAX_AGE_TOKEN, android.os.SystemClock.uptimeMillis() + limit);
  }

  /**
   * 铃声：应用自播，走 `STREAM_ALARM`（`USAGE_ALARM` + `CONTENT_TYPE_SONIFICATION`）。
   *
   * 这正是 AOSP DeskClock `AlarmKlaxon` 的做法 —— 铃声由应用持有，
   * 通知只是状态栏的副产物。旧实现把它交给通知，换来「界面被收掉声音还在」，
   * 却在无通知权限时连声音一起失去（代价大于收益，D59 已推翻）。
   */
  private boolean startRingtone(String trace) {
    // 换投递时必须先释放旧 player：`play()` 无条件 `new MediaPlayer()` 并覆盖字段，
    // 旧的那个仍在循环却已失去引用 —— 既停不掉也释放不掉，表现为两路铃声叠加。
    // 这与 AlarmActivity N-02 记下的是同一个坑，只是搬到了服务里，同样必须幂等。
    releasePlayer();
    try {
      play(alarmUri());
      return true;
    } catch (Exception error) {
      AlarmTrace.record(this, trace, "ringSoundFailed", "primary: " + error.toString());
      releasePlayer();
      try {
        play(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));
        return true;
      } catch (Exception fallback) {
        AlarmTrace.record(this, trace, "ringSoundFailed", "fallback: " + fallback.toString());
        releasePlayer();
        return false;
      }
    }
  }

  private void play(Uri uri) throws Exception {
    player = new MediaPlayer();
    player.setAudioAttributes(new AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build());
    player.setOnErrorListener((mp, what, extra) -> {
      AlarmTrace.record(this, null, "ringSoundError", "async what=" + what + ";extra=" + extra);
      return false;
    });
    player.setDataSource(this, uri);
    player.setLooping(true);
    player.prepare();
    player.start();
  }

  /** 振动：应用自调，波形 + `repeat=0`（一直振到被停）。不再依赖通知渠道的振动属性。 */
  private boolean startVibration(String trace) {
    try {
      // 换投递时先撤掉旧波形，否则旧波形会按自己的节奏继续振（它与新波形互不感知）
      if (vibrator != null) vibrator.cancel();
      vibrator = obtainVibrator();
      if (vibrator == null || !vibrator.hasVibrator()) return false;
      long[] pattern = { 0, 800, 400, 800, 600 };
      if (Build.VERSION.SDK_INT >= 26) {
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
      } else {
        vibrator.vibrate(pattern, 0);
      }
      return true;
    } catch (Exception error) {
      AlarmTrace.record(this, trace, "ringVibrateFailed", error.toString());
      return false;
    }
  }

  /** R3：minSdk 22 —— `VibratorManager` 是 API 31+，低版本回落到 `VIBRATOR_SERVICE` */
  private Vibrator obtainVibrator() {
    if (Build.VERSION.SDK_INT >= 31) {
      Object svc = getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
      VibratorManager vm = svc instanceof VibratorManager ? (VibratorManager) svc : null;
      return vm == null ? null : vm.getDefaultVibrator();
    }
    Object svc = getSystemService(Context.VIBRATOR_SERVICE);
    return svc instanceof Vibrator ? (Vibrator) svc : null;
  }

  private void recordCarrier(String trace, boolean sound, boolean vibrate, boolean foreground) {
    try {
      getSharedPreferences(AlarmActivity.PREFS, Context.MODE_PRIVATE).edit()
        .putString(AlarmTestReceiver.KEY_CARRIER_SOUND, sound ? "native" : "none")
        .putString(AlarmTestReceiver.KEY_CARRIER_VIBRATE, vibrate ? "native" : "none")
        .putBoolean(AlarmTestReceiver.KEY_CARRIER_FGS, foreground)
        .putLong(AlarmTestReceiver.KEY_CARRIER_AT, System.currentTimeMillis())
        // 归属：这份载体记录属于**哪一次投递**。缺了它，读取方只能按时间先后猜，
        // 而两条同刻的闹钟时钟谁先跑并不确定（服务先跑时会被误判成陈旧值）。
        .putString(AlarmTestReceiver.KEY_CARRIER_TRACE, trace == null ? "" : trace)
        .apply();
    } catch (Exception ignored) {}
    AlarmTrace.record(this, trace, "carrierRecorded",
      "sound=" + (sound ? "native" : "none") + ";vibrate=" + (vibrate ? "native" : "none")
        + ";foreground=" + foreground);
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

  /**
   * 前台身份必须有一张通知。这张是**静音、低优先级**的占位（IMPORTANCE_MIN），
   * 与闹钟通知（`attention-alarm-v4`）不是同一条 —— D59 之后它不再承载声音与振动，
   * 只是「服务在跑」的合法凭据。无通知权限时它不显示，服务照常运行。
   */
  private Notification ringNotification(String title) {
    Object nmObj = getSystemService(NOTIFICATION_SERVICE);
    NotificationManager nm = nmObj instanceof NotificationManager ? (NotificationManager) nmObj : null;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null
      && nm.getNotificationChannel(CHANNEL_ID) == null) {
      NotificationChannel channel = new NotificationChannel(
        CHANNEL_ID, "闹钟送达护航", NotificationManager.IMPORTANCE_MIN);
      channel.setDescription("闹钟响铃期间短暂出现；无声、无振动（声音由应用自己播）");
      channel.setShowBadge(false);
      channel.setSound(null, null);
      channel.enableVibration(false);
      nm.createNotificationChannel(channel);
    }
    return new NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle("闹钟正在响")
      .setContentText(title)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setOngoing(true)
      .build();
  }

  @Override
  public void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    stopRinging();
    if (instance == this) instance = null;
    super.onDestroy();
  }

  /** 真正停掉声振。`onDestroy` 是唯一收口点 —— 所有停铃路径最终都汇到这里。 */
  private void stopRinging() {
    ringing = false;
    ringingTrace = null;
    releasePlayer();
    try {
      if (vibrator != null) vibrator.cancel();
    } catch (Exception ignored) {}
    vibrator = null;
    try { stopForeground(true); } catch (Exception ignored) {}
  }

  private void releasePlayer() {
    try {
      if (player != null) {
        if (player.isPlaying()) player.stop();
        player.release();
      }
    } catch (Exception ignored) {}
    player = null;
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
