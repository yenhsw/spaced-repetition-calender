import { Injectable, inject } from '@angular/core';
import { NotificationSettingsService } from './notification-settings.service';

/** Syncs server-side reminder schedules when topics or settings change (no polling). */
@Injectable({ providedIn: 'root' })
export class ReminderSyncService {
  private readonly notificationSettings = inject(NotificationSettingsService);

  /** Re-register send times after create/update topic or notification settings. */
  sync(topicId?: string): void {
    void this.notificationSettings.syncReminderSchedules(topicId).catch(() => {
      // NONE channel or missing settings — safe to ignore
    });
  }
}
