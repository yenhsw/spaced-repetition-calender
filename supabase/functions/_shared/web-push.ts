/// <reference path="../edge-runtime.d.ts" />

import webpush from 'npm:web-push@3.6.7';
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushPayload {
  title: string;
  body: string;
  url?: string;
}

let vapidConfigured = false;

export function configureWebPush(): boolean {
  if (vapidConfigured) return true;

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:reminders@spaced-rep.app';

  if (!publicKey?.trim() || !privateKey?.trim()) {
    return false;
  }

  webpush.setVapidDetails(subject, publicKey.trim(), privateKey.trim());
  vapidConfigured = true;
  return true;
}

export function buildAngularPushPayload(payload: WebPushPayload): string {
  const url = payload.url ?? '/spaced-repetition/today';
  return JSON.stringify({
    notification: {
      title: payload.title,
      body: payload.body,
      icon: '/icons/icon-192.svg',
      badge: '/icons/icon-192.svg',
      data: {
        url,
        onActionClick: {
          default: {
            operation: 'navigate',
            url,
          },
        },
      },
    },
  });
}

export async function getUserPushSubscriptions(
  supabase: SupabaseClient,
  userId: string,
): Promise<PushSubscriptionRow[]> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (error) {
    console.error('[web-push] load subscriptions failed:', error.message);
    return [];
  }

  return (data ?? []) as PushSubscriptionRow[];
}

export async function sendPushToUser(args: {
  supabase: SupabaseClient;
  userId: string;
  payload: WebPushPayload;
}): Promise<{ sent: number; failed: number; errors: string[] }> {
  if (!configureWebPush()) {
    return { sent: 0, failed: 0, errors: ['VAPID keys not configured on server'] };
  }

  const subscriptions = await getUserPushSubscriptions(args.supabase, args.userId);
  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0, errors: ['No push subscriptions for user'] };
  }

  const body = buildAngularPushPayload(args.payload);
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
      );
      sent++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message.slice(0, 200));

      if (message.includes('410') || message.includes('404') || message.includes('expired')) {
        await args.supabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }

  return { sent, failed, errors };
}
