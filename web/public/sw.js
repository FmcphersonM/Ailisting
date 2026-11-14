// Small service worker: lets the app open instantly from the home screen,
// even while the server is still waking up. It never caches your data.
const CACHE = "selg-shell-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") return;

  // Fingerprinted files never change: serve from the cache when we have them.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })(),
    );
    return;
  }

  // Opening the app: prefer the newest version, but do not wait long for it.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const fresh = fetch(request).then((response) => {
          if (response.ok) cache.put("/", response.clone());
          return response;
        });
        const cached = await cache.match("/");
        if (!cached) return fresh;
        try {
          return await Promise.race([fresh, timeout(2500)]);
        } catch {
          fresh.catch(() => {});
          return cached;
        }
      })(),
    );
  }
});
