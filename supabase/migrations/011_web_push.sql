-- Web Push subscriptions (per device) + extend delivery log channel

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

drop trigger if exists push_subscriptions_updated_at on public.push_subscriptions;
create trigger push_subscriptions_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users manage own push subscriptions" on public.push_subscriptions;
create policy "Users manage own push subscriptions"
  on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Admins view all push subscriptions" on public.push_subscriptions;
create policy "Admins view all push subscriptions"
  on public.push_subscriptions
  for select
  using (public.is_admin());

-- Extend notification_logs channel for WEB_PUSH
alter table public.notification_logs drop constraint if exists notification_logs_channel_check;
alter table public.notification_logs add constraint notification_logs_channel_check
  check (channel in ('EMAIL', 'DISCORD', 'WEB_PUSH'));
