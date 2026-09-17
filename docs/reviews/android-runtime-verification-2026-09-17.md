# 安卓产物运行验证（2026-09-17）

> **状态更新（2026-09-17 12:40）：V1 已修复并复验通过，V2 已做最小加固。**
>
> - 修复范围：`lib/native-reminders.js`（归一 `addListener` 契约）、`app-core.js`（启动链错误隔离）。
> - 测试侧：mock 契约改为与真机一致、补 `ready() === true` 断言、新增 14 项用例（854 → **868**）。
> - 复验：`ready()` `false → true`、首启 IDB `items 0 → 7`、无 `App init failed`、无崩溃。
> - **一处更正**：下文原来的旁证 ③（Service Worker 注册数为 0）**已被推翻**，详见
>   §2「证据更正」。结论不变，但该条不再算作证据。
>
> 本节以下内容保留修复前的原始记录（除上述更正外不改写），便于对照。

结论：**安装与启动通过，运行完整性不通过。** 在模拟器上首次真正跑起来就发现一个
**P0 级、静默**的缺陷：`init()` 在 `app-core.js:5127` 同步抛出并中断，第 5129 行之后的
整条启动链（首启 seed、初始渲染、15 秒心跳、Review 排程、通知权限引导）**全部不执行**。

> 关于「为什么 854 项测试一条都没抓到」，原文归因于 mock 契约过宽；复验时进一步查明
> **决定性原因是那段注册代码在测试里从未被执行过**（详见 §2 同名小节，已更正）。

本轮（修复前）**只做验证与取证，未修改任何产品代码、依赖、配置或既有包** ——
所以上文表格里那两份产物都**不含**修复；缺陷随后在同一日按用户裁决修复（见状态更新）。

审查对象：`/Users/qlyf/Developer/reminder`，分支 `main`，
HEAD `acbe3c539c88f00d836d448dafc31addf1496c90`（`fix: harden Android reminder transactions`，2026-09-17 11:02）。

方法：先在本机装齐安卓命令行工具链并构建出**调试版与已签名发布版**两份产物
（环境与产物清单见 `docs/android-build.md`），再把产物装进 Android 14 / arm64-v8a 模拟器实测；
关键结论不靠截图肉眼判断，而是通过 **WebView DevTools 协议读取应用内部的真实 DOM、
IndexedDB 与运行期错误**获取。

---

## 1. 验证结果与边界

| 验证项 | 结果 | 手段 |
| --- | --- | --- |
| 调试版 / 发布版安装 | ✅ 均 `Success` | `adb install -r` |
| 冷启动 | ✅ `Status: ok`（1758 ms / 1209 ms） | `am start -W` |
| 前台保持 | ✅ 5s/10s/15s 三轮均在 `topResumedActivity` | `dumpsys activity` |
| WebView 渲染进程 | ✅ `sandboxed_process0` 已拉起 | `ps -A` |
| 界面真实渲染 | ✅ 截屏主导色 `#f3f4f1` 占 82.0%，与 `styles.css` 的 `--paper` 完全一致 | 截屏像素统计 |
| WebView 内 DOM | ✅ `title=安心收件箱`、`readyState=complete`、6 个脚本全加载、`window.AttentionLib=object` | CDP `Runtime.evaluate` |
| 持久化层可用 | ✅ IndexedDB `attention-inbox` v1，store `kv` | CDP 直读 |
| 页签交互 | ✅ 首页/未来/笔记/我的 视图正确切换 | CDP 点击 |
| 内存（发布版） | ✅ `TOTAL PSS 82.7 MB` | `dumpsys meminfo` |
| 崩溃 | ✅ 两版各 0 条 `FATAL EXCEPTION` | `logcat` |
| **应用初始化** | ❌ **中断**（V1）→ ✅ **修复后复验通过** | CDP 运行期错误 + 独立旁证 |

