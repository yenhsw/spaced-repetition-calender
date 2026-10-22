-- Add current_step_offset for existing deployments
alter table public.study_topics
  add column if not exists current_step_offset integer not null default 0
  check (current_step_offset >= 0);
