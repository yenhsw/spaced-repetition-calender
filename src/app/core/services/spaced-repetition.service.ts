import { Injectable, inject } from '@angular/core';
import { StudyTopicService } from './study-topic.service';
import { StudyReviewService } from './study-review.service';
import { CalendarEventService } from './calendar-event.service';
import { CalendarEvent } from '../models/calendar-event.model';
import { StudyTopic } from '../models/study-topic.model';
import { StudyReview } from '../models/study-review.model';
import { DateOnly } from '../utils/date-only.utils';

export interface CalendarDataRange {
  topics: StudyTopic[];
  reviews: StudyReview[];
  events: CalendarEvent[];
}

@Injectable({ providedIn: 'root' })
export class SpacedRepetitionService {
  private readonly studyTopicService = inject(StudyTopicService);
  private readonly studyReviewService = inject(StudyReviewService);
  private readonly calendarEventService = inject(CalendarEventService);

  /**
   * Loads only events within the visible calendar range (no full history).
   * Reviews include nested topic info via a single relation query.
   */
  async loadCalendarRange(
    userId: string,
    fromDate: DateOnly,
    toDate: DateOnly,
  ): Promise<CalendarDataRange> {
    const [topics, reviews] = await Promise.all([
      this.studyTopicService.getTopicsInRange(userId, fromDate, toDate),
      this.studyReviewService.getReviewsInRange(userId, fromDate, toDate),
    ]);

    const events = this.calendarEventService.buildCalendarEvents(topics, reviews);
    return { topics, reviews, events };
  }
}