**边界**：以上全部是**模拟器**结果。真机、锁屏/休眠/进程回收/重启后的提醒投递、
通知渠道与全屏闹钟、动作按钮、真机覆盖升级，均 **NOT_PERFORMED**。
本次**未**验证此前的 R1–R8（`docs/reviews/android-prepackage-2026-09-16.md`）是否已修复。

---

## 2. V1 · P0（已修复）：首启初始化即中断，心跳与 seed 永不执行

### 位置

- 抛出点：`lib/native-reminders.js:829-831`（`onAlarmAction` 内；修复前行号）
- 调用点：`app-core.js:5126-5128`（`init()` 内；修复前行号）
- 中断点：`app-core.js:5129` 起全部不可达

```js
// app-core.js:5101
async function init() {
  ...
  const loaded = await loadAsync();
  bind();
  if (schemaMigrationNeeded) { schemaMigrationNeeded = false; save(); }
  await initializeNativeReminders();
  // D11/D12：监听全屏闹钟动作
  if (NativeReminders.onAlarmAction) {
    NativeReminders.onAlarmAction(handleAlarmAction);   // ← 5127 同步抛出
  }
  maybePromptAndroidNotify();      // ← 5129 起全部不可达
  ... registerPwa(); bindInstall(); bindNetwork();
  if (!applyShareParams()) { if (!loaded && !state.items.length) seed(); else render(); }
  ... setInterval(tick, 15000); tick(); updateAppBadge();
}
```

```js
// lib/native-reminders.js:825
if (typeof bridge.consumeAlarmAction === "function") {
  const poll = () => { drainAlarmActions(handler).catch(() => {}); };
  const app = plugin("App");
  if (app && typeof app.addListener === "function") {
    app.addListener("appStateChange", state => {     // ← 返回 {remove} 句柄，不是 Promise
      if (state && state.isActive) poll();
    }).catch(() => {});                              // ← TypeError
  }
  setTimeout(poll, 800);
}
```

### 触发

**安卓上任意一次冷启动**。不需要任何前置条件、不需要用户操作。

### 证据（三条独立旁证）

**① 运行期错误原文**（CDP 捕获 `console.error`）

```
App init failed: app.addListener(...).catch is not a function
```

**② 真实 API 契约**（CDP 在应用页面内实测 `Capacitor.Plugins.App.addListener` 的返回值）

```json
{"platform":"android",
 "plugins":["App","AppSettings","LocalNotifications","CapacitorCookies","WebView","CapacitorHttp","SystemBridge"],
 "appAddListener":{"typeOfResult":"object","isPromise":false,"hasCatch":"undefined",
                   "hasRemove":"function","ctor":"Object","keys":["remove"]}}
```

即：真实返回是**普通对象 `{remove}`**，`.catch` 为 `undefined`，`.catch()` 必然抛 `TypeError`。

修复后以同一探针复测，**返回值形状完全不变**（`isPromise:false`、`hasCatch:"undefined"`、
`keys:["remove"]`）—— 证明这是平台固有契约，而不是某次构建的偶发状态。

> **源码级根因**（修复时补证）：`@capacitor/android` 的
> `capacitor/src/main/java/com/getcapacitor/JSExport.java:57-61` 为每个原生插件注入
>
> ```js
> t.addListener = function (eventName, callback) {
>   return w.Capacitor.addListener('<pluginId>', eventName, callback);
> }
> ```
>
> 而 `native-bridge.js:187-198` 的 `cap.addListener` **同步 `return { remove: … }`**。
> 官方 `@capacitor/core` 的 `capacitor.js`（`createPluginMethodWrapper`）确实返回 Promise
> 并把 `.remove` 挂在上面，但本仓库**没有打包器**，WebView 里不存在该文件
> （APK 内 `assets/` 只有 `native-bridge.js`）—— 那条「返回 Promise」的路径在真机上根本不存在。

**③ 首启 seed 没发生** —— `app-core.js` 的 `seed()` 会写入 3 个项目与 7 条示例事项。
在**全新安装**后实测持久化状态：

```json
{"topLevelKeys":["schema","items","notes","projects","settings"],
 "itemsCount":0, "bytes":667}
```

