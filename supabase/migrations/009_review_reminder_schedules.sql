-- Per-review reminder schedule (review_date + topic.reminder_time in user timezone)

create table if not exists public.review_reminder_schedules (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.study_reviews (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  send_at timestamptz not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SCHEDULED', 'SENT', 'FAILED', 'CANCELLED')),
  resend_email_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id)
);

create index if not exists review_reminder_schedules_user_id_idx
  on public.review_reminder_schedules (user_id);

create index if not exists review_reminder_schedules_due_idx
  on public.review_reminder_schedules (status, send_at)
  where status in ('PENDING', 'SCHEDULED');

drop trigger if exists review_reminder_schedules_updated_at on public.review_reminder_schedules;
create trigger review_reminder_schedules_updated_at
  before update on public.review_reminder_schedules
  for each row execute function public.set_updated_at();

alter table public.review_reminder_schedules enable row level security;

drop policy if exists "Users can view own reminder schedules" on public.review_reminder_schedules;
create policy "Users can view own reminder schedules"
  on public.review_reminder_schedules for select
  using (auth.uid() = user_id);

drop policy if exists "Admins can view all reminder schedules" on public.review_reminder_schedules;
create policy "Admins can view all reminder schedules"
  on public.review_reminder_schedules for select
  using (public.is_admin());

-- Extend job log sources
alter table public.notification_job_logs drop constraint if exists notification_job_logs_source_check;
alter table public.notification_job_logs add constraint notification_job_logs_source_check
  check (source in ('CRON', 'MANUAL', 'TEST', 'SYNC'));
