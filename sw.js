// Service Worker: Network-first, damit Updates sofort ankommen – offline wird aus dem Cache geliefert.
// Die Routinen liegen nicht hier, sondern privat bei GitHub (die App speichert sie selbst zwischen).
const CACHE = 'milon-v36';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'sync.js',
  'app.js',
  'gym.js',
  'werte.js',
  'heute.js',
  'belastung.js',
  'push.js',
  'fonts/newsreader-latin-400-normal.woff2',
  'fonts/newsreader-latin-500-normal.woff2',
  'fonts/newsreader-latin-400-italic.woff2',
  'fonts/ibm-plex-sans-latin-400-normal.woff2',
  'fonts/ibm-plex-sans-latin-500-normal.woff2',
  'fonts/ibm-plex-sans-latin-600-normal.woff2',
  'fonts/ibm-plex-mono-latin-400-normal.woff2',
  'fonts/ibm-plex-mono-latin-500-normal.woff2',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // nur eigene alte Versionen löschen (auch die unter dem alten Namen „dehnapp-v…“) – nicht den Speicher der Ansage-Aufnahmen der App
      .then((keys) => Promise.all(keys.filter((k) => /^(dehnapp|milon)-v\d+$/.test(k) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Push-Mitteilung aus der GitHub Action („Heute steht an“): anzeigen und die Zahl am App-Icon setzen.
// iOS verlangt, dass jede Push-Nachricht sichtbar angezeigt wird – sonst wird das Abo entzogen.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : '' }; }
  const n = Number(d.badge) || 0;
  const badge = 'setAppBadge' in self.navigator
    ? (n ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge()).catch(() => {})
    : Promise.resolve();
  event.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'Milon', {
      body: d.body || '', tag: d.tag || 'milon', icon: 'icons/icon-192.png', data: { url: d.url || './' },
    }),
    badge,
  ]));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const win = list.find((c) => c.url.startsWith(self.registration.scope));
    return win ? win.focus().then((c) => (c && 'navigate' in c ? c.navigate(url) : c)) : self.clients.openWindow(url);
  }));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Immer beim Server nachfragen (304 ist billig), damit Updates nie im HTTP-Cache hängen bleiben
  const fresh = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache' }) : fetch(req, { cache: 'no-cache' });
  event.respondWith(
    fresh
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined))
          .then((hit) => hit || Response.error())
      )
  );
});
