-- Job-level logs for reminder runs (cron / manual / test)

create table if not exists public.notification_job_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  source text not null check (source in ('CRON', 'MANUAL', 'TEST')),
  level text not null check (level in ('INFO', 'WARN', 'ERROR', 'SUCCESS')),
  message text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists notification_job_logs_user_id_idx
  on public.notification_job_logs (user_id, created_at desc);

alter table public.notification_job_logs enable row level security;

drop policy if exists "Users can view own notification job logs" on public.notification_job_logs;
create policy "Users can view own notification job logs"
  on public.notification_job_logs for select
  using (auth.uid() = user_id);

drop policy if exists "Admins can view all notification job logs" on public.notification_job_logs;
create policy "Admins can view all notification job logs"
  on public.notification_job_logs for select
  using (public.is_admin());
