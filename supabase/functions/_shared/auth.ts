/// <reference path="../edge-runtime.d.ts" />

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function getUserIdFromAuthHeader(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    console.warn('[auth] Missing bearer token');
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  const supabase = createServiceClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    console.error('[auth] getUser failed:', error?.message ?? 'no user');
    return null;
  }

  console.log('[auth] user authenticated:', user.id);
  return user.id;
}
