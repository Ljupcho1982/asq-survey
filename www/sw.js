/* The whole app is the shell — there is no remote content to cache. A gate
   tablet has to keep collecting through a Wi-Fi outage, so every asset is
   served from the cache first and the network is only ever a fallback.
   Responses queue in IndexedDB; the service worker has no part in sending. */
const CACHE = "asq-v1.1.0";
const SHELL = ["index.html", "styles.css", "questionnaire.js", "store.js", "submit.js",
               "csv-sink.js", "app.js", "manifest.json", "icon.svg", "icon-maskable.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;      // the FormSubmit POST is never touched
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).catch(
      () => caches.match("index.html")
    ))
  );
});
