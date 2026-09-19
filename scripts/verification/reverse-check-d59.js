#!/usr/bin/env node
/**
 * D59 反向验证：把每处修复**按语义回退**，断言必须变红；恢复后必须变绿。
 *
 * 覆盖范围：D59 / D64 / D68（脚本名沿用首轮建立时的 D59，未改名以免打乱既有引用）。
 *
 * ## 为什么必须有这个脚本
 *
 * 这个项目已经在这件事上栽过两次，两次都是「断言全绿，但代码是错的」：
 *
 * 1. **源码级正则挡不住语义回退**。H-08 阶段实测：把 `if (x === false)` 改成
 *    `if (false && x === false)`，正则 `/x === false/` 照样命中、断言照样绿。
 * 2. **反向断言（「不得出现某字符串」）有个更隐蔽的陷阱**：文件读错、内容为空时
 *    它**也会通过** —— 看起来一样绿。所以本轮每条反向断言都配了长度哨兵，
 *    而本脚本进一步用「真的回退一次」来证明它抓得住。
 *
 * 因此：凡是本轮新增的防护，都要在这里留下一条**能被证伪**的记录。
 * 断言绿不是证据，「回退即红」才是。
 *
 * ## 用法
 *
 * ```
 * node scripts/verification/reverse-check-d59.js
 * ```
 *
 * 退出码 0 = 全部符合预期（每条回退都如期变红）。任何一条没变红 = 该断言是**假防护**。
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const JAVA = "android/app/src/main/java/space/alliswell/inbox";
const MANIFEST = "android/app/src/main/AndroidManifest.xml";

/**
 * 每条：把 `from` 换成 `to`（模拟语义回退）→ 跑 `suite` → 期望 `expect` 这条断言失败。
 *
 * 所有 `from` 都必须是**当前文件里真实存在**的片段；不存在就直接报错，
 * 否则「改不动」会被误当成「改动了也没变红」，那是假阴性。
 */