`items` 为空。且初始页面副标题仍是静态模板的「现在需要你注意的」；
**只有在点了页签触发 `render()` 之后**，才变成正确的「现在很安静 · 可以放心忘记」。

### 证据更正：Service Worker 计数**不能**作为本缺陷的旁证

原始记录曾把「`navigator.serviceWorker.getRegistrations()` 为 0」列为旁证 ③。
**该条已撤回** —— 修复后 `ready()` 已为 `true`、`itemsCount` 已为 7，而
`getRegistrations()` **仍然是 `{count:0}`**。原因在 `app-core.js:4972`：

```js
function registerPwa() {
  if (NativeReminders.isNativeAndroid && NativeReminders.isNativeAndroid()) {
    renderPwaStatus();
    return;                       // ← 安卓原生环境下**有意跳过** Service Worker 注册
  }
  ...
}
```

即安卓 App 里 SW 本来就不注册，`count:0` 与 `init()` 是否中断无关。
V1 的成立依据是①（错误原文）、②（契约形状）、③（`itemsCount` 0 ↔ 7 的前后对照），
三条均可独立复现。

### 影响面

`app-core.js:5129-5149` 共 21 行中被跳过的、且**没有其它调用点**的能力：

| 被跳过的调用 | 后果 | 是否另有调用点 |
| --- | --- | --- |
| `setInterval(tick, 15000)` | **心跳永不启动** → `promoteDue()` 不跑，到期的未来事项**不会自动进入注意力**；`maybeReviewSession()` 也不跑 → **整理会话不会被主动开启** | 仅此一处 |
| `seed()` | 首次安装没有示例数据与项目 | 仅此一处 |
| `render()`（初始） | 冷启动界面停留在静态骨架，需用户点一下页签才正确渲染 | 仅此一处 |
| `maybePromptAndroidNotify()` | 不引导用户开启通知权限 → 提醒能力可能静默失效 | 仅此一处 |
| `scheduleNextReviewAlarm()` | 当晚整理窗口的闹钟不排（注：`4075` 另有调用点，受其它流程触发） | 另有 1 处 |
| `registerPwa()` / `bindInstall()` / `bindNetwork()` | 无 PWA、无安装引导、无断网提示 | 各仅此一处 |
| `maybeDailySummary()` / `updateAppBadge()` | 无每日摘要检查、无角标（`updateAppBadge` 另有 3 处调用） | 部分另有 |
| `handleQueryActions()` | 冷启动的深链动作不被消费 | 仅此一处 |

对一款「少记挂，不错过」的提醒产品来说，**心跳与整理会话是核心引擎**；
它失效且**不报错、不崩溃、界面照常可交互**，属于最难被发现的一类故障。

### 为什么 854 项测试一条都没抓到

**决定性原因是那段注册代码在测试里从未被任何用例执行过**；mock 契约过宽是叠加因素，
而「现成的就绪信号被丢弃」让它彻底无声。三个原因修复时都已堵住。

**原因一（决定性）：`onAlarmAction()` 从未被调用**

| 套件 | 为什么走不到那条分支 |
| --- | --- |
| `test-smoke.js` / `test-unit.js` | **完全没有装平台 mock**：沙箱里没有 `Capacitor`，`systemBridge()` 返回 null，`onAlarmAction` 第一行就 return |
| `test-regressions.js` | `createApp` 把原生模块换成 `{ ...native, isNativeAndroid: () => false }`（见其 210-212 行注释「免得 app-core 启动时自己去初始化原生链路」），且宿主 `global.Capacitor` 未安装 → 同样在 `systemBridge()` 处返回 |
| `test-native-reminders.js` | 默认 bridge mock 里**没有 `consumeAlarmAction`**，而该分支正以它为入口条件；全文件只有 F2 用例临时补上它，且 F2 直接调 `drainAlarmActions()`，**从不调 `onAlarmAction()`** |

也就是说：`lib/native-reminders.js` 里那段 `App.addListener(...).catch(...)` 是**测试覆盖的死代码**。

