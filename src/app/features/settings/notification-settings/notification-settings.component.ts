import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { NotificationSettingsService } from '../../../core/services/notification-settings.service';
import { AuthService } from '../../../core/services/auth.service';
import { PushNotificationService } from '../../../core/services/push-notification.service';
import { PwaInstallService } from '../../../core/services/pwa-install.service';
import { NotificationChannel } from '../../../core/enums/notification-channel.enum';
import { NotificationLog } from '../../../core/models/notification-log.model';
import { NotificationJobLog } from '../../../core/models/notification-job-log.model';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { TranslationService } from '../../../core/i18n/translation.service';

@Component({
  selector: 'app-notification-settings',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, DatePipe],
  templateUrl: './notification-settings.component.html',
  styleUrl: './notification-settings.component.scss',
})
export class NotificationSettingsComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly notificationService = inject(NotificationSettingsService);
  private readonly i18n = inject(TranslationService);
  protected readonly authService = inject(AuthService);
  protected readonly pushService = inject(PushNotificationService);
  protected readonly pwaInstall = inject(PwaInstallService);

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly testingEmail = signal(false);
  protected readonly testingPush = signal(false);
  protected readonly triggering = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly actionDetails = signal<string | null>(null);
  protected readonly logs = signal<NotificationLog[]>([]);
  protected readonly jobLogs = signal<NotificationJobLog[]>([]);
  protected readonly targetUserId = signal<string | null>(null);
  protected readonly NotificationChannel = NotificationChannel;

  /** Set true to restore test buttons, debug logs, and API trace output. */
  protected readonly showDebugUi = false;

  protected readonly form = this.fb.nonNullable.group({
    channel: [NotificationChannel.NONE as NotificationChannel, Validators.required],
    email_destination: [''],
    email_reminder_time: ['09:00'],
    email_timezone: ['Asia/Ho_Chi_Minh'],
    discord_webhook_url: [''],
  });

  ngOnInit(): void {
    const adminUserId = this.route.snapshot.paramMap.get('userId');
    this.targetUserId.set(adminUserId);
    this.pushService.syncSupportState();
    void this.loadSettings();
    void this.pushService.refreshDeviceState();
  }

  get isAdminView(): boolean {
    return !!this.targetUserId() && this.authService.isAdmin();
  }

  async loadSettings(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      const userId = this.targetUserId() ?? undefined;
      const settings = await this.notificationService.getSettings(userId);
      const logs = await this.notificationService.getRecentLogs(15, userId);
      const jobLogs = this.showDebugUi
        ? await this.notificationService.getJobLogs(30, userId)
        : [];

      if (settings) {
        this.form.patchValue({
          channel: settings.channel,
          email_destination: settings.email_destination ?? '',
          email_reminder_time: this.toTimeInput(settings.email_reminder_time),
          email_timezone: settings.email_timezone,
          discord_webhook_url: settings.discord_webhook_url ?? '',
        });
      }

      this.logs.set(logs);
      this.jobLogs.set(jobLogs);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : this.i18n.t('notifications.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  showEmailFields(): boolean {
    const ch = this.form.controls.channel.value;
    return ch === NotificationChannel.EMAIL || ch === NotificationChannel.BOTH;
  }

  showDiscordFields(): boolean {
    const ch = this.form.controls.channel.value;
    return ch === NotificationChannel.DISCORD || ch === NotificationChannel.BOTH;
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const raw = this.form.getRawValue();
      await this.notificationService.upsertSettings(
        {
          channel: raw.channel,
          email_destination: raw.email_destination || null,
          email_reminder_time: `${raw.email_reminder_time}:00`,
          email_timezone: raw.email_timezone,
          discord_webhook_url: raw.discord_webhook_url || null,
        },
        this.targetUserId() ?? undefined,
      );
      this.successMessage.set(this.i18n.t('notifications.success'));
      await this.loadSettings();
      void this.notificationService.syncReminderSchedules().catch(() => undefined);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : this.i18n.t('notifications.error.save'));
    } finally {
      this.saving.set(false);
    }
  }

  showPushSection(): boolean {
    return !this.isAdminView;
  }

  pushErrorMessage(): string | null {
    switch (this.pushService.supportState()) {
      case 'blocked':
        return this.i18n.t('notifications.push.blocked');
      case 'no-vapid':
        return this.i18n.t('notifications.push.noVapid');
      default:
        return null;
    }
  }

  pushDeviceHint(): string | null {
    if (this.pushService.supportState() === 'unsupported') {
      return this.i18n.t('notifications.push.desktopHint');
    }
    return null;
  }

  async togglePush(): Promise<void> {
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      if (this.pushService.subscribedOnDevice()) {
        await this.pushService.unsubscribe();
        this.successMessage.set(this.i18n.t('notifications.push.disabled'));
      } else {
        await this.pushService.subscribe();
        this.successMessage.set(this.i18n.t('notifications.push.enabled'));
        void this.notificationService.syncReminderSchedules().catch(() => undefined);
      }
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : this.i18n.t('notifications.error.save'));
    }
  }

  async sendTestPush(): Promise<void> {
    this.testingPush.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.actionDetails.set(null);

    const debugLines: string[] = [];

    try {
      const result = await this.notificationService.sendTestPush();
      debugLines.push(...result.debugLog);
      this.actionDetails.set(debugLines.join('\n'));
      this.successMessage.set(result.message);
      await this.loadSettings();
    } catch (err: unknown) {
      const withLog = err as Error & { debugLog?: string[] };
      if (withLog.debugLog?.length) {
        debugLines.push(...withLog.debugLog);
      }
      if (debugLines.length) {
        this.actionDetails.set(debugLines.join('\n'));
      }
      this.errorMessage.set(err instanceof Error ? err.message : this.i18n.t('notifications.error.testPush'));
    } finally {
      this.testingPush.set(false);
    }
  }

  async sendTestEmail(): Promise<void> {
    this.testingEmail.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.actionDetails.set(null);

    try {
      const result = await this.notificationService.sendTestEmail();
      this.successMessage.set(result.message);
      await this.loadSettings();
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : this.i18n.t('notifications.error.testEmail'));
    } finally {
      this.testingEmail.set(false);
    }
  }

  async triggerRemindersNow(): Promise<void> {
    this.triggering.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.actionDetails.set(null);

    try {
      const result = await this.notificationService.triggerRemindersNow();
      if (result.sent > 0) {
        this.successMessage.set(this.i18n.t('notifications.triggerSuccess', { count: result.sent }));
      } else if (result.failed > 0) {
        this.errorMessage.set(this.i18n.t('notifications.triggerFailed'));
      } else {
        this.successMessage.set(this.i18n.t('notifications.triggerSkipped'));
      }

      if (result.details?.length) {
        this.actionDetails.set(result.details.join('\n'));
      }

      await this.loadSettings();
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : this.i18n.t('notifications.error.trigger'));
    } finally {
      this.triggering.set(false);
    }
  }

  private toTimeInput(dbTime: string): string {
    return dbTime.slice(0, 5);
  }
}
