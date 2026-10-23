import { Component, Input, Output, EventEmitter, inject } from '@angular/core';

import { CommonModule } from '@angular/common';

import { StudyReview } from '../../../core/models/study-review.model';

import { ReviewScheduleService } from '../../../core/services/review-schedule.service';

import { TopicProgressService } from '../../../core/services/topic-progress.service';

import { formatShortDisplayDate } from '../../../core/utils/date.utils';

import { ReviewUiState } from '../../../core/enums/review-ui-state.enum';
import { ReviewStatus } from '../../../core/enums/review-status.enum';

import { TranslationService } from '../../../core/i18n/translation.service';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';



@Component({

  selector: 'app-schedule-timeline',

  standalone: true,

  imports: [CommonModule, TranslatePipe],

  templateUrl: './schedule-timeline.component.html',

  styleUrl: './schedule-timeline.component.scss',

})

export class ScheduleTimelineComponent {

  @Input({ required: true }) reviews!: StudyReview[];

  @Input({ required: true }) currentStepOffset!: number;

  @Input() readOnly = false;

  @Input() allowComplete = false;

  @Output() replaceStep = new EventEmitter<StudyReview>();

  @Output() deleteStep = new EventEmitter<StudyReview>();

  @Output() completeStep = new EventEmitter<StudyReview>();



  private readonly i18n = inject(TranslationService);



  constructor(

    protected readonly reviewScheduleService: ReviewScheduleService,

    private readonly topicProgressService: TopicProgressService,

  ) {}



  formatDate(iso: string): string {
    return formatShortDisplayDate(iso, this.i18n.dateLocale());
  }



  getMarker(review: StudyReview): 'done' | 'current' | 'upcoming' {

    return this.reviewScheduleService.getTimelineMarker(review, this.currentStepOffset);

  }



  getMarkerSymbol(review: StudyReview): string {

    const marker = this.getMarker(review);

    if (marker === 'done') return '✓';

    if (marker === 'current') return '●';

    return '○';

  }



  getMarkerLabel(review: StudyReview): string {

    const marker = this.getMarker(review);

    if (marker === 'current') return this.i18n.t('timeline.current');

    if (marker === 'upcoming') return this.i18n.t('timeline.upcoming');

    return '';

  }



  getStatusLabel(review: StudyReview): string {

    const state = this.topicProgressService.getReviewUiState(review);

    switch (state) {

      case ReviewUiState.COMPLETED:

        return this.i18n.t('timeline.completed');

      case ReviewUiState.OVERDUE:

        return this.i18n.t('timeline.overdue');

      case ReviewUiState.TODAY:

        return this.i18n.t('timeline.dueToday');

      default:

        return '';

    }

  }



  getStatusClass(review: StudyReview): string {

    return this.topicProgressService.getReviewUiState(review).toLowerCase();

  }



  canEdit(review: StudyReview): boolean {
    return !this.readOnly && this.reviewScheduleService.isFutureEditableStep(review, this.currentStepOffset);
  }

  canComplete(review: StudyReview): boolean {
    if (!this.allowComplete || review.status !== ReviewStatus.PENDING) return false;

    const state = this.topicProgressService.getReviewUiState(review);
    if (state === ReviewUiState.TODAY || state === ReviewUiState.OVERDUE) return true;

    const nextPending = this.reviews
      .filter((r) => r.status === ReviewStatus.PENDING && r.day_offset >= this.currentStepOffset)
      .sort((a, b) => a.day_offset - b.day_offset)[0];

    return nextPending?.id === review.id;
  }
}



