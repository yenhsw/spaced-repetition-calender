import { Injectable } from '@angular/core';
import { DEFAULT_SPACED_REPETITION_INTERVALS } from '../constants/spaced-repetition.constants';
import { StudyReview } from '../models/study-review.model';
import { ReviewStatus } from '../enums/review-status.enum';
import {
  addDays,
  formatDateISO,
  formatDisplayDate,
  isPastDate,
  isTodayOrFuture,
  parseISODate,
  todayISO,
} from '../utils/date.utils';

export interface ReviewInsert {
  step_order: number;
  day_offset: number;
  review_date: string;
  status: ReviewStatus;
}

export interface ValidateOffsetOptions {
  reviews: StudyReview[];
  newOffset: number;
  studyDateISO: string;
  currentStepOffset: number;
}

export interface OffsetPreviewValidation {
  valid: boolean;
  reviewDate: string | null;
  intervalLabel: string | null;
  errors: string[];
}

@Injectable({ providedIn: 'root' })
export class ReviewScheduleService {
  computeReviewDate(studyDateISO: string, dayOffset: number): string {
    const studyDate = parseISODate(studyDateISO);
    return formatDateISO(addDays(studyDate, dayOffset));
  }

  buildDefaultReviews(
    studyDateISO: string,
    intervals: readonly number[] = DEFAULT_SPACED_REPETITION_INTERVALS,
  ): ReviewInsert[] {
    return intervals.map((dayOffset, index) => ({
      step_order: index + 1,
      day_offset: dayOffset,
      review_date: this.computeReviewDate(studyDateISO, dayOffset),
      status: ReviewStatus.PENDING,
    }));
  }

  validateNewOffset(options: ValidateOffsetOptions): string | null {
    return this.validateOffsetPreview(options).errors[0] ?? null;
  }

  validateOffsetPreview(options: ValidateOffsetOptions): OffsetPreviewValidation {
    const { reviews, newOffset, studyDateISO, currentStepOffset } = options;
    const errors: string[] = [];

    if (!newOffset || newOffset <= 0) {
      return {
        valid: false,
        reviewDate: null,
        intervalLabel: null,
        errors: ['Review interval must be greater than 0.'],
      };
    }

    const intervalLabel = this.offsetLabel(newOffset);
    const reviewDate = this.computeReviewDate(studyDateISO, newOffset);

    if (reviews.some((r) => r.day_offset === newOffset)) {
      errors.push(`N+${newOffset} already exists in this review schedule.`);
    }

    if (newOffset <= currentStepOffset) {
      errors.push(
        `New review interval must be greater than the current step (N+${currentStepOffset}).`,
      );
    }

    if (isPastDate(reviewDate)) {
      errors.push('This review date has already passed.');
    }

    return {
      valid: errors.length === 0,
      reviewDate,
      intervalLabel,
      errors,
    };
  }

  validateReplaceReview(
    review: StudyReview,
    newOffset: number,
    studyDateISO: string,
    allReviews: StudyReview[],
    currentStepOffset: number,
  ): string | null {
    if (review.status === ReviewStatus.COMPLETED) {
      return 'Cannot modify a completed review.';
    }

    if (!this.isFutureEditableStep(review, currentStepOffset)) {
      return 'Only future pending review steps can be replaced.';
    }

    const otherReviews = allReviews.filter((r) => r.id !== review.id);
    return this.validateNewOffset({
      reviews: otherReviews,
      newOffset,
      studyDateISO,
      currentStepOffset,
    });
  }

  validateDeleteReview(review: StudyReview, currentStepOffset: number): string | null {
    if (review.status === ReviewStatus.COMPLETED) {
      return 'Cannot delete a completed review.';
    }

    if (!this.isFutureEditableStep(review, currentStepOffset)) {
      return 'Only future pending review steps can be deleted.';
    }

    return null;
  }

  /**
   * Editable when: PENDING AND review_date >= today AND day_offset > Current Step
   */
  isFutureEditableStep(review: StudyReview, currentStepOffset: number): boolean {
    return (
      review.status === ReviewStatus.PENDING &&
      isTodayOrFuture(review.review_date) &&
      review.day_offset > currentStepOffset
    );
  }

  isPastStep(review: StudyReview, currentStepOffset: number): boolean {
    return review.day_offset <= currentStepOffset;
  }

  getTimelineMarker(
    review: StudyReview,
    currentStepOffset: number,
  ): 'done' | 'current' | 'upcoming' {
    if (review.status === ReviewStatus.COMPLETED || review.day_offset < currentStepOffset) {
      return 'done';
    }
    if (review.day_offset === currentStepOffset) {
      return 'current';
    }
    return 'upcoming';
  }

  offsetLabel(dayOffset: number): string {
    return dayOffset === 0 ? 'STUDY (N)' : `N+${dayOffset}`;
  }

  inferCurrentStepOffset(reviews: StudyReview[]): number {
    const today = todayISO();
    let maxOffset = 0;

    for (const review of reviews) {
      if (review.status === ReviewStatus.COMPLETED) {
        maxOffset = Math.max(maxOffset, review.day_offset);
      } else if (review.review_date <= today) {
        maxOffset = Math.max(maxOffset, review.day_offset);
      }
    }

    return maxOffset;
  }
}
