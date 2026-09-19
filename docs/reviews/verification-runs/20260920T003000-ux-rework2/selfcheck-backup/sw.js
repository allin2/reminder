/* 安心收件箱 Service Worker — network-first for app shell, offline fallback */
const CACHE = "attention-inbox-v5";
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
