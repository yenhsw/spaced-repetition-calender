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
      return;
    }

    this.loadingSignal.set(true);
    try {
      const summary = await this.todayReviewsService.loadTodaySummary();
      this.countSignal.set(summary.studies.length + summary.reviews.length);
    } catch {
      this.countSignal.set(0);
    } finally {
      this.loadingSignal.set(false);
    }
  }

  clear(): void {
    this.countSignal.set(0);
  }
}
