export type NotificationJobSource = 'CRON' | 'MANUAL' | 'TEST' | 'SYNC';
export type NotificationJobLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

export interface NotificationJobLog {
  id: string;
  user_id: string | null;
  source: NotificationJobSource;
  level: NotificationJobLevel;
  message: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}
