/// <reference path="../edge-runtime.d.ts" />

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export type NotificationChannel = 'EMAIL' | 'DISCORD' | 'BOTH' | 'NONE';
export type LogChannel = 'EMAIL' | 'DISCORD';

export interface NotificationSettingsRow {
  user_id: string;
  channel: NotificationChannel;
  email_destination: string | null;
  email_timezone: string;
  discord_webhook_url: string | null;
}

export interface DueReviewRow {
  id: string;
  user_id: string;
  review_date: string;
  day_offset: number;
  step_order: number;
  study_topic: unknown;
}

export interface LocalParts {
  date: string;
  hour: number;
  minute: number;
}

export interface ReminderRunResult {
  sent: number;
  skipped: number;
  failed: number;
  details: string[];
}

export const DEFAULT_REMINDER_TIME = '08:30:00';

export type JobSource = 'CRON' | 'MANUAL' | 'TEST' | 'SYNC';
export type JobLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

export async function writeJobLog(
  supabase: SupabaseClient,
  payload: {
    user_id: string | null;
    source: JobSource;
    level: JobLevel;
    message: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  const line = `[${payload.source}] ${payload.level}: ${payload.message}`;
  console.log(line, payload.meta ?? '');

  const { error } = await supabase.from('notification_job_logs').insert({
    user_id: payload.user_id,
    source: payload.source,
    level: payload.level,
    message: payload.message,
    meta: payload.meta ?? null,
  });

  if (error) {
    console.error('[job-log] insert failed:', error.message);
  }
}

export function getLocalParts(timezone: string): LocalParts {
  const tz = timezone?.trim() || 'UTC';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '0';

  const rawHour = Number(pick('hour'));
  const hour = rawHour === 24 ? 0 : rawHour;

  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    hour,
    minute: Number(pick('minute')),
  };
}

export function normalizeTopic(
  raw: unknown,
): { title: string; reminder_time: string } | null {
  if (!raw) return null;
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== 'object') return null;
  const topic = row as Record<string, unknown>;
  return {
    title: String(topic.title ?? 'Study topic'),
    reminder_time: String(topic.reminder_time ?? DEFAULT_REMINDER_TIME),
  };
}

function parseTimeToMinutes(timeValue: string): number {
  const normalized = timeValue.trim().slice(0, 8);
  const [hourPart, minutePart = '0'] = normalized.split(':');
  return Number(hourPart) * 60 + Number(minutePart);
}

export function isReminderDue(localNow: LocalParts, reminderTime: string): boolean {
  const nowMinutes = localNow.hour * 60 + localNow.minute;
  const reminderMinutes = parseTimeToMinutes(reminderTime);
  return nowMinutes >= reminderMinutes;
}

async function alreadySent(
  supabase: SupabaseClient,
  reviewId: string,
  channel: LogChannel,
  notificationDate: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('notification_logs')
    .select('id')
    .eq('review_id', reviewId)
    .eq('channel', channel)
    .eq('notification_date', notificationDate)
    .maybeSingle();

  return !!data;
}

async function writeLog(
  supabase: SupabaseClient,
  payload: {
    user_id: string;
    review_id: string;
    channel: LogChannel;
    notification_date: string;
    status: 'SENT' | 'FAILED';
    error_message?: string;
  },
): Promise<void> {
  await supabase.from('notification_logs').insert(payload);
}

async function sendEmailChannel(args: {
  supabase: SupabaseClient;
  settings: NotificationSettingsRow;
  review: DueReviewRow;
  resendApiKey: string | undefined;
  emailFrom: string;
  message: string;
  notificationDate: string;
}): Promise<'sent' | 'failed' | 'skipped'> {
  if (await alreadySent(args.supabase, args.review.id, 'EMAIL', args.notificationDate)) {
    return 'skipped';
  }

  if (!args.resendApiKey) {
    await writeLog(args.supabase, {
      user_id: args.settings.user_id,
      review_id: args.review.id,
      channel: 'EMAIL',
      notification_date: args.notificationDate,
      status: 'FAILED',
      error_message: 'RESEND_API_KEY not configured on server',
    });
    return 'failed';
  }

  if (!args.settings.email_destination?.trim()) {
    await writeLog(args.supabase, {
      user_id: args.settings.user_id,
      review_id: args.review.id,
      channel: 'EMAIL',
      notification_date: args.notificationDate,
      status: 'FAILED',
      error_message: 'No email_destination configured',
    });
    return 'failed';
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: args.emailFrom,
        to: [args.settings.email_destination.trim()],
        subject: 'Spaced Repetition — Review due today',
        text: args.message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      await writeLog(args.supabase, {
        user_id: args.settings.user_id,
        review_id: args.review.id,
        channel: 'EMAIL',
        notification_date: args.notificationDate,
        status: 'FAILED',
        error_message: errorText.slice(0, 500),
      });
      return 'failed';
    }

    await writeLog(args.supabase, {
      user_id: args.settings.user_id,
      review_id: args.review.id,
      channel: 'EMAIL',
      notification_date: args.notificationDate,
      status: 'SENT',
    });
    return 'sent';
  } catch (err) {
    await writeLog(args.supabase, {
      user_id: args.settings.user_id,
      review_id: args.review.id,
      channel: 'EMAIL',
      notification_date: args.notificationDate,
      status: 'FAILED',
      error_message: err instanceof Error ? err.message : 'Email send failed',
    });
    return 'failed';
  }
}

