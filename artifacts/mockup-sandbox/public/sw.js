/* Push only: deliberately does not cache private ledger data. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Show a safe fallback. */ }
  event.waitUntil(self.registration.showNotification(data.title || 'RKH Suppliers', {
    body: data.body || 'You have a new notification.',
    icon: new URL('brand/icon-192.png', self.registration.scope).href,
    tag: data.id || 'rkh-notification',
    data: { url: self.registration.scope },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) return existing.focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