**原因二（叠加）：mock 契约比真机宽松**

| 文件（修复前行号） | 修复前 mock |
| --- | --- |
| `test-regressions.js:332, 368` | `async addListener() { return { async remove() {} }; }` |
| `test-native-reminders.js:44, 62` | `async addListener(name, callback) { … return { async remove() {} }; }` |

`async` 让返回值变成 Promise（`.catch` 存在），而真机是 `{remove}` 句柄。
即便分支被执行到，这个 mock 也会把异常吞掉。

> 这正是项目已有的一条约定：**平台 mock 的契约必须比真实平台更严，不能更松**。
> 本次 V1 与更早的电容桥问题都是被过宽的 mock 掩盖的。

**原因三：现成的就绪信号被丢弃**

`app-core.js:5164`（修复前）的 `startApp()` 已把 `init()` 的结果包成 `true` / `false` 的 Promise，
`test-smoke.js:164` 只写了 `await app.ready();` 而**丢掉了这个布尔值**。
只要断言 `ready() === true`，本缺陷立刻在 Node 侧暴露。

### 修复（已实施）

**① 根因修复 —— 归一 `addListener` 契约**（`lib/native-reminders.js:838` 新增 `listenSafely`）

`try` 内调用平台 `addListener`，再用 `Promise.resolve(handle).catch(() => {})`
同时接受「`{remove}` 句柄对象」与「Promise」两种契约；同步抛错则返回 null、绝不外泄。
两处调用点（`SystemBridge.alarmAction`、`App.appStateChange`，现 855 / 859 行）统一改走它。

**② 启动链错误隔离**（`app-core.js` `init()`，现 5130-5141 行）

把闹钟监听注册包进 `try/catch` 并 `console.error`。监听注册属于**旁路能力**而非启动前提，
失败最坏退化为「全屏闹钟动作不被监听」，不再带走 seed / render / 15 秒心跳 / 角标。
（这条对应 §3 V2 的建议 1，**只做了这一处最小隔离**；V2 的建议 2、3 涉及产品可观测性取向，未做。）

**③ 测试侧加固**

- 四处 mock 的 `addListener` 改为**同步返回 `{ remove }` 句柄**（与真机一致），去掉 `async`；
- `test-smoke.js` 增加断言 `await app.ready() === true`；
- `test-regressions.js` 沙箱的 `setInterval` 由纯 stub 改为**可观测**（记录调用参数），
  于是「15 秒心跳有没有装上」第一次成为可断言事实；
- **新增 14 项用例**（回归 +8、native +5、smoke +1）。每项都先证自己不是空转
  —— 例如先断言 `addListener` 确实被调用到（`calls.appListener === 1`），再断言 `ready() === true`。

### 复测标准与实测结果

| 复测项 | 修复前 | 修复后 |
| --- | --- | --- |
| 冷启动后 `console` 出现 `App init failed` | **1 次** | **0 次** |
| `__ATTENTION_INBOX__.ready()` | `false` | **`true`**（1 ms） |
| 全新安装首启 IDB `items.length` | `0` | **`7`**（`projects: 3`） |
| 首页是否自动正确渲染 | 需点一下页签才渲染 | ✅ 冷启动即正确（UI 树里已含 seed 的「续费域名」等项目文本） |
| 应用内异常 / 崩溃 | 1 条初始化错误；0 崩溃 | **0 异常、0 崩溃** |
| `npm test` | 854 全绿（漏检） | **868 全绿** |
| 逐条回退修复后新用例是否失败 | — | ✅ **7 项失败**，并复现出原始 TypeError |

逐条回退的区分度验证：把「修复前写法」放回沙箱副本（**只回退源码、保留新测试**），
得 `通过 562 / 失败 5`（回归）与 `通过 108 / 失败 2`（native），报错原文正是
`App init failed: app.addListener(...).catch is not a function`。
复现脚本已入库：**`bash scripts/q1-defect-proof.sh`**。

