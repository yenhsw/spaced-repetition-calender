import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { ReviewScheduleService } from './review-schedule.service';
import { StudyTopicService } from './study-topic.service';
import { StudyReview } from '../models/study-review.model';
import { ReviewStatus } from '../enums/review-status.enum';
import { DateOnly } from '../utils/date-only.utils';
import {
  AddReviewStepRequest,
  ReplaceReviewStepRequest,
  RemoveReviewStepRequest,
} from '../models/study-request.model';

@Injectable({ providedIn: 'root' })
export class StudyReviewService {
  private readonly supabaseService = inject(SupabaseService);
  private readonly reviewScheduleService = inject(ReviewScheduleService);
  private readonly studyTopicService = inject(StudyTopicService);

  async getReviewsInRange(
    userId: string,
    fromDate?: DateOnly,
    toDate?: DateOnly,
  ): Promise<StudyReview[]> {
    let query = this.supabaseService.supabase
      .from('study_reviews')
      .select('*, study_topic:study_topics(id, title, study_date, study_start_time, study_end_time, reminder_time)')
      .eq('user_id', userId)
      .order('review_date', { ascending: true });

    if (fromDate) query = query.gte('review_date', fromDate);
    if (toDate) query = query.lte('review_date', toDate);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as StudyReview[];
  }

  async completeReview(reviewId: string): Promise<StudyReview> {
    const { data, error } = await this.supabaseService.supabase
      .from('study_reviews')
      .update({
        status: ReviewStatus.COMPLETED,
        completed_at: new Date().toISOString(),
      })
      .eq('id', reviewId)
      .select('*, study_topic:study_topics(id, title, study_date, study_start_time, study_end_time, reminder_time)')
      .single();

    if (error) throw error;
    return data as StudyReview;
  }

  async addReviewStep(request: AddReviewStepRequest): Promise<StudyReview> {
    const topic = await this.studyTopicService.getTopicById(request.topicId);
    if (!topic?.study_reviews) throw new Error('Topic not found');

    const validationError = this.reviewScheduleService.validateNewOffset({
      reviews: topic.study_reviews,
      newOffset: request.dayOffset,
      studyDateISO: topic.study_date,
      currentStepOffset: request.currentStepOffset,
    });
    if (validationError) throw new Error(validationError);

    const { data, error } = await this.supabaseService.supabase.rpc('add_review_step', {
      p_topic_id: request.topicId,
      p_day_offset: request.dayOffset,
      p_current_step_offset: request.currentStepOffset,
    });

    if (error) throw error;
    return data as StudyReview;
  }

  async replaceReviewStep(request: ReplaceReviewStepRequest): Promise<StudyReview> {
    const { data: review, error: fetchError } = await this.supabaseService.supabase
      .from('study_reviews')
      .select('*, study_topic:study_topics(id, title, study_date, study_start_time, study_end_time, reminder_time)')
      .eq('id', request.reviewId)
      .single();

    if (fetchError) throw fetchError;

    const topic = await this.studyTopicService.getTopicById(review.topic_id);
    if (!topic?.study_reviews) throw new Error('Topic not found');

    const validationError = this.reviewScheduleService.validateReplaceReview(
      review as StudyReview,
      request.newDayOffset,
      topic.study_date,
      topic.study_reviews,
      request.currentStepOffset,
    );
    if (validationError) throw new Error(validationError);

    const { data, error } = await this.supabaseService.supabase.rpc('replace_review_step', {
      p_review_id: request.reviewId,
      p_new_day_offset: request.newDayOffset,
      p_current_step_offset: request.currentStepOffset,
    });

    if (error) throw error;
    return data as StudyReview;
  }

  async removeReviewStep(request: RemoveReviewStepRequest): Promise<void> {
    const { data: review, error: fetchError } = await this.supabaseService.supabase
      .from('study_reviews')
      .select('*')
      .eq('id', request.reviewId)
      .single();

    if (fetchError) throw fetchError;

    const validationError = this.reviewScheduleService.validateDeleteReview(
      review as StudyReview,
      request.currentStepOffset,
    );
    if (validationError) throw new Error(validationError);

    const { error } = await this.supabaseService.supabase.rpc('remove_review_step', {
      p_review_id: request.reviewId,
      p_current_step_offset: request.currentStepOffset,
    });

    if (error) throw error;
  }
}
