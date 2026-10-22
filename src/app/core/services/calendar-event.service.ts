import { Injectable, inject } from '@angular/core';
import { CalendarEvent, CalendarEventIcon } from '../models/calendar-event.model';
import { StudyTopic } from '../models/study-topic.model';
import { StudyReview } from '../models/study-review.model';
import { CalendarEventType } from '../enums/calendar-event-type.enum';
import { ReviewUiState } from '../enums/review-ui-state.enum';
import { ReviewScheduleService } from './review-schedule.service';
import { TopicProgressService } from './topic-progress.service';

@Injectable({ providedIn: 'root' })
export class CalendarEventService {
  private readonly reviewScheduleService = inject(ReviewScheduleService);
  private readonly topicProgressService = inject(TopicProgressService);

  buildCalendarEvents(topics: StudyTopic[], reviews: StudyReview[]): CalendarEvent[] {
    const studyEvents = topics.map((topic) => this.toStudyEvent(topic));
    const reviewEvents = reviews.map((review) => this.toReviewEvent(review));
    return [...studyEvents, ...reviewEvents];
  }

  toStudyEvent(topic: StudyTopic): CalendarEvent {
    return {
      id: `study-${topic.id}`,
      title: topic.title,
      start: topic.study_date,
      allDay: true,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      extendedProps: {
        eventType: CalendarEventType.STUDY,
        icon: 'study',
        topicId: topic.id,
        topicTitle: topic.title,
        userId: topic.user_id,
      },
    };
  }

  toReviewEvent(review: StudyReview): CalendarEvent {
    const topicTitle = review.study_topic?.title ?? 'Topic';
    const offsetLabel = this.reviewScheduleService.offsetLabel(review.day_offset);
    const stepLabel = `Step ${review.step_order}`;
    const uiState = this.topicProgressService.getReviewUiState(review);
    const icon = this.getReviewIcon(uiState);

    return {
      id: review.id,
      title: `${offsetLabel} · ${topicTitle}`,
      start: review.review_date,
      allDay: true,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      extendedProps: {
        eventType: CalendarEventType.REVIEW,
        uiState,
        icon,
        badgeText: offsetLabel,
        stepLabel,
        topicId: review.topic_id,
        topicTitle,
        reviewId: review.id,
        stepOrder: review.step_order,
        dayOffset: review.day_offset,
        status: review.status,
        userId: review.user_id,
      },
    };
  }

  private getReviewIcon(state: ReviewUiState): CalendarEventIcon {
    switch (state) {
      case ReviewUiState.COMPLETED:
        return 'completed';
      case ReviewUiState.OVERDUE:
        return 'overdue';
      case ReviewUiState.TODAY:
        return 'today';
      default:
        return 'review';
    }
  }
}
