-- Allow topic delete to cascade through RLS-protected child rows and completed reviews.

create or replace function public.protect_completed_study_review()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and old.status = 'COMPLETED' then
    if coalesce(current_setting('app.deleting_topic', true), '') = 'true' then
      return old;
    end if;
    raise exception 'Cannot delete a completed review.';
  end if;

  if tg_op = 'UPDATE' and old.status = 'COMPLETED' then
    if new.day_offset is distinct from old.day_offset
      or new.review_date is distinct from old.review_date
      or new.status is distinct from old.status then
      raise exception 'Cannot modify a completed review.';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.delete_study_topic(p_topic_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_topic public.study_topics;
begin
  select * into v_topic from public.study_topics where id = p_topic_id;
  if not found then
    raise exception 'Topic not found.';
  end if;

  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  if not (auth.uid() = v_topic.user_id or public.is_admin()) then
    raise exception 'Permission denied.';
  end if;

  perform set_config('app.deleting_topic', 'true', true);

  delete from public.notification_logs
  where review_id in (
    select id from public.study_reviews where topic_id = p_topic_id
  );

  delete from public.review_reminder_schedules
  where review_id in (
    select id from public.study_reviews where topic_id = p_topic_id
  );

  delete from public.study_reviews where topic_id = p_topic_id;
  delete from public.study_topics where id = p_topic_id;
end;
$$;

grant execute on function public.delete_study_topic(uuid) to authenticated;
