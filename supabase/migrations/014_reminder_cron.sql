-- Schedule send-daily-reminders every minute (push digest / lead / reminder_time).
-- Requires the same value in:
--   1) Edge Function secret CRON_SECRET
--   2) Vault secret named cron_secret (run once in SQL editor):
--      select vault.create_secret('<CRON_SECRET>', 'cron_secret', 'Auth for send-daily-reminders');

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_send_daily_reminders()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_url text := 'https://pgdplbpuwtlklowzevxt.supabase.co/functions/v1/send-daily-reminders';
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_secret'
  limit 1;

  if v_secret is null or length(trim(v_secret)) = 0 then
    raise warning '[invoke_send_daily_reminders] vault secret cron_secret missing — skip';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'send-daily-reminders' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
exception
  when undefined_table then null;
  when others then null;
end;
$$;

select cron.schedule(
  'send-daily-reminders',
  '* * * * *',
  $$select public.invoke_send_daily_reminders();$$
);
