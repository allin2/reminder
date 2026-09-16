/* 安心收件箱 Service Worker — network-first for app shell, offline fallback */
const CACHE = "attention-inbox-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./app-core.js",
  "./lib/parse-cn.js",
  "./lib/repeat.js",
  "./lib/reminder.js",
  "./lib/storage.js",
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
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
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