const cases = [
  {
    name: "T2 声音回到通知：FLAG_INSISTENT 复活",
    file: path.join(JAVA, "AlarmTestReceiver.java"),
    from: "        Notification notification = builder.build();\n",
    to: "        Notification notification = builder.build();\n        notification.flags |= Notification.FLAG_INSISTENT;\n",
    suite: "native",
    expect: "D59 闹钟通知不再带 FLAG_INSISTENT",
  },
  {
    name: "T2 振动回到通知：setDefaults(DEFAULT_ALL) 复活",
    file: path.join(JAVA, "AlarmTestReceiver.java"),
    from: "        .setOngoing(false);\n      // D59：**刻意不调",
    to: "        .setOngoing(false)\n        .setDefaults(NotificationCompat.DEFAULT_ALL);\n      // D59：**刻意不调",
    suite: "native",
    expect: "D59 闹钟通知不再 setDefaults(DEFAULT_ALL)",
  },
  {
    name: "T2 渠道音复活（渠道属性创建后不可改，旧渠道未退役）",
    file: path.join(JAVA, "AlarmTestReceiver.java"),
    from: "    channel.setSound(null, null);",
    to: "    channel.setSound(android.media.RingtoneManager.getDefaultUri(4), null);",
    suite: "native",
    expect: "D59 渠道无声音无振动",
  },
  {
    name: "T1 前台服务类型退回 shortService（有硬性时长上限）",
    file: path.join(MANIFEST),
    from: 'android:foregroundServiceType="mediaPlayback"',
    to: 'android:foregroundServiceType="shortService"',
    suite: "native",
    expect: "D59 Manifest 声明 mediaPlayback",
  },
  {
    name: "T6 停铃收口缺失：撤通知但不停服务（铃声关不掉）",
    file: path.join(JAVA, "ActiveAlarmStore.java"),
    from: "    AlarmRingService.requestStop(context);\n",
    to: "",
    suite: "native",
    expect: "D59 停铃收口",
  },
  {
    name: "T7 界面重新自己判定「通知是否持有声音」（双声源回来了）",
    file: path.join(JAVA, "AlarmActivity.java"),
    from: "    if (AlarmRingService.isRinging()) {",
    to: "    if (notificationOwnsSoundFallback() && AlarmRingService.isRinging()) {",
    suite: "native",
    expect: "D59 界面不再自己判断",
  },
  {
    name: "T5 载体归属改用「总是新鲜」的时间戳判据（服务先跑时误判）",
    file: path.join(JAVA, "SystemBridgePlugin.java"),
    from: "      boolean carrierFresh = !deliveryTrace.isEmpty() && deliveryTrace.equals(carrierTrace);",
    to: "      boolean carrierFresh = true;",
    suite: "native",
    expect: "D59 载体陈旧时回 unknown",
  },
  {
    name: "T1 起响铃服务挪到拉界面之后（「响」被「亮」的失败连带）",
    file: path.join(JAVA, "AlarmTestReceiver.java"),
    from: "      startRingService(context, intent, trace);\n",
    to: "",
    suite: "native",
    expect: "D59 投递侧先起响铃服务再拉界面",
  },
  {
    name: "JS 归因：载体已确认时仍报「无通知权限」（把「响了但没亮屏」反着报）",
    file: "app-core.js",
    from: '      const carrierKnown = d.carrierSound === "native" || d.carrierSound === "activity";',
    to: "      const carrierKnown = false;",
    suite: "smoke",
    expect: "D59 载体为前台服务时 label 改为「已响未亮」",
  },
  {
    name: "JS 归因：文案退回「整个闹钟哑了」的说法",
    file: "app-core.js",
    from: '"铃声与振动由界面回落自播"',
    to: '"（载体信息缺失）"',
    suite: "smoke",
    expect: "D59 界面回落自播也算「已响」",
  },

  // ── D64 两条上架门禁（2026-09-19）───────────────────────────────────────────
  //
  // 门禁类改动最容易变成「文档说改了、实际没改」：清单里少一行、接收器没注册、
  // 归因又读回活值 —— 三种都不会报错，只会安静地退回原状。所以逐条留证。
  {
    name: "D64 受限权限复活：清单重新声明 USE_EXACT_ALARM（Play 拒审风险）",
    file: path.join(MANIFEST),
    from: '    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />',
    to: '    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />\n'
      + '    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />',
    suite: "native",
    expect: "D64 清单只声明 SCHEDULE_EXACT_ALARM，不再声明受限的 USE_EXACT_ALARM",
  },
  {
    name: "D64 权限变更接收器从清单消失（授权后不再自动重排）",
    file: path.join(MANIFEST),
    from: 'android:name=".ExactAlarmPermissionReceiver"',
    to: 'android:name=".NoSuchReceiver"',
    suite: "native",
    expect: "D64 注册精确闹钟权限变更接收器（官方迁移清单第 4 步：授权后重排）",
  },
  {
    name: "D64 接收器把「收到广播」当成「已授权」（不实测就重排）",
    file: path.join(JAVA, "ExactAlarmPermissionReceiver.java"),
    from: "        boolean granted = AlarmScheduler.canScheduleExactAlarms(appContext);",
    to: "        boolean granted = true;",
    suite: "native",
    expect: "D64 接收器以实测值为准再重排（不把「收到广播」当成「已授权」）",
  },
  {
    name: "D64 排程不再先查权限，退回「只靠 try/catch 兜」（静默降级的老路）",
    file: path.join(JAVA, "AlarmScheduler.java"),
    from: "    boolean exactPerm = canScheduleExactAlarms(context);",
    to: "    boolean exactPerm = Build.VERSION.SDK_INT >= 21;",
    suite: "native",
    expect: "D64 精确闹钟权限先查再排（不再只靠 try/catch 兜）",
  },
  {
    name: "D64 解冻器把非精确形态记成 allow-while-idle（假装两种等价）",
    file: path.join(JAVA, "AlarmScheduler.java"),
    from: '        mode = "inexactIdle";',
    to: '        mode = "allowWhileIdle";',
    suite: "native",
    expect: "D64 解冻器三种形态各自如实记 mode，不假装等价",
  },
  {
    name: "D64 闹钟时钟位排程失败又被静默吞掉（不留痕）",
    file: path.join(JAVA, "AlarmScheduler.java"),
    from: '        AlarmTrace.record(context, trace, "alarmClockFailed", error.toString());',
    to: "        // 悄悄吞掉",
    suite: "native",
    expect: "D64 闹钟时钟位排程失败要留痕，不再 catch (Exception ignored) 吞掉",
  },
  {
    name: "D64 投递台账丢掉精确闹钟快照（只剩通知一项）",
    file: path.join(JAVA, "AlarmTestReceiver.java"),
    from: "        .putBoolean(KEY_DELIVERY_EXACT_ON, canScheduleExactAlarmsNow(context))\n",
    to: "",
    suite: "native",
    expect: "D64 投递时快照精确闹钟与全屏意图两项权限（同 H-08：不能用「现在」解释「当时」）",
  },
  {
    name: "D64 快照缺键时默认成「没权限」（老记录升级后被凭空指控）",
    file: path.join(JAVA, "SystemBridgePlugin.java"),
    from: '      r.put("exactAtDelivery", sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_EXACT_ON, true));',
    to: '      r.put("exactAtDelivery", sp.getBoolean(AlarmTestReceiver.KEY_DELIVERY_EXACT_ON, false));',
    suite: "native",
    expect: "D64 两个快照默认 true（老 APK 记录缺键，不得凭空变成「没权限」）",
  },
  {
    name: "D64 归因退回读活值（用户事后改权限就能反转历史结论）",
    file: "app-core.js",
    from: "    const fsiAt = d.fsiAtDelivery !== undefined\n"
      + "      ? d.fsiAtDelivery !== false\n"
      + "      : d.canUseFullScreenIntent !== false;",
    to: "    const fsiAt = d.canUseFullScreenIntent !== false;",
    suite: "smoke",
    expect: "D64 快照说「缺全屏通知权限」时，活值说「有」也不得盖过它",
  },
  {
    name: "D64 老记录回退被写死成 true（缺快照键的记录不再按活值判断）",
    file: "app-core.js",
    from: "      : d.canUseFullScreenIntent !== false;\n",
    to: "      : true;\n",
    suite: "smoke",
    expect: "D64 老记录（无快照键）回退读活值，既有结论不变",
  },
  {
    name: "D64 非精确提示被短路（复刻本项目已记录过的 false && x === false 手法）",
    file: "app-core.js",
    from: "    const exactNote = d.exactAtDelivery === false",
    to: "    const exactNote = false && d.exactAtDelivery === false",
    suite: "smoke",
    expect: "D64 投递时无精确闹钟权限 → 归因里明说是「非精确」排程",
  },
  {
    name: "D64 非精确提示变成无条件（精确排程也被误报）",
    file: "app-core.js",
    from: '      ? " · 本次为「非精确」排程（缺「闹钟和提醒」权限），到达时刻可能被系统推迟"\n      : "";',
    to: '      ? " · 本次为「非精确」排程（缺「闹钟和提醒」权限），到达时刻可能被系统推迟"\n'
      + '      : " · 本次为「非精确」排程（缺「闹钟和提醒」权限），到达时刻可能被系统推迟";',
    suite: "smoke",
    expect: "D64 负向对照：精确排程时不得凭空出现非精确提示",
  },

  /* ── D68（2026-09-19）：自动静音上限 · 首页硬告知 · 全屏意图用途说明 ──────────
   *
   * 这三条都是「界面看起来一切正常、缺陷却已经回来了」的类型，所以格外需要
   * 「回退即红」的证明 —— 尤其 A-2：它的失败形态恰恰是**什么都不显示**，
   * 光看断言全绿根本分不出「实现正确」和「渲染被短路」。 */
  {
    name: "D68/A-1 自动静音上限被拉回 6h（等于没做，仍是停不下来的那 6 小时）",
    file: path.join(JAVA, "AlarmRingService.java"),
    from: "  static final long AUTO_SILENCE_MS = 5L * 60L * 1000L;",
    to: "  static final long AUTO_SILENCE_MS = 6L * 60L * 60L * 1000L;",
    suite: "native",
    expect: "D68/A-1 自动静音上限存在，且远小于 6h 的 MAX_AGE 兜底",
  },
  {
    name: "D68/A-1 静音到点先停声再落盘（界面回落会在静音之后把铃声重新播起来）",
    file: path.join(JAVA, "AlarmRingService.java"),
    from: "      markAutoSilenced(trace);\n      AlarmTrace.record(this, trace, \"ringAutoSilenced\",",
    to: "      stopSelf();\n      markAutoSilenced(trace);\n      AlarmTrace.record(this, trace, \"ringAutoSilenced\",",
    suite: "native",
    expect: "D68/A-1 静音到点先落盘「已静音」再停声（顺序反了会被界面回落自播重新播起来）",
  },
  {
    name: "D68/A-1 重复启动分支重新 arm 静音计时（两条同刻排程把静音窗口往后推）",
    file: path.join(JAVA, "AlarmRingService.java"),
    from: "      AlarmTrace.record(this, trace, \"ringDuplicateStart\", \"same delivery already ringing; kept as-is\");\n      scheduleMaxAge(trace, intent.getLongExtra(EXTRA_MAX_RING_MS, ActiveAlarmStore.MAX_AGE_MS));",
    to: "      AlarmTrace.record(this, trace, \"ringDuplicateStart\", \"same delivery already ringing; kept as-is\");\n      scheduleAutoSilence(trace, intent.getLongExtra(EXTRA_AUTO_SILENCE_MS, AUTO_SILENCE_MS));\n      scheduleMaxAge(trace, intent.getLongExtra(EXTRA_MAX_RING_MS, ActiveAlarmStore.MAX_AGE_MS));",
    suite: "native",
    expect: "D68/A-1 「同一次投递重复启动」分支不重新 arm 静音计时（否则静音窗口被往后推）",
  },
  {
    name: "D68/A-1 界面回落不再看「是否已自动静音」（5 分钟上限被界面自己推翻）",
    file: path.join(JAVA, "AlarmActivity.java"),
    from: "    if (AlarmRingService.wasAutoSilenced(this, token)) {\n      stopLocalFallback();\n      recordFallbackCarrier(\"none\");\n      return;\n    }\n",
    to: "",
    suite: "native",
    expect: "D68/A-1 界面回落自播前先查「本次投递是否已自动静音」",
  },
  {
    name: "D68/A-2 首页告知条渲染被整段短路（判定还在，界面却什么都不显示）",
    file: "app-core.js",
    from: "  function renderHomeNotice() {\n    const host = $(\"#homeNotice\");\n    if (!host) return;",
    to: "  function renderHomeNotice() {\n    if (true) return;\n    const host = $(\"#homeNotice\");\n    if (!host) return;",
    suite: "smoke",
    expect: "A-2 权限被撤销后：首页 DOM 里真的出现告知条（带 data-notice-kind）",
  },
  {
    name: "D68/A-2 状态漏斗不再刷新首页（权限恢复后警告一直挂着 = 新的「界面在撒谎」）",
    file: "app-core.js",
    from: "    // 于是「恢复权限后警告自动消失 / 撤销后自动出现」都无需另建通路（基线 §473 后半句）。\n    renderHomeNotice();\n",
    to: "    // 于是「恢复权限后警告自动消失 / 撤销后自动出现」都无需另建通路（基线 §473 后半句）。\n",
    suite: "smoke",
    expect: "A-2 权限被撤销后：首页 DOM 里真的出现告知条（带 data-notice-kind）",
  },
  {
    name: "D68/A-2 断链消失时不清空（拿新误报换旧误报：权限好了警告还在）",
    file: "app-core.js",
    from: "    const v = homeNoticeVerdict(nativeReminderStatus, state.settings, isNativeAndroidRuntime());\n    if (!v) {\n      host.innerHTML = \"\";\n      return;\n    }",
    to: "    const v = homeNoticeVerdict(nativeReminderStatus, state.settings, isNativeAndroidRuntime());\n    if (!v) {\n      return;\n    }",
    suite: "smoke",
    expect: "A-2 权限恢复后：同一条通路把告知条自动清掉（基线 §473 后半句）",
  },
  {
    name: "D68/A-2 「还没问过」被当成「没有」（冷启动那几秒凭空弹警告）",
    file: "app-core.js",
    from: "    if (s.notifications === \"denied\") {\n      return {\n        kind: \"permission\",",
    to: "    if (s.notifications === \"denied\" || s.notifications === \"unknown\") {\n      return {\n        kind: \"permission\",",
    suite: "smoke",
    expect: "A-2 状态未定（unknown）不得出声",
  },
  {
    name: "D68/Q6 全屏意图的「需要说明」被删（政策要求的明确说明又缺失）",
    file: MANIFEST,
    from: "      【为什么需要】本应用的核心承诺是「到点的提醒一定送到用户眼前」。",
    to: "      本应用会用到全屏意图。",
    suite: "native",
    expect: "D68/Q6 清单里写明该权限的用途与不用途（政策要的「明确说明需求」）",
  },
];

