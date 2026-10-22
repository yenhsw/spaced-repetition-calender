export interface TopicProgress {
  completedCount: number;
  totalSteps: number;
  currentStepLabel: string;
  nextReviewLabel: string | null;
  nextReviewDate: string | null;
}

export interface UserAdminStats {
  userId: string;
  topicCount: number;
  pendingCount: number;
  overdueCount: number;
  completedCount: number;
}
