import { Injectable, inject } from '@angular/core';
import { CalendarEvent, CalendarEventIcon } from '../models/calendar-event.model';
import { StudyTopic } from '../models/study-topic.model';
import { StudyReview } from '../models/study-review.model';
import { CalendarEventType } from '../enums/calendar-event-type.enum';
import { ReviewUiState } from '../enums/review-ui-state.enum';
import { ReviewScheduleService } from './review-schedule.service';
import { TopicProgressService } from './topic-progress.service';
import { TranslationService } from '../i18n/translation.service';
import {
  DEFAULT_STUDY_END_TIME,
  DEFAULT_STUDY_START_TIME,
} from '../constants/reminder.constants';
import { toLocalDateTimeIso } from '../utils/study-time.utils';
import { DateOnly } from '../utils/date-only.utils';

@Injectable({ providedIn: 'root' })
export class CalendarEventService {
  private readonly reviewScheduleService = inject(ReviewScheduleService);
  private readonly topicProgressService = inject(TopicProgressService);
  private readonly i18n = inject(TranslationService);

  buildCalendarEvents(topics: StudyTopic[], reviews: StudyReview[]): CalendarEvent[] {
    const topicById = new Map(topics.map((topic) => [topic.id, topic]));
    const studyEvents = topics.map((topic) => this.toStudyEvent(topic));
    const reviewEvents = reviews.map((review) =>
      this.toReviewEvent(review, topicById.get(review.topic_id)),
    );
    return [...studyEvents, ...reviewEvents];
  }

  toStudyEvent(topic: StudyTopic): CalendarEvent {
    const { start, end } = this.resolveEventWindow(
      topic.study_date,
      topic.study_start_time,
      topic.study_end_time,
    );

    return {
      id: `study-${topic.id}`,
      title: topic.title,
      start,
      end,
      allDay: false,
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

  toReviewEvent(review: StudyReview, topicFromRange?: StudyTopic): CalendarEvent {
    const topicTitle = review.study_topic?.title ?? topicFromRange?.title ?? this.i18n.t('calendar.defaultTopicTitle');
    const offsetLabel = this.reviewScheduleService.offsetLabel(review.day_offset);
    const stepLabel = this.i18n.t('timeline.step', { order: review.step_order });
    const uiState = this.topicProgressService.getReviewUiState(review);
    const icon = this.getReviewIcon(uiState);

    const startTime =
      review.study_topic?.study_start_time ??
      topicFromRange?.study_start_time;
    const endTime =
      review.study_topic?.study_end_time ??
      topicFromRange?.study_end_time;

    const { start, end } = this.resolveEventWindow(review.review_date, startTime, endTime);

    return {
      id: review.id,
      title: `${offsetLabel} · ${topicTitle}`,
      start,
      end,
      allDay: false,
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

  private resolveEventWindow(
    date: DateOnly,
    startTime?: string | null,
    endTime?: string | null,
  ): { start: string; end: string } {
    const start = toLocalDateTimeIso(date, startTime, DEFAULT_STUDY_START_TIME);
    const end = toLocalDateTimeIso(date, endTime, DEFAULT_STUDY_END_TIME);
    return { start, end };
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
