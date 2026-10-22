import { StudyReview } from './study-review.model';
import {
  CreateStudyTopicRequest,
  UpdateStudyTopicRequest,
} from './study-request.model';
import { DateOnly } from '../utils/date-only.utils';

export interface StudyTopic {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  subject: string | null;
  resource_url: string | null;
  study_date: DateOnly;
  current_step_offset: number;
  created_at: string;
  updated_at: string;
  study_reviews?: StudyReview[];
}

export type CreateStudyTopicPayload = CreateStudyTopicRequest;
export type UpdateStudyTopicPayload = UpdateStudyTopicRequest;
