import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import {
  NotificationSettings,
  UpsertNotificationSettingsRequest,
} from '../models/notification-settings.model';
import { NotificationLog } from '../models/notification-log.model';
import { NotificationChannel } from '../enums/notification-channel.enum';

@Injectable({ providedIn: 'root' })
export class NotificationSettingsService {
  private readonly supabaseService = inject(SupabaseService);
  private readonly authService = inject(AuthService);

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
    if (!current) throw new Error('Not authenticated');

    if (userId && userId !== current) {
      if (!this.authService.isAdmin()) {
        throw new Error('Permission denied');
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
      throw new Error('Email destination is required for Email notifications.');
    }

    if (needsDiscord && !payload.discord_webhook_url?.trim()) {
      throw new Error('Discord webhook URL is required for Discord notifications.');
    }

    if (payload.discord_webhook_url?.trim()) {
      const url = payload.discord_webhook_url.trim();
      if (!url.startsWith('https://discord.com/api/webhooks/')) {
        throw new Error('Discord webhook URL must be a valid Discord webhook URL.');
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
