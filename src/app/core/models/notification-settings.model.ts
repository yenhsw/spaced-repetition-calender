import { NotificationChannel } from '../enums/notification-channel.enum';

export interface NotificationSettings {
  user_id: string;
  channel: NotificationChannel;
  email_destination: string | null;
  email_reminder_time: string;
  email_timezone: string;
  discord_webhook_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertNotificationSettingsRequest {
  channel: NotificationChannel;
  email_destination?: string | null;
  email_reminder_time?: string;
  email_timezone?: string;
  discord_webhook_url?: string | null;
}
