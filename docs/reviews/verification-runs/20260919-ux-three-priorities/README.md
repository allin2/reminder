# 证据索引：`20260919-ux-three-priorities`

本轮实现与自测（用户级）产生的原始证据。**只新增，未覆盖任何既有证据目录。**

## 目录

| 路径 | 内容 | 层级 |
|---|---|---|
| `BASELINE.txt` | 开工时的分支/HEAD/dirty 清单/任务相关文件 sha256，以及收工时的源码 sha256 | 环境事实 |
| `web/` | Web 运行层取证：`drive.cjs`（零依赖 CDP 驱动器）+ 12 张场景截图 + `results.json`（59 条断言，逐条含实测值） | Web 运行 |
| `device/` | 真机只读取证：`probe.cjs` + `device-probe-results.json`（9 条断言）+ `apk-identity.txt` + 三份 `apksigner --print-certs` 输出 | 当前候选真机 |

## 复现命令

```bash
# Web 运行层（会自己起静态服务器 :8899 与无头 Chrome :9333，结束即清理）
node docs/reviews/verification-runs/20260919-ux-three-priorities/web/drive.cjs \
     docs/reviews/verification-runs/20260919-ux-three-priorities/web

# 真机只读探针（先建好 WebView 端口转发；只读，不点击、不建事项、不触发提醒）
ADB=~/Library/Android/sdk/platform-tools/adb
PID=$($ADB shell pidof space.alliswell.inbox | tr -d '\r')
$ADB forward --remove tcp:9223
$ADB forward tcp:9223 localabstract:webview_devtools_remote_$PID
node docs/reviews/verification-runs/20260919-ux-three-priorities/device/probe.cjs \
     docs/reviews/verification-runs/20260919-ux-three-priorities/device 9223
$ADB forward --remove tcp:9223
```

## 本轮未产生的证据（对应验收矩阵里的 NOT_PERFORMED 格）

`V18`（真机前台 / 他 App 前台 / 息屏锁屏 / 冷进程 / 30 分钟待机）、`V19`（重启恢复 / 升级 / 权限恢复）、
`V20`（ColorOS 设置落点与修复前后对照）**未执行**，原因与可复现步骤见实现报告第 4 节。

## 已知的驱动器坑（写给下一个跑这套脚本的人）

1. **面板是否打开要看 `.sheet` 自己的 `open` 类**。`show` 类挂在 `#backdrop` 上；看错类名会把「已打开」读成「没打开」。
2. **派发 `input` 与读解析结果必须是两次 `Runtime.evaluate`**。解析有 120 ms 去抖（`updateParseHint`），
   同一次 evaluate 里读到的永远是上一帧的空值。
3. **首页没有「即将到来」区块**（D5 已删除）。未来事项在「未来」页的 `#futureList` 里，
   `#homeDue` 只装「需要注意」，`#homeActive` 只装「已看到未完成」。
4. **应用内提醒浮层由 15 s 心跳 `tick()` 驱动**，不是 `renderHome()` 直接弹。制造到期事项后必须轮询 `#alertBanner.show`。
5. **无头 Chrome 在本机沙箱内必须带 `--no-sandbox`**，否则表现为「GPU process isn't usable. Goodbye.」+ CDP 握手超时。
