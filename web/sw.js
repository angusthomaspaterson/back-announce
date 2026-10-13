// Service worker: the shell is served from cache; data is fetched from the network with the
// cached copy as the offline fallback. __BUILD__ is replaced on deploy so a new shell takes over.
const VERSION = 'ba-__BUILD__';
const SHELL_CACHE = VERSION + '-shell', DATA_CACHE = 'ba-data', FONT_CACHE = 'ba-fonts';
const SHELL = ['./', './index.html', './app.css', './manifest.webmanifest', './js/app.js', './js/util.js', './js/data.js', './js/feed.js', './js/onair.js', './js/schedule.js', './js/player.js', './js/store.js', './js/settings.js', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];
const SCOPE = new URL('./', self.location).pathname;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.endsWith('-shell') && k !== SHELL_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin && url.pathname.includes('/data/')) {
    e.respondWith(networkFirst(e.request, DATA_CACHE));
  } else if (url.origin === location.origin) {
    // Only the app's own page is served from the shell; any other page goes to the network.
    if (e.request.mode === 'navigate') {
      if (url.pathname === SCOPE || url.pathname === SCOPE + 'index.html') e.respondWith(cacheFirst(new Request('./index.html'), SHELL_CACHE));
    } else e.respondWith(cacheFirst(e.request, SHELL_CACHE));
  } else if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(staleWhileRevalidate(e.request, FONT_CACHE));
  }
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, {ignoreSearch: true});
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}
