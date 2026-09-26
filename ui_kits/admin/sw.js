// El panel se mudó a admin.cacusabytaitus.com (26 sep). Este service worker viejo se
// borra solo en los dispositivos que todavía lo tengan registrado.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    self.registration.unregister()
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(list => list.forEach(c => c.navigate('https://admin.cacusabytaitus.com/').catch(() => {})))
  );
});
