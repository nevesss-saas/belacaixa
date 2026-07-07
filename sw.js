/* BelaCaixa — Service Worker (PWA)
   Objetivo: abrir rápido e funcionar offline SEM quebrar login/dados.
   - Only same-origin GET é gerenciado. Chamadas ao Supabase (outra origem),
     POST, realtime etc. passam direto pra rede (nunca são cacheadas).
   - Assets estáticos: stale-while-revalidate (serve do cache e atualiza atrás).
     Como o app usa cache-busting (?v=...), toda versão nova é uma URL nova → sempre carrega.
   - Navegação: rede primeiro (pega o index novo), cai pro cache offline. */
const CACHE = 'belacaixa-v1';
const CORE = ['./', 'manifest.json', 'icon-192.png?v=1', 'icon-512.png?v=1', 'icon-maskable-512.png?v=1', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // POST/PUT (Supabase writes) → rede
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;             // Supabase, CDNs → rede direto

  // Navegação (abrir o app): rede primeiro; se offline, usa o shell cacheado
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put('./', cp)); return r; })
        .catch(() => caches.match('./').then((r) => r || caches.match(req)))
    );
    return;
  }

  // Estáticos same-origin: stale-while-revalidate
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req)
        .then((r) => { if (r && r.status === 200) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return r; })
        .catch(() => cached);
      return cached || net;
    })
  );
});
