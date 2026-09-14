// CACUSA Admin — Service Worker para Web Push notifications

// Misma clave pública VAPID que usa ui_kits/admin/index.html para suscribirse —
// duplicada acá porque el Service Worker corre en su propio contexto, sin acceso
// al scope de la página, y la necesita para volver a suscribirse solo en
// pushsubscriptionchange (ver más abajo).
const VAPID_PUB_KEY = 'BLLRPGO7zFrAiyfZ1KzNlaysb9wUVJnZeog3Z4sVJRqSFXiodQ9g8PALWr2uYT7sRuZ6W2V0iaDRQ-5XUcQif9U';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Sin esto, un Service Worker nuevo (como el que trae este mismo archivo) se
// queda "esperando" mientras haya alguna pestaña del admin abierta — y Tita/Robin
// normalmente lo dejan abierto en background, así que un fix nunca llegaría a
// aplicarse en la práctica.
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', e => {
  // tag por defecto 'cacusa' solo para el caso borde de un push sin payload
  // (o de una prueba vieja) — en la práctica el servidor siempre manda un tag
  // específico por tipo de evento (cacusa-order/cacusa-lovers/cacusa-backup/...)
  // para que dos avisos de tipos distintos no se tapen entre sí.
  let data = { title: 'CACUSA · Nuevo pedido', body: 'Tienes un nuevo pedido.', tag: 'cacusa' };
  if (e.data) {
    try { data = { ...data, ...e.data.json() }; } catch (_) { data.body = e.data.text(); }
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:      data.body,
      icon:      'https://cacusabytaitus.com/favicon.ico',
      badge:     'https://cacusabytaitus.com/favicon.ico',
      tag:       data.tag || 'cacusa',
      renotify:  true,
      vibrate:   [200, 100, 200],
      data:      { url: data.url || 'https://cacusabytaitus.com/ui_kits/admin/' }
    }).catch(err => console.error('showNotification falló:', err))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || 'https://cacusabytaitus.com/ui_kits/admin/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.startsWith('https://cacusabytaitus.com/ui_kits/admin'));
      if (existing) return existing.focus().then(c => (c && c.navigate) ? c.navigate(target).catch(() => c) : c);
      return clients.openWindow(target);
    })
  );
});

// El navegador puede invalidar/rotar la suscripción sola (limpieza de storage,
// rotación interna del push service) sin que nadie lo note hasta que un push
// falla en silencio. Acá nos re-suscribimos solos y avisamos a las pestañas
// abiertas para que ellas — que sí tienen el token de sesión — le manden la
// suscripción nueva a /push/subscribe (el Service Worker no tiene acceso a
// sessionStorage de la página).
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUB_KEY),
    }).then(sub => self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      list.forEach(c => c.postMessage({ type: 'cacusa-push-resubscribed', subscription: sub.toJSON() }));
    })).catch(err => console.error('pushsubscriptionchange: no se pudo re-suscribir:', err))
  );
});
