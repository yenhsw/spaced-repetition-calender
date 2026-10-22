import { CalendarEventType } from '../enums/calendar-event-type.enum';
import { ReviewStatus } from '../enums/review-status.enum';
import { ReviewUiState } from '../enums/review-ui-state.enum';

export type CalendarEventIcon = 'study' | 'review' | 'today' | 'completed' | 'overdue';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  allDay: true;
  backgroundColor: string;
  borderColor: string;
  extendedProps: {
    eventType: CalendarEventType;
    uiState?: ReviewUiState;
    icon: CalendarEventIcon;
    badgeText?: string;
    stepLabel?: string;
    topicId: string;
    topicTitle: string;
    reviewId?: string;
    stepOrder?: number;
    dayOffset?: number;
    status?: ReviewStatus;
    userId: string;
  };
}
