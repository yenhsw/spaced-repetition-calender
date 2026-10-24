import { Injectable, inject } from '@angular/core';

import { SupabaseService } from './supabase.service';

import { AuthService } from './auth.service';
import { ProfileService } from './profile.service';

import { StudyTopic } from '../models/study-topic.model';
import {
  CreateStudyTopicRequest,
  UpdateStudyTopicRequest,
} from '../models/study-request.model';

import { DateOnly } from '../utils/date-only.utils';



@Injectable({ providedIn: 'root' })

export class StudyTopicService {

  private readonly supabaseService = inject(SupabaseService);

  private readonly authService = inject(AuthService);
  private readonly profileService = inject(ProfileService);



  async getTopicsByUser(userId: string): Promise<StudyTopic[]> {

    const { data, error } = await this.supabaseService.supabase

      .from('study_topics')

      .select('*, study_reviews(*)')

      .eq('user_id', userId)

      .order('study_date', { ascending: false });



    if (error) throw error;

    return this.sortTopicReviews((data ?? []) as StudyTopic[]);

  }



  async getTopicById(topicId: string): Promise<StudyTopic | null> {

    const { data, error } = await this.supabaseService.supabase

      .from('study_topics')

      .select('*, study_reviews(*)')

      .eq('id', topicId)

      .maybeSingle();



    if (error) throw error;

    if (!data) return null;

    return this.sortTopicReviews([data as StudyTopic])[0];

  }



  async createTopic(payload: CreateStudyTopicRequest): Promise<StudyTopic> {

    const userId = payload.user_id ?? this.authService.userId();

    if (!userId) throw new Error('User not authenticated');

    const user = this.authService.getCurrentUser();
    if (user && user.id === userId) {
      await this.profileService.ensureProfile(user);
    }

    const { data, error } = await this.supabaseService.supabase.rpc(

      'create_study_topic_with_reviews',

      {

        p_title: payload.title.trim(),

        p_study_date: payload.study_date,

        p_subject: payload.subject ?? null,

        p_description: payload.description ?? null,

        p_resource_url: payload.resource_url ?? null,

        p_user_id: payload.user_id ?? null,

        p_reminder_time: payload.reminder_time
          ? `${payload.reminder_time.length === 5 ? payload.reminder_time + ':00' : payload.reminder_time}`
          : undefined,

        p_study_start_time: payload.study_start_time
          ? `${payload.study_start_time.length === 5 ? payload.study_start_time + ':00' : payload.study_start_time}`
          : undefined,

        p_study_end_time: payload.study_end_time
          ? `${payload.study_end_time.length === 5 ? payload.study_end_time + ':00' : payload.study_end_time}`
          : undefined,

      },

    );



    if (error) throw error;



    const created = await this.getTopicById((data as StudyTopic).id);

    if (!created) throw new Error('Failed to load created topic');

    return created;

  }



  async updateTopic(topicId: string, payload: UpdateStudyTopicRequest): Promise<StudyTopic> {

    const updateData: Record<string, unknown> = {};

    if (payload.title !== undefined) updateData['title'] = payload.title.trim();

    if (payload.description !== undefined) updateData['description'] = payload.description;

    if (payload.subject !== undefined) updateData['subject'] = payload.subject;

    if (payload.resource_url !== undefined) updateData['resource_url'] = payload.resource_url;

    if (payload.reminder_time !== undefined) {
      const t = payload.reminder_time;
      updateData['reminder_time'] = t.length === 5 ? `${t}:00` : t;
    }

    if (payload.study_start_time !== undefined) {
      const t = payload.study_start_time;
      updateData['study_start_time'] = t.length === 5 ? `${t}:00` : t;
    }

    if (payload.study_end_time !== undefined) {
      const t = payload.study_end_time;
      updateData['study_end_time'] = t.length === 5 ? `${t}:00` : t;
    }

    if (payload.current_step_offset !== undefined) {

      updateData['current_step_offset'] = payload.current_step_offset;

    }



    const { data, error } = await this.supabaseService.supabase

      .from('study_topics')

      .update(updateData)

      .eq('id', topicId)

      .select()

      .single();



    if (error) throw error;

    return data as StudyTopic;

  }



  async deleteTopic(topicId: string): Promise<void> {
    const { error } = await this.supabaseService.supabase.rpc('delete_study_topic', {
      p_topic_id: topicId,
    });
    if (error) throw error;
  }



  async getTopicsInRange(

    userId: string,

    fromDate?: DateOnly,

    toDate?: DateOnly,

  ): Promise<StudyTopic[]> {

    let query = this.supabaseService.supabase

      .from('study_topics')

      .select('*, study_reviews(*)')

      .eq('user_id', userId)

      .order('study_date', { ascending: true });



    if (fromDate) query = query.gte('study_date', fromDate);

    if (toDate) query = query.lte('study_date', toDate);



    const { data, error } = await query;

    if (error) throw error;

    return this.sortTopicReviews((data ?? []) as StudyTopic[]);

  }



  async updateCurrentStepOffset(topicId: string, currentStepOffset: number): Promise<StudyTopic> {

    return this.updateTopic(topicId, { current_step_offset: currentStepOffset });

  }



  private sortTopicReviews(topics: StudyTopic[]): StudyTopic[] {

    return topics.map((topic) => ({

      ...topic,

      study_reviews: [...(topic.study_reviews ?? [])].sort(

        (a, b) => a.day_offset - b.day_offset,

      ),

    }));

  }

}


