import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

type NotificationChannel = 'EMAIL' | 'DISCORD' | 'BOTH' | 'NONE';
type LogChannel = 'EMAIL' | 'DISCORD';

interface NotificationSettingsRow {
  user_id: string;
  channel: NotificationChannel;
  email_destination: string | null;
  email_reminder_time: string;
  email_timezone: string;
  discord_webhook_url: string | null;
}

interface DueReviewRow {
  id: string;
  user_id: string;
  review_date: string;
  day_offset: number;
  step_order: number;
  study_topic: { title: string } | null;
}

interface LocalParts {
  date: string;
  hour: number;
  minute: number;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const emailFrom = Deno.env.get('EMAIL_FROM') ?? 'reminders@example.com';

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: settingsRows, error: settingsError } = await supabase
    .from('notification_settings')
    .select('*')
    .neq('channel', 'NONE');

  if (settingsError) {
    return jsonResponse({ error: settingsError.message }, 500);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const settings of (settingsRows ?? []) as NotificationSettingsRow[]) {
    const localNow = getLocalParts(settings.email_timezone);
    const reminderHour = parseReminderHour(settings.email_reminder_time);

    const shouldRunEmail =
      (settings.channel === 'EMAIL' || settings.channel === 'BOTH') &&
      localNow.hour === reminderHour;
    const shouldRunDiscord =
      (settings.channel === 'DISCORD' || settings.channel === 'BOTH') &&
      localNow.hour === reminderHour;

    if (!shouldRunEmail && !shouldRunDiscord) {
      skipped++;
      continue;
    }

    const { data: reviews, error: reviewsError } = await supabase
      .from('study_reviews')
      .select('id, user_id, review_date, day_offset, step_order, study_topic:study_topics(title)')
      .eq('user_id', settings.user_id)
      .eq('status', 'PENDING')
      .eq('review_date', localNow.date);

    if (reviewsError) {
      failed++;
      continue;
    }

    for (const review of (reviews ?? []) as DueReviewRow[]) {
      const topicTitle = review.study_topic?.title ?? 'Study topic';
      const offsetLabel = `N+${review.day_offset}`;
      const message = `Review due today: ${offsetLabel} · ${topicTitle} (Step ${review.step_order})`;

      if (shouldRunEmail && settings.email_destination) {
        const result = await sendEmailChannel({
          supabase,
          settings,
          review,
          resendApiKey,
          emailFrom,
          message,
          notificationDate: localNow.date,
        });
        if (result === 'sent') sent++;
        else if (result === 'failed') failed++;
        else skipped++;
      }

      if (shouldRunDiscord && settings.discord_webhook_url) {
        const result = await sendDiscordChannel({
          supabase,
          settings,
          review,
          webhookUrl: settings.discord_webhook_url,
          message,
          notificationDate: localNow.date,
        });
        if (result === 'sent') sent++;
        else if (result === 'failed') failed++;
        else skipped++;
      }
    }
  }

  return jsonResponse({ ok: true, sent, skipped, failed });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getLocalParts(timezone: string): LocalParts {
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

  const year = pick('year');
  const month = pick('month');
  const day = pick('day');

  return {
    date: `${year}-${month}-${day}`,
    hour: Number(pick('hour')),
    minute: Number(pick('minute')),
  };
}

function parseReminderHour(timeValue: string): number {
  const [hourPart] = timeValue.split(':');
  return Number(hourPart);
}

async function alreadySent(
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>;
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

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: args.emailFrom,
        to: [args.settings.email_destination],
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
  supabase: ReturnType<typeof createClient>;
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
