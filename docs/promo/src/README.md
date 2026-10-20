# 宣传图源文件

`docs/promo/` 下的 PNG 都由这里的 HTML 模板渲染而来；界面截图来自应用自带的示例数据（`seedAttentionInbox()`），不是手绘的 mock。

依赖：Node 22+、本机 Google Chrome。命令在本目录执行。

```bash
# 1. 另开终端在仓库根目录起静态服务：python3 -m http.server 8765
# 2. 重新截取界面（390×844 @3x，输出 shots/*-light.png）
node capture.mjs ./shots light

# 3. 渲染宣传图（参数：URL 宽 高 像素倍率 输出路径）
node render.mjs "file://$PWD/hero.html"          1280 640 2 ../hero-zh.png
node render.mjs "file://$PWD/hero.html?lang=en"  1280 640 2 ../hero-en.png
node render.mjs "file://$PWD/hero.html"          1280 640 1 ../social-preview.png
node render.mjs "file://$PWD/flow.html"          1600 1000 2 ../flow-zh.png
node render.mjs "file://$PWD/flow.html?lang=en"  1600 1000 2 ../flow-en.png
```

`social-preview.png`（1280×640，< 1 MB）用于 GitHub 仓库 Settings → General → Social preview，需要手动上传。

小红书 7 图（3:4，1620×2160，文案见 `../xiaohongshu/文案.md`）：

```bash
for p in 1 2 3 4 5 6 7; do node render.mjs "file://$PWD/xhs.html?p=$p" 1080 1440 1.5 ../xiaohongshu/0$p.png; done
```
