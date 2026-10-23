import { ApplicationConfig, APP_INITIALIZER, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { authInitializer } from './core/initializers/auth.initializer';
import { pwaInitializer } from './core/initializers/pwa.initializer';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withInMemoryScrolling({
        scrollPositionRestoration: 'top',
        anchorScrolling: 'enabled',
      }),
    ),
    {
      provide: APP_INITIALIZER,
      useFactory: authInitializer,
      multi: true,
    },
    {
      provide: APP_INITIALIZER,
      useFactory: pwaInitializer,
      multi: true,
    },
    provideServiceWorker('combined-sw.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
