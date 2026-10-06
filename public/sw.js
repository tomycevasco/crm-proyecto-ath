// Service worker de ATH: que abra rápido y se actualice solo.
// - La página (index.html) se pide siempre fresca; la guardada se usa solo si no hay internet.
// - Los archivos con nombre único (assets/…) se guardan la primera vez que se piden.
// - Lo que no es de esta misma dirección (Supabase, GitHub, Claude) NUNCA se guarda: los datos siempre al día.
const VERSION = 'ath-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  const url = new URL(pedido.url);
  if (pedido.method !== 'GET' || url.origin !== self.location.origin) return;

  if (pedido.mode === 'navigate') {
    evento.respondWith(
      fetch(pedido)
        .then((respuesta) => {
          const copia = respuesta.clone();
          caches.open(VERSION).then((cache) => cache.put('pagina', copia));
          return respuesta;
        })
        .catch(() => caches.match('pagina')),
    );
    return;
  }

  // Lo que no tiene nombre único (logo, íconos) va siempre a buscarse, para que se actualice.
  if (!url.pathname.includes('/assets/')) return;

  evento.respondWith(
    caches.match(pedido).then(
      (guardada) =>
        guardada ??
        fetch(pedido).then((respuesta) => {
          if (respuesta.ok) {
            const copia = respuesta.clone();
            caches.open(VERSION).then((cache) => cache.put(pedido, copia));
          }
          return respuesta;
        }),
    ),
  );
});
