import { Injectable, computed, inject, signal } from '@angular/core';
import { TodayReviewsService } from './today-reviews.service';
import { AuthService } from './auth.service';

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
      this.syncAppIconBadge(0);
      return;
    }

    this.loadingSignal.set(true);
    try {
      const summary = await this.todayReviewsService.loadTodaySummary();
      const count = summary.studies.length + summary.reviews.length;
      this.countSignal.set(count);
      this.syncAppIconBadge(count);
    } catch {
      this.countSignal.set(0);
      this.syncAppIconBadge(0);
    } finally {
      this.loadingSignal.set(false);
    }
  }

  clear(): void {
    this.countSignal.set(0);
    this.syncAppIconBadge(0);
  }

  /** iOS/Android PWA home screen icon badge (requires installed app). */
  private syncAppIconBadge(count: number): void {
    if (typeof navigator === 'undefined') return;

    const nav = navigator as Navigator & {
      setAppBadge?: (contents?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };

    if (count > 0 && typeof nav.setAppBadge === 'function') {
      void nav.setAppBadge(count).catch(() => undefined);
      return;
    }

    if (typeof nav.clearAppBadge === 'function') {
      void nav.clearAppBadge().catch(() => undefined);
    }
  }
}
