import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { NotificationSettingsService } from '../../../core/services/notification-settings.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationChannel } from '../../../core/enums/notification-channel.enum';
import { NotificationLog } from '../../../core/models/notification-log.model';

@Component({
  selector: 'app-notification-settings',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './notification-settings.component.html',
  styleUrl: './notification-settings.component.scss',
})
export class NotificationSettingsComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly notificationService = inject(NotificationSettingsService);
  protected readonly authService = inject(AuthService);

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly logs = signal<NotificationLog[]>([]);
  protected readonly targetUserId = signal<string | null>(null);
  protected readonly NotificationChannel = NotificationChannel;

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
    void this.loadSettings();
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
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Failed to load settings');
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
      this.successMessage.set('Notification settings saved.');
      await this.loadSettings();
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      this.saving.set(false);
    }
  }

  private toTimeInput(dbTime: string): string {
    return dbTime.slice(0, 5);
  }
}
