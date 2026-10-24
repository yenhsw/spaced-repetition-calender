/// <reference path="../edge-runtime.d.ts" />

import { createServiceClient, getUserIdFromAuthHeader } from '../_shared/auth.ts';
import { NotificationSettingsRow } from '../_shared/reminders.ts';
import { runRemindersForUser } from '../_shared/schedule.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) {
    return jsonResponse({ ok: false, message: 'Unauthorized' }, 401);
  }

  const supabase = createServiceClient();
  const { data: settings, error } = await supabase
    .from('notification_settings')
    .select('user_id, channel, email_destination, email_timezone, discord_webhook_url')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !settings) {
    return jsonResponse({ ok: false, message: error?.message ?? 'Settings not found' }, 400);
  }

  const result = await runRemindersForUser({
    supabase,
    settings: settings as NotificationSettingsRow,
    resendApiKey: Deno.env.get('RESEND_API_KEY'),
    emailFrom: Deno.env.get('EMAIL_FROM') ?? 'reminders@example.com',
    ignoreTimeCheck: false,
    source: 'MANUAL',
  });

  return jsonResponse({ ok: true, ...result });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
