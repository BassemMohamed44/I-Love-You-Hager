/* Service worker — makes the site installable and lets it open without internet.
   - The page (index.html) is sealed, so caching it exposes nothing.
   - Chat data (Firebase) is never cached or intercepted: it always goes straight to the network.
   VERSION is replaced by build.mjs, so every new build refreshes the cache. */
const VERSION = 'bdf324dc1a';
const SHELL = 'love-shell-' + VERSION;
const RUNTIME = 'love-runtime-v1';
const SHELL_FILES = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];
const OPTIONAL_FILES = ['play.mp3'];                                   // cached when it exists
const CDN = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|www\.gstatic\.com)\//;

self.addEventListener('install', e => {
    e.waitUntil((async () => {
        const c = await caches.open(SHELL);
        await c.addAll(SHELL_FILES);
        await Promise.all(OPTIONAL_FILES.map(f => c.add(f).catch(() => { })));
    })());
});

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        const keep = [SHELL, RUNTIME];
        for (const k of await caches.keys()) if (k.startsWith('love-') && !keep.includes(k)) await caches.delete(k);
        await self.clients.claim();
    })());
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

async function trim(cache, max) {
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    /* the page itself: the network first (so updates arrive), the saved copy when offline or slow */
    if (req.mode === 'navigate' && url.origin === location.origin) {
        e.respondWith((async () => {
            const cache = await caches.open(SHELL);
            try {
                const net = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4500))]);
                if (net && net.ok) cache.put('index.html', net.clone());
                return net;
            } catch (_) {
                return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
            }
        })());
        return;
    }

    /* our own static files: saved copy first */
    if (url.origin === location.origin) {
        e.respondWith((async () => {
            const hit = await caches.match(req, { ignoreSearch: true });
            if (hit) return hit;
            const net = await fetch(req);
            if (net && net.ok && net.type === 'basic') { const c = await caches.open(RUNTIME); c.put(req, net.clone()); trim(c, 60); }
            return net;
        })());
        return;
    }

    /* fonts, icons, firebase scripts: saved copy now, refreshed in the background */
    if (CDN.test(req.url)) {
        e.respondWith((async () => {
            const c = await caches.open(RUNTIME);
            const hit = await c.match(req);
            const refresh = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) { c.put(req, r.clone()); trim(c, 60); } return r; }).catch(() => null);
            return hit || (await refresh) || Response.error();
        })());
    }
    /* everything else (Firebase database, etc.) is left alone */
});

self.addEventListener('notificationclick', e => {
    e.notification.close();
    e.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of all) { if ('focus' in c) return c.focus(); }
        return self.clients.openWindow('./');
    })());
});
