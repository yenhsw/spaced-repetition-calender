import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
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

  async sendTestPush(): Promise<{ ok: boolean; message: string; debugLog: string[] }> {
    const { result, log } = await this.invokeFunctionWithDebug<{ ok?: boolean; message?: string }>(
      'send-test-push',
    );
    if (!result?.ok) {
      const err = new Error(result?.message ?? this.i18n.t('notifications.error.testPush'));
      (err as Error & { debugLog?: string[] }).debugLog = log;
      throw err;
    }
    return {
      ok: true,
      message: result.message ?? this.i18n.t('notifications.testPushSuccess'),
      debugLog: log,
    };
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
    const { result } = await this.invokeFunctionWithDebug<T>(name, body);
    return result;
  }

  private async invokeFunctionWithDebug<T>(
    name: string,
    body?: Record<string, unknown>,
  ): Promise<{ result: T; log: string[] }> {
    const log: string[] = [];
    const push = (line: string): void => {
      console.log(`[edge-fn:${name}] ${line}`);
      log.push(line);
    };

    const supabase = this.supabaseService.supabase;
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      push('ERROR: no session / access_token');
      throw new Error(this.i18n.t('notifications.error.notAuthenticated'));
    }

    push(`session ok (token ${session.access_token.length} chars)`);
    push(`supabase url: ${environment.supabaseUrl}`);

    const url = `${environment.supabaseUrl}/functions/v1/${name}`;
    push(`POST ${url}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: environment.supabaseAnonKey,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body ?? {}),
      });

      push(`response: HTTP ${response.status} ${response.statusText}`);

      const text = await response.text();
      push(`body: ${text.slice(0, 400)}${text.length > 400 ? '…' : ''}`);

      let payload: T;
      try {
        payload = JSON.parse(text) as T;
      } catch {
        throw new Error(`Invalid JSON: ${text.slice(0, 120)}`);
      }

      if (!response.ok) {
        const message =
          (payload as { message?: string })?.message ??
          (payload as { error?: string })?.error ??
          `HTTP ${response.status}`;
        throw new Error(message);
      }

      return { result: payload, log };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      push(`fetch failed: ${message}`);
      const wrapped = new Error(
        message.includes('Failed to fetch') || message.includes('NetworkError')
          ? this.i18n.t('notifications.error.functionInvoke')
          : message,
      );
      (wrapped as Error & { debugLog?: string[] }).debugLog = log;
      throw wrapped;
    }
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
