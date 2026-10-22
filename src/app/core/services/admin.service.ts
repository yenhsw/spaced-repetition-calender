import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { UserAdminStats } from '../models/topic-progress.model';
import { StudyReview } from '../models/study-review.model';
import { ReviewStatus } from '../enums/review-status.enum';
import { TopicProgressService } from './topic-progress.service';
import { ReviewUiState } from '../enums/review-ui-state.enum';
import { ProfileService } from './profile.service';
import { UserProfile } from '../models/profile.model';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly supabaseService = inject(SupabaseService);
  private readonly topicProgressService = inject(TopicProgressService);
  private readonly profileService = inject(ProfileService);

  searchUsers(keyword: string): Promise<UserProfile[]> {
    return this.profileService.searchProfiles(keyword);
  }

  listUsers(): Promise<UserProfile[]> {
    return this.profileService.listAllProfiles();
  }

  async getStatsForUsers(userIds: string[]): Promise<Map<string, UserAdminStats>> {
    const statsMap = new Map<string, UserAdminStats>();

    if (userIds.length === 0) return statsMap;

    for (const id of userIds) {
      statsMap.set(id, {
        userId: id,
        topicCount: 0,
        pendingCount: 0,
        overdueCount: 0,
        completedCount: 0,
      });
    }

    const { data: topics, error: topicsError } = await this.supabaseService.supabase
      .from('study_topics')
      .select('id, user_id')
      .in('user_id', userIds);

    if (topicsError) throw topicsError;

    for (const topic of topics ?? []) {
      const entry = statsMap.get(topic.user_id);
      if (entry) entry.topicCount += 1;
    }

    const { data: reviews, error: reviewsError } = await this.supabaseService.supabase
      .from('study_reviews')
      .select('*')
      .in('user_id', userIds);

    if (reviewsError) throw reviewsError;

    for (const review of (reviews ?? []) as StudyReview[]) {
      const entry = statsMap.get(review.user_id);
      if (!entry) continue;

      const uiState = this.topicProgressService.getReviewUiState(review);

      if (review.status === ReviewStatus.COMPLETED) {
        entry.completedCount += 1;
      } else if (uiState === ReviewUiState.OVERDUE) {
        entry.overdueCount += 1;
      } else {
        entry.pendingCount += 1;
      }
    }

    return statsMap;
  }
}
