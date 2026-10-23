/// <reference path="../edge-runtime.d.ts" />

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  DEFAULT_REMINDER_TIME,
  DueReviewRow,
  JobSource,
  LocalParts,
  normalizeTopic,
  NotificationSettingsRow,
  ReminderRunResult,
  writeJobLog,
} from './reminders.ts';

/** Resend accepts scheduled sends within this window (days). */
export const RESEND_SCHEDULE_HORIZON_DAYS = 30;

export interface ReviewScheduleRow {
  id: string;
  review_id: string;
  user_id: string;
  send_at: string;
  status: 'PENDING' | 'SCHEDULED' | 'SENT' | 'FAILED' | 'CANCELLED';
  resend_email_id: string | null;
}

export function getLocalPartsAt(timezone: string, at: Date): LocalParts {
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

  const parts = formatter.formatToParts(at);
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

/** Wall-clock send time: review_date + reminder_time in the user's timezone → UTC ISO. */
export function computeSendAtUtc(
  reviewDate: string,
  reminderTime: string,
  timezone: string,
): string {
  const tz = timezone?.trim() || 'UTC';
  const normalized = reminderTime.trim().slice(0, 8);
  const [hourStr, minuteStr = '0', secondStr = '0'] = normalized.split(':');
  const targetHour = Number(hourStr);
  const targetMinute = Number(minuteStr);
  const targetSecond = Number(secondStr);
  const [year, month, day] = reviewDate.split('-').map(Number);

  let ts = Date.UTC(year, month - 1, day, targetHour, targetMinute, targetSecond);

  for (let attempt = 0; attempt < 48; attempt++) {
    const local = getLocalPartsAt(tz, new Date(ts));
    if (
      local.date === reviewDate &&
      local.hour === targetHour &&
      local.minute === targetMinute
    ) {
      return new Date(ts).toISOString();
    }

    const [ly, lm, ld] = local.date.split('-').map(Number);
    const dayDiffMs = Date.UTC(year, month - 1, day) - Date.UTC(ly, lm - 1, ld);
    const minuteDiff = (targetHour * 60 + targetMinute) - (local.hour * 60 + local.minute);
    ts += dayDiffMs + minuteDiff * 60 * 1000 - targetSecond * 1000;
  }

  return new Date(ts).toISOString();
}

function daysUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
}

async function upsertScheduleRow(
  supabase: SupabaseClient,
  payload: {
    review_id: string;
    user_id: string;
    send_at: string;
    status?: ReviewScheduleRow['status'];
    resend_email_id?: string | null;
    last_error?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from('review_reminder_schedules').upsert(
    {
      review_id: payload.review_id,
      user_id: payload.user_id,
      send_at: payload.send_at,
      status: payload.status ?? 'PENDING',
      resend_email_id: payload.resend_email_id ?? null,
      last_error: payload.last_error ?? null,
    },
    { onConflict: 'review_id' },
  );

  if (error) {
    console.error('[schedule] upsert failed:', error.message);
  }
}

async function cancelResendEmail(
  resendApiKey: string,
  resendEmailId: string,
): Promise<void> {
  try {
    await fetch(`https://api.resend.com/emails/${resendEmailId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${resendApiKey}` },
    });
  } catch (err) {
    console.warn('[schedule] cancel resend failed:', err);
  }
}