const SUITES = {
  native: { args: ["test-native-reminders.js"], label: "native" },
  smoke: { args: ["test-smoke.js"], label: "smoke" },
};

let pass = 0;
const failures = [];

for (const c of cases) {
  const abs = path.join(ROOT, c.file);
  const original = fs.readFileSync(abs, "utf8");
  if (!original.includes(c.from)) {
    failures.push(`${c.name}\n    ↳ 篡改锚点不存在，无法验证（断言可能是假防护）: ${JSON.stringify(c.from.slice(0, 60))}`);
    console.log(`  ✗ ${c.name} —— 锚点不存在，无法回退`);
    continue;
  }

  fs.writeFileSync(abs, original.replace(c.from, c.to));
  let output = "";
  let ran = true;
  try {
    output = execFileSync("node", SUITES[c.suite].args, { cwd: ROOT, encoding: "utf8" });
  } catch (error) {
    // 测试脚本以非零码退出也是一种「变红」，但这里要看的是**具体哪条**断言失败
    output = String(error.stdout || "") + String(error.stderr || "");
    ran = false;
  } finally {
    fs.writeFileSync(abs, original);
  }

  const failed = output.includes("- " + c.expect);
  if (failed) {
    pass++;
    console.log(`  ✓ ${c.name} —— 回退后「${c.expect}」如期变红`);
  } else if (!ran && !output.trim()) {
    failures.push(`${c.name}\n    ↳ ${c.suite} 套件整体崩溃且无输出，无法判定`);
    console.log(`  ✗ ${c.name} —— 套件崩溃，无法判定`);
  } else {
    failures.push(`${c.name}\n    ↳ 回退后断言「${c.expect}」**仍然是绿的** —— 它是假防护`);
    console.log(`  ✗ ${c.name} —— 断言仍是绿的（假防护）`);
  }
}

// 恢复后必须整体回到全绿 —— 否则说明上面的「恢复」没写回去（会污染工作区）
console.log("\n恢复后复跑两套，确认工作区干净：");
for (const key of Object.keys(SUITES)) {
  let out = "";
  try {
    out = execFileSync("node", SUITES[key].args, { cwd: ROOT, encoding: "utf8" });
  } catch (error) {
    out = String(error.stdout || "") + String(error.stderr || "");
  }
  const line = (out.match(/通过:\s*\d+\s+失败:\s*\d+/) || [])[0] || "(未取到汇总)";
  const ok = !/失败:\s*[1-9]/.test(line);
  if (!ok) failures.push(`恢复后 ${key} 未回到全绿：${line}`);
  console.log(`  ${ok ? "✓" : "✗"} ${key}: ${line}`);
}

console.log(`\n========== 反向验证 ==========\n通过: ${pass} / ${cases.length}  失败: ${failures.length}`);
if (failures.length) {
  console.log("\n以下回退**没有**让断言变红，说明对应断言的保护力不足：");
  failures.forEach(f => console.log("  - " + f));
  process.exit(1);
}
console.log("每条回退都如期变红，恢复后全绿。");
