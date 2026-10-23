/// <reference path="../edge-runtime.d.ts" />

import {
  createServiceClient,
  NotificationSettingsRow,
  runRemindersForUser,
} from '../_shared/reminders.ts';
import { getUserPushSubscriptions } from '../_shared/web-push.ts';

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
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const supabase = createServiceClient();
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const emailFrom = Deno.env.get('EMAIL_FROM') ?? 'reminders@example.com';

  const { data: settingsRows, error: settingsError } = await supabase
    .from('notification_settings')
    .select('user_id, channel, email_destination, email_timezone, discord_webhook_url');

  if (settingsError) {
    return jsonResponse({ error: settingsError.message }, 500);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const settings of (settingsRows ?? []) as NotificationSettingsRow[]) {
    const pushSubs = await getUserPushSubscriptions(supabase, settings.user_id);
    if (settings.channel === 'NONE' && pushSubs.length === 0) {
      skipped++;
      continue;
    }
    const result = await runRemindersForUser({
      supabase,
      settings,
      resendApiKey,
      emailFrom,
      source: 'CRON',
    });
    sent += result.sent;
    skipped += result.skipped;
    failed += result.failed;
  }

  return jsonResponse({
    ok: true,
    sent,
    skipped,
    failed,
    checkedAt: new Date().toISOString(),
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