async function alreadySent(
  supabase: SupabaseClient,
  reviewId: string,
  channel: 'EMAIL' | 'DISCORD',
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

async function writeDeliveryLog(
  supabase: SupabaseClient,
  payload: {
    user_id: string;
    review_id: string;
    channel: 'EMAIL' | 'DISCORD';
    notification_date: string;
    status: 'SENT' | 'FAILED';
    error_message?: string;
  },
): Promise<void> {
  await supabase.from('notification_logs').insert(payload);
}

function buildReminderMessage(review: DueReviewRow, topicTitle: string): string {
  const offsetLabel = `N+${review.day_offset}`;
  return `Review due today: ${offsetLabel} · ${topicTitle} (Step ${review.step_order})`;
}

async function sendEmailNow(args: {
  supabase: SupabaseClient;
  settings: NotificationSettingsRow;
  review: DueReviewRow;
  resendApiKey: string | undefined;
  emailFrom: string;
  message: string;
  notificationDate: string;
  scheduledAt?: string;
}): Promise<{ ok: boolean; resendId?: string; error?: string; skipped?: boolean }> {
  if (await alreadySent(args.supabase, args.review.id, 'EMAIL', args.notificationDate)) {
    return { ok: true, skipped: true };
  }

  if (!args.resendApiKey) {
    return { ok: false, error: 'RESEND_API_KEY not configured on server' };
  }

  if (!args.settings.email_destination?.trim()) {
    return { ok: false, error: 'No email_destination configured' };
  }

  const body: Record<string, unknown> = {
    from: args.emailFrom,
    to: [args.settings.email_destination.trim()],
    subject: 'Spaced Repetition — Review due today',
    text: args.message,
  };

  if (args.scheduledAt) {
    body.scheduled_at = args.scheduledAt;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { ok: false, error: errorText.slice(0, 500) };
    }

    const payload = await response.json().catch(() => ({})) as { id?: string };

    if (!args.scheduledAt) {
      await writeDeliveryLog(args.supabase, {
        user_id: args.settings.user_id,
        review_id: args.review.id,
        channel: 'EMAIL',
        notification_date: args.notificationDate,
        status: 'SENT',
      });
    }

    return { ok: true, resendId: payload.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Email send failed',
    };
  }
}

async function sendDiscordNow(args: {
  supabase: SupabaseClient;
  settings: NotificationSettingsRow;
  review: DueReviewRow;
  webhookUrl: string;
  message: string;
  notificationDate: string;
}): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  if (await alreadySent(args.supabase, args.review.id, 'DISCORD', args.notificationDate)) {
    return { ok: true, skipped: true };
  }

  try {
    const response = await fetch(args.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: args.message }),
    });

    if (!response.ok) {
      return { ok: false, error: (await response.text()).slice(0, 500) };
    }

    await writeDeliveryLog(args.supabase, {
      user_id: args.settings.user_id,
      review_id: args.review.id,
      channel: 'DISCORD',
      notification_date: args.notificationDate,
      status: 'SENT',
    });

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Discord send failed',
    };
  }
}

