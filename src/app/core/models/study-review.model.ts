import { ReviewStatus } from '../enums/review-status.enum';
import { DateOnly } from '../utils/date-only.utils';

export interface StudyReview {
  id: string;
  topic_id: string;
  user_id: string;
  step_order: number;
  day_offset: number;
  review_date: DateOnly;
  status: ReviewStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  study_topic?: {
    id: string;
    title: string;
    study_date: DateOnly;
    study_start_time?: string;
    study_end_time?: string;
    reminder_time?: string;
  };
}
