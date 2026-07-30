// sw.js — makes "works offline" true.
//
// The footer, the meta description and the social cards all claimed offline
// support while four dependencies came from CDNs and nothing was cached, so
// pulling the network gave a blank page. This is what backs the claim.

const CACHE = "pixl-tweak-v3";

// The app shell. Cross-origin entries are version-pinned and immutable, and
// both CDNs send CORS headers, so these cache as real responses rather than
// opaque ones — which means a cache hit can actually be served back.
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./engine.js",
  "./bundle.js",
  "./worker.js",
  "./icons.svg",
  "./Pixl Tweak.png",
  "./favicon.png",
  "./manifest.webmanifest",
  // The WASM encoders behind "max compression". They load on demand, so
  // leaving them out meant offline only worked if you had happened to use the
  // feature once while online. build.mjs fails if this list drifts from
  // what it actually vendored.
  "./vendor/jpeg/encode.js",
  "./vendor/jpeg/meta.js",
  "./vendor/jpeg/utils.js",
  "./vendor/jpeg/codec/pre.js",
  "./vendor/jpeg/codec/enc/mozjpeg_enc.js",
  "./vendor/jpeg/codec/enc/mozjpeg_enc.wasm",
  "./vendor/oxipng.js",
  "./vendor/oxipng/squoosh_oxipng.js",
  "./vendor/oxipng/squoosh_oxipng_bg.wasm",
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One bad URL must not sink the whole install, so they go in one at a time.
    await Promise.all(SHELL.map(url =>
      cache.add(new Request(url, { cache: "reload" })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Same-origin files change on every build, so the network wins when it can
  // and the cache is the offline fallback. The pinned CDN URLs never change,
  // so those are served from the cache first and never re-fetched.
  e.respondWith(sameOrigin ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    // A navigation with nothing cached for it still gets the shell.
    if (req.mode === "navigate") {
      const shell = await cache.match("./index.html");
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Opaque responses are useless as cache entries — they cannot be read back.
  if (res && res.ok && res.type !== "opaque") cache.put(req, res.clone());
  return res;
}
