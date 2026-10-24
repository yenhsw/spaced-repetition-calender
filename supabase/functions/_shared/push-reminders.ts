/// <reference path="../edge-runtime.d.ts" />

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  getLocalParts,
  JobSource,
  NotificationSettingsRow,
  ReminderRunResult,
  writeJobLog,
} from './reminders.ts';
import {
  buildReminderTimePushText,
  buildTaskLeadPushText,
  buildTodayPushText,
  DAILY_DIGEST_TIME,
  getTodayTasks,
  isLocalTimeMatch,
  parseClockTime,
  reminderTimeMatchesDailyDigest,
  subtractMinutesFromClock,
  TASK_LEAD_MINUTES,
  TodayTaskItem,
} from './today-count.ts';
import { getUserPushSubscriptions, sendPushToUser } from './web-push.ts';

async function pushReminderAlreadySent(
  supabase: SupabaseClient,
  userId: string,
  dedupKey: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('push_reminder_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('dedup_key', dedupKey)
    .maybeSingle();

  return !!data;
}

async function writePushReminderLog(
  supabase: SupabaseClient,
  payload: {
    user_id: string;
    dedup_key: string;
    notification_date: string;
    status: 'SENT' | 'FAILED';
    error_message?: string;
  },
): Promise<void> {
  const { error } = await supabase.from('push_reminder_logs').insert(payload);
  if (error && !error.message.includes('duplicate')) {
    console.error('[push-reminders] log insert failed:', error.message);
  }
}

async function sendPushOnce(args: {
  supabase: SupabaseClient;
  userId: string;
  dedupKey: string;
  notificationDate: string;
  title: string;
  body: string;
  badgeCount?: number;
}): Promise<'sent' | 'failed' | 'skipped'> {
  if (await pushReminderAlreadySent(args.supabase, args.userId, args.dedupKey)) {
    return 'skipped';
  }

  const result = await sendPushToUser({
    supabase: args.supabase,
    userId: args.userId,
    payload: {
      title: args.title,
      body: args.body,
      url: '/spaced-repetition/today',
      badgeCount: args.badgeCount,
    },
  });

  if (result.sent > 0) {
    await writePushReminderLog(args.supabase, {
      user_id: args.userId,
      dedup_key: args.dedupKey,
      notification_date: args.notificationDate,
      status: 'SENT',
    });
    return 'sent';
  }

  if (result.failed > 0 || result.errors.length > 0) {
    await writePushReminderLog(args.supabase, {
      user_id: args.userId,
      dedup_key: args.dedupKey,
      notification_date: args.notificationDate,
      status: 'FAILED',
      error_message: result.errors[0] ?? 'Push send failed',
    });
    return 'failed';
  }

  return 'skipped';
}

function dailyDigestDedupKey(today: string): string {
  return `daily:${today}`;
}

function taskLeadDedupKey(item: TodayTaskItem, today: string): string {
  return `lead:${item.kind}:${item.id}:${today}`;
}

function taskLeadFireTime(item: TodayTaskItem): { hour: number; minute: number } | null {
  const start = parseClockTime(item.startTime);
  if (!start) return null;
  return subtractMinutesFromClock(start.hour, start.minute, TASK_LEAD_MINUTES);
}

function reminderTimeDedupKey(item: TodayTaskItem, today: string): string {
  return `reminder:${item.kind}:${item.id}:${today}`;
}

function topicReminderFireTime(item: TodayTaskItem): { hour: number; minute: number } | null {
  return parseClockTime(item.reminderTime);
}

/** Daily 08:30 digest + lead push 10 min before study_start + topic reminder_time push. */
export async function processPushRemindersForUser(args: {
  supabase: SupabaseClient;
  settings: NotificationSettingsRow;
  source: JobSource;
}): Promise<ReminderRunResult> {
  const result: ReminderRunResult = { sent: 0, skipped: 0, failed: 0, details: [] };

  const subscriptions = await getUserPushSubscriptions(args.supabase, args.settings.user_id);
  if (subscriptions.length === 0) {
    result.skipped++;
    result.details.push('No push subscriptions');
    return result;
  }

  const timezone = args.settings.email_timezone?.trim() || 'Asia/Ho_Chi_Minh';
  const localNow = getLocalParts(timezone);
  const todayStats = await getTodayTasks({
    supabase: args.supabase,
    userId: args.settings.user_id,
    timezone,
  });

  const digestTime = parseClockTime(DAILY_DIGEST_TIME);
  if (
    digestTime &&
    isLocalTimeMatch(localNow.hour, localNow.minute, digestTime.hour, digestTime.minute)
  ) {
    const { title, body } = buildTodayPushText(todayStats.items);
    const delivery = await sendPushOnce({
      supabase: args.supabase,
      userId: args.settings.user_id,
      dedupKey: dailyDigestDedupKey(todayStats.today),
      notificationDate: todayStats.today,
      title,
      body,
      badgeCount: todayStats.count > 0 ? todayStats.count : undefined,
    });

    if (delivery === 'sent') {
      result.sent++;
      result.details.push(`Daily digest (${todayStats.count} items)`);
      await writeJobLog(args.supabase, {
        user_id: args.settings.user_id,
        source: args.source,
        level: 'SUCCESS',
        message: `Daily push digest sent (${todayStats.count} items)`,
        meta: { today: todayStats.today, count: todayStats.count },
      });
    } else if (delivery === 'failed') {
      result.failed++;
      result.details.push('Daily digest failed');
    } else {
      result.skipped++;
    }
  }

  for (const item of todayStats.items) {
    const fireAt = taskLeadFireTime(item);
    if (!fireAt) continue;

    if (!isLocalTimeMatch(localNow.hour, localNow.minute, fireAt.hour, fireAt.minute)) {
      continue;
    }

    const { title, body } = buildTaskLeadPushText(item);
    const delivery = await sendPushOnce({
      supabase: args.supabase,
      userId: args.settings.user_id,
      dedupKey: taskLeadDedupKey(item, todayStats.today),
      notificationDate: todayStats.today,
      title,
      body,
      badgeCount: todayStats.count > 0 ? todayStats.count : undefined,
    });

    if (delivery === 'sent') {
      result.sent++;
      result.details.push(`Lead reminder: ${item.title}`);
      await writeJobLog(args.supabase, {
        user_id: args.settings.user_id,
        source: args.source,
        level: 'SUCCESS',
        message: `Task lead push sent — ${item.title}`,
        meta: { item_id: item.id, kind: item.kind, fire_at: fireAt },
      });
    } else if (delivery === 'failed') {
      result.failed++;
      result.details.push(`Lead reminder failed: ${item.title}`);
    } else {
      result.skipped++;
    }

    if (reminderTimeMatchesDailyDigest(item.reminderTime)) {
      continue;
    }

    const reminderAt = topicReminderFireTime(item);
    if (!reminderAt) continue;

    if (!isLocalTimeMatch(localNow.hour, localNow.minute, reminderAt.hour, reminderAt.minute)) {
      continue;
    }

    const reminderPush = buildReminderTimePushText(item);
    const reminderDelivery = await sendPushOnce({
      supabase: args.supabase,
      userId: args.settings.user_id,
      dedupKey: reminderTimeDedupKey(item, todayStats.today),
      notificationDate: todayStats.today,
      title: reminderPush.title,
      body: reminderPush.body,
      badgeCount: todayStats.count > 0 ? todayStats.count : undefined,
    });

    if (reminderDelivery === 'sent') {
      result.sent++;
      result.details.push(`Reminder time: ${item.title}`);
      await writeJobLog(args.supabase, {
        user_id: args.settings.user_id,
        source: args.source,
        level: 'SUCCESS',
        message: `Topic reminder push sent — ${item.title}`,
        meta: { item_id: item.id, kind: item.kind, reminder_at: reminderAt },
      });
    } else if (reminderDelivery === 'failed') {
      result.failed++;
      result.details.push(`Reminder time failed: ${item.title}`);
    } else {
      result.skipped++;
    }
  }

  return result;
}