async function sendDiscordChannel(args: {
  supabase: SupabaseClient;
  settings: NotificationSettingsRow;
  review: DueReviewRow;
  webhookUrl: string;
  message: string;
  notificationDate: string;
}): Promise<'sent' | 'failed' | 'skipped'> {
  if (await alreadySent(args.supabase, args.review.id, 'DISCORD', args.notificationDate)) {
    return 'skipped';
  }

  try {
    const response = await fetch(args.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: args.message }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      await writeLog(args.supabase, {
        user_id: args.settings.user_id,
        review_id: args.review.id,
        channel: 'DISCORD',
        notification_date: args.notificationDate,
        status: 'FAILED',
        error_message: errorText.slice(0, 500),
      });
      return 'failed';
    }

    await writeLog(args.supabase, {
      user_id: args.settings.user_id,
      review_id: args.review.id,
      channel: 'DISCORD',
      notification_date: args.notificationDate,
      status: 'SENT',
    });
    return 'sent';
  } catch (err) {
    await writeLog(args.supabase, {
      user_id: args.settings.user_id,
      review_id: args.review.id,
      channel: 'DISCORD',
      notification_date: args.notificationDate,
      status: 'FAILED',
      error_message: err instanceof Error ? err.message : 'Discord send failed',
    });
    return 'failed';
  }
}

export async function sendTestEmail(args: {
  supabase: SupabaseClient;
  userId: string;
  resendApiKey: string | undefined;
  emailFrom: string;
}): Promise<{ ok: boolean; message: string }> {
  await writeJobLog(args.supabase, {
    user_id: args.userId,
    source: 'TEST',
    level: 'INFO',
    message: 'Test email requested',
    meta: { has_resend_key: !!args.resendApiKey, email_from: args.emailFrom },
  });

  const { data: settings, error } = await args.supabase
    .from('notification_settings')
    .select('user_id, channel, email_destination, email_timezone, discord_webhook_url')
    .eq('user_id', args.userId)
    .maybeSingle();

  if (error || !settings) {
    const msg = error?.message ?? 'Notification settings not found.';
    await writeJobLog(args.supabase, {
      user_id: args.userId,
      source: 'TEST',
      level: 'ERROR',
      message: msg,
    });
    return { ok: false, message: msg };
  }

  const row = settings as NotificationSettingsRow;
  if (row.channel !== 'EMAIL' && row.channel !== 'BOTH') {
    const msg = 'Enable Email channel in notification settings first.';
    await writeJobLog(args.supabase, {
      user_id: args.userId,
      source: 'TEST',
      level: 'WARN',
      message: msg,
    });
    return { ok: false, message: msg };
  }

  if (!row.email_destination?.trim()) {
    const msg = 'Set a destination email in notification settings.';
    await writeJobLog(args.supabase, {
      user_id: args.userId,
      source: 'TEST',
      level: 'WARN',
      message: msg,
    });
    return { ok: false, message: msg };
  }

  if (!args.resendApiKey) {
    const msg = 'RESEND_API_KEY is not configured on Supabase (Edge Function secrets).';
    await writeJobLog(args.supabase, {
      user_id: args.userId,
      source: 'TEST',
      level: 'ERROR',
      message: msg,
    });
    return { ok: false, message: msg };
  }

  const localNow = getLocalParts(row.email_timezone);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: args.emailFrom,
      to: [row.email_destination.trim()],
      subject: 'Spaced Repetition — Test notification',
      text: `Test email OK at ${localNow.date} ${String(localNow.hour).padStart(2, '0')}:${String(localNow.minute).padStart(2, '0')} (${row.email_timezone}).`,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const msg = errorText.slice(0, 500);
    await writeJobLog(args.supabase, {
      user_id: args.userId,
      source: 'TEST',
      level: 'ERROR',
      message: `Resend error: ${msg}`,
    });
    return { ok: false, message: msg };
  }

  const okMsg = `Test email sent to ${row.email_destination}.`;
  await writeJobLog(args.supabase, {
    user_id: args.userId,
    source: 'TEST',
    level: 'SUCCESS',
    message: okMsg,
  });
  return { ok: true, message: okMsg };
}

export function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function getUserIdFromAuthHeader(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    console.warn('[auth] Missing bearer token');
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  const supabase = createServiceClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    console.error('[auth] getUser failed:', error?.message ?? 'no user');
    return null;
  }

  console.log('[auth] user authenticated:', user.id);
  return user.id;
}

export {
  processDueSchedulesForUser,
  runRemindersForUser,
  syncReminderSchedulesForUser,
} from './schedule.ts';
