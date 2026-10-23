import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { PwaInstallService } from '../services/pwa-install.service';
import { PushNotificationService } from '../services/push-notification.service';
import { AuthService } from '../services/auth.service';
import { TodayCountService } from '../services/today-count.service';

export function pwaInitializer(): () => Promise<void> {
  const pwaInstall = inject(PwaInstallService);
  const pushService = inject(PushNotificationService);
  const authService = inject(AuthService);
  const todayCount = inject(TodayCountService);
  const swPush = inject(SwPush, { optional: true });
  const router = inject(Router);

  return async () => {
    pwaInstall.init();

    if (swPush?.isEnabled) {
      swPush.notificationClicks.subscribe(({ action, notification }) => {
        const data = notification.data as { url?: string } | undefined;
        const target = data?.url ?? '/spaced-repetition/today';
        void router.navigateByUrl(target);
      });

      swPush.messages.subscribe(() => {
        void todayCount.refresh();
      });
    }

    if (authService.isAuthenticated()) {
      await pushService.initAfterLogin();
    }
  };
}
