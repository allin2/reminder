# OPPO 闹钟无界面、无法止振修复与验收（2026-09-18）

## 结论与范围

F6c 已复现：闹钟 Activity 退出前台后，独立循环震动仍持续；独立诊断提醒没有 itemId，App 内找不到事项，也没有停止入口。原始证据位于 `verification-runs/20260918-oppo-hidden-alarm/repro/`，包括窗口、震动服务、通知、App 查询与截图。

当前修复候选 APK SHA-256：`b4eb10c410e3537a88cf0f4821d714a9d97dd1c22dfa73b5b5cf983eb7c7acfc`。版本仍为 1.0/code 1，不能仅凭版本号区分旧包。源基线 main `beeb9284a2e1f9a9ce394e4f2cbbf3d0608dc43d` 加本次未提交修改。真机 PKC130 / Android 16 / ColorOS 16，ADB serial `QSKFAE95CQEUJZ8L`。

## 修复

- 原生持久记录“已投递未停止”的闹钟，独立于未来排程和事项是否存在。
- App 顶部增加“闹钟待处理”，任何提醒均可“停止声振”；绑定当前版本事项时可“完成事项”。
- 通知增加“停止声振”，通过原生 Receiver 停止，无需依赖 WebView。
- Activity 离开前台停止自己的声振；通知可用时由系统通知统一负责，避免两个声振源。
- 完成事项先成功持久化再停止；失败可重试。旧版本闹钟不能完成新版本事项。
- 清理未来排程保留正在响的投递；ACK/稍后后的新截止提醒不被误清理。
- 停止与发布通知使用同一同步锁，防止停止后并发通知再次响起。旧 token 不能取消新投递。

## 系统条件

此前默认“智能优化后台运行”下已抓到 ColorOS 冻结/代理闹钟，AlarmManager 时间被调整 +259200000ms（观察到队列调整，并非实际等待三天）。详见 `android-oppo-close-rearm-20260918.md`。

本轮通过实际系统 UI 将本应用“耗电管理”改为“完全允许后台行为”，已保存 `battery-settings-before.xml` / `battery-settings-after.xml`。下述后台成功结果均依赖此设置，不能宣称绕过厂商冻结。没有关闭其他应用的限制。

## 自动化验证

105 + 194 + 175 + 574 = **1048 项通过**；构建成功。日志 `tests-final.log`、`sync-final.log`、`build-final.log`。

## 当前候选实机矩阵

| 场景 | 结果 | 证据目录 |
| --- | --- | --- |
| 息屏锁定，75 秒后触发 | 收到，延迟 79ms，全屏截图及 UI 四按钮可见 | current-off |
| 系统设置在前台，75 秒后触发 | 收到，延迟 59ms，全屏可见 | current-other |
| 息屏并 SIGKILL 后 75 秒冷启动 | **失败**：系统 sending alarm，但无 received/visible；须进一步核对自启动 | current-cold |
| 息屏四按钮：关闭/我知道了/稍后/完成 | **4/4 通过**，事项、通知与未来排程均符合动作语义，原用户事项不变 | current-buttons |
| 返回 App 点击“完成事项” | 实际触屏后 archived，active=[]，CurrentVibration=null | current-other/panel-result.json |

`current-off` 的关闭按钮采集曾因 Python Element 的空子节点布尔值误判跳过；只证明投递和显示，不声称该次点击关闭。已修复脚本为 `is not None`，关闭行为由后续按钮矩阵覆盖。
`current-other` 的 WebView UIAutomator 树为空，自动找按钮中断；截图能见“完成事项”，后按截图坐标实际点击，结果单独保存 `panel-result.json` 和 `panel-stopped-vibrator.txt`。这是采集脚本限制，不伪记脚本完整通过。

`fixed/`、`screenoff/`、`final-screenoff/`、`final-other/` 是中间候选证据，不能当成上述最终哈希的验收。

## 复用与边界

脚本：`scripts/verification/alarm-device-matrix.py`、`oppo-hidden-alarm.py`、`vivo-alarm-actions.py`。测试事项经 App 的 makeItem/saveAsync 数据路径创建；停止/完成按钮以实际 UI 点击验证。创建表单不是本轮覆盖范围。仅归档脚本自己的测试事项，保留用户数据。

SIGKILL 冷进程、系统强制停止、重启是不同条件。短时息屏通过不等于整夜待机或 Doze 通过。声振服务/通知状态是软件证据，不是麦克风声学测量；USB 连接和充电也是本轮环境条件。

## 暂停点（用户要求，2026-09-18）

完成手上四按钮验收后暂停，不再启动新的真机实验。当前安装的候选已保留至 `releases/安心收件箱-debug.apk`；未提交、未推送、未发布新 Release。

后续按顺序续验：

1. 核对 ADB 设备、已装 APK SHA256 与本报告一致；读取 `current-cold/framework-after.txt` 对齐触发时间 1789671131025。当前冷启动为 FAIL，不能写成通过。
2. 检查真实系统“自启动”页面。已从手机 package dump 找到 action `com.oplus.battery.permission.startup.StartupAppListActivity`（com.oplus.battery），但**尚未打开或变更自启动设置**。页面能启动与开关已开启须分别验证。当前仅确定耗电管理设为“完全允许后台行为”。
3. 自启动条件确认后复跑 `alarm-device-matrix.py ... --mode cold --lead 75`，记录前后设置并绑定相同 APK；若仍失败保留框架日志和 events，不能因系统 sending alarm 就声称应用收到。
4. 最终候选重跑孤立提醒停止入口 `oppo-hidden-alarm.py ... --fixed` 与通知按钮 `--fixed --notification`；当前候选关联事项“完成事项”已验，孤立提醒通过证据仍属于中间候选。
5. 继续较长息屏（先 5 分钟、再 30 分钟/整夜），多提醒重叠、停止后再设、重启恢复及权限/省电降级。其余未执行项目均为 NOT_PERFORMED。不要把 USB 充电短测当自然 Doze 验收。

脚本 `--panel-done` 遇 WebView 无辅助功能树时会中断；本轮手动按截图坐标完成了该项。续验时先修好采集回退，不要盲点固定坐标。测试留下的事项均为已归档的本轮测试记录，不删除用户事项或历史证据。

## 证据脱敏说明（2026-09-19 入库前）

本目录的通知转储来自 `dumpsys notification`，其中**邮件应用把账号地址嵌进了通知通道 id**
（形态 `NotificationChannel{mId='^nc_1_mail_<账号>', mName=邮件}`）。该字符串与本文任何结论无关，
但会让个人账号永久进入 git 历史，故入库前做了**字面量替换**：

- 规则与替换计数：[`verification-runs/REDACTION-MANIFEST.json`](verification-runs/REDACTION-MANIFEST.json)
  —— 含每个文件的**原始 sha256 / 脱敏后 sha256**；字面量本身只以 sha256 前缀记录，不落原文。
- 可复跑脚本：[`../../scripts/verification/redact-evidence.py`](../../scripts/verification/redact-evidence.py)
  （默认干跑，`--apply` 才写盘，`--audit` 复查残留）。
- 影响范围：**36 个 `.txt`，每个文件各 4 处**；除这两处字面量外未改动任何字节。

因此这些文件**不是逐字节的原始转储**。引用哈希时以清单中的 `redactedSha256` 为准。
