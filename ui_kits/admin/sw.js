// CACUSA Admin — Service Worker para Web Push notifications

self.addEventListener('push', e => {
  let data = { title: 'CACUSA · Nuevo pedido', body: 'Tienes un nuevo pedido.' };
  if (e.data) {
    try { data = { ...data, ...e.data.json() }; } catch (_) { data.body = e.data.text(); }
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:      data.body,
      icon:      'https://cacusabytaitus.com/favicon.ico',
      badge:     'https://cacusabytaitus.com/favicon.ico',
      tag:       'cacusa-order',
      renotify:  true,
      vibrate:   [200, 100, 200],
      data:      { url: data.url || 'https://cacusabytaitus.com/ui_kits/admin/' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || 'https://cacusabytaitus.com/ui_kits/admin/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.startsWith('https://cacusabytaitus.com/ui_kits/admin'));
      if (existing) return existing.focus();
      return clients.openWindow(target);
    })
  );
});
