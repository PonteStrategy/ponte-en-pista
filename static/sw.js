/* Service worker: a web instálase no móbil e garda o necesario para abrir o QR sen cobertura. */
const V = 'pep-v1';
const SHELL = ['/', '/static/css/styles.css', '/static/js/app.js', '/static/js/i18n.js', '/static/js/views-public.js', '/static/js/views-user.js', '/static/js/views-staff.js', '/static/img/icon.svg', '/static/manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return; // a API nunca se serve da caché; os datos do QR gárdanse na app
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});
