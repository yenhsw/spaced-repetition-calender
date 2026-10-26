/// <reference path="../edge-runtime.d.ts" />

import { createServiceClient } from '../_shared/auth.ts';
import { NotificationSettingsRow, writeJobLog } from '../_shared/reminders.ts';
import { processPushRemindersForUser } from '../_shared/push-reminders.ts';
import { processDueSchedulesForUser } from '../_shared/schedule.ts';
import { getUserPushSubscriptions } from '../_shared/web-push.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function authorizeCron(req: Request): boolean {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  const cronSecret = Deno.env.get('CRON_SECRET');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  return !!(token && ((cronSecret && token === cronSecret) || (serviceKey && token === serviceKey)));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!authorizeCron(req)) {
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
  const details: string[] = [];

  for (const settings of (settingsRows ?? []) as NotificationSettingsRow[]) {
    const pushSubs = await getUserPushSubscriptions(supabase, settings.user_id);
    const hasEmailChannel = settings.channel !== 'NONE';

    if (!hasEmailChannel && pushSubs.length === 0) {
      skipped++;
      continue;
    }

    if (pushSubs.length > 0) {
      const pushResult = await processPushRemindersForUser({
        supabase,
        settings,
        source: 'CRON',
      });
      sent += pushResult.sent;
      skipped += pushResult.skipped;
      failed += pushResult.failed;
      if (pushResult.details.length) {
        details.push(...pushResult.details.map((d) => `${settings.user_id}: ${d}`));
      }
    }

    if (hasEmailChannel) {
      const dueResult = await processDueSchedulesForUser({
        supabase,
        settings,
        resendApiKey,
        emailFrom,
        source: 'CRON',
      });
      sent += dueResult.sent;
      skipped += dueResult.skipped;
      failed += dueResult.failed;
    }
  }

  await writeJobLog(supabase, {
    user_id: null,
    source: 'CRON',
    level: failed > 0 ? 'WARN' : sent > 0 ? 'SUCCESS' : 'INFO',
    message: `Cron tick: sent=${sent}, skipped=${skipped}, failed=${failed}`,
    meta: { details, checkedAt: new Date().toISOString() },
  });

  return jsonResponse({
    ok: true,
    sent,
    skipped,
    failed,
    details,
    checkedAt: new Date().toISOString(),
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
