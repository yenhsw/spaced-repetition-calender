import { Injectable, inject } from '@angular/core';
import { StudyTopic } from '../models/study-topic.model';
import { StudyReview } from '../models/study-review.model';
import { TopicProgress } from '../models/topic-progress.model';
import { ReviewStatus } from '../enums/review-status.enum';
import { ReviewUiState } from '../enums/review-ui-state.enum';
import { ReviewScheduleService } from './review-schedule.service';
import { isPastDate, todayISO } from '../utils/date.utils';

@Injectable({ providedIn: 'root' })
export class TopicProgressService {
  private readonly reviewScheduleService = inject(ReviewScheduleService);

  getReviewUiState(review: StudyReview): ReviewUiState {
    if (review.status === ReviewStatus.COMPLETED) {
      return ReviewUiState.COMPLETED;
    }
    if (review.review_date === todayISO()) {
      return ReviewUiState.TODAY;
    }
    if (isPastDate(review.review_date)) {
      return ReviewUiState.OVERDUE;
    }
    return ReviewUiState.UPCOMING;
  }

  getTopicProgress(topic: StudyTopic, currentStepOffset: number): TopicProgress {
    const reviews = [...(topic.study_reviews ?? [])].sort((a, b) => a.day_offset - b.day_offset);
    const totalSteps = reviews.length;
    const completedCount = reviews.filter((r) => r.status === ReviewStatus.COMPLETED).length;

    const currentStepLabel = this.reviewScheduleService.offsetLabel(currentStepOffset);

    const nextReview = reviews.find(
      (r) => r.status === ReviewStatus.PENDING && r.day_offset > currentStepOffset,
    );

    return {
      completedCount,
      totalSteps,
      currentStepLabel,
      nextReviewLabel: nextReview
        ? this.reviewScheduleService.offsetLabel(nextReview.day_offset)
        : null,
      nextReviewDate: nextReview?.review_date ?? null,
    };
  }
}
