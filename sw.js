// 오프라인 캐시. 파일을 고치면 VERSION을 올려 주세요.
const VERSION = 'rd-v4';
const ASSETS = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/pad.js', 'js/leitner.js', 'js/grader.js', 'js/ui.js', 'js/streak.js',
  'data/words.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 캐시 우선 + 백그라운드 갱신 (stale-while-revalidate)
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return hit || (await net) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
    })
  );
});
