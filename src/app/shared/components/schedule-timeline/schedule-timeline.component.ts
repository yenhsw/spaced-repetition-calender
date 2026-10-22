import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StudyReview } from '../../../core/models/study-review.model';
import { ReviewScheduleService } from '../../../core/services/review-schedule.service';
import { TopicProgressService } from '../../../core/services/topic-progress.service';
import { formatShortDisplayDate } from '../../../core/utils/date.utils';
import { ReviewUiState } from '../../../core/enums/review-ui-state.enum';

@Component({
  selector: 'app-schedule-timeline',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './schedule-timeline.component.html',
  styleUrl: './schedule-timeline.component.scss',
})
export class ScheduleTimelineComponent {
  @Input({ required: true }) reviews!: StudyReview[];
  @Input({ required: true }) currentStepOffset!: number;
  @Input() readOnly = false;

  @Output() replaceStep = new EventEmitter<StudyReview>();
  @Output() deleteStep = new EventEmitter<StudyReview>();

  constructor(
    protected readonly reviewScheduleService: ReviewScheduleService,
    private readonly topicProgressService: TopicProgressService,
  ) {}

  formatDate(iso: string): string {
    return formatShortDisplayDate(iso);
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
    if (marker === 'current') return 'Current';
    if (marker === 'upcoming') return 'Upcoming';
    return '';
  }

  getStatusLabel(review: StudyReview): string {
    const state = this.topicProgressService.getReviewUiState(review);
    switch (state) {
      case ReviewUiState.COMPLETED:
        return 'Completed';
      case ReviewUiState.OVERDUE:
        return 'Overdue';
      case ReviewUiState.TODAY:
        return 'Due today';
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
}
