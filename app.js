const CACHE_NAME = "forge-v1";
const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icon.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", (evt) => {
  evt.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE)));
  self.skipWaiting();
});

self.addEventListener("fetch", (evt) => {
  evt.respondWith(
    caches.match(evt.request).then(resp => resp || fetch(evt.request))
  );
});
