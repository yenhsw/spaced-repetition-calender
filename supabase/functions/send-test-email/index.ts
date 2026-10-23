/// <reference path="../edge-runtime.d.ts" />

import {
  createServiceClient,
  getUserIdFromAuthHeader,
  sendTestEmail,
} from '../_shared/reminders.ts';
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

  const result = await sendTestEmail({
    supabase: createServiceClient(),
    userId,
    resendApiKey: Deno.env.get('RESEND_API_KEY'),
    emailFrom: Deno.env.get('EMAIL_FROM') ?? 'reminders@example.com',
  });

  return jsonResponse(result, result.ok ? 200 : 400);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