export async function deliverReviewReminder(args: {
  supabase: SupabaseClient;
  settings: NotificationSettingsRow;
  review: DueReviewRow;
  resendApiKey: string | undefined;
  emailFrom: string;
  source: JobSource;
  scheduleRow?: ReviewScheduleRow | null;
  forceNow?: boolean;
}): Promise<'sent' | 'scheduled' | 'skipped' | 'failed'> {
  const topic = normalizeTopic(args.review.study_topic);
  const topicTitle = topic?.title ?? 'Study topic';
  const notificationDate = args.review.review_date;
  const message = buildReminderMessage(args.review, topicTitle);

  const shouldRunEmail =
    args.settings.channel === 'EMAIL' || args.settings.channel === 'BOTH';
  const shouldRunDiscord =
    args.settings.channel === 'DISCORD' || args.settings.channel === 'BOTH';

  if (!shouldRunEmail && !shouldRunDiscord) {
    return 'skipped';
  }

  const sendAt = args.scheduleRow?.send_at ??
    computeSendAtUtc(
      args.review.review_date,
      topic?.reminder_time ?? DEFAULT_REMINDER_TIME,
      args.settings.email_timezone,
    );
  const now = Date.now();
  const sendAtMs = new Date(sendAt).getTime();
  const isDue = args.forceNow || sendAtMs <= now;
  const canScheduleEmail =
    shouldRunEmail &&
    !isDue &&
    daysUntil(sendAt) <= RESEND_SCHEDULE_HORIZON_DAYS &&
    daysUntil(sendAt) > 0;

  let outcome: 'sent' | 'scheduled' | 'skipped' | 'failed' = 'skipped';

  if (shouldRunEmail) {
    if (canScheduleEmail && args.scheduleRow?.status !== 'SCHEDULED') {
      if (args.scheduleRow?.resend_email_id && args.resendApiKey) {
        await cancelResendEmail(args.resendApiKey, args.scheduleRow.resend_email_id);
      }

      const emailResult = await sendEmailNow({
        supabase: args.supabase,
        settings: args.settings,
        review: args.review,
        resendApiKey: args.resendApiKey,
        emailFrom: args.emailFrom,
        message,
        notificationDate,
        scheduledAt: sendAt,
      });

      if (emailResult.skipped) {
        outcome = 'skipped';
        await upsertScheduleRow(args.supabase, {
          review_id: args.review.id,
          user_id: args.settings.user_id,
          send_at: sendAt,
          status: 'SENT',
        });
      } else if (emailResult.ok && emailResult.resendId) {
        outcome = 'scheduled';
        await upsertScheduleRow(args.supabase, {
          review_id: args.review.id,
          user_id: args.settings.user_id,
          send_at: sendAt,
          status: 'SCHEDULED',
          resend_email_id: emailResult.resendId,
        });
        await writeJobLog(args.supabase, {
          user_id: args.settings.user_id,
          source: args.source,
          level: 'SUCCESS',
          message: `Email scheduled for ${sendAt} (${args.settings.email_timezone}) — ${topicTitle}`,
          meta: { review_id: args.review.id, resend_id: emailResult.resendId },
        });
      } else {
        outcome = 'failed';
        await upsertScheduleRow(args.supabase, {
          review_id: args.review.id,
          user_id: args.settings.user_id,
          send_at: sendAt,
          status: 'FAILED',
          last_error: emailResult.error,
        });
        await writeJobLog(args.supabase, {
          user_id: args.settings.user_id,
          source: args.source,
          level: 'ERROR',
          message: `Email schedule failed for ${topicTitle}: ${emailResult.error}`,
          meta: { review_id: args.review.id },
        });
      }
    } else if (isDue) {
      const emailResult = await sendEmailNow({
        supabase: args.supabase,
        settings: args.settings,
        review: args.review,
        resendApiKey: args.resendApiKey,
        emailFrom: args.emailFrom,
        message,
        notificationDate,
      });

      if (emailResult.skipped) {
        outcome = 'skipped';
      } else if (emailResult.ok) {
        outcome = 'sent';
        await upsertScheduleRow(args.supabase, {
          review_id: args.review.id,
          user_id: args.settings.user_id,
          send_at: sendAt,
          status: 'SENT',
        });
        await writeJobLog(args.supabase, {
          user_id: args.settings.user_id,
          source: args.source,
          level: 'SUCCESS',
          message: `Email sent for ${topicTitle} → ${args.settings.email_destination}`,
          meta: { review_id: args.review.id, send_at: sendAt },
        });
      } else {
        outcome = 'failed';
        await upsertScheduleRow(args.supabase, {
          review_id: args.review.id,
          user_id: args.settings.user_id,
          send_at: sendAt,
          status: 'FAILED',
          last_error: emailResult.error,
        });
        await writeDeliveryLog(args.supabase, {
          user_id: args.settings.user_id,
          review_id: args.review.id,
          channel: 'EMAIL',
          notification_date: notificationDate,
          status: 'FAILED',
          error_message: emailResult.error,
        });
      }
    } else if (shouldRunEmail && !shouldRunDiscord) {
      await upsertScheduleRow(args.supabase, {
        review_id: args.review.id,
        user_id: args.settings.user_id,
        send_at: sendAt,
        status: 'PENDING',
      });
      outcome = 'skipped';
    }
  }

  if (shouldRunDiscord && args.settings.discord_webhook_url && isDue) {
    const discordResult = await sendDiscordNow({
      supabase: args.supabase,
      settings: args.settings,
      review: args.review,
      webhookUrl: args.settings.discord_webhook_url,
      message,
      notificationDate,
    });

    if (discordResult.ok && !discordResult.skipped) {
      outcome = outcome === 'failed' ? outcome : 'sent';
      await upsertScheduleRow(args.supabase, {
        review_id: args.review.id,
        user_id: args.settings.user_id,
        send_at: sendAt,
        status: 'SENT',
      });
    } else if (!discordResult.ok) {
      outcome = 'failed';
    }
  }

  return outcome;
}

