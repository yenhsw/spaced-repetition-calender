-- Dedup keys for scheduled web push (daily digest + per-task lead reminders)

create table if not exists public.push_reminder_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  dedup_key text not null,
  notification_date date not null,
  status text not null check (status in ('SENT', 'FAILED')),
  error_message text,
  sent_at timestamptz not null default now(),
  unique (user_id, dedup_key)
);

create index if not exists push_reminder_logs_user_date_idx
  on public.push_reminder_logs (user_id, notification_date desc);

alter table public.push_reminder_logs enable row level security;

drop policy if exists "Users can view own push reminder logs" on public.push_reminder_logs;
create policy "Users can view own push reminder logs"
  on public.push_reminder_logs for select
  using (auth.uid() = user_id);

drop policy if exists "Admins can view all push reminder logs" on public.push_reminder_logs;
create policy "Admins can view all push reminder logs"
  on public.push_reminder_logs for select
  using (public.is_admin());
