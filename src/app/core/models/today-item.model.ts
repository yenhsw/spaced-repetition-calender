import { CalendarEventType } from '../enums/calendar-event-type.enum';
import { ReviewUiState } from '../enums/review-ui-state.enum';

export interface TodayReviewItem {
  kind: 'review';
  id: string;
  topicId: string;
  topicTitle: string;
  dayOffset: number;
  stepOrder: number;
  reviewDate: string;
  uiState: ReviewUiState;
  studyStartTime?: string;
  studyEndTime?: string;
}

export interface TodayStudyItem {
  kind: 'study';
  topicId: string;
  topicTitle: string;
  studyDate: string;
  subject?: string | null;
  studyStartTime?: string;
  studyEndTime?: string;
}

export type TodayItem = TodayReviewItem | TodayStudyItem;

export interface TodaySummary {
  date: string;
  reviews: TodayReviewItem[];
  studies: TodayStudyItem[];
  pendingReviewCount: number;
  overdueCount: number;
}
