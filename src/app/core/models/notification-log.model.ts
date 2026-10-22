import { NotificationLogChannel, NotificationLogStatus } from '../enums/notification-channel.enum';
import { DateOnly } from '../utils/date-only.utils';

export interface NotificationLog {
  id: string;
  user_id: string;
  review_id: string;
  channel: NotificationLogChannel;
  notification_date: DateOnly;
  status: NotificationLogStatus;
  error_message: string | null;
  sent_at: string;
}
