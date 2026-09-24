/* 安心收件箱 Service Worker — network-first for app shell, offline fallback */
// v33：P3-G 把 Web 提醒弹条、到期 tick、活动原生闹钟面板及其轮询迁出为 `lib/app-alerts.js`；新增运行时脚本换缓存名。
// v32：P3-F-R 修复整理完成按钮无响应、IDB 保存失败误报完成与默认值单源收敛；更新运行时脚本缓存。
// v31：P3-F 把待整理窗口规则、会话流转、卡片与设置迁出为 `lib/app-review.js`；新增运行时脚本换缓存名。
// v30：P3-E-R 修复全屏闹钟动作排空直达事务处理器与版本漂移补偿重跑；更新运行时脚本缓存。
// v29：P3-E 把原生提醒协调与事件台账迁出为 `lib/app-native-coordinator.js`。
// v28：P3-D 把事项业务命令、周期派生、到期推进、编辑新建和有限撤销迁出为 `lib/app-items.js`。
// v27：P3-C-R 修复重绑后旧命令包装函数仍引用旧事务实例的缺陷，使 wrapUserOp 随当前事务实例失效重绑。
// v26：P3-C 把用户命令事务与原生动作一致性协调迁出为 `lib/app-transaction.js`。
// v25：P3-B 把权威恢复、提交 FIFO、镜像回放与已提交基线迁出为 `lib/app-persistence.js`。
// v24：P3-A 把事项模型与默认状态迁出为 `lib/app-model.js`。
// v23：P2-G2 把 capture 提交编排、低置信度与失败草稿迁出为 `lib/app-capture.js`。
// v18：P2-D 把诊断能力迁出为 `lib/app-diagnostics.js`（新增运行时脚本）。**新增脚本
// 必须换缓存名** —— 上一版清单里没有它，已装用户会一直吃旧清单，于是在「全新安装 →
// 第一次就没网」那条路上 `caches.match` 未命中、回落成 `./index.html`，
// 浏览器拿到一段 HTML 当 JS 执行 ⇒ `AttentionLib.AppDiagnostics` 静默缺失，
// 而 `AppDiagnostics` 是必需声明，结果就是**启动失败面板**。
// v17：P2-C-S B1 修复（独立复验 `20260922T134219`）—— `checkTimeField` 接受带时区
// ISO 时间字符串、sanitized 副本统一迁移为 epoch 毫秒、quietStart/quietEnd 收紧为
// HH:MM。`lib/app-backup.js` 内容变了，不换缓存名已装用户会继续吃旧验证器。
// v16：P2-C-S 整库导入格式安全面 —— `lib/app-backup.js` 新增唯一的备份格式契约
// （`validateBackupPayload`），并把 `importDataFile()` 的「验证 + 准备」整段挪到覆盖确认
// **之前**。脚本 URL 没变，预缓存按 URL 存条目 ⇒ 不换缓存名，已安装用户会继续跑旧的
// 「只检查 items 是数组」实现：错误文件照样先弹覆盖确认、照样写库，修复对他们等于没发生。
// v13：G01/G02 修复（独立复验 `20260921T134843`）改了 `lib/app-backup.js` 的**内容**
//（导入等待权威提交兑现 + 读取失败反馈）。脚本 URL 没变，但预缓存按 URL 存 ——
// 不换缓存名，已装用户会一直吃旧内容，修复对他们等于没发生。
// v12：P2-C 把数据备份迁出为 `lib/app-backup.js`（新增运行时脚本）。**新增脚本必须换
// 缓存名** —— 上一版清单里没有它，已装用户会一直吃旧清单，于是在「全新安装 →
// 第一次就没网」那条路上 `caches.match` 未命中、回落成 `./index.html`，
// 浏览器拿到一段 HTML 当 JS 执行 ⇒ `AttentionLib.AppBackup` 静默缺失，
// v38：P3-I 把反馈协调、事件路由与测试接口迁出为 lib/app-action-feedback.js、lib/app-events.js、lib/app-test-api.js；新增运行时脚本换缓存名。
// v37：P3-H-R2 收口 unbindAll 时 worker statechange 监听器解绑与 epoch 防护缺口。
// v36：P3-H-R 收口 Service Worker 重复注册与 updatefound 监听器幂等缺口。
// v35：P3-H 把平台适配与 PWA 生命周期迁出为 `lib/app-platform.js`；新增运行时脚本换缓存名。
// v34：P3-G-R 交付收口，推进至 v34。覆盖 lib/app-alerts.js 绑定幂等性与保存失败回执裁决等内容变更，建立新版本预缓存边界。
// v33：P3-G 把 Web 提醒弹条与活动原生闹钟面板迁出为 lib/app-alerts.js。
const CACHE = "attention-inbox-v38";
/**
 * 预缓存清单必须**逐条等于** `index.html` 里真正加载的运行时脚本。
 *
 * `lib/native-reminders.js` 在 v2~v4 一直漏在这里（它从被引入起就没进过清单）：
 * 它由 `index.html` 加载，却从不被预缓存，于是「全新安装 → 第一次就没网」时
 * `caches.match` 未命中，再回落成 `./index.html` —— 浏览器拿到一段 HTML 当 JS
 * 执行，原生桥静默缺失（不报错，只是所有原生能力都变成 undefined）。
 *
 * 纪律：新增 `lib/*.js` 必须同时改四处（`index.html` 的 script、本清单、
 * `test-smoke.js` 的加载列表、`test-regressions.js` 的 `LIB_SOURCES`），
 * 并升上面的缓存版本号。漏了不会报错，只会静默降级。
 */
