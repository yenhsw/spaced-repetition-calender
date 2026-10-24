/// <reference path="../edge-runtime.d.ts" />

import { createServiceClient, getUserIdFromAuthHeader } from '../_shared/auth.ts';
import { syncReminderSchedulesForUser } from '../_shared/schedule.ts';

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
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let topicId: string | undefined;
  try {
    const body = req.method === 'POST' ? await req.json() : {};
    topicId = typeof body?.topicId === 'string' ? body.topicId : undefined;
  } catch {
    /* empty body is fine */
  }

  const supabase = createServiceClient();
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const emailFrom = Deno.env.get('EMAIL_FROM') ?? 'reminders@example.com';

  const result = await syncReminderSchedulesForUser({
    supabase,
    userId,
    topicId,
    resendApiKey,
    emailFrom,
    source: 'SYNC',
  });

  return jsonResponse({ ok: true, ...result });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
