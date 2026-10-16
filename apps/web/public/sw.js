/*
 * Kadrix service worker: makes the app installable and lets it open without
 * a network. Only the app shell is cached. API responses never are, so no
 * workspace data is stored on the device by this worker.
 */
const SHELL = "kadrix-shell-v2";
/** Old build files are dropped beyond this many, oldest first. */
const MAX_ASSETS = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Built assets have content hashes in their names: cache them forever.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(SHELL).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          await c.put(req, res.clone());
          const keys = (await c.keys()).filter((k) => new URL(k.url).pathname.startsWith("/assets/"));
          await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => c.delete(k)));
        }
        return res;
      }),
    );
    return;
  }

  // Pages: network first so updates arrive at once, the cached shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            // Clone now: the page starts reading the response right away.
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() => caches.match("/")),
    );
  }
});
