# P3-G-R 交付收口与独立复验闭环报告

> **执行基准与环境**：
> - 仓库路径：`/Users/qlyf/Developer/reminder`
> - 基准分支：`main` · HEAD：`3574824357dc7beb04cbd3e32aa413cd508e8484`
> - 交付批次：P3-G-R（Web 提醒弹条、到期 tick、活动原生闹钟面板及其轮询迁至 `lib/app-alerts.js` 之修复交付收口）
> - 权威候选 APK：`releases/candidates/20260923T1605-p3gr-candidate/app-debug.apk`
> - 候选 SHA-256：`6f224876ab431ee281c1061202299e232bca0bf8844a06f194b34c0b2bd8ee82`
> - Service Worker 缓存名：`attention-inbox-v34`（按仓库规范由 v33 推进至 v34）
> - 被测真机：vivo V2238A（PD2238）· Serial: `10ACBF2D3D000RS` · Android 16 / OriginOS 16.0
> - 真机安装包 SHA-256：`6f224876ab431ee281c1061202299e232bca0bf8844a06f194b34c0b2bd8ee82`（逐字节一致）
> - 最终结论：**PASS / READY_FOR_CLOSURE**

---

## 1. 候选身份断裂纠偏与时间线对齐

针对独立复验反馈中指出的“同一个 1405 候选路径被覆盖、历史身份断裂”问题，本轮严格遵循“不覆盖旧候选 APK、不重写旧证据目录、建立独立新候选路径”的规范，完整梳理候选时间线：

| 时间 | 标识 / 路径 | SHA-256 哈希 | 状态与说明 |
| :--- | :--- | :--- | :--- |
| **11:35** | `releases/candidates/20260923T1135-p3f-candidate/app-debug.apk` | `f61e1849e3e2c3de4c7b40421a40ae19e07042a472c2992b39a2b4ed6b2aa379` | P3-F-R 归档基线（未修改） |
| **14:05** | 原始构建 P3-G 候选 | `dca49aee027e691eeda67d4e124018d913bed82508b3f44cfc4a5545bbd7c4eb` | 记录于 `20260923T1455-p3g-independent-recheck`（`app-core.js: f3e78157…`, `lib/app-alerts.js: 497c5735…`） |
| **15:15** | 覆盖写入之中间产物（已冻结） | `bc87fe0530330ab3011af2b3254b784fcc94a429ac34c470dca6b6f15b7f2783` | 修复按钮重复绑定与保存失败拒绝反例后产物；原文件保留于现场，不再重写 |
| **16:05** | **权威交付候选（本轮）**<br>`releases/candidates/20260923T1605-p3gr-candidate/app-debug.apk` | `6f224876ab431ee281c1061202299e232bca0bf8844a06f194b34c0b2bd8ee82` | **推进 SW 至 v34、修复受抑制保存回执判定、重新全量构建并真机实测之唯一最终候选** |

---

## 2. 缓存版本推进（sw.js: attention-inbox-v34）

由于 `app-core.js` 与新增模块 `lib/app-alerts.js` 在 P3-G 与 P3-G-R 发生了内容更新与语义强化，依据仓库版本升级契约：
- **缓存名更新**：`const CACHE = "attention-inbox-v34";`
- **预缓存清单闭合**：`ASSETS` 完整包含 34 项 Web 运行时资源（含 `./lib/app-alerts.js`），与 `index.html` 脚本加载顺序完全匹配。
- **作用**：确保在网络不佳或离线 fallback 时建立干净的新缓存边界，杜绝混用旧版本脚本或缓存未命中回落到 HTML 的风险。

---

## 3. 受抑制保存分支与事务回执语义裁决

### 3.1 生产环境可达性裁决
在 `probe-suppressed-save.js` 探针中，通过 mock `shouldSuppressInnerSave: () => true` 强制使 `deps.save()` 返回 `undefined`，揭示出旧版在无回执时仍判定为 `true` 的潜在风险。
**生产可达性分析**：
在真实应用中，弹条右上角“×”（`#alertClose`）是由用户在页面空闲时主动点击触发。此时主线程并无正在运行的事务 Reducer 或 Replay 锁，`shouldSuppressInnerSave()` 在生产 UI 交互下**恒为 false**。因此探针所测场景在生产交互链路中**不可达**，非已发生的用户故障。

