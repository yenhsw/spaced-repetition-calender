import { DateOnly } from '../utils/date-only.utils';

export interface CreateStudyTopicRequest {
  title: string;
  study_date: DateOnly;
  description?: string | null;
  subject?: string | null;
  resource_url?: string | null;
  user_id?: string;
  intervals?: readonly number[];
}

export interface UpdateStudyTopicRequest {
  title?: string;
  description?: string | null;
  subject?: string | null;
  resource_url?: string | null;
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
