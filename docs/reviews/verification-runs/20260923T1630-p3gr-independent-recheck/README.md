# P3-G-R 独立复验

**结论：PASS_WITH_LIMITATIONS。** 当前候选 `releases/candidates/20260923T1605-p3gr-candidate/app-debug.apk` 的交付身份、模块回归、全屏原生响铃和屏幕坐标触发的活动面板按钮路径均获独立证据支持。自然用户路径中，Web 弹条覆盖活动面板时如何进入面板，本轮没有证明；跨版本离线 SW 升级仍归 P4。

## 身份与源码

- HEAD 与 origin/main 均为 `3574824357dc7beb04cbd3e32aa413cd508e8484`；工作区原有脏条目保留。未修改产品源码、旧候选、旧证据，未提交或推送。
- 当前候选及设备在机 `base.apk` SHA-256 均为 `6f224876ab431ee281c1061202299e232bca0bf8844a06f194b34c0b2bd8ee82`。
- `app-core.js` 为 `8b7ea24032bf187befdb7fb7f85df89c65306346fde4f58f911eecb83a047bac`；`lib/app-alerts.js` 为 `3523164453158ed80a54ecde6e61bcf008449bb053df3b8d96c0980ff53e5bb3`；`sw.js` 为 `3f2a75a68533e27f91c6a01e9035d36e149d6e21a38cc70f129ec2e698fa1f51`，缓存名 `attention-inbox-v34`。
- 独立读取源码、www、Android assets、构建中间层、候选 APK 内的 34 项 Web 资源，逐项 SHA-256 相同、0 mismatch。旧 `1405` 路径已在 15:16 被覆盖的事实保留，新的 `1605` 路径没有与旧身份混同。

## 独立自动化

- `npm test` 退出 0：六套 642 / 324 / 890 / 266 / 730 / 160，共 3012 项，失败 0；原始输出在 `npm-test.log`。
- 旧 `repro-alerts-gaps.js` 退出 0：重复绑定一个 listener/一次提示，拒绝保存不提示成功；`old-counterexamples.log`。
- P3-G 专项与四条变异退出 0；`p3g-unit-mutations.log`。Chrome 真浏览器弹条/面板检查退出 0；`browser-alerts.log`。`git diff --check`、两份 JS 语法检查退出 0。
- 独立 `check-save-receipt.js` 的真实受抑制形态 `save() => undefined` 返回 false、无成功 toast；拒绝 Promise 同样如此。源码生产装配中 `app-core.js:1986` 只会在受抑制时返回 undefined，正常 `appPersistence.save()` 返回 Promise，权威写入成功解析为 true，失败拒绝。
- **实施报告的回执表述应更正**：`lib/app-alerts.js:185-193` 并未强制“必须获得合法 Promise”；同步 `true` 或兑现为 `false` 的 Promise 在独立夹具中仍会报成功，见 `save-receipt.log`。当前生产 `save()` 契约不产生这两种返回值，因此未将此夹具外形态判为已证实的用户故障。实施报告引用的旧 `probe-suppressed-save.js` 现存内容模拟 `save() => Promise.resolve(true)`，其绿灯本身也不能证明受抑制分支；本轮由新探针和正式单测补证。

## 独立真机

- vivo V2238A，serial `10ACBF2D3D000RS`，Android 16；本轮未安装/改包，未调整 AppOps。既有 `SCHEDULE_EXACT_ALARM`、`SYSTEM_ALERT_WINDOW` 为 allow，结论仅适用于该权限环境。
- 隔离事项 `independent_p3gr_panel_1790152731` 到期后，`independent-alarm-triggered.png` 显示同名全屏闹钟。台账同一 token `1354945827:53f1fa3a-9ffe-4b09-895d-7e4c6dff06d5` 有 `ringStarted`、`received`、`windowVisible`；同一时刻音频转储有 `USAGE_ALARM state:started`，振动转储有 `CurrentVibration status=running`。
- `#activeAlarmPanel` 渲染了同一事项和“完成事项”按钮。Web 弹条仍显示时，按钮中心的 `elementFromPoint` 命中覆盖层 DIV；本轮用 `A.alerts.hideAlert()` **仅隐藏视觉弹条**，保持事项 rev 与闹钟 token 不动，之后截图 `independent-panel-exposed.png` 可见卡片，命中测试为 BUTTON。
- 从 UIAutomator 读取 WebView 屏幕起点 `[0,120]`，将 CSS 坐标与设备像素比换算后，用 `adb shell input tap 526 686` 触发真实屏幕命中路径，未调用 `completeActiveAlarm()` 或 DOM `.click()`。结果事项 `archived`、该事项活动闹钟 0、面板隐藏；`independent-panel-after-tap.png` 及 `device-panel-retry.log`。之后音频不再 started，`CurrentVibration: null`。
- 第一次坐标试验漏加 WebView 顶部 120px，点按未命中，`device-panel.log` 保留其 FAIL 原始输出；测试事项在 finally 中清理。修正换算后同一新候选重跑 PASS。最终独立只读检查为 `items=0, alarms=0, ready=true`；没有残留测试事项。

## 边界与后续

- 本轮面板点按使用 ADB 输入坐标，是设备 UI 命中测试；**不是人的手指脱机按压**。露出面板前使用视觉层 `hideAlert()`；“弹条覆盖时，普通用户如何进入活动面板并完成”未通过自然操作链证明，记 `NOT_PERFORMED`。原生全屏闹钟自身的“完成”按钮也不等于此面板按钮。
- `p3g-device-verify.py` 的 `delivery_ok` 仍使用 `has_alarm_trace or vibrating or audio_playing`，脚本的整体 PASS 判据比同 token 可见/声振要求宽；本独立结论依据原始截图、同 token 台账、系统声振转储和本轮屏幕坐标试验，不继承那条宽松判据。
- 旧 SW 跨版本就地升级、默认权限安装、其他设备及真实手指操作均 `NOT_PERFORMED`。本轮不以这些空项宣称 P4 或跨设备通过。