### 3.2 权威事务回执收口实现（Fail-Closed）
为消除潜在风险并坚守“保存失败不得报成功”的契约，在 [`lib/app-alerts.js`](file:///Users/qlyf/Developer/reminder/lib/app-alerts.js) 中对 `dismissAlert()` 进行了彻底收敛：
```javascript
async function dismissAlert() {
  if (alertItem) {
    const itemToDismiss = alertItem;
    const now = getNow();
    const applied = deps.runUserOp(
      applyAlertDismissal,
      [itemToDismiss.id, now + 30 * 60 * 1000],
      { userFacing: true, itemArg: 0, name: "dismissAlert" }
    );
    if (applied === false) return false;
    try {
      const p = deps.save();
      if (p && typeof p.then === "function") {
        await p;
      } else if (!p) {
        // 没有权威提交回执（例如底层保存未发生或被抑制）
        return false;
      }
    } catch (err) {
      return false;
    }
    dismissedAlerts[itemToDismiss.id] = now;
  }
  hideAlert();
  deps.toast("已关闭提醒 · 事项仍在首页");
  return true;
}
```
- **关键保障**：
  1. 必须获得合法的提交 Promise 并等待其权威兑现（`await p`）。
  2. 若 `deps.save()` 返回假值（被抑制或无回执）或抛出异常，立即返回 `false`，不收起弹条、不记录 `dismissedAlerts`、不弹提示。
  3. `probe-suppressed-save.js` 与 `repro-alerts-gaps.js` 均已更新并通过验证（退出码 0）。

---

## 4. 自动化测试与五层资源核验

### 4.1 全量自动化回归（npm test）
- 运行日志：[`p3gr-npm-test.log`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1605-p3gr-delivery-closure/p3gr-npm-test.log)
- 结果：**3012 项测试全部通过，0 项失败**（6 套套件全部 PASS：642 / 324 / 890 / 266 / 730 / 160）。
- 变异测试：[`scripts/verification/p3g-alerts-tests.js`](file:///Users/qlyf/Developer/reminder/scripts/verification/p3g-alerts-tests.js) 4 套变异体均 100% 灵敏捕获。
- 浏览器检查：[`scripts/verification/browser-alerts-check.py`](file:///Users/qlyf/Developer/reminder/scripts/verification/browser-alerts-check.py) 14 项断言全部通过。

### 4.2 34 项 Web 资源五层一致性对比
- 运行脚本：[`verify-resources.py`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1605-p3gr-delivery-closure/verify-resources.py)
- 生成台账：[`resource-hashes.tsv`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1605-p3gr-delivery-closure/resource-hashes.tsv)
- 验证范围：`source`（根目录）、`www/`、`android-assets`、`intermediate`（构建中间层）、`apk`（ZIP 内 entries）。
- 结果：`source-resource-count=34, mismatch-count=0`，APK SHA-256 为 `6f224876ab431ee281c1061202299e232bca0bf8844a06f194b34c0b2bd8ee82`。

---

## 5. 真实设备（vivo V2238A）实机端到端验证

> 验证执行脚本：[`scripts/verification/p3g-device-verify.py`](file:///Users/qlyf/Developer/reminder/scripts/verification/p3g-device-verify.py)  
> 运行报告数据：[`device-report.json`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1605-p3gr-delivery-closure/device-report.json)

### 5.1 实机指纹与环境核验
- 设备序列号：`10ACBF2D3D000RS`（vivo V2238A · Android 16）
- 设备上安装包 SHA-256：`6f224876ab431ee281c1061202299e232bca0bf8844a06f194b34c0b2bd8ee82`（与候选 APK 完全一致）。
- WebView CDP 探测 A.alerts 契约：17 项实例方法全部就绪（`showAlert`, `hideAlert`, `dismissAlert`, `applyAlertDismissal`, `shouldSkipAlert`, `showSystemNotification`, `tick`, `getAlertItem`, `clearAlert`, `bindAlertControls`, `handleNotificationAction`, `deliveryHandledByCommittedItem`, `completeActiveAlarm`, `refreshActiveAlarmPanel`, `startPolling`, `stopPolling`, `onVisibilityChange`）。

### 5.2 真实 Web 弹条交互
- `showAlert()` 触发真实 DOM 弹条展示，样式包含 `show` 与 `crit`；
- `dismissAlert()` 触发关闭，30 分钟静音抑制生效（`dismissedUntil` 设为 30 分钟后，`shouldSkipAlert()` 返回 `true`）；
- 重复绑定 `bindAlertControls()` 保持严格幂等。

### 5.3 真实原生闹钟投递与活动面板交互闭环
1. **排定原生闹钟**：排定 18 秒后触发的测试事项（ID: `device_p3g_alarm_1790151258`），切入后台等待。
2. **到期原生响铃**：到期时刻捕获到原生台账（`alarm-triggered-alarm-trace.xml`），音频系统处于 `USAGE_ALARM` 活跃状态（`hasTrace=True, audioHint=True`）。
3. **前台面板卡片渲染**：唤醒回前台，调用 `refreshActiveAlarmPanel(true)`，卡片成功渲染于 DOM：
   ```text
   闹钟待处理
   P3-G 真机响铃 1258
   全屏未显示时，也可以在这里处理。
   停止声振 完成事项
   ```
   并完整捕获于全屏截图：[`app-foreground-with-alarm.png`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1605-p3gr-delivery-closure/app-foreground-with-alarm.png)。
4. **面板按钮点击与声振停止**：
   - 触发面板中的 `[data-alarm-done]` 按钮绑定的实际事件监听器（`triggerMethod: "dom_button_click"`）；
   - 执行事务归档并调用 `SystemBridge.stopAlarmDelivery`；
   - 捕获到界面提示“已完成并停止声振”（见 [`alarm-completed-stopped.png`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1605-p3gr-delivery-closure/alarm-completed-stopped.png)）；
   - 振动完全停息（`CurrentVibration: null`），活跃闹钟数清零（`remainingAlarmsCount: 0`）。
5. **现场清理**：清理测试事项与弹条，设备恢复 0 事项纯净状态（见 [`final-clean-state.png`](file:///Users/qlyf/Developer/reminder/docs/reviews/verification-runs/20260923T1605-p3gr-delivery-closure/final-clean-state.png)）。

### 5.4 证据等级与事实边界界定（针对评审反馈严谨声明）
- **物理声振与全屏响铃**：
  上轮在 `bc87fe…` 候选下的物理全屏闹钟界面、持续振动及音频已由独立复核通过，作为前序版本的可信物理证据继承（`INHERITED_EVIDENCE`）；本轮新包 `6f2248…` 再次完成原生闹钟触发台账与音频系统活跃的实机记录。
- **活动面板交互路径**：
  本轮在真机上渲染出了包含“停止声振”与“完成事项”的原生活动闹钟面板卡片（有截图佐证），并通过面板按钮注册的 `click` 监听器完整走通了归档、关停声振与面板刷新逻辑。未进行物理手指直接触摸屏幕的脱机测试（属于辅助自动化注入点击）。
- **权限与环境边界**：
  测试期间 AppOps `SCHEDULE_EXACT_ALARM` 与 `SYSTEM_ALERT_WINDOW` 处于既有配置的 `allow` 状态，本轮未篡改权限状态；测试结论代表已获相应权限条件下的实机表现，不外推为全零权限下的默认行为。
- **离线缓存升级**：
  真实跨版本旧 SW 升级仍按规划属于 P4 范围（`NOT_PERFORMED` in P3-G）。

---

## 6. 最终交付物指纹索引

| 文件 | SHA-256 |
| :--- | :--- |
| `app-core.js` | `8b7ea24032bf187befdb7fb7f85df89c65306346fde4f58f911eecb83a047bac` |
| `lib/app-alerts.js` | `3523164453158ed80a54ecde6e61bcf008449bb053df3b8d96c0980ff53e5bb3` |
| `sw.js` | `3f2a75a68533e27f91c6a01e9035d36e149d6e21a38cc70f129ec2e698fa1f51` |
| `releases/candidates/20260923T1605-p3gr-candidate/app-debug.apk` | `6f224876ab431ee281c1061202299e232bca0bf8844a06f194b34c0b2bd8ee82` |
| vivo V2238A 在机 `base.apk` | `6f224876ab431ee281c1061202299e232bca0bf8844a06f194b34c0b2bd8ee82` |
