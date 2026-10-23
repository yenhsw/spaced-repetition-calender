/* eslint-disable no-undef */
importScripts('./ngsw-worker.js');

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let badgeCount;
  try {
    const payload = event.data.json();
    badgeCount = Number(
      payload?.notification?.data?.badgeCount ?? payload?.data?.badgeCount,
    );
  } catch {
    return;
  }

  if (!Number.isFinite(badgeCount) || badgeCount <= 0) return;
  if (typeof self.registration.setAppBadge !== 'function') return;

  event.waitUntil(self.registration.setAppBadge(badgeCount));
});
