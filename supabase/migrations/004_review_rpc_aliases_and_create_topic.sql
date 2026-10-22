-- Renamed RPC aliases + atomic create topic with default reviews

-- ============================================================
-- CREATE topic + default reviews (atomic)
-- ============================================================
create or replace function public.create_study_topic_with_reviews(
  p_title text,
  p_study_date date,
  p_subject text default null,
  p_description text default null,
  p_resource_url text default null,
  p_user_id uuid default null
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
begin
  v_user_id := coalesce(p_user_id, auth.uid());
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  if not (auth.uid() = v_user_id or public.is_admin()) then
    raise exception 'Permission denied.';
  end if;

  if p_title is null or char_length(trim(p_title)) = 0 then
    raise exception 'Title is required.';
  end if;

  if p_study_date is null then
    raise exception 'Study date is required.';
  end if;

  insert into public.study_topics (
    user_id, title, study_date, subject, description, resource_url, current_step_offset
  ) values (
    v_user_id, trim(p_title), p_study_date, p_subject, p_description, p_resource_url, 0
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

-- ============================================================
-- Aliased RPC names (§34)
-- ============================================================
create or replace function public.add_review_step(
  p_topic_id uuid,
  p_day_offset integer,
  p_current_step_offset integer
)
returns public.study_reviews
language sql
security definer
set search_path = public
as $$
  select public.add_study_review(p_topic_id, p_day_offset, p_current_step_offset);
$$;

create or replace function public.replace_review_step(
  p_review_id uuid,
  p_new_day_offset integer,
  p_current_step_offset integer
)
returns public.study_reviews
language sql
security definer
set search_path = public
as $$
  select public.replace_study_review(p_review_id, p_new_day_offset, p_current_step_offset);
$$;

create or replace function public.remove_review_step(
  p_review_id uuid,
  p_current_step_offset integer
)
returns void
language sql
security definer
set search_path = public
as $$
  select public.delete_study_review(p_review_id, p_current_step_offset);
$$;

-- Fix future edit rule: review_date >= today (§30)
create or replace function public.replace_study_review(
  p_review_id uuid,
  p_new_day_offset integer,
  p_current_step_offset integer
)
returns public.study_reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.study_reviews;
  v_topic public.study_topics;
  v_review_date date;
begin
  select * into v_review from public.study_reviews where id = p_review_id for update;
  if not found then raise exception 'Review not found.'; end if;

  select * into v_topic from public.study_topics where id = v_review.topic_id for update;
  if not found then raise exception 'Topic not found.'; end if;

  if not (auth.uid() = v_review.user_id or public.is_admin()) then
    raise exception 'Permission denied.';
  end if;

  if v_review.status <> 'PENDING' then
    raise exception 'Cannot replace a completed review step.';
  end if;

  if v_review.day_offset <= p_current_step_offset then
    raise exception 'Only future steps beyond the current step can be replaced.';
  end if;

  if v_review.review_date < current_date then
    raise exception 'Only future steps beyond the current step can be replaced.';
  end if;

  perform public.validate_review_offset(
    v_review.topic_id, v_topic.study_date, p_new_day_offset, p_current_step_offset, p_review_id
  );

  v_review_date := v_topic.study_date + p_new_day_offset;

  update public.study_reviews
  set day_offset = p_new_day_offset, review_date = v_review_date
  where id = p_review_id
  returning * into v_review;

  perform public.reorder_study_review_steps(v_review.topic_id);

  select * into v_review from public.study_reviews where id = p_review_id;
  return v_review;
end;
$$;

create or replace function public.delete_study_review(
  p_review_id uuid,
  p_current_step_offset integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.study_reviews;
begin
  select * into v_review from public.study_reviews where id = p_review_id for update;
  if not found then raise exception 'Review not found.'; end if;

  if not (auth.uid() = v_review.user_id or public.is_admin()) then
    raise exception 'Permission denied.';
  end if;

  if v_review.status <> 'PENDING' then
    raise exception 'Cannot delete a completed review step.';
  end if;

  if v_review.day_offset <= p_current_step_offset then
    raise exception 'Only future steps beyond the current step can be deleted.';
  end if;

  if v_review.review_date < current_date then
    raise exception 'Only future steps beyond the current step can be deleted.';
  end if;

  delete from public.study_reviews where id = p_review_id;
  perform public.reorder_study_review_steps(v_review.topic_id);
end;
$$;

grant execute on function public.create_study_topic_with_reviews(text, date, text, text, text, uuid) to authenticated;
grant execute on function public.add_review_step(uuid, integer, integer) to authenticated;
grant execute on function public.replace_review_step(uuid, integer, integer) to authenticated;
grant execute on function public.remove_review_step(uuid, integer) to authenticated;