**仍未验（NOT_PERFORMED）**：15 秒心跳的**端到端行为**（造一条 `triggerAt` 已过期的事项、
不触碰屏幕，观察 15 秒内是否自动进入注意力）本轮**未做**；`ready()` 为真只证明
`setInterval(tick, 15000)` 这一行被执行到，不等于验证了 `tick()` 的实际推进效果。
锁屏/休眠/进程回收/重启后的提醒投递、通知渠道与全屏闹钟、动作按钮、真机覆盖升级同样未验。

---

## 3. V2 · P2：`init()` 的失败半径过大

> **处置（2026-09-17）：建议 1 已做「最小版」——只隔离了闹钟监听注册这一处**（V1 的抛出点），
> 使其失败不再带走后面的核心流程。建议 2（重排顺序）与建议 3（让失败可见）
> **涉及产品可观测性与失败语义的取向，未实施**，仍待裁决。
> 另：建议 3 的「让 `ready()` 的 false 在验证环境里被断言」已落在测试侧（`test-smoke.js`）。

V1 能在无人察觉的情况下瘫痪整条启动链，根因不只是 `.catch`。

`init()` 是**一条直线**：把「可选的子系统接线」（原生闹钟动作、PWA、安装引导、断网提示）
与「必须完成的核心」（seed、初始渲染、心跳、整理会话排程）串在一起，**任一处抛错都会带走后面全部**。
而且这个失败是**终端用户完全看不见的**：`startApp()` 把拒绝吞成 `console.error`，
`window.addEventListener("error")` 只覆盖同步错误、不覆盖 Promise 拒绝，
所以连 `app-core.js:5112` 那条「脚本出错：…」的红色提示条也不会出现。

建议（择一或并用）：

1. **逐段隔离**：把那几处可选接线各自包 `try/catch`，失败只记日志、不阻断； ← **已做（仅抛出点这一处）**
2. **重排顺序**：把「必须完成」的核心（`seed` / `render` / `setInterval(tick)`）
   提到可选接线**之前**，让可选能力的故障无法影响核心； ← 未做
3. **让失败可见**：Promise 拒绝路径也走一次可见提示（或至少让 `ready()` 的 `false`
   在开发/验证环境里被断言或上报），避免「静默降级」。 ← 测试侧已断言，产品侧未做

> 这是**产品可观测性与失败语义**的取向问题，属于产品判断，本报告只列现象与选项，不代做决定。
>
> **残留风险**：`init()` 其余步骤（`loadAsync()`、`bind()`、`initializeNativeReminders()` 等）
> 仍未隔离。真要彻底消除「单点失败拖垮整条链」，需要建议 2 那种结构性重排 —— 那会改动
> 启动顺序语义，属于产品决策，不在本次修复范围内。

---

## 4. 其它观察（非产品问题）

| # | 观察 | 处置 |
| --- | --- | --- |
| O1 | `sdkmanager` 下载 `emulator` 包（420 MB）时 TLS 握手被代理中断，重试 3 次均失败；同一通道下 `platform-tools`/`platforms`/`build-tools` 全部正常 | 已绕开：从官方 `repository2-3.xml` 取真实 URL，用 `curl` 下载并手工安装。记录在 `docs/android-build.md` §2.3 |
| O2 | 手工解压的 `emulator` 因缺 `package.xml` 不被 `avdmanager` 识别 | 已绕开：按官方元数据补齐 `package.xml` |
| O3 | zsh 不做无引号参数分词，`sdkmanager $PROXY_ARGS` 会被当成单个参数 | 已改为内联参数 |
| O4 | 仓库内 `.gitignore` 忽略 `*.apk` 但保留 `!releases/*.apk`；`android/gradlew` 缺 exec 位 | 已 `chmod +x`（会体现在 git 状态里） |
| O5 | 本次未复测既有报告 R1–R8（含 R3「minSdk 22 与无保护 API 调用不匹配」）。模拟器为 API 34，**结构上无法**验证 API 22/23 路径 | 明确列为 NOT_PERFORMED |