export async function syncReminderSchedulesForUser(args: {
  supabase: SupabaseClient;
  userId: string;
  topicId?: string;
  resendApiKey: string | undefined;
  emailFrom: string;
  source: JobSource;
}): Promise<ReminderRunResult> {
  const result: ReminderRunResult = { sent: 0, skipped: 0, failed: 0, details: [] };

  const { data: settings, error: settingsError } = await args.supabase
    .from('notification_settings')
    .select('user_id, channel, email_destination, email_timezone, discord_webhook_url')
    .eq('user_id', args.userId)
    .maybeSingle();

  if (settingsError || !settings) {
    const msg = settingsError?.message ?? 'Notification settings not found';
    result.failed++;
    result.details.push(msg);
    return result;
  }

  const row = settings as NotificationSettingsRow;
  if (row.channel === 'NONE') {
    result.skipped++;
    result.details.push('Channel is NONE — reminders not scheduled.');
    return result;
  }

  await writeJobLog(args.supabase, {
    user_id: args.userId,
    source: args.source,
    level: 'INFO',
    message: 'Syncing reminder schedules from topic reminder times',
    meta: { topicId: args.topicId ?? null, timezone: row.email_timezone },
  });

  let reviewQuery = args.supabase
    .from('study_reviews')
    .select(
      'id, user_id, review_date, day_offset, step_order, status, study_topic:study_topics(title, reminder_time)',
    )
    .eq('user_id', args.userId)
    .eq('status', 'PENDING');

  if (args.topicId) {
    reviewQuery = reviewQuery.eq('study_topic_id', args.topicId);
  }

  const { data: reviews, error: reviewsError } = await reviewQuery;

  if (reviewsError) {
    result.failed++;
    result.details.push(reviewsError.message);
    return result;
  }

  const reviewIds = (reviews ?? []).map((r) => (r as DueReviewRow).id);
  const { data: scheduleRows } = reviewIds.length
    ? await args.supabase
      .from('review_reminder_schedules')
      .select('*')
      .in('review_id', reviewIds)
    : { data: [] };

  const scheduleByReview = new Map<string, ReviewScheduleRow>(
    ((scheduleRows ?? []) as ReviewScheduleRow[]).map((s) => [s.review_id, s]),
  );

  for (const raw of reviews ?? []) {
    const review = raw as DueReviewRow & { status: string };
    const topic = normalizeTopic(review.study_topic);
    const sendAt = computeSendAtUtc(
      review.review_date,
      topic?.reminder_time ?? DEFAULT_REMINDER_TIME,
      row.email_timezone,
    );

    const existing = scheduleByReview.get(review.id) ?? null;
    let nextStatus = existing?.status ?? 'PENDING';
    let nextResendId = existing?.resend_email_id ?? null;

    if (
      existing &&
      existing.send_at !== sendAt &&
      existing.resend_email_id &&
      args.resendApiKey
    ) {
      await cancelResendEmail(args.resendApiKey, existing.resend_email_id);
      nextStatus = 'PENDING';
      nextResendId = null;
    }

    await upsertScheduleRow(args.supabase, {
      review_id: review.id,
      user_id: args.userId,
      send_at: sendAt,
      status: nextStatus,
      resend_email_id: nextResendId,
    });

    const scheduleRow = existing
      ? { ...existing, send_at: sendAt, status: nextStatus, resend_email_id: nextResendId }
      : null;
    if (scheduleRow?.status === 'SENT' || scheduleRow?.status === 'CANCELLED') {
      result.skipped++;
      continue;
    }

    const delivery = await deliverReviewReminder({
      supabase: args.supabase,
      settings: row,
      review,
      resendApiKey: args.resendApiKey,
      emailFrom: args.emailFrom,
      source: args.source,
      scheduleRow: scheduleRow
        ? { ...scheduleRow, review_id: review.id, user_id: args.userId }
        : {
          id: '',
          review_id: review.id,
          user_id: args.userId,
          send_at: sendAt,
          status: 'PENDING' as const,
          resend_email_id: null,
        },
    });

    if (delivery === 'sent' || delivery === 'scheduled') {
      if (delivery === 'sent') result.sent++;
      else result.skipped++;
      result.details.push(
        delivery === 'scheduled'
          ? `Scheduled ${topic?.title ?? 'topic'} at ${sendAt}`
          : `Sent ${topic?.title ?? 'topic'}`,
      );
    } else if (delivery === 'failed') {
      result.failed++;
    } else {
      result.skipped++;
    }
  }

  await writeJobLog(args.supabase, {
    user_id: args.userId,
    source: args.source,
    level: result.failed > 0 ? 'WARN' : result.sent > 0 ? 'SUCCESS' : 'INFO',
    message: `Schedule sync finished: sent=${result.sent}, skipped=${result.skipped}, failed=${result.failed}`,
    meta: { details: result.details },
  });

  return result;
}

