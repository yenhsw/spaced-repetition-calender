-- Per-topic reminder time (default 08:30 local, user timezone from notification_settings)

alter table public.study_topics
  add column if not exists reminder_time time not null default time '08:30:00';

update public.study_topics
set reminder_time = time '08:30:00'
where reminder_time is null;

-- Replace 6-arg RPC with 7-arg version (CREATE OR REPLACE cannot change signature)
drop function if exists public.create_study_topic_with_reviews(text, date, text, text, text, uuid);

create or replace function public.create_study_topic_with_reviews(
  p_title text,
  p_study_date date,
  p_subject text default null,
  p_description text default null,
  p_resource_url text default null,
  p_user_id uuid default null,
  p_reminder_time time default time '08:30:00'
)
returns public.study_topics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_topic public.study_topics;
  v_offsets integer[] := array[1, 3, 7, 14, 30, 60];
  v_offset integer;
  v_idx integer := 0;
  v_reminder time := coalesce(p_reminder_time, time '08:30:00');
begin
  v_user_id := coalesce(p_user_id, auth.uid());
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  if not (auth.uid() = v_user_id or public.is_admin()) then
    raise exception 'Permission denied.';
  end if;

  perform public.ensure_user_profile(v_user_id);

  if p_title is null or char_length(trim(p_title)) = 0 then
    raise exception 'Title is required.';
  end if;

  if p_study_date is null then
    raise exception 'Study date is required.';
  end if;

  insert into public.study_topics (
    user_id, title, study_date, subject, description, resource_url, current_step_offset, reminder_time
  ) values (
    v_user_id, trim(p_title), p_study_date, p_subject, p_description, p_resource_url, 0, v_reminder
  )
  returning * into v_topic;

  foreach v_offset in array v_offsets loop
    v_idx := v_idx + 1;
    insert into public.study_reviews (
      topic_id, user_id, step_order, day_offset, review_date, status
    ) values (
      v_topic.id,
      v_user_id,
      v_idx,
      v_offset,
      p_study_date + v_offset,
      'PENDING'
    );
  end loop;

  return v_topic;
end;
$$;

grant execute on function public.create_study_topic_with_reviews(text, date, text, text, text, uuid, time) to authenticated;
