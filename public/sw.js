// Minimal service worker: exists mainly so "Add to Home Screen" / "Install" is
// offered consistently across browsers, plus a small offline safety net for a show
// that loses wifi mid-broadcast. It deliberately does NOT cache-first: this app is
// under active development and the server itself sends no cache headers (see
// deploy/nginx.conf), so a stale service-worker cache would be worse than none.
// Network wins whenever it's reachable; the cache is only a fallback for outages.
const CACHE = 'free-teleprompter-v1';

// Bump CACHE's version string (not this list) when static assets change shape -
// that's what invalidates the old cache. This list is a courtesy pre-warm, not a
// contract: fetch() below caches everything it successfully serves anyway.
const PRECACHE = [
    '/controller.html',
    '/display.html',
    '/manifest-controller.json',
    '/manifest-display.json',
    '/css/controller.css',
    '/css/display.css',
    '/css/studio-controls.css',
    '/css/theme.css'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(PRECACHE))
            .catch(() => {}) // offline-at-install or a renamed file should not block install
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    // Same-origin GETs only. The WebSocket upgrade never reaches fetch at all; a
    // session route (/abc123, /d/abc123) is a GET like any other and is handled
    // below like the file it resolves to - fine to cache, since the server always
    // returns the same controller.html/display.html shell for it.
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
    if (request.url.includes('/api/')) return; // always live: LAN addresses change per host

    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE).then((cache) => cache.put(request, copy));
                }
                return response;
            })
            .catch(() => caches.match(request))
    );
});
