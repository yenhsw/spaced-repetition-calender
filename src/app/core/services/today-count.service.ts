import { Injectable, computed, inject, signal } from '@angular/core';
import { TodayReviewsService } from './today-reviews.service';
import { AuthService } from './auth.service';

type BadgeCapableRegistration = ServiceWorkerRegistration & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

@Injectable({ providedIn: 'root' })
export class TodayCountService {
  private readonly todayReviewsService = inject(TodayReviewsService);
  private readonly authService = inject(AuthService);

  private readonly countSignal = signal(0);
  private readonly loadingSignal = signal(false);

  readonly count = this.countSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly hasItems = computed(() => this.countSignal() > 0);
  readonly badgeLabel = computed(() => {
    const value = this.countSignal();
    if (value <= 0) return '';
    return value > 99 ? '99+' : String(value);
  });

  async refresh(): Promise<void> {
    if (!this.authService.userId()) {
      this.countSignal.set(0);
      await this.syncAppIconBadge(0);
      return;
    }

    this.loadingSignal.set(true);
    try {
      const summary = await this.todayReviewsService.loadTodaySummary();
      const count = summary.studies.length + summary.reviews.length;
      this.countSignal.set(count);
      await this.syncAppIconBadge(count);
    } catch {
      this.countSignal.set(0);
      await this.syncAppIconBadge(0);
    } finally {
      this.loadingSignal.set(false);
    }
  }

  clear(): void {
    this.countSignal.set(0);
    void this.syncAppIconBadge(0);
  }

  /** iOS/Android PWA home screen icon badge (requires installed app + notification permission on iOS). */
  private async syncAppIconBadge(count: number): Promise<void> {
    if (typeof window === 'undefined') return;

    // iOS only shows the home screen badge after notification permission is granted.
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      return;
    }

    const value = count > 0 ? count : 0;

    try {
      if (value > 0 && typeof navigator.setAppBadge === 'function') {
        await navigator.setAppBadge(value);
        return;
      }

      if (value === 0 && typeof navigator.clearAppBadge === 'function') {
        await navigator.clearAppBadge();
        return;
      }
    } catch {
      /* try service worker registration next */
    }

    if (!('serviceWorker' in navigator)) return;

    try {
      const registration = (await navigator.serviceWorker.ready) as BadgeCapableRegistration;

      if (value > 0 && typeof registration.setAppBadge === 'function') {
        await registration.setAppBadge(value);
        return;
      }

      if (typeof registration.clearAppBadge === 'function') {
        await registration.clearAppBadge();
      }
    } catch {
      /* badge optional */
    }
  }
}
