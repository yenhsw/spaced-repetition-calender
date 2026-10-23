/// <reference path="../edge-runtime.d.ts" />

import {
  createServiceClient,
  getUserIdFromAuthHeader,
  writeJobLog,
} from '../_shared/reminders.ts';
import { sendPushToUser } from '../_shared/web-push.ts';

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
  const result = await sendPushToUser({
    supabase,
    userId,
    payload: {
      title: 'Spaced Repetition — Test notification',
      body: 'Push notifications are working. Tap to open today\'s reviews.',
      url: '/spaced-repetition/today',
      badgeCount: 1,
    },
  });

  if (result.sent > 0) {
    await writeJobLog(supabase, {
      user_id: userId,
      source: 'TEST',
      level: 'SUCCESS',
      message: `Test push sent to ${result.sent} device(s)`,
    });
    return jsonResponse({
      ok: true,
      message: `Test push sent to ${result.sent} device(s).`,
    });
  }

  const message = result.errors[0] ?? 'No push subscriptions found on this account.';
  await writeJobLog(supabase, {
    user_id: userId,
    source: 'TEST',
    level: 'WARN',
    message,
  });

  return jsonResponse({ ok: false, message }, 400);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
