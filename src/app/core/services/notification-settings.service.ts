import { Injectable, inject } from '@angular/core';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import {
  NotificationSettings,
  UpsertNotificationSettingsRequest,
} from '../models/notification-settings.model';
import { NotificationLog } from '../models/notification-log.model';
import { NotificationJobLog } from '../models/notification-job-log.model';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { TranslationService } from '../i18n/translation.service';

@Injectable({ providedIn: 'root' })
export class NotificationSettingsService {
  private readonly supabaseService = inject(SupabaseService);
  private readonly authService = inject(AuthService);
  private readonly i18n = inject(TranslationService);

  async getSettings(userId?: string): Promise<NotificationSettings | null> {
    const targetUserId = this.resolveUserId(userId);

    const { data, error } = await this.supabaseService.supabase
      .from('notification_settings')
      .select('*')
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (error) throw error;
    return data as NotificationSettings | null;
  }

  async upsertSettings(
    payload: UpsertNotificationSettingsRequest,
    userId?: string,
  ): Promise<NotificationSettings> {
    const targetUserId = this.resolveUserId(userId);
    this.validatePayload(payload);

    const row = {
      user_id: targetUserId,
      channel: payload.channel,
      email_destination: this.normalizeEmail(payload),
      email_reminder_time: payload.email_reminder_time ?? '09:00:00',
      email_timezone: payload.email_timezone ?? 'UTC',
      discord_webhook_url: this.normalizeWebhook(payload),
    };

    const { data, error } = await this.supabaseService.supabase
      .from('notification_settings')
      .upsert(row, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;
    return data as NotificationSettings;
  }

  async sendTestPush(): Promise<{ ok: boolean; message: string }> {
    const result = await this.invokeFunction<{ ok?: boolean; message?: string }>('send-test-push');
    if (!result?.ok) {
      throw new Error(result?.message ?? this.i18n.t('notifications.error.testPush'));
    }
    return { ok: true, message: result.message ?? this.i18n.t('notifications.testPushSuccess') };
  }

  async sendTestEmail(): Promise<{ ok: boolean; message: string }> {
    const result = await this.invokeFunction<{ ok?: boolean; message?: string }>('send-test-email');
    if (!result?.ok) {
      throw new Error(result?.message ?? this.i18n.t('notifications.error.testEmail'));
    }
    return { ok: true, message: result.message ?? this.i18n.t('notifications.testEmailSuccess') };
  }

  async syncReminderSchedules(topicId?: string): Promise<{
    ok: boolean;
    sent: number;
    skipped: number;
    failed: number;
    details?: string[];
  }> {
    const body = topicId ? { topicId } : undefined;
    return this.invokeFunction('sync-reminder-schedules', body);
  }

  async triggerRemindersNow(): Promise<{
    ok: boolean;
    sent: number;
    skipped: number;
    failed: number;
    details?: string[];
    message?: string;
  }> {
    return this.invokeFunction('trigger-my-reminders');
  }

  async getJobLogs(limit = 30, userId?: string): Promise<NotificationJobLog[]> {
    const targetUserId = this.resolveUserId(userId);

    const { data, error } = await this.supabaseService.supabase
      .from('notification_job_logs')
      .select('*')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      // Table may not exist until migration 008 is applied
      if (error.code === '42P01' || error.message.includes('notification_job_logs')) {
        return [];
      }
      throw error;
    }

    return (data ?? []) as NotificationJobLog[];
  }

  private async invokeFunction<T>(name: string, body?: Record<string, unknown>): Promise<T> {
    const supabase = this.supabaseService.supabase;
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error(this.i18n.t('notifications.error.notAuthenticated'));
    }

    const { data, error } = await supabase.functions.invoke(name, {
      body: body ?? {},
      headers: {
        // Bypass Angular service worker — it can block Edge Function POST on iOS PWA.
        'ngsw-bypass': 'true',
      },
    });

    if (error) {
      throw new Error(await this.extractFunctionError(error, data));
    }

    return data as T;
  }

  private async extractFunctionError(error: unknown, data: unknown): Promise<string> {
    if (data && typeof data === 'object') {
      const payload = data as { message?: string; error?: string };
      if (payload.message) return payload.message;
      if (payload.error) return payload.error;
    }

    if (error instanceof FunctionsHttpError) {
      try {
        const payload = await error.context.json();
        if (payload?.message) return String(payload.message);
        if (payload?.error) return String(payload.error);
      } catch {
        /* ignore parse errors */
      }
    }

    if (error instanceof Error && error.message) {
      if (error.message.includes('Failed to send a request to the Edge Function')) {
        return this.i18n.t('notifications.error.functionInvoke');
      }
      return error.message;
    }
    return this.i18n.t('notifications.error.functionInvoke');
  }

  async getRecentLogs(limit = 20, userId?: string): Promise<NotificationLog[]> {
    const targetUserId = this.resolveUserId(userId);

    const { data, error } = await this.supabaseService.supabase
      .from('notification_logs')
      .select('*')
      .eq('user_id', targetUserId)
      .order('sent_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data ?? []) as NotificationLog[];
  }

  private resolveUserId(userId?: string): string {
    const current = this.authService.userId();
    if (!current) throw new Error(this.i18n.t('notifications.error.notAuthenticated'));

    if (userId && userId !== current) {
      if (!this.authService.isAdmin()) {
        throw new Error(this.i18n.t('notifications.error.permissionDenied'));
      }
      return userId;
    }

    return userId ?? current;
  }

  private validatePayload(payload: UpsertNotificationSettingsRequest): void {
    const needsEmail =
      payload.channel === NotificationChannel.EMAIL ||
      payload.channel === NotificationChannel.BOTH;
    const needsDiscord =
      payload.channel === NotificationChannel.DISCORD ||
      payload.channel === NotificationChannel.BOTH;

    if (needsEmail && !payload.email_destination?.trim()) {
      throw new Error(this.i18n.t('notifications.error.emailRequired'));
    }

    if (needsDiscord && !payload.discord_webhook_url?.trim()) {
      throw new Error(this.i18n.t('notifications.error.webhookRequired'));
    }

    if (payload.discord_webhook_url?.trim()) {
      const url = payload.discord_webhook_url.trim();
      if (!url.startsWith('https://discord.com/api/webhooks/')) {
        throw new Error(this.i18n.t('notifications.error.invalidWebhook'));
      }
    }
  }

  private normalizeEmail(payload: UpsertNotificationSettingsRequest): string | null {
    if (
      payload.channel === NotificationChannel.NONE ||
      payload.channel === NotificationChannel.DISCORD
    ) {
      return payload.email_destination?.trim() || null;
    }
    return payload.email_destination?.trim() ?? null;
  }

  private normalizeWebhook(payload: UpsertNotificationSettingsRequest): string | null {
    if (
      payload.channel === NotificationChannel.NONE ||
      payload.channel === NotificationChannel.EMAIL
    ) {
      return null;
    }
    return payload.discord_webhook_url?.trim() ?? null;
  }
}
