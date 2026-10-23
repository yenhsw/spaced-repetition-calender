import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { StudyReviewService } from './study-review.service';
import { StudyTopicService } from './study-topic.service';
import { TopicProgressService } from './topic-progress.service';
import { ReviewUiState } from '../enums/review-ui-state.enum';
import { ReviewStatus } from '../enums/review-status.enum';
import { TodayItem, TodayReviewItem, TodayStudyItem, TodaySummary } from '../models/today-item.model';
import { todayDateOnly } from '../utils/date-only.utils';

@Injectable({ providedIn: 'root' })
export class TodayReviewsService {
  private readonly authService = inject(AuthService);
  private readonly studyReviewService = inject(StudyReviewService);
  private readonly studyTopicService = inject(StudyTopicService);
  private readonly topicProgressService = inject(TopicProgressService);

  async loadTodaySummary(userId?: string): Promise<TodaySummary> {
    const effectiveUserId = userId ?? this.authService.userId();
    if (!effectiveUserId) {
      throw new Error('Not authenticated');
    }

    const today = todayDateOnly();
    const [reviews, topics] = await Promise.all([
      this.studyReviewService.getReviewsInRange(effectiveUserId, undefined, today),
      this.studyTopicService.getTopicsInRange(effectiveUserId, today, today),
    ]);

    const pendingReviews: TodayReviewItem[] = reviews
      .filter((review) => review.status === ReviewStatus.PENDING)
      .map((review) => {
        const uiState = this.topicProgressService.getReviewUiState(review);
        return {
          kind: 'review' as const,
          id: review.id,
          topicId: review.topic_id,
          topicTitle: review.study_topic?.title ?? 'Study topic',
          dayOffset: review.day_offset,
          stepOrder: review.step_order,
          reviewDate: review.review_date,
          uiState,
          studyStartTime: review.study_topic?.study_start_time,
          studyEndTime: review.study_topic?.study_end_time,
        };
      })
      .filter(
        (review) =>
          review.uiState === ReviewUiState.TODAY ||
          review.uiState === ReviewUiState.OVERDUE,
      )
      .sort((a, b) => {
        if (a.uiState === ReviewUiState.OVERDUE && b.uiState !== ReviewUiState.OVERDUE) return -1;
        if (b.uiState === ReviewUiState.OVERDUE && a.uiState !== ReviewUiState.OVERDUE) return 1;
        return a.dayOffset - b.dayOffset;
      });

    const studies: TodayStudyItem[] = topics.map((topic) => ({
      kind: 'study' as const,
      topicId: topic.id,
      topicTitle: topic.title,
      studyDate: topic.study_date,
      subject: topic.subject,
      studyStartTime: topic.study_start_time,
      studyEndTime: topic.study_end_time,
    }));

    return {
      date: today,
      reviews: pendingReviews,
      studies,
      pendingReviewCount: pendingReviews.length,
      overdueCount: pendingReviews.filter((r) => r.uiState === ReviewUiState.OVERDUE).length,
    };
  }

  flattenItems(summary: TodaySummary): TodayItem[] {
    return [...summary.studies, ...summary.reviews];
  }
}
