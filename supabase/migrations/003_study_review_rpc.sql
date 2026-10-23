  -- Atomic review schedule operations + completed review protection

  -- ============================================================
  -- Protect completed reviews (history)
  -- ============================================================
  create or replace function public.protect_completed_study_review()
  returns trigger
  language plpgsql
  as $$
  begin
    if tg_op = 'DELETE' and old.status = 'COMPLETED' then
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

  drop trigger if exists study_reviews_protect_completed on public.study_reviews;
  create trigger study_reviews_protect_completed
    before update or delete on public.study_reviews
    for each row execute function public.protect_completed_study_review();

  -- ============================================================
  -- Reorder step_order by day_offset ascending
  -- ============================================================
  create or replace function public.reorder_study_review_steps(p_topic_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    with ranked as (
      select id, row_number() over (order by day_offset asc) as new_order
      from public.study_reviews
      where topic_id = p_topic_id
    )
    update public.study_reviews sr
    set step_order = ranked.new_order
    from ranked
    where sr.id = ranked.id;
  end;
  $$;

  -- ============================================================
  -- Shared validation helper
  -- ============================================================
  create or replace function public.validate_review_offset(
    p_topic_id uuid,
    p_study_date date,
    p_new_offset integer,
    p_current_step_offset integer,
    p_exclude_review_id uuid default null
  )
  returns void
  language plpgsql
  stable
  set search_path = public
  as $$
  declare
    v_review_date date;
  begin
    if p_new_offset <= 0 then
      raise exception 'Review interval must be greater than 0.';
    end if;

    if p_new_offset <= p_current_step_offset then
      raise exception 'New review interval must be greater than the current step (N+%).', p_current_step_offset;
    end if;

    if exists (
      select 1 from public.study_reviews
      where topic_id = p_topic_id
        and day_offset = p_new_offset
        and (p_exclude_review_id is null or id <> p_exclude_review_id)
    ) then
      raise exception 'N+% already exists in this review schedule.', p_new_offset;
    end if;

    v_review_date := p_study_date + p_new_offset;

    if v_review_date < current_date then
      raise exception 'Cannot add N+% because its review date % has already passed.',
        p_new_offset, to_char(v_review_date, 'DD/MM/YYYY');
    end if;
  end;
  $$;

  -- ============================================================
  -- ADD review step (insert + reorder, atomic)
  -- ============================================================
  create or replace function public.add_study_review(
    p_topic_id uuid,
    p_day_offset integer,
    p_current_step_offset integer
  )
  returns public.study_reviews
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_topic public.study_topics;
    v_review public.study_reviews;
    v_review_date date;
  begin
    select * into v_topic from public.study_topics where id = p_topic_id;
    if not found then
      raise exception 'Topic not found.';
    end if;

    if not (auth.uid() = v_topic.user_id or public.is_admin()) then
      raise exception 'Permission denied.';
    end if;

    perform public.validate_review_offset(
      p_topic_id, v_topic.study_date, p_day_offset, p_current_step_offset
    );

    v_review_date := v_topic.study_date + p_day_offset;

    insert into public.study_reviews (
      topic_id, user_id, step_order, day_offset, review_date, status
    ) values (
      p_topic_id, v_topic.user_id, 9999, p_day_offset, v_review_date, 'PENDING'
    )
    returning * into v_review;

    perform public.reorder_study_review_steps(p_topic_id);

    select * into v_review from public.study_reviews where id = v_review.id;
    return v_review;
  end;
  $$;

  -- ============================================================
  -- REPLACE review step (atomic update + reorder)
  -- ============================================================
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
    if not found then
      raise exception 'Review not found.';
    end if;

    select * into v_topic from public.study_topics where id = v_review.topic_id for update;
    if not found then
      raise exception 'Topic not found.';
    end if;

    if not (auth.uid() = v_review.user_id or public.is_admin()) then
      raise exception 'Permission denied.';
    end if;

    if v_review.status = 'COMPLETED' then
      raise exception 'Cannot replace a completed review step.';
    end if;

    if v_review.day_offset <= p_current_step_offset then
      raise exception 'Only future steps beyond the current step can be replaced.';
    end if;

    if v_review.review_date <= current_date then
      raise exception 'Only future steps beyond the current step can be replaced.';
    end if;

    perform public.validate_review_offset(
      v_review.topic_id,
      v_topic.study_date,
      p_new_day_offset,
      p_current_step_offset,
      p_review_id
    );

    v_review_date := v_topic.study_date + p_new_day_offset;

    update public.study_reviews
    set day_offset = p_new_day_offset,
        review_date = v_review_date
    where id = p_review_id
    returning * into v_review;

    perform public.reorder_study_review_steps(v_review.topic_id);

    select * into v_review from public.study_reviews where id = p_review_id;
    return v_review;
  end;
  $$;

  -- ============================================================
  -- DELETE future pending review (delete + reorder, atomic)
  -- ============================================================
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
    if not found then
      raise exception 'Review not found.';
    end if;

    if not (auth.uid() = v_review.user_id or public.is_admin()) then
      raise exception 'Permission denied.';
    end if;

    if v_review.status = 'COMPLETED' then
      raise exception 'Cannot delete a completed review step.';
    end if;

    if v_review.day_offset <= p_current_step_offset then
      raise exception 'Only future steps beyond the current step can be deleted.';
    end if;

    if v_review.review_date <= current_date then
      raise exception 'Only future steps beyond the current step can be deleted.';
    end if;

    delete from public.study_reviews where id = p_review_id;

    perform public.reorder_study_review_steps(v_review.topic_id);
  end;
  $$;

  grant execute on function public.add_study_review(uuid, integer, integer) to authenticated;
  grant execute on function public.replace_study_review(uuid, integer, integer) to authenticated;
  grant execute on function public.delete_study_review(uuid, integer) to authenticated;