---

## 5. NOT_PERFORMED

- **15 秒心跳的端到端行为**：修复后 `ready() === true` 只证明 `setInterval(tick, 15000)`
  这一行被**执行到**；「造一条已过期的 `triggerAt` → 不触碰屏幕 → 15 秒内自动进入注意力」
  这条**实际推进效果**本轮未验。
- 真机（非模拟器）安装、运行与覆盖升级。
- 锁屏、休眠、系统杀掉进程、设备重启后的提醒投递。
- 通知渠道、全屏闹钟、通知动作按钮、权限拒绝/撤销路径。
- `docs/reviews/android-prepackage-2026-09-16.md` 中 R1–R8 的修复复测。
- API 22/23 兼容性（模拟器为 API 34）。
- 发布版的正式密钥、R8 混淆与上架材料。

---

## 附录 A · 复现探针（无需模拟器）

只读运行，不修改产品代码、不写库；用**真实契约**替换测试 mock 即可复现 V1：

```js
// node /tmp/probe-addlistener-contract.js
const lib = require("/Users/qlyf/Developer/reminder/lib/native-reminders.js");

function run(label, impl) {
  global.Capacitor = {
    getPlatform: () => "android",
    Plugins: {
      App: { addListener: (name, cb) => impl(name, cb) },
      SystemBridge: {
        async addListener() { return { async remove() {} }; },
        async consumeAlarmAction() { return { action: null }; },
        async ackAlarmAction() {}
      },
      LocalNotifications: null
    }
  };
  try { lib.onAlarmAction(() => {}); console.log(label, "→ 未抛出"); }
  catch (e) { console.log(label, "→", e.constructor.name + ": " + e.message); }
}

run("测试 mock 契约（async → Promise）", async () => ({ async remove() {} }));
run("真实契约（返回 {remove} 句柄）",    ()  => ({ remove() {} }));
```

实测输出：

```
测试 mock 契约（async → Promise） → 未抛出
真实契约（返回 {remove} 句柄） → TypeError: app.addListener(...).catch is not a function
```

> **该探针已固化为常驻测试**（2026-09-17）：`test-native-reminders.js` 的 Q1 段落现在
> 直接以「真机契约 / Promise 契约 / 同步抛错」三种平台行为调用 `onAlarmAction()`，
> `test-regressions.js` 的 Q1 段落则在**带平台的完整启动**里断言 `ready() === true`。
> 二者都不再依赖手工跑脚本。

## 附录 B · 本轮实测计数

**修复前**（`npm test`，本次实跑，非沿用旧文档）：

| 套件 | 通过 | 失败 |
| --- | --- | --- |
| `test-unit.js` | 29 | 0 |
| `test-native-reminders.js` | 105 | 0 |
| `test-smoke.js` | 161 | 0 |
| `test-regressions.js` | 559 | 0 |
| **合计** | **854** | **0** |

854 全绿，同时 V1 在真机上 100% 复现 —— 这正是本报告最重要的一条推论：
**绿灯不等于安卓链路可用，mock 契约与平台契约不一致、或该路径根本没被跑到时尤其如此。**

**修复后**：

| 套件 | 通过 | 失败 | 新增 |
| --- | --- | --- | --- |
| `test-unit.js` | 29 | 0 | — |
| `test-native-reminders.js` | 110 | 0 | +5 |
| `test-smoke.js` | 162 | 0 | +1 |
| `test-regressions.js` | 567 | 0 | +8 |
| **合计** | **868** | **0** | **+14** |

**逐条回退修复后的区分度**（`bash scripts/q1-defect-proof.sh`）：

| 套件 | 通过 | 失败 |
| --- | --- | --- |
| `test-native-reminders.js` | 108 | **2** |
| `test-smoke.js` | 162 | 0（该套件无平台 mock，本来就走不到该分支） |
| `test-regressions.js` | 562 | **5** |

失败项的报错原文：`App init failed: app.addListener(...).catch is not a function`
—— 与真机实测捕获到的完全一致。
