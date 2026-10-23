import { DateOnly } from '../utils/date-only.utils';

export interface CreateStudyTopicRequest {
  title: string;
  study_date: DateOnly;
  description?: string | null;
  subject?: string | null;
  resource_url?: string | null;
  /** HH:MM or HH:MM:SS — defaults to 08:30 on server */
  reminder_time?: string;
  study_start_time?: string;
  study_end_time?: string;
  user_id?: string;
  intervals?: readonly number[];
}

export interface UpdateStudyTopicRequest {
  title?: string;
  description?: string | null;
  subject?: string | null;
  resource_url?: string | null;
  reminder_time?: string;
  study_start_time?: string;
  study_end_time?: string;
  current_step_offset?: number;
}

export interface AddReviewStepRequest {
  topicId: string;
  dayOffset: number;
  currentStepOffset: number;
}

export interface ReplaceReviewStepRequest {
  reviewId: string;
  newDayOffset: number;
  currentStepOffset: number;
}

export interface RemoveReviewStepRequest {
  reviewId: string;
  currentStepOffset: number;
}