export async function processDueSchedulesForUser(args: {
  supabase: SupabaseClient;
  settings: NotificationSettingsRow;
  resendApiKey: string | undefined;
  emailFrom: string;
  source: JobSource;
}): Promise<ReminderRunResult> {
  const result: ReminderRunResult = { sent: 0, skipped: 0, failed: 0, details: [] };
  const nowIso = new Date().toISOString();

  const { data: dueRows, error } = await args.supabase
    .from('review_reminder_schedules')
    .select('*, study_reviews(id, user_id, review_date, day_offset, step_order, study_topic:study_topics(title, reminder_time))')
    .eq('user_id', args.settings.user_id)
    .in('status', ['PENDING', 'SCHEDULED', 'FAILED'])
    .lte('send_at', nowIso);

  if (error) {
    result.failed++;
    result.details.push(error.message);
    return result;
  }

  for (const row of dueRows ?? []) {
    const schedule = row as ReviewScheduleRow & { study_reviews: unknown };
    const reviewRaw = schedule.study_reviews;
    const review = (Array.isArray(reviewRaw) ? reviewRaw[0] : reviewRaw) as DueReviewRow | null;
    if (!review) continue;

    if (schedule.status === 'SCHEDULED' && schedule.resend_email_id) {
      await upsertScheduleRow(args.supabase, {
        review_id: schedule.review_id,
        user_id: schedule.user_id,
        send_at: schedule.send_at,
        status: 'SENT',
        resend_email_id: schedule.resend_email_id,
      });
      result.skipped++;
      continue;
    }

    const delivery = await deliverReviewReminder({
      supabase: args.supabase,
      settings: args.settings,
      review,
      resendApiKey: args.resendApiKey,
      emailFrom: args.emailFrom,
      source: args.source,
      scheduleRow: schedule,
      forceNow: true,
    });

    if (delivery === 'sent') result.sent++;
    else if (delivery === 'failed') result.failed++;
    else result.skipped++;
  }

  return result;
}

function mergeResults(a: ReminderRunResult, b: ReminderRunResult): ReminderRunResult {
  return {
    sent: a.sent + b.sent,
    skipped: a.skipped + b.skipped,
    failed: a.failed + b.failed,
    details: [...a.details, ...b.details],
  };
}

/** Sync future sends from topic times, then deliver anything due now. */
export async function runRemindersForUser(args: {
  supabase: SupabaseClient;
  settings: NotificationSettingsRow;
  resendApiKey: string | undefined;
  emailFrom: string;
  ignoreTimeCheck?: boolean;
  source?: JobSource;
}): Promise<ReminderRunResult> {
  const source = args.source ?? 'CRON';

  const syncResult = await syncReminderSchedulesForUser({
    supabase: args.supabase,
    userId: args.settings.user_id,
    resendApiKey: args.resendApiKey,
    emailFrom: args.emailFrom,
    source,
  });

  const dueResult = await processDueSchedulesForUser({
    supabase: args.supabase,
    settings: args.settings,
    resendApiKey: args.resendApiKey,
    emailFrom: args.emailFrom,
    source,
  });

  return mergeResults(syncResult, dueResult);
}
