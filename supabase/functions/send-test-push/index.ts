/// <reference path="../edge-runtime.d.ts" />

import { createServiceClient, getUserIdFromAuthHeader } from '../_shared/auth.ts';
import { writeJobLog } from '../_shared/reminders.ts';
import { buildTodayPushText, getTodayTasks } from '../_shared/today-count.ts';
import { sendPushToUser } from '../_shared/web-push.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) {
      return jsonResponse({ ok: false, message: 'Unauthorized' }, 401);
    }

    const supabase = createServiceClient();

    const { data: settings } = await supabase
      .from('notification_settings')
      .select('email_timezone')
      .eq('user_id', userId)
      .maybeSingle();

    const timezone = (settings?.email_timezone as string | undefined) ?? 'Asia/Ho_Chi_Minh';
    const todayStats = await getTodayTasks({ supabase, userId, timezone });
    const { title, body } = buildTodayPushText(todayStats.items);

    const result = await sendPushToUser({
      supabase,
      userId,
      payload: {
        title,
        body,
        url: '/spaced-repetition/today',
        badgeCount: todayStats.count > 0 ? todayStats.count : undefined,
      },
    });

    if (result.sent > 0) {
      const successMsg = `Test push: "${body}" → ${result.sent} device(s)`;
      await writeJobLog(supabase, {
        user_id: userId,
        source: 'TEST',
        level: 'SUCCESS',
        message: successMsg,
        meta: todayStats,
      });
      return jsonResponse({
        ok: true,
        message: successMsg,
        today: todayStats,
      });
    }

    const message = result.errors[0] ?? 'No push subscriptions found on this account.';
    await writeJobLog(supabase, {
      user_id: userId,
      source: 'TEST',
      level: 'WARN',
      message,
      meta: todayStats,
    });

    return jsonResponse({ ok: false, message, today: todayStats }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[send-test-push] unhandled error:', message);
    return jsonResponse({ ok: false, message: `Server error: ${message}` }, 500);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
