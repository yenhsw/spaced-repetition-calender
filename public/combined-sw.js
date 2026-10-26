/* eslint-disable no-undef */
importScripts('./ngsw-worker.js');

self.addEventListener('push', (event) => {
  if (!event.data) return;

  event.waitUntil(
    (async () => {
      let payload;
      try {
        payload = event.data.json();
      } catch {
        return;
      }

      const notification = payload?.notification ?? payload;
      const title = notification?.title;
      const body = notification?.body;
      const data = notification?.data ?? payload?.data ?? {};
      const badgeCount = Number(data?.badgeCount);

      if (title && body) {
        await self.registration.showNotification(title, {
          body,
          icon: notification?.icon ?? '/icons/icon-192.png',
          badge: notification?.badge ?? '/icons/icon-192.png',
          data,
        });
      }

      if (
        Number.isFinite(badgeCount) &&
        badgeCount > 0 &&
        typeof self.registration.setAppBadge === 'function'
      ) {
        await self.registration.setAppBadge(badgeCount);
      }
    })(),
  );
});
