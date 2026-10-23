-- Notification preferences + delivery logs (server-side reminders only)

-- ============================================================
-- ENUM-like channel preference
-- ============================================================
-- EMAIL | DISCORD | BOTH | NONE

create table if not exists public.notification_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  channel text not null default 'NONE'
    check (channel in ('EMAIL', 'DISCORD', 'BOTH', 'NONE')),
  email_destination text,
  email_reminder_time time not null default time '09:00',
  email_timezone text not null default 'UTC',
  discord_webhook_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_settings_email_required check (
    channel not in ('EMAIL', 'BOTH')
    or (email_destination is not null and char_length(trim(email_destination)) > 0)
  ),
  constraint notification_settings_discord_required check (
    channel not in ('DISCORD', 'BOTH')
    or (discord_webhook_url is not null and char_length(trim(discord_webhook_url)) > 0)
  )
);

create index if not exists notification_settings_channel_idx
  on public.notification_settings (channel);

drop trigger if exists notification_settings_updated_at on public.notification_settings;
create trigger notification_settings_updated_at
  before update on public.notification_settings
  for each row execute function public.set_updated_at();

-- ============================================================
-- Delivery log (dedup per review + channel + notification date)
-- ============================================================
create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  review_id uuid not null references public.study_reviews (id) on delete cascade,
  channel text not null check (channel in ('EMAIL', 'DISCORD')),
  notification_date date not null,
  status text not null check (status in ('SENT', 'FAILED')),
  error_message text,
  sent_at timestamptz not null default now(),
  unique (review_id, channel, notification_date)
);

create index if not exists notification_logs_user_id_idx on public.notification_logs (user_id);
create index if not exists notification_logs_review_id_idx on public.notification_logs (review_id);
create index if not exists notification_logs_sent_at_idx on public.notification_logs (sent_at desc);

-- ============================================================
-- Default settings on profile create
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    'USER'
  );

  insert into public.notification_settings (user_id, channel, email_destination)
  values (new.id, 'NONE', new.email)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Backfill for existing users
insert into public.notification_settings (user_id, channel, email_destination)
select p.id, 'NONE', p.email
from public.profiles p
where not exists (
  select 1 from public.notification_settings ns where ns.user_id = p.id
);

-- ============================================================
-- RLS
-- ============================================================
alter table public.notification_settings enable row level security;
alter table public.notification_logs enable row level security;

-- notification_settings: own row only (webhook never visible to others)
drop policy if exists "Users can view own notification settings" on public.notification_settings;
create policy "Users can view own notification settings"
  on public.notification_settings for select
  using (auth.uid() = user_id);

drop policy if exists "Admins can view all notification settings" on public.notification_settings;
create policy "Admins can view all notification settings"
  on public.notification_settings for select
  using (public.is_admin());

drop policy if exists "Users can insert own notification settings" on public.notification_settings;
create policy "Users can insert own notification settings"
  on public.notification_settings for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own notification settings" on public.notification_settings;
create policy "Users can update own notification settings"
  on public.notification_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Admins can insert notification settings for any user" on public.notification_settings;
create policy "Admins can insert notification settings for any user"
  on public.notification_settings for insert
  with check (public.is_admin());

drop policy if exists "Admins can update any notification settings" on public.notification_settings;
create policy "Admins can update any notification settings"
  on public.notification_settings for update
  using (public.is_admin());

-- notification_logs: read-only for clients; writes via service role (Edge Function)
drop policy if exists "Users can view own notification logs" on public.notification_logs;
create policy "Users can view own notification logs"
  on public.notification_logs for select
  using (auth.uid() = user_id);

drop policy if exists "Admins can view all notification logs" on public.notification_logs;
create policy "Admins can view all notification logs"
  on public.notification_logs for select
  using (public.is_admin());

-- No INSERT/UPDATE/DELETE policies for authenticated users on notification_logs