const ASSETS = [
  "./",
  "./index.html",
  "./app-core.js",
  "./lib/date-utils.js",
  "./lib/ui-format.js",
  "./lib/app-ui.js",
  "./lib/app-ai.js",
  "./lib/app-backup.js",
  "./lib/app-diagnostics.js",
  "./lib/app-setup.js",
  "./lib/app-content.js",
  "./lib/app-capture.js",
  "./lib/app-views.js",
  "./lib/app-model.js",
  "./lib/app-persistence.js",
  "./lib/app-transaction.js",
  "./lib/app-items.js",
  "./lib/app-native-coordinator.js",
  "./lib/app-review.js",
  "./lib/app-alerts.js",
  "./lib/app-platform.js",
  "./lib/app-action-feedback.js",
  "./lib/app-events.js",
  "./lib/app-test-api.js",
  "./lib/parse-cn.js",
  "./lib/repeat.js",
  "./lib/reminder.js",
  "./lib/storage.js",
  "./lib/feedback.js",
  "./lib/delivery-evidence.js",
  "./lib/native-reminders.js",
  "./manifest.json",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/**
 * 离线时的兜底。
 *
 * **只有页面导航才允许回落 `index.html`。** 脚本/样式/清单回落成 HTML 是比失败更坏的
 * 结果：浏览器会把一段 HTML 当 JS 解析，得到的是「桥莫名其妙不存在」这种无声故障，
 * 而网络错误至少是诚实的、可见的。（R-F07 同一条纪律：读不到就说读不到，别编。）
 */
function offlineFallback(req) {
  return caches.match(req).then((hit) => {
    if (hit) return hit;
    if (req.mode === "navigate") return caches.match("./index.html");
    if (typeof Response === "function") {
      return new Response("", { status: 504, statusText: "offline" });
    }
    return undefined;   // 无 Response 构造器的环境（测试沙箱）：交给浏览器判为网络错误
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first so UI updates are not stuck on stale JS
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => offlineFallback(req))
  );
});

async function focusApp(payload) {
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  let client = all.find((c) => "focus" in c);
  if (!client) client = await self.clients.openWindow("./index.html");
  else client = await client.focus();
  if (client && payload) client.postMessage(payload);
}

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  const action = event.action || "open";
  event.notification.close();
  event.waitUntil(focusApp({ type: "notification-action", action, itemId: data.itemId || null }));
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  if (data.type === "SHOW_NOTIFICATION") {
    const n = data.notification || {};
    event.waitUntil(
      self.registration.showNotification(n.title || "安心收件箱", {
        body: n.body || "",
        tag: n.tag || "attention",
        requireInteraction: !!n.requireInteraction,
        renotify: !!n.renotify,
        silent: !!n.silent,
        data: n.data || {},
        actions: n.actions || []
      })
    );
  }
});
