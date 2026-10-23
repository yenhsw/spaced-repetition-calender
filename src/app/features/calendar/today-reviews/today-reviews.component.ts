import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TodayReviewsService } from '../../../core/services/today-reviews.service';
import { StudyReviewService } from '../../../core/services/study-review.service';
import { ReviewScheduleService } from '../../../core/services/review-schedule.service';
import { TodayReviewItem, TodayStudyItem, TodaySummary } from '../../../core/models/today-item.model';
import { ReviewUiState } from '../../../core/enums/review-ui-state.enum';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { TranslationService } from '../../../core/i18n/translation.service';
import { formatLongDisplayDate } from '../../../core/utils/date.utils';
import { formatStudyTimeRange } from '../../../core/utils/study-time.utils';
import { getTopicColorCssVars } from '../../../core/utils/topic-color.utils';
import { PwaInstallService } from '../../../core/services/pwa-install.service';
import { TodayCountService } from '../../../core/services/today-count.service';

@Component({
  selector: 'app-today-reviews',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './today-reviews.component.html',
  styleUrl: './today-reviews.component.scss',
})
export class TodayReviewsComponent implements OnInit {
  private readonly todayService = inject(TodayReviewsService);
  private readonly studyReviewService = inject(StudyReviewService);
  protected readonly reviewScheduleService = inject(ReviewScheduleService);
  private readonly i18n = inject(TranslationService);
  protected readonly pwaInstall = inject(PwaInstallService);
  private readonly todayCount = inject(TodayCountService);

  protected readonly loading = signal(true);
  protected readonly actionLoading = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly summary = signal<TodaySummary | null>(null);

  protected readonly ReviewUiState = ReviewUiState;
  protected readonly getTopicColorVars = getTopicColorCssVars;

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      this.summary.set(await this.todayService.loadTodaySummary());
      await this.todayCount.refresh();
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : this.i18n.t('today.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  formatHeading(date: string): string {
    return formatLongDisplayDate(date, this.i18n.dateLocale());
  }

  formatTimeRange(item: TodayReviewItem | TodayStudyItem): string {
    return formatStudyTimeRange(item.studyStartTime, item.studyEndTime, '');
  }

  reviewStateLabel(review: TodayReviewItem): string {
    if (review.uiState === ReviewUiState.OVERDUE) {
      return this.i18n.t('today.state.overdue');
    }
    return this.i18n.t('today.state.due');
  }

  reviewBadge(review: TodayReviewItem): string {
    return this.reviewScheduleService.offsetLabel(review.dayOffset);
  }

  async completeReview(review: TodayReviewItem): Promise<void> {
    this.actionLoading.set(review.id);
    try {
      await this.studyReviewService.completeReview(review.id);
      await this.load();
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : this.i18n.t('today.error.complete'));
    } finally {
      this.actionLoading.set(null);
    }
  }

  topicLink(topicId: string): string[] {
    return ['/spaced-repetition'];
  }
}
